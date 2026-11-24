/*
 * GeoGebra commands (6.0 G) in every formula field: the values of the
 * commands with GeoGebra's names, argument orders, 1-based positions and
 * list braces; the user's first screenshot; a chart's own names before
 * the commands; and formulas without them as before.
 */
import { test, assert, near } from './_lib';
import { MathContext } from '../src/mathcontext';
import { compileValue, formatValue } from '../src/values';
import type { Value } from '../src/values';
import { latexToPlain } from '../src/latex';
import { isGeoGebraFormula } from '../src/geogebra/syntax';
import type { FunctionParameters } from '../src/types';

function fn(name: string, expression: string): FunctionParameters {
    return { name, expression, domain: '', showLegend: false, fill: false, fillOpacity: 0.15, fillPattern: 'solid', color: 'blue', dashed: false, tangent: false, tangentPoint: '', extrema: false, thickness: 'thick', parametric: false, expressionY: '' } as unknown as FunctionParameters;
}

function ctxOf(values: Array<[string, string]> = [], extra: { sliders?: Array<[string, number]>; functions?: FunctionParameters[] } = {}): MathContext {
    return new MathContext({
        parameters: (extra.sliders ?? []).map(([name, value]) => ({ name, value, min: -10, max: 10, step: 0.1 })),
        functions: extra.functions ?? [],
        polar: false,
        variables: 'x, y',
        toolNames: [],
        values: values.map(([name, expression]) => ({ name, params: [], expression })),
    });
}

const CTX = ctxOf([
    ['c', '-0.4 + 0.6ί'],
    ['Z_0', '(1, 0.5)'],
    ['A', '(1, 2)'],
]);

const value = (src: string, ctx = CTX): Value => compileValue(ctx, src).run();
const text = (src: string, ctx = CTX) => formatValue(value(src, ctx), 4);

test('braces are lists the GeoGebra way, with the same length (positions stay)', () => {
    assert.equal(latexToPlain('{1, 2, 3}'), '[1, 2, 3]');
    assert.equal(latexToPlain('{{1, 2}, {3, 4}}'), '[[1, 2], [3, 4]]');
    assert.equal(latexToPlain('IterationList(z^2 + c, z, {0 + 0ί}, 20)'), 'IterationList(z^2 + c, z, [0 + 0i], 20)');
    // LaTeX and single groups read as before.
    assert.equal(isGeoGebraFormula('x^{2} + {1, 2}'), false);
    assert.equal(isGeoGebraFormula('{x + 1}^2'), false);
    assert.equal(latexToPlain('{x + 1}^2'), '(x + 1)^2');
    assert.equal(isGeoGebraFormula('({x:2}, {y:2})'), false);
    assert.equal(text('{1, 2, 3}'), '[1, 2, 3]');
    assert.equal(text('{{1, 2}, {3, 4}}'), '[[1, 2], [3, 4]]');
});

test('the screenshot: IterationList of z^2 + c from {0 + 0ί}, its 21st item, and KeepIf of a point set', () => {
    const orbit = value('IterationList(z^2 + c, z, {0 + 0ί}, 20)');
    assert.ok(typeof orbit !== 'number' && orbit.kind === 'list');
    assert.equal(orbit.items.length, 21, 'the start and 20 steps');
    assert.equal(text('Element(IterationList(z^2 + c, z, {0 + 0i}, 3), 4)'), '-0.0544 + 0.456i');
    assert.equal(text('Element(IterationList(z^2 + c, z, {0 + 0i}, 20), 21)'), formatValue(orbit.items[20], 4));
    const set = value('KeepIf(abs(Element(IterationList(z^2 + c, z, {0 + 0i}, 20), 21)) <= 2, c, Flatten(Sequence(Sequence(a + b ί, a, -2, 0.5, 0.25), b, -1, 1, 0.25)))');
    assert.ok(typeof set !== 'number' && set.kind === 'list');
    assert.equal(set.items.length, 34, 'the points of the grid in the set');
    // 0 is in the Mandelbrot set, 0.5 is not.
    assert.equal(text('Length(KeepIf(abs(Element(IterationList(z^2 + c, z, {0}, 20), 21)) <= 2, c, {0, 0.5, -1}))'), '2');
});

