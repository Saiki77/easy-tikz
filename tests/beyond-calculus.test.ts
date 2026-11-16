/*
 * Calculus (5.0): Riemann sums and the trapezoid rule (the numbers, the
 * definite integral, the lines of the chart language read and printed back,
 * the scene with its parts, label and problems, a slider for the number of
 * parts, the fit and the export), and slope fields with their solutions
 * (RK4, segments of one length on screen, a solution that follows its
 * point, `mark P at` kept on a rewrite).
 */
import { test, assert, near } from './_lib';
import { integral, riemannSum, solveOde } from '../src/beyond/maths';
import { parseChartText } from '../src/text/parse';
import { printChartText, writeChartText } from '../src/text/print';
import { canonical } from '../src/chartdata';
import { clean, setChartWords, NO_WORDS } from '../src/text/words';
import { SettingsManager } from '../src/settings';
import { computeScene2D, computeScene3D, labelMetricsFor, Scene2D } from '../src/scene';
import { fitSettings } from '../src/fit';
import { recipes } from '../src/migrate';
import { FunctionParameters, Tool } from '../src/types';

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
        polar: config.coordinateSystem === 'polar',
        labelMetrics: labelMetricsFor(10, 10),
        equalScale: config.equalScale,
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

// ------------------------------------------------------------ Riemann sums

test('riemann: left, right, middle sums and the trapezoid rule of x^2 on [0, 2]', () => {
    const f = (x: number) => x * x;
    // Left with 4 parts: 0.5 (0 + 0.25 + 1 + 2.25) = 1.75; right: 0.5 (0.25 + 1 + 2.25 + 4) = 3.75.
    near(riemannSum(f, 0, 2, 4, 'left').sum, 1.75, 1e-12);
    near(riemannSum(f, 0, 2, 4, 'right').sum, 3.75, 1e-12);
    near(riemannSum(f, 0, 2, 4, 'middle').sum, 2.625, 1e-12);
    near(riemannSum(f, 0, 2, 4, 'trapezoid').sum, 2.75, 1e-12);
    const left = riemannSum(f, 0, 2, 4, 'left').parts;
    assert.deepEqual(left[1], { x0: 0.5, x1: 1, y0: 0.25, y1: 0.25 });
    assert.equal(riemannSum(f, 0, 2, 3, 'left').parts[2].x1, 2);
    // A part with no value is left out, and the sum has no value.
    const broken = riemannSum((x) => (x > 1 ? NaN : x), 0, 2, 4, 'left');
    assert.equal(broken.parts.length, 3);
    assert.ok(Number.isNaN(broken.sum));
});

test('riemann: the definite integral', () => {
    near(integral((x) => x * x, 0, 2), 8 / 3, 1e-10);
    near(integral(Math.sin, 0, Math.PI), 2, 1e-10);
    near(integral(Math.exp, -1, 1), Math.E - 1 / Math.E, 1e-10);
    assert.ok(Number.isNaN(integral((x) => (x === 1 ? NaN : x), 0, 2)));
    // Over a pole it does not settle: no value, rather than a wrong one.
    assert.ok(Number.isNaN(integral((x) => 1 / (x - 3), 2.5, 4)));
    near(integral((x) => Math.sqrt(x), 0, 1), 2 / 3, 1e-8);
    assert.equal(integral((x) => x, 3, 3), 0);
});

