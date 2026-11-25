/*
 * 6.0 A: arithmetic and functions of values (src/values/types.ts):
 * complex numbers, vectors, matrices and lists. Every operation returns a
 * value and never throws; an operation a value does not have gives NaN,
 * which draws nothing, as a number outside a domain does. The compiler
 * (compile.ts) rejects most of these mistakes before anything runs.
 * Pure: no DOM, no Obsidian.
 */
import { Complex, Mat, Value, Vec, complex, isList, list, mat, vec } from './types';
import { cross3, det, inverse, matMul, matPow, matVec, trace, transpose, vecMat } from './linalg';
import { binom, factorial } from './special';
import { logSumExpOf, softmaxOf } from '../ml/builtins'; // 6.0 ML

// ----------------------------------------------------------- complex numbers

const re = (z: Complex | number) => (typeof z === 'number' ? z : z.re);
const im = (z: Complex | number) => (typeof z === 'number' ? 0 : z.im);

export function cadd(a: Complex | number, b: Complex | number): Complex {
    return complex(re(a) + re(b), im(a) + im(b));
}

export function csub(a: Complex | number, b: Complex | number): Complex {
    return complex(re(a) - re(b), im(a) - im(b));
}

export function cmul(a: Complex | number, b: Complex | number): Complex {
    const ar = re(a);
    const ai = im(a);
    const br = re(b);
    const bi = im(b);
    return complex(ar * br - ai * bi, ar * bi + ai * br);
}

export function cdiv(a: Complex | number, b: Complex | number): Complex {
    const ar = re(a);
    const ai = im(a);
    const br = re(b);
    const bi = im(b);
    const d = br * br + bi * bi;
    return complex((ar * br + ai * bi) / d, (ai * br - ar * bi) / d);
}

export function cexp(z: Complex | number): Complex {
    const m = Math.exp(re(z));
    const t = im(z);
    return t === 0 ? complex(m, 0) : complex(m * Math.cos(t), m * Math.sin(t));
}

/** The principal logarithm: ln|z| + i arg z. */
export function clog(z: Complex | number): Complex {
    return complex(Math.log(Math.hypot(re(z), im(z))), Math.atan2(im(z), re(z)));
}

/** The principal square root. */
export function csqrt(z: Complex | number): Complex {
    const a = re(z);
    const b = im(z);
    const r = Math.hypot(a, b);
    const x = Math.sqrt((r + a) / 2);
    const y = Math.sqrt((r - a) / 2);
    return complex(x, b < 0 ? -y : y);
}

/** z^w: whole powers by multiplication (i^2 is exactly -1), any other one as e^(w ln z). */
export function cpow(z: Complex | number, w: Complex | number): Complex {
    const wr = re(w);
    if (im(w) === 0 && Number.isInteger(wr) && Math.abs(wr) <= 64) {
        let out: Complex = complex(1, 0);
        let base: Complex = complex(re(z), im(z));
        let e = Math.abs(wr);
        while (e > 0) {
            if (e & 1) out = cmul(out, base);
            e >>= 1;
            if (e) base = cmul(base, base);
        }
        return wr < 0 ? cdiv(1, out) : out;
    }
    if (re(z) === 0 && im(z) === 0) return wr > 0 ? complex(0, 0) : complex(NaN, NaN);
    return cexp(cmul(w, clog(z)));
}

function csin(z: Complex): Complex {
    return complex(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));
}

