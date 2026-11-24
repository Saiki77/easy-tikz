/*
 * Python in a chart (6.0 P), the NumPy subset: arrays, broadcasting,
 * complex arrays, masks and fancy indexing, reductions along axes, shapes,
 * linalg, the FFT against known values (and a plain DFT), seeded random,
 * and how fast the scripts of the spec run.
 */
import { test, assert, near } from './_lib';
import { Program } from '../src/python/program';
import { NDArray, repr } from '../src/python/values';
import type { PyValue } from '../src/python/values';
import { dft } from '../src/python/numpy';

function value(code: string, name = 'r', inputs: Record<string, number> = {}): PyValue {
    const r = new Program([`import numpy as np\n${code}`]).run(inputs);
    if (r.error) throw new Error(`${r.error.kind} at ${r.error.line - 1}:${r.error.col}: ${r.error.message}`);
    const v = r.globals.get(name);
    if (v === undefined) throw new Error(`no ${name}`);
    return v;
}

const rep = (code: string, name = 'r') => repr(value(code, name));

function arr(v: PyValue): number[] {
    assert.ok(v instanceof NDArray, `not an array: ${repr(v)}`);
    return Array.from((v as NDArray).data);
}

test('making arrays', () => {
    assert.equal(rep('r = np.array([1, 2, 3])'), 'array([1, 2, 3])');
    assert.equal(rep('r = np.array([[1.5, 2], [3, 4]])'), 'array([[1.5, 2. ],\n       [3. , 4. ]])');
    assert.deepEqual(arr(value('r = np.linspace(0, 1, 5)')), [0, 0.25, 0.5, 0.75, 1]);
    assert.deepEqual(arr(value('r = np.linspace(0, 1, 4, endpoint=False)')), [0, 0.25, 0.5, 0.75]);
    assert.deepEqual(arr(value('r = np.arange(0, 1, 0.25)')), [0, 0.25, 0.5, 0.75]);
    assert.equal(rep('r = np.arange(5)'), 'array([0, 1, 2, 3, 4])');
    assert.equal(rep('r = np.zeros((2, 3)).shape'), '(2, 3)');
    assert.deepEqual(arr(value('r = np.full(3, 7.0)')), [7, 7, 7]);
    assert.equal(rep('X, Y = np.meshgrid(np.arange(3), np.arange(2))\nr = X.shape, X[1].tolist(), Y[1].tolist()'), '((2, 3), [0, 1, 2], [1, 1, 1])');
    assert.equal(rep('r = np.eye(2).tolist()'), '[[1, 0], [0, 1]]');
});

test('broadcasting and element-wise operators', () => {
    assert.deepEqual(arr(value('r = np.array([1, 2, 3]) * 2 + 1')), [3, 5, 7]);
    assert.deepEqual(arr(value('r = np.array([[1], [2]]) + np.array([10, 20, 30])')), [11, 21, 31, 12, 22, 32]);
    assert.equal(rep('r = (np.arange(4).reshape(2, 2) ** 2).tolist()'), '[[0, 1], [4, 9]]');
    assert.deepEqual(arr(value('r = np.array([1.0, 4.0]) / np.array([2, 8])')), [0.5, 0.5]);
    assert.deepEqual(arr(value('r = -np.arange(3)')), [-0, -1, -2]);
    assert.deepEqual(arr(value('r = np.arange(6) % 4 // 2')), [0, 0, 1, 1, 0, 0]);
    assert.deepEqual(arr(value('a = np.ones(3)\na += 2\nr = a')), [3, 3, 3]);
    assert.deepEqual(arr(value('r = [1, 2] + np.array([3, 4])')), [4, 6]);
});

test('complex arrays', () => {
    const z = value('r = np.exp(1j * np.pi * np.array([0, 0.5, 1]))') as NDArray;
    assert.equal(z.dtype, 'complex');
    near(z.data[0], 1, 1e-12);
    near(z.imag?.[1] ?? 0, 1, 1e-12);
    near(z.data[2], -1, 1e-12);
    assert.deepEqual(arr(value('r = np.abs(np.array([3 + 4j, 1j]))')), [5, 1]);
    near(arr(value('r = np.angle(np.array([1j, -1]))'))[0], Math.PI / 2, 1e-12);
    assert.equal(rep('z = np.array([1 + 2j, 3 - 1j])\nr = np.real(z).tolist(), z.imag.tolist(), np.conj(z)[0]'), '([1, 3], [2, -1], (1-2j))');
    near(value('r = np.sqrt(np.array([-4 + 0j]))[0].imag') as number, 2, 1e-12);
});

