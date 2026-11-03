// The 3D box as the camera sees it (src/box3d.ts): the preview paints far
// to near with the export's camera, draws its box as pgfplots does
// (outline and back edges, not the three edges at the front corner), puts
// the tick numbers outside the box, and lays the grid on the back faces.
import { test, assert } from './_lib';
import { BOX_EDGES, Vec3, edgeKind, farFirst, gridLines, stepValues, tickSides, toViewer } from '../src/box3d';
import { previewCamera3D } from '../src/export';
import { SettingsManager } from '../src/settings';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The preview's depth of a normalized point (renderer3d project): -(toViewer . n). */
function previewDepth(n: Vec3, az: number, el: number): number {
    const a = (az * Math.PI) / 180;
    const e = (el * Math.PI) / 180;
    const ry = n[0] * Math.sin(a) + n[1] * Math.cos(a);
    return ry * Math.cos(e) - n[2] * Math.sin(e);
}

/** Corner of the box (bits as BOX_EDGES) in normalized coordinates. */
const corner = (c: number): Vec3 => [c & 1 ? 1 : -1, c & 2 ? 1 : -1, c & 4 ? 1 : -1];

function kinds(az: number, el: number): Record<string, string[]> {
    const view = toViewer(az, el);
    const out: Record<string, string[]> = { back: [], outline: [], hidden: [] };
    for (const [i, j] of BOX_EDGES) out[edgeKind(view, i, j)].push(`${i}-${j}`);
    return out;
}

test('box3d: the camera of the preview is the camera of the export', () => {
    for (const [az, el] of [[45, 30], [60, 20], [200, 10], [0, 90], [315, -5]]) {
        const chart = SettingsManager.fromJSON({ v: 4, dimension: true, rotationZ: az, rotationX: el });
        const fromExport = previewCamera3D(chart.toRendererConfig(chart.createMathContext({ memo: false }))).toViewer;
        const ours = toViewer(az, el);
        for (let k = 0; k < 3; k++) assert.ok(Math.abs(fromExport[k] - ours[k]) < 1e-12, `az ${az}, el ${el}: ${fromExport} vs ${ours}`);
    }
});

test('box3d: a larger depth is farther, and the painter draws it first', () => {
    for (const [az, el] of [[45, 30], [60, 20], [130, 0], [10, 75]]) {
        const view = toViewer(az, el);
        for (let c = 0; c < 8; c++) {
            const n = corner(c);
            assert.ok(Math.abs(previewDepth(n, az, el) + dot(view, n)) < 1e-12, `depth of corner ${c} at az ${az}, el ${el}`);
        }
        // The corner nearest the viewer and the one farthest away.
        const order = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => ({ c, depth: previewDepth(corner(c), az, el) })).sort(farFirst);
        const nearest = order[order.length - 1].c;
        const farthest = order[0].c;
        assert.ok(dot(view, corner(nearest)) > dot(view, corner(farthest)), `az ${az}, el ${el}: corner ${nearest} is drawn last but is not the nearest`);
    }
    // From above (elevation 30) a point high in the box is nearer than one low in it, so the floor is drawn first.
    const high = { depth: previewDepth([0, 0, 0.9], 45, 30) };
    const low = { depth: previewDepth([0, 0, -0.9], 45, 30) };
    assert.deepEqual([high, low].sort(farFirst), [low, high]);
});

test('box3d: in a general view 6 edges outline the box, 3 lie behind it and the 3 at the front corner are left out', () => {
    const k = kinds(45, 30);
    assert.equal(k.outline.length, 6);
    assert.equal(k.back.length, 3);
    assert.equal(k.hidden.length, 3);
    // Seen from above at azimuth 45 the front corner is (xmin, ymin, zmax) = 4, the far one on the floor is (xmax, ymax, zmin) = 3.
    assert.deepEqual(k.hidden.sort(), ['0-4', '4-5', '6-4'].sort());
    assert.deepEqual(k.back.sort(), ['1-3', '3-2', '3-7'].sort());
});

test('box3d: seen from the side only the vertical edge nearest the viewer is left out', () => {
    const k = kinds(40, 0);
    assert.deepEqual(k.hidden, ['0-4']);
    // Straight from above nothing is left out: only the top faces the viewer.
    const top = kinds(45, 90);
    assert.equal(top.hidden.length, 0);
    assert.equal(top.outline.length, 4);
});

