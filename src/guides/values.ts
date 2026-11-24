/*
 * Guides of 6.0 about values (categories Chart language and Calculus):
 * names for vectors, matrices and complex numbers with `let`, and sums
 * with a slider in their bound, from Taylor polynomials to the turning
 * circles of a Fourier series.
 */
import type { Guide } from './types';
import { chart } from './chart';

// --------------------------------------------------------------- values-let

const VL_VIEW = ['size 12 x 8', 'show x from -3 to 4 and y from -1.5 to 3.5', 'equal scale', 'axes in the middle', 'with a grid'];
const VL_V = 'let v = (2, 1)';
const VL_ARROW = 'draw v as an arrow, labelled';
const VL_A = 'let $A = \\begin{pmatrix} 0 & -1 \\\\ 1 & 0 \\end{pmatrix}$';
const VL_AV = 'draw A v as an arrow in green, labelled';
const VL_LABEL = 'write "det A = {det(A)}, |v| = {norm(v):2}" at (2.5, 3)';
const VL_TURN = [
    'slider a from 0 to 6.28, starting at 2.2',
    'let $c = 2e^{ia}$',
    'draw c as an arrow in purple, labelled',
    'write "c = {c}" at (2.5, 3)',
];

const VALUES_LET: Guide = {
    id: 'values-let',
    title: 'Vectors, matrices and complex numbers',
    summary: 'Give a vector, a matrix or a complex number a name with let, and use it in every line and label.',
    category: 'Chart language',
    level: 'core',
    minutes: 3,
    outcomes: ['Name values with let', 'Multiply a matrix and a vector', 'Print values in a label', 'Put a slider inside a value'],
    requires: ['formulas'],
    next: ['vectors-arrows', 'sums-series', 'matrix-plane'],
    chart: chart(...VL_VIEW, VL_V, VL_A, VL_ARROW, VL_AV, VL_LABEL),
    steps: [
        {
            title: 'Name a vector with let',
            body: '`let v = (2, 1)` names a vector, and every line of the chart can use v. `draw v as an arrow, labelled` draws it from the origin.',
            chart: chart(...VL_VIEW, VL_V, VL_ARROW),
        },
        {
            title: 'Name a matrix and multiply',
            body: 'Write a matrix in LaTeX with `pmatrix`, or plain as `[[0, -1], [1, 0]]`. `A v` is the product: this A turns v a quarter turn.',
            chart: chart(...VL_VIEW, VL_V, VL_A, VL_ARROW, VL_AV),
        },
        {
            title: 'Print values in a label',
            body: 'Braces in a label work out any value: `{det(A)}` is the determinant, 1, and `{norm(v):2}` the length of v to two decimals.',
            chart: chart(...VL_VIEW, VL_V, VL_A, VL_ARROW, VL_AV, VL_LABEL),
        },
        {
            title: 'Put a slider inside a value',
            body: '`let $c = 2e^{ia}$` is a complex number of length 2 at the angle `a`. Drag `a`: the arrow of c turns round the origin.',
            chart: chart(...VL_VIEW, ...VL_TURN),
            tip: 'A name can hold a function too: `let $f(x, y) = x^2 + 4y^2$`.',
        },
    ],
};

// -------------------------------------------------------------- sums-series

const SS_VIEW = ['size 12 x 8', 'show x from -7.5 to 7.5 and y from -3 to 3', 'axes in the middle', 'with a grid'];
const ssTaylor = (n: number) => [
    `slider n from 0 to 12, starting at ${n}, in steps of 1`,
    'plot $f(x) = \\sin x$ in gray, thick',
    'plot $T(x) = \\sum_{k=0}^{n} \\frac{(-1)^k x^{2k+1}}{(2k+1)!}$ in red, thick',
];
const SS_N = 'slider n from 1 to 20, starting at 5, in steps of 1';
const SS_CIRCLES = ['size 12 x 8', 'show x from -2 to 8 and y from -2 to 2', 'equal scale', SS_N, 'draw the circles of $\\sum_{k=1}^{n} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave'];

const SUMS_SERIES: Guide = {
    id: 'sums-series',
    title: 'Sums: Taylor and Fourier series',
    summary: 'Write a sum with a slider in its bound: a Taylor polynomial hugs the sine, and turning circles draw a square wave.',
    category: 'Calculus',
    level: 'core',
    minutes: 3,
    outcomes: ['Write a sum with a slider as its bound', 'Compare a Taylor polynomial with its function', 'Draw a Fourier series as turning circles'],
    requires: ['sliders'],
    next: ['fourier-circles', 'taylor-sine'],
    chart: chart(...SS_CIRCLES),
    steps: [
        {
            title: 'Write a sum in a formula',
            body: '`\\sum_{k=0}^{n}` adds one term for each k from 0 to n, and the bound n is a slider. This sum is the Taylor polynomial of the sine.',
            chart: chart(...SS_VIEW, ...ssTaylor(1)),
        },
        {
            title: 'Raise n',
            body: 'Drag `n` up or press play. Each new term holds the red curve to the sine a little further out.',
            chart: chart(...SS_VIEW, ...ssTaylor(6)),
        },
        {
            title: 'Write a Fourier series',
            body: 'Odd sines with falling weights add up to a square wave. With five terms the corners still ring; raise `n` and they get sharper.',
            chart: chart('size 12 x 8', 'show x from -7.5 to 7.5 and y from -2 to 2', 'axes in the middle', 'with a grid', SS_N, 'plot $f(x) = \\frac{4}{\\pi} \\sum_{k=1}^{n} \\frac{\\sin((2k - 1)x)}{2k - 1}$ in blue, thick'),
        },
        {
            title: 'Turn the terms into circles',
            body: '`draw the circles of` a sum in t puts each term on a circle that turns on the tip of the one before. `with its wave` draws the height of the tip: the same square wave.',
            chart: chart(...SS_CIRCLES),
            tip: 'The circles turn in notes and in the Help; the PDF draws them still.',
        },
    ],
};

export const VALUES_GUIDES: Guide[] = [VALUES_LET, SUMS_SERIES];
