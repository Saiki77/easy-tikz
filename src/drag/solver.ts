/*
 * Drag solver (SPEC3 2.2 to 2.7): priority order of the free numbers, planning by a linearized rank test
 * with backward elimination, the per-event Levenberg-Marquardt solve (slider bounds, continuation,
 * rejection, orientation guard) and quantization with the start-value magnet.
 *
 * Frames: math coordinates (y up) and the px frame P_px = (x * kx, y * ky) (y up, CSS px). Gesture families
 * act in the px frame and are linear in their member z (2 numbers, px).
 *
 * Unknowns of a solve: w = (u in R^|A|, y in R^r) with theta_i = theta0_i + sigma_i * u_i (u in px, so all
 * unknowns are comparable) and z = V y. Rows: shape rows minus their start values (base), then the cursor
 * rows: T_z(grab) - cursor (2, families) or the shape's own cursor row (push / slide).
 *
 * Pure: no DOM, no Obsidian. Every entry point leaves ev.values at the values it returns (and calls
 * ev.apply() when sliders are involved).
 */
import type { Evaluator } from './numbers';
import type { ShapeModel } from './shapes';
import type { DragNumber, Gesture, Pt, Restriction, ScreenMap } from './types';

export type Family =
    | { kind: 'translate' }
    /**
     * pivot in px frame; unit = R px; turnOnly: lines (scale invisible) vs closed curves and legs (turn + resize).
     * scaleOnly (optional addition): z[1] is ignored, so the family is a uniform scale about the pivot (resize of
     * closed curves: an axis-aligned ellipse, or a math circle on a chart with unequal axis scales, cannot turn).
     */
    | { kind: 'similar'; pivot: Pt; unit: number; turnOnly: boolean; scaleOnly?: boolean }
    /**
     * liveX / liveY (optional additions): false pins that axis at factor 1 (a dead axis: the grab lies within
     * 24 px of the pivot along it, SPEC3 2.3), so no row depends on its member and no number can drift with it.
     */
    | { kind: 'stretch'; pivot: Pt; ux: number; uy: number; liveX?: boolean; liveY?: boolean }
    | { kind: 'push' }
    | { kind: 'slide' };

/** px frame: math * (kx, ky). */
export function toPx(p: Pt, map: ScreenMap): Pt {
    return { x: p.x * map.kx, y: p.y * map.ky };
}

export function fromPx(p: Pt, map: ScreenMap): Pt {
    return { x: p.x / map.kx, y: p.y / map.ky };
}

/** Dimension of the family member z: 2 for translate / similar / stretch, 0 for push / slide. */
export function familyDim(f: Family): number {
    return f.kind === 'push' || f.kind === 'slide' ? 0 : 2;
}

/**
 * The family member z as an affine map of the px frame, written into m:
 * T(q) = (m0 q.x + m1 q.y + m4, m2 q.x + m3 q.y + m5). Push and slide are the identity.
 */
export function familyAffine(f: Family, z: readonly [number, number], m: Float64Array | number[]): void {
    switch (f.kind) {
        case 'translate':
            m[0] = 1;
            m[1] = 0;
            m[2] = 0;
            m[3] = 1;
            m[4] = z[0];
            m[5] = z[1];
            return;
        case 'similar': {
            // P + (1 + z1 / R + i z2 / R)(q - P): a rotation plus a uniform scale about P.
            const R = f.unit > 0 ? f.unit : 1;
            const re = 1 + z[0] / R;
            const im = f.scaleOnly ? 0 : z[1] / R;
            const P = f.pivot;
            m[0] = re;
            m[1] = -im;
            m[2] = im;
            m[3] = re;
            m[4] = P.x - re * P.x + im * P.y;
            m[5] = P.y - im * P.x - re * P.y;
            return;
        }
        case 'stretch': {
            // P + diag(1 + z1 / Ux, 1 + z2 / Uy)(q - P).
            const sx = f.liveX === false ? 1 : 1 + z[0] / (f.ux > 0 ? f.ux : 1);
            const sy = f.liveY === false ? 1 : 1 + z[1] / (f.uy > 0 ? f.uy : 1);
            const P = f.pivot;
            m[0] = sx;
            m[1] = 0;
            m[2] = 0;
            m[3] = sy;
            m[4] = P.x - sx * P.x;
            m[5] = P.y - sy * P.y;
            return;
        }
        default:
            m[0] = 1;
            m[1] = 0;
            m[2] = 0;
            m[3] = 1;
            m[4] = 0;
            m[5] = 0;
    }
}

export function applyFamily(f: Family, z: readonly [number, number], qPx: Pt): Pt {
    const m = [0, 0, 0, 0, 0, 0];
    familyAffine(f, z, m);
    return { x: m[0] * qPx.x + m[1] * qPx.y + m[4], y: m[2] * qPx.x + m[3] * qPx.y + m[5] };
}

export interface DragProblem {
    numbers: readonly DragNumber[];
    ev: Evaluator;
    shape: ShapeModel;
    family: Family;
    map: ScreenMap;
    /** Grab point, px frame. */
    grab: Pt;
    gesture: Gesture;
}

// ---------------------------------------------------------------- priority

const MOVE_ROLE: Record<DragNumber['role'], number> = { offset: 0, shift: 1, coef: 2 };

function cmpStr(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * SPEC3 2.2 keep-first order of the usable numbers (indices into `numbers`; unusable ones are left out).
 * Primary key: tier. Move: offsets, shifts, coefficients. Pivot: the first coefficient of the tier by
 * `pos`, then offsets, other coefficients, shifts. Last keys: `pos`, then id. Graph form (lead decision):
 * a pivot gesture orders the implicit coefficient of a lone-variable side (`output`) after every other
 * number, so the coefficients come from the function side (`y <= 2x^2`, not `0.5y <= x^2`) and the output
 * scale is only kept when the function side cannot reach rmax (a frozen chain middle: `0.5y <= x^2 <= 4`).
 */
export function priorityOrder(numbers: readonly DragNumber[], gesture: Gesture, usable: readonly boolean[]): number[] {
    const idx: number[] = [];
    for (let i = 0; i < numbers.length; i++) if (usable[i] === true) idx.push(i);
    const lastResort = (i: number): number => (gesture === 'pivot' && numbers[i].output === true ? 1 : 0);
    const first = new Set<number>();
    if (gesture === 'pivot') {
        const best = new Map<number, number>();
        for (const i of idx) {
            const n = numbers[i];
            if (n.role !== 'coef' || lastResort(i)) continue;
            const b = best.get(n.tier);
            if (b === undefined || n.pos < numbers[b].pos || (n.pos === numbers[b].pos && cmpStr(n.id, numbers[b].id) < 0)) best.set(n.tier, i);
        }
        best.forEach((i) => first.add(i));
    }
    const key = (i: number): number => {
        const n = numbers[i];
        if (gesture === 'move') return MOVE_ROLE[n.role];
        if (first.has(i)) return 0;
        return n.role === 'offset' ? 1 : n.role === 'coef' ? 2 : 3;
    };
    return idx.sort((a, b) => {
        const na = numbers[a];
        const nb = numbers[b];
        return lastResort(a) - lastResort(b) || na.tier - nb.tier || key(a) - key(b) || na.pos - nb.pos || cmpStr(na.id, nb.id) || a - b;
    });
}

// -------------------------------------------------------------------- plan

export interface DragPlan {
    active: number[];
    sigma: Float64Array;
    /** Achievable directions of z, each a unit vector [vx, vy] (r = basis.length). Empty for push / slide. */
    basis: number[][];
    rmax: number;
    restricted: Restriction;
    /** Shape rows at theta0, z = 0 (subtracted on every evaluation); NaN marks a dropped row. */
    base: Float64Array;
    /** Straight shapes: math points where changing only `number` turns the line. */
    naturalPivots: Array<{ number: number; at: Pt }>;
    cost: number;
    usable: boolean[];
    /** Addition: the numbers the plan was built at (ev.values when planDrag ran; differs from value0 after a re-base). */
    theta0: Float64Array;
    /**
     * Addition: fewer than max(4, |active| + r) rows are finite at the start (asymptotic curves), or the
     * push / slide row is not finite. The session locks the gesture ('cannot drag here').
     */
    rowsLocked: boolean;
}

/** Writes v into ev.values for all numbers and pushes sliders. */
function writeAll(ev: Evaluator, v: Float64Array, sliders: boolean): void {
    ev.values.set(v);
    if (sliders) ev.apply();
}

function hasSliders(numbers: readonly DragNumber[]): boolean {
    for (const n of numbers) if (n.kind === 'slider') return true;
    return false;
}

function syncFamily(p: DragProblem): void {
    if (p.shape.setFamily) p.shape.setFamily(p.family);
}

const Z0: readonly [number, number] = [0, 0];

function dot(a: Float64Array, b: Float64Array): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
}

