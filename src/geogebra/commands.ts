/*
 * 6.0 G: GeoGebra's commands in every formula field, compiled into the
 * value engine of part A (src/values/compile.ts calls geogebraCall after
 * the chart's own names, so a slider or function called Sum or Length
 * keeps its meaning). Names, argument orders and 1-based indices are
 * GeoGebra's: Sequence((k, k^2), k, 1, 10), IterationList(z^2 + c, z,
 * {0}, 20), KeepIf(abs(z) <= 2, z, L), Element(L, 21), Zip(...), Sum,
 * Product, Length, First, Last, Append, Join, Reverse, Sort, Max, Min,
 * Mean, Flatten, Take, Unique, CountIf, If, Vector, UnitVector, Dot,
 * Cross, Determinant, Transpose, Invert, Root, Integral, Derivative,
 * Midpoint, Distance, Translate, Rotate, Dilate, Reflect (of points),
 * Point, and x(P), y(P), z(P), conjugate, real, imaginary, sgn.
 * The commands that draw an object of their own (Circle, Segment, ...)
 * are chart lines (src/geogebra/objects.ts); in a formula they are a
 * problem that says so. Pure: no DOM, no Obsidian; no dynamic code.
 */
import { ExprError } from '../expr';
import { MessageKey, t as msg } from '../i18n';
import type { Cell, Part, ValueCompiler } from '../values/compile';
import { shapeText } from '../values/compile';
import type { VCall, VNode } from '../values/parse';
import { add, abs, cross, div, dot, mul, toReal, transposeOf } from '../values/ops';
import { det, inverse } from '../values/linalg';
import { ANY, COMPLEX, NUM, Shape, Value, complex, isList, list, listShape, sameShape, shapeOf, vec, vecShape } from '../values/types';
import { LOWER_FUNCTIONS, OBJECT_COMMANDS, VALUE_COMMANDS } from './syntax';

/** Most items a command makes (Sequence, IterationList): more stop there, so a slider cannot freeze the chart. */
export const MAX_ITEMS = 100000;

/** How each command is written, for the problem when its arguments do not fit (GeoGebra's own syntax). */
export const USAGE: Record<string, string> = {
    Sequence: 'Sequence(<expression>, <variable>, <from>, <to>[, <step>]) or Sequence(<n>)',
    IterationList: 'IterationList(<expression>, <variable>, {<start>}, <n>) or IterationList(<function>, <start>, <n>)',
    Iteration: 'Iteration(<expression>, <variable>, {<start>}, <n>) or Iteration(<function>, <start>, <n>)',
    KeepIf: 'KeepIf(<condition>, <list>) or KeepIf(<condition>, <variable>, <list>)',
    CountIf: 'CountIf(<condition>, <list>) or CountIf(<condition>, <variable>, <list>)',
    Element: 'Element(<list>, <position>) or Element(<matrix>, <row>, <column>)',
    Zip: 'Zip(<expression>, <variable>, <list>, <variable>, <list>, ...)',
    Sum: 'Sum(<list>), Sum(<list>, <n>) or Sum(<expression>, <variable>, <from>, <to>)',
    Product: 'Product(<list>), Product(<list>, <n>) or Product(<expression>, <variable>, <from>, <to>)',
    Length: 'Length(<list>) or Length(<vector>)',
    First: 'First(<list>) or First(<list>, <n>)',
    Last: 'Last(<list>) or Last(<list>, <n>)',
    Append: 'Append(<list>, <object>) or Append(<object>, <list>)',
    Join: 'Join(<list>, <list>, ...) or Join(<list of lists>)',
    Reverse: 'Reverse(<list>)',
    Sort: 'Sort(<list>)',
    Max: 'Max(<list>) or Max(<a>, <b>)',
    Min: 'Min(<list>) or Min(<a>, <b>)',
    Mean: 'Mean(<list>)',
    Flatten: 'Flatten(<list>)',
    Take: 'Take(<list>, <from>[, <to>])',
    Unique: 'Unique(<list>)',
    If: 'If(<condition>, <then>[, <else>])',
    Vector: 'Vector(<point>) or Vector(<start point>, <end point>)',
    UnitVector: 'UnitVector(<vector>)',
    Dot: 'Dot(<vector>, <vector>)',
    Cross: 'Cross(<vector>, <vector>)',
    Determinant: 'Determinant(<matrix>)',
    Transpose: 'Transpose(<matrix>)',
    Invert: 'Invert(<matrix>)',
    Root: 'Root(<function>, <start>) or Root(<function>, <from>, <to>)',
    Integral: 'Integral(<function>, <from>, <to>)',
    Derivative: 'Derivative(<function>) or Derivative(<function>, <order>)',
    Midpoint: 'Midpoint(<point>, <point>)',
    Distance: 'Distance(<point>, <point>)',
    Translate: 'Translate(<object>, <vector>)',
    Rotate: 'Rotate(<object>, <angle>[, <point>])',
    Dilate: 'Dilate(<object>, <factor>[, <point>])',
    Reflect: 'Reflect(<object>, <point>) or Reflect(<object>, <line>)',
    Point: 'Point({<x>, <y>})',
    Circle: 'c = Circle(<center>, <radius>), Circle(<center>, <point>) or Circle(<point>, <point>, <point>)',
    Segment: 's = Segment(<point>, <point>)',
    Line: 'l = Line(<point>, <point>)',
    Ray: 'r = Ray(<start point>, <point>)',
    Polygon: 'p = Polygon(<point>, ..., <point>) or Polygon(<list of points>)',
    Polyline: 'p = Polyline(<point>, ..., <point>) or Polyline(<list of points>)',
    Curve: 'C = Curve(<x(t)>, <y(t)>, t, <from>, <to>)',
    Text: 'Text("<text>", <point>)',
    Slider: 'a = Slider(<min>, <max>[, <step>])',
    Function: 'g = Function(<function>, <from>, <to>)',
};

