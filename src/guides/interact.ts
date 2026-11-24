/*
 * Guides of 6.0 about notes and interaction (categories Getting started,
 * Regions and optimisation, Notes and export): Ask the curve, sets on an
 * axis and chords, the cards of sets, matrices and sums in a note, and
 * steps you can play. Each step's chart is the answer or the card the
 * step talks about.
 */
import type { Guide } from './types';
import { chart } from './chart';

// --------------------------------------------------------------- ask-curve

/** g and h cross at (-3, 5) and (2, 0); g <= 0 on [-2, 2]. */
const AC_VIEW = ['size 12 x 8', 'show x from -4 to 4 and y from -5 to 7', 'axes in the middle', 'with a grid'];
const AC_G = 'plot $g(x) = x^2 - 4$ in blue, thick';
const AC_H = 'plot $h(x) = 2 - x$ in red, thick';
const AC_SET = 'mark where $g(x) \\le 0$ on the x-axis, labelled';
const AC_CROSS = 'mark where g and h cross, with coordinates';
const AC_AREA = 'shade between g and h from x = -3 to 2';

const ASK_CURVE: Guide = {
    id: 'ask-curve',
    title: 'Ask the curve',
    summary: 'Click a curve in the preview and choose a question: its answer, a set, a crossing or an area, joins the chart.',
    category: 'Getting started',
    level: 'start',
    minutes: 2,
    outcomes: ['Open the questions of a curve', 'Add an answer to the chart', 'Take an answer away again'],
    requires: ['first-chart'],
    next: ['sets-convexity', 'drag-to-edit'],
    chart: chart(...AC_VIEW, `${AC_G}, with its tangent at 1.5`, AC_H, AC_SET, AC_CROSS, AC_AREA),
    steps: [
        {
            title: 'Click a curve',
            body: 'Plot two functions. In the preview of the editor, click the curve g: a menu of questions about g opens. Point at a question to see its answer faintly.',
            chart: chart(...AC_VIEW, AC_G, AC_H),
            tip: 'Press `?` on the preview to ask from the keyboard. A chart under a block in a note asks too.',
        },
        {
            title: 'Ask where g ≤ 0',
            body: 'Choose "Where is g ≤ 0?". The answer is a new line: the set on the x-axis, with its interval.',
            chart: chart(...AC_VIEW, AC_G, AC_H, AC_SET),
        },
        {
            title: 'Ask where g and h cross',
            body: 'The questions under "With h" are about both curves. "Where do g and h cross?" marks the crossings with their coordinates.',
            chart: chart(...AC_VIEW, AC_G, AC_H, AC_SET, AC_CROSS),
        },
        {
            title: 'Ask for the area between them',
            body: '"The area between g and h" shades the area between the two crossings around the point you clicked.',
            chart: chart(...AC_VIEW, AC_G, AC_H, AC_SET, AC_CROSS, AC_AREA),
        },
        {
            title: 'Ask for the tangent here',
            body: '"The tangent here" puts the tangent where you clicked, at x = 1.5. An answered question has a tick: choose it again to take its line away.',
            chart: chart(...AC_VIEW, `${AC_G}, with its tangent at 1.5`, AC_H, AC_SET, AC_CROSS, AC_AREA),
        },
    ],
};

// ---------------------------------------------------------- sets-convexity

const SC_VIEW = ['size 12 x 8', 'show x from -4 to 4 and y from -5 to 7', 'axes in the middle'];
const SC_G = 'plot $g(x) = x^2 - 4$ in blue, thick';
const SC_SET = 'mark where $g(x) \\le 0$ on the x-axis, labelled';
const scLambda = (value: number) => `slider lambda from 0 to 1, starting at ${value}`;

