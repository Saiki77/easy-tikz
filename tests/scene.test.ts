import { test, assert, near } from './_lib';
import { MathContext } from '../src/mathcontext';
import { EXAMPLES, migrateSettings } from '../src/migrate';
import { Pt, View, ringArea } from '../src/geometry';
import {
    HandlePrim,
    LabelMetrics,
    Scene2D,
    SceneCache,
    SceneIssue,
    SceneItem2D,
    TextPrim,
    computeScene2D,
    computeScene3D,
    labelMetricsFor,
} from '../src/scene';
import {
    AxisStyle,
    CurveTool,
    FunctionParameters,
    Parameter,
    PlaneTool,
    PointsTool,
    RegionTool,
    SegmentTool,
    Tool,
} from '../src/types';

// ----------------------------------------------------------------- helpers

function fn(name: string, expression: string, fields: Partial<FunctionParameters> = {}): FunctionParameters {
    return {
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
        thickness: 'thin',
        parametric: false,
        expressionY: '',
        name,
        ...fields,
    };
}

function region(name: string, conditions: string[], fields: Partial<RegionTool> = {}): RegionTool {
    return {
        type: 'region',
        id: `id-${name}`,
        name,
        color: 'blue',
        conditions,
        conditionLabels: conditions.map(() => ''),
        fill: true,
        fillOpacity: 0.25,
        fillPattern: 'solid',
        outline: 'none',
        thickness: 'thin',
        constraintLines: false,
        label: '',
        ...fields,
    };
}

function curve(name: string, equation: string, fields: Partial<CurveTool> = {}): CurveTool {
    return { type: 'curve', id: `id-${name}`, name, color: 'red', equation, levels: '', thickness: 'thin', dashed: false, label: '', ...fields };
}

function points(name: string, fields: Partial<PointsTool> = {}): PointsTool {
    return {
        type: 'points',
        id: `id-${name}`,
        name,
        color: 'red',
        dim: 2,
        source: 'list',
        points: '',
        ref1: '',
        ref2: '',
        regionName: '',
        objective: '',
        sense: 'max',
        label: '',
        dropLines: false,
        size: 'normal',
        ...fields,
    };
}

function segment(name: string, path: string, fields: Partial<SegmentTool> = {}): SegmentTool {
    return {
        type: 'segment',
        id: `id-${name}`,
        name,
        color: 'black',
        dim: 2,
        path,
        closed: false,
        style: 'line',
        thickness: 'thin',
        dashed: false,
        label: '',
        ...fields,
    };
}

function plane(name: string, value: string, fields: Partial<PlaneTool> = {}): PlaneTool {
    return { type: 'plane3D', id: `id-${name}`, name, color: 'orange', axis: 'z', value, fillOpacity: 0.3, ...fields };
}

interface Chart {
    functions?: FunctionParameters[];
    tools: Tool[];
    parameters?: Parameter[];
    view: View;
    axisStyle?: AxisStyle;
    grid?: { nx: number; ny: number };
    variables?: string;
    metrics?: LabelMetrics;
}

function contextOf(c: Chart): MathContext {
    return MathContext.create({
        parameters: c.parameters || [],
        functions: c.functions || [],
        variables: c.variables || 'x, y',
        toolNames: c.tools.map((t) => t.name),
    });
}

function scene(c: Chart, cache?: SceneCache, math?: MathContext): Scene2D {
    return computeScene2D({
        functions: c.functions || [],
        tools: c.tools,
        math: math || contextOf(c),
        view: c.view,
        grid: c.grid || { nx: 150, ny: 150 },
        axisStyle: c.axisStyle || 'box',
        polar: false,
        cache,
        labelMetrics: c.metrics,
    });
}

function item(s: Scene2D, source: string): SceneItem2D {
    const it = s.items.find((i) => i.source === source);
    if (!it) throw new Error(`no item ${source}; items: ${s.items.map((i) => i.source).join(', ')}`);
    return it;
}

function issuesOf(s: Scene2D, source: string): SceneIssue[] {
    return s.issues.filter((i) => i.source === source);
}

function errorsOf(s: Scene2D, source: string): SceneIssue[] {
    return issuesOf(s, source).filter((i) => i.severity === 'error');
}

function ptNear(p: Pt, x: number, y: number, tol = 1e-9, msg = ''): void {
    near(p.x, x, tol, `${msg} x`);
    near(p.y, y, tol, `${msg} y`);
}

/** Distance from p to the nearest segment of any polyline. */
function distToLines(p: Pt, lines: Pt[][]): number {
    let best = Infinity;
    for (const l of lines) {
        for (let i = 1; i < l.length; i++) {
            const a = l[i - 1];
            const b = l[i];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
            best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
        }
    }
    return best;
}

function fillArea(it: SceneItem2D): number {
    let a = 0;
    for (const f of it.fills) for (const r of f.rings) a += ringArea(r);
    return a;
}

/** The LP example from migrate.ts, as the plugin loads it. */
function lpExample(): Chart & { parameters: Parameter[] } {
    const ex = EXAMPLES.find((e) => e.id === 'lp');
    if (!ex) throw new Error('lp example missing');
    const d = migrateSettings(JSON.parse(JSON.stringify(ex.data))) as Record<string, unknown>;
    return {
        tools: d.tools as Tool[],
        functions: d.functions as FunctionParameters[],
        parameters: d.parameters as Parameter[],
        view: { xmin: Number(d.xmin), xmax: Number(d.xmax), ymin: Number(d.ymin), ymax: Number(d.ymax) },
        axisStyle: d.axis_style as AxisStyle,
    };
}

// --------------------------------------------------------------------- LP

test('LP example: exact feasible polygon, constraint lines with labels, optimum and corners', () => {
    const c = lpExample();
    const s = scene(c);
    assert.deepEqual(s.issues, []);

    const r1 = item(s, 'R1');
    assert.equal(r1.fills.length, 1);
    assert.deepEqual(r1.fills[0].rings, [
        [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 3, y: 1 },
            { x: 0, y: 2 },
        ],
    ]);
    assert.equal(r1.fills[0].color, 'blue');
    near(r1.fills[0].opacity, 0.25);

    // x >= 0 and y >= 0 lie on the view border (xmin = ymin = 0): skipped.
    assert.equal(r1.strokes.length, 1);
    const lines = r1.strokes[0].lines;
    assert.equal(r1.strokes[0].exact, true);
    assert.equal(lines.length, 2);
    ptNear(lines[0][0], 0, 4);
    ptNear(lines[0][1], 4, 0);
    ptNear(lines[1][0], 0, 2);
    ptNear(lines[1][1], 5, 1 / 3);

    // Condition labels sit on their lines, inside the view.
    const labels = r1.texts.map((t) => t.text);
    assert.deepEqual(labels, ['(1)', '(2)']);
    for (const [k, t] of r1.texts.entries()) {
        assert.ok(distToLines(t, [lines[k]]) < 1e-9, `${t.text} on its line`);
        assert.ok(t.x > c.view.xmin && t.x < c.view.xmax && t.y > c.view.ymin && t.y < c.view.ymax, `${t.text} inside`);
    }

    // Optimum P1 at (3, 1) with value 9, published as derived names.
    const p1 = item(s, 'P1');
    assert.equal(p1.markers.length, 1);
    ptNear(p1.markers[0], 3, 1);
    assert.equal(p1.markers[0].size, 'large');
    assert.equal(p1.markers[0].dim, undefined);
    near(s.derived.P1_x, 3);
    near(s.derived.P1_y, 1);
    near(s.derived.P1_val, 9);
    assert.equal(s.derived.P1_n, 1);
    assert.deepEqual(
        p1.texts.map((t) => t.text),
        ['x* = (3, 1)']
    );

    // Corner points P2 with coordinate labels, in ring order.
    const p2 = item(s, 'P2');
    assert.deepEqual(
        p2.markers.map((m) => [m.x, m.y]),
        [
            [0, 0],
            [4, 0],
            [3, 1],
            [0, 2],
        ]
    );
    assert.deepEqual(
        p2.texts.map((t) => t.text),
        ['(0, 0)', '(4, 0)', '(3, 1)', '(0, 2)']
    );
    assert.equal(s.derived.P2_n, 4);
    near(s.derived.P2_x3, 3);
    near(s.derived.P2_y3, 1);
    assert.ok(Number.isNaN(s.derived.P2_val));
    // Two labels at (3, 1): the later one (P1) takes a different side.
    const p2At31 = p2.texts[2];
    assert.notEqual(p1.texts[0].anchor, p2At31.anchor);

    // C1: 2x + 3y = c with c = 9, exact, label with the slider value.
    const c1 = item(s, 'C1');
    assert.equal(c1.strokes.length, 1);
    assert.equal(c1.strokes[0].dashed, true);
    assert.equal(c1.strokes[0].exact, true);
    const seg = c1.strokes[0].lines[0];
    for (const p of seg) near(2 * p.x + 3 * p.y, 9, 1e-9, 'C1 on 2x + 3y = 9');
    assert.deepEqual(
        c1.texts.map((t) => t.text),
        ['z = 9']
    );

    // Item order is list order: R1, C1, P2, P1.
    assert.deepEqual(
        s.items.map((i) => i.source),
        ['R1', 'C1', 'P2', 'P1']
    );
    assert.equal(r1.kind, 'tool');
    assert.equal(r1.key, 't0');
});

test('LP: a curve with levels P1_val passes through the optimum, for several slider values', () => {
    const c = lpExample();
    c.tools.push(curve('C2', '2x + 3y', { levels: 'P1_val' }));
    for (const rhs of [4, 5, 6, 7]) {
        (c.tools[0] as RegionTool).conditions[0] = `x + y <= ${rhs}`;
        const s = scene(c);
        const c2 = item(s, 'C2');
        const p = { x: s.derived.P1_x, y: s.derived.P1_y };
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'optimum found');
        assert.ok(distToLines(p, c2.strokes[0].lines) < 1e-9, `C2 through P1 at rhs ${rhs}`);
        near(2 * p.x + 3 * p.y, s.derived.P1_val, 1e-9);
    }
});

