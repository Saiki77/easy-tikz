/*
 * 6.0 P: the built-in functions of chart scripts (len, range, zip, sum,
 * sorted, print, ...), the exception types, and the modules math, cmath
 * and random (seeded: every run starts from seed 0). Pure: no DOM, no
 * Obsidian.
 */
import { PyError, pyErrorText, typeError, valueError } from './errors';
import { arg, binop, callValue, cdiv, compare, getattr, intArg, lessThan, sortValues } from './ops';
import { formatSpec } from './format';
import { arrayAttr, toArray } from './ndarray';
import { work } from './budget';
import {
    Kwargs,
    MAX_ITEMS,
    NDArray,
    PyBuiltin,
    PyComplex,
    PyDict,
    PyException,
    PyExceptionType,
    PyFunction,
    PyModule,
    PyRange,
    PySet,
    PySlice,
    PyTuple,
    PyValue,
    iterate,
    length,
    repr,
    str,
    truthy,
    typeName,
} from './values';

const fn = (name: string, f: (args: PyValue[], kw: Kwargs | null) => PyValue) => new PyBuiltin(name, f);

export function num(v: PyValue, what = 'number'): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof NDArray && v.size === 1 && v.dtype !== 'complex') return v.data[0];
    throw typeError('python.type.needNumber', { what, type: typeName(v) });
}

export function complexOf(v: PyValue): PyComplex {
    if (v instanceof PyComplex) return v;
    if (v instanceof NDArray && v.size === 1) return new PyComplex(v.data[0], v.imag ? v.imag[0] : 0);
    return new PyComplex(num(v), 0);
}

// ------------------------------------------------------------ exceptions

export function exceptionTypes(): Map<string, PyExceptionType> {
    const base = new PyExceptionType('BaseException', null);
    const exc = new PyExceptionType('Exception', base);
    const arith = new PyExceptionType('ArithmeticError', exc);
    const lookup = new PyExceptionType('LookupError', exc);
    const runtime = new PyExceptionType('RuntimeError', exc);
    const name = new PyExceptionType('NameError', exc);
    const value = new PyExceptionType('ValueError', exc);
    const types = [
        base,
        exc,
        arith,
        lookup,
        runtime,
        name,
        value,
        new PyExceptionType('ZeroDivisionError', arith),
        new PyExceptionType('OverflowError', arith),
        new PyExceptionType('FloatingPointError', arith),
        new PyExceptionType('IndexError', lookup),
        new PyExceptionType('KeyError', lookup),
        new PyExceptionType('TypeError', exc),
        new PyExceptionType('AttributeError', exc),
        new PyExceptionType('ImportError', exc),
        new PyExceptionType('ModuleNotFoundError', exc),
        new PyExceptionType('AssertionError', exc),
        new PyExceptionType('StopIteration', exc),
        new PyExceptionType('NotImplementedError', runtime),
        new PyExceptionType('RecursionError', runtime),
        new PyExceptionType('UnboundLocalError', name),
        new PyExceptionType('MemoryError', exc),
        new PyExceptionType('AxisError', value),
        new PyExceptionType('LinAlgError', value),
        new PyExceptionType('SyntaxError', exc),
    ];
    return new Map(types.map((t) => [t.name, t]));
}

// ------------------------------------------------------------ helpers

function range(args: PyValue[]): PyRange {
    const ints = args.map(intArg);
    if (ints.length === 1) return new PyRange(0, ints[0], 1);
    if (ints.length === 2) return new PyRange(ints[0], ints[1], 1);
    if (ints.length === 3) {
        if (ints[2] === 0) throw valueError('python.value.rangeStep');
        return new PyRange(ints[0], ints[1], ints[2]);
    }
    throw typeError('python.call.args', { name: 'range', min: 1, max: 3, got: args.length });
}

