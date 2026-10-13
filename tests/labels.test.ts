/*
 * Label placement (layoutTexts in src/scene.ts), on real charts.
 *
 * The placer has to keep every label of a chart readable: no stroke through
 * its text, no other label on it, all of it inside the plot frame. The
 * checks here take the charts where that failed before (steps of the
 * guides, the examples, and states of the Linear program example that the
 * overview video passes through) and test the placed labels with geometry
 * written for the test alone: segments of every stroke the picture draws,
 * the curves of the functions sampled as the preview samples them, and the
 * box of each text as the preview draws it (textBoxPt).
 *
 * Then: two labels of one point, the order of standing and moving labels,
 * the same picture from the same chart (with and without a cache), labels
 * that hold still during a gesture (keepLabels), the time the label pass
 * takes, the shift in the exported code, and centred 3D labels on an edge
 * of the box.
 */
import { test, assert, near } from './_lib';
import { ChartData, GUIDES, stepChart } from '../src/guides';
import { MathContext } from '../src/mathcontext';
import { EXAMPLES } from '../src/migrate';
import { LabelMetrics, Scene2D, SceneCache, SceneInput2D, TextPrim, computeScene2D, edgeLabelSide3D, labelMetricsFor, textBoxPt } from '../src/scene';
import { SettingsManager } from '../src/settings';
import { Parameter, RendererConfig, Tool } from '../src/types';
import { previewCamera3D } from '../src/export';
import { marchingGrid, sampleCurve } from '../src/util';

// ----------------------------------------------------------------- helpers

interface Pt {
    x: number;
    y: number;
}

interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

interface View {
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function guideStep(id: string, step: number): ChartData {
    const guide = GUIDES.find((g) => g.id === id);
    if (!guide) throw new Error(`no guide '${id}'`);
    const chart = stepChart(guide, step - 1);
    if (!chart) throw new Error(`guide '${id}' has no chart at step ${step}`);
    return clone(chart);
}

function example(id: string): Record<string, unknown> {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) throw new Error(`no example '${id}'`);
    return clone(ex.data);
}

function toolOf(chart: ChartData, name: string): Record<string, unknown> {
    const tool = (chart.tools as Array<Record<string, unknown>>).find((t) => t.name === name);
    if (!tool) throw new Error(`no tool '${name}'`);
    return tool;
}

/** The Linear program example in three states of the overview video. */
function lpTurned(): ChartData {
    // After the Shift-turn past constraint (2): the optimum is the corner (0, 2).
    const chart = example('lp');
    toolOf(chart, 'C1').equation = '0.5x + 3y = c';
    toolOf(chart, 'P1').objective = '0.5x + 3y';
    (chart.parameters as Parameter[])[0].value = 6;
    return chart;
}

function lpLimit3(c: number): ChartData {
    // After typing the limit 3 into condition (1): the optimum is (1.5, 1.5); the line is then dragged from 9 to 7.5.
    const chart = example('lp');
    (toolOf(chart, 'R1').conditions as string[])[0] = 'x + y <= 3';
    (chart.parameters as Parameter[])[0].value = c;
    return chart;
}

/** A chart as the preview computes it: its context, config, view, metrics and the scene input. */
interface Loaded {
    math: MathContext;
    config: RendererConfig;
    view: View;
    metrics: LabelMetrics;
    input: SceneInput2D;
}

function load(chart: ChartData, quality: 'draft' | 'full' = 'full'): Loaded {
    const settings = SettingsManager.fromJSON(clone(chart));
    const math = settings.createMathContext({ memo: false });
    const config = settings.toRendererConfig(math);
    const view = { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax };
    const metrics = labelMetricsFor(config.paperWidthCm ?? 10, config.paperHeightCm ?? 10);
    const input: SceneInput2D = {
        functions: config.functions || [],
        tools: config.tools as Tool[],
        math,
        view,
        // About the plot the preview draws (its canvas less the paddings).
        grid: marchingGrid(config.width * 0.85, config.height * 0.8, 1, quality),
        axisStyle: config.axisStyle,
        polar: config.coordinateSystem === 'polar',
        labelMetrics: metrics,
    };
    return { math, config, view, metrics, input };
}

interface Label {
    source: string;
    text: TextPrim;
    box: Box;
}

function labelsOf(scene: Scene2D, c: Loaded): Label[] {
    const out: Label[] = [];
    for (const item of scene.items) for (const text of item.texts) out.push({ source: item.source, text, box: textBoxPt(text, c.view, c.metrics) });
    return out;
}