test('levels example: the dashed level curve P1_val touches the region at the optimum', () => {
    const ex = EXAMPLES.find((e) => e.id === 'levels');
    if (!ex) throw new Error('levels example missing');
    const d = migrateSettings(JSON.parse(JSON.stringify(ex.data))) as Record<string, unknown>;
    const c: Chart = {
        tools: d.tools as Tool[],
        view: { xmin: Number(d.xmin), xmax: Number(d.xmax), ymin: Number(d.ymin), ymax: Number(d.ymax) },
        axisStyle: 'middle',
    };
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    near(s.derived.P1_x, 0.8, 1e-6);
    near(s.derived.P1_y, 1.6, 1e-6);
    near(s.derived.P1_val, 3.2, 1e-6);
    const c2 = item(s, 'C2');
    // Marching squares: within a fraction of a grid cell.
    assert.ok(distToLines({ x: s.derived.P1_x, y: s.derived.P1_y }, c2.strokes[0].lines) < 0.01);
    // One label per level, with {level} interpolated.
    assert.deepEqual(
        item(s, 'C1').texts.map((t) => t.text),
        ['1', '3.2', '6']
    );
});

// ----------------------------------------------------------------- surplus

test('consumer / producer surplus regions follow the equilibrium P1_x, P1_y', () => {
    const ex = EXAMPLES.find((e) => e.id === 'surplus');
    if (!ex) throw new Error('surplus example missing');
    const d = migrateSettings(JSON.parse(JSON.stringify(ex.data))) as Record<string, unknown>;
    const c: Chart = {
        tools: d.tools as Tool[],
        functions: d.functions as FunctionParameters[],
        parameters: d.parameters as Parameter[],
        view: { xmin: Number(d.xmin), xmax: Number(d.xmax), ymin: Number(d.ymin), ymax: Number(d.ymax) },
        axisStyle: 'axes',
    };
    const math = contextOf(c);
    const cache = new SceneCache();
    for (const a of [1, 2, 0.5]) {
        math.setParams([{ name: 'a', value: a, min: 0.5, max: 3, step: 0.05 }]);
        const s = scene(c, cache, math);
        assert.deepEqual(s.issues, []);
        const qx = 8 / (1 + a);
        const qy = 10 - a * qx;
        near(s.derived.P1_x, qx, 1e-9, 'equilibrium x');
        near(s.derived.P1_y, qy, 1e-9, 'equilibrium y');
        // Both surplus triangles have base P1_x and heights 10 - P1_y and P1_y - 2.
        near(fillArea(item(s, 'R1')), 0.5 * qx * (10 - qy), 1e-6, `CS at a = ${a}`);
        near(fillArea(item(s, 'R2')), 0.5 * qx * (qy - 2), 1e-6, `PS at a = ${a}`);
        // Drop lines from P1 to the view edges (axis style 'axes').
        const g = item(s, 'P1').guides[0].lines[0];
        ptNear(g[0], qx, 0);
        ptNear(g[1], qx, qy);
        ptNear(g[2], 0, qy);
    }
});

// ----------------------------------------------------------- intersections

test('intersections: function x function over the overlap of the domains', () => {
    const c: Chart = {
        functions: [fn('f1', 'sin(x)', { domain: '0:2*pi' }), fn('f2', 'cos(x)', { domain: '0:2*pi' })],
        tools: [points('P1', { source: 'intersections', ref1: 'f1', ref2: 'f2', label: 'A; B' })],
        view: { xmin: -0.5, xmax: 7, ymin: -1.5, ymax: 2 },
    };
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    const m = item(s, 'P1').markers;
    assert.equal(m.length, 2);
    ptNear(m[0], Math.PI / 4, Math.SQRT1_2, 1e-9);
    ptNear(m[1], (5 * Math.PI) / 4, -Math.SQRT1_2, 1e-9);
    assert.equal(s.derived.P1_n, 2);
    near(s.derived.P1_x2, (5 * Math.PI) / 4, 1e-9);
    // Per-point labels split at ';'.
    assert.deepEqual(
        item(s, 'P1').texts.map((t) => t.text),
        ['A', 'B']
    );
});

test('intersections: function x curve, curve x curve (affine exact and nonlinear)', () => {
    const c: Chart = {
        functions: [fn('f1', 'x^2')],
        tools: [
            curve('C1', 'x + y = 2'),
            curve('C2', 'x - y = 0'),
            curve('C3', 'x^2 + y^2 = 4'),
            curve('C4', 'x y = 1'),
            points('P1', { source: 'intersections', ref1: 'f1', ref2: 'C1' }),
            points('P2', { source: 'intersections', ref1: 'C1', ref2: 'C2' }),
            points('P3', { source: 'intersections', ref1: 'C3', ref2: 'C2' }),
            points('P4', { source: 'intersections', ref1: 'C3', ref2: 'C4' }),
        ],
        view: { xmin: -3, xmax: 3, ymin: -3, ymax: 5 },
    };
    const s = scene(c);
    assert.deepEqual(errorsOf(s, 'P1').concat(errorsOf(s, 'P2'), errorsOf(s, 'P3'), errorsOf(s, 'P4')), []);

    const p1 = item(s, 'P1').markers;
    assert.equal(p1.length, 2);
    ptNear(p1[0], -2, 4, 1e-9);
    ptNear(p1[1], 1, 1, 1e-9);

    const p2 = item(s, 'P2').markers;
    assert.equal(p2.length, 1);
    assert.equal(p2[0].x, 1);
    assert.equal(p2[0].y, 1);

    // Circle x line: walked along the exact line, so exact to bisection precision.
    const p3 = item(s, 'P3').markers;
    assert.equal(p3.length, 2);
    ptNear(p3[0], -Math.SQRT2, -Math.SQRT2, 1e-9);
    ptNear(p3[1], Math.SQRT2, Math.SQRT2, 1e-9);

    // Circle x hyperbola: both nonlinear, sharpened by Newton.
    const p4 = item(s, 'P4').markers;
    assert.equal(p4.length, 4);
    for (const p of p4) {
        near(p.x * p.x + p.y * p.y, 4, 1e-8, 'on the circle');
        near(p.x * p.y, 1, 1e-8, 'on the hyperbola');
    }
});

test('intersections: blank, unknown, parametric and identical references', () => {
    const c: Chart = {
        functions: [fn('f1', 'x'), fn('f2', 'cos(t)', { parametric: true, expressionY: 'sin(t)' })],
        tools: [
            points('P1', { source: 'intersections', ref1: 'f1', ref2: '' }),
            points('P2', { source: 'intersections', ref1: 'f1', ref2: 'g9' }),
            points('P3', { source: 'intersections', ref1: 'f2', ref2: 'f1' }),
            points('P4', { source: 'intersections', ref1: 'f1', ref2: 'f1' }),
        ],
        view: { xmin: -2, xmax: 2, ymin: -2, ymax: 2 },
    };
    const s = scene(c);
    assert.deepEqual(issuesOf(s, 'P1'), []);
    assert.equal(item(s, 'P1').markers.length, 0);
    assert.equal(errorsOf(s, 'P2')[0].field, 'ref2');
    assert.equal(errorsOf(s, 'P3')[0].field, 'ref1');
    assert.match(errorsOf(s, 'P3')[0].message, /parametric/);
    assert.equal(errorsOf(s, 'P4')[0].field, 'ref2');
});

// ----------------------------------------------------------------- lattice

test('lattice points with and without a region', () => {
    const c: Chart = {
        tools: [
            region('R1', ['x + y <= 4', 'x + 3y <= 6', 'x >= 0', 'y >= 0']),
            points('P1', { source: 'lattice', regionName: 'R1' }),
            points('P2', { source: 'lattice', regionName: '' }),
        ],
        view: { xmin: -0.5, xmax: 3.5, ymin: -0.5, ymax: 2.5 },
    };
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    const inside = item(s, 'P1').markers.map((m) => `${m.x},${m.y}`).sort();
    assert.deepEqual(inside, ['0,0', '0,1', '0,2', '1,0', '1,1', '2,0', '2,1', '3,0', '3,1'].sort());
    // Whole view: x in 0..3, y in 0..2.
    assert.equal(item(s, 'P2').markers.length, 12);
    assert.equal(s.derived.P2_n, 12);
});

test('objective selection: best list point (ties kept) and integer optimum on a lattice', () => {
    const c: Chart = {
        tools: [
            points('P1', { points: '(1, 2); (3, 1); (2, 2)', objective: 'x + y', sense: 'max', label: '{val}' }),
            points('P2', { points: '(1, 2); (3, 1); (2, 2)', objective: 'x + y', sense: 'min' }),
            region('R1', ['2x + 2y <= 7', 'x >= 0', 'y >= 0']),
            points('P3', { source: 'lattice', regionName: 'R1', objective: 'x + 2y', sense: 'max' }),
            points('P4', { source: 'region', regionName: 'R1', objective: 'x + 2y', sense: 'max' }),
        ],
        view: { xmin: -0.5, xmax: 5, ymin: -0.5, ymax: 5 },
    };
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    assert.deepEqual(
        item(s, 'P1').markers.map((m) => [m.x, m.y]),
        [
            [3, 1],
            [2, 2],
        ]
    );
    assert.equal(s.derived.P1_val, 4);
    assert.deepEqual(
        item(s, 'P1').texts.map((t) => t.text),
        ['4', '4']
    );
    assert.deepEqual(
        item(s, 'P2').markers.map((m) => [m.x, m.y]),
        [[1, 2]]
    );
    // Integer optimum (0, 3) with 6; the LP relaxation reaches (0, 3.5) with 7.
    assert.deepEqual(
        item(s, 'P3').markers.map((m) => [m.x, m.y]),
        [[0, 3]]
    );
    assert.equal(s.derived.P3_val, 6);
    ptNear(item(s, 'P4').markers[0], 0, 3.5, 1e-9);
    near(s.derived.P4_val, 7, 1e-9);
});

