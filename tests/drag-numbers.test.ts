/* Tests for src/drag/numbers.ts (SPEC3 2.1, 2.2, 3, 6.1 owner B). */
import { assert, test } from './_lib';
import { MathContext } from '../src/mathcontext';
import { EXAMPLES } from '../src/migrate';
import type { FunctionParameters, Parameter } from '../src/types';
import {
    compileNumbers,
    discoverNumbers,
    formatValue,
    makeSliderEdit,
    mirrorEdits,
    normalizedTokens,
    outputSide,
    parseUnit,
    previewFields,
    rewriteUnits,
    variableSide,
} from '../src/drag/numbers';
import { priorityOrder } from '../src/drag/solver';
import type { ParsedUnit } from '../src/drag/numbers';
import type { DragNumber, FieldRef, UnitSpec, VirtualKind } from '../src/drag/types';

// ------------------------------------------------------------------ helpers

const ALL_VIRTUAL: VirtualKind[] = ['add', 'factor', 'shiftVar', 'scaleVar'];

function param(name: string, value: number, min = -10, max = 10, step = 0.1): Parameter {
    return { name, value, min, max, step };
}

function fn(name: string, expression: string): FunctionParameters {
    return { name, expression, domain: '' } as FunctionParameters;
}

function context(params: Parameter[] = [], functions: FunctionParameters[] = []): MathContext {
    return new MathContext({ parameters: params, functions, toolNames: ['P1', 'P2', 'C1', 'R1'] });
}

const BODY: FieldRef = { kind: 'function', name: 'f1', field: 'expression' };
const EQ: FieldRef = { kind: 'tool', id: 't1', field: 'equation' };
const COND: FieldRef = { kind: 'tool', id: 't0', field: 'condition', entry: 0 };
const LEVELS: FieldRef = { kind: 'tool', id: 't1', field: 'levels' };
const POINTS: FieldRef = { kind: 'tool', id: 't2', field: 'points' };
const PATH: FieldRef = { kind: 'tool', id: 't3', field: 'path' };
const LABEL_X: FieldRef = { kind: 'label', index: 0, field: 'x' };
const OBJECTIVE: FieldRef = { kind: 'tool', id: 't3', field: 'objective' };

function bodySpec(): UnitSpec {
    return { ref: BODY, role: 'body', fnKind: 'cartesian' };
}

function clauseSpec(disjunct = 0, clause = 0): UnitSpec {
    return { ref: COND, role: 'clause', disjunct, clause };
}

interface Setup {
    math: MathContext;
    units: ParsedUnit[];
    numbers: DragNumber[];
}

function setup(
    specs: UnitSpec[],
    text: string,
    opts: { params?: Parameter[]; functions?: FunctionParameters[]; virtual?: VirtualKind[]; sliders?: boolean; axisSliders?: string[] } = {}
): Setup {
    const math = context(opts.params, opts.functions);
    const units = specs.map((s) => {
        const u = parseUnit(s, text, math);
        assert.ok(u, `unit ${s.role} in '${text}'`);
        return u as ParsedUnit;
    });
    const sliders = new Map<string, Parameter>();
    for (const p of opts.params || []) if (!(opts.axisSliders || []).includes(p.name)) sliders.set(p.name, p);
    const numbers = discoverNumbers(units, {
        sliders,
        allowSliders: opts.sliders !== false,
        virtual: opts.virtual || ALL_VIRTUAL,
    });
    return { math, units, numbers };
}

/**
 * Selector of one number: 'lit:3' (first literal labelled 3), 'lit:3#2' (second), 'fold:1/2', 'slider:a',
 * 'add', 'factor' (first factor), 'factor#2', 'shift:0', 'scale:1'.
 */
function pick(numbers: DragNumber[], sel: string): number {
    const [head, nth] = sel.split('#');
    const n = nth ? Number(nth) : 1;
    let count = 0;
    for (let i = 0; i < numbers.length; i++) {
        const d = numbers[i];
        let hit = false;
        if (head.startsWith('lit:')) hit = d.kind === 'literal' && d.label === head.slice(4);
        else if (head.startsWith('fold:')) hit = d.kind === 'folded' && d.label === head.slice(5);
        else if (head.startsWith('slider:')) hit = d.kind === 'slider' && d.label === head.slice(7);
        else if (head === 'add') hit = d.virtual?.kind === 'add';
        else if (head === 'factor') hit = d.virtual?.kind === 'factor';
        else if (head.startsWith('shift:')) hit = d.virtual?.kind === 'shiftVar' && d.virtual.axis === Number(head.slice(6));
        else if (head.startsWith('scale:')) hit = d.virtual?.kind === 'scaleVar' && d.virtual.axis === Number(head.slice(6));
        if (hit && ++count === n) return i;
    }
    throw new Error(`no number '${sel}' in [${numbers.map((d) => d.id).join(', ')}]`);
}

const DEFAULT_SAMPLES = [
    { x: -2.3, y: 1.1 },
    { x: -1.1, y: -0.7 },
    { x: 0.4, y: 2.2 },
    { x: 1.3, y: 0.9 },
    { x: 2.6, y: -1.4 },
    { x: 3.7, y: 3.1 },
];

function rewrite(
    s: Setup,
    assign: Array<[string, number, number?]>,
    opts: { tidy?: boolean; twins?: Array<{ unit: number; ref: FieldRef; text: string }> } = {}
): { fields: ReturnType<typeof rewriteUnits>; text: string } {
    const ev = compileNumbers(s.units, s.numbers, s.math);
    const values = Float64Array.from(s.numbers.map((d) => d.value0));
    const steps = new Float64Array(s.numbers.length).fill(1e-6);
    for (const [sel, v, step] of assign) {
        const i = pick(s.numbers, sel);
        values[i] = v;
        if (step !== undefined) steps[i] = step;
    }
    ev.values.set(values);
    ev.apply();
    const fields = rewriteUnits(s.units, s.numbers, values, steps, ev, s.math, {
        tidy: !!opts.tidy,
        samples: s.units.map(() => DEFAULT_SAMPLES),
        twins: opts.twins,
    });
    for (const f of fields) if (f.ref.kind !== 'tool' || f.ref.field !== 'objective') assert.equal(f.failed, false, `safety net failed for '${f.text}'`);
    return { fields, text: fields[0].text };
}

function rwBody(text: string, assign: Array<[string, number, number?]>, opts: Parameters<typeof setup>[2] & { tidy?: boolean } = {}): string {
    return rewrite(setup([bodySpec()], text, opts), assign, opts).text;
}

function rwClause(text: string, clause: [number, number], assign: Array<[string, number, number?]>, opts: { tidy?: boolean } = {}): string {
    return rewrite(setup([clauseSpec(clause[0], clause[1])], text), assign, opts).text;
}

function rwEq(text: string, assign: Array<[string, number, number?]>, opts: Parameters<typeof setup>[2] & { tidy?: boolean } = {}): string {
    return rewrite(setup([{ ref: EQ, role: 'equation' }], text, opts), assign, opts).text;
}

function ids(numbers: DragNumber[], kind?: DragNumber['kind']): string[] {
    return numbers.filter((d) => !kind || d.kind === kind).map((d) => d.label);
}

// ------------------------------------------------------------------ parseUnit

test('parseUnit: roles, sides, envs and nulls', () => {
    const math = context([param('c', 9)]);
    const body = parseUnit(bodySpec(), '2x + 1', math);
    assert.ok(body);
    assert.equal(body?.env, 'fn1');
    assert.deepEqual(body?.vars, [['x']]);
    const eq = parseUnit({ ref: EQ, role: 'equation' }, '2x + 3y = c', math);
    assert.ok(eq?.sides);
    assert.equal(eq?.env, 'fn2');
    assert.deepEqual(variableSide(eq as ParsedUnit), [0, 7]);
    const clause = parseUnit(clauseSpec(0, 2), 'x + y <= 4, x >= 1', math);
    assert.equal(clause, null, 'clause index out of range');
    const ge = parseUnit({ ref: COND, role: 'clause', disjunct: 0, clause: 1 }, 'x + y <= 4; x >= 1', math);
    assert.ok(ge);
    assert.equal(ge?.sides?.le, false);
    assert.equal(parseUnit(bodySpec(), '2x +', math), null, 'syntax error');
    assert.equal(parseUnit({ ref: LEVELS, role: 'levelItem', item: 3 }, '1, 2', math), null);
    const tup = parseUnit({ ref: POINTS, role: 'tupleCoord', item: 1, coord: 0 }, '(1, 1); (3, 2)', math);
    assert.equal(tup?.owned.t, 'num');
    assert.equal(parseUnit({ ref: PATH, role: 'tupleCoord', item: 0, coord: 0 }, 'P1; (3, 2)', math), null, 'spliced entry');
    const bare = parseUnit({ ref: EQ, role: 'equation' }, 'x^2 + y^2', math);
    assert.equal(bare?.sides, null);
    assert.deepEqual(variableSide(bare as ParsedUnit), [0, 9]);
    const both = parseUnit({ ref: EQ, role: 'equation' }, 'y = x^2', math);
    assert.equal(variableSide(both as ParsedUnit), null, 'both sides have variables: no twin side');
});

