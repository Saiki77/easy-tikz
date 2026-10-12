/*
 * Residual models of drag targets (SPEC3 2.4). A shape holds samples of the grabbed part (taken once at
 * drag start, in math coordinates and in the px frame) and evaluates its rows in screen px: how far the
 * object at the current numbers is from the samples moved by a gesture family member z.
 *
 * Pure: no DOM, no Obsidian. The closures come from the Evaluator (ev.fns), so the current numbers are
 * whatever the solver wrote into ev.values (and pushed with ev.apply()).
 */
import type { Evaluator } from './numbers';
import type { Family } from './solver';
import { familyAffine } from './solver';
import type { Compiled, Pt, ScreenMap, TargetKind } from './types';

export interface ShapeModel {
    /** Shape rows (0 for push / slide). Constant for the life of the shape (resample keeps the count). */
    readonly rows: number;
    /** Rows without the family: 1 for push / slide, else 0 (cursor rows of families are added by the solver). */
    readonly cursorRows: number;
    /** Shape rows for the current numbers (call ev.apply() before) and family member z (px). */
    eval(z: readonly [number, number], out: Float64Array, offset: number): void;
    /** Push / slide row(s) for a cursor in MATH coordinates (no-op for other shapes). */
    evalCursor(cursor: Pt, out: Float64Array, offset: number): void;
    /**
     * Refresh the row weights from the current numbers (SPEC3 2.4: once per event, frozen within the LM
     * iterations). `z` (optional addition): weights are taken at the samples moved by z, default z = 0.
     */
    refreshWeights(z?: readonly [number, number]): void;
    /**
     * Move the samples onto the current shape (re-base, SPEC3 2.4): graphs y = f(x) at the same x, implicit
     * shapes 3 Newton steps along grad G, points exact. `z` (optional addition): the samples are first moved
     * by that family member (the last solved z), so they land where the drawn shape is now.
     */
    resample(z?: readonly [number, number]): void;
    /** Samples in math coordinates (safety net points, orientation guard). */
    samples(): readonly Pt[];
    /** Optional addition: swap the family the rows are evaluated under (re-base from Move to Shift). */
    setFamily?(f: Family): void;
    /**
     * Optional addition (clause targets only): SPEC3 2.6 orientation guard at the current numbers and family
     * member z: false when a probe just inside the region (4 px along the inward normal at the first, middle
     * and last sample) is no longer inside after the drag.
     */
    orientationOk?(z: readonly [number, number]): boolean;
}

export interface ShapeInput {
    kind: TargetKind;
    ev: Evaluator;
    /** Unit index of each role inside ev.fns: graph [body]; clause [g]; curve [F]; level [F (fixed), L]; point / vertex / label [x, y]; path [x0, y0, x1, y1, ...]; tangent [x0]. */
    units: number[];
    /** Math polylines to sample (graphs: the grabbed run only) or the points of point-like targets. */
    lines: Pt[][];
    points: Pt[];
    map: ScreenMap;
    /** level: the fixed equation F and the grabbed level value (Shift) / level push uses ev for L. */
    F?: (x: number, y: number) => number;
    levelValue?: number;
    /** tangent: the function (fixed). */
    f?: (x: number) => number;
    /** Family the shape rows are evaluated under. */
    family: Family;
}

/*
 * Unit roles, as interpreted here (SPEC3 2.1 / 4.4):
 * - graph:   units[0] is the body f(x, NaN).
 * - clause:  units[0] is g(x, y), oriented so that g <= 0 inside (the orientation guard relies on it).
 * - curve:   units[0] is F(x, y); the curve is F = 0.
 * - level, push family: F = input.F, else ev.fns[units[0]]; L = the last unit when there are two units,
 *   the only unit when input.F is given, else input.levelValue. One cursor row (F(c) - L) * w(c).
 * - level, other families: G = F - L with F = ev.fns[units[0]] (its numbers move) and L = input.levelValue
 *   (else ev.fns[units[1]], else 0).
 * - point / vertex / label: units [x, y]; path: [x0, y0, x1, y1, ...]. A negative unit index keeps that
 *   coordinate at its start value (points[k]).
 * - tangent: units[0] is x0; one cursor row (x0 - cursor.x) * kx.
 */