test('optimum statuses: unbounded (dim marker, info) and infeasible (info)', () => {
    const c: Chart = {
        tools: [
            region('R1', ['x + y >= 2', 'x >= 0', 'y >= 0']),
            points('P1', { source: 'region', regionName: 'R1', objective: 'x + y', sense: 'max' }),
            region('R2', ['x + y <= -1', 'x >= 0', 'y >= 0']),
            points('P2', { source: 'region', regionName: 'R2', objective: 'x + y', sense: 'max' }),
        ],
        view: { xmin: 0, xmax: 5, ymin: 0, ymax: 5 },
    };
    const s = scene(c);
    const i1 = issuesOf(s, 'P1');
    assert.equal(i1.length, 1);
    assert.equal(i1[0].severity, 'info');
    assert.equal(i1[0].field, 'objective');
    assert.equal(i1[0].message, 'objective is unbounded on R1');
    assert.ok(item(s, 'P1').markers.length >= 1);
    assert.ok(item(s, 'P1').markers.every((m) => m.dim === true));

    const i2 = issuesOf(s, 'P2');
    assert.equal(i2.length, 1);
    assert.equal(i2[0].severity, 'info');
    assert.equal(i2[0].message, 'R2 is empty (infeasible)');
    assert.equal(item(s, 'P2').markers.length, 0);
    assert.equal(s.derived.P2_n, 0);
    // The empty region itself is reported as info, never as an error.
    assert.ok(issuesOf(s, 'R2').every((i) => i.severity === 'info'));
});

// ----------------------------------------------------------------- segment

test('segment: path splicing a points tool, closed polygon, arrows per leg', () => {
    const c = lpExample();
    c.tools.push(
        segment('S1', 'P2', { closed: true }),
        segment('S2', '(0, 0); P1; (5, 4)', { style: 'forward' }),
        segment('S3', '(0, 0); (1, 0); (1, 1)', { style: 'both', closed: true })
    );
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    const s1 = item(s, 'S1').strokes[0];
    assert.equal(s1.closed, true);
    assert.deepEqual(
        s1.lines[0].map((p) => [p.x, p.y]),
        [
            [0, 0],
            [4, 0],
            [3, 1],
            [0, 2],
        ]
    );
    const s2 = item(s, 'S2').strokes[0];
    assert.equal(s2.arrow, 'forward');
    assert.deepEqual(
        s2.lines.map((l) => l.map((p) => [p.x, p.y])),
        [
            [
                [0, 0],
                [3, 1],
            ],
            [
                [3, 1],
                [5, 4],
            ],
        ]
    );
    const s3 = item(s, 'S3').strokes[0];
    assert.equal(s3.arrow, 'both');
    assert.equal(s3.lines.length, 3, 'closing leg included');
});

test('segment: brace prim from the first two points, label formatted', () => {
    const c: Chart = {
        parameters: [{ name: 'w', value: 4, min: 0, max: 10, step: 1 }],
        tools: [segment('S1', '(0, 0); (w, 0); (9, 9)', { style: 'brace', label: 'width {w}', color: 'blue' })],
        view: { xmin: -1, xmax: 10, ymin: -1, ymax: 10 },
    };
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    const it = item(s, 'S1');
    assert.equal(it.strokes.length, 0);
    assert.equal(it.braces.length, 1);
    const b = it.braces[0];
    // from -> to keeps the path order: the tip bulges left of it (up for left -> right).
    assert.deepEqual(b.from, { x: 0, y: 0 });
    assert.deepEqual(b.to, { x: 4, y: 0 });
    assert.equal(b.label, 'width 4');
    assert.equal(b.color, 'blue');
});

test('segment: one point is info, unknown tool name is an error', () => {
    const c: Chart = {
        tools: [region('R1', ['x <= 1']), segment('S1', '(0, 0)'), segment('S2', '(0, 0); R1')],
        view: { xmin: -1, xmax: 2, ymin: -1, ymax: 2 },
    };
    const s = scene(c);
    assert.equal(issuesOf(s, 'S1')[0].severity, 'info');
    assert.equal(issuesOf(s, 'S1')[0].field, 'path');
    assert.equal(errorsOf(s, 'S2')[0].field, 'path');
});

// ------------------------------------------------------ function decorations

test('function fill: the region between the curve and y = 0 over the domain', () => {
    const c: Chart = {
        functions: [fn('f1', 'x^2 - 1', { domain: '-2:2', fill: true, fillOpacity: 0.3, fillPattern: 'dots' })],
        tools: [],
        view: { xmin: -3, xmax: 3, ymin: -2, ymax: 4 },
        grid: { nx: 300, ny: 300 },
    };
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    const it = item(s, 'f1');
    assert.equal(it.kind, 'function');
    assert.equal(it.key, '0');
    assert.equal(it.fills[0].pattern, 'dots');
    near(it.fills[0].opacity, 0.3);
    // Integral of |x^2 - 1| over [-2, 2] is 4.
    near(fillArea(it), 4, 0.04);
    for (const r of it.fills[0].rings) for (const p of r) assert.ok(p.x >= -2 - 1e-9 && p.x <= 2 + 1e-9, 'inside the domain');
});

test('function tangent at the live keyword max, and extrema', () => {
    const c: Chart = {
        functions: [fn('f1', 'x^3 - 3x', { tangent: true, tangentPoint: 'max', extrema: true })],
        tools: [],
        view: { xmin: -3, xmax: 3, ymin: -4, ymax: 4 },
    };
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    const it = item(s, 'f1');
    // Tangent at the local maximum (-1, 2): horizontal, across the view.
    const t = it.strokes[0];
    assert.equal(t.exact, true);
    assert.equal(t.dashed, true);
    const [a, b] = t.lines[0];
    near(a.y, 2, 1e-6);
    near(b.y, 2, 1e-6);
    near(Math.min(a.x, b.x), -3, 1e-9);
    near(Math.max(a.x, b.x), 3, 1e-9);
    ptNear(it.markers[0], -1, 2, 1e-6, 'tangent point');
    // Extrema: max (-1, 2) labelled above, min (1, -2) labelled below.
    const ext = it.markers.slice(1);
    assert.equal(ext.length, 2);
    ptNear(ext[0], -1, 2, 1e-6);
    ptNear(ext[1], 1, -2, 1e-6);
    assert.deepEqual(
        it.texts.map((x) => [x.text, x.anchor]),
        [
            ['max', 'above'],
            ['min', 'below'],
        ]
    );
});

test('function tangent at an expression, min2 and a missing extremum', () => {
    const c: Chart = {
        parameters: [{ name: 'a', value: 0.5, min: -2, max: 2, step: 0.1 }],
        functions: [
            fn('f1', 'x^3 - 3x', { tangent: true, tangentPoint: 'a' }),
            fn('f2', 'cos(x)', { tangent: true, tangentPoint: 'min2', domain: '0:12' }),
            fn('f3', 'x', { tangent: true, tangentPoint: 'max' }),
            fn('f4', 'x', { tangent: true, tangentPoint: 'b +' }),
        ],
        tools: [],
        view: { xmin: -3, xmax: 13, ymin: -4, ymax: 4 },
    };
    const s = scene(c);
    const t1 = item(s, 'f1');
    ptNear(t1.markers[0], 0.5, 0.125 - 1.5, 1e-9);
    const [a, b] = t1.strokes[0].lines[0];
    near((b.y - a.y) / (b.x - a.x), 3 * 0.25 - 3, 1e-6, 'slope 3a^2 - 3');
    // cos has minima at pi and 3 pi on [0, 12]: min2 is 3 pi.
    ptNear(item(s, 'f2').markers[0], 3 * Math.PI, -1, 1e-6);
    assert.equal(errorsOf(s, 'f3')[0].field, 'tangentPoint');
    assert.equal(errorsOf(s, 'f4')[0].field, 'tangentPoint');
});

test('a tangent at a crossing of its own function is not a cycle', () => {
    const c: Chart = {
        functions: [fn('f1', 'x^2', { tangent: true, tangentPoint: 'P1_x', fill: true }), fn('f2', '2 - x')],
        tools: [points('P1', { source: 'intersections', ref1: 'f1', ref2: 'f2' })],
        view: { xmin: 0, xmax: 3, ymin: -1, ymax: 4 },
    };
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    // Only the crossing at x = 1 lies in the view range.
    ptNear(item(s, 'P1').markers[0], 1, 1, 1e-9);
    const t = item(s, 'f1');
    ptNear(t.markers[0], 1, 1, 1e-9);
    const [a, b] = t.strokes[0].lines[0];
    near((b.y - a.y) / (b.x - a.x), 2, 1e-6, 'slope of x^2 at 1');
});

// ------------------------------------------------------------------ cycles

