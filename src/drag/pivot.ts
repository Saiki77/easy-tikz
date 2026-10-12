/*
 * Pivot ⊕ for Shift-drags (SPEC3 1.6, D9): candidates per object class and
 * the choice among them. Straight objects prefer markers and corners on the
 * line, then natural pivots of single numbers, then intercepts, then the far
 * end; open curves take the candidate that changes the fewest numbers
 * (graphs, and clauses or equations in graph form, like graphs along their
 * output axis; other implicit curves at the points where their tangent is
 * horizontal or vertical); closed curves turn around their centre; segment
 * legs around the far vertex. Pure: no DOM, no Obsidian.
 */
import { findExtrema1D } from '../math';
import type { DragContext, DragTarget, HitShape, Pt } from './types';

export type PivotReason = 'marker' | 'corner' | 'number' | 'intercept' | 'extremum' | 'midline' | 'axis' | 'centre' | 'vertex' | 'end';
export interface PivotChoice {
    at: Pt;
    reason: PivotReason;
    cost: number;
}
export interface PivotCandidate {
    at: Pt;
    reason: PivotReason;
    cls: number;
}

/** Candidates closer than this (screen px) to the grab are not admissible. */
const MIN_GRAB_PX = 40;
/** Inset of the view (fraction of each span) a candidate must lie in. */
const VIEW_INSET = 0.02;
/** Markers this close (px) to the grabbed line count as lying on it. */
const ON_LINE_PX = 3;
/** Candidates this close (px) to each other are one candidate. */
const DEDUPE_PX = 1;
/** Turns ignore cursor moves this close (px) to the pivot (session.ts): a pivot never sits this close to the grab. */
const PIVOT_DEAD_PX = 12;
/**
 * A stretch axis is dead (factor 1) when the grab lies this close (px) to the pivot along it (SPEC3 2.3, the
 * stretch unit floor MIN_U_PX in session.ts): a stretch pivot never leaves the axis the gesture stretches dead.
 */
const DEAD_AXIS_PX = 24;

/**
 * A clause or equation in graph form (lead decision on SPEC3 D4: a lone, optionally signed axis variable on one
 * side, the other side free of it), solved for its output variable: `f(input)` is the output coordinate, `axis`
 * the output axis (0 = x, 1 = y). Its pivot candidates are those of a graph along that axis.
 */
export interface GraphForm {
    f: (input: number) => number;
    axis: 0 | 1;
}

/**
 * SPEC3 1.6 candidates (graph f and implicit G at the current numbers; natural pivots from the move-free plan;
 * `graph`: the clause or equation in graph form).
 */