test('parseUnit: style sniffing', () => {
    const math = context();
    const st = (t: string) => parseUnit(bodySpec(), t, math)?.style;
    assert.deepEqual(st('2x + 1'), { implicitMul: true, spacedOps: true });
    assert.deepEqual(st('2*x+1'), { implicitMul: false, spacedOps: false });
    assert.deepEqual(st('sin(x)'), { implicitMul: true, spacedOps: true }, 'no evidence: implicit and spaced');
    assert.deepEqual(st('x(x+1) + 2'), { implicitMul: true, spacedOps: false }, 'one of two spaced is not more than half');
    const cond = parseUnit(clauseSpec(), 'x + 3y <= 6', math)?.style;
    assert.deepEqual(cond, { implicitMul: true, spacedOps: true });
});

// ------------------------------------------------------------------ discovery

test('discovery: exponent literals excluded, base free', () => {
    let s = setup([bodySpec()], 'x^2');
    assert.deepEqual(ids(s.numbers, 'literal'), []);
    s = setup([{ ref: LABEL_X, role: 'value' }], '2^2');
    assert.deepEqual(
        s.numbers.filter((d) => d.kind === 'literal').map((d) => d.pos),
        [0],
        'only the base of 2^2'
    );
    s = setup([bodySpec()], 'e^(0.5x)');
    assert.deepEqual(ids(s.numbers, 'literal'), ['0.5'], 'exponent with a variable keeps its literals');
    s = setup([bodySpec()], 'x^(1/2) + x^a', { params: [param('a', 2)] });
    assert.deepEqual(ids(s.numbers, 'folded'), [], 'folded in a variable-free exponent');
    assert.deepEqual(ids(s.numbers, 'slider'), ['a'], 'sliders in exponents stay numbers');
});

test('discovery: named constants and slider products own their literals', () => {
    for (const t of ['2pi', '2*pi', 'pi/2', '2π', '3e', 'sin(2pi x)', '2*Math.PI']) {
        const s = setup([bodySpec()], t);
        assert.deepEqual(ids(s.numbers, 'literal'), [], t);
    }
    let s = setup([{ ref: POINTS, role: 'tupleCoord', item: 0, coord: 0 }, { ref: POINTS, role: 'tupleCoord', item: 0, coord: 1 }], '(a, 2a)', {
        params: [param('a', 1, 0, 3, 0.05)],
        virtual: [],
    });
    assert.deepEqual(
        s.numbers.map((d) => `${d.kind}:${d.label}`),
        ['slider:a'],
        '(a, 2a): only slider a'
    );
    s = setup([bodySpec()], '2a x + a/2 + 3', { params: [param('a', 1)] });
    assert.deepEqual(ids(s.numbers, 'literal'), ['3']);
    s = setup([bodySpec()], '2c x + 1', { params: [param('c', 1)], axisSliders: ['c'] });
    assert.deepEqual(ids(s.numbers, 'literal'), ['1'], 'an axis slider still owns its literal factor');
    assert.deepEqual(ids(s.numbers, 'slider'), [], 'axis sliders are excluded');
});

test('discovery: folded fractions', () => {
    const s = setup([bodySpec()], '1/2 x + 1');
    const f = s.numbers.filter((d) => d.kind === 'folded');
    assert.equal(f.length, 1);
    assert.equal(f[0].value0, 0.5);
    assert.equal(f[0].label, '1/2');
    assert.deepEqual(f[0].span, [0, 3]);
    const w = setup([bodySpec()], '2(1/2) x');
    assert.deepEqual(w.numbers.filter((d) => d.kind === 'folded').map((d) => [d.label, d.span]), [['1/2', [2, 5]]], 'the span is the division, not its parentheses');
    assert.equal(f[0].tier, 3);
    assert.deepEqual(ids(s.numbers, 'literal'), ['1'], 'the 1 and 2 of 1/2 are not numbers themselves');
});

test('discovery: roles', () => {
    let s = setup([bodySpec()], 'x^2 - 3x + 1');
    const role = (sel: string) => s.numbers[pick(s.numbers, sel)].role;
    assert.equal(role('lit:3'), 'coef');
    assert.equal(role('lit:1'), 'offset');
    assert.equal(role('add'), 'offset');
    assert.equal(role('factor'), 'coef');
    assert.equal(role('shift:0'), 'shift');
    assert.equal(role('scale:0'), 'coef');
    s = setup([bodySpec()], '(x - 3)^2 + 4');
    assert.equal(role('lit:3'), 'shift');
    assert.equal(role('lit:4'), 'offset');
    s = setup([bodySpec()], 'sin(x - 1) - 2');
    assert.equal(role('lit:1'), 'shift');
    assert.equal(role('lit:2'), 'offset', 'under the binary minus');
    s = setup([bodySpec()], '-3 + 10 - a*x', { params: [param('a', 1)] });
    assert.equal(role('lit:3'), 'offset', 'under a unary minus');
    assert.equal(role('slider:a'), 'coef');
    s = setup([{ ref: EQ, role: 'equation' }], '2x + 3y = c', { params: [param('c', 9)] });
    assert.equal(role('slider:c'), 'offset');
    assert.equal(role('lit:2'), 'coef');
    assert.equal(s.numbers[pick(s.numbers, 'slider:c')].unit, -1);
    assert.equal(s.numbers[pick(s.numbers, 'slider:c')].id, 's:c');
});

test('discovery: factors only for summands without a leading literal', () => {
    let s = setup([bodySpec()], 'x^2 - 3x + 1');
    let f = s.numbers.filter((d) => d.virtual?.kind === 'factor');
    assert.deepEqual(
        f.map((d) => d.pos),
        [0],
        'x^2 only'
    );
    s = setup([bodySpec()], '-x + 2(x + 1) + 1/2 x + x*3');
    f = s.numbers.filter((d) => d.virtual?.kind === 'factor');
    assert.deepEqual(
        f.map((d) => s.units[0].text.slice(d.pos, d.pos + 2)),
        ['-x', 'x*'],
        'leading literal and leading fraction get none'
    );
    s = setup([clauseSpec()], 'y <= x^2');
    f = s.numbers.filter((d) => d.virtual?.kind === 'factor');
    assert.deepEqual(
        f.map((d) => d.pos),
        [5],
        'y <= x^2: factor roots on the rhs'
    );
    s = setup([clauseSpec()], 'x + 3y <= 6');
    f = s.numbers.filter((d) => d.virtual?.kind === 'factor');
    assert.deepEqual(
        f.map((d) => d.pos),
        [0],
        'x + 3y <= 6: factor on x'
    );
});

test('discovery: frozen chain middles', () => {
    let s = setup([clauseSpec(0, 0)], '0 <= x + 1 <= 4');
    assert.deepEqual(ids(s.numbers, 'literal'), ['0']);
    s = setup([clauseSpec(0, 1)], '0 <= x + 1 <= 4');
    assert.deepEqual(ids(s.numbers, 'literal'), ['4']);
    assert.ok(!s.numbers.some((d) => d.virtual?.kind === 'shiftVar' || d.virtual?.kind === 'factor'), 'no shift or factor in the frozen x + 1');
    const add = s.numbers[pick(s.numbers, 'add')];
    assert.equal(add.virtual?.target?.s, 14, 'add targets the rhs');
    s = setup([clauseSpec(0, 1)], '0 <= x <= 2pi');
    assert.deepEqual(ids(s.numbers, 'literal'), [], '2 in 2pi excluded');
    assert.equal(s.numbers[pick(s.numbers, 'add')].virtual?.target?.s, 10);
});

