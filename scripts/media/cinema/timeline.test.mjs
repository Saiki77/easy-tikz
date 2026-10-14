/* eslint-env node */
// node scripts/media/cinema/timeline.test.mjs
// The parts of the cinema pipeline that are pure functions: the stage layout, the camera, the clock of a
// film (timeline.mjs) and the edit (edit.mjs). Nothing is started. Exits with code 1 on a failure.
import assert from 'node:assert/strict';
import { CAPTION_MIN, END_MIN, inspectFilm, makeFilm, reviewMoments, richText, settledAt } from './edit.mjs';
import { TIMING, WIDE, cameraAt, easeInOutCubic, figureOnScreen, frameAt, minJerk, mixCamera, pathLength, pointAlong, sampleAt, smoothPath, solveCamera, splitMath, stageLayout, stateAt, tickTime, toScreen, toWorld, wordCount } from './timeline.mjs';

const VIEW = { width: 1728, height: 1117, dpr: 2 };
/** The editor's modal in the fullscreen window, moved inwards onto whole pixels of the capture (d.figure('editor')). */
const EDITOR = { rect: { x: 144, y: 78.5, width: 1440, height: 960 }, radius: 24.5 };
const L = stageLayout({ width: 1920, height: 1080, view: VIEW, figure: EDITOR });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- layout: the brand's unit, a figure whose edges lie on grid lines, a capture that is never enlarged.
assert.equal(L.u, 29, 'the 1920 px stage has the brand\'s unit of 29 px');
assert.deepEqual(L.fig, { x: 9 * 29, y: 3 * 29, width: 48 * 29, height: 32 * 29 }, 'the editor is a figure of 48 x 32 units: all four edges on grid lines');
assert.equal((L.fig.x - L.marginX) % L.u, 0, 'the grid is counted from the margin rule: the figure\'s left edge is on one of its lines');
assert.ok(L.fig.width / L.width > 0.7, 'in the wide shot the editor takes more than 70 % of the frame\'s width');
assert.ok(near(L.maxZ * L.w0, VIEW.dpr), 'at the closest zoom one pixel of the capture is one pixel of the output');
assert.ok(L.safeBottom === L.bandTop && L.bandTop < L.bandSolid && L.bandSolid < L.chipBaseline && L.chipBaseline < L.captionBaseline && L.captionBaseline < L.height);
assert.ok(L.height - L.bandTop > 180 && L.height - L.bandTop < 200, 'the caption band is about 190 px high');
assert.deepEqual(toWorld(L, { x: 144, y: 78.5 }), { x: L.fig.x, y: L.fig.y }, 'the corner of the crop is the corner of the figure');
{
    // Without a figure the whole window lies on the page: as large as 54 x 32 units allow, left and top edge on grid lines.
    const whole = stageLayout({ width: 1920, height: 1080, view: VIEW });
    assert.deepEqual(whole.crop, { x: 0, y: 0, width: 1728, height: 1117 });
    assert.ok(whole.fig.height <= 32 * 29 && whole.fig.width <= 54 * 29 && whole.fig.x % 29 === 0 && whole.fig.y === 87);
    assert.ok(Math.abs(whole.fig.x + whole.fig.width / 2 - 33 * 29) <= 29 / 2, 'centred on grid line 33');
}

// ---- the camera
assert.deepEqual(solveCamera(L, null), WIDE, 'no focus: the wide shot');
const focus = { x: 800, y: 320, width: 700, height: 450 };
const cam = solveCamera(L, focus, { pad: 30 });
assert.ok(cam.z > 1.3 && cam.z <= L.maxZ, `a focus of 700 x 450 px is framed at ${cam.z.toFixed(2)}x`);
{
    const a = toScreen(cam, toWorld(L, { x: focus.x, y: focus.y }));
    const b = toScreen(cam, toWorld(L, { x: focus.x + focus.width, y: focus.y + focus.height }));
    assert.ok(a.x >= 29 && a.y >= 29 && b.x <= 1920 - 29 && b.y <= L.safeBottom - 29, 'the focus lies above the caption band, with its padding');
    const corner = figureOnScreen(L, cam);
    assert.ok(near(corner.x, Math.round(corner.x), 1e-9) && near(corner.y, Math.round(corner.y), 1e-9), 'the figure\'s corner lies on a whole pixel: nothing is resampled between pixels during a hold');
}
assert.equal(solveCamera(L, { x: 900, y: 500, width: 40, height: 30 }).z, L.maxZ, 'a tiny focus stops at 100 % of the capture');
assert.ok(solveCamera(L, focus, { zoom: 9 }).z <= L.maxZ, 'a zoom that is asked for is capped as well');
{
    // A centred focus in a corner of the figure: the camera stays on the figure, no sliver of paper beside it.
    const corner = solveCamera(L, { x: 150, y: 80, width: 500, height: 300 });
    const f = figureOnScreen(L, corner);
    assert.ok(f.x <= 0.5 && f.y <= 0.5, 'left and top edge of the frame are on the figure');
    const low = figureOnScreen(L, solveCamera(L, { x: 1150, y: 820, width: 428, height: 217 }));
    assert.ok(low.x + low.width >= 1919.5, 'the right edge of the frame is on the figure');
    assert.ok(low.y + low.height >= L.safeBottom - 0.5, 'the figure reaches down to the caption band');
}
{
    // The editor from edge to edge: the figure is exactly as wide as the frame.
    const across = figureOnScreen(L, solveCamera(L, { x: 144, y: 895.8, width: 1440, height: 93 }, { pad: [0, 0, 0, -12], align: 'bottom' }));
    assert.ok(near(across.x, 0, 0.51) && near(across.width, 1920, 0.01), 'frame edges on the editor\'s edges');
    // align: an edge of the focus on an edge of the frame; the paper beside the figure is then the margin of the shot.
    const pane = { x: 721.2, y: 337, width: 861.8, height: 554 };
    const left = solveCamera(L, pane, { pad: [0, 12, 0, 0], align: 'left' });
    const at = toScreen(left, toWorld(L, pane));
    assert.ok(Math.abs(at.x) <= 0.5, 'align left: the focus begins at the left edge of the frame');
    const fig = figureOnScreen(L, left);
    assert.ok(fig.x + fig.width < 1920 - 300, 'and the paper right of the figure is in the frame: a margin for a note');
    const end = toScreen(left, toWorld(L, { x: pane.x, y: pane.y + pane.height }));
    assert.ok(Math.abs(end.y - L.safeBottom) <= 0.5, 'the focus ends where the caption band begins');
    const right = solveCamera(L, { x: 144, y: 559, width: 575, height: 300 }, { pad: 0, align: 'right top', zoom: 99 });
    assert.equal(right.z, L.maxZ);
    const edge = toScreen(right, toWorld(L, { x: 719, y: 559 }));
    assert.ok(Math.abs(edge.x - 1920) <= 0.5 && Math.abs(edge.y) <= 0.5, 'align right top');
    assert.ok(figureOnScreen(L, right).x > 700, 'the paper left of the figure is the margin');
}

