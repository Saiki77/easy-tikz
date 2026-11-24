/*
 * 6.0 P: the guides of Python in a chart: the Help guide "Python in a
 * chart" (category Chart language) and three Showcase pages: a heart drawn
 * by turning circles from a script's FFT, a matplotlib-style plot with a
 * slider, and a wave that moves with frame(t).
 */
import type { Guide } from './types';
import { chart } from './chart';

const py = (...lines: string[]) => ['python:', ...lines.map((l) => (l ? `    ${l}` : ''))];

// ------------------------------------------------------------------ Python in a chart

const PC_VIEW = ['size 12 x 8', 'show x from -4 to 4 and y from -3 to 3', 'axes in the middle', 'with a grid'];
const PC_VALUE = py('import numpy as np', 'k = np.sqrt(2)');
const PC_PLOT = 'plot f(x) = k * sin(x) in blue, thick';
const PC_SLIDER = 'slider a from -2 to 2, starting at 1.2';
const PC_READ = py('import numpy as np', 'k = a ** 2 + 0.5');
const PC_DRAW = py(
    'import numpy as np',
    'import matplotlib.pyplot as plt',
    'x = np.linspace(-np.pi, np.pi, 200)',
    'plt.plot(x, np.sin(x) * a, color="C0", label="a sin(x)")',
    'plt.fill_between(x, 0, np.sin(x) * a, alpha=0.2)',
    'plt.scatter([-np.pi / 2, np.pi / 2], [-a, a], c="C3")',
    'plt.legend()'
);
const PC_FUNC = py('import numpy as np', 'def g(x):', '    return a * np.sin(3 * x) * np.exp(-x**2 / 4)');
const PC_FUNC_PLOT = 'plot h(x) = g(x) in purple, thick';
const PC_FRAME = py(
    'import numpy as np',
    'import matplotlib.pyplot as plt',
    'x = np.linspace(-4, 4, 200)',
    'def frame(t):',
    '    plt.plot(x, a * np.sin(2 * x - 2 * t), color="C0")',
    '    plt.scatter([np.cos(t) * 3], [a * np.sin(t)], s=80, c="C3")'
);

const PYTHON_CHART: Guide = {
    id: 'python-chart',
    title: 'Python in a chart',
    summary: 'Write NumPy and matplotlib in a python block: its names are values of the chart, sliders are its variables, frame(t) moves.',
    category: 'Chart language',
    level: 'core',
    minutes: 5,
    outcomes: ['Use a name a script sets', 'Read a slider in a script', 'Draw with matplotlib calls', 'Make a script move with frame(t)'],
    requires: ['formulas'],
    next: ['python-heart', 'python-plot', 'python-wave'],
    chart: chart(...PC_VIEW, PC_SLIDER, ...PC_DRAW),
    steps: [
        {
            title: 'Write a python block',
            body: '`python:` starts a script, and its lines are indented below it. A name it sets is a value of the chart: `plot f(x) = k * sin(x)` uses the script\'s `k`.',
            chart: chart(...PC_VIEW, ...PC_VALUE, PC_PLOT),
        },
        {
            title: 'Read a slider in the script',
            body: 'A slider of the chart is a variable of the script. Drag `a`: the script runs again with the new `a`, and the curve follows.',
            chart: chart(...PC_VIEW, PC_SLIDER, ...PC_READ, PC_PLOT),
        },
        {
            title: 'Draw with matplotlib',
            body: '`plt.plot`, `plt.scatter`, `plt.fill_between` and `plt.legend` draw in the chart, in its theme colours. `C0` to `C9` and names such as `red` are colours of the plugin.',
            chart: chart(...PC_VIEW, PC_SLIDER, ...PC_DRAW),
        },
        {
            title: 'Give the chart a function',
            body: 'A function of numbers the script defines is a function of the chart: `plot h(x) = g(x)` draws the script\'s `g`.',
            chart: chart(...PC_VIEW, PC_SLIDER, ...PC_FUNC, PC_FUNC_PLOT),
        },
        {
            title: 'Make it move with frame(t)',
            body: 'A script with `def frame(t):` moves: the chart calls it on its clock, with `t` in seconds. Print and the export draw `frame(0)`.',
            chart: chart(...PC_VIEW, PC_SLIDER, ...PC_FRAME),
            tip: 'Scripts run inside the plugin, on phones too: numpy, math, cmath, random and matplotlib.pyplot. They read no files and reach no network.',
        },
    ],
};

