/*
 * The maths of motion (6.0): a tuple of formulas as a vector function
 * (F(x, y) = (P, Q), p' = F(p, t) in 2D and 3D), RK4 solutions, the rest
 * points of a field and their kinds, streamlines and the moving particles
 * at a time of the clock. Pure: no DOM, no Obsidian.
 */
import { ExprError, compile, parse } from '../expr';
import type { Env, Scalar } from '../expr';
import type { MathContext } from '../mathcontext';

/** A vector function: its value at p (2 or 3 coordinates) and time t, NaN where it has none. */
export type VectorFn = (p: readonly number[], t: number) => number[];

// ------------------------------------------------------------- formulas

/**
 * The formulas of a tuple, `(y, -x)` or `\left( y, -x \right)` (an optional
 * left side such as `F(x, y) =`, `\dot{p} =`, `p' =` or `\frac{dp}{dt} =`
 * is left out), split at its top-level commas; null when it is no tuple.
 */
export function tupleParts(src: string): string[] | null {
    let s = rightSide(src).trim();
    s = s.replace(/^\\left\s*\(/, '(').replace(/\\right\s*\)$/, ')');
    if (!s.startsWith('(') || !s.endsWith(')') || closing(s, 0) !== s.length - 1) return null;
    const inner = s.slice(1, -1);
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (c === '\\') {
            i++;
            continue;
        }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ',' && depth === 0) {
            out.push(inner.slice(start, i).trim());
            start = i + 1;
        }
    }
    out.push(inner.slice(start).trim());
    return out.length >= 2 ? out.map((p) => p.replace(/\\right\s*$/, '').trim()) : null;
}

/** The index of the bracket that closes the one at `open`, or -1. */
function closing(s: string, open: number): number {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') {
            i++;
            continue;
        }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** The left sides a field or a system may be written with. */
const LEFT_SIDE = /^(?:[A-Za-z][A-Za-z0-9_]*\s*\(\s*[A-Za-z]+\s*(?:,\s*[A-Za-z]+\s*){1,2}\)|\\dot\s*\{?\s*\\?[A-Za-z]+\s*\}?|\\dot\s*[A-Za-z]|[A-Za-z]\s*'|\\[dt]?frac\s*\{\s*d\s*\\?[A-Za-z]+\s*\}\s*\{\s*dt\s*\}|d[A-Za-z]\s*\/\s*dt|\(\s*[A-Za-z]\s*'\s*,\s*[A-Za-z]\s*'\s*(?:,\s*[A-Za-z]\s*'\s*)?\)|\(\s*\\dot\s*\{?[A-Za-z]\}?\s*,\s*\\dot\s*\{?[A-Za-z]\}?\s*(?:,\s*\\dot\s*\{?[A-Za-z]\}?\s*)?\))\s*=(?!=)\s*/;

/** The formula without a left side such as `F(x, y) =`, `\dot{p} =` or `p' =`. */
export function rightSide(src: string): string {
    const s = src.trim();
    const m = LEFT_SIDE.exec(s);
    return m ? s.slice(m[0].length) : s;
}

/** A tuple written back: `(a, b)`. */
export function tupleText(parts: string[]): string {
    return `(${parts.join(', ')})`;
}

/** A value read at call time from a cell (z and t of a system). */
function cellScalar(cell: { v: number }): Scalar {
    return { kind: 'local', read: () => cell.v };
}

interface Compiled3 {
    fn: VectorFn;
    dim: number;
}

const COMPILED = new WeakMap<MathContext, Map<string, Compiled3 | ExprError>>();

/**
 * A tuple of formulas as a vector function of p = (x, y) or (x, y, z) and t.
 * Each formula is compiled in the chart's context (sliders, functions and
 * computed values work), with z and t read from the call. Throws an
 * ExprError naming the part that does not compile; `dim` is the number of
 * parts the tuple must have (2 or 3).
 */
export function compileTuple(math: MathContext, src: string, dim: 2 | 3): VectorFn {
    let memo = COMPILED.get(math);
    if (!memo) {
        memo = new Map();
        COMPILED.set(math, memo);
    }
    const key = `${dim}|${src}`;
    const hit = memo.get(key);
    if (hit instanceof ExprError) throw hit;
    if (hit) return hit.fn;
    try {
        const fn = buildTuple(math, src, dim);
        memo.set(key, { fn, dim });
        return fn;
    } catch (e) {
        const err = e instanceof ExprError ? e : new ExprError(e instanceof Error ? e.message : String(e));
        memo.set(key, err);
        throw err;
    }
}

