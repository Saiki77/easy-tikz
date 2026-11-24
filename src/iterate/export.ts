/*
 * The pixel layers of 6.0 E in the export: each picture is painted on the
 * CPU (64-bit, src/iterate/pixels.ts), encoded as a PNG (png.ts) and drawn
 * with `\addplot graphics` over exactly the view, so the axes and labels
 * stay vector. The PNG files go to whoever collects them while the code is
 * made (collectExportFiles: the editor's Copy LaTeX saves them beside the
 * note, the tests write them beside the .tex file). Pure: no DOM.
 */
import type { View } from '../geometry';
import type { SceneItem2D } from '../scene';
import { fmtNum } from '../mathcontext';
import { paintAll } from './pixels';
import { base64, contentHash, encodePng } from './png';

/** A file the code needs beside it: a PNG of a coloured plane. */
export interface ExportFile {
    name: string;
    bytes: Uint8Array;
}

/** Dots per inch of the pictures in the PDF, and the most pixels they get (per side and in all). */
export const EXPORT_DPI = 150;
export const MAX_EXPORT_SIDE = 900;
export const MAX_EXPORT_PIXELS = 600000;
/** The SVG files and Copy SVG embed pictures of at most this many pixels per side. */
export const MAX_EMBED_SIDE = 800;

let sink: ExportFile[] | null = null;

/** Run `make` (the export) and get the files the code it makes needs. */
export function collectExportFiles<T>(make: () => T): { result: T; files: ExportFile[] } {
    const outer = sink;
    const files: ExportFile[] = [];
    sink = files;
    try {
        return { result: make(), files };
    } finally {
        sink = outer;
        if (outer) outer.push(...files);
    }
}

/** A picture's size in pixels for a plot of w x h pt at `dpi`, within the caps. */
export function pictureSize(wPt: number, hPt: number, dpi = EXPORT_DPI, maxSide = MAX_EXPORT_SIDE, maxPixels = MAX_EXPORT_PIXELS): { w: number; h: number } {
    let w = Math.max(16, Math.round((wPt / 72.27) * dpi));
    let h = Math.max(16, Math.round((hPt / 72.27) * dpi));
    const k = Math.min(1, maxSide / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
    w = Math.max(16, Math.round(w * k));
    h = Math.max(16, Math.round(h * k));
    return { w, h };
}

/** The last PNGs made (the editor's Code tab makes the code again after each change). */
const made = new Map<string, Uint8Array>();

/** The pictures of an item's pixel layers as PNGs. */
export function pixelPng(item: SceneItem2D, view: View, w: number, h: number): Uint8Array[] {
    return (item.pixels ?? []).map((prim) => {
        const key = `${prim.key}|${view.xmin},${view.xmax},${view.ymin},${view.ymax}|${w}x${h}`;
        let png = made.get(key);
        if (!png) {
            png = encodePng(paintAll(prim, view, w, h), w, h);
            made.set(key, png);
            while (made.size > 4) {
                const first = made.keys().next().value;
                if (first === undefined) break;
                made.delete(first);
            }
        }
        return png;
    });
}

/** A PNG as a data: URL (SVG files, Copy SVG). */
export function pngDataUrl(png: Uint8Array): string {
    return `data:image/png;base64,${base64(png)}`;
}

/**
 * The lines that draw an item's pictures in the axis: `\addplot graphics`
 * over the view, one PNG each (handed to the collector). `plot` is the
 * axis box in pt (labelMetricsFor), for the pictures' resolution.
 */
export function pixelsTikz(item: SceneItem2D, view: View, plot: { w: number; h: number }): string[] {
    if (!item.pixels || !item.pixels.length) return [];
    const { w, h } = pictureSize(plot.w, plot.h);
    const lines: string[] = [];
    for (const png of pixelPng(item, view, w, h)) {
        const name = `plane-${contentHash(png)}.png`;
        if (sink && !sink.some((f) => f.name === name)) sink.push({ name, bytes: png });
        lines.push(`% The picture ${name} (beside the .tex file)`);
        lines.push(`\\addplot[on layer=axis background, forget plot] graphics[xmin=${fmtNum(view.xmin)}, xmax=${fmtNum(view.xmax)}, ymin=${fmtNum(view.ymin)}, ymax=${fmtNum(view.ymax)}] {${name}};`);
    }
    return lines;
}
