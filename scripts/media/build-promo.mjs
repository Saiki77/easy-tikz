/* eslint-env browser, node */
// Promo images for the README, the GitHub social preview and release posts:
// docs/media/hero.png, card-*.png, social-*.png and square-1080.png.
//
//   npm run media:promo                         # everything, about 1 minute
//   npm run media:promo -- --skip-capture       # only compose again from the last captures (design work)
//   npm run media:promo -- --only hero,card-drag
//   npm run media:promo -- --port 9343 --work /tmp/etz-promo --plugin root
//
// Four stages:
//   1. capture   real screenshots of the plugin in the isolated Obsidian (promo/capture.mjs),
//                written to promo/shots/ (not committed);
//   2. export    the LaTeX of the Linear program example, exactly as the Code tab shows it, is
//                compiled with pdflatex and the PDF turned into a PNG (the right half of card-export);
//   3. compose   promo/*.html are laid out around those pictures and rendered by headless Chromium;
//   4. optimise  metadata stripped, PNGs recompressed, a palette used where a file is still too big.
//
// The cards never draw plugin UI: every chart and every piece of the editor in them is a crop
// of a capture. The only things added are text, frames and the pointer (which no capture contains).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { launchChromium } from './lib/chromium.mjs';
import { PORTS, REPO, defaultWorkDir } from './lib/obsidian.mjs';
import { installImage } from './lib/stable.mjs';
import { capture } from './promo/capture.mjs';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMO = path.join(HERE, 'promo');
const SHOTS = path.join(PROMO, 'shots');

/** Every image: template, size in pixels, and the size budget the optimiser aims for. */
const TARGETS = [
    { name: 'hero', page: 'hero.html', width: 2400, height: 1350, budget: 900 },
    { name: 'card-drag', page: 'card-drag.html', width: 1600, height: 1000, budget: 900 },
    { name: 'card-sliders', page: 'card-sliders.html', width: 1600, height: 1000, budget: 900 },
    { name: 'card-regions', page: 'card-regions.html', width: 1600, height: 1000, budget: 900 },
    { name: 'card-notes', page: 'card-notes.html', width: 1600, height: 1000, budget: 900 },
    { name: 'card-export', page: 'card-export.html', width: 1600, height: 1000, budget: 900 },
    { name: 'card-3d', page: 'card-3d.html', width: 1600, height: 1000, budget: 900 },
    { name: 'card-tools', page: 'card-tools.html', width: 1600, height: 1000, budget: 900 },
    { name: 'social-1280x640', page: 'social.html', width: 1280, height: 640, budget: 900 },
    { name: 'social-1200x675', page: 'social.html', width: 1200, height: 675, budget: 900 },
    { name: 'square-1080', page: 'square.html', width: 1080, height: 1080, budget: 900 },
];

const { values } = parseArgs({
    options: {
        port: { type: 'string' },
        work: { type: 'string' },
        plugin: { type: 'string' },
        out: { type: 'string' },
        only: { type: 'string' },
        'skip-capture': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
    },
});
if (values.help) {
    console.log('Usage: node scripts/media/build-promo.mjs [--skip-capture] [--only name,name] [--port 9343] [--work dir] [--plugin source|root|dir] [--out docs/media]');
    console.log(`Images: ${TARGETS.map((t) => t.name).join(', ')}`);
    process.exit(0);
}

const port = Number(values.port || process.env.ETZ_MEDIA_PORT || PORTS.promo);
const workDir = path.resolve(values.work || defaultWorkDir(port));
const outDir = path.resolve(values.out || path.join(REPO, 'docs', 'media'));
const only = values.only ? values.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
const targets = only ? TARGETS.filter((t) => only.includes(t.name)) : TARGETS;
if (only && targets.length !== only.length) {
    const unknown = only.filter((n) => !TARGETS.some((t) => t.name === n));
    throw new Error(`Unknown image(s): ${unknown.join(', ')}. Known: ${TARGETS.map((t) => t.name).join(', ')}`);
}
const log = (text) => process.stderr.write(`[promo] ${text}\n`);
const kb = (file) => Math.round(fs.statSync(file).size / 1024);

