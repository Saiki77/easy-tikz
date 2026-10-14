/* eslint-env browser, node */
// Pass 1 of a cinematic video: the capture. A scene plays against the real
// plugin in the isolated Obsidian of lib/obsidian.mjs, through real mouse
// and keyboard events, and this module writes down two things:
//
//   raw frames    the whole window at 1728 x 1117 CSS px, 2x (3456 x 2234 px PNG), with NOTHING drawn
//                 into the page: no pointer, no caption bar
//   track.json    the event track: which picture is on screen when, where the pointer is, when the
//                 button and which keys are down, the beats (caption and the rectangle of the UI the
//                 beat is about), the callouts, the part of the window that is the film's figure, the
//                 pictures that become the figures of the cards, and the frame that makes the poster
//
// Pass 2 (compose.mjs) draws the film from these. So the capture can be edited again and again
// (camera, captions, cards) without starting Obsidian.
//
// Like lib/record.mjs the capture runs on a logical clock: every picture is one tick of 30 per second,
// however long the screenshot took, so a capture is the same on a slow and on a fast machine. A
// picture that equals the one before it is not written twice.
//
// A scene is a module with a default export:
//
//   export default {
//       name: 'clip-drag',
//       title: { secno: '§1', text: 'Drag to edit', lead: 'Drag a line and [[its numbers follow]].', seconds: 2 },
//       seconds: [12, 16],                 // the length the film must have, cards included
//       async setup(d) { ... },            // not filmed: open the editor, load the chart, park the pointer
//       async run(d) { ... },              // filmed
//   };
//
// `d` is the director of createCapture(). It has the calls of the first video toolkit
// (video/common.mjs: hold, move, click, rest, drag, dragStart, dragTo, dragHold, dragEnd, slider, type,
// key, realtime, poster, expect, park, obs, ui, charts), so the interaction of an old scenario runs as
// it is, and the new ones that describe the film:
//
//   d.figure('editor')                                the part of the window the film shows as its figure
//   d.beat({ id, caption, focus, pad, align, move })  a new beat: the caption (formulas between $...$) and
//                                                     the part of the UI the camera goes to
//   d.callout({ at, text, side, dx, dy, seconds })    an arrow with a short note, pointing at `at`
//   d.callout({ at, equations, place, side })         the same with numbered equations, set in the margin
//   d.cardFigure('end', 'preview', { label, text })   the picture on screen becomes the figure of a card
//   d.keyDown('Shift', { side: 'left' })              holds a key; the pointer carries its keycap
import fs from 'node:fs';
import path from 'node:path';
import { minJerk, pathLength, pointAlong, smoothPath } from './timeline.mjs';
import { clone, resetApp, ui } from '../video/common.mjs';

export { clone, resetApp, ui };

/** Fullscreen content size of a 16 inch MacBook Pro; every capture is laid out at this size, at 2x. */
export const VIEW = { width: 1728, height: 1117, dpr: 2 };
/** Ticks of the capture clock per second. The film may have more frames per second (the camera and the pointer are drawn for each). */
export const SOURCE_FPS = 30;

function fail(message) {
    throw new Error(message);
}

/**
 * Page side of d.clock(): the time that window.requestAnimationFrame hands its callbacks. 'film' stops
 * that clock where it is, 'advance' moves it on by `step` ms, 'real' lets it run with the wall clock again
 * from where it stood (never backwards), 'remove' puts the browser's own function back. Nothing of the
 * plugin is changed: an animation that reads the time of its frames (a slider's play) then moves exactly
 * as far per picture as it does per 1/30 s on a screen, however long a screenshot takes.
 */
function filmClockHooks(mode, step) {
    let c = window.__etzFilmClock;
    if (!c && mode === 'remove') return false;
    if (!c) {
        const real = window.requestAnimationFrame;
        c = { real, film: false, now: 0, offset: 0 };
        window.__etzFilmClock = c;
        window.requestAnimationFrame = (callback) => real.call(window, (t) => callback(c.film ? c.now : t + c.offset));
    }
    if (mode === 'film' && !c.film) {
        c.now = performance.now() + c.offset;
        c.film = true;
    } else if (mode === 'advance') c.now += step;
    else if (mode === 'real' && c.film) {
        c.offset = c.now - performance.now();
        c.film = false;
    } else if (mode === 'remove') {
        window.requestAnimationFrame = c.real;
        delete window.__etzFilmClock;
    }
    return c.film;
}

/** Width and height of a PNG from its header. */
function pngSize(buffer) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const union = (a, b) => {
    if (!a) return b;
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    return { x: x0, y: y0, width: Math.max(a.x + a.width, b.x + b.width) - x0, height: Math.max(a.y + a.height, b.y + b.height) - y0 };
};

/**
 * Start a capture.
 *   obs       the session of lib/obsidian.mjs, laid out at VIEW
 *   scene     the scene's default export (for its name in messages)
 *   dir       folder for the raw frames and track.json (emptied first)
 *   charts    { lp, areas, ... }: deep copies of the plugin's examples, for the scene
 * Returns the director `d`. Call d.start() after the scene's setup, d.finish() after its run.
 */