/** Every line the picture draws, in pt of the plot (origin bottom-left): scene strokes and guides, function curves, centred axes. */
function drawnLines(scene: Scene2D, c: Loaded): Array<{ name: string; pts: Pt[] }> {
    const { view, metrics, config, math } = c;
    const toPt = (p: Pt): Pt => ({ x: ((p.x - view.xmin) / (view.xmax - view.xmin)) * metrics.w, y: ((p.y - view.ymin) / (view.ymax - view.ymin)) * metrics.h });
    const lines: Array<{ name: string; pts: Pt[] }> = [];
    for (const item of scene.items) {
        for (const stroke of [...item.strokes, ...item.guides]) {
            for (const line of stroke.lines) {
                const pts = line.map(toPt);
                if (stroke.closed && pts.length > 2) pts.push(pts[0]);
                lines.push({ name: item.source, pts });
            }
        }
    }
    // The curves, sampled as the preview draws them (renderer.ts sampleFunction: 500 samples).
    for (const info of math.functions()) {
        const f = (config.functions || [])[info.index];
        if (!f || info.hidden || info.error || info.domainError || !String(f.expression ?? '').trim()) continue;
        const fn = info.fn;
        let sampled: Pt[][];
        if (info.kind === 'cartesian') {
            const lo = info.domain ? Math.max(info.domain[0], view.xmin) : view.xmin;
            const hi = info.domain ? Math.min(info.domain[1], view.xmax) : view.xmax;
            sampled = sampleCurve((x) => ({ x, y: fn(x) }), lo, hi, 500, view);
        } else {
            const [lo, hi] = info.domain || [0, 2 * Math.PI];
            const fy = info.fnY;
            if (info.kind === 'parametric') sampled = fy ? sampleCurve((t) => ({ x: fn(t), y: fy(t) }), lo, hi, 500, view) : [];
            else sampled = sampleCurve((t) => ({ x: fn(t) * Math.cos(t), y: fn(t) * Math.sin(t) }), lo, hi, 500, view);
        }
        for (const line of sampled) lines.push({ name: info.name, pts: line.map(toPt) });
    }
    if (config.axisStyle === 'middle') {
        if (view.ymin < 0 && view.ymax > 0) lines.push({ name: 'the x axis', pts: [toPt({ x: view.xmin, y: 0 }), toPt({ x: view.xmax, y: 0 })] });
        if (view.xmin < 0 && view.xmax > 0) lines.push({ name: 'the y axis', pts: [toPt({ x: 0, y: view.ymin }), toPt({ x: 0, y: view.ymax })] });
    }
    return lines;
}

/** True when segment a-b has a point strictly inside the box (Cohen-Sutherland style clipping, written for the test). */
function segmentInBox(a: Pt, b: Pt, r: Box): boolean {
    let t0 = 0;
    let t1 = 1;
    const d = { x: b.x - a.x, y: b.y - a.y };
    const edges: Array<[number, number]> = [
        [-d.x, a.x - r.x0],
        [d.x, r.x1 - a.x],
        [-d.y, a.y - r.y0],
        [d.y, r.y1 - a.y],
    ];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q <= 0) return false;
            continue;
        }
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
    }
    return t0 < t1;
}

/** A box drawn in: what counts as "through the text" leaves the outermost half point to rounding and glyph side bearings. */
const INK_PT = 0.5;
/** A label must lie at least this far inside the plot frame. */
const FRAME_PT = 1;

function shrink(b: Box, by: number): Box {
    return { x0: b.x0 + by, y0: b.y0 + by, x1: b.x1 - by, y1: b.y1 - by };
}

