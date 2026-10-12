/* eslint-disable @typescript-eslint/no-non-null-assertion */
/*
 * Drag session behaviour (SPEC3 6.1, owner D): target resolution
 * (delegation, locks, twins), pivot choice, snapping, re-base on a Shift
 * change, cancel, commit, Make slider, keyboard nudges and the chart-level
 * undo history with its stale checks.
 */
import { test, assert, near } from './_lib';
import { EXAMPLES } from '../src/migrate';
import { DragSession, nudge, prepareDrag } from '../src/drag/session';
import type { PreparedDrag } from '../src/drag/session';
import { fieldText, resolveTarget, setFieldText } from '../src/drag/targets';
import type { ChartData } from '../src/drag/targets';
import { EditHistory, patchEntry } from '../src/drag/history';
import type { HistoryEntry, PatchIO } from '../src/drag/history';
import { pointText, staleText } from '../src/drag/describe';
import { choosePivot } from '../src/drag/pivot';
import type { PivotCandidate } from '../src/drag/pivot';
import { MathContext } from '../src/mathcontext';
import type { DragCommit, DragContext, DragTarget, FieldRef, Gesture, Pt } from '../src/drag/types';
import {
    applyFrame,
    chartJson,
    curveTool,
    drag,
    editText,
    hitAt,
    hitByKey,
    makeChart,
    paramValue,
    pointsTool,
    regionTool,
    segmentTool,
} from './_drag';

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

// ------------------------------------------------------------- targets

test('resolveTarget: an extremum marker delegates to its function, grabbed at the vertex', () => {
    const chart = makeChart(chartJson({ view: [-3, 3, -4, 4], functions: [{ expression: 'x^3 - 3x', extrema: true }] }));
    const ctx = chart.ctx;
    const hit = hitAt(ctx, { x: -1, y: 2 });
    assert.equal(hit.shape.part.part, 'extremum');
    const t = resolveTarget(hit, ctx);
    assert.equal(t.lock, null);
    assert.equal(t.kind, 'graph');
    assert.equal(t.key, 'fn:f1#curve');
    assert.equal(t.subject, 'f1');
    assert.ok(t.run >= 0);
    assert.equal(t.shift, 'stretch');
});

test('resolveTarget: y <= f1 and both clauses of f2 <= y <= f1 delegate to the function', () => {
    const areas = example('areas');
    const ctx = areas.ctx;
    for (const [key, fnName] of [
        ['t0#clause:0:0:0', 'f2'],
        ['t0#clause:0:0:1', 'f1'],
    ]) {
        const shape = ctx.hits.byKey(key);
        assert.ok(shape, key);
        const t = resolveTarget(hitByKey(ctx, key, shape!.lines[0][Math.floor(shape!.lines[0].length / 2)]), ctx);
        assert.equal(t.lock, null, key);
        assert.equal(t.kind, 'graph');
        assert.equal(t.subject, fnName);
        assert.equal(t.key, `fn:${fnName}#curve`);
        assert.deepEqual(t.units[0].ref, { kind: 'function', name: fnName, field: 'expression' });
    }
    const simple = makeChart(
        chartJson({ view: [-1, 5, -1, 5], functions: [{ expression: '0.5x + 1' }], tools: [regionTool('t0', 'R1', ['y <= f1', 'x >= 0', 'y >= 0'])] })
    );
    const shape = simple.ctx.hits.byKey('t0#clause:0:0:0');
    assert.ok(shape);
    const t = resolveTarget(hitByKey(simple.ctx, 't0#clause:0:0:0', { x: 2, y: 2 }), simple.ctx);
    assert.equal(t.subject, 'f1');
    assert.equal(t.straight, true);
    assert.equal(t.shift, 'turn');
    // Samples, halo and pivot candidates come from the function's own drawn run that holds the grab.
    const curve = simple.ctx.hits.byKey('fn:f1#curve');
    assert.ok(curve);
    assert.equal(t.lines, curve!.lines);
    assert.ok(t.run >= 0);
});

