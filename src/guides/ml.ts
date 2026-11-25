/*
 * 6.0 ML: the guides of the Help section "Machine learning" (the home
 * places them there, src/guides/home.ts): optimizers on a loss surface,
 * logistic regression, a neural network that learns, k-means, principal
 * components, overfitting and ridge, activation functions and softmax, a
 * loss landscape in 3D. And two Showcase pages next to the Lorenz page
 * (src/guides/showcase.ts lists them): the optimizer race and a network
 * that learns. Every script is plain NumPy and matplotlib; the charts move
 * with frame(t) where the guide says so.
 */
import type { Guide } from './types';
import { chart } from './chart';

const py = (...lines: string[]) => ['python:', ...lines.map((l) => (l ? `    ${l}` : ''))];

// ------------------------------------------------------------------ the banana valley (optimizers and the race)

const LOSS_WINDOW = ['show x from -2 to 2 and y from -1 to 3', 'size 12 x 9'];
const LOSS = 'let $f(x, y) = (1 - x)^2 + 5(y - x^2)^2$';
const lossHeat = (opacity: number) => `colour the plane by $\\ln(1 + f(x, y))$, in viridis, opacity ${opacity}`;
const LOSS_LEVELS = 'draw the level curves of $f(x, y)$ at 0.25, 1, 4 and 16 in gray';
const LOSS_MIN = 'M: mark (1, 1), large, labelled "minimum"';
const OPT_START = 'P: mark (-1.5, 2.5), large';
const optEta = (eta: number) => `slider eta from 0.002 to 0.06, starting at ${eta}`;
const OPT_GD = 'draw the orbit of $p_{n+1} = p_n - \\eta \\nabla f(p_n)$, $p_0 = P$, 60 steps in black';
/** The gradient of f and the optimizers a script runs from (-1.5, 2.5). */
const SLOPE = ['def slope(p):', '    x, y = p', '    return np.array([-2 * (1 - x) - 20 * x * (y - x**2), 10 * (y - x**2)])'];
const optPaths = (kinds: string[]) =>
    py(
        'import numpy as np',
        'import matplotlib.pyplot as plt',
        ...SLOPE,
        'def descend(kind, steps=150):',
        '    p = np.array([-1.5, 2.5])',
        '    m = np.zeros(2)',
        '    s = np.zeros(2)',
        '    path = [p]',
        '    for k in range(1, steps + 1):',
        '        g = slope(p)',
        '        if kind == "momentum":',
        '            m = 0.9 * m + g',
        '            p = p - 0.005 * m',
        '        else:',
        '            m = 0.9 * m + 0.1 * g',
        '            s = 0.999 * s + 0.001 * g**2',
        '            p = p - 0.1 * (m / (1 - 0.9**k)) / (np.sqrt(s / (1 - 0.999**k)) + 1e-8)',
        '        path.append(p)',
        '    return np.array(path)',
        `for kind, colour in ${kinds.length === 1 ? `[("momentum", "C1")]` : `(("momentum", "C1"), ("Adam", "#ffffff"))`}:`,
        '    path = descend(kind)',
        '    plt.plot(path[:, 0], path[:, 1], color=colour, linewidth=2.5, label=kind)',
        'plt.legend(loc="upper right")'
    );

const OPTIMIZERS: Guide = {
    id: 'ml-optimizers',
    title: 'Optimizers on a loss surface',
    summary: 'Gradient descent, momentum and Adam walk down the same curved valley: one zigzags and crawls, the others glide to the minimum.',
    category: 'Data and probability',
    level: 'advanced',
    minutes: 4,
    outcomes: ['Draw a loss as a heat map with level curves', 'Walk gradient descent with the step size on a slider', 'Compare momentum and Adam in a script'],
    next: ['optimizer-race', 'ml-landscape', 'two-valleys'],
    chart: chart(...LOSS_WINDOW, optEta(0.02), LOSS, lossHeat(0.85), LOSS_LEVELS, LOSS_MIN, OPT_START, OPT_GD, ...optPaths(['momentum', 'Adam'])),
    steps: [
        {
            title: 'Draw the loss surface',
            body: '`let` names a loss f(x, y) with a long curved valley and its minimum at (1, 1). The heat map shows ln(1 + f), so the valley floor stands out; the level curves mark its walls.',
            chart: chart(...LOSS_WINDOW, LOSS, lossHeat(0.85), LOSS_LEVELS, LOSS_MIN),
        },
        {
            title: 'Walk downhill with gradient descent',
            body: 'Each step goes against the gradient `\\nabla f`, times the step size `eta`. With `eta` at 0.02 the path slides down the steep wall, then crawls along the flat floor: after 60 steps it is far from the minimum.',
            chart: chart(...LOSS_WINDOW, optEta(0.02), LOSS, lossHeat(0.85), LOSS_LEVELS, LOSS_MIN, OPT_START, OPT_GD),
            tip: 'Drag `eta` to 0.04: it reaches the minimum in 60 steps. At 0.05 it jumps off the chart.',
        },
        {
            title: 'Add momentum',
            body: 'The python block runs momentum: each step keeps 0.9 of the last one. Across the valley the pushes cancel; along it they add up, so the path speeds along the floor.',
            chart: chart(...LOSS_WINDOW, optEta(0.02), LOSS, lossHeat(0.85), LOSS_LEVELS, LOSS_MIN, OPT_START, OPT_GD, ...optPaths(['momentum'])),
        },
        {
            title: 'Add Adam',
            body: 'Adam divides each coordinate of the step by its own recent size, so steps stay about as long on steep walls as on the flat floor. The white path reaches the minimum first.',
            chart: chart(...LOSS_WINDOW, optEta(0.02), LOSS, lossHeat(0.85), LOSS_LEVELS, LOSS_MIN, OPT_START, OPT_GD, ...optPaths(['momentum', 'Adam'])),
        },
    ],
};