export function pivotCandidates(
    t: DragTarget,
    grab: Pt,
    ctx: DragContext,
    shape: { f?: (x: number) => number; G?: (x: number, y: number) => number; graph?: GraphForm | null; natural: Array<{ at: Pt; tier: number }> }
): PivotCandidate[] {
    const map = ctx.map;
    const dist = (a: Pt, b: Pt) => Math.hypot((a.x - b.x) * map.kx, (a.y - b.y) * map.ky);
    const byDist = (a: Pt, b: Pt) => dist(a, grab) - dist(b, grab);
    const out: PivotCandidate[] = [];

    if (t.kind === 'path') {
        // Legs turn around the vertex farthest from the grab.
        const pts = t.points.slice().sort((a, b) => dist(b, grab) - dist(a, grab));
        for (const p of pts) out.push({ at: p, reason: 'vertex', cls: 1 });
        return out;
    }

    const lines = grabbedLines(t);
    if (t.closed) {
        const centre = closedCentre(lines, shape.G, ctx);
        if (centre) out.push({ at: centre, reason: 'centre', cls: 1 });
        return out;
    }

    const markers = otherMarkers(t, ctx);
    if (t.straight) {
        const line = lineOf(lines);
        const onLine: PivotCandidate[] = [];
        if (line) {
            for (const m of markers) {
                if (m.point && lineDistPx(m.point, line, map) <= ON_LINE_PX) onLine.push({ at: m.point, reason: 'marker', cls: 1 });
            }
        }
        const shapeOf = ctx.hits.byKey(t.key);
        for (const a of shapeOf ? shapeOf.anchors : []) onLine.push({ at: a, reason: 'corner', cls: 1 });
        out.push(...dedupe(onLine, map).sort((a, b) => byDist(a.at, b.at)));
        const natural = shape.natural
            .filter((n) => Number.isFinite(n.at.x) && Number.isFinite(n.at.y))
            .slice()
            .sort((a, b) => a.tier - b.tier || byDist(a.at, b.at));
        for (const n of dedupeNatural(natural, map)) out.push({ at: n.at, reason: 'number', cls: 2 });
        if (line) {
            const ints = intercepts(line).sort(byDist);
            for (const p of ints) out.push({ at: p, reason: 'intercept', cls: 3 });
        }
        for (const p of farEnds(lines, grab, map)) out.push({ at: p, reason: 'end', cls: 4 });
        return out;
    }

    // Open curves. Graphs, and clauses or equations in graph form along their output axis: extrema, midline
    // crossings and the crossing with the input axis' zero line (the y-axis crossing of a graph), on the grabbed
    // run (a graph's own run; for an implicit curve the drawn piece nearest the grab).
    const graph: GraphForm | null = t.kind === 'graph' ? (shape.f ? { f: shape.f, axis: 1 } : null) : shape.graph || null;
    const run = t.kind !== 'graph' ? nearestLine(lines, grab, map) : lines.length ? lines.reduce((a, b) => (b.length > a.length ? b : a)) : [];
    if (graph && run.length >= 2) {
        const f = graph.f;
        // (input, output) <-> (x, y): the identity for output y, the swap for output x (its own inverse).
        const uv = (p: Pt): Pt => (graph.axis === 1 ? p : { x: p.y, y: p.x });
        let lo = Infinity;
        let hi = -Infinity;
        let ymin = Infinity;
        let ymax = -Infinity;
        for (const q of run) {
            const p = uv(q);
            if (!Number.isFinite(p.x)) continue;
            lo = Math.min(lo, p.x);
            hi = Math.max(hi, p.x);
            if (Number.isFinite(p.y)) {
                ymin = Math.min(ymin, p.y);
                ymax = Math.max(ymax, p.y);
            }
        }
        if (hi > lo) {
            const ext = findExtrema1D(f, lo, hi).map((e) => uv({ x: e.x, y: e.y }));
            for (const p of ext.sort(byDist)) out.push({ at: p, reason: 'extremum', cls: 1 });
            if (ymax > ymin) {
                const mid = (ymax + ymin) / 2;
                const cross = midlineCrossings(f, lo, hi, mid).map(uv).sort(byDist).slice(0, 2);
                for (const p of cross) out.push({ at: p, reason: 'midline', cls: 2 });
            }
        }
        for (const m of markers) {
            if (m.point && polyDistPx(m.point, lines, map) <= ON_LINE_PX) out.push({ at: m.point, reason: 'marker', cls: 3 });
        }
        if (lo <= 0 && hi >= 0) {
            const v0 = f(0);
            if (Number.isFinite(v0)) out.push({ at: uv({ x: 0, y: v0 }), reason: 'axis', cls: 4 });
        }
    } else {
        // Other implicit curves (`y - x^2 = 0`, `x*y = 1`): the points of the grabbed piece where the tangent is
        // horizontal or vertical (its extrema in y and in x), so a stretch can pivot at a vertex instead of at a
        // far end level with the grab.
        if (t.kind !== 'graph' && shape.G && run.length >= 2) {
            for (const p of tangentExtrema(run, shape.G, map).sort(byDist)) out.push({ at: p, reason: 'extremum', cls: 1 });
        }
        for (const m of markers) {
            if (m.point && polyDistPx(m.point, lines, map) <= ON_LINE_PX) out.push({ at: m.point, reason: 'marker', cls: 3 });
        }
    }
    for (const p of farEnds(lines, grab, map)) out.push({ at: p, reason: 'end', cls: 5 });
    return out;
}

