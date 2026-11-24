/*
 * Values (6.0 A), the engine: LaTeX read as values, sums, products,
 * factorials and binomials in every formula, the typed compiler (complex
 * numbers, vectors, matrices, lists, let definitions) with its shapes and
 * problems, and the export of these formulas.
 */
import { test, assert, near } from './_lib';
import { latexToPlain } from '../src/latex';
import { MathContext } from '../src/mathcontext';
import { Parameter } from '../src/types';
import { ValueDefinition } from '../src/values/table';
import { formatValue } from '../src/values/format';

function slider(name: string, value: number): Parameter {
    return { name, value, min: -10, max: 10, step: 0.1 };
}

function ctxOf(values: ValueDefinition[], parameters: Parameter[] = [], functions: Array<{ name: string; expression: string }> = []): MathContext {
    return new MathContext({
        parameters,
        values,
        functions: functions.map((f) => ({ ...f, domain: '', showLegend: false, fill: false, fillOpacity: 0.3, fillPattern: 'solid', tangent: false, color: 'blue', dashed: false, tangentPoint: '', extrema: false, thickness: 'thin', parametric: false, expressionY: '' })),
    });
}

const let_ = (name: string, expression: string, params: string[] = []): ValueDefinition => ({ name, params, expression });

test('LaTeX of values reads as the plain syntax', () => {
    assert.equal(latexToPlain('\\begin{pmatrix} -1 \\\\ 2 \\end{pmatrix}'), '(-1, 2)');
    assert.equal(latexToPlain('\\begin{pmatrix} 1.5 & 1 \\\\ 0.5 & 2 \\end{pmatrix}'), '[[1.5, 1], [0.5, 2]]');
    assert.equal(latexToPlain('\\binom{n}{k}'), 'binom((n), (k))');
    assert.match(latexToPlain('\\sum_{k=1}^{n} k^2 + 1'), /^sum\(\(k\^2\), k, \(1\), \(n\)\) \+ 1$/);
    assert.match(latexToPlain('\\{(k, k^2) : k = 1, \\dots, 10\\}'), /^\[\(\(k, k\^2\)\) : k = \(1\)\.\.\(10\)\]$/);
    assert.equal(latexToPlain('\\bar z'), 'conj(z)');
    assert.match(latexToPlain('\\nabla f(p_n)'), /^grad\(f, p_n\)$/);
    assert.match(latexToPlain('\\operatorname{tr} A'), /^tr\(A\)$/);
    assert.match(latexToPlain('\\Re z + \\Im z'), /^re\(z\) \+ im\(z\)$/);
    assert.match(latexToPlain('\\det A'), /^det\(A\)$/);
    assert.match(latexToPlain('v \\times w'), /^v × w$/);
});

test('sums, products, factorials and binomials in a plain formula', () => {
    const ctx = ctxOf([], [slider('n', 4)]);
    assert.equal(ctx.value('sum(k^2, k, 1, n)'), 30);
    assert.equal(ctx.value('\\sum_{k=1}^{n} k^2'), 30);
    assert.equal(ctx.value('\\prod_{k=1}^{n} k'), 24);
    assert.equal(ctx.value('5!'), 120);
    assert.equal(ctx.value('\\binom{5}{2}'), 10);
    assert.equal(ctx.value('n!^2'), 576);
    near(ctx.value('0.5!'), Math.sqrt(Math.PI) / 2, 1e-12);
    const taylor = ctx.fn1('\\sum_{k=0}^{n} \\frac{(-1)^k x^{2k+1}}{(2k+1)!}');
    near(taylor(1), 1 - 1 / 6 + 1 / 120 - 1 / 5040 + 1 / 362880, 1e-12);
    ctx.setParamValues({ n: 12 });
    near(taylor(2), Math.sin(2), 1e-12);
});

test('a sum in the export is written out at the slider value', () => {
    const ctx = ctxOf([], [slider('n', 2)]);
    const pgf = ctx.pgf('\\sum_{k=0}^{n} \\frac{(-1)^k x^{2k+1}}{(2k+1)!}', 'fn1');
    assert.ok(!/sum|factorial/.test(pgf), pgf);
    assert.equal((pgf.match(/x/g) || []).length, 3, pgf);
    assert.ok(pgf.includes('120'), pgf);
});

test('let values: vectors, matrices, complex numbers', () => {
    const ctx = ctxOf([let_('v', '(2, 1)'), let_('A', '\\begin{pmatrix} 1.5 & 1 \\\\ 0.5 & 2 \\end{pmatrix}'), let_('c', '-0.8 + 0.156i'), let_('w', '(-1, a)')], [slider('a', 2)]);
    assert.equal(ctx.value('det(A)'), 2.5);
    near(ctx.value('|v|'), Math.sqrt(5), 1e-12);
    near(ctx.value('|c|'), Math.hypot(0.8, 0.156), 1e-12);
    assert.equal(ctx.value('v \\cdot w'), 0);
    assert.equal(ctx.value('v_x + w_y'), 4);
    assert.equal(ctx.value('\\operatorname{tr} A'), 3.5);
    near(ctx.value('e^{i\\pi}'), -1, 1e-12);
    assert.equal(ctx.formatTemplate('A v = {A v}, c = {c}, det = {\\det A}'), 'A v = (4, 3), c = -0.8 + 0.156i, det = 2.5');
    ctx.setParamValues({ a: 3 });
    assert.equal(ctx.formatTemplate('{w}'), '(-1, 3)');
});

