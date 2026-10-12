/* eslint-disable @typescript-eslint/no-non-null-assertion */
/*
 * Regression tests for the drag acceptance findings (SPEC3 6.4): slider grids, dragging back restores the
 * text byte for byte (cold start, snaps at the grab, the start-direction detent, dead stretch axes, relative
 * tangent slides), re-base without jumps, redundant numbers, pivot dead zones, step functions that say
 * "cannot follow further", resizes of closed curves, unreachable turn detents, keyboard nudge steps, clamped
 * turns that keep their pivot, delegated clause pivots and hover ghosts that match the written structure.
 */
import { test, assert } from './_lib';
import { EXAMPLES } from '../src/migrate';
import { DragSession, nudge, prepareDrag, preparedServes } from '../src/drag/session';
import type { PreparedDrag } from '../src/drag/session';
import { resolveTarget } from '../src/drag/targets';
import type { DragContext, DragFrame, DragTarget, Gesture, Pt } from '../src/drag/types';
import { chartJson, curveTool, editText, hitByKey, implicitDistPx, makeChart, paramValue, pointsTool, regionTool } from './_drag';

const F1 = { kind: 'function' as const, name: 'f1', field: 'expression' as const };

function example(id: string) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) throw new Error(`no example ${id}`);
    return makeChart(JSON.parse(JSON.stringify(ex.data)) as Record<string, unknown>);
}

function prepared(ctx: DragContext, t: DragTarget, grab: Pt, gesture: Gesture, pivot?: Pt): PreparedDrag {
    const p = prepareDrag(t, grab, gesture, ctx, pivot ? { pivot } : undefined);
    if ('lock' in p) throw new Error(`locked: ${p.lock.title}`);
    return p;
}

/** Straight path a -> b in n events (b included). */
function line(a: Pt, b: Pt, n = 12): Pt[] {
    return Array.from({ length: n }, (_, k) => ({ x: a.x + ((b.x - a.x) * (k + 1)) / n, y: a.y + ((b.y - a.y) * (k + 1)) / n }));
}

/** Out to b and back to a along the same path, ending exactly at a. */
function outBack(a: Pt, b: Pt, n = 12): Pt[] {
    const out = line(a, b, n);
    return out.concat(out.slice(0, -1).reverse()).concat([a]);
}

interface Run {
    frames: DragFrame[];
    commit: ReturnType<DragSession['commit']>;
    prep: PreparedDrag;
}

function run(ctx: DragContext, key: string, grab: Pt, gesture: Gesture, path: Pt[], pivot?: Pt, shift?: boolean[]): Run {
    const t = resolveTarget({ ...hitByKey(ctx, key, grab), at: grab }, ctx);
    const prep = prepared(ctx, t, grab, gesture, pivot);
    const s = DragSession.start(prep, { shift: gesture === 'pivot', alt: false }, ctx);
    const frames = path.map((p, k) => s.update(p, { shift: shift ? shift[k] : gesture === 'pivot', alt: false }));
    return { frames, commit: s.commit(), prep };
}

const text = (f: DragFrame) => f.edits.map((e) => e.text).join(' | ');
const titleText = (p: PreparedDrag) => p.chip.title.map((x) => x.text).join('');

// ------------------------------------------------------------------ sliders

test('slider values stay on their grid (step 0.25, step 2.5)', () => {
    for (const [step, max, to] of [
        [0.25, 3, 2.3],
        [2.5, 20, 7.4],
    ]) {
        const view: [number, number, number, number] = step === 0.25 ? [-5, 5, -5, 5] : [-30, 30, -30, 30];
        const chart = makeChart(chartJson({ view, functions: [{ expression: 'x + c' }], parameters: [{ name: 'c', value: 0, min: 0, max, step }] }));
        const r = run(chart.ctx, 'fn:f1#curve', { x: 0, y: 0 }, 'move', line({ x: 0, y: 0 }, { x: 0, y: to }));
        for (const f of r.frames) {
            const c = paramValue(f, 'c')!;
            assert.ok(Math.abs(c / step - Math.round(c / step)) < 1e-9, `c = ${c} is off the ${step} grid`);
        }
        assert.ok(paramValue(r.frames[r.frames.length - 1], 'c')! > 0);
    }
});

