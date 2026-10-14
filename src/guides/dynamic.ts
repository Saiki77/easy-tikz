/*
 * Guides about live calculations and sliders: an animation with the play
 * button, the secant that turns into the tangent, an area that grows with
 * its slider, and arithmetic with the values a points card publishes.
 *
 * Every step chart is the state the editor is in after the reader did what
 * the step says, starting from a new chart: the same recipes (+ Add), the
 * same defaults (colours, names, the slider an "Add slider" fix makes) and
 * the same list order. Charts are built from the defaults in src/migrate.ts
 * so every key is present, and each one is a fresh object: no two steps
 * share an array.
 */
import { SCHEMA_VERSION, defaultFunction, defaultParameter, defaultTool } from '../migrate';
import type { FunctionParameters, Parameter, PointsTool, RegionTool, SegmentTool, CurveTool, Tool } from '../types';
import type { ChartData, Guide } from './types';

// ------------------------------------------------------------------ builders

const NO_ITEMS: { is3D: boolean; tools: Tool[]; functions: FunctionParameters[] } = { is3D: false, tools: [], functions: [] };

/** A new chart as the editor creates it (the SettingsManager defaults), with overrides. Always a deep copy. */
function chart(overrides: Record<string, unknown> = {}): ChartData {
    const data: ChartData = {
        v: SCHEMA_VERSION,
        dimension: false,
        documentSetup: true,
        title: '',
        size_x_cm: 10,
        size_y_cm: 10,
        show_axis_label: true,
        axis_label_x: 'x',
        axis_label_y: 'y',
        showAxis: true,
        showLargeGrid: false,
        showSmallGrid: false,
        gridSize: 5,
        majorTickNum: 8,
        xmin: '-0.5',
        xmax: '10',
        ymin: '-0.5',
        ymax: '5',
        zmin: '-5',
        zmax: '5',
        axis_style: 'box',
        coordinateSystem: 'cartesian',
        axis_label_x_polar: '',
        axis_label_y_polar: '',
        axis_label_z: 'z',
        rotationX: 30,
        rotationZ: 45,
        zoom3D: 1,
        boxAspect: 'true',
        previewSize: 760,
        functions: [],
        functions3D: [],
        tools: [],
        annotations: [],
        parameters: [],
        variables: 'x, y',
        equalScale: false,
        showSlidersInNote: true,
        ...overrides,
    };
    return JSON.parse(JSON.stringify(data)) as ChartData;
}

/** A function card as + Add creates it, with `fields` on top. New cards take black, then blue, then red. */
function fn(name: string, expression: string, fields: Partial<FunctionParameters> = {}): FunctionParameters {
    return { ...defaultFunction([]), name, expression, ...fields };
}

/** A slider as the "Add slider" fix creates it (from -10 to 10 in steps of 0.1), at `value`, with `fields` on top. */
function slider(name: string, value: number, fields: Partial<Parameter> = {}): Parameter {
    return { ...defaultParameter([], name), value, ...fields };
}

function points(id: string, name: string, fields: Partial<PointsTool>): PointsTool {
    const base = defaultTool('points', NO_ITEMS) as PointsTool;
    return { ...base, id, name, ...fields };
}

/** A region card (blue, filled at 25 %, no outline), one label slot per condition. */
function region(id: string, name: string, conditions: string[], fields: Partial<RegionTool> = {}): RegionTool {
    const base = defaultTool('region', NO_ITEMS) as RegionTool;
    return { ...base, id, name, conditions, conditionLabels: conditions.map(() => ''), ...fields };
}

function curve(id: string, name: string, equation: string, fields: Partial<CurveTool> = {}): CurveTool {
    const base = defaultTool('curve', NO_ITEMS) as CurveTool;
    return { ...base, id, name, equation, ...fields };
}

function segment(id: string, name: string, path: string, fields: Partial<SegmentTool> = {}): SegmentTool {
    const base = defaultTool('segment', NO_ITEMS) as SegmentTool;
    return { ...base, id, name, path, ...fields };
}

/** Paragraphs of a step body (blank line between them). */
function paragraphs(...parts: string[]): string {
    return parts.join('\n\n');
}

/** A '- ' list inside a step body. */
function list(...items: string[]): string {
    return items.map((item) => `- ${item}`).join('\n');
}

// ------------------------------------------------------------- animate-play

