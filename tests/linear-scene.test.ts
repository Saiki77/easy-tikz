/*
 * Linear algebra and complex maps (6.0 D), the pictures: the grid and its
 * faint copy, î and ĵ on the columns of A, the unit square and det, the
 * eigenvectors (real, complex, every vector), spans, the functions a
 * transform moves, transforms in steps ((1 - t)I + tA), several in a row,
 * z ↦ z², (x, y) ↦ (...), 3D, the fit and the export.
 */
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { SettingsManager } from '../src/settings';
import { computeScene2D, computeScene3D, labelMetricsFor, Scene2D, Scene3D, SceneItem2D } from '../src/scene';
import { generateTikz2D, generateTikz3D } from '../src/export';
import { fitSettings } from '../src/fit';
import { atStep } from '../src/motion6/steps';
import type { MotionFrame } from '../src/types';

type Data = Record<string, unknown>;

function settingsOf(text: string): SettingsManager {
    const parsed = parseChartText(text);
    assert.deepEqual(parsed.problems, [], text);
    return SettingsManager.fromJSON(parsed.data);
}

function sceneOf(text: string, motion?: MotionFrame, step?: number): Scene2D {
    const parsed = parseChartText(text);
    assert.deepEqual(parsed.problems, [], text);
    const settings = SettingsManager.fromJSON(step === undefined ? parsed.data : atStep(parsed.data, step));
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
        motion,
    });
}

function scene3Of(text: string, motion?: MotionFrame): Scene3D {
    const settings = settingsOf(text);
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    return computeScene3D({ tools: config.tools, math, view: { xmin: -4, xmax: 4, ymin: -4, ymax: 4, zmin: -4, zmax: 4 }, motion });
}

const issues = (s: Scene2D | Scene3D) => s.issues.map((i) => `${i.source}.${i.field ?? ''} ${i.severity}: ${i.message}`);
const item = (s: Scene2D, source: string): SceneItem2D => {
    const it = s.items.find((i) => i.source === source);
    assert.ok(it, `no item ${source}`);
    return it;
};
const tip = (it: SceneItem2D, k: number) => {
    const line = it.strokes[k].lines[0];
    return [line[line.length - 1].x, line[line.length - 1].y];
};

const SHEAR = 'show x from -4 to 4 and y from -4 to 4\nlet A = [[1, 1], [0, 1]]';

test('the grid: lines beyond the view, the axes thicker; its steps and range', () => {
    const s = sceneOf('show x from -3 to 3 and y from -3 to 3\ndraw the grid');
    assert.deepEqual(issues(s), []);
    const g = item(s, 'G1');
    assert.equal(g.strokes.length, 2);
    // Twice the view: -6..6, 13 values, 12 of them minor: 24 lines; the axes: 2.
    assert.equal(g.strokes[0].lines.length, 24);
    assert.equal(g.strokes[1].lines.length, 2);
    assert.equal(g.strokes[1].opacity, 0.95);
    const small = item(sceneOf('draw the grid from -1 to 1 in steps of 0.5'), 'G1');
    assert.equal(small.strokes[0].lines.length + small.strokes[1].lines.length, 10);
    const bad = sceneOf('draw the grid in steps of 0.001');
    assert.equal(bad.issues.length, 1);
});

test('transform the plane by A: î and ĵ land on the columns, the old grid stays faint, the axes do not move', () => {
    const s = sceneOf(`${SHEAR}\ndraw the grid\ndraw the basis vectors\ntransform the plane by A`);
    assert.deepEqual(issues(s), []);
    const b = item(s, 'BV1');
    assert.deepEqual(tip(b, 0), [1, 0]);
    assert.deepEqual(tip(b, 1), [1, 1]);
    assert.deepEqual(
        b.texts.map((t) => t.text),
        ['$\\hat{\\imath}$', '$\\hat{\\jmath}$']
    );
    const g = item(s, 'G1');
    // The faint copy first (gray), then the moved lines.
    assert.equal(g.strokes[0].color, 'gray');
    assert.equal(g.strokes.length, 4);
    const moved = g.strokes[2].lines;
    // The line x = 1 (from y = -8 to 8) goes to x = 1 + y.
    const line = moved.find((l) => l[0].x === 1 - 8 && l[0].y === -8);
    assert.ok(line, 'the sheared line x = 1');
    // The handles: the tips of î and ĵ change column 1 and 2 of A.
    assert.deepEqual(
        (b.handles ?? []).map((h) => [h.ref, h.point]),
        [
            [{ part: 'tip', index: 0, owner: 'T1', entries: [0, 2] }, { x: 1, y: 0 }],
            [{ part: 'tip', index: 1, owner: 'T1', entries: [1, 3] }, { x: 1, y: 1 }],
        ]
    );
});

