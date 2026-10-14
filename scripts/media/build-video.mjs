/* eslint-env browser, node */
// Record the first-round videos of docs/media (the clips of the 4.0 relaunch) from the real plugin
// in the isolated Obsidian (lib/obsidian.mjs): one scenario per file in ./video/.
//
//   node scripts/media/build-video.mjs                           # every scenario it may write
//   node scripts/media/build-video.mjs clip-sliders clip-3d      # only these
//   node scripts/media/build-video.mjs --list                    # names and lengths
//   node scripts/media/build-video.mjs --sheets /tmp/sheets      # also keep the contact sheets for review
//   node scripts/media/build-video.mjs --retries 0               # do not film a failed scenario again (default: 2 more takes)
//
// Retired from npm (there is no media:video any more): overview and clip-drag in docs/media are films
// of the cinema pipeline now (scripts/media/cinema, npm run media:film), in the new design. This
// script never writes overview.* or clip-drag.* into docs/media (lib/replaced.mjs): a run leaves the
// two scenarios out, and naming one stops before anything is filmed. With --out <dir> it still films
// them there.
//
// Per scenario it writes, into docs/media (or --out):
//   <name>.mp4          H.264, CRF 18, 30 fps, at 1x of the filmed area (the overview is 1728 x 1116)
//   <name>.gif          960 px wide, at most about 6 MB (see encodeGif in video/common.mjs)
//   <name>-poster.png   one telling frame at the full 2x resolution (256 colours, so about a third of the bytes)
// A filmed scenario always replaces its MP4 and GIF (two takes are never the same frame by frame),
// so film only the scenarios that changed: every run adds its videos to the repository's history.
// and, into --sheets (default: <work dir>/video), the contact sheet
// <name>-sheet.png plus the larger review tiles <name>-review-NN.png.
// Look at them before publishing a clip.
//
// The app is laid out at 1728 x 1117 CSS px at 2x (fullscreen on a 16 inch
// MacBook Pro) in the light theme. A scenario fails, and writes nothing,
// when the app did not do what the clip is meant to show.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PORTS, REPO, chartBlock, defaultWorkDir, importTs, launch } from './lib/obsidian.mjs';
import { guardReplaced, keepReplaced } from './lib/replaced.mjs';
import { installImage } from './lib/stable.mjs';
import { FPS, GIF_BUDGET, WINDOW, clone, createDirector, encodeGif, probe, resetApp, reviewSheets, writePoster } from './video/common.mjs';

const ALL = ['overview', 'clip-sliders', 'clip-drag', 'clip-shift', 'clip-areas', 'clip-quickfix', 'clip-3d', 'clip-note'];

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        port: { type: 'string' },
        work: { type: 'string' },
        out: { type: 'string' },
        sheets: { type: 'string' },
        list: { type: 'boolean' },
        'keep-frames': { type: 'boolean' },
        'no-gif': { type: 'boolean' },
        retries: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
    },
});

if (values.help) {
    console.log('Usage: node scripts/media/build-video.mjs [name ...] [--port 9344] [--work DIR] [--out DIR] [--sheets DIR] [--retries 2] [--list] [--keep-frames] [--no-gif]');
    console.log(`Scenarios: ${ALL.join(', ')}`);
    console.log('overview and clip-drag are films of scripts/media/cinema now: this script films them only with --out <a dir other than docs/media>.');
    process.exit(0);
}

const names = positionals.length ? positionals : ALL;
for (const name of names) {
    if (!ALL.includes(name)) {
        console.error(`Unknown scenario "${name}". Known: ${ALL.join(', ')}`);
        process.exit(2);
    }
}
const scenarios = [];
for (const name of names) scenarios.push((await import(`./video/${name}.mjs`)).default);

if (values.list) {
    for (const s of scenarios) console.log(`${s.name.padEnd(14)} ${String(s.seconds[0]).padStart(2)} to ${s.seconds[1]} s  ${s.title}`);
    process.exit(0);
}

const port = Number(values.port || process.env.ETZ_MEDIA_PORT || PORTS.video);
const workDir = path.resolve(values.work || defaultWorkDir(port));
const outDir = path.resolve(values.out || path.join(REPO, 'docs', 'media'));
const stageDir = path.join(workDir, 'video');
const sheetsDir = path.resolve(values.sheets || stageDir);
const retries = values.retries === undefined ? 2 : Math.max(0, Number(values.retries) || 0);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const say = (text) => process.stderr.write(`[video] ${text}\n`);

// overview and clip-drag in docs/media are films of the cinema pipeline now: never written there by this script.
let allowed;
try {
    allowed = keepReplaced('video', outDir, names, { explicit: positionals.length > 0, log: say });
} catch (e) {
    console.error(e.message);
    process.exit(2);
}
for (let i = scenarios.length - 1; i >= 0; i--) if (!allowed.includes(scenarios[i].name)) scenarios.splice(i, 1);

// The plugin's own example charts: scenarios start from these, as a user would.
const { EXAMPLES } = await importTs('src/migrate.ts');
const charts = () => Object.fromEntries(EXAMPLES.map((e) => [e.id, clone(e.data)]));