/** Builds the residual model of a target. Samples are taken from `lines` / `points` at the current numbers. */
export function buildShape(input: ShapeInput): ShapeModel {
    switch (input.kind) {
        case 'graph':
            return new GraphShape(input);
        case 'clause':
            return new ImplicitShape(input, fnAt(input, 0), true);
        case 'curve':
            return new ImplicitShape(input, fnAt(input, 0), false);
        case 'level':
            return input.family.kind === 'push' ? new PushShape(input) : new ImplicitShape(input, levelG(input), false);
        case 'tangent':
            return new SlideShape(input);
        case 'point':
        case 'vertex':
        case 'label':
        case 'path':
            return new PointShape(input);
    }
}

// ------------------------------------------------------------------ helpers

const NAN2: Compiled = () => NaN;

function fnAt(input: ShapeInput, k: number): Compiled {
    const u = input.units[k];
    const f = u !== undefined && u >= 0 ? input.ev.fns[u] : undefined;
    return f || NAN2;
}

/** G = F - L for a level reshaped by Shift (F moves with its numbers, L is fixed). */
function levelG(input: ShapeInput): Compiled {
    const F = fnAt(input, 0);
    if (input.levelValue !== undefined && Number.isFinite(input.levelValue)) {
        const L = input.levelValue;
        return (x, y) => F(x, y) - L;
    }
    if (input.units.length > 1) {
        const L = fnAt(input, 1);
        return (x, y) => F(x, y) - L(NaN, NaN);
    }
    return F;
}

/** Central-difference step for a coordinate (SPEC3 2.4). */
function hStep(v: number): number {
    return 1e-6 * (1 + Math.abs(v));
}

/** px-frame length of the screen gradient of G at (x, y): sqrt((G_x / kx)^2 + (G_y / ky)^2). */
function gradPx(G: Compiled, x: number, y: number, kx: number, ky: number): { gx: number; gy: number; n: number } {
    const hx = hStep(x);
    const hy = hStep(y);
    const gx = (G(x + hx, y) - G(x - hx, y)) / (2 * hx);
    const gy = (G(x, y + hy) - G(x, y - hy)) / (2 * hy);
    const n = Math.sqrt((gx / kx) * (gx / kx) + (gy / ky) * (gy / ky));
    return { gx, gy, n };
}

/** Liang-Barsky: parameter range of segment a -> b inside the box, or null. */
function clipT(ax: number, ay: number, bx: number, by: number, x0: number, x1: number, y0: number, y1: number): [number, number] | null {
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return null;
            continue;
        }
        const t = q[i] / p[i];
        if (p[i] < 0) {
            if (t > t1) return null;
            if (t > t0) t0 = t;
        } else {
            if (t < t0) return null;
            if (t < t1) t1 = t;
        }
    }
    return t0 <= t1 ? [t0, t1] : null;
}

/** Polylines (math) clipped to the view inset by `inset` of each span, as px-frame pieces. */
function clipPieces(lines: readonly Pt[][], map: ScreenMap, inset: number): Pt[][] {
    const v = map.view;
    const ix = inset * (v.xmax - v.xmin);
    const iy = inset * (v.ymax - v.ymin);
    const x0 = (v.xmin + ix) * map.kx;
    const x1 = (v.xmax - ix) * map.kx;
    const y0 = (v.ymin + iy) * map.ky;
    const y1 = (v.ymax - iy) * map.ky;
    const pieces: Pt[][] = [];
    for (const line of lines) {
        let cur: Pt[] | null = null;
        for (let i = 0; i + 1 < line.length; i++) {
            const a = line[i];
            const b = line[i + 1];
            if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
                cur = null;
                continue;
            }
            const ax = a.x * map.kx;
            const ay = a.y * map.ky;
            const bx = b.x * map.kx;
            const by = b.y * map.ky;
            const t = clipT(ax, ay, bx, by, x0, x1, y0, y1);
            if (!t) {
                cur = null;
                continue;
            }
            const A = { x: ax + (bx - ax) * t[0], y: ay + (by - ay) * t[0] };
            const B = { x: ax + (bx - ax) * t[1], y: ay + (by - ay) * t[1] };
            const last = cur ? cur[cur.length - 1] : null;
            if (cur && last && Math.abs(last.x - A.x) < 1e-9 && Math.abs(last.y - A.y) < 1e-9) {
                cur.push(B);
            } else {
                cur = [A, B];
                pieces.push(cur);
            }
            // A clipped end leaves the box: the next segment starts a new piece.
            if (t[1] < 1) cur = null;
        }
    }
    return pieces;
}

