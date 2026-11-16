/*
 * Probability (5.0): the normal and binomial distributions (numbers), the
 * event of a shaded probability (its forms, LaTeX relations, which side is
 * the variable, its bounds and label), the lines of the chart language (read,
 * printed, read back, which distribution a shade line means), the scene
 * (density, bars, shaded area and bars, labels, problems), the auto-fit and
 * the export.
 */
import { test, assert, near } from './_lib';
import { binomialPmf, erfc, normalCdf, normalProbability, probabilityText } from '../src/beyond/maths';
import { eventBounds, eventLabel, eventNames, readEvent, splitEvent } from '../src/beyond/event';
import { parseChartText } from '../src/text/parse';
import { printChartText } from '../src/text/print';
import { canonical } from '../src/chartdata';
import { clean, setChartWords, NO_WORDS } from '../src/text/words';
import { SettingsManager } from '../src/settings';
import { computeScene2D, labelMetricsFor, Scene2D } from '../src/scene';
import { fitSettings } from '../src/fit';
import { recipes } from '../src/migrate';
import { Tool } from '../src/types';

type Data = Record<string, unknown>;

function sceneOf(text: string): Scene2D {
    const settings = SettingsManager.fromJSON(parseChartText(text).data);
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    return computeScene2D({
        functions: config.functions,
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: { nx: 200, ny: 200 },
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(10, 10),
    });
}

function roundTrip(text: string): string {
    const first = parseChartText(text);
    assert.deepEqual(first.problems, [], `problems in ${text}`);
    const printed = printChartText(first.data);
    const back = parseChartText(printed);
    assert.deepEqual(back.problems, [], `problems in the printed text:\n${printed}`);
    assert.equal(canonical(back.data), canonical(first.data), `printed:\n${printed}`);
    return printed;
}

// ---------------------------------------------------------------- numbers

test('probability: the normal distribution in both tails', () => {
    near(normalCdf(0, 0, 1), 0.5, 1e-7);
    near(normalCdf(1.96, 0, 1), 0.975, 1e-4);
    near(normalProbability(-1, 1, 0, 1), 0.682689, 1e-6);
    near(normalProbability(-Infinity, Infinity, 3, 2), 1, 1e-9);
    // The upper tail keeps its digits: P(X >= 6) is about 9.87e-10.
    near(normalProbability(6, Infinity, 0, 1) / 9.8659e-10, 1, 1e-3);
    near(erfc(0), 1, 1e-7);
    assert.equal(normalProbability(2, 1, 0, 1), 0);
});

test('probability: the binomial distribution sums to 1, at p = 0 and 1 too', () => {
    const pmf = binomialPmf(10, 0.4);
    near(pmf.reduce((a, b) => a + b, 0), 1, 1e-12);
    near(pmf[4], 0.250822656, 1e-9);
    assert.deepEqual(binomialPmf(3, 0), [1, 0, 0, 0]);
    assert.deepEqual(binomialPmf(3, 1), [0, 0, 0, 1]);
    near(binomialPmf(1000, 0.9).reduce((a, b) => a + b, 0), 1, 1e-9);
});

test('probability: how a label prints a probability', () => {
    assert.equal(probabilityText(0.6826894772), '0.683');
    assert.equal(probabilityText(0.5), '0.5');
    assert.equal(probabilityText(0.99977), '0.99977');
    assert.equal(probabilityText(3.17e-5), '3.2 \\cdot 10^{-5}');
    assert.equal(probabilityText(0), '0');
    assert.equal(probabilityText(1), '1');
});

// ------------------------------------------------------------------ event