test('riemann: the lines read and print back as the same chart', () => {
    assert.equal(
        roundTrip('plot $f(x) = x^2$\ndraw the left Riemann sum of f from 0 to 2 with 6 parts, labelled'),
        'plot f(x) = x^2\ndraw the left Riemann sum of f from 0 to 2 with 6 parts, labelled'
    );
    assert.equal(
        roundTrip('slider n from 1 to 40, starting at 6, in steps of 1\nplot g(x) = x^2/4 + 1\ndraw the trapezoid rule of g from 0 to 4 with n parts in red, thick, opacity 0.5'),
        'slider n from 1 to 40, starting at 6, in steps of 1\nplot g(x) = x^2/4 + 1\ndraw the trapezoid rule of g from 0 to 4 with n parts in red, thick, opacity 0.5'
    );
    assert.equal(roundTrip('plot f(x) = sin(x)\ndraw the middle Riemann sum of f from 0 to $\\pi$ with 1 part, labelled "{sum:4}"'), 'plot f(x) = sin(x)\ndraw the middle Riemann sum of f from 0 to $\\pi$ with 1 part, labelled "{sum:4}"');
    roundTrip('slider a from 0 to 3, starting at 1\nplot f(x) = exp(x)\ndraw the right Riemann sum of f from -a to a with 2a + 1 parts');
    const midpoint = parseChartText('plot f(x) = x\ndraw the midpoint Riemann sum of f from 0 to 1 with 4 parts').data.tools as Data[];
    assert.equal(midpoint[0].method, 'middle');
    assert.match(parseChartText('plot f(x) = x\ndraw the left Riemann sum of f from 0 to 1').problems[0].message, /^Write: draw the left Riemann sum of f from 0 to 2 with 6 parts/);
    assert.match(parseChartText('plot f(x) = x\ndraw the left Riemann sum of f from 0 to 1 with 4 parts, sparkly').problems[0].message, /unknown option "sparkly"; a Riemann sum takes/);
});

test('riemann: the lines in a person\'s own words', () => {
    setChartWords(clean({ words: { draw: ['zeichne'], 'the-left-riemann-sum-of': ['die linke Riemannsumme von'], from: ['von'], to: ['bis'], parts: ['Teilen'] }, bundles: [], write: 'yours' }));
    try {
        const text = 'plot f(x) = x^2\nzeichne die linke Riemannsumme von f von 0 bis 2 with 6 Teilen';
        const read = parseChartText(text);
        assert.deepEqual(read.problems, []);
        assert.equal(((read.data.tools as Data[])[0] as Data).method, 'left');
        assert.equal(printChartText(read.data), text);
    } finally {
        setChartWords(NO_WORDS);
    }
});

test('riemann: the parts, the label with the sum and the integral, the published sum', () => {
    const scene = sceneOf('show x from -0.5 to 2.5 and y from -0.5 to 4.5\nplot f(x) = x^2\ndraw the left Riemann sum of f from 0 to 2 with 4 parts, labelled');
    assert.deepEqual(scene.issues, []);
    const sum = scene.items[0];
    assert.equal(sum.fills[0].rings.length, 4);
    assert.deepEqual(sum.fills[0].rings[3], [
        { x: 1.5, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2.25 },
        { x: 1.5, y: 2.25 },
    ]);
    assert.ok(sum.strokes[0].closed);
    assert.equal(sum.texts[0].text, '$L_{4} = 1.75$, $\\int_{0}^{2} f(x)\\,dx = 2.667$');
    near(scene.derived.RS1_val, 1.75, 1e-12);
});

test('riemann: a slider sets the number of parts', () => {
    const at = (n: number) => sceneOf(`slider n from 1 to 40, starting at ${n}, in steps of 1\nplot f(x) = x^2\ndraw the right Riemann sum of f from 0 to 2 with n parts`);
    assert.equal(at(6).items[0].fills[0].rings.length, 6);
    assert.equal(at(40).items[0].fills[0].rings.length, 40);
    near(at(40).derived.RS1_val, 8 / 3, 0.11);
});

test('riemann: problems name the field', () => {
    const issues = (text: string) => sceneOf(text).issues.map((i) => `${i.source}.${i.field ?? ''} ${i.severity}: ${i.message}`);
    assert.deepEqual(issues('draw the left Riemann sum of f from 0 to 2 with 4 parts'), ['RS1.function error: f does not exist']);
    assert.deepEqual(issues('plot c(t) = (cos(t), sin(t))\ndraw the left Riemann sum of c from 0 to 2 with 4 parts'), ['RS1.function error: c is not a function y = f(x)']);
    assert.deepEqual(issues('plot f(x) = x\ndraw the left Riemann sum of f from 0 to 2 with 0 parts'), ['RS1.parts error: The number of parts must be from 1 to 2000']);
    assert.deepEqual(issues('plot f(x) = x\ndraw the left Riemann sum of f from 2 to 0 with 4 parts'), ['RS1.to error: The start must be less than the end']);
    assert.deepEqual(issues('plot f(x) = sqrt(x)\ndraw the left Riemann sum of f from -1 to 1 with 4 parts'), ['RS1.function info: f has no value in some parts: the sum leaves them out']);
    assert.match(issues('plot f(x) = x\ndraw the left Riemann sum of f from 0 to b with 4 parts')[0], /^RS1\.to error: Unknown name 'b'/);
});