test('let functions of several variables in old formula fields', () => {
    const ctx = ctxOf([let_('f', 'x^2 + 4y^2', ['x', 'y'])], [], [{ name: 'g', expression: 'f(x, 1)' }]);
    assert.equal(ctx.fn1('f(x, 1)')(2), 8);
    assert.equal(ctx.fn2('f(x, y)')(1, 1), 5);
    assert.equal(ctx.functionInfo('g')?.fn(3), 13);
    const cond = ctx.conditions(['f(x, y) <= 4']);
    assert.equal(cond.length, 1);
    assert.ok(cond[0].disjuncts[0][0].g(0, 0) < 0);
    assert.equal(ctx.pgf('f(x, 1)', 'fn1'), '((x^2)+4)');
});

test('problems have places and words', () => {
    const ctx = ctxOf([let_('v', '(2, 1)')]);
    const r = ctx.validate('v + 1', 'fn1');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /Cannot add a vector of 2 numbers and a number/);
    const s = ctx.validate('v', 'fn1');
    assert.equal(s.ok, false);
    if (!s.ok) assert.match(s.message, /gives a vector of 2 numbers, not a number/);
});

test('values as text', () => {
    assert.equal(formatValue({ kind: 'complex', re: 0, im: -1 }), '-i');
    assert.equal(formatValue({ kind: 'mat', rows: 2, cols: 2, a: [1, 2, 3, 4] }), '[[1, 2], [3, 4]]');
});

test('complex functions, conjugates, parts and arguments', () => {
    // z is an axis variable (3D), so no let name: q here.
    const ctx = ctxOf([let_('q', '3 - 4i'), let_('u', '(1, 0, 0)'), let_('w', '(0, 1, 0)')]);
    assert.equal(ctx.value('\\Re q + \\Im q'), -1);
    assert.equal(ctx.value('|\\bar q|'), 5);
    assert.equal(ctx.value('\\Im \\overline{q}'), 4);
    near(ctx.value('\\arg q'), Math.atan2(-4, 3), 1e-15);
    // A real function of a real number stays real (no value outside its domain); a complex number makes it complex.
    assert.ok(Number.isNaN(ctx.value('\\sqrt{-4}')));
    assert.equal(ctx.value('\\Im \\sqrt{-4 + 0i}'), 2);
    assert.equal(ctx.formatTemplate('{sqrt(q)}'), '2 - i');
    assert.equal(ctx.formatTemplate('{u \\times w}, {norm(u + w):3}'), '(0, 0, 1), 1.414');
    assert.equal(ctx.formatTemplate('{(1 + i)^2}, {i^2}'), '2i, -1');
});

test('matrices: products, powers, the inverse and the transpose', () => {
    const ctx = ctxOf([let_('A', '\\begin{pmatrix} 1.5 & 1 \\\\ 0.5 & 2 \\end{pmatrix}'), let_('B', '[[0, 1], [1, 0]]'), let_('R', '\\begin{pmatrix} \\cos t & -\\sin t \\\\ \\sin t & \\cos t \\end{pmatrix}', ['t'])]);
    assert.equal(ctx.formatTemplate('{A B}'), '[[1, 1.5], [2, 0.5]]');
    assert.equal(ctx.formatTemplate('{A^(-1)}'), '[[0.8, -0.4], [-0.2, 0.6]]');
    assert.equal(ctx.formatTemplate('{A^T}'), '[[1.5, 0.5], [1, 2]]');
    assert.equal(ctx.formatTemplate('{B^3}'), '[[0, 1], [1, 0]]');
    assert.equal(ctx.formatTemplate('{R(\\pi/2) (1, 0)}'), '(0, 1)');
    assert.equal(ctx.value('\\det(A B)'), -2.5);
    assert.throws(() => ctx.valueTable().compileField('A (1, 2, 3)', ctx.envFor('value')), /Cannot multiply a 2 x 2 matrix by a vector of 3 numbers/);
});

test('lists: ranges, lengths, a sum over a range of vectors', () => {
    const ctx = ctxOf([let_('S', '\\{(k, k^2) : k = 1, \\dots, n\\}'), let_('T', '[1, 2, 3]')], [slider('n', 4)]);
    assert.equal(ctx.value('len(S)'), 4);
    assert.equal(ctx.formatTemplate('{S}'), '[(1, 1), (2, 4), (3, 9), (4, 16)]');
    assert.equal(ctx.formatTemplate('{2T}'), '[2, 4, 6]');
    assert.equal(ctx.formatTemplate('{sum((k, 1), k, 1, 3)}'), '(6, 3)');
    ctx.setParamValues({ n: 2 });
    assert.equal(ctx.value('len(S)'), 2);
});

test('plain formulas compile as before (no value hooks run them)', () => {
    const ctx = ctxOf([]);
    const f = ctx.fn1('x^2 + 1');
    assert.equal(f(3), 10);
    assert.equal(ctx.pgf('2*pi*x', 'fn1'), '(2*pi)*x');
    // `i` of a label of points stays the point number.
    assert.equal(ctx.formatTemplate('{i}', { i: 3 }), '3');
});
