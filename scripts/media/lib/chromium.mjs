/* eslint-env browser, node */
// Headless Chromium for composed pages (promo cards, social images): an
// HTML file goes in, a PNG of exact pixel size comes out. Uses the
// Chromium that Playwright keeps in ~/Library/Caches/ms-playwright (or
// CHROMIUM_BIN); nothing is installed. Not Obsidian: for pictures of the
// plugin itself use lib/obsidian.mjs.
//
//   const chrome = await launchChromium({ port: 9343 });
//   try {
//       await chrome.render('scripts/media/promo/hero.html', 'docs/media/hero.png', { width: 2400, height: 1350 });
//   } finally {
//       await chrome.close();
//   }
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, listTargets, sleep, waitFor } from './cdp.mjs';

/** The newest headless shell (or full Chromium) in Playwright's cache, or CHROMIUM_BIN. */
export function findChromium() {
    if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
    const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
    let names = [];
    try {
        names = fs.readdirSync(cache);
    } catch {
        names = [];
    }
    const newest = (prefix) =>
        names
            .filter((n) => n.startsWith(prefix) && /-\d+$/.test(n))
            .sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop()))
            .reverse();
    for (const dir of newest('chromium_headless_shell-')) {
        const bin = path.join(cache, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
        if (fs.existsSync(bin)) return bin;
    }
    for (const dir of newest('chromium-')) {
        const bin = path.join(cache, dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
        if (fs.existsSync(bin)) return bin;
    }
    throw new Error('No headless Chromium found in ~/Library/Caches/ms-playwright. Set CHROMIUM_BIN to a Chromium or Chrome binary.');
}

/**
 * Start headless Chromium on `port` and return { cdp, render, close }.
 *   port      debugging port (required; use your script's own)
 *   workDir   profile directory (default <tmp>/easy-tikz-media/chromium-<port>, wiped on start)
 */
export async function launchChromium({ port, workDir } = {}) {
    if (!port) throw new Error('launchChromium: a port is required');
    if (await listTargets(port)) throw new Error(`Port ${port} is in use by another program.`);
    const profile = path.resolve(workDir || path.join(os.tmpdir(), 'easy-tikz-media', `chromium-${port}`));
    fs.rmSync(profile, { recursive: true, force: true });
    fs.mkdirSync(profile, { recursive: true });
    const bin = findChromium();
    const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', 'about:blank'];
    if (!/headless-shell/.test(bin)) args.unshift('--headless=new');
    const child = spawn(bin, args, { stdio: 'ignore' });
    let exited = false;
    child.on('exit', () => {
        exited = true;
    });
    const killOnExit = () => {
        if (!exited) child.kill('SIGKILL');
    };
    process.on('exit', killOnExit);

    let cdp;
    try {
        cdp = await connect({ port, match: (t) => t.type === 'page', timeout: 20000 });
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
    } catch (e) {
        killOnExit();
        throw e;
    }
    const errors = [];
    cdp.on((method, params) => {
        if (method === 'Runtime.exceptionThrown') errors.push(String((params.exceptionDetails.exception && params.exceptionDetails.exception.description) || params.exceptionDetails.text));
        else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push((params.args || []).map((a) => a.value || a.description).join(' '));
    });

    /**
     * Render a page to a PNG of exactly width x height CSS px times `scale`.
     *   page       path of an HTML file, or a URL
     *   out        PNG to write
     *   width, height   viewport in CSS px
     *   scale      device scale factor (default 1: the PNG is width x height pixels)
     *   query      appended to a file URL, for example 'theme=dark'
     *   selector   capture this element instead of the viewport
     *   transparent   true: no white page background
     *   settle     extra ms to wait after fonts and images are ready (default 100)
     * Returns { file, width, height } in pixels.
     */
    async function render(page, out, { width, height, scale = 1, query = '', selector = null, transparent = false, settle = 100 } = {}) {
        if (!width || !height) throw new Error('render: width and height are required');
        let url = /^[a-z]+:\/\//i.test(page) ? page : pathToFileURL(path.resolve(page)).href;
        if (query) url += (url.includes('?') ? '&' : '?') + query;
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
        await cdp.send('Emulation.setDefaultBackgroundColorOverride', transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
        const loaded = new Promise((resolve) => {
            const off = cdp.on((method) => {
                if (method === 'Page.loadEventFired') {
                    off();
                    resolve();
                }
            });
        });
        const nav = await cdp.send('Page.navigate', { url });
        if (nav.errorText) throw new Error(`render: ${url}: ${nav.errorText}`);
        await Promise.race([loaded, sleep(15000)]);
        // Fonts loaded, every image decoded, two frames painted.
        await cdp.call(async () => {
            if (document.fonts && document.fonts.ready) await document.fonts.ready;
            await Promise.all(Array.from(document.images).map((img) => (img.complete && img.naturalWidth > 0 ? null : img.decode().catch(() => null))));
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        });
        const broken = await cdp.call(() => Array.from(document.images).filter((img) => !(img.complete && img.naturalWidth > 0)).map((img) => img.getAttribute('src')));
        if (broken.length) throw new Error(`render: ${page}: images did not load: ${broken.join(', ')}`);
        if (settle) await sleep(settle);
        let clip = { x: 0, y: 0, width, height, scale: 1 };
        if (selector) {
            const r = await cdp.call((sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const b = el.getBoundingClientRect();
                return { x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height };
            }, selector);
            if (!r) throw new Error(`render: ${page}: nothing matches ${selector}`);
            clip = { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height), scale: 1 };
        }
        await cdp.screenshot(out, { clip, captureBeyondViewport: !!selector });
        return { file: out, width: Math.round(clip.width * scale), height: Math.round(clip.height * scale) };
    }

    async function close() {
        process.removeListener('exit', killOnExit);
        cdp.close();
        if (!exited) child.kill('SIGTERM');
        await waitFor(() => exited, { timeout: 3000, interval: 50 }).catch(() => {
            if (!exited) child.kill('SIGKILL');
        });
        fs.rmSync(profile, { recursive: true, force: true });
    }

    return { cdp, errors, render, close };
}
