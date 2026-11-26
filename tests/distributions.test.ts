/*
 * 6.2.1 (issue #10): the t, chi-square, exponential, uniform, Poisson,
 * gamma and beta distributions: their numbers (checked against SciPy 1.15
 * and the usual table values), the lines of the chart language (read,
 * printed, read back, in Full LaTeX and in a person's own words), the
 * scene (curves, poles, areas, bars and their labels), the auto-fit, the
 * recipes and the export.
 */
import { test, assert, near } from './_lib';
import { betaDensity, chiSquare, densityProbability, exponential, gammaDensity, incompleteBeta, incompleteGamma, poissonPmf, studentT, uniform } from '../src/beyond/maths';
import { DISTRIBUTION_KINDS, KIND_FIELDS } from '../src/beyond/kinds';
import { parseChartText } from '../src/text/parse';
import { printChartText } from '../src/text/print';
import { wordsToFull } from '../src/text/full';
import { canonical } from '../src/chartdata';
import { clean, setChartWords, NO_WORDS, PIECES } from '../src/text/words';
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

const P = densityProbability;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------- numbers

test('distributions: the t distribution against SciPy and the t table', () => {
    near(P(studentT(5), -2, 2), 0.8980605211701418, 1e-14);
    near(P(studentT(1), -Infinity, 1), 0.75, 1e-14);
    near(P(studentT(30), -Infinity, 2.042), 0.9749856646719011, 1e-14);
    near(P(studentT(2.5), -Infinity, 0.7), 0.7282975284052259, 1e-14);
    near(P(studentT(1000), -Infinity, 1.96), 0.9748634075221256, 1e-12);
    // The right tail keeps its digits: P(X > 4) with df 5 and the 97.5 % point t = 2.5706.
    near(P(studentT(5), 4, Infinity) / 0.005161707740415726, 1, 1e-12);
    near(P(studentT(5), 2.570581835636314, Infinity), 0.025, 1e-13);
    near(studentT(5).pdf(0), 0.3796066898224944, 1e-14);
    near(studentT(5).cdf(-1) + studentT(5).sf(-1), 1, 1e-15);
    // Beyond 10^7 degrees of freedom it is the standard normal.
    near(P(studentT(1e9), -1, 1), 0.682689492137, 1e-6);
});

test('distributions: chi-square, exponential, gamma and the incomplete gamma function', () => {
    near(P(chiSquare(3), -Infinity, 7.815), 0.9500060970251161, 1e-14);
    near(P(chiSquare(3), 7.8147279032511765, Infinity), 0.05, 1e-13);
    near(P(chiSquare(10), 18.307, Infinity), 0.050000589091398075, 1e-13);
    near(P(chiSquare(1), -Infinity, 1), 0.6826894921370859, 1e-14);
    near(P(chiSquare(4), 2, 6), 0.5366106088714289, 1e-14);
    near(P(chiSquare(100), 150, Infinity) / 0.0009039320423540184, 1, 1e-12);
    near(chiSquare(3).pdf(1), 0.24197072451914337, 1e-14);
    assert.equal(chiSquare(1).pdf(0), Infinity);
    assert.equal(chiSquare(3).pdf(-1), 0);
    near(P(exponential(1), -Infinity, 1), 1 - Math.exp(-1), 1e-15);
    near(P(exponential(2), 3, Infinity), Math.exp(-6), 1e-17);
    near(P(gammaDensity(2, 1), -Infinity, 2), 0.5939941502901616, 1e-14);
    near(P(gammaDensity(0.5, 2), -Infinity, 0.1), 0.47291074313446196, 1e-14);
    near(P(gammaDensity(3, 0.5), 2, 8), 0.6815952973750615, 1e-14);
    const g = incompleteGamma(3, 2);
    near(g.p + g.q, 1, 1e-15);
    assert.deepEqual(incompleteGamma(2, 0), { p: 0, q: 1 });
});