// --------------------------------------------------------- drag back restores

test('dragging back restores the text: divisor turned flat, a squared base moved through 0, a turn past vertical', () => {
    const view: [number, number, number, number] = [-5, 5, -5, 5];
    const a = makeChart(chartJson({ view, functions: [{ expression: 'x/2 + 1' }] }));
    const r = run(a.ctx, 'fn:f1#curve', { x: 4, y: 3 }, 'pivot', outBack({ x: 4, y: 3 }, { x: 4, y: -1 }), { x: 0, y: 1 });
    assert.equal(r.commit, null, text(r.frames[r.frames.length - 1]));
    const b = makeChart(chartJson({ view, functions: [{ expression: '0.5^2 + x' }] }));
    const r2 = run(b.ctx, 'fn:f1#curve', { x: 1, y: 1.25 }, 'move', outBack({ x: 1, y: 1.25 }, { x: 1, y: -0.5 }, 8));
    assert.equal(r2.commit, null, text(r2.frames[r2.frames.length - 1]));
    const c = makeChart(chartJson({ view, functions: [{ expression: '2x + 1' }] }));
    const r3 = run(c.ctx, 'fn:f1#curve', { x: 2, y: 5 }, 'pivot', [{ x: 0.2, y: 5 }, { x: 0, y: 5 }, { x: -0.2, y: 5 }, { x: -0.5, y: 5 }], { x: 0, y: 1 });
    assert.notEqual(editText(r3.frames[3], F1), '2x + 1', 'a turn past vertical never snaps back to the start text');
});

test('back at the grab nothing snaps: line through a marker, graph anchor on the grid', () => {
    const view: [number, number, number, number] = [-5, 5, -5, 5];
    const a = makeChart(chartJson({ view, functions: [{ expression: '0.5x - 0.8' }], tools: [pointsTool('t0', 'P1', { points: '(2, 0.4)' })] }));
    const g = { x: -2, y: -1.8 };
    const px = 1 / a.ctx.map.ky;
    const r = run(a.ctx, 'fn:f1#curve', g, 'move', [{ x: g.x, y: g.y + 2 * px }, { x: g.x, y: g.y + px }, g]);
    assert.equal(r.frames[0].chip.detail, 'through P1', 'the snap still works off the grab');
    assert.equal(editText(r.frames[2], F1), '0.5x - 0.8');
    assert.equal(r.commit, null);
    const b = makeChart(chartJson({ view, functions: [{ expression: 'x sin(x)' }] }));
    const gb = { x: 2, y: 2 * Math.sin(2) };
    const r2 = run(b.ctx, 'fn:f1#curve', gb, 'move', [{ x: 2.025, y: 1.884 }, { x: 2.05, y: 1.949 }, { x: 2.025, y: 1.884 }, gb]);
    assert.equal(r2.commit, null, text(r2.frames[r2.frames.length - 1]));
});

test('the start direction wins inside its detent window (3.1x never becomes 3x on the press)', () => {
    const chart = makeChart(chartJson({ view: [-5, 5, -5, 5], functions: [{ expression: '3.1x + 1' }] }));
    const r = run(chart.ctx, 'fn:f1#curve', { x: 1, y: 4.1 }, 'pivot', outBack({ x: 1, y: 4.1 }, { x: 1, y: 2.5 }, 8), { x: 0, y: 1 });
    assert.notEqual(editText(r.frames[0], F1), '3x + 1');
    assert.equal(r.commit, null, text(r.frames[r.frames.length - 1]));
});

test('tangent slides relative to the grab: grabbed on the line, 3 px moves a by about 3 px; back restores', () => {
    const tan = example('tangent');
    const ctx = tan.ctx;
    const a = 0.5;
    const slope = 3 * a * a - 3;
    const y0 = a ** 3 - 3 * a;
    for (const gx of [-0.5, 1.4]) {
        const grab = { x: gx, y: y0 + slope * (gx - a) };
        const t = resolveTarget({ ...hitByKey(ctx, '0#tangent', grab), at: grab }, ctx);
        const s = DragSession.start(prepared(ctx, t, grab, 'move'), { shift: false, alt: false }, ctx);
        const f1 = s.update({ x: grab.x + 3 / ctx.map.kx, y: grab.y }, { shift: false, alt: false });
        const av = paramValue(f1, 'a')!;
        const step = ctx.parameters.find((p) => p.name === 'a')!.step;
        assert.ok(Math.abs(av - 0.5) <= 3 / ctx.map.kx + step + 1e-9, `grab x ${gx}: a = ${av}`);
        s.update(grab, { shift: false, alt: false });
        assert.equal(s.commit(), null, `grab x ${gx}`);
    }
});