/** Messages for the tuple's own problems (set by the caller in the reader's language). */
export interface TupleMessages {
    notTuple(dim: number): string;
    part(index: number, message: string): string;
}

let messages: TupleMessages = {
    notTuple: (dim) => `Write ${dim} formulas in brackets, separated by commas`,
    part: (index, message) => `part ${index}: ${message}`,
};

/** The texts of the tuple problems (src/motion6/scene.ts sets them from the i18n strings). */
export function setTupleMessages(m: TupleMessages): void {
    messages = m;
}

function buildTuple(math: MathContext, src: string, dim: 2 | 3): VectorFn {
    const parts = tupleParts(src);
    if (!parts || parts.length !== dim) throw new ExprError(messages.notTuple(dim));
    const base: Env = math.envFor('fn2');
    const z = { v: NaN };
    const t = { v: 0 };
    const zs = cellScalar(z);
    const ts = cellScalar(t);
    const env: Env = {
        ...base,
        scalar: (name: string) => (name === 't' ? ts : dim === 3 && name === 'z' ? zs : base.scalar(name)),
        knownNames: () => [...base.knownNames(), 't', ...(dim === 3 ? ['z'] : [])],
    };
    const fns = parts.map((p, i) => {
        if (!p.trim()) throw new ExprError(messages.part(i + 1, '?'));
        try {
            return compile(parse(p), env, p);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            throw new ExprError(messages.part(i + 1, message));
        }
    });
    if (dim === 2) {
        const [f, g] = fns;
        return (p, time) => {
            t.v = time;
            return [f(p[0], p[1]), g(p[0], p[1])];
        };
    }
    const [f, g, h] = fns;
    return (p, time) => {
        t.v = time;
        z.v = p[2];
        return [f(p[0], p[1]), g(p[0], p[1]), h(p[0], p[1])];
    };
}

// ------------------------------------------------------------------ RK4

/** Most RK4 steps of one solution. */
export const MAX_STEPS = 20000;
/** The usual RK4 step in t. */
const STEP = 0.005;
/** Fewest steps of a solution. */
const MIN_STEPS = 100;
/** Most points a solution draws (the steps between are left out). */
export const MAX_POINTS = 3000;

export interface Solution {
    /** The points, with their time. */
    pts: number[][];
    ts: number[];
    /** The steps were capped at MAX_STEPS (a long time range: a coarser step). */
    capped: boolean;
    /** It left the numbers (blew up, or has no value) at this time; null when it went the whole way. */
    stopped: number | null;
}

const finiteAll = (p: readonly number[]) => p.every(Number.isFinite);

/**
 * The solution of p' = f(p, t) with p(t0) = p0 for t from t0 to t1 (RK4, a
 * fixed step), at most MAX_POINTS points. It stops where a value is no
 * number or runs past `limit` (a size far outside the chart).
 */
export function solveSystem(f: VectorFn, p0: readonly number[], t0: number, t1: number, limit = Infinity): Solution {
    const span = t1 - t0;
    const wanted = Math.ceil(Math.abs(span) / STEP);
    const steps = Math.max(MIN_STEPS, Math.min(MAX_STEPS, wanted));
    const h = span / steps;
    const every = Math.max(1, Math.ceil(steps / MAX_POINTS));
    const pts: number[][] = [p0.slice()];
    const ts: number[] = [t0];
    let p = p0.slice();
    let stopped: number | null = null;
    const n = p.length;
    const add = (a: readonly number[], b: readonly number[], k: number) => a.map((v, i) => v + k * b[i]);
    for (let i = 1; i <= steps; i++) {
        const t = t0 + (i - 1) * h;
        const k1 = f(p, t);
        const k2 = f(add(p, k1, h / 2), t + h / 2);
        const k3 = f(add(p, k2, h / 2), t + h / 2);
        const k4 = f(add(p, k3, h), t + h);
        const next = new Array<number>(n);
        for (let j = 0; j < n; j++) next[j] = p[j] + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
        if (!finiteAll(next) || next.some((v) => Math.abs(v) > limit)) {
            stopped = t;
            break;
        }
        p = next;
        if (i % every === 0 || i === steps) {
            pts.push(p);
            ts.push(t0 + i * h);
        }
    }
    if (stopped !== null && (ts[ts.length - 1] !== stopped || pts.length === 1)) {
        // The last good point stays the end.
        if (pts[pts.length - 1] !== p) {
            pts.push(p);
            ts.push(stopped);
        }
    }
    return { pts, ts, capped: wanted > MAX_STEPS, stopped };
}

