/*
 * Guides of the category Linear algebra and complex numbers (6.0): vectors
 * as arrows, a matrix that moves the plane in a step, and complex numbers
 * as points, maps and colours. Each step adds or changes a line or two; a
 * step with `then` plays in the Help as it does in a note.
 */
import type { Guide } from './types';
import { chart } from './chart';

// --------------------------------------------------------- vectors-arrows

/** v = (2, 1) and w = (-1, 1.5): their sum (1, 2.5) stays in view. */
const VA_VIEW = ['size 12 x 8', 'show x from -3 to 4 and y from -1.5 to 3.5', 'equal scale', 'axes in the middle', 'with a grid'];
const VA_V = 'let v = (2, 1)';
const VA_W = 'let w = (-1, 1.5)';
const VA_ARROWS = 'draw v and w as arrows, labelled';
const VA_SUM = 'draw v + w tip to tail in red, labelled';
const VA_SCALE = 'slider s from -1.5 to 1.5, starting at 1.4';
const VA_SPAN = 'draw the span of v, labelled';

const VECTORS_ARROWS: Guide = {
    id: 'vectors-arrows',
    title: 'Vectors and arrows',
    summary: 'Name vectors with let, draw them as arrows, add them tip to tail and scale one with a slider.',
    category: 'Linear algebra and complex numbers',
    level: 'start',
    minutes: 2,
    outcomes: ['Draw named vectors as arrows', 'Add two vectors tip to tail', 'Scale a vector and draw its span'],
    requires: ['values-let'],
    next: ['matrix-plane', 'complex-maps'],
    chart: chart(...VA_VIEW, VA_SCALE, VA_V, VA_SPAN, 'draw v as an arrow, labelled', 'draw s v as an arrow in purple, labelled'),
    steps: [
        {
            title: 'Draw two vectors as arrows',
            body: '`let v = (2, 1)` gives a vector a name. `draw v and w as arrows` draws both from the origin, and `labelled` writes their names at the tips.',
            chart: chart(...VA_VIEW, VA_V, VA_W, VA_ARROWS),
        },
        {
            title: 'Add them tip to tail',
            body: '`draw v + w tip to tail` puts the arrow of w on the tip of v, dashed, and draws the sum from the origin to its end.',
            chart: chart(...VA_VIEW, VA_V, VA_W, VA_ARROWS, VA_SUM),
        },
        {
            title: 'Drag a tip to change a vector',
            body: 'In the editor, drag the tip of v. The numbers of its `let` line change as you drag, and the sum follows.',
            chart: chart(...VA_VIEW, 'let v = (2.5, 0.5)', VA_W, VA_ARROWS, VA_SUM),
            tip: 'This works for a vector written as plain numbers. Hold Alt for one more decimal.',
        },
        {
            title: 'Scale a vector with a slider',
            body: '`s v` is v times the slider `s`. Drag `s`: the arrow grows, shrinks and turns round, but stays on the line of `draw the span of v`.',
            chart: chart(...VA_VIEW, VA_SCALE, VA_V, VA_SPAN, 'draw v as an arrow, labelled', 'draw s v as an arrow in purple, labelled'),
        },
    ],
};

// ----------------------------------------------------------- matrix-plane

/** A has the eigenvalues 2.5 and 1 and the determinant 2.5. */
const MP_VIEW = ['size 12 x 8', 'show x from -4.5 to 4.5 and y from -3 to 3', 'equal scale'];
const MP_A = 'let $A = \\begin{pmatrix} 1.5 & 1 \\\\ 0.5 & 2 \\end{pmatrix}$';
const MP_GRID = ['draw the grid', 'draw the basis vectors'];
const MP_SQUARE = 'shade the unit square, labelled';
const MP_MOVE = 'then transform the plane by A';
const MP_EIGEN = 'then draw the eigenvectors of A, labelled';

