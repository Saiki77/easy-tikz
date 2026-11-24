/*
 * The design pass for moving pictures (6.0 F4): `traced` solutions and
 * orbits, the 3D chart line `turning` and `coloured by time` in its default
 * ramp, in words and Full LaTeX both ways; what the scene hands the live
 * canvas (the shapes at a time, the flow) and the still frame it hides; the
 * new looks (orbit heads, the cobweb's fade, the circles); the 3D legs; the
 * export of the still frames; the clock; the choice of a solution's points.
 */
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText, printFullText } from '../src/text/print';
import { canonicalData } from '../src/chartdata';
import { SettingsManager } from '../src/settings';
import { computeScene2D, computeScene3D, labelMetricsFor, Scene2D } from '../src/scene';
import { MAX_POINTS, simplify, solveSystem } from '../src/motion6/maths';
import { Turn, TURN_DEG_PER_S, needsClock, turns } from '../src/motion6/clock';
import { TIME_LEVELS, TRACE_HOLD, lightColor, rampColor, themedColor, traceFraction, traceSeconds } from '../src/motion6/liveprims';
import { MotionFrame } from '../src/types';

type Data = Record<string, unknown>;

/** Print in words and in Full LaTeX: both read back as the same chart. Returns the words. */
function roundTrip(text: string): string {
    const r = parseChartText(text);
    assert.deepEqual(r.problems, [], text);
    const canon = (d: Data) => JSON.stringify(canonicalData(d));
    const words = printChartText(r.data);
    const back = parseChartText(words);
    assert.deepEqual(back.problems, [], words);
    assert.equal(canon(back.data), canon(r.data), `words: ${words}`);
    const full = printFullText(r.data);
    const again = parseChartText(full);
    assert.deepEqual(again.problems, [], full);
    assert.equal(canon(again.data), canon(r.data), `full: ${full}`);
    return words;
}

function toolOf(text: string, i = -1): Data {
    const r = parseChartText(text);
    assert.deepEqual(r.problems, [], text);
    const tools = r.data.tools as Data[];
    return tools[i < 0 ? tools.length + i : i];
}

function settingsOf(text: string): SettingsManager {
    const r = parseChartText(text);
    assert.deepEqual(r.problems, [], text);
    return SettingsManager.fromJSON(r.data);
}

function sceneOf(text: string, motion?: MotionFrame): Scene2D {
    const settings = settingsOf(text);
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    return computeScene2D({
        functions: config.functions,
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: { nx: 200, ny: 200 },
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(10, 10),
        equalScale: config.equalScale,
        motion,
    });
}

const VIEW = 'show x from -4 to 4 and y from -3 to 3';
const LORENZ = 'draw the solution of $\\dot{p} = (10(y - x), x(28 - z) - y, xy - \\frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 72, coloured by time, traced';
const DESCENT = 'draw the orbit of $p_{n+1} = p_n - \\eta \\nabla f(p_n)$, $p_0 = P$, 25 steps';
const DESCENT_CHART = ['show x from -3 to 3 and y from -2 to 2', 'let $f(x, y) = \\frac{1}{2}x^2 + 4y^2$', 'slider eta from 0.01 to 0.3, starting at 0.2', 'mark P at (-2.6, 1.4), large'].join('\n');

// ---------------------------------------------------------------- words

test('words: traced solutions (2D, 3D) and orbits, turning, coloured by time in the default ramp', () => {
    const lorenz = `3d\nturning\n${LORENZ}`;
    const words = roundTrip(lorenz);
    assert.match(words, /^3d\nturning\n/);
    assert.match(words, /coloured by time, traced$/m);
    const s = toolOf(lorenz);
    assert.equal(s.traced, true);
    assert.equal(s.byTime, true);
    assert.equal(s.colormap, undefined);
    assert.equal(parseChartText(lorenz).data.turning, true);
    roundTrip(`${VIEW}\nmark P at (1, 0)\ndraw the solution of $\\dot{p} = (y, -x)$ through P for t from 0 to 6, traced, dashed`);
    roundTrip(`${VIEW}\ndraw the solution of $\\dot{p} = (y, -x)$ through (1, 0) for t from 0 to 6, coloured by time in heat, traced`);
    roundTrip(`${DESCENT_CHART}\n${DESCENT}, as a path, traced`);
    assert.equal(toolOf(`${DESCENT_CHART}\n${DESCENT}, traced`).traced, true);
    // A map is always named in print (`coloured by time` alone is the ramp).
    assert.match(printChartText(parseChartText(`${VIEW}\ndraw the solution of (y, -x) through (1, 0), coloured by time in viridis`).data), /coloured by time in viridis/);
});

test('words: turning stands alone; a formula that starts with it stays a formula; Full LaTeX \\axis[turning]', () => {
    assert.equal(parseChartText('3d\nturning, red').problems.length, 1);
    const f = parseChartText('turning + x = 3');
    assert.equal(f.data.turning, undefined);
    const full = printFullText(parseChartText('3d\nturning\nplot f(x, y) = x y').data);
    assert.match(full, /\\axis\[[^\]]*turning/);
    assert.equal(parseChartText(full).data.turning, true);
    // A chart without it prints as before.
    assert.doesNotMatch(printChartText(parseChartText('3d\nplot f(x, y) = x y').data), /turning/);
});

