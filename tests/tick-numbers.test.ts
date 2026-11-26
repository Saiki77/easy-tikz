/*
 * 6.2.1: the clean look's axis numbers next to marked points and curves.
 * A number is left out only when a point or a curve really covers its
 * digits, and moves a little away from its axis when that clears them
 * (up to 6.2.0 the integer points on an axis hid all its whole numbers).
 * cleanTickSpots is shared by the preview and the export.
 */
import { test, assert } from './_lib';
import { CleanAxisFrame, TickObstacles, cleanTickSpots, setChartLook } from '../src/look';
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

/** The value of `key={...}` in the axis options, braces matched. */
function option(code: string, key: string): string | null {
    const at = code.search(new RegExp(`(?:^|[\\s,])${key}=\\{`, 'm'));
    if (at < 0) return null;
    const start = code.indexOf('{', code.indexOf(`${key}=`, at)) + 1;
    let depth = 1;
    for (let i = start; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}' && --depth === 0) return code.slice(start, i);
    }
    return null;
}

/** The tick labels of an axis as written, by tick: '' where the number is left out. */
function tickLabels(code: string, axis: 'x' | 'y'): Map<string, string> {
    const ticks = (option(code, `${axis}tick`) ?? '').split(',');
    const labels: string[] = [];
    let depth = 0;
    let cur = '';
    for (const c of option(code, `${axis}ticklabels`) ?? '') {
        if (c === '{' && depth++ === 0) continue;
        if (c === '}' && --depth === 0) {
            labels.push(cur);
            cur = '';
            continue;
        }
        if (depth > 0) cur += c;
    }
    return new Map(ticks.map((t, i) => [t, labels[i] ?? '?']));
}

// ------------------------------------------------------------ axis numbers next to marked points

/** The clean look's numbers as a 10 cm chart draws them: 7 pt numbers at 2.67 px per pt. */
const FRAME: CleanAxisFrame = { sx: (v) => 100 + v * 60, sy: (v) => 300 - v * 60, ox: 100, oy: 300, place: { x: 'zero', y: 'zero' }, fs: 18.7, gap: 7.34, charEm: 0.56 };
const TICKS = [-1, 0, 1, 2, 3, 4].map((value) => ({ value }));

test('cleanTickSpots: marked points on the axis next to the numbers no longer hide them', () => {
    // The integer points of a region on the x-axis (normal and large dots of the clean look).
    const dots: TickObstacles = { dots: [1, 2, 3].map((v) => ({ x: FRAME.sx(v), y: FRAME.oy, r: v === 3 ? 6.25 : 4.75 })), lines: [] };
    const spots = cleanTickSpots('x', TICKS, (t) => String(t.value), { step: 1, listed: false, frame: FRAME, obstacles: dots });
    assert.deepEqual(spots.map((s) => s.show), [true, false, true, true, true, true], 'only the 0 where the axes cross is left out');
    // A point on the y-axis beside its number: the number stays; a large one moves it a little away from the axis.
    const yDots: TickObstacles = { dots: [{ x: FRAME.ox, y: FRAME.sy(1), r: 4.75 }, { x: FRAME.ox, y: FRAME.sy(2), r: 6.25 }], lines: [] };
    const y = cleanTickSpots('y', TICKS, (t) => String(t.value), { step: 1, listed: false, frame: FRAME, obstacles: yDots });
    assert.equal(y[2].show, true);
    assert.equal(y[2].shift, 0);
    assert.equal(y[3].show, true);
    assert.ok(y[3].shift > 0 && y[3].shift <= 0.3 * FRAME.fs, `moved a little: ${y[3].shift}`);
    assert.ok(y[3].x < y[2].x, 'to the left, away from the axis');
});

test('cleanTickSpots: a number is left out only when a point or a curve really covers its digits', () => {
    // A dot right on the digits of 2.
    const onDigits: TickObstacles = { dots: [{ x: FRAME.sx(2), y: FRAME.oy + FRAME.gap + 0.45 * FRAME.fs, r: 4.75 }], lines: [] };
    const covered = cleanTickSpots('x', TICKS, (t) => String(t.value), { step: 1, listed: false, frame: FRAME, obstacles: onDigits });
    assert.equal(covered[3].show, false);
    // A curve through the axis at y = 1 that grazes the corner of the number moves it; one through its middle hides it.
    const graze: TickObstacles = { dots: [], lines: [[{ x: FRAME.ox, y: FRAME.sy(1) }, { x: FRAME.ox - 60, y: FRAME.sy(1) - 50 }]] };
    const grazed = cleanTickSpots('y', TICKS, (t) => String(t.value), { step: 1, listed: false, frame: FRAME, obstacles: graze });
    assert.equal(grazed[2].show, true, 'the line leaves the number as it moves away from the axis');
    assert.ok(grazed[2].shift > 0);
    const through: TickObstacles = { dots: [], lines: [[{ x: 0, y: FRAME.sy(1) }, { x: 200, y: FRAME.sy(1) }]] };
    assert.equal(cleanTickSpots('y', TICKS, (t) => String(t.value), { step: 1, listed: false, frame: FRAME, obstacles: through })[2].show, false);
});

test('clean export: the integer points on the x-axis keep its numbers; a moved number is lowered in the PDF too', () => {
    const code = tikz(['show x from -0.8 to 4 and y from -0.5 to 3.5', 'size 10 x 8', 'axes in the middle', 'shade where y >= 0 and y <= 2 and x >= 0 and x <= 3 in blue, opacity 0.2', 'mark the integer points in the region, in blue'].join('\n'));
    const x = tickLabels(code, 'x');
    for (const t of ['1', '2', '3']) assert.ok(/pgfmathprintnumber\{\d\}/.test(x.get(t) ?? ''), `x number ${t} shows: ${x.get(t)}`);
    assert.equal(x.get('0'), '', 'the 0 where the axes cross is left out');
    // Large dots on the axis: the numbers beside them move down a little (\raisebox keeps their box).
    const large = tikz(['show x from -1 to 4 and y from -1 to 3', 'size 10 x 8', 'axes in the middle', 'mark (1, 0), (2, 0) and (3, 0) in red, large'].join('\n'));
    const lx = tickLabels(large, 'x');
    for (const t of ['1', '2', '3']) assert.ok(/^\\raisebox\{-[\d.]+pt\}\[\\height\]\[\\depth\]\{\$\\pgfmathprintnumber\{\d\}\$\}$/.test(lx.get(t) ?? ''), `x number ${t}: ${lx.get(t)}`);
    assert.equal(lx.get('4'), '$\\pgfmathprintnumber{4}$', 'a number without a dot stays where it is');
});
