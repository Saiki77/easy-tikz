/*
 * 6.0 A: pgfmath text of a formula that uses values, for the export of a
 * function or a surface (`plot $g(x) = f(x, 1)$` with `let f(x, y) = ...`,
 * `plot $f(x) = |e^{ix} + c|$`). Values without a variable are numbers at
 * the sliders' values; a complex number with a variable is written as its
 * real and imaginary parts, a vector as its numbers, so the text is real
 * pgfmath. Let functions are written out with their arguments, chart
 * functions as src/expr.ts writes them, sums term by term. What has no
 * pgfmath form here (a list, a gradient, a factorial of a variable) throws
 * an ExprError; the export then writes the curve as coordinates.
 * Pure: no DOM, no Obsidian.
 */
import { Env, ExprError, builtinFunction, constantValue, toPgf } from '../expr';
import { t as msg } from '../i18n';
import type { Definitions } from './compile';
import { seriesOf } from './compile';
import type { VNode } from './parse';
import { Value } from './types';
import { termRange } from './special';
// 6.0 G
import { ValueCompiler } from './compile';
import { children } from './parse';
import { geogebraNeeds } from '../geogebra/commands';

/** A real number in the text: a constant, or pgfmath text that is safe as an operand. */
type R = number | string;

type PV =
    | { k: 'num'; r: R }
    | { k: 'cx'; re: R; im: R }
    | { k: 'vec'; v: R[] }
    | { k: 'mat'; rows: number; cols: number; a: R[] };

/** Real functions and their pgfmath names (with `trig format plots=rad`, as the export sets). */
const PGF_REAL: Record<string, string> = {
    sin: 'sin', cos: 'cos', tan: 'tan', atan: 'atan', atan2: 'atan2', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
    exp: 'exp', log: 'ln', ln: 'ln', sqrt: 'sqrt', abs: 'abs', sign: 'sign', floor: 'floor', ceil: 'ceil',
    min: 'min', max: 'max', sec: 'sec', cot: 'cot', csc: 'cosec', log10: 'log10', log2: 'log2', trunc: 'int',
};

/** Most terms of a sum written out. */
const MAX_TERMS = 400;

class ValuePgf {
    constructor(
        private env: Env,
        private defs: Definitions | null,
        private outVars: string[],
        private fmt: (n: number) => string
    ) {}

    private none(what: string): never {
        throw new ExprError(msg('values.problem.noPgf', { what }));
    }

    // ------------------------------------------------------------ reals

    text(r: R): string {
        if (typeof r === 'string') return r;
        const s = this.fmt(r);
        return s.startsWith('-') ? `(${s})` : s;
    }

    private bin(a: R, op: string, b: R): R {
        return `(${this.text(a)}${op}${this.text(b)})`;
    }

    add(a: R, b: R): R {
        if (typeof a === 'number' && typeof b === 'number') return a + b;
        if (a === 0) return b;
        if (b === 0) return a;
        return this.bin(a, '+', b);
    }

    sub(a: R, b: R): R {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        if (b === 0) return a;
        if (a === 0) return this.neg(b);
        return this.bin(a, '-', b);
    }

    mul(a: R, b: R): R {
        if (typeof a === 'number' && typeof b === 'number') return a * b;
        if (a === 0 || b === 0) return 0;
        if (a === 1) return b;
        if (b === 1) return a;
        return this.bin(a, '*', b);
    }

    div(a: R, b: R): R {
        if (typeof a === 'number' && typeof b === 'number') return a / b;
        if (b === 1) return a;
        return this.bin(a, '/', b);
    }

    neg(a: R): R {
        return typeof a === 'number' ? -a : `(-${a})`;
    }

    pow(a: R, b: R): R {
        if (typeof a === 'number' && typeof b === 'number') return Math.pow(a, b);
        if (b === 1) return a;
        return this.bin(a, '^', b);
    }

    fn(name: string, args: R[]): R {
        const b = builtinFunction(name);
        if (b && args.every((a) => typeof a === 'number')) return b.fn(...(args as number[]));
        if (name === 'round') return `floor(${this.text(args[0])}+0.5)`;
        const mapped = Object.prototype.hasOwnProperty.call(PGF_REAL, name) ? PGF_REAL[name] : null;
        if (!mapped) this.none(`${name}(...)`);
        return `${mapped}(${args.map((a) => this.text(a)).join(',')})`;
    }