test('locks: optimum, corner, intersection, lattice, derived clause, derived level, keyword tangent, spliced vertex, parametric', () => {
    const lp = example('lp');
    assert.equal(resolveTarget(hitByKey(lp.ctx, 't3#point:0'), lp.ctx).lock?.title, 'P1 is computed: the max of 2x + 3y over R1');
    assert.equal(resolveTarget(hitByKey(lp.ctx, 't2#point:0'), lp.ctx).lock?.title, 'P2 is computed: the corners of R1');

    const areas = example('areas');
    const inter = areas.ctx.hits.points().find((h) => h.source === 'P1');
    assert.ok(inter && inter.locked === 'intersection');
    assert.equal(resolveTarget({ shape: inter!, at: inter!.point!, run: -1, distPx: 0, passed: null }, areas.ctx).lock?.title, 'P1 is computed: where f1 meets f2');

    const lat = makeChart(chartJson({ view: [-1, 4, -1, 4], tools: [regionTool('t0', 'R1', ['x + y <= 2', 'x >= 0', 'y >= 0']), pointsTool('t1', 'P3', { source: 'lattice', regionName: 'R1' })] }));
    const lp3 = lat.ctx.hits.points().find((h) => h.source === 'P3');
    assert.ok(lp3);
    const lock = resolveTarget({ shape: lp3!, at: lp3!.point!, run: -1, distPx: 0, passed: null }, lat.ctx).lock;
    assert.equal(lock?.title, 'P3 is computed: the integer points of R1');

    const surplus = example('surplus');
    const cs = resolveTarget(hitByKey(surplus.ctx, 't1#clause:0:0:0'), surplus.ctx);
    assert.equal(cs.lock?.title, 'This edge of R1 follows P1_y');
    // R2's top edge P1_y (clause 1 of 'f2 <= y <= P1_y') is derived too.
    const ps = resolveTarget(hitByKey(surplus.ctx, 't2#clause:0:0:1'), surplus.ctx);
    assert.equal(ps.lock?.title, 'This edge of R2 follows P1_y');

    const levels = example('levels');
    const c2 = resolveTarget(hitByKey(levels.ctx, 't3#level:0', { x: 1.3, y: 1.2 }), levels.ctx);
    assert.equal(c2.lock, null, 'the derived level is draggable with Shift');
    const plain = prepareDrag(c2, c2.lines[0][0], 'move', levels.ctx);
    assert.ok('lock' in plain);
    assert.equal((plain as { lock: { title: string } }).lock.title, "C2's level is P1_val");
    const shifted = prepareDrag(c2, c2.lines[0][0], 'pivot', levels.ctx);
    assert.ok(!('lock' in shifted), 'Shift reshapes the curve');

    const kw = makeChart(chartJson({ view: [-3, 3, -4, 4], functions: [{ expression: 'x^3 - 3x', tangent: true, tangentPoint: 'max' }] }));
    const tan = resolveTarget(hitByKey(kw.ctx, '0#tangent'), kw.ctx);
    assert.equal(tan.lock?.title, 'The tangent of f1 sits at its max');

    const spliced = makeChart(
        chartJson({ view: [-1, 5, -1, 5], tools: [pointsTool('t0', 'P2', { points: '(1, 1); (2, 3)' }), segmentTool('t1', 'S1', '(0, 0); P2; (4, 0)')] })
    );
    const v2 = spliced.ctx.hits.byKey('t1#vertex:2');
    assert.ok(v2, 'vertex 3 of S1');
    const vt = resolveTarget({ shape: v2!, at: v2!.point!, run: -1, distPx: 0, passed: null }, spliced.ctx);
    assert.equal(vt.lock?.title, 'S1 point 3 comes from P2');
    assert.equal(vt.lock?.detail, 'Drag it in P2 instead');
    const leg = resolveTarget(hitByKey(spliced.ctx, 't1#leg:0', { x: 0.5, y: 0.5 }), spliced.ctx);
    assert.equal(leg.lock?.title, "S1 follows P2's points");
    const own = resolveTarget(hitByKey(spliced.ctx, 't1#vertex:0'), spliced.ctx);
    assert.equal(own.lock, null);
    assert.equal(own.subject, 'S1 point 1');

    const para = makeChart(chartJson({ view: [-2, 2, -2, 2], functions: [{ expression: 'cos(t)', expressionY: 'sin(t)', parametric: true, domain: '0:2*pi' }] }));
    const pt = resolveTarget(hitByKey(para.ctx, 'fn:f1#curve', { x: 1, y: 0 }), para.ctx);
    assert.equal(pt.lock?.title, 'f1 is parametric');
});

test('twins: LP C1 is linked to P1 objective; clauses never twin', () => {
    const lp = example('lp');
    const c1 = resolveTarget(hitByKey(lp.ctx, 't1#level:0', { x: 1.5, y: 2 }), lp.ctx);
    assert.deepEqual(c1.twins, [{ ref: { kind: 'tool', id: 't3', field: 'objective' }, role: 'side' }]);
    assert.deepEqual(c1.twinNames, ['P1']);
    const chart = makeChart(
        chartJson({
            view: [0, 5, 0, 5],
            tools: [regionTool('t0', 'R1', ['x + y <= 4', 'x + y >= 1']), pointsTool('t1', 'P1', { source: 'region', regionName: 'R1', objective: 'x + y' })],
        })
    );
    for (const key of ['t0#clause:0:0:0', 't0#clause:1:0:0']) {
        const t = resolveTarget(hitByKey(chart.ctx, key, { x: 2, y: 2 }), chart.ctx);
        assert.deepEqual(t.twins, [], key);
    }
});

// ---------------------------------------------------------------- pivot

