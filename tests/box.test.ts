// The 3D box with its own lengths and a box that fills its chart (5.2.5): `box 1 x 2 x 0.6` in words,
// `plot box ratio={1 2 0.6}` in Full LaTeX, Custom in Chart, 3D view, Box; the preview fits the box as this view
// shows it (src/box3d.ts boxFactors, boxFitScale), as the PDF already did.
import { test, assert } from './_lib';
import { BOX_FILL_ACROSS, BOX_FILL_UP, Vec3, boxAspectOf, boxFactors, boxFitScale, boxRatioOf, projectedBox } from '../src/box3d';
import { previewCamera3D } from '../src/export';
import { SettingsManager } from '../src/settings';
import { canonical } from '../src/chartdata';
import { parseChartText } from '../src/text/parse';
import { printChartText, printFullText, writeChartText } from '../src/text/print';
import { readFull } from '../src/text/full';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test('box: lengths read from an array or a text, three positive numbers or nothing', () => {
    assert.deepEqual(boxRatioOf([1, 2, 0.6]), [1, 2, 0.6]);
    assert.deepEqual(boxRatioOf('1 x 2 x 0.6'), [1, 2, 0.6]);
    assert.deepEqual(boxRatioOf('1 2 0.6'), [1, 2, 0.6]);
    assert.deepEqual(boxRatioOf('1:2:0.6'), [1, 2, 0.6]);
    assert.deepEqual(boxRatioOf(['3', '10', '1']), [3, 10, 1]);
    for (const bad of [[1, 2], [1, 0, 1], [1, -2, 1], '1 x 2', 'a x 2 x 3', null, undefined, 4, [1, 2, NaN]]) assert.equal(boxRatioOf(bad), null, JSON.stringify(bad));
    assert.equal(boxAspectOf('equal'), 'equal');
    assert.equal(boxAspectOf('custom'), 'custom');
    assert.equal(boxAspectOf('true'), 'true');
    assert.equal(boxAspectOf(undefined), 'true');
});

test('box: the edges, longest 2: a cube, the ranges, or the own lengths', () => {
    const ranges: Vec3 = [12, 40, 4];
    const edges = (f: Vec3) => f.map((v, k) => v * ranges[k]);
    const same = (got: number[], want: number[]) => assert.ok(got.every((v, k) => near(v, want[k])), `${got} vs ${want}`);
    same(edges(boxFactors(ranges, 'equal')), [2, 2, 2]);
    same(edges(boxFactors(ranges, 'true')), [0.6, 2, 0.2]);
    same(edges(boxFactors(ranges, 'custom', [1, 2, 0.6])), [1, 2, 0.6]);
    // Not valid lengths: a cube.
    same(edges(boxFactors(ranges, 'custom', [1, 0, 1])), [2, 2, 2]);
});

test('box: a cube from the default view keeps the size of before; a long box fills a wide chart', () => {
    const cube: Vec3 = [1, 1, 1];
    for (const side of [400, 680, 1020]) assert.ok(near(boxFitScale(cube, 45, 30, side, side), 0.28 * side, 0.001 * side), String(side));
    const seen = projectedBox(cube, 45, 30);
    assert.ok(near(seen.width, 2 * Math.SQRT2, 1e-12) && near(seen.height, Math.SQRT2 + Math.sqrt(3), 1e-12), JSON.stringify(seen));
    // The chart of the report: x 12, y 40, z 4, Proportional, 1100 x 430 px, seen from azimuth 269°, elevation 42°.
    const availW = 1100 - 80;
    const availH = 430 - 80;
    const half = [0.3, 1, 0.1] as Vec3;
    const before = 0.28 * Math.min(availW, availH);
    const now = boxFitScale(half, 269, 42, availW, availH);
    assert.ok(now > 4 * before, `${now} vs ${before}`);
    const box = projectedBox(half, 269, 42);
    // It fills the width as far as its labels allow, and stays inside the height.
    assert.ok(near(box.width * now, BOX_FILL_ACROSS * availW, 1e-6) && box.height * now <= BOX_FILL_UP * availH + 1e-6, JSON.stringify({ box, now }));
    // Seen end on, the same box needs height: it is smaller, and still inside.
    const endOn = boxFitScale(half, 0, 42, availW, availH);
    assert.ok(endOn < now && projectedBox(half, 0, 42).height * endOn <= BOX_FILL_UP * availH + 1e-6);
});

