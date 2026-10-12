/*
 * Every user-facing string of drag to edit (SPEC3 1.8, 1.11): lock reasons,
 * hover / live / tip chips, undo labels, announcements, truncation; plus the
 * hover chips the session builds for the LP, areas, tangent, levels and
 * surplus examples (Mac and non-Mac key names).
 */
import { test, assert } from './_lib';
import {
    CHART_LABEL,
    CORE_RULE,
    HoverInfo,
    dragAnnouncement,
    hoverChip,
    joinNames,
    liveChip,
    lockChip,
    lockFor,
    madeSliderText,
    noPivotLockFor,
    pointText,
    selectAnnouncement,
    shiftLockFor,
    staleText,
    tipChip,
    undoLabel,
} from '../src/drag/describe';
import { prepareDrag } from '../src/drag/session';
import { resolveTarget } from '../src/drag/targets';
import { EXAMPLES } from '../src/migrate';
import type { Chip, DragTarget, HitShape } from '../src/drag/types';
import { hitAt, hitByKey, makeChart } from './_drag';

const MAC = { mod: 'Cmd' as const, alt: 'Option' as const };
const PC = { mod: 'Ctrl' as const, alt: 'Alt' as const };

/** Chip title with highlighted parts (num, ghost, changed) in brackets. */
function title(c: Chip): string {
    return c.title.map((p) => (p.kind === 'plain' ? p.text : `[${p.text}]`)).join('');
}

function target(over: Partial<DragTarget>): DragTarget {
    return {
        key: 'k',
        source: 'f1',
        subject: 'f1',
        kind: 'graph',
        units: [],
        straight: false,
        closed: false,
        allowSliders: true,
        virtual: [],
        shift: 'none',
        lock: null,
        lines: [],
        run: -1,
        points: [],
        twins: [],
        cardSource: 'f1',
        cardField: 'expression',
        ...over,
    };
}

function info(t: DragTarget, text: string, over: Partial<HoverInfo> = {}): HoverInfo {
    return {
        target: t,
        gesture: 'move',
        text,
        numSpans: [],
        ghosts: [],
        virtualKinds: [],
        restricted: 'none',
        pivot: null,
        sharedSliders: [],
        twins: [],
        passed: null,
        shiftLock: null,
        ...over,
    };
}

/** [s, e) of `needle` (the n-th occurrence) in `text`. */
function span(text: string, needle: string, nth = 0): [number, number] {
    let i = -1;
    for (let k = 0; k <= nth; k++) i = text.indexOf(needle, i + 1);
    if (i < 0) throw new Error(`${needle} not in ${text}`);
    return [i, i + needle.length];
}

// ------------------------------------------------------------------- locks

