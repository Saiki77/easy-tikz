/*
 * 6.0 B, notes and interaction: sets on an axis (`mark where $g(x) \le 0$ on
 * the x-axis`) and chords (`draw the chord of g from -1 to 3 at $\lambda$`):
 * the lines read and print back, their Full LaTeX, the set itself (ends in
 * the set or not, arrows, points, ∅ and ℝ), the scene, the export, the fit;
 * a chart without a y range whose y follows what is drawn; charts from
 * formulas that keep the note's name and give x only.
 */
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText, printFullText, writeChartText } from '../src/text/print';
import { canonical } from '../src/chartdata';
import { SettingsManager } from '../src/settings';
import { computeScene2D, labelMetricsFor, Scene2D, SceneItem2D } from '../src/scene';
import { fitSettings } from '../src/fit';
import { generateTikz2D } from '../src/export';
import { compileCondition, intervalCondition, setTex, solveSet } from '../src/notes6/sets';
import { formulaBlock, formulaChart, formulaLines } from '../src/formula';
import { recipes } from '../src/migrate';
import { Parameter } from '../src/types';

type Data = Record<string, unknown>;

function roundTrip(text: string): string {
    const first = parseChartText(text);
    assert.deepEqual(first.problems, [], `problems in ${text}`);
    const printed = printChartText(first.data);
    const back = parseChartText(printed);
    assert.deepEqual(back.problems, [], `problems in the printed text:\n${printed}`);
    assert.equal(canonical(back.data), canonical(first.data), `printed:\n${printed}`);
    const full = printFullText(first.data);
    const fromFull = parseChartText(full);
    assert.deepEqual(fromFull.problems, [], `problems in the Full LaTeX:\n${full}`);
    assert.equal(canonical(fromFull.data), canonical(first.data), `Full LaTeX:\n${full}`);
    return printed;
}

function settingsOf(text: string): SettingsManager {
    const parsed = parseChartText(text);
    assert.deepEqual(parsed.problems, [], text);
    return SettingsManager.fromJSON(parsed.data);
}

function sceneOf(text: string, values?: Record<string, number>): Scene2D {
    const settings = settingsOf(text);
    const math = settings.createMathContext({ memo: false });
    const params = (settings.getValue<Parameter[]>('parameters') ?? []).map((p) => (values && p.name in values ? { ...p, value: values[p.name] } : p));
    math.setParams(params);
    const config = settings.toRendererConfig(math);
    return computeScene2D({
        functions: config.functions,
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: { nx: 120, ny: 120 },
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(10, 10),
    });
}

const item = (scene: Scene2D, name: string): SceneItem2D => {
    const found = scene.items.find((i) => i.source === name);
    assert.ok(found, `no item ${name}`);
    return found;
};

const G = 'show x from -5 to 5 and y from -6 to 10\nplot $g(x) = x^2 - 4$\n';

// ----------------------------------------------------------- the lines

test('notes6: a set on an axis reads and prints back, in words and in Full LaTeX', () => {
    assert.equal(roundTrip(`${G}mark where $g(x) \\le 0$ on the x-axis, labelled`).split('\n')[2], 'mark where $g(x) \\le 0$ on the x-axis, labelled');
    assert.equal(roundTrip(`${G}mark where g(x) > 0 on the x-axis in red, thick`).split('\n')[2], 'mark where g(x) > 0 on the x-axis in red, thick');
    roundTrip(`${G}S: mark where $\\vert x - 1 \\vert < 2$ on the x-axis, labelled "near 1"`);
    roundTrip(`${G}mark where y^2 < 4 on the y-axis, hidden`);
    roundTrip(`${G}mark where x < -1 or x > 2 on the x-axis`);
    roundTrip(`${G}mark where g(x) = 0 on the x-axis, labelled`);
    const tool = (parseChartText(`${G}mark where $g(x) \\le 0$ on the x-axis, labelled`).data.tools as Data[])[0];
    assert.deepEqual(tool, { type: 'axisSet', name: 'AX1', condition: 'g(x) \\le 0', axis: 'x', valueLabel: true });
    assert.match(printFullText(parseChartText(`${G}mark where $g(x) \\le 0$ on the x-axis, labelled`).data), /\\mark\[x-axis, labelled\]\{g\(x\) \\le 0\}/);
    // A form that does not read is named.
    assert.match(parseChartText(`${G}mark where g(x) <= 0 on the z-axis`).problems[0].message, /^Write: mark where/);
    assert.match(parseChartText(`${G}mark where g(x) <= 0 on the x-axis, sparkly`).problems[0].message, /unknown option "sparkly"; a set on an axis takes/);
});

