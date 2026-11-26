/*
 * The chart look (6.1, src/look.ts): what charts store when they leave
 * their look open, how old complete JSON dumps are read, that the text
 * syntax prints the same in both looks, the clean look's export (axes,
 * edges, grid, numbers, lines, dots, pills, names) and that Classic gives
 * the export of 6.0 exactly. pdflatex compiles the clean look in
 * tests/latex.test.ts.
 */
import { test, assert } from './_lib';
import { SettingsManager } from '../src/settings';
import { parseChartText } from '../src/text/parse';
import { printChartText } from '../src/text/print';
import { readBlock } from '../src/blockjson';
import { minimize } from '../src/chartdata';
import { applyFormulaDefault } from '../src/formula';
import { AUTO, ChartLook, TickObstacles, cleanTickSpots, resolveLook, setChartLook, settleLook, tickClear } from '../src/look';
import type { NoteTable } from '../src/beyond/table';

function withLook<T>(look: ChartLook, fn: () => T): T {
    setChartLook(look);
    try {
        return fn();
    } finally {
        setChartLook('clean');
    }
}

function settings(text: string, table?: NoteTable): SettingsManager {
    const parsed = parseChartText(text);
    assert.deepEqual(parsed.problems, [], text);
    const s = SettingsManager.fromJSON(parsed.data);
    if (table) s.noteTable = table;
    return s;
}

function tikz(text: string, look: ChartLook = 'clean', table?: NoteTable): string {
    return withLook(look, () => settings(text, table).generateTikzCode());
}

/** The value of `key={...}` in the axis options, braces matched. */
function option(code: string, key: string): string | null {
    const at = code.search(new RegExp(`(?:^|[\\s,])${key}=\\{`, 'm'));
    if (at < 0) return null;
    const start = code.indexOf('{', code.indexOf(`${key}=`, at)) + 1;
    let depth = 1;
    for (let i = start; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}' && --depth === 0) return code.slice(start, i);
    }
    return null;
}

/** The tick labels of an axis as written: '' where the number is left out. */
function tickLabels(code: string, axis: 'x' | 'y'): Array<[string, string]> {
    const ticks = (option(code, `${axis}tick`) ?? '').split(',');
    const labels: string[] = [];
    const raw = option(code, `${axis}ticklabels`) ?? '';
    let depth = 0;
    let cur = '';
    for (const c of raw) {
        if (c === '{' && depth++ === 0) continue;
        if (c === '}' && --depth === 0) {
            labels.push(cur);
            cur = '';
            continue;
        }
        if (depth > 0) cur += c;
    }
    return ticks.map((t, i) => [t, labels[i] ?? '?']);
}

const PARABOLA = ['show x from -4 to 4 and y from -5 to 5', 'slider a from 0.5 to 2, starting at 1', 'plot f(x) = a x^2 - 4 in blue', 'mark where $f(x) = 0$ on the x-axis, labelled'].join('\n');

/** The export of PARABOLA by 6.0.0 (346975a). */
const PARABOLA_600 = String.raw`\documentclass[border=5pt]{standalone}
\usepackage{pgfplots}
\pgfplotsset{compat=1.16}
\begin{document}
\begin{tikzpicture}
\definecolor{etBlue}{HTML}{3498DB}
\definecolor{etTeal}{HTML}{1ABC9C}
\begin{axis}[
  width=10cm, height=10cm,
  xlabel={x}, ylabel={y},
  xmin=-4, xmax=4, ymin=-5, ymax=5,
  trig format plots=rad,
  unbounded coords=jump,
  restrict x to domain=-84:84, restrict y to domain=-105:105,
  clip mode=individual,
]
% f
\addplot[etBlue, thin, domain=-4:4, samples=300, forget plot] {(1*(x^2))-4};
% AX1
\addplot[only marks, mark=*, mark size=2pt, etTeal, mark options={draw=white, line width=0.4pt}, forget plot] coordinates {(-2,0) (2,0)};
% AX1
\node[etTeal, anchor=south, font=\footnotesize] at (axis cs:0,0) {$\{x \mid f(x) = 0\} = \{-2, 2\}$};
\end{axis}
\end{tikzpicture}
\end{document}`;

