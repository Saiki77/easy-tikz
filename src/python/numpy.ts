/*
 * 6.0 P: the NumPy subset of chart scripts (the 6.0 plan): making
 * arrays, element-wise functions (real and complex), reductions, shapes,
 * products, np.linalg (det, inv, solve, eig, eigh, norm), np.fft (fft,
 * ifft, fftfreq, fftshift: radix 2 and Bluestein for other lengths) and
 * np.random (seeded: every run starts from seed 0). Pure: no DOM, no
 * Obsidian.
 */
import { PyError, typeError, valueError } from './errors';
import { arg, callValue, intArg } from './ops';
import { ABS, Rng, num } from './builtins';
import { work } from './budget';
import {
    ARRAY_METHODS,
    alongAxis,
    arrayBinop,
    astype,
    axisArg,
    broadcastIndex,
    broadcastShape,
    checkCount,
    copyArray,
    dtypeOf,
    fromComplex,
    fromNumbers,
    itemAt,
    mapArray,
    matmul,
    newArray,
    reduce,
    reshape,
    scalarOf,
    shapeArg,
    sizeOf,
    sumOf,
    toArray,
    toList,
    transpose,
} from './ndarray';
import { DType, Kwargs, NDArray, PyBuiltin, PyComplex, PyModule, PyTuple, PyValue, isNum, iterate, truthy } from './values';
import { keepDims, mlNumpy, mlRandom } from './ml'; // 6.0 ML

const fn = (name: string, f: (args: PyValue[], kw: Kwargs | null) => PyValue) => new PyBuiltin(name, f);

/** An array input, or a scalar kept as a scalar (so np.sin(1.0) is a number). */
type In = { arr: NDArray; scalar: boolean };

function input(v: PyValue): In {
    if (v instanceof NDArray) return { arr: v, scalar: false };
    if (isNum(v) || v instanceof PyComplex) return { arr: toArray(v), scalar: true };
    return { arr: toArray(v), scalar: false };
}

function out(a: NDArray, scalar: boolean): PyValue {
    return scalar || a.ndim === 0 ? scalarOf(a) : a;
}

// ------------------------------------------------------------ element-wise

type C = (re: number, im: number, o: Float64Array) => void;

function ufunc(name: string, real: (x: number) => number, cplx: C | null, opts: { dtype?: DType; realOut?: boolean; intKeep?: boolean } = {}): PyBuiltin {
    return fn(name, (args) => {
        const { arr, scalar } = input(args[0] ?? null);
        work(arr.size);
        const dtype = opts.intKeep && (arr.dtype === 'int' || arr.dtype === 'bool') ? 'int' : (opts.dtype ?? 'float');
        return out(mapArray(arr, real, cplx, dtype, !opts.realOut), scalar);
    });
}

function binaryUfunc(name: string, f: (x: number, y: number) => number, dtype: DType = 'float'): PyBuiltin {
    return fn(name, (args) => binaryApply(args[0] ?? null, args[1] ?? null, f, dtype));
}

function binaryApply(av: PyValue, bv: PyValue, f: (x: number, y: number) => number, dtype: DType): PyValue {
    const a = input(av);
    const b = input(bv);
    if (a.arr.dtype === 'complex' || b.arr.dtype === 'complex') throw typeError('python.numpy.noComplex');
    const shape = broadcastShape(a.arr.shape, b.arr.shape);
    const n = checkCount(sizeOf(shape));
    work(n);
    const ia = broadcastIndex(a.arr.shape, shape);
    const ib = broadcastIndex(b.arr.shape, shape);
    const o = new Float64Array(n);
    for (let i = 0; i < n; i++) o[i] = f(a.arr.data[ia ? ia[i] : i], b.arr.data[ib ? ib[i] : i]);
    const keep = dtype === 'int' && (a.arr.dtype === 'float' || b.arr.dtype === 'float') ? 'float' : dtype;
    return out(new NDArray(shape, o, keep), a.scalar && b.scalar);
}

const cexp: C = (re, im, o) => {
    const m = Math.exp(re);
    o[0] = m * Math.cos(im);
    o[1] = m * Math.sin(im);
};
const clog: C = (re, im, o) => {
    o[0] = Math.log(Math.hypot(re, im));
    o[1] = Math.atan2(im, re);
};
const csqrt: C = (re, im, o) => {
    const r = Math.hypot(re, im);
    o[0] = Math.sqrt((r + re) / 2);
    const s = Math.sqrt(Math.max(0, (r - re) / 2));
    o[1] = im < 0 ? -s : s;
};
const csin: C = (re, im, o) => {
    o[0] = Math.sin(re) * Math.cosh(im);
    o[1] = Math.cos(re) * Math.sinh(im);
};
const ccos: C = (re, im, o) => {
    o[0] = Math.cos(re) * Math.cosh(im);
    o[1] = -Math.sin(re) * Math.sinh(im);
};
const csinh: C = (re, im, o) => {
    o[0] = Math.sinh(re) * Math.cos(im);
    o[1] = Math.cosh(re) * Math.sin(im);
};
const ccosh: C = (re, im, o) => {
    o[0] = Math.cosh(re) * Math.cos(im);
    o[1] = Math.sinh(re) * Math.sin(im);
};
const tmp = new Float64Array(2);
const ctan: C = (re, im, o) => {
    csin(re, im, o);
    const sr = o[0];
    const si = o[1];
    ccos(re, im, tmp);
    const d = tmp[0] * tmp[0] + tmp[1] * tmp[1];
    o[0] = (sr * tmp[0] + si * tmp[1]) / d;
    o[1] = (si * tmp[0] - sr * tmp[1]) / d;
};

function roundTo(x: number, d: number): number {
    const m = 10 ** d;
    const y = x * m;
    const r = Math.round(y);
    return (Math.abs(y % 1) === 0.5 ? 2 * Math.round(y / 2) : r) / m;
}

// ------------------------------------------------------------ reductions

function reducer(name: string, f: (re: Float64Array, im: Float64Array | null) => number | [number, number], dtype: (a: NDArray) => DType, empty?: () => never): PyBuiltin {
    return fn(name, (args, kw) => {
        const a = toArray(args[0] ?? null);
        const axis = axisArg(a, arg(args, kw, 1, 'axis', null) ?? undefined);
        if (empty && a.size === 0) empty();
        work(a.size);
        return keepDims(reduce(a, axis, f, dtype(a)), a, axis, kw); // 6.0 ML: keepdims
    });
}

function mean(re: Float64Array, im: Float64Array | null): number | [number, number] {
    const s = sumOf(re, im);
    const n = re.length;
    return Array.isArray(s) ? [s[0] / n, s[1] / n] : s / n;
}

function variance(re: Float64Array, ddof: number): number {
    const n = re.length;
    let m = 0;
    for (let i = 0; i < n; i++) m += re[i];
    m /= n;
    let s = 0;
    for (let i = 0; i < n; i++) s += (re[i] - m) ** 2;
    return s / (n - ddof);
}

function argBest(re: Float64Array, less: boolean): number {
    let best = 0;
    for (let i = 1; i < re.length; i++) {
        if (Number.isNaN(re[best])) return best;
        if (Number.isNaN(re[i]) || (less ? re[i] < re[best] : re[i] > re[best])) best = i;
    }
    return best;
}

function extreme(re: Float64Array, less: boolean): number {
    if (!re.length) throw valueError('python.numpy.emptyReduce');
    let b = re[0];
    for (let i = 1; i < re.length; i++) {
        const x = re[i];
        if (Number.isNaN(x)) return NaN;
        if (less ? x < b : x > b) b = x;
    }
    return b;
}

const keepType = (a: NDArray): DType => (a.dtype === 'bool' ? 'int' : a.dtype);

// ------------------------------------------------------------ FFT

function isPow2(n: number): boolean {
    return n > 0 && (n & (n - 1)) === 0;
}

/** In-place radix-2 FFT (n a power of 2); `sign` -1 forward, +1 inverse (no scaling). */
function fft2(re: Float64Array, im: Float64Array, sign: number): void {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            let t = re[i];
            re[i] = re[j];
            re[j] = t;
            t = im[i];
            im[i] = im[j];
            im[j] = t;
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (sign * 2 * Math.PI) / len;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        const half = len >> 1;
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            for (let k = 0; k < half; k++) {
                const a = i + k;
                const b = a + half;
                const xr = re[b] * cr - im[b] * ci;
                const xi = re[b] * ci + im[b] * cr;
                re[b] = re[a] - xr;
                im[b] = im[a] - xi;
                re[a] += xr;
                im[a] += xi;
                const t = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = t;
            }
        }
    }
}

/** The DFT of any length: radix 2, or Bluestein's chirp through a power of 2. */
export function dft(reIn: Float64Array, imIn: Float64Array, inverse: boolean): [Float64Array, Float64Array] {
    const n = reIn.length;
    const sign = inverse ? 1 : -1;
    const re = reIn.slice();
    const im = imIn.slice();
    if (n <= 1) return [re, im];
    if (isPow2(n)) {
        fft2(re, im, sign);
        return [re, im];
    }
    let m = 1;
    while (m < 2 * n - 1) m <<= 1;
    const wr = new Float64Array(n);
    const wi = new Float64Array(n);
    for (let k = 0; k < n; k++) {
        // k^2 mod 2n keeps the angle exact for large k.
        const a = (Math.PI * ((k * k) % (2 * n))) / n;
        wr[k] = Math.cos(a);
        wi[k] = sign * Math.sin(a);
    }
    const ar = new Float64Array(m);
    const ai = new Float64Array(m);
    for (let k = 0; k < n; k++) {
        ar[k] = re[k] * wr[k] - im[k] * wi[k];
        ai[k] = re[k] * wi[k] + im[k] * wr[k];
    }
    const br = new Float64Array(m);
    const bi = new Float64Array(m);
    br[0] = wr[0];
    bi[0] = -wi[0];
    for (let k = 1; k < n; k++) {
        br[k] = br[m - k] = wr[k];
        bi[k] = bi[m - k] = -wi[k];
    }
    fft2(ar, ai, -1);
    fft2(br, bi, -1);
    for (let k = 0; k < m; k++) {
        const r = ar[k] * br[k] - ai[k] * bi[k];
        ai[k] = ar[k] * bi[k] + ai[k] * br[k];
        ar[k] = r;
    }
    fft2(ar, ai, 1);
    for (let k = 0; k < n; k++) {
        const xr = ar[k] / m;
        const xi = ai[k] / m;
        re[k] = xr * wr[k] - xi * wi[k];
        im[k] = xr * wi[k] + xi * wr[k];
    }
    return [re, im];
}

