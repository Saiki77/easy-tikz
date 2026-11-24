/*
 * Linear algebra and complex maps (6.0 D): Ask the curve for arrows and
 * transforms (what a click hits, the questions, answers that go in and
 * draw), and the hover cards of matrices, products, determinants and eigen
 * equations.
 */
import { test, assert } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText } from '../src/text/print';
import { SettingsManager } from '../src/settings';
import { computeScene2D, labelMetricsFor } from '../src/scene';
import { AskTarget, answerPresent, applyAnswer, askContext, askQuestions, pickTarget, removeAnswer } from '../src/notes6/ask';
import '../src/linear/ask';
import { linearHoverCard, linearHoverKind, noteValues } from '../src/linear/hover';
import type { Parameter } from '../src/types';

type Data = Record<string, unknown>;

function askOf(text: string, target: AskTarget) {
    const parsed = parseChartText(text);
    assert.deepEqual(parsed.problems, [], text);
    const settings = SettingsManager.fromJSON(parsed.data);
    const data = settings.serialize();
    const math = settings.createMathContext({ memo: false });
    math.setParams((data.parameters as Parameter[]) ?? []);
    const view = settings.resolveView(math).view;
    return { data, ctx: askContext(target, data, view, math), settings, math };
}

const CHART = 'show x from -4 to 4 and y from -4 to 4\nlet A = [[1.5, 1], [0.5, 2]]\nlet v = (1, 2)\nlet w = (2, -1)\ndraw the grid\ndraw the basis vectors\ndraw v as an arrow\nthen transform the plane by A';

test('a click on the moved grid asks about the transform, on an arrow about the vector', () => {
    const { settings, math, data } = askOf(CHART, { kind: 'transform', name: 'T1', x: 0, y: 0 });
    const config = settings.toRendererConfig(math);
    const scene = computeScene2D({ functions: config.functions, tools: config.tools, math, view: { xmin: -4, xmax: 4, ymin: -4, ymax: 4 }, grid: { nx: 50, ny: 50 }, axisStyle: 'box', polar: false, labelMetrics: labelMetricsFor(10, 10) });
    const tools = data.tools as never;
    // ĵ of the moved basis ends at (1, 2): a click on it is the arrow.
    const onBasis = pickTarget({ items: scene.items, curves: [] }, tools, { x: 0.5, y: 1 }, 50, 50, 8);
    assert.equal(onBasis?.kind, 'vector');
    assert.equal(onBasis?.name, 'BV1');
    // The moved line x = 1 (now through A(1, 0) = (1.5, 0.5) along A(0, 1) = (1, 2)): the transform.
    const onGrid = pickTarget({ items: scene.items, curves: [] }, tools, { x: 2.5, y: 2.5 }, 50, 50, 8);
    assert.deepEqual(onGrid && [onGrid.kind, onGrid.name], ['transform', 'T1']);
});

test('the questions of a transform: eigenvectors, the unit square, the span, the inverse, a function; they go in and draw', () => {
    const { data, ctx } = askOf(CHART, { kind: 'transform', name: 'T1', x: 0, y: 0 });
    const qs = askQuestions(ctx);
    assert.deepEqual(
        qs.map((q) => q.id),
        ['eigenvectors', 'unit-square', 'span', 'inverse', 'function']
    );
    const line = (id: string) => qs.find((q) => q.id === id)?.answer.lines?.[0];
    assert.equal(line('eigenvectors'), 'draw the eigenvectors of A, labelled');
    assert.equal(line('span'), 'draw the span of A(1, 0) and A(0, 1)');
    assert.equal(line('inverse'), 'transform the plane by $A^{-1}$, step=2');
    for (const q of qs) {
        const next = applyAnswer(data, q.answer);
        assert.ok(next, `${q.id} does not read`);
        assert.ok(answerPresent(next, q.answer), q.id);
        assert.deepEqual(parseChartText(printChartText(next)).problems, [], q.id);
        assert.equal(answerPresent(removeAnswer(next, q.answer), q.answer), false, q.id);
    }
    // The function is in the transform's step, so it moves with it.
    const fn = applyAnswer(data, qs.find((q) => q.id === 'function')!.answer)!;
    assert.equal(((fn.functions as Data[])[0] as Data).step, 1);
});

test('the questions of an arrow and of the basis vectors; a grid without a transform', () => {
    const arrow = askQuestions(askOf(CHART, { kind: 'vector', name: 'V1', x: 1, y: 2 }).ctx).map((q) => q.answer.lines?.[0]);
    assert.deepEqual(arrow, ['draw the span of v', 'draw the span of v and w', 'draw v + w tip to tail, labelled', 'draw A v as an arrow in red, labelled']);
    const basis = askQuestions(askOf(CHART, { kind: 'vector', name: 'BV1', x: 1, y: 0 }).ctx).map((q) => q.id);
    assert.deepEqual(basis, ['unit-square', 'eigenvectors']);
    const grid = askQuestions(askOf('draw the grid', { kind: 'transform', name: 'G1', x: 0, y: 0 }).ctx).map((q) => q.answer.lines?.[0]);
    assert.deepEqual(grid, ['transform the plane by [[1, 1], [0, 1]], step=1', 'draw the basis vectors']);
    const z = askQuestions(askOf('draw the grid\ntransform the plane by $z \\mapsto z^2$', { kind: 'transform', name: 'T1', x: 0, y: 0 }).ctx).map((q) => q.id);
    assert.deepEqual(z, ['unit-square', 'function']);
});

test('hover cards: a matrix moves the grid with a t slider; A v, det A and A v = λ v', () => {
    const tex = '\\begin{pmatrix} 2 & 1 \\\\ 0 & 1 \\end{pmatrix}';
    assert.equal(linearHoverKind(tex), 'matrix');
    assert.equal(linearHoverKind(`A = ${tex}`), 'matrix');
    assert.equal(linearHoverKind('A v'), 'product');
    assert.equal(linearHoverKind('\\det A'), 'det');
    assert.equal(linearHoverKind('A v = \\lambda v'), 'eigen');
    assert.equal(linearHoverKind('x^2 + 1'), null);
    const defs = noteValues([`A = ${tex}`, 'v = \\begin{pmatrix} 1 \\\\ 1 \\end{pmatrix}']);
    for (const f of [tex, `A = ${tex}`, 'A v', '\\det A', 'A v = \\lambda v', 'Av']) {
        const card = linearHoverCard(f, defs);
        assert.ok(card, f);
        const parsed = parseChartText(card.lines.join('\n'));
        assert.deepEqual(parsed.problems, [], `${f}:\n${card.lines.join('\n')}`);
        // The chart draws without a problem: the grid moves with s.
        const settings = SettingsManager.fromJSON(parsed.data);
        const math = settings.createMathContext({ memo: false });
        const config = settings.toRendererConfig(math);
        const scene = computeScene2D({ functions: config.functions, tools: config.tools, math, view: { xmin: -4, xmax: 4, ymin: -3, ymax: 3 }, grid: { nx: 40, ny: 40 }, axisStyle: 'box', polar: false, labelMetrics: labelMetricsFor(10, 10) });
        assert.deepEqual(scene.issues, [], f);
    }
    const m = linearHoverCard(tex, defs)!;
    assert.ok(m.lines.some((l) => /^slider s from 0 to 1/.test(l)));
    // Without definitions in the note: an example, and the card says so.
    const ex = linearHoverCard('B w', new Map())!;
    assert.equal(ex.example, true);
    assert.deepEqual(parseChartText(ex.lines.join('\n')).problems, []);
});