test('objects after the transform stay; points, segments, regions and arrows before it move', () => {
    const s = sceneOf(`${SHEAR}\nmark (1, 1)\ndraw a line from (0, 1) to (2, 1)\nshade where 0 <= x <= 1 and 0 <= y <= 1\nlet v = (0, 2)\ndraw v as an arrow\ntransform the plane by A\nmark (1, 1)`);
    assert.deepEqual(issues(s), []);
    const [p1, , , , p2] = s.items.filter((i) => i.kind === 'tool' && (i.markers.length || i.strokes.length || i.fills.length));
    assert.deepEqual([p1.markers[0].x, p1.markers[0].y], [2, 1]);
    assert.deepEqual([p2.markers[0].x, p2.markers[0].y], [1, 1]);
    const seg = item(s, 'S1');
    assert.deepEqual(
        seg.strokes[0].lines[0].map((p) => [p.x, p.y]),
        [
            [1, 1],
            [3, 1],
        ]
    );
    const region = item(s, 'R1');
    const xs = region.fills[0].rings[0].map((p) => p.x);
    near(Math.max(...xs), 2, 1e-6, 'the square sheared to a parallelogram');
    const arrow = item(s, 'V1');
    assert.deepEqual(tip(arrow, 0), [2, 2]);
});

test('functions before the transform are drawn by it; the scene says which', () => {
    const s = sceneOf(`${SHEAR}\nplot f(x) = 1\nplot g(x) = x, hidden\ntransform the plane by A`);
    assert.deepEqual(s.movedFunctions, [0]);
    const tr = item(s, 'T1');
    assert.equal(tr.strokes.length, 1);
    // y = 1 sheared is still y = 1, x moved by 1.
    for (const p of tr.strokes[0].lines[0]) near(p.y, 1, 1e-9);
    // A function in a later step is not moved.
    const later = sceneOf(`${SHEAR}\nthen transform the plane by A\nthen plot f(x) = 1`);
    assert.equal(later.movedFunctions, undefined);
});

test('in a step it moves: (1 - t)I + tA at the progress, I before the step, A after', () => {
    const text = `${SHEAR}\ndraw the basis vectors\nthen transform the plane by A`;
    const half = sceneOf(text, { time: 0, step: 1, progress: 0.5 });
    assert.deepEqual(tip(item(half, 'BV1'), 1), [0.5, 1]);
    // While it moves the tips are no handles.
    assert.equal(item(half, 'BV1').handles, undefined);
    const before = sceneOf(text, { time: 0, step: 0, progress: 1 }, 0);
    assert.deepEqual(tip(item(before, 'BV1'), 1), [0, 1]);
    const after = sceneOf(text, { time: 0, step: 1, progress: 1 });
    assert.deepEqual(tip(item(after, 'BV1'), 1), [1, 1]);
});

test('several transforms compose in order', () => {
    const s = sceneOf(`${SHEAR}\nlet R = [[0, -1], [1, 0]]\ndraw the basis vectors\ntransform the plane by A\ntransform the plane by R`);
    // ĵ: A(0, 1) = (1, 1), then R: (-1, 1).
    assert.deepEqual(tip(item(s, 'BV1'), 1), [-1, 1]);
    assert.equal(item(s, 'BV1').handles, undefined);
});

test('the unit square: its image, det in the label, the label follows', () => {
    const s = sceneOf('let A = [[2, 1], [0, 1.5]]\nshade the unit square, labelled\ntransform the plane by A\nshade the image of the unit square, labelled "area {area}"');
    assert.deepEqual(issues(s), []);
    const u1 = item(s, 'U1');
    assert.deepEqual(u1.texts.map((t) => t.text), ['$\\det A = 3$']);
    near(u1.texts[0].x, 1.5, 1e-9);
    near(u1.texts[0].y, 0.75, 1e-9);
    assert.deepEqual(item(s, 'U2').texts.map((t) => t.text), ['area 3']);
    const plain = sceneOf('shade the unit square, labelled');
    assert.deepEqual(item(plain, 'U1').texts.map((t) => t.text), ['area $= 1$']);
});

test('eigenvectors: lines with λ, a note for complex ones, every vector of λI', () => {
    const s = sceneOf('show x from -4 to 4 and y from -4 to 4\nlet A = [[1.5, 1], [0.5, 2]]\ndraw the eigenvectors of A, labelled');
    assert.deepEqual(issues(s), []);
    const e = item(s, 'EV1');
    assert.equal(e.strokes[0].lines.length, 2);
    assert.deepEqual(e.texts.map((t) => t.text).sort(), ['$\\lambda_1 = 2.5$', '$\\lambda_2 = 1$']);
    const d = e.strokes[0].lines[0];
    near((d[1].y - d[0].y) / (d[1].x - d[0].x), 1, 1e-9, 'the eigenvector (1, 1) of 2.5');
    const rot = sceneOf('let R = [[0, -1], [1, 0]]\ndraw the eigenvectors of R, labelled');
    assert.equal(rot.issues.length, 1);
    assert.equal(rot.issues[0].severity, 'info');
    assert.match(item(rot, 'EV1').texts[0].text, /\\lambda = 0 \\pm 1i/);
    const id = sceneOf('let S = [[2, 0], [0, 2]]\ndraw the eigenvectors of S, labelled');
    assert.equal(item(id, 'EV1').strokes[0].lines.length, 8);
    const bad = sceneOf('let v = (1, 2)\ndraw the eigenvectors of v');
    assert.equal(bad.issues[0].severity, 'error');
});

