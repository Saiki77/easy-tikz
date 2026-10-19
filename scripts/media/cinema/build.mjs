/* eslint-env browser, node */
// Build a cinematic video from a scene in ./scenes: capture, then composite.
//
//   node scripts/media/cinema/build.mjs sample --out /tmp/cinema            # both passes
//   node scripts/media/cinema/build.mjs sample --out /tmp/cinema --skip-capture   # edit again: composite only
//   node scripts/media/cinema/build.mjs sample --out /tmp/cinema --skip-capture --stills 0.5,4.2,9
//                                                                           # single frames, no encoding
//   node scripts/media/cinema/build.mjs sample --stills every:0.5 --skip-capture  # a frame every half second
//   node scripts/media/cinema/build.mjs --list
//
// Options: --scale 2 (draw at twice the pixels, sharp on high-density screens: a 1920 px WebP loop and,
// beside the 1920 x 1080 MP4, the film at 3840 x 2160 as <name>-2x.mp4), --port 9373 (Obsidian for the capture, then headless Chromium for the composite),
// --work DIR (profile, vault and the raw frames; default <tmp>/easy-tikz-media/port-<port>),
// --fps 60, --retries 2, --keep-master, --no-loop, --plugin root.
//
// Writes <out>/<name>.mp4, .gif (and .webp), -poster.png, -sheet-NN.png, -still-N.png and prints what
// it made: sizes, the zoom of every beat, seconds of work per second of video, disk used on the way.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chartBlock, defaultWorkDir, importTs, launch } from '../lib/obsidian.mjs';
import { VIEW, clone, createCapture, readCapture, resetApp } from './capture.mjs';
import { compose, openStage, probe } from './compose.mjs';
import { inspectFilm, makeFilm } from './edit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENES = fs.readdirSync(path.join(HERE, 'scenes')).filter((n) => n.endsWith('.mjs')).map((n) => n.slice(0, -4)).sort();

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        port: { type: 'string' },
        work: { type: 'string' },
        out: { type: 'string' },
        name: { type: 'string' },
        fps: { type: 'string' },
        retries: { type: 'string' },
        stills: { type: 'string' },
        plugin: { type: 'string' },
        scale: { type: 'string' },
        'skip-capture': { type: 'boolean' },
        'keep-master': { type: 'boolean' },
        'no-loop': { type: 'boolean' },
        list: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
    },
});
if (values.help || (!positionals.length && !values.list)) {
    console.log('Usage: node scripts/media/cinema/build.mjs <scene> [--out DIR] [--name NAME] [--port 9373] [--work DIR] [--fps 60] [--skip-capture] [--stills 0.5,4,9 | every:0.5] [--keep-master] [--no-loop] [--retries 2]');
    console.log(`Scenes: ${SCENES.join(', ')}`);
    process.exit(values.help ? 0 : 2);
}
if (values.list) {
    for (const name of SCENES) {
        const scene = (await import(`./scenes/${name}.mjs`)).default;
        console.log(`${name.padEnd(16)} ${scene.seconds[0]} to ${scene.seconds[1]} s  ${scene.title.text}`);
    }
    process.exit(0);
}
const sceneName = positionals[0];
if (!SCENES.includes(sceneName)) {
    console.error(`Unknown scene "${sceneName}". Known: ${SCENES.join(', ')}`);
    process.exit(2);
}
const scene = (await import(`./scenes/${sceneName}.mjs`)).default;

const port = Number(values.port || process.env.ETZ_MEDIA_PORT || 9373);
const workDir = path.resolve(values.work || defaultWorkDir(port));
const outDir = path.resolve(values.out || path.join(workDir, 'cinema-out'));
const name = values.name || scene.name;
const fps = Number(values.fps || 60);
const retries = values.retries === undefined ? 2 : Math.max(0, Number(values.retries) || 0);
// A scene may be another edit of a capture that exists (`capture: 'sample'`): a clip cut from the same take.
const rawDir = path.join(workDir, 'cinema', scene.capture || scene.name);
if (scene.capture && !values['skip-capture']) {
    console.error(`${scene.name} is an edit of the capture of "${scene.capture}": build that scene first, then this one with --skip-capture`);
    process.exit(2);
}
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const say = (text) => process.stderr.write(`[cinema] ${text}\n`);
const dirBytes = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).reduce((sum, n) => sum + fs.statSync(path.join(dir, n)).size, 0) : 0);