// ---------------------------------------------------------- rest points

export type RestKind = 'stableNode' | 'unstableNode' | 'stableSpiral' | 'unstableSpiral' | 'saddle' | 'centre' | 'degenerate';

export interface RestPoint {
    x: number;
    y: number;
    kind: RestKind;
    /** Both eigenvalues of the Jacobian have a negative real part. */
    stable: boolean;
}

interface Box {
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
}

/** Starts per side of the view for Newton's method. */
const NEWTON_GRID = 16;
const NEWTON_STEPS = 40;
/** Most rest points one field marks. */
export const MAX_REST_POINTS = 40;

/** The Jacobian of F at (x, y) by central differences, [[Px, Py], [Qx, Qy]]. */
export function jacobian(F: (x: number, y: number) => number[], x: number, y: number, hx: number, hy: number): number[][] {
    const a = F(x + hx, y);
    const b = F(x - hx, y);
    const c = F(x, y + hy);
    const d = F(x, y - hy);
    return [
        [(a[0] - b[0]) / (2 * hx), (c[0] - d[0]) / (2 * hy)],
        [(a[1] - b[1]) / (2 * hx), (c[1] - d[1]) / (2 * hy)],
    ];
}

/** The kind of a rest point from its Jacobian (trace, determinant, discriminant). */
export function restKind(J: number[][]): { kind: RestKind; stable: boolean } {
    const tr = J[0][0] + J[1][1];
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    const scale = Math.max(1e-300, Math.abs(J[0][0]) + Math.abs(J[0][1]) + Math.abs(J[1][0]) + Math.abs(J[1][1]));
    const eps = 1e-7;
    if (Math.abs(det) <= eps * scale * scale) return { kind: 'degenerate', stable: false };
    if (det < 0) return { kind: 'saddle', stable: false };
    const disc = tr * tr - 4 * det;
    if (Math.abs(tr) <= eps * scale) return { kind: 'centre', stable: false };
    const stable = tr < 0;
    if (disc >= 0) return { kind: stable ? 'stableNode' : 'unstableNode', stable };
    return { kind: stable ? 'stableSpiral' : 'unstableSpiral', stable };
}

/**
 * The zeros of F in the box (Newton's method from a grid of starts, the
 * same zero found twice kept once), left to right; each with its kind.
 */
export function restPoints(F: (x: number, y: number) => number[], box: Box): RestPoint[] {
    const w = box.xmax - box.xmin;
    const h = box.ymax - box.ymin;
    if (!(w > 0) || !(h > 0)) return [];
    const hx = w * 1e-6;
    const hy = h * 1e-6;
    const found: RestPoint[] = [];
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) <= w * 1e-5 && Math.abs(a.y - b.y) <= h * 1e-5;
    const inside = (x: number, y: number) => x >= box.xmin - w * 1e-9 && x <= box.xmax + w * 1e-9 && y >= box.ymin - h * 1e-9 && y <= box.ymax + h * 1e-9;
    // How small |F| must be: a tiny share of the field's size over the view.
    let size = 0;
    for (let i = 0; i <= 8; i++) {
        for (let j = 0; j <= 8; j++) {
            const v = F(box.xmin + (w * i) / 8, box.ymin + (h * j) / 8);
            if (finiteAll(v)) size = Math.max(size, Math.abs(v[0]), Math.abs(v[1]));
        }
    }
    const tol = Math.max(1e-12, size * 1e-9);
    for (let i = 0; i < NEWTON_GRID && found.length < MAX_REST_POINTS; i++) {
        for (let j = 0; j < NEWTON_GRID && found.length < MAX_REST_POINTS; j++) {
            let x = box.xmin + ((i + 0.5) * w) / NEWTON_GRID;
            let y = box.ymin + ((j + 0.5) * h) / NEWTON_GRID;
            let ok = false;
            for (let k = 0; k < NEWTON_STEPS; k++) {
                const v = F(x, y);
                if (!finiteAll(v)) break;
                if (Math.abs(v[0]) <= tol && Math.abs(v[1]) <= tol) {
                    ok = true;
                    break;
                }
                const J = jacobian(F, x, y, hx, hy);
                const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
                if (!Number.isFinite(det) || det === 0) break;
                const dx = (J[1][1] * v[0] - J[0][1] * v[1]) / det;
                const dy = (-J[1][0] * v[0] + J[0][0] * v[1]) / det;
                // A step far out of the view finds nothing there.
                const m = Math.max(Math.abs(dx) / w, Math.abs(dy) / h);
                const k2 = m > 0.5 ? 0.5 / m : 1;
                x -= dx * k2;
                y -= dy * k2;
                if (!Number.isFinite(x) || !Number.isFinite(y)) break;
            }
            if (!ok || !inside(x, y)) continue;
            // Two more steps: the zero to the last digits.
            for (let k = 0; k < 2; k++) {
                const v = F(x, y);
                const J = jacobian(F, x, y, hx, hy);
                const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
                if (!finiteAll(v) || !Number.isFinite(det) || det === 0) break;
                const nx = x - (J[1][1] * v[0] - J[0][1] * v[1]) / det;
                const ny = y - (-J[1][0] * v[0] + J[0][0] * v[1]) / det;
                const w2 = F(nx, ny);
                if (!finiteAll(w2) || Math.hypot(w2[0], w2[1]) > Math.hypot(v[0], v[1])) break;
                x = nx;
                y = ny;
            }
            const p = { x, y };
            if (found.some((q) => near(q, p))) continue;
            const { kind, stable } = restKind(jacobian(F, x, y, hx, hy));
            found.push({ x, y, kind, stable });
        }
    }
    return found.sort((a, b) => a.x - b.x || a.y - b.y);
}