function piecesLength(pieces: readonly Pt[][]): number {
    let L = 0;
    for (const p of pieces) for (let i = 0; i + 1 < p.length; i++) L += Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y);
    return L;
}

/**
 * SPEC3 2.4 samples: the polylines clipped to the view inset 2 % (falling back to the whole view, then to
 * the raw finite points), resampled by arclength, N = clamp(round(length_px / 12), 12, 48), at the
 * midpoints of N equal arclength slots. Returns math points.
 */
export function sampleLines(lines: readonly Pt[][], map: ScreenMap): Pt[] {
    let pieces = clipPieces(lines, map, 0.02);
    let L = piecesLength(pieces);
    if (!(L > 1e-9)) {
        pieces = clipPieces(lines, map, 0);
        L = piecesLength(pieces);
    }
    if (!(L > 1e-9)) {
        const pts: Pt[] = [];
        for (const line of lines) for (const p of line) if (Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push({ x: p.x, y: p.y });
        if (pts.length <= 48) return pts;
        const out: Pt[] = [];
        for (let k = 0; k < 48; k++) out.push(pts[Math.round((k * (pts.length - 1)) / 47)]);
        return out;
    }
    const N = Math.min(48, Math.max(12, Math.round(L / 12)));
    const out: Pt[] = [];
    let k = 0;
    let acc = 0;
    for (const p of pieces) {
        for (let i = 0; i + 1 < p.length && k < N; i++) {
            const seg = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y);
            while (k < N) {
                const s = ((k + 0.5) * L) / N;
                if (s > acc + seg) break;
                const t = seg > 0 ? (s - acc) / seg : 0;
                out.push({ x: (p[i].x + (p[i + 1].x - p[i].x) * t) / map.kx, y: (p[i].y + (p[i + 1].y - p[i].y) * t) / map.ky });
                k++;
            }
            acc += seg;
        }
    }
    // Rounding at the very end of the last piece.
    const lastPiece = pieces[pieces.length - 1];
    const end = lastPiece[lastPiece.length - 1];
    while (out.length < N) out.push({ x: end.x / map.kx, y: end.y / map.ky });
    return out;
}

/** Base class: samples in math and px coordinates and the current family as an affine map. */
abstract class SampledShape implements ShapeModel {
    abstract readonly rows: number;
    abstract readonly cursorRows: number;
    protected family: Family;
    protected readonly map: ScreenMap;
    /** Samples (math) and their px-frame coordinates. */
    protected sx: Float64Array;
    protected sy: Float64Array;
    protected px: Float64Array;
    protected py: Float64Array;
    protected readonly aff = new Float64Array(6);

    constructor(input: ShapeInput, pts: readonly Pt[]) {
        this.family = input.family;
        this.map = input.map;
        const n = pts.length;
        this.sx = new Float64Array(n);
        this.sy = new Float64Array(n);
        this.px = new Float64Array(n);
        this.py = new Float64Array(n);
        for (let j = 0; j < n; j++) this.setSample(j, pts[j].x, pts[j].y);
    }

    protected setSample(j: number, x: number, y: number): void {
        this.sx[j] = x;
        this.sy[j] = y;
        this.px[j] = x * this.map.kx;
        this.py[j] = y * this.map.ky;
    }

    /** Fills `aff` for family member z (identity for push / slide). */
    protected affine(z: readonly [number, number] | undefined): Float64Array {
        familyAffine(this.family, z || ZERO, this.aff);
        return this.aff;
    }

    setFamily(f: Family): void {
        this.family = f;
    }

    abstract eval(z: readonly [number, number], out: Float64Array, offset: number): void;

    evalCursor(_cursor: Pt, _out: Float64Array, _offset: number): void {
        // Families add their own cursor rows in the solver.
    }

    refreshWeights(_z?: readonly [number, number]): void {
        // Unweighted by default.
    }

    abstract resample(z?: readonly [number, number]): void;

