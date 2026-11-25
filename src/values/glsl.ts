/*
 * 6.0 A: a formula of real and complex numbers as GLSL (WebGL 1, GLSL ES
 * 1.00), for part E's fragment shaders: a complex number is a vec2 (re,
 * im), a real one a float. Sliders become uniforms (so moving one needs no
 * new shader) or numbers; let values are numbers, let functions are written
 * out with their arguments. GLSL_COMPLEX is the library the code calls
 * (c_mul, c_div, c_exp, ...); put it before the code that uses it. What
 * has no GLSL form here (vectors, lists, sums) is an ExprError.
 * Pure: no DOM, no Obsidian.
 */
import { Env, ExprError, constantValue } from '../expr';
import { isMlFunction, mlGlsl } from '../ml/builtins'; // 6.0 ML
import { t as msg } from '../i18n';
import type { Definitions } from './compile';
import type { VNode } from './parse';
import { parseValue } from './parse';

/** The complex functions GLSL code from toGlsl calls (GLSL ES 1.00 has no sinh, cosh or tanh: r_sinh and friends). */
export const GLSL_COMPLEX = `
float r_sinh(float x) { return 0.5 * (exp(x) - exp(-x)); }
float r_cosh(float x) { return 0.5 * (exp(x) + exp(-x)); }
float r_tanh(float x) { float e = exp(2.0 * clamp(x, -20.0, 20.0)); return (e - 1.0) / (e + 1.0); }
vec2 c_mul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 c_div(vec2 a, vec2 b) { float d = dot(b, b); return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d; }
vec2 c_exp(vec2 z) { return exp(z.x) * vec2(cos(z.y), sin(z.y)); }
vec2 c_log(vec2 z) { return vec2(log(length(z)), atan(z.y, z.x)); }
vec2 c_pow(vec2 z, vec2 w) { if (z.x == 0.0 && z.y == 0.0) return vec2(0.0); return c_exp(c_mul(w, c_log(z))); }
vec2 c_sqrt(vec2 z) { float m = length(z); float y = sqrt(max(0.0, 0.5 * (m - z.x))); return vec2(sqrt(max(0.0, 0.5 * (m + z.x))), z.y < 0.0 ? -y : y); }
vec2 c_sin(vec2 z) { return vec2(sin(z.x) * r_cosh(z.y), cos(z.x) * r_sinh(z.y)); }
vec2 c_cos(vec2 z) { return vec2(cos(z.x) * r_cosh(z.y), -sin(z.x) * r_sinh(z.y)); }
vec2 c_tan(vec2 z) { return c_div(c_sin(z), c_cos(z)); }
vec2 c_sinh(vec2 z) { return vec2(r_sinh(z.x) * cos(z.y), r_cosh(z.x) * sin(z.y)); }
vec2 c_cosh(vec2 z) { return vec2(r_cosh(z.x) * cos(z.y), r_sinh(z.x) * sin(z.y)); }
vec2 c_tanh(vec2 z) { return c_div(c_sinh(z), c_cosh(z)); }
`;

/** One input of the code: its GLSL expression and whether it is complex (vec2). */
export interface GlslInput {
    glsl: string;
    complex: boolean;
}

export interface GlslOptions {
    /** The inputs by name: `{ z: { glsl: 'z', complex: true }, x: { glsl: 'p.x', complex: false } }`. */
    inputs: Record<string, GlslInput>;
    /** Sliders and computed names (P1_x) as uniforms `u_<name>` (the default), or as numbers. */
    sliders?: 'uniform' | 'number';
}

/** A slider the code reads as a uniform float: its uniform's name and how to read its value now. */
export interface GlslUniform {
    name: string;
    uniform: string;
    read: () => number;
}

export interface GlslResult {
    /** A GLSL expression: a vec2 when `complex`, else a float. */
    code: string;
    complex: boolean;
    uniforms: GlslUniform[];
}

interface G {
    s: string;
    cx: boolean;
}

/** A float literal GLSL reads: 2.0, -0.5, 1e-7. */
export function glslNumber(n: number): string {
    if (!Number.isFinite(n)) return n > 0 ? '1e38' : n < 0 ? '-1e38' : '0.0';
    let s = String(n);
    if (!/[.e]/.test(s)) s += '.0';
    return n < 0 ? `(${s})` : s;
}