/** Everything wrong with the labels of a scene, as readable lines; empty when every label is clean. */
function collisions(scene: Scene2D, c: Loaded): string[] {
    const labels = labelsOf(scene, c);
    const lines = drawnLines(scene, c);
    const out: string[] = [];
    labels.forEach((label, i) => {
        const name = `"${label.text.text}" of ${label.source} (${label.text.anchor})`;
        const ink = shrink(label.box, INK_PT);
        for (const line of lines) {
            let hit = false;
            for (let k = 1; k < line.pts.length && !hit; k++) hit = segmentInBox(line.pts[k - 1], line.pts[k], ink);
            if (hit) out.push(`${name} is crossed by a line of ${line.name}`);
        }
        for (let j = i + 1; j < labels.length; j++) {
            const other = shrink(labels[j].box, INK_PT);
            if (Math.min(ink.x1, other.x1) > Math.max(ink.x0, other.x0) && Math.min(ink.y1, other.y1) > Math.max(ink.y0, other.y0)) {
                out.push(`${name} overlaps "${labels[j].text.text}" of ${labels[j].source}`);
            }
        }
        for (const item of scene.items) {
            for (const m of item.markers) {
                const X = ((m.x - c.view.xmin) / (c.view.xmax - c.view.xmin)) * c.metrics.w;
                const Y = ((m.y - c.view.ymin) / (c.view.ymax - c.view.ymin)) * c.metrics.h;
                if (X > ink.x0 && X < ink.x1 && Y > ink.y0 && Y < ink.y1) out.push(`${name} covers a marker of ${item.source}`);
            }
        }
        const b = label.box;
        if (b.x0 < FRAME_PT || b.y0 < FRAME_PT || b.x1 > c.metrics.w - FRAME_PT || b.y1 > c.metrics.h - FRAME_PT) out.push(`${name} is not inside the plot frame`);
    });
    return out;
}

function sceneOf(chart: ChartData): { scene: Scene2D; c: Loaded } {
    const c = load(chart);
    const scene = computeScene2D(c.input);
    assert.deepEqual(scene.issues, [], 'the chart loads without issues');
    return { scene, c };
}

function textOf(scene: Scene2D, source: string, text: string): TextPrim {
    const item = scene.items.find((i) => i.source === source);
    const t = item && item.texts.find((x) => x.text === text);
    if (!t) throw new Error(`no label "${text}" on ${source}; it has: ${item ? item.texts.map((x) => x.text).join(' | ') : 'no such item'}`);
    return t;
}

/** What identifies where a label sits. */
function spotOf(t: TextPrim): string {
    const o = t.offset ? ` +(${t.offset.x.toFixed(2)}, ${t.offset.y.toFixed(2)})` : '';
    return `${t.text} @ ${t.x.toFixed(6)}, ${t.y.toFixed(6)} ${t.anchor}${o}`;
}

function spots(scene: Scene2D): string[] {
    const out: string[] = [];
    for (const item of scene.items) for (const t of item.texts) out.push(`${item.source}: ${spotOf(t)}`);
    return out;
}

// ------------------------------------------------------------ known charts

/** The charts whose labels were struck, stacked or clipped before the placer scored strokes, curves and the frame. */
const KNOWN: Array<[string, () => ChartData]> = [
    ['linear-program step 7: "(0, 3)" under the dashed objective line', () => guideStep('linear-program', 7)],
    ['linear-program step 8', () => guideStep('linear-program', 8)],
    ['level-curves step 3: level label "2" on the right frame, "(3.5, 1.75)" under level curve 4', () => guideStep('level-curves', 3)],
    ['level-curves step 4', () => guideStep('level-curves', 4)],
    ['level-curves step 5', () => guideStep('level-curves', 5)],
    ['level-curves step 6', () => guideStep('level-curves', 6)],
    ['tangent-area step 8: "(1.72, -0.5)" under the curve', () => guideStep('tangent-area', 8)],
    ['points-labels step 4: "(2, 2)" and "(7, 3.25)" on the line f2', () => guideStep('points-labels', 4)],
    ['points-labels step 5', () => guideStep('points-labels', 5)],
    ['overview video: the line turned, "x* = (0, 2)" on "(0, 2)"', lpTurned],
    ['overview video: limit 3 typed, "(1.5, 1.5)" under constraint line (2)', () => lpLimit3(9)],
    ['overview video: line on the new optimum, "(3, 0)" on the end of line (1)', () => lpLimit3(7.5)],
    ['example Linear program', () => example('lp')],
    ['example Tangent explorer', () => example('tangent')],
    ['example Level curves and a constraint', () => example('levels')],
    ['example Market equilibrium', () => example('surplus')],
    ['example Areas between two curves', () => example('areas')],
];

for (const [name, chart] of KNOWN) {
    test(`labels are clear of strokes, curves, labels and the frame: ${name}`, () => {
        const { scene, c } = sceneOf(chart());
        assert.ok(labelsOf(scene, c).length > 0, 'the chart has labels');
        assert.deepEqual(collisions(scene, c), []);
    });
}

