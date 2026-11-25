/*
 * Step entrances (6.0): the kind of entrance of every object, the easing and
 * timing of each kind (a curve 0.7 s, an area 0.6 s, points 0.35 s with a
 * stagger, labels just after their object), the frames the player hands out
 * (a step coming in, Previous fading the step that leaves, Play waiting for
 * a step to come in), the shapes as far as they have come in, and the off
 * switches: the chart line `set entrances = off`, the plugin setting, less
 * motion, and the still frame of the export.
 */
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText, printFullText } from '../src/text/print';
import { canonical } from '../src/chartdata';
import {
    ENTRANCE_MS,
    LEAVE_MS,
    POP_STAGGER_MAX_MS,
    RISE_PX,
    StepEntrance,
    chartEntrances,
    clipSegment,
    easeOut,
    entranceMs,
    entrancesOn,
    grownLine,
    middleOf,
    nearestOn,
    objectKind,
    partialLine,
    partialLines,
    popDelay,
    popScale,
    riseAt,
    rippleOpacity,
    rippleStops,
    setStepEntrances,
    stepEntrancesSetting,
    stepTiming,
    toolKind,
} from '../src/motion6/entrances';
import { HOLD_MS, PROGRESS_MS, STEP_MS, StepTimeline } from '../src/motion6/timeline';
import { stepProgress } from '../src/motion6/steps';
import { STILL, stillFrame } from '../src/motion6/clock';
import type { MotionFrame } from '../src/types';

type Data = Record<string, unknown>;

const chartOf = (text: string): Data => {
    const r = parseChartText(text);
    assert.deepEqual(r.problems, [], text);
    return r.data;
};

/** The calculus chart of the demo: f, then P, then the tangent, then the area with a label. */
const CALCULUS = [
    'show x from -3.2 to 3.2 and y from -3.4 to 3.4',
    'plot f(x) = x^3 - 3x in blue, thick',
    'then P: mark (0.8, f(0.8)), labelled "P"',
    'then plot g(x) = x^3 - 3x in blue, thick, with its tangent at 0.8',
    'plot h(x) = f(0.8) + (3*0.8^2 - 3)(x - 0.8), hidden',
    'then shade between f and h from x = -1.6 to 0.8 in orange, labelled "A"',
    'write "area" at (-0.5, 0.5)',
].join('\n');

const go = (tl: StepTimeline, k: number, o: Partial<{ motion: boolean; entrances: boolean; ms: number; fromPlay: boolean }> = {}) =>
    tl.go(k, { motion: o.motion ?? true, entrances: o.entrances ?? true, enterMs: () => o.ms ?? 770, fromPlay: o.fromPlay });

/** Advance in frames of 1/60 s until nothing is under way; returns the frames and what the last one asked for. */
function runOut(tl: StepTimeline, playing = false): { frames: number; last: string } {
    let frames = 0;
    let last = 'none';
    for (let i = 0; i < 600; i++) {
        last = tl.advance(1000 / 60, playing);
        frames++;
        if (last !== 'frame') break;
    }
    return { frames, last };
}

// ---------------------------------------------------------------- kinds

test('kinds: each object enters in its own way', () => {
    assert.equal(objectKind('functions', {}), 'draw');
    assert.equal(objectKind('functions3D', {}), 'surface');
    assert.equal(objectKind('annotations', {}), 'rise');
    const kind = (tool: Data) => objectKind('tools', tool);
    assert.equal(kind({ type: 'region' }), 'sweep');
    assert.equal(kind({ type: 'unitSquare' }), 'sweep');
    assert.equal(kind({ type: 'axisSet' }), 'sweep');
    assert.equal(kind({ type: 'riemann' }), 'sweep');
    assert.equal(kind({ type: 'points' }), 'pop');
    assert.equal(kind({ type: 'restPoints' }), 'pop');
    assert.equal(kind({ type: 'eigenvectors' }), 'grow');
    assert.equal(kind({ type: 'vector' }), 'arrow');
    assert.equal(kind({ type: 'basisVectors' }), 'arrow');
    assert.equal(kind({ type: 'segment', style: 'forward' }), 'arrow');
    assert.equal(kind({ type: 'segment', style: 'line' }), 'draw');
    assert.equal(kind({ type: 'segment', style: 'brace' }), 'fade');
    assert.equal(kind({ type: 'vectorField' }), 'ripple');
    assert.equal(kind({ type: 'planeGrid' }), 'ripple');
    assert.equal(kind({ type: 'colourPlane' }), 'ripple');
    assert.equal(kind({ type: 'trajectory' }), 'draw');
    assert.equal(kind({ type: 'orbit' }), 'draw');
    assert.equal(kind({ type: 'curve' }), 'draw');
    // A traced solution draws itself on the clock already; a transform moves the plane.
    assert.equal(kind({ type: 'trajectory', traced: true }), 'fade');
    assert.equal(kind({ type: 'transform' }), 'none');
    assert.equal(kind({ type: 'value' }), 'none');
    assert.equal(toolKind({ type: 'dataPlot', style: 'bars' }), 'sweep');
    assert.equal(toolKind({ type: 'dataPlot', style: 'points' }), 'pop');
    assert.equal(toolKind({ type: 'distribution', kind: 'binomial' }), 'sweep');
    assert.equal(toolKind({ type: 'plane3D' }), 'fade');
});

