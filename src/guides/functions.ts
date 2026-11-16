/*
 * Guides of the category Functions and sliders (5.1): sliders from letters,
 * parametric and polar curves, and an animation with play. Each step adds or
 * changes a line or two; the Help shows the chart in words with the new
 * lines lit.
 */
import type { Guide } from './types';
import { chart } from './chart';

// ----------------------------------------------------------------- sliders

const SLIDER_VIEW = ['size 12 x 8', 'show x from -5 to 5 and y from -4 to 6', 'axes in the middle', 'with a grid'];
/** With a star: before `a` is a slider, `a(x - h)` reads as a function named a, and the field offers no Add slider. */
const PARABOLA = 'plot f(x) = a*(x - h)^2 + k in purple, very thick';
/** The sliders after their ranges were set: a from -2 to 2, h in steps of 0.5, k from -3 to 3. */
const SLIDER_H = 'slider h from -4 to 4, starting at 1, in steps of 0.5';
const SLIDER_K = 'slider k from -3 to 3, starting at -2';
const INSIDE = 'shade where $y \\ge f(x)$ in purple';
const VERTEX = 'mark (h, k), large, labelled "({h}, {k})"';
const SLIDERS_PLAYED = chart(...SLIDER_VIEW, 'slider a from -2 to 2, starting at 0.5', SLIDER_H, SLIDER_K, PARABOLA, INSIDE, VERTEX);
/**
 * The last step adds `connected` to a. The finished chart (the same picture) leaves it out: every finished
 * chart is an example of the AI tools (src/ai/charttool.ts), whose check does not know that field yet.
 */
const SLIDERS_CONNECTED = chart(...SLIDER_VIEW, 'slider a from -2 to 2, starting at 0.5, connected', SLIDER_H, SLIDER_K, PARABOLA, INSIDE, VERTEX);

const SLIDERS: Guide = {
    id: 'sliders',
    title: 'Sliders that move the picture',
    summary: 'Turn letters into sliders, set their range and step, press play, and connect them across a note.',
    category: 'Functions and sliders',
    level: 'core',
    minutes: 3,
    outcomes: ['Make sliders from the letters of a formula', 'Set the range and the step of a slider, and play it', 'Connect sliders across the charts of a note'],
    requires: ['first-chart'],
    chart: SLIDERS_PLAYED,
    steps: [
        {
            title: 'Turn letters into sliders',
            body: 'Type a formula with letters the chart does not know, such as `a*(x - h)^2 + k`. Click Add slider under the field for each one: each slider starts at 1.',
            chart: chart(
                ...SLIDER_VIEW,
                'slider a from -10 to 10, starting at 1',
                'slider h from -10 to 10, starting at 1',
                'slider k from -10 to 10, starting at 1',
                PARABOLA
            ),
            tip: 'Keep the star until `a` is a slider: before that, `a(x - h)` reads as a function named `a`.',
        },
        {
            title: 'Set the range and the step',
            body: "Click the small numbers at the ends of a slider to type its minimum and maximum, then drag it. The step sits in the slider's options: `h` moves in steps of 0.5.",
            chart: chart(...SLIDER_VIEW, 'slider a from -2 to 2, starting at 0.5', SLIDER_H, SLIDER_K, PARABOLA),
        },
        {
            title: 'Press play',
            body: 'Click play on the row of `h`: it sweeps from minimum to maximum and back, about four seconds each way, and the shading and the vertex follow. `{h}` in a label prints its value.',
            chart: SLIDERS_PLAYED,
            tip: 'Drag a slider while it plays to take over, and it carries on from where you let go.',
        },
        {
            title: 'Connect sliders across a note',
            body: 'Add `connected` to a slider line. In a note, moving `a` then moves the slider `a` of every other chart whose `a` is connected too.',
            chart: SLIDERS_CONNECTED,
            tip: "The editor has it as Connect with others in the slider's options, and a note as the link button on the slider row.",
        },
    ],
    next: ['animate-play', 'parametric-polar', 'tangents-extrema'],
};

// -------------------------------------------------------- parametric-polar

const CURVE_VIEW = ['size 12 x 8', 'show x from -3.6 to 3.6 and y from -2.4 to 2.4', 'equal scale', 'axes in the middle', 'with a grid'];
const ROSE_VIEW = ['polar', 'size 12 x 8', 'show x from -3.4 to 3.4 and y from -2.25 to 2.25', 'axes in the middle', 'with a grid'];
const ROSE_DONE = chart(...ROSE_VIEW, 'slider k from 1 to 8, starting at 5, in steps of 1', 'plot $r(\\theta) = 2\\cos(k\\theta)$ in magenta, very thick');