test('cycles become errors on every member; hidden referenced region is computed', () => {
    const c: Chart = {
        tools: [
            region('R1', ['y <= P1_y', 'x >= 0', 'y >= 0', 'x <= 3']),
            points('P1', { source: 'region', regionName: 'R1', objective: 'x', sense: 'max' }),
            region('R2', ['x + y <= 2', 'x >= 0', 'y >= 0'], { hidden: true }),
            points('P2', { source: 'region', regionName: 'R2' }),
            points('P3', { points: '(P3_x, 1)' }),
        ],
        view: { xmin: -1, xmax: 4, ymin: -1, ymax: 4 },
    };
    const s = scene(c);
    const r1 = errorsOf(s, 'R1');
    const p1 = errorsOf(s, 'P1');
    assert.equal(r1.length, 1);
    assert.equal(p1.length, 1);
    assert.match(r1[0].message, /circular reference: R1 -> P1 -> R1/);
    assert.equal(r1[0].field, 'condition:0');
    assert.equal(p1[0].field, 'regionName');
    assert.equal(errorsOf(s, 'P3')[0].field, 'points');

    // Hidden R2 draws nothing but its corners exist.
    assert.ok(!s.items.some((i) => i.source === 'R2'));
    assert.equal(item(s, 'P2').markers.length, 3);
    assert.deepEqual(issuesOf(s, 'P2'), []);
});

test('labels see final derived values without creating cycles', () => {
    const c = lpExample();
    (c.tools[0] as RegionTool).label = 'z* = {P1_val}';
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    const t = item(s, 'R1').texts.find((x) => x.anchor === 'center');
    assert.ok(t);
    assert.equal(t.text, 'z* = 9');
    assert.equal(t.halo, true);
});

// ------------------------------------------------------------------ issues

test('issue field ids per tool and field', () => {
    const c: Chart = {
        functions: [fn('f1', 'x', { domain: '0:q', fill: true })],
        tools: [
            region('R1', ['x >= 0', 'x + zz <= 1']),
            region('R2', ['x >= 0'], { label: '{qq}' }),
            curve('C1', '2x + = 1'),
            curve('C2', 'x + y = 1', { levels: '1, w' }),
            points('P1', { points: '(1, 2); (3' }),
            points('P2', { source: 'region', regionName: 'R9' }),
            points('P3', { points: '(1, 1)', objective: 'x +* y' }),
            segment('S1', '(0, 0); (1, ?)'),
        ],
        view: { xmin: -1, xmax: 4, ymin: -1, ymax: 4 },
    };
    const s = scene(c);
    const field = (source: string) => errorsOf(s, source).map((i) => i.field);
    assert.deepEqual(field('f1'), ['domain']);
    assert.deepEqual(field('R1'), ['condition:1']);
    assert.match(errorsOf(s, 'R1')[0].message, /^condition 2: /);
    assert.deepEqual(field('R2'), ['label']);
    assert.deepEqual(field('C1'), ['equation']);
    assert.deepEqual(field('C2'), ['levels']);
    assert.deepEqual(field('P1'), ['points']);
    assert.deepEqual(field('P2'), ['regionName']);
    assert.deepEqual(field('P3'), ['objective']);
    assert.deepEqual(field('S1'), ['path']);
    // A broken region condition does not take the other tools down.
    assert.ok(s.items.some((i) => i.source === 'R2'));
});

test('blank fields of fresh tools draw nothing and report nothing', () => {
    const c: Chart = {
        tools: [
            region('R1', ['']),
            curve('C1', ''),
            points('P1'),
            points('P2', { source: 'intersections' }),
            points('P3', { source: 'region' }),
            segment('S1', ''),
        ],
        view: { xmin: -1, xmax: 4, ymin: -1, ymax: 4 },
    };
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    for (const it of s.items) {
        assert.equal(it.fills.length + it.strokes.length + it.markers.length + it.texts.length + it.braces.length, 0, it.source);
    }
});

// ------------------------------------------------------------------- cache

test('cache: dragging a parameter used only by C1 recomputes C1 only', () => {
    const c = lpExample();
    const math = contextOf(c);
    const cache = new SceneCache();
    const s1 = scene(c, cache, math);
    math.setParams([{ name: 'c', value: 6, min: 0, max: 15, step: 0.1 }]);
    const s2 = scene(c, cache, math);
    // Same objects: R1, P1 and P2 came from the memo.
    assert.equal(item(s2, 'R1').fills[0], item(s1, 'R1').fills[0]);
    assert.equal(item(s2, 'R1').strokes[0], item(s1, 'R1').strokes[0]);
    assert.equal(item(s2, 'P1').markers, item(s1, 'P1').markers);
    assert.equal(item(s2, 'P2').markers, item(s1, 'P2').markers);
    // C1 moved to 2x + 3y = 6, and its label follows.
    assert.notEqual(item(s2, 'C1').strokes[0], item(s1, 'C1').strokes[0]);
    for (const p of item(s2, 'C1').strokes[0].lines[0]) near(2 * p.x + 3 * p.y, 6, 1e-9);
    assert.equal(item(s2, 'C1').texts[0].text, 'z = 6');
    // Derived values are published even when served from the memo.
    near(s2.derived.P1_val, 9);

    // Without a shared cache every frame recomputes.
    const s3 = scene(c, undefined, math);
    assert.notEqual(item(s3, 'R1').fills[0], item(s2, 'R1').fills[0]);
});

test('cache: a parameter feeding a region recomputes the region and its dependents', () => {
    const c = lpExample();
    c.parameters.push({ name: 'b', value: 6, min: 0, max: 10, step: 0.1 });
    (c.tools[0] as RegionTool).conditions[1] = 'x + 3y <= b';
    const math = contextOf(c);
    const cache = new SceneCache();
    const s1 = scene(c, cache, math);
    near(s1.derived.P1_val, 9);
    math.setParams([{ name: 'b', value: 4, min: 0, max: 10, step: 0.1 }]);
    const s2 = scene(c, cache, math);
    assert.notEqual(item(s2, 'R1').fills[0], item(s1, 'R1').fills[0]);
    // x + y <= 4, x + 3y <= 4: corners (0, 0), (4, 0), (0, 4/3); max 2x + 3y = 8 at (4, 0).
    near(s2.derived.P1_x, 4, 1e-9);
    near(s2.derived.P1_val, 8, 1e-9);
    assert.equal(item(s2, 'C1').strokes[0], item(s1, 'C1').strokes[0]);
});

test('cache: the last good output is drawn while a tool has an error', () => {
    const c = lpExample();
    const math = contextOf(c);
    const cache = new SceneCache();
    const s1 = scene(c, cache, math);
    const r1 = c.tools[0] as RegionTool;
    r1.conditions[0] = 'x + y <=';
    const s2 = scene(c, cache, math);
    const errs = errorsOf(s2, 'R1');
    assert.equal(errs.length, 1);
    assert.equal(errs[0].field, 'condition:0');
    assert.equal(item(s2, 'R1').fills[0], item(s1, 'R1').fills[0]);
    // Dependents keep working on the last good region.
    near(s2.derived.P1_val, 9);
    assert.deepEqual(errorsOf(s2, 'P1'), []);
    // Fixed again: drawn from the new conditions.
    r1.conditions[0] = 'x + y <= 3';
    const s3 = scene(c, cache, math);
    assert.deepEqual(s3.issues, []);
    // x + y <= 3, x + 3y <= 6: the optimum moves to (1.5, 1.5) with 7.5.
    near(s3.derived.P1_val, 7.5, 1e-9);
    // A tool that never succeeded has nothing to fall back on.
    const fresh = scene(
        { tools: [region('R9', ['x <='])], view: c.view },
        new SceneCache()
    );
    assert.equal(item(fresh, 'R9').fills.length, 0);
});

test('benchmark: slider frames recompute only what depends on the slider (generous bounds)', () => {
    // A nonlinear scene: 3-condition region with constraint lines, 5 level
    // curves (one at P1_val), the optimum, a filled function and a tangent.
    const c: Chart = {
        parameters: [
            { name: 'b', value: 2.5, min: 0, max: 5, step: 0.1 },
            { name: 'k', value: 1, min: 0, max: 2, step: 0.1 },
        ],
        functions: [fn('f1', 'sin(x) + 1', { fill: true }), fn('f2', 'x^2/4', { tangent: true, tangentPoint: 'k', extrema: true })],
        tools: [
            region('R1', ['x^2 + y^2 <= 4', 'y >= x^2 - 2', 'x + y <= b'], { constraintLines: true, outline: 'solid' }),
            curve('C1', 'x y', { levels: '0.25, 0.5, k, 1.5, P1_val', label: '{level}' }),
            points('P1', { source: 'region', regionName: 'R1', objective: 'x y', label: '({x:2}, {y:2})', dropLines: true }),
        ],
        view: { xmin: -3, xmax: 3, ymin: -3, ymax: 3 },
        axisStyle: 'middle',
    };
    const math = contextOf(c);
    const cache = new SceneCache();
    const full = { nx: 225, ny: 223 };
    const draft = { nx: 112, ny: 111 };
    const frame = (grid: { nx: number; ny: number }) => {
        const t0 = Date.now();
        const s = scene({ ...c, grid }, cache, math);
        return { ms: Date.now() - t0, s };
    };
    const first = frame(full);
    assert.deepEqual(first.s.issues, []);
    near(first.s.derived.P1_val, 1.5625, 1e-6);
    // Dragging k: the region and the optimum come from the memo.
    let best = Infinity;
    for (const k of [0.8, 0.9, 1.1, 1.2]) {
        math.setParams([{ name: 'k', value: k, min: 0, max: 2, step: 0.1 }]);
        best = Math.min(best, frame(full).ms);
    }
    assert.ok(best < 15, `k frame took ${best} ms`);
    // Dragging b at draft quality: region, optimum and level curves recompute.
    best = Infinity;
    for (const b of [2.4, 2.3, 2.2, 2.1]) {
        math.setParams([{ name: 'b', value: b, min: 0, max: 5, step: 0.1 }]);
        best = Math.min(best, frame(draft).ms);
    }
    assert.ok(best < 40, `b draft frame took ${best} ms`);
});