// Between two cameras: a pure zoom about one point of the page.
{
    const a = WIDE;
    const b = cam;
    const fixed = { x: (b.tx - a.tx) / (a.z - b.z), y: (b.ty - a.ty) / (a.z - b.z) };
    const at = toScreen(a, fixed);
    let z = a.z;
    for (let i = 0; i <= 20; i++) {
        const m = mixCamera(a, b, i / 20);
        const p = toScreen(m, fixed);
        assert.ok(near(p.x, at.x, 1e-6) && near(p.y, at.y, 1e-6), 'the fixed point of the zoom does not move');
        assert.ok(m.z >= z - 1e-12, 'the zoom only grows');
        z = m.z;
    }
    assert.deepEqual(mixCamera(a, b, 1), b, 'the move ends exactly on its key');
    const pan = mixCamera({ z: 2, tx: 0, ty: 0 }, { z: 2, tx: -100, ty: 40 }, 0.5);
    assert.deepEqual(pan, { z: 2, tx: -50, ty: 20 }, 'the same zoom: a straight pan');
}

const keys = [{ t: 0, dur: 0, ...WIDE }, { t: 2, dur: 0.8, ...cam }, { t: 6, dur: 0.9, ...WIDE }];
assert.deepEqual(cameraAt(keys, 1.99), { ...WIDE, moving: false });
assert.equal(cameraAt(keys, 2.4).moving, true);
assert.deepEqual(cameraAt(keys, 2.8), { ...cam, moving: false }, 'after the move the camera is its key, to the last digit');
assert.deepEqual(cameraAt(keys, 5.5), { ...cam, moving: false }, 'and stays: no drift while nothing happens');
assert.ok(near(cameraAt(keys, 2.4).z, Math.exp(Math.log(cam.z) * easeInOutCubic(0.5))), 'half way: the geometric middle of the zoom');
{
    // A key that starts before the last move has ended takes over from where the camera is: no jump.
    const cut = [{ t: 0, dur: 0, ...WIDE }, { t: 1, dur: 0.8, ...cam }, { t: 1.4, dur: 0.8, ...WIDE }];
    const before = cameraAt(cut, 1.4);
    const after = cameraAt(cut, 1.4 + 1 / 600);
    assert.ok(Math.abs(after.z - before.z) < 0.01 && Math.abs(after.tx - before.tx) < 2);
}
assert.ok(near(minJerk(0), 0) && near(minJerk(1), 1) && near(minJerk(0.5), 0.5), 'the pointer\'s glide starts and ends at rest');
{
    // A glide with a way (d.move({ via })): the corners are rounded, the ends stay, the way stays in the hull
    // of its points, and it passes a corner no further inside than a quarter of the shorter leg.
    const corner = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }];
    const way = smoothPath(corner, 3);
    assert.deepEqual([way[0], way[way.length - 1]], [corner[0], corner[2]], 'the way begins and ends where it should');
    assert.ok(way.length >= 10 && way.every((p) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100 && p.y >= p.x), 'inside the hull of its corners');
    const closest = Math.min(...way.map((p) => Math.hypot(p.x, p.y - 100)));
    assert.ok(closest > 10 && closest < 25, `the corner is rounded off, not cut wide (${closest.toFixed(1)} px from it)`);
    assert.ok(near(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }]), 11));
    assert.deepEqual(pointAlong([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }], 7), { x: 3, y: 6 });
    assert.deepEqual(pointAlong([{ x: 0, y: 0 }, { x: 3, y: 4 }], 99), { x: 3, y: 4 }, 'clamped to its end');
}