test('distributions: uniform, beta and the incomplete beta function', () => {
    near(P(uniform(0, 4), 1, 2), 0.25, 1e-15);
    near(P(uniform(0, 4), -Infinity, 10), 1, 1e-15);
    assert.equal(uniform(0, 4).pdf(5), 0);
    near(P(betaDensity(2, 5), -Infinity, 0.5), 0.890625, 1e-14);
    near(P(betaDensity(0.5, 0.5), -Infinity, 0.1), 0.20483276469913345, 1e-14);
    near(P(betaDensity(30, 20), 0.5, 0.7), 0.8538090207187535, 1e-13);
    assert.equal(betaDensity(0.5, 2).pdf(0), Infinity);
    assert.equal(betaDensity(1, 3).pdf(0), 3);
    const b = incompleteBeta(2, 3, 0.4);
    near(b.p, 0.5248, 1e-14);
    near(b.p + b.q, 1, 1e-15);
});

test('distributions: the Poisson distribution sums to 1 and matches SciPy', () => {
    const pmf = poissonPmf(3);
    near(sum(pmf), 1, 1e-14);
    near(pmf[0] + pmf[1] + pmf[2], 0.4231900811268435, 1e-14);
    near(pmf[3], 0.22404180765538775, 1e-14);
    near(sum(pmf.slice(8)), 0.01190450385635739, 1e-14);
    near(sum(poissonPmf(100).slice(90, 111)), 0.7065164768589975, 1e-12);
    near(sum(poissonPmf(1000)), 1, 1e-12);
});

// ------------------------------------------------------------------- text

test('distributions: every kind reads, prints and reads back as the same chart', () => {
    const lines = [
        'plot the t distribution with df = 5',
        'plot the chi-square distribution with df = 3 in red',
        'plot the exponential distribution with rate 1.5, thick, dashed',
        'plot the uniform distribution from -1 to 2',
        'plot the Poisson distribution with mean 3, opacity 0.6',
        'plot the gamma distribution with shape 2 and rate 0.5',
        'plot the beta distribution with a = 2 and b = 5 in green',
    ];
    for (const line of lines) assert.equal(roundTrip(line), line);
    roundTrip('slider k from 1 to 30, starting at 5, in steps of 1\nplot the t distribution with df = k\nshade P(X >= 2), labelled');
    roundTrip('slider lambda from 0.5 to 10, starting at 3\nplot the Poisson distribution with mean lambda\nshade $P(X \\le 2)$, labelled "{p:4}"');
    roundTrip('plot the uniform distribution from $\\frac{1}{2}$ to 3\nshade P(1 < X < 2) in purple, pattern dots');
});