// ---------------------------------------------------------------- pass 1
let captureSeconds = null;
if (!values['skip-capture']) {
    const began = Date.now();
    const { EXAMPLES } = await importTs('src/migrate.ts');
    const charts = () => Object.fromEntries(EXAMPLES.map((e) => [e.id, clone(e.data)]));
    const obs = await launch({ port, workDir, width: VIEW.width, height: VIEW.height, theme: 'light', plugin: values.plugin });
    try {
        const versions = await obs.versions();
        say(`Obsidian ${versions.obsidian}, Easy TikZ ${versions.plugin}`);
        let done = null;
        let lastError = null;
        for (let take = 1; take <= 1 + retries && !done; take++) {
            if (take > 1) say(`take ${take} of ${1 + retries}`);
            await resetApp(obs);
            const d = await createCapture(obs, scene, { dir: rawDir, charts: charts(), chartBlock, say });
            try {
                if (scene.setup) await scene.setup(d);
                await obs.waitForRender();
                obs.clearErrors();
                await d.start();
                await scene.run(d);
                done = await d.finish();
            } catch (e) {
                lastError = e;
                const shot = path.join(workDir, `${scene.name}-fail.png`);
                await obs.screenshot(shot, { scale: 0.5 }).catch(() => {});
                say(`  ${e.message}`);
                say(`  screenshot of the moment: ${shot}`);
                // A take that failed may have left the button or a key down.
                if (obs.mouse.buttons & 1) await obs.mouse.up().catch(() => {});
            } finally {
                await d.close();
            }
        }
        if (!done) throw lastError;
    } finally {
        await obs.quit();
    }
    captureSeconds = (Date.now() - began) / 1000;
}

// ---------------------------------------------------------------- the edit
const { track } = readCapture(rawDir);
const film = makeFilm(track, scene, { rawDir, fps });
const [min, max] = scene.seconds;
const seen = inspectFilm(film);
for (const warning of [...film.report.warnings, ...seen.warnings]) say(`note: ${warning}`);
if (film.duration < min || film.duration > max) {
    console.error(`${scene.name}: the film is ${film.duration.toFixed(1)} s long, it should be ${min} to ${max} s`);
    if (!values.stills) process.exit(1); // single frames may still be looked at
}
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, name);

// ---------------------------------------------------------------- single frames
if (values.stills) {
    const spec = values.stills;
    const times = [];
    if (spec.startsWith('every:')) for (let t = 0; t < film.duration - 1e-6; t += Number(spec.slice(6))) times.push(Math.round(t * 1000) / 1000);
    else for (const part of spec.split(',')) times.push(Number(part));
    const stage = await openStage(film, { port });
    const files = [];
    try {
        for (const t of times) {
            const file = `${out}-at-${t.toFixed(2).padStart(5, '0')}.png`;
            await stage.still(t, file);
            const fonts = await stage.fonts();
            if (fonts.length) say(`  at ${t} s: ${fonts.join('; ')}`);
            files.push(file);
        }
    } finally {
        await stage.close();
    }
    if (spec.startsWith('every:')) {
        // Tiles in the order of time, three across, twelve per sheet: row r of sheet s starts at (12 s + 3 r) steps.
        for (let i = 0; i * 12 < files.length; i++) {
            const sheet = `${out}-draft-sheet-${String(i + 1).padStart(2, '0')}.png`;
            execFileSync('magick', ['montage', ...files.slice(i * 12, i * 12 + 12), '-resize', '640x', '-tile', '3x', '-geometry', '+4+4', '-background', '#4A5261', sheet]);
            console.log(`${sheet}  (${times[i * 12].toFixed(1)} s to ${times[Math.min(files.length, i * 12 + 12) - 1].toFixed(1)} s)`);
        }
        for (const file of files) fs.rmSync(file);
    } else for (const file of files) console.log(file);
    process.exit(0);
}