// ------------------------------------------------------------------ logistic regression

const LR_WINDOW = ['show x from -4 to 4 and y from -3 to 3', 'size 12 x 9'];
const lrSteps = (n: number) => `slider n from 0 to 200, starting at ${n}, in steps of 5`;
const LR_DATA = [
    'import numpy as np',
    'import matplotlib.pyplot as plt',
    'np.random.seed(1)',
    'A = np.random.randn(60, 2) * 0.8 + np.array([-1.0, -0.8])',
    'B = np.random.randn(60, 2) * 0.8 + np.array([1.2, 1.0])',
];
const LR_POINTS = ['plt.scatter(A[:, 0], A[:, 1], color="C0", s=30, label="class 0")', 'plt.scatter(B[:, 0], B[:, 1], color="C3", s=30, label="class 1")', 'plt.legend(loc="upper left")'];
const LR_TRAIN = [
    'X = np.concatenate([A, B])',
    'y = np.concatenate([np.zeros(60), np.ones(60)])',
    'w = np.array([0.5, -1.5])',
    'b = 0.0',
    'for i in range(int(n)):',
    '    p = 1 / (1 + np.exp(-(X @ w + b)))',
    '    w = w - 0.5 * X.T @ (p - y) / len(y)',
    '    b = b - 0.5 * np.mean(p - y)',
    'GX, GY = np.meshgrid(np.linspace(-4, 4, 81), np.linspace(-3, 3, 61))',
    'P = 1 / (1 + np.exp(-(w[0] * GX + w[1] * GY + b)))',
];
const LR_PICTURE = 'plt.imshow(P, extent=(-4, 4, -3, 3), origin="lower", cmap="coolwarm", vmin=0, vmax=1, alpha=0.5, interpolation="bilinear")';
const LR_LINE = ['plt.contour(GX, GY, P, levels=[0.5], colors="black", linewidths=2)', 'accuracy = np.mean(((X @ w + b) > 0) == y)', 'plt.title(f"after {int(n)} steps: accuracy {accuracy:.2f}")'];
const lrChart = (n: number, picture: boolean) => chart(...LR_WINDOW, lrSteps(n), ...py(...LR_DATA, ...LR_TRAIN, ...(picture ? [LR_PICTURE] : []), ...LR_LINE, ...LR_POINTS));

const LOGISTIC: Guide = {
    id: 'ml-logistic',
    title: 'Logistic regression',
    summary: 'Train a classifier by gradient descent in a script: the probability as a picture, the line where it is one half, and a slider for the steps.',
    category: 'Data and probability',
    level: 'core',
    minutes: 3,
    outcomes: ['Draw two classes of points from a script', 'Train logistic regression with NumPy', 'Show the probability as a picture'],
    next: ['ml-network', 'ml-overfitting'],
    chart: lrChart(200, true),
    steps: [
        {
            title: 'Draw two classes',
            body: 'The python block makes two seeded clouds of 60 points. `plt.scatter` draws them, `s=30` is the dot\'s area in points squared as in matplotlib.',
            chart: chart(...LR_WINDOW, ...py(...LR_DATA, ...LR_POINTS)),
        },
        {
            title: 'Train by gradient descent',
            body: 'The model is p = σ(w · x + b). Each step moves `w` and `b` against the gradient of the log loss. The black line is where p = 0.5; the title prints the accuracy.',
            chart: lrChart(200, false),
        },
        {
            title: 'Colour the plane by the probability',
            body: '`plt.imshow` draws p over the plane, blue near 0 and red near 1. `interpolation="bilinear"` blends the cells, so the picture is smooth.',
            chart: lrChart(200, true),
        },
        {
            title: 'Watch the line turn',
            body: '`n` is the number of steps. Drag it from 0: the line starts across the clouds and turns into place. The script runs again for each `n`.',
            chart: lrChart(10, true),
        },
    ],
};

// ------------------------------------------------------------------ a network that learns (guide and Showcase)

