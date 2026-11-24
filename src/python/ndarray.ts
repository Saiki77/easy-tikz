/*
 * 6.0 P: NumPy arrays for chart scripts: making them from lists, element-
 * wise operators with broadcasting (real and complex), comparisons and
 * boolean masks, items, slices and fancy indexing, reductions along an
 * axis, reshaping, and the attributes and methods of an array. The module
 * functions (np.linspace, np.fft, ...) are in numpy.ts. Pure: no DOM, no
 * Obsidian.
 */
import { PyError, indexError, typeError, valueError } from './errors';
import { DType, Kwargs, MAX_ITEMS, NDArray, PyBuiltin, PyComplex, PyRange, PySlice, PyTuple, PyValue, floatRepr, hooks, isNum, iterate, repr, typeName } from './values';

// ------------------------------------------------------------ making arrays

export function checkCount(n: number): number {
    if (!(n <= MAX_ITEMS)) throw new PyError('MemoryError', 'python.budget.items', { count: MAX_ITEMS });
    return n;
}

export function sizeOf(shape: readonly number[]): number {
    let n = 1;
    for (const d of shape) n *= d;
    return n;
}

export function newArray(shape: number[], dtype: DType = 'float'): NDArray {
    const n = checkCount(sizeOf(shape));
    return new NDArray(shape, new Float64Array(n), dtype, dtype === 'complex' ? new Float64Array(n) : null);
}

export function fromNumbers(values: ArrayLike<number>, dtype: DType = 'float', shape?: number[]): NDArray {
    const data = Float64Array.from(values);
    return new NDArray(shape ?? [data.length], data, dtype);
}

export function fromComplex(re: Float64Array, im: Float64Array, shape?: number[]): NDArray {
    return new NDArray(shape ?? [re.length], re, 'complex', im);
}

export const isArrayLike = (v: PyValue): boolean => v instanceof NDArray || Array.isArray(v) || v instanceof PyTuple;

function joinDtype(a: DType, b: DType): DType {
    if (a === 'complex' || b === 'complex') return 'complex';
    if (a === 'float' || b === 'float') return 'float';
    if (a === 'int' || b === 'int') return 'int';
    return 'bool';
}

function scalarDtype(v: PyValue): DType {
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
    if (v instanceof PyComplex) return 'complex';
    throw typeError('python.numpy.notNumber', { type: typeName(v) });
}

/** An array from a number, a (nested) list or tuple, a range or an array (copied only when `copy`). */
export function toArray(v: PyValue, dtype?: DType | null, copy = false): NDArray {
    if (v instanceof NDArray) {
        if (dtype && dtype !== v.dtype) return astype(v, dtype);
        return copy ? copyArray(v) : v;
    }
    if (isNum(v) || v instanceof PyComplex) {
        const d = dtype ?? scalarDtype(v);
        const out = newArray([], d);
        if (v instanceof PyComplex) {
            out.data[0] = v.re;
            if (out.imag) out.imag[0] = v.im;
        } else out.data[0] = Number(v);
        return out;
    }
    if (!(Array.isArray(v) || v instanceof PyTuple || v instanceof PyRange)) throw typeError('python.numpy.notNumber', { type: typeName(v) });
    // The shape from the first items, then every number in order.
    const shape: number[] = [];
    let probe: PyValue = v;
    while (Array.isArray(probe) || probe instanceof PyTuple || probe instanceof NDArray || probe instanceof PyRange) {
        if (probe instanceof NDArray) {
            shape.push(...probe.shape);
            break;
        }
        const items = iterate(probe);
        shape.push(items.length);
        if (!items.length) break;
        probe = items[0];
    }
    const n = checkCount(sizeOf(shape));
    const re = new Float64Array(n);
    let im: Float64Array | null = null;
    const meta: { kind: DType } = { kind: 'bool' };
    let k = 0;
    const walk = (x: PyValue, depth: number) => {
        if (depth === shape.length) {
            if (x instanceof NDArray) {
                if (x.size !== 1) throw valueError('python.numpy.ragged');
                meta.kind = joinDtype(meta.kind, x.dtype);
                if (x.imag) {
                    im = im ?? new Float64Array(n);
                    im[k] = x.imag[0];
                }
                re[k++] = x.data[0];
                return;
            }
            const d = scalarDtype(x);
            meta.kind = joinDtype(meta.kind, d);
            if (x instanceof PyComplex) {
                im = im ?? new Float64Array(n);
                im[k] = x.im;
                re[k++] = x.re;
            } else re[k++] = Number(x);
            return;
        }
        if (x instanceof NDArray) {
            if (x.shape.length !== shape.length - depth || x.shape.some((s, i) => s !== shape[depth + i])) throw valueError('python.numpy.ragged');
            meta.kind = joinDtype(meta.kind, x.dtype);
            for (let i = 0; i < x.size; i++) {
                if (x.imag) {
                    im = im ?? new Float64Array(n);
                    im[k] = x.imag[i];
                }
                re[k++] = x.data[i];
            }
            return;
        }
        if (!(Array.isArray(x) || x instanceof PyTuple || x instanceof PyRange)) throw valueError('python.numpy.ragged');
        const items = iterate(x);
        if (items.length !== shape[depth]) throw valueError('python.numpy.ragged');
        for (const y of items) walk(y, depth + 1);
    };
    walk(v, 0);
    if (shape.length && shape[shape.length - 1] === 0 && n === 0) meta.kind = 'float';
    const kind = meta.kind;
    const out = new NDArray(shape, re, kind, kind === 'complex' ? (im ?? new Float64Array(n)) : null);
    return dtype && dtype !== kind ? astype(out, dtype) : out;
}