test('riemann: the fit holds the parts; the export draws them with the label', () => {
    const settings = SettingsManager.fromJSON(parseChartText('plot f(x) = x^2, from x = 0 to 3\ndraw the left Riemann sum of f from 0 to 3 with 3 parts, labelled').data);
    const math = settings.createMathContext();
    const fit = fitSettings(settings, math);
    assert.ok((fit.y?.max ?? 0) >= 9 && fit.y?.min === 0, JSON.stringify(fit));
    settings.setValue('xmin', '-0.5');
    settings.setValue('xmax', '3.5');
    settings.setValue('ymin', '-1');
    settings.setValue('ymax', '10');
    const tex = settings.generateTikzCode(settings.createMathContext());
    assert.match(tex, /% RS1\n\\fill\[etOrange, fill opacity=0\.35, even odd rule\]/);
    assert.match(tex, /\$L_\{3\} = 5\$, \$\\int_\{0\}\^\{3\} f\(x\)\\,dx = 9\$/);
});

test('riemann: the recipe takes the chart\'s function and puts the number of parts on a slider n', () => {
    const fn = { name: 'f', expression: 'x^2', domain: '' } as FunctionParameters;
    const recipe = recipes(false).find((r) => r.id === 'riemann-sum');
    const built = recipe?.build({ is3D: false, functions: [fn], tools: [] as Tool[], parameters: [] });
    assert.ok(built && built.kind === 'items');
    if (built && built.kind === 'items') {
        assert.deepEqual(built.parameters, [{ name: 'n', value: 6, min: 1, max: 40, step: 1 }]);
        assert.deepEqual(built.functions, []);
        const sum = built.tools[0];
        assert.ok(sum.type === 'riemann' && sum.function === 'f' && sum.parts === 'n' && sum.valueLabel);
    }
    const alone = recipe?.build({ is3D: false, functions: [], tools: [] as Tool[], parameters: [{ name: 'n', value: 1, min: 0, max: 5, step: 1 }] });
    assert.ok(alone && alone.kind === 'items' && alone.functions?.length === 1 && alone.parameters?.length === 0);
    if (alone && alone.kind === 'items') assert.ok(alone.tools[0].type === 'riemann' && alone.tools[0].function === alone.functions?.[0].name && alone.tools[0].parts === '6');
});

// ------------------------------------------------------------- slope fields

test('slope field: RK4 follows the exact solution, forwards and backwards, and stops where it turns vertical', () => {
    // y' = y through (0, 1) is e^x.
    const exp = solveOde((_x, y) => y, 0, 1, { xmin: -2, xmax: 2, ylo: -100, yhi: 100 }, 0.01, 0.01);
    assert.ok(exp[0].x <= -2 + 1e-9 && exp[exp.length - 1].x >= 2 - 1e-9);
    for (const p of exp) near(p.y, Math.exp(p.x), 1e-6 * Math.exp(p.x) + 1e-9);
    // It leaves the band: y' = y^2 through (0, 1) is 1 / (1 - x), which blows up at x = 1.
    const blow = solveOde((_x, y) => y * y, 0, 1, { xmin: -2, xmax: 2, ylo: -10, yhi: 10 }, 0.01, 0.01);
    const last = blow[blow.length - 1];
    assert.ok(last.x < 1 && last.y > 10, JSON.stringify(last));
    // y' = -x/y through (0, 1) is the upper half of the unit circle: it ends at the x-axis.
    const circle = solveOde((x, y) => -x / y, 0, 1, { xmin: -4, xmax: 4, ylo: -6, yhi: 6, maxSlope: 1000 }, 0.02, 0.01);
    for (const p of circle) near(Math.hypot(p.x, p.y), 1, 1e-3);
    assert.ok(circle[0].x < -0.999 && circle[circle.length - 1].x > 0.999);
});

