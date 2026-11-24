/*
 * Linear algebra and complex maps (6.0 D), the chart text: the grid, the
 * basis vectors, transforms (matrices, literals, z ↦ f(z), (x, y) ↦ ...),
 * eigenvectors, the unit square (and its image), spans; in words and Full
 * LaTeX, read and printed back as the same chart, with their problems.
 */
import { test, assert } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText, printFullText } from '../src/text/print';
import { canonical } from '../src/chartdata';
import { recipes } from '../src/migrate';

type Data = Record<string, unknown>;

function roundTrip(text: string): string {
    const first = parseChartText(text);
    assert.deepEqual(first.problems, [], `problems in ${text}`);
    const printed = printChartText(first.data);
    const back = parseChartText(printed);
    assert.deepEqual(back.problems, [], `problems in the printed text:\n${printed}`);
    assert.equal(canonical(back.data), canonical(first.data), `printed:\n${printed}`);
    const full = printFullText(first.data);
    const fromFull = parseChartText(full);
    assert.deepEqual(fromFull.problems, [], `problems in Full LaTeX:\n${full}`);
    assert.equal(canonical(fromFull.data), canonical(first.data), `Full LaTeX:\n${full}`);
    return printed;
}

const tools = (d: Data): Data[] => (Array.isArray(d.tools) ? (d.tools as Data[]) : []);

test('the grid: auto, a range and steps, a colour', () => {
    let t = tools(parseChartText('draw the grid').data)[0];
    assert.equal(t.type, 'planeGrid');
    assert.equal(t.name, 'G1');
    t = tools(parseChartText('draw the grid from -1.5 to 1.5 in steps of 0.25 in red').data)[0];
    assert.equal(t.from, '-1.5');
    assert.equal(t.to, '1.5');
    assert.equal(t.spacing, '0.25');
    assert.equal(t.color, 'red');
    assert.equal(roundTrip('draw the grid from -1.5 to 1.5 in steps of 0.25 in red, thick'), 'draw the grid from -1.5 to 1.5 in steps of 0.25 in red, thick');
    assert.equal(roundTrip('draw the grid in steps of 0.5'), 'draw the grid in steps of 0.5');
    assert.equal(roundTrip('draw the grid'), 'draw the grid');
});

test('basis vectors, eigenvectors, spans', () => {
    assert.equal(roundTrip('draw the basis vectors'), 'draw the basis vectors');
    assert.equal(roundTrip('draw the basis vectors in blue, thin'), 'draw the basis vectors in blue, thin');
    const text = 'let A = [[1.5, 1], [0.5, 2]]\ndraw the eigenvectors of A, dashed, labelled';
    assert.equal(roundTrip(text), text);
    const e = tools(parseChartText(text).data)[1];
    assert.equal(e.type, 'eigenvectors');
    assert.equal(e.matrix, 'A');
    assert.equal(e.valueLabel, true);
    const span = 'let v = (1, 2)\nlet w = (2, -1)\ndraw the span of v and w, labelled';
    assert.equal(roundTrip(span), span);
    assert.equal(tools(parseChartText(span).data)[2].vectors, 'v; w');
    assert.equal(roundTrip('draw the span of $\\begin{pmatrix} 1 \\\\ 0 \\end{pmatrix}$ in red'), 'draw the span of $\\begin{pmatrix} 1 \\\\ 0 \\end{pmatrix}$ in red');
});

test('transform the plane by a matrix, a literal, z ↦ f(z), (x, y) ↦ (...)', () => {
    const lines = [
        'let A = [[1, 1], [0, 1]]',
        'draw the grid',
        'transform the plane by A',
        'transform the plane by $\\begin{pmatrix} 0 & -1 \\\\ 1 & 0 \\end{pmatrix}$',
        'transform the plane by $z \\mapsto z^2$',
        'transform the plane by $(x, y) \\mapsto (x + y, y)$',
        'transform the plane by [[2, 0], [0, 0.5]]',
    ];
    const text = lines.join('\n');
    assert.equal(roundTrip(text), text);
    const ts = tools(parseChartText(text).data).filter((t) => t.type === 'transform');
    assert.deepEqual(
        ts.map((t) => t.map),
        ['A', '\\begin{pmatrix} 0 & -1 \\\\ 1 & 0 \\end{pmatrix}', 'z \\mapsto z^2', '(x, y) \\mapsto (x + y, y)', '[[2, 0], [0, 0.5]]']
    );
    assert.deepEqual(
        ts.map((t) => t.name),
        ['T1', 'T2', 'T3', 'T4', 'T5']
    );
});

