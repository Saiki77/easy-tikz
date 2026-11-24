/*
 * Guides of the category Showcase (5.2): charts whose parts follow each
 * other. A slider moves a point, a tangent, a region or a label, and what
 * depends on it moves along. The editor offers their finished charts as
 * examples too (src/ui/buildPanel.ts, src/modal.ts). 6.0 adds six pictures
 * of version 6 in front.
 */
import type { Guide } from './types';
import { chart } from './chart';

// ------------------------------------------------------------------ shade under a tangent
const TT_WINDOW = ['size 12 x 8', 'show x from 0 to 6 and y from 0 to 4.5', 'axes on the edges', 'with a grid'];
const TT_CURVE = 'plot $f(x) = \\frac{1}{x}$ in blue, very thick';
const TT_SLIDER = 'slider a from 0.5 to 3, starting at 1, in steps of 0.05';
const TT_TANGENT = 'plot $f(x) = \\frac{1}{x}$ in blue, very thick, with its tangent at a';
const TT_POINT = 'P: mark (a, f(a)), large, labelled "P"';
const TT_LINE = 'plot $g(x) = \\frac{2}{a} - \\frac{x}{a^2}$, hidden';
const TT_SHADE = 'shade under g from x = 0 to 2a in orange';
const TT_LABELLED = 'shade under g from x = 0 to 2a in orange, labelled "A = {(2*a)*(2/a)/2:2}"';

const TANGENT_TRIANGLE: Guide = {
    id: 'tangent-triangle',
    title: 'Shade under a tangent',
    summary: 'The tangent to 1/x cuts a triangle from the corner of the axes; drag the point and its area stays 2.',
    category: 'Showcase',
    level: 'core',
    minutes: 2,
    outcomes: ['Put a tangent on a slider', 'Shade under a line that moves', 'Print a value that follows the slider'],
    next: ['largest-rectangle', 'tangent-area'],
    chart: chart(...TT_WINDOW, TT_SLIDER, TT_TANGENT, TT_POINT, TT_LINE, TT_LABELLED),
    steps: [
        {
            title: 'Plot the hyperbola',
            body: 'Start with `f(x) = 1/x` in the first quadrant.',
            chart: chart(...TT_WINDOW, TT_CURVE),
        },
        {
            title: 'Put a tangent on a slider',
            body: '`with its tangent at a` draws the tangent at the point P over `a`. Drag `a` and both move.',
            chart: chart(...TT_WINDOW, TT_SLIDER, TT_TANGENT, TT_POINT),
        },
        {
            title: 'Shade under the tangent',
            body: 'The tangent is the hidden line `g`. `shade under g` fills the triangle it cuts from the axes, from 0 to `2a`.',
            chart: chart(...TT_WINDOW, TT_SLIDER, TT_TANGENT, TT_POINT, TT_LINE, TT_SHADE),
        },
        {
            title: 'Print the area',
            body: 'The label works out the area while you drag. The triangle changes shape, but its area stays 2.',
            chart: chart(...TT_WINDOW, TT_SLIDER, TT_TANGENT, TT_POINT, TT_LINE, TT_LABELLED),
        },
    ],
};

// ------------------------------------------------------------------ the largest rectangle under a parabola
const LR_WINDOW = ['size 12 x 8', 'show x from -2.5 to 2.5 and y from -0.5 to 4.5', 'axes in the middle', 'with a grid'];
const LR_CURVE = 'plot $f(x) = 4 - x^2$ in blue, very thick';
const LR_SLIDER = 'slider a from 0 to 2, starting at 0.8, in steps of 0.01';
const LR_CORNERS = 'mark (a, f(a)) and (-a, f(a)), labelled "P; Q"';
const LR_SHADE = 'shade where $-a \\le x \\le a$ and $0 \\le y \\le f(a)$ in purple';
const LR_TITLE = 'title area {2*a*(4 - a^2):2}, the largest is {32/(3*sqrt(3)):2} at a = {2/sqrt(3):2}';

