// Auto-fit (src/fit.ts): the rules for one axis, and what a chart draws
// that the fit shows (2D and 3D), with the ranges the editor writes.
import { test, assert } from './_lib';
import { SettingsManager } from '../src/settings';
import { EXAMPLES } from '../src/migrate';
import { FitInput, FitResult, boundText, fitAxis, fitSettings, niceStep, sampleRange, stepDecimals } from '../src/fit';
import { Annotation, CurveTool, Function3DParameters, FunctionParameters, PlaneTool, PointsTool, RegionTool, SegmentTool } from '../src/types';

// ----------------------------------------------------------------- helpers

function fn(name: string, expression: string, over: Partial<FunctionParameters> = {}): FunctionParameters {
    return {
        name,
        expression,
        domain: '',
        showLegend: false,
        fill: false,
        fillOpacity: 0.2,
        fillPattern: 'solid',
        tangent: false,
        color: 'blue',
        dashed: false,
        tangentPoint: '',
        extrema: false,
        thickness: 'thick',
        parametric: false,
        expressionY: '',
        ...over,
    };
}

function surface(name: string, expression: string, over: Partial<Function3DParameters> = {}): Function3DParameters {
    return { name, expression, xDomain: '', yDomain: '', color: 'blue', wireframe: false, opacity: 0.8, samples: 30, ...over };
}

function region(name: string, conditions: string[], over: Partial<RegionTool> = {}): RegionTool {
    return {
        type: 'region',
        id: `id-${name}`,
        name,
        color: 'blue',
        conditions,
        conditionLabels: conditions.map(() => ''),
        fill: true,
        fillOpacity: 0.25,
        fillPattern: 'solid',
        outline: 'none',
        thickness: 'thin',
        constraintLines: false,
        label: '',
        ...over,
    };
}

function curve(name: string, equation: string, over: Partial<CurveTool> = {}): CurveTool {
    return { type: 'curve', id: `id-${name}`, name, color: 'red', equation, levels: '', thickness: 'thin', dashed: false, label: '', ...over };
}

function points(name: string, over: Partial<PointsTool> = {}): PointsTool {
    return {
        type: 'points',
        id: `id-${name}`,
        name,
        color: 'red',
        dim: 2,
        source: 'list',
        points: '',
        ref1: '',
        ref2: '',
        regionName: '',
        objective: '',
        sense: 'max',
        label: '',
        dropLines: false,
        size: 'normal',
        ...over,
    };
}

function segment(name: string, path: string, over: Partial<SegmentTool> = {}): SegmentTool {
    return { type: 'segment', id: `id-${name}`, name, color: 'black', dim: 2, path, closed: false, style: 'line', thickness: 'thin', dashed: false, label: '', ...over };
}

function plane(name: string, axis: 'x' | 'y' | 'z', value: string): PlaneTool {
    return { type: 'plane3D', id: `id-${name}`, name, color: 'orange', axis, value, fillOpacity: 0.25 };
}

function label(text: string, x: string, y: string, z?: string): Annotation {
    const a: Annotation = { text, x, y, color: 'black', size: 'normal', anchor: 'center' };
    if (z !== undefined) a.z = z;
    return a;
}

/** A v4 chart (blocks without `v` are 3.x ones, whose functions without a domain are hidden). */
function chart(data: Record<string, unknown>): SettingsManager {
    return SettingsManager.fromJSON({ v: 4, ...data });
}

function fit(settings: SettingsManager, free?: FitInput['free']): FitResult {
    const math = settings.createMathContext({ memo: false });
    const params = settings.getValue('parameters');
    math.setParams(Array.isArray(params) ? params : []);
    return fitSettings(settings, math, free);
}

/** Write a fit into the chart's range fields, as the editor does. */
function apply(settings: SettingsManager, result: FitResult): void {
    for (const axis of ['x', 'y', 'z'] as const) {
        const r = result[axis];
        if (!r) continue;
        settings.setValue(`${axis}min`, r.text[0]);
        settings.setValue(`${axis}max`, r.text[1]);
    }
}