// ---- samples and pictures
const samples = [{ t: 0, x: 0, y: 0 }, { t: 1, x: 0, y: 0 }, { t: 2, x: 100, y: 50 }];
assert.deepEqual(sampleAt(samples, 0.5), { t: 0.5, x: 0, y: 0 }, 'a rest stays a rest');
assert.deepEqual(sampleAt(samples, 1.5), { t: 1.5, x: 50, y: 25 });
assert.equal(sampleAt(samples, 9).x, 100);
const pictures = [{ t: 1, src: 'a' }, { t: 1.5, src: 'b' }, { t: 3, src: 'c' }];
assert.equal(frameAt(pictures, 0).src, 'a', 'before the capture begins: its first picture');
assert.equal(frameAt(pictures, 1.5).src, 'b');
assert.equal(frameAt(pictures, 2.99).src, 'b');
assert.equal(frameAt(pictures, 30).src, 'c');
assert.ok(near(tickTime(1.9 + 5 / 60, 1.9, 30), 1.9 + 2 / 30, 1e-9), 'frame 5 of the body shows tick 2 of the capture');

// ---- text
assert.deepEqual(splitMath('Drag $2x + 3y = c$. Slider $c$ follows.'), [{ text: 'Drag ' }, { math: '2x + 3y = c' }, { text: '. Slider ' }, { math: 'c' }, { text: ' follows.' }]);
assert.equal(wordCount('Drag the line $2x + 3y = c$. Slider $c$ follows.'), 7, 'a formula counts as one word');
{
    const html = richText('Its formula follows: $2.5x + 3y = c$.');
    assert.ok(!html.includes('$'), 'no dollar sign is left');
    assert.ok(html.includes('class="m"') && html.includes('\u{1d465}') && html.includes('2.5'), 'the formula is typeset as math: an italic x, upright numbers');
    assert.ok(richText('a < b & c').includes('&lt;') && richText('a < b & c').includes('&amp;'), 'plain text is escaped');
}

// ---- a film from a small capture
/** Times as an old capture wrote them: four decimals, which is not on the tick for two ticks out of three. */
const coarse = (n) => Math.round((n / 30) * 1e4) / 1e4;
const track = {
    name: 'test',
    fps: 30,
    view: VIEW,
    figure: EDITOR,
    duration: 9,
    // A still picture, then a new one on every tick from 3.5 s to 4.5 s (a drag), then stills.
    frames: [{ t: 0, file: 'raw-00001.png' }, ...Array.from({ length: 31 }, (_, i) => ({ t: coarse(105 + i), file: `raw-${String(i + 2).padStart(5, '0')}.png` })), { t: 6, file: 'raw-00040.png' }],
    pointer: [{ t: 0, x: 1300, y: 400 }, { t: 0.5, x: 1300, y: 400 }, { t: 1.5, x: 1000, y: 600 }, { t: coarse(105), x: 1000, y: 600 }, ...Array.from({ length: 30 }, (_, i) => ({ t: coarse(106 + i), x: 1000 + (100 * (i + 1)) / 30, y: 600 - (100 * (i + 1)) / 30 })), { t: 9, x: 1100, y: 500 }],
    presses: [{ t0: 3.5, t1: 4.6, x: 1000, y: 600 }],
    keys: [{ key: 'Shift', label: 'Shift', side: 'left', offset: [0, 0], t0: 3, t1: 4.6 }],
    beats: [
        { t: 0.5, id: 'one', caption: 'Drag the line $2x + 3y = c$.', focus },
        { t: 4.6, id: 'two', caption: 'Its formula follows.' },
        { t: 7.8, id: 'back', focus: null },
    ],
    callouts: [
        { t0: 2, t1: 3.6, to: { x: 880, y: 939 }, text: '$c: 5 -> 9$', side: 'right', dx: 130, dy: -80, in: null, looseness: null, gap: 12 },
        { t0: 5.5, t1: 7.5, to: { x: 161, y: 698 }, text: '', equations: [['2x + 3y = c', 'a'], ['[[2.5]]x + 3y = c', 'b']], side: 'left', dx: -150, dy: -70, place: [5, 7], bend: 0.05, gap: 12 },
    ],
    cards: { end: { file: 'raw-00040.png', rect: { x: 751, y: 123, width: 801, height: 721 }, label: 'Figure 2.', text: 'After the turn: $2.5x + 3y = c$.' } },
    marks: { poster: 4.2 },
    facts: {},
};
const scene = { name: 'test', title: { secno: '§1', text: 'Drag to edit', lead: 'Drag a line and [[its numbers follow]].', seconds: 1.9 }, end: { seconds: 2.2 } };
const film = makeFilm(track, scene, { rawDir: '/tmp/raw', fps: 60 });
const T = TIMING;
const endAt = 1.9 + 9 + T.windowOut - T.overlap;
assert.ok(near(film.duration, Math.round((endAt + T.endIn + 2.2) * 60) / 60), 'title card, capture, the end card coming in, and the seconds it is held complete');
assert.deepEqual([film.body.t0, film.body.t1], [1.9, 10.9]);
assert.equal(film.camera.length, 3, 'wide, the focus, wide again (the beat without a focus keeps the camera)');
assert.ok(film.camera[1].dur >= 0.6 && film.camera[1].dur <= 0.9, 'a camera move takes 0.6 to 0.9 s');
assert.equal(film.captions.length, 2);
assert.deepEqual([film.captions[0].t0, film.captions[0].t1, film.captions[1].t1].map((t) => Math.round(t * 1e6) / 1e6), [2.4, 6.5, 9.7], 'a caption stays until the next one, and the pull back to the wide shot ends the last (there is no band for it there)');
assert.ok(film.title.leadHtml.includes('<span class="hl">its numbers follow</span>'), 'the one highlighted phrase');
assert.ok(film.frames[0].src.startsWith('file:///'));
assert.deepEqual(film.chip, { secno: '§1', text: 'Drag to edit' }, 'the title stays on screen as the chip over the caption');
assert.equal(film.callouts[1].kind, 'equations');
assert.ok(film.callouts[1].html.includes('eq-align') && film.callouts[1].html.includes('m-em') && film.callouts[1].html.includes('(b)'), 'numbered equations, the changed number in the accent');
assert.ok(film.end.figure.src.endsWith('raw-00040.png') && film.end.figure.captionHtml.startsWith('<b>Figure 2.</b>'), 'the figure of the end card is a picture of the capture with a caption');
assert.equal(film.title.figure, null);
assert.deepEqual(film.report.warnings, [], 'nothing to note');
assert.ok(END_MIN === 2.2 && CAPTION_MIN === 3);
assert.ok(makeFilm(track, { ...scene, end: { seconds: 1.5 } }, { rawDir: '/tmp/raw' }).report.warnings.some((w) => /end card/.test(w)), 'an end card held for less than 2.2 s is noted');
assert.ok(makeFilm({ ...track, beats: [track.beats[0], { ...track.beats[1], t: 6.5 }, track.beats[2]] }, scene, { rawDir: '/tmp/raw' }).report.warnings.some((w) => /to read it twice/.test(w)), 'a caption that is on for less than 3 s is noted');
assert.equal(film.report.beats[0].source <= 1, true);
assert.throws(() => makeFilm({ ...track, callouts: [track.callouts[0], { ...track.callouts[0], t0: 3, t1: 4 }] }, scene, { rawDir: '/tmp/raw' }), /overlap/, 'two callouts at a time are refused');
assert.throws(() => makeFilm({ ...track, beats: [{ t: 0.5, id: 'x', caption: `a ${String.fromCharCode(0x2014)} b` }] }, scene, { rawDir: '/tmp/raw' }), /em dash/);
assert.throws(() => makeFilm({ ...track, beats: [{ t: 0.5, id: 'x', caption: 'In the wide shot.', focus: null }] }, scene, { rawDir: '/tmp/raw' }), /no band/, 'a caption needs the band, and the wide shot has none');

