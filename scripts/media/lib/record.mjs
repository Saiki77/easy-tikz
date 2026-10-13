/* eslint-env browser, node */
// Deterministic frame recorder for the isolated Obsidian (lib/obsidian.mjs).
//
// A scenario is an async function that performs small steps and calls
// frame() after each: every frame is one tick of a fixed logical clock
// (30 fps), however long the capture took. Nothing is filmed in real time,
// so a recording is the same on a slow and a fast machine.
//
//   const rec = await createRecorder(obs, { dir: 'out/frames-demo', clip: 'editor', padding: 24 });
//   await rec.caption('Drag the objective line');
//   await rec.move([1.5, 2], { seconds: 0.6 });
//   await rec.drag([[1.5, 2], [2.1, 2.4]], { seconds: 1.2 });
//   await rec.hold(0.8);
//   const files = await rec.encode({ out: 'out/demo' });   // demo.mp4, demo.gif, demo-sheet.png, demo-poster.png
//   await rec.close();
//
// The real mouse pointer is not part of a capture, so the recorder draws a
// pointer in the page and moves it with every scripted mouse event. The
// caption bar is drawn in the page too. Both are removed by close().
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Page side: the pointer and the caption bar. Plain DOM, removed again by remove(). */
function overlayHooks(options) {
    if (window.__etzOverlay) window.__etzOverlay.remove();
    const NS = 'http://www.w3.org/2000/svg';
    const root = document.createElement('div');
    root.id = 'etz-media-overlay';
    root.setAttribute('aria-hidden', 'true');
    const style = document.createElement('style');
    style.textContent = `
#etz-media-overlay { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; overflow: hidden; }
#etz-media-overlay .etz-media-cursor { position: absolute; left: 0; top: 0; width: 0; height: 0; display: none; }
#etz-media-overlay .etz-media-cursor svg { position: absolute; left: 0; top: 0; overflow: visible; filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.35)); }
#etz-media-overlay .etz-media-ring { position: absolute; left: -15px; top: -15px; width: 30px; height: 30px; border-radius: 50%;
  background: rgba(64, 132, 255, 0.22); border: 2px solid rgba(64, 132, 255, 0.85); box-sizing: border-box; display: none; }
#etz-media-overlay .etz-media-cursor.is-down .etz-media-ring { display: block; }
#etz-media-overlay .etz-media-caption { position: absolute; display: none; transform: translateX(-50%); width: max-content;
  padding: 0.5em 1.1em; border-radius: 0.6em; background: rgba(20, 24, 32, 0.92); color: #ffffff;
  font: 600 22px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; letter-spacing: 0.005em;
  text-align: center; text-wrap: balance; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28); }
#etz-media-overlay .etz-media-caption.is-shown { display: block; }
`;
    root.appendChild(style);

    const cursor = document.createElement('div');
    cursor.className = 'etz-media-cursor';
    const ring = document.createElement('div');
    ring.className = 'etz-media-ring';
    cursor.appendChild(ring);
    const svg = document.createElementNS(NS, 'svg');
    const size = 24 * options.cursorScale;
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    const arrow = document.createElementNS(NS, 'path');
    // Arrow pointer with its tip at (0, 0).
    arrow.setAttribute('d', 'M0.6 0.6 L0.6 17.4 L5.1 13.3 L8.2 20.4 L11 19.2 L7.9 12.2 L14 12.2 Z');
    arrow.setAttribute('fill', '#111111');
    arrow.setAttribute('stroke', '#ffffff');
    arrow.setAttribute('stroke-width', '1.3');
    arrow.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(arrow);
    cursor.appendChild(svg);
    root.appendChild(cursor);

    const caption = document.createElement('div');
    caption.className = 'etz-media-caption';
    root.appendChild(caption);
    document.body.appendChild(root);

    window.__etzOverlay = {
        cursor(x, y, down, shown) {
            cursor.style.display = shown ? 'block' : 'none';
            cursor.style.transform = `translate(${x}px, ${y}px)`;
            cursor.classList.toggle('is-down', !!down);
        },
        /** Text in the caption bar ('' hides it), centred at (cx, y) with the given font size. */
        caption(text, cx, y, fontSize, fromBottom, maxWidth) {
            caption.textContent = text || '';
            caption.classList.toggle('is-shown', !!text);
            caption.style.fontSize = `${fontSize}px`;
            caption.style.maxWidth = `${maxWidth}px`;
            caption.style.left = `${cx}px`;
            if (fromBottom) {
                caption.style.top = 'auto';
                caption.style.bottom = `${window.innerHeight - y}px`;
            } else {
                caption.style.bottom = 'auto';
                caption.style.top = `${y}px`;
            }
        },
        remove() {
            root.remove();
            delete window.__etzOverlay;
        },
    };
    return true;
}