test('dead stretch axes are pinned: Shift-drags from the midline out and back restore the text', () => {
    const tan = example('tangent');
    const g = { x: 0, y: 0 };
    const px = (dx: number, dy: number): Pt => ({ x: g.x + dx / tan.ctx.map.kx, y: g.y + dy / tan.ctx.map.ky });
    const r = run(tan.ctx, 'fn:f1#curve', g, 'pivot', outBack(g, px(40, -25), 10));
    assert.equal(r.commit, null, text(r.frames[r.frames.length - 1]));
    const areas = example('areas');
    const ga = { x: Math.PI, y: 0 };
    const pa = (dx: number, dy: number): Pt => ({ x: ga.x + dx / areas.ctx.map.kx, y: ga.y + dy / areas.ctx.map.ky });
    const r2 = run(areas.ctx, 'fn:f1#curve', ga, 'pivot', outBack(ga, pa(40, 25), 10), { x: 0, y: 0 });
    assert.equal(r2.commit, null, text(r2.frames[r2.frames.length - 1]));
});

// --------------------------------------------------------------- re-base

test('re-base keeps the cursor offset: Shift released after a straight move does not jump', () => {
    const chart = makeChart(chartJson({ view: [-5, 5, -5, 5], tools: [pointsTool('t0', 'P1', { points: '(1, 1); (3, 2)' })] }));
    const path = [{ x: 3.3, y: 2.2 }, { x: 3.3, y: 2.2 }, { x: 3.9, y: 2.3 }, { x: 3.9, y: 2.3 }];
    const r = run(chart.ctx, 't0#point:1', { x: 3, y: 2 }, 'move', path, undefined, [false, true, true, false]);
    assert.equal(text(r.frames[1]), text(r.frames[0]), 'Shift pressed: no jump');
    assert.equal(text(r.frames[3]), text(r.frames[2]), 'Shift released: no jump');
});

test('level push after a Shift reshape: the first push frame equals the last reshape frame', () => {
    const chart = makeChart(chartJson({ view: [-4, 4, -4, 4], equal: true, tools: [curveTool('t0', 'C1', 'x^2 + y^2', '1, 3.2, 6')] }), { equal: true });
    const ctx = chart.ctx;
    const r0 = Math.sqrt(3.2);
    const grab = { x: r0, y: 0 };
    const path = [{ x: r0 + 0.1, y: 0 }, { x: r0 + 0.3, y: 0.1 }, { x: r0 + 0.3, y: 0.1 }];
    const r = run(ctx, 't0#level:1', grab, 'move', path, undefined, [false, true, false]);
    const levels = (f: DragFrame) => editText(f, { kind: 'tool', id: 't0', field: 'levels' });
    const eq = (f: DragFrame) => editText(f, { kind: 'tool', id: 't0', field: 'equation' });
    assert.equal(levels(r.frames[2]), levels(r.frames[1]), `levels ${levels(r.frames[1])} -> ${levels(r.frames[2])}`);
    assert.equal(eq(r.frames[2]), eq(r.frames[1]));
});

// --------------------------------------------------------------- planning

test('no insertion while an existing number does the job: sin(1/(x + 3)) moves with its 3', () => {
    const chart = makeChart(chartJson({ view: [-5, 5, -5, 5], functions: [{ expression: 'sin(1/(x + 3))' }] }));
    const g = { x: 1, y: Math.sin(0.25) };
    const r = run(chart.ctx, 'fn:f1#curve', g, 'move', outBack(g, { x: 1.5, y: 0.5 }, 10));
    const core = (r.prep as unknown as { core: { plan: { active: number[] }; numbers: Array<{ id: string }> } }).core;
    const ids = core.plan.active.map((i) => core.numbers[i].id);
    assert.ok(!ids.some((id) => id.includes(':shift:')), ids.join(' '));
    assert.equal(r.commit, null, text(r.frames[r.frames.length - 1]));
});

