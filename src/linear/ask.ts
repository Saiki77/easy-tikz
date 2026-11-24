/*
 * 6.0 D: Ask the curve for arrows and transforms (src/notes6/ask.ts holds
 * the menu, src/linear/pick.ts what a click hits).
 *
 *   A transform by a matrix: its eigenvectors, the image of the unit square
 *   with det, the span of its columns, the inverse transform in the next
 *   step, a function it moves. A map of points: the image of the unit
 *   square, a function it moves. A grid without a transform: a shear in the
 *   next step, and the basis vectors.
 *   An arrow (a vector v): its span, the span of v and w, v + w tip to
 *   tail, A v for each matrix A of the chart. The basis vectors: the image
 *   of the unit square, the eigenvectors of the matrix that moves them.
 *
 * Answers are chart lines in the built-in words. Pure: no DOM, no Obsidian.
 */
import type { Tool, ValueTool } from '../types';
import { AskContext, Question, registerQuestions } from '../notes6/ask';
import { t } from '../i18n';
import { lastStep, stepOf } from '../motion6/steps';
import { compileMap, splitMapsto } from './maps';
import { moverOf } from './pick';

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A formula as a line writes it: LaTeX in $...$. */
const formula = (ctx: AskContext, src: string) => ctx.formula(src);

/** The let names of the chart whose value is a vector (k = 'vec') or a matrix ('mat'). */
function letsOf(ctx: AskContext, k: 'vec' | 'mat'): string[] {
    const table = ctx.math.valueTable();
    return ctx.tools
        .filter((x): x is ValueTool => x.type === 'value' && !x.params.trim())
        .map((x) => x.name)
        .filter((n) => {
            try {
                return table.has(n) && !table.isFunction(n) && table.shape(n).k === k;
            } catch {
                return false;
            }
        });
}

/** `step=k` for a new last step (an answer that adds a step: a line with `then` would not be found in the chart again). */
const nextStep = (ctx: AskContext) => `step=${lastStep(ctx.data) + 1}`;

/** The questions about a transform (or a grid that no transform moves). */
function transformQuestions(ctx: AskContext): Question[] {
    const group = t('linear.ask.group');
    const tool = ctx.tools.find((x) => x.name === ctx.target.name);
    if (!tool) return [];
    if (tool.type === 'planeGrid') {
        const q: Question[] = [{ id: 'shear', group, label: t('linear.ask.gridTransform'), answer: { lines: [`transform the plane by [[1, 1], [0, 1]], ${nextStep(ctx)}`] } }];
        if (!ctx.tools.some((x) => x.type === 'basisVectors')) q.push({ id: 'basis', group, label: t('linear.ask.basis'), answer: { lines: ['draw the basis vectors'] } });
        return q;
    }
    if (tool.type !== 'transform') return [];
    const src = tool.map.trim();
    if (!src) return [];
    let matrix: number[] | null = null;
    try {
        matrix = compileMap(ctx.math, src, 2).m;
    } catch {
        return [];
    }
    const q: Question[] = [];
    const m = formula(ctx, src);
    if (matrix) {
        q.push({ id: 'eigenvectors', group, label: t('linear.ask.eigenvectors'), answer: { lines: [`draw the eigenvectors of ${m}, labelled`] } });
    }
    q.push({ id: 'unit-square', group, label: t('linear.ask.unitSquare'), answer: { lines: ['shade the image of the unit square, labelled'] } });
    if (matrix) {
        const cols = NAME.test(src) ? `${src}(1, 0) and ${src}(0, 1)` : `(${ctx.num(matrix[0])}, ${ctx.num(matrix[2])}) and (${ctx.num(matrix[1])}, ${ctx.num(matrix[3])})`;
        q.push({ id: 'span', group, label: t('linear.ask.span'), answer: { lines: [`draw the span of ${cols}`] } });
        const d = matrix[0] * matrix[3] - matrix[1] * matrix[2];
        if (Math.abs(d) > 1e-12) {
            const inv = NAME.test(src) ? `$${src}^{-1}$` : `[[${ctx.num(matrix[3] / d)}, ${ctx.num(-matrix[1] / d)}], [${ctx.num(-matrix[2] / d)}, ${ctx.num(matrix[0] / d)}]]`;
            q.push({ id: 'inverse', group, label: t('linear.ask.inverse'), answer: { lines: [`transform the plane by ${inv}, ${nextStep(ctx)}`] } });
        }
    }
    // A function of the transform's step: it moves with it.
    q.push({ id: 'function', group, label: t('linear.ask.function'), answer: { lines: [`plot $\\frac{x^2}{4}$ in purple, thick, step=${stepOf(tool)}`] } });
    return q;
}

/** The questions about an arrow: a vector tool (its first vector) or the basis vectors. */
function vectorQuestions(ctx: AskContext): Question[] {
    const group = t('linear.ask.group');
    const tool = ctx.tools.find((x) => x.name === ctx.target.name);
    if (!tool) return [];
    if (tool.type === 'basisVectors') {
        const q: Question[] = [{ id: 'unit-square', group, label: t('linear.ask.unitSquare'), answer: { lines: ['shade the image of the unit square, labelled'] } }];
        const mover = moverOf(ctx.tools, tool.name);
        if (mover && mover.type === 'transform' && mover.map.trim() && !splitMapsto(mover.map)) {
            q.push({ id: 'eigenvectors', group, label: t('linear.ask.eigenvectors'), answer: { lines: [`draw the eigenvectors of ${formula(ctx, mover.map.trim())}, labelled`] } });
        }
        return q;
    }
    if (tool.type !== 'vector') return [];
    const v = tool.vectors.split(';')[0]?.trim();
    if (!v || !NAME.test(v)) return [];
    const q: Question[] = [{ id: 'span', group, label: t('linear.ask.vectorSpan', { v }), answer: { lines: [`draw the span of ${v}`] } }];
    const others = new Set<string>(letsOf(ctx, 'vec').filter((w) => w !== v));
    for (const w of others) {
        q.push({ id: `span:${w}`, group, label: t('linear.ask.vectorSpanWith', { v, w }), answer: { lines: [`draw the span of ${v} and ${w}`] } });
        q.push({ id: `sum:${w}`, group, label: t('linear.ask.vectorSum', { v, w }), answer: { lines: [`draw ${v} + ${w} tip to tail, labelled`] } });
    }
    for (const a of letsOf(ctx, 'mat')) {
        q.push({ id: `image:${a}`, group, label: t('linear.ask.vectorImage', { m: a, v }), answer: { lines: [`draw ${a} ${v} as an arrow in red, labelled`] } });
    }
    return q;
}

registerQuestions('transform', transformQuestions);
registerQuestions('vector', vectorQuestions);

/** For tests: the tools of a chart that an arrow or a transform question may name. */
export function askable(tools: Tool[]): string[] {
    return tools.filter((x) => x.type === 'vector' || x.type === 'basisVectors' || x.type === 'transform' || x.type === 'planeGrid').map((x) => x.name);
}
