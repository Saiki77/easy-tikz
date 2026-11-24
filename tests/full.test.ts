/*
 * Full LaTeX (src/text/full.ts): the second form of the chart language.
 * Every built-in chart (the examples, every chart of every guide and the
 * What's new chart) prints in Full LaTeX with a command on every line and
 * reads back as the same chart; Full LaTeX to words and back is stable;
 * problems point at the line and column of the block; rewriting a Full
 * LaTeX block keeps the lines of objects that did not change; a block keeps
 * its form whatever the setting says; lines no command knows are carried
 * both ways; the setting reaches every writer (the printer, formula charts,
 * the AI tools).
 */
import { test, assert } from './_lib';
import { EXAMPLES, defaultTool } from '../src/migrate';
import { GUIDES } from '../src/guides';
import { whatsNewChart } from '../src/whatsnew';
import { canonical } from '../src/chartdata';
import { formulaBlock } from '../src/formula';
import { readBlock } from '../src/blockjson';
import { isChartText, parseChartText } from '../src/text/parse';
import { printChartText, printFullText, printWordsText, writeChartText } from '../src/text/print';
import { chartLanguage, fullToWords, guideWithLanguage, isFullText, readFull, setChartLanguage, wordsToFull } from '../src/text/full';
import { NO_WORDS, clean, setChartWords } from '../src/text/words';
import { stripMathDollars } from '../src/latex';
import { ChartHost, NoteInfo, callTool } from '../src/ai/mcp';

type Data = Record<string, unknown>;

function builtInCharts(): Array<{ id: string; data: Data }> {
    const out: Array<{ id: string; data: Data }> = EXAMPLES.map((e) => ({ id: `example ${e.id}`, data: e.data as Data }));
    for (const g of GUIDES) {
        out.push({ id: `guide ${g.id}`, data: g.chart as unknown as Data });
        g.steps.forEach((s, i) => {
            if (s.chart) out.push({ id: `guide ${g.id} step ${i + 1}`, data: s.chart as unknown as Data });
        });
    }
    out.push({ id: "what's new", data: whatsNewChart() });
    return out;
}

/** The chart of the 5.0 demo, in words and in Full LaTeX (the form approved for 5.0). */
const DEMO_WORDS = [
    'show x from 0 to 5 and y from 0 to 4.5',
    'slider c from 0 to 15, starting at 6',
    'shade where $x + y \\le 4$ and $x + 3y \\le 6$ and $x \\ge 0$ and $y \\ge 0$, numbered',
    'draw $2x + 3y = c$ in red, dashed, labelled "$z = {c}$"',
    'mark the maximum of $2x + 3y$ in the region, large',
    'write "optimum" at (3, 1.2)',
].join('\n');

const DEMO_FULL = [
    '\\begin{chart}',
    '\\axis[xmin=0, xmax=5, ymin=0, ymax=4.5]',
    '\\slider[min=0, max=15, start=6]{c}',
    '\\shade[numbered]{x + y \\le 4, x + 3y \\le 6, x \\ge 0, y \\ge 0}',
    '\\draw[red, dashed, label={$z = {c}$}]{2x + 3y = c}',
    '\\mark[max, large]{2x + 3y}',
    '\\node[at={(3, 1.2)}]{optimum}',
    '\\end{chart}',
].join('\n');