export function copyArray(a: NDArray): NDArray {
    return new NDArray(a.shape.slice(), a.data.slice(), a.dtype, a.imag ? a.imag.slice() : null);
}

export function astype(a: NDArray, dtype: DType): NDArray {
    const data = a.data.slice();
    if (dtype === 'int') for (let i = 0; i < data.length; i++) data[i] = Math.trunc(data[i]);
    if (dtype === 'bool') for (let i = 0; i < data.length; i++) data[i] = data[i] !== 0 || (a.imag ? a.imag[i] !== 0 : false) ? 1 : 0;
    const imag = dtype === 'complex' ? (a.imag ? a.imag.slice() : new Float64Array(data.length)) : null;
    return new NDArray(a.shape.slice(), data, dtype, imag);
}

/** A dtype from np.float64, float, 'complex', int, bool. */
export function dtypeOf(v: PyValue): DType | null {
    if (v === null || v === undefined) return null;
    const name = typeof v === 'string' ? v : v instanceof PyBuiltin ? v.name : '';
    if (/^(?:float|float64|float32|double|f8|f4|d)$/.test(name)) return 'float';
    if (/^(?:int|int64|int32|int16|int8|i8|i4|uint8|long)$/.test(name)) return 'int';
    if (/^(?:bool|bool_)$/.test(name)) return 'bool';
    if (/^(?:complex|complex128|complex64|c16)$/.test(name)) return 'complex';
    throw typeError('python.numpy.badDtype', { name: name || typeName(v) });
}

// ------------------------------------------------------------ the item values

/** The item at flat index i as a Python value. */
export function itemAt(a: NDArray, i: number): PyValue {
    if (a.dtype === 'complex') return new PyComplex(a.data[i], a.imag ? a.imag[i] : 0);
    if (a.dtype === 'bool') return a.data[i] !== 0;
    return a.data[i];
}

/** A 0-d array (or any of size 1 when `any`) as its Python value. */
export function scalarOf(a: NDArray): PyValue {
    return itemAt(a, 0);
}

// ------------------------------------------------------------ broadcasting

export function broadcastShape(a: readonly number[], b: readonly number[]): number[] {
    const n = Math.max(a.length, b.length);
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
        const x = a[a.length - n + i] ?? 1;
        const y = b[b.length - n + i] ?? 1;
        if (x !== y && x !== 1 && y !== 1) throw valueError('python.numpy.broadcast', { a: `(${a.join(', ')})`, b: `(${b.join(', ')})` });
        out[i] = x === 1 ? y : x;
    }
    return out;
}

/** For each flat index of `shape`, the flat index into an array of `from` broadcast to it. */
export function broadcastIndex(from: readonly number[], shape: readonly number[]): Int32Array | null {
    const n = sizeOf(shape);
    if (from.length === shape.length && from.every((d, i) => d === shape[i])) return null;
    const out = new Int32Array(n);
    if (sizeOf(from) === 1) return out;
    const nd = shape.length;
    const strides = new Array<number>(nd).fill(0);
    let s = 1;
    for (let i = from.length - 1; i >= 0; i--) {
        const axis = nd - from.length + i;
        strides[axis] = from[i] === 1 ? 0 : s;
        s *= from[i];
    }
    const idx = new Array<number>(nd).fill(0);
    let off = 0;
    for (let k = 0; k < n; k++) {
        out[k] = off;
        for (let ax = nd - 1; ax >= 0; ax--) {
            idx[ax]++;
            off += strides[ax];
            if (idx[ax] < shape[ax]) break;
            off -= strides[ax] * idx[ax];
            idx[ax] = 0;
        }
    }
    return out;
}

type RealKernel = (x: number, y: number) => number;
type ComplexKernel = (ar: number, ai: number, br: number, bi: number, out: Float64Array) => void;

const REAL: Record<string, RealKernel> = {
    '+': (x, y) => x + y,
    '-': (x, y) => x - y,
    '*': (x, y) => x * y,
    '/': (x, y) => x / y,
    '//': (x, y) => Math.floor(x / y),
    '%': (x, y) => {
        const r = x % y;
        return r !== 0 && r < 0 !== y < 0 ? r + y : r;
    },
    '**': (x, y) => x ** y,
    '&': (x, y) => x & y,
    '|': (x, y) => x | y,
    '^': (x, y) => x ^ y,
    '<<': (x, y) => x * 2 ** y,
    '>>': (x, y) => Math.floor(x / 2 ** y),
    '<': (x, y) => (x < y ? 1 : 0),
    '>': (x, y) => (x > y ? 1 : 0),
    '<=': (x, y) => (x <= y ? 1 : 0),
    '>=': (x, y) => (x >= y ? 1 : 0),
    '==': (x, y) => (x === y ? 1 : 0),
    '!=': (x, y) => (x !== y ? 1 : 0),
};

