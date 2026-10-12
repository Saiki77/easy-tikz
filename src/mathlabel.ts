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
 * MathJax's SVG output looks visually smaller than plain text set at the
 * same CSS font-size - TeX math fonts have a smaller x-height and MathJax
 * bakes in its own internal compaction. The `fontSizePx` values passed in
 * come from the plain `stripLatex()` label sizes (tuned for SVG `<text>`
 * glyphs), so boost them here to make the two paths look comparable.
 */
const MATH_SIZE_MULTIPLIER = 1.8;

/**
 * Rendered and measured labels by (font size, colour, source). Slider drags
 * re-render the chart every frame, and measuring forces a layout per label,
 * so repeated labels are served as clones of an earlier render. MathJax adds
 * the CSS for new glyphs only when the render pass is flushed, so a label
 * measured before that can have the wrong size: an entry is served only once
 * it was measured after a flush had completed (`verified`); until then every
 * call measures again. Map order is the LRU order (oldest first).
 */
interface CachedLabel extends MathLabel {
    verified: boolean;
    /** completedFlushes when this entry was measured. */
    generation: number;
}
const renderCache = new Map<string, CachedLabel>();
const RENDER_CACHE_SIZE = 200;
let completedFlushes = 0;

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
    renderCache.delete(key);
    renderCache.set(key, {
        el: label.el.cloneNode(true) as HTMLElement,
        width: label.width,
        height: label.height,
        verified: !!hit && completedFlushes > hit.generation,
        generation: completedFlushes,
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

/**
 * Flush MathJax's stylesheet into the document. Call once per render pass
 * after all `renderMathLabel` calls for that pass, per Obsidian's API
 * contract - safe to call even when nothing was rendered.
 */
export function flushMathRenders(): void {
    const done = () => {
        completedFlushes++;
    };
    finishRenderMath().then(done, done);
}
