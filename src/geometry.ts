/*
 * Pure geometry engine (no DOM, no Obsidian): regions defined by
 * inequalities, implicit curves / contour lines, clipping, simplification,
 * label placement, root finding, optimisation over regions, lattice points.
 *
 * CONTRACT FILE. Exported names, signatures and documented semantics are
 * fixed; other modules are implemented against them in parallel.
 * Implementations may add private helpers and extra exports.
 *
 * Coordinates are math coordinates (y up). "view" is the visible rectangle.
 */
import { Affine } from './mathcontext';

export interface Pt {
    x: number;
    y: number;
}

export interface View {
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
}

/** Cells across the view (nodes = n + 1 per axis). */
export interface Grid {
    nx: number;
    ny: number;
}

/** One atomic constraint g(x, y) <= 0. `id` is unique within a ConstraintSet and used as edge tag. */
export interface Constraint {
    id: number;
    g: (x: number, y: number) => number;
    affine: Affine | null;
}

/**
 * Region = AND over entries; entry = OR over disjuncts; disjunct = AND over
 * constraints. Inside test: G(x, y) = max_entry min_disjunct max_constraint g
 * <= tol (see `insideTol`). Any non-finite g makes that disjunct false.
 */
export interface ConstraintSet {
    entries: Array<{ disjuncts: Constraint[][] }>;
}

/** Edge tag: id of the constraint the edge lies on, or 'view' for the view border. */
export type EdgeTag = number | 'view';

export interface RegionResult {
    /** Closed rings (first point not repeated). Fill with the even-odd rule. Outer rings CCW, holes CW. */
    rings: Pt[][];
    /** tags[r][i] = tag of the edge from rings[r][i] to rings[r][(i + 1) % n]. */
    tags: EdgeTag[][];
    /** Connected filled components: index of the outer ring and its holes. */
    components: Array<{ outer: number; holes: number[] }>;
    /**
     * Maximal polyline runs of edges lying on real constraints (tag !== 'view'),
     * i.e. the region's own boundary. Constraints that coincide with the view
     * border (x >= 0 with xmin = 0) DO appear here: an edge is tagged with a
     * constraint whenever both endpoints satisfy |g| <= tol, before 'view'.
     */
    boundary: Array<{ tag: number; line: Pt[] }>;
    /**
     * Corner points: ring vertices whose two incident edges carry different
     * constraint tags (never 'view'), deduped within one grid cell (within
     * 1e-6 of the view on the exact path, so the set does not depend on the
     * grid). Includes
     * corners on the view border when both edges lie on constraints, e.g.
     * (0, 0) for x >= 0, y >= 0 with xmin = ymin = 0.
     */
    vertices: Array<Pt & { tags: [number, number] }>;
    empty: boolean;
    /** True when every constraint was affine and no `or` was used (exact Sutherland-Hodgman path). */
    exact: boolean;
}

// ------------------------------------------------------------------ tuning

/** Relative and absolute parts of the inclusive tolerance (insideTol). */
const TOL_REL = 1e-9;
const TOL_ABS = 1e-12;
/** Samples per axis (minus one) used to estimate |g| of a nonlinear constraint over the view. */
const SCALE_SAMPLES = 8;
/** Corner residual relative to the constraint scale; hysteresis lead relative to the grid size. */
const CORNER_REL = 1e-6;
/** Newton budget and acceptance radius (in cells) for exact corners. */
const NEWTON_STEPS = 6;
const CORNER_RADIUS = 1.5;
/** Largest acceptance radius (in cells) for the tip of a narrowing sliver (see sliverTip). */
const TIP_RADIUS = 12;
/** Bisection steps for region crossings next to a non-finite node. */
const EDGE_BISECT_STEPS = 12;
/** Bisection steps used to confirm a suspicious contour crossing (pole or jump). */
const POLE_CHECK_STEPS = 10;
/** Grid resolution bounds (cells per axis). */
const DEFAULT_CELLS = 100;
const MAX_CELLS = 2000;
const LATTICE_CAP = 2000;
/** Integer points examined at most by latticePoints (huge views report `truncated`). */
const LATTICE_SCAN = 1000000;
/** Default sign-change scan resolution of findCrossings. */
const ROOT_SAMPLES = 400;
/** Coarse interior lattice (per axis) used as optimizer candidates. */
const OPT_INTERIOR = 40;
/** Optimizer: cells of boundary searched to either side of a candidate, and most samples per long edge. */
const OPT_PATH = 3;
const EDGE_SAMPLES = 64;
/** How far beyond the view (in view spans, on every side) the optimizer looks to tell 'outside' from 'unbounded'. */
const BEYOND = 1e4;
/** Simplification tolerance (fraction of the view) for rings before label placement. */
const LABEL_THIN = 0.002;
/** Region labels: lattice per view axis for near-tie candidates, and its tolerances (fractions of the view). */
const LABEL_LATTICE = 64;
const LABEL_TIE = 0.02;
const LABEL_SPREAD = 0.05;
/** Components whose areas differ by less than this fraction are tied for the label. */
const LABEL_AREA_TIE = 0.02;
/** Near-tied label spots: the one in this direction from the area centroid (60 degrees). */
const LABEL_DIRECTION = Math.PI / 3;

// ----------------------------------------------------------------- helpers

function validView(view: View | null | undefined): view is View {
    return (
        !!view &&
        Number.isFinite(view.xmin) &&
        Number.isFinite(view.xmax) &&
        Number.isFinite(view.ymin) &&
        Number.isFinite(view.ymax) &&
        view.xmax > view.xmin &&
        view.ymax > view.ymin
    );
}

function cellCount(n: number | undefined): number {
    return typeof n === 'number' && Number.isFinite(n) ? Math.min(MAX_CELLS, Math.max(1, Math.round(n))) : DEFAULT_CELLS;
}

/** Node coordinates of an axis split into n cells; the end nodes are exactly lo and hi. */
function nodeCoords(lo: number, hi: number, n: number): Float64Array {
    const out = new Float64Array(n + 1);
    const span = hi - lo;
    for (let i = 0; i < n; i++) out[i] = lo + (span * i) / n;
    out[n] = hi;
    return out;
}

/** The constraint's affine form when present with finite coefficients. */
function usableAffine(c: Constraint): Affine | null {
    const af = c.affine;
    return af && Number.isFinite(af.a) && Number.isFinite(af.b) && Number.isFinite(af.c) ? af : null;
}

/** Magnitude of g over the view: |a| xSpan + |b| ySpan + |c| for affine constraints, max |g| sampled otherwise. */
function constraintScale(c: Constraint, view: View): number {
    const xSpan = view.xmax - view.xmin;
    const ySpan = view.ymax - view.ymin;
    const af = usableAffine(c);
    if (af) return Math.abs(af.a) * xSpan + Math.abs(af.b) * ySpan + Math.abs(af.c);
    let m = 0;
    for (let j = 0; j <= SCALE_SAMPLES; j++) {
        const y = view.ymin + (ySpan * j) / SCALE_SAMPLES;
        for (let i = 0; i <= SCALE_SAMPLES; i++) {
            const v = Math.abs(c.g(view.xmin + (xSpan * i) / SCALE_SAMPLES, y));
            if (Number.isFinite(v) && v > m) m = v;
        }
    }
    return m;
}

function samePt(a: Pt, b: Pt): boolean {
    return a.x === b.x && a.y === b.y;
}

function finitePt(p: Pt | null | undefined): p is Pt {
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Squared distance from (px, py) to the segment a-b. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    let x = ax;
    let y = ay;
    const len2 = dx * dx + dy * dy;
    if (len2 > 0) {
        const t = ((px - ax) * dx + (py - ay) * dy) / len2;
        if (t >= 1) {
            x = bx;
            y = by;
        } else if (t > 0) {
            x += t * dx;
            y += t * dy;
        }
    }
    return (px - x) * (px - x) + (py - y) * (py - y);
}

const B_XMIN = 1;
const B_XMAX = 2;
const B_YMIN = 4;
const B_YMAX = 8;

/** Which view border lines the point lies on exactly (bit mask). */
function borderBits(x: number, y: number, view: View): number {
    return (
        (x === view.xmin ? B_XMIN : 0) |
        (x === view.xmax ? B_XMAX : 0) |
        (y === view.ymin ? B_YMIN : 0) |
        (y === view.ymax ? B_YMAX : 0)
    );
}

/** Outward unit normals of the border lines in `bits`. */
function borderNormals(bits: number): Pt[] {
    const out: Pt[] = [];
    if (bits & B_XMIN) out.push({ x: -1, y: 0 });
    if (bits & B_XMAX) out.push({ x: 1, y: 0 });
    if (bits & B_YMIN) out.push({ x: 0, y: -1 });
    if (bits & B_YMAX) out.push({ x: 0, y: 1 });
    return out;
}

/**
 * Bisection on a sign change of f over the parameter range [0, 1], where f(0)
 * = f0 and f(1) = f1 have opposite signs. Returns the root parameter, or NaN
 * when the sign change is a pole rather than a root: |f| at a midpoint exceeds
 * both endpoint magnitudes, f is not finite there, or the smaller bracket
 * magnitude grows instead of shrinking (1/x behaviour next to the pole).
 * Also NaN for a jump: the values at the bracket ends must close in on each
 * other (by 2^(-steps / 4) of the initial difference) as the bracket shrinks.
 */
function bisectSign(f: (t: number) => number, f0: number, f1: number, steps: number): number {
    const bound = Math.max(Math.abs(f0), Math.abs(f1));
    // The floor keeps rounding noise next to a root from looking like growth.
    const grow = 4 * Math.max(Math.min(Math.abs(f0), Math.abs(f1)), 1e-9 * bound);
    let a = 0;
    let b = 1;
    let fa = f0;
    let fb = f1;
    for (let i = 0; i < steps; i++) {
        const m = 0.5 * (a + b);
        const fm = f(m);
        if (!Number.isFinite(fm) || Math.abs(fm) > bound) return NaN;
        if (fm === 0) return m;
        if (fm < 0 === fa < 0) {
            a = m;
            fa = fm;
        } else {
            b = m;
            fb = fm;
        }
        if (Math.min(Math.abs(fa), Math.abs(fb)) > grow) return NaN;
    }
    if (!(Math.abs(fb - fa) <= Math.pow(2, -steps / 4) * Math.abs(f1 - f0))) return NaN;
    // Final secant step inside the (tiny) bracket.
    const t = fa / (fa - fb);
    return Number.isFinite(t) ? a + Math.min(1, Math.max(0, t)) * (b - a) : 0.5 * (a + b);
}

// ------------------------------------------------- constraint set structure

/** Constraint set with constraints addressed by index into `list`. */
interface Flat {
    /** Distinct constraints (by id) in first-appearance order. */
    list: Constraint[];
    /** entries[e][d] = list indices of the constraints in disjunct d of entry e. */
    entries: number[][][];
    /** Every entry has exactly one disjunct (no `or`). */
    andOnly: boolean;
}

/**
 * Flatten a ConstraintSet. Entries without disjuncts and entries with an
 * empty disjunct (an always-true AND) constrain nothing and are dropped.
 */
function flatten(set: ConstraintSet | null | undefined): Flat {
    const list: Constraint[] = [];
    const byId = new Map<number, number>();
    const entries: number[][][] = [];
    let andOnly = true;
    for (const entry of (set && set.entries) || []) {
        const ds = entry && entry.disjuncts;
        if (!ds || !ds.length || ds.some((d) => !d || !d.length)) continue;
        const out: number[][] = [];
        for (const dis of ds) {
            const idx: number[] = [];
            for (const c of dis) {
                let k = byId.get(c.id);
                if (k === undefined) {
                    k = list.length;
                    list.push(c);
                    byId.set(c.id, k);
                }
                idx.push(k);
            }
            out.push(idx);
        }
        if (out.length !== 1) andOnly = false;
        entries.push(out);
    }
    return { list, entries, andOnly };
}

/** G(x, y) over a flattened set (non-finite g makes its disjunct false, i.e. +Infinity). */
function evalFlat(flat: Flat, x: number, y: number): number {
    const { list, entries } = flat;
    let G = -Infinity;
    for (let e = 0; e < entries.length; e++) {
        const ds = entries[e];
        let ev = Infinity;
        for (let d = 0; d < ds.length; d++) {
            const cs = ds[d];
            let dv = -Infinity;
            for (let k = 0; k < cs.length; k++) {
                const v = list[cs[k]].g(x, y);
                if (!Number.isFinite(v)) {
                    dv = Infinity;
                    break;
                }
                if (v > dv) dv = v;
            }
            if (dv < ev) ev = dv;
        }
        if (ev > G) {
            G = ev;
            if (G === Infinity) return G;
        }
    }
    return G;
}

/** Inside test with constraint c relaxed to g_c <= slack[c]. */
function insideRelaxed(flat: Flat, x: number, y: number, slack: ArrayLike<number>): boolean {
    const { list, entries } = flat;
    for (let e = 0; e < entries.length; e++) {
        const ds = entries[e];
        let ok = false;
        for (let d = 0; d < ds.length && !ok; d++) {
            const cs = ds[d];
            let all = true;
            for (let k = 0; k < cs.length; k++) {
                const v = list[cs[k]].g(x, y);
                if (!Number.isFinite(v) || v > slack[cs[k]]) {
                    all = false;
                    break;
                }
            }
            ok = all;
        }
        if (!ok) return false;
    }
    return true;
}

/**
 * The constraint that determines G at a point (follows the max / min / max
 * structure), given all constraint values gv[off + i]. -1 without constraints.
 */
function activeOf(flat: Flat, gv: Float64Array, off: number): number {
    let best = -Infinity;
    let bestIdx = -1;
    for (const ds of flat.entries) {
        let ev = Infinity;
        let eIdx = -1;
        for (const cs of ds) {
            let dv = -Infinity;
            let dIdx = -1;
            for (const ci of cs) {
                let v = gv[off + ci];
                if (!Number.isFinite(v)) v = Infinity;
                if (dIdx < 0 || v > dv) {
                    dv = v;
                    dIdx = ci;
                }
            }
            if (eIdx < 0 || dv < ev) {
                ev = dv;
                eIdx = dIdx;
            }
        }
        if (bestIdx < 0 || ev > best) {
            best = ev;
            bestIdx = eIdx;
        }
    }
    return bestIdx;
}

/**
 * Tolerance used for inclusive tests of constraint `c` (lattice points,
 * edge tagging): 1e-9 * (|a| * xSpan + |b| * ySpan + |c|) + 1e-12 for affine
 * constraints, 1e-9 * (max |g| sampled) + 1e-12 otherwise.
 */
export function insideTol(c: Constraint, view: View): number {
    if (!c || !validView(view)) return TOL_ABS;
    const s = constraintScale(c, view);
    return Number.isFinite(s) ? TOL_REL * s + TOL_ABS : TOL_ABS;
}