/**
 * First class with an admissible candidate; curves: min cost via `cost(at)`. `stretchAxis` (stretches only:
 * 0 = x, 1 = y) is the axis the gesture stretches; a candidate within 24 px of the grab along it would leave
 * that axis dead (a drag along it changes nothing), so it is skipped and the next candidate in the usual
 * order is taken. Among the costed candidates of a stretch, those that keep the other axis live as well come
 * first (a dead axis makes a pivot look cheap: `sin(x)` about (pi, 0) from a grab beside it costs one number
 * because the horizontal stretch is simply off). `preferBoth` (implicit curves not in graph form, whose stretch
 * axis is only a guess from the normal at the grab): every candidate live along both axes, the far ends
 * included, comes first; the stretch axis alone only when none is.
 */
export function choosePivot(
    cands: readonly PivotCandidate[],
    grab: Pt,
    ctx: DragContext,
    cost: ((at: Pt) => number) | null,
    stretchAxis: 0 | 1 | null = null,
    preferBoth = false
): PivotChoice | null {
    if (!cands.length) return null;
    // Each candidate is costed once, whichever pass asks (a cost is a plan).
    const costs = new Map<PivotCandidate, number>();
    const costOf = cost
        ? (c: PivotCandidate): number => {
              let k = costs.get(c);
              if (k === undefined) {
                  try {
                      k = cost(c.at);
                  } catch {
                      k = Infinity;
                  }
                  costs.set(c, k);
              }
              return k;
          }
        : null;
    if (stretchAxis === null) return pickPivot(cands, grab, ctx, costOf, [], []);
    if (preferBoth) {
        const both = pickPivot(cands, grab, ctx, costOf, [0, 1], []);
        if (both) return both;
    }
    return pickPivot(cands, grab, ctx, costOf, [stretchAxis], [0, 1]);
}

/**
 * Whether a pivot chosen for a grab at `planned` still serves a grab at `grab` (the modal reuses a hover plan
 * while the pointer slides along the object): false when the slide brings the grab within 24 px of it along an
 * axis that was live (`live`, a stretch would leave that axis dead), or under 40 px from it when it was farther
 * (a fresh choice would skip it).
 */
export function pivotServes(at: Pt, planned: Pt, grab: Pt, map: DragContext['map'], live: { x: boolean; y: boolean }): boolean {
    const dx = Math.abs(at.x - grab.x) * map.kx;
    const dy = Math.abs(at.y - grab.y) * map.ky;
    if ((live.x && dx < DEAD_AXIS_PX) || (live.y && dy < DEAD_AXIS_PX)) return false;
    const before = Math.hypot((at.x - planned.x) * map.kx, (at.y - planned.y) * map.ky);
    const now = Math.hypot(dx, dy);
    return !(now < MIN_GRAB_PX && now < before);
}

// --------------------------------------------------------------- private

/**
 * One pass of choosePivot: every axis in `axes` must stay live (at least 24 px from the grab along it); costed
 * candidates (and then far ends) live along every axis in `prefer` as well are taken first.
 */