test('lockFor: every reason has the SPEC3 1.8 copy', () => {
    const cases: Array<[Parameters<typeof lockFor>[0], string, string]> = [
        [
            { kind: 'optimum', point: 'P1', objective: '2x + 3y', region: 'R1', sense: 'max', twinCurve: 'C1' },
            'P1 is computed: the max of 2x + 3y over R1',
            "Drag R1's lines or C1 instead",
        ],
        [
            { kind: 'optimum', point: 'P1', objective: 'x^2 + y^2', region: 'R1', sense: 'min', twinCurve: null },
            'P1 is computed: the min of x^2 + y^2 over R1',
            "Drag R1's lines instead",
        ],
        [{ kind: 'intersection', point: 'P1', a: 'f1', b: 'f2' }, 'P1 is computed: where f1 meets f2', 'Drag f1 or f2 instead'],
        [{ kind: 'corner', point: 'P2', region: 'R1' }, 'P2 is computed: the corners of R1', "Drag R1's lines instead"],
        [{ kind: 'lattice', point: 'P3', region: 'R1' }, 'P3 is computed: the integer points of R1', "Drag R1's lines instead"],
        [{ kind: 'lattice', point: 'P3', region: null }, 'P3 is computed: the integer points of the view', 'Pan or zoom the view instead'],
        [{ kind: 'derivedClause', region: 'R1', name: 'P1_y', tool: 'P1' }, 'This edge of R1 follows P1_y', 'P1 computes it'],
        [{ kind: 'derivedLevel', curve: 'C2', name: 'P1_val', tool: 'P1' }, "C2's level is P1_val", 'P1 computes it. Shift-drag reshapes the curve'],
        [{ kind: 'keywordTangent', fn: 'f1', keyword: 'max' }, 'The tangent of f1 sits at its max', 'Type a number or a slider in Tangent at to drag it'],
        [{ kind: 'derivedTangent', fn: 'f1', name: 'P1_x', tool: 'P1' }, 'The tangent of f1 follows P1_x', 'P1 computes it'],
        [{ kind: 'splicedVertex', segment: 'S1', index: 3, from: 'P2', fromIsList: true }, 'S1 point 3 comes from P2', 'Drag it in P2 instead'],
        [{ kind: 'splicedVertex', segment: 'S1', index: 3, from: 'P2', fromIsList: false }, 'S1 point 3 comes from P2', 'P2 computes it'],
        [{ kind: 'splicedPath', segment: 'S1', from: 'P2' }, "S1 follows P2's points", 'Drag its own points instead'],
        [
            { kind: 'curveKind', fn: 'f2', fnKind: 'parametric' },
            'f2 is parametric',
            'Dragging works for y = f(x) curves, regions, curves, points, segments and labels',
        ],
        [{ kind: 'curveKind', fn: 'f2', fnKind: 'polar' }, 'f2 is polar', 'Dragging works for y = f(x) curves, regions, curves, points, segments and labels'],
        [{ kind: 'nothing', subject: 'C2' }, 'Nothing in C2 can change by dragging', 'Its text has no numbers or sliders'],
        [{ kind: 'axisSlider', name: 'c' }, 'c also sets the axis range', 'Dragging leaves it alone. Change it in the dock'],
        [{ kind: 'cannotDragHere', subject: 'f1' }, 'f1 cannot be dragged here', 'Grab it where it is drawn'],
    ];
    for (const [reason, t, d] of cases) {
        const lock = lockFor(reason);
        assert.equal(lock.title, t);
        assert.equal(lock.detail, d);
    }
    const chip = lockChip(lockFor({ kind: 'corner', point: 'P2', region: 'R1' }));
    assert.equal(chip.tone, 'locked');
    assert.equal(title(chip), 'P2 is computed: the corners of R1');
});

test('shift locks: no y term and the generic copy', () => {
    const clause = target({ subject: 'R1 (3)', kind: 'clause', straight: true, shift: 'turn' });
    assert.equal(shiftLockFor(clause, { text: 'x <= 4', variable: 'y' }).title, 'Shift-drag cannot turn x <= 4: it has no y term');
    assert.equal(shiftLockFor(clause, null).title, 'Shift-drag cannot turn R1 (3) with its numbers');
    assert.equal(shiftLockFor(target({ subject: 'f3', shift: 'stretch' }), null).title, 'Shift-drag cannot stretch f3 with its numbers');
    // No pivot far enough from the grab: the numbers are not to blame.
    const np = noPivotLockFor(target({ subject: 'C1', kind: 'curve', shift: 'stretch' }));
    assert.equal(np.title, 'Shift-drag has no ⊕ to stretch C1 from this point');
    assert.equal(np.detail, 'Grab it elsewhere to stretch it, or drag without Shift to move it');
    assert.equal(noPivotLockFor(clause).title, 'Shift-drag has no ⊕ to turn R1 (3) from this point');
    const h = hoverChip(info(clause, 'x <= 4', { gesture: 'pivot', shiftLock: shiftLockFor(clause, { text: 'x <= 4', variable: 'y' }) }), MAC);
    assert.equal(h.detail, 'Shift-drag cannot turn x <= 4: it has no y term');
});

// ------------------------------------------------------------------ hover

