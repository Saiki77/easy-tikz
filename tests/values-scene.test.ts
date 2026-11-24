/*
 * Values (6.0 A), the pictures: vector arrows (from the origin, from a
 * point, tip to tail, labelled), the points of a list (roots of unity with
 * a slider, joined), 3D arrows, problems of the new lines, the fit, the
 * export, and functions that use values exported as pgfmath or as points.
 */
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { SettingsManager } from '../src/settings';
import { computeScene2D, computeScene3D, labelMetricsFor, Scene2D, Scene3D } from '../src/scene';
import { fitSettings } from '../src/fit';
import { recipes } from '../src/migrate';
import { Tool } from '../src/types';

function settingsOf(text: string): SettingsManager {
    const parsed = parseChartText(text);
    assert.deepEqual(parsed.problems, [], text);
    return SettingsManager.fromJSON(parsed.data);
}

function sceneOf(text: string): Scene2D {
    const settings = settingsOf(text);
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    return computeScene2D({
        functions: config.functions,
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: { nx: 100, ny: 100 },
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(10, 10),
    });
}

function scene3Of(text: string): Scene3D {
    const settings = settingsOf(text);
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    return computeScene3D({ tools: config.tools, math, view: { xmin: -5, xmax: 5, ymin: -5, ymax: 5, zmin: -5, zmax: 5 } });
}

const issues = (s: Scene2D | Scene3D) => s.issues.map((i) => `${i.source}.${i.field ?? ''} ${i.severity}: ${i.message}`);

test('arrows of vectors from the origin and from a point, labelled with arrows on the names', () => {
    const s = sceneOf('show x from -5 to 5 and y from -5 to 5\nlet v = (2, 1)\nlet w = (-1, 2)\ndraw v and w as arrows, labelled\ndraw v as an arrow from (1, 1) in red');
    assert.deepEqual(issues(s), []);
    const [both, from] = s.items.filter((i) => i.kind === 'tool' && i.strokes.length);
    assert.deepEqual(
        both.strokes.map((st) => [st.lines[0].map((p) => [p.x, p.y]), st.arrow]),
        [
            [[[0, 0], [2, 1]], 'forward'],
            [[[0, 0], [-1, 2]], 'forward'],
        ]
    );
    assert.deepEqual(both.texts.map((t) => t.text), ['$\\vec{v}$', '$\\vec{w}$']);
    assert.deepEqual(from.strokes[0].lines[0].map((p) => [p.x, p.y]), [[1, 1], [3, 2]]);
    assert.equal(from.strokes[0].color, 'red');
});

test('tip to tail: the terms end to end (dashed), then the sum', () => {
    const s = sceneOf('let v = (2, 1)\nlet w = (-1, 2)\ndraw v + w tip to tail, labelled');
    assert.deepEqual(issues(s), []);
    const item = s.items.find((i) => i.strokes.length);
    assert.ok(item);
    assert.deepEqual(
        item.strokes.map((st) => [st.lines[0].map((p) => [p.x, p.y]), st.dashed]),
        [
            [[[0, 0], [2, 1]], true],
            [[[2, 1], [1, 3]], true],
            [[[0, 0], [1, 3]], false],
        ]
    );
    assert.deepEqual(item.texts.map((t) => t.text), ['$\\vec{v}$', '$\\vec{w}$', '$\\vec{v} + \\vec{w}$']);
});

test('arrows of matrix products, complex numbers and literals', () => {
    const s = sceneOf('let A = [[0, -1], [1, 0]]\nlet v = (2, 1)\nlet c = 1 + 2i\ndraw A v as an arrow\ndraw c as an arrow\ndraw (1, -1) as an arrow');
    assert.deepEqual(issues(s), []);
    const ends = s.items.filter((i) => i.strokes.length).map((i) => [i.strokes[0].lines[0][1].x, i.strokes[0].lines[0][1].y]);
    assert.deepEqual(ends, [[-1, 2], [1, 2], [1, -1]]);
});

test('problems of the new lines', () => {
    assert.deepEqual(issues(sceneOf('let r = 2\ndraw r as an arrow')), ['V1.vectors error: r is a number, not a vector']);
    assert.match(issues(sceneOf('let v = (1, 2) + 3'))[0], /^v\.expression error: Cannot add a vector of 2 numbers and a number/);
    assert.match(issues(sceneOf('let v = (1, w)\nlet w = v_x'))[0], /refers to itself/);
    assert.deepEqual(issues(sceneOf('mark the points of [1, 2]')), ['LP1.points error: The points are a number: write a list of complex numbers or points']);
});

test('the n-th roots of unity, joined, follow the slider n', () => {
    const text = 'show x from -2 to 2 and y from -2 to 2\nslider n from 3 to 12, starting at 6, in steps of 1\nmark the points $\\{e^{2\\pi i k / n} : k = 0, \\dots, n - 1\\}$, joined, labelled';
    const s = sceneOf(text);
    assert.deepEqual(issues(s), []);
    const item = s.items.find((i) => i.markers.length);
    assert.ok(item);
    assert.equal(item.markers.length, 6);
    near(item.markers[1].x, 0.5, 1e-12);
    near(item.markers[1].y, Math.sqrt(3) / 2, 1e-12);
    assert.equal(item.strokes[0].closed, true);
    assert.equal(item.texts[1].text, '0.5 + 0.866i');
    assert.equal(s.derived.LP1_n, 6);
    const settings = settingsOf(text);
    settings.setValue('parameters', [{ name: 'n', value: 8, min: 3, max: 12, step: 1 }]);
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    const eight = computeScene2D({ functions: [], tools: config.tools, math, view: { xmin: -2, xmax: 2, ymin: -2, ymax: 2 }, grid: { nx: 50, ny: 50 }, axisStyle: 'box', polar: false });
    assert.equal(eight.items.find((i) => i.markers.length)?.markers.length, 8);
});