// The cadence: a picture of the capture on every tick of 30 per second lands on 60 frames per second as
// 2, 2, 2, ... frames each (not 2, 3, 1), although the track wrote its times with four decimals.
{
    const at = (i) => stateAt(film, i / 60);
    const first = Math.round((1.9 + 3.5) * 60);
    const runs = [];
    let run = 1;
    for (let i = first + 1; i <= first + 60; i++) {
        if (at(i).frame === at(i - 1).frame) run++;
        else {
            runs.push(run);
            run = 1;
        }
    }
    assert.equal(runs.length, 30);
    assert.deepEqual(runs, new Array(30).fill(2), `every picture of the drag is on for two frames: ${runs.join(' ')}`);
    assert.equal(at(first).frame, film.frames[1].src, 'and the first comes on its own frame, not one late');
    // While the button is down the pointer is where it was when the picture on screen was taken: hand and line stay locked.
    for (let n = 1; n < 30; n++) {
        const a = at(first + 2 * n).pointer;
        const b = at(first + 2 * n + 1).pointer;
        assert.ok(a.held && b.held && a.x === b.x && a.y === b.y, 'the two frames of one picture show the hand in one place');
        assert.ok(at(first + 2 * n + 2).pointer.x !== a.x, 'and it moves with the next picture');
    }
    // A free glide is drawn for every frame of the output.
    const g0 = at(Math.round((1.9 + 1.0) * 60)).pointer;
    const g1 = at(Math.round((1.9 + 1.0) * 60) + 1).pointer;
    assert.ok(!g0.held && (g0.x !== g1.x || g0.y !== g1.y));
    const seen = inspectFilm(film);
    assert.deepEqual(seen.cadence, { 2: 30 }, 'inspectFilm counts the same');
    assert.equal(seen.pointer.offFrame, 0);
    assert.ok(seen.pointer.largestStep < 60, `the pointer never jumps (largest step ${seen.pointer.largestStep} px)`);
    assert.deepEqual(seen.warnings, []);
}