test('discovery: virtual kinds follow the target and the units', () => {
    let s = setup([bodySpec()], 'sin(x)', { virtual: ['add', 'shiftVar'] });
    assert.deepEqual(
        s.numbers.map((d) => d.id),
        ['v:0:add', 'v:0:shift:0']
    );
    s = setup([{ ref: EQ, role: 'equation' }], 'x^2 + y^2 = 4');
    assert.deepEqual(
        s.numbers.filter((d) => d.kind === 'virtual').map((d) => d.id),
        ['v:0:add', 'v:0:factor@0', 'v:0:factor@6', 'v:0:shift:0', 'v:0:scale:0', 'v:0:shift:1', 'v:0:scale:1']
    );
    s = setup([{ ref: LEVELS, role: 'levelItem', item: 1 }], '1, 3.2, 6', { virtual: ALL_VIRTUAL });
    assert.deepEqual(
        s.numbers.map((d) => d.id),
        ['l:0@3'],
        'level items take no virtual numbers'
    );
    s = setup([{ ref: LABEL_X, role: 'value' }], 'P1_x', { virtual: ['add'] });
    assert.deepEqual(
        s.numbers.map((d) => d.id),
        ['v:0:add']
    );
    s = setup([{ ref: LABEL_X, role: 'value' }], 'a + 1', { params: [param('a', 1)], sliders: false, virtual: ['add'] });
    assert.deepEqual(
        s.numbers.map((d) => d.kind),
        ['literal', 'virtual'],
        'labels never take sliders'
    );
});

test('discovery: sliders are shared across units', () => {
    const math = context([param('a', 1)]);
    const units = [
        parseUnit({ ref: POINTS, role: 'tupleCoord', item: 0, coord: 0 }, '(a, a + 1)', math) as ParsedUnit,
        parseUnit({ ref: POINTS, role: 'tupleCoord', item: 0, coord: 1 }, '(a, a + 1)', math) as ParsedUnit,
    ];
    const numbers = discoverNumbers(units, { sliders: new Map([['a', param('a', 1)]]), allowSliders: true, virtual: [] });
    assert.deepEqual(
        numbers.map((d) => d.id),
        ['s:a', 'l:1@8']
    );
});

// ------------------------------------------------------------------ compile

test('compileNumbers: slots, sliders and identity', () => {
    const s = setup([bodySpec()], 'a*x^2 - 3x + 1', { params: [param('a', 2)] });
    const ev = compileNumbers(s.units, s.numbers, s.math);
    const f = ev.fns[0];
    assert.equal(f(2, NaN), 2 * 4 - 6 + 1);
    ev.values[pick(s.numbers, 'lit:3')] = 1;
    assert.equal(f(2, NaN), 8 - 2 + 1);
    ev.values[pick(s.numbers, 'slider:a')] = 1;
    ev.apply();
    assert.equal(f(2, NaN), 4 - 2 + 1);
    ev.values[pick(s.numbers, 'shift:0')] = 1;
    assert.equal(f(3, NaN), 4 - 2 + 1, 'x -> x - 1');
    ev.values[pick(s.numbers, 'add')] = 10;
    assert.equal(f(3, NaN), 4 - 2 + 1 + 10);
    ev.values[pick(s.numbers, 'factor')] = 3;
    assert.equal(f(3, NaN), 3 * 4 - 2 + 1 + 10);
});

test('compileNumbers: clause g and the twin side closure', () => {
    let s = setup([clauseSpec(0, 1)], 'x + y <= 4; 3 >= x');
    let ev = compileNumbers(s.units, s.numbers, s.math);
    assert.equal(ev.fns[0](1, 0), 1 - 3, 'g = rhs - lhs for >=');
    s = setup([{ ref: EQ, role: 'equation' }], '2x + 3y = c', { params: [param('c', 9)] });
    ev = compileNumbers(s.units, s.numbers, s.math);
    assert.equal(ev.fns[0](3, 1), 0);
    assert.equal(ev.sides?.[0]?.(3, 1), 9);
    ev.values[pick(s.numbers, 'lit:2')] = 2.5;
    assert.equal(ev.sides?.[0]?.(3, 1), 10.5);
});

// ------------------------------------------------------------------ formatValue

test('formatValue: steps, zeros, -0, exponents', () => {
    assert.equal(formatValue(0.8, 0.1, null), '0.8');
    assert.equal(formatValue(1.25, 0.1, null), '1.3');
    assert.equal(formatValue(2.5, 0.01, null), '2.5');
    assert.equal(formatValue(3, 1, null), '3');
    assert.equal(formatValue(2.0000001, 0.001, null), '2');
    assert.equal(formatValue(-1.5, 0.1, null), '-1.5');
    assert.equal(formatValue(-0.0001, 0.01, null), '0');
    assert.equal(formatValue(-0, 1, null), '0');
    assert.equal(formatValue(0.2, 0.5, null), '0', 'under half a step is 0');
    assert.equal(formatValue(1234.5, 0.1, '1e3'), '1.2345e3');
    assert.equal(formatValue(0.0025, 1e-4, '2e-3'), '2.5e-3');
    assert.equal(formatValue(1500, 1, '1E+3'), '1.5E+3');
    assert.equal(formatValue(0.000001, 1e-6, null), '0.000001', 'no exponent introduced');
    assert.equal(formatValue(123456.7, 0.1, null), '123456.7');
    assert.equal(formatValue(10, 1e-15, null), '10', 'at most 12 decimals');
    assert.equal(formatValue(1.433, 0.001, null), '1.433');
});

// ------------------------------------------------------------------ literals and signs

test('literals: plain writes keep everything else', () => {
    assert.equal(rwBody('2x + 1', [['lit:1', 0.8]]), '2x + 0.8');
    assert.equal(rwBody('2x + 1', [['lit:2', 1.5], ['lit:1', 1.5]]), '1.5x + 1.5');
    assert.equal(rwBody('0.5sin(2x) + 1', [['lit:1', 1.3]]), '0.5sin(2x) + 1.3');
    assert.equal(rwBody('x^2 - 3x + 1', [['lit:3', 4], ['lit:1', 3.75]]), 'x^2 - 4x + 3.75');
    assert.equal(rwBody('.5x +  010', [['lit:.5', 0.5], ['lit:010', 10]]), '.5x +  010', 'unchanged literals stay as typed');
    assert.equal(rwBody('(2)x', [['lit:2', 3]]), '(3)x');
    assert.equal(rwBody('1e3 x', [['lit:1e3', 1500]]), '1.5e3 x');
});

test('sign absorption (SPEC3 3.1)', () => {
    assert.equal(rwBody('x + 3', [['lit:3', -0.5]]), 'x - 0.5', 'a: flip');
    assert.equal(rwBody('x - 3', [['lit:3', -1]]), 'x + 1', 'a: flip back');
    assert.equal(rwBody('-x + 4', [['lit:4', -2]]), '-x - 2', 'a: row 16');
    assert.equal(rwBody('x - 3x^2', [['lit:3', -2]]), 'x + 2x^2', 'a: through left factors');
    assert.equal(rwBody('-3x + 2', [['lit:3', -1.2]]), '1.2x + 2', 'b: unary removed');
    assert.equal(rwBody('- 3x + 2', [['lit:3', -1.2]]), '1.2x + 2', 'b: spaces after the minus go too');
    assert.equal(rwBody('-3x + 2', [['lit:3', 0]]), '0x + 2', 'b: a written 0 deletes the unary minus');
    assert.equal(rwBody('x*3', [['lit:3', -2]]), 'x*(-2)', 'c: right of *');
    assert.equal(rwBody('x/3', [['lit:3', -2]]), 'x/(-2)', 'c: right of /');
    assert.equal(rwBody('3^x', [['lit:3', -2]]), '(-2)^x', 'c: base');
    assert.equal(rwBody('x*(3)', [['lit:3', -2]]), 'x*(-2)', 'c: already parenthesized');
    assert.equal(rwBody('3x + 1', [['lit:3', -2]]), '-2x + 1', 'd: leads');
    assert.equal(rwBody('sin(3x)', [['lit:3', -2]]), 'sin(-2x)', 'd: call argument');
    assert.equal(rwBody('-(3x + 1)', [['lit:3', -2]]), '-(-2x + 1)', 'no anchor through the left operand of +');
    assert.equal(rwBody('x − 3', [['lit:3', -1]]), 'x + 1', 'unicode minus flips');
    assert.equal(rwBody('x − 3', [['lit:3', 2]]), 'x − 2', 'unicode kept outside the edit');
    assert.equal(rwBody('+3x', [['lit:3', -2]]), '-2x', 'unary plus becomes the sign');
    assert.equal(rwBody('1/2 x + 1', [['fold:1/2', 0.65]]), '0.65 x + 1', 'folded');
    assert.equal(rwBody('x - 1/2 x^2', [['fold:1/2', -0.25]]), 'x + 0.25 x^2', 'folded flips');
    assert.equal(rwEq('x = 3', [['lit:3', -2]]), 'x = -2', 'the = of an equation is no anchor');
    assert.equal(rwClause('3 >= x', [0, 0], [['lit:3', -2]]), '-2 >= x', 'the clause root is no anchor');
});