// ------------------------------------------------------------ what charts store

test('a new chart leaves its look open: axis_style and showLargeGrid auto, functions without a thickness', () => {
    const data = new SettingsManager().serialize();
    assert.equal(data.axis_style, AUTO);
    assert.equal(data.showLargeGrid, AUTO);
    assert.equal(data.look, AUTO);
    const parsed = SettingsManager.fromJSON(parseChartText('plot f(x) = x^2').data).serialize();
    assert.equal((parsed.functions as Array<{ thickness: string }>)[0].thickness, '');
    // Written in the text, they are the chart's own.
    const own = SettingsManager.fromJSON(parseChartText('axes in a box\nno grid\nplot f(x) = x^2, thin').data).serialize();
    assert.equal(own.axis_style, 'box');
    assert.equal(own.showLargeGrid, false);
    assert.equal((own.functions as Array<{ thickness: string }>)[0].thickness, 'thin');
});

test('the text prints no line for the clean defaults, the same in both looks, and reads back the same', () => {
    const texts = [
        'plot f(x) = x^2 - 4',
        ['show x from -4 to 4 and y from -5 to 5', 'slider a from 0.5 to 2, starting at 1', 'plot f(x) = a x^2 - 4 in blue', 'mark where f(x) = 0 on the x-axis, labelled'].join('\n'),
        ['axes in a box', 'plot f(x) = x^2, thin'].join('\n'),
        ['show x from 0 to 5 and y from 0 to 4', 'axes on the edges', 'no grid', 'plot f(x) = sin(x), thick'].join('\n'),
        ['axes in the middle', 'with a grid', 'grid opacity 0.22', 'plot f(x) = x'].join('\n'),
        ['with a minor grid', 'xlabel time', 'plot f(x) = x'].join('\n'),
    ];
    for (const text of texts) {
        const data = SettingsManager.fromJSON(parseChartText(text).data).serialize();
        const clean = withLook('clean', () => printChartText(data));
        const classic = withLook('classic', () => printChartText(data));
        assert.equal(clean, classic, text);
        assert.equal(clean, text, 'a chart in text reads back as it was written');
        assert.ok(!/axis_style|showLargeGrid|look|auto/.test(clean), clean);
    }
    // The editor's whole chart prints only what it draws.
    const editor = new SettingsManager();
    editor.setValue('functions', [{ name: 'f', expression: 'x^2' }]);
    assert.equal(printChartText(editor.serialize()), 'plot f(x) = x^2');
});

test('settleLook: a complete JSON dump from before 6.1 reads its stored defaults as open; 6.1 dumps and partial blocks keep theirs', () => {
    // A JSON block the 6.0 editor wrote: every field, the defaults too (no look key).
    const old = new SettingsManager().serialize();
    delete old.look;
    Object.assign(old, { axis_style: 'box', showLargeGrid: false, functions: [{ name: 'f', expression: 'x^2', thickness: 'thin' }, { name: 'g', expression: 'x', thickness: 'thick' }] });
    const settled = settleLook(old);
    assert.equal(settled.axis_style, AUTO);
    assert.equal(settled.showLargeGrid, AUTO);
    assert.deepEqual((settled.functions as Array<{ thickness: string }>).map((f) => f.thickness), ['', 'thick']);
    // Its other choices stay: middle axes, a grid.
    assert.equal(settleLook({ ...old, axis_style: 'middle', showLargeGrid: true }).axis_style, 'middle');
    assert.equal(settleLook({ ...old, axis_style: 'middle', showLargeGrid: true }).showLargeGrid, true);
    // A 6.1 dump (it has the look key) keeps an explicit box.
    const chosen = { ...old, look: AUTO };
    assert.strictEqual(settleLook(chosen), chosen);
    // A partial block (by hand or an AI) keeps it too.
    const partial = { v: 4, axis_style: 'box', functions: [{ name: 'f', expression: 'x^2', thickness: 'thin' }] };
    assert.strictEqual(settleLook(partial), partial);
    // Through a note's JSON block.
    const block = readBlock(JSON.stringify(old));
    assert.ok(typeof block !== 'string');
    const read = SettingsManager.fromJSON(block.data);
    assert.equal(read.resolvedLook().axisStyle, 'middle');
    assert.equal(read.resolvedLook().gridMajor, true);
    assert.equal(withLook('classic', () => read.resolvedLook().axisStyle), 'box');
    // The editor writes it back with the look key: its own choice stays from then on.
    const again = read.serialize();
    again.axis_style = 'box';
    assert.equal(SettingsManager.fromJSON(again).resolvedLook().axisStyle, 'box');
    // minimize of an old dump leaves no defaults and no look key.
    const min = minimize(old);
    assert.ok(!('axis_style' in min) && !('showLargeGrid' in min) && !('look' in min), JSON.stringify(min));
});

