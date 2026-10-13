import { renderMath, finishRenderMath } from 'obsidian';
import { labelMathSource } from './mathcontext';

/**
 * Real LaTeX rendering for annotation/title/legend text, layered on top of
 * the `stripLatex()` approximation in `util.ts`. When a text field is a
 * single `$...$` or `\(...\)` wrapped expression, we hand it to Obsidian's
 * own MathJax instance (the same one used for `$...$` in notes) instead of
 * approximating it with Unicode substitutions. Anything else - plain prose,
 * mixed text, or math without delimiters - keeps using the cheap
 * stripLatex() path, since MathJax expects a whole string of LaTeX source,
 * not a mix of prose and math.
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
        measureHost = activeDocument.body.createEl('div', { cls: 'easy-tikz-measure-host' });
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
 * Rendered and measured labels by (font size, colour, source). Slider drags
 * re-render the chart every frame, and measuring forces a layout per label,
 * so repeated labels are served as clones of an earlier render. MathJax adds
 * the CSS for new glyphs only when the render pass is flushed, and the
 * browser loads their fonts only after that, so a label measured earlier can
 * have the wrong size: an entry is served only once a measurement after a
 * later flush gave the same size as the one before it (`verified`); until
 * then every call measures again, and flushMathRenders tells the caller to
 * draw once more. Map order is the LRU order (oldest first).
 */
interface CachedLabel extends MathLabel {
    verified: boolean;
    /** completedFlushes when this entry was measured. */
    generation: number;
    /** Measurements made after a later flush that still disagreed with the one before. */
    retries: number;
}
const renderCache = new Map<string, CachedLabel>();
const RENDER_CACHE_SIZE = 200;
/** A size that keeps changing is accepted after this many re-measurements, so redraws always end. */
const MAX_RETRIES = 3;
/** Two measurements agree within this many px. */
const SIZE_TOLERANCE = 0.05;
let completedFlushes = 0;
/** A label of the current render pass was handed out with a size that is not verified yet. */
let unverifiedInPass = false;

/**
 * How often in a row a chart may be drawn again because flushMathRenders
 * asked for it. Two redraws settle a new label; the limit only ends the
 * chain for a chart with more distinct labels than the cache holds, whose
 * labels never count as verified.
 */
export const MATH_REDRAW_LIMIT = 4;

/**
 * Render `mathSource` with MathJax and measure the result. Throws if MathJax
 * rejects the source. Every call returns a fresh element (callers insert it
 * into their own SVG).
 */
export function renderMathLabel(mathSource: string, color: string, fontSizePx: number): MathLabel {
    const key = `${fontSizePx}|${color}|${mathSource}`;
    const hit = renderCache.get(key);
    if (hit && hit.verified) {
        renderCache.delete(key);
        renderCache.set(key, hit);
        return { el: hit.el.cloneNode(true) as HTMLElement, width: hit.width, height: hit.height };
    }
    const label = renderAndMeasure(mathSource, color, fontSizePx);
    // Only a measurement after a later flush can confirm (or correct) the entry.
    const later = !!hit && completedFlushes > hit.generation;
    const same = !!hit && Math.abs(hit.width - label.width) <= SIZE_TOLERANCE && Math.abs(hit.height - label.height) <= SIZE_TOLERANCE;
    const retries = hit ? hit.retries + (later && !same ? 1 : 0) : 0;
    const verified = later && (same || retries >= MAX_RETRIES);
    if (!verified) unverifiedInPass = true;
    renderCache.delete(key);
    renderCache.set(key, {
        el: label.el.cloneNode(true) as HTMLElement,
        width: label.width,
        height: label.height,
        verified,
        generation: completedFlushes,
        retries,
    });
    if (renderCache.size > RENDER_CACHE_SIZE) {
        const oldest = renderCache.keys().next();
        if (!oldest.done) renderCache.delete(oldest.value);
    }
    return label;
}

function renderAndMeasure(mathSource: string, color: string, fontSizePx: number): MathLabel {
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
    const host = getMeasureHost();
    host.appendChild(el);
    const rect = el.getBoundingClientRect();
    host.removeChild(el);
    if (rect.width === 0 && rect.height === 0) throw new Error('MathJax produced an empty render');
    return { el, width: rect.width, height: rect.height };
}

/** Resolves when the fonts the document asked for so far have loaded (MathJax's glyph fonts load on first use). */
function fontsLoaded(): Promise<void> {
    const fonts = activeDocument.fonts;
    if (!fonts || !fonts.ready) return Promise.resolve();
    const done = (): void => undefined;
    return fonts.ready.then(done, done);
}

/**
 * Flush MathJax's stylesheet into the document. Call once per render pass
 * after all `renderMathLabel` calls for that pass, per Obsidian's API
 * contract - safe to call even when nothing was rendered.
 *
 * Resolves once the stylesheet and the fonts are in place: with true when
 * the pass drew a label whose size was not verified yet (a new formula, a
 * new size or colour), so drawing the chart again now gives that label its
 * real box; with false when every label was served verified.
 */
export function flushMathRenders(): Promise<boolean> {
    const redraw = unverifiedInPass;
    unverifiedInPass = false;
    const done = (): boolean => {
        completedFlushes++;
        return redraw;
    };
    return finishRenderMath().then(fontsLoaded, fontsLoaded).then(done, done);
}