test('box3d: the tick numbers go outside the box', () => {
    const sx = (az: number) => {
        const a = (az * Math.PI) / 180;
        return [0, 1, 2, 3, 4, 5, 6, 7].map((c) => corner(c)[0] * Math.cos(a) - corner(c)[1] * Math.sin(a));
    };
    // Azimuth 45, elevation 30: x and y on the floor edges at the front faces (y min, x min), z on the left outline.
    const s = tickSides(toViewer(45, 30), sx(45));
    assert.deepEqual(s.x, { y: 0, z: 0 });
    assert.deepEqual(s.y, { x: 0, z: 0 });
    assert.deepEqual(s.z, { x: 0, y: 1 });
    const zCorner = s.z.x | (s.z.y << 1);
    assert.equal(edgeKind(toViewer(45, 30), zCorner, zCorner | 4), 'outline');
    assert.ok(sx(45)[zCorner] <= Math.min(...sx(45)) + 1e-12, 'the z edge is the leftmost corner');
    // The tick edges are on the outline, never one of the edges left out.
    for (const [az, el] of [[45, 30], [60, 20], [130, 10], [250, 35], [300, 5]]) {
        const view = toViewer(az, el);
        const t = tickSides(view, sx(az));
        const xEdge = [(t.x.y << 1) | (t.x.z << 2), 1 | (t.x.y << 1) | (t.x.z << 2)];
        const yEdge = [t.y.x | (t.y.z << 2), t.y.x | 2 | (t.y.z << 2)];
        const zEdge = [t.z.x | (t.z.y << 1), t.z.x | (t.z.y << 1) | 4];
        for (const [i, j] of [xEdge, yEdge, zEdge]) assert.equal(edgeKind(view, i, j), 'outline', `az ${az}, el ${el}: edge ${i}-${j}`);
    }
    // Seen from below, x and y go to the top edges.
    assert.equal(tickSides(toViewer(45, -20), sx(45)).x.z, 1);
});

test('box3d: the grid lies on the floor and the back walls only, inside the box', () => {
    const box = { xmin: -5, xmax: 5, ymin: -5, ymax: 5, zmin: -25, zmax: 25 };
    const major = [stepValues(-5, 5, 2), stepValues(-5, 5, 2), stepValues(-25, 25, 10)];
    const lines = gridLines(toViewer(45, 30), box, major, [[], [], []]);
    // Back faces at azimuth 45, elevation 30: x max, y max and the floor (z min).
    const onFace = (l: { from: Vec3; to: Vec3 }) =>
        l.from[0] === 5 && l.to[0] === 5 ? 'x max' : l.from[1] === 5 && l.to[1] === 5 ? 'y max' : l.from[2] === -25 && l.to[2] === -25 ? 'floor' : 'other';
    const faces = new Set(lines.map(onFace));
    assert.deepEqual([...faces].sort(), ['floor', 'x max', 'y max']);
    // Every line lies on its face and inside the box: none runs along a box edge.
    for (const l of lines) {
        for (let k = 0; k < 3; k++) {
            if (l.from[k] !== l.to[k]) continue;
            const v = l.from[k];
            const [lo, hi] = [[-5, 5], [-5, 5], [-25, 25]][k];
            const fixedFace = (k === 0 && v === 5) || (k === 1 && v === 5) || (k === 2 && v === -25);
            assert.ok(fixedFace || (v > lo && v < hi), `a grid line at ${v} on axis ${k}`);
        }
    }
    // Floor: lines at x = -4, -2, 0, 2, 4 and at the same y: 10 (each wall likewise, 5 + 5).
    assert.equal(lines.filter((l) => onFace(l) === 'floor').length, 10);
    // Minor values that are also major ones are drawn once.
    const both = gridLines(toViewer(45, 30), box, major, [stepValues(-5, 5, 1), [], []]);
    const floorMinorAtX = both.filter((l) => l.minor && l.from[2] === -25 && l.to[2] === -25 && l.from[0] === l.to[0]).map((l) => l.from[0]);
    assert.deepEqual(floorMinorAtX.sort((a, b) => a - b), [-3, -1, 1, 3]);
});

test('box3d: stepValues are the multiples of the step from lo to hi', () => {
    assert.deepEqual(stepValues(-5, 5, 2.5), [-5, -2.5, 0, 2.5, 5]);
    assert.deepEqual(stepValues(0.1, 0.35, 0.1), [0.1, 0.2, 0.3]);
    assert.deepEqual(stepValues(1, 0, 1), []);
    assert.deepEqual(stepValues(0, 1, 0), []);
});
