/*
 * Guides of the category Points, lines and labels (5.1): points from a list
 * and from formulas, labels that print values, a slope triangle of paths,
 * braces and an arrow, and values computed from crossing points. Each step
 * adds a line or two; the Help shows the chart in words with the new lines
 * lit.
 */
import type { Guide } from './types';
import { chart } from './chart';

// ------------------------------------------------------------ points-labels

/** A parabola with its roots and top marked, and a point that rides on it. */
const PL_WINDOW = ['size 12 x 8', 'show x from -0.5 to 6.5 and y from -1 to 5', 'axes in the middle', 'with a grid'];
const PL_CURVE = 'plot $f(x) = 4 - (x - 3)^2$ in blue, very thick';
const PL_LIST = 'mark (1, 0), (5, 0) and (3, 4), large';
const PL_NAMED = `${PL_LIST}, labelled "$x_1$; $x_2$; $V$"`;
const PL_SLIDER = 'slider a from 1 to 5, starting at 4.5';
const PL_POINT = 'mark (a, f(a)) in purple, large, with lines to the axes';
const PL_VALUE = `${PL_POINT}, labelled "$f({a}) = {f(a):2}$"`;

const POINTS_LABELS: Guide = {
    id: 'points-labels',
    title: 'Points and live labels',
    summary: 'Mark points from a list or from a formula, name them in LaTeX and print their values in labels.',
    category: 'Points, lines and labels',
    level: 'core',
    minutes: 3,
    outcomes: ['Mark points from a list and name them', 'Put a point on a curve with a slider', 'Print values in labels, as text or as math'],
    requires: ['chart-language'],
    chart: chart(...PL_WINDOW, PL_CURVE, PL_NAMED, PL_SLIDER, PL_VALUE),
    steps: [
        {
            title: 'Mark points from a list',
            body: 'Write each point as `(x, y)` and join them with commas and `and`. These three are where the parabola meets the x-axis, and its top.',
            chart: chart(...PL_WINDOW, PL_CURVE, PL_LIST),
        },
        {
            title: 'Name the points in math',
            body: '`labelled` gives one name per point, in order, split by `;`. Between dollars a name is LaTeX math, as in your notes.',
            chart: chart(...PL_WINDOW, PL_CURVE, PL_NAMED),
        },
        {
            title: 'Put a point on the curve',
            body: 'A coordinate may be a formula: `(a, f(a))` sits on the curve above `x = a`. Drag the slider `a` and the point follows.',
            chart: chart(...PL_WINDOW, PL_CURVE, PL_NAMED, PL_SLIDER, PL_POINT),
        },
        {
            title: 'Print its values in the label',
            body: 'Curly brackets in a label print a value: `{a}` is the slider, `{f(a):2}` the height with up to 2 decimals. The label changes as `a` moves.',
            chart: chart(...PL_WINDOW, PL_CURVE, PL_NAMED, PL_SLIDER, PL_VALUE),
            tip: 'In the label of a point, `{x}` and `{y}` are its own coordinates.',
        },
    ],
    next: ['arrows-braces', 'computed-values'],
};

// ------------------------------------------------------------ arrows-braces

/** A slope triangle under the line g: the run and the rise as a path, two braces and an arrow. */
const AB_WINDOW = ['size 12 x 8', 'show x from 0 to 8 and y from 0 to 6', 'axes on the edges', 'with a grid'];
const AB_LINE = 'plot $g(x) = \\frac{1}{2}x + 1$ in blue, thick';
const AB_PATH = 'draw a line from (2, g(2)) to (6, g(2)) to (6, g(6)) in gray, dashed';
const AB_RUN = 'draw a brace from (6, g(2)) to (2, g(2)), labelled "run = 4"';
const AB_RISE = 'draw a brace from (6, g(6)) to (6, g(2)), labelled "rise = {g(6) - g(2)}"';
const AB_ARROW = 'draw an arrow from (2, g(2)) to (6, g(6)) in red, very thick, labelled "slope = {(g(6) - g(2))/4}"';
const AB_SLIDER = 'slider m from 0.25 to 0.75, starting at 0.5';
const AB_TURN = 'plot $g(x) = mx + 1$ in blue, thick';

