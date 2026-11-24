/*
 * The terms of a sum of rotations for turning circles (6.0 E):
 * `\sum_{k=1}^{n} \frac{4}{\pi (2k - 1)} e^{i(2k - 1)t}` read as its body
 * in k and t and its bounds, so each term is its own circle. The bounds
 * are formulas (a slider n); the body is complex in t. Pure: no DOM.
 */
import type { MathContext } from '../mathcontext';
import { ExprError } from '../expr';
import { t as msg } from '../i18n';
import { parseValue } from '../values';
import type { Value, VNode } from '../values';
import { Cell, Locals, ValueCompiler } from '../values/compile';
import { compileComplexFormula } from '../values/fast';
import { NUM } from '../values/types';

/** Radians of t per second of the clock (6.0 F4: the plan's 1.1, one turn of the first circle in under 6 s; `speed 2` doubles it). */
export const FOURIER_SPEED = 1.1;

export interface FourierTerms {
    /** The terms at time t, as (re, im) pairs, first term first. */
    at(t: number): Array<[number, number]>;
    /** More terms than the cap were asked for (only the first ones are drawn). */
    capped: boolean;
    count: number;
}

function complexOf(v: Value): [number, number] {
    if (typeof v === 'number') return [v, 0];
    if (v && typeof v === 'object' && v.kind === 'complex') return [v.re, v.im];
    return [NaN, NaN];
}

/** A sum of rotations compiled term by term. Throws an ExprError when it is no sum of numbers in t. */
export function compileFourier(ctx: MathContext, src: string, cap: number, circles?: number): FourierTerms {
    const ast: VNode = parseValue(src);
    if (ast.t !== 'call' || (ast.name !== 'sum' && ast.name !== 'Sum') || ast.args.length !== 4 || ast.args[1].t !== 'name') {
        // 6.0 P: a list of coefficients (a script's np.fft.fft(z) / len(z), any list of complex numbers).
        return compileCoefficients(ctx, src, circles);
    }
    const [body, kNode, loNode, hiNode] = ast.args;
    const k = kNode.t === 'name' ? kNode.name : 'k';
    const env = ctx.envFor('value');
    const defs = ctx.valueTable();
    const bound = (n: VNode) => {
        const v = new ValueCompiler({ env, defs, locals: null, src }).node(n).f();
        const r = typeof v === 'number' ? v : NaN;
        if (!Number.isFinite(r)) throw new ExprError(msg('iterate.problem.sumTakes'), { pos: 0 });
        return Math.round(r);
    };
    const lo = bound(loNode);
    const hi = bound(hiNode);
    const count = Math.max(0, hi - lo + 1);
    const n = Math.min(count, cap);
    let term: (kv: number, t: number) => [number, number];
    try {
        const fast = compileComplexFormula(body, env, defs, [k, 't']);
        const inp = new Float64Array(4);
        const out = new Float64Array(2);
        term = (kv, tv) => {
            inp[0] = kv;
            inp[2] = tv;
            fast.run(inp, out);
            return [out[0], out[1]];
        };
    } catch {
        const kCell: Cell = { v: NaN };
        const tCell: Cell = { v: NaN };
        const locals = new Locals(new Locals(null, k, kCell, NUM), 't', tCell, NUM);
        const f = new ValueCompiler({ env, defs, locals, src }).node(body).f;
        term = (kv, tv) => {
            kCell.v = kv;
            tCell.v = tv;
            return complexOf(f());
        };
    }
    // A term that is no number at t = 0.3 is a problem now, not a blank picture later.
    for (let i = 0; i < n; i++) {
        const [re, im] = term(lo + i, 0.3);
        if (!Number.isFinite(re) || !Number.isFinite(im)) throw new ExprError(msg('iterate.problem.termValue', { k: lo + i }), { pos: 0 });
    }
    return {
        capped: count > cap,
        count: n,
        at(t) {
            const out: Array<[number, number]> = [];
            for (let i = 0; i < n; i++) out.push(term(lo + i, t));
            return out;
        },
    };
}

// ------------------------------------------------------------ 6.0 P

/** Circles of a list of coefficients at most (a list from a script can be long). */
export const MAX_COEFFICIENTS = 400;

/**
 * The frequency of each coefficient of a list of n, in NumPy's fftfreq
 * order: 0, 1, ..., ceil(n/2) - 1, then -floor(n/2), ..., -1 (what
 * np.fft.fft gives), and the order the circles are drawn in: 0, 1, -1, 2,
 * -2, ...
 */
export function coefficientOrder(n: number): Array<{ index: number; freq: number }> {
    const half = Math.ceil(n / 2);
    const out = Array.from({ length: n }, (_, i) => ({ index: i, freq: i < half ? i : i - n }));
    out.sort((a, b) => Math.abs(a.freq) - Math.abs(b.freq) || b.freq - a.freq);
    return out;
}

/**
 * Turning circles of a list of coefficients c (a let value or a script's
 * array): the term of c[i] is c[i] e^{i f t} with f its fftfreq frequency,
 * the first `count` of them in the order 0, 1, -1, 2, -2, ... Throws an
 * ExprError when the formula is no list of numbers.
 */
function compileCoefficients(ctx: MathContext, src: string, count?: number): FourierTerms {
    const env = ctx.envFor('value');
    const defs = ctx.valueTable();
    let v: Value;
    try {
        v = new ValueCompiler({ env, defs, locals: null, src }).node(parseValue(src)).f();
    } catch (e) {
        if (e instanceof ExprError) throw e;
        throw new ExprError(msg('python.problem.coefficients', { name: src }), { pos: 0 });
    }
    if (typeof v === 'number' || v.kind !== 'list' || !v.items.length) throw new ExprError(msg('python.problem.coefficients', { name: src }), { pos: 0 });
    const cs = v.items.map(complexOf);
    if (cs.some(([re, im]) => !Number.isFinite(re) || !Number.isFinite(im))) throw new ExprError(msg('python.problem.coefficients', { name: src }), { pos: 0 });
    const order = coefficientOrder(cs.length);
    const want = count === undefined || !Number.isFinite(count) ? order.length : Math.max(0, Math.round(count));
    const n = Math.min(want, order.length, MAX_COEFFICIENTS);
    const terms = order.slice(0, n).map((o) => ({ re: cs[o.index][0], im: cs[o.index][1], f: o.freq }));
    return {
        capped: Math.min(want, order.length) > MAX_COEFFICIENTS,
        count: n,
        at(t) {
            const out: Array<[number, number]> = [];
            for (const c of terms) {
                const cos = Math.cos(c.f * t);
                const sin = Math.sin(c.f * t);
                out.push([c.re * cos - c.im * sin, c.re * sin + c.im * cos]);
            }
            return out;
        },
    };
}