test('hover chips: the SPEC3 1.8 examples', () => {
    const line = target({ straight: true, shift: 'turn' });
    let text = '2x + 1';
    let c = hoverChip(info(line, text, { numSpans: [span(text, '1')] }), MAC);
    assert.equal(title(c), 'f1: 2x + [1]');
    assert.equal(c.detail, 'Drag to move · Shift-drag to turn');
    assert.equal(c.note, '');
    assert.equal(c.tone, 'normal');

    c = hoverChip(info(line, text, { gesture: 'pivot', numSpans: [span(text, '2')], pivot: { at: { x: 0, y: 1 } } }), MAC);
    assert.equal(title(c), 'f1: [2]x + 1');
    assert.equal(c.detail, 'Shift-drag turns around ⊕ (0, 1)');

    const sin = target({ subject: 'f2', shift: 'stretch' });
    text = 'sin(x)';
    c = hoverChip(
        info(sin, text, {
            ghosts: [
                { at: 5, text: ' - h' },
                { at: 6, text: ' + k' },
            ],
            virtualKinds: ['add', 'shiftVar'],
        }),
        MAC
    );
    assert.equal(title(c), 'f2: sin(x[ - h])[ + k]');
    assert.equal(c.detail, 'Drag to move · Shift-drag to stretch');
    assert.equal(c.note, 'Adds a shift and an offset');

    const clause = target({ subject: 'R1 (2)', kind: 'clause', straight: true, shift: 'turn' });
    text = 'x + 3y <= 6';
    c = hoverChip(info(clause, text, { numSpans: [span(text, '6')] }), MAC);
    assert.equal(title(c), 'R1 (2): x + 3y <= [6]');
    assert.equal(c.detail, 'Drag to move · Shift-drag to turn');

    const curve = target({ subject: 'C1', kind: 'curve', straight: true, shift: 'turn', twinNames: ['P1'] });
    text = '2x + 3y = c';
    c = hoverChip(info(curve, text, { numSpans: [span(text, 'c')], sharedSliders: [{ name: 'c', users: ['Label 1'] }] }), MAC);
    assert.equal(title(c), 'C1: 2x + 3y = [c]');
    assert.equal(c.detail, 'Drag to move · Shift-drag to turn');
    assert.equal(c.note, 'c is also used by Label 1');
    c = hoverChip(info(curve, text, { gesture: 'pivot', numSpans: [span(text, '2'), span(text, 'c')], pivot: { at: { x: 3, y: 1 } }, twins: ['P1'] }), MAC);
    assert.equal(title(c), 'C1: [2]x + 3y = [c]');
    assert.equal(c.detail, 'Shift-drag turns around ⊕ (3, 1)');
    assert.equal(c.note, "Also changes P1's objective (same text)");

    const level = target({ subject: 'C1 level 3.2', kind: 'level', shift: 'resize', closed: true });
    text = '1, 3.2, 6';
    c = hoverChip(info(level, text, { numSpans: [span(text, '3.2')] }), MAC);
    assert.equal(title(c), 'C1 level 3.2: 1, [3.2], 6');
    assert.equal(c.detail, 'Drag to change this level · Shift-drag to reshape all levels');

    const pt = target({ subject: 'P1 point 2', kind: 'point', shift: 'straight', points: [{ x: 3, y: 2 }] });
    text = '(1, 1); (3, 2)';
    c = hoverChip(info(pt, text, { numSpans: [span(text, '3'), span(text, '2')] }), MAC);
    assert.equal(title(c), 'P1 point 2: (1, 1); ([3], [2])');
    assert.equal(c.detail, 'Drag to move · Shift-drag moves straight');

    const slide = target({ subject: 'P2 point 1', kind: 'point', shift: 'straight' });
    text = '(a, 2a)';
    c = hoverChip(info(slide, text, { numSpans: [span(text, 'a'), span(text, '2a')], restricted: 'line' }), MAC);
    assert.equal(title(c), 'P2 point 1: ([a], [2a])');
    assert.equal(c.detail, 'Drag to slide it along its path');

    const tan = target({ subject: 'f1 tangent', kind: 'tangent' });
    c = hoverChip(info(tan, 'a', { numSpans: [[0, 1]] }), MAC);
    assert.equal(title(c), 'f1 tangent: [a]');
    assert.equal(c.detail, 'Drag along the curve');

    const leg = target({ subject: 'S1', kind: 'path', shift: 'turn', points: [{ x: 0, y: 0 }, { x: 3, y: 2 }] });
    text = '(0, 0); (3, 2)';
    c = hoverChip(info(leg, text, { numSpans: [span(text, '0'), span(text, '0', 1), span(text, '3'), span(text, '2')] }), MAC);
    assert.equal(title(c), 'S1: ([0], [0]); ([3], [2])');
    assert.equal(c.detail, 'Drag to move · Shift-drag to turn around the other end');

    const label = target({ subject: 'Label 2', kind: 'label', shift: 'straight' });
    text = 'P1_x, 3';
    c = hoverChip(info(label, text, { ghosts: [{ at: 4, text: ' + k' }], virtualKinds: ['add'] }), MAC);
    assert.equal(title(c), 'Label 2: P1_x[ + k], 3');
    assert.equal(c.detail, 'Drag to move');
    assert.equal(c.note, 'Adds an offset');
});