test('notes6: a chord reads and prints back, in words and in Full LaTeX', () => {
    const base = 'show x from -3 to 4 and y from -2 to 6\nslider lambda from 0 to 1, starting at 0.3\nplot $g(x) = x^2/2 - 1$\n';
    assert.equal(roundTrip(`${base}draw the chord of g from -1 to 3 at $\\lambda$, labelled`).split('\n').pop(), 'draw the chord of g from -1 to 3 at $\\lambda$, labelled');
    assert.equal(roundTrip(`${base}CH: draw the chord of g from -1 to 3 in blue, dashed`).split('\n').pop(), 'CH: draw the chord of g from -1 to 3 in blue, dashed');
    roundTrip(`${base}draw the chord of g from -lambda to 2lambda + 1 at 0.5, labelled "gap {gap:2}"`);
    const tool = (parseChartText(`${base}draw the chord of g from -1 to 3 at $\\lambda$`).data.tools as Data[])[0];
    assert.deepEqual(tool, { type: 'chord', name: 'CH1', function: 'g', from: '-1', to: '3', at: '\\lambda' });
    assert.match(printFullText(parseChartText(`${base}draw the chord of g from -1 to 3 at $\\lambda$, labelled`).data), /\\draw\[chord, from=-1, to=3, at=\\lambda, labelled\]\{g\}/);
    assert.match(parseChartText(`${base}draw the chord of g`).problems[0].message, /^Write: draw the chord of g from -1 to 3/);
});

test('notes6: a changed set keeps the other lines of a block as written', () => {
    const text = `${G}% the set\nmark where $g(x) \\le 0$ on the x-axis`;
    const data = parseChartText(text).data;
    (data.tools as Data[])[0].color = 'red';
    const out = writeChartText(text, data);
    assert.ok(out.includes('% the set'));
    assert.ok(out.includes('mark where $g(x) \\le 0$ on the x-axis in red'), out);
});

// ------------------------------------------------------------- the set

test('notes6: the set where a condition holds, with its ends', () => {
    const math = settingsOf('plot g(x) = x^2 - 4').createMathContext({ memo: false });
    const set = (cond: string, axis: 'x' | 'y' = 'x') => solveSet(compileCondition(math, cond, axis), -10, 10);
    assert.deepEqual(set('g(x) <= 0'), [{ a: -2, b: 2, closedA: true, closedB: true }]);
    assert.deepEqual(set('g(x) < 0'), [{ a: -2, b: 2, closedA: false, closedB: false }]);
    assert.deepEqual(set('g(x) >= 0'), [
        { a: -Infinity, b: -2, closedA: false, closedB: true },
        { a: 2, b: Infinity, closedA: true, closedB: false },
    ]);
    assert.deepEqual(set('g(x) = 0'), [
        { a: -2, b: -2, closedA: true, closedB: true },
        { a: 2, b: 2, closedA: true, closedB: true },
    ]);
    assert.deepEqual(set('x^2 <= 0'), [{ a: 0, b: 0, closedA: true, closedB: true }]);
    assert.deepEqual(set('x^2 < 0'), []);
    assert.deepEqual(set('x^2 >= -1'), [{ a: -Infinity, b: Infinity, closedA: false, closedB: false }]);
    assert.deepEqual(set('0 <= x < 1 or x > 3'), [
        { a: 0, b: 1, closedA: true, closedB: false },
        { a: 3, b: Infinity, closedA: false, closedB: false },
    ]);
    assert.deepEqual(set('\\vert x - 1 \\vert < 2'), [{ a: -1, b: 3, closedA: false, closedB: false }]);
    assert.deepEqual(set('y^2 <= 9', 'y'), [{ a: -3, b: 3, closedA: true, closedB: true }]);
    // sqrt has no value left of 0: the set starts there, in it.
    assert.deepEqual(set('sqrt(x) <= 1'), [{ a: 0, b: 1, closedA: true, closedB: true }]);
    assert.equal(intervalCondition('\\lambda \\in [0, 1)', 'x'), '0 <= x < 1');
    assert.equal(intervalCondition('x \\in (-\\infty, 2]'), 'x <= 2');
});