/** The fitted ranges as written: { x: '-5..5', ... }; axes the fit leaves alone are missing. */
function written(result: FitResult): Record<string, string> {
    const out: Record<string, string> = {};
    for (const axis of ['x', 'y', 'z'] as const) {
        const r = result[axis];
        if (r) out[axis] = `${r.text[0]}..${r.text[1]}`;
    }
    return out;
}

function ranges(settings: SettingsManager): string {
    const axes = settings.getValue('dimension') === true ? ['x', 'y', 'z'] : ['x', 'y'];
    return axes.map((a) => `${a} ${String(settings.getValue(`${a}min`))}..${String(settings.getValue(`${a}max`))}`).join(', ');
}

// ----------------------------------------------------------------- rules

test('niceStep: 1, 2, 2.5, 5 or 10 times a power of ten, the smallest at least the raw step', () => {
    const cases: Array<[number, number]> = [
        [0.525, 1],
        [0.5, 0.5],
        [2.5, 2.5],
        [2.4, 2.5],
        [0.3, 0.5],
        [0.25, 0.25],
        [0.1, 0.1],
        [0.09999, 0.1],
        [0.11, 0.2],
        [1.98, 2],
        [6.25, 10],
        [0.05, 0.05],
        [1000, 1000],
        [1001, 2000],
        [0.0003, 0.0005],
        [12, 20],
        [22, 25],
    ];
    for (const [raw, step] of cases) assert.equal(niceStep(raw), step, `niceStep(${raw})`);
    assert.equal(niceStep(0), 1);
    assert.equal(niceStep(NaN), 1);
});

test('stepDecimals and boundText write the step and the ends without float noise', () => {
    assert.equal(stepDecimals(0.25), 2);
    assert.equal(stepDecimals(0.5), 1);
    assert.equal(stepDecimals(2.5), 1);
    assert.equal(stepDecimals(0.05), 2);
    assert.equal(stepDecimals(5), 0);
    assert.equal(stepDecimals(1000), 0);
    assert.equal(stepDecimals(0.0005), 4);
    assert.equal(boundText(-25, 1), '-25');
    assert.equal(boundText(1.25, 2), '1.25');
    assert.equal(boundText(0, 2), '0');
    assert.equal(boundText(-0, 1), '0');
    assert.equal(boundText(0.1 + 0.2, 1), '0.3');
    assert.equal(boundText(1e-7, 7), '0.0000001');
});

test('sampleRange cuts a real asymptote and keeps a peak', () => {
    const xs = Array.from({ length: 401 }, (_, i) => -10 + i * 0.05);
    const inverse = sampleRange(xs.map((x) => 1 / x));
    assert.ok(inverse && inverse[1] < 5 && inverse[0] > -5, `1/x is cut near 0: ${String(inverse)}`);
    // A narrow peak is part of the curve, not an asymptote.
    const peak = sampleRange(xs.map((x) => 10 * Math.exp(-x * x)));
    assert.deepEqual(peak, [10 * Math.exp(-100), 10]);
    assert.equal(sampleRange([NaN, Infinity]), null);
});

test('fitAxis: all values equal are widened by 1, or by 10 % when the value is large', () => {
    assert.deepEqual(fitAxis({ exact: [3] }, { pad: false })?.text, ['2', '4']);
    assert.deepEqual(fitAxis({ exact: [0, 0] }, { pad: false })?.text, ['-1', '1']);
    assert.deepEqual(fitAxis({ exact: [200] }, { pad: false })?.text, ['180', '220']);
    assert.equal(fitAxis({ exact: [NaN] }, { pad: true }), null);
    assert.equal(fitAxis({}, { pad: true }), null);
});

