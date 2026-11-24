/*
 * The pixel layers of 6.0 E in the preview: a <foreignObject> over the
 * plot rectangle holding a <canvas>. The GPU paints it at once (gl.ts);
 * without the GPU (no WebGL, a formula with no GLSL form, a zoom past
 * 32-bit floats) the CPU paints it 64-bit: a coarse picture at once, then
 * the full one in tiles over animation frames, a few milliseconds each, so
 * typing never waits. A finished picture (the CPU's, or a settled one of the
 * GPU) is kept by its key, view and size, so a redraw that changes nothing
 * of it (a point dragged over a fractal) shows it at once. A tile job
 * stops when its canvas leaves the page (a newer drawing replaced it).
 *
 * exportableSvg (src/svgExport.ts) swaps each layer for an <image> with a
 * PNG painted on the CPU (pixelImage), for Copy SVG / PNG and SVG files.
 */
import type { View } from '../geometry';
import type { PixelPrim } from './pixels';
import { paintAll } from './pixels';
import { drawGpu, gpuFits } from './gl';
import { MAX_EMBED_SIDE, pngDataUrl } from './export';
import { encodePng } from './png';

/** The time the CPU paints in one animation frame at most (ms). */
const FRAME_BUDGET_MS = 10;
/** The coarse picture is this many times smaller per side (draft frames: COARSE_DRAFT). */
const COARSE = 6;
const COARSE_DRAFT = 4;
/** Finished pictures kept (CPU, and settled GPU ones). */
const KEEP = 6;
/** Canvas pixels per pixel of the drawing at most (sharper on high-density screens). */
const MAX_DENSITY = 2;

interface Layer {
    prim: PixelPrim;
    view: View;
    w: number;
    h: number;
}

/** What each layer element draws, for exportableSvg. */
const LAYERS = new WeakMap<Element, Layer>();

interface Job {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    prim: PixelPrim;
    view: View;
    w: number;
    h: number;
    image: ImageData;
    /** The next row (or column) to paint, and the band size. */
    next: number;
    band: number;
    key: string;
    seen: boolean;
    frames: number;
}

const jobs: Job[] = [];
let frame = 0;
/** Finished pictures by key, view and size: a canvas each (a drawing replaced by a newer one keeps its canvas). */
const done = new Map<string, HTMLCanvasElement>();

function keyOf(prim: PixelPrim, view: View, w: number, h: number): string {
    return `${prim.key}|${view.xmin},${view.xmax},${view.ymin},${view.ymax}|${w}x${h}`;
}

function keep(key: string, picture: HTMLCanvasElement): void {
    done.delete(key);
    done.set(key, picture);
    while (done.size > KEEP) {
        const first = done.keys().next().value;
        if (first === undefined) break;
        done.delete(first);
    }
}

function schedule(): void {
    if (frame || !jobs.length) return;
    frame = window.requestAnimationFrame(run);
}

/** One frame of CPU painting: the newest job first, within the budget. */
function run(): void {
    frame = 0;
    const start = performance.now();
    for (let i = jobs.length - 1; i >= 0; i--) {
        const job = jobs[i];
        job.frames++;
        if (job.canvas.isConnected) job.seen = true;
        // Gone from the page (replaced by a newer drawing), or never shown.
        if ((job.seen && !job.canvas.isConnected) || (!job.seen && job.frames > 30)) {
            jobs.splice(i, 1);
            continue;
        }
        const total = job.prim.columns ? job.w : job.h;
        while (job.next < total && performance.now() - start < FRAME_BUDGET_MS) {
            const a = job.next;
            const b = Math.min(total, a + job.band);
            const t0 = performance.now();
            const buf = job.image.data;
            if (job.prim.columns) job.prim.tile(job.view, job.w, job.h, a, 0, b, job.h, buf);
            else job.prim.tile(job.view, job.w, job.h, 0, a, job.w, b, buf);
            if (job.prim.columns) job.ctx.putImageData(job.image, 0, 0, a, 0, b - a, job.h);
            else job.ctx.putImageData(job.image, 0, 0, 0, a, job.w, b - a);
            job.next = b;
            // About 3 ms a band.
            const took = performance.now() - t0;
            job.band = Math.max(1, Math.min(64, Math.round((job.band * 3) / Math.max(0.2, took))));
        }
        if (job.next >= total) {
            jobs.splice(i, 1);
            if (job.canvas.isConnected || !job.seen) keep(job.key, job.canvas);
        }
        if (performance.now() - start >= FRAME_BUDGET_MS) break;
    }
    schedule();
}

