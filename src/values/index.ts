/*
 * 6.0 A: values, the API for the other parts (D: linear algebra and
 * complex maps, E: orbits and the colour of the plane). See
 * the 6.0 plan for the chart lines.
 *
 * Values: number | Complex | Vec | Mat | List (types.ts), never changed
 * after they are made; arithmetic in ops.ts (add, mul, ...), never throws
 * (NaN for what a value does not have).
 *
 * A chart's let definitions live in its MathContext: pass them as
 * MathContextInput.values (valueDefinitions(tools) reads them from the
 * chart's value tools; settings.mathContextInput() does). Every formula
 * field then reads them by name, and so do the functions below.
 *
 *   compileValue(ctx, '(2, 1) + v')            -> { run(): Value, shape }
 *   compileValue(ctx, 'A z', ['z'])            -> run(z) with z any value
 *   compileRecurrence(ctx, 'z_{n+1} = z_n^2 + c', ['c'])
 *       .step(z, c)                            -> the next state (any value)
 *       .complex?.run(inp, out)                -> the same without objects (re, im pairs)
 *   compileComplex(ctx, 'z^2 + c', ['z', 'c']) -> the fast form alone
 *   toGlsl(ctx, 'z^2 + c', { inputs: { z: { glsl: 'z', complex: true }, c: { glsl: 'u_c', complex: true } } })
 *       -> { code: 'c_mul(z, z) + ...', complex: true, uniforms } (GLSL_COMPLEX before it)
 *   gradient(ctx, 'f', [1, 2])                 -> ∇f at (1, 2), numeric
 *   eigen(A), det(A), inverse(A), matMul, matVec, transpose (linalg.ts)
 *   letValue(ctx, 'A')                         -> the value of a let name now
 *
 * Errors are ExprError (src/expr.ts) with a position in the plain text of
 * the formula, in the reader's language. Pure: no DOM, no Obsidian.
 */
import { ExprError } from '../expr';
import type { MathContext } from '../mathcontext';
import { t as msg } from '../i18n';
import { Cell, Locals, ValueCompiler, gradientAt } from './compile';
import { ComplexFormula, compileComplexFormula } from './fast';
import { GlslOptions, GlslResult, toGlslCode } from './glsl';
import { parseValue } from './parse';
import { RecurrenceStep, compileRecurrence as compileStep } from './recurrence';
import { ANY, NUM, Shape, Value } from './types';
import { toReal } from './ops';

export * from './types';
export { add, sub, mul, div, pow, neg, abs, cross, dot, toReal, cadd, csub, cmul, cdiv, cexp, clog, csqrt, cpow } from './ops';
export { det, trace, inverse, transpose, identity, matMul, matVec, matPow, eigen, cubicRoots, cross3 } from './linalg';
export type { Eigenpair } from './linalg';
export { factorial, binom, gamma } from './special';
export { formatValue, valueTex } from './format';
export { parseValue } from './parse';
export type { VNode } from './parse';
export { readRecurrence } from './recurrence';
export type { Recurrence, RecurrenceStep } from './recurrence';
export type { ComplexFormula } from './fast';
export { GLSL_COMPLEX, glslNumber } from './glsl';
export type { GlslOptions, GlslResult, GlslInput, GlslUniform } from './glsl';
export { valueDefinitions } from './defs';
export type { ValueDefinition } from './table';
export { gradientAt } from './compile';

/** A name the compiled formula takes, with its shape when known (ANY by default). */
export type Input = string | { name: string; shape?: Shape };

const inputName = (i: Input) => (typeof i === 'string' ? i : i.name);
const inputShape = (i: Input) => (typeof i === 'string' ? ANY : (i.shape ?? ANY));

/** A formula compiled to a value. */
export interface CompiledValue {
    /** The value for these inputs (in the order given). Never throws. */
    run(...inputs: Value[]): Value;
    /** What the compiler knows of the value before it runs. */
    shape: Shape;
}

/**
 * Compile a formula (plain or LaTeX; vectors, matrices, complex numbers,
 * lists, sums, let names and functions) to a value, in the scope of `ctx`
 * (sliders, computed names, the chart's functions and let definitions) plus
 * `inputs` (they hide names of the chart). Throws ExprError.
 */
export function compileValue(ctx: MathContext, src: string, inputs: readonly Input[] = []): CompiledValue {
    const cells: Cell[] = inputs.map(() => ({ v: NaN }));
    let locals: Locals | null = null;
    inputs.forEach((inp, i) => {
        locals = new Locals(locals, inputName(inp), cells[i], inputShape(inp));
    });
    const part = new ValueCompiler({ env: ctx.envFor('value'), defs: ctx.valueTable(), locals, src }).node(parseValue(src));
    const f = part.f;
    return {
        shape: part.shape,
        run(...values: Value[]): Value {
            for (let i = 0; i < cells.length; i++) cells[i].v = i < values.length ? values[i] : NaN;
            return f();
        },
    };
}

/** The value of a let name now (NaN for a function, a problem or no such name). */
export function letValue(ctx: MathContext, name: string): Value {
    return ctx.valueTable().value(name);
}

/**
 * One step of `z_{n+1} = F(z_n, ...)` in the scope of `ctx`; `inputs` are
 * the names F reads besides the state (c, x, eta, ...). Throws ExprError.
 */
export function compileRecurrence(ctx: MathContext, src: string, inputs: readonly Input[] = []): RecurrenceStep {
    return compileStep(src, ctx.envFor('value'), ctx.valueTable(), inputs.map(inputName), inputs.map(inputShape));
}

/**
 * A formula of complex numbers without objects while it runs (see
 * fast.ts): `inputs` are complex (re, im pairs in `inp`). Throws ExprError
 * for anything but complex arithmetic and its functions.
 */
export function compileComplex(ctx: MathContext, src: string, inputs: readonly string[]): ComplexFormula {
    return compileComplexFormula(src, ctx.envFor('value'), ctx.valueTable(), inputs);
}

/** GLSL for a real or complex formula (complex numbers as vec2), see glsl.ts. Throws ExprError. */
export function toGlsl(ctx: MathContext, src: string, opts: GlslOptions): GlslResult {
    return toGlslCode(src, ctx.envFor('value'), ctx.valueTable(), opts);
}

/** ∇f of a let function f of numbers at `point` (central differences); null when f is no such function. */
export function gradient(ctx: MathContext, name: string, point: readonly number[]): number[] | null {
    const table = ctx.valueTable();
    let ref;
    try {
        ref = table.ref(name);
    } catch {
        return null;
    }
    if (!ref || !ref.fn || ref.fn.params.length !== point.length) return null;
    const inst = ref.fn.instance(ref.fn.params.map(() => NUM));
    const cells = inst.cells;
    const body = inst.body.f;
    return gradientAt((p) => {
        for (let i = 0; i < cells.length; i++) cells[i].v = p[i];
        return toReal(body());
    }, point);
}

/** A formula's problem in the scope of `ctx` (null when it compiles), for checks in cards and lines. */
export function valueProblem(ctx: MathContext, src: string, inputs: readonly Input[] = []): ExprError | null {
    try {
        compileValue(ctx, src, inputs);
        return null;
    } catch (e) {
        return e instanceof ExprError ? e : new ExprError(msg('values.problem.notNumber', { what: String(e) }));
    }
}