// The poster: a settled frame.
assert.ok(near(film.marks.poster, 6.1), 'a poster marked at a settled moment stays where it is');
{
    // Marked while the ring of the release fades: the poster goes back to the last settled frame, here the one
    // before the caption begins to leave (it goes at 6.5 s, with the key; its fade takes 0.24 s).
    const late = makeFilm({ ...track, marks: { poster: 4.75 } }, scene, { rawDir: '/tmp/raw', fps: 60 });
    assert.ok(near(late.marks.poster, 6.25), `poster moved back to ${late.marks.poster}`);
    const s = stateAt(late, late.marks.poster);
    assert.equal(s.caption.opacity, 1);
    assert.equal(s.pointer.keycap.opacity, 1);
    assert.equal(s.pointer.held, true);
    assert.equal(settledAt(film, 8.5), 8.5);
}

// What is on the stage, moment by moment.
{
    const at = (t) => stateAt(film, t);
    const t0 = film.body.t0;
    const t1 = film.body.t1;
    assert.equal(at(0).title.opacity, 1, 'the first frame is the whole title card');
    assert.equal(at(0).window.opacity, 0);
    assert.equal(at(0).pointer, null);
    assert.equal(at(0).title.highlight, 0);
    assert.equal(at(1.2).title.highlight, 1, 'the highlighter stroke has drawn on');
    // The window slides onto the page from under the frame: opaque all the way, never see-through.
    const travel = L.height - L.fig.y;
    assert.ok(at(t0).window.opacity === 1 && at(t0).window.drop >= travel, 'it begins under the lower edge of the frame');
    assert.ok(at(t0 + 0.1).title.opacity > 0 && at(t0 + 0.1).window.drop < travel, 'the title is still leaving while the window comes: the page is never empty');
    for (let t = t0; t < t1 + T.windowOut - 1e-9; t += 1 / 60) assert.equal(at(t).window.opacity, 1, 'opaque for as long as it is there');
    assert.deepEqual(at(t0 + T.windowIn).window, { opacity: 1, drop: 0, lift: 1 }, 'it has landed, its shadow full grown');
    assert.equal(at(t0 + 0.35).title.opacity, 0);
    assert.ok(at(t0 + 0.2).window.lift > 0 && at(t0 + 0.2).window.lift < 1, 'the shadow grows while it lands');
    assert.ok(at(t0 + 0.2).pointer.y > toScreen(WIDE, toWorld(L, { x: 1300, y: 400 })).y, 'the pointer lies on the window and comes with it');
    // It is taken off the same way, and the end card is on its way before it has gone.
    assert.ok(at(t1 + 0.3).window.drop > 0 && at(t1 + 0.3).end.opacity > 0);
    assert.equal(at(t1 + T.windowOut).window.opacity, 0);
    assert.ok(at(t1 + T.windowOut).end.opacity > 0.5, 'when the window has gone the end card is more than half there: no empty page');
    const last = at(film.duration - 1 / 60);
    assert.deepEqual([last.end.opacity, last.end.dy, last.end.rule, last.end.figure, last.end.figureDy], [1, 0, 1, 1, 0], 'the last frame is the whole end card');
    assert.ok(near(film.duration - (endAt + T.endIn), 2.2, 1 / 60), 'and it has been whole for the seconds the scene asked for');
    assert.ok(at(endAt + T.ruleAt + T.rule / 2).end.rule > 0 && at(endAt + T.ruleAt + T.rule / 2).end.rule < 1, 'its rule draws on');
    assert.equal(last.window.opacity, 0);
    assert.equal(last.pointer, null, 'no pointer on the end card');
    // During a hold with nothing going on, two frames are the same state: the composite pass draws one picture.
    assert.equal(JSON.stringify(at(8.5)), JSON.stringify(at(8.5 + 1 / 60)), 'a hold is one picture');
    assert.equal(JSON.stringify(at(1.5)), JSON.stringify(at(1.5 + 1 / 60)), 'so is the title card once its stroke is drawn');
    // One caption at a time, never without the band under it, and a moment without one between two.
    for (let t = 0; t < film.duration; t += 1 / 60) {
        const s = at(t);
        if (s.caption) assert.ok(s.caption.opacity > 0 && s.caption.opacity <= 1 && s.band >= 0.6);
    }
    assert.equal(at(t0 + 0.5 + 0.1).caption, null, 'the caption waits for the band: the camera has only just set off');
    assert.equal(at(6.5).caption, null, 'between two captions there is a moment without one');
    assert.equal(at(6.5 + T.captionIn).caption.index, 1);
    assert.equal(at(4).chip, 1, 'the chip is on while the camera is in');
    assert.equal(at(t0 + 0.4).chip, 0);
    // The running head belongs to the page: it goes when the figure grows over it.
    assert.equal(at(1).head.main, 1);
    assert.equal(at(4).head.main, 0);
    assert.equal(last.head.end, 1);
    // Pointer: the button, the key, the ring.
    assert.equal(at(5.7).pointer.held, true);
    assert.equal(at(5.7).pointer.keycap.label, 'Shift');
    assert.ok(at(5.42).pointer.ring !== null && at(5.42).pointer.ring < 0.1, 'a ring starts at the press');
    assert.equal(at(4.5).pointer.held, false);
    {
        // The ring stays where the button went down while the hand drags on: it does not read as held.
        const s = at(5.7);
        const pressed = toScreen(cameraAt(film.camera, 5.7), toWorld(L, { x: 1000, y: 600 }));
        assert.ok(s.pointer.ring > 0.5 && s.pointer.ring < 1, 'the ring of the press is still fading');
        assert.ok(near(s.pointer.ringX, pressed.x, 0.006) && near(s.pointer.ringY, pressed.y + s.window.drop, 0.006), 'at the place of the press');
        assert.ok(Math.hypot(s.pointer.x - s.pointer.ringX, s.pointer.y - s.pointer.ringY) > 20, 'while the hand has moved on');
        // The ring of the release is where the hand let go.
        const r = at(6.5 + 0.1).pointer;
        const released = toScreen(cameraAt(film.camera, 6.6), toWorld(L, sampleAt(film.pointer.samples, film.pointer.presses[0].t1)));
        assert.ok(r.ring > 0 && near(r.ringX, released.x, 0.006) && near(r.ringY, released.y, 0.006));
        assert.equal(at(8.5).pointer.ringX, undefined, 'no ring, no place for one');
    }
    // The callout draws on, holds, fades.
    assert.equal(at(3.8).callout, null);
    assert.ok(at(4.1).callout.progress > 0 && at(4.1).callout.progress < 1);
    assert.equal(at(4.9).callout.progress, 1);
    assert.ok(at(5.4).callout.opacity < 1);
    assert.equal(at(8).callout.index, 1);
    // The paper band is there only when the figure has grown past it.
    assert.equal(at(2.2).band, 0);
    assert.equal(at(4).band, 1);
    assert.equal(at(t1).band, 0, 'the camera is back in the wide shot before the window leaves');
}
{
    const moments = reviewMoments(film).map((m) => m.name);
    assert.deepEqual(moments, ['title', 'callout-1', 'drag', 'poster', 'callout-2', 'end']);
}