test('the pivot is never inside the dead zone: a line grabbed near the origin, the surplus line beside the equilibrium', () => {
    const chart = makeChart(chartJson({ view: [-5, 5, -5, 5], functions: [{ expression: '1.5x' }] }));
    const g = { x: -0.12, y: -0.18 };
    const t = resolveTarget({ ...hitByKey(chart.ctx, 'fn:f1#curve', g), at: g }, chart.ctx);
    const p = prepared(chart.ctx, t, g, 'pivot');
    const at = p.info.pivot!.at;
    const d = Math.hypot((at.x - g.x) * chart.ctx.map.kx, (at.y - g.y) * chart.ctx.map.ky);
    assert.ok(d >= 40, `pivot ${JSON.stringify(at)} is ${d.toFixed(1)} px from the grab`);
    const surplus = example('surplus');
    const gs = { x: 4.05, y: 6.05 };
    const r = run(surplus.ctx, 'fn:f2#curve', gs, 'pivot', line(gs, { x: gs.x - 0.5, y: gs.y + 1.14 }, 10));
    const ps = r.prep.info.pivot!.at;
    assert.ok(Math.hypot((ps.x - gs.x) * surplus.ctx.map.kx, (ps.y - gs.y) * surplus.ctx.map.ky) >= 12, JSON.stringify(ps));
    assert.ok(!/000/.test(text(r.frames[r.frames.length - 1])), text(r.frames[r.frames.length - 1]));
});

test('step functions stop with "cannot follow further" instead of jumping away from the pointer', () => {
    const chart = makeChart(chartJson({ view: [-5, 5, -5, 5], functions: [{ expression: 'x < 1 ? 0 : 2' }] }));
    const r = run(chart.ctx, 'fn:f1#curve', { x: 3, y: 2 }, 'move', line({ x: 3, y: 2 }, { x: 2.4, y: 2.9 }));
    let prev = 2;
    for (const f of r.frames) {
        const m = /: (-?[\d.]+)$/.exec(editText(f, F1)!);
        const v = m ? Number(m[1]) : NaN;
        assert.ok(v >= prev - 1e-9, `the branch never drops while the pointer rises: ${prev} -> ${v}`);
        prev = v;
    }
    assert.ok(r.frames.some((f) => f.chip.detail === 'cannot follow further'));
    const floor = makeChart(chartJson({ view: [-3, 3, -3, 3], tools: [regionTool('t0', 'R1', ['y <= floor(x)'])] }));
    const shape = floor.ctx.hits.byKey('t0#clause:0:0:0')!;
    const g = shape.lines[0][Math.floor(shape.lines[0].length / 3)];
    const k = floor.ctx.map;
    const rf = run(floor.ctx, 't0#clause:0:0:0', g, 'move', line(g, { x: g.x + 25 / k.kx, y: g.y + 20 / k.ky }, 6));
    assert.ok(rf.frames.some((f) => f.chip.detail === 'cannot follow further'), rf.frames.map(text).join(' ; '));
});

// ---------------------------------------------------------------- resize

test('closed curves resize uniformly: an axis-aligned ellipse, and a circle under unequal axis scales', () => {
    const j = { v: 4, xmin: '-3', xmax: '3', ymin: '-2', ymax: '2', axis_style: 'box', equalScale: true, functions: [], tools: [curveTool('t0', 'C1', 'x^2/4 + y^2 = 1')], parameters: [], annotations: [] };
    const ell = makeChart(j, { equal: true });
    const r = run(ell.ctx, 't0#level:0', { x: 2, y: 0 }, 'pivot', line({ x: 2, y: 0 }, { x: 2.4, y: 0 }));
    assert.equal(r.prep.chip.detail, 'Shift-drag resizes around ⊕ (0, 0)');
    const eq = editText(r.frames[r.frames.length - 1], { kind: 'tool', id: 't0', field: 'equation' })!;
    assert.ok(/^x\^2\/4 \+ y\^2 = 1\.4\d*$/.test(eq), eq);
    const circle = makeChart(chartJson({ view: [-3, 4, -3, 4], tools: [regionTool('t0', 'R1', ['(x - 1)^2 + (y - 0.5)^2 <= 2^2'])] }));
    assert.notEqual(circle.ctx.map.kx.toFixed(3), circle.ctx.map.ky.toFixed(3));
    const t = resolveTarget(hitByKey(circle.ctx, 't0#clause:0:0:0', { x: 3, y: 0.5 }), circle.ctx);
    const p = prepared(circle.ctx, t, t.lines[0][0], 'pivot');
    assert.equal(p.info.shiftLock, null, p.chip.detail);
    assert.equal(p.chip.detail, 'Shift-drag resizes around ⊕ (1, 0.5)');
});

