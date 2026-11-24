/*
 * 6.0 A: matrices and vectors: products, the determinant, the inverse, the
 * transpose, eigenvalues and eigenvectors (any size for the first ones;
 * eigen for 2x2 and 3x3, what part D draws). Plain arrays, row by row.
 * Pure: no DOM, no Obsidian.
 */
import { Complex, Mat, complex, mat } from './types';

/** The n x n identity matrix. */
export function identity(n: number): Mat {
    const a = new Array<number>(n * n).fill(0);
    for (let i = 0; i < n; i++) a[i * n + i] = 1;
    return mat(n, n, a);
}

export function transpose(m: Mat): Mat {
    const a = new Array<number>(m.rows * m.cols);
    for (let i = 0; i < m.rows; i++) for (let j = 0; j < m.cols; j++) a[j * m.rows + i] = m.a[i * m.cols + j];
    return mat(m.cols, m.rows, a);
}

/** A B; null when the sizes do not fit. */
export function matMul(x: Mat, y: Mat): Mat | null {
    if (x.cols !== y.rows) return null;
    const a = new Array<number>(x.rows * y.cols).fill(0);
    for (let i = 0; i < x.rows; i++) {
        for (let k = 0; k < x.cols; k++) {
            const v = x.a[i * x.cols + k];
            for (let j = 0; j < y.cols; j++) a[i * y.cols + j] += v * y.a[k * y.cols + j];
        }
    }
    return mat(x.rows, y.cols, a);
}

/** A v; null when the sizes do not fit. */
export function matVec(m: Mat, v: readonly number[]): number[] | null {
    if (m.cols !== v.length) return null;
    const out = new Array<number>(m.rows).fill(0);
    for (let i = 0; i < m.rows; i++) for (let j = 0; j < m.cols; j++) out[i] += m.a[i * m.cols + j] * v[j];
    return out;
}

/** v A (v as a row); null when the sizes do not fit. */
export function vecMat(v: readonly number[], m: Mat): number[] | null {
    if (m.rows !== v.length) return null;
    const out = new Array<number>(m.cols).fill(0);
    for (let j = 0; j < m.cols; j++) for (let i = 0; i < m.rows; i++) out[j] += v[i] * m.a[i * m.cols + j];
    return out;
}

/** The determinant of a square matrix (NaN otherwise): exact formulas up to 3 x 3, elimination with pivoting above. */
export function det(m: Mat): number {
    if (m.rows !== m.cols) return NaN;
    const a = m.a;
    switch (m.rows) {
        case 0:
            return 1;
        case 1:
            return a[0];
        case 2:
            return a[0] * a[3] - a[1] * a[2];
        case 3:
            return a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
    }
    const n = m.rows;
    const w = a.slice();
    let d = 1;
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(w[r * n + c]) > Math.abs(w[p * n + c])) p = r;
        if (w[p * n + c] === 0) return 0;
        if (p !== c) {
            for (let j = 0; j < n; j++) [w[c * n + j], w[p * n + j]] = [w[p * n + j], w[c * n + j]];
            d = -d;
        }
        const piv = w[c * n + c];
        d *= piv;
        for (let r = c + 1; r < n; r++) {
            const f = w[r * n + c] / piv;
            for (let j = c; j < n; j++) w[r * n + j] -= f * w[c * n + j];
        }
    }
    return d;
}

/** The trace (NaN for a matrix that is not square). */
export function trace(m: Mat): number {
    if (m.rows !== m.cols) return NaN;
    let t = 0;
    for (let i = 0; i < m.rows; i++) t += m.a[i * m.cols + i];
    return t;
}