// ------------------------------------------------------------------ parts

const konst = (v: Value, shape: Shape = shapeOf(v)): Part => ({ f: () => v, shape, k: true });
const dyn = (f: () => Value, shape: Shape): Part => ({ f, shape, k: false });
const fold = (parts: Part[], f: () => Value, shape: Shape): Part => (parts.every((p) => p.k) ? konst(f(), shape) : dyn(f, shape));

function fail(key: MessageKey, values: Record<string, string | number>, pos: number): never {
    throw new ExprError(msg(key, values), { pos });
}

/** The problem of a command whose arguments do not fit: how it is written. */
function usage(n: VCall): never {
    return fail('geogebra.problem.takes', { name: n.name, usage: USAGE[n.name] ?? `${n.name}(...)` }, n.ns);
}

const isNumShape = (s: Shape) => s.k === 'num' || s.k === 'any';
const itemShape = (s: Shape): Shape => (s.k === 'list' ? s.of : ANY);
const items = (v: Value): readonly Value[] => (isList(v) ? v.items : []);

/** A number argument, checked. */
function numberArg(c: ValueCompiler, n: VNode): Part {
    const p = c.node(n);
    if (!isNumShape(p.shape) && p.shape.k !== 'complex') fail('values.problem.notNumber', { what: shapeText(p.shape) }, n.s);
    return p;
}

/** A list argument, checked (a list, or a value whose shape is not known yet). */
function listArg(c: ValueCompiler, n: VNode, name: string): Part {
    const p = c.node(n);
    if (p.shape.k !== 'list' && p.shape.k !== 'any') fail('geogebra.problem.notList', { name, what: shapeText(p.shape) }, n.s);
    return p;
}

/** The variable of a command: a name. */
function variable(n: VCall, arg: VNode | undefined): string {
    if (!arg || arg.t !== 'name') return fail('geogebra.problem.variable', { name: n.name, usage: USAGE[n.name] ?? '' }, arg ? arg.s : n.ns);
    return arg.name;
}

/** The body compiled with its variables bound to cells of these shapes. */
function bound(c: ValueCompiler, body: VNode, names: string[], shapes: Shape[]): { part: Part; cells: Cell[] } {
    const cells: Cell[] = names.map(() => ({ v: NaN }));
    let inner = c;
    names.forEach((name, i) => {
        inner = inner.bind(name, cells[i], shapes[i]);
    });
    return { part: inner.node(body), cells };
}

/** A point of the plane or space as numbers: a vector, a complex number (re, im); null otherwise. */
export function pointNumbers(v: Value): number[] | null {
    if (typeof v === 'number') return null;
    if (v.kind === 'vec') return v.v.slice();
    if (v.kind === 'complex') return [v.re, v.im];
    return null;
}

/** A point again in the kind it came as: a complex number stays complex. */
function asKind(like: Value, p: number[]): Value {
    if (typeof like !== 'number' && like.kind === 'complex') return complex(p[0], p[1]);
    return vec(p);
}

/** A map of points, over a list item by item; anything that is no point is NaN. */
function mapPoints(v: Value, f: (p: number[]) => number[] | null): Value {
    if (isList(v)) return list(v.items.map((x) => mapPoints(x, f)));
    const p = pointNumbers(v);
    if (!p) return NaN;
    const q = f(p);
    return q ? asKind(v, q) : NaN;
}

const isPointShape = (s: Shape) => s.k === 'vec' || s.k === 'complex';
const pointLike = (s: Shape): boolean => isPointShape(s) || (s.k === 'list' && pointLike(s.of));

/** A truthy condition value (a number other than 0). */
const truthy = (v: Value) => {
    const r = toReal(v);
    return r !== 0 && !Number.isNaN(r);
};

// ------------------------------------------------------------- entry points

/** Names that put a formula on the typed path (part A's needsValues): GeoGebra's commands and its lower case functions. */
export function geogebraNeeds(name: string): boolean {
    return VALUE_COMMANDS.has(name) || OBJECT_COMMANDS.has(name) || LOWER_FUNCTIONS.has(name);
}

/**
 * x(P), y(P), z(P): a coordinate of a point (a vector, a complex number,
 * or a list of them, item by item). Null when the call is something else,
 * so x(x + 1) stays a product.
 */
export function coordinateCall(c: ValueCompiler, n: VCall): Part | null {
    if (n.math || n.args.length !== 1 || (n.name !== 'x' && n.name !== 'y' && n.name !== 'z')) return null;
    let arg: Part;
    try {
        arg = c.node(n.args[0]);
    } catch {
        return null;
    }
    if (!pointLike(arg.shape)) return null;
    const k = n.name === 'x' ? 0 : n.name === 'y' ? 1 : 2;
    const f = arg.f;
    const one = (v: Value): Value => {
        if (isList(v)) return list(v.items.map(one));
        const p = pointNumbers(v);
        return p && k < p.length ? p[k] : typeof v !== 'number' && v.kind === 'complex' && k === 2 ? 0 : NaN;
    };
    return fold([arg], () => one(f()), arg.shape.k === 'list' ? listShape(NUM) : NUM);
}