/** Every line and option of the words (docs/ai.md, "The text syntax"), in three charts. */
const EVERY_LINE: Record<string, string> = {
    plane: [
        '% every line of a 2D chart',
        'show x from -3 to 3 and y from -4 to 4',
        'axes in the middle',
        'with a fine grid',
        'grid opacity 0.3',
        'x numbers every pi/2',
        'y numbers at 1 "one", 2 "two"',
        'title slope at x = {a}: {3a^2 - 3:2}',
        'xlabel quantity',
        'ylabel price',
        'size 12 x 6',
        'equal scale',
        'snippet',
        'variables q, p',
        'set showSlidersInNote = false',
        'set displayWidth = 480',
        'slider a from -2 to 2, starting at 0.5, in steps of 0.05',
        'slider b from 0 to 10',
        'plot f(x) = x^3 - 3x in blue, thick, dashed, with its tangent at a and its extrema',
        'plot g(x) = sqrt(x) from x = 0 to 4 in green, very thick, with the legend "root", filled, opacity 0.3, pattern dots',
        'plot h(x) = x, hidden, with a legend',
        'plot c(t) = (cos(t), sin(t)) for t from 0 to 2pi in red, very thin',
        'shade where x + y <= 4 "(1)" and x >= 0 and y >= 0 in orange, opacity 0.2, pattern crosshatch, outlined, with constraint lines, labelled "A"',
        'R2: shade where x <= 1 or x >= 3, with a dashed outline, not filled, hidden',
        'shade between f and g from x = 0 to 2 in purple',
        'shade under f from x = 0 to b, numbered',
        'shade where x - y <= 1 and y <= 3, numbered',
        'draw 2x + 3y = 12 in red, thin, dashed, labelled "z = {a}"',
        'draw x = 2',
        'draw the level curves of x^2 + y^2 at 1, 3.2 and 6 in gray, labelled "{level}"',
        'mark (1, 2), (3, a) and (P1_x, 0) in red, small, with lines to the axes, labelled "({x:2}, {y:2})"',
        'P1: mark where f and g cross, large, with coordinates',
        'mark the corners of R2 in blue, normal',
        'mark the maximum of 2x + 3y in R1, labelled "x* = ({x:2}, {y:2})"',
        'mark the minimum of x^2 + y^2 in R1',
        'mark the integer points in R1, small',
        'mark the integer maximum of 3x + 4y in R1',
        'mark the integer points',
        'draw a line from (0, 0) to (3, 2) to (4, 0) in teal, dashed',
        'draw an arrow from (0, 0) to (3, 2), backwards',
        'draw an arrow from (1, 0) to (2, 2) in magenta',
        'draw a double arrow from (0, 1) to (2, 1)',
        'draw a polygon through (0, 0), (4, 0) and (4, 3) in brown',
        'draw a brace from (0, -0.5) to (4, -0.5), labelled "4"',
        'draw a line from (0, 0) to P1',
        'write "optimum" at (P1_x, P1_y + 0.4) in red, above, large',
        'write "start" at (0, 0), below, small, hidden',
        'write "left" at (1, 1), left',
        'write "middle" at (1, 2), center, normal',
        'raw tool {"type": "curve", "equation": "x = 1", "futureField": [1, 2]}',
        'plot k(x) = x^2, fillOpacity=0.4',
    ].join('\n'),
    space: [
        '3d',
        'cube',
        'show x from -2 to 2, y from -2 to 2 and z from 0 to 8',
        'axes on the edges',
        'no axes',
        'z numbers off',
        'zlabel height',
        'slider h from 0 to 8, starting at 3',
        'plot s(x, y) = x^2 + y^2 for x from -2 to 2 and y from -2 to 2 in blue, opacity 0.7, mesh 0.2, with 40 samples',
        'plot z = sin(x) cos(y) in viridis, wireframe, hidden',
        'plot w(x, y) = x y in red, in heat',
        'draw the plane z = h in orange, opacity 0.25',
        'draw the plane x = 1',
        'mark (1, 1, 2)',
        'write "top" at (0, 0, 8), right',
    ].join('\n'),
    polar: ['polar', 'show x from -2.5 to 2.5 and y from -2.5 to 2.5', 'axes in a box', 'with a grid', 'slider k from 1 to 8, starting at 4, in steps of 1', 'plot r(theta) = 2cos(k theta) for theta from 0 to pi in purple, thick'].join('\n'),
    latex: [
        'show x from -5 to 5 and y from -5 to 5',
        'with a minor grid',
        'plot $f(x) = \\frac{1}{2}x^2 - |x|$ in blue',
        'plot $r(\\theta) = 1$, hidden',
        'shade where $x^2 + y^2 \\le 4$ and $y \\ge 0$',
        'draw $\\frac{x^2}{4} + y^2 = 1$ in red',
        'mark the maximum of $x + \\sqrt{y}$ in the region',
    ].join('\n'),
};

/** The words the 4.4 short forms and other ways of saying a line use: they too become commands. */
const SHORT_FORMS = [
    'view x -3..3, y -4..4',
    'axes middle',
    'grid',
    'with equal scale',
    'slider a = 0.8 in -1.1..1.1 step 0.05',
    'f(x) = x^3 - 3x | blue, tangent at a, extrema',
    'y = 2x + 1 | red',
    'R1: x + y <= 4, x >= 0 | numbered',
    '2x + 3y = 6 | dashed',
    'plot sin(x) in green',
    'text "A" at (1, 2) | above',
    'draw f2(x) = x^2 in gray',
].join('\n');

/** The command each line starts with (comments and \\begin / \\end left out). */
const commands = (full: string) =>
    full
        .split('\n')
        .map((l) => /^\s*\\([A-Za-z]+)/.exec(l)?.[1] ?? null)
        .filter((c): c is string => !!c && c !== 'begin' && c !== 'end');

const sameChart = (a: string, b: Data) => canonical(parseChartText(a).data) === canonical(b);

/** 6.0 F2: the Full LaTeX commands of version 6 (src/text/full.ts, docs/v6/*.md). */
const COMMANDS_6 = ['let', 'then', 'vectorfield', 'restpoints', 'solution', 'transform', 'orbit', 'cobweb', 'bifurcation', 'newton', 'colourplane', 'circles', 'geogebra' /* 6.0 G */];