test('slope field: the lines read and print back; mark P at keeps its form when P moves', () => {
    assert.equal(roundTrip("draw the slope field of $y' = x - y$\nmark P at (1, 2)\ndraw the solution through P"), "draw the slope field of y' = x - y\nP: mark (1, 2)\ndraw the solution through P");
    assert.equal(roundTrip("draw the slope field of $y' = \\frac{x}{y}$ in blue, thick"), "draw the slope field of $y' = \\frac{x}{y}$ in blue, thick");
    assert.equal(((parseChartText('draw the slope field of dy/dx = x y').data.tools as Data[])[0] as Data).expression, 'x y');
    assert.equal(((parseChartText('draw the slope field of \\frac{dy}{dx} = x').data.tools as Data[])[0] as Data).expression, 'x');
    roundTrip('draw the slope field of y\' = sin(x y), density=30\ndraw the solutions through (0, 1), (0, -1) and (1, 0.5) in blue, dashed');
    roundTrip("SF1: draw the slope field of y' = x\ndraw the slope field of y' = -x\ndraw the solution of SF1 through (1, 1)\ndraw the solution through (2, 0)");
    const tools = parseChartText("draw the slope field of y' = x\ndraw the slope field of y' = -x\ndraw the solution through (2, 0)").data.tools as Data[];
    assert.equal(tools[2].field, 'SF2');
    assert.match(parseChartText('draw the solution through P').problems[0].message, /"the solution" needs a slope field above it/);
    assert.match(parseChartText("draw the slope field of y' = x\ndraw the solution through").problems[0].message, /^Write: draw the solution through P/);
    // A name after the points may be a points tool defined further down; words that are no name are options.
    assert.match(parseChartText("draw the slope field of y' = x\ndraw the solution through (1, 2), very sparkly").problems[0].message, /unknown option "very sparkly"; a solution takes/);
    // A drag moves P: the line keeps the form it was written in.
    const block = "draw the slope field of $y' = x - y$\nmark P at (1, 2)\ndraw the solution through P";
    const data = parseChartText(block).data;
    ((data.tools as Data[])[1] as Data).points = '(1.5, 2)';
    assert.equal(writeChartText(block, data), "draw the slope field of $y' = x - y$\nmark P at (1.5, 2)\ndraw the solution through P");
    ((data.tools as Data[])[1] as Data).color = 'blue';
    assert.equal(writeChartText(block, data), "draw the slope field of $y' = x - y$\nmark P at (1.5, 2) in blue\ndraw the solution through P");
});

test('slope field: segments of one length on screen, with the slope at their middle', () => {
    const scene = sceneOf("show x from -3 to 3 and y from -30 to 30\ndraw the slope field of y' = x - y/10");
    assert.deepEqual(scene.issues, []);
    const lines = scene.items[0].strokes[0].lines;
    assert.ok(lines.length >= 200 && lines.length <= 600, String(lines.length));
    // In pt of a 10 x 10 cm figure: the view is 6 by 60 units.
    const m = labelMetricsFor(10, 10);
    const ux = m.w / 6;
    const uy = m.h / 60;
    const lengths = lines.map(([a, b]) => Math.hypot((b.x - a.x) * ux, (b.y - a.y) * uy));
    for (const len of lengths) near(len, lengths[0], 1e-9);
    for (const [a, b] of lines.slice(0, 50)) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        near((b.y - a.y) / (b.x - a.x), mx - my / 10, 1e-9);
    }
    // With equal scale the units are the same both ways.
    const equal = sceneOf("show x from -3 to 3 and y from -1 to 1\nequal scale\ndraw the slope field of y' = 1").items[0].strokes[0].lines;
    for (const [a, b] of equal) near(b.y - a.y, b.x - a.x, 1e-12);
});

test('slope field: the solution through a points tool follows the point', () => {
    const at = (p: string) => sceneOf(`show x from -3 to 3 and y from -3 to 3\ndraw the slope field of y' = y\nmark P at ${p}\ndraw the solution through P`);
    const a = at('(0, 1)').items[2].strokes[0].lines[0];
    const b = at('(0, 2)').items[2].strokes[0].lines[0];
    const y0 = (line: { x: number; y: number }[]) => line.reduce((best, p) => (Math.abs(p.x) < Math.abs(best.x) ? p : best)).y;
    near(y0(a), 1, 1e-9);
    near(y0(b), 2, 1e-9);
    // Several points, a points tool with several points, and one outside the view horizontally.
    const many = sceneOf("show x from -3 to 3 and y from -3 to 3\ndraw the slope field of y' = -y\nmark (0, 1), (0, -1)\ndraw the solutions through P1 and (-5, 1)");
    assert.equal(many.items[2].strokes[0].lines.length, 3);
});