test('pivot choice: LP line (2) at a corner, C1 at the optimum, sin about the origin, circle centre, demand at the equilibrium', () => {
    const lp = example('lp');
    const l2 = resolveTarget(hitByKey(lp.ctx, 't0#clause:1:0:0', { x: 1.5, y: 1.5 }), lp.ctx);
    const p2 = prepared(lp.ctx, l2, { x: 1.5, y: 1.5 }, 'pivot');
    const at = p2.info.pivot!.at;
    assert.ok((near3(at, { x: 3, y: 1 }) || near3(at, { x: 0, y: 2 })), JSON.stringify(at));
    const c1 = resolveTarget(hitByKey(lp.ctx, 't1#level:0', { x: 1.5, y: 2 }), lp.ctx);
    const pc = prepared(lp.ctx, c1, { x: 1.5, y: 2 }, 'pivot');
    assert.ok(near3(pc.info.pivot!.at, { x: 3, y: 1 }), JSON.stringify(pc.info.pivot));

    const sin = makeChart(chartJson({ view: [-1, 7, -2, 2.5], functions: [{ expression: 'sin(x)' }] }));
    const ts = resolveTarget(hitByKey(sin.ctx, 'fn:f1#curve', { x: Math.PI / 2, y: 1 }), sin.ctx);
    const ps = prepared(sin.ctx, ts, { x: Math.PI / 2, y: 1 }, 'pivot');
    assert.ok(near3(ps.info.pivot!.at, { x: 0, y: 0 }), JSON.stringify(ps.info.pivot));
    assert.equal(ps.chip.detail, 'Shift-drag stretches from ⊕ (0, 0)');

    const circle = makeChart(chartJson({ view: [-4, 4, -4, 4], equal: true, tools: [curveTool('t0', 'C1', '(x - 1)^2 + y^2 = 4')] }), { equal: true });
    const tc = resolveTarget(hitByKey(circle.ctx, 't0#level:0', { x: 3, y: 0 }), circle.ctx);
    assert.equal(tc.closed, true);
    assert.equal(tc.shift, 'resize');
    const pcirc = prepared(circle.ctx, tc, { x: 3, y: 0 }, 'pivot');
    assert.ok(near3(pcirc.info.pivot!.at, { x: 1, y: 0 }), JSON.stringify(pcirc.info.pivot));

    const surplus = example('surplus');
    const td = resolveTarget(hitByKey(surplus.ctx, 'fn:f1#curve', { x: 2, y: 8 }), surplus.ctx);
    const pd = prepared(surplus.ctx, td, { x: 2, y: 8 }, 'pivot');
    assert.ok(near3(pd.info.pivot!.at, { x: 4, y: 6 }), JSON.stringify(pd.info.pivot));
});

test('stretch pivot never leaves the stretched axis dead: x^2 - 3x + 1 grabbed at (3, 1) stretches vertically', () => {
    // The cost rule alone picks the y-axis crossing (0, 1), level with the grab: the vertical stretch would
    // be dead (under 24 px), so a vertical Shift-drag would change nothing while the chip promised a stretch.
    const chart = makeChart(chartJson({ view: [-1, 5, -3, 5], functions: [{ expression: 'x^2 - 3x + 1' }] }));
    const ctx = chart.ctx;
    const grab = { x: 3, y: 1 };
    const to = { x: 3, y: 2 };
    const t = resolveTarget(hitByKey(ctx, 'fn:f1#curve', grab), ctx);
    const p = prepared(ctx, t, grab, 'pivot');
    const at = p.info.pivot!.at;
    assert.ok(Math.abs(at.y - grab.y) * ctx.map.ky >= 24, `pivot ${JSON.stringify(at)} leaves the vertical axis dead`);
    assert.ok(!near3(at, { x: 0, y: 1 }), JSON.stringify(at));
    assert.equal(p.chip.detail, `Shift-drag stretches from ⊕ ${pointText(at)}`, 'the hover chip names the pivot in use');

    const run = drag(ctx, t, grab, to, { gesture: 'pivot' });
    assert.ok(run.commit, 'a vertical Shift-drag changes the text');
    const after = run.commit!.fields[0].after;
    assert.notEqual(after, 'x^2 - 3x + 1');
    for (const f of run.frames) {
        assert.ok(f.pivot && near3(f.pivot, at), `frame pivot ${JSON.stringify(f.pivot)} is the hover pivot ${JSON.stringify(at)}`);
        if (/^stretching/.test(f.chip.detail)) assert.equal(f.chip.detail, `stretching from ⊕ ${pointText(at)}`);
    }
    assert.ok(run.frames.some((f) => /^stretching from ⊕/.test(f.chip.detail)), run.frames.map((f) => f.chip.detail).join(' | '));
    // The grabbed point follows the pointer (normal distance in px) and the pivot stays on the curve.
    const math = new MathContext(ctx.mathInput);
    const f = math.fn1(after);
    const dist = (q: Pt) => {
        const h = 1e-6;
        const sl = ((f(q.x + h) - f(q.x - h)) / (2 * h)) * (ctx.map.ky / ctx.map.kx);
        return (Math.abs(f(q.x) - q.y) * ctx.map.ky) / Math.sqrt(1 + sl * sl);
    };
    assert.ok(dist(to) <= 2, `pointer ${dist(to).toFixed(2)} px from ${after}`);
    assert.ok(dist(at) <= 2, `pivot ${dist(at).toFixed(2)} px from ${after}`);
});