const NET_WINDOW = ['show x from -2 to 2 and y from -2 to 2', 'size 10 x 10', 'equal scale'];
const XOR_DATA = [
    'import numpy as np',
    'import matplotlib.pyplot as plt',
    'np.random.seed(0)',
    'centres = np.array([[-1, -1], [1, 1], [-1, 1], [1, -1]])',
    'X = np.concatenate([c + 0.35 * np.random.randn(25, 2) for c in centres])',
    'y = np.repeat(np.array([0, 0, 1, 1]), 25)',
];
const RING_DATA = [
    'import numpy as np',
    'import matplotlib.pyplot as plt',
    'np.random.seed(1)',
    'angle = np.random.rand(120) * 2 * np.pi',
    'radius = np.concatenate([0.6 + 0.15 * np.random.randn(60), 1.5 + 0.15 * np.random.randn(60)])',
    'X = np.stack([radius * np.cos(angle), radius * np.sin(angle)], axis=1)',
    'y = np.repeat(np.array([0, 1]), 60)',
];
const NET_POINTS = ['plt.scatter(X[y == 0, 0], X[y == 0, 1], color="C0", s=30)', 'plt.scatter(X[y == 1, 0], X[y == 1, 1], color="C3", s=30)'];
/** A 2-h-1 network with tanh, trained by gradient descent; a picture of p every 10 steps. */
const netTrain = (hidden: number, rate: number) => [
    `W1 = np.random.randn(2, ${hidden}) * ${hidden === 8 ? '0.8' : '1.0'}`,
    `b1 = np.zeros(${hidden})`,
    `W2 = np.random.randn(${hidden}) * 0.8`,
    'b2 = 0.0',
    'GX, GY = np.meshgrid(np.linspace(-2, 2, 50), np.linspace(-2, 2, 50))',
    'G = np.stack([GX.ravel(), GY.ravel()], axis=1)',
    'snaps = []',
    'for step in range(601):',
    '    H = np.tanh(X @ W1 + b1)',
    '    p = 1 / (1 + np.exp(-(H @ W2 + b2)))',
    '    d = (p - y) / len(y)',
    '    dH = np.outer(d, W2) * (1 - H**2)',
    `    W2 = W2 - ${rate} * H.T @ d`,
    `    b2 = b2 - ${rate} * np.sum(d)`,
    `    W1 = W1 - ${rate} * X.T @ dH`,
    `    b1 = b1 - ${rate} * np.sum(dH, axis=0)`,
    '    if step % 10 == 0:',
    '        q = 1 / (1 + np.exp(-(np.tanh(G @ W1 + b1) @ W2 + b2)))',
    '        snaps.append(q.reshape(50, 50))',
];
const NET_SNAP = (k: string, indent: string) => [
    `${indent}plt.imshow(snaps[${k}], extent=(-2, 2, -2, 2), origin="lower", cmap="coolwarm", vmin=0, vmax=1, alpha=0.6, interpolation="bilinear")`,
    `${indent}plt.contour(GX, GY, snaps[${k}], levels=[0.5], colors="black", linewidths=2)`,
];
/** frame(t): the trained picture for 1.5 s (the still frame), then 12 pictures a second from the start. */
const NET_FRAME = ['def frame(t):', '    k = int(t * 12) % (len(snaps) + 18) - 18', '    k = len(snaps) - 1 if k < 0 else k', ...NET_SNAP('k', '    '), ...NET_POINTS.map((l) => `    ${l}`), '    plt.title(f"training step {k * 10}")'];
const NET_DONE = [...NET_SNAP('-1', ''), ...NET_POINTS, 'plt.title("after 600 steps")'];

const NETWORK: Guide = {
    id: 'ml-network',
    title: 'A neural network that learns',
    summary: 'Points no straight line can split, a small network trained in NumPy, and frame(t) playing its training as a moving picture.',
    category: 'Data and probability',
    level: 'advanced',
    minutes: 3,
    outcomes: ['Train a two-layer network in a script', 'Draw its probability and its boundary', 'Play the training with frame(t)'],
    requires: ['ml-logistic'],
    next: ['network-learns', 'ml-activations'],
    chart: chart(...NET_WINDOW, ...py(...XOR_DATA, ...netTrain(8, 2.5), ...NET_FRAME)),
    steps: [
        {
            title: 'Draw points no line can split',
            body: 'Four clouds: blue at two opposite corners, red at the other two. No straight line puts the blues on one side, so logistic regression fails here.',
            chart: chart(...NET_WINDOW, ...py(...XOR_DATA, ...NET_POINTS)),
        },
        {
            title: 'Train a small network',
            body: 'Two inputs, 8 hidden units with tanh, one output through σ. The loop runs 600 steps of gradient descent by hand: the forward pass, the error, the backward pass. The bent boundary splits the four clouds.',
            chart: chart(...NET_WINDOW, ...py(...XOR_DATA, ...netTrain(8, 2.5), ...NET_DONE)),
        },
        {
            title: 'Watch it learn',
            body: 'Every 10 steps the loop keeps a picture in `snaps`. `def frame(t):` shows 12 of them a second, with the step in the title: the boundary bends into shape.',
            chart: chart(...NET_WINDOW, ...py(...XOR_DATA, ...netTrain(8, 2.5), ...NET_FRAME)),
            tip: 'A picture that comes again is drawn from memory, so a frame costs about a millisecond.',
        },
    ],
};

