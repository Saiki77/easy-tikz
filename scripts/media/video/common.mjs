/* eslint-env browser, node */
/* global app */
// Shared by the video scenarios in this folder and by ../build-video.mjs.
//
// A scenario is a module with a default export:
//
//   export default {
//       name: 'clip-drag',                 // file name of the outputs in docs/media
//       title: 'Drag to edit',             // one line for the build log
//       frame: 'editor',                   // what is filmed: 'window' | 'editor' | { note: { height } }
//       seconds: [6, 14],                  // the length the clip must have
//       async setup(d) { ... },            // not filmed: open the editor, load the chart, write notes
//                                          // (d.obs.blur() after opening the editor: nothing holds the keyboard
//                                          // focus, so no focus ring is drawn on a button of the header)
//       async run(d) { ... },              // filmed: captions, real mouse and keyboard input, pauses
//   };
//
// `d` is the director made by createDirector(): the toolkit recorder plus
// the pacing rules every clip follows (the pointer glides, a result is held
// for a moment, a menu or a dialog is filmed only once it is fully open) and
// the checks that keep a clip honest (expect(), no status chip, no console
// error). Everything a scenario does goes through real input events, so the
// app does the real thing; a scenario never sets a value behind its back.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRecorder } from '../lib/record.mjs';

const run = promisify(execFile);

/** Fullscreen content size of a 16 inch MacBook Pro; every capture is laid out at this size, at 2x. */
export const WINDOW = { width: 1728, height: 1117 };
export const FPS = 30;
/** A GIF may be this large at most (bytes). */
export const GIF_BUDGET = 6 * 1024 * 1024;

const EDITOR = '.modal.tikz-modal';

/** Selectors and targets of the real UI, found by class or by visible text. */
export const ui = {
    editor: EDITOR,
    ribbon: '.side-dock-ribbon-action[aria-label="Easy TikZ"]',
    add: `${EDITOR} .etz-build-add`,
    startInput: `${EDITOR} .etz-build-start input`,
    quickfix: `${EDITOR} .etz-build-start .mod-quickfix`,
    insert: `${EDITOR} .etz-actionbar .mod-cta`,
    undo: { selector: `${EDITOR} .etz-undo button`, text: 'Undo' },
    menu: '.menu',
    tab: (text) => ({ selector: `${EDITOR} .etz-tab`, text }),
    menuItem: (text) => ({ selector: '.menu .menu-item', text }),
    /** An example tile of the empty state, by its title. `at` avoids the thumbnail's own hover target. */
    example: (title) => ({ exampleTitle: title }),
    /** A slider's play button in the Sliders dock (the same button pauses). */
    play: (name) => `${EDITOR} .etz-dock button[aria-label="Play ${name}"]`,
};

/** A deep copy, so a scenario can change a chart without touching the plugin's EXAMPLES. */
export const clone = (value) => JSON.parse(JSON.stringify(value));

function fail(message) {
    throw new Error(message);
}

/**
 * Page side of d.lens(): an enlarged, live copy of the editor's hover tip
 * (`.etz-drag-hint`), shown in the top right of the preview. The tip itself
 * is 11 and 13 px text in a corner, which nobody can read in a GIF of the
 * README. The copy is a clone of the real element, kept in step with it by
 * a MutationObserver (text, highlighted numbers, hidden or shown), inside
 * the same parent so it has the same styles; only its size and place differ.
 */