test('choosePivot: a stretch candidate level with the grab along the stretched axis falls through to the next', () => {
    const chart = makeChart(chartJson({ view: [-1, 5, -3, 5], functions: [{ expression: 'x^2 - 3x + 1' }] }));
    const ctx = chart.ctx;
    const grab = { x: 3, y: 1 };
    const cands: PivotCandidate[] = [
        { at: { x: 1.5, y: -1.25 }, reason: 'extremum', cls: 1 },
        { at: { x: 0, y: 1 }, reason: 'axis', cls: 4 },
        { at: { x: 3, y: -2 }, reason: 'marker', cls: 3 },
        { at: { x: -0.6, y: 3.16 }, reason: 'end', cls: 5 },
    ];
    const cost = (q: Pt) => (q.x === 0 ? 2.5 : q.x === 3 ? 3 : 3.5);
    assert.deepEqual(choosePivot(cands, grab, ctx, cost)!.at, { x: 0, y: 1 }, 'without an axis the cheapest wins');
    // (3, -2) is cheaper but right below the grab: its horizontal stretch would be dead, so the vertex (live
    // along both axes) comes first; without it, the cheapest live along y.
    assert.deepEqual(choosePivot(cands, grab, ctx, cost, 1)!.at, { x: 1.5, y: -1.25 }, 'vertical: the cheapest live along both axes');
    assert.deepEqual(choosePivot(cands.slice(1), grab, ctx, cost, 1)!.at, { x: 3, y: -2 }, 'vertical: the next cheapest');
    assert.deepEqual(choosePivot(cands, grab, ctx, cost, 0)!.at, { x: 1.5, y: -1.25 }, 'horizontal: (0, 1) is level with the grab (y dead)');
    assert.deepEqual(choosePivot(cands.slice(1), grab, ctx, cost, 0)!.at, { x: 0, y: 1 }, 'horizontal: (0, 1) is 300 px away along x');
    // preferBoth (an implicit curve's guessed axis): a far end live along both axes beats a cheaper candidate
    // live along the guessed axis only.
    const guess: PivotCandidate[] = [
        { at: { x: 3, y: -2 }, reason: 'extremum', cls: 1 },
        { at: { x: -0.6, y: 3.16 }, reason: 'end', cls: 5 },
    ];
    assert.deepEqual(choosePivot(guess, grab, ctx, cost, 1)!.at, { x: 3, y: -2 });
    assert.deepEqual(choosePivot(guess, grab, ctx, cost, 1, true)!.at, { x: -0.6, y: 3.16 });
    assert.deepEqual(choosePivot(guess.slice(0, 1), grab, ctx, cost, 1, true)!.at, { x: 3, y: -2 }, 'none live along both: the guessed axis alone');
    // Every costed candidate dead along y: the far end; nothing live at all: no pivot (Shift moves).
    const dead: PivotCandidate[] = [
        { at: { x: 0, y: 1.1 }, reason: 'axis', cls: 4 },
        { at: { x: -0.6, y: 3.16 }, reason: 'end', cls: 5 },
    ];
    assert.deepEqual(choosePivot(dead, grab, ctx, cost, 1)!.at, { x: -0.6, y: 3.16 });
    assert.equal(choosePivot([dead[0]], grab, ctx, cost, 1), null);
});

function near3(a: Pt, b: Pt): boolean {
    return Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3;
}

// ------------------------------------------------------------ drags

test('LP: dragging constraint (2) writes 6.x on every frame and commits one patch', () => {
    const lp = example('lp');
    const t = resolveTarget(hitByKey(lp.ctx, 't0#clause:1:0:0', { x: 1.5, y: 1.5 }), lp.ctx);
    const run = drag(lp.ctx, t, { x: 1.5, y: 1.5 }, { x: 1.85, y: 1.5 });
    const ref: FieldRef = { kind: 'tool', id: 't0', field: 'condition', entry: 1 };
    for (const f of run.frames) assert.ok(/^x \+ 3y <= 6(\.\d+)?$/.test(editText(f, ref) || ''), editText(f, ref) || '');
    assert.ok(run.commit);
    assert.equal(run.commit!.label, 'Moved R1 (2)');
    assert.equal(run.commit!.fields.length, 1);
    assert.equal(run.commit!.fields[0].before, 'x + 3y <= 6');
    const after = run.commit!.fields[0].after;
    assert.ok(/^x \+ 3y <= 6\.[34]5?$/.test(after), after);
    assert.equal(run.commit!.announce, `R1 (2): ${after}`);
    // Exactly one literal changed: Make slider is offered on the written token.
    const ms = run.commit!.makeSlider;
    assert.ok(ms);
    assert.equal(after.slice(ms!.span[0], ms!.span[1]), after.slice(10));
    assert.equal(ms!.value, Number(after.slice(10)));
});

