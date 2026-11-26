import { renderMath, finishRenderMath, loadMathJax } from 'obsidian';
import { LabelPart, labelMathSource } from './mathcontext';
import { LabelCache } from './labelcache';

/**
 * Real LaTeX rendering for annotation/title/legend text, layered on top of
 * the `stripLatex()` approximation in `util.ts`. When a text field is a
 * single `$...$` or `\(...\)` wrapped expression, we hand it to Obsidian's
 * own MathJax instance (the same one used for `$...$` in notes) instead of
 * approximating it with Unicode substitutions. 6.2.1: a text that mixes
 * words and `$...$` (renderMixedLabel) is one line of HTML: the words in
 * the chart's text font, each math piece from MathJax. Plain prose and
 * math without delimiters keep the cheap stripLatex() path.
 */

/**
 * If `text`, once trimmed, is entirely one math segment (`$...$`, `$$...$$`
 * or `\(...\)`), return the LaTeX source inside the delimiters, else null.
 * Uses the label reader the exporter uses (labelMathSource), so MathJax and
 * the PDF agree on what counts as math ('$5 and $10' is text).
 */
export function extractMathSource(text: string): string | null {
    return labelMathSource(text);
}

// Offscreen host used to measure MathJax's rendered size before it's
// inserted into the (possibly still-detached) plot SVG.
let measureHost: HTMLDivElement | null = null;
function getMeasureHost(): HTMLDivElement {
    if (!measureHost || !measureHost.isConnected) {
        measureHost = activeDocument.body.createDiv({ cls: 'easy-tikz-measure-host' });
    }
    return measureHost;
}

export interface MathLabel {
    el: HTMLElement;
    width: number;
    height: number;
}

/**
 * Font size of a MathJax label relative to a plain label of the same size.
 * `fontSizePx` is the size the plain text path draws at, which is the size
 * the text has in the PDF (10 pt for a normal label). The capitals of
 * MathJax's TeX fonts are 0.68 em tall, those of the interface font about
 * 0.71 em, so a small boost gives `$A_1$` the cap height of a plain "A1"
 * and stays within a few percent of the PDF. (Up to 4.0.0 this was 1.8:
 * formulas and legend entries were drawn almost twice as large as the
 * export sets them, and covered what was next to them.)
 */
const MATH_SIZE_MULTIPLIER = 1.05;

/**
 * Rendered and measured labels by (font size, colour, source): slider drags
 * re-render the chart every frame, and measuring forces a layout per label,
 * so a label whose size has settled is served as a clone. MathJax adds the
 * CSS of new glyphs only when the render pass is flushed, so a new label is
 * measured again when the flush of its pass has finished (src/labelcache.ts),
 * and flushMathRenders tells the caller to draw once more when that changed
 * a size it drew with.
 */
const labels = new LabelCache<HTMLElement>(measure, (el) => el.cloneNode(true) as HTMLElement);

/**
 * How often in a row a chart may be drawn again because flushMathRenders
 * asked for it. One redraw settles a new label; the limit only ends the
 * chain for a label that cannot be measured.
 */
export const MATH_REDRAW_LIMIT = 4;

/**
 * Render `mathSource` with MathJax and measure the result. Throws if MathJax
 * rejects the source. Every call returns a fresh element (callers insert it
 * into their own SVG).
 */
export function renderMathLabel(mathSource: string, color: string, fontSizePx: number): MathLabel {
    return labels.get(`${fontSizePx}|${color}|${mathSource}`, () => mathElement(mathSource, color, fontSizePx));
}

/**
 * 6.2.1: a label that mixes words and math (labelParts): the words in the
 * chart's text font, the math pieces typeset by MathJax, in one line, as
 * one element measured as a whole. `weight` is the words' font weight (a
 * title's 600). Throws if MathJax rejects a piece.
 */
export function renderMixedLabel(parts: LabelPart[], color: string, fontSizePx: number, weight?: string): MathLabel {
    const key = `mixed|${fontSizePx}|${color}|${weight ?? ''}|${JSON.stringify(parts)}`;
    return labels.get(key, () => {
        const box = createSpan();
        box.setCssStyles({
            color,
            fontSize: `${fontSizePx}px`,
            fontFamily: 'var(--font-text)',
            fontWeight: weight || '400',
            lineHeight: 'normal',
            whiteSpace: 'nowrap',
            display: 'inline-block',
            pointerEvents: 'none',
        });
        for (const part of parts) {
            if (!part.math) {
                box.appendText(part.text);
                continue;
            }
            const m = renderMath(part.text, false);
            // MathJax's size relative to the words, as a math label has it; its own weight.
            m.setCssStyles({ fontSize: `${MATH_SIZE_MULTIPLIER}em`, fontWeight: '400' });
            oneLine(m);
            box.appendChild(m);
        }
        return box;
    });
}

