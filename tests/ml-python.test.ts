/*
 * The machine learning pack (6.0 ML), the Python side: NumPy for ML scripts
 * (keepdims, svd, pinv, lstsq, matrix_rank, cov, corrcoef, logaddexp,
 * bincount, multivariate_normal, exp that overflows), matplotlib (contourf,
 * contour levels and colours, hist, legend loc, scatter sizes, distinct
 * colours, imshow's origin and interpolation), and frame(t) on the live
 * canvas: pictures kept per snapshot, the title of each frame, the legend,
 * the still frame for the export. Speed of a 50 x 50 picture per frame.
 */
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { SettingsManager } from '../src/settings';
import { computeScene2D, labelMetricsFor, Scene2D, SceneItem2D } from '../src/scene';
import type { MotionFrame } from '../src/types';
import { programOf } from '../src/python/program';
import type { Draw } from '../src/python/pyplot';
import { svd } from '../src/python/ml';

function run(code: string) {
    const r = programOf([code]).run({});
    assert.equal(r.error ? `${r.error.message} (line ${r.error.line})` : null, null);
    return r;
}

/** What a script printed, one entry per print. */
function printed(code: string): string[] {
    return run(code).printed.map((p) => p.text);
}

function settingsOf(text: string): SettingsManager {
    const r = parseChartText(text);
    assert.deepEqual(r.problems, [], text);
    return SettingsManager.fromJSON(r.data);
}

function sceneOf(text: string, motion?: MotionFrame): Scene2D {
    const settings = settingsOf(text);
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    return computeScene2D({
        functions: config.functions,
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: { nx: 100, ny: 100 },
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(10, 10),
        motion,
    });
}

/** One pixel of an item's pixel layer at (x, y): 0..255 channels and alpha. */
function pixelAt(it: SceneItem2D, x: number, y: number, layer = 0): number[] {
    const prim = it.pixels?.[layer];
    assert.ok(prim, 'no pixel layer');
    const buf = new Uint8ClampedArray(4);
    const d = 1e-9;
    prim.tile({ xmin: x - d, xmax: x + d, ymin: y - d, ymax: y + d }, 1, 1, 0, 0, 1, 1, buf);
    return Array.from(buf);
}

const py = (...lines: string[]) => ['python:', ...lines.map((l) => `    ${l}`)].join('\n');

test('numpy: keepdims, a softmax by rows that never overflows, exp of large numbers', () => {
    const out = printed(
        [
            'import numpy as np',
            'z = np.array([[1.0, 2.0, 3.0], [1000.0, 0.0, -1000.0]])',
            'e = np.exp(z - z.max(axis=1, keepdims=True))',
            'p = e / e.sum(axis=1, keepdims=True)',
            'print(p.shape, np.round(p[1], 3))',
            'print(np.std(z, axis=0, keepdims=True).shape, np.mean(z, keepdims=True).shape)',
            'print(np.exp(1000.0), 1 / (1 + np.exp(-np.array([-1000.0, 0.0, 1000.0]))))',
        ].join('\n')
    );
    assert.equal(out[0], '(2, 3) [1. 0. 0.]');
    assert.equal(out[1], '(1, 3) (1, 1)');
    assert.equal(out[2], 'inf [0.  0.5 1. ]');
});

test('np.linalg.svd, pinv, lstsq, matrix_rank: A = U S Vt, orthogonal U and V, least squares', () => {
    const r = run(
        [
            'import numpy as np',
            'A = np.array([[3.0, 1.0], [1.0, 3.0], [0.0, 2.0]])',
            'U, S, Vt = np.linalg.svd(A)',
            'Uf, Sf, Vtf = np.linalg.svd(A, full_matrices=False)',
            'W, Sw, Vw = np.linalg.svd(A.T)',
            'ok = [np.allclose(U[:, :2] @ np.diag(S) @ Vt, A), np.allclose(U.T @ U, np.eye(3)), np.allclose(Uf @ np.diag(Sf) @ Vtf, A), np.allclose(W @ np.diag(Sw) @ Vw[:2], A.T), np.allclose(Vw @ Vw.T, np.eye(3))]',
            'shapes = [U.shape, Vt.shape, Uf.shape, Vw.shape]',
            'x, res, rank, s = np.linalg.lstsq(A, np.array([1.0, 2.0, 3.0]), rcond=None)',
            'p = np.linalg.pinv(A) @ np.array([1.0, 2.0, 3.0])',
            'r1 = np.linalg.matrix_rank(np.array([[1.0, 2.0], [2.0, 4.0]]))',
            'only = np.linalg.svd(A, compute_uv=False)',
        ].join('\n')
    );
    const g = (n: string) => r.globals.get(n);
    assert.equal(JSON.stringify(g('ok')), JSON.stringify([true, true, true, true, true]));
    // x solves the normal equations: A^T A x = A^T b.
    const x = g('x') as { data: Float64Array };
    near(x.data[0], -1 / 13, 1e-12);
    near(x.data[1], 25 / 26, 1e-12);
    near((g('p') as { data: Float64Array }).data[1], 25 / 26, 1e-12);
    assert.equal(g('rank'), 2);
    assert.equal(g('r1'), 1);
    const s = (g('only') as { data: Float64Array }).data;
    near(s[0] * s[0] + s[1] * s[1], 9 + 1 + 1 + 9 + 4, 1e-9);
    assert.ok(s[0] >= s[1]);
    // The direct call: a wide matrix goes through its transpose.
    const w = svd(2, 3, Float64Array.from([1, 0, 2, 0, 3, 0]));
    assert.equal(w.k, 2);
    near(w.s[0], 3, 1e-12);
    near(w.s[1], Math.sqrt(5), 1e-12);
});

