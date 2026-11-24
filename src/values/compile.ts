/*
 * 6.0 A: the typed compiler. A formula (VNode, src/values/parse.ts; any
 * Node of src/expr.ts too) becomes a closure that returns a value: a
 * number, a complex number, a vector, a matrix or a list. Names resolve in
 * this order: locals (parameters, the index of a sum or list, the axis
 * variables), sliders and computed names (P1_x) through the Env of
 * src/expr.ts, the chart's functions, constants, let definitions (table.ts),
 * the imaginary unit i, the parts of a let vector (v_x, v_y, v_z). The
 * compiler knows the shape of every part, so a vector added to a number is
 * an ExprError at its place, before anything runs. Plain-number formulas
 * never come here: src/expr.ts compiles them as before.
 * Pure: no DOM, no Obsidian; no dynamic code.
 */
import { Env, ExprError, builtinFunction, constantValue, isLatexFormula, splitName, unknownFunctionError, unknownNameError } from '../expr';
import { MessageKey, t as msg } from '../i18n';
import type { VCall, VNode } from './parse';
import { children } from './parse';
import {
    ANY,
    COMPLEX,
    I,
    NUM,
    Shape,
    Value,
    complex,
    isList,
    list,
    listShape,
    mat,
    matShape,
    sameShape,
    scalarLike,
    shapeOf,
    vec,
    vecShape,
} from './types';
import { COMPLEX_FUNCTIONS, VALUE_FUNCTIONS, abs, add, complexFunction, cross, div, mul, neg, pow, realFunction, sub, toReal, transposeOf } from './ops';
import { MAX_TERMS, termRange } from './special';

/** A local name's value, written before the closures that read it run. */
export interface Cell {
    v: Value;
}

/** A compiled part: its closure and its shape; `k` when it is a constant (its value never changes). */
export interface Part {
    f: () => Value;
    shape: Shape;
    k: boolean;
}

/** A let definition as the compiler sees it (table.ts). */
export interface DefRef {
    name: string;
    /** A value: its shape and the value now. */
    value?: { shape: Shape; read: () => Value };
    /** A function: how many parameters, and its body for the shapes of the arguments at a call. */
    fn?: { params: string[]; instance(shapes: Shape[]): { cells: Cell[]; body: Part } };
}

/** Where the let definitions come from (table.ts), for the compiler. */
export interface Definitions {
    /** The definition of a name, or null; throws ExprError when it has a problem (its message names it). */
    ref(name: string): DefRef | null;
    has(name: string): boolean;
    names(): string[];
    /** The name is a function (let f(x) = ...), not a value. */
    isFunction(name: string): boolean;
    /** The formula of a definition, read (for the export), or null. */
    bodyOf(name: string): VNode | null;
}

/** Locals: a chain from the innermost name out. */
export class Locals {
    constructor(
        readonly parent: Locals | null,
        readonly name: string,
        readonly cell: Cell,
        readonly shape: Shape
    ) {}

    find(name: string): Locals | null {
        for (let l: Locals | null = this; l; l = l.parent) if (l.name === name) return l;
        return null;
    }

    names(): string[] {
        const out: string[] = [];
        for (let l: Locals | null = this; l; l = l.parent) out.push(l.name);
        return out;
    }
}

export interface Scope {
    env: Env;
    defs: Definitions | null;
    locals: Locals | null;
    /** The whole field text, for quick fixes and LaTeX letter products. */
    src: string;
}

/** Names that mean the transpose after ^: A^T, A^{\top}. */
const TRANSPOSE = new Set(['T', 'top', 'intercal']);

/** Parts of a vector by name: v_x, v_y, v_z, v_1, v_2, ... */
const COMPONENT_RE = /^([A-Za-z][A-Za-z0-9_]*?)_(x|y|z|[1-9])$/;
const COMPONENT_INDEX: Record<string, number> = { x: 0, y: 1, z: 2 };

/** How deep let functions may call each other at run time (a cycle through a chart function stops here with NaN). */
const MAX_DEPTH = 64;
let depth = 0;

// ------------------------------------------------------------------ shapes

/** A shape in words, for messages: 'a vector', 'a 2 x 2 matrix'. */
export function shapeText(s: Shape): string {
    switch (s.k) {
        case 'num':
            return msg('values.shape.number');
        case 'complex':
            return msg('values.shape.complex');
        case 'vec':
            return s.n ? msg('values.shape.vectorN', { n: s.n }) : msg('values.shape.vector');
        case 'mat':
            return s.r && s.c ? msg('values.shape.matrixRC', { rows: s.r, cols: s.c }) : msg('values.shape.matrix');
        case 'list':
            return msg('values.shape.list');
        default:
            return msg('values.shape.value');
    }
}

function fail(key: MessageKey, values: Record<string, string | number>, pos: number): never {
    throw new ExprError(msg(key, values), { pos });
}