// ---------------------------------------------------------------- timing

test('timing: the approved times and easing of each kind', () => {
    assert.equal(ENTRANCE_MS.draw, 700);
    assert.equal(ENTRANCE_MS.sweep, 600);
    assert.equal(ENTRANCE_MS.pop, 350);
    assert.equal(ENTRANCE_MS.grow, 500);
    assert.equal(ENTRANCE_MS.arrow, 500);
    assert.equal(ENTRANCE_MS.rise, 350);
    assert.equal(ENTRANCE_MS.ripple, 600);
    assert.equal(ENTRANCE_MS.surface, 700);
    assert.equal(LEAVE_MS, 200);
    assert.equal(PROGRESS_MS, 700, 'transforms keep their time');
    // Ease out (cubic): fast start, gentle landing.
    assert.equal(easeOut(0), 0);
    assert.equal(easeOut(1), 1);
    near(easeOut(0.5), 0.875);
    // A point pops with a small overshoot, then settles at 1.
    assert.equal(popScale(0), 0);
    near(popScale(1), 1);
    let top = 0;
    for (let k = 0; k <= 1; k += 0.01) top = Math.max(top, popScale(k));
    assert.ok(top > 1.05 && top < 1.2, `overshoot ${top}`);
    // A label rises from RISE_PX below and fades in.
    assert.deepEqual(riseAt(0), { dy: RISE_PX, opacity: 0 });
    assert.deepEqual(riseAt(1), { dy: 0, opacity: 1 });
});

test('timing: points one after another, the last one by 320 ms whatever their number', () => {
    assert.equal(popDelay(0, 1), 0);
    assert.deepEqual([0, 1, 2].map((i) => popDelay(i, 3)), [0, 40, 80]);
    assert.ok(popDelay(19, 20) <= POP_STAGGER_MAX_MS);
    near(popDelay(19, 20), POP_STAGGER_MAX_MS, 1e-9);
    assert.ok(popDelay(1, 20) < 40, 'many points: a shorter stagger');
});

test('timing: how long a step takes to come in, and when its labels start', () => {
    const chart = chartOf(CALCULUS);
    // Step 1: a curve (0.7 s), and the labels it could have (0.42 s + 0.35 s).
    assert.equal(entranceMs(chart, 0), 770);
    // Step 2: a point, counted as if many popped, then its label.
    assert.equal(entranceMs(chart, 1), POP_STAGGER_MAX_MS + 0.6 * 350 + 350);
    // Step 4: the area (0.6 s), a free label just after it (at 0.36 s).
    const last = stepTiming(chart, 3);
    near(last.labels, 0.6 * 600);
    assert.equal(last.total, 710);
    // A step of only a transform has nothing to enter (the transform moves over PROGRESS_MS).
    assert.equal(entranceMs(chartOf('let A = [[2, 0], [0, 1]]\ndraw the grid\nthen transform the plane by A'), 1), 0);
    // A step of only a label: it starts at once.
    assert.equal(entranceMs(chartOf('plot f(x) = x\nthen write "A" at (1, 1)'), 1), 350);
    // A pause (a bare then) has nothing to enter.
    assert.equal(entranceMs(chartOf('plot f(x) = x\nthen\nthen mark (1, 1)'), 1), 0);
    // Every step is in by 1 s.
    for (let k = 0; k <= 3; k++) assert.ok(entranceMs(chart, k) <= 1000);
});