test('distributions: the other ways to write a kind and its parameters', () => {
    const tool = (line: string) => {
        const r = parseChartText(line);
        assert.deepEqual(r.problems, [], line);
        return (r.data.tools as Data[])[0];
    };
    const fields = (line: string) => {
        const t = tool(line);
        // A parameter written `name = number` may read as an option (a number): the chart stores it as text.
        return [t.kind, ...KIND_FIELDS[t.kind as keyof typeof KIND_FIELDS].map((f) => String(t[f]))];
    };
    assert.deepEqual(fields("plot the Student's t distribution with 7 degrees of freedom"), ['studentT', '7']);
    assert.deepEqual(fields('plot the Student t distribution with ν = 3'), ['studentT', '3']);
    assert.deepEqual(fields('plot the t-distribution with df 12'), ['studentT', '12']);
    assert.deepEqual(fields('plot the chi-squared distribution with k = 4'), ['chiSquare', '4']);
    assert.deepEqual(fields('plot the χ² distribution with 2 degrees of freedom'), ['chiSquare', '2']);
    assert.deepEqual(fields('plot the exponential distribution with λ = 0.5'), ['exponential', '0.5']);
    assert.deepEqual(fields('plot the exponential distribution with \\lambda = 2'), ['exponential', '2']);
    assert.deepEqual(fields('plot the uniform distribution with a = -1 and b = 1'), ['uniform', '-1', '1']);
    assert.deepEqual(fields('plot the poisson distribution with lambda = 4'), ['poisson', '4']);
    assert.deepEqual(fields('plot the gamma distribution with k = 3 and rate 2'), ['gamma', '3', '2']);
    assert.deepEqual(fields('plot the beta distribution with α = 0.5 and β = 0.5'), ['beta', '0.5', '0.5']);
    // `alpha = 3 and beta = 2` read like key = value options, but they are the gamma distribution's parameters.
    assert.deepEqual(fields('plot the gamma distribution with alpha = 3 and beta = 2 in red'), ['gamma', '3', '2']);
    assert.deepEqual(fields('plot the exponential distribution with lambda = 2'), ['exponential', '2']);
    // A kind with none of its parameters takes the defaults (df = 5).
    assert.equal(tool('plot the t distribution').kind, 'studentT');
    assert.equal(sceneOf('show x from -4 to 4 and y from 0 to 0.5\nplot the t distribution\nshade P(X <= 2), labelled').items[1].texts[0].text, '$P(X \\le 2) = 0.949$');
    const problem = (line: string) => parseChartText(line).problems.map((p) => p.message)[0];
    assert.equal(problem('plot the t distribution with mean 3'), 'Write: plot the t distribution with df = 5');
    assert.equal(problem('plot the uniform distribution between 0 and 1'), 'Write: plot the uniform distribution from 0 to 1');
    assert.match(problem('plot the exponential distribution with rate 2, sparkly'), /unknown option "sparkly"; a distribution takes/);
});

test('distributions: a shade line means the nearest distribution of any kind', () => {
    const tools = parseChartText('plot the t distribution with df = 5\nplot the normal distribution with mean 0 and sd 1\nshade P(X <= 1) of X1\nplot the Poisson distribution with mean 2\nshade P(X = 1)').data.tools as Data[];
    assert.deepEqual(tools.map((t) => [t.type, t.distribution]), [['distribution', undefined], ['distribution', undefined], ['probability', 'X1'], ['distribution', undefined], ['probability', 'X3']]);
});

test('distributions: Full LaTeX carries the lines over, as for the normal distribution', () => {
    const text = 'slider df from 1 to 30, starting at 5, in steps of 1\nplot the t distribution with df = df in blue\nshade P(-2 <= X <= 2), labelled\nplot the beta distribution with a = 2 and b = 5\nplot the Poisson distribution with mean 3';
    const full = wordsToFull(text);
    assert.ok(typeof full === 'string' && full.includes('\\plot[blue]{the t distribution with df = df}'), String(full));
    const back = parseChartText(full as string);
    assert.deepEqual(back.problems, []);
    assert.equal(canonical(back.data), canonical(parseChartText(text).data));
});

test('distributions: the new words are chart words (English only), and a person\'s own words read', () => {
    const ids = PIECES.map((p) => p.id);
    for (const id of ['the-t-distribution', 'the-chi-square-distribution', 'the-exponential-distribution', 'the-uniform-distribution', 'the-poisson-distribution', 'the-gamma-distribution', 'the-beta-distribution', 'df', 'rate', 'shape']) assert.ok(ids.includes(id), id);
    setChartWords(clean({ words: { plot: ['zeichne'], 'the-t-distribution': ['die t-Verteilung'], df: ['FG'], 'the-poisson-distribution': ['die Poisson-Verteilung'], 'with-mean': ['mit Mittelwert'] }, bundles: [], write: 'yours' }));
    try {
        const text = 'zeichne die t-Verteilung with FG = 4\nshade P(X > 2), labelled\nzeichne die Poisson-Verteilung mit Mittelwert 3';
        const read = parseChartText(text);
        assert.deepEqual(read.problems, []);
        const tools = read.data.tools as Data[];
        assert.deepEqual([tools[0].kind, tools[0].df, tools[2].kind, tools[2].lambda], ['studentT', '4', 'poisson', '3']);
        assert.equal(printChartText(read.data), text);
    } finally {
        setChartWords(NO_WORDS);
    }
});

