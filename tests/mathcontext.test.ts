import { test, assert, near } from './_lib';
import {
    Affine,
    ExprError,
    LABEL_LOCALS,
    MathContext,
    MathContextInput,
    ValidateResult,
    conditionClauseNodes,
    fmtNum,
    labelDisplayText,
    labelMathSource,
    renameIdentifier,
    renameToolReferences,
    texLabel,
    texText,
} from '../src/mathcontext';
import { findExtrema1D } from '../src/math';
import { stripLatex } from '../src/util';
import { FunctionParameters, Parameter, Tool } from '../src/types';
import { Node, compile, parse } from '../src/expr';
import { EXAMPLES } from '../src/migrate';
import { SettingsManager } from '../src/settings';

// ----------------------------------------------------------------- helpers

function param(name: string, value: number): Parameter {
    return { name, value, min: -10, max: 10, step: 0.1 };
}

function fn(name: string, expression: string, extra: Partial<FunctionParameters> = {}): FunctionParameters {
    return {
        name,
        expression,
        domain: '',
        showLegend: false,
        fill: false,
        fillOpacity: 0.2,
        fillPattern: 'solid',
        tangent: false,
        color: 'blue',
        dashed: false,
        tangentPoint: '',
        extrema: false,
        thickness: 'thick',
        parametric: false,
        expressionY: '',
        ...extra,
    };
}

function fail(r: ValidateResult): Exclude<ValidateResult, { ok: true }> {
    if (r.ok) throw new Error('expected a validation error');
    return r;
}

function throws(fn: () => unknown, message: string | RegExp): ExprError {
    try {
        fn();
    } catch (e) {
        assert.ok(e instanceof ExprError, `expected ExprError, got ${String(e)}`);
        if (typeof message === 'string') assert.equal(e.message, message);
        else assert.match(e.message, message);
        return e;
    }
    throw new Error(`expected ExprError: ${String(message)}`);
}

function affineNear(actual: Affine | null, expected: Affine, msg = ''): void {
    assert.ok(actual, `${msg}: expected an affine form`);
    near(actual.a, expected.a, 1e-12, `${msg} a`);
    near(actual.b, expected.b, 1e-12, `${msg} b`);
    near(actual.c, expected.c, 1e-12, `${msg} c`);
}

/** The chart most tests share: sliders a, b, c, a few functions and two tools. */
function chart(extra: Partial<MathContextInput> = {}): MathContext {
    return MathContext.create({
        parameters: [param('a', 2), param('b', 3), param('c', 12)],
        functions: [
            fn('f1', '2x + 1'),
            fn('f2', 'x^2', { domain: '0:b' }),
            fn('f3', 'f1(x) + f2'),
            fn('p', 'cos(t)', { parametric: true, expressionY: 'sin(t)' }),
            fn('h', 'x/2', { hidden: true }),
            fn('f4', '3x', { domain: '0:1' }),
            fn('f5', 'f1(x) * 2'),
        ],
        toolNames: ['P1', 'R1'],
        ...extra,
    });
}

// ------------------------------------------------------------ construction

test('create memoizes on structure, applies values in place', () => {
    const one = MathContext.create({ parameters: [param('k', 1)], functions: [fn('g', 'k x')] });
    const g = one.fn1('g(x)');
    assert.equal(g(2), 2);
    const two = MathContext.create({ parameters: [param('k', 5)], functions: [fn('g', 'k x')] });
    assert.equal(two, one);
    assert.equal(two.fn1('g(x)'), g, 'closures survive a value change');
    assert.equal(g(2), 10);
    const other = MathContext.create({ parameters: [param('k', 5)], functions: [fn('g', 'k x + 1')] });
    assert.notEqual(other, one);
    assert.notEqual(MathContext.create({ parameters: [param('k', 5)], functions: [fn('g', 'k x')], polar: true }), one);
    assert.notEqual(MathContext.create({ parameters: [param('k', 5)], functions: [fn('g', 'k x')], toolNames: ['P1'] }), one);
    assert.notEqual(MathContext.create({ parameters: [param('k', 5)], functions: [fn('g', 'k x')], variables: 'q, p' }), one);
});

test('isNumericLiteral', () => {
    for (const s of ['3', '-0.5', '+2', '1e3', '.5', '3.', ' 4 ', '2E-3']) assert.ok(MathContext.isNumericLiteral(s), s);
    for (const s of ['', 'a', '2x', 'pi', '1/2', '--1', '1e', '0x10', 'NaN', 'Infinity', '1e400', '-1e999']) {
        assert.ok(!MathContext.isNumericLiteral(s), s);
    }
    assert.ok(MathContext.isNumericLiteral(2.5));
    assert.ok(!MathContext.isNumericLiteral(NaN));
    assert.ok(!MathContext.isNumericLiteral(null));
});

// --------------------------------------------------------- aliases, scopes

test('axis variable aliases per kind and custom variables', () => {
    const ctx = MathContext.create({});
    assert.deepEqual(ctx.axisAliases, [['x'], ['y']]);
    assert.equal(ctx.fn1('x^2')(3), 9);
    assert.equal(ctx.fn1('t^2', 'parametric')(3), 9);
    assert.equal(ctx.fn1('x^2', 'parametric')(3), 9);
    near(ctx.fn1('theta + θ + x + t', 'polar')(1), 4);
    assert.equal(ctx.fn2('x - y')(5, 2), 3);
    const custom = MathContext.create({ variables: 'x1, x2' });
    assert.deepEqual(custom.axisAliases, [['x', 'x1'], ['y', 'x2']]);
    assert.equal(custom.fn1('x1 + x')(2), 4);
    assert.equal(custom.fn2('3x1 + 2x2 - y')(1, 2), 5);
    const qp = MathContext.create({ variables: 'q, p' });
    assert.equal(qp.fn2('q p')(3, 4), 12);
    assert.equal(fail(qp.validate('p', 'fn1')).message, 'p is not available here: f(q) uses q only');
    // Explicit names win: with variables 'y, x' the name x is the second axis.
    const swapped = MathContext.create({ variables: 'y, x' });
    assert.deepEqual(swapped.axisAliases, [['y'], ['x']]);
    assert.equal(swapped.fn2('y - x')(1, 5), -4);
    // Malformed or duplicate specs fall back to x, y.
    assert.deepEqual(MathContext.create({ variables: 'x, x' }).axisAliases, [['x'], ['y']]);
    assert.deepEqual(MathContext.create({ variables: '1a, ' }).axisAliases, [['x'], ['y']]);
});

test('parameters update in place without recompiling', () => {
    const ctx = MathContext.create({ parameters: [param('m', 2), param('q', 1)] });
    const f = ctx.fn1('m x + q');
    const g = ctx.fn2('m x + q y');
    assert.equal(f(3), 7);
    const v0 = ctx.version;
    const key0 = ctx.paramsKey;
    assert.equal(key0, 'm=2|q=1');
    ctx.setParams([param('m', -1)]);
    assert.equal(ctx.version, v0 + 1);
    assert.equal(ctx.paramsKey, 'm=-1|q=1');
    assert.equal(f(3), -2);
    assert.equal(g(3, 2), -1);
    assert.equal(ctx.fn1('m x + q'), f, 'same closure from the memo');
    // Unchanged values and unknown names do not bump the version.
    ctx.setParams([param('m', -1), param('zz', 4)]);
    assert.equal(ctx.version, v0 + 1);
    assert.equal(ctx.value('m + q'), 0);
});