function minMax(name: 'min' | 'max', args: PyValue[], kw: Kwargs | null): PyValue {
    const items = args.length === 1 ? iterate(args[0]) : args;
    const key = kw?.get('key');
    if (!items.length) {
        const d = kw?.get('default');
        if (d !== undefined) return d;
        throw valueError('python.value.emptyMinMax', { name });
    }
    let best = items[0];
    let bestKey = key ? callValue(key, [best]) : best;
    for (let i = 1; i < items.length; i++) {
        const k = key ? callValue(key, [items[i]]) : items[i];
        if (name === 'min' ? lessThan(k, bestKey) : lessThan(bestKey, k)) {
            best = items[i];
            bestKey = k;
        }
    }
    return best;
}

function sumOf(args: PyValue[], kw: Kwargs | null): PyValue {
    const items = iterate(args[0] ?? []);
    let total: PyValue = arg(args, kw, 1, 'start', 0);
    // Numbers add without objects.
    if (typeof total === 'number' && items.every((x) => typeof x === 'number')) {
        let s = total;
        for (const x of items) s += Number(x);
        return s;
    }
    for (const x of items) total = binop('+', total, x);
    return total;
}

function roundHalfEven(x: number, digits: number): number {
    const m = 10 ** digits;
    const y = x * m;
    const r = Math.round(y);
    // Python rounds halves to even.
    const out = Math.abs(y - Math.trunc(y)) === 0.5 ? 2 * Math.round(y / 2) : r;
    return out / m;
}

function intOfValue(v: PyValue, base?: PyValue): number {
    if (typeof v === 'string') {
        const b = base === undefined || base === null ? 10 : num(base);
        const t = v.trim().replace(/_/g, '');
        const n = parseInt(t, b);
        if (!/^[+-]?[0-9a-zA-Z]+$/.test(t) || Number.isNaN(n)) throw valueError('python.value.badInt', { text: v });
        return n;
    }
    if (v instanceof PyComplex) throw typeError('python.type.complexToInt');
    const x = num(v);
    if (!Number.isFinite(x)) throw valueError('python.value.intOfInf');
    return Math.trunc(x);
}

function floatOfValue(v: PyValue): number {
    if (typeof v === 'string') {
        const t = v.trim().toLowerCase();
        if (t === 'inf' || t === '+inf' || t === 'infinity') return Infinity;
        if (t === '-inf' || t === '-infinity') return -Infinity;
        if (t === 'nan') return NaN;
        const x = Number(t);
        if (!t || Number.isNaN(x)) throw valueError('python.value.badFloat', { text: v });
        return x;
    }
    if (v instanceof PyComplex) throw typeError('python.type.complexToFloat');
    return num(v);
}

function complexOfValue(args: PyValue[]): PyComplex {
    if (!args.length) return new PyComplex(0, 0);
    const a = args[0];
    if (typeof a === 'string') {
        const t = a.replace(/\s+/g, '').replace(/^\((.*)\)$/, '$1');
        const m = /^([+-]?[0-9.eE+-]*?)?(?:([+-]?[0-9.eE]*)j)?$/.exec(t);
        if (!m) throw valueError('python.value.badComplex', { text: a });
        const re = m[1] ? Number(m[1]) : 0;
        const im = m[2] !== undefined ? (m[2] === '' || m[2] === '+' ? 1 : m[2] === '-' ? -1 : Number(m[2])) : 0;
        if (Number.isNaN(re) || Number.isNaN(im)) throw valueError('python.value.badComplex', { text: a });
        return new PyComplex(re, im);
    }
    const re = complexOf(a);
    const im = args.length > 1 ? complexOf(args[1]) : new PyComplex(0, 0);
    return new PyComplex(re.re - im.im, re.im + im.re);
}

function isInstance(v: PyValue, t: PyValue): boolean {
    if (t instanceof PyTuple) return t.items.some((x) => isInstance(v, x));
    if (t instanceof PyExceptionType) return v instanceof PyException && v.type.isA(t);
    const name = t instanceof PyBuiltin ? t.name : '';
    switch (name) {
        case 'int':
            return (typeof v === 'number' && Number.isInteger(v)) || typeof v === 'boolean';
        case 'float':
            return typeof v === 'number';
        case 'complex':
            return v instanceof PyComplex;
        case 'bool':
            return typeof v === 'boolean';
        case 'str':
            return typeof v === 'string';
        case 'list':
            return Array.isArray(v);
        case 'tuple':
            return v instanceof PyTuple;
        case 'dict':
            return v instanceof PyDict;
        case 'set':
            return v instanceof PySet;
        case 'range':
            return v instanceof PyRange;
        case 'ndarray':
            return v instanceof NDArray;
    }
    return false;
}