test('derived values reach the context and later frames start clean', () => {
    const c: Chart = {
        tools: [points('P1', { points: '(1, 2); (3, 4)' })],
        view: { xmin: 0, xmax: 5, ymin: 0, ymax: 5 },
    };
    const math = contextOf(c);
    scene(c, undefined, math);
    assert.equal(math.value('P1_x2 + P1_y'), 5);
    assert.equal(math.value('P1_n'), 2);
    (c.tools[0] as PointsTool).points = '';
    const s = scene(c, undefined, math);
    assert.equal(s.derived.P1_n, 0);
    assert.ok(Number.isNaN(math.value('P1_x')));
});

test('drop lines go to y = 0 / x = 0 for middle axes, else to the view edge', () => {
    const tools = [points('P1', { points: '(2, 3)', dropLines: true })];
    const view = { xmin: -1, xmax: 5, ymin: -1, ymax: 5 };
    const mid = item(scene({ tools, view, axisStyle: 'middle' }), 'P1').guides[0];
    assert.equal(mid.dashed, true);
    assert.deepEqual(mid.lines[0], [
        { x: 2, y: 0 },
        { x: 2, y: 3 },
        { x: 0, y: 3 },
    ]);
    const box = item(scene({ tools, view, axisStyle: 'box' }), 'P1').guides[0];
    assert.deepEqual(box.lines[0], [
        { x: 2, y: -1 },
        { x: 2, y: 3 },
        { x: -1, y: 3 },
    ]);
});

test('region outline, nonlinear constraint lines and condition labels without lines', () => {
    const c: Chart = {
        tools: [
            region('R1', ['x^2 + y^2 <= 4', 'y >= 0'], {
                outline: 'dashed',
                constraintLines: true,
                conditionLabels: ['disc', ''],
            }),
            region('R2', ['x >= 0', 'x <= 1'], { conditionLabels: ['left', 'right'], fill: false }),
        ],
        view: { xmin: -3, xmax: 3, ymin: -3, ymax: 3 },
    };
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    const r1 = item(s, 'R1');
    const outline = r1.strokes[0];
    assert.equal(outline.dashed, true);
    // Constraint lines: y = 0 exact, the circle from marching squares.
    const exact = r1.strokes.find((x, i) => i > 0 && x.exact);
    const curved = r1.strokes.find((x, i) => i > 0 && !x.exact);
    assert.ok(exact && curved);
    ptNear(exact.lines[0][0], -3, 0);
    for (const l of curved.lines) for (const p of l) near(Math.hypot(p.x, p.y), 2, 0.02);
    assert.equal(r1.texts[0].text, 'disc');
    near(Math.hypot(r1.texts[0].x, r1.texts[0].y), 2, 0.05);
    // Labels next to the boundary runs (constraint lines off), on the outer
    // side of each run but off R1's constraint line y = 0 through both spots.
    const r2 = item(s, 'R2');
    assert.deepEqual(
        r2.texts.map((t) => t.text),
        ['left', 'right']
    );
    assert.ok(['above left', 'below left'].includes(r2.texts[0].anchor), r2.texts[0].anchor);
    assert.ok(['above right', 'below right'].includes(r2.texts[1].anchor), r2.texts[1].anchor);
    near(r2.texts[0].x, 0);
    near(r2.texts[1].x, 1);
    // Without the line through them they sit straight beside their runs.
    const alone = scene({ tools: [c.tools[1]], view: c.view });
    assert.deepEqual(
        item(alone, 'R2').texts.map((t) => [t.text, t.anchor]),
        [
            ['left', 'left'],
            ['right', 'right'],
        ]
    );
});

// ------------------------------------------------ review regressions (v4)

test('cache: a label typed into a computed tool appears in the same cache', () => {
    const tools: Tool[] = [
        region('R1', ['x + y <= 4', 'x >= 0', 'y >= 0'], { constraintLines: true }),
        points('P1', { points: '(1, 1)' }),
        curve('C1', 'x - y'),
        segment('S1', '(0, 3); (3, 3)'),
    ];
    const c: Chart = { tools, view: { xmin: -1, xmax: 5, ymin: -1, ymax: 5 } };
    const math = contextOf(c);
    const cache = new SceneCache();
    const s1 = scene(c, cache, math);
    assert.ok(s1.items.every((i) => i.texts.length === 0));
    const r1 = tools[0] as RegionTool;
    r1.label = 'X';
    r1.conditionLabels = ['(1)', '', ''];
    (tools[1] as PointsTool).label = 'A';
    (tools[2] as CurveTool).label = 'diag';
    (tools[3] as SegmentTool).label = 'seg';
    const s2 = scene(c, cache, math);
    assert.deepEqual(item(s2, 'R1').texts.map((t) => t.text).sort(), ['(1)', 'X']);
    assert.deepEqual(item(s2, 'P1').texts.map((t) => t.text), ['A']);
    assert.deepEqual(item(s2, 'C1').texts.map((t) => t.text), ['diag']);
    assert.deepEqual(item(s2, 'S1').texts.map((t) => t.text), ['seg']);
    // Changing a label that is already set is formatted per frame (cached geometry).
    r1.label = 'Y';
    const s3 = scene(c, cache, math);
    assert.ok(item(s3, 'R1').texts.some((t) => t.text === 'Y'));
    assert.equal(item(s3, 'R1').fills[0], item(s2, 'R1').fills[0], 'geometry reused');
});

test('lattice: the integer optimum is searched over every point, small regions in big views are complete', () => {
    const c: Chart = {
        tools: [
            region('R1', ['x + 2y <= 200', '3x + y <= 250', 'x >= 0', 'y >= 0']),
            points('P1', { source: 'lattice', regionName: 'R1', objective: 'x + y', sense: 'max' }),
            points('P2', { source: 'region', regionName: 'R1', objective: 'x + y', sense: 'max' }),
            points('P3', { source: 'lattice', regionName: 'R1', objective: 'x - 3y', sense: 'min' }),
        ],
        view: { xmin: 0, xmax: 100, ymin: 0, ymax: 110 },
    };
    const s = scene(c);
    assert.deepEqual(s.issues, []);
    assert.deepEqual(item(s, 'P1').markers.map((m) => [m.x, m.y]), [[60, 70]]);
    assert.equal(s.derived.P1_val, 130);
    near(s.derived.P2_val, 130, 1e-9);
    assert.deepEqual(item(s, 'P3').markers.map((m) => [m.x, m.y]), [[0, 100]]);
    assert.equal(s.derived.P3_val, -300);

    const big: Chart = {
        tools: [region('D', ['x^2 + y^2 <= 100']), points('Q', { source: 'lattice', regionName: 'D' })],
        view: { xmin: -1000, xmax: 1000, ymin: -1000, ymax: 1000 },
    };
    const sb = scene(big);
    assert.equal(item(sb, 'Q').markers.length, 317);
    assert.deepEqual(issuesOf(sb, 'Q'), []);
});

test('optimum statuses: cut edges are optimal, outside the view, off-view regions are not infeasible', () => {
    const run = (conds: string[], objective: string, view: View) =>
        scene({ tools: [region('R1', conds), points('P1', { source: 'region', regionName: 'R1', objective, sense: 'max' })], view });
    // Bounded, optimal edge cut by the view: value 5 attained in view, not dimmed.
    const a = run(['x + y <= 5', 'x >= 0', 'y >= 0'], 'x + y', { xmin: 0, xmax: 4, ymin: 0, ymax: 4 });
    assert.deepEqual(issuesOf(a, 'P1'), []);
    assert.ok(item(a, 'P1').markers.length === 2 && item(a, 'P1').markers.every((m) => !m.dim));
    near(a.derived.P1_val, 5);
    // Optimum (6, 2) outside the view: info, dimmed best visible point.
    const b = run(['x <= 6', 'y <= 2', 'x >= 0', 'y >= 0'], 'x + y', { xmin: 0, xmax: 5, ymin: 0, ymax: 4.5 });
    assert.deepEqual(
        issuesOf(b, 'P1').map((i) => [i.severity, i.message]),
        [['info', 'the optimum on R1 lies outside the view']]
    );
    assert.ok(item(b, 'P1').markers.every((m) => m.dim === true));
    // A feasible region entirely outside the view is not called infeasible.
    const c = run(['x + y >= 12', 'x <= 8', 'y <= 8'], 'x + y', { xmin: 0, xmax: 5, ymin: 0, ymax: 5 });
    assert.deepEqual(
        issuesOf(c, 'P1').map((i) => i.message),
        ['R1 has no points in the view']
    );
    // Disc cut by the view at its optimum (2, 2).
    const d = run(['x^2 + y^2 <= 8'], 'x + y', { xmin: -3, xmax: 2, ymin: -3, ymax: 3 });
    assert.deepEqual(issuesOf(d, 'P1'), []);
    ptNear(item(d, 'P1').markers[0], 2, 2, 1e-4);
    // Nonlinear region whose objective keeps improving past the view.
    const e = run(['(x - 6)^2 + y^2 <= 4'], 'x', { xmin: 0, xmax: 5, ymin: -3, ymax: 3 });
    assert.deepEqual(
        issuesOf(e, 'P1').map((i) => i.message),
        ['the objective still improves beyond the view on R1']
    );
});