test('derived names: _x _y _z _val _n and indexed points', () => {
    const ctx = MathContext.create({ toolNames: ['P1'] });
    assert.ok(Number.isNaN(ctx.value('P1_x')), 'unset -> NaN');
    assert.equal(ctx.value('P1_x', -1), -1);
    const f = ctx.fn1('x + P1_x');
    const v0 = ctx.version;
    ctx.setDerived({ P1_x: 3, P1_y: 1, P1_val: 9, P1_n: 2, P1_x2: 5, P1_y2: 6, P1_z: 0.5 });
    assert.equal(ctx.version, v0 + 1);
    assert.equal(f(1), 4, 'closures read derived values at call time');
    assert.equal(ctx.value('P1_x1'), 3, 'P1_x1 is P1_x');
    assert.equal(ctx.value('P1_x2 + P1_y2'), 11);
    assert.equal(ctx.value('P1_val + P1_n + P1_z'), 11.5);
    assert.ok(Number.isNaN(ctx.value('P1_x3')));
    ctx.setDerived({ P1_x: 3, P1_y: 1, P1_val: 9, P1_n: 2, P1_x2: 5, P1_y2: 6, P1_z: 0.5 });
    assert.equal(ctx.version, v0 + 1, 'same values: no bump');
    ctx.setDerived({ P1_x1: 7 });
    assert.equal(ctx.value('P1_x'), 7, 'P1_x reads P1_x1');
    assert.ok(Number.isNaN(ctx.value('P1_y')), 'setDerived replaces everything');
    // Pending derived values are not a validation error; malformed ones are.
    assert.ok(ctx.validate('P1_y + 1', 'value').ok);
    assert.ok(!ctx.tryValue('P1_y').ok);
    assert.equal(fail(ctx.validate('P1_w', 'value')).message, "Unknown name 'P1_w' (P1 provides P1_x, P1_y, P1_z, P1_val, P1_n)");
    assert.equal(fail(ctx.validate('P1_x0', 'value')).fix, undefined);
    // Names of tools that do not exist are ordinary unknown names.
    assert.equal(fail(ctx.validate('Q_x', 'value')).fix?.addParameter, 'Q_x');
});

// --------------------------------------------------------- user functions

test('user functions: kinds, info, domains, hidden, callable names', () => {
    const ctx = chart();
    const infos = ctx.functions();
    assert.deepEqual(infos.map((f) => f.name), ['f1', 'f2', 'f3', 'p', 'h', 'f4', 'f5']);
    assert.deepEqual(infos.map((f) => f.kind), ['cartesian', 'cartesian', 'cartesian', 'parametric', 'cartesian', 'cartesian', 'cartesian']);
    assert.ok(infos.every((f) => f.error === undefined), JSON.stringify(infos.map((f) => f.error)));
    assert.deepEqual(ctx.callableNames(), ['f1', 'f2', 'f3', 'h', 'f4', 'f5']);
    const f2 = ctx.functionInfo('f2');
    assert.ok(f2);
    assert.deepEqual(f2.domain, [0, 3]);
    assert.equal(f2.fn(2), 4);
    assert.ok(Number.isNaN(f2.fn(-0.5)), 'NaN outside the domain');
    assert.ok(Number.isNaN(f2.fn(3.5)));
    assert.equal(f2.fn(3 + 1e-12), (3 + 1e-12) ** 2, 'an ulp past the end is inside');
    assert.equal(ctx.functionInfo('f1')?.domain, null);
    assert.equal(ctx.functionInfo('nope'), null);
    const p = ctx.functionInfo('p');
    assert.ok(p && p.fnY);
    near(p.fn(Math.PI), -1);
    near(p.fnY(Math.PI / 2), 1);
    assert.equal(ctx.functionInfo('h')?.hidden, true);
    // Calls, bare names (= f(first variable)), hidden functions stay callable.
    assert.equal(ctx.fn1('f1(x - 1)')(3), 5);
    assert.equal(ctx.fn1('f1 + h')(4), 11);
    assert.equal(ctx.fn2('f1 + y')(1, 10), 13);
    assert.equal(ctx.fn1('f3(2)')(0), 9);
    assert.equal(ctx.value('f1(2) + h(4)'), 7);
    assert.equal(fail(ctx.validate('f1', 'value')).message, 'f1 needs an argument here, e.g. f1(1)');
    assert.equal(fail(ctx.validate('p(2)', 'fn1')).message, 'p is parametric and cannot be called');
    assert.equal(fail(ctx.validate('p + 1', 'fn2')).message, 'p is parametric and cannot be called');
    assert.equal(fail(ctx.validate('f1(1, 2)', 'fn1')).message, 'f1 takes 1 argument');
});

test('function domains follow sliders; domain errors', () => {
    const ctx = chart();
    const f2 = ctx.functionInfo('f2');
    assert.ok(f2);
    const call = ctx.fn1('f2(x)');
    assert.ok(Number.isNaN(call(4)));
    ctx.setParams([param('b', 5)]);
    assert.deepEqual(f2.domain, [0, 5]);
    assert.equal(call(4), 16);
    ctx.setParams([param('b', -1)]);
    assert.equal(f2.domain, null);
    assert.equal(f2.domainError, 'Domain min must be less than max');
    assert.equal(f2.error, undefined);
    assert.ok(Number.isNaN(call(0.5)), 'invalid domain: nothing is drawn');
    ctx.setParams([param('b', 3)]);
    assert.equal(f2.domainError, undefined);
    assert.equal(call(1), 1);
    const bad = MathContext.create({ functions: [fn('g', 'x', { domain: '0:k' }), fn('u', 'x', { domain: 'oops' })] });
    assert.equal(bad.functionInfo('g')?.domainError, "Unknown name 'k'");
    assert.equal(bad.functionInfo('u')?.domainError, 'Write the domain as min:max, e.g. -5:5');
    assert.ok(Number.isNaN(bad.functionInfo('g')?.fn(0.5) ?? 0));
});

test('function errors: cycles, dependents, clashes, empty bodies', () => {
    const ctx = MathContext.create({
        parameters: [param('a', 1)],
        functions: [
            fn('f1', 'f2(x) + 1'),
            fn('f2', 'f1(x) * 2'),
            fn('f3', 'f1(x)'),
            fn('f4', 'f4(x - 1)'),
            fn('f5', 'x', { domain: 'f6(0):1' }),
            fn('f6', 'f5(x)'),
            fn('a', 'x'),
            fn('sin', 'x'),
            fn('f3', 'x'),
            fn('k1', 'q x'),
            fn('k2', 'k1(x) + 1'),
            fn('e1', ''),
            fn('e2', 't', { parametric: true }),
            fn('ok', 'x + a'),
        ],
    });
    const err = (name: string, i = 0) => ctx.functions().filter((f) => f.name === name)[i].error;
    assert.equal(err('f1'), 'f1 refers to itself through f2');
    assert.equal(err('f2'), 'f2 refers to itself through f1');
    assert.equal(err('f3'), 'depends on f1 (error)');
    assert.equal(err('f4'), 'f4 refers to itself');
    assert.equal(err('f5'), 'f5 refers to itself through f6', 'domains count as references');
    assert.equal(err('f6'), 'f6 refers to itself through f5');
    assert.equal(err('a'), 'a is also a slider name');
    assert.equal(err('sin'), 'sin is a reserved name');
    assert.equal(err('f3', 1), 'Another function is already named f3');
    assert.equal(err('k1'), "Unknown name 'q'");
    assert.equal(err('k2'), 'depends on k1 (error)');
    assert.equal(err('e1'), 'Enter an expression');
    assert.equal(err('e2'), 'Enter y(t)');
    assert.equal(err('ok'), undefined);
    assert.deepEqual(ctx.callableNames(), ['ok']);
    assert.ok(Number.isNaN(ctx.functionInfo('f1')?.fn(1) ?? 0));
    assert.equal(fail(ctx.validate('f1(x) + 2', 'fn1')).message, 'depends on f1 (error)');
    assert.equal(ctx.fn1('ok(2)')(0), 3);
    assert.equal(ctx.fn1('sin(x)')(0), 0, 'builtins are unaffected');
});