const isNum = (s: Shape) => s.k === 'num' || s.k === 'any';
const isScalar = scalarLike;

/** The shape of a + b (and a - b), or null when they do not add. */
function addShape(a: Shape, b: Shape): Shape | null {
    if (a.k === 'any' || b.k === 'any') return ANY;
    if (a.k === 'list' || b.k === 'list') {
        const inner = addShape(a.k === 'list' ? a.of : a, b.k === 'list' ? b.of : b);
        return inner && listShape(inner);
    }
    if (isScalar(a) && isScalar(b)) return a.k === 'complex' || b.k === 'complex' ? COMPLEX : NUM;
    if (a.k === 'vec' && b.k === 'vec') return sameShape(a, b) ? vecShape(a.n || b.n) : null;
    if (a.k === 'mat' && b.k === 'mat') return sameShape(a, b) ? matShape(a.r || b.r, a.c || b.c) : null;
    return null;
}

/** The shape of a b, or null. */
function mulShape(a: Shape, b: Shape): Shape | null {
    if (a.k === 'any' || b.k === 'any') return ANY;
    if (a.k === 'list' || b.k === 'list') {
        const inner = mulShape(a.k === 'list' ? a.of : a, b.k === 'list' ? b.of : b);
        return inner && listShape(inner);
    }
    if (isScalar(a) && isScalar(b)) return a.k === 'complex' || b.k === 'complex' ? COMPLEX : NUM;
    if (a.k === 'num') return b.k === 'vec' || b.k === 'mat' ? b : null;
    if (b.k === 'num') return a.k === 'vec' || a.k === 'mat' ? a : null;
    if (a.k === 'vec' && b.k === 'vec') return sameShape(a, b) ? NUM : null;
    if (a.k === 'mat' && b.k === 'vec') return !a.c || !b.n || a.c === b.n ? vecShape(a.r) : null;
    if (a.k === 'vec' && b.k === 'mat') return !b.r || !a.n || b.r === a.n ? vecShape(b.c) : null;
    if (a.k === 'mat' && b.k === 'mat') return !a.c || !b.r || a.c === b.r ? matShape(a.r, b.c) : null;
    return null;
}

function divShape(a: Shape, b: Shape): Shape | null {
    if (a.k === 'any' || b.k === 'any') return ANY;
    if (a.k === 'list' || b.k === 'list') {
        const inner = divShape(a.k === 'list' ? a.of : a, b.k === 'list' ? b.of : b);
        return inner && listShape(inner);
    }
    if (!isScalar(b)) return null;
    if (isScalar(a)) return a.k === 'complex' || b.k === 'complex' ? COMPLEX : NUM;
    return b.k === 'num' && (a.k === 'vec' || a.k === 'mat') ? a : null;
}

function powShape(a: Shape, b: Shape): Shape | null {
    if (a.k === 'any' || b.k === 'any') return ANY;
    if (a.k === 'list' || b.k === 'list') {
        const inner = powShape(a.k === 'list' ? a.of : a, b.k === 'list' ? b.of : b);
        return inner && listShape(inner);
    }
    if (isScalar(a) && isScalar(b)) return a.k === 'complex' || b.k === 'complex' ? COMPLEX : NUM;
    if (a.k === 'mat' && b.k === 'num') return !a.r || !a.c || a.r === a.c ? a : null;
    return null;
}

// ---------------------------------------------------------------- compiler

const konst = (v: Value, shape: Shape = shapeOf(v)): Part => ({ f: () => v, shape, k: true });
const dyn = (f: () => Value, shape: Shape): Part => ({ f, shape, k: false });

/** A pure operation of constant parts is folded once. */
function fold(parts: Part[], f: () => Value, shape: Shape): Part {
    return parts.every((p) => p.k) ? konst(f(), shape) : dyn(f, shape);
}

/** Does `name` mean something in the Env (an axis variable, a slider or computed name, a chart function, a constant)? */
export function inEnv(name: string, env: Env): boolean {
    return env.vars.some((v) => v.includes(name)) || !!env.scalar(name) || !!env.fn(name) || constantValue(name) !== undefined;
}

/** `sum(body, k, lo, hi)` and `prod(...)` of a VCall: the index name, else null. */
export function seriesOf(n: VCall): string | null {
    if (n.math || (n.name !== 'sum' && n.name !== 'prod') || n.args.length !== 4) return null;
    const k = n.args[1];
    return k.t === 'name' ? k.name : null;
}

export class ValueCompiler {
    constructor(private scope: Scope) {}

    private with(name: string, cell: Cell, shape: Shape): ValueCompiler {
        return new ValueCompiler({ ...this.scope, locals: new Locals(this.scope.locals, name, cell, shape) });
    }

