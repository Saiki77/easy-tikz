/*
 * Iterate and colour the plane (6.0 E), the pictures: orbits (complex
 * numbers, vectors, numbers; a dragged point), gradient descent, cobwebs,
 * Newton's method, bifurcation diagrams, escape time, basins, domain
 * colouring and heat maps as pixel layers (CPU colours, the GLSL with
 * sliders as uniforms), turning circles on the clock, the caps, the fit.
 */
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { SettingsManager } from '../src/settings';
import { SceneCache, computeScene2D, labelMetricsFor, Scene2D, SceneItem2D } from '../src/scene';
import { fitSettings } from '../src/fit';
import { MotionFrame } from '../src/types';
import { needsClock } from '../src/motion6/clock';
import { INSIDE, basinRgb, cyclicRgb, domainRgb, glslColours, mapRgb } from '../src/iterate/colour';
import { MAX_ORBIT } from '../src/iterate/scene';
import { FOURIER_SPEED } from '../src/iterate/fourier';
import type { View } from '../src/geometry';

function settingsOf(text: string): SettingsManager {
    const r = parseChartText(text);
    assert.deepEqual(r.problems, [], text);
    return SettingsManager.fromJSON(r.data);
}

function sceneOf(text: string, motion?: MotionFrame, cache?: SceneCache, values?: Record<string, number>): Scene2D {
    const settings = settingsOf(text);
    const math = settings.createMathContext();
    if (values) math.setParamValues(values);
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
        cache,
        motion,
    });
}

function item(scene: Scene2D, source: string): SceneItem2D {
    const it = scene.items.find((i) => i.source === source);
    assert.ok(it, `no item ${source}`);
    return it;
}

/** The colour of one pixel of a layer at (x, y), as 0..255 channels and alpha. */
function pixelAt(it: SceneItem2D, view: View, x: number, y: number): number[] {
    const prim = it.pixels?.[0];
    assert.ok(prim, 'no pixel layer');
    const buf = new Uint8ClampedArray(4);
    // A 1 x 1 picture of a tiny view around the point.
    const d = 1e-9;
    prim.tile({ xmin: x - d, xmax: x + d, ymin: y - d, ymax: y + d }, 1, 1, 0, 0, 1, 1, buf);
    void view;
    return Array.from(buf);
}

const rgb255 = (c: number[]) => c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
const V = { xmin: -2, xmax: 2, ymin: -2, ymax: 2 };

// ----------------------------------------------------------------- orbits

test('orbit: z^2 + c from 0 with c at a point P, as points joined by a line', () => {
    const scene = sceneOf('show x from -2 to 2 and y from -2 to 2\nmark P at (-1, 0)\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 4 steps, labelled');
    const it = item(scene, 'OR1');
    assert.equal(it.strokes.length, 1);
    assert.deepEqual(it.strokes[0].lines[0].map((p) => [p.x, p.y]), [[0, 0], [-1, 0], [0, 0], [-1, 0], [0, 0]]);
    assert.equal(it.markers.length, 5);
    assert.deepEqual(it.texts.map((t) => t.text).slice(0, 2), ['$z_{0}$', '$z_{1}$']);
    assert.equal(scene.derived.OR1_n, 5);
    assert.equal(scene.derived.OR1_x, 0);
});

test('orbit: a dragged point moves the orbit (the scene memo reads P)', () => {
    const cache = new SceneCache();
    const a = sceneOf('mark P at (-1, 0)\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 3 steps', undefined, cache);
    const b = sceneOf('mark P at (0.5, 0)\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 3 steps', undefined, cache);
    assert.deepEqual(item(a, 'OR1').strokes[0].lines[0][1], { x: -1, y: 0 });
    assert.deepEqual(item(b, 'OR1').strokes[0].lines[0][1], { x: 0.5, y: 0 });
});

test('orbit: as a path has no dots; numbers are drawn as (n, x_n)', () => {
    const path = item(sceneOf('mark P at (0.2, 0.3)\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 10 steps, as a path'), 'OR1');
    assert.equal(path.markers.length, 0);
    const numbers = item(sceneOf('show x from 0 to 30 and y from 0 to 1\ndraw the orbit of $x_{n+1} = \\cos(x_n)$, $x_0 = 1$, 30 steps'), 'OR1');
    const pts = numbers.strokes[0].lines[0];
    assert.equal(pts.length, 31);
    assert.deepEqual(pts[1], { x: 1, y: Math.cos(1) });
    near(pts[30].y, 0.739085, 1e-4, 'the fixed point of cos');
});

