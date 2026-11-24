/*
 * Motion (6.0), the chart text: `then` steps (parse, print with `then`, a
 * rewrite that keeps them, Full LaTeX \then), the chart line `frames`, and
 * the lines of vector fields, rest points and solutions of systems in words
 * and Full LaTeX, read and printed back as the same chart.
 */
import { test, assert } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText, printFullText, writeChartText } from '../src/text/print';
import { wordsToFull } from '../src/text/full';
import { canonical, canonicalData } from '../src/chartdata';
import { atStep, hasSteps, lastStep, stepOf, stepProgress, stepsInOrder } from '../src/motion6/steps';
import { needsClock, movesByItself, stillFrame, STILL } from '../src/motion6/clock';

type Data = Record<string, unknown>;

function roundTrip(text: string): string {
    const first = parseChartText(text);
    assert.deepEqual(first.problems, [], `problems in ${text}`);
    const printed = printChartText(first.data);
    const back = parseChartText(printed);
    assert.deepEqual(back.problems, [], `problems in the printed text:\n${printed}`);
    assert.equal(canonical(back.data), canonical(first.data), `printed:\n${printed}`);
    // Full LaTeX reads back as the same chart too.
    const full = printFullText(first.data);
    const fromFull = parseChartText(full);
    assert.deepEqual(fromFull.problems, [], `problems in Full LaTeX:\n${full}`);
    assert.equal(canonical(fromFull.data), canonical(first.data), `Full LaTeX:\n${full}`);
    return printed;
}

const list = (d: Data, key: string): Data[] => (Array.isArray(d[key]) ? (d[key] as Data[]) : []);

// -------------------------------------------------------------- steps

test('then: lines after it are in the next step, a bare then starts one too', () => {
    const r = parseChartText(['plot f(x) = x^2', 'then plot g(x) = x', 'write "g" at (1, 1)', 'then', 'then mark (1, 1)'].join('\n'));
    assert.deepEqual(r.problems, []);
    const fns = list(r.data, 'functions');
    assert.equal(fns[0].step, undefined);
    assert.equal(fns[1].step, 1);
    assert.equal(list(r.data, 'annotations')[0].step, 1);
    assert.equal(list(r.data, 'tools')[0].step, 3);
    assert.equal(lastStep(r.data), 3);
});

test('then: an explicit step=k wins, and then before a chart line is a problem', () => {
    const r = parseChartText('plot f(x) = x\nthen plot g(x) = x, step=4');
    assert.equal(list(r.data, 'functions')[1].step, 4);
    const bad = parseChartText('plot f(x) = x\nthen show x from 0 to 1');
    assert.equal(bad.problems.length, 1);
    assert.match(bad.problems[0].message, /then/);
});

test('then: a slider called then still reads as a formula', () => {
    const r = parseChartText('slider then from 0 to 2\nthen + x = 3');
    assert.deepEqual(r.problems, []);
    assert.equal(list(r.data, 'tools')[0].type, 'curve');
});

test('then: print writes then where a step starts, and reads back the same', () => {
    const text = ['plot f(x) = x^2', 'then plot g(x) = 2x', 'mark (1, 1)', 'then', 'then write "end" at (0, 1)'].join('\n');
    const printed = roundTrip(text);
    assert.match(printed, /^then plot g\(x\) = 2x$/m);
    assert.match(printed, /^then$/m);
    assert.doesNotMatch(printed, /step=/);
});

test('then: lists out of step order print step=k options', () => {
    const data = { v: 4, functions: [{ name: 'f', expression: 'x', step: 2 }, { name: 'g', expression: 'x^2' }] };
    const printed = printChartText(data);
    assert.match(printed, /step=2/);
    assert.equal(canonical(parseChartText(printed).data), canonical(data));
});

test('then: a chart without steps prints exactly as before', () => {
    const text = 'show x from -3 to 3 and y from -4 to 4\nslider a from -1.1 to 1.1, starting at 0.8\nplot f(x) = x^3 - 3x in blue, thick, with its tangent at a and its extrema';
    assert.equal(roundTrip(text), text);
    assert.equal(hasSteps(parseChartText(text).data), false);
});

test('then: a rewrite keeps the then of a changed line', () => {
    const text = 'plot f(x) = x^2\n% the second step\nthen plot g(x) = 2x in blue\nplot h(x) = 1';
    const data = parseChartText(text).data;
    const fns = list(data, 'functions');
    fns[1] = { ...fns[1], color: 'red' };
    const out = writeChartText(text, data);
    assert.equal(out, 'plot f(x) = x^2\n% the second step\nthen plot g(x) = 2x in red\nplot h(x) = 1');
});

