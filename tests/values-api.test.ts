/*
 * Values (6.0 A), the API for parts D and E: compile to a value, recurrence
 * steps (with and without objects), GLSL, the numeric gradient, eigenvalues
 * and eigenvectors, the determinant and the inverse.
 */
import { test, assert, near } from './_lib';
import { MathContext } from '../src/mathcontext';
import { ExprError } from '../src/expr';
import { compileComplex, compileRecurrence, compileValue, det, eigen, gradient, inverse, letValue, mat, readRecurrence, toGlsl, GLSL_COMPLEX, Complex, Vec, complex } from '../src/values';

function ctxOf(values: Array<{ name: string; params?: string[]; expression: string }>, sliders: Record<string, number> = {}): MathContext {
    return new MathContext({
        parameters: Object.entries(sliders).map(([name, value]) => ({ name, value, min: -10, max: 10, step: 0.1 })),
        values: values.map((v) => ({ name: v.name, params: v.params ?? [], expression: v.expression })),
    });
}

test('compile to a value, with inputs of any shape', () => {
    const ctx = ctxOf([{ name: 'A', expression: '[[0, -1], [1, 0]]' }]);
    const f = compileValue(ctx, 'A p', ['p']);
    assert.deepEqual(f.run({ kind: 'vec', v: [2, 1] }), { kind: 'vec', v: [-1, 2] });
    const g = compileValue(ctx, '\\det A + 1');
    assert.equal(g.run(), 2);
    assert.equal(g.shape.k, 'num');
    assert.deepEqual(letValue(ctx, 'A'), mat(2, 2, [0, -1, 1, 0]));
    assert.throws(() => compileValue(ctx, 'A + 1'), ExprError);
});

test('a recurrence step: complex, real and vector states', () => {
    const rec = readRecurrence('z_{n+1} = z_n^2 + c');
    assert.deepEqual(rec, { state: 'z', index: 'n', current: 'z_n', formula: 'z_n^2 + c' });
    const ctx = ctxOf([{ name: 'f', params: ['x', 'y'], expression: 'x^2 + 4y^2' }], { eta: 0.1 });
    const mandel = compileRecurrence(ctx, 'z_{n+1} = z_n^2 + c', ['c']);
    const c = complex(-0.8, 0.156);
    let z: Complex | number = 0;
    for (let k = 0; k < 3; k++) z = mandel.step(z, c) as Complex;
    // The same three steps without objects.
    assert.ok(mandel.complex);
    const inp = new Float64Array([0, 0, c.re, c.im]);
    const out = new Float64Array(2);
    for (let k = 0; k < 3; k++) {
        mandel.complex.run(inp, out);
        inp[0] = out[0];
        inp[1] = out[1];
    }
    near(out[0], (z as Complex).re, 1e-12);
    near(out[1], (z as Complex).im, 1e-12);
    const logistic = compileRecurrence(ctx, 'x_{n+1} = r x_n (1 - x_n)', ['r']);
    near(logistic.step(0.5, 3) as number, 0.75, 1e-15);
    const descent = compileRecurrence(ctx, 'p_{n+1} = p_n - \\eta \\nabla f(p_n)');
    const p = descent.step({ kind: 'vec', v: [1, 1] }) as Vec;
    near(p.v[0], 1 - 0.1 * 2, 1e-6);
    near(p.v[1], 1 - 0.1 * 8, 1e-6);
    assert.equal(descent.complex, null);
});

test('the fast complex form of z^2 + c and of e^{iz}', () => {
    const ctx = ctxOf([]);
    const f = compileComplex(ctx, 'e^{i z}', ['z']);
    const out = new Float64Array(2);
    f.run(new Float64Array([Math.PI, 0]), out);
    near(out[0], -1, 1e-12);
    near(out[1], 0, 1e-12);
});

test('GLSL for complex formulas, sliders as uniforms', () => {
    const ctx = ctxOf([{ name: 'c', expression: '-0.8 + 0.156i' }], { a: 2 });
    const g = toGlsl(ctx, 'z^2 + c + a', { inputs: { z: { glsl: 'z', complex: true } } });
    assert.equal(g.complex, true);
    assert.equal(g.code, '((c_mul(z, z) + vec2((-0.8), 0.156)) + vec2(u_a, 0.0))');
    assert.deepEqual(g.uniforms.map((u) => [u.uniform, u.read()]), [['u_a', 2]]);
    const r = toGlsl(ctx, '|z|^2', { inputs: { z: { glsl: 'z', complex: true } }, sliders: 'number' });
    assert.equal(r.code, '(length(z) * length(z))');
    assert.ok(GLSL_COMPLEX.includes('vec2 c_mul(vec2 a, vec2 b)'));
});

test('the gradient of a let function', () => {
    const ctx = ctxOf([{ name: 'f', params: ['x', 'y'], expression: 'x^2 + 4y^2' }]);
    const g = gradient(ctx, 'f', [1, -2]);
    assert.ok(g);
    near(g[0], 2, 1e-6);
    near(g[1], -16, 1e-6);
    assert.equal(gradient(ctx, 'nothing', [1]), null);
});

test('eigenvalues and eigenvectors, the determinant and the inverse', () => {
    const e = eigen(mat(2, 2, [2, 1, 1, 2]));
    assert.deepEqual(e.map((p) => p.value), [3, 1]);
    near(e[0].vector?.[0] ?? 0, Math.SQRT1_2, 1e-12);
    near(e[1].vector?.[1] ?? 0, -Math.SQRT1_2, 1e-12);
    const rot = eigen(mat(2, 2, [0, -1, 1, 0]));
    assert.deepEqual(rot.map((p) => p.value), [complex(0, 1), complex(0, -1)]);
    const three = eigen(mat(3, 3, [2, 0, 0, 0, 3, 4, 0, 4, 9]));
    assert.deepEqual(three.map((p) => Math.round((p.value as number) * 1e9) / 1e9), [11, 2, 1]);
    assert.equal(det(mat(3, 3, [2, 0, 0, 0, 3, 4, 0, 4, 9])), 22);
    assert.deepEqual(inverse(mat(2, 2, [1.5, 1, 0.5, 2]))?.a.map((x) => Math.round(x * 1e12) / 1e12), [0.8, -0.4, -0.2, 0.6]);
    assert.equal(inverse(mat(2, 2, [1, 2, 2, 4])), null);
    assert.equal(eigen(mat(3, 3, [1, 0, 0, 0, 1, 0, 0, 0, 1])).length, 3);
});