test('fuzz regressions', () => {
    assert.equal(rwBody('(3^x) + 1', [['lit:3', -2]]), '((-2)^x) + 1', 'a ^ base right after a group paren keeps its own parentheses');
    assert.equal(rwBody('sin(2^x)', [['lit:2', -1]]), 'sin((-1)^x)');
    assert.equal(rwBody('x*(2x)', [['lit:2', -3]]), 'x*(-3x)', 'first factor of a parenthesized term');
    assert.equal(rwBody('0.5(2./1) + x', [['fold:2./1', 1]]), '0.5(1) + x', 'a parenthesized fraction keeps its parentheses');
    assert.equal(rwBody('x*(1/2)', [['fold:1/2', -0.25]]), 'x*(-0.25)');
    assert.equal(rwBody('(1/2)x + 1', [['fold:1/2', 1]], { tidy: true }), 'x + 1');
    assert.equal(rwBody('--x + 1', [['factor', 2]]), '--2x + 1', 'after the innermost sign');
    assert.equal(rwBody('--x + 1', [['factor', -2]]), '-2x + 1');
    assert.equal(rwBody('1/x(x)', [['shift:0', 1]]), '1/((x - 1)(x - 1))', 'a call split by its name keeps its place under /');
    assert.equal(rwBody('2^x(x)', [['scale:0', 2]]), '2^(2x(2x))', 'and in an exponent');
    assert.equal(rwBody('1 + x(x)', [['shift:0', 1]]), '1 + (x - 1)(x - 1)', 'products elsewhere need no guard');
    assert.equal(rwBody('a/x(x)', [['shift:0', 1], ['add', 2]], { params: [param('a', 1)] }), 'a/((x - 1)(x - 1)) + 2');
});

test('row 22, 23: unary removed, parenthesized negative', () => {
    assert.equal(rwBody('-3x + 2', [['lit:3', -1.2]]), '1.2x + 2');
    assert.equal(rwBody('x*3', [['lit:3', -2]]), 'x*(-2)');
});

// ------------------------------------------------------------------ virtual insertion

test('virtual: add, factor, shift and scale (SPEC3 3.2)', () => {
    assert.equal(rwBody('sin(x)', [['shift:0', 0.5], ['add', 0.5]]), 'sin(x - 0.5) + 0.5', 'row 12');
    assert.equal(rwBody('sin(x)', [['factor', 1.5]]), '1.5sin(x)', 'row 13');
    assert.equal(rwBody('0.5sin(2x) + 1', [['shift:0', 0.3], ['lit:1', 1.3]]), '0.5sin(2(x - 0.3)) + 1.3', 'row 14');
    assert.equal(rwBody('x^2 + 1', [['shift:0', 1]]), '(x - 1)^2 + 1', 'row 15');
    assert.equal(rwBody('e^(0.5x)', [['shift:0', 1], ['add', 1]]), 'e^(0.5(x - 1)) + 1', 'row 17');
    assert.equal(rwBody('x^2 - 3x + 1', [['factor', 1.433], ['lit:3', 4.3], ['lit:1', 2]]), '1.433x^2 - 4.3x + 2', 'row 11');
    assert.equal(rwBody('2x', [['shift:0', 0.3]]), '2(x - 0.3)');
    assert.equal(rwBody('x', [['shift:0', -2], ['add', -1]]), 'x + 2 - 1', 'root: no parentheses');
    assert.equal(rwBody('x + 1', [['scale:0', 1.77]]), '1.77x + 1');
    assert.equal(rwBody('x*2 + 1', [['scale:0', 1.77]]), '1.77*x*2 + 1', 'explicit style');
    assert.equal(rwBody('x*2 + 1', [['scale:0', 1.77], ['shift:0', 1]]), '1.77*(x - 1)*2 + 1');
    assert.equal(rwBody('sin(x)', [['scale:0', -0.5]]), 'sin(-0.5x)');
    assert.equal(rwBody('1 + x', [['scale:0', -0.5]]), '1 + (-0.5x)', 'a negative product never follows +');
    assert.equal(rwBody('1 - x', [['shift:0', 2]]), '1 - (x - 2)', 'right operand of - is wrapped');
    assert.equal(rwBody('x sin(x)', [['scale:0', 2]]), '2x sin(2x)', 'product as left operand of *');
    assert.equal(rwBody('sin(x)', [['factor', -1.5]]), '-1.5sin(x)');
    assert.equal(rwBody('1 + sin(x)', [['factor', -1.5]]), '1 - 1.5sin(x)', 'negative factor flips');
    assert.equal(rwBody('1 - x^2', [['factor', -2]]), '1 + 2x^2');
    assert.equal(rwBody('-x^2', [['factor', 2]]), '-2x^2', 'after the leading unary minus');
    assert.equal(rwBody('-x^2', [['factor', -2]]), '2x^2', 'negative: the unary minus goes');
    assert.equal(rwBody('-x*3 + 1', [['factor', 2]]), '-2*x*3 + 1', 'unary minus deep in the product (explicit style)');
    assert.equal(rwBody('-x*3 + 2x', [['factor', 2]]), '-2x*3 + 2x', 'unary minus deep in the product');
    assert.equal(rwBody('x % 3', [['factor', 2]]), '2(x % 3)', 'k * (a % b) keeps the summand whole');
    assert.equal(rwBody('x > 0 ? x : -x', [['factor', 2]]), '2(x > 0 ? x : -x)', 'low precedence summand');
    assert.equal(rwBody('x > 0 ? x : -x', [['add', 1]]), '(x > 0 ? x : -x) + 1', 'add wraps a ternary');
    assert.equal(rwBody('x', [['factor', 2], ['add', 1]]), '2x + 1');
});

test('virtual: safety rules (SPEC3 3.3)', () => {
    assert.equal(rwBody('2^x', [['factor', 1.5], ['add', -0.5]]), '1.5*2^x - 0.5', 'row 21, rule 1');
    assert.equal(rwBody('3^x', [['factor', 0.57743]]), '0.57743*3^x', 'rule 1');
    assert.equal(rwBody('x + sin(x)', [['factor', 1.5], ['shift:0', 1]]), '1.5(x - 1) + sin(x - 1)', 'row 32, rule 2');
    assert.equal(rwBody('(x) + 1', [['factor', 0.3], ['scale:0', 0.4]]), '0.3(0.4x) + 1', 'rule 2, group kept');
    assert.equal(rwBody('x sin(x)', [['factor', 0.3], ['scale:0', 0.4]]), '0.3(0.4x) sin(0.4x)', 'factor directly before a product');
    assert.equal(rwBody('-x', [['factor', 2], ['shift:0', 1]]), '-2(x - 1)');
});

test('virtual: a scale before an e1-like variable is joined with *', () => {
    const math = new MathContext({ variables: 'e1, y' });
    const u = parseUnit(bodySpec(), 'e1 + 1', math) as ParsedUnit;
    assert.deepEqual(u.vars, [['x', 'e1']]);
    const numbers = discoverNumbers([u], { sliders: new Map(), allowSliders: true, virtual: ALL_VIRTUAL });
    const r = rewrite({ math, units: [u], numbers }, [['scale:0', 2], ['factor', 3]]);
    assert.equal(r.text, '3(2*e1) + 1');
});