test('box: words box 1 x 2 x 0.6, read and written', () => {
    const text = ['3d', 'box 1 x 2 x 0.6', 'show x from -6 to 6, y from -20 to 20 and z from -2 to 2', 'plot z = sin(x) cos(y/3)'].join('\n');
    const r = parseChartText(text);
    assert.deepEqual(r.problems, []);
    assert.equal(r.data.boxAspect, 'custom');
    assert.deepEqual(r.data.boxRatio, [1, 2, 0.6]);
    const printed = printChartText(r.data);
    assert.deepEqual(printed.split('\n').slice(0, 2), ['3d', 'box 1 x 2 x 0.6'], printed);
    assert.equal(canonical(parseChartText(printed).data), canonical(r.data));
    assert.equal(writeChartText(text, r.data), text);
    // Other ways to write the lengths read the same.
    for (const line of ['box 1 by 2 by 0.6', 'box 1 : 2 : 0.6', 'box 1x2x0.6']) assert.deepEqual(parseChartText(`3d\n${line}\nplot z = x*y`).data.boxRatio, [1, 2, 0.6], line);
    // Switched in the editor: the line comes, changes and goes; the rest stays.
    const base = parseChartText('3d\n% waves\nplot z = x*y').data;
    const custom = writeChartText('3d\n% waves\nplot z = x*y', { ...base, boxAspect: 'custom', boxRatio: [3, 10, 1] });
    assert.equal(custom, '3d\nbox 3 x 10 x 1\n% waves\nplot z = x*y');
    assert.equal(writeChartText(custom, { ...base, boxAspect: 'equal' }), '3d\ncube\n% waves\nplot z = x*y');
    assert.equal(writeChartText(custom, base), '3d\n% waves\nplot z = x*y');
});

test('box: wrong lengths say what box takes; a formula with a slider called box stays a formula', () => {
    for (const line of ['box 1 x 2', 'box 1 x 0 x 2', 'box 1 x 2 x 3, red']) {
        const r = parseChartText(`3d\n${line}\nplot z = x*y`);
        assert.equal(r.problems.length, 1, line);
        assert.match(r.problems[0].message, /box takes the three lengths/, line);
        assert.notEqual(r.data.boxAspect, 'custom', line);
    }
    const formula = parseChartText('slider box from 0 to 2\nplot f(x) = box + x');
    assert.deepEqual(formula.problems, []);
});

test('box: Full LaTeX writes and reads plot box ratio', () => {
    const data = parseChartText('3d\nbox 1 x 2 x 0.6\nplot z = x*y').data;
    const full = printFullText(data);
    assert.match(full, /plot box ratio=\{1 2 0\.6\}/, full);
    assert.deepEqual(readFull(full).problems, []);
    assert.match(readFull(full).text, /^box 1 x 2 x 0\.6$/m);
    const back = parseChartText(full);
    assert.deepEqual(back.problems, []);
    assert.equal(canonical(back.data), canonical(data));
});

test('box: the PDF camera and the preview share the lengths', () => {
    const settings = SettingsManager.fromJSON({ dimension: true, boxAspect: 'custom', boxRatio: [1, 2, 0.6], xmin: -6, xmax: 6, ymin: -20, ymax: 20, zmin: -2, zmax: 2 });
    const config = settings.toRendererConfig();
    assert.equal(config.boxAspect, 'custom');
    assert.deepEqual(config.boxRatio, [1, 2, 0.6]);
    const camera = previewCamera3D(config);
    const edges = camera.factors.map((f, k) => f * [12, 40, 4][k]);
    assert.ok(near(edges[0], 1) && near(edges[1], 2) && near(edges[2], 0.6), String(edges));
});