const LARGEST_RECTANGLE: Guide = {
    id: 'largest-rectangle',
    title: 'The largest rectangle under a parabola',
    summary: 'A rectangle whose corners sit on the parabola: drag its corner and find where its area is largest.',
    category: 'Showcase',
    level: 'core',
    minutes: 2,
    outcomes: ['Shade a region that follows a slider', 'Mark points that depend on a slider', 'Read an optimum off a live title'],
    next: ['mean-value'],
    chart: chart(...LR_WINDOW, LR_TITLE, LR_SLIDER, LR_CURVE, LR_SHADE, LR_CORNERS),
    steps: [
        {
            title: 'Plot the parabola',
            body: 'The rectangle will stand under `f(x) = 4 - x^2`.',
            chart: chart(...LR_WINDOW, LR_CURVE),
        },
        {
            title: 'Put the corners on a slider',
            body: 'P and Q sit on the curve at `a` and `-a`. Drag `a` and they slide along it.',
            chart: chart(...LR_WINDOW, LR_SLIDER, LR_CURVE, LR_CORNERS),
        },
        {
            title: 'Shade the rectangle',
            body: 'The conditions use `a` and `f(a)`, so the rectangle follows the corners.',
            chart: chart(...LR_WINDOW, LR_SLIDER, LR_CURVE, LR_SHADE, LR_CORNERS),
        },
        {
            title: 'Find the largest area',
            body: 'The title prints the area for the `a` shown. Drag `a` until it reaches its largest value, at about 1.15.',
            chart: chart(...LR_WINDOW, LR_TITLE, LR_SLIDER, LR_CURVE, LR_SHADE, LR_CORNERS),
        },
    ],
};

// ------------------------------------------------------------------ the mean value theorem
const MV_WINDOW = ['size 12 x 8', 'show x from -0.3 to 2.4 and y from -0.5 to 9', 'axes on the edges', 'with a grid'];
const MV_CURVE = 'plot $f(x) = x^3$ in blue, very thick';
const MV_SLIDER = 'slider b from 0.3 to 2.2, starting at 2, in steps of 0.01';
const MV_SECANT = 'plot $s(x) = b^2 x$ in red, thick';
const MV_AB = 'mark (0, 0) and (b, f(b)), labelled "A; B"';
const MV_TANGENT = 'plot $f(x) = x^3$ in blue, very thick, with its tangent at b/sqrt(3)';
const MV_ABC = 'mark (0, 0), (b, f(b)) and (b/sqrt(3), f(b/sqrt(3))), labelled "A; B; C"';
const MV_TITLE = "title secant slope {b^2:2} = f'(c) at c = {b/sqrt(3):2}";

const MEAN_VALUE: Guide = {
    id: 'mean-value',
    title: 'The mean value theorem',
    summary: 'Between A and B a tangent runs parallel to the secant; drag B and the point C follows.',
    category: 'Showcase',
    level: 'advanced',
    minutes: 3,
    outcomes: ['Draw a secant through two points of a curve', 'Put a tangent at a point worked out from a slider', 'Print slopes in the title'],
    next: ['secant-tangent'],
    chart: chart(...MV_WINDOW, MV_TITLE, MV_SLIDER, MV_TANGENT, MV_SECANT, MV_ABC),
    steps: [
        {
            title: 'Plot the cubic',
            body: 'Start with `f(x) = x^3`.',
            chart: chart(...MV_WINDOW, MV_CURVE),
        },
        {
            title: 'Draw the secant from A to B',
            body: 'B sits on the curve over the slider `b`. The secant through A and B has the slope `b^2`.',
            chart: chart(...MV_WINDOW, MV_SLIDER, MV_CURVE, MV_SECANT, MV_AB),
        },
        {
            title: 'Find the parallel tangent',
            body: 'At C, over `b/sqrt(3)`, the tangent has the same slope as the secant. The tangent point is a formula of `b`.',
            chart: chart(...MV_WINDOW, MV_SLIDER, MV_TANGENT, MV_SECANT, MV_ABC),
        },
        {
            title: 'Print both slopes',
            body: 'The title shows the slope and where C sits. Drag `b`: the tangent stays parallel to the secant.',
            chart: chart(...MV_WINDOW, MV_TITLE, MV_SLIDER, MV_TANGENT, MV_SECANT, MV_ABC),
        },
    ],
};