test('the checker itself finds a struck, a stacked and a clipped label', () => {
    // The same geometry on a picture that is wrong on purpose: labels forced onto the worst side.
    const { scene, c } = sceneOf(lpTurned());
    const opt = textOf(scene, 'P1', 'x* = (0, 2)');
    const corner = textOf(scene, 'P2', '(0, 2)');
    corner.anchor = opt.anchor;
    delete corner.offset;
    assert.ok(collisions(scene, c).some((line) => /overlaps/.test(line)), 'two labels on one side overlap');
    corner.anchor = 'left';
    assert.ok(collisions(scene, c).some((line) => /not inside the plot frame/.test(line)), 'left of x = 0 is outside');
    corner.anchor = 'right';
    assert.ok(collisions(scene, c).some((line) => /crossed by a line of (R1|C1)/.test(line)), 'right of (0, 2) the lines through it cross the text');
});

// ------------------------------------------------------- placement rules

test('two labels of one point sit on different sides, or as two lines', () => {
    // The corner (0, 2) is also the optimum: its two labels come from two tools.
    const turned = sceneOf(lpTurned());
    const opt = textOf(turned.scene, 'P1', 'x* = (0, 2)');
    const corner = textOf(turned.scene, 'P2', '(0, 2)');
    assert.notEqual(opt.anchor, corner.anchor, 'different sides of (0, 2)');
    // Both keep to the right of the frame at x = 0.
    for (const t of [opt, corner]) assert.ok(/right/.test(t.anchor), `${t.text} is ${t.anchor}`);

    // At (3, 1) of the example as it ships, too.
    const lp = sceneOf(example('lp'));
    assert.notEqual(textOf(lp.scene, 'P1', 'x* = (3, 1)').anchor, textOf(lp.scene, 'P2', '(3, 1)').anchor);

    // No free second side at (1.5, 1.5): three lines run through the point. The labels then stand as two lines on one side.
    const tight = sceneOf(lpLimit3(9));
    const a = textBoxPt(textOf(tight.scene, 'P1', 'x* = (1.5, 1.5)'), tight.c.view, tight.c.metrics);
    const b = textBoxPt(textOf(tight.scene, 'P2', '(1.5, 1.5)'), tight.c.view, tight.c.metrics);
    const overlap = Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
    assert.equal(overlap, false, 'the two labels of (1.5, 1.5) do not cover each other');
});

test('a clear label keeps its natural side and place', () => {
    // Nothing near the points: above right of each, no shift.
    const chart = example('lp');
    chart.tools = [{ ...toolOf(example('lp'), 'P2'), source: 'list', points: '(1, 1); (2.5, 3); (4, 2)', regionName: '' }];
    const { scene } = sceneOf(chart);
    for (const t of scene.items[0].texts) {
        assert.equal(t.anchor, 'above right', t.text);
        assert.equal(t.offset, undefined, t.text);
    }
    // min and max of a function: below and above while nothing runs there.
    const calm = example('tangent');
    (calm.parameters as Parameter[])[0].value = -1;
    const f1 = sceneOf(calm).scene.items.find((i) => i.source === 'f1');
    assert.deepEqual(
        (f1 ? f1.texts : []).map((t) => [t.text, t.anchor]),
        [
            ['max', 'above'],
            ['min', 'below'],
        ]
    );
});

test('Tangent explorer: the picture it opens with has no text under the tangent', () => {
    const chart = example('tangent');
    // The live slope is the title; no text label sits inside the plot, where the tangent sweeps.
    assert.equal(chart.title, 'slope at x = {a}: {3a^2 - 3:2}');
    assert.deepEqual(chart.annotations, []);
    assert.equal((chart.parameters as Parameter[])[0].value, 0.5);
    const { scene, c } = sceneOf(chart);
    assert.equal(c.math.formatTemplate(String(chart.title)), 'slope at x = 0.5: -2.25');
    // At a = 0.5 the tangent passes through the maximum (-1, 2): "max" steps off the line.
    assert.notEqual(textOf(scene, 'f1', 'max').anchor, 'above');
    assert.deepEqual(collisions(scene, c), []);
    // And for every value of the slider.
    const params = clone(c.config.parameters) as Parameter[];
    for (let k = -40; k <= 40; k++) {
        params[0].value = k / 20;
        c.math.setParams(params);
        const s = computeScene2D(c.input);
        assert.deepEqual(collisions(s, c), [], `a = ${k / 20}`);
    }
});

