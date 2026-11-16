/*
 * Guides of the category Data and probability (5.1): data points and their
 * regression line, normal and binomial distributions with a shaded
 * probability. Each step adds or changes a line or two; the Help shows the
 * chart in words with those lines lit.
 */
import type { Guide } from './types';
import { chart } from './chart';

// --------------------------------------------------------- data-regression

/** Hours of study and test scores, the table of the What's new slide; the last step adds a row. */
const STUDY_VIEW = ['size 12 x 8', 'show x from 0 to 9 and y from 40 to 90', 'axes on the edges', 'with a grid', 'xlabel hours', 'ylabel score'];
const SCORES = 'data (1, 52), (2, 55), (3, 61), (4, 64), (5, 70), (6, 71), (7, 77)';
const MORE_SCORES = 'data (1, 52), (2, 55), (3, 61), (4, 64), (5, 70), (6, 71), (7, 77), (8, 80)';
const DOTS = 'mark the data in magenta, large';
const FIT = 'draw its regression line in blue, very thick';

const REGRESSION: Guide = {
    id: 'data-regression',
    title: 'Data and a regression line',
    summary: 'Plot data points, fit a regression line and print its equation and R² beside it.',
    category: 'Data and probability',
    level: 'core',
    minutes: 3,
    outcomes: ['Write data points in a chart', 'Fit a regression line and label it', 'Read the data from a table in your note'],
    requires: ['chart-language'],
    next: ['probability', 'charts-in-notes'],
    chart: chart(...STUDY_VIEW, MORE_SCORES, DOTS, `${FIT}, labelled`),
    steps: [
        {
            title: 'Write the data points',
            body: '`data` lists the points: hours of study and the test score. `mark the data` draws them.',
            chart: chart(...STUDY_VIEW, SCORES, DOTS),
        },
        {
            title: 'Draw the regression line',
            body: '`its regression line` is the straight line that fits the data best, by least squares.',
            chart: chart(...STUDY_VIEW, SCORES, DOTS, FIT),
        },
        {
            title: 'Print its equation and R²',
            body: '`labelled` adds the equation of the line and R². The closer R² is to 1, the closer the points lie to the line.',
            chart: chart(...STUDY_VIEW, SCORES, DOTS, `${FIT}, labelled`),
        },
        {
            title: 'Read the table in your note',
            body: 'In a note, write `use the table above` instead of the `data` line: the chart reads the Markdown table above it. Add a row, and the line follows.',
            chart: chart(...STUDY_VIEW, MORE_SCORES, DOTS, `${FIT}, labelled`),
            tip: '`use the table above, columns hours and score` picks two columns of a wider table.',
        },
    ],
};

// ------------------------------------------------------------ probability

/** The standard normal: P(-a <= X <= a) is 0.683, 0.954 and 0.997 at a = 1, 2, 3. */
const BELL_VIEW = ['size 12 x 7', 'show x from -4 to 4 and y from 0 to 0.5', 'axes on the edges'];
const NORMAL = 'plot the normal distribution with mean 0 and sd 1 in blue, very thick';
const SPREAD = 'slider a from 0 to 3, starting at 1, in steps of 1';
const AROUND_ZERO = 'shade $P(-a \\le X \\le a)$, opacity 0.8, labelled';
/** Ten tries with p = 0.5: mean 5, standard deviation sqrt(2.5) = 1.58. */
const BARS_VIEW = ['size 12 x 7', 'show x from -0.5 to 10.5 and y from 0 to 0.3', 'axes on the edges'];
const BINOMIAL = 'plot the binomial distribution with n = 10 and p = 0.5 in purple';
const AROUND_FIVE = 'shade $P(5 - a \\le X \\le 5 + a)$, opacity 0.8, labelled';
const OVER = 'plot the normal distribution with mean 5 and sd 1.58 in red, thick';

const PROBABILITY: Guide = {
    id: 'probability',
    title: 'Normal and binomial probabilities',
    summary: 'Shade a probability under the normal curve with a slider, then compare binomial bars with a normal curve.',
    category: 'Data and probability',
    level: 'core',
    minutes: 3,
    outcomes: ['Plot normal and binomial distributions', 'Shade a probability with a slider', 'Print the probability in a label'],
    requires: ['chart-language'],
    next: ['data-regression', 'riemann-sums'],
    chart: chart(...BARS_VIEW, SPREAD, BINOMIAL, AROUND_FIVE, OVER),
    steps: [
        {
            title: 'Plot the normal distribution',
            body: 'Give the mean and the standard deviation after `with`. This bell is the standard normal distribution of X.',
            chart: chart(...BELL_VIEW, NORMAL),
        },
        {
            title: 'Shade a probability',
            body: '`shade` with an event in `P(...)` fills its area, and `labelled` prints the probability. Step `a` through 1, 2 and 3: 0.683, 0.954 and 0.997.',
            chart: chart(...BELL_VIEW, SPREAD, NORMAL, AROUND_ZERO),
        },
        {
            title: 'Switch to a binomial distribution',
            body: 'With `n = 10` and `p = 0.5`, each bar is the chance of k successes in 10 tries. The event now runs from `5 - a` to `5 + a`.',
            chart: chart(...BARS_VIEW, SPREAD, BINOMIAL, AROUND_FIVE),
        },
        {
            title: 'Lay a normal curve over the bars',
            body: 'A normal curve with the same mean and spread, 5 and 1.58, runs almost through the tops of the bars.',
            chart: chart(...BARS_VIEW, SPREAD, BINOMIAL, AROUND_FIVE, OVER),
            tip: 'With two distributions, `shade` uses the nearest one above its line.',
        },
    ],
};

export const DATA_GUIDES: Guide[] = [REGRESSION, PROBABILITY];
