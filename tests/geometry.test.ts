import { test, assert, near } from './_lib';
import {
    Constraint,
    ConstraintSet,
    Pt,
    RegionResult,
    View,
    clipLineToView,
    clipPolylineToView,
    computeContours,
    computeRegion,
    crossingsAlongPolylines,
    evalConstraintSet,
    feasibleBeyondView,
    findCrossings,
    insideTol,
    intersectLines,
    labelPoint,
    latticePoints,
    optimizeOverRegion,
    pointInRings,
    ringArea,
    simplifyPolyline,
} from '../src/geometry';

// ----------------------------------------------------------------- helpers

let nextId = 1;
/** a x + b y + c <= 0 with its exact affine form. */
function lin(a: number, b: number, c: number): Constraint {
    return { id: nextId++, g: (x, y) => a * x + b * y + c, affine: { a, b, c } };
}
/** Same constraint, but without the affine form (forces the marching-squares path). */
function opaque(c: Constraint): Constraint {
    return { id: c.id, g: c.g, affine: null };
}
function nl(g: (x: number, y: number) => number): Constraint {
    return { id: nextId++, g, affine: null };
}
function all(...cs: Constraint[]): ConstraintSet {
    return { entries: cs.map((c) => ({ disjuncts: [[c]] })) };
}
/** Even-odd area of a region (outer rings CCW positive, holes CW negative). */
function area(r: RegionResult): number {
    return r.rings.reduce((s, ring) => s + ringArea(ring), 0);
}
function hasPoint(pts: Pt[], x: number, y: number, tol: number): boolean {
    return pts.some((p) => Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol);
}
function median(xs: number[]): number {
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}

/** The textbook LP: x + y <= 4, x + 3y <= 6, x >= 0, y >= 0. */
function lp(): { c1: Constraint; c2: Constraint; cx: Constraint; cy: Constraint } {
    return { c1: lin(1, 1, -4), c2: lin(1, 3, -6), cx: lin(-1, 0, 0), cy: lin(0, -1, 0) };
}
const LP_VIEW: View = { xmin: 0, xmax: 5, ymin: 0, ymax: 4.5 };
const GRID = { nx: 200, ny: 200 };

// ------------------------------------------------------------------ regions

test('LP exact path: vertices, tags, boundary on the view border', () => {
    const { c1, c2, cx, cy } = lp();
    const r = computeRegion(all(c1, c2, cx, cy), LP_VIEW, GRID);
    assert.equal(r.empty, false);
    assert.equal(r.exact, true);
    assert.equal(r.rings.length, 1);
    assert.ok(ringArea(r.rings[0]) > 0, 'outer ring is CCW');
    near(area(r), 5, 1e-9, 'area');
    assert.equal(r.vertices.length, 4);
    const expect: Array<[number, number, number, number]> = [
        [0, 0, cx.id, cy.id],
        [4, 0, cy.id, c1.id],
        [3, 1, c1.id, c2.id],
        [0, 2, c2.id, cx.id],
    ];
    for (const [x, y, a, b] of expect) {
        const v = r.vertices.find((p) => Math.abs(p.x - x) <= 1e-9 && Math.abs(p.y - y) <= 1e-9);
        assert.ok(v, `vertex (${x}, ${y})`);
        assert.deepEqual(v.tags.slice().sort(), [a, b].sort(), `tags of (${x}, ${y})`);
    }
    const tags = r.boundary.map((b) => b.tag).sort();
    assert.deepEqual(tags, [c1.id, c2.id, cx.id, cy.id].sort(), 'every constraint has a boundary run');
    const left = r.boundary.find((b) => b.tag === cx.id);
    assert.ok(left && left.line.every((p) => p.x === 0), 'x >= 0 run lies on the left border');
    assert.ok(r.tags[0].every((t) => t !== 'view'), 'no view edges: the view border is x >= 0 / y >= 0');
    assert.deepEqual(r.components, [{ outer: 0, holes: [] }]);
});

test('LP through marching squares matches the exact vertices and area', () => {
    const { c1, c2, cx, cy } = lp();
    const exact = computeRegion(all(c1, c2, cx, cy), LP_VIEW, GRID);
    const ms = computeRegion(all(opaque(c1), c2, cx, cy), LP_VIEW, GRID);
    assert.equal(ms.exact, false);
    assert.equal(ms.vertices.length, 4, 'four corners');
    for (const v of exact.vertices) {
        assert.ok(hasPoint(ms.vertices, v.x, v.y, 1e-6), `vertex (${v.x}, ${v.y})`);
        const m = ms.vertices.find((p) => Math.abs(p.x - v.x) <= 1e-6 && Math.abs(p.y - v.y) <= 1e-6);
        assert.deepEqual(m && m.tags.slice().sort(), v.tags.slice().sort(), 'same tags');
    }
    assert.ok(Math.abs(area(ms) - 5) / 5 < 0.005, `area ${area(ms)}`);
    assert.ok(ringArea(ms.rings[0]) > 0, 'CCW');
    const tags = new Set(ms.boundary.map((b) => b.tag));
    assert.ok(tags.has(cx.id) && tags.has(cy.id), 'border-coincident constraints are boundary runs');
    const left = ms.boundary.find((b) => b.tag === cx.id);
    assert.ok(left && left.line.length === 2, 'straight border run collapsed to its end points');
});

test('disc area at 200 x 200', () => {
    const r = computeRegion(all(nl((x, y) => x * x + y * y - 4)), { xmin: -3, xmax: 3, ymin: -3, ymax: 3 }, GRID);
    assert.equal(r.rings.length, 1);
    assert.ok(Math.abs(area(r) - 4 * Math.PI) / (4 * Math.PI) < 0.005, `area ${area(r)}`);
    assert.equal(r.vertices.length, 0);
    assert.equal(r.boundary.length, 1);
    const line = r.boundary[0].line;
    assert.ok(samePt(line[0], line[line.length - 1]), 'closed boundary loop repeats its first point');
    assert.ok(r.tags[0].every((t) => t !== 'view'));
});

test('annulus: one component with one hole', () => {
    const r = computeRegion(
        all(nl((x, y) => 1 - x * x - y * y), nl((x, y) => x * x + y * y - 4)),
        { xmin: -3, xmax: 3, ymin: -3, ymax: 3 },
        GRID
    );
    assert.equal(r.rings.length, 2);
    assert.equal(r.components.length, 1);
    assert.equal(r.components[0].holes.length, 1);
    const outer = r.rings[r.components[0].outer];
    const hole = r.rings[r.components[0].holes[0]];
    assert.ok(ringArea(outer) > 0 && ringArea(hole) < 0, 'outer CCW, hole CW');
    assert.ok(Math.abs(area(r) - 3 * Math.PI) / (3 * Math.PI) < 0.01, `area ${area(r)}`);
    assert.ok(!pointInRings({ x: 0, y: 0 }, r.rings), 'centre is in the hole');
    assert.ok(pointInRings({ x: 1.5, y: 0 }, r.rings));
});

test('L-shape via OR', () => {
    const box = (x0: number, x1: number, y0: number, y1: number): Constraint[] => [
        lin(-1, 0, x0),
        lin(1, 0, -x1),
        lin(0, -1, y0),
        lin(0, 1, -y1),
    ];
    const set: ConstraintSet = { entries: [{ disjuncts: [box(0, 2, 0, 1), box(0, 1, 0, 2)] }] };
    const r = computeRegion(set, { xmin: -0.5, xmax: 2.5, ymin: -0.5, ymax: 2.5 }, GRID);
    assert.equal(r.exact, false);
    assert.ok(Math.abs(area(r) - 3) / 3 < 0.01, `area ${area(r)}`);
    for (const [x, y] of [
        [0, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 2],
        [0, 2],
    ]) {
        assert.ok(hasPoint(r.vertices, x, y, 1e-6), `corner (${x}, ${y})`);
    }
    assert.ok(pointInRings({ x: 0.5, y: 1.5 }, r.rings) && !pointInRings({ x: 1.5, y: 1.5 }, r.rings));
});