test('fitAxis: ends near 0 move to 0, nearly symmetric ranges become symmetric', () => {
    assert.deepEqual(fitAxis({ exact: [0.2, 10] }, { pad: false })?.text, ['0', '10']);
    assert.deepEqual(fitAxis({ exact: [-10, -0.5] }, { pad: false })?.text, ['-10', '0']);
    // 3 is too far from 0 for a span of 7.
    assert.deepEqual(fitAxis({ exact: [3, 10] }, { pad: false })?.text, ['3', '10']);
    // |lo + hi| = 1 is below 12 % of 9: symmetric. |lo + hi| = 2 is not below 12 % of 8.
    assert.deepEqual(fitAxis({ exact: [-4, 5] }, { pad: false })?.text, ['-5', '5']);
    assert.deepEqual(fitAxis({ exact: [-3, 5] }, { pad: false })?.text, ['-3', '5']);
    // Float noise at 0 is 0 (a fill's edge at -1e-17 gets no padding).
    assert.deepEqual(fitAxis({ exact: [-1e-17, 19] }, { pad: true })?.text, ['0', '20']);
});

test('fitAxis: 2D pads 5 % except at 0 and at a hard (domain) end', () => {
    // -1..1 padded to -1.1..1.1, step niceStep(2.2 / 20) = 0.2.
    assert.deepEqual(fitAxis({ exact: [-1, 1] }, { pad: true })?.text, ['-1.2', '1.2']);
    assert.deepEqual(fitAxis({ exact: [-1, 1] }, { pad: false })?.text, ['-1', '1']);
    assert.deepEqual(fitAxis({ exact: [0, 10] }, { pad: true })?.text, ['0', '11']);
    assert.deepEqual(fitAxis({ exact: [2, 9], hard: [2, 9] }, { pad: true })?.text, ['2', '9']);
    assert.deepEqual(fitAxis({ exact: [2, 9], hard: [2] }, { pad: true })?.text, ['2', '9.5']);
    // 1 is within 15 % of the span from 0: it moves to 0 even when it is a domain end.
    assert.deepEqual(fitAxis({ exact: [1, 9], hard: [1, 9] }, { pad: true })?.text, ['0', '9']);
    // Symmetric from a hard end: both ends stay; from a point: both are padded.
    assert.deepEqual(fitAxis({ exact: [-3, 2.8], hard: [-3] }, { pad: true })?.text, ['-3', '3']);
    assert.deepEqual(fitAxis({ exact: [-2.8, 3], hard: [-2.8] }, { pad: true })?.text, ['-3.5', '3.5']);
});

test('fitAxis: a sampled asymptote is cut, a point beside it is not', () => {
    const xs = Array.from({ length: 401 }, (_, i) => -10 + i * 0.05);
    const ys = xs.map((x) => 1 / x);
    const curveOnly = fitAxis({ samples: [ys] }, { pad: false });
    assert.ok(curveOnly && curveOnly.max <= 5, `cut: ${String(curveOnly?.text)}`);
    const withPoint = fitAxis({ samples: [ys], exact: [30] }, { pad: false });
    assert.ok(withPoint && withPoint.max >= 30, `the point stays: ${String(withPoint?.text)}`);
});

// ----------------------------------------------------------------- 3D

function chart3D(over: Record<string, unknown>): SettingsManager {
    return chart({ dimension: true, ...over });
}

test('3D: z = x^2 - y^2 on -5..5 gives a -5..5 by -5..5 by -25..25 box', () => {
    const domains = { xDomain: '-5:5', yDomain: '-5:5' };
    assert.deepEqual(written(fit(chart3D({ functions3D: [surface('f1', 'x^2 - y^2', domains)] }))), { x: '-5..5', y: '-5..5', z: '-25..25' });
    // Without domains the surface follows the view: the same box from a -5..5 view.
    const viewOnly = chart3D({ xmin: '-5', xmax: '5', ymin: '-5', ymax: '5', functions3D: [surface('f1', 'x^2 - y^2')] });
    assert.deepEqual(written(fit(viewOnly)), { x: '-5..5', y: '-5..5', z: '-25..25' });
});

