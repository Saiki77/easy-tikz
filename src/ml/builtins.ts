/*
 * 6.0 ML: the activation functions of machine learning in every formula
 * field: sigmoid (also σ), relu (ReLU), softplus, gelu (GELU) and silu
 * (swish), plain or in LaTeX (`\sigma(x)`, `\operatorname{relu}(x)`,
 * `\mathrm{GELU}(x)`). They are functions the chart has without a line:
 * MathContext hands them out after the chart's own names, so a function,
 * a slider or a let value of the same name wins and every old chart reads
 * as before. Each is a formula in x, so the compiler, the pgfplots export
 * (it inlines them) and the affine planner treat them as user functions.
 * softmax and logsumexp take lists and vectors: src/values/ops.ts.
 * Pure: no DOM, no Obsidian.
 */
import type { Env, FnRef, Node } from '../expr';
import { compile, parse } from '../expr';

/**
 * erf(u) by Abramowitz and Stegun 7.1.26 (error below 1.5e-7), written in
 * the formula language so the preview, the GPU and the export compute the
 * same numbers.
 */
function erfOf(u: string): string {
    const t = `(1/(1 + 0.3275911*abs(${u})))`;
    return `(sign(${u})*(1 - ((((1.061405429*${t} - 1.453152027)*${t} + 1.421413741)*${t} - 0.284496736)*${t} + 0.254829592)*${t}*exp(-(${u})^2)))`;
}

/** The body of each function in x (plain syntax), stable for large |x|. */
const BODIES: Record<string, string> = {
    sigmoid: '1/(1 + exp(-x))',
    relu: 'max(0, x)',
    softplus: 'max(x, 0) + ln(1 + exp(-abs(x)))',
    gelu: `x/2*(1 + ${erfOf('x/sqrt(2)')})`,
    silu: 'x/(1 + exp(-x))',
};

/** Names, with the other ways notes write them. */
const ALIASES: Record<string, string> = {
    sigmoid: 'sigmoid',
    sigma: 'sigmoid',
    relu: 'relu',
    ReLU: 'relu',
    softplus: 'softplus',
    gelu: 'gelu',
    GELU: 'gelu',
    silu: 'silu',
    SiLU: 'silu',
    swish: 'silu',
};

/** The names the formulas know (for the AI guide and the Build tab's suggestions). */
export const ML_FUNCTION_NAMES: readonly string[] = Object.keys(ALIASES);

/** The function a name means, or null: sigma is sigmoid, ReLU is relu. */
export function mlFunctionOf(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(ALIASES, name) ? ALIASES[name] : null;
}

/** The function's own Env: x is its variable, nothing else is named. */
function ownEnv(): Env {
    return {
        vars: [['x']],
        scalar: () => null,
        fn: () => null,
        bareFnError: () => null,
        notHere: () => null,
        noSlider: () => true,
        defaultVars: true,
        knownNames: () => ['x'],
        fnNames: () => [],
    };
}

const REFS = new Map<string, FnRef>();

/** The FnRef of an activation function by any of its names, or null (made once). */
export function mlFunction(name: string): FnRef | null {
    const key = mlFunctionOf(name);
    if (!key) return null;
    let ref = REFS.get(name);
    if (ref) return ref;
    const env = ownEnv();
    const body: Node = parse(BODIES[key]);
    const f = compile(body, env, BODIES[key]);
    ref = {
        name,
        kind: 'cartesian',
        call: (u: number) => f(u, NaN),
        body,
        env,
        domainEmpty: true,
        domain: () => null,
    };
    REFS.set(name, ref);
    return ref;
}

/** Whether a FnRef is one of these (the GLSL printer writes them itself). */
export function isMlFunction(ref: FnRef | null | undefined): boolean {
    return !!ref && REFS.get(ref.name) === ref;
}

/** GLSL for an activation function of a real argument `a` (an expression), or null. */
export function mlGlsl(name: string, a: string): string | null {
    switch (mlFunctionOf(name)) {
        case 'sigmoid':
            return `(1.0 / (1.0 + exp(-(${a}))))`;
        case 'relu':
            return `max(0.0, ${a})`;
        case 'softplus':
            return `(max(${a}, 0.0) + log(1.0 + exp(-abs(${a}))))`;
        case 'silu':
            return `((${a}) / (1.0 + exp(-(${a}))))`;
        case 'gelu': {
            const u = `((${a}) * 0.7071067811865476)`;
            const t = `(1.0 / (1.0 + 0.3275911 * abs(${u})))`;
            return `(0.5 * (${a}) * (1.0 + sign(${u}) * (1.0 - ((((1.061405429 * ${t} - 1.453152027) * ${t} + 1.421413741) * ${t} - 0.284496736) * ${t} + 0.254829592) * ${t} * exp(-(${u}) * (${u})))))`;
        }
        default:
            return null;
    }
}

// ------------------------------------------------------------ of lists and vectors

/** softmax of numbers: e^(z_i - max) / sum, so large numbers never overflow. */
export function softmaxOf(z: readonly number[]): number[] {
    let hi = -Infinity;
    for (const v of z) if (v > hi) hi = v;
    if (!Number.isFinite(hi)) return z.map(() => NaN);
    const e = z.map((v) => Math.exp(v - hi));
    const s = e.reduce((p, v) => p + v, 0);
    return e.map((v) => v / s);
}

/** log of the sum of e^(z_i), without overflow. */
export function logSumExpOf(z: readonly number[]): number {
    let hi = -Infinity;
    for (const v of z) if (v > hi) hi = v;
    if (!Number.isFinite(hi)) return hi;
    let s = 0;
    for (const v of z) s += Math.exp(v - hi);
    return hi + Math.log(s);
}