// ------------------------------------------------------------------ scene

/** Every number of a scene item is finite: nothing of a pole reaches the renderers or the export. */
function finite(scene: Scene2D): boolean {
    return scene.items.every(
        (it) => it.strokes.every((s) => s.lines.every((l) => l.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))) && it.fills.every((f) => f.rings.every((r) => r.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))))
    );
}

test('distributions: each kind shades its probability and labels the right value', () => {
    const cases: Array<[string, string, string]> = [
        ['show x from -5 to 5 and y from 0 to 0.45\nplot the t distribution with df = 5', 'shade P(-2 <= X <= 2), labelled', '$P(-2 \\le X \\le 2) = 0.898$'],
        ['show x from 0 to 14 and y from 0 to 0.3\nplot the chi-square distribution with df = 3', 'shade P(X >= 7.815), labelled', '$P(X \\ge 7.815) = 0.05$'],
        ['show x from 0 to 5 and y from 0 to 1.1\nplot the exponential distribution with rate 1', 'shade P(X <= 1), labelled', '$P(X \\le 1) = 0.632$'],
        ['show x from -1 to 5 and y from 0 to 0.4\nplot the uniform distribution from 0 to 4', 'shade P(1 <= X <= 2), labelled', '$P(1 \\le X \\le 2) = 0.25$'],
        ['show x from -1 to 11 and y from 0 to 0.25\nplot the Poisson distribution with mean 3', 'shade P(X <= 2), labelled', '$P(X \\le 2) = 0.423$'],
        ['show x from 0 to 8 and y from 0 to 0.4\nplot the gamma distribution with shape 2 and rate 1', 'shade P(X <= 2), labelled', '$P(X \\le 2) = 0.594$'],
        ['show x from 0 to 1 and y from 0 to 2.6\nplot the beta distribution with a = 2 and b = 5', 'shade P(X <= 0.5), labelled', '$P(X \\le 0.5) = 0.891$'],
    ];
    for (const [dist, shade, label] of cases) {
        const scene = sceneOf(`${dist}\n${shade}`);
        assert.deepEqual(scene.issues, [], dist);
        const [d, area] = scene.items;
        assert.ok(d.strokes.length > 0 && area.fills.length === 1, dist);
        assert.equal(area.texts[0].text, label, dist);
        assert.ok(finite(scene), dist);
    }
});

test('distributions: the area lies under the curve and between the bounds', () => {
    const scene = sceneOf('show x from -5 to 5 and y from 0 to 0.45\nplot the t distribution with df = 5\nshade P(-2 <= X <= 2)');
    const ring = scene.items[1].fills[0].rings[0];
    assert.deepEqual([ring[0], ring[ring.length - 1]], [{ x: -2, y: 0 }, { x: 2, y: 0 }]);
    const curve = scene.items[0].strokes[0].lines[0];
    assert.deepEqual([curve[0].x, curve[curve.length - 1].x], [-5, 5]);
    near(Math.max(...curve.map((p) => p.y)), 0.3796066898224944, 1e-12);
    for (const p of ring.slice(1, -1)) near(p.y, studentT(5).pdf(p.x), 1e-12);
});