// ------------------------------------------------------------------ a heart drawn by circles

const HT_VIEW = ['size 12 x 9', 'show x from -20 to 20 and y from -15 to 15', 'equal scale'];
const htCount = (n: number) => `slider n from 1 to 120, starting at ${n}, in steps of 1`;
const HT_SAMPLE = py(
    'import numpy as np',
    't = np.linspace(0, 2*np.pi, 256, endpoint=False)',
    'heart = 16*np.sin(t)**3 + 1j*(13*np.cos(t) - 5*np.cos(2*t) - 2*np.cos(3*t) - np.cos(4*t))'
);
const HT_FFT = py(
    'import numpy as np',
    't = np.linspace(0, 2*np.pi, 256, endpoint=False)',
    'heart = 16*np.sin(t)**3 + 1j*(13*np.cos(t) - 5*np.cos(2*t) - 2*np.cos(3*t) - np.cos(4*t))',
    'c = np.fft.fft(heart) / len(heart)'
);
const HT_POINTS = 'mark the points of heart in red, small';
const HT_CIRCLES = 'draw the circles of c, using n circles';
const HT_PATH = 'draw the circles of c, using n circles, with its path';

const PYTHON_HEART: Guide = {
    id: 'python-heart',
    title: 'A heart drawn by turning circles',
    summary: 'A Python script takes the FFT of a heart; each coefficient is a circle turning on the one before, and their tip draws the heart.',
    category: 'Showcase',
    level: 'core',
    minutes: 3,
    outcomes: ['Sample a curve in Python', 'Draw the circles of a list of coefficients', 'Add circles with a slider'],
    requires: ['python-chart'],
    next: ['fourier-circles'],
    chart: chart(...HT_VIEW, htCount(40), ...HT_FFT, HT_PATH),
    steps: [
        {
            title: 'Sample the heart in Python',
            body: 'The script samples the heart at 256 points as complex numbers, x + iy. `mark the points of heart` draws them: a name the script sets is a value of the chart.',
            chart: chart(...HT_VIEW, ...HT_SAMPLE, HT_POINTS),
        },
        {
            title: 'Take its Fourier transform',
            body: '`np.fft.fft(heart) / len(heart)` gives 256 coefficients. `draw the circles of c` turns each one as a circle, with the frequencies 0, 1, -1, 2, -2 and on, in that order.',
            chart: chart(...HT_VIEW, htCount(3), ...HT_FFT, HT_CIRCLES),
        },
        {
            title: 'Draw the path of the tip',
            body: '`with its path` draws where the tip goes. With 12 circles it is a rounded heart already.',
            chart: chart(...HT_VIEW, htCount(12), ...HT_FFT, HT_PATH),
        },
        {
            title: 'Use 120 circles',
            body: 'Drag `n` up: every circle adds a finer turn, and the path takes the sharp point at the bottom of the heart.',
            chart: chart(...HT_VIEW, htCount(120), ...HT_FFT, HT_PATH),
            tip: 'Any closed drawing works the same way: put its points into `heart` as complex numbers.',
        },
    ],
};

// ------------------------------------------------------------------ a matplotlib plot

const MP_VIEW = ['size 12 x 8', 'show x from -3.5 to 3.5 and y from -1.6 to 1.6', 'with a grid'];
const MP_SLIDER = 'slider a from -3.14 to 3.14, starting at 0.6';
const MP_ONE = py('import numpy as np', 'import matplotlib.pyplot as plt', 'x = np.linspace(-np.pi, np.pi, 200)', 'plt.plot(x, np.sin(x + a))');
const MP_LOOP = py(
    'import numpy as np',
    'import matplotlib.pyplot as plt',
    'x = np.linspace(-np.pi, np.pi, 200)',
    'for k in range(1, 4):',
    '    plt.plot(x, np.sin(k * x + a) / k, label=f"$\\\\sin({k}x + a) / {k}$")',
    'plt.legend()'
);
const MP_ALL = py(
    'import numpy as np',
    'import matplotlib.pyplot as plt',
    'x = np.linspace(-np.pi, np.pi, 200)',
    'total = 0 * x',
    'for k in range(1, 4):',
    '    y = np.sin(k * x + a) / k',
    '    total = total + y',
    '    plt.plot(x, y, linewidth=1, label=f"$\\\\sin({k}x + a) / {k}$")',
    'plt.plot(x, total, color="k", linewidth=2.5, label="sum")',
    'plt.fill_between(x, 0, total, where=total > 0, alpha=0.15, color="C0")',
    'plt.title("Three sines and their sum")',
    'plt.legend()'
);