// ---------------------------------------------------------- streamlines

/**
 * Streamlines of F over the box: from seeds on a grid, both ways along the
 * direction of F (each step the same length on screen), until they leave
 * the box, reach a rest point, or come near another streamline. `ux`, `uy`:
 * pt per unit on each axis; `gap`: the distance between lines in pt.
 */
export function streamlines(F: (x: number, y: number) => number[], box: Box, ux: number, uy: number, gap: number): Array<Array<{ x: number; y: number }>> {
    const wPt = (box.xmax - box.xmin) * ux;
    const hPt = (box.ymax - box.ymin) * uy;
    if (!(wPt > 0) || !(hPt > 0) || !(gap > 0)) return [];
    // An occupancy grid at half the gap: a line stops where another one already runs.
    const cell = gap / 2;
    const gx = Math.max(1, Math.ceil(wPt / cell));
    const gy = Math.max(1, Math.ceil(hPt / cell));
    const owner = new Int32Array(gx * gy).fill(-1);
    const cellOf = (x: number, y: number) => {
        const i = Math.floor(((x - box.xmin) * ux) / cell);
        const j = Math.floor(((y - box.ymin) * uy) / cell);
        return i < 0 || j < 0 || i >= gx || j >= gy ? -1 : j * gx + i;
    };
    const step = gap / 6;
    const maxSteps = Math.ceil((4 * (wPt + hPt)) / step);
    const lines: Array<Array<{ x: number; y: number }>> = [];
    const inside = (x: number, y: number) => x >= box.xmin && x <= box.xmax && y >= box.ymin && y <= box.ymax;
    const dir = (x: number, y: number, sign: number): [number, number] | null => {
        const v = F(x, y);
        if (!finiteAll(v)) return null;
        const sx = v[0] * ux;
        const sy = v[1] * uy;
        const len = Math.hypot(sx, sy);
        if (!(len > 1e-12)) return null;
        return [(sign * step * sx) / len / ux, (sign * step * sy) / len / uy];
    };
    const trace = (x0: number, y0: number, sign: number, id: number): Array<{ x: number; y: number }> => {
        const out: Array<{ x: number; y: number }> = [];
        let x = x0;
        let y = y0;
        const mine = new Set<number>([cellOf(x0, y0)]);
        for (let k = 0; k < maxSteps; k++) {
            // Midpoint (RK2) along the direction field.
            const d1 = dir(x, y, sign);
            if (!d1) break;
            const d2 = dir(x + d1[0] / 2, y + d1[1] / 2, sign);
            if (!d2) break;
            // A turn of more than 90 degrees in one step: a rest point or a pole.
            if (d1[0] * d2[0] * ux * ux + d1[1] * d2[1] * uy * uy < 0) break;
            x += d2[0];
            y += d2[1];
            if (!inside(x, y)) break;
            const c = cellOf(x, y);
            if (c < 0) break;
            if (owner[c] >= 0 && owner[c] !== id) break;
            // Back onto its own earlier part (a closed orbit): one round is enough.
            if (owner[c] === id && !mine.has(c) && out.length > 12) break;
            owner[c] = id;
            mine.add(c);
            out.push({ x, y });
        }
        return out;
    };
    const seeds = Math.max(2, Math.round(Math.max(wPt, hPt) / gap));
    const sx = Math.max(1, Math.round((seeds * wPt) / Math.max(wPt, hPt)));
    const sy = Math.max(1, Math.round((seeds * hPt) / Math.max(wPt, hPt)));
    for (let i = 0; i < sx; i++) {
        for (let j = 0; j < sy; j++) {
            const x = box.xmin + ((i + 0.5) * (box.xmax - box.xmin)) / sx;
            const y = box.ymin + ((j + 0.5) * (box.ymax - box.ymin)) / sy;
            const c = cellOf(x, y);
            if (c < 0 || owner[c] >= 0) continue;
            const id = lines.length;
            owner[c] = id;
            const back = trace(x, y, -1, id).reverse();
            const fwd = trace(x, y, 1, id);
            const line = [...back, { x, y }, ...fwd];
            if (line.length >= 4) lines.push(line);
            else lines.push([]);
        }
    }
    return lines.filter((l) => l.length >= 4);
}