test('hover chips: restricted moves, closed curves, notes', () => {
    const graph = target({ shift: 'stretch' });
    assert.equal(hoverChip(info(graph, 'x^2 + c', { restricted: 'vertical' }), MAC).detail, 'Drag to move up and down · Shift-drag to stretch');
    assert.equal(hoverChip(info(graph, 'x^2 + c', { restricted: 'horizontal' }), MAC).detail, 'Drag to move sideways · Shift-drag to stretch');
    const pt = target({ kind: 'point', shift: 'straight' });
    assert.equal(hoverChip(info(pt, '(a, 2)', { restricted: 'horizontal' }), MAC).detail, 'Drag to move sideways');
    assert.equal(hoverChip(info(pt, '(1, a)', { restricted: 'vertical' }), MAC).detail, 'Drag to move up and down');
    const closed = target({ subject: 'C1', kind: 'curve', closed: true, shift: 'resize' });
    assert.equal(hoverChip(info(closed, 'x^2 + y^2 = 4'), MAC).detail, 'Drag to move · Shift-drag to resize');
    assert.equal(hoverChip(info(closed, 'x^2 + y^2 = 4', { gesture: 'pivot', pivot: { at: { x: 3, y: 2 } } }), MAC).detail, 'Shift-drag resizes around ⊕ (3, 2)');
    assert.equal(hoverChip(info(graph, 'sin(x)', { gesture: 'pivot', pivot: { at: { x: 0, y: 0 } } }), MAC).detail, 'Shift-drag stretches from ⊕ (0, 0)');

    // Notes: insertions, shared sliders (3 names, then 'and N more'), twins, passed locks; joined by '. '.
    const n1 = hoverChip(info(graph, 'x', { virtualKinds: ['scaleVar', 'factor'] }), MAC).note;
    assert.equal(n1, 'Adds a factor and a scale');
    const n2 = hoverChip(info(graph, 'x', { virtualKinds: ['add', 'factor', 'shiftVar'] }), MAC).note;
    assert.equal(n2, 'Adds a shift, an offset and a factor');
    const n3 = hoverChip(info(graph, 'c', { sharedSliders: [{ name: 'c', users: ['R1', 'Label 1'] }] }), MAC).note;
    assert.equal(n3, 'c is also used by R1 and Label 1');
    const n4 = hoverChip(info(graph, 'c', { sharedSliders: [{ name: 'c', users: ['R1', 'R2', 'C1', 'P1', 'Label 1'] }] }), MAC).note;
    assert.equal(n4, 'c is also used by R1, R2, C1 and 2 more');
    const passed = { source: 'P1' } as HitShape;
    const curve = target({ subject: 'C1', kind: 'curve', straight: true, shift: 'turn' });
    assert.equal(hoverChip(info(curve, '2x + 3y = c', { passed }), MAC).note, 'P1 is computed: dragging here moves C1');
    assert.equal(
        hoverChip(info(curve, '2x + 3y = c', { virtualKinds: ['add'], twins: ['P1'] }), MAC).note,
        "Adds an offset. Also changes P1's objective (same text)"
    );
});

test('chip text longer than 48 characters is cut around the first highlight', () => {
    const t = target({ subject: 'R1 (1)', kind: 'clause', straight: true, shift: 'turn' });
    const text = 'x + y + 0.25 * sin(x) + 0.125 * cos(y) + 0.0625 * x * y <= 12';
    const c = hoverChip(info(t, text, { numSpans: [[text.length - 2, text.length]] }), MAC);
    const body = c.title.slice(1);
    const s = body.map((p) => p.text).join('');
    assert.ok(s.startsWith('…'), s);
    assert.ok(!s.endsWith('…'), s);
    assert.equal(s.length, 49);
    assert.ok(body.some((p) => p.kind === 'num' && p.text === '12'));
    const mid = 'a'.repeat(30) + ' 7 ' + 'b'.repeat(40);
    const c2 = hoverChip(info(t, mid, { numSpans: [span(mid, '7')] }), MAC);
    const s2 = c2.title.slice(1).map((p) => p.text).join('');
    assert.ok(s2.startsWith('…') && s2.endsWith('…'), s2);
    assert.ok(c2.title.some((p) => p.kind === 'num' && p.text === '7'));
    const short = hoverChip(info(t, 'x <= 4', { numSpans: [[5, 6]] }), MAC);
    assert.equal(title(short), 'R1 (1): x <= [4]');
});

