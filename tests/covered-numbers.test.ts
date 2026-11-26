/*
 * 6.2.2: Covered numbers (src/look.ts). The clean look leaves out an axis
 * number that a curve or a marked point covers (Hide, the default). Show
 * keeps every number: a covered one stays in its place and is drawn over
 * the curves with a halo (the export: a node on a white backdrop, its tick
 * label left empty). The setting under Chart look decides unless the chart
 * sets its own (covered_numbers: `keep all numbers`, `hide covered
 * numbers`, the same words in Full LaTeX's \axis[...], or the Chart tab).
 * pdflatex compiles two of them in tests/latex.test.ts.
 */
import { test, assert } from './_lib';
import { SettingsManager } from '../src/settings';
import { parseChartText } from '../src/text/parse';
import { printChartText, printFullText } from '../src/text/print';
import { readBlock } from '../src/blockjson';
import { minimize } from '../src/chartdata';
import { AS_THE_LOOK, AxisSettings, ChartLook, CleanAxisFrame, LOOK_AXES, TickObstacles, axisSettingsOf, cleanTickSpots, resolveAxes, setAxisSettings, setChartLook } from '../src/look';

/** Run fn with a look and axis settings, then put both back to the defaults. */
function withSettings<T>(look: ChartLook, axes: Partial<AxisSettings>, fn: () => T): T {
    setChartLook(look);
    setAxisSettings({ ...AS_THE_LOOK, ...axes });
    try {
        return fn();
    } finally {
        setChartLook('clean');
        setAxisSettings(AS_THE_LOOK);
    }
}

function settings(text: string): SettingsManager {
    const parsed = parseChartText(text);
    assert.deepEqual(parsed.problems, [], text);
    return SettingsManager.fromJSON(parsed.data);
}

function tikz(text: string, look: ChartLook, axes: Partial<AxisSettings> = {}): string {
    return withSettings(look, axes, () => settings(text).generateTikzCode());
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

/** The tick labels of an axis as written, by tick: '' where the number is left out (or drawn as a node). */
function tickLabels(code: string, axis: 'x' | 'y'): Map<string, string> {
    const ticks = (option(code, `${axis}tick`) ?? '').split(',');
    const labels: string[] = [];
    let depth = 0;
    let cur = '';
    for (const c of option(code, `${axis}ticklabels`) ?? '') {
        if (c === '{' && depth++ === 0) continue;
        if (c === '}' && --depth === 0) {
            labels.push(cur);
            cur = '';
            continue;
        }
        if (depth > 0) cur += c;
    }
    return new Map(ticks.map((t, i) => [t, labels[i] ?? '?']));
}

/** The nodes of the covered numbers, by their place `x,y`. */
function coveredNodes(code: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of code.matchAll(/^\\node\[(text=etzTick, [^\n]*)\] at \(axis cs:([^)]*)\) \{(.*)\};$/gm)) out.set(m[2], `${m[1]} | ${m[3]}`);
    return out;
}

/** The normal density with the y-axis in the middle: its top covers the 0.4 left of the axis. */
const DENSITY = ['show x from -3 to 3 and y from -0.05 to 0.45', 'axes in the middle', 'plot f(x) = exp(-x^2/2)/sqrt(2 pi) in blue, thick'].join('\n');

// ------------------------------------------------------------ resolution