test('virtual: occurrences of normalized implicit calls and compact style', () => {
    assert.equal(rwBody('x(x + 1)', [['shift:0', 1]]), '(x - 1)(x - 1 + 1)');
    assert.equal(rwBody('x(x+1)', [['shift:0', 1]]), '(x-1)(x-1+1)', 'compact style kept');
    assert.equal(rwBody('x(x^2+1)', [['shift:0', 1]]), '(x-1)((x-1)^2+1)', 'row 33');
    assert.equal(rwBody('x(x+1)', [['lit:1', -1]]), 'x(x-1)', 'row 33 (literal)');
    assert.equal(rwBody('a(x - 1)^2', [['shift:0', 1]], { params: [param('a', 2)] }), 'a(x - 1 - 1)^2', 'Phase 0 power');
    assert.equal(rwBody('a x^2', [['shift:0', 1]], { params: [param('a', 2)] }), 'a (x - 1)^2');
    assert.equal(rwBody('x-1', [['add', 2]]), 'x-1+2', 'compact add');
});

test('virtual: a wrapped occurrence never becomes a function call', () => {
    const functions = [fn('f1', 'x^2'), fn('g', 'x + 1')];
    const s = setup([{ ref: { kind: 'function', name: 'g', field: 'expression' }, role: 'body', fnKind: 'cartesian' }], 'f1 x', { functions });
    const out = rewrite(s, [['shift:0', 1]]).text;
    assert.equal(out, 'f1 *(x - 1)');
});

test('clauses, equations, tuples, levels, labels', () => {
    assert.equal(rwClause('x + 3y <= 6', [0, 0], [['lit:6', 6.6]]), 'x + 3y <= 6.6', 'row 7');
    assert.equal(rwClause('x + 3y <= 6', [0, 0], [['lit:3', 2], ['lit:6', 5]]), 'x + 2y <= 5', 'row 8');
    assert.equal(rwClause('x + y <= 4', [0, 0], [['factor', 1.2], ['lit:4', 4.6]]), '1.2x + y <= 4.6', 'row 9');
    assert.equal(rwClause('(x - 3)^2 + (y - 2)^2 <= 2^2', [0, 0], [['lit:3', 3.5], ['lit:2', 2.6]]), '(x - 3.5)^2 + (y - 2.6)^2 <= 2^2', 'row 18');
    assert.equal(rwClause('(x - 3)^2 + (y - 2)^2 <= 2^2', [0, 0], [['lit:2#2', 2.5]]), '(x - 3)^2 + (y - 2)^2 <= 2.5^2', 'row 19');
    assert.equal(rwClause('0 <= x <= 4', [0, 1], [['lit:4', 4.5]]), '0 <= x <= 4.5', 'row 30');
    assert.equal(rwClause('0 <= x <= 2pi', [0, 1], [['add', 0.3]]), '0 <= x <= 2pi + 0.3', 'row 31');
    assert.equal(rwClause('x ≤ 4 − y', [0, 0], [['lit:4', 4.5]]), 'x ≤ 4.5 − y', 'row 36');
    assert.equal(rwClause('x ≤ 4 − y', [0, 0], [['shift:0', 0.5]]), 'x - 0.5 ≤ 4 − y', 'unicode kept around insertions');
    assert.equal(rwClause('x <= 1 or x >= 3, y >= 0', [1, 0], [['lit:3', 2.5]]), 'x <= 1 or x >= 2.5, y >= 0', 'DNF indices');
    assert.equal(rwEq('2x + 3y = 12', [['lit:2', 2.4], ['lit:12', 13.2]]), '2.4x + 3y = 13.2', 'row 6');
    assert.equal(rwEq('x^2 + y^2 = 4', [['shift:0', 0.5], ['shift:1', 0.7]]), '(x - 0.5)^2 + (y - 0.7)^2 = 4', 'row 20');
    assert.equal(rwEq('x^2 + y^2', [['add', -4]]), 'x^2 + y^2 - 4', 'bare equation');
    assert.equal(rwEq('y = x^2', [['factor', 2]]), 'y = 2x^2', 'factor on the rhs');
    // tuples
    let s = setup(
        [
            { ref: POINTS, role: 'tupleCoord', item: 1, coord: 0 },
            { ref: POINTS, role: 'tupleCoord', item: 1, coord: 1 },
        ],
        '(1, 1); (3, 2)',
        { virtual: [] }
    );
    assert.equal(rewrite(s, [['lit:3', 3.37], ['lit:2', 1.5]]).text, '(1, 1); (3.37, 1.5)', 'row 27');
    s = setup(
        [0, 1].flatMap((item) => [0, 1].map((coord) => ({ ref: PATH, role: 'tupleCoord' as const, item, coord: coord as 0 | 1 }))),
        '(0, 0); (3, 2)',
        { virtual: [] }
    );
    const r34 = rewrite(s, [['lit:0', 0.5], ['lit:0#2', 0.5], ['lit:3', 3.5], ['lit:2', 2.5]]);
    assert.equal(r34.fields.length, 1, 'units of one field are merged');
    assert.equal(r34.text, '(0.5, 0.5); (3.5, 2.5)', 'row 34');
    s = setup([{ ref: LEVELS, role: 'levelItem', item: 1 }], '1, 3.2, 6', { virtual: [] });
    assert.equal(rewrite(s, [['lit:3.2', 4.2]]).text, '1, 4.2, 6', 'row 28');
    s = setup([{ ref: LABEL_X, role: 'value' }], 'P1_x', { virtual: ['add'], sliders: false });
    assert.equal(rewrite(s, [['add', 0.4]]).text, 'P1_x + 0.4', 'row 29');
    s = setup([bodySpec()], '10 - a*x', { params: [param('a', 1, 0.5, 3, 0.05)] });
    assert.equal(rewrite(s, [['lit:10', 10.5]]).text, '10.5 - a*x', 'row 25 move');
    assert.equal(rewrite(s, [['lit:10', 12], ['slider:a', 1.5]]).text, '12 - a*x', 'row 25 turn: sliders are not text');
});

test('tidy at release (SPEC3 3.4)', () => {
    assert.equal(rwBody('2x + 1', [['lit:2', 1]]), '1x + 1', 'live frames keep the coefficient');
    assert.equal(rwBody('2x + 1', [['lit:2', 1]], { tidy: true }), 'x + 1', 'row 2');
    assert.equal(rwBody('2x + 1', [['lit:2', -1]], { tidy: true }), '-x + 1');
    assert.equal(rwBody('1 + 2x', [['lit:2', -1]], { tidy: true }), '1 - x');
    assert.equal(rwBody('-3x', [['lit:3', -1]], { tidy: true }), 'x');
    assert.equal(rwBody('-3x', [['lit:3', 1]], { tidy: true }), '-x');
    assert.equal(rwBody('2 sin(x)', [['lit:2', 1]], { tidy: true }), 'sin(x)');
    assert.equal(rwBody('1/2 x + 1', [['fold:1/2', 1]], { tidy: true }), 'x + 1', 'row 24');
    assert.equal(rwBody('2*x', [['lit:2', 1]], { tidy: true }), '1*x', 'explicit products stay');
    assert.equal(rwBody('2x + 1', [['lit:2', 0]], { tidy: true }), '0x + 1', '0x stays');
    assert.equal(rwBody('x + 3', [['lit:3', 0]], { tidy: true }), 'x + 0', 'a literal dragged to 0 stays');
    assert.equal(rwBody('sin(x)', [['factor', -1]], { tidy: true }), '-sin(x)');
    assert.equal(rwBody('1 + sin(x)', [['factor', -1]], { tidy: true }), '1 - sin(x)');
    assert.equal(rwBody('2^x', [['factor', -1]], { tidy: true }), '-2^x');
    assert.equal(rwBody('sin(x)', [['factor', 1], ['add', 0], ['shift:0', 0], ['scale:0', 1]], { tidy: true }), 'sin(x)', 'identities never written');
    assert.equal(rwBody('x + 1', [['scale:0', -1]], { tidy: true }), '-x + 1');
});

