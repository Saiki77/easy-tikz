/*
 * The machine learning pack (6.0 ML): function heads as ML notes write them
 * (\sigma(x), \mathrm{ReLU}(x), \operatorname{softplus}(x), \text{relu}(x),
 * t(x)), the activation functions and softmax / logsumexp in formulas
 * (values, names that win over them, the export, the GPU), and the words
 * and Full LaTeX printed back as written. The Python side is in
 * tests/ml-python.test.ts.
 */
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printFullText, printWordsText } from '../src/text/print';
import { wordsToFull } from '../src/text/full';
import { SettingsManager } from '../src/settings';
import { SceneCache, computeScene2D, labelMetricsFor, Scene2D } from '../src/scene';
import { readTexHead, headName } from '../src/ml/heads';
import { logSumExpOf, mlFunction, softmaxOf } from '../src/ml/builtins';

function settingsOf(text: string): SettingsManager {
    const r = parseChartText(text);
    assert.deepEqual(r.problems, [], text);
    return SettingsManager.fromJSON(r.data);
}

/** The functions of a chart at some x: name -> values. */
function valuesOf(text: string, xs: number[]): Record<string, number[]> {
    const math = settingsOf(text).createMathContext();
    const out: Record<string, number[]> = {};
    for (const f of math.functions()) {
        assert.equal(f.error, undefined, `${f.name}: ${f.error}`);
        out[f.name] = xs.map((x) => f.fn(x));
    }
    return out;
}

function sceneOf(text: string, cache?: SceneCache): Scene2D {
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
        cache,
    });
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

test('heads: Greek letters and names in text commands, read at the start of a definition', () => {
    assert.deepEqual(readTexHead('\\sigma(x) = 1'), { name: 'sigma', head: '\\sigma', rest: 'sigma(x) = 1' });
    assert.deepEqual(readTexHead('\\mathrm{ReLU}(x) = 1'), { name: 'ReLU', head: '\\mathrm{ReLU}', rest: 'ReLU(x) = 1' });
    assert.equal(readTexHead('\\operatorname{softplus}(x)')?.name, 'softplus');
    assert.equal(readTexHead('\\text{relu}(x)')?.name, 'relu');
    // Not a head: a function command, pi and theta, a name without a bracket.
    assert.equal(readTexHead('\\sin(x) = 1'), null);
    assert.equal(readTexHead('\\pi(x) = 1'), null);
    assert.equal(readTexHead('\\theta(x) = 1'), null);
    assert.equal(readTexHead('\\sigma = 1'), null);
    assert.equal(headName('\\mathrm{ReLU}'), 'ReLU');
    assert.equal(headName('\\sin'), null);
});

