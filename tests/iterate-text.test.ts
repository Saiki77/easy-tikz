/*
 * Iterate and colour the plane (6.0 E), the words: every new line parses
 * into its tool, prints back the same (in words and in Full LaTeX), takes
 * its options, names its problems; the hover cards and the questions of
 * Ask the curve; the recipes draw with no problem.
 */
import { test, assert } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText } from '../src/text/print';
import { setChartLanguage } from '../src/text/full';
import { canonicalData } from '../src/chartdata';
import { SettingsManager } from '../src/settings';
import { computeScene2D, labelMetricsFor } from '../src/scene';
import { recipes } from '../src/migrate';
import { iterateHoverCard } from '../src/iterate/hover';
import { iterateQuestions, mapsToItself } from '../src/iterate/ask';
import { askContext } from '../src/notes6/ask';
import { planeKind } from '../src/iterate/forms';

type Data = Record<string, unknown>;

function toolsOf(text: string): Data[] {
    const r = parseChartText(text);
    assert.deepEqual(r.problems, [], text);
    return (r.data.tools as Data[]) ?? [];
}

function lastTool(text: string): Data {
    const tools = toolsOf(text);
    return tools[tools.length - 1];
}

/** Print the chart in words and in Full LaTeX: both read back as the same chart. */
function roundTrip(text: string): string {
    const r = parseChartText(text);
    assert.deepEqual(r.problems, [], text);
    const words = printChartText(r.data);
    const back = parseChartText(words);
    assert.deepEqual(back.problems, [], words);
    assert.equal(JSON.stringify(canonicalData(back.data)), JSON.stringify(canonicalData(r.data)), `words: ${words}`);
    setChartLanguage('full');
    try {
        const full = printChartText(r.data);
        const again = parseChartText(full);
        assert.deepEqual(again.problems, [], full);
        assert.equal(JSON.stringify(canonicalData(again.data)), JSON.stringify(canonicalData(r.data)), `full: ${full}`);
        assert.ok(!/\\raw\b|^raw /m.test(full), `no raw line: ${full}`);
    } finally {
        setChartLanguage('words');
    }
    assert.ok(!/^raw /m.test(words), `no raw line: ${words}`);
    return words;
}

const LINES: Record<string, string> = {
    orbit: 'mark P at (-0.12, 0.75)\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps',
    orbitPath: 'mark P at (-1, 0.3)\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 12 steps, as a path, labelled, in orange, thick',
    gradient: 'slider eta from 0 to 0.5, starting at 0.1\nlet $f(x, y) = x^2 + 4y^2$\nmark P at (2, 1)\ndraw the orbit of $p_{n+1} = p_n - \\eta \\nabla f(p_n)$, $p_0 = P$, 25 steps',
    numbers: 'draw the orbit of $x_{n+1} = \\cos(x_n)$, $x_0 = 1$, 30 steps',
    cobweb: 'slider r from 2.5 to 4, starting at 3.7\nplot $f(x) = r x (1 - x)$ in blue, thick\ndraw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps',
    cobwebName: 'plot f(x) = cos(x)\ndraw the cobweb of f from 1, 10 steps',
    bifurcation: 'draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4',
    bifurcationStart: 'draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 3 to 4, $x_0 = 0.3$, in red',
    newton: "plot f(x) = x^2 - 2\ndraw Newton's method for f from 2.5, 5 steps, labelled",
    mandelbrot: 'colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps',
    julia: 'slider a from -1 to 1, starting at -0.8\nslider b from -1 to 1, starting at 0.156\ncolour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = x + iy$, $c = a + bi$, 300 steps, in cyclic',
    basins: 'colour the plane by $z_{n+1} = z_n - \\frac{z_n^3 - 1}{3z_n^2}$, $z_0 = x + iy$, 40 steps, in viridis',
    domain: 'colour the plane by $f(z) = \\frac{z^2 - 1}{z^2 + 1}$, opacity 0.7',
    heat: 'colour the plane by $f(x, y) = \\sin x \\cos y$, in heat',
    color: 'color the plane by $x^2 - y^2$',
    circles: 'slider n from 1 to 20, starting at 5, in steps of 1\ndraw the circles of $\\sum_{k=1}^{n} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave',
    named: 'M: colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 100 steps\nthen draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = -1$, 10 steps',
};

