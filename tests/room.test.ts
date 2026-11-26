/*
 * The room around the 2D plot while a hand moves the view (6.2.2,
 * src/room.ts): a pan, a wheel zoom or an arrow key holds the room of the
 * frame before it, so the plot keeps its size and place whatever numbers
 * come in at its edges; when the hand lets go the held room stays while the
 * chart's own room fits in it, else it eases there. The renderer (it needs
 * Obsidian's DOM) is checked in the isolated Obsidian: scripts/media/smoke.mjs
 * pans a chart in 20 steps and turns the wheel 8 notches.
 */
import { test, assert, near } from './_lib';
import { ROOM_EASE_MS, Room, RoomHold, easeRoom, roomFits, roomKey, sameRoom, usableRoom } from '../src/room';
import type { RendererConfig } from '../src/types';

const room = (top: number, right: number, bottom: number, left: number): Room => ({ top, right, bottom, left });

/** The renderer config fields roomKey reads, with a view. */
function config(over: Partial<RendererConfig> = {}): RendererConfig {
    return {
        width: 760,
        height: 760,
        xmin: -0.5,
        xmax: 10,
        ymin: -0.5,
        ymax: 5,
        coordinateSystem: 'cartesian',
        title: '',
        xLabel: '',
        yLabel: '',
        showAxisLabels: true,
        axisStyle: 'middle',
        majorTickNum: 8,
        equalScale: false,
        look: 'clean',
        ...over,
    } as RendererConfig;
}

// ------------------------------------------------------------ the key

test('roomKey: the view is not part of it (the hand moves the view), the rest of the layout is', () => {
    const base = roomKey(config());
    // Panned and zoomed: the same chart.
    assert.equal(roomKey(config({ xmin: 3.2, xmax: 13.7, ymin: -4, ymax: 1.5 })), base);
    assert.equal(roomKey(config({ xmin: 0, xmax: 0.01 })), base);
    // A title's text is not, only whether there is one (its room is one line).
    assert.equal(roomKey(config({ title: 'A' })), roomKey(config({ title: 'f(1) = {f(1)}' })));
    assert.equal(roomKey(config({ title: '   ' })), base);
    // What changes the room of the same view: size, look, axes, names, a title, numbers, equal scale, polar.
    const other: Array<Partial<RendererConfig>> = [
        { width: 700 },
        { height: 500 },
        { paperWidthCm: 12 },
        { look: 'classic' },
        { axes: { line: 'thick', arrows: true, names: 'always', numbers: 'large' } },
        { axisStyle: 'box' },
        { showAxis: false },
        { showAxisLabels: false },
        { xLabel: 't' },
        { yLabel: 'v(t)' },
        { title: 'Speed' },
        { numbers: { x: { mode: 'off', step: '', at: '' }, y: { mode: 'auto', step: '', at: '' } } } as Partial<RendererConfig>,
        { majorTickNum: 12 },
        { equalScale: true },
        { coordinateSystem: 'polar' },
    ];
    for (const o of other) assert.notEqual(roomKey(config(o)), base, JSON.stringify(o));
});

// ------------------------------------------------------------ rooms

test('usableRoom: finite, not negative, and leaving a plot on the canvas', () => {
    assert.ok(usableRoom(room(10, 12, 20, 30), 760, 480));
    assert.ok(!usableRoom(null, 760, 480));
    assert.ok(!usableRoom(undefined, 760, 480));
    assert.ok(!usableRoom(room(NaN, 12, 20, 30), 760, 480));
    assert.ok(!usableRoom(room(10, -1, 20, 30), 760, 480));
    assert.ok(!usableRoom(room(10, 400, 20, 400), 760, 480), 'no width left');
    assert.ok(!usableRoom(room(240, 12, 240, 30), 760, 480), 'no height left');
});

test('roomFits and sameRoom: every side, with half a unit of slack', () => {
    const held = room(10, 12, 20, 30);
    assert.ok(roomFits(room(10, 12, 20, 30), held));
    assert.ok(roomFits(room(4, 6, 20.4, 18), held), 'less room, or a hair more, fits');
    assert.ok(!roomFits(room(10, 12.6, 20, 30), held), 'one side needs more');
    assert.ok(!roomFits(room(10, 12, 20, 44), held));
    assert.ok(sameRoom(room(10.3, 12, 19.6, 30), held));
    assert.ok(!sameRoom(room(9, 12, 20, 30), held));
});

test('easeRoom: from a to b, every side, fast first and gentle at the end', () => {
    const a = room(10, 12, 20, 30);
    const b = room(10, 4, 36, 44);
    assert.deepEqual(easeRoom(a, b, 0), a);
    assert.deepEqual(easeRoom(a, b, 1), b);
    assert.deepEqual(easeRoom(a, b, 2), b, 'clamped');
    let last = a.left;
    for (let k = 0.1; k <= 1; k += 0.1) {
        const r = easeRoom(a, b, k);
        assert.ok(r.left >= last - 1e-9, 'it never turns back');
        assert.equal(r.top, 10, 'a side that does not change stays');
        last = r.left;
    }
    // Ease out: past the middle at half the time.
    assert.ok(easeRoom(a, b, 0.5).left > (a.left + b.left) / 2);
});

// ------------------------------------------------------------ the hold

/** 6.2.1's room of the clean look at the frames of a pan (left: half the first x number, right: half the last; numbers come and go at the edges). */
const PAN_ROOMS = [room(14.6, 14.5, 14.6, 21.3), room(14.6, 9.7, 14.6, 13.1), room(14.6, 9.7, 14.6, 10.6), room(14.6, 9.7, 14.6, 15.8), room(14.6, 14.5, 14.6, 15.8)];
const KEY = roomKey(config());

