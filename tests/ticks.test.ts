// The numbers on an axis (src/ticks.ts, issue #5): Auto, Every a step, At
// chosen values with labels, Off; multiples of π; the At list; and the
// pgfplots options that make the PDF show the preview's numbers.
import { test, assert } from './_lib';
import { AUTO_NUMBERS, AxisNumbers, axisTicks, mentionsPi, numbersMode, parseNumbersAt, piMultiple, tickOptions } from '../src/ticks';
import { SettingsManager } from '../src/settings';

const ctx = SettingsManager.fromJSON({ v: 4, parameters: [{ name: 'a', value: 1.5, min: 0, max: 5, step: 0.1 }] }).createMathContext({ memo: false });
ctx.setParams([{ name: 'a', value: 1.5, min: 0, max: 5, step: 0.1 }]);
const valueOf = (s: string) => ctx.value(s);
const AUTO = [0, 2, 4, 6];
const num = (v: number) => String(Number(v.toPrecision(10)));
const labelTex = (raw: string) => raw;
const n = (over: Partial<AxisNumbers>): AxisNumbers => ({ ...AUTO_NUMBERS, ...over });

test('ticks: Auto keeps the renderer\'s own ticks, numbers and grid', () => {
    const t = axisTicks(AUTO_NUMBERS, 0, 6.5, AUTO, valueOf);
    assert.equal(t.mode, 'auto');
    assert.deepEqual(t.ticks.map((k) => k.text), ['0', '2', '4', '6']);
    assert.ok(t.marks);
    assert.deepEqual(t.grid, AUTO);
    assert.deepEqual(tickOptions('x', t, num, labelTex), []);
});

test('ticks: Off has no numbers and no marks, and keeps the grid', () => {
    const t = axisTicks(n({ mode: 'off' }), 0, 6.5, AUTO, valueOf);
    assert.deepEqual(t.ticks, []);
    assert.equal(t.marks, false);
    assert.deepEqual(t.grid, AUTO);
    assert.deepEqual(tickOptions('y', t, num, labelTex), ['yticklabels={}', 'y tick style={draw=none}']);
});

test('ticks: Every puts a tick on each multiple of the step', () => {
    const t = axisTicks(n({ mode: 'every', step: '0.5' }), -1.2, 1.2, AUTO, valueOf);
    assert.deepEqual(t.ticks.map((k) => k.value), [-1, -0.5, 0, 0.5, 1]);
    assert.deepEqual(t.ticks.map((k) => k.text), ['-1', '-0.5', '0', '0.5', '1']);
    assert.deepEqual(t.grid, [-1, -0.5, 0, 0.5, 1]);
    assert.deepEqual(tickOptions('x', t, num, labelTex), ['xtick distance=0.5']);
    // A slider can be the step.
    assert.deepEqual(axisTicks(n({ mode: 'every', step: 'a' }), 0, 4, AUTO, valueOf).ticks.map((k) => k.value), [0, 1.5, 3]);
});

test('ticks: Every with pi prints multiples of π and lists them for the PDF', () => {
    const t = axisTicks(n({ mode: 'every', step: 'pi/2' }), -0.3, 6.6, AUTO, valueOf);
    assert.deepEqual(t.ticks.map((k) => k.text), ['0', 'π/2', 'π', '3π/2', '2π']);
    assert.ok(t.pi);
    const opts = tickOptions('x', t, num, labelTex);
    assert.equal(opts.length, 2);
    assert.ok(opts[0].startsWith('xtick={0,1.570796327,3.141592654,'), opts[0]);
    assert.equal(opts[1], 'xticklabels={{$0$},{$\\frac{\\pi}{2}$},{$\\pi$},{$\\frac{3\\pi}{2}$},{$2\\pi$}}');
});

test('ticks: At lists chosen values with their labels, sorted, inside the view', () => {
    const t = axisTicks(n({ mode: 'at', at: '3pi/2 "b", pi/2 "a", 9 "far", 2' }), 0, 6.5, AUTO, valueOf);
    assert.deepEqual(t.ticks.map((k) => k.text), ['a', '2', 'b']);
    assert.deepEqual(t.grid.map((v) => Number(v.toFixed(4))), [1.5708, 2, 4.7124]);
    const opts = tickOptions('x', t, num, labelTex);
    assert.equal(opts[1], 'xticklabels={{a},{$\\pgfmathprintnumber{2}$},{b}}');
    // Values without labels: only the positions, pgfplots prints the numbers.
    assert.deepEqual(tickOptions('y', axisTicks(n({ mode: 'at', at: '-2, 2' }), -3, 3, AUTO, valueOf), num, labelTex), ['ytick={-2,2}']);
    // A value in pi without a label prints as one.
    assert.deepEqual(axisTicks(n({ mode: 'at', at: 'pi' }), 0, 4, AUTO, valueOf).ticks.map((k) => k.text), ['π']);
    // A slider value, and none in the view: no ticks at all.
    assert.deepEqual(axisTicks(n({ mode: 'at', at: 'a "a"' }), 0, 4, AUTO, valueOf).ticks.map((k) => [k.value, k.text]), [[1.5, 'a']]);
    assert.deepEqual(tickOptions('x', axisTicks(n({ mode: 'at', at: '9' }), 0, 4, AUTO, valueOf), num, labelTex), ['xtick=\\empty']);
});