function fftCall(args: PyValue[], kw: Kwargs | null, inverse: boolean): NDArray {
    const a = toArray(args[0] ?? null);
    const nArg = arg(args, kw, 1, 'n', null);
    const axis = axisArg(a, arg(args, kw, 2, 'axis', -1)) ?? a.ndim - 1;
    work(a.size * 8);
    const len = a.ndim ? a.shape[axis] : 1;
    const n = nArg === null ? len : intArg(nArg);
    if (n < 1) throw valueError('python.numpy.fftSize');
    const norm = arg(args, kw, 3, 'norm', null);
    const scale = norm === 'ortho' ? 1 / Math.sqrt(n) : inverse ? (norm === 'forward' ? 1 : 1 / n) : norm === 'forward' ? 1 / n : 1;
    const src = a.ndim ? a : reshape(a, [1]);
    const shape = src.shape.slice();
    shape[axis] = n;
    const resized = newArray(shape, 'complex');
    // Copy along the axis with padding or cutting.
    const inner = sizeOf(src.shape.slice(axis + 1));
    const outer = sizeOf(src.shape.slice(0, axis));
    const lineRe = new Float64Array(n);
    const lineIm = new Float64Array(n);
    for (let o = 0; o < outer; o++) {
        for (let i = 0; i < inner; i++) {
            lineRe.fill(0);
            lineIm.fill(0);
            for (let k = 0; k < Math.min(n, len); k++) {
                const off = (o * len + k) * inner + i;
                lineRe[k] = src.data[off];
                lineIm[k] = src.imag ? src.imag[off] : 0;
            }
            const [r, m] = dft(lineRe, lineIm, inverse);
            for (let k = 0; k < n; k++) {
                const off = (o * n + k) * inner + i;
                resized.data[off] = r[k] * scale;
                if (resized.imag) resized.imag[off] = m[k] * scale;
            }
        }
    }
    return resized;
}

function fftfreq(n: number, d: number): NDArray {
    const out = new Float64Array(n);
    const half = Math.floor((n - 1) / 2) + 1;
    for (let i = 0; i < n; i++) out[i] = (i < half ? i : i - n) / (n * d);
    return fromNumbers(out);
}

function shiftBy(a: NDArray, by: (n: number) => number): NDArray {
    if (a.ndim !== 1) {
        return alongAxis(a, a.ndim - 1, (re, im, or, oi) => {
            const n = re.length;
            const s = by(n);
            for (let i = 0; i < n; i++) {
                or[(i + s) % n] = re[i];
                if (oi && im) oi[(i + s) % n] = im[i];
            }
        }, a.dtype);
    }
    const n = a.size;
    const s = by(n);
    const re = new Float64Array(n);
    const im = a.imag ? new Float64Array(n) : null;
    for (let i = 0; i < n; i++) {
        re[(i + s) % n] = a.data[i];
        if (im && a.imag) im[(i + s) % n] = a.imag[i];
    }
    return new NDArray([n], re, a.dtype, im);
}

// ------------------------------------------------------------ linear algebra

function square(v: PyValue, name: string): { n: number; a: Float64Array } {
    const m = toArray(v);
    if (m.ndim !== 2 || m.shape[0] !== m.shape[1]) throw new PyError('LinAlgError', 'python.linalg.square', { name });
    if (m.dtype === 'complex') throw typeError('python.numpy.noComplex');
    return { n: m.shape[0], a: m.data.slice() };
}

/** LU with partial pivoting in place; the sign of the row swaps (0 when singular). */
function lu(a: Float64Array, n: number, perm: Int32Array): number {
    let sign = 1;
    for (let i = 0; i < n; i++) perm[i] = i;
    for (let k = 0; k < n; k++) {
        let p = k;
        let best = Math.abs(a[k * n + k]);
        for (let i = k + 1; i < n; i++) {
            const v = Math.abs(a[i * n + k]);
            if (v > best) {
                best = v;
                p = i;
            }
        }
        if (best === 0) return 0;
        if (p !== k) {
            for (let j = 0; j < n; j++) {
                const t = a[k * n + j];
                a[k * n + j] = a[p * n + j];
                a[p * n + j] = t;
            }
            const t = perm[k];
            perm[k] = perm[p];
            perm[p] = t;
            sign = -sign;
        }
        for (let i = k + 1; i < n; i++) {
            const f = (a[i * n + k] /= a[k * n + k]);
            if (f === 0) continue;
            for (let j = k + 1; j < n; j++) a[i * n + j] -= f * a[k * n + j];
        }
    }
    return sign;
}

function luSolve(a: Float64Array, n: number, perm: Int32Array, b: Float64Array): Float64Array {
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let s = b[perm[i]];
        for (let j = 0; j < i; j++) s -= a[i * n + j] * x[j];
        x[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
        let s = x[i];
        for (let j = i + 1; j < n; j++) s -= a[i * n + j] * x[j];
        x[i] = s / a[i * n + i];
    }
    return x;
}

function det(v: PyValue): number {
    const { n, a } = square(v, 'det');
    const perm = new Int32Array(n);
    const sign = lu(a, n, perm);
    if (sign === 0) return 0;
    let d = sign;
    for (let i = 0; i < n; i++) d *= a[i * n + i];
    return d;
}

function inv(v: PyValue): NDArray {
    const { n, a } = square(v, 'inv');
    const perm = new Int32Array(n);
    if (lu(a, n, perm) === 0) throw new PyError('LinAlgError', 'python.linalg.singular');
    const out = new Float64Array(n * n);
    const e = new Float64Array(n);
    for (let j = 0; j < n; j++) {
        e.fill(0);
        e[j] = 1;
        const col = luSolve(a, n, perm, e);
        for (let i = 0; i < n; i++) out[i * n + j] = col[i];
    }
    return new NDArray([n, n], out, 'float');
}

function solve(av: PyValue, bv: PyValue): NDArray {
    const { n, a } = square(av, 'solve');
    const b = toArray(bv);
    if (b.shape[0] !== n) throw valueError('python.linalg.solveShapes');
    const perm = new Int32Array(n);
    if (lu(a, n, perm) === 0) throw new PyError('LinAlgError', 'python.linalg.singular');
    if (b.ndim === 1) return new NDArray([n], luSolve(a, n, perm, b.data), 'float');
    const k = b.shape[1];
    const out = new Float64Array(n * k);
    const col = new Float64Array(n);
    for (let j = 0; j < k; j++) {
        for (let i = 0; i < n; i++) col[i] = b.data[i * k + j];
        const x = luSolve(a, n, perm, col);
        for (let i = 0; i < n; i++) out[i * k + j] = x[i];
    }
    return new NDArray([n, k], out, 'float');
}

/** Eigenvalues and unit eigenvectors (columns) of a symmetric matrix, ascending (Jacobi). */
function eigSymmetric(n: number, a0: Float64Array): { values: Float64Array; vectors: Float64Array } {
    const a = a0.slice();
    const v = new Float64Array(n * n);
    for (let i = 0; i < n; i++) v[i * n + i] = 1;
    for (let sweep = 0; sweep < 100; sweep++) {
        let off = 0;
        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2;
        if (off < 1e-30) break;
        for (let p = 0; p < n; p++) {
            for (let q = p + 1; q < n; q++) {
                const apq = a[p * n + q];
                if (Math.abs(apq) < 1e-300) continue;
                const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
                const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
                const c = 1 / Math.sqrt(t * t + 1);
                const s = t * c;
                for (let k = 0; k < n; k++) {
                    const akp = a[k * n + p];
                    const akq = a[k * n + q];
                    a[k * n + p] = c * akp - s * akq;
                    a[k * n + q] = s * akp + c * akq;
                }
                for (let k = 0; k < n; k++) {
                    const apk = a[p * n + k];
                    const aqk = a[q * n + k];
                    a[p * n + k] = c * apk - s * aqk;
                    a[q * n + k] = s * apk + c * aqk;
                }
                for (let k = 0; k < n; k++) {
                    const vkp = v[k * n + p];
                    const vkq = v[k * n + q];
                    v[k * n + p] = c * vkp - s * vkq;
                    v[k * n + q] = s * vkp + c * vkq;
                }
            }
        }
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i * n + i] - a[j * n + j]);
    const values = Float64Array.from(order, (i) => a[i * n + i]);
    const vectors = new Float64Array(n * n);
    order.forEach((src, col) => {
        for (let k = 0; k < n; k++) vectors[k * n + col] = v[k * n + src];
    });
    return { values, vectors };
}

