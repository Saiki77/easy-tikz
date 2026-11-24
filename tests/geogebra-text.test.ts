/*
 * GeoGebra lines (6.0 G), the chart language: GeoGebra input lines read as
 * chart objects, printed back as written, in Full LaTeX, kept when a block
 * is rewritten; and the lines that look alike but were something else
 * before (a curve a = x^2 + y^2 with a slider a, y = 2x, the words' own
 * `line` and `polygon`) read as they did.
 */
import { test, assert } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText, printFullText } from '../src/text/print';
import { canonical } from '../src/chartdata';
import { valueDefinitions } from '../src/values/defs';

type Data = Record<string, unknown>;

function read(text: string): { data: Data; problems: string[] } {
    const out = parseChartText(text);
    return { data: out.data, problems: out.problems.map((p) => `${p.line}:${p.column} ${p.message}`) };
}

function tools(text: string): Data[] {
    const r = read(text);
    assert.deepEqual(r.problems, [], text);
    return (r.data.tools as Data[]) ?? [];
}

/** Read, print in words and in Full LaTeX, read both back: the same chart. */
function roundTrip(text: string, expected = text): string {
    const { data, problems } = read(text);
    assert.deepEqual(problems, [], text);
    const printed = printChartText(data);
    assert.equal(printed, expected);
    assert.equal(canonical(read(printed).data), canonical(data), 'words read back the same');
    const full = printFullText(data);
    assert.ok(!full.includes('\\raw'), full);
    assert.equal(canonical(read(full).data), canonical(data), `Full LaTeX reads back the same:\n${full}`);
    return full;
}

const CONSTRUCTION = [
    'A = (1, 2)',
    'B = (4, 1)',
    'c = Circle(A, 3)',
    's = Segment(A, B)',
    'L = Sequence((k, k^2), k, 1, 10)',
    'C = Curve(cos(t), sin(2t), t, 0, 2pi)',
    'p = Polygon(A, B, (2, 4))',
    'v = Vector(A, B)',
    'M = {{1, 2}, {3, 4}}',
    'l = Line(A, B)',
    'q = Ray(A, B)',
    'T = Text("hello", A)',
    'c2 = Translate(c, v)',
    'P = Rotate(B, pi/2, A)',
    'k = Dilate(p, 2, A)',
    'm = Reflect(p, l)',
].join('\n');

test('GeoGebra input lines are GeoGebra tools that keep their text', () => {
    const t = tools(CONSTRUCTION);
    assert.deepEqual(
        t.map((x) => [x.type, x.name, x.command]),
        CONSTRUCTION.split('\n').map((l) => {
            const [name, command] = l.split(' = ');
            return ['geogebra', name, command];
        })
    );
    assert.ok(t.every((x) => x.named === true));
});

test('a construction prints back as written, and in Full LaTeX as \\geogebra lines', () => {
    const full = roundTrip(CONSTRUCTION);
    assert.match(full, /\\geogebra\{c = Circle\(A, 3\)\}/);
    assert.match(full, /\\geogebra\{M = \{\{1, 2\}, \{3, 4\}\}\}/);
});

test('the screenshot lines: bare commands are named G1, G2 and print bare', () => {
    const text = ['c = -0.4 + 0.6ί', 'IterationList(z^2 + c, z, {0 + 0ί}, 20)', 'Z_0 = (1, 0.5)', 'IterationList(z - (z^3 - 1) / (3z^2), z, {Z_0}, 30)'].join('\n');
    const t = tools(text);
    assert.deepEqual(
        t.map((x) => [x.name, x.named]),
        [
            ['c', true],
            ['G1', false],
            ['Z_0', true],
            ['G2', false],
        ]
    );
    roundTrip(text);
    roundTrip('KeepIf(abs(Element(IterationList(z^2 + c, z, {0 + 0i}, 20), 21)) <= 2, c, {0, 0.5, -1})');
});

test('options after a GeoGebra line, in words and in Full LaTeX', () => {
    const t = tools('A = (1, 2), large, no label\ns = Segment(A, (3, 4)) in red, thick, dashed\np = Polygon(A, (3, 1), (2, 4)), opacity 0.3, labelled\nL = Sequence((k, 1), k, 1, 3), small, hidden');
    assert.deepEqual(
        t.map((x) => [x.name, x.color ?? '', x.thickness ?? '', x.dashed ?? false, x.size ?? '', x.fillOpacity ?? -1, x.nameLabel ?? 'auto', x.hidden ?? false]),
        [
            ['A', '', '', false, 'large', -1, 'hidden', false],
            ['s', 'red', 'thick', true, '', -1, 'auto', false],
            ['p', '', '', false, '', 0.3, 'shown', false],
            ['L', '', '', false, 'small', -1, 'auto', true],
        ]
    );
    const full = roundTrip('A = (1, 2), large, no label\ns = Segment(A, (3, 4)) in red, thick, dashed\np = Polygon(A, (3, 1), (2, 4)), opacity 0.3, labelled');
    assert.match(full, /\\geogebra\[red, thick, dashed\]\{s = Segment\(A, \(3, 4\)\)\}/);
    assert.match(full, /\\geogebra\[large, no label\]\{A = \(1, 2\)\}/);
    assert.match(read('A = (1, 2), opacity 2').problems.join('\n'), /opacity 2/);
});