test('3D: the z range of common surfaces', () => {
    const cases: Array<[string, string, string]> = [
        ['sin(sqrt(x^2 + y^2))', '-6:6', '-1..1'],
        ['exp(-(x^2 + y^2)/4)', '-3:3', '0..1'],
        ['x*y', '-3:3', '-9..9'],
        ['cos(x) + sin(y)', '-6:6', '-2..2'],
    ];
    for (const [expression, domain, z] of cases) {
        const result = fit(chart3D({ functions3D: [surface('f1', expression, { xDomain: domain, yDomain: domain })] }));
        const [a, b] = domain.split(':');
        assert.deepEqual(written(result), { x: `${a}..${b}`, y: `${a}..${b}`, z }, expression);
    }
});

test('3D: points, segment ends, planes and labels count; no padding', () => {
    const s = chart3D({
        tools: [
            { ...points('P1', { dim: 3, points: '(1, 2, 3); (-4, 0, 1)' }) },
            segment('S1', '(0, 0, 0); (2, 6, -2)', { dim: 3 }),
            plane('PL1', 'z', '8'),
        ],
        annotations: [label('top', '0', '0', '9')],
    });
    assert.deepEqual(written(fit(s)), { x: '-4..2', y: '0..6', z: '-2..9' });
    const none = fit(chart3D({ functions3D: [surface('f1', '')] }));
    assert.equal(none.nothing, 'empty');
});

test('3D: hidden and broken surfaces are left out', () => {
    const s = chart3D({
        functions3D: [
            surface('f1', 'x + y', { xDomain: '0:1', yDomain: '0:1' }),
            surface('f2', '100*x', { xDomain: '0:1', yDomain: '0:1', hidden: true }),
            surface('f3', 'x +* y', { xDomain: '-50:50', yDomain: '0:1' }),
        ],
    });
    assert.deepEqual(written(fit(s)), { x: '0..1', y: '0..1', z: '0..2' });
});

// ----------------------------------------------------------------- 2D functions

test('2D: y = sin(x) without a domain keeps x and fits y to -1.2..1.2', () => {
    const s = chart({ xmin: '-10', xmax: '10', functions: [fn('f1', 'sin(x)')] });
    assert.deepEqual(written(fit(s)), { y: '-1.2..1.2' });
});

test('2D: y = 1/x on 0.1..5 gives x 0..5 and y 0..11', () => {
    const s = chart({ functions: [fn('f1', '1/x', { domain: '0.1:5' })] });
    assert.deepEqual(written(fit(s)), { x: '0..5', y: '0..11' });
});

test('2D: y = x^2/4 + 0.3 on -3..3 gives x -3..3 and y 0..2.8', () => {
    const s = chart({ functions: [fn('f1', 'x^2/4 + 0.3', { domain: '-3:3' })] });
    assert.deepEqual(written(fit(s)), { x: '-3..3', y: '0..2.8' });
});

test('2D: y = x^3 - 3x over -3..3 fitted twice gives the same ranges', () => {
    const s = chart({ xmin: '-3', xmax: '3', functions: [fn('f1', 'x^3 - 3x')] });
    apply(s, fit(s));
    assert.equal(ranges(s), 'x -3..3, y -20..20');
    apply(s, fit(s));
    assert.equal(ranges(s), 'x -3..3, y -20..20');
    // With a domain the same chart fits the same.
    const d = chart({ functions: [fn('f1', 'x^3 - 3x', { domain: '-3:3' })] });
    apply(d, fit(d));
    assert.equal(ranges(d), 'x -3..3, y -20..20');
    apply(d, fit(d));
    assert.equal(ranges(d), 'x -3..3, y -20..20');
});

test('2D: an asymptote does not blow out the y range', () => {
    const s = chart({ xmin: '-10', xmax: '10', functions: [fn('f1', '1/x')] });
    const y = fit(s).y;
    assert.ok(y && y.max <= 6 && y.min >= -6, `1/x: ${String(y?.text)}`);
    const tan = fit(chart({ xmin: '-10', xmax: '10', functions: [fn('f1', 'tan(x)')] })).y;
    assert.ok(tan && tan.max < 100 && tan.min > -100, `tan x: ${String(tan?.text)}`);
});