test('Covered numbers: Hide by default; the setting changes it; the chart wins over the setting', () => {
    assert.equal(AS_THE_LOOK.covered, 'hide');
    assert.equal(LOOK_AXES.clean.covered, 'hide');
    assert.equal(resolveAxes('clean', {}, AS_THE_LOOK).covered, 'hide', 'the default');
    assert.equal(resolveAxes('clean', {}, { ...AS_THE_LOOK, covered: 'show' }).covered, 'show', 'the setting');
    // The chart over the setting, both ways; 'auto' and unknown values leave it to the setting.
    assert.equal(resolveAxes('clean', { covered: 'hide' }, { ...AS_THE_LOOK, covered: 'show' }).covered, 'hide');
    assert.equal(resolveAxes('clean', { covered: 'show' }, AS_THE_LOOK).covered, 'show');
    for (const open of ['auto', 'keep', true, 3, undefined]) {
        assert.equal(resolveAxes('clean', { covered: open }, { ...AS_THE_LOOK, covered: 'show' }).covered, 'show', String(open));
        assert.equal(resolveAxes('clean', { covered: open }, AS_THE_LOOK).covered, 'hide', String(open));
    }
    // The other four stay as they were.
    const { covered, ...rest } = resolveAxes('classic', { covered: 'show' }, AS_THE_LOOK);
    assert.equal(covered, 'show');
    assert.deepEqual(rest, { line: 'thick', arrows: true, names: 'always', numbers: 'large' });
});

test('Covered numbers: the stored setting reads as Hide unless it holds Show', () => {
    assert.equal(axisSettingsOf(null).covered, 'hide');
    assert.equal(axisSettingsOf({ coveredNumbers: 'show' }).covered, 'show');
    assert.equal(axisSettingsOf({ coveredNumbers: 'hide' }).covered, 'hide');
    for (const bad of ['look', 'auto', true, 1]) assert.equal(axisSettingsOf({ coveredNumbers: bad }).covered, 'hide', String(bad));
});

test('Covered numbers: the renderer config carries it, the chart over the setting over the default', () => {
    const config = (text: string, axes: Partial<AxisSettings>) => withSettings('clean', axes, () => settings(text).toRendererConfig().axes?.covered);
    assert.equal(config(DENSITY, {}), 'hide');
    assert.equal(config(DENSITY, { covered: 'show' }), 'show');
    assert.equal(config(`${DENSITY}\nhide covered numbers`, { covered: 'show' }), 'hide');
    assert.equal(config(`${DENSITY}\nkeep all numbers`, {}), 'show');
    assert.equal(config(`${DENSITY}\nkeep all numbers`, { covered: 'hide' }), 'show');
});

// ------------------------------------------------------------ the numbers

/** The clean look's numbers as a 10 cm chart draws them: 7 pt numbers at 2.67 px per pt. */
const FRAME: CleanAxisFrame = { sx: (v) => 100 + v * 60, sy: (v) => 300 - v * 60, ox: 100, oy: 300, place: { x: 'zero', y: 'zero' }, fs: 18.7, gap: 7.34, charEm: 0.56 };
const TICKS = [-1, 0, 1, 2, 3, 4].map((value) => ({ value }));
const spotsOf = (axis: 'x' | 'y', obstacles: TickObstacles, keep?: boolean) => cleanTickSpots(axis, TICKS, (t) => String(t.value), { step: 1, listed: false, frame: FRAME, obstacles, keep });

