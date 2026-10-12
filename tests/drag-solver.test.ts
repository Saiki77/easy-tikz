/*
 * Drag solver and shapes (SPEC3 2.2 to 2.8, 6.1 C). Evaluators are built by hand: closures over a
 * Float64Array that mirror what numbers.ts compiles (virtual numbers as identity slots), so these tests
 * never depend on the parser. End-to-end strings live in the golden test.
 */
import { test, assert, near } from './_lib';
import type { Evaluator } from '../src/drag/numbers';
import { buildShape, sampleLines } from '../src/drag/shapes';
import type { ShapeInput } from '../src/drag/shapes';
import { applyFamily, boundsFor, fromPx, planDrag, priorityOrder, quantizeDrag, solveDrag, toPx } from '../src/drag/solver';
import type { Bounds, DragPlan, DragProblem, Family, Solved } from '../src/drag/solver';
import type { Compiled, DragNumber, Gesture, NumberRole, Pt, ScreenMap, TargetKind, View } from '../src/drag/types';

// ------------------------------------------------------------------ numbers

function lit(unit: number, pos: number, value: number, role: NumberRole): DragNumber {
    return { id: `l:${unit}@${pos}`, kind: 'literal', role, tier: 2, unit, value0: value, pos, label: String(value) };
}
function fold(unit: number, pos: number, value: number, role: NumberRole, label: string): DragNumber {
    return { id: `f:${unit}@${pos}`, kind: 'folded', role, tier: 3, unit, value0: value, pos, label };
}
function sld(name: string, value: number, role: NumberRole, pos: number, min: number, max: number, step: number): DragNumber {
    return { id: `s:${name}`, kind: 'slider', role, tier: 1, unit: -1, value0: value, pos, label: name, param: { name, min, max, step } };
}
function add(unit: number, pos: number): DragNumber {
    return { id: `v:${unit}:add`, kind: 'virtual', role: 'offset', tier: 4, unit, value0: 0, pos, label: 'k', virtual: { kind: 'add' } };
}
function factor(unit: number, pos: number): DragNumber {
    return { id: `v:${unit}:factor@${pos}`, kind: 'virtual', role: 'coef', tier: 4, unit, value0: 1, pos, label: 'a', virtual: { kind: 'factor' } };
}
function shiftV(unit: number, axis: 0 | 1, pos: number): DragNumber {
    return { id: `v:${unit}:shift:${axis}`, kind: 'virtual', role: 'shift', tier: 4, unit, value0: 0, pos, label: 'h', virtual: { kind: 'shiftVar', axis } };
}
function scaleV(unit: number, axis: 0 | 1, pos: number): DragNumber {
    return { id: `v:${unit}:scale:${axis}`, kind: 'virtual', role: 'coef', tier: 4, unit, value0: 1, pos, label: 's', virtual: { kind: 'scaleVar', axis } };
}

interface Model {
    numbers: DragNumber[];
    ev: Evaluator;
    v: Float64Array;
    applied: { n: number };
    I(id: string): number;
    val(id: string): number;
}

/** Numbers plus closures over their value slots (the hand-built Evaluator). */
function mk(numbers: DragNumber[], build: (v: Float64Array, I: (id: string) => number) => Compiled[]): Model {
    const v = new Float64Array(numbers.map((n) => n.value0));
    const I = (id: string): number => {
        const i = numbers.findIndex((n) => n.id === id);
        if (i < 0) throw new Error(`no number ${id}`);
        return i;
    };
    const applied = { n: 0 };
    const ev: Evaluator = {
        values: v,
        fns: build(v, I),
        apply() {
            applied.n++;
        },
    };
    return { numbers, ev, v, applied, I, val: (id) => v[I(id)] };
}

// ---------------------------------------------------------------- geometry

function screen(view: View, w = 600, h = 480): ScreenMap {
    return { view, kx: w / (view.xmax - view.xmin), ky: h / (view.ymax - view.ymin) };
}

/** Dense run of y = f(x) across the view (the renderer's sampled curve). */
function graphRun(f: (x: number) => number, view: View, n = 800): Pt[] {
    const out: Pt[] = [];
    const span = view.ymax - view.ymin;
    for (let i = 0; i <= n; i++) {
        const x = view.xmin + ((view.xmax - view.xmin) * i) / n;
        const y = f(x);
        if (Number.isFinite(y) && y > view.ymin - span && y < view.ymax + span) out.push({ x, y });
    }
    return out;
}

/** a x + b y = c across (and beyond) the view. */
function lineRun(a: number, b: number, c: number, view: View): Pt[] {
    const sx = view.xmax - view.xmin;
    const sy = view.ymax - view.ymin;
    if (Math.abs(b) >= Math.abs(a)) {
        const x0 = view.xmin - sx;
        const x1 = view.xmax + sx;
        return [{ x: x0, y: (c - a * x0) / b }, { x: x1, y: (c - a * x1) / b }];
    }
    const y0 = view.ymin - sy;
    const y1 = view.ymax + sy;
    return [{ x: (c - b * y0) / a, y: y0 }, { x: (c - b * y1) / a, y: y1 }];
}

function circleRun(cx: number, cy: number, r: number, n = 240): Pt[] {
    const out: Pt[] = [];
    for (let i = 0; i <= n; i++) {
        const t = (2 * Math.PI * i) / n;
        out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    }
    return out;
}

/** Normal distance (px) from c to y = f(x). */
function distGraph(f: Compiled, c: Pt, map: ScreenMap): number {
    const h = 1e-6 * (1 + Math.abs(c.x));
    const d = (f(c.x + h, NaN) - f(c.x - h, NaN)) / (2 * h);
    const s = (d * map.ky) / map.kx;
    return (Math.abs(f(c.x, NaN) - c.y) * map.ky) / Math.sqrt(1 + s * s);
}

/** Distance (px) from c to G = 0, first order. */
function distImplicit(G: Compiled, c: Pt, map: ScreenMap): number {
    const hx = 1e-6 * (1 + Math.abs(c.x));
    const hy = 1e-6 * (1 + Math.abs(c.y));
    const gx = (G(c.x + hx, c.y) - G(c.x - hx, c.y)) / (2 * hx);
    const gy = (G(c.x, c.y + hy) - G(c.x, c.y - hy)) / (2 * hy);
    return Math.abs(G(c.x, c.y)) / Math.hypot(gx / map.kx, gy / map.ky);
}

// ----------------------------------------------------------------- problems

const TRANSLATE: Family = { kind: 'translate' };

function sim(P: Pt, grab: Pt, map: ScreenMap, turnOnly = true): Family {
    const a = toPx(P, map);
    const g = toPx(grab, map);
    return { kind: 'similar', pivot: a, unit: Math.max(Math.hypot(g.x - a.x, g.y - a.y), 40), turnOnly };
}

function stretch(P: Pt, grab: Pt, map: ScreenMap): Family {
    const a = toPx(P, map);
    const g = toPx(grab, map);
    return { kind: 'stretch', pivot: a, ux: Math.max(Math.abs(g.x - a.x), 24), uy: Math.max(Math.abs(g.y - a.y), 24) };
}

interface Geo {
    lines?: Pt[][];
    points?: Pt[];
    F?: (x: number, y: number) => number;
    levelValue?: number;
    f?: (x: number) => number;
}

function prob(m: Model, kind: TargetKind, units: number[], geo: Geo, map: ScreenMap, family: Family, grab: Pt, gesture: Gesture): DragProblem {
    const input: ShapeInput = {
        kind,
        ev: m.ev,
        units,
        lines: geo.lines || [],
        points: geo.points || [],
        map,
        family,
        F: geo.F,
        levelValue: geo.levelValue,
        f: geo.f,
    };
    return { numbers: m.numbers, ev: m.ev, shape: buildShape(input), family, map, grab: toPx(grab, map), gesture };
}

function activeIds(m: Model, plan: DragPlan): string[] {
    return plan.active.map((i) => m.numbers[i].id).sort();
}

function lerpPath(from: Pt, to: Pt, steps: number): Pt[] {
    const out: Pt[] = [];
    for (let k = 1; k <= steps; k++) out.push({ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps });
    return out;
}

interface Driven {
    plan: DragPlan;
    solved: Solved;
    exact: Float64Array;
    values: Float64Array;
    steps: Float64Array;
    times: number[];
    /** Measured after every solve, before quantization (values = exact). */
    exactDist: number[];
}

/**
 * The session's per-event loop: solve from the last good frame, quantize, keep the warm state. `measure`
 * runs after each solve with the exact values in place.
 */
function drive(
    p: DragProblem,
    from: Pt,
    to: Pt | Pt[],
    opts: { steps?: number; snap?: boolean; bounds?: Bounds; plan?: DragPlan; measure?: (c: Pt) => number } = {}
): Driven {
    const plan = opts.plan || planDrag(p);
    const bounds = opts.bounds || boundsFor(p.numbers);
    const path = Array.isArray(to) ? to : lerpPath(from, to, opts.steps || 12);
    let warm: Float64Array | null = null;
    let prev: Pt | null = null;
    let solved: Solved | null = null;
    let q: { values: Float64Array; steps: Float64Array } | null = null;
    const times: number[] = [];
    const exactDist: number[] = [];
    for (const c of path) {
        const cpx = toPx(c, p.map);
        const t0 = performance.now();
        solved = solveDrag(p, plan, cpx, prev, warm, bounds);
        const t1 = performance.now();
        if (opts.measure) exactDist.push(opts.measure(c));
        const t2 = performance.now();
        if (solved.ok) {
            warm = solved.warm;
            prev = cpx;
        }
        q = quantizeDrag(p, plan, solved, bounds, { snap: opts.snap !== false });
        times.push(t1 - t0 + (performance.now() - t2));
    }
    const s = solved as Solved;
    const qq = q as { values: Float64Array; steps: Float64Array };
    return { plan, solved: s, exact: s.values, values: qq.values, steps: qq.steps, times, exactDist };
}

// ===================================================================== models

