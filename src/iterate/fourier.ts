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
export function compileFourier(ctx: MathContext, src: string, cap: number): FourierTerms {
    const ast: VNode = parseValue(src);
    if (ast.t !== 'call' || (ast.name !== 'sum' && ast.name !== 'Sum') || ast.args.length !== 4 || ast.args[1].t !== 'name') {
        throw new ExprError(msg('iterate.problem.sumTakes'), { pos: 0 });
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
