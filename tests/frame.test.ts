/*
 * The view of a hover card (src/notes6/frame.ts): framed on the roots, the
 * extrema and the y-intercept instead of y over the whole x range, in round
 * numbers, and the dots of the roots (pink) and extrema (violet).
 */
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText } from '../src/text/print';
import { formulaChart } from '../src/formula';
import { EXTREMUM_COLOR, ROOT_COLOR, frameChart, keyDots, keyPoints } from '../src/notes6/frame';

type Data = Record<string, unknown>;

/** The card's chart of a formula, framed. */
function framed(tex: string): Data {
    const lines = formulaChart(tex);
    assert.ok(lines, `no chart for ${tex}`);
    const parsed = parseChartText((lines ?? []).join('\n'));
    assert.deepEqual(parsed.problems, [], tex);
    const out = frameChart(parsed.data);
    assert.ok(out, `not framed: ${tex}`);
    return out ?? {};
}

const view = (d: Data) => [Number(d.xmin), Number(d.xmax), Number(d.ymin), Number(d.ymax)];

/** The points of a dots tool: [[x, y], ...]. */
function dots(d: Data, color: string): number[][] {
    const tool = keyDots(d).find((t) => t.color === color);
    if (!tool) return [];
    return String(tool.points)
        .split(';')
        .map((p) => p.replace(/[()\s]/g, '').split(',').map(Number));
}

/** Inside the view and not on its edge. */
function inside(d: Data, x: number, y: number, tex: string) {
    const [x0, x1, y0, y1] = view(d);
    assert.ok(x > x0 && x < x1 && y > y0 && y < y1, `${tex}: (${x}, ${y}) is not inside x ${x0}..${x1}, y ${y0}..${y1}`);
}

test('frame: x^2 - 4 shows its roots and vertex, not y up to 20', () => {
    const d = framed('f(x) = x^2 - 4');
    assert.deepEqual(view(d), [-4, 4, -5, 3]);
    assert.equal(d.fitY, false);
    assert.equal(printChartText(d).split('\n')[0], 'show x from -4 to 4 and y from -5 to 3');
    assert.deepEqual(dots(d, ROOT_COLOR), [[-2, 0], [2, 0]]);
    assert.deepEqual(dots(d, EXTREMUM_COLOR), [[0, -4]]);
});

test('frame: x^3 - 3x shows its three roots and both extrema', () => {
    const d = framed('x^3 - 3x');
    assert.deepEqual(view(d), [-4, 4, -5, 5]);
    const roots = dots(d, ROOT_COLOR).map((p) => p[0]);
    assert.equal(roots.length, 3);
    near(roots[0], -Math.sqrt(3), 1e-5);
    near(roots[1], 0, 1e-9);
    near(roots[2], Math.sqrt(3), 1e-5);
    assert.deepEqual(dots(d, EXTREMUM_COLOR), [[-1, 2], [1, -2]]);
});

test('frame: sin x shows the period around 0, not every root up to 10', () => {
    const d = framed('\\sin x');
    assert.deepEqual(view(d), [-5, 5, -2, 2]);
    assert.equal(dots(d, ROOT_COLOR).length, 3);
    assert.equal(dots(d, EXTREMUM_COLOR).length, 4);
});

test('frame: curves without roots or extrema still show something sensible', () => {
    // e^x: the intercept (0, 1), the x-axis, the rise.
    const exp = framed('e^x');
    inside(exp, 0, 1, 'e^x');
    inside(exp, 0, 0, 'e^x');
    assert.deepEqual(keyDots(exp), []);
    // 1/x: both branches, the axes in the middle.
    const inv = framed('\\frac{1}{x}');
    const [x0, x1, y0, y1] = view(inv);
    assert.ok(x0 < 0 && x1 > 0 && y0 < 0 && y1 > 0 && x1 - x0 <= 8 && y1 - y0 <= 8, `1/x: ${view(inv)}`);
    assert.deepEqual(keyDots(inv), []);
    // A constant: its line and the x-axis.
    const c = framed('f(x) = 3');
    inside(c, 0, 3, 'f(x) = 3');
    inside(c, 0, 0, 'f(x) = 3');
    assert.deepEqual(keyDots(c), []);
});

