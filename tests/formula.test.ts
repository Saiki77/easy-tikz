// Every formula in a note is a chart (src/formula.ts, src/ui/formulaHover.ts):
// what a formula draws, its letters as sliders, the view fitted to it, the
// formula at the cursor, and the formulas of a section in order.
import { test, assert } from './_lib';
import { formulaAt, formulaChart, formulaLines, formulasIn, freeNames, chartable } from '../src/formula';
import { parseChartText } from '../src/text/parse';

test('formula: what each kind of formula draws', () => {
    const kinds: Array<[string, string, string]> = [
        ['f(x) = \\frac{1}{2}x^2 - 2', 'function', 'plot $f(x) = \\frac{1}{2}x^2 - 2$ in blue, thick'],
        ['y = 2x + 1', 'function', 'plot $f(x) = 2x + 1$ in blue, thick'],
        ['\\sqrt{x}', 'function', 'plot $f(x) = \\sqrt{x}$ in blue, thick'],
        ['z = x^2 - y^2', 'surface', 'plot $z = x^2 - y^2$ in blue'],
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

test('formula: only formulas with a chart are marked (they use x, y, z, r or theta and read as a chart)', () => {
    for (const tex of ['y = ax^2 + b', 'f(x) = \\frac{1}{2}x^2 - 2', 'x + y \\le 4', 'z = x^2 - y^2', 'r = 1 + \\cos\\theta', 'x^2 + y^2 = 4', '\\sin x']) {
        assert.equal(chartable(tex), true, tex);
    }
    for (const tex of ['E = mc^2', '\\frac{1}{2}', 'a^2 + b^2 = c^2', '\\sum_{k=1}^{n} k', 'n = 5', '']) {
        assert.equal(chartable(tex), false, tex);
    }
});
