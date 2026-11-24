/*
 * 6.0 P: Python's operators on the values of a chart script: arithmetic
 * (with Python's // and %), complex numbers, strings, lists and tuples,
 * comparisons, items and slices, the methods of str, list, dict and set,
 * and calls. NumPy arrays go to ndarray.ts. Pure: no DOM, no Obsidian.
 */
import { PyError, indexError, pyErrorText, typeError, valueError } from './errors';
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
    equal,
    hashKey,
    isNum,
    iterate,
    length,
    repr,
    str,
    truthy,
    typeName,
} from './values';
import { arrayAttr, arrayBinop, arrayCompare, arrayGetitem, arraySetitem, arrayUnary, isArrayLike, toArray } from './ndarray';
import { formatSpec, percentFormat, strFormat } from './format';

// ------------------------------------------------------------ numbers

export function floorDiv(a: number, b: number): number {
    if (b === 0) throw new PyError('ZeroDivisionError', 'python.math.divZero');
    return Math.floor(a / b);
}

export function pyMod(a: number, b: number): number {
    if (b === 0) throw new PyError('ZeroDivisionError', 'python.math.modZero');
    const r = a % b;
    return r !== 0 && r < 0 !== b < 0 ? r + b : r;
}

function cx(v: PyValue): PyComplex {
    if (v instanceof PyComplex) return v;
    return new PyComplex(Number(v), 0);
}