test('deleting a producer drops the last good output of its readers (preview matches export)', () => {
    const tools: Tool[] = [
        region('R1', ['x + y <= 4', 'x >= 0', 'y >= 0']),
        points('P1', { source: 'region', regionName: 'R1', label: 'A; B; C' }),
        segment('S1', '(0, P1_y2); (P1_x2, P1_y2)'),
    ];
    const view: View = { xmin: -1, xmax: 5, ymin: -1, ymax: 5 };
    const cache = new SceneCache();
    const s1 = scene({ tools, view }, cache);
    assert.equal(item(s1, 'P1').markers.length, 3);
    assert.equal(item(s1, 'S1').strokes.length, 1);
    // Delete R1: the host builds a new context (tool names changed) and reuses the cache.
    const after = tools.slice(1);
    const s2 = scene({ tools: after, view }, cache);
    assert.equal(errorsOf(s2, 'P1')[0].message, 'R1 does not exist');
    assert.equal(item(s2, 'P1').markers.length, 0);
    assert.equal(item(s2, 'P1').texts.length, 0);
    assert.equal(item(s2, 'S1').strokes.length, 0);
    assert.equal(s2.derived.P1_x2, undefined);
    // A fresh cache (export, note) gives the same picture.
    const fresh = scene({ tools: after, view });
    assert.deepEqual(item(fresh, 'P1').markers, item(s2, 'P1').markers);
    // Typing in a tool still keeps its last good output.
    const t2: Tool[] = [region('R2', ['x + y <= 4', 'x >= 0', 'y >= 0'])];
    const c2 = new SceneCache();
    const math2 = contextOf({ tools: t2, view });
    scene({ tools: t2, view }, c2, math2);
    (t2[0] as RegionTool).conditions[0] = 'x + y <=';
    assert.equal(item(scene({ tools: t2, view }, c2, math2), 'R2').fills.length, 1);
});

test('intersections: an empty function is info, a broken one names its error', () => {
    const c: Chart = {
        functions: [fn('f1', 'x^2/4'), fn('f2', ''), fn('f3', 'k*x')],
        tools: [
            points('P1', { source: 'intersections', ref1: 'f1', ref2: 'f2' }),
            points('P2', { source: 'intersections', ref1: 'f1', ref2: 'f3' }),
        ],
        view: { xmin: -3, xmax: 3, ymin: -3, ymax: 3 },
    };
    const s = scene(c);
    assert.deepEqual(errorsOf(s, 'P1'), []);
    assert.deepEqual(
        issuesOf(s, 'P1').map((i) => [i.severity, i.field, i.message]),
        [['info', 'ref2', 'f2 has no formula yet']]
    );
    assert.equal(errorsOf(s, 'P2').length, 1);
    assert.match(errorsOf(s, 'P2')[0].message, /^f3 has an error: .*k/);
});

test('issues of hidden tools that nothing reads are tagged hiddenSource', () => {
    const c: Chart = {
        functions: [fn('f1', 'x')],
        tools: [
            region('R1', ['y <= f2(x)'], { hidden: true }),
            points('P1', { source: 'intersections', ref1: 'f1', ref2: 'f2', hidden: true }),
            points('P2', { source: 'intersections', ref1: 'f1', ref2: 'g7', hidden: true }),
            region('R2', ['y <= P2_y', 'x >= 0']),
        ],
        view: { xmin: -3, xmax: 3, ymin: -3, ymax: 3 },
    };
    const s = scene(c);
    assert.ok(issuesOf(s, 'R1').length > 0 && issuesOf(s, 'R1').every((i) => i.hiddenSource === true));
    assert.ok(issuesOf(s, 'P1').length > 0 && issuesOf(s, 'P1').every((i) => i.hiddenSource === true));
    // P2 is hidden but R2 reads P2_y: its error is the root cause, so it stays plain.
    assert.ok(errorsOf(s, 'P2').length === 1 && errorsOf(s, 'P2')[0].hiddenSource === undefined);
});

test('intersections: touching curves give their touching point, misses say so', () => {
    for (const view of [
        { xmin: -3, xmax: 3, ymin: -3, ymax: 3 },
        { xmin: -2.9, xmax: 3, ymin: -3, ymax: 3 },
    ]) {
        const s = scene({
            functions: [fn('f1', 'x^2'), fn('f2', '2x - 1')],
            tools: [points('P1', { source: 'intersections', ref1: 'f1', ref2: 'f2' })],
            view,
        });
        assert.equal(item(s, 'P1').markers.length, 1, JSON.stringify(view));
        ptNear(item(s, 'P1').markers[0], 1, 1, 1e-6);
    }
    // A tangent dragged by a slider never blinks off.
    const c: Chart = {
        parameters: [{ name: 'a', value: 0, min: -2.5, max: 2.5, step: 0.1 }],
        functions: [fn('f1', 'x^2'), fn('f2', '2a x - a^2')],
        tools: [points('P1', { source: 'intersections', ref1: 'f1', ref2: 'f2' })],
        view: { xmin: -3, xmax: 3, ymin: -1, ymax: 9 },
    };
    const math = contextOf(c);
    const cache = new SceneCache();
    for (let k = -25; k <= 25; k++) {
        const a = k / 10;
        math.setParams([{ name: 'a', value: a, min: -2.5, max: 2.5, step: 0.1 }]);
        const s = scene(c, cache, math);
        assert.equal(item(s, 'P1').markers.length, 1, `a = ${a}`);
        near(item(s, 'P1').markers[0].x, a, 1e-6);
    }
    // Level curve x y = 8 touching the budget line 2x + y = 8 at (2, 4).
    const b = scene({
        tools: [curve('C1', 'x y', { levels: '8' }), curve('C2', '2x + y = 8'), points('P1', { source: 'intersections', ref1: 'C1', ref2: 'C2' })],
        view: { xmin: -1, xmax: 7, ymin: -1, ymax: 7 },
    });
    assert.equal(item(b, 'P1').markers.length, 1);
    ptNear(item(b, 'P1').markers[0], 2, 4, 1e-5);
    // No crossing at all: an info note instead of silence.
    const miss = scene({
        functions: [fn('f1', 'x^2 + 1'), fn('f2', '0')],
        tools: [points('P1', { source: 'intersections', ref1: 'f1', ref2: 'f2' })],
        view: { xmin: -3, xmax: 3, ymin: -3, ymax: 3 },
    });
    assert.deepEqual(
        issuesOf(miss, 'P1').map((i) => [i.severity, i.message]),
        [['info', 'f1 and f2 do not cross in the view']]
    );
});

/** Text box of a scene text in pt, as exported (same model as the placer: 0.56 em per character, 1.2 em high). */
function exportBox(t: TextPrim, view: View, m: LabelMetrics, marker = 0): { x0: number; y0: number; x1: number; y1: number } {
    const em = m.em[t.size];
    const len = t.text.replace(/\$/g, '').length;
    const w = len * 0.56 * em * (t.weight === 'bold' ? 1.08 : 1);
    const h = 1.2 * em;
    const X = ((t.x - view.xmin) / (view.xmax - view.xmin)) * m.w;
    const Y = ((t.y - view.ymin) / (view.ymax - view.ymin)) * m.h;
    const gap = 0.35 * em + marker;
    const sx = /right/.test(t.anchor) ? 1 : /left/.test(t.anchor) ? -1 : 0;
    const sy = /above/.test(t.anchor) ? 1 : /below/.test(t.anchor) ? -1 : 0;
    const x0 = sx > 0 ? X + gap : sx < 0 ? X - gap - w : X - w / 2;
    const y0 = sy > 0 ? Y + gap : sy < 0 ? Y - gap - h : Y - h / 2;
    return { x0, y0, x1: x0 + w, y1: y0 + h };
}

function boxesOverlap(a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }): boolean {
    return Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
}

test('label placer: LP labels clear of each other and of the lines through the optimum', () => {
    const c = lpExample();
    c.metrics = labelMetricsFor(10, 9);
    const s = scene(c);
    const opt = item(s, 'P1').texts[0];
    assert.equal(opt.text, 'x* = (3, 1)');
    assert.notEqual(opt.anchor, 'left', 'left of (3, 1) runs along all three lines');
    const corner = item(s, 'P2').texts.find((t) => t.text === '(3, 1)');
    assert.ok(corner && corner.anchor !== opt.anchor);
    // Every label box in the exported figure is clear of every other one.
    const all: Array<{ t: TextPrim; marker: number }> = [];
    for (const it of s.items) for (const t of it.texts) all.push({ t, marker: it.source === 'P1' ? 2.8 : it.source === 'P2' ? 2 : 0 });
    const boxes = all.map(({ t, marker }) => exportBox(t, c.view, c.metrics as LabelMetrics, marker));
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            assert.ok(!boxesOverlap(boxes[i], boxes[j]), `${all[i].t.text} overlaps ${all[j].t.text}`);
        }
    }
    // The optimum label crosses none of the lines through (3, 1).
    const m = c.metrics as LabelMetrics;
    const toPt = (p: Pt) => ({ x: ((p.x - c.view.xmin) / (c.view.xmax - c.view.xmin)) * m.w, y: ((p.y - c.view.ymin) / (c.view.ymax - c.view.ymin)) * m.h });
    const ob = boxes[all.findIndex((a) => a.t === opt)];
    for (const it of s.items) {
        for (const st of it.strokes) {
            for (const line of st.lines) {
                for (let k = 1; k < line.length; k++) {
                    const a = toPt(line[k - 1]);
                    const b = toPt(line[k]);
                    // Sample the segment: no sample strictly inside the box.
                    for (let q = 0; q <= 200; q++) {
                        const x = a.x + ((b.x - a.x) * q) / 200;
                        const y = a.y + ((b.y - a.y) * q) / 200;
                        assert.ok(!(x > ob.x0 + 1 && x < ob.x1 - 1 && y > ob.y0 + 1 && y < ob.y1 - 1), `x* label crosses ${it.source}`);
                    }
                }
            }
        }
    }
});