test('empty regions (exact and marching squares)', () => {
    const view: View = { xmin: 0, xmax: 5, ymin: 0, ymax: 5 };
    const a = computeRegion(all(lin(1, 0, 1)), view, GRID);
    assert.equal(a.empty, true);
    assert.equal(a.exact, true);
    assert.equal(a.rings.length, 0);
    const b = computeRegion(all(nl((x, y) => x * x + y * y + 1)), view, GRID);
    assert.equal(b.empty, true);
    const c = computeRegion(all(lin(1, 0, -2), lin(-1, 0, 3)), view, GRID);
    assert.equal(c.empty, true, 'x <= 2 and x >= 3');
    const d = computeRegion(all(lin(1, 0, -1)), { xmin: 1, xmax: 0, ymin: 0, ymax: 1 }, GRID);
    assert.equal(d.empty, true, 'degenerate view');
});

test('no constraints: the whole view', () => {
    const view: View = { xmin: -1, xmax: 2, ymin: 0, ymax: 3 };
    const r = computeRegion({ entries: [] }, view, GRID);
    assert.equal(r.empty, false);
    assert.equal(r.exact, true);
    assert.equal(r.rings.length, 1);
    near(area(r), 9, 1e-12);
    assert.ok(r.tags[0].every((t) => t === 'view'));
    assert.equal(r.boundary.length, 0);
    assert.equal(r.vertices.length, 0);
});

test('y >= x^2 and y <= 2: corners at (+-sqrt 2, 2)', () => {
    const r = computeRegion(all(nl((x, y) => x * x - y), lin(0, 1, -2)), { xmin: -3, xmax: 3, ymin: -1, ymax: 3 }, GRID);
    assert.equal(r.vertices.length, 2);
    assert.ok(hasPoint(r.vertices, Math.SQRT2, 2, 1e-6), 'right corner');
    assert.ok(hasPoint(r.vertices, -Math.SQRT2, 2, 1e-6), 'left corner');
    const exactArea = (4 / 3) * 2 * Math.SQRT2;
    assert.ok(Math.abs(area(r) - exactArea) / exactArea < 0.005, `area ${area(r)}`);
});

test('sliver tip: y >= x^2 and y <= x keep both corners and the full lens', () => {
    // At (1, 1) the boundaries meet at about 18 degrees: marching squares cuts
    // the tip off a few cells early, the corner must still be found.
    for (const n of [50, 150, 225]) {
        const a = nl((x, y) => x * x - y);
        const b = lin(-1, 1, 0);
        const r = computeRegion(all(a, b), { xmin: -1, xmax: 2, ymin: -1, ymax: 2 }, { nx: n, ny: n });
        assert.equal(r.vertices.length, 2, `n = ${n}: ${JSON.stringify(r.vertices)}`);
        assert.ok(hasPoint(r.vertices, 0, 0, 1e-6) && hasPoint(r.vertices, 1, 1, 1e-6), `n = ${n}`);
        assert.ok(Math.abs(area(r) - 1 / 6) / (1 / 6) < 0.005, `n = ${n}: area ${area(r)}`);
    }
});

test('corner within a cell of the view border', () => {
    // y >= 1.5 - 2x + 0.1x^2 and y >= 1.45 - 0.2x meet 0.28 cells right of xmin = 0.
    const a = nl((x, y) => 1.5 - 2 * x + 0.1 * x * x - y);
    const b = lin(-0.2, -1, 1.45);
    const r = computeRegion(all(a, b), { xmin: 0, xmax: 2, ymin: 0, ymax: 2 }, { nx: 20, ny: 20 });
    const cx = (1.8 - Math.sqrt(3.22)) / 0.2;
    const v = r.vertices.find((p) => Math.abs(p.x - cx) <= 1e-6 && Math.abs(p.y - (1.45 - 0.2 * cx)) <= 1e-6);
    assert.ok(v, JSON.stringify(r.vertices));
    assert.deepEqual(v.tags.slice().sort(), [a.id, b.id].sort());
});

test('corner of constraints with very different gradients', () => {
    // A shallow line and a steep sine (|grad| ratio about 6): comparing raw g
    // values switches the edge tag cells after the corner, too far for Newton.
    const a = lin(0.0064, -0.5756, -0.6584);
    const b = nl((x, y) => 1.9363 * Math.sin(1.9396 * x) - 0.5068 - y);
    const r = computeRegion(all(a, b), { xmin: -3.81, xmax: 1.3, ymin: -1.93, ymax: 1.39 }, { nx: 150, ny: 150 });
    // Reference corner by bisection on the line / sine difference.
    const h = (x: number): number => (0.0064 * x - 0.6584) / 0.5756 - (1.9363 * Math.sin(1.9396 * x) - 0.5068);
    let lo = -3.6;
    let hi = -3.3;
    for (let i = 0; i < 80; i++) {
        const m = 0.5 * (lo + hi);
        if (h(m) < 0 === h(lo) < 0) lo = m;
        else hi = m;
    }
    const cy = (0.0064 * lo - 0.6584) / 0.5756;
    assert.ok(hasPoint(r.vertices, lo, cy, 1e-6), `(${lo}, ${cy}) in ${JSON.stringify(r.vertices)}`);
});

test('nearly coincident constraints add no vertices', () => {
    const view: View = { xmin: 0, xmax: 5, ymin: 0, ymax: 4 };
    const a = lin(1, 0, -4);
    const b = lin(1, 0, -4.0000001);
    const cy = lin(0, -1, 0);
    const cx = lin(-1, 0, 0);
    const exact = computeRegion(all(a, b, cx, cy), view, GRID);
    assert.equal(exact.vertices.length, 2, 'exact: (0, 0) and (4, 0)');
    const reversed = computeRegion(all(b, a, cx, cy), view, GRID);
    assert.equal(reversed.vertices.length, 2, 'exact, reversed order');
    const ms = computeRegion(all(opaque(a), opaque(b), cx, cy), view, GRID);
    assert.equal(ms.vertices.length, 2, `marching squares: ${JSON.stringify(ms.vertices)}`);
    assert.ok(hasPoint(ms.vertices, 4, 0, 1e-6) && hasPoint(ms.vertices, 0, 0, 1e-9));
});

test('non-finite constraint values count as outside', () => {
    const r = computeRegion(all(nl((x, y) => y - Math.sqrt(x))), { xmin: -2, xmax: 4, ymin: -1, ymax: 3 }, GRID);
    assert.equal(r.empty, false);
    assert.ok(!pointInRings({ x: -1, y: -0.5 }, r.rings), 'x < 0 is outside (sqrt is NaN)');
    assert.ok(pointInRings({ x: 2, y: 0.5 }, r.rings));
    // Area of { 0 <= x <= 4, -1 <= y <= sqrt(x) } = 4 + (2/3) * 8.
    const expect = 4 + 16 / 3;
    assert.ok(Math.abs(area(r) - expect) / expect < 0.01, `area ${area(r)}`);
});

test('evalConstraintSet: max / min / max structure, non-finite disjuncts are false', () => {
    const a = lin(1, 0, -1);
    const b = lin(0, 1, -1);
    const bad = nl(() => NaN);
    const set: ConstraintSet = { entries: [{ disjuncts: [[a], [b]] }, { disjuncts: [[lin(-1, 0, -10)]] }] };
    near(evalConstraintSet(set, 3, 0), -1, 0, 'min over disjuncts');
    near(evalConstraintSet(set, 3, 5), 2, 0);
    assert.equal(evalConstraintSet({ entries: [{ disjuncts: [[bad], [a]] }] }, 3, 0), 2);
    assert.equal(evalConstraintSet({ entries: [{ disjuncts: [[bad]] }] }, 0, 0), Infinity);
    assert.equal(evalConstraintSet({ entries: [] }, 0, 0), -Infinity);
});

