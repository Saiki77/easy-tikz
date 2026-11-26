/*
 * The axes, one by one (6.2.1, src/look.ts): the settings Axis lines, Axis
 * arrows, Axis names and Axis numbers under Chart look change the axes of
 * either look; each is As the look by default, and what a chart sets itself
 * (axis_lines, axis_arrows, axis_names, axis_numbers: `thick axes`, `axes
 * with arrows`, `with axis names`, `small numbers` and their opposites, the
 * same words in Full LaTeX's \axis[...], or the Chart tab) wins.
 * Resolution (chart x setting x look), the renderer config, the export
 * options of both looks and 3D, and the text round trip. pdflatex compiles
 * two of them in tests/latex.test.ts.
 */
import { test, assert } from './_lib';
import { SettingsManager } from '../src/settings';
import { parseChartText } from '../src/text/parse';
import { printChartText, printFullText } from '../src/text/print';
import { readBlock } from '../src/blockjson';
import { minimize } from '../src/chartdata';
import { AS_THE_LOOK, AxisSettings, ChartLook, LOOK_AXES, axisSettingsOf, resolveAxes, setAxisSettings, setChartLook } from '../src/look';

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

/** The axis options of an export, one per line, without the indent and the comma. */
function axisOptions(code: string): string[] {
    const start = code.indexOf('\\begin{axis}[');
    const end = code.indexOf('\n]', start);
    return code
        .slice(start, end)
        .split('\n')
        .slice(1)
        .map((l) => l.trim().replace(/,$/, ''));
}

/** The parabola with a tangent and a named point, axes in the middle: the chart of the proof pictures. */
const TANGENT = [
    'show x from -3 to 3 and y from -1 to 5',
    'axes in the middle',
    'plot f(x) = x^2 in blue',
    'plot t(x) = 2x - 1 in red, dashed',
    'P: mark (1, 1), labelled "P"',
].join('\n');

// ------------------------------------------------------------ resolution

test('resolveAxes: As the look gives the look; a setting changes one thing; the chart wins over both', () => {
    assert.deepEqual(resolveAxes('clean', {}, AS_THE_LOOK), LOOK_AXES.clean);
    assert.deepEqual(resolveAxes('classic', {}, AS_THE_LOOK), LOOK_AXES.classic);
    assert.deepEqual(LOOK_AXES.clean, { line: 'thin', arrows: false, names: 'named', numbers: 'small' });
    assert.deepEqual(LOOK_AXES.classic, { line: 'thick', arrows: true, names: 'always', numbers: 'large' });
    // Each setting alone, in both looks: only its own part changes.
    const cases: Array<[Partial<AxisSettings>, Partial<typeof LOOK_AXES.clean>]> = [
        [{ line: 'thick' }, { line: 'thick' }],
        [{ line: 'thin' }, { line: 'thin' }],
        [{ arrows: 'on' }, { arrows: true }],
        [{ arrows: 'off' }, { arrows: false }],
        [{ names: 'always' }, { names: 'always' }],
        [{ names: 'named' }, { names: 'named' }],
        [{ numbers: 'small' }, { numbers: 'small' }],
        [{ numbers: 'large' }, { numbers: 'large' }],
    ];
    for (const look of ['clean', 'classic'] as const) {
        for (const [set, want] of cases) assert.deepEqual(resolveAxes(look, {}, { ...AS_THE_LOOK, ...set }), { ...LOOK_AXES[look], ...want }, `${look} ${JSON.stringify(set)}`);
    }
    // The chart's own fields beat the settings and the look; 'auto' and unknown values are left open.
    const all: AxisSettings = { line: 'thick', arrows: 'on', names: 'always', numbers: 'large' };
    assert.deepEqual(resolveAxes('clean', { line: 'thin', arrows: 'off', names: 'named', numbers: 'small' }, all), LOOK_AXES.clean);
    assert.deepEqual(resolveAxes('classic', { arrows: false }, AS_THE_LOOK).arrows, false);
    assert.deepEqual(resolveAxes('clean', { arrows: true }, AS_THE_LOOK).arrows, true);
    assert.deepEqual(resolveAxes('clean', { line: 'auto', arrows: 'auto', names: 'bold', numbers: 3 }, all), { line: 'thick', arrows: true, names: 'always', numbers: 'large' });
});

test('axisSettingsOf: stored values become settings, anything else As the look', () => {
    assert.deepEqual(axisSettingsOf(null), AS_THE_LOOK);
    assert.deepEqual(axisSettingsOf({}), AS_THE_LOOK);
    assert.deepEqual(axisSettingsOf({ axisLines: 'thick', axisArrows: 'on', axisNames: 'always', axisNumbers: 'small' }), { line: 'thick', arrows: 'on', names: 'always', numbers: 'small' });
    assert.deepEqual(axisSettingsOf({ axisLines: 'bold', axisArrows: true, axisNames: 'x', axisNumbers: 12 }), AS_THE_LOOK);
});