const NETWORK_LEARNS: Guide = {
    id: 'network-learns',
    title: 'A network learns',
    summary: 'Watch a small neural network learn: its probability picture and boundary change step by step, first on four clouds, then on two rings.',
    category: 'Showcase',
    level: 'advanced',
    minutes: 2,
    outcomes: ['Play the training of a network', 'Keep a picture every few steps', 'Learn a ring with a bent boundary'],
    next: ['ml-network', 'ml-activations'],
    chart: chart(...NET_WINDOW, ...py(...RING_DATA, ...netTrain(12, 2.0), ...NET_FRAME)),
    steps: [
        {
            title: 'Draw the four clouds',
            body: 'Blue at two opposite corners, red at the other two: the XOR pattern. No straight line splits it.',
            chart: chart(...NET_WINDOW, ...py(...XOR_DATA, ...NET_POINTS)),
        },
        {
            title: 'Let the network learn them',
            body: 'A 2-8-1 network trains in the script, 600 steps of gradient descent. `frame(t)` plays a picture of every 10th step: red and blue regions grow, and the black boundary bends round the clouds.',
            chart: chart(...NET_WINDOW, ...py(...XOR_DATA, ...netTrain(8, 2.5), ...NET_FRAME)),
        },
        {
            title: 'Learn two rings',
            body: 'Blue inside, red outside. With 12 hidden units the boundary closes into a loop between the rings.',
            chart: chart(...NET_WINDOW, ...py(...RING_DATA, ...netTrain(12, 2.0), ...NET_FRAME)),
        },
    ],
};

// ------------------------------------------------------------------ the optimizer race (Showcase)

const RACE = (kinds: 'one' | 'all') =>
    py(
        'import numpy as np',
        'import matplotlib.pyplot as plt',
        ...SLOPE,
        'def race(kind, steps=200):',
        '    p = np.array([-1.5, 2.5])',
        '    m = np.zeros(2)',
        '    s = np.zeros(2)',
        '    path = [p]',
        '    for k in range(1, steps + 1):',
        '        g = slope(p)',
        '        if kind == "gradient descent":',
        '            p = p - 0.02 * g',
        '        elif kind == "momentum":',
        '            m = 0.9 * m + g',
        '            p = p - 0.004 * m',
        '        elif kind == "RMSprop":',
        '            s = 0.9 * s + 0.1 * g**2',
        '            p = p - 0.02 * g / (np.sqrt(s) + 1e-8)',
        '        else:',
        '            m = 0.9 * m + 0.1 * g',
        '            s = 0.999 * s + 0.001 * g**2',
        '            p = p - 0.08 * (m / (1 - 0.9**k)) / (np.sqrt(s / (1 - 0.999**k)) + 1e-8)',
        '        path.append(p)',
        '    return np.array(path)',
        kinds === 'one' ? 'runners = [("gradient descent", "black")]' : 'runners = [("gradient descent", "black"), ("momentum", "C1"), ("RMSprop", "C6"), ("Adam", "#ffffff")]',
        'paths = [race(kind) for kind, colour in runners]',
        'def frame(t):',
        '    u = (t * 40 + 200) % 260',
        '    k = min(int(u), 199)',
        '    a = min(u - k, 1.0)',
        '    for (kind, colour), path in zip(runners, paths):',
        '        head = path[k] + a * (path[k + 1] - path[k])',
        '        trail = np.vstack([path[:k + 1], head])',
        '        plt.plot(trail[:, 0], trail[:, 1], color=colour, linewidth=2, label=kind)',
        '        plt.scatter([head[0]], [head[1]], color=colour, s=50)',
        '    plt.legend(loc="lower right")',
        '    plt.title(f"step {min(int(u), 200)}")'
    );

const OPTIMIZER_RACE: Guide = {
    id: 'optimizer-race',
    title: 'The optimizer race',
    summary: 'Gradient descent, momentum, RMSprop and Adam start together on a curved valley and race to the minimum, 40 steps a second.',
    category: 'Showcase',
    level: 'advanced',
    minutes: 2,
    outcomes: ['Run four optimizers in one script', 'Let their paths draw themselves with frame(t)', 'See which one reaches the minimum first'],
    next: ['ml-optimizers', 'ml-landscape'],
    chart: chart(...LOSS_WINDOW, LOSS, lossHeat(0.6), LOSS_LEVELS, ...RACE('all')),
    steps: [
        {
            title: 'Draw the curved valley',
            body: 'The loss f(x, y) has a long curved valley with its minimum at (1, 1): steep walls, a nearly flat floor. A hard course for an optimizer.',
            chart: chart(...LOSS_WINDOW, LOSS, lossHeat(0.6), LOSS_LEVELS, LOSS_MIN),
        },
        {
            title: 'Send gradient descent alone',
            body: 'The script runs 200 steps from (-1.5, 2.5); `frame(t)` draws 40 steps a second, the head gliding between them. Plain gradient descent reaches the floor fast, then crawls.',
            chart: chart(...LOSS_WINDOW, LOSS, lossHeat(0.6), LOSS_LEVELS, ...RACE('one')),
        },
        {
            title: 'Start the race',
            body: 'Momentum, RMSprop and Adam join from the same start. Adam reaches the minimum near step 90, momentum near step 175; RMSprop and gradient descent are still on the way at step 200.',
            chart: chart(...LOSS_WINDOW, LOSS, lossHeat(0.6), LOSS_LEVELS, ...RACE('all')),
        },
    ],
};