test('np.cov, np.corrcoef (rows are variables unless rowvar=False), logaddexp, bincount, multivariate_normal', () => {
    const out = printed(
        [
            'import numpy as np',
            'X = np.array([[0.0, 1.0, 2.0], [2.0, 1.0, 0.0]])',
            'print(np.cov(X).tolist(), np.corrcoef(X)[0, 1])',
            'print(np.cov(np.array([[1.0, 2.0], [2.0, 3.0], [3.0, 5.0]]), rowvar=False).round(4).tolist())',
            'print(np.cov([1.0, 2.0, 3.0], bias=True))',
            'print(np.logaddexp(0.0, 0.0), np.logaddexp(1000.0, 1000.0) > 1000, np.bincount(np.array([0, 1, 1, 3])).tolist())',
            'np.random.seed(0)',
            'P = np.random.multivariate_normal([1.0, -1.0], [[1.0, 0.8], [0.8, 1.0]], 4000)',
            'print(P.shape, np.round(P.mean(axis=0), 1).tolist(), np.round(np.corrcoef(P.T)[0, 1], 1))',
        ].join('\n')
    );
    assert.equal(out[0], '[[1, -1], [-1, 1]] -1');
    assert.equal(out[1], '[[1, 1.5], [1.5, 2.3333]]');
    assert.equal(out[2], '0.6666666666666666');
    assert.equal(out[3], '0.6931471805599453 True [1, 2, 0, 1]');
    assert.equal(out[4], '(4000, 2) [1, -1] 0.8');
});

test('contourf: bands between round levels as a picture; contour levels, colours, negative levels dashed', () => {
    const text = [
        'show x from -2 to 2 and y from -2 to 2',
        py(
            'import numpy as np',
            'import matplotlib.pyplot as plt',
            'X, Y = np.meshgrid(np.linspace(-2, 2, 41), np.linspace(-2, 2, 41))',
            'Z = X**2 + Y**2',
            'plt.contourf(X, Y, Z, levels=[0, 1, 2, 4, 8], cmap="viridis")',
            'plt.contour(X, Y, Z - 2, levels=[-1, 0, 1], colors="black")',
            'plt.colorbar()'
        ),
    ].join('\n');
    const scene = sceneOf(text);
    assert.deepEqual(scene.issues, []);
    const it = scene.items[0];
    assert.equal(it.pixels?.length, 1);
    const inner = pixelAt(it, 0.1, 0.1);
    const ring = pixelAt(it, 1.2, 0);
    const outer = pixelAt(it, 1.9, 1.9);
    assert.equal(inner[3], 255);
    assert.notDeepEqual(inner.slice(0, 3), ring.slice(0, 3));
    assert.notDeepEqual(ring.slice(0, 3), outer.slice(0, 3));
    // Bands of the same level are one colour.
    assert.deepEqual(pixelAt(it, 0, 1.2), ring);
    // The black contours: 3 levels, the negative one dashed.
    const lines = it.strokes.filter((s) => s.color === 'black');
    assert.ok(lines.some((s) => s.dashed) && lines.some((s) => !s.dashed));
    // The export draws the picture (a PNG).
    assert.match(settingsOf(text).generateTikzCode(), /\] graphics\[/);
});