test('LP: C1 slides c; near the optimum the line snaps through P1 so c = P1_val', () => {
    const lp = example('lp');
    const t = resolveTarget(hitByKey(lp.ctx, 't1#level:0', { x: 1.5, y: 2 }), lp.ctx);
    const run = drag(lp.ctx, t, { x: 1.5, y: 2 }, { x: 1.5, y: 2.3 });
    const last = run.frames[run.frames.length - 1];
    near(paramValue(last, 'c') as number, 9.9, 1e-12);
    assert.equal(editText(last, { kind: 'tool', id: 't1', field: 'equation' }), '2x + 3y = c');
    assert.equal(run.commit!.label, 'Moved C1');
    assert.equal(run.commit!.makeSlider, null, 'a slider moved: no Make slider');
    // Away and back towards the optimum: within 8 px of P1 (drawn over the P2 corner) the line passes through it.
    const run2 = drag(lp.ctx, t, { x: 1.5, y: 2 }, { x: 1.5, y: 2.04 }, { path: [{ x: 1.5, y: 2.2 }, { x: 1.5, y: 2.3 }, { x: 1.5, y: 2.1 }, { x: 1.5, y: 2.04 }] });
    const f2 = run2.frames[run2.frames.length - 1];
    assert.equal(f2.chip.detail, 'through P1');
    assert.ok(f2.snapped && near3(f2.snapped, { x: 3, y: 1 }));
    near(paramValue(f2, 'c') as number, 9, 1e-12);
    // At the start the line already passes through P1: no dead zone, the first pixels move c.
    const run3 = drag(lp.ctx, t, { x: 1.5, y: 2 }, { x: 1.5, y: 2.06 }, { steps: 3 });
    assert.ok((paramValue(run3.frames[2], 'c') as number) > 9);
});

test('LP: Shift-drag C1 about the optimum also turns the objective twin', () => {
    const lp = example('lp');
    const t = resolveTarget(hitByKey(lp.ctx, 't1#level:0', { x: 0, y: 3 }), lp.ctx);
    const run = drag(lp.ctx, t, { x: 0, y: 3 }, { x: 0, y: 3.5 }, { gesture: 'pivot', apply: lp });
    assert.equal(run.commit!.label, "Turned C1 and P1's objective");
    assert.equal(fieldText({ kind: 'tool', id: 't1', field: 'equation' }, lp.data), '2.5x + 3y = c');
    assert.equal(fieldText({ kind: 'tool', id: 't3', field: 'objective' }, lp.data), '2.5x + 3y');
    near(lp.data.parameters[0].value, 10.5, 1e-12);
    const live = run.frames[run.frames.length - 1];
    // Slope -5/6 is a turn detent ((6, -5) in math units).
    assert.equal(live.chip.detail, 'slope -5/6');
    for (const f of run.frames) assert.ok(/^(turning around ⊕ \(3, 1\)|slope -\d\/\d)$/.test(f.chip.detail), f.chip.detail);
    const alt = drag(lp.ctx, t, { x: 0, y: 3 }, { x: 0, y: 3.31 }, { gesture: 'pivot', mods: { alt: true } });
    assert.equal(alt.frames[alt.frames.length - 1].chip.detail, 'turning around ⊕ (3, 1)', 'Alt: no detents');
    assert.ok(live.pivot && near3(live.pivot, { x: 3, y: 1 }));
});

test('re-base on a Shift change: no jump, texts identical, one undo step', () => {
    const chart = makeChart(chartJson({ view: [-5, 5, -5, 5], functions: [{ expression: '2x + 1' }] }));
    const ctx = chart.ctx;
    const t = resolveTarget(hitByKey(ctx, 'fn:f1#curve', { x: 1, y: 3 }), ctx);
    const s = DragSession.start(prepared(ctx, t, { x: 1, y: 3 }, 'move'), { shift: false, alt: false }, ctx);
    let f = s.update({ x: 1.2, y: 3.4 }, { shift: false, alt: false });
    f = s.update({ x: 1.4, y: 3.6 }, { shift: false, alt: false });
    const before = editText(f, { kind: 'function', name: 'f1', field: 'expression' });
    assert.equal(before, '2x + 0.8');
    const after = s.update({ x: 1.4, y: 3.6 }, { shift: true, alt: false });
    assert.equal(editText(after, { kind: 'function', name: 'f1', field: 'expression' }), before, 'first frame after the Shift change = last frame before');
    // Turning on from there: the line keeps passing near the turn's pivot and the slope changes.
    const turned = s.update({ x: 1.4, y: 4.6 }, { shift: true, alt: false });
    const text = editText(turned, { kind: 'function', name: 'f1', field: 'expression' }) || '';
    assert.notEqual(text, before);
    assert.ok(!/^2x/.test(text), text);
    const commit = s.commit();
    assert.ok(commit);
    assert.equal(commit!.fields.length, 1, 'one field patch');
    assert.equal(commit!.fields[0].before, '2x + 1');
    assert.equal(commit!.label, 'Turned f1');
});

