/*
 * 6.0 G: the guide "GeoGebra commands" (category Chart language): GeoGebra
 * input lines pasted into a chart, as they are. Points and objects, a list
 * from Sequence, a slider in a curve, an orbit from IterationList and the
 * Mandelbrot set as the points KeepIf keeps.
 */
import type { Guide } from './types';
import { chart } from './chart';

const VIEW = ['size 12 x 8', 'show x from -1 to 7 and y from -1 to 5', 'equal scale'];
const POINTS = ['A = (1, 1)', 'B = (5, 1)', 'C = (2.5, 4)'];
const OBJECTS = ['p = Polygon(A, B, C)', 'c = Circle(A, B, C)', 's = Segment(C, Midpoint(A, B))'];
const LIST = 'L = Sequence((k, k^2 / 8), k, 0, 6)';

const CURVE_VIEW = ['size 12 x 8', 'show x from -3 to 3 and y from -2 to 2', 'equal scale'];
const SLIDER = 'a = Slider(1, 3)';
const CURVE = 'C = Curve(a cos(t), sin(2t), t, 0, 2pi)';

const ORBIT_VIEW = ['size 12 x 8', 'show x from -1.5 to 1.5 and y from -1 to 1', 'equal scale'];
const ORBIT = ['c = -0.6 + 0.4ί', 'IterationList(z^2 + c, z, {0 + 0ί}, 30)'];

const SET_VIEW = ['size 12 x 8', 'show x from -2.2 to 0.8 and y from -1.3 to 1.3', 'equal scale'];
const GRID = 'P = Flatten(Sequence(Sequence(a + b ί, a, -2.2, 0.8, 0.04), b, -1.3, 1.3, 0.04))';
const MANDELBROT = 'M = KeepIf(abs(Element(IterationList(z^2 + c, z, {0 + 0ί}, 20), 21)) <= 2, c, P)';

const GEOGEBRA: Guide = {
    id: 'geogebra-commands',
    title: 'GeoGebra commands',
    summary: 'Paste GeoGebra input lines as they are: points, circles and polygons, lists from Sequence, sliders, orbits and the Mandelbrot set.',
    category: 'Chart language',
    level: 'core',
    minutes: 4,
    outcomes: ['Paste a GeoGebra construction into a chart', 'Make lists with Sequence and KeepIf', 'Iterate a formula with IterationList'],
    requires: ['chart-language'],
    next: ['fractals', 'orbits-cobwebs'],
    chart: chart(...SET_VIEW, `${GRID}, hidden`, MANDELBROT),
    steps: [
        {
            title: 'Paste points',
            body: 'Write a point as GeoGebra does: `A = (1, 1)`. Each line is one object, drawn in GeoGebra\'s look: free points blue, with their names.',
            chart: chart(...VIEW, ...POINTS),
        },
        {
            title: 'Draw objects with commands',
            body: 'Commands make objects from the points: `Polygon`, `Circle` through three points, `Segment` and `Midpoint`. Change `A` and everything follows.',
            chart: chart(...VIEW, ...POINTS, ...OBJECTS),
            tip: 'Options of the chart language go after a comma: `c = Circle(A, B, C), red, dashed`.',
        },
        {
            title: 'Make a list with Sequence',
            body: '`Sequence((k, k^2 / 8), k, 0, 6)` is the list of the points for k = 0 to 6. Lists use braces, `{1, 2, 3}`, and count from 1: `Element(L, 2)` is the second point.',
            chart: chart(...VIEW, ...POINTS, ...OBJECTS, LIST),
        },
        {
            title: 'Add a slider',
            body: '`a = Slider(1, 3)` is a slider from 1 to 3. Use it in any formula, here in `Curve`, which draws x(t) and y(t) for t from 0 to 2π. Drag `a`.',
            chart: chart(...CURVE_VIEW, SLIDER, CURVE),
        },
        {
            title: 'Iterate a formula',
            body: '`IterationList(z^2 + c, z, {0 + 0ί}, 30)` starts at 0 and applies z² + c thirty times: the orbit of 0, as points. `ί` and `i` are both the imaginary unit.',
            chart: chart(...ORBIT_VIEW, ...ORBIT),
        },
        {
            title: 'Keep the points that stay',
            body: '`P` is a grid of complex numbers, `hidden` so that only its use shows. `KeepIf` keeps each c whose 20th step is still within 2 of 0: the points of the Mandelbrot set.',
            chart: chart(...SET_VIEW, `${GRID}, hidden`, MANDELBROT),
            tip: 'For a sharp picture with colours, use `colour the plane by` (the guide Fractals).',
        },
    ],
};

export const GEOGEBRA_GUIDES: Guide[] = [GEOGEBRA];