/** A program on the PATH, or null. */
async function which(name) {
    try {
        const { stdout } = await run('/usr/bin/which', [name]);
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

// ------------------------------------------------------------------ 1. capture

const texFile = path.join(SHOTS, 'export-lp.tex');
if (values['skip-capture']) {
    if (!fs.existsSync(path.join(SHOTS, 'meta.js')) || !fs.existsSync(texFile)) {
        throw new Error(`--skip-capture needs the captures of an earlier run in ${path.relative(REPO, SHOTS)}. Run once without it.`);
    }
    log('reusing the captures of the last run');
} else {
    // Stale pictures of an earlier run must not survive a failed one.
    fs.rmSync(SHOTS, { recursive: true, force: true });
    const { tex } = await capture({ port, workDir, plugin: values.plugin, shotsDir: SHOTS, log });
    fs.writeFileSync(texFile, tex);
}

// ------------------------------------------------------------------ 2. export: LaTeX -> PDF -> PNG

/**
 * Compile the exported document with pdflatex and render the PDF to
 * shots/export-lp.png. No fallback picture: without pdflatex the build
 * stops, because card-export shows what pdflatex really drew.
 */
async function compileExport() {
    const pdflatex = await which('pdflatex');
    if (!pdflatex) throw new Error('pdflatex is not on the PATH. card-export shows a PDF compiled from the exported code; install TeX or build the other images with --only.');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-tikz-promo-tex-'));
    try {
        fs.copyFileSync(texFile, path.join(dir, 'export-lp.tex'));
        try {
            await run(pdflatex, ['-interaction=nonstopmode', '-halt-on-error', 'export-lp.tex'], { cwd: dir, timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
        } catch (e) {
            const logText = fs.existsSync(path.join(dir, 'export-lp.log')) ? fs.readFileSync(path.join(dir, 'export-lp.log'), 'utf8') : String(e.stdout || e.message);
            const lines = logText.split('\n');
            const at = lines.findIndex((l) => l.startsWith('!'));
            throw new Error(`pdflatex could not compile the exported code:\n${lines.slice(Math.max(0, at), at + 12).join('\n')}`);
        }
        const pdf = path.join(SHOTS, 'export-lp.pdf');
        const png = path.join(SHOTS, 'export-lp.png');
        fs.copyFileSync(path.join(dir, 'export-lp.pdf'), pdf);
        const magick = await which('magick');
        if (magick && (await which('gs'))) {
            await run(magick, ['-density', '400', pdf, '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-strip', png]);
        } else {
            // macOS without Ghostscript: sips renders the page at 72 dpi times the requested size.
            await run('/usr/bin/sips', ['-s', 'format', 'png', '--resampleHeight', '2000', pdf, '--out', png]);
        }
        log(`pdflatex compiled the exported code: ${path.relative(REPO, png)} (${kb(png)} KB)`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
if (targets.some((t) => t.name === 'card-export')) await compileExport();

// ------------------------------------------------------------------ 3. compose

fs.mkdirSync(outDir, { recursive: true });
// Images are rendered and optimised in a staging folder and only then put into docs/media:
// one that shows what the file there already shows leaves that file alone (lib/stable.mjs).
const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-tikz-promo-out-'));
const chrome = await launchChromium({ port, workDir: `${workDir}-chromium` });
const problems = [];
try {
    for (const t of targets) {
        const out = path.join(stageDir, `${t.name}.png`);
        chrome.errors.length = 0;
        await chrome.render(path.join(PROMO, t.page), out, { width: t.width, height: t.height, query: `w=${t.width}&h=${t.height}`, settle: 150 });
        // The templates check themselves: text that leaves the canvas or is cut off by its box is reported.
        const report = await chrome.cdp.call(() => (window.promoReport ? window.promoReport() : ['the template did not load promo.js']));
        for (const line of [...chrome.errors, ...report]) problems.push(`${t.name}: ${line}`);
        log(`rendered ${t.name} (${t.width} x ${t.height})`);
    }
} finally {
    await chrome.close();
}
if (problems.length) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    throw new Error(`The templates reported problems:\n  ${problems.join('\n  ')}`);
}

// ------------------------------------------------------------------ 4. optimise

/**
 * Strip metadata and recompress. A file over its budget gets a 256 colour
 * palette (the cards are flat colours and a few soft shadows, so this is
 * hard to see), and is kept in true colour when even that does not help.
 */
async function optimise(file, budget) {
    const magick = await which('magick');
    if (!magick) return 'not optimised (ImageMagick is missing)';
    const png = ['-define', 'png:compression-level=9', '-define', 'png:compression-filter=5', '-define', 'png:compression-strategy=1', '-define', 'png:exclude-chunk=all'];
    await run(magick, [file, '-strip', ...png, `PNG24:${file}`]);
    if (kb(file) <= budget) return 'true colour';
    const palette = `${file}.palette.png`;
    await run(magick, [file, '-strip', '-dither', 'FloydSteinberg', '-colors', '256', ...png, `PNG8:${palette}`]);
    if (kb(palette) < kb(file)) {
        fs.renameSync(palette, file);
        return '256 colours';
    }
    fs.rmSync(palette, { force: true });
    return 'true colour';
}

const rows = [];
for (const t of targets) {
    const staged = path.join(stageDir, `${t.name}.png`);
    const file = path.join(outDir, `${t.name}.png`);
    const how = await optimise(staged, t.budget);
    const state = await installImage(staged, file);
    const size = kb(file);
    const note = state === 'kept' ? 'same picture as before, file kept' : state;
    rows.push(`${path.relative(REPO, file).padEnd(34)} ${String(t.width).padStart(4)} x ${String(t.height).padEnd(4)} ${String(size).padStart(5)} KB  ${how}, ${note}${size > t.budget ? `  (over the ${t.budget} KB budget)` : ''}`);
}
fs.rmSync(stageDir, { recursive: true, force: true });
console.log(rows.join('\n'));