test('spans: the plane, a line, 0', () => {
    const plane = item(sceneOf('let v = (1, 2)\nlet w = (2, -1)\ndraw the span of v and w, labelled'), 'SP1');
    assert.equal(plane.fills.length, 1);
    assert.match(plane.texts[0].text, /mathbb\{R\}\^2/);
    const line = item(sceneOf('let v = (1, 2)\ndraw the span of v and 2v'), 'SP1');
    assert.equal(line.fills.length, 0);
    assert.equal(line.strokes[0].lines.length, 1);
    const zero = item(sceneOf('draw the span of (0, 0)'), 'SP1');
    assert.equal(zero.markers.length, 1);
});

test('z ↦ z² bends the grid; (x, y) ↦ (x + y, y) is the shear', () => {
    const s = sceneOf('show x from -3 to 3 and y from -2 to 2\ndraw the grid from -1.5 to 1.5 in steps of 0.25\ntransform the plane by $z \\mapsto z^2$');
    assert.deepEqual(issues(s), []);
    const g = item(s, 'G1');
    const bent = g.strokes.filter((st) => st.color !== 'gray');
    assert.ok(bent.every((st) => !st.exact));
    // The line x = 1 goes to the parabola u = 1 - v²/4 (v = 2y): every point on it.
    const all = bent.flatMap((st) => st.lines).flat();
    const pts = all.filter((p) => Math.abs(p.x - (1 - (p.y * p.y) / 4)) < 1e-9);
    assert.ok(pts.length > 50);
    const shear = sceneOf('draw the basis vectors\ntransform the plane by $(x, y) \\mapsto (x + y, y)$');
    assert.deepEqual(issues(shear), []);
    assert.deepEqual(tip(item(shear, 'BV1'), 1), [1, 1]);
    const bad = sceneOf('transform the plane by (1, 2)');
    assert.equal(bad.issues[0].severity, 'error');
    const lam = sceneOf('let f(z) = 1/z\ndraw the basis vectors\ntransform the plane by f');
    assert.deepEqual(issues(lam), []);
});

test('3D: the grid cube, î ĵ k̂ and the unit cube move with B; its volume', () => {
    const s = scene3Of('3d\nlet B = [[2, 0, 0], [0, 1, 1], [0, 0, 1.5]]\ndraw the grid from -1 to 1\ndraw the basis vectors\nshade the unit cube, labelled\ntransform space by B');
    assert.deepEqual(issues(s), []);
    const arrows = s.segments.filter((g) => g.arrow === 'forward');
    assert.deepEqual(
        arrows.map((g) => g.b),
        [
            [2, 0, 0],
            [0, 1, 0],
            [0, 1, 1.5],
        ]
    );
    assert.ok(s.segments.some((g) => g.color === 'gray'), 'the faint grid cube');
    const vol = s.points.find((p) => p.label && /det/.test(p.label));
    assert.ok(vol);
    assert.equal(vol.label, '$\\det B = 3$');
    const half = scene3Of('3d\nlet B = [[2, 0, 0], [0, 1, 0], [0, 0, 1]]\ndraw the basis vectors\nthen transform space by B', { time: 0, step: 1, progress: 0.5 });
    assert.deepEqual(half.segments.filter((g) => g.arrow)[0].b, [1.5, 0, 0]);
});

test('the export: moved functions and the grid as coordinates, the last step, and the axes stay', () => {
    const settings = settingsOf(`${SHEAR}\nplot f(x) = 1\ndraw the grid from -2 to 2\ndraw the basis vectors\nthen transform the plane by A`);
    const math = settings.createMathContext();
    const tex = generateTikz2D(settings, math);
    assert.ok(!/\\addplot\[[^\]]*\] \{1\}/.test(tex), 'f is not plotted as itself');
    assert.match(tex, /% T1/);
    // ĵ ends at (1, 1) in the PDF.
    assert.match(tex, /\(axis cs:0,0\) -- \(axis cs:1,1\)/);
    assert.match(tex, /opacity=0\.35/);
    const s3 = settingsOf('3d\nlet B = [[2, 0, 0], [0, 1, 0], [0, 0, 1]]\ndraw the basis vectors\ntransform space by B');
    const tex3 = generateTikz3D(s3, s3.createMathContext());
    assert.match(tex3, /\(2,0,0\)|\(2, 0, 0\)/);
});

test('the fit holds the moved basis vectors and the unit square, not the grid', () => {
    const settings = settingsOf('let A = [[3, 0], [0, 2]]\ndraw the grid\ndraw the basis vectors\nshade the unit square\ntransform the plane by A');
    const fit = fitSettings(settings, settings.createMathContext());
    assert.ok(fit.x && fit.y, JSON.stringify(fit));
    assert.ok(fit.x.max >= 3 && fit.x.max < 6, `x ${JSON.stringify(fit.x)}`);
    assert.ok(fit.y.max >= 2 && fit.y.max < 5, `y ${JSON.stringify(fit.y)}`);
});
