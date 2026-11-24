/*
 * The maths of 6.0 D: the map of a transform (a matrix, or a map of points
 * such as z ↦ z² or (x, y) ↦ (x + y, y)), compiled in a chart's context;
 * the map part of the way there, (1 - t)I + tA or (1 - t)z + t f(z); lines
 * and rings carried through a map (cut into short pieces when the map
 * bends them, broken where it jumps); areas; the eigenvectors and the
 * numbers of a matrix as text. Pure: no DOM, no Obsidian.
 */
import type { MathContext } from '../mathcontext';
import type { Pt, View } from '../geometry';
import { ExprError } from '../expr';
import { t as msg } from '../i18n';
import { compileComplex, compileValue, complex, det, eigen, isComplex, isMat, isVec, vec } from '../values/index';
import type { Eigenpair, Mat, Value } from '../values/index';
import { shapeText } from '../values/compile';
import { shapeOf } from '../values/types';

/** A map of the plane (dim 2) or of space (dim 3). */
export interface LinearMap {
    dim: 2 | 3;
    /** A matrix, row by row (dim x dim numbers); null for a map of points. */
    m: number[] | null;
    /** A map of points (null for a matrix): the image of `p` (dim numbers; NaN where it has none). */
    f: ((p: readonly number[]) => number[]) | null;
    /** The map is z ↦ f(z) (complex numbers). */
    complex: boolean;
    /** The let name of the matrix when the map is one (`A`), for labels. */
    name: string | null;
}

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** `z \mapsto z^2`, `(x, y) |-> (x + y, y)`, `z -> 1/z`: the left and right side, or null. */
export function splitMapsto(src: string): { left: string; right: string } | null {
    const m = /^\s*(.+?)\s*(?:\\mapsto(?![A-Za-z])|\\longmapsto(?![A-Za-z])|↦|\|->|->)\s*([\s\S]+?)\s*$/.exec(src);
    if (!m) return null;
    return { left: m[1].trim(), right: m[2].trim() };
}

/** The input names of the left side: `z` (one name) or `(x, y)`. */
function leftNames(left: string): string[] | null {
    const plain = left.replace(/^\\left\s*\(|\\right\s*\)$/g, (s) => (s.includes('(') ? '(' : ')'));
    if (NAME.test(plain)) return [plain];
    const m = /^\(\s*([^()]*)\s*\)$/.exec(plain);
    if (!m) return null;
    const names = m[1].split(',').map((s) => s.trim());
    return names.every((n) => NAME.test(n)) ? names : null;
}

/** A value as a point of `dim` numbers (a complex number is (re, im)); null when it is none. */
function asPoint(v: Value, dim: 2 | 3): number[] | null {
    if (typeof v === 'number') return dim === 2 ? [v, 0] : null;
    if (isComplex(v)) return dim === 2 ? [v.re, v.im] : null;
    if (isVec(v) && v.v.length === dim) return [...v.v];
    return null;
}

const nanPoint = (dim: 2 | 3) => (dim === 2 ? [NaN, NaN] : [NaN, NaN, NaN]);

/**
 * The map of a transform in the scope of `math`: a matrix value of the
 * chart's dimension, a map `z \mapsto f(z)` (2D), `(x, y) \mapsto (...)`,
 * `v \mapsto A v`, or the name of a let function (of one argument z in 2D,
 * or of dim numbers). Throws ExprError (or an Error with the message).
 */