test('3D: arrows of 3D vectors and points of a list', () => {
    const s = scene3Of('3d\nlet u = (1, 2, 2)\nlet v = (0, 1, 0)\ndraw u + v tip to tail\nmark the points of [(1, 0, 0), (0, 1, 0)], joined');
    assert.deepEqual(issues(s), []);
    assert.deepEqual(s.segments.filter((g) => g.arrow).map((g) => [g.a, g.b]), [
        [[0, 0, 0], [1, 2, 2]],
        [[1, 2, 2], [1, 3, 2]],
        [[0, 0, 0], [1, 3, 2]],
    ]);
    assert.equal(s.points.length, 2);
});

test('the fit holds the arrows; the export draws them as arrows', () => {
    const settings = settingsOf('let v = (6, 4)\ndraw v as an arrow');
    const fit = fitSettings(settings, settings.createMathContext());
    assert.ok((fit.x?.max ?? 0) >= 6 && (fit.y?.max ?? 0) >= 4, JSON.stringify(fit));
    settings.setValue('xmin', '-1');
    settings.setValue('xmax', '7');
    settings.setValue('ymin', '-1');
    settings.setValue('ymax', '5');
    const tex = settings.generateTikzCode(settings.createMathContext());
    assert.match(tex, /% V1\n\\draw\[[^\]]*->[^\]]*\] \(axis cs:0,0\) -- \(axis cs:6,4\);/);
});

test('a Taylor sum with a slider: preview and export agree', () => {
    const settings = settingsOf('show x from -6 to 6 and y from -2 to 2\nslider n from 0 to 10, starting at 3, in steps of 1\nplot $T(x) = \\sum_{k=0}^{n} \\frac{(-1)^k x^{2k+1}}{(2k+1)!}$');
    const math = settings.createMathContext();
    const tex = settings.generateTikzCode(math);
    const plot = /\\addplot\[[^\]]*\] \{([^}]*)\};/.exec(tex);
    assert.ok(plot, tex);
    assert.ok(!/sum|!/.test(plot[1]), plot[1]);
    assert.ok(plot[1].includes('5040'), plot[1]);
});

test('a function of a let function exports as pgfmath; one of a list as points', () => {
    const settings = settingsOf('let $f(x, y) = x^2 + 4y^2$\nplot g(x) = f(x, 1) / 4');
    const tex = settings.generateTikzCode(settings.createMathContext());
    assert.match(tex, /\\addplot\[[^\]]*\] \{\(\(\(x\^2\)\+4\)\/4\)\};/);
});

test('the recipes: a definition, an arrow with its definition, the roots of unity', () => {
    const ctx = { is3D: false, functions: [], tools: [] as Tool[], parameters: [] };
    const all = recipes(false);
    const vector = all.find((r) => r.id === 'vector-arrow')?.build(ctx);
    assert.ok(vector && vector.kind === 'items');
    assert.deepEqual(vector.tools.map((t) => [t.type, t.name]), [['value', 'v'], ['vector', 'V1']]);
    const roots = all.find((r) => r.id === 'list-points')?.build(ctx);
    assert.ok(roots && roots.kind === 'items');
    assert.deepEqual(roots.parameters?.map((p) => p.name), ['n']);
    assert.ok(recipes(true).some((r) => r.id === 'vector-arrow'));
});

test('3D: labels of arrows sit at the tips (the middles, tip to tail), without markers; the export draws no marks for them', () => {
    const text = '3d\nlet u = (1, 2, 1)\nlet v = (1, 0, 1.5)\ndraw u as an arrow, labelled\ndraw u + v tip to tail in red, labelled';
    const s = scene3Of(text);
    assert.deepEqual(issues(s), []);
    assert.deepEqual(
        s.points.map((p) => [p.label, p.bare, [p.x, p.y, p.z]]),
        [
            ['$\\vec{u}$', true, [1, 2, 1]],
            ['$\\vec{u}$', true, [0.5, 1, 0.5]],
            ['$\\vec{v}$', true, [1.5, 2, 1.75]],
            ['$\\vec{u} + \\vec{v}$', true, [1, 1, 1.25]],
        ]
    );
    const settings = settingsOf(text);
    const tex = settings.generateTikzCode(settings.createMathContext());
    assert.ok(!tex.includes('only marks'), tex);
    assert.match(tex, /\{\$\\vec\{u\} \+ \\vec\{v\}\$\}/);
});

test('a function with no pgfmath form (a gradient) exports as its points; let functions in regions and curves', () => {
    const settings = settingsOf('show x from -3 to 3 and y from -1 to 10\nlet $f(x, y) = x^2 + 4y^2$\nplot g(x) = norm(grad(f, x, 1)) in red\nshade where $f(x, y) \\le 4$\ndraw f(x, y) = 1');
    const math = settings.createMathContext();
    const tex = settings.generateTikzCode(math);
    assert.match(tex, /% g\n\\addplot\[etRed, thin, forget plot\] coordinates \{/);
    const s = sceneOf('show x from -3 to 3 and y from -2 to 2\nlet $f(x, y) = x^2 + 4y^2$\nshade where $f(x, y) \\le 4$\ndraw f(x, y) = 1');
    assert.deepEqual(issues(s), []);
    assert.ok(s.items.find((i) => i.source === 'R1')?.fills.length);
    assert.ok(s.items.find((i) => i.source === 'C1')?.strokes.length);
});