/** `2x + 1` (graph body). */
function lin2x1(): Model {
    return mk([lit(0, 0, 2, 'coef'), lit(0, 5, 1, 'offset'), add(0, 6), shiftV(0, 0, 1), scaleV(0, 0, 1)], (v, I) => {
        const [a, b, k, h, s] = [I('l:0@0'), I('l:0@5'), I('v:0:add'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => v[a] * (v[s] * (x - v[h])) + v[b] + v[k]];
    });
}

/** `2x + 3y = c` (curve equation, c slider 9 in [0, 15] step 0.1). */
function objective(): Model {
    return mk(
        [lit(0, 0, 2, 'coef'), lit(0, 5, 3, 'coef'), sld('c', 9, 'offset', 10, 0, 15, 0.1), add(0, 11), shiftV(0, 0, 1), shiftV(0, 1, 6), scaleV(0, 0, 1), scaleV(0, 1, 6)],
        (v, I) => {
            const [a, b, c, k] = [I('l:0@0'), I('l:0@5'), I('s:c'), I('v:0:add')];
            const [hx, hy, sx, sy] = [I('v:0:shift:0'), I('v:0:shift:1'), I('v:0:scale:0'), I('v:0:scale:1')];
            return [(x, y) => v[a] * (v[sx] * (x - v[hx])) + v[b] * (v[sy] * (y - v[hy])) - (v[c] + v[k])];
        }
    );
}

/** `2x + 3y = 12` (curve equation). */
function line12(): Model {
    return mk(
        [lit(0, 0, 2, 'coef'), lit(0, 5, 3, 'coef'), lit(0, 10, 12, 'offset'), add(0, 12), shiftV(0, 0, 1), shiftV(0, 1, 6), scaleV(0, 0, 1), scaleV(0, 1, 6)],
        (v, I) => {
            const [a, b, c, k] = [I('l:0@0'), I('l:0@5'), I('l:0@10'), I('v:0:add')];
            const [hx, hy, sx, sy] = [I('v:0:shift:0'), I('v:0:shift:1'), I('v:0:scale:0'), I('v:0:scale:1')];
            return [(x, y) => v[a] * (v[sx] * (x - v[hx])) + v[b] * (v[sy] * (y - v[hy])) - (v[c] + v[k])];
        }
    );
}

/** Clause `x + 3y <= 6`: g = lhs - rhs. */
function clause36(): Model {
    return mk(
        [lit(0, 4, 3, 'coef'), lit(0, 10, 6, 'offset'), add(0, 11), factor(0, 0), shiftV(0, 0, 0), shiftV(0, 1, 5), scaleV(0, 0, 0), scaleV(0, 1, 5)],
        (v, I) => {
            const [b, c, k, f] = [I('l:0@4'), I('l:0@10'), I('v:0:add'), I('v:0:factor@0')];
            const [hx, hy, sx, sy] = [I('v:0:shift:0'), I('v:0:shift:1'), I('v:0:scale:0'), I('v:0:scale:1')];
            return [(x, y) => v[f] * (v[sx] * (x - v[hx])) + v[b] * (v[sy] * (y - v[hy])) - (v[c] + v[k])];
        }
    );
}

/** Clause `x + y <= 4`. */
function clause4(): Model {
    return mk(
        [lit(0, 9, 4, 'offset'), add(0, 10), factor(0, 0), factor(0, 4), shiftV(0, 0, 0), shiftV(0, 1, 4), scaleV(0, 0, 0), scaleV(0, 1, 4)],
        (v, I) => {
            const [c, k, fx, fy] = [I('l:0@9'), I('v:0:add'), I('v:0:factor@0'), I('v:0:factor@4')];
            const [hx, hy, sx, sy] = [I('v:0:shift:0'), I('v:0:shift:1'), I('v:0:scale:0'), I('v:0:scale:1')];
            return [(x, y) => v[fx] * (v[sx] * (x - v[hx])) + v[fy] * (v[sy] * (y - v[hy])) - (v[c] + v[k])];
        }
    );
}

/** `x^2 - 3x + 1`. */
function quad(): Model {
    return mk([lit(0, 6, 3, 'coef'), lit(0, 10, 1, 'offset'), add(0, 11), factor(0, 0), shiftV(0, 0, 0), scaleV(0, 0, 0)], (v, I) => {
        const [b, c, k, f, h, s] = [I('l:0@6'), I('l:0@10'), I('v:0:add'), I('v:0:factor@0'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [
            (x) => {
                const X = v[s] * (x - v[h]);
                return v[f] * X * X - v[b] * X + v[c] + v[k];
            },
        ];
    });
}

/** `sin(x)`: only virtual numbers. */
function sine(): Model {
    return mk([add(0, 6), factor(0, 0), shiftV(0, 0, 4), scaleV(0, 0, 4)], (v, I) => {
        const [k, f, h, s] = [I('v:0:add'), I('v:0:factor@0'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => v[f] * Math.sin(v[s] * (x - v[h])) + v[k]];
    });
}

/** Views and maps. */
const VS1: View = { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
const S1 = screen(VS1);
const VLP: View = { xmin: -0.5, xmax: 5.5, ymin: -0.5, ymax: 4.3 };
const LP = screen(VLP); // kx = ky = 100
const VQ: View = { xmin: -1, xmax: 5, ymin: -3, ymax: 5 };
const SQ = screen(VQ); // kx = 100, ky = 60
const VSIN: View = { xmin: -1, xmax: 7, ymin: -2, ymax: 2.5 };
const SSIN = screen(VSIN);

const PI = Math.PI;

// ============================================================ priority order

test('priorityOrder: Move puts offsets, shifts, then coefficients inside each tier', () => {
    const m = lin2x1();
    const all = m.numbers.map(() => true);
    const ids = priorityOrder(m.numbers, 'move', all).map((i) => m.numbers[i].id);
    assert.deepEqual(ids, ['l:0@5', 'l:0@0', 'v:0:add', 'v:0:shift:0', 'v:0:scale:0']);
});

test('priorityOrder: Pivot puts the first coefficient of each tier first (D4)', () => {
    const m = lin2x1();
    const all = m.numbers.map(() => true);
    const ids = priorityOrder(m.numbers, 'pivot', all).map((i) => m.numbers[i].id);
    assert.deepEqual(ids, ['l:0@0', 'l:0@5', 'v:0:scale:0', 'v:0:add', 'v:0:shift:0']);
    const o = objective();
    const oids = priorityOrder(o.numbers, 'pivot', o.numbers.map(() => true)).map((i) => o.numbers[i].id);
    // Sliders first (tier 1), then the first coefficient 2, then the other coefficient 3.
    assert.deepEqual(oids.slice(0, 3), ['s:c', 'l:0@0', 'l:0@5']);
    assert.deepEqual(oids.slice(3), ['v:0:scale:0', 'v:0:add', 'v:0:scale:1', 'v:0:shift:0', 'v:0:shift:1']);
});

test('priorityOrder: only usable numbers count, also for the first coefficient', () => {
    const o = objective();
    const usable = o.numbers.map((n) => n.id !== 'l:0@0');
    const ids = priorityOrder(o.numbers, 'pivot', usable).map((i) => o.numbers[i].id);
    assert.ok(!ids.includes('l:0@0'));
    assert.deepEqual(ids.slice(0, 2), ['s:c', 'l:0@5']);
});

test('priorityOrder: equal positions break by id (factor before scale on x)', () => {
    const m = clause4();
    const ids = priorityOrder(m.numbers, 'pivot', m.numbers.map(() => true)).map((i) => m.numbers[i].id);
    assert.deepEqual(ids.slice(0, 3), ['l:0@9', 'v:0:factor@0', 'v:0:add']);
});

// =============================================================== active sets

test('planDrag: 2x + 1 Move {1}, turn about (0, 1) {2}, about (1, 3) {2, 1}', () => {
    const m = lin2x1();
    const lines = [lineRun(-2, 1, 1, VS1)];
    const move = planDrag(prob(m, 'graph', [0], { lines }, S1, TRANSLATE, { x: 1, y: 3 }, 'move'));
    assert.deepEqual(activeIds(m, move), ['l:0@5']);
    assert.equal(move.restricted, 'none');
    assert.equal(move.rmax, 2);
    const g1 = { x: 1.5, y: 4 };
    const t1 = planDrag(prob(m, 'graph', [0], { lines }, S1, sim({ x: 0, y: 1 }, g1, S1), g1, 'pivot'));
    assert.deepEqual(activeIds(m, t1), ['l:0@0']);
    const g2 = { x: -1, y: -1 };
    const t2 = planDrag(prob(m, 'graph', [0], { lines }, S1, sim({ x: 1, y: 3 }, g2, S1), g2, 'pivot'));
    assert.deepEqual(activeIds(m, t2), ['l:0@0', 'l:0@5']);
    assert.equal(t2.cost, 2);
});

test('planDrag: 2x + 3y = c Move {c}, turn about (3, 1) {c, 2}; 2x + 3y = 12 about (3, 2) {2, 12}', () => {
    const m = objective();
    const lines = [lineRun(2, 3, 9, VLP)];
    assert.deepEqual(activeIds(m, planDrag(prob(m, 'curve', [0], { lines }, LP, TRANSLATE, { x: 3, y: 1 }, 'move'))), ['s:c']);
    const g = { x: 0, y: 3 };
    assert.deepEqual(activeIds(m, planDrag(prob(m, 'curve', [0], { lines }, LP, sim({ x: 3, y: 1 }, g, LP), g, 'pivot'))), ['l:0@0', 's:c']);
    const n = line12();
    const g2 = { x: 0, y: 4 };
    const plan = planDrag(prob(n, 'curve', [0], { lines: [lineRun(2, 3, 12, VLP)] }, LP, sim({ x: 3, y: 2 }, g2, LP), g2, 'pivot'));
    assert.deepEqual(activeIds(n, plan), ['l:0@0', 'l:0@10']);
});

test('planDrag: x + 3y <= 6 Move {6}, turn about (3, 1) {3, 6}; x + y <= 4 turn {4, factor on x}', () => {
    const m = clause36();
    const lines = [lineRun(1, 3, 6, VLP)];
    assert.deepEqual(activeIds(m, planDrag(prob(m, 'clause', [0], { lines }, LP, TRANSLATE, { x: 3, y: 1 }, 'move'))), ['l:0@10']);
    const g = { x: 0, y: 2 };
    assert.deepEqual(activeIds(m, planDrag(prob(m, 'clause', [0], { lines }, LP, sim({ x: 3, y: 1 }, g, LP), g, 'pivot'))), ['l:0@10', 'l:0@4']);
    const n = clause4();
    const g2 = { x: 1, y: 3 };
    const plan = planDrag(prob(n, 'clause', [0], { lines: [lineRun(1, 1, 4, VLP)] }, LP, sim({ x: 3, y: 1 }, g2, LP), g2, 'pivot'));
    assert.deepEqual(activeIds(n, plan), ['l:0@9', 'v:0:factor@0']);
    assert.equal(plan.cost, 2.5);
});

test('planDrag: a*(x - h)^2 + k Move {k, h}, stretch about the vertex {a}', () => {
    const m = mk(
        [sld('a', 1, 'coef', 0, 0.1, 5, 0.1), sld('h', 2, 'shift', 5, -5, 5, 0.1), sld('k', 1, 'offset', 14, -5, 5, 0.1), add(0, 15), factor(0, 0), shiftV(0, 0, 3), scaleV(0, 0, 3)],
        (v, I) => {
            const [a, h, k, kv, f, hv, s] = [I('s:a'), I('s:h'), I('s:k'), I('v:0:add'), I('v:0:factor@0'), I('v:0:shift:0'), I('v:0:scale:0')];
            return [
                (x) => {
                    const X = v[s] * (x - v[hv]) - v[h];
                    return v[f] * (v[a] * X * X) + v[k] + v[kv];
                },
            ];
        }
    );
    const view: View = { xmin: -1, xmax: 6, ymin: -1, ymax: 8 };
    const map = screen(view);
    const lines = [graphRun((x) => (x - 2) * (x - 2) + 1, view)];
    const g = { x: 3, y: 2 };
    assert.deepEqual(activeIds(m, planDrag(prob(m, 'graph', [0], { lines }, map, TRANSLATE, g, 'move'))), ['s:h', 's:k']);
    const st = planDrag(prob(m, 'graph', [0], { lines }, map, stretch({ x: 2, y: 1 }, g, map), g, 'pivot'));
    assert.deepEqual(activeIds(m, st), ['s:a']);
    assert.equal(st.restricted, 'none');
});

test('planDrag: x^2 - 3x + 1 stretch about the vertex {3, 1, factor}; Move {1, 3}', () => {
    const m = quad();
    const lines = [graphRun((x) => x * x - 3 * x + 1, VQ)];
    const g = { x: 3, y: 1 };
    const st = planDrag(prob(m, 'graph', [0], { lines }, SQ, stretch({ x: 1.5, y: -1.25 }, g, SQ), g, 'pivot'));
    assert.deepEqual(activeIds(m, st), ['l:0@10', 'l:0@6', 'v:0:factor@0']);
    assert.equal(st.cost, 3.5);
    const mv = planDrag(prob(m, 'graph', [0], { lines }, SQ, TRANSLATE, g, 'move'));
    assert.deepEqual(activeIds(m, mv), ['l:0@10', 'l:0@6']);
});

test('planDrag: sin(x) Move {add, shiftVar}; stretch about the origin {factor, scaleVar} is the cheapest pivot (D9)', () => {
    const lines = [graphRun(Math.sin, VSIN)];
    const g = { x: PI / 2, y: 1 };
    const m = sine();
    assert.deepEqual(activeIds(m, planDrag(prob(m, 'graph', [0], { lines }, SSIN, TRANSLATE, g, 'move'))), ['v:0:add', 'v:0:shift:0']);
    const costOf = (P: Pt) => planDrag(prob(m, 'graph', [0], { lines }, SSIN, stretch(P, g, SSIN), g, 'pivot'));
    const origin = costOf({ x: 0, y: 0 });
    const zero = costOf({ x: PI, y: 0 });
    const valley = costOf({ x: 1.5 * PI, y: -1 });
    assert.deepEqual(activeIds(m, origin), ['v:0:factor@0', 'v:0:scale:0']);
    assert.deepEqual(activeIds(m, zero), ['v:0:factor@0', 'v:0:scale:0', 'v:0:shift:0']);
    assert.deepEqual(activeIds(m, valley), ['v:0:add', 'v:0:factor@0', 'v:0:scale:0', 'v:0:shift:0']);
    assert.equal(origin.cost, 3);
    assert.equal(zero.cost, 4.5);
    assert.equal(valley.cost, 6);
});

test('planDrag: 0.5sin(2x) + 1 Move {1, shiftVar}', () => {
    const m = mk([lit(0, 0, 0.5, 'coef'), lit(0, 7, 2, 'coef'), lit(0, 13, 1, 'offset'), add(0, 14), shiftV(0, 0, 8), scaleV(0, 0, 8)], (v, I) => {
        const [a, b, c, k, h, s] = [I('l:0@0'), I('l:0@7'), I('l:0@13'), I('v:0:add'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => v[a] * Math.sin(v[b] * (v[s] * (x - v[h]))) + v[c] + v[k]];
    });
    const view: View = { xmin: -1, xmax: 7, ymin: -1, ymax: 3 };
    const map = screen(view);
    const lines = [graphRun((x) => 0.5 * Math.sin(2 * x) + 1, view)];
    const plan = planDrag(prob(m, 'graph', [0], { lines }, map, TRANSLATE, { x: PI / 4, y: 1.5 }, 'move'));
    assert.deepEqual(activeIds(m, plan), ['l:0@13', 'v:0:shift:0']);
});

test('planDrag: (a, 2a) uses only a and is restricted to a line; a slides to 1.2', () => {
    const m = mk([sld('a', 1, 'offset', 1, 0, 5, 0.05)], (v) => [() => v[0], () => 2 * v[0]]);
    const view: View = { xmin: -1, xmax: 5, ymin: -1, ymax: 5 };
    const map = screen(view, 480, 480);
    const p = prob(m, 'point', [0, 1], { points: [{ x: 1, y: 2 }] }, map, TRANSLATE, { x: 1, y: 2 }, 'move');
    const d = drive(p, { x: 1, y: 2 }, { x: 2, y: 2 });
    assert.deepEqual(activeIds(m, d.plan), ['s:a']);
    assert.equal(d.plan.restricted, 'line');
    near(d.values[0], 1.2, 1e-12, 'a');
    assert.equal(m.v[0], 1.2);
});

test('planDrag: nothing usable gives rmax 0 and restriction fixed', () => {
    const m = mk([lit(0, 0, 2, 'coef')], () => [(x) => x + 1]);
    const plan = planDrag(prob(m, 'graph', [0], { lines: [lineRun(-1, 1, 1, VS1)] }, S1, TRANSLATE, { x: 0, y: 1 }, 'move'));
    assert.deepEqual(plan.active, []);
    assert.equal(plan.rmax, 0);
    assert.equal(plan.restricted, 'fixed');
    assert.deepEqual(plan.usable, [false]);
    assert.ok(!Number.isFinite(plan.sigma[0]));
});

test('planDrag: x <= 4 cannot turn (restricted pivot plan), Move is fine', () => {
    const m = mk([lit(0, 5, 4, 'offset'), add(0, 6), factor(0, 0), shiftV(0, 0, 0), scaleV(0, 0, 0)], (v, I) => {
        const [c, k, f, h, s] = [I('l:0@5'), I('v:0:add'), I('v:0:factor@0'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => v[f] * (v[s] * (x - v[h])) - (v[c] + v[k])];
    });
    const lines = [lineRun(1, 0, 4, VLP)];
    const g = { x: 4, y: 3 };
    const mv = planDrag(prob(m, 'clause', [0], { lines }, LP, TRANSLATE, g, 'move'));
    assert.deepEqual(activeIds(m, mv), ['l:0@5']);
    // Vertical motion slides the line along itself: invisible, so the Move is unrestricted.
    assert.equal(mv.restricted, 'none');
    // About a point on the line: only the invisible scale is achievable, nothing visible changes.
    const turn = planDrag(prob(m, 'clause', [0], { lines }, LP, sim({ x: 4, y: 1 }, g, LP), g, 'pivot'));
    assert.equal(turn.restricted, 'fixed');
    assert.equal(turn.rmax, 0);
    assert.deepEqual(turn.active, []);
    assert.ok(turn.cost >= 1000);
    // About a point off the line: the scale moves it sideways (4 changes), the turn stays impossible.
    const off = planDrag(prob(m, 'clause', [0], { lines }, LP, sim({ x: 3, y: 1 }, g, LP), g, 'pivot'));
    assert.equal(off.rmax, 1);
    assert.notEqual(off.restricted, 'none');
    assert.deepEqual(activeIds(m, off), ['l:0@5']);
});

// ============================================================ natural pivots

function pivotOf(m: Model, plan: DragPlan, id: string): Pt | null {
    const hit = plan.naturalPivots.find((n) => m.numbers[n.number].id === id);
    return hit ? hit.at : null;
}

test('natural pivots: 2x + 1, 10 - a*x, x + 3y <= 6, 2x + 3y = c (SPEC3 2.5 item 8)', () => {
    const m = lin2x1();
    const p1 = planDrag(prob(m, 'graph', [0], { lines: [lineRun(-2, 1, 1, VS1)] }, S1, TRANSLATE, { x: 1, y: 3 }, 'move'));
    const a = pivotOf(m, p1, 'l:0@0') as Pt;
    near(a.x, 0, 1e-6, '2 -> x');
    near(a.y, 1, 1e-6, '2 -> y');
    assert.equal(pivotOf(m, p1, 'l:0@5'), null, 'the offset has no pivot');
    assert.equal(pivotOf(m, p1, 'v:0:add'), null);
    assert.equal(pivotOf(m, p1, 'v:0:shift:0'), null);

    const d = mk([lit(0, 0, 10, 'offset'), sld('a', 1, 'coef', 5, 0, 3, 0.05), add(0, 8), factor(0, 5), shiftV(0, 0, 7), scaleV(0, 0, 7)], (v, I) => {
        const [c, a2, k, f, h, s] = [I('l:0@0'), I('s:a'), I('v:0:add'), I('v:0:factor@5'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => v[c] - v[f] * (v[a2] * (v[s] * (x - v[h]))) + v[k]];
    });
    const dv: View = { xmin: 0, xmax: 12, ymin: 0, ymax: 11 };
    const p2 = planDrag(prob(d, 'graph', [0], { lines: [lineRun(1, 1, 10, dv)] }, screen(dv), TRANSLATE, { x: 2, y: 8 }, 'move'));
    const pa = pivotOf(d, p2, 's:a') as Pt;
    near(pa.x, 0, 1e-6);
    near(pa.y, 10, 1e-6);

    const c = clause36();
    const p3 = planDrag(prob(c, 'clause', [0], { lines: [lineRun(1, 3, 6, VLP)] }, LP, TRANSLATE, { x: 3, y: 1 }, 'move'));
    const p33 = pivotOf(c, p3, 'l:0@4') as Pt;
    near(p33.x, 6, 1e-6);
    near(p33.y, 0, 1e-6);
    const pf = pivotOf(c, p3, 'v:0:factor@0') as Pt;
    near(pf.x, 0, 1e-6);
    near(pf.y, 2, 1e-6);

    const o = objective();
    const p4 = planDrag(prob(o, 'curve', [0], { lines: [lineRun(2, 3, 9, VLP)] }, LP, TRANSLATE, { x: 3, y: 1 }, 'move'));
    const q2 = pivotOf(o, p4, 'l:0@0') as Pt;
    near(q2.x, 0, 1e-6);
    near(q2.y, 3, 1e-6);
    const q3 = pivotOf(o, p4, 'l:0@5') as Pt;
    near(q3.x, 4.5, 1e-6);
    near(q3.y, 0, 1e-6);
    assert.equal(pivotOf(o, p4, 's:c'), null);
});

test('natural pivots: none for curved shapes', () => {
    const m = quad();
    const plan = planDrag(prob(m, 'graph', [0], { lines: [graphRun((x) => x * x - 3 * x + 1, VQ)] }, SQ, TRANSLATE, { x: 3, y: 1 }, 'move'));
    assert.deepEqual(plan.naturalPivots, []);
});

// ================================================== solve: D4 / D9 examples

test('2x + 3y = c turned about the optimum (3, 1): 2.5x + 3y = c with c = 10.5 (D4)', () => {
    const m = objective();
    const G = m.ev.fns[0];
    const g = { x: 0, y: 3 };
    const P = { x: 3, y: 1 };
    const cursor = { x: 0, y: 3.5 };
    const p = prob(m, 'curve', [0], { lines: [lineRun(2, 3, 9, VLP)] }, LP, sim(P, g, LP), g, 'pivot');
    const d = drive(p, g, cursor, { measure: (c) => distImplicit(G, c, LP) });
    for (const e of d.exactDist) assert.ok(e <= 0.5, `cursor-to-object ${e}`);
    assert.equal(m.val('l:0@0'), 2.5);
    assert.equal(m.val('l:0@5'), 3);
    assert.equal(m.val('s:c'), 10.5);
    assert.ok(distImplicit(G, P, LP) <= 2, 'pivot stays on the line');
    assert.ok(distImplicit(G, cursor, LP) <= 2);
    // Only one coefficient plus the offset changed.
    assert.equal(m.val('v:0:scale:0'), 1);
    assert.equal(m.val('v:0:scale:1'), 1);
});

test('x + 3y <= 6 turned about the corner (3, 1): x + 2y <= 5 (D4)', () => {
    const m = clause36();
    const G = m.ev.fns[0];
    const g = { x: 0, y: 2 };
    const P = { x: 3, y: 1 };
    const p = prob(m, 'clause', [0], { lines: [lineRun(1, 3, 6, VLP)] }, LP, sim(P, g, LP), g, 'pivot');
    const d = drive(p, g, { x: 0, y: 2.5 }, { measure: (c) => distImplicit(G, c, LP) });
    for (const e of d.exactDist) assert.ok(e <= 0.5, `cursor-to-object ${e}`);
    assert.equal(m.val('l:0@4'), 2);
    assert.equal(m.val('l:0@10'), 5);
    assert.equal(m.val('v:0:factor@0'), 1);
    assert.ok(distImplicit(G, P, LP) <= 2);
    assert.ok(d.solved.ok);
});

test('sin(x) Shift-stretched about the origin: 1.5sin(x), no offset added (D9)', () => {
    const m = sine();
    const f = m.ev.fns[0];
    const g = { x: PI / 2, y: 1 };
    const p = prob(m, 'graph', [0], { lines: [graphRun(Math.sin, VSIN)] }, SSIN, stretch({ x: 0, y: 0 }, g, SSIN), g, 'pivot');
    const d = drive(p, g, { x: PI / 2, y: 1.5 }, { measure: (c) => distGraph(f, c, SSIN) });
    for (const e of d.exactDist) assert.ok(e <= 0.5, `cursor-to-object ${e}`);
    assert.equal(m.val('v:0:factor@0'), 1.5);
    assert.equal(m.val('v:0:scale:0'), 1);
    assert.equal(m.val('v:0:add'), 0);
    assert.equal(m.val('v:0:shift:0'), 0);
});

test('2x + 3y = 12 turned about (3, 2): 2.4x + 3y = 13.2', () => {
    const m = line12();
    const G = m.ev.fns[0];
    const g = { x: 0, y: 4 };
    const p = prob(m, 'curve', [0], { lines: [lineRun(2, 3, 12, VLP)] }, LP, sim({ x: 3, y: 2 }, g, LP), g, 'pivot');
    drive(p, g, { x: 0, y: 4.4 });
    assert.equal(m.val('l:0@0'), 2.4);
    assert.equal(m.val('l:0@5'), 3);
    assert.equal(m.val('l:0@10'), 13.2);
    assert.ok(distImplicit(G, { x: 3, y: 2 }, LP) <= 2);
});

test('x + y <= 4 turned about (3, 1): 1.2x + y <= 4.6 (factor inserted on x)', () => {
    const m = clause4();
    const g = { x: 1, y: 3 };
    const p = prob(m, 'clause', [0], { lines: [lineRun(1, 1, 4, VLP)] }, LP, sim({ x: 3, y: 1 }, g, LP), g, 'pivot');
    drive(p, g, { x: 1, y: 3.4 });
    assert.equal(m.val('v:0:factor@0'), 1.2);
    assert.equal(m.val('l:0@9'), 4.6);
    assert.equal(m.val('v:0:factor@4'), 1);
});

// ======================================================= graphs (1.4 rows)

test('graph Move: 2x + 1 by (0.5, 0.8) changes only the offset (2x + 0.8)', () => {
    const m = lin2x1();
    const f = m.ev.fns[0];
    const p = prob(m, 'graph', [0], { lines: [lineRun(-2, 1, 1, VS1)] }, S1, TRANSLATE, { x: 1, y: 3 }, 'move');
    const d = drive(p, { x: 1, y: 3 }, { x: 1.5, y: 3.8 }, { measure: (c) => distGraph(f, c, S1) });
    for (const e of d.exactDist) assert.ok(e <= 0.5);
    assert.equal(m.val('l:0@0'), 2, 'a Move never changes the slope');
    assert.equal(m.val('l:0@5'), 0.8);
});

test('graph turn: 2x + 1 about (0, 1) to slope 1, about (1, 3) to 1.5x + 1.5', () => {
    const m = lin2x1();
    const g = { x: 1.5, y: 4 };
    const p = prob(m, 'graph', [0], { lines: [lineRun(-2, 1, 1, VS1)] }, S1, sim({ x: 0, y: 1 }, g, S1), g, 'pivot');
    drive(p, g, { x: 3, y: 4 });
    assert.equal(m.val('l:0@0'), 1);
    assert.equal(m.val('l:0@5'), 1);
    const n = lin2x1();
    const g2 = { x: -1, y: -1 };
    const p2 = prob(n, 'graph', [0], { lines: [lineRun(-2, 1, 1, VS1)] }, S1, sim({ x: 1, y: 3 }, g2, S1), g2, 'pivot');
    drive(p2, g2, { x: -1, y: 0 });
    assert.equal(n.val('l:0@0'), 1.5);
    assert.equal(n.val('l:0@5'), 1.5);
});

test('graph stretch: x^2 - 3x + 1 about the vertex keeps the standard form', () => {
    const m = quad();
    const f = m.ev.fns[0];
    const g = { x: 3, y: 1 };
    const P = { x: 1.5, y: -1.25 };
    const p = prob(m, 'graph', [0], { lines: [graphRun((x) => x * x - 3 * x + 1, VQ)] }, SQ, stretch(P, g, SQ), g, 'pivot');
    const d = drive(p, g, { x: 3, y: 2 }, { measure: (c) => distGraph(f, c, SQ) });
    for (const e of d.exactDist) assert.ok(e <= 0.5, `cursor-to-object ${e}`);
    assert.ok(distGraph(f, P, SQ) <= 2, 'vertex stays');
    near(m.val('l:0@6'), 4.3, 1e-12, '3 -> 4.3');
    near(m.val('l:0@10'), 2, 1e-12, '1 -> 2');
    const a = m.val('v:0:factor@0');
    assert.ok(Math.abs(a - 1.4444) < 0.02, `factor ${a}`);
    assert.equal(m.val('v:0:shift:0'), 0);
    assert.equal(m.val('v:0:scale:0'), 1);
});

test('graph Move grabbed at the vertex (extremum delegate): x^2 - 3x + 1 by (0.5, 1) -> x^2 - 4x + 3.75', () => {
    const m = quad();
    const g = { x: 1.5, y: -1.25 };
    const p = prob(m, 'graph', [0], { lines: [graphRun((x) => x * x - 3 * x + 1, VQ)] }, SQ, TRANSLATE, g, 'move');
    drive(p, g, { x: 2, y: -0.25 });
    assert.equal(m.val('l:0@6'), 4);
    assert.equal(m.val('l:0@10'), 3.75);
    assert.equal(m.val('v:0:factor@0'), 1);
});

test('graph Move: sin(x) by (0.5, 0.5) shifts and offsets; 0.5sin(2x) + 1 vertical keeps the phase', () => {
    const m = sine();
    const g = { x: PI / 2, y: 1 };
    const p = prob(m, 'graph', [0], { lines: [graphRun(Math.sin, VSIN)] }, SSIN, TRANSLATE, g, 'move');
    drive(p, g, { x: PI / 2 + 0.5, y: 1.5 });
    assert.equal(m.val('v:0:shift:0'), 0.5);
    assert.equal(m.val('v:0:add'), 0.5);
    assert.equal(m.val('v:0:factor@0'), 1);

    const build = () =>
        mk([lit(0, 0, 0.5, 'coef'), lit(0, 7, 2, 'coef'), lit(0, 13, 1, 'offset'), add(0, 14), shiftV(0, 0, 8), scaleV(0, 0, 8)], (v, I) => {
            const [a, b, c, k, h, s] = [I('l:0@0'), I('l:0@7'), I('l:0@13'), I('v:0:add'), I('v:0:shift:0'), I('v:0:scale:0')];
            return [(x) => v[a] * Math.sin(v[b] * (v[s] * (x - v[h]))) + v[c] + v[k]];
        });
    const view: View = { xmin: -1, xmax: 7, ymin: -1, ymax: 3 };
    const map = screen(view);
    const lines = [graphRun((x) => 0.5 * Math.sin(2 * x) + 1, view)];
    const pk = { x: PI / 4, y: 1.5 };
    const n = build();
    drive(prob(n, 'graph', [0], { lines }, map, TRANSLATE, pk, 'move'), pk, { x: PI / 4, y: 1.8 });
    near(n.val('l:0@13'), 1.3, 1e-12);
    assert.equal(n.val('v:0:shift:0'), 0);
    const o = build();
    drive(prob(o, 'graph', [0], { lines }, map, TRANSLATE, pk, 'move'), pk, { x: PI / 4 + 0.3, y: 1.8 });
    near(o.val('l:0@13'), 1.3, 1e-12);
    near(o.val('v:0:shift:0'), 0.3, 1e-12);
});

test('graph Move: x^2 + 1 sideways adds only a shift; -x + 4 down 6 gives -2; e^(0.5x) by (1, 1)', () => {
    const m = mk([lit(0, 4, 1, 'offset'), add(0, 5), factor(0, 0), shiftV(0, 0, 0), scaleV(0, 0, 0)], (v, I) => {
        const [c, k, f, h, s] = [I('l:0@4'), I('v:0:add'), I('v:0:factor@0'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [
            (x) => {
                const X = v[s] * (x - v[h]);
                return v[f] * X * X + v[c] + v[k];
            },
        ];
    });
    drive(prob(m, 'graph', [0], { lines: [graphRun((x) => x * x + 1, VQ)] }, SQ, TRANSLATE, { x: 1, y: 2 }, 'move'), { x: 1, y: 2 }, { x: 2, y: 2 });
    assert.equal(m.val('v:0:shift:0'), 1);
    assert.equal(m.val('l:0@4'), 1);
    assert.equal(m.val('v:0:add'), 0);

    const n = mk([lit(0, 5, 4, 'offset'), add(0, 6), factor(0, 0), shiftV(0, 0, 1), scaleV(0, 0, 1)], (v, I) => {
        const [c, k, f, h, s] = [I('l:0@5'), I('v:0:add'), I('v:0:factor@0'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => -(v[f] * (v[s] * (x - v[h]))) + v[c] + v[k]];
    });
    drive(prob(n, 'graph', [0], { lines: [lineRun(1, 1, 4, VS1)] }, S1, TRANSLATE, { x: 2, y: 2 }, 'move'), { x: 2, y: 2 }, { x: 2, y: -4 });
    assert.equal(n.val('l:0@5'), -2);
    assert.equal(n.val('v:0:factor@0'), 1);

    const e = mk([lit(0, 3, 0.5, 'coef'), add(0, 8), factor(0, 0), shiftV(0, 0, 6), scaleV(0, 0, 6)], (v, I) => {
        const [c, k, f, h, s] = [I('l:0@3'), I('v:0:add'), I('v:0:factor@0'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => v[f] * Math.exp(v[c] * (v[s] * (x - v[h]))) + v[k]];
    });
    const plan = planDrag(prob(e, 'graph', [0], { lines: [graphRun((x) => Math.exp(0.5 * x), VS1)] }, S1, TRANSLATE, { x: 0, y: 1 }, 'move'));
    assert.deepEqual(activeIds(e, plan), ['v:0:add', 'v:0:shift:0']);
    drive(prob(e, 'graph', [0], { lines: [graphRun((x) => Math.exp(0.5 * x), VS1)] }, S1, TRANSLATE, { x: 0, y: 1 }, 'move'), { x: 0, y: 1 }, { x: 1, y: 2 });
    assert.equal(e.val('v:0:shift:0'), 1);
    assert.equal(e.val('v:0:add'), 1);
    assert.equal(e.val('l:0@3'), 0.5);
});

test('graph stretch: 2^x about (0, 1) by 1.5 vertically gives factor 1.5 and offset -0.5', () => {
    const m = mk([lit(0, 0, 2, 'coef'), add(0, 3), factor(0, 0), shiftV(0, 0, 2), scaleV(0, 0, 2)], (v, I) => {
        const [b, k, f, h, s] = [I('l:0@0'), I('v:0:add'), I('v:0:factor@0'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => v[f] * Math.pow(v[b], v[s] * (x - v[h])) + v[k]];
    });
    const g = { x: 1, y: 2 };
    const p = prob(m, 'graph', [0], { lines: [graphRun((x) => Math.pow(2, x), VS1)] }, S1, stretch({ x: 0, y: 1 }, g, S1), g, 'pivot');
    const d = drive(p, g, { x: 1, y: 2.5 });
    assert.deepEqual(activeIds(m, d.plan), ['l:0@0', 'v:0:add', 'v:0:factor@0']);
    assert.equal(m.val('v:0:factor@0'), 1.5);
    assert.equal(m.val('v:0:add'), -0.5);
    assert.equal(m.val('l:0@0'), 2);
});

test('graph turn: -3x + 2 to slope 1.2, x*3 to slope -2, 1/2 x + 1 (folded) to slope 1', () => {
    const a = mk([lit(0, 1, 3, 'coef'), lit(0, 5, 2, 'offset'), add(0, 6), shiftV(0, 0, 2), scaleV(0, 0, 2)], (v, I) => {
        const [c3, c2, k, h, s] = [I('l:0@1'), I('l:0@5'), I('v:0:add'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => -(v[c3] * (v[s] * (x - v[h]))) + v[c2] + v[k]];
    });
    const g = { x: -1, y: 5 };
    drive(prob(a, 'graph', [0], { lines: [lineRun(3, 1, 2, VS1)] }, S1, sim({ x: 0, y: 2 }, g, S1), g, 'pivot'), g, { x: -2, y: -0.4 });
    assert.equal(a.val('l:0@1'), -1.2);
    assert.equal(a.val('l:0@5'), 2);

    const b = mk([lit(0, 2, 3, 'coef'), add(0, 3), factor(0, 0), shiftV(0, 0, 0), scaleV(0, 0, 0)], (v, I) => {
        const [c3, k, f, h, s] = [I('l:0@2'), I('v:0:add'), I('v:0:factor@0'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => v[f] * (v[s] * (x - v[h]) * v[c3]) + v[k]];
    });
    const gb = { x: 1, y: 3 };
    const db = drive(prob(b, 'graph', [0], { lines: [lineRun(-3, 1, 0, VS1)] }, S1, sim({ x: 0, y: 0 }, gb, S1), gb, 'pivot'), gb, { x: -1, y: 2 });
    assert.deepEqual(activeIds(b, db.plan), ['l:0@2']);
    assert.equal(b.val('l:0@2'), -2);

    const c = mk([fold(0, 0, 0.5, 'coef', '1/2'), lit(0, 6, 1, 'offset'), add(0, 7), shiftV(0, 0, 4), scaleV(0, 0, 4)], (v, I) => {
        const [h2, c1, k, h, s] = [I('f:0@0'), I('l:0@6'), I('v:0:add'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => v[h2] * (v[s] * (x - v[h])) + v[c1] + v[k]];
    });
    const gc = { x: 4, y: 3 };
    const dc = drive(prob(c, 'graph', [0], { lines: [lineRun(-0.5, 1, 1, VS1)] }, S1, sim({ x: 0, y: 1 }, gc, S1), gc, 'pivot'), gc, { x: 3, y: 4 });
    assert.deepEqual(activeIds(c, dc.plan), ['f:0@0']);
    assert.equal(c.val('f:0@0'), 1);
    assert.equal(c.val('l:0@6'), 1);
});

test('graph with a slider: 10 - a*x Move up 0.5 changes 10, turn about (4, 6) gives 12 - a*x with a = 1.5', () => {
    const build = () =>
        mk([lit(0, 0, 10, 'offset'), sld('a', 1, 'coef', 5, 0, 3, 0.05), add(0, 8), factor(0, 5), shiftV(0, 0, 7), scaleV(0, 0, 7)], (v, I) => {
            const [c, a, k, f, h, s] = [I('l:0@0'), I('s:a'), I('v:0:add'), I('v:0:factor@5'), I('v:0:shift:0'), I('v:0:scale:0')];
            return [(x) => v[c] - v[f] * (v[a] * (v[s] * (x - v[h]))) + v[k]];
        });
    const view: View = { xmin: 0, xmax: 12, ymin: 0, ymax: 11 };
    const map = screen(view);
    const lines = [lineRun(1, 1, 10, view)];
    const m = build();
    drive(prob(m, 'graph', [0], { lines }, map, TRANSLATE, { x: 2, y: 8 }, 'move'), { x: 2, y: 8 }, { x: 2, y: 8.5 });
    assert.equal(m.val('l:0@0'), 10.5);
    assert.equal(m.val('s:a'), 1);
    const n = build();
    const g = { x: 2, y: 8 };
    const d = drive(prob(n, 'graph', [0], { lines }, map, sim({ x: 4, y: 6 }, g, map), g, 'pivot'), g, { x: 2, y: 9 });
    assert.deepEqual(activeIds(n, d.plan), ['l:0@0', 's:a']);
    assert.equal(n.val('l:0@0'), 12);
    assert.equal(n.val('s:a'), 1.5);
    assert.ok(n.applied.n > 0, 'slider values were pushed with ev.apply()');
});

test('graph turn clamped at 89 degrees stays finite; beyond vertical is rejected or finite', () => {
    const m = lin2x1();
    const P = { x: 0, y: 1 };
    const g = { x: 1.5, y: 4 };
    const p = prob(m, 'graph', [0], { lines: [lineRun(-2, 1, 1, VS1)] }, S1, sim(P, g, S1), g, 'pivot');
    const Ppx = toPx(P, S1);
    const R = Math.hypot(toPx(g, S1).x - Ppx.x, toPx(g, S1).y - Ppx.y);
    const g0 = Math.atan2(toPx(g, S1).y - Ppx.y, toPx(g, S1).x - Ppx.x);
    const path: Pt[] = [];
    const end = (89 * PI) / 180;
    for (let k = 1; k <= 24; k++) {
        const t = g0 + ((end - g0) * k) / 24;
        path.push(fromPx({ x: Ppx.x + R * Math.cos(t), y: Ppx.y + R * Math.sin(t) }, S1));
    }
    const d = drive(p, g, path);
    assert.ok(d.solved.ok);
    for (const v of d.values) assert.ok(Number.isFinite(v));
    const slopePx = (m.val('l:0@0') * S1.ky) / S1.kx;
    near(Math.atan(slopePx) * (180 / PI), 89, 0.2, 'screen angle');
    // Past vertical a function cannot follow: the frame is rejected or stays finite.
    const beyond = fromPx({ x: Ppx.x + R * Math.cos((95 * PI) / 180), y: Ppx.y + R * Math.sin((95 * PI) / 180) }, S1);
    const s = solveDrag(p, d.plan, toPx(beyond, S1), toPx(path[path.length - 1], S1), d.solved.warm, boundsFor(m.numbers));
    for (const v of s.values) assert.ok(Number.isFinite(v));
    for (const v of s.values) assert.ok(Math.abs(v) <= 1e6);
});

// ============================================================ implicit (1.4)

test('clause Move: x + 3y <= 6 changes only 6; x <= 4 in 0 <= x <= 4; x <= 2pi gets an add; x <= 4 - y', () => {
    const m = clause36();
    const G = m.ev.fns[0];
    const p = prob(m, 'clause', [0], { lines: [lineRun(1, 3, 6, VLP)] }, LP, TRANSLATE, { x: 3, y: 1 }, 'move');
    const d = drive(p, { x: 3, y: 1 }, { x: 3.6, y: 1 }, { measure: (c) => distImplicit(G, c, LP) });
    for (const e of d.exactDist) assert.ok(e <= 0.5);
    assert.equal(m.val('l:0@10'), 6.6);
    assert.equal(m.val('l:0@4'), 3);

    const x4 = mk([lit(0, 10, 4, 'offset'), add(0, 11)], (v) => [(x) => x - (v[0] + v[1])]);
    drive(prob(x4, 'clause', [0], { lines: [lineRun(1, 0, 4, VLP)] }, LP, TRANSLATE, { x: 4, y: 2 }, 'move'), { x: 4, y: 2 }, { x: 4.5, y: 2.3 });
    assert.equal(x4.v[0], 4.5);
    assert.equal(x4.v[1], 0);

    const x2pi = mk([add(0, 14)], (v) => [(x) => x - (2 * PI + v[0])]);
    const view: View = { xmin: -1, xmax: 8, ymin: -2, ymax: 2 };
    const map = screen(view);
    drive(prob(x2pi, 'clause', [0], { lines: [lineRun(1, 0, 2 * PI, view)] }, map, TRANSLATE, { x: 2 * PI, y: 0 }, 'move'), { x: 2 * PI, y: 0 }, { x: 2 * PI + 0.3, y: 0 });
    near(x2pi.v[0], 0.3, 1e-12);

    const xy = mk([lit(0, 4, 4, 'offset'), add(0, 9), factor(0, 8), shiftV(0, 0, 0), shiftV(0, 1, 8), scaleV(0, 0, 0), scaleV(0, 1, 8)], (v, I) => {
        const [c, k, fy, hx, hy, sx, sy] = [I('l:0@4'), I('v:0:add'), I('v:0:factor@8'), I('v:0:shift:0'), I('v:0:shift:1'), I('v:0:scale:0'), I('v:0:scale:1')];
        return [(x, y) => v[sx] * (x - v[hx]) - (v[c] - v[fy] * (v[sy] * (y - v[hy])) + v[k])];
    });
    drive(prob(xy, 'clause', [0], { lines: [lineRun(1, 1, 4, VLP)] }, LP, TRANSLATE, { x: 2, y: 2 }, 'move'), { x: 2, y: 2 }, { x: 2.5, y: 2 });
    assert.equal(xy.val('l:0@4'), 4.5);
});

test('clause resize: (x - 3)^2 + (y - 2)^2 <= 2^2 Move shifts the centre, resize changes the base literal', () => {
    const build = () =>
        mk(
            [lit(0, 5, 3, 'shift'), lit(0, 17, 2, 'shift'), lit(0, 25, 2, 'coef'), add(0, 28), factor(0, 0), factor(0, 12), shiftV(0, 0, 1), shiftV(0, 1, 13), scaleV(0, 0, 1), scaleV(0, 1, 13)],
            (v, I) => {
                const [cx, cy, r, k, fx, fy] = [I('l:0@5'), I('l:0@17'), I('l:0@25'), I('v:0:add'), I('v:0:factor@0'), I('v:0:factor@12')];
                const [hx, hy, sx, sy] = [I('v:0:shift:0'), I('v:0:shift:1'), I('v:0:scale:0'), I('v:0:scale:1')];
                return [
                    (x, y) => {
                        const X = v[sx] * (x - v[hx]) - v[cx];
                        const Y = v[sy] * (y - v[hy]) - v[cy];
                        return v[fx] * X * X + v[fy] * Y * Y - (v[r] * v[r] + v[k]);
                    },
                ];
            }
        );
    const view: View = { xmin: -1, xmax: 7, ymin: -1, ymax: 5.4 };
    const map = screen(view); // 75 px per unit both ways
    const lines = [circleRun(3, 2, 2)];
    const m = build();
    const G = m.ev.fns[0];
    const d = drive(prob(m, 'clause', [0], { lines }, map, TRANSLATE, { x: 5, y: 2 }, 'move'), { x: 5, y: 2 }, { x: 5.5, y: 2.6 }, { measure: (c) => distImplicit(G, c, map) });
    for (const e of d.exactDist) assert.ok(e <= 0.5);
    assert.deepEqual(activeIds(m, d.plan), ['l:0@17', 'l:0@5']);
    assert.equal(m.val('l:0@5'), 3.5);
    assert.equal(m.val('l:0@17'), 2.6);
    assert.equal(m.val('l:0@25'), 2);

    const n = build();
    const g = { x: 5, y: 2 };
    const P = { x: 3, y: 2 };
    const r = drive(prob(n, 'clause', [0], { lines }, map, sim(P, g, map, false), g, 'pivot'), g, { x: 5.5, y: 2 });
    assert.deepEqual(activeIds(n, r.plan), ['l:0@25']);
    assert.equal(n.val('l:0@25'), 2.5);
    assert.equal(n.val('l:0@5'), 3);
    assert.equal(n.val('l:0@17'), 2);
});

test('clause stretch (open curve): y <= x^2 follows the pointer with one number', () => {
    const m = mk([add(0, 8), factor(0, 5), shiftV(0, 0, 5), shiftV(0, 1, 0), scaleV(0, 0, 5), scaleV(0, 1, 0)], (v, I) => {
        const [k, f, hx, hy, sx, sy] = [I('v:0:add'), I('v:0:factor@5'), I('v:0:shift:0'), I('v:0:shift:1'), I('v:0:scale:0'), I('v:0:scale:1')];
        return [
            (x, y) => {
                const X = v[sx] * (x - v[hx]);
                return v[sy] * (y - v[hy]) - (v[f] * X * X + v[k]);
            },
        ];
    });
    const view: View = { xmin: -3, xmax: 3, ymin: -1, ymax: 5 };
    const map = screen(view);
    const G = m.ev.fns[0];
    const g = { x: 1.5, y: 2.25 };
    const p = prob(m, 'clause', [0], { lines: [graphRun((x) => x * x, view)] }, map, stretch({ x: 0, y: 0 }, g, map), g, 'pivot');
    const d = drive(p, g, { x: 1.5, y: 3.5 }, { measure: (c) => distImplicit(G, c, map) });
    assert.equal(d.plan.active.length, 1);
    for (const e of d.exactDist) assert.ok(e <= 0.5, `cursor-to-object ${e}`);
    assert.ok(distImplicit(G, { x: 0, y: 0 }, map) <= 2);
});

test('curve Move: x^2 + y^2 = 4 shifts both variables', () => {
    const m = mk([lit(0, 12, 4, 'offset'), add(0, 13), factor(0, 0), factor(0, 6), shiftV(0, 0, 0), shiftV(0, 1, 6), scaleV(0, 0, 0), scaleV(0, 1, 6)], (v, I) => {
        const [c, k, fx, fy] = [I('l:0@12'), I('v:0:add'), I('v:0:factor@0'), I('v:0:factor@6')];
        const [hx, hy, sx, sy] = [I('v:0:shift:0'), I('v:0:shift:1'), I('v:0:scale:0'), I('v:0:scale:1')];
        return [
            (x, y) => {
                const X = v[sx] * (x - v[hx]);
                const Y = v[sy] * (y - v[hy]);
                return v[fx] * X * X + v[fy] * Y * Y - (v[c] + v[k]);
            },
        ];
    });
    const view: View = { xmin: -4, xmax: 4, ymin: -3.2, ymax: 3.2 };
    const map = screen(view);
    const G = m.ev.fns[0];
    const d = drive(prob(m, 'curve', [0], { lines: [circleRun(0, 0, 2)] }, map, TRANSLATE, { x: 2, y: 0 }, 'move'), { x: 2, y: 0 }, { x: 2.5, y: 0.7 }, { measure: (c) => distImplicit(G, c, map) });
    for (const e of d.exactDist) assert.ok(e <= 0.5);
    assert.deepEqual(activeIds(m, d.plan), ['v:0:shift:0', 'v:0:shift:1']);
    assert.equal(m.val('v:0:shift:0'), 0.5);
    assert.equal(m.val('v:0:shift:1'), 0.7);
    assert.equal(m.val('l:0@12'), 4);
});

test('curve resize: x^2 + y^2 = 4 resized about the centre by 1.25 changes only 4 (rounder 6.2 is within 2 px)', () => {
    const m = mk([lit(0, 12, 4, 'offset'), add(0, 13), factor(0, 0), factor(0, 6), shiftV(0, 0, 0), shiftV(0, 1, 6), scaleV(0, 0, 0), scaleV(0, 1, 6)], (v, I) => {
        const [c, k, fx, fy] = [I('l:0@12'), I('v:0:add'), I('v:0:factor@0'), I('v:0:factor@6')];
        const [hx, hy, sx, sy] = [I('v:0:shift:0'), I('v:0:shift:1'), I('v:0:scale:0'), I('v:0:scale:1')];
        return [
            (x, y) => {
                const X = v[sx] * (x - v[hx]);
                const Y = v[sy] * (y - v[hy]);
                return v[fx] * X * X + v[fy] * Y * Y - (v[c] + v[k]);
            },
        ];
    });
    const view: View = { xmin: -4, xmax: 4, ymin: -3.2, ymax: 3.2 };
    const map = screen(view);
    const G = m.ev.fns[0];
    const g = { x: 2, y: 0 };
    const d = drive(prob(m, 'curve', [0], { lines: [circleRun(0, 0, 2)] }, map, sim({ x: 0, y: 0 }, g, map, false), g, 'pivot'), g, { x: 2.5, y: 0 }, { measure: (c) => distImplicit(G, c, map) });
    for (const e of d.exactDist) assert.ok(e <= 0.5);
    assert.deepEqual(activeIds(m, d.plan), ['l:0@12']);
    // Exact 6.25 (radius 2.5); 6.2 (radius 2.49, under 1 px off) is the roundest value within 2 px.
    near(d.exact[m.I('l:0@12')], 6.25, 0.01);
    assert.equal(m.val('l:0@12'), 6.2);
    assert.equal(d.plan.restricted, 'none');
});

test('level push: 1, 3.2, 6 on x^2 + y^2, level 2 pushed to (1.5, 1.4) becomes 4.2', () => {
    const m = mk([lit(0, 3, 3.2, 'offset')], (v) => [() => v[0]]);
    const view: View = { xmin: -3, xmax: 3, ymin: -2.4, ymax: 2.4 };
    const map = screen(view);
    const F = (x: number, y: number) => x * x + y * y;
    const r = Math.sqrt(3.2);
    const g = { x: r * Math.SQRT1_2, y: r * Math.SQRT1_2 };
    const p = prob(m, 'level', [0], { lines: [circleRun(0, 0, r)], F }, map, { kind: 'push' }, g, 'move');
    const d = drive(p, g, { x: 1.5, y: 1.4 });
    assert.equal(d.plan.rmax, 1);
    assert.equal(d.plan.restricted, 'none');
    assert.deepEqual(d.plan.basis, []);
    near(d.exact[0], 4.21, 1e-6, 'exact level through the pointer');
    assert.equal(m.v[0], 4.2);
    assert.ok(p.shape.samples().length >= 12, 'the level curve is sampled for the safety net');
});

test('level Shift: the equation is reshaped with the level value fixed (resize about the centre)', () => {
    const m = mk([factor(0, 0), factor(0, 6), shiftV(0, 0, 0), shiftV(0, 1, 6), scaleV(0, 0, 0), scaleV(0, 1, 6)], (v, I) => {
        const [fx, fy, hx, hy, sx, sy] = [I('v:0:factor@0'), I('v:0:factor@6'), I('v:0:shift:0'), I('v:0:shift:1'), I('v:0:scale:0'), I('v:0:scale:1')];
        return [
            (x, y) => {
                const X = v[sx] * (x - v[hx]);
                const Y = v[sy] * (y - v[hy]);
                return v[fx] * X * X + v[fy] * Y * Y;
            },
        ];
    });
    const view: View = { xmin: -4, xmax: 4, ymin: -3.2, ymax: 3.2 };
    const map = screen(view);
    const G = (x: number, y: number) => m.ev.fns[0](x, y) - 4;
    const g = { x: 2, y: 0 };
    const p = prob(m, 'level', [0], { lines: [circleRun(0, 0, 2)], levelValue: 4 }, map, sim({ x: 0, y: 0 }, g, map, false), g, 'pivot');
    const d = drive(p, g, { x: 3, y: 0 }, { measure: (c) => distImplicit(G, c, map) });
    for (const e of d.exactDist) assert.ok(e <= 0.5, `cursor-to-object ${e}`);
    assert.equal(d.plan.active.length, 2);
    // Radius 3: every point of the new circle satisfies F = 4.
    assert.ok(distImplicit(G, { x: 0, y: 3 }, map) <= 2);
    assert.ok(distImplicit(G, { x: -3, y: 0 }, map) <= 2);
});

// =========================================================== point-like (1.4)

test('points: point 2 of (1, 1); (3, 2) follows to (3.37, 1.52) and writes (3.37, 1.5)', () => {
    const m = mk([lit(0, 9, 3, 'offset'), lit(1, 12, 2, 'offset')], (v) => [() => v[0], () => v[1]]);
    // kx = 120, ky = 96: 3.35 would be 2.4 px off, 1.5 is 1.92 px off.
    const view: View = { xmin: -0.5, xmax: 4.5, ymin: -1, ymax: 4 };
    const map = screen(view);
    const g = { x: 3, y: 2 };
    const d = drive(prob(m, 'point', [0, 1], { points: [g] }, map, TRANSLATE, g, 'move'), g, { x: 3.37, y: 1.52 });
    near(d.exact[0], 3.37, 1e-6);
    near(d.exact[1], 1.52, 1e-6);
    assert.equal(m.v[0], 3.37);
    assert.equal(m.v[1], 1.5);
});

test('vertex and leg: one vertex follows; a leg Move moves every tuple; a leg turn keeps the far vertex', () => {
    const build = () => mk([lit(0, 1, 0, 'offset'), lit(1, 4, 0, 'offset'), lit(2, 9, 3, 'offset'), lit(3, 12, 2, 'offset')], (v) => [() => v[0], () => v[1], () => v[2], () => v[3]]);
    const view: View = { xmin: -1, xmax: 5, ymin: -1, ymax: 3.8 };
    const map = screen(view);
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 2 }];

    const vtx = mk([lit(2, 9, 3, 'offset'), lit(3, 12, 2, 'offset')], (v) => [() => v[0], () => v[1]]);
    drive(prob(vtx, 'vertex', [0, 1], { points: [pts[1]] }, map, TRANSLATE, pts[1], 'move'), pts[1], { x: 3.5, y: 1.5 });
    assert.equal(vtx.v[0], 3.5);
    assert.equal(vtx.v[1], 1.5);

    const m = build();
    const g = { x: 1.5, y: 1 };
    const d = drive(prob(m, 'path', [0, 1, 2, 3], { points: pts }, map, TRANSLATE, g, 'move'), g, { x: 2, y: 1.5 });
    assert.equal(d.plan.active.length, 4);
    assert.deepEqual(Array.from(m.v), [0.5, 0.5, 3.5, 2.5]);

    const n = build();
    const P = pts[1];
    const g2 = { x: 0, y: 0 };
    const t = drive(prob(n, 'path', [0, 1, 2, 3], { points: pts }, map, sim(P, g2, map, false), g2, 'pivot'), g2, { x: 1, y: -0.5 });
    assert.deepEqual(activeIds(n, t.plan), ['l:0@1', 'l:1@4']);
    assert.equal(n.v[0], 1);
    assert.equal(n.v[1], -0.5);
    assert.equal(n.v[2], 3);
    assert.equal(n.v[3], 2);
});

test('label: P1_x moves right 0.4 through an add; the numeric y stays', () => {
    const m = mk([add(0, 4), lit(1, 0, 2, 'offset'), add(1, 1)], (v) => [() => 3 + v[0], () => v[1] + v[2]]);
    const view: View = { xmin: -1, xmax: 5, ymin: -1, ymax: 3.8 };
    const map = screen(view);
    const g = { x: 3, y: 2 };
    drive(prob(m, 'label', [0, 1], { points: [g] }, map, TRANSLATE, g, 'move'), g, { x: 3.4, y: 2 });
    near(m.v[0], 0.4, 1e-12);
    assert.equal(m.v[1], 2);
    assert.equal(m.v[2], 0);
});

test('tangent slide: the point x follows the pointer x; the slider clamps at its maximum', () => {
    const m = mk([sld('a', 1, 'offset', 0, -2, 2, 0.1)], (v) => [() => v[0]]);
    const view: View = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
    const map = screen(view);
    const f = (x: number) => x * x * x - 3 * x;
    const g = { x: 1, y: -2 };
    const p = prob(m, 'tangent', [0], { points: [g], f }, map, { kind: 'slide' }, g, 'move');
    const d = drive(p, g, { x: 1.5, y: 0 });
    assert.equal(m.v[0], 1.5);
    assert.equal(d.plan.restricted, 'none');
    const b = drive(p, g, { x: 2.6, y: 0 }, { plan: d.plan });
    assert.equal(m.v[0], 2);
    assert.deepEqual(b.solved.clamped, [{ number: 0, at: 'max' }]);
    near(p.shape.samples()[0].x, 1, 1e-12);
});

// ============================================================== quantization

test('quantization: the start-value magnet restores 0.123456x + 1.98765 byte for byte', () => {
    const m = mk([lit(0, 0, 0.123456, 'coef'), lit(0, 10, 1.98765, 'offset'), add(0, 17), shiftV(0, 0, 8), scaleV(0, 0, 8)], (v, I) => {
        const [a, b, k, h, s] = [I('l:0@0'), I('l:0@10'), I('v:0:add'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => v[a] * (v[s] * (x - v[h])) + v[b] + v[k]];
    });
    const g = { x: 1, y: 0.123456 + 1.98765 };
    const p = prob(m, 'graph', [0], { lines: [lineRun(-0.123456, 1, 1.98765, VS1)] }, S1, TRANSLATE, g, 'move');
    const plan = planDrag(p);
    const away = drive(p, g, [{ x: 1.2, y: 2.5 }, { x: 1.5, y: 3 }], { plan });
    assert.equal(away.values[1], 2.8, 'changed on the way');
    // The same plan continues: away, back near the start (1 px off) and onto it.
    const back = drive(p, g, [{ x: 1.5, y: 3 }, { x: 1.2, y: 2.4 }, { x: 1.05, y: g.y + 1 / 48 }], { plan });
    assert.equal(back.values[1], 1.98765, '1 px away the typed value wins');
    drive(p, g, [{ x: 1.2, y: 2.4 }, g], { plan });
    assert.equal(m.val('l:0@0'), 0.123456);
    assert.equal(m.val('l:0@10'), 1.98765);
});

test('quantization: rounder values within 2 px; Alt keeps the plain step', () => {
    const run = (snap: boolean) => {
        const m = lin2x1();
        const p = prob(m, 'graph', [0], { lines: [lineRun(-2, 1, 1, VS1)] }, S1, TRANSLATE, { x: 1, y: 3 }, 'move');
        const d = drive(p, { x: 1, y: 3 }, { x: 1, y: 2.8123 }, { snap });
        return { m, d };
    };
    const a = run(true);
    // Offset 0.8123: step 0.01 (48 px per unit); 0.8 is 0.6 px away, 1 would be 9 px away.
    assert.equal(a.m.val('l:0@5'), 0.8);
    near(a.d.steps[a.m.I('l:0@5')], 0.01, 1e-15);
    const b = run(false);
    assert.equal(b.m.val('l:0@5'), 0.81);
});

test('quantization: Alt keeps the magnet only within half a step', () => {
    const m = lin2x1();
    const p = prob(m, 'graph', [0], { lines: [lineRun(-2, 1, 1, VS1)] }, S1, TRANSLATE, { x: 1, y: 3 }, 'move');
    // 1.5 px away from the start: the magnet holds with snapping, not with Alt.
    drive(p, { x: 1, y: 3 }, { x: 1, y: 3 + 1.5 / 48 }, { snap: true });
    assert.equal(m.val('l:0@5'), 1);
    const fresh = () => {
        const n = lin2x1();
        return { n, q: prob(n, 'graph', [0], { lines: [lineRun(-2, 1, 1, VS1)] }, S1, TRANSLATE, { x: 1, y: 3 }, 'move') };
    };
    const a = fresh();
    drive(a.q, { x: 1, y: 3 }, { x: 1, y: 3 + 1.5 / 48 }, { snap: false });
    assert.equal(a.n.val('l:0@5'), 1.03);
    const b = fresh();
    drive(b.q, { x: 1, y: 3 }, { x: 1, y: 3 + 0.2 / 48 }, { snap: false });
    assert.equal(b.n.val('l:0@5'), 1, 'within half a step the start value wins');
});

test('quantization: sliders stay on min + k * step, also with an odd origin', () => {
    const m = mk([sld('c', 9, 'offset', 10, 0.05, 15, 0.1), lit(0, 0, 2, 'coef'), lit(0, 5, 3, 'coef')], (v) => [(x, y) => v[1] * x + v[2] * y - v[0]]);
    const p = prob(m, 'curve', [0], { lines: [lineRun(2, 3, 9, VLP)] }, LP, TRANSLATE, { x: 3, y: 1 }, 'move');
    drive(p, { x: 3, y: 1 }, { x: 3.3, y: 1.2 });
    const c = m.v[0];
    const k = (c - 0.05) / 0.1;
    near(k, Math.round(k), 1e-9, `on the grid: ${c}`);
    assert.equal(c, parseFloat(c.toFixed(2)));
    assert.equal(m.v[1], 2);
    assert.equal(m.v[2], 3);
});

test('quantization: steps of non-active numbers write their value exactly', () => {
    const m = lin2x1();
    const p = prob(m, 'graph', [0], { lines: [lineRun(-2, 1, 1, VS1)] }, S1, TRANSLATE, { x: 1, y: 3 }, 'move');
    const d = drive(p, { x: 1, y: 3 }, { x: 1, y: 3.5 });
    near(d.steps[m.I('l:0@0')], 1, 0, 'the 2 needs no decimals');
    const n = mk([lit(0, 0, 0.125, 'coef'), lit(0, 5, 1, 'offset')], (v) => [(x) => v[0] * x + v[1]]);
    const d2 = drive(prob(n, 'graph', [0], { lines: [lineRun(-0.125, 1, 1, VS1)] }, S1, TRANSLATE, { x: 1, y: 1.125 }, 'move'), { x: 1, y: 1.125 }, { x: 1, y: 2 });
    near(d2.steps[0], 0.001, 1e-18);
});

// ===================================================================== bounds

test('bounds: c clamps at its maximum 15 and reports it; the object stops', () => {
    const m = objective();
    const p = prob(m, 'curve', [0], { lines: [lineRun(2, 3, 9, VLP)] }, LP, TRANSLATE, { x: 3, y: 1 }, 'move');
    const d = drive(p, { x: 3, y: 1 }, { x: 5, y: 4 });
    assert.equal(m.val('s:c'), 15);
    assert.ok(d.solved.ok);
    assert.deepEqual(d.solved.clamped, [{ number: m.I('s:c'), at: 'max' }]);
    assert.equal(m.val('l:0@0'), 2);
    assert.equal(m.val('l:0@5'), 3);
    // Going back below the maximum frees it again.
    const back = drive(p, { x: 5, y: 4 }, { x: 3.3, y: 1 }, { plan: d.plan });
    assert.deepEqual(back.solved.clamped, []);
    assert.ok(m.val('s:c') < 15);
});

test('bounds: a slider at its minimum reports min', () => {
    const m = objective();
    const p = prob(m, 'curve', [0], { lines: [lineRun(2, 3, 9, VLP)] }, LP, TRANSLATE, { x: 3, y: 1 }, 'move');
    const d = drive(p, { x: 3, y: 1 }, { x: -0.4, y: -0.4 }, { steps: 20 });
    assert.equal(m.val('s:c'), 0);
    assert.deepEqual(d.solved.clamped, [{ number: m.I('s:c'), at: 'min' }]);
});

// ================================================================== rejection

test('rejection: |theta| > 1e6 keeps the warm state', () => {
    const m = mk([lit(0, 1, 1, 'offset')], (v) => [() => 1e-7 * v[0], () => 2]);
    const view: View = { xmin: -1, xmax: 5, ymin: -1, ymax: 3.8 };
    const map = screen(view);
    const g = { x: 1e-7, y: 2 };
    const p = prob(m, 'point', [0, 1], { points: [g] }, map, TRANSLATE, g, 'move');
    const plan = planDrag(p);
    assert.deepEqual(plan.active, [0]);
    const bounds = boundsFor(m.numbers);
    const warm = new Float64Array(plan.active.length + plan.basis.length);
    const s = solveDrag(p, plan, toPx({ x: 1, y: 2 }, map), toPx(g, map), warm, bounds);
    assert.equal(s.ok, false);
    assert.equal(s.failure, 'range');
    assert.equal(s.values[0], 1);
    assert.deepEqual(Array.from(s.warm), Array.from(warm));
    assert.equal(m.v[0], 1, 'ev.values hold the previous frame');
    const q = quantizeDrag(p, plan, s, bounds, { snap: true });
    assert.equal(q.values[0], 1);
});

test('rejection: a non-finite cursor keeps the warm state', () => {
    const m = lin2x1();
    const p = prob(m, 'graph', [0], { lines: [lineRun(-2, 1, 1, VS1)] }, S1, TRANSLATE, { x: 1, y: 3 }, 'move');
    const plan = planDrag(p);
    const bounds = boundsFor(m.numbers);
    const first = solveDrag(p, plan, toPx({ x: 1, y: 3.5 }, S1), null, null, bounds);
    assert.ok(first.ok);
    const s = solveDrag(p, plan, { x: NaN, y: 10 }, toPx({ x: 1, y: 3.5 }, S1), first.warm, bounds);
    assert.equal(s.ok, false);
    assert.equal(s.failure, 'nonfinite');
    assert.deepEqual(Array.from(s.values), Array.from(first.values));
    assert.deepEqual(Array.from(s.warm), Array.from(first.warm));
});

test('a function that turns NaN beyond a value stops short instead of jumping', () => {
    // y = x + sqrt(c) - 1, c = 1 -> moving down needs c < 0: the curve stops at c = 0.
    const m = mk([lit(0, 0, 1, 'offset')], (v) => [(x) => x + Math.sqrt(v[0]) - 1]);
    const p = prob(m, 'graph', [0], { lines: [lineRun(-1, 1, 0, VS1)] }, S1, TRANSLATE, { x: 1, y: 1 }, 'move');
    const d = drive(p, { x: 1, y: 1 }, { x: 1, y: -1 });
    for (const v of d.values) assert.ok(Number.isFinite(v));
    assert.ok(m.v[0] >= 0 && m.v[0] < 0.05, `stopped near 0: ${m.v[0]}`);
    // The line can slide along itself, so the lag is the normal distance (about 34 px here).
    assert.ok(d.solved.lagPx > 25, `the pointer is ahead of the object: ${d.solved.lagPx}`);
});

test('orientation guard: a flipped clause is rejected (failure flip)', () => {
    const m = mk([factor(0, 0), lit(0, 4, 3, 'coef'), lit(0, 10, 6, 'offset')], (v) => [(x, y) => v[0] * x + v[1] * y - v[2]]);
    const g = { x: 0, y: 2 };
    const p = prob(m, 'clause', [0], { lines: [lineRun(1, 3, 6, VLP)] }, LP, TRANSLATE, g, 'move');
    const ok = p.shape.orientationOk as (z: readonly [number, number]) => boolean;
    assert.equal(typeof ok, 'function');
    assert.equal(ok.call(p.shape, [0, 0]), true);
    m.v.set([-1, -3, -6]); // the same line, inside and outside swapped
    assert.equal(ok.call(p.shape, [0, 0]), false);
    m.v.set([1, 3, 6]);
    // Curve and graph shapes have no guard.
    assert.equal(prob(lin2x1(), 'graph', [0], { lines: [lineRun(-2, 1, 1, VS1)] }, S1, TRANSLATE, { x: 1, y: 3 }, 'move').shape.orientationOk, undefined);
    // A warm start at the flipped numbers is already a solution of the rows: the guard rejects it.
    const plan: DragPlan = { ...planDrag(p), active: [0, 1, 2] };
    const warm = new Float64Array(3 + plan.basis.length);
    for (let k = 0; k < 3; k++) warm[k] = (-2 * plan.theta0[k]) / plan.sigma[k];
    const s = solveDrag(p, plan, toPx(g, LP), null, warm, boundsFor(m.numbers));
    assert.equal(s.ok, false);
    assert.equal(s.failure, 'flip');
    assert.deepEqual(Array.from(s.warm), Array.from(warm), 'the warm state is kept');
    // From the start state the same problem solves fine.
    const s2 = solveDrag(p, plan, toPx({ x: 0.3, y: 2 }, LP), null, null, boundsFor(m.numbers));
    assert.equal(s2.ok, true);
});

// ============================================================= continuation

test('continuation: 3sin(2(x - 1)) + 1 stretched 2x horizontally in one event reaches <= 0.25 px', () => {
    const m = mk([lit(0, 0, 3, 'coef'), lit(0, 5, 2, 'coef'), lit(0, 11, 1, 'shift'), lit(0, 17, 1, 'offset'), add(0, 18), shiftV(0, 0, 7), scaleV(0, 0, 7)], (v, I) => {
        const [a, b, c, d, k, h, s] = [I('l:0@0'), I('l:0@5'), I('l:0@11'), I('l:0@17'), I('v:0:add'), I('v:0:shift:0'), I('v:0:scale:0')];
        return [(x) => v[a] * Math.sin(v[b] * (v[s] * (x - v[h]) - v[c])) + v[d] + v[k]];
    });
    const view: View = { xmin: -1, xmax: 7, ymin: -3, ymax: 5 };
    const map = screen(view);
    const P = { x: 1, y: 1 };
    const g = { x: 1 + PI / 4, y: 4 };
    const p = prob(m, 'graph', [0], { lines: [graphRun((x) => 3 * Math.sin(2 * (x - 1)) + 1, view)] }, map, stretch(P, g, map), g, 'pivot');
    const plan = planDrag(p);
    assert.deepEqual(activeIds(m, plan), ['l:0@0', 'l:0@5']);
    const bounds = boundsFor(m.numbers);
    const target = toPx({ x: 1 + PI / 2, y: 4 }, map);
    const warm = new Float64Array(plan.active.length + plan.basis.length);
    const s = solveDrag(p, plan, target, toPx(g, map), warm, bounds);
    assert.ok(s.ok);
    assert.ok(s.maxPx <= 0.25, `maxPx ${s.maxPx}`);
    near(m.val('l:0@5'), 1, 1e-3, 'frequency 2 -> 1');
    near(m.val('l:0@0'), 3, 1e-3);
    const q = quantizeDrag(p, plan, s, bounds, { snap: true });
    assert.equal(q.values[m.I('l:0@5')], 1);
    assert.equal(q.values[m.I('l:0@0')], 3);
});

test('continuation: a jump the direct solve cannot follow is walked in substeps', () => {
    const build = () =>
        mk([lit(0, 0, 3, 'coef'), lit(0, 5, 2, 'coef'), lit(0, 11, 1, 'shift'), lit(0, 17, 1, 'offset'), add(0, 18), shiftV(0, 0, 7), scaleV(0, 0, 7)], (v, I) => {
            const [a, b, c, d, k, h, s] = [I('l:0@0'), I('l:0@5'), I('l:0@11'), I('l:0@17'), I('v:0:add'), I('v:0:shift:0'), I('v:0:scale:0')];
            return [(x) => v[a] * Math.sin(v[b] * (v[s] * (x - v[h]) - v[c])) + v[d] + v[k]];
        });
    const view: View = { xmin: -1, xmax: 7, ymin: -3, ymax: 5 };
    const map = screen(view);
    const lines = [graphRun((x) => 3 * Math.sin(2 * (x - 1)) + 1, view)];
    const P = toPx({ x: 1, y: 1 }, map);
    const g = { x: 1 + PI / 4, y: 4 };
    const gp = toPx(g, map);
    // Compress to 0.34 of the width in one event: the frequency must go from 2 to about 5.9.
    const target = { x: P.x + 0.34 * (gp.x - P.x), y: gp.y };
    const solve = (prev: Pt | null) => {
        const m = build();
        const p = prob(m, 'graph', [0], { lines }, map, stretch(fromPx(P, map), g, map), g, 'pivot');
        const plan = planDrag(p);
        const s = solveDrag(p, plan, target, prev, new Float64Array(plan.active.length + plan.basis.length), boundsFor(m.numbers));
        return { m, s };
    };
    const direct = solve(null);
    assert.ok(direct.s.maxPx > 0.25, `the direct solve stalls: ${direct.s.maxPx}`);
    const walked = solve(gp);
    assert.ok(walked.s.ok);
    assert.ok(walked.s.maxPx <= 0.25, `continuation: ${walked.s.maxPx}`);
    near(walked.m.val('l:0@5'), 2 / 0.34, 1e-3);
});

// ======================================================================= re-base

test('re-base: resample + setFamily + a new plan continue without a jump', () => {
    const m = clause36();
    const G = m.ev.fns[0];
    const g = { x: 3, y: 1 };
    const p = prob(m, 'clause', [0], { lines: [lineRun(1, 3, 6, VLP)] }, LP, TRANSLATE, g, 'move');
    const cur = { x: 3.6, y: 1 };
    const d = drive(p, g, cur);
    assert.equal(m.val('l:0@10'), 6.6);
    // Shift pressed: samples onto the current shape, the pivot family, a plan from the current numbers.
    p.shape.resample(d.solved.z);
    for (const s of p.shape.samples()) assert.ok(distImplicit(G, s, LP) < 1e-6);
    const P = { x: 3.6, y: 1 };
    const g2 = { x: 0.6, y: 2 };
    const fam = sim(P, g2, LP);
    if (p.shape.setFamily) p.shape.setFamily(fam);
    const p2: DragProblem = { ...p, family: fam, grab: toPx(g2, LP), gesture: 'pivot' };
    const plan2 = planDrag(p2);
    near(plan2.theta0[m.I('l:0@10')], 6.6, 1e-12);
    const s = solveDrag(p2, plan2, toPx(g2, LP), null, null, boundsFor(m.numbers));
    const q = quantizeDrag(p2, plan2, s, boundsFor(m.numbers), { snap: true });
    assert.equal(q.values[m.I('l:0@10')], 6.6, 'first frame after the re-base equals the last before');
    assert.equal(q.values[m.I('l:0@4')], 3);
});

// ====================================================================== shapes

test('samples: clipped to the view inset 2 %, N = clamp(round(length / 12), 12, 48)', () => {
    const map = LP;
    const s = sampleLines([lineRun(1, 0, 2, VLP)], map); // vertical line, 480 px tall
    assert.equal(s.length, Math.min(48, Math.max(12, Math.round((480 * 0.96) / 12))));
    for (const p of s) assert.ok(p.y >= VLP.ymin + 0.02 * 4.8 - 1e-9 && p.y <= VLP.ymax - 0.02 * 4.8 + 1e-9);
    const short = sampleLines([[{ x: 1, y: 1 }, { x: 1.2, y: 1 }]], map); // 20 px
    assert.equal(short.length, 12);
    // A line on the view edge falls back to the whole view.
    const edge = sampleLines([[{ x: VLP.xmin, y: 0 }, { x: VLP.xmin, y: 4 }]], map);
    assert.ok(edge.length >= 12);
});

test('applyFamily: translate, similar (turn + scale) and stretch in the px frame', () => {
    const q = { x: 10, y: 0 };
    assert.deepEqual(applyFamily({ kind: 'translate' }, [3, 4], q), { x: 13, y: 4 });
    const t = applyFamily({ kind: 'similar', pivot: { x: 0, y: 0 }, unit: 10, turnOnly: true }, [0, 10], q);
    near(t.x, 10, 1e-12);
    near(t.y, 10, 1e-12);
    const s = applyFamily({ kind: 'stretch', pivot: { x: 2, y: 2 }, ux: 8, uy: 24 }, [8, 0], q);
    near(s.x, 18, 1e-12);
    near(s.y, 0, 1e-12);
    assert.deepEqual(applyFamily({ kind: 'push' }, [5, 5], q), q);
});

test('rows: non-finite start rows are dropped; too few finite rows lock the gesture', () => {
    // y = sqrt(x - 3): the drawn run starts at x = 3, samples left of it are not finite.
    const m = mk([lit(0, 4, 3, 'shift'), add(0, 6)], (v) => [(x) => Math.sqrt(x - v[0]) + v[1]]);
    const lines = [graphRun((x) => Math.sqrt(x - 3), VS1)];
    const p = prob(m, 'graph', [0], { lines }, S1, TRANSLATE, { x: 4, y: 1 }, 'move');
    const plan = planDrag(p);
    assert.equal(plan.rowsLocked, false);
    // A shape with 1 row and a family: too few rows.
    const one = mk([lit(0, 0, 1, 'offset')], (v) => [() => v[0]]);
    const ps = prob(one, 'point', [0, -1], { points: [{ x: 1, y: 1 }] }, S1, TRANSLATE, { x: 1, y: 1 }, 'move');
    assert.equal(planDrag(ps).rowsLocked, false, 'a point has 2 + 2 rows');
    const nan = mk([lit(0, 0, 1, 'offset')], (v) => [(x) => (x > 100 ? x : NaN) + v[0]]);
    const pn = prob(nan, 'graph', [0], { lines: [lineRun(-1, 1, 1, VS1)] }, S1, TRANSLATE, { x: 0, y: 1 }, 'move');
    const pl = planDrag(pn);
    assert.equal(pl.rowsLocked, true);
    assert.ok(Array.from(pl.base).every((b) => Number.isNaN(b)));
});

// ================================================================= performance

test('performance: planDrag and per-event solve + quantize within 3x the budget (SPEC3 2.8)', () => {
    // Graph: sin(x) stretched (48 samples) and 2x + 1 turned.
    const lines = [graphRun(Math.sin, VSIN)];
    const g = { x: PI / 2, y: 1 };
    const timePlan = (mkP: () => DragProblem): number => {
        const p = mkP();
        planDrag(p);
        let best = Infinity;
        for (let k = 0; k < 5; k++) {
            const t0 = performance.now();
            planDrag(p);
            best = Math.min(best, performance.now() - t0);
        }
        return best;
    };
    const graphMs = timePlan(() => prob(sine(), 'graph', [0], { lines }, SSIN, stretch({ x: 0, y: 0 }, g, SSIN), g, 'pivot'));
    assert.ok(graphMs < 9, `planDrag graph ${graphMs.toFixed(2)} ms`);
    // Implicit, 48 samples: a large circle clause.
    const circ = () =>
        mk(
            [lit(0, 5, 3, 'shift'), lit(0, 17, 2, 'shift'), lit(0, 25, 2, 'coef'), add(0, 28), factor(0, 0), factor(0, 12), shiftV(0, 0, 1), shiftV(0, 1, 13), scaleV(0, 0, 1), scaleV(0, 1, 13)],
            (v) => [
                (x, y) => {
                    const X = v[8] * (x - v[6]) - v[0];
                    const Y = v[9] * (y - v[7]) - v[1];
                    return v[4] * X * X + v[5] * Y * Y - (v[2] * v[2] + v[3]);
                },
            ]
        );
    const view: View = { xmin: -1, xmax: 7, ymin: -1, ymax: 5.4 };
    const map = screen(view);
    const cg = { x: 5, y: 2 };
    const mkCirc = () => prob(circ(), 'clause', [0], { lines: [circleRun(3, 2, 2)] }, map, sim({ x: 3, y: 2 }, cg, map, false), cg, 'pivot');
    assert.equal(mkCirc().shape.rows, 48);
    const implicitMs = timePlan(mkCirc);
    assert.ok(implicitMs < 15, `planDrag implicit ${implicitMs.toFixed(2)} ms`);

    // Per event: a 40-step stretch of sin and a 40-step circle Move, after a warm-up drag.
    const perEvent = (mkP: () => DragProblem, from: Pt, to: Pt): number => {
        drive(mkP(), from, to, { steps: 40 });
        const d = drive(mkP(), from, to, { steps: 40 });
        const t = d.times.slice().sort((a, b) => a - b);
        return t[Math.floor(0.95 * (t.length - 1))];
    };
    const graphEv = perEvent(() => prob(sine(), 'graph', [0], { lines }, SSIN, stretch({ x: 0, y: 0 }, g, SSIN), g, 'pivot'), g, { x: 2, y: 1.8 });
    assert.ok(graphEv < 9, `graph solve + quantize p95 ${graphEv.toFixed(2)} ms`);
    const circEv = perEvent(() => prob(circ(), 'clause', [0], { lines: [circleRun(3, 2, 2)] }, map, TRANSLATE, cg, 'move'), cg, { x: 5.6, y: 2.7 });
    assert.ok(circEv < 15, `implicit solve + quantize p95 ${circEv.toFixed(2)} ms`);
    const lineEv = perEvent(() => prob(objective(), 'curve', [0], { lines: [lineRun(2, 3, 9, VLP)] }, LP, sim({ x: 3, y: 1 }, { x: 0, y: 3 }, LP), { x: 0, y: 3 }, 'pivot'), { x: 0, y: 3 }, { x: 0, y: 3.8 });
    assert.ok(lineEv < 9, `line solve + quantize p95 ${lineEv.toFixed(2)} ms`);
});