test('notes6: the set in set notation', () => {
    assert.equal(setTex([{ a: -2, b: 2, closedA: true, closedB: true }]), '[-2, 2]');
    assert.equal(setTex([]), '\\emptyset');
    assert.equal(setTex([{ a: -Infinity, b: Infinity, closedA: false, closedB: false }]), '\\mathbb{R}');
    assert.equal(
        setTex([
            { a: -Infinity, b: -2, closedA: false, closedB: true },
            { a: 2, b: Infinity, closedA: true, closedB: false },
        ]),
        '(-\\infty, -2] \\cup [2, \\infty)'
    );
    assert.equal(
        setTex([
            { a: -2, b: -2, closedA: true, closedB: true },
            { a: 1.5, b: 1.5, closedA: true, closedB: true },
        ]),
        '\\{-2, 1.5\\}'
    );
});

// ------------------------------------------------------------ the scene

test('notes6: a set on the x-axis draws a bar, dots and its label', () => {
    let it = item(sceneOf(`${G}mark where $g(x) \\le 0$ on the x-axis, labelled`), 'AX1');
    assert.deepEqual(it.strokes[0].lines, [[{ x: -2, y: 0 }, { x: 2, y: 0 }]]);
    assert.equal(it.strokes[0].arrow, undefined);
    assert.deepEqual(it.markers.map((m) => [m.x, m.y, !!m.open]), [[-2, 0, false], [2, 0, false]]);
    assert.equal(it.texts[0].text, '$\\{x \\mid g(x) \\le 0\\} = [-2, 2]$');
    // Open ends, arrows where it runs off the view.
    it = item(sceneOf(`${G}mark where g(x) > 0 on the x-axis, labelled`), 'AX1');
    assert.deepEqual(it.strokes.map((s) => s.arrow), ['backward', 'forward']);
    assert.ok(it.markers.every((m) => m.open));
    assert.equal(it.texts[0].text, '$\\{x \\mid g(x) > 0\\} = (-\\infty, -2) \\cup (2, \\infty)$');
    // An equation: its zeros as dots.
    it = item(sceneOf(`${G}mark where g(x) = 0 on the x-axis, labelled`), 'AX1');
    assert.equal(it.strokes.length, 0);
    assert.equal(it.texts[0].text, '$\\{x \\mid g(x) = 0\\} = \\{-2, 2\\}$');
    // The empty set and all of R.
    assert.equal(item(sceneOf(`${G}mark where g(x) < -5 on the x-axis, labelled`), 'AX1').texts[0].text, '$\\{x \\mid g(x) < -5\\} = \\emptyset$');
    it = item(sceneOf(`${G}mark where g(x) > -5 on the x-axis, labelled`), 'AX1');
    assert.equal(it.strokes[0].arrow, 'both');
    assert.ok(it.texts[0].text.endsWith('= \\mathbb{R}$'));
    // The y-axis, and the axis at the bottom edge when 0 is out of view.
    it = item(sceneOf('show x from -3 to 3 and y from -5 to 5\nmark where y^2 < 4 on the y-axis'), 'AX1');
    assert.deepEqual(it.strokes[0].lines, [[{ x: 0, y: -2 }, { x: 0, y: 2 }]]);
    it = item(sceneOf('show x from -3 to 3 and y from 1 to 5\nmark where x^2 < 4 on the x-axis'), 'AX1');
    assert.equal(it.strokes[0].lines[0][0].y, 1);
});