test('gradient descent: steps of p - eta grad f go down to the minimum', () => {
    const scene = sceneOf('show x from -3 to 3 and y from -2 to 2\nslider eta from 0 to 0.5, starting at 0.1\nlet $f(x, y) = x^2 + 4y^2$\nmark P at (2, 1)\ndraw the orbit of $p_{n+1} = p_n - \\eta \\nabla f(p_n)$, $p_0 = P$, 40 steps');
    assert.deepEqual(scene.issues, []);
    const pts = item(scene, 'OR1').strokes[0].lines[0];
    // x shrinks by 1 - 2 eta = 0.8 a step, y by 1 - 8 eta = 0.2.
    near(pts[1].x, 1.6, 1e-6);
    near(pts[1].y, 0.2, 1e-6);
    near(scene.derived.OR1_x, 2 * Math.pow(0.8, 40), 1e-6);
    // A step that is too large leaves the chart: eta = 0.3 makes y grow (1 - 2.4 = -1.4).
    const big = sceneOf('show x from -3 to 3 and y from -2 to 2\nslider eta from 0 to 0.5, starting at 0.3\nlet $f(x, y) = x^2 + 4y^2$\nmark P at (2, 1)\ndraw the orbit of $p_{n+1} = p_n - \\eta \\nabla f(p_n)$, $p_0 = P$, 10 steps');
    near(Math.abs(big.derived.OR1_y), Math.pow(1.4, 10), 1e-3);
});

test('orbit: problems and caps', () => {
    const notRec = sceneOf('draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = Q$, 4 steps');
    assert.ok(notRec.issues.some((i) => i.source === 'OR1' && i.field === 'given'), JSON.stringify(notRec.issues));
    const capped = sceneOf('draw the orbit of $x_{n+1} = 0.5 x_n$, $x_0 = 1$, 5000 steps');
    assert.ok(capped.issues.some((i) => i.severity === 'info' && i.field === 'steps'));
    assert.equal(capped.derived.OR1_n, MAX_ORBIT + 1);
    const matrix = sceneOf('let A = [[0, 1], [1, 0]]\ndraw the orbit of $X_{n+1} = A X_n$, $X_0 = A$, 3 steps');
    assert.ok(matrix.issues.some((i) => i.source === 'OR1' && /point in the plane/.test(i.message)));
});

// ------------------------------------------------------------ line tools

test('cobweb: y = x, the graph of the map and the path, fainter at the start', () => {
    const scene = sceneOf('show x from 0 to 1 and y from 0 to 1\ndraw the cobweb of $x_{n+1} = 2.5 x_n (1 - x_n)$ from 0.2, 60 steps');
    const it = item(scene, 'CW1');
    near(scene.derived.CW1_x, 0.6, 1e-6, 'the fixed point 1 - 1/r');
    assert.equal(it.strokes[0].color, 'gray');
    assert.equal(it.strokes[1].color, 'blue');
    assert.ok(it.strokes.some((s) => s.opacity === 0.3));
    assert.deepEqual(it.markers.map((m) => [m.x, m.y]), [[0.2, 0]]);
    // A function the chart draws itself is not drawn again.
    const shown = item(sceneOf('show x from 0 to 1 and y from 0 to 1\nplot f(x) = 3 x (1 - x)\ndraw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 10 steps'), 'CW1');
    assert.ok(!shown.strokes.some((s) => s.color === 'blue'));
});

test("Newton's method: tangents to the axis, lines up to the graph, labels x_0, x_1", () => {
    const scene = sceneOf("show x from -1 to 3 and y from -3 to 6\nplot f(x) = x^2 - 2\ndraw Newton's method for f from 2.5, 5 steps, labelled");
    near(scene.derived.NM1_x, Math.SQRT2, 1e-9);
    near(scene.derived.NM1_val, 0, 1e-9);
    const it = item(scene, 'NM1');
    const first = it.strokes[0].lines[0];
    near(first[0].x, 2.5, 1e-12);
    near(first[0].y, 4.25, 1e-12);
    near(first[1].x, 2.5 - 4.25 / 5, 1e-6);
    assert.equal(first[1].y, 0);
    assert.equal(it.guides[0].dashed, true);
    assert.deepEqual(it.texts.map((t) => t.text).slice(0, 2), ['$x_{0}$', '$x_{1}$']);
    const flat = sceneOf("plot f(x) = x^2 + 1\ndraw Newton's method for f from 0, 3 steps");
    assert.ok(flat.issues.some((i) => i.source === 'NM1' && i.severity === 'info'));
    const missing = sceneOf("draw Newton's method for g from 0, 3 steps");
    assert.ok(missing.issues.some((i) => i.source === 'NM1' && i.field === 'function'));
});

