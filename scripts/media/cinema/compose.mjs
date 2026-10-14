/* eslint-env browser, node */
// Pass 2 of a cinematic video: the composite. Every frame of the output is
// drawn by the stage page (stage.html) in headless Chromium and piped into
// ffmpeg; no frame of the output is ever written to disk as a picture.
//
//   const made = await compose(film, { out: '/tmp/film/clip-drag', port: 9373 });
//
// writes <out>.mp4 and, from a lossless master that is deleted afterwards:
// the loop (<out>.gif and, with img2webp on the PATH, <out>.webp), the
// poster <out>-poster.png, contact sheets <out>-sheet-NN.png (a frame every
// half second) and stills <out>-still-N.png at full size.
//
// A frame that looks the same as the one before it (a hold) is not drawn
// again: the same PNG goes to the encoder twice, so a hold cannot jitter.
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { verifyFonts, writeFontsCss } from '../brand/fonts.mjs';
import { sleep, waitFor } from '../lib/cdp.mjs';
import { launchStageChromium } from './chrome.mjs';
import { reviewMoments } from './edit.mjs';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function ffmpegError(e, what) {
    const tail = String(e.stderr || e.message || e).trim().split('\n').slice(-6).join('\n');
    return new Error(`ffmpeg failed while writing ${what}:\n${tail}`);
}
const ff = (args, what) =>
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 26 }).catch((e) => {
        throw ffmpegError(e, what);
    });

/**
 * Open the stage with a film and return { draw(t), still(t, file), close(), measured }.
 * For the composite pass and for looking at single frames while editing.
 */
export async function openStage(film, { port }) {
    writeFontsCss();
    const chrome = await launchStageChromium({ port });
    const cdp = chrome.cdp;
    try {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: film.width, height: film.height, deviceScaleFactor: 1, mobile: false });
        const nav = await cdp.send('Page.navigate', { url: pathToFileURL(path.join(HERE, 'stage.html')).href });
        if (nav.errorText) throw new Error(`stage: ${nav.errorText}`);
        await waitFor(() => cdp.evaluate('window.cinemaReady === true'), { timeout: 20000, interval: 50, message: 'the stage page to load' });
        const measured = await cdp.call((data) => window.cinema.init(data), film);
        if (measured.problems.length) throw new Error(`stage: ${film.name}:\n` + measured.problems.map((p) => `  - ${p}`).join('\n'));
        if (chrome.errors.length) throw new Error(`stage: console error: ${chrome.errors[0]}`);
        // A screenshot waits for a frame of the compositor, and once in a thousand or so none comes: the call
        // then never answers. So it is given a few seconds, the page is asked for a frame, and it is tried again.
        const shot = async () => {
            for (let attempt = 1; ; attempt++) {
                try {
                    const r = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false, clip: { x: 0, y: 0, width: film.width, height: film.height, scale: 1 } }, { timeout: attempt === 1 ? 8000 : 20000 });
                    return Buffer.from(r.data, 'base64');
                } catch (e) {
                    if (attempt >= 3 || !/no answer/.test(e.message)) throw e;
                    await cdp.evaluate('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))', { timeout: 4000 }).catch(() => {});
                }
            }
        };
        return {
            chrome,
            cdp,
            measured,
            /** Draw film second t; returns the stage's signature of that moment. */
            draw: (t) => cdp.call((time) => window.cinema.draw(time), t),
            shot,
            /** One frame as a PNG file. */
            async still(t, file) {
                await cdp.call((time) => window.cinema.draw(time), t);
                fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
                fs.writeFileSync(file, await shot());
                return file;
            },
            /** Texts of the frame on screen that are not drawn with a TeX font of the brand ([] when all are). */
            fonts: () => verifyFonts(cdp),
            close: () => chrome.close(),
        };
    } catch (e) {
        await chrome.close();
        throw e;
    }
}