test('notes6: a set follows its slider and publishes its ends', () => {
    const text = 'show x from -5 to 5 and y from -6 to 10\nslider c from 1 to 9, starting at 4\nplot g(x) = x^2 - c\nmark where g(x) <= 0 on the x-axis';
    const s4 = sceneOf(text);
    near(s4.derived.AX1_x, -2, 1e-9);
    near(s4.derived.AX1_x2, 2, 1e-9);
    const s9 = sceneOf(text, { c: 9 });
    near(s9.derived.AX1_x, -3, 1e-9);
    near(s9.derived.AX1_x2, 3, 1e-9);
});

test('notes6: on the x-axis y is 0: where a curve crosses it; a condition with no value there is named', () => {
    const it = item(sceneOf('show x from -3 to 3 and y from -3 to 3\nmark where x^2 + y^2 = 4 on the x-axis, labelled'), 'AX1');
    assert.equal(it.texts[0].text, '$\\{x \\mid x^{2} + y^{2} = 4\\} = \\{-2, 2\\}$');
    const scene = sceneOf(`${G}mark where sqrt(-1 - x^2) > 0 on the x-axis`);
    assert.ok(scene.issues.some((i) => i.source === 'AX1' && /no value on the x-axis/.test(i.message)), JSON.stringify(scene.issues));
});

test('notes6: a chord, its points at lambda and the gap', () => {
    const text = 'show x from -3 to 4 and y from -2 to 6\nslider lambda from 0 to 1, starting at 0.25\nplot $g(x) = x^2$\ndraw the chord of g from -1 to 3 at $\\lambda$, labelled';
    const scene = sceneOf(text);
    const it = item(scene, 'CH1');
    assert.deepEqual(it.strokes[0].lines, [[{ x: -1, y: 1 }, { x: 3, y: 9 }]]);
    // x = 0.25 (-1) + 0.75 (3) = 2; the chord at 0.25 (1) + 0.75 (9) = 7; the graph at 4.
    near(scene.derived.CH1_x, 2, 1e-12);
    near(scene.derived.CH1_y, 7, 1e-12);
    near(scene.derived.CH1_val, 3, 1e-12);
    assert.equal(it.guides.length, 1);
    assert.equal(it.markers.length, 4);
    assert.deepEqual(
        it.texts.map((t) => t.text),
        ['$\\lambda\\,g(-1) + (1 - \\lambda)\\,g(3) = 7$', '$g(2) = 4$']
    );
    const at1 = sceneOf(text, { lambda: 1 });
    near(at1.derived.CH1_x, -1, 1e-12);
    near(at1.derived.CH1_val, 0, 1e-12);
    // A missing function is named.
    assert.ok(sceneOf('draw the chord of h from 0 to 1').issues.some((i) => i.source === 'CH1'));
});

// ------------------------------------------------------- export and fit

test('notes6: the export draws open dots, the bar and the label, with amssymb for R', () => {
    const settings = settingsOf(`${G}mark where g(x) > 0 on the x-axis, labelled`);
    const tex = generateTikz2D(settings, settings.createMathContext({ memo: false }));
    assert.match(tex, /mark options=\{fill=white, draw=etTeal, line width=0\.8pt\}/);
    assert.match(tex, /\\draw\[[^\]]*<->|\\draw\[[^\]]*->/);
    assert.match(tex, /\(-\\infty, -2\) \\cup \(2, \\infty\)/);
    assert.ok(!tex.includes('amssymb'));
    const all = settingsOf(`${G}mark where g(x) > -9 on the x-axis, labelled`);
    assert.ok(generateTikz2D(all, all.createMathContext({ memo: false })).includes('\\usepackage{amssymb}'));
});

