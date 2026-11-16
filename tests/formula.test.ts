// Every formula in a note is a chart (src/formula.ts, src/ui/formulaHover.ts):
// what a formula draws, its letters as sliders, the view fitted to it, the
// formula at the cursor, and the formulas of a section in order.
import { test, assert } from './_lib';
import { formulaAt, formulaChart, formulaLines, formulasIn, freeNames, chartable, formulaRows, applyFormulaDefault } from '../src/formula';
import { parseChartText } from '../src/text/parse';

test('formula: what each kind of formula draws', () => {
    const kinds: Array<[string, string, string]> = [
        ['f(x) = \\frac{1}{2}x^2 - 2', 'function', 'plot $f(x) = \\frac{1}{2}x^2 - 2$ in blue, thick'],
        ['y = 2x + 1', 'function', 'plot $f(x) = 2x + 1$ in blue, thick'],
        ['\\sqrt{x}', 'function', 'plot $f(x) = \\sqrt{x}$ in blue, thick'],
        ['z = x^2 - y^2', 'surface', 'plot $z = x^2 - y^2$ in viridis'],
        ['r = 1 + \\cos\\theta', 'polar', 'plot $r(\\theta) = 1 + \\cos\\theta$ in blue, thick'],
        ['x^2 + y^2 = 1', 'equation', 'draw $x^2 + y^2 = 1$ in blue, thick'],
        ['x + y \\le 4', 'region', 'shade where $x + y \\le 4$'],
    ];
    for (const [tex, kind, line] of kinds) {
        const f = formulaLines(tex);
        assert.ok(f, tex);
        assert.equal(f.kind, kind, tex);
        assert.equal(f.lines[f.lines.length - 1], line, tex);
    }
});

test('formula: the letters of a formula become sliders, read as LaTeX reads them', () => {
    assert.deepEqual(freeNames('a x^2 + b x + c'), ['a', 'b', 'c']);
    assert.deepEqual(freeNames('e^{-k x}\\sin(\\omega x)'), ['k', 'omega']);
    const f = formulaLines('f(x) = ax^2 + bx + c');
    assert.ok(f);
    assert.deepEqual(f.lines.slice(0, 3), ['slider a from -5 to 5, starting at 1', 'slider b from -5 to 5, starting at 1', 'slider c from -5 to 5, starting at 1']);
    assert.equal(f.lines[3], 'plot $f(x) = a x^2 + b x + c$ in blue, thick');
});

test('formula: the whole chart parses, with a view fitted to what it draws', () => {
    for (const tex of ['f(x) = \\frac{1}{2}x^2 - 2', 'x^2 + y^2 = 1', 'z = x^2 - y^2', 'r = 1 + \\cos\\theta', 'y = ax^2 + b', 'g(x)=|x-1|.']) {
        const lines = formulaChart(tex);
        assert.ok(lines, tex);
        assert.ok(lines[0].startsWith('show x from '), lines[0]);
        assert.deepEqual(parseChartText(lines.join('\n')).problems, [], `${tex}: ${lines.join(' / ')}`);
    }
    assert.equal(formulaChart('x^2 + y^2 = 1')?.[0], 'show x from -1.2 to 1.2 and y from -1.2 to 1.2');
    assert.equal(formulaChart('2 = 3 = 4'), null);
});

test('formula: the formula at the cursor, and the formulas of a section in order', () => {
    assert.deepEqual(formulaAt('The function $f(x) = x^2$ and $g$.', 16), { tex: 'f(x) = x^2', from: 13, to: 25 });
    assert.equal(formulaAt('costs \\$5 and $x$', 15)?.tex, 'x');
    assert.equal(formulaAt('no formula here', 3), null);
    const text = 'A $a$, code `$b$` and $$\nc = 1\n$$ then $d$';
    assert.deepEqual(formulasIn(text).map((f) => f.tex), ['a', 'c = 1', 'd']);
});