/** G(x, y) as defined on ConstraintSet (max over entries of min over disjuncts of max over constraints). */
export function evalConstraintSet(set: ConstraintSet, x: number, y: number): number {
    let G = -Infinity;
    for (const entry of (set && set.entries) || []) {
        const ds = entry && entry.disjuncts;
        if (!ds || !ds.length) continue;
        let ev = Infinity;
        for (const dis of ds) {
            let dv = -Infinity;
            for (const c of dis || []) {
                const v = c.g(x, y);
                if (!Number.isFinite(v)) {
                    dv = Infinity;
                    break;
                }
                if (v > dv) dv = v;
            }
            if (dv < ev) ev = dv;
        }
        if (ev > G) {
            G = ev;
            if (G === Infinity) return G;
        }
    }
    return G;
}

// ------------------------------------------------------------------ regions

/** Shared per-call state of computeRegion. */
interface RegionCtx {
    flat: Flat;
    view: View;
    nx: number;
    ny: number;
    /** Cell size. */
    cw: number;
    ch: number;
    /** Per constraint (list index): magnitude over the view and inclusive tolerance. */
    scales: number[];
    tols: number[];
    /** Per constraint: CORNER_REL * scale (slack for accepting corners). */
    cornerSlack: number[];
}

/** A ring under construction: tags are list indices (-1 = view border). */
interface RingBuf {
    x: number[];
    y: number[];
    /** t[k]: tag of the edge k -> k + 1. */
    t: number[];
    /** corner[k]: point k is an exact corner (polygon vertex or accepted Newton corner). */
    corner: boolean[];
}

function emptyRegion(exact: boolean): RegionResult {
    return { rings: [], tags: [], components: [], boundary: [], vertices: [], empty: true, exact };
}

/**
 * Compute the set where all constraints hold, clipped to the view.
 * - All constraints affine and no OR: exact Sutherland-Hodgman clip of the
 *   view rectangle (edges tagged by the constraint they lie on).
 * - Otherwise marching squares on G over grid nodes covering the view
 *   exactly, padded with a virtual outside ring whose crossings are snapped
 *   onto the view border; crossings by linear interpolation when both node
 *   values are finite, else 12-step bisection on the inside predicate.
 *   Saddles resolved by the cell-centre value. Where the active constraint
 *   (the one determining G when every g is measured as its first-order
 *   distance in cells, with hysteresis: must lead by > 1e-6 of the grid
 *   size for 2 consecutive ring points) changes, solve g_i = g_j = 0 with
 *   at most 6 damped Newton steps (numerical Jacobian); accept only within
 *   1.5 cells of the switch point (or, at the tip of a sliver that the grid
 *   cuts off, within 0.5 + 1 / tan(theta / 2) cells for the interior angle
 *   theta, at most 12, when the chord to it stays on the region) and
 *   max(|g_i|, |g_j|) <= 1e-6 * scale, then insert it as an exact corner;
 *   otherwise keep the interpolated point and report no vertex.
 * Never throws; a degenerate input yields { empty: true }.
 */
export function computeRegion(set: ConstraintSet, view: View, grid: Grid): RegionResult {
    try {
        return regionImpl(set, view, grid);
    } catch {
        return emptyRegion(false);
    }
}

function regionImpl(set: ConstraintSet, view: View, grid: Grid): RegionResult {
    if (!validView(view)) return emptyRegion(false);
    const flat = flatten(set);
    const nx = cellCount(grid && grid.nx);
    const ny = cellCount(grid && grid.ny);
    const scales = flat.list.map((c) => {
        const s = constraintScale(c, view);
        return Number.isFinite(s) && s > 0 ? s : 1;
    });
    const ctx: RegionCtx = {
        flat,
        view,
        nx,
        ny,
        cw: (view.xmax - view.xmin) / nx,
        ch: (view.ymax - view.ymin) / ny,
        scales,
        tols: scales.map((s) => TOL_REL * s + TOL_ABS),
        cornerSlack: scales.map((s) => CORNER_REL * s),
    };
    if (flat.andOnly && flat.list.every((c) => usableAffine(c) !== null)) {
        const ring = clipExact(flat, view, ctx.tols);
        return ring ? buildRegion([ring], ctx, true) : emptyRegion(true);
    }
    return marchRegion(ctx);
}

/**
 * Exact path: clip the CCW view rectangle by every half-plane in turn
 * (Sutherland-Hodgman keeping one tag per edge), then retag view edges that
 * lie on a constraint and merge collinear edges with equal tags. Null when
 * the region is empty or degenerate.
 */
function clipExact(flat: Flat, view: View, tols: number[]): RingBuf | null {
    let xs = [view.xmin, view.xmax, view.xmax, view.xmin];
    let ys = [view.ymin, view.ymin, view.ymax, view.ymax];
    let ts = [-1, -1, -1, -1];
    for (const ds of flat.entries) {
        for (const ci of ds[0]) {
            const af = usableAffine(flat.list[ci]);
            if (!af) return null;
            const tol = tols[ci];
            if (af.a === 0 && af.b === 0) {
                if (af.c > tol) return null;
                continue;
            }
            const nxs: number[] = [];
            const nys: number[] = [];
            const nts: number[] = [];
            const n = xs.length;
            for (let k = 0; k < n; k++) {
                const k1 = k + 1 === n ? 0 : k + 1;
                const dP = af.a * xs[k] + af.b * ys[k] + af.c;
                const dQ = af.a * xs[k1] + af.b * ys[k1] + af.c;
                // -1 inside, 0 on the line (within tol), 1 outside.
                const sP = dP > tol ? 1 : dP < -tol ? -1 : 0;
                const sQ = dQ > tol ? 1 : dQ < -tol ? -1 : 0;
                if (sP <= 0) {
                    if (sQ <= 0) {
                        nxs.push(xs[k]);
                        nys.push(ys[k]);
                        nts.push(ts[k]);
                    } else if (sP < 0) {
                        // Leaving: keep P, then the exit point; the next edge runs along this constraint.
                        const t = dP / (dP - dQ);
                        nxs.push(xs[k], xs[k] + t * (xs[k1] - xs[k]));
                        nys.push(ys[k], ys[k] + t * (ys[k1] - ys[k]));
                        nts.push(ts[k], ci);
                    } else {
                        // P sits on the line and is itself the exit point.
                        nxs.push(xs[k]);
                        nys.push(ys[k]);
                        nts.push(ci);
                    }
                } else if (sQ < 0) {
                    // Entering: the entry point continues the original edge.
                    const t = dP / (dP - dQ);
                    nxs.push(xs[k] + t * (xs[k1] - xs[k]));
                    nys.push(ys[k] + t * (ys[k1] - ys[k]));
                    nts.push(ts[k]);
                }
            }
            xs = nxs;
            ys = nys;
            ts = nts;
            if (xs.length < 3) return null;
        }
    }
    const ring: RingBuf = { x: xs, y: ys, t: ts, corner: xs.map(() => true) };
    dedupeRing(ring, view);
    if (ring.x.length < 3) return null;
    // Prefer a constraint over 'view' whenever both endpoints lie on it (x >= 0 with xmin = 0).
    const n = ring.x.length;
    for (let k = 0; k < n; k++) {
        if (ring.t[k] >= 0) continue;
        const k1 = (k + 1) % n;
        for (let ci = 0; ci < flat.list.length; ci++) {
            const af = usableAffine(flat.list[ci]) as Affine;
            const tol = tols[ci];
            if (
                Math.abs(af.a * ring.x[k] + af.b * ring.y[k] + af.c) <= tol &&
                Math.abs(af.a * ring.x[k1] + af.b * ring.y[k1] + af.c) <= tol
            ) {
                ring.t[k] = ci;
                break;
            }
        }
    }
    mergeCollinear(ring);
    return ring.x.length >= 3 ? ring : null;
}

/** Drop consecutive duplicate points (the survivor takes the dropped point's outgoing tag). */
function dedupeRing(ring: RingBuf, view: View): void {
    const ex = 1e-12 * (view.xmax - view.xmin);
    const ey = 1e-12 * (view.ymax - view.ymin);
    let changed = true;
    while (changed && ring.x.length > 1) {
        changed = false;
        const n = ring.x.length;
        const x: number[] = [];
        const y: number[] = [];
        const t: number[] = [];
        const c: boolean[] = [];
        for (let k = 0; k < n; k++) {
            const last = x.length - 1;
            if (last >= 0 && Math.abs(ring.x[k] - x[last]) <= ex && Math.abs(ring.y[k] - y[last]) <= ey) {
                t[last] = ring.t[k];
                c[last] = c[last] || ring.corner[k];
                changed = true;
                continue;
            }
            x.push(ring.x[k]);
            y.push(ring.y[k]);
            t.push(ring.t[k]);
            c.push(ring.corner[k]);
        }
        // Wrap-around: the last point duplicating the first.
        const last = x.length - 1;
        if (last > 0 && Math.abs(x[last] - x[0]) <= ex && Math.abs(y[last] - y[0]) <= ey) {
            c[0] = c[0] || c[last];
            x.pop();
            y.pop();
            t.pop();
            c.pop();
            changed = true;
        }
        ring.x = x;
        ring.y = y;
        ring.t = t;
        ring.corner = c;
    }
}

/** Exact path: remove vertices between two collinear edges that carry the same tag. */
function mergeCollinear(ring: RingBuf): void {
    let changed = true;
    while (changed && ring.x.length > 3) {
        changed = false;
        const n = ring.x.length;
        for (let k = 0; k < n; k++) {
            const p = (k + n - 1) % n;
            const q = (k + 1) % n;
            if (ring.t[p] !== ring.t[k]) continue;
            const ax = ring.x[k] - ring.x[p];
            const ay = ring.y[k] - ring.y[p];
            const bx = ring.x[q] - ring.x[k];
            const by = ring.y[q] - ring.y[k];
            const cross = ax * by - ay * bx;
            const scale = Math.hypot(ax, ay) * Math.hypot(bx, by);
            if (Math.abs(cross) <= 1e-12 * scale && ax * bx + ay * by > 0) {
                ring.x.splice(k, 1);
                ring.y.splice(k, 1);
                ring.t.splice(k, 1);
                ring.corner.splice(k, 1);
                changed = true;
                break;
            }
        }
    }
}

/**
 * Marching squares on G. The node grid is padded by one virtual node on
 * every side whose value is +Infinity (outside); a crossing between a real
 * node and a padding node is snapped onto the real node, i.e. onto the view
 * border, so rings follow the border exactly. Segments are oriented with the
 * inside on their left, which makes outer rings CCW and holes CW.
 */
function marchRegion(ctx: RegionCtx): RegionResult {
    const { flat, view, nx, ny } = ctx;
    const W = nx + 3;
    const H = ny + 3;
    const xs = nodeCoords(view.xmin, view.xmax, nx);
    const ys = nodeCoords(view.ymin, view.ymax, ny);
    const val = new Float64Array(W * H).fill(Infinity);
    const ins = new Uint8Array(W * H);
    let anyIn = false;
    for (let j = 0; j <= ny; j++) {
        const y = ys[j];
        let idx = (j + 1) * W + 1;
        for (let i = 0; i <= nx; i++, idx++) {
            const v = evalFlat(flat, xs[i], y);
            if (v <= 0) {
                ins[idx] = 1;
                anyIn = true;
            }
            val[idx] = Number.isNaN(v) ? Infinity : v;
        }
    }
    if (!anyIn) return emptyRegion(false);

    // Edge ids: horizontal edges (I, J)-(I+1, J) first, then vertical edges (I, J)-(I, J+1).
    const HW = W - 1;
    const HN = HW * H;
    const NE = HN + W * (H - 1);
    const cx = new Float64Array(NE);
    const cy = new Float64Array(NE);
    const has = new Uint8Array(NE);
    const next = new Int32Array(NE).fill(-1);
    const starts: number[] = [];
    const isPad = (I: number, J: number): boolean => I === 0 || J === 0 || I === W - 1 || J === H - 1;

    const crossing = (e: number): void => {
        if (has[e]) return;
        has[e] = 1;
        let I: number;
        let J: number;
        let I2: number;
        let J2: number;
        if (e < HN) {
            J = (e / HW) | 0;
            I = e - J * HW;
            I2 = I + 1;
            J2 = J;
        } else {
            const k = e - HN;
            J = (k / W) | 0;
            I = k - J * W;
            I2 = I;
            J2 = J + 1;
        }
        const padA = isPad(I, J);
        if (padA || isPad(I2, J2)) {
            // Crossing with the virtual outside ring: snap onto the real (inside) node.
            cx[e] = padA ? xs[I2 - 1] : xs[I - 1];
            cy[e] = padA ? ys[J2 - 1] : ys[J - 1];
            return;
        }
        const ax = xs[I - 1];
        const ay = ys[J - 1];
        const bx = xs[I2 - 1];
        const by = ys[J2 - 1];
        const va = val[J * W + I];
        const vb = val[J2 * W + I2];
        if (Number.isFinite(va) && Number.isFinite(vb)) {
            const t = Math.min(1, Math.max(0, va / (va - vb)));
            cx[e] = I === I2 ? ax : ax + t * (bx - ax);
            cy[e] = J === J2 ? ay : ay + t * (by - ay);
            return;
        }
        // A non-finite node: bisect on the inside predicate, keep the inside end.
        const aIn = ins[J * W + I] === 1;
        let ix = aIn ? ax : bx;
        let iy = aIn ? ay : by;
        let ox = aIn ? bx : ax;
        let oy = aIn ? by : ay;
        for (let s = 0; s < EDGE_BISECT_STEPS; s++) {
            const mx = 0.5 * (ix + ox);
            const my = 0.5 * (iy + oy);
            if (evalFlat(flat, mx, my) <= 0) {
                ix = mx;
                iy = my;
            } else {
                ox = mx;
                oy = my;
            }
        }
        cx[e] = ix;
        cy[e] = iy;
    };
    const link = (s: number, t: number): void => {
        crossing(s);
        crossing(t);
        next[s] = t;
        starts.push(s);
    };

    for (let J = 0; J < H - 1; J++) {
        for (let I = 0; I < W - 1; I++) {
            const bl = J * W + I;
            const code = ins[bl] | (ins[bl + 1] << 1) | (ins[bl + W + 1] << 2) | (ins[bl + W] << 3);
            if (code === 0 || code === 15) continue;
            // Cell edges in CCW order: B (bl-br), R (br-tr), T (tr-tl), L (tl-bl).
            const eB = J * HW + I;
            const eT = eB + HW;
            const eL = HN + J * W + I;
            const eR = eL + 1;
            if (code === 5 || code === 10) {
                // Saddle (never next to padding): the centre value decides which corners connect.
                const centreIn = evalFlat(flat, 0.5 * (xs[I - 1] + xs[I]), 0.5 * (ys[J - 1] + ys[J])) <= 0;
                if (code === 5) {
                    // bl, tr inside: B and T are in->out (start), R and L out->in (end).
                    if (centreIn) {
                        link(eB, eR);
                        link(eT, eL);
                    } else {
                        link(eB, eL);
                        link(eT, eR);
                    }
                } else if (centreIn) {
                    link(eR, eT);
                    link(eL, eB);
                } else {
                    link(eR, eB);
                    link(eL, eT);
                }
                continue;
            }
            // One in->out crossing (segment start) and one out->in crossing (end) along the CCW walk.
            let s = -1;
            let t = -1;
            for (let k = 0; k < 4; k++) {
                const a = (code >> k) & 1;
                const b = (code >> ((k + 1) & 3)) & 1;
                if (a === b) continue;
                const e = k === 0 ? eB : k === 1 ? eR : k === 2 ? eT : eL;
                if (a) s = e;
                else t = e;
            }
            if (s >= 0 && t >= 0) link(s, t);
        }
    }

    const seen = new Uint8Array(NE);
    const area0 = 1e-10 * (view.xmax - view.xmin) * (view.ymax - view.ymin);
    const bufs: RingBuf[] = [];
    for (const s of starts) {
        if (seen[s]) continue;
        const rx: number[] = [];
        const ry: number[] = [];
        let e = s;
        let closed = false;
        while (e >= 0 && !seen[e]) {
            seen[e] = 1;
            const last = rx.length - 1;
            if (last < 0 || rx[last] !== cx[e] || ry[last] !== cy[e]) {
                rx.push(cx[e]);
                ry.push(cy[e]);
            }
            e = next[e];
            if (e === s) closed = true;
        }
        if (!closed) continue;
        while (rx.length > 1 && rx[rx.length - 1] === rx[0] && ry[ry.length - 1] === ry[0]) {
            rx.pop();
            ry.pop();
        }
        removeSpikes(rx, ry);
        if (rx.length < 3 || Math.abs(shoelace(rx, ry)) <= area0) continue;
        const ring = tagRing(rx, ry, ctx);
        if (ring.x.length >= 3) bufs.push(ring);
    }
    return buildRegion(bufs, ctx, false);
}

