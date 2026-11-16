/*
 * Guides of the category Regions and optimisation (5.1): regions, areas
 * between curves, the area between a curve and its tangent, linear and
 * integer programs, level curves and a market. Each step adds or changes a
 * line or two of the chart; the Help shows the chart in words with the new
 * lines lit, so the reader learns the language by building.
 */
import type { Guide } from './types';
import { chart } from './chart';

// ------------------------------------------------------------------ regions

const REGION_VIEW = ['show x from -2 to 5 and y from -0.5 to 5', 'size 12 x 8', 'axes in the middle', 'with a grid'];
const ABOVE = 'shade where $y \\ge \\frac{1}{4}x^2$ in purple';
const BETWEEN_CURVES = 'shade where $\\frac{1}{4}x^2 \\le y \\le \\frac{1}{2}x + 2$';
const CUT = `${BETWEEN_CURVES} and $x \\ge -1$`;
const NUMBERED_CORNERS = 'mark the corners of the region, labelled "{i}"';
const HATCHED = `${CUT} in purple, pattern north-east, outlined, labelled "$S$"`;

const REGIONS: Guide = {
    id: 'regions',
    title: 'Shade a region with inequalities',
    summary: 'Shade where conditions hold, between two curves and cut by a third, then number its corners and hatch it.',
    category: 'Regions and optimisation',
    level: 'core',
    minutes: 3,
    outcomes: ['Shade a region with conditions in LaTeX', 'Put y between two curves with a chain', 'Mark and number the corners of a region'],
    requires: ['chart-language'],
    next: ['areas-between', 'linear-program'],
    chart: chart(...REGION_VIEW, HATCHED, NUMBERED_CORNERS),
    steps: [
        {
            title: 'Shade where a condition holds',
            body: 'A `shade where` line colours every point where its condition holds. Write the condition in LaTeX between dollars, as in your notes: here, every point above a parabola.',
            chart: chart(...REGION_VIEW, ABOVE),
            tip: 'A region is shaded inside the window only, so the `show` line decides where it ends.',
        },
        {
            title: 'Shade between two curves',
            body: 'A chain puts y between two curves: above the parabola and below the line. The region ends where the two curves cross.',
            chart: chart(...REGION_VIEW, `${BETWEEN_CURVES} in purple`),
        },
        {
            title: 'Add a condition with and',
            body: 'Join conditions with `and`: a point is shaded only where all of them hold. Here `$x \\ge -1$` cuts off the left tip.',
            chart: chart(...REGION_VIEW, `${CUT} in purple`),
        },
        {
            title: 'Number the corners',
            body: '`mark the corners of the region` puts a point where two edges meet. In the label, `{i}` counts them: 1, 2, 3.',
            chart: chart(...REGION_VIEW, `${CUT} in purple`, NUMBERED_CORNERS),
            tip: 'Write `with coordinates` instead of the label to see where each corner lies.',
        },
        {
            title: 'Hatch the region and name it',
            body: 'Options after a comma change the look: `pattern north-east` hatches the region, `outlined` draws its edge, and `labelled` writes a name in the middle.',
            chart: chart(...REGION_VIEW, HATCHED, NUMBERED_CORNERS),
            tip: 'Other patterns: `horizontal`, `vertical`, `crosshatch`, `dots` and `north-west`.',
        },
    ],
};

// ------------------------------------------------------------ areas between

const WAVE_VIEW = ['show x from 0 to 2pi and y from -2.5 to 2.5', 'size 12 x 6', 'axes in the middle', 'x numbers every pi/2'];
const WAVES = ['plot $f(x) = 2\\sin(x)$ in blue, thick', 'plot $g(x) = \\sin(2x)$ in magenta, thick'];
const F_ON_TOP = 'shade where $g \\le y \\le f$ in blue';
const G_ON_TOP = 'shade where $f \\le y \\le g$ in magenta';
const CROSSINGS = 'mark where f and g cross in black';

