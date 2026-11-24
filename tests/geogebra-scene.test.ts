/*
 * GeoGebra lines (6.0 G), the pictures: a pasted construction in
 * GeoGebra's look (free points blue with their names, circles, segments,
 * lines cut to the view, rays, vectors, polygons with a light fill,
 * curves, functions, texts), transforms of objects, the screenshot's
 * Mandelbrot point set and orbits, sliders, problems, 3D, the fit and the
 * pgfplots export (the same picture as numeric coordinates).
 */
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { SettingsManager } from '../src/settings';
import { computeScene2D, computeScene3D, labelMetricsFor, Scene2D, SceneItem2D } from '../src/scene';
import { fitSettings } from '../src/fit';

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

const issues = (s: { issues: Array<{ source: string; message: string; severity: string }> }) => s.issues.map((i) => `${i.source} ${i.severity}: ${i.message}`);
const item = (s: Scene2D, name: string): SceneItem2D => {
    const found = s.items.find((i) => i.source === name);
    assert.ok(found, `no item ${name}`);
    return found as SceneItem2D;
};

const VIEW = 'show x from -2 to 7 and y from -2 to 6';

test('points: free ones blue with their names, dependent ones black; a lower case pair is a vector', () => {
    const s = sceneOf(`${VIEW}\nA = (1, 2)\nB = Translate(A, (3, 0))\nu = (3, 1)\nz_1 = 2 + 3ί`);
    assert.deepEqual(issues(s), []);
    const a = item(s, 'A');
    assert.deepEqual(a.markers.map((m) => [m.x, m.y, m.color]), [[1, 2, 'blue']]);
    assert.deepEqual(a.texts.map((t) => t.text), ['$A$']);
    assert.deepEqual(item(s, 'B').markers.map((m) => [m.x, m.y, m.color]), [[4, 2, 'black']]);
    const u = item(s, 'u');
    assert.deepEqual(u.markers, []);
    assert.deepEqual(u.strokes.map((st) => [st.lines[0].map((p) => [p.x, p.y]), st.arrow]), [[[[0, 0], [3, 1]], 'forward']]);
    assert.deepEqual(item(s, 'z_1').markers.map((m) => [m.x, m.y]), [[2, 3]]);
    assert.deepEqual(item(s, 'z_1').texts.map((t) => t.text), ['$z_{1}$']);
});

test('objects: circle, segment, line through the view, ray, vector, polygon with its fill, curve, text', () => {
    const s = sceneOf(
        [
            VIEW,
            'A = (1, 1)',
            'B = (5, 1)',
            'C = (3, 4)',
            'c = Circle(A, 2)',
            'k = Circle(A, B, C)',
            's = Segment(A, B)',
            'l = Line(A, C)',
            'h = Ray(B, C)',
            'v = Vector(A, C)',
            'p = Polygon(A, B, C)',
            'q = Polygon(A, B, 4)',
            'K = Curve(cos(t), sin(t), t, 0, pi)',
            'T = Text("|AB| = " + Distance(A, B), (0, 5))',
        ].join('\n')
    );
    assert.deepEqual(issues(s), []);
    const ring = item(s, 'c').strokes[0];
    assert.equal(ring.closed, true);
    assert.equal(ring.color, 'black');
    for (const p of ring.lines[0]) near(Math.hypot(p.x - 1, p.y - 1), 2, 1e-9);
    // The circle through A, B and C has its centre at (3, 11/6).
    for (const p of item(s, 'k').strokes[0].lines[0]) near(Math.hypot(p.x - 3, p.y - 11 / 6), Math.hypot(2, 5 / 6), 1e-9);
    assert.deepEqual(item(s, 's').strokes[0].lines[0].map((p) => [p.x, p.y]), [[1, 1], [5, 1]]);
    const line = item(s, 'l').strokes[0].lines[0];
    assert.ok(line[0].y < -2 && line[1].y > 6, 'a line reaches past the view');
    const ray = item(s, 'h').strokes[0].lines[0];
    assert.deepEqual([ray[0].x, ray[0].y], [5, 1], 'a ray starts at its point');
    assert.equal(item(s, 'v').strokes[0].arrow, 'forward');
    const p = item(s, 'p');
    assert.deepEqual(p.fills.map((f) => [f.color, f.opacity, f.rings[0].length]), [['brown', 0.1, 3]]);
    assert.equal(p.strokes[0].color, 'brown');
    const square = item(s, 'q').strokes[0].lines[0].map((pt) => [Math.round(pt.x * 1e9) / 1e9, Math.round(pt.y * 1e9) / 1e9]);
    assert.deepEqual(square, [[1, 1], [5, 1], [5, 5], [1, 5]]);
    const curve = item(s, 'K').strokes[0].lines[0];
    near(curve[0].x, 1, 1e-12);
    near(curve[curve.length - 1].x, -1, 1e-12);
    assert.deepEqual(item(s, 'T').texts.map((t) => [t.text, t.x, t.y]), [['|AB| = 4', 0, 5]]);
});