test('probability: the forms of an event, plain and LaTeX', () => {
    const variable = (n: string) => n === 'X';
    assert.deepEqual(splitEvent('-1 \\le X \\leq 1'), { parts: ['-1', 'X', '1'], ops: ['<=', '<='] });
    assert.deepEqual(splitEvent('X ≥ a'), { parts: ['X', 'a'], ops: ['>='] });
    assert.deepEqual(splitEvent('X == 3'), { parts: ['X', '3'], ops: ['='] });
    assert.equal(splitEvent('X'), null);
    const between = readEvent('-1 <= X < f(2)', variable);
    assert.ok(between);
    if (between) assert.deepEqual(eventBounds(between, [-1, NaN, 4]), { lo: -1, hi: 4, loStrict: false, hiStrict: true });
    const down = readEvent('5 > X >= 2', variable);
    if (down) assert.deepEqual(eventBounds(down, [5, NaN, 2]), { lo: 2, hi: 5, loStrict: false, hiStrict: true });
    const right = readEvent('a <= X', (n) => n === 'X');
    assert.ok(right && right.variable === 1);
    if (right) assert.deepEqual(eventBounds(right, [0.5, NaN]), { lo: 0.5, hi: Infinity, loStrict: false, hiStrict: false });
    const equal = readEvent('X = 3', variable);
    if (equal) assert.equal(eventBounds(equal, [NaN, 3]).equal, 3);
    assert.equal(readEvent('1 <= X >= 2', variable), null);
    assert.equal(readEvent('a <= b', variable), null);
    if (between) assert.equal(eventLabel(between, [-1.2, NaN, 4], '0.75'), '$P(-1.2 \\le X < 4) = 0.75$');
    assert.deepEqual(eventNames('X2 \\le \\frac{a}{2}'), ['X2', 'a']);
});

// ------------------------------------------------------------------- text

test('probability: the lines read and print back as the same chart', () => {
    assert.equal(
        roundTrip('plot the normal distribution with mean 0 and sd 1\nshade P(-1 <= X <= 1), labelled'),
        'plot the normal distribution with mean 0 and sd 1\nshade P(-1 <= X <= 1), labelled'
    );
    assert.equal(roundTrip('plot the binomial distribution with n = 10 and p = 0.4 in red\nshade $P(X \\le 3)$, opacity 0.6, labelled "{p:4}"'), 'plot the binomial distribution with n = 10 and p = 0.4 in red\nshade $P(X \\le 3)$, opacity 0.6, labelled "{p:4}"');
    roundTrip('slider m from -2 to 2\nslider s from 0.5 to 3, starting at 1\nplot the normal distribution with mean m and sd s, thick, dashed\nshade P(m - s <= X <= m + s) in green, pattern dots');
    roundTrip('plot the normal distribution with mean $\\frac{1}{2}$ and sd 2\nshade P(X > 1.96) in red, labelled');
    // The other spellings of the parameters, and the standard normal distribution.
    const other = parseChartText('plot the normal distribution with sd = 2 and standard deviation 3 and \\mu = 1').data.tools as Data[];
    assert.deepEqual([other[0].mean, other[0].sd], ['1', '3']);
    assert.deepEqual(parseChartText('plot the standard normal distribution').data.tools, [{ type: 'distribution', name: 'X1', kind: 'normal' }]);
});

test('probability: a shade line means the distribution it names, else the nearest above', () => {
    const tools = (text: string) => parseChartText(text).data.tools as Data[];
    const two = 'plot the normal distribution with mean 0 and sd 1\nplot the binomial distribution with n = 10 and p = 0.4\n';
    assert.equal(tools(`${two}shade P(X <= 1)`)[2].distribution, 'X2');
    assert.equal(tools(`${two}shade P(X1 <= 1)`)[2].distribution, 'X1');
    assert.equal(tools(`${two}shade P(X <= 1) of X1`)[2].distribution, 'X1');
    assert.equal(tools(`shade P(X <= 1)\n${two}`)[0].distribution, 'X1');
    // Printed: bare where the nearest one is meant, `of` where it is not.
    const data = parseChartText(`${two}shade P(X <= 1)`).data;
    ((data.tools as Data[])[2] as Data).distribution = 'X1';
    // The line names X1, so X1's line names itself too.
    assert.equal(printChartText(data), `X1: ${two}shade P(X <= 1) of X1`);
    roundTrip(`${two}shade P(X <= 1) of X1\nshade P(X2 >= 8)`);
    const problems = parseChartText('shade P(X <= 1)').problems.map((p) => p.message);
    assert.match(problems[0], /P\(\.\.\.\) needs a distribution above it/);
    assert.match(parseChartText('plot the binomial distribution with mean 1').problems[0].message, /parameters as mean 0 and sd 1/);
    assert.match(parseChartText('plot the normal distribution with mean 1, sparkly').problems[0].message, /unknown option "sparkly"; a distribution takes/);
});