test('a box, polar and 3D chart take the settings on Classic; the renderer config carries the axes', () => {
    const box = withSettings('clean', { numbers: 'small' }, () => settings('axes in a box\nplot f(x) = x').toRendererConfig());
    assert.equal(box.look, 'classic');
    assert.deepEqual(box.axes, { ...LOOK_AXES.classic, numbers: 'small' });
    const polar = withSettings('clean', { line: 'thin' }, () => settings('polar\nplot r(theta) = 1').toRendererConfig());
    assert.deepEqual(polar.axes, { ...LOOK_AXES.classic, line: 'thin' });
    const space = withSettings('clean', {}, () => settings('3d\nplot z = x y').toRendererConfig());
    assert.deepEqual(space.axes, LOOK_AXES.classic);
});

test('Axis names: Always writes x and y in Clean, Only when named drops them in Classic; own names and no names stay', () => {
    const labels = (text: string, look: ChartLook, names?: AxisSettings['names']) =>
        withSettings(look, names ? { names } : {}, () => {
            const c = settings(text).toRendererConfig();
            return [c.xLabel, c.yLabel, c.zLabel];
        });
    assert.deepEqual(labels('plot f(x) = x', 'clean'), ['', '', '']);
    assert.deepEqual(labels('plot f(x) = x', 'clean', 'always'), ['x', 'y', 'z']);
    assert.deepEqual(labels('plot f(x) = x', 'classic'), ['x', 'y', 'z']);
    assert.deepEqual(labels('plot f(x) = x', 'classic', 'named'), ['', '', '']);
    assert.deepEqual(labels('xlabel time\nplot f(x) = x', 'classic', 'named'), ['time', '', '']);
    // 3D: z too.
    assert.deepEqual(labels('3d\nplot z = x y', 'clean'), ['x', 'y', 'z']);
    assert.deepEqual(labels('3d\nplot z = x y', 'clean', 'named'), ['', '', '']);
    assert.deepEqual(labels('3d\nzlabel height\nplot z = x y', 'classic', 'named'), ['', '', 'height']);
    // The chart's own axis_names wins over the setting; set show_axis_label = false keeps every name off.
    assert.deepEqual(labels('with axis names\nplot f(x) = x', 'clean', 'named'), ['x', 'y', 'z']);
    assert.equal(withSettings('clean', { names: 'always' }, () => settings('set show_axis_label = false\nplot f(x) = x').toRendererConfig().showAxisLabels), false);
});

// ------------------------------------------------------------ the export

test('Classic with every setting As the look, or set to what Classic draws, writes the export of 6.2.0', () => {
    for (const text of [TANGENT, 'plot f(x) = x^2', 'axes on the edges\nplot f(x) = x']) {
        const plain = tikz(text, 'classic');
        assert.equal(tikz(text, 'classic', { line: 'thick', arrows: 'on', names: 'always', numbers: 'large' }), plain, text);
        assert.ok(!/axis line style|tick label style|etzAxis/.test(plain), text);
    }
    // Clean with its own values set is the clean export.
    assert.equal(tikz(TANGENT, 'clean', { line: 'thin', arrows: 'off', names: 'named', numbers: 'small' }), tikz(TANGENT, 'clean'));
});

test('Classic + small numbers: \\scriptsize numbers, the arrows and the names of Classic, the same steps', () => {
    const plain = axisOptions(tikz(TANGENT, 'classic'));
    const small = axisOptions(tikz(TANGENT, 'classic', { numbers: 'small' }));
    assert.ok(small.includes('tick label style={font=\\scriptsize}'), small.join('\n'));
    assert.ok(small.includes('xlabel={x}, ylabel={y}'), 'names kept');
    assert.ok(small.some((o) => o.startsWith('axis lines=middle')), 'axes through the middle');
    assert.ok(!small.some((o) => o.startsWith('axis line style')), 'pgfplots keeps its arrowheads');
    // Nothing else changes: pgfplots picks its own steps whatever the size of the numbers.
    assert.deepEqual(small.filter((o) => !o.startsWith('tick label style')), plain);
});