function animateGuide(): Guide {
    // A wide picture: the unit circle left of the y-axis, one period of the sine wave right of it.
    const view = { xmin: '-3', xmax: '7', ymin: '-1.5', ymax: '1.5', axis_style: 'middle', equalScale: true, size_x_cm: 15, size_y_cm: 5 };
    const circle = curve('t0', 'C1', '(x + 1.5)^2 + y^2 = 1');
    const both = points('t1', 'P1', { points: '(cos(a) - 1.5, sin(a)); (a, sin(a))' });
    const wave = fn('f1', 'sin(x)', { domain: '0:a', color: 'blue' });
    const path = segment('t2', 'S1', '(-1.5, 0); P1', { dashed: true });
    const turn = (value: number) => slider('a', value, { min: 0.01, max: 6.28, step: 0.01 });
    const title = 'a = {a:2}, sin(a) = {sin(a):2}';
    const finished = chart({ ...view, title, parameters: [turn(4)], functions: [wave], tools: [circle, both, path] });
    return {
        id: 'animate-play',
        title: 'Animate a chart with play',
        summary: 'A point runs around the unit circle while the sine curve draws itself behind it: one slider in points, a domain, a path and the title, then press play.',
        category: 'Functions and sliders',
        level: 'core',
        minutes: 8,
        outcomes: [
            'Move points, a domain and a path with one slider',
            'Choose the range and the step of a slider for an animation',
            'Play a slider and print live values in the title',
        ],
        requires: ['sliders'],
        chart: finished,
        steps: [
            {
                title: 'Set up a wide view',
                body: paragraphs(
                    'Start with a new chart and open the Chart tab. Under Ranges set x from -3 to 7 and y from -1.5 to 1.5. Under Axes choose the style Middle and switch on Equal scale. Under Export size drag Width to 15 cm and Height to 5 cm.',
                    'The picture will hold a circle on the left and one period of a sine wave on the right. Equal scale keeps the circle round, and the wide export size gives the long x range the room it needs.'
                ),
                type: [
                    { where: 'Chart > Ranges, x from', text: '-3' },
                    { where: 'Chart > Ranges, x to', text: '7' },
                    { where: 'Chart > Ranges, y from', text: '-1.5' },
                    { where: 'Chart > Ranges, y to', text: '1.5' },
                ],
                chart: chart({ ...view }),
                shot: {
                    tab: 'chart',
                    actions: [{ focus: ['chart', 'ymax'] }],
                    caption: 'Ranges, the Middle axis style, Equal scale and a wide export size, all in the Chart tab.',
                },
                tip: 'With Equal scale on, one unit has the same length on both axes and the rest of the canvas stays empty. An export size with the same proportions as the ranges leaves no empty space.',
            },
            {
                title: 'Draw the unit circle',
                body: paragraphs(
                    'Go back to the Build tab, click + Add and choose Circle in the group Curves and lines. Replace the equation of the new card C1 with the one below.',
                    'It is the circle of radius 1 around (-1.5, 0). It sits left of the y-axis, so the sine wave has the right half of the picture to itself.'
                ),
                type: [{ where: 'C1, Equation', text: '(x + 1.5)^2 + y^2 = 1' }],
                chart: chart({ ...view, tools: [circle] }),
                shot: {
                    reveal: ['C1'],
                    actions: [{ focus: ['C1', 'equation'] }],
                    caption: 'The unit circle, moved 1.5 to the left.',
                },
            },
            {
                title: 'Put two points on a slider',
                body: paragraphs(
                    'Click + Add and choose Points from a list. Replace the sample points with the two below. The name `a` is unknown, so a button Add slider a appears under the field. Click it. The slider starts at 1.',
                    'The first point is `(cos(a), sin(a))` moved 1.5 to the left: the point of the circle at the angle a, measured in radians. The second point has the same height, sin(a), but sits at x = a. That is where the sine curve will end.'
                ),
                type: [{ where: 'P1, Points', text: '(cos(a) - 1.5, sin(a)); (a, sin(a))' }],
                chart: chart({ ...view, parameters: [slider('a', 1)], tools: [circle, both] }),
                shot: {
                    reveal: ['P1', 'a'],
                    actions: [{ focus: ['P1', 'points'] }],
                    caption: 'Two points computed from the slider a: one on the circle, one at the same height at x = a.',
                },
                tip: 'Points from a list take formulas. Anything that gives a number works inside the brackets, sliders included.',
            },
            {
                title: 'Draw the sine curve up to a',
                body: paragraphs(
                    'Click + Add and choose Function y = f(x). Type `sin(x)` into the new card f1 and `0:a` into its Domain field. Click the colour swatch on the card and pick Blue.',
                    'The curve is drawn from x = 0 to x = a only, so it ends exactly at the second point. When a grows, the curve grows with it.'
                ),
                type: [
                    { where: 'f1, y =', text: 'sin(x)' },
                    { where: 'f1, Domain', text: '0:a' },
                ],
                chart: chart({ ...view, parameters: [slider('a', 1)], functions: [wave], tools: [circle, both] }),
                shot: {
                    reveal: ['f1'],
                    actions: [{ focus: ['f1', 'domain'] }],
                    caption: 'The domain 0:a stops the curve at the second point.',
                },
                tip: 'A domain needs its end after its start. At a = 0 the domain `0:a` is empty and the card reports an error, which is why a stays above 0 later on.',
            },
            {
                title: 'Join the points with one path',
                body: paragraphs(
                    'Click + Add and choose Line segment. Replace the path of the card S1 with the one below and switch on Dashed in the Line row.',
                    'A path entry can be the name of a points card: `P1` stands for its two points, in order. So the path runs from the centre of the circle to the point on the circle, which draws the radius, and on to the end of the curve at the same height.'
                ),
                type: [{ where: 'S1, Path', text: '(-1.5, 0); P1' }],
                chart: chart({ ...view, parameters: [slider('a', 1)], functions: [wave], tools: [circle, both, path] }),
                shot: {
                    reveal: ['S1'],
                    actions: [{ focus: ['S1', 'path'] }],
                    caption: 'One path through the centre, the point on the circle and the end of the curve.',
                },
                tip: 'The path follows P1 by itself. Every point the card computes is part of the path, wherever it moves.',
            },
            {
                title: 'Give a a range and a step',
                body: paragraphs(
                    'In the Sliders dock, open the menu behind the three dots on the row of a and set Min to 0.01, Max to 6.28 and Step to 0.01. Then drag a to 2.',
                    'The range is one full turn, since 6.28 is about 2π. It starts just above 0, because the domain `0:a` needs some length. The step is the grid the slider stops on: with 0.01 you can stop at 3.14, half a turn.'
                ),
                type: [
                    { where: 'Sliders, a: Min', text: '0.01' },
                    { where: 'Sliders, a: Max', text: '6.28' },
                    { where: 'Sliders, a: Step', text: '0.01' },
                ],
                chart: chart({ ...view, parameters: [turn(2)], functions: [wave], tools: [circle, both, path] }),
                shot: {
                    reveal: ['a'],
                    actions: [{ slider: ['a', 2] }],
                    caption: 'a = 2: the point has gone a third of the way round, and the curve has grown with it.',
                },
                tip: 'The small numbers at the two ends of a slider are its Min and Max as well. Click one and type to change it.',
            },
            {
                title: 'Press play and print the values',
                body: paragraphs(
                    'Open the Chart tab and type the title below. Back in the Build tab, click the play button on the row of a.',
                    'The point runs around the circle, the dashed path follows, and the sine curve grows behind the second point: one turn in about four seconds, then back again. The title prints the angle and its sine on every frame. Click the button again to stop, for example near a = 4.',
                    'While it plays, a moves on a finer grid than its step, so the motion is smooth. When you stop, it snaps back onto the step.'
                ),
                type: [{ where: 'Chart > Axes, Title', text: title }],
                chart: finished,
                shot: {
                    reveal: ['a'],
                    actions: [{ slider: ['a', 4] }],
                    caption: 'Stopped at a = 4: past half a turn, the point is below the axis and the sine is negative.',
                },
                tip: 'A sweep takes about four seconds whatever the range. In a note, the slider strip under the chart has no play button: drag a there instead.',
            },
        ],
        next: ['secant-tangent', 'area-accumulation', 'charts-in-notes'],
    };
}

