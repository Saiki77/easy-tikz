/*
 * Data (5.0): the table above a block (found, read, its numbers and
 * columns), the least-squares line and its label, the data lines of the
 * chart language (read, printed, read back, in a person's own words), the
 * scene (points, bars, a line, the regression line, problems), the axis
 * names from the headers, the export, the auto-fit, and that saving a chart
 * never writes the table's rows into the block.
 */
import { test, assert, near } from './_lib';
import { NoteTable, cellNumber, numericColumns, rowCells, tableAbove, tableData, tableKey } from '../src/beyond/table';
import { leastSquares, regressionLabel, significant } from '../src/beyond/maths';
import { readsTable, tableForBlock } from '../src/beyond/note';
import { parseChartText } from '../src/text/parse';
import { printChartText, writeChartText } from '../src/text/print';
import { clean, setChartWords, NO_WORDS } from '../src/text/words';
import { canonical } from '../src/chartdata';
import { SettingsManager } from '../src/settings';
import { computeScene2D, computeScene3D, labelMetricsFor, Scene2D } from '../src/scene';
import { clipRing } from '../src/beyond/scene';
import { fitSettings } from '../src/fit';
import { recipes } from '../src/migrate';
import { Tool } from '../src/types';

type Data = Record<string, unknown>;

const NOTE = [
    '# Study',
    '',
    '| Hours | **Score** |',
    '|:---|---:|',
    '| 1 | 52 |',
    '| 2 | 55 |',
    '| 3 | 61 |',
    '| 4 | −60 |',
    '| x | 7 |',
    '| 5 | 68 |',
    '',
    'Some text.',
    '',
    '```easy-tikz',
    'use the table above',
    'mark the data',
    '```',
];