const SETS_CONVEXITY: Guide = {
    id: 'sets-convexity',
    title: 'Sets and convex functions',
    summary: 'Mark where g(x) ≤ 0 on the x-axis, read the set as intervals and test convexity with a chord.',
    category: 'Regions and optimisation',
    level: 'core',
    minutes: 3,
    outcomes: ['Mark where a condition holds on an axis', 'Read open and closed ends', "See Jensen's inequality on a chord"],
    next: ['formula-cards', 'regions'],
    chart: chart(...SC_VIEW, scLambda(0.3), SC_G, SC_SET, 'draw the chord of g from -1.5 to 3 at $\\lambda$, labelled'),
    steps: [
        {
            title: 'Mark a set on the x-axis',
            body: '`mark where $g(x) \\le 0$ on the x-axis, labelled` draws a bar where g is at most 0 and writes the set as an interval: [-2, 2]. Filled dots: both ends belong to it.',
            chart: chart(...SC_VIEW, SC_G, SC_SET),
        },
        {
            title: 'Use a strict sign',
            body: 'With `>` the ends do not belong, so the dots are open. The set runs off both sides: the bar ends in arrows and the label is a union.',
            chart: chart(...SC_VIEW, SC_G, 'mark where $g(x) > 0$ on the x-axis in orange, labelled'),
            tip: 'Conditions take `and`, `or` and bars: `$|x - 1| < 2$`.',
        },
        {
            title: 'Draw a chord with a slider',
            body: '`draw the chord of g from -1.5 to 3 at $\\lambda$` joins two points of the graph. For every λ the point on the chord lies above the graph: g is convex.',
            chart: chart(...SC_VIEW, scLambda(0.3), SC_G, SC_SET, 'draw the chord of g from -1.5 to 3 at $\\lambda$, labelled'),
        },
        {
            title: 'Test a curve that is not convex',
            body: 'For this cubic the chord runs below the graph at λ = 0.7. The title prints the gap, `CH1_val`, and it is below 0: the cubic is not convex.',
            chart: chart(...SC_VIEW, 'title gap {CH1_val:2}', scLambda(0.7), 'plot $g(x) = \\frac{x^3}{3} - 2x$ in blue, thick', 'draw the chord of g from -2.5 to 2 at $\\lambda$, labelled'),
        },
    ],
};

// ----------------------------------------------------------- formula-cards

/** The charts the cards draw for a note that defines g(x) = x^2 - 4 and a matrix A. */
const FORMULA_CARDS: Guide = {
    id: 'formula-cards',
    title: 'Cards of sets, matrices and sums',
    summary: 'Rest the pointer on a set, a matrix, a recurrence or a sum in a note: its card draws it, with the names of the note.',
    category: 'Notes and export',
    level: 'core',
    minutes: 3,
    outcomes: ['Open the card of a set and switch to n = 2', 'See a matrix move the grid', 'See the orbit of a recurrence and the partial sums of a sum'],
    requires: ['notes-formulas'],
    next: ['sets-convexity', 'charts-in-notes'],
    chart: chart('size 12 x 8', 'show x from -3 to 3 and y from -3 to 3', 'equal scale', 'plot $g(x) = x^2 - 4$, hidden', 'shade where $g(\\sqrt{x^2 + y^2}) \\le 0$, outlined'),
    steps: [
        {
            title: 'Rest the pointer on a set',
            body: 'A note says `$g(x) = x^2 - 4$` and later `$\\{x \\mid g(x) \\le 0\\}$`. The card of the set takes g from the note and marks the set on the x-axis.',
            chart: chart('size 12 x 8', 'show x from -4 to 4', 'plot $g(x) = x^2 - 4$ in blue, thick', 'mark where $g(x) \\le 0$ on the x-axis, labelled'),
            tip: 'Without g in the note, the card uses an example and says so.',
        },
        {
            title: 'Switch to n = 2',
            body: 'For `$\\{x \\in \\mathbb{R}^n \\mid g(x) \\le 0\\}$` the card has an n = 1 / n = 2 switch. With n = 2, x is a point of the plane, and the set is a disk.',
            chart: chart('size 12 x 8', 'show x from -3 to 3 and y from -3 to 3', 'equal scale', 'plot $g(x) = x^2 - 4$, hidden', 'shade where $g(\\sqrt{x^2 + y^2}) \\le 0$, outlined'),
        },
        {
            title: 'Move the grid by a matrix',
            body: 'The card of `$\\det A$` takes A from the note and moves the grid from I to A with the slider `s`. The unit square ends with area 3, the determinant.',
            chart: chart(
                'size 12 x 8',
                'show x from -4 to 4 and y from -3 to 3',
                'equal scale',
                'slider s from 0 to 1, starting at 1, in steps of 0.01',
                'let $A = \\begin{pmatrix} 2 & 1 \\\\ 1 & 2 \\end{pmatrix}$',
                'draw the grid',
                'draw the basis vectors',
                'shade the unit square, labelled',
                'transform the plane by $(1 - s) \\cdot \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix} + s A$'
            ),
        },
        {
            title: 'Follow the orbit of a recurrence',
            body: '`$z_{n+1} = z_n^2 + c$` draws the orbit of 0 with c = a + bi on two sliders, over a faint Mandelbrot set.',
            chart: chart(
                'size 12 x 8',
                'show x from -2 to 1 and y from -1.5 to 1.5',
                'equal scale',
                'slider a from -2 to 1, starting at -0.12',
                'slider b from -1.5 to 1.5, starting at 0.75',
                'colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + i y$, 100 steps, opacity 0.35',
                'draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = a + b i$, 40 steps'
            ),
        },
        {
            title: 'Add up a sum',
            body: '`$\\sum_{k=1}^{n} \\frac{1}{k^2}$` draws its partial sums as points for n on a slider. Insert chart writes the chart under the paragraph.',
            chart: chart('size 12 x 8', 'show x from 0 to n + 1', 'slider n from 1 to 30, starting at 5, in steps of 1', 'mark the points $\\{(m, \\sum_{k=1}^{m} \\frac{1}{k^2}) : m = 1, \\dots, n\\}$'),
        },
    ],
};