function pickPivot(
    cands: readonly PivotCandidate[],
    grab: Pt,
    ctx: DragContext,
    cost: ((c: PivotCandidate) => number) | null,
    axes: ReadonlyArray<0 | 1>,
    prefer: ReadonlyArray<0 | 1>
): PivotChoice | null {
    const map = ctx.map;
    const v = ctx.map.view;
    const ix = (v.xmax - v.xmin) * VIEW_INSET;
    const iy = (v.ymax - v.ymin) * VIEW_INSET;
    const inView = (p: Pt) => p.x >= v.xmin + ix && p.x <= v.xmax - ix && p.y >= v.ymin + iy && p.y <= v.ymax - iy;
    const dist = (p: Pt) => Math.hypot((p.x - grab.x) * map.kx, (p.y - grab.y) * map.ky);
    const liveOn = (p: Pt, list: ReadonlyArray<0 | 1>) =>
        list.every((a) => (a === 0 ? Math.abs(p.x - grab.x) * map.kx : Math.abs(p.y - grab.y) * map.ky) >= DEAD_AXIS_PX);
    const usable = (c: PivotCandidate) => Number.isFinite(c.at.x) && Number.isFinite(c.at.y) && inView(c.at) && liveOn(c.at, axes);
    const admissible = cands.filter((c) => usable(c) && dist(c.at) >= MIN_GRAB_PX);

    if (cost) {
        // Curves: the candidate that changes the fewest numbers; the far end only when nothing else works.
        const cheapest = (list: readonly PivotCandidate[]): { c: PivotCandidate; cost: number } | null => {
            let best: { c: PivotCandidate; cost: number } | null = null;
            for (const c of list) {
                const k = cost(c);
                if (!Number.isFinite(k)) continue;
                if (
                    !best ||
                    k < best.cost - 1e-9 ||
                    (Math.abs(k - best.cost) <= 1e-9 && (c.cls < best.c.cls || (c.cls === best.c.cls && dist(c.at) < dist(best.c.at))))
                ) {
                    best = { c, cost: k };
                }
            }
            return best;
        };
        const costed = admissible.filter((c) => c.reason !== 'end');
        const best = cheapest(costed.filter((c) => liveOn(c.at, prefer))) || cheapest(costed);
        if (best) return { at: best.c.at, reason: best.c.reason, cost: best.cost };
        const ends = admissible.filter((c) => c.reason === 'end');
        const end = ends.find((c) => liveOn(c.at, prefer)) || ends[0];
        if (end) return { at: end.at, reason: end.reason, cost: NaN };
    } else if (admissible.length) {
        const cls = Math.min(...admissible.map((c) => c.cls));
        const c = admissible.find((x) => x.cls === cls) as PivotCandidate;
        return { at: c.at, reason: c.reason, cost: 0 };
    }
    // Every candidate is closer than 40 px to the grab: the farthest one in view, but never one inside the
    // turn dead zone around the grab (a pivot 3 px away turns the line by garbage angles). None left: null,
    // and Shift moves instead.
    const pool = cands.filter((c) => usable(c) && dist(c.at) >= PIVOT_DEAD_PX);
    if (!pool.length) return null;
    const far = pool.reduce((a, b) => (dist(b.at) > dist(a.at) ? b : a));
    return { at: far.at, reason: far.reason, cost: NaN };
}

/** The polyline nearest the grab (an implicit curve's drawn piece the grab lies on). */
function nearestLine(lines: Pt[][], grab: Pt, map: DragContext['map']): Pt[] {
    let best: Pt[] = [];
    let bestD = Infinity;
    for (const l of lines) {
        const d = polyDistPx(grab, [l], map);
        if (d < bestD) {
            bestD = d;
            best = l;
        }
    }
    return best;
}

/**
 * Points of the polyline where the zero set of G has a horizontal tangent (G_x changes sign: an extremum in y)
 * or a vertical one (G_y changes sign: an extremum in x), found by bisection along the segment and projected
 * onto G = 0 (Newton along the gradient, which there points along the axis of the extremum).
 */
function tangentExtrema(line: Pt[], G: (x: number, y: number) => number, map: DragContext['map']): Pt[] {
    const v = map.view;
    const hx = 1e-6 * Math.max(1e-9, v.xmax - v.xmin);
    const hy = 1e-6 * Math.max(1e-9, v.ymax - v.ymin);
    const grad = (p: Pt): [number, number] => [
        (G(p.x + hx, p.y) - G(p.x - hx, p.y)) / (2 * hx),
        (G(p.x, p.y + hy) - G(p.x, p.y - hy)) / (2 * hy),
    ];
    const out: Pt[] = [];
    for (const k of [0, 1] as const) {
        let prev = Number.isFinite(line[0].x) && Number.isFinite(line[0].y) ? grad(line[0])[k] : NaN;
        for (let i = 1; i < line.length; i++) {
            const a = line[i - 1];
            const b = line[i];
            const cur = Number.isFinite(b.x) && Number.isFinite(b.y) ? grad(b)[k] : NaN;
            if (cur === 0 && Number.isFinite(prev) && prev !== 0) {
                // A sample right on the extremum (a marching-squares vertex at x = 0 of `y - x^2 = 0`).
                const p = projectOnZero(G, b, grad, map);
                if (p && !out.some((o) => Math.hypot((o.x - p.x) * map.kx, (o.y - p.y) * map.ky) <= DEDUPE_PX)) out.push(p);
            } else if (Number.isFinite(prev) && Number.isFinite(cur) && prev * cur < 0) {
                let lo = 0;
                let hi = 1;
                let glo = prev;
                for (let it = 0; it < 40; it++) {
                    const m = (lo + hi) / 2;
                    const gm = grad({ x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m })[k];
                    if (!Number.isFinite(gm)) break;
                    if (glo * gm <= 0) hi = m;
                    else {
                        lo = m;
                        glo = gm;
                    }
                }
                const m = (lo + hi) / 2;
                const p = projectOnZero(G, { x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m }, grad, map);
                if (p && !out.some((o) => Math.hypot((o.x - p.x) * map.kx, (o.y - p.y) * map.ky) <= DEDUPE_PX)) out.push(p);
            }
            prev = cur;
        }
    }
    return out;
}