/**
 * |c - proj(c onto span(others))| / |c| (two-pass modified Gram-Schmidt); 1 when c is missing or zero, so a
 * missing column never counts as redundant.
 */
function spanResidual(c: Float64Array | null, others: ReadonlyArray<Float64Array | null>): number {
    if (!c) return 1;
    const n0 = Math.sqrt(dot(c, c));
    if (!(n0 > 0)) return 1;
    const Q: Float64Array[] = [];
    for (const o of others) {
        if (!o) continue;
        const v = Float64Array.from(o);
        const m0 = Math.sqrt(dot(v, v));
        if (!(m0 > 0)) continue;
        for (let pass = 0; pass < 2; pass++) {
            for (const q of Q) {
                const d = dot(q, v);
                for (let j = 0; j < v.length; j++) v[j] -= d * q[j];
            }
        }
        const m1 = Math.sqrt(dot(v, v));
        if (m1 > 1e-7 * m0) {
            for (let j = 0; j < v.length; j++) v[j] /= m1;
            Q.push(v);
        }
    }
    const r = Float64Array.from(c);
    for (let pass = 0; pass < 2; pass++) {
        for (const q of Q) {
            const d = dot(q, r);
            for (let j = 0; j < r.length; j++) r[j] -= d * q[j];
        }
    }
    return Math.sqrt(dot(r, r)) / n0;
}

/** Eigen-decomposition of the symmetric 2 x 2 [[a, b], [b, c]]: eigenvalues ascending and the first eigenvector. */
function eig2(a: number, b: number, c: number): { l1: number; l2: number; v1: [number, number] } {
    const m = (a + c) / 2;
    const d = Math.sqrt(((a - c) / 2) * ((a - c) / 2) + b * b);
    const l1 = m - d;
    const l2 = m + d;
    let v: [number, number];
    if (Math.abs(b) > 1e-14 * Math.max(1, Math.abs(a), Math.abs(c))) v = [b, l1 - a];
    else v = a <= c ? [1, 0] : [0, 1];
    const n = Math.hypot(v[0], v[1]);
    return { l1, l2, v1: [v[0] / n, v[1] / n] };
}

/**
 * SPEC3 2.5: Jacobian columns at theta0, z = 0 (sigma, usable), the family matrix B, the smallest tier prefix
 * reaching rmax, backward elimination, the achievable basis and the restriction, natural pivots of straight
 * shapes, and the cost. Plans at the CURRENT numbers (ev.values): after a re-base call it again.
 */