/** Eigenvalues of a general real matrix: complex shifted QR (Schur form). */
function eigGeneral(n: number, a: Float64Array): { re: Float64Array; im: Float64Array } {
    const hr = Float64Array.from(a);
    const hi = new Float64Array(n * n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    let m = n - 1;
    let iter = 0;
    const qr = new Float64Array(n * n);
    const qi = new Float64Array(n * n);
    while (m >= 0) {
        if (m === 0) {
            re[0] = hr[0];
            im[0] = hi[0];
            break;
        }
        // Converged when row m below the diagonal is small.
        let small = true;
        const scale = Math.hypot(hr[m * n + m], hi[m * n + m]) + Math.hypot(hr[(m - 1) * n + m - 1], hi[(m - 1) * n + m - 1]) || 1;
        for (let j = 0; j < m; j++) if (Math.hypot(hr[m * n + j], hi[m * n + j]) > 1e-14 * scale) small = false;
        if (small || iter > 400) {
            re[m] = hr[m * n + m];
            im[m] = hi[m * n + m];
            m--;
            iter = 0;
            continue;
        }
        iter++;
        // Wilkinson shift from the trailing 2 x 2 of the active part.
        const ar = hr[(m - 1) * n + m - 1], ai = hi[(m - 1) * n + m - 1];
        const br = hr[(m - 1) * n + m], bi = hi[(m - 1) * n + m];
        const cr = hr[m * n + m - 1], ci = hi[m * n + m - 1];
        const dr = hr[m * n + m], di = hi[m * n + m];
        const tr = (ar + dr) / 2, ti = (ai + di) / 2;
        // disc = ((a - d)/2)^2 + bc
        const hr2 = (ar - dr) / 2, hi2 = (ai - di) / 2;
        const qre = hr2 * hr2 - hi2 * hi2 + (br * cr - bi * ci);
        const qim = 2 * hr2 * hi2 + (br * ci + bi * cr);
        const rr = Math.hypot(qre, qim);
        let sr = Math.sqrt((rr + qre) / 2);
        let si = Math.sqrt(Math.max(0, (rr - qre) / 2)) * (qim < 0 ? -1 : 1);
        // The root nearer d.
        const e1 = Math.hypot(tr + sr - dr, ti + si - di);
        const e2 = Math.hypot(tr - sr - dr, ti - si - di);
        if (e2 < e1) {
            sr = -sr;
            si = -si;
        }
        let mur = tr + sr;
        let mui = ti + si;
        if (iter % 11 === 10) {
            mur += Math.abs(cr) + 0.5;
            mui += 0.25;
        }
        const k = m + 1;
        // QR of (H - mu I) on the active k x k part by modified Gram-Schmidt.
        for (let i = 0; i < k; i++) {
            hr[i * n + i] -= mur;
            hi[i * n + i] -= mui;
        }
        const rR = new Float64Array(k * k);
        const rI = new Float64Array(k * k);
        for (let j = 0; j < k; j++) {
            for (let i = 0; i < k; i++) {
                qr[i * n + j] = hr[i * n + j];
                qi[i * n + j] = hi[i * n + j];
            }
            for (let p = 0; p < j; p++) {
                let dR = 0;
                let dI = 0;
                for (let i = 0; i < k; i++) {
                    // conj(q_p) . v_j
                    dR += qr[i * n + p] * qr[i * n + j] + qi[i * n + p] * qi[i * n + j];
                    dI += qr[i * n + p] * qi[i * n + j] - qi[i * n + p] * qr[i * n + j];
                }
                rR[p * k + j] = dR;
                rI[p * k + j] = dI;
                for (let i = 0; i < k; i++) {
                    qr[i * n + j] -= dR * qr[i * n + p] - dI * qi[i * n + p];
                    qi[i * n + j] -= dR * qi[i * n + p] + dI * qr[i * n + p];
                }
            }
            let norm = 0;
            for (let i = 0; i < k; i++) norm += qr[i * n + j] ** 2 + qi[i * n + j] ** 2;
            norm = Math.sqrt(norm);
            rR[j * k + j] = norm;
            rI[j * k + j] = 0;
            for (let i = 0; i < k; i++) {
                qr[i * n + j] = norm ? qr[i * n + j] / norm : i === j ? 1 : 0;
                qi[i * n + j] = norm ? qi[i * n + j] / norm : 0;
            }
        }
        // H = R Q + mu I.
        for (let i = 0; i < k; i++) {
            for (let j = 0; j < k; j++) {
                let sR = 0;
                let sI = 0;
                for (let p = i; p < k; p++) {
                    sR += rR[i * k + p] * qr[p * n + j] - rI[i * k + p] * qi[p * n + j];
                    sI += rR[i * k + p] * qi[p * n + j] + rI[i * k + p] * qr[p * n + j];
                }
                hr[i * n + j] = sR + (i === j ? mur : 0);
                hi[i * n + j] = sI + (i === j ? mui : 0);
            }
        }
    }
    // Real matrices: tiny imaginary parts are rounding.
    const scale = Math.max(1, ...Array.from(a, Math.abs));
    for (let i = 0; i < n; i++) if (Math.abs(im[i]) < 1e-10 * scale) im[i] = 0;
    return { re, im };
}

/** A unit vector of the null space of (A - lambda I), complex, by elimination. */
function nullVector(n: number, a: Float64Array, lr: number, li: number): { re: Float64Array; im: Float64Array } {
    const mr = Float64Array.from(a);
    const mi = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
        mr[i * n + i] -= lr;
        mi[i * n + i] -= li;
    }
    const pivots: number[] = [];
    let row = 0;
    const scale = Math.max(1, ...Array.from(a, Math.abs));
    for (let col = 0; col < n && row < n; col++) {
        let p = -1;
        let best = 1e-9 * scale;
        for (let i = row; i < n; i++) {
            const v = Math.hypot(mr[i * n + col], mi[i * n + col]);
            if (v > best) {
                best = v;
                p = i;
            }
        }
        if (p < 0) continue;
        for (let j = 0; j < n; j++) {
            [mr[row * n + j], mr[p * n + j]] = [mr[p * n + j], mr[row * n + j]];
            [mi[row * n + j], mi[p * n + j]] = [mi[p * n + j], mi[row * n + j]];
        }
        const pr = mr[row * n + col];
        const pi = mi[row * n + col];
        const d = pr * pr + pi * pi;
        for (let j = 0; j < n; j++) {
            const xr = mr[row * n + j];
            const xi = mi[row * n + j];
            mr[row * n + j] = (xr * pr + xi * pi) / d;
            mi[row * n + j] = (xi * pr - xr * pi) / d;
        }
        for (let i = 0; i < n; i++) {
            if (i === row) continue;
            const fr = mr[i * n + col];
            const fi = mi[i * n + col];
            if (fr === 0 && fi === 0) continue;
            for (let j = 0; j < n; j++) {
                mr[i * n + j] -= fr * mr[row * n + j] - fi * mi[row * n + j];
                mi[i * n + j] -= fr * mi[row * n + j] + fi * mr[row * n + j];
            }
        }
        pivots.push(col);
        row++;
    }
    const free = Array.from({ length: n }, (_, i) => i).find((c) => !pivots.includes(c)) ?? n - 1;
    const vr = new Float64Array(n);
    const vi = new Float64Array(n);
    vr[free] = 1;
    pivots.forEach((col, r) => {
        vr[col] = -mr[r * n + free];
        vi[col] = -mi[r * n + free];
    });
    let norm = 0;
    for (let i = 0; i < n; i++) norm += vr[i] ** 2 + vi[i] ** 2;
    norm = Math.sqrt(norm) || 1;
    // NumPy's vectors have no fixed phase; make the largest entry real and positive.
    let big = 0;
    for (let i = 1; i < n; i++) if (Math.hypot(vr[i], vi[i]) > Math.hypot(vr[big], vi[big]) + 1e-12) big = i;
    const br = vr[big];
    const bi = vi[big];
    const bm = Math.hypot(br, bi) || 1;
    const cr = br / bm;
    const ci = -bi / bm;
    for (let i = 0; i < n; i++) {
        const x = vr[i];
        const y = vi[i];
        vr[i] = (x * cr - y * ci) / norm;
        vi[i] = (x * ci + y * cr) / norm;
    }
    return { re: vr, im: vi };
}

function isSymmetric(n: number, a: Float64Array): boolean {
    const scale = Math.max(1, ...Array.from(a, Math.abs));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(a[i * n + j] - a[j * n + i]) > 1e-12 * scale) return false;
    return true;
}

function eig(v: PyValue, vectors: boolean): PyValue {
    const { n, a } = square(v, 'eig');
    work(n * n * n * 50);
    if (n > 60) throw new PyError('LinAlgError', 'python.linalg.tooBig', { n: 60 });
    if (isSymmetric(n, a)) {
        const s = eigSymmetric(n, a);
        const vals = fromNumbers(s.values);
        return vectors ? new PyTuple([vals, new NDArray([n, n], s.vectors, 'float')]) : vals;
    }
    const { re, im } = eigGeneral(n, a);
    const complex = im.some((x) => x !== 0);
    const vals = complex ? fromComplex(re, im) : fromNumbers(re);
    if (!vectors) return vals;
    const vr = new Float64Array(n * n);
    const vi = new Float64Array(n * n);
    for (let k = 0; k < n; k++) {
        const nv = nullVector(n, a, re[k], im[k]);
        for (let i = 0; i < n; i++) {
            vr[i * n + k] = nv.re[i];
            vi[i * n + k] = nv.im[i];
        }
    }
    const vecs = complex ? new NDArray([n, n], vr, 'complex', vi) : new NDArray([n, n], vr, 'float');
    return new PyTuple([vals, vecs]);
}

