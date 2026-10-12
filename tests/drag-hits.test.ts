/*
 * Hit index of drag to edit (src/drag/hits.ts, SPEC3 4.6): keys and layers,
 * pick priorities (draggable markers, lines, locked markers passed through),
 * tolerances in px under unequal axis scales, clipping to the view, ties by
 * layer, byKey after a rebuild and the pick budget.
 */
import { test, assert, near } from './_lib';
import { MathContext } from '../src/mathcontext';
import { EXAMPLES, migrateSettings } from '../src/migrate';
import { Pt, View } from '../src/geometry';
import { HandlePrim, SceneItem2D, computeScene2D } from '../src/scene';
import type { DrawnCurve } from '../src/renderer';
import { buildHitIndex, partKey } from '../src/drag/hits';
import type { HitTolerance, ScreenMap } from '../src/drag/types';
import { AxisStyle, FunctionParameters, Parameter, Tool } from '../src/types';

const MOUSE: HitTolerance = { line: 6, point: 9 };

/** A plot of w x h CSS px showing `view`. */
function mapOf(view: View, w: number, h: number): ScreenMap {
    return { view, kx: w / (view.xmax - view.xmin), ky: h / (view.ymax - view.ymin) };
}

function toolItem(key: string, source: string, handles: HandlePrim[]): SceneItem2D {
    return { source, kind: 'tool', key, fills: [], strokes: [], guides: [], markers: [], braces: [], texts: [], handles };
}

function line(a: [number, number], b: [number, number]): Pt[] {
    return [
        { x: a[0], y: a[1] },
        { x: b[0], y: b[1] },
    ];
}

/** The LP example's scene items, as the preview draws them (600 x 480 px plot). */
function lpScene(): { items: SceneItem2D[]; map: ScreenMap } {
    const ex = EXAMPLES.find((e) => e.id === 'lp');
    if (!ex) throw new Error('lp example missing');
    const d = migrateSettings(JSON.parse(JSON.stringify(ex.data))) as Record<string, unknown>;
    const tools = d.tools as Tool[];
    const view = { xmin: Number(d.xmin), xmax: Number(d.xmax), ymin: Number(d.ymin), ymax: Number(d.ymax) };
    const math = MathContext.create({
        parameters: d.parameters as Parameter[],
        functions: d.functions as FunctionParameters[],
        variables: 'x, y',
        toolNames: tools.map((t) => t.name),
    });
    const s = computeScene2D({
        functions: d.functions as FunctionParameters[],
        tools,
        math,
        view,
        grid: { nx: 200, ny: 180 },
        axisStyle: d.axis_style as AxisStyle,
        polar: false,
    });
    return { items: s.items, map: mapOf(view, 600, 480) };
}

// ------------------------------------------------------------------ keys

test('partKey of every part', () => {
    assert.equal(partKey({ part: 'curve' }), 'curve');
    assert.equal(partKey({ part: 'clause', entry: 1, disjunct: 0, clause: 2 }), 'clause:1:0:2');
    assert.equal(partKey({ part: 'level', index: 2, item: 5 }), 'level:2');
    assert.equal(partKey({ part: 'point', index: 0, item: -1 }), 'point:0');
    assert.equal(partKey({ part: 'leg', index: 1 }), 'leg:1');
    assert.equal(partKey({ part: 'vertex', index: 3, item: 3 }), 'vertex:3');
    assert.equal(partKey({ part: 'tangent' }), 'tangent');
    assert.equal(partKey({ part: 'extremum', index: 0 }), 'extremum:0');
});

test('LP: keys, layers, points(), all() and byKey', () => {
    const { items } = lpScene();
    const hits = buildHitIndex({ items, curves: [] });
    assert.deepEqual(
        hits.all().map((s) => s.key),
        ['t0#clause:0:0:0', 't0#clause:1:0:0', 't0#clause:2:0:0', 't0#clause:3:0:0', 't1#level:0', 't2#point:0', 't2#point:1', 't2#point:2', 't2#point:3', 't3#point:0']
    );
    const r1 = hits.byKey('t0#clause:1:0:0');
    assert.ok(r1);
    assert.equal(r1.source, 'R1');
    assert.equal(r1.itemKey, 't0');
    assert.equal(r1.kind, 'tool');
    assert.equal(r1.layer, 500);
    assert.equal(r1.point, null);
    assert.equal(r1.locked, null);
    assert.equal(r1.anchors.length, 2);
    assert.equal(hits.byKey('t1#level:0')?.layer, 501);
    assert.equal(hits.byKey('t2#point:0')?.layer, 602);
    assert.equal(hits.byKey('t3#point:0')?.layer, 603);
    assert.equal(hits.byKey('t3#point:0')?.locked, 'optimum');
    assert.equal(hits.byKey('nope'), null);
    assert.deepEqual(
        hits.points().map((s) => s.key),
        ['t2#point:0', 't2#point:1', 't2#point:2', 't2#point:3', 't3#point:0']
    );
});