// ------------------------------------------------------------------- live

test('live chips: written numbers, sliders and every status', () => {
    const clause = target({ subject: 'R1 (2)', kind: 'clause', straight: true, shift: 'turn' });
    const c = liveChip(clause, [{ text: 'x + 3y <= 6.6', changed: [[10, 13]] }], [], { kind: 'none' });
    assert.equal(title(c), 'R1 (2): x + 3y <= [6.6]');
    assert.equal(c.title.find((p) => p.text === '6.6')?.kind, 'changed');
    assert.equal(c.detail, '');
    const c1 = target({ subject: 'C1', kind: 'curve', straight: true, shift: 'turn' });
    const s = liveChip(c1, [{ text: '2x + 3y = c', changed: [] }], [{ name: 'c', value: 9 + 0.1 * 14 }], { kind: 'none' });
    assert.equal(title(s), 'C1: 2x + 3y = c   [c = 10.4]');
    const at = { x: 3, y: 1 };
    const statuses: Array<[Parameters<typeof liveChip>[3], string]> = [
        [{ kind: 'vertical' }, 'only up and down'],
        [{ kind: 'horizontal' }, 'only sideways'],
        [{ kind: 'snapMarker', label: 'P2' }, 'snapped to P2'],
        [{ kind: 'origin' }, 'snapped to the origin'],
        [{ kind: 'throughMarker', label: 'P1' }, 'through P1'],
        [{ kind: 'grid' }, 'on the grid'],
        [{ kind: 'slope', label: '-2/3' }, 'slope -2/3'],
        [{ kind: 'slope', label: 'horizontal' }, 'horizontal'],
        [{ kind: 'slope', label: 'vertical' }, 'vertical'],
        [{ kind: 'turning', pivot: at }, 'turning around ⊕ (3, 1)'],
        [{ kind: 'stretching', pivot: { x: 0, y: 0 } }, 'stretching from ⊕ (0, 0)'],
        [{ kind: 'resizing', pivot: { x: 3, y: 2 } }, 'resizing around ⊕ (3, 2)'],
        [{ kind: 'clampMax', label: 'c', bound: 15 }, 'c is at its maximum (15)'],
        [{ kind: 'clampMin', label: 'a', bound: 0.5 }, 'a is at its minimum (0.5)'],
        [{ kind: 'stuck' }, 'cannot follow further'],
        [{ kind: 'flip' }, 'R1 (2) cannot turn further this way'],
        [{ kind: 'vertical89' }, 'a function cannot turn vertical: use a curve like x = 2'],
        [{ kind: 'mirrored' }, 'mirrored'],
    ];
    for (const [st, want] of statuses) assert.equal(liveChip(clause, [{ text: 'x', changed: [] }], [], st).detail, want);
    // Labels: x and y joined.
    const label = target({ subject: 'Label 2', kind: 'label' });
    assert.equal(title(liveChip(label, [{ text: 'P1_x + 0.4', changed: [[4, 10]] }, { text: '3', changed: [] }], [], { kind: 'none' })), 'Label 2: P1_x[ + 0.4], 3');
});

test('tip chip, constants, announcements, undo bar texts', () => {
    const mac = tipChip(MAC);
    assert.equal(title(mac), 'Tip: drag lines and curves to change their numbers');
    assert.equal(mac.detail, 'Shift-drag turns or stretches. Cmd+Z undoes.');
    assert.equal(mac.tone, 'tip');
    assert.equal(tipChip(PC).detail, 'Shift-drag turns or stretches. Ctrl+Z undoes.');
    assert.ok(CORE_RULE.startsWith('Drag a line, curve, point or label'));
    assert.ok(CHART_LABEL.startsWith('Chart preview. Drag lines, curves, points and labels'));
    const clause = target({ subject: 'R1 (2)', kind: 'clause' });
    assert.equal(
        selectAnnouncement(clause, 'x + 3y <= 6'),
        'R1 (2) selected: x + 3y <= 6. Arrow keys move it, Enter edits the text, Escape clears the selection.'
    );
    assert.equal(dragAnnouncement(clause, 'x + 3y <= 6.6'), 'R1 (2): x + 3y <= 6.6');
    assert.equal(staleText(['R1 (2)'], false), 'Nothing undone: R1 (2) was edited since');
    assert.equal(staleText(['R1 (2)'], true), 'Undone, except R1 (2), which was edited since');
    assert.equal(staleText([], true), null);
    assert.equal(madeSliderText('b', 6.6), 'Made slider b from 6.6');
    assert.equal(pointText({ x: 3, y: 1 }), '(3, 1)');
    assert.equal(pointText({ x: 1.5, y: -1.25 }), '(1.5, -1.25)');
    assert.equal(pointText({ x: 1 / 3, y: 2.0004 }), '(0.333, 2)');
    assert.equal(joinNames(['A']), 'A');
    assert.equal(joinNames(['A', 'B', 'C']), 'A, B and C');
});