// ------------------------------------------------------------ pixel layers

test('bifurcation diagram: one value for r < 3, two for r in (3, 3.45)', () => {
    const scene = sceneOf('show x from 2.5 to 4 and y from 0 to 1\ndraw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4');
    const prim = item(scene, 'BD1').pixels?.[0];
    assert.ok(prim && prim.columns && !prim.shader);
    const rows = (r: number) => {
        const h = 200;
        const buf = new Uint8ClampedArray(h * 4);
        prim.tile({ xmin: r - 1e-6, xmax: r + 1e-6, ymin: 0, ymax: 1 }, 1, h, 0, 0, 1, h, buf);
        const out: number[] = [];
        for (let j = 0; j < h; j++) if (buf[4 * j + 3]) out.push(1 - (j + 0.5) / h);
        return out;
    };
    const one = rows(2.8);
    assert.equal(one.length, 1);
    near(one[0], 1 - 1 / 2.8, 0.005);
    assert.equal(rows(3.2).length, 2);
    // Outside r from 2.5 to 4 nothing.
    assert.equal(rows(2.2).length, 0);
    const box = prim.bounds?.();
    assert.ok(box && box.xmin === 2.5 && box.xmax === 4 && box.ymax > 0.9 && box.ymin < 0.2);
});

test('escape time: the Mandelbrot set is dark inside, coloured by speed outside', () => {
    const scene = sceneOf('show x from -2.5 to 1 and y from -1.25 to 1.25\ncolour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 100 steps');
    const it = item(scene, 'CP1');
    assert.deepEqual(pixelAt(it, V, -0.5, 0), [...rgb255(INSIDE), 255]);
    const far = pixelAt(it, V, 0.9, 0.9);
    assert.notDeepEqual(far.slice(0, 3), rgb255(INSIDE));
    assert.equal(far[3], 255);
    const prim = it.pixels?.[0];
    assert.ok(prim?.shader, 'the GPU has a shader');
    assert.match(prim.shader.source, /void main\(\)/);
    assert.equal(prim.cost, 100);
    const box = prim.bounds?.();
    assert.ok(box && box.xmin < -1.2 && box.xmax > 0.2 && box.xmax < 0.7, JSON.stringify(box));
});

test('escape time: sliders are uniforms of the shader, and a new value is a new picture', () => {
    const text = 'slider a from -1 to 1, starting at -0.8\nslider b from -1 to 1, starting at 0.156\ncolour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = x + iy$, $c = a + bi$, 300 steps';
    const one = item(sceneOf(text), 'CP1').pixels?.[0];
    const two = item(sceneOf(text, undefined, undefined, { a: 0.3 }), 'CP1').pixels?.[0];
    assert.ok(one?.shader && two);
    assert.deepEqual(one.shader.uniforms.map((u) => u.uniform).sort(), ['u_a', 'u_b']);
    assert.notEqual(one.key, two.key);
});

test('basins: orbits that settle take the colour of the point they reach', () => {
    const it = item(sceneOf('colour the plane by $z_{n+1} = z_n - \\frac{z_n^3 - 1}{3z_n^2}$, $z_0 = x + iy$, 40 steps'), 'CP1');
    const near1 = pixelAt(it, V, 1.2, 0.05);
    const nearOmega = pixelAt(it, V, -0.6, 0.9);
    // The root 1 (angle 0) is blue, e^{2 pi i / 3} orange; the faster, the brighter.
    assert.ok(near1[2] > near1[0], `blue near 1: ${near1}`);
    assert.ok(nearOmega[0] > nearOmega[2], `orange near omega: ${nearOmega}`);
    assert.equal(it.pixels?.[0].bounds?.(), null);
    assert.deepEqual(rgb255(basinRgb(1, 0, 0)), rgb255([0.2, 0.36, 0.85]));
});

test('domain colouring: hue is the angle, light from the size', () => {
    const it = item(sceneOf('colour the plane by $f(z) = z$'), 'CP1');
    const one = pixelAt(it, V, 1, 0);
    const minus = pixelAt(it, V, -1, 0);
    assert.ok(one[0] > one[1] && one[0] > one[2], `red at 1: ${one}`);
    assert.ok(minus[2] > minus[0] && minus[1] > minus[0], `cyan at -1: ${minus}`);
    assert.equal(domainRgb(NaN, 0), null);
    // Its zero is dark, its pole light.
    const pole = item(sceneOf('colour the plane by $f(z) = 1/z$'), 'CP1');
    const at0 = pixelAt(pole, V, 1e-7, 1e-7);
    assert.ok(at0[0] + at0[1] + at0[2] > 600, `light at the pole: ${at0}`);
});