// ------------------------------------------------------------------ k-means

const KM_WINDOW = ['show x from -5 to 5 and y from -4 to 4', 'size 12 x 9.6'];
const KM_DATA = ['import numpy as np', 'import matplotlib.pyplot as plt', 'np.random.seed(3)', 'X = np.concatenate([np.random.randn(50, 2) * 0.7 + c for c in ([-2.5, 1.5], [2.0, 2.0], [0.0, -2.0])])'];
const KM_START = [
    '# k-means++: each new centre far from the ones before',
    'C = [X[np.random.randint(len(X))]]',
    'for k in range(2):',
    '    d = np.min([np.sum((X - c)**2, axis=1) for c in C], axis=0)',
    '    C.append(X[np.random.choice(len(X), p=d / d.sum())])',
    'C = np.array(C)',
];
const KM_LOOP = [
    'history = [C]',
    'groups = []',
    'for step in range(6):',
    '    g = np.argmin(np.sum((X[:, None, :] - C[None, :, :])**2, axis=2), axis=1)',
    '    groups.append(g)',
    '    C = np.array([X[g == k].mean(axis=0) for k in range(3)])',
    '    history.append(C)',
    'colours = ["C0", "C1", "C2"]',
];
const KM_FIRST = [
    'g = np.argmin(np.sum((X[:, None, :] - C[None, :, :])**2, axis=2), axis=1)',
    'for k in range(3):',
    '    plt.scatter(X[g == k, 0], X[g == k, 1], color=["C0", "C1", "C2"][k], s=25)',
    'plt.scatter(C[:, 0], C[:, 1], color="black", s=120)',
    'plt.title("the start: each point takes its nearest centre")',
];
const KM_FRAME = [
    'def frame(t):',
    '    s = int(t / 1.2) % len(groups)',
    '    for k in range(3):',
    '        plt.scatter(X[groups[s] == k, 0], X[groups[s] == k, 1], color=colours[k], s=25)',
    '        path = np.array([h[k] for h in history[:s + 2]])',
    '        plt.plot(path[:, 0], path[:, 1], color="black", linewidth=1.5)',
    '        plt.scatter(path[-1:, 0], path[-1:, 1], color="black", s=120)',
    '    plt.title(f"k-means, step {s + 1}")',
];
const KM_CELLS = [
    'GX, GY = np.meshgrid(np.linspace(-5, 5, 201), np.linspace(-4, 4, 161))',
    'cell = np.argmin([(GX - c[0])**2 + (GY - c[1])**2 for c in C], axis=0)',
    'for k in range(3):',
    '    plt.contourf(GX, GY, (cell == k) * 1.0, levels=[0.5, 1.5], colors=[colours[k]], alpha=0.2)',
    '    plt.scatter(X[groups[-1] == k, 0], X[groups[-1] == k, 1], color=colours[k], s=25)',
    'plt.scatter(C[:, 0], C[:, 1], color="black", s=120)',
    'plt.title("each colour: the points nearest one centre")',
];

const KMEANS: Guide = {
    id: 'ml-kmeans',
    title: 'k-means step by step',
    summary: 'Three groups of points, three centres: each point joins its nearest centre, each centre moves to the middle of its points, again and again.',
    category: 'Data and probability',
    level: 'core',
    minutes: 3,
    outcomes: ['Start k-means with k-means++', 'Play its steps with frame(t)', 'Colour the plane by the nearest centre'],
    next: ['ml-pca', 'ml-logistic'],
    chart: chart(...KM_WINDOW, ...py(...KM_DATA, ...KM_START, ...KM_LOOP, ...KM_FRAME)),
    steps: [
        {
            title: 'Draw three groups of points',
            body: 'A seeded script makes three clouds of 50 points. k-means does not know which point came from which cloud; it has to find the groups.',
            chart: chart(...KM_WINDOW, ...py(...KM_DATA, 'plt.scatter(X[:, 0], X[:, 1], color="gray", s=25)')),
        },
        {
            title: 'Pick three centres far apart',
            body: 'k-means++ takes a random point as the first centre, then each next one with a chance growing with its squared distance to the centres so far. Every point then joins its nearest centre.',
            chart: chart(...KM_WINDOW, ...py(...KM_DATA, ...KM_START, ...KM_FIRST)),
        },
        {
            title: 'Watch the centres move',
            body: 'Each step moves every centre to the mean of its points, then the points choose again. `frame(t)` shows one step every 1.2 s; the black lines trace the centres.',
            chart: chart(...KM_WINDOW, ...py(...KM_DATA, ...KM_START, ...KM_LOOP, ...KM_FRAME)),
        },
        {
            title: 'Colour the plane by the centres',
            body: 'After six steps nothing changes. `np.argmin` over a grid finds the nearest centre of each place, and `plt.contourf` fills each cell in its colour: three cells with straight borders.',
            chart: chart(...KM_WINDOW, ...py(...KM_DATA, ...KM_START, ...KM_LOOP, ...KM_CELLS)),
        },
    ],
};