test('undo labels', () => {
    const graph = target({ subject: 'f1', straight: true, shift: 'turn' });
    assert.equal(undoLabel(graph, 'move', false), 'Moved f1');
    assert.equal(undoLabel(graph, 'pivot', false), 'Turned f1');
    assert.equal(undoLabel(target({ subject: 'f1', shift: 'stretch' }), 'pivot', false), 'Stretched f1');
    assert.equal(undoLabel(target({ subject: 'C1', kind: 'curve', closed: true, shift: 'resize' }), 'pivot', false), 'Resized C1');
    const clause = target({ subject: 'R1 (2)', kind: 'clause', shift: 'turn' });
    assert.equal(undoLabel(clause, 'move', false), 'Moved R1 (2)');
    assert.equal(undoLabel(clause, 'pivot', false), 'Turned R1 (2)');
    const level = target({
        subject: 'C1 level 3.2',
        kind: 'level',
        cardSource: 'C1',
        shift: 'resize',
        units: [
            { ref: { kind: 'tool', id: 't0', field: 'equation' }, role: 'equation' },
            { ref: { kind: 'tool', id: 't0', field: 'levels' }, role: 'levelItem', item: 1 },
        ],
    });
    assert.equal(undoLabel(level, 'move', false), 'Changed C1 level 2');
    assert.equal(undoLabel(level, 'pivot', false), 'Resized C1');
    assert.equal(undoLabel(target({ subject: 'P1 point 2', kind: 'point', shift: 'straight' }), 'pivot', false), 'Moved P1 point 2');
    const seg = target({ subject: 'S1', kind: 'path', shift: 'turn' });
    assert.equal(undoLabel(seg, 'move', false), 'Moved S1');
    assert.equal(undoLabel(seg, 'pivot', false), 'Turned S1');
    assert.equal(undoLabel(target({ subject: 'S1 point 2', kind: 'vertex', shift: 'straight' }), 'move', false), 'Moved S1 point 2');
    assert.equal(undoLabel(target({ subject: 'Label 2', kind: 'label', shift: 'straight' }), 'move', false), 'Moved Label 2');
    assert.equal(undoLabel(target({ subject: 'f1 tangent', kind: 'tangent' }), 'move', false), 'Moved f1 tangent');
    const twin = target({ subject: 'C1', kind: 'curve', straight: true, shift: 'turn', twinNames: ['P1'] });
    assert.equal(undoLabel(twin, 'pivot', true), "Turned C1 and P1's objective");
});

// -------------------------------------------------------- examples, e2e

function example(id: string) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) throw new Error(`no example ${id}`);
    return makeChart(JSON.parse(JSON.stringify(ex.data)) as Record<string, unknown>);
}

function hoverOf(
    chart: ReturnType<typeof example>,
    key: string,
    at: { x: number; y: number },
    gesture: 'move' | 'pivot',
    keys: { mod: 'Cmd' | 'Ctrl'; alt: 'Option' | 'Alt' } = MAC
): Chip {
    const ctx = chart.ctx;
    const t = resolveTarget(hitByKey(ctx, key, at), ctx);
    const p = prepareDrag(t, at, gesture, ctx);
    if ('lock' in p) return lockChip(p.lock);
    return hoverChip(p.info, keys);
}

