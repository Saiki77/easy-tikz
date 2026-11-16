/*
 * Guides of the category Calculus (5.1): a tangent that rolls along a
 * curve, the secant that turns into it, an area that grows with a slider,
 * Riemann sums and slope fields. Each step adds or changes a line or two;
 * the Help shows the chart in words with those lines lit.
 */
import type { Guide } from './types';
import { chart } from './chart';

// ------------------------------------------------------- tangents-extrema

/** A wave that climbs: maxima at 2pi/3 and 8pi/3, a minimum at 4pi/3. Its slope is 0.5 + cos(x). */
const WAVE_VIEW = ['size 12 x 8', 'show x from 0 to 10 and y from -1 to 6', 'axes on the edges', 'with a grid'];
const WAVE = 'plot $f(x) = \\frac{x}{2} + \\sin(x)$ in purple, very thick';
const ROLL = 'slider a from 0 to 9, starting at 6';
const TRIANGLE = 'draw a line from (a, f(a)) to (a + 1, f(a)) to (a + 1, f(a) + 0.5 + cos(a)) in orange, thick';
const SLOPE = 'write "slope {0.5 + cos(a):2}" at (a + 1, f(a) + (0.5 + cos(a))/2) in orange, right';

const TANGENTS: Guide = {
    id: 'tangents-extrema',
    title: 'Tangents and extrema',
    summary: 'Mark the turning points of a curve, roll a tangent along it with a slider and print its slope.',
    category: 'Calculus',
    level: 'core',
    minutes: 3,
    outcomes: ['Mark local maxima and minima', 'Put a tangent on a slider', 'Print a live slope in a label'],
    requires: ['sliders'],
    next: ['secant-tangent', 'area-accumulation'],
    chart: chart(...WAVE_VIEW, ROLL, `${WAVE}, with its tangent at a and its extrema`, TRIANGLE, SLOPE),
    steps: [
        {
            title: 'Plot the function',
            body: 'Write the window, then the function in LaTeX between dollars: a wave that climbs, with two crests and a trough in view.',
            chart: chart(...WAVE_VIEW, WAVE),
        },
        {
            title: 'Mark the extrema',
            body: 'Add `with its extrema` to the plot line. The chart finds every local maximum and minimum in view and labels it.',
            chart: chart(...WAVE_VIEW, `${WAVE}, with its extrema`),
        },
        {
            title: 'Put a tangent on a slider',
            body: '`with its tangent at a` draws the tangent where x is the slider `a`. Press play: the tangent rolls along the curve and lies flat at each extremum.',
            chart: chart(...WAVE_VIEW, ROLL, `${WAVE}, with its tangent at a and its extrema`),
            tip: '`with its tangent at max2` puts it on the second maximum instead.',
        },
        {
            title: 'Print the slope',
            body: 'The slope of f at `a` is `0.5 + cos(a)`. A line one unit across and that far up draws the slope triangle, and the label prints the value.',
            chart: chart(...WAVE_VIEW, ROLL, `${WAVE}, with its tangent at a and its extrema`, TRIANGLE, SLOPE),
            tip: 'The chart does not differentiate: for another function, type its derivative yourself.',
        },
    ],
};

// --------------------------------------------------------- secant-tangent

/** f(x) = x^2/10: the secant from a to a + h has the slope (2a + h)/10, the tangent at a the slope a/5. */
const PARABOLA_VIEW = ['size 12 x 8', 'show x from 0 to 7 and y from 0 to 5', 'axes on the edges', 'with a grid'];
const PARABOLA = 'plot $f(x) = \\frac{x^2}{10}$ in blue, very thick';
const POINT_A = 'slider a from 0 to 4, starting at 3';
const GAP = (start: number) => `slider h from 0.01 to 3, starting at ${start}, in steps of 0.01`;
const A_AND_B = 'mark (a, f(a)) and (a + h, f(a + h)) in purple, large, labelled "A; B"';
const SECANT = 'plot $g(x) = f(a) + \\frac{f(a + h) - f(a)}{h}(x - a)$ in red, thick';
const RISE_RUN = 'draw a line from (a, f(a)) to (a + h, f(a)) to (a + h, f(a + h)) in orange, dashed';
const SLOPES = 'title secant slope {(f(a + h) - f(a))/h:3}, tangent slope {a/5:3}';

