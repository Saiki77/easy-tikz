/*
 * Guides of the category Chart language (5.1): a chart written in words,
 * line by line. Each step adds a line or two; the Help shows the chart in
 * words with the new lines lit, so the reader learns the language by
 * building.
 */
import type { Guide } from './types';
import { chart } from './chart';

/** The lines of the tour, in the order the steps add them. */
const WINDOW = ['size 12 x 8', 'show x from 0 to 5 and y from 0 to 4.5', 'axes on the edges', 'with a grid'];
const REGION = 'shade where $x + y \\le 4$ and $x + 3y \\le 6$ and $x \\ge 0$ and $y \\ge 0$';
const SLIDER = 'slider c from 0 to 15, starting at 6';
const LINE = 'draw $2x + 3y = c$ in red, dashed, labelled "$z = {c}$"';
const BEST = 'mark the maximum of $2x + 3y$ in the region, large';

const TOUR: Guide = {
    id: 'chart-language',
    title: 'Write a chart in words',
    summary: 'Build a linear program line by line: the window, a region, a slider, a moving line and the best point.',
    category: 'Chart language',
    level: 'start',
    minutes: 3,
    outcomes: ['Write a chart as lines of words', 'Put formulas in `$...$`, as in your notes', 'Use a slider in a formula and in a label'],
    next: ['formulas', 'linear-program'],
    chart: chart(...WINDOW, SLIDER, `${REGION}, numbered`, LINE, BEST),
    steps: [
        {
            title: 'Say what to show',
            body: 'A chart starts with its window: the x and y it shows, the axes and a grid. Each line says one thing.',
            chart: chart(...WINDOW),
        },
        {
            title: 'Shade a region',
            body: 'Write the conditions in LaTeX between dollars, as in your notes. The chart shades where all of them hold.',
            chart: chart(...WINDOW, REGION),
        },
        {
            title: 'Number the conditions',
            body: 'Words after a comma change how a line draws: `numbered` numbers the conditions on the edges they make.',
            chart: chart(...WINDOW, `${REGION}, numbered`),
        },
        {
            title: 'Add a slider',
            body: 'A slider is a letter you can drag. Here `c` goes from 0 to 15 and starts at 6.',
            chart: chart(...WINDOW, SLIDER, `${REGION}, numbered`),
        },
        {
            title: 'Draw a line that moves',
            body: 'Use `c` in a formula and the line follows the slider. `{c}` in a label shows its value. Drag `c` now.',
            chart: chart(...WINDOW, SLIDER, `${REGION}, numbered`, LINE),
        },
        {
            title: 'Mark the best point',
            body: 'The chart finds where `2x + 3y` is largest in the region and marks it. Drag `c` until the line touches it.',
            chart: chart(...WINDOW, SLIDER, `${REGION}, numbered`, LINE, BEST),
            tip: 'Open in the editor shows the same chart in the Build tab, where every line is a card.',
        },
    ],
};

/** A wave that dies out, written in LaTeX; its envelope in the plain form; then a domain for all three. */
const WAVE_VIEW = ['size 12 x 8', 'show x from -1 to 9 and y from -3.5 to 3.5', 'axes in the middle'];
const DAMPING = ['slider a from 1 to 3, starting at 3', 'slider b from 0.1 to 1, starting at 0.25'];
const DAMPED = 'plot $f(x) = ae^{-bx}\\sin(2x)$';
const UPPER = 'plot g(x) = a*exp(-b*x)';
const LOWER = 'plot h(x) = -a*exp(-b*x)';
const DOMAIN = 'from x = 0 to 8';
const WAVE_DONE = chart(
    ...WAVE_VIEW,
    ...DAMPING,
    `${DAMPED} ${DOMAIN} in blue, very thick, filled`,
    `${UPPER} ${DOMAIN} in red, thick, dashed`,
    `${LOWER} ${DOMAIN} in red, thick, dashed`
);

const FORMULAS: Guide = {
    id: 'formulas',
    title: 'Write formulas as in your notes',
    summary: 'Write LaTeX in dollars, where `ax` is a times x, or plain formulas, and limit a curve with a domain.',
    category: 'Chart language',
    level: 'start',
    minutes: 3,
    outcomes: ['Write formulas in LaTeX between dollars', 'Know when letters multiply and when `ax` is one name', 'Limit a function to a domain'],
    requires: ['chart-language'],
    chart: WAVE_DONE,
    steps: [
        {
            title: 'Write LaTeX between dollars',
            body: 'Write a formula in LaTeX between dollars, as in your notes: `\\frac`, `\\sqrt`, `\\sin` and powers such as `e^{-x}` all work. This wave dies out as x grows.',
            chart: chart(...WAVE_VIEW, 'plot $f(x) = 3e^{-\\frac{x}{4}}\\sin(2x)$ in blue, very thick'),
        },
        {
            title: 'Let letters multiply',
            body: 'Inside dollars, letters side by side multiply: `ae^{-bx}` reads as `a e^{-b x}`. Give each new letter a slider line.',
            chart: chart(...WAVE_VIEW, ...DAMPING, `${DAMPED} in blue, very thick`),
            tip: 'Drag `b`: the larger it is, the faster the wave dies out.',
        },
        {
            title: 'Write plain formulas without dollars',
            body: 'Without dollars a formula is plain, like the envelope `a*exp(-b*x)`. There functions need brackets, `sin(x)`, and `ax` is one name: write `a*x` or `a x`.',
            chart: chart(...WAVE_VIEW, ...DAMPING, `${DAMPED} in blue, very thick`, `${UPPER} in red, thick, dashed`, `${LOWER} in red, thick, dashed`),
            tip: 'If you type `ax` by mistake, the message under the field offers Use a*x.',
        },
        {
            title: 'Limit a function with a domain',
            body: '`from x = 0 to 8` draws a function only there, and `filled` shades the wave down to the x-axis. It now starts at 0, like a plucked string.',
            chart: WAVE_DONE,
            tip: 'Outside its domain a function has no value, so formulas that call it draw nothing there.',
        },
    ],
    next: ['sliders', 'notes-formulas', 'regions'],
};

export const LANGUAGE_GUIDES: Guide[] = [TOUR, FORMULAS];