test('function curves: key fn:<name>#curve, layer 400 + index, decorations keep their item key', () => {
    const curves: DrawnCurve[] = [
        { name: 'f1', index: 0, kind: 'cartesian', lines: [line([0, 0], [1, 1])] },
        { name: 'f3', index: 2, kind: 'polar', lines: [line([0, 1], [1, 0])] },
    ];
    const deco: SceneItem2D = {
        ...toolItem('0', 'f1', [{ ref: { part: 'tangent' }, point: { x: 0.5, y: 0.5 }, lines: [line([0, -0.5], [1, 1.5])] }]),
        kind: 'function',
    };
    const hits = buildHitIndex({ items: [deco], curves });
    assert.deepEqual(
        hits.all().map((s) => [s.key, s.itemKey, s.source, s.kind, s.layer]),
        [
            ['fn:f1#curve', 'fn:f1', 'f1', 'function', 400],
            ['fn:f3#curve', 'fn:f3', 'f3', 'function', 402],
            ['0#tangent', '0', 'f1', 'function', 600],
        ]
    );
    assert.deepEqual(hits.byKey('fn:f3#curve')?.part, { part: 'curve' });
});

// ------------------------------------------------------------- priorities

test('pick: a draggable marker beats the line it sits on; nothing in range gives null', () => {
    const view = { xmin: 0, xmax: 10, ymin: 0, ymax: 10 };
    const map = mapOf(view, 500, 500);
    const items = [
        toolItem('t0', 'C1', [{ ref: { part: 'level', index: 0, item: -1 }, lines: [line([0, 5], [10, 5])] }]),
        toolItem('t1', 'P1', [{ ref: { part: 'point', index: 0, item: 0 }, point: { x: 4, y: 5 } }]),
    ];
    const hits = buildHitIndex({ items, curves: [] });
    const onPoint = hits.pick({ x: 4.1, y: 5 }, MOUSE, map);
    assert.ok(onPoint);
    assert.equal(onPoint.shape.key, 't1#point:0');
    assert.equal(onPoint.run, -1);
    assert.deepEqual(onPoint.at, { x: 4, y: 5 });
    near(onPoint.distPx, 5, 1e-9);
    assert.equal(onPoint.passed, null);

    const onLine = hits.pick({ x: 6, y: 5.1 }, MOUSE, map);
    assert.ok(onLine);
    assert.equal(onLine.shape.key, 't0#level:0');
    assert.equal(onLine.run, 0);
    near(onLine.at.x, 6);
    near(onLine.at.y, 5);
    near(onLine.distPx, 5, 1e-9);

    assert.equal(hits.pick({ x: 6, y: 6 }, MOUSE, map), null);
});