test('masks, where, fancy indexing, slices of 2D arrays', () => {
    assert.deepEqual(arr(value('a = np.arange(6)\nr = a[a % 2 == 0]')), [0, 2, 4]);
    assert.deepEqual(arr(value('a = np.arange(6.0)\na[a > 3] = 0\nr = a')), [0, 1, 2, 3, 0, 0]);
    assert.deepEqual(arr(value('r = np.where(np.arange(4) > 1, 1, -1)')), [-1, -1, 1, 1]);
    assert.deepEqual(arr(value('a = np.arange(10, 20)\nr = a[[0, 2, -1]]')), [10, 12, 19]);
    const m = 'm = np.arange(12).reshape(3, 4)\n';
    assert.deepEqual(arr(value(`${m}r = m[:, 1]`)), [1, 5, 9]);
    assert.deepEqual(arr(value(`${m}r = m[1]`)), [4, 5, 6, 7]);
    assert.equal(value(`${m}r = m[2, 3]`), 11);
    assert.deepEqual(arr(value(`${m}r = m[1:, ::2]`)), [4, 6, 8, 10]);
    assert.deepEqual(arr(value(`${m}r = m[-1, -2:]`)), [10, 11]);
    assert.equal(rep(`${m}r = m[:, None, 0].shape`), '(3, 1)');
    assert.deepEqual(arr(value(`${m}m[0, :] = 99\nr = m[0]`)), [99, 99, 99, 99]);
    assert.equal(rep('a = np.arange(5)\nr = len(a), list(a[:2]), a.size, a.ndim'), '(5, [0, 1], 5, 1)');
});

test('reductions along an axis', () => {
    const m = 'm = np.arange(6).reshape(2, 3)\n';
    assert.equal(value(`${m}r = m.sum()`), 15);
    assert.deepEqual(arr(value(`${m}r = m.sum(axis=0)`)), [3, 5, 7]);
    assert.deepEqual(arr(value(`${m}r = np.mean(m, axis=1)`)), [1, 4]);
    assert.deepEqual(arr(value(`${m}r = m.max(axis=1)`)), [2, 5]);
    assert.equal(value(`${m}r = int(np.argmax(m))`), 5);
    near(value('r = np.std(np.array([1, 2, 3, 4]))') as number, Math.sqrt(1.25), 1e-12);
    near(value('r = np.array([1, 2, 3, 4]).std(ddof=1)') as number, Math.sqrt(5 / 3), 1e-12);
    assert.deepEqual(arr(value('r = np.cumsum(np.arange(1, 5))')), [1, 3, 6, 10]);
    assert.deepEqual(arr(value('r = np.diff(np.array([1, 4, 9, 16]))')), [3, 5, 7]);
    assert.equal(rep('r = np.any(np.array([0, 0, 1])), np.all(np.array([1, 0]))'), '(True, False)');
});

test('shapes: reshape, transpose, stack, concatenate', () => {
    assert.equal(rep('r = np.arange(6).reshape(2, -1).T.tolist()'), '[[0, 3], [1, 4], [2, 5]]');
    assert.equal(rep('r = np.concatenate([np.arange(2), np.arange(3)]).tolist()'), '[0, 1, 0, 1, 2]');
    assert.equal(rep('r = np.stack([np.arange(2), np.arange(2) + 5]).tolist()'), '[[0, 1], [5, 6]]');
    assert.equal(rep('r = np.stack([np.arange(2), np.arange(2) + 5], axis=1).tolist()'), '[[0, 5], [1, 6]]');
    assert.equal(rep('r = np.column_stack([np.arange(2), np.arange(2) + 5]).shape'), '(2, 2)');
    assert.equal(rep('r = np.vstack([np.arange(3), np.arange(3)]).shape'), '(2, 3)');
    assert.equal(rep('r = np.arange(6).reshape(2, 3).flatten().tolist()'), '[0, 1, 2, 3, 4, 5]');
});