// ---------------------------------------------------------------- frames

test('frames: only the objects of the step that comes in move, by how far it is', () => {
    const chart = chartOf(CALCULUS);
    const tools = chart.tools as Data[];
    const functions = chart.functions as Data[];
    const frame: MotionFrame = { time: 0, step: 1, progress: 1, index: 1, enter: 175 };
    const ent = StepEntrance.of(frame, chart);
    assert.ok(ent);
    if (!ent) return;
    assert.ok(ent.moves(tools[0]), 'P comes in');
    assert.ok(!ent.moves(functions[0]), 'f stands');
    assert.ok(!ent.moves(tools[1]), 'the area is still hidden');
    assert.ok(!ent.leaving);
    assert.equal(ent.fade, 1);
    near(ent.linear('pop'), 0.5);
    near(ent.at('draw'), easeOut(175 / 700));
    near(ent.at('pop', 175), 0);
    assert.equal(ent.at('none'), 1);
    // The last step: `step` is Infinity there, `index` names it.
    const last = StepEntrance.of({ time: 0, step: Infinity, progress: 1, index: 3, enter: 0 }, chart);
    assert.ok(last && last.moves(tools[1]));
    near(last ? last.labels : 0, 360);
});

test('frames: nothing moves in the still frame, a settled step or a frame without its number', () => {
    const chart = chartOf(CALCULUS);
    assert.equal(StepEntrance.of(undefined, chart), null);
    assert.equal(StepEntrance.of(STILL, chart), null);
    assert.equal(StepEntrance.of(stillFrame(1.5), chart), null);
    assert.equal(StepEntrance.of({ time: 0, step: 2, progress: 1, index: 2 }, chart), null);
    assert.equal(StepEntrance.of({ time: 0, step: 2, progress: 1, enter: 100 }, chart), null);
});

test('frames: Previous fades the objects of the step that leaves, nothing plays backwards', () => {
    const chart = chartOf(CALCULUS);
    const ent = StepEntrance.of({ time: 0, step: Infinity, progress: 1, index: 3, leave: 0.25 }, chart);
    assert.ok(ent && ent.leaving);
    if (!ent) return;
    near(ent.fade, 0.75);
    // Every shape stands as it is while it fades.
    assert.equal(ent.at('draw'), 1);
    near(ent.at('pop'), 1);
    assert.equal(ent.linear('rise', 5000), 1);
});

// ---------------------------------------------------------------- shapes