test('then: Full LaTeX \\then before a command, and alone', () => {
    const text = ['plot f(x) = x^2', 'then plot g(x) = 2x in blue', 'then', 'then mark (1, 1)'].join('\n');
    const full = wordsToFull(text);
    assert.match(full, /^\\then \\plot\[blue\]\{g\(x\) = 2x\}$/m);
    assert.match(full, /^\\then$/m);
    const back = parseChartText(full);
    assert.deepEqual(back.problems, []);
    assert.equal(canonical(back.data), canonical(parseChartText(text).data));
});

test('steps: atStep hides the later objects, stepProgress, stepsInOrder', () => {
    const data = parseChartText('plot f(x) = x\nthen plot g(x) = 2x\nthen mark (1, 1)').data;
    const at0 = atStep(data, 0);
    assert.equal(list(at0, 'functions')[1].hidden, true);
    assert.equal(list(at0, 'tools')[0].hidden, true);
    assert.equal(list(atStep(data, 1), 'functions')[1].hidden, undefined);
    assert.equal(atStep(data, 2), data);
    assert.equal(stepOf({ step: 2.7 }), 2);
    assert.equal(stepOf({ step: -1 }), 0);
    assert.equal(stepProgress(undefined, 3), 1);
    assert.equal(stepProgress({ time: 0, step: 1, progress: 0.25 }, 1), 0.25);
    assert.equal(stepProgress({ time: 0, step: 1, progress: 0.25 }, 0), 1);
    assert.equal(stepProgress({ time: 0, step: 1, progress: 0.25 }, 2), 0);
    assert.notEqual(stepsInOrder(canonicalData(data)), null);
});

// -------------------------------------------------------------- frames

test('frames: the chart line, in words and as an \\axis option', () => {
    const r = parseChartText('frames\nplot f(x) = x\nthen plot g(x) = 2x');
    assert.deepEqual(r.problems, []);
    assert.equal(r.data.frames, true);
    roundTrip('frames\nplot f(x) = x\nthen plot g(x) = 2x');
    const full = printFullText(r.data);
    assert.match(full, /\\axis\[frames\]/);
    // A slider called frames stays a formula.
    assert.equal(parseChartText('slider frames from 0 to 2\nframes + x = 3').data.frames, undefined);
});

// --------------------------------------------------------- vector field

test('vector field: the line with its name, options and LaTeX', () => {
    const r = parseChartText('draw the vector field $F(x, y) = (y, -\\sin x - 0.25y)$, coloured by length, with moving particles and streamlines');
    assert.deepEqual(r.problems, []);
    const t = list(r.data, 'tools')[0];
    assert.equal(t.type, 'vectorField');
    assert.equal(t.name, 'F');
    assert.equal(t.expression, '(y, -\\sin x - 0.25y)');
    assert.equal(t.colormap, 'viridis');
    assert.equal(t.particles, true);
    assert.equal(t.streamlines, true);
    const printed = roundTrip('draw the vector field $F(x, y) = (y, -\\sin x - 0.25y)$, coloured by length, with moving particles and streamlines');
    assert.equal(printed, 'draw the vector field $F(x, y) = (y, -\\sin x - 0.25y)$, coloured by length, with moving particles and streamlines');
});

test('vector field: plain form, a colour map, no name, density', () => {
    roundTrip('draw the vector field (y, -x) in red, thick, density=12');
    const printed = roundTrip('draw the vector field G(x, y) = (x - y, x + y), coloured by length in heat');
    assert.match(printed, /coloured by length in heat/);
    assert.equal(list(parseChartText('draw the vector field (y, -x)').data, 'tools')[0].name, 'VF1');
    assert.match(parseChartText('draw the vector field F(x, y) = y').problems[0].message, /vector field F\(x, y\)/);
    assert.match(parseChartText('draw the vector field (y, -x), sparkly').problems[0].message, /unknown option "sparkly"/);
});

// --------------------------------------------------------- rest points

test('rest points: of a field by name, or the nearest one, labelled', () => {
    const text = 'draw the vector field $F(x, y) = (y, -\\sin x - 0.25y)$\nmark the rest points of F, labelled';
    const r = parseChartText(text);
    assert.deepEqual(r.problems, []);
    const rp = list(r.data, 'tools')[1];
    assert.equal(rp.type, 'restPoints');
    assert.equal(rp.field, 'F');
    assert.equal(rp.valueLabel, true);
    roundTrip(text);
    const near = parseChartText('draw the vector field (y, -x)\nmark the rest points, large');
    assert.deepEqual(near.problems, []);
    assert.equal(list(near.data, 'tools')[1].field, 'VF1');
    assert.match(parseChartText('mark the rest points').problems[0].message, /vector field/);
});