const PYTHON_PLOT: Guide = {
    id: 'python-plot',
    title: 'A matplotlib plot with a slider',
    summary: 'Lines, a legend and a fill written as in matplotlib, drawn in the chart; the phase a is a slider the script reads.',
    category: 'Showcase',
    level: 'core',
    minutes: 3,
    outcomes: ['Plot a NumPy array', 'Draw curves in a loop with a legend', 'Fill where a condition holds'],
    requires: ['python-chart'],
    next: ['python-wave'],
    chart: chart(...MP_VIEW, MP_SLIDER, ...MP_ALL),
    steps: [
        {
            title: 'Plot one curve',
            body: '`plt.plot(x, np.sin(x + a))` draws the array as a line in the first colour of the cycle, `C0`. Drag `a` to move it.',
            chart: chart(...MP_VIEW, MP_SLIDER, ...MP_ONE),
        },
        {
            title: 'Plot in a loop',
            body: 'Each `plt.plot` takes the next colour. The labels are LaTeX in `$...$`, and `plt.legend()` lists them.',
            chart: chart(...MP_VIEW, MP_SLIDER, ...MP_LOOP),
        },
        {
            title: 'Add the sum and a fill',
            body: 'The script adds the curves up; `fill_between` with `where=total > 0` fills only where the sum is above 0. `plt.title` writes the title.',
            chart: chart(...MP_VIEW, MP_SLIDER, ...MP_ALL),
        },
    ],
};

// ------------------------------------------------------------------ a moving wave

const WV_VIEW = ['size 12 x 8', 'show x from 0 to 12.6 and y from -2.5 to 2.5', 'axes in the middle'];
const WV_STILL = py('import numpy as np', 'import matplotlib.pyplot as plt', 'x = np.linspace(0, 4 * np.pi, 300)', 'plt.plot(x, np.sin(x))');
const WV_ONE = py('import numpy as np', 'import matplotlib.pyplot as plt', 'x = np.linspace(0, 4 * np.pi, 300)', 'def frame(t):', '    plt.plot(x, np.sin(x - 2 * t))');
const WV_TWO = py(
    'import numpy as np',
    'import matplotlib.pyplot as plt',
    'x = np.linspace(0, 4 * np.pi, 300)',
    'def frame(t):',
    '    a = np.sin(x - 2 * t)',
    '    b = np.sin(1.2 * x + t)',
    '    plt.plot(x, a, color="C0", linewidth=1)',
    '    plt.plot(x, b, color="C3", linewidth=1)',
    '    plt.plot(x, a + b, color="C4", linewidth=2.5)'
);

const PYTHON_WAVE: Guide = {
    id: 'python-wave',
    title: 'Two waves that move in Python',
    summary: 'A script with frame(t) draws on the chart\'s clock: two waves run against each other, and their sum beats.',
    category: 'Showcase',
    level: 'core',
    minutes: 2,
    outcomes: ['Draw a still picture with plt.plot', 'Make it move with frame(t)', 'Add waves into a beat'],
    requires: ['python-chart'],
    next: ['python-heart'],
    chart: chart(...WV_VIEW, ...WV_TWO),
    steps: [
        {
            title: 'Draw a still wave',
            body: 'At the top of the script, `plt.plot` draws once: a still sine.',
            chart: chart(...WV_VIEW, ...WV_STILL),
        },
        {
            title: 'Make it move',
            body: 'Inside `def frame(t):` the calls run on the clock, `t` in seconds. `np.sin(x - 2 * t)` moves to the right; the pause button in the strip stops it.',
            chart: chart(...WV_VIEW, ...WV_ONE),
        },
        {
            title: 'Add a second wave',
            body: 'A wave running the other way, a little shorter, and their sum in purple: where they meet in step the sum is twice as high, where they meet out of step it is flat.',
            chart: chart(...WV_VIEW, ...WV_TWO),
        },
    ],
};

/** The Help guide in Chart language and the three Showcase pages. */
export const PYTHON_GUIDES: Guide[] = [PYTHON_CHART, PYTHON_HEART, PYTHON_PLOT, PYTHON_WAVE];