/** Newton steps along the gradient onto G = 0; null when it does not land within 0.5 px. */
function projectOnZero(
    G: (x: number, y: number) => number,
    p0: Pt,
    grad: (p: Pt) => [number, number],
    map: DragContext['map']
): Pt | null {
    let p = p0;
    for (let k = 0; k < 8; k++) {
        const g = G(p.x, p.y);
        const [gx, gy] = grad(p);
        const n2 = gx * gx + gy * gy;
        if (!Number.isFinite(g) || !(n2 > 0)) return null;
        const q = { x: p.x - (g * gx) / n2, y: p.y - (g * gy) / n2 };
        if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return null;
        const stepPx = Math.hypot((q.x - p.x) * map.kx, (q.y - p.y) * map.ky);
        p = q;
        if (stepPx < 1e-6) break;
    }
    const [gx, gy] = grad(p);
    const g = G(p.x, p.y);
    // Distance to the zero set (px): |G| over the gradient measured in px.
    const n = Math.hypot(gx / map.kx, gy / map.ky);
    return Number.isFinite(g) && n > 0 && Math.abs(g) / n <= 0.5 ? p : null;
}


function grabbedLines(t: DragTarget): Pt[][] {
    if (t.run >= 0 && t.lines[t.run]) return [t.lines[t.run]];
    return t.lines.filter((l) => l.length >= 2);
}

/** Markers of other items (locked ones included). */
function otherMarkers(t: DragTarget, ctx: DragContext): HitShape[] {
    const ownItem = t.key.split('#')[0];
    return ctx.hits.points().filter((h) => h.point && h.itemKey !== ownItem && h.source !== t.cardSource);
}