test('the default chart for formulas: its own choices win over the clean look, its stored defaults do not', () => {
    const chart = parseChartText('show x from -5 to 5\nplot f(x) = x^2').data;
    const saved = new SettingsManager().serialize();
    delete saved.look;
    Object.assign(saved, { axis_style: 'box', showLargeGrid: false, size_x_cm: 12, functions: [{ name: 'f', expression: 'x', thickness: 'thin', color: 'red' }] });
    const out = applyFormulaDefault(chart, saved);
    assert.equal(out.axis_style, AUTO, 'a box saved because it was the default leaves the look open');
    assert.equal(out.size_x_cm, 12);
    assert.equal((out.functions as Array<{ color: string; thickness: string }>)[0].color, 'red');
    const own = applyFormulaDefault(chart, { ...saved, look: AUTO, axis_style: 'box', showLargeGrid: true });
    assert.equal(own.axis_style, 'box', 'a default saved with 6.1 keeps its box');
    assert.equal(own.showLargeGrid, true);
});

// ------------------------------------------------------------ resolving the look

test('resolveLook: open fields take the look; a box, polar and 3D charts draw as Classic', () => {
    const open = { axisStyle: AUTO, grid: AUTO, polar: false, is3D: false };
    assert.deepEqual(resolveLook('clean', open), { look: 'clean', axisStyle: 'middle', gridMajor: true });
    assert.deepEqual(resolveLook('classic', open), { look: 'classic', axisStyle: 'box', gridMajor: false });
    assert.deepEqual(resolveLook('clean', { ...open, axisStyle: 'box' }), { look: 'classic', axisStyle: 'box', gridMajor: false });
    assert.deepEqual(resolveLook('clean', { ...open, axisStyle: 'axes', grid: false }), { look: 'clean', axisStyle: 'axes', gridMajor: false });
    assert.deepEqual(resolveLook('classic', { ...open, grid: true }), { look: 'classic', axisStyle: 'box', gridMajor: true });
    assert.equal(resolveLook('clean', { ...open, polar: true }).look, 'classic');
    assert.equal(resolveLook('clean', { ...open, is3D: true }).look, 'classic');
    // A chart's own look field.
    const s = settings('plot f(x) = x');
    s.setValue('look', 'classic');
    assert.equal(s.resolvedLook().look, 'classic');
});

test('the clean look writes no axis letters x and y, only names the chart gives (lines, table headers)', () => {
    const plain = withLook('clean', () => settings('plot f(x) = x').toRendererConfig());
    assert.equal(plain.xLabel, '');
    assert.equal(plain.yLabel, '');
    const named = withLook('clean', () => settings('xlabel time\nylabel height\nplot f(x) = x').toRendererConfig());
    assert.equal(named.xLabel, 'time');
    assert.equal(named.yLabel, 'height');
    const table: NoteTable = { headers: ['Hours', 'Score'], rows: [['1', '52'], ['2', '55']] };
    const fromTable = withLook('clean', () => settings('use the table above\nmark the data', table).toRendererConfig());
    assert.equal(fromTable.xLabel, 'Hours');
    assert.equal(fromTable.yLabel, 'Score');
    const classic = withLook('classic', () => settings('plot f(x) = x').toRendererConfig());
    assert.equal(classic.xLabel, 'x');
    assert.equal(classic.yLabel, 'y');
});