/** 6.0 F2: a colour an object is not drawn in now (a tool without a colour is drawn in its default one: the basis vectors in green). */
function otherColour(item: Data): string {
    let drawn = item.color;
    if (drawn === undefined && typeof item.type === 'string') drawn = (defaultTool(item.type as never, { is3D: false, tools: [], functions: [] }) as unknown as Data).color;
    return drawn === 'green' ? 'purple' : 'green';
}

// ------------------------------------------------------------ the forms

test('full: the demo chart prints exactly in the approved form, and both forms are the same chart', () => {
    const words = parseChartText(DEMO_WORDS);
    const full = parseChartText(DEMO_FULL);
    assert.deepEqual(words.problems, []);
    assert.deepEqual(full.problems, []);
    assert.equal(canonical(full.data), canonical(words.data));
    assert.equal(printFullText(words.data), DEMO_FULL);
    assert.equal(wordsToFull(DEMO_WORDS), DEMO_FULL);
});

/** 6.0: the commands of the new lines (src/text/full.ts), commands of their own like \plot. */

test('full: every built-in chart prints in Full LaTeX, a command on every line, and reads back as the same chart', () => {
    const failures: string[] = [];
    const charts = builtInCharts();
    assert.ok(charts.length >= 100, `only ${charts.length} built-in charts`);
    for (const { id, data } of charts) {
        const text = printFullText(data);
        const back = parseChartText(text);
        if (!text.startsWith('\\begin{chart}\n') || !text.endsWith('\n\\end{chart}')) failures.push(`${id}: not one chart environment\n${text}`);
        else if (back.problems.length) failures.push(`${id}: ${back.problems.map((p) => `${p.line}:${p.column} ${p.message}`).join('; ')}\n${text}`);
        else if (canonical(back.data) !== canonical(data)) failures.push(`${id}: not the same chart\n${text}`);
        else {
            const exact = text.split('\n').filter((l) => /^\\(raw|set)\b/.test(l));
            if (exact.length) failures.push(`${id}: lines written exactly instead of in commands: ${exact.join(' | ')}`);
            // \data{(1, 52), (2, 55)}: the points of a chart's data line (5.0).
            const other = commands(text).filter((c) => !['axis', 'slider', 'plot', 'shade', 'draw', 'mark', 'node', 'data', ...COMMANDS_6].includes(c));
            if (other.length) failures.push(`${id}: generic commands ${other.join(', ')}\n${text}`);
        }
    }
    assert.deepEqual(failures, []);
});

test('full: Full LaTeX to words to Full LaTeX is stable, and the words read as the same chart', () => {
    const failures: string[] = [];
    for (const { id, data } of builtInCharts()) {
        const full = printFullText(data);
        const words = fullToWords(full);
        if (!sameChart(words, data)) failures.push(`${id}: the words read differently\n${words}`);
        const again = wordsToFull(words, { builtin: true });
        if (again !== full) failures.push(`${id}: not stable\n${full}\n---\n${again}`);
    }
    assert.deepEqual(failures, []);
});

test('full: words to Full LaTeX keeps line numbers: \\begin{chart}, \\end{chart} and blank lines are blank lines', () => {
    const read = readFull(['\\begin{chart}', '\\plot{f(x) = x^2}', '', '% a comment', '\\draw{x = 1}', '\\end{chart}'].join('\n'));
    assert.deepEqual(read.text.split('\n'), ['', 'plot f(x) = x^2', '', '% a comment', 'draw x = 1', '']);
    assert.deepEqual(read.lines, [1, 2, 3, 4, 5, 6]);
    // An \axis line is one line of words per setting, all on its own line of the block.
    const axis = readFull('\\begin{chart}\n\\axis[xmin=0, xmax=5, ymin=0, ymax=4, axis lines=left, title={A, B}]\n\\end{chart}');
    assert.deepEqual(axis.text.split('\n'), ['', 'show x from 0 to 5 and y from 0 to 4', 'axes on the edges', 'title A, B', '']);
    assert.deepEqual(axis.lines, [1, 2, 2, 2, 3]);
});

test('full: every line and option of the words has a command, and reads back the same', () => {
    for (const [id, text] of Object.entries(EVERY_LINE)) {
        const words = parseChartText(text);
        assert.deepEqual(words.problems, [], id);
        const full = wordsToFull(text);
        const back = parseChartText(full);
        assert.deepEqual(back.problems, [], `${id}\n${full}`);
        assert.equal(canonical(back.data), canonical(words.data), `${id}\n${full}`);
        const lines = full.split('\n');
        assert.equal(lines.filter((l) => l.startsWith('\\axis[')).length, 1, `${id}: one \\axis line\n${full}`);
        // The raw line of the words is the only line written exactly.
        assert.deepEqual(
            lines.filter((l) => /^\\(raw|set)\b/.test(l)),
            id === 'plane' ? ['\\raw[tool]{{"type": "curve", "equation": "x = 1", "futureField": [1, 2]}}'] : [],
            `${id}\n${full}`
        );
        const other = commands(full).filter((c) => !['axis', 'slider', 'plot', 'shade', 'draw', 'mark', 'node', 'raw'].includes(c));
        assert.deepEqual(other, [], `${id}: generic commands\n${full}`);
        assert.equal(wordsToFull(fullToWords(full), { builtin: true }), full, `${id}: not stable`);
        // The words printed from the chart say the same in Full LaTeX.
        assert.ok(sameChart(printFullText(words.data), words.data), id);
    }
});