const MATRIX_PLANE: Guide = {
    id: 'matrix-plane',
    title: 'A matrix moves the plane',
    summary: 'Draw the grid and the basis vectors, then let a matrix move the whole plane in a step you can play.',
    category: 'Linear algebra and complex numbers',
    level: 'core',
    minutes: 3,
    outcomes: ['Draw the grid, the basis vectors and the unit square', 'Move the plane by a matrix in a step', 'Read the determinant and the eigenvectors'],
    requires: ['vectors-arrows'],
    next: ['matrix-grid', 'complex-maps', 'steps-frames'],
    chart: chart(...MP_VIEW, MP_A, ...MP_GRID, MP_SQUARE, MP_MOVE, MP_EIGEN),
    steps: [
        {
            title: 'Draw the grid and the basis vectors',
            body: 'Name the matrix with `let`. `draw the grid` draws lines that a transform can move, and `draw the basis vectors` draws î in green and ĵ in red.',
            chart: chart(...MP_VIEW, MP_A, ...MP_GRID),
        },
        {
            title: 'Shade the unit square',
            body: '`shade the unit square, labelled` fills the square between î and ĵ and prints its area, 1.',
            chart: chart(...MP_VIEW, MP_A, ...MP_GRID, MP_SQUARE),
        },
        {
            title: 'Move the plane in the next step',
            body: '`then transform the plane by A` moves everything above it in step 2. Press Play: î lands on the first column of A, ĵ on the second. The square now reads det A = 2.5, its new area.',
            chart: chart(...MP_VIEW, MP_A, ...MP_GRID, MP_SQUARE, MP_MOVE),
            tip: 'In the editor, drag the tip of ĵ: the second column of A follows.',
        },
        {
            title: 'Draw the eigenvectors',
            body: '`then draw the eigenvectors of A` adds step 3: the lines that A only stretches, by λ₁ = 2.5 along one and by λ₂ = 1 along the other.',
            chart: chart(...MP_VIEW, MP_A, ...MP_GRID, MP_SQUARE, MP_MOVE, MP_EIGEN),
        },
    ],
};

// ------------------------------------------------------------ complex-maps

const CM_ROOTS_VIEW = ['size 12 x 8', 'show x from -1.8 to 1.8 and y from -1.2 to 1.2', 'equal scale'];
const CM_VIEW = ['size 12 x 8', 'show x from -3 to 3 and y from -2 to 2', 'equal scale'];
const CM_GRID = 'draw the grid from -1.5 to 1.5 in steps of 0.25';

const COMPLEX_MAPS: Guide = {
    id: 'complex-maps',
    title: 'Complex numbers and maps',
    summary: 'Mark complex numbers as points, bend a grid with z ↦ z² and colour the plane by a complex function.',
    category: 'Linear algebra and complex numbers',
    level: 'advanced',
    minutes: 3,
    outcomes: ['Mark a list of complex numbers', 'Move the plane by a map of z', 'Read zeros and poles off the colours'],
    requires: ['matrix-plane'],
    next: ['domain-colouring', 'fractals'],
    chart: chart(...CM_VIEW, CM_GRID, 'then transform the plane by $z \\mapsto z^2$'),
    steps: [
        {
            title: 'Mark the roots of unity',
            body: 'A complex number a + bi is the point (a, b). `mark the points` takes a list: here the n-th roots of unity for the slider `n`, joined.',
            chart: chart(
                ...CM_ROOTS_VIEW,
                'slider n from 2 to 12, starting at 6, in steps of 1',
                'draw $x^2 + y^2 = 1$ in gray',
                'mark the points $\\{e^{2\\pi i k / n} : k = 0, \\dots, n - 1\\}$, joined, labelled'
            ),
        },
        {
            title: 'Draw a small grid',
            body: '`draw the grid from -1.5 to 1.5 in steps of 0.25` draws lines that a map can move.',
            chart: chart(...CM_VIEW, CM_GRID),
        },
        {
            title: 'Square every point',
            body: '`then transform the plane by $z \\mapsto z^2$` squares every point of the grid in step 2. Press Play: the straight lines bend into parabolas.',
            chart: chart(...CM_VIEW, CM_GRID, 'then transform the plane by $z \\mapsto z^2$'),
        },
        {
            title: 'Colour the plane by f(z)',
            body: '`colour the plane by` a function of z gives each point the colour of f(z): its hue is the angle, its light the size. Zeros are dark, at ±1; poles are white, at ±i.',
            chart: chart(...CM_VIEW, 'colour the plane by $f(z) = \\frac{z^2 - 1}{z^2 + 1}$'),
        },
    ],
};

export const LINEAR_GUIDES: Guide[] = [VECTORS_ARROWS, MATRIX_PLANE, COMPLEX_MAPS];