test('polar charts: functions take theta, bare names need an argument in fn2', () => {
    const ctx = MathContext.create({ polar: true, functions: [fn('r1', '1 + cos(theta)')] });
    const r1 = ctx.functionInfo('r1');
    assert.equal(r1?.kind, 'polar');
    assert.equal(r1?.fn(0), 2);
    assert.equal(fail(ctx.validate('r1', 'fn2')).message, 'r1 needs an argument here, e.g. r1(theta)');
    assert.ok(ctx.validate('r1(x)', 'fn2').ok);
    near(ctx.fn1('r1 / 2', 'polar')(Math.PI / 2), 0.5);
    assert.equal(fail(ctx.validate('y', 'fn1', 'polar')).message, 'y is not available here: r(theta) uses theta only');
});

// ----------------------------------------------------- conditions, equation

test('conditions: clauses, chains, and / or, normalized text, g <= 0', () => {
    const ctx = chart();
    const res = ctx.conditions(['x + y <= 4', '', 'x >= 0, y >= 0', '0 <= x≤4', 'x <= 1 or x >= 3, y >= 0', '!(x > 1 and y > 1)']);
    assert.deepEqual(res.map((e) => e.entry), [0, 2, 3, 4, 5], 'empty entries are skipped');
    const [sum, quad, chain, or, not] = res;
    assert.equal(sum.disjuncts.length, 1);
    const g = sum.disjuncts[0][0].g;
    assert.equal(g(1, 1), -2);
    assert.equal(g(3, 3), 2);
    affineNear(sum.disjuncts[0][0].affine, { a: 1, b: 1, c: -4 }, 'x + y <= 4');
    assert.deepEqual(quad.disjuncts[0].map((c) => c.text), ['x >= 0', 'y >= 0']);
    affineNear(quad.disjuncts[0][0].affine, { a: -1, b: 0, c: 0 }, 'x >= 0 -> -x <= 0');
    assert.equal(quad.disjuncts[0][0].g(2, 0), -2);
    assert.deepEqual(chain.disjuncts[0].map((c) => c.text), ['0 <= x', 'x <= 4']);
    assert.deepEqual(
        or.disjuncts.map((d) => d.map((c) => c.text)),
        [['x <= 1', 'y >= 0'], ['x >= 3', 'y >= 0']],
        'and binds tighter than or; the comma ANDs the whole entry'
    );
    assert.deepEqual(not.disjuncts.map((d) => d.map((c) => c.text)), [['x <= 1'], ['y <= 1']]);
    // Strictness is ignored: < behaves like <=.
    affineNear(ctx.conditions(['x < 1'])[0].disjuncts[0][0].affine, { a: 1, b: 0, c: -1 });
});

test('conditions: affine detection (sliders are numbers, min / abs / products are not)', () => {
    const ctx = chart();
    const affine = (src: string) => ctx.conditions([src])[0].disjuncts[0][0].affine;
    affineNear(affine('a x + b y <= c'), { a: 2, b: 3, c: -12 }, 'sliders');
    affineNear(affine('x / a <= 1'), { a: 0.5, b: 0, c: -1 }, 'division by a slider');
    affineNear(affine('a(x + 1) <= y'), { a: 2, b: -1, c: 2 }, 'implicit a*(...)');
    affineNear(affine('2(x + 1) - 3(y - 1) >= -x'), { a: -3, b: 3, c: -5 });
    affineNear(affine('x^1 <= 2'), { a: 1, b: 0, c: -2 });
    affineNear(affine('y >= f1(x)'), { a: 2, b: -1, c: 1 }, 'affine user function');
    affineNear(affine('y >= f1'), { a: 2, b: -1, c: 1 }, 'bare user function');
    affineNear(affine('y >= f5(x - 1)'), { a: 4, b: -1, c: -2 }, 'nested user functions');
    affineNear(affine('x + sin(pi / 2) <= sqrt(c + 4)'), { a: 1, b: 0, c: -3 }, 'constant subexpressions');
    for (const src of ['x*y <= 1', 'x^2 + y^2 <= 4', 'abs(x) <= 1', 'min(x, y) <= 1', 'max(x, 1) <= y', '(x < 1 ? x : 1) <= y', 'x / y <= 1', 'y >= f2(x)', 'y <= f4(x)', 'x^a <= 1', 'sin(x) <= y']) {
        assert.equal(affine(src), null, src);
    }
    // Coefficients are read at call time.
    ctx.setParams([param('a', 1)]);
    affineNear(affine('a x + b y <= c'), { a: 1, b: 3, c: -12 });
    affineNear(affine('x^a <= 1'), { a: 1, b: 0, c: -1 });
    ctx.setParams([param('a', 2)]);
    // Derived values: not affine (NaN) until the scene publishes them.
    const withTool = chart({ toolNames: ['P1'] });
    assert.equal(withTool.conditions(['x <= P1_x'])[0].disjuncts[0][0].affine, null);
    withTool.setDerived({ P1_x: 3 });
    affineNear(withTool.conditions(['x <= P1_x'])[0].disjuncts[0][0].affine, { a: 1, b: 0, c: -3 });
});

test('conditions: errors name the entry', () => {
    const ctx = chart();
    let e = throws(() => ctx.conditions(['x <= 1', 'x <= k']), "condition 2: Unknown name 'k'");
    assert.equal(e.index, 1);
    assert.equal(e.unknown, 'k');
    assert.deepEqual(e.fix, { label: 'Add slider k', addParameter: 'k' });
    e = throws(() => ctx.conditions(['ax + by <= c']), "condition 1: Unknown name 'ax'. Did you mean a*x?");
    assert.deepEqual(e.fix, { label: 'Use a*x', rewrite: 'a*x + by <= c' });
    throws(() => ctx.conditions(['x = 1']), 'condition 1: Use <= or >= in a condition, not =');
    throws(() => ctx.conditions(['x == 1']), 'condition 1: Use <= or >= in a condition, not == or !=');
    throws(() => ctx.conditions(['', 'x + 1']), "condition 2: 'x + 1' is not a condition: use <= or >=");
    throws(() => ctx.conditions(['x <= 1 or']), 'condition 1: Unexpected end of expression');
    assert.deepEqual(ctx.conditions([]), []);
});

test('equation: F = lhs - rhs, affine forms', () => {
    const ctx = chart();
    let r = ctx.equation('2x + 3y = 12');
    affineNear(r.affine, { a: 2, b: 3, c: -12 });
    assert.equal(r.F(3, 2), 0);
    r = ctx.equation('y = a x + 1');
    affineNear(r.affine, { a: -2, b: 1, c: -1 });
    r = ctx.equation('x^2 + y^2 = 4');
    assert.equal(r.affine, null);
    assert.equal(r.F(2, 0), 0);
    assert.equal(r.F(0, 0), -4);
    r = ctx.equation('x^2 + y^2 == 4');
    assert.equal(r.F(0, 1), -3);
    r = ctx.equation('x - y');
    affineNear(r.affine, { a: 1, b: -1, c: 0 });
    affineNear(ctx.equation('a x + b y = c').affine, { a: 2, b: 3, c: -12 });
    ctx.setParams([param('c', 6)]);
    affineNear(ctx.equation('a x + b y = c').affine, { a: 2, b: 3, c: -6 });
    assert.equal(ctx.equation('a x + b y = c').F(0, 2), 0);
    ctx.setParams([param('c', 12)]);
    throws(() => ctx.equation('x <= 2'), 'Use = in an equation (inequalities belong in a region)');
    throws(() => ctx.equation('x = y = 2'), 'An equation has only one =');
    throws(() => ctx.equation(''), 'Enter an equation, e.g. 2x + 3y = 12');
    throws(() => ctx.equation('x + k = 1'), "Unknown name 'k'");
});

