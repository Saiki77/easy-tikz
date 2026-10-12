/*
 * Fuzz test for src/drag/numbers.ts rewriting (SPEC3 6.1, owner B): random expressions from a grammar
 * over + - * / ^, unary minus, implicit products, digit-led bases, lone and parenthesized variables,
 * builtins, sliders, user-function calls and unicode operators; random values for ALL numbers at once
 * (always including 0, 1, -1 and negatives). The rewritten text must parse, and its plain compile
 * through the production MathContext path must equal the slotted closure at 8 points (1e-9 relative,
 * finiteness equal). Zero mismatches. Seeded and deterministic.
 */
import { assert, test } from './_lib';
import { MathContext } from '../src/mathcontext';
import type { FunctionParameters, Parameter } from '../src/types';
import { compileNumbers, discoverNumbers, formatValue, parseUnit, rewriteUnits } from '../src/drag/numbers';
import type { DragNumber, FieldRef, UnitSpec, VirtualKind } from '../src/drag/types';

// ------------------------------------------------------------------ seeded random

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

type Rnd = () => number;

function pickOne<T>(r: Rnd, list: readonly T[]): T {
    return list[Math.floor(r() * list.length)];
}

// ------------------------------------------------------------------ grammar

const NUMBERS = ['0', '1', '2', '3', '0.5', '1.25', '.5', '2.', '10', '1e1', '2.5e-1', '7', '0.125'];
const BUILTINS = ['sin', 'cos', 'exp', 'sqrt', 'abs'];
const USER_FNS = ['f1', 'g'];
const SLIDERS = ['a', 'b'];

interface Gen {
    r: Rnd;
    vars: string[];
}

function sp(g: Gen, op: string): string {
    return g.r() < 0.6 ? ` ${op} ` : op;
}

function atom(g: Gen): string {
    const k = g.r();
    if (k < 0.35) return pickOne(g.r, g.vars);
    if (k < 0.45) return `(${pickOne(g.r, g.vars)})`;
    if (k < 0.75) return pickOne(g.r, NUMBERS);
    if (k < 0.9) return pickOne(g.r, SLIDERS);
    return pickOne(g.r, ['pi', 'e', '2pi', 'π']);
}

/** An operand that binds at least as tightly as a product. */
function factor(g: Gen, depth: number): string {
    const e = expr(g, depth);
    return /^[A-Za-z0-9_.π]+$/.test(e) || /^[a-z0-9]+\([^()]*\)$/.test(e) ? e : `(${e})`;
}

function expr(g: Gen, depth: number): string {
    if (depth <= 0) return atom(g);
    const r = g.r;
    const k = r();
    const v = pickOne(r, g.vars);
    const d = depth - 1;
    if (k < 0.16) return `${expr(g, d)}${sp(g, '+')}${expr(g, d)}`;
    if (k < 0.26) return `${expr(g, d)}${sp(g, pickOne(r, ['-', '−']))}${factor(g, d)}`;
    if (k < 0.34) return `${factor(g, d)}${pickOne(r, ['*', '*', ' * ', '·', '×'])}${factor(g, d)}`;
    if (k < 0.39) return `${factor(g, d)}/${factor(g, d)}`;
    if (k < 0.47) return `${factor(g, d)}^${pickOne(r, ['2', '3', '(1/2)', v, '-1', `(${v} + 1)`])}`;
    if (k < 0.55) return `${pickOne(r, NUMBERS.filter((n) => !/[e.]$/.test(n)))}${pickOne(r, ['', ' '])}${v}`;
    if (k < 0.6) return `${pickOne(r, ['2', '3', '0.5'])}(${expr(g, d)})`;
    if (k < 0.65) return `${pickOne(r, SLIDERS)}(${expr(g, d)})${r() < 0.4 ? '^2' : ''}`;
    if (k < 0.7) return `${v} ${pickOne(r, BUILTINS)}(${expr(g, d)})`;
    if (k < 0.74) return `${pickOne(r, ['2', '3'])}${pickOne(r, BUILTINS)}(${expr(g, d)})`;
    if (k < 0.78) return `-${factor(g, d)}`;
    if (k < 0.86) return `${pickOne(r, BUILTINS)}(${expr(g, d)})`;
    if (k < 0.9) return `${pickOne(r, USER_FNS)}(${expr(g, d)})`;
    if (k < 0.94) return `${pickOne(r, ['2', '3'])}^${factor(g, d)}`;
    if (k < 0.97) return `${v}(${expr(g, d)})`;
    return `(${expr(g, d)})`;
}

// ------------------------------------------------------------------ harness