// ----------------------------------------------------------- solutions

test('solution of a system: 2D through a points tool, for t from a to b', () => {
    const text = 'mark P at (1, 0)\ndraw the solution of $\\dot{p} = (y, -x)$ through P for t from 0 to 10';
    const r = parseChartText(text);
    assert.deepEqual(r.problems, []);
    const s = list(r.data, 'tools')[1];
    assert.equal(s.type, 'trajectory');
    assert.equal(s.expression, '(y, -x)');
    assert.equal(s.through, 'P');
    assert.equal(s.from, '0');
    assert.equal(s.to, '10');
    assert.equal(s.dim, 2);
    const printed = roundTrip(text);
    assert.match(printed, /draw the solution of \$\\dot\{p\} = \(y, -x\)\$ through P for t from 0 to 10/);
    roundTrip("draw the solution of p' = (y, -x + cos(t)) through (1, 0) and (0, 2) for t from 0 to 2pi, dashed, coloured by time in heat");
});

test('solution of a system: 3D, coloured by time; the 5.0 slope field line is untouched', () => {
    const text = '3d\nshow x from -25 to 25 and y from -30 to 30 and z from 0 to 50\ndraw the solution of $\\dot{p} = (10(y - x), x(28 - z) - y, xy - \\frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 72, coloured by time';
    const r = parseChartText(text);
    assert.deepEqual(r.problems, []);
    const s = list(r.data, 'tools')[0];
    assert.equal(s.dim, 3);
    // 6.0 F4: `coloured by time` alone is the default ramp; a map is named.
    assert.equal(s.byTime, true);
    assert.equal(s.colormap, undefined);
    roundTrip(text);
    const viridis = list(parseChartText(text.replace('coloured by time', 'coloured by time in viridis')).data, 'tools')[0];
    assert.equal(viridis.colormap, 'viridis');
    assert.equal(viridis.byTime, undefined);
    const old = parseChartText("draw the slope field of y' = x - y\ndraw the solution of SF1 through (0, 1)");
    assert.deepEqual(old.problems, []);
    assert.equal(list(old.data, 'tools')[1].type, 'solution');
    // Two formulas in a 3D chart do not fit.
    assert.match(parseChartText('3d\ndraw the solution of (y, -x) through (1, 1, 1)').problems[0].message, /draw the solution of/);
});

// --------------------------------------------------------------- clock

test('clock: only moving particles ask for it', () => {
    const still = parseChartText('draw the vector field (y, -x)').data;
    const moving = parseChartText('draw the vector field (y, -x), with moving particles').data;
    assert.equal(needsClock(still), false);
    assert.equal(needsClock(moving), true);
    assert.equal(movesByItself({ ...list(moving, 'tools')[0], hidden: true }), false);
    assert.equal(needsClock(parseChartText('plot f(x) = x').data), false);
    assert.deepEqual(stillFrame(undefined), STILL);
    assert.equal(stillFrame(2).time, 2);
});

// -------------------------------------------------------------- rename

import { renameInMotionTool, motionToolReads } from '../src/motion6/tools';
import { renameIdentifier, renameToolReferences } from '../src/mathcontext';
import type { Tool } from '../src/types';

test('rename: a slider in a system, a field name in its rest points', () => {
    const data = parseChartText('slider k from 0 to 2\nmark P at (1, 0)\ndraw the vector field F(x, y) = (k y, -x)\nmark the rest points of F\ndraw the solution of (y, -k x) through P for t from 0 to k').data;
    const tools = list(data, 'tools') as unknown as Tool[];
    const param = { expr: (s: string) => renameIdentifier(s, 'k', 'm'), tpl: (s: string) => s, ref: (n: string) => n, kind: 'parameter' as const };
    for (const t of tools) renameInMotionTool(t, param);
    assert.equal((tools[1] as { expression: string }).expression, '(m y, -x)');
    assert.equal((tools[3] as { expression: string; to: string }).expression, '(y, -m x)');
    assert.equal((tools[3] as { to: string }).to, 'm');
    const tool = { expr: (s: string) => renameToolReferences(s, 'P', 'Q'), tpl: (s: string) => s, ref: (n: string) => (n === 'F' ? 'G' : n), kind: 'tool' as const };
    for (const t of tools) renameInMotionTool(t, tool);
    assert.equal((tools[2] as { field: string }).field, 'G');
    assert.equal((tools[3] as { through: string }).through, 'Q');
    assert.equal(motionToolReads(tools[3], (s) => !!s && /\bm\b/.test(s)), true);
});
