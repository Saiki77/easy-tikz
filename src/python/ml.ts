/*
 * 6.0 ML: the NumPy a machine learning script needs beyond the 6.0 P
 * subset (docs/v6/ml.md): keepdims on reductions, np.linalg.svd, pinv,
 * lstsq and matrix_rank (one-sided Jacobi, exact to rounding for the small
 * matrices a chart holds), np.cov, np.corrcoef, np.logaddexp, np.bincount,
 * np.vander and np.random.multivariate_normal. src/python/numpy.ts adds them to its
 * modules in small blocks marked `// 6.0 ML`. Pure: no DOM, no Obsidian.
 */
import { valueError } from './errors';
import { arg, intArg } from './ops';
import { Rng, num } from './builtins';
import { work } from './budget';
import { fromNumbers, newArray, reshape, toArray } from './ndarray';
import { Kwargs, NDArray, PyBuiltin, PyTuple, PyValue, isNum, truthy } from './values';

const fn = (name: string, f: (args: PyValue[], kw: Kwargs | null) => PyValue) => new PyBuiltin(name, f);

// ------------------------------------------------------------ keepdims

/** A reduction's result with the reduced axis kept as length 1 (`keepdims=True`): it broadcasts against `a`. */
export function keepDims(result: PyValue, a: NDArray, axis: number | null, kw: Kwargs | null): PyValue {
    if (!kw || !kw.has('keepdims') || !truthy(kw.get('keepdims') ?? false)) return result;
    const r = toArray(result);
    const shape = axis === null || a.ndim <= 1 ? a.shape.map(() => 1) : a.shape.map((d, i) => (i === axis ? 1 : d));
    return reshape(r, shape);
}

// ------------------------------------------------------------ matrices

/** A 2-d array as rows x columns (a 1-d array is one row). */
function matrix(v: PyValue, name: string): { m: number; n: number; a: Float64Array } {
    const arr = toArray(v);
    if (arr.dtype === 'complex') throw valueError('ml.numpy.real', { name });
    if (arr.ndim === 1) return { m: 1, n: arr.shape[0], a: Float64Array.from(arr.data) };
    if (arr.ndim !== 2) throw valueError('ml.numpy.matrix', { name });
    return { m: arr.shape[0], n: arr.shape[1], a: Float64Array.from(arr.data) };
}

export interface Svd {
    /** m x k (row by row), k = min(m, n). */
    u: Float64Array;
    /** k values, largest first. */
    s: Float64Array;
    /** k x n (row by row): the rows are the right singular vectors. */
    vt: Float64Array;
    m: number;
    n: number;
    k: number;
}

/**
 * The thin SVD of an m x n matrix (row by row) by one-sided Jacobi
 * (Hestenes): columns are turned in pairs until they are orthogonal; their
 * lengths are the singular values. A wide matrix goes through its
 * transpose. Signs: each right singular vector has its largest entry
 * positive, so the result is the same each time.
 */