test('probability: the lines in a person\'s own words', () => {
    setChartWords(clean({ words: { plot: ['zeichne'], 'the-normal-distribution': ['die Normalverteilung'], 'with-mean': ['mit Mittelwert'], sd: ['Standardabweichung'], and: ['und'], shade: ['schattiere'] }, bundles: [], write: 'yours' }));
    try {
        const text = 'zeichne die Normalverteilung mit Mittelwert 0 und Standardabweichung 1\nschattiere P(-1 <= X <= 1), labelled';
        const read = parseChartText(text);
        assert.deepEqual(read.problems, []);
        assert.equal(printChartText(read.data), text);
    } finally {
        setChartWords(NO_WORDS);
    }
});

// ------------------------------------------------------------------ scene

test('probability: the density, the area under it and its label', () => {
    const scene = sceneOf('show x from -4 to 4 and y from 0 to 0.5\nplot the normal distribution with mean 0 and sd 1\nshade P(-1 <= X <= 1), labelled');
    assert.deepEqual(scene.issues, []);
    const [dist, area] = scene.items;
    const curve = dist.strokes[0].lines[0];
    assert.equal(curve[0].x, -4);
    assert.equal(curve[curve.length - 1].x, 4);
    near(Math.max(...curve.map((p) => p.y)), 1 / Math.sqrt(2 * Math.PI), 1e-12);
    const ring = area.fills[0].rings[0];
    assert.deepEqual(ring[0], { x: -1, y: 0 });
    assert.deepEqual(ring[ring.length - 1], { x: 1, y: 0 });
    assert.equal(area.texts[0].text, '$P(-1 \\le X \\le 1) = 0.683$');
    near(scene.derived.PR1_val, 0.682689, 1e-6);
});

test('probability: a slider moves the bounds and the label shows their values', () => {
    const scene = sceneOf('show x from -4 to 4 and y from 0 to 0.5\nslider a from 0 to 3, starting at 1.5\nplot the normal distribution with mean 0 and sd 1\nshade P(-a < X < a), labelled');
    assert.equal(scene.items[1].texts[0].text, '$P(-1.5 < X < 1.5) = 0.866$');
});

test('probability: the binomial bars, the bars in range, strict bounds and one value', () => {
    const scene = sceneOf(
        'show x from -1 to 11 and y from 0 to 0.3\nplot the binomial distribution with n = 10 and p = 0.4\nshade P(3 <= X < 6), labelled\nshade P(X = 8), labelled\nshade P(X > 9.5)\nshade P(2.5 <= X <= 3.5)'
    );
    assert.deepEqual(scene.issues, []);
    const [dist, range, one, top, middle] = scene.items;
    assert.equal(dist.fills[0].rings.length, 11);
    near(dist.fills[0].rings[4][1].x - dist.fills[0].rings[4][0].x, 0.8);
    assert.deepEqual(range.fills[0].rings.map((r) => (r[0].x + r[1].x) / 2), [3, 4, 5]);
    assert.equal(range.texts[0].text, '$P(3 \\le X < 6) = 0.666$');
    assert.equal(one.texts[0].text, '$P(X = 8) = 0.011$');
    assert.deepEqual(top.fills[0].rings.map((r) => (r[0].x + r[1].x) / 2), [10]);
    assert.deepEqual(middle.fills[0].rings.map((r) => (r[0].x + r[1].x) / 2), [3]);
    near(scene.derived.PR2_val, binomialPmf(10, 0.4)[8], 1e-12);
});