// ------------------------------------------------------------- turn detents

test('a detent the numbers cannot reach is skipped: R1 (2) turned flat never snaps back to the start', () => {
    const lp = example('lp');
    const ctx = lp.ctx;
    for (const [entry, near, endDeg, start] of [
        [1, { x: 1.5, y: 1.5 }, 180, 'x + 3y <= 6'],
        [0, { x: 1.5, y: 2.5 }, 90, 'x + y <= 4'],
    ] as Array<[number, Pt, number, string]>) {
        const hit = hitByKey(ctx, `t0#clause:${entry}:0:0`, near);
        const t = resolveTarget(hit, ctx);
        const s = DragSession.start(prepared(ctx, t, hit.at, 'pivot', { x: 3, y: 1 }), { shift: true, alt: false }, ctx);
        const P = { x: 3 * ctx.map.kx, y: ctx.map.ky };
        const g = { x: hit.at.x * ctx.map.kx, y: hit.at.y * ctx.map.ky };
        const rad = Math.hypot(g.x - P.x, g.y - P.y);
        const a0 = Math.atan2(g.y - P.y, g.x - P.x);
        const a1 = (endDeg * Math.PI) / 180;
        let left = false;
        for (let i = 1; i <= 60; i++) {
            const a = a0 + ((a1 - a0) * i) / 60;
            const f = s.update({ x: (P.x + rad * Math.cos(a)) / ctx.map.kx, y: (P.y + rad * Math.sin(a)) / ctx.map.ky }, { shift: true, alt: false });
            const tx = f.edits.find((e) => e.ref.kind === 'tool' && e.ref.field === 'condition')!.text;
            if (tx !== start) left = true;
            else assert.ok(!left, `entry ${entry}: snapped back to the start text at ${((a * 180) / Math.PI).toFixed(1)} deg (${f.chip.detail})`);
        }
        assert.ok(s.commit(), `entry ${entry}: the turn is kept`);
    }
});

test('a turn whose slider hits its bound stops with the pivot kept and says so', () => {
    const lp = example('lp');
    const ctx = lp.ctx;
    const hit = hitByKey(ctx, 't1#level:0', { x: 1.5, y: 2 });
    const t = resolveTarget(hit, ctx);
    const s = DragSession.start(prepared(ctx, t, hit.at, 'pivot', { x: 3, y: 1 }), { shift: true, alt: true }, ctx);
    const P = { x: 3 * ctx.map.kx, y: ctx.map.ky };
    const g = { x: hit.at.x * ctx.map.kx, y: hit.at.y * ctx.map.ky };
    const rad = Math.hypot(g.x - P.x, g.y - P.y);
    const a0 = Math.atan2(g.y - P.y, g.x - P.x);
    let worst = 0;
    let clamped = false;
    for (let i = 1; i <= 60; i++) {
        const a = a0 - (1.2 * i) / 60;
        const f = s.update({ x: (P.x + rad * Math.cos(a)) / ctx.map.kx, y: (P.y + rad * Math.sin(a)) / ctx.map.ky }, { shift: true, alt: true });
        if (f.chip.detail === 'c is at its maximum (15)') clamped = true;
        const eq = editText(f, { kind: 'tool', id: 't1', field: 'equation' })!;
        const cv = paramValue(f, 'c')!;
        const m = /^(-?[\d.]+)x \+ 3y = c$/.exec(eq);
        const A = m ? parseFloat(m[1]) : 2;
        worst = Math.max(worst, implicitDistPx((x, y) => A * x + 3 * y - cv, { x: 3, y: 1 }, ctx));
    }
    assert.ok(clamped, 'the chip names the clamped slider');
    assert.ok(worst <= 2, `pivot drifted ${worst.toFixed(2)} px`);
});