test('ticks: a step or a value that cannot be read falls back to Auto and says which', () => {
    for (const step of ['', '0', '-1', 'b', '1/0']) {
        const t = axisTicks(n({ mode: 'every', step }), 0, 6.5, AUTO, valueOf);
        assert.equal(t.mode, 'auto', step);
        assert.equal(t.problem, 'step', step);
        assert.deepEqual(t.ticks.map((k) => k.value), AUTO);
    }
    // More than MAX_TICKS ticks is a problem too.
    assert.equal(axisTicks(n({ mode: 'every', step: '0.001' }), 0, 10, AUTO, valueOf).problem, 'step');
    assert.equal(axisTicks(n({ mode: 'at', at: '1, nope' }), 0, 6.5, AUTO, valueOf).problem, 'at');
    assert.equal(axisTicks(n({ mode: 'at', at: '' }), 0, 6.5, AUTO, valueOf).problem, 'at');
});

test('ticks: the At list splits at commas outside brackets and quotes', () => {
    assert.deepEqual(parseNumbersAt('1, 3'), [{ src: '1', label: null }, { src: '3', label: null }]);
    assert.deepEqual(parseNumbersAt('max(a, 2) "top, right", pi "$\\pi$"'), [
        { src: 'max(a, 2)', label: 'top, right' },
        { src: 'pi', label: '$\\pi$' },
    ]);
    assert.deepEqual(parseNumbersAt(' , 2 ,'), [{ src: '2', label: null }]);
    assert.deepEqual(parseNumbersAt('a ""'), [{ src: 'a', label: '' }]);
});

test('ticks: multiples of π and what counts as a formula with pi', () => {
    const cases: Array<[number, string, string]> = [
        [Math.PI, 'π', '$\\pi$'],
        [-Math.PI / 2, '-π/2', '$-\\frac{\\pi}{2}$'],
        [(3 * Math.PI) / 2, '3π/2', '$\\frac{3\\pi}{2}$'],
        [2 * Math.PI, '2π', '$2\\pi$'],
        [Math.PI / 3, 'π/3', '$\\frac{\\pi}{3}$'],
        [(2 * Math.PI) / 4, 'π/2', '$\\frac{\\pi}{2}$'],
        [0, '0', '$0$'],
    ];
    for (const [v, text, tex] of cases) assert.deepEqual(piMultiple(v), { text, tex }, String(v));
    assert.equal(piMultiple(1), null);
    assert.ok(mentionsPi('pi/2') && mentionsPi('3pi/2') && mentionsPi('2 * pi') && mentionsPi('π'));
    assert.ok(!mentionsPi('api') && !mentionsPi('pi2') && !mentionsPi('0.5'));
    assert.equal(numbersMode('every'), 'every');
    assert.equal(numbersMode('sometimes'), 'auto');
    assert.equal(numbersMode(undefined), 'auto');
});

test('ticks: a chart stores its numbers per axis and passes them to the renderers', () => {
    const chart = SettingsManager.fromJSON({ v: 4, numbers_x: 'every', numbers_step_x: 'pi/2', numbers_y: 'off', numbers_at_z: '1, 2' });
    const config = chart.toRendererConfig(chart.createMathContext({ memo: false }));
    assert.deepEqual(config.numbers.x, { mode: 'every', step: 'pi/2', at: '' });
    assert.deepEqual(config.numbers.y, { mode: 'off', step: '', at: '' });
    // The values stay stored while the mode is Auto.
    assert.deepEqual(config.numbers.z, { mode: 'auto', step: '', at: '1, 2' });
    // Charts that never chose keep Auto, and nothing new is stored for them.
    const plain = SettingsManager.fromJSON({ v: 4 });
    assert.deepEqual(plain.toRendererConfig(plain.createMathContext({ memo: false })).numbers.x, AUTO_NUMBERS);
});