test('pick: a locked marker is passed through to the line beneath, or is the hit when nothing else is near', () => {
    const { items, map } = lpScene();
    const hits = buildHitIndex({ items, curves: [] });
    // The optimum (3, 1) sits on the corner of clauses (1) and (2) and on C1; P2's corner is there too.
    const h = hits.pick({ x: 3.01, y: 1.01 }, MOUSE, map);
    assert.ok(h);
    assert.equal(h.shape.locked, null);
    assert.ok(h.shape.key.startsWith('t1#') || h.shape.key.startsWith('t0#clause:'), h.shape.key);
    assert.ok(h.passed);
    // Both locked markers are at the same spot: the one drawn on top (P1) is reported.
    assert.equal(h.passed.key, 't3#point:0');

    // Only a locked marker under the pointer: it is the hit (the host shows its lock and pans).
    const view = { xmin: 0, xmax: 10, ymin: 0, ymax: 10 };
    const lone = buildHitIndex({
        items: [
            toolItem('t0', 'R1', [{ ref: { part: 'clause', entry: 0, disjunct: 0, clause: 0 }, lines: [line([0, 0], [10, 0])] }]),
            toolItem('t2', 'P1', [{ ref: { part: 'point', index: 0, item: -1 }, point: { x: 5, y: 5 }, locked: 'intersection' }]),
        ],
        curves: [],
    });
    const m = mapOf(view, 500, 500);
    const locked = lone.pick({ x: 5.1, y: 5.1 }, MOUSE, m);
    assert.ok(locked);
    assert.equal(locked.shape.key, 't2#point:0');
    assert.equal(locked.shape.locked, 'intersection');
    assert.equal(locked.passed, null);
    assert.equal(locked.run, -1);
    // A draggable marker next to a locked one wins and reports it.
    const both = buildHitIndex({
        items: [
            toolItem('t1', 'P2', [{ ref: { part: 'point', index: 0, item: 0 }, point: { x: 5.12, y: 5 } }]),
            toolItem('t2', 'P1', [{ ref: { part: 'point', index: 0, item: -1 }, point: { x: 5, y: 5 }, locked: 'corner' }]),
        ],
        curves: [],
    });
    const free = both.pick({ x: 5.02, y: 5 }, MOUSE, m);
    assert.ok(free);
    assert.equal(free.shape.key, 't1#point:0');
    assert.equal(free.passed?.key, 't2#point:0');
});

test('pick: tolerances are screen px under unequal axis scales', () => {
    const view = { xmin: 0, xmax: 10, ymin: 0, ymax: 100 };
    // kx = 100 px per unit, ky = 10 px per unit.
    const map = mapOf(view, 1000, 1000);
    const hits = buildHitIndex({
        items: [
            toolItem('t0', 'C1', [{ ref: { part: 'level', index: 0, item: -1 }, lines: [line([0, 50], [10, 50])] }]),
            toolItem('t1', 'C2', [{ ref: { part: 'level', index: 0, item: -1 }, lines: [line([2, 0], [2, 100])] }]),
            toolItem('t2', 'P1', [{ ref: { part: 'point', index: 0, item: 0 }, point: { x: 8, y: 20 } }]),
        ],
        curves: [],
    });
    // Horizontal line y = 50: 0.5 units of y are 5 px, 0.7 units 7 px.
    assert.equal(hits.pick({ x: 6, y: 50.5 }, MOUSE, map)?.shape.key, 't0#level:0');
    assert.equal(hits.pick({ x: 6, y: 50.7 }, MOUSE, map), null);
    // Vertical line x = 2: 0.05 units of x are 5 px, 0.07 units 7 px.
    assert.equal(hits.pick({ x: 2.05, y: 30 }, MOUSE, map)?.shape.key, 't1#level:0');
    assert.equal(hits.pick({ x: 2.07, y: 30 }, MOUSE, map), null);
    // Marker: 8 px in x hits (tolerance 9), 9.5 px in y misses.
    assert.equal(hits.pick({ x: 8.08, y: 20 }, MOUSE, map)?.shape.key, 't2#point:0');
    assert.equal(hits.pick({ x: 8, y: 20.95 }, MOUSE, map), null);
    // Touch tolerances are wider.
    assert.equal(hits.pick({ x: 6, y: 51.2 }, { line: 14, point: 16 }, map)?.shape.key, 't0#level:0');

    // The nearest point is measured in px: the step (1, 1) in math is (100, 10) px here, so the
    // projection differs from the one in math units.
    const diag = buildHitIndex({ items: [toolItem('t0', 'S1', [{ ref: { part: 'leg', index: 0 }, lines: [line([0, 0], [1, 1])] }])], curves: [] });
    const h = diag.pick({ x: 0.5, y: 0.45 }, MOUSE, map);
    assert.ok(h);
    near(h.at.x, 5045 / 10100, 1e-12);
    near(h.at.y, 5045 / 10100, 1e-12);
    near(h.distPx, Math.hypot(50 - (100 * 5045) / 10100, 4.5 - (10 * 5045) / 10100), 1e-9);
});