test('probability: problems name the field', () => {
    const issues = (text: string) => sceneOf(text).issues.map((i) => `${i.source}.${i.field ?? ''} ${i.severity}: ${i.message}`);
    assert.deepEqual(issues('plot the normal distribution with mean 0 and sd -1'), ['X1.sd error: The standard deviation must be more than 0']);
    assert.deepEqual(issues('plot the binomial distribution with n = 2.5 and p = 0.4'), ['X1.n error: n must be a whole number from 0 to 1000']);
    assert.deepEqual(issues('plot the binomial distribution with n = 10 and p = 1.5'), ['X1.p error: p must be from 0 to 1']);
    assert.match(issues('plot the normal distribution with mean 0 and sd 1\nshade P(X <= q)')[0], /^PR1\.event error: Unknown name 'q'/);
    assert.deepEqual(issues('plot the normal distribution with mean 0 and sd 1\nshade P(1 < 2)'), ['PR1.event error: Write the event as a <= X <= b, X <= b, X >= a or X = k']);
    assert.deepEqual(issues('plot the normal distribution with mean 0 and sd -1\nshade P(X <= 1)'), ['X1.sd error: The standard deviation must be more than 0', 'PR1.distribution error: X1 has an error']);
});

test('probability: the fit holds four standard deviations and the peak, or the bars', () => {
    const settings = SettingsManager.fromJSON(parseChartText('plot the normal distribution with mean 10 and sd 2\nshade P(X <= 9)').data);
    const fit = fitSettings(settings, settings.createMathContext());
    // 2 to 18, with 0 taken in (it is near) and a margin.
    assert.ok((fit.x?.min ?? 9) <= 2 && (fit.x?.max ?? 0) >= 18 && (fit.x?.max ?? 99) <= 20, JSON.stringify(fit.x));
    assert.equal(fit.y?.min, 0);
    assert.ok((fit.y?.max ?? 0) >= 1 / (2 * Math.sqrt(2 * Math.PI)));
    const bars = SettingsManager.fromJSON(parseChartText('plot the binomial distribution with n = 6 and p = 0.5').data);
    const fitBars = fitSettings(bars, bars.createMathContext());
    assert.ok((fitBars.x?.min ?? 0) <= -0.4 && (fitBars.x?.max ?? 0) >= 6.4, JSON.stringify(fitBars));
});

test('probability: the export draws the area and the bars as coordinates', () => {
    const settings = SettingsManager.fromJSON(parseChartText('show x from -1 to 4 and y from 0 to 0.5\nplot the binomial distribution with n = 3 and p = 0.5\nshade P(X >= 2), labelled').data);
    const tex = settings.generateTikzCode(settings.createMathContext());
    assert.match(tex, /% PR1\n\\fill\[etOrange, fill opacity=0\.5, even odd rule\]\n\s*\(axis cs:1\.6,0\)/);
    assert.match(tex, /\$P\(X \\ge 2\) = 0\.5\$/);
});

test('probability: the recipes add a distribution, and a shaded probability under the one the chart has', () => {
    const ctx = { is3D: false, functions: [], tools: [] as Tool[], parameters: [] };
    const byId = (id: string) => recipes(false).find((r) => r.id === id);
    const normal = byId('normal-distribution')?.build(ctx);
    assert.ok(normal && normal.kind === 'tool' && normal.tool.type === 'distribution' && normal.tool.name === 'X1');
    const shade = byId('probability')?.build({ ...ctx, tools: normal && normal.kind === 'tool' ? [normal.tool] : [] });
    assert.ok(shade && shade.kind === 'tool' && shade.tool.type === 'probability' && shade.tool.distribution === 'X1' && shade.tool.event === '-1 <= X <= 1');
    const alone = byId('probability')?.build(ctx);
    assert.ok(alone && alone.kind === 'items' && alone.tools.length === 2);
});

test('probability: a region with a function called P stays a region', () => {
    const tools = parseChartText('plot P(x) = x\nshade P(x) >= max(0, y)').data.tools as Data[];
    assert.deepEqual(tools.map((t) => t.type), ['region']);
});
