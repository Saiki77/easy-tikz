/* eslint-env node */
// Render a brand page (a template that uses page.mjs) to a PNG of exact
// size with the headless Chromium of lib/chromium.mjs.
//
//   import { launchChromium } from '../lib/chromium.mjs';
//   import { renderPage } from './render.mjs';
//   const chrome = await launchChromium({ port: 9371 });
//   try {
//       await renderPage(chrome, 'scripts/media/brand/proofs/hero.html', 'out/hero.png', { width: 2400, height: 1350, shotsDir: '.../shots' });
//   } finally {
//       await chrome.close();
//   }
//
// What it adds to chrome.render():
//   - fonts.css is written first (fonts.mjs), and after the page has loaded every text is checked to
//     be drawn with a TeX font: a page that fell back to a system font is an error, not a picture;
//   - the page reports its own problems (page.mjs: a missing capture, an enlarged crop, text off the
//     page, more than three callouts): any of them fails the render;
//   - every capture on the page is cropped and resampled once by ImageMagick (Lanczos) to exactly the
//     device pixels it covers, instead of leaving a 3456 px picture to the browser's scaler. That is
//     what keeps the screenshots sharp.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sleep, waitFor } from '../lib/cdp.mjs';
import { verifyFonts, writeFontsCss } from './fonts.mjs';

/**
 *   chrome      from launchChromium()
 *   page        path of the template
 *   out         PNG to write
 *   width, height   the page in CSS px
 *   scale       device scale factor (default 1: the PNG is width x height pixels)
 *   query       appended to the URL ('w=..&h=..' are added for you)
 *   shotsDir    where the captures named in the metadata live (default: <template dir>/shots)
 *   cacheDir    where the resampled crops go (default: a folder in the system temp dir)
 *   resample    false: let the browser scale the captures (faster, softer)
 *   strict      false: return the problems instead of throwing
 *   allowFonts  PostScript names accepted besides the brand's
 * Returns { file, width, height, bytes, problems, fonts }.
 */
export async function renderPage(chrome, page, out, { width, height, scale = 1, query = '', shotsDir = null, cacheDir = null, resample = true, strict = true, allowFonts = [] } = {}) {
    if (!width || !height) throw new Error('renderPage: width and height are required');
    writeFontsCss();
    const cdp = chrome.cdp;
    const file = path.resolve(page);
    const shots = path.resolve(shotsDir || path.join(path.dirname(file), 'shots'));
    const cache = path.resolve(cacheDir || path.join(os.tmpdir(), 'easy-tikz-media', 'brand-crops'));
    let url = `${pathToFileURL(file).href}?w=${width}&h=${height}`;
    if (query) url += `&${query}`;

    const before = chrome.errors.length;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', {});
    const nav = await cdp.send('Page.navigate', { url });
    if (nav.errorText) throw new Error(`renderPage: ${url}: ${nav.errorText}`);
    await waitFor(() => cdp.evaluate('window.brandReady === true'), { timeout: 20000, interval: 50, message: `${path.basename(file)} to call ready() of page.mjs` });

    if (resample) {
        const placed = await cdp.evaluate('window.brandShots ? window.brandShots() : []');
        const map = {};
        for (const p of placed) {
            const src = path.join(shots, p.file);
            if (!fs.existsSync(src)) throw new Error(`renderPage: capture ${src} is missing (run the capture first)`);
            const stat = fs.statSync(src);
            const key = crypto.createHash('sha1').update(JSON.stringify([src, stat.size, stat.mtimeMs, p.crop, p.box])).digest('hex').slice(0, 16);
            const target = path.join(cache, `${path.basename(p.file, '.png')}-${key}.png`);
            if (!fs.existsSync(target)) {
                fs.mkdirSync(cache, { recursive: true });
                const args = [src, '-crop', `${p.crop.width}x${p.crop.height}+${p.crop.x}+${p.crop.y}`, '+repage'];
                if (p.box.width !== p.crop.width || p.box.height !== p.crop.height) args.push('-filter', 'Lanczos', '-resize', `${p.box.width}x${p.box.height}!`);
                args.push('-strip', target);
                execFileSync('magick', args, { stdio: ['ignore', 'ignore', 'pipe'] });
            }
            map[p.id] = pathToFileURL(target).href;
        }
        if (placed.length) await cdp.call((m) => window.brandSwap(m), map);
    }
    await cdp.call(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await sleep(120);

    const problems = await cdp.evaluate('window.brandProblems ? window.brandProblems() : ["the page does not use page.mjs"]');
    problems.push(...(await verifyFonts(cdp, { allow: allowFonts })));
    for (const text of chrome.errors.slice(before)) if (!problems.some((p) => text.includes(p))) problems.push(`console: ${text}`);
    if (problems.length && strict) throw new Error(`renderPage: ${path.basename(file)}:\n` + problems.map((p) => `  - ${p}`).join('\n'));

    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    await cdp.screenshot(out, { clip: { x: 0, y: 0, width, height, scale: 1 }, captureBeyondViewport: false });
    return { file: out, width: Math.round(width * scale), height: Math.round(height * scale), bytes: fs.statSync(out).size, problems };
}

/**
 * Make a PNG smaller without touching a pixel: strip metadata and let
 * ImageMagick try its strongest deflate settings. Returns the new size in bytes.
 */
export function optimisePng(file) {
    const tmp = `${file}.tmp.png`;
    execFileSync('magick', [file, '-strip', '-define', 'png:compression-level=9', '-define', 'png:compression-filter=5', '-define', 'png:compression-strategy=1', '-define', 'png:exclude-chunk=all', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (fs.statSync(tmp).size < fs.statSync(file).size) fs.renameSync(tmp, file);
    else fs.rmSync(tmp);
    return fs.statSync(file).size;
}