// ------------------------------------------------------------------ principal components

const PCA_WINDOW = ['show x from -4 to 4 and y from -3 to 3', 'size 12 x 9', 'equal scale'];
const PCA_DATA = ['import numpy as np', 'import matplotlib.pyplot as plt', 'np.random.seed(2)', 'Z = np.random.multivariate_normal([0, 0], [[2.0, 1.2], [1.2, 1.0]], 200)', 'Zc = Z - Z.mean(axis=0)'];
const PCA_SVD = ['U, S, Vt = np.linalg.svd(Zc, full_matrices=False)', 'share = S**2 / np.sum(S**2)'];
const PCA_ARROWS = ['for i in range(2):', '    v = Vt[i] * 2 * S[i] / np.sqrt(len(Z))', '    plt.arrow(0, 0, v[0], v[1], color="black", width=2)'];
const pcaAngle = (a: number) => `slider angle from 0 to 180, starting at ${a}, in steps of 1`;
const PCA_LINE = [
    'u = np.array([np.cos(np.radians(angle)), np.sin(np.radians(angle))])',
    'along = Zc @ u',
    'plt.plot([-5 * u[0], 5 * u[0]], [-5 * u[1], 5 * u[1]], color="gray", linewidth=1)',
];
const PCA_DOTS = (faint: boolean) => `plt.scatter(Zc[:, 0], Zc[:, 1], color="C0", s=16${faint ? ', alpha=0.6' : ''})`;

const PCA: Guide = {
    id: 'ml-pca',
    title: 'Principal components',
    summary: 'The SVD of a cloud of points gives its principal directions; a slider turns a line and shows the variance along it peak at the first one.',
    category: 'Data and probability',
    level: 'core',
    minutes: 3,
    outcomes: ['Sample correlated points', 'Find the principal directions with the SVD', 'Project onto a line on a slider'],
    next: ['ml-kmeans', 'vectors-arrows'],
    chart: chart(...PCA_WINDOW, pcaAngle(60), ...py(...PCA_DATA, ...PCA_SVD, ...PCA_LINE, PCA_DOTS(true), 'plt.scatter(along * u[0], along * u[1], color="C3", s=16)', ...PCA_ARROWS, 'plt.title(f"variance along the line {np.var(along):.2f}; PC1 holds {share[0]:.0%}")')),
    steps: [
        {
            title: 'Draw a cloud of points',
            body: '`np.random.multivariate_normal` draws 200 points with the covariance [[2, 1.2], [1.2, 1]]: a cloud tilted up to the right. The script moves its mean to the origin.',
            chart: chart(...PCA_WINDOW, ...py(...PCA_DATA, PCA_DOTS(false))),
        },
        {
            title: 'Draw the principal directions',
            body: 'The rows of `Vt` from `np.linalg.svd` are the principal directions; each arrow is two standard deviations long. The first holds 93 % of the variance.',
            chart: chart(...PCA_WINDOW, ...py(...PCA_DATA, ...PCA_SVD, PCA_DOTS(false), ...PCA_ARROWS, 'plt.title(f"PC1 holds {share[0]:.0%} of the variance")')),
        },
        {
            title: 'Project onto a line',
            body: 'The red dots are the points dropped onto a line at `angle` degrees. Drag it: the variance along the line peaks at 2.74 near 34°, along the first arrow, and drops to 0.21 across it.',
            chart: chart(...PCA_WINDOW, pcaAngle(60), ...py(...PCA_DATA, ...PCA_SVD, ...PCA_LINE, PCA_DOTS(true), 'plt.scatter(along * u[0], along * u[1], color="C3", s=16)', ...PCA_ARROWS, 'plt.title(f"variance along the line {np.var(along):.2f}; PC1 holds {share[0]:.0%}")')),
        },
    ],
};

// ------------------------------------------------------------------ overfitting and ridge