// ---------------------------------------------------------------- clock

test('clock: turning 3D charts and traced lines need it; a drag holds the turn', () => {
    const data = (text: string) => parseChartText(text).data;
    assert.equal(needsClock(data('3d\nturning\nplot f(x, y) = x y')), true);
    assert.equal(turns(data('turning\nplot f(x) = x')), false);
    assert.equal(needsClock(data('turning\nplot f(x) = x')), false);
    assert.equal(needsClock(data(`${VIEW}\ndraw the solution of (y, -x) through (1, 0), traced`)), true);
    assert.equal(needsClock(data(`${VIEW}\ndraw the solution of (y, -x) through (1, 0)`)), false);
    assert.equal(needsClock(data(`${DESCENT_CHART}\n${DESCENT}, traced`)), true);
    const turn = new Turn();
    near(turn.angle(2), 2 * TURN_DEG_PER_S, 1e-9);
    turn.hold(true, 2);
    assert.equal(turn.angle(3), 0);
    turn.hold(false, 3);
    near(turn.angle(4), TURN_DEG_PER_S, 1e-9);
});

test('trace timing: whole at the still frame, then it draws itself, holds, and starts again', () => {
    assert.equal(traceFraction(0, 5), 1);
    near(traceFraction(2.5, 5), 0.5, 1e-9);
    assert.equal(traceFraction(5 + TRACE_HOLD / 2, 5), 1);
    near(traceFraction(5 + TRACE_HOLD + 1, 5), 0.2, 1e-9);
    assert.equal(traceSeconds(0, 10), 5);
    assert.equal(traceSeconds(0, 72), 20);
});

// ---------------------------------------------------------------- scene

test('scene: a traced solution keeps its whole still frame (hidden live) and draws itself on the live canvas', () => {
    const text = `${VIEW}\ndraw the solution of $\\dot{p} = (y, -x)$ through (1, 0) for t from 0 to 6.2832, coloured by time, traced`;
    const item = sceneOf(text).items[0];
    assert.ok(item.strokes.length >= TIME_LEVELS - 1);
    assert.ok(item.strokes.every((s) => s.still === true));
    assert.equal(item.strokes[0].color, rampColor(0));
    const at = item.live?.[0].at;
    assert.ok(at);
    if (!at) return;
    // The still frame: the whole curve, no head.
    const whole = at(0);
    assert.equal(whole.dots.length, 0);
    const all = whole.lines.reduce((n, l) => n + l.pts.length, 0);
    // Half way: about half of it, a head on it (in the colour of the curve there).
    const half = at(traceSeconds(0, 6.2832) / 2);
    assert.equal(half.dots.length, 1);
    const head = half.dots[0];
    near(Math.hypot(head.x, head.y), 1, 1e-3);
    near(Math.atan2(head.y, head.x), Math.PI, 0.05);
    const some = half.lines.reduce((n, l) => n + l.pts.length, 0);
    assert.ok(some > all * 0.35 && some < all * 0.7, `${some} of ${all}`);
    // Without traced: nothing moves, nothing hidden.
    const plain = sceneOf(text.replace(', traced', '')).items[0];
    assert.equal(plain.live, undefined);
    assert.ok(plain.strokes.every((s) => !s.still));
});

test('scene: a traced orbit (dots reached on the way), heads on the longer steps, deduplicated', () => {
    const item = sceneOf(`${DESCENT_CHART}\n${DESCENT}, traced`).items[2];
    assert.equal(item.strokes[0].still, true);
    assert.equal(item.markers[0].still, undefined);
    assert.ok(item.markers.slice(1).every((m) => m.still === true));
    assert.equal(item.fills.length, 1);
    assert.equal(item.fills[0].still, true);
    const at = item.live?.[0].at;
    assert.ok(at);
    if (!at) return;
    const early = at(0.3);
    assert.ok(early.dots.length >= 1 && early.dots.length < 5);
    const plain = sceneOf(`${DESCENT_CHART}\n${DESCENT}, as a path`).items[2];
    const heads = plain.fills[0].rings;
    assert.ok(heads.length >= 3 && heads.length <= 25, `${heads.length} heads`);
    assert.ok(heads.every((r) => r.length === 3));
    // An orbit of period 3 (the Mandelbrot set at c = P) puts one head per step, not one per pass.
    const period = sceneOf('show x from -2.4 to 1 and y from -1.15 to 1.15\nequal scale\nmark P at (-0.12, 0.75)\ndraw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps, as a path').items[1];
    assert.ok(period.fills[0].rings.length <= 6, `${period.fills[0].rings.length} heads`);
});