test('transforms of objects: Translate a circle by a vector, Rotate a polygon, Reflect in a line, Dilate', () => {
    const s = sceneOf([VIEW, 'A = (1, 1)', 'c = Circle(A, 1)', 'v = Vector((0, 0), (2, 1))', 'c2 = Translate(c, v)', 'p = Polygon(A, (2, 1), (1, 2))', 'ro = Rotate(p, pi, A)', 'm = Reflect(p, Line((0, 0), (1, 1)))', 'd = Dilate(c, 2, A)'].join('\n'));
    assert.deepEqual(issues(s), []);
    for (const pt of item(s, 'c2').strokes[0].lines[0]) near(Math.hypot(pt.x - 3, pt.y - 2), 1, 1e-9);
    const rot = item(s, 'ro').strokes[0].lines[0].map((pt) => [Math.round(pt.x * 1e9) / 1e9, Math.round(pt.y * 1e9) / 1e9]);
    assert.deepEqual(rot, [[1, 1], [0, 1], [1, 0]]);
    const mirror = item(s, 'm').strokes[0].lines[0].map((pt) => [Math.round(pt.x * 1e9) / 1e9, Math.round(pt.y * 1e9) / 1e9]);
    assert.deepEqual(mirror, [[1, 1], [1, 2], [2, 1]]);
    for (const pt of item(s, 'd').strokes[0].lines[0]) near(Math.hypot(pt.x - 1, pt.y - 1), 2, 1e-9);
});

test('functions of x: f = x^2, Derivative(f), Function(f, a, b); a value list draws its points', () => {
    const s = sceneOf(['show x from -3 to 3 and y from -3 to 9', 'f = x^2', 'g = Derivative(f)', 'h = Function(f, 0, 1)', 'L = Sequence((k, f(k)), k, -2, 2)', 'plot w(x) = f(x) + 1'].join('\n'));
    assert.deepEqual(issues(s), []);
    const graph = item(s, 'f').strokes[0].lines[0];
    for (const pt of graph) near(pt.y, pt.x * pt.x, 1e-9);
    for (const pt of item(s, 'g').strokes[0].lines[0]) near(pt.y, 2 * pt.x, 1e-4);
    const part = item(s, 'h').strokes[0].lines[0];
    near(part[0].x, 0, 1e-12);
    near(part[part.length - 1].x, 1, 1e-12);
    assert.deepEqual(item(s, 'L').markers.map((m) => [m.x, m.y]), [[-2, 4], [-1, 1], [0, 0], [1, 1], [2, 4]]);
});

test('the screenshot: the Mandelbrot point set from KeepIf, the orbit from IterationList, Newton from Z_0', () => {
    const set = sceneOf(
        [
            'show x from -2.2 to 0.8 and y from -1.3 to 1.3',
            'P = Flatten(Sequence(Sequence(a + b ί, a, -2.2, 0.8, 0.05), b, -1.3, 1.3, 0.05)), hidden',
            'M = KeepIf(abs(Element(IterationList(z^2 + c, z, {0 + 0ί}, 20), 21)) <= 2, c, P)',
        ].join('\n')
    );
    assert.deepEqual(issues(set), []);
    assert.equal(set.items.find((i) => i.source === 'P'), undefined, 'a hidden grid draws nothing');
    const m = item(set, 'M');
    assert.ok(m.markers.length > 300 && m.markers.length < 1000, `${m.markers.length} points`);
    assert.ok(m.markers.every((pt) => pt.size === 'small' && pt.color === 'black'));
    // 0 and -1 are in the set; 0.5 is not.
    const has = (x: number, y: number) => m.markers.some((pt) => Math.abs(pt.x - x) < 1e-9 && Math.abs(pt.y - y) < 1e-9);
    assert.ok(has(-1, 0) && !has(0.5, 0));
    const orbit = sceneOf('show x from -1.5 to 1.5 and y from -1 to 1\nc = -0.4 + 0.6ί\nIterationList(z^2 + c, z, {0 + 0ί}, 20)\nZ_0 = (1, 0.5)\nIterationList(z - (z^3 - 1) / (3z^2), z, {Z_0}, 30)');
    assert.deepEqual(issues(orbit), []);
    assert.equal(item(orbit, 'G1').markers.length, 21);
    const newton = item(orbit, 'G2').markers;
    assert.equal(newton.length, 31);
    near(newton[30].x, 1, 1e-12);
    near(newton[30].y, 0, 1e-12);
});