const SECANT_GUIDE: Guide = {
    id: 'secant-tangent',
    title: 'From secant to tangent',
    summary: 'Shrink the gap h between two points of a curve and watch the secant through them turn into the tangent.',
    category: 'Calculus',
    level: 'core',
    minutes: 3,
    outcomes: ['Write a secant with two sliders', 'Print both slopes live in the title', 'See the derivative as a limit'],
    requires: ['tangents-extrema'],
    next: ['area-accumulation', 'riemann-sums'],
    chart: chart(...PARABOLA_VIEW, SLOPES, POINT_A, GAP(1), `${PARABOLA}, with its tangent at a`, SECANT, A_AND_B, RISE_RUN),
    steps: [
        {
            title: 'Plot the curve',
            body: 'Plot the parabola. Its tangent at any x has the slope x/5: keep that number in mind.',
            chart: chart(...PARABOLA_VIEW, PARABOLA),
        },
        {
            title: 'Mark two points on sliders',
            body: 'A sits on the curve at x = `a`, and B is `h` further right. `labelled "A; B"` names the two points.',
            chart: chart(...PARABOLA_VIEW, POINT_A, GAP(3), PARABOLA, A_AND_B),
        },
        {
            title: 'Draw the secant through A and B',
            body: 'The orange legs show the run `h` and the rise. The secant starts at A and climbs with rise over run, so it passes through B too.',
            chart: chart(...PARABOLA_VIEW, POINT_A, GAP(3), PARABOLA, SECANT, A_AND_B, RISE_RUN),
        },
        {
            title: 'Add the tangent and both slopes',
            body: '`with its tangent at a` draws the tangent at A. The title prints both slopes: 0.9 for the secant, 0.6 for the tangent.',
            chart: chart(...PARABOLA_VIEW, SLOPES, POINT_A, GAP(3), `${PARABOLA}, with its tangent at a`, SECANT, A_AND_B, RISE_RUN),
        },
        {
            title: 'Shrink h towards zero',
            body: 'Drag `h` down or press play. B slides into A, the secant turns into the tangent, and its slope tends to 0.6: that limit is the derivative.',
            chart: chart(...PARABOLA_VIEW, SLOPES, POINT_A, GAP(1), `${PARABOLA}, with its tangent at a`, SECANT, A_AND_B, RISE_RUN),
            tip: 'At `h = 0` the quotient is 0/0, so `h` stops at 0.01.',
        },
    ],
};

// ------------------------------------------------------ area-accumulation

/** f(x) = 2e^(-x/2) and the area function F(x) = 4 - 4e^(-x/2): F(0) = 0, F' = f, F tends to 4. */
const DECAY_VIEW = ['size 12 x 7', 'show x from 0 to 10 and y from 0 to 4.5', 'axes on the edges', 'with a grid'];
const DECAY = 'plot $f(x) = 2e^{-x/2}$ in blue, very thick';
const END = 'slider b from 0.1 to 10, starting at 3';
const UNDER = 'shade under f from x = 0 to b in green';
const AREA = 'plot $F(x) = 4 - 4e^{-x/2}$ from x = 0 to b in red, very thick';
const AREA_LABEL = `${UNDER}, labelled "A = {F(b) - F(0):2}"`;
const HEIGHT = 'mark (b, F(b)), with lines to the axes, labelled "F(b) = {y:2}"';

const AREA_GUIDE: Guide = {
    id: 'area-accumulation',
    title: 'An area that grows with a slider',
    summary: 'Shade the area under a curve up to a slider and draw the function that adds it up.',
    category: 'Calculus',
    level: 'core',
    minutes: 3,
    outcomes: ['Shade an area up to a slider', 'Draw a function only up to a slider', 'See that F(b) is the area under f'],
    requires: ['sliders'],
    next: ['riemann-sums', 'areas-between'],
    chart: chart(...DECAY_VIEW, END, DECAY, AREA, AREA_LABEL, HEIGHT),
    steps: [
        {
            title: 'Plot the curve',
            body: 'The curve starts at 2 and falls towards 0. The whole area under it, from 0 to infinity, is exactly 4.',
            chart: chart(...DECAY_VIEW, DECAY),
        },
        {
            title: 'Shade the area from 0 to b',
            body: '`shade under f from x = 0 to b` fills the area between f and the x-axis, up to the slider `b`.',
            chart: chart(...DECAY_VIEW, END, DECAY, UNDER),
        },
        {
            title: 'Draw the function that adds it up',
            body: 'F has the slope f and starts at 0, so its height at b is the area up to b. `from x = 0 to b` ends it at the slider.',
            chart: chart(...DECAY_VIEW, END, DECAY, AREA, UNDER),
            tip: 'The chart does not integrate: type F yourself, and check that its derivative is f.',
        },
        {
            title: 'Label the area and its height',
            body: 'The area prints `F(b) - F(0)` and the point on F prints its height: the same number. Press play and both grow towards 4.',
            chart: chart(...DECAY_VIEW, END, DECAY, AREA, AREA_LABEL, HEIGHT),
        },
    ],
};

// ----------------------------------------------------------- riemann-sums

/** The area under 4/(1 + x^2) from 0 to 1 is pi. */
const PI_VIEW = ['size 12 x 7', 'show x from -0.1 to 1.1 and y from 0 to 4.6', 'axes on the edges', 'with a grid'];
const PI_CURVE = 'plot $f(x) = \\frac{4}{1 + x^2}$ in red, very thick';
const PARTS = 'slider n from 1 to 40, starting at 5, in steps of 1';
const LEFT = 'draw the left Riemann sum of f from 0 to 1 with n parts';
const TRAPEZOID = 'draw the trapezoid rule of f from 0 to 1 with n parts in purple, labelled';
const MIDDLE = 'draw the middle Riemann sum of f from 0 to 1 with n parts in blue, labelled';