// ------------------------------------------------------------------ Taylor polynomials of sin(x)
const TS_WINDOW = ['size 12 x 8', 'show x from -7 to 7 and y from -2.5 to 2.5', 'axes in the middle', 'with a grid'];
const TS_SINE = 'plot $f(x) = \\sin(x)$ in blue, very thick';
const TS_POLY = 'plot p(x) = x - (n >= 3 ? x^3/6 : 0) + (n >= 5 ? x^5/120 : 0) - (n >= 7 ? x^7/5040 : 0) + (n >= 9 ? x^9/362880 : 0) in red, thick';
const tsSlider = (start: number) => `slider n from 1 to 9, starting at ${start}, in steps of 2`;
const TS_TITLE = 'title Taylor polynomial of degree {n}';

const TAYLOR_SINE: Guide = {
    id: 'taylor-sine',
    title: 'Taylor polynomials of sin(x)',
    summary: 'Raise the degree with a slider and watch the polynomial hug the sine over a wider and wider range.',
    category: 'Showcase',
    level: 'advanced',
    minutes: 2,
    outcomes: ['Switch the terms of a formula on and off with a slider', 'Compare a function with its approximation'],
    next: ['riemann-sums'],
    chart: chart(...TS_WINDOW, TS_TITLE, tsSlider(7), TS_SINE, TS_POLY),
    steps: [
        {
            title: 'Plot the sine',
            body: 'Start with `f(x) = \\sin(x)`.',
            chart: chart(...TS_WINDOW, TS_SINE),
        },
        {
            title: 'Add the polynomial with a slider',
            body: 'Each term counts only from its degree on: `n >= 3 ? x^3/6 : 0` is the cube term when `n` is 3 or more, else 0.',
            chart: chart(...TS_WINDOW, tsSlider(3), TS_SINE, TS_POLY),
        },
        {
            title: 'Raise the degree',
            body: 'Drag `n` up, or press play. Each new term holds the curve to the sine a little further out.',
            chart: chart(...TS_WINDOW, TS_TITLE, tsSlider(7), TS_SINE, TS_POLY),
        },
    ],
};

// ------------------------------------------------------------------ a gradient on level curves
const GL_WINDOW = ['size 12 x 8', 'equal scale', 'show x from -3.2 to 3.2 and y from -2.2 to 2.2', 'axes in the middle'];
const GL_LEVELS = 'draw the level curves of x^2 + 2y^2 at 1, 2, 4 and 8 in purple, labelled "{level}"';
const GL_SLIDER = 'slider s from 0 to 6.28, starting at 0.8, in steps of 0.01';
const GL_POINT = 'P: mark (1.6cos(s), 1.1sin(s)), large';
const GL_THROUGH = 'draw the level curves of x^2 + 2y^2 at P_x^2 + 2*P_y^2 in red, dashed';
const GL_ARROW = 'draw an arrow from P to (1.4*P_x, 1.8*P_y) in red, very thick, labelled "$\\nabla f$"';

const GRADIENT_LEVELS: Guide = {
    id: 'gradient-levels',
    title: 'A gradient on level curves',
    summary: 'A point moves around the level curves; the level through it and its gradient arrow move along.',
    category: 'Showcase',
    level: 'advanced',
    minutes: 3,
    outcomes: ['Draw level curves of a function of x and y', 'Use the coordinates of a point in other objects', 'Draw a gradient arrow'],
    next: ['level-curves'],
    chart: chart(...GL_WINDOW, GL_SLIDER, GL_LEVELS, GL_POINT, GL_THROUGH, GL_ARROW),
    steps: [
        {
            title: 'Draw the level curves',
            body: 'The ellipses are where `x^2 + 2y^2` takes the values 1, 2, 4 and 8.',
            chart: chart(...GL_WINDOW, GL_LEVELS),
        },
        {
            title: 'Move a point with a slider',
            body: 'P runs around an ellipse as `s` goes from 0 to 6.28.',
            chart: chart(...GL_WINDOW, GL_SLIDER, GL_LEVELS, GL_POINT),
        },
        {
            title: 'Draw the level through P',
            body: '`P_x` and `P_y` are the coordinates of P. The dashed level curve uses them, so it always passes through P.',
            chart: chart(...GL_WINDOW, GL_SLIDER, GL_LEVELS, GL_POINT, GL_THROUGH),
        },
        {
            title: 'Add the gradient arrow',
            body: 'The gradient of `x^2 + 2y^2` is (2x, 4y). Its arrow stands at right angles to the dashed level, wherever P goes.',
            chart: chart(...GL_WINDOW, GL_SLIDER, GL_LEVELS, GL_POINT, GL_THROUGH, GL_ARROW),
        },
    ],
};

