// 6.2.1: the hover-card bugs that an audit of a real note on optimisation
// found (linear programs in x_1 and x_2, Big-M constraints, intervals with
// fraction ends). One test per issue, with the formulas as the note writes
// them: the card builders (src/notes6/hover.ts, src/formula.ts), the
// spellings and the card kind of Smart (src/notes6/recognize), and the set
// label of the scene (src/notes6/scene.ts).
import { test, assert } from './_lib';
import { parseChartText } from '../src/text/parse';
import { SettingsManager } from '../src/settings';
import { computeScene2D, labelMetricsFor, Scene2D } from '../src/scene';
import { generateTikz2D } from '../src/export';
import { hoverCard, hoverKind, isEmptyPair } from '../src/notes6/hover';
import { axisVariable, namedSetLabel } from '../src/notes6/sets';
import { chartable, formulaChart, formulaLines } from '../src/formula';
import { definedFunctions, productsOf, spellings } from '../src/notes6/recognize/adapt';
import { rulesMark, smartChart, smartLinear, smartMark, smartNotes6 } from '../src/notes6/recognize/decide';

/** The scene of chart lines, as the card draws it (the axis names reach the scene). */
function sceneOf(lines: string[]): Scene2D {
    const parsed = parseChartText(lines.join('\n'));
    assert.deepEqual(parsed.problems, [], lines.join(' / '));
    const settings = SettingsManager.fromJSON(parsed.data);
    const math = settings.createMathContext({ memo: false });
    const config = settings.toRendererConfig(math);
    return computeScene2D({
        functions: config.functions,
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: { nx: 120, ny: 120 },
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(8, 5.5),
        axisNames: { x: config.xLabel, y: config.yLabel },
    });
}

/** The texts a scene writes (labels as TeX). */
const textsOf = (scene: Scene2D) => scene.items.flatMap((it) => (it.texts ?? []).map((t) => t.text));

/** The bar and end dots a set on the x-axis draws. */
const barOf = (scene: Scene2D) => ({
    strokes: scene.items.flatMap((it) => it.strokes ?? []).length,
    markers: scene.items.flatMap((it) => it.markers ?? []).length,
});

test('issue 1: a condition in a subscripted or Greek variable draws its ray on an axis named after it (x_1, not \\x_1)', () => {
    for (const [tex, v, set] of [
        ['x_1 \\ge \\tfrac18', 'x_1', '[0.125, \\infty)'],
        ['x_2 \\ge 0', 'x_2', '[0, \\infty)'],
        ['x_1 \\le 4', 'x_1', '(-\\infty, 4]'],
        ['\\ x_1 \\le 4', 'x_1', '(-\\infty, 4]'],
        ['x_{1} \\le 4', 'x_1', '(-\\infty, 4]'],
        ['\\alpha_1 \\ge 0', '\\alpha_1', '[0, \\infty)'],
        ['\\lambda \\le 1', '\\lambda', '(-\\infty, 1]'],
    ]) {
        assert.equal(hoverKind(tex), 'condition', tex);
        const card = hoverCard(tex, new Map());
        assert.ok(card, tex);
        assert.equal(card.variable, v, tex);
        assert.ok(card.lines.includes(`xlabel $${v}$`), card.lines.join(' / '));
        assert.ok(!card.lines.some((l) => l.includes('\\x_')), card.lines.join(' / '));
        // The condition is in x, the axis' own letter: the set draws.
        const mark = card.lines.find((l) => l.startsWith('mark where'));
        assert.ok(mark && !/x_|\\alpha|\\lambda/.test(mark), mark);
        const scene = sceneOf(card.lines);
        assert.deepEqual(scene.issues, [], tex);
        const bar = barOf(scene);
        assert.ok(bar.strokes >= 1 && bar.markers >= 1, `${tex}: ${JSON.stringify(bar)}`);
        // The label names the set with the formula's variable.
        const label = textsOf(scene).join(' ');
        assert.ok(label.startsWith(`$\\{${v} \\mid`) && label.includes(set), `${tex}: ${label}`);
    }
    // An end beyond -4 to 4 shows: x_1 <= 6 frames x from -4 to 7.
    assert.equal(hoverCard('x_1 \\le 6', new Map())?.lines[0], 'show x from -4 to 7');
    assert.equal(hoverCard('x_1 \\le \\tfrac{13}{3}', new Map())?.lines[0], 'show x from -4 to 6');
    // Plain conditions keep their card.
    assert.deepEqual(hoverCard('x > 0', new Map())?.lines, ['show x from -4 to 4', 'mark where $x > 0$ on the x-axis, labelled']);
});