test('label placer: region labels stay inside their region and off centred axes and tick labels', () => {
    const ex = EXAMPLES.find((e) => e.id === 'areas');
    if (!ex) throw new Error('areas example missing');
    const d = migrateSettings(JSON.parse(JSON.stringify(ex.data))) as Record<string, unknown>;
    const view: View = { xmin: Number(d.xmin), xmax: Number(d.xmax), ymin: Number(d.ymin), ymax: Number(d.ymax) };
    const metrics = labelMetricsFor(Number(d.size_x_cm) || 10, Number(d.size_y_cm) || 10);
    for (const grid of [
        { nx: 113, ny: 48 },
        { nx: 200, ny: 200 },
        { nx: 225, ny: 97 },
    ]) {
        const s = scene({
            tools: d.tools as Tool[],
            functions: d.functions as FunctionParameters[],
            parameters: d.parameters as Parameter[],
            view,
            axisStyle: 'middle',
            grid,
            metrics,
        });
        assert.deepEqual(s.issues, []);
        for (const name of ['R1', 'R2']) {
            const it = item(s, name);
            const t = it.texts.find((x) => x.anchor === 'center');
            assert.ok(t, name);
            assert.equal(t.size, 'large');
            assert.equal(t.weight, 'bold');
            const b = exportBox(t, view, metrics);
            const yAxis = ((0 - view.ymin) / (view.ymax - view.ymin)) * metrics.h;
            // The x-axis line and the tick-label row below it (about 14 pt).
            assert.ok(b.y0 > yAxis || b.y1 < yAxis - 13, `${name} on the x-axis band at grid ${grid.nx}x${grid.ny}`);
            // The box corners lie inside the region.
            const rings = it.fills[0].rings;
            for (const [X, Y] of [
                [b.x0, b.y0],
                [b.x1, b.y0],
                [b.x1, b.y1],
                [b.x0, b.y1],
            ]) {
                const p = { x: view.xmin + (X / metrics.w) * (view.xmax - view.xmin), y: view.ymin + (Y / metrics.h) * (view.ymax - view.ymin) };
                assert.ok(pointInRingsTest(p, rings), `${name} box corner outside the region`);
            }
        }
    }
});

function pointInRingsTest(p: Pt, rings: Pt[][]): boolean {
    let inside = false;
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[i];
            const b = ring[j];
            if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        }
    }
    return inside;
}

// ---------------------------------------------------------------------- 3D

test('3D scene: points with labels and derived values, spliced segments, planes', () => {
    const tools: Tool[] = [
        points('P1', { dim: 3, points: '(1, 2, 3); (0, 0, h)', label: 'A{z}; B{z}', size: 'large' }),
        segment('S1', '(0, 0, 0); P1', { dim: 3, style: 'forward', closed: true }),
        plane('PL1', 'P1_z'),
        plane('PL2', 'h', { axis: 'x', hidden: true }),
        points('P2', { dim: 3, source: 'lattice' }),
        region('R1', ['x <= 1']),
        points('P3', { dim: 2, points: '(1, 1)' }),
    ];
    const math = MathContext.create({
        parameters: [{ name: 'h', value: 2, min: 0, max: 5, step: 1 }],
        toolNames: tools.map((t) => t.name),
    });
    const s = computeScene3D({ tools, math, view: { xmin: -5, xmax: 5, ymin: -5, ymax: 5, zmin: -5, zmax: 5 } });
    assert.deepEqual(
        s.points.map((p) => [p.x, p.y, p.z, p.label, p.size]),
        [
            [1, 2, 3, 'A3', 'large'],
            [0, 0, 2, 'B2', 'large'],
        ]
    );
    assert.equal(s.derived.P1_z, 3);
    assert.equal(s.derived.P1_z2, 2);
    assert.equal(s.derived.P1_n, 2);
    assert.equal(s.segments.length, 3);
    assert.deepEqual(s.segments[0].a, [0, 0, 0]);
    assert.deepEqual(s.segments[0].b, [1, 2, 3]);
    assert.deepEqual(s.segments[2].b, [0, 0, 0]);
    assert.ok(s.segments.every((x) => x.arrow === 'forward'));
    // PL1 reads P1_z (computed first); hidden PL2 draws nothing.
    assert.deepEqual(s.planes, [{ axis: 'z', value: 3, color: 'orange', opacity: 0.3 }]);
    const info = s.issues.filter((i) => i.source === 'P2');
    assert.equal(info.length, 1);
    assert.equal(info[0].severity, 'info');
    assert.equal(s.issues.length, 1, '2D tools are skipped silently');
});

test('3D scene: plane value errors and an empty tool list', () => {
    const tools: Tool[] = [plane('PL1', 'q +')];
    const math = MathContext.create({ toolNames: ['PL1'] });
    const view = { xmin: -1, xmax: 1, ymin: -1, ymax: 1, zmin: -1, zmax: 1 };
    const s = computeScene3D({ tools, math, view });
    assert.equal(s.issues[0].field, 'value');
    assert.equal(s.issues[0].severity, 'error');
    const e = computeScene3D({ tools: [], math, view });
    assert.deepEqual(e, { points: [], segments: [], planes: [], issues: [], derived: {} });
});

test('every 2D example renders without issues', () => {
    for (const ex of EXAMPLES) {
        if (ex.is3D) continue;
        const d = migrateSettings(JSON.parse(JSON.stringify(ex.data))) as Record<string, unknown>;
        const c: Chart = {
            tools: d.tools as Tool[],
            functions: d.functions as FunctionParameters[],
            parameters: d.parameters as Parameter[],
            view: { xmin: Number(d.xmin), xmax: Number(d.xmax), ymin: Number(d.ymin), ymax: Number(d.ymax) },
            axisStyle: d.axis_style as AxisStyle,
            grid: { nx: 200, ny: 200 },
        };
        const s = scene(c);
        assert.deepEqual(s.issues, [], ex.id);
        assert.ok(s.items.length > 0, ex.id);
    }
});

test('never throws on garbage input', () => {
    const math = MathContext.create({});
    const bad = computeScene2D({
        functions: [null as unknown as FunctionParameters],
        tools: [null as unknown as Tool, { type: 'region' } as unknown as Tool],
        math,
        view: { xmin: 0, xmax: 1, ymin: 0, ymax: 1 },
        grid: { nx: NaN, ny: 0 },
        axisStyle: 'box',
        polar: false,
    });
    assert.ok(Array.isArray(bad.items));
    const noView = computeScene2D({
        functions: [],
        tools: [],
        math,
        view: { xmin: 1, xmax: 0, ymin: 0, ymax: 1 },
        grid: { nx: 10, ny: 10 },
        axisStyle: 'box',
        polar: false,
    });
    assert.deepEqual(noView.items, []);
});

// --------------------------------------------- drag handles (SPEC3 4.6)

function handlesOf(s: Scene2D, source: string): HandlePrim[] {
    return item(s, source).handles || [];
}