// ------------------------------------------------------------ evaluation

test('value and tryValue', () => {
    const ctx = chart();
    near(ctx.value('2pi'), 2 * Math.PI);
    assert.equal(ctx.value(' -0.5 '), -0.5);
    assert.equal(ctx.value(3), 3);
    assert.equal(ctx.value(Infinity, 1), 1);
    assert.ok(Number.isNaN(ctx.value('k')));
    assert.equal(ctx.value('k', 5), 5);
    assert.equal(ctx.value('', 7), 7);
    assert.equal(ctx.value(null, 8), 8);
    assert.equal(ctx.value('1/0', 9), 9);
    assert.equal(ctx.value('a b + f1(2)'), 11);
    assert.deepEqual(ctx.tryValue('a + 1'), { ok: true, value: 3 });
    assert.deepEqual(ctx.tryValue('1/0'), { ok: false, message: '1/0 is not a finite number', pos: 0 });
    assert.deepEqual(ctx.tryValue('k'), {
        ok: false,
        message: "Unknown name 'k'",
        pos: 0,
        unknown: 'k',
        fix: { label: 'Add slider k', addParameter: 'k' },
    });
    assert.equal(fail(ctx.tryValue('')).message, 'Enter a value');
    assert.equal(fail(ctx.tryValue('x')).message, 'x is not available here: this field takes a number');
    // A literal that overflows is as non-finite as 1/0.
    assert.equal(ctx.value('1e400', 7), 7);
    assert.equal(ctx.value('-1e400', 7), 7);
    assert.deepEqual(ctx.tryValue('1e400'), { ok: false, message: '1e400 is not a finite number', pos: 0 });
    assert.equal(fail(ctx.validate('1e999', 'value')).message, '1e999 is not a finite number');
});

test('values (levels)', () => {
    const ctx = chart();
    assert.deepEqual(ctx.values('2, 4, c'), [2, 4, 12]);
    assert.deepEqual(ctx.values('max(1, 2), -a'), [2, -2]);
    assert.deepEqual(ctx.values(''), []);
    assert.deepEqual(ctx.values('  '), []);
    let e = throws(() => ctx.values('1, k'), "value 2: Unknown name 'k'");
    assert.equal(e.index, 1);
    assert.equal(e.pos, 3);
    e = throws(() => ctx.values('1, 1/0'), 'value 2 is not a finite number');
    assert.equal(e.index, 1);
    throws(() => ctx.values('1,, 2'), "Unexpected ','");
});

test('domain: ternary-aware split, errors, fallback', () => {
    const ctx = chart();
    const [lo, hi] = ctx.domain('-pi:pi');
    near(lo, -Math.PI);
    near(hi, Math.PI);
    assert.deepEqual(ctx.domain('a > 0 ? 1 : 2 : 5'), [1, 5]);
    assert.deepEqual(ctx.domain('(a > 0 ? -1 : 0):3'), [-1, 3]);
    assert.deepEqual(ctx.domain(' 0 : b '), [0, 3]);
    assert.deepEqual(ctx.domain('5:1', [0, 1]), [0, 1]);
    assert.deepEqual(ctx.domain('', [-2, 2]), [-2, 2]);
    throws(() => ctx.domain('5:1'), 'Domain min must be less than max');
    throws(() => ctx.domain('1:1'), 'Domain min must be less than max');
    throws(() => ctx.domain('abc'), 'Write the domain as min:max, e.g. -5:5');
    throws(() => ctx.domain(''), 'Domain is empty');
    assert.equal(throws(() => ctx.domain('1:'), 'Domain max is missing').pos, 2);
    assert.equal(throws(() => ctx.domain(':2'), 'Domain min is missing').pos, 0);
    assert.equal(throws(() => ctx.domain('0:1/0'), 'Domain max is not a finite number').pos, 2);
    assert.equal(throws(() => ctx.domain('0:1e400'), 'Domain max is not a finite number').pos, 2);
    throws(() => ctx.domain('-1e400:1'), 'Domain min is not a finite number');
    assert.deepEqual(ctx.domain('0:1e400', [1, 2]), [1, 2]);
    assert.equal(fail(ctx.validate('0:1e400', 'domain')).message, 'Domain max is not a finite number');
    throws(() => ctx.domain('1:2:3'), "Unexpected ':'");
    let e = throws(() => ctx.domain('0:k'), "Unknown name 'k'");
    assert.equal(e.pos, 2, 'positions refer to the whole field');
    assert.deepEqual(e.fix, { label: 'Add slider k', addParameter: 'k' });
    e = throws(() => ctx.domain('0:ab'), "Unknown name 'ab'. Did you mean a*b?");
    assert.deepEqual(e.fix, { label: 'Use a*b', rewrite: '0:a*b' }, 'rewrites cover the whole field');
});

test('tuples and paths', () => {
    const ctx = chart();
    assert.deepEqual(ctx.tuples('(1, 2); (3, max(4, 5));', 2), [[1, 2], [3, 5]]);
    assert.deepEqual(ctx.tuples('(a, b, c)', 3), [[2, 3, 12]]);
    assert.deepEqual(ctx.tuples('', 2), []);
    let e = throws(() => ctx.tuples('(1, 2); (3)', 2), 'point 2: write it as (x, y)');
    assert.equal(e.index, 1);
    throws(() => ctx.tuples('(1, 2)', 3), 'point 1: write it as (x, y, z)');
    e = throws(() => ctx.tuples('(0, 0); (1, k)', 2), "point 2: Unknown name 'k'");
    assert.equal(e.pos, 12);
    assert.equal(e.unknown, 'k');
    throws(() => ctx.tuples('(1, 2) (3, 4)', 2), 'point 1: Separate points with ;');
    throws(() => ctx.tuples('1, 2', 2), 'point 1: Write a point as (x, y)');
    throws(() => ctx.tuples('(1, 1/0)', 2), 'point 1: coordinate 2 is not a finite number');
    throws(() => ctx.tuples('P1', 2), 'point 1: Write a point as (x, y)');
    assert.deepEqual(ctx.path('P1; (0, a)', 2), [{ name: 'P1' }, { point: [0, 2] }]);
    assert.deepEqual(ctx.path('(0, 0, 0); R1', 3), [{ point: [0, 0, 0] }, { name: 'R1' }]);
    throws(() => ctx.path('Q; (0, 0)', 2), "point 1: 'Q' is not a points tool");
});