test('pick: ties within 1 px go to the shape drawn on top, otherwise the nearest wins', () => {
    const view = { xmin: 0, xmax: 100, ymin: 0, ymax: 100 };
    const map = mapOf(view, 100, 100);
    const twoLines = (y2: number) =>
        buildHitIndex({
            items: [
                toolItem('t0', 'R1', [{ ref: { part: 'clause', entry: 0, disjunct: 0, clause: 0 }, lines: [line([0, 50], [100, 50])] }]),
                toolItem('t1', 'C1', [{ ref: { part: 'level', index: 0, item: -1 }, lines: [line([0, y2], [100, y2])] }]),
            ],
            curves: [{ name: 'f1', index: 0, kind: 'cartesian', lines: [line([0, 47.5], [100, 47.5])] }],
        });
    // Pointer at y = 48: R1 2 px, C1 (y = 52.6) 4.6 px, f1 0.5 px. f1 is nearest by more than 1 px.
    assert.equal(twoLines(52.6).pick({ x: 50, y: 48 }, MOUSE, map)?.shape.key, 'fn:f1#curve');
    // Pointer at y = 48.6: f1 1.1 px, R1 1.4 px (tie, R1 drawn later), C1 at 49 is 0.4 px: C1 is on top and nearest.
    assert.equal(twoLines(49).pick({ x: 50, y: 48.6 }, MOUSE, map)?.shape.key, 't1#level:0');
    // Pointer at y = 49.6: R1 0.4 px, C1 (y = 51.2) 1.6 px: more than 1 px apart, R1 wins.
    assert.equal(twoLines(51.2).pick({ x: 50, y: 49.6 }, MOUSE, map)?.shape.key, 't0#clause:0:0:0');
    // C1 at y = 50.5 is 0.9 px away, 0.5 px farther than R1: a tie, C1 is drawn later.
    assert.equal(twoLines(50.5).pick({ x: 50, y: 49.6 }, MOUSE, map)?.shape.key, 't1#level:0');
    // Coincident markers: the later item wins.
    const pts = buildHitIndex({
        items: [
            toolItem('t0', 'P1', [{ ref: { part: 'point', index: 0, item: 0 }, point: { x: 50, y: 50 } }]),
            toolItem('t1', 'S1', [{ ref: { part: 'vertex', index: 2, item: 2 }, point: { x: 50, y: 50 } }]),
        ],
        curves: [],
    });
    assert.equal(pts.pick({ x: 51, y: 51 }, MOUSE, map)?.shape.key, 't1#vertex:2');
});

test('pick: only what is visible counts (clipped lines, markers inside the view)', () => {
    const view = { xmin: 0, xmax: 10, ymin: 0, ymax: 10 };
    const map = mapOf(view, 100, 100);
    const hits = buildHitIndex({
        items: [toolItem('t1', 'P1', [{ ref: { part: 'point', index: 0, item: 0 }, point: { x: 10.3, y: 5 } }])],
        // Curves are sampled a little beyond the view: that part is not drawn.
        curves: [{ name: 'f1', index: 0, kind: 'cartesian', lines: [line([-5, -5], [15, 15])] }],
    });
    assert.equal(hits.pick({ x: 10.3, y: 5 }, MOUSE, map), null);
    // Beyond the top-right corner, the nearest visible part is the corner itself (plus 1 px).
    assert.equal(hits.pick({ x: 10.5, y: 10.5 }, MOUSE, map)?.shape.key, 'fn:f1#curve');
    assert.equal(hits.pick({ x: 11.5, y: 11.5 }, MOUSE, map), null);
    const inside = hits.pick({ x: 5.3, y: 5 }, MOUSE, map);
    assert.ok(inside);
    near(inside.at.x, 5.15, 1e-12);
    near(inside.at.y, 5.15, 1e-12);
    // A marker exactly on the border is drawn (corners at xmin = 0) and can be hit.
    const border = buildHitIndex({ items: [toolItem('t1', 'P1', [{ ref: { part: 'point', index: 0, item: 0 }, point: { x: 0, y: 0 } }])], curves: [] });
    assert.equal(border.pick({ x: -0.3, y: 0.2 }, MOUSE, map)?.shape.key, 't1#point:0');
});

test('pick: runs, gaps and non-finite points', () => {
    const view = { xmin: 0, xmax: 10, ymin: -5, ymax: 5 };
    const map = mapOf(view, 100, 100);
    const runs: Pt[][] = [
        [
            { x: 0, y: 1 },
            { x: 2, y: 1 },
            { x: 3, y: NaN },
            { x: 4, y: 1 },
        ],
        line([6, -1], [10, -1]),
    ];
    const hits = buildHitIndex({ items: [], curves: [{ name: 'f1', index: 0, kind: 'cartesian', lines: runs }] });
    assert.equal(hits.pick({ x: 8, y: -1.2 }, MOUSE, map)?.run, 1);
    assert.equal(hits.pick({ x: 1, y: 1.2 }, MOUSE, map)?.run, 0);
    // The segments next to the NaN are not drawn.
    assert.equal(hits.pick({ x: 3, y: 1 }, MOUSE, map), null);
    // Degenerate maps and pointers never hit.
    assert.equal(hits.pick({ x: NaN, y: 1 }, MOUSE, map), null);
    assert.equal(hits.pick({ x: 1, y: 1 }, MOUSE, { view, kx: 0, ky: 10 }), null);
});