export function svd(m: number, n: number, a: Float64Array): Svd {
    if (m < n) {
        const t = new Float64Array(m * n);
        for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) t[j * m + i] = a[i * n + j];
        const r = svd(n, m, t);
        // A^T = U S V^T, so A = V S U^T.
        const k = r.k;
        const u = new Float64Array(m * k);
        const vt = new Float64Array(k * n);
        for (let i = 0; i < m; i++) for (let c = 0; c < k; c++) u[i * k + c] = r.vt[c * m + i];
        for (let c = 0; c < k; c++) for (let j = 0; j < n; j++) vt[c * n + j] = r.u[j * k + c];
        return { u, s: r.s, vt, m, n, k };
    }
    // m >= n: work on the columns of a copy (column c of row i at i * n + c).
    const w = Float64Array.from(a);
    const v = new Float64Array(n * n);
    for (let i = 0; i < n; i++) v[i * n + i] = 1;
    work(m * n * n);
    const eps = 1e-15;
    for (let sweep = 0; sweep < 60; sweep++) {
        let turned = false;
        for (let p = 0; p < n - 1; p++) {
            for (let q = p + 1; q < n; q++) {
                let alpha = 0;
                let beta = 0;
                let gamma = 0;
                for (let i = 0; i < m; i++) {
                    const x = w[i * n + p];
                    const y = w[i * n + q];
                    alpha += x * x;
                    beta += y * y;
                    gamma += x * y;
                }
                if (!(Math.abs(gamma) > eps * Math.sqrt(alpha * beta)) || gamma === 0) continue;
                turned = true;
                const zeta = (beta - alpha) / (2 * gamma);
                const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
                const c = 1 / Math.sqrt(1 + t * t);
                const s = c * t;
                for (let i = 0; i < m; i++) {
                    const x = w[i * n + p];
                    const y = w[i * n + q];
                    w[i * n + p] = c * x - s * y;
                    w[i * n + q] = s * x + c * y;
                }
                for (let i = 0; i < n; i++) {
                    const x = v[i * n + p];
                    const y = v[i * n + q];
                    v[i * n + p] = c * x - s * y;
                    v[i * n + q] = s * x + c * y;
                }
            }
        }
        if (!turned) break;
    }
    const k = n;
    const lens = Array.from({ length: n }, (_, c) => {
        let s = 0;
        for (let i = 0; i < m; i++) s += w[i * n + c] ** 2;
        return Math.sqrt(s);
    });
    const order = lens.map((_, i) => i).sort((x, y) => lens[y] - lens[x]);
    const s = new Float64Array(k);
    const u = new Float64Array(m * k);
    const vt = new Float64Array(k * n);
    order.forEach((c, r) => {
        s[r] = lens[c];
        // The sign that makes the largest entry of the right vector positive.
        let big = 0;
        for (let j = 0; j < n; j++) if (Math.abs(v[j * n + c]) > Math.abs(big)) big = v[j * n + c];
        const sign = big < 0 ? -1 : 1;
        for (let j = 0; j < n; j++) vt[r * n + j] = sign * v[j * n + c];
        for (let i = 0; i < m; i++) u[i * k + r] = lens[c] > 0 ? (sign * w[i * n + c]) / lens[c] : 0;
    });
    completeColumns(u, m, k, s);
    return { u, s, vt, m, n, k };
}

/** Columns of `u` (m x k) for zero singular values: unit vectors orthogonal to the others (Gram-Schmidt on e1, e2, ...). */
function completeColumns(u: Float64Array, m: number, k: number, s: Float64Array): void {
    const top = s.length ? s[0] : 0;
    const good: number[] = [];
    for (let c = 0; c < k; c++) if (s[c] > top * 1e-14 && s[c] > 0) good.push(c);
    if (good.length === k) return;
    let e = 0;
    for (let c = 0; c < k; c++) {
        if (good.includes(c)) continue;
        for (; e < m; e++) {
            const col = new Float64Array(m);
            col[e] = 1;
            for (const g of good) {
                let d = 0;
                for (let i = 0; i < m; i++) d += u[i * k + g] * col[i];
                for (let i = 0; i < m; i++) col[i] -= d * u[i * k + g];
            }
            const len = Math.hypot(...col);
            if (len > 1e-8) {
                for (let i = 0; i < m; i++) u[i * k + c] = col[i] / len;
                good.push(c);
                e++;
                break;
            }
        }
    }
}

/** An m x m orthonormal basis whose first k columns are those of `u` (numpy's full_matrices=True). */
function fullU(u: Float64Array, m: number, k: number): Float64Array {
    const out = new Float64Array(m * m);
    for (let i = 0; i < m; i++) for (let c = 0; c < k; c++) out[i * m + c] = u[i * k + c];
    let c = k;
    work(m * m * m);
    for (let e = 0; e < m && c < m; e++) {
        const col = new Float64Array(m);
        col[e] = 1;
        for (let g = 0; g < c; g++) {
            let d = 0;
            for (let i = 0; i < m; i++) d += out[i * m + g] * col[i];
            for (let i = 0; i < m; i++) col[i] -= d * out[i * m + g];
        }
        const len = Math.hypot(...col);
        if (len < 1e-8) continue;
        for (let i = 0; i < m; i++) out[i * m + c] = col[i] / len;
        c++;
    }
    return out;
}