function cpowParts(ar: number, ai: number, br: number, bi: number, out: Float64Array): void {
    if (bi === 0 && Number.isInteger(br) && Math.abs(br) <= 64) {
        let n = Math.abs(br);
        let rr = 1;
        let ri = 0;
        let xr = ar;
        let xi = ai;
        while (n > 0) {
            if (n & 1) {
                const t = rr * xr - ri * xi;
                ri = rr * xi + ri * xr;
                rr = t;
            }
            const t = xr * xr - xi * xi;
            xi = 2 * xr * xi;
            xr = t;
            n >>= 1;
        }
        if (br < 0) {
            const d = rr * rr + ri * ri;
            out[0] = rr / d;
            out[1] = -ri / d;
        } else {
            out[0] = rr;
            out[1] = ri;
        }
        return;
    }
    if (ar === 0 && ai === 0) {
        out[0] = br === 0 && bi === 0 ? 1 : 0;
        out[1] = 0;
        return;
    }
    const lr = Math.log(Math.hypot(ar, ai));
    const th = Math.atan2(ai, ar);
    const re = br * lr - bi * th;
    const im = br * th + bi * lr;
    const m = Math.exp(re);
    out[0] = m * Math.cos(im);
    out[1] = m * Math.sin(im);
}

const COMPLEX: Record<string, ComplexKernel> = {
    '+': (ar, ai, br, bi, o) => {
        o[0] = ar + br;
        o[1] = ai + bi;
    },
    '-': (ar, ai, br, bi, o) => {
        o[0] = ar - br;
        o[1] = ai - bi;
    },
    '*': (ar, ai, br, bi, o) => {
        o[0] = ar * br - ai * bi;
        o[1] = ar * bi + ai * br;
    },
    '/': (ar, ai, br, bi, o) => {
        const d = br * br + bi * bi;
        o[0] = (ar * br + ai * bi) / d;
        o[1] = (ai * br - ar * bi) / d;
    },
    '**': cpowParts,
    '==': (ar, ai, br, bi, o) => {
        o[0] = ar === br && ai === bi ? 1 : 0;
        o[1] = 0;
    },
    '!=': (ar, ai, br, bi, o) => {
        o[0] = ar !== br || ai !== bi ? 1 : 0;
        o[1] = 0;
    },
};

const COMPARE = new Set(['<', '>', '<=', '>=', '==', '!=']);

function resultDtype(op: string, a: DType, b: DType): DType {
    if (COMPARE.has(op)) return 'bool';
    const j = joinDtype(a, b);
    if (j === 'complex') return 'complex';
    if (op === '/') return 'float';
    if (op === '**' && j !== 'float') return 'int';
    if (j === 'bool') return op === '&' || op === '|' || op === '^' ? 'bool' : 'int';
    return j;
}

/** a op b with NumPy's broadcasting; either side may be a number, a list or an array. */
export function arrayBinop(op: string, av: PyValue, bv: PyValue): PyValue {
    if (op === '@') return matmul(toArray(av), toArray(bv));
    const a = toArray(av);
    const b = toArray(bv);
    const dtype = resultDtype(op, a.dtype, b.dtype);
    const shape = broadcastShape(a.shape, b.shape);
    const n = checkCount(sizeOf(shape));
    const ia = broadcastIndex(a.shape, shape);
    const ib = broadcastIndex(b.shape, shape);
    const complex = a.dtype === 'complex' || b.dtype === 'complex';
    if (!complex) {
        const f = REAL[op];
        if (!f) throw typeError('python.type.badOperand', { op, a: 'ndarray', b: 'ndarray' });
        const out = new Float64Array(n);
        const x = a.data;
        const y = b.data;
        if (!ia && !ib) for (let i = 0; i < n; i++) out[i] = f(x[i], y[i]);
        else if (!ia && b.data.length === 1) {
            const c = y[0];
            for (let i = 0; i < n; i++) out[i] = f(x[i], c);
        } else if (!ib && a.data.length === 1) {
            const c = x[0];
            for (let i = 0; i < n; i++) out[i] = f(c, y[i]);
        } else for (let i = 0; i < n; i++) out[i] = f(x[ia ? ia[i] : i], y[ib ? ib[i] : i]);
        // Whole powers of ints with a negative exponent are floats in NumPy too (it refuses; we give the float).
        let d = dtype;
        if (d === 'int' && op === '**') for (let i = 0; i < n; i++) if (!Number.isInteger(out[i])) d = 'float';
        if (d === 'int' && (op === '//' || op === '%')) for (let i = 0; i < n; i++) if (!Number.isFinite(out[i])) d = 'float';
        return new NDArray(shape, out, d);
    }
    const f = COMPLEX[op];
    if (!f) throw typeError('python.numpy.complexOp', { op });
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const ar = a.data;
    const ai = a.imag;
    const br = b.data;
    const bi = b.imag;
    const o = new Float64Array(2);
    for (let i = 0; i < n; i++) {
        const p = ia ? ia[i] : i;
        const q = ib ? ib[i] : i;
        f(ar[p], ai ? ai[p] : 0, br[q], bi ? bi[q] : 0, o);
        re[i] = o[0];
        im[i] = o[1];
    }
    if (dtype === 'bool') return new NDArray(shape, re, 'bool');
    return new NDArray(shape, re, 'complex', im);
}