/** A GeoGebra command compiled; null when the name is none (the compiler goes on). Throws ExprError. */
export function geogebraCall(c: ValueCompiler, n: VCall): Part | null {
    if (n.math) return null;
    if (LOWER_FUNCTIONS.has(n.name)) return lower(c, n);
    if (OBJECT_COMMANDS.has(n.name)) return fail('geogebra.problem.object', { name: n.name, usage: USAGE[n.name] ?? '' }, n.ns);
    if (!VALUE_COMMANDS.has(n.name)) return null;
    const a = n.args;
    switch (n.name) {
        case 'Sequence':
            return sequence(c, n);
        case 'IterationList':
        case 'Iteration':
            return iteration(c, n, n.name === 'IterationList');
        case 'KeepIf':
        case 'CountIf':
            return keepIf(c, n, n.name === 'CountIf');
        case 'Element':
            return element(c, n);
        case 'Zip':
            return zip(c, n);
        case 'Sum':
        case 'Product':
            return total(c, n, n.name === 'Product');
        case 'Length': {
            if (a.length !== 1) usage(n);
            const p = c.node(a[0]);
            const f = p.f;
            return fold([p], () => lengthOf(f()), NUM);
        }
        case 'First':
        case 'Last':
            return firstLast(c, n, n.name === 'First');
        case 'Append': {
            if (a.length !== 2) usage(n);
            const x = c.node(a[0]);
            const y = c.node(a[1]);
            const fx = x.f;
            const fy = y.f;
            if (x.shape.k === 'list') return fold([x, y], () => list([...items(fx()), fy()]), x.shape);
            if (y.shape.k === 'list') return fold([x, y], () => list([fx(), ...items(fy())]), y.shape);
            if (x.shape.k === 'any') return fold([x, y], () => (isList(fx()) ? list([...items(fx()), fy()]) : list([fx(), ...items(fy())])), listShape(ANY));
            return fail('geogebra.problem.notList', { name: n.name, what: shapeText(x.shape) }, a[0].s);
        }
        case 'Join': {
            if (!a.length) usage(n);
            const parts = a.map((x) => listArg(c, x, n.name));
            const fs = parts.map((p) => p.f);
            if (parts.length === 1) {
                const f = fs[0];
                return fold(parts, () => list(items(f()).flatMap((x) => (isList(x) ? x.items : [x]))), itemShape(parts[0].shape).k === 'list' ? itemShape(parts[0].shape) : listShape(ANY));
            }
            const first = parts[0].shape;
            const same = parts.every((p) => sameShape(p.shape, first));
            return fold(parts, () => list(fs.flatMap((f) => items(f()))), same ? first : listShape(ANY));
        }
        case 'Reverse': {
            if (a.length !== 1) usage(n);
            const p = listArg(c, a[0], n.name);
            const f = p.f;
            return fold([p], () => list(items(f()).slice().reverse()), p.shape);
        }
        case 'Sort': {
            if (a.length !== 1) usage(n);
            const p = listArg(c, a[0], n.name);
            const f = p.f;
            return fold([p], () => list(items(f()).slice().sort(compareValues)), p.shape);
        }
        case 'Unique': {
            if (a.length !== 1) usage(n);
            const p = listArg(c, a[0], n.name);
            const f = p.f;
            return fold([p], () => unique(items(f())), p.shape);
        }
        case 'Flatten': {
            if (a.length !== 1) usage(n);
            const p = listArg(c, a[0], n.name);
            const f = p.f;
            let of = itemShape(p.shape);
            while (of.k === 'list') of = of.of;
            return fold([p], () => list(flatten(items(f()))), listShape(of));
        }
        case 'Take': {
            if (a.length < 2 || a.length > 3) usage(n);
            const p = listArg(c, a[0], n.name);
            const from = numberArg(c, a[1]);
            const to = a[2] ? numberArg(c, a[2]) : null;
            const f = p.f;
            const ff = from.f;
            const ft = to ? to.f : null;
            return fold([p, from, ...(to ? [to] : [])], () => {
                const all = items(f());
                const i = Math.round(toReal(ff()));
                const j = ft ? Math.round(toReal(ft())) : all.length;
                if (!Number.isFinite(i) || !Number.isFinite(j)) return list([]);
                return list(all.slice(Math.max(0, i - 1), Math.max(0, j)));
            }, p.shape);
        }
        case 'Max':
        case 'Min':
            return extreme(c, n, n.name === 'Max');
        case 'Mean': {
            if (a.length !== 1) usage(n);
            const p = listArg(c, a[0], n.name);
            const f = p.f;
            return fold([p], () => {
                const all = items(f());
                if (!all.length) return NaN;
                return div(all.reduce<Value>((s, x) => add(s, x), 0), all.length);
            }, itemShape(p.shape));
        }
        case 'If':
            return ifCall(c, n);
        case 'Vector': {
            if (a.length < 1 || a.length > 2) usage(n);
            const parts = a.map((x) => c.node(x));
            parts.forEach((p, i) => {
                if (!isPointShape(p.shape) && p.shape.k !== 'any') fail('geogebra.problem.notPoint', { name: n.name, what: shapeText(p.shape) }, a[i].s);
            });
            const fs = parts.map((p) => p.f);
            const n0 = parts[parts.length - 1].shape.k === 'vec' ? (parts[parts.length - 1].shape as { n: number }).n : 2;
            return fold(parts, () => {
                const ps = fs.map((f) => pointNumbers(f()));
                if (ps.some((p) => !p)) return NaN;
                const [p, q] = ps as number[][];
                if (!q) return vec(p);
                if (p.length !== q.length) return NaN;
                return vec(q.map((x, i) => x - p[i]));
            }, vecShape(n0));
        }
        case 'UnitVector': {
            if (a.length !== 1) usage(n);
            const p = c.node(a[0]);
            const f = p.f;
            return fold([p], () => {
                const v = f();
                const len = toReal(abs(v));
                return len > 0 ? div(v, len) : NaN;
            }, p.shape);
        }
        case 'Dot': {
            if (a.length !== 2) usage(n);
            const [p, q] = a.map((x) => c.node(x));
            const fp = p.f;
            const fq = q.f;
            return fold([p, q], () => {
                const u = pointNumbers(fp());
                const v = pointNumbers(fq());
                return u && v && u.length === v.length ? dot(vec(u), vec(v)) : NaN;
            }, NUM);
        }
        case 'Cross': {
            if (a.length !== 2) usage(n);
            const [p, q] = a.map((x) => c.node(x));
            const fp = p.f;
            const fq = q.f;
            const shape = p.shape.k === 'vec' && p.shape.n === 3 ? vecShape(3) : p.shape.k === 'vec' && p.shape.n === 2 ? NUM : ANY;
            return fold([p, q], () => {
                const u = pointNumbers(fp());
                const v = pointNumbers(fq());
                return u && v ? cross(vec(u), vec(v)) : NaN;
            }, shape);
        }
        case 'Determinant':
        case 'Transpose':
        case 'Invert': {
            if (a.length !== 1) usage(n);
            const p = c.node(a[0]);
            if (p.shape.k !== 'mat' && p.shape.k !== 'any' && !(n.name === 'Invert' && isNumShape(p.shape))) fail('values.problem.function', { name: n.name, what: shapeText(p.shape) }, a[0].s);
            const f = p.f;
            if (n.name === 'Determinant') return fold([p], () => matrixOp(f(), (m) => det(m)), NUM);
            if (n.name === 'Transpose') return fold([p], () => transposeOf(f()), p.shape.k === 'mat' ? { k: 'mat', r: p.shape.c, c: p.shape.r } : p.shape);
            return fold([p], () => {
                const v = f();
                if (typeof v === 'number') return 1 / v;
                return v.kind === 'mat' ? (inverse(v) ?? NaN) : NaN;
            }, p.shape);
        }
        case 'Root':
            return root(c, n);
        case 'Integral':
            return integral(c, n);
        case 'Derivative':
            return derivative(c, n);
        case 'Midpoint':
        case 'Distance': {
            if (a.length !== 2) usage(n);
            const [p, q] = a.map((x) => c.node(x));
            const fp = p.f;
            const fq = q.f;
            if (n.name === 'Distance') {
                return fold([p, q], () => {
                    const u = pointNumbers(fp());
                    const v = pointNumbers(fq());
                    return u && v && u.length === v.length ? Math.hypot(...u.map((x, i) => x - v[i])) : NaN;
                }, NUM);
            }
            return fold([p, q], () => mapPoints(fp(), (u) => {
                const v = pointNumbers(fq());
                return v && v.length === u.length ? u.map((x, i) => (x + v[i]) / 2) : null;
            }), p.shape);
        }
        case 'Translate':
        case 'Rotate':
        case 'Dilate':
        case 'Reflect':
            return transform(c, n);
        case 'Point': {
            if (a.length !== 1) usage(n);
            const p = c.node(a[0]);
            const f = p.f;
            return fold([p], () => {
                const v = f();
                if (isList(v)) {
                    const xs = v.items.map((x) => toReal(x));
                    return xs.length === 2 || xs.length === 3 ? vec(xs) : NaN;
                }
                const q = pointNumbers(v);
                return q ? vec(q) : NaN;
            }, vecShape(p.shape.k === 'vec' ? p.shape.n : 2));
        }
        default:
            return null;
    }
}