test('a label of a line slides along its line to a clear place and stays on it', () => {
    // level-curves step 3: the level labels sat where the curves leave the plot, "2" on the frame.
    const { scene, c } = sceneOf(guideStep('level-curves', 3));
    const c1 = scene.items.find((i) => i.source === 'C1');
    if (!c1) throw new Error('no C1');
    assert.deepEqual(c1.texts.map((t) => t.text).sort(), ['2', '4', '8']);
    for (const t of c1.texts) {
        // On its own level curve x y = level ...
        near(t.x * t.y, Number(t.text), 0.02, `label ${t.text} lies on its curve`);
        // ... and well inside the plot.
        const b = textBoxPt(t, c.view, c.metrics);
        assert.ok(b.x0 > 2 && b.y0 > 2 && b.x1 < c.metrics.w - 2 && b.y1 < c.metrics.h - 2, `label ${t.text} inside`);
    }
});

/** Where a label sits relative to its point or line: side, ring and nudge, whatever its text says. */
function placeOf(t: TextPrim): string {
    return `${t.anchor}|${t.offset ? `${Math.sign(Math.round(t.offset.x))},${Math.round(t.offset.y)}` : ''}`;
}

test('labels of shapes that stand still are placed before labels of shapes on a slider', () => {
    // In the Linear program example only the objective line follows the slider c. Its label is placed
    // last, so it never takes a spot from the labels of the constraints, the corners and the optimum:
    // they sit exactly where they sit when the line has no label at all, for every value of c.
    const withLabel = load(example('lp'), 'draft');
    const bare = example('lp');
    toolOf(bare, 'C1').label = '';
    const without = load(bare, 'draft');
    const params = clone(withLabel.config.parameters) as Parameter[];
    let hits = 0;
    let pushed = 0;
    for (let k = 0; k <= 150; k++) {
        params[0].value = k / 10;
        withLabel.math.setParams(params);
        without.math.setParams(params);
        const a = computeScene2D(withLabel.input);
        const b = computeScene2D(without.input);
        hits += collisions(a, withLabel).length;
        const standing = (scene: Scene2D) => spots({ ...scene, items: scene.items.filter((i) => i.source !== 'C1') });
        if (standing(a).join('\n') !== standing(b).join('\n')) pushed++;
    }
    assert.equal(pushed, 0, `the label of the moving line pushed a standing label aside in ${pushed} of 151 frames`);
    // Along the whole sweep hardly a frame has a struck label: the placer finds a clear spot almost everywhere.
    assert.ok(hits <= 6, `${hits} collisions in 151 frames`);
});

// ------------------------------------------------- determinism and gestures

test('the same chart gives the same labels: fresh, repeated, with a cache, and after a gesture', () => {
    for (const make of [() => example('lp'), () => example('levels'), () => guideStep('level-curves', 6), () => guideStep('points-labels', 5), lpTurned]) {
        const fresh = spots(computeScene2D(load(make()).input));
        // Twice from one context.
        const c = load(make());
        assert.deepEqual(spots(computeScene2D(c.input)), fresh);
        assert.deepEqual(spots(computeScene2D(c.input)), fresh);
        // With a cache: first frame and memoised frame.
        const cached = { ...load(make()).input, cache: new SceneCache() };
        assert.deepEqual(spots(computeScene2D(cached)), fresh);
        assert.deepEqual(spots(computeScene2D(cached)), fresh);
    }
    // A gesture with keepLabels leaves labels where they were; the frame that settles the picture
    // (keepLabels unset) is again exactly the fresh picture, and so equals what the export computes.
    const c = load(example('lp'), 'draft');
    const cache = new SceneCache();
    const params = clone(c.config.parameters) as Parameter[];
    for (let k = 90; k <= 120; k++) {
        params[0].value = k / 10;
        c.math.setParams(params);
        computeScene2D({ ...c.input, cache, keepLabels: true });
    }
    const settled = spots(computeScene2D({ ...c.input, cache }));
    const end = example('lp');
    (end.parameters as Parameter[])[0].value = 12;
    assert.deepEqual(settled, spots(computeScene2D(load(end, 'draft').input)));
});