test('every line parses into its tool', () => {
    assert.deepEqual(lastTool(LINES.orbit), { type: 'orbit', name: 'OR1', recurrence: 'z_{n+1} = z_n^2 + c', start: '0', given: 'c = P', steps: '40' });
    assert.deepEqual(lastTool(LINES.orbitPath), { type: 'orbit', name: 'OR1', recurrence: 'z_{n+1} = z_n^2 + c', start: '0', given: 'c = P', steps: '12', path: true, valueLabel: true, color: 'orange', thickness: 'thick' });
    assert.deepEqual(lastTool(LINES.gradient), { type: 'orbit', name: 'OR1', recurrence: 'p_{n+1} = p_n - \\eta \\nabla f(p_n)', start: 'P', steps: '25' });
    assert.deepEqual(lastTool(LINES.cobweb), { type: 'cobweb', name: 'CW1', start: '0.2', recurrence: 'x_{n+1} = f(x_n)', steps: '80' });
    assert.deepEqual(lastTool(LINES.cobwebName), { type: 'cobweb', name: 'CW1', start: '1', recurrence: 'x_{n+1} = f(x_n)', steps: '10' });
    assert.deepEqual(lastTool(LINES.bifurcation), { type: 'bifurcation', name: 'BD1', recurrence: 'x_{n+1} = r x_n (1 - x_n)', parameter: 'r', from: '2.5', to: '4' });
    assert.deepEqual(lastTool(LINES.bifurcationStart), { type: 'bifurcation', name: 'BD1', recurrence: 'x_{n+1} = r x_n (1 - x_n)', parameter: 'r', from: '3', to: '4', start: '0.3', color: 'red' });
    assert.deepEqual(lastTool(LINES.newton), { type: 'newton', name: 'NM1', function: 'f', start: '2.5', steps: '5', valueLabel: true });
    assert.deepEqual(lastTool(LINES.mandelbrot), { type: 'colourPlane', name: 'CP1', formula: 'z_{n+1} = z_n^2 + c', start: '0', steps: '200', given: 'c = x + i y' });
    assert.deepEqual(lastTool(LINES.julia), { type: 'colourPlane', name: 'CP1', formula: 'z_{n+1} = z_n^2 + c', start: 'x + i y', steps: '300', given: 'c = a + b i', colormap: 'cyclic' });
    assert.deepEqual(lastTool(LINES.domain), { type: 'colourPlane', name: 'CP1', formula: 'f(z) = \\frac{z^2 - 1}{z^2 + 1}', opacity: 0.7 });
    assert.deepEqual(lastTool(LINES.heat), { type: 'colourPlane', name: 'CP1', formula: 'f(x, y) = \\sin x \\cos y', colormap: 'heat' });
    assert.deepEqual(lastTool(LINES.color), { type: 'colourPlane', name: 'CP1', formula: 'x^2 - y^2' });
    assert.deepEqual(lastTool(LINES.circles), { type: 'fourierCircles', name: 'FC1', wave: true, sum: '\\sum_{k=1}^{n} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}' });
    const named = toolsOf(LINES.named);
    assert.equal(named[0].name, 'M');
    assert.equal(named[1].step, 1);
});

test('the start and the names a recurrence reads may come in any order, also after the steps', () => {
    const a = lastTool('mark P at (0.3, 0.5)\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $c = P$, $z_0 = 0$');
    assert.equal(a.start, '0');
    assert.equal(a.given, 'c = P');
    const b = lastTool('slider eta from 0 to 1, starting at 0.2\ndraw the orbit of $x_{n+1} = x_n - eta x_n$, 20 steps, $x_0 = 3$');
    assert.equal(b.start, '3');
    assert.equal(b.steps, '20');
    // Several names, `;` between them.
    const c = lastTool('draw the orbit of $z_{n+1} = a z_n + b$, $z_0 = 1$, $a = 0.5i$, $b = 1$, 20 steps');
    assert.equal(c.given, 'a = 0.5i; b = 1');
});