function zip(args: PyValue[]): PyValue[] {
    const lists = args.map(iterate);
    const n = lists.length ? Math.min(...lists.map((l) => l.length)) : 0;
    const out: PyValue[] = [];
    for (let i = 0; i < n; i++) out.push(new PyTuple(lists.map((l) => l[i])));
    return out;
}

// ------------------------------------------------------------ the builtins

/** The builtins of a run; `print` hands each printed line to the host. */
export function makeBuiltins(print: (line: string) => void, exceptions: Map<string, PyExceptionType>): Map<string, PyValue> {
    const b = new Map<string, PyValue>();
    const def = (name: string, f: (args: PyValue[], kw: Kwargs | null) => PyValue) => b.set(name, fn(name, f));
    def('print', (args, kw) => {
        const sep = kw?.has('sep') ? str(kw.get('sep') ?? ' ') : ' ';
        const end = kw?.has('end') ? str(kw.get('end') ?? '') : '';
        print(args.map(str).join(sep) + (end === '\n' ? '' : end));
        return null;
    });
    def('len', (args) => length(args[0] ?? null));
    def('range', range);
    def('enumerate', (args, kw) => {
        const start = num(arg(args, kw, 1, 'start', 0));
        return iterate(args[0] ?? []).map((x, i) => new PyTuple([i + start, x]));
    });
    def('zip', zip);
    def('map', (args) => {
        const f = args[0];
        if (args.length === 2) return iterate(args[1]).map((x) => callValue(f, [x]));
        return zip(args.slice(1)).map((t) => callValue(f, (t as PyTuple).items));
    });
    def('filter', (args) => {
        const f = args[0];
        return iterate(args[1] ?? []).filter((x) => truthy(f === null ? x : callValue(f, [x])));
    });
    def('sum', sumOf);
    def('min', (args, kw) => minMax('min', args, kw));
    def('max', (args, kw) => minMax('max', args, kw));
    def('abs', (args) => {
        const v = args[0] ?? null;
        if (v instanceof PyComplex) return Math.hypot(v.re, v.im);
        if (v instanceof NDArray) return ABS.fn(v);
        return Math.abs(num(v));
    });
    def('round', (args, kw) => {
        const v = args[0] ?? null;
        const nd = arg(args, kw, 1, 'ndigits', null);
        if (v instanceof NDArray) {
            const m = arrayAttr(v, 'round');
            return m ? callValue(m, nd === null ? [] : [nd]) : v;
        }
        const x = num(v);
        if (nd === null) return roundHalfEven(x, 0);
        return roundHalfEven(x, intArg(nd));
    });
    def('sorted', (args, kw) => sortValues(iterate(args[0] ?? []).slice(), kw));
    def('reversed', (args) => iterate(args[0] ?? []).slice().reverse());
    def('list', (args) => (args.length ? iterate(args[0]).slice() : []));
    def('tuple', (args) => new PyTuple(args.length ? iterate(args[0]).slice() : []));
    def('set', (args) => new PySet(args.length ? iterate(args[0]) : []));
    def('frozenset', (args) => new PySet(args.length ? iterate(args[0]) : []));
    def('dict', (args, kw) => {
        const d = new PyDict();
        const src = args[0];
        if (src instanceof PyDict) for (const [k, v] of src.map.values()) d.set(k, v);
        else if (src !== undefined && src !== null) for (const pair of iterate(src)) {
            const kv = iterate(pair);
            if (kv.length !== 2) throw valueError('python.value.dictPair');
            d.set(kv[0], kv[1]);
        }
        if (kw) for (const [k, v] of kw) d.set(k, v);
        return d;
    });
    def('float', (args) => (args.length ? floatOfValue(args[0]) : 0));
    def('int', (args, kw) => (args.length ? intOfValue(args[0], arg(args, kw, 1, 'base', null)) : 0));
    def('complex', complexOfValue);
    def('bool', (args) => (args.length ? truthy(args[0]) : false));
    def('str', (args) => (args.length ? str(args[0]) : ''));
    def('repr', (args) => repr(args[0] ?? null));
    def('format', (args) => formatSpec(args[0] ?? null, args.length > 1 ? str(args[1]) : ''));
    def('isinstance', (args) => isInstance(args[0] ?? null, args[1] ?? null));
    def('type', (args) => fn(typeName(args[0] ?? null), () => null));
    def('any', (args) => iterate(args[0] ?? []).some(truthy));
    def('all', (args) => iterate(args[0] ?? []).every(truthy));
    def('divmod', (args) => {
        const a = num(args[0] ?? null);
        const c = num(args[1] ?? null);
        return new PyTuple([binop('//', a, c), binop('%', a, c)]);
    });
    def('pow', (args) => {
        const r = binop('**', args[0] ?? null, args[1] ?? null);
        return args.length > 2 ? binop('%', r, args[2]) : r;
    });
    def('chr', (args) => String.fromCodePoint(intArg(args[0] ?? 0)));
    def('ord', (args) => {
        const s = str(args[0] ?? '');
        if ([...s].length !== 1) throw typeError('python.type.ordOne');
        return s.codePointAt(0) ?? 0;
    });
    def('hex', (args) => {
        const x = intArg(args[0] ?? 0);
        return (x < 0 ? '-0x' : '0x') + Math.abs(x).toString(16);
    });
    def('bin', (args) => {
        const x = intArg(args[0] ?? 0);
        return (x < 0 ? '-0b' : '0b') + Math.abs(x).toString(2);
    });
    def('callable', (args) => args[0] instanceof PyFunction || args[0] instanceof PyBuiltin || args[0] instanceof PyExceptionType);
    def('hasattr', (args) => {
        try {
            getattrOf(args[0] ?? null, str(args[1] ?? ''));
            return true;
        } catch {
            return false;
        }
    });
    def('getattr', (args) => {
        try {
            return getattrOf(args[0] ?? null, str(args[1] ?? ''));
        } catch (e) {
            if (args.length > 2) return args[2];
            throw e;
        }
    });
    def('iter', (args) => iterate(args[0] ?? []).slice());
    def('next', (args) => {
        const l = args[0];
        if (Array.isArray(l) && l.length) return l.shift() ?? null;
        if (args.length > 1) return args[1];
        throw pyErrorText('StopIteration', '');
    });
    def('slice', (args) => {
        if (args.length === 1) return new PySlice(null, args[0], null);
        return new PySlice(args[0] ?? null, args[1] ?? null, args[2] ?? null);
    });
    def('id', (args) => {
        const v = args[0];
        return typeof v === 'number' ? v : 1;
    });
    def('hash', (args) => {
        const v = args[0] ?? null;
        if (typeof v === 'number') return v;
        return str(v).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
    });
    for (const [name, t] of exceptions) b.set(name, t);
    b.set('NotImplemented', null);
    b.set('Ellipsis', null);
    return b;
}