function ffmpegError(e, what) {
    const tail = String(e.stderr || e.message || e).trim().split('\n').slice(-6).join('\n');
    return new Error(`ffmpeg failed while writing ${what}:\n${tail}`);
}

/** Even pixel sizes for H.264. */
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Start a recording.
 *   dir        folder for the frame PNGs (emptied first; removed after encode unless keepFrames)
 *   fps        logical frame rate (default 30)
 *   clip       what to film: as for obs.screenshot ('window', 'editor', 'stage', selector, rect). Resolved once: every frame has the same size.
 *   padding    px around the clip
 *   scale      frame scale relative to the 2x capture (default 1; 0.5 films at 1x and is about twice as fast)
 *   cursor     true (default): draw the pointer; cursorScale (default 1.25) sizes it
 *   caption    { position: 'bottom' | 'top', margin: px from the clip edge, size: font px } or false
 */
export async function createRecorder(obs, { dir, fps = 30, clip = 'window', padding = 0, scale = 1, cursor = true, cursorScale = 1.25, caption = {}, keepFrames = false } = {}) {
    if (!dir) throw new Error('createRecorder: dir is required');
    dir = path.resolve(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const captionOptions = caption === false ? null : { position: 'bottom', margin: 28, size: 22, ...caption };
    await obs.call(overlayHooks, { cursorScale });

    let rect = null;
    async function setClip(nextClip, nextPadding = padding) {
        const r = await obs.clipRect(nextClip);
        if (!r) throw new Error(`recorder: nothing to film for clip ${JSON.stringify(nextClip)}`);
        const view = await obs.call(() => ({ w: window.innerWidth, h: window.innerHeight }));
        const [px, py] = Array.isArray(nextPadding) ? nextPadding : [nextPadding, nextPadding];
        const x0 = Math.max(0, Math.floor(r.x - px));
        const y0 = Math.max(0, Math.floor(r.y - py));
        const x1 = Math.min(view.w, Math.ceil(r.x + r.width + px));
        const y1 = Math.min(view.h, Math.ceil(r.y + r.height + py));
        const next = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        if (rect && count > 0 && (next.width !== rect.width || next.height !== rect.height)) {
            throw new Error('recorder: the clip size cannot change after the first frame (all frames of a video have one size)');
        }
        rect = next;
    }

    let count = 0;
    let captionText = '';
    const captions = [];
    let cursorShown = !!cursor;
    const frameFile = (n) => path.join(dir, `frame-${String(n).padStart(6, '0')}.png`);

    const drawCursor = ({ x, y, buttons }) => obs.call((cx, cy, down, shown) => window.__etzOverlay && window.__etzOverlay.cursor(cx, cy, down, shown), x, y, buttons & 1, cursorShown);
    obs.mouse.listeners.add(drawCursor);
    await setClip(clip);
    await drawCursor(obs.mouse);

    /** Capture the screen as the next frame; `repeat` shows it for that many frames in total. */
    async function frame(repeat = 1) {
        await obs.frames(1);
        const params = { format: 'png', clip: { ...rect, scale }, captureBeyondViewport: false, optimizeForSpeed: true };
        const r = await obs.cdp.send('Page.captureScreenshot', params, { timeout: 20000 });
        const first = frameFile(++count);
        fs.writeFileSync(first, Buffer.from(r.data, 'base64'));
        for (let i = 1; i < Math.round(repeat); i++) fs.linkSync(first, frameFile(++count));
    }
    /** Show the current screen for `seconds` (one capture, repeated). Use live() when something is animating. */
    const hold = (seconds) => frame(Math.max(1, Math.round(seconds * fps)));
    /** Film `seconds` of real time (slider play, transitions): one capture every 1 / fps seconds. */
    async function live(seconds) {
        const n = Math.max(1, Math.round(seconds * fps));
        const start = Date.now();
        for (let i = 0; i < n; i++) {
            const due = start + (i * 1000) / fps;
            const wait = due - Date.now();
            if (wait > 0) await obs.sleep(wait);
            await frame();
        }
    }

    /** Set the caption bar ('' or null hides it). Does not take a frame. */
    async function setCaption(text) {
        if (!captionOptions) return;
        captionText = text || '';
        captions.push({ frame: count + 1, text: captionText });
        const bottom = captionOptions.position !== 'top';
        const y = bottom ? rect.y + rect.height - captionOptions.margin : rect.y + captionOptions.margin;
        await obs.call(
            (t, cx, cy, size, fromBottom, maxWidth) => window.__etzOverlay.caption(t, cx, cy, size, fromBottom, maxWidth),
            captionText,
            rect.x + rect.width / 2,
            y,
            captionOptions.size,
            bottom,
            Math.round(rect.width * 0.86)
        );
    }
    async function showCursor(shown) {
        cursorShown = !!shown;
        await drawCursor(obs.mouse);
    }

    const stepsFor = (seconds) => Math.max(1, Math.round(seconds * fps));
    const onStep = () => frame();

    /** Glide the pointer to a target (see obs.point) over `seconds`, one frame per step. */
    async function move(target, { seconds = 0.6 } = {}) {
        await obs.mouse.move(target, { steps: stepsFor(seconds), onStep });
    }
    /** Move to a target, press (the pointer shows a ring), release. `pause` seconds are held before and after. */
    async function click(target, { seconds = 0.6, count: clicks = 1, pause = 0.2 } = {}) {
        if (target) await move(target, { seconds });
        for (let i = 1; i <= clicks; i++) {
            await obs.mouse.down(null, { clickCount: i });
            await frame(Math.max(2, Math.round(0.1 * fps)));
            await obs.mouse.up(null, { clickCount: i });
        }
        await obs.sleep(60);
        await hold(pause);
    }
    /**
     * Drag along a path of targets over `seconds` (see obs.mouse.drag):
     * glide to the start, press, move with one frame per step, release.
     */
    async function drag(pathTargets, { seconds = 1.2, approach = 0.5, shift = false, alt = false, hold: keep = false, settle = 0.3 } = {}) {
        await move(pathTargets[0], { seconds: approach });
        if (shift) {
            // Show what Shift does before the press: the pivot ring and the tip.
            await obs.keyDown('Shift');
            await obs.sleep(120);
            await hold(0.5);
        }
        await obs.mouse.drag(pathTargets, { steps: stepsFor(seconds), alt, hold: true, onStep });
        if (keep) return;
        await obs.mouse.up();
        if (alt) await obs.keyUp('Alt');
        if (shift) await obs.keyUp('Shift');
        await obs.waitForRender();
        await hold(settle);
    }
    /** Drag a slider's thumb to `value` with the mouse: { scope: 'note' } for the strip under a chart in a note. */
    async function slider(name, value, { seconds = 1.2, approach = 0.5, scope = 'editor', chart = 0, settle = 0.3 } = {}) {
        const from = { slider: name, scope, chart };
        const to = await obs.point({ slider: name, value, scope, chart });
        await move(from, { seconds: approach });
        await obs.mouse.down();
        await frame();
        await obs.mouse.move(to, { steps: stepsFor(seconds), onStep });
        await obs.mouse.up();
        await obs.waitForRender({ settle: scope === 'note' ? 220 : 0 });
        await hold(settle);
    }
    /** Type into the focused field at `cps` characters per second, filming as the text grows. */
    async function type(text, { cps = 14 } = {}) {
        const perChar = fps / cps;
        let owed = 0;
        await obs.type(text, {
            onChar: async () => {
                owed += perChar;
                const n = Math.floor(owed);
                owed -= n;
                if (n > 0) await frame(n);
            },
        });
    }
    /** Press a key and film the result. */
    async function key(name, mods = {}, { pause = 0.3 } = {}) {
        await obs.key(name, mods);
        await obs.sleep(60);
        await hold(pause);
    }

    /**
     * Encode what was filmed.
     *   out        path without extension: writes <out>.mp4, <out>.gif, <out>-sheet.png, <out>-poster.png
     *   mp4, gif, sheet, poster   switch single outputs off with false
     *   mp4Width   width of the MP4 (default: the frame width)
     *   crf        H.264 quality (default 20; lower is better and bigger)
     *   gifWidth   default 960; gifFps default 15; gifColors default 256; gifDither default 'bayer:bayer_scale=5'
     *   sheetColumns x sheetRows   tiles of the contact sheet (default 5 x 4, evenly spread over the recording)
     *   posterFrame   1-based frame number, 'first', 'middle' or 'last' (default)
     * Returns { frames, seconds, mp4, gif, sheet, poster, bytes: { mp4, gif } }.
     */
    async function encode({ out, mp4 = true, gif = true, sheet = true, poster = true, mp4Width = null, crf = 20, gifWidth = 960, gifFps = 15, gifColors = 256, gifDither = 'bayer:bayer_scale=5', sheetColumns = 5, sheetRows = 4, posterFrame = 'last' } = {}) {
        if (!out) throw new Error('encode: out is required (path without extension)');
        if (!count) throw new Error('encode: no frames were recorded');
        out = path.resolve(out);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const input = ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-start_number', '1', '-i', path.join(dir, 'frame-%06d.png')];
        const result = { frames: count, seconds: count / fps, bytes: {} };
        const frameWidth = Math.round(rect.width * (await obs.call(() => window.devicePixelRatio)) * scale);
        fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ fps, frames: count, seconds: count / fps, clip: rect, captions }, null, 2));

        if (mp4) {
            const file = `${out}.mp4`;
            const size = mp4Width ? `scale=${even(mp4Width)}:-2:flags=lanczos` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos';
            const args = [...input, '-vf', `${size},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
            args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', '-an', file);
            await run('ffmpeg', args, { maxBuffer: 1 << 26 }).catch((e) => {
                throw ffmpegError(e, file);
            });
            result.mp4 = file;
            result.bytes.mp4 = fs.statSync(file).size;
        }
        if (gif) {
            const file = `${out}.gif`;
            const width = Math.min(gifWidth, frameWidth);
            const chain = `fps=${Math.min(gifFps, fps)},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${gifColors}:stats_mode=diff[p];[b][p]paletteuse=dither=${gifDither}:diff_mode=rectangle`;
            await run('ffmpeg', [...input, '-filter_complex', chain, '-loop', '0', file], { maxBuffer: 1 << 26 }).catch((e) => {
                throw ffmpegError(e, file);
            });
            result.gif = file;
            result.bytes.gif = fs.statSync(file).size;
        }
        if (sheet) {
            const file = `${out}-sheet.png`;
            const tiles = sheetColumns * sheetRows;
            const every = Math.max(1, Math.ceil(count / tiles));
            const shown = Math.ceil(count / every);
            const rows = Math.max(1, Math.ceil(shown / sheetColumns));
            const chain = `select='not(mod(n\\,${every}))',scale=${Math.min(640, frameWidth)}:-1:flags=lanczos,tile=${sheetColumns}x${rows}:padding=8:margin=8:color=0x808080`;
            await run('ffmpeg', [...input, '-vf', chain, '-frames:v', '1', '-update', '1', file], { maxBuffer: 1 << 26 }).catch((e) => {
                throw ffmpegError(e, file);
            });
            result.sheet = file;
            result.sheetEvery = every;
        }
        if (poster) {
            const file = `${out}-poster.png`;
            const n = posterFrame === 'first' ? 1 : posterFrame === 'middle' ? Math.ceil(count / 2) : posterFrame === 'last' ? count : Math.min(count, Math.max(1, Number(posterFrame)));
            fs.copyFileSync(frameFile(n), file);
            result.poster = file;
        }
        if (!keepFrames) fs.rmSync(dir, { recursive: true, force: true });
        return result;
    }

    /** Remove the pointer and the caption bar from the page. */
    async function close() {
        obs.mouse.listeners.delete(drawCursor);
        await obs.call(() => window.__etzOverlay && window.__etzOverlay.remove()).catch(() => {});
    }

    return {
        dir,
        fps,
        get frames() {
            return count;
        },
        get seconds() {
            return count / fps;
        },
        get clip() {
            return rect;
        },
        setClip,
        frame,
        hold,
        live,
        caption: setCaption,
        showCursor,
        move,
        click,
        drag,
        slider,
        type,
        key,
        encode,
        close,
    };
}