// ---------------------------------------------------------------- keyboard

test('keyboard nudges land on the pixel step every press (no swallowed presses)', () => {
    const lp = example('lp');
    const hit = hitByKey(lp.ctx, 't0#clause:1:0:0', { x: 1.5, y: 1.5 });
    const t = resolveTarget(hit, lp.ctx);
    const p = prepared(lp.ctx, t, hit.at, 'move');
    let s: DragSession | null = null;
    const seq: string[] = [];
    for (let i = 0; i < 5; i++) {
        const r = nudge(s, p, { x: 0.05, y: 0 }, { shift: false, alt: false }, lp.ctx);
        s = r.session;
        seq.push(r.frame.edits[0].text.replace('x + 3y <= ', ''));
    }
    assert.deepEqual(seq, ['6.05', '6.1', '6.15', '6.2', '6.25']);
});

// ------------------------------------------------------------- delegation

test('a clause that delegates to sin pivots like sin itself: origin, two numbers', () => {
    const areas = example('areas');
    const grab = { x: 2, y: Math.sin(2) };
    const t = resolveTarget(hitByKey(areas.ctx, 't0#clause:0:0:1', grab), areas.ctx);
    assert.equal(t.key, 'fn:f1#curve');
    const p = prepared(areas.ctx, t, grab, 'pivot');
    assert.equal(p.chip.detail, 'Shift-drag stretches from ⊕ (0, 0)');
    const s = DragSession.start(p, { shift: true, alt: false }, areas.ctx);
    const f = s.update({ x: 2, y: Math.sin(2) * 1.5 }, { shift: true, alt: false });
    assert.equal(editText(f, F1), '1.5sin(x)');
});

// ------------------------------------------------------------------ ghosts

test('hover ghosts show the structure the rewrite writes (parentheses, every occurrence)', () => {
    const cases: Array<[string, Pt, Gesture, string, Pt?]> = [
        ['x^2', { x: 1, y: 1 }, 'move', 'f1: (x - h)^2 + k'],
        ['x^3 - 3x', { x: 1.2, y: 1.2 ** 3 - 3.6 }, 'move', 'f1: (x - h)^3 - 3(x - h) + k'],
        ['2x^2', { x: 1, y: 2 }, 'move', 'f1: 2(x - h)^2 + k'],
        ['1/x', { x: 1, y: 1 }, 'move', 'f1: 1/(x - h) + k'],
        ['sin(x)', { x: Math.PI / 2, y: 1 }, 'pivot', 'f1: asin(sx)', { x: 0, y: 0 }],
    ];
    for (const [expr, grab, gesture, want, pivot] of cases) {
        const chart = makeChart(chartJson({ view: [-4, 4, -4, 4], functions: [{ expression: expr }] }));
        const t = resolveTarget({ ...hitByKey(chart.ctx, 'fn:f1#curve', grab), at: grab }, chart.ctx);
        const p = prepared(chart.ctx, t, grab, gesture, pivot);
        assert.equal(titleText(p), want, expr);
    }
    const circle = makeChart(chartJson({ view: [-4, 4, -4, 4], tools: [regionTool('t0', 'R1', ['x^2 + y^2 <= 4'])] }));
    const tc = resolveTarget(hitByKey(circle.ctx, 't0#clause:0:0:0', { x: 2, y: 0 }), circle.ctx);
    const pc = prepared(circle.ctx, tc, tc.lines[0][0], 'move');
    assert.equal(titleText(pc), 'R1 condition 1: (x - h)^2 + (y - h2)^2 <= 4');
});

// ---------------------------------------------------------- pivot polish