function getattrOf(v: PyValue, name: string): PyValue {
    return getattr(v, name);
}

/** np.abs, set by numpy.ts (abs() of an array). */
export const ABS: { fn: (a: NDArray) => PyValue } = { fn: (a) => a };

// ------------------------------------------------------------ math and cmath

const real1 = (name: string, f: (x: number) => number) =>
    fn(name, (args) => {
        const x = num(args[0] ?? null, name);
        const r = f(x);
        if (Number.isNaN(r) && !Number.isNaN(x)) throw valueError('python.math.domain', { name });
        return r;
    });

function factorial(n: number): number {
    if (!Number.isInteger(n) || n < 0) throw valueError('python.math.factorial');
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
}

function gcd(a: number, b: number): number {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) [a, b] = [b, a % b];
    return a;
}

export function mathModule(): PyModule {
    const m = new Map<string, PyValue>();
    m.set('pi', Math.PI);
    m.set('e', Math.E);
    m.set('tau', 2 * Math.PI);
    m.set('inf', Infinity);
    m.set('nan', NaN);
    const one: Array<[string, (x: number) => number]> = [
        ['sin', Math.sin],
        ['cos', Math.cos],
        ['tan', Math.tan],
        ['asin', Math.asin],
        ['acos', Math.acos],
        ['atan', Math.atan],
        ['sinh', Math.sinh],
        ['cosh', Math.cosh],
        ['tanh', Math.tanh],
        ['asinh', Math.asinh],
        ['acosh', Math.acosh],
        ['atanh', Math.atanh],
        ['exp', Math.exp],
        ['expm1', Math.expm1],
        ['log10', Math.log10],
        ['log2', Math.log2],
        ['log1p', Math.log1p],
        ['sqrt', Math.sqrt],
        ['fabs', Math.abs],
        ['degrees', (x) => (x * 180) / Math.PI],
        ['radians', (x) => (x * Math.PI) / 180],
        ['erf', erf],
        ['erfc', (x) => 1 - erf(x)],
        ['gamma', gammaFn],
        ['lgamma', (x) => Math.log(Math.abs(gammaFn(x)))],
        ['cbrt', Math.cbrt],
    ];
    for (const [name, f] of one) m.set(name, real1(name, f));
    m.set('floor', fn('floor', (a) => Math.floor(num(a[0] ?? null))));
    m.set('ceil', fn('ceil', (a) => Math.ceil(num(a[0] ?? null))));
    m.set('trunc', fn('trunc', (a) => Math.trunc(num(a[0] ?? null))));
    m.set('log', fn('log', (a) => {
        const x = num(a[0] ?? null);
        if (x <= 0) throw valueError('python.math.domain', { name: 'log' });
        return a.length > 1 ? Math.log(x) / Math.log(num(a[1])) : Math.log(x);
    }));
    m.set('pow', fn('pow', (a) => num(a[0] ?? null) ** num(a[1] ?? null)));
    m.set('atan2', fn('atan2', (a) => Math.atan2(num(a[0] ?? null), num(a[1] ?? null))));
    m.set('hypot', fn('hypot', (a) => Math.hypot(...a.map((x) => num(x)))));
    m.set('dist', fn('dist', (a) => {
        const p = iterate(a[0] ?? []).map((x) => num(x));
        const q = iterate(a[1] ?? []).map((x) => num(x));
        return Math.hypot(...p.map((x, i) => x - (q[i] ?? 0)));
    }));
    m.set('factorial', fn('factorial', (a) => factorial(num(a[0] ?? null))));
    m.set('comb', fn('comb', (a) => {
        const n = num(a[0] ?? null);
        const k = num(a[1] ?? null);
        if (k < 0 || k > n) return 0;
        let r = 1;
        for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
        return Math.round(r);
    }));
    m.set('perm', fn('perm', (a) => {
        const n = num(a[0] ?? null);
        const k = a.length > 1 ? num(a[1]) : n;
        let r = 1;
        for (let i = 0; i < k; i++) r *= n - i;
        return r;
    }));
    m.set('gcd', fn('gcd', (a) => a.map((x) => intArg(x)).reduce(gcd, 0)));
    m.set('isclose', fn('isclose', (a, kw) => {
        const x = num(a[0] ?? null);
        const y = num(a[1] ?? null);
        const rel = num(arg(a, kw, 2, 'rel_tol', 1e-9));
        const abs = num(arg(a, kw, 3, 'abs_tol', 0));
        return Math.abs(x - y) <= Math.max(rel * Math.max(Math.abs(x), Math.abs(y)), abs);
    }));
    m.set('isnan', fn('isnan', (a) => Number.isNaN(num(a[0] ?? null))));
    m.set('isinf', fn('isinf', (a) => {
        const x = num(a[0] ?? null);
        return x === Infinity || x === -Infinity;
    }));
    m.set('isfinite', fn('isfinite', (a) => Number.isFinite(num(a[0] ?? null))));
    m.set('copysign', fn('copysign', (a) => Math.abs(num(a[0] ?? null)) * (num(a[1] ?? null) < 0 || Object.is(num(a[1] ?? null), -0) ? -1 : 1)));
    m.set('fmod', fn('fmod', (a) => num(a[0] ?? null) % num(a[1] ?? null)));
    m.set('prod', fn('prod', (a) => iterate(a[0] ?? []).reduce<PyValue>((p, x) => binop('*', p, x), 1)));
    m.set('fsum', fn('fsum', (a) => iterate(a[0] ?? []).reduce<number>((p, x) => p + num(x), 0)));
    return new PyModule('math', m);
}