test('a slider named like an axis variable is reported and the name stays the axis', () => {
    const ctx = new MathContext({
        parameters: [
            { name: 'p', value: 5, min: 0, max: 10, step: 1 },
            { name: 'a', value: 2, min: 0, max: 10, step: 1 },
        ],
        variables: 'q, p',
        functions: [{ expression: 'a*q + p', color: 'blue', thickness: 'thin', dashed: false, domain: '', showLegend: false } as never],
    });
    assert.deepEqual(ctx.parameterIssues(), [{ source: 'p', message: 'p is an axis variable: rename the slider or the axis', severity: 'error' }]);
    // In f(q) = a*q + p, p is the second axis variable, not the slider (5).
    assert.ok(ctx.validate('a*q', 'fn1').ok);
    assert.equal(new MathContext({ parameters: [{ name: 'a', value: 1, min: 0, max: 2, step: 1 }] }).parameterIssues().length, 0);
});

test('formatTemplate', () => {
    const ctx = chart({ toolNames: ['P1'] });
    // Contexts are memoized by structure: start from a clean derived scope.
    ctx.setDerived({});
    const t = (s: string, locals?: Record<string, number>) => ctx.formatTemplate(s, locals);
    assert.equal(t('a = {a}'), 'a = 2');
    assert.equal(t('{pi:2}'), '3.14');
    assert.equal(t('{1/3}'), '0.333');
    assert.equal(t('{2/3:5}'), '0.66667');
    assert.equal(t('{10:2}'), '10');
    assert.equal(t('max {a*b:0}'), 'max 6');
    assert.equal(t('({x}, {y})', { x: 1.25, y: -0.5 }), '(1.25, -0.5)');
    assert.equal(t('level {level:1}', { level: 2.25 }), 'level 2.3');
    assert.equal(t('{a}', { a: 7 }), '7', 'locals override sliders');
    assert.equal(t('{x}'), '?', 'x is not a local here');
    assert.equal(t('{k}'), '?');
    assert.equal(t('{(}'), '?');
    assert.equal(t('{P1_x}'), '?', 'unset derived value');
    ctx.setDerived({ P1_x: 1.5 });
    assert.equal(t('{P1_x}'), '1.5');
    assert.equal(t('{-0.0001}'), '0', 'no -0');
    assert.equal(t('{{a}}'), '{a}');
    assert.equal(t('$x = {a}$'), '$x = 2$');
    assert.equal(t('$x^{2} + \\frac{a}{b}$'), '$x^{2} + \\frac{a}{b}$');
    // After a placeholder or a command without arguments, a brace is another placeholder.
    assert.equal(t('$A = {a}\\cdot{b}$'), '$A = 2\\cdot3$');
    assert.equal(t('${a}{b}$'), '$23$');
    assert.equal(t('$x \\approx {c}$ and $\\mathbf{v}$'), '$x \\approx 12$ and $\\mathbf{v}$');
    assert.equal(t('plain text'), 'plain text');
    assert.equal(t('open {a'), 'open {a');
    assert.equal(t('{x > 0 ? 1 : 2}', { x: 1 }), '1');
});

test('fmtNum, texText, renameIdentifier, renameToolReferences', () => {
    assert.equal(fmtNum(1234567), '1.23457e6');
    assert.equal(fmtNum(999999.7), '1e6');
    assert.equal(fmtNum(123456.7), '123457');
    assert.equal(fmtNum(0.1 + 0.2), '0.3');
    assert.equal(fmtNum(1 / 3), '0.333333');
    assert.equal(fmtNum(-2.5), '-2.5');
    assert.equal(fmtNum(-0), '0');
    assert.equal(fmtNum(0.0001), '0.0001');
    assert.equal(fmtNum(0.00001234), '1.234e-5');
    assert.equal(fmtNum(-1e21), '-1e21');
    assert.equal(fmtNum(NaN), 'nan');
    assert.equal(fmtNum(Infinity), 'nan');
    assert.equal(
        texText('50% & #1 x_1 ~ ^ {a} \\ $x^*$ \\(y_2\\) costs $5'),
        '50\\% \\& \\#1 x\\_1 \\textasciitilde{} \\textasciicircum{} \\{a\\} \\textbackslash{} $x^*$ \\(y_2\\) costs \\$5'
    );
    assert.equal(texText('$$a_b$$ and $c$'), '$$a_b$$ and $c$');
    assert.equal(texText(''), '');
    // OT1 has no <, >, | glyphs; a plain quote must stay out of reach of babel shorthands.
    assert.equal(
        texText('x <= 4 | a>b "q" $a<b$'),
        'x \\textless{}= 4 \\textbar{} a\\textgreater{}b \\string"q\\string" $a<b$'
    );
    // Dollars pair like in Obsidian: prices stay text, math keeps working.
    assert.equal(texText('dollar $5 and $10'), 'dollar \\$5 and \\$10');
    assert.equal(texText('$2\\pi$ or $x$ and $y$'), '$2\\pi$ or $x$ and $y$');
    assert.equal(texText('Revenue ($)'), 'Revenue (\\$)');
    assert.equal(texText('$ x $'), '\\$ x \\$');
    assert.equal(texText('from $5-$10 or $\\$$5'), 'from \\$5-\\$10 or $\\$$5');
    // Escaped specials print as the character; other backslashes as typed.
    assert.equal(texText('$\\pi(q)$ in \\$, R\\&D 50\\%'), '$\\pi(q)$ in \\$, R\\&D 50\\%');
    assert.equal(texText('\\textbf{a}'), '\\textbackslash{}textbf\\{a\\}');
    assert.equal(renameIdentifier('a*x + ab + Math.a + 2a', 'a', 'k'), 'k*x + ab + Math.a + 2k');
    assert.equal(renameIdentifier('a # b', 'a', 'k'), 'a # b');
    assert.equal(renameIdentifier('Optimum at a', 'a', 'k'), 'Optimum at k', 'read as an expression');
    assert.equal(renameIdentifier('Optimum at a', 'a', 'k', true), 'Optimum at a', 'label without placeholders');
    assert.equal(renameIdentifier('a = {a:2}', 'a', 'k', true), 'a = {k:2}');
    assert.equal(
        renameToolReferences('P1_x + P1_val + P1_x2 + P1 + P10_x + P1_q + P1_x0', 'P1', 'P3'),
        'P3_x + P3_val + P3_x2 + P3 + P10_x + P1_q + P3_x0'
    );
    assert.equal(renameToolReferences('P1: {P1_y:2}, {P1_n}', 'P1', 'P3'), 'P1: {P3_y:2}, {P3_n}');
    assert.equal(renameToolReferences('Best P1', 'P1', 'P3', true), 'Best P1');
});

test('texLabel: LaTeX commands and groups, everything else as typed', () => {
    // Plain prose and constraint labels print as typed.
    assert.equal(texLabel('50% cut'), '50\\% cut');
    assert.equal(texLabel('x_1 & y'), 'x\\_1 \\& y');
    assert.equal(texLabel('x + y <= 4'), 'x + y \\textless{}= 4');
    assert.equal(texLabel('say "hi" | a>b'), 'say \\string"hi\\string" \\textbar{} a\\textgreater{}b');
    assert.equal(texLabel('a { b'), 'a \\{ b');
    assert.equal(texLabel('a } b {'), 'a \\} b \\{');
    assert.equal(texLabel('ends \\'), 'ends \\textbackslash{}');
    assert.equal(texLabel('\\\\ no break'), '\\textbackslash{}\\textbackslash{} no break', 'a line break aborts a TikZ node');
    assert.equal(texLabel('\\(open'), '\\textbackslash{}(open');
    // LaTeX written by 3.x users keeps working: control words, control symbols, groups.
    assert.equal(texLabel('\\textbf{Revenue} in \\%'), '\\textbf{Revenue} in \\%');
    assert.equal(texLabel('R\\&D 50\\% share'), 'R\\&D 50\\% share');
    assert.equal(texLabel('Preis in \\euro'), 'Preis in \\euro');
    assert.equal(texLabel('$x_1$ and \\textit{b}'), '$x_1$ and \\textit{b}');
    assert.equal(texLabel('M\\"uller'), 'M\\"uller');
    assert.equal(texLabel('price \\$5 and $x$'), 'price \\$5 and $x$');
    assert.equal(texLabel('$\\pi(q)$ in \\$'), '$\\pi(q)$ in \\$');
    // Math-only commands also work outside $...$.
    assert.equal(texLabel('level \\alpha = 0.05'), 'level \\ensuremath{\\alpha} = 0.05');
    assert.equal(texLabel('\\frac{a}{b} and x \\le 4'), '\\ensuremath{\\frac{a}{b}} and x \\ensuremath{\\le} 4');
    assert.equal(texLabel('dollar $5 and $10'), 'dollar \\$5 and \\$10');
});