test('full: the short forms of 4.4 and formulas without a verb become commands too', () => {
    const words = parseChartText(SHORT_FORMS);
    assert.deepEqual(words.problems, []);
    const full = wordsToFull(SHORT_FORMS);
    assert.ok(sameChart(full, words.data), full);
    const other = commands(full).filter((c) => !['axis', 'slider', 'plot', 'shade', 'draw', 'mark', 'node'].includes(c));
    assert.deepEqual(other, [], full);
    assert.ok(full.includes('\\shade[name=R1, numbered]{x + y <= 4, x >= 0}'), full);
    assert.ok(full.includes('\\plot[red]{y = 2x + 1}'), full);
    assert.ok(full.includes('\\node[at={(1, 2)}, above]{A}'), full);
});

test('full: pgfplots and TikZ ways of writing a line read too', () => {
    const text = [
        '\\begin{chart}',
        '\\axis[xmin=-1, xmax=4, ymin=-1, ymax=4, axis lines=middle, grid=both, width=8cm, height=6cm, xlabel={$x$}, xtick distance=1]',
        '\\addplot[blue, domain=0:3]{x^2};',
        '\\draw[->] (0, 0) -- (3, 2);   % an arrow',
        '\\node[red] at (1, 2) {A};',
        '\\draw{(0, 0) -- (1, 0) -- (1, 1) -- cycle}',
        '\\mark[intersections]{f1 and f2}',
        '\\plot{f2(x) = 1}',
        '\\end{chart}',
    ].join('\n');
    const r = parseChartText(text);
    assert.deepEqual(r.problems, []);
    const d = r.data;
    assert.equal(d.axis_style, 'middle');
    assert.equal(d.showLargeGrid, true);
    assert.equal(d.showSmallGrid, true);
    assert.equal(d.size_x_cm, 8);
    assert.equal(d.axis_label_x, '$x$');
    assert.equal(d.numbers_x, 'every');
    const fns = d.functions as Data[];
    assert.deepEqual([fns[0].name, fns[0].expression, fns[0].color, fns[0].domain], ['f1', 'x^2', 'blue', '0:3']);
    const tools = d.tools as Data[];
    assert.deepEqual([tools[0].type, tools[0].style, tools[0].path], ['segment', 'forward', '(0, 0); (3, 2)']);
    assert.deepEqual([tools[1].type, tools[1].closed, tools[1].path], ['segment', true, '(0, 0); (1, 0); (1, 1)']);
    assert.deepEqual([tools[2].source, tools[2].ref1, tools[2].ref2], ['intersections', 'f1', 'f2']);
    const label = (d.annotations as Data[])[0];
    assert.deepEqual([label.text, label.x, label.y, label.color], ['A', '1', '2', 'red']);
});

// ------------------------------------------------------- reading blocks

test('full: a block is Full LaTeX when its first line is \\begin{chart}; it is chart text; both forms are read whatever the setting', () => {
    assert.equal(isFullText(DEMO_FULL), true);
    assert.equal(isFullText(`\n  % my chart\n${DEMO_FULL}`), true);
    assert.equal(isFullText(DEMO_WORDS), false);
    assert.equal(isFullText('plot f(x) = x\n\\begin{chart}'), false);
    assert.equal(isChartText(DEMO_FULL), true);
    const block = readBlock(DEMO_FULL);
    assert.ok(typeof block !== 'string' && block.format === 'text' && block.problems.length === 0);
    assert.equal(readBlock('\\begin{chart}\n\n\\end{chart}'), readBlock(''), 'only \\begin and \\end: an empty block');
    for (const lang of ['words', 'full'] as const) {
        setChartLanguage(lang);
        assert.equal(canonical(parseChartText(DEMO_FULL).data), canonical(parseChartText(DEMO_WORDS).data), lang);
    }
    setChartLanguage('words');
});