test('SPEC3 3.8: every before / after row at the rewrite level (final numbers given)', () => {
    const c9 = [param('c', 9, 0, 15, 0.1)];
    const a1 = [param('a', 1, 0.5, 3, 0.05)];
    const tuple = (text: string, items: Array<[number, 0 | 1]>, ref: FieldRef = POINTS) =>
        setup(
            items.map(([item, coord]) => ({ ref, role: 'tupleCoord' as const, item, coord })),
            text,
            { virtual: [], params: [param('a', 1, 0, 3, 0.05)] }
        );
    const rows: Array<[number, () => string, string]> = [
        [1, () => rwBody('2x + 1', [['lit:1', 0.8]]), '2x + 0.8'],
        [2, () => rwBody('2x + 1', [['lit:2', 1]], { tidy: true }), 'x + 1'],
        [3, () => rwBody('2x + 1', [['lit:2', 1.5], ['lit:1', 1.5]]), '1.5x + 1.5'],
        [4, () => rwEq('2x + 3y = c', [['slider:c', 10.2]], { params: c9 }), '2x + 3y = c'],
        [5, () => rwEq('2x + 3y = c', [['lit:2', 2.5], ['slider:c', 10.5]], { params: c9 }), '2.5x + 3y = c'],
        [6, () => rwEq('2x + 3y = 12', [['lit:2', 2.4], ['lit:12', 13.2]]), '2.4x + 3y = 13.2'],
        [7, () => rwClause('x + 3y <= 6', [0, 0], [['lit:6', 6.6]]), 'x + 3y <= 6.6'],
        [8, () => rwClause('x + 3y <= 6', [0, 0], [['lit:3', 2], ['lit:6', 5]]), 'x + 2y <= 5'],
        [9, () => rwClause('x + y <= 4', [0, 0], [['factor', 1.2], ['lit:4', 4.6]]), '1.2x + y <= 4.6'],
        [10, () => rwBody('x^2 - 3x + 1', [['lit:3', 4], ['lit:1', 3.75]]), 'x^2 - 4x + 3.75'],
        [11, () => rwBody('x^2 - 3x + 1', [['factor', 1.433], ['lit:3', 4.3], ['lit:1', 2]]), '1.433x^2 - 4.3x + 2'],
        [12, () => rwBody('sin(x)', [['shift:0', 0.5], ['add', 0.5]]), 'sin(x - 0.5) + 0.5'],
        [13, () => rwBody('sin(x)', [['factor', 1.5]]), '1.5sin(x)'],
        [14, () => rwBody('0.5sin(2x) + 1', [['lit:1', 1.3]]), '0.5sin(2x) + 1.3'],
        [14, () => rwBody('0.5sin(2x) + 1', [['shift:0', 0.3], ['lit:1', 1.3]]), '0.5sin(2(x - 0.3)) + 1.3'],
        [15, () => rwBody('x^2 + 1', [['shift:0', 1]]), '(x - 1)^2 + 1'],
        [16, () => rwBody('-x + 4', [['lit:4', -2]]), '-x - 2'],
        [17, () => rwBody('e^(0.5x)', [['shift:0', 1], ['add', 1]]), 'e^(0.5(x - 1)) + 1'],
        [18, () => rwClause('(x - 3)^2 + (y - 2)^2 <= 2^2', [0, 0], [['lit:3', 3.5], ['lit:2', 2.6]]), '(x - 3.5)^2 + (y - 2.6)^2 <= 2^2'],
        [19, () => rwClause('(x - 3)^2 + (y - 2)^2 <= 2^2', [0, 0], [['lit:2#2', 2.5]]), '(x - 3)^2 + (y - 2)^2 <= 2.5^2'],
        [20, () => rwEq('x^2 + y^2 = 4', [['shift:0', 0.5], ['shift:1', 0.7]]), '(x - 0.5)^2 + (y - 0.7)^2 = 4'],
        [21, () => rwBody('2^x', [['factor', 1.5], ['add', -0.5]]), '1.5*2^x - 0.5'],
        [22, () => rwBody('-3x + 2', [['lit:3', -1.2]]), '1.2x + 2'],
        [23, () => rwBody('x*3', [['lit:3', -2]]), 'x*(-2)'],
        [24, () => rwBody('1/2 x + 1', [['fold:1/2', 1]], { tidy: true }), 'x + 1'],
        [25, () => rwBody('10 - a*x', [['lit:10', 10.5]], { params: a1 }), '10.5 - a*x'],
        [25, () => rwBody('10 - a*x', [['lit:10', 12], ['slider:a', 1.5]], { params: a1 }), '12 - a*x'],
        [26, () => rewrite(tuple('(a, 2a)', [[0, 0], [0, 1]]), [['slider:a', 1.2]]).text, '(a, 2a)'],
        [27, () => rewrite(tuple('(1, 1); (3, 2)', [[1, 0], [1, 1]]), [['lit:3', 3.37], ['lit:2', 1.5]]).text, '(1, 1); (3.37, 1.5)'],
        [28, () => rewrite(setup([{ ref: LEVELS, role: 'levelItem', item: 1 }], '1, 3.2, 6', { virtual: [] }), [['lit:3.2', 4.2]]).text, '1, 4.2, 6'],
        [29, () => rewrite(setup([{ ref: LABEL_X, role: 'value' }], 'P1_x', { virtual: ['add'], sliders: false }), [['add', 0.4]]).text, 'P1_x + 0.4'],
        [30, () => rwClause('0 <= x <= 4', [0, 1], [['lit:4', 4.5]]), '0 <= x <= 4.5'],
        [31, () => rwClause('0 <= x <= 2pi', [0, 1], [['add', 0.3]]), '0 <= x <= 2pi + 0.3'],
        [32, () => rwBody('x + sin(x)', [['factor', 1.5], ['shift:0', 1]]), '1.5(x - 1) + sin(x - 1)'],
        [33, () => rwBody('x(x+1)', [['lit:1', -1]]), 'x(x-1)'],
        [33, () => rwBody('x(x^2+1)', [['shift:0', 1]]), '(x-1)((x-1)^2+1)'],
        [
            34,
            () => rewrite(tuple('(0, 0); (3, 2)', [[0, 0], [0, 1], [1, 0], [1, 1]], PATH), [['lit:0', 0.5], ['lit:0#2', 0.5], ['lit:3', 3.5], ['lit:2', 2.5]]).text,
            '(0.5, 0.5); (3.5, 2.5)',
        ],
        [35, () => rwBody('0.123456x + 1.98765', [['lit:0.123456', 0.123456], ['lit:1.98765', 1.98765]]), '0.123456x + 1.98765'],
        [36, () => rwClause('x ≤ 4 − y', [0, 0], [['lit:4', 4.5]]), 'x ≤ 4.5 − y'],
    ];
    const seen = new Set<number>();
    for (const [row, run, want] of rows) {
        assert.equal(run(), want, `row ${row}`);
        seen.add(row);
    }
    assert.equal(seen.size, 36, 'every row of the table');
});

test('identity: start values give byte-identical text for every EXAMPLES field', () => {
    let checked = 0;
    for (const ex of EXAMPLES) {
        if (ex.is3D) continue;
        const data = ex.data as Record<string, unknown>;
        const params = (data.parameters as Parameter[]) || [];
        const functions = (data.functions as FunctionParameters[]) || [];
        const tools = (data.tools as Array<Record<string, unknown>>) || [];
        const math = new MathContext({ parameters: params, functions, toolNames: tools.map((t) => String(t.name)) });
        const cases: Array<{ spec: UnitSpec; text: string }> = [];
        functions.forEach((f) => {
            const name = f.name || '';
            if (!f.parametric) cases.push({ spec: { ref: { kind: 'function', name, field: 'expression' }, role: 'body', fnKind: 'cartesian' }, text: f.expression });
            if (f.tangentPoint && !/^(min|max)\d*$/.test(f.tangentPoint)) {
                cases.push({ spec: { ref: { kind: 'function', name, field: 'tangentPoint' }, role: 'value' }, text: f.tangentPoint });
            }
        });
        for (const t of tools) {
            const id = String(t.id);
            if (Array.isArray(t.conditions)) {
                (t.conditions as string[]).forEach((c, entry) => {
                    const ref: FieldRef = { kind: 'tool', id, field: 'condition', entry };
                    const math2 = math;
                    const probe = parseUnit({ ref, role: 'clause', disjunct: 0, clause: 0 }, c, math2);
                    if (!probe) return;
                    for (let k = 0; k < 4; k++) {
                        const spec: UnitSpec = { ref, role: 'clause', disjunct: 0, clause: k };
                        if (parseUnit(spec, c, math)) cases.push({ spec, text: c });
                    }
                });
            }
            if (typeof t.equation === 'string') cases.push({ spec: { ref: { kind: 'tool', id, field: 'equation' }, role: 'equation' }, text: t.equation });
            if (typeof t.levels === 'string' && t.levels.trim()) {
                (t.levels as string).split(',').forEach((_, item) => cases.push({ spec: { ref: { kind: 'tool', id, field: 'levels' }, role: 'levelItem', item }, text: t.levels as string }));
            }
            if (typeof t.objective === 'string' && t.objective.trim()) cases.push({ spec: { ref: { kind: 'tool', id, field: 'objective' }, role: 'side' }, text: t.objective });
        }
        for (const a of (data.annotations as Array<{ x: string; y: string }>) || []) {
            cases.push({ spec: { ref: { kind: 'label', index: 0, field: 'x' }, role: 'value' }, text: a.x });
            cases.push({ spec: { ref: { kind: 'label', index: 0, field: 'y' }, role: 'value' }, text: a.y });
        }
        for (const c of cases) {
            const u = parseUnit(c.spec, c.text, math);
            if (!u) continue;
            const sliders = new Map(params.map((p) => [p.name, p] as [string, Parameter]));
            const numbers = discoverNumbers([u], { sliders, allowSliders: true, virtual: ALL_VIRTUAL });
            const ev = compileNumbers([u], numbers, math);
            const values = Float64Array.from(numbers.map((d) => d.value0));
            const steps = new Float64Array(numbers.length).fill(0.1);
            const out = rewriteUnits([u], numbers, values, steps, ev, math, { tidy: true, samples: [DEFAULT_SAMPLES] });
            if (c.spec.role === 'side') {
                assert.equal(out.length, 0, 'side units are never rewritten');
                continue;
            }
            assert.equal(out.length, 1);
            assert.equal(out[0].text, c.text, `${ex.id}: ${c.text}`);
            assert.equal(out[0].failed, false);
            assert.deepEqual(out[0].changed, []);
            checked++;
        }
    }
    assert.ok(checked >= 25, `checked ${checked} fields`);
});

