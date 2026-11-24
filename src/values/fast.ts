/*
 * 6.0 A: complex formulas without a value per step, for what runs a
 * formula millions of times (part E: an orbit, the colour of every pixel of
 * the plane). A formula of complex numbers compiles to closures over one
 * Float64Array of registers, two numbers (re, im) per part; the inputs (the
 * state z, c, x, ...) are copied into their registers, so no object is made
 * while it runs. Sliders are read when it runs, let values when it is
 * made. What is no complex number (a vector, a list, a sum) is an
 * ExprError: the caller then uses the typed compiler (compile.ts).
 * Pure: no DOM, no Obsidian.
 */
import { Env, ExprError, builtinFunction, constantValue } from '../expr';
import { t as msg } from '../i18n';
import type { Definitions } from './compile';
import type { VNode } from './parse';
import { children, parseValue } from './parse';
import { toReal } from './ops';

type Op = () => void;

/** A compiled complex formula of named complex inputs. */
export interface ComplexFormula {
    /** The input names, in the order of `inp`. */
    inputs: readonly string[];
    /** Writes re and im of the formula into out[0] and out[1]; inp[2k], inp[2k + 1] are re and im of input k. */
    run(inp: Float64Array, out: Float64Array): void;
}

function countNodes(n: VNode): number {
    let k = 1;
    for (const c of children(n)) k += countNodes(c);
    return k;
}

class FastCompiler {
    private next: number;

    constructor(
        private env: Env,
        private defs: Definitions | null,
        private inputs: Map<string, number>,
        /** The registers: the inputs first (2 each), then 2 per part. */
        readonly g: Float64Array
    ) {
        this.next = 2 * inputs.size;
    }

    private alloc(): number {
        const at = this.next;
        this.next += 2;
        return at;
    }

    private none(what: string): never {
        throw new ExprError(msg('values.problem.noPgf', { what }));
    }

    /** A register holding a constant (written once, now). */
    private konst(re: number, im: number): number {
        const r = this.alloc();
        this.g[r] = re;
        this.g[r + 1] = im;
        return r;
    }

    /** Compile `n`: the ops that compute it, in order; returns its register. */
    node(n: VNode, ops: Op[]): number {
        const g = this.g;
        switch (n.t) {
            case 'num':
                return this.konst(n.value, 0);
            case 'name':
                return this.name(n.name, ops);
            case 'unary': {
                const a = this.node(n.arg, ops);
                if (n.op === '+') return a;
                if (n.op === '!') this.none('!');
                const r = this.alloc();
                ops.push(() => {
                    g[r] = -g[a];
                    g[r + 1] = -g[a + 1];
                });
                return r;
            }
            case 'binary':
                return this.binary(n, ops);
            case 'call':
                return this.call(n, ops);
            default:
                return this.none(n.t);
        }
    }

    private name(name: string, ops: Op[]): number {
        const g = this.g;
        const k = this.inputs.get(name);
        if (k !== undefined) return 2 * k;
        const scalar = this.env.scalar(name);
        if (scalar) {
            const read = scalar.read;
            const r = this.alloc();
            ops.push(() => {
                g[r] = read();
                g[r + 1] = 0;
            });
            return r;
        }
        const c = constantValue(name);
        if (c !== undefined) return this.konst(c, 0);
        const ref = this.defs && this.defs.has(name) ? this.defs.ref(name) : null;
        if (ref && ref.value) {
            // A let value is read when the formula is made (a slider it reads changes it: make the formula again).
            const v = ref.value.read();
            if (typeof v === 'number') return this.konst(v, 0);
            if (v.kind === 'complex') return this.konst(v.re, v.im);
            return this.none(name);
        }
        if (name === 'i') return this.konst(0, 1);
        return this.none(name);
    }