// ------------------------------------------------------------ the export

test('Classic gives the export of 6.0 exactly', () => {
    assert.equal(tikz(PARABOLA, 'classic'), PARABOLA_600);
});

test('clean export: middle axes without arrowheads, light grid, small grey numbers, semithick function, no letters', () => {
    const code = tikz(PARABOLA);
    assert.ok(code.includes('axis x line=middle, axis y line=middle'), code);
    assert.ok(code.includes('axis line style={draw=etzAxis, line width=0.45pt, -}'), 'no arrowheads');
    assert.ok(code.includes('major tick length=0pt'), 'no tick marks');
    assert.ok(code.includes('tick label style={font=\\scriptsize, text=etzTick}'));
    assert.ok(code.includes('grid=major'));
    assert.ok(code.includes('major grid style={draw=etzGrid, draw opacity=0.12}'));
    assert.ok(code.includes('\\definecolor{etzGrid}{HTML}{61719B}'));
    assert.ok(code.includes('\\addplot[etBlue, semithick, domain=-4:4'), 'a function without a thickness is semithick');
    assert.ok(!/xlabel=|ylabel=|axis lines=/.test(code), code);
    // The value of the set sits in a pill; its dots are the clean look's.
    assert.ok(/\\node\[etTeal, anchor=[a-z ]+, font=\\footnotesize, fill=white, draw=etzPill, [^\]]*\] at \(axis cs:[-0-9.]+,0\)/.test(code), code);
    assert.ok(code.includes('mark size=2.4pt'));
});

test('clean export: the numbers leave out the 0 where the axes cross and the numbers on marked points', () => {
    const code = tikz(PARABOLA);
    const x = new Map(tickLabels(code, 'x'));
    assert.equal(x.get('0'), '', 'no 0 at the origin');
    assert.equal(x.get('-2'), '', 'no -2 under the dot of the root');
    assert.equal(x.get('2'), '');
    assert.equal(x.get('1'), '$\\pgfmathprintnumber{1}$');
    assert.equal(x.get('-4'), '$\\pgfmathprintnumber{-4}$');
    const y = new Map(tickLabels(code, 'y'));
    assert.equal(y.get('0'), '');
    assert.equal(y.get('1'), '$\\pgfmathprintnumber{1}$', 'a square chart has square grid cells: y steps of 1 too');
    assert.equal(y.get('-4'), '', 'the vertex is on the y-axis: its curve runs through -4');
    // Every tick keeps its grid line: the list has every value.
    assert.deepEqual(tickLabels(code, 'x').map(([t]) => t), ['-4', '-3', '-2', '-1', '0', '1', '2', '3', '4']);
});

test('clean export: an axis whose 0 is outside the view lies at the near edge', () => {
    const table: NoteTable = { headers: ['Hours studied', 'Score'], rows: [['1', '52'], ['2', '55'], ['3', '61'], ['4', '60'], ['5', '68']] };
    const data = tikz('show x from 0.5 to 5.5 and y from 45 to 70\nuse the table above\nmark the data', 'clean', table);
    assert.ok(data.includes('axis x line=bottom, axis y line=left'), data);
    assert.ok(data.includes('xlabel={Hours studied}, ylabel={Score}'), 'the headers name the axes');
    // Every number shows: no axis crosses another at 0.
    assert.ok(tickLabels(data, 'x').every(([, l]) => l !== ''), data);
    const negative = tikz('show x from -9 to -1 and y from -8 to -2\nplot f(x) = x/2 - 3');
    assert.ok(negative.includes('axis x line=top, axis y line=right'), negative);
    const half = tikz('show x from -3 to 3 and y from 1 to 9\nplot f(x) = x^2');
    assert.ok(half.includes('axis x line=bottom, axis y line=middle'), half);
    // Axes on the edges stay on the edges.
    assert.ok(tikz('axes on the edges\nplot f(x) = x').includes('axis x line=bottom, axis y line=left'));
});