export function planDrag(p: DragProblem): DragPlan {
    syncFamily(p);
    const { numbers, ev, shape, family, map } = p;
    const n = numbers.length;
    const sliders = hasSliders(numbers);
    const theta0 = Float64Array.from(ev.values);
    writeAll(ev, theta0, sliders);
    shape.refreshWeights();
    const fam = familyDim(family) === 2;
    const nS = shape.rows;
    const nR = fam ? nS : shape.cursorRows;
    const grabMath = fromPx(p.grab, map);
    const evalRows = (out: Float64Array) => {
        if (fam) shape.evaluate(Z0, out, 0);
        else shape.evalCursor(grabMath, out, 0);
    };

    // Rows at the start; non-finite ones are dropped (NaN in base).
    const base = new Float64Array(nS);
    shape.evaluate(Z0, base, 0);
    const start = new Float64Array(nR);
    evalRows(start);
    const ok = new Uint8Array(nR);
    let nOk = 0;
    for (let j = 0; j < nR; j++) {
        if (Number.isFinite(start[j])) {
            ok[j] = 1;
            nOk++;
        }
    }
    for (let j = 0; j < nS; j++) if (!Number.isFinite(base[j])) base[j] = NaN;
    // Samples the drawing puts off the zero set (the risers marching squares draws across a jump of a
    // discontinuous g, as in `y <= floor(x)`) are not part of the shape: every trial step would raise their
    // rows and the solve would never move. Dropped while enough rows stay (a third of the finite ones).
    if (fam) {
        let off = 0;
        for (let j = 0; j < nS; j++) if (ok[j] && Math.abs(base[j]) > BASE_DROP_PX) off++;
        if (off && nOk - off >= Math.max(4, Math.ceil(nOk / 3))) {
            for (let j = 0; j < nS; j++) {
                if (ok[j] && Math.abs(base[j]) > BASE_DROP_PX) {
                    ok[j] = 0;
                    base[j] = NaN;
                    nOk--;
                }
            }
        }
    }

    // 1. Jacobian columns (central differences), px per unit; sigma = 1 / RMS (units per px).
    const sigma = new Float64Array(n);
    const usable: boolean[] = [];
    const cols: Float64Array[] = [];
    const rp = new Float64Array(nR);
    const rm = new Float64Array(nR);
    const vals = ev.values;
    for (let i = 0; i < n; i++) {
        const t0 = theta0[i];
        const h = 1e-6 * Math.max(1, Math.abs(t0));
        const pushes = sliders && numbers[i].kind === 'slider';
        vals[i] = t0 + h;
        if (pushes) ev.apply();
        evalRows(rp);
        vals[i] = t0 - h;
        if (pushes) ev.apply();
        evalRows(rm);
        vals[i] = t0;
        if (pushes) ev.apply();
        const col = new Float64Array(nR);
        let finite = Number.isFinite(t0);
        let ss = 0;
        for (let j = 0; j < nR; j++) {
            if (!ok[j]) continue;
            const c = (rp[j] - rm[j]) / (2 * h);
            if (!Number.isFinite(c)) finite = false;
            col[j] = c;
            ss += c * c;
        }
        const rms = nOk ? Math.sqrt(ss / nOk) : 0;
        // A lone variable's implicit coefficient (graph form) stays usable as a last resort (priorityOrder
        // orders it after everything else); it is never a natural pivot.
        const use = finite && rms > 1e-9;
        usable.push(use);
        sigma[i] = use ? 1 / rms : Infinity;
        cols.push(col);
    }

    // 2. Family matrix B (rows x 2): central differences in z at 0, step 1e-3 px.
    const B: Float64Array[] = [];
    if (fam) {
        for (let k = 0; k < 2; k++) {
            const zp: [number, number] = [0, 0];
            const zm: [number, number] = [0, 0];
            zp[k] = 1e-3;
            zm[k] = -1e-3;
            shape.evaluate(zp, rp, 0);
            shape.evaluate(zm, rm, 0);
            const b = new Float64Array(nS);
            for (let j = 0; j < nS; j++) {
                const v = (rp[j] - rm[j]) / 2e-3;
                b[j] = ok[j] && Number.isFinite(v) ? v : 0;
            }
            B.push(b);
        }
    }

    // 3. rdim(S): achievable directions of z with the numbers of S.
    const scaled: Array<Float64Array | null> = cols.map((c, i) => {
        if (!usable[i]) return null;
        const s = new Float64Array(c.length);
        for (let j = 0; j < c.length; j++) s[j] = c[j] * sigma[i];
        return s;
    });
    const rdim = (S: readonly number[]): { r: number; V: number[][] } => {
        if (!fam) return { r: S.length ? 1 : 0, V: [] };
        const Q: Float64Array[] = [];
        for (const i of S) {
            const c = scaled[i];
            if (!c) continue;
            const v = Float64Array.from(c);
            const n0 = Math.sqrt(dot(v, v));
            if (!(n0 > 0)) continue;
            for (let pass = 0; pass < 2; pass++) {
                for (const q of Q) {
                    const d = dot(q, v);
                    for (let j = 0; j < v.length; j++) v[j] -= d * q[j];
                }
            }
            const n1 = Math.sqrt(dot(v, v));
            if (n1 > 1e-7 * n0) {
                for (let j = 0; j < v.length; j++) v[j] /= n1;
                Q.push(v);
            }
        }
        const R = B.map((b) => {
            const v = Float64Array.from(b);
            for (let pass = 0; pass < 2; pass++) {
                for (const q of Q) {
                    const d = dot(q, v);
                    for (let j = 0; j < v.length; j++) v[j] -= d * q[j];
                }
            }
            return v;
        });
        const N = Math.max(1, nOk);
        const e = eig2(dot(R[0], R[0]) / N, dot(R[0], R[1]) / N, dot(R[1], R[1]) / N);
        const tau = 1e-4;
        if (e.l2 <= tau) return { r: 2, V: [[1, 0], [0, 1]] };
        if (e.l1 <= tau) return { r: 1, V: [[e.v1[0], e.v1[1]]] };
        return { r: 0, V: [] };
    };

    // 4. to 6. rmax, the smallest tier prefix reaching it, backward elimination. A graph-form output scale is
    // the last resort: it joins the prefix only when the rest of the order cannot reach rmax.
    const order = priorityOrder(numbers, p.gesture, usable);
    const outputLast = (i: number) => p.gesture === 'pivot' && numbers[i].output === true;
    let rmax = rdim(order).r;
    let S: number[] = order;
    for (let tier = 1; tier <= 5; tier++) {
        const T = order.filter((i) => (tier <= 4 ? numbers[i].tier <= tier && !outputLast(i) : true));
        if (rdim(T).r === rmax) {
            S = T;
            break;
        }
    }
    for (let k = S.length - 1; k >= 0; k--) {
        const T = S.slice(0, k).concat(S.slice(k + 1));
        if (rdim(T).r === rmax) S = T;
    }
    let V = rdim(S).V;
    // Near duplicates (D8): a kept number whose scaled column lies within 1e-3 (relative) of the span of the
    // other kept columns does the same job as they do. Near a pole, central differences with different steps
    // (a literal, an inserted shift, the family) disagree slightly, so rdim counts both shifts of
    // `sin(1/(x + 3))` as needed and the solve drifts in their null space. Dropped in reverse priority order,
    // so an inserted number goes before a typed one; the achievable directions stay those of the full set.
    if (fam && S.length > 1) {
        for (const i of S.slice().reverse()) {
            if (S.length < 2) break;
            const others = S.filter((j) => j !== i);
            if (spanResidual(scaled[i], others.map((j) => scaled[j])) < 1e-3) S = others;
        }
    }
    // Nothing visible can change without numbers (only invisible directions such as sliding a line along itself).
    if (!S.length) {
        rmax = 0;
        V = [];
    }

    // 7. Restriction.
    let restricted: Restriction;
    if (rmax === 0) restricted = 'fixed';
    else if (!fam || V.length === 2) restricted = 'none';
    else {
        const v = V[0];
        restricted = Math.abs(v[0]) < 0.2 ? 'vertical' : Math.abs(v[1]) < 0.2 ? 'horizontal' : 'line';
    }

    // Too few finite rows: the gesture is locked for this drag.
    const r = fam ? V.length : 0;
    const finiteRows = nOk + (fam ? 2 : 0);
    const rowsLocked = fam ? finiteRows < Math.max(4, S.length + r) : nR > 0 && nOk < nR;

    // 8. Natural pivots (straight shapes: one row per sample, collinear samples). A graph-form output scale
    // is never one (it would turn `y <= 4 - x` by writing `0.5y <= 4 - x`).
    const natUsable = usable.map((u, i) => u && !outputLast(i));
    const naturalPivots = fam ? naturalPivotsOf(shape, cols, natUsable, sigma, ok, map) : [];

    // 9. Cost; every family direction the plan cannot achieve costs 1000 (never preferred as a pivot).
    let virt = 0;
    for (const i of S) if (numbers[i].kind === 'virtual') virt++;
    const cost = S.length + 0.5 * virt + 1000 * Math.max(0, (fam ? 2 : 1) - rmax);

    writeAll(ev, theta0, sliders);
    return { active: S, sigma, basis: V, rmax, restricted, base, naturalPivots, cost, usable, theta0, rowsLocked };
}