export function compileMap(math: MathContext, srcIn: string, dim: 2 | 3): LinearMap {
    const src = srcIn.trim();
    if (!src) throw new ExprError(msg('linear.problem.noMap'));
    const parts = splitMapsto(src);
    if (parts) {
        const names = leftNames(parts.left);
        if (!names) throw new ExprError(msg('linear.problem.mapLeft', { left: parts.left }));
        return pointMap(math, names, parts.right, dim);
    }
    // A let function: z ↦ f(z), or (x, y) ↦ f(x, y).
    const table = math.valueTable();
    if (NAME.test(src) && table.has(src) && table.isFunction(src)) {
        const ref = table.ref(src);
        const n = ref && ref.fn ? ref.fn.params.length : 0;
        if (dim === 2 && n === 1) return pointMap(math, ['z'], `${src}(z)`, dim);
        if (n === dim) {
            const vars = dim === 2 ? ['x', 'y'] : ['x', 'y', 'z'];
            return pointMap(math, vars, `${src}(${vars.join(', ')})`, dim);
        }
        throw new ExprError(msg('linear.problem.notMatrix', { n: dim, what: src }));
    }
    const value = compileValue(math, src).run();
    if (!isMat(value) || value.rows !== dim || value.cols !== dim) throw new ExprError(msg('linear.problem.notMatrix', { n: dim, what: shapeText(shapeOf(value)) }));
    return { dim, m: [...value.a], f: null, complex: false, name: NAME.test(src) ? src : null };
}

function pointMap(math: MathContext, names: string[], right: string, dim: 2 | 3): LinearMap {
    if (names.length === 1) {
        const name = names[0];
        // z (or w) ↦ f(z): complex numbers, the fast form when it has one.
        if (dim === 2 && (name === 'z' || name === 'w')) {
            try {
                const fast = compileComplex(math, right, [name]);
                const inp = new Float64Array(2);
                const out = new Float64Array(2);
                return {
                    dim,
                    m: null,
                    complex: true,
                    name: null,
                    f: (p) => {
                        inp[0] = p[0];
                        inp[1] = p[1];
                        fast.run(inp, out);
                        return [out[0], out[1]];
                    },
                };
            } catch {
                // Not in the fast form (a vector, a list, a function it does not know): the general one.
            }
            const slow = compileValue(math, right, [{ name, shape: { k: 'complex' } }]);
            return { dim, m: null, complex: true, name: null, f: (p) => asPoint(slow.run(complex(p[0], p[1])), dim) ?? nanPoint(dim) };
        }
        // v ↦ A v: a vector of the chart's dimension.
        const general = compileValue(math, right, [{ name, shape: { k: 'vec', n: dim } }]);
        return { dim, m: null, complex: false, name: null, f: (p) => asPoint(general.run(vec([...p])), dim) ?? nanPoint(dim) };
    }
    if (names.length !== dim) throw new ExprError(msg('linear.problem.mapLeft', { left: `(${names.join(', ')})` }));
    const general = compileValue(
        math,
        right,
        names.map((n) => ({ name: n, shape: { k: 'num' as const } }))
    );
    return { dim, m: null, complex: false, name: null, f: (p) => asPoint(general.run(...p), dim) ?? nanPoint(dim) };
}

/** The matrix part of the way there, (1 - t)I + tA; null for a map of points. */
export function matrixAt(map: LinearMap, t: number): number[] | null {
    if (!map.m) return null;
    const n = map.dim;
    return map.m.map((a, k) => (k % (n + 1) === 0 ? 1 - t + t * a : t * a));
}

/** The map part of the way there: (1 - t)I + tA, or p ↦ (1 - t)p + t f(p). */
export function pointsAt(map: LinearMap, t: number): (p: readonly number[]) => number[] {
    const m = matrixAt(map, t);
    if (m) {
        if (map.dim === 2) return (p) => [m[0] * p[0] + m[1] * p[1], m[2] * p[0] + m[3] * p[1]];
        return (p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]];
    }
    const f = map.f ?? ((p: readonly number[]) => [...p]);
    if (t >= 1) return f;
    if (t <= 0) return (p) => [...p];
    return (p) => {
        const q = f(p);
        return p.map((c, i) => (1 - t) * c + t * q[i]);
    };
}

/** Is the map the identity at `t` (nothing moves)? */
export function stillAt(map: LinearMap, t: number): boolean {
    if (t <= 0) return true;
    const m = map.m;
    if (!m) return false;
    const n = map.dim;
    return m.every((a, k) => a === (k % (n + 1) === 0 ? 1 : 0));
}