    samples(): readonly Pt[] {
        const out: Pt[] = [];
        for (let j = 0; j < this.sx.length; j++) out.push({ x: this.sx[j], y: this.sy[j] });
        return out;
    }
}

const ZERO: readonly [number, number] = [0, 0];

// ------------------------------------------------------------------ graph

/** y = f(x): r_j = (f(q.x) - q.y) * ky * w_j, w_j = 1 / sqrt(1 + (f'(q.x) * ky / kx)^2). */
class GraphShape extends SampledShape {
    readonly rows: number;
    readonly cursorRows = 0;
    private readonly f: Compiled;
    private readonly w: Float64Array;

    constructor(input: ShapeInput) {
        super(input, sampleLines(input.lines, input.map));
        this.f = fnAt(input, 0);
        this.rows = this.sx.length;
        this.w = new Float64Array(this.rows).fill(1);
        this.refreshWeights();
    }

    eval(z: readonly [number, number], out: Float64Array, offset: number): void {
        const m = this.affine(z);
        const kx = this.map.kx;
        const ky = this.map.ky;
        const f = this.f;
        for (let j = 0; j < this.rows; j++) {
            const X = m[0] * this.px[j] + m[1] * this.py[j] + m[4];
            const Y = m[2] * this.px[j] + m[3] * this.py[j] + m[5];
            out[offset + j] = (f(X / kx, NaN) * ky - Y) * this.w[j];
        }
    }

    refreshWeights(z?: readonly [number, number]): void {
        const m = this.affine(z);
        const kx = this.map.kx;
        const ky = this.map.ky;
        const f = this.f;
        for (let j = 0; j < this.rows; j++) {
            const x = (m[0] * this.px[j] + m[1] * this.py[j] + m[4]) / kx;
            const h = hStep(x);
            const d = (f(x + h, NaN) - f(x - h, NaN)) / (2 * h);
            const s = (d * ky) / kx;
            const w = 1 / Math.sqrt(1 + s * s);
            if (Number.isFinite(w)) this.w[j] = w;
        }
    }

    resample(z?: readonly [number, number]): void {
        const m = this.affine(z);
        const kx = this.map.kx;
        const ky = this.map.ky;
        for (let j = 0; j < this.rows; j++) {
            const x = (m[0] * this.px[j] + m[1] * this.py[j] + m[4]) / kx;
            const y0 = (m[2] * this.px[j] + m[3] * this.py[j] + m[5]) / ky;
            const y = this.f(x, NaN);
            this.setSample(j, x, Number.isFinite(y) ? y : y0);
        }
        this.refreshWeights();
    }
}

// --------------------------------------------------------------- implicit

/** G(x, y) = 0: r_j = G(q_j) * w_j, w_j = 1 / |grad G(q_j)|_px. Clause shapes add the orientation guard. */
class ImplicitShape extends SampledShape {
    readonly rows: number;
    readonly cursorRows = 0;
    private readonly G: Compiled;
    private readonly w: Float64Array;
    private readonly guard: boolean;
    /** Orientation probes (px frame), 4 px inside at the first, middle and last sample. */
    private probes: Pt[] = [];

    constructor(input: ShapeInput, G: Compiled, guard: boolean) {
        super(input, sampleLines(input.lines, input.map));
        this.G = G;
        this.guard = guard;
        this.rows = this.sx.length;
        this.w = new Float64Array(this.rows).fill(1);
        this.refreshWeights();
        if (guard) this.buildProbes();
    }

    eval(z: readonly [number, number], out: Float64Array, offset: number): void {
        const m = this.affine(z);
        const kx = this.map.kx;
        const ky = this.map.ky;
        const G = this.G;
        for (let j = 0; j < this.rows; j++) {
            const X = m[0] * this.px[j] + m[1] * this.py[j] + m[4];
            const Y = m[2] * this.px[j] + m[3] * this.py[j] + m[5];
            out[offset + j] = G(X / kx, Y / ky) * this.w[j];
        }
    }

