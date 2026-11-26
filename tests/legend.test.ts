/*
 * 6.2.1: the legend keeps the top right corner unless it would cover a
 * label, a written text, a marked point or numbers there; then it takes the
 * corner that covers least (legendCorner, the same estimates in the preview
 * and the export's `legend pos`). A legend entry with `\to` is braced so
 * pgfplots' lists do not end at it.
 */
import { test, assert, near } from './_lib';
import { labelMetricsFor, labelWidthEm } from '../src/scene';
import { LEGEND_CORNERS, legendBoxPt, legendCorner, legendObstacles } from '../src/legend';
import { SettingsManager } from '../src/settings';
import { parseChartText } from '../src/text/parse';

function settings(text: string): SettingsManager {
    const parsed = parseChartText(text);
    assert.deepEqual(parsed.problems, [], text);
    return SettingsManager.fromJSON(parsed.data);
}

test('labelWidthEm: an operator name counts its letters, a relation its spaces', () => {
    assert.ok(labelWidthEm('$\\max x$') > labelWidthEm('$a x$') + 1, 'max is three letters');
    assert.ok(labelWidthEm('$a \\to b$') > labelWidthEm('$a b$') + 0.5, 'an arrow has a space on each side');
    // Text without commands measures as before.
    near(labelWidthEm('abc'), 3 * 0.56, 1e-9);
});

// ------------------------------------------------------------ the place of the legend

const LEGEND_CHART = [
    'show x from -1.5 to 3.5 and y from -6.5 to 6.5',
    'size 10 x 7',
    'axes in the middle',
    'plot f(x) = (x - 1)^2 + 2 in blue, with the legend "$f(x) = (x-1)^2 + 2 \\to \\min$"',
    'plot g(x) = -(x - 1)^2 - 2 in red, with the legend "$-f(x) \\to \\max$"',
    'draw x = 1 in gray, dashed, labelled "$x^* = 1$"',
].join('\n');

test('the legend leaves the top right corner when it would cover a label there, in the PDF too', () => {
    const s = settings(LEGEND_CHART);
    const code = s.generateTikzCode();
    const pos = /legend pos=([a-z ]+),/.exec(code);
    assert.ok(pos && pos[1] !== 'north east', `legend pos: ${pos && pos[1]}`);
    // pgfplots ends its list items at \to: an entry with an arrow goes in braces (pdflatex stopped on it before).
    assert.ok(code.includes('\\addlegendentry{{$f(x) = (x-1)^2 + 2 \\to \\min$}}'), code);
    assert.ok(code.includes('\\addlegendentry{{$-f(x) \\to \\max$}}'), code);
    // Without the label the legend keeps the top right corner.
    const plain = settings(LEGEND_CHART.replace(', labelled "$x^* = 1$"', '')).generateTikzCode();
    assert.ok(plain.includes('legend pos=north east'), plain);
});

test('legendCorner: covers, then lines; the top right corner when it covers nothing', () => {
    const m = { w: 240, h: 170 };
    const labels = ['$f(x)$'];
    const empty = { labels: [], markers: [], numbers: [], lines: [] };
    assert.equal(legendCorner(labels, empty, m), 'north east');
    const ne = legendBoxPt(labels, 'north east', m);
    const underNE = { ...empty, labels: [{ x0: ne.x0 + 2, y0: ne.y0 + 2, x1: ne.x0 + 20, y1: ne.y0 + 10 }] };
    assert.equal(legendCorner(labels, underNE, m), 'north west', 'the next corner in order');
    // A line through the top left corner: the bottom right one, which covers nothing.
    const nw = legendBoxPt(labels, 'north west', m);
    const line = { ...underNE, lines: [[{ x: nw.x0, y: (nw.y0 + nw.y1) / 2 }, { x: nw.x1, y: (nw.y0 + nw.y1) / 2 }]] };
    assert.equal(legendCorner(labels, line, m), 'south east');
    assert.deepEqual([...LEGEND_CORNERS], ['north east', 'north west', 'south east', 'south west']);
});

test('legendObstacles: written texts and marked points count; hidden texts do not', () => {
    const s = settings(['show x from 0 to 10 and y from 0 to 10', 'write "note" at (9, 9), center', 'mark (1, 1)'].join('\n'));
    const ctx = s.createMathContext();
    const config = s.toRendererConfig(ctx);
    const o = legendObstacles({ functions: config.functions || [], annotations: config.annotations, axisStyle: config.axisStyle, clean: true }, ctx, [], { xmin: 0, xmax: 10, ymin: 0, ymax: 10 }, labelMetricsFor(10, 10));
    assert.equal(o.labels.length, 1);
    const hidden = legendObstacles({ functions: [], annotations: (config.annotations || []).map((a) => ({ ...a, hidden: true })), axisStyle: 'box' }, ctx, [], { xmin: 0, xmax: 10, ymin: 0, ymax: 10 }, labelMetricsFor(10, 10));
    assert.equal(hidden.labels.length, 0);
});