test('notes6: the fit holds the ends of a set and a chord', () => {
    const set = settingsOf('mark where x^2 <= 4 on the x-axis');
    const fit = fitSettings(set, set.createMathContext({ memo: false }));
    assert.ok(fit.x && fit.x.min <= -2 && fit.x.max >= 2 && fit.x.max < 5, JSON.stringify(fit));
    const chord = settingsOf('plot g(x) = x^2, hidden\ndraw the chord of g from 1 to 3');
    const f2 = fitSettings(chord, chord.createMathContext({ memo: false }));
    assert.ok(f2.y && f2.y.max >= 9, JSON.stringify(f2));
});

test('notes6: the + Add recipes build a set and a chord', () => {
    const ctx = { is3D: false, functions: [], tools: [], parameters: [] };
    const set = recipes(false).find((r) => r.id === 'axis-set');
    const chord = recipes(false).find((r) => r.id === 'chord');
    assert.ok(set && chord);
    const a = set.build(ctx);
    assert.equal(a.kind, 'items');
    const b = chord.build(ctx);
    assert.ok(b.kind === 'items' && b.parameters?.[0]?.name === 'lambda' && b.tools[0].type === 'chord');
});

// ------------------------------------------------------- y follows

test('notes6: a chart that gives x and no y fits y to what it draws, live', () => {
    const text = 'show x from -5 to 5\nslider c from 0 to 10, starting at 4\nplot $g(x) = x^2 - c$';
    const parsed = parseChartText(text);
    assert.equal(parsed.data.fitY, true);
    assert.equal(printChartText(parsed.data), 'show x from -5 to 5\nslider c from 0 to 10, starting at 4\nplot g(x) = x^2 - c');
    const settings = SettingsManager.fromJSON(parsed.data);
    const math = settings.createMathContext({ memo: false });
    const view = (c: number) => {
        math.setParams([{ name: 'c', value: c, min: 0, max: 10, step: 0.1 }]);
        return settings.resolveView(math).view;
    };
    const v4 = view(4);
    assert.ok(v4.ymin <= -4 && v4.ymax >= 21 && v4.ymax <= 30, JSON.stringify(v4));
    const v10 = view(10);
    assert.ok(v10.ymin <= -10 && v10.ymin > -15, JSON.stringify(v10));
    // Writing y ends it.
    settings.setValue('ymin', '-1');
    assert.equal(settings.getValue('fitY'), false);
});

test('notes6: charts with a y range, without any range, and JSON blocks stay as they were', () => {
    assert.equal(parseChartText('show x from -5 to 5 and y from -0.5 to 5\nplot f(x) = x^2').data.fitY, undefined);
    assert.equal(printChartText(parseChartText('show x from -5 to 5 and y from -0.5 to 5\nplot f(x) = x^2').data).split('\n')[0], 'show x from -5 to 5 and y from -0.5 to 5');
    assert.equal(parseChartText('plot f(x) = x^2').data.fitY, undefined);
    assert.equal(parseChartText('3d\nshow x from -2 to 2\nplot z = x^2 + y^2').data.fitY, undefined);
    const json = SettingsManager.fromJSON({ v: 4, xmin: '-5', xmax: '5', functions: [{ name: 'f', expression: 'x^2' }] });
    const view = json.resolveView(json.createMathContext({ memo: false })).view;
    assert.deepEqual([view.ymin, view.ymax], [-0.5, 5]);
    // A JSON chart printed keeps its y.
    assert.equal(printChartText({ v: 4, xmin: '-5', xmax: '5', functions: [{ name: 'f', expression: 'x^2' }] }).split('\n')[0], 'show x from -5 to 5 and y from -0.5 to 5');
    // The y range of a chart that follows, set by a line of its own, reads back.
    const both = parseChartText('show x from -5 to 5\nset ymin = -3\nplot f(x) = x');
    assert.equal(canonical(parseChartText(printChartText(both.data)).data), canonical(both.data));
});

// ------------------------------------------------ charts from formulas

