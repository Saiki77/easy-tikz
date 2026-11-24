/*
 * Motion (6.0), the pictures: the maths (tuples, RK4, rest points and their
 * kinds, particles as a function of time), the scene of vector fields
 * (arrows of one length, coloured by length, streamlines, particles on the
 * clock), rest points (filled when stable, open when not), solutions of
 * systems in 2D and 3D (coloured by time), and the export: still particles,
 * open markers, a 3D solution as few paths, every step as a frame, the fit.
 */
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { SettingsManager } from '../src/settings';
import { computeScene2D, computeScene3D, labelMetricsFor, Scene2D } from '../src/scene';
import { fitSettings } from '../src/fit';
import { MathContext } from '../src/mathcontext';
import { MAX_POINTS, compileTuple, particlesAt, restKind, restPoints, solveSystem, tupleParts } from '../src/motion6/maths';
import { MotionFrame } from '../src/types';

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
const DAMPED = '$F(x, y) = (y, -\\sin x - 0.25y)$';

// ---------------------------------------------------------------- maths

test('maths: tuples with and without a left side', () => {
    assert.deepEqual(tupleParts('(y, -x)'), ['y', '-x']);
    assert.deepEqual(tupleParts('F(x, y) = (y, -\\sin x - 0.25y)'), ['y', '-\\sin x - 0.25y']);
    assert.deepEqual(tupleParts("\\dot{p} = (10(y - x), x(28 - z) - y, x y - \\frac{8}{3}z)"), ['10(y - x)', 'x(28 - z) - y', 'x y - \\frac{8}{3}z']);
    assert.deepEqual(tupleParts("p' = \\left( y, -x \\right)"), ['y', '-x']);
    assert.equal(tupleParts('y - x'), null);
    assert.equal(tupleParts('(y, -x) + 1'), null);
});

test('maths: a compiled system reads z, t and sliders', () => {
    const math = MathContext.create({ parameters: [{ name: 'k', value: 2, min: 0, max: 5, step: 1 }] });
    const f = compileTuple(math, '(k y, -x + t, z)', 3);
    assert.deepEqual(f([1, 2, 3], 0.5), [4, -0.5, 3]);
    assert.throws(() => compileTuple(math, '(y, -x)', 3), /3 formulas/);
    assert.throws(() => compileTuple(math, '(y, w)', 2), /part 2/);
});

test('maths: RK4 keeps the energy of a harmonic oscillator', () => {
    const s = solveSystem((p) => [p[1], -p[0]], [1, 0], 0, 2 * Math.PI);
    const end = s.pts[s.pts.length - 1];
    near(end[0], 1, 1e-6);
    near(end[1], 0, 1e-6);
    assert.ok(s.pts.length <= MAX_POINTS + 2);
    assert.equal(s.capped, false);
    const long = solveSystem((p) => [p[1], -p[0]], [1, 0], 0, 1000);
    assert.equal(long.capped, true);
    assert.ok(long.pts.length <= MAX_POINTS + 2);
    const blow = solveSystem((p) => [p[0] * p[0]], [1], 0, 2, 1e6);
    assert.ok(blow.stopped !== null && blow.stopped < 1.01);
});

test('maths: rest points of the damped pendulum and their kinds', () => {
    const F = (x: number, y: number) => [y, -Math.sin(x) - 0.25 * y];
    const found = restPoints(F, { xmin: -4, xmax: 4, ymin: -3, ymax: 3 });
    assert.equal(found.length, 3);
    near(found[0].x, -Math.PI, 1e-6);
    near(found[1].x, 0, 1e-9);
    near(found[2].x, Math.PI, 1e-6);
    assert.equal(found[1].kind, 'stableSpiral');
    assert.equal(found[1].stable, true);
    assert.equal(found[0].kind, 'saddle');
    assert.equal(restKind([[0, 1], [-1, 0]]).kind, 'centre');
    assert.equal(restKind([[-1, 0], [0, -2]]).kind, 'stableNode');
    assert.equal(restKind([[1, 0], [0, 2]]).kind, 'unstableNode');
});

test('maths: particles are a pure function of time', () => {
    const F = (x: number, y: number) => [y, -x];
    const box = { xmin: -2, xmax: 2, ymin: -2, ymax: 2 };
    const a = particlesAt(F, box, 30, 1, 1.25);
    const b = particlesAt(F, box, 30, 1, 1.25);
    assert.deepEqual(a, b);
    assert.ok(a.length > 20);
    assert.notDeepEqual(particlesAt(F, box, 30, 1, 1.5), a);
    for (const p of a) assert.ok(p.life >= 0 && p.life <= 1 && p.trail.length >= 2);
});

