/*
 * 6.0 A: complex formulas without a value per step, for what runs a
 * formula millions of times (part E: an orbit, the colour of every pixel of
 * the plane). A formula of complex numbers compiles to closures that read
 * and write a Float64Array of registers, two numbers (re, im) per part:
 * no object is made while it runs. Inputs (the state z, c, x, ...) are
 * pairs too; sliders are read when it runs, let values when it is made.
 * What is no complex number (a vector, a list, a sum) is an ExprError: the
 * caller then uses the typed compiler (compile.ts). Pure: no DOM, no
 * Obsidian.
 */
import { Env, ExprError, builtinFunction, constantValue } from '../expr';
import { t as msg } from '../i18n';
import type { Definitions } from './compile';
import type { VNode } from './parse';
import { parseValue } from './parse';
import { toReal } from './ops';

type Op = () => void;

/** A compiled complex formula of named complex inputs. */
export interface ComplexFormula {
    /** The input names, in the order of `inp`. */
    inputs: readonly string[];
    /** Writes re and im of the formula into out[0] and out[1]; inp[2k], inp[2k + 1] are re and im of input k. */
    run(inp: Float64Array, out: Float64Array): void;
}

class FastCompiler {
    /** Registers: each part gets two (re, im). */
    size = 0;
    reg: Float64Array = new Float64Array(0);
    inp: Float64Array = new Float64Array(0);
    private readonly inputs: Map<string, number>;

    constructor(
        private env: Env,
        private defs: Definitions | null,
        names: readonly string[]
    ) {
        this.inputs = new Map(names.map((n, i) => [n, i]));
    }

    private alloc(): number {
        const at = this.size;
        this.size += 2;
        return at;
    }

    private none(what: string): never {
        throw new ExprError(msg('values.problem.noPgf', { what }));
    }

    /** Compile `n`: the ops that compute it, in order, and its register. */
    node(n: VNode, ops: Op[], locals: Map<string, number>): number {
        switch (n.t) {
            case 'num': {
                const r = this.alloc();
                const v = n.value;
                ops.push(() => {
                    this.reg[r] = v;
                    this.reg[r + 1] = 0;
                });
                return r;
            }
            case 'name':
                return this.name(n.name, ops, locals);
            case 'unary': {
                const a = this.node(n.arg, ops, locals);
                if (n.op === '+') return a;
                if (n.op === '!') this.none('!');
                const r = this.alloc();
                ops.push(() => {
                    this.reg[r] = -this.reg[a];
                    this.reg[r + 1] = -this.reg[a + 1];
                });
                return r;
            }
            case 'binary':
                return this.binary(n.op, this.node(n.left, ops, locals), n.right, ops, locals);
            case 'call':
                return this.call(n, ops, locals);
            default:
                return this.none(n.t);
        }
    }

    private name(name: string, ops: Op[], locals: Map<string, number>): number {
        const local = locals.get(name);
        if (local !== undefined) return local;
        const k = this.inputs.get(name);
        const r = this.alloc();
        if (k !== undefined) {
            ops.push(() => {
                this.reg[r] = this.inp[2 * k];
                this.reg[r + 1] = this.inp[2 * k + 1];
            });
            return r;
        }
        const scalar = this.env.scalar(name);
        if (scalar) {
            const read = scalar.read;
            ops.push(() => {
                this.reg[r] = read();
                this.reg[r + 1] = 0;
            });
            return r;
        }
        const c = constantValue(name);
        if (c !== undefined) {
            ops.push(() => {
                this.reg[r] = c;
                this.reg[r + 1] = 0;
            });
            return r;
        }
        const ref = this.defs && this.defs.has(name) ? this.defs.ref(name) : null;
        if (ref && ref.value) {
            // A let value is read when the formula is made (a slider it reads changes it: make it again).
            const v = ref.value.read();
            const re = typeof v === 'number' ? v : v.kind === 'complex' ? v.re : NaN;
            const im = typeof v === 'number' ? 0 : v.kind === 'complex' ? v.im : NaN;
            ops.push(() => {
                this.reg[r] = re;
                this.reg[r + 1] = im;
            });
            return r;
        }
        if (name === 'i') {
            ops.push(() => {
                this.reg[r] = 0;
                this.reg[r + 1] = 1;
            });
            return r;
        }
        return this.none(name);
    }

    private binary(op: string, a: number, right: VNode, ops: Op[], locals: Map<string, number>): number {
        // Whole powers by multiplication: z^2 is z z.
        if (op === '^' && right.t === 'num' && Number.isInteger(right.value) && right.value >= 0 && right.value <= 16) {
            return this.wholePower(a, right.value, ops);
        }
        const b = this.node(right, ops, locals);
        const reg = () => this.reg;
        const r = this.alloc();
        switch (op) {
            case '+':
                ops.push(() => {
                    const g = reg();
                    g[r] = g[a] + g[b];
                    g[r + 1] = g[a + 1] + g[b + 1];
                });
                return r;
            case '-':
                ops.push(() => {
                    const g = reg();
                    g[r] = g[a] - g[b];
                    g[r + 1] = g[a + 1] - g[b + 1];
                });
                return r;
            case '*':
                ops.push(() => {
                    const g = reg();
                    const ar = g[a];
                    const ai = g[a + 1];
                    const br = g[b];
                    const bi = g[b + 1];
                    g[r] = ar * br - ai * bi;
                    g[r + 1] = ar * bi + ai * br;
                });
                return r;
            case '/':
                ops.push(() => {
                    const g = reg();
                    const ar = g[a];
                    const ai = g[a + 1];
                    const br = g[b];
                    const bi = g[b + 1];
                    const d = br * br + bi * bi;
                    g[r] = (ar * br + ai * bi) / d;
                    g[r + 1] = (ai * br - ar * bi) / d;
                });
                return r;
            case '^':
                ops.push(() => {
                    const g = reg();
                    const ar = g[a];
                    const ai = g[a + 1];
                    if (ar === 0 && ai === 0) {
                        g[r] = 0;
                        g[r + 1] = 0;
                        return;
                    }
                    // e^(w ln z)
                    const lr = Math.log(Math.hypot(ar, ai));
                    const li = Math.atan2(ai, ar);
                    const er = g[b] * lr - g[b + 1] * li;
                    const ei = g[b] * li + g[b + 1] * lr;
                    const m = Math.exp(er);
                    g[r] = m * Math.cos(ei);
                    g[r + 1] = m * Math.sin(ei);
                });
                return r;
            default:
                return this.none(op);
        }
    }