    node(n: VNode): Part {
        switch (n.t) {
            case 'num':
                return konst(n.value, NUM);
            case 'member': {
                // Math.PI and the other Math constants (upper case, as in JavaScript).
                const v = /^[A-Z]/.test(n.name) ? constantValue(n.name) : undefined;
                if (v === undefined) fail('problems.expr.unknownName', { name: `Math.${n.name}` }, n.s);
                return konst(v, NUM);
            }
            case 'name':
                return this.name(n.name, n.s, n.e);
            case 'call':
                return this.call(n);
            case 'unary': {
                const a = this.node(n.arg);
                if (n.op === '+') return a;
                const f = a.f;
                if (n.op === '-') return fold([a], () => neg(f()), a.shape);
                if (!isNum(a.shape)) fail('values.problem.notNumber', { what: shapeText(a.shape) }, n.s);
                return fold([a], () => (toReal(f()) ? 0 : 1), NUM);
            }
            case 'binary':
                return this.binary(n);
            case 'cmp': {
                const args = n.args.map((a) => this.node(a));
                args.forEach((a, i) => {
                    if (!isNum(a.shape)) fail('values.problem.compare', { what: shapeText(a.shape) }, n.args[i].s);
                });
                const fs = args.map((a) => a.f);
                const ops = n.ops.slice();
                return fold(
                    args,
                    () => {
                        let prev = toReal(fs[0]());
                        for (let i = 0; i < ops.length; i++) {
                            const cur = toReal(fs[i + 1]());
                            if (!compare(ops[i], prev, cur)) return 0;
                            prev = cur;
                        }
                        return 1;
                    },
                    NUM
                );
            }
            case 'logic': {
                const l = this.node(n.left);
                const r = this.node(n.right);
                for (const [p, node] of [[l, n.left], [r, n.right]] as const) {
                    if (!isNum(p.shape)) fail('values.problem.notNumber', { what: shapeText(p.shape) }, node.s);
                }
                const lf = l.f;
                const rf = r.f;
                if (n.op === '&&') return fold([l, r], () => (toReal(lf()) ? rf() : lf()), NUM);
                return fold([l, r], () => (toReal(lf()) ? lf() : rf()), NUM);
            }
            case 'ternary': {
                const test = this.node(n.test);
                if (!isNum(test.shape)) fail('values.problem.notNumber', { what: shapeText(test.shape) }, n.test.s);
                const a = this.node(n.then);
                const b = this.node(n.else);
                const tf = test.f;
                const af = a.f;
                const bf = b.f;
                const shape = sameShape(a.shape, b.shape) && a.shape.k !== 'any' ? a.shape : ANY;
                if (test.k) return toReal(tf()) ? a : b;
                return dyn(() => (toReal(tf()) ? af() : bf()), shape);
            }
            case 'vec': {
                const items = n.items.map((it) => this.node(it));
                items.forEach((p, i) => {
                    if (!isNum(p.shape)) fail('values.problem.realEntries', { what: shapeText(p.shape) }, n.items[i].s);
                });
                const fs = items.map((p) => p.f);
                return fold(items, () => vec(fs.map((f) => toReal(f()))), vecShape(items.length));
            }
            case 'mat': {
                const cells = n.rows.map((row) => row.map((it) => this.node(it)));
                n.rows.forEach((row, i) =>
                    row.forEach((it, j) => {
                        if (!isNum(cells[i][j].shape)) fail('values.problem.realEntries', { what: shapeText(cells[i][j].shape) }, it.s);
                    })
                );
                const rows = n.rows.length;
                const cols = n.rows[0].length;
                const fs = cells.flat().map((p) => p.f);
                return fold(cells.flat(), () => mat(rows, cols, fs.map((f) => toReal(f()))), matShape(rows, cols));
            }
            case 'list': {
                const items = n.items.map((it) => this.node(it));
                const first = items.length ? items[0].shape : ANY;
                const of = items.every((p) => sameShape(p.shape, first)) ? first : ANY;
                const fs = items.map((p) => p.f);
                return fold(items, () => list(fs.map((f) => f())), listShape(of));
            }
            case 'comp': {
                const lo = this.node(n.lo);
                const hi = this.node(n.hi);
                if (!isNum(lo.shape)) fail('values.problem.notNumber', { what: shapeText(lo.shape) }, n.lo.s);
                if (!isNum(hi.shape)) fail('values.problem.notNumber', { what: shapeText(hi.shape) }, n.hi.s);
                const cell: Cell = { v: NaN };
                const body = this.with(n.index, cell, NUM).node(n.body);
                const lf = lo.f;
                const hf = hi.f;
                const bf = body.f;
                return dyn(() => {
                    const range = termRange(toReal(lf()), toReal(hf()));
                    if (!range) return list([]);
                    const saved = cell.v;
                    const out: Value[] = [];
                    for (let k = range[0]; k <= range[1]; k++) {
                        cell.v = k;
                        out.push(bf());
                    }
                    cell.v = saved;
                    return list(out);
                }, listShape(body.shape));
            }
        }
    }

    // ------------------------------------------------------------- names