/**
 * Draw and encode a film.
 *   film      from makeFilm() (edit.mjs)
 *   out       path without extension
 *   port      debugging port for the headless Chromium
 *   crf       H.264 quality of the MP4 (default 18)
 *   loop      { width: 960, budget: 8 MB, from, to } for the GIF; false for none. `from` and `to` are film
 *             seconds: the loop is that part of the film only (the highlight of a long film)
 *   stills    [{ name, t }]: full size stills (default: reviewMoments(film), the moments worth a close look)
 *   keepMaster   keep <out>-master.mkv (lossless), for encoding again without drawing
 * Returns { mp4, gif, webp, poster, sheets, stills, frames, drawn, seconds, timing, bytes }.
 */
export async function compose(film, { out, port, crf = 18, loop = {}, stills = null, keepMaster = false, say = () => {} } = {}) {
    if (!out) throw new Error('compose: out is required (path without extension)');
    out = path.resolve(out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const fps = film.fps;
    const total = Math.round(film.duration * fps);
    const master = `${out}-master.mkv`;
    const timing = {};
    const started = Date.now();

    // ---- draw: stage -> PNG -> ffmpeg (lossless RGB master)
    const stage = await openStage(film, { port });
    let drawn = 0;
    const holds = [];
    const fontProblems = [];
    try {
        const enc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-c:v', 'libx264rgb', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'rgb24', master], { stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        enc.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        const exited = once(enc, 'close');
        let lastKey = null;
        let lastPng = null;
        let run = 0; // frames in a row that reuse the picture before them
        const checks = new Set([0, Math.round(total * 0.35), Math.round(total * 0.6), total - 1]);
        for (let i = 0; i < total; i++) {
            const key = await stage.draw(i / fps);
            if (key !== lastKey || !lastPng) {
                lastPng = await stage.shot();
                lastKey = key;
                drawn++;
                run = 0;
            } else if (++run === 12) holds.push(i); // a fifth of a second into a hold: this frame and the one before it are the same picture
            if (checks.has(i)) for (const p of await stage.fonts()) fontProblems.push(`at ${(i / fps).toFixed(2)} s: ${p}`);
            if (!enc.stdin.write(lastPng)) await once(enc.stdin, 'drain');
            if (i % (fps * 2) === 0) say(`  drawing ${(i / fps).toFixed(0)} of ${film.duration.toFixed(1)} s`);
        }
        enc.stdin.end();
        const [code] = await exited;
        if (code !== 0) throw new Error(`ffmpeg failed while writing the master:\n${stderr.trim().split('\n').slice(-6).join('\n')}`);
        if (stage.chrome.errors.length) throw new Error(`stage: console error: ${stage.chrome.errors[0]}`);
    } finally {
        await stage.close();
    }
    if (fontProblems.length) throw new Error(`compose: ${film.name}: text is not set in the brand's fonts:\n` + fontProblems.map((p) => `  - ${p}`).join('\n'));
    timing.draw = (Date.now() - started) / 1000;

    // ---- encode
    const result = { frames: total, drawn, seconds: total / fps, fps, bytes: {}, timing, masterBytes: fs.statSync(master).size };
    let mark = Date.now();
    result.mp4 = `${out}.mp4`;
    // RGB to BT.709 limited range, and tagged as such: players then show the paper in its own colour.
    await ff(
        ['-i', master, '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', '-an', result.mp4],
        result.mp4
    );
    result.bytes.mp4 = fs.statSync(result.mp4).size;
    timing.mp4 = (Date.now() - mark) / 1000;

    mark = Date.now();
    if (loop !== false) {
        const made = await encodeLoop(master, out, { fps: film.fps, ...loop });
        Object.assign(result, { gif: made.gif, webp: made.webp, loop: made });
        if (made.gif) result.bytes.gif = made.gif.bytes;
        if (made.webp) result.bytes.webp = made.webp.bytes;
    }
    timing.loop = (Date.now() - mark) / 1000;

    mark = Date.now();
    // Poster: the settled frame the scene marked, from the lossless master.
    const posterAt = film.marks.poster === null || film.marks.poster === undefined ? film.duration / 2 : film.marks.poster;
    result.poster = `${out}-poster.png`;
    await frameOf(master, posterAt, result.poster);
    await run('magick', [result.poster, '-strip', '-define', 'png:compression-level=9', result.poster]);
    result.bytes.poster = fs.statSync(result.poster).size;
    result.posterAt = posterAt;

    // Review material, from the MP4: what a viewer gets.
    result.sheets = await contactSheets(result.mp4, out, { frames: total, fps });
    const moments = stills || reviewMoments(film);
    result.stills = [];
    for (let i = 0; i < moments.length; i++) {
        const file = `${out}-still-${i + 1}-${moments[i].name}.png`;
        await frameOf(result.mp4, moments[i].t, file);
        result.stills.push({ ...moments[i], file });
    }
    // Holds: two frames in a row that were one picture on the stage must still be (nearly) one in the MP4.
    result.steady = await steadiness(result.mp4, pick(holds, 6));
    timing.review = (Date.now() - mark) / 1000;
    if (!keepMaster) fs.rmSync(master, { force: true });
    else result.master = master;
    timing.total = (Date.now() - started) / 1000;
    return result;
}

/** At most `n` items of a list, spread evenly. */
function pick(list, n) {
    if (list.length <= n) return list.slice();
    return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
}

/**
 * How still a hold is in the encoded video: for each frame number in `frames`, that frame and the one
 * before it are compared. Returns [{ frame, changed, largest }]: the share of pixels that differ by
 * more than 2 % of a channel, and the largest difference of a channel (0..255). On the stage the two
 * are the same picture, so what is left is the encoder's own rounding (after a fade it takes x264 a few
 * frames to settle; a hold is measured a fifth of a second in).
 */
export async function steadiness(video, frames) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-tikz-hold-'));
    const out = [];
    try {
        for (const n of frames) {
            const base = path.join(dir, `f${n}`);
            await ff(['-i', video, '-vf', `select='eq(n\\,${n - 1})+eq(n\\,${n})'`, '-fps_mode', 'passthrough', `${base}-%d.png`], 'two frames of a hold');
            const difference = [`${base}-1.png`, `${base}-2.png`, '-compose', 'difference', '-composite', '-colorspace', 'Gray'];
            const { stdout: peak } = await run('magick', [...difference, '-format', '%[fx:maxima*255]', 'info:']);
            const { stdout: share } = await run('magick', [...difference, '-threshold', '2%', '-format', '%[fx:mean]', 'info:']);
            const largest = Number(peak);
            const changed = Number(share);
            out.push({ frame: n, largest: Math.round(largest), changed });
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    return out;
}

/** One frame of a video as a PNG, at its full size. */
export async function frameOf(video, t, file) {
    const { fps } = await probe(video);
    const n = Math.max(0, Math.round(t * fps));
    await ff(['-i', video, '-vf', `select='eq(n\\,${n})'`, '-fps_mode', 'passthrough', '-frames:v', '1', '-update', '1', file], file);
    return file;
}

/**
 * Contact sheets: the frame at every `every` seconds (exactly that frame, picked by its number) as
 * tiles of `tile` px, `columns` by `rows` per PNG, each tile large enough to read the caption.
 * Tile n of the film (counted along the rows, from 0) is second n * every. Returns the files.
 */
export async function contactSheets(video, outBase, { frames, fps, every = 0.5, tile = 640, columns = 3, rows = 4 } = {}) {
    const per = columns * rows;
    const step = Math.max(1, Math.round(every * fps));
    const count = Math.floor((frames - 1) / step) + 1;
    const files = [];
    for (let i = 0; i * per < count; i++) {
        const file = `${outBase}-sheet-${String(i + 1).padStart(2, '0')}.png`;
        const first = i * per;
        const n = Math.min(per, count - first);
        const chain = `select='not(mod(n\\,${step}))*gte(n\\,${first * step})*lt(n\\,${(first + n) * step})',scale=${tile}:-1:flags=lanczos,tile=${columns}x${Math.ceil(n / columns)}:padding=6:margin=6:color=0x4A5261`;
        await ff(['-i', video, '-vf', chain, '-fps_mode', 'passthrough', '-frames:v', '1', '-update', '1', file], file);
        files.push(file);
    }
    return files;
}

/**
 * The loop for a README: a GIF that stays within its budget (the settings get coarser step by step
 * until it fits) and, when img2webp is on the PATH, a lossless animated WebP of the same frames
 * (20 per second, full colour; about three quarters of the GIF's size for a film of 15 s).
 *   from, to   film seconds: only this part of the film (default: all of it). A film of 45 s does not fit
 *              a README as a GIF of this size; its loop is a highlight of 12 to 15 s, with a link to the MP4
 */
export async function encodeLoop(master, outBase, { width = 960, fps = 60, budget = 8 * 1024 * 1024, webp = true, from = null, to = null } = {}) {
    const made = { gif: null, webp: null };
    const part = from === null && to === null ? '' : `trim=start=${from || 0}${to === null ? '' : `:end=${to}`},setpts=PTS-STARTPTS,`;
    const rates = [20, 15, 12, 10].filter((r) => r <= fps);
    const ladder = [];
    for (const rate of rates) for (const colors of [256, 128]) ladder.push({ fps: rate, colors, width });
    ladder.push({ fps: 10, colors: 64, width }, { fps: 10, colors: 64, width: Math.round(width * 0.84) });
    const gif = `${outBase}.gif`;
    for (const step of ladder) {
        // The palette is built from the whole film; a light ordered dither keeps the soft shadow of the
        // window from banding, and rectangle diffing keeps the still paper out of every frame.
        const chain = `${part}fps=${step.fps},scale=${step.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${step.colors}:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
        await ff(['-i', master, '-filter_complex', chain, '-loop', '0', gif], gif);
        made.gif = { file: gif, bytes: fs.statSync(gif).size, ...step };
        if (made.gif.bytes <= budget) break;
    }
    if (webp) {
        const tool = await run('which', ['img2webp']).then((r) => r.stdout.trim(), () => '');
        if (tool) {
            const rate = 20 <= fps ? 20 : fps;
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-tikz-loop-'));
            try {
                await ff(['-i', master, '-vf', `${part}fps=${rate},scale=${width}:-1:flags=lanczos`, path.join(dir, 'f-%05d.png')], 'the frames of the WebP loop');
                const frames = fs.readdirSync(dir).filter((n) => n.endsWith('.png')).sort().map((n) => path.join(dir, n));
                const file = `${outBase}.webp`;
                // Lossless: every pixel as drawn. (img2webp's lossy mode leaves ghosts where something small
                // disappeared, such as the editor's hover tip: it was tried and looked at.)
                await run(tool, ['-loop', '0', '-lossless', '-m', '4', '-d', String(Math.round(1000 / rate)), ...frames, '-o', file], { maxBuffer: 1 << 26 });
                made.webp = { file, bytes: fs.statSync(file).size, fps: rate, width, lossless: true };
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    }
    return made;
}

/** Width, height, frame rate and duration of a video file (ffprobe). */
export async function probe(file) {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,pix_fmt,codec_name,nb_frames:format=duration,size', '-of', 'json', file]);
    const info = JSON.parse(stdout);
    const stream = (info.streams || [])[0] || {};
    const [num, den] = String(stream.r_frame_rate || '0/1').split('/').map(Number);
    return { width: stream.width, height: stream.height, fps: den ? num / den : 0, codec: stream.codec_name, pixfmt: stream.pix_fmt, seconds: info.format && info.format.duration ? Number(info.format.duration) : null };
}

export { mb, sleep };