const PARAMS: Parameter[] = [
    { name: 'a', value: 1.5, min: -5, max: 5, step: 0.1 },
    { name: 'b', value: -0.5, min: -5, max: 5, step: 0.05 },
];

const FUNCTIONS = [
    { name: 'f1', expression: 'x^2 + 1', domain: '' },
    { name: 'g', expression: 'sin(x) + x', domain: '' },
] as FunctionParameters[];

const ALL_VIRTUAL: VirtualKind[] = ['add', 'factor', 'shiftVar', 'scaleVar'];
const STEPS = [1, 0.1, 0.01, 0.001, 1e-6];

function points(r: Rnd, n: number): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < n; i++) out.push({ x: -4 + 8 * r(), y: -4 + 8 * r() });
    return out;
}

function same(a: number, b: number, scale: number): boolean {
    if (Number.isFinite(a) !== Number.isFinite(b)) return false;
    if (!Number.isFinite(a)) return Number.isNaN(a) ? Number.isNaN(b) : a === b;
    return Math.abs(a - b) <= 1e-12 + 1e-9 * Math.max(Math.abs(a), Math.abs(b), scale);
}

/** The production compile of the unit in `text` (independent of numbers.ts). */
function production(math: MathContext, spec: UnitSpec, text: string): (x: number, y: number) => number {
    if (spec.role === 'body') {
        const f = math.fn1(text, 'cartesian');
        return (x) => f(x);
    }
    if (spec.role === 'value') {
        // Same value env semantics; fn2 keeps non-finite results (value() maps them to NaN).
        const f = math.fn2(text);
        return () => f(NaN, NaN);
    }
    if (spec.role === 'clause') {
        const entry = math.conditions([text])[0];
        return entry.disjuncts[spec.disjunct ?? 0][spec.clause ?? 0].g;
    }
    return math.equation(text).F;
}

interface Stats {
    expressions: number;
    rewrites: number;
    changedTexts: number;
    defensive: number;
    defensiveCases: string[];
    illConditioned: number;
    mismatches: string[];
}

/** Value vectors for every number at once: all 0, all 1, all -1, then random mixes with negatives. */
function vectors(r: Rnd, numbers: DragNumber[]): Array<{ values: Float64Array; steps: Float64Array }> {
    const n = numbers.length;
    const out: Array<{ values: Float64Array; steps: Float64Array }> = [];
    const make = (choose: (i: number) => number) => {
        const steps = new Float64Array(n);
        const values = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const d = numbers[i];
            const step = d.kind === 'slider' && d.param ? d.param.step : pickOne(r, STEPS);
            steps[i] = step;
            // Values on the step grid, as the quantizer delivers them, and exactly what the text will say
            // (the decimal round trip; +0, since a text cannot write -0).
            const q = Math.round(choose(i) / step) * step;
            values[i] = d.kind === 'slider' ? q : Number(formatValue(q, step, null)) + 0;
        }
        out.push({ values, steps });
    };
    make(() => 0);
    make(() => 1);
    make(() => -1);
    for (let k = 0; k < 4; k++) {
        make((i) => {
            const c = r();
            if (c < 0.15) return 0;
            if (c < 0.3) return 1;
            if (c < 0.45) return -1;
            if (c < 0.55) return numbers[i].value0;
            return (r() < 0.5 ? -1 : 1) * r() * 6;
        });
    }
    return out;
}