    private name(name: string, s: number, e: number): Part {
        const { env, defs, locals } = this.scope;
        const local = locals ? locals.find(name) : null;
        if (local) {
            const cell = local.cell;
            return dyn(() => cell.v, local.shape);
        }
        for (let i = 0; i < env.vars.length; i++) {
            // Axis variables outside a local (a formula of the chart compiled here) have no value.
            if (env.vars[i].includes(name)) return konst(NaN, NUM);
        }
        const scalar = env.scalar(name);
        if (scalar) return dyn(scalar.read, NUM);
        const fnRef = env.fn(name);
        if (fnRef) {
            const err = env.bareFnError(name);
            if (err) throw new ExprError(err, { pos: s });
            if (fnRef.error) fail('problems.expr.dependsOnError', { name }, s);
            // A bare function name means f of the first axis variable.
            const x = this.firstVariable();
            const call = fnRef.call;
            return dyn(() => call(toReal(x())), NUM);
        }
        const c = constantValue(name);
        if (c !== undefined) return konst(c, NUM);
        const def = defs ? this.def(name, s) : null;
        if (def) {
            if (def.value) return dyn(def.value.read, def.value.shape);
            fail('values.problem.needsArguments', { name, count: def.fn ? def.fn.params.length : 0 }, s);
        }
        if (name === 'i') return konst(I, COMPLEX);
        const part = this.component(name, s, e);
        if (part) return part;
        // LaTeX: letters side by side multiply ($ix$ is i x, $2\pi i k$).
        if (isLatexFormula(this.scope.src) || /^[A-Za-z]{2,}$/.test(name)) {
            const product = this.letters(name, s, e);
            if (product) return product;
        }
        throw unknownNameError(name, s, e, this.lookupEnv(), this.scope.src);
    }

    /** The first axis variable as a part (NaN when the field has none). */
    private firstVariable(): () => Value {
        const names = this.scope.env.vars[0] || [];
        const locals = this.scope.locals;
        for (const n of names) {
            const l = locals ? locals.find(n) : null;
            if (l) {
                const cell = l.cell;
                return () => cell.v;
            }
        }
        return () => NaN;
    }

    /** A let definition, with its problem as an ExprError at the name. */
    private def(name: string, s: number): DefRef | null {
        const defs = this.scope.defs;
        if (!defs || !defs.has(name)) return null;
        try {
            return defs.ref(name);
        } catch (e) {
            if (e instanceof ExprError) throw new ExprError(e.message, { pos: s });
            throw e;
        }
    }

    /** v_x, v_y, v_z, v_1, ...: a part of a let vector (or of a local one). */
    private component(name: string, s: number, e: number): Part | null {
        const m = COMPONENT_RE.exec(name);
        if (!m) return null;
        const [, base, which] = m;
        const index = Object.prototype.hasOwnProperty.call(COMPONENT_INDEX, which) ? COMPONENT_INDEX[which] : Number(which) - 1;
        const locals = this.scope.locals;
        const known = (locals && locals.find(base)) || (this.scope.defs && this.scope.defs.has(base) && !inEnv(base, this.scope.env));
        if (!known) return null;
        const whole = this.name(base, s, e);
        if (whole.shape.k !== 'vec' && whole.shape.k !== 'any') return null;
        if (whole.shape.k === 'vec' && whole.shape.n && index >= whole.shape.n) fail('values.problem.noComponent', { name, n: whole.shape.n }, s);
        const f = whole.f;
        return dyn(() => {
            const v = f();
            return typeof v !== 'number' && v.kind === 'vec' && index < v.v.length ? v.v[index] : NaN;
        }, NUM);
    }

    /** `ix`, `ik` in LaTeX: the product of the names it is made of, when each one is known. */
    private letters(name: string, s: number, e: number): Part | null {
        const known = this.knownNames();
        const parts = splitName(name, known, () => false, false);
        if (!parts || parts.length < 2 || parts.some((p) => !known.includes(p))) return null;
        let out: Part | null = null;
        for (const p of parts) {
            const part = this.name(p, s, e);
            out = out ? this.product(out, part, s, false) : part;
        }
        return out;
    }

    private knownNames(): string[] {
        const { env, defs, locals } = this.scope;
        return [...env.knownNames(), ...(locals ? locals.names() : []), ...(defs ? defs.names().filter((n) => !defs.isFunction(n)) : []), 'i'];
    }

    /** The Env with the locals and the let names known, for the quick fixes of an unknown name. */
    private lookupEnv(): Env {
        const { env, locals, defs } = this.scope;
        const extra = [...(locals ? locals.names() : []), ...(defs ? defs.names() : [])];
        if (!extra.length) return env;
        return { ...env, knownNames: () => [...env.knownNames(), ...extra], noSlider: (n) => extra.includes(n) || env.noSlider(n) };
    }

    // ------------------------------------------------------------ binary