// ------------------------------------------------------------------ two lines and their crossing
const CL_WINDOW = ['size 12 x 8', 'show x from -4 to 4 and y from -3 to 3', 'axes in the middle', 'with a grid'];
const CL_G = 'plot $g(x) = 0.5x + 1$ in blue, very thick';
const CL_SLIDER = 'slider m from -3 to 3, starting at 1.5, in steps of 0.05';
const CL_H = 'plot $h(x) = mx - 1$ in red, very thick';
const CL_CROSS = 'P: mark where g and h cross, large, with coordinates';
const CL_TITLE = 'title they cross at an angle of {atan(abs((m - 0.5)/(1 + 0.5*m)))*180/pi:1} degrees';

const CROSSING_LINES: Guide = {
    id: 'crossing-lines',
    title: 'Two lines and their crossing',
    summary: 'Turn one line with a slider; the crossing point and the angle between the lines follow.',
    category: 'Showcase',
    level: 'start',
    minutes: 2,
    outcomes: ['Turn a line with a slope slider', 'Mark where two lines cross', 'Print the angle between them'],
    next: ['sliders'],
    chart: chart(...CL_WINDOW, CL_TITLE, CL_SLIDER, CL_G, CL_H, CL_CROSS),
    steps: [
        {
            title: 'Plot a line',
            body: 'Start with the line `g(x) = 0.5x + 1`.',
            chart: chart(...CL_WINDOW, CL_G),
        },
        {
            title: 'Turn a second line',
            body: 'The slope of `h` is the slider `m`. Drag it and the red line turns about (0, -1).',
            chart: chart(...CL_WINDOW, CL_SLIDER, CL_G, CL_H),
        },
        {
            title: 'Mark the crossing',
            body: '`mark where g and h cross` finds the point and prints its coordinates. At `m = 0.5` the lines are parallel and the point goes.',
            chart: chart(...CL_WINDOW, CL_SLIDER, CL_G, CL_H, CL_CROSS),
        },
        {
            title: 'Print the angle',
            body: 'The title works out the angle between the lines from both slopes.',
            chart: chart(...CL_WINDOW, CL_TITLE, CL_SLIDER, CL_G, CL_H, CL_CROSS),
        },
    ],
};

// ------------------------------------------------------------------ a ladder sliding down a wall
const SL_WINDOW = ['size 12 x 8', 'equal scale', 'show x from -0.5 to 5.5 and y from -0.5 to 5.5', 'axes on the edges', 'with a grid'];
const SL_SLIDER = 'slider w from 0.05 to 1.52, starting at 0.7, in steps of 0.01';
const SL_A = 'A: mark (5cos(w), 0), large, labelled "A"';
const SL_B = 'B: mark (0, 5sin(w)), large, labelled "B"';
const SL_LADDER = 'draw a line from A to B in blue, very thick';
const SL_M = 'M: mark (A_x/2, B_y/2), large, labelled "M"';
const SL_PATH = 'draw $x^2 + y^2 = 6.25$ in purple, dashed';

const SLIDING_LADDER: Guide = {
    id: 'sliding-ladder',
    title: 'A ladder sliding down a wall',
    summary: 'The foot of a ladder slides away from the wall; its middle point moves on a quarter circle.',
    category: 'Showcase',
    level: 'core',
    minutes: 2,
    outcomes: ['Name points and use their coordinates', 'Draw a line between named points', 'Find the path a point follows'],
    next: ['points-labels'],
    chart: chart(...SL_WINDOW, SL_SLIDER, SL_A, SL_B, SL_LADDER, SL_M, SL_PATH),
    steps: [
        {
            title: 'Put the foot on the floor',
            body: 'The ladder is 5 long. Its foot A sits at `5cos(w)` on the floor; the slider `w` is its angle.',
            chart: chart(...SL_WINDOW, SL_SLIDER, SL_A),
        },
        {
            title: 'Lean the top on the wall',
            body: 'B sits at `5sin(w)` on the wall. `draw a line from A to B` joins the named points.',
            chart: chart(...SL_WINDOW, SL_SLIDER, SL_A, SL_B, SL_LADDER),
        },
        {
            title: 'Mark the middle',
            body: 'M takes the coordinates of A and B: `A_x/2` and `B_y/2`.',
            chart: chart(...SL_WINDOW, SL_SLIDER, SL_A, SL_B, SL_LADDER, SL_M),
        },
        {
            title: 'Draw the path of the middle',
            body: 'Drag `w` or press play. M stays on the dashed circle of radius 2.5 round the corner.',
            chart: chart(...SL_WINDOW, SL_SLIDER, SL_A, SL_B, SL_LADDER, SL_M, SL_PATH),
        },
    ],
};