test('Escape / pointercancel: cancel returns every start text and slider value', () => {
    const lp = example('lp');
    const t = resolveTarget(hitByKey(lp.ctx, 't1#level:0', { x: 0, y: 3 }), lp.ctx);
    const s = DragSession.start(prepared(lp.ctx, t, { x: 0, y: 3 }, 'pivot'), { shift: true, alt: false }, lp.ctx);
    for (let k = 1; k <= 6; k++) applyFrame(lp.data, s.update({ x: 0, y: 3 + k * 0.08 }, { shift: true, alt: false }));
    assert.notEqual(fieldText({ kind: 'tool', id: 't1', field: 'equation' }, lp.data), '2x + 3y = c');
    const back = s.cancel();
    applyFrame(lp.data, back);
    assert.equal(fieldText({ kind: 'tool', id: 't1', field: 'equation' }, lp.data), '2x + 3y = c');
    assert.equal(fieldText({ kind: 'tool', id: 't3', field: 'objective' }, lp.data), '2x + 3y');
    assert.equal(lp.data.parameters[0].value, 9);
    assert.equal(s.commit(), null, 'a cancelled drag never commits');
});

test('commit is null when nothing changed', () => {
    const chart = makeChart(chartJson({ view: [-5, 5, -5, 5], functions: [{ expression: '2x + 1' }] }));
    const t = resolveTarget(hitByKey(chart.ctx, 'fn:f1#curve', { x: 1, y: 3 }), chart.ctx);
    const s = DragSession.start(prepared(chart.ctx, t, { x: 1, y: 3 }, 'move'), { shift: false, alt: false }, chart.ctx);
    s.update({ x: 1.002, y: 3.001 }, { shift: false, alt: false });
    assert.equal(s.commit(), null);
});

test('slider clamps: the tangent stops at a = 2 with the maximum status', () => {
    const tangent = example('tangent');
    const ctx = tangent.ctx;
    const t = resolveTarget(hitByKey(ctx, '0#tangent'), ctx);
    assert.equal(t.kind, 'tangent');
    const grab = t.points[0];
    const run = drag(ctx, t, grab, { x: 2.7, y: grab.y });
    const last = run.frames[run.frames.length - 1];
    assert.equal(paramValue(last, 'a'), 2);
    assert.equal(last.chip.detail, 'a is at its maximum (2)');
    assert.equal(run.commit!.label, 'Moved f1 tangent');
});

test('shift lock: x <= 4 cannot turn (no y term); the Shift-drag moves it instead', () => {
    const chart = makeChart(chartJson({ view: [-1, 6, -1, 6], tools: [regionTool('t0', 'R1', ['x <= 4', 'x + y <= 5', 'y >= 0'])] }));
    const t = resolveTarget(hitByKey(chart.ctx, 't0#clause:0:0:0', { x: 4, y: 0.5 }), chart.ctx);
    const p = prepared(chart.ctx, t, { x: 4, y: 0.5 }, 'pivot');
    assert.equal(p.info.shiftLock?.title, 'Shift-drag cannot turn x <= 4: it has no y term');
    assert.equal(p.chip.detail, 'Shift-drag cannot turn x <= 4: it has no y term');
    const run = drag(chart.ctx, t, { x: 4, y: 0.5 }, { x: 4.5, y: 0.5 }, { gesture: 'pivot' });
    assert.equal(run.commit!.fields[0].after, 'x <= 4.5');
});

test('points move straight with Shift (8 directions)', () => {
    const chart = makeChart(chartJson({ view: [-1, 5, -1, 5], tools: [pointsTool('t0', 'P1', { points: '(1, 1); (3, 2)' })] }));
    const t = resolveTarget(hitByKey(chart.ctx, 't0#point:1'), chart.ctx);
    assert.equal(t.subject, 'P1 point 2');
    const run = drag(chart.ctx, t, { x: 3, y: 2 }, { x: 3.83, y: 2.07 }, { gesture: 'pivot', mods: { alt: true } });
    assert.equal(run.commit!.fields[0].after, '(1, 1); (3.83, 2)');
    assert.equal(run.commit!.label, 'Moved P1 point 2');
});

test('labels: numeric positions follow, expression positions get an offset; labels never move sliders', () => {
    const chart = makeChart(
        chartJson({
            view: [-1, 5, -1, 5],
            parameters: [{ name: 'b', value: 1, min: 0, max: 4, step: 0.1 }],
            annotations: [{ x: '1', y: 'b', text: 'A', color: 'black', size: 'normal', anchor: 'center' }],
        })
    );
    const t = resolveTarget({ label: 0, at: { x: 1, y: 1 } }, chart.ctx);
    assert.equal(t.subject, 'Label 1');
    const run = drag(chart.ctx, t, { x: 1, y: 1 }, { x: 1.62, y: 1.33 }, { mods: { alt: true } });
    const fields = run.commit!.fields;
    assert.equal(fields.find((f) => f.ref.kind === 'label' && f.ref.field === 'x')?.after, '1.62');
    assert.equal(fields.find((f) => f.ref.kind === 'label' && f.ref.field === 'y')?.after, 'b + 0.33');
    assert.deepEqual(run.commit!.params, []);
    assert.equal(run.commit!.label, 'Moved Label 1');
});

