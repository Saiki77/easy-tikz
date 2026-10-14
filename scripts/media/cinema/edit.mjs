/* eslint-env node */
// The edit: a capture (raw frames and an event track, see capture.mjs) and
// the scene's title and end card become a film, the plain object the stage
// page draws (stage.mjs) and timeline.mjs reads.
//
//   const film = makeFilm(track, scene, { rawDir });
//
// A film is data only:
//   { name, width, height, fps, duration, layout, source: { fps }, body: { t0, t1 },
//     parts:    [{ t0, t1 }]                         the capture between its section cards (one part without)
//     frames:   [{ t, src }]                         which picture of the capture is on screen from t on
//     camera:   [{ t, dur, z, tx, ty, id }]          camera keys (timeline.mjs cameraAt)
//     captions: [{ t0, t1, html, text, part }]
//     callouts: [{ t0, t1, to, html, kind, side, dx, dy, place, in, out, bend, looseness, gap }]
//     pointer:  { scale, samples: [{ t, x, y }], presses: [{ t0, t1 }], keys: [{ t0, t1, label, side, offset }] }
//     chip:     { secno, text } | null               the film's title in small capitals over the caption
//     chips:    [chip per part]                      a film with sections carries each section's title
//     title:    { secno, text, leadHtml, figure }    the lead may mark one phrase with [[...]] for the highlighter
//     sections: [{ secno, text, leadHtml, figure, seconds }]   the section card before part i + 1
//     end:      { title, rows: [[label, html]], printHtml, figure, seconds }
//     head:     { main: [left, right], end: [left, right] }
//     marks:    { poster }                           film seconds
//     report:   { beats: [{ id, zoom, source, move }], warnings: [] } }
// A card's figure is { src, crop: { x, y, width, height }, captionHtml }: a picture of the capture, cropped.
//
// Times are film seconds: the title card runs from 0 to body.t0, the capture from body.t0 to body.t1
// (part by part, with a section card between two parts), then the end card. Every time of the track is
// snapped to the ticks of the capture (30 per second) and every card to whole frames of the output, so
// each picture of the capture lands on its own frames: 2, 2, 2, ... at 60 frames per second, never 2, 3, 1.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { aligned, math } from '../brand/math.mjs';
import { TIMING, WIDE, moveSeconds, solveCamera, splitMath, stageLayout, stateAt, wordCount } from './timeline.mjs';

/** What every film says at its end. Each line is true of the plugin today (README, manifest.json, LICENSE.md). */
export const END_CARD = {
    title: 'Easy TikZ 4',
    rows: [
        ['Install', ['Settings', 'Community plugins', 'Easy TikZ']],
        ['Source', 'github.com/Saiki77/easy-tikz'],
    ],
    print: ['MIT licensed', 'Obsidian 1.13 or newer'],
    /** Seconds the complete card is held, after it has come in: 3 in the overview, at least 2.2 in a clip. */
    seconds: 3,
};
/** The shortest hold of the complete end card: four facts are not read in less. */
export const END_MIN = 2.2;
/** The shortest time a caption is on: long enough to read it twice. */
export const CAPTION_MIN = 3;
/** Seconds a section card is held complete (after it has come in, before it starts to leave), by default and at least. */
export const SECTION_SECONDS = 2;
export const SECTION_MIN = 1.5;
export const HEAD = { main: ['Easy TikZ 4', 'An Obsidian plugin'], end: ['An Obsidian plugin', 'Version 4'] };

const EM_DASH = String.fromCharCode(0x2014);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Text with $formulas$ to HTML: the formulas are typeset by the brand's math.mjs. */
export function richText(text) {
    return splitMath(text)
        .map((part) => (part.math ? math(part.math) : esc(part.text)))
        .join('');
}

/** The lead of a title card: [[phrase]] is the one highlighted phrase. */
function leadHtml(text) {
    return richText(text).replace(/\[\[(.+?)\]\]/, '<span class="hl">$1</span>');
}