/**
 * Remove zero-width spikes A, B, A (a sliver narrower than a cell between
 * two boundaries that both pass through grid nodes, where G is exactly 0):
 * the tip B and the repeated A go, the ring keeps the first A.
 */
function removeSpikes(rx: number[], ry: number[]): void {
    let changed = true;
    while (changed && rx.length >= 3) {
        changed = false;
        const n = rx.length;
        for (let k = 0; k < n; k++) {
            const p = (k + n - 1) % n;
            const q = (k + 1) % n;
            if (rx[p] !== rx[q] || ry[p] !== ry[q]) continue;
            // Remove k and q (q may wrap to index 0).
            const drop = [k, q].sort((a, b) => b - a);
            for (const d of drop) {
                rx.splice(d, 1);
                ry.splice(d, 1);
            }
            changed = true;
            break;
        }
    }
}

function shoelace(xs: ArrayLike<number>, ys: ArrayLike<number>): number {
    const n = xs.length;
    if (n < 3) return 0;
    const x0 = xs[0];
    const y0 = ys[0];
    let s = 0;
    for (let k = 1; k + 1 < n; k++) s += (xs[k] - x0) * (ys[k + 1] - y0) - (xs[k + 1] - x0) * (ys[k] - y0);
    return s / 2;
}

/**
 * Tag the edges of a marching-squares ring and insert exact corners.
 * Border edges (both endpoints on the same view border line) take the first
 * constraint with |g| <= tol at both endpoints, else 'view'. Interior edges
 * follow the active constraint with hysteresis, where "active" compares
 * first-order distances in cells (g / |grad g| with the cell as unit square)
 * rather than raw g, so constraints of very different magnitude switch at
 * the right place. Where two different constraint tags meet, a guarded
 * Newton solve inserts the exact corner. Finally straight runs along the
 * border collapse to their end points.
 */
function tagRing(rx: number[], ry: number[], ctx: RegionCtx): RingBuf {
    const { flat, view, tols } = ctx;
    const list = flat.list;
    const m = list.length;
    const n = rx.length;
    const onB = new Uint8Array(n);
    const gv = new Float64Array(n * m);
    const dv = new Float64Array(n * m);
    const act = new Int32Array(n);
    const dec = new Float64Array(n);
    for (let k = 0; k < n; k++) {
        onB[k] = borderBits(rx[k], ry[k], view);
        const off = k * m;
        for (let c = 0; c < m; c++) {
            const g = list[c].g(rx[k], ry[k]);
            gv[off + c] = g;
            dv[off + c] = cellsSigned(c, g, rx[k], ry[k], ctx);
        }
        act[k] = activeOf(flat, dv, off);
        dec[k] = decisiveness(dv, off, m, act[k]);
    }
    const absG = (k: number, c: number): number => Math.abs(gv[k * m + c]);
    const absD = (k: number, c: number): number => Math.abs(dv[k * m + c]);
    // Constraints closer than this (in cells) count as coincident: no switch.
    const thr = CORNER_REL * Math.max(ctx.nx, ctx.ny);
    // A ring point this close (in cells) to its active constraint lies on it.
    const onCells = 0.1;

    const tag = new Int32Array(n).fill(-1);
    const isB = new Uint8Array(n);
    let firstB = -1;
    for (let k = 0; k < n; k++) {
        const k1 = k + 1 === n ? 0 : k + 1;
        if (!(onB[k] & onB[k1])) continue;
        isB[k] = 1;
        if (firstB < 0) firstB = k;
        const on = (c: number): boolean => c >= 0 && absG(k, c) <= tols[c] && absG(k1, c) <= tols[c];
        if (on(act[k])) tag[k] = act[k];
        else if (on(act[k1])) tag[k] = act[k1];
        else {
            for (let c = 0; c < m; c++) {
                if (on(c)) {
                    tag[k] = c;
                    break;
                }
            }
        }
    }

    // Hysteresis: switch from `cur` to the active constraint only when it
    // leads (|d_cur| - |d_new|) by more than `thr` cells at two consecutive
    // ring points. q lists the run's points; edge i is q[i] -> q[i + 1].
    const track = (q: number[], cyclic: boolean): void => {
        const L = q.length - 1;
        let cur = -1;
        if (cyclic) cur = act[q[0]];
        else {
            // The run starts on the border: at a crossing of the border with a
            // constraint, or at a border node (inside) that lies on no boundary.
            const a0 = act[q[0]];
            if (a0 >= 0 && dec[q[0]] > thr && absD(q[0], a0) <= onCells) cur = a0;
            for (let i = 1; i < L && cur < 0; i++) {
                const a = act[q[i]];
                if (a >= 0 && dec[q[i]] > thr) cur = a;
            }
            if (cur < 0) cur = L > 1 ? act[q[1]] : midActive(rx, ry, q[0], q[1], ctx);
        }
        tag[q[0]] = cur;
        for (let i = 1; i < L; i++) {
            const k = q[i];
            const c = act[k];
            if (c >= 0 && cur >= 0 && c !== cur && absD(k, cur) - absD(k, c) > thr) {
                let ok = true;
                if (i + 1 < L || cyclic) {
                    const k2 = q[i + 1];
                    ok = act[k2] === c && absD(k2, cur) - absD(k2, c) > thr;
                }
                if (ok) cur = c;
            } else if (cur < 0) cur = c;
            tag[k] = cur;
        }
        if (!cyclic && L >= 2) {
            // The run ends on the border where another constraint crosses it:
            // the last edge cuts a corner within one cell, so it belongs to
            // that constraint and the corner goes in before it.
            const kL = q[L];
            const c = act[kL];
            if (c >= 0 && cur >= 0 && c !== cur && absD(kL, c) <= onCells && absD(kL, cur) - absD(kL, c) > thr) {
                tag[q[L - 1]] = c;
            }
        }
    };
    if (firstB < 0) {
        let s = 0;
        for (let k = 1; k < n; k++) if (dec[k] > dec[s]) s = k;
        const q: number[] = [];
        for (let i = 0; i <= n; i++) q.push((s + i) % n);
        track(q, true);
    } else {
        let k = (firstB + 1) % n;
        let steps = 0;
        while (steps < n) {
            if (isB[k]) {
                k = (k + 1) % n;
                steps++;
                continue;
            }
            const q = [k];
            while (!isB[k] && steps < n) {
                k = (k + 1) % n;
                q.push(k);
                steps++;
            }
            track(q, false);
        }
    }

    // Exact corners where two different constraint tags meet.
    const out: RingBuf = { x: [], y: [], t: [], corner: [] };
    const push = (x: number, y: number, t: number, corner: boolean): void => {
        out.x.push(x);
        out.y.push(y);
        out.t.push(t);
        out.corner.push(corner);
    };
    // A ring that is only a few cells across (a sliver cut off at the grid
    // resolution) may solve both of its switches to the same corner; inserting
    // it twice would twist the ring into a bow tie.
    const used: Pt[] = [];
    const fresh = (c: Pt): boolean => {
        if (used.some((u) => Math.hypot((u.x - c.x) / ctx.cw, (u.y - c.y) / ctx.ch) <= 1e-6)) return false;
        used.push(c);
        return true;
    };
    for (let k = 0; k < n; k++) {
        const tin = tag[(k + n - 1) % n];
        const tout = tag[k];
        let x = rx[k];
        let y = ry[k];
        let corner = false;
        if (tin >= 0 && tout >= 0 && tin !== tout) {
            const p = (k + n - 1) % n;
            const q = (k + 1) % n;
            const c = solveCorner(tin, tout, x, y, ctx, [rx[p], ry[p], x, y, rx[q], ry[q]]);
            if (c && fresh(c)) {
                if (Math.hypot((c.x - x) / ctx.cw, (c.y - y) / ctx.ch) <= 1e-9) {
                    x = c.x;
                    y = c.y;
                    corner = true;
                } else if (cellsToZero(list[tin], x, y, ctx.cw, ctx.ch) < cellsToZero(list[tout], x, y, ctx.cw, ctx.ch)) {
                    // This point still lies on the incoming constraint: the corner follows it.
                    push(x, y, tin, false);
                    push(c.x, c.y, tout, true);
                    continue;
                } else {
                    push(c.x, c.y, tout, true);
                }
            }
        }
        push(x, y, tout, corner);
    }
    dedupeRing(out, view);
    if (!(shoelace(out.x, out.y) * shoelace(rx, ry) > 0)) {
        // Corner insertion folded a tiny ring over: keep the sampled outline.
        out.x = rx.slice();
        out.y = ry.slice();
        out.t = Array.from(tag);
        out.corner = rx.map(() => false);
    }

    // Collapse straight runs along one border line that keep the same tag.
    const n2 = out.x.length;
    if (n2 <= 3) return out;
    const bits = out.x.map((x, k) => borderBits(x, out.y[k], view));
    const res: RingBuf = { x: [], y: [], t: [], corner: [] };
    for (let k = 0; k < n2; k++) {
        const p = (k + n2 - 1) % n2;
        const q = (k + 1) % n2;
        if (!out.corner[k] && out.t[p] === out.t[k] && (bits[p] & bits[k] & bits[q]) !== 0) continue;
        res.x.push(out.x[k]);
        res.y.push(out.y[k]);
        res.t.push(out.t[k]);
        res.corner.push(out.corner[k]);
    }
    return res;
}

/** How clearly one constraint is active: min over others of |d_other| - |d_active|. */
function decisiveness(dv: Float64Array, off: number, m: number, a: number): number {
    if (a < 0) return -Infinity;
    const da = Math.abs(dv[off + a]);
    let d = Infinity;
    for (let c = 0; c < m; c++) {
        if (c === a) continue;
        const v = Math.abs(dv[off + c]) - da;
        if (v < d) d = v;
    }
    return Number.isNaN(d) ? -Infinity : d;
}

/** Active constraint at the midpoint of a ring edge (single-edge runs). */
function midActive(rx: number[], ry: number[], a: number, b: number, ctx: RegionCtx): number {
    const x = 0.5 * (rx[a] + rx[b]);
    const y = 0.5 * (ry[a] + ry[b]);
    const d = new Float64Array(ctx.flat.list.length);
    for (let c = 0; c < d.length; c++) d[c] = cellsSigned(c, ctx.flat.list[c].g(x, y), x, y, ctx);
    return activeOf(ctx.flat, d, 0);
}

/** Gradient of c at (x, y) where g = c.g(x, y): exact when affine, else forward differences (steps hx, hy). */
function gradient(c: Constraint, g: number, x: number, y: number, hx: number, hy: number): Pt {
    const af = usableAffine(c);
    if (af) return { x: af.a, y: af.b };
    return { x: (c.g(x + hx, y) - g) / hx, y: (c.g(x, y + hy) - g) / hy };
}

/**
 * Signed first-order distance from (x, y) to the zero set of c, in cells
 * (the grid cell is the unit square), given g = c.g(x, y). NaN when the
 * gradient is unusable.
 */
function cellsTo(c: Constraint, g: number, x: number, y: number, cw: number, ch: number): number {
    if (!Number.isFinite(g) || g === 0) return g;
    const gr = gradient(c, g, x, y, cw * 1e-6, ch * 1e-6);
    const n = Math.hypot(gr.x * cw, gr.y * ch);
    return Number.isFinite(n) && n > 0 ? g / n : NaN;
}

/** Unsigned cellsTo, Infinity when unknown. */
function cellsToZero(c: Constraint, x: number, y: number, cw: number, ch: number): number {
    const d = Math.abs(cellsTo(c, c.g(x, y), x, y, cw, ch));
    return Number.isNaN(d) ? Infinity : d;
}

/** cellsTo for constraint index ci of a region, falling back to g scaled by the constraint's magnitude. */
function cellsSigned(ci: number, g: number, x: number, y: number, ctx: RegionCtx): number {
    const d = cellsTo(ctx.flat.list[ci], g, x, y, ctx.cw, ctx.ch);
    return Number.isNaN(d) && Number.isFinite(g) ? (g * Math.max(ctx.nx, ctx.ny)) / ctx.scales[ci] : d;
}

/**
 * At most NEWTON_STEPS damped Newton steps on g_a = g_b = 0 from (x, y)
 * with a forward difference Jacobian (steps hx, hy). Returns the point when
 * the residual max(|g_a| / sA, |g_b| / sB) ends within CORNER_REL, else null.
 */
function newtonCorner(
    A: Constraint,
    B: Constraint,
    x: number,
    y: number,
    sA: number,
    sB: number,
    hx: number,
    hy: number
): Pt | null {
    let g1 = A.g(x, y);
    let g2 = B.g(x, y);
    let r = Math.max(Math.abs(g1) / sA, Math.abs(g2) / sB);
    if (!Number.isFinite(r)) return null;
    for (let it = 0; it < NEWTON_STEPS && r > 1e-15; it++) {
        const a11 = (A.g(x + hx, y) - g1) / hx;
        const a12 = (A.g(x, y + hy) - g1) / hy;
        const a21 = (B.g(x + hx, y) - g2) / hx;
        const a22 = (B.g(x, y + hy) - g2) / hy;
        const det = a11 * a22 - a12 * a21;
        const norm = (Math.abs(a11) + Math.abs(a12)) * (Math.abs(a21) + Math.abs(a22));
        if (!Number.isFinite(det) || Math.abs(det) <= 1e-12 * norm) return null;
        const dx = -(a22 * g1 - a12 * g2) / det;
        const dy = -(a11 * g2 - a21 * g1) / det;
        let lam = 1;
        let moved = false;
        for (let h = 0; h < 5; h++) {
            const tx = x + lam * dx;
            const ty = y + lam * dy;
            const n1 = A.g(tx, ty);
            const n2 = B.g(tx, ty);
            const nr = Math.max(Math.abs(n1) / sA, Math.abs(n2) / sB);
            if (Number.isFinite(nr) && nr < r) {
                x = tx;
                y = ty;
                g1 = n1;
                g2 = n2;
                r = nr;
                moved = true;
                break;
            }
            lam *= 0.5;
        }
        if (!moved) break;
    }
    return r <= CORNER_REL ? { x, y } : null;
}