test('cleanTickSpots: keep shows a covered number in its place, marked covered; a number a move clears still moves', () => {
    // A curve straight through the y number 1: covered wherever it moves.
    const through: TickObstacles = { dots: [], lines: [[{ x: 0, y: FRAME.sy(1) }, { x: 200, y: FRAME.sy(1) }]] };
    const hidden = spotsOf('y', through);
    assert.equal(hidden[2].show, false);
    assert.equal(hidden[2].covered, true);
    const kept = spotsOf('y', through, true);
    assert.equal(kept[2].show, true);
    assert.equal(kept[2].covered, true);
    assert.equal(kept[2].shift, 0, 'in its place');
    assert.deepEqual([kept[2].x, kept[2].y], [hidden[2].x, hidden[2].y]);
    // The others are neither covered nor moved, and the 0 where the axes cross stays out.
    assert.deepEqual(kept.map((s) => s.covered), [false, false, true, false, false, false]);
    assert.deepEqual(kept.map((s) => s.show), [true, false, true, true, true, true]);
    // A curve that grazes the number moves it clear, in both modes: not covered.
    const graze: TickObstacles = { dots: [], lines: [[{ x: FRAME.ox, y: FRAME.sy(1) }, { x: FRAME.ox - 60, y: FRAME.sy(1) - 50 }]] };
    for (const keep of [false, true]) {
        const s = spotsOf('y', graze, keep)[2];
        assert.ok(s.show && !s.covered && s.shift > 0, `keep ${keep}: ${JSON.stringify(s)}`);
    }
    // A dot on the digits of the x number 2: kept with keep.
    const dot: TickObstacles = { dots: [{ x: FRAME.sx(2), y: FRAME.oy + FRAME.gap + 0.45 * FRAME.fs, r: 4.75 }], lines: [] };
    assert.equal(spotsOf('x', dot)[3].show, false);
    assert.ok(spotsOf('x', dot, true)[3].show && spotsOf('x', dot, true)[3].covered);
});