test('a hover plan whose pivot is dead for the new grab is not reused: x^2 - 3x + 1 slid toward y = 1', () => {
    const chart = makeChart(chartJson({ view: [-1, 5, -1.5, 2.5], functions: [{ expression: 'x^2 - 3x + 1' }] }));
    const ctx = chart.ctx;
    const f = (x: number) => x * x - 3 * x + 1;
    const on = (y: number): Pt => {
        const x = (3 + Math.sqrt(9 + 4 * (y - 1))) / 2;
        return { x, y: f(x) };
    };
    // A: 25 px above y = 1 (the y-axis crossing (0, 1) is live there); B: 5 px above, within 24 px of A.
    const A = on(1 + 25 / ctx.map.ky);
    const B = on(1 + 5 / ctx.map.ky);
    assert.ok(Math.hypot((A.x - B.x) * ctx.map.kx, (A.y - B.y) * ctx.map.ky) <= 24);
    const pA = prepared(ctx, resolveTarget({ ...hitByKey(ctx, 'fn:f1#curve', A), at: A }, ctx), A, 'pivot');
    assert.equal(pA.chip.detail, 'Shift-drag stretches from ⊕ (0, 1)');
    assert.equal(preparedServes(pA, B, ctx.map, 24), false, "A's pivot is 5 px from B along y");
    assert.equal(preparedServes(pA, { x: A.x + 0.5 / ctx.map.kx, y: A.y }, ctx.map, 24), true);
    const pB = prepared(ctx, resolveTarget({ ...hitByKey(ctx, 'fn:f1#curve', B), at: B }, ctx), B, 'pivot');
    assert.equal(pB.chip.detail, 'Shift-drag stretches from ⊕ (1.5, -1.25)');
    assert.equal(preparedServes(pB, B, ctx.map, 1), true);
    // Move plans are reused by distance alone.
    const mA = prepared(ctx, resolveTarget({ ...hitByKey(ctx, 'fn:f1#curve', A), at: A }, ctx), A, 'move');
    assert.equal(preparedServes(mA, B, ctx.map, 24), true);
});

test('an implicit curve not in graph form stretches about a pivot live on both axes: y - x^2 = 0 near its top', () => {
    const chart = makeChart(chartJson({ view: [-3, 3, -1, 5], tools: [curveTool('t0', 'C1', 'y - x^2 = 0')] }));
    const ctx = chart.ctx;
    for (const gx of [-2.15, 2.151]) {
        const grab = { x: gx, y: gx * gx };
        const r = run(ctx, 't0#level:0', grab, 'pivot', line(grab, { x: grab.x, y: grab.y - 0.6 }));
        const at = r.prep.info.pivot!.at;
        assert.ok(Math.abs(at.x - grab.x) * ctx.map.kx >= 24 && Math.abs(at.y - grab.y) * ctx.map.ky >= 24, JSON.stringify(at));
        assert.equal(r.prep.chip.detail, 'Shift-drag stretches from ⊕ (0, 0)');
        assert.ok(r.commit, 'a vertical Shift-drag changes the equation');
        const after = r.commit!.fields[0].after;
        const m = /^([\d.]+)y - x\^2 = 0$/.exec(after);
        assert.ok(m, after);
        const a = Number(m![1]);
        const d = implicitDistPx((x, y) => a * y - x * x, { x: grab.x, y: grab.y - 0.6 }, ctx);
        assert.ok(d <= 2, `pointer ${d.toFixed(2)} px from ${after}`);
    }
});

test('graph-form clauses pivot like graphs: y <= x^2 grabbed near its top stretches about the vertex', () => {
    const chart = makeChart(chartJson({ view: [-3, 3, -1, 5], tools: [regionTool('t0', 'R1', ['y <= x^2'])] }));
    const ctx = chart.ctx;
    const grab = { x: -2.15, y: 2.15 * 2.15 };
    const r = run(ctx, 't0#clause:0:0:0', grab, 'pivot', line(grab, { x: grab.x, y: grab.y - 0.6 }));
    assert.equal(r.prep.chip.detail, 'Shift-drag stretches from ⊕ (0, 0)');
    assert.equal(r.commit!.fields[0].after, 'y <= 0.87x^2');
    // The curve tool in graph form, and sin about the origin.
    const c = makeChart(chartJson({ view: [-1, 7, -2, 2.5], tools: [curveTool('t0', 'C1', 'y = sin(x)')] }));
    const g = { x: Math.PI / 2, y: 1 };
    const rc = run(c.ctx, 't0#level:0', g, 'pivot', line(g, { x: g.x, y: 1.5 }));
    assert.equal(rc.prep.chip.detail, 'Shift-drag stretches from ⊕ (0, 0)');
    assert.equal(rc.commit!.fields[0].after, 'y = 1.5sin(x)');
});