export function arrayCompare(op: string, a: PyValue, b: PyValue): PyValue {
    if (!isArrayLike(a) && !isNum(a) && !(a instanceof PyComplex)) return op === '!=';
    if (!isArrayLike(b) && !isNum(b) && !(b instanceof PyComplex)) return op === '!=';
    return arrayBinop(op, a, b);
}

export function arrayUnary(op: string, a: NDArray): PyValue {
    if (op === '-') return mapArray(a, (x) => -x, (r, i, o) => {
        o[0] = -r;
        o[1] = -i;
    }, a.dtype === 'bool' ? 'int' : a.dtype);
    if (op === '+') return a;
    if (op === '~') {
        if (a.dtype === 'bool') return mapArray(a, (x) => (x ? 0 : 1), null, 'bool');
        return mapArray(a, (x) => ~x, null, 'int');
    }
    throw typeError('python.type.badUnary', { op, type: 'ndarray' });
}

/** Element by element: `real` on numbers, `cplx` (re, im) -> out on complex arrays (null: only real). */
export function mapArray(a: NDArray, real: (x: number) => number, cplx: ((re: number, im: number, out: Float64Array) => void) | null, dtype: DType = 'float', complexOut = true): NDArray {
    const n = a.size;
    if (a.dtype === 'complex') {
        if (!cplx) throw typeError('python.numpy.noComplex');
        const re = new Float64Array(n);
        const im = complexOut ? new Float64Array(n) : null;
        const o = new Float64Array(2);
        const ai = a.imag ?? new Float64Array(n);
        for (let i = 0; i < n; i++) {
            cplx(a.data[i], ai[i], o);
            re[i] = o[0];
            if (im) im[i] = o[1];
        }
        return new NDArray(a.shape.slice(), re, im ? 'complex' : dtype === 'complex' ? 'float' : dtype, im);
    }
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = real(a.data[i]);
    return new NDArray(a.shape.slice(), out, dtype === 'complex' ? 'float' : dtype);
}

// ------------------------------------------------------------ matrix product

export function matmul(a: NDArray, b: NDArray): PyValue {
    if (a.ndim === 0 || b.ndim === 0) throw valueError('python.numpy.matmulScalar');
    const complex = a.dtype === 'complex' || b.dtype === 'complex';
    const a2 = a.ndim === 1 ? reshape(a, [1, a.shape[0]]) : a;
    const b2 = b.ndim === 1 ? reshape(b, [b.shape[0], 1]) : b;
    if (a2.ndim !== 2 || b2.ndim !== 2) throw valueError('python.numpy.matmul2D');
    const [m, k] = a2.shape;
    const [k2, p] = b2.shape;
    if (k !== k2) throw valueError('python.numpy.matmulShapes', { a: `(${a.shape.join(', ')})`, b: `(${b.shape.join(', ')})` });
    const re = new Float64Array(checkCount(m * p));
    const im = complex ? new Float64Array(m * p) : null;
    const ai = a2.imag;
    const bi = b2.imag;
    for (let i = 0; i < m; i++) {
        for (let j = 0; j < p; j++) {
            let sr = 0;
            let si = 0;
            for (let t = 0; t < k; t++) {
                const xr = a2.data[i * k + t];
                const xi = ai ? ai[i * k + t] : 0;
                const yr = b2.data[t * p + j];
                const yi = bi ? bi[t * p + j] : 0;
                sr += xr * yr - xi * yi;
                si += xr * yi + xi * yr;
            }
            re[i * p + j] = sr;
            if (im) im[i * p + j] = si;
        }
    }
    let shape = [m, p];
    if (a.ndim === 1 && b.ndim === 1) shape = [];
    else if (a.ndim === 1) shape = [p];
    else if (b.ndim === 1) shape = [m];
    const dtype: DType = complex ? 'complex' : a.dtype === 'int' && b.dtype === 'int' ? 'int' : 'float';
    const out = new NDArray(shape, re, dtype, im);
    return shape.length ? out : scalarOf(out);
}

// ------------------------------------------------------------ shapes

export function reshape(a: NDArray, shape: number[]): NDArray {
    const n = a.size;
    const free = shape.indexOf(-1);
    const s = shape.slice();
    if (free >= 0) {
        const rest = sizeOf(s.filter((_, i) => i !== free));
        if (rest === 0 || n % rest !== 0) throw valueError('python.numpy.reshape', { size: n, shape: `(${shape.join(', ')})` });
        s[free] = n / rest;
    }
    if (sizeOf(s) !== n || s.some((d) => d < 0 || !Number.isInteger(d))) throw valueError('python.numpy.reshape', { size: n, shape: `(${shape.join(', ')})` });
    return new NDArray(s, a.data, a.dtype, a.imag);
}