test('Classic: thin lines in the light grey, arrows off on axes but never written for a box', () => {
    const thin = tikz(TANGENT, 'classic', { line: 'thin' });
    assert.ok(axisOptions(thin).includes('axis line style={draw=etzAxis, line width=0.45pt}'), thin);
    assert.ok(thin.includes('\\definecolor{etzAxis}{HTML}{B4B7C2}'));
    const off = axisOptions(tikz(TANGENT, 'classic', { arrows: 'off' }));
    assert.ok(off.includes('axis line style={-}'), off.join('\n'));
    const both = axisOptions(tikz(TANGENT, 'classic', { line: 'thin', arrows: 'off' }));
    assert.ok(both.includes('axis line style={draw=etzAxis, line width=0.45pt, -}'), both.join('\n'));
    // A box has no arrowheads to take away; its frame takes the thin line.
    const box = axisOptions(tikz('plot f(x) = x^2', 'classic', { line: 'thin', arrows: 'off' }));
    assert.ok(box.includes('axis line style={draw=etzAxis, line width=0.45pt}'), box.join('\n'));
    assert.ok(!axisOptions(tikz('plot f(x) = x^2', 'classic', { arrows: 'off' })).some((o) => o.startsWith('axis line style')));
});

test('Clean + thick + arrows + names: pgfplots\' own axis lines with their arrowheads, x and y, the small grey numbers', () => {
    const code = tikz(TANGENT, 'clean', { line: 'thick', arrows: 'on', names: 'always' });
    const opts = axisOptions(code);
    assert.ok(!opts.some((o) => o.startsWith('axis line style')), opts.join('\n'));
    assert.ok(!code.includes('etzAxis'), 'no light grey defined');
    assert.ok(opts.includes('xlabel={x}, ylabel={y}'), opts.join('\n'));
    assert.ok(opts.includes('axis x line=middle, axis y line=middle'));
    assert.ok(opts.includes('tick label style={font=\\scriptsize, text=etzTick}'));
    // The names stand beyond the ends of the axes, as named axes always did in Clean.
    assert.ok(opts.some((o) => o.startsWith('xlabel style={at={(axis description cs:1,')), opts.join('\n'));
    // Upright above the end of the y-axis (up to 6.2.0 a rotate=-90 laid it on its side).
    assert.ok(opts.includes('ylabel style={at={(axis description cs:0.5,1)}, anchor=south, yshift=3pt}'), opts.join('\n'));
    // Thin with arrows: the light grey line with pgfplots' arrowheads.
    assert.ok(axisOptions(tikz(TANGENT, 'clean', { arrows: 'on' })).includes('axis line style={draw=etzAxis, line width=0.45pt}'));
});

test('Clean + large numbers: 10 pt numbers in the clean grey, steps with room for them', () => {
    const small = axisOptions(tikz(TANGENT, 'clean'));
    const large = axisOptions(tikz(TANGENT, 'clean', { numbers: 'large' }));
    assert.ok(large.includes('tick label style={text=etzTick}'), large.join('\n'));
    assert.ok(!large.some((o) => o.includes('\\scriptsize')));
    const steps = (opts: string[]) => (opts.find((o) => o.startsWith('xtick={')) ?? '').split(',').length;
    assert.ok(steps(large) <= steps(small), `${steps(large)} ticks for large numbers, ${steps(small)} for small ones`);
});

test('what a chart sets wins over the settings, in the export too', () => {
    const own = ['thin axes', 'axes without arrows', 'no axis letters', 'small numbers', TANGENT].join('\n');
    // Classic with these four set is Classic's export with the clean axes: thin, no arrows, no letters, small numbers.
    const opts = axisOptions(tikz(own, 'classic', { line: 'thick', arrows: 'on', names: 'always', numbers: 'large' }));
    assert.ok(opts.includes('axis line style={draw=etzAxis, line width=0.45pt, -}'), opts.join('\n'));
    assert.ok(opts.includes('tick label style={font=\\scriptsize}'));
    assert.ok(!opts.some((o) => o.startsWith('xlabel')));
    // Clean, with the chart asking for large numbers while the setting says small.
    assert.ok(axisOptions(tikz(`large numbers\n${TANGENT}`, 'clean', { numbers: 'small' })).includes('tick label style={text=etzTick}'));
});

test('3D: small numbers, the box in thin lines, no z name for Only when named; arrows never', () => {
    const surface = '3d\nshow x from -2 to 2 and y from -2 to 2\nplot z = x^2 - y^2';
    const plain = axisOptions(tikz(surface, 'clean'));
    assert.ok(!plain.some((o) => /axis line style|tick label style/.test(o)), plain.join('\n'));
    const opts = axisOptions(tikz(surface, 'clean', { line: 'thin', arrows: 'off', numbers: 'small', names: 'named' }));
    assert.ok(opts.includes('axis line style={draw=etzAxis, line width=0.45pt}'), opts.join('\n'));
    assert.ok(opts.includes('tick label style={font=\\scriptsize}'));
    assert.ok(!opts.some((o) => /label=/.test(o)), 'no axis names');
    assert.deepEqual(axisOptions(tikz(surface, 'clean', { arrows: 'on' })), plain);
    // `no axes` stays without axes whatever the settings say.
    const none = axisOptions(tikz(`${surface}\nno axes`, 'clean', { line: 'thin', numbers: 'small' }));
    assert.ok(none.includes('hide axis') && !none.some((o) => /axis line style|tick label style/.test(o)), none.join('\n'));
});