test('full: problems point at the line and column of the block', () => {
    const lines = [
        '\\begin{chart}',
        '\\axis[xmin=0, xmax=5, sparkly]',
        '\\plot[blue, sparkly]{f(x) = x^2}',
        '\\plot[green, dashd]{g(x) = \\frac{1}{2}x}',
        '\\slider[min=0, max=a]{c}',
        '',
        '\\draw[red{x = 2}',
        '\\frobnicate{now}',
        '\\end{chart}',
    ];
    const r = parseChartText(lines.join('\n'));
    const at = (line: number, what: string) => [line, lines[line - 1].indexOf(what) + 1];
    const found = r.problems.map((p) => [p.line, p.column]);
    // The slider's range is told at its name, as in words.
    assert.deepEqual(found, [at(2, 'sparkly'), at(3, 'sparkly'), at(4, 'dashd'), at(5, 'c}'), at(7, '['), at(8, 'frobnicate')], JSON.stringify(r.problems, null, 1));
    assert.match(r.problems[0].message, /\\axis/);
    // An unknown option names the options in Full LaTeX.
    assert.match(r.problems[1].message, /unknown option "sparkly".*tangent=a/);
    assert.match(r.problems[4].message, /"\[" is not closed/);
    assert.match(r.problems[5].message, /\\begin\{chart\}.*\\plot/);
    // The words keep their own messages.
    assert.match(parseChartText('plot f(x) = x, sparkly').problems[0].message, /with its tangent at a/);
});

test('full: their own chart words do not apply to Full LaTeX blocks', () => {
    setChartWords(clean({ words: { plot: ['graph'], red: ['rot'] }, bundles: [{ word: 'goal', means: 'in red, dashed' }] }));
    try {
        const full = '\\begin{chart}\n\\plot[red]{f(x) = x}\n\\draw[rot]{x = 1}\n\\end{chart}';
        const r = parseChartText(full);
        assert.equal((r.data.functions as Data[])[0].color, 'red');
        assert.equal(r.problems.length, 1, 'rot is no colour in Full LaTeX');
        // A words block in their words still reads, and prints in Full LaTeX in the built-in words.
        const words = parseChartText('graph f(x) = x, goal');
        assert.deepEqual(words.problems, []);
        setChartLanguage('full');
        const printed = printChartText(words.data);
        assert.equal(printed, '\\begin{chart}\n\\plot[red, dashed]{f(x) = x}\n\\end{chart}');
        assert.equal(wordsToFull('graph f(x) = x, goal'), printed);
    } finally {
        setChartWords(NO_WORDS);
        setChartLanguage('words');
    }
});

test('full: options with braces, label templates and quotes survive both ways', () => {
    const text = [
        '\\begin{chart}',
        '\\axis[title={slope {a:2}, area {27a^4/4:2}}, xlabel="a, b"]',
        '\\slider[min=0, max=1]{a}',
        '\\plot[legend={$f_1$, {a}}]{f(x) = a x}',
        '\\draw[label={$z = {c}$, {x:2}}]{x + y = 1}',
        '\\mark[label={({x:2}, {y:2}); B}]{(1, 2), (a, 0)}',
        '\\node[at={(1, 2)}, text="say \\"hi\\" {{"]',
        '\\node[at={(2, 2)}]{50% of {a:1}}',
        '\\end{chart}',
    ].join('\n');
    const r = parseChartText(text);
    assert.deepEqual(r.problems, []);
    const d = r.data;
    assert.equal(d.title, 'slope {a:2}, area {27a^4/4:2}');
    assert.equal(d.axis_label_x, 'a, b');
    assert.equal((d.functions as Data[])[0].legendLabel, '$f_1$, {a}');
    const tools = d.tools as Data[];
    assert.equal(tools[0].label, '$z = {c}$, {x:2}');
    assert.equal(tools[1].label, '({x:2}, {y:2}); B');
    const labels = d.annotations as Data[];
    assert.equal(labels[0].text, 'say "hi" {{');
    assert.equal(labels[1].text, '50% of {a:1}');
    const again = printFullText(d);
    assert.ok(sameChart(again, d), again);
    assert.equal(wordsToFull(fullToWords(again), { builtin: true }), again);
});

test('full: set lines, raw lines and comments survive', () => {
    const words = ['% my chart', '# notes', 'set displayWidth = 480', 'set displayAlign = "left"', 'raw label {"text": "A | B", "x": "1", "y": "2"}', 'raw slider {"name": "k", "value": 1, "min": 0, "max": 2, "step": 0.5}', 'plot f(x) = k x'].join('\n');
    const full = wordsToFull(words);
    assert.equal(
        full,
        [
            '\\begin{chart}',
            '% my chart',
            '% notes',
            '\\axis[displayWidth=480, displayAlign="left"]',
            '\\raw[label]{{"text": "A | B", "x": "1", "y": "2"}}',
            '\\raw[slider]{{"name": "k", "value": 1, "min": 0, "max": 2, "step": 0.5}}',
            '\\plot{f(x) = k x}',
            '\\end{chart}',
        ].join('\n')
    );
    assert.ok(sameChart(full, parseChartText(words).data));
    const set = parseChartText('\\begin{chart}\n\\set{displayWidth = 300}\n\\set{title = 5}\n\\end{chart}');
    assert.deepEqual([set.data.displayWidth, set.data.title], [300, 5]);
    // What no command can hold is written exactly.
    const odd: Data = { v: 4, title: 5, xmin: '0', xmax: '5', functions: [{ name: 'f', expression: 'x^{2' }] };
    const printed = printFullText(odd);
    assert.ok(sameChart(printed, odd), printed);
    assert.match(printed, /\\set\{title = 5\}/);
    assert.match(printed, /\\raw\[function\]/);
});