export function transpose(a: NDArray, axes?: number[]): NDArray {
    const nd = a.ndim;
    if (nd < 2) return a;
    const perm = axes ?? Array.from({ length: nd }, (_, i) => nd - 1 - i);
    const shape = perm.map((p) => a.shape[p]);
    const out = newArray(shape, a.dtype);
    const strides = stridesOf(a.shape);
    const idx = new Array<number>(nd).fill(0);
    const n = a.size;
    for (let k = 0; k < n; k++) {
        let off = 0;
        for (let i = 0; i < nd; i++) off += idx[i] * strides[perm[i]];
        out.data[k] = a.data[off];
        if (out.imag && a.imag) out.imag[k] = a.imag[off];
        for (let ax = nd - 1; ax >= 0; ax--) {
            if (++idx[ax] < shape[ax]) break;
            idx[ax] = 0;
        }
    }
    return out;
}

export function stridesOf(shape: readonly number[]): number[] {
    const out = new Array<number>(shape.length);
    let s = 1;
    for (let i = shape.length - 1; i >= 0; i--) {
        out[i] = s;
        s *= shape[i];
    }
    return out;
}

/** Parse a shape argument: 5, (2, 3), [2, 3]. */
export function shapeArg(v: PyValue): number[] {
    if (isNum(v)) return [intOf(v)];
    return iterate(v).map(intOf);
}

function intOf(v: PyValue): number {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number' && Number.isInteger(v)) return v;
    if (v instanceof NDArray && v.size === 1 && Number.isInteger(v.data[0])) return v.data[0];
    throw typeError('python.type.needInt', { type: typeName(v) });
}

// ------------------------------------------------------------ reductions

/** The axis argument: null for all of them, else 0..ndim-1. */
export function axisArg(a: NDArray, v: PyValue | undefined): number | null {
    if (v === undefined || v === null) return null;
    let ax = intOf(v);
    if (ax < 0) ax += a.ndim;
    if (ax < 0 || ax >= Math.max(1, a.ndim)) throw new PyError('AxisError', 'python.numpy.axis', { axis: repr(v), ndim: a.ndim });
    return ax;
}

/**
 * Reduce along an axis (or all of the array): `fn` gets the numbers (and
 * imaginary parts) of one line and returns its value(s).
 */
export function reduce(a: NDArray, axis: number | null, fn: (re: Float64Array, im: Float64Array | null) => number | [number, number], dtype: DType): PyValue {
    if (axis === null || a.ndim <= 1) {
        const r = fn(a.data, a.imag);
        if (Array.isArray(r)) return new PyComplex(r[0], r[1]);
        return dtype === 'bool' ? r !== 0 : r;
    }
    const shape = a.shape.filter((_, i) => i !== axis);
    const len = a.shape[axis];
    const inner = sizeOf(a.shape.slice(axis + 1));
    const outer = sizeOf(a.shape.slice(0, axis));
    const n = outer * inner;
    const complexOut = dtype === 'complex';
    const out = new NDArray(shape, new Float64Array(n), dtype, complexOut ? new Float64Array(n) : null);
    const lineRe = new Float64Array(len);
    const lineIm = a.imag ? new Float64Array(len) : null;
    for (let o = 0; o < outer; o++) {
        for (let i = 0; i < inner; i++) {
            for (let k = 0; k < len; k++) {
                const off = (o * len + k) * inner + i;
                lineRe[k] = a.data[off];
                if (lineIm && a.imag) lineIm[k] = a.imag[off];
            }
            const r = fn(lineRe, lineIm);
            const at = o * inner + i;
            if (Array.isArray(r)) {
                out.data[at] = r[0];
                if (out.imag) out.imag[at] = r[1];
            } else out.data[at] = r;
        }
    }
    return out;
}

/** Along an axis, a line in, a line of the same length out (cumsum, sort). */
export function alongAxis(a: NDArray, axis: number | null, fn: (re: Float64Array, im: Float64Array | null, outRe: Float64Array, outIm: Float64Array | null) => void, dtype: DType): NDArray {
    if (axis === null) {
        const flat = reshape(a, [a.size]);
        return alongAxis(flat, 0, fn, dtype);
    }
    const len = a.shape[axis];
    const inner = sizeOf(a.shape.slice(axis + 1));
    const outer = sizeOf(a.shape.slice(0, axis));
    const out = newArray(a.shape.slice(), dtype);
    const lr = new Float64Array(len);
    const li = a.imag ? new Float64Array(len) : null;
    const orr = new Float64Array(len);
    const oi = out.imag ? new Float64Array(len) : null;
    for (let o = 0; o < outer; o++) {
        for (let i = 0; i < inner; i++) {
            for (let k = 0; k < len; k++) {
                const off = (o * len + k) * inner + i;
                lr[k] = a.data[off];
                if (li && a.imag) li[k] = a.imag[off];
            }
            fn(lr, li, orr, oi);
            for (let k = 0; k < len; k++) {
                const off = (o * len + k) * inner + i;
                out.data[off] = orr[k];
                if (out.imag && oi) out.imag[off] = oi[k];
            }
        }
    }
    return out;
}