const OF_WINDOW = ['show x from 0 to 1 and y from -1.6 to 1.6', 'size 12 x 8'];
const ofDegree = (n: number) => `slider n from 1 to 12, starting at ${n}, in steps of 1`;
const OF_DATA = [
    'import numpy as np',
    'import matplotlib.pyplot as plt',
    'np.random.seed(4)',
    'x = np.sort(np.random.rand(14))',
    'y = np.sin(2 * np.pi * x) + 0.25 * np.random.randn(14)',
    'xt = np.random.rand(30)',
    'yt = np.sin(2 * np.pi * xt) + 0.25 * np.random.randn(30)',
    'xs = np.linspace(0, 1, 300)',
    'plt.plot(xs, np.sin(2 * np.pi * xs), color="gray", linewidth=1, label="true curve")',
];
const OF_FIT = ['c = np.polyfit(x, y, int(n))', 'plt.plot(xs, np.clip(np.polyval(c, xs), -1.6, 1.6), color="C3", linewidth=2.5, label=f"degree {int(n)}")', 'plt.scatter(x, y, color="C0", s=36, label="training data")', 'train = np.mean((np.polyval(c, x) - y)**2)'];
const OF_NEW = ['plt.scatter(xt, yt, color="C2", s=16, label="new data")', 'test = np.mean((np.polyval(c, xt) - yt)**2)', 'plt.title(f"training error {train:.3f}, error on new data {test:.3f}")'];
const ofChart = (n: number, test: boolean) => chart(...OF_WINDOW, ofDegree(n), ...py(...OF_DATA, ...OF_FIT, ...(test ? OF_NEW : ['plt.title(f"training error {train:.3f}")']), 'plt.legend(loc="lower left")'));
const ofRidge = (l: number) => `slider l from -8 to 0, starting at ${l}`;
const OF_RIDGE = [
    'lam = 10**l',
    'V = np.vander(x, 13)',
    'w = np.linalg.solve(V.T @ V + lam * np.eye(13), V.T @ y)',
    'plt.plot(xs, np.clip(np.vander(xs, 13) @ w, -1.6, 1.6), color="C4", linewidth=2.5, label="degree 12, ridge")',
    'plt.scatter(x, y, color="C0", s=36, label="training data")',
    'plt.scatter(xt, yt, color="C2", s=16, label="new data")',
    'test = np.mean((np.vander(xt, 13) @ w - yt)**2)',
    'plt.title(f"$\\lambda$ = {lam:.0e}: error on new data {test:.3f}")',
    'plt.legend(loc="lower left")',
];

const OVERFITTING: Guide = {
    id: 'ml-overfitting',
    title: 'Overfitting and regularisation',
    summary: 'A polynomial with the degree on a slider fits 14 noisy points better and better, and new points worse and worse, until ridge holds it back.',
    category: 'Data and probability',
    level: 'core',
    minutes: 3,
    outcomes: ['Fit a polynomial of any degree with NumPy', 'Compare the error on training and new data', 'Hold a fit back with ridge and a λ slider'],
    next: ['ml-logistic', 'data-regression'],
    chart: chart(...OF_WINDOW, ofRidge(-3), ...py(...OF_DATA, ...OF_RIDGE)),
    steps: [
        {
            title: 'Fit a polynomial',
            body: '14 noisy samples of a sine. `np.polyfit` fits a polynomial of degree `n`, the slider. Degree 3 follows the true curve well.',
            chart: ofChart(3, false),
        },
        {
            title: 'Check it on new data',
            body: 'The green points are 30 new samples the fit never saw. The title prints the mean squared error on both: at degree 3 they are close, 0.052 and 0.056.',
            chart: ofChart(3, true),
        },
        {
            title: 'Raise the degree',
            body: 'At degree 12 the curve passes almost through every blue point, so the training error is near 0. Between them it swings wildly, and the error on new data grows thousands of times.',
            chart: ofChart(12, true),
        },
        {
            title: 'Hold it back with ridge',
            body: 'Ridge regression adds λ times the squared weights to the loss. `np.vander` makes the 13 powers of x and `np.linalg.solve` finds the weights. Drag `l`: λ = 10^l near 0.001 is best.',
            chart: chart(...OF_WINDOW, ofRidge(-3), ...py(...OF_DATA, ...OF_RIDGE)),
            tip: 'Too small a λ overfits again; too large a λ flattens the curve towards a line.',
        },
    ],
};

// ------------------------------------------------------------------ activation functions and softmax

const AF_WINDOW = ['show x from -4 to 4 and y from -1.5 to 3', 'size 12 x 7'];
const AF_CLASSIC = [
    'plot $\\sigma(x) = \\frac{1}{1 + e^{-x}}$ in blue, thick, with the legend "sigmoid"',
    'plot $t(x) = \\tanh x$ in green, thick, with the legend "tanh"',
    'plot $\\mathrm{ReLU}(x) = \\max(0, x)$ in red, thick, with the legend "ReLU"',
];
const AF_BUILTIN = ['plot $g(x) = \\operatorname{gelu}(x)$ in purple, thick, dashed, with the legend "GELU"', 'plot $s(x) = \\operatorname{softplus}(x)$ in orange, thick, dashed, with the legend "softplus"'];
const SM_WINDOW = ['show x from -0.6 to 3.6 and y from 0 to 1', 'size 12 x 7'];
const smTemperature = (T: number) => `slider T from 0.2 to 5, starting at ${T}, in steps of 0.02`;
const SM_LINES = [
    'let $u = (2, 1, 0.1, -1)$',
    'write "p = {softmax(u / T)}" at (1.5, 0.92)',
    ...py(
        'import numpy as np',
        'import matplotlib.pyplot as plt',
        'z = np.array([2.0, 1.0, 0.1, -1.0])',
        'p = np.exp(z / T) / np.sum(np.exp(z / T))',
        'plt.bar(np.arange(4), p, width=0.6, color="C0")',
        'for k in range(4):',
        '    plt.text(k, p[k] + 0.02, f"z = {z[k]:g}", ha="center")',
        'plt.title(f"softmax at temperature T = {T:.2f}")'
    ),
];