test('no pivot far enough from the grab: the Shift lock says so instead of blaming the numbers', () => {
    const chart = makeChart(chartJson({ view: [-3, 3, -1, 5], tools: [regionTool('t0', 'R1', ['y <= x^2'])] }));
    const ctx = chart.ctx;
    const grab = { x: 1, y: 1 };
    const t0 = resolveTarget({ ...hitByKey(ctx, 't0#clause:0:0:0', grab), at: grab }, ctx);
    // Only a short piece around the grab is drawn: every candidate lies within 12 px of it.
    const piece = [-2, -1, 0, 1, 2].map((k) => {
        const x = 1 + (k * 2) / ctx.map.kx;
        return { x, y: x * x };
    });
    const t = { ...t0, lines: [piece], run: 0 };
    const p = prepared(ctx, t, grab, 'pivot');
    assert.equal(p.info.pivot, null);
    assert.equal(p.chip.detail, 'Shift-drag has no ⊕ to stretch R1 condition 1 from this point');
    assert.equal(preparedServes(p, { x: 1.01, y: 1.0201 }, ctx.map, 24), false, 'another grab is planned afresh');
});

test('graph form, last resort: a frozen chain middle stretches with the output scale; --y is graph form', () => {
    const chart = makeChart(chartJson({ view: [-3, 3, -1, 5], tools: [regionTool('t0', 'R1', ['y <= x^2 <= 4'])] }));
    const ctx = chart.ctx;
    const grab = { x: 1, y: 1 };
    for (const pivot of [undefined, { x: 0, y: 0 }]) {
        const r = run(ctx, 't0#clause:0:0:0', grab, 'pivot', line(grab, { x: 1, y: 2 }), pivot);
        assert.equal(r.prep.info.shiftLock, null, r.prep.chip.detail);
        assert.equal(r.prep.chip.detail, 'Shift-drag stretches from ⊕ (0, 0)');
        assert.equal(r.commit!.fields[0].after, '0.5y <= x^2 <= 4');
    }
    const dbl = makeChart(chartJson({ view: [-3, 3, -1, 5], tools: [regionTool('t0', 'R1', ['--y <= x^2'])] }));
    const rd = run(dbl.ctx, 't0#clause:0:0:0', grab, 'pivot', line(grab, { x: 1, y: 2 }), { x: 0, y: 0 });
    assert.equal(rd.commit!.fields[0].after, '--y <= 2x^2');
});

test('straight clauses find natural pivots although their hit shape holds the segment twice, once reversed', () => {
    const chart = makeChart(chartJson({ view: [-1, 7, -1, 3], tools: [regionTool('t0', 'R1', ['x + 3y <= 6'])] }));
    const ctx = chart.ctx;
    const grab = { x: 1.5, y: 1.5 };
    const shape = ctx.hits.byKey('t0#clause:0:0:0')!;
    assert.ok(shape.lines.length === 2, JSON.stringify(shape.lines));
    const r = run(ctx, 't0#clause:0:0:0', grab, 'pivot', line(grab, { x: 1.5, y: 1.2 }));
    assert.equal(r.prep.chip.detail, 'Shift-drag turns around ⊕ (6, 0)', 'the natural pivot of the 3');
    assert.ok(/^x \+ [\d.]+y <= 6$/.test(r.commit!.fields[0].after), r.commit!.fields[0].after);
    const v = makeChart(chartJson({ view: [-1, 5, -1, 5], tools: [regionTool('t0', 'R1', ['y <= 4 - x'])] }));
    const g = { x: 3, y: 1 };
    const rv = run(v.ctx, 't0#clause:0:0:0', g, 'pivot', line(g, { x: 3, y: 2 }));
    assert.equal(rv.prep.chip.detail, 'Shift-drag turns around ⊕ (0, 4)', "the natural pivot of x's factor");
});