// A clip has no title card: the film begins with the window in its place, and the running head carries its title.
{
    const clip = makeFilm(track, { ...scene, title: { ...scene.title, card: false } }, { rawDir: '/tmp/raw', fps: 60 });
    assert.equal(clip.body.t0, 0);
    const s = stateAt(clip, 0);
    assert.deepEqual(s.window, { opacity: 1, drop: 0, lift: 1 }, 'the first frame is the editor on the page');
    assert.equal(s.title.opacity, 0);
    assert.deepEqual(clip.head.main, ['§1 Drag to edit', 'Easy TikZ 4'], 'the chip of the wide shot');
    assert.ok(near(clip.duration, film.duration - 1.9, 1 / 60));
}

// ---- a film with a section card between two parts (the overview: the Linear program, then the Tangent explorer)
{
    // Part 1 runs from 0 to 4 s of the track, part 2 from 4 to 9 s. Between them the scene loaded another
    // chart and parked the pointer elsewhere; that took no time of the capture (no picture was taken).
    const drag = (from, first, x0, y0) => Array.from({ length: 30 }, (_, i) => ({ t: coarse(from * 30 + 1 + i), file: `raw-${String(first + i).padStart(5, '0')}.png`, x: x0 + 3 * (i + 1), y: y0 - 2 * (i + 1) }));
    const d1 = drag(1, 2, 1000, 600);
    const d2 = drag(5, 41, 900, 500);
    const sectioned = {
        name: 'overview-test',
        fps: 30,
        view: VIEW,
        figure: EDITOR,
        duration: 9,
        frames: [{ t: 0, file: 'raw-00001.png' }, ...d1.map(({ t, file }) => ({ t, file })), { t: 2.5, file: 'raw-00032.png' }, { t: 4, file: 'raw-00040.png' }, ...d2.map(({ t, file }) => ({ t, file })), { t: 7, file: 'raw-00080.png' }],
        pointer: [
            { t: 0, x: 1300, y: 400 },
            { t: 0.6, x: 1000, y: 600 },
            { t: 1, x: 1000, y: 600 },
            ...d1.map(({ t, x, y }) => ({ t, x, y })),
            { t: coarse(119), x: 1090, y: 540 },
            // The first picture of part 2: the pointer was parked at (900, 500) while the card was up.
            { t: 4, x: 900, y: 500 },
            { t: 5, x: 900, y: 500 },
            ...d2.map(({ t, x, y }) => ({ t, x, y })),
            { t: 9, x: 990, y: 440 },
        ],
        presses: [{ t0: 1, t1: 2.1, x: 1000, y: 600 }, { t0: 5, t1: 6.1, x: 900, y: 500 }],
        keys: [],
        beats: [
            { t: 0.1, id: 'one', caption: 'Drag the line $2x + 3y = c$.', focus },
            { t: 3.1, id: 'back-1', focus: null },
            { t: 4, id: 'two', caption: 'Drag the point. Tangent and area follow.', focus: { x: 721, y: 151, width: 862, height: 665 }, pad: [0, 12, 0, 0], align: 'left' },
            { t: 8.1, id: 'back-2', focus: null },
        ],
        callouts: [
            { t0: 1.2, t1: 2.6, to: { x: 880, y: 939 }, text: '$c: 5 -> 9$', side: 'right', dx: 130, dy: -80, in: null, looseness: null, gap: 12 },
            { t0: 5.5, t1: 7, to: { x: 1160, y: 509 }, text: 'at $a = 0$ the area flips', side: 'right', dx: 150, dy: -70, place: [49, 12], in: null, looseness: null, gap: 12 },
        ],
        cards: {
            title: { file: 'raw-00001.png', rect: { x: 751, y: 123, width: 801, height: 721 }, label: 'Figure 1.', text: 'The Linear program example.' },
            end: { file: 'raw-00080.png', rect: { x: 751, y: 123, width: 801, height: 721 }, label: 'Figure 3.', text: 'At $a = 0.5$.' },
        },
        sections: [{ t: 4, secno: '§2', text: 'Dynamics', lead: 'Move one number and [[everything built on it follows]].', seconds: 2, figure: { file: 'raw-00040.png', rect: { x: 751, y: 123, width: 801, height: 721 }, label: 'Figure 2.', text: 'The Tangent explorer.' } }],
        marks: { poster: 6.5 },
        facts: {},
    };
    const overview = { name: 'overview-test', title: { text: 'Easy TikZ 4', lead: 'TikZ charts from formulas, now [[fully interactive]].', seconds: 2.2 }, chip: { secno: '§1', text: 'Drag to edit' }, end: { seconds: 3 } };
    const f = makeFilm(sectioned, overview, { rawDir: '/tmp/raw', fps: 60 });
    const at = (t) => stateAt(f, t);
    const [p1, p2] = f.parts;
    const r = (v) => Math.round(v * 1e6) / 1e6;
    const cardAt = p1.t1 + T.windowOut - T.overlap;
    assert.equal(f.parts.length, 2, 'two parts');
    assert.deepEqual([p1.t0, r(p1.t1)], [2.2, 6.2], 'part 1: the title card, then 4 s of capture');
    assert.ok(near(p2.t0, Math.round((cardAt + T.endIn + 2) * 60) / 60, 1e-9) && near(p2.t0 * 60, Math.round(p2.t0 * 60), 1e-9), 'part 2 begins once the section card has been held complete for its seconds, on a whole frame');
    assert.ok(near(p2.t1 - p2.t0, 5, 1e-9), 'part 2: 5 s of capture');
    assert.deepEqual([f.body.t0, r(f.body.t1)], [p1.t0, r(p2.t1)]);
    assert.ok(near(f.duration, Math.round((p2.t1 + T.windowOut - T.overlap + T.endIn + 3) * 60) / 60, 1e-9), 'the end card after the last part');
    assert.ok(near(f.sections[0].seconds, 2, 1 / 60) && f.sections[0].leadHtml.includes('<span class="hl">everything built on it follows</span>'));
    assert.ok(f.sections[0].figure.src.endsWith('raw-00040.png') && f.sections[0].figure.captionHtml.startsWith('<b>Figure 2.</b>'), 'the section card shows the first picture of its part');
    assert.deepEqual(f.report.warnings, [], 'nothing to note');

    // What the capture did between the parts is cut: the frame the window brings back is the first of part 2.
    assert.equal(at(p2.t0).frame, f.frames.find((x) => x.src.endsWith('raw-00040.png')).src);
    assert.equal(at(p1.t1 + 0.3).frame, f.frames.find((x) => x.src.endsWith('raw-00032.png')).src, 'the window leaves with the last picture of part 1');
    assert.equal(at(p2.t0 - 1 / 60).frame, at(p1.t1).frame, 'nothing of the set up is filmed');

    // The window leaves as at the end of a film and comes back as at the start; the card stands between.
    const travel = L.height - L.fig.y;
    assert.ok(at(p1.t1 - 0.5).window.opacity === 1 && at(p1.t1 - 0.5).window.drop === 0);
    assert.ok(at(p1.t1 + 0.3).window.drop > 0, 'it slides off');
    assert.equal(at(p1.t1 + T.windowOut).window.opacity, 0);
    assert.ok(at(p2.t0).window.opacity === 1 && at(p2.t0).window.drop >= travel, 'it comes back from under the lower edge');
    assert.deepEqual(at(p2.t0 + T.windowIn).window, { opacity: 1, drop: 0, lift: 1 }, 'and lands');
    assert.equal(at(cardAt - 1 / 60).section, null, 'no card while the window is still there');
    assert.ok(at(p1.t1 + T.windowOut).section.opacity > 0.5, 'when the window has gone the card is more than half there: no empty page');
    const mid = (cardAt + T.endIn + T.figureAt + p2.t0) / 2;
    assert.deepEqual(at(mid).section, { index: 0, opacity: 1, dy: 0, highlight: 1, figure: 1, figureDy: 0 }, 'the complete card: its stroke drawn, its figure in place');
    assert.equal(JSON.stringify(at(mid)), JSON.stringify(at(mid + 1 / 60)), 'held still: one picture');
    assert.ok(at(cardAt + T.endIn + T.highlight / 2).section.highlight > 0 && at(cardAt + T.endIn + T.highlight / 2).section.highlight < 1, 'its highlighter stroke draws on once the text is there');
    assert.ok(at(p2.t0 + 0.05).section.opacity > 0 && at(p2.t0 + 0.05).section.dy < 0, 'it is still leaving, upwards, while the window comes');
    assert.equal(at(p2.t0 + 0.35).section, null);
    for (let t = p1.t1; t < p2.t0 + T.windowIn; t += 1 / 60) {
        const s = at(t);
        assert.ok((s.window.opacity === 1 && s.window.drop < travel) || (s.section && s.section.opacity > 0.5), `the page is never empty (at ${t.toFixed(3)} s)`);
        if (t < p2.t0) assert.ok(s.caption === null && s.band === 0, 'no caption and no band over a card');
        assert.equal(s.title.opacity, 0);
        assert.equal(s.end.opacity, 0);
    }
    assert.equal(at(1).section, null, 'no section card on the title card');

    // The pointer: it stays where part 1 ended while the window leaves, and part 2 brings its own.
    const end1 = toScreen(WIDE, toWorld(L, { x: 1090, y: 540 }));
    for (const dt of [0, 0.1, 0.2, 0.3]) {
        const p = at(p1.t1 + dt).pointer;
        assert.ok(near(p.x, end1.x, 0.01) && near(p.y - at(p1.t1 + dt).window.drop, end1.y, 0.01), `the hand stays put while the window leaves (+${dt} s)`);
    }
    assert.equal(at(mid).pointer, null, 'no pointer on the card');
    const start2 = toScreen(at(p2.t0 + T.windowIn).cam, toWorld(L, { x: 900, y: 500 }));
    const landed = at(p2.t0 + T.windowIn).pointer;
    assert.ok(near(landed.x, start2.x, 0.01) && near(landed.y, start2.y, 0.01), 'part 2 begins with the pointer where the scene parked it');

    // Cadence and the hand's lock in part 2, as in part 1.
    const seen = inspectFilm(f);
    // 30 pictures per drag; the last of each stays on (a hold), so 29 of each count.
    assert.deepEqual(seen.cadence, { 2: 58 }, `every picture of both drags is on for two frames: ${JSON.stringify(seen.cadence)}`);
    assert.deepEqual(seen.warnings, []);
    const press2 = f.pointer.presses[1];
    assert.ok(near(press2.t0, p2.t0 + 1, 1e-9) && near(press2.t1, p2.t0 + 2.1, 1e-9), 'a press of part 2 in film time');
    const first2 = Math.round((p2.t0 + 1) * 60);
    for (let n = 1; n < 30; n++) {
        const a = at((first2 + 2 * n) / 60).pointer;
        const b = at((first2 + 2 * n + 1) / 60).pointer;
        assert.ok(a.held && a.x === b.x && a.y === b.y, 'hand and picture stay locked in part 2');
    }

    // Captions, chips, camera and callouts follow their part.
    assert.equal(f.captions.length, 2);
    assert.ok(f.captions[0].t1 <= p1.t1 + 1e-9 && near(f.captions[1].t0, p2.t0, 1e-9), 'each caption in its part');
    assert.deepEqual(f.chips, [{ secno: '§1', text: 'Drag to edit' }, { secno: '§2', text: 'Dynamics' }], 'the chip of each part names its section');
    assert.ok(at(p1.t0 + 2).chip === 1 && at(p1.t0 + 2).chipIndex === 0);
    assert.ok(at(p2.t0 + 2).chip === 1 && at(p2.t0 + 2).chipIndex === 1);
    assert.deepEqual(f.camera.map((c) => c.id), ['wide', 'one', 'back-1', 'two', 'back-2']);
    assert.ok(near(f.camera[3].t, p2.t0, 1e-9), 'the push of part 2 begins as its window lands');
    assert.equal(at(p2.t0 - 0.2).cam.z, 1, 'the camera is wide while the card is up');
    assert.ok(near(f.callouts[0].t0, p1.t0 + 1.2, 1 / 60) && near(f.callouts[1].t0, p2.t0 + 1.5, 1 / 60), 'callouts in film time');
    assert.ok(near(f.marks.poster, p2.t0 + 2.5, 0.5), 'the poster mark of part 2');
    assert.deepEqual(reviewMoments(f).map((m) => m.name), ['title', 'drag', 'callout-1', 'section-1', 'poster', 'callout-2', 'end'], 'the section card is a moment to look at');

    // Refused or noted.
    assert.throws(() => makeFilm({ ...sectioned, callouts: [{ ...sectioned.callouts[0], t1: 4.5 }] }, overview, { rawDir: '/tmp/raw' }), /across a section/, 'a callout cannot run across a card');
    assert.throws(() => makeFilm({ ...sectioned, presses: [{ t0: 3.5, t1: 4.2 }] }, overview, { rawDir: '/tmp/raw' }), /across a section/, 'nor can a press');
    assert.throws(() => makeFilm({ ...sectioned, sections: [{ ...sectioned.sections[0], t: 9 }] }, overview, { rawDir: '/tmp/raw' }), /empty/, 'a section with nothing filmed after it');
    assert.ok(makeFilm({ ...sectioned, sections: [{ ...sectioned.sections[0], seconds: 1 }] }, overview, { rawDir: '/tmp/raw' }).report.warnings.some((w) => /section card/.test(w)), 'a card held too briefly is noted');
    assert.ok(makeFilm({ ...sectioned, sections: [{ ...sectioned.sections[0], figure: null }] }, overview, { rawDir: '/tmp/raw' }).report.warnings.some((w) => /no figure/.test(w)), 'so is a card without its figure');
    assert.throws(() => makeFilm({ ...sectioned, sections: [{ ...sectioned.sections[0], lead: `a ${String.fromCharCode(0x2014)} b` }] }, overview, { rawDir: '/tmp/raw' }), /em dash/);
}

console.log('cinema: timeline and edit OK');