test('drag away and back is byte-identical (row 35)', () => {
    const s = setup([bodySpec()], '0.123456x + 1.98765');
    let out = rewrite(s, [['lit:0.123456', 0.2], ['lit:1.98765', 1.5]]).text;
    assert.equal(out, '0.2x + 1.5');
    out = rewrite(s, [['lit:0.123456', 0.123456], ['lit:1.98765', 1.98765]]).text;
    assert.equal(out, '0.123456x + 1.98765');
});

test('changed spans: a negative literal highlights its number token, (-v) as a whole', () => {
    const spans = (text: string, assign: Array<[string, number]>) => {
        const r = rewrite(setup([bodySpec()], text), assign);
        return r.fields[0].changed.map(([a, b]) => r.text.slice(a, b));
    };
    assert.deepEqual(spans('3x + 1', [['lit:3', -2]]), ['2']);
    assert.deepEqual(spans('x + 3', [['lit:3', -2]]), ['2']);
    assert.deepEqual(spans('x*3', [['lit:3', -2]]), ['(-2)']);
    assert.deepEqual(spans('x*(3)', [['lit:3', -2]]), ['2']);
});

test('changed spans cover written numbers and insertions', () => {
    const s = setup([bodySpec()], 'sin(x) + 1');
    const r = rewrite(s, [['shift:0', 0.5], ['lit:1', 2]]);
    assert.equal(r.text, 'sin(x - 0.5) + 2');
    assert.deepEqual(
        r.fields[0].changed.map(([a, b]) => r.text.slice(a, b)),
        [' - 0.5', '2']
    );
});

test('rewrite memo: repeated frames, and units reused with another numbers list', () => {
    const math = context();
    const u = parseUnit(bodySpec(), 'sin(x)', math) as ParsedUnit;
    const mk = (virtual: VirtualKind[]) => {
        const numbers = discoverNumbers([u], { sliders: new Map(), allowSliders: true, virtual });
        return { math, units: [u], numbers };
    };
    const move = mk(['add', 'shiftVar']);
    const pivot = mk(['factor', 'scaleVar']);
    assert.equal(rewrite(move, [['add', 2]]).text, 'sin(x) + 2');
    assert.equal(rewrite(move, [['add', 2]]).text, 'sin(x) + 2', 'memo hit');
    // Index 0 is 'add' in one list and 'factor' in the other: same signature shape, different meaning.
    assert.equal(rewrite(pivot, [['factor', 2]]).text, '2sin(x)');
    assert.equal(rewrite(move, [['add', 3]]).text, 'sin(x) + 3');
    const hit = rewrite(move, [['add', 3]]);
    hit.fields[0].changed.push([0, 1]);
    assert.deepEqual(rewrite(move, [['add', 3]]).fields[0].changed, [[6, 10]], 'memo entries are copies');
});

// ------------------------------------------------------------------ safety net

test('safety net: a field whose text cannot follow is marked failed, start text kept', () => {
    const s = setup([bodySpec()], '2x + 1');
    const ev = compileNumbers(s.units, s.numbers, s.math);
    const values = Float64Array.from(s.numbers.map((d) => d.value0));
    const steps = new Float64Array(s.numbers.length).fill(1e-6);
    values[pick(s.numbers, 'lit:1')] = Infinity;
    const out = rewriteUnits(s.units, s.numbers, values, steps, ev, s.math, { tidy: false, samples: [DEFAULT_SAMPLES] });
    assert.equal(out[0].text, '2x + 1', 'non-finite values are never written');
    // A closure that disagrees with every text: the net must refuse.
    const evBad = { ...ev, fns: [(x: number) => x * 100] };
    values[pick(s.numbers, 'lit:1')] = 3;
    const bad = rewriteUnits(s.units, s.numbers, values, steps, evBad, s.math, { tidy: false, samples: [DEFAULT_SAMPLES] });
    assert.equal(bad[0].failed, true);
    assert.equal(bad[0].text, '2x + 1');
});

test('safety net: the evaluator values are restored after the check', () => {
    const s = setup([bodySpec()], '2x + 1');
    const ev = compileNumbers(s.units, s.numbers, s.math);
    const values = Float64Array.from(s.numbers.map((d) => d.value0));
    values[pick(s.numbers, 'lit:1')] = 0.83333333;
    ev.values.set(values);
    const steps = new Float64Array(s.numbers.length).fill(0.01);
    const out = rewriteUnits(s.units, s.numbers, values, steps, ev, s.math, { tidy: false, samples: [DEFAULT_SAMPLES] });
    assert.equal(out[0].text, '2x + 0.83');
    assert.equal(ev.values[pick(s.numbers, 'lit:1')], 0.83333333);
});

// ------------------------------------------------------------------ twins

test('twins: LP objective follows the equation (row 5)', () => {
    const s = setup([{ ref: EQ, role: 'equation' }], '2x + 3y = c', { params: [param('c', 9, 0, 15, 0.1)] });
    const r = rewrite(s, [['lit:2', 2.5], ['slider:c', 10.5]], { twins: [{ unit: 0, ref: OBJECTIVE, text: '2x + 3y' }] });
    assert.equal(r.fields.length, 2);
    assert.equal(r.fields[0].text, '2.5x + 3y = c');
    assert.equal(r.fields[1].text, '2.5x + 3y');
    assert.deepEqual(r.fields[1].ref, OBJECTIVE);
    assert.equal(r.fields[1].failed, false);
    // Inserted structure and sign flips are mirrored too.
    const s2 = setup([{ ref: EQ, role: 'equation' }], 'x + 3y = c', { params: [param('c', 9, 0, 15, 0.1)] });
    const r2 = rewrite(s2, [['factor', -1.5], ['shift:1', 1]], { twins: [{ unit: 0, ref: OBJECTIVE, text: 'x + 3y' }] });
    assert.equal(r2.fields[0].text, '-1.5x + 3(y - 1) = c');
    assert.equal(r2.fields[1].text, '-1.5x + 3(y - 1)');
    const r3 = rewrite(s2, [['lit:3', 2]], { twins: [{ unit: 0, ref: OBJECTIVE, text: 'x + 4y' }] });
    assert.equal(r3.fields[1].failed, true, 'a twin whose tokens no longer match is dropped');
    assert.equal(r3.fields[1].text, 'x + 4y');
});

