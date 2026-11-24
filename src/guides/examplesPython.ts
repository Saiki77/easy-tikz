/*
 * 6.0 P: the editor's examples of Python in a chart (src/guides/examples.ts
 * lists them with the other examples of version 6): the Fourier drawing of
 * a star, gradient descent written in NumPy over a contour plot, and a
 * histogram of random samples with the normal curve.
 */

const py = (...lines: string[]) => ['python:', ...lines.map((l) => (l ? `    ${l}` : ''))];

export const PYTHON_EXAMPLES = [
    {
        id: 'python-star',
        en: { title: 'Fourier drawing of a star', description: 'A script walks round a star, takes its FFT, and n turning circles draw it.' },
        ja: { title: '星のフーリエ描画', description: 'スクリプトで星の周りを歩いて FFT を取り、n 個の回る円で描きます。' },
        lines: [
            'show x from -1.6 to 1.6 and y from -1.3 to 1.3',
            'equal scale',
            'slider n from 1 to 80, starting at 25, in steps of 1',
            ...py(
                'import numpy as np',
                'k = np.arange(10)',
                'r = np.where(k % 2 == 0, 1.0, 0.42)',
                'corners = r * np.exp(1j * (np.pi / 2 + k * np.pi / 5))',
                '# 25 points on each edge, closed',
                'u = np.linspace(0, 1, 25, endpoint=False)',
                'star = np.concatenate([a + (b - a) * u for a, b in zip(corners, np.roll(corners, -1))])',
                'c = np.fft.fft(star) / len(star)'
            ),
            'draw the circles of c, using n circles, with its path in purple',
        ],
    },
    {
        id: 'python-descent',
        en: { title: 'Gradient descent in NumPy', description: 'Level curves of a loss and the steps of gradient descent, computed in Python; the learning rate is a slider.' },
        ja: { title: 'NumPy で勾配降下法', description: '損失の等高線と勾配降下法のステップを Python で計算します。学習率はスライダーです。' },
        lines: [
            'show x from -3 to 3 and y from -2 to 2',
            'equal scale',
            'slider eta from 0.01 to 0.3, starting at 0.1',
            ...py(
                'import numpy as np',
                'import matplotlib.pyplot as plt',
                'def loss(x, y):',
                '    return x**2 + 4 * y**2',
                'X, Y = np.meshgrid(np.linspace(-3, 3, 80), np.linspace(-2, 2, 60))',
                'plt.contour(X, Y, loss(X, Y), levels=[0.5, 1, 2, 4, 8], cmap="viridis")',
                'p = np.array([2.5, 1.5])',
                'path = [p]',
                'for step in range(25):',
                '    grad = np.array([2 * p[0], 8 * p[1]])',
                '    p = p - eta * grad',
                '    path.append(p)',
                'path = np.array(path)',
                'plt.plot(path[:, 0], path[:, 1], "o-", color="C3", markersize=3)',
                'plt.title(f"loss after 25 steps: {loss(*p):.4f}")'
            ),
        ],
    },
    {
        id: 'python-histogram',
        en: { title: 'Random samples and the normal curve', description: 'n seeded samples of a normal distribution as a histogram, with the density curve over it.' },
        ja: { title: '乱数の標本と正規分布の曲線', description: '正規分布からの n 個の標本（シード固定）をヒストグラムにし、密度の曲線を重ねます。' },
        lines: [
            'show x from -4 to 4 and y from 0 to 0.55',
            'slider n from 50 to 5000, starting at 500, in steps of 50',
            ...py(
                'import numpy as np',
                'import matplotlib.pyplot as plt',
                'rng = np.random.default_rng(7)',
                'samples = rng.normal(0, 1, int(n))',
                'plt.hist(samples, bins=30, density=True, color="C0", alpha=0.5, label="samples")',
                'x = np.linspace(-4, 4, 200)',
                'plt.plot(x, np.exp(-x**2 / 2) / np.sqrt(2 * np.pi), color="C3", label="density")',
                'plt.legend()',
                'mean = samples.mean()'
            ),
            'write "mean = {mean:3}" at (-3.5, 0.5)',
        ],
    },
];
