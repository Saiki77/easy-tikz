/*
 * Guides of the category Dynamics and fractals (6.0): the plane coloured by
 * a recurrence, cobwebs and bifurcation diagrams, vector fields with their
 * rest points and moving particles, solutions of systems in 2D and 3D; and
 * gradient descent with Newton's method (Regions and optimisation).
 */
import type { Guide } from './types';
import { chart } from './chart';

// ---------------------------------------------------------------- fractals

const FR_VIEW = ['size 12 x 8', 'show x from -2.4 to 1 and y from -1.15 to 1.15', 'equal scale'];
const FR_JULIA_VIEW = ['size 12 x 8', 'show x from -1.8 to 1.8 and y from -1.2 to 1.2', 'equal scale'];
const FR_MANDELBROT = 'colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps';
const FR_NEWTON = '$z_{n+1} = z_n - \\frac{z_n^3 - 1}{3z_n^2}$';

const FRACTALS: Guide = {
    id: 'fractals',
    title: 'Fractals: Mandelbrot, Julia and Newton',
    summary: "Colour every point of the plane by its orbit: the Mandelbrot set, Julia sets on sliders and the basins of Newton's method.",
    category: 'Dynamics and fractals',
    level: 'core',
    minutes: 3,
    outcomes: ['Colour the plane by a recurrence', 'Zoom into the border of the set', 'Put c of a Julia set on sliders', "Colour Newton's method by the root it finds"],
    next: ['mandelbrot-orbit', 'orbits-cobwebs'],
    chart: chart(...FR_VIEW, FR_MANDELBROT),
    steps: [
        {
            title: 'Colour the plane by a recurrence',
            body: 'With `$c = x + iy$` every point c runs the orbit of 0. Orbits that stay small are dark: the Mandelbrot set. The colour of the others says how fast they leave.',
            chart: chart(...FR_VIEW, FR_MANDELBROT),
        },
        {
            title: 'Zoom into its border',
            body: 'Write a smaller window, or zoom with the wheel in the editor. The picture paints again at every size; deep zooms need more steps, here 400.',
            chart: chart('size 12 x 8', 'show x from -0.8 to -0.7 and y from 0.05 to 0.15', 'equal scale', 'colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 400 steps'),
            tip: 'Past what the graphics card can tell apart, the plugin paints on the processor with 64-bit numbers.',
        },
        {
            title: 'Put a Julia set on sliders',
            body: 'Now every point is the start, `$z_0 = x + iy$`, and c is `a + bi` on two sliders. Each c gives another Julia set: drag `a` and `b`.',
            chart: chart(
                ...FR_JULIA_VIEW,
                'slider a from -1 to 1, starting at -0.8',
                'slider b from -1 to 1, starting at 0.156',
                'colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = x + iy$, $c = a + bi$, 200 steps'
            ),
        },
        {
            title: "Colour Newton's method by its root",
            body: "Newton's method for z³ - 1 runs from every point, and each point takes the colour of the root it reaches. The orbit from P shows the way to one of them.",
            chart: chart(
                ...FR_JULIA_VIEW,
                `colour the plane by ${FR_NEWTON}, $z_0 = x + iy$, 40 steps`,
                'mark P at (0.35, 0.5), large',
                `draw the orbit of ${FR_NEWTON}, $z_0 = P$, 30 steps, as a path`
            ),
        },
    ],
};

// ---------------------------------------------------------- orbits-cobwebs

/** The logistic map x -> r x (1 - x): one value at r = 2.8, two at 3.3, chaos at 3.7. */
const OC_VIEW = ['size 12 x 8', 'show x from 0 to 1 and y from 0 to 1', 'equal scale'];
const ocSlider = (r: number) => `slider r from 2.5 to 4, starting at ${r}`;
const OC_MAP = 'plot $f(x) = r x (1 - x)$ in blue, thick';
const OC_COBWEB = 'draw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps';
const OC_DIAGRAM = [
    'size 12 x 8',
    'show x from 2.5 to 4 and y from 0 to 1',
    'xlabel r',
    ocSlider(3.7),
    'draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4',
    'draw $x = r$ in red, dashed',
];