const obs = await launch({ port, workDir, width: WINDOW.width, height: WINDOW.height, theme: 'light' });
const results = [];
let failed = 0;
try {
    const view = await obs.call(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio, light: document.body.classList.contains('theme-light') }));
    if (view.w !== WINDOW.width || view.h !== WINDOW.height || view.dpr !== 2 || !view.light) {
        throw new Error(`The page is ${view.w} x ${view.h} at ${view.dpr}x (${view.light ? 'light' : 'dark'}), expected ${WINDOW.width} x ${WINDOW.height} at 2x in the light theme`);
    }
    const versions = await obs.versions();
    say(`Obsidian ${versions.obsidian}, Easy TikZ ${versions.plugin}, ${view.w} x ${view.h} at ${view.dpr}x`);
    fs.mkdirSync(stageDir, { recursive: true });
    fs.mkdirSync(sheetsDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });

    /** Film one scenario; a director that reached finish() is returned, anything else throws. */
    const film = async (scenario, framesDir) => {
        await resetApp(obs);
        const d = await createDirector(obs, scenario, { framesDir, charts: charts(), chartBlock, say });
        try {
            if (scenario.setup) await scenario.setup(d);
            await obs.waitForRender();
            obs.clearErrors();
            await d.start();
            await scenario.run(d);
            await d.finish();
            return d;
        } catch (e) {
            const shot = path.join(sheetsDir, `${scenario.name}-fail.png`);
            await obs.screenshot(shot, { scale: 0.5 }).catch(() => {});
            say(`  ${e.message}`);
            say(`  screenshot of the moment: ${shot}`);
            throw e;
        } finally {
            await d.close();
        }
    };

    for (const scenario of scenarios) {
        const framesDir = path.join(stageDir, `frames-${scenario.name}`);
        const stage = path.join(stageDir, scenario.name);
        say(`${scenario.name}: ${scenario.title}`);
        try {
            // A take can be spoilt from outside (another window taking the focus ends a drag in progress).
            // The checks of the scenario notice that, and the scenario is filmed again.
            let d = null;
            let lastError = null;
            for (let take = 1; take <= 1 + retries && !d; take++) {
                if (take > 1) say(`  take ${take} of ${1 + retries}`);
                d = await film(scenario, framesDir).catch((e) => {
                    lastError = e;
                    return null;
                });
            }
            if (!d) throw lastError;

            const rec = d.rec;
            const frames = rec.frames;
            const seconds = rec.seconds;
            const made = await rec.encode({
                out: stage,
                gif: false,
                crf: 18,
                mp4Width: d.clip.width,
                posterFrame: d.posterFrame || 'last',
            });
            const gif = values['no-gif'] ? null : await encodeGif(framesDir, `${stage}.gif`);
            const review = await reviewSheets(framesDir, stage, frames, { every: seconds > 30 ? 1.5 : 0.75 });
            const video = await probe(made.mp4);
            // The poster keeps the 2x size of the frame; a palette makes the file about a third.
            const posterFile = `${stage}-poster-small.png`;
            const posterBytes = await writePoster(made.poster, posterFile);
            const poster = { ...(await probe(posterFile)), bytes: posterBytes };
            if (!values['keep-frames']) fs.rmSync(framesDir, { recursive: true, force: true });

            // Deliverables into docs/media, review material into the sheets folder. The MP4 and the GIF
            // of a filmed scenario are always replaced: two takes differ in most frames, so nothing can
            // tell a small deliberate change from a new take (lib/stable.mjs). The poster is one picture
            // and stays when the new one shows the same.
            guardReplaced('video', outDir, scenario.name);
            const target = (suffix) => path.join(outDir, `${scenario.name}${suffix}`);
            fs.copyFileSync(made.mp4, target('.mp4'));
            if (gif) fs.copyFileSync(gif.file, target('.gif'));
            const posterState = await installImage(posterFile, target('-poster.png'));
            if (sheetsDir !== stageDir) for (const file of [made.sheet, ...review]) fs.copyFileSync(file, path.join(sheetsDir, path.basename(file)));

            results.push({ name: scenario.name, seconds, frames, video, mp4: made.bytes.mp4, gif, poster, posterState, captions: d.captions, sheets: 1 + review.length });
            if (gif && gif.bytes > GIF_BUDGET) say(`${scenario.name}: the GIF is ${mb(gif.bytes)}, over the budget of ${mb(GIF_BUDGET)}`);
        } catch (e) {
            failed++;
            say(`FAIL ${scenario.name}: ${e.message}`);
            results.push({ name: scenario.name, error: e.message });
        }
    }
} finally {
    await obs.quit();
}

console.log('');
console.log(`Videos in ${path.relative(process.cwd(), outDir) || '.'} (contact sheets in ${sheetsDir}):`);
for (const r of results) {
    if (r.error) {
        console.log(`  ${r.name.padEnd(14)} FAILED: ${r.error}`);
        continue;
    }
    const gif = r.gif ? `gif ${mb(r.gif.bytes)} (${r.gif.width} px, ${r.gif.fps} fps, ${r.gif.colors} colours)` : 'no gif';
    console.log(`  ${r.name.padEnd(14)} ${r.seconds.toFixed(1).padStart(5)} s  mp4 ${r.video.width} x ${r.video.height} ${mb(r.mp4)}  ${gif}  poster ${r.poster.width} x ${r.poster.height} ${mb(r.poster.bytes)}  ${r.sheets} sheets`);
}
console.log(`  (${FPS} fps; captions per clip: ${results.filter((r) => !r.error).map((r) => `${r.name} ${r.captions.filter((c) => c.text).length}`).join(', ')})`);
if (failed) process.exitCode = 1;