test('2D: parametric and polar curves fit both axes over their parameter range', () => {
    const circle = chart({ functions: [fn('f1', '3cos(t)', { parametric: true, expressionY: '3sin(t)', domain: '0:2pi' })] });
    assert.deepEqual(written(fit(circle)), { x: '-3.5..3.5', y: '-3.5..3.5' });
    const polar = chart({ coordinateSystem: 'polar', functions: [fn('f1', '2')] });
    assert.deepEqual(written(fit(polar)), { x: '-2.25..2.25', y: '-2.25..2.25' });
});

test('2D: x stays when a function has no domain; only what lies over it counts for y', () => {
    const s = chart({
        xmin: '0',
        xmax: '4',
        functions: [fn('f1', 'x')],
        tools: [points('P1', { points: '(2, 3); (50, 100)' })],
    });
    // (50, 100) is outside the x range: y fits f1 (0..4) and (2, 3) only.
    assert.deepEqual(written(fit(s)), { y: '0..4.25' });
});

test('2D: a range written as an expression stays; y is then fitted over the x range', () => {
    const s = chart({
        parameters: [{ name: 'a', value: 2, min: 0, max: 5, step: 1 }],
        xmin: '-a',
        xmax: 'a',
        functions: [fn('f1', 'x^2', { domain: '-4:4' })],
    });
    // Only x in -2..2 is shown: y = x^2 there is 0..4.
    assert.deepEqual(written(fit(s, { x: false, y: true })), { y: '0..4.25' });
});

test('2D: hidden, blank and broken functions are left out', () => {
    const s = chart({
        functions: [fn('f1', 'x', { domain: '0:1' }), fn('f2', '100x', { domain: '0:1', hidden: true }), fn('f3', ''), fn('f4', 'x +* 2', { domain: '-50:50' })],
    });
    assert.deepEqual(written(fit(s)), { x: '0..1', y: '0..1.1' });
});

// ----------------------------------------------------------------- 2D everything else

test('2D: a chart with only points fits them', () => {
    const s = chart({ tools: [points('P1', { points: '(1, 2); (3, 4); (-1, 6)' })] });
    // x -1..3 and y 2..6 padded by 0.2, then rounded out to steps of 0.25.
    assert.deepEqual(written(fit(s)), { x: '-1.25..3.25', y: '1.75..6.25' });
});

test('2D: labels, segments, arrows, polylines and braces count', () => {
    const lbl = chart({ annotations: [label('A', '2', '7'), label('B', '6', '1'), label('', '100', '100'), { ...label('C', '-50', '0'), hidden: true }] });
    assert.deepEqual(written(fit(lbl)), { x: '1.75..6.25', y: '0.5..7.5' });
    const shapes = chart({
        tools: [
            segment('S1', '(0, 0); (4, 1)'),
            segment('S2', '(1, 1); (1, 5)', { style: 'forward' }),
            segment('S3', '(2, 2); (3, 4); (5, -2)', { closed: true }),
            segment('B1', '(-3, 0); (-3, 2)', { style: 'brace' }),
        ],
    });
    assert.deepEqual(written(fit(shapes)), { x: '-3.5..5.5', y: '-2.5..5.5' });
});

test('2D: a bounded region counts, an unbounded one does not', () => {
    const disc = chart({ tools: [region('R1', ['x^2 + y^2 <= 25'])] });
    assert.deepEqual(written(fit(disc)), { x: '-6..6', y: '-6..6' });
    const half = fit(chart({ tools: [region('R1', ['x + y <= 4'])] }));
    assert.equal(half.nothing, 'unbounded');
    assert.equal(fit(chart({})).nothing, 'empty');
    // A region that draws nothing (no fill, outline or lines) is left out.
    assert.equal(fit(chart({ tools: [region('R1', ['x^2 + y^2 <= 25'], { fill: false })] })).nothing, 'empty');
});

test('2D: a disc seen in part is fitted whole', () => {
    const s = chart({ xmin: '1', xmax: '2', ymin: '1', ymax: '2', tools: [region('R1', ['x^2 + y^2 <= 25'])] });
    assert.deepEqual(written(fit(s)), { x: '-6..6', y: '-6..6' });
});