test('sliders: a = Slider(0, 5) moves what reads it', () => {
    const settings = settingsOf('show x from -6 to 6 and y from -2 to 2\na = Slider(1, 5)\nC = Curve(a cos(t), sin(t), t, 0, 2pi)');
    const math = settings.createMathContext();
    const widest = () => {
        const config = settings.toRendererConfig(math);
        const s = computeScene2D({ functions: config.functions, tools: config.tools, math, view: { xmin: -6, xmax: 6, ymin: -2, ymax: 2 }, grid: { nx: 50, ny: 50 }, axisStyle: config.axisStyle, polar: false });
        return Math.max(...item(s, 'C').strokes[0].lines[0].map((p) => p.x));
    };
    near(widest(), 1, 1e-9);
    math.setParams([{ name: 'a', value: 4, min: 1, max: 5, step: 0.1 }]);
    near(widest(), 4, 1e-9);
});

test('problems name the line: an unknown name, three points on a line, a command used in a formula', () => {
    const s = sceneOf(`${VIEW}\nc = Circle(Q, 2)\nk = Circle((0, 0), (1, 1), (2, 2))`);
    const text = issues(s).join('\n');
    assert.match(text, /c error: .*Q/);
    assert.match(text, /k error: The three points lie on a line/);
    const math = settingsOf('plot f(x) = x').createMathContext();
    assert.throws(() => math.fn1('Circle(x, 1)'), /Circle draws an object/);
});

test('3D: points, lists, segments and curves in space; a circle is 2D only', () => {
    const settings = settingsOf('3d\nA = (1, 2, 3)\nB = (0, 0, 1)\ns = Segment(A, B)\nC = Curve(cos(t), sin(t), t / 4, t, 0, 2pi)\nc = Circle((0, 0), 1)');
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    const s = computeScene3D({ tools: config.tools, math, view: { xmin: -5, xmax: 5, ymin: -5, ymax: 5, zmin: -5, zmax: 5 } });
    assert.deepEqual(s.points.map((p) => [p.x, p.y, p.z, p.label]), [[1, 2, 3, '$A$'], [0, 0, 1, '$B$']]);
    assert.ok(s.segments.some((g) => g.a.join() === '1,2,3' && g.b.join() === '0,0,1'));
    assert.ok(s.segments.length > 300, 'the curve as segments');
    assert.match(issues(s).join('\n'), /c info: c draws in 2D charts only/);
});

test('the fit holds the points and objects; lines and rays set nothing', () => {
    const settings = settingsOf('A = (10, 20)\nB = (14, 22)\nc = Circle(A, 1)\nl = Line(A, B)');
    const fit = fitSettings(settings, settings.createMathContext());
    assert.ok(fit.x && fit.y, 'both axes fit');
    const [xmin, xmax, ymin, ymax] = [fit.x?.min ?? NaN, fit.x?.max ?? NaN, fit.y?.min ?? NaN, fit.y?.max ?? NaN];
    assert.ok(xmin <= 9 && xmax >= 14 && ymin <= 19 && ymax >= 22, `${xmin}..${xmax}, ${ymin}..${ymax}`);
    assert.ok(xmax - xmin < 40, 'the line did not stretch the view');
});

test('the export draws the same picture as numeric coordinates', () => {
    const code = settingsOf(`${VIEW}\nA = (1, 2)\nB = (4, 1)\ns = Segment(A, B), dashed\np = Polygon(A, B, (2, 4))\nv = Vector(A, B)\nL = Sequence((k, 0), k, 1, 3)`).generateTikzCode();
    assert.match(code, /\\draw\[black, thick, dashed\] \(axis cs:1,2\) -- \(axis cs:4,1\);/);
    assert.match(code, /\\fill\[etBrown, fill opacity=0\.1, even odd rule\] \(axis cs:1,2\) -- \(axis cs:4,1\) -- \(axis cs:2,4\) -- cycle;/);
    assert.match(code, /\\draw\[black, thick, ->\] \(axis cs:1,2\) -- \(axis cs:4,1\);/);
    assert.match(code, /only marks.*etBlue.*coordinates \{\(1,2\)\}/);
    assert.match(code, /coordinates \{\(1,0\) \(2,0\) \(3,0\)\}/);
    assert.match(code, /\{\$A\$\}/);
});