export async function createCapture(obs, scene, { dir, fps = SOURCE_FPS, charts = {}, chartBlock = null, say = () => {} } = {}) {
    if (!dir) fail('createCapture: dir is required');
    dir = path.resolve(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const track = { version: 2, name: scene.name, fps, view: { ...VIEW }, figure: null, duration: 0, frames: [], pointer: [], presses: [], keys: [], beats: [], callouts: [], cards: {}, sections: [], marks: {}, facts: {} };
    const d = { obs, charts, chartBlock, ui, clone, track, dir, allowChip: false };
    let ticks = 0; // the clock: pictures shown so far
    let files = 0;
    let last = null;
    let started = false;
    let bytes = 0;
    let filmClock = false; // the page's animation frames run on the capture's clock (d.clock('film'))
    const clock = () => ticks / fps;
    const r1 = (v) => Math.round(v * 10) / 10;
    // Times are ticks: written with six decimals, and the edit snaps them back onto the tick grid. (Four
    // decimals were not enough: 0.0667 is later than tick 2 of 30, and the picture came one frame late.)
    const r6 = (v) => Math.round(v * 1e6) / 1e6;

    const sample = (t) => {
        const p = { t: r6(t), x: r1(obs.mouse.x), y: r1(obs.mouse.y) };
        const prev = track.pointer[track.pointer.length - 1];
        if (prev && prev.t === p.t) Object.assign(prev, p);
        else if (!(prev && prev.x === p.x && prev.y === p.y && track.pointer.length > 1 && track.pointer[track.pointer.length - 2].x === p.x && track.pointer[track.pointer.length - 2].y === p.y)) track.pointer.push(p);
        else prev.t = p.t; // a longer rest: move the end of the resting stretch
    };

    // The button: the picture taken next is the first that shows the press (or the release).
    const onMouse = ({ type, x, y }) => {
        if (!started) return;
        if (type === 'mousePressed') track.presses.push({ t0: r6(clock()), t1: null, x: r1(x), y: r1(y) });
        else if (type === 'mouseReleased') {
            const open = track.presses[track.presses.length - 1];
            if (open && open.t1 === null) open.t1 = r6(clock());
        }
    };
    obs.mouse.listeners.add(onMouse);

    /**
     * Take the picture that is on screen now and show it for `repeat` ticks. On the film clock every tick
     * is a picture of its own: the page's clock goes on by one tick, the app draws what that tick shows
     * (two animation frames: the step, then the drawing it asked for), and that is the picture.
     */
    async function shot(repeat = 1) {
        if (!started) fail(`${scene.name}: d.start() has not been called (filming calls belong in run())`);
        repeat = Math.max(1, Math.round(repeat));
        if (filmClock) {
            for (let i = 0; i < repeat; i++) {
                await obs.call(filmClockHooks, 'advance', 1000 / fps);
                await obs.frames(2);
                await picture(1);
            }
            return;
        }
        await picture(repeat);
    }
    async function picture(repeat) {
        await obs.frames(1);
        // Once in a long while a screenshot never answers (it waits for a frame that does not come). The app
        // is at rest meanwhile, so the picture can simply be asked for again: it shows the same moment.
        let r = null;
        for (let attempt = 1; !r; attempt++) {
            try {
                r = await obs.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, optimizeForSpeed: true }, { timeout: attempt === 1 ? 8000 : 20000 });
            } catch (e) {
                if (attempt >= 3 || !/no answer/.test(e.message)) throw e;
                await obs.frames(1).catch(() => {});
            }
        }
        const buffer = Buffer.from(r.data, 'base64');
        let file;
        if (last && last.buffer.equals(buffer)) file = last.file;
        else {
            if (!files) {
                const size = pngSize(buffer);
                if (size.width !== VIEW.width * VIEW.dpr || size.height !== VIEW.height * VIEW.dpr) fail(`capture: a frame is ${size.width} x ${size.height} px, expected ${VIEW.width * VIEW.dpr} x ${VIEW.height * VIEW.dpr}`);
            }
            file = `raw-${String(++files).padStart(5, '0')}.png`;
            fs.writeFileSync(path.join(dir, file), buffer);
            bytes += buffer.length;
            last = { buffer, file };
        }
        const prev = track.frames[track.frames.length - 1];
        if (!prev || prev.file !== file) track.frames.push({ t: r6(clock()), file });
        sample(clock());
        if (repeat > 1) sample((ticks + repeat - 1) / fps);
        const at = clock();
        ticks += repeat;
        if (probe) await probe(at, file);
    }
    d.frame = shot;

    /**
     * Read the app after every picture from now on: fn(t, file) with the time and the file of the picture
     * just taken; d.probe(null) stops it. For checking what a caption claims about a moving stretch (a
     * drag, play) at each of its pictures. The function only reads: it must not change the app.
     */
    let probe = null;
    d.probe = (fn) => {
        probe = fn || null;
    };

    /** From here on every step is filmed. */
    d.start = async () => {
        const view = await obs.call(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, light: document.body.classList.contains('theme-light') }));
        if (view.width !== VIEW.width || view.height !== VIEW.height || view.dpr !== VIEW.dpr || !view.light) {
            fail(`capture: the page is ${view.width} x ${view.height} at ${view.dpr}x (${view.light ? 'light' : 'dark'}), expected ${VIEW.width} x ${VIEW.height} at ${VIEW.dpr}x in the light theme`);
        }
        if (await obs.call(() => !!document.getElementById('etz-media-overlay'))) fail('capture: the pointer overlay of lib/record.mjs is in the page; raw frames must not contain it');
        // The figure of the film: the editor when it is open (so no dimmed workspace can come into a close-up), else the whole window.
        if (!track.figure) {
            if (await obs.call(() => !!window.__etzMedia.editor())) await d.figure('editor');
            else track.figure = { rect: { x: 0, y: 0, width: VIEW.width, height: VIEW.height }, radius: 0 };
        }
        started = true;
    };

    /** Fail the scene: a film that does not show what its caption says is not published. */
    d.expect = (condition, message) => {
        if (!condition) fail(`${scene.name}: ${message}`);
    };
    /** No status chip and no console error may be on screen while filming. */
    d.check = async () => {
        if (obs.errors.length) fail(`${scene.name}: console error: ${obs.errors[0].text}`);
        if (d.allowChip) return;
        const chip = await obs.statusChip().catch(() => null);
        if (chip) fail(`${scene.name}: the status chip shows "${chip}"`);
    };
    /** Something the film prints that the app reported: kept in the track, for the report of the build. */
    d.fact = (name, value) => {
        track.facts[name] = value;
    };

    // ------------------------------------------------------------ targets

    /** A target to a point in window px: everything obs.point() takes, plus ui.example(title) and { rect, at }. */
    d.point = async (target) => {
        if (target && target.exampleTitle) {
            const p = await obs.call((title) => {
                const tiles = Array.from(document.querySelectorAll('.modal.tikz-modal .etz-build-example'));
                const tile = tiles.find((t) => {
                    const el = t.querySelector('.etz-build-example-title');
                    return el && (el.firstChild ? el.firstChild.textContent : el.textContent).trim() === title;
                });
                if (!tile) return null;
                const r = tile.getBoundingClientRect();
                return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.35 };
            }, target.exampleTitle);
            if (!p) fail(`${scene.name}: no example tile "${target.exampleTitle}"`);
            return p;
        }
        if (target && target.rect) {
            const r = await d.rect(target.rect);
            const [fx, fy] = target.at || [0.5, 0.5];
            return { x: r.x + fx * r.width, y: r.y + fy * r.height };
        }
        return obs.point(target);
    };

    /**
     * A rectangle of the UI in window px, from the toolkit's element boxes:
     *   'editor' | 'stage' | 'preview' | 'dock' | 'panel' | 'note' | 'inline' | a CSS selector    (obs.clipRect)
     *   { x, y, width, height }                         as given
     *   { math: [[x, y], ...] }                         the box around points of the 2D preview
     *   { slider: 'c' }                                 the row of a slider in the Sliders dock
     *   { of: spec, grow: n | [left, top, right, bottom] }   another rectangle, made larger (or smaller)
     *   { columns: spec, rows: spec }                   as wide as one rectangle and as high as another
     *   [spec, spec, ...]                               the box around all of them
     */
    d.rect = async (spec) => {
        if (Array.isArray(spec)) {
            let box = null;
            for (const part of spec) box = union(box, await d.rect(part));
            return box;
        }
        if (spec && spec.columns && spec.rows) {
            const across = await d.rect(spec.columns);
            const down = await d.rect(spec.rows);
            return { x: across.x, y: down.y, width: across.width, height: down.height };
        }
        if (spec && spec.math) {
            let box = null;
            for (const [x, y] of spec.math) {
                const p = await obs.mathToClient(x, y);
                box = union(box, { x: p.x, y: p.y, width: 0, height: 0 });
            }
            return box;
        }
        if (spec && spec.slider) {
            const r = await obs.call((name) => {
                const input = window.__etzMedia.sliderInput(name, 'editor', 0);
                const row = input ? input.closest('.etz-dock-row, .etz-slider, .etz-slider-row') || input.parentElement.parentElement : null;
                return row ? window.__etzMedia.rect(row) : null;
            }, spec.slider);
            if (!r) fail(`${scene.name}: no slider "${spec.slider}" in the Sliders dock`);
            return r;
        }
        if (spec && spec.of) {
            const r = await d.rect(spec.of);
            const g = Array.isArray(spec.grow) ? spec.grow : [spec.grow || 0, spec.grow || 0, spec.grow || 0, spec.grow || 0];
            return { x: r.x - g[0], y: r.y - g[1], width: r.width + g[0] + g[2], height: r.height + g[1] + g[3] };
        }
        if (spec && typeof spec.x === 'number' && typeof spec.width === 'number') return { x: spec.x, y: spec.y, width: spec.width, height: spec.height };
        const r = await obs.clipRect(spec);
        if (!r) fail(`${scene.name}: nothing on screen for ${JSON.stringify(spec)}`);
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    };

    // ------------------------------------------------------------ the film

    /**
     * The part of the window that is the figure of the film: what lies on the page in the wide shot and
     * what the camera pushes into. Default (set by start()): the editor's modal, with its own corner
     * radius, so the dimmed workspace around it never comes into a close-up. Call it in setup for
     * another part ('window' shows Obsidian whole: once, in the opening shot of the overview).
     *   spec     as for d.rect
     *   radius   CSS px of the corners (default: the modal's own for 'editor', else 0)
     * The rectangle is moved inwards onto whole pixels of the capture.
     */
    d.figure = async (spec = 'editor', { radius = null } = {}) => {
        const r = spec === 'window' ? { x: 0, y: 0, width: VIEW.width, height: VIEW.height } : await d.rect(spec);
        const step = VIEW.dpr;
        const x = Math.ceil(r.x * step - 1e-6) / step;
        const y = Math.ceil(r.y * step - 1e-6) / step;
        const right = Math.floor((r.x + r.width) * step + 1e-6) / step;
        const bottom = Math.floor((r.y + r.height) * step + 1e-6) / step;
        let corner = radius;
        if (corner === null) {
            corner = spec === 'editor' ? await obs.call(() => {
                const m = window.__etzMedia.editor();
                // Half a pixel more than the modal's own radius: the clip then also takes the soft outer edge of its border.
                return m ? (parseFloat(getComputedStyle(m.modalEl).borderTopLeftRadius) || 0) + 0.5 : 0;
            }) : 0;
        }
        const figure = { rect: { x, y, width: right - x, height: bottom - y }, radius: corner };
        // A film has one figure: after the first picture, a section may only confirm it (the editor stays where it was).
        if (started && track.figure && JSON.stringify(track.figure) !== JSON.stringify(figure)) {
            fail(`${scene.name}: the figure moved from ${JSON.stringify(track.figure.rect)} to ${JSON.stringify(figure.rect)}: a film has one figure`);
        }
        track.figure = figure;
        return track.figure;
    };

    /**
     * The picture that is on screen now becomes the figure of a card: cropped to `spec` (as for d.rect), with
     * a caption in the manner of a paper.
     *   which    'title', 'section' (the card of the last d.section(); call it after the section's first
     *            picture, which is what the card shows of the part to come) or 'end'
     *   label    'Figure 1.' (set in bold)
     *   text     one plain sentence; formulas between dollar signs
     */
    d.cardFigure = async (which, spec = 'preview', { label = '', text = '' } = {}) => {
        if (which !== 'title' && which !== 'end' && which !== 'section') fail(`cardFigure: "${which}" is not a card (title, section, end)`);
        if (!last) fail(`${scene.name}: cardFigure("${which}") before the first picture: film something first (d.hold)`);
        const figure = { file: last.file, rect: await d.rect(spec), label, text };
        if (which !== 'section') {
            track.cards[which] = figure;
            return;
        }
        const section = track.sections[track.sections.length - 1];
        if (!section) fail(`${scene.name}: cardFigure("section") without a d.section() before it`);
        const shown = track.frames[track.frames.length - 1];
        if (!shown || shown.t < section.t - 1e-9) fail(`${scene.name}: cardFigure("section") before the first picture of the section: film it first (d.hold)`);
        section.figure = figure;
    };

    /**
     * A section card: the window leaves the page as at the end of a film, a card in the manner of the title
     * card stands there, and the window comes back with what the scene does next. Call it when a part is
     * done (the camera back in the wide shot, nothing held), then set up the next part (load a chart, tidy,
     * park the pointer): no picture is taken until the scene films again, so that work takes no time of the
     * film. The edit puts the card in between (edit.mjs).
     *   secno, text   '§2', 'Dynamics': the title of the section (and its chip over the captions)
     *   lead          one sentence; [[...]] marks its one highlighted phrase
     *   seconds       how long the complete card is held (default 2)
     */
    d.section = async ({ secno = '', text, lead = '', seconds } = {}) => {
        if (!started || !last) fail(`${scene.name}: d.section() before the first picture`);
        if (!text) fail(`${scene.name}: d.section() needs a text`);
        if (obs.mouse.buttons & 1) fail(`${scene.name}: d.section() while the mouse button is down`);
        if (track.keys.some((k) => k.t1 === null)) fail(`${scene.name}: d.section() while a key is held`);
        if (track.callouts.some((c) => c.t1 === null || c.t1 > clock() + 1e-9)) fail(`${scene.name}: d.section() while a callout is on`);
        if (filmClock) fail(`${scene.name}: d.section() on the film clock: put it back with d.clock('real') first`);
        const section = { t: r6(clock()), secno, text, lead, figure: null };
        if (seconds !== undefined) section.seconds = seconds;
        track.sections.push(section);
    };

    /**
     * The clock the page's animations see. 'film': from now on every picture is one tick of the capture
     * (1/30 s) of the page's time, so something that runs on its own clock (a slider's play) moves at its
     * true speed and is filmed in every tick, however long a picture takes to take; holds take a picture
     * per tick as well. 'real': the page's time runs with the wall clock again, from where it stood.
     */
    d.clock = async (mode) => {
        if (mode !== 'film' && mode !== 'real') fail(`d.clock: "${mode}" is not a clock (film, real)`);
        filmClock = await obs.call(filmClockHooks, mode, 0);
        track.facts.clock = track.facts.clock || [];
        track.facts.clock.push([mode, r6(clock())]);
    };

    /**
     * A new beat.
     *   caption   one line, at most 8 words, formulas between dollar signs ('Drag $2x + 3y = c$.').
     *             Leave it out to keep the caption that is on; '' takes it away
     *   focus     what the beat is about (see d.rect); 'window' is the wide shot. Leave it out to keep the camera
     *   pad       px of the output kept free around the focus (default 40): a number, [x, y] or [left, top, right, bottom]
     *   align     where the focus lies in the frame: 'center' (default), 'left', 'right', 'top', 'bottom' or a pair
     *             ('right bottom'). With it a frame edge lands on an edge of the UI, and the paper beside the
     *             figure is the margin for a note
     *   zoom      a zoom instead of the largest that fits; minZoom: at least this close
     *   move      seconds of the camera move (default 0.6 to 0.9, by its size)
     *   lead      seconds the camera sets off before this call (it may start while the last beat's result is held);
     *             negative: after it (the hand sets off first, for a way that dips towards the band)
     */
    d.beat = async ({ id = null, caption, focus, pad, align, zoom, minZoom, move, lead } = {}) => {
        const beat = { t: r6(clock()), id: id || `beat-${track.beats.length + 1}` };
        if (caption !== undefined) beat.caption = caption;
        if (focus !== undefined) beat.focus = focus === 'window' || focus === null ? null : await d.rect(focus);
        for (const [key, value] of Object.entries({ pad, align, zoom, minZoom, move, lead })) if (value !== undefined) beat[key] = value;
        track.beats.push(beat);
    };
    /** The old toolkit's call: a caption without a camera move. */
    d.caption = (text) => d.beat({ caption: text });

    /**
     * An arrow that draws on and points at a spot, with a short note; it fades after `seconds`.
     *   at         the spot (see d.point)
     *   text       a few words; formulas between dollar signs
     *   equations  instead of text: numbered equations, aligned on their relation sign as on the brand's
     *              pages: [['2x + 3y = c', 'a'], ['[[2.5]]x + 3y = c', 'b']] ([[...]] sets a part in the accent)
     *   side       where the note stands: 'right' of the spot (default) or 'left'
     *   dx, dy     px of the output from the spot to the near end of the note (default 150, -70: up and to the side)
     *   place      instead of dx, dy: [x, y] in grid units of the page, the note's left edge and its first
     *              baseline. For a note in the paper margin beside the figure
     *   in, out    the side of the spot the arrow arrives from and the direction it leaves the note in, in
     *              degrees as in TikZ (0 right, 90 above, 180 left). Default: it leaves sideways
     *   bend       instead of in and out: a plain arc, as a fraction of its length (0.1 is gentle)
     *   gap        px kept free before the spot (default 10)
     *   seconds    how long it is on (default 1.8). null: until d.calloutEnd() is called
     *   delay      seconds from now until it starts
     *   size       the size of the note's type, as a factor (default 1). 0.85 sets numbered equations at the
     *              brand's size for display equations (36 design px), for a block that needs the room
     */
    d.callout = async ({ at, text = '', equations = null, side = 'right', dx = null, dy = -70, place = null, in: arrive = null, out: leave = null, bend = null, looseness = null, gap = 10, seconds = 1.8, delay = 0, size = 1 } = {}) => {
        const to = await d.point(at);
        const t0 = clock() + delay;
        const callout = { t0: r6(t0), t1: seconds === null ? null : r6(t0 + seconds), to: { x: r1(to.x), y: r1(to.y) }, text, side, dx: dx === null ? (side === 'left' ? -150 : 150) : dx, dy, in: arrive, out: leave, bend, looseness, gap };
        if (equations) callout.equations = equations;
        if (place) callout.place = place;
        if (size !== 1) callout.size = size;
        track.callouts.push(callout);
    };
    /** The callout that was left open (seconds: null) has faded by now. */
    d.calloutEnd = () => {
        const open = track.callouts.find((c) => c.t1 === null);
        if (!open) fail(`${scene.name}: calloutEnd() without an open callout`);
        open.t1 = r6(clock());
    };

    /** The picture shown last becomes the poster of the film. */
    d.poster = () => {
        track.marks.poster = r6(Math.max(0, clock() - 0.5 / fps));
    };

    // ------------------------------------------------------------ pacing

    /**
     * Let the picture become final, then show it for `seconds`. On the film clock the picture is in motion
     * (play goes on), so nothing is waited for: every tick is filmed as it comes.
     */
    d.hold = async (seconds = 0.6) => {
        if (!filmClock) {
            await obs.waitForRender();
            await d.check();
        } else if (obs.errors.length) fail(`${scene.name}: console error: ${obs.errors[0].text}`);
        await shot(seconds * fps);
    };

    /**
     * Glide the pointer to a target: from rest to rest (minimum jerk), on a slight arc, one picture per
     * step. The app sees every step as a real mouse move.
     *   bow   px the arc bulges sideways (default: 8 % of the way, at most 42); 0 is a straight line
     *   via   targets to pass on the way (around a shape that would answer the hand, under a pane): the
     *         corners are rounded (smoothPath) and the hand keeps one minimum-jerk pace along the whole way
     */
    async function glide(target, { seconds = 0.7, bow = null, via = null } = {}) {
        const to = await d.point(target);
        const from = { x: obs.mouse.x, y: obs.mouse.y };
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        const steps = Math.max(1, Math.round(seconds * fps));
        if (via && via.length) {
            const corners = [from];
            for (const v of via) corners.push(await d.point(v));
            corners.push(to);
            const way = smoothPath(corners, 3);
            const total = pathLength(way);
            for (let i = 1; i <= steps; i++) {
                await obs.mouse.move(pointAlong(way, minJerk(i / steps) * total));
                await shot();
            }
            return;
        }
        if (dist < 0.5) {
            await shot(steps);
            return;
        }
        const sag = bow === null ? Math.min(42, dist * 0.08) : bow;
        const nx = (to.y - from.y) / dist;
        const ny = -(to.x - from.x) / dist;
        for (let i = 1; i <= steps; i++) {
            const s = minJerk(i / steps);
            const b = 4 * s * (1 - s) * sag;
            await obs.mouse.move({ x: from.x + (to.x - from.x) * s + nx * b, y: from.y + (to.y - from.y) * s + ny * b });
            await shot();
        }
    }
    d.move = glide;

    /** Park the pointer without filming the way there (use in setup). */
    d.park = async (target) => {
        await obs.mouse.move(await d.point(target));
    };

    /**
     * Tidy the Build panel before filming, with real input (use in setup): the cards named in `collapse`
     * are closed by a click on their chevron, and the list is scrolled with the wheel until the group
     * `lead` is its first heading. So a film does not open on the empty state of a group ("No functions
     * yet") and the cards the beat is about are in the picture.
     */
    d.tidyBuild = async ({ collapse = [], lead = 'Shapes and marks', gap = 14 } = {}) => {
        const PANEL = '.modal.tikz-modal .etz-tabpanel.mod-build';
        for (const cardName of collapse) {
            const at = await obs.call(
                (panelSel, wanted) => {
                    const card = Array.from(document.querySelectorAll(`${panelSel} .etz-card`)).find((node) => ((node.querySelector('.etz-card-name') || {}).textContent || '').trim() === wanted);
                    const chevron = card && !card.classList.contains('is-collapsed') ? card.querySelector('.etz-card-chevron') : null;
                    if (!chevron) return null;
                    chevron.scrollIntoView({ block: 'nearest' });
                    const r = chevron.getBoundingClientRect();
                    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                },
                PANEL,
                cardName
            );
            if (!at) fail(`${scene.name}: no open card "${cardName}" in the Build panel`);
            await obs.mouse.click(at);
            await obs.waitForRender();
        }
        const offset = () =>
            obs.call(
                (panelSel, title) => {
                    const panel = document.querySelector(panelSel);
                    if (!panel) return null;
                    const header = Array.from(panel.querySelectorAll('.etz-group-header')).find((node) => ((node.querySelector('.etz-group-title') || node).textContent || '').trim().toLowerCase() === title.toLowerCase());
                    if (!header) return null;
                    return { by: header.getBoundingClientRect().top - panel.getBoundingClientRect().top, room: panel.scrollHeight - panel.clientHeight - panel.scrollTop };
                },
                PANEL,
                lead
            );
        let m = await offset();
        if (!m) fail(`${scene.name}: the Build panel has no group "${lead}"`);
        for (let i = 0; i < 8 && Math.abs(m.by - gap) > 1.5 && (m.by < gap || m.room > 1); i++) {
            await obs.mouse.wheel(PANEL, Math.min(m.by - gap, m.room));
            await obs.sleep(160);
            m = await offset();
        }
        await obs.blur();
        await obs.mouse.move({ x: 2, y: 2 });
        await obs.waitForRender();
        await obs.sleep(2500); // the overlay scroll bar fades out
        return m;
    };

    const hintShown = () =>
        obs.call(() => {
            const m = window.__etzMedia.editor();
            const el = m ? m.modalEl.querySelector('.etz-drag-hint') : null;
            return !!el && !el.classList.contains('tikz-hidden') && (el.textContent || '').trim().length > 0;
        });

    /**
     * Rest the pointer on a shape of the 2D preview until its tip shows, then hold. Returns the tip's text.
     *   tip   a pattern the tip must match before the rest is filmed. The editor shows a tip about 0.1 s
     *         after the pointer stops, and the tip of a shape passed on the way (a curve under a point) can
     *         still be on until then: without `tip` the rest may film that one
     *   bow, via   the way there, as for d.move (bow: 0 comes in on a straight line)
     */
    d.rest = async (target, { seconds = 0.7, pause = 0.5, tip = null, bow = null, via = null } = {}) => {
        await glide(target, { seconds, bow, via });
        await obs.waitFor(hintShown, { timeout: 2000, interval: 40, message: 'the hover tip' });
        if (tip) {
            const matches = async () => tip.test(((await obs.editorState()) || {}).hint || '');
            await obs.waitFor(matches, { timeout: 2000, interval: 40, message: `a hover tip that matches ${tip}` });
        }
        await obs.frames(2);
        await shot(pause * fps);
        return (await obs.editorState()).hint;
    };

    /** Glide to a target and click it; the result is filmed once `until()` has resolved. */
    d.click = async (target, { seconds = 0.7, pause = 0.6, until = null, count = 1, settle = true } = {}) => {
        if (target) await glide(target, { seconds });
        await shot(0.12 * fps);
        for (let i = 1; i <= count; i++) {
            await obs.mouse.down(null, { clickCount: i });
            await shot(i === count ? 4 : 2);
            await obs.mouse.up(null, { clickCount: i });
        }
        if (until) await until();
        await obs.sleep(80);
        if (settle) {
            await obs.waitForRender();
            await d.check();
        }
        if (pause > 0) await shot(pause * fps);
    };

    // ------------------------------------------------------------ keys

    /**
     * Hold a key until keyUp. A modifier applies to the mouse events that follow, and the film shows
     * its keycap beside the pointer.
     *   label    what the keycap says (default: the key's name)
     *   side     'right' (default: to the lower right of the pointer) or 'left'
     *   offset   [dx, dy] px, at a pointer scale of 1: move the keycap to free ground
     */
    d.keyDown = async (name, { label = name, side = 'right', offset = [0, 0] } = {}) => {
        await obs.keyDown(name);
        // The editor reads the modifier from pointer events: one that carries it, at the place the pointer is.
        await obs.mouse.move({ x: obs.mouse.x, y: obs.mouse.y });
        if (started) track.keys.push({ key: name, label, side, offset, t0: r6(clock()), t1: null });
    };
    d.keyUp = async (name) => {
        await obs.keyUp(name);
        for (let i = track.keys.length - 1; i >= 0; i--) {
            if (track.keys[i].key === name && track.keys[i].t1 === null) {
                track.keys[i].t1 = r6(clock());
                break;
            }
        }
    };
    const keyHeld = (name) => track.keys.some((k) => k.key === name && k.t1 === null);

    /** Press a key; the result is held for `pause` seconds. */
    d.key = async (name, mods = {}, { pause = 0.4 } = {}) => {
        await obs.key(name, mods);
        await obs.sleep(80);
        await d.hold(pause);
    };
    /** Type into the focused field at `cps` characters per second (never slower than 12 in a film). */
    d.type = async (text, { cps = 14 } = {}) => {
        const perChar = fps / cps;
        let owed = 0;
        await obs.type(text, {
            onChar: async () => {
                owed += perChar;
                const n = Math.floor(owed);
                owed -= n;
                if (n > 0) await shot(n);
            },
        });
    };

    // ------------------------------------------------------------ drags

    /**
     * Start a drag and keep the button down: glide to the first target, press, move along the others.
     * Continue with dragTo() and dragHold(), finish with dragEnd().
     *   shift       hold Shift for the gesture. It goes down once the pointer rests on the shape, and
     *               what it shows (the pivot ring, the tip) is held for `shiftHold` seconds before the press
     *   keycap      { side, offset } for the Shift keycap
     *   ease        how the hand moves along the path, as a function of 0..1 to 0..1 (default: minimum
     *               jerk, from rest to rest). A long drag that should read in its middle wants a steadier one
     */
    d.dragStart = async (pathTargets, { seconds = 1.2, approach = 0.7, shift = false, shiftHold = 0.6, keycap = {}, ease = minJerk } = {}) => {
        if (!Array.isArray(pathTargets) || pathTargets.length < 2) fail('dragStart: a path needs at least two targets');
        const pts = [];
        for (const target of pathTargets) pts.push(await d.point(target));
        if (approach > 0 || Math.hypot(obs.mouse.x - pts[0].x, obs.mouse.y - pts[0].y) > 0.5) await glide(pts[0], { seconds: Math.max(approach, 1 / fps) });
        if (shift && !keyHeld('Shift')) {
            await d.keyDown('Shift', { label: 'Shift', ...keycap });
            await obs.sleep(120);
            await d.hold(shiftHold);
        }
        await obs.frames(1);
        await obs.mouse.down();
        await shot();
        const lengths = [];
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
            const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
            lengths.push(len);
            total += len;
        }
        const steps = Math.max(pts.length - 1, Math.round(seconds * fps));
        for (let i = 1; i <= steps; i++) {
            let along = ease(i / steps) * total;
            let seg = 0;
            while (seg < lengths.length - 1 && along > lengths[seg]) along -= lengths[seg++];
            const f = lengths[seg] > 0 ? Math.min(1, along / lengths[seg]) : 1;
            await obs.mouse.move({ x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * f, y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * f });
            await shot();
        }
    };
    /** Drag on to a target (the button is down). */
    d.dragTo = async (target, { seconds = 1.0, ease = minJerk } = {}) => {
        const to = await d.point(target);
        const from = { x: obs.mouse.x, y: obs.mouse.y };
        const steps = Math.max(1, Math.round(seconds * fps));
        for (let i = 1; i <= steps; i++) {
            const s = ease(i / steps);
            await obs.mouse.move({ x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s });
            await shot();
        }
    };
    /** Show the picture during a drag for `seconds` (the button stays down). */
    d.dragHold = async (seconds = 0.6) => {
        await obs.frames(2);
        await shot(seconds * fps);
    };
    /** Release the button (and Shift, Alt); the result is held for `pause` seconds. */
    d.dragEnd = async ({ pause = 0.7 } = {}) => {
        await obs.mouse.up();
        for (const name of ['Shift', 'Alt']) if (keyHeld(name)) await d.keyUp(name);
        if (pause > 0) await d.hold(pause);
        else await obs.waitForRender();
    };
    /** A whole drag along a path of targets. */
    d.drag = async (pathTargets, { seconds = 1.4, approach = 0.7, shift = false, pause = 0.7, keycap } = {}) => {
        await d.dragStart(pathTargets, { seconds, approach, shift, keycap });
        await d.dragEnd({ pause });
    };

    /** Drag a slider's thumb with the mouse: in the Sliders dock, or { scope: 'note' } in a note's strip. */
    d.slider = async (name, value, { seconds = 1.3, approach = 0.7, scope = 'editor', chart = 0, pause = 0.5 } = {}) => {
        const from = await obs.point({ slider: name, scope, chart });
        const to = await obs.point({ slider: name, value, scope, chart });
        await glide(from, { seconds: approach });
        await obs.mouse.down();
        await shot();
        await d.dragTo(to, { seconds });
        await obs.mouse.up();
        await obs.waitForRender({ settle: scope === 'note' ? 220 : 0 });
        if (pause > 0) await d.hold(pause);
    };

    /**
     * Film `seconds` of real time, for something that runs on its own clock (slider play). A capture
     * takes longer than one tick, so each picture is shown for as many ticks as real time went by.
     */
    d.realtime = async (seconds) => {
        const total = Math.max(1, Math.round(seconds * fps));
        const begin = Date.now();
        let done = 0;
        let cost = 280;
        while (done < total) {
            const t = Date.now();
            const due = Math.round(((t - begin + cost) * fps) / 1000);
            const n = Math.min(total - done, Math.max(1, due - done));
            await shot(n);
            cost = 0.6 * cost + 0.4 * (Date.now() - t);
            done += n;
        }
    };

    /** Write track.json. Returns { track, file, pictures, bytes, seconds }. */
    d.finish = async () => {
        await d.check();
        if (track.presses.some((p) => p.t1 === null)) fail(`${scene.name}: the mouse button is still down at the end of the scene`);
        if (track.callouts.some((c) => c.t1 === null)) fail(`${scene.name}: a callout was left open (seconds: null) and never ended with calloutEnd()`);
        for (const k of track.keys) if (k.t1 === null) k.t1 = r6(clock());
        track.duration = r6(clock());
        const file = path.join(dir, 'track.json');
        fs.writeFileSync(file, JSON.stringify(track, null, 1));
        say(`${scene.name}: captured ${track.duration.toFixed(1)} s in ${files} pictures (${(bytes / 1024 / 1024).toFixed(0)} MB)`);
        return { track, file, pictures: files, bytes, seconds: track.duration };
    };

    d.close = async () => {
        obs.mouse.listeners.delete(onMouse);
        filmClock = false;
        await obs.call(filmClockHooks, 'remove', 0).catch(() => {});
    };

    return d;
}

/** Read a capture back: { track, rawDir }. */
export function readCapture(dir) {
    const file = path.join(dir, 'track.json');
    if (!fs.existsSync(file)) fail(`no capture in ${dir} (track.json is missing): run the capture pass first`);
    const track = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const f of track.frames) if (!fs.existsSync(path.join(dir, f.file))) fail(`the capture in ${dir} is incomplete: ${f.file} is missing`);
    return { track, rawDir: dir };
}