// ------------------------------------------------------------ the commands

/** conjugate, real, imaginary, sgn. */
function lower(c: ValueCompiler, n: VCall): Part {
    if (n.args.length !== 1) fail('problems.expr.takesArguments', { name: n.name, count: 1 }, n.ns);
    const p = c.node(n.args[0]);
    const f = p.f;
    const each = (v: Value, g: (x: Value) => Value): Value => (isList(v) ? list(v.items.map((x) => each(x, g))) : g(v));
    const listOf = (s: Shape) => (p.shape.k === 'list' ? listShape(s) : s);
    switch (n.name) {
        case 'conjugate':
            return fold([p], () => each(f(), (v) => (typeof v !== 'number' && v.kind === 'complex' ? complex(v.re, -v.im) : v)), p.shape);
        case 'real':
            return fold([p], () => each(f(), (v) => (typeof v === 'number' ? v : v.kind === 'complex' ? v.re : v.kind === 'vec' && v.v.length === 2 ? v.v[0] : NaN)), listOf(NUM));
        case 'imaginary':
            return fold([p], () => each(f(), (v) => (typeof v === 'number' ? 0 : v.kind === 'complex' ? v.im : v.kind === 'vec' && v.v.length === 2 ? v.v[1] : NaN)), listOf(NUM));
        default:
            return fold([p], () => each(f(), (v) => Math.sign(toReal(v))), listOf(NUM));
    }
}