test('full: lines no command knows are carried both ways as \\command[options]{rest}', () => {
    const cases: Array<[string, string]> = [
        ['use the table above', '\\use{the table above}'],
        ['use the table above, hidden', '\\use[hidden]{the table above}'],
        ['plot the normal distribution with mean 0 and sd 1', '\\plot{the normal distribution with mean 0 and sd 1}'],
        ['plot the normal distribution with mean 0 and sd 1 in red, dashed', '\\plot[red, dashed]{the normal distribution with mean 0 and sd 1}'],
        ["draw the slope field of $y' = x - y$", "\\draw{the slope field of y' = x - y}"],
        ['slider c from 0 to 15, starting at 6, connected', '\\slider[min=0, max=15, start=6, connected]{c}'],
    ];
    for (const [words, full] of cases) {
        const block = wordsToFull(words);
        assert.equal(block, `\\begin{chart}\n${full}\n\\end{chart}`, words);
        const back = fullToWords(block).split('\n')[1];
        const want = stripMathDollars(words).replace(/ in red, dashed$/, ' | red, dashed');
        assert.equal(stripMathDollars(back), want, words);
        assert.equal(wordsToFull(fullToWords(block)), block, `${words}: not stable`);
    }
    // And back from a command the other way: options after commas, as the words write them.
    assert.equal(fullToWords('\\begin{chart}\n\\use[hidden, label={A, B}]{the table above}\n\\end{chart}').split('\n')[1], 'use the table above, hidden, label "A, B"');
});

// --------------------------------------------------------- writing back

test('full: writing the same chart back changes nothing, comments and blank lines included', () => {
    const texts = [DEMO_FULL, wordsToFull(EVERY_LINE.plane), wordsToFull(EVERY_LINE.space), `% before\n${DEMO_FULL.replace('\\slider', '\n% sliders\n\\slider')}`];
    for (const text of texts) assert.equal(writeChartText(text, parseChartText(text).data), text);
});

test('full: recolouring any object of any built-in chart rewrites that one line, and the block stays Full LaTeX', () => {
    const failures: string[] = [];
    for (const { id, data } of builtInCharts()) {
        const lines = printFullText(data).split('\n');
        // A comment after every other line: rewriting keeps them.
        const text = lines.flatMap((l, i) => (i > 0 && i < lines.length - 1 && i % 2 === 0 ? [`% note ${i}`, l] : [l])).join('\n');
        const parsed = parseChartText(text).data;
        for (const key of ['functions', 'tools'] as const) {
            const items = (parsed[key] as Data[] | undefined) ?? [];
            items.forEach((item, i) => {
                const next = JSON.parse(JSON.stringify(parsed)) as Data;
                const color = otherColour(item); // 6.0 F2
                (next[key] as Data[])[i] = { ...item, color };
                const out = writeChartText(text, next);
                if (!isFullText(out)) failures.push(`${id} ${key}[${i}]: not Full LaTeX\n${out}`);
                else if (!sameChart(out, next)) failures.push(`${id} ${key}[${i}]: not the same chart`);
                else {
                    const a = text.split('\n');
                    const b = out.split('\n');
                    const changed = b.filter((l, j) => l !== a[j]).length;
                    if (a.length !== b.length || changed !== 1) failures.push(`${id} ${key}[${i}]: ${changed} lines changed\n${out}`);
                }
            });
        }
    }
    assert.deepEqual(failures.slice(0, 5), []);
});

test('full: a changed setting rewrites the \\axis line only; a new one goes on an \\axis line of its own', () => {
    const data = parseChartText(DEMO_FULL).data;
    data.xmax = '6';
    const out = writeChartText(DEMO_FULL, data).split('\n');
    const before = DEMO_FULL.split('\n');
    assert.equal(out[1], '\\axis[xmin=0, xmax=6, ymin=0, ymax=4.5]');
    assert.deepEqual([...out.slice(0, 1), ...out.slice(2)], [...before.slice(0, 1), ...before.slice(2)]);
    const wide = writeChartText(DEMO_FULL, { ...parseChartText(DEMO_FULL).data, displayWidth: 420 });
    assert.deepEqual(wide.split('\n').slice(0, 3), ['\\begin{chart}', '\\axis[xmin=0, xmax=5, ymin=0, ymax=4.5]', '\\axis[displayWidth=420]']);
    const wider = writeChartText(wide, { ...parseChartText(wide).data, displayWidth: 500 });
    assert.match(wider, /^\\axis\[displayWidth=500\]$/m);
    assert.doesNotMatch(wider, /420/);
});