test('examples: LP hover chips (constraint 2, C1, optimum)', () => {
    const lp = example('lp');
    const c2 = hoverOf(lp, 't0#clause:1:0:0', { x: 1.5, y: 1.5 }, 'move');
    assert.equal(title(c2), 'R1 (2): x + 3y <= [6]');
    assert.equal(c2.detail, 'Drag to move · Shift-drag to turn');
    const c2s = hoverOf(lp, 't0#clause:1:0:0', { x: 1.5, y: 1.5 }, 'pivot');
    assert.ok(/^Shift-drag turns around ⊕ \((3, 1|0, 2)\)$/.test(c2s.detail), c2s.detail);
    const c1 = hoverOf(lp, 't1#level:0', { x: 1.5, y: 2 }, 'move');
    assert.equal(title(c1), 'C1: 2x + 3y = [c]');
    assert.equal(c1.detail, 'Drag to move · Shift-drag to turn');
    const c1s = hoverOf(lp, 't1#level:0', { x: 1.5, y: 2 }, 'pivot');
    assert.equal(title(c1s), 'C1: [2]x + 3y = [c]');
    assert.equal(c1s.detail, 'Shift-drag turns around ⊕ (3, 1)');
    assert.equal(c1s.note, "Also changes P1's objective (same text)");
    // The optimum marker alone is locked.
    const p1 = resolveTarget(hitByKey(lp.ctx, 't3#point:0'), lp.ctx);
    assert.ok(p1.lock);
    assert.equal(p1.lock?.title, 'P1 is computed: the max of 2x + 3y over R1');
    assert.equal(p1.lock?.detail, "Drag R1's lines or C1 instead");
    const p2 = resolveTarget(hitByKey(lp.ctx, 't2#point:0'), lp.ctx);
    assert.equal(p2.lock?.title, 'P2 is computed: the corners of R1');
    // Same chips with the non-Mac key names (no key name appears in hover chips).
    assert.equal(title(hoverOf(lp, 't0#clause:1:0:0', { x: 1.5, y: 1.5 }, 'move', PC)), 'R1 (2): x + 3y <= [6]');
});

test('examples: areas, tangent, levels and surplus hover chips', () => {
    const areas = example('areas');
    const f1 = hoverOf(areas, 'fn:f1#curve', { x: Math.PI / 2, y: 1 }, 'move');
    assert.equal(title(f1), 'f1: sin(x[ - h])[ + k]');
    assert.equal(f1.detail, 'Drag to move · Shift-drag to stretch');
    assert.equal(f1.note, 'Adds a shift and an offset');
    const inter = hitAt(areas.ctx, { x: Math.PI / 4, y: Math.SQRT1_2 });
    const it = resolveTarget(inter, areas.ctx);
    // The intersection marker lies on f1 and f2: the pick passes through it to a curve.
    assert.ok(!it.lock, 'a curve under the locked marker');
    assert.ok(it.passed && it.passed.source === 'P1');

    const tangent = example('tangent');
    const tan = hoverOf(tangent, '0#tangent', { x: 0.5, y: 0.125 - 1.5 }, 'move');
    assert.equal(title(tan), 'f1 tangent: [a]');
    assert.equal(tan.detail, 'Drag along the curve');

    const levels = example('levels');
    const lv = hoverOf(levels, 't0#level:1', { x: Math.sqrt(3.2), y: 0 }, 'move');
    assert.equal(title(lv), 'C1 level 3.2: 1, [3.2], 6');
    assert.equal(lv.detail, 'Drag to change this level · Shift-drag to reshape all levels');
    const c2 = hoverOf(levels, 't3#level:0', { x: 1.2, y: 1.2 }, 'move');
    assert.equal(title(c2), "C2's level is P1_val");
    assert.equal(c2.detail, 'P1 computes it. Shift-drag reshapes the curve');

    const surplus = example('surplus');
    const demand = hoverOf(surplus, 'fn:f1#curve', { x: 2, y: 8 }, 'move');
    assert.equal(title(demand), 'f1: [10] - a*x');
    const demandS = hoverOf(surplus, 'fn:f1#curve', { x: 2, y: 8 }, 'pivot');
    assert.equal(demandS.detail, 'Shift-drag turns around ⊕ (4, 6)');
    assert.equal(title(demandS), 'f1: [10] - [a]*x');
    const cs = resolveTarget(hitByKey(surplus.ctx, 't1#clause:0:0:0'), surplus.ctx);
    assert.equal(cs.lock?.title, 'This edge of R1 follows P1_y');
    assert.equal(cs.lock?.detail, 'P1 computes it');
});
