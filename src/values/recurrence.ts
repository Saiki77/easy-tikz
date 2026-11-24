/*
 * 6.0 A: recurrences, z_{n+1} = F(z_n, c), for part E's orbits, cobwebs
 * and the colour of the plane: read the line, and compile one step for a
 * state of any value (a number, a complex number, a vector), with a fast
 * step without objects for a complex (or real) state. Pure: no DOM, no
 * Obsidian.
 */
import { Env, ExprError } from '../expr';
import { t as msg } from '../i18n';
import { Cell, Definitions, Locals, Part, ValueCompiler } from './compile';
import { ComplexFormula, compileComplexFormula } from './fast';
import { VNode, parseValue } from './parse';
import { ANY, Shape, Value } from './types';

/** A recurrence as written: `z_{n+1} = z_n^2 + c` is state z, index n, formula z_n^2 + c. */
export interface Recurrence {
    /** The name of the state: z. */
    state: string;
    /** The index: n. */
    index: string;
    /** The name the formula reads the state by: z_n (as the plain syntax spells z_{n}). */
    current: string;
    /** The formula of the next state (plain or LaTeX, as written). */
    formula: string;
}

/** The first `=` that is no part of ==, <=, >=, != (outside brackets), or -1. */
function equalsAt(s: string): number {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
        else if (c === '=' && depth === 0 && !/[=<>!\\]/.test(s[i - 1] ?? '') && s[i + 1] !== '=') return i;
    }
    return -1;
}

/**
 * Read `z_{n+1} = F` (also `x_{n + 1} = ...`, `p_(n+1) = ...`, a Greek
 * state `\theta_{n+1}`): null when the left side is no next state.
 */
export function readRecurrence(src: string): Recurrence | null {
    const eq = equalsAt(src);
    if (eq < 0) return null;
    const lhs = src.slice(0, eq).trim();
    const m = /^\\?([A-Za-z]+)\s*_\s*[{(]?\s*([A-Za-z])\s*\+\s*1\s*[})]?$/.exec(lhs);
    if (!m) return null;
    const formula = src.slice(eq + 1).trim();
    if (!formula) return null;
    return { state: m[1], index: m[2], current: `${m[1]}_${m[2]}`, formula };
}

/** One step of a recurrence. */
export interface RecurrenceStep {
    recurrence: Recurrence;
    /** The names `step` takes after the state, in order (c, x, eta, ...). */
    inputs: readonly string[];
    /** The next state from the current one and the inputs (any values). Never throws: NaN when it has none. */
    step(current: Value, ...inputs: Value[]): Value;
    /** The shape of the next state as far as the compiler knows it (ANY: it follows the state). */
    shape: Shape;
    /**
     * The step without objects for a complex (or real) state and complex
     * inputs, or null when the formula has none (vectors, sums, let
     * functions): run(inp, out) reads re, im of the state from inp[0], inp[1]
     * and of input k from inp[2k + 2], inp[2k + 3], and writes the next state
     * into out[0], out[1].
     */
    complex: ComplexFormula | null;
}

/**
 * Compile a recurrence. `inputs` are the names the step takes besides the
 * state (they hide names of the chart); `shapes` what they are, when known
 * (the state and each input; ANY by default). Throws ExprError.
 */
export function compileRecurrence(src: string | Recurrence, env: Env, defs: Definitions | null, inputs: readonly string[] = [], shapes: readonly Shape[] = []): RecurrenceStep {
    const rec = typeof src === 'string' ? readRecurrence(src) : src;
    if (!rec) throw new ExprError(msg('values.problem.recurrenceTakes'), { pos: 0 });
    const ast: VNode = parseValue(rec.formula);
    const names = [rec.current, ...inputs];
    const cells: Cell[] = names.map(() => ({ v: NaN }));
    let locals: Locals | null = null;
    names.forEach((n, i) => {
        locals = new Locals(locals, n, cells[i], shapes[i] ?? ANY);
    });
    const part: Part = new ValueCompiler({ env, defs, locals, src: rec.formula }).node(ast);
    const f = part.f;
    let complex: ComplexFormula | null = null;
    try {
        complex = compileComplexFormula(ast, env, defs, names);
    } catch {
        complex = null;
    }
    return {
        recurrence: rec,
        inputs,
        shape: part.shape,
        complex,
        step(current: Value, ...values: Value[]): Value {
            cells[0].v = current;
            for (let i = 0; i < values.length && i + 1 < cells.length; i++) cells[i + 1].v = values[i];
            return f();
        },
    };
}