export function erf(x: number): number {
    // Abramowitz and Stegun 7.1.26, refined: good to about 1e-7.
    const s = x < 0 ? -1 : 1;
    const a = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * a);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return s * y;
}

export function gammaFn(x: number): number {
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    const z = x - 1;
    let s = c[0];
    for (let i = 1; i < g + 2; i++) s += c[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * s;
}

export const cexp = (z: PyComplex): PyComplex => {
    const m = Math.exp(z.re);
    return new PyComplex(m * Math.cos(z.im), m * Math.sin(z.im));
};
export const clog = (z: PyComplex): PyComplex => new PyComplex(Math.log(Math.hypot(z.re, z.im)), Math.atan2(z.im, z.re));
export function csqrt(z: PyComplex): PyComplex {
    const r = Math.hypot(z.re, z.im);
    const re = Math.sqrt((r + z.re) / 2);
    const im = Math.sqrt(Math.max(0, (r - z.re) / 2));
    return new PyComplex(re, z.im < 0 || (z.im === 0 && Object.is(z.im, -0)) ? -im : im);
}
export const csin = (z: PyComplex): PyComplex => new PyComplex(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));
export const ccos = (z: PyComplex): PyComplex => new PyComplex(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));

export function cmathModule(): PyModule {
    const m = new Map<string, PyValue>();
    m.set('pi', Math.PI);
    m.set('e', Math.E);
    m.set('tau', 2 * Math.PI);
    m.set('inf', Infinity);
    m.set('nan', NaN);
    m.set('infj', new PyComplex(0, Infinity));
    const c1 = (name: string, f: (z: PyComplex) => PyComplex) => m.set(name, fn(name, (a) => f(complexOf(a[0] ?? null))));
    c1('exp', cexp);
    c1('log', clog);
    c1('sqrt', csqrt);
    c1('sin', csin);
    c1('cos', ccos);
    c1('tan', (z) => cdiv(csin(z), ccos(z)));
    c1('sinh', (z) => new PyComplex(Math.sinh(z.re) * Math.cos(z.im), Math.cosh(z.re) * Math.sin(z.im)));
    c1('cosh', (z) => new PyComplex(Math.cosh(z.re) * Math.cos(z.im), Math.sinh(z.re) * Math.sin(z.im)));
    c1('log10', (z) => {
        const l = clog(z);
        return new PyComplex(l.re / Math.LN10, l.im / Math.LN10);
    });
    m.set('phase', fn('phase', (a) => {
        const z = complexOf(a[0] ?? null);
        return Math.atan2(z.im, z.re);
    }));
    m.set('polar', fn('polar', (a) => {
        const z = complexOf(a[0] ?? null);
        return new PyTuple([Math.hypot(z.re, z.im), Math.atan2(z.im, z.re)]);
    }));
    m.set('rect', fn('rect', (a) => {
        const r = num(a[0] ?? null);
        const t = num(a[1] ?? null);
        return new PyComplex(r * Math.cos(t), r * Math.sin(t));
    }));
    m.set('isclose', fn('isclose', (a, kw) => {
        const x = complexOf(a[0] ?? null);
        const y = complexOf(a[1] ?? null);
        const rel = num(arg(a, kw, 2, 'rel_tol', 1e-9));
        const abs = num(arg(a, kw, 3, 'abs_tol', 0));
        const d = Math.hypot(x.re - y.re, x.im - y.im);
        return d <= Math.max(rel * Math.max(Math.hypot(x.re, x.im), Math.hypot(y.re, y.im)), abs);
    }));
    return new PyModule('cmath', m);
}