/** SPEC3 2.5 item 8: per usable number, the zero of its (affine) column along the straight start shape. */
function naturalPivotsOf(
    shape: ShapeModel,
    cols: readonly Float64Array[],
    usable: readonly boolean[],
    sigma: Float64Array,
    ok: Uint8Array,
    map: ScreenMap
): Array<{ number: number; at: Pt }> {
    const pts = shape.samples();
    const n = pts.length;
    if (n < 2 || shape.rows !== n) return [];
    const X = new Float64Array(n);
    const Y = new Float64Array(n);
    for (let j = 0; j < n; j++) {
        X[j] = pts[j].x * map.kx;
        Y[j] = pts[j].y * map.ky;
    }
    // Direction through the two samples farthest apart: A farthest from the first sample, B farthest from A.
    // (A clause's hit shape may hold the same segment twice, once reversed, so the first and last samples can
    // coincide.)
    const farFrom = (k: number): number => {
        let best = k;
        let bd = -1;
        for (let j = 0; j < n; j++) {
            const d = Math.hypot(X[j] - X[k], Y[j] - Y[k]);
            if (d > bd) {
                bd = d;
                best = j;
            }
        }
        return best;
    };
    const a = farFrom(0);
    const b = farFrom(a);
    const len = Math.hypot(X[b] - X[a], Y[b] - Y[a]);
    if (!(len > 1)) return [];
    const dx = (X[b] - X[a]) / len;
    const dy = (Y[b] - Y[a]) / len;
    const s = new Float64Array(n);
    for (let j = 0; j < n; j++) {
        const ex = X[j] - X[a];
        const ey = Y[j] - Y[a];
        if (Math.abs(ex * dy - ey * dx) > 0.5) return [];
        s[j] = ex * dx + ey * dy;
    }
    const out: Array<{ number: number; at: Pt }> = [];
    for (let i = 0; i < cols.length; i++) {
        if (!usable[i]) continue;
        const c = cols[i];
        let m = 0;
        let ms = 0;
        let mc = 0;
        for (let j = 0; j < n; j++) {
            if (!ok[j]) continue;
            m++;
            ms += s[j];
            mc += c[j];
        }
        if (m < 2) continue;
        ms /= m;
        mc /= m;
        let sxx = 0;
        let sxy = 0;
        for (let j = 0; j < n; j++) {
            if (!ok[j]) continue;
            sxx += (s[j] - ms) * (s[j] - ms);
            sxy += (s[j] - ms) * (c[j] - mc);
        }
        if (!(sxx > 0)) continue;
        const alpha = sxy / sxx;
        const beta = mc - alpha * ms;
        const rms = 1 / sigma[i];
        // A pure offset moves every sample alike: no pivot.
        if (Math.abs(alpha) * Math.sqrt(sxx / m) < 1e-6 * rms) continue;
        const st = -beta / alpha;
        if (!Number.isFinite(st) || Math.abs(st) > 1e7) continue;
        out.push({ number: i, at: { x: (X[a] + st * dx) / map.kx, y: (Y[a] + st * dy) / map.ky } });
    }
    return out;
}

// ------------------------------------------------------------------- solve

export interface Bounds {
    lo: Float64Array;
    hi: Float64Array;
    /** Slider step (0 = continuous) and grid origin (min). */
    step: Float64Array;
    origin: Float64Array;
}

/** Bounds from the numbers' slider ranges (sliders: [min, max] on min + k * step; everything else free). */
export function boundsFor(numbers: readonly DragNumber[]): Bounds {
    const n = numbers.length;
    const b: Bounds = { lo: new Float64Array(n), hi: new Float64Array(n), step: new Float64Array(n), origin: new Float64Array(n) };
    for (let i = 0; i < n; i++) {
        const q = numbers[i].kind === 'slider' ? numbers[i].param : undefined;
        if (q) {
            b.lo[i] = Number.isFinite(q.min) ? q.min : -Infinity;
            b.hi[i] = Number.isFinite(q.max) ? q.max : Infinity;
            b.step[i] = Number.isFinite(q.step) && q.step > 0 ? q.step : 0;
            b.origin[i] = Number.isFinite(q.min) ? q.min : 0;
        } else {
            b.lo[i] = -Infinity;
            b.hi[i] = Infinity;
        }
    }
    return b;
}

export interface Solved {
    values: Float64Array;
    z: [number, number];
    warm: Float64Array;
    /**
     * Largest |row| in px after the solve: shape rows, and the cursor rows projected onto the directions the
     * plan can achieve (a restricted drag does not count the part it cannot follow).
     */
    maxPx: number;
    ok: boolean;
    /** Indices of numbers clamped at a bound (and which bound). */
    clamped: Array<{ number: number; at: 'min' | 'max' }>;
    /** Addition: the cursor of this solve (px frame); quantizeDrag measures push / slide rows at it. */
    cursor: Pt;
    /** Addition: distance (px) from the grab image T_z(grab) to the cursor (families), or |cursor row| (push / slide). */
    lagPx: number;
    /**
     * Addition: why the frame was rejected ('none' when ok). 'nonfinite': non-finite cost, theta or shape rows;
     * 'range': some |theta_i| > 1e6, or the solve did not converge (maxPx > CONVERGED_PX) while an active
     * number ran beyond RUNAWAY * max(1, |theta0_i|); 'flip': the orientation guard failed (clause targets); 'jump': the best
     * solve leaves the grabbed point far from the pointer (more than JUMP_PX, and JUMP_PX farther than the
     * previous frame left it; plain px, independent of row weights), as across a jump of a non-smooth expression (SPEC3 risk 5: "cannot follow further" instead of a jump); 'clamp': a
     * slider of a turn or stretch hit its bound and the other numbers cannot keep the pivot (the object stops;
     * `clamped` names the slider).
     */
    failure: 'none' | 'nonfinite' | 'range' | 'flip' | 'jump' | 'clamp';
}

const CONT_PX = 0.25;
/** A solve this far (px) from exact counts as converged (rounder-number and start-value magnets, detents). */
export const CONVERGED_PX = 0.5;
/** Jump rejection (px): see Solved.failure 'jump' (the 2 px of the quantization budget, AC3). */
const JUMP_PX = 2;
/** A number beyond this multiple of max(1, |start|) after a solve that did not converge has run off ('range'). */
const RUNAWAY = 100;
/** Shape rows whose start value is farther than this (px) from the zero set are dropped (risers of jumps). */
const BASE_DROP_PX = 1;

/** Evaluation state of one solve or quantization pass. */
class Run {
    readonly nA: number;
    readonly r: number;
    readonly nS: number;
    readonly nC: number;
    readonly nW: number;
    N: number;
    readonly fam: boolean;
    cursorPx: Pt = { x: 0, y: 0 };
    cursorMath: Pt = { x: 0, y: 0 };
    /** Quantization deviations: z fixed at the exact solution's member (with N = the shape rows for families). */
    fixedZ: [number, number] | null = null;
    /** Rows subtracted after evaluation (quantization: the exact solution's rows). */
    ref: Float64Array | null = null;
    /** Exact values for active numbers (NaN = from w): quantized and clamped numbers stay exact. */
    readonly override: Float64Array;
    readonly z: [number, number] = [0, 0];
    /** Non-finite rows (penalized) at the last evaluation. */
    bad = 0;
    private readonly vals: Float64Array;
    private readonly sliderIdx: number[];
    private readonly applied: Float64Array;
    private readonly aff = new Float64Array(6);
    private readonly f: Float64Array;
    private readonly fp: Float64Array;
    private readonly ft: Float64Array;
    private J: Float64Array;