function norm(args: PyValue[], kw: Kwargs | null): PyValue {
    const a = toArray(args[0] ?? null);
    const ord = arg(args, kw, 1, 'ord', null);
    const axis = axisArg(a, arg(args, kw, 2, 'axis', null) ?? undefined);
    const lineNorm = (re: Float64Array, im: Float64Array | null): number => {
        const absAt = (i: number) => (im ? Math.hypot(re[i], im[i]) : Math.abs(re[i]));
        if (ord === null || ord === 2 || ord === 'fro') {
            let s = 0;
            for (let i = 0; i < re.length; i++) s += absAt(i) ** 2;
            return Math.sqrt(s);
        }
        if (ord === Infinity) return Math.max(...Array.from(re, (_, i) => absAt(i)));
        if (ord === -Infinity) return Math.min(...Array.from(re, (_, i) => absAt(i)));
        const p = num(ord);
        if (p === 0) return Array.from(re, (_, i) => absAt(i)).filter((x) => x !== 0).length;
        let s = 0;
        for (let i = 0; i < re.length; i++) s += absAt(i) ** p;
        return s ** (1 / p);
    };
    if (axis === null && a.ndim === 2 && ord !== null && ord !== 'fro') {
        // Matrix norms: 1 (largest column sum), inf (largest row sum), 2 (largest singular value).
        const [r, c] = a.shape;
        if (ord === 1 || ord === Infinity) {
            const sums: number[] = [];
            if (ord === 1) for (let j = 0; j < c; j++) sums.push(Array.from({ length: r }, (_, i) => Math.abs(a.data[i * c + j])).reduce((x, y) => x + y, 0));
            else for (let i = 0; i < r; i++) sums.push(Array.from({ length: c }, (_, j) => Math.abs(a.data[i * c + j])).reduce((x, y) => x + y, 0));
            return Math.max(...sums);
        }
        if (ord === 2) {
            const ata = matmul(transpose(a), a);
            const m = ata instanceof NDArray ? ata : toArray(ata);
            const s = eigSymmetric(c, m.data);
            return Math.sqrt(Math.max(0, ...Array.from(s.values)));
        }
    }
    return reduce(a, axis, lineNorm, 'float');
}

// ------------------------------------------------------------ shapes and joins

function concatenate(items: PyValue[], axis: number): NDArray {
    const arrs = items.map((x) => toArray(x));
    if (!arrs.length) throw valueError('python.numpy.concatEmpty');
    const nd = arrs[0].ndim;
    if (nd === 0) throw valueError('python.numpy.concatScalar');
    const ax = axis < 0 ? axis + nd : axis;
    for (const a of arrs) {
        if (a.ndim !== nd || a.shape.some((d, i) => i !== ax && d !== arrs[0].shape[i])) throw valueError('python.numpy.concatShapes');
    }
    const shape = arrs[0].shape.slice();
    shape[ax] = arrs.reduce((s, a) => s + a.shape[ax], 0);
    const dtype = arrs.map((a) => a.dtype).reduce((x, y) => (x === 'complex' || y === 'complex' ? 'complex' : x === 'float' || y === 'float' ? 'float' : x === 'int' || y === 'int' ? 'int' : 'bool'));
    const out = newArray(shape, dtype);
    const outer = sizeOf(shape.slice(0, ax));
    const inner = sizeOf(shape.slice(ax + 1));
    let at = 0;
    for (let o = 0; o < outer; o++) {
        for (const a of arrs) {
            const block = a.shape[ax] * inner;
            for (let k = 0; k < block; k++) {
                out.data[at] = a.data[o * block + k];
                if (out.imag && a.imag) out.imag[at] = a.imag[o * block + k];
                at++;
            }
        }
    }
    return out;
}

function stack(items: PyValue[], axis: number): NDArray {
    const arrs = items.map((x) => toArray(x));
    if (!arrs.length) throw valueError('python.numpy.concatEmpty');
    const nd = arrs[0].ndim;
    const ax = axis < 0 ? axis + nd + 1 : axis;
    const expanded = arrs.map((a) => {
        const s = a.shape.slice();
        s.splice(ax, 0, 1);
        return reshape(a, s);
    });
    return concatenate(expanded, ax);
}

function atLeast2D(a: NDArray): NDArray {
    return a.ndim >= 2 ? a : reshape(a, [1, a.size]);
}

// ------------------------------------------------------------ random

function sizeArg(v: PyValue): number[] | null {
    if (v === null || v === undefined) return null;
    return shapeArg(v);
}

function sample(shape: number[] | null, draw: () => number, dtype: DType = 'float'): PyValue {
    if (!shape) return draw();
    const n = checkCount(sizeOf(shape));
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = draw();
    return new NDArray(shape, out, dtype);
}

function randomFunctions(rng: Rng, m: Map<string, PyValue>, generator: boolean): void {
    const set = (name: string, f: (args: PyValue[], kw: Kwargs | null) => PyValue) => m.set(name, fn(name, f));
    set('seed', (a) => {
        rng.seed(a.length && a[0] !== null ? num(a[0]) : 0);
        return null;
    });
    set('rand', (a) => sample(a.length ? a.map(intArg) : null, () => rng.next()));
    set('randn', (a) => sample(a.length ? a.map(intArg) : null, () => rng.gauss()));
    set('random', (a, kw) => sample(sizeArg(arg(a, kw, 0, 'size', null)), () => rng.next()));
    set('random_sample', (a, kw) => sample(sizeArg(arg(a, kw, 0, 'size', null)), () => rng.next()));
    set('standard_normal', (a, kw) => sample(sizeArg(arg(a, kw, 0, 'size', null)), () => rng.gauss()));
    set('uniform', (a, kw) => {
        const lo = arg(a, kw, 0, 'low', 0);
        const hi = arg(a, kw, 1, 'high', 1);
        const shape = sizeArg(arg(a, kw, 2, 'size', null));
        if (isNum(lo) && isNum(hi)) return sample(shape, () => Number(lo) + (Number(hi) - Number(lo)) * rng.next());
        const l = toArray(lo);
        const h = toArray(hi);
        return arrayBinop('+', l, arrayBinop('*', arrayBinop('-', h, l), sample(shape ?? broadcastShape(l.shape, h.shape), () => rng.next())));
    });
    set('normal', (a, kw) => {
        const loc = arg(a, kw, 0, 'loc', 0);
        const scale = arg(a, kw, 1, 'scale', 1);
        const shape = sizeArg(arg(a, kw, 2, 'size', null));
        if (isNum(loc) && isNum(scale)) return sample(shape, () => Number(loc) + Number(scale) * rng.gauss());
        const l = toArray(loc);
        const s = toArray(scale);
        return arrayBinop('+', l, arrayBinop('*', s, sample(shape ?? broadcastShape(l.shape, s.shape), () => rng.gauss())));
    });
    const integers = (a: PyValue[], kw: Kwargs | null) => {
        let lo = intArg(arg(a, kw, 0, 'low', 0));
        let hiV = arg(a, kw, 1, 'high', null);
        if (hiV === null) {
            hiV = lo;
            lo = 0;
        }
        const hi = intArg(hiV);
        if (hi <= lo) throw valueError('python.numpy.randintRange');
        return sample(sizeArg(arg(a, kw, 2, 'size', null)), () => rng.int(lo, hi), 'int');
    };
    set(generator ? 'integers' : 'randint', integers);
    mlRandom(rng, m); // 6.0 ML: multivariate_normal
    set('choice', (a, kw) => {
        const src = a[0] ?? null;
        const items: PyValue[] = isNum(src) ? Array.from({ length: intArg(src) }, (_, i) => i) : iterate(src);
        const shape = sizeArg(arg(a, kw, 1, 'size', null));
        const replace = truthy(arg(a, kw, 2, 'replace', true));
        const pv = arg(a, kw, 3, 'p', null);
        const p = pv === null ? null : Array.from(toArray(pv).data);
        if (!items.length) throw valueError('python.numpy.choiceEmpty');
        const cum: number[] = [];
        if (p) {
            let s = 0;
            for (const x of p) cum.push((s += x));
        }
        const pick = (): number => {
            if (!p) return Math.floor(rng.next() * items.length);
            const u = rng.next() * cum[cum.length - 1];
            const i = cum.findIndex((c) => u < c);
            return i < 0 ? items.length - 1 : i;
        };
        if (!shape) return items[pick()];
        const n = sizeOf(shape);
        if (!replace && n > items.length) throw valueError('python.value.sampleSize');
        const chosen: PyValue[] = [];
        const left = items.slice();
        for (let i = 0; i < n; i++) {
            if (replace) chosen.push(items[pick()]);
            else {
                const j = Math.floor(rng.next() * left.length);
                chosen.push(left.splice(j, 1)[0]);
            }
        }
        return reshape(toArray(chosen), shape);
    });
    set('shuffle', (a) => {
        const x = a[0];
        if (Array.isArray(x)) {
            for (let i = x.length - 1; i > 0; i--) {
                const j = Math.floor(rng.next() * (i + 1));
                [x[i], x[j]] = [x[j], x[i]];
            }
        } else if (x instanceof NDArray && x.ndim === 1) {
            for (let i = x.size - 1; i > 0; i--) {
                const j = Math.floor(rng.next() * (i + 1));
                const t = x.data[i];
                x.data[i] = x.data[j];
                x.data[j] = t;
            }
        }
        return null;
    });
    set('permutation', (a) => {
        const x = a[0] ?? 0;
        const arr = isNum(x) ? fromNumbers(Array.from({ length: intArg(x) }, (_, i) => i), 'int') : copyArray(toArray(x));
        for (let i = arr.size - 1; i > 0; i--) {
            const j = Math.floor(rng.next() * (i + 1));
            const t = arr.data[i];
            arr.data[i] = arr.data[j];
            arr.data[j] = t;
        }
        return arr;
    });
    set('exponential', (a, kw) => {
        const scale = num(arg(a, kw, 0, 'scale', 1));
        return sample(sizeArg(arg(a, kw, 1, 'size', null)), () => -scale * Math.log(1 - rng.next()));
    });
    set('binomial', (a, kw) => {
        const n = intArg(arg(a, kw, 0, 'n', 1));
        const p = num(arg(a, kw, 1, 'p', 0.5));
        return sample(sizeArg(arg(a, kw, 2, 'size', null)), () => {
            let k = 0;
            for (let i = 0; i < n; i++) if (rng.next() < p) k++;
            return k;
        }, 'int');
    });
    set('poisson', (a, kw) => {
        const lam = num(arg(a, kw, 0, 'lam', 1));
        return sample(sizeArg(arg(a, kw, 1, 'size', null)), () => {
            const l = Math.exp(-lam);
            let k = 0;
            let p = 1;
            do {
                k++;
                p *= rng.next();
            } while (p > l && k < 10000);
            return k - 1;
        }, 'int');
    });
}

// ------------------------------------------------------------ the module

export interface NumpyModules {
    np: PyModule;
    linalg: PyModule;
    fft: PyModule;
    random: PyModule;
}