// ------------------------------------------------------------ particles

/** Seconds a particle lives on the clock. */
export const PARTICLE_LIFE = 3;
/** Seconds of its path a particle's trail shows. */
export const TRAIL_SECONDS = 0.6;
/** Steps per second of a particle's path. */
const PARTICLE_FPS = 30;

/** A number in [0, 1) from two whole numbers, the same every time. */
export function hash01(a: number, b: number): number {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

export interface Particle {
    /** The trail, oldest point first; the last point is the particle. */
    trail: Array<{ x: number; y: number }>;
    /** 0..1: it fades in when born and out before it dies. */
    life: number;
}

/**
 * The particles at time `t` of the clock: each is born at a place of its own
 * (the same every run), follows F for PARTICLE_LIFE seconds and is born
 * again elsewhere. Their speed on screen follows |F|, scaled so that a
 * typical arrow's length is crossed in about a second. A pure function of
 * t: the export's still frame and the preview's first frame agree.
 */
export function particlesAt(F: (x: number, y: number) => number[], box: Box, count: number, speed: number, t: number): Particle[] {
    const w = box.xmax - box.xmin;
    const h = box.ymax - box.ymin;
    const out: Particle[] = [];
    if (!(w > 0) || !(h > 0) || !(speed > 0) || !Number.isFinite(t)) return out;
    const dt = 1 / PARTICLE_FPS;
    const trailSteps = Math.round(TRAIL_SECONDS * PARTICLE_FPS);
    const fade = 0.4;
    for (let i = 0; i < count; i++) {
        const phase = hash01(i, 7) * PARTICLE_LIFE;
        const u = t + phase;
        const cycle = Math.floor(u / PARTICLE_LIFE);
        const age = u - cycle * PARTICLE_LIFE;
        let x = box.xmin + hash01(i, 2 * cycle + 1) * w;
        let y = box.ymin + hash01(i, 2 * cycle + 2) * h;
        const steps = Math.floor(age * PARTICLE_FPS);
        const trail: Array<{ x: number; y: number }> = [];
        const from = steps - trailSteps;
        if (from <= 0) trail.push({ x, y });
        for (let k = 1; k <= steps; k++) {
            const a = F(x, y);
            if (!finiteAll(a)) break;
            const mx = x + 0.5 * dt * speed * a[0];
            const my = y + 0.5 * dt * speed * a[1];
            const b = F(mx, my);
            if (!finiteAll(b)) break;
            x += dt * speed * b[0];
            y += dt * speed * b[1];
            if (!Number.isFinite(x) || !Number.isFinite(y)) break;
            if (k >= from) trail.push({ x, y });
        }
        if (trail.length < 2) continue;
        const life = Math.max(0, Math.min(1, age / fade, (PARTICLE_LIFE - age) / fade));
        out.push({ trail, life });
    }
    return out;
}