function lensHooks(scale) {
    if (window.__etzLens) window.__etzLens.remove();
    const m = window.__etzMedia.editor();
    const source = m ? m.modalEl.querySelector('.etz-drag-hint') : null;
    const stage = source ? source.parentElement : null;
    if (!source || !stage) return false;
    const holder = document.createElement('div');
    holder.id = 'etz-media-lens';
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText =
        'position: absolute; right: 26px; top: 58px; z-index: 40; display: none; pointer-events: none; padding: 3px; border-radius: 14px; ' +
        'background: var(--background-primary); box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.95), 0 16px 34px -12px rgba(15, 23, 42, 0.4);';
    stage.appendChild(holder);
    const sync = () => {
        const shown = !source.classList.contains('tikz-hidden') && (source.textContent || '').trim().length > 0;
        holder.style.display = shown ? 'block' : 'none';
        if (!shown) return;
        const copy = source.cloneNode(true);
        copy.removeAttribute('id');
        copy.classList.remove('is-docked');
        copy.style.cssText = `position: static; max-width: none; zoom: ${scale}; box-shadow: none; border-color: transparent; background: transparent;`;
        holder.replaceChildren(copy);
    };
    const observer = new MutationObserver(sync);
    observer.observe(source, { attributes: true, childList: true, characterData: true, subtree: true });
    sync();
    window.__etzLens = {
        remove() {
            observer.disconnect();
            holder.remove();
            delete window.__etzLens;
        },
    };
    return true;
}

/** Captions are plain and short: they must fit the bar and be read in the time they show. */
function checkCaption(text) {
    if (!text) return;
    if (text.includes(String.fromCharCode(0x2014))) fail(`caption contains an em dash (U+2014): "${text}"`);
    if (text.length > 62) fail(`caption is longer than 62 characters (${text.length}): "${text}"`);
}

/**
 * The rectangle a scenario films, in CSS px of the 1728 x 1117 page.
 *   'window'             the whole app (the last pixel row is dropped: H.264 needs even sizes)
 *   'editor'             the editor modal with a 12 px margin, down to the bottom of the window:
 *                        the band under the editor holds the caption bar, so it covers no button
 *   { note: { height } } the text column of the open note with a margin, `height` px tall from below the view header
 */
export async function resolveFrame(obs, frame) {
    if (frame === 'window') return { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height - 1 };
    if (frame === 'editor') {
        const r = await obs.clipRect('editor');
        if (!r) fail('frame "editor": the editor is not open (open it in setup)');
        const x = Math.floor(r.x) - 12;
        const y = Math.floor(r.y) - 12;
        return { x, y, width: Math.ceil(r.width) + 24, height: WINDOW.height - 1 - y };
    }
    if (frame && frame.note) {
        const r = await obs.clipRect('page');
        if (!r) fail('frame "note": no note is open (open it in setup)');
        const margin = frame.note.margin === undefined ? 100 : frame.note.margin;
        const top = frame.note.top === undefined ? 92 : frame.note.top;
        const even = (n) => Math.round(n / 2) * 2;
        return { x: Math.floor(r.x) - margin, y: top, width: even(r.width + 2 * margin), height: even(frame.note.height || 780) };
    }
    return fail(`unknown frame ${JSON.stringify(frame)}`);
}

/**
 * Put the app into a known state between scenarios: no editor, no menu, no
 * held key or button, no draft, an empty tab in the main area, the pointer
 * parked, no recorded console error.
 */
export async function resetApp(obs) {
    for (const name of ['Shift', 'Alt', 'Meta', 'Control']) await obs.keyUp(name);
    if (obs.mouse.buttons & 1) await obs.mouse.up();
    // Escape closes an open menu (with no menu open it would close the editor, which goes next anyway).
    if (await obs.call(() => !!document.querySelector('.menu'))) await obs.key('Escape');
    await obs.closeEditor().catch(() => {});
    await obs.clearDraft();
    await obs.call(async () => {
        // The notes of an earlier scenario leave the main area: their tabs show the empty view again.
        // (Detaching the last tab instead would leave the window without a tab group.)
        for (const leaf of app.workspace.getLeavesOfType('markdown')) await leaf.setViewState({ type: 'empty', state: {} });
    });
    await obs.mouse.move({ x: 2, y: 2 });
    await obs.sleep(150);
    await obs.waitForRender();
    obs.clearErrors();
}