// ------------------------------------------------------------------ a throw at an angle
const PR_WINDOW = ['size 12 x 7', 'show x from 0 to 11 and y from 0 to 6', 'axes on the edges', 'with a grid', 'xlabel distance in m', 'ylabel height in m'];
const PR_SLIDER = 'slider w from 10 to 80, starting at 30, in steps of 1';
const PR_PATH = 'plot c(t) = (10*cos(w*pi/180)*t, 10*sin(w*pi/180)*t - 4.9*t^2) from t = 0 to 20*sin(w*pi/180)/9.81 in blue, very thick';
const PR_LAND = 'mark (100*sin(2*w*pi/180)/9.81, 0), large, labelled "lands"';
const PR_TOP = 'mark (50*sin(2*w*pi/180)/9.81, 5.0968*sin(w*pi/180)^2), labelled "top"';
const PR_TITLE = 'title angle {w} degrees: the ball lands at {100*sin(2*w*pi/180)/9.81:2} m';

const THROW: Guide = {
    id: 'throw-angle',
    title: 'A throw at an angle',
    summary: 'Throw a ball at 10 m/s and change the angle: the path, its top and where it lands move together.',
    category: 'Showcase',
    level: 'core',
    minutes: 2,
    outcomes: ['Plot a path in t with a slider in it', 'Mark points worked out from the slider', 'Find the angle that throws farthest'],
    next: ['parametric-polar'],
    chart: chart(...PR_WINDOW, PR_TITLE, PR_SLIDER, PR_PATH, PR_LAND, PR_TOP),
    steps: [
        {
            title: 'Plot the path of the ball',
            body: 'The path is a curve in the time `t`: x and y of the ball, for the angle `w` on the slider.',
            chart: chart(...PR_WINDOW, PR_SLIDER, PR_PATH),
        },
        {
            title: 'Mark where it lands',
            body: 'The landing point is a formula of `w` too, so it follows the path.',
            chart: chart(...PR_WINDOW, PR_SLIDER, PR_PATH, PR_LAND),
        },
        {
            title: 'Mark the top',
            body: 'The highest point sits halfway, at a height that grows with the angle.',
            chart: chart(...PR_WINDOW, PR_SLIDER, PR_PATH, PR_LAND, PR_TOP),
        },
        {
            title: 'Find the farthest throw',
            body: 'The title prints the distance. Drag `w`: the ball flies farthest at 45 degrees.',
            chart: chart(...PR_WINDOW, PR_TITLE, PR_SLIDER, PR_PATH, PR_LAND, PR_TOP),
        },
    ],
};

// ------------------------------------------------------------------ 6.0 F2: the pictures of version 6
// Fractals, a matrix, the Lorenz system, a pendulum, domain colouring and turning circles. They come
// first in the Showcase, so the Help's gallery and the editor's examples open with them.

// ------------------------------------------------------------------ the orbit of a point in the Mandelbrot set
const MO_WINDOW = ['size 12 x 8', 'show x from -2.4 to 1 and y from -1.15 to 1.15', 'equal scale'];
const MO_TITLE = 'title c = {a} + {b}i';
const moSliders = (a: number, b: number) => [`slider a from -2 to 0.5, starting at ${a}, in steps of 0.01`, `slider b from 0 to 1.1, starting at ${b}, in steps of 0.01`];
const MO_PLANE = 'colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps';
const MO_P = 'P: mark (a, b), large';
const MO_ORBIT = 'draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps, as a path';