class GlslPrinter {
    readonly uniforms = new Map<string, GlslUniform>();

    constructor(
        private env: Env,
        private defs: Definitions | null,
        private opts: GlslOptions
    ) {}

    private none(what: string): never {
        throw new ExprError(msg('values.problem.noPgf', { what }));
    }

    private toCx(g: G): string {
        return g.cx ? g.s : `vec2(${g.s}, 0.0)`;
    }

    node(n: VNode, locals: Map<string, G>): G {
        switch (n.t) {
            case 'num':
                return { s: glslNumber(n.value), cx: false };
            case 'name':
                return this.name(n.name, locals);
            case 'unary': {
                const a = this.node(n.arg, locals);
                if (n.op === '+') return a;
                if (n.op === '!') return { s: `(${a.s} == 0.0 ? 1.0 : 0.0)`, cx: false };
                return { s: `(-${a.s})`, cx: a.cx };
            }
            case 'binary':
                return this.binary(n.op, n.left, n.right, locals);
            case 'call':
                return this.call(n, locals);
            case 'ternary': {
                const test = this.node(n.test, locals);
                const a = this.node(n.then, locals);
                const b = this.node(n.else, locals);
                const cx = a.cx || b.cx;
                return { s: `((${test.s}) != 0.0 ? ${cx ? this.toCx(a) : a.s} : ${cx ? this.toCx(b) : b.s})`, cx };
            }
            case 'cmp': {
                const args = n.args.map((a) => this.node(a, locals).s);
                const pairs = n.ops.map((op, i) => `(${args[i]} ${op} ${args[i + 1]})`);
                return { s: `((${pairs.join(' && ')}) ? 1.0 : 0.0)`, cx: false };
            }
            default:
                return this.none(n.t);
        }
    }

    private name(name: string, locals: Map<string, G>): G {
        const local = locals.get(name);
        if (local) return local;
        if (Object.prototype.hasOwnProperty.call(this.opts.inputs, name)) {
            const inp = this.opts.inputs[name];
            return { s: inp.glsl, cx: inp.complex };
        }
        const scalar = this.env.scalar(name);
        if (scalar) {
            if (this.opts.sliders === 'number') return { s: glslNumber(scalar.read()), cx: false };
            const uniform = `u_${name}`;
            if (!this.uniforms.has(name)) this.uniforms.set(name, { name, uniform, read: scalar.read });
            return { s: uniform, cx: false };
        }
        if (name === 'pi' || name === 'π') return { s: '3.141592653589793', cx: false };
        const c = constantValue(name);
        if (c !== undefined) return { s: glslNumber(c), cx: false };
        const ref = this.defs && this.defs.has(name) ? this.defs.ref(name) : null;
        if (ref && ref.value) {
            const v = ref.value.read();
            if (typeof v === 'number') return { s: glslNumber(v), cx: false };
            if (v.kind === 'complex') return { s: `vec2(${glslNumber(v.re)}, ${glslNumber(v.im)})`, cx: true };
            return this.none(name);
        }
        if (name === 'i') return { s: 'vec2(0.0, 1.0)', cx: true };
        return this.none(name);
    }

    private binary(op: string, left: VNode, right: VNode, locals: Map<string, G>): G {
        const a = this.node(left, locals);
        if (op === '^' && right.t === 'num' && Number.isInteger(right.value) && right.value >= 1 && right.value <= 8) {
            const parts = Array.from({ length: right.value }, () => a.s);
            if (!a.cx) return { s: `(${parts.join(' * ')})`, cx: false };
            return { s: parts.slice(1).reduce((acc, p) => `c_mul(${acc}, ${p})`, parts[0]), cx: true };
        }
        const b = this.node(right, locals);
        const cx = a.cx || b.cx;
        switch (op) {
            case '+':
            case '-':
                return { s: cx ? `(${this.toCx(a)} ${op} ${this.toCx(b)})` : `(${a.s} ${op} ${b.s})`, cx };
            case '*':
                if (!a.cx || !b.cx) return { s: `(${a.s} * ${b.s})`, cx };
                return { s: `c_mul(${a.s}, ${b.s})`, cx: true };
            case '/':
                if (!b.cx) return { s: `(${a.s} / ${b.s})`, cx };
                return { s: `c_div(${this.toCx(a)}, ${b.s})`, cx: true };
            case '^':
                if (!cx) return { s: `pow(${a.s}, ${b.s})`, cx: false };
                return { s: `c_pow(${this.toCx(a)}, ${this.toCx(b)})`, cx: true };
            default:
                if (cx) return this.none('%');
                return { s: `mod(${a.s}, ${b.s})`, cx: false };
        }
    }