    private binary(n: Extract<VNode, { t: 'binary' }>): Part {
        // A^T, A^{\top}: the transpose (when T is no name of the chart).
        if (n.op === '^' && n.right.t === 'name' && TRANSPOSE.has(n.right.name) && !this.resolves(n.right.name)) {
            const a = this.node(n.left);
            if (a.shape.k !== 'mat' && a.shape.k !== 'vec' && a.shape.k !== 'any') fail('values.problem.transpose', { what: shapeText(a.shape) }, n.s);
            const f = a.f;
            const shape = a.shape.k === 'mat' ? matShape(a.shape.c, a.shape.r) : a.shape;
            return fold([a], () => transposeOf(f()), shape);
        }
        const l = this.node(n.left);
        const r = this.node(n.right);
        return this.apply(n.op, l, r, n.s, !!n.cross);
    }

    private apply(op: string, l: Part, r: Part, pos: number, crossed: boolean): Part {
        const lf = l.f;
        const rf = r.f;
        switch (op) {
            case '+':
            case '-': {
                const shape = addShape(l.shape, r.shape);
                if (!shape) fail(op === '+' ? 'values.problem.add' : 'values.problem.subtract', { left: shapeText(l.shape), right: shapeText(r.shape) }, pos);
                return fold([l, r], op === '+' ? () => add(lf(), rf()) : () => sub(lf(), rf()), shape);
            }
            case '*':
                if (crossed && (l.shape.k === 'vec' || r.shape.k === 'vec')) {
                    const ok = l.shape.k === 'vec' && r.shape.k === 'vec' && sameShape(l.shape, r.shape) && (l.shape.n === 2 || l.shape.n === 3 || !l.shape.n);
                    if (!ok && l.shape.k !== 'any' && r.shape.k !== 'any') fail('values.problem.cross', { left: shapeText(l.shape), right: shapeText(r.shape) }, pos);
                    const shape = l.shape.k === 'vec' && l.shape.n === 2 ? NUM : l.shape.k === 'vec' && l.shape.n === 3 ? vecShape(3) : ANY;
                    return fold([l, r], () => cross(lf(), rf()), shape);
                }
                return this.product(l, r, pos, true);
            case '/': {
                const shape = divShape(l.shape, r.shape);
                if (!shape) fail('values.problem.divide', { left: shapeText(l.shape), right: shapeText(r.shape) }, pos);
                return fold([l, r], () => div(lf(), rf()), shape);
            }
            case '%': {
                if (!isNum(l.shape) || !isNum(r.shape)) fail('values.problem.notNumber', { what: shapeText(isNum(l.shape) ? r.shape : l.shape) }, pos);
                return fold([l, r], () => toReal(lf()) % toReal(rf()), NUM);
            }
            default: {
                const shape = powShape(l.shape, r.shape);
                if (!shape) fail('values.problem.power', { left: shapeText(l.shape), right: shapeText(r.shape) }, pos);
                return fold([l, r], () => pow(lf(), rf()), shape);
            }
        }
    }

    private product(l: Part, r: Part, pos: number, check: boolean): Part {
        const shape = mulShape(l.shape, r.shape);
        if (!shape) {
            if (!check) return dyn(() => NaN, ANY);
            fail('values.problem.multiply', { left: shapeText(l.shape), right: shapeText(r.shape) }, pos);
        }
        const lf = l.f;
        const rf = r.f;
        return fold([l, r], () => mul(lf(), rf()), shape);
    }

    /** The name means something here (then T is that, not the transpose). */
    private resolves(name: string): boolean {
        const { env, defs, locals } = this.scope;
        return !!(locals && locals.find(name)) || inEnv(name, env) || !!(defs && defs.has(name));
    }

    // ------------------------------------------------------------- calls