test('scene: the cobweb fades in over eight levels; turning circles on the live canvas, their still frame hidden', () => {
    const cobweb = sceneOf('show x from 0 to 1 and y from 0 to 1\nslider r from 2.5 to 4, starting at 3.7\nplot $f(x) = r x (1 - x)$ in blue, thick\ndraw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps').items.find((i) => i.source === 'CW1');
    assert.ok(cobweb);
    if (!cobweb) return;
    const faded = cobweb.strokes.filter((s) => s.opacity !== undefined).map((s) => s.opacity);
    assert.equal(faded.length, 7);
    assert.equal(faded[0], 0.2);
    const circles = sceneOf('show x from -2 to 8 and y from -2 to 2\nequal scale\ndraw the circles of $\\sum_{k=1}^{3} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave').items[0];
    assert.equal(circles.strokes[0].still, undefined);
    assert.ok(circles.strokes.slice(1).every((s) => s.still === true));
    const at = circles.live?.[0].at;
    assert.ok(at);
    if (!at) return;
    const a = at(0);
    assert.equal(a.rings.length, 3);
    assert.equal(a.lines[0].color, 'blue');
    assert.equal(a.lines[1].color, 'red');
    assert.ok(a.lines[2].dashed);
    const b = at(1);
    assert.notDeepEqual(b.dots, a.dots);
});

test('scene 3D: thin legs of a long curve, the default ramp, where each comes in when traced', () => {
    const settings = settingsOf(`3d\nshow x from -25 to 25 and y from -30 to 30 and z from 0 to 50\n${LORENZ.replace('to 72', 'to 20')}`);
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    const scene = computeScene3D({ tools: config.tools, math, view: { xmin: -25, xmax: 25, ymin: -30, ymax: 30, zmin: 0, zmax: 50 } });
    assert.deepEqual(scene.issues, []);
    const legs = scene.segments;
    assert.ok(legs.length > 500 && legs.length <= MAX_POINTS);
    assert.ok(legs.every((l) => l.curve === true && l.width === 'thin' && !!l.trace && l.traceSeconds === 10));
    near(legs[0].trace?.[0] ?? -1, 0, 1e-12);
    near(legs[legs.length - 1].trace?.[1] ?? -1, 1, 1e-12);
    for (let i = 1; i < legs.length; i++) assert.ok((legs[i].trace?.[0] ?? 0) >= (legs[i - 1].trace?.[0] ?? 0));
    assert.equal(legs[0].color, rampColor(0));
    assert.equal(legs[legs.length - 1].color, rampColor(TIME_LEVELS - 1));
    // The export draws the whole curve, smooth, one path per run of a colour.
    const code = settings.generateTikzCode(math);
    const plots = code.split('\n').filter((l) => l.startsWith('\\addplot3['));
    assert.ok(plots.length >= TIME_LEVELS && plots.length < 90, `${plots.length} paths`);
    assert.ok(plots.every((l) => /smooth/.test(l)));
});

test('ramp: cobalt to amber, a dark-theme twin for each level and back', () => {
    assert.equal(rampColor(0), '#2546c4');
    assert.equal(rampColor(TIME_LEVELS - 1), '#a86400');
    const dark = themedColor(rampColor(5), true);
    assert.notEqual(dark, rampColor(5));
    assert.equal(lightColor(dark), rampColor(5));
    assert.equal(themedColor('#123456', true), '#123456');
    assert.equal(themedColor(rampColor(5), false), rampColor(5));
});

// ---------------------------------------------------------------- export

test('export: a traced line is drawn whole, as the line that is not traced', () => {
    const plain = `${VIEW}\nmark P at (1, 0)\ndraw the solution of $\\dot{p} = (y, -x)$ through P for t from 0 to 6, coloured by time`;
    assert.equal(settingsOf(`${plain}, traced`).generateTikzCode(), settingsOf(plain).generateTikzCode());
    const orbit = `${DESCENT_CHART}\n${DESCENT}`;
    assert.equal(settingsOf(`${orbit}, traced`).generateTikzCode(), settingsOf(orbit).generateTikzCode());
    // The orbit's heads are filled triangles in its colour.
    assert.match(settingsOf(`${orbit}, as a path`).generateTikzCode(), /\\fill\[etRed/);
    // turning changes nothing on paper.
    const surface = '3d\nplot f(x, y) = x y';
    assert.equal(settingsOf(`${surface}\nturning`).generateTikzCode(), settingsOf(surface).generateTikzCode());
});

// ------------------------------------------------------------- points

test('points of a solution: chosen by shape, the ends kept, at most the cap', () => {
    const f = (p: readonly number[]) => [10 * (p[1] - p[0]), p[0] * (28 - p[2]) - p[1], p[0] * p[1] - (8 / 3) * p[2]];
    const s = solveSystem(f, [1, 1, 1], 0, 72);
    assert.ok(s.pts.length > 1500 && s.pts.length <= MAX_POINTS, `${s.pts.length} points`);
    assert.equal(s.ts[0], 0);
    near(s.ts[s.ts.length - 1], 72, 1e-9);
    const line = Array.from({ length: 101 }, (_, i) => [i, 2 * i]);
    assert.deepEqual(simplify(line, 50), [0, 100]);
    const zigzag = Array.from({ length: 11 }, (_, i) => [i, i % 2]);
    assert.equal(simplify(zigzag, 50).length, 11);
    assert.ok(simplify(zigzag, 4).length <= 4);
});