    private wholePower(a: number, k: number, ops: Op[]): number {
        const r = this.alloc();
        ops.push(() => {
            const g = this.reg;
            let pr = 1;
            let pi = 0;
            let br = g[a];
            let bi = g[a + 1];
            let e = k;
            while (e > 0) {
                if (e & 1) {
                    const t = pr * br - pi * bi;
                    pi = pr * bi + pi * br;
                    pr = t;
                }
                e >>= 1;
                if (e) {
                    const t = br * br - bi * bi;
                    bi = 2 * br * bi;
                    br = t;
                }
            }
            g[r] = pr;
            g[r + 1] = pi;
        });
        return r;
    }

    private call(n: Extract<VNode, { t: 'call' }>, ops: Op[], locals: Map<string, number>): number {
        const args = n.args.map((x) => this.node(x, ops, locals));
        const r = this.alloc();
        const one = (f: (re: number, im: number, g: Float64Array) => void) => {
            if (args.length !== 1) this.none(n.name);
            const a = args[0];
            ops.push(() => f(this.reg[a], this.reg[a + 1], this.reg));
        };
        const set = (g: Float64Array, re: number, im: number) => {
            g[r] = re;
            g[r + 1] = im;
        };
        switch (n.name) {
            case 'exp':
                one((re, im, g) => {
                    const m = Math.exp(re);
                    set(g, m * Math.cos(im), m * Math.sin(im));
                });
                return r;
            case 'log':
            case 'ln':
                one((re, im, g) => set(g, Math.log(Math.hypot(re, im)), Math.atan2(im, re)));
                return r;
            case 'sqrt':
                one((re, im, g) => {
                    const m = Math.hypot(re, im);
                    const y = Math.sqrt((m - re) / 2);
                    set(g, Math.sqrt((m + re) / 2), im < 0 ? -y : y);
                });
                return r;
            case 'sin':
                one((re, im, g) => set(g, Math.sin(re) * Math.cosh(im), Math.cos(re) * Math.sinh(im)));
                return r;
            case 'cos':
                one((re, im, g) => set(g, Math.cos(re) * Math.cosh(im), -Math.sin(re) * Math.sinh(im)));
                return r;
            case 'sinh':
                one((re, im, g) => set(g, Math.sinh(re) * Math.cos(im), Math.cosh(re) * Math.sin(im)));
                return r;
            case 'cosh':
                one((re, im, g) => set(g, Math.cosh(re) * Math.cos(im), Math.sinh(re) * Math.sin(im)));
                return r;
            case 'abs':
            case 'norm':
                one((re, im, g) => set(g, Math.hypot(re, im), 0));
                return r;
            case 're':
                one((re, _im, g) => set(g, re, 0));
                return r;
            case 'im':
                one((_re, im, g) => set(g, im, 0));
                return r;
            case 'conj':
                one((re, im, g) => set(g, re, -im));
                return r;
            case 'arg':
                one((re, im, g) => set(g, Math.atan2(im, re), 0));
                return r;
        }
        // A real builtin of real arguments.
        const b = builtinFunction(n.name, n.math);
        if (!b || args.length < b.min || args.length > b.max) return this.none(n.name);
        const fn = b.fn;
        ops.push(() => {
            const g = this.reg;
            const vals = args.map((a) => (g[a + 1] === 0 ? g[a] : NaN));
            set(g, fn(...vals), 0);
        });
        return r;
    }
}

/**
 * A complex formula of the named complex inputs (the others resolve in the
 * chart: sliders, let values, i). Throws ExprError for what is no complex
 * arithmetic (vectors, lists, sums, let functions).
 */
export function compileComplexFormula(src: string | VNode, env: Env, defs: Definitions | null, inputs: readonly string[]): ComplexFormula {
    const c = new FastCompiler(env, defs, inputs);
    const ops: Op[] = [];
    const out = c.node(typeof src === 'string' ? parseValue(src) : src, ops, new Map());
    c.reg = new Float64Array(Math.max(2, c.size));
    const list = ops.slice();
    const count = list.length;
    return {
        inputs,
        run(inp: Float64Array, res: Float64Array): void {
            c.inp = inp;
            for (let i = 0; i < count; i++) list[i]();
            res[0] = c.reg[out];
            res[1] = c.reg[out + 1];
        },
    };
}

/** The real number of a complex result (within rounding of the real axis), else NaN. */
export function realPart(re: number, im: number): number {
    return toReal({ kind: 'complex', re, im });
}