/** Sequence(n), Sequence(expr, k, a, b[, step]). */
function sequence(c: ValueCompiler, n: VCall): Part {
    const a = n.args;
    if (a.length === 1) {
        const count = numberArg(c, a[0]);
        const f = count.f;
        return fold([count], () => {
            const m = Math.min(MAX_ITEMS, Math.round(toReal(f())));
            const out: Value[] = [];
            for (let k = 1; k <= m; k++) out.push(k);
            return list(out);
        }, listShape(NUM));
    }
    if (a.length < 4 || a.length > 5) usage(n);
    const name = variable(n, a[1]);
    const from = numberArg(c, a[2]);
    const to = numberArg(c, a[3]);
    const step = a[4] ? numberArg(c, a[4]) : null;
    const { part, cells } = bound(c, a[0], [name], [NUM]);
    const cell = cells[0];
    const body = part.f;
    const ff = from.f;
    const ft = to.f;
    const fs = step ? step.f : null;
    return dyn(() => {
        const lo = toReal(ff());
        const hi = toReal(ft());
        const d = fs ? toReal(fs()) : 1;
        const out: Value[] = [];
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(d) || d === 0 || (hi - lo) / d < 0) return list(out);
        const count = Math.min(MAX_ITEMS, Math.floor((hi - lo) / d + 1e-9) + 1);
        const saved = cell.v;
        for (let i = 0; i < count; i++) {
            // Whole steps from the start: 0.1 + 0.1 + 0.1 does not drift.
            cell.v = Number((lo + i * d).toPrecision(15));
            out.push(body());
        }
        cell.v = saved;
        return list(out);
    }, listShape(part.shape));
}

/** A function argument as a closure of one number: a name of a function (f), or a formula in x. */
function functionArg(c: ValueCompiler, n: VCall, arg: VNode): (x: number) => number {
    const cell: Cell = { v: NaN };
    let body: VNode = arg;
    if (arg.t === 'name' && c.isFunctionName(arg.name)) {
        const x: VNode = { t: 'name', name: '\u0001x', s: arg.s, e: arg.e };
        body = { t: 'call', name: arg.name, math: false, args: [x], ns: arg.s, ne: arg.e, s: arg.s, e: arg.e };
        const part = c.bind('\u0001x', cell, NUM).node(body);
        const f = part.f;
        return (v: number) => {
            cell.v = v;
            return toReal(f());
        };
    }
    let part: Part;
    try {
        part = c.bind('x', cell, NUM).node(body);
    } catch (e) {
        if (e instanceof ExprError) throw e;
        return fail('geogebra.problem.function', { name: n.name }, arg.s);
    }
    if (!isNumShape(part.shape) && part.shape.k !== 'complex') fail('geogebra.problem.function', { name: n.name }, arg.s);
    const f = part.f;
    return (v: number) => {
        cell.v = v;
        return toReal(f());
    };
}

/** IterationList(expr, var, ..., {start}, n), IterationList(f, start, n); Iteration gives the last one. */
function iteration(c: ValueCompiler, n: VCall, all: boolean): Part {
    const a = n.args;
    if (a.length === 3) {
        const fn = functionArg(c, n, a[0]);
        const start = numberArg(c, a[1]);
        const count = numberArg(c, a[2]);
        const fs = start.f;
        const fc = count.f;
        return dyn(() => {
            const m = Math.min(MAX_ITEMS, Math.round(toReal(fc())));
            let v = toReal(fs());
            const out: Value[] = [v];
            for (let i = 0; i < m; i++) {
                v = fn(v);
                if (all) out.push(v);
            }
            return all ? list(out) : v;
        }, all ? listShape(NUM) : NUM);
    }
    if (a.length < 4) usage(n);
    const names = a.slice(1, a.length - 2).map((x) => variable(n, x));
    const start = c.node(a[a.length - 2]);
    const count = numberArg(c, a[a.length - 1]);
    const startShape = start.shape.k === 'list' ? start.shape.of : start.shape;
    // A point as the start of a formula of complex numbers (z^3 of a point): the point is the complex number x + iy.
    let complexStart = false;
    let compiled: { part: Part; cells: Cell[] };
    try {
        compiled = bound(c, a[0], names, names.map(() => startShape));
    } catch (e) {
        if (!(e instanceof ExprError) || !(startShape.k === 'vec' && (startShape.n === 2 || !startShape.n))) throw e;
        compiled = bound(c, a[0], names, names.map(() => COMPLEX));
        complexStart = true;
    }
    const { part, cells } = compiled;
    const body = part.f;
    const fs = start.f;
    const fc = count.f;
    const k = names.length;
    const shape = complexStart ? COMPLEX : sameShape(part.shape, startShape) && startShape.k !== 'any' ? (startShape.k === 'num' && part.shape.k === 'complex' ? COMPLEX : startShape) : ANY;
    const toStart = (v: Value): Value => {
        if (!complexStart) return v;
        const p = pointNumbers(v);
        return p && p.length === 2 ? complex(p[0], p[1]) : v;
    };
    return dyn(() => {
        const s = fs();
        const first = (isList(s) ? s.items : [s]).map(toStart);
        if (first.length < k) return all ? list([]) : NaN;
        const m = Math.min(MAX_ITEMS, Math.round(toReal(fc())));
        const out: Value[] = first.slice();
        const saved = cells.map((cell) => cell.v);
        let last: Value = out[out.length - 1];
        for (let i = 0; i < m; i++) {
            const at = out.length - k;
            for (let j = 0; j < k; j++) cells[j].v = out[at + j];
            last = body();
            out.push(last);
        }
        cells.forEach((cell, j) => (cell.v = saved[j]));
        return all ? list(out) : last;
    }, all ? listShape(shape) : shape);
}