const MANDELBROT_ORBIT: Guide = {
    id: 'mandelbrot-orbit',
    title: 'The orbit of a point in the Mandelbrot set',
    summary: 'Move c with two sliders over the Mandelbrot set: its orbit goes round inside the set and flies off outside it.',
    category: 'Showcase',
    level: 'core',
    minutes: 2,
    outcomes: ['Colour the plane by a recurrence', 'Draw the orbit of a point on sliders', 'See the inside and the outside of the set'],
    next: ['fractals', 'orbits-cobwebs'],
    chart: chart(...MO_WINDOW, MO_TITLE, ...moSliders(-0.12, 0.75), MO_PLANE, MO_P, MO_ORBIT),
    steps: [
        {
            title: 'Colour the plane by the recurrence',
            body: 'Every point c runs `z_{n+1} = z_n^2 + c` from 0. The dark points keep their orbit small: they are the Mandelbrot set.',
            chart: chart(...MO_WINDOW, MO_PLANE),
        },
        {
            title: 'Put c on two sliders',
            body: 'P sits at `(a, b)`, and the orbit of 0 for c = P is drawn as a path. Here it goes round three points for ever.',
            chart: chart(...MO_WINDOW, MO_TITLE, ...moSliders(-0.12, 0.75), MO_PLANE, MO_P, MO_ORBIT),
        },
        {
            title: 'Move c out of the set',
            body: 'Drag `a` and `b` to 0.4 and 0.6. Outside the set the orbit turns a few times and flies away.',
            chart: chart(...MO_WINDOW, MO_TITLE, ...moSliders(0.4, 0.6), MO_PLANE, MO_P, MO_ORBIT),
        },
    ],
};

// ------------------------------------------------------------------ a matrix with a slider moves the grid
const MG_WINDOW = ['size 12 x 8', 'show x from -4.5 to 4.5 and y from -3 to 3', 'equal scale'];
const mgSlider = (k: number) => `slider k from -1 to 3, starting at ${k}, in steps of 0.05`;
const MG_A = 'let $A = \\begin{pmatrix} 1 & k \\\\ 1 & 2 \\end{pmatrix}$';
const MG_BEFORE = ['draw the grid', 'draw the basis vectors', 'shade the unit square, labelled'];
const MG_MOVE = 'then transform the plane by A';
const MG_EIGEN = 'then draw the eigenvectors of A, labelled';

const MATRIX_GRID: Guide = {
    id: 'matrix-grid',
    title: 'A matrix with a slider moves the grid',
    summary: 'A slider changes one number of a matrix: the moved grid, the eigenvectors and the determinant follow it.',
    category: 'Showcase',
    level: 'core',
    minutes: 2,
    outcomes: ['Put a slider inside a matrix', 'Play the move of the plane', 'Watch the determinant pass through 0'],
    next: ['matrix-plane'],
    chart: chart(...MG_WINDOW, mgSlider(0.5), MG_A, ...MG_BEFORE, MG_MOVE, MG_EIGEN),
    steps: [
        {
            title: 'Draw the plane before the move',
            body: 'The grid, î, ĵ and the unit square. The matrix A has the slider `k` in its top right corner.',
            chart: chart(...MG_WINDOW, mgSlider(0.5), MG_A, ...MG_BEFORE),
        },
        {
            title: 'Move it by A',
            body: '`then transform the plane by A` moves it in step 2. Press Play, then drag `k`: the grid follows at once.',
            chart: chart(...MG_WINDOW, mgSlider(0.5), MG_A, ...MG_BEFORE, MG_MOVE),
        },
        {
            title: 'Add the eigenvectors',
            body: 'Step 3 adds the eigenvectors of A. Drag `k` and they turn; below -0.25 they are gone, as A then turns every line.',
            chart: chart(...MG_WINDOW, mgSlider(0.5), MG_A, ...MG_BEFORE, MG_MOVE, MG_EIGEN),
        },
        {
            title: 'Flatten the plane',
            body: 'At k = 2 the determinant is 0 and the plane falls onto a line. Past 2 it is below 0: the square turns over.',
            chart: chart(...MG_WINDOW, mgSlider(3), MG_A, ...MG_BEFORE, MG_MOVE, MG_EIGEN),
        },
    ],
};

// ------------------------------------------------------------------ two paths of the Lorenz system
const LZ_WINDOW = ['3d', 'show x from -25 to 25, y from -30 to 30 and z from 0 to 50'];
const LZ_SYSTEM = 'draw the solution of $\\dot{p} = (10(y - x), x(28 - z) - y, xy - \\frac{8}{3}z)$';
const lzTime = (end: number) => `slider T from 5 to 40, starting at ${end}`;
const LZ_TWO = [`${LZ_SYSTEM} through (1, 1, 1) for t from 0 to T in blue`, `${LZ_SYSTEM} through (1.001, 1, 1) for t from 0 to T in red`];