/**
 * Build the film.
 *   track    what capture.mjs wrote (track.json)
 *   scene    the scene module's default export: { name, title: { secno, text, lead, seconds, card }, end: { seconds, ... } }
 *   rawDir   folder of the raw frames
 *   width, height, fps   the output (default 1920 x 1080, 60)
 */
export function makeFilm(track, scene, { rawDir, width = 1920, height = 1080, fps = 60 } = {}) {
    const L = stageLayout({ width, height, view: track.view, figure: track.figure || null });
    const T = TIMING;
    const warnings = [];
    const src = track.fps;
    /** A time of the track on its tick, and a time of the film on its frame. */
    const tick = (t) => Math.round(t * src) / src;
    const onFrame = (t) => Math.round(t * fps) / fps;
    const title = { secno: '', text: scene.name, lead: '', seconds: 2, card: true, ...(scene.title || {}) };
    const end = { ...END_CARD, ...(scene.end || {}) };
    if (end.seconds < END_MIN - 1e-9) warnings.push(`the end card is held for ${end.seconds} s: at least ${END_MIN} s (3 s in the overview)`);
    const fileUrl = (file) => pathToFileURL(path.join(rawDir, file)).href;

    // ---- parts: the capture between its section cards. Part k runs from s0 to s1 in the track and from t0
    // to t1 in the film; the stretch of capture time in which the scene set up the next part between two
    // pictures was never filmed (the clock of the capture only runs while it films), so nothing is cut out
    // of a moving picture. A section card stands between two parts: the window leaves as at the end, the
    // card comes in as the end card does, is held complete for its `seconds`, and the window comes back.
    const sections = (track.sections || []).slice().sort((a, b) => a.t - b.t);
    const bounds = [0, ...sections.map((s) => tick(s.t)), tick(track.duration)];
    const parts = [];
    for (let i = 0; i < bounds.length - 1; i++) {
        const s0 = bounds[i];
        const s1 = bounds[i + 1];
        if (s1 - s0 < 1 / src - 1e-9) throw new Error(`${scene.name}: part ${i + 1} of the film is empty: film something after each d.section()`);
        let p0;
        if (i === 0) p0 = title.card === false ? 0 : onFrame(title.seconds);
        else {
            const s = sections[i - 1];
            const seconds = s.seconds === undefined ? SECTION_SECONDS : s.seconds;
            if (seconds < SECTION_MIN - 1e-9) warnings.push(`the section card "${s.secno || ''} ${s.text}" is held for ${seconds} s: at least ${SECTION_MIN} s, to read it`);
            p0 = onFrame(parts[i - 1].t1 + T.windowOut - T.overlap + T.endIn + seconds);
        }
        parts.push({ t0: p0, t1: p0 + (s1 - s0), s0, s1 });
    }
    const t0 = parts[0].t0;
    const t1 = parts[parts.length - 1].t1;
    const duration = onFrame(t1 + T.windowOut - T.overlap + T.endIn + end.seconds);
    /** The part a time of the track belongs to: a time on a boundary begins the next part, unless it ends something (`ending`). */
    const partOf = (t, ending = false) => {
        const at = tick(t);
        for (let i = parts.length - 1; i > 0; i--) if (ending ? at > parts[i].s0 + 1e-9 : at >= parts[i].s0 - 1e-9) return i;
        return 0;
    };
    /**
     * A time of the track to a time of the film (on the nanosecond, so that a press and the picture it
     * ends with get the very same time). `down`: the tick at or before t instead of the nearest.
     */
    const toFilm = (t, ending = false, down = false) => {
        const p = parts[partOf(t, ending)];
        const at = down ? Math.floor(t * src + 1e-6) / src : tick(t);
        return Math.round((p.t0 + at - p.s0) * 1e9) / 1e9;
    };

    // ---- camera: one key per beat that names a focus.
    const camera = [{ t: 0, dur: 0, ...WIDE, id: 'wide' }];
    const beats = [];
    for (const beat of track.beats) {
        if (beat.focus === undefined) continue;
        const cam = solveCamera(L, beat.focus, { pad: beat.pad, zoom: beat.zoom, minZoom: beat.minZoom, align: beat.align });
        const from = camera[camera.length - 1];
        const dur = beat.move === undefined || beat.move === null ? moveSeconds(from, cam, L) : beat.move;
        const lead = beat.lead || 0; // seconds the camera sets off before the beat's first action
        const own = parts[partOf(beat.t)];
        camera.push({ t: Math.max(0, toFilm(Math.max(own.s0, beat.t - lead))), dur, ...cam, id: beat.id });
        const source = (cam.z * L.w0) / L.view.dpr; // output px per capture px: 1 is 100 %
        beats.push({ id: beat.id, zoom: Math.round(cam.z * 100) / 100, source: Math.round(source * 1000) / 1000, move: dur });
        if (source > 1.0005) throw new Error(`${scene.name}: beat "${beat.id}" would show the capture at ${(source * 100).toFixed(0)} %: never above 100 %`);
        // The closest zoom is the one at which the capture is shown pixel for pixel (the build refuses more);
        // a push of less than 1.3x is too timid to be noticed as one.
        if (beat.focus && cam.z < 1.3) warnings.push(`beat "${beat.id}": a zoom of ${cam.z.toFixed(2)}x is hardly a push (1.3x at least)`);
        if (dur > 0 && (dur < 0.6 || dur > 0.9)) warnings.push(`beat "${beat.id}": the camera move takes ${dur} s (0.6 to 0.9 s is the house pace)`);
    }

    // ---- captions: a beat's caption stays until the next beat that sets one ('' clears it). A caption stands
    // on the paper band, and the band is there only while the camera is in: the pull back to the wide shot
    // ends the caption that is on.
    // A part's end ends its caption too.
    const captions = [];
    for (const beat of track.beats) {
        const at = toFilm(beat.t);
        const open = captions[captions.length - 1];
        const back = beat.focus === null;
        if ((beat.caption === undefined || beat.caption === null) && !back) continue;
        if (open && open.t1 === null) open.t1 = Math.min(at, parts[open.part].t1);
        if (!beat.caption) continue;
        if (back) throw new Error(`${scene.name}: beat "${beat.id}" goes to the wide shot and sets a caption: there is no band for it there`);
        if (beat.caption.includes(EM_DASH)) throw new Error(`${scene.name}: the caption "${beat.caption}" contains an em dash`);
        const words = wordCount(beat.caption);
        if (words > 8) warnings.push(`caption "${beat.caption}" has ${words} words (at most 8)`);
        captions.push({ t0: at, t1: null, text: beat.caption, html: richText(beat.caption), part: partOf(beat.t) });
    }
    for (const c of captions) {
        if (c.t1 === null) c.t1 = parts[c.part].t1;
        if (c.t1 - c.t0 < CAPTION_MIN - 1e-6) warnings.push(`caption "${c.text}" is on screen for ${(c.t1 - c.t0).toFixed(1)} s: ${CAPTION_MIN} s at least, to read it twice`);
    }

    // ---- callouts: at most one at a time.
    const callouts = track.callouts
        .map((c) => {
            const text = c.equations ? c.equations.map((row) => (Array.isArray(row) ? row[0] : row)).join(' ') : c.text;
            if (String(text).includes(EM_DASH)) throw new Error(`${scene.name}: the note "${text}" contains an em dash`);
            if (partOf(c.t0) !== partOf(c.t1, true)) throw new Error(`${scene.name}: the callout "${text}" runs across a section card`);
            // A note is 31.7 design px, numbered equations 41.7 (stage.css): neither may go under the brand's 28 for text that must be read.
            const design = (c.equations ? 41.7 : 31.7) * (c.size || 1);
            if (design < 28 - 1e-9) throw new Error(`${scene.name}: the callout "${text}" would be set at ${design.toFixed(1)} design px: 28 at least`);
            return { ...c, t0: onFrame(toFilm(c.t0)), t1: onFrame(toFilm(c.t1, true)), text, kind: c.equations ? 'equations' : 'note', html: c.equations ? aligned(c.equations) : richText(c.text) };
        })
        .sort((a, b) => a.t0 - b.t0);
    callouts.forEach((c, i) => {
        if (i > 0 && c.t0 < callouts[i - 1].t1) throw new Error(`${scene.name}: the callouts "${callouts[i - 1].text}" and "${c.text}" overlap: at most one at a time`);
    });

    // ---- the figures of the cards: pictures of the capture, cropped.
    const figureOf = (f) => {
        if (!f) return null;
        const label = f.label ? `<b>${esc(f.label)}</b> ` : '';
        if (String(f.text || '').includes(EM_DASH)) throw new Error(`${scene.name}: the caption "${f.text}" contains an em dash`);
        return { src: fileUrl(f.file), crop: f.rect, captionHtml: label + richText(f.text || '') };
    };
    const cardFigure = (which) => figureOf(track.cards && track.cards[which]);

    const shift = (list) =>
        list.map((item) => {
            const end = item.t1 === null || item.t1 === undefined ? track.duration : item.t1;
            if (partOf(item.t0) !== partOf(end, true)) throw new Error(`${scene.name}: a press or a held key runs across a section card`);
            return { ...item, t0: toFilm(item.t0), t1: toFilm(end, true) };
        });
    // The pointer, part by part: each part begins and ends with a sample of its own, so the hand neither
    // drifts towards the next part while the window leaves nor comes in from the last one.
    const samples = [];
    parts.forEach((p, i) => {
        const own = track.pointer.filter((s) => partOf(s.t) === i).map((s) => ({ t: toFilm(s.t), x: s.x, y: s.y }));
        if (!own.length) return;
        if (own[0].t > p.t0 + 1e-9) own.unshift({ ...own[0], t: p.t0 });
        const last = own[own.length - 1];
        if (last.t < p.t1 - 1e-9) own.push({ ...last, t: p.t1 });
        samples.push(...own);
    });
    const carded = title.card !== false;
    // The chip of each part: the film's title (or `scene.chip`, when the title card names the whole film),
    // then the title of each section.
    const first = scene.chip === false ? null : scene.chip && typeof scene.chip === 'object' ? { secno: scene.chip.secno || '', text: scene.chip.text } : title.text ? { secno: title.secno, text: title.text } : null;
    const chips = [first, ...sections.map((s) => (scene.chip === false ? null : { secno: s.secno || '', text: s.text }))];
    const chip = chips[0];
    for (const s of sections) {
        for (const text of [s.secno, s.text, s.lead]) if (String(text || '').includes(EM_DASH)) throw new Error(`${scene.name}: the section card "${text}" contains an em dash`);
        if (!s.figure) warnings.push(`the section card "${s.secno || ''} ${s.text}" has no figure (d.cardFigure('section', ...) after its first picture)`);
    }
    const film = {
        name: scene.name,
        width,
        height,
        fps,
        duration,
        layout: L,
        source: { fps: src },
        body: { t0, t1 },
        parts: parts.map((p) => ({ t0: p.t0, t1: p.t1 })),
        frames: track.frames.map((f) => ({ t: toFilm(f.t), src: fileUrl(f.file) })),
        camera,
        captions,
        callouts,
        pointer: {
            scale: scene.pointerScale || 1.7,
            samples,
            presses: shift(track.presses),
            keys: shift(track.keys),
        },
        chip,
        chips,
        title: { secno: title.secno, text: title.text, leadHtml: title.lead ? leadHtml(title.lead) : '', seconds: t0, figure: carded ? cardFigure('title') : null },
        sections: sections.map((s, i) => ({
            secno: s.secno || '',
            text: s.text,
            leadHtml: s.lead ? leadHtml(s.lead) : '',
            seconds: parts[i + 1].t0 - (parts[i].t1 + T.windowOut - T.overlap + T.endIn),
            figure: figureOf(s.figure),
        })),
        end: {
            title: end.title,
            rows: end.rows.map(([label, value]) => [label, Array.isArray(value) ? value.map(esc).join('<span class="step">›</span>') : esc(value)]),
            printHtml: end.print.map(esc).join('<span class="sep">·</span>'),
            seconds: end.seconds,
            figure: cardFigure('end'),
        },
        // Without a title card the running head carries the film's title: it is the chip of the wide shot.
        head: scene.head || (carded || !chip ? HEAD : { main: [`${chip.secno ? `${chip.secno} ` : ''}${chip.text}`, HEAD.main[0]], end: HEAD.end }),
        marks: { poster: null },
        report: { beats, warnings },
    };
    // The mark lies half a tick before the clock when it was set: the picture shown last, the tick before.
    if (track.marks && track.marks.poster !== undefined) film.marks.poster = settledAt(film, toFilm(track.marks.poster, false, true));
    for (const text of [title.text, title.lead, end.title, ...end.print, ...film.head.main, ...film.head.end]) {
        if (String(text).includes(EM_DASH)) throw new Error(`${scene.name}: "${text}" contains an em dash`);
    }
    return film;
}