function runCase(stats: Stats, r: Rnd, math: MathContext, spec: UnitSpec, text: string, virtual: VirtualKind[] = ALL_VIRTUAL): void {
    const u = parseUnit(spec, text, math);
    if (!u) return;
    const sliders = new Map(PARAMS.map((p) => [p.name, p] as [string, Parameter]));
    const numbers = discoverNumbers([u], { sliders, allowSliders: spec.role !== 'value', virtual });
    if (!numbers.length) return;
    const ev = compileNumbers([u], numbers, math);
    stats.expressions++;
    const samples = points(r, 12);
    const check = points(r, 8);
    for (const vec of vectors(r, numbers)) {
        ev.values.set(vec.values);
        ev.apply();
        const tidy = r() < 0.5;
        const out = rewriteUnits([u], numbers, vec.values, vec.steps, ev, math, { tidy, samples: [samples] });
        stats.rewrites++;
        const field = out[0];
        const label = `${text}  ->  ${field.text}  [${numbers.map((d, i) => `${d.label}=${vec.values[i]}`).join(', ')}]`;
        if (field.failed) {
            stats.mismatches.push(`safety net refused: ${label}`);
            continue;
        }
        if (field.text !== text) stats.changedTexts++;
        if (field.defensive) {
            stats.defensive++;
            if (stats.defensiveCases.length < 20) stats.defensiveCases.push(label);
        }
        let plainFn: (x: number, y: number) => number;
        try {
            plainFn = production(math, spec, field.text);
        } catch (e) {
            stats.mismatches.push(`does not compile (${e instanceof Error ? e.message : String(e)}): ${label}`);
            continue;
        }
        const slotted = ev.fns[0];
        const a: number[] = [];
        const b: number[] = [];
        let scale = 0;
        for (const p of check) {
            const y = u.env === 'fn1' ? NaN : p.y;
            const va = slotted(p.x, y);
            const vb = plainFn(p.x, y);
            a.push(va);
            b.push(vb);
            if (Number.isFinite(va)) scale = Math.max(scale, Math.abs(va));
            if (Number.isFinite(vb)) scale = Math.max(scale, Math.abs(vb));
        }
        // Points where the function cannot resolve a 1e-13 change of its input (cos of 1e12, ...) cannot tell
        // two equal formulas apart: float reassociation alone moves them. Skip those, count them.
        const conditioned = check.map((p) => {
            const y = u.env === 'fn1' ? NaN : p.y;
            const v0 = slotted(p.x, y);
            const v1 = slotted(p.x * (1 + 1e-13) + 1e-300, y * (1 + 1e-13));
            return !Number.isFinite(v0) || !Number.isFinite(v1) || same(v0, v1, scale);
        });
        for (let k = 0; k < a.length; k++) {
            if (!conditioned[k]) {
                stats.illConditioned++;
                continue;
            }
            if (!same(a[k], b[k], scale)) {
                stats.mismatches.push(`value ${a[k]} vs ${b[k]} at (${check[k].x}, ${check[k].y}): ${label}`);
                break;
            }
        }
        // The defensive rebuild (the safety net's second try) must be just as exact.
        const def = rewriteUnits([u], numbers, vec.values, vec.steps, ev, math, { tidy, samples: [samples], defensiveOnly: true })[0];
        if (def.failed) {
            stats.mismatches.push(`defensive rebuild refused: ${text}  ->  ${def.text}`);
            continue;
        }
        let defFn: (x: number, y: number) => number;
        try {
            defFn = production(math, spec, def.text);
        } catch (e) {
            stats.mismatches.push(`defensive text does not compile: ${text}  ->  ${def.text}`);
            continue;
        }
        for (let k = 0; k < check.length; k++) {
            const y = u.env === 'fn1' ? NaN : check[k].y;
            if (conditioned[k] && !same(slotted(check[k].x, y), defFn(check[k].x, y), scale)) {
                stats.mismatches.push(`defensive value mismatch: ${text}  ->  ${def.text}`);
                break;
            }
        }
    }
    // The evaluator is left exactly as the caller set it.
    ev.values.fill(0);
}

function report(stats: Stats): string {
    return `${stats.expressions} expressions, ${stats.rewrites} rewrites, ${stats.changedTexts} changed texts, ${stats.defensive} defensive, ${stats.illConditioned} ill-conditioned points skipped`;
}

// ------------------------------------------------------------------ tests

test('fuzz: graph bodies (fn1), 1500 expressions', () => {
    const math = new MathContext({ parameters: PARAMS, functions: FUNCTIONS });
    const stats: Stats = { expressions: 0, rewrites: 0, changedTexts: 0, defensive: 0, defensiveCases: [], illConditioned: 0, mismatches: [] };
    const r = mulberry32(20261006);
    const spec: UnitSpec = { ref: { kind: 'function', name: 'h', field: 'expression' } as FieldRef, role: 'body', fnKind: 'cartesian' };
    let tries = 0;
    while (stats.expressions < 1500 && tries < 15000) {
        tries++;
        const text = expr({ r, vars: ['x'] }, 1 + Math.floor(r() * 4));
        try {
            math.fn1(text);
        } catch {
            continue;
        }
        runCase(stats, r, math, spec, text);
    }
    console.log(`    bodies: ${report(stats)}`);
    assert.equal(stats.mismatches.length, 0, stats.mismatches.slice(0, 8).join('\n'));
    assert.ok(stats.expressions >= 1500, report(stats));
    assert.ok(stats.defensive <= stats.rewrites * 0.01, `defensive fallback too frequent: ${report(stats)}`);
});