test('distributions: a pole is cut above the view, the uniform density is a box, Poisson bars sit at k', () => {
    const pole = sceneOf('show x from 0 to 6 and y from 0 to 1\nplot the chi-square distribution with df = 1\nshade P(X <= 0.5), labelled');
    assert.deepEqual(pole.issues, []);
    assert.ok(finite(pole));
    assert.ok(pole.items[0].strokes[0].lines.every((l) => l.every((p) => p.y <= 2 + 1e-9)), 'cut one view height above the view');
    assert.equal(pole.items[1].texts[0].text, '$P(X \\le 0.5) = 0.52$');
    assert.ok(pole.items[1].texts[0].y <= 1, 'the label over the pole stays inside the view');
    const box = sceneOf('show x from -1 to 3 and y from 0 to 1\nplot the uniform distribution from 0 to 2').items[0].strokes[0].lines[0];
    assert.deepEqual([box[0], box[1], box[box.length - 2], box[box.length - 1]], [{ x: 0, y: 0 }, { x: 0, y: 0.5 }, { x: 2, y: 0.5 }, { x: 2, y: 0 }]);
    const bars = sceneOf('show x from -1 to 9 and y from 0 to 0.3\nplot the Poisson distribution with mean 3\nshade P(2 <= X < 4)');
    assert.deepEqual(bars.items[1].fills[0].rings.map((r) => (r[0].x + r[1].x) / 2), [2, 3]);
    near(bars.derived.PR1_val, poissonPmf(3)[2] + poissonPmf(3)[3], 1e-15);
});

test('distributions: a slider moves the density and the label shows the new value', () => {
    const text = (df: number) => `show x from -5 to 5 and y from 0 to 0.45\nslider df from 1 to 30, starting at ${df}, in steps of 1\nplot the t distribution with df = df\nshade P(-2 <= X <= 2), labelled`;
    assert.equal(sceneOf(text(5)).items[1].texts[0].text, '$P(-2 \\le X \\le 2) = 0.898$');
    assert.equal(sceneOf(text(1)).items[1].texts[0].text, '$P(-2 \\le X \\le 2) = 0.705$');
    assert.equal(sceneOf(text(30)).items[1].texts[0].text, '$P(-2 \\le X \\le 2) = 0.945$');
});

test('distributions: problems name the field', () => {
    const issues = (text: string) => sceneOf(text).issues.map((i) => `${i.source}.${i.field ?? ''} ${i.severity}: ${i.message}`);
    assert.deepEqual(issues('plot the t distribution with df = 0'), ['X1.df error: The degrees of freedom df must be more than 0']);
    assert.deepEqual(issues('plot the chi-square distribution with df = -2'), ['X1.df error: The degrees of freedom df must be more than 0']);
    assert.deepEqual(issues('plot the exponential distribution with rate 0'), ['X1.rate error: The rate must be more than 0']);
    assert.deepEqual(issues('plot the uniform distribution from 2 to 1'), ['X1.to error: The uniform distribution needs a less than b: from a to b']);
    assert.deepEqual(issues('plot the Poisson distribution with mean 2000'), ['X1.lambda error: The mean λ must be more than 0 and at most 1000']);
    assert.deepEqual(issues('plot the gamma distribution with shape -1 and rate 1'), ['X1.shape error: The shape must be more than 0']);
    assert.deepEqual(issues('plot the beta distribution with a = 1 and b = 0'), ['X1.beta error: b must be more than 0']);
    assert.match(issues('plot the t distribution with df = q')[0], /^X1\.df error: Unknown name 'q'/);
});

test('distributions: the fit holds where most of the mass lies and the peak', () => {
    const fit = (text: string) => {
        const settings = SettingsManager.fromJSON(parseChartText(text).data);
        const f = fitSettings(settings, settings.createMathContext());
        return [f.x?.min, f.x?.max, f.y?.min, f.y?.max].map(Number);
    };
    const [tx0, tx1, ty0, ty1] = fit('plot the t distribution with df = 5');
    assert.ok(tx0 <= -5 && tx1 >= 5 && tx1 <= 7 && ty0 === 0 && ty1 >= 0.38 && ty1 <= 0.5, `t: ${[tx0, tx1, ty0, ty1]}`);
    const [cx0, cx1, , cy1] = fit('plot the chi-square distribution with df = 3');
    assert.ok(cx0 === 0 && cx1 >= 12 && cx1 <= 16 && cy1 >= 0.24 && cy1 <= 0.35, `chi-square: ${[cx0, cx1, cy1]}`);
    const [, ex1, , ey1] = fit('plot the exponential distribution with rate 2');
    assert.ok(ex1 >= 2.5 && ex1 <= 3.5 && ey1 >= 2 && ey1 <= 2.5, `exponential: ${[ex1, ey1]}`);
    const [ux0, ux1, , uy1] = fit('plot the uniform distribution from 0 to 4');
    assert.ok(ux0 <= -1 && ux1 >= 5 && uy1 >= 0.25 && uy1 <= 0.35, `uniform: ${[ux0, ux1, uy1]}`);
    const [px0, px1] = fit('plot the Poisson distribution with mean 3');
    assert.ok(px0 <= -0.4 && px1 >= 9 && px1 <= 13, `Poisson: ${[px0, px1]}`);
    const [bx0, bx1, , by1] = fit('plot the beta distribution with a = 2 and b = 5');
    assert.ok(bx0 === 0 && bx1 >= 1 && bx1 <= 1.2 && by1 >= 2.45 && by1 <= 3, `beta: ${[bx0, bx1, by1]}`);
    // A pole does not stretch the y range: chi-square with df = 1 stays below 1.
    const [, , , py1] = fit('plot the chi-square distribution with df = 1');
    assert.ok(py1 > 0.2 && py1 <= 1, `chi-square df 1: ${py1}`);
});