test('formula: only formulas with a chart are marked, also in x_1, x_2 and in optimisation problems', () => {
    const kinds: Array<[string, string]> = [
        ['y = ax^2 + b', 'function'],
        ["f'(x) = 2x", 'function'],
        ['-e^x', 'function'],
        ['(x-3)^2 + (x+1)^2', 'function'],
        ['-x_1', 'function'],
        ['2x_1^2 + x_2^2 - 2x_2 + 1', 'surface'],
        ['x_1^2 + x_2^2 - 2x_1x_2 + 1', 'surface'],
        ['-x_1x_2', 'surface'],
        ['f(x_1, x_2) = x_1^2 + 3x_2^2', 'surface'],
        ['\\underbrace{min}_{x \\in R^2} \\quad (x_1-3)^4 + 4(x_1-3)^2x_2^2 + 4x_2^4', 'surface'],
        ['\\min_{x \\in \\mathbb{R}^2} \\sqrt{(x_1-1)^2 + (x_2+2)^2 + 4}', 'surface'],
        ['z = x^2 - y^2', 'surface'],
        ['x^2 + y^2 = 4', 'equation'],
        ['x + y \\le 4', 'region'],
        ['r = 1 + \\cos\\theta', 'polar'],
        ['f(x) = \\min(x^2, 1)', 'function'],
    ];
    for (const [tex, kind] of kinds) {
        assert.equal(chartable(tex), true, tex);
        assert.equal(formulaLines(tex)?.kind, kind, tex);
    }
    // x_1 x_2 is x times y, written for the chart.
    assert.ok((formulaLines('-x_1x_2')?.lines ?? []).includes('plot $z = -x y$ in viridis'));
    // An equivalence draws both sides, each in its own colour.
    const both = formulaLines('\\underbrace{min}_{x\\in R} \\ln(x^2 - 6x + 10) \\iff \\underbrace{min}_{x \\in R} x^2 - 6x + 10')?.lines ?? [];
    assert.deepEqual(both, ['plot $f(x) = \\ln(x^2 - 6x + 10)$ in blue, thick', 'plot $g(x) = x^2 - 6x + 10$ in red, thick']);
    for (const tex of [
        'E = mc^2',
        '\\frac{1}{2}',
        'a^2 + b^2 = c^2',
        '\\sum_{k=1}^{n} k',
        'n = 5',
        'n \\geq 3',
        'a',
        'x',
        '-1',
        '',
        'f^{(n)}(x) = 0',
        "f(x) = f(a) + \\frac{f'(a)}{1!}(x-a) + \\frac{f''(a)}{2!}(x-a)^2",
        '\\begin{pmatrix} 2 & 0 \\\\ 0 & 1 \\end{pmatrix}',
        'f(x) = x^\\top A x + b^\\top x + c',
        '\\nabla f(x) = (A + A^\\top)x + b',
        'x_1^2 + x_2^2 + x_3^2 - 2x_1 + 4x_3',
        '-x_1x_2x_3',
    ]) {
        assert.equal(chartable(tex), false, tex);
    }
});

test('formula: Unicode signs, values, inverses, rows of a block and lists of definitions', () => {
    // Σ, a word such as für: no chart. · is a product.
    assert.equal(chartable('f(x) = Σ a_n·(x-a)^n'), false);
    assert.equal(chartable('1/(1-x) = Σ x^n für |x| < 1'), false);
    assert.deepEqual(formulaLines('x · e^{-x}')?.kind, 'function');
    // f(x) = y names a value; the inverse at y is no chart; f^{-1}(x) = ... defines one.
    assert.equal(chartable('f(x) = y'), false);
    assert.equal(chartable('f^{-1}(y) = x'), false);
    assert.equal(formulaLines('f^{-1}(x) = \\frac{x-3}{2}')?.kind, 'function');
    // An aligned block: each row, or all rows together.
    const block = "\\begin{aligned} f(x) &= 3x^3 + 12x, \\\\ f'(x) &= 9x^2 + 12, \\end{aligned}";
    assert.deepEqual(formulaRows(block), ['f(x)  = 3x^3 + 12x,', "f'(x)  = 9x^2 + 12,"]);
    assert.deepEqual(formulaLines(block, 1)?.lines, ['plot $f(x) = 9x^2 + 12$ in blue, thick']);
    assert.equal(formulaLines(block)?.lines.length, 2);
    // A matrix and cases are no rows of formulas.
    assert.deepEqual(formulaRows('\\begin{pmatrix} 4x_1 \\\\ 2x_2 - 2 \\end{pmatrix}').length, 1);
    assert.equal(chartable('\\begin{cases} x^2 & x \\ge 0 \\\\ -x & x < 0 \\end{cases}'), false);
    // Two definitions in one line: both drawn.
    assert.equal(formulaLines('f(x) = 3x^3 + 12x, \\quad g(x) = x^3 - 3x^2 + 2x')?.lines.length, 2);
    // A limit is no chart.
    assert.equal(chartable('\\lim_{x \\to 0} \\frac{1-\\cos x}{x^2} = \\frac{1}{2}'), false);
});

