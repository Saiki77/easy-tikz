/*
 * 6.0 ML: the editor's examples of machine learning (src/guides/examples.ts
 * lists them with the other examples of version 6): a classifier with its
 * probability picture, k-means that moves, and the activation functions
 * written as ML notes write them. The Showcase pages (the optimizer race,
 * a network that learns) are examples too, through the Showcase.
 */

const py = (...lines: string[]) => ['python:', ...lines.map((l) => (l ? `    ${l}` : ''))];

export const ML_EXAMPLES = [
    {
        id: 'ml-classifier',
        en: { title: 'A classifier and its probability', description: 'Logistic regression trained in NumPy: the probability as a picture, the line p = 0.5, the accuracy in the title.' },
        ja: { title: '分類器とその確率', description: 'NumPy で学習するロジスティック回帰です。確率を画像で、p = 0.5 の線を黒で描き、正解率をタイトルに表示します。' },
        lines: [
            'show x from -4 to 4 and y from -3 to 3',
            'slider n from 0 to 200, starting at 200, in steps of 5',
            ...py(
                'import numpy as np',
                'import matplotlib.pyplot as plt',
                'np.random.seed(1)',
                'A = np.random.randn(60, 2) * 0.8 + np.array([-1.0, -0.8])',
                'B = np.random.randn(60, 2) * 0.8 + np.array([1.2, 1.0])',
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
                'plt.imshow(P, extent=(-4, 4, -3, 3), origin="lower", cmap="coolwarm", vmin=0, vmax=1, alpha=0.5, interpolation="bilinear")',
                'plt.contour(GX, GY, P, levels=[0.5], colors="black", linewidths=2)',
                'plt.scatter(A[:, 0], A[:, 1], color="C0", s=30, label="class 0")',
                'plt.scatter(B[:, 0], B[:, 1], color="C3", s=30, label="class 1")',
                'plt.title(f"after {int(n)} steps: accuracy {np.mean(((X @ w + b) > 0) == y):.2f}")',
                'plt.legend(loc="upper left")'
            ),
        ],
    },
    {
        id: 'ml-clusters',
        en: { title: 'k-means that moves', description: 'k-means++ picks three centres, then frame(t) plays the steps: points take their nearest centre, centres walk to the mean.' },
        ja: { title: '動く k-means', description: 'k-means++ が 3 つの中心を選び、frame(t) がステップを再生します。点はいちばん近い中心に入り、中心は平均へ動きます。' },
        lines: [
            'show x from -5 to 5 and y from -4 to 4',
            ...py(
                'import numpy as np',
                'import matplotlib.pyplot as plt',
                'np.random.seed(3)',
                'X = np.concatenate([np.random.randn(50, 2) * 0.7 + c for c in ([-2.5, 1.5], [2.0, 2.0], [0.0, -2.0])])',
                'C = [X[np.random.randint(len(X))]]',
                'for k in range(2):',
                '    d = np.min([np.sum((X - c)**2, axis=1) for c in C], axis=0)',
                '    C.append(X[np.random.choice(len(X), p=d / d.sum())])',
                'C = np.array(C)',
                'history = [C]',
                'groups = []',
                'for step in range(6):',
                '    g = np.argmin(np.sum((X[:, None, :] - C[None, :, :])**2, axis=2), axis=1)',
                '    groups.append(g)',
                '    C = np.array([X[g == k].mean(axis=0) for k in range(3)])',
                '    history.append(C)',
                'colours = ["C0", "C1", "C2"]',
                'def frame(t):',
                '    s = int(t / 1.2) % len(groups)',
                '    for k in range(3):',
                '        plt.scatter(X[groups[s] == k, 0], X[groups[s] == k, 1], color=colours[k], s=25)',
                '        path = np.array([h[k] for h in history[:s + 2]])',
                '        plt.plot(path[:, 0], path[:, 1], color="black", linewidth=1.5)',
                '        plt.scatter(path[-1:, 0], path[-1:, 1], color="black", s=120)',
                '    plt.title(f"k-means, step {s + 1}")'
            ),
        ],
    },
    {
        id: 'ml-activation-functions',
        en: { title: 'Activation functions', description: 'σ, tanh and ReLU named as in ML notes, GELU and softplus by their built-in names.' },
        ja: { title: '活性化関数', description: 'σ、tanh、ReLU は ML のノートのとおりの名前で、GELU と softplus は組み込みの名前で描きます。' },
        lines: [
            'show x from -4 to 4 and y from -1.5 to 3',
            'plot $\\sigma(x) = \\frac{1}{1 + e^{-x}}$ in blue, thick, with the legend "sigmoid"',
            'plot $t(x) = \\tanh x$ in green, thick, with the legend "tanh"',
            'plot $\\mathrm{ReLU}(x) = \\max(0, x)$ in red, thick, with the legend "ReLU"',
            'plot $g(x) = \\operatorname{gelu}(x)$ in purple, thick, dashed, with the legend "GELU"',
            'plot $s(x) = \\operatorname{softplus}(x)$ in orange, thick, dashed, with the legend "softplus"',
        ],
    },
];