/** A math label: MathJax's element in the label's colour and size. */
function mathElement(mathSource: string, color: string, fontSizePx: number): HTMLElement {
    const el = renderMath(mathSource, false);
    // Inline styles (via the sanctioned helper) rather than a CSS class:
    // the element ends up inside the chart SVG's <foreignObject>, and
    // inline styles are the only ones that survive SVG serialization.
    el.setCssStyles({
        color,
        fontSize: `${fontSizePx * MATH_SIZE_MULTIPLIER}px`,
        display: 'inline-block',
        pointerEvents: 'none',
    });
    oneLine(el);
    return el;
}

/**
 * 6.2.1: the width of MathJax's breakable spaces (mjx-break) by their
 * `size`, in em. MathJax draws one as a space of its font MJX-BRK (1 em
 * wide) pulled together by a letter-spacing per size; until that font has
 * loaded the space has the fallback font's width, so a label measured then
 * came out too narrow (a legend frame shorter than its formula).
 */
const BREAK_EM: Record<string, number> = { '0': 0, '1': 0.111, '2': 0.167, '3': 0.222, '4': 0.278, '5': 0.333 };

/**
 * 6.0 F1: MathJax may break a long inline formula at its operators
 * (mjx-break); a chart label stays on one line. 6.2.1: each such space
 * gets its width as a box of its own, so it does not wait for a font.
 */
function oneLine(el: HTMLElement): void {
    for (const b of Array.from(el.querySelectorAll<HTMLElement>('mjx-break'))) {
        const em = BREAK_EM[b.getAttribute('size') ?? ''];
        b.setCssStyles(em === undefined ? { whiteSpace: 'nowrap' } : { whiteSpace: 'nowrap', display: 'inline-block', width: `${em}em` });
    }
}

/** The size of a label element, measured in the offscreen host. Throws for an empty render. */
function measure(el: HTMLElement): { width: number; height: number } {
    const host = getMeasureHost();
    host.appendChild(el);
    const rect = el.getBoundingClientRect();
    host.removeChild(el);
    if (rect.width === 0 && rect.height === 0) throw new Error('MathJax produced an empty render');
    return { width: rect.width, height: rect.height };
}

/** Resolves when the fonts the document asked for so far have loaded (MathJax's glyph fonts load on first use). */
function fontsLoaded(): Promise<void> {
    // Test documents have no FontFaceSet: nothing to wait for there.
    if (!('fonts' in activeDocument)) return Promise.resolve();
    const done = (): void => undefined;
    return activeDocument.fonts.ready.then(done, done);
}

/**
 * Flush MathJax's stylesheet into the document. Call once per render pass
 * after all `renderMathLabel` calls for that pass, per Obsidian's API
 * contract - safe to call even when nothing was rendered.
 *
 * Resolves once the stylesheet and the fonts are in place: with true when
 * the pass drew a label with a size other than the one it has now (a new
 * formula, a new size or colour measured before its glyphs were styled),
 * so drawing the chart again now gives that label its real box; with false
 * otherwise.
 */
export function flushMathRenders(): Promise<boolean> {
    const handed = labels.beginFlush();
    const done = (): boolean => labels.settle(handed);
    return finishRenderMath().then(fontsLoaded, fontsLoaded).then(done, done);
}

/** 6.2.1: the one load of MathJax this plugin asked for (Obsidian loads it lazily). */
let mathJaxLoad: Promise<void> | null = null;
let mathJaxLoaded = false;

/**
 * 6.2.1: Obsidian loads MathJax only when something renders math, and
 * renderMath() throws until then, so a chart in a note with no other math
 * drew its `$...$` labels as plain text (x^* = 1/4) until the editor opened.
 * A render whose math label failed calls this: it loads MathJax and
 * resolves with true when the chart should be drawn again (MathJax was not
 * loaded yet), false otherwise (the formula itself cannot be read).
 */
export function ensureMathJax(): Promise<boolean> {
    if (mathJaxLoaded) return Promise.resolve(false);
    if (!mathJaxLoad) {
        mathJaxLoad = loadMathJax().then(() => {
            mathJaxLoaded = true;
        });
    }
    return mathJaxLoad.then(
        () => true,
        () => false
    );
}