    refreshWeights(z?: readonly [number, number]): void {
        const m = this.affine(z);
        const kx = this.map.kx;
        const ky = this.map.ky;
        for (let j = 0; j < this.rows; j++) {
            const x = (m[0] * this.px[j] + m[1] * this.py[j] + m[4]) / kx;
            const y = (m[2] * this.px[j] + m[3] * this.py[j] + m[5]) / ky;
            const g = gradPx(this.G, x, y, kx, ky);
            if (Number.isFinite(g.n) && g.n > 0) this.w[j] = 1 / g.n;
        }
    }

    resample(z?: readonly [number, number]): void {
        const m = this.affine(z);
        const kx = this.map.kx;
        const ky = this.map.ky;
        const G = this.G;
        for (let j = 0; j < this.rows; j++) {
            let x = (m[0] * this.px[j] + m[1] * this.py[j] + m[4]) / kx;
            let y = (m[2] * this.px[j] + m[3] * this.py[j] + m[5]) / ky;
            for (let it = 0; it < 3; it++) {
                const g = G(x, y);
                if (!Number.isFinite(g) || g === 0) break;
                const d = gradPx(G, x, y, kx, ky);
                const nn = d.gx * d.gx + d.gy * d.gy;
                if (!Number.isFinite(nn) || nn === 0) break;
                const nx = x - (g * d.gx) / nn;
                const ny = y - (g * d.gy) / nn;
                if (!Number.isFinite(nx) || !Number.isFinite(ny)) break;
                x = nx;
                y = ny;
            }
            this.setSample(j, x, y);
        }
        this.refreshWeights();
        if (this.guard) this.buildProbes();
    }

    private buildProbes(): void {
        this.probes = [];
        const n = this.rows;
        if (!n) return;
        const idx = Array.from(new Set([0, Math.floor(n / 2), n - 1]));
        const kx = this.map.kx;
        const ky = this.map.ky;
        for (const j of idx) {
            const g = gradPx(this.G, this.sx[j], this.sy[j], kx, ky);
            if (!Number.isFinite(g.n) || g.n === 0) continue;
            // Inward normal in the px frame: -(G_x / kx, G_y / ky) / |.|, 4 px long.
            const qx = this.px[j] - (4 * (g.gx / kx)) / g.n;
            const qy = this.py[j] - (4 * (g.gy / ky)) / g.n;
            const v = this.G(qx / kx, qy / ky);
            if (Number.isFinite(v) && v < 0) this.probes.push({ x: qx, y: qy });
        }
    }

    orientationOk(z: readonly [number, number]): boolean {
        if (!this.guard) return true;
        const m = this.affine(z);
        const kx = this.map.kx;
        const ky = this.map.ky;
        for (const p of this.probes) {
            const X = m[0] * p.x + m[1] * p.y + m[4];
            const Y = m[2] * p.x + m[3] * p.y + m[5];
            const v = this.G(X / kx, Y / ky);
            if (Number.isFinite(v) && v >= 0) return false;
        }
        return true;
    }
}

// ------------------------------------------------------------------ points

/** Point-like targets: 2 rows per point, (p(theta) - T_z(p0)) in px. */
class PointShape extends SampledShape {
    readonly rows: number;
    readonly cursorRows = 0;
    private readonly fx: Array<Compiled | null>;
    private readonly fy: Array<Compiled | null>;

    constructor(input: ShapeInput) {
        super(input, input.points);
        const n = input.points.length;
        this.rows = 2 * n;
        this.fx = [];
        this.fy = [];
        for (let k = 0; k < n; k++) {
            const ux = input.units[2 * k];
            const uy = input.units[2 * k + 1];
            this.fx.push(ux !== undefined && ux >= 0 ? input.ev.fns[ux] || null : null);
            this.fy.push(uy !== undefined && uy >= 0 ? input.ev.fns[uy] || null : null);
        }
    }

    eval(z: readonly [number, number], out: Float64Array, offset: number): void {
        const m = this.affine(z);
        const kx = this.map.kx;
        const ky = this.map.ky;
        for (let k = 0; k < this.fx.length; k++) {
            const fx = this.fx[k];
            const fy = this.fy[k];
            const X = fx ? fx(NaN, NaN) * kx : this.px[k];
            const Y = fy ? fy(NaN, NaN) * ky : this.py[k];
            out[offset + 2 * k] = X - (m[0] * this.px[k] + m[1] * this.py[k] + m[4]);
            out[offset + 2 * k + 1] = Y - (m[2] * this.px[k] + m[3] * this.py[k] + m[5]);
        }
    }