test('insideTol and lattice float noise', () => {
    const c = lin(0.1, 0.2, -0.3);
    near(insideTol(c, LP_VIEW), 1e-9 * (0.1 * 5 + 0.2 * 4.5 + 0.3) + 1e-12, 1e-24);
    const pts = latticePoints(all(c), { xmin: 0, xmax: 3, ymin: 0, ymax: 3 }).points;
    assert.ok(hasPoint(pts, 1, 1, 0), '(1, 1) with g = 5.6e-17 is inside');
    assert.ok(hasPoint(pts, 3, 0, 0) && !hasPoint(pts, 2, 1, 0));
});

// ------------------------------------------------------------ optimisation

test('LP optimum is exact; alternative optima return both ends of the edge', () => {
    const { c1, c2, cx, cy } = lp();
    const set = all(c1, c2, cx, cy);
    const r = computeRegion(set, LP_VIEW, GRID);
    const o = optimizeOverRegion((x, y) => 2 * x + 3 * y, { a: 2, b: 3, c: 0 }, r, set, LP_VIEW, GRID, 'max');
    assert.equal(o.status, 'optimal');
    assert.equal(o.points.length, 1);
    near(o.points[0].x, 3, 1e-12);
    near(o.points[0].y, 1, 1e-12);
    near(o.value, 9, 1e-12);
    const tie = optimizeOverRegion((x, y) => x + y, { a: 1, b: 1, c: 0 }, r, set, LP_VIEW, GRID, 'max');
    assert.equal(tie.status, 'optimal');
    assert.equal(tie.points.length, 2);
    assert.ok(hasPoint(tie.points, 4, 0, 1e-12) && hasPoint(tie.points, 3, 1, 1e-12));
    const min = optimizeOverRegion((x, y) => x + y, { a: 1, b: 1, c: 0 }, r, set, LP_VIEW, GRID, 'min');
    assert.equal(min.status, 'optimal', 'min at (0, 0) on the border constraints is a real optimum');
    assert.ok(hasPoint(min.points, 0, 0, 0));
});

test('LP optimum through marching squares', () => {
    const { c1, c2, cx, cy } = lp();
    const set = all(opaque(c1), c2, cx, cy);
    const r = computeRegion(set, LP_VIEW, GRID);
    const o = optimizeOverRegion((x, y) => 2 * x + 3 * y, { a: 2, b: 3, c: 0 }, r, set, LP_VIEW, GRID, 'max');
    assert.equal(o.status, 'optimal');
    assert.ok(hasPoint(o.points, 3, 1, 1e-6), JSON.stringify(o.points));
    near(o.value, 9, 1e-6);
    const tie = optimizeOverRegion((x, y) => x + y, { a: 1, b: 1, c: 0 }, r, set, LP_VIEW, GRID, 'max');
    assert.ok(hasPoint(tie.points, 4, 0, 1e-6) && hasPoint(tie.points, 3, 1, 1e-6), JSON.stringify(tie.points));
});

test('unbounded LP: max x + y over x, y >= 0, x + y >= 2', () => {
    const set = all(lin(-1, 0, 0), lin(0, -1, 0), lin(-1, -1, 2));
    const r = computeRegion(set, LP_VIEW, GRID);
    const o = optimizeOverRegion((x, y) => x + y, { a: 1, b: 1, c: 0 }, r, set, LP_VIEW, GRID, 'max');
    assert.equal(o.status, 'unbounded');
    assert.ok(hasPoint(o.points, 5, 4.5, 0), 'best visible point is the view corner');
    const min = optimizeOverRegion((x, y) => x + y, { a: 1, b: 1, c: 0 }, r, set, LP_VIEW, GRID, 'min');
    assert.equal(min.status, 'optimal', 'the minimum is attained on x + y = 2');
    near(min.value, 2, 1e-12);
    // Same through marching squares.
    const setMs = all(lin(-1, 0, 0), lin(0, -1, 0), nl((x, y) => 2 - x - y));
    const rMs = computeRegion(setMs, LP_VIEW, GRID);
    const oMs = optimizeOverRegion((x, y) => x + y, null, rMs, setMs, LP_VIEW, GRID, 'max');
    assert.equal(oMs.status, 'unbounded');
});

test('infeasible region gives status empty', () => {
    const set = all(lin(1, 1, -1), lin(-1, -1, 3));
    const r = computeRegion(set, LP_VIEW, GRID);
    assert.equal(r.empty, true);
    const o = optimizeOverRegion((x, y) => x, { a: 1, b: 0, c: 0 }, r, set, LP_VIEW, GRID, 'max');
    assert.equal(o.status, 'empty');
    assert.equal(o.points.length, 0);
});

test('max x y over x^2 + y^2 <= 2 is (1, 1) (and its twin (-1, -1))', () => {
    const set = all(nl((x, y) => x * x + y * y - 2));
    const view: View = { xmin: -2, xmax: 2, ymin: -2, ymax: 2 };
    const r = computeRegion(set, view, GRID);
    const o = optimizeOverRegion((x, y) => x * y, null, r, set, view, GRID, 'max');
    assert.equal(o.status, 'optimal');
    assert.ok(hasPoint(o.points, 1, 1, 1e-3), JSON.stringify(o.points));
    near(o.value, 1, 1e-6);
});

test('interior minimum of (x - 1)^2 + (y - 2)^2 over a big box', () => {
    const set = all(lin(-1, 0, -5), lin(1, 0, -5), lin(0, -1, -5), lin(0, 1, -5));
    const view: View = { xmin: -6, xmax: 6, ymin: -6, ymax: 6 };
    const r = computeRegion(set, view, GRID);
    const o = optimizeOverRegion((x, y) => (x - 1) ** 2 + (y - 2) ** 2, null, r, set, view, GRID, 'min');
    assert.equal(o.status, 'optimal');
    assert.equal(o.points.length, 1);
    near(o.points[0].x, 1, 1e-3);
    near(o.points[0].y, 2, 1e-3);
    near(o.value, 0, 1e-6);
});

test('nonlinear objective over an exact region: optimum in the middle of an edge', () => {
    // Cobb-Douglas utility on a budget set: max sqrt(x y) s.t. 2x + 3y <= 12 is at (3, 2).
    const set = all(lin(2, 3, -12), lin(-1, 0, 0), lin(0, -1, 0));
    const view: View = { xmin: 0, xmax: 7, ymin: 0, ymax: 5 };
    const r = computeRegion(set, view, GRID);
    const o = optimizeOverRegion((x, y) => Math.sqrt(x * y), null, r, set, view, GRID, 'max');
    assert.equal(o.status, 'optimal');
    assert.equal(o.points.length, 1);
    near(o.points[0].x, 3, 1e-6);
    near(o.points[0].y, 2, 1e-6);
    // min x^2 + y^2 s.t. x + 2y >= 4 touches the line at (0.8, 1.6).
    const set2 = all(lin(-1, -2, 4));
    const view2: View = { xmin: -1, xmax: 5, ymin: -1, ymax: 4 };
    const o2 = optimizeOverRegion((x, y) => x * x + y * y, null, computeRegion(set2, view2, GRID), set2, view2, GRID, 'min');
    near(o2.points[0].x, 0.8, 1e-6);
    near(o2.points[0].y, 1.6, 1e-6);
    near(o2.value, 3.2, 1e-9);
});