test('issue 4: a goal after the objective, (x-1)^2 + 2 \\to \\min, opens the function card', () => {
    for (const tex of ['(x-1)^2 + 2 \\to \\min', '(x-1)^2 + 2 \\to \\max', '(x-1)^2 + 2 \\rightarrow \\min', '(x-1)^2 + 2 \\longrightarrow \\max', '(x-1)^2 + 2 \\to \\text{min}']) {
        const f = formulaLines(tex);
        assert.ok(f, tex);
        assert.equal(f.kind, 'function', tex);
        assert.deepEqual(f.lines, ['plot $f(x) = (x-1)^2 + 2$ in blue, thick'], tex);
        assert.equal(chartable(tex), true, tex);
        assert.equal(smartChart(tex, undefined, tex, 'function')?.kind, 'function', tex);
        assert.equal(smartMark(tex, undefined, tex, 'function'), true, tex);
    }
    // A limit keeps no chart: \to there is no goal.
    assert.equal(formulaLines('\\lim_{x \\to 0} x'), null);
});

test('issue 5: a letter before a bracket that is no function of the note is a product (x \\le b + M(1 - y)); calls stay calls', () => {
    assert.equal(productsOf('x \\le b + M(1 - y)'), 'x \\le b + M \\cdot (1 - y)');
    assert.equal(productsOf('x \\ge a - M(1 - y)'), 'x \\ge a - M \\cdot (1 - y)');
    assert.equal(productsOf('y = 2 + a(x - 1)'), 'y = 2 + a \\cdot (x - 1)');
    // Calls: f, g, h, a bracket of names alone, built-ins and longer names, names the note defines, numbers before a bracket.
    for (const tex of ['f(x) + 1', 'g(t) = 2t', 'f(x+1) \\le 2', 'M(x) + 1', 'F(K, L)', '\\sin(x) + \\max(x, 1)', 'x \\le -2 + 6(1 - y)', '\\left( x \\right)']) assert.equal(productsOf(tex), tex, tex);
    assert.equal(productsOf('y = M(1 - x)', new Set(['M'])), 'y = M(1 - x)');
    assert.deepEqual([...definedFunctions(['M(x) = x^2', 'A = \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}', 'g(x) = 2x'])], ['M', 'g']);
    for (const tex of ['x \\le b + M(1 - y)', 'x \\ge a - M(1 - y)']) {
        const card = smartChart(tex, undefined, tex, 'region', new Set());
        assert.ok(card, tex);
        assert.equal(card.kind, 'region', tex);
        assert.ok(card.lines.includes('slider M from -5 to 5, starting at 1'), card.lines.join(' / '));
        assert.equal(smartMark(tex, undefined, tex, 'region', new Set()), true, tex);
        // A note that defines M as a function: its call is no product.
        assert.equal(smartChart(tex, undefined, tex, 'region', new Set(['M'])), null, tex);
    }
    // The as-written formula of the same table keeps its card.
    assert.equal(smartChart('x \\le b + M\\,y', undefined, 'x \\le b + M\\,y', 'region')?.kind, 'region');
    // Rules stays 6.1: no product there.
    assert.equal(rulesMark('x \\le b + M(1 - y)', undefined, 'x \\le b + M(1 - y)'), false);
    assert.ok(spellings('x \\le b + M(1 - y)', 'region').some((s) => s.tex === 'x \\le b + M \\cdot (1 - y)'));
});

test('issue 6: a bare pair of equal or reversed numbers, (1,1), is a point: no interval card; (0, 1) and x \\in (0, 1) keep theirs', () => {
    // Empty or a single point: equal ends, reversed ends.
    for (const tex of ['(1,1)', '(0,0)', '(3{,}5;\\ 3{,}5)', '(2, 1)', '(3,0)', '[2, 1]', '(1, 1]', '(\\tfrac83, \\tfrac43)']) {
        assert.equal(isEmptyPair(tex), true, tex);
        assert.equal(hoverKind(tex), null, tex);
        assert.equal(hoverCard(tex, new Map()), null, tex);
        // Smart: no spelling makes it an interval.
        assert.equal(smartNotes6(tex, 'interval', new Map()), null, tex);
        assert.equal(rulesMark(tex, undefined, tex), false, tex);
    }
    // A real interval keeps its card when the network says interval (the words around it decide, as gold does).
    for (const tex of ['(0, 1)', '(-1,1)', '(-2, 2)', '(1, 2)', '(\\tfrac43, \\tfrac83)', '[1, 1]', 'x \\in (0, 1)', '[1, 2]', '(0, \\infty)', '(a, b]', '\\lambda \\in [0,1]']) {
        assert.equal(isEmptyPair(tex), false, tex);
        assert.ok(smartNotes6(tex, 'interval', new Map()), tex);
    }
    assert.equal(hoverKind('(0, 1)'), 'interval');
});