    private call(n: Extract<VNode, { t: 'call' }>, locals: Map<string, G>): G {
        const ref = !n.math && this.defs && this.defs.has(n.name) && !this.env.fn(n.name) ? this.defs.ref(n.name) : null;
        if (ref && ref.fn) {
            const body = this.defs ? this.defs.bodyOf(n.name) : null;
            if (!body || n.args.length !== ref.fn.params.length) return this.none(n.name);
            const inner = new Map(locals);
            ref.fn.params.forEach((p, i) => inner.set(p, this.node(n.args[i], locals)));
            return this.node(body, inner);
        }
        const args = n.args.map((a) => this.node(a, locals));
        const a = args[0];
        if (!a) return this.none(n.name);
        const real: Record<string, string> = {
            sin: 'sin', cos: 'cos', tan: 'tan', exp: 'exp', log: 'log', ln: 'log', sqrt: 'sqrt', abs: 'abs', floor: 'floor', ceil: 'ceil',
            sign: 'sign', asin: 'asin', acos: 'acos', atan: 'atan', sinh: 'r_sinh', cosh: 'r_cosh', tanh: 'r_tanh',
        };
        if (!a.cx && args.length === 1 && Object.prototype.hasOwnProperty.call(real, n.name)) return { s: `${real[n.name]}(${a.s})`, cx: false };
        // 6.0 ML: sigmoid, relu, softplus, gelu, silu of a real number (when the chart names nothing so).
        if (!a.cx && args.length === 1 && !n.math && isMlFunction(this.env.fn(n.name))) {
            const code = mlGlsl(n.name, a.s);
            if (code) return { s: code, cx: false };
        }
        if (!a.cx && args.length === 2 && (n.name === 'min' || n.name === 'max' || n.name === 'pow' || n.name === 'atan2')) {
            const fn = n.name === 'atan2' ? 'atan' : n.name;
            return { s: `${fn}(${a.s}, ${args[1].s})`, cx: false };
        }
        if (a.cx && args.length === 1 && ['exp', 'log', 'ln', 'sqrt', 'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh'].includes(n.name)) {
            return { s: `c_${n.name === 'ln' ? 'log' : n.name}(${a.s})`, cx: true };
        }
        switch (n.name) {
            case 'abs':
            case 'norm':
                return { s: `length(${this.toCx(a)})`, cx: false };
            case 're':
                return { s: a.cx ? `${a.s}.x` : a.s, cx: false };
            case 'im':
                return { s: a.cx ? `${a.s}.y` : '0.0', cx: false };
            case 'conj':
                return a.cx ? { s: `vec2(${a.s}.x, -${a.s}.y)`, cx: true } : a;
            case 'arg':
                return { s: `atan(${this.toCx(a)}.y, ${this.toCx(a)}.x)`, cx: false };
        }
        return this.none(n.name);
    }
}

/**
 * GLSL for a formula of real and complex numbers. `inputs` names what the
 * shader gives (z, c, x, y, ...); everything else is the chart's. Read
 * every uniform's value (`read()`) when the shader draws.
 */
export function toGlslCode(src: string | VNode, env: Env, defs: Definitions | null, opts: GlslOptions): GlslResult {
    const p = new GlslPrinter(env, defs, opts);
    const g = p.node(typeof src === 'string' ? parseValue(src) : src, new Map());
    return { code: g.s, complex: g.cx, uniforms: Array.from(p.uniforms.values()) };
}