export function sumOf(re: Float64Array, im: Float64Array | null): number | [number, number] {
    let s = 0;
    for (let i = 0; i < re.length; i++) s += re[i];
    if (!im) return s;
    let t = 0;
    for (let i = 0; i < im.length; i++) t += im[i];
    return [s, t];
}

// ------------------------------------------------------------ indexing

interface AxisSel {
    /** Indices along the source axis. */
    idx: Int32Array;
    /** The axis stays in the result (a slice or a list of indices). */
    keep: boolean;
    fancy: boolean;
}

function selection(a: NDArray, index: PyValue): { sels: AxisSel[]; newAxes: number[]; mask: NDArray | null } {
    let items: PyValue[] = index instanceof PyTuple ? index.items.slice() : [index];
    // A boolean mask of the whole shape.
    if (items.length === 1 && items[0] instanceof NDArray && items[0].dtype === 'bool' && items[0].ndim === a.ndim && a.ndim > 1) {
        return { sels: [], newAxes: [], mask: items[0] };
    }
    const real = items.filter((x) => x !== null && x !== ELLIPSIS).length;
    const ellipsis = items.findIndex((x) => x === ELLIPSIS);
    if (ellipsis >= 0) {
        const fill = a.ndim - (real - 1);
        items = [...items.slice(0, ellipsis), ...new Array<PyValue>(Math.max(0, fill)).fill(new PySlice(null, null, null)), ...items.slice(ellipsis + 1)];
    }
    const sels: AxisSel[] = [];
    const newAxes: number[] = [];
    let axis = 0;
    let out = 0;
    for (const it of items) {
        if (it === null) {
            newAxes.push(out++);
            continue;
        }
        if (axis >= a.ndim) throw indexError('python.index.tooMany', { ndim: a.ndim });
        const n = a.shape[axis];
        if (it instanceof PySlice) {
            const [s, e, step] = sliceRange(it, n);
            const list: number[] = [];
            if (step > 0) for (let i = s; i < e; i += step) list.push(i);
            else for (let i = s; i > e; i += step) list.push(i);
            sels.push({ idx: Int32Array.from(list), keep: true, fancy: false });
            out++;
        } else if (it instanceof NDArray || Array.isArray(it)) {
            const arr = toArray(it);
            let list: number[];
            if (arr.dtype === 'bool') {
                if (arr.size !== n) throw indexError('python.index.maskSize', { size: arr.size, n });
                list = [];
                for (let i = 0; i < n; i++) if (arr.data[i]) list.push(i);
            } else {
                list = Array.from(arr.data, (v) => {
                    if (!Number.isInteger(v)) throw indexError('python.index.notInt');
                    const k = v < 0 ? v + n : v;
                    if (k < 0 || k >= n) throw indexError('python.index.outOfRange', { what: 'array' });
                    return k;
                });
            }
            sels.push({ idx: Int32Array.from(list), keep: true, fancy: true });
            out++;
        } else {
            let k = intOf(it);
            if (k < 0) k += n;
            if (k < 0 || k >= n) throw indexError('python.index.axisRange', { index: repr(it), axis, n });
            sels.push({ idx: Int32Array.of(k), keep: false, fancy: false });
        }
        axis++;
    }
    for (; axis < a.ndim; axis++) {
        const n = a.shape[axis];
        sels.push({ idx: Int32Array.from({ length: n }, (_, i) => i), keep: true, fancy: false });
    }
    return { sels, newAxes, mask: null };
}

/** The Ellipsis value (`...` in an index). */
export const ELLIPSIS = new PyTuple([]);

function sliceRange(s: PySlice, n: number): [number, number, number] {
    const step = s.step === null ? 1 : intOf(s.step);
    if (step === 0) throw valueError('python.index.zeroStep');
    const fix = (v: PyValue, dflt: number, lo: number, hi: number) => {
        if (v === null) return dflt;
        let i = intOf(v);
        if (i < 0) i += n;
        return Math.max(lo, Math.min(hi, i));
    };
    if (step > 0) return [fix(s.start, 0, 0, n), fix(s.stop, n, 0, n), step];
    return [fix(s.start, n - 1, -1, n - 1), fix(s.stop, -1, -1, n - 1), step];
}