test('slope field: problems, the fit, the export and the recipes', () => {
    const issues = (text: string) => sceneOf(text).issues.map((i) => `${i.source}.${i.field ?? ''} ${i.severity}: ${i.message}`);
    assert.match(issues("draw the slope field of y' = x + q")[0], /^SF1\.expression error: Unknown name 'q'/);
    assert.deepEqual(issues("R1: shade where x >= 0\ndraw the slope field of y' = x\nraw tool {\"type\": \"solution\", \"name\": \"Y1\", \"field\": \"R1\", \"through\": \"(0, 0)\"}"), ['Y1.field error: R1 is not a slope field']);
    assert.deepEqual(issues("draw the slope field of y' = x\nR1: shade where x >= 0\ndraw the solution through R1"), ['Y1.through error: \'R1\' is not a points tool']);
    // A slope field and its solutions never set the ranges: a chart of them alone is unbounded.
    const settings = SettingsManager.fromJSON(parseChartText("draw the slope field of y' = x\ndraw the solution through (0, 0)").data);
    assert.equal(fitSettings(settings, settings.createMathContext()).nothing, 'unbounded');
    const tex = SettingsManager.fromJSON(parseChartText("show x from -2 to 2 and y from -2 to 2\ndraw the slope field of y' = x\ndraw the solution through (0, 0)").data);
    const code = tex.generateTikzCode(tex.createMathContext());
    assert.match(code, /% SF1\n\\draw\[etGray, thin\]/);
    assert.match(code, /% Y1\n\\draw\[etRed, thick\]/);
    const byId = (id: string) => recipes(false).find((r) => r.id === id);
    const ctx = { is3D: false, functions: [], tools: [] as Tool[], parameters: [] };
    const field = byId('slope-field')?.build(ctx);
    assert.ok(field && field.kind === 'tool' && field.tool.type === 'slopeField' && field.tool.expression === 'x - y');
    const solution = byId('solution')?.build(ctx);
    assert.ok(solution && solution.kind === 'items');
    if (solution && solution.kind === 'items') {
        assert.deepEqual(solution.tools.map((t) => [t.type, t.name]), [
            ['slopeField', 'SF1'],
            ['points', 'P'],
            ['solution', 'Y1'],
        ]);
        const y = solution.tools[2];
        assert.ok(y.type === 'solution' && y.field === 'SF1' && y.through === 'P');
    }
});

test('slope field: the lines in a person\'s own words, and every new kind names itself in a 3D chart', () => {
    setChartWords(clean({ words: { draw: ['zeichne'], 'the-slope-field-of': ['das Richtungsfeld von'], 'the-solution-through': ['die Lösung durch'] }, bundles: [], write: 'yours' }));
    try {
        const text = "zeichne das Richtungsfeld von y' = x - y\nmark P at (1, 2)\nzeichne die Lösung durch P";
        const read = parseChartText(text);
        assert.deepEqual(read.problems, []);
        assert.deepEqual((read.data.tools as Data[]).map((t) => t.type), ['slopeField', 'points', 'solution']);
        assert.equal(printChartText(read.data), "zeichne das Richtungsfeld von y' = x - y\nP: mark (1, 2)\nzeichne die Lösung durch P");
    } finally {
        setChartWords(NO_WORDS);
    }
    const settings = SettingsManager.fromJSON(
        parseChartText("3d\nplot f(x) = x\ndraw the left Riemann sum of f from 0 to 1 with 2 parts\ndraw the slope field of y' = x\ndraw the solution through (0, 0)\nplot the normal distribution with mean 0 and sd 1").data
    );
    const math = settings.createMathContext();
    const scene3 = computeScene3D({ tools: settings.toRendererConfig(math).tools, math, view: { xmin: -1, xmax: 1, ymin: -1, ymax: 1, zmin: -1, zmax: 1 } });
    assert.deepEqual(scene3.issues.map((i) => i.source), ['RS1', 'SF1', 'Y1', 'X1']);
});