test('optimum on a curved boundary is feasible and exact', () => {
    // max 3x + 5y over y <= 4 - x^2, y >= 0: tangency at x = 0.3.
    const set = all(nl((x, y) => y - 4 + x * x), lin(0, -1, 0));
    const view: View = { xmin: -3, xmax: 3, ymin: -1, ymax: 5 };
    const r = computeRegion(set, view, { nx: 225, ny: 225 });
    const o = optimizeOverRegion((x, y) => 3 * x + 5 * y, { a: 3, b: 5, c: 0 }, r, set, view, { nx: 225, ny: 225 }, 'max');
    assert.equal(o.status, 'optimal');
    assert.equal(o.points.length, 1);
    near(o.points[0].x, 0.3, 1e-6);
    near(o.value, 20.45, 1e-9);
    assert.ok(evalConstraintSet(set, o.points[0].x, o.points[0].y) <= 1e-12, 'reported point satisfies the constraints');
    // Lens tip: max x over y >= x^2, y <= x is the corner (1, 1).
    const lens = all(nl((x, y) => x * x - y), lin(-1, 1, 0));
    const lv: View = { xmin: -1, xmax: 2, ymin: -1, ymax: 2 };
    const ol = optimizeOverRegion((x) => x, { a: 1, b: 0, c: 0 }, computeRegion(lens, lv, GRID), lens, lv, GRID, 'max');
    near(ol.value, 1, 1e-9);
});

test('nonlinear objective that improves beyond the view: optimum outside', () => {
    // Disc centred at (6, 0): the maximum of x^2 is (8, 0), beyond xmax = 5.
    const set = all(nl((x, y) => (x - 6) ** 2 + y * y - 4));
    const view: View = { xmin: 0, xmax: 5, ymin: -3, ymax: 3 };
    const r = computeRegion(set, view, GRID);
    const o = optimizeOverRegion((x) => x * x, null, r, set, view, GRID, 'max');
    assert.equal(o.status, 'outside');
    const m = optimizeOverRegion((x) => x * x, null, r, set, view, GRID, 'min');
    assert.equal(m.status, 'optimal');
    assert.ok(hasPoint(m.points, 4, 0, 1e-3), JSON.stringify(m.points));
});

// -------------------------------------------------------------- contours

test('contour of x^2 + y^2 = 4 is one closed loop of radius 2', () => {
    const view: View = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
    const [lines] = computeContours((x, y) => x * x + y * y, [4], view, GRID);
    assert.equal(lines.length, 1);
    const loop = lines[0];
    assert.ok(samePt(loop[0], loop[loop.length - 1]), 'closed loop repeats its first point');
    for (const p of loop) near(Math.hypot(p.x, p.y), 2, 2e-3);
});

test('contour of tan(x) - y = 0 has no segments through the poles', () => {
    const view: View = { xmin: -4, xmax: 4, ymin: -5, ymax: 5 };
    const [lines] = computeContours((x, y) => Math.tan(x) - y, [0], view, GRID);
    assert.equal(lines.length, 3, 'three branches');
    for (const line of lines) {
        for (const p of line) {
            assert.ok(Math.abs(Math.abs(p.x) - Math.PI / 2) > 0.1, `point near a pole: ${p.x}, ${p.y}`);
            assert.ok(Math.abs(Math.tan(p.x) - p.y) < 0.05, `point off the curve: ${p.x}, ${p.y}`);
        }
    }
});

test('contour of a step function has no segment along the jump', () => {
    // F = step(x) - y with the step at x = 1: the zero set is y = 0 (x < 1) and y = 1 (x >= 1).
    const F = (x: number, y: number): number => (x < 1 ? 0 : 1) - y;
    const [lines] = computeContours(F, [0], { xmin: 0, xmax: 2, ymin: -0.53, ymax: 1.47 }, { nx: 40, ny: 40 });
    assert.ok(lines.length >= 2);
    for (const line of lines) {
        for (const p of line) assert.ok(Math.abs(p.y) < 1e-9 || Math.abs(p.y - 1) < 1e-9, `point off the steps: ${p.x}, ${p.y}`);
    }
});

test('affine contour is one exact 2-point line', () => {
    const res = computeContours((x, y) => 2 * x + 3 * y, [12, 100], LP_VIEW, GRID, { a: 2, b: 3, c: 0 });
    assert.equal(res[0].length, 1);
    assert.equal(res[0][0].length, 2);
    const [p, q] = res[0][0];
    near(2 * p.x + 3 * p.y, 12, 1e-12);
    near(2 * q.x + 3 * q.y, 12, 1e-12);
    assert.ok(hasPoint(res[0][0], 0, 4, 1e-12) && hasPoint(res[0][0], 5, 2 / 3, 1e-12));
    assert.equal(res[1].length, 0, 'level outside the view');
});

test('contour on a grid line (x = 2 at a node column) is traced once', () => {
    const view: View = { xmin: 0, xmax: 4, ymin: 0, ymax: 4 };
    const [lines] = computeContours((x) => x, [2], view, { nx: 40, ny: 40 });
    assert.equal(lines.length, 1);
    assert.ok(lines[0].every((p) => p.x === 2));
    const ys = lines[0].map((p) => p.y).sort((a, b) => a - b);
    near(ys[0], 0, 0);
    near(ys[ys.length - 1], 4, 0);
});

test('computeContours samples F once for all levels', () => {
    let calls = 0;
    const F = (x: number, y: number): number => {
        calls++;
        return x * x + y * y;
    };
    const res = computeContours(F, [1, 2, 3, 4, 5], { xmin: -3, xmax: 3, ymin: -3, ymax: 3 }, { nx: 120, ny: 90 });
    assert.equal(calls, 121 * 91);
    assert.ok(res.every((lines) => lines.length === 1), 'one loop per level');
});

// ------------------------------------------------------- lattice / misc

test('latticePoints of the LP and the cap', () => {
    const { c1, c2, cx, cy } = lp();
    const set = all(c1, c2, cx, cy);
    const res = latticePoints(set, LP_VIEW);
    // y = 0: x = 0..4; y = 1: x = 0..3; y = 2: x = 0.
    assert.equal(res.points.length, 10);
    assert.equal(res.truncated, false);
    assert.ok(hasPoint(res.points, 3, 1, 0) && hasPoint(res.points, 0, 2, 0) && !hasPoint(res.points, 1, 2, 0));
    const ms = latticePoints(all(opaque(c1), c2, cx, cy), LP_VIEW);
    assert.equal(ms.points.length, 10, 'same without affine forms');
    const capped = latticePoints(set, LP_VIEW, 4);
    assert.equal(capped.points.length, 4);
    assert.equal(capped.truncated, true);
    const whole = latticePoints(null, { xmin: -0.5, xmax: 2.5, ymin: 0, ymax: 1 });
    assert.equal(whole.points.length, 6);
    const huge = latticePoints(null, { xmin: -1000, xmax: 1000, ymin: -1000, ymax: 1000 });
    assert.equal(huge.points.length, 2000);
    assert.equal(huge.truncated, true);
});

test('simplifyPolyline keeps endpoints and the keep set', () => {
    const view: View = { xmin: 0, xmax: 1000, ymin: 0, ymax: 1 };
    const pts: Pt[] = [];
    for (let i = 0; i <= 100; i++) pts.push({ x: i * 10, y: 0.5 + 1e-5 * Math.sin(i) });
    const s = simplifyPolyline(pts, view, 1e-3);
    assert.equal(s.length, 2, 'anisotropic view: tiny y wiggles vanish in normalized coordinates');
    const k = simplifyPolyline(pts, view, 1e-3, false, new Set([17, 60]));
    assert.deepEqual(k, [pts[0], pts[17], pts[60], pts[100]]);
    // A square with a slightly bent edge: corners survive.
    const sq: Pt[] = [
        { x: 0, y: 0 },
        { x: 500, y: 0.0001 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1 },
        { x: 0, y: 1 },
    ];
    const ring = simplifyPolyline(sq, view, 1e-3, true);
    assert.equal(ring.length, 4);
    assert.ok(ring[0] === sq[0]);
});

