/* eslint-env node */
// Headless Chromium for the stage: the same binary and the same client as
// lib/chromium.mjs (findChromium, lib/cdp.mjs), started with two more
// flags. Without them a screenshot waits for the next frame of a display
// that does not exist, about a quarter of a second each, whatever the page
// shows; with them a 1920 x 1080 frame takes about 35 ms. A film has
// several hundred frames, so this is the difference between four minutes
// and one.
//
//   const chrome = await launchStageChromium({ port: 9373 });
//   try { ... chrome.cdp ... } finally { await chrome.close(); }
//
// ETZ_CINEMA_PLAIN=1 uses lib/chromium.mjs as it is (slow, for comparing).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect, listTargets, waitFor } from '../lib/cdp.mjs';
import { findChromium, launchChromium } from '../lib/chromium.mjs';

/** Frames are produced as fast as they are asked for, not at the rate of a display. */
const FAST = ['--disable-frame-rate-limit', '--disable-gpu-vsync'];

/**
 * Start headless Chromium on `port` and return { cdp, errors, close }.
 *   port      debugging port (required; the script's own)
 *   workDir   profile directory (default <tmp>/easy-tikz-media/stage-<port>, wiped on start and removed on close)
 */
export async function launchStageChromium({ port, workDir } = {}) {
    if (!port) throw new Error('launchStageChromium: a port is required');
    if (process.env.ETZ_CINEMA_PLAIN) return launchChromium({ port, workDir });
    if (await listTargets(port)) throw new Error(`Port ${port} is in use by another program.`);
    const profile = path.resolve(workDir || path.join(os.tmpdir(), 'easy-tikz-media', `stage-${port}`));
    fs.rmSync(profile, { recursive: true, force: true });
    fs.mkdirSync(profile, { recursive: true });
    const bin = findChromium();
    const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', ...FAST, 'about:blank'];
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

    async function close() {
        process.removeListener('exit', killOnExit);
        cdp.close();
        if (!exited) child.kill('SIGTERM');
        await waitFor(() => exited, { timeout: 3000, interval: 50 }).catch(() => {
            if (!exited) child.kill('SIGKILL');
        });
        fs.rmSync(profile, { recursive: true, force: true });
    }

    return { cdp, errors, close };
}