    resample(_z?: readonly [number, number]): void {
        for (let k = 0; k < this.fx.length; k++) {
            const fx = this.fx[k];
            const fy = this.fy[k];
            const x = fx ? fx(NaN, NaN) : this.sx[k];
            const y = fy ? fy(NaN, NaN) : this.sy[k];
            this.setSample(k, Number.isFinite(x) ? x : this.sx[k], Number.isFinite(y) ? y : this.sy[k]);
        }
    }
}

// -------------------------------------------------------- push and slide

/** Level push: one cursor row (F(cursor) - L(theta)) * w(cursor), F fixed. Samples: the level curve. */
class PushShape extends SampledShape {
    readonly rows = 0;
    readonly cursorRows = 1;
    private readonly F: (x: number, y: number) => number;
    private readonly L: () => number;
    private wx = NaN;
    private wy = NaN;
    private wv = 1;

    constructor(input: ShapeInput) {
        super(input, sampleLines(input.lines, input.map));
        const u = input.units;
        const Fev = fnAt(input, 0);
        this.F = input.F || ((x, y) => Fev(x, y));
        let L: () => number;
        if (u.length >= 2) {
            const f = fnAt(input, u.length - 1);
            L = () => f(NaN, NaN);
        } else if (u.length === 1 && input.F) {
            const f = fnAt(input, 0);
            L = () => f(NaN, NaN);
        } else {
            const v = input.levelValue !== undefined ? input.levelValue : 0;
            L = () => v;
        }
        this.L = L;
    }

    eval(_z: readonly [number, number], _out: Float64Array, _offset: number): void {
        // No shape rows.
    }

    evalCursor(cursor: Pt, out: Float64Array, offset: number): void {
        if (cursor.x !== this.wx || cursor.y !== this.wy) {
            // F is fixed, so the weight depends on the cursor only.
            const g = gradPx(this.F, cursor.x, cursor.y, this.map.kx, this.map.ky);
            this.wv = Number.isFinite(g.n) && g.n > 0 ? 1 / g.n : 1;
            this.wx = cursor.x;
            this.wy = cursor.y;
        }
        out[offset] = (this.F(cursor.x, cursor.y) - this.L()) * this.wv;
    }

    resample(_z?: readonly [number, number]): void {
        const kx = this.map.kx;
        const ky = this.map.ky;
        const L = this.L();
        for (let j = 0; j < this.sx.length; j++) {
            let x = this.sx[j];
            let y = this.sy[j];
            for (let it = 0; it < 3; it++) {
                const g = this.F(x, y) - L;
                if (!Number.isFinite(g) || g === 0) break;
                const d = gradPx(this.F, x, y, kx, ky);
                const nn = d.gx * d.gx + d.gy * d.gy;
                if (!Number.isFinite(nn) || nn === 0) break;
                x -= (g * d.gx) / nn;
                y -= (g * d.gy) / nn;
            }
            if (Number.isFinite(x) && Number.isFinite(y)) this.setSample(j, x, y);
        }
    }
}

/** Tangent slide: one cursor row (x0(theta) - cursor.x) * kx. Samples: the tangent point. */
class SlideShape extends SampledShape {
    readonly rows = 0;
    readonly cursorRows = 1;
    private readonly x0: Compiled;
    private readonly f: ((x: number) => number) | null;

    constructor(input: ShapeInput) {
        super(input, input.points.length ? input.points : sampleLines(input.lines, input.map));
        this.x0 = fnAt(input, 0);
        this.f = input.f || null;
    }

    eval(_z: readonly [number, number], _out: Float64Array, _offset: number): void {
        // No shape rows.
    }

    evalCursor(cursor: Pt, out: Float64Array, offset: number): void {
        out[offset] = (this.x0(NaN, NaN) - cursor.x) * this.map.kx;
    }

    resample(_z?: readonly [number, number]): void {
        const x = this.x0(NaN, NaN);
        if (!Number.isFinite(x) || !this.sx.length) return;
        const y = this.f ? this.f(x) : this.sy[0];
        this.setSample(0, x, Number.isFinite(y) ? y : this.sy[0]);
    }
}