test('full: new objects go before \\end{chart}, deleted ones leave, renamed ones say their name', () => {
    const data = parseChartText(DEMO_FULL).data;
    (data.parameters as Data[]).push({ name: 'k', value: 2, min: 0, max: 5, step: 0.5 });
    data.functions = [{ name: 'h', expression: '4 - x', color: 'blue' }];
    data.annotations = [];
    const out = writeChartText(DEMO_FULL, data);
    const lines = out.split('\n');
    assert.equal(lines[lines.length - 1], '\\end{chart}', out);
    assert.equal(lines.indexOf('\\slider[min=0, max=5, start=2, step=0.5]{k}'), lines.indexOf('\\slider[min=0, max=15, start=6]{c}') + 1, out);
    assert.ok(lines.includes('\\plot[blue]{h(x) = 4 - x}'), out);
    assert.ok(!out.includes('\\node'), out);
    assert.ok(sameChart(out, data));
    // A second region: "the region" of the optimum is no longer clear, so its line names it.
    const two = parseChartText(DEMO_FULL).data;
    (two.tools as Data[]).push({ type: 'region', name: 'R2', conditions: ['x <= 1'] });
    const named = writeChartText(DEMO_FULL, two);
    assert.ok(sameChart(named, two), named);
    assert.match(named, /\\mark\[max, in=R1, large\]\{2x \+ 3y\}/);
});

test('full: random editor edits on every built-in chart keep every comment, the form and the right chart', () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const charts = builtInCharts().map((c) => c.data);
    const failures: string[] = [];
    for (let round = 0; round < 300; round++) {
        const lines = printFullText(pick(charts)).split('\n');
        const text = lines.flatMap((l, i) => (i > 0 && i < lines.length - 1 && i % 2 === 1 ? [`% note ${i}`, l] : [l])).join('\n');
        const data = JSON.parse(JSON.stringify(parseChartText(text).data)) as Data;
        const fns = (data.functions as Data[] | undefined) ?? [];
        const tools = (data.tools as Data[] | undefined) ?? [];
        const kind = pick(['recolour', 'move tool', 'move function', 'rename tool', 'add function', 'add region', 'delete tool', 'view', 'title', 'width']);
        if (kind === 'recolour' && fns.length + tools.length) pick([...fns, ...tools]).color = 'green';
        // A shape that reads another one (a probability its distribution, a data plot its data) cannot be moved
        // above it and keep a line of its own: known, the block is then written anew (5.2).
        if (kind === 'move tool' && tools.length > 1 && !tools.some((t) => t.distribution !== undefined || t.data !== undefined)) tools.reverse();
        if (kind === 'move function' && fns.length > 1) fns.reverse();
        if (kind === 'rename tool' && tools.length) {
            const old = String(pick(tools).name);
            data.tools = JSON.parse(JSON.stringify(tools).replace(new RegExp(`\\b${old}\\b`, 'g'), 'Zed')) as Data[];
        }
        if (kind === 'add function') data.functions = [...fns, { name: 'added', expression: 'x/2', color: 'red' }];
        if (kind === 'add region') data.tools = [...tools, { type: 'region', name: 'Extra', conditions: ['x <= 1'] }];
        if (kind === 'delete tool' && tools.length) data.tools = tools.slice(1);
        if (kind === 'view') data.xmax = '11';
        if (kind === 'title') data.title = 'A, {b} and "c"';
        if (kind === 'width') data.displayWidth = 420;
        const out = writeChartText(text, data);
        if (!isFullText(out) || !out.trimEnd().endsWith('\\end{chart}')) failures.push(`${kind}: not one Full LaTeX block\n${out}`);
        if (!sameChart(out, data)) failures.push(`${kind}: not the same chart\n${out}`);
        const notes = (t: string) => t.split('\n').filter((l) => l.startsWith('% note')).length;
        if (notes(out) < notes(text)) failures.push(`${kind}: comments lost\n${out}`);
    }
    assert.deepEqual(failures.slice(0, 3), []);
});

test('full: a block keeps its form, whatever the setting says for new charts', () => {
    setChartLanguage('full');
    try {
        const words = parseChartText(DEMO_WORDS).data;
        (words.tools as Data[])[0].color = 'green';
        const out = writeChartText(DEMO_WORDS, words);
        assert.ok(!isFullText(out), out);
        assert.equal(out.split('\n').filter((l, i) => l !== DEMO_WORDS.split('\n')[i]).length, 1, out);
        assert.ok(isFullText(printChartText(words)));
    } finally {
        setChartLanguage('words');
    }
    const full = parseChartText(DEMO_FULL).data;
    (full.tools as Data[])[0].color = 'green';
    const out = writeChartText(DEMO_FULL, full);
    assert.ok(isFullText(out), out);
    assert.match(out, /^\\shade\[green, numbered\]/m);
    assert.ok(!isFullText(printChartText(full)), 'new charts in words by default');
});

// ------------------------------------------------------------ the setting