const RIEMANN: Guide = {
    id: 'riemann-sums',
    title: 'Estimate an area with Riemann sums',
    summary: 'Fill an area with rectangles, watch their sum approach the integral, then try trapezoids and middle sums.',
    category: 'Calculus',
    level: 'core',
    minutes: 3,
    outcomes: ['Draw a Riemann sum with a slider for the parts', 'Print the sum next to the integral', 'Compare left, trapezoid and middle sums'],
    requires: ['area-accumulation'],
    next: ['slope-fields', 'probability'],
    chart: chart(...PI_VIEW, PARTS, PI_CURVE, MIDDLE),
    steps: [
        {
            title: 'Plot the function',
            body: 'The area under this curve from 0 to 1 is exactly π. The next steps estimate it with rectangles.',
            chart: chart(...PI_VIEW, PI_CURVE),
        },
        {
            title: 'Draw the left Riemann sum',
            body: '`with n parts` takes the number of rectangles from the slider `n`. Each rectangle is as high as f at its left end.',
            chart: chart(...PI_VIEW, PARTS, PI_CURVE, LEFT),
        },
        {
            title: 'Print the sum and the integral',
            body: '`labelled` prints the sum and the exact integral. Press play on `n`: the thinner the parts, the closer the sum comes to 3.142.',
            chart: chart(...PI_VIEW, PARTS, PI_CURVE, `${LEFT}, labelled`),
        },
        {
            title: 'Use the trapezoid rule',
            body: 'Write `the trapezoid rule of f` instead. Each part gets a slanted top that joins the curve at both ends.',
            chart: chart(...PI_VIEW, PARTS, PI_CURVE, TRAPEZOID),
        },
        {
            title: 'Try the middle sum',
            body: 'In a Riemann sum, write `right` or `middle` instead of `left`. The middle sum takes f at the centre of each part: with 5 parts it misses π by only 0.003.',
            chart: chart(...PI_VIEW, PARTS, PI_CURVE, MIDDLE),
            tip: '`midpoint` is another word for `middle`.',
        },
    ],
};

// ----------------------------------------------------------- slope-fields

/**
 * y' = -x/y: the solutions are circles around the origin, x^2 + y^2 = b^2; each one ends as a half
 * circle where it turns vertical, at the x-axis. No LaTeX command in the equation: Full LaTeX
 * (src/text/full.ts) writes a slope field with one exactly (a raw line).
 */
const FIELD_VIEW = ['size 12 x 8', 'show x from -4.5 to 4.5 and y from -3 to 3', 'axes in the middle', 'equal scale'];
const FIELD = "draw the slope field of $y' = -x/y$";
const START = 'slider b from 0.5 to 2.8, starting at 2';
const P = 'P: mark (0, b) in purple, large';
const THROUGH_P = 'draw the solution through P in red, very thick';
const MORE = 'draw the solutions through (0, 1) and (0, -1.5) in blue, thick';

const SLOPE_FIELDS: Guide = {
    id: 'slope-fields',
    title: 'Slope fields and solutions',
    summary: 'Draw the slope field of a differential equation and the solution through a point you move.',
    category: 'Calculus',
    level: 'advanced',
    minutes: 3,
    outcomes: ["Draw the slope field of y' = f(x, y)", 'Name a point and move it with a slider', 'Draw the solutions through points'],
    requires: ['tangents-extrema'],
    next: ['riemann-sums', 'data-regression'],
    chart: chart(...FIELD_VIEW, START, FIELD, P, THROUGH_P, MORE),
    steps: [
        {
            title: 'Draw the slope field',
            body: "Write the equation after `the slope field of`. Each short line has the slope y' at its point, so the lines show where solutions go.",
            chart: chart(...FIELD_VIEW, FIELD),
        },
        {
            title: 'Mark a point P on a slider',
            body: '`P: mark (0, b)` marks a point and names it P. The slider `b` moves it up and down the y-axis.',
            chart: chart(...FIELD_VIEW, START, FIELD, P),
        },
        {
            title: 'Draw the solution through P',
            body: 'The chart follows the field from P to both sides until the curve turns vertical: here half a circle. Drag `b` or press play to resize it.',
            chart: chart(...FIELD_VIEW, START, FIELD, P, THROUGH_P),
        },
        {
            title: 'Add more solutions',
            body: 'List more points after `the solutions through`. Solutions never cross, so the half circles nest around the origin.',
            chart: chart(...FIELD_VIEW, START, FIELD, P, THROUGH_P, MORE),
        },
    ],
};

export const CALCULUS_GUIDES: Guide[] = [TANGENTS, SECANT_GUIDE, AREA_GUIDE, RIEMANN, SLOPE_FIELDS];