test('labelDisplayText / labelMathSource: the preview reads labels like texLabel', () => {
    const show = (s: string) => labelDisplayText(s, stripLatex);
    // Text outside math is shown as typed: no sub- or superscripts.
    assert.equal(show('x_1 + x_2 and e^2'), 'x_1 + x_2 and e^2');
    assert.equal(show('y_max'), 'y_max');
    assert.equal(show('costs $5'), 'costs $5');
    assert.equal(show('Revenue ($)'), 'Revenue ($)');
    assert.equal(show('dollar $5 and $10 price'), 'dollar $5 and $10 price');
    assert.equal(show('x + y <= 4 | "q"'), 'x + y <= 4 | "q"');
    assert.equal(show('a { b'), 'a { b');
    // Math segments and math-only commands go through the math approximation.
    assert.equal(show('$x_1$ and y_2'), 'x₁ and y_2');
    assert.equal(show('\\(y_2\\) cut'), 'y₂ cut');
    assert.equal(show('level \\alpha = 0.05'), 'level α = 0.05');
    // LaTeX groups, styles and control symbols resolve the way the PDF prints them.
    assert.equal(show('R&D {costs} 5%'), 'R&D costs 5%');
    assert.equal(show('\\textbf{Revenue} in \\%'), 'Revenue in %');
    assert.equal(show('R\\&D 50\\% share'), 'R&D 50% share');
    assert.equal(show('$\\pi(q)$ in \\$'), 'π(q) in $');
    assert.equal(show('Preis in \\euro'), 'Preis in €');
    assert.equal(show('M\\"uller \\"{a}'), 'Müller ä');
    assert.equal(show('\\textcolor{red}{hot}'), 'hot');
    assert.equal(labelMathSource(' $x^2$ '), 'x^2');
    assert.equal(labelMathSource('\\(y_1\\)'), 'y_1');
    assert.equal(labelMathSource('$$a$$'), 'a');
    assert.equal(labelMathSource('$x$ and $y$'), null);
    assert.equal(labelMathSource('$5 and $10'), null);
    assert.equal(labelMathSource('plain'), null);
});

// --------------------------------------------------------------- deps

test('deps and depsKey', () => {
    const ctx = chart();
    assert.deepEqual(ctx.deps('f3(x) + P1_x + R1_val + a'), {
        params: ['b', 'a'],
        functions: ['f3', 'f1', 'f2'],
        derived: ['P1_x', 'R1_val'],
        tools: ['P1', 'R1'],
    });
    assert.deepEqual(ctx.deps('P1; (c, 1)'), { params: ['c'], functions: [], derived: [], tools: ['P1'] });
    assert.deepEqual(ctx.deps('{a:2} at {P1_y}'), { params: ['a'], functions: [], derived: ['P1_y'], tools: ['P1'] });
    assert.deepEqual(ctx.deps('#'), { params: [], functions: [], derived: [], tools: [] });
    const k1 = ctx.depsKey(['a*x']);
    ctx.setParams([param('b', 4)]);
    assert.equal(ctx.depsKey(['a*x']), k1, 'unrelated slider');
    const f2key = ctx.depsKey(['f2(x)']);
    ctx.setParams([param('b', 5)]);
    assert.notEqual(ctx.depsKey(['f2(x)']), f2key, 'slider used by a function domain');
    ctx.setParams([param('a', 1)]);
    assert.notEqual(ctx.depsKey(['a*x']), k1);
    ctx.setParams([param('a', 2), param('b', 3)]);
    assert.equal(ctx.depsKey(['a*x']), k1);
    const d1 = ctx.depsKey(['x <= P1_x']);
    ctx.setDerived({ P1_x: 2 });
    assert.notEqual(ctx.depsKey(['x <= P1_x']), d1, 'derived values');
    assert.notEqual(ctx.depsKey(['f1(x)']), chart({ variables: 'q, p' }).depsKey(['f1(x)']), 'variables');
    const other = chart({ functions: [fn('f1', '2x + 2')] });
    assert.notEqual(other.depsKey(['f1(x)']), ctx.depsKey(['f1(x)']), 'function source');
});

// ------------------------------------------------------------ validate

test('validate: every field kind, positions and fixes', () => {
    const ctx = chart();
    const withK = () => MathContext.create({ parameters: [param('k', 2)] });
    const ok = (src: string, kind: Parameters<MathContext['validate']>[1], fnKind?: 'cartesian' | 'parametric' | 'polar') =>
        assert.ok(ctx.validate(src, kind, fnKind).ok, `${kind}: ${src}`);
    ok('a x^2 + f1', 'fn1');
    ok('t^2 + x', 'fn1', 'parametric');
    ok('x y + f2', 'fn2');
    ok('a + 1', 'value');
    ok('', 'domain');
    ok('0:2pi', 'domain');
    ok('', 'condition');
    ok('x + y <= c or y >= 0', 'condition');
    ok('2x + 3y = c', 'equation');
    ok('1, 2, c', 'levels');
    ok('', 'levels');
    ok('(1, 2); (a, b)', 'tuples2');
    ok('(1, 2, 3)', 'tuples3');
    ok('P1; (1, 2)', 'path2');
    ok('(1, 2, 3); R1', 'path3');
    ok('', 'template');
    ok('a = {a:2}, {P1_x}', 'template');
    // Templates are checked with the locals the label actually gets (as formatTemplate is called).
    assert.ok(ctx.validate('({x}, {y}) val {val:2} #{i} z={z}', 'template', undefined, LABEL_LOCALS.points3).ok);
    assert.ok(ctx.validate('Optimum at ({x:1}, {y:1})', 'template', undefined, LABEL_LOCALS.points2).ok);
    assert.ok(ctx.validate('level {level}', 'template', undefined, LABEL_LOCALS.curve).ok);
    let t = fail(ctx.validate('Max at {x}', 'template'));
    assert.equal(t.message, '{x} is only available in point labels');
    assert.equal(t.pos, 8);
    assert.equal(t.fix, undefined);
    assert.equal(fail(ctx.validate('{val:2}', 'template', undefined, LABEL_LOCALS.plain)).message, '{val} is only available in point labels');
    assert.equal(fail(ctx.validate('{level}', 'template', undefined, LABEL_LOCALS.points2)).message, '{level} is only available in curve labels');
    assert.equal(fail(ctx.validate('{z}', 'template', undefined, LABEL_LOCALS.points2)).message, '{z} is only available in 3D point labels');
    // Nothing provides {n}: it is an ordinary unknown name.
    assert.equal(fail(ctx.validate('{n}', 'template', undefined, LABEL_LOCALS.points2)).fix?.addParameter, 'n');
    // validate and formatTemplate agree: a failing template renders '?', a valid one does not.
    assert.equal(ctx.formatTemplate('Max at {x}'), 'Max at ?');
    assert.equal(ctx.formatTemplate('({x:1}, {y:1})', { x: 1, y: 2, val: 3, i: 1 }), '(1, 2)');
    // 'kx' in a title is no 'Use k*x' trap: x is not available there.
    t = fail(withK().validate('Value {kx}', 'template'));
    assert.equal(t.message, "Unknown name 'kx'. x is not available here: this field takes a number");
    assert.equal(t.fix, undefined);
    assert.equal(fail(ctx.validate('', 'fn1')).message, 'Enter an expression');
    assert.equal(fail(ctx.validate('', 'value')).message, 'Enter a value');
    assert.equal(fail(ctx.validate('y', 'fn1', 'parametric')).message, 'y is not available here: x(t) and y(t) use t only');
    assert.equal(fail(ctx.validate('2:1', 'domain')).message, 'Domain min must be less than max');
    assert.equal(fail(ctx.validate('x <= 1 or', 'condition')).pos, 9);
    assert.equal(fail(ctx.validate('', 'equation')).message, 'Enter an equation, e.g. 2x + 3y = 12');
    let r = fail(ctx.validate('1, 2, k', 'levels'));
    assert.equal(r.message, "value 3: Unknown name 'k'");
    assert.equal(r.pos, 6);
    assert.equal(fail(ctx.validate('(1,2);(3)', 'tuples2')).message, 'point 2: write it as (x, y)');
    assert.equal(fail(ctx.validate('Q', 'path2')).message, "point 1: 'Q' is not a points tool");
    r = fail(ctx.validate('{a} and {k}', 'template'));
    assert.equal(r.pos, 9);
    assert.equal(r.unknown, 'k');
    r = fail(ctx.validate('Value {ab}', 'template'));
    assert.deepEqual(r.fix, { label: 'Use a*b', rewrite: 'Value {a*b}' });
    assert.equal(fail(ctx.validate('open {a', 'template')).message, "Missing '}' in the label");
    assert.equal(fail(ctx.validate('empty {}', 'template')).message, 'Empty {} in the label');
    // Validation runs the evaluator's own code path: same verdict, same message.
    for (const src of ['a x', 'ax', 'k', 'f1(', 'p(1)', '2 +']) {
        const v = ctx.validate(src, 'fn1');
        let thrown: string | null = null;
        try {
            ctx.fn1(src);
        } catch (e) {
            thrown = (e as Error).message;
        }
        assert.equal(v.ok ? null : v.message, thrown, src);
    }
});