test('distributions: the recipes add each kind, and Probability as an area shades a fitting event', () => {
    const ctx = { is3D: false, functions: [], tools: [] as Tool[], parameters: [] };
    const byId = (id: string) => recipes(false).find((r) => r.id === id);
    const kinds: Record<string, string> = {
        't-distribution': 'studentT',
        'chi-square-distribution': 'chiSquare',
        'exponential-distribution': 'exponential',
        'uniform-distribution': 'uniform',
        'poisson-distribution': 'poisson',
        'gamma-distribution': 'gamma',
        'beta-distribution': 'beta',
    };
    for (const [id, kind] of Object.entries(kinds)) {
        const made = byId(id)?.build(ctx);
        assert.ok(made && made.kind === 'tool' && made.tool.type === 'distribution' && made.tool.kind === kind, id);
        if (!made || made.kind !== 'tool') continue;
        const shade = byId('probability')?.build({ ...ctx, tools: [made.tool] });
        assert.ok(shade && shade.kind === 'tool' && shade.tool.type === 'probability', id);
        if (!shade || shade.kind !== 'tool') continue;
        const data = { v: 4, tools: [made.tool, shade.tool] };
        const scene = sceneOf(printChartText(data));
        assert.deepEqual(scene.issues, [], id);
        assert.ok((scene.derived.PR1_val ?? 0) > 0.05, `${id}: ${scene.derived.PR1_val}`);
    }
    assert.equal(DISTRIBUTION_KINDS.length, 9);
});

test('distributions: the export draws the curves, areas and bars as coordinates with their labels', () => {
    const tex = (text: string) => {
        const s = SettingsManager.fromJSON(parseChartText(text).data);
        return s.generateTikzCode(s.createMathContext());
    };
    const t = tex('show x from -5 to 5 and y from 0 to 0.45\nplot the t distribution with df = 5\nshade P(-2 <= X <= 2), labelled');
    assert.match(t, /% X1\n\\draw\[etBlue, thin\]\n\s*\(axis cs:-5,/);
    assert.match(t, /% PR1\n\\fill\[etOrange, fill opacity=0\.5, even odd rule\]\n\s*\(axis cs:-2,0\)/);
    assert.match(t, /\$P\(-2 \\le X \\le 2\) = 0\.898\$/);
    const pole = tex('show x from 0 to 6 and y from 0 to 1\nplot the chi-square distribution with df = 1');
    assert.ok(!/inf|nan/i.test(pole.slice(pole.indexOf('% X1'))), 'no infinite coordinate');
    const bars = tex('show x from -1 to 10 and y from 0 to 0.3\nplot the Poisson distribution with mean 3\nshade P(X >= 5) in red, labelled');
    assert.match(bars, /\(axis cs:4\.6,0\)/);
    assert.match(bars, /\$P\(X \\ge 5\) = 0\.185\$/);
});
