/*
 * Hit index of drag to edit (SPEC3 4.6): every grabbable part of the drawn
 * 2D chart (scene handles and function curves) as a HitShape, and the pick
 * that decides what the pointer is over. Distances are measured in on-screen
 * CSS px (math deltas times kx / ky), so tolerances hold under unequal axis
 * scales. Lines are clipped to the view (plus 1 px, like the chart's clip
 * path): parts drawn outside it are invisible and cannot be grabbed.
 * Pure: no DOM, no Obsidian.
 */
import type { SceneItem2D } from '../scene';
import type { DrawnCurve } from '../renderer';
import type { Hit, HitIndex, HitPart, HitShape, HitTolerance, Pt, ScreenMap } from './types';

/** Draw layers (higher is drawn later, on top): function curves, tool lines, markers and vertices. */
const LAYER_CURVE = 400;
const LAYER_LINE = 500;
const LAYER_POINT = 600;
/** Segments per bounding box of the second prefilter level. */
const CHUNK = 16;
/** Lines whose distances differ by at most this many px are a tie: the one drawn on top wins. */
const LINE_TIE_PX = 1;
/** Points at the same distance (within this many px) are a tie: the one drawn on top wins. */
const POINT_TIE_PX = 1e-6;
/** Relative slack of the view test for markers (the renderer draws markers inside the view only). */
const VIEW_SLACK = 1e-9;

/** 'curve', 'clause:1:0:0', 'level:2', 'point:0', 'leg:1', 'vertex:3', 'tangent', 'extremum:0'. */
export function partKey(part: HitPart): string {
    switch (part.part) {
        case 'curve':
            return 'curve';
        case 'clause':
            return `clause:${part.entry}:${part.disjunct}:${part.clause}`;
        case 'tangent':
            return 'tangent';
        default:
            return `${part.part}:${part.index}`;
    }
}

/**
 * Function curves (itemKey 'fn:<name>', layer 400 + index), tool lines
 * (500 + item order), points (600 + item order). Decoration items of
 * functions use their SceneItem2D key. Building is cheap (no geometry is
 * touched); the line prefilter is built on the first pick.
 */
export function buildHitIndex(input: { items: readonly SceneItem2D[]; curves: readonly DrawnCurve[] }): HitIndex {
    const shapes: HitShape[] = [];
    for (const c of input.curves || []) {
        if (!c || !Array.isArray(c.lines)) continue;
        shapes.push({
            key: `fn:${c.name}#curve`,
            itemKey: `fn:${c.name}`,
            source: c.name,
            kind: 'function',
            part: { part: 'curve' },
            lines: c.lines,
            point: null,
            anchors: [],
            locked: null,
            layer: LAYER_CURVE + (Number.isFinite(c.index) ? c.index : 0),
        });
    }
    (input.items || []).forEach((item, order) => {
        for (const h of (item && item.handles) || []) {
            shapes.push({
                key: `${item.key}#${partKey(h.ref)}`,
                itemKey: item.key,
                source: item.source,
                kind: item.kind,
                part: h.ref,
                lines: h.lines || [],
                point: h.point || null,
                anchors: h.anchors || [],
                locked: h.locked || null,
                layer: (h.point ? LAYER_POINT : LAYER_LINE) + order,
            });
        }
    });
    return new Index(shapes);
}

// ------------------------------------------------------------- internals

/** One polyline of a line shape with its prefilter boxes. */
interface Poly {
    pts: Pt[];
    /** Index in shape.lines. */
    run: number;
    /** Per chunk of CHUNK segments: xmin, ymin, xmax, ymax over its finite points (Infinity bounds when none). */
    boxes: Float64Array;
    box: Box;
}

interface Box {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
}

interface LineShape {
    shape: HitShape;
    polys: Poly[];
    box: Box;
}

function emptyBox(): Box {
    return { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity };
}

function misses(b: Box, q: Box): boolean {
    return b.xmin > q.xmax || b.xmax < q.xmin || b.ymin > q.ymax || b.ymax < q.ymin;
}