test('a = Slider(0, 5) is a slider that prints back as written while it is at its low end', () => {
    const r = read('a = Slider(0, 5)\nb = Slider(-1, 1, 0.5)\nC = Curve(a cos(t), b sin(t), t, 0, 2pi)');
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.data.parameters, [
        { name: 'a', value: 0, min: 0, max: 5, step: 0.1, geogebra: true },
        { name: 'b', value: -1, min: -1, max: 1, step: 0.5, geogebra: true },
    ]);
    roundTrip('a = Slider(0, 5)\nb = Slider(-1, 1, 0.5)\nC = Curve(a cos(t), b sin(t), t, 0, 2pi)');
    // Moved off its low end, the line keeps the value after it.
    const moved = { ...r.data, parameters: [{ name: 'a', value: 2, min: 0, max: 5, step: 0.1, geogebra: true }] };
    assert.equal(printChartText(moved).split('\n')[0], 'a = Slider(0, 5), starting at 2');
    roundTrip('a = Slider(0, 5), starting at 2\nC = Curve(a cos(t), sin(t), t, 0, 2pi)');
    assert.match(read('a = Slider(5, 0)').problems.join('\n'), /Slider takes numbers, the smaller first/);
});

test('old lines read as before: a curve with a slider name, y = 2x, r = 2, the words of line and polygon', () => {
    assert.deepEqual(tools('slider a from 0 to 2\na = x^2 + y^2').map((x) => [x.type, x.equation]), [['curve', 'a = x^2 + y^2']]);
    assert.deepEqual(read('y = 2x').data.functions, [{ name: 'f1', expression: '2x' }]);
    assert.deepEqual(read('polygon (0,0), (1,1), (1,0)').data.tools, [{ type: 'segment', name: 'S1', dim: 2, path: '(0,0); (1,1); (1,0)', closed: true }]);
    assert.equal(tools('f(x) = x^2').length, 0, 'f(x) = ... stays a function');
    // A formula in x and y without a command stays the curve it was.
    assert.deepEqual(tools('k = x^2 + y').map((x) => x.type), ['curve']);
    // A named curve (colon) stays a curve.
    assert.deepEqual(tools('c: x^2 + y^2 = 4').map((x) => [x.type, x.name]), [['curve', 'c']]);
});

test('GeoGebra values and functions of x are definitions of the chart, objects are not', () => {
    const data = read('A = (1, 2)\nc = Circle(A, 3)\nf = x^2 - 2\ng = Derivative(f)\nL = Sequence(x^2, x, 1, 3)\nd = Translate(c, (1, 0))\nB = Translate(A, (1, 0))\nCircle(A, 1)').data;
    assert.deepEqual(
        valueDefinitions(data.tools).map((d) => [d.name, d.params.join(','), d.expression]),
        [
            ['A', '', '(1, 2)'],
            ['f', 'x', 'x^2 - 2'],
            ['g', 'x', 'Derivative(f)'],
            ['L', '', 'Sequence(x^2, x, 1, 3)'],
            ['B', '', 'Translate(A, (1, 0))'],
        ]
    );
});

test('a GeoGebra name twice, or a name that a slider has, is a problem; a name may be used above its line', () => {
    assert.match(read('A = (1, 2)\nA = (3, 4)').problems.join('\n'), /2:1 .*A/);
    assert.deepEqual(read('c = Circle(A, 3)\nA = (1, 2)').problems, []);
});

test('no built-in chart reads differently: only the GeoGebra guide and examples have GeoGebra lines', async () => {
    const { GUIDES, V6_EXAMPLES, showcaseExamples } = await import('../src/guides');
    const { EXAMPLES } = await import('../src/migrate');
    const charts: Array<[string, Data]> = [];
    for (const g of GUIDES) {
        charts.push([g.id, g.chart]);
        g.steps.forEach((s, i) => s.chart && charts.push([`${g.id} step ${i + 1}`, s.chart]));
    }
    for (const e of [...EXAMPLES, ...V6_EXAMPLES, ...showcaseExamples()]) charts.push([e.id, e.data]);
    const ggOwn = (id: string) => id.startsWith('geogebra');
    const found = charts.filter(([id, data]) => !ggOwn(id) && ((data.tools as Data[] | undefined) ?? []).some((t) => t.type === 'geogebra')).map(([id]) => id);
    assert.deepEqual(found, []);
    assert.ok(charts.some(([id, data]) => ggOwn(id) && ((data.tools as Data[] | undefined) ?? []).some((t) => t.type === 'geogebra')));
});