test('fuzz: clauses and equations (fn2), 500 expressions', () => {
    const math = new MathContext({ parameters: PARAMS, functions: FUNCTIONS });
    const stats: Stats = { expressions: 0, rewrites: 0, changedTexts: 0, defensive: 0, defensiveCases: [], illConditioned: 0, mismatches: [] };
    const r = mulberry32(42);
    let tries = 0;
    while (stats.expressions < 500 && tries < 15000) {
        tries++;
        const g: Gen = { r, vars: ['x', 'y'] };
        const lhs = expr(g, 1 + Math.floor(r() * 2));
        const rhs = expr(g, Math.floor(r() * 2));
        const kind = r();
        if (kind < 0.45) {
            const op = pickOne(r, ['<=', '>=', '≤', '≥', '<']);
            const text = r() < 0.2 ? `0 <= ${lhs} <= ${rhs}` : `${lhs} ${op} ${rhs}`;
            let shape: number[];
            try {
                const entry = math.conditions([text])[0];
                shape = entry.disjuncts.map((d) => d.length);
            } catch {
                continue;
            }
            const clause = Math.floor(r() * shape[0]);
            runCase(stats, r, math, { ref: { kind: 'tool', id: 't0', field: 'condition', entry: 0 }, role: 'clause', disjunct: 0, clause }, text);
        } else {
            const text = kind < 0.8 ? `${lhs} = ${rhs}` : lhs;
            try {
                math.equation(text);
            } catch {
                continue;
            }
            runCase(stats, r, math, { ref: { kind: 'tool', id: 't1', field: 'equation' }, role: 'equation' }, text);
        }
    }
    console.log(`    fn2: ${report(stats)}`);
    assert.equal(stats.mismatches.length, 0, stats.mismatches.slice(0, 8).join('\n'));
    assert.ok(stats.expressions >= 500, report(stats));
    assert.ok(stats.defensive <= stats.rewrites * 0.01, `defensive fallback too frequent: ${report(stats)}`);
});

test('fuzz: value units (labels, tangent points), 300 expressions', () => {
    const math = new MathContext({ parameters: PARAMS, functions: FUNCTIONS, toolNames: ['P1'] });
    const stats: Stats = { expressions: 0, rewrites: 0, changedTexts: 0, defensive: 0, defensiveCases: [], illConditioned: 0, mismatches: [] };
    const r = mulberry32(99);
    const spec: UnitSpec = { ref: { kind: 'label', index: 0, field: 'x' }, role: 'value' };
    let tries = 0;
    while (stats.expressions < 300 && tries < 6000) {
        tries++;
        const text = expr({ r, vars: ['b', 'P1_x'] }, Math.floor(r() * 3));
        try {
            math.fn2(text);
            if (/\b[xy]\b/.test(text)) continue;
        } catch {
            continue;
        }
        runCase(stats, r, math, spec, text, ['add']);
    }
    console.log(`    values: ${report(stats)}`);
    assert.equal(stats.mismatches.length, 0, stats.mismatches.slice(0, 8).join('\n'));
    assert.ok(stats.expressions >= 300, report(stats));
});

test('fuzz: hand-picked hard cases', () => {
    const math = new MathContext({ parameters: PARAMS, functions: FUNCTIONS });
    const stats: Stats = { expressions: 0, rewrites: 0, changedTexts: 0, defensive: 0, defensiveCases: [], illConditioned: 0, mismatches: [] };
    const r = mulberry32(7);
    const spec: UnitSpec = { ref: { kind: 'function', name: 'h', field: 'expression' }, role: 'body', fnKind: 'cartesian' };
    const cases = [
        '2^x', '3^x + 1', 'x(x+1)', 'x(x^2+1)', 'a(x - 1)^2', 'a (x - 1)^2', '-x', '- x', '-3x + 2', 'x*3', 'x/3', '3^x',
        '-(3x + 1)', '1/2 x + 1', 'x − 3', '+3x', 'x % 3', '-x % 2', 'x > 0 ? x : -x', '(x)', '((x))', '2(x)', 'x 2',
        'f1 x', 'g(x) x', 'sin x'.replace(' x', '(x)'), 'e^(0.5x)', 'e^-x', '2e1x', '2 e', 'exp(x) - 1e3', '1e-3x', 'x^-1',
        '2*pi*x', 'pi/2 + x', 'x·2', 'x×2 − 1', '0.5sin(2x) + 1', 'x^2 - 3x + 1', 'abs(x - 1) - 2', 'sqrt(x + 4)',
        '-(-x)', '--x + 1', 'x - -1', 'a*x + b', 'a/2 x', '2a x', 'x a', 'b(x)(x)', '(x + 1)(x - 1)', '3(x - 1)^2 - 4',
    ];
    for (const text of cases) {
        try {
            math.fn1(text);
        } catch {
            continue;
        }
        runCase(stats, r, math, spec, text);
    }
    console.log(`    hand-picked: ${report(stats)}`);
    assert.equal(stats.mismatches.length, 0, stats.mismatches.slice(0, 8).join('\n'));
    assert.ok(stats.expressions >= 45, report(stats));
});