test('formula: identities, conditions, the imaginary unit, arc functions and rows with gaps', () => {
    // An identity holds everywhere: its curve would be rounding noise. No chart.
    const identities = ['\\ln(x \\cdot y) = \\ln(x) + \\ln(y)', '\\cos(x+y) = \\cos(x)\\cos(y) - \\sin(x)\\sin(y)', '\\ln(e^x) = x', 'e^{\\ln x} = x', 'e^x = \\frac{1}{e^{-x}}', '\\frac{1}{\\cos^2(x)} = 1 + \\tan^2(x)'];
    assert.deepEqual(identities.filter((tex) => chartable(tex)), []);
    // A curve that is there draws; a point (x^2 + y^2 = 0) does not.
    assert.equal(chartable('x^2 + y^2 = 4'), true);
    assert.equal(chartable('x = 3'), true);
    assert.equal(chartable('x^2 + y^2 = 0'), false);
    // A condition on x alone is no region; i alone is the imaginary unit.
    assert.equal(chartable('x > 0'), false);
    assert.equal(chartable('|x| < 1'), false);
    assert.equal(chartable('y \\ge x^2'), true);
    assert.equal(chartable('e^{i(x+y)} = e^{ix} \\cdot e^{iy}'), false);
    // Arc functions and powers of functions.
    assert.equal(chartable('\\arcsin(x)'), true);
    assert.equal(chartable('\\arctan x'), true);
    assert.equal(chartable('\\cos^2(x)'), true);
    // Rows: an empty row between keeps its place (MathJax draws it), a last \\ adds none.
    const block = '\\begin{aligned} f(x) &= x^2 \\\\ \\\\ \\lim_{x \\to 0} x = 0 \\\\ g(x) &= x^3 \\\\ \\end{aligned}';
    assert.equal(formulaRows(block).length, 4);
    assert.deepEqual([0, 1, 2, 3].map((r) => chartable(block, r)), [true, false, false, true]);
});

test('formula: a 2D default chart keeps the cube of surfaces and the colours of further functions', () => {
    // Save as default stores every setting: the 3D view of a 2D default is untouched (Proportional).
    const def = { boxAspect: 'true', rotationX: 30, rotationZ: 45, zoom3D: 1, functions: [{ color: 'violet', thickness: 'very thick' }] };
    const surface = parseChartText((formulaChart('z = x^2 - y^2') ?? []).join('\n')).data;
    assert.equal(applyFormulaDefault(surface, def).boxAspect, 'equal');
    assert.equal(applyFormulaDefault(surface, { ...def, dimension: true }).boxAspect, 'true');
    const two = applyFormulaDefault(parseChartText((formulaChart('f(x) = x^2, \\quad g(x) = x^3') ?? []).join('\n')).data, def);
    const fns = two.functions as Array<{ color?: string; thickness?: string }>;
    assert.deepEqual(fns.map((f) => [f.color, f.thickness]), [['violet', 'very thick'], ['red', 'very thick']]);
});

test('formula: a formula in n, t or k charts against that letter', () => {
    // A sequence term: n from 0 to 20, the axis named n.
    const seq = formulaChart('\\frac{2n^2 + n + 1}{3n^2 + 2}') ?? [];
    assert.equal(seq[0].startsWith('show x from 0 to 20'), true);
    assert.equal(seq.includes('xlabel n'), true);
    assert.equal(seq[seq.length - 1], 'plot $f(x) = \\frac{2x^2 + x + 1}{3x^2 + 2}$ in blue, thick');
    // a_n = ... is a function of n; s(t) = ... of t, with g a slider.
    assert.equal(chartable('a_n = \\frac{1}{n}'), true);
    assert.equal(formulaChart('s(t) = \\frac{1}{2} g t^2')?.includes('xlabel t'), true);
    // A value or a condition in n, and letters without a variable, are no charts.
    assert.deepEqual(['n = 5', 'n > 0', 'a + b', 'm \\cdot v'].map((tex) => chartable(tex)), [false, false, false, false]);
});