/** Flat source offsets of a selection, and the result's shape. */
function gather(a: NDArray, sels: AxisSel[], newAxes: number[]): { offsets: Int32Array; shape: number[] } {
    const strides = stridesOf(a.shape);
    const fancy = sels.filter((s) => s.fancy);
    const zipped = fancy.length > 1;
    if (zipped && fancy.some((s) => s.idx.length !== fancy[0].idx.length)) throw indexError('python.index.fancyShapes');
    // The loop axes: each kept axis, the zipped fancy ones as one.
    const loops: Array<{ sels: number[]; len: number }> = [];
    let zipAt = -1;
    sels.forEach((s, i) => {
        if (!s.keep) return;
        if (zipped && s.fancy) {
            if (zipAt < 0) {
                zipAt = loops.length;
                loops.push({ sels: [i], len: s.idx.length });
            } else loops[zipAt].sels.push(i);
        } else loops.push({ sels: [i], len: s.idx.length });
    });
    let base = 0;
    sels.forEach((s, i) => {
        if (!s.keep) base += s.idx[0] * strides[i];
    });
    const shape = loops.map((l) => l.len);
    const n = checkCount(sizeOf(shape));
    const offsets = new Int32Array(n);
    const counter = new Array<number>(loops.length).fill(0);
    for (let k = 0; k < n; k++) {
        let off = base;
        for (let l = 0; l < loops.length; l++) for (const si of loops[l].sels) off += sels[si].idx[counter[l]] * strides[si];
        offsets[k] = off;
        for (let l = loops.length - 1; l >= 0; l--) {
            if (++counter[l] < loops[l].len) break;
            counter[l] = 0;
        }
    }
    for (const at of newAxes) shape.splice(Math.min(at, shape.length), 0, 1);
    return { offsets, shape };
}

export function arrayGetitem(a: NDArray, index: PyValue): PyValue {
    // The fast way for a[i] of a 1D array.
    if (typeof index === 'number' && a.ndim === 1) {
        let k = index;
        if (!Number.isInteger(k)) throw indexError('python.index.notInt');
        if (k < 0) k += a.shape[0];
        if (k < 0 || k >= a.shape[0]) throw indexError('python.index.axisRange', { index: String(index), axis: 0, n: a.shape[0] });
        return itemAt(a, k);
    }
    if (a.ndim === 0) throw indexError('python.index.scalar');
    const { sels, newAxes, mask } = selection(a, index);
    if (mask) {
        if (mask.shape.some((d, i) => d !== a.shape[i])) throw indexError('python.index.maskSize', { size: mask.size, n: a.size });
        const re: number[] = [];
        const im: number[] = [];
        for (let i = 0; i < a.size; i++) {
            if (!mask.data[i]) continue;
            re.push(a.data[i]);
            if (a.imag) im.push(a.imag[i]);
        }
        return new NDArray([re.length], Float64Array.from(re), a.dtype, a.imag ? Float64Array.from(im) : null);
    }
    const { offsets, shape } = gather(a, sels, newAxes);
    if (!shape.length) return itemAt(a, offsets[0]);
    const out = newArray(shape, a.dtype);
    for (let k = 0; k < offsets.length; k++) {
        out.data[k] = a.data[offsets[k]];
        if (out.imag && a.imag) out.imag[k] = a.imag[offsets[k]];
    }
    return out;
}

export function arraySetitem(a: NDArray, index: PyValue, v: PyValue): void {
    let offsets: Int32Array;
    let shape: number[];
    if (typeof index === 'number' && a.ndim === 1) {
        let k = index;
        if (k < 0) k += a.shape[0];
        if (!Number.isInteger(k) || k < 0 || k >= a.shape[0]) throw indexError('python.index.axisRange', { index: String(index), axis: 0, n: a.shape[0] });
        offsets = Int32Array.of(k);
        shape = [];
    } else {
        const sel = selection(a, index);
        if (sel.mask) {
            const list: number[] = [];
            for (let i = 0; i < a.size; i++) if (sel.mask.data[i]) list.push(i);
            offsets = Int32Array.from(list);
            shape = [list.length];
        } else ({ offsets, shape } = gather(a, sel.sels, sel.newAxes));
    }
    const src = toArray(v);
    if (src.dtype === 'complex' && a.dtype !== 'complex') throw typeError('python.numpy.complexInto');
    const map = broadcastIndex(src.shape, shape);
    if (src.size !== 1 && sizeOf(broadcastShape(src.shape, shape)) !== offsets.length) throw valueError('python.numpy.broadcast', { a: `(${src.shape.join(', ')})`, b: `(${shape.join(', ')})` });
    for (let k = 0; k < offsets.length; k++) {
        const s = map ? map[k] : k;
        let x = src.data[s];
        if (a.dtype === 'int') x = Math.trunc(x);
        else if (a.dtype === 'bool') x = x ? 1 : 0;
        a.data[offsets[k]] = x;
        if (a.imag) a.imag[offsets[k]] = src.imag ? src.imag[s] : 0;
    }
}

// ------------------------------------------------------------ text

function numText(x: number, dtype: DType): string {
    if (dtype === 'bool') return x ? 'True' : 'False';
    if (dtype === 'int') return String(x);
    if (Number.isNaN(x)) return 'nan';
    if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
    const y = Number(x.toPrecision(8));
    const a = Math.abs(y);
    if (a !== 0 && (a >= 1e16 || a < 1e-4)) return floatRepr(y);
    if (Number.isInteger(y)) return `${Object.is(y, -0) ? '-0' : y}.`;
    return String(y);
}