test('heads: the function is named by the plain name, printed back as written, in words and Full LaTeX', () => {
    const lines = [
        'plot $\\sigma(x) = \\frac{1}{1 + e^{-x}}$ in blue',
        'plot $\\mathrm{ReLU}(x) = \\max(0, x)$ in red',
        'plot $\\operatorname{softplus}(x) = \\ln(1 + e^x)$',
        'plot $\\text{relu}(x) = \\max(0, x)$, dashed',
        'plot $t(x) = \\tanh x$',
    ];
    const text = lines.join('\n');
    const r = parseChartText(text);
    assert.deepEqual(r.problems, []);
    const fns = r.data.functions as Array<Record<string, unknown>>;
    assert.deepEqual(fns.map((f) => f.name), ['sigma', 'ReLU', 'softplus', 'relu', 't']);
    assert.deepEqual(fns.map((f) => f.head), ['\\sigma', '\\mathrm{ReLU}', '\\operatorname{softplus}', '\\text{relu}', undefined]);
    assert.equal(printWordsText(r.data), text);
    // Through the settings (the migration keeps the head) and back.
    assert.equal(printWordsText(SettingsManager.fromJSON(r.data).serialize()), text);
    const full = wordsToFull(text, { builtin: true });
    assert.match(full, /\\plot\[blue\]\{\\sigma\(x\) = /);
    assert.match(full, /\\plot\[red\]\{\\mathrm\{ReLU\}\(x\) = /);
    assert.equal(JSON.stringify(parseChartText(full).data.functions), JSON.stringify(r.data.functions));
    assert.match(printFullText(r.data), /\\plot\{\\operatorname\{softplus\}\(x\) = /);
    // A bare line and a draw line read the same.
    assert.equal((parseChartText('$\\sigma(x) = 2x$').data.functions as Array<Record<string, unknown>>)[0].head, '\\sigma');
});

test('heads: the functions compute, and other formulas call them by either form', () => {
    const v = valuesOf(
        [
            'plot $\\sigma(x) = \\frac{1}{1 + e^{-x}}$',
            'plot $g(x) = \\sigma(2x)$',
            'plot $\\mathrm{ReLU}(x) = \\max(0, x)$',
            'plot $h(x) = \\mathrm{ReLU}(x - 1) + ReLU(x)$',
            'plot $t(x) = \\tanh x$',
            'plot $k(x) = t(x) + 1$',
        ].join('\n'),
        [-1, 0.5, 2]
    );
    v.g.forEach((y, i) => near(y, sigmoid(2 * [-1, 0.5, 2][i]), 1e-12));
    assert.deepEqual(v.h, [0, 0.5, 3]);
    v.k.forEach((y, i) => near(y, Math.tanh([-1, 0.5, 2][i]) + 1, 1e-12));
});

test('t: a function of x only; parametric curves, solutions and sliders keep t as before', () => {
    const v = valuesOf('plot $t(x) = x^2$\nplot $c(t) = (\\cos t, \\sin t)$', [0.5]);
    assert.deepEqual(v.t, [0.25]);
    near(v.c[0], Math.cos(0.5), 1e-12);
    const r = parseChartText('plot $c(t) = (\\cos t, \\sin t)$');
    assert.equal((r.data.functions as Array<Record<string, unknown>>)[0].parametric, true);
    // A slider t is still refused, and t(t) = ... is no function t.
    assert.ok(parseChartText('slider t from 0 to 1').problems.length > 0);
    assert.notEqual((parseChartText('plot t(t) = (t, t)').data.functions as unknown[] | undefined)?.length, 1);
    // Two functions t: the second is a problem.
    assert.ok(parseChartText('plot t(x) = x\nplot t(x) = 2x').problems.length > 0);
    // A polar chart: t(x) is not a polar function, theta stays its variable.
    const polar = parseChartText('plot r(theta) = 1 + cos(theta)');
    assert.deepEqual(polar.problems, []);
});

test('old charts read and print as before (charts with f(x), parametric t, sliders, Greek sliders)', () => {
    for (const text of [
        'plot f(x) = sin(x)',
        'plot $f(x) = \\frac{1}{2}x^2$ in blue, thick',
        'plot $c(t) = (\\cos t, \\sin t)$',
        'slider sigma from 0.5 to 2, starting at 1\nplot $f(x) = \\frac{1}{\\sigma \\sqrt{2\\pi}} e^{-\\frac{x^2}{2\\sigma^2}}$',
        'slider lambda from 0 to 1\nplot $f(x) = \\lambda x$',
        'polar\nplot r(theta) = 1 + cos(theta)',
        'draw x^2 + y^2 = 1',
    ]) {
        const r = parseChartText(text);
        assert.deepEqual(r.problems, [], text);
        assert.equal(printWordsText(r.data), text);
        assert.ok(!(r.data.functions as Array<Record<string, unknown>> | undefined)?.some((f) => 'head' in f), text);
    }
});

test('built-ins: sigmoid, relu, softplus, gelu, silu in formulas, plain and LaTeX names', () => {
    const xs = [-3, -0.5, 0, 0.7, 4];
    const v = valuesOf(
        [
            'plot $a(x) = \\operatorname{sigmoid}(x)$',
            'plot $b(x) = \\sigma(x)$',
            'plot $c(x) = relu(x)$',
            'plot $d(x) = \\mathrm{ReLU}(x)$',
            'plot $e1(x) = \\operatorname{softplus}(x)$',
            'plot $g(x) = \\mathrm{GELU}(x)$',
            'plot $h(x) = silu(x)$',
        ].join('\n'),
        xs
    );
    xs.forEach((x, i) => {
        near(v.a[i], sigmoid(x), 1e-12);
        near(v.b[i], sigmoid(x), 1e-12);
        assert.equal(v.c[i], Math.max(0, x));
        assert.equal(v.d[i], Math.max(0, x));
        near(v.e1[i], Math.log(1 + Math.exp(x)), 1e-12);
        near(v.h[i], x * sigmoid(x), 1e-12);
    });
    // GELU: x Φ(x), erf to 1.5e-7.
    // erf of Abramowitz and Stegun 7.1.26: within 1.5e-7, so GELU within |x| times that.
    near(v.g[3], 0.5306254434438489, 2e-7);
    near(v.g[0], -0.00404969409489031, 5e-7);
    near(valuesOf('plot $g(x) = gelu(x)$', [1]).g[0], 0.8413447460685429, 1e-7);
    // Large numbers stay finite.
    const big = mlFunction('softplus');
    near(big?.call(1000) ?? NaN, 1000, 1e-9);
    assert.equal(big?.call(-1000), 0);
    assert.equal(mlFunction('sigmoid')?.call(-1000), 0);
});

test('built-ins: the chart\'s own names win (a function, a slider, a let value, a script name)', () => {
    assert.deepEqual(valuesOf('plot $\\sigma(x) = 2x$\nplot $g(x) = \\sigma(x + 1)$', [1]).g, [4]);
    assert.deepEqual(valuesOf('slider sigma from 0 to 3, starting at 3\nplot $g(x) = \\sigma(x + 1)$', [1]).g, [6]);
    assert.deepEqual(valuesOf('plot relu(x) = x - 5\nplot g(x) = relu(1)', [0]).g, [-4]);
    assert.deepEqual(valuesOf('let $softplus = 2$\nplot $g(x) = softplus(x)$', [3]).g, [6]);
    assert.deepEqual(valuesOf('python:\n    def relu(v):\n        return 7\nplot g(x) = relu(x)', [3]).g, [7]);
});

test('softmax and logsumexp: of a vector or a list, in labels and formulas, without overflow', () => {
    near(softmaxOf([2, 1, 0.1]).reduce((a, b) => a + b, 0), 1, 1e-15);
    near(logSumExpOf([1000, 1000]), 1000 + Math.log(2), 1e-12);
    const math = settingsOf('let $u = (2, 1, 0.1)$\nlet $w = (1000, 999, -5)$\nlet $v = (-1, 2)$').createMathContext();
    assert.equal(math.formatTemplate('{softmax(u)}'), '(0.659, 0.242, 0.099)');
    assert.equal(math.formatTemplate('{logsumexp(u):3}'), '2.417');
    assert.equal(math.formatTemplate('{softmax(w)}'), '(0.731, 0.269, 0)');
    assert.equal(math.formatTemplate('{relu(v)}'), '(0, 2)');
    assert.equal(math.formatTemplate('{sigmoid(v)}'), '(0.269, 0.881)');
    assert.equal(math.formatTemplate('{softmax([1, 1])}'), '[0.5, 0.5]');
    const v = valuesOf('let $u = (2, 1, 0.1)$\nplot $f(x) = \\operatorname{logsumexp}(u) + x$', [0]);
    near(v.f[0], Math.log(Math.exp(2) + Math.exp(1) + Math.exp(0.1)), 1e-12);
});

test('the export writes the built-ins as pgfmath (gelu with the same erf), logsumexp as its number', () => {
    const tikz = settingsOf(
        'show x from -3 to 3 and y from -1 to 3\nplot $f(x) = \\sigma(x)$\nplot $g(x) = \\operatorname{relu}(x)$\nplot $h(x) = \\operatorname{gelu}(x)$\nlet $u = (2, 1, 0.1)$\nplot $k(x) = \\operatorname{logsumexp}(u) x$'
    ).generateTikzCode();
    assert.match(tikz, /\{1\/\(1\+exp\(-x\)\)\}/);
    assert.match(tikz, /max\(0,x\)/);
    assert.match(tikz, /1\.061405429/);
    assert.match(tikz, /\{\(2\.41703\*x\)\}/);
    assert.doesNotMatch(tikz, /sigmoid|relu|gelu/);
});

test('a heat map of a built-in has a GPU shader that writes it out', () => {
    const scene = sceneOf('show x from -3 to 3 and y from -3 to 3\ncolour the plane by $f(x, y) = \\sigma(x y)$, in viridis');
    assert.deepEqual(scene.issues, []);
    const prim = scene.items[0].pixels?.[0];
    assert.ok(prim?.shader, 'a shader');
    assert.match(prim.shader.source, /1\.0 \/ \(1\.0 \+ exp\(-/);
});