test('frame: ln x, a line, x^2 + 1 and a cubic with one root', () => {
    const ln = framed('\\ln x');
    inside(ln, 1, 0, 'ln x');
    assert.ok(Number(ln.xmin) <= 0, 'ln x: the y-axis shows');
    assert.deepEqual(dots(ln, ROOT_COLOR), [[1, 0]]);
    const line = framed('2x + 1');
    inside(line, -0.5, 0, '2x + 1');
    inside(line, 0, 1, '2x + 1');
    assert.deepEqual(dots(line, EXTREMUM_COLOR), []);
    const up = framed('x^2 + 1');
    inside(up, 0, 1, 'x^2 + 1');
    inside(up, 0, 0, 'x^2 + 1');
    assert.deepEqual(dots(up, ROOT_COLOR), []);
    assert.deepEqual(dots(up, EXTREMUM_COLOR), [[0, 1]]);
    const cubic = framed('x^3 + x + 1');
    const r = dots(cubic, ROOT_COLOR);
    assert.equal(r.length, 1);
    near(r[0][0], -0.682328, 1e-5);
    inside(cubic, r[0][0], 0, 'x^3 + x + 1');
    assert.deepEqual(dots(cubic, EXTREMUM_COLOR), []);
    // One root and two extrema.
    const wavy = framed('x^3 - x + 1');
    for (const [x, y] of [...dots(wavy, ROOT_COLOR), ...dots(wavy, EXTREMUM_COLOR)]) inside(wavy, x, y, 'x^3 - x + 1');
});

test('frame: every view is round, holds its key points and is not huge', () => {
    for (const tex of ['f(x) = x^2 - 4', 'x^3 - 3x', '\\sin x', '\\cos x', 'e^x', '\\frac{1}{x}', '\\ln x', '2x + 1', 'f(x) = 3', 'x^2 + 1', 'x^3 + x + 1', 'x^4 - 5x^2 + 4', 'x e^{-x}', '\\sqrt{x}', '|x|', 'a x^2 + b']) {
        const d = framed(tex);
        const [x0, x1, y0, y1] = view(d);
        for (const v of [x0, x1, y0, y1]) assert.ok(Number.isInteger(v * 2), `${tex}: ${v} is not round`);
        assert.ok(x1 - x0 >= 4 && x1 - x0 <= 12, `${tex}: x ${x0}..${x1}`);
        assert.ok(y1 - y0 >= 2 && y1 - y0 <= 20, `${tex}: y ${y0}..${y1}`);
        for (const color of [ROOT_COLOR, EXTREMUM_COLOR]) for (const [x, y] of dots(d, color)) inside(d, x, y, tex);
    }
});

test('frame: a pole is no root, a touching zero is one, f = 0 everywhere has no dots', () => {
    assert.deepEqual(keyPoints((x) => 1 / x, -3, 3).roots, []);
    assert.deepEqual(keyPoints((x) => Math.tan(x), -1, 1).roots.map((p) => p.x), [0]);
    const touch = keyPoints((x) => (x - 1) * (x - 1), -3, 3);
    assert.equal(touch.roots.length, 1);
    near(touch.roots[0].x, 1, 1e-4);
    assert.deepEqual(touch.extrema, []);
    assert.deepEqual(keyPoints(() => 0, -3, 3).roots, []);
    near(keyPoints((x) => x * x - 4, -3, 3).intercept?.y ?? NaN, -4);
});

test('frame: charts that are no curve y = f(x) stay as they are; the dots follow the sliders', () => {
    for (const tex of ['x^2 + y^2 = 1', 'z = x^2 - y^2']) {
        const lines = formulaChart(tex) ?? [];
        assert.equal(frameChart(parseChartText(lines.join('\n')).data), null, tex);
    }
    const d = framed('a x^2 - 4');
    const params = d.parameters as Array<Record<string, unknown>>;
    params[0].value = 4;
    assert.deepEqual(dots(d, ROOT_COLOR), [[-1, 0], [1, 0]]);
});