test('labelPoint lies inside a C-shaped region', () => {
    // C shape: [0, 3] x [0, 3] minus (1, 3] x (1, 2): the bbox centre (1.5, 1.5) is outside.
    const set: ConstraintSet = {
        entries: [
            { disjuncts: [[lin(-1, 0, 0)]] },
            { disjuncts: [[lin(0, -1, 0)]] },
            { disjuncts: [[lin(1, 0, -3)]] },
            { disjuncts: [[lin(0, 1, -3)]] },
            { disjuncts: [[lin(0, 1, -1)], [lin(0, -1, 2)], [lin(1, 0, -1)]] },
        ],
    };
    const view: View = { xmin: -0.5, xmax: 3.5, ymin: -0.5, ymax: 3.5 };
    const r = computeRegion(set, view, GRID);
    near(area(r), 9 - 2, 0.07);
    assert.equal(r.vertices.length, 8, JSON.stringify(r.vertices));
    assert.ok(!pointInRings({ x: 1.5, y: 1.5 }, r.rings));
    const p = labelPoint(r, view);
    assert.ok(p && pointInRings(p, r.rings), JSON.stringify(p));
    // The label sits clear of the boundary (the arms are 1 unit thick).
    const d = Math.min(p.x, 3 - p.x, p.y, 3 - p.y, Math.hypot(Math.max(0, 1 - p.x), Math.max(0, p.y - 2, 1 - p.y)));
    assert.ok(d > 0.3, `label too close to the boundary: ${JSON.stringify(p)}`);
    assert.equal(labelPoint(computeRegion(all(lin(1, 0, 10)), view, GRID), view), null);
});

test('labelPoint respects holes', () => {
    const view: View = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
    const r = computeRegion(all(nl((x, y) => 1 - x * x - y * y), nl((x, y) => x * x + y * y - 4)), view, GRID);
    const p = labelPoint(r, view);
    assert.ok(p && pointInRings(p, r.rings));
    near(Math.hypot(p.x, p.y), 1.5, 0.1);
});

test('labelPoint settles near-ties the same way at every grid size', () => {
    const grids = [
        { nx: 24, ny: 24 },
        { nx: 86, ny: 86 },
        { nx: 173, ny: 173 },
        { nx: 200, ny: 200 },
        { nx: 225, ny: 173 },
    ];
    const cases: Array<{ name: string; view: View; set: ConstraintSet }> = [
        {
            name: 'annulus 1 <= r <= 3',
            view: { xmin: -4, xmax: 4, ymin: -4, ymax: 4 },
            set: all(nl((x, y) => 1 - x * x - y * y), nl((x, y) => x * x + y * y - 9)),
        },
        {
            name: 'two equal disks',
            view: { xmin: -4, xmax: 4, ymin: -3, ymax: 3 },
            set: {
                entries: [{ disjuncts: [[nl((x, y) => (x + 2) ** 2 + y * y - 1)], [nl((x, y) => (x - 2) ** 2 + y * y - 1)]] }],
            },
        },
        {
            name: 'band sin(x) <= y <= sin(x) + 1',
            view: { xmin: -0.5, xmax: 10, ymin: -2, ymax: 3 },
            set: all(nl((x, y) => Math.sin(x) - y), nl((x, y) => y - Math.sin(x) - 1)),
        },
    ];
    for (const c of cases) {
        const spanX = c.view.xmax - c.view.xmin;
        const spanY = c.view.ymax - c.view.ymin;
        let first: Pt | null = null;
        for (const grid of grids) {
            const r = computeRegion(c.set, c.view, grid);
            const p = labelPoint(r, c.view);
            assert.ok(p && pointInRings(p, r.rings), `${c.name} at ${grid.nx}x${grid.ny}: ${JSON.stringify(p)}`);
            if (!first) {
                first = p;
                continue;
            }
            const moved = Math.hypot((p.x - first.x) / spanX, (p.y - first.y) / spanY);
            assert.ok(moved <= 0.05, `${c.name}: ${grid.nx}x${grid.ny} puts the label at ${JSON.stringify(p)}, 24x24 at ${JSON.stringify(first)}`);
        }
    }
});

test('findCrossings: roots of x^3 - x, poles rejected', () => {
    const roots = findCrossings((x) => x * x * x - x, -2, 2);
    assert.equal(roots.length, 3);
    near(roots[0], -1, 1e-12);
    near(roots[1], 0, 1e-12);
    near(roots[2], 1, 1e-12);
    assert.equal(findCrossings(Math.tan, 1, 2).length, 0, 'pole of tan at pi/2');
    assert.equal(findCrossings((x) => 1 / (x - 0.123456), -1, 1).length, 0, 'pole of 1/x');
    const r = findCrossings((x) => Math.sqrt(x) - 1, -1, 4);
    assert.equal(r.length, 1);
    near(r[0], 1, 1e-12);
    assert.equal(findCrossings((x) => (x < 0.3 ? -1 : 2), -1, 1).length, 0, 'a jump is no root');
    const cbrt = findCrossings((x) => Math.cbrt(x - 0.3), -1, 1);
    assert.equal(cbrt.length, 1, 'steep but continuous root');
    near(cbrt[0], 0.3, 1e-9);
    // A sample a hair away from the root still brackets it.
    const close = findCrossings((x) => x - 1e-15, -1, 1, 2);
    assert.equal(close.length, 1);
    near(close[0], 1e-15, 1e-15);
});

test('crossingsAlongPolylines', () => {
    const square: Pt[] = [
        { x: -2, y: -2 },
        { x: 2, y: -2 },
        { x: 2, y: 2 },
        { x: -2, y: 2 },
        { x: -2, y: -2 },
    ];
    const pts = crossingsAlongPolylines([square], (x, y) => x - y * 0.5);
    assert.equal(pts.length, 2);
    assert.ok(hasPoint(pts, -1, -2, 1e-12) && hasPoint(pts, 1, 2, 1e-12));
    const corner = crossingsAlongPolylines([square], (x, y) => x + y);
    assert.equal(corner.length, 2, 'exact zeros at shared vertices count once');
});

test('clipLineToView: hits, misses, border lines', () => {
    const view: View = { xmin: 0, xmax: 5, ymin: 0, ymax: 4.5 };
    const hit = clipLineToView(1, 3, -6, view);
    assert.ok(hit);
    assert.ok(hasPoint(hit, 0, 2, 1e-12) && hasPoint(hit, 5, 1 / 3, 1e-12));
    assert.equal(clipLineToView(1, 1, 20, view), null, 'misses');
    assert.equal(clipLineToView(0, 0, 1, view), null, 'a = b = 0');
    const border = clipLineToView(-1, 0, 0, view);
    assert.ok(border && border.every((p) => p.x === 0), 'x = 0 on the border');
    const steep = clipLineToView(1, -1e-9, -2.5, view);
    assert.ok(steep && steep.every((p) => Math.abs(p.x - 2.5) < 1e-6));
});

test('clipPolylineToView splits at the border and at non-finite points', () => {
    const view: View = { xmin: 0, xmax: 1, ymin: 0, ymax: 1 };
    const pieces = clipPolylineToView(
        [
            { x: -1, y: 0.5 },
            { x: 0.5, y: 0.5 },
            { x: 2, y: 0.5 },
            { x: 0.5, y: 0.25 },
            { x: 0.5, y: NaN },
            { x: 0.25, y: 0.25 },
            { x: 0.75, y: 0.75 },
        ],
        view
    );
    assert.equal(pieces.length, 3);
    assert.deepEqual(pieces[0], [
        { x: 0, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 0.5 },
    ]);
    assert.equal(pieces[1][0].x, 1);
    assert.deepEqual(pieces[2], [
        { x: 0.25, y: 0.25 },
        { x: 0.75, y: 0.75 },
    ]);
});