    private hypot(parts: R[]): R {
        if (parts.every((p) => typeof p === 'number')) return Math.hypot(...(parts as number[]));
        let acc = parts[0];
        for (let i = 1; i < parts.length; i++) acc = `veclen(${this.text(acc)},${this.text(parts[i])})`;
        return parts.length === 1 ? this.fn('abs', [acc]) : acc;
    }

    // ------------------------------------------------------------ values

    fromValue(v: Value): PV {
        if (typeof v === 'number') return { k: 'num', r: v };
        switch (v.kind) {
            case 'complex':
                return { k: 'cx', re: v.re, im: v.im };
            case 'vec':
                return { k: 'vec', v: v.v.slice() };
            case 'mat':
                return { k: 'mat', rows: v.rows, cols: v.cols, a: v.a.slice() };
            default:
                return this.none('a list');
        }
    }

    private real(p: PV, what: string): R {
        if (p.k === 'num') return p.r;
        if (p.k === 'cx' && p.im === 0) return p.re;
        return this.none(what);
    }

    private cx(p: PV): { re: R; im: R } {
        if (p.k === 'num') return { re: p.r, im: 0 };
        if (p.k === 'cx') return p;
        return this.none('a vector');
    }

    private isScalar(p: PV): boolean {
        return p.k === 'num' || p.k === 'cx';
    }

    private cmul(a: { re: R; im: R }, b: { re: R; im: R }): PV {
        return { k: 'cx', re: this.sub(this.mul(a.re, b.re), this.mul(a.im, b.im)), im: this.add(this.mul(a.re, b.im), this.mul(a.im, b.re)) };
    }

    // ------------------------------------------------------------- nodes

    node(n: VNode, locals: Map<string, PV>): PV {
        switch (n.t) {
            case 'num':
                return { k: 'num', r: n.value };
            case 'member': {
                const v = constantValue(n.name);
                return { k: 'num', r: v === undefined ? NaN : v };
            }
            case 'name':
                return this.name(n.name, locals);
            case 'call':
                return this.call(n, locals);
            case 'unary': {
                const a = this.node(n.arg, locals);
                if (n.op === '+') return a;
                if (n.op === '!') return { k: 'num', r: `(!(${this.text(this.real(a, '!'))}))` };
                return this.negate(a);
            }
            case 'binary':
                // e^w is exp(w), for a complex w too.
                if (n.op === '^' && n.left.t === 'name' && n.left.name === 'e' && !locals.has('e') && !this.env.scalar('e')) return this.cexp(this.cx(this.node(n.right, locals)));
                return this.binary(n.op, this.node(n.left, locals), this.node(n.right, locals), !!n.cross);
            case 'cmp': {
                const args = n.args.map((a) => this.text(this.real(this.node(a, locals), 'a comparison')));
                const pairs = n.ops.map((op, i) => `(${args[i]}${op}${args[i + 1]})`);
                return { k: 'num', r: `(${pairs.join(' && ')})` };
            }
            case 'logic': {
                const l = this.text(this.real(this.node(n.left, locals), 'and / or'));
                const r = this.text(this.real(this.node(n.right, locals), 'and / or'));
                return { k: 'num', r: `((${l}) ${n.op} (${r}))` };
            }
            case 'ternary': {
                const test = this.text(this.real(this.node(n.test, locals), 'a condition'));
                const a = this.node(n.then, locals);
                const b = this.node(n.else, locals);
                if (a.k === 'num' && b.k === 'num') return { k: 'num', r: `((${test}) ? ${this.text(a.r)} : ${this.text(b.r)})` };
                return this.none('a condition with values');
            }
            case 'vec':
                return { k: 'vec', v: n.items.map((it) => this.real(this.node(it, locals), 'a vector')) };
            case 'mat':
                return { k: 'mat', rows: n.rows.length, cols: n.rows[0].length, a: n.rows.flat().map((it) => this.real(this.node(it, locals), 'a matrix')) };
            default:
                return this.none('a list');
        }
    }