test('keepLabels: during a gesture a label moves only when something reaches it', () => {
    const sweep = (keepLabels: boolean): { moves: number; hits: number; perLabel: Map<string, number> } => {
        const c = load(example('lp'), 'draft');
        const cache = new SceneCache();
        const params = clone(c.config.parameters) as Parameter[];
        const last = new Map<string, string>();
        const perLabel = new Map<string, number>();
        let moves = 0;
        let hits = 0;
        for (let k = 0; k <= 150; k++) {
            params[0].value = k / 10;
            c.math.setParams(params);
            const scene = computeScene2D({ ...c.input, cache, keepLabels });
            hits += collisions(scene, c).length;
            for (const item of scene.items) {
                for (const [i, t] of item.texts.entries()) {
                    const key = `${item.source}#${i}`;
                    const spot = placeOf(t);
                    const before = last.get(key);
                    if (before !== undefined && before !== spot) {
                        moves++;
                        perLabel.set(key, (perLabel.get(key) || 0) + 1);
                    }
                    last.set(key, spot);
                }
            }
        }
        return { moves, hits, perLabel };
    };
    const pure = sweep(false);
    const kept = sweep(true);
    // At most half the moves, and no label struck more often than without it.
    assert.ok(kept.moves * 2 <= pure.moves, `kept ${kept.moves} moves, pure ${pure.moves}`);
    assert.ok(kept.hits <= pure.hits, `kept ${kept.hits} collisions, pure ${pure.hits}`);
    // The label of the moving line itself changes its place a few times in 151 frames, not every few frames;
    // the labels of the constraints, which the line passes once, step aside at most once or twice.
    assert.ok((kept.perLabel.get('C1#0') || 0) <= 9, `z label moved ${kept.perLabel.get('C1#0')} times`);
    for (const key of ['R1#0', 'R1#1']) assert.ok((kept.perLabel.get(key) || 0) <= 2, `${key} moved ${kept.perLabel.get(key)} times`);
    // Without a cache there is nothing to keep: the flag alone changes nothing.
    const c = load(example('lp'));
    assert.deepEqual(spots(computeScene2D({ ...c.input, keepLabels: true })), spots(computeScene2D(c.input)));
});

test('the label pass of the Linear program example takes well under a millisecond', () => {
    // A frame whose shapes all come from the memo is label formatting and placement, plus fixed overhead.
    // Subtracting the same frame without labels leaves the label pass.
    const frame = (labels: boolean): number => {
        const chart = example('lp');
        if (!labels) {
            for (const t of chart.tools as Array<Record<string, unknown>>) {
                t.label = '';
                if (Array.isArray(t.conditionLabels)) t.conditionLabels = (t.conditionLabels as string[]).map(() => '');
            }
        }
        const input = { ...load(chart).input, cache: new SceneCache() };
        for (let i = 0; i < 200; i++) computeScene2D(input);
        // Median of batches, so a pause of the machine does not count.
        const batches: number[] = [];
        for (let b = 0; b < 15; b++) {
            const t0 = process.hrtime.bigint();
            for (let i = 0; i < 100; i++) computeScene2D(input);
            batches.push(Number(process.hrtime.bigint() - t0) / 1e6 / 100);
        }
        batches.sort((x, y) => x - y);
        return batches[Math.floor(batches.length / 2)];
    };
    const withLabels = frame(true);
    const without = frame(false);
    const pass = withLabels - without;
    assert.ok(pass < 1, `label pass ${pass.toFixed(3)} ms (frame ${withLabels.toFixed(3)} ms with labels, ${without.toFixed(3)} ms without)`);
});

// ------------------------------------------------------------------ export

test('the export writes the placer\'s shift as xshift / yshift, so the PDF matches the preview', () => {
    const chart = lpLimit3(9);
    const { scene } = sceneOf(chart);
    const corner = textOf(scene, 'P2', '(1.5, 1.5)');
    assert.ok(corner.offset, '"(1.5, 1.5)" has no room right beside its point: it is shifted');
    const code = SettingsManager.fromJSON(clone(chart)).generateTikzCode();
    const node = code.split('\n').find((line) => line.includes('{(1.5, 1.5)}') && !line.includes('x^*'));
    assert.ok(node, 'the corner label is in the code');
    const anchors: Record<string, string> = { 'above right': 'south west', 'above left': 'south east', 'below right': 'north west', 'below left': 'north east', above: 'south', below: 'north', left: 'east', right: 'west' };
    assert.ok(node.includes(`anchor=${anchors[corner.anchor]},`), node);
    assert.ok(node.includes('at (axis cs:1.5,1.5)'), 'the node keeps the coordinates of its point');
    const shift = (axis: 'x' | 'y'): number => {
        const m = new RegExp(`${axis}shift=(-?[0-9.]+)pt`).exec(node);
        return m ? Number(m[1]) : 0;
    };
    const offset = corner.offset as Pt;
    near(shift('x'), offset.x, 0.006, 'xshift');
    near(shift('y'), offset.y, 0.006, 'yshift');
    // A label right beside its point has no shift in the code.
    const plain = code.split('\n').find((line) => line.includes('{(0, 0)}'));
    assert.ok(plain && !/shift/.test(plain), plain);
});