const AREAS_BETWEEN: Guide = {
    id: 'areas-between',
    title: 'Shade the areas between two curves',
    summary: 'Two waves, the areas between them split where they cross, each in its own colour and labelled.',
    category: 'Regions and optimisation',
    level: 'core',
    minutes: 3,
    outcomes: ['Shade the area between two curves', 'Give each side its own colour with a chain', 'Label an area with math in dollars'],
    requires: ['regions'],
    next: ['tangent-area', 'supply-demand'],
    chart: chart(...WAVE_VIEW, ...WAVES, `${F_ON_TOP}, labelled "$A_1 = 4$"`, `${G_ON_TOP}, labelled "$A_2 = 4$"`, CROSSINGS),
    steps: [
        {
            title: 'Draw the two curves',
            body: 'Give each curve a name, `f` and `g`, so other lines can use it. `x numbers every pi/2` numbers the x axis in steps of π/2.',
            chart: chart(...WAVE_VIEW, ...WAVES),
        },
        {
            title: 'Shade between them',
            body: '`shade between f and g` fills every gap between the two curves, whichever lies on top. It is one region in one colour.',
            chart: chart(...WAVE_VIEW, ...WAVES, 'shade between f and g'),
        },
        {
            title: 'Split the area where they cross',
            body: 'The chain `$g \\le y \\le f$` holds only where `f` lies above `g`. Write it both ways, each in its own colour, and mark where the curves cross.',
            chart: chart(...WAVE_VIEW, ...WAVES, F_ON_TOP, G_ON_TOP, CROSSINGS),
            tip: 'In a condition, a function name without brackets is its value at each x.',
        },
        {
            title: 'Label each area',
            body: '`labelled` writes a label in the middle of each area. Both areas are 4: the integral of `2\\sin(x) - \\sin(2x)` from 0 to π gives the first.',
            chart: chart(...WAVE_VIEW, ...WAVES, `${F_ON_TOP}, labelled "$A_1 = 4$"`, `${G_ON_TOP}, labelled "$A_2 = 4$"`, CROSSINGS),
            tip: 'Text between dollars in a label is set as math: `$A_1$` prints A with a small 1.',
        },
    ],
};

// ------------------------------------------------------------- tangent area

const CUBIC_VIEW = ['show x from -3 to 3 and y from -4 to 4', 'size 10 x 8', 'axes in the middle'];
const POINT_A = 'slider a from -1.1 to 1.1, starting at 1';
const CUBIC = 'plot $f(x) = x^3 - 3x$ in blue, thick';
const CUBIC_TANGENT = 'plot $g(x) = f(a) + (3a^2 - 3)(x - a)$ in red, thick';
const MEETING = 'P: mark where f and g cross, with coordinates';
const ENCLOSED = 'shade between f and g from x = P_x to P_x2 in orange';
const ANY_CURVE = 'plot $f(x) = 2x\\cos(x)$ in blue, thick';
const ANY_TANGENT = 'plot $g(x) = f(a) + \\frac{f(a + 0.001) - f(a - 0.001)}{0.002}(x - a)$ in red, thick';

const TANGENT_AREA: Guide = {
    id: 'tangent-area',
    title: 'Shade between a curve and its tangent',
    summary: 'Write the tangent at a slider point as a function and shade the area it encloses with the curve.',
    category: 'Regions and optimisation',
    level: 'advanced',
    minutes: 4,
    outcomes: ['Write a tangent that follows a slider', 'Shade from one computed point to another', 'Make the chart work for any curve'],
    requires: ['areas-between', 'sliders'],
    next: ['linear-program', 'secant-tangent'],
    chart: chart(...CUBIC_VIEW, POINT_A, ANY_CURVE, ANY_TANGENT, MEETING, ENCLOSED),
    steps: [
        {
            title: 'Draw the curve',
            body: 'Plot the cubic `f` in a window around its hill and its valley. The next step adds a tangent that touches it at a point you can drag.',
            chart: chart(...CUBIC_VIEW, CUBIC),
        },
        {
            title: 'Write the tangent as a function',
            body: 'The tangent at `a` is the height `f(a)` plus the slope `3a^2 - 3` times the step `x - a`. Drag `a` and the line rolls along the curve.',
            chart: chart(...CUBIC_VIEW, POINT_A, CUBIC, CUBIC_TANGENT),
            tip: '`with its tangent at a` draws a tangent too, but without a name, and a region needs a named function.',
        },
        {
            title: 'Mark where the two meet',
            body: 'The tangent touches the curve at `a` and crosses it once more. `P_x` and `P_x2` are the x of the two points, from left to right.',
            chart: chart(...CUBIC_VIEW, POINT_A, CUBIC, CUBIC_TANGENT, MEETING),
        },
        {
            title: 'Shade between the two points',
            body: '`shade between f and g` fills the gap between the curves, whichever is on top, and the range keeps the part from `P_x` to `P_x2`.',
            chart: chart(...CUBIC_VIEW, POINT_A, CUBIC, CUBIC_TANGENT, MEETING, ENCLOSED),
            tip: 'At `a = 0` the tangent meets the curve only once, so there is nothing to shade.',
        },
        {
            title: 'Make it work for any curve',
            body: 'Write the slope as a difference quotient: it measures the slope of `f` at `a` for any formula. Now change `f`: the tangent, the points and the area follow.',
            chart: chart(...CUBIC_VIEW, POINT_A, ANY_CURVE, ANY_TANGENT, MEETING, ENCLOSED),
        },
    ],
};