/**
 * The poster is a settled frame. A scene marks it at the end of a hold, which is often where the
 * caption has begun to leave or a key is coming up: go back, a frame at a time and at most half a
 * second, to the last moment at which nothing is on its way in or out and the camera is at rest.
 */
export function settledAt(film, t) {
    const settled = (s) =>
        !s.cam.moving &&
        s.window.opacity === 1 &&
        s.window.drop === 0 &&
        (!s.caption || (s.caption.opacity === 1 && s.caption.dy === 0)) &&
        (!s.callout || (s.callout.opacity === 1 && s.callout.progress === 1)) &&
        (!s.pointer || !s.pointer.keycap || s.pointer.keycap.opacity === 1) &&
        (!s.pointer || s.pointer.ring === null);
    const step = 1 / film.fps;
    for (let back = 0; back <= 0.5 + 1e-9; back += step) {
        const at = Math.round((t - back) * film.fps) / film.fps;
        if (at >= 0 && settled(stateAt(film, at))) return at;
    }
    return t;
}

/**
 * Walk through the film frame by frame and measure what a viewer would notice if it were wrong:
 *   pointer.largestStep   px the pointer moves between two frames at most (a jump would be a teleport)
 *   pointer.offFrame      frames in which the pointer is shown outside the frame
 *   pointer.underBand     frames in which it is under the caption band
 *   camera.fastestZoom    the fastest zoom, as a factor per second, at the middle of the quickest move (a cubic
 *                         ease is one and a half times its average speed there)
 *   camera.moving         seconds the camera moves in all
 *   cadence               how many frames of the output each picture of a run of new pictures stays on, as
 *                         { frames: count }: { 2: 180 } at 60 frames per second from a capture of 30
 * Returns { pointer, camera, cadence, warnings }.
 */