/**
 * Solve g_a = g_b = 0 near the switch point (x0, y0): exactly for two
 * affine constraints, otherwise with newtonCorner. Accepted only when the
 * residual is within CORNER_REL * scale, the point lies within
 * CORNER_RADIUS cells of the switch (its two ring edges, `near` = [prev x,
 * y, switch x, y, next x, y]; the switch point equals (x0, y0)) or is the
 * tip of a sliver (sliverTip), inside the view, and on the region (other
 * constraints hold).
 */
function solveCorner(ia: number, ib: number, x0: number, y0: number, ctx: RegionCtx, near: number[]): Pt | null {
    const { flat, view, cw, ch } = ctx;
    const A = flat.list[ia];
    const B = flat.list[ib];
    const sA = ctx.scales[ia];
    const sB = ctx.scales[ib];
    const fa = usableAffine(A);
    const fb = usableAffine(B);
    const p = fa && fb ? intersectLines(fa, fb) : newtonCorner(A, B, x0, y0, sA, sB, cw * 1e-6, ch * 1e-6);
    if (!p) return null;
    let x = p.x;
    let y = p.y;
    if (!(Math.max(Math.abs(A.g(x, y)) / sA, Math.abs(B.g(x, y)) / sB) <= CORNER_REL)) return null;
    // Distance in cells to the ring edges around the switch point.
    const u = (x - x0) / cw;
    const v = (y - y0) / ch;
    const px = (near[0] - x0) / cw;
    const py = (near[1] - y0) / ch;
    const qx = (near[4] - x0) / cw;
    const qy = (near[5] - y0) / ch;
    const d2 = Math.min(segDist2(u, v, px, py, 0, 0), segDist2(u, v, 0, 0, qx, qy));
    if (!(d2 <= CORNER_RADIUS * CORNER_RADIUS) && !sliverTip(A, B, x0, y0, x, y, Math.sqrt(d2), cw, ch)) return null;
    const ex = 1e-9 * (view.xmax - view.xmin);
    const ey = 1e-9 * (view.ymax - view.ymin);
    if (Math.abs(x - view.xmin) <= ex) x = view.xmin;
    else if (Math.abs(x - view.xmax) <= ex) x = view.xmax;
    if (Math.abs(y - view.ymin) <= ey) y = view.ymin;
    else if (Math.abs(y - view.ymax) <= ey) y = view.ymax;
    if (x < view.xmin || x > view.xmax || y < view.ymin || y > view.ymax) return null;
    if (!insideRelaxed(flat, x, y, ctx.cornerSlack)) return null;
    return { x, y };
}

/**
 * Two boundaries meeting at an acute interior angle theta leave a sliver
 * narrower than a cell for about 1 / tan(theta / 2) cells before the
 * corner, and marching squares cuts that tip off. A corner `dist` cells
 * from the switch point (x0, y0) is still accepted within 0.5 + 1 /
 * tan(theta / 2) cells (at most TIP_RADIUS) when the chord to it stays
 * within half a cell of both feasible sides.
 */
function sliverTip(
    A: Constraint,
    B: Constraint,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    dist: number,
    cw: number,
    ch: number
): boolean {
    if (!(dist <= TIP_RADIUS)) return false;
    // Outward normals in cell space; theta = pi - (angle between them), so 1 / tan(theta / 2) = tan(phi / 2).
    const ga = gradient(A, A.g(x1, y1), x1, y1, cw * 1e-6, ch * 1e-6);
    const gb = gradient(B, B.g(x1, y1), x1, y1, cw * 1e-6, ch * 1e-6);
    const ax = ga.x * cw;
    const ay = ga.y * ch;
    const bx = gb.x * cw;
    const by = gb.y * ch;
    const cross = Math.abs(ax * by - ay * bx);
    const reach = 0.5 + (Math.hypot(ax, ay) * Math.hypot(bx, by) - (ax * bx + ay * by)) / cross;
    if (!(dist <= reach)) return false;
    const steps = Math.ceil(dist) + 1;
    for (let s = 1; s < steps; s++) {
        const x = x0 + (s / steps) * (x1 - x0);
        const y = y0 + (s / steps) * (y1 - y0);
        for (const c of [A, B]) {
            if (!(c.g(x, y) <= 0) && !(cellsToZero(c, x, y, cw, ch) <= 0.5)) return false;
        }
    }
    return true;
}

/** Turn ring buffers into the public RegionResult (ids, vertices, boundary runs, components). */
function buildRegion(bufs: RingBuf[], ctx: RegionCtx, exact: boolean): RegionResult {
    const { flat, view, cw, ch } = ctx;
    const area0 = 1e-10 * (view.xmax - view.xmin) * (view.ymax - view.ymin);
    const rings: Pt[][] = [];
    const tags: EdgeTag[][] = [];
    const areas: number[] = [];
    const boundary: Array<{ tag: number; line: Pt[] }> = [];
    const vertices: Array<Pt & { tags: [number, number] }> = [];
    const idOf = (t: number): EdgeTag => (t >= 0 ? flat.list[t].id : 'view');
    // Exact polygon corners are exact, so they are deduped at a scale-relative
    // tolerance: the corner set must not depend on the grid (draft, full and
    // export frames differ). Marching-squares corners are deduped per cell.
    const ux = exact ? CORNER_REL * (view.xmax - view.xmin) : cw;
    const uy = exact ? CORNER_REL * (view.ymax - view.ymin) : ch;
    for (const b of bufs) {
        const n = b.x.length;
        if (n < 3) continue;
        const ring: Pt[] = b.x.map((x, k) => ({ x, y: b.y[k] }));
        const area = ringArea(ring);
        if (!(Math.abs(area) > area0)) continue;
        rings.push(ring);
        areas.push(area);
        tags.push(b.t.map(idOf));
        for (let k = 0; k < n; k++) {
            const tin = b.t[(k + n - 1) % n];
            const tout = b.t[k];
            if (tin < 0 || tout < 0 || tin === tout || !b.corner[k]) continue;
            const p = ring[k];
            if (vertices.some((v) => Math.hypot((v.x - p.x) / ux, (v.y - p.y) / uy) < 1)) continue;
            vertices.push({ x: p.x, y: p.y, tags: [flat.list[tin].id, flat.list[tout].id] });
        }
        let start = -1;
        for (let k = 0; k < n; k++) {
            if (b.t[k] !== b.t[(k + n - 1) % n]) {
                start = k;
                break;
            }
        }
        if (start < 0) {
            if (b.t[0] >= 0) boundary.push({ tag: flat.list[b.t[0]].id, line: ring.concat([ring[0]]) });
            continue;
        }
        let k = start;
        let count = 0;
        while (count < n) {
            const t = b.t[k];
            const line = [ring[k]];
            while (count < n && b.t[k] === t) {
                k = (k + 1) % n;
                line.push(ring[k]);
                count++;
            }
            if (t >= 0) boundary.push({ tag: flat.list[t].id, line });
        }
    }
    if (!rings.length) return emptyRegion(exact);
    return { rings, tags, components: buildComponents(rings, areas), boundary, vertices, empty: false, exact };
}

/** Outer rings (CCW) with the holes (CW) they directly contain. */
function buildComponents(rings: Pt[][], areas: number[]): Array<{ outer: number; holes: number[] }> {
    const comps: Array<{ outer: number; holes: number[] }> = [];
    const compOf = new Map<number, number>();
    areas.forEach((a, i) => {
        if (a > 0) {
            compOf.set(i, comps.length);
            comps.push({ outer: i, holes: [] });
        }
    });
    areas.forEach((a, h) => {
        if (a >= 0) return;
        const hole = rings[h];
        const n = hole.length;
        const probes = [0, Math.floor(n / 3), Math.floor((2 * n) / 3)].map((k) => {
            const p = hole[k];
            const q = hole[(k + 1) % n];
            return { x: 0.5 * (p.x + q.x), y: 0.5 * (p.y + q.y) };
        });
        let best = -1;
        for (let o = 0; o < rings.length; o++) {
            if (areas[o] <= 0 || (best >= 0 && areas[o] >= areas[best])) continue;
            let votes = 0;
            for (const p of probes) if (pointInRings(p, [rings[o]])) votes++;
            if (votes >= 2) best = o;
        }
        const ci = best >= 0 ? compOf.get(best) : undefined;
        if (ci !== undefined) comps[ci].holes.push(h);
    });
    return comps;
}

// ----------------------------------------------------------------- contours

/**
 * Level curves F = level for each level, as polylines per level
 * (result[k] = polylines of levels[k]). F is sampled once on the grid.
 * When `affine` is given (F = a x + b y + c), each level is the exact
 * Liang-Barsky clip of the line to the view (one 2-point polyline or none).
 * Node convention: a node with F == level counts as above the level, so a
 * crossing never lands on a node twice. Discontinuity guard: drop a crossing
 * when |F(p) - level| at the interpolated point exceeds
 * |F(a) - level| + |F(b) - level| (sign change through a pole), or when a
 * short bisection along the edge finds a pole or a jump instead of a root.
 * Only crossings whose neighbouring steps look like a pole or a jump are
 * checked, so a smooth F is sampled exactly (nx + 1) (ny + 1) times.
 * Segments are joined into maximal polylines (closed loops repeat their first point).
 */
export function computeContours(
    F: (x: number, y: number) => number,
    levels: number[],
    view: View,
    grid: Grid,
    affine?: Affine | null
): Pt[][][] {
    const out: Pt[][][] = (levels || []).map(() => []);
    try {
        contoursImpl(F, levels || [], view, grid, affine || null, out);
    } catch {
        // Keep whatever levels completed.
    }
    return out;
}

function contoursImpl(
    F: (x: number, y: number) => number,
    levels: number[],
    view: View,
    grid: Grid,
    affine: Affine | null,
    out: Pt[][][]
): void {
    if (!levels.length || !validView(view)) return;
    if (affine && Number.isFinite(affine.a) && Number.isFinite(affine.b) && Number.isFinite(affine.c)) {
        levels.forEach((L, k) => {
            if (!Number.isFinite(L)) return;
            const seg = clipLineToView(affine.a, affine.b, affine.c - L, view);
            if (seg) out[k].push([seg[0], seg[1]]);
        });
        return;
    }
    const nx = cellCount(grid && grid.nx);
    const ny = cellCount(grid && grid.ny);
    const NX = nx + 1;
    const xs = nodeCoords(view.xmin, view.xmax, nx);
    const ys = nodeCoords(view.ymin, view.ymax, ny);
    const vals = new Float64Array(NX * (ny + 1));
    const fin = new Uint8Array(NX * (ny + 1));
    for (let j = 0, idx = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++, idx++) {
            const v = F(xs[i], ys[j]);
            vals[idx] = v;
            fin[idx] = Number.isFinite(v) ? 1 : 0;
        }
    }
    // Cells with a non-finite corner carry no contour.
    const cellOk = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const bl = j * NX + i;
            cellOk[j * nx + i] = fin[bl] & fin[bl + 1] & fin[bl + NX] & fin[bl + NX + 1];
        }
    }
    // Edge ids: horizontal (i, j)-(i+1, j), then vertical (i, j)-(i, j+1).
    const HN = nx * (ny + 1);
    const NE = HN + NX * ny;
    const cx = new Float64Array(NE);
    const cy = new Float64Array(NE);
    // Per-level stamps avoid clearing the arrays between levels.
    const crossSt = new Int32Array(NE);
    const valid = new Uint8Array(NE);
    const next = new Int32Array(NE);
    const nextSt = new Int32Array(NE);
    const prevSt = new Int32Array(NE);
    const seenSt = new Int32Array(NE);
    const below = new Uint8Array(NX * (ny + 1));

    for (let k = 0; k < levels.length; k++) {
        const L = levels[k];
        if (!Number.isFinite(L)) continue;
        const st = k + 1;
        for (let idx = 0; idx < below.length; idx++) below[idx] = vals[idx] < L ? 1 : 0;

        // Crossing on edge e, true when it is a valid (non-pole) crossing.
        const crossing = (e: number): boolean => {
            if (crossSt[e] === st) return valid[e] === 1;
            crossSt[e] = st;
            let ia: number;
            let ib: number;
            let horiz: boolean;
            if (e < HN) {
                const j = (e / nx) | 0;
                const i = e - j * nx;
                ia = j * NX + i;
                ib = ia + 1;
                horiz = true;
            } else {
                const r = e - HN;
                ia = r;
                ib = r + NX;
                horiz = false;
            }
            const da = vals[ia] - L;
            const db = vals[ib] - L;
            const t = Math.min(1, Math.max(0, da / (da - db)));
            const i0 = ia % NX;
            const j0 = (ia / NX) | 0;
            const px = horiz ? xs[i0] + t * (xs[i0 + 1] - xs[i0]) : xs[i0];
            const py = horiz ? ys[j0] : ys[j0] + t * (ys[j0 + 1] - ys[j0]);
            cx[e] = px;
            cy[e] = py;
            const ok = !suspicious(ia, ib, horiz, i0, j0) || confirmCrossing(px, py, xs, ys, i0, j0, horiz, da, db);
            valid[e] = ok ? 1 : 0;
            return ok;
        };
        // A crossing whose neighbouring slopes both run against it may be a pole.
        const suspicious = (ia: number, ib: number, horiz: boolean, i0: number, j0: number): boolean => {
            const s0 = vals[ib] - vals[ia];
            const step = horiz ? 1 : NX;
            const hasBefore = horiz ? i0 > 0 : j0 > 0;
            const hasAfter = horiz ? i0 + 2 <= nx : j0 + 2 <= ny;
            const before = hasBefore && fin[ia - step] ? vals[ia] - vals[ia - step] : NaN;
            const after = hasAfter && fin[ib + step] ? vals[ib + step] - vals[ib] : NaN;
            const revB = Number.isNaN(before) || before * s0 < 0;
            const revA = Number.isNaN(after) || after * s0 < 0;
            // A step much steeper than a neighbour may be a jump. A missing
            // neighbour (first / last cell of a row or column) does not count,
            // so an edge with no neighbour at all is always checked; comparing
            // with the flatter neighbour also catches a jump whose node takes
            // an intermediate value (sign(x) at 0), where both edges are steep.
            const refB = Number.isFinite(before) ? Math.abs(before) : Infinity;
            const refA = Number.isFinite(after) ? Math.abs(after) : Infinity;
            const ref = Math.min(refB, refA);
            const steep = Math.abs(s0) > 8 * (Number.isFinite(ref) ? ref : 0);
            return (revB && revA) || steep;
        };
        const confirmCrossing = (
            px: number,
            py: number,
            xsA: Float64Array,
            ysA: Float64Array,
            i0: number,
            j0: number,
            horiz: boolean,
            da: number,
            db: number
        ): boolean => {
            const fp = F(px, py) - L;
            if (!Number.isFinite(fp) || Math.abs(fp) > Math.abs(da) + Math.abs(db)) return false;
            const ax = xsA[i0];
            const ay = ysA[j0];
            const bx = horiz ? xsA[i0 + 1] : ax;
            const by = horiz ? ay : ysA[j0 + 1];
            const r = bisectSign((t) => F(ax + t * (bx - ax), ay + t * (by - ay)) - L, da, db, POLE_CHECK_STEPS);
            return !Number.isNaN(r);
        };

        const starts: number[] = [];
        const link = (s: number, t: number): void => {
            const okS = crossing(s);
            const okT = crossing(t);
            if (!okS || !okT) return;
            next[s] = t;
            nextSt[s] = st;
            prevSt[t] = st;
            starts.push(s);
        };
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                if (!cellOk[j * nx + i]) continue;
                const bl = j * NX + i;
                const code = below[bl] | (below[bl + 1] << 1) | (below[bl + NX + 1] << 2) | (below[bl + NX] << 3);
                if (code === 0 || code === 15) continue;
                const eB = j * nx + i;
                const eT = eB + nx;
                const eL = HN + j * NX + i;
                const eR = eL + 1;
                if (code === 5 || code === 10) {
                    // Saddle: the mean of the corners stands in for the centre (no extra sample).
                    const mean = 0.25 * (vals[bl] + vals[bl + 1] + vals[bl + NX] + vals[bl + NX + 1]);
                    const centreIn = mean < L;
                    if (code === 5) {
                        if (centreIn) {
                            link(eB, eR);
                            link(eT, eL);
                        } else {
                            link(eB, eL);
                            link(eT, eR);
                        }
                    } else if (centreIn) {
                        link(eR, eT);
                        link(eL, eB);
                    } else {
                        link(eR, eB);
                        link(eL, eT);
                    }
                    continue;
                }
                let s = -1;
                let t = -1;
                for (let q = 0; q < 4; q++) {
                    const a = (code >> q) & 1;
                    const b = (code >> ((q + 1) & 3)) & 1;
                    if (a === b) continue;
                    const e = q === 0 ? eB : q === 1 ? eR : q === 2 ? eT : eL;
                    if (a) s = e;
                    else t = e;
                }
                if (s >= 0 && t >= 0) link(s, t);
            }
        }

        const lines = out[k];
        const follow = (s: number, closedLoop: boolean): void => {
            const pts: Pt[] = [];
            let e = s;
            while (e >= 0 && seenSt[e] !== st) {
                seenSt[e] = st;
                const p = { x: cx[e], y: cy[e] };
                if (!pts.length || !samePt(pts[pts.length - 1], p)) pts.push(p);
                e = nextSt[e] === st ? next[e] : -1;
            }
            if (closedLoop && e === s && pts.length > 2) {
                if (!samePt(pts[pts.length - 1], pts[0])) pts.push({ x: pts[0].x, y: pts[0].y });
            }
            if (pts.length >= 2) lines.push(pts);
        };
        // Open chains start where no segment comes in; what is left are closed loops.
        for (const s of starts) if (prevSt[s] !== st && seenSt[s] !== st) follow(s, false);
        for (const s of starts) if (seenSt[s] !== st) follow(s, true);
    }
}