// ----------------------------------------------------------- linear program

const LP_VIEW = ['show x from 0 to 7 and y from 0 to 6', 'size 12 x 8', 'axes on the edges'];
const LP_REGION =
    'shade where $x + y \\ge 2$ and $x + 2y \\le 10$ and $3x + 2y \\le 18$ and $x \\ge 0$ and $y \\ge 0$ in green, numbered, with constraint lines';
const LP_CORNERS = 'mark the corners of the region in teal, with coordinates';
const PROFIT = 'slider c from 0 to 30, starting at 12';
const PROFIT_LINE = 'draw $4x + 3y = c$ in purple, thick, dashed, labelled "$z = {c}$"';
const LP_MAX = 'mark the maximum of $4x + 3y$ in the region in red, large, labelled "max {val}"';
const LP_MIN = 'mark the minimum of $4x + 3y$ in the region in blue, large, labelled "min {val}"';

const LINEAR_PROGRAM: Guide = {
    id: 'linear-program',
    title: 'Solve a linear program in a picture',
    summary: 'Constraint lines, the feasible region and its corners, an objective line on a slider, the maximum and the minimum.',
    category: 'Regions and optimisation',
    level: 'core',
    minutes: 3,
    outcomes: ['Draw a linear program with numbered constraint lines', 'Slide the objective line across the region', 'Let the chart find the maximum and the minimum'],
    requires: ['chart-language'],
    next: ['integer-program', 'level-curves'],
    chart: chart(...LP_VIEW, PROFIT, LP_REGION, LP_CORNERS, PROFIT_LINE, LP_MAX, LP_MIN),
    steps: [
        {
            title: 'Draw the constraints',
            body: 'Write each condition of the model in `shade where`: the shaded part is the feasible region. `with constraint lines` draws every condition as a line, and `numbered` numbers them.',
            chart: chart(...LP_VIEW, LP_REGION),
            tip: 'Use `\\ge` for at least: `$x + y \\ge 2$` keeps the region away from the origin.',
        },
        {
            title: 'Mark the corners',
            body: 'An optimum of a linear program lies on a corner. `mark the corners of the region` finds all five, and `with coordinates` labels them.',
            chart: chart(...LP_VIEW, LP_REGION, LP_CORNERS),
        },
        {
            title: 'Add the objective line',
            body: 'The objective `4x + 3y` has the same value `c` all along the line `4x + 3y = c`. Drag `c` and the line slides across the region.',
            chart: chart(...LP_VIEW, PROFIT, LP_REGION, LP_CORNERS, PROFIT_LINE),
        },
        {
            title: 'Mark the maximum',
            body: 'The chart finds the best point by itself: the last corner the line touches. In the label, `{val}` prints the value of `4x + 3y` there.',
            chart: chart(...LP_VIEW, PROFIT, LP_REGION, LP_CORNERS, PROFIT_LINE, LP_MAX),
        },
        {
            title: 'Mark the minimum too',
            body: '`mark the minimum` finds the first corner the line touches. Drag `c` from 6 to 25: the line enters the region at the minimum and leaves it at the maximum.',
            chart: chart(...LP_VIEW, PROFIT, LP_REGION, LP_CORNERS, PROFIT_LINE, LP_MAX, LP_MIN),
            tip: 'Open the chart in the editor and drag a constraint line: the region, its corners and both optima follow.',
        },
    ],
};

// ---------------------------------------------------------- integer program

const IP_VIEW = ['show x from -0.5 to 7 and y from -0.5 to 5', 'size 12 x 8', 'axes in the middle'];
const IP_TITLE = 'title relaxed {P_val}, integer {Q_val}';
const IP_REGION = 'shade where $x + 2y \\le 8$ and $3x + 2y \\le 18$ and $x \\ge 0$ and $y \\ge 0$ in orange';
const IP_DOTS = 'mark the integer points in the region in gray, small';
const IP_BEST = 'Q: mark the integer maximum of $3x + 4y$ in the region in green, large, with coordinates';
const IP_RELAXED = 'P: mark the maximum of $3x + 4y$ in the region in red, large, with coordinates';
const IP_LINES = 'draw the level curves of $3x + 4y$ at P_val and Q_val in purple, dashed, labelled "{level}"';