// ----------------------------------------------------------- secant-tangent

function secantGuide(): Guide {
    const curveFn = fn('f1', 'x^2/10');
    const withTangent = fn('f1', 'x^2/10', { tangent: true, tangentPoint: 'a' });
    const secant = fn('f2', 'f1(a) + (f1(a + h) - f1(a))/h * (x - a)', { color: 'blue' });
    const named = points('t0', 'P1', { points: '(a, f1(a)); (a + h, f1(a + h))', label: 'A; B' });
    const quotient = '(f1(a + h) - f1(a))/h';
    const secantTitle = `secant slope = {${quotient}:3}`;
    const bothTitle = `secant slope {${quotient}:3}, tangent slope {a/5:3}`;
    const fine = (value: number) => slider('h', value, { min: 0.01, max: 3, step: 0.01 });
    const finished = chart({
        title: bothTitle,
        parameters: [slider('a', 5, { min: 0, max: 6 }), fine(1)],
        functions: [withTangent, secant],
        tools: [named],
    });
    return {
        id: 'secant-tangent',
        title: 'From secant to tangent',
        summary: 'Draw the secant through two points of a curve, shrink their distance h with a slider and watch its slope approach the slope of the tangent.',
        category: 'Functions and sliders',
        level: 'core',
        minutes: 9,
        outcomes: [
            'Write a secant as a function of two sliders',
            'Print a difference quotient live in the title',
            'Play a slider towards a limit and compare with the tangent',
            'Play two sliders at once',
        ],
        requires: ['sliders', 'tangents-extrema'],
        chart: finished,
        steps: [
            {
                title: 'Draw the curve',
                body: paragraphs(
                    'Start with a new chart. Click + Add, choose Function y = f(x) and type the formula below into the card f1.',
                    'It is a parabola through the origin, gentle enough to stay in the default view up to x = 7. Its slope at any x is x/5. You will compare the secant with that number later.'
                ),
                type: [{ where: 'f1, y =', text: 'x^2/10' }],
                chart: chart({ functions: [curveFn] }),
                shot: {
                    reveal: ['f1'],
                    actions: [{ focus: ['f1', 'expression'] }],
                    caption: 'The curve f1 in the default view.',
                },
                tip: 'Use + Add here rather than Start a chart: + Add keeps the default view, while Start a chart fits the ranges to the curve.',
            },
            {
                title: 'Mark two points on two sliders',
                body: paragraphs(
                    'Click + Add and choose Points from a list. Replace the sample points with the text below. Click Add slider a under the field, then Add slider h. Both sliders start at 1.',
                    'Type 3 into the value of a and 3 into the value of h. The first point sits on the curve at x = a, the second one h further right: `f1(a)` is the height of the curve at a. Then set Label to Custom and type `A; B` to name the two points.'
                ),
                type: [
                    { where: 'P1, Points', text: '(a, f1(a)); (a + h, f1(a + h))' },
                    { where: 'Sliders, a: value', text: '3' },
                    { where: 'Sliders, h: value', text: '3' },
                    { where: 'P1, Label text', text: 'A; B' },
                ],
                chart: chart({ parameters: [slider('a', 3), slider('h', 3)], functions: [curveFn], tools: [named] }),
                shot: {
                    reveal: ['P1', 'h'],
                    actions: [{ focus: ['P1', 'label'] }],
                    caption: 'A at x = 3 and B at x = 6, both computed from the sliders a and h.',
                },
            },
            {
                title: 'Draw the secant through A and B',
                body: paragraphs(
                    'Click + Add, choose Function y = f(x) and type the formula below into the card f2. It is blue, the next free colour.',
                    'Read it as a line in point-slope form. It starts at the height of A, `f1(a)`, and climbs with the slope of the secant, rise over run, `(f1(a + h) - f1(a))/h`, for every unit it moves away from a. So it passes through both points.'
                ),
                type: [{ where: 'f2, y =', text: 'f1(a) + (f1(a + h) - f1(a))/h * (x - a)' }],
                chart: chart({ parameters: [slider('a', 3), slider('h', 3)], functions: [curveFn, secant], tools: [named] }),
                shot: {
                    reveal: ['f2'],
                    actions: [{ focus: ['f2', 'expression'] }],
                    caption: 'The secant f2 through A and B.',
                },
                tip: 'Keep the brackets around the numerator: `f1(a + h) - f1(a)/h` would divide only f1(a) by h.',
            },
            {
                title: 'Print the slope in the title',
                body: paragraphs(
                    'Open the Chart tab and type the title below. Everything inside the curly brackets is computed, and `:3` keeps up to three decimals.',
                    'The title reads secant slope = 0.9: from A = (3, 0.9) to B = (6, 3.6) the curve rises 2.7 over a run of 3.'
                ),
                type: [{ where: 'Chart > Axes, Title', text: secantTitle }],
                chart: chart({ title: secantTitle, parameters: [slider('a', 3), slider('h', 3)], functions: [curveFn, secant], tools: [named] }),
                shot: {
                    tab: 'chart',
                    caption: 'The title computes the difference quotient for the current a and h.',
                },
            },
            {
                title: 'Add the tangent at A',
                body: paragraphs(
                    'Back in the Build tab, open Options on the card f1, click Tangent and type `a` into the field At x. A dashed tangent touches the curve at A.',
                    'The slope of the tangent of `x^2/10` is x/5, so put it into the title next to the secant slope, as below. At a = 3 the title reads secant slope 0.9, tangent slope 0.6.'
                ),
                type: [
                    { where: 'f1, At x', text: 'a' },
                    { where: 'Chart > Axes, Title', text: bothTitle },
                ],
                chart: chart({ title: bothTitle, parameters: [slider('a', 3), slider('h', 3)], functions: [withTangent, secant], tools: [named] }),
                shot: {
                    reveal: ['f1'],
                    actions: [{ focus: ['f1', 'tangentPoint'] }],
                    caption: 'The tangent at A, and both slopes in the title.',
                },
                tip: 'The slope x/5 is typed by hand: Easy TikZ draws the tangent, but it does not publish its slope as a value.',
            },
            {
                title: 'Shrink h towards zero',
                body: paragraphs(
                    'Open the menu behind the three dots on the row of h and set Min to 0.01, Max to 3 and Step to 0.01. Then drag h down to 0.5.',
                    'B slides along the curve towards A, and the secant turns towards the tangent. The title reads 0.65 against 0.6. For this curve the secant slope is exactly (2a + h)/10, so the gap to the tangent is h/10 and shrinks with h.'
                ),
                type: [
                    { where: 'Sliders, h: Min', text: '0.01' },
                    { where: 'Sliders, h: Max', text: '3' },
                    { where: 'Sliders, h: Step', text: '0.01' },
                ],
                chart: chart({ title: bothTitle, parameters: [slider('a', 3), fine(0.5)], functions: [withTangent, secant], tools: [named] }),
                shot: {
                    reveal: ['h'],
                    actions: [{ slider: ['h', 0.5] }],
                    caption: 'At h = 0.5 the secant is close to the tangent: slopes 0.65 and 0.6.',
                },
            },
            {
                title: 'Play h and watch the limit',
                body: paragraphs(
                    'Click the play button on the row of h. h sweeps between 0.01 and 3, about four seconds each way. Near the bottom of the sweep the secant lies on the tangent, and the title reads 0.601 against 0.6.',
                    'That is the derivative as a limit: the slope of the secant tends to the slope of the tangent as h goes to 0. Click the button again to stop.'
                ),
                chart: chart({ title: bothTitle, parameters: [slider('a', 3), fine(0.01)], functions: [withTangent, secant], tools: [named] }),
                shot: {
                    reveal: ['h'],
                    actions: [{ slider: ['h', 0.01] }],
                    caption: 'At h = 0.01 the secant and the tangent can no longer be told apart.',
                },
                tip: 'h stops at 0.01 on purpose. At h = 0 the quotient is 0/0: the secant disappears and the title prints a question mark.',
            },
            {
                title: 'Play a and h together',
                body: paragraphs(
                    'Click the small numbers at the two ends of the slider a and type 0 and 6, so that A stays in view. Then press play on a as well, while h keeps playing.',
                    'Each slider sweeps its own range in about four seconds, so A travels along the curve while B closes in on it and moves away again. The tangent, the secant and both numbers in the title follow on every frame.'
                ),
                type: [
                    { where: 'Sliders, a: minimum', text: '0' },
                    { where: 'Sliders, a: maximum', text: '6' },
                ],
                chart: finished,
                shot: {
                    reveal: ['a', 'h'],
                    actions: [{ slider: ['a', 5] }, { slider: ['h', 1] }],
                    caption: 'One moment of the two sweeps: a = 5 and h = 1, secant slope 1.1, tangent slope 1.',
                },
                tip: 'Click a play button again to stop that slider alone. The other one keeps playing.',
            },
        ],
        next: ['tangent-area', 'area-accumulation', 'computed-values'],
    };
}