/**
 * The director of one scenario.
 *   obs          the session (lib/obsidian.mjs)
 *   scenario     the scenario module's default export
 *   framesDir    where the frame PNGs go
 *   charts       { lp, areas, tangent, levels, surplus, plane3d }: the plugin's own examples (deep copies)
 *   chartBlock   (data) => the fenced easy-tikz block for a note
 */
export async function createDirector(obs, scenario, { framesDir, charts, chartBlock, say = () => {} }) {
    const d = { obs, charts, chartBlock, ui, clone, captions: [], posterFrame: null, allowChip: false };
    let rec = null;

    /** Runs once after setup(): from here on every step is filmed. */
    d.start = async () => {
        const clip = await resolveFrame(obs, scenario.frame);
        rec = await createRecorder(obs, {
            dir: framesDir,
            fps: FPS,
            clip,
            cursorScale: 1.5,
            caption: { position: 'bottom', margin: 9, size: 26 },
            keepFrames: true,
        });
        d.rec = rec;
        d.clip = clip;
    };

    /** Fail the scenario: a clip that does not show what its caption says is not published. */
    d.expect = (condition, message) => {
        if (!condition) fail(`${scenario.name}: ${message}`);
    };

    /** No status chip (a problem with the chart) and no console error may be on screen while filming. */
    d.check = async () => {
        if (obs.errors.length) fail(`${scenario.name}: console error: ${obs.errors[0].text}`);
        if (d.allowChip) return;
        const chip = await obs.statusChip();
        if (chip) fail(`${scenario.name}: the status chip shows "${chip}"`);
    };

    /** Set the caption bar ('' hides it). */
    d.caption = async (text) => {
        checkCaption(text);
        d.captions.push({ at: rec.seconds, text });
        await rec.caption(text);
    };

    /** Let the picture become final, then show it for `seconds`. */
    d.hold = async (seconds = 0.6) => {
        await obs.waitForRender();
        await d.check();
        await rec.hold(seconds);
    };

    /** Resolve a target; ui.example(title) is the tile with that title. */
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
            if (!p) fail(`${scenario.name}: no example tile "${target.exampleTitle}"`);
            return p;
        }
        return obs.point(target);
    };

    /** Glide the pointer to a target. */
    d.move = async (target, { seconds = 0.7 } = {}) => {
        await rec.move(await d.point(target), { seconds });
    };

    /**
     * Glide to a target and click it. The result is filmed only once it is
     * final: `until` (an async function) waits for what the click opens.
     *   count    2 double-clicks (selects a word in a field)
     *   settle   false: do not wait for the chart to come to rest (a click on play starts an animation)
     */
    d.click = async (target, { seconds = 0.7, pause = 0.6, until = null, count = 1, settle = true } = {}) => {
        if (target) await d.move(target, { seconds });
        await rec.hold(0.15);
        for (let i = 1; i <= count; i++) {
            await obs.mouse.down(null, { clickCount: i });
            await rec.frame(i === count ? 4 : 2);
            await obs.mouse.up(null, { clickCount: i });
        }
        if (until) await until();
        await obs.sleep(80);
        if (settle) {
            await obs.waitForRender();
            await d.check();
        }
        if (pause > 0) await rec.hold(pause);
    };

    /** Park the pointer somewhere calm without filming the way there (use in setup). */
    d.park = async (target) => {
        await obs.mouse.move(await d.point(target));
    };

    const hintShown = () =>
        obs.call(() => {
            const m = window.__etzMedia.editor();
            const el = m ? m.modalEl.querySelector('.etz-drag-hint') : null;
            return !!el && !el.classList.contains('tikz-hidden') && (el.textContent || '').trim().length > 0;
        });

    /** Rest the pointer on a shape of the 2D preview until its tip shows, then hold. Returns the tip's text. */
    d.rest = async (target, { seconds = 0.7, pause = 0.8 } = {}) => {
        await d.move(target, { seconds });
        await obs.waitFor(hintShown, { timeout: 2000, interval: 40, message: 'the hover tip' });
        await obs.frames(2);
        await rec.hold(pause);
        return (await obs.editorState()).hint;
    };

    /** A complete drag along a path of targets (math coordinates in the 2D preview). */
    d.drag = async (pathTargets, { seconds = 1.4, approach = 0.7, shift = false, alt = false, pause = 0.7 } = {}) => {
        await rec.drag(pathTargets, { seconds, approach, shift, alt, settle: 0 });
        await d.hold(pause);
    };

    /** Start a drag and keep the button (and Shift) down: continue with dragTo(), finish with dragEnd(). */
    d.dragStart = async (pathTargets, { seconds = 1.2, approach = 0.7, shift = false } = {}) => {
        await rec.drag(pathTargets, { seconds, approach, shift, hold: true });
    };
    d.dragTo = async (target, { seconds = 1.0 } = {}) => {
        const steps = Math.max(1, Math.round(seconds * FPS));
        await obs.mouse.move(await d.point(target), {
            steps,
            onStep: async () => {
                await obs.frames(1);
                await rec.frame();
            },
        });
    };
    /** Show the picture during a drag for `seconds` (the button stays down). */
    d.dragHold = async (seconds = 0.6) => {
        await obs.frames(2);
        await rec.hold(seconds);
    };
    d.dragEnd = async ({ pause = 0.7 } = {}) => {
        await obs.mouse.up();
        await obs.keyUp('Shift');
        await obs.keyUp('Alt');
        await d.hold(pause);
    };

    /** Drag a slider's thumb with the mouse: in the Sliders dock, or { scope: 'note' } in a note's strip. */
    d.slider = async (name, value, { seconds = 1.3, approach = 0.7, scope = 'editor', pause = 0.5 } = {}) => {
        await rec.slider(name, value, { seconds, approach, scope, settle: 0 });
        await d.hold(pause);
    };

    /** Type into the focused field. */
    d.type = async (text, { cps = 9 } = {}) => {
        await rec.type(text, { cps });
    };

    /** Press a key; the result is held for `pause` seconds. */
    d.key = async (name, mods = {}, { pause = 0.4 } = {}) => {
        await obs.key(name, mods);
        await obs.sleep(80);
        await d.hold(pause);
    };

    /**
     * Film `seconds` of real time, for something that runs on its own clock
     * (slider play). A capture takes longer than one frame, so each one is
     * shown for as many frames as real time went by: the speed is true, the
     * motion has fewer steps (about 12 to 18 per second).
     */
    d.realtime = async (seconds) => {
        const total = Math.max(1, Math.round(seconds * FPS));
        const begin = Date.now();
        let done = 0;
        let cost = 70;
        while (done < total) {
            const t = Date.now();
            const due = Math.round(((t - begin + cost) * FPS) / 1000);
            const n = Math.min(total - done, Math.max(1, due - done));
            await rec.frame(n);
            cost = 0.6 * cost + 0.4 * (Date.now() - t);
            done += n;
        }
    };

    /**
     * Show (or remove) an enlarged live copy of the hover tip in the top
     * right of the preview: see lensHooks. The copy follows the real tip
     * through hover and drag, and is gone whenever the tip is.
     */
    d.lens = async (on = true, { scale = 2.1 } = {}) => {
        if (on) d.expect(await obs.call(lensHooks, scale), 'd.lens: the editor is not open');
        else await obs.call(() => window.__etzLens && window.__etzLens.remove());
    };

    /** The frame shown last becomes the poster of the clip. */
    d.poster = () => {
        d.posterFrame = rec.frames;
    };

    d.finish = async () => {
        await d.check();
        const [min, max] = scenario.seconds;
        const s = rec.seconds;
        if (s < min || s > max) fail(`${scenario.name}: the clip is ${s.toFixed(1)} s long, it should be ${min} to ${max} s`);
        say(`${scenario.name}: ${rec.frames} frames, ${s.toFixed(1)} s`);
    };

    d.close = async () => {
        await obs.call(() => window.__etzLens && window.__etzLens.remove()).catch(() => {});
        if (rec) await rec.close();
    };

    return d;
}