/** KeepIf(condition, list) (the items are x), KeepIf(condition, var, list); CountIf counts them. */
function keepIf(c: ValueCompiler, n: VCall, count: boolean): Part {
    const a = n.args;
    if (a.length !== 2 && a.length !== 3) usage(n);
    const name = a.length === 3 ? variable(n, a[1]) : 'x';
    const source = listArg(c, a[a.length - 1], n.name);
    const { part, cells } = bound(c, a[0], [name], [itemShape(source.shape)]);
    if (!isNumShape(part.shape)) fail('geogebra.problem.condition', { name: n.name }, a[0].s);
    const cell = cells[0];
    const test = part.f;
    const fl = source.f;
    return dyn(() => {
        const saved = cell.v;
        const kept: Value[] = [];
        for (const item of items(fl())) {
            cell.v = item;
            if (truthy(test())) kept.push(item);
        }
        cell.v = saved;
        return count ? kept.length : list(kept);
    }, count ? NUM : source.shape.k === 'list' ? source.shape : listShape(ANY));
}

/** Element(list, i) (1-based), Element(matrix, i, j), Element(list of lists, i, j). */
function element(c: ValueCompiler, n: VCall): Part {
    const a = n.args;
    if (a.length < 2) usage(n);
    const p = c.node(a[0]);
    const idx = a.slice(1).map((x) => numberArg(c, x));
    const f = p.f;
    const fi = idx.map((q) => q.f);
    let shape = p.shape;
    for (let k = 0; k < idx.length; k++) shape = shape.k === 'list' ? shape.of : shape.k === 'mat' && k === idx.length - 1 ? NUM : shape.k === 'vec' ? NUM : ANY;
    return fold([p, ...idx], () => {
        let v: Value = f();
        const at = fi.map((g) => Math.round(toReal(g())));
        for (let k = 0; k < at.length; k++) {
            const i = at[k];
            if (!Number.isFinite(i) || i < 1) return NaN;
            if (isList(v)) {
                v = i <= v.items.length ? v.items[i - 1] : NaN;
            } else if (typeof v !== 'number' && v.kind === 'mat') {
                if (k + 1 < at.length) {
                    const j = at[k + 1];
                    if (i > v.rows || !(j >= 1) || j > v.cols) return NaN;
                    return v.a[(i - 1) * v.cols + (j - 1)];
                }
                if (i > v.rows) return NaN;
                v = vec(v.a.slice((i - 1) * v.cols, i * v.cols));
            } else if (typeof v !== 'number' && v.kind === 'vec') {
                v = i <= v.v.length ? v.v[i - 1] : NaN;
            } else return NaN;
        }
        return v;
    }, shape);
}

/** Zip(expr, var1, list1, var2, list2, ...): expr for the items side by side (as many as the shortest list). */
function zip(c: ValueCompiler, n: VCall): Part {
    const a = n.args;
    if (a.length < 3 || a.length % 2 === 0) usage(n);
    const names: string[] = [];
    const lists: Part[] = [];
    for (let i = 1; i < a.length; i += 2) {
        names.push(variable(n, a[i]));
        lists.push(listArg(c, a[i + 1], n.name));
    }
    const { part, cells } = bound(c, a[0], names, lists.map((l) => itemShape(l.shape)));
    const body = part.f;
    const fs = lists.map((l) => l.f);
    return dyn(() => {
        const ls = fs.map((f) => items(f()));
        const m = Math.min(...ls.map((l) => l.length));
        const saved = cells.map((cell) => cell.v);
        const out: Value[] = [];
        for (let i = 0; i < m; i++) {
            cells.forEach((cell, j) => (cell.v = ls[j][i]));
            out.push(body());
        }
        cells.forEach((cell, j) => (cell.v = saved[j]));
        return list(out);
    }, listShape(part.shape));
}

/** Sum(list), Sum(list, n), Sum(expr, k, a, b); Product the same with a product. */
function total(c: ValueCompiler, n: VCall, product: boolean): Part {
    const a = n.args;
    const combine = (acc: Value, x: Value) => (product ? mul(acc, x) : add(acc, x));
    if (a.length === 4) {
        const seq = sequence(c, { ...n, name: 'Sequence', args: [a[0], a[1], a[2], a[3]] });
        const f = seq.f;
        return dyn(() => items(f()).reduce<Value>(combine, product ? 1 : 0), itemShape(seq.shape));
    }
    if (a.length !== 1 && a.length !== 2) usage(n);
    const p = listArg(c, a[0], n.name);
    const upto = a[1] ? numberArg(c, a[1]) : null;
    const f = p.f;
    const fu = upto ? upto.f : null;
    return fold([p, ...(upto ? [upto] : [])], () => {
        let all = items(f());
        if (fu) all = all.slice(0, Math.max(0, Math.round(toReal(fu()))));
        if (!all.length) return product ? 1 : 0;
        return all.slice(1).reduce<Value>(combine, all[0]);
    }, itemShape(p.shape));
}