// ------------------------------------------------------------- lines

/** Coordinates this many view spans away (or more) are not drawn: a line breaks there. */
const FAR = 1000;

/**
 * A polyline (math coordinates) carried through `f`. A map that bends
 * lines (`exact` false) gets the line in pieces of at most `h` first; the
 * result breaks where a point has no image, lies far outside the view, or
 * (bent) jumps by more than half the view between two neighbours (a pole).
 */
export function mapLine(line: readonly Pt[], f: (p: readonly number[]) => number[], exact: boolean, h: number, view: View, closed = false): Pt[][] {
    const span = Math.max(view.xmax - view.xmin, view.ymax - view.ymin);
    const far = FAR * span;
    const cx = (view.xmin + view.xmax) / 2;
    const cy = (view.ymin + view.ymax) / 2;
    const src: Pt[] = [];
    const pts = closed && line.length > 2 ? [...line, line[0]] : line;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        if (exact || i === 0) {
            src.push(a);
            continue;
        }
        const b = pts[i - 1];
        const len = Math.hypot(a.x - b.x, a.y - b.y);
        const n = Number.isFinite(len) ? Math.min(400, Math.max(1, Math.ceil(len / h))) : 1;
        for (let k = 1; k <= n; k++) src.push({ x: b.x + ((a.x - b.x) * k) / n, y: b.y + ((a.y - b.y) * k) / n });
    }
    const runs: Pt[][] = [];
    let run: Pt[] = [];
    let prev: Pt | null = null;
    for (const p of src) {
        const q = f([p.x, p.y]);
        const ok = Number.isFinite(q[0]) && Number.isFinite(q[1]) && Math.abs(q[0] - cx) < far && Math.abs(q[1] - cy) < far;
        const jump = ok && !exact && prev !== null && Math.hypot(q[0] - prev.x, q[1] - prev.y) > span / 2;
        if (!ok || jump) {
            if (run.length > 1) runs.push(run);
            run = [];
            prev = null;
            if (!ok) continue;
        }
        const pt = { x: q[0], y: q[1] };
        run.push(pt);
        prev = pt;
    }
    if (run.length > 1) runs.push(run);
    return runs;
}

/** A closed ring carried through `f` (null when a point has no image: the ring is left out). */
export function mapRing(ring: readonly Pt[], f: (p: readonly number[]) => number[], exact: boolean, h: number): Pt[] | null {
    const out: Pt[] = [];
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const n = exact || !Number.isFinite(len) ? 1 : Math.min(400, Math.max(1, Math.ceil(len / h)));
        for (let k = 0; k < n; k++) {
            const q = f([a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n]);
            if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) return null;
            out.push({ x: q[0], y: q[1] });
        }
    }
    return out;
}

/** The signed area of a ring (positive counterclockwise). */
export function ringArea(ring: readonly Pt[]): number {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
}

// ------------------------------------------------------------ matrices

/** A matrix value of the chart (a let name or a formula) as a Mat of dim x dim; throws ExprError. */
export function matrixValue(math: MathContext, src: string, dim: 2 | 3): Mat {
    const value = compileValue(math, src).run();
    if (!isMat(value) || value.rows !== dim || value.cols !== dim) throw new ExprError(msg('linear.problem.notMatrix', { n: dim, what: shapeText(shapeOf(value)) }));
    return value;
}

/** The eigenpairs of a matrix (values/linalg.ts), and whether every vector is one (A = λI). */
export function eigenOf(m: Mat): { pairs: Eigenpair[]; every: boolean } {
    const pairs = eigen(m);
    const n = m.rows;
    const scale = Math.max(1, ...m.a.map(Math.abs));
    const every = m.a.every((v, i) => (i % (n + 1) === 0 ? Math.abs(v - m.a[0]) <= 1e-12 * scale : Math.abs(v) <= 1e-12 * scale));
    return { pairs, every };
}

export { det };