test('the Newton orbit from a point Z_0 runs on complex numbers and reaches the root 1', () => {
    const orbit = value('IterationList(z - (z^3 - 1) / (3z^2), z, {Z_0}, 30)');
    assert.ok(typeof orbit !== 'number' && orbit.kind === 'list');
    assert.equal(orbit.items.length, 31);
    assert.equal(formatValue(orbit.items[0], 3), '1 + 0.5i');
    assert.equal(formatValue(orbit.items[30], 6), '1');
});

test('lists: Sequence, Zip, KeepIf, CountIf, Element, First, Last, Append, Join, Reverse, Sort, Unique, Flatten, Take', () => {
    assert.equal(text('Sequence(5)'), '[1, 2, 3, 4, 5]');
    assert.equal(text('Sequence((k, k^2), k, 1, 4)'), '[(1, 1), (2, 4), (3, 9), (4, 16)]');
    assert.equal(text('Sequence(k, k, 0, 1, 0.25)'), '[0, 0.25, 0.5, 0.75, 1]');
    assert.equal(text('Sequence(k, k, 3, 1, -1)'), '[3, 2, 1]');
    assert.equal(text('Zip(a + b, a, {1, 2, 3}, b, {10, 20, 30})'), '[11, 22, 33]');
    assert.equal(text('KeepIf(x < 3, {1, 2, 3, 4, 1, 5, 6})'), '[1, 2, 1]');
    assert.equal(text('KeepIf(t != 2, t, {1, 2, 3})'), '[1, 3]');
    assert.equal(text('CountIf(x > 2, {1, 2, 3, 4})'), '2');
    assert.equal(text('Element({5, 6, 7}, 1)'), '5');
    assert.ok(Number.isNaN(value('Element({5, 6, 7}, 4)') as number), 'past the end has no value');
    assert.equal(text('Element({{1, 2}, {3, 4}}, 2, 1)'), '3');
    assert.equal(text('First({1, 2, 3}, 2)'), '[1, 2]');
    assert.equal(text('First({1, 2, 3})'), '[1]');
    assert.equal(text('Last({1, 2, 3})'), '[3]');
    assert.equal(text('Append({1, 2}, 3)'), '[1, 2, 3]');
    assert.equal(text('Append(0, {1, 2})'), '[0, 1, 2]');
    assert.equal(text('Join({1}, {2, 3})'), '[1, 2, 3]');
    assert.equal(text('Join({{1}, {2, 3}})'), '[1, 2, 3]');
    assert.equal(text('Reverse({1, 2, 3})'), '[3, 2, 1]');
    assert.equal(text('Sort({3, 1, 2})'), '[1, 2, 3]');
    assert.equal(text('Unique({3, 1, 3, 2, 1})'), '[1, 2, 3]');
    assert.equal(text('Flatten({{1, {2}}, {3}})'), '[1, 2, 3]');
    assert.equal(text('Take({1, 2, 3, 4}, 2, 3)'), '[2, 3]');
});

test('numbers of lists: Sum, Product, Length, Max, Min, Mean, and Sum of a formula', () => {
    assert.equal(text('Sum({1, 2, 3})'), '6');
    assert.equal(text('Sum({1, 2, 3}, 2)'), '3');
    assert.equal(text('Sum({(1, 2), (3, 4)})'), '(4, 6)');
    assert.equal(text('Product({1, 2, 3, 4})'), '24');
    assert.equal(text('Sum(k^2, k, 1, 3)'), '14');
    assert.equal(text('Length({1, 2})'), '2');
    assert.equal(text('Length((3, 4))'), '5');
    assert.equal(text('Max({3, 1, 2})'), '3');
    assert.equal(text('Min(4, 2)'), '2');
    assert.equal(text('Mean({1, 2, 3, 4})'), '2.5');
    assert.equal(text('If(2 > 1, 10, 20)'), '10');
    assert.equal(text('If(2 < 1, 10, 20)'), '20');
    assert.ok(Number.isNaN(value('If(2 < 1, 10)') as number), 'If without else has no value');
});