    private negate(a: PV): PV {
        switch (a.k) {
            case 'num':
                return { k: 'num', r: this.neg(a.r) };
            case 'cx':
                return { k: 'cx', re: this.neg(a.re), im: this.neg(a.im) };
            case 'vec':
                return { k: 'vec', v: a.v.map((x) => this.neg(x)) };
            case 'mat':
                return { ...a, a: a.a.map((x) => this.neg(x)) };
        }
    }

    private name(name: string, locals: Map<string, PV>): PV {
        const local = locals.get(name);
        if (local) return local;
        const { env, defs } = this;
        for (let i = 0; i < env.vars.length; i++) if (env.vars[i].includes(name)) return { k: 'num', r: this.outVars[i] };
        const scalar = env.scalar(name);
        if (scalar) return { k: 'num', r: scalar.read() };
        if (env.fn(name)) return this.none(name);
        if (name === 'pi' || name === 'π') return { k: 'num', r: 'pi' };
        if (name === 'e') return { k: 'num', r: 'e' };
        const c = constantValue(name);
        if (c !== undefined) return { k: 'num', r: c };
        const ref = defs && defs.has(name) ? defs.ref(name) : null;
        if (ref && ref.value) return this.fromValue(ref.value.read());
        if (name === 'i') return { k: 'cx', re: 0, im: 1 };
        const m = /^(.+)_(x|y|z|[1-9])$/.exec(name);
        if (m) {
            const whole = this.name(m[1], locals);
            const index = m[2] === 'x' ? 0 : m[2] === 'y' ? 1 : m[2] === 'z' ? 2 : Number(m[2]) - 1;
            if (whole.k === 'vec' && index < whole.v.length) return { k: 'num', r: whole.v[index] };
        }
        return this.none(name);
    }

    private binary(op: string, a: PV, b: PV, crossed: boolean): PV {
        switch (op) {
            case '+':
            case '-': {
                const f = (x: R, y: R) => (op === '+' ? this.add(x, y) : this.sub(x, y));
                if (a.k === 'num' && b.k === 'num') return { k: 'num', r: f(a.r, b.r) };
                if (this.isScalar(a) && this.isScalar(b)) {
                    const x = this.cx(a);
                    const y = this.cx(b);
                    return { k: 'cx', re: f(x.re, y.re), im: f(x.im, y.im) };
                }
                if (a.k === 'vec' && b.k === 'vec' && a.v.length === b.v.length) return { k: 'vec', v: a.v.map((x, i) => f(x, b.v[i])) };
                if (a.k === 'mat' && b.k === 'mat' && a.rows === b.rows && a.cols === b.cols) return { ...a, a: a.a.map((x, i) => f(x, b.a[i])) };
                return this.none('a sum of values');
            }
            case '*': {
                if (a.k === 'num' && b.k === 'num') return { k: 'num', r: this.mul(a.r, b.r) };
                if (this.isScalar(a) && this.isScalar(b)) return this.cmul(this.cx(a), this.cx(b));
                if (crossed && a.k === 'vec' && b.k === 'vec') {
                    if (a.v.length === 2 && b.v.length === 2) return { k: 'num', r: this.sub(this.mul(a.v[0], b.v[1]), this.mul(a.v[1], b.v[0])) };
                    if (a.v.length === 3 && b.v.length === 3) {
                        const [x1, y1, z1] = a.v;
                        const [x2, y2, z2] = b.v;
                        return { k: 'vec', v: [this.sub(this.mul(y1, z2), this.mul(z1, y2)), this.sub(this.mul(z1, x2), this.mul(x1, z2)), this.sub(this.mul(x1, y2), this.mul(y1, x2))] };
                    }
                }
                if (a.k === 'num' && (b.k === 'vec' || b.k === 'mat')) return this.scale(b, a.r);
                if (b.k === 'num' && (a.k === 'vec' || a.k === 'mat')) return this.scale(a, b.r);
                if (a.k === 'vec' && b.k === 'vec' && a.v.length === b.v.length) return { k: 'num', r: this.dot(a.v, b.v) };
                if (a.k === 'mat' && b.k === 'vec' && a.cols === b.v.length) {
                    return { k: 'vec', v: Array.from({ length: a.rows }, (_, i) => this.dot(a.a.slice(i * a.cols, (i + 1) * a.cols), b.v)) };
                }
                if (a.k === 'mat' && b.k === 'mat' && a.cols === b.rows) {
                    const out: R[] = [];
                    for (let i = 0; i < a.rows; i++) {
                        for (let j = 0; j < b.cols; j++) {
                            out.push(this.dot(a.a.slice(i * a.cols, (i + 1) * a.cols), Array.from({ length: b.rows }, (_, k) => b.a[k * b.cols + j])));
                        }
                    }
                    return { k: 'mat', rows: a.rows, cols: b.cols, a: out };
                }
                return this.none('a product of values');
            }
            case '/': {
                if (a.k === 'num' && b.k === 'num') return { k: 'num', r: this.div(a.r, b.r) };
                if (this.isScalar(a) && this.isScalar(b)) {
                    const x = this.cx(a);
                    const y = this.cx(b);
                    if (y.im === 0) return { k: 'cx', re: this.div(x.re, y.re), im: this.div(x.im, y.re) };
                    const d = this.add(this.mul(y.re, y.re), this.mul(y.im, y.im));
                    return {
                        k: 'cx',
                        re: this.div(this.add(this.mul(x.re, y.re), this.mul(x.im, y.im)), d),
                        im: this.div(this.sub(this.mul(x.im, y.re), this.mul(x.re, y.im)), d),
                    };
                }
                if (b.k === 'num' && (a.k === 'vec' || a.k === 'mat')) return this.scale(a, this.div(1, b.r));
                return this.none('a quotient of values');
            }
            case '^': {
                if (a.k === 'num' && b.k === 'num') return { k: 'num', r: this.pow(a.r, b.r) };
                if (this.isScalar(a) && this.isScalar(b)) return this.cpow(this.cx(a), this.cx(b));
                return this.none('a power of values');
            }
            default:
                if (a.k === 'num' && b.k === 'num') {
                    const x = this.text(a.r);
                    const y = this.text(b.r);
                    return { k: 'num', r: `(${x}-(${y}*int(${x}/${y})))` };
                }
                return this.none('%');
        }
    }