test('intersectLines and ringArea', () => {
    const p = intersectLines({ a: 1, b: 1, c: -4 }, { a: 1, b: 3, c: -6 });
    assert.ok(p);
    near(p.x, 3, 1e-12);
    near(p.y, 1, 1e-12);
    assert.equal(intersectLines({ a: 1, b: 2, c: 0 }, { a: 2, b: 4, c: 1 }), null);
    const sq: Pt[] = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
    ];
    near(ringArea(sq), 4, 0);
    near(ringArea(sq.slice().reverse()), -4, 0);
});

// ------------------------------------------------ review regressions (v4)

test('optimum status: an optimal edge or vertex cut by the view is still optimal', () => {
    // max x + y over x + y <= 5 in view 0..4: the value 5 is attained at (4, 1) and (1, 4).
    const set = all(lin(1, 1, -5), lin(-1, 0, 0), lin(0, -1, 0));
    const v4: View = { xmin: 0, xmax: 4, ymin: 0, ymax: 4 };
    const o = optimizeOverRegion((x, y) => x + y, { a: 1, b: 1, c: 0 }, computeRegion(set, v4, GRID), set, v4, GRID, 'max');
    assert.equal(o.status, 'optimal');
    near(o.value, 5, 1e-12);
    assert.ok(hasPoint(o.points, 4, 1, 1e-12) && hasPoint(o.points, 1, 4, 1e-12), JSON.stringify(o.points));
    // Same through marching squares: the probe across x = 4 must respect x + y <= 5.
    const setMs = all(nl((x, y) => x + y - 5), lin(-1, 0, 0), lin(0, -1, 0));
    const oMs = optimizeOverRegion((x, y) => x + y, null, computeRegion(setMs, v4, GRID), setMs, v4, GRID, 'max');
    assert.equal(oMs.status, 'optimal');
    near(oMs.value, 5, 1e-6);
    // Textbook LP with a tight view: (4, 3) on xmax = 4 is the real optimum of x + 2y.
    const tb = all(lin(1, 1, -7), lin(0, 1, -3), lin(-1, 0, 0), lin(0, -1, 0));
    const vt: View = { xmin: 0, xmax: 4, ymin: 0, ymax: 5 };
    const ot = optimizeOverRegion((x, y) => x + 2 * y, { a: 1, b: 2, c: 0 }, computeRegion(tb, vt, GRID), tb, vt, GRID, 'max');
    assert.equal(ot.status, 'optimal');
    assert.deepEqual(ot.points, [{ x: 4, y: 3 }]);
    near(ot.value, 10, 1e-12);
    // Disc x^2 + y^2 <= 8 cut by xmax = 2: max x + y is (2, 2), on the border and on the disc.
    const disc = all(nl((x, y) => x * x + y * y - 8));
    const vd: View = { xmin: -3, xmax: 2, ymin: -3, ymax: 3 };
    const od = optimizeOverRegion((x, y) => x + y, { a: 1, b: 1, c: 0 }, computeRegion(disc, vd, GRID), disc, vd, GRID, 'max');
    assert.equal(od.status, 'optimal');
    assert.ok(hasPoint(od.points, 2, 2, 1e-4), JSON.stringify(od.points));
});

test('optimum status: optimum outside the view versus unbounded', () => {
    // x <= 6, y <= 2 in view 0..5 x 0..4.5: the optimum (6, 2) lies outside.
    const set = all(lin(1, 0, -6), lin(0, 1, -2), lin(-1, 0, 0), lin(0, -1, 0));
    const r = computeRegion(set, LP_VIEW, GRID);
    const o = optimizeOverRegion((x, y) => x + y, { a: 1, b: 1, c: 0 }, r, set, LP_VIEW, GRID, 'max');
    assert.equal(o.status, 'outside');
    assert.ok(hasPoint(o.points, 5, 2, 1e-12), 'best visible point');
    // A nonlinear objective on the same exact region goes through the probes.
    const sq = optimizeOverRegion((x, y) => (x + y) ** 2, null, r, set, LP_VIEW, GRID, 'max');
    assert.equal(sq.status, 'outside');
    // The LP example with its first right-hand side raised to 6: optimum (6, 0), value 12.
    const raised = all(lin(1, 1, -6), lin(1, 3, -6), lin(-1, 0, 0), lin(0, -1, 0));
    const or = optimizeOverRegion((x, y) => 2 * x + 3 * y, { a: 2, b: 3, c: 0 }, computeRegion(raised, LP_VIEW, GRID), raised, LP_VIEW, GRID, 'max');
    assert.equal(or.status, 'outside');
    near(or.value, 11, 1e-12, 'best visible value at (5, 1/3)');
    // Unbounded stays unbounded on both paths (see 'unbounded LP' above).
    const ub = all(lin(-1, 0, 0), lin(0, -1, 0), lin(-1, -1, 2));
    const ou = optimizeOverRegion((x, y) => x + y, { a: 1, b: 1, c: 0 }, computeRegion(ub, LP_VIEW, GRID), ub, LP_VIEW, GRID, 'max');
    assert.equal(ou.status, 'unbounded');
});

test('feasibleBeyondView tells an off-view region from an infeasible one', () => {
    const v: View = { xmin: 0, xmax: 5, ymin: 0, ymax: 5 };
    const off = all(lin(-1, -1, 12), lin(1, 0, -8), lin(0, 1, -8));
    assert.equal(computeRegion(off, v, GRID).empty, true);
    assert.equal(feasibleBeyondView(off, v), true);
    const none = all(lin(1, 1, 1), lin(-1, 0, 0), lin(0, -1, 0));
    assert.equal(feasibleBeyondView(none, v), false);
    assert.equal(feasibleBeyondView(all(nl((x, y) => x * x + y * y + 1)), v), null, 'unknown for nonlinear sets');
});

test('lattice integer optimum scans every point (no 2000-point truncation)', () => {
    const set = all(lin(1, 2, -200), lin(3, 1, -250), lin(-1, 0, 0), lin(0, -1, 0));
    const view: View = { xmin: 0, xmax: 100, ymin: 0, ymax: 110 };
    const plain = latticePoints(set, view);
    assert.equal(plain.truncated, true, 'more than 2000 feasible points');
    const max = latticePoints(set, view, undefined, { select: { f: (x, y) => x + y, sense: 'max' } });
    assert.deepEqual(max.points, [{ x: 60, y: 70 }]);
    assert.equal(max.value, 130);
    assert.equal(max.truncated, false);
    assert.equal(max.count, 1);
    const min = latticePoints(set, view, undefined, { select: { f: (x, y) => x - 3 * y, sense: 'min' } });
    assert.deepEqual(min.points, [{ x: 0, y: 100 }]);
    assert.equal(min.value, -300);
    // Ties: max y over the triangle x + y <= 3 is the single top point; max of a constant ties everywhere.
    const tri = all(lin(1, 1, -3), lin(-1, 0, 0), lin(0, -1, 0));
    const tv: View = { xmin: 0, xmax: 4, ymin: 0, ymax: 4 };
    const flat = latticePoints(tri, tv, 3, { select: { f: () => 1, sense: 'max' } });
    assert.equal(flat.points.length, 3, 'at most cap ties are returned');
    assert.equal(flat.count, 10, 'all ties are counted');
    assert.equal(flat.inside, 10);
    // Non-affine: x^2 + y^2 <= 1200 in [-40, 40]^2 (more than 2000 points), max x + 2y = 77, three ways.
    const big = all(nl((x, y) => x * x + y * y - 1200));
    const o = latticePoints(big, { xmin: -40, xmax: 40, ymin: -40, ymax: 40 }, undefined, { select: { f: (x, y) => x + 2 * y, sense: 'max' } });
    assert.deepEqual(o.points, [
        { x: 17, y: 30 },
        { x: 15, y: 31 },
        { x: 13, y: 32 },
    ]);
    assert.equal(o.value, 77);
});

