/*
 * 6.0 P: the values of a chart script and what every value can do: its
 * type name, repr and str, truth, equality, hashing for dicts and sets,
 * iteration, len. Numbers are JS numbers (a whole number prints as an int:
 * 2.0 prints as 2; docs/v6/python.md), booleans are JS booleans, None is
 * null, lists are JS arrays; complex numbers, tuples, dicts, sets, ranges,
 * slices, functions, modules and NumPy arrays have classes here. Pure: no
 * DOM, no Obsidian.
 */
import { PyError, typeError } from './errors';

export class PyComplex {
    constructor(
        readonly re: number,
        readonly im: number
    ) {}
}

export class PyTuple {
    constructor(readonly items: PyValue[]) {}
}

export class PyDict {
    readonly map = new Map<unknown, [PyValue, PyValue]>();

    get(k: PyValue): PyValue | undefined {
        const hit = this.map.get(hashKey(k));
        return hit ? hit[1] : undefined;
    }

    set(k: PyValue, v: PyValue): void {
        this.map.set(hashKey(k), [k, v]);
    }

    has(k: PyValue): boolean {
        return this.map.has(hashKey(k));
    }

    delete(k: PyValue): boolean {
        return this.map.delete(hashKey(k));
    }

    keys(): PyValue[] {
        return Array.from(this.map.values(), (e) => e[0]);
    }

    values(): PyValue[] {
        return Array.from(this.map.values(), (e) => e[1]);
    }
}

export class PySet {
    readonly map = new Map<unknown, PyValue>();

    constructor(items: readonly PyValue[] = []) {
        for (const x of items) this.add(x);
    }

    add(v: PyValue): void {
        this.map.set(hashKey(v), v);
    }

    has(v: PyValue): boolean {
        return this.map.has(hashKey(v));
    }

    items(): PyValue[] {
        return Array.from(this.map.values());
    }
}

export class PyRange {
    constructor(
        readonly start: number,
        readonly stop: number,
        readonly step: number
    ) {}

    get length(): number {
        const n = this.step > 0 ? Math.ceil((this.stop - this.start) / this.step) : Math.ceil((this.start - this.stop) / -this.step);
        return Math.max(0, n);
    }

    at(i: number): number {
        return this.start + i * this.step;
    }
}

export class PySlice {
    constructor(
        readonly start: PyValue,
        readonly stop: PyValue,
        readonly step: PyValue
    ) {}
}

export type Kwargs = Map<string, PyValue>;

/** A function of the script (def or lambda). Calls go through the interpreter (interp.ts). */
export class PyFunction {
    constructor(
        readonly name: string,
        readonly call: (args: PyValue[], kw: Kwargs | null) => PyValue
    ) {}
}

/** A function of the interpreter (len, np.sin, plt.plot, a list's append). */
export class PyBuiltin {
    constructor(
        readonly name: string,
        readonly fn: (args: PyValue[], kw: Kwargs | null) => PyValue
    ) {}
}

/** A module (np, math, plt) or an object with attributes (np.linalg, a figure, an axes). */
export class PyModule {
    constructor(
        readonly name: string,
        readonly attrs: Map<string, PyValue>,
        /** What `type(x).__name__` says ('module' for modules). */
        readonly typeName = 'module'
    ) {}
}

/** The type of an exception (ValueError, ...), callable to make one, for raise and except. */
export class PyExceptionType {
    constructor(
        readonly name: string,
        readonly parent: PyExceptionType | null
    ) {}

    isA(other: PyExceptionType): boolean {
        for (let t: PyExceptionType | null = this; t; t = t.parent) if (t === other) return true;
        return false;
    }
}

export class PyException {
    constructor(
        readonly type: PyExceptionType,
        readonly message: string
    ) {}
}

export type DType = 'float' | 'int' | 'bool' | 'complex';

/**
 * A NumPy array: C order, its numbers in `data` (and the imaginary parts in
 * `imag` for a complex array). Operations make new arrays; a slice is a
 * copy (setting items through a slice of a slice does not reach the first
 * array; docs/v6/python.md).
 */
export class NDArray {
    constructor(
        readonly shape: number[],
        readonly data: Float64Array,
        public dtype: DType,
        readonly imag: Float64Array | null = null
    ) {}

    get size(): number {
        return this.data.length;
    }

    get ndim(): number {
        return this.shape.length;
    }
}

export type PyValue =
    | number
    | boolean
    | string
    | null
    | PyComplex
    | PyValue[]
    | PyTuple
    | PyDict
    | PySet
    | PyRange
    | PySlice
    | PyFunction
    | PyBuiltin
    | PyModule
    | PyExceptionType
    | PyException
    | NDArray;

export const isNum = (v: PyValue): v is number | boolean => typeof v === 'number' || typeof v === 'boolean';