test('twins: mirrorEdits by token index', () => {
    assert.equal(mirrorEdits('2x + 3y = c', [0, 7], '2.5x + 3y = c', '2x + 3y', [0, 7]), '2.5x + 3y');
    assert.equal(mirrorEdits('2x + 3y = 12', [0, 7], '2.4x + 3y = 13.2', '2x+3y', [0, 5]), '2.4x+3y', 'edits outside the side are not mirrored');
    assert.equal(mirrorEdits('x + y = c', [0, 5], '1.2x + y = c', 'x + y', [0, 5]), '1.2x + y');
    assert.equal(mirrorEdits('x + y = c', [0, 5], 'x - 0.5 + y = c', 'x + y', [0, 5]), 'x - 0.5 + y');
    assert.equal(mirrorEdits('x + y = c', [0, 5], 'x - 0.5 + y = c', 'x+y', [0, 3]), 'x - 0.5 +y', 'insertions copy the source spacing');
    assert.equal(mirrorEdits('x^2 + y^2', [0, 9], '(x - 1)^2 + y^2 + 3', 'x^2 + y^2', [0, 9]), '(x - 1)^2 + y^2 + 3');
    assert.equal(mirrorEdits('-3x + y = 1', [0, 7], '1.2x + y = 1', '-3x + y', [0, 7]), '1.2x + y');
    assert.equal(mirrorEdits('x + 2y = 4', [0, 6], 'x - y = 4', 'x + 2 y', [0, 7]), 'x - y', 'tidy removal');
    assert.equal(mirrorEdits('2x + 3y = c', [0, 7], '2.5x + 3y = c', '2x + 4y', [0, 7]), null, 'mismatch');
    assert.equal(mirrorEdits('c = 2x + 3y', [4, 11], 'c + 1 = 2x + 3y', '2x + 3y', [0, 7]), '2x + 3y', 'insertion before the side is not mirrored');
});

test('twins: normalized tokens', () => {
    assert.equal(normalizedTokens('2x+3y'), '2 x + 3 y');
    assert.equal(normalizedTokens('x ≤ 4 − y'), 'x <= 4 - y');
    assert.equal(normalizedTokens('2x + 3y = c', [0, 7]), '2 x + 3 y');
});

// ------------------------------------------------------------------ make slider

test('makeSliderEdit', () => {
    assert.equal(makeSliderEdit('3y', [0, 1], 'b'), 'b*y');
    assert.equal(makeSliderEdit('x + 3y <= 6.6', [10, 13], 'b'), 'x + 3y <= b');
    assert.equal(makeSliderEdit('x*(-2)', [2, 6], 'b'), 'x*b');
    assert.equal(makeSliderEdit('3(x+1)', [0, 1], 'b'), 'b*(x+1)');
    assert.equal(makeSliderEdit('2.5x + 1', [0, 3], 'b'), 'b*x + 1');
    assert.equal(makeSliderEdit('x 2', [2, 3], 'b'), 'x *b');
    assert.equal(makeSliderEdit('1.5 (x + 1)', [0, 3], 'b'), 'b* (x + 1)', 'never a name before (');
    assert.equal(makeSliderEdit('x <= 1 and 2 >= y', [11, 12], 'b'), 'x <= 1 and b >= y');
    assert.equal(makeSliderEdit('sin(2x)', [4, 5], 'b'), 'sin(b*x)');
});

// ------------------------------------------------------------------ hover preview

test('previewFields: spans and ghosts', () => {
    let s = setup([bodySpec()], 'sin(x)');
    let p = previewFields(s.units, s.numbers, [pick(s.numbers, 'shift:0'), pick(s.numbers, 'add')]);
    assert.equal(p.length, 1);
    assert.deepEqual(p[0].ghosts, [
        { at: 5, text: ' - h' },
        { at: 6, text: ' + k' },
    ]);
    assert.deepEqual(p[0].virtualKinds, ['add', 'shiftVar']);
    s = setup([{ ref: EQ, role: 'equation' }], '2x + 3y = c', { params: [param('c', 9)] });
    p = previewFields(s.units, s.numbers, [pick(s.numbers, 'slider:c'), pick(s.numbers, 'lit:2')]);
    assert.deepEqual(p[0].numSpans, [
        [0, 1],
        [10, 11],
    ]);
    s = setup([bodySpec()], '2^x');
    p = previewFields(s.units, s.numbers, [pick(s.numbers, 'factor')]);
    assert.deepEqual(p[0].ghosts, [{ at: 0, text: 'a*' }]);
});

// ------------------------------------------------------------------ graph form

test('graph form: a lone-variable side is the output side; its scale is marked, factors go on the function side', () => {
    const EQS: UnitSpec = { ref: EQ, role: 'equation' };
    const cases: Array<{ spec: UnitSpec; text: string; axis: 0 | 1 | null; factors: number[] }> = [
        { spec: clauseSpec(), text: 'y <= x^2', axis: 1, factors: [5] },
        { spec: clauseSpec(), text: 'y <= 4 - x^2', axis: 1, factors: [9] },
        { spec: clauseSpec(), text: '-y >= x^2 - 4', axis: 1, factors: [6] },
        { spec: clauseSpec(), text: 'x^2 >= y', axis: 1, factors: [0] },
        { spec: clauseSpec(), text: 'x >= y^2', axis: 0, factors: [5] },
        { spec: EQS, text: 'y = sin(x)', axis: 1, factors: [4] },
        { spec: clauseSpec(), text: 'x + 3y <= 6', axis: null, factors: [0] },
        { spec: EQS, text: '2x + 3y = c', axis: null, factors: [] },
    ];
    for (const c of cases) {
        const s = setup([c.spec], c.text, { params: [param('c', 9, 0, 15)] });
        const out = outputSide(s.units[0]);
        assert.equal(out ? out.axis : null, c.axis, c.text);
        const marked = s.numbers.filter((d) => d.output);
        if (c.axis === null) assert.deepEqual(marked, [], c.text);
        else assert.deepEqual(marked.map((d) => d.id), [`v:0:scale:${c.axis}`], c.text);
        const factorPos = s.numbers.filter((d) => d.virtual?.kind === 'factor').map((d) => d.pos);
        assert.deepEqual(factorPos, c.factors, `${c.text}: factor positions`);
    }
});

test('graph form: pivot gestures order the output scale last (a last resort); Move keeps its usual place', () => {
    const s = setup([clauseSpec()], 'y <= x^2');
    const all = s.numbers.map(() => true);
    const pivot = priorityOrder(s.numbers, 'pivot', all).map((i) => s.numbers[i].id);
    assert.equal(pivot[0], 'v:0:factor@5', 'the first coefficient is the function side factor');
    assert.equal(pivot[pivot.length - 1], 'v:0:scale:1', pivot.join(' '));
    assert.equal(pivot.filter((id) => id === 'v:0:scale:1').length, 1, pivot.join(' '));
    const move = priorityOrder(s.numbers, 'move', all).map((i) => s.numbers[i].id);
    assert.ok(move.includes('v:0:scale:1'), move.join(' '));
    // '--y' is a lone variable too: any number of signs.
    const dbl = setup([clauseSpec()], '--y <= x^2');
    assert.equal(outputSide(dbl.units[0])?.axis, 1);
    assert.deepEqual(dbl.numbers.filter((d) => d.output).map((d) => d.id), ['v:0:scale:1']);
    // SPEC3 D4 unchanged where no side is a lone variable: x + 3y <= 6 turns with its 3 first.
    const lp = setup([clauseSpec()], 'x + 3y <= 6');
    const lpOrder = priorityOrder(lp.numbers, 'pivot', lp.numbers.map(() => true)).map((i) => lp.numbers[i].id);
    assert.deepEqual(lpOrder.slice(0, 2), ['l:0@4', 'l:0@10']);
});

// ------------------------------------------------------------------ performance

test('performance: rewrite + safety net per event stays well under 1 ms', () => {
    const s = setup([clauseSpec(0, 0)], '(x - 3)^2 + (y - 2)^2 <= 2^2 + x y');
    const ev = compileNumbers(s.units, s.numbers, s.math);
    const steps = new Float64Array(s.numbers.length).fill(0.01);
    const values = Float64Array.from(s.numbers.map((d) => d.value0));
    const t0 = Date.now();
    const N = 300;
    for (let k = 0; k < N; k++) {
        values[pick(s.numbers, 'lit:3')] = 3 + (k % 10) / 10;
        values[pick(s.numbers, 'shift:1')] = (k % 7) / 10;
        values[pick(s.numbers, 'add')] = (k % 5) / 10;
        const out = rewriteUnits(s.units, s.numbers, values, steps, ev, s.math, { tidy: false, samples: [DEFAULT_SAMPLES] });
        assert.equal(out[0].failed, false);
    }
    const per = (Date.now() - t0) / N;
    assert.ok(per < 1, `${per} ms per rewrite`);
});