function chartWith(text: string, table?: NoteTable | null): { settings: SettingsManager; scene: Scene2D } {
    const settings = SettingsManager.fromJSON(parseChartText(text).data);
    settings.noteTable = table;
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    const scene = computeScene2D({
        functions: config.functions,
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: { nx: 200, ny: 200 },
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(10, 10),
    });
    return { settings, scene };
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

// ------------------------------------------------------------------ table

test('data: the nearest table above the block, with its headers and rows', () => {
    const table = tableAbove(NOTE, 14);
    assert.ok(table);
    assert.deepEqual(table.headers, ['Hours', '**Score**']);
    assert.equal(table.rows.length, 6);
    assert.deepEqual(table.rows[3], ['4', '−60']);
});

test('data: tables in code blocks and below the block do not count; the nearest above wins; callouts count', () => {
    const lines = ['| a | b |', '|---|---|', '| 1 | 2 |', '', '```', '| c | d |', '|---|---|', '| 3 | 4 |', '```', '', '> | e | f |', '> |---|---|', '> | 5 | 6 |', '', '```easy-tikz', 'use the table above', '```', '| g | h |', '|---|---|', '| 7 | 8 |'];
    const table = tableAbove(lines, 15);
    assert.deepEqual(table?.headers, ['e', 'f']);
    assert.deepEqual(table?.rows, [['5', '6']]);
    assert.deepEqual(tableAbove(lines.slice(0, 10).concat(['```easy-tikz']), 11)?.headers, ['a', 'b']);
    assert.equal(tableAbove(['text', '```easy-tikz'], 2), null);
    assert.equal(tableAbove(['| a | b |', 'no separator', '```easy-tikz'], 3), null);
});

test('data: cells split at bars, escaped bars kept', () => {
    assert.deepEqual(rowCells('| a | b \\| c | d |'), ['a', 'b | c', 'd']);
    assert.deepEqual(rowCells('a | b'), ['a', 'b']);
});

test('data: numbers in cells (typeset minus, Markdown around them, grouped digits)', () => {
    const cases: Array<[string, number | null]> = [
        ['52', 52],
        ['-3.5', -3.5],
        ['−3.5', -3.5],
        ['1e3', 1000],
        ['.5', 0.5],
        ['**7**', 7],
        ['$2.5$', 2.5],
        ['`4`', 4],
        ['12 500', 12500],
        ['x', null],
        ['', null],
        ['3 4', null],
        ['1,5', null],
    ];
    for (const [cell, want] of cases) assert.equal(cellNumber(cell), want, cell);
});

test('data: the first two numeric columns, columns by header name, rows with a non-number skipped', () => {
    const table: NoteTable = {
        headers: ['Name', 'Hours studied', 'Score', 'Grade'],
        rows: [
            ['Ann', '1', '52', 'C'],
            ['Bo', '2', 'n/a', 'B'],
            ['Cy', '3', '61', 'A'],
            ['', '', '', ''],
        ],
    };
    assert.deepEqual(numericColumns(table), [1, 2]);
    const auto = tableData(table, '', '');
    assert.ok(auto.ok);
    if (auto.ok) {
        assert.deepEqual(auto.points, [
            [1, 52],
            [3, 61],
        ]);
        assert.equal(auto.skipped, 1);
        assert.equal(auto.xName, 'Hours studied');
        assert.equal(auto.yName, 'Score');
    }
    const named = tableData(table, 'score', 'HOURS STUDIED');
    assert.ok(named.ok && named.x === 2 && named.y === 1);
    const missing = tableData(table, 'weight', '');
    assert.ok(!missing.ok && missing.problem === 'noColumn' && missing.column === 'weight');
    const none = tableData({ headers: ['a', 'b'], rows: [['x', 'y']] }, '', '');
    assert.ok(!none.ok && none.problem === 'noNumbers');
    // One column of numbers: the rows are numbered for x.
    const one = tableData({ headers: ['Month', 'Sales'], rows: [['Jan', '3'], ['Feb', '5']] }, '', '');
    assert.ok(one.ok && one.x === -1);
    if (one.ok)
        assert.deepEqual(one.points, [
            [1, 3],
            [2, 5],
        ]);
});

test('data: the table key follows the content', () => {
    const a: NoteTable = { headers: ['x', 'y'], rows: [['1', '2']] };
    assert.equal(tableKey(a), tableKey({ headers: ['x', 'y'], rows: [['1', '2']] }));
    assert.notEqual(tableKey(a), tableKey({ headers: ['x', 'y'], rows: [['1', '3']] }));
    assert.notEqual(tableKey(null), tableKey(undefined));
});

test('data: a block finds its table again after the note changed above it', () => {
    const text = NOTE.join('\n');
    const found = tableForBlock(text, 'use the table above\nmark the data', 14, new Set(['easy-tikz']));
    assert.equal(found?.line, 14);
    assert.equal(found?.table?.rows.length, 6);
    const moved = ['new line', ...NOTE].join('\n').replace('| 5 | 68 |', '| 5 | 70 |');
    const again = tableForBlock(moved, 'use the table above\nmark the data', 14, new Set(['easy-tikz']));
    assert.equal(again?.line, 15);
    assert.deepEqual(again?.table?.rows[5], ['5', '70']);
    assert.equal(tableForBlock(text, 'something else', 14, new Set(['easy-tikz'])), undefined);
    assert.ok(readsTable(parseChartText('use the table above\nmark the data').data));
    assert.ok(!readsTable(parseChartText('data (1, 2), (3, 4)\nmark the data').data));
});

// ------------------------------------------------------------- regression

test('data: the least-squares line and R²', () => {
    const exact = leastSquares([
        [0, 1],
        [1, 3],
        [2, 5],
    ]);
    assert.ok(exact);
    if (exact) {
        near(exact.m, 2);
        near(exact.b, 1);
        near(exact.r2, 1);
    }
    const r = leastSquares([
        [1, 52],
        [2, 55],
        [3, 61],
        [4, 60],
        [5, 68],
    ]);
    assert.ok(r);
    if (r) {
        near(r.m, 3.7, 1e-12);
        near(r.b, 48.1, 1e-12);
        near(r.r2, 1369 / 1508, 1e-12);
    }
    assert.equal(leastSquares([[1, 2]]), null);
    assert.equal(leastSquares([
        [1, 2],
        [1, 3],
    ]), null);
});

test('data: the regression label prints like the math', () => {
    assert.equal(regressionLabel({ m: 4.2133, b: 47.62, r2: 0.9812, n: 5 }), '$y = 4.21x + 47.6$, $R^2 = 0.98$');
    assert.equal(regressionLabel({ m: -2, b: -3.25, r2: 0.5, n: 5 }), '$y = -2x - 3.25$, $R^2 = 0.5$');
    assert.equal(regressionLabel({ m: 1, b: 0, r2: 1, n: 3 }), '$y = x$, $R^2 = 1$');
    assert.equal(regressionLabel({ m: 0, b: 7, r2: 1, n: 3 }), '$y = 7$, $R^2 = 1$');
    assert.equal(regressionLabel({ m: 0.5, b: 2, r2: 0.9971, n: 3 }), '$y = 0.5x + 2$, $R^2 = 0.997$');
    assert.equal(significant(1234.5), '1235');
    assert.equal(significant(0.012345), '0.0123');
});

// ------------------------------------------------------------------ text

test('data: the data lines read and print back as the same chart', () => {
    const printed = roundTrip('use the table above\nmark the data\ndraw its regression line, labelled');
    assert.equal(printed, 'use the table above\nmark the data\ndraw its regression line, labelled');
    assert.equal(roundTrip('use the table above, columns hours and score\ndraw the data as bars in orange, opacity 0.5'), 'use the table above, columns hours and score\ndraw the data as bars in orange, opacity 0.5');
    assert.equal(roundTrip('data (1, 52), (2, 55), (3, 61)\ndraw the data as a line, thick, dashed'), 'data (1, 52), (2, 55), (3, 61)\ndraw the data as a line, thick, dashed');
    roundTrip('use the table above, columns "hours, studied" and score\nmark the data, large, with coordinates');
    roundTrip('scores: data (1, a), (2, 2a)\nslider a from 0 to 5\nmark the data, labelled "({x}, {y})"\ndraw the regression line, labelled "slope {m:2}"');
    roundTrip('data (1, 2), (3, 4)\ndata (5, 6), (7, 8)\nmark the data\ndraw the data of D1 as bars, hidden');
});

test('data: "the data" is the nearest data line above, else the first below; a name picks one', () => {
    const tools = (text: string) => parseChartText(text).data.tools as Data[];
    assert.equal(tools('data (1, 2)\ndata (3, 4)\nmark the data')[2].data, 'D2');
    assert.equal(tools('mark the data\ndata (1, 2)\ndata (3, 4)')[0].data, 'D1');
    assert.equal(tools('data (1, 2)\ndata (3, 4)\nmark the data of D1')[2].data, 'D1');
    assert.equal(tools('mine: data (1, 2)\ndraw its regression line')[1].data, 'mine');
    // Several data sets: a printed line points at the nearest one above without its name, and names any other.
    assert.equal(printChartText(parseChartText('data (1, 2)\ndata (3, 4)\nmark the data').data), 'data (1, 2)\ndata (3, 4)\nmark the data');
    assert.equal(printChartText(parseChartText('data (1, 2)\ndata (3, 4)\nmark the data of D1').data), 'D1: data (1, 2)\ndata (3, 4)\nmark the data of D1');
});

test('data: lines that do not read name what they take', () => {
    const problem = (text: string) => parseChartText(text).problems.map((p) => `${p.line}:${p.column} ${p.message}`);
    assert.match(problem('mark the data')[0], /^1:6 "the data" needs a data line/);
    assert.match(problem('data (1, 2)\ndraw the data as stripes')[0], /^2:6 Write: draw the data as bars/);
    assert.match(problem('use the table')[0], /^1:5 Write: use the table above/);
    assert.match(problem('data 1, 2')[0], /^1:6 Write the points: data/);
    assert.match(problem('data (1, 2)\nmark the data, sparkly')[0], /unknown option "sparkly"/);
    assert.match(problem('use the table above, thick')[0], /unknown option "thick"; a data set takes: hidden/);
    assert.match(problem('data (1, 2)\ndraw its regression line, sparkly')[0], /^2:27 unknown option "sparkly"/);
});

test('data: the data lines in a person\'s own words', () => {
    setChartWords(
        clean({
            words: {
                'use-the-table-above': ['nimm die Tabelle oben'],
                data: ['Daten'],
                'the-data': ['die Daten'],
                'as-bars': ['als Balken'],
                'its-regression-line': ['ihre Regressionsgerade'],
                draw: ['zeichne'],
                mark: ['markiere'],
                columns: ['Spalten'],
            },
            bundles: [],
            write: 'yours',
        })
    );
    try {
        const text = 'nimm die Tabelle oben, Spalten Stunden and Punkte\nmarkiere die Daten\nzeichne die Daten als Balken\nzeichne ihre Regressionsgerade, labelled';
        const read = parseChartText(text);
        assert.deepEqual(read.problems, []);
        const tools = read.data.tools as Data[];
        assert.deepEqual(tools[0], { type: 'data', name: 'D1', source: 'table', xColumn: 'Stunden', yColumn: 'Punkte' });
        assert.equal(tools[2].style, 'bars');
        assert.equal(printChartText(read.data), text);
        assert.equal(canonical(parseChartText('Daten (1, 2), (3, 4)\nmarkiere die Daten').data), canonical(parseChartText('data (1, 2), (3, 4)\nmark the data').data));
    } finally {
        setChartWords(NO_WORDS);
    }
});

test('data: saving a chart that reads the table writes the line back, never the rows', () => {
    const block = '% the scores\nuse the table above\nmark the data, large';
    const settings = SettingsManager.fromJSON(parseChartText(block).data);
    settings.noteTable = tableAbove(NOTE, 14);
    const data = settings.serialize();
    assert.ok(!JSON.stringify(data).includes('52'), 'no row in the chart data');
    assert.equal(writeChartText(block, data), block);
    // A change elsewhere keeps the data line as it was.
    const tools = data.tools as Data[];
    tools[1].color = 'red';
    assert.equal(writeChartText(block, data), '% the scores\nuse the table above\nmark the data in red, large');
});

// ------------------------------------------------------------------ scene

test('data: points, bars, a line and the regression line from typed data', () => {
    const { scene } = chartWith(
        'show x from 0 to 6 and y from 0 to 80\ndata (1, 52), (2, 55), (3, 61), (4, 60), (5, 68)\nmark the data\ndraw the data as bars\ndraw the data as a line\ndraw its regression line, labelled'
    );
    assert.deepEqual(scene.issues, []);
    const [data, points, bars, line, regression] = scene.items;
    assert.equal(data.source, 'D1');
    assert.equal(points.markers.length, 5);
    assert.equal(bars.fills.length, 5);
    near(bars.fills[0].rings[0][1].x - bars.fills[0].rings[0][0].x, 0.8);
    assert.equal(bars.fills[0].rings[0][0].y, 0);
    assert.equal(line.strokes[0].lines[0].length, 5);
    const reg = regression.strokes[0].lines[0];
    near(reg[0].x, 1);
    near(reg[0].y, 3.7 + 48.1, 1e-9);
    near(reg[1].x, 5);
    assert.equal(regression.texts[0].text, '$y = 3.7x + 48.1$, $R^2 = 0.91$');
    assert.equal(scene.derived.D1_n, 5);
    assert.equal(scene.derived.D1_y3, 61);
});

test('data: the table above, its axis names, and what a chart without one says', () => {
    const table = tableAbove(NOTE, 14);
    const { settings, scene } = chartWith('show x from 0 to 6 and y from -70 to 80\nuse the table above\nmark the data\ndraw its regression line, labelled "m = {m:1}"', table);
    assert.equal(scene.items[1].markers.length, 5);
    assert.equal(scene.items[1].markers[3].y, -60);
    assert.deepEqual(scene.issues.map((i) => [i.source, i.severity, i.message]), [['D1', 'info', '1 row left out: not a number in Hours or Score']]);
    assert.equal(scene.items[2].texts[0].text, 'm = -8.3');
    const config = settings.toRendererConfig(settings.createMathContext());
    assert.equal(config.xLabel, 'Hours');
    assert.equal(config.yLabel, 'Score');
    // Its own axis names win.
    const own = SettingsManager.fromJSON(parseChartText('xlabel time\nuse the table above\nmark the data').data);
    own.noteTable = table;
    assert.equal(own.toRendererConfig(own.createMathContext()).xLabel, 'time');
    assert.equal(own.toRendererConfig(own.createMathContext()).yLabel, 'Score');
    // In a note without a table: a problem. Not in a note (a new chart in the editor, an AI check): a note.
    const none = chartWith('use the table above\nmark the data', null).scene.issues;
    assert.deepEqual(none.map((i) => [i.source, i.severity]), [
        ['D1', 'error'],
        ['DP1', 'error'],
    ]);
    assert.match(none[0].message, /No Markdown table above this chart/);
    const elsewhere = chartWith('use the table above\nmark the data', undefined).scene.issues;
    assert.deepEqual(elsewhere.map((i) => [i.source, i.severity]), [['D1', 'info']]);
    const column = chartWith('use the table above, columns hours and weight\nmark the data', table).scene.issues;
    assert.equal(column[0].field, 'yColumn');
    assert.match(column[0].message, /no column "weight"\. Its columns: Hours, Score/);
});

test('data: a plot of something that is no data set, a regression without enough points, and 3D', () => {
    const issues = (text: string) => chartWith(text).scene.issues.map((i) => `${i.source} ${i.severity}: ${i.message}`);
    assert.deepEqual(issues('data (1, 2)\ndraw its regression line'), ['DP1 info: A regression line needs two points with different x']);
    const raw = issues('R1: shade where x >= 0\nraw tool {"type": "dataPlot", "name": "DP1", "data": "R1"}');
    assert.deepEqual(raw, ['DP1 error: R1 is not a data set']);
    const settings = SettingsManager.fromJSON(parseChartText('3d\ndata (1, 2)\nmark the data').data);
    const math = settings.createMathContext();
    const scene3 = computeScene3D({ tools: settings.toRendererConfig(math).tools, math, view: { xmin: -1, xmax: 1, ymin: -1, ymax: 1, zmin: -1, zmax: 1 } });
    assert.deepEqual(scene3.issues.map((i) => i.message), ['D1 is drawn in 2D charts only', 'DP1 is drawn in 2D charts only']);
});

test('data: the export writes the values it has, the fit holds the points and the bars down to 0', () => {
    const settings = SettingsManager.fromJSON(parseChartText('show x from 0 to 4 and y from 0 to 70\ndata (1, 52), (2, 55), (3, 61)\ndraw the data as bars\nmark the data').data);
    settings.noteTable = null;
    const math = settings.createMathContext();
    const tex = settings.generateTikzCode(math);
    assert.match(tex, /coordinates \{\(1,52\) \(2,55\) \(3,61\)\}/);
    assert.match(tex, /\\fill\[etBlue, fill opacity=0\.35, even odd rule\] \(axis cs:0\.6,0\)/);
    const fit = fitSettings(settings, math);
    assert.equal(fit.y?.min, 0);
    assert.ok((fit.y?.max ?? 0) >= 61);
    assert.ok((fit.x?.min ?? 1) <= 0.6 && (fit.x?.max ?? 0) >= 3.4);
});

test('data: the recipes add data with its plot, and a regression line to the data the chart has', () => {
    const ctx = { is3D: false, functions: [], tools: [] as Tool[], parameters: [] };
    const byId = (id: string) => recipes(false).find((r) => r.id === id);
    const table = byId('data-table')?.build(ctx);
    assert.ok(table && table.kind === 'items');
    if (table && table.kind === 'items') {
        assert.deepEqual(table.tools.map((t) => [t.type, t.name]), [
            ['data', 'D1'],
            ['dataPlot', 'DP1'],
        ]);
        const plot = table.tools[1];
        assert.ok(plot.type === 'dataPlot' && plot.data === 'D1');
    }
    const regression = byId('regression')?.build({ ...ctx, tools: table && table.kind === 'items' ? table.tools : [] });
    assert.ok(regression && regression.kind === 'tool' && regression.tool.type === 'dataPlot' && regression.tool.style === 'regression' && regression.tool.data === 'D1');
    const alone = byId('regression')?.build(ctx);
    assert.ok(alone && alone.kind === 'items' && alone.tools.length === 3);
});

test('data: fills end at the view (pgfplots clips no fill): a bar taller than the view is cut at its top', () => {
    const view = { xmin: 0, xmax: 4, ymin: 0, ymax: 10 };
    assert.deepEqual(clipRing([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 30 }, { x: 1, y: 30 }], view), [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 10 },
        { x: 1, y: 10 },
    ]);
    assert.equal(clipRing([{ x: 5, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 2 }], view), null);
    const { scene } = chartWith('show x from 0 to 4 and y from 0 to 50\ndata (1, 52), (2, 30)\ndraw the data as bars');
    assert.deepEqual(scene.items[1].fills[0].rings[0].map((p) => p.y), [0, 0, 50, 50]);
});

test('data: labelled writes each point\'s coordinates and each bar\'s value', () => {
    const { scene } = chartWith('show x from 0 to 4 and y from -10 to 70\ndata (1, 52), (2, -5.5), (3, 61.25)\nmark the data, labelled\ndraw the data as bars, labelled\ndraw the data as bars, labelled "#{i}: {y}"');
    assert.deepEqual(scene.items[1].texts.map((t) => t.text), ['(1, 52)', '(2, -5.5)', '(3, 61.25)']);
    assert.deepEqual(scene.items[2].texts.map((t) => [t.text, t.anchor]), [
        ['52', 'above'],
        ['-5.5', 'below'],
        ['61.25', 'above'],
    ]);
    assert.deepEqual(scene.items[3].texts.map((t) => t.text), ['#1: 52', '#2: -5.5', '#3: 61.25']);
    assert.equal(roundTrip('data (1, 2)\nmark the data, labelled\ndraw the data as bars, labelled'), 'data (1, 2)\nmark the data, labelled\ndraw the data as bars, labelled');
});