/** First(list[, n]), Last(list[, n]): a new list of the first (last) n items, 1 by default (as GeoGebra). */
function firstLast(c: ValueCompiler, n: VCall, first: boolean): Part {
    const a = n.args;
    if (a.length !== 1 && a.length !== 2) usage(n);
    const p = listArg(c, a[0], n.name);
    const count = a[1] ? numberArg(c, a[1]) : null;
    const f = p.f;
    const fc = count ? count.f : null;
    return fold([p, ...(count ? [count] : [])], () => {
        const all = items(f());
        const m = fc ? Math.max(0, Math.round(toReal(fc()))) : 1;
        return list(first ? all.slice(0, m) : all.slice(Math.max(0, all.length - m)));
    }, p.shape);
}

/** Max(list), Max(a, b, ...); Min the same. Of numbers. */
function extreme(c: ValueCompiler, n: VCall, max: boolean): Part {
    const a = n.args;
    if (!a.length) usage(n);
    const parts = a.map((x) => c.node(x));
    const fs = parts.map((p) => p.f);
    const pick = (xs: number[]) => (xs.length ? (max ? Math.max(...xs) : Math.min(...xs)) : NaN);
    if (parts.length === 1) {
        const f = fs[0];
        return fold(parts, () => pick(items(f()).map(toReal)), NUM);
    }
    parts.forEach((p, i) => {
        if (!isNumShape(p.shape)) fail('values.problem.notNumber', { what: shapeText(p.shape) }, a[i].s);
    });
    return fold(parts, () => pick(fs.map((f) => toReal(f()))), NUM);
}

/** If(condition, a[, b]), and If(c1, a1, c2, a2, ..., else). */
function ifCall(c: ValueCompiler, n: VCall): Part {
    const a = n.args;
    if (a.length < 2) usage(n);
    const parts = a.map((x) => c.node(x));
    for (let i = 0; i + 1 < parts.length; i += 2) {
        if (!isNumShape(parts[i].shape)) fail('geogebra.problem.condition', { name: n.name }, a[i].s);
    }
    const fs = parts.map((p) => p.f);
    const values = parts.filter((_, i) => i % 2 === 1 || (i === parts.length - 1 && parts.length % 2 === 1));
    const shape = values.every((p) => sameShape(p.shape, values[0].shape)) && values[0].shape.k !== 'any' ? values[0].shape : ANY;
    return fold(parts, () => {
        let i = 0;
        for (; i + 1 < fs.length; i += 2) if (truthy(fs[i]())) return fs[i + 1]();
        return i < fs.length ? fs[i]() : NaN;
    }, shape);
}

/** Root(f, a): Newton's method from a; Root(f, a, b): a root between a and b (bisection). */
function root(c: ValueCompiler, n: VCall): Part {
    const a = n.args;
    if (a.length !== 2 && a.length !== 3) usage(n);
    const fn = functionArg(c, n, a[0]);
    const lo = numberArg(c, a[1]);
    const hi = a[2] ? numberArg(c, a[2]) : null;
    const fl = lo.f;
    const fh = hi ? hi.f : null;
    return dyn(() => (fh ? bisect(fn, toReal(fl()), toReal(fh())) : newton(fn, toReal(fl()))), NUM);
}

export function newton(f: (x: number) => number, x0: number): number {
    let x = x0;
    for (let i = 0; i < 100 && Number.isFinite(x); i++) {
        const fx = f(x);
        if (fx === 0) return x;
        const h = 1e-6 * Math.max(1, Math.abs(x));
        const d = (f(x + h) - f(x - h)) / (2 * h);
        if (!d || !Number.isFinite(d)) return NaN;
        const next = x - fx / d;
        if (Math.abs(next - x) <= 1e-13 * Math.max(1, Math.abs(x))) return next;
        x = next;
    }
    return Number.isFinite(x) && Math.abs(f(x)) < 1e-8 ? x : NaN;
}

export function bisect(f: (x: number) => number, a: number, b: number): number {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    let fa = f(a);
    const fb = f(b);
    if (fa === 0) return a;
    if (fb === 0) return b;
    if (!(fa * fb < 0)) return NaN;
    for (let i = 0; i < 200; i++) {
        const m = (a + b) / 2;
        const fm = f(m);
        if (fm === 0 || Math.abs(b - a) < 1e-14 * Math.max(1, Math.abs(m))) return m;
        if (fa * fm < 0) b = m;
        else {
            a = m;
            fa = fm;
        }
    }
    return (a + b) / 2;
}

/** Integral(f, a, b): composite Simpson with 2000 steps. */
function integral(c: ValueCompiler, n: VCall): Part {
    const a = n.args;
    if (a.length !== 3) usage(n);
    const fn = functionArg(c, n, a[0]);
    const lo = numberArg(c, a[1]);
    const hi = numberArg(c, a[2]);
    const fl = lo.f;
    const fh = hi.f;
    return dyn(() => simpson(fn, toReal(fl()), toReal(fh())), NUM);
}