/** The straight line through the grabbed run: a point and a unit direction (math). */
function lineOf(lines: Pt[][]): { p: Pt; d: Pt } | null {
    let best: { p: Pt; d: Pt; len: number } | null = null;
    for (const l of lines) {
        if (l.length < 2) continue;
        const a = l[0];
        const b = l[l.length - 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > 0 && (!best || len > best.len)) best = { p: a, d: { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, len };
    }
    return best ? { p: best.p, d: best.d } : null;
}

/** Distance (px) of `q` to the infinite line. */
function lineDistPx(q: Pt, line: { p: Pt; d: Pt }, map: DragContext['map']): number {
    // Work in px: the direction changes under unequal scales.
    const dx = line.d.x * map.kx;
    const dy = line.d.y * map.ky;
    const n = Math.hypot(dx, dy);
    if (!(n > 0)) return Infinity;
    const qx = (q.x - line.p.x) * map.kx;
    const qy = (q.y - line.p.y) * map.ky;
    return Math.abs(qx * dy - qy * dx) / n;
}

/** Distance (px) of `q` to the nearest segment of the polylines. */
function polyDistPx(q: Pt, lines: Pt[][], map: DragContext['map']): number {
    let best = Infinity;
    const qx = q.x * map.kx;
    const qy = q.y * map.ky;
    for (const l of lines) {
        for (let i = 0; i + 1 < l.length; i++) {
            const ax = l[i].x * map.kx;
            const ay = l[i].y * map.ky;
            const bx = l[i + 1].x * map.kx;
            const by = l[i + 1].y * map.ky;
            const vx = bx - ax;
            const vy = by - ay;
            const len2 = vx * vx + vy * vy;
            const s = len2 > 0 ? Math.max(0, Math.min(1, ((qx - ax) * vx + (qy - ay) * vy) / len2)) : 0;
            best = Math.min(best, Math.hypot(qx - ax - s * vx, qy - ay - s * vy));
        }
        if (l.length === 1) best = Math.min(best, Math.hypot(qx - l[0].x * map.kx, qy - l[0].y * map.ky));
    }
    return best;
}

function dedupe(cands: PivotCandidate[], map: DragContext['map']): PivotCandidate[] {
    const out: PivotCandidate[] = [];
    for (const c of cands) {
        if (!out.some((o) => Math.hypot((o.at.x - c.at.x) * map.kx, (o.at.y - c.at.y) * map.ky) <= DEDUPE_PX)) out.push(c);
    }
    return out;
}

function dedupeNatural(list: Array<{ at: Pt; tier: number }>, map: DragContext['map']): Array<{ at: Pt; tier: number }> {
    const out: Array<{ at: Pt; tier: number }> = [];
    for (const c of list) {
        if (!out.some((o) => Math.hypot((o.at.x - c.at.x) * map.kx, (o.at.y - c.at.y) * map.ky) <= DEDUPE_PX)) out.push(c);
    }
    return out;
}

/** Where the line meets x = 0 and y = 0. */
function intercepts(line: { p: Pt; d: Pt }): Pt[] {
    const out: Pt[] = [];
    const { p, d } = line;
    if (Math.abs(d.x) > 1e-12) {
        const s = -p.x / d.x;
        out.push({ x: 0, y: p.y + s * d.y });
    }
    if (Math.abs(d.y) > 1e-12) {
        const s = -p.y / d.y;
        const q = { x: p.x + s * d.x, y: 0 };
        if (!out.some((o) => Math.abs(o.x - q.x) < 1e-12 && Math.abs(o.y - q.y) < 1e-12)) out.push(q);
    }
    return out;
}

/**
 * Visible ends of the grabbed polylines, farthest from the grab first: the ends of the pieces that lie inside
 * the view inset by 2 % (a line's run ends on the view border, outside the inset, so its raw ends would never
 * be admissible). Pieces are clipped a hair inside the inset so their ends pass the admissibility test.
 */
function farEnds(lines: Pt[][], grab: Pt, map: DragContext['map']): Pt[] {
    const v = map.view;
    const ix = (v.xmax - v.xmin) * VIEW_INSET * 1.001;
    const iy = (v.ymax - v.ymin) * VIEW_INSET * 1.001;
    const box = { x0: v.xmin + ix, x1: v.xmax - ix, y0: v.ymin + iy, y1: v.ymax - iy };
    const ends: Pt[] = [];
    for (const l of lines) {
        for (const piece of clipToBox(l, box)) {
            ends.push(piece[0]);
            if (piece.length > 1) ends.push(piece[piece.length - 1]);
        }
    }
    const dist = (a: Pt) => Math.hypot((a.x - grab.x) * map.kx, (a.y - grab.y) * map.ky);
    return ends.sort((a, b) => dist(b) - dist(a));
}

/** The parts of a polyline inside the box (Liang-Barsky per segment), in order. */
function clipToBox(line: Pt[], box: { x0: number; x1: number; y0: number; y1: number }): Pt[][] {
    const pieces: Pt[][] = [];
    const inside = (p: Pt) => p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
    if (line.length === 1) return Number.isFinite(line[0].x) && Number.isFinite(line[0].y) && inside(line[0]) ? [[line[0]]] : [];
    let cur: Pt[] | null = null;
    for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i];
        const b = line[i + 1];
        if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
            cur = null;
            continue;
        }
        let t0 = 0;
        let t1 = 1;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const p = [-dx, dx, -dy, dy];
        const q = [a.x - box.x0, box.x1 - a.x, a.y - box.y0, box.y1 - a.y];
        let out = false;
        for (let k = 0; k < 4 && !out; k++) {
            if (p[k] === 0) {
                if (q[k] < 0) out = true;
                continue;
            }
            const t = q[k] / p[k];
            if (p[k] < 0) {
                if (t > t1) out = true;
                else if (t > t0) t0 = t;
            } else if (t < t0) out = true;
            else if (t < t1) t1 = t;
        }
        if (out || t0 > t1) {
            cur = null;
            continue;
        }
        const A = { x: a.x + dx * t0, y: a.y + dy * t0 };
        const B = { x: a.x + dx * t1, y: a.y + dy * t1 };
        if (cur && t0 === 0) cur.push(B);
        else {
            cur = [A, B];
            pieces.push(cur);
        }
        if (t1 < 1) cur = null;
    }
    return pieces;
}