    private call(n: VCall): Part {
        const { env } = this.scope;
        const index = seriesOf(n);
        if (index !== null) return this.series(n, index);
        const args = (): Part[] => n.args.map((a) => this.node(a));
        const local = this.scope.locals ? this.scope.locals.find(n.name) : null;
        if (local && !n.math) return this.implicit(n, this.name(n.name, n.ns, n.ne));
        const builtin = builtinFunction(n.name, n.math);
        if (builtin) {
            if (n.args.length < builtin.min || n.args.length > builtin.max) {
                fail(builtin.min === builtin.max ? 'problems.expr.takesArguments' : 'problems.expr.takesAtLeast', { name: n.name, count: builtin.min }, n.ns);
            }
            return this.builtin(n.name, builtin.fn, builtin.pure, args(), n);
        }
        if (n.math) throw unknownFunctionError(n, env, this.scope.src);
        const def = this.def(n.name, n.ns);
        if (def && def.fn) return this.letCall(n, def);
        if (inEnv(n.name, env)) {
            const ref = env.fn(n.name);
            if (ref) {
                if (ref.kind === 'parametric') fail('problems.expr.parametricCall', { name: n.name }, n.ns);
                if (ref.error) fail('problems.expr.dependsOnError', { name: n.name }, n.ns);
                if (n.args.length !== 1) fail('problems.expr.takesArguments', { name: n.name, count: 1 }, n.ns);
                const a = this.node(n.args[0]);
                if (!isNum(a.shape)) fail('values.problem.chartFunction', { name: n.name, what: shapeText(a.shape) }, n.args[0].s);
                const af = a.f;
                const call = ref.call;
                return dyn(() => call(toReal(af())), NUM);
            }
            return this.implicit(n, this.name(n.name, n.ns, n.ne));
        }
        if (def && def.value) return this.implicit(n, this.name(n.name, n.ns, n.ne));
        if (n.name === 'grad') return this.gradient(n);
        if (Object.prototype.hasOwnProperty.call(VALUE_FUNCTIONS, n.name)) {
            const vf = VALUE_FUNCTIONS[n.name];
            if (n.args.length < vf.min || n.args.length > vf.max) fail('problems.expr.takesArguments', { name: n.name, count: vf.min }, n.ns);
            const parts = args();
            const fs = parts.map((p) => p.f);
            const fn = vf.fn;
            return fold(parts, () => fn(fs.map((f) => f())), this.valueFunctionShape(n.name, parts, n));
        }
        if (n.name === 'i' && n.args.length === 1) return this.product(konst(I, COMPLEX), this.node(n.args[0]), n.s, true);
        throw unknownFunctionError(n, env, this.scope.src);
    }

    /** `a(x + 1)` with a value a: a times (x + 1); `A(1, 2)` is A times the vector (1, 2). */
    private implicit(n: VCall, left: Part): Part {
        if (!n.args.length) fail('problems.expr.notAFunction', { name: n.name }, n.ns);
        if (n.args.length > 1) {
            const open = n.ns + n.name.length;
            return this.product(left, this.node({ t: 'vec', items: n.args, s: open, e: n.e }), n.s, true);
        }
        return this.product(left, this.node(n.args[0]), n.s, true);
    }

    private builtin(name: string, fn: (...args: number[]) => number, pure: boolean, parts: Part[], n: VCall): Part {
        const fs = parts.map((p) => p.f);
        const make = (f: () => Value, shape: Shape) => (pure ? fold(parts, f, shape) : dyn(f, shape));
        if (parts.every((p) => p.shape.k === 'num')) {
            if (fs.length === 1) {
                const g = fs[0];
                return make(() => fn(g() as number), NUM);
            }
            return make(() => fn(...fs.map((f) => f() as number)), NUM);
        }
        if (name === 'abs') {
            const s = parts[0].shape;
            const shape = s.k === 'list' ? listShape(NUM) : NUM;
            return make(() => abs(fs[0]()), shape);
        }
        if (name === 'pow' && parts.length === 2) return this.apply('^', parts[0], parts[1], n.s, false);
        if (parts.length === 1 && Object.prototype.hasOwnProperty.call(COMPLEX_FUNCTIONS, name)) {
            const s = parts[0].shape;
            if (s.k === 'vec' || s.k === 'mat') fail('values.problem.function', { name, what: shapeText(s) }, n.args[0].s);
            const real = (v: number) => fn(v);
            const shape = s.k === 'list' ? listShape(s.of.k === 'num' ? NUM : COMPLEX) : s.k === 'any' ? ANY : COMPLEX;
            return make(() => complexFunction(name, real, fs[0]()), shape);
        }
        parts.forEach((p, i) => {
            if (p.shape.k !== 'num' && p.shape.k !== 'any' && p.shape.k !== 'list') fail('values.problem.function', { name, what: shapeText(p.shape) }, n.args[i].s);
        });
        const shape = parts.some((p) => p.shape.k === 'list') ? listShape(NUM) : NUM;
        return make(() => realFunction(fn, fs.map((f) => f())), shape);
    }

    private valueFunctionShape(name: string, parts: Part[], n: VCall): Shape {
        const s = parts[0] ? parts[0].shape : ANY;
        const want = (ok: boolean) => {
            if (!ok && s.k !== 'any') fail('values.problem.function', { name, what: shapeText(s) }, n.args[0].s);
        };
        switch (name) {
            case 're':
            case 'im':
            case 'arg':
                want(isScalar(s) || s.k === 'list' || (name === 'arg' && s.k === 'vec'));
                return s.k === 'list' ? listShape(NUM) : NUM;
            case 'conj':
                return s;
            case 'norm':
            case 'len':
                return NUM;
            case 'det':
            case 'tr':
                want(s.k === 'mat');
                if (s.k === 'mat' && s.r && s.c && s.r !== s.c) fail('values.problem.square', { what: shapeText(s) }, n.args[0].s);
                return NUM;
            case 'inv':
                want(s.k === 'mat' || isScalar(s));
                return s;
            case 'transpose':
                return s.k === 'mat' ? matShape(s.c, s.r) : s;
            case 'dot':
            case 'angle':
                want(s.k === 'vec');
                return NUM;
            case 'cross':
                want(s.k === 'vec');
                return s.k === 'vec' && s.n === 2 ? NUM : s;
            case 'unit':
                want(s.k === 'vec' || s.k === 'complex');
                return s;
            default:
                return ANY;
        }
    }