/** The pseudo-inverse (n x m) of an m x n matrix: V diag(1/s) U^T, small singular values left out. */
function pseudoInverse(r: Svd, rcond: number): Float64Array {
    const { m, n, k } = r;
    const cut = rcond * (r.s[0] ?? 0);
    const out = new Float64Array(n * m);
    for (let c = 0; c < k; c++) {
        if (!(r.s[c] > cut)) continue;
        const inv = 1 / r.s[c];
        for (let j = 0; j < n; j++) {
            const vj = r.vt[c * n + j] * inv;
            if (vj === 0) continue;
            for (let i = 0; i < m; i++) out[j * m + i] += vj * r.u[i * k + c];
        }
    }
    return out;
}

function rankOf(r: Svd, tol: number | null): number {
    const t = tol ?? (r.s[0] ?? 0) * Math.max(r.m, r.n) * 2.220446049250313e-16;
    let rank = 0;
    for (const s of r.s) if (s > t) rank++;
    return rank;
}

// ------------------------------------------------------------ statistics

/** The variables of np.cov: rows of observations (rowvar) or columns, as a list of rows. */
function variables(v: PyValue, rowvar: boolean): { rows: number; cols: number; a: Float64Array } {
    const { m, n, a } = matrix(v, 'cov');
    if (rowvar || m === 1) return { rows: m, cols: n, a };
    const t = new Float64Array(m * n);
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) t[j * m + i] = a[i * n + j];
    return { rows: n, cols: m, a: t };
}

function covariance(args: PyValue[], kw: Kwargs | null): { k: number; c: Float64Array } {
    const rowvar = truthy(arg(args, kw, 2, 'rowvar', true));
    let { rows, cols, a } = variables(args[0] ?? null, rowvar);
    const y = arg(args, kw, 1, 'y', null);
    if (y !== null) {
        const more = variables(y, rowvar);
        if (more.cols !== cols) throw valueError('ml.numpy.covShapes');
        const joined = new Float64Array((rows + more.rows) * cols);
        joined.set(a);
        joined.set(more.a, rows * cols);
        a = joined;
        rows += more.rows;
    }
    const bias = truthy(arg(args, kw, 3, 'bias', false));
    const ddofV = arg(args, kw, 4, 'ddof', null);
    const ddof = ddofV === null ? (bias ? 0 : 1) : num(ddofV);
    work(rows * rows * cols);
    const mean = new Float64Array(rows);
    for (let r = 0; r < rows; r++) {
        let s = 0;
        for (let j = 0; j < cols; j++) s += a[r * cols + j];
        mean[r] = s / cols;
    }
    const c = new Float64Array(rows * rows);
    for (let p = 0; p < rows; p++) {
        for (let q = p; q < rows; q++) {
            let s = 0;
            for (let j = 0; j < cols; j++) s += (a[p * cols + j] - mean[p]) * (a[q * cols + j] - mean[q]);
            c[p * rows + q] = c[q * rows + p] = s / (cols - ddof);
        }
    }
    return { k: rows, c };
}

// ------------------------------------------------------------ the modules