test('keyboard nudges reuse one session and form one commit', () => {
    const chart = makeChart(chartJson({ view: [-5, 5, -5, 5], functions: [{ expression: '2x + 1' }] }));
    const ctx = chart.ctx;
    const t = resolveTarget(hitByKey(ctx, 'fn:f1#curve', { x: 1, y: 3 }), ctx);
    const p = prepared(ctx, t, { x: 1, y: 3 }, 'move');
    let r = nudge(null, p, { x: 0, y: 0.1 }, { shift: false, alt: false }, ctx);
    const first = r.session;
    r = nudge(r.session, p, { x: 0, y: 0.1 }, { shift: false, alt: false }, ctx);
    r = nudge(r.session, p, { x: 0, y: 0.1 }, { shift: false, alt: false }, ctx);
    assert.equal(r.session, first);
    assert.equal(editText(r.frame, { kind: 'function', name: 'f1', field: 'expression' }), '2x + 1.3');
    const c = r.session.commit();
    assert.equal(c!.fields[0].after, '2x + 1.3');
    const again = nudge(r.session, p, { x: 0, y: -0.1 }, { shift: false, alt: false }, ctx);
    assert.notEqual(again.session, first, 'a committed session is not reused');
});

test('frames carry structural only when a function text changed since the last frame', () => {
    const chart = makeChart(chartJson({ view: [-5, 5, -5, 5], functions: [{ expression: '2x + 1' }] }));
    const t = resolveTarget(hitByKey(chart.ctx, 'fn:f1#curve', { x: 1, y: 3 }), chart.ctx);
    const s = DragSession.start(prepared(chart.ctx, t, { x: 1, y: 3 }, 'move'), { shift: false, alt: false }, chart.ctx);
    const f1 = s.update({ x: 1, y: 3.5 }, { shift: false, alt: false });
    assert.equal(f1.structural, true);
    const f2 = s.update({ x: 1, y: 3.5 }, { shift: false, alt: false });
    assert.equal(f2.structural, false);
    assert.equal(f2.restricted, 'none');
});

// -------------------------------------------------------------- history

function io(data: ChartData, log: string[]): PatchIO {
    return {
        read: (ref) => fieldText(ref, data),
        write: (ref, text) => {
            setFieldText(ref, data, text);
        },
        readParam: (name) => {
            const p = data.parameters.find((q) => q.name === name);
            return p ? p.value : null;
        },
        writeParam: (name, value) => {
            const p = data.parameters.find((q) => q.name === name);
            if (p) p.value = value;
        },
        done: () => log.push('done'),
    };
}

function lpCommit(): { lp: ReturnType<typeof example>; commit: DragCommit } {
    const lp = example('lp');
    const t = resolveTarget(hitByKey(lp.ctx, 't1#level:0', { x: 0, y: 3 }), lp.ctx);
    const run = drag(lp.ctx, t, { x: 0, y: 3 }, { x: 0, y: 3.5 }, { gesture: 'pivot', apply: lp });
    return { lp, commit: run.commit! };
}

test('history: undo restores fields and sliders, redo re-applies', () => {
    const { lp, commit } = lpCommit();
    const log: string[] = [];
    const h = new EditHistory();
    const entry = patchEntry(commit, io(lp.data, log));
    h.push(entry);
    assert.equal(h.canUndo, true);
    assert.equal(h.canRedo, false);
    const u = h.undo();
    assert.ok(u && u.applied && u.entry === entry);
    assert.equal(fieldText({ kind: 'tool', id: 't1', field: 'equation' }, lp.data), '2x + 3y = c');
    assert.equal(fieldText({ kind: 'tool', id: 't3', field: 'objective' }, lp.data), '2x + 3y');
    assert.equal(lp.data.parameters[0].value, 9);
    assert.deepEqual(log, ['done']);
    assert.equal(h.canRedo, true);
    const r = h.redo();
    assert.ok(r && r.applied);
    assert.equal(fieldText({ kind: 'tool', id: 't1', field: 'equation' }, lp.data), '2.5x + 3y = c');
    assert.equal(lp.data.parameters[0].value, 10.5);
    assert.equal(h.canUndo, true);
    assert.equal(h.canRedo, false);
});