// ----------------------------------------------------------------- clipping

/** Liang-Barsky clip of the segment (x0, y0)-(x1, y1); entry / exit points land exactly on the border they cross. */
function clipSegment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    view: View
): { a: Pt; b: Pt; cutStart: boolean; cutEnd: boolean } | null {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    let side0 = -1;
    let side1 = -1;
    const ps = [-dx, dx, -dy, dy];
    const qs = [x0 - view.xmin, view.xmax - x0, y0 - view.ymin, view.ymax - y0];
    for (let i = 0; i < 4; i++) {
        const p = ps[i];
        const q = qs[i];
        if (p === 0) {
            if (q < 0) return null;
            continue;
        }
        const r = q / p;
        if (p < 0) {
            if (r > t1) return null;
            if (r > t0) {
                t0 = r;
                side0 = i;
            }
        } else {
            if (r < t0) return null;
            if (r < t1) {
                t1 = r;
                side1 = i;
            }
        }
    }
    const at = (t: number, side: number): Pt => {
        let x = t === 0 ? x0 : t === 1 ? x1 : x0 + t * dx;
        let y = t === 0 ? y0 : t === 1 ? y1 : y0 + t * dy;
        if (side === 0) x = view.xmin;
        else if (side === 1) x = view.xmax;
        else if (side === 2) y = view.ymin;
        else if (side === 3) y = view.ymax;
        x = Math.min(view.xmax, Math.max(view.xmin, x));
        y = Math.min(view.ymax, Math.max(view.ymin, y));
        return { x, y };
    };
    return { a: at(t0, side0), b: at(t1, side1), cutStart: t0 > 0, cutEnd: t1 < 1 };
}

/** Exact clip of the line a x + b y + c = 0 to the view, or null when it misses (or a = b = 0). */
export function clipLineToView(a: number, b: number, c: number, view: View): [Pt, Pt] | null {
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || (a === 0 && b === 0)) return null;
    if (!validView(view)) return null;
    let seg: { a: Pt; b: Pt } | null;
    // Parametrise along the axis the line is closer to, so the solved coordinate is well conditioned.
    if (Math.abs(b) >= Math.abs(a)) {
        const ya = -(a * view.xmin + c) / b;
        const yb = -(a * view.xmax + c) / b;
        seg = clipSegment(view.xmin, ya, view.xmax, yb, view);
    } else {
        const xa = -(b * view.ymin + c) / a;
        const xb = -(b * view.ymax + c) / a;
        seg = clipSegment(xa, view.ymin, xb, view.ymax, view);
    }
    if (!seg || samePt(seg.a, seg.b)) return null;
    return [seg.a, seg.b];
}

/** Clip a polyline to the view (Liang-Barsky per segment); returns the visible pieces. Non-finite points split the line. */
export function clipPolylineToView(pts: Pt[], view: View): Pt[][] {
    const out: Pt[][] = [];
    if (!pts || !validView(view)) return out;
    let cur: Pt[] | null = null;
    for (let k = 0; k + 1 < pts.length; k++) {
        const p = pts[k];
        const q = pts[k + 1];
        if (!finitePt(p) || !finitePt(q)) {
            cur = null;
            continue;
        }
        const seg = clipSegment(p.x, p.y, q.x, q.y, view);
        if (!seg) {
            cur = null;
            continue;
        }
        if (cur && !seg.cutStart && samePt(cur[cur.length - 1], seg.a)) cur.push(seg.b);
        else {
            cur = [seg.a, seg.b];
            out.push(cur);
        }
        if (seg.cutEnd) cur = null;
    }
    return out;
}

// ----------------------------------------------------------- simplification

/**
 * Douglas-Peucker in normalized view coordinates ((x - xmin) / xSpan,
 * (y - ymin) / ySpan) with tolerance `tolFrac` (e.g. 1e-3). Indices in
 * `keep` are never removed (exact corners). For closed rings the first
 * point is kept and the ring stays closed implicitly.
 */
export function simplifyPolyline(pts: Pt[], view: View, tolFrac: number, closed?: boolean, keep?: Set<number>): Pt[] {
    const n = pts ? pts.length : 0;
    if (n <= 2 || !(tolFrac > 0)) return pts ? pts.slice() : [];
    const xSpan = view && view.xmax - view.xmin;
    const ySpan = view && view.ymax - view.ymin;
    const sx = Number.isFinite(xSpan) && xSpan > 0 ? 1 / xSpan : 1;
    const sy = Number.isFinite(ySpan) && ySpan > 0 ? 1 / ySpan : 1;
    const u = new Float64Array(n);
    const v = new Float64Array(n);
    const mark = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
        u[k] = pts[k].x * sx;
        v[k] = pts[k].y * sy;
        // Non-finite points are kept: splitting them out is the caller's business.
        if (!Number.isFinite(u[k]) || !Number.isFinite(v[k])) mark[k] = 1;
    }
    if (keep) keep.forEach((i) => {
        if (i >= 0 && i < n && Number.isInteger(i)) mark[i] = 1;
    });
    mark[0] = 1;
    if (!closed) mark[n - 1] = 1;
    let anchors = 0;
    for (let k = 0; k < n; k++) anchors += mark[k];
    if (closed && anchors < 2) {
        // A second anchor: the point farthest from the first one.
        let far = 1;
        let best = -1;
        for (let k = 1; k < n; k++) {
            const d = (u[k] - u[0]) * (u[k] - u[0]) + (v[k] - v[0]) * (v[k] - v[0]);
            if (d > best) {
                best = d;
                far = k;
            }
        }
        mark[far] = 1;
    }
    const tol2 = tolFrac * tolFrac;
    const stack: number[] = [];
    let prev = 0;
    for (let k = 1; k <= n; k++) {
        if (k === n && !closed) break;
        if (k < n && !mark[k]) continue;
        stack.push(prev, k);
        prev = k;
    }
    while (stack.length) {
        const b = stack.pop() as number;
        const a = stack.pop() as number;
        if (b - a < 2) continue;
        const bi = b === n ? 0 : b;
        let best = -1;
        let idx = -1;
        for (let k = a + 1; k < b; k++) {
            const d = segDist2(u[k], v[k], u[a], v[a], u[bi], v[bi]);
            if (d > best) {
                best = d;
                idx = k;
            }
        }
        if (idx >= 0 && best > tol2) {
            mark[idx] = 1;
            stack.push(a, idx, idx, b);
        }
    }
    const out: Pt[] = [];
    for (let k = 0; k < n; k++) if (mark[k]) out.push(pts[k]);
    return out;
}

// ------------------------------------------------------------ ring queries

/** Signed shoelace area (positive = CCW). */
export function ringArea(ring: Pt[]): number {
    const n = ring ? ring.length : 0;
    if (n < 3) return 0;
    const x0 = ring[0].x;
    const y0 = ring[0].y;
    let s = 0;
    for (let k = 1; k + 1 < n; k++) {
        s += (ring[k].x - x0) * (ring[k + 1].y - y0) - (ring[k + 1].x - x0) * (ring[k].y - y0);
    }
    return s / 2;
}

/** Even-odd point-in-polygon test over all rings. */
export function pointInRings(p: Pt, rings: Pt[][]): boolean {
    let inside = false;
    if (!p || !rings) return false;
    for (const ring of rings) {
        const n = ring.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const a = ring[i];
            const b = ring[j];
            if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        }
    }
    return inside;
}

interface LabelCell {
    x: number;
    y: number;
    h: number;
    d: number;
    max: number;
}

/** Signed distance to the rings (positive inside, even-odd). */
function signedDist(px: number, py: number, rings: Pt[][]): number {
    let inside = false;
    let minD2 = Infinity;
    for (const ring of rings) {
        const n = ring.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const a = ring[i];
            const b = ring[j];
            if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
            const d2 = segDist2(px, py, a.x, a.y, b.x, b.y);
            if (d2 < minD2) minD2 = d2;
        }
    }
    return (inside ? 1 : -1) * Math.sqrt(minD2);
}

function labelCell(x: number, y: number, h: number, rings: Pt[][]): LabelCell {
    const d = signedDist(x, y, rings);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
}

/** Binary max-heap of cells keyed by `max`. */
class CellHeap {
    private items: LabelCell[] = [];

    get size(): number {
        return this.items.length;
    }

    push(c: LabelCell): void {
        const a = this.items;
        a.push(c);
        let i = a.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (a[p].max >= a[i].max) break;
            [a[p], a[i]] = [a[i], a[p]];
            i = p;
        }
    }

    pop(): LabelCell {
        const a = this.items;
        const top = a[0];
        const last = a.pop() as LabelCell;
        if (a.length) {
            a[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let m = i;
                if (l < a.length && a[l].max > a[m].max) m = l;
                if (r < a.length && a[r].max > a[m].max) m = r;
                if (m === i) break;
                [a[m], a[i]] = [a[i], a[m]];
                i = m;
            }
        }
        return top;
    }
}

/** Pole of inaccessibility (Mapbox polylabel) of rings[0] with holes rings[1..]. */
function polylabel(rings: Pt[][], precision: number): Pt {
    const outer = rings[0];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of outer) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    let cellSize = Math.min(width, height);
    if (!(cellSize > 0)) return { x: minX, y: minY };
    // Bound the initial cover for very elongated shapes.
    while ((width / cellSize) * (height / cellSize) > 4096) cellSize *= 2;
    const heap = new CellHeap();
    const h0 = cellSize / 2;
    for (let x = minX; x < maxX; x += cellSize) {
        for (let y = minY; y < maxY; y += cellSize) heap.push(labelCell(x + h0, y + h0, h0, rings));
    }
    // Seeds: area centroid of the outer ring and the bbox centre.
    let best = labelCell(minX + width / 2, minY + height / 2, 0, rings);
    let a = 0;
    let gx = 0;
    let gy = 0;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
        const p = outer[i];
        const q = outer[j];
        const f = p.x * q.y - q.x * p.y;
        gx += (p.x + q.x) * f;
        gy += (p.y + q.y) * f;
        a += f * 3;
    }
    if (a !== 0) {
        const c = labelCell(gx / a, gy / a, 0, rings);
        if (c.d > best.d) best = c;
    }
    let guard = 0;
    while (heap.size && guard++ < 20000) {
        const cell = heap.pop();
        if (cell.d > best.d) best = cell;
        if (cell.max - best.d <= precision) continue;
        const h = cell.h / 2;
        heap.push(labelCell(cell.x - h, cell.y - h, h, rings));
        heap.push(labelCell(cell.x + h, cell.y - h, h, rings));
        heap.push(labelCell(cell.x - h, cell.y + h, h, rings));
        heap.push(labelCell(cell.x + h, cell.y + h, h, rings));
    }
    return { x: best.x, y: best.y };
}

/** Area and area centroid of rings[0] minus holes rings[1..] (any orientation). */
function areaCentroid(rings: Pt[][]): { area: number; x: number; y: number } {
    let area = 0;
    let sx = 0;
    let sy = 0;
    rings.forEach((ring, k) => {
        let a = 0;
        let gx = 0;
        let gy = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const p = ring[i];
            const q = ring[j];
            const f = q.x * p.y - p.x * q.y;
            a += f;
            gx += (p.x + q.x) * f;
            gy += (p.y + q.y) * f;
        }
        if (a === 0) return;
        // Outer ring adds, holes subtract, whatever way they wind.
        const w = (k === 0 ? 1 : -1) * Math.abs(a) * 0.5;
        area += w;
        sx += (w * gx) / (3 * a);
        sy += (w * gy) / (3 * a);
    });
    return area > 0 ? { area, x: sx / area, y: sy / area } : { area: 0, x: NaN, y: NaN };
}

/**
 * Visually central point for a label, chosen so it does not hinge on the
 * marching-squares resolution (the preview's grid follows its on-screen
 * size, the export's is fixed). Works in normalized view coordinates
 * (0..1 on each axis):
 * 1. The component with the largest area; components within
 *    LABEL_AREA_TIE of it are tied and the one whose area centroid is
 *    highest (then rightmost, key 2y + x) wins.
 * 2. Its pole of inaccessibility (polylabel), with clearance d*.
 * 3. A fixed LABEL_LATTICE x LABEL_LATTICE lattice over the component's
 *    box collects the points with clearance >= d* - LABEL_TIE. When they
 *    all lie within LABEL_SPREAD of the pole, the pole is clear-cut and is
 *    the answer. Otherwise the spot is a near-tie (an annulus, a band): the
 *    candidate nearest the area centroid wins when it lies within
 *    LABEL_TIE of it, else the candidate in the direction closest to 60
 *    degrees from the centroid.
 * Null for an empty region.
 */