test('products: dot, @, outer', () => {
    assert.equal(rep('A = np.array([[1, 2], [3, 4]])\nr = (A @ A).tolist(), A @ np.array([1, 1]), np.dot([1, 2], [3, 4])'), '([[7, 10], [15, 22]], array([3, 7]), 11)');
    assert.equal(rep('r = np.outer([1, 2], [1, 10]).tolist()'), '[[1, 10], [2, 20]]');
});

test('linalg: det, inv, solve, eig, norm', () => {
    near(value('r = np.linalg.det(np.array([[1, 2], [3, 4]]))') as number, -2, 1e-12);
    const inv = arr(value('r = np.linalg.inv(np.array([[4, 7], [2, 6]]))'));
    [0.6, -0.7, -0.2, 0.4].forEach((v, i) => near(inv[i], v, 1e-12));
    const x = arr(value('r = np.linalg.solve(np.array([[3, 1], [1, 2]]), np.array([9, 8]))'));
    near(x[0], 2, 1e-12);
    near(x[1], 3, 1e-12);
    const vals = arr(value('w, v = np.linalg.eig(np.array([[2, 0], [0, 3]]))\nr = w'));
    assert.deepEqual(vals.slice().sort(), [2, 3]);
    // A rotation: eigenvalues +-i.
    const rot = value('r = np.linalg.eig(np.array([[0, -1], [1, 0]]))[0]') as NDArray;
    assert.equal(rot.dtype, 'complex');
    const ims = Array.from(rot.imag ?? []).sort();
    near(ims[0], -1, 1e-9);
    near(ims[1], 1, 1e-9);
    // A general 3 x 3: A v = w v for every pair.
    const ok = value(`
A = np.array([[2.0, 1, 0], [1, 3, 1], [0, 1, 4]]) + np.array([[0, 0.5, 0], [0, 0, 0], [0.2, 0, 0]])
w, V = np.linalg.eig(A)
r = max(abs(A @ V[:, k] - w[k] * V[:, k]).max() for k in range(3))`) as number;
    assert.ok(ok < 1e-8, `residual ${ok}`);
    near(value('r = np.linalg.norm(np.array([3, 4]))') as number, 5, 1e-12);
    assert.deepEqual(arr(value('r = np.linalg.norm(np.array([[3, 4], [6, 8]]), axis=1)')), [5, 10]);
});

test('the FFT against known values', () => {
    // fft of [1, 2, 3, 4]: [10, -2+2j, -2, -2-2j].
    assert.equal(rep('r = np.fft.fft(np.array([1, 2, 3, 4]))'), 'array([10.+0.j, -2.+2.j, -2.+0.j, -2.-2.j])');
    const back = arr(value('r = np.fft.ifft(np.fft.fft(np.array([1.0, 2, 3, 4, 5]))).real'));
    [1, 2, 3, 4, 5].forEach((v, i) => near(back[i], v, 1e-12));
    assert.deepEqual(arr(value('r = np.fft.fftfreq(5)')), [0, 0.2, 0.4, -0.4, -0.2]);
    assert.deepEqual(arr(value('r = np.fft.fftfreq(4, d=0.5)')), [0, 0.5, -1, -0.5]);
    assert.deepEqual(arr(value('r = np.fft.fftshift(np.arange(5))')), [3, 4, 0, 1, 2]);
    // A pure tone: one coefficient.
    const tone = value('t = np.linspace(0, 2 * np.pi, 8, endpoint=False)\nr = np.fft.fft(np.exp(3j * t)) / 8') as NDArray;
    near(tone.data[3], 1, 1e-12);
    near(Math.hypot(tone.data[0], tone.imag?.[0] ?? 0), 0, 1e-12);
    // Bluestein (length 12 and 7) against a plain DFT.
    for (const n of [7, 12, 30]) {
        const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 1.3) + i * 0.1);
        const im = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 0.7));
        const [fr, fi] = dft(re, im, false);
        for (let k = 0; k < n; k++) {
            let sr = 0;
            let si = 0;
            for (let j = 0; j < n; j++) {
                const a = (-2 * Math.PI * j * k) / n;
                sr += re[j] * Math.cos(a) - im[j] * Math.sin(a);
                si += re[j] * Math.sin(a) + im[j] * Math.cos(a);
            }
            near(fr[k], sr, 1e-9, `n=${n} k=${k} re`);
            near(fi[k], si, 1e-9, `n=${n} k=${k} im`);
        }
    }
});