test('notes6: a chart from a formula keeps the name and gives x only', () => {
    assert.deepEqual(formulaChart('g(x) = x^2 - 4'), ['show x from -5 to 5', 'plot $g(x) = x^2 - 4$ in blue, thick']);
    assert.deepEqual(formulaLines('f(x) = x^2')?.lines, ['plot $f(x) = x^2$ in blue, thick']);
    // A derivative or an inverse is not the function itself: f.
    assert.deepEqual(formulaLines("g'(x) = 2x")?.lines, ['plot $f(x) = 2x$ in blue, thick']);
    // Two functions with names of their own.
    assert.deepEqual(formulaLines('p(x) = x^2, q(x) = x + 1')?.lines, ['plot $p(x) = x^2$ in blue, thick', 'plot $q(x) = x + 1$ in red, thick']);
    // A name that is a slider of the formula is not taken.
    assert.deepEqual(formulaLines('a(x) = ax')?.lines.slice(-1), ['plot $f(x) = a x$ in blue, thick']);
    const block = formulaBlock('g(x) = x^2 - 4', null) ?? '';
    assert.equal(block, 'show x from -5 to 5\nplot g(x) = x^2 - 4 in blue, thick');
    assert.equal(parseChartText(block).data.fitY, true);
    // Equations and regions fit both axes as before.
    assert.equal(formulaChart('x^2 + y^2 = 1')?.[0], 'show x from -1.2 to 1.2 and y from -1.2 to 1.2');
});

// ------------------------------------------------------ Ask the curve

import { AskTarget, answerPresent, applyAnswer, askContext, askQuestions, pickTarget, registerQuestions, removeAnswer } from '../src/notes6/ask';

function askOf(text: string, target: AskTarget) {
    const settings = settingsOf(text);
    const data = settings.serialize();
    const math = settings.createMathContext({ memo: false });
    math.setParams((data.parameters as Parameter[]) ?? []);
    const view = settings.resolveView(math).view;
    return { data, ctx: askContext(target, data, view, math) };
}

const ASK = 'show x from -5 to 5 and y from -6 to 10\nplot $g(x) = x^2 - 4$\nplot h(x) = x + 1\n';

test('ask: the questions of a function, with a pair of questions for each other function', () => {
    const { ctx } = askOf(ASK, { kind: 'function', name: 'g', x: 1, y: -3 });
    const qs = askQuestions(ctx);
    const ids = qs.map((q) => q.id);
    for (const id of ['le', 'ge', 'lt', 'gt', 'zeros', 'extrema', 'tangent', 'value', 'chord', 'area', 'riemann', 'cross:h', 'below:h', 'between:h']) assert.ok(ids.includes(id), `${id} in ${ids.join(', ')}`);
    const line = (id: string) => qs.find((q) => q.id === id)?.answer.lines ?? [];
    assert.deepEqual(line('le'), ['mark where $g(x) \\le 0$ on the x-axis, labelled']);
    assert.deepEqual(line('area'), ['shade under g from x = -2 to 2']);
    assert.deepEqual(line('cross:h'), ['mark where g and h cross, with coordinates']);
    assert.deepEqual(line('value'), ['mark (1, g(1)), with coordinates']);
    assert.equal(line('between:h')[0], 'shade between g and h from x = -1.8 to 2.8');
    assert.deepEqual(qs.find((q) => q.id === 'tangent')?.answer.patch?.on, { tangent: true, tangentPoint: '1' });
});

test('ask: an answer goes in, is found there, and comes out again', () => {
    const { data, ctx } = askOf(ASK, { kind: 'function', name: 'g', x: 1, y: -3 });
    const qs = askQuestions(ctx);
    for (const q of qs) {
        assert.equal(answerPresent(data, q.answer), false, q.id);
        const next = applyAnswer(data, q.answer);
        assert.ok(next, `${q.id} does not read`);
        assert.ok(answerPresent(next, q.answer), `${q.id} is not found after it went in`);
        // The chart with the answer draws without a problem.
        const parsed = parseChartText(printChartText(next));
        assert.deepEqual(parsed.problems, [], q.id);
        const back = removeAnswer(next, q.answer);
        assert.equal(answerPresent(back, q.answer), false, `${q.id} is still there after it came out`);
        assert.equal((back.tools as unknown[]).length, (data.tools as unknown[]).length, q.id);
    }
    // The chord brings its slider λ along, the Riemann sum its n.
    const chord = applyAnswer(data, qs.find((q) => q.id === 'chord')!.answer)!;
    assert.ok((chord.parameters as Parameter[]).some((p) => p.name === 'lambda'));
    assert.match(printChartText(chord), /draw the chord of g from 1 to 3\.5 at \$\\lambda\$, labelled/);
});