test('every line prints back as the same chart, in words and in Full LaTeX', () => {
    for (const [k, text] of Object.entries(LINES)) {
        const words = roundTrip(text);
        assert.ok(words.length > 0, k);
    }
    assert.match(printChartText(parseChartText(LINES.orbit).data), /draw the orbit of \$z_\{n\+1\} = z_n\^2 \+ c\$, \$z_0 = 0\$, \$c = P\$, 40 steps$/m);
    assert.match(printChartText(parseChartText(LINES.newton).data), /draw Newton's method for f from 2\.5, 5 steps, labelled$/m);
    setChartLanguage('full');
    try {
        const full = printChartText(parseChartText(LINES.julia).data);
        assert.match(full, /\\colourplane\[z_0=x \+ i y, c=a \+ b i, steps=300, colormap\/cyclic\]\{z_\{n\+1\} = z_n\^2 \+ c\}/);
        assert.match(printChartText(parseChartText(LINES.bifurcation).data), /\\bifurcation\[r=2\.5:4\]\{x_\{n\+1\} = r x_n \(1 - x_n\)\}/);
        assert.match(printChartText(parseChartText(LINES.circles).data), /\\circles\[wave\]\{\\sum_\{k=1\}\^\{n\}/);
    } finally {
        setChartLanguage('words');
    }
});

test('Full LaTeX reads its commands', () => {
    const text = [
        '\\begin{chart}',
        '\\mark[name=P]{(0.2, 0.5)}',
        '\\orbit[z_0=0, c=P, steps=30, as a path]{z_{n+1} = z_n^2 + c}',
        '\\colourplane[z_0=0, c={x + iy}, steps=100, colormap/viridis]{z_{n+1} = z_n^2 + c}',
        '\\newton[from=2, steps=4]{f}',
        '\\plot{f(x) = x^2 - 3}',
        '\\end{chart}',
    ].join('\n');
    const r = parseChartText(text);
    assert.deepEqual(r.problems, []);
    const tools = r.data.tools as Data[];
    assert.deepEqual(tools[1], { type: 'orbit', name: 'OR1', recurrence: 'z_{n+1} = z_n^2 + c', start: '0', given: 'c = P', steps: '30', path: true });
    assert.equal(tools[2].colormap, 'viridis');
    assert.equal(tools[2].given, 'c = x + i y');
    assert.deepEqual(tools[3], { type: 'newton', name: 'NM1', function: 'f', start: '2', steps: '4' });
});

test('problems name what a line takes', () => {
    const problem = (text: string) => parseChartText(text).problems.map((p) => p.message).join(' | ');
    assert.match(problem('draw the orbit of x^2 + 1'), /draw the orbit of z_\{n\+1\}/);
    assert.match(problem('colour the plane'), /colour the plane by/);
    assert.match(problem('draw the circles of x^2'), /draw the circles of/);
    assert.match(problem('draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$'), /for r from 2\.5 to 4/);
    assert.match(problem("draw Newton's method for"), /Newton's method for f/);
    assert.match(problem('colour the plane by $f(z) = z^2$, sparkly'), /sparkly/);
    assert.match(problem('colour the plane by $f(z) = z^2$, opacity 4'), /0 to 1|between 0 and 1|from 0/i);
});

test('old charts read as before: colour and color stay names of functions and formulas', () => {
    const fn = parseChartText('color(x) = x^2\nplot colour(x) = 2x');
    assert.deepEqual(fn.problems, []);
    assert.deepEqual((fn.data.functions as Data[]).map((f) => f.name), ['color', 'colour']);
});

test('a plane is a recurrence, a function of z or a function of x and y', () => {
    assert.equal(planeKind('z_{n+1} = z_n^2 + c'), 'escape');
    assert.equal(planeKind('f(z) = 1/z'), 'domain');
    assert.equal(planeKind('z^3 - 1'), 'domain');
    assert.equal(planeKind('f(x, y) = x y'), 'heat');
    assert.equal(planeKind('x^2 - y^2'), 'heat');
});

// --------------------------------------------------------------- hover cards

test('hover cards: a recurrence, a sum and a function of z have a chart', () => {
    const lines = (tex: string) => {
        const card = iterateHoverCard(tex);
        assert.ok(card, tex);
        const r = parseChartText(card.lines.join('\n'));
        assert.deepEqual(r.problems, [], card.lines.join('\n'));
        return card;
    };
    const orbit = lines('z_{n+1} = z_n^2 + c');
    assert.equal(orbit.kind, 'recurrence');
    assert.ok(orbit.lines.some((l) => l.startsWith('draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = a + b i$')));
    const cobweb = lines('x_{n+1} = r x_n (1 - x_n)');
    assert.ok(cobweb.lines.some((l) => l.startsWith('draw the cobweb of')) && cobweb.lines.some((l) => l.startsWith('slider r ')));
    const sum = lines('\\sum_{k=1}^{n} \\frac{1}{k^2}');
    assert.equal(sum.kind, 'sum');
    assert.ok(sum.lines.some((l) => l.startsWith('slider n ')));
    assert.ok(lines('\\sum_{k=1}^{n} \\frac{\\sin((2k-1)x)}{2k-1}').lines.some((l) => l.startsWith('plot $S(x) = ')));
    assert.equal(lines('f(z) = \\frac{z^2 - 1}{z^2 + 1}').kind, 'domain');
    assert.equal(iterateHoverCard('x^2 + 1'), null);
    assert.equal(iterateHoverCard('p_{n+1} = p_n - \\eta \\nabla f(p_n)'), null);
});

// ------------------------------------------------------------ Ask the curve

test("Ask the curve: Newton's method from here; the cobweb when f maps the view's square to itself", () => {
    const ask = (text: string, name: string, x: number) => {
        const settings = SettingsManager.fromJSON(parseChartText(text).data);
        const math = settings.createMathContext({ memo: false });
        const data = settings.serialize();
        const view = { xmin: Number(data.xmin), xmax: Number(data.xmax), ymin: Number(data.ymin), ymax: Number(data.ymax) };
        return iterateQuestions(askContext({ kind: 'function', name, x, y: 0 }, data, view, math));
    };
    const logistic = ask('show x from 0 to 1 and y from 0 to 1\nplot f(x) = 3.5 x (1 - x)', 'f', 0.2);
    assert.deepEqual(logistic.map((q) => q.id), ['iterate-newton', 'iterate-cobweb']);
    assert.deepEqual(logistic[1].answer.lines, ['draw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 40 steps']);
    assert.match(logistic[0].answer.lines?.[0] ?? '', /^draw Newton's method for f from 0\.2, 5 steps, labelled$/);
    const parabola = ask('show x from -3 to 3 and y from -3 to 3\nplot g(x) = x^2 - 2', 'g', 1);
    assert.deepEqual(parabola.map((q) => q.id), ['iterate-newton']);
    // Every answer is a line the chart reads.
    for (const q of [...logistic, ...parabola]) for (const l of q.answer.lines ?? []) assert.deepEqual(parseChartText(`plot f(x) = x\nplot g(x) = x\n${l}`).problems, [], l);
    assert.ok(mapsToItself((x) => 4 * x * (1 - x), 0, 1));
    assert.ok(!mapsToItself((x) => 5 * x * (1 - x), 0, 1));
});

// ------------------------------------------------------------------ recipes

test('recipes of Iterate and Colour the plane build charts that draw with no problem', () => {
    const ids = ['mandelbrot', 'julia', 'newton-basins', 'domain-colouring', 'heat-map', 'orbit', 'gradient-descent', 'cobweb', 'bifurcation', 'newton-method', 'fourier-circles'];
    const all = recipes(false);
    for (const id of ids) {
        const r = all.find((x) => x.id === id);
        assert.ok(r, id);
        const ctx = { is3D: false, functions: [], tools: [], parameters: [] };
        assert.ok(r.available(ctx), id);
        const built = r.build(ctx);
        const data: Data = { v: 4, xmin: '-2', xmax: '2', ymin: '-2', ymax: '2', functions: [], tools: [], parameters: [] };
        if (built.kind === 'tool') (data.tools as unknown[]).push(built.tool);
        else if (built.kind === 'items') {
            data.tools = built.tools;
            data.functions = built.functions ?? [];
            data.parameters = built.parameters ?? [];
        } else assert.fail(`${id}: ${built.kind}`);
        const settings = SettingsManager.fromJSON(data);
        const math = settings.createMathContext({ memo: false });
        const config = settings.toRendererConfig(math);
        const scene = computeScene2D({ functions: config.functions, tools: config.tools, math, view: { xmin: -2, xmax: 2, ymin: -2, ymax: 2 }, grid: { nx: 50, ny: 50 }, axisStyle: 'box', polar: false, labelMetrics: labelMetricsFor(10, 10) });
        assert.deepEqual(scene.issues.filter((i) => i.severity === 'error'), [], id);
        assert.ok(scene.items.some((it) => (it.pixels?.length ?? 0) > 0 || it.strokes.length > 0), `${id} draws`);
        // The chart prints as lines (no raw line).
        assert.ok(!/^raw /m.test(printChartText(settings.serialize())), id);
    }
});

test('hover cards: a sum with the upper bound written first, with \\displaystyle or \\limits (6.2.2)', () => {
    for (const tex of ['\\displaystyle \\sum^n_{k=1}k=\\frac{n(n+1)}{2}', '\\sum^{n}_{k=0}q^k = \\frac{1-q^{n+1}}{1-q}', '\\sum\\limits_{k=1}^{n} k^2', '\\sum\\limits^n_{k=1} \\frac{1}{k}']) {
        const card = iterateHoverCard(tex);
        assert.ok(card && card.kind === 'sum', tex);
        const r = parseChartText(card.lines.join('\n'));
        assert.deepEqual(r.problems, [], card.lines.join('\n'));
        // The chart writes the usual order, lower bound first.
        assert.ok(card.lines.some((l) => /\\sum_\{k=[01]\}\^/.test(l)), card.lines.join('\n'));
    }
});