/** The inverse (Gauss-Jordan with pivoting); null for a singular matrix or one that is not square. */
export function inverse(m: Mat): Mat | null {
    const n = m.rows;
    if (n !== m.cols || n === 0) return null;
    const w = m.a.slice();
    const inv = identity(n).a.slice();
    let scale = 0;
    for (const v of w) scale = Math.max(scale, Math.abs(v));
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(w[r * n + c]) > Math.abs(w[p * n + c])) p = r;
        if (!(Math.abs(w[p * n + c]) > 1e-14 * scale)) return null;
        if (p !== c) {
            for (let j = 0; j < n; j++) {
                [w[c * n + j], w[p * n + j]] = [w[p * n + j], w[c * n + j]];
                [inv[c * n + j], inv[p * n + j]] = [inv[p * n + j], inv[c * n + j]];
            }
        }
        const piv = w[c * n + c];
        for (let j = 0; j < n; j++) {
            w[c * n + j] /= piv;
            inv[c * n + j] /= piv;
        }
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = w[r * n + c];
            if (f === 0) continue;
            for (let j = 0; j < n; j++) {
                w[r * n + j] -= f * w[c * n + j];
                inv[r * n + j] -= f * inv[c * n + j];
            }
        }
    }
    return mat(n, n, inv);
}

/** A^k for a square matrix and a whole k (negative: of the inverse); null when there is none. */
export function matPow(m: Mat, k: number): Mat | null {
    if (m.rows !== m.cols || !Number.isInteger(k) || Math.abs(k) > 1e6) return null;
    let base: Mat | null = k < 0 ? inverse(m) : m;
    if (!base) return null;
    let e = Math.abs(k);
    let out: Mat = identity(m.rows);
    while (e > 0) {
        if (e & 1) out = matMul(out, base) ?? out;
        e >>= 1;
        if (e) base = matMul(base, base) ?? base;
    }
    return out;
}

/** One eigenvalue with an eigenvector of length 1 (null for a complex eigenvalue). */
export interface Eigenpair {
    value: number | Complex;
    vector: number[] | null;
}

/**
 * Eigenvalues and eigenvectors of a 2 x 2 or 3 x 3 matrix: real ones from
 * the largest down, then complex pairs (no vector). A repeated eigenvalue
 * of a multiple of the identity has one vector per axis. Empty for other
 * sizes or numbers that are not finite.
 */
export function eigen(m: Mat): Eigenpair[] {
    if (m.rows !== m.cols || (m.rows !== 2 && m.rows !== 3) || !m.a.every(Number.isFinite)) return [];
    const n = m.rows;
    const values = n === 2 ? eigenvalues2(m) : eigenvalues3(m);
    const real = values.filter((v): v is number => typeof v === 'number').sort((a, b) => b - a);
    const out: Eigenpair[] = [];
    const scale = Math.max(1, ...m.a.map(Math.abs));
    // A multiple of the identity: every direction is an eigenvector; the axes stand for them.
    const offDiagonal = m.a.every((v, i) => i % (n + 1) === 0 || Math.abs(v) <= 1e-12 * scale);
    const sameDiagonal = Array.from({ length: n }, (_, i) => m.a[i * (n + 1)]).every((v) => Math.abs(v - m.a[0]) <= 1e-12 * scale);
    if (offDiagonal && sameDiagonal) {
        for (let i = 0; i < n; i++) {
            const e = new Array<number>(n).fill(0);
            e[i] = 1;
            out.push({ value: m.a[0], vector: e });
        }
        return out;
    }
    let last = NaN;
    for (const v of real) {
        // A repeated root gets its vectors once.
        if (Math.abs(v - last) <= 1e-9 * scale) continue;
        last = v;
        for (const vector of nullVectors(m, v, scale)) out.push({ value: v, vector });
    }
    for (const v of values) if (typeof v !== 'number') out.push({ value: v, vector: null });
    return out;
}

function eigenvalues2(m: Mat): Array<number | Complex> {
    const [a, b, c, d] = m.a;
    const half = (a + d) / 2;
    const disc = half * half - (a * d - b * c);
    if (disc >= 0) {
        const r = Math.sqrt(disc);
        return [half + r, half - r];
    }
    const r = Math.sqrt(-disc);
    return [complex(half, r), complex(half, -r)];
}