test('clean export: what a chart sets wins (a box is Classic, no grid, grid opacity, thickness, names)', () => {
    const box = 'show x from -4 to 4 and y from -5 to 5\naxes in a box\nplot f(x) = x^2 - 4 in blue';
    assert.equal(tikz(box, 'clean'), tikz(box, 'classic'), 'a chart in a box looks as it always did');
    assert.ok(!tikz('no grid\nplot f(x) = x').includes('grid='));
    assert.ok(tikz('grid opacity 1\nplot f(x) = x').includes('major grid style={draw=etzGrid, draw opacity=0.24}'));
    assert.ok(tikz('with a minor grid\nplot f(x) = x').includes('grid=both, minor tick num=5'));
    const widths = tikz('plot f(x) = x, very thin\nplot g(x) = 2x, thin\nplot h(x) = 3x\nplot k(x) = 4x, thick');
    assert.ok(/\\addplot\[black, very thin,/.test(widths) && /\\addplot\[black, thin,/.test(widths) && /\\addplot\[black, semithick,/.test(widths) && /\\addplot\[black, thick,/.test(widths), widths);
    const named = tikz('title A title\nxlabel t\nylabel h\nplot f(x) = x');
    assert.ok(named.includes('xlabel={t}, ylabel={h}'), named);
    assert.ok(named.includes('title style={yshift=15pt}'), 'the title is lifted over the y name above the axis');
});

test('clean export: extrema are dots without the words min and max', () => {
    const code = tikz('show x from -3 to 3 and y from -4 to 4\nplot f(x) = x^3 - 3x in blue, with its extrema');
    assert.ok(!/\{min\}|\{max\}/.test(code), code);
    assert.ok(/coordinates \{\(-1,2\) \(1,-2\)\}/.test(code), code);
    assert.ok(/\{min\}/.test(tikz('show x from -3 to 3 and y from -4 to 4\nplot f(x) = x^3 - 3x in blue, with its extrema', 'classic')));
});

// ------------------------------------------------------------ numbers clear of dots and curves

test('tickClear and cleanTickSpots: a number on a dot or under a curve is left out, others show', () => {
    const obstacles: TickObstacles = { dots: [{ x: 50, y: 50, r: 4 }], lines: [[{ x: 0, y: 0 }, { x: 100, y: 100 }]] };
    assert.equal(tickClear({ x0: 47, x1: 53, y0: 55, y1: 62 }, { dots: obstacles.dots, lines: [] }, 2), false, 'next to the dot');
    assert.equal(tickClear({ x0: 47, x1: 53, y0: 60, y1: 67 }, { dots: obstacles.dots, lines: [] }, 2), true, 'far enough');
    assert.equal(tickClear({ x0: 10, x1: 20, y0: 12, y1: 18 }, { dots: [], lines: obstacles.lines }, 0), false, 'the line runs through it');
    assert.equal(tickClear({ x0: 10, x1: 20, y0: 30, y1: 40 }, { dots: [], lines: obstacles.lines }, 0), true);
    const frame = { sx: (v: number) => 50 + v * 10, sy: (v: number) => 50 - v * 10, ox: 50, oy: 50, place: { x: 'zero' as const, y: 'zero' as const }, fs: 8, gap: 3, charEm: 0.56 };
    const spots = cleanTickSpots('x', [-2, -1, 0, 1, 2].map((value) => ({ value })), (t) => String(t.value), { step: 1, listed: false, frame, obstacles: { dots: [{ x: 70, y: 50, r: 4 }], lines: [] } });
    assert.deepEqual(spots.map((s) => s.show), [true, true, false, true, false]);
    // A listed 0 (x numbers at ...) shows.
    const listed = cleanTickSpots('x', [{ value: 0 }], () => '0', { step: 1, listed: true, frame, obstacles: { dots: [], lines: [] } });
    assert.equal(listed[0].show, true);
});