    private scale(a: Extract<PV, { k: 'vec' } | { k: 'mat' }>, k: R): PV {
        return a.k === 'vec' ? { k: 'vec', v: a.v.map((x) => this.mul(x, k)) } : { ...a, a: a.a.map((x) => this.mul(x, k)) };
    }

    private dot(a: R[], b: R[]): R {
        let acc: R = 0;
        for (let i = 0; i < a.length; i++) acc = this.add(acc, this.mul(a[i], b[i]));
        return acc;
    }

    /** z^w: z^2 multiplied out, other whole powers in polar form, any other one as e^(w ln z). */
    private cpow(z: { re: R; im: R }, w: { re: R; im: R }): PV {
        if (typeof z.re === 'number' && typeof z.im === 'number' && typeof w.re === 'number' && typeof w.im === 'number') {
            return this.cexp(this.cmulParts(w, this.clog(z)));
        }
        if (w.im === 0 && w.re === 2) return this.cmul(z, z);
        if (w.im === 0 && w.re === 1) return { k: 'cx', ...z };
        if (w.im === 0 && typeof w.re === 'number' && Number.isInteger(w.re)) {
            const r = this.pow(this.hypot([z.re, z.im]), w.re);
            const t = this.mul(w.re, this.fn('atan2', [z.im, z.re]));
            return { k: 'cx', re: this.mul(r, this.fn('cos', [t])), im: this.mul(r, this.fn('sin', [t])) };
        }
        return this.cexp(this.cmulParts(w, this.clog(z)));
    }

    private cmulParts(a: { re: R; im: R }, b: { re: R; im: R }): { re: R; im: R } {
        const p = this.cmul(a, b);
        return p.k === 'cx' ? p : { re: 0, im: 0 };
    }

    private clog(z: { re: R; im: R }): { re: R; im: R } {
        return { re: this.fn('ln', [this.hypot([z.re, z.im])]), im: this.fn('atan2', [z.im, z.re]) };
    }