/** A coarse picture now: the layer at 1/k of its size, scaled up. */
function coarse(ctx: CanvasRenderingContext2D, prim: PixelPrim, view: View, w: number, h: number, k: number): void {
    const cw = Math.max(1, Math.ceil(w / k));
    const ch = Math.max(1, Math.ceil(h / k));
    const small = createEl('canvas');
    small.width = cw;
    small.height = ch;
    const sctx = small.getContext('2d');
    if (!sctx) return;
    const img = sctx.createImageData(cw, ch);
    prim.tile(view, cw, ch, 0, 0, cw, ch, img.data);
    sctx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, w, h);
}

/** Paint a layer into its canvas: from the kept pictures, the GPU, or the CPU (coarse now, then in tiles). */
function paint(canvas: HTMLCanvasElement, prim: PixelPrim, view: View, draft: boolean): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const key = keyOf(prim, view, w, h);
    const kept = done.get(key);
    if (kept) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(kept, 0, 0);
        return;
    }
    if (drawGpu(prim, view, w, h, ctx)) {
        // A settled picture is kept: a drag of something else (a point on it) draws it from here.
        if (!draft) {
            const copy = createEl('canvas');
            copy.width = w;
            copy.height = h;
            copy.getContext('2d')?.drawImage(canvas, 0, 0);
            keep(key, copy);
        }
        return;
    }
    coarse(ctx, prim, view, w, h, draft ? COARSE_DRAFT : COARSE);
    // A draft frame (a slider or a drag on the move) keeps the coarse picture: the settled frame paints in full.
    if (draft) return;
    const image = ctx.getImageData(0, 0, w, h);
    jobs.push({ canvas, ctx, prim, view, w, h, image, next: 0, band: 4, key, seen: false, frames: 0 });
    // Older jobs of the same picture make way.
    if (jobs.length > 6) jobs.splice(0, jobs.length - 6);
    schedule();
}

/**
 * The layer of `prim` over the plot rectangle (SVG units), painted now or
 * soon. `density` is the canvas pixels per unit of the drawing (screen
 * density; less for the CPU).
 */
export function pixelLayer(prim: PixelPrim, view: View, rect: { x: number; y: number; w: number; h: number }, draft: boolean): SVGForeignObjectElement {
    const fo = createSvg('foreignObject', { cls: 'etz-pixels', attr: { x: String(rect.x), y: String(rect.y), width: String(rect.w), height: String(rect.h) } });
    if (prim.opacity < 1) fo.setAttribute('opacity', String(Math.max(0, prim.opacity)));
    const canvas = fo.createEl('canvas', { cls: 'etz-pixels-canvas' });
    const dpr = Math.max(1, Math.min(MAX_DENSITY, window.devicePixelRatio || 1));
    // The CPU paints one canvas pixel per unit; the GPU as sharp as the screen.
    const density = prim.shader && gpuFits(view, rect.w * dpr, rect.h * dpr) ? dpr : 1;
    canvas.width = Math.max(1, Math.round(rect.w * density));
    canvas.height = Math.max(1, Math.round(rect.h * density));
    LAYERS.set(fo, { prim, view, w: rect.w, h: rect.h });
    paint(canvas, prim, view, draft);
    return fo;
}

/** The picture of a layer element as an <image> (a PNG painted on the CPU), or null for another element. */
export function pixelImage(original: Element): SVGImageElement | null {
    const layer = LAYERS.get(original);
    if (!layer) return null;
    const k = Math.min(1, MAX_EMBED_SIDE / Math.max(layer.w, layer.h));
    const w = Math.max(1, Math.round(layer.w * k));
    const h = Math.max(1, Math.round(layer.h * k));
    const png = encodePng(paintAll(layer.prim, layer.view, w, h), w, h);
    const img = createSvg('image');
    for (const a of ['x', 'y', 'width', 'height']) img.setAttribute(a, original.getAttribute(a) ?? '0');
    img.setAttribute('preserveAspectRatio', 'none');
    img.setAttribute('href', pngDataUrl(png));
    return img;
}