// ------------------------------------------------------------ translate

test('pgf and tex through the context', () => {
    const ctx = chart({ toolNames: ['P1'] });
    assert.equal(ctx.pgf('f2(x)', 'fn1'), '(((x)>=(0)) && ((x)<=(3))) ? (x^2) : nan');
    ctx.setParams([param('b', 4.5)]);
    assert.equal(ctx.pgf('f2(x)', 'fn1'), '(((x)>=(0)) && ((x)<=(4.5))) ? (x^2) : nan', 'guard follows the slider');
    ctx.setParams([param('b', 3)]);
    assert.equal(ctx.pgf('h(x) + f5', 'fn1'), '(x/2)+(((2*x)+1)*2)', 'hidden functions are inlined');
    ctx.setDerived({ P1_x: -2 });
    assert.equal(ctx.pgf('x + P1_x', 'fn1'), 'x+(-2)');
    assert.equal(ctx.pgf('cos(t)', 'fn1', { fnKind: 'parametric' }), 'cos(x)');
    assert.equal(ctx.pgf('a x + b y', 'fn2', { outVars: ['x', 'y'] }), '(2*x)+(3*y)');
    assert.equal(ctx.pgf('c / 4', 'value'), '12/4');
    throws(() => ctx.pgf('p(1)', 'fn1'), 'p is parametric and cannot be called');
    throws(() => ctx.pgf('ax', 'fn1'), "Unknown name 'ax'. Did you mean a*x?");
    assert.equal(ctx.tex('a x^2 + f1(x)'), 'a x^{2} + f_{1}(x)');
    assert.equal(ctx.tex('x + y <= 4'), 'x + y \\le 4');
    assert.equal(ctx.tex('50% (x'), '\\mbox{50\\% (x}');
});

// ------------------------------------------------------------- numerics

test('findExtrema1D: smooth extrema, plateaus, poles and jumps', () => {
    const cubic = findExtrema1D((x) => x ** 3 - 3 * x, -3, 3);
    assert.equal(cubic.length, 2);
    assert.equal(cubic[0].type, 'maximum');
    near(cubic[0].x, -1, 1e-6);
    near(cubic[0].y, 2, 1e-12);
    assert.equal(cubic[1].type, 'minimum');
    near(cubic[1].x, 1, 1e-6);
    const sin = findExtrema1D(Math.sin, 0, 4 * Math.PI);
    assert.deepEqual(sin.map((e) => e.type), ['maximum', 'minimum', 'maximum', 'minimum']);
    sin.forEach((e, i) => near(e.x, (0.5 + i) * Math.PI, 1e-6));
    near(findExtrema1D(Math.abs, -1, 2)[0].x, 0, 1e-9);
    near(findExtrema1D((x) => Math.sqrt(Math.abs(x)), -3, 3.1)[0].x, 0, 1e-6);
    near(findExtrema1D((x) => 1000 * Math.abs(x - 0.3), -1, 2)[0].x, 0.3, 1e-9);
    near(findExtrema1D((x) => Math.exp(-100 * x * x), -3, 3.1)[0].x, 0, 1e-6);
    assert.equal(findExtrema1D((x) => Math.min(1, 2 - Math.abs(x)), -3, 3).length, 1, 'plateau');
    assert.equal(findExtrema1D((x) => Math.sin(50 * x), 0, 1).length, 16);
    assert.ok(findExtrema1D((x) => Math.sin(50 * x), 0, 1, 3).length <= 2, 'sample count');
    // No fake extrema at poles, jumps or the edges of a NaN region.
    for (const [name, f] of [
        ['tan', Math.tan],
        ['1/x', (x: number) => 1 / x],
        ['1/x^2', (x: number) => 1 / (x * x)],
        ['ln|x|', (x: number) => Math.log(Math.abs(x))],
        ['x % 1', (x: number) => x % 1],
        ['floor', Math.floor],
        ['const', () => 1],
    ] as Array<[string, (x: number) => number]>) {
        assert.deepEqual(findExtrema1D(f, -3.05, 4.3), [], name);
    }
    const half = findExtrema1D((x) => (x < 0 ? NaN : (x - 1) ** 2), -2, 3);
    assert.equal(half.length, 1);
    near(half[0].x, 1, 1e-6);
    assert.deepEqual(findExtrema1D(Math.sin, 1, 1), []);
    assert.deepEqual(findExtrema1D(Math.sin, NaN, 1), []);
});

test('domains, tangent-point style values and compile caching', () => {
    const ctx = new MathContext({});
    assert.deepEqual(ctx.domain('0:2*PI'), [0, 2 * Math.PI]);
    assert.throws(() => ctx.domain('1'), /min:max/);
    assert.throws(() => ctx.domain('2:1'), /less than/);
    near(ctx.value('PI/2'), Math.PI / 2);
    assert.ok(!ctx.tryValue('k').ok);
    assert.equal(ctx.fn1('x^2', 'cartesian'), ctx.fn1('x^2', 'cartesian'), 'compiled closures are cached');
    assert.equal(ctx.fn1('Math.sqrt(x)')(16), 4);
    assert.equal(ctx.fn2('x - y')(2, 3), -1);
    assert.throws(() => ctx.fn1('y'), /not available/);
    assert.deepEqual(findExtrema1D(ctx.fn1('x^3 - 3*x'), -3, 3).map((e) => [Math.round(e.x * 1e6) / 1e6, e.type]), [
        [-1, 'maximum'],
        [1, 'minimum'],
    ]);
});