/** np.logaddexp, np.cov, np.corrcoef, np.bincount into numpy; svd, pinv, lstsq, matrix_rank into np.linalg. */
export function mlNumpy(m: Map<string, PyValue>, la: Map<string, PyValue>, binary: (name: string, f: (x: number, y: number) => number) => PyBuiltin): void {
    m.set('logaddexp', binary('logaddexp', (x, y) => {
        if (x === -Infinity) return y;
        if (y === -Infinity) return x;
        const hi = Math.max(x, y);
        return hi + Math.log1p(Math.exp(-Math.abs(x - y)));
    }));
    m.set('cov', fn('cov', (a, kw) => {
        const { k, c } = covariance(a, kw);
        return k === 1 ? c[0] : new NDArray([k, k], c, 'float');
    }));
    m.set('corrcoef', fn('corrcoef', (a, kw) => {
        const { k, c } = covariance(a, kw);
        const out = new Float64Array(k * k);
        for (let p = 0; p < k; p++) {
            for (let q = 0; q < k; q++) out[p * k + q] = Math.max(-1, Math.min(1, c[p * k + q] / Math.sqrt(c[p * k + p] * c[q * k + q])));
        }
        return k === 1 ? out[0] : new NDArray([k, k], out, 'float');
    }));
    // np.vander(x, N, increasing): the powers of x, highest first (the features of a polynomial fit).
    m.set('vander', fn('vander', (a, kw) => {
        const x = toArray(a[0] ?? null);
        const nV = arg(a, kw, 1, 'N', null);
        const n = nV === null ? x.size : Math.max(0, intArg(nV));
        const up = truthy(arg(a, kw, 2, 'increasing', false));
        const out = new Float64Array(x.size * n);
        work(x.size * n);
        for (let i = 0; i < x.size; i++) for (let j = 0; j < n; j++) out[i * n + j] = x.data[i] ** (up ? j : n - 1 - j);
        return new NDArray([x.size, n], out, 'float');
    }));
    m.set('bincount', fn('bincount', (a, kw) => {
        const x = toArray(a[0] ?? null);
        const wv = arg(a, kw, 1, 'weights', null);
        const w = wv === null ? null : toArray(wv);
        let top = Math.max(0, intArg(arg(a, kw, 2, 'minlength', 0)));
        for (const v of x.data) {
            if (!(v >= 0) || !Number.isInteger(v)) throw valueError('ml.numpy.bincount');
            top = Math.max(top, v + 1);
        }
        const counts = new Float64Array(top);
        x.data.forEach((v, i) => (counts[v] += w ? w.data[i] : 1));
        return new NDArray([top], counts, w ? 'float' : 'int');
    }));

    la.set('svd', fn('svd', (a, kw) => {
        const { m: rows, n, a: d } = matrix(a[0] ?? null, 'svd');
        const r = svd(rows, n, d);
        if (!truthy(arg(a, kw, 2, 'compute_uv', true))) return fromNumbers(r.s);
        const full = truthy(arg(a, kw, 1, 'full_matrices', true));
        const { k } = r;
        if (!full) return new PyTuple([new NDArray([rows, k], r.u, 'float'), fromNumbers(r.s), new NDArray([k, n], r.vt, 'float')]);
        const U = rows > k ? new NDArray([rows, rows], fullU(r.u, rows, k), 'float') : new NDArray([rows, k], r.u, 'float');
        let Vt = new NDArray([k, n], r.vt, 'float');
        if (n > k) {
            // The rows of Vt completed to an n x n basis (the columns of the full V).
            const v = new Float64Array(n * k);
            for (let c = 0; c < k; c++) for (let j = 0; j < n; j++) v[j * k + c] = r.vt[c * n + j];
            const V = fullU(v, n, k);
            const t = new Float64Array(n * n);
            for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) t[i * n + j] = V[j * n + i];
            Vt = new NDArray([n, n], t, 'float');
        }
        return new PyTuple([U, fromNumbers(r.s), Vt]);
    }));
    la.set('pinv', fn('pinv', (a, kw) => {
        const { m: rows, n, a: d } = matrix(a[0] ?? null, 'pinv');
        const rc = arg(a, kw, 1, 'rcond', null);
        return new NDArray([n, rows], pseudoInverse(svd(rows, n, d), rc === null ? 1e-15 : num(rc)), 'float');
    }));
    la.set('matrix_rank', fn('matrix_rank', (a, kw) => {
        const { m: rows, n, a: d } = matrix(a[0] ?? null, 'matrix_rank');
        const tol = arg(a, kw, 1, 'tol', null);
        return rankOf(svd(rows, n, d), tol === null ? null : num(tol));
    }));
    la.set('lstsq', fn('lstsq', (a, kw) => {
        const A = toArray(a[0] ?? null);
        if (A.ndim !== 2) throw valueError('ml.numpy.matrix', { name: 'lstsq' });
        const [rows, n] = A.shape;
        const B = toArray(a[1] ?? null);
        const oneColumn = B.ndim === 1;
        const cols = oneColumn ? 1 : B.shape[1];
        if (B.shape[0] !== rows) throw valueError('python.linalg.solveShapes');
        const rc = arg(a, kw, 2, 'rcond', null);
        const r = svd(rows, n, Float64Array.from(A.data));
        const rcond = rc === null ? Math.max(rows, n) * 2.220446049250313e-16 : num(rc) < 0 ? 2.220446049250313e-16 : num(rc);
        const P = pseudoInverse(r, rcond);
        const x = new Float64Array(n * cols);
        for (let j = 0; j < n; j++) for (let c = 0; c < cols; c++) {
            let s = 0;
            for (let i = 0; i < rows; i++) s += P[j * rows + i] * B.data[i * cols + c];
            x[j * cols + c] = s;
        }
        const rank = rankOf(r, (r.s[0] ?? 0) * rcond);
        // Sums of squared residuals per column, when the system has full rank and more rows than columns.
        let residuals: NDArray = newArray([0]);
        if (rank === n && rows > n) {
            const res = new Float64Array(cols);
            for (let c = 0; c < cols; c++) {
                for (let i = 0; i < rows; i++) {
                    let s = 0;
                    for (let j = 0; j < n; j++) s += A.data[i * n + j] * x[j * cols + c];
                    res[c] += (s - B.data[i * cols + c]) ** 2;
                }
            }
            residuals = fromNumbers(res);
        }
        const X = oneColumn ? fromNumbers(x) : new NDArray([n, cols], x, 'float');
        return new PyTuple([X, residuals, rank, fromNumbers(r.s)]);
    }));
}