test('shapes: a line draws itself along its length, grows from a point, or from its middle', () => {
    const line = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
    assert.deepEqual(partialLine(line, 0.5), [{ x: 0, y: 0 }, { x: 4, y: 0 }]);
    assert.deepEqual(partialLine(line, 0.25), [{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    assert.deepEqual(partialLine(line, 1), line);
    assert.deepEqual(partialLine(line, 0), [{ x: 0, y: 0 }]);
    // The pieces of a function one after another, left to right.
    const pieces = [
        [{ x: 0, y: 0 }, { x: 2, y: 0 }],
        [{ x: 3, y: 0 }, { x: 5, y: 0 }],
    ];
    assert.deepEqual(partialLines(pieces, 0.25, true), [[{ x: 0, y: 0 }, { x: 1, y: 0 }]]);
    assert.deepEqual(partialLines(pieces, 0.75, true), [pieces[0], [{ x: 3, y: 0 }, { x: 4, y: 0 }]]);
    // Other objects: each piece at once.
    assert.deepEqual(partialLines(pieces, 0.5, false), [[{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 3, y: 0 }, { x: 4, y: 0 }]]);
    // A metric of the screen (y twice as long) changes where the half is.
    const tall = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    const screen = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, 2 * (b.y - a.y));
    assert.deepEqual(partialLine(tall, 0.5, screen), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.25 }]);
    // A tangent grows out of its touching point, both ways.
    const tangent = [{ x: -2, y: -2 }, { x: 4, y: 4 }];
    const touch = nearestOn(tangent, { x: 1, y: 1.2 });
    near(touch.x, 1.1);
    assert.deepEqual(grownLine(tangent, { x: 1, y: 1 }, 0.5), [{ x: -0.5, y: -0.5 }, { x: 2.5, y: 2.5 }]);
    assert.deepEqual(middleOf([{ x: -3, y: 1 }, { x: 3, y: -1 }]), { x: 0, y: 0 });
    // An eigenvector line reaches far beyond the view: it grows to the view's edges, cut first.
    const box = { xmin: -4, xmax: 4, ymin: -2, ymax: 2 };
    assert.deepEqual(clipSegment({ x: -40, y: -40 }, { x: 40, y: 40 }, box), [{ x: -2, y: -2 }, { x: 2, y: 2 }]);
    assert.deepEqual(clipSegment({ x: -40, y: 0 }, { x: 40, y: 0 }, box), [{ x: -4, y: 0 }, { x: 4, y: 0 }]);
    assert.equal(clipSegment({ x: -40, y: 5 }, { x: 40, y: 5 }, box), null);
    assert.deepEqual(clipSegment({ x: 0, y: 0 }, { x: 1, y: 1 }, box), [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
});

test('shapes: a ripple spreads from the middle and holds everything at the end', () => {
    for (const d of [0, 0.3, 0.7, 1]) {
        assert.equal(rippleOpacity(0, d), 0);
        assert.equal(rippleOpacity(1, d), 1);
    }
    assert.ok(rippleOpacity(0.5, 0.1) > rippleOpacity(0.5, 0.6), 'the middle first');
    // The two stops of the gradient give the same opacity, linear between them.
    for (const k of [0.1, 0.4, 0.8]) {
        const [a, b] = rippleStops(k);
        near(a.opacity, rippleOpacity(k, a.offset));
        near(b.opacity, rippleOpacity(k, b.offset));
        const mid = (a.offset + b.offset) / 2;
        near(rippleOpacity(k, mid), (a.opacity + b.opacity) / 2, 1e-9);
    }
});

// ---------------------------------------------------------------- the player's steps

test('player: Next lets a step come in, then draws it settled once', () => {
    const tl = new StepTimeline(3, false);
    assert.equal(tl.shown(), 3);
    assert.deepEqual(tl.frame(0), { time: 0, step: Infinity, progress: 1, index: 3 });
    go(tl, 0, { fromPlay: true });
    go(tl, 1);
    let f = tl.frame(0);
    assert.equal(f.index, 1);
    assert.equal(f.enter, 0);
    assert.equal(tl.advance(100, false), 'frame');
    near(tl.frame(0).enter ?? NaN, 100);
    const run = runOut(tl);
    assert.equal(run.last, 'settle', 'the settled picture is drawn whole');
    assert.ok(run.frames >= Math.floor((770 - 100) / (1000 / 60)) && run.frames <= 42, `${run.frames} frames`);
    f = tl.frame(0);
    assert.equal(f.enter, undefined);
    assert.equal(tl.advance(16, false), 'none');
    // The last step comes in too (its frame says Infinity, the index says 3).
    go(tl, 2);
    runOut(tl);
    go(tl, 3);
    f = tl.frame(0);
    assert.equal(f.step, Infinity);
    assert.equal(f.index, 3);
    assert.equal(f.enter, 0);
});

test('player: Previous fades the step that leaves for 0.2 s, then shows the step before', () => {
    const tl = new StepTimeline(3, false);
    go(tl, 2);
    assert.equal(tl.step, 2, 'Step 3 of 4 at once');
    assert.equal(tl.shown(), 3, 'the leaving step is still drawn');
    let f = tl.frame(0);
    assert.equal(f.leave, 0);
    assert.equal(f.enter, undefined);
    assert.equal(f.index, 3);
    tl.advance(100, false);
    near(tl.frame(0).leave ?? NaN, 0.5);
    assert.equal(tl.advance(100, false), 'settle');
    f = tl.frame(0);
    assert.equal(tl.shown(), 2);
    assert.equal(f.leave, undefined);
    assert.equal(f.index, 2);
    // Previous again during a fade: that step goes at once, the next one fades.
    go(tl, 1);
    tl.advance(50, false);
    go(tl, 0);
    assert.equal(tl.shown(), 1);
    assert.equal(tl.frame(0).leave, 0);
    // A jump back over several steps (not Play) shows the step at once.
    const jump = new StepTimeline(3, false);
    go(jump, 0);
    assert.equal(jump.shown(), 0);
    assert.ok(!jump.busy());
});

test('player: Play waits until a step has fully come in, and starts again from the first step', () => {
    const tl = new StepTimeline(2, false);
    // Play from the last step: the first step comes in from nothing.
    go(tl, 0, { fromPlay: true, ms: 900 });
    assert.equal(tl.frame(0).enter, 0);
    let ms = 0;
    while (!tl.ready() && ms < 5000) {
        tl.advance(1000 / 60, true);
        ms += 1000 / 60;
    }
    assert.ok(ms >= Math.max(STEP_MS, 900 + HOLD_MS) - 1, `went on after ${ms} ms`);
    // A long entrance holds Play longer than STEP_MS.
    const slow = new StepTimeline(2, false);
    go(slow, 0, { fromPlay: true, ms: 1400 });
    ms = 0;
    while (!slow.ready() && ms < 5000) {
        slow.advance(1000 / 60, true);
        ms += 1000 / 60;
    }
    assert.ok(ms >= 1400 + HOLD_MS - 1, `held ${ms} ms`);
    // Never while it is still coming in.
    const busy = new StepTimeline(2, false);
    go(busy, 0, { fromPlay: true, ms: 900 });
    busy.stepTime = 10000;
    assert.ok(!busy.ready());
});

test('player: transforms move over PROGRESS_MS as before, also in the last step', () => {
    const tl = new StepTimeline(2, true);
    go(tl, 1);
    go(tl, 2, { entrances: false });
    const f = tl.frame(0);
    assert.equal(f.progress, 0);
    assert.equal(f.step, Infinity);
    // The fixed case: a transform in the last step reads its own progress, not 1.
    assert.equal(stepProgress(f, 2), 0);
    assert.equal(stepProgress(f, 1), 1);
    tl.advance(350, false);
    near(stepProgress(tl.frame(0), 2), 0.5);
    assert.equal(tl.advance(400, false), 'settle');
    assert.equal(stepProgress(tl.frame(0), 2), 1);
    // The export's still frame: every transform done.
    assert.equal(stepProgress(STILL, 2), 1);
    assert.equal(stepProgress(undefined, 2), 1);
});

// ---------------------------------------------------------------- off switches

test('off: entrances off or less motion, and a step appears at once, as before', () => {
    const off = new StepTimeline(2, false);
    go(off, 0, { entrances: false });
    go(off, 1, { entrances: false });
    assert.equal(off.frame(0).enter, undefined);
    assert.ok(!off.busy());
    go(off, 0, { entrances: false });
    assert.equal(off.frame(0).leave, undefined, 'Previous shows the step before at once');
    assert.equal(off.shown(), 0);
    // Less motion: neither entrances nor transforms move.
    const still = new StepTimeline(2, true);
    go(still, 0, { motion: false });
    go(still, 1, { motion: false });
    const f = still.frame(0);
    assert.equal(f.enter, undefined);
    assert.equal(f.progress, 1);
    assert.ok(!still.busy());
});

test('off: the chart line set entrances = off, read and printed back, in words and in Full LaTeX', () => {
    const text = 'plot f(x) = x\nset entrances = off\nthen mark (1, 1)';
    const data = chartOf(text);
    assert.equal(data.entrances, false);
    assert.equal(chartEntrances(data), false);
    assert.equal(entrancesOn(data), false);
    const printed = printChartText(data);
    assert.match(printed, /^set entrances = off$/m);
    assert.equal(canonical(chartOf(printed)), canonical(data));
    const full = printFullText(data);
    assert.equal(canonical(chartOf(full)), canonical(data), full);
    assert.equal(chartOf('set entrances = on\nplot f(x) = x').entrances, true);
    assert.equal(chartOf('set entrances = false\nplot f(x) = x').entrances, false);
    // A chart without the line lets its objects enter.
    assert.ok(chartEntrances(chartOf('plot f(x) = x')));
    assert.ok(!/entrances/.test(printChartText(chartOf('plot f(x) = x\nthen mark (1, 1)'))));
});

test('off: the plugin setting turns entrances off for every chart', () => {
    const data = chartOf('plot f(x) = x\nthen mark (1, 1)');
    assert.equal(stepEntrancesSetting(), true, 'on by default');
    assert.ok(entrancesOn(data));
    setStepEntrances(false);
    try {
        assert.equal(entrancesOn(data), false);
    } finally {
        setStepEntrances(true);
    }
    assert.ok(entrancesOn(data));
});