test('centred axes: the exported title is lifted over the y label above the axis tip', () => {
    // Tangent explorer: the y axis is in the middle of the plot, so its label "y" and the title share one spot in pgfplots.
    const code = SettingsManager.fromJSON(example('tangent')).generateTikzCode();
    assert.ok(code.includes('title={slope at x = 0.5: -2.25}'), 'the title prints the slope');
    assert.ok(code.includes('ylabel style={anchor=south}'), 'the y label stands above the tip of its axis');
    assert.ok(/title style=\{yshift=15pt\}/.test(code), 'the title is lifted over it');
    // No title, axis labels off, or another axis style: nothing to lift.
    const lifted = (change: (chart: Record<string, unknown>) => void): boolean => {
        const chart = example('tangent');
        change(chart);
        return /title style=/.test(SettingsManager.fromJSON(chart).generateTikzCode());
    };
    assert.equal(lifted((c) => (c.title = '')), false);
    assert.equal(lifted((c) => (c.show_axis_label = false)), false);
    assert.equal(lifted((c) => (c.axis_style = 'box')), false);
    assert.equal(lifted((c) => (c.axis_style = 'axes')), false);
});

// ---------------------------------------------------------------------- 3D

test('3D: a centred label on an edge of the box steps to the side away from the box', () => {
    // surfaces-3d step 7: "z = {h}" at (5.5, -5.5, h), a corner of the plane on a vertical edge of the box.
    const chart = guideStep('surfaces-3d', 7);
    const settings = SettingsManager.fromJSON(clone(chart));
    const math = settings.createMathContext({ memo: false });
    const config = settings.toRendererConfig(math);
    const cam = previewCamera3D(config);
    const box = { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax, zmin: config.zmin, zmax: config.zmax };
    const side = (p: [number, number, number]) => edgeLabelSide3D(p, box, cam.ex, cam.ey, cam.ez);
    const label = (config.annotations || [])[0];
    assert.equal(label.anchor, 'center');
    const at: [number, number, number] = [math.value(label.x), math.value(label.y), math.value(String(label.z))];
    assert.deepEqual(at, [5.5, -5.5, 1]);
    // That edge is the right outline of the box for this camera (rotation 60, tilt 20).
    assert.equal(side(at), 'right');
    // The opposite vertical edge: the left outline.
    assert.equal(side([-5.5, 5.5, 1]), 'left');
    // The same along the whole edge, whatever the slider h says.
    assert.equal(side([5.5, -5.5, -20]), 'right');
    // Inside the box, on a face, or outside: the label stays where it was put.
    assert.equal(side([0, 0, 0]), null);
    assert.equal(side([5.5, 0, 0]), null);
    assert.equal(side([5.5, -5.5, 99]), null);
    assert.equal(side([NaN, -5.5, 1]), null);
    // Edges of the top and bottom faces: above and below.
    assert.equal(side([0, 5.5, box.zmax]), 'above');
    assert.equal(side([0, -5.5, box.zmin]), 'below');
    // A corner: away from the middle of the box.
    assert.equal(side([5.5, -5.5, box.zmax]), 'right');

    // The export puts the node on the same side (anchor=west is "right of the point"), at the same coordinates.
    const code = settings.generateTikzCode(math);
    const node = code.split('\n').find((line) => line.includes('{z = 1}'));
    assert.ok(node && node.includes('anchor=west') && node.includes('at (axis cs:5.5,-5.5,1)'), node);
    // A side the user chose is kept.
    const fixed = clone(chart);
    (fixed.annotations as Array<Record<string, unknown>>)[0].anchor = 'above';
    const fixedNode = SettingsManager.fromJSON(fixed).generateTikzCode().split('\n').find((line) => line.includes('{z = 1}'));
    assert.ok(fixedNode && fixedNode.includes('anchor=south'), fixedNode);
});