const ORBITS_COBWEBS: Guide = {
    id: 'orbits-cobwebs',
    title: 'Orbits, cobwebs and bifurcation',
    summary: 'Follow x ↦ r x (1 - x) step by step on a cobweb, over time, and for every r at once in the bifurcation diagram.',
    category: 'Dynamics and fractals',
    level: 'advanced',
    minutes: 4,
    outcomes: ['Draw the cobweb of a map', 'Draw an orbit of numbers over n', 'Draw a bifurcation diagram'],
    next: ['fractals', 'descent-newton'],
    chart: chart(...OC_DIAGRAM),
    steps: [
        {
            title: 'Draw the cobweb of a map',
            body: 'Plot the map f, then `draw the cobweb`: from 0.2 up to the graph, across to the line y = x, up again. At r = 2.8 the path settles where f meets y = x.',
            chart: chart(...OC_VIEW, ocSlider(2.8), OC_MAP, OC_COBWEB),
        },
        {
            title: 'Raise r past 3',
            body: 'At r = 3.3 the cobweb closes into a square: the orbit swaps between two values for ever.',
            chart: chart(...OC_VIEW, ocSlider(3.3), OC_MAP, OC_COBWEB),
        },
        {
            title: 'Find chaos at r = 3.7',
            body: 'At r = 3.7 the path never settles: it fills a whole band. Drag `r` slowly up from 3 to see the square split into more and more corners first.',
            chart: chart(...OC_VIEW, ocSlider(3.7), OC_MAP, OC_COBWEB),
        },
        {
            title: 'Draw the orbit over time',
            body: '`draw the orbit` of a recurrence of numbers draws each value over n: the same chaos at r = 3.7, as a jagged line.',
            chart: chart('size 12 x 8', 'show x from 0 to 60 and y from 0 to 1', 'xlabel n', ocSlider(3.7), 'draw the orbit of $x_{n+1} = r x_n (1 - x_n)$, $x_0 = 0.2$, 60 steps'),
        },
        {
            title: 'Draw the bifurcation diagram',
            body: 'For each r on the x-axis the diagram marks where the orbit settles: one value, then 2, 4, 8, then chaos. The dashed line is the r of the slider.',
            chart: chart(...OC_DIAGRAM),
        },
    ],
};

// ----------------------------------------------------------- vector-fields

/** x'' = x - x^3 - 0.3x': a saddle at 0 and stable spirals at (-1, 0) and (1, 0). */
const VF_VIEW = ['size 12 x 8', 'show x from -2.4 to 2.4 and y from -1.6 to 1.6', 'equal scale'];
const VF_FIELD = 'draw the vector field $F(x, y) = (y, x - x^3 - 0.3y)$, coloured by length';
const VF_REST = 'mark the rest points of F, labelled';

const VECTOR_FIELDS: Guide = {
    id: 'vector-fields',
    title: 'Vector fields and rest points',
    summary: 'Draw a vector field, colour it by length, mark its rest points and set particles flowing along it.',
    category: 'Dynamics and fractals',
    level: 'core',
    minutes: 3,
    outcomes: ['Draw and colour a vector field', 'Mark and name its rest points', 'Add moving particles or streamlines'],
    next: ['systems', 'pendulum-field', 'slope-fields'],
    chart: chart(...VF_VIEW, `${VF_FIELD}, with moving particles`, VF_REST),
    steps: [
        {
            title: 'Draw a vector field',
            body: '`draw the vector field $F(x, y) = (y, -x)$` draws an arrow in the direction of F all over the view. The arrows have one length on screen; these turn round the origin.',
            chart: chart('size 12 x 8', 'show x from -3 to 3 and y from -2 to 2', 'equal scale', 'draw the vector field $F(x, y) = (y, -x)$'),
        },
        {
            title: 'Colour the arrows by length',
            body: 'A field with more going on. `coloured by length` shows where it is strong, in yellow, and weak, in purple.',
            chart: chart(...VF_VIEW, VF_FIELD),
        },
        {
            title: 'Mark the rest points',
            body: '`mark the rest points of F, labelled` finds where F is 0 and names each kind. Filled dots are stable, open ones are not: two stable spirals and a saddle.',
            chart: chart(...VF_VIEW, VF_FIELD, VF_REST),
        },
        {
            title: 'Set particles flowing',
            body: '`with moving particles` lets dots flow along F at its speed, with short trails. They move in notes and here, and a Pause button stops them.',
            chart: chart(...VF_VIEW, `${VF_FIELD}, with moving particles`, VF_REST),
        },
        {
            title: 'Draw streamlines for print',
            body: 'Paper shows one still frame of the particles. `with streamlines` draws curves along F that the PDF and the LaTeX export keep.',
            chart: chart(...VF_VIEW, `${VF_FIELD}, with streamlines`, VF_REST),
        },
    ],
};

// ----------------------------------------------------------------- systems

/** Prey x and predators y (Lotka and Volterra): closed paths round (1, 1). */
const SY_VIEW = ['size 12 x 8', 'show x from 0 to 4 and y from 0 to 3', 'equal scale', 'axes on the edges'];
const SY_FIELD = 'draw the vector field $F(x, y) = (x(1 - y), y(x - 1))$ in gray, thin';
const SY_P = 'mark P at (2, 1), large';
const SY_SYSTEM = 'draw the solution of $\\dot{p} = (x(1 - y), y(x - 1))$';
const SY_LORENZ = [
    '3d',
    'show x from -25 to 25, y from -30 to 30 and z from 0 to 50',
    'draw the solution of $\\dot{p} = (10(y - x), x(28 - z) - y, xy - \\frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 40, coloured by time',
];