export function labelPoint(region: RegionResult, view: View): Pt | null {
    if (!region || region.empty || !region.rings || !region.rings.length || !validView(view)) return null;
    const comps =
        region.components && region.components.length
            ? region.components
            : [{ outer: 0, holes: region.rings.map((_, i) => i).slice(1) }];
    const xSpan = view.xmax - view.xmin;
    const ySpan = view.ymax - view.ymin;
    const norm = (ring: Pt[]): Pt[] => ring.map((p) => ({ x: (p.x - view.xmin) / xSpan, y: (p.y - view.ymin) / ySpan }));
    const denorm = (p: Pt): Pt => ({ x: view.xmin + p.x * xSpan, y: view.ymin + p.y * ySpan });
    // polylabel and the lattice cost points x edges, so dense marching-squares
    // rings are thinned first (far below the label precision); the exact rings are the fallback.
    const thin = (ring: Pt[]): Pt[] => {
        const s = ring.length > 64 ? simplifyPolyline(ring, view, LABEL_THIN, true) : ring;
        return s.length >= 3 ? s : ring;
    };

    const measured: Array<{ own: Pt[][]; area: number; cx: number; cy: number }> = [];
    for (const c of comps) {
        const ring = region.rings[c.outer];
        if (!ring || ring.length < 3) continue;
        const own = [ring];
        for (const h of c.holes) if (region.rings[h] && region.rings[h].length >= 3) own.push(region.rings[h]);
        const g = areaCentroid(own.map(norm));
        if (g.area > 0) measured.push({ own, area: g.area, cx: g.x, cy: g.y });
    }
    if (!measured.length) return null;
    const largest = Math.max(...measured.map((m) => m.area));
    let best = measured[0];
    let bestKey = -Infinity;
    for (const m of measured) {
        if (m.area < largest * (1 - LABEL_AREA_TIE)) continue;
        const key = 2 * m.cy + m.cx;
        if (key > bestKey) {
            bestKey = key;
            best = m;
        }
    }

    const own = best.own;
    let rings = own.map(thin).map(norm);
    let pole = polylabel(rings, 0.01 * Math.SQRT2);
    if (!pointInRings(denorm(pole), own)) {
        rings = own.map(norm);
        pole = polylabel(rings, 0.01 * Math.SQRT2);
    }
    const dStar = signedDist(pole.x, pole.y, rings);

    // Candidates on the fixed lattice: as clear as the pole, give or take LABEL_TIE.
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of rings[0]) {
        minU = Math.min(minU, p.x);
        maxU = Math.max(maxU, p.x);
        minV = Math.min(minV, p.y);
        maxV = Math.max(maxV, p.y);
    }
    const n = LABEL_LATTICE;
    const lo = (v: number) => Math.max(0, Math.ceil(v * n - 0.5));
    const hi = (v: number) => Math.min(n - 1, Math.floor(v * n - 0.5));
    const candidates: Array<{ x: number; y: number; d: number }> = [];
    let spread = 0;
    for (let i = lo(minU); i <= hi(maxU); i++) {
        const u = (i + 0.5) / n;
        for (let j = lo(minV); j <= hi(maxV); j++) {
            const v = (j + 0.5) / n;
            const d = signedDist(u, v, rings);
            if (d <= 0 || d < dStar - LABEL_TIE) continue;
            candidates.push({ x: u, y: v, d });
            spread = Math.max(spread, Math.hypot(u - pole.x, v - pole.y));
        }
    }
    if (!candidates.length || spread <= LABEL_SPREAD) return denorm(pole);

    // A near-tie: settle it by a rule that only depends on the shape.
    let pick = candidates[0];
    let near = Infinity;
    for (const c of candidates) {
        const dist = Math.hypot(c.x - best.cx, c.y - best.cy);
        if (dist < near - 1e-12) {
            near = dist;
            pick = c;
        }
    }
    if (near > LABEL_TIE) {
        let bestTurn = Infinity;
        for (const c of candidates) {
            const angle = Math.atan2(c.y - best.cy, c.x - best.cx);
            let turn = Math.abs(angle - LABEL_DIRECTION);
            if (turn > Math.PI) turn = 2 * Math.PI - turn;
            if (turn < bestTurn - 1e-9 || (Math.abs(turn - bestTurn) <= 1e-9 && c.d > pick.d)) {
                bestTurn = turn;
                pick = c;
            }
        }
    }
    return denorm(pick);
}

// ------------------------------------------------------------- root finding

/**
 * Roots of h on [lo, hi]: `samples` sign-change scan plus 50-step
 * bisection, exact zeros at sample points included, intervals with a
 * non-finite endpoint skipped, and a crossing rejected when |h| at the
 * midpoint of the bracket exceeds the bracket endpoint magnitudes
 * (pole) or the bracket values do not close in on each other (jump, e.g.
 * a step function passing zero). Deduped within (hi - lo) * 1e-7.
 *
 * With `touch`, zeros without a sign change are found too (a tangent line
 * touching a curve, a double root): every strict local minimum of |h| over
 * the samples (three finite, nonzero, same-sign values) is minimised by a
 * golden-section search between its neighbours, and the minimum x is a root
 * when touch(x, h(x)) accepts the residual. A minimum that dips through
 * zero hides two close crossings, which are bisected (or reported once
 * when touch accepts the dip as noise). At most TOUCH_CANDIDATES minima
 * per call are examined.
 */
export function findCrossings(
    h: (x: number) => number,
    lo: number,
    hi: number,
    samples?: number,
    touch?: (x: number, v: number) => boolean
): number[] {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return [];
    const n =
        typeof samples === 'number' && Number.isFinite(samples)
            ? Math.min(1000000, Math.max(1, Math.round(samples)))
            : ROOT_SAMPLES;
    const span = hi - lo;
    const roots: number[] = [];
    // Samples are kept only for the touch pass.
    const xs = touch ? new Float64Array(n + 1) : null;
    const vs = touch ? new Float64Array(n + 1) : null;
    let xa = lo;
    let va = h(lo);
    if (xs && vs) {
        xs[0] = xa;
        vs[0] = va;
    }
    if (va === 0) roots.push(lo);
    for (let k = 1; k <= n; k++) {
        const xb = k === n ? hi : lo + (span * k) / n;
        const vb = h(xb);
        if (xs && vs) {
            xs[k] = xb;
            vs[k] = vb;
        }
        if (vb === 0) roots.push(xb);
        else if (Number.isFinite(va) && Number.isFinite(vb) && va !== 0 && va < 0 !== vb < 0) {
            const x0 = xa;
            const dx = xb - xa;
            const t = bisectSign((s) => h(x0 + s * dx), va, vb, 50);
            if (!Number.isNaN(t)) roots.push(x0 + t * dx);
        }
        xa = xb;
        va = vb;
    }
    if (touch && xs && vs) touchRoots(h, xs, vs, touch, roots);
    roots.sort((a, b) => a - b);
    const out: number[] = [];
    const eps = span * 1e-7;
    for (const r of roots) if (!out.length || r - out[out.length - 1] > eps) out.push(r);
    return out;
}

/** Most local minima of |h| findCrossings examines for touching zeros. */
const TOUCH_CANDIDATES = 64;
/** Golden-section steps that locate a touching zero between two samples. */
const TOUCH_STEPS = 80;

/** Touch pass of findCrossings over the samples (xs, vs); pushes roots found. */
function touchRoots(
    h: (x: number) => number,
    xs: Float64Array,
    vs: Float64Array,
    touch: (x: number, v: number) => boolean,
    roots: number[]
): void {
    let examined = 0;
    for (let k = 1; k + 1 < xs.length && examined < TOUCH_CANDIDATES; k++) {
        const va = vs[k - 1];
        const vb = vs[k];
        const vc = vs[k + 1];
        if (!Number.isFinite(va) || !Number.isFinite(vb) || !Number.isFinite(vc)) continue;
        if (va === 0 || vb === 0 || vc === 0 || va < 0 !== vb < 0 || vb < 0 !== vc < 0) continue;
        // Strict local minimum of s h (s = sign of the three samples); plateaus are skipped.
        const s = vb < 0 ? -1 : 1;
        if (!(s * vb < s * va && s * vb <= s * vc)) continue;
        examined++;
        const lo = xs[k - 1];
        const hi = xs[k + 1];
        const g = goldenMax((x) => {
            const v = s * h(x);
            return Number.isFinite(v) ? -v : -Infinity;
        }, lo, hi, TOUCH_STEPS);
        const xm = g.s;
        const vm = h(xm);
        if (!Number.isFinite(vm)) continue;
        if (s * vm < 0 && !touch(xm, vm)) {
            // A real dip through zero: two crossings closer than a sample step.
            const left = bisectSign((t) => h(lo + t * (xm - lo)), va, vm, 50);
            const right = bisectSign((t) => h(xm + t * (hi - xm)), vm, vc, 50);
            if (!Number.isNaN(left)) roots.push(lo + left * (xm - lo));
            if (!Number.isNaN(right)) roots.push(xm + right * (hi - xm));
        } else if (vm === 0 || touch(xm, vm)) roots.push(xm);
    }
}

/** Points where F changes sign along the given polylines (bisection along each segment). */
export function crossingsAlongPolylines(polylines: Pt[][], F: (x: number, y: number) => number): Pt[] {
    const out: Pt[] = [];
    for (const line of polylines || []) {
        const n = line ? line.length : 0;
        if (!n) continue;
        const found: Pt[] = [];
        const add = (p: Pt): void => {
            if (!found.some((q) => samePt(q, p))) found.push(p);
        };
        let p = line[0];
        let vp = finitePt(p) ? F(p.x, p.y) : NaN;
        if (vp === 0) add({ x: p.x, y: p.y });
        for (let k = 1; k < n; k++) {
            const q = line[k];
            const vq = finitePt(q) ? F(q.x, q.y) : NaN;
            if (vq === 0) add({ x: q.x, y: q.y });
            else if (Number.isFinite(vp) && Number.isFinite(vq) && vp !== 0 && vp < 0 !== vq < 0) {
                const px = p.x;
                const py = p.y;
                const dx = q.x - px;
                const dy = q.y - py;
                const t = bisectSign((s) => F(px + s * dx, py + s * dy), vp, vq, 50);
                if (!Number.isNaN(t)) add({ x: px + t * dx, y: py + t * dy });
            }
            p = q;
            vp = vq;
        }
        for (const f of found) out.push(f);
    }
    return out;
}