test('hist: (n, bins, patches), range, weights, density, step outline, bins "auto"', () => {
    const r = run(
        [
            'import numpy as np',
            'import matplotlib.pyplot as plt',
            'n, bins, patches = plt.hist([1, 2, 2, 3, 3, 3], bins=3, range=(0.5, 3.5))',
            'w, _, _ = plt.hist([1, 2], bins=2, weights=[0.5, 2.0])',
            'd, e, _ = plt.hist(np.arange(10), bins=5, density=True)',
            's, _, _ = plt.hist([1, 2, 3], histtype="step", label="steps")',
            'a, _, _ = plt.hist(np.random.randn(500), bins="auto")',
        ].join('\n')
    );
    const arr = (n: string) => Array.from((r.globals.get(n) as { data: Float64Array }).data);
    assert.deepEqual(arr('n'), [1, 2, 3]);
    assert.deepEqual(arr('bins'), [0.5, 1.5, 2.5, 3.5]);
    assert.deepEqual(arr('w'), [0.5, 2]);
    near(arr('d').reduce((p, v, i) => p + v * (arr('e')[i + 1] - arr('e')[i]), 0), 1, 1e-12);
    assert.ok(arr('a').length >= 9);
    const step = r.figure.draws.find((d) => d.k === 'line' && d.label === 'steps');
    assert.ok(step, 'histtype step is one line');
});

test('scatter s is matplotlib\'s area in points^2; markersize a diameter; the export sizes the dots', () => {
    const text = ['show x from 0 to 4 and y from 0 to 4', py('import matplotlib.pyplot as plt', 'plt.scatter([1], [1], s=36)', 'plt.scatter([2], [2], s=144)', 'plt.scatter([3, 3.5], [3, 3], s=[4, 100])', 'plt.plot([1, 2], [3, 3], "o", markersize=10)')].join('\n');
    const it = sceneOf(text).items[0];
    assert.deepEqual(it.markers.map((m) => m.radius), [3, 6, 1, 5, 5, 5]);
    const tikz = settingsOf(text).generateTikzCode();
    assert.match(tikz, /mark size=2pt/);
    assert.match(tikz, /mark size=4pt/);
});

test('colours: successive lines take C0, C1, ... (frame(t) goes on with the cycle); named shades stay apart', () => {
    const text = [
        'show x from 0 to 4 and y from 0 to 4',
        py(
            'import matplotlib.pyplot as plt',
            'plt.plot([0, 1], [0, 1], label="a")',
            'plt.plot([0, 1], [1, 2], label="b")',
            'plt.plot([0, 1], [2, 3], color="crimson", label="c")',
            'plt.plot([0, 1], [3, 4], color="darkred", label="d")',
            'plt.legend(loc="upper left")',
            'def frame(t):',
            '    plt.plot([2, 3], [0, 1])'
        ),
    ].join('\n');
    const scene = sceneOf(text);
    const it = scene.items[0];
    const own = it.strokes.filter((s) => !s.still && s.lines[0].length === 2 && s.lines[0][0].x === 0);
    assert.deepEqual(own.map((s) => s.color), ['blue', 'orange', '#dc143c', '#8b0000']);
    // The frame's line is C2 (green), not blue again.
    assert.equal(it.live?.[0].at?.(0).lines[0].color, 'green');
    // loc='upper left': the key's texts on the left half.
    const keys = it.texts.filter((t) => ['a', 'b', 'c', 'd'].includes(t.text));
    assert.equal(keys.length, 4);
    assert.ok(keys.every((t) => t.x < 2 && t.y > 2), JSON.stringify(keys));
});

test('imshow: origin="lower" puts row 0 at the bottom (and the default extent follows it); bilinear blends', () => {
    const at = (origin: string, extent: string) => {
        const it = sceneOf(['show x from 0 to 2 and y from 0 to 2', py('import matplotlib.pyplot as plt', `plt.imshow([[0, 0], [1, 1]]${extent}, origin="${origin}", cmap="gray")`)].join('\n')).items[0];
        return { top: pixelAt(it, 1, 1.5)[0], bottom: pixelAt(it, 1, 0.5)[0] };
    };
    assert.deepEqual(at('upper', ', extent=(0, 2, 0, 2)'), { top: 0, bottom: 255 });
    assert.deepEqual(at('lower', ', extent=(0, 2, 0, 2)'), { top: 255, bottom: 0 });
    // Without an extent: row 0 at y = 0 with origin='lower' (centres at 0 and 1).
    const it = sceneOf(['show x from -0.5 to 1.5 and y from -0.5 to 1.5', py('import matplotlib.pyplot as plt', 'plt.imshow([[0, 0], [1, 1]], origin="lower", cmap="gray")')].join('\n')).items[0];
    assert.equal(pixelAt(it, 0.5, 0)[0], 0);
    assert.equal(pixelAt(it, 0.5, 1)[0], 255);
    const smooth = sceneOf(['show x from 0 to 2 and y from 0 to 2', py('import matplotlib.pyplot as plt', 'plt.imshow([[0, 0], [1, 1]], extent=(0, 2, 0, 2), origin="lower", cmap="gray", interpolation="bilinear")')].join('\n')).items[0];
    const mid = pixelAt(smooth, 1, 1)[0];
    assert.ok(mid > 100 && mid < 155, String(mid));
});