export function inspectFilm(film) {
    const L = film.layout;
    const frames = Math.round(film.duration * film.fps);
    const pointer = { largestStep: 0, at: 0, offFrame: 0, underBand: 0 };
    const camera = { fastestZoom: 1, moving: 0 };
    const cadence = {};
    const per = film.fps / film.source.fps; // frames of the output per tick of the capture
    let before = null;
    let run = 0; // frames the picture on screen has been on
    for (let i = 0; i < frames; i++) {
        const t = i / film.fps;
        const s = stateAt(film, t);
        if (before) {
            const rate = Math.exp(Math.abs(Math.log(s.cam.z / before.cam.z)) * film.fps);
            if (rate > camera.fastestZoom) camera.fastestZoom = rate;
            if (s.cam.z !== before.cam.z || s.cam.tx !== before.cam.tx || s.cam.ty !== before.cam.ty) camera.moving += 1 / film.fps;
            if (s.frame !== before.frame) {
                // Only pictures of a moving stretch count: one that stood for longer is a hold, not a beat of the cadence.
                if (run <= per * 1.5 + 1e-9) cadence[run] = (cadence[run] || 0) + 1;
                run = 1;
            } else run++;
        } else run = 1;
        // While the window slides onto the page or off it, the pointer comes and goes with it.
        const p = s.pointer && s.pointer.opacity > 0.5 && s.window.drop === 0 ? s.pointer : null;
        if (p) {
            if (p.x < 0 || p.x > L.width - 4 || p.y < 0 || p.y > L.height - 4) pointer.offFrame++;
            else if (p.y > L.bandSolid && s.band > 0.5) pointer.underBand++;
            const q = before && before.pointer && before.pointer.opacity > 0.5 && before.window.drop === 0 ? before.pointer : null;
            if (q) {
                const step = Math.hypot(p.x - q.x, p.y - q.y);
                if (step > pointer.largestStep) Object.assign(pointer, { largestStep: Math.round(step * 10) / 10, at: Math.round(t * 100) / 100 });
            }
        }
        before = s;
    }
    camera.fastestZoom = Math.round(camera.fastestZoom * 100) / 100;
    camera.moving = Math.round(camera.moving * 100) / 100;
    const warnings = [];
    // A fast glide during a pan across the frame is about 90 px per frame at 60 frames per second; a jump is far more.
    if (pointer.largestStep > 9600 / film.fps) warnings.push(`the pointer moves ${pointer.largestStep} px in one frame at ${pointer.at} s: it jumps`);
    if (pointer.offFrame) warnings.push(`the pointer is outside the frame for ${pointer.offFrame} frames`);
    if (pointer.underBand) warnings.push(`the pointer is under the caption band for ${pointer.underBand} frames`);
    if (Number.isInteger(per)) {
        const odd = Object.keys(cadence).filter((n) => Number(n) !== per);
        if (odd.length) warnings.push(`uneven cadence: pictures of a moving stretch stay for ${JSON.stringify(cadence)} frames, expected ${per} each`);
    }
    return { pointer, camera, cadence, warnings };
}