const INTEGER_PROGRAM: Guide = {
    id: 'integer-program',
    title: 'Compare an integer program with its relaxation',
    summary: 'The integer points of a region, the best of them, and the gap to the optimum without whole numbers.',
    category: 'Regions and optimisation',
    level: 'advanced',
    minutes: 3,
    outcomes: ['Mark every integer point of a region', 'Find the best integer point for an objective', 'Compare it with the optimum of the linear program'],
    requires: ['linear-program'],
    next: ['level-curves', 'computed-values'],
    chart: chart(...IP_VIEW, IP_TITLE, IP_REGION, IP_DOTS, IP_BEST, IP_RELAXED, IP_LINES),
    steps: [
        {
            title: 'Shade the region',
            body: 'Maximise `3x + 4y` where x and y must be whole numbers. First shade the region of the other conditions.',
            chart: chart(...IP_VIEW, IP_REGION),
        },
        {
            title: 'Mark the integer points',
            body: '`mark the integer points in the region` puts a dot on every point with whole coordinates. These 22 dots are all the choices left.',
            chart: chart(...IP_VIEW, IP_REGION, IP_DOTS),
        },
        {
            title: 'Find the best integer point',
            body: '`mark the integer maximum` tries every dot and keeps the best: (4, 2), where `3x + 4y` is 20. `Q:` gives the point a name.',
            chart: chart(...IP_VIEW, IP_REGION, IP_DOTS, IP_BEST),
        },
        {
            title: 'Compare it with the relaxation',
            body: 'Without whole numbers the best point is the corner (5, 1.5), with 21. Rounding it gives (5, 2), which lies outside the region.',
            chart: chart(...IP_VIEW, IP_REGION, IP_DOTS, IP_BEST, IP_RELAXED),
        },
        {
            title: 'Draw both objective lines',
            body: '`P_val` and `Q_val` are the two best values. Level curves of `3x + 4y` at them draw a line through each point, and the title prints both.',
            chart: chart(...IP_VIEW, IP_TITLE, IP_REGION, IP_DOTS, IP_BEST, IP_RELAXED, IP_LINES),
            tip: 'Anything in braces is a formula: `{P_val - Q_val}` prints the gap, 1.',
        },
    ],
};

// ------------------------------------------------------------- level curves

const LEVEL_VIEW = ['show x from -0.5 to 9 and y from -0.5 to 7', 'size 12 x 8', 'equal scale', 'axes in the middle'];
const LEVEL_REGION = 'shade where $x + y \\le 6$ and $x \\le 4$ and $x \\ge 0$ and $y \\ge 0$ in teal';
const CENTRE = 'slider p from 2 to 8, starting at 6';
/** The squared distance from (cx, 5), in LaTeX. */
const distance = (cx: string) => `$(x - ${cx})^2 + (y - 5)^2$`;
const circles = (cx: string, levels: string) => `draw the level curves of ${distance(cx)} at ${levels} in purple, labelled "{level}"`;
const closest = (cx: string) => `P: mark the minimum of ${distance(cx)} in the region, large, with coordinates`;

const LEVEL_CURVES: Guide = {
    id: 'level-curves',
    title: 'Find a nonlinear optimum with level curves',
    summary: 'Circles of equal distance as level curves, and the closest point of a region, where one of them touches.',
    category: 'Regions and optimisation',
    level: 'advanced',
    minutes: 3,
    outcomes: ['Draw the level curves of a formula in x and y', 'Find a nonlinear minimum over a region', 'Draw the level curve through the optimum'],
    requires: ['linear-program'],
    next: ['supply-demand', 'surfaces-3d'],
    chart: chart(...LEVEL_VIEW, CENTRE, circles('p', '1, 4, 9, 16 and P_val'), LEVEL_REGION, closest('p')),
    steps: [
        {
            title: 'Draw level curves',
            body: 'A level curve joins the points where a formula has one value. This formula is the squared distance from (6, 5), so its level curves are circles.',
            chart: chart(...LEVEL_VIEW, circles('6', '1, 4, 9 and 16')),
        },
        {
            title: 'Add the region',
            body: 'Which point of the region lies closest to (6, 5)? It sits on the smallest circle that still reaches the region.',
            chart: chart(...LEVEL_VIEW, circles('6', '1, 4, 9 and 16'), LEVEL_REGION),
        },
        {
            title: 'Mark the closest point',
            body: '`mark the minimum` searches the whole region, inside and on the edges. Here the best point lies on an edge, between two corners.',
            chart: chart(...LEVEL_VIEW, circles('6', '1, 4, 9 and 16'), LEVEL_REGION, closest('6')),
        },
        {
            title: 'Draw the circle through it',
            body: '`P_val` is the value at P. Its level curve touches the edge at P without crossing it: that is what an optimum looks like.',
            chart: chart(...LEVEL_VIEW, circles('6', '1, 4, 9, 16 and P_val'), LEVEL_REGION, closest('6')),
        },
        {
            title: 'Move the centre with a slider',
            body: 'Put a slider `p` in place of 6. Drag it: the point slides along the edge and, from `p = 7` on, stays at the corner (4, 2).',
            chart: chart(...LEVEL_VIEW, CENTRE, circles('p', '1, 4, 9, 16 and P_val'), LEVEL_REGION, closest('p')),
            tip: '`mark the maximum` works the same way: the best point lies on the largest level curve that still reaches the region.',
        },
    ],
};