    private binary(n: Extract<VNode, { t: 'binary' }>, ops: Op[]): number {
        const g = this.g;
        const a = this.node(n.left, ops);
        const right = n.right;
        // Whole powers by multiplication: z^2 is z z.
        if (n.op === '^' && right.t === 'num' && Number.isInteger(right.value) && right.value >= 0 && right.value <= 16) {
            const r = this.alloc();
            const k = right.value;
            if (k === 2) {
                ops.push(() => {
                    const x = g[a];
                    const y = g[a + 1];
                    g[r] = x * x - y * y;
                    g[r + 1] = 2 * x * y;
                });
                return r;
            }
            ops.push(() => {
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
        const b = this.node(right, ops);
        const r = this.alloc();
        switch (n.op) {
            case '+':
                ops.push(() => {
                    g[r] = g[a] + g[b];
                    g[r + 1] = g[a + 1] + g[b + 1];
                });
                return r;
            case '-':
                ops.push(() => {
                    g[r] = g[a] - g[b];
                    g[r + 1] = g[a + 1] - g[b + 1];
                });
                return r;
            case '*':
                ops.push(() => {
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
                return this.none(n.op);
        }
    }

    private call(n: Extract<VNode, { t: 'call' }>, ops: Op[]): number {
        const g = this.g;
        const args = n.args.map((x) => this.node(x, ops));
        const r = this.alloc();
        const a = args[0];
        const unary = (f: () => void): number => {
            if (args.length !== 1) this.none(n.name);
            ops.push(f);
            return r;
        };
        switch (n.name) {
            case 'exp':
                return unary(() => {
                    const m = Math.exp(g[a]);
                    g[r] = m * Math.cos(g[a + 1]);
                    g[r + 1] = m * Math.sin(g[a + 1]);
                });
            case 'log':
            case 'ln':
                return unary(() => {
                    const re = g[a];
                    const im = g[a + 1];
                    g[r] = Math.log(Math.hypot(re, im));
                    g[r + 1] = Math.atan2(im, re);
                });
            case 'sqrt':
                return unary(() => {
                    const re = g[a];
                    const im = g[a + 1];
                    const m = Math.hypot(re, im);
                    const y = Math.sqrt((m - re) / 2);
                    g[r] = Math.sqrt((m + re) / 2);
                    g[r + 1] = im < 0 ? -y : y;
                });
            case 'sin':
                return unary(() => {
                    const re = g[a];
                    const im = g[a + 1];
                    g[r] = Math.sin(re) * Math.cosh(im);
                    g[r + 1] = Math.cos(re) * Math.sinh(im);
                });
            case 'cos':
                return unary(() => {
                    const re = g[a];
                    const im = g[a + 1];
                    g[r] = Math.cos(re) * Math.cosh(im);
                    g[r + 1] = -Math.sin(re) * Math.sinh(im);
                });
            case 'sinh':
                return unary(() => {
                    const re = g[a];
                    const im = g[a + 1];
                    g[r] = Math.sinh(re) * Math.cos(im);
                    g[r + 1] = Math.cosh(re) * Math.sin(im);
                });
            case 'cosh':
                return unary(() => {
                    const re = g[a];
                    const im = g[a + 1];
                    g[r] = Math.cosh(re) * Math.cos(im);
                    g[r + 1] = Math.sinh(re) * Math.sin(im);
                });
            case 'abs':
            case 'norm':
                return unary(() => {
                    g[r] = Math.hypot(g[a], g[a + 1]);
                    g[r + 1] = 0;
                });
            case 're':
                return unary(() => {
                    g[r] = g[a];
                    g[r + 1] = 0;
                });
            case 'im':
                return unary(() => {
                    g[r] = g[a + 1];
                    g[r + 1] = 0;
                });
            case 'conj':
                return unary(() => {
                    g[r] = g[a];
                    g[r + 1] = -g[a + 1];
                });
            case 'arg':
                return unary(() => {
                    g[r] = Math.atan2(g[a + 1], g[a]);
                    g[r + 1] = 0;
                });
        }
        // A real builtin of real arguments.
        const b = builtinFunction(n.name, n.math);
        if (!b || args.length < b.min || args.length > b.max) return this.none(n.name);
        const fn = b.fn;
        const vals = new Array<number>(args.length);
        ops.push(() => {
            for (let k = 0; k < args.length; k++) vals[k] = g[args[k] + 1] === 0 ? g[args[k]] : NaN;
            g[r] = fn(...vals);
            g[r + 1] = 0;
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
    const ast = typeof src === 'string' ? parseValue(src) : src;
    const names = new Map<string, number>();
    inputs.forEach((n, i) => {
        if (!names.has(n)) names.set(n, i);
    });
    const g = new Float64Array(2 * inputs.length + 2 * countNodes(ast) + 2);
    const c = new FastCompiler(env, defs, names, g);
    const ops: Op[] = [];
    const out = c.node(ast, ops);
    const count = ops.length;
    const width = 2 * inputs.length;
    return {
        inputs,
        run(inp: Float64Array, res: Float64Array): void {
            for (let k = 0; k < width; k++) g[k] = inp[k];
            for (let k = 0; k < count; k++) ops[k]();
            res[0] = g[out];
            res[1] = g[out + 1];
        },
    };
}

/** The real number of a complex result (within rounding of the real axis), else NaN. */
export function realPart(re: number, im: number): number {
    return toReal({ kind: 'complex', re, im });
}