// ----------------------------------------------------------- steps-frames

const SF_VIEW = ['size 12 x 8', 'show x from -4 to 4 and y from -3 to 3', 'axes in the middle', 'with a grid'];
const SF_SIN = 'plot $f(x) = \\sin x$ in blue, thick';
const SF_COS = 'then plot $g(x) = \\cos x$ in red, thick';
const SF_SUM = 'then plot $h(x) = \\sin x + \\cos x$ in purple, very thick';

const STEPS_FRAMES: Guide = {
    id: 'steps-frames',
    title: 'Steps you can play',
    summary: 'Start a step with then: the chart shows its lines a step at a time, plays in notes and exports every step as frames.',
    category: 'Notes and export',
    level: 'core',
    minutes: 2,
    outcomes: ['Split a chart into steps with then', 'Play the steps in a note', 'Export every step side by side'],
    requires: ['charts-in-notes'],
    next: ['matrix-plane', 'export-latex'],
    chart: chart(...SF_VIEW, SF_SIN, SF_COS, SF_SUM),
    steps: [
        {
            title: 'Start a step with then',
            body: 'The lines before the first `then` are step 1, and `then plot` starts step 2. Press Play: the sine comes first, then the cosine.',
            chart: chart(...SF_VIEW, SF_SIN, SF_COS),
        },
        {
            title: 'Add a third step',
            body: 'Each `then` starts one more step. In a note the strip under the chart has Previous, Play, Next and the step number; the chart starts at its last step.',
            chart: chart(...SF_VIEW, SF_SIN, SF_COS, SF_SUM),
        },
        {
            title: 'Export every step as frames',
            body: 'The PDF and Copy TikZ show the last step. With the line `frames` the export draws every step side by side instead.',
            chart: chart(...SF_VIEW, 'frames', SF_SIN, SF_COS, SF_SUM),
        },
        {
            title: 'Let a step move',
            body: 'A transform moves while its step comes in: here a shear, then a second one. Use Next to go a step at a time.',
            chart: chart(
                'size 12 x 8',
                'show x from -4.5 to 4.5 and y from -3 to 3',
                'equal scale',
                'draw the grid',
                'draw the basis vectors',
                'then transform the plane by [[1, 1], [0, 1]]',
                'then transform the plane by [[1, 0], [0.5, 1]]'
            ),
        },
    ],
};

export const INTERACT_GUIDES: Guide[] = [ASK_CURVE, SETS_CONVEXITY, FORMULA_CARDS, STEPS_FRAMES];