    /** A let function called: its body for these argument shapes, its parameters written first. */
    private letCall(n: VCall, def: DefRef): Part {
        const fn = def.fn as NonNullable<DefRef['fn']>;
        if (n.args.length !== fn.params.length) fail('problems.expr.takesArguments', { name: n.name, count: fn.params.length }, n.ns);
        const parts = n.args.map((a) => this.node(a));
        let inst: { cells: Cell[]; body: Part };
        try {
            inst = fn.instance(parts.map((p) => p.shape));
        } catch (e) {
            if (e instanceof ExprError) throw new ExprError(msg('values.problem.inFunction', { name: n.name, message: e.message }), { pos: n.ns });
            throw e;
        }
        const fs = parts.map((p) => p.f);
        const cells = inst.cells;
        const body = inst.body.f;
        const count = fs.length;
        const vals: Value[] = new Array<Value>(count);
        return dyn(() => {
            if (depth >= MAX_DEPTH) return NaN;
            for (let i = 0; i < count; i++) vals[i] = fs[i]();
            const saved = cells.map((c) => c.v);
            for (let i = 0; i < count; i++) cells[i].v = vals[i];
            depth++;
            try {
                return body();
            } finally {
                depth--;
                for (let i = 0; i < count; i++) cells[i].v = saved[i];
            }
        }, inst.body.shape);
    }

    /** sum(body, k, lo, hi) and prod: of numbers, complex numbers, vectors or matrices. */
    private series(n: VCall, index: string): Part {
        const lo = this.node(n.args[2]);
        const hi = this.node(n.args[3]);
        if (!isNum(lo.shape)) fail('values.problem.notNumber', { what: shapeText(lo.shape) }, n.args[2].s);
        if (!isNum(hi.shape)) fail('values.problem.notNumber', { what: shapeText(hi.shape) }, n.args[3].s);
        const cell: Cell = { v: NaN };
        const body = this.with(index, cell, NUM).node(n.args[0]);
        const product = n.name === 'prod';
        if (product && !isScalar(body.shape) && body.shape.k !== 'mat') fail('values.problem.multiply', { left: shapeText(body.shape), right: shapeText(body.shape) }, n.s);
        if (body.shape.k === 'list') fail('values.problem.add', { left: shapeText(body.shape), right: shapeText(body.shape) }, n.s);
        const lf = lo.f;
        const hf = hi.f;
        const bf = body.f;
        return dyn(() => {
            const range = termRange(toReal(lf()), toReal(hf()));
            if (!range) return NaN;
            const saved = cell.v;
            let acc: Value | null = null;
            for (let k = range[0]; k <= range[1]; k++) {
                cell.v = k;
                const t = bf();
                acc = acc === null ? t : product ? mul(acc, t) : add(acc, t);
            }
            cell.v = saved;
            return acc === null ? (product ? 1 : 0) : acc;
        }, body.shape);
    }

    /**
     * grad(f, p), \nabla f(p): the gradient of a let function by central
     * differences, at a point given as numbers, as one vector, or (no point)
     * at the axis variables of the field.
     */
    private gradient(n: VCall): Part {
        const target = n.args[0];
        if (!target || target.t !== 'name') fail('values.problem.gradTakes', {}, n.ns);
        const def = this.def(target.name, target.s);
        if (!def || !def.fn) fail('values.problem.gradTakes', {}, target.s);
        const params = def.fn.params.length;
        const inst = def.fn.instance(def.fn.params.map(() => NUM));
        if (!isNum(inst.body.shape)) fail('values.problem.gradNumber', { name: target.name }, target.s);
        let point: Array<() => Value>;
        let spread = false;
        if (n.args.length === 1) {
            const names = this.scope.env.vars.slice(0, params);
            if (names.length < params) fail('values.problem.gradPoint', { name: target.name, count: params, got: names.length }, n.ns);
            point = names.map((aliases) => {
                const l = aliases.map((a) => (this.scope.locals ? this.scope.locals.find(a) : null)).find((x) => x);
                const cell = l ? l.cell : { v: NaN };
                return () => cell.v;
            });
        } else if (n.args.length === 2) {
            const p = this.node(n.args[1]);
            if (params === 1 && isNum(p.shape)) point = [p.f];
            else {
                if (p.shape.k !== 'vec' && p.shape.k !== 'any') fail('values.problem.gradPoint', { name: target.name, count: params, got: 1 }, n.args[1].s);
                if (p.shape.k === 'vec' && p.shape.n && p.shape.n !== params) fail('values.problem.gradPoint', { name: target.name, count: params, got: p.shape.n }, n.args[1].s);
                point = [p.f];
                spread = true;
            }
        } else {
            if (n.args.length - 1 !== params) fail('values.problem.gradPoint', { name: target.name, count: params, got: n.args.length - 1 }, n.ns);
            point = n.args.slice(1).map((a) => {
                const p = this.node(a);
                if (!isNum(p.shape)) fail('values.problem.notNumber', { what: shapeText(p.shape) }, a.s);
                return p.f;
            });
        }
        const cells = inst.cells;
        const body = inst.body.f;
        return dyn(() => {
            let at: number[];
            if (spread) {
                const v = point[0]();
                if (typeof v === 'number' || v.kind !== 'vec' || v.v.length !== params) return NaN;
                at = v.v.slice();
            } else at = point.map((f) => toReal(f()));
            if (depth >= MAX_DEPTH) return NaN;
            const saved = cells.map((c) => c.v);
            depth++;
            try {
                return vec(gradientAt((p) => {
                    for (let i = 0; i < params; i++) cells[i].v = p[i];
                    return toReal(body());
                }, at));
            } finally {
                depth--;
                cells.forEach((c, i) => (c.v = saved[i]));
            }
        }, vecShape(params));
    }
}

