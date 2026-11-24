/*
 * Linear algebra (6.0 D), drag to edit: the tips of î and ĵ moved by a let
 * matrix change its numbers (LaTeX or plain), a literal matrix of the
 * transform changes in place, the tips of let vectors change theirs; what
 * is not written as numbers is locked; undo restores the text.
 */
import { test, assert } from './_lib';
import { parseChartText } from '../src/text/parse';
import { SettingsManager } from '../src/settings';
import { computeScene2D, labelMetricsFor } from '../src/scene';
import { buildHitIndex } from '../src/drag/hits';
import { fieldText, resolveTarget, setFieldText } from '../src/drag/targets';
import { prepareDrag, startSession } from '../src/drag/session';
import type { DragContext, Pt } from '../src/drag/types';
import { numberSlots } from '../src/linear/drag';

const W = 600;
const H = 600;

function contextOf(text: string): { ctx: DragContext; data: DragContext } {
    const parsed = parseChartText(text);
    assert.deepEqual(parsed.problems, [], text);
    const settings = SettingsManager.fromJSON(parsed.data);
    const math = settings.createMathContext({ memo: false });
    const cfg = settings.toRendererConfig(math);
    const view = { xmin: cfg.xmin, xmax: cfg.xmax, ymin: cfg.ymin, ymax: cfg.ymax };
    const scene = computeScene2D({ functions: cfg.functions, tools: cfg.tools, math, view, grid: { nx: 60, ny: 60 }, axisStyle: cfg.axisStyle, polar: false, labelMetrics: labelMetricsFor(10, 10) });
    const ctx: DragContext = {
        functions: cfg.functions,
        tools: cfg.tools,
        annotations: cfg.annotations,
        parameters: cfg.parameters,
        math,
        mathInput: settings.mathContextInput(),
        hits: buildHitIndex({ items: scene.items, curves: [] }),
        map: { view, kx: W / (view.xmax - view.xmin), ky: H / (view.ymax - view.ymin) },
        ticks: { x: [], y: [] },
        polar: false,
        axisSliders: new Set(),
        keyNames: { mod: 'Cmd', alt: 'Option' },
    };
    return { ctx, data: ctx };
}

/** Press on `at`, drag to `to`, release: the commit, and the edits of the last frame. */
function drag(ctx: DragContext, at: Pt, to: Pt) {
    const hit = ctx.hits.pick(at, { line: 6, point: 9 }, ctx.map);
    assert.ok(hit, `nothing at ${JSON.stringify(at)}`);
    const target = resolveTarget(hit, ctx);
    const plan = prepareDrag(target, hit.at, 'move', ctx);
    if ('lock' in plan) return { target, lock: plan.lock, frame: null, commit: null };
    const session = startSession(plan, { shift: false, alt: false }, ctx);
    const frame = session.update(to, { shift: false, alt: false });
    return { target, lock: null, frame, commit: session.commit(), session };
}

const VIEW = 'show x from -5 to 5 and y from -5 to 5';

test('the numbers of a matrix or vector written as numbers, in order', () => {
    assert.deepEqual(
        numberSlots('[[1.5, 1], [0.5, -2]]')?.map((s) => s.value),
        [1.5, 1, 0.5, -2]
    );
    assert.deepEqual(
        numberSlots('\\begin{pmatrix} 1 & 1 \\\\ 0 & 1 \\end{pmatrix}')?.map((s) => s.value),
        [1, 1, 0, 1]
    );
    assert.deepEqual(
        numberSlots('(2, 1)')?.map((s) => s.value),
        [2, 1]
    );
    assert.equal(numberSlots('[[a, 1], [0, 1]]'), null);
    assert.equal(numberSlots('R(\\theta)'), null);
});

test('the tip of ĵ moved by a let matrix: column 2 of A follows the pointer', () => {
    const { ctx } = contextOf(`${VIEW}\nlet $A = \\begin{pmatrix} 1 & 1 \\\\ 0 & 1 \\end{pmatrix}$\ndraw the basis vectors\ntransform the plane by A`);
    const r = drag(ctx, { x: 1, y: 1 }, { x: -1, y: 2 });
    assert.equal(r.lock, null);
    assert.equal(r.target.kind, 'tip');
    assert.equal(r.frame?.edits[0].text, '\\begin{pmatrix} 1 & -1 \\\\ 0 & 2 \\end{pmatrix}');
    assert.equal(r.commit?.fields[0].before, '\\begin{pmatrix} 1 & 1 \\\\ 0 & 1 \\end{pmatrix}');
    assert.equal(r.commit?.fields[0].after, '\\begin{pmatrix} 1 & -1 \\\\ 0 & 2 \\end{pmatrix}');
    // The commit writes the value tool's formula.
    const ref = r.commit!.fields[0].ref;
    assert.ok(setFieldText(ref, ctx, r.commit!.fields[0].after));
    assert.equal(fieldText(ref, ctx), '\\begin{pmatrix} 1 & -1 \\\\ 0 & 2 \\end{pmatrix}');
    assert.equal(ctx.tools.find((t) => t.name === 'A')?.type, 'value');
});

test('a literal matrix of the transform changes in place; î changes column 1', () => {
    const { ctx } = contextOf(`${VIEW}\ndraw the basis vectors\ntransform the plane by [[2, 0], [0, 1]]`);
    const r = drag(ctx, { x: 2, y: 0 }, { x: 1.5, y: 0.5 });
    assert.equal(r.frame?.edits[0].text, '[[1.5, 0], [0.5, 1]]');
    assert.equal((r.frame?.edits[0].ref as { field: string }).field, 'map');
});

test('the tip of a let vector changes its numbers; from a point, the vector is the tip less the start', () => {
    const { ctx } = contextOf(`${VIEW}\nlet v = (2, 1)\nlet w = (1, 1)\ndraw v as an arrow\ndraw w as an arrow from (1, 1)`);
    assert.equal(drag(ctx, { x: 2, y: 1 }, { x: 3, y: -1 }).frame?.edits[0].text, '(3, -1)');
    assert.equal(drag(ctx, { x: 2, y: 2 }, { x: 3, y: 4 }).frame?.edits[0].text, '(2, 3)');
});

test('what is not written as numbers is locked; a cancel puts the text back', () => {
    const { ctx } = contextOf(`${VIEW}\nslider a from 0 to 2, starting at 1\nlet A = [[1, a], [0, 1]]\ndraw the basis vectors\ntransform the plane by A`);
    const r = drag(ctx, { x: 1, y: 1 }, { x: 2, y: 2 });
    assert.ok(r.lock, 'locked');
    const ok = contextOf(`${VIEW}\nlet v = (2, 1)\ndraw v as an arrow`).ctx;
    const hit = ok.hits.pick({ x: 2, y: 1 }, { line: 6, point: 9 }, ok.map)!;
    const plan = prepareDrag(resolveTarget(hit, ok), hit.at, 'move', ok);
    assert.ok(!('lock' in plan));
    if ('lock' in plan) return;
    const s = startSession(plan, { shift: false, alt: false }, ok);
    s.update({ x: 4, y: 4 }, { shift: false, alt: false });
    assert.deepEqual(
        s.cancel().edits.map((e) => e.text),
        ['(2, 1)']
    );
});