export function cmul(a: PyComplex, b: PyComplex): PyComplex {
    return new PyComplex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

export function cdiv(a: PyComplex, b: PyComplex): PyComplex {
    const d = b.re * b.re + b.im * b.im;
    if (d === 0) throw new PyError('ZeroDivisionError', 'python.math.divZero');
    return new PyComplex((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}

export function cpow(a: PyComplex, b: PyComplex): PyComplex {
    if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 64) {
        let n = Math.abs(b.re);
        let r = new PyComplex(1, 0);
        let base = a;
        while (n > 0) {
            if (n & 1) r = cmul(r, base);
            base = cmul(base, base);
            n >>= 1;
        }
        return b.re < 0 ? cdiv(new PyComplex(1, 0), r) : r;
    }
    if (a.re === 0 && a.im === 0) return new PyComplex(0, 0);
    const lr = Math.log(Math.hypot(a.re, a.im));
    const th = Math.atan2(a.im, a.re);
    const re = b.re * lr - b.im * th;
    const im = b.re * th + b.im * lr;
    const m = Math.exp(re);
    return new PyComplex(m * Math.cos(im), m * Math.sin(im));
}

/** A complex result that is real stays a complex number (Python keeps the type). */
function complexOp(op: string, a: PyComplex, b: PyComplex): PyValue {
    switch (op) {
        case '+':
            return new PyComplex(a.re + b.re, a.im + b.im);
        case '-':
            return new PyComplex(a.re - b.re, a.im - b.im);
        case '*':
            return cmul(a, b);
        case '/':
            return cdiv(a, b);
        case '**':
            return cpow(a, b);
    }
    throw typeError('python.type.badOperand', { op, a: 'complex', b: 'complex' });
}

function numberOp(op: string, a: number, b: number): PyValue {
    switch (op) {
        case '+':
            return a + b;
        case '-':
            return a - b;
        case '*':
            return a * b;
        case '/':
            if (b === 0) throw new PyError('ZeroDivisionError', 'python.math.divZero');
            return a / b;
        case '//':
            return floorDiv(a, b);
        case '%':
            return pyMod(a, b);
        case '**':
            if (a < 0 && !Number.isInteger(b)) return cpow(new PyComplex(a, 0), new PyComplex(b, 0));
            if (a === 0 && b < 0) throw new PyError('ZeroDivisionError', 'python.math.zeroPower');
            return a ** b;
        case '&':
            return intOf(a) & intOf(b);
        case '|':
            return intOf(a) | intOf(b);
        case '^':
            return intOf(a) ^ intOf(b);
        case '<<':
            return intOf(a) * 2 ** intOf(b);
        case '>>':
            return Math.floor(intOf(a) / 2 ** intOf(b));
    }
    throw typeError('python.type.badOperand', { op, a: 'number', b: 'number' });
}

function intOf(v: number): number {
    if (!Number.isInteger(v)) throw typeError('python.type.needInt', { type: 'float' });
    return v;
}

// ------------------------------------------------------------ binary operators

export function binop(op: string, a: PyValue, b: PyValue): PyValue {
    if (typeof a === 'number' && typeof b === 'number') return numberOp(op, a, b);
    if (a instanceof NDArray || b instanceof NDArray) return arrayBinop(op, a, b);
    if (isNum(a) && isNum(b)) {
        if (typeof a === 'boolean' && typeof b === 'boolean' && (op === '&' || op === '|' || op === '^')) {
            return op === '&' ? a && b : op === '|' ? a || b : a !== b;
        }
        return numberOp(op, Number(a), Number(b));
    }
    if ((a instanceof PyComplex || isNum(a)) && (b instanceof PyComplex || isNum(b))) return complexOp(op, cx(a), cx(b));
    switch (op) {
        case '+':
            if (typeof a === 'string' && typeof b === 'string') return a + b;
            if (Array.isArray(a) && Array.isArray(b)) return checkSize(a.length + b.length) && a.concat(b);
            if (a instanceof PyTuple && b instanceof PyTuple) return new PyTuple(a.items.concat(b.items));
            break;
        case '*': {
            const seq = typeof a === 'string' || Array.isArray(a) || a instanceof PyTuple ? a : b;
            const k = seq === a ? b : a;
            if (isNum(k) && (typeof seq === 'string' || Array.isArray(seq) || seq instanceof PyTuple)) {
                const n = Math.max(0, Math.trunc(Number(k)));
                if (typeof seq === 'string') {
                    checkSize(seq.length * n);
                    return seq.repeat(n);
                }
                const items = Array.isArray(seq) ? seq : seq.items;
                checkSize(items.length * n);
                const out: PyValue[] = [];
                for (let i = 0; i < n; i++) for (const x of items) out.push(x);
                return Array.isArray(seq) ? out : new PyTuple(out);
            }
            break;
        }
        case '%':
            if (typeof a === 'string') return percentFormat(a, b);
            break;
        case '|':
            if (a instanceof PyDict && b instanceof PyDict) {
                const d = new PyDict();
                for (const [k, v] of a.map.values()) d.set(k, v);
                for (const [k, v] of b.map.values()) d.set(k, v);
                return d;
            }
            if (a instanceof PySet && b instanceof PySet) return new PySet([...a.items(), ...b.items()]);
            break;
        case '&':
            if (a instanceof PySet && b instanceof PySet) return new PySet(a.items().filter((x) => b.has(x)));
            break;
        case '-':
            if (a instanceof PySet && b instanceof PySet) return new PySet(a.items().filter((x) => !b.has(x)));
            break;
        case '@':
            if (isArrayLike(a) && isArrayLike(b)) return arrayBinop(op, toArray(a), toArray(b));
            break;
    }
    // A list with a number in arithmetic: NumPy users expect arrays, Python says no.
    throw typeError('python.type.badOperand', { op, a: typeName(a), b: typeName(b) });
}

function checkSize(n: number): true {
    if (n > MAX_ITEMS) throw new PyError('MemoryError', 'python.budget.items', { count: MAX_ITEMS });
    return true;
}

export function unary(op: string, a: PyValue): PyValue {
    if (op === 'not') return !truthy(a);
    if (typeof a === 'number') {
        if (op === '-') return -a;
        if (op === '+') return a;
        return ~intOf(a);
    }
    if (typeof a === 'boolean') return unary(op, a ? 1 : 0);
    if (a instanceof PyComplex) {
        if (op === '-') return new PyComplex(-a.re, -a.im);
        if (op === '+') return a;
    }
    if (a instanceof NDArray) return arrayUnary(op, a);
    throw typeError('python.type.badUnary', { op, type: typeName(a) });
}

// ------------------------------------------------------------ comparisons

/** a < b for numbers, strings, lists and tuples (item by item). */
export function lessThan(a: PyValue, b: PyValue): boolean {
    if (isNum(a) && isNum(b)) return Number(a) < Number(b);
    if (typeof a === 'string' && typeof b === 'string') return a < b;
    const la = Array.isArray(a) ? a : a instanceof PyTuple ? a.items : null;
    const lb = Array.isArray(b) ? b : b instanceof PyTuple ? b.items : null;
    if (la && lb && Array.isArray(a) === Array.isArray(b)) {
        for (let i = 0; i < la.length && i < lb.length; i++) {
            if (equal(la[i], lb[i])) continue;
            return lessThan(la[i], lb[i]);
        }
        return la.length < lb.length;
    }
    throw typeError('python.type.badCompare', { op: '<', a: typeName(a), b: typeName(b) });
}

export function compare(op: string, a: PyValue, b: PyValue): PyValue {
    if (typeof a === 'number' && typeof b === 'number') {
        switch (op) {
            case '<':
                return a < b;
            case '>':
                return a > b;
            case '<=':
                return a <= b;
            case '>=':
                return a >= b;
            case '==':
                return a === b;
            case '!=':
                return a !== b;
        }
    }
    if ((a instanceof NDArray || b instanceof NDArray) && op !== 'in' && op !== 'not in' && op !== 'is' && op !== 'is not') return arrayCompare(op, a, b);
    switch (op) {
        case '==':
            return equal(a, b);
        case '!=':
            return !equal(a, b);
        case '<':
            return lessThan(a, b);
        case '>':
            return lessThan(b, a);
        case '<=':
            return lessThan(a, b) || equal(a, b);
        case '>=':
            return lessThan(b, a) || equal(a, b);
        case 'is':
            return a === b || (isNum(a) && isNum(b) && typeof a === typeof b && a === b);
        case 'is not':
            return !(a === b);
        case 'in':
            return contains(b, a);
        case 'not in':
            return !contains(b, a);
    }
    throw typeError('python.type.badCompare', { op, a: typeName(a), b: typeName(b) });
}

export function contains(container: PyValue, item: PyValue): boolean {
    if (typeof container === 'string') {
        if (typeof item !== 'string') throw typeError('python.type.inString', { type: typeName(item) });
        return container.includes(item);
    }
    if (container instanceof PyDict) return container.has(item);
    if (container instanceof PySet) return container.has(item);
    if (container instanceof PyRange) {
        if (!isNum(item)) return false;
        const x = Number(item);
        const { start, stop, step } = container;
        if (!Number.isInteger(x)) return false;
        if (step > 0 ? x < start || x >= stop : x > start || x <= stop) return false;
        return (x - start) % step === 0;
    }
    if (container instanceof NDArray) {
        const d = container.data;
        const v = isNum(item) ? Number(item) : NaN;
        for (let i = 0; i < d.length; i++) if (d[i] === v && (!container.imag || container.imag[i] === 0)) return true;
        return false;
    }
    return iterate(container).some((x) => equal(x, item));
}

// ------------------------------------------------------------ items and slices

/** Start, stop and step of a slice over n items (Python's rules for missing and negative ends). */
export function sliceIndices(s: PySlice, n: number): [number, number, number] {
    const step = s.step === null ? 1 : intArg(s.step);
    if (step === 0) throw valueError('python.index.zeroStep');
    const fix = (v: PyValue, dflt: number, lo: number, hi: number) => {
        if (v === null) return dflt;
        let i = intArg(v);
        if (i < 0) i += n;
        return Math.max(lo, Math.min(hi, i));
    };
    if (step > 0) return [fix(s.start, 0, 0, n), fix(s.stop, n, 0, n), step];
    return [fix(s.start, n - 1, -1, n - 1), fix(s.stop, -1, -1, n - 1), step];
}

function sliceItems<T>(items: readonly T[], s: PySlice): T[] {
    const [a, b, step] = sliceIndices(s, items.length);
    const out: T[] = [];
    if (step > 0) for (let i = a; i < b; i += step) out.push(items[i]);
    else for (let i = a; i > b; i += step) out.push(items[i]);
    return out;
}

export function intArg(v: PyValue): number {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number' && Number.isInteger(v)) return v;
    if (v instanceof NDArray && v.size === 1 && v.dtype !== 'float' && v.dtype !== 'complex') return v.data[0];
    throw typeError('python.type.needInt', { type: typeName(v) });
}

function indexOf(i: PyValue, n: number, what: string): number {
    let k = intArg(i);
    if (k < 0) k += n;
    if (k < 0 || k >= n) throw indexError('python.index.outOfRange', { what });
    return k;
}

export function getitem(obj: PyValue, idx: PyValue): PyValue {
    if (Array.isArray(obj)) {
        if (idx instanceof PySlice) return sliceItems(obj, idx);
        return obj[indexOf(idx, obj.length, 'list')];
    }
    if (obj instanceof NDArray) return arrayGetitem(obj, idx);
    if (obj instanceof PyTuple) {
        if (idx instanceof PySlice) return new PyTuple(sliceItems(obj.items, idx));
        return obj.items[indexOf(idx, obj.items.length, 'tuple')];
    }
    if (typeof obj === 'string') {
        if (idx instanceof PySlice) return sliceItems(Array.from(obj), idx).join('');
        const chars = Array.from(obj);
        return chars[indexOf(idx, chars.length, 'string')];
    }
    if (obj instanceof PyDict) {
        const v = obj.get(idx);
        if (v === undefined) throw new PyError('KeyError', null, {}, 0, 0, repr(idx));
        return v;
    }
    if (obj instanceof PyRange) {
        if (idx instanceof PySlice) {
            const [a, b, step] = sliceIndices(idx, obj.length);
            return new PyRange(obj.at(a), obj.at(b), obj.step * step);
        }
        return obj.at(indexOf(idx, obj.length, 'range'));
    }
    throw typeError('python.type.notSubscriptable', { type: typeName(obj) });
}

export function setitem(obj: PyValue, idx: PyValue, v: PyValue): void {
    if (Array.isArray(obj)) {
        if (idx instanceof PySlice) {
            const [a, b, step] = sliceIndices(idx, obj.length);
            const items = iterate(v).slice();
            if (step === 1) {
                obj.splice(a, Math.max(0, b - a), ...items);
                return;
            }
            const spots: number[] = [];
            if (step > 0) for (let i = a; i < b; i += step) spots.push(i);
            else for (let i = a; i > b; i += step) spots.push(i);
            if (spots.length !== items.length) throw valueError('python.index.sliceSize', { want: spots.length, got: items.length });
            spots.forEach((s, i) => (obj[s] = items[i]));
            return;
        }
        obj[indexOf(idx, obj.length, 'list')] = v;
        return;
    }
    if (obj instanceof NDArray) return arraySetitem(obj, idx, v);
    if (obj instanceof PyDict) return obj.set(idx, v);
    throw typeError('python.type.noItemSet', { type: typeName(obj) });
}

export function delitem(obj: PyValue, idx: PyValue): void {
    if (Array.isArray(obj)) {
        if (idx instanceof PySlice) {
            const [a, b, step] = sliceIndices(idx, obj.length);
            const drop = new Set<number>();
            if (step > 0) for (let i = a; i < b; i += step) drop.add(i);
            else for (let i = a; i > b; i += step) drop.add(i);
            const keep = obj.filter((_, i) => !drop.has(i));
            obj.length = 0;
            obj.push(...keep);
            return;
        }
        obj.splice(indexOf(idx, obj.length, 'list'), 1);
        return;
    }
    if (obj instanceof PyDict) {
        if (!obj.delete(idx)) throw new PyError('KeyError', null, {}, 0, 0, repr(idx));
        return;
    }
    throw typeError('python.type.noItemDelete', { type: typeName(obj) });
}

// ------------------------------------------------------------ calls

export function callValue(f: PyValue, args: PyValue[], kw: Kwargs | null = null): PyValue {
    if (f instanceof PyFunction) return f.call(args, kw);
    if (f instanceof PyBuiltin) return f.fn(args, kw);
    if (f instanceof PyExceptionType) return new PyException(f, args.length ? str(args[0]) : '');
    throw typeError('python.type.notCallable', { type: typeName(f) });
}

/** A builtin's keyword argument (or the positional one at `pos`), else the default. */
export function arg(args: PyValue[], kw: Kwargs | null, pos: number, name: string, dflt: PyValue): PyValue {
    if (kw && kw.has(name)) return kw.get(name) ?? null;
    return pos >= 0 && pos < args.length ? args[pos] : dflt;
}

function method(name: string, fn: (args: PyValue[], kw: Kwargs | null) => PyValue): PyBuiltin {
    return new PyBuiltin(name, fn);
}

function sortKey(kw: Kwargs | null): ((v: PyValue) => PyValue) | null {
    const key = kw?.get('key');
    if (key === undefined || key === null) return null;
    return (v) => callValue(key, [v]);
}

/** Sort values as Python's sorted() does (stable; key= and reverse=). */
export function sortValues(items: PyValue[], kw: Kwargs | null): PyValue[] {
    const key = sortKey(kw);
    const rev = truthy(kw?.get('reverse') ?? false);
    const keyed = items.map((v, i) => ({ v, k: key ? key(v) : v, i }));
    keyed.sort((a, b) => {
        const c = lessThan(a.k, b.k) ? -1 : lessThan(b.k, a.k) ? 1 : 0;
        return (rev ? -c : c) || a.i - b.i;
    });
    return keyed.map((e) => e.v);
}

const STRIP_DEFAULT = ' \t\n\r\f\v';

function strip(s: string, chars: PyValue, left: boolean, right: boolean): string {
    const set = typeof chars === 'string' ? chars : STRIP_DEFAULT;
    let a = 0;
    let b = s.length;
    if (left) while (a < b && set.includes(s[a])) a++;
    if (right) while (b > a && set.includes(s[b - 1])) b--;
    return s.slice(a, b);
}

function strMethod(s: string, name: string): PyValue | undefined {
    switch (name) {
        case 'upper':
            return method(name, () => s.toUpperCase());
        case 'lower':
            return method(name, () => s.toLowerCase());
        case 'strip':
            return method(name, (a) => strip(s, a[0] ?? null, true, true));
        case 'lstrip':
            return method(name, (a) => strip(s, a[0] ?? null, true, false));
        case 'rstrip':
            return method(name, (a) => strip(s, a[0] ?? null, false, true));
        case 'split':
            return method(name, (a, kw) => {
                const sep = arg(a, kw, 0, 'sep', null);
                const max = arg(a, kw, 1, 'maxsplit', -1);
                const parts = sep === null ? s.trim().split(/\s+/).filter((p) => p) : s.split(str(sep));
                const m = Number(max);
                if (m >= 0 && parts.length > m + 1) return [...parts.slice(0, m), parts.slice(m).join(sep === null ? ' ' : str(sep))];
                return parts;
            });
        case 'join':
            return method(name, (a) =>
                iterate(a[0] ?? []).map((x) => {
                    if (typeof x !== 'string') throw typeError('python.type.joinStr', { type: typeName(x) });
                    return x;
                }).join(s)
            );
        case 'replace':
            return method(name, (a) => s.split(str(a[0] ?? '')).join(str(a[1] ?? '')));
        case 'startswith':
            return method(name, (a) => s.startsWith(str(a[0] ?? '')));
        case 'endswith':
            return method(name, (a) => s.endsWith(str(a[0] ?? '')));
        case 'find':
            return method(name, (a) => s.indexOf(str(a[0] ?? '')));
        case 'index':
            return method(name, (a) => {
                const i = s.indexOf(str(a[0] ?? ''));
                if (i < 0) throw valueError('python.value.substringNotFound');
                return i;
            });
        case 'count':
            return method(name, (a) => {
                const sub = str(a[0] ?? '');
                return sub ? s.split(sub).length - 1 : s.length + 1;
            });
        case 'format':
            return method(name, (a, kw) => strFormat(s, a, kw));
        case 'title':
            return method(name, () => s.replace(/\b\w/g, (c) => c.toUpperCase()));
        case 'capitalize':
            return method(name, () => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
        case 'isdigit':
            return method(name, () => /^[0-9]+$/.test(s));
        case 'isalpha':
            return method(name, () => /^[A-Za-z]+$/.test(s));
        case 'zfill':
            return method(name, (a) => s.padStart(Number(a[0] ?? 0), '0'));
        case 'center':
            return method(name, (a) => {
                const w = Number(a[0] ?? 0);
                const fill = str(a[1] ?? ' ');
                const left = Math.floor(Math.max(0, w - s.length) / 2);
                return (fill.repeat(left) + s).padEnd(w, fill);
            });
        case 'ljust':
            return method(name, (a) => s.padEnd(Number(a[0] ?? 0), str(a[1] ?? ' ')));
        case 'rjust':
            return method(name, (a) => s.padStart(Number(a[0] ?? 0), str(a[1] ?? ' ')));
    }
    return undefined;
}

function listMethod(l: PyValue[], name: string): PyValue | undefined {
    switch (name) {
        case 'append':
            return method(name, (a) => {
                checkSize(l.length + 1);
                l.push(a[0] ?? null);
                return null;
            });
        case 'extend':
            return method(name, (a) => {
                const items = iterate(a[0] ?? []);
                checkSize(l.length + items.length);
                l.push(...items);
                return null;
            });
        case 'insert':
            return method(name, (a) => {
                let i = intArg(a[0] ?? 0);
                if (i < 0) i = Math.max(0, i + l.length);
                l.splice(Math.min(i, l.length), 0, a[1] ?? null);
                return null;
            });
        case 'pop':
            return method(name, (a) => {
                if (!l.length) throw indexError('python.index.popEmpty');
                const i = a.length ? indexOf(a[0], l.length, 'list') : l.length - 1;
                return l.splice(i, 1)[0];
            });
        case 'remove':
            return method(name, (a) => {
                const i = l.findIndex((x) => equal(x, a[0] ?? null));
                if (i < 0) throw valueError('python.value.notInList');
                l.splice(i, 1);
                return null;
            });
        case 'index':
            return method(name, (a) => {
                const i = l.findIndex((x) => equal(x, a[0] ?? null));
                if (i < 0) throw valueError('python.value.notInList');
                return i;
            });
        case 'count':
            return method(name, (a) => l.filter((x) => equal(x, a[0] ?? null)).length);
        case 'sort':
            return method(name, (_a, kw) => {
                const sorted = sortValues(l, kw);
                l.length = 0;
                l.push(...sorted);
                return null;
            });
        case 'reverse':
            return method(name, () => {
                l.reverse();
                return null;
            });
        case 'copy':
            return method(name, () => l.slice());
        case 'clear':
            return method(name, () => {
                l.length = 0;
                return null;
            });
    }
    return undefined;
}

function dictMethod(d: PyDict, name: string): PyValue | undefined {
    switch (name) {
        case 'get':
            return method(name, (a) => d.get(a[0] ?? null) ?? a[1] ?? null);
        case 'keys':
            return method(name, () => d.keys());
        case 'values':
            return method(name, () => d.values());
        case 'items':
            return method(name, () => Array.from(d.map.values(), ([k, v]) => new PyTuple([k, v])));
        case 'pop':
            return method(name, (a) => {
                const k = a[0] ?? null;
                const v = d.get(k);
                if (v === undefined) {
                    if (a.length > 1) return a[1];
                    throw new PyError('KeyError', null, {}, 0, 0, repr(k));
                }
                d.delete(k);
                return v;
            });
        case 'update':
            return method(name, (a, kw) => {
                const other = a[0];
                if (other instanceof PyDict) for (const [k, v] of other.map.values()) d.set(k, v);
                else if (other !== undefined && other !== null) for (const pair of iterate(other)) {
                    const kv = iterate(pair);
                    d.set(kv[0], kv[1]);
                }
                if (kw) for (const [k, v] of kw) d.set(k, v);
                return null;
            });
        case 'setdefault':
            return method(name, (a) => {
                const k = a[0] ?? null;
                const v = d.get(k);
                if (v !== undefined) return v;
                d.set(k, a[1] ?? null);
                return a[1] ?? null;
            });
        case 'copy':
            return method(name, () => {
                const c = new PyDict();
                for (const [k, v] of d.map.values()) c.set(k, v);
                return c;
            });
        case 'clear':
            return method(name, () => {
                d.map.clear();
                return null;
            });
    }
    return undefined;
}

function setMethod(s: PySet, name: string): PyValue | undefined {
    switch (name) {
        case 'add':
            return method(name, (a) => {
                s.add(a[0] ?? null);
                return null;
            });
        case 'remove':
        case 'discard':
            return method(name, (a) => {
                const v = a[0] ?? null;
                if (!s.has(v) && name === 'remove') throw new PyError('KeyError', null, {}, 0, 0, repr(v));
                s.map.delete(hashKey(v));
                return null;
            });
        case 'union':
            return method(name, (a) => new PySet([...s.items(), ...a.flatMap((x) => iterate(x))]));
        case 'intersection':
            return method(name, (a) => {
                const other = new PySet(iterate(a[0] ?? []));
                return new PySet(s.items().filter((x) => other.has(x)));
            });
        case 'difference':
            return method(name, (a) => {
                const other = new PySet(iterate(a[0] ?? []));
                return new PySet(s.items().filter((x) => !other.has(x)));
            });
        case 'update':
            return method(name, (a) => {
                for (const x of a.flatMap((y) => iterate(y))) s.add(x);
                return null;
            });
    }
    return undefined;
}

export function getattr(obj: PyValue, name: string): PyValue {
    let out: PyValue | undefined;
    if (obj instanceof PyModule) out = obj.attrs.get(name);
    else if (obj instanceof NDArray) out = arrayAttr(obj, name);
    else if (typeof obj === 'string') out = strMethod(obj, name);
    else if (Array.isArray(obj)) out = listMethod(obj, name);
    else if (obj instanceof PyDict) out = dictMethod(obj, name);
    else if (obj instanceof PySet) out = setMethod(obj, name);
    else if (obj instanceof PyComplex || isNum(obj)) {
        const c = cx(obj);
        if (name === 'real') out = obj instanceof PyComplex ? c.re : Number(obj);
        else if (name === 'imag') out = obj instanceof PyComplex ? c.im : 0;
        else if (name === 'conjugate') out = method(name, () => (obj instanceof PyComplex ? new PyComplex(c.re, -c.im) : obj));
        else if (name === 'is_integer' && typeof obj === 'number') out = method(name, () => Number.isInteger(obj));
    } else if (obj instanceof PyTuple) {
        if (name === 'index') out = method(name, (a) => {
            const i = obj.items.findIndex((x) => equal(x, a[0] ?? null));
            if (i < 0) throw valueError('python.value.notInList');
            return i;
        });
        else if (name === 'count') out = method(name, (a) => obj.items.filter((x) => equal(x, a[0] ?? null)).length);
    } else if (obj instanceof PyException) {
        if (name === 'args') out = new PyTuple([obj.message]);
    } else if (obj instanceof PyFunction || obj instanceof PyBuiltin) {
        if (name === '__name__') out = obj.name;
    } else if (obj instanceof PyExceptionType) {
        if (name === '__name__') out = obj.name;
    }
    if (out === undefined) {
        if (name === '__class__' || name === '__name__') {
            if (obj instanceof PyModule && name === '__name__') return obj.name;
        }
        throw new PyError('AttributeError', 'python.attr.none', { type: typeName(obj), name });
    }
    return out;
}

export function setattr(obj: PyValue, name: string, v: PyValue): void {
    if (obj instanceof PyModule && obj.typeName !== 'module') {
        obj.attrs.set(name, v);
        return;
    }
    throw new PyError('AttributeError', 'python.attr.readOnly', { type: typeName(obj), name });
}

/** format(v, spec) and f-string fields. */
export function formatWith(v: PyValue, spec: string): string {
    return formatSpec(v, spec);
}

/** The raise of a script: an exception value or type as a PyError. */
export function raised(v: PyValue): PyError {
    if (v instanceof PyException) {
        const e = pyErrorText(v.type.name, v.message);
        return e;
    }
    if (v instanceof PyExceptionType) return pyErrorText(v.name, '');
    throw typeError('python.type.raiseWhat');
}

export { length, iterate };