function dtypeFn(name: string, dtype: DType): PyBuiltin {
    return fn(name, (a) => {
        const v = a[0] ?? 0;
        if (v instanceof NDArray) return astype(v, dtype);
        const arr = toArray(v, dtype);
        return arr.ndim ? arr : scalarOf(arr);
    });
}

function sortLine(re: Float64Array, _im: Float64Array | null, or: Float64Array): void {
    const s = Array.from(re).sort((x, y) => (Number.isNaN(x) ? 1 : Number.isNaN(y) ? -1 : x - y));
    or.set(s);
}

function argsortLine(re: Float64Array, _im: Float64Array | null, or: Float64Array): void {
    const idx = Array.from(re, (_, i) => i).sort((i, j) => re[i] - re[j] || i - j);
    or.set(idx);
}

export function numpyModules(rng: Rng): NumpyModules {
    const m = new Map<string, PyValue>();
    const set = (name: string, f: (args: PyValue[], kw: Kwargs | null) => PyValue) => m.set(name, fn(name, f));
    m.set('pi', Math.PI);
    m.set('e', Math.E);
    m.set('inf', Infinity);
    m.set('Inf', Infinity);
    m.set('infty', Infinity);
    m.set('nan', NaN);
    m.set('NaN', NaN);
    m.set('newaxis', null);
    m.set('euler_gamma', 0.5772156649015329);
    for (const [name, d] of [
        ['float64', 'float'],
        ['float32', 'float'],
        ['float_', 'float'],
        ['double', 'float'],
        ['int64', 'int'],
        ['int32', 'int'],
        ['int_', 'int'],
        ['bool_', 'bool'],
        ['complex128', 'complex'],
        ['complex64', 'complex'],
        ['complex_', 'complex'],
    ] as const) m.set(name, dtypeFn(name, d));
    m.set('ndarray', fn('ndarray', () => {
        throw typeError('python.numpy.ndarrayCall');
    }));

    // Making arrays.
    set('array', (a, kw) => toArray(a[0] ?? null, dtypeOf(arg(a, kw, 1, 'dtype', null)), true));
    set('asarray', (a, kw) => toArray(a[0] ?? null, dtypeOf(arg(a, kw, 1, 'dtype', null))));
    set('copy', (a) => copyArray(toArray(a[0] ?? null)));
    set('linspace', (a, kw) => {
        const lo = num(arg(a, kw, 0, 'start', 0));
        const hi = num(arg(a, kw, 1, 'stop', 1));
        const n = intArg(arg(a, kw, 2, 'num', 50));
        const endpoint = truthy(arg(a, kw, 3, 'endpoint', true));
        checkCount(n);
        const out = new Float64Array(Math.max(0, n));
        const div = endpoint ? n - 1 : n;
        const step = div > 0 ? (hi - lo) / div : 0;
        for (let i = 0; i < n; i++) out[i] = lo + i * step;
        if (endpoint && n > 1) out[n - 1] = hi;
        const arr = fromNumbers(out);
        return truthy(arg(a, kw, 4, 'retstep', false)) ? new PyTuple([arr, step]) : arr;
    });
    set('logspace', (a, kw) => {
        const lo = num(arg(a, kw, 0, 'start', 0));
        const hi = num(arg(a, kw, 1, 'stop', 1));
        const n = intArg(arg(a, kw, 2, 'num', 50));
        const base = num(arg(a, kw, 4, 'base', 10));
        checkCount(n);
        const out = new Float64Array(n);
        for (let i = 0; i < n; i++) out[i] = base ** (n > 1 ? lo + ((hi - lo) * i) / (n - 1) : lo);
        return fromNumbers(out);
    });
    set('arange', (a, kw) => {
        let start = num(arg(a, kw, 0, 'start', 0));
        let stopV = arg(a, kw, 1, 'stop', null);
        const step = num(arg(a, kw, 2, 'step', 1));
        if (stopV === null) {
            stopV = start;
            start = 0;
        }
        const stop = num(stopV);
        if (step === 0) throw valueError('python.value.rangeStep');
        const n = checkCount(Math.max(0, Math.ceil((stop - start) / step)));
        const out = new Float64Array(n);
        for (let i = 0; i < n; i++) out[i] = start + i * step;
        const isInt = [a[0], a[1], a[2]].every((x) => x === undefined || x === null || (typeof x === 'number' && Number.isInteger(x)));
        const dt = dtypeOf(arg(a, kw, 3, 'dtype', null)) ?? (isInt ? 'int' : 'float');
        return fromNumbers(out, dt);
    });
    const filled = (name: string, value: (a: PyValue[], kw: Kwargs | null) => PyValue, like: boolean) =>
        set(name, (a, kw) => {
            const src = like ? toArray(a[0] ?? null) : null;
            const shape = src ? src.shape.slice() : shapeArg(arg(a, kw, 0, 'shape', 0));
            const v = value(a, kw);
            const dt = dtypeOf(arg(a, kw, like ? 2 : name === 'full' ? 2 : 1, 'dtype', null)) ?? (src ? src.dtype : v instanceof PyComplex ? 'complex' : typeof v === 'boolean' ? 'bool' : name === 'full' && typeof v === 'number' && Number.isInteger(v) ? 'int' : 'float');
            const out = newArray(shape, dt);
            const c = v instanceof PyComplex ? v : null;
            out.data.fill(c ? c.re : Number(v));
            if (out.imag && c) out.imag.fill(c.im);
            return out;
        });
    filled('zeros', () => 0, false);
    filled('ones', () => 1, false);
    filled('empty', () => 0, false);
    filled('full', (a, kw) => arg(a, kw, 1, 'fill_value', 0), false);
    filled('zeros_like', () => 0, true);
    filled('ones_like', () => 1, true);
    filled('empty_like', () => 0, true);
    filled('full_like', (a, kw) => arg(a, kw, 1, 'fill_value', 0), true);
    set('eye', (a, kw) => {
        const n = intArg(a[0] ?? 0);
        const cols = arg(a, kw, 1, 'M', null);
        const c = cols === null ? n : intArg(cols);
        const k = intArg(arg(a, kw, 2, 'k', 0));
        const out = newArray([n, c]);
        for (let i = 0; i < n; i++) if (i + k >= 0 && i + k < c) out.data[i * c + i + k] = 1;
        return out;
    });
    set('identity', (a) => {
        const n = intArg(a[0] ?? 0);
        const out = newArray([n, n]);
        for (let i = 0; i < n; i++) out.data[i * n + i] = 1;
        return out;
    });
    set('diag', (a) => {
        const v = toArray(a[0] ?? null);
        if (v.ndim === 1) {
            const n = v.size;
            const out = newArray([n, n], v.dtype);
            for (let i = 0; i < n; i++) out.data[i * n + i] = v.data[i];
            return out;
        }
        const n = Math.min(v.shape[0], v.shape[1]);
        return fromNumbers(Array.from({ length: n }, (_, i) => v.data[i * v.shape[1] + i]), v.dtype);
    });
    set('meshgrid', (a, kw) => {
        const xs = a.map((x) => toArray(x));
        const ij = arg(a, kw, -1, 'indexing', 'xy') === 'ij';
        if (xs.length !== 2) {
            if (xs.length === 1) return new PyTuple([copyArray(xs[0])]);
            throw valueError('python.numpy.meshgrid');
        }
        const [x, y] = xs;
        const nx = x.size;
        const ny = y.size;
        const shape = ij ? [nx, ny] : [ny, nx];
        const X = newArray(shape, x.dtype === 'int' ? 'int' : 'float');
        const Y = newArray(shape, y.dtype === 'int' ? 'int' : 'float');
        for (let i = 0; i < ny; i++) {
            for (let j = 0; j < nx; j++) {
                const at = ij ? j * ny + i : i * nx + j;
                X.data[at] = x.data[j];
                Y.data[at] = y.data[i];
            }
        }
        return new PyTuple([X, Y]);
    });

    // Element-wise.
    const u = (name: string, real: (x: number) => number, cplx: C | null, opts?: { dtype?: DType; realOut?: boolean; intKeep?: boolean }) => m.set(name, ufunc(name, real, cplx, opts));
    u('sin', Math.sin, csin);
    u('cos', Math.cos, ccos);
    u('tan', Math.tan, ctan);
    u('arcsin', Math.asin, null);
    u('arccos', Math.acos, null);
    u('arctan', Math.atan, null);
    u('sinh', Math.sinh, csinh);
    u('cosh', Math.cosh, ccosh);
    u('tanh', Math.tanh, null);
    u('arcsinh', Math.asinh, null);
    u('arccosh', Math.acosh, null);
    u('arctanh', Math.atanh, null);
    u('exp', Math.exp, cexp);
    u('expm1', Math.expm1, null);
    u('exp2', (x) => 2 ** x, null);
    u('log', Math.log, clog);
    u('log10', Math.log10, (re, im, o) => {
        clog(re, im, o);
        o[0] /= Math.LN10;
        o[1] /= Math.LN10;
    });
    u('log2', Math.log2, null);
    u('log1p', Math.log1p, null);
    u('sqrt', Math.sqrt, csqrt);
    u('cbrt', Math.cbrt, null);
    u('square', (x) => x * x, (re, im, o) => {
        o[0] = re * re - im * im;
        o[1] = 2 * re * im;
    }, { intKeep: true });
    const absFn = ufunc('abs', Math.abs, (re, im, o) => {
        o[0] = Math.hypot(re, im);
        o[1] = 0;
    }, { realOut: true, intKeep: true });
    m.set('abs', absFn);
    m.set('absolute', absFn);
    ABS.fn = (a) => callValue(absFn, [a]);
    u('angle', () => 0, (re, im, o) => {
        o[0] = Math.atan2(im, re);
        o[1] = 0;
    }, { realOut: true });
    // np.angle of a real number: 0 or pi.
    m.set('angle', fn('angle', (a, kw) => {
        const { arr, scalar } = input(a[0] ?? null);
        const deg = truthy(arg(a, kw, 1, 'deg', false));
        const k = deg ? 180 / Math.PI : 1;
        return out(mapArray(arr, (x) => (x < 0 ? Math.PI : 0) * k, (re, im, o) => {
            o[0] = Math.atan2(im, re) * k;
            o[1] = 0;
        }, 'float', false), scalar);
    }));
    m.set('real', fn('real', (a) => {
        const { arr, scalar } = input(a[0] ?? null);
        return out(new NDArray(arr.shape.slice(), arr.data.slice(), arr.dtype === 'complex' ? 'float' : arr.dtype), scalar);
    }));
    m.set('imag', fn('imag', (a) => {
        const { arr, scalar } = input(a[0] ?? null);
        return out(new NDArray(arr.shape.slice(), arr.imag ? arr.imag.slice() : new Float64Array(arr.size), arr.dtype === 'complex' ? 'float' : arr.dtype), scalar);
    }));
    const conj = fn('conj', (a) => {
        const { arr, scalar } = input(a[0] ?? null);
        if (arr.dtype !== 'complex') return out(copyArray(arr), scalar);
        return out(new NDArray(arr.shape.slice(), arr.data.slice(), 'complex', (arr.imag ?? new Float64Array(arr.size)).map((x) => -x)), scalar);
    });
    m.set('conj', conj);
    m.set('conjugate', conj);
    u('floor', Math.floor, null);
    u('ceil', Math.ceil, null);
    u('trunc', Math.trunc, null);
    u('rint', (x) => roundTo(x, 0), null);
    u('fix', Math.trunc, null);
    u('sign', (x) => (x > 0 ? 1 : x < 0 ? -1 : x), null, { intKeep: true });
    u('radians', (x) => (x * Math.PI) / 180, null);
    u('deg2rad', (x) => (x * Math.PI) / 180, null);
    u('degrees', (x) => (x * 180) / Math.PI, null);
    u('rad2deg', (x) => (x * 180) / Math.PI, null);
    m.set('isnan', ufunc('isnan', (x) => (Number.isNaN(x) ? 1 : 0), (re, im, o) => {
        o[0] = Number.isNaN(re) || Number.isNaN(im) ? 1 : 0;
        o[1] = 0;
    }, { dtype: 'bool', realOut: true }));
    m.set('isfinite', ufunc('isfinite', (x) => (Number.isFinite(x) ? 1 : 0), null, { dtype: 'bool' }));
    m.set('isinf', ufunc('isinf', (x) => (x === Infinity || x === -Infinity ? 1 : 0), null, { dtype: 'bool' }));
    u('sinc', (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)), null);
    set('round', (a, kw) => {
        const d = intArg(arg(a, kw, 1, 'decimals', 0));
        const { arr, scalar } = input(a[0] ?? null);
        return out(mapArray(arr, (x) => roundTo(x, d), (re, im, o) => {
            o[0] = roundTo(re, d);
            o[1] = roundTo(im, d);
        }, arr.dtype === 'int' ? 'int' : 'float'), scalar);
    });
    m.set('around', m.get('round') ?? null);
    set('clip', (a, kw) => {
        const lo = arg(a, kw, 1, 'a_min', null);
        const hi = arg(a, kw, 2, 'a_max', null);
        let v: PyValue = a[0] ?? null;
        if (lo !== null) v = binaryApply(v, lo, Math.max, 'int');
        if (hi !== null) v = binaryApply(v, hi, Math.min, 'int');
        const arr = toArray(a[0] ?? null);
        return v instanceof NDArray && arr.dtype === 'float' ? astype(v, 'float') : v;
    });
    m.set('arctan2', binaryUfunc('arctan2', Math.atan2));
    m.set('hypot', binaryUfunc('hypot', Math.hypot));
    m.set('maximum', binaryUfunc('maximum', (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.max(x, y)), 'int'));
    m.set('minimum', binaryUfunc('minimum', (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.min(x, y)), 'int'));
    m.set('fmax', binaryUfunc('fmax', (x, y) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.max(x, y)), 'int'));
    m.set('fmin', binaryUfunc('fmin', (x, y) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.min(x, y)), 'int'));
    m.set('mod', binaryUfunc('mod', (x, y) => {
        const r = x % y;
        return r !== 0 && r < 0 !== y < 0 ? r + y : r;
    }, 'int'));
    m.set('remainder', m.get('mod') ?? null);
    m.set('fmod', binaryUfunc('fmod', (x, y) => x % y, 'int'));
    m.set('heaviside', binaryUfunc('heaviside', (x, h) => (x < 0 ? 0 : x > 0 ? 1 : h)));
    set('power', (a) => arrayBinop('**', a[0] ?? null, a[1] ?? null));
    set('add', (a) => arrayBinop('+', a[0] ?? null, a[1] ?? null));
    set('subtract', (a) => arrayBinop('-', a[0] ?? null, a[1] ?? null));
    set('multiply', (a) => arrayBinop('*', a[0] ?? null, a[1] ?? null));
    set('divide', (a) => arrayBinop('/', a[0] ?? null, a[1] ?? null));
    set('where', (a) => {
        const cond = toArray(a[0] ?? null);
        if (a.length === 1) {
            const idx: number[] = [];
            for (let i = 0; i < cond.size; i++) if (cond.data[i]) idx.push(i);
            if (cond.ndim <= 1) return new PyTuple([fromNumbers(idx, 'int')]);
            const strides = cond.shape.map((_, k) => sizeOf(cond.shape.slice(k + 1)));
            return new PyTuple(cond.shape.map((d, k) => fromNumbers(idx.map((i) => Math.floor(i / strides[k]) % d), 'int')));
        }
        const x = toArray(a[1] ?? null);
        const y = toArray(a[2] ?? null);
        const shape = broadcastShape(broadcastShape(cond.shape, x.shape), y.shape);
        const n = checkCount(sizeOf(shape));
        const ic = broadcastIndex(cond.shape, shape);
        const ix = broadcastIndex(x.shape, shape);
        const iy = broadcastIndex(y.shape, shape);
        const complex = x.dtype === 'complex' || y.dtype === 'complex';
        const dt: DType = complex ? 'complex' : x.dtype === 'float' || y.dtype === 'float' ? 'float' : x.dtype === 'int' || y.dtype === 'int' ? 'int' : 'bool';
        const o = newArray(shape, dt);
        for (let i = 0; i < n; i++) {
            const pick = cond.data[ic ? ic[i] : i] !== 0;
            const src = pick ? x : y;
            const at = (pick ? ix : iy)?.[i] ?? i;
            o.data[i] = src.data[at];
            if (o.imag) o.imag[i] = src.imag ? src.imag[at] : 0;
        }
        return o;
    });
    set('nonzero', (a) => {
        const cond = toArray(a[0] ?? null);
        const idx: number[] = [];
        for (let i = 0; i < cond.size; i++) if (cond.data[i] || (cond.imag && cond.imag[i])) idx.push(i);
        return new PyTuple([fromNumbers(idx, 'int')]);
    });

    // Reductions.
    m.set('sum', reducer('sum', sumOf, keepType));
    m.set('prod', reducer('prod', (re, im) => {
        if (!im) return re.reduce((p, x) => p * x, 1);
        let pr = 1;
        let pi = 0;
        for (let i = 0; i < re.length; i++) [pr, pi] = [pr * re[i] - pi * im[i], pr * im[i] + pi * re[i]];
        return [pr, pi];
    }, keepType));
    m.set('mean', reducer('mean', mean, (a) => (a.dtype === 'complex' ? 'complex' : 'float')));
    m.set('average', fn('average', (a, kw) => {
        const w = arg(a, kw, 2, 'weights', null);
        const arr = toArray(a[0] ?? null);
        if (w === null) return reduce(arr, axisArg(arr, arg(a, kw, 1, 'axis', null) ?? undefined), mean, 'float');
        const wa = toArray(w);
        let s = 0;
        let t = 0;
        for (let i = 0; i < arr.size; i++) {
            s += arr.data[i] * wa.data[i];
            t += wa.data[i];
        }
        return s / t;
    }));
    const stat = (name: string, sq: boolean) =>
        m.set(name, fn(name, (a, kw) => {
            const arr = toArray(a[0] ?? null);
            const ddof = num(arg(a, kw, -1, 'ddof', 0));
            const axis = axisArg(arr, arg(a, kw, 1, 'axis', null) ?? undefined);
            return keepDims(reduce(arr, axis, (re) => (sq ? Math.sqrt(variance(re, ddof)) : variance(re, ddof)), 'float'), arr, axis, kw); // 6.0 ML: keepdims
        }));
    stat('std', true);
    stat('var', false);
    m.set('min', reducer('min', (re) => extreme(re, true), keepType));
    m.set('max', reducer('max', (re) => extreme(re, false), keepType));
    m.set('amin', m.get('min') ?? null);
    m.set('amax', m.get('max') ?? null);
    m.set('nanmin', reducer('nanmin', (re) => extreme(re.filter((x) => !Number.isNaN(x)), true), keepType));
    m.set('nanmax', reducer('nanmax', (re) => extreme(re.filter((x) => !Number.isNaN(x)), false), keepType));
    m.set('nansum', reducer('nansum', (re) => re.reduce((s, x) => (Number.isNaN(x) ? s : s + x), 0), keepType));
    m.set('nanmean', reducer('nanmean', (re) => {
        const f = re.filter((x) => !Number.isNaN(x));
        return f.reduce((s, x) => s + x, 0) / f.length;
    }, () => 'float'));
    m.set('median', reducer('median', (re) => {
        const s = Array.from(re).sort((x, y) => x - y);
        const n = s.length;
        return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    }, () => 'float'));
    m.set('ptp', reducer('ptp', (re) => extreme(re, false) - extreme(re, true), keepType));
    m.set('argmin', reducer('argmin', (re) => argBest(re, true), () => 'int'));
    m.set('argmax', reducer('argmax', (re) => argBest(re, false), () => 'int'));
    m.set('any', reducer('any', (re, im) => (re.some((x, i) => x !== 0 || (im ? im[i] !== 0 : false)) ? 1 : 0), () => 'bool'));
    m.set('all', reducer('all', (re, im) => (re.every((x, i) => x !== 0 || (im ? im[i] !== 0 : false)) ? 1 : 0), () => 'bool'));
    m.set('count_nonzero', reducer('count_nonzero', (re) => re.filter((x) => x !== 0).length, () => 'int'));
    const cumulative = (name: string, mul: boolean) =>
        m.set(name, fn(name, (a, kw) => {
            const arr = toArray(a[0] ?? null);
            const axis = axisArg(arr, arg(a, kw, 1, 'axis', null) ?? undefined);
            return alongAxis(arr, axis, (re, im, or, oi) => {
                let sr = mul ? 1 : 0;
                let si = 0;
                for (let i = 0; i < re.length; i++) {
                    if (mul) {
                        const xr = re[i];
                        const xi = im ? im[i] : 0;
                        [sr, si] = [sr * xr - si * xi, sr * xi + si * xr];
                    } else {
                        sr += re[i];
                        si += im ? im[i] : 0;
                    }
                    or[i] = sr;
                    if (oi) oi[i] = si;
                }
            }, keepType(arr));
        }));
    cumulative('cumsum', false);
    cumulative('cumprod', true);
    set('diff', (a, kw) => {
        let arr = toArray(a[0] ?? null);
        const n = intArg(arg(a, kw, 1, 'n', 1));
        const axisV = arg(a, kw, 2, 'axis', -1);
        for (let k = 0; k < n; k++) {
            const axis = axisArg(arr, axisV) ?? arr.ndim - 1;
            const len = arr.shape[axis];
            const shape = arr.shape.slice();
            shape[axis] = Math.max(0, len - 1);
            const o = newArray(shape, arr.dtype === 'bool' ? 'int' : arr.dtype);
            const inner = sizeOf(arr.shape.slice(axis + 1));
            const outer = sizeOf(arr.shape.slice(0, axis));
            for (let p = 0; p < outer; p++) {
                for (let j = 0; j + 1 < len; j++) {
                    for (let i = 0; i < inner; i++) {
                        const src = (p * len + j) * inner + i;
                        const dst = (p * (len - 1) + j) * inner + i;
                        o.data[dst] = arr.data[src + inner] - arr.data[src];
                        if (o.imag && arr.imag) o.imag[dst] = arr.imag[src + inner] - arr.imag[src];
                    }
                }
            }
            arr = o;
        }
        return arr;
    });
    set('sort', (a, kw) => {
        const arr = toArray(a[0] ?? null);
        return alongAxis(arr, axisArg(arr, arg(a, kw, 1, 'axis', -1)), sortLine, arr.dtype);
    });
    set('argsort', (a, kw) => {
        const arr = toArray(a[0] ?? null);
        return alongAxis(arr, axisArg(arr, arg(a, kw, 1, 'axis', -1)), argsortLine, 'int');
    });
    set('unique', (a) => {
        const arr = toArray(a[0] ?? null);
        const s = Array.from(new Set(Array.from(arr.data))).sort((x, y) => x - y);
        return fromNumbers(s, arr.dtype);
    });

    // Shapes.
    set('reshape', (a, kw) => reshape(toArray(a[0] ?? null), shapeArg(arg(a, kw, 1, 'newshape', arg(a, kw, 1, 'shape', null)))));
    set('transpose', (a, kw) => {
        const axes = arg(a, kw, 1, 'axes', null);
        return transpose(toArray(a[0] ?? null), axes === null ? undefined : shapeArg(axes));
    });
    set('ravel', (a) => {
        const arr = toArray(a[0] ?? null);
        return reshape(copyArray(arr), [arr.size]);
    });
    set('squeeze', (a) => {
        const arr = toArray(a[0] ?? null);
        return reshape(arr, arr.shape.filter((d) => d !== 1));
    });
    set('expand_dims', (a, kw) => {
        const arr = toArray(a[0] ?? null);
        let ax = intArg(arg(a, kw, 1, 'axis', 0));
        if (ax < 0) ax += arr.ndim + 1;
        const s = arr.shape.slice();
        s.splice(ax, 0, 1);
        return reshape(arr, s);
    });
    set('concatenate', (a, kw) => concatenate(iterate(a[0] ?? []), intArg(arg(a, kw, 1, 'axis', 0))));
    set('stack', (a, kw) => stack(iterate(a[0] ?? []), intArg(arg(a, kw, 1, 'axis', 0))));
    set('vstack', (a) => concatenate(iterate(a[0] ?? []).map((x) => atLeast2D(toArray(x))), 0));
    set('hstack', (a) => {
        const items = iterate(a[0] ?? []).map((x) => toArray(x));
        return concatenate(items, items[0] && items[0].ndim === 1 ? 0 : 1);
    });
    set('column_stack', (a) => concatenate(iterate(a[0] ?? []).map((x) => {
        const arr = toArray(x);
        return arr.ndim === 1 ? reshape(arr, [arr.size, 1]) : arr;
    }), 1));
    set('append', (a, kw) => {
        const axis = arg(a, kw, 2, 'axis', null);
        if (axis === null) {
            const x = toArray(a[0] ?? null);
            const y = toArray(a[1] ?? null);
            return concatenate([reshape(x, [x.size]), reshape(y, [y.size])], 0);
        }
        return concatenate([a[0] ?? null, a[1] ?? null], intArg(axis));
    });
    set('flip', (a, kw) => {
        const arr = toArray(a[0] ?? null);
        return alongAxis(arr, axisArg(arr, arg(a, kw, 1, 'axis', null) ?? undefined), (re, im, or, oi) => {
            const n = re.length;
            for (let i = 0; i < n; i++) {
                or[i] = re[n - 1 - i];
                if (oi && im) oi[i] = im[n - 1 - i];
            }
        }, arr.dtype);
    });
    set('roll', (a, kw) => {
        const arr = toArray(a[0] ?? null);
        const shift = intArg(arg(a, kw, 1, 'shift', 0));
        const axis = axisArg(arr, arg(a, kw, 2, 'axis', null) ?? undefined);
        const rolled = alongAxis(arr, axis, (re, im, or, oi) => {
            const n = re.length;
            for (let i = 0; i < n; i++) {
                const j = (((i + shift) % n) + n) % n;
                or[j] = re[i];
                if (oi && im) oi[j] = im[i];
            }
        }, arr.dtype);
        return axis === null ? reshape(rolled, arr.shape.slice()) : rolled;
    });
    set('tile', (a) => {
        const arr = toArray(a[0] ?? null);
        const reps = intArg(a[1] ?? 1);
        return concatenate(new Array<PyValue>(reps).fill(reshape(arr, [arr.size])), 0);
    });
    set('repeat', (a) => {
        const arr = toArray(a[0] ?? null);
        const reps = intArg(a[1] ?? 1);
        const outA = newArray([arr.size * reps], arr.dtype);
        for (let i = 0; i < arr.size; i++) for (let k = 0; k < reps; k++) {
            outA.data[i * reps + k] = arr.data[i];
            if (outA.imag && arr.imag) outA.imag[i * reps + k] = arr.imag[i];
        }
        return outA;
    });
    set('shape', (a) => new PyTuple(toArray(a[0] ?? null).shape.slice()));
    set('size', (a) => toArray(a[0] ?? null).size);
    set('ndim', (a) => toArray(a[0] ?? null).ndim);

    // Products.
    set('dot', (a) => {
        const x = toArray(a[0] ?? null);
        const y = toArray(a[1] ?? null);
        if (x.ndim === 0 || y.ndim === 0) return arrayBinop('*', x, y);
        return matmul(x, y);
    });
    set('matmul', (a) => matmul(toArray(a[0] ?? null), toArray(a[1] ?? null)));
    set('inner', (a) => matmul(toArray(a[0] ?? null), toArray(a[1] ?? null)));
    set('vdot', (a) => {
        const x = toArray(a[0] ?? null);
        const y = toArray(a[1] ?? null);
        let s = 0;
        for (let i = 0; i < x.size; i++) s += x.data[i] * y.data[i];
        return s;
    });
    set('outer', (a) => {
        const x = toArray(a[0] ?? null);
        const y = toArray(a[1] ?? null);
        return arrayBinop('*', reshape(x, [x.size, 1]), reshape(y, [1, y.size]));
    });
    set('cross', (a) => {
        const x = toArray(a[0] ?? null).data;
        const y = toArray(a[1] ?? null).data;
        if (x.length === 2 && y.length === 2) return x[0] * y[1] - x[1] * y[0];
        if (x.length !== 3 || y.length !== 3) throw valueError('python.numpy.cross');
        return fromNumbers([x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]);
    });
    set('trace', (a) => {
        const x = toArray(a[0] ?? null);
        let s = 0;
        for (let i = 0; i < Math.min(x.shape[0], x.shape[1] ?? 0); i++) s += x.data[i * x.shape[1] + i];
        return s;
    });

    // Numbers from curves.
    const trapz = fn('trapezoid', (a, kw) => {
        const y = toArray(a[0] ?? null).data;
        const xv = arg(a, kw, 1, 'x', null);
        const dx = num(arg(a, kw, 2, 'dx', 1));
        const x = xv === null ? null : toArray(xv).data;
        let s = 0;
        for (let i = 1; i < y.length; i++) s += ((y[i] + y[i - 1]) / 2) * (x ? x[i] - x[i - 1] : dx);
        return s;
    });
    m.set('trapezoid', trapz);
    m.set('trapz', trapz);
    set('interp', (a) => {
        const xs = toArray(a[1] ?? null).data;
        const ys = toArray(a[2] ?? null).data;
        const at = (x: number) => {
            if (x <= xs[0]) return ys[0];
            if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
            let lo = 0;
            let hi = xs.length - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (xs[mid] <= x) lo = mid;
                else hi = mid;
            }
            const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
            return ys[lo] + t * (ys[hi] - ys[lo]);
        };
        const { arr, scalar } = input(a[0] ?? null);
        return out(mapArray(arr, at, null), scalar);
    });
    set('polyval', (a) => {
        const p = toArray(a[0] ?? null).data;
        const { arr, scalar } = input(a[1] ?? null);
        return out(mapArray(arr, (x) => p.reduce((s, c) => s * x + c, 0), null), scalar);
    });
    set('polyfit', (a) => {
        const x = toArray(a[0] ?? null).data;
        const y = toArray(a[1] ?? null).data;
        const deg = intArg(a[2] ?? 1);
        const k = deg + 1;
        // Normal equations (fine for the small degrees of charts).
        const ata = new Float64Array(k * k);
        const aty = new Float64Array(k);
        for (let i = 0; i < x.length; i++) {
            const pw: number[] = [];
            for (let j = 0; j < k; j++) pw.push(x[i] ** (deg - j));
            for (let r = 0; r < k; r++) {
                aty[r] += pw[r] * y[i];
                for (let c = 0; c < k; c++) ata[r * k + c] += pw[r] * pw[c];
            }
        }
        return solve(new NDArray([k, k], ata, 'float'), fromNumbers(aty));
    });
    set('histogram', (a, kw) => {
        const data = toArray(a[0] ?? null).data;
        const bins = intArg(arg(a, kw, 1, 'bins', 10));
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of data) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        const range = arg(a, kw, 2, 'range', null);
        if (range !== null) [lo, hi] = iterate(range).map((v) => num(v));
        if (!(hi > lo)) hi = lo + 1;
        const counts = new Float64Array(bins);
        for (const v of data) {
            if (v < lo || v > hi) continue;
            counts[Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins))]++;
        }
        const edges = Float64Array.from({ length: bins + 1 }, (_, i) => lo + ((hi - lo) * i) / bins);
        if (truthy(arg(a, kw, 3, 'density', false))) {
            const w = (hi - lo) / bins;
            for (let i = 0; i < bins; i++) counts[i] /= data.length * w;
        }
        return new PyTuple([fromNumbers(counts, 'int'), fromNumbers(edges)]);
    });
    set('isclose', (a, kw) => {
        const rtol = num(arg(a, kw, 2, 'rtol', 1e-5));
        const atol = num(arg(a, kw, 3, 'atol', 1e-8));
        return binaryApply(a[0] ?? null, a[1] ?? null, (x, y) => (Math.abs(x - y) <= atol + rtol * Math.abs(y) ? 1 : 0), 'bool');
    });
    set('allclose', (a, kw) => {
        const rtol = num(arg(a, kw, 2, 'rtol', 1e-5));
        const atol = num(arg(a, kw, 3, 'atol', 1e-8));
        const r = binaryApply(a[0] ?? null, a[1] ?? null, (x, y) => (Math.abs(x - y) <= atol + rtol * Math.abs(y) ? 1 : 0), 'bool');
        return r instanceof NDArray ? r.data.every((v) => v !== 0) : truthy(r);
    });
    set('array_equal', (a) => {
        const x = toArray(a[0] ?? null);
        const y = toArray(a[1] ?? null);
        return x.size === y.size && x.shape.every((d, i) => d === y.shape[i]) && x.data.every((v, i) => v === y.data[i]);
    });

    // np.linalg.
    const la = new Map<string, PyValue>();
    la.set('det', fn('det', (a) => det(a[0] ?? null)));
    la.set('inv', fn('inv', (a) => inv(a[0] ?? null)));
    la.set('solve', fn('solve', (a) => solve(a[0] ?? null, a[1] ?? null)));
    la.set('eig', fn('eig', (a) => eig(a[0] ?? null, true)));
    la.set('eigvals', fn('eigvals', (a) => eig(a[0] ?? null, false)));
    la.set('eigh', fn('eigh', (a) => {
        const { n, a: d } = square(a[0] ?? null, 'eigh');
        const s = eigSymmetric(n, d);
        return new PyTuple([fromNumbers(s.values), new NDArray([n, n], s.vectors, 'float')]);
    }));
    la.set('eigvalsh', fn('eigvalsh', (a) => {
        const { n, a: d } = square(a[0] ?? null, 'eigvalsh');
        return fromNumbers(eigSymmetric(n, d).values);
    }));
    la.set('norm', fn('norm', norm));
    la.set('matrix_power', fn('matrix_power', (a) => {
        const { n, a: d } = square(a[0] ?? null, 'matrix_power');
        let k = intArg(a[1] ?? 1);
        let base: NDArray = new NDArray([n, n], d, 'float');
        if (k < 0) {
            base = inv(base);
            k = -k;
        }
        let r: NDArray = newArray([n, n]);
        for (let i = 0; i < n; i++) r.data[i * n + i] = 1;
        while (k > 0) {
            if (k & 1) r = toArray(matmul(r, base));
            base = toArray(matmul(base, base));
            k >>= 1;
        }
        return r;
    }));
    mlNumpy(m, la, binaryUfunc); // 6.0 ML: svd, pinv, lstsq, matrix_rank, cov, corrcoef, logaddexp, bincount
    const linalg = new PyModule('numpy.linalg', la);
    m.set('linalg', linalg);

    // np.fft.
    const ff = new Map<string, PyValue>();
    ff.set('fft', fn('fft', (a, kw) => fftCall(a, kw, false)));
    ff.set('ifft', fn('ifft', (a, kw) => fftCall(a, kw, true)));
    ff.set('fftfreq', fn('fftfreq', (a, kw) => fftfreq(intArg(a[0] ?? 0), num(arg(a, kw, 1, 'd', 1)))));
    ff.set('fftshift', fn('fftshift', (a) => {
        const arr = toArray(a[0] ?? null);
        return shiftBy(arr, (n) => Math.floor(n / 2));
    }));
    ff.set('ifftshift', fn('ifftshift', (a) => {
        const arr = toArray(a[0] ?? null);
        return shiftBy(arr, (n) => n - Math.floor(n / 2));
    }));
    ff.set('rfft', fn('rfft', (a, kw) => {
        const full = fftCall(a, kw, false);
        const n = full.shape[full.ndim - 1];
        const keep = Math.floor(n / 2) + 1;
        if (full.ndim !== 1) throw valueError('python.numpy.fft1D');
        return fromComplex(full.data.slice(0, keep), (full.imag ?? new Float64Array(n)).slice(0, keep));
    }));
    ff.set('rfftfreq', fn('rfftfreq', (a, kw) => {
        const n = intArg(a[0] ?? 0);
        const d = num(arg(a, kw, 1, 'd', 1));
        return fromNumbers(Array.from({ length: Math.floor(n / 2) + 1 }, (_, i) => i / (n * d)));
    }));
    const fft = new PyModule('numpy.fft', ff);
    m.set('fft', fft);

    // np.random.
    const rm = new Map<string, PyValue>();
    randomFunctions(rng, rm, false);
    rm.set('default_rng', fn('default_rng', (a) => {
        const own = new Rng();
        own.seed(a.length && a[0] !== null ? num(a[0]) : 0);
        const g = new Map<string, PyValue>();
        randomFunctions(own, g, true);
        return new PyModule('Generator', g, 'Generator');
    }));
    const random = new PyModule('numpy.random', rm);
    m.set('random', random);

    registerMethods(m);
    return { np: new PyModule('numpy', m), linalg, fft, random };
}