function itemText(a: NDArray, i: number): string {
    if (a.dtype !== 'complex') return numText(a.data[i], a.dtype);
    const re = a.data[i];
    const im = a.imag ? a.imag[i] : 0;
    const r = numText(re, 'float');
    const m = numText(Math.abs(im), 'float');
    return `${r}${im < 0 || Object.is(im, -0) ? '-' : '+'}${m}j`;
}

function arrayText(a: NDArray, sep: string, indent: number): string {
    if (a.ndim === 0) return itemText(a, 0);
    const texts: string[] = [];
    const n = a.size;
    const summarise = n > 1000;
    for (let i = 0; i < n; i++) texts.push(itemText(a, i));
    // NumPy lines up the points: whole parts to the right, fractions to the left.
    const plain = a.dtype === 'float' && texts.every((t) => /^-?\d+\.\d*$/.test(t));
    const intW = plain ? Math.max(...texts.map((t) => t.indexOf('.')), 0) : 0;
    const fracW = plain ? Math.max(...texts.map((t) => t.length - t.indexOf('.') - 1), 0) : 0;
    const w = Math.max(...texts.map((t) => t.length), 0);
    const pad = (t: string) => {
        if (plain) {
            const dot = t.indexOf('.');
            return t.slice(0, dot).padStart(intW) + '.' + t.slice(dot + 1).padEnd(fracW);
        }
        return a.dtype === 'float' || a.dtype === 'int' ? t.padStart(w) : t;
    };
    const level = (d: number, off: number, ind: number): string => {
        const len = a.shape[d];
        const inner = sizeOf(a.shape.slice(d + 1));
        const parts: string[] = [];
        const show = (k: number) => !summarise || k < 3 || k >= len - 3;
        for (let k = 0; k < len; k++) {
            if (!show(k)) {
                if (parts[parts.length - 1] !== '...') parts.push('...');
                continue;
            }
            parts.push(d === a.ndim - 1 ? pad(texts[off + k]) : level(d + 1, off + k * inner, ind + 1));
        }
        const join = d === a.ndim - 1 ? sep : `${sep.trim()}\n${'\n'.repeat(Math.max(0, a.ndim - d - 2))}${' '.repeat(ind + 1)}`;
        return `[${parts.join(join)}]`;
    };
    return level(0, 0, indent);
}

hooks.arrayRepr = (a: NDArray) => {
    const body = arrayText(a, ', ', 6);
    return a.ndim === 0 ? `array(${body})` : `array(${body})`;
};
hooks.arrayStr = (a: NDArray) => arrayText(a, ' ', 0);
hooks.arrayTruth = (a: NDArray) => {
    if (a.size !== 1) throw valueError('python.numpy.truth');
    return a.data[0] !== 0 || (a.imag ? a.imag[0] !== 0 : false);
};
hooks.arrayItems = (a: NDArray): PyValue[] => {
    if (a.ndim === 0) throw typeError('python.type.notIterable', { type: 'ndarray (0-d)' });
    if (a.ndim === 1) {
        const out = new Array<PyValue>(a.size);
        for (let i = 0; i < a.size; i++) out[i] = itemAt(a, i);
        return out;
    }
    const rows: PyValue[] = [];
    const inner = sizeOf(a.shape.slice(1));
    for (let r = 0; r < a.shape[0]; r++) {
        rows.push(new NDArray(a.shape.slice(1), a.data.slice(r * inner, (r + 1) * inner), a.dtype, a.imag ? a.imag.slice(r * inner, (r + 1) * inner) : null));
    }
    return rows;
};

/** tolist(): nested lists of Python numbers. */
export function toList(a: NDArray): PyValue {
    if (a.ndim === 0) return itemAt(a, 0);
    const level = (d: number, off: number): PyValue[] => {
        const len = a.shape[d];
        const inner = sizeOf(a.shape.slice(d + 1));
        const out: PyValue[] = [];
        for (let k = 0; k < len; k++) out.push(d === a.ndim - 1 ? itemAt(a, off + k) : level(d + 1, off + k * inner));
        return out;
    };
    return level(0, 0);
}

/** The methods and attributes of an array, by name (numpy.ts fills in the methods that are also np functions). */
export const ARRAY_METHODS = new Map<string, (a: NDArray, args: PyValue[], kw: Kwargs | null) => PyValue>();

export function arrayAttr(a: NDArray, name: string): PyValue | undefined {
    switch (name) {
        case 'shape':
            return new PyTuple(a.shape.slice());
        case 'ndim':
            return a.ndim;
        case 'size':
            return a.size;
        case 'T':
            return transpose(a);
        case 'dtype':
            return a.dtype === 'float' ? 'float64' : a.dtype === 'int' ? 'int64' : a.dtype === 'complex' ? 'complex128' : 'bool';
        case 'real':
            return new NDArray(a.shape.slice(), a.data.slice(), a.dtype === 'complex' ? 'float' : a.dtype);
        case 'imag':
            return new NDArray(a.shape.slice(), a.imag ? a.imag.slice() : new Float64Array(a.size), a.dtype === 'complex' ? 'float' : a.dtype);
    }
    const m = ARRAY_METHODS.get(name);
    if (m) return new PyBuiltin(name, (args, kw) => m(a, args, kw));
    return undefined;
}