test('lattice bounds: a small nonlinear region in a huge view is scanned completely', () => {
    const set = all(nl((x, y) => x * x + y * y - 100));
    const view: View = { xmin: -1000, xmax: 1000, ymin: -1000, ymax: 1000 };
    const whole = latticePoints(set, view);
    assert.equal(whole.truncated, true, 'the whole-view scan runs out of budget');
    const bounds: View = { xmin: -11, xmax: 11, ymin: -11, ymax: 11 };
    const res = latticePoints(set, view, undefined, { bounds });
    assert.equal(res.truncated, false);
    assert.equal(res.points.length, 317);
    const o = latticePoints(set, view, undefined, { bounds, select: { f: (x, y) => x + y, sense: 'max' } });
    assert.equal(o.value, 14);
    assert.deepEqual(o.points, [
        { x: 8, y: 6 },
        { x: 7, y: 7 },
        { x: 6, y: 8 },
    ]);
});

test('exact corners do not depend on the grid (a short facet keeps its corner)', () => {
    const set = all(lin(1, 1, -4), lin(1, 3, -6), lin(1, 2, -4.99), lin(-1, 0, 0), lin(0, -1, 0));
    for (const grid of [{ nx: 50, ny: 45 }, { nx: 100, ny: 90 }, { nx: 200, ny: 200 }]) {
        const r = computeRegion(set, LP_VIEW, grid);
        assert.equal(r.vertices.length, 5, `grid ${grid.nx}x${grid.ny}`);
        assert.ok(hasPoint(r.vertices, 2.97, 1.01, 1e-9) && hasPoint(r.vertices, 3.01, 0.99, 1e-9));
    }
});

test('alternative optima of a nonlinear objective over a polygon are all reported', () => {
    const { c1, c2, cx, cy } = lp();
    const set = all(c1, c2, cx, cy);
    const r = computeRegion(set, LP_VIEW, GRID);
    // Constant along the optimal edge x + y = 4, but not affine.
    for (const f of [(x: number, y: number) => (x + y) ** 2, (x: number, y: number) => Math.min(x + y, 10)]) {
        const o = optimizeOverRegion(f, null, r, set, LP_VIEW, GRID, 'max');
        assert.equal(o.status, 'optimal');
        assert.ok(hasPoint(o.points, 4, 0, 1e-9) && hasPoint(o.points, 3, 1, 1e-9), JSON.stringify(o.points));
    }
    // min x y: both axis edges are optimal; the stretch ends and the corner between them are reported.
    const m = optimizeOverRegion((x, y) => x * y, null, r, set, LP_VIEW, GRID, 'min');
    assert.ok(hasPoint(m.points, 0, 2, 1e-9) && hasPoint(m.points, 4, 0, 1e-9) && hasPoint(m.points, 0, 0, 1e-9), JSON.stringify(m.points));
    // Square [0, 4]^2: the farthest points from its centre are its 4 corners.
    const sq = all(lin(-1, 0, 0), lin(1, 0, -4), lin(0, -1, 0), lin(0, 1, -4));
    const vs: View = { xmin: -1, xmax: 5, ymin: -1, ymax: 5 };
    const os = optimizeOverRegion((x, y) => (x - 2) ** 2 + (y - 2) ** 2, null, computeRegion(sq, vs, GRID), sq, vs, GRID, 'max');
    assert.equal(os.points.length, 4, JSON.stringify(os.points));
    // A hexagon with two separated optimal vertices.
    // Corners (1, 0), (3, 0), (5, 2), (3, 4), (1, 4), (-1, 2).
    const hex = all(lin(0, -1, 0), lin(0, 1, -4), lin(1, -1, -3), lin(1, 1, -7), lin(-1, 1, -3), lin(-1, -1, 1));
    const vh: View = { xmin: -2, xmax: 6, ymin: -1, ymax: 5 };
    const oh = optimizeOverRegion((x) => (x - 2) ** 2, null, computeRegion(hex, vh, GRID), hex, vh, GRID, 'max');
    assert.ok(hasPoint(oh.points, 5, 2, 1e-9) && hasPoint(oh.points, -1, 2, 1e-9) && oh.points.length === 2, JSON.stringify(oh.points));
});

test('contours of step functions have no connector along a jump at the view border', () => {
    const offLevel = (F: (x: number, y: number) => number, view: View): number => {
        const [lines] = computeContours(F, [0], view, { nx: 150, ny: 150 });
        let bad = 0;
        for (const l of lines) {
            for (let i = 1; i < l.length; i++) {
                const mx = (l[i - 1].x + l[i].x) / 2;
                const my = (l[i - 1].y + l[i].y) / 2;
                if (Math.abs(F(mx, my)) > 0.2) bad++;
            }
        }
        return bad;
    };
    const sq3: View = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
    assert.equal(offLevel((x, y) => Math.floor(x) - y, sq3), 0, 'floor, right border');
    assert.equal(offLevel((x, y) => Math.floor(x) - y, { xmin: 0, xmax: 5, ymin: 0, ymax: 5 }), 0, 'floor on 0..5');
    assert.equal(offLevel((x, y) => Math.ceil(x) - y, sq3), 0, 'ceil, left border');
    assert.equal(offLevel((x, y) => Math.floor(y) - x, sq3), 0, 'x = floor(y), top border');
    assert.equal(offLevel((x, y) => Math.sign(x) - y, sq3), 0, 'sign: jump node with a middle value');
});

test('findCrossings with a touch test finds double roots and keeps near misses out', () => {
    const touch = (_x: number, v: number) => Math.abs(v) <= 6e-6;
    const r = findCrossings((x) => (x - 1) ** 2, -3, 3, undefined, touch);
    assert.equal(r.length, 1);
    near(r[0], 1, 1e-6);
    assert.deepEqual(findCrossings((x) => (x - 1) ** 2 + 1e-3, -3, 3, undefined, touch), [], 'near miss');
    assert.deepEqual(findCrossings((x) => (x - 1) ** 2, -3, 3), [], 'no touch test: sign changes only');
    near(findCrossings((x) => Math.sin(x) - 1, 0, 3, undefined, touch)[0], Math.PI / 2, 1e-6);
    // Two crossings closer than a sample step: bisected when the dip is real ...
    const dip = findCrossings((x) => (x - 1) ** 2 - 1e-6, -3, 3, undefined, (_x, v) => Math.abs(v) <= 1e-12);
    assert.equal(dip.length, 2);
    near(dip[0], 0.999, 1e-9);
    near(dip[1], 1.001, 1e-9);
    // ... and reported once when the touch test calls the dip noise.
    assert.equal(findCrossings((x) => (x - 1) ** 2 - 1e-6, -3, 3, undefined, touch).length, 1);
    // Ordinary roots are unchanged.
    const cubic = findCrossings((x) => x * x * x - x, -2, 2, undefined, touch);
    assert.equal(cubic.length, 3);
});

// ------------------------------------------------------ randomized checks