// ------------------------------------------------------------ supply demand

const MARKET_VIEW = ['show x from 0 to 12 and y from 0 to 12', 'size 12 x 8', 'axes on the edges', 'xlabel quantity', 'ylabel price'];
const DEMAND = 'plot $D(x) = 10 - x$ in blue, thick';
const SUPPLY = 'plot $S(x) = 1 + \\frac{1}{2}x$ in red, thick';
const EQUILIBRIUM = 'P: mark where D and S cross, with lines to the axes, with coordinates';
const CONSUMERS = 'shade where $P_y \\le y \\le D$ in teal, labelled "CS = {P_x*(D(0) - P_y)/2:1}"';
const PRODUCERS = 'shade where $S \\le y \\le P_y$ in orange, labelled "PS = {P_x*(P_y - S(0))/2:1}"';
const DEMAND_SHIFT = 'slider d from 6 to 12, starting at 10';
const SHIFTED = 'plot $D(x) = d - x$ in blue, thick';

const SUPPLY_DEMAND: Guide = {
    id: 'supply-demand',
    title: 'Draw a market with surplus areas',
    summary: 'Demand and supply, the equilibrium with lines to the axes, and both surpluses following a demand slider.',
    category: 'Regions and optimisation',
    level: 'core',
    minutes: 3,
    outcomes: ['Mark the equilibrium of two lines', 'Shade consumer and producer surplus with computed limits', 'Shift demand with a slider and watch everything follow'],
    requires: ['areas-between'],
    next: ['computed-values', 'charts-in-notes'],
    chart: chart(...MARKET_VIEW, DEMAND_SHIFT, SHIFTED, SUPPLY, EQUILIBRIUM, CONSUMERS, PRODUCERS),
    steps: [
        {
            title: 'Draw the demand line',
            body: '`xlabel` and `ylabel` name the axes: economists put the price on the y axis. Demand `D` falls, because people buy more when the price is lower.',
            chart: chart(...MARKET_VIEW, DEMAND),
        },
        {
            title: 'Add supply and the equilibrium',
            body: 'Supply `S` rises with the price. The market settles where the lines cross, and `with lines to the axes` shows its quantity and price.',
            chart: chart(...MARKET_VIEW, DEMAND, SUPPLY, EQUILIBRIUM),
        },
        {
            title: 'Shade the consumer surplus',
            body: 'Buyers gain the area between the price `P_y` and demand. The braces in the label compute it: half the width `P_x` times the height `D(0) - P_y`.',
            chart: chart(...MARKET_VIEW, DEMAND, SUPPLY, EQUILIBRIUM, CONSUMERS),
            tip: 'In a condition, `D` without brackets is the value of demand at each x.',
        },
        {
            title: 'Shade the producer surplus',
            body: 'Sellers gain the area between supply and the price. Together the two areas fill the triangle between the lines, left of the equilibrium.',
            chart: chart(...MARKET_VIEW, DEMAND, SUPPLY, EQUILIBRIUM, CONSUMERS, PRODUCERS),
        },
        {
            title: 'Shift demand with a slider',
            body: 'Replace 10 by a slider `d` and drag it. The equilibrium, its lines and both areas with their values follow at once.',
            chart: chart(...MARKET_VIEW, DEMAND_SHIFT, SHIFTED, SUPPLY, EQUILIBRIUM, CONSUMERS, PRODUCERS),
            tip: '`:1` after a formula in braces rounds it to one decimal.',
        },
    ],
};

/** Guides of this group, in the order the Help lists them. */
export const OPTIMISATION_GUIDES: Guide[] = [REGIONS, AREAS_BETWEEN, TANGENT_AREA, LINEAR_PROGRAM, INTEGER_PROGRAM, LEVEL_CURVES, SUPPLY_DEMAND];