    constructor(readonly p: DragProblem, readonly plan: DragPlan) {
        this.nA = plan.active.length;
        this.fam = familyDim(p.family) === 2;
        this.r = this.fam ? plan.basis.length : 0;
        this.nS = p.shape.rows;
        this.nC = this.fam ? 2 : p.shape.cursorRows;
        this.nW = this.nA + this.r;
        this.N = this.nS + this.nC;
        this.override = new Float64Array(this.nA).fill(NaN);
        this.vals = p.ev.values;
        this.sliderIdx = [];
        for (const i of plan.active) if (p.numbers[i].kind === 'slider') this.sliderIdx.push(i);
        this.applied = new Float64Array(this.sliderIdx.length).fill(NaN);
        this.f = new Float64Array(this.N);
        this.fp = new Float64Array(this.N);
        this.ft = new Float64Array(this.N);
        this.J = new Float64Array(0);
        // Non-active numbers sit at theta0 for the whole run.
        this.vals.set(plan.theta0);
        if (hasSliders(p.numbers)) p.ev.apply();
    }

    setCursor(c: Pt): void {
        this.cursorPx = c;
        this.cursorMath = fromPx(c, this.p.map);
    }

    value(k: number, w: Float64Array): number {
        const o = this.override[k];
        if (!Number.isNaN(o)) return o;
        const i = this.plan.active[k];
        return this.plan.theta0[i] + this.plan.sigma[i] * w[k];
    }

    setTheta(w: Float64Array): void {
        const A = this.plan.active;
        for (let k = 0; k < this.nA; k++) this.vals[A[k]] = this.value(k, w);
        let changed = false;
        for (let s = 0; s < this.sliderIdx.length; s++) {
            const v = this.vals[this.sliderIdx[s]];
            if (v !== this.applied[s]) {
                this.applied[s] = v;
                changed = true;
            }
        }
        if (changed) this.p.ev.apply();
    }

    zOf(w: Float64Array, out: [number, number]): void {
        if (this.fixedZ) {
            out[0] = this.fixedZ[0];
            out[1] = this.fixedZ[1];
            return;
        }
        let z0 = 0;
        let z1 = 0;
        const V = this.plan.basis;
        for (let k = 0; k < this.r; k++) {
            z0 += V[k][0] * w[this.nA + k];
            z1 += V[k][1] * w[this.nA + k];
        }
        out[0] = z0;
        out[1] = z1;
    }

    residual(w: Float64Array, out: Float64Array): void {
        this.setTheta(w);
        this.zOf(w, this.z);
        const nS = this.nS;
        this.p.shape.evaluate(this.z, out, 0);
        const base = this.plan.base;
        let bad = 0;
        for (let j = 0; j < nS; j++) {
            const b = base[j];
            if (Number.isNaN(b)) {
                out[j] = 0;
                continue;
            }
            const v = out[j] - b;
            if (Number.isFinite(v)) out[j] = v;
            else {
                out[j] = 1000;
                bad++;
            }
        }
        if (this.fam) {
            if (this.N > nS) {
                familyAffine(this.p.family, this.z, this.aff);
                const m = this.aff;
                const g = this.p.grab;
                out[nS] = m[0] * g.x + m[1] * g.y + m[4] - this.cursorPx.x;
                out[nS + 1] = m[2] * g.x + m[3] * g.y + m[5] - this.cursorPx.y;
                if (!Number.isFinite(out[nS]) || !Number.isFinite(out[nS + 1])) bad++;
            }
        } else if (this.nC) {
            this.p.shape.evalCursor(this.cursorMath, out, nS);
            for (let j = nS; j < nS + this.nC; j++) {
                if (!Number.isFinite(out[j])) {
                    out[j] = 1000;
                    bad++;
                }
            }
        }
        this.bad = bad;
        const ref = this.ref;
        if (ref) for (let j = 0; j < this.N; j++) out[j] -= ref[j];
    }

    cost(out: Float64Array): number {
        let s = 0;
        for (let j = 0; j < this.N; j++) s += out[j] * out[j];
        return s;
    }

    /**
     * Levenberg-Marquardt over the unknowns with free[k] = 1 (SPEC3 2.6): forward-difference Jacobian (step
     * 1e-5), (J^T J + lambda diag(J^T J) + 1e-9 I) delta = -J^T rho, accept on decrease (lambda / 3), else
     * lambda * 4 (10 tries), lambda from 1e-3, `maxIter` iterations, stop at |delta| < 1e-6 or cost < 1e-10.
     * Leaves the values at w. Returns the cost.
     */
    lm(w: Float64Array, free: Uint8Array, maxIter: number): number {
        const idx: number[] = [];
        for (let k = 0; k < this.nW; k++) if (free[k]) idx.push(k);
        const m = idx.length;
        const N = this.N;
        const f = this.f;
        this.residual(w, f);
        let cost = this.cost(f);
        if (!m || !Number.isFinite(cost)) {
            this.setTheta(w);
            return cost;
        }
        if (this.J.length < m * N) this.J = new Float64Array(m * N);
        const J = this.J;
        const JTJ = new Float64Array(m * m);
        const A = new Float64Array(m * m);
        const g = new Float64Array(m);
        const rhs = new Float64Array(m);
        const d = new Float64Array(m);
        const wt = new Float64Array(this.nW);
        const fp = this.fp;
        const ft = this.ft;
        let lambda = 1e-3;
        for (let it = 0; it < maxIter; it++) {
            if (cost < 1e-10) break;
            for (let a = 0; a < m; a++) {
                const k = idx[a];
                const old = w[k];
                w[k] = old + 1e-5;
                this.residual(w, fp);
                w[k] = old;
                for (let j = 0; j < N; j++) J[a * N + j] = (fp[j] - f[j]) / 1e-5;
            }
            for (let a = 0; a < m; a++) {
                let s = 0;
                for (let j = 0; j < N; j++) s += J[a * N + j] * f[j];
                g[a] = s;
                for (let b = a; b < m; b++) {
                    let t = 0;
                    for (let j = 0; j < N; j++) t += J[a * N + j] * J[b * N + j];
                    JTJ[a * m + b] = t;
                    JTJ[b * m + a] = t;
                }
            }
            let improved = false;
            let small = false;
            for (let tries = 0; tries < 10; tries++) {
                for (let a = 0; a < m * m; a++) A[a] = JTJ[a];
                for (let a = 0; a < m; a++) {
                    A[a * m + a] += lambda * JTJ[a * m + a] + 1e-9;
                    rhs[a] = -g[a];
                }
                if (!gaussSolve(A, rhs, m, d)) {
                    lambda *= 4;
                    continue;
                }
                wt.set(w);
                let dn = 0;
                for (let a = 0; a < m; a++) {
                    wt[idx[a]] += d[a];
                    dn += d[a] * d[a];
                }
                this.residual(wt, ft);
                const c = this.cost(ft);
                if (Number.isFinite(c) && c < cost) {
                    w.set(wt);
                    f.set(ft);
                    cost = c;
                    lambda /= 3;
                    improved = true;
                    small = Math.sqrt(dn) < 1e-6;
                    break;
                }
                lambda *= 4;
            }
            if (!improved || small) break;
        }
        this.setTheta(w);
        return cost;
    }