const LORENZ_BUTTERFLY: Guide = {
    id: 'lorenz-butterfly',
    title: 'Two paths of the Lorenz system',
    summary: 'Start the Lorenz system twice, a thousandth apart: the two paths stay together for a while, then part for good.',
    category: 'Showcase',
    level: 'advanced',
    minutes: 2,
    outcomes: ['Draw the solution of a system in 3D', 'Start two solutions side by side', 'Put the end time on a slider'],
    next: ['systems'],
    chart: chart(...LZ_WINDOW, lzTime(40), ...LZ_TWO),
    steps: [
        {
            title: 'Draw one path',
            body: 'The Lorenz system from (1, 1, 1), coloured by time. It winds round two wings and never repeats.',
            chart: chart(...LZ_WINDOW, `${LZ_SYSTEM} through (1, 1, 1) for t from 0 to 40, coloured by time`),
        },
        {
            title: 'Start a second path close by',
            body: 'A red path starts at (1.001, 1, 1), and both end at the time `T`. Up to T = 15 the red path lies on the blue one.',
            chart: chart(...LZ_WINDOW, lzTime(15), ...LZ_TWO),
        },
        {
            title: 'Let time run on',
            body: 'Drag `T` past 18: the paths part and go round the wings each in its own way. A small change at the start grows until it is all that counts.',
            chart: chart(...LZ_WINDOW, lzTime(40), ...LZ_TWO),
        },
    ],
};

// ------------------------------------------------------------------ a pendulum as a vector field
const PF_WINDOW = ['size 12 x 8', 'show x from -6.3 to 6.3 and y from -4.2 to 4.2', 'xlabel angle', 'ylabel speed'];
const PF_FIELD = 'draw the vector field $F(x, y) = (y, -\\sin x - 0.25y)$, coloured by length, with moving particles';
const PF_REST = 'mark the rest points of F, labelled';
const pfPush = (v: number) => `slider v from 0 to 4, starting at ${v}, in steps of 0.05`;
const PF_P = 'P: mark (-6, v), large';
const PF_SWING = 'draw the solution of $\\dot{p} = (y, -\\sin x - 0.25y)$ through P for t from 0 to 40 in red, very thick';

const PENDULUM_FIELD: Guide = {
    id: 'pendulum-field',
    title: 'A pendulum as a vector field',
    summary: 'The angle and the speed of a pendulum as a field with flowing particles: push it with a slider until it swings over the top.',
    category: 'Showcase',
    level: 'core',
    minutes: 2,
    outcomes: ['Draw a field with moving particles', 'Mark and name its rest points', 'Draw the solution from a point on a slider'],
    next: ['vector-fields', 'systems'],
    chart: chart(...PF_WINDOW, pfPush(3), PF_FIELD, PF_REST, PF_P, PF_SWING),
    steps: [
        {
            title: 'Draw the field of the pendulum',
            body: 'x is the angle and y the speed. `$F(x, y) = (y, -\\sin x - 0.25y)$` has a little friction; the particles flow the way the pendulum moves.',
            chart: chart(...PF_WINDOW, PF_FIELD),
        },
        {
            title: 'Mark the rest points',
            body: 'Hanging down is stable: spirals at 0 and ±2π. Standing upright, at ±π, is a saddle.',
            chart: chart(...PF_WINDOW, PF_FIELD, PF_REST),
        },
        {
            title: 'Push the pendulum',
            body: 'P starts near the left rest point with the speed `v`. The red path is its swing: a small push dies down in the same well.',
            chart: chart(...PF_WINDOW, pfPush(1.5), PF_FIELD, PF_REST, PF_P, PF_SWING),
        },
        {
            title: 'Push it over the top',
            body: 'Drag `v` past 2.5: the pendulum swings over the top once and comes to rest in the next well. At 4 it goes over twice.',
            chart: chart(...PF_WINDOW, pfPush(3), PF_FIELD, PF_REST, PF_P, PF_SWING),
        },
    ],
};