test('issue 8: the card is of the kind the network gives (a = x \\cdot y labelled surface is the surface z = x y), the same rule for every builder', () => {
    const tex = 'a = x \\cdot y';
    const surface = smartChart(tex, undefined, tex, 'surface');
    assert.ok(surface);
    assert.equal(surface.kind, 'surface');
    assert.ok(surface.lines.includes('plot $z = x \\cdot y$ in viridis'), surface.lines.join(' / '));
    assert.ok(!surface.lines.some((l) => l.startsWith('slider a')), surface.lines.join(' / '));
    // Labelled implicit, the same formula is the curve x y = a with its slider.
    assert.equal(smartChart(tex, undefined, tex, 'implicit')?.kind, 'equation');
    // Without a spelling of the label's kind, the builder's kind shows (f(x) = x^2 labelled surface stays a function).
    assert.equal(smartChart('f(x) = x^2', undefined, 'f(x) = x^2', 'surface')?.kind, 'function');
    // The other builders: the interval of \lambda \in [0, 1] labelled interval; det of a written matrix is det.
    assert.equal(smartNotes6('\\lambda \\in [0,1]', 'interval', new Map())?.kind, 'interval');
    assert.equal(smartLinear('\\det \\begin{pmatrix} 2 & 1 \\\\ 0 & 1 \\end{pmatrix}', 'det', new Map())?.kind, 'det');
    assert.equal(smartLinear('A = \\begin{pmatrix} 2 & 1 \\\\ 0 & 1 \\end{pmatrix}', 'matrix', new Map())?.kind, 'matrix');
});

test('issue 15: an interval with fraction ends is framed around its ends; \\lambda \\in [0,1] is the set of lambda', () => {
    assert.equal(hoverCard('x \\in [-\\tfrac12, 1]', new Map())?.lines[0], 'show x from -1.25 to 1.75');
    assert.equal(hoverCard('x \\in [-\\tfrac12, 2]', new Map())?.lines[0], 'show x from -1.75 to 3.25');
    assert.equal(hoverCard('x \\in [0, \\tfrac{13}{3}]', new Map())?.lines[0], 'show x from -2.16667 to 6.5');
    // Number ends as before.
    assert.equal(hoverCard('x \\in [-4, 4]', new Map())?.lines[0], 'show x from -8 to 8');
    // The set label: the formula's own letter.
    const lambda = hoverCard('\\lambda \\in [0,1]', new Map());
    assert.ok(lambda);
    assert.deepEqual(textsOf(sceneOf(lambda.lines)), ['$\\{\\lambda \\mid 0 \\le {\\lambda} \\le 1\\} = [0, 1]$']);
    const a = hoverCard('a \\in [0,1]', new Map());
    assert.ok(a);
    assert.deepEqual(textsOf(sceneOf(a.lines)), ['$\\{a \\mid 0 \\le {a} \\le 1\\} = [0, 1]$']);
    // An axis named x, or a name that is no variable, keeps {x | ...}.
    assert.deepEqual(textsOf(sceneOf(['show x from -1 to 2', 'mark where $x \\in [0, 1]$ on the x-axis, labelled'])), ['$\\{x \\mid 0 \\le x \\le 1\\} = [0, 1]$']);
    assert.deepEqual(textsOf(sceneOf(['show x from -1 to 2', 'xlabel Zeit in s', 'mark where $x \\in [0, 1]$ on the x-axis, labelled'])), ['$\\{x \\mid 0 \\le x \\le 1\\} = [0, 1]$']);
    assert.equal(axisVariable('$\\lambda$'), '\\lambda');
    assert.equal(axisVariable('$x_{1}$'), 'x_{1}');
    assert.equal(axisVariable('t'), 't');
    assert.equal(axisVariable('Preis'), null);
    assert.equal(axisVariable('$f(x)$'), null);
    assert.equal(namedSetLabel('x', '$t$', 'x > 0', []), '$\\{t \\mid {t} > 0\\} = \\emptyset$');
    // The export writes the same label.
    const settings = SettingsManager.fromJSON(parseChartText(lambda.lines.join('\n')).data);
    const tikz = generateTikz2D(settings, settings.createMathContext({ memo: false }));
    assert.ok(tikz.includes('\\{\\lambda \\mid 0 \\le {\\lambda} \\le 1\\}'), tikz);
});

test('region and curve cards name their axes after x_1 and x_2 (as math)', () => {
    for (const tex of ['x_1 + x_2 \\le 7', '3x_1 + x_2 = 14', 'x_2 \\le -\\tfrac54 x_1 + 5', '\\lvert x_1 - x_2\\rvert \\le 3']) {
        const chart = formulaChart(tex);
        assert.ok(chart, tex);
        assert.ok(chart.includes('xlabel $x_1$') && chart.includes('ylabel $x_2$'), `${tex}: ${chart.join(' / ')}`);
        const parsed = parseChartText(chart.join('\n'));
        assert.deepEqual(parsed.problems, [], tex);
        assert.equal(parsed.data.axis_label_x, '$x_1$', tex);
        assert.equal(parsed.data.axis_label_y, '$x_2$', tex);
    }
    // A surface in x_1, x_2 and a function of x_1 too; formulas in x and y keep x and y.
    assert.ok(formulaChart('x_1 x_2')?.includes('ylabel $x_2$'));
    assert.ok(formulaChart('x_1^2')?.includes('xlabel $x_1$'));
    assert.ok(!formulaChart('x + y \\le 4')?.some((l) => /^[xy]label/.test(l)));
    // A Greek letter with a subscript as a slider: -\alpha_1 <= x_1 + x_2 <= \alpha_1 labelled region has its card.
    const alpha = '-\\alpha_1 \\le x_1 + x_2 \\le \\alpha_1';
    assert.equal(smartChart(alpha, undefined, alpha, 'region')?.kind, 'region');
});