    /**
     * SPEC3 2.6 maxPx at w (see Solved.maxPx), the lag, and followPx: the cursor residual alone (projected onto
     * the achievable directions for families). followPx is in plain px, independent of the row weights, so it
     * compares across events (the jump test); sets `bad`.
     */
    measure(w: Float64Array): { maxPx: number; lagPx: number; followPx: number } {
        const f = this.f;
        this.residual(w, f);
        let mx = 0;
        for (let j = 0; j < this.nS; j++) mx = Math.max(mx, Math.abs(f[j]));
        let lag = 0;
        let follow = 0;
        if (this.fam && this.N > this.nS) {
            const ex = f[this.nS];
            const ey = f[this.nS + 1];
            lag = Math.hypot(ex, ey);
            // Project the cursor residual onto the achievable directions of the grab image.
            const g = this.p.grab;
            const us: Array<[number, number]> = [];
            for (const v of this.plan.basis) {
                const t = applyFamily(this.p.family, [v[0], v[1]], g);
                const t0 = applyFamily(this.p.family, [0, 0], g);
                let cx = t.x - t0.x;
                let cy = t.y - t0.y;
                for (const u of us) {
                    const dd = cx * u[0] + cy * u[1];
                    cx -= dd * u[0];
                    cy -= dd * u[1];
                }
                const nn = Math.hypot(cx, cy);
                if (nn > 1e-9) us.push([cx / nn, cy / nn]);
            }
            let px = 0;
            let py = 0;
            for (const u of us) {
                const dd = ex * u[0] + ey * u[1];
                px += dd * u[0];
                py += dd * u[1];
            }
            follow = Math.hypot(px, py);
            mx = Math.max(mx, follow);
        } else {
            for (let j = this.nS; j < this.N; j++) {
                mx = Math.max(mx, Math.abs(f[j]));
                lag = Math.max(lag, Math.abs(f[j]));
            }
            follow = lag;
        }
        return { maxPx: Number.isFinite(mx) ? mx : Infinity, lagPx: lag, followPx: Number.isFinite(follow) ? follow : Infinity };
    }
}

/** Gaussian elimination with partial pivoting on the m x m row-major A (destroyed). */
function gaussSolve(A: Float64Array, b: Float64Array, m: number, x: Float64Array): boolean {
    for (let c = 0; c < m; c++) {
        let p = c;
        for (let r = c + 1; r < m; r++) if (Math.abs(A[r * m + c]) > Math.abs(A[p * m + c])) p = r;
        const piv = A[p * m + c];
        if (!(Math.abs(piv) > 1e-300)) return false;
        if (p !== c) {
            for (let k = 0; k < m; k++) {
                const t = A[p * m + k];
                A[p * m + k] = A[c * m + k];
                A[c * m + k] = t;
            }
            const t = b[p];
            b[p] = b[c];
            b[c] = t;
        }
        for (let r = c + 1; r < m; r++) {
            const f = A[r * m + c] / A[c * m + c];
            if (f === 0) continue;
            for (let k = c; k < m; k++) A[r * m + k] -= f * A[c * m + k];
            b[r] -= f * b[c];
        }
    }
    for (let r = m - 1; r >= 0; r--) {
        let s = b[r];
        for (let k = r + 1; k < m; k++) s -= A[r * m + k] * x[k];
        x[r] = s / A[r * m + r];
        if (!Number.isFinite(x[r])) return false;
    }
    return true;
}

interface Attempt {
    w: Float64Array;
    override: Float64Array;
    maxPx: number;
    lagPx: number;
    /** See Run.measure. */
    followPx: number;
    bad: number;
    cost: number;
    clamped: Array<{ number: number; at: 'min' | 'max' }>;
    /** A slider of a pivot family hit its bound: re-solved on the shape rows only (the object stops at the limit). */
    stopped: boolean;
    /** Largest |shape row| (px) of the attempt (stopped attempts: the limit shape must still be exact). */
    shapePx: number;
}

/** Largest |shape row| at w (cursor rows left out); Infinity when not finite. */
function shapeMaxPx(run: Run, w: Float64Array): number {
    const N = run.N;
    run.N = run.nS;
    const f = new Float64Array(N);
    run.residual(w, f);
    run.N = N;
    let mx = 0;
    for (let j = 0; j < run.nS; j++) mx = Math.max(mx, Math.abs(f[j]));
    return Number.isFinite(mx) ? mx : Infinity;
}

/**
 * Direct LM, then slider bounds: out-of-range sliders are fixed at the bound and the rest re-solved (2 rounds).
 * Pivot families (turn, stretch, resize) whose clamped slider leaves the rest unable to follow are re-solved on
 * the shape rows alone: the object stops at the largest turn or stretch the free numbers can make with the
 * pivot exact, instead of a least-squares compromise that drifts off the pivot.
 */
function boundedSolve(run: Run, w: Float64Array, bounds: Bounds): Attempt {
    const free = new Uint8Array(run.nW).fill(1);
    run.override.fill(NaN);
    let cost = run.lm(w, free, 20);
    const clamped: Array<{ number: number; at: 'min' | 'max' }> = [];
    const A = run.plan.active;
    for (let round = 0; round < 3; round++) {
        let any = false;
        for (let k = 0; k < run.nA; k++) {
            if (!free[k]) continue;
            const i = A[k];
            const v = run.value(k, w);
            const lo = bounds.lo[i];
            const hi = bounds.hi[i];
            if (v < lo || v > hi) {
                const at = v < lo ? 'min' : 'max';
                const bv = at === 'min' ? lo : hi;
                run.override[k] = bv;
                w[k] = (bv - run.plan.theta0[i]) / run.plan.sigma[i];
                free[k] = 0;
                clamped.push({ number: i, at });
                any = true;
            }
        }
        if (!any) break;
        if (round < 2) cost = run.lm(w, free, 20);
    }
    let m = run.measure(w);
    let stopped = false;
    const fk = run.p.family.kind;
    if (clamped.length && (fk === 'similar' || fk === 'stretch') && run.nC > 0 && m.maxPx > CONVERGED_PX) {
        const N = run.N;
        run.N = run.nS;
        run.lm(w, free, 20);
        run.N = N;
        stopped = true;
        const f = new Float64Array(run.N);
        run.residual(w, f);
        cost = run.cost(f);
    }
    const shapePx = shapeMaxPx(run, w);
    m = run.measure(w);
    return { w, override: Float64Array.from(run.override), maxPx: m.maxPx, lagPx: m.lagPx, followPx: m.followPx, bad: run.bad, cost, clamped, stopped, shapePx };
}

/**
 * One event (SPEC3 2.6): weights refreshed at the warm state, LM from `warm`, slider bounds, continuation
 * from `prevCursorPx` (2, 4, 8, 16 substeps; from the grab on the first event) when the direct solve ends above
 * 0.25 px and the previous frame was good, then a cold start from the plan's start state (exact at the grab:
 * once a column vanished, a divisor ran off or a base reached 0, warm starts never come back), rejection
 * (non-finite, |theta| > 1e6, a jump away from the pointer, a pivot lost to a clamped slider) and the
 * orientation guard. A rejected frame returns the warm state's values with ok false and `warm` unchanged.
 */