const PARAMETRIC_POLAR: Guide = {
    id: 'parametric-polar',
    title: 'Parametric and polar curves',
    summary: 'Trace a curve from x(t) and y(t), then switch to polar and grow a rose whose petals a slider counts.',
    category: 'Functions and sliders',
    level: 'core',
    minutes: 3,
    outcomes: ['Draw a parametric curve and keep its shape with equal scale', 'Plot r(θ) in a polar chart', 'Count petals with a whole-number slider'],
    requires: ['sliders'],
    chart: ROSE_DONE,
    steps: [
        {
            title: 'Trace a curve with t',
            body: 'A parametric curve gives x and y as formulas in t. `(2\\cos(t), 2\\sin(t))` runs once around a circle as t goes from 0 to 2π, and `equal scale` keeps it round.',
            chart: chart(...CURVE_VIEW, 'plot $c(t) = (2\\cos(t), 2\\sin(t))$ in teal, very thick'),
            tip: 'In the editor, choose + Add, then Parametric curve x(t), y(t).',
        },
        {
            title: 'Change the speeds of x and y',
            body: 'Give x and y different speeds: `(2\\sin(3t), 2\\sin(2t))` is a Lissajous figure. It closes because 3 and 2 are whole numbers.',
            chart: chart(...CURVE_VIEW, 'plot $c(t) = (2\\sin(3t), 2\\sin(2t))$ in teal, very thick'),
        },
        {
            title: 'Switch to a polar chart',
            body: 'In a chart with the line `polar`, a formula gives the radius r for each angle θ. `2\\cos(2\\theta)` is a rose with four petals.',
            chart: chart(...ROSE_VIEW, 'plot $r(\\theta) = 2\\cos(2\\theta)$ in magenta, very thick'),
            tip: 'In the editor, Polar in the header switches a new chart.',
        },
        {
            title: 'Count the petals with a slider',
            body: 'Write `k` for the 2, give `k` whole steps from 1 to 8 and press play. An odd `k` draws k petals, an even one 2k.',
            chart: ROSE_DONE,
            tip: 'A whole-number step stays whole while it plays, so the rose always closes.',
        },
    ],
    next: ['animate-play', 'tangents-extrema', 'export-latex'],
};

// ------------------------------------------------------------ animate-play

/** A wide picture: the unit circle left of the y-axis, one turn of the sine right of it. */
const TURN_VIEW = ['size 12 x 6', 'show x from -3 to 7 and y from -2 to 2', 'equal scale', 'axes in the middle'];
const CIRCLE = 'draw $(x + 1.5)^2 + y^2 = 1$ in gray';
/** One turn, kept above 0: the domains from 0 to a need some length. */
const TURN = (at: number) => `slider a from 0.01 to 6.28, starting at ${at}, in steps of 0.01`;
const POINTS = 'P: mark (cos(a) - 1.5, sin(a)) and (a, sin(a))';
const ARC = 'plot $c(t) = (\\cos(t) - 1.5, \\sin(t))$ for t from 0 to a in red, very thick';
const ROLL = 'draw a line from (0, 0) to (a, 0) in red, very thick';
const WAVE = 'plot $f(x) = \\sin(x)$ from x = 0 to a in blue, very thick';
const PATH = 'draw a line from (-1.5, 0) to P, dashed';
const ANGLE = 'title $a = {a:2}$, $\\sin(a) = {sin(a):2}$';
const PLAYED = chart(...TURN_VIEW, ANGLE, TURN(4), CIRCLE, ARC, ROLL, WAVE, POINTS, PATH);

const ANIMATE_PLAY: Guide = {
    id: 'animate-play',
    title: 'Animate a chart with play',
    summary: 'A point runs around the unit circle while the circle unrolls into the sine curve, all on one slider.',
    category: 'Functions and sliders',
    level: 'core',
    minutes: 3,
    outcomes: ['Move points, arcs and curves with one slider', 'Give a slider one turn and a fine step', 'Play it and print live values in the title'],
    requires: ['sliders'],
    chart: PLAYED,
    steps: [
        {
            title: 'Draw the unit circle',
            body: 'A wide window with `equal scale` keeps the circle round. The circle of radius 1 sits left of the y-axis, so the sine gets the right side.',
            chart: chart(...TURN_VIEW, CIRCLE),
        },
        {
            title: 'Run a point around it',
            body: 'The slider `a` from 0.01 to 6.28 is one turn. The point `(cos(a) - 1.5, sin(a))` sits on the circle at the angle a, a second one at `(a, sin(a))`.',
            chart: chart(...TURN_VIEW, TURN(2), CIRCLE, POINTS),
            tip: 'The slider starts just above 0: a curve from 0 to a needs some length.',
        },
        {
            title: 'Unroll the arc onto the axis',
            body: 'The red arc runs from the angle 0 to a, so its length is a. The red segment from 0 to a on the x-axis has the same length: the circle unrolled.',
            chart: chart(...TURN_VIEW, TURN(2), CIRCLE, ARC, ROLL, POINTS),
        },
        {
            title: 'Draw the sine up to a',
            body: '`from x = 0 to a` stops the sine at the second point. The dashed path joins the centre, the point on the circle and the end of the curve.',
            chart: chart(...TURN_VIEW, TURN(2), CIRCLE, ARC, ROLL, WAVE, POINTS, PATH),
        },
        {
            title: 'Press play',
            body: 'Press play on `a`: the point runs around, the arc unrolls and the sine grows behind it. The title prints the angle and its sine, here at 4, past half a turn.',
            chart: PLAYED,
            tip: 'In a note the slider strip has no play button: drag `a` there instead.',
        },
    ],
    next: ['secant-tangent', 'area-accumulation', 'parametric-polar'],
};

export const FUNCTIONS_GUIDES: Guide[] = [SLIDERS, PARAMETRIC_POLAR, ANIMATE_PLAY];