test('history: stale checks never overwrite later edits', () => {
    const { lp, commit } = lpCommit();
    const h = new EditHistory();
    const entry = patchEntry(commit, io(lp.data, []));
    h.push(entry);
    // The user edits the equation afterwards: undo leaves it, restores the rest, and says so.
    setFieldText({ kind: 'tool', id: 't1', field: 'equation' }, lp.data, '3x + 3y = c');
    const u = h.undo();
    assert.ok(u && u.applied);
    assert.equal(fieldText({ kind: 'tool', id: 't1', field: 'equation' }, lp.data), '3x + 3y = c');
    assert.equal(fieldText({ kind: 'tool', id: 't3', field: 'objective' }, lp.data), '2x + 3y');
    assert.deepEqual(entry.stale, ['C1']);
    assert.equal(staleText(entry.stale || [], true), 'Undone, except C1, which was edited since');

    // Everything edited since: nothing undone, false, no redo.
    const lp2 = lpCommit();
    const h2 = new EditHistory();
    const e2 = patchEntry(lp2.commit, io(lp2.lp.data, []));
    h2.push(e2);
    setFieldText({ kind: 'tool', id: 't1', field: 'equation' }, lp2.lp.data, 'x = 1');
    setFieldText({ kind: 'tool', id: 't3', field: 'objective' }, lp2.lp.data, 'x');
    lp2.lp.data.parameters[0].value = 3;
    const u2 = h2.undo();
    assert.ok(u2 && !u2.applied);
    assert.equal(h2.canRedo, false);
    assert.equal(staleText(e2.stale || [], false), "Nothing undone: C1, P1's objective and c were edited since");
});

test('history: cap, forget, clear', () => {
    const h = new EditHistory(3);
    const mk = (label: string): HistoryEntry => ({ label, undo: () => true, redo: () => true });
    const es = ['a', 'b', 'c', 'd'].map(mk);
    es.forEach((e) => h.push(e));
    assert.equal(h.undo()!.entry.label, 'd');
    h.forget(es[2]);
    assert.equal(h.undo()!.entry.label, 'b');
    assert.equal(h.undo(), null, 'a fell off the 3-entry cap');
    assert.equal(h.redo()!.entry.label, 'b');
    h.push(mk('e'));
    assert.equal(h.canRedo, false, 'a new entry clears redo');
    h.clear();
    assert.equal(h.canUndo, false);
    // Entries without redo (deletes) never reach the redo stack.
    h.push({ label: 'Deleted f1', undo: () => true });
    h.undo();
    assert.equal(h.canRedo, false);
});

test('locks at prepare time: an axis-range slider, a derived tangent point', () => {
    const json = chartJson({
        view: [-3, 3, -4, 4],
        functions: [{ expression: 'x^3 - 3x', tangent: true, tangentPoint: 'c' }],
        parameters: [{ name: 'c', value: 1, min: 0, max: 3, step: 0.1 }],
    });
    json.xmax = 'c + 2';
    const chart = makeChart(json);
    assert.ok(chart.ctx.axisSliders.has('c'));
    const t = resolveTarget(hitByKey(chart.ctx, '0#tangent'), chart.ctx);
    assert.equal(t.lock, null);
    const p = prepareDrag(t, t.points[0], 'move', chart.ctx);
    assert.ok('lock' in p);
    assert.equal((p as { lock: { title: string } }).lock.title, 'c also sets the axis range');

    const derived = makeChart(
        chartJson({
            view: [-3, 3, -4, 4],
            functions: [{ expression: 'x^3 - 3x', tangent: true, tangentPoint: 'P1_x' }],
            tools: [pointsTool('t0', 'P1', { points: '(1, 2)' })],
        })
    );
    const dt = resolveTarget(hitByKey(derived.ctx, '0#tangent'), derived.ctx);
    assert.equal(dt.lock?.title, 'The tangent of f1 follows P1_x');
    assert.equal(dt.lock?.detail, 'P1 computes it');
});

test('hover chip of a graph Move names the inserted shift and offset; Shift on the LP objective names the twin', () => {
    const chart = makeChart(chartJson({ view: [-1, 7, -2, 2.5], functions: [{ expression: 'sin(x)' }] }));
    const t = resolveTarget(hitByKey(chart.ctx, 'fn:f1#curve', { x: Math.PI / 2, y: 1 }), chart.ctx);
    const p = prepared(chart.ctx, t, { x: Math.PI / 2, y: 1 }, 'move');
    assert.deepEqual(p.info.virtualKinds.slice().sort(), ['add', 'shiftVar']);
    assert.equal(p.chip.note, 'Adds a shift and an offset');
    const lp = example('lp');
    const c1 = resolveTarget(hitByKey(lp.ctx, 't1#level:0', { x: 1.5, y: 2 }), lp.ctx);
    const move = prepared(lp.ctx, c1, { x: 1.5, y: 2 }, 'move');
    assert.deepEqual(move.info.twins, [], 'a Move only changes c: the objective text stays');
    const turn = prepared(lp.ctx, c1, { x: 1.5, y: 2 }, 'pivot');
    assert.deepEqual(turn.info.twins, ['P1']);
});