/** np.random.multivariate_normal(mean, cov, size): mean + L z with L L^T = cov (Cholesky; a symmetric square root when cov is only semi-definite). */
export function mlRandom(rng: Rng, m: Map<string, PyValue>): void {
    m.set('multivariate_normal', fn('multivariate_normal', (a, kw) => {
        const mean = toArray(arg(a, kw, 0, 'mean', null));
        const n = mean.size;
        const C = matrix(arg(a, kw, 1, 'cov', null), 'multivariate_normal');
        if (C.m !== n || C.n !== n) throw valueError('ml.numpy.mvnShapes');
        const L = rootOf(n, C.a);
        const sizeV = arg(a, kw, 2, 'size', null);
        const shape = sizeV === null ? [] : isNum(sizeV) ? [intArg(sizeV)] : Array.from(toArray(sizeV).data, (d) => Math.trunc(d));
        const count = shape.reduce((p, d) => p * d, 1);
        const out = new Float64Array(count * n);
        const z = new Float64Array(n);
        work(count * n * n);
        for (let s = 0; s < count; s++) {
            for (let i = 0; i < n; i++) z[i] = rng.gauss();
            for (let i = 0; i < n; i++) {
                let v = mean.data[i];
                for (let j = 0; j < n; j++) v += L[i * n + j] * z[j];
                out[s * n + i] = v;
            }
        }
        return new NDArray([...shape, n], out, 'float');
    }));
}

/** L with L L^T = C: Cholesky, else (not positive definite) U sqrt(S) from the SVD of the symmetric C. */
function rootOf(n: number, c: Float64Array): Float64Array {
    const L = new Float64Array(n * n);
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
        for (let j = 0; j <= i; j++) {
            let s = c[i * n + j];
            for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
            if (i === j) {
                if (!(s > 0)) {
                    ok = false;
                    break;
                }
                L[i * n + i] = Math.sqrt(s);
            } else L[i * n + j] = s / L[j * n + j];
        }
    }
    if (ok) return L;
    const r = svd(n, n, c);
    const out = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) out[i * n + k] = r.u[i * n + k] * Math.sqrt(Math.max(0, r.s[k]));
    return out;
}