// ------------------------------------------------- drag engine additions (SPEC3 4.1)

test('envFor: the Env each field kind compiles against', () => {
    const ctx = chart({ variables: 'x1, x2' });
    assert.deepEqual(ctx.envFor('fn1').vars, [['x', 'x1']]);
    assert.deepEqual(ctx.envFor('fn1', 'parametric').vars, [['t', 'x']]);
    assert.deepEqual(ctx.envFor('fn1', 'polar').vars, [['theta', 'θ', 'x', 't']]);
    assert.deepEqual(ctx.envFor('fn2').vars, [['x', 'x1'], ['y', 'x2']]);
    assert.deepEqual(ctx.envFor('value').vars, []);
    assert.equal(ctx.envFor('fn2'), ctx.envFor('fn2'), 'cached like the private envs');
    // Compiling with it gives the same closure values as the context.
    const src = 'a x1 + f1(x2)';
    const f = compile(parse(src), ctx.envFor('fn2'), src);
    assert.equal(f(1, 2), ctx.fn2(src)(1, 2));
    assert.equal(f(1, 2), 2 + 5);
});

test('setParamValues: by name, in place, version bumps only on change', () => {
    const ctx = new MathContext({ parameters: [param('a', 1), param('b', 2)] });
    const f = ctx.fn1('a x + b');
    const v0 = ctx.version;
    ctx.setParamValues({ a: 3, zz: 9 });
    assert.equal(ctx.version, v0 + 1);
    assert.equal(f(2), 8, 'closures read the new value');
    assert.equal(ctx.paramsKey, 'a=3|b=2');
    ctx.setParamValues({ a: 3 });
    assert.equal(ctx.version, v0 + 1, 'no change, no bump');
    ctx.setParamValues({ zz: 1 });
    assert.equal(ctx.version, v0 + 1, 'unknown names are ignored');
    ctx.setParamValues({ b: -1, a: 0 });
    assert.equal(f(5), -1);
    assert.equal(ctx.version, v0 + 2);
});

test('derivedValues: a copy of the derived values', () => {
    const ctx = chart();
    ctx.setDerived({ P1_x: 3, P1_y: 1, P1_val: 9 });
    const d = ctx.derivedValues();
    assert.deepEqual(d, { P1_x: 3, P1_y: 1, P1_val: 9 });
    d.P1_x = 100;
    assert.equal(ctx.value('P1_x'), 3, 'mutating the copy changes nothing');
    // Freezing them in a private context (the drag session's pattern).
    const priv = new MathContext({ parameters: [param('a', 2)], toolNames: ['P1', 'R1'] });
    priv.setDerived(ctx.derivedValues());
    assert.equal(priv.value('P1_val + a'), 11);
});

test('create(..., { memo: false }): a fresh context, the memo untouched', () => {
    const input = (k: number): MathContextInput => ({ parameters: [param('memo' + k, 1)] });
    const first = MathContext.create(input(0));
    // Fill the LRU (16 entries) so `first` is the oldest entry.
    for (let k = 1; k < 16; k++) MathContext.create(input(k));
    const fresh = MathContext.create(input(100), { memo: false });
    const again = MathContext.create(input(100), { memo: false });
    assert.notEqual(fresh, again, 'never shared');
    assert.equal(fresh.value('memo100'), 1);
    // Had the fresh context been stored, the oldest entry would have been evicted.
    assert.equal(MathContext.create(input(0)), first, 'memo:false neither inserts nor evicts');
    // A memo:false call with a cached structure does not return the cached instance either.
    assert.notEqual(MathContext.create(input(0), { memo: false }), first);
    assert.equal(MathContext.create(input(0), { memo: true }), first);
    // SettingsManager passes the option through and exposes the input it uses.
    const mgr = SettingsManager.fromJSON({ parameters: [param('k', 4)], tools: [] });
    const memo = mgr.createMathContext();
    assert.equal(mgr.createMathContext(), memo);
    const own = mgr.createMathContext({ memo: false });
    assert.notEqual(own, memo);
    assert.equal(own.value('k'), 4);
    assert.deepEqual(mgr.mathContextInput().parameters?.map((p) => p.name), ['k']);
    assert.equal(new MathContext(mgr.mathContextInput()).value('2k'), 8);
});

/** conditions()'s clause text for a node (whitespace collapsed, unicode operators in ASCII). */
function clauseText(src: string, n: Node): string {
    return src.slice(n.s, n.e).replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=').replace(/\s+/g, ' ').trim();
}

test('conditionClauseNodes: same DNF shape and order as conditions() (EXAMPLES and DNF cases)', () => {
    const cases: Array<{ ctx: MathContext; src: string }> = [];
    for (const ex of EXAMPLES) {
        if (ex.is3D) continue;
        const mgr = SettingsManager.fromJSON(ex.data);
        const ctx = mgr.createMathContext();
        for (const t of mgr.getValue<Tool[]>('tools')) {
            if (t.type !== 'region') continue;
            for (const src of t.conditions) if (src.trim()) cases.push({ ctx, src });
        }
    }
    assert.ok(cases.length >= 10, `examples give ${cases.length} conditions`);
    const plainCtx = chart();
    for (const src of [
        'x + y <= 4',
        'x >= 0, y >= 0',
        '0 <= x≤4',
        'x <= 1 or x >= 3, y >= 0',
        '!(x > 1 and y > 1)',
        '(x <= 1 || x >= 3) && (y <= 1 || y >= 3)',
        '!(0 <= x <= 1)',
        'x < 1; y > a',
        '0 <= x <= y <= 4',
    ]) {
        cases.push({ ctx: plainCtx, src });
    }
    for (const { ctx, src } of cases) {
        const nodes = conditionClauseNodes(src);
        const entry = ctx.conditions([src])[0];
        assert.equal(nodes.length, entry.disjuncts.length, `${src}: disjuncts`);
        const env = ctx.envFor('fn2');
        nodes.forEach((clauses, d) => {
            assert.equal(clauses.length, entry.disjuncts[d].length, `${src}: clauses of disjunct ${d}`);
            clauses.forEach((c, k) => {
                const ref = entry.disjuncts[d][k];
                assert.equal(`${clauseText(src, c.lhs)} ${c.op} ${clauseText(src, c.rhs)}`, ref.text, `${src} [${d}][${k}]`);
                const le = c.op === '<' || c.op === '<=';
                const lhs = compile(c.lhs, env, src);
                const rhs = compile(c.rhs, env, src);
                for (const [x, y] of [[0.5, 0.25], [2, 1], [-1, 3]]) {
                    const g = le ? lhs(x, y) - rhs(x, y) : rhs(x, y) - lhs(x, y);
                    const want = ref.g(x, y);
                    assert.ok(Object.is(g, want) || Math.abs(g - want) <= 1e-12, `${src} [${d}][${k}] g(${x}, ${y})`);
                }
            });
        });
    }
    assert.throws(() => conditionClauseNodes(''), ExprError);
    assert.throws(() => conditionClauseNodes('x = 2'), /not =/);
    assert.throws(() => conditionClauseNodes('x + 1'), /is not a condition/);
});