/** Intersection of two lines a1 x + b1 y + c1 = 0 and a2 x + b2 y + c2 = 0, or null when parallel. */
export function intersectLines(l1: Affine, l2: Affine): Pt | null {
    if (!l1 || !l2) return null;
    const det = l1.a * l2.b - l2.a * l1.b;
    const scale = (Math.abs(l1.a) + Math.abs(l1.b)) * (Math.abs(l2.a) + Math.abs(l2.b));
    if (!Number.isFinite(det) || !(Math.abs(det) > 1e-14 * scale)) return null;
    const x = (l1.b * l2.c - l2.b * l1.c) / det;
    const y = (l2.a * l1.c - l1.a * l2.c) / det;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

// ------------------------------------------------------------- optimisation

export interface OptimumResult {
    /**
     * optimal: points hold the optimum (ties within 1e-9 relative, all kept).
     *   An optimal edge cut by the view still counts: its value is attained.
     * outside: the objective still improves beyond the view on a feasible
     *   direction, i.e. the optimum lies outside the visible part of the
     *   region. On the exact path (affine objective, exact region) this means
     *   a finite optimum outside the view; otherwise the problem may also be
     *   unbounded. Points hold the best visible candidate(s), which callers
     *   may draw dimmed.
     * unbounded: the objective improves without bound (up to 1e4 view spans
     *   away: the best point of the region grown that far lies on its border,
     *   or a feasible improving ray runs that far). Points as for 'outside'.
     * empty: the region has no point in the view.
     */
    status: 'optimal' | 'outside' | 'unbounded' | 'empty';
    points: Pt[];
    value: number;
}

/** One optimizer candidate. */
interface OptCand {
    x: number;
    y: number;
    /** Objective times the sense sign: larger is better. */
    v: number;
    /** Ring index and position along it (point index plus edge fraction); ring -1 for points off the rings. */
    ring: number;
    pos: number;
    /** Outward normals of the view-border edges the point lies on. */
    normals: Pt[];
    /**
     * Satisfies every constraint within the feasibility slack. Interpolated
     * marching-squares points on curved boundaries can sit slightly outside:
     * they steer the refinement but are never reported.
     */
    ok: boolean;
}

/**
 * Optimise obj over the region.
 * - objAffine and region.exact: evaluate the polygon corners exactly.
 * - otherwise: candidates = region vertices + boundary polyline points
 *   (long edges sampled about one cell apart) + interior grid nodes inside
 *   the region; refine the best 3 (golden section along their boundary
 *   run, projected onto the run's constraint, or a few Nelder-Mead steps on
 *   obj +/- penalty * max(0, G) for interior candidates), plus the exact
 *   corners of constraint pairs that are nearly active next to a refined
 *   point. Only points that satisfy every constraint within `insideTol`
 *   are reported. Budget about 3 ms.
 * Status (see OptimumResult): on the exact path the region is clipped once
 * more to the view grown by 1e4 spans (the constraints hold beyond the view)
 * and its best corner decides between 'optimal', 'outside' and 'unbounded'.
 * Otherwise an optimal point on a 'view' edge is 'outside' only when a step
 * across that edge stays feasible and improves the objective, and
 * 'unbounded' when that ray stays feasible and improving for 1e4 spans.
 */
export function optimizeOverRegion(
    obj: (x: number, y: number) => number,
    objAffine: Affine | null,
    region: RegionResult,
    set: ConstraintSet,
    view: View,
    grid: Grid,
    sense: 'max' | 'min'
): OptimumResult {
    try {
        return optimizeImpl(obj, objAffine, region, set, view, grid, sense);
    } catch {
        return { status: 'optimal', points: [], value: NaN };
    }
}

function optimizeImpl(
    obj: (x: number, y: number) => number,
    objAffine: Affine | null,
    region: RegionResult,
    set: ConstraintSet,
    view: View,
    grid: Grid,
    sense: 'max' | 'min'
): OptimumResult {
    if (!region || region.empty || !region.rings || !region.rings.length || !validView(view)) {
        return { status: 'empty', points: [], value: NaN };
    }
    const sgn = sense === 'min' ? -1 : 1;
    const xSpan = view.xmax - view.xmin;
    const ySpan = view.ymax - view.ymin;
    const cw = xSpan / cellCount(grid && grid.nx);
    const ch = ySpan / cellCount(grid && grid.ny);
    const af =
        objAffine && Number.isFinite(objAffine.a) && Number.isFinite(objAffine.b) && Number.isFinite(objAffine.c)
            ? objAffine
            : null;
    const f = af ? (x: number, y: number): number => af.a * x + af.b * y + af.c : obj;
    const score = (x: number, y: number): number => {
        const v = sgn * f(x, y);
        return Number.isFinite(v) ? v : -Infinity;
    };
    const cellDist = (a: Pt, b: Pt): number => Math.hypot((a.x - b.x) / cw, (a.y - b.y) / ch);
    const exactPath = !!af && region.exact;
    const flat = flatten(set);
    const scales = flat.list.map((c) => {
        const s = constraintScale(c, view);
        return Number.isFinite(s) && s > 0 ? s : 1;
    });
    const slack = scales.map((s) => TOL_REL * s + TOL_ABS);
    const byId = new Map<number, Constraint>();
    for (const c of flat.list) byId.set(c.id, c);
    const inView = (x: number, y: number): boolean =>
        x >= view.xmin - 1e-9 * xSpan &&
        x <= view.xmax + 1e-9 * xSpan &&
        y >= view.ymin - 1e-9 * ySpan &&
        y <= view.ymax + 1e-9 * ySpan;
    const feasible = (x: number, y: number): boolean => inView(x, y) && insideRelaxed(flat, x, y, slack);
    const viewNormals = (a: Pt, b: Pt, tag: EdgeTag | undefined): Pt[] =>
        tag === 'view' ? borderNormals(borderBits(a.x, a.y, view) & borderBits(b.x, b.y, view)) : [];
    const merge = (into: Pt[], more: Pt[]): Pt[] => {
        for (const nv of more) if (!into.some((q) => samePt(q, nv))) into.push(nv);
        return into;
    };

    const cands: OptCand[] = [];
    region.rings.forEach((ring, r) => {
        const tags = (region.tags && region.tags[r]) || [];
        const n = ring.length;
        for (let k = 0; k < n; k++) {
            const p = ring[k];
            const q = ring[(k + 1) % n];
            const v = score(p.x, p.y);
            if (v > -Infinity) {
                const normals = merge(viewNormals(ring[(k + n - 1) % n], p, tags[(k + n - 1) % n]), viewNormals(p, q, tags[k]));
                cands.push({ x: p.x, y: p.y, v, ring: r, pos: k, normals, ok: exactPath || feasible(p.x, p.y) });
            }
            if (exactPath) continue;
            // Long edges (polygon sides, straight border runs): samples about one cell apart.
            const len = cellDist(p, q);
            if (!(len > 2)) continue;
            const m = Math.min(EDGE_SAMPLES, Math.floor(len));
            const normals = viewNormals(p, q, tags[k]);
            for (let s = 1; s < m; s++) {
                const t = s / m;
                const x = p.x + t * (q.x - p.x);
                const y = p.y + t * (q.y - p.y);
                const sv = score(x, y);
                if (sv > -Infinity) cands.push({ x, y, v: sv, ring: r, pos: k + t, normals, ok: feasible(x, y) });
            }
        }
    });

    if (!exactPath) {
        // Interior candidates (a nonconstant affine objective peaks on the boundary only).
        if (!af || (af.a === 0 && af.b === 0)) {
            const kx = Math.min(OPT_INTERIOR, Math.round(xSpan / cw));
            const ky = Math.min(OPT_INTERIOR, Math.round(ySpan / ch));
            for (let j = 0; j < ky; j++) {
                const y = view.ymin + ((j + 0.5) * ySpan) / ky;
                for (let i = 0; i < kx; i++) {
                    const x = view.xmin + ((i + 0.5) * xSpan) / kx;
                    if (!(evalFlat(flat, x, y) <= 0)) continue;
                    const v = score(x, y);
                    if (v > -Infinity) cands.push({ x, y, v, ring: -1, pos: -1, normals: [], ok: true });
                }
            }
        }
        if (!cands.length) return { status: 'optimal', points: [], value: NaN };

        let lo = Infinity;
        let hi = -Infinity;
        for (const c of cands) {
            if (c.v < lo) lo = c.v;
            if (c.v > hi) hi = c.v;
        }
        const objRange = hi - lo;
        const minGain = 1e-9 * (objRange + Math.abs(hi));
        const hx = cw * 1e-5;
        const hy = ch * 1e-5;

        // Golden section along the ring around a boundary candidate: OPT_PATH
        // cells to either side, each point projected onto its edge's constraint.
        const alongRing = (c: OptCand): { p: Pt; v: number; normals: Pt[] } | null => {
            const ring = region.rings[c.ring];
            const tags = (region.tags && region.tags[c.ring]) || [];
            const n = ring.length;
            const k0 = Math.floor(c.pos);
            const frac = c.pos - k0;
            const idx = [k0, (k0 + 1) % n];
            const first = cellDist(ring[idx[0]], ring[idx[1]]);
            let back = frac * first;
            let fwd = (1 - frac) * first;
            let at0 = 0;
            while (back < OPT_PATH && idx.length < n) {
                const k = (idx[0] + n - 1) % n;
                back += cellDist(ring[k], ring[idx[0]]);
                idx.unshift(k);
                at0++;
            }
            while (fwd < OPT_PATH && idx.length <= n) {
                const last = idx[idx.length - 1];
                const k = (last + 1) % n;
                fwd += cellDist(ring[last], ring[k]);
                idx.push(k);
            }
            const pts = idx.map((k) => ring[k]);
            const segTags = idx.slice(0, -1).map((k) => tags[k]);
            const cum = [0];
            for (let j = 0; j < segTags.length; j++) cum.push(cum[j] + cellDist(pts[j], pts[j + 1]));
            const total = cum[segTags.length];
            if (!(total > 0)) return null;
            const locate = (s: number): number => {
                let j = 0;
                while (j < segTags.length - 1 && s > cum[j + 1]) j++;
                return j;
            };
            const at = (s: number): Pt | null => {
                const j = locate(s);
                const len = cum[j + 1] - cum[j];
                const t = len > 0 ? Math.min(1, Math.max(0, (s - cum[j]) / len)) : 0;
                const a = pts[j];
                const b = pts[j + 1];
                let p: Pt | null = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
                const tag = segTags[j];
                const con = typeof tag === 'number' ? byId.get(tag) : undefined;
                if (con) p = projectOnto(con, p.x, p.y, hx, hy);
                return p && feasible(p.x, p.y) ? p : null;
            };
            const value = (s: number): number => {
                const p = at(s);
                return p ? score(p.x, p.y) : -Infinity;
            };
            const g = goldenMax(value, 0, total, 60);
            // The candidate's own (projected) position guards against a multimodal path.
            const s0 = cum[at0] + frac * (cum[at0 + 1] - cum[at0]);
            const v0 = value(s0);
            const s = v0 > g.v ? s0 : g.s;
            const p = at(s);
            if (!p) return null;
            const j = locate(s);
            const normals = viewNormals(pts[j], pts[j + 1], segTags[j]);
            const eps = 1e-6 * total;
            if (j > 0 && s - cum[j] <= eps) merge(normals, viewNormals(pts[j - 1], pts[j], segTags[j - 1]));
            if (j + 1 < segTags.length && cum[j + 1] - s <= eps) merge(normals, viewNormals(pts[j + 1], pts[j + 2], segTags[j + 1]));
            return { p, v: score(p.x, p.y), normals };
        };

        // Nelder-Mead on -obj with an exact penalty on the violation (scaled so it dominates).
        const gScale = Math.max(1, ...scales);
        const penalty = 1e3 * (objRange + 1);
        const interior = (c: OptCand): { p: Pt; v: number; normals: Pt[] } | null => {
            const r = nelderMead(
                (x, y) => {
                    if (!inView(x, y)) return Infinity;
                    const v = score(x, y);
                    if (v === -Infinity) return Infinity;
                    const G = evalFlat(flat, x, y);
                    if (G > 0) return Number.isFinite(G) ? -v + penalty * (1 + G / gScale) : Infinity;
                    return -v;
                },
                c.x,
                c.y,
                cw,
                ch,
                120
            );
            if (!feasible(r.x, r.y)) return null;
            const p = {
                x: Math.min(view.xmax, Math.max(view.xmin, r.x)),
                y: Math.min(view.ymax, Math.max(view.ymin, r.y)),
            };
            return { p, v: score(p.x, p.y), normals: borderNormals(borderBits(p.x, p.y, view)) };
        };

        // Exact corners of constraint pairs nearly active next to p: a sliver
        // tip cut off at the grid resolution still yields its corner.
        const cornersNear = (p: Pt): void => {
            const near: number[] = [];
            for (let i = 0; i < flat.list.length && near.length < 4; i++) {
                if (cellsToZero(flat.list[i], p.x, p.y, cw, ch) <= 2) near.push(i);
            }
            for (let a = 0; a < near.length; a++) {
                for (let b = a + 1; b < near.length; b++) {
                    const A = flat.list[near[a]];
                    const B = flat.list[near[b]];
                    const fa = usableAffine(A);
                    const fb = usableAffine(B);
                    const q = fa && fb
                        ? intersectLines(fa, fb)
                        : newtonCorner(A, B, p.x, p.y, scales[near[a]], scales[near[b]], cw * 1e-6, ch * 1e-6);
                    if (!q || !(cellDist(p, q) <= TIP_RADIUS) || !feasible(q.x, q.y)) continue;
                    const v = score(q.x, q.y);
                    if (v > -Infinity) cands.push({ x: q.x, y: q.y, v, ring: -1, pos: -1, normals: [], ok: true });
                }
            }
        };

        // Refine the best 3 candidates that lie more than 3 cells apart.
        const order = cands.map((_, i) => i).sort((i, j) => cands[j].v - cands[i].v);
        const picked: number[] = [];
        for (const i of order) {
            if (picked.length >= 3) break;
            if (picked.every((j) => cellDist(cands[i], cands[j]) > 3)) picked.push(i);
        }
        for (const i of picked) {
            const c = cands[i];
            const r = c.ring >= 0 ? alongRing(c) : interior(c);
            if (r && (!c.ok || r.v > c.v + minGain)) {
                c.x = r.p.x;
                c.y = r.p.y;
                c.v = r.v;
                c.ring = -1;
                c.pos = -1;
                c.normals = r.normals;
                c.ok = true;
            }
            if (!region.exact) cornersNear(c);
        }
    }

    // Report only points that satisfy the constraints (all of them when none does).
    let pool = cands.filter((c) => c.ok);
    if (!pool.length) pool = cands;
    if (!pool.length) return { status: 'optimal', points: [], value: NaN };
    let best = -Infinity;
    let lo = Infinity;
    for (const c of pool) {
        if (c.v > best) best = c.v;
        if (c.v < lo) lo = c.v;
    }
    const tol = af
        ? 1e-9 * (Math.abs(af.a) * xSpan + Math.abs(af.b) * ySpan + Math.abs(best))
        : 1e-9 * (best - lo + Math.abs(best));
    const ties = pool.filter((c) => c.v >= best - tol);

    let points: Pt[];
    let status: OptimumResult['status'];
    if (exactPath) {
        points = [];
        for (const c of ties) if (!points.some((p) => samePt(p, c))) points.push({ x: c.x, y: c.y });
        status = exactStatus(flat, view, af, sgn, best);
    } else {
        points = collapseTies(ties, cands, region, cellDist);
        status = 'optimal';
        for (const c of ties) {
            const d = improvingStep(c, flat, f, score, cw, ch);
            if (!d) continue;
            status = improvesFar(c, d, flat, score, BEYOND * Math.max(xSpan / cw, ySpan / ch)) ? 'unbounded' : 'outside';
            if (status === 'unbounded') break;
        }
    }
    return { status, points, value: sgn * best };
}

/** The view grown by k view spans on every side. */
function grownView(view: View, k: number): View {
    const xs = view.xmax - view.xmin;
    const ys = view.ymax - view.ymin;
    return { xmin: view.xmin - k * xs, xmax: view.xmax + k * xs, ymin: view.ymin - k * ys, ymax: view.ymax + k * ys };
}

/**
 * Exact polygon of an all-affine set without `or`, clipped to the view grown
 * by BEYOND spans (with the tolerances of the original view, so lines on the
 * view border classify as before). Undefined when the set is not of that
 * kind, null when it has no point there.
 */
function clipBeyond(flat: Flat, view: View): RingBuf | null | undefined {
    if (!flat.andOnly || !flat.list.every((c) => usableAffine(c) !== null)) return undefined;
    const tols = flat.list.map((c) => insideTol(c, view));
    return clipExact(flat, grownView(view, BEYOND), tols);
}

/**
 * Whether the set has points outside the view (up to 1e4 view spans away):
 * true / false for sets of affine constraints without `or` (decided
 * exactly), null when unknown. Tells "R1 has no point in the view" from
 * "R1 is infeasible" when the visible region is empty.
 */
export function feasibleBeyondView(set: ConstraintSet, view: View): boolean | null {
    if (!validView(view)) return null;
    try {
        const big = clipBeyond(flatten(set), view);
        return big === undefined ? null : big !== null;
    } catch {
        return null;
    }
}

/**
 * Status of an affine objective over an exact region whose best visible
 * value is `best` (sense-signed): the best corner of the region grown by
 * BEYOND spans decides. Not better than `best`: the optimum is attained in
 * view. Better and on the grown border: unbounded. Better inside: outside.
 */
function exactStatus(flat: Flat, view: View, af: Affine, sgn: number, best: number): OptimumResult['status'] {
    const big = clipBeyond(flat, view);
    if (!big) return 'optimal';
    const gv = grownView(view, BEYOND);
    const gx = gv.xmax - gv.xmin;
    const gy = gv.ymax - gv.ymin;
    const vals = big.x.map((x, k) => sgn * (af.a * x + af.b * big.y[k] + af.c));
    let bb = -Infinity;
    for (const v of vals) if (v > bb) bb = v;
    const tol = 1e-9 * (Math.abs(af.a) * gx + Math.abs(af.b) * gy + Math.abs(bb));
    if (!(bb > best + tol)) return 'optimal';
    const ex = 1e-9 * gx;
    const ey = 1e-9 * gy;
    const onBorder = (x: number, y: number): boolean =>
        Math.abs(x - gv.xmin) <= ex || Math.abs(x - gv.xmax) <= ex || Math.abs(y - gv.ymin) <= ey || Math.abs(y - gv.ymax) <= ey;
    return vals.some((v, k) => v >= bb - tol && onBorder(big.x[k], big.y[k])) ? 'unbounded' : 'outside';
}

/** Fraction of a cell an outward probe steps (feasibility and gain are tested there). */
const PROBE_CELLS = 1e-3;

/**
 * A feasible direction across a view edge of tied candidate c along which
 * the objective improves (to first order, by at least a tenth of its
 * steepest gain), as a math-unit step one cell long; null when there is
 * none. Probes 17 directions within 80 degrees of each outward normal of the
 * view edges c lies on, so an active constraint at c (an optimal edge or
 * curve cut by the view) is respected.
 */
function improvingStep(
    c: OptCand,
    flat: Flat,
    f: (x: number, y: number) => number,
    score: (x: number, y: number) => number,
    cw: number,
    ch: number
): Pt | null {
    if (!c.normals.length) return null;
    const hx = 1e-6 * cw;
    const hy = 1e-6 * ch;
    const gx = (f(c.x + hx, c.y) - f(c.x - hx, c.y)) / (2 * hx);
    const gy = (f(c.x, c.y + hy) - f(c.x, c.y - hy)) / (2 * hy);
    // Steepest gain per cell; a flat objective never improves.
    const G = Math.hypot(gx * cw, gy * ch);
    if (!Number.isFinite(G) || !(G > 0)) return null;
    const base = score(c.x, c.y);
    for (const nv of c.normals) {
        for (let j = -8; j <= 8; j++) {
            const ang = (j / 9) * (Math.PI / 2);
            const dx = nv.x * Math.cos(ang) - nv.y * Math.sin(ang);
            const dy = nv.x * Math.sin(ang) + nv.y * Math.cos(ang);
            const x = c.x + PROBE_CELLS * dx * cw;
            const y = c.y + PROBE_CELLS * dy * ch;
            if (!(evalFlat(flat, x, y) <= 0)) continue;
            if (score(x, y) > base + 0.1 * PROBE_CELLS * G) return { x: dx * cw, y: dy * ch };
        }
    }
    return null;
}

/** The ray from c along step d stays feasible and keeps improving for `cells` steps (doubling distances). */
function improvesFar(c: OptCand, d: Pt, flat: Flat, score: (x: number, y: number) => number, cells: number): boolean {
    let prev = score(c.x, c.y);
    for (let s = 1; s <= cells; s *= 2) {
        const x = c.x + s * d.x;
        const y = c.y + s * d.y;
        if (!(evalFlat(flat, x, y) <= 0)) return false;
        const v = score(x, y);
        if (!(v > prev)) return false;
        prev = v;
    }
    return true;
}

/**
 * Reduce tied candidates to distinct points. Tied boundary candidates that
 * follow each other along a ring form one optimal stretch, reported by its
 * two ends (plus the polygon corners inside it on an exact region, as the
 * affine exact path reports every tied vertex). Two tied candidates are
 * neighbours when the arc between them is at most OPT_PATH cells long
 * (dense marching-squares rings) or no untied candidate of `cands` lies
 * between them (a polygon edge whose samples all tie). A ring whose
 * candidates all tie is reported by one point; other ties are deduped
 * within one cell.
 */
function collapseTies(ties: OptCand[], cands: OptCand[], region: RegionResult, cellDist: (a: Pt, b: Pt) => number): Pt[] {
    const out: Pt[] = [];
    const add = (p: Pt): void => {
        if (!out.some((q) => cellDist(p, q) < 1)) out.push({ x: p.x, y: p.y });
    };
    // Refined points first: they are the most accurate representatives.
    for (const c of ties) if (c.ring < 0) add(c);
    const tied = new Set(ties);
    const byRing = new Map<number, OptCand[]>();
    for (const c of cands) {
        if (c.ring < 0) continue;
        const list = byRing.get(c.ring);
        if (list) list.push(c);
        else byRing.set(c.ring, [c]);
    }
    byRing.forEach((list, r) => {
        const ring = region.rings[r];
        const n = ring.length;
        list.sort((a, b) => a.pos - b.pos);
        const at: number[] = [];
        list.forEach((c, i) => {
            if (tied.has(c)) at.push(i);
        });
        const T = at.length;
        if (!T) return;
        // Arc length (in cells) from the ring start to a ring position.
        const cum = [0];
        for (let k = 0; k < n; k++) cum.push(cum[k] + cellDist(ring[k], ring[(k + 1) % n]));
        const per = cum[n];
        const arc = (pos: number): number => {
            const k = Math.min(n - 1, Math.floor(pos));
            return cum[k] + (pos - k) * (cum[k + 1] - cum[k]);
        };
        // linked[i]: tied candidate at[i] continues into at[i + 1] (cyclically).
        const linked = at.map((li, i) => {
            if (T < 2) return false;
            const lj = at[(i + 1) % T];
            const a = list[li];
            const b = list[lj];
            const gap = (arc(b.pos) - arc(a.pos) + per) % per;
            const between = (lj - li - 1 + list.length) % list.length;
            return gap <= OPT_PATH || between === 0;
        });
        if (linked.every((l) => l)) {
            // The whole ring ties: any point represents it.
            add(list[at[0]]);
            return;
        }
        // Walk the stretches, starting right after a break so none is split by the wrap.
        const start = (linked.indexOf(false) + 1) % T;
        let i = start;
        do {
            const stretch = [list[at[i]]];
            while (linked[i]) {
                i = (i + 1) % T;
                stretch.push(list[at[i]]);
            }
            add(stretch[0]);
            if (region.exact) {
                for (let s = 1; s + 1 < stretch.length; s++) if (Number.isInteger(stretch[s].pos)) add(stretch[s]);
            }
            add(stretch[stretch.length - 1]);
            i = (i + 1) % T;
        } while (i !== start);
    });
    return out;
}

/** Project (x, y) onto c's zero set: exact for affine, else up to 4 Newton steps along the gradient. */
function projectOnto(c: Constraint, x: number, y: number, hx: number, hy: number): Pt | null {
    const af = usableAffine(c);
    if (af) {
        const n2 = af.a * af.a + af.b * af.b;
        if (!(n2 > 0)) return null;
        const d = (af.a * x + af.b * y + af.c) / n2;
        return { x: x - d * af.a, y: y - d * af.b };
    }
    for (let it = 0; it < 4; it++) {
        const g = c.g(x, y);
        if (!Number.isFinite(g)) return null;
        if (g === 0) break;
        const gx = (c.g(x + hx, y) - g) / hx;
        const gy = (c.g(x, y + hy) - g) / hy;
        const n2 = gx * gx + gy * gy;
        if (!Number.isFinite(n2) || !(n2 > 0)) return null;
        const dx = (g * gx) / n2;
        const dy = (g * gy) / n2;
        x -= dx;
        y -= dy;
        if (Math.abs(dx) <= hx * 1e-6 && Math.abs(dy) <= hy * 1e-6) break;
    }
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Golden-section search for the maximum of f on [lo, hi]. */
function goldenMax(f: (s: number) => number, lo: number, hi: number, iters: number): { s: number; v: number } {
    const r = (Math.sqrt(5) - 1) / 2;
    let a = lo;
    let b = hi;
    let c = b - r * (b - a);
    let d = a + r * (b - a);
    let fc = f(c);
    let fd = f(d);
    for (let i = 0; i < iters; i++) {
        if (fc >= fd) {
            b = d;
            d = c;
            fd = fc;
            c = b - r * (b - a);
            fc = f(c);
        } else {
            a = c;
            c = d;
            fc = fd;
            d = a + r * (b - a);
            fd = f(d);
        }
    }
    return fc >= fd ? { s: c, v: fc } : { s: d, v: fd };
}

/** Nelder-Mead minimisation in 2D from (x0, y0) with initial steps (sx, sy). */
function nelderMead(
    F: (x: number, y: number) => number,
    x0: number,
    y0: number,
    sx: number,
    sy: number,
    iters: number
): { x: number; y: number; v: number } {
    const px = [x0, x0 + sx, x0];
    const py = [y0, y0, y0 + sy];
    const pv = [F(px[0], py[0]), F(px[1], py[1]), F(px[2], py[2])];
    const set = (i: number, x: number, y: number, v: number): void => {
        px[i] = x;
        py[i] = y;
        pv[i] = v;
    };
    for (let it = 0; it < iters; it++) {
        const o = [0, 1, 2].sort((i, j) => pv[i] - pv[j] || 0);
        const b = o[0];
        const m = o[1];
        const w = o[2];
        const size = Math.max(
            Math.abs(px[m] - px[b]) / sx + Math.abs(py[m] - py[b]) / sy,
            Math.abs(px[w] - px[b]) / sx + Math.abs(py[w] - py[b]) / sy
        );
        if (size < 1e-10) break;
        const cx = 0.5 * (px[b] + px[m]);
        const cy = 0.5 * (py[b] + py[m]);
        const rx = 2 * cx - px[w];
        const ry = 2 * cy - py[w];
        const rv = F(rx, ry);
        if (rv < pv[b]) {
            const ex = 3 * cx - 2 * px[w];
            const ey = 3 * cy - 2 * py[w];
            const ev = F(ex, ey);
            if (ev < rv) set(w, ex, ey, ev);
            else set(w, rx, ry, rv);
        } else if (rv < pv[m]) {
            set(w, rx, ry, rv);
        } else {
            const outside = rv < pv[w];
            const kx = outside ? cx + 0.5 * (rx - cx) : cx + 0.5 * (px[w] - cx);
            const ky = outside ? cy + 0.5 * (ry - cy) : cy + 0.5 * (py[w] - cy);
            const kv = F(kx, ky);
            if (kv < (outside ? rv : pv[w])) set(w, kx, ky, kv);
            else {
                for (const i of [m, w]) {
                    const x = px[b] + 0.5 * (px[i] - px[b]);
                    const y = py[b] + 0.5 * (py[i] - py[b]);
                    set(i, x, y, F(x, y));
                }
            }
        }
    }
    let bi = 0;
    for (let i = 1; i < 3; i++) if (pv[i] < pv[bi]) bi = i;
    return { x: px[bi], y: py[bi], v: pv[bi] };
}

// ---------------------------------------------------------- lattice points

export interface LatticeOptions {
    /**
     * Scan only this box (intersected with the view), e.g. the bounding box
     * of an already computed region, so a small region in a big view is
     * scanned completely instead of running into the scan budget.
     */
    bounds?: View;
    /**
     * Keep only the best points of an objective (an integer optimum) instead
     * of the first `cap` points: every point of the scan is evaluated, values
     * within `tieRel` (relative, at least absolute 1) of the best are ties.
     * At most `cap` tied points are kept; `count` reports all of them.
     */
    select?: { f: (x: number, y: number) => number; sense: 'max' | 'min'; tieRel?: number };
}

export interface LatticeResult {
    points: Pt[];
    /**
     * Without `select`: more than `cap` points (only the first are returned),
     * or the scan budget (1e6 integer points) ran out. With `select`: the
     * scan budget ran out, so the optimum is the best of the points examined.
     */
    truncated: boolean;
    /** With `select`: the best objective value (NaN when no point has a finite value). */
    value?: number;
    /** With `select`: number of tied optimal points found (may exceed points.length). */
    count?: number;
    /** With `select`: number of feasible integer points examined. */
    inside?: number;
}

/**
 * Integer points (x, y both integers) in the view that satisfy every
 * constraint within `insideTol` (all points of the view when `set` is null).
 * At most `cap` (default 2000) points; `truncated` reports overflow. See
 * LatticeOptions for scanning a sub-box and for selecting an integer optimum.
 */
export function latticePoints(set: ConstraintSet | null, view: View, cap?: number, opts?: LatticeOptions): LatticeResult {
    const points: Pt[] = [];
    const select = opts && opts.select && typeof opts.select.f === 'function' ? opts.select : null;
    const none = (): LatticeResult => (select ? { points, truncated: false, value: NaN, count: 0, inside: 0 } : { points, truncated: false });
    if (!validView(view)) return none();
    const limit = typeof cap === 'number' && Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : LATTICE_CAP;
    const flat = set ? flatten(set) : null;
    const tols = flat ? flat.list.map((c) => insideTol(c, view)) : [];
    const ex = 1e-9 * (view.xmax - view.xmin);
    const ey = 1e-9 * (view.ymax - view.ymin);
    let x0 = view.xmin;
    let x1 = view.xmax;
    let y0 = view.ymin;
    let y1 = view.ymax;
    const b = opts && opts.bounds;
    if (b && Number.isFinite(b.xmin) && Number.isFinite(b.xmax) && Number.isFinite(b.ymin) && Number.isFinite(b.ymax)) {
        x0 = Math.max(x0, b.xmin);
        x1 = Math.min(x1, b.xmax);
        y0 = Math.max(y0, b.ymin);
        y1 = Math.min(y1, b.ymax);
    }
    if (flat && flat.andOnly && flat.list.every((c) => usableAffine(c) !== null)) {
        // Exact polygon: scan only its bounding box.
        const ring = clipExact(flat, view, tols);
        if (!ring) return none();
        x0 = Math.max(x0, Math.min(...ring.x));
        x1 = Math.min(x1, Math.max(...ring.x));
        y0 = Math.max(y0, Math.min(...ring.y));
        y1 = Math.min(y1, Math.max(...ring.y));
    }
    // `|| 0` turns -0 (rounding up a tiny negative edge) into 0.
    const i0 = Math.ceil(Math.max(view.xmin - ex, x0 - ex)) || 0;
    const i1 = Math.floor(Math.min(view.xmax + ex, x1 + ex));
    const j0 = Math.ceil(Math.max(view.ymin - ey, y0 - ey)) || 0;
    const j1 = Math.floor(Math.min(view.ymax + ey, y1 + ey));
    if (select) return latticeOptimum(flat, tols, i0, i1, j0, j1, limit, select);
    let scanned = 0;
    for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
            if (++scanned > LATTICE_SCAN) return { points, truncated: true };
            if (flat && !insideRelaxed(flat, i, j, tols)) continue;
            if (points.length >= limit) return { points, truncated: true };
            points.push({ x: i, y: j });
        }
    }
    return { points, truncated: false };
}