test('transform in steps: then before it, and space in 3D', () => {
    const text = 'let A = [[1.5, 1], [0.5, 2]]\ndraw the grid\ndraw the basis vectors\nthen transform the plane by A\nthen draw the eigenvectors of A, labelled';
    assert.equal(roundTrip(text), text);
    const t = tools(parseChartText(text).data);
    assert.equal(t[3].step, 1);
    assert.equal(t[4].step, 2);
    const space = '3d\nlet B = [[1, 0.5, 0], [0, 1, 0], [0, 0.5, 1.5]]\ndraw the grid\ndraw the basis vectors\nshade the unit cube, labelled\nthen transform space by B';
    const printed = roundTrip(space);
    assert.match(printed, /transform space by B/);
    assert.match(printed, /shade the unit cube, labelled/);
});

test('the unit square and its image, with labels and opacity', () => {
    const text = 'let A = [[2, 1], [0, 1]]\nshade the unit square, labelled "det A = {det(A)}"\ntransform the plane by A\nshade the image of the unit square, opacity 0.5, labelled';
    assert.equal(roundTrip(text), text);
    const t = tools(parseChartText(text).data);
    assert.equal(t[1].type, 'unitSquare');
    assert.equal(t[1].label, 'det A = {det(A)}');
    assert.equal(t[3].image, true);
    assert.equal(t[3].fillOpacity, 0.5);
});

test('Full LaTeX: the commands of 6.0 D', () => {
    const text = [
        'let A = [[1, 1], [0, 1]]',
        'draw the grid from -2 to 2 in steps of 0.5',
        'draw the basis vectors',
        'shade the unit square, labelled',
        'then transform the plane by A',
        'draw the eigenvectors of A, labelled',
        'draw the span of (1, 0) and (0, 1)',
    ].join('\n');
    roundTrip(text);
    const full = printFullText(parseChartText(text).data);
    assert.match(full, /\\draw\[grid, from=-2, to=2, spacing=0\.5\]/);
    assert.match(full, /\\draw\[basis vectors\]/);
    assert.match(full, /\\shade\[unit square, labelled\]/);
    assert.match(full, /\\then \\transform\{A\}/);
    assert.match(full, /\\draw\[eigenvectors, labelled\]\{A\}/);
    assert.match(full, /\\draw\[span\]\{\(1, 0\), \(0, 1\)\}/);
    const z = parseChartText('\\begin{chart}\n\\transform{z \\mapsto e^z}\n\\shade[unit square, image]\n\\end{chart}');
    assert.deepEqual(z.problems, []);
    assert.equal(tools(z.data)[0].map, 'z \\mapsto e^z');
    assert.equal(tools(z.data)[1].image, true);
});

test('problems: lines of 6.0 D written wrong, and a slider called transform', () => {
    const p = (text: string) => parseChartText(text).problems.map((x) => x.message);
    assert.equal(p('draw the eigenvectors').length, 1);
    assert.equal(p('draw the span').length, 1);
    assert.equal(p('transform the plane').length, 1);
    assert.equal(p('draw the grid sideways').length, 1);
    assert.equal(p('transform the plane by A, thick').length, 1);
    // `transform` stays a name for formulas.
    const r = parseChartText('slider transform from 0 to 2\ntransform + x = 3');
    assert.deepEqual(r.problems, []);
    assert.equal(tools(r.data)[0].type, 'curve');
});

test('+ Add: the Linear algebra recipes make charts that read back', () => {
    for (const is3D of [false, true]) {
        const list = recipes(is3D).filter((r) => r.section === 'Linear algebra');
        assert.equal(list.length, is3D ? 3 : 4);
        for (const r of list) {
            const res = r.build({ is3D, functions: [], tools: [], parameters: [] });
            assert.ok(res.kind === 'items' || res.kind === 'tool', r.id);
        }
    }
});