/** The roots of x^3 + p2 x^2 + p1 x + p0 (the characteristic polynomial, negated). */
function eigenvalues3(m: Mat): Array<number | Complex> {
    const a = m.a;
    const tr = a[0] + a[4] + a[8];
    const minors = a[0] * a[4] - a[1] * a[3] + a[0] * a[8] - a[2] * a[6] + a[4] * a[8] - a[5] * a[7];
    return cubicRoots(-tr, minors, -det(m));
}

/** Roots of x^3 + b x^2 + c x + d: three real ones, or one real one and a complex pair. */
export function cubicRoots(b: number, c: number, d: number): Array<number | Complex> {
    const shift = b / 3;
    const p = c - (b * b) / 3;
    const q = (2 * b * b * b) / 27 - (b * c) / 3 + d;
    const disc = (q * q) / 4 + (p * p * p) / 27;
    const tiny = 1e-14 * Math.max(1, Math.abs(b), Math.abs(c), Math.abs(d)) ** 2;
    if (disc > tiny) {
        const s = Math.sqrt(disc);
        const u = Math.cbrt(-q / 2 + s);
        const v = Math.cbrt(-q / 2 - s);
        const re = -(u + v) / 2 - shift;
        const im = (Math.sqrt(3) / 2) * (u - v);
        return [u + v - shift, complex(re, im), complex(re, -im)];
    }
    if (Math.abs(p) < 1e-14) {
        const r = Math.cbrt(-q) - shift;
        return [r, r, r];
    }
    const r = 2 * Math.sqrt(-p / 3);
    const arg = Math.max(-1, Math.min(1, (3 * q) / (p * r)));
    const phi = Math.acos(arg) / 3;
    return [0, 1, 2].map((k) => r * Math.cos(phi - (2 * Math.PI * k) / 3) - shift);
}

/** Unit vectors that A - vI sends to 0 (one, or two for a double root of a 3 x 3 matrix). */
function nullVectors(m: Mat, v: number, scale: number): number[][] {
    const n = m.rows;
    const rows: number[][] = [];
    for (let i = 0; i < n; i++) rows.push(Array.from({ length: n }, (_, j) => m.a[i * n + j] - (i === j ? v : 0)));
    const unit = (x: number[]): number[] | null => {
        const len = Math.hypot(...x);
        if (!(len > 1e-12 * scale)) return null;
        // One sign for every vector: its largest entry positive.
        let big = 0;
        for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[big]) + 1e-12) big = i;
        const s = x[big] < 0 ? -1 : 1;
        return x.map((c) => (s * c) / len + 0);
    };
    if (n === 2) {
        const [r0, r1] = rows;
        const cand = Math.hypot(r0[0], r0[1]) >= Math.hypot(r1[0], r1[1]) ? [-r0[1], r0[0]] : [-r1[1], r1[0]];
        const u = unit(cand);
        return u ? [u] : [[1, 0]];
    }
    // 3 x 3: the cross product of two rows that are not parallel.
    let best: number[] | null = null;
    let bestLen = 0;
    for (let i = 0; i < 3; i++) {
        for (let j = i + 1; j < 3; j++) {
            const c = cross3(rows[i], rows[j]);
            const len = Math.hypot(...c);
            if (len > bestLen) {
                bestLen = len;
                best = c;
            }
        }
    }
    if (best && bestLen > 1e-9 * scale * scale) {
        const u = unit(best);
        return u ? [u] : [];
    }
    // Rank 1: a plane of eigenvectors, two that are square to the row that is left.
    let row = rows[0];
    for (const r of rows) if (Math.hypot(...r) > Math.hypot(...row)) row = r;
    const helper = Math.abs(row[0]) < 0.9 * Math.hypot(...row) ? [1, 0, 0] : [0, 1, 0];
    const a = unit(cross3(row, helper));
    if (!a) return [[1, 0, 0]];
    const b = unit(cross3(row, a));
    return b ? [a, b] : [a];
}

export function cross3(a: readonly number[], b: readonly number[]): number[] {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
