/*
 * 6.0 G: the objects GeoGebra's lines draw, as numbers: circles, segments,
 * lines, rays, vectors, polygons, polylines, curves, functions of x and
 * texts, besides the values of part A (points, lists of points). The
 * geometry the scene needs (a line cut to the view, a circle through three
 * points, a regular polygon, the reflection in a line) and the transforms
 * of objects (Translate, Rotate, Dilate, Reflect). Pure: no DOM, no
 * Obsidian.
 */
import type { Value } from '../values/types';

/** An object of a GeoGebra line, in numbers (points are arrays of 2 or 3 numbers). */
export type GObj =
    | { k: 'value'; v: Value }
    | { k: 'function'; f: (x: number) => number; from: number; to: number }
    | { k: 'circle'; c: number[]; r: number }
    | { k: 'segment' | 'line' | 'ray' | 'vector'; a: number[]; b: number[] }
    | { k: 'polygon' | 'polyline' | 'curve'; pts: number[][] }
    | { k: 'text'; text: string; at: number[] };

/** A map of points, and how much it scales lengths (for a circle's radius). */
export interface PointMap {
    f: (p: number[]) => number[] | null;
    scale: number;
}

/** The object moved by a map of points; null when a point has no image. Functions are drawn as their curve then (`curve` samples it). */
export function mapObject(o: GObj, m: PointMap, curve: (o: Extract<GObj, { k: 'function' }>) => number[][], mapValue: (v: Value) => Value): GObj | null {
    const all = (pts: number[][]) => {
        const out: number[][] = [];
        for (const p of pts) {
            const q = m.f(p);
            if (!q) return null;
            out.push(q);
        }
        return out;
    };
    switch (o.k) {
        case 'value':
            return { k: 'value', v: mapValue(o.v) };
        case 'function': {
            const pts = all(curve(o).filter((p) => p.every(Number.isFinite)));
            return pts ? { k: 'curve', pts } : null;
        }
        case 'circle': {
            const c = m.f(o.c);
            return c ? { k: 'circle', c, r: o.r * Math.abs(m.scale) } : null;
        }
        case 'segment':
        case 'line':
        case 'ray':
        case 'vector': {
            const a = m.f(o.a);
            const b = m.f(o.b);
            return a && b ? { k: o.k, a, b } : null;
        }
        case 'polygon':
        case 'polyline':
        case 'curve': {
            const pts = all(o.pts);
            return pts ? { k: o.k, pts } : null;
        }
        case 'text': {
            const at = m.f(o.at);
            return at ? { k: 'text', text: o.text, at } : null;
        }
    }
}

/** The reflection in the line through a and b (2D; z kept). */
export function reflectInLine(a: number[], b: number[]): PointMap | null {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (!(len2 > 0)) return null;
    return {
        scale: 1,
        f: (p) => {
            const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
            const fx = a[0] + t * dx;
            const fy = a[1] + t * dy;
            return [2 * fx - p[0], 2 * fy - p[1], ...p.slice(2)];
        },
    };
}

/** The circle through three points; null when they lie on a line. */
export function circleThrough(a: number[], b: number[], c: number[]): { c: number[]; r: number } | null {
    const [ax, ay] = a;
    const [bx, by] = b;
    const [cx, cy] = c;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (!d || !Number.isFinite(d)) return null;
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
}

/** The regular polygon of n corners on the side a b, counterclockwise (GeoGebra's Polygon(A, B, n)). */
export function regularPolygon(a: number[], b: number[], n: number): number[][] {
    const out = [a.slice(0, 2), b.slice(0, 2)];
    const turn = (2 * Math.PI) / n;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    for (let k = 2; k < n; k++) {
        const p = out[k - 2];
        const q = out[k - 1];
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        out.push([q[0] + cos * dx - sin * dy, q[1] + sin * dx + cos * dy]);
    }
    return out;
}

/** The points of a circle, closed, in `n` steps. */
export function circlePoints(c: number[], r: number, n = 180): number[][] {
    const out: number[][] = [];
    for (let i = 0; i <= n; i++) {
        const t = (2 * Math.PI * i) / n;
        out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
    }
    return out;
}

interface Box {
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
}

/**
 * The part of the line a + t (b - a) inside the box (a little larger than
 * the view), for t from `lo` on (0: a ray, -Infinity: a line); null when it
 * misses the box.
 */
export function clipLine(a: number[], b: number[], view: Box, lo: number): [number[], number[]] | null {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (!(Math.hypot(dx, dy) > 0)) return null;
    const padX = (view.xmax - view.xmin) * 0.05;
    const padY = (view.ymax - view.ymin) * 0.05;
    let t0 = lo;
    let t1 = Infinity;
    const edges: Array<[number, number]> = [
        [-dx, a[0] - (view.xmin - padX)],
        [dx, view.xmax + padX - a[0]],
        [-dy, a[1] - (view.ymin - padY)],
        [dy, view.ymax + padY - a[1]],
    ];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return null;
            continue;
        }
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
    }
    if (!(t0 < t1) || !Number.isFinite(t0) || !Number.isFinite(t1)) return null;
    return [
        [a[0] + t0 * dx, a[1] + t0 * dy],
        [a[0] + t1 * dx, a[1] + t1 * dy],
    ];
}

/**
 * A function's graph over [from, to] in `n` steps, cut where it has no
 * value or jumps far out of the view (a pole), as runs of points.
 */
export function graphRuns(f: (x: number) => number, from: number, to: number, view: Box, n = 400): number[][][] {
    const runs: number[][][] = [];
    let run: number[][] = [];
    const h = view.ymax - view.ymin;
    const far = 20 * h;
    let prev: number | null = null;
    for (let i = 0; i <= n; i++) {
        const x = from + ((to - from) * i) / n;
        const y = f(x);
        const ok = Number.isFinite(y) && y > view.ymin - far && y < view.ymax + far;
        if (!ok || (prev !== null && Math.abs(y - prev) > 4 * h && (y - view.ymax) * (prev - view.ymin) < 0)) {
            if (run.length > 1) runs.push(run);
            run = [];
            prev = null;
            if (!ok) continue;
        }
        run.push([x, y]);
        prev = y;
    }
    if (run.length > 1) runs.push(run);
    return runs;
}