function ccos(z: Complex): Complex {
    return complex(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
}

function csinh(z: Complex): Complex {
    return complex(Math.sinh(z.re) * Math.cos(z.im), Math.cosh(z.re) * Math.sin(z.im));
}

function ccosh(z: Complex): Complex {
    return complex(Math.cosh(z.re) * Math.cos(z.im), Math.sinh(z.re) * Math.sin(z.im));
}

/** Functions of a complex number, by the plain name of the formula syntax. */
export const COMPLEX_FUNCTIONS: Record<string, (z: Complex) => Complex> = {
    exp: cexp,
    log: clog,
    ln: clog,
    sqrt: csqrt,
    sin: csin,
    cos: ccos,
    tan: (z) => cdiv(csin(z), ccos(z)),
    sinh: csinh,
    cosh: ccosh,
    tanh: (z) => cdiv(csinh(z), ccosh(z)),
};

/** A complex result that is a real number within rounding: e^{iπ} + 1 is 0, not 1.2e-16 i. */
const REAL_TOLERANCE = 1e-12;

/** The real number of a value, a complex one within rounding of the real axis included; NaN for anything else. */
export function toReal(v: Value): number {
    if (typeof v === 'number') return v;
    if (v.kind === 'complex') return Math.abs(v.im) <= REAL_TOLERANCE * Math.max(1, Math.abs(v.re)) ? v.re : NaN;
    return NaN;
}

// ------------------------------------------------------------------ values

const BAD = NaN;

/** Pairwise over lists: a list and a value, or two lists of one length; null when neither is a list. */
function overLists(a: Value, b: Value, op: (x: Value, y: Value) => Value): Value | null {
    if (isList(a) && isList(b)) {
        if (a.items.length !== b.items.length) return BAD;
        return list(a.items.map((x, i) => op(x, b.items[i])));
    }
    if (isList(a)) return list(a.items.map((x) => op(x, b)));
    if (isList(b)) return list(b.items.map((y) => op(a, y)));
    return null;
}

const zip = (a: readonly number[], b: readonly number[], f: (x: number, y: number) => number) => a.map((x, i) => f(x, b[i]));

export function add(a: Value, b: Value): Value {
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    const over = overLists(a, b, add);
    if (over !== null) return over;
    if (typeof a === 'number' || a.kind === 'complex') {
        if (typeof b === 'number' || b.kind === 'complex') return cadd(a, b);
        return BAD;
    }
    if (typeof b === 'number') return BAD;
    if (a.kind === 'vec' && b.kind === 'vec') return a.v.length === b.v.length ? vec(zip(a.v, b.v, (x, y) => x + y)) : BAD;
    if (a.kind === 'mat' && b.kind === 'mat') return a.rows === b.rows && a.cols === b.cols ? mat(a.rows, a.cols, zip(a.a, b.a, (x, y) => x + y)) : BAD;
    return BAD;
}

export function neg(a: Value): Value {
    if (typeof a === 'number') return -a;
    switch (a.kind) {
        case 'complex':
            return complex(-a.re, -a.im);
        case 'vec':
            return vec(a.v.map((x) => -x));
        case 'mat':
            return mat(a.rows, a.cols, a.a.map((x) => -x));
        case 'list':
            return list(a.items.map(neg));
    }
}

export function sub(a: Value, b: Value): Value {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return add(a, neg(b));
}

/** a times a real number. */
function scale(a: Vec | Mat, k: number): Value {
    return a.kind === 'vec' ? vec(a.v.map((x) => x * k)) : mat(a.rows, a.cols, a.a.map((x) => x * k));
}

/** Two vectors: their dot product (v · w). */
export function dot(a: Vec, b: Vec): number {
    if (a.v.length !== b.v.length) return NaN;
    let s = 0;
    for (let i = 0; i < a.v.length; i++) s += a.v[i] * b.v[i];
    return s;
}

/** v × w of 3D vectors; of 2D vectors the number v_x w_y - v_y w_x (the z part of their cross product). */
export function cross(a: Value, b: Value): Value {
    if (typeof a === 'number' || typeof b === 'number' || a.kind !== 'vec' || b.kind !== 'vec') return mul(a, b);
    if (a.v.length === 3 && b.v.length === 3) return vec(cross3(a.v, b.v));
    if (a.v.length === 2 && b.v.length === 2) return a.v[0] * b.v[1] - a.v[1] * b.v[0];
    return BAD;
}

/**
 * Products: numbers and complex numbers; a number times a vector or a
 * matrix; two vectors (their dot product); a matrix times a vector, a
 * vector (as a row) times a matrix, two matrices.
 */
export function mul(a: Value, b: Value): Value {
    if (typeof a === 'number' && typeof b === 'number') return a * b;
    if ((typeof a !== 'number' && a.kind === 'list') || (typeof b !== 'number' && b.kind === 'list')) return overLists(a, b, mul) ?? BAD;
    if (typeof a === 'number') {
        if (typeof b === 'number') return a * b;
        return b.kind === 'complex' ? cmul(a, b) : scale(b, a);
    }
    if (typeof b === 'number') return a.kind === 'complex' ? cmul(a, b) : scale(a, b);
    if (a.kind === 'complex' || b.kind === 'complex') {
        if (a.kind === 'complex' && b.kind === 'complex') return cmul(a, b);
        // A real number written as a complex one (e^{i·0}) still scales.
        const k = a.kind === 'complex' ? toReal(a) : toReal(b);
        const other = a.kind === 'complex' ? b : a;
        return Number.isNaN(k) ? BAD : mul(k, other);
    }
    if (a.kind === 'vec' && b.kind === 'vec') return dot(a, b);
    if (a.kind === 'mat' && b.kind === 'vec') {
        const v = matVec(a, b.v);
        return v ? vec(v) : BAD;
    }
    if (a.kind === 'vec' && b.kind === 'mat') {
        const v = vecMat(a.v, b);
        return v ? vec(v) : BAD;
    }
    if (a.kind === 'mat' && b.kind === 'mat') return matMul(a, b) ?? BAD;
    return BAD;
}

/** Division by a number or a complex number. */
export function div(a: Value, b: Value): Value {
    if (typeof a === 'number' && typeof b === 'number') return a / b;
    const over = overLists(a, b, div);
    if (over !== null) return over;
    if (typeof b !== 'number' && b.kind !== 'complex') return BAD;
    if (typeof a === 'number' || a.kind === 'complex') return cdiv(a, b);
    if (a.kind === 'list') return BAD;
    const k = toReal(b);
    return Number.isNaN(k) ? BAD : scale(a, 1 / k);
}

/** a^b: numbers as Math.pow, complex powers, whole powers of a square matrix (A^{-1} is its inverse). */
export function pow(a: Value, b: Value): Value {
    if (typeof a === 'number' && typeof b === 'number') return Math.pow(a, b);
    const over = overLists(a, b, pow);
    if (over !== null) return over;
    if ((typeof a === 'number' || a.kind === 'complex') && (typeof b === 'number' || b.kind === 'complex')) return cpow(a, b);
    if (typeof a !== 'number' && a.kind === 'mat') {
        const k = toReal(b);
        return Number.isNaN(k) ? BAD : (matPow(a, k) ?? BAD);
    }
    return BAD;
}

/** |a|: the absolute value, the modulus of a complex number, the length of a vector, the determinant of a matrix. */
export function abs(a: Value): Value {
    if (typeof a === 'number') return Math.abs(a);
    switch (a.kind) {
        case 'complex':
            return Math.hypot(a.re, a.im);
        case 'vec':
            return Math.hypot(...a.v);
        case 'mat':
            return det(a);
        case 'list':
            return list(a.items.map(abs));
    }
}

export function transposeOf(a: Value): Value {
    if (typeof a === 'number') return a;
    if (a.kind === 'mat') return transpose(a);
    if (a.kind === 'vec') return a;
    if (a.kind === 'list') return list(a.items.map(transposeOf));
    return BAD;
}

// --------------------------------------------------------------- functions

/** A real function over a value: numbers as they are, complex numbers on the real axis, lists item by item. */
export function realFunction(fn: (...args: number[]) => number, args: Value[]): Value {
    for (let at = 0; at < args.length; at++) {
        const l = args[at];
        if (typeof l !== 'number' && l.kind === 'list') return list(l.items.map((item) => realFunction(fn, args.map((a, i) => (i === at ? item : a)))));
    }
    const nums = args.map(toReal);
    return nums.some((n, i) => Number.isNaN(n) && typeof args[i] !== 'number') ? BAD : fn(...nums);
}

/** One of COMPLEX_FUNCTIONS of a value: real numbers stay on the real function when it is defined there. */
export function complexFunction(name: string, real: (v: number) => number, a: Value): Value {
    if (typeof a === 'number') return real(a);
    if (a.kind === 'list') return list(a.items.map((x) => complexFunction(name, real, x)));
    if (a.kind !== 'complex') return BAD;
    const f = Object.prototype.hasOwnProperty.call(COMPLEX_FUNCTIONS, name) ? COMPLEX_FUNCTIONS[name] : null;
    return f ? f(a) : BAD;
}

/** The functions of values (beyond the builtins of src/expr.ts), by name: their argument counts and what they do. */
export const VALUE_FUNCTIONS: Record<string, { min: number; max: number; fn: (args: Value[]) => Value }> = {
    re: { min: 1, max: 1, fn: ([z]) => map1(z, (v) => (typeof v === 'number' ? v : v.kind === 'complex' ? v.re : BAD)) },
    im: { min: 1, max: 1, fn: ([z]) => map1(z, (v) => (typeof v === 'number' ? 0 : v.kind === 'complex' ? v.im : BAD)) },
    conj: { min: 1, max: 1, fn: ([z]) => map1(z, (v) => (typeof v === 'number' ? v : v.kind === 'complex' ? complex(v.re, -v.im) : v)) },
    arg: {
        min: 1,
        max: 1,
        fn: ([z]) => map1(z, (v) => (typeof v === 'number' ? (v >= 0 ? 0 : Math.PI) : v.kind === 'complex' ? Math.atan2(v.im, v.re) : v.kind === 'vec' && v.v.length === 2 ? Math.atan2(v.v[1], v.v[0]) : BAD)),
    },
    norm: { min: 1, max: 1, fn: ([v]) => (typeof v !== 'number' && v.kind === 'mat' ? Math.hypot(...v.a) : abs(v)) },
    det: { min: 1, max: 1, fn: ([m]) => (typeof m !== 'number' && m.kind === 'mat' ? det(m) : BAD) },
    tr: { min: 1, max: 1, fn: ([m]) => (typeof m !== 'number' && m.kind === 'mat' ? trace(m) : BAD) },
    inv: {
        min: 1,
        max: 1,
        fn: ([m]) => {
            if (typeof m === 'number') return 1 / m;
            if (m.kind === 'complex') return cdiv(1, m);
            return m.kind === 'mat' ? (inverse(m) ?? BAD) : BAD;
        },
    },
    transpose: { min: 1, max: 1, fn: ([m]) => transposeOf(m) },
    dot: { min: 2, max: 2, fn: ([a, b]) => (typeof a !== 'number' && typeof b !== 'number' && a.kind === 'vec' && b.kind === 'vec' ? dot(a, b) : BAD) },
    cross: { min: 2, max: 2, fn: ([a, b]) => cross(a, b) },
    len: { min: 1, max: 1, fn: ([a]) => (typeof a === 'number' ? 1 : a.kind === 'list' ? a.items.length : a.kind === 'vec' ? a.v.length : BAD) },
    unit: {
        min: 1,
        max: 1,
        fn: ([a]) => {
            const n = toReal(abs(a));
            return typeof a !== 'number' && (a.kind === 'vec' || a.kind === 'complex') && n > 0 ? div(a, n) : BAD;
        },
    },
    // 6.0 ML: softmax of a vector or a list of numbers (the same kind back), and log-sum-exp; neither overflows.
    softmax: {
        min: 1,
        max: 1,
        fn: ([a]) => {
            const nums = numbersOf(a);
            if (!nums) return BAD;
            const p = softmaxOf(nums);
            return typeof a !== 'number' && a.kind === 'list' ? list(p) : vec(p);
        },
    },
    logsumexp: {
        min: 1,
        max: 1,
        fn: ([a]) => {
            const nums = numbersOf(a);
            return nums ? logSumExpOf(nums) : BAD;
        },
    },
    angle: {
        min: 2,
        max: 2,
        fn: ([a, b]) => {
            if (typeof a === 'number' || typeof b === 'number' || a.kind !== 'vec' || b.kind !== 'vec') return BAD;
            const c = dot(a, b) / (Math.hypot(...a.v) * Math.hypot(...b.v));
            return Math.acos(Math.max(-1, Math.min(1, c)));
        },
    },
};

/** 6.0 ML: the real numbers of a vector or a list of numbers, else null. */
function numbersOf(a: Value): number[] | null {
    if (typeof a === 'number') return [a];
    if (a.kind === 'vec') return a.v.slice();
    if (a.kind === 'list' && a.items.every((x) => typeof x === 'number')) return a.items.map((x) => Number(x));
    return null;
}

function map1(a: Value, f: (v: Complex | Vec | Mat | number) => Value): Value {
    if (typeof a !== 'number' && a.kind === 'list') return list(a.items.map((x) => map1(x, f)));
    return f(a);
}

/** n! and the binomial of numbers (the scalar path has the same, in src/expr.ts). */
export { binom, factorial };