/** The gradient of f at p by central differences (a step of 1e-5 of each coordinate's size). */
export function gradientAt(f: (p: number[]) => number, p: readonly number[]): number[] {
    const out: number[] = [];
    const q = p.slice();
    for (let i = 0; i < p.length; i++) {
        const h = 1e-5 * Math.max(1, Math.abs(p[i]));
        q[i] = p[i] + h;
        const up = f(q);
        q[i] = p[i] - h;
        const down = f(q);
        q[i] = p[i];
        out.push((up - down) / (2 * h));
    }
    return out;
}

function compare(op: string, l: number, r: number): boolean {
    switch (op) {
        case '<':
            return l < r;
        case '<=':
            return l <= r;
        case '>':
            return l > r;
        case '>=':
            return l >= r;
        case '==':
            return l === r;
        default:
            return l !== r;
    }
}

// ------------------------------------------------------- the formulas of a chart

/** Locals for the axis variables of an Env: one cell per variable, each alias names it. */
export function variableLocals(env: Env, cells: Cell[], parent: Locals | null = null): Locals | null {
    let out = parent;
    env.vars.forEach((aliases, i) => {
        for (const a of aliases) out = new Locals(out, a, cells[i], NUM);
    });
    return out;
}

/**
 * Does the formula need the typed path? It does when it reads a let name,
 * i (that is no name of the chart), a vector, matrix or list, or a function
 * of values (re, det, grad, ...) that is no name of the chart. Never throws.
 */
export function needsValues(n: VNode, env: Env, defs: Definitions | null, src: string, locals: ReadonlySet<string> = new Set()): boolean {
    switch (n.t) {
        case 'vec':
        case 'mat':
        case 'list':
            return true;
        case 'comp':
            return true;
        case 'name': {
            const name = n.name;
            if (locals.has(name) || inEnv(name, env)) return false;
            if ((defs && defs.has(name)) || name === 'i') return true;
            const m = COMPONENT_RE.exec(name);
            if (m && ((defs && defs.has(m[1])) || locals.has(m[1]))) return true;
            if (isLatexFormula(src) && /^[A-Za-z]{2,}$/.test(name)) {
                const known = [...env.knownNames(), ...(defs ? defs.names() : []), ...locals, 'i'];
                const parts = splitName(name, known, () => false, false);
                if (parts && parts.every((p) => known.includes(p)) && parts.some((p) => p === 'i' || (defs && defs.has(p) && !inEnv(p, env)))) return true;
            }
            return false;
        }
        case 'call': {
            const index = seriesOf(n);
            if (index !== null) {
                const inner = new Set(locals);
                inner.add(index);
                return needsValues(n.args[2], env, defs, src, locals) || needsValues(n.args[3], env, defs, src, locals) || needsValues(n.args[0], env, defs, src, inner);
            }
            const known = builtinFunction(n.name, n.math) || n.math || locals.has(n.name) || inEnv(n.name, env);
            if (!known && ((defs && defs.has(n.name)) || n.name === 'grad' || Object.prototype.hasOwnProperty.call(VALUE_FUNCTIONS, n.name))) return true;
            return n.args.some((a) => needsValues(a, env, defs, src, locals));
        }
        default:
            return children(n).some((c) => needsValues(c, env, defs, src, locals));
    }
}

/** Is the shape what a field of numbers can show (a number, or a complex number that may be real)? */
export function numberLike(s: Shape): boolean {
    return s.k === 'num' || s.k === 'complex' || s.k === 'any';
}

/** The values of a list (a list stays, anything else is a list of one), for point lists. */
export function itemsOf(v: Value): readonly Value[] {
    return isList(v) ? v.items : [v];
}

export { complex };