export function solveDrag(p: DragProblem, plan: DragPlan, cursorPx: Pt, prevCursorPx: Pt | null, warm: Float64Array | null, bounds: Bounds): Solved {
    syncFamily(p);
    const run = new Run(p, plan);
    const nW = run.nW;
    const w0 = new Float64Array(nW);
    const warmOk = !!warm && warm.length === nW;
    if (warm && warmOk) for (let k = 0; k < nW; k++) w0[k] = Number.isFinite(warm[k]) ? warm[k] : 0;

    // Weights: once per event, from the warm state.
    run.setTheta(w0);
    const zw: [number, number] = [0, 0];
    run.zOf(w0, zw);
    p.shape.refreshWeights(zw);

    const finitePt = (q: Pt | null): q is Pt => !!q && Number.isFinite(q.x) && Number.isFinite(q.y);
    const cursorFinite = finitePt(cursorPx);
    // The previous frame: the warm state at the previous cursor; before the first good frame, the start
    // state at the grab (exact by construction for families).
    const from: Pt | null = warmOk ? (finitePt(prevCursorPx) ? prevCursorPx : null) : run.nC === 2 ? p.grab : null;
    let prevGood = false;
    let prevFollow = 0;
    if (from && cursorFinite) {
        run.setCursor(from);
        const m = run.measure(w0);
        prevFollow = Number.isFinite(m.followPx) ? m.followPx : 0;
        prevGood = m.maxPx <= CONT_PX && run.bad === 0;
    }
    run.setCursor(cursorPx);

    let best: Attempt | null = null;
    if (cursorFinite) {
        best = boundedSolve(run, Float64Array.from(w0), bounds);
        if (best.maxPx > CONT_PX && prevGood && !best.clamped.length && from) {
            const free = new Uint8Array(nW).fill(1);
            for (const steps of [2, 4, 8, 16]) {
                const w = Float64Array.from(w0);
                run.override.fill(NaN);
                for (let k = 1; k < steps; k++) {
                    run.setCursor({
                        x: from.x + ((cursorPx.x - from.x) * k) / steps,
                        y: from.y + ((cursorPx.y - from.y) * k) / steps,
                    });
                    run.lm(w, free, 20);
                }
                run.setCursor(cursorPx);
                const a = boundedSolve(run, w, bounds);
                if (a.maxPx <= CONT_PX) {
                    best = a;
                    break;
                }
                if (a.maxPx < best.maxPx) best = a;
            }
        }
        if (warmOk && best.maxPx > CONT_PX) {
            run.setCursor(cursorPx);
            const cold = boundedSolve(run, new Float64Array(nW), bounds);
            if (cold.bad === 0 && (best.bad > 0 || cold.maxPx < best.maxPx)) best = cold;
        }
    }

    const values = new Float64Array(p.numbers.length);
    const z: [number, number] = [0, 0];
    let failure: Solved['failure'] = 'none';
    if (!best || !Number.isFinite(best.cost) || best.bad > 0) failure = 'nonfinite';
    else {
        run.override.set(best.override);
        run.setTheta(best.w);
        run.zOf(best.w, z);
        const vals = p.ev.values;
        for (let i = 0; i < values.length; i++) {
            const v = vals[i];
            if (!Number.isFinite(v)) failure = 'nonfinite';
            else if (Math.abs(v) > 1e6 && failure === 'none') failure = 'range';
            values[i] = v;
        }
        if (failure === 'none' && best.stopped && best.shapePx > CONVERGED_PX) failure = 'clamp';
        // A solve that did not converge while a number ran off (a turn pointed exactly at a direction the
        // numbers reach only at infinity, `x + y <= 4` turned vertical) keeps the previous frame.
        if (failure === 'none' && !best.clamped.length && best.maxPx > CONVERGED_PX) {
            for (const i of plan.active) {
                if (Math.abs(values[i]) > RUNAWAY * Math.max(1, Math.abs(plan.theta0[i]))) {
                    failure = 'range';
                    break;
                }
            }
        }
        if (failure === 'none' && !best.clamped.length && best.followPx > JUMP_PX && best.followPx > prevFollow + JUMP_PX) failure = 'jump';
        if (failure === 'none' && p.shape.orientationOk && !p.shape.orientationOk(z)) failure = 'flip';
    }

    if (failure !== 'none') {
        // Keep the previous frame: the warm state's numbers.
        run.override.fill(NaN);
        run.setTheta(w0);
        run.zOf(w0, z);
        values.set(p.ev.values);
        return {
            values,
            z,
            warm: Float64Array.from(w0),
            maxPx: best ? best.maxPx : Infinity,
            ok: false,
            clamped: failure === 'clamp' && best ? best.clamped : [],
            cursor: cursorPx,
            lagPx: best ? best.lagPx : Infinity,
            failure,
        };
    }
    const b = best as Attempt;
    return { values, z, warm: Float64Array.from(b.w), maxPx: b.maxPx, ok: true, clamped: b.clamped, cursor: cursorPx, lagPx: b.lagPx, failure };
}

// ---------------------------------------------------------------- quantize