test('random regions: area, ring structure, vertices, labels, optimum', () => {
    let seed = 20261006;
    const rnd = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    const R = (a: number, b: number): number => a + (b - a) * rnd();
    const randomConstraint = (): Constraint => {
        const kind = Math.floor(rnd() * 4);
        const s = rnd() < 0.5 ? 1 : -1;
        if (kind === 0) return lin(R(-2, 2), R(-2, 2), R(-3, 3));
        if (kind === 1) {
            const [cx, cy, r] = [R(-2, 2), R(-2, 2), R(0.5, 3)];
            return nl((x, y) => s * ((x - cx) ** 2 + (y - cy) ** 2 - r * r));
        }
        if (kind === 2) {
            const [f, amp, off] = [R(0.5, 3), R(0.3, 2), R(-1, 1)];
            return nl((x, y) => s * (y - amp * Math.sin(f * x) - off));
        }
        const [a, b] = [R(-1, 1), R(-1, 1)];
        return nl((x, y) => s * (y - a * x * x - b));
    };
    const grid = { nx: 120, ny: 120 };
    for (let trial = 0; trial < 40; trial++) {
        const view: View = { xmin: R(-4, -1), xmax: R(1, 4), ymin: R(-4, -1), ymax: R(1, 4) };
        const set: ConstraintSet = { entries: [] };
        const ne = 1 + Math.floor(rnd() * 3);
        for (let e = 0; e < ne; e++) {
            const nd = rnd() < 0.25 ? 2 : 1;
            const disjuncts: Constraint[][] = [];
            for (let d = 0; d < nd; d++) disjuncts.push(rnd() < 0.5 ? [randomConstraint()] : [randomConstraint(), randomConstraint()]);
            set.entries.push({ disjuncts });
        }
        const msg = `trial ${trial}`;
        const r = computeRegion(set, view, grid);
        const va = (view.xmax - view.xmin) * (view.ymax - view.ymin);
        const N = 300;
        let inside = 0;
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < N; i++) {
                const x = view.xmin + ((i + 0.5) * (view.xmax - view.xmin)) / N;
                const y = view.ymin + ((j + 0.5) * (view.ymax - view.ymin)) / N;
                if (evalConstraintSet(set, x, y) <= 0) inside++;
            }
        }
        assert.ok(Math.abs(area(r) - (inside / (N * N)) * va) / va < 0.006, `${msg}: area`);
        assert.equal(r.empty, r.rings.length === 0, msg);
        // Every ring belongs to exactly one component; outer rings CCW, holes CW.
        const owner = r.rings.map(() => 0);
        for (const c of r.components) {
            owner[c.outer]++;
            assert.ok(ringArea(r.rings[c.outer]) > 0, `${msg}: outer CCW`);
            for (const h of c.holes) {
                owner[h]++;
                assert.ok(ringArea(r.rings[h]) < 0, `${msg}: hole CW`);
            }
        }
        assert.ok(owner.every((k) => k === 1), `${msg}: ring ownership ${owner}`);
        r.rings.forEach((ring, i) => {
            assert.equal(r.tags[i].length, ring.length, msg);
            for (const p of ring) {
                assert.ok(p.x >= view.xmin && p.x <= view.xmax && p.y >= view.ymin && p.y <= view.ymax, `${msg}: ring point outside the view`);
            }
        });
        const byId = new Map<number, Constraint>();
        for (const e of set.entries) for (const d of e.disjuncts) for (const c of d) byId.set(c.id, c);
        for (const v of r.vertices) {
            for (const t of v.tags) {
                const c = byId.get(t);
                assert.ok(c && Math.abs(c.g(v.x, v.y)) < 1e-6, `${msg}: vertex off its constraint`);
            }
        }
        if (!r.empty) {
            const p = labelPoint(r, view);
            assert.ok(p && pointInRings(p, r.rings), `${msg}: label outside`);
        }
        const obj = (x: number, y: number): number => x + 0.3 * y * y;
        const o = optimizeOverRegion(obj, null, r, set, view, grid, 'max');
        assert.equal(o.status === 'empty', r.empty, `${msg}: status`);
        for (const p of o.points) {
            const G = evalConstraintSet(set, p.x, p.y);
            assert.ok(G <= 1e-7, `${msg}: optimum infeasible (G = ${G})`);
        }
        if (!r.empty) {
            let best = -Infinity;
            for (let j = 0; j <= 150; j++) {
                for (let i = 0; i <= 150; i++) {
                    const x = view.xmin + (i * (view.xmax - view.xmin)) / 150;
                    const y = view.ymin + (j * (view.ymax - view.ymin)) / 150;
                    if (evalConstraintSet(set, x, y) <= 0) best = Math.max(best, obj(x, y));
                }
            }
            assert.ok(o.value >= best - 2e-3 * (1 + Math.abs(best)), `${msg}: optimum ${o.value} below sampled ${best}`);
        }
    }
});

// ------------------------------------------------------------ benchmarks

test('benchmark: computeRegion with 4 nonlinear constraints at 225 x 225', () => {
    const set = all(
        nl((x, y) => y - (x * x - 3 * x + 4)),
        nl((x, y) => x * x + y * y - 9),
        nl((x, y) => Math.sin(x) - y + 0.5 * Math.cos(2 * x)),
        nl((x, y) => Math.exp(-x / 3) * 4 - y)
    );
    const view: View = { xmin: -1, xmax: 10, ymin: -1, ymax: 10 };
    const grid = { nx: 225, ny: 225 };
    for (let i = 0; i < 3; i++) computeRegion(set, view, grid);
    const times: number[] = [];
    let r: RegionResult | null = null;
    for (let i = 0; i < 9; i++) {
        const t0 = performance.now();
        r = computeRegion(set, view, grid);
        times.push(performance.now() - t0);
    }
    const ms = median(times);
    console.log(`    computeRegion 4 nonlinear 225x225: ${ms.toFixed(2)} ms`);
    assert.ok(r && !r.empty);
    assert.ok(ms < 36, `${ms} ms`);
});

test('benchmark: computeContours with 5 levels at 225 x 225', () => {
    const F = (x: number, y: number): number => x * y + Math.sin(x) * Math.cos(y);
    const view: View = { xmin: -1, xmax: 10, ymin: -1, ymax: 10 };
    const grid = { nx: 225, ny: 225 };
    const levels = [1, 4, 9, 16, 25];
    for (let i = 0; i < 3; i++) computeContours(F, levels, view, grid);
    const times: number[] = [];
    for (let i = 0; i < 9; i++) {
        const t0 = performance.now();
        computeContours(F, levels, view, grid);
        times.push(performance.now() - t0);
    }
    const ms = median(times);
    console.log(`    computeContours 5 levels 225x225: ${ms.toFixed(2)} ms`);
    assert.ok(ms < 24, `${ms} ms`);
});

test('benchmark: labelPoint on a dense marching-squares ring', () => {
    // A thin band over a wide view: one ring of several thousand points.
    const set = all(nl((x, y) => y - Math.sin(3 * x) - 0.3), nl((x, y) => Math.sin(3 * x) - 0.3 - y));
    const view: View = { xmin: -10, xmax: 10, ymin: -2, ymax: 2 };
    const r = computeRegion(set, view, { nx: 225, ny: 225 });
    assert.ok(r.rings[0].length > 3000);
    labelPoint(r, view);
    const t0 = performance.now();
    let p: Pt | null = null;
    for (let i = 0; i < 10; i++) p = labelPoint(r, view);
    const ms = (performance.now() - t0) / 10;
    console.log(`    labelPoint on ${r.rings[0].length} ring points: ${ms.toFixed(2)} ms`);
    assert.ok(p && pointInRings(p, r.rings));
    assert.ok(ms < 5, `${ms} ms`);
});

test('benchmark: affine paths', () => {
    const { c1, c2, cx, cy } = lp();
    const set = all(c1, c2, cx, cy);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
        computeRegion(set, LP_VIEW, { nx: 225, ny: 225 });
        computeContours((x, y) => 2 * x + 3 * y, [6, 9, 12], LP_VIEW, { nx: 225, ny: 225 }, { a: 2, b: 3, c: 0 });
    }
    const ms = (performance.now() - t0) / 100;
    console.log(`    exact region + affine contours: ${ms.toFixed(3)} ms`);
    assert.ok(ms < 1.5, `${ms} ms`);
});

// Node 23 can deadlock at exit while Maglev still compiles the benchmark
// loops in the background; idling briefly lets those jobs finish first.
test('settle background compilation', async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
});

function samePt(a: Pt, b: Pt): boolean {
    return a.x === b.x && a.y === b.y;
}