const ACTIVATIONS: Guide = {
    id: 'ml-activations',
    title: 'Activation functions and softmax',
    summary: 'Write σ, tanh and ReLU as in your notes, use GELU and softplus by name, and turn the temperature of a softmax with a slider.',
    category: 'Data and probability',
    level: 'start',
    minutes: 3,
    outcomes: ['Name functions as ML notes do: σ, ReLU', 'Use sigmoid, relu, softplus, gelu and softmax', 'Change a softmax temperature on a slider'],
    next: ['ml-network', 'ml-logistic'],
    chart: chart(...AF_WINDOW, ...AF_CLASSIC, ...AF_BUILTIN),
    steps: [
        {
            title: 'Plot σ, tanh and ReLU',
            body: 'Write the names as your notes do: `\\sigma(x)`, `\\mathrm{ReLU}(x)`, or `t(x)` for tanh. Each is a function of the chart, printed back as written; other lines call it, `\\sigma(2x)`.',
            chart: chart(...AF_WINDOW, ...AF_CLASSIC),
        },
        {
            title: 'Use the built-in names',
            body: '`sigmoid`, `relu`, `softplus`, `gelu` and `silu` work in every formula, plain or as `\\operatorname{gelu}(x)`. A function or slider of the same name wins.',
            chart: chart(...AF_WINDOW, ...AF_CLASSIC, ...AF_BUILTIN),
        },
        {
            title: 'Turn the softmax temperature',
            body: 'softmax(z / T) turns scores into probabilities. The script draws them as bars; the label prints the built-in `softmax(u / T)`. Drag `T` up: the bars even out.',
            chart: chart(...SM_WINDOW, smTemperature(1), ...SM_LINES),
        },
        {
            title: 'Cool it down',
            body: 'At T = 0.2 almost all the probability sits on the largest score: softmax becomes a choice of the maximum.',
            chart: chart(...SM_WINDOW, smTemperature(0.2), ...SM_LINES),
        },
    ],
};

// ------------------------------------------------------------------ a loss landscape in 3D

const LL_WINDOW = ['3d', 'show x from -2.2 to 2.2, y from -1.5 to 1.5 and z from -0.5 to 4'];
const llStart = (a: number) => [`slider a from -2.1 to 2.1, starting at ${a}`, 'slider b from -1.4 to 1.4, starting at 1.3'];
const LL_LOSS = ['let $L(x, y) = \\frac{(x^2 - 2)^2}{4} + \\frac{y^2}{2} + 0.3x$', 'plot $z = L(x, y)$ for x from -2.2 to 2.2 and y from -1.5 to 1.5 in viridis, opacity 0.8'];
const LL_FLOW = 'draw the solution of $\\dot{p} = (-(x^3 - 2x + 0.3), -y, -((x^3 - 2x + 0.3)^2 + y^2))$ through (a, b, L(a, b)) for t from 0 to 8 in red, very thick, traced';

const LANDSCAPE: Guide = {
    id: 'ml-landscape',
    title: 'A loss landscape in 3D',
    summary: 'A loss with two valleys as a surface, and gradient descent as a ball that rolls down it, from a start on two sliders.',
    category: 'Data and probability',
    level: 'advanced',
    minutes: 3,
    outcomes: ['Draw a loss as a surface in 3D', 'Draw the gradient flow on it as a traced path', 'See the start pick the valley'],
    requires: ['ml-optimizers'],
    next: ['optimizer-race', 'systems'],
    chart: chart(...LL_WINDOW, ...llStart(0.3), ...LL_LOSS, LL_FLOW),
    steps: [
        {
            title: 'Draw the loss surface',
            body: 'L(x, y) has two valleys: a deeper one on the left, a shallower one on the right, and a ridge between them near x = 0.15. Drag the chart to turn it.',
            chart: chart(...LL_WINDOW, ...LL_LOSS),
        },
        {
            title: 'Roll down from a start',
            body: 'Gradient descent with tiny steps is the system ẋ = -∂L/∂x, ẏ = -∂L/∂y; the third part, ż, keeps the path on the surface. `traced` lets it roll down from (a, b).',
            chart: chart(...LL_WINDOW, ...llStart(0.3), ...LL_LOSS, LL_FLOW),
        },
        {
            title: 'Start across the ridge',
            body: 'Drag `a` below 0.15: the path rolls into the deeper valley on the left instead. Where training starts decides which minimum it finds.',
            chart: chart(...LL_WINDOW, ...llStart(-0.2), ...LL_LOSS, LL_FLOW),
        },
    ],
};

/** The guides of the Machine learning section, in the order the home shows them. */
export const ML_GUIDES: Guide[] = [ACTIVATIONS, OPTIMIZERS, LOGISTIC, NETWORK, KMEANS, PCA, OVERFITTING, LANDSCAPE];

/** The two Showcase pages; src/guides/showcase.ts puts them next to the Lorenz page. */
export const ML_SHOWCASE: Guide[] = [OPTIMIZER_RACE, NETWORK_LEARNS];

/** The ids of the section, for src/guides/home.ts. */
export const ML_IDS: readonly string[] = ML_GUIDES.map((g) => g.id);