test('heat map: the view\'s lowest value at the bottom of the map, the highest at the top', () => {
    const scene = sceneOf('show x from -1 to 1 and y from -1 to 1\ncolour the plane by $f(x, y) = x$, in heat');
    const it = item(scene, 'CP1');
    const lo = pixelAt(it, V, -0.98, 0);
    const hi = pixelAt(it, V, 0.98, 0);
    assert.ok(lo[0] + lo[1] + lo[2] < 60, `dark at the low end: ${lo}`);
    assert.ok(hi[0] + hi[1] + hi[2] > 700, `light at the high end: ${hi}`);
    assert.deepEqual(rgb255(mapRgb('viridis', 0)), [68, 1, 84]);
    // A function of the chart works on the CPU (no GLSL of chart functions).
    const fn = sceneOf('plot g(x) = x^2\ncolour the plane by $g(x) + y$');
    assert.deepEqual(fn.issues, []);
});

test('a plane takes a recurrence of complex numbers only', () => {
    const scene = sceneOf('let v = (1, 2)\ncolour the plane by $z_{n+1} = z_n + v$, $z_0 = x + iy$, 10 steps');
    assert.ok(scene.issues.some((i) => i.source === 'CP1' && i.severity === 'error'), JSON.stringify(scene.issues));
});

test('the colours in JavaScript and GLSL', () => {
    assert.deepEqual(cyclicRgb(0), [0.03, 0.06, 0.16]);
    assert.deepEqual(cyclicRgb(1), cyclicRgb(0));
    const glsl = glslColours('viridis');
    assert.match(glsl, /vec3 cmap\(float t\)/);
    assert.match(glsl, /vec3 basinColour\(vec2 w, float i\)/);
    assert.match(glsl, /vec3 domainColour\(vec2 w\)/);
    assert.match(glslColours('cyclic'), /fract\(t\) \* 6\.0/);
});

// ------------------------------------------------------------ the circles

test('turning circles: on the clock, the export draws a still frame', () => {
    const text = 'show x from -3 to 9 and y from -2 to 2\nslider n from 1 to 20, starting at 3, in steps of 1\ndraw the circles of $\\sum_{k=1}^{n} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave';
    assert.ok(needsClock(settingsOf(text).serialize()));
    const still = item(sceneOf(text), 'FC1');
    // The trace (faint), the circles, the arms, the wave and its connector.
    assert.equal(still.strokes.length, 5);
    assert.equal(still.strokes[1].lines.length, 3, 'one circle a term');
    const tip = (scene: Scene2D) => item(scene, 'FC1').markers[0];
    const t = 1.3;
    const moved = sceneOf(text, { time: t, step: Infinity, progress: 1 });
    const tau = t * FOURIER_SPEED;
    let re = 0;
    let im = 0;
    for (let k = 1; k <= 3; k++) {
        const r = 4 / (Math.PI * (2 * k - 1));
        re += r * Math.cos((2 * k - 1) * tau);
        im += r * Math.sin((2 * k - 1) * tau);
    }
    near(tip(moved).x, re, 1e-9);
    near(tip(moved).y, im, 1e-9);
    assert.equal(tip(sceneOf(text)).y, 0);
    const bad = sceneOf('draw the circles of $\\sum_{k=1}^{n} \\frac{1}{k} e^{ikt}$');
    assert.ok(bad.issues.some((i) => i.source === 'FC1'));
});

// ------------------------------------------------------------------- fit

test('fit: the Mandelbrot set, an orbit, a bifurcation diagram; planes that cover the view fit nothing', () => {
    const fit = (text: string) => {
        const s = settingsOf(text);
        return fitSettings(s, s.createMathContext());
    };
    const m = fit('colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 100 steps');
    assert.ok(m.x && m.x.min <= -1.2 && m.x.max >= 0.3 && m.x.max <= 1, JSON.stringify(m.x));
    const b = fit('draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4');
    assert.ok(b.x && b.x.min <= 2.5 && b.x.max >= 4, JSON.stringify(b.x));
    const o = fit('draw the orbit of $x_{n+1} = 0.5 x_n$, $x_0 = 8$, 10 steps');
    assert.ok(o.y && o.y.max >= 8 && o.x && o.x.max >= 10, JSON.stringify(o));
    const d = fit('colour the plane by $f(z) = 1/z$');
    assert.equal(d.nothing, 'unbounded');
});