// ---------------------------------------------------------------- scene

test('vector field: arrows of one length on screen, coloured by length', () => {
    const scene = sceneOf(`${VIEW}\ndraw the vector field ${DAMPED}`);
    assert.deepEqual(scene.issues, []);
    const item = scene.items[0];
    assert.equal(item.strokes.length, 1);
    const lines = item.strokes[0].lines;
    // A shaft and a head per arrow.
    assert.equal(lines.length % 2, 0);
    const m = labelMetricsFor(10, 10);
    const ux = m.w / 8;
    const uy = m.h / 6;
    const lens = lines.filter((_, i) => i % 2 === 0).map((l) => Math.hypot((l[1].x - l[0].x) * ux, (l[1].y - l[0].y) * uy));
    for (const len of lens) near(len, lens[0], 1e-6);
    const coloured = sceneOf(`${VIEW}\ndraw the vector field ${DAMPED}, coloured by length`);
    const colours = coloured.items[0].strokes.map((s) => s.color);
    assert.ok(colours.length > 3);
    assert.ok(colours.every((c) => /^#[0-9a-f]{6}$/.test(c)));
});

test('vector field: streamlines, and particles that follow the clock (after the memo)', () => {
    const stream = sceneOf(`${VIEW}\ndraw the vector field ${DAMPED}, with streamlines`);
    assert.equal(stream.items[0].strokes.length, 2);
    assert.ok(stream.items[0].strokes[1].lines.length > 3);
    const text = `${VIEW}\ndraw the vector field ${DAMPED}, with moving particles`;
    const still = sceneOf(text);
    const later = sceneOf(text, { time: 1.5, step: Infinity, progress: 1 });
    const faded = still.items[0].strokes.filter((s) => s.opacity !== undefined);
    // The arrows under particles are faint, the trails fade in levels.
    assert.ok(faded.length >= 3);
    assert.notDeepEqual(JSON.stringify(later.items[0].strokes), JSON.stringify(still.items[0].strokes));
    // The still frame is time 0.
    assert.equal(JSON.stringify(sceneOf(text, { time: 0, step: Infinity, progress: 1 }).items[0].strokes), JSON.stringify(still.items[0].strokes));
});

test('rest points: filled when stable, open when not, kinds as labels, published', () => {
    const scene = sceneOf(`${VIEW}\ndraw the vector field ${DAMPED}\nmark the rest points of F, labelled`);
    assert.deepEqual(scene.issues, []);
    const item = scene.items[1];
    assert.equal(item.markers.length, 3);
    assert.deepEqual(
        item.markers.map((m) => !!m.open),
        [true, false, true]
    );
    assert.deepEqual(
        item.texts.map((t) => t.text),
        ['saddle', 'stable spiral', 'saddle']
    );
    near(scene.derived.RP1_x2, 0, 1e-9);
    assert.equal(scene.derived.RP1_n, 3);
    const none = sceneOf('show x from 1 to 2 and y from 1 to 2\ndraw the vector field (y, -x)\nmark the rest points');
    assert.equal(none.issues[0].severity, 'info');
    const wrong = sceneOf('plot f(x) = x\nmark the rest points of f');
    assert.match(wrong.issues[0].message, /f does not exist|not a vector field/);
});

test('solution of a system: 2D through a point it follows, coloured by time', () => {
    const at = (x: number) => sceneOf(`${VIEW}\nmark P at (${x}, 0)\ndraw the solution of $\\dot{p} = (y, -x)$ through P for t from 0 to 6.2832`);
    const scene = at(1);
    assert.deepEqual(scene.issues, []);
    const line = scene.items[1].strokes[0].lines[0];
    near(line[0].x, 1, 1e-12);
    near(line[line.length - 1].x, 1, 1e-4);
    const moved = at(2).items[1].strokes[0].lines[0];
    near(moved[0].x, 2, 1e-12);
    const coloured = sceneOf(`${VIEW}\ndraw the solution of $\\dot{p} = (y, -x)$ through (1, 0) for t from 0 to 6, coloured by time`);
    assert.ok(coloured.items[0].strokes.length >= 6);
    const bad = sceneOf(`${VIEW}\ndraw the solution of $\\dot{p} = (y, -w)$ through (1, 0) for t from 0 to 6`);
    assert.match(bad.issues[0].message, /part 2/);
});

test('solution of a system: 3D legs coloured by time, in runs the export joins', () => {
    const settings = settingsOf(
        '3d\nshow x from -25 to 25 and y from -30 to 30 and z from 0 to 50\ndraw the solution of $\\dot{p} = (10(y - x), x(28 - z) - y, xy - \\frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 20, coloured by time'
    );
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    const scene = computeScene3D({ tools: config.tools, math, view: { xmin: -25, xmax: 25, ymin: -30, ymax: 30, zmin: 0, zmax: 50 } });
    assert.deepEqual(scene.issues, []);
    assert.ok(scene.segments.length > 500 && scene.segments.length <= MAX_POINTS + 2);
    const colours = new Set(scene.segments.map((s) => s.color));
    assert.ok(colours.size >= 6);
    const code = settings.generateTikzCode(math);
    const plots = code.split('\n').filter((l) => l.startsWith('\\addplot3['));
    // Few paths: one per run of a colour (legs that leave the box are drawn alone).
    assert.ok(plots.length < 60, `${plots.length} \\addplot3 lines`);
    assert.match(code, /\\definecolor\{etHex/);
    // The vector field is 2D only.
    const flat = settingsOf('3d\ndraw the vector field (y, -x)');
    const m2 = flat.createMathContext();
    const c2 = flat.toRendererConfig(m2);
    assert.match(computeScene3D({ tools: c2.tools, math: m2, view: { xmin: -5, xmax: 5, ymin: -5, ymax: 5, zmin: -5, zmax: 5 } }).issues[0].message, /2D/);
});

// --------------------------------------------------------------- export

test('export: still particles at the still time, faded trails, open rest points', () => {
    const settings = settingsOf(`${VIEW}\ndraw the vector field ${DAMPED}, with moving particles\nmark the rest points of F`);
    const code = settings.generateTikzCode();
    assert.match(code, /draw opacity=0\.15/);
    assert.match(code, /mark options=\{fill=white, draw=etRed, line width=0\.8pt\}/);
    const again = settingsOf(`${VIEW}\ndraw the vector field ${DAMPED}, with moving particles\nmark the rest points of F`).generateTikzCode();
    assert.equal(again, code);
    const later = settingsOf(`${VIEW}\nset stillTime = 1.5\ndraw the vector field ${DAMPED}, with moving particles`).generateTikzCode();
    assert.notEqual(later.split('% F')[1], code.split('% F')[1]);
});

test('export: the last step by default, every step side by side with frames', () => {
    const text = `${VIEW}\nplot f(x) = sin(x)\nthen plot g(x) = cos(x)\nthen mark (0, 1)`;
    const last = settingsOf(text).generateTikzCode();
    assert.equal((last.match(/\\begin\{tikzpicture\}/g) ?? []).length, 1);
    assert.match(last, /cos/);
    const frames = settingsOf(`frames\n${text}`).generateTikzCode();
    assert.equal((frames.match(/\\begin\{tikzpicture\}/g) ?? []).length, 3);
    assert.equal((frames.match(/\\documentclass/g) ?? []).length, 1);
    assert.match(frames, /% Step 1 of 3/);
    const pictures = frames.split('\\begin{tikzpicture}').slice(1);
    assert.doesNotMatch(pictures[0], /cos/);
    assert.match(pictures[1], /cos/);
    assert.match(pictures[0], /width=5cm/);
    const snippet = settingsOf(`snippet\nframes\n${text}`).generateTikzCode();
    assert.doesNotMatch(snippet, /\\documentclass/);
    assert.match(snippet, /^% Needs: \\usepackage\{pgfplots\}/);
});

// ------------------------------------------------------------------ fit

test('fit: a vector field never sets the view, a solution holds its curve', () => {
    const fit = (text: string) => {
        const settings = settingsOf(text);
        const math = settings.createMathContext();
        return fitSettings(settings, math);
    };
    assert.equal(fit('draw the vector field (y, -x)').nothing, 'unbounded');
    const r = fit('draw the solution of $\\dot{p} = (y, -x)$ through (2, 0) for t from 0 to 7');
    assert.ok(r.y && r.y.min <= -2 && r.y.max >= 2, JSON.stringify(r));
});