// -------------------------------------------------------- area-accumulation

function areaGuide(): Guide {
    const f = fn('f1', '2exp(-x/2)');
    const under = ['min(0, f1) <= y <= max(0, f1)', '0 <= x <= b'];
    const area = region('t0', 'R1', under);
    const labelled = region('t0', 'R1', under, { label: 'A = {f2(b) - f2(0):2}' });
    const F = fn('f2', '4 - 4exp(-x/2)', { color: 'red' });
    const growing = fn('f2', '4 - 4exp(-x/2)', { color: 'red', domain: '0:b' });
    const end = points('t1', 'P1', { points: '(b, f2(b))', label: 'F(b) = {y:2}', dropLines: true });
    const b = (value: number) => slider('b', value);
    const finished = chart({ parameters: [slider('b', 6, { min: 0.1, max: 10 })], functions: [f, growing], tools: [labelled, end] });
    return {
        id: 'area-accumulation',
        title: 'An area that grows with a slider',
        summary: 'Shade the area under a curve from 0 to a slider b, print its size, and draw the function that adds it up, so the height of one curve shows the area under the other.',
        category: 'Functions and sliders',
        level: 'core',
        minutes: 8,
        outcomes: [
            'End a shaded area at a slider and print its size',
            'Draw a function only up to a slider with its domain',
            'Mark a point that rides on the end of a curve',
            'Play the slider and watch the area and the height grow together',
        ],
        requires: ['sliders'],
        chart: finished,
        steps: [
            {
                title: 'Draw the curve',
                body: paragraphs(
                    'Start with a new chart. Click + Add, choose Function y = f(x) and type the formula below into the card f1.',
                    'The curve starts at a height of 2 and falls towards 0. The area under all of it, from 0 to infinity, is exactly 4.'
                ),
                type: [{ where: 'f1, y =', text: '2exp(-x/2)' }],
                chart: chart({ functions: [f] }),
                shot: {
                    reveal: ['f1'],
                    actions: [{ focus: ['f1', 'expression'] }],
                    caption: 'f1 falls from 2 towards 0.',
                },
                tip: '`exp(x)` is e to the power x, and `2exp(-x/2)` is 2 times it: no star needed after a number.',
            },
            {
                title: 'Shade the area from 0 to b',
                body: paragraphs(
                    'Click + Add and choose Area under a function. The card R1 has two rows. The first, `min(0, f1) <= y <= max(0, f1)`, shades between f1 and the x-axis; the second limits x. Replace the second row with the one below and click Add slider b.',
                    'Then type 3 into the value of b. The area now runs from x = 0 to x = 3.'
                ),
                type: [
                    { where: 'R1, condition 2', text: '0 <= x <= b' },
                    { where: 'Sliders, b: value', text: '3' },
                ],
                chart: chart({ parameters: [b(3)], functions: [f], tools: [area] }),
                shot: {
                    reveal: ['R1', 'b'],
                    actions: [{ focus: ['R1', 'condition:1'] }],
                    caption: 'The area under f1 from 0 to the slider b.',
                },
                tip: 'The first row works below the axis too: `min` and `max` put f1 and 0 in the right order wherever f1 is negative.',
            },
            {
                title: 'Type the function that adds it up',
                body: paragraphs(
                    'Click + Add, choose Function y = f(x) and type the formula below into the card f2. Click its colour swatch and pick Red.',
                    'This is F, the antiderivative of f1 that starts at 0: its slope at every x is f1(x), and F(0) = 0. Easy TikZ shades areas but does not integrate formulas, so F is typed by hand. The red curve rises from 0 towards 4.'
                ),
                type: [{ where: 'f2, y =', text: '4 - 4exp(-x/2)' }],
                chart: chart({ parameters: [b(3)], functions: [f, F], tools: [area] }),
                shot: {
                    reveal: ['f2'],
                    actions: [{ focus: ['f2', 'expression'] }],
                    caption: 'F in red: it starts at 0 and climbs towards 4.',
                },
                tip: 'Not sure about F? Differentiate it: the derivative of 4 - 4exp(-x/2) is 2exp(-x/2), which is f1.',
            },
            {
                title: 'Print the area in the region',
                body: paragraphs(
                    'Type the label below into the field Label of R1. By the fundamental theorem of calculus, `f2(b) - f2(0)` is the area under f1 from 0 to b. The `:2` keeps up to two decimals.',
                    'The label sits in the middle of the shaded area and reads A = 3.11.'
                ),
                type: [{ where: 'R1, Label', text: 'A = {f2(b) - f2(0):2}' }],
                chart: chart({ parameters: [b(3)], functions: [f, F], tools: [labelled] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'label'] }],
                    caption: 'The region prints its own area, computed from F.',
                },
            },
            {
                title: 'Draw F only up to b',
                body: paragraphs(
                    'Type `0:b` into the Domain field of the card f2. The red curve now ends at x = b, right above the right edge of the shaded area.',
                    'A domain with a slider in it grows and shrinks with the slider, so the curve draws itself further when b moves.'
                ),
                type: [{ where: 'f2, Domain', text: '0:b' }],
                chart: chart({ parameters: [b(3)], functions: [f, growing], tools: [labelled] }),
                shot: {
                    reveal: ['f2'],
                    actions: [{ focus: ['f2', 'domain'] }],
                    caption: 'With the domain 0:b, F stops where the shaded area stops.',
                },
                tip: 'A domain needs its end after its start: `0:b` reports an error while b is 0 or less. The last step keeps b above 0.',
            },
            {
                title: 'Mark the end of the curve',
                body: paragraphs(
                    'Click + Add and choose Points from a list. Replace the sample points with the point below. Set Label to Custom, type the label below and switch on Drop lines.',
                    'The point rides on the end of the red curve. Its height, F(b) = 3.11, is the same number as the area: the height of F at b measures the area under f1 up to b. The drop line carries that height over to the y-axis.'
                ),
                type: [
                    { where: 'P1, Points', text: '(b, f2(b))' },
                    { where: 'P1, Label text', text: 'F(b) = {y:2}' },
                ],
                chart: chart({ parameters: [b(3)], functions: [f, growing], tools: [labelled, end] }),
                shot: {
                    reveal: ['P1'],
                    actions: [{ focus: ['P1', 'label'] }],
                    caption: 'The height of F at b and the area under f1 up to b: the same number.',
                },
                tip: 'In a points label, `{x}` and `{y}` are the coordinates of the point itself, so the label always matches its point.',
            },
            {
                title: 'Play b',
                body: paragraphs(
                    'Open the menu behind the three dots on the row of b and set Min to 0.1 and Max to 10. Then click the play button.',
                    'The shaded area widens, the red curve draws itself behind the point, and the label and the point print the same growing number. Both level off near 4, the area under all of f1, while f1 itself sinks towards 0. Stop near b = 6 to see A = 3.8.'
                ),
                type: [
                    { where: 'Sliders, b: Min', text: '0.1' },
                    { where: 'Sliders, b: Max', text: '10' },
                ],
                chart: finished,
                shot: {
                    reveal: ['b'],
                    actions: [{ slider: ['b', 6] }],
                    caption: 'At b = 6 the area is 3.8, close to its limit 4.',
                },
                tip: 'Try another pair: `1/(1 + x)` for f1 and `ln(1 + x)` for f2. Label and point still agree, and this time they keep growing: the area under 1/(1 + x) has no limit.',
            },
        ],
        next: ['areas-between', 'computed-values', 'export-latex'],
    };
}

