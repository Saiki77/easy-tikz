/*
 * 6.2.1: a text written near the edge of the plot (`write "..." at (x, y),
 * right`) moves back inside the plot frame instead of running over it or
 * off the picture; the export anchors it at that edge, so the PDF keeps it
 * inside too.
 */
import { test, assert } from './_lib';
import { setChartLook } from '../src/look';
import { insideShift, labelMetricsFor, textInsideShiftPt } from '../src/scene';
import { SettingsManager } from '../src/settings';
import { parseChartText } from '../src/text/parse';

function settings(text: string): SettingsManager {
    const parsed = parseChartText(text);
    assert.deepEqual(parsed.problems, [], text);
    return SettingsManager.fromJSON(parsed.data);
}

function tikz(text: string): string {
    setChartLook('clean');
    return settings(text).generateTikzCode();
}

// ------------------------------------------------------------ written texts at the edge

test('insideShift: the least shift into the bounds; a box larger than them is centred', () => {
    const bounds = { x0: 0, y0: 0, x1: 100, y1: 50 };
    assert.deepEqual(insideShift({ x0: 80, y0: 10, x1: 130, y1: 20 }, bounds), { x: -30, y: 0 });
    assert.deepEqual(insideShift({ x0: -5, y0: 45, x1: 20, y1: 55 }, bounds), { x: 5, y: -5 });
    assert.deepEqual(insideShift({ x0: 10, y0: 10, x1: 20, y1: 20 }, bounds), { x: 0, y: 0 });
    assert.deepEqual(insideShift({ x0: -20, y0: 0, x1: 140, y1: 10 }, bounds), { x: -10, y: 0 });
});

test('a text written at the right edge of the plot moves back inside it, in the export as in the preview', () => {
    const view = { xmin: 0, xmax: 4.5, ymin: 0, ymax: 5.5 };
    const m = labelMetricsFor(10, 8);
    const near = { x: 3.1, y: 1.1, text: 'Fibres (blue) = the mixed set', anchor: 'right' as const, size: 'normal' as const };
    const d = textInsideShiftPt(near, view, m);
    assert.ok(d.x < -10 && d.y === 0, `moved left: ${JSON.stringify(d)}`);
    assert.deepEqual(textInsideShiftPt({ ...near, x: 0.5 }, view, m), { x: 0, y: 0 }, 'one with room stays');
    assert.deepEqual(textInsideShiftPt({ ...near, x: 4.6 }, view, m), { x: 0, y: 0 }, 'a point outside the view keeps its place');
    const code = tikz(['show x from 0 to 4.5 and y from 0 to 5.5', 'size 10 x 8', 'axes on the edges', 'write "Fibres (blue) = the mixed set" at (3.1, 1.1), right', 'write "middle" at (2, 3), center'].join('\n'));
    // The export anchors it at the right edge (a margin in), which holds however large pgfplots makes the plot.
    const node = code.split('\n').find((l) => l.includes('{Fibres (blue) = the mixed set}')) ?? '';
    assert.ok(/anchor=east, [^\]]*xshift=-2\.25pt\] at \(axis cs:4\.5,1\.1\)/.test(node), node);
    const middle = code.split('\n').find((l) => l.includes('{middle}')) ?? '';
    assert.ok(!/xshift|yshift/.test(middle), middle);
});