// ------------------------------------------------------------ the chart text

test('the four chart fields: left open by default; their lines in words and Full LaTeX, printed and read back the same', () => {
    const data = new SettingsManager().serialize();
    for (const k of ['axis_lines', 'axis_arrows', 'axis_names', 'axis_numbers']) assert.equal(data[k], 'auto', k);
    assert.deepEqual(minimize(parseChartText('plot f(x) = x').data), minimize(parseChartText('set axis_lines = auto\nplot f(x) = x').data));
    // Every value of the four, as its line: the field it sets, printed back as written, the same through Full LaTeX.
    const lines: Array<[string, string, string]> = [
        ['thin axes', 'axis_lines', 'thin'],
        ['thick axes', 'axis_lines', 'thick'],
        ['axes with arrows', 'axis_arrows', 'on'],
        ['axes without arrows', 'axis_arrows', 'off'],
        ['with axis names', 'axis_names', 'always'],
        ['no axis letters', 'axis_names', 'named'],
        ['small numbers', 'axis_numbers', 'small'],
        ['large numbers', 'axis_numbers', 'large'],
    ];
    for (const [line, key, value] of lines) {
        const text = `show x from -3 to 3 and y from -1 to 5\naxes in the middle\n${line}\nplot f(x) = x^2`;
        const parsed = parseChartText(text);
        assert.deepEqual(parsed.problems, [], line);
        assert.equal(parsed.data[key], value, line);
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
    }
    // All four in one chart, typed in Full LaTeX by hand, and in any order in words.
    const four = ['thick axes', 'axes with arrows', 'with axis names', 'small numbers'];
    const words = parseChartText(['plot f(x) = x^2', ...four.slice().reverse()].join('\n'));
    const latex = readBlock(['\\begin{chart}', `\\axis[${four.join(', ')}]`, '\\addplot{x^2}', '\\end{chart}'].join('\n'));
    assert.ok(typeof latex !== 'string' && !latex.problems.length, JSON.stringify(latex));
    const fours = (d: Record<string, unknown>) => [d.axis_lines, d.axis_arrows, d.axis_names, d.axis_numbers];
    if (typeof latex !== 'string') assert.deepEqual(fours(latex.data), fours(words.data));
    assert.deepEqual(fours(words.data), ['thick', 'on', 'always', 'small']);
    // set lines and JSON reach the same fields; true and false read as on and off.
    assert.deepEqual(minimize(parseChartText(['plot f(x) = x^2', 'set axis_lines = thick', 'set axis_arrows = on', 'set axis_names = always', 'set axis_numbers = small'].join('\n')).data), minimize(words.data));
    const yes = withSettings('clean', {}, () => SettingsManager.fromJSON({ v: 4, axis_arrows: true }).toRendererConfig().axes);
    assert.equal(yes?.arrows, true);
    // Unknown words keep their problem messages: `axes with grid`, `with axis`, `no axis`.
    for (const bad of ['axes with grid', 'with axis', 'no axis']) assert.ok(parseChartText(`${bad}\nplot f(x) = x`).problems.length > 0, bad);
});

test('a chart that sets its own axes in words wins over the settings: Clean + thin + no names + small, against Classic and every setting the other way', () => {
    const own = [TANGENT, 'thin axes', 'axes without arrows', 'no axis letters', 'small numbers'].join('\n');
    const opposite: Partial<AxisSettings> = { line: 'thick', arrows: 'on', names: 'always', numbers: 'large' };
    const config = withSettings('classic', opposite, () => settings(own).toRendererConfig());
    assert.deepEqual(config.axes, LOOK_AXES.clean);
    assert.equal(config.look, 'classic');
    assert.equal(config.xLabel, '');
    const opts = axisOptions(tikz(own, 'classic', opposite));
    assert.ok(opts.includes('axis line style={draw=etzAxis, line width=0.45pt, -}') && opts.includes('tick label style={font=\\scriptsize}'), opts.join('\n'));
    // And the other way: Classic's axes in a chart drawn in Clean with the clean settings.
    const classicOwn = [TANGENT, 'thick axes', 'axes with arrows', 'with axis names', 'large numbers'].join('\n');
    assert.deepEqual(withSettings('clean', { line: 'thin', arrows: 'off', names: 'named', numbers: 'small' }, () => settings(classicOwn).toRendererConfig().axes), LOOK_AXES.classic);
});