// ------------------------------------------------------------------ colour the plane by a complex function
const DC_WINDOW = ['size 12 x 8', 'show x from -3 to 3 and y from -2 to 2', 'equal scale'];
const DC_SLIDER = 'slider a from -2 to 2, starting at 1, in steps of 0.05';
const DC_MOVING = 'colour the plane by $f(z) = \\frac{z^2 - a}{z^2 + 1}$';
const DC_ZEROS = 'mark the points $\\{\\sqrt{a + 0i}, -\\sqrt{a + 0i}\\}$, labelled';

const DOMAIN_COLOURING: Guide = {
    id: 'domain-colouring',
    title: 'Colour the plane by a complex function',
    summary: 'Each point z takes the colour of f(z): find the zeros and the poles, then move two zeros with a slider.',
    category: 'Showcase',
    level: 'advanced',
    minutes: 2,
    outcomes: ['Colour the plane by f(z)', 'Find zeros and poles by their colours', 'Move zeros with a slider'],
    next: ['complex-maps'],
    chart: chart(...DC_WINDOW, DC_SLIDER, DC_MOVING, DC_ZEROS),
    steps: [
        {
            title: 'Colour the plane by z',
            body: 'With f(z) = z the colour is the angle of z: red where z is a positive number, and once round the colour wheel round 0. The light grows with |z|.',
            chart: chart(...DC_WINDOW, 'colour the plane by $f(z) = z$'),
        },
        {
            title: 'Find the zeros and the poles',
            body: '`\\frac{z^2 - 1}{z^2 + 1}` is 0 at ±1 and has poles at ±i. The colours go round each of them; zeros are dark, poles white.',
            chart: chart(...DC_WINDOW, 'colour the plane by $f(z) = \\frac{z^2 - 1}{z^2 + 1}$'),
        },
        {
            title: 'Move the zeros with a slider',
            body: 'With `a` in place of 1 the zeros are ±√a. Drag `a` below 0: they move onto the imaginary axis, and at -1 they meet the poles.',
            chart: chart(...DC_WINDOW, DC_SLIDER, DC_MOVING, DC_ZEROS),
        },
    ],
};

// ------------------------------------------------------------------ circles that draw a square wave
const FC_WINDOW = ['size 12 x 8', 'show x from -2 to 8 and y from -2 to 2', 'equal scale'];
const FC_TITLE = 'title n = {n}';
const fcCount = (n: number) => `slider n from 1 to 20, starting at ${n}, in steps of 1`;
const FC_CIRCLES = 'draw the circles of $\\sum_{k=1}^{n} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave';

const FOURIER_CIRCLES: Guide = {
    id: 'fourier-circles',
    title: 'Circles that draw a square wave',
    summary: 'Circles turn on each other: the tip of the last draws a wave, and more circles make it more square.',
    category: 'Showcase',
    level: 'core',
    minutes: 2,
    outcomes: ['Draw the turning circles of a sum', 'Draw the wave of the tip', 'Add terms with a slider'],
    next: ['sums-series'],
    chart: chart(...FC_WINDOW, FC_TITLE, fcCount(3), FC_CIRCLES),
    steps: [
        {
            title: 'Turn one circle',
            body: 'With `n = 1` one circle turns, and the height of its tip draws a sine wave on the right.',
            chart: chart(...FC_WINDOW, FC_TITLE, fcCount(1), FC_CIRCLES),
        },
        {
            title: 'Add circles',
            body: 'Each new circle turns on the tip of the one before, faster and smaller. With three of them the wave gets corners.',
            chart: chart(...FC_WINDOW, FC_TITLE, fcCount(3), FC_CIRCLES),
        },
        {
            title: 'Use twenty circles',
            body: 'Drag `n` to 20: the wave is nearly square, with small spikes at its corners.',
            chart: chart(...FC_WINDOW, FC_TITLE, fcCount(20), FC_CIRCLES),
        },
    ],
};

export const SHOWCASE_GUIDES: Guide[] = [
    // 6.0 F2: the pictures of version 6 first
    MANDELBROT_ORBIT, MATRIX_GRID, LORENZ_BUTTERFLY, PENDULUM_FIELD, DOMAIN_COLOURING, FOURIER_CIRCLES,
    TANGENT_TRIANGLE, LARGEST_RECTANGLE, MEAN_VALUE, TAYLOR_SINE, GRADIENT_LEVELS, CROSSING_LINES, SLIDING_LADDER, THROW,
];