export function typeName(v: PyValue): string {
    if (v === null) return 'NoneType';
    switch (typeof v) {
        case 'number':
            return Number.isInteger(v) ? 'int' : 'float';
        case 'boolean':
            return 'bool';
        case 'string':
            return 'str';
    }
    if (Array.isArray(v)) return 'list';
    if (v instanceof PyComplex) return 'complex';
    if (v instanceof PyTuple) return 'tuple';
    if (v instanceof PyDict) return 'dict';
    if (v instanceof PySet) return 'set';
    if (v instanceof PyRange) return 'range';
    if (v instanceof PySlice) return 'slice';
    if (v instanceof PyFunction) return 'function';
    if (v instanceof PyBuiltin) return 'builtin_function_or_method';
    if (v instanceof PyModule) return v.typeName;
    if (v instanceof PyExceptionType) return 'type';
    if (v instanceof PyException) return v.type.name;
    if (v instanceof NDArray) return 'ndarray';
    return 'object';
}

// ------------------------------------------------------------ text

/** A float as Python writes it: 0.1, 1e-05, 1e+16, inf, nan; whole floats as ints (docs). */
export function floatRepr(x: number): string {
    if (Number.isNaN(x)) return 'nan';
    if (x === Infinity) return 'inf';
    if (x === -Infinity) return '-inf';
    if (Object.is(x, -0)) return '-0.0';
    const a = Math.abs(x);
    if (a !== 0 && (a >= 1e16 || a < 1e-4)) {
        const s = x.toExponential();
        const [m, e] = s.split('e');
        const exp = Number(e);
        return `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
    }
    return String(x);
}

function complexRepr(c: PyComplex): string {
    const im = `${floatRepr(c.im)}j`;
    if (c.re === 0 && !Object.is(c.re, -0)) return im;
    const sign = c.im < 0 || Object.is(c.im, -0) ? '-' : '+';
    return `(${floatRepr(c.re)}${sign}${floatRepr(Math.abs(c.im))}j)`;
}

export function strRepr(s: string): string {
    const q = s.includes("'") && !s.includes('"') ? '"' : "'";
    let out = q;
    for (const ch of s) {
        if (ch === q || ch === '\\') out += '\\' + ch;
        else if (ch === '\n') out += '\\n';
        else if (ch === '\t') out += '\\t';
        else if (ch === '\r') out += '\\r';
        else out += ch;
    }
    return out + q;
}

/** repr(v); arrays print through `arrayRepr` (ndarray.ts hands it in). */
export function repr(v: PyValue, seen: Set<unknown> = new Set()): string {
    if (v === null) return 'None';
    switch (typeof v) {
        case 'number':
            return floatRepr(v);
        case 'boolean':
            return v ? 'True' : 'False';
        case 'string':
            return strRepr(v);
    }
    if (seen.has(v)) return Array.isArray(v) ? '[...]' : '{...}';
    if (Array.isArray(v)) {
        seen.add(v);
        const s = `[${v.map((x) => repr(x, seen)).join(', ')}]`;
        seen.delete(v);
        return s;
    }
    if (v instanceof PyComplex) return complexRepr(v);
    if (v instanceof PyTuple) {
        const items = v.items.map((x) => repr(x, seen));
        return items.length === 1 ? `(${items[0]},)` : `(${items.join(', ')})`;
    }
    if (v instanceof PyDict) {
        seen.add(v);
        const s = `{${Array.from(v.map.values(), ([k, x]) => `${repr(k, seen)}: ${repr(x, seen)}`).join(', ')}}`;
        seen.delete(v);
        return s;
    }
    if (v instanceof PySet) return v.map.size ? `{${v.items().map((x) => repr(x, seen)).join(', ')}}` : 'set()';
    if (v instanceof PyRange) return v.step === 1 ? `range(${v.start}, ${v.stop})` : `range(${v.start}, ${v.stop}, ${v.step})`;
    if (v instanceof PySlice) return `slice(${repr(v.start)}, ${repr(v.stop)}, ${repr(v.step)})`;
    if (v instanceof PyFunction) return `<function ${v.name}>`;
    if (v instanceof PyBuiltin) return `<built-in function ${v.name}>`;
    if (v instanceof PyModule) return v.typeName === 'module' ? `<module '${v.name}'>` : `<${v.name}>`;
    if (v instanceof PyExceptionType) return `<class '${v.name}'>`;
    if (v instanceof PyException) return `${v.type.name}(${strRepr(v.message)})`;
    if (v instanceof NDArray) return hooks.arrayRepr(v);
    return '<object>';
}

/** str(v). */
export function str(v: PyValue): string {
    if (typeof v === 'string') return v;
    if (v instanceof PyException) return v.message;
    if (v instanceof NDArray) return hooks.arrayStr(v);
    return repr(v);
}

/** What ndarray.ts hands in, so this file needs no import of it. */
export const hooks = {
    arrayRepr: (a: NDArray): string => `array(${a.shape.join('x')})`,
    arrayStr: (a: NDArray): string => `array(${a.shape.join('x')})`,
    arrayTruth: (a: NDArray): boolean => a.size > 0,
    arrayItems: (a: NDArray): PyValue[] => Array.from(a.data),
};

// ------------------------------------------------------------ truth, equality, hash

export function truthy(v: PyValue): boolean {
    if (v === null) return false;
    switch (typeof v) {
        case 'number':
            return v !== 0;
        case 'boolean':
            return v;
        case 'string':
            return v.length > 0;
    }
    if (Array.isArray(v)) return v.length > 0;
    if (v instanceof PyTuple) return v.items.length > 0;
    if (v instanceof PyDict) return v.map.size > 0;
    if (v instanceof PySet) return v.map.size > 0;
    if (v instanceof PyRange) return v.length > 0;
    if (v instanceof PyComplex) return v.re !== 0 || v.im !== 0;
    if (v instanceof NDArray) return hooks.arrayTruth(v);
    return true;
}

/** a == b for values that are not arrays. */
export function equal(a: PyValue, b: PyValue): boolean {
    if (a === b) return typeof a !== 'number' || !Number.isNaN(a);
    if (isNum(a) && isNum(b)) return Number(a) === Number(b);
    if (a instanceof PyComplex || b instanceof PyComplex) {
        const ca = asComplexOrNull(a);
        const cb = asComplexOrNull(b);
        return !!ca && !!cb && ca.re === cb.re && ca.im === cb.im;
    }
    if (typeof a === 'string' || typeof b === 'string') return false;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
    if (a instanceof PyTuple && b instanceof PyTuple) return a.items.length === b.items.length && a.items.every((x, i) => equal(x, b.items[i]));
    if (a instanceof PyDict && b instanceof PyDict) {
        if (a.map.size !== b.map.size) return false;
        for (const [k, [, v]] of a.map) {
            const other = b.map.get(k);
            if (!other || !equal(v, other[1])) return false;
        }
        return true;
    }
    if (a instanceof PySet && b instanceof PySet) return a.map.size === b.map.size && a.items().every((x) => b.has(x));
    if (a instanceof PyRange && b instanceof PyRange) return a.start === b.start && a.stop === b.stop && a.step === b.step;
    return false;
}

function asComplexOrNull(v: PyValue): PyComplex | null {
    if (v instanceof PyComplex) return v;
    if (isNum(v)) return new PyComplex(Number(v), 0);
    return null;
}

/** The key of a value in a dict or set (1, 1.0 and True are one key; lists cannot be keys). */
export function hashKey(v: PyValue): unknown {
    if (v === null || typeof v === 'string') return v;
    if (typeof v === 'number') return Object.is(v, -0) ? 0 : v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof PyComplex) return v.im === 0 ? v.re : `\u0000c${v.re},${v.im}`;
    if (v instanceof PyTuple) return `\u0000t(${v.items.map((x) => keyText(hashKey(x))).join(',')})`;
    if (Array.isArray(v) || v instanceof PyDict || v instanceof PySet || v instanceof NDArray) throw typeError('python.type.unhashable', { type: typeName(v) });
    return v;
}

function keyText(k: unknown): string {
    if (typeof k === 'string') return k.startsWith('\u0000') ? k : `s${k.length}:${k}`;
    if (typeof k === 'number') return `n${k}`;
    if (k === null) return 'None';
    return `o${String(k)}`;
}

// ------------------------------------------------------------ iteration

/** The items of an iterable as an array (lists are handed out as they are: do not change them). */
export function iterate(v: PyValue): PyValue[] {
    if (Array.isArray(v)) return v;
    if (v instanceof PyTuple) return v.items;
    if (v instanceof PyRange) {
        const n = v.length;
        if (n > MAX_ITEMS) throw new PyError('MemoryError', 'python.budget.items', { count: MAX_ITEMS });
        const out = new Array<PyValue>(n);
        for (let i = 0; i < n; i++) out[i] = v.at(i);
        return out;
    }
    if (typeof v === 'string') return Array.from(v);
    if (v instanceof PyDict) return v.keys();
    if (v instanceof PySet) return v.items();
    if (v instanceof NDArray) return hooks.arrayItems(v);
    throw typeError('python.type.notIterable', { type: typeName(v) });
}

export function length(v: PyValue): number {
    if (Array.isArray(v)) return v.length;
    if (typeof v === 'string') return v.length;
    if (v instanceof PyTuple) return v.items.length;
    if (v instanceof PyDict) return v.map.size;
    if (v instanceof PySet) return v.map.size;
    if (v instanceof PyRange) return v.length;
    if (v instanceof NDArray) {
        if (!v.shape.length) throw typeError('python.type.noLen', { type: 'ndarray (0-d)' });
        return v.shape[0];
    }
    throw typeError('python.type.noLen', { type: typeName(v) });
}

/** At most this many items in a list, a string or an array (so a script cannot fill a phone's memory). */
export const MAX_ITEMS = 4_000_000;