test('seeded random: the same numbers every run', () => {
    const a = arr(value('np.random.seed(3)\nr = np.random.rand(4)'));
    const b = arr(value('np.random.seed(3)\nr = np.random.rand(4)'));
    assert.deepEqual(a, b);
    assert.ok(a.every((v) => v >= 0 && v < 1));
    const n = arr(value('r = np.random.randn(2000)'));
    const mean = n.reduce((s, v) => s + v, 0) / n.length;
    assert.ok(Math.abs(mean) < 0.1, `mean ${mean}`);
    const ints = arr(value('r = np.random.randint(0, 5, size=50)'));
    assert.ok(ints.every((v) => Number.isInteger(v) && v >= 0 && v < 5));
    assert.equal(rep('rng = np.random.default_rng(1)\nr = rng.normal(size=3).shape'), '(3,)');
    const c = value('r = np.random.choice([1, 2, 3])');
    assert.ok([1, 2, 3].includes(c as number));
    // Without a seed every run starts from seed 0.
    assert.deepEqual(arr(value('r = np.random.rand(3)')), arr(value('r = np.random.rand(3)')));
});

test('errors of arrays', () => {
    const r = new Program(['import numpy as np\na = np.ones(3) + np.ones(4)\n']).run({});
    assert.equal(r.error?.kind, 'ValueError');
    assert.match(r.error?.message ?? '', /broadcast/);
    const t = new Program(['import numpy as np\nif np.array([1, 2]) > 0:\n    pass\n']).run({});
    assert.equal(t.error?.kind, 'ValueError');
    assert.match(t.error?.message ?? '', /any\(\)/);
});

test('speed: the heart FFT and a 200 point plot', () => {
    const heart = `import numpy as np
t = np.linspace(0, 2*np.pi, 256, endpoint=False)
heart = 16*np.sin(t)**3 + 1j*(13*np.cos(t) - 5*np.cos(2*t) - 2*np.cos(3*t) - np.cos(4*t))
c = np.fft.fft(heart) / len(heart)
`;
    const plot = `import numpy as np
import matplotlib.pyplot as plt
x = np.linspace(-3, 3, 200)
for k in range(1, 6):
    plt.plot(x, np.sin(k * x + a) / k, label=f"k = {k}")
plt.legend()
`;
    const time = (code: string, inputs: Record<string, number>) => {
        const p = new Program([code]);
        let worst = 0;
        // Fresh inputs each run, so the cache does not answer.
        for (let i = 0; i < 30; i++) {
            const t0 = performance.now();
            const r = p.run({ ...inputs, a: i * 0.01 });
            worst = Math.max(worst, performance.now() - t0);
            assert.equal(r.error, null);
        }
        return worst;
    };
    const tHeart = time(heart, {});
    const tPlot = time(plot, {});
    console.log(`    speed: heart FFT worst ${tHeart.toFixed(2)} ms, 200-point plot (5 curves) worst ${tPlot.toFixed(2)} ms`);
    assert.ok(tHeart < 30, `heart ${tHeart} ms`);
    assert.ok(tPlot < 30, `plot ${tPlot} ms`);
    // frame(t): one call per frame of the clock (three 300-point curves).
    const wave = new Program(['import numpy as np\nimport matplotlib.pyplot as plt\nx = np.linspace(0, 4 * np.pi, 300)\ndef frame(t):\n    a = np.sin(x - 2 * t)\n    b = np.sin(1.2 * x + t)\n    plt.plot(x, a, color="C0")\n    plt.plot(x, b, color="C3")\n    plt.plot(x, a + b, color="C4")']).run({});
    let tFrame = 0;
    for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        const f = wave.frameAt(i / 60);
        tFrame = Math.max(tFrame, performance.now() - t0);
        assert.equal(f.figure.draws.length, 3);
    }
    console.log(`    speed: frame(t) of three 300-point waves worst ${tFrame.toFixed(2)} ms`);
    assert.ok(tFrame < 16, `frame ${tFrame} ms`);
    // The cache: the same inputs do not run again.
    const p = new Program([plot]);
    const a = p.run({ a: 1 });
    assert.equal(p.run({ a: 1 }), a);
});