/** x where f(x) = m on [lo, hi], refined by bisection. */
function midlineCrossings(f: (x: number) => number, lo: number, hi: number, m: number): Pt[] {
    const n = 200;
    const out: Pt[] = [];
    let px = lo;
    let pv = f(lo) - m;
    for (let i = 1; i <= n; i++) {
        const x = i === n ? hi : lo + ((hi - lo) * i) / n;
        const v = f(x) - m;
        if (Number.isFinite(pv) && Number.isFinite(v) && (pv === 0 || pv * v < 0)) {
            let a = px;
            let b = x;
            let fa = pv;
            if (pv === 0) b = a;
            for (let k = 0; k < 60 && b - a > 0; k++) {
                const c = (a + b) / 2;
                const fc = f(c) - m;
                if (!Number.isFinite(fc)) break;
                if (fa * fc <= 0) b = c;
                else {
                    a = c;
                    fa = fc;
                }
            }
            const xc = (a + b) / 2;
            out.push({ x: xc, y: f(xc) });
        }
        px = x;
        pv = v;
    }
    return out;
}

/** Stationary point of G (Newton on grad G = 0 from the centroid) inside the polyline, else the centroid. */
function closedCentre(lines: Pt[][], G: ((x: number, y: number) => number) | undefined, ctx: DragContext): Pt | null {
    const ring = lines.reduce<Pt[]>((a, b) => (b.length > a.length ? b : a), []);
    if (ring.length < 3) return null;
    let cx = 0;
    let cy = 0;
    for (const p of ring) {
        cx += p.x;
        cy += p.y;
    }
    const centroid = { x: cx / ring.length, y: cy / ring.length };
    if (!G) return centroid;
    const v = ctx.map.view;
    const hx = 1e-4 * (v.xmax - v.xmin);
    const hy = 1e-4 * (v.ymax - v.ymin);
    let x = centroid.x;
    let y = centroid.y;
    for (let k = 0; k < 8; k++) {
        const g0 = G(x, y);
        const gxp = G(x + hx, y);
        const gxm = G(x - hx, y);
        const gyp = G(x, y + hy);
        const gym = G(x, y - hy);
        const gx = (gxp - gxm) / (2 * hx);
        const gy = (gyp - gym) / (2 * hy);
        const hxx = (gxp - 2 * g0 + gxm) / (hx * hx);
        const hyy = (gyp - 2 * g0 + gym) / (hy * hy);
        const hxy = (G(x + hx, y + hy) - G(x + hx, y - hy) - G(x - hx, y + hy) + G(x - hx, y - hy)) / (4 * hx * hy);
        const det = hxx * hyy - hxy * hxy;
        if (!Number.isFinite(det) || Math.abs(det) < 1e-300) break;
        const dx = (hyy * gx - hxy * gy) / det;
        const dy = (hxx * gy - hxy * gx) / det;
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) break;
        x -= dx;
        y -= dy;
        if (Math.abs(dx) < 1e-12 * (1 + Math.abs(x)) && Math.abs(dy) < 1e-12 * (1 + Math.abs(y))) break;
    }
    const p = { x, y };
    return Number.isFinite(x) && Number.isFinite(y) && insideRing(p, ring) ? p : centroid;
}

function insideRing(p: Pt, ring: Pt[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}