test('full: the setting decides how new charts are written: the printer, formula charts, the guide', () => {
    assert.equal(chartLanguage(), 'words');
    assert.ok(!isFullText(formulaBlock('x^2', null) ?? ''));
    setChartLanguage('full');
    try {
        assert.equal(chartLanguage(), 'full');
        const block = formulaBlock('\\frac{1}{2}x^2 - a', null) ?? '';
        assert.ok(isFullText(block), block);
        assert.match(block, /\\plot\[blue, thick\]\{f\(x\) = \\frac\{1\}\{2\}x\^2 - a\}/);
        assert.match(block, /\\slider\[min=-5, max=5, start=1\]\{a\}/);
        assert.match(guideWithLanguage('# Guide\n'), /## This person's chart language[\s\S]*Full LaTeX/);
        setChartLanguage('nonsense');
        assert.equal(chartLanguage(), 'words');
    } finally {
        setChartLanguage('words');
    }
    assert.equal(guideWithLanguage('# Guide\n'), '# Guide\n');
    assert.equal(printChartText(parseChartText(DEMO_WORDS).data), printWordsText(parseChartText(DEMO_WORDS).data));
});

/** A vault in memory, as the AI tests use. */
class FakeHost implements ChartHost {
    version = '9.9.9';
    notes = new Map<string, string>();
    notices: string[] = [];
    open: string | null = null;
    activeNote(): NoteInfo | null {
        return this.open ? { path: this.open, headings: [] } : null;
    }
    resolveNote(note: string) {
        const path = note.endsWith('.md') ? note : `${note}.md`;
        return { path, exists: this.notes.has(path) };
    }
    async read(path: string) {
        const t = this.notes.get(path);
        if (t === undefined) throw new Error(`There is no note ${path}.`);
        return t;
    }
    async write(path: string, update: (old: string) => string) {
        this.notes.set(path, update(this.notes.get(path) ?? ''));
    }
    notify(message: string, path: string) {
        this.notices.push(`${message} to ${path}`);
    }
}

const textOf = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text || '').join('\n');
const bodyOf = (note: string) => /```easy-tikz\n([\s\S]*?)\n```/.exec(note)?.[1] ?? '';

test('full: the AI tools write new charts in the chart language and keep the form of a block', async () => {
    const host = new FakeHost();
    host.notes.set('A.md', '# A\n');
    setChartLanguage('full');
    try {
        // A chart as JSON, as words (comments kept) and as Full LaTeX: all become Full LaTeX.
        assert.ok(!(await callTool('add_chart', { chart: parseChartText(DEMO_WORDS).data, note: 'A' }, host)).isError);
        assert.equal(bodyOf(host.notes.get('A.md') ?? ''), DEMO_FULL);
        host.notes.set('B.md', '');
        assert.ok(!(await callTool('add_chart', { chart: `% the demo\n${DEMO_WORDS}`, note: 'B' }, host)).isError);
        assert.equal(bodyOf(host.notes.get('B.md') ?? ''), DEMO_FULL.replace('\\begin{chart}', '\\begin{chart}\n% the demo'));
        host.notes.set('C.md', '');
        const r = await callTool('add_chart', { chart: DEMO_FULL, note: 'C' }, host);
        assert.ok(!r.isError, textOf(r));
        assert.equal(bodyOf(host.notes.get('C.md') ?? ''), DEMO_FULL);
        assert.match(textOf(await callTool('list_charts', { note: 'C' }, host)), /Chart 1 \(line 1, Full LaTeX, ok\)/);
        assert.match(textOf(await callTool('get_guide', {}, host)), /## This person's chart language/);
        assert.match(textOf(await callTool('get_example', { id: 'tangent' }, host)), /```easy-tikz\n\\begin\{chart\}\n\\axis\[/);
        // A Full LaTeX problem names its line and column.
        const bad = await callTool('check_chart', { chart: '\\begin{chart}\n\\plot[sparkly]{f(x) = x}\n\\end{chart}' }, host);
        assert.match(textOf(bad), /line 2, column 7: unknown option "sparkly"/);
    } finally {
        setChartLanguage('words');
    }
    // A Full LaTeX block stays Full LaTeX when the AI sends words, and words stay words when it sends Full LaTeX.
    const data = parseChartText(DEMO_WORDS).data;
    (data.tools as Data[])[0].color = 'green';
    assert.ok(!(await callTool('update_chart', { note: 'C', index: 1, chart: printWordsText(data) }, host)).isError);
    const c = bodyOf(host.notes.get('C.md') ?? '');
    assert.ok(isFullText(c), c);
    assert.equal(c.split('\n').filter((l, i) => l !== DEMO_FULL.split('\n')[i]).length, 1, c);
    host.notes.set('D.md', '```easy-tikz\n' + DEMO_WORDS + '\n```\n');
    assert.ok(!(await callTool('update_chart', { note: 'D', index: 1, chart: printFullText(data) }, host)).isError);
    const d = bodyOf(host.notes.get('D.md') ?? '');
    assert.ok(!isFullText(d), d);
    assert.ok(sameChart(d, data));
});