test('RoomHold: every frame of a pan gets the room of the frame before it, whatever numbers reach the edges', () => {
    const hold = new RoomHold();
    const before = PAN_ROOMS[0];
    hold.grab(before, KEY, '-0.5,10,-0.5,5');
    for (let i = 1; i < PAN_ROOMS.length; i++) {
        const range = `${-0.5 - 0.3 * i},${10 - 0.3 * i},-0.5,5`;
        hold.moved(range);
        // The chart's own room of this frame (PAN_ROOMS[i]) does not matter while the hand moves.
        assert.deepEqual(hold.roomFor(KEY, range), before, `frame ${i}`);
    }
    assert.ok(hold.holding());
});

test('RoomHold: letting go keeps the held room while the chart\'s own fits in it (nothing moves on release)', () => {
    const hold = new RoomHold();
    hold.grab(PAN_ROOMS[0], KEY, 'a');
    hold.moved('b');
    // Its own room at the end has less on every side: the held room stays.
    assert.equal(hold.release(PAN_ROOMS[2]), false);
    assert.ok(hold.holding() && !hold.easing());
    assert.deepEqual(hold.roomFor(KEY, 'b'), PAN_ROOMS[0]);
    // A second release (the next full frame) keeps it too.
    assert.equal(hold.release(PAN_ROOMS[2]), false);
    assert.deepEqual(hold.roomFor(KEY, 'b'), PAN_ROOMS[0]);
});

test('RoomHold: letting go with the chart\'s own room the same as the held one leaves nothing held', () => {
    const hold = new RoomHold();
    hold.grab(PAN_ROOMS[0], KEY, 'a');
    assert.equal(hold.release(room(14.6, 14.5, 14.6, 21.5)), false);
    assert.ok(!hold.holding());
    assert.equal(hold.roomFor(KEY, 'a'), null);
});

test('RoomHold: when the chart needs more room, it eases there in ROOM_EASE_MS, one step per frame', () => {
    const hold = new RoomHold();
    const held = room(14.6, 15.8, 14.6, 21.3);
    // The x-axis came to the bottom edge: its numbers need room below.
    const own = room(14.6, 15.8, 33.3, 10.8);
    hold.grab(held, KEY, 'a');
    assert.equal(hold.release(own), true);
    assert.ok(hold.easing() && hold.pending() && hold.pending(1000));
    // The first frame starts the clock: still the held room.
    assert.deepEqual(hold.step(1000), held);
    assert.ok(!hold.pending(1000), 'the frame of this time is drawn');
    assert.ok(hold.pending(1016.7), 'the next one is not');
    assert.deepEqual(hold.roomFor(KEY, 'a'), held);
    let last = held.bottom;
    for (let t = 1000 + 1000 / 60; t < 1000 + ROOM_EASE_MS; t += 1000 / 60) {
        const r = hold.step(t);
        assert.ok(r, `a room at ${t}`);
        assert.ok(r.bottom > last && r.bottom < own.bottom, 'the bottom grows towards the chart\'s own');
        assert.deepEqual(hold.roomFor(KEY, 'a'), r, 'frames in between draw the eased room');
        last = r.bottom;
    }
    assert.equal(hold.step(1000 + ROOM_EASE_MS), null, 'over: the chart\'s own room from now on');
    assert.ok(!hold.holding() && !hold.easing() && !hold.pending());
    assert.equal(hold.roomFor(KEY, 'a'), null);
});

test('RoomHold: a new gesture during the ease holds the room it reached', () => {
    const hold = new RoomHold();
    hold.grab(room(10, 10, 10, 10), KEY, 'a');
    assert.ok(hold.release(room(10, 10, 30, 10)));
    hold.step(0);
    const mid = hold.step(80);
    assert.ok(mid && mid.bottom > 10 && mid.bottom < 30);
    hold.grab(mid, KEY, 'a');
    assert.ok(!hold.easing());
    assert.deepEqual(hold.roomFor(KEY, 'a'), mid);
});

test('RoomHold: with less motion asked for, a room that does not fit gives way at once', () => {
    const hold = new RoomHold();
    hold.grab(room(10, 10, 10, 10), KEY, 'a');
    assert.equal(hold.release(room(10, 10, 30, 10), true), false);
    assert.ok(!hold.holding());
});

test('RoomHold: another range (typed, Reset, Fit, Undo) or another chart drops the hold', () => {
    const hold = new RoomHold();
    hold.grab(PAN_ROOMS[0], KEY, 'a');
    hold.release(PAN_ROOMS[2]);
    assert.equal(hold.roomFor(KEY, 'typed'), null);
    assert.ok(!hold.holding(), 'dropped, not only skipped');
    hold.grab(PAN_ROOMS[0], KEY, 'a');
    assert.equal(hold.roomFor(roomKey(config({ title: 'Speed' })), 'a'), null);
    assert.ok(!hold.holding());
    // No frame drawn yet: nothing to hold.
    hold.grab(null, KEY, 'a');
    assert.ok(!hold.holding());
    hold.grab(PAN_ROOMS[0], null, 'a');
    assert.ok(!hold.holding());
});

test('RoomHold: the held room is a copy (a renderer cannot change it)', () => {
    const hold = new RoomHold();
    const r = room(10, 10, 10, 10);
    hold.grab(r, KEY, 'a');
    r.left = 99;
    const got = hold.roomFor(KEY, 'a');
    assert.ok(got);
    near(got.left, 10);
    got.top = 50;
    near((hold.roomFor(KEY, 'a') as Room).top, 10);
});