/** Decimals of a step: clamp(-floor(log10(step) + 1e-9), 0, 12) (SPEC3 3.1). */
function decimalsOf(step: number): number {
    if (!(step > 0) || !Number.isFinite(step)) return 12;
    return Math.min(12, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
}

/** Round v to a multiple of step, as the shortest decimal (no 0.30000000000000004, never -0). */
function roundTo(v: number, step: number): number {
    const r = Math.round(v / step) * step;
    const out = parseFloat(r.toFixed(decimalsOf(step)));
    return out === 0 ? 0 : out;
}

/** Smallest power-of-ten step that writes v exactly (12 decimals at most). */
function exactStep(v: number): number {
    if (!Number.isFinite(v)) return 1;
    for (let d = 0; d <= 12; d++) {
        const s = Math.pow(10, -d);
        if (Math.abs(parseFloat(v.toFixed(d)) - v) <= 1e-12 * Math.max(1, Math.abs(v))) return s;
    }
    return 1e-12;
}

/** The pixel step of SPEC3 2.7: 10^floor(log10(sigma * 1 px)). */
function pixelStep(sigma: number): number {
    if (!(sigma > 0) || !Number.isFinite(sigma)) return 1e-6;
    const s = Math.pow(10, Math.floor(Math.log10(sigma)));
    return Math.min(1e12, Math.max(1e-12, s));
}

/**
 * SPEC3 2.7. Coefficients first, then offsets and shifts (they absorb the error): the start value (within
 * half a step, or, unless Alt, when the deviation stays within 2 px), else (unless Alt) the roundest multiple
 * of 5, 10, 50, 100, ... steps within 2 px, else the plain step. Deviation: the largest change of a shape row
 * (push / slide: the cursor row) against the exact solution at its family member z*, after re-solving the
 * numbers not fixed yet with the event objective (2 LM iterations, z free, as the dm-lead prototype that
 * verified the golden rows), with the row weights refreshed at the candidate's numbers. The deviation magnets
 * only apply when the solve converged (maxPx <= CONVERGED_PX); the half-step start magnet always applies.
 * Sliders: their grid min + k * step, clamped to the range.
 * `steps`: the formatting step of every number (non-active numbers: a step that writes their value exactly).
 */
export function quantizeDrag(p: DragProblem, plan: DragPlan, solved: Solved, bounds: Bounds, opts: { snap: boolean }): { values: Float64Array; steps: Float64Array } {
    syncFamily(p);
    const { numbers } = p;
    const n = numbers.length;
    const values = Float64Array.from(solved.values);
    const steps = new Float64Array(n);
    const activeAt = new Map<number, number>();
    plan.active.forEach((i, k) => activeAt.set(i, k));
    const sliderGrid = (i: number) => numbers[i].kind === 'slider' && bounds.step[i] > 0;
    for (let i = 0; i < n; i++) {
        if (!activeAt.has(i)) steps[i] = exactStep(values[i]);
        else steps[i] = sliderGrid(i) ? bounds.step[i] : pixelStep(plan.sigma[i]);
    }
    const sliders = hasSliders(numbers);
    if (!solved.ok || !plan.active.length) {
        writeAll(p.ev, values, sliders);
        return { values, steps };
    }

    // Re-solves use the event objective (shape rows and cursor rows, z free, as in a frame); deviations are
    // measured on the shape rows at the exact solution's member z*, against the exact solution's rows.
    const run = new Run(p, plan);
    run.setCursor(solved.cursor);
    const nA = run.nA;
    const fullN = run.N;
    const devN = run.nS + (run.fam ? 0 : run.nC);
    const zStar: [number, number] = [solved.z[0], solved.z[1]];
    const w = new Float64Array(run.nW);
    if (solved.warm.length === run.nW) w.set(solved.warm);
    for (let k = 0; k < nA; k++) {
        const i = plan.active[k];
        w[k] = (values[i] - plan.theta0[i]) / plan.sigma[i];
        run.override[k] = values[i];
    }
    const devBuf = new Float64Array(fullN);
    const ref = new Float64Array(fullN);
    const devRows = (wt: Float64Array, out: Float64Array, against: Float64Array | null) => {
        run.fixedZ = zStar;
        run.N = devN;
        run.ref = against;
        if (run.fam) {
            // Weights at the candidate's own numbers: weights frozen at a far-off exact solution (b = 1000 in
            // `x + by <= c`) would make the start line look 0.2 px away when it is 16 px away.
            run.setTheta(wt);
            p.shape.refreshWeights(zStar);
        }
        run.residual(wt, out);
        run.fixedZ = null;
        run.N = fullN;
        run.ref = null;
    };
    devRows(w, ref, null);
    run.override.fill(NaN);
    const dev = (wt: Float64Array): number => {
        devRows(wt, devBuf, ref);
        let mx = 0;
        for (let j = 0; j < devN; j++) mx = Math.max(mx, Math.abs(devBuf[j]));
        return Number.isFinite(mx) ? mx : Infinity;
    };

    const quant = (i: number, v: number): number => {
        if (sliderGrid(i)) {
            const st = bounds.step[i];
            const o = bounds.origin[i];
            let k = Math.round((v - o) / st);
            const kLo = Number.isFinite(bounds.lo[i]) ? Math.ceil((bounds.lo[i] - o) / st - 1e-9) : -Infinity;
            const kHi = Number.isFinite(bounds.hi[i]) ? Math.floor((bounds.hi[i] - o) / st + 1e-9) : Infinity;
            k = Math.min(kHi, Math.max(kLo, k));
            // The decimals that write the step exactly (0.25: 2, 2.5: 1, 1/3: 12): power-of-ten decimals
            // would round a grid value off the grid again ('0.25'.toFixed(1) is '0.3').
            const out = parseFloat((o + k * st).toFixed(Math.max(exactDecimals(st), exactDecimals(o))));
            return out === 0 ? 0 : out;
        }
        const r = roundTo(v, steps[i]);
        return Math.min(bounds.hi[i], Math.max(bounds.lo[i], r));
    };

    // Coefficients first, then offsets and shifts (stable in plan order).
    const order: number[] = [];
    for (let k = 0; k < nA; k++) if (numbers[plan.active[k]].role === 'coef') order.push(k);
    for (let k = 0; k < nA; k++) if (numbers[plan.active[k]].role !== 'coef') order.push(k);

    // The magnets (start value by deviation, rounder values) only round an exact solution: when the solve did
    // not converge (a turn toward a direction the numbers cannot reach, a clamped slider) the deviation of a
    // candidate says nothing about where the pointer is, and the start value would snap the object back.
    const converged = solved.maxPx <= CONVERGED_PX;
    // Free in the re-solves: the numbers not fixed yet and the family member.
    const free = new Uint8Array(run.nW).fill(1);
    let state: Float64Array = Float64Array.from(w);
    const fixedVal = new Float64Array(nA).fill(NaN);

    for (const k of order) {
        const i = plan.active[k];
        free[k] = 0;
        run.override.set(fixedVal);
        const exact = run.value(k, state);
        if (!Number.isFinite(exact)) {
            fixedVal[k] = exact;
            continue;
        }
        let anyFree = false;
        for (let a = 0; a < nA; a++) if (free[a]) anyFree = true;
        const tryValue = (v: number): { dev: number; w: Float64Array } => {
            const wt = Float64Array.from(state);
            run.override.set(fixedVal);
            run.override[k] = v;
            if (anyFree) run.lm(wt, free, 2);
            return { dev: dev(wt), w: wt };
        };
        const st = steps[i];
        const v0 = numbers[i].value0;
        let chosen: { v: number; w: Float64Array } | null = null;
        // 1. The start value.
        if (Number.isFinite(v0) && v0 >= bounds.lo[i] && v0 <= bounds.hi[i]) {
            if (Math.abs(exact - v0) <= st / 2) chosen = { v: v0, w: tryValue(v0).w };
            else if (opts.snap && converged) {
                const t = tryValue(v0);
                if (t.dev <= 2) chosen = { v: v0, w: t.w };
            }
        }
        if (!chosen) {
            // 4. The plain step (also the fallback for the rounder candidates).
            const plain = quant(i, exact);
            const tp = tryValue(plain);
            chosen = { v: plain, w: tp.w };
            // 3. Rounder values, roundest last; each grid is a subset of the previous one, so the first
            // failure ends the search.
            if (opts.snap && converged && !sliderGrid(i)) {
                const mults = [5, 10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];
                let prev = plain;
                for (const mul of mults) {
                    const M = st * mul;
                    const c = Math.min(bounds.hi[i], Math.max(bounds.lo[i], roundTo(exact, M)));
                    if (c === prev) continue;
                    const t = tryValue(c);
                    if (t.dev <= 2) {
                        chosen = { v: c, w: t.w };
                        prev = c;
                    } else break;
                    if (M > 2 * Math.abs(exact)) break;
                }
            }
        }
        fixedVal[k] = chosen.v;
        state = chosen.w;
    }

    for (let k = 0; k < nA; k++) values[plan.active[k]] = fixedVal[k];
    writeAll(p.ev, values, sliders);
    return { values, steps };
}

function exactDecimals(v: number): number {
    return decimalsOf(exactStep(v));
}