function finitePt(p: Pt | null | undefined): p is Pt {
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function buildPoly(pts: Pt[], run: number): Poly | null {
    const n = pts.length;
    if (n < 2) return null;
    const chunks = Math.ceil((n - 1) / CHUNK);
    const boxes = new Float64Array(4 * chunks);
    const box = emptyBox();
    for (let k = 0; k < chunks; k++) {
        let xmin = Infinity;
        let ymin = Infinity;
        let xmax = -Infinity;
        let ymax = -Infinity;
        const end = Math.min((k + 1) * CHUNK, n - 1);
        for (let i = k * CHUNK; i <= end; i++) {
            const p = pts[i];
            if (!finitePt(p)) continue;
            if (p.x < xmin) xmin = p.x;
            if (p.x > xmax) xmax = p.x;
            if (p.y < ymin) ymin = p.y;
            if (p.y > ymax) ymax = p.y;
        }
        boxes[4 * k] = xmin;
        boxes[4 * k + 1] = ymin;
        boxes[4 * k + 2] = xmax;
        boxes[4 * k + 3] = ymax;
        if (xmin < box.xmin) box.xmin = xmin;
        if (ymin < box.ymin) box.ymin = ymin;
        if (xmax > box.xmax) box.xmax = xmax;
        if (ymax > box.ymax) box.ymax = ymax;
    }
    return box.xmin <= box.xmax ? { pts, run, boxes, box } : null;
}

/** Nearest point of one shape's lines (clipped to `clip`) to p, in px. */
interface Near {
    d: number;
    x: number;
    y: number;
    run: number;
}

class Index implements HitIndex {
    private readonly shapes: HitShape[];
    private readonly keyed = new Map<string, HitShape>();
    private readonly pointShapes: HitShape[];
    private lineShapes: LineShape[] | null = null;

    constructor(shapes: HitShape[]) {
        this.shapes = shapes;
        for (const s of shapes) if (!this.keyed.has(s.key)) this.keyed.set(s.key, s);
        this.pointShapes = shapes.filter((s) => s.point !== null);
    }

    byKey(key: string): HitShape | null {
        return this.keyed.get(key) || null;
    }

    points(): readonly HitShape[] {
        return this.pointShapes;
    }

    all(): readonly HitShape[] {
        return this.shapes;
    }

    /**
     * Unlocked points within tol.point first (nearest, then higher layer);
     * else lines within tol.line (nearest; ties within 1 px: higher layer).
     * A locked point within tol.point becomes `passed` of that result, or the
     * result itself (locked) when nothing draggable is in range.
     */
    pick(p: Pt, tol: HitTolerance, map: ScreenMap): Hit | null {
        const { kx, ky, view } = map;
        if (!finitePt(p) || !(kx > 0) || !(ky > 0) || !Number.isFinite(kx) || !Number.isFinite(ky)) return null;
        if (!view || !(view.xmax > view.xmin) || !(view.ymax > view.ymin)) return null;
        const tolPoint = Math.max(0, tol.point);
        const tolLine = Math.max(0, tol.line);

        // Markers are drawn inside the view only.
        const sx = (view.xmax - view.xmin) * VIEW_SLACK;
        const sy = (view.ymax - view.ymin) * VIEW_SLACK;
        let free: HitShape | null = null;
        let freeD = Infinity;
        let locked: HitShape | null = null;
        let lockedD = Infinity;
        for (const s of this.pointShapes) {
            const q = s.point;
            if (!finitePt(q)) continue;
            if (q.x < view.xmin - sx || q.x > view.xmax + sx || q.y < view.ymin - sy || q.y > view.ymax + sy) continue;
            const d = Math.hypot((q.x - p.x) * kx, (q.y - p.y) * ky);
            if (!(d <= tolPoint)) continue;
            if (s.locked) {
                if (better(d, s.layer, lockedD, locked ? locked.layer : -Infinity, POINT_TIE_PX)) {
                    locked = s;
                    lockedD = d;
                }
            } else if (better(d, s.layer, freeD, free ? free.layer : -Infinity, POINT_TIE_PX)) {
                free = s;
                freeD = d;
            }
        }
        if (free && free.point) return { shape: free, at: { x: free.point.x, y: free.point.y }, run: -1, distPx: freeD, passed: locked };

        const line = this.pickLine(p, tolLine, map);
        if (line) return { shape: line.shape, at: { x: line.near.x, y: line.near.y }, run: line.near.run, distPx: line.near.d, passed: locked };

        if (locked && locked.point) return { shape: locked, at: { x: locked.point.x, y: locked.point.y }, run: -1, distPx: lockedD, passed: null };
        return null;
    }

    private pickLine(p: Pt, tol: number, map: ScreenMap): { shape: HitShape; near: Near } | null {
        const { kx, ky, view } = map;
        // The chart clips lines to the plot plus 1 px.
        const clip: Box = { xmin: view.xmin - 1 / kx, xmax: view.xmax + 1 / kx, ymin: view.ymin - 1 / ky, ymax: view.ymax + 1 / ky };
        const query: Box = { xmin: p.x - tol / kx, xmax: p.x + tol / kx, ymin: p.y - tol / ky, ymax: p.y + tol / ky };
        if (misses(clip, query)) return null;
        const found: Array<{ shape: HitShape; near: Near }> = [];
        for (const ls of this.lines()) {
            if (ls.shape.locked || misses(ls.box, query)) continue;
            const near = nearestOnShape(ls, p, kx, ky, clip, query, tol);
            if (near) found.push({ shape: ls.shape, near });
        }
        if (!found.length) return null;
        let dmin = Infinity;
        for (const f of found) dmin = Math.min(dmin, f.near.d);
        let best: { shape: HitShape; near: Near } | null = null;
        for (const f of found) {
            if (f.near.d > dmin + LINE_TIE_PX) continue;
            if (!best || f.shape.layer > best.shape.layer || (f.shape.layer === best.shape.layer && f.near.d < best.near.d)) best = f;
        }
        return best;
    }

    private lines(): LineShape[] {
        if (this.lineShapes) return this.lineShapes;
        const out: LineShape[] = [];
        for (const shape of this.shapes) {
            const polys: Poly[] = [];
            const box = emptyBox();
            (shape.lines || []).forEach((pts, run) => {
                const poly = Array.isArray(pts) ? buildPoly(pts, run) : null;
                if (!poly) return;
                polys.push(poly);
                box.xmin = Math.min(box.xmin, poly.box.xmin);
                box.ymin = Math.min(box.ymin, poly.box.ymin);
                box.xmax = Math.max(box.xmax, poly.box.xmax);
                box.ymax = Math.max(box.ymax, poly.box.ymax);
            });
            if (polys.length) out.push({ shape, polys, box });
        }
        this.lineShapes = out;
        return out;
    }
}

/** d1 (layer l1) beats the current best d0 (layer l0): nearer, or a tie drawn on top. */
function better(d1: number, l1: number, d0: number, l0: number, tie: number): boolean {
    if (d1 < d0 - tie) return true;
    if (d1 > d0 + tie) return false;
    return l1 > l0 || (l1 === l0 && d1 < d0);
}

/** Nearest point within `tol` px on a shape's polylines, each segment clipped to `clip`; null when none is in range. */
function nearestOnShape(ls: LineShape, p: Pt, kx: number, ky: number, clip: Box, query: Box, tol: number): Near | null {
    let bestD = Infinity;
    let bestX = 0;
    let bestY = 0;
    let bestRun = -1;
    for (const poly of ls.polys) {
        if (misses(poly.box, query)) continue;
        const pts = poly.pts;
        const n = pts.length;
        const boxes = poly.boxes;
        const chunks = boxes.length / 4;
        for (let k = 0; k < chunks; k++) {
            if (boxes[4 * k] > query.xmax || boxes[4 * k + 2] < query.xmin || boxes[4 * k + 1] > query.ymax || boxes[4 * k + 3] < query.ymin) continue;
            const end = Math.min((k + 1) * CHUNK, n - 1);
            for (let i = k * CHUNK; i < end; i++) {
                const a = pts[i];
                const b = pts[i + 1];
                if (!finitePt(a) || !finitePt(b)) continue;
                // Segment box against the query box.
                if ((a.x > query.xmax && b.x > query.xmax) || (a.x < query.xmin && b.x < query.xmin)) continue;
                if ((a.y > query.ymax && b.y > query.ymax) || (a.y < query.ymin && b.y < query.ymin)) continue;
                // Liang-Barsky: the visible parameter range [t0, t1] of the segment.
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                let t0 = 0;
                let t1 = 1;
                if (dx === 0) {
                    if (a.x < clip.xmin || a.x > clip.xmax) continue;
                } else {
                    const ta = (clip.xmin - a.x) / dx;
                    const tb = (clip.xmax - a.x) / dx;
                    t0 = Math.max(t0, Math.min(ta, tb));
                    t1 = Math.min(t1, Math.max(ta, tb));
                }
                if (dy === 0) {
                    if (a.y < clip.ymin || a.y > clip.ymax) continue;
                } else {
                    const ta = (clip.ymin - a.y) / dy;
                    const tb = (clip.ymax - a.y) / dy;
                    t0 = Math.max(t0, Math.min(ta, tb));
                    t1 = Math.min(t1, Math.max(ta, tb));
                }
                if (t0 > t1) continue;
                // Nearest point in px (the projection depends on the axis scales), kept inside the visible range.
                const ux = dx * kx;
                const uy = dy * ky;
                const wx = (p.x - a.x) * kx;
                const wy = (p.y - a.y) * ky;
                const uu = ux * ux + uy * uy;
                let t = uu > 0 ? (wx * ux + wy * uy) / uu : 0;
                if (t < t0) t = t0;
                else if (t > t1) t = t1;
                const ex = wx - t * ux;
                const ey = wy - t * uy;
                const d = Math.sqrt(ex * ex + ey * ey);
                if (d < bestD) {
                    bestD = d;
                    bestX = a.x + t * dx;
                    bestY = a.y + t * dy;
                    bestRun = poly.run;
                }
            }
        }
    }
    return bestD <= tol ? { d: bestD, x: bestX, y: bestY, run: bestRun } : null;
}