/**
 * The moments of a film worth a close look at full size: the cards, the first press, every callout, the
 * poster. At most eight, and at most twelve when the film has section cards (each card is kept).
 */
export function reviewMoments(film) {
    const moments = [];
    if (film.body.t0 > 0) moments.push({ name: 'title', t: Math.min(film.body.t0 - 0.4, 1.2), keep: true });
    else moments.push({ name: 'open', t: 0, keep: true });
    const parts = film.parts || [film.body];
    (film.sections || []).forEach((s, i) => {
        if (parts[i + 1]) moments.push({ name: `section-${i + 1}`, t: parts[i + 1].t0 - TIMING.titleLead - 0.2, keep: true });
    });
    const press = film.pointer.presses[0];
    if (press) moments.push({ name: 'drag', t: (press.t0 + press.t1) / 2 });
    film.callouts.forEach((c, i) => moments.push({ name: `callout-${i + 1}`, t: Math.min(c.t1 - 0.4, c.t0 + 0.9) }));
    if (film.marks.poster !== null && film.marks.poster !== undefined) moments.push({ name: 'poster', t: film.marks.poster });
    moments.push({ name: 'end', t: film.duration - 0.3, keep: true });
    const fixed = moments.filter((m) => m.t >= 0 && m.t < film.duration).sort((a, b) => a.t - b.t);
    const most = film.sections && film.sections.length ? 12 : 8;
    while (fixed.length > most) {
        const free = fixed.map((m, i) => (m.keep ? -1 : i)).filter((i) => i >= 0);
        fixed.splice(free[Math.floor((free.length - 1) / 2)], 1);
    }
    return fixed.map(({ name, t }) => ({ name, t }));
}