const NETWORK = [
    'show x from -2 to 2 and y from -2 to 2',
    'equal scale',
    py(
        'import numpy as np',
        'import matplotlib.pyplot as plt',
        'GX, GY = np.meshgrid(np.linspace(-2, 2, 50), np.linspace(-2, 2, 50))',
        'snaps = [1 / (1 + np.exp(-(GX * GY * k))) for k in range(8)]',
        'def frame(t):',
        '    k = int(t * 3) % len(snaps)',
        '    plt.imshow(snaps[k], extent=(-2, 2, -2, 2), cmap="cool", origin="lower", alpha=0.5)',
        '    plt.scatter([-1, 1], [-1, 1], color="red", s=30, label="class 1")',
        '    plt.legend()',
        '    plt.title(f"training step {k * 60}")',
        '    plt.text(-1.8, -1.8, f"k = {k}")'
    ),
].join('\n');

test('frame(t): imshow on the live canvas, one picture per snapshot (the same key again), the title of each frame', () => {
    const scene = sceneOf(NETWORK);
    assert.deepEqual(scene.issues, []);
    const it = scene.items[0];
    const live = it.live?.[0].at;
    assert.ok(live);
    const a = live(0);
    const b = live(1);
    const c = live(1 + 8 / 3);
    assert.equal(a.title, 'training step 0');
    assert.equal(b.title, 'training step 180');
    assert.equal(a.images?.length, 1);
    assert.notEqual(a.images?.[0].key, b.images?.[0].key);
    // The same snapshot later: the same key, so the canvas draws the picture it keeps.
    assert.equal(c.images?.[0].key, b.images?.[0].key);
    const img = a.images?.[0];
    assert.ok(img);
    assert.deepEqual([img.w, img.h, img.x0, img.x1, img.y0, img.y1, img.opacity, img.smooth], [50, 50, -2, 2, -2, 2, 0.5, false]);
    assert.equal(img.rgba().length, 50 * 50 * 4);
    // The legend and the text of the frame are on the live canvas too.
    assert.ok(a.texts?.some((t) => t.text === 'class 1' && t.halo));
    assert.ok(a.texts?.some((t) => t.text === 'k = 0'));
    assert.ok(a.dots.some((d) => d.radius !== undefined));
});

test('frame(t): the chart\'s title is the still frame\'s; the still frame keeps its picture and texts for the export', () => {
    const settings = settingsOf(NETWORK);
    const math = settings.createMathContext();
    assert.equal(settings.toRendererConfig(math).title, 'training step 0');
    const it = sceneOf(NETWORK).items[0];
    assert.equal(it.pixels?.length, 1);
    assert.equal(it.pixels?.[0].still, true);
    assert.ok(it.texts.some((t) => t.still && t.text === 'k = 0'));
    assert.ok(it.texts.some((t) => t.still && t.text === 'class 1'));
    const tikz = settings.generateTikzCode();
    assert.match(tikz, /title=\{training step 0\}/);
    assert.match(tikz, /\] graphics\[/);
    assert.match(tikz, /k = 0/);
    // The still time of the chart picks the frame.
    const later = settingsOf(`set stillTime = 1\n${NETWORK}`);
    assert.equal(later.toRendererConfig(later.createMathContext()).title, 'training step 180');
});

test('speed: a frame with a 50 x 50 picture and 100 dots takes a few ms (the picture is made once per snapshot)', () => {
    const it = sceneOf(NETWORK).items[0];
    const live = it.live?.[0].at;
    assert.ok(live);
    let worst = 0;
    const made = new Set<string>();
    for (let k = 0; k < 180; k++) {
        const t0 = performance.now();
        const s = live(k / 60);
        for (const img of s.images ?? []) {
            if (!made.has(img.key)) {
                made.add(img.key);
                img.rgba();
            }
        }
        if (k > 5) worst = Math.max(worst, performance.now() - t0);
    }
    console.log(`    speed: frame(t) with a 50 x 50 picture, worst ${worst.toFixed(2)} ms of 175 frames; ${made.size} pictures made`);
    assert.equal(made.size, 8);
    assert.ok(worst < 40, `${worst} ms`);
});

test('a draw of every kind still lists as before (the Draw union holds bands)', () => {
    const r = run(['import numpy as np', 'import matplotlib.pyplot as plt', 'plt.contourf(np.array([[0.0, 1.0], [2.0, 3.0]]))'].join('\n'));
    const kinds = r.figure.draws.map((d: Draw) => d.k);
    assert.deepEqual(kinds, ['bands']);
});