test('points and vectors: x(P), y(P), Vector, UnitVector, Dot, Cross, Midpoint, Distance, transforms', () => {
    assert.equal(text('x(A)'), '1');
    assert.equal(text('y(A)'), '2');
    assert.equal(text('x(c)'), '-0.4');
    assert.equal(text('y({(1, 2), (3, 4)})'), '[2, 4]');
    assert.equal(text('Vector(A, (4, 6))'), '(3, 4)');
    assert.equal(text('UnitVector((3, 4))'), '(0.6, 0.8)');
    assert.equal(text('Dot((1, 2), (3, 4))'), '11');
    assert.equal(text('Cross((1, 0, 0), (0, 1, 0))'), '(0, 0, 1)');
    assert.equal(text('Midpoint(A, (3, 4))'), '(2, 3)');
    assert.equal(text('Distance(A, (4, 6))'), '5');
    assert.equal(text('Rotate(A, pi/2)'), '(-2, 1)');
    assert.equal(text('Translate(A, (1, 1))'), '(2, 3)');
    assert.equal(text('Dilate(A, 2, (1, 1))'), '(1, 3)');
    assert.equal(text('Reflect(A, (0, 0))'), '(-1, -2)');
    assert.equal(text('Point({1, 2})'), '(1, 2)');
    assert.equal(text('conjugate(1 + 2i)'), '1 - 2i');
    assert.equal(text('real(c) + imaginary(c)'), '0.2');
    assert.equal(text('sgn(-3)'), '-1');
});

test('matrices: Determinant, Transpose, Invert', () => {
    assert.equal(text('Determinant({{1, 2}, {3, 4}})'), '-2');
    assert.equal(text('Transpose({{1, 2}, {3, 4}})'), '[[1, 3], [2, 4]]');
    assert.equal(text('Invert({{1, 2}, {3, 4}})'), '[[-2, 1], [1.5, -0.5]]');
});

test('numeric calculus: Root, Integral, Derivative of a chart function or a formula in x; Iteration', () => {
    const ctx = ctxOf([], { functions: [fn('f', 'x^2 - 2')] });
    near(value('Root(f, 1)', ctx) as number, Math.SQRT2, 1e-9);
    near(value('Root(x^2 - 2, 0, 2)', ctx) as number, Math.SQRT2, 1e-9);
    near(value('Integral(f, 0, 3)', ctx) as number, 3, 1e-9);
    near(value('Integral(sin(x), 0, pi)', ctx) as number, 2, 1e-9);
    near(value('Iteration(x/2 + 1/x, 1, 10)', ctx) as number, Math.SQRT2, 1e-12);
    // Derivative(f) is f' at the field's x.
    const d = compileValue(ctx, 'Derivative(f)', ['x']);
    near(d.run(3) as number, 6, 1e-5);
    near(compileValue(ctx, 'Derivative(f, 2)', ['x']).run(1) as number, 2, 1e-3);
});

test('sliders work inside the commands', () => {
    const ctx = ctxOf([], { sliders: [['n', 3]] });
    assert.equal(text('Sequence(k, k, 1, n)', ctx), '[1, 2, 3]');
    ctx.setParams([{ name: 'n', value: 5, min: 0, max: 10, step: 1 }]);
    assert.equal(text('Sequence(k, k, 1, n)', ctx), '[1, 2, 3, 4, 5]');
});

test('a name of the chart wins over a command: a slider Sum, a function Length', () => {
    const ctx = ctxOf([], { sliders: [['Sum', 2]], functions: [fn('Length', 'x + 1')] });
    assert.equal(text('Sum (3)', ctx), '6', 'Sum(3) is the slider Sum times 3');
    assert.equal(text('Length(4)', ctx), '5', 'Length(4) is the function Length at 4');
});

test('problems say how a command is written; drawing commands belong on a line of their own', () => {
    const problem = (src: string) => {
        try {
            compileValue(CTX, src);
            return '';
        } catch (e) {
            return (e as Error).message;
        }
    };
    assert.match(problem('Sequence(k, 1, 2)'), /Sequence is written Sequence\(<expression>, <variable>, <from>, <to>/);
    assert.match(problem('Sequence(k^2, 2, 1, 3)'), /The variable of Sequence is a name/);
    assert.match(problem('Reverse(3)'), /Reverse takes a list here, not a number/);
    assert.match(problem('Circle(A, 3)'), /Circle draws an object: write it on a line of its own/);
});

test('plain formulas compile as before: x(x + 1) is still a product', () => {
    const ctx = ctxOf();
    const f = ctx.fn1('x(x + 1)');
    assert.equal(f(2), 6);
});