/**
 * Best integer points of an objective over [i0, i1] x [j0, j1] (feasible
 * ones only), keeping the running ties while scanning so no point of the
 * box is skipped. The tie tolerance grows with the best value, so the ties
 * are filtered once more against the final best.
 */
function latticeOptimum(
    flat: Flat | null,
    tols: number[],
    i0: number,
    i1: number,
    j0: number,
    j1: number,
    limit: number,
    select: NonNullable<LatticeOptions['select']>
): LatticeResult {
    const sign = select.sense === 'min' ? -1 : 1;
    const rel = typeof select.tieRel === 'number' && select.tieRel >= 0 ? select.tieRel : 1e-9;
    const tol = (top: number): number => rel * Math.max(1, Math.abs(top));
    let top = -Infinity;
    // At most `limit` ties are stored (a constant objective ties everywhere); the rest are counted.
    let ties: Array<Pt & { s: number }> = [];
    let unstored = 0;
    let inside = 0;
    let truncated = false;
    let scanned = 0;
    scan: for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
            if (++scanned > LATTICE_SCAN) {
                truncated = true;
                break scan;
            }
            if (flat && !insideRelaxed(flat, i, j, tols)) continue;
            inside++;
            const v = select.f(i, j);
            if (!Number.isFinite(v)) continue;
            const s = sign * v;
            if (s > top + tol(top)) {
                top = s;
                ties = [{ x: i, y: j, s }];
                unstored = 0;
            } else if (s >= top - tol(top)) {
                if (s > top) top = s;
                if (ties.length < limit) ties.push({ x: i, y: j, s });
                else unstored++;
            }
        }
    }
    if (top === -Infinity) return { points: [], truncated, value: NaN, count: 0, inside };
    const points = ties.filter((p) => p.s >= top - tol(top)).map((p) => ({ x: p.x, y: p.y }));
    return { points, truncated, value: sign * top, count: points.length + unstored, inside };
}