test('export: Hide leaves the covered 0.4 out; Show writes it as a node over the curve on a white backdrop', () => {
    const hide = tikz(DENSITY, 'clean');
    assert.equal(tickLabels(hide, 'y').get('0.4'), '', 'left out');
    assert.equal(coveredNodes(hide).size, 0);
    const show = tikz(DENSITY, 'clean', { covered: 'show' });
    // The tick label stays empty: the node draws the number, over the curve.
    assert.equal(tickLabels(show, 'y').get('0.4'), '');
    assert.equal(tickLabels(show, 'y').get('0.3'), '$\\pgfmathprintnumber{0.3}$', 'the other numbers as before');
    const nodes = coveredNodes(show);
    assert.deepEqual(Array.from(nodes.keys()), ['0,0.4']);
    assert.equal(nodes.get('0,0.4'), 'text=etzTick, anchor=east, font=\\scriptsize, fill=white, fill opacity=0.7, text opacity=1, inner sep=1pt, rounded corners=1pt, xshift={1pt-0.3333em} | $\\pgfmathprintnumber{0.4}$');
    assert.ok(show.indexOf('% covered axis numbers') > show.indexOf('% f'), 'after the curve');
    // Nothing else changes: the same axis options and the same curve.
    const strip = (code: string) => code.split('\n').filter((l) => !/^\\node\[text=etzTick|^% covered/.test(l)).join('\n');
    assert.equal(strip(show), hide);
});

test('export: x numbers under a curve, large numbers and a number on a fill', () => {
    // A line just under the x-axis covers every x number: north anchors on the axis line, shifted down.
    const under = ['show x from -3 to 3 and y from -1 to 3', 'axes in the middle', 'plot f(x) = -0.12 in red'].join('\n');
    const nodes = coveredNodes(tikz(under, 'clean', { covered: 'show' }));
    assert.deepEqual(Array.from(nodes.keys()), ['-3,0', '-2,0', '-1,0', '1,0', '2,0', '3,0']);
    for (const n of nodes.values()) assert.ok(/anchor=north, font=\\scriptsize, .*yshift=\{1pt-0\.3333em\} \| /.test(n), n);
    // Large numbers: no font (pgfplots' own size, as their tick labels).
    const large = coveredNodes(tikz(under, 'clean', { covered: 'show', numbers: 'large' }));
    assert.ok(large.size > 0 && Array.from(large.values()).every((n) => !n.includes('font=')), JSON.stringify(Array.from(large.values())));
    // A number on a shaded region: its backdrop is the tint of the fill on white, as a label on a fill has.
    const shaded = coveredNodes(tikz([DENSITY, 'shade where y >= 0.38 and y <= 0.42 and x >= -1 and x <= 0 in green, opacity 0.3'].join('\n'), 'clean', { covered: 'show' }));
    assert.ok(/^text=etzTick, anchor=east, font=\\scriptsize, fill=etGreen!30!white, inner sep=1pt, rounded corners=1pt, xshift=/.test(shaded.get('0,0.4') ?? ''), shaded.get('0,0.4'));
});

test('export: the chart wins over the setting; Classic and a box keep their numbers either way', () => {
    assert.equal(coveredNodes(tikz(`${DENSITY}\nkeep all numbers`, 'clean')).size, 1, 'keep all numbers against Hide');
    assert.equal(coveredNodes(tikz(`${DENSITY}\nhide covered numbers`, 'clean', { covered: 'show' })).size, 0, 'hide covered numbers against Show');
    // Classic writes pgfplots' own numbers: Show changes nothing there.
    assert.equal(tikz(DENSITY, 'classic', { covered: 'show' }), tikz(DENSITY, 'classic'));
    const box = DENSITY.replace('axes in the middle', 'axes in a box');
    assert.equal(tikz(box, 'clean', { covered: 'show' }), tikz(box, 'clean'));
});

// ------------------------------------------------------------ the chart text

test('keep all numbers and hide covered numbers: words, Full LaTeX, set lines and JSON, printed and read back the same', () => {
    assert.equal(new SettingsManager().serialize().covered_numbers, 'auto', 'left open by default');
    assert.deepEqual(minimize(parseChartText('plot f(x) = x').data), minimize(parseChartText('set covered_numbers = auto\nplot f(x) = x').data));
    for (const [line, value] of [['keep all numbers', 'show'], ['hide covered numbers', 'hide']] as const) {
        const text = `${DENSITY}\n${line}`;
        const parsed = parseChartText(text);
        assert.deepEqual(parsed.problems, [], line);
        assert.equal(parsed.data.covered_numbers, value, line);
        // Any case and spacing.
        assert.equal(parseChartText(`${DENSITY}\n${line.toUpperCase().replace(/ /g, '  ')}`).data.covered_numbers, value);
        const chart = SettingsManager.fromJSON(parsed.data).serialize();
        const printed = printChartText(chart);
        assert.ok(printed.split('\n').includes(line), `${line} in\n${printed}`);
        assert.deepEqual(minimize(parseChartText(printed).data), minimize(parsed.data), line);
        // Full LaTeX: the same words as a flag of \axis, read back the same.
        const full = printFullText(chart);
        assert.ok(new RegExp(`\\\\axis\\[[^\\n]*\\b${line}\\b`).test(full), `${line} in\n${full}`);
        const back = readBlock(full);
        assert.ok(typeof back !== 'string', String(back));
        if (typeof back !== 'string') {
            assert.deepEqual(back.problems, [], full);
            assert.deepEqual(minimize(back.data), minimize(parsed.data), full);
        }
        // A set line and JSON reach the same field.
        assert.deepEqual(minimize(parseChartText(`${DENSITY}\nset covered_numbers = ${value}`).data), minimize(parsed.data));
        const json = readBlock(JSON.stringify({ ...parsed.data }));
        assert.ok(typeof json !== 'string' && json.data.covered_numbers === value, JSON.stringify(json));
    }
    // Typed by hand in Full LaTeX with the other axis flags.
    const latex = readBlock(['\\begin{chart}', '\\axis[thick axes, keep all numbers]', '\\addplot{x^2}', '\\end{chart}'].join('\n'));
    assert.ok(typeof latex !== 'string' && !latex.problems.length && latex.data.covered_numbers === 'show' && latex.data.axis_lines === 'thick', JSON.stringify(latex));
    // Options after | are a problem, as for the other chart lines; near misses stay problems.
    assert.ok(parseChartText(`${DENSITY}\nkeep all numbers | red`).problems.length > 0);
    for (const bad of ['keep numbers', 'hide numbers', 'keep all the numbers']) assert.ok(parseChartText(`${bad}\nplot f(x) = x`).problems.length > 0, bad);
});
