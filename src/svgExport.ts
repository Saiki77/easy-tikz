/*
 * A rendered chart as a standalone picture: the clone of its <svg> with
 * everything that only works inside Obsidian's page replaced, and the PNG
 * made from it. Used by the editor's Copy SVG / Copy PNG and by the local AI
 * server's render_chart tool, so an AI app sees what the user sees.
 */
import { stripLatex } from './util';
import { t } from './i18n';

/**
 * A copy of `svg` that renders on its own: MathJax labels (foreignObject)
 * become plain text, the theme background goes, and CSS variables are
 * replaced by the values they have in `doc`. With `white`, the picture gets
 * a white background and the light theme's colours, also in a dark theme
 * (the setting "Copied images"), so it reads on paper.
 */
export function exportableSvg(svg: SVGElement, doc: Document, opts: { white?: boolean } = {}): SVGElement {
    const clone = svg.cloneNode(true) as SVGElement;
    clone.removeAttribute('class');
    clone.removeAttribute('style');

    // MathJax labels live in <foreignObject> nodes whose rendering
    // depends on MathJax's document-level stylesheet: serialized
    // standalone they'd show unstyled markup, and foreignObject content
    // breaks PNG rasterization. Swap each for the plain-text
    // stripLatex() approximation carried in its data attributes.
    clone.querySelectorAll('foreignObject[data-export-text]').forEach((fo) => {
        const t = createSvg('text');
        t.setAttribute('x', fo.getAttribute('data-export-x') || '0');
        t.setAttribute('y', fo.getAttribute('data-export-y') || '0');
        t.setAttribute('text-anchor', fo.getAttribute('data-export-anchor') || 'start');
        t.setAttribute('fill', fo.getAttribute('data-export-fill') || 'var(--text-normal)');
        t.setAttribute('font-size', fo.getAttribute('data-export-font-size') || '11');
        t.setAttribute('font-family', 'var(--font-text)');
        const weight = fo.getAttribute('font-weight');
        if (weight) t.setAttribute('font-weight', weight);
        t.textContent = stripLatex(fo.getAttribute('data-export-text') || '');
        fo.replaceWith(t);
    });

    // The background rect is the first child, fill="var(--background-primary)".
    const background = clone.querySelector(':scope > rect');
    if (background && (background.getAttribute('fill') ?? '').includes('--background-primary')) background.remove();

    const nodes: Element[] = [clone, ...Array.from(clone.querySelectorAll('*'))];
    const VAR = /var\((--[^,)]+)(?:,\s*([^)]+))?\)/g;
    const names = new Set<string>();
    for (const el of nodes) {
        for (const attrName of ['fill', 'stroke', 'font-family', 'stop-color', 'style']) {
            const v = el.getAttribute(attrName);
            if (v) for (const m of v.matchAll(VAR)) names.add(m[1]);
        }
    }
    // The values of the variables, read once. White in a dark theme: read them with the body in the light
    // theme for this one synchronous moment (the theme derives its colours on the body, so no child element
    // could carry them), then back; nothing is painted in between.
    const values = new Map<string, string>();
    const body = doc.body;
    const swap = !!opts.white && body.classList.contains('theme-dark');
    if (swap) body.classList.replace('theme-dark', 'theme-light');
    try {
        const computed = getComputedStyle(body);
        for (const name of names) values.set(name, computed.getPropertyValue(name).trim());
    } finally {
        if (swap) body.classList.replace('theme-light', 'theme-dark');
    }
    const resolveVars = (value: string): string =>
        value.replace(VAR, (_match: string, name: string, fallback: string | undefined) => values.get(name) || (fallback ? fallback.trim() : ''));
    for (const el of nodes) {
        el.removeAttribute('data-etz-item');
        for (const attrName of ['fill', 'stroke', 'font-family', 'stop-color']) {
            const v = el.getAttribute(attrName);
            if (v && v.includes('var(')) el.setAttribute(attrName, resolveVars(v));
        }
        const styleAttr = el.getAttribute('style');
        if (styleAttr && styleAttr.includes('var(')) el.setAttribute('style', resolveVars(styleAttr));
    }

    if (opts.white) {
        const box = (clone.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        const rect = createSvg('rect');
        if (box.length === 4 && box.every(Number.isFinite)) {
            rect.setAttribute('x', String(box[0]));
            rect.setAttribute('y', String(box[1]));
            rect.setAttribute('width', String(box[2]));
            rect.setAttribute('height', String(box[3]));
        } else {
            rect.setAttribute('width', '100%');
            rect.setAttribute('height', '100%');
        }
        rect.setAttribute('fill', '#ffffff');
        clone.insertBefore(rect, clone.firstChild);
    }

    // Proper xmlns so it renders standalone outside the page.
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    return clone;
}

/**
 * Rasterize an exportable SVG (see exportableSvg) at `scale` times its size.
 * `background` paints the canvas first (a theme colour); without it the PNG
 * is transparent, as Copy PNG has always been. Its error messages are in
 * the language of the call (the AI server calls it inside inEnglish).
 */
export async function svgToPng(svg: SVGElement, scale = 2, background?: string): Promise<Blob> {
    // Written before the first await, while the caller's language holds.
    const failed = { raster: t('problems.render.rasterFailed'), canvas: t('problems.render.noCanvas'), png: t('problems.render.pngFailed') };
    const svgString = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const width = parseFloat(svg.getAttribute('width') || '760');
    const height = parseFloat(svg.getAttribute('height') || '532');
    try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error(failed.raster));
            img.src = url;
        });
        const canvas = createEl('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error(failed.canvas);
        if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);
        const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!png) throw new Error(failed.png);
        return png;
    } finally {
        URL.revokeObjectURL(url);
    }
}