test('pick: the tangent handle is hit at its point first, then along its line', () => {
    const view = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
    const map = mapOf(view, 600, 600);
    const deco: SceneItem2D = {
        ...toolItem('0', 'f1', [{ ref: { part: 'tangent' }, point: { x: 1, y: 0 }, lines: [line([-0.5, -3], [2.5, 3])] }]),
        kind: 'function',
    };
    const hits = buildHitIndex({ items: [deco], curves: [{ name: 'f1', index: 0, kind: 'cartesian', lines: [line([-3, 0], [3, 0])] }] });
    const atPoint = hits.pick({ x: 1.02, y: 0.03 }, MOUSE, map);
    assert.equal(atPoint?.shape.key, '0#tangent');
    assert.equal(atPoint?.run, -1);
    const onLine = hits.pick({ x: 2, y: 2.01 }, MOUSE, map);
    assert.equal(onLine?.shape.key, '0#tangent');
    assert.equal(onLine?.run, 0);
});

test('byKey re-resolves after a rebuild; vanished parts are gone', () => {
    const a = buildHitIndex({
        items: [toolItem('t0', 'S1', [{ ref: { part: 'vertex', index: 1, item: 1 }, point: { x: 1, y: 1 } }])],
        curves: [{ name: 'f1', index: 0, kind: 'cartesian', lines: [line([0, 0], [1, 1])] }],
    });
    const b = buildHitIndex({
        items: [toolItem('t0', 'S1', [{ ref: { part: 'vertex', index: 1, item: 1 }, point: { x: 2, y: 3 } }])],
        curves: [],
    });
    assert.deepEqual(a.byKey('t0#vertex:1')?.point, { x: 1, y: 1 });
    assert.deepEqual(b.byKey('t0#vertex:1')?.point, { x: 2, y: 3 });
    assert.ok(a.byKey('fn:f1#curve'));
    assert.equal(b.byKey('fn:f1#curve'), null);
});

// ------------------------------------------------------------- budget

test('pick over 20k segments stays under 1 ms', () => {
    const view = { xmin: 0, xmax: 10, ymin: -10, ymax: 10 };
    const map = mapOf(view, 800, 600);
    const curves: DrawnCurve[] = [];
    // 40 curves of 500 segments each, all crossing the view.
    for (let k = 0; k < 40; k++) {
        const pts: Pt[] = [];
        for (let i = 0; i <= 500; i++) {
            const x = (i / 500) * 10;
            pts.push({ x, y: 8 * Math.sin(x * (1 + k / 10) + k) });
        }
        curves.push({ name: `f${k + 1}`, index: k, kind: 'cartesian', lines: [pts] });
    }
    const items: SceneItem2D[] = [];
    for (let k = 0; k < 20; k++) {
        const handles: HandlePrim[] = [];
        for (let i = 0; i < 10; i++) handles.push({ ref: { part: 'point', index: i, item: i }, point: { x: (k + i) % 10, y: i - 5 } });
        items.push(toolItem(`t${k}`, `P${k + 1}`, handles));
    }
    const hits = buildHitIndex({ items, curves });
    // First pick builds the line prefilter.
    hits.pick({ x: 5, y: 0 }, MOUSE, map);
    let seed = 7;
    const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    const queries: Pt[] = [];
    for (let i = 0; i < 2000; i++) queries.push({ x: rnd() * 10, y: -10 + rnd() * 20 });
    let found = 0;
    const t0 = performance.now();
    for (const q of queries) if (hits.pick(q, MOUSE, map)) found++;
    const per = (performance.now() - t0) / queries.length;
    assert.ok(found > 0, 'some picks hit');
    assert.ok(per < 1, `pick took ${per.toFixed(3)} ms`);
    console.log(`    pick over 20k segments: ${(per * 1000).toFixed(1)} us per pick (${found} of ${queries.length} hit)`);
});