const SYSTEMS: Guide = {
    id: 'systems',
    title: 'Solutions of systems in 2D and 3D',
    summary: 'Draw the path a system of equations takes from a point: predators and prey in the plane, then the Lorenz system in space.',
    category: 'Dynamics and fractals',
    level: 'advanced',
    minutes: 3,
    outcomes: ['Draw the solution of a 2D system through a point', 'Start several solutions and colour them by time', 'Draw the Lorenz system in 3D'],
    requires: ['vector-fields'],
    next: ['lorenz-butterfly', 'surfaces-3d'],
    chart: chart(...SY_LORENZ),
    steps: [
        {
            title: 'Draw the field of the system',
            body: 'Prey x and predators y: `$\\dot{p} = (x(1 - y), y(x - 1))$`. Its vector field shows where the two numbers go from each point.',
            chart: chart(...SY_VIEW, SY_FIELD),
        },
        {
            title: 'Draw the solution through P',
            body: '`draw the solution of` the system `through P` follows it from P for t from 0 to 8. The prey grow, the predators follow, and the path comes round again.',
            chart: chart(...SY_VIEW, SY_FIELD, SY_P, `${SY_SYSTEM} through P for t from 0 to 8 in red, thick`),
            tip: 'In the editor, drag P: the path follows.',
        },
        {
            title: 'Start two and colour by time',
            body: '`through P and (1.5, 1)` starts a second path. `coloured by time` runs each from dark to light, so you can see which way it goes.',
            chart: chart(...SY_VIEW, SY_FIELD, SY_P, `${SY_SYSTEM} through P and (1.5, 1) for t from 0 to 8, thick, coloured by time`),
        },
        {
            title: 'Go into space: the Lorenz system',
            body: 'In a 3D chart the system has three parts. From (1, 1, 1) the Lorenz system winds round two wings and never repeats. Drag the chart to turn it.',
            chart: chart(...SY_LORENZ),
        },
    ],
};

// ---------------------------------------------------------- descent-newton

/** f = x^2/2 + 4y^2: a step of eta multiplies y by 1 - 8 eta, so past eta = 0.25 the orbit runs away. */
const DN_VIEW = ['size 12 x 8', 'show x from -3 to 3 and y from -2 to 2', 'equal scale'];
const DN_F = 'let $f(x, y) = \\frac{1}{2}x^2 + 4y^2$';
const DN_LEVELS = 'draw the level curves of $f(x, y)$ at 0.25, 0.5, 1, 2, 4 and 8 in gray';
const DN_HEAT = 'colour the plane by $f(x, y)$, in viridis, opacity 0.6';
const dnWalk = (eta: number) => [
    `slider eta from 0.01 to 0.3, starting at ${eta}`,
    'mark P at (-2.6, 1.4), large',
    'draw the orbit of $p_{n+1} = p_n - \\eta \\nabla f(p_n)$, $p_0 = P$, 25 steps, labelled',
];

const DESCENT_NEWTON: Guide = {
    id: 'descent-newton',
    title: "Gradient descent and Newton's method",
    summary: "Walk downhill on level curves with gradient descent, take steps that are too long, and find a root with Newton's method.",
    category: 'Regions and optimisation',
    level: 'advanced',
    minutes: 4,
    outcomes: ['Name a function of x and y with let', 'Draw the orbit of gradient descent', 'Colour the plane by a function', "Draw Newton's method for a root"],
    requires: ['level-curves'],
    next: ['orbits-cobwebs', 'fractals'],
    chart: chart(...DN_VIEW, DN_F, DN_HEAT, DN_LEVELS, ...dnWalk(0.2)),
    steps: [
        {
            title: 'Draw the level curves of f',
            body: '`let` names the function f of x and y. Its level curves show a long valley: steep in y, flat in x.',
            chart: chart(...DN_VIEW, DN_F, DN_LEVELS),
        },
        {
            title: 'Colour the plane by f',
            body: '`colour the plane by $f(x, y)$, in viridis` lays a heat map under the curves: low values purple, high ones yellow.',
            chart: chart(...DN_VIEW, DN_F, DN_HEAT, DN_LEVELS),
        },
        {
            title: 'Walk downhill from P',
            body: 'Each step of the orbit goes against the gradient, `\\nabla f`, times the step size `eta`. From P it zigzags across the valley to the lowest point, 0.',
            chart: chart(...DN_VIEW, DN_F, DN_HEAT, DN_LEVELS, ...dnWalk(0.2)),
        },
        {
            title: 'Make the steps too long',
            body: 'Drag `eta` past 0.25. Each step now jumps further across the valley than the one before, and the orbit runs away.',
            chart: chart(...DN_VIEW, DN_F, DN_HEAT, DN_LEVELS, ...dnWalk(0.27)),
        },
        {
            title: "Find a root with Newton's method",
            body: "`draw Newton's method for g from 2.5` follows the tangent at each point down to the x-axis. After three steps it is at 1.414, the root √2.",
            chart: chart('size 12 x 8', 'show x from -0.5 to 3 and y from -2.5 to 5', 'axes in the middle', 'with a grid', 'plot $g(x) = x^2 - 2$ in blue, thick', "draw Newton's method for g from 2.5, 4 steps, labelled"),
        },
    ],
};

export const DYNAMICS_GUIDES: Guide[] = [FRACTALS, ORBITS_COBWEBS, VECTOR_FIELDS, SYSTEMS, DESCENT_NEWTON];