/** The methods of arrays that are np functions with the array first (a.sum(axis=0) is np.sum(a, axis=0)). */
function registerMethods(m: Map<string, PyValue>): void {
    const viaNp = (name: string, npName = name) => {
        const f = m.get(npName);
        if (!(f instanceof PyBuiltin)) return;
        ARRAY_METHODS.set(name, (a, args, kw) => f.fn([a, ...args], kw));
    };
    for (const name of ['sum', 'prod', 'mean', 'std', 'var', 'min', 'max', 'argmin', 'argmax', 'cumsum', 'cumprod', 'any', 'all', 'round', 'clip', 'conj', 'conjugate', 'dot', 'ptp', 'nonzero', 'repeat', 'squeeze', 'trace', 'diagonal']) viaNp(name, name === 'diagonal' ? 'diag' : name);
    ARRAY_METHODS.set('reshape', (a, args) => reshape(a, args.length === 1 ? shapeArg(args[0]) : args.map(intArg)));
    ARRAY_METHODS.set('transpose', (a, args) => transpose(a, args.length ? (args.length === 1 && !isNum(args[0]) ? shapeArg(args[0]) : args.map(intArg)) : undefined));
    ARRAY_METHODS.set('flatten', (a) => reshape(copyArray(a), [a.size]));
    ARRAY_METHODS.set('ravel', (a) => reshape(copyArray(a), [a.size]));
    ARRAY_METHODS.set('copy', (a) => copyArray(a));
    ARRAY_METHODS.set('tolist', (a) => toList(a));
    ARRAY_METHODS.set('item', (a, args) => itemAt(a, args.length ? intArg(args[0]) : 0));
    ARRAY_METHODS.set('astype', (a, args) => astype(a, dtypeOf(args[0] ?? 'float') ?? 'float'));
    ARRAY_METHODS.set('fill', (a, args) => {
        const v = args[0] ?? 0;
        a.data.fill(v instanceof PyComplex ? v.re : num(v));
        if (a.imag) a.imag.fill(v instanceof PyComplex ? v.im : 0);
        return null;
    });
    ARRAY_METHODS.set('sort', (a, args, kw) => {
        const sorted = alongAxis(a, axisArg(a, arg(args, kw, 0, 'axis', -1)), sortLine, a.dtype);
        a.data.set(sorted.data);
        return null;
    });
    ARRAY_METHODS.set('argsort', (a, args, kw) => alongAxis(a, axisArg(a, arg(args, kw, 0, 'axis', -1)), argsortLine, 'int'));
}