// --------------------------------------------------------------- encoding

const frameInput = (dir) => ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-start_number', '1', '-i', path.join(dir, 'frame-%06d.png')];

/**
 * Write a GIF of the frames in `dir` that stays within the size budget.
 * The settings get coarser step by step until the file fits; the first
 * that fits is kept. Returns { file, bytes, width, fps, colors }.
 */
export async function encodeGif(dir, file, { width = 960, budget = GIF_BUDGET, ladder = null } = {}) {
    const steps = ladder || [
        { fps: 20, colors: 256, width },
        { fps: 15, colors: 256, width },
        { fps: 15, colors: 128, width },
        { fps: 12, colors: 128, width },
        { fps: 10, colors: 128, width },
        { fps: 10, colors: 64, width },
        { fps: 10, colors: 64, width: Math.round(width * 0.84) },
        { fps: 8, colors: 64, width: Math.round(width * 0.75) },
    ];
    let last = null;
    for (const step of steps) {
        // The palette is built from the whole clip (stats_mode=full) and applied without dithering: flat UI
        // colours stay flat, which is what keeps a screen recording small and free of dither noise.
        const chain = `fps=${step.fps},scale=${step.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${step.colors}:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
        await run('ffmpeg', [...frameInput(dir), '-filter_complex', chain, '-loop', '0', file], { maxBuffer: 1 << 26 });
        last = { file, bytes: fs.statSync(file).size, ...step };
        if (last.bytes <= budget) return last;
    }
    return last;
}

/**
 * Review sheets: frames taken every `every` seconds as 900 px tiles, two
 * columns by three rows per PNG, so captions stay readable when the sheet
 * is looked at. Returns the files written.
 */
export async function reviewSheets(dir, outBase, frames, { every = 0.75, tile = 900 } = {}) {
    const step = Math.max(1, Math.round(every * FPS));
    const picks = [];
    for (let n = 1; n <= frames; n += step) picks.push(n);
    if (picks[picks.length - 1] !== frames) picks.push(frames);
    const files = [];
    for (let i = 0; i * 6 < picks.length; i++) {
        const part = picks.slice(i * 6, i * 6 + 6);
        const file = `${outBase}-review-${String(i + 1).padStart(2, '0')}.png`;
        const args = ['-hide_banner', '-loglevel', 'error', '-y'];
        for (const n of part) args.push('-i', path.join(dir, `frame-${String(n).padStart(6, '0')}.png`));
        const scaled = part.map((_, k) => `[${k}:v]scale=${tile}:-1:flags=lanczos[s${k}]`).join(';');
        const rows = Math.ceil(part.length / 2);
        const layout = `${scaled};${part.map((_, k) => `[s${k}]`).join('')}concat=n=${part.length}:v=1:a=0,tile=2x${rows}:padding=8:margin=8:color=0x808080`;
        await run('ffmpeg', [...args, '-filter_complex', layout, '-frames:v', '1', '-update', '1', file], { maxBuffer: 1 << 26 });
        files.push(file);
    }
    return files;
}

/**
 * Write the poster of a clip: the frame at its full 2x size, with a
 * palette of 256 colours and no dithering. A screen recording has few
 * colours, so the picture looks the same and the file is about a third.
 */
export async function writePoster(frame, file) {
    await run('magick', [frame, '-strip', '-dither', 'None', '-colors', '256', '-define', 'png:compression-level=9', '-define', 'png:exclude-chunks=date,time', `PNG8:${file}`]);
    return fs.statSync(file).size;
}

/** Width, height and duration of a video or image file (ffprobe). */
export async function probe(file) {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames,r_frame_rate:format=duration', '-of', 'json', file]);
    const info = JSON.parse(stdout);
    const stream = (info.streams || [])[0] || {};
    return { width: stream.width, height: stream.height, seconds: info.format && info.format.duration ? Number(info.format.duration) : null };
}