    private cexp(z: { re: R; im: R }): PV {
        if (z.im === 0) return { k: 'num', r: this.fn('exp', [z.re]) };
        const m = this.fn('exp', [z.re]);
        return { k: 'cx', re: this.mul(m, this.fn('cos', [z.im])), im: this.mul(m, this.fn('sin', [z.im])) };
    }

    private call(n: Extract<VNode, { t: 'call' }>, locals: Map<string, PV>): PV {
        const index = seriesOf(n);
        if (index !== null) return this.series(n, index, locals);
        const { env, defs } = this;
        const args = () => n.args.map((a) => this.node(a, locals));
        const local = locals.get(n.name);
        if (local && n.args.length === 1) return this.binary('*', local, this.node(n.args[0], locals), false);
        if (builtinFunction(n.name, n.math)) return this.builtin(n.name, args());
        const ref = !n.math && defs && defs.has(n.name) && !env.fn(n.name) && !env.scalar(n.name) ? defs.ref(n.name) : null;
        if (ref && ref.fn) {
            const parts = args();
            const body = this.bodyOf(n.name);
            const inner = new Map(locals);
            ref.fn.params.forEach((p, i) => inner.set(p, parts[i]));
            for (const v of env.vars) for (const alias of v) if (!ref.fn.params.includes(alias)) inner.set(alias, { k: 'num', r: NaN });
            return this.node(body, inner);
        }
        const chart = env.fn(n.name);
        if (chart && chart.body && chart.env && n.args.length === 1) {
            const u = this.text(this.real(this.node(n.args[0], locals), n.name));
            const body = toPgf(chart.body, chart.env, [u], this.fmt);
            const dom = chart.domain();
            if (dom === 'invalid') return { k: 'num', r: 'nan' };
            if (!dom) return { k: 'num', r: `(${body})` };
            return { k: 'num', r: `((((${u})>=(${this.fmt(dom[0])})) && ((${u})<=(${this.fmt(dom[1])}))) ? (${body}) : nan)` };
        }
        if (inScalar(env, n.name) && n.args.length === 1) return this.binary('*', this.name(n.name, locals), this.node(n.args[0], locals), false);
        if (ref && ref.value && n.args.length === 1) return this.binary('*', this.fromValue(ref.value.read()), this.node(n.args[0], locals), false);
        // 6.0 G: a GeoGebra command that reads no variable is its value at the sliders' values (Sum(L), Length(Sequence(k, k, 1, n))).
        if (geogebraNeeds(n.name) && !this.readsVariable(n, locals)) return this.fromValue(new ValueCompiler({ env, defs, locals: null, src: '' }).node(n).f());
        return this.valueFunction(n.name, args());
    }

    /** 6.0 G: does the formula read an axis variable or a local (a parameter, a sum's index)? */
    private readsVariable(n: VNode, locals: Map<string, PV>): boolean {
        if (n.t === 'name') return locals.has(n.name) || this.env.vars.some((v) => v.includes(n.name));
        return children(n).some((c) => this.readsVariable(c, locals));
    }

    private bodyOf(name: string): VNode {
        const body = this.defs ? this.defs.bodyOf(name) : null;
        return body ?? this.none(name);
    }

    private builtin(name: string, args: PV[]): PV {
        if (args.every((a) => a.k === 'num')) return { k: 'num', r: this.fn(name, args.map((a) => (a.k === 'num' ? a.r : 0))) };
        const a = args[0];
        if (name === 'abs') {
            if (a.k === 'cx') return { k: 'num', r: this.hypot([a.re, a.im]) };
            if (a.k === 'vec') return { k: 'num', r: this.hypot(a.v) };
            return this.none('|A|');
        }
        if (args.length === 1 && a.k === 'cx') {
            const { re, im } = a;
            switch (name) {
                case 'exp':
                    return this.cexp(a);
                case 'log':
                case 'ln':
                    return { k: 'cx', ...this.clog(a) };
                case 'sqrt': {
                    const r = this.hypot([re, im]);
                    const s = typeof im === 'number' ? (im < 0 ? -1 : 1) : `((${this.text(im)})<0 ? -1 : 1)`;
                    return { k: 'cx', re: this.fn('sqrt', [this.div(this.add(r, re), 2)]), im: this.mul(s, this.fn('sqrt', [this.div(this.sub(r, re), 2)])) };
                }
                case 'sin':
                    return { k: 'cx', re: this.mul(this.fn('sin', [re]), this.fn('cosh', [im])), im: this.mul(this.fn('cos', [re]), this.fn('sinh', [im])) };
                case 'cos':
                    return { k: 'cx', re: this.mul(this.fn('cos', [re]), this.fn('cosh', [im])), im: this.neg(this.mul(this.fn('sin', [re]), this.fn('sinh', [im]))) };
            }
        }
        if (name === 'pow' && args.length === 2) return this.binary('^', args[0], args[1], false);
        return this.none(`${name}(...)`);
    }

