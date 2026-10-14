/* eslint-env node */
// Build the brand kit's own pictures and check the kit on the way:
//
//   1. fonts.css       the TeX fonts of this machine, resolved with kpsewhich (fails when one is missing)
//   2. math.test.mjs   the formula formatter on the formulas of the media
//      kit.test.mjs    the paper's lines, the callout curve, the pointer's keycap
//   3. specimen.png    the brand sheet (specimen.html), written next to this file for README.md
//   4. the proofs      proofs/hero.html and proofs/card-drag.html, composed around real captures
//   5. fontcheck.png   every face beside the system fallback, to see that the TeX fonts are in use
//
//   node scripts/media/brand/build.mjs                       # everything; proofs go to <tmp>/easy-tikz-media/brand
//   node scripts/media/brand/build.mjs --out /some/dir       # proofs, font check and a copy of the specimen there
//   node scripts/media/brand/build.mjs --skip-capture        # compose again from proofs/shots
//   node scripts/media/brand/build.mjs --only specimen,hero  # names: specimen, hero, card-drag, fontcheck
//   node scripts/media/brand/build.mjs --fonts               # only write fonts.css (enough to open a template in a browser)
//   node scripts/media/brand/build.mjs --draft               # write a picture even when a page reports problems
//   node scripts/media/brand/build.mjs --port 9371 --work /tmp/etz-brand
//
// One port serves both stages, one after the other: first the isolated
// Obsidian of the media toolkit (captures, proofs/capture.mjs), then
// headless Chromium (pages).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launchChromium } from '../lib/chromium.mjs';
import { fontsUsed, writeFontsCss } from './fonts.mjs';
import { capture } from './proofs/capture.mjs';
import { optimisePng, renderPage } from './render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGES = [
    { name: 'specimen', page: 'specimen.html', out: 'specimen.png', width: 2400, height: 1872, keep: true },
    { name: 'hero', page: 'proofs/hero.html', out: 'proof-hero.png', width: 2400, height: 1350, small: true },
    { name: 'card-drag', page: 'proofs/card-drag.html', out: 'proof-card.png', width: 1600, height: 1000, small: true },
    { name: 'fontcheck', page: 'fontcheck.html', out: 'fontcheck.png', width: 1600, height: 1000, allowFonts: ['TimesNewRomanPSMT', 'TimesNewRomanPS-ItalicMT', 'TimesNewRomanPS-BoldMT', 'Menlo-Regular', 'Courier', 'CourierNewPSMT'] },
];

const { values } = parseArgs({
    options: { out: { type: 'string' }, port: { type: 'string' }, work: { type: 'string' }, plugin: { type: 'string' }, only: { type: 'string' }, 'skip-capture': { type: 'boolean' }, fonts: { type: 'boolean' }, draft: { type: 'boolean' } },
});
const log = (text) => process.stderr.write(`[brand] ${text}\n`);

const fonts = writeFontsCss();
log(`fonts.css: ${fonts.faces.length} faces from ${path.dirname(path.dirname(fonts.faces[0].path))}`);
if (values.fonts) process.exit(0);

for (const test of ['math.test.mjs', 'kit.test.mjs']) execFileSync(process.execPath, [path.join(HERE, test)], { stdio: 'inherit' });

const port = Number(values.port || process.env.ETZ_MEDIA_PORT || 9371);
const outDir = path.resolve(values.out || path.join(os.tmpdir(), 'easy-tikz-media', 'brand'));
const workDir = path.resolve(values.work || path.join(os.tmpdir(), 'easy-tikz-media', `brand-${port}`));
const shotsDir = path.join(HERE, 'proofs', 'shots');
const only = values.only ? values.only.split(',').map((s) => s.trim()) : null;

if (!values['skip-capture']) {
    // The toolkit wipes its work dir on every start, so Obsidian gets a folder of its own inside ours.
    await capture({ port, workDir: path.join(workDir, 'obsidian'), plugin: values.plugin, shotsDir, log });
} else if (!fs.existsSync(path.join(shotsDir, 'meta.js'))) {
    throw new Error(`--skip-capture: ${shotsDir} holds no captures yet`);
}

const chrome = await launchChromium({ port, workDir: path.join(workDir, 'chromium') });
let failed = false;
try {
    for (const p of PAGES) {
        if (only && !only.includes(p.name)) continue;
        const out = path.join(outDir, p.out);
        try {
            const r = await renderPage(chrome, path.join(HERE, p.page), out, { width: p.width, height: p.height, shotsDir, cacheDir: path.join(workDir, 'crops'), allowFonts: p.allowFonts || [], strict: !values.draft });
            for (const problem of r.problems) log(`${p.out}: ${problem}`);
            const used = (await fontsUsed(chrome.cdp)).map((f) => `${f.postScriptName} ${f.glyphCount}`).join(', ');
            const bytes = optimisePng(out);
            // The legibility rule of the brand: look at every image 800 px wide as well.
            if (p.small) execFileSync('magick', [out, '-filter', 'Lanczos', '-resize', '800x', '-strip', out.replace(/\.png$/, '-800.png')]);
            if (p.keep) fs.copyFileSync(out, path.join(HERE, p.out));
            log(`${p.out}: ${r.width} x ${r.height}, ${(bytes / 1024).toFixed(0)} KB  (fonts: ${used})`);
        } catch (e) {
            failed = true;
            log(`${p.out}: FAILED\n${e.message}`);
        }
    }
} finally {
    await chrome.close();
}
if (failed) process.exit(1);
log(`wrote to ${outDir}`);