const ARROWS_BRACES: Guide = {
    id: 'arrows-braces',
    title: 'Segments, arrows and braces',
    summary: 'Draw a slope triangle: a path for the run and the rise, braces with live labels and an arrow.',
    category: 'Points, lines and labels',
    level: 'core',
    minutes: 3,
    outcomes: ['Draw paths, arrows and braces through points', 'Label a brace with a value computed from a function', 'Read a slope as rise over run'],
    requires: ['chart-language'],
    chart: chart(...AB_WINDOW, AB_SLIDER, AB_TURN, AB_PATH, AB_RUN, AB_RISE, AB_ARROW),
    steps: [
        {
            title: 'Draw a path through points',
            body: '`draw a line from A to B to C` joins the points. This one runs 4 across from the line, then up to it again: the run and the rise.',
            chart: chart(...AB_WINDOW, AB_LINE, AB_PATH),
        },
        {
            title: 'Label the run with a brace',
            body: 'A brace spans two points and carries a label. It bulges to the left of its direction, so drawn from right to left it hangs below.',
            chart: chart(...AB_WINDOW, AB_LINE, AB_PATH, AB_RUN),
            tip: 'Swap the two points to flip a brace to the other side.',
        },
        {
            title: 'Print the rise as a value',
            body: 'Curly brackets in a label compute: `{g(6) - g(2)}` reads the rise off the line, so the label stays right when the line changes.',
            chart: chart(...AB_WINDOW, AB_LINE, AB_PATH, AB_RUN, AB_RISE),
        },
        {
            title: 'Draw the slope as an arrow',
            body: 'An arrow is a vector from its tail to its head: here 4 across and 2 up. Its label divides the rise by the run: the slope.',
            chart: chart(...AB_WINDOW, AB_LINE, AB_PATH, AB_RUN, AB_RISE, AB_ARROW),
            tip: '`draw a double arrow from A to B` puts a head at both ends.',
        },
        {
            title: 'Turn the line with a slider',
            body: 'Make the slope a slider `m`. Drag it: the line turns, and the rise, its brace and the arrow follow.',
            chart: chart(...AB_WINDOW, AB_SLIDER, AB_TURN, AB_PATH, AB_RUN, AB_RISE, AB_ARROW),
        },
    ],
    next: ['computed-values', 'points-labels'],
};

// ---------------------------------------------------------- computed-values

/**
 * A parabola, a line that the slider c moves up and down, their crossings
 * P, the midpoint M built from them and the area between them. At c = 0 the
 * crossings are (2, 1) and (8, 4), M is (5, 2.5) and the area 9; as long as
 * the line cuts twice, M stays above x = 5 (tests/guides.test.ts).
 */
const CV_WINDOW = ['size 12 x 8', 'show x from -0.5 to 10 and y from -0.5 to 5.5', 'axes on the edges', 'with a grid'];
const CV_SLIDER = 'slider c from -3 to 0.5, starting at 0';
const CV_F = 'plot $f(x) = \\frac{1}{4}(x - 4)^2$ in blue, thick';
const CV_G = 'plot $g(x) = \\frac{1}{2}x + c$ in red, thick';
const CV_CROSS = 'P: mark where f and g cross, with coordinates';
const CV_COUNT = 'title crossing points: {P_n}';
const CV_MID = 'M: mark ((P_x + P_x2)/2, (P_y + P_y2)/2) in purple, large, with lines to the axes, labelled "M"';
const CV_AREA = 'shade where $f \\le y \\le g$ in green, labelled "A = {(P_x2 - P_x)^3/24:2}"';
const CV_TITLE = 'title crossing points: {P_n}, midpoint x = {M_x:2}';
const CV_BASE = [...CV_WINDOW, CV_SLIDER, CV_F, CV_G, CV_CROSS];

const COMPUTED_VALUES: Guide = {
    id: 'computed-values',
    title: 'Calculate with computed points',
    summary: 'Use what crossing points publish, their count and coordinates, in a title, a new point and an area.',
    category: 'Points, lines and labels',
    level: 'core',
    minutes: 4,
    outcomes: ['Use the values a marked point publishes, such as `P_x` and `P_n`', 'Build a new point from computed coordinates', 'Print a count, a midpoint and an area that follow a slider'],
    requires: ['points-labels', 'sliders'],
    chart: chart(...CV_BASE, CV_TITLE, CV_MID, CV_AREA),
    steps: [
        {
            title: 'Mark where a line cuts a parabola',
            body: '`P: mark where f and g cross` marks the crossings and names them `P`. The slider `c` moves the line up and down.',
            chart: chart(...CV_BASE),
        },
        {
            title: 'Count the crossings in the title',
            body: '`P` publishes what it finds: `P_x` and `P_y` for the first crossing, `P_x2` and `P_y2` for the second, `P_n` for their count. `{P_n}` prints it.',
            chart: chart(...CV_BASE, CV_COUNT),
            tip: 'At `c = -2.25` the line only touches the parabola, and the count is 1.',
        },
        {
            title: 'Build the midpoint from the crossings',
            body: 'A point can use these values. `M` is the average of the two crossings, so it moves whenever they move.',
            chart: chart(...CV_BASE, CV_COUNT, CV_MID),
        },
        {
            title: 'Print the area between them',
            body: 'For this parabola, the area a line cuts off is the cube of the width between the crossings, over 24. The label computes it: `A = 9`.',
            chart: chart(...CV_BASE, CV_COUNT, CV_MID, CV_AREA),
        },
        {
            title: 'Play c and watch the values',
            body: 'Add the midpoint to the title and press play on `c`. The count, the area and `M` follow, but `M` stays above `x = 5`.',
            chart: chart(...CV_BASE, CV_TITLE, CV_MID, CV_AREA),
            tip: 'Below `c = -2.25` the line misses: a value that cannot be computed prints `?`, and what needs it is not drawn.',
        },
    ],
    next: ['surfaces-3d', 'supply-demand'],
};

export const SHAPES_GUIDES: Guide[] = [POINTS_LABELS, ARROWS_BRACES, COMPUTED_VALUES];