test('2D: implicit curves: a circle counts, a line does not', () => {
    const s = chart({ tools: [curve('C1', 'x^2 + y^2 = 4'), curve('C2', '3x + 2y = 12')] });
    assert.deepEqual(written(fit(s)), { x: '-2.25..2.25', y: '-2.25..2.25' });
    assert.equal(fit(chart({ tools: [curve('C1', 'y = x^2')] })).nothing, 'unbounded');
});

test('2D: the feasible region of the Linear program example, its corners and its optimum', () => {
    const lp = EXAMPLES.find((e) => e.id === 'lp');
    assert.ok(lp);
    const s = chart(lp.data);
    // Feasible region (0, 0), (4, 0), (3, 1), (0, 2); its constraint lines and C1 are unbounded.
    const first = fit(s);
    assert.deepEqual(written(first), { x: '0..4.25', y: '0..2.2' });
    apply(s, first);
    assert.deepEqual(written(fit(s)), { x: '0..4.25', y: '0..2.2' });
});

test('2D: computed points count: an intersection of two lines outside the view', () => {
    const s = chart({
        tools: [curve('C1', 'y = x + 10'), curve('C2', 'y = -x + 20'), points('P1', { source: 'intersections', ref1: 'C1', ref2: 'C2' })],
    });
    // The lines meet at (5, 15), above the default view: the fit centres on the point.
    assert.deepEqual(written(fit(s)), { x: '3.8..6.2', y: '13.2..16.8' });
});

test('2D: with x fixed, a circle larger than the first window counts over the x range', () => {
    const s = chart({ xmin: '-10', xmax: '10', functions: [fn('f1', 'sin(x)')], tools: [curve('C1', 'x^2 + y^2 = 400')] });
    // Over x = -10..10 the circle reaches y = +-20 (at x = 0).
    assert.deepEqual(written(fit(s)), { y: '-22.5..22.5' });
});

test('2D: computed points without end count where the chart shows them, and the fit stays', () => {
    const s = chart({
        tools: [curve('C1', 'y = sin(x)'), curve('C2', 'y = 0.5'), points('P1', { source: 'intersections', ref1: 'C1', ref2: 'C2' })],
    });
    // sin(x) = 0.5 has a crossing every pi: only the four in the view (x 0.52 to 8.9) count.
    const first = fit(s);
    assert.deepEqual(written(first), { x: '0..9.5', y: '-0.6..1.6' });
    apply(s, first);
    assert.deepEqual(written(fit(s)), { x: '0..9.5', y: '-0.6..1.6' });
});

test('2D: a function fill with a domain counts down to y = 0, a tangent does not', () => {
    const s = chart({ functions: [fn('f1', 'x^2 + 10', { domain: '-3:3', fill: true, tangent: true, tangentPoint: '1' })] });
    assert.deepEqual(written(fit(s)), { x: '-3..3', y: '0..20' });
});

test('2D: every example fits and the fit is stable', () => {
    for (const example of EXAMPLES) {
        const s = chart(example.data);
        const first = fit(s);
        assert.ok(!first.nothing, `${example.id}: ${String(first.nothing)}`);
        for (const axis of ['x', 'y', 'z'] as const) {
            const r = first[axis];
            if (!r) continue;
            assert.ok(r.min < r.max, `${example.id} ${axis}`);
            for (const text of r.text) assert.ok(/^-?\d+(\.\d+)?$/.test(text), `${example.id} ${axis}: ${text}`);
        }
        apply(s, first);
        const before = ranges(s);
        apply(s, fit(s));
        assert.equal(ranges(s), before, example.id);
    }
});

test('the fit only reads the chart: the editor writes the ranges', () => {
    for (const example of EXAMPLES) {
        const s = chart(example.data);
        const before = JSON.stringify(s.serialize());
        fit(s);
        assert.equal(JSON.stringify(s.serialize()), before, example.id);
    }
});