    private valueFunction(name: string, args: PV[]): PV {
        const a = args[0];
        switch (name) {
            case 're':
                return { k: 'num', r: this.cx(a).re };
            case 'im':
                return { k: 'num', r: this.cx(a).im };
            case 'conj': {
                const z = this.cx(a);
                return { k: 'cx', re: z.re, im: this.neg(z.im) };
            }
            case 'arg': {
                const z = a.k === 'vec' && a.v.length === 2 ? { re: a.v[0], im: a.v[1] } : this.cx(a);
                return { k: 'num', r: this.fn('atan2', [z.im, z.re]) };
            }
            case 'norm':
                if (a.k === 'vec') return { k: 'num', r: this.hypot(a.v) };
                return this.builtin('abs', args);
            case 'dot':
                if (a.k === 'vec' && args[1] && args[1].k === 'vec') return { k: 'num', r: this.dot(a.v, args[1].v) };
                break;
            case 'cross':
                if (args[1]) return this.binary('*', a, args[1], true);
                break;
            case 'det':
                if (a.k === 'mat' && a.rows === 2 && a.cols === 2) return { k: 'num', r: this.sub(this.mul(a.a[0], a.a[3]), this.mul(a.a[1], a.a[2])) };
                break;
            case 'tr':
                if (a.k === 'mat' && a.rows === a.cols) return { k: 'num', r: a.a.filter((_, i) => i % (a.cols + 1) === 0).reduce<R>((s, x) => this.add(s, x), 0) };
                break;
        }
        return this.none(`${name}(...)`);
    }

    private series(n: Extract<VNode, { t: 'call' }>, index: string, locals: Map<string, PV>): PV {
        const lo = this.node(n.args[2], locals);
        const hi = this.node(n.args[3], locals);
        if (lo.k !== 'num' || hi.k !== 'num' || typeof lo.r !== 'number' || typeof hi.r !== 'number') return this.none(n.name);
        const range = termRange(lo.r, hi.r);
        if (!range || range[1] - range[0] + 1 > MAX_TERMS) return this.none(n.name);
        const product = n.name === 'prod';
        let acc: PV | null = null;
        for (let k = range[0]; k <= range[1]; k++) {
            const inner = new Map(locals);
            inner.set(index, { k: 'num', r: k });
            const term = this.node(n.args[0], inner);
            acc = acc === null ? term : this.binary(product ? '*' : '+', acc, term, false);
        }
        return acc ?? { k: 'num', r: product ? 1 : 0 };
    }
}

function inScalar(env: Env, name: string): boolean {
    return !!env.scalar(name) || constantValue(name) !== undefined || env.vars.some((v) => v.includes(name));
}

/** pgfmath text of a formula that uses values: a real number, written out (see the top of this file). */
export function valuePgf(ast: VNode, env: Env, defs: Definitions | null, outVars: string[], fmt: (n: number) => string): string {
    const p = new ValuePgf(env, defs, outVars, fmt);
    const out = p.node(ast, new Map());
    if (out.k === 'num') return p.text(out.r);
    if (out.k === 'cx' && (out.im === 0 || (typeof out.im === 'number' && Math.abs(out.im) < 1e-12))) return p.text(out.re);
    throw new ExprError(msg('values.problem.noPgf', { what: 'a value that is not a real number' }));
}