// ------------------------------------------------------------ random

/** A seeded generator (mulberry32) with Gaussian numbers (Box-Muller). */
export class Rng {
    private s: number;
    private spare: number | null = null;

    constructor(seed = 0) {
        this.s = seed >>> 0;
    }

    seed(seed: number): void {
        this.s = (Math.trunc(seed) ^ 0x9e3779b9) >>> 0;
        this.spare = null;
    }

    next(): number {
        let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    gauss(): number {
        if (this.spare !== null) {
            const s = this.spare;
            this.spare = null;
            return s;
        }
        let u = 0;
        while (u === 0) u = this.next();
        const v = this.next();
        const r = Math.sqrt(-2 * Math.log(u));
        this.spare = r * Math.sin(2 * Math.PI * v);
        return r * Math.cos(2 * Math.PI * v);
    }

    int(lo: number, hi: number): number {
        return lo + Math.floor(this.next() * (hi - lo));
    }
}

export function randomModule(rng: Rng): PyModule {
    const m = new Map<string, PyValue>();
    m.set('seed', fn('seed', (a) => {
        rng.seed(a.length && a[0] !== null ? num(a[0]) : 0);
        return null;
    }));
    m.set('random', fn('random', () => rng.next()));
    m.set('uniform', fn('uniform', (a) => {
        const lo = num(a[0] ?? 0);
        const hi = num(a[1] ?? 1);
        return lo + (hi - lo) * rng.next();
    }));
    m.set('randint', fn('randint', (a) => rng.int(intArg(a[0] ?? 0), intArg(a[1] ?? 0) + 1)));
    m.set('randrange', fn('randrange', (a) => {
        const r = range(a);
        return r.at(Math.floor(rng.next() * r.length));
    }));
    m.set('choice', fn('choice', (a) => {
        const items = iterate(a[0] ?? []);
        if (!items.length) throw new PyError('IndexError', 'python.index.choiceEmpty');
        return items[Math.floor(rng.next() * items.length)];
    }));
    m.set('choices', fn('choices', (a, kw) => {
        const items = iterate(a[0] ?? []);
        const k = intArg(arg(a, kw, 1, 'k', 1));
        const out: PyValue[] = [];
        for (let i = 0; i < k; i++) out.push(items[Math.floor(rng.next() * items.length)]);
        return out;
    }));
    m.set('shuffle', fn('shuffle', (a) => {
        const l = a[0];
        if (!Array.isArray(l)) throw typeError('python.type.needList', { type: typeName(l ?? null) });
        for (let i = l.length - 1; i > 0; i--) {
            const j = Math.floor(rng.next() * (i + 1));
            [l[i], l[j]] = [l[j], l[i]];
        }
        return null;
    }));
    m.set('sample', fn('sample', (a) => {
        const items = iterate(a[0] ?? []).slice();
        const k = intArg(a[1] ?? 0);
        if (k > items.length) throw valueError('python.value.sampleSize');
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(rng.next() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
        return items.slice(0, k);
    }));
    m.set('gauss', fn('gauss', (a, kw) => num(arg(a, kw, 0, 'mu', 0)) + num(arg(a, kw, 1, 'sigma', 1)) * rng.gauss()));
    m.set('normalvariate', m.get('gauss') ?? null);
    return new PyModule('random', m);
}

/** Every number of a value, for budgets of builtins that read whole arrays. */
export function countWork(v: PyValue): void {
    if (v instanceof NDArray) work(v.size);
}

export { MAX_ITEMS, compare, toArray };