/** Points as sorted [x, y] pairs (rounded), for order-free comparisons. */
function pairs(pts: Pt[] | undefined): number[][] {
    return (pts || []).map((p) => [Math.round(p.x * 1e9) / 1e9, Math.round(p.y * 1e9) / 1e9]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

test('handles: LP clauses with their corners, the objective level, locked corners and optimum', () => {
    const c = lpExample();
    const s = scene(c);
    const r1 = handlesOf(s, 'R1');
    assert.deepEqual(
        r1.map((h) => h.ref),
        [0, 1, 2, 3].map((entry) => ({ part: 'clause', entry, disjunct: 0, clause: 0 }))
    );
    assert.deepEqual(
        r1.map((h) => pairs(h.anchors)),
        [
            [
                [3, 1],
                [4, 0],
            ],
            [
                [0, 2],
                [3, 1],
            ],
            [
                [0, 0],
                [0, 2],
            ],
            [
                [0, 0],
                [4, 0],
            ],
        ]
    );
    // Every polyline lies on its clause's line: the constraint line plus the
    // boundary run for (1) and (2); only the run for the clauses on the view border.
    const onLine = [(p: Pt) => p.x + p.y - 4, (p: Pt) => p.x + 3 * p.y - 6, (p: Pt) => p.x, (p: Pt) => p.y];
    r1.forEach((h, k) => {
        const lines = h.lines || [];
        assert.equal(lines.length, k < 2 ? 2 : 1, `clause ${k + 1} line count`);
        for (const l of lines) for (const p of l) near(onLine[k](p), 0, 1e-9, `clause ${k + 1}`);
        assert.equal(h.point, undefined);
        assert.equal(h.locked, undefined);
    });
    // The constraint line is the drawn one (same objects as the stroke).
    assert.equal((r1[0].lines || [])[0], item(s, 'R1').strokes[0].lines[0]);
    assert.equal((r1[1].lines || [])[0], item(s, 'R1').strokes[0].lines[1]);

    const c1 = handlesOf(s, 'C1');
    assert.equal(c1.length, 1);
    assert.deepEqual(c1[0].ref, { part: 'level', index: 0, item: -1 });
    assert.deepEqual(c1[0].lines, item(s, 'C1').strokes[0].lines);

    const p2 = handlesOf(s, 'P2');
    assert.deepEqual(
        p2.map((h) => h.ref),
        [0, 1, 2, 3].map((index) => ({ part: 'point', index, item: -1 }))
    );
    assert.ok(p2.every((h) => h.locked === 'corner'));
    assert.deepEqual(
        p2.map((h) => [h.point?.x, h.point?.y]),
        item(s, 'P2').markers.map((m) => [m.x, m.y])
    );
    const p1 = handlesOf(s, 'P1');
    assert.equal(p1.length, 1);
    assert.equal(p1[0].locked, 'optimum');
    ptNear(p1[0].point as Pt, 3, 1);
});

test('handles: the same objects on a memo hit, new ones after a change', () => {
    const c = lpExample();
    const cache = new SceneCache();
    const math = contextOf(c);
    const a = scene(c, cache, math);
    const b = scene(c, cache, math);
    for (const src of ['R1', 'C1', 'P2', 'P1']) {
        assert.ok(handlesOf(a, src).length > 0, src);
        assert.equal(item(b, src).handles, item(a, src).handles, `${src} handles reused`);
    }
    (c.tools[0] as RegionTool).conditions[1] = 'x + 3y <= 6.6';
    const d = scene(c, cache, math);
    assert.notEqual(item(d, 'R1').handles, item(a, 'R1').handles);
    assert.deepEqual(pairs(handlesOf(d, 'R1')[1].anchors), [
        [0, 2.2],
        [2.7, 1.3],
    ]);
});

test('handles: clause positions in the DNF, boundary runs only when the region draws them', () => {
    const view = { xmin: 0, xmax: 5, ymin: 0, ymax: 4 };
    const s = scene({ tools: [region('R1', ['x <= 1 or x >= 3', 'y <= 2'])], view });
    const refs = handlesOf(s, 'R1').map((h) => h.ref);
    assert.deepEqual(refs, [
        { part: 'clause', entry: 0, disjunct: 0, clause: 0 },
        { part: 'clause', entry: 0, disjunct: 1, clause: 0 },
        { part: 'clause', entry: 1, disjunct: 0, clause: 0 },
    ]);
    // Fill only: the runs of x <= 1 lie on x = 1 (marching squares within a cell).
    for (const l of handlesOf(s, 'R1')[0].lines || []) for (const p of l) near(p.x, 1, 0.05);

    // A chain is one entry with two clauses; a blank entry keeps the index of the next.
    const chain = scene({ tools: [region('R1', ['', '1 <= x <= 2'], { fill: false, constraintLines: true })], view });
    assert.deepEqual(
        handlesOf(chain, 'R1').map((h) => h.ref),
        [
            { part: 'clause', entry: 1, disjunct: 0, clause: 0 },
            { part: 'clause', entry: 1, disjunct: 0, clause: 1 },
        ]
    );
    // Lines on, fill and outline off: the constraint lines only.
    const xs = handlesOf(chain, 'R1').map((h) => (h.lines || []).map((l) => l.map((p) => p.x)));
    assert.deepEqual(xs, [[[1, 1]], [[2, 2]]]);

    // Nothing drawn for a clause: no handle.
    const bare = scene({ tools: [region('R1', ['x <= 1'], { fill: false, outline: 'none', constraintLines: false })], view });
    assert.equal(item(bare, 'R1').handles, undefined);
    // Outline only: the boundary run is grabbable.
    const outlined = scene({ tools: [region('R1', ['x <= 1'], { fill: false, outline: 'solid' })], view });
    assert.equal(handlesOf(outlined, 'R1').length, 1);
});

test('handles: curve levels keep their list positions, also when an item waits for a derived value', () => {
    const view = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
    const s = scene({ tools: [curve('C1', 'x^2 + y^2', { levels: '1, 4, 2.25' })], view });
    const hs = handlesOf(s, 'C1');
    assert.deepEqual(
        hs.map((h) => h.ref),
        [0, 1, 2].map((k) => ({ part: 'level', index: k, item: k }))
    );
    hs.forEach((h, k) => {
        const r = [1, 2, 1.5][k];
        for (const l of h.lines || []) for (const p of l) near(Math.hypot(p.x, p.y), r, 0.05, `level ${k}`);
    });

    // P1 lists a point without an objective: P1_val is NaN, so the second item is skipped.
    const pending = scene({
        tools: [points('P1', { points: '(1, 1)' }), curve('C1', 'x^2 + y^2', { levels: '1, P1_val, 4' })],
        view,
    });
    assert.deepEqual(
        handlesOf(pending, 'C1').map((h) => h.ref),
        [
            { part: 'level', index: 0, item: 0 },
            { part: 'level', index: 1, item: 2 },
        ]
    );
});

test('handles: list points track their tuple through objective selection and pending items', () => {
    const view = { xmin: -1, xmax: 5, ymin: -1, ymax: 5 };
    const s = scene({ tools: [points('P1', { points: '(0, 0); (3, 1); (1, 2); (3, 1)', objective: '2x + 3y' })], view });
    const hs = handlesOf(s, 'P1');
    assert.deepEqual(
        hs.map((h) => h.ref),
        [
            { part: 'point', index: 0, item: 1 },
            { part: 'point', index: 1, item: 3 },
        ]
    );
    assert.ok(hs.every((h) => h.locked === undefined));

    // (P2_x, 2) waits for P2 (no points yet); the empty item is skipped like the parser does.
    const pending = scene({ tools: [points('P2'), points('P1', { points: '(1, 1); (P2_x, 2);; (3, 3)' })], view });
    const ph = handlesOf(pending, 'P1');
    assert.deepEqual(
        ph.map((h) => [h.ref, h.point?.x, h.point?.y]),
        [
            [{ part: 'point', index: 0, item: 0 }, 1, 1],
            [{ part: 'point', index: 1, item: 2 }, 3, 3],
        ]
    );
});

test('handles: computed points are locked by source', () => {
    const view = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
    const s = scene({
        functions: [fn('f1', 'x^2 - 1'), fn('f2', '1 - x^2')],
        tools: [
            points('P1', { source: 'intersections', ref1: 'f1', ref2: 'f2' }),
            region('R1', ['x >= 0', 'y >= 0', 'x + y <= 2']),
            points('P2', { source: 'lattice', regionName: 'R1' }),
            points('P3', { source: 'lattice', regionName: 'R1', objective: 'x + y' }),
            points('P4', { source: 'region', regionName: 'R1' }),
            points('P5', { source: 'region', regionName: 'R1', objective: 'x' }),
        ],
        view,
    });
    const lockOf = (src: string) => Array.from(new Set(handlesOf(s, src).map((h) => h.locked)));
    assert.deepEqual(lockOf('P1'), ['intersection']);
    assert.equal(handlesOf(s, 'P1').length, 2);
    assert.deepEqual(lockOf('P2'), ['lattice']);
    assert.equal(handlesOf(s, 'P2').length, 6);
    assert.deepEqual(lockOf('P3'), ['lattice']);
    assert.deepEqual(lockOf('P4'), ['corner']);
    assert.deepEqual(lockOf('P5'), ['optimum']);
    for (const src of ['P1', 'P2', 'P3', 'P4', 'P5']) assert.ok(handlesOf(s, src).every((h) => h.ref.part === 'point' && h.ref.item === -1), src);
});

test('handles: segment legs and vertices, spliced points, closing leg, brace', () => {
    const view = { xmin: -1, xmax: 6, ymin: -1, ymax: 6 };
    const s = scene({
        tools: [
            points('P1', { points: '(1, 1); (2, 2)' }),
            segment('S1', '(0, 0); P1; (4, 0)', { closed: true }),
            segment('S2', '(0, 0); (2, 0); (5, 5)', { style: 'brace' }),
            segment('S3', '(0, 1); (2, 3); (5, 1)', { style: 'forward' }),
        ],
        view,
    });
    const s1 = handlesOf(s, 'S1');
    const legs = s1.filter((h) => h.ref.part === 'leg');
    assert.deepEqual(
        legs.map((h) => [h.ref, pairs((h.lines || [])[0])]),
        [
            [{ part: 'leg', index: 0 }, [[0, 0], [1, 1]]],
            [{ part: 'leg', index: 1 }, [[1, 1], [2, 2]]],
            [{ part: 'leg', index: 2 }, [[2, 2], [4, 0]]],
            [{ part: 'leg', index: 3 }, [[0, 0], [4, 0]]],
        ]
    );
    const vertices = s1.filter((h) => h.ref.part === 'vertex');
    assert.deepEqual(
        vertices.map((h) => [h.ref, h.point?.x, h.point?.y]),
        [
            [{ part: 'vertex', index: 0, item: 0 }, 0, 0],
            [{ part: 'vertex', index: 1, item: -1 }, 1, 1],
            [{ part: 'vertex', index: 2, item: -1 }, 2, 2],
            [{ part: 'vertex', index: 3, item: 2 }, 4, 0],
        ]
    );
    // A brace draws from the first point to the second: one leg, two vertices.
    assert.deepEqual(
        handlesOf(s, 'S2').map((h) => h.ref),
        [
            { part: 'leg', index: 0 },
            { part: 'vertex', index: 0, item: 0 },
            { part: 'vertex', index: 1, item: 1 },
        ]
    );
    // Open arrow path: no closing leg.
    assert.equal(handlesOf(s, 'S3').filter((h) => h.ref.part === 'leg').length, 2);
});

test('handles: tangent (point and line) and extremum markers of a function', () => {
    const s = scene({
        functions: [fn('f1', 'x^2 - 1', { tangent: true, tangentPoint: '1', extrema: true })],
        tools: [],
        view: { xmin: -3, xmax: 3, ymin: -3, ymax: 3 },
    });
    const it = s.items.find((i) => i.kind === 'function' && i.source === 'f1') as SceneItem2D;
    assert.equal(it.key, '0');
    const hs = it.handles || [];
    assert.deepEqual(
        hs.map((h) => h.ref),
        [{ part: 'tangent' }, { part: 'extremum', index: 0 }]
    );
    ptNear(hs[0].point as Pt, 1, 0, 1e-9, 'tangent point');
    const line = (hs[0].lines || [])[0];
    assert.equal(line.length, 2);
    for (const p of line) near(p.y, 2 * p.x - 2, 1e-6, 'tangent line');
    ptNear(hs[1].point as Pt, 0, -1, 1e-6, 'minimum');
});

test('handles: hidden tools draw nothing and have no handles', () => {
    const s = scene({
        tools: [region('R1', ['x <= 1'], { hidden: true }), points('P1', { source: 'region', regionName: 'R1' })],
        view: { xmin: 0, xmax: 2, ymin: 0, ymax: 2 },
    });
    assert.ok(!s.items.some((i) => i.source === 'R1'));
    assert.ok(handlesOf(s, 'P1').every((h) => h.locked === 'corner'));
});
