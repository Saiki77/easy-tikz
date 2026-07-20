import { renderMath, finishRenderMath } from 'obsidian';

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
 * If `text`, once trimmed, is entirely one `$...$` or `\(...\)` wrapped
 * expression, return the LaTeX source inside the delimiters. Otherwise null.
 */
export function extractMathSource(text: string): string | null {
    const t = text.trim();
    if (t.length < 2) return null;
    if (t.startsWith('$') && t.endsWith('$')) {
        const inner = t.slice(1, -1);
        if (inner.length > 0 && !inner.includes('$')) return inner;
        return null;
    }
    const m = /^\\\(([\s\S]*)\\\)$/.exec(t);
    return m ? m[1] : null;
}

// Offscreen host used to measure MathJax's rendered size before it's
// inserted into the (possibly still-detached) plot SVG.
let measureHost: HTMLDivElement | null = null;
function getMeasureHost(): HTMLDivElement {
    if (!measureHost || !measureHost.isConnected) {
        measureHost = document.createElement('div');
        measureHost.style.cssText =
            'position:fixed; left:-99999px; top:-99999px; visibility:hidden; pointer-events:none;';
        document.body.appendChild(measureHost);
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

/** Render `mathSource` with MathJax and measure the result. Throws if MathJax rejects the source. */
export function renderMathLabel(mathSource: string, color: string, fontSizePx: number): MathLabel {
    const el = renderMath(mathSource, false);
    el.style.color = color;
    el.style.fontSize = `${fontSizePx * MATH_SIZE_MULTIPLIER}px`;
    el.style.display = 'inline-block';
    el.style.pointerEvents = 'none';
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
    void finishRenderMath();
}