test('ask: regions, curves and points have questions of their own', () => {
    const text = 'show x from -1 to 6 and y from -1 to 5\nR: shade where x + y <= 4, x >= 0, y >= 0\nC: draw x^2 + y^2 = 4\nP: mark (1, 1)';
    const region = askQuestions(askOf(text, { kind: 'region', name: 'R', x: 1, y: 1 }).ctx).map((q) => q.answer.lines?.[0] ?? q.id);
    assert.ok(region.includes('mark the corners of R, with coordinates'));
    assert.ok(region.includes('mark the maximum of y in R, with coordinates'));
    const curve = askQuestions(askOf(text, { kind: 'curve', name: 'C', x: 2, y: 0 }).ctx).map((q) => q.answer.lines?.[0]);
    assert.ok(curve.includes('mark where $x^2 + y^2 = 4$ on the x-axis, labelled'));
    const { data, ctx } = askOf(text, { kind: 'point', name: 'P', x: 1, y: 1 });
    const drop = askQuestions(ctx).find((q) => q.id === 'drop')!;
    const next = applyAnswer(data, drop.answer)!;
    assert.equal((next.tools as Data[]).find((x) => x.name === 'P')?.dropLines, true);
    assert.equal((removeAnswer(next, drop.answer).tools as Data[]).find((x) => x.name === 'P')?.dropLines, false);
});

test('ask: providers can be added (parts D and E) and taken away', () => {
    const off = registerQuestions('function', (ctx) => [{ id: 'extra', group: 'More', label: 'An extra question', answer: { lines: [`mark (0, ${ctx.target.name}(0))`] } }]);
    try {
        const { ctx } = askOf(ASK, { kind: 'function', name: 'g', x: 1, y: -3 });
        assert.ok(askQuestions(ctx).some((q) => q.id === 'extra'));
    } finally {
        off();
    }
    const { ctx } = askOf(ASK, { kind: 'function', name: 'g', x: 1, y: -3 });
    assert.ok(!askQuestions(ctx).some((q) => q.id === 'extra'));
});

test('ask: what a click hits', () => {
    const drawn = {
        curves: [{ name: 'g', kind: 'cartesian', lines: [[{ x: -2, y: 0 }, { x: 0, y: -4 }, { x: 2, y: 0 }]] }],
        items: [
            { source: 'R', kind: 'tool' as const, key: 'r', fills: [{ rings: [[{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 5, y: 5 }, { x: 3, y: 5 }]], color: 'blue', opacity: 0.3, pattern: 'solid' as const }], strokes: [], guides: [], markers: [], braces: [], texts: [] },
            { source: 'P', kind: 'tool' as const, key: 'p', fills: [], strokes: [], guides: [], markers: [{ x: 0, y: -4, color: 'red', size: 'normal' as const }], braces: [], texts: [] },
        ],
    };
    const tools = parseChartText('R: shade where x >= 3\nP: mark (0, -4)').data.tools as never;
    // 50 px per unit; a point first, then the curve, then the region.
    assert.equal(pickTarget(drawn, tools, { x: 0.02, y: -3.98 }, 50, 50, 10)?.kind, 'point');
    const onCurve = pickTarget(drawn, tools, { x: 1, y: -2.1 }, 50, 50, 10);
    assert.equal(onCurve?.kind, 'function');
    assert.equal(pickTarget(drawn, tools, { x: 4, y: 4 }, 50, 50, 10)?.kind, 'region');
    assert.equal(pickTarget(drawn, tools, { x: -4, y: 4 }, 50, 50, 10), null);
});