export function simpson(f: (x: number) => number, a: number, b: number, steps = 2000): number {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    if (a === b) return 0;
    const h = (b - a) / steps;
    let s = f(a) + f(b);
    for (let i = 1; i < steps; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
    return (s * h) / 3;
}

/**
 * Derivative(f), Derivative(f, n): the n-th derivative (1 to 3) at the
 * field's first variable (x), by central differences; a field without one
 * has no value (a line `g = Derivative(f)` draws it as a function).
 */
function derivative(c: ValueCompiler, n: VCall): Part {
    const a = n.args;
    if (a.length !== 1 && a.length !== 2) usage(n);
    const fn = functionArg(c, n, a[0]);
    const order = a[1] ? numberArg(c, a[1]) : null;
    // The field's x: the first axis variable as a local of this compiler (NaN where there is none).
    let xPart: Part;
    try {
        xPart = c.node({ t: 'name', name: 'x', s: n.s, e: n.e });
    } catch {
        xPart = konst(NaN, NUM);
    }
    const fx = xPart.f;
    const fo = order ? order.f : null;
    return dyn(() => derivativeAt(fn, toReal(fx()), fo ? Math.round(toReal(fo())) : 1), NUM);
}

export function derivativeAt(f: (x: number) => number, x: number, order: number): number {
    if (!Number.isFinite(x)) return NaN;
    const h = Math.pow(1e-16, 1 / (order + 2)) * Math.max(1, Math.abs(x));
    switch (order) {
        case 1:
            return (f(x + h) - f(x - h)) / (2 * h);
        case 2:
            return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
        case 3:
            return (f(x + 2 * h) - 2 * f(x + h) + 2 * f(x - h) - f(x - 2 * h)) / (2 * h * h * h);
        default:
            return order === 0 ? f(x) : NaN;
    }
}

/** Translate(P, v), Rotate(P, angle[, C]), Dilate(P, k[, C]), Reflect(P, Q) of points (and lists of points). */
function transform(c: ValueCompiler, n: VCall): Part {
    const a = n.args;
    const parts = a.map((x) => c.node(x));
    const map = pointMap(n, parts, a);
    const f = parts[0].f;
    return fold(parts, () => {
        const m = map();
        return m ? mapPoints(f(), m) : NaN;
    }, parts[0].shape);
}

/** The map of a transform command of points, from its arguments after the object (values now); null when one is no value. */
function pointMap(n: VCall, parts: Part[], a: VNode[]): () => ((p: number[]) => number[] | null) | null {
    const fs = parts.map((p) => p.f);
    const point = (i: number): number[] | null => (i < fs.length ? pointNumbers(fs[i]()) : null);
    switch (n.name) {
        case 'Translate': {
            if (a.length !== 2) usage(n);
            return () => {
                const v = point(1);
                return v ? (p) => (p.length === v.length ? p.map((x, i) => x + v[i]) : null) : null;
            };
        }
        case 'Rotate': {
            if (a.length !== 2 && a.length !== 3) usage(n);
            return () => {
                const t = toReal(fs[1]());
                const center = a.length === 3 ? point(2) : [0, 0];
                if (!center || !Number.isFinite(t)) return null;
                const cos = Math.cos(t);
                const sin = Math.sin(t);
                return (p) => {
                    const dx = p[0] - center[0];
                    const dy = p[1] - center[1];
                    return [center[0] + cos * dx - sin * dy, center[1] + sin * dx + cos * dy, ...p.slice(2)];
                };
            };
        }
        case 'Dilate': {
            if (a.length !== 2 && a.length !== 3) usage(n);
            return () => {
                const k = toReal(fs[1]());
                const center = a.length === 3 ? point(2) : null;
                if (!Number.isFinite(k)) return null;
                return (p) => p.map((x, i) => (center ? center[i] ?? 0 : 0) + k * (x - (center ? center[i] ?? 0 : 0)));
            };
        }
        default: {
            if (a.length !== 2) usage(n);
            return () => {
                const q = point(1);
                return q ? (p) => (p.length === q.length ? p.map((x, i) => 2 * q[i] - x) : null) : null;
            };
        }
    }
}

// ------------------------------------------------------------------ helpers

function lengthOf(v: Value): Value {
    if (isList(v)) return v.items.length;
    if (typeof v === 'number') return Math.abs(v);
    return toReal(abs(v));
}

function matrixOp(v: Value, f: (m: Extract<Value, { kind: 'mat' }>) => number): number {
    return typeof v !== 'number' && v.kind === 'mat' && v.rows === v.cols ? f(v) : NaN;
}

/** Numbers by size, points by x then y, complex numbers by real then imaginary part. */
function compareValues(x: Value, y: Value): number {
    const a = typeof x === 'number' ? [x] : pointNumbers(x);
    const b = typeof y === 'number' ? [y] : pointNumbers(y);
    if (!a || !b) return 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
}

function sameValue(x: Value, y: Value): boolean {
    if (typeof x === 'number' || typeof y === 'number') return x === y;
    const a = pointNumbers(x);
    const b = pointNumbers(y);
    return !!a && !!b && x.kind === y.kind && a.length === b.length && a.every((v, i) => v === b[i]);
}

function unique(all: readonly Value[]): Value {
    const out: Value[] = [];
    for (const v of all) if (!out.some((w) => sameValue(v, w))) out.push(v);
    return list(out.sort(compareValues));
}

function flatten(all: readonly Value[]): Value[] {
    const out: Value[] = [];
    for (const v of all) {
        if (isList(v)) out.push(...flatten(v.items));
        else out.push(v);
    }
    return out;
}
