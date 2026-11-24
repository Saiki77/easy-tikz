/*
 * Ask the curve (6.0 B's menu) learns the questions of part E: for a
 * function f clicked at x = a, Newton's method from a, and the cobweb of
 * x_{n+1} = f(x_n) from a when f maps an interval around a to itself (the
 * part of the view where y = x shows). Registered when this module loads
 * (src/modal.ts imports it). Pure: no DOM.
 */
import { registerQuestions } from '../notes6/ask';
import type { AskContext, Question } from '../notes6/ask';
import { t } from '../i18n';

/** Samples of f over the interval for the cobweb's test. */
const SAMPLES = 120;

/** Does f map the interval [lo, hi] into itself (on a grid of samples)? */
export function mapsToItself(f: (x: number) => number, lo: number, hi: number): boolean {
    if (!(hi > lo)) return false;
    const slack = 1e-9 * (hi - lo);
    for (let i = 0; i <= SAMPLES; i++) {
        const y = f(lo + ((hi - lo) * i) / SAMPLES);
        if (!Number.isFinite(y) || y < lo - slack || y > hi + slack) return false;
    }
    return true;
}

export function iterateQuestions(ctx: AskContext): Question[] {
    const f = ctx.target.name;
    const info = ctx.math.functionInfo(f);
    if (!info || info.kind !== 'cartesian') return [];
    const a = ctx.target.x;
    const group = t('iterate.ask.group');
    const out: Question[] = [
        {
            id: 'iterate-newton',
            group,
            label: t('iterate.ask.newton'),
            answer: { lines: [`draw Newton's method for ${f} from ${ctx.num(a)}, 5 steps, labelled`] },
        },
    ];
    const lo = Math.max(ctx.view.xmin, ctx.view.ymin);
    const hi = Math.min(ctx.view.xmax, ctx.view.ymax);
    if (a >= lo && a <= hi && mapsToItself(info.fn, lo, hi)) {
        out.push({
            id: 'iterate-cobweb',
            group,
            label: t('iterate.ask.cobweb'),
            answer: { lines: [`draw the cobweb of $x_{n+1} = ${f}(x_n)$ from ${ctx.num(a)}, 40 steps`] },
        });
    }
    return out;
}

registerQuestions('function', iterateQuestions);