// ---------------------------------------------------------------- pass 2
const scale = Math.max(1, Math.min(3, Number(values.scale || 1) || 1));
const made = await compose(film, { out, port, loop: values['no-loop'] ? false : { ...(scene.loop || {}) }, keepMaster: !!values['keep-master'], scale, say });
const video = await probe(made.mp4);
const rawBytes = dirBytes(rawDir);

console.log('');
console.log(`${scene.name}: ${made.seconds.toFixed(2)} s, ${video.width} x ${video.height}, ${video.fps} fps, ${video.codec} ${video.pixfmt}`);
console.log(`  mp4     ${made.mp4}  ${mb(made.bytes.mp4)}`);
if (made.large) console.log(`  mp4     ${made.large}  ${mb(made.bytes.large)}  (${scale}x, ${film.width * scale} x ${film.height * scale})`);
if (made.gif) console.log(`  gif     ${made.gif.file}  ${mb(made.gif.bytes)}  (${made.gif.width} px, ${made.gif.fps} fps, ${made.gif.colors} colours)`);
if (made.webp) console.log(`  webp    ${made.webp.file}  ${mb(made.webp.bytes)}  (${made.webp.width} px, ${made.webp.fps} fps, lossless)`);
console.log(`  poster  ${made.poster}  ${mb(made.bytes.poster)}  (the frame at ${made.posterAt.toFixed(2)} s)`);
console.log(`  sheets  ${made.sheets.join(', ')}`);
console.log(`  stills  ${made.stills.map((s) => `${path.basename(s.file)} (${s.t.toFixed(2)} s)`).join(', ')}`);
console.log(`  camera  moves for ${seen.camera.moving} s in all, fastest zoom ${seen.camera.fastestZoom}x per second; the pointer moves ${seen.pointer.largestStep} px between two frames at most (at ${seen.pointer.at} s)`);
console.log(`  cadence a picture of a moving stretch stays for ${Object.entries(seen.cadence).map(([n, count]) => `${n} frames (${count} times)`).join(', ') || 'no moving stretch'}`);
console.log(`  beats   ${film.report.beats.map((b) => `${b.id}: ${b.zoom}x, capture at ${(b.source * 100).toFixed(0)} %, move ${b.move} s`).join('; ')}`);
console.log(`  captions ${film.captions.map((c) => `"${c.text}" ${(c.t1 - c.t0).toFixed(1)} s`).join('; ')}`);
console.log(`  holds   ${made.steady.map((h) => `${(h.frame / made.fps).toFixed(1)} s: ${(h.changed * 100).toFixed(2)} % of the pixels move, by at most ${h.largest}/255`).join('; ')}`);
if (Object.keys(track.facts || {}).length) console.log(`  facts   ${JSON.stringify(track.facts)}`);
const work = (captureSeconds || 0) + made.timing.total;
console.log(`  time    ${captureSeconds === null ? 'capture skipped' : `capture ${captureSeconds.toFixed(0)} s`}, draw ${made.timing.draw.toFixed(0)} s (${made.drawn} of ${made.frames} frames drawn), mp4 ${made.timing.mp4.toFixed(0)} s, loop ${made.timing.loop.toFixed(0)} s, review ${made.timing.review.toFixed(0)} s`);
console.log(`          ${(work / made.seconds).toFixed(1)} s of work per second of video${captureSeconds === null ? ' (without the capture)' : ''}`);
console.log(`  disk    raw frames ${mb(rawBytes)} in ${rawDir} (${track.frames.length} pictures, kept for editing again), lossless master ${mb(made.masterBytes)}${made.master ? ' (kept)' : ' (deleted)'}`);