// ---------------------------------------------------------- computed-values

function computedGuide(): Guide {
    const parabola = fn('f1', '(x - 4)^2/4');
    const line = fn('f2', '0.5x + c', { color: 'blue' });
    const crossings = points('t0', 'P1', { source: 'intersections', ref1: 'f1', ref2: 'f2', label: '({x:2}, {y:2})' });
    const midpoint = points('t1', 'P2', { points: '((P1_x + P1_x2)/2, (P1_y + P1_y2)/2)', label: 'M', dropLines: true });
    const between = region('t2', 'R1', ['f1 <= y <= f2'], { label: 'A = {(P1_x2 - P1_x)^3/24:2}' });
    const countTitle = 'crossing points: {P1_n}';
    const fullTitle = 'crossing points: {P1_n}, midpoint x = {P2_x:2}';
    const c = (value: number) => slider('c', value);
    const finished = chart({ title: fullTitle, parameters: [slider('c', -0.5, { min: -3, max: 0.5 })], functions: [parabola, line], tools: [crossings, midpoint, between] });
    return {
        id: 'computed-values',
        title: 'Calculate with computed points',
        summary: 'Crossing points publish their coordinates and their count: use them in the title, in a new point and in an area formula, and see what they do while a slider plays.',
        category: 'Points, lines and labels',
        level: 'core',
        minutes: 9,
        outcomes: [
            'Use the values a points card publishes: P1_x, P1_x2, P1_n',
            'Build a new point from computed coordinates',
            'Print an area computed from crossing points',
            'Know what a value prints when the point it needs is missing',
        ],
        requires: ['points-labels', 'sliders'],
        chart: finished,
        steps: [
            {
                title: 'Draw a parabola and a line',
                body: paragraphs(
                    'Start with a new chart. Click + Add, choose Function y = f(x) and type the parabola below into the card f1. Add a second function the same way and type the line into f2. Click Add slider c under it, then type 0 into the value of c.',
                    'The line has the slope 0.5. The slider c moves it up and down without turning it.'
                ),
                type: [
                    { where: 'f1, y =', text: '(x - 4)^2/4' },
                    { where: 'f2, y =', text: '0.5x + c' },
                    { where: 'Sliders, c: value', text: '0' },
                ],
                chart: chart({ parameters: [c(0)], functions: [parabola, line] }),
                shot: {
                    reveal: ['f1', 'f2', 'c'],
                    actions: [{ focus: ['f2', 'expression'] }],
                    caption: 'A parabola, and a line that the slider c moves up and down.',
                },
            },
            {
                title: 'Mark where they cross',
                body: paragraphs(
                    'Click + Add and choose Intersections of two functions. The card P1 picks f1 and f2 by itself and marks the two crossings with their coordinates: (2, 1) and (8, 4).',
                    'P1 also publishes what it found, under names that every other field can use:',
                    list(
                        '`P1_x` and `P1_y` for the first crossing from the left',
                        '`P1_x2` and `P1_y2` for the second one',
                        '`P1_n` for the number of crossings'
                    )
                ),
                chart: chart({ parameters: [c(0)], functions: [parabola, line], tools: [crossings] }),
                shot: {
                    reveal: ['P1'],
                    caption: 'Two computed crossings. Their coordinates are now values called P1_x, P1_y, P1_x2 and P1_y2.',
                },
                tip: 'Crossings are searched for between the left and the right edge of the view. Widen the x range if one is missing.',
            },
            {
                title: 'Count the crossings in the title',
                body: paragraphs(
                    'Open the Chart tab and type the title below. `{P1_n}` prints the number of crossings, and it changes with the chart.',
                    'Try it: type -2.25 into the value of c. The line now only touches the parabola, and the title reads crossing points: 1. Type -3 and it reads 0. Then type 0 again.'
                ),
                type: [{ where: 'Chart > Axes, Title', text: countTitle }],
                chart: chart({ title: countTitle, parameters: [c(0)], functions: [parabola, line], tools: [crossings] }),
                shot: {
                    tab: 'chart',
                    caption: 'The title counts the crossings: 2.',
                },
                tip: 'A point where the two curves only touch counts as a crossing, so the tangent line at c = -2.25 gives 1.',
            },
            {
                title: 'Mark the midpoint of the crossings',
                body: paragraphs(
                    'Click + Add and choose Points from a list. Replace the sample points with the formula below: the average of the two crossings, coordinate by coordinate. Set Label to Custom, type `M` and switch on Drop lines.',
                    'The point M appears at (5, 2.5), halfway between (2, 1) and (8, 4). It is computed from P1, so it moves whenever the crossings move.'
                ),
                type: [
                    { where: 'P2, Points', text: '((P1_x + P1_x2)/2, (P1_y + P1_y2)/2)' },
                    { where: 'P2, Label text', text: 'M' },
                ],
                chart: chart({ title: countTitle, parameters: [c(0)], functions: [parabola, line], tools: [crossings, midpoint] }),
                shot: {
                    reveal: ['P2'],
                    actions: [{ focus: ['P2', 'points'] }],
                    caption: 'M is built from the coordinates P1 publishes.',
                },
            },
            {
                title: 'Shade the area and print its size',
                body: paragraphs(
                    'Click + Add and choose Area between two functions. The card R1 starts with `f2 <= y <= f1`, which shades where the line lies below the parabola. Swap the two names so the row reads as below: now it shades the piece between the crossings, where the line is on top.',
                    'Then type the label below into the field Label of R1. For a parabola with the leading factor k, the area between it and a line that cuts it at x1 and x2 is k(x2 - x1)^3/6. Here k is 1/4, so the formula divides by 24. The label reads A = 9.'
                ),
                type: [
                    { where: 'R1, condition 1', text: 'f1 <= y <= f2' },
                    { where: 'R1, Label', text: 'A = {(P1_x2 - P1_x)^3/24:2}' },
                ],
                chart: chart({ title: countTitle, parameters: [c(0)], functions: [parabola, line], tools: [crossings, midpoint, between] }),
                shot: {
                    reveal: ['R1'],
                    actions: [{ focus: ['R1', 'label'] }],
                    caption: 'The area between line and parabola, computed from the two crossings.',
                },
                tip: 'The area formula is yours: a region does not publish its own size. The crossings it uses are computed, so the number stays right when c moves.',
            },
            {
                title: 'Play c and watch the midpoint',
                body: paragraphs(
                    'Click the small numbers at the two ends of the slider c and type -3 and 0.5. Add the midpoint to the title as below, then press play on c.',
                    'The line sweeps up and down. The crossings slide along the parabola and the area grows and shrinks. M moves too, but only up and down: its drop line stays at x = 5, and the title keeps printing 5.',
                    'That is a property of every parabola: the midpoints of parallel chords lie on one vertical line, through the point where the parabola has the slope of the chords. Here the slope of the parabola, (x - 4)/2, is 0.5 at x = 5.'
                ),
                type: [
                    { where: 'Sliders, c: minimum', text: '-3' },
                    { where: 'Sliders, c: maximum', text: '0.5' },
                    { where: 'Chart > Axes, Title', text: fullTitle },
                ],
                chart: finished,
                shot: {
                    reveal: ['c'],
                    actions: [{ slider: ['c', -0.5] }],
                    caption: 'At c = -0.5: new crossings, a smaller area, and M still above x = 5.',
                },
            },
            {
                title: 'Let the line miss the parabola',
                body: paragraphs(
                    'Stop playing, or drag c, at c = -2.5. The line now passes below the parabola. There are no crossings, so the title reads crossing points: 0 and midpoint x = ?.',
                    'A value that cannot be computed prints a question mark, and whatever needs it is not drawn: no M and no shaded area. The status chip at the top left of the preview lists the reasons. Move c back above -2.25 and everything returns.'
                ),
                shot: {
                    reveal: ['c'],
                    actions: [{ slider: ['c', -2.5] }],
                    caption: 'At c = -2.5 the line misses: the count is 0, the midpoint prints a question mark.',
                },
                tip: 'Nothing is broken here: the chip only reports. If a label must never show a question mark, give the slider a range in which the points always exist.',
            },
        ],
        next: ['supply-demand', 'area-accumulation', 'tangent-area'],
    };
}

/** Guides of this group (see the list in docs/guides/README.md). */
export const DYNAMIC_GUIDES: Guide[] = [animateGuide(), secantGuide(), areaGuide(), computedGuide()];
