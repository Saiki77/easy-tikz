/* eslint-env browser, node */
/* global app, activeDocument */
// Drive a second, ISOLATED Obsidian with the plugin installed: its own
// profile (--user-data-dir), its own throwaway vault, its own debugging
// port. The user's own Obsidian, profile and vaults are never touched (the
// newest obsidian-*.asar of the profile is copied read-only, because the
// app bundle alone is older than the plugin's minAppVersion).
//
//   import { launch } from './lib/obsidian.mjs';
//   const obs = await launch({ port: 9341 });
//   try {
//       await obs.openEditor();
//       await obs.loadChart(chart);
//       await obs.screenshot('editor.png', { clip: 'editor' });
//   } finally {
//       await obs.quit();
//   }
//
// Functions passed to `obs.call` run in the page: they are sent as source
// text and can only use their arguments and `window.__etzMedia` (the helpers
// installed by pageHooks below). See README.md in this folder for the API.
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, listTargets, sleep, waitFor } from './cdp.mjs';

export { sleep, waitFor };

/** Repository root (this file is scripts/media/lib/obsidian.mjs). */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PLUGIN_ID = 'easy-tikz';
/** Port convention: one port per script, so several can run at once. See README.md. */
export const PORTS = { smoke: 9341, guides: 9342, promo: 9343, video: 9344 };

/**
 * Version of the "What's new" popup in the sources (WHATS_NEW_VERSION in
 * src/whatsnew.ts). Read from the file, so pictures never show the popup
 * after its content changes.
 */
function whatsNewVersion() {
    try {
        const src = fs.readFileSync(path.join(REPO, 'src', 'whatsnew.ts'), 'utf8');
        const m = /export const WHATS_NEW_VERSION = '([^']+)'/.exec(src);
        if (m) return m[1];
    } catch {
        // An older checkout without the popup: the record does no harm.
    }
    return '4.2.0';
}

/**
 * What every capture vault starts with in the plugin's data.json:
 *   dragTipSeen     the one-time first-hover tip of the editor preview stays away
 *   whatsNewSeen    the "What's new" popup stays away (without it, data.json reads like that of a user who updated)
 * Pass `pluginData` to launch() to change them, e.g. { whatsNewSeen: undefined } for a user coming from 3.x.
 */
export const DEFAULT_PLUGIN_DATA = Object.freeze({ dragTipSeen: true, whatsNewSeen: whatsNewVersion() });

const OBSIDIAN_BIN = process.env.OBSIDIAN_BIN || '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const USER_PROFILE = path.join(os.homedir(), 'Library', 'Application Support', 'obsidian');
const MARKER = '.etz-media-workdir';

/**
 * Private fields of TikzModal (src/modal.ts) the toolkit reads. TypeScript
 * `private` is compile-time only and the bundle is not minified, so they
 * exist at runtime. If one is renamed, openEditor() fails with a message
 * naming it: update the name here and in pageHooks.
 */
const MODAL_FIELDS = ['settings', 'layout', 'chartEl', 'chartSvg', 'issues', 'frameRaf', 'fullTimer', 'updateTimer', 'statusTimer', 'codeTimer', 'activeTab', 'build', 'dock', 'ready'];

/**
 * Core plugins of the capture vault: the ones that only add ribbon icons
 * or status bar items (word count, backlinks, sync) are off, so the
 * window is calm and nothing sits on top of a note's bottom right corner.
 */
const CORE_PLUGINS = {
    'file-explorer': true,
    'global-search': true,
    switcher: true,
    'command-palette': true,
    'page-preview': true,
    properties: true,
    graph: false,
    backlink: false,
    canvas: false,
    'outgoing-link': false,
    'tag-pane': false,
    footnotes: false,
    'daily-notes': false,
    templates: false,
    'note-composer': false,
    'slash-command': false,
    'editor-status': false,
    bookmarks: false,
    'zk-prefixer': false,
    'random-note': false,
    outline: false,
    'word-count': false,
    slides: false,
    'audio-recorder': false,
    workspaces: false,
    'file-recovery': false,
    publish: false,
    sync: false,
    bases: false,
    webviewer: false,
};

// --------------------------------------------------------------- small helpers

/** A fenced `easy-tikz` block for a note, exactly as "Insert into note" writes it. */
export function chartBlock(data) {
    return '```easy-tikz\n' + JSON.stringify(data, null, 2) + '\n```';
}

/** Default work dir of a port: <tmp>/easy-tikz-media/port-<port> (override with ETZ_MEDIA_WORK). */
export function defaultWorkDir(port) {
    return process.env.ETZ_MEDIA_WORK || path.join(os.tmpdir(), 'easy-tikz-media', `port-${port}`);
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/** The newest obsidian-*.asar in the user's profile (read only), or null. */
function newestAsar() {
    let names = [];
    try {
        names = fs.readdirSync(USER_PROFILE).filter((n) => /^obsidian-\d+\.\d+\.\d+\.asar$/.test(n));
    } catch {
        return null;
    }
    const version = (n) => n.match(/\d+/g).map(Number);
    names.sort((a, b) => {
        const [va, vb] = [version(a), version(b)];
        return va[0] - vb[0] || va[1] - vb[1] || va[2] - vb[2];
    });
    return names.length ? path.join(USER_PROFILE, names[names.length - 1]) : null;
}

// --------------------------------------------------------------- plugin build

/**
 * Bundle the plugin from the current sources into `outDir` (main.js,
 * styles.css, manifest.json) without touching the files in the repository
 * root. Same options as esbuild.config.mjs (production) and the same
 * stylesheet order as scripts/build-css.mjs.
 */
export async function buildPlugin(outDir) {
    const { default: esbuild } = await import('esbuild');
    const { builtinModules } = await import('node:module');
    fs.mkdirSync(outDir, { recursive: true });
    await esbuild.build({
        entryPoints: [path.join(REPO, 'main.ts')],
        bundle: true,
        external: ['obsidian', 'electron', '@codemirror/*', ...builtinModules],
        format: 'cjs',
        target: 'es2016',
        logLevel: 'silent',
        treeShaking: true,
        // docs/ai.md is bundled as text (the AI server's guide), as esbuild.config.mjs does.
        loader: { '.md': 'text' },
        outfile: path.join(outDir, 'main.js'),
    });
    const uiDir = path.join(REPO, 'src', 'ui');
    const parts = [path.join(REPO, 'src', 'styles.css')];
    for (const f of fs.readdirSync(uiDir).filter((n) => n.endsWith('.css')).sort()) parts.push(path.join(uiDir, f));
    const css = parts.map((p) => `/* ---- ${path.relative(REPO, p)} ---- */\n` + fs.readFileSync(p, 'utf8').trimEnd() + '\n').join('\n');
    fs.writeFileSync(path.join(outDir, 'styles.css'), css);
    fs.copyFileSync(path.join(REPO, 'manifest.json'), path.join(outDir, 'manifest.json'));
    return outDir;
}

/**
 * Bundle a TypeScript module of the repository (pure ones only: nothing
 * that imports 'obsidian') and import it in Node:
 *   const { EXAMPLES } = await importTs('src/migrate.ts');
 *   const { GUIDES } = await importTs('src/guides/index.ts');
 */
export async function importTs(entry) {
    const { default: esbuild } = await import('esbuild');
    const abs = path.resolve(REPO, entry);
    const outDir = path.join(os.tmpdir(), 'easy-tikz-media', 'bundles');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = crypto.createHash('sha1').update(abs).digest('hex').slice(0, 10);
    const outfile = path.join(outDir, `${path.basename(entry).replace(/\.ts$/, '')}-${stamp}-${process.pid}-${Date.now()}.mjs`);
    await esbuild.build({ entryPoints: [abs], bundle: true, platform: 'node', format: 'esm', target: 'node18', outfile, logLevel: 'silent', external: ['obsidian'], loader: { '.md': 'text' } });
    try {
        return await import(outfile);
    } finally {
        fs.rmSync(outfile, { force: true });
    }
}

// --------------------------------------------------------------- vault + profile

/**
 * Create (or reset) the work dir: <workDir>/vault with the plugin
 * installed and enabled, <workDir>/userdata as the Obsidian profile.
 *
 *   workDir     where everything lives; a dir this toolkit did not create is never wiped
 *   plugin      'source' (default): bundle the current sources privately;
 *               'root': copy main.js, styles.css, manifest.json from the repository root (what `npm run build` made);
 *               a directory path: copy the three files from there
 *   theme       'light' (default) or 'dark'
 *   pluginData  merged into the plugin's data.json (over DEFAULT_PLUGIN_DATA, see README);
 *               null writes no data.json at all (a fresh install; with an easy-tikz block in a note the
 *               plugin takes it for a 3.x user and shows the "What's new" popup)
 *   notes       { 'Name.md': 'markdown' } written into the vault
 *   fresh       true (default): wipe the vault and the profile first
 *   appConfig   merged into .obsidian/app.json
 *   corePlugins merged into .obsidian/core-plugins.json (see CORE_PLUGINS)
 */
export async function prepare({ workDir, plugin = process.env.ETZ_MEDIA_PLUGIN || 'source', theme = 'light', pluginData = {}, notes = {}, fresh = true, appConfig = {}, corePlugins = {} } = {}) {
    if (!workDir) throw new Error('prepare: workDir is required');
    workDir = path.resolve(workDir);
    const home = os.homedir();
    if (workDir === home || workDir === '/' || workDir.startsWith(USER_PROFILE) || fs.existsSync(path.join(workDir, '.obsidian'))) {
        throw new Error(`prepare: refusing to use ${workDir} as a work dir (home, the Obsidian profile or a vault)`);
    }
    const marker = path.join(workDir, MARKER);
    if (fs.existsSync(workDir) && fs.readdirSync(workDir).length && !fs.existsSync(marker)) {
        throw new Error(`prepare: ${workDir} exists and was not created by this toolkit (no ${MARKER} file). Choose an empty or new directory.`);
    }
    const vault = path.join(workDir, 'vault');
    const userData = path.join(workDir, 'userdata');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(marker, 'Created by scripts/media/lib/obsidian.mjs. Safe to delete.\n');

    if (fresh) {
        fs.rmSync(vault, { recursive: true, force: true });
        if (fs.existsSync(userData)) {
            // The copied asar (27 MB) is kept; everything else of the profile goes.
            for (const name of fs.readdirSync(userData)) {
                if (!/^obsidian-.*\.asar$/.test(name)) fs.rmSync(path.join(userData, name), { recursive: true, force: true });
            }
        }
    }
    const pluginDir = path.join(vault, '.obsidian', 'plugins', PLUGIN_ID);
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(userData, { recursive: true });

    // Plugin files.
    if (plugin === 'source') {
        await buildPlugin(pluginDir);
    } else {
        const from = plugin === 'root' ? REPO : path.resolve(plugin);
        for (const f of ['main.js', 'styles.css', 'manifest.json']) {
            const src = path.join(from, f);
            if (!fs.existsSync(src)) throw new Error(`prepare: ${src} is missing${plugin === 'root' ? ' (run `npm run build` first, or use plugin: "source")' : ''}`);
            fs.copyFileSync(src, path.join(pluginDir, f));
        }
    }
    const dataFile = path.join(pluginDir, 'data.json');
    if (pluginData === null) {
        // A fresh install: the plugin never saved anything.
        fs.rmSync(dataFile, { force: true });
    } else {
        const stored = !fresh && fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : {};
        writeJson(dataFile, { ...DEFAULT_PLUGIN_DATA, ...stored, ...pluginData });
    }

    // Vault configuration.
    const config = path.join(vault, '.obsidian');
    writeJson(path.join(config, 'community-plugins.json'), [PLUGIN_ID]);
    // nativeMenus off: on macOS Obsidian otherwise pops up system menus, which are not part of the page
    // (no screenshot shows them) and block the app while they are open.
    writeJson(path.join(config, 'app.json'), { promptDelete: false, spellcheck: false, showInlineTitle: true, readableLineLength: true, nativeMenus: false, ...appConfig });
    writeJson(path.join(config, 'appearance.json'), { theme: theme === 'dark' ? 'obsidian' : 'moonstone' });
    writeJson(path.join(config, 'core-plugins.json'), { ...CORE_PLUGINS, ...corePlugins });
    for (const [name, text] of Object.entries(notes)) {
        const file = path.join(vault, name.endsWith('.md') ? name : `${name}.md`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    if (!fs.readdirSync(vault).some((n) => n.endsWith('.md'))) fs.writeFileSync(path.join(vault, 'Start.md'), '');

    // Profile: the app package and the vault list.
    const asar = newestAsar();
    if (asar) {
        const dest = path.join(userData, path.basename(asar));
        if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(asar).size) fs.copyFileSync(asar, dest);
    }
    const vaultId = crypto.createHash('sha1').update(vault).digest('hex').slice(0, 16);
    writeJson(path.join(userData, 'obsidian.json'), { vaults: { [vaultId]: { path: vault, ts: Date.now(), open: true } }, updateDisabled: true });
    return { workDir, vault, userData, pluginDir, vaultId };
}

// --------------------------------------------------------------- processes

/** Main-process pids of an Obsidian started on exactly this profile directory (never the user's own). */
function pidsForProfile(userData) {
    let out = '';
    try {
        out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    } catch {
        return [];
    }
    const pids = [];
    for (const line of out.split('\n')) {
        const m = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (!m) continue;
        const cmd = m[2];
        if (cmd.includes(`--user-data-dir=${userData}`) && !cmd.includes('--type=')) pids.push(Number(m[1]));
    }
    return pids;
}

/** Something accepts TCP connections on the port. */
function portBusy(port) {
    return new Promise((resolve) => {
        const socket = net.connect({ port, host: '127.0.0.1' });
        const done = (busy) => {
            socket.destroy();
            resolve(busy);
        };
        socket.setTimeout(1000, () => done(false));
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
    });
}

function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function killPid(pid) {
    if (!alive(pid)) return;
    try {
        process.kill(pid, 'SIGTERM');
    } catch {
        return;
    }
    for (let i = 0; i < 50 && alive(pid); i++) await sleep(100);
    if (alive(pid)) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // already gone
        }
        for (let i = 0; i < 20 && alive(pid); i++) await sleep(100);
    }
}

// --------------------------------------------------------------- page side

/**
 * Installed once per page as window.__etzMedia. Everything here runs inside
 * Obsidian. It only observes (Modal.open is wrapped to remember the editor
 * modal) and computes geometry; it never changes plugin behaviour.
 */
function pageHooks(modalFields) {
    if (window.__etzMedia) return 'present';
    const M = { modals: [] };
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

    // Obsidian's Modal base class: the last prototype of the settings modal that defines open() and onOpen().
    let proto = Object.getPrototypeOf(app.setting);
    let base = null;
    while (proto && proto !== Object.prototype) {
        if (own(proto, 'open') && own(proto, 'onOpen')) base = proto;
        proto = Object.getPrototypeOf(proto);
    }
    if (!base) throw new Error('toolkit: Obsidian Modal base class not found (app.setting changed?)');
    const open = base.open;
    base.open = function (...args) {
        // Remember open modals only: closed ones (their element left the document) are dropped here.
        M.modals = M.modals.filter((m) => m !== this && m.modalEl && m.modalEl.isConnected);
        M.modals.push(this);
        return open.apply(this, args);
    };

    /** The open Easy TikZ editor modal (the TikzModal instance), or null. */
    M.editor = () => {
        for (let i = M.modals.length - 1; i >= 0; i--) {
            const m = M.modals[i];
            if (typeof m.loadChart === 'function' && typeof m.showTab === 'function' && m.modalEl && m.modalEl.isConnected && m.modalEl.ownerDocument === document) return m;
        }
        return null;
    };
    M.requireEditor = () => {
        const m = M.editor();
        if (!m) throw new Error('toolkit: the Easy TikZ editor is not open (call openEditor first)');
        return m;
    };
    /** Names from MODAL_FIELDS the editor instance does not have. */
    M.missingFields = () => {
        const m = M.requireEditor();
        return modalFields.filter((f) => !(f in m));
    };

    M.rect = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    M.visible = (el) => {
        if (!el || !el.isConnected) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    /** The on-screen box of the 2D chart picture (the SVG viewBox, letterboxed in its element) and its scale. */
    M.svgBox = () => {
        const m = M.requireEditor();
        const svg = m.chartSvg;
        const layout = m.layout;
        if (!svg || !layout || !svg.isConnected) return null;
        const r = svg.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        const s = Math.min(r.width / layout.width, r.height / layout.height);
        return { s, ox: r.left + (r.width - layout.width * s) / 2, oy: r.top + (r.height - layout.height * s) / 2, width: layout.width * s, height: layout.height * s };
    };
    /** Math coordinates of the 2D editor preview to client px (the inverse of TikzModal.toMath). */
    M.mathToClient = (x, y) => {
        const m = M.requireEditor();
        const box = M.svgBox();
        const layout = m.layout;
        if (!box || !layout) throw new Error('toolkit: no 2D chart layout (3D chart, or the preview has not rendered yet)');
        const v = layout.view;
        const vx = layout.plot.x + ((x - v.xmin) / (v.xmax - v.xmin)) * layout.plot.w;
        const vy = layout.plot.y + ((v.ymax - y) / (v.ymax - v.ymin)) * layout.plot.h;
        return { x: box.ox + vx * box.s, y: box.oy + vy * box.s };
    };
    M.clientToMath = (cx, cy) => {
        const m = M.requireEditor();
        const box = M.svgBox();
        const layout = m.layout;
        if (!box || !layout) throw new Error('toolkit: no 2D chart layout (3D chart, or the preview has not rendered yet)');
        const v = layout.view;
        const fx = ((cx - box.ox) / box.s - layout.plot.x) / layout.plot.w;
        const fy = ((cy - box.oy) / box.s - layout.plot.y) / layout.plot.h;
        return { x: v.xmin + fx * (v.xmax - v.xmin), y: v.ymax - fy * (v.ymax - v.ymin) };
    };

    /** The markdown view of the active leaf's element. */
    M.noteEl = () => document.querySelector('.workspace-leaf.mod-active .view-content') || document.querySelector('.workspace-leaf .view-content');
    /** Rendered charts in the active note. */
    M.inlineCharts = () => {
        const root = M.noteEl();
        return root ? Array.from(root.querySelectorAll('.etz-inline')).filter(M.visible) : [];
    };

    /** A range input by slider name: in the editor's Sliders dock, or in a note's slider strip. */
    M.sliderInput = (name, scope, chartIndex) => {
        const pick = (root) => {
            if (!root) return null;
            for (const input of root.querySelectorAll('input[type=range]')) {
                const id = input.getAttribute('aria-labelledby');
                const label = id ? document.getElementById(id) : null;
                if (label && label.textContent.trim() === name) return input;
            }
            return null;
        };
        if (scope === 'note') return pick(M.inlineCharts()[chartIndex || 0]);
        const m = M.requireEditor();
        return pick(m.modalEl.querySelector('.etz-dock'));
    };
    /** Client point on a range input's track where its thumb sits for `value`. */
    M.sliderPoint = (input, value) => {
        const r = input.getBoundingClientRect();
        const min = parseFloat(input.min);
        const max = parseFloat(input.max);
        const ratio = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
        const css = getComputedStyle(input);
        const thumb = parseFloat(css.getPropertyValue('--slider-thumb-width')) || parseFloat(css.height) || 18;
        return { x: r.left + thumb / 2 + ratio * (r.width - thumb), y: r.top + r.height / 2 };
    };

    /** Resolve a clip name or selector to a rectangle in client px (null when there is nothing to show). */
    M.clipRect = (clip) => {
        const full = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
        if (!clip || clip === 'window') return full;
        if (typeof clip === 'object') return clip;
        const m = M.editor();
        let el = null;
        if (clip === 'editor') el = m ? m.modalEl : null;
        else if (clip === 'stage') el = m ? m.modalEl.querySelector('.etz-stage') : null;
        else if (clip === 'dock') el = m ? m.modalEl.querySelector('.etz-dock') : null;
        else if (clip === 'panel') el = m ? m.modalEl.querySelector('.etz-editor') : null;
        else if (clip === 'note') el = M.noteEl();
        else if (clip === 'page') {
            // The text column of the note (readable line width), without the margins around it.
            const root = M.noteEl();
            el = root ? Array.from(root.querySelectorAll('.markdown-preview-sizer, .cm-sizer')).find(M.visible) || null : null;
        }
        else if (clip === 'inline') el = M.inlineCharts()[0] || null;
        else if (clip === 'preview') {
            if (!m) return null;
            const box = m.layout ? M.svgBox() : null;
            if (box) return { x: box.ox, y: box.oy, width: box.width, height: box.height };
            el = m.chartEl;
        } else {
            el = Array.from(document.querySelectorAll(clip)).find(M.visible) || null;
        }
        return el ? M.rect(el) : null;
    };

    /** Nothing of the editor (or of the charts in the active note) is still waiting to draw. */
    M.idle = () => {
        const m = M.editor();
        if (m) {
            if (m.frameRaf != null || m.fullTimer != null || m.updateTimer != null || m.statusTimer != null) return false;
            if (m.activeTab === 'code' && m.codeTimer != null) return false;
            if (!m.chartEl || !m.chartEl.firstElementChild) return false;
        }
        const root = M.noteEl();
        if (root) {
            for (const block of root.querySelectorAll('.block-language-easy-tikz')) {
                if (!block.querySelector('.etz-inline svg, .etz-inline canvas, .tikz-block-error')) return false;
            }
        }
        return true;
    };
    /** A CSS transition or a finite animation is still running (hover fades, a card opening). */
    M.animating = () =>
        document.getAnimations().some((a) => {
            if (a.playState !== 'running') return false;
            const timing = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
            return !timing || Number.isFinite(timing.endTime);
        });
    /** Resolves after `n` animation frames (or 250 ms per frame when the window does not paint). */
    M.frames = (n) =>
        new Promise((resolve) => {
            let left = Math.max(1, n || 1);
            const step = () => {
                if (--left <= 0) {
                    resolve(true);
                    return;
                }
                next();
            };
            const next = () => {
                let done = false;
                const once = () => {
                    if (done) return;
                    done = true;
                    step();
                };
                window.requestAnimationFrame(once);
                window.setTimeout(once, 250);
            };
            next();
        });

    window.__etzMedia = M;
    return 'installed';
}

// --------------------------------------------------------------- keys

const NAMED_KEYS = {
    Enter: { code: 'Enter', keyCode: 13, text: '\r' },
    Tab: { code: 'Tab', keyCode: 9 },
    Escape: { code: 'Escape', keyCode: 27 },
    Backspace: { code: 'Backspace', keyCode: 8 },
    Delete: { code: 'Delete', keyCode: 46 },
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    Home: { code: 'Home', keyCode: 36 },
    End: { code: 'End', keyCode: 35 },
    PageUp: { code: 'PageUp', keyCode: 33 },
    PageDown: { code: 'PageDown', keyCode: 34 },
    Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
    Shift: { code: 'ShiftLeft', keyCode: 16, modifier: 8 },
    Control: { code: 'ControlLeft', keyCode: 17, modifier: 2 },
    Alt: { code: 'AltLeft', keyCode: 18, modifier: 1 },
    Meta: { code: 'MetaLeft', keyCode: 91, modifier: 4 },
};

function keyDef(name) {
    if (NAMED_KEYS[name]) return { key: name, ...NAMED_KEYS[name] };
    if (name.length === 1) {
        const upper = name.toUpperCase();
        if (/[A-Z]/.test(upper)) return { key: name, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: name };
        if (/[0-9]/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name };
        return { key: name, code: '', keyCode: 0, text: name };
    }
    throw new Error(`key: unknown key name "${name}" (use a single character or one of ${Object.keys(NAMED_KEYS).join(', ')})`);
}

// --------------------------------------------------------------- launch

/**
 * Prepare the work dir, start the isolated Obsidian on `port`, wait until
 * the plugin is loaded, and return the session object (see README.md).
 *
 *   port        debugging port (default 9341, or ETZ_MEDIA_PORT)
 *   workDir     default <tmp>/easy-tikz-media/port-<port>
 *   width, height   window size in CSS px (default 1440 x 900); pictures are 2x
 *   theme, plugin, pluginData, notes, fresh, appConfig, corePlugins   see prepare()
 *   sidebars    false (default) collapses both sidebars
 *   shield      true (default): the window ignores the real mouse and stays behind other windows (see shield())
 *   ignoreErrors   RegExp[] of console errors that do not count
 *   quiet       no progress lines on stderr
 */
export async function launch(options = {}) {
    const port = Number(options.port || process.env.ETZ_MEDIA_PORT || PORTS.smoke);
    const workDir = path.resolve(options.workDir || defaultWorkDir(port));
    const width = options.width || 1440;
    const height = options.height || 900;
    const scale = options.scale || 2;
    const theme = options.theme || 'light';
    const say = options.quiet ? () => {} : (text) => process.stderr.write(`[media:${port}] ${text}\n`);
    if (!fs.existsSync(OBSIDIAN_BIN)) throw new Error(`Obsidian not found at ${OBSIDIAN_BIN} (set OBSIDIAN_BIN)`);

    // A previous run on the same work dir that never quit: stop it (matched by its profile path, so never the user's app).
    const userDataPath = path.join(workDir, 'userdata');
    for (const pid of pidsForProfile(userDataPath)) {
        say(`stopping a leftover instance (pid ${pid})`);
        await killPid(pid);
    }
    if ((await listTargets(port)) || (await portBusy(port))) {
        throw new Error(`Port ${port} is in use by another program. Every script needs its own port (see scripts/media/README.md).`);
    }

    const dirs = await prepare({
        workDir,
        plugin: options.plugin,
        theme,
        pluginData: options.pluginData,
        notes: options.notes,
        fresh: options.fresh !== false,
        appConfig: options.appConfig,
        corePlugins: options.corePlugins,
    });

    const logFile = path.join(workDir, 'obsidian.log');
    const logFd = fs.openSync(logFile, 'w');
    const child = spawn(
        OBSIDIAN_BIN,
        [
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${dirs.userData}`,
            // Without these three, screenshots hang as soon as another window covers Obsidian.
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
            `--force-device-scale-factor=${scale}`,
            // macOS picks the scroll bar style from the connected pointing devices: with a mouse, scroll bars are
            // always visible and take 15 px of every scrolling panel, with a trackpad alone they overlay. This
            // default, set for this process only, pins the overlay style, so pictures do not depend on a mouse.
            '-AppleShowScrollBars',
            'WhenScrolling',
        ],
        { stdio: ['ignore', logFd, logFd] }
    );
    fs.closeSync(logFd);
    let exited = false;
    child.on('exit', (code, signal) => {
        exited = true;
        // How it ended, for runs where the app goes away on its own.
        try {
            fs.appendFileSync(logFile, `\n[media] Obsidian exited at ${new Date().toISOString()} with code ${code} signal ${signal}\n`);
        } catch {
            // the work dir may be gone already
        }
    });
    const killOnExit = () => {
        if (!exited) child.kill('SIGKILL');
    };
    process.on('exit', killOnExit);
    const onSignal = () => process.exit(130);
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    let cdp = null;
    const errors = [];
    const ignore = [/Argument must be a file path or a NativeImage/].concat(options.ignoreErrors || []);
    const pushError = (type, text) => {
        if (!ignore.some((re) => re.test(text))) errors.push({ type, text: String(text).slice(0, 2000), at: Date.now() });
    };

    async function quit() {
        process.removeListener('exit', killOnExit);
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        if (cdp) cdp.close();
        if (!exited) await killPid(child.pid);
        // Helper processes follow the main process; make sure nothing of this profile is left.
        for (const pid of pidsForProfile(dirs.userData)) await killPid(pid);
    }

    try {
        say(`starting Obsidian (profile ${dirs.userData})`);
        cdp = await connect({ port, timeout: 45000 }).catch((e) => {
            throw new Error(`${e.message}. Log: ${logFile}${exited ? ' (the app exited)' : ''}`);
        });
        cdp.on((method, params) => {
            if (method === 'Runtime.exceptionThrown') {
                const d = params.exceptionDetails || {};
                pushError('exception', (d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception');
            } else if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'assert')) {
                pushError('console.error', (params.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' '));
            } else if (method === 'Log.entryAdded' && params.entry && params.entry.level === 'error') {
                pushError('log', `${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ''}`);
            }
        });
        await cdp.send('Runtime.enable');
        await cdp.send('Log.enable');
        await cdp.send('Page.enable');
        // The window may sit behind others: the page still behaves as focused (carets, :focus-visible, key events).
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});

        const appReady = () =>
            waitFor(() => cdp.evaluate('!!(window.app && app.workspace && app.workspace.layoutReady && app.plugins && app.setting)'), {
                timeout: 45000,
                interval: 100,
                message: `the Obsidian workspace. Log: ${logFile}`,
            });
        const pluginLoaded = () => cdp.call((id) => !!app.plugins.plugins[id], PLUGIN_ID);
        await appReady();
        // A new profile starts in restricted mode behind "Do you trust the author of this vault?".
        // Clicking through it opens the settings in a second window, so community plugins are switched
        // on directly and the app is reloaded: it then starts like any trusted vault, without a dialog.
        if (await cdp.call(() => !app.plugins.isEnabled())) {
            say('new profile: enabling community plugins');
            await cdp.call(() => app.plugins.setEnable(true));
            await cdp.send('Page.reload');
            await sleep(300);
            await appReady();
        }
        await waitFor(pluginLoaded, { timeout: 20000, interval: 100, message: `the ${PLUGIN_ID} plugin to load. Log: ${logFile}` });
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
        // Leftovers that would take the keyboard or swallow the editor: the settings window, any open modal.
        await cdp.call(() => {
            if (app.setting && typeof app.setting.close === 'function') app.setting.close();
            for (const el of Array.from(document.querySelectorAll('.modal-container .modal-close-button'))) el.click();
        });
        await waitFor(() => cdp.call(() => !document.querySelector('.modal-container') && activeDocument === document), {
            timeout: 8000,
            message: 'Obsidian dialogs to close',
        });
        await cdp.call(pageHooks, MODAL_FIELDS);
    } catch (e) {
        await quit();
        throw e;
    }

    // ----------------------------------------------------------- session

    const call = (fn, ...args) => cdp.call(fn, ...args);
    const frames = (n = 1) => cdp.call((count) => window.__etzMedia.frames(count), n);

    /**
     * Wait until the picture is final: the editor has no draft, full,
     * typing or status timer pending, every chart of the active note is
     * drawn, and CSS transitions have run out (at most `transitions` ms).
     * `settle` waits that many ms first (for example 220 after a slider in
     * a note, whose full-quality render follows 150 ms after the last input).
     */
    async function waitForRender({ timeout = 15000, settle = 0, transitions = 1200 } = {}) {
        const idle = () => waitFor(() => cdp.call(() => window.__etzMedia.idle()), { timeout, interval: 25, message: 'the chart to finish rendering' });
        if (settle) await sleep(settle);
        await idle();
        await frames(2);
        if (transitions > 0) {
            await waitFor(() => cdp.call(() => !window.__etzMedia.animating()), { timeout: transitions, interval: 30 }).catch(() => {});
            await idle();
            await frames(1);
        }
    }

    /** Wait until something visible matches a CSS selector (a menu, a dialog); returns false after `timeout` ms. */
    async function waitForSelector(selector, { timeout = 5000, gone = false } = {}) {
        const probe = () =>
            cdp.call((sel) => {
                const M = window.__etzMedia;
                return Array.from(document.querySelectorAll(sel)).some(M.visible);
            }, selector);
        return waitFor(async () => (await probe()) !== gone, { timeout, interval: 30, message: `${selector} to ${gone ? 'go away' : 'appear'}` }).then(
            () => true,
            () => false
        );
    }

    /** The Electron BrowserWindow of the page, through Obsidian's own `electron.remote`: `win('w.blur()')`. */
    const win = (body) => cdp.evaluate(`(() => { const w = window.require('electron').remote.getCurrentWindow(); ${body} })()`);

    /**
     * Size the page to exactly w x h CSS px. The real window is resized
     * when the screen can hold it; otherwise the page is laid out at that
     * size by device metrics emulation (pictures are the same either way).
     */
    async function setWindowSize(w, h) {
        const inner = () => cdp.call(() => ({ w: window.innerWidth, h: window.innerHeight }));
        await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
        let got = await inner();
        try {
            await win(`if (w.isFullScreen()) w.setFullScreen(false); if (w.isMaximized()) w.unmaximize(); w.setContentSize(${w}, ${h});`);
            await waitFor(async () => {
                got = await inner();
                return got.w === w && got.h === h;
            }, { timeout: 1500, interval: 50 }).catch(() => {});
            if (got.w !== w || got.h !== h) {
                // The window may only need to move to the top left corner to fit.
                await win(`w.setBounds({ x: 0, y: 0, width: ${w}, height: ${h} }); w.setContentSize(${w}, ${h});`);
                await sleep(250);
                got = await inner();
            }
        } catch {
            // No window control: emulate below.
        }
        if (got.w !== w || got.h !== h) {
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false });
            await sleep(200);
            got = await inner();
            if (got.w !== w || got.h !== h) throw new Error(`setWindowSize: asked for ${w} x ${h}, got ${got.w} x ${got.h}`);
        }
        await frames(2);
        return got;
    }

    /**
     * Keep the capture and the person at the machine out of each other's
     * way: the window ignores the real mouse (scripted input still
     * arrives) and goes behind the other windows without the keyboard.
     */
    async function shield(on = true) {
        await win(on ? 'w.setIgnoreMouseEvents(true); w.blur();' : 'w.setIgnoreMouseEvents(false); w.show(); w.focus();').catch(() => {});
        await sleep(100);
    }

    async function setTheme(name) {
        const dark = name === 'dark';
        await cdp.call((id) => {
            if (typeof app.changeTheme === 'function') app.changeTheme(id);
            else {
                app.vault.setConfig('theme', id);
                app.updateTheme();
            }
        }, dark ? 'obsidian' : 'moonstone');
        await waitFor(() => cdp.call((d) => document.body.classList.contains(d ? 'theme-dark' : 'theme-light'), dark), { timeout: 5000, message: `the ${name} theme` });
        await frames(2);
        if (await cdp.call(() => !!window.__etzMedia.editor())) {
            // Colours are read from CSS variables at render time: draw the chart again in the new theme.
            await cdp.call(() => window.__etzMedia.editor().requestUpdate());
            await sleep(80);
            await waitForRender();
        }
    }

    async function setSidebars(show) {
        await cdp.call((on) => {
            for (const split of [app.workspace.leftSplit, app.workspace.rightSplit]) {
                if (!split) continue;
                if (on) split.expand();
                else split.collapse();
            }
        }, !!show);
        await sleep(250);
    }

    // ----------------------------------------------------------- targets

    /**
     * Resolve a target to a client point { x, y }:
     *   [x, y]                         math coordinates of the 2D editor preview
     *   { x, y }                       client px
     *   'css selector'                 centre of the first visible match
     *   { selector, text, at }         first visible match whose text is `text` (trimmed); `at` = [fx, fy] inside it
     *   { preview: [fx, fy] }          fractions of the editor's chart box (works in 3D)
     *   { slider: name, value, scope, chart }   where the thumb of a slider sits for `value` ('editor' dock or 'note' strip)
     */
    async function point(target) {
        if (Array.isArray(target)) return cdp.call((x, y) => window.__etzMedia.mathToClient(x, y), target[0], target[1]);
        if (typeof target === 'string') target = { selector: target };
        if (target && typeof target.x === 'number' && typeof target.y === 'number' && !target.selector) return { x: target.x, y: target.y };
        if (target && target.preview) {
            return cdp.call((fx, fy) => {
                const m = window.__etzMedia.requireEditor();
                const r = m.chartEl.getBoundingClientRect();
                return { x: r.left + fx * r.width, y: r.top + fy * r.height };
            }, target.preview[0], target.preview[1]);
        }
        if (target && target.slider) {
            const p = await cdp.call(
                (name, value, scope, index) => {
                    const M = window.__etzMedia;
                    const input = M.sliderInput(name, scope, index);
                    if (!input) return null;
                    input.scrollIntoView({ block: 'nearest' });
                    return M.sliderPoint(input, value === null ? parseFloat(input.value) : value);
                },
                target.slider,
                target.value === undefined ? null : target.value,
                target.scope || 'editor',
                target.chart || 0
            );
            if (!p) throw new Error(`point: no slider named "${target.slider}" in the ${target.scope === 'note' ? 'note' : 'Sliders dock'}`);
            return p;
        }
        if (target && target.selector) {
            const p = await cdp.call(
                (selector, text, at, scroll) => {
                    const M = window.__etzMedia;
                    const all = Array.from(document.querySelectorAll(selector));
                    const el = all.find((e) => M.visible(e) && (text === null || (e.textContent || '').trim() === text));
                    if (!el) return null;
                    if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                    const r = el.getBoundingClientRect();
                    return { x: r.left + at[0] * r.width, y: r.top + at[1] * r.height };
                },
                target.selector,
                target.text === undefined ? null : target.text,
                target.at || [0.5, 0.5],
                target.scroll !== false
            );
            if (!p) throw new Error(`point: nothing visible matches ${JSON.stringify(target)}`);
            return p;
        }
        throw new Error(`point: cannot resolve ${JSON.stringify(target)}`);
    }

    // ----------------------------------------------------------- keyboard + mouse

    const held = new Set();
    const modifierBits = (extra = {}) => {
        let bits = 0;
        for (const name of held) bits |= NAMED_KEYS[name].modifier || 0;
        if (extra.alt) bits |= 1;
        if (extra.ctrl) bits |= 2;
        if (extra.meta) bits |= 4;
        if (extra.shift) bits |= 8;
        if (extra.mod) bits |= process.platform === 'darwin' ? 4 : 2;
        return bits;
    };

    async function keyEvent(type, def, modifiers, extra = {}) {
        await cdp.send('Input.dispatchKeyEvent', {
            type,
            key: def.key,
            code: def.code,
            windowsVirtualKeyCode: def.keyCode,
            nativeVirtualKeyCode: def.keyCode,
            modifiers,
            ...extra,
        });
    }
    /** Hold a key (usually a modifier: 'Shift', 'Alt', 'Meta', 'Control') until keyUp. Held modifiers apply to mouse events too. */
    async function keyDown(name) {
        const def = keyDef(name);
        if (def.modifier) held.add(name);
        await keyEvent('rawKeyDown', def, modifierBits());
    }
    async function keyUp(name) {
        const def = keyDef(name);
        if (def.modifier) held.delete(name);
        await keyEvent('keyUp', def, modifierBits());
    }
    /** Press and release one key: key('Enter'), key('z', { mod: true }), key('ArrowLeft', { shift: true }). */
    async function key(name, mods = {}) {
        const def = keyDef(name);
        const modifiers = modifierBits(mods);
        const chord = (modifiers & 7) !== 0;
        const extra = {};
        if (def.text && !chord) extra.text = def.text;
        if (mods.commands) extra.commands = mods.commands;
        await keyEvent(extra.text ? 'keyDown' : 'rawKeyDown', def, modifiers, extra);
        await keyEvent('keyUp', def, modifiers);
    }
    /**
     * Type into the focused field, one real key press per character
     * (keydown, keypress, input, keyup). `delay` (ms) between characters;
     * `instant: true` inserts the whole text as one input event.
     */
    async function type(text, { delay = 0, instant = false, onChar = null } = {}) {
        if (instant) {
            await cdp.send('Input.insertText', { text });
            return;
        }
        for (const ch of Array.from(text)) {
            if (ch === '\n') await key('Enter');
            else if (ch >= ' ' && ch <= '~') {
                const def = keyDef(ch === ' ' ? 'Space' : ch);
                await keyEvent('keyDown', def, modifierBits(), { text: ch, unmodifiedText: ch });
                await keyEvent('keyUp', def, modifierBits());
            } else await cdp.send('Input.insertText', { text: ch });
            if (onChar) await onChar(ch);
            if (delay) await sleep(delay);
        }
    }
    /** Drop the keyboard focus (no caret, no focus ring in the picture). */
    async function blur() {
        await cdp.call(() => {
            const el = document.activeElement;
            if (el && el !== document.body && typeof el.blur === 'function') el.blur();
        });
        await frames(1);
    }
    /** Select everything in the focused field (then type() replaces it). */
    async function selectAll() {
        await cdp.call(() => {
            const el = document.activeElement;
            if (el && typeof el.select === 'function') el.select();
            else document.execCommand('selectAll');
        });
    }

    const mouse = {
        x: 0,
        y: 0,
        buttons: 0,
        /** Called after every mouse event with { type, x, y, buttons } (the recorder's cursor overlay listens here). */
        listeners: new Set(),
        async _send(type, x, y, extra = {}) {
            await cdp.send('Input.dispatchMouseEvent', {
                type,
                x,
                y,
                modifiers: modifierBits(extra.mods),
                button: extra.button || (this.buttons & 1 ? 'left' : 'none'),
                buttons: extra.buttons === undefined ? this.buttons : extra.buttons,
                clickCount: extra.clickCount || 0,
                pointerType: 'mouse',
                ...(extra.wheel || {}),
            });
            this.x = x;
            this.y = y;
            for (const l of this.listeners) await l({ type, x, y, buttons: this.buttons });
        },
        /**
         * Move the pointer to a target (see point()). `steps` intermediate
         * mousemove events along a straight line, eased unless ease: false.
         * `onStep` is awaited after every event (the recorder passes frame()).
         */
        async move(target, { steps = 1, ease = true, onStep = null, mods } = {}) {
            const to = await point(target);
            const from = { x: this.x, y: this.y };
            const n = Math.max(1, Math.round(steps));
            for (let i = 1; i <= n; i++) {
                let t = i / n;
                if (ease) t = t * t * (3 - 2 * t);
                await this._send('mouseMoved', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, { mods });
                if (onStep) await onStep({ index: i, steps: n });
            }
            return to;
        },
        async down(target = null, { mods, clickCount = 1 } = {}) {
            if (target) await this.move(target, { mods });
            this.buttons |= 1;
            await this._send('mousePressed', this.x, this.y, { button: 'left', clickCount, mods });
        },
        async up(target = null, { mods, clickCount = 1 } = {}) {
            if (target) await this.move(target, { mods });
            this.buttons &= ~1;
            await this._send('mouseReleased', this.x, this.y, { button: 'left', buttons: 0, clickCount, mods });
        },
        /** Real click: move, press, release. `count: 2` double-clicks. */
        async click(target = null, { count = 1, mods, pause = 30 } = {}) {
            if (target) await this.move(target, { mods });
            for (let i = 1; i <= count; i++) {
                await this.down(null, { mods, clickCount: i });
                await sleep(pause);
                await this.up(null, { mods, clickCount: i });
                if (i < count) await sleep(pause);
            }
        },
        /**
         * Drag along a path of targets (math coordinates for the editor
         * preview): press on the first, move through the others with
         * `steps` events in total, release on the last.
         *   shift / alt   hold the modifier for the whole gesture (a real key press, as the app listens for it)
         *   hold          true: do not release; call mouse.up() (and keyUp('Shift')) later, for example after a screenshot
         *   onStep        awaited after every move (after the app drew the frame)
         *   approach      steps of the move to the start point (default 1)
         */
        async drag(pathTargets, { shift = false, alt = false, steps = 24, hold = false, onStep = null, approach = 1, ease = true } = {}) {
            if (!Array.isArray(pathTargets) || pathTargets.length < 2) throw new Error('drag: a path needs at least two targets');
            const pts = [];
            for (const t of pathTargets) pts.push(await point(t));
            await this.move(pts[0], { steps: approach, onStep });
            await frames(1);
            if (shift) await keyDown('Shift');
            if (alt) await keyDown('Alt');
            if (shift || alt) await frames(1);
            await this.down();
            if (onStep) await onStep({ index: 0, steps });
            // Distribute the steps over the segments by length.
            const lengths = [];
            let total = 0;
            for (let i = 1; i < pts.length; i++) {
                const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
                lengths.push(d);
                total += d;
            }
            const n = Math.max(pts.length - 1, Math.round(steps));
            for (let i = 1; i <= n; i++) {
                let t = i / n;
                if (ease) t = t * t * (3 - 2 * t);
                let along = t * total;
                let seg = 0;
                while (seg < lengths.length - 1 && along > lengths[seg]) along -= lengths[seg++];
                const f = lengths[seg] > 0 ? Math.min(1, along / lengths[seg]) : 1;
                const a = pts[seg];
                const b = pts[seg + 1];
                await this._send('mouseMoved', a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
                await frames(1);
                if (onStep) await onStep({ index: i, steps: n });
            }
            if (hold) return;
            await this.up();
            if (alt) await keyUp('Alt');
            if (shift) await keyUp('Shift');
            await frames(1);
        },
        /** Mouse wheel at a target: positive deltaY scrolls down (zooms out in the preview). */
        async wheel(target, deltaY, { deltaX = 0, mods } = {}) {
            const p = await point(target);
            await this._send('mouseMoved', p.x, p.y, { mods });
            await this._send('mouseWheel', p.x, p.y, { mods, wheel: { deltaX, deltaY } });
        },
    };

    /**
     * Rest the pointer on a shape of the 2D preview until the hover tip
     * shows, and return the tip's text (null when nothing draggable is
     * there). `shift: true` holds Shift, which previews the pivot ring: it
     * stays held for the picture, so call keyUp('Shift') afterwards.
     */
    async function hover(target, { shift = false, timeout = 1500 } = {}) {
        const to = await point(target);
        await mouse.move({ x: to.x - 6, y: to.y - 4 });
        await mouse.move(to, { steps: 3 });
        if (shift) await keyDown('Shift');
        const hintText = () =>
            cdp.call(() => {
                const m = window.__etzMedia.editor();
                const el = m ? m.modalEl.querySelector('.etz-drag-hint') : null;
                return el && !el.classList.contains('tikz-hidden') ? (el.textContent || '').trim() : null;
            });
        await waitFor(hintText, { timeout, interval: 40 }).catch(() => {});
        await frames(2);
        return hintText();
    }

    // ----------------------------------------------------------- editor

    async function closeEditor() {
        await cdp.call(() => {
            const M = window.__etzMedia;
            for (const el of Array.from(document.querySelectorAll('.modal.etz-dialog .modal-close-button'))) el.click();
            const m = M.editor();
            if (m) m.close();
        });
        await waitFor(() => cdp.call(() => !window.__etzMedia.editor()), { timeout: 5000, message: 'the editor to close' });
        await frames(2);
    }

    /**
     * Open the editor through the plugin's command, as a user would from
     * the command palette.
     *   chart       load this chart right away (see loadChart)
     *   keepDraft   false (default): forget the autosaved draft first, so no "Unsaved chart" banner shows
     */
    async function openEditor({ chart = null, keepDraft = false } = {}) {
        if (await cdp.call(() => !!window.__etzMedia.editor())) await closeEditor();
        if (!keepDraft) await clearDraft();
        const ok = await cdp.call((id) => app.commands.executeCommandById(`${id}:open-editor`), PLUGIN_ID);
        if (ok === false) throw new Error('openEditor: the command easy-tikz:open-editor does not exist');
        await waitFor(() => cdp.call(() => {
            const m = window.__etzMedia.editor();
            return !!m && m.ready === true;
        }), { timeout: 10000, message: 'the editor to open' });
        const missing = await cdp.call(() => window.__etzMedia.missingFields());
        if (missing.length) throw new Error(`TikzModal no longer has the private field(s) ${missing.join(', ')} that scripts/media/lib/obsidian.mjs reads. Update MODAL_FIELDS and pageHooks.`);
        // MathJax is loaded on first use; $...$ labels are plain text until then.
        await waitFor(() => cdp.evaluate('!!window.MathJax'), { timeout: 15000, interval: 100, message: 'MathJax' }).catch(() => {});
        await sleep(80);
        await waitForRender();
        if (chart) await loadChart(chart);
    }

    /** Forget the plugin's autosaved draft (memory and data.json). */
    async function clearDraft() {
        await cdp.call(async (id) => {
            const plugin = app.plugins.plugins[id];
            if (plugin && plugin.data && plugin.data.draft) {
                plugin.data.draft = null;
                await plugin.saveSettings();
            }
        }, PLUGIN_ID);
    }

    /**
     * Replace the chart through the modal's public loadChart (the path the
     * examples use). A non-empty chart asks "Replace the current chart?":
     * the dialog's Replace button is clicked.
     */
    async function loadChart(data) {
        await cdp.call((chart) => window.__etzMedia.requireEditor().loadChart(chart), data);
        const asked = await cdp.call(() => {
            const dialog = Array.from(document.querySelectorAll('.modal.etz-dialog')).pop();
            if (!dialog) return false;
            const button = dialog.querySelector('.etz-dialog-actions .mod-cta');
            if (!button) throw new Error('toolkit: the replace dialog has no confirm button');
            button.click();
            return true;
        });
        if (asked) await waitFor(() => cdp.call(() => !document.querySelector('.modal.etz-dialog')), { timeout: 5000, message: 'the replace dialog to close' });
        await sleep(80);
        await waitForRender();
    }

    /** Switch the editor tab: 'build' | 'chart' | 'code' | 'help' (the modal's public showTab). */
    async function showTab(tab) {
        await cdp.call((t) => window.__etzMedia.requireEditor().showTab(t), tab);
        // The Code tab generates its text after a short delay.
        if (tab === 'code') await sleep(120);
        await waitForRender();
    }

    /**
     * Expand a card and scroll it into view: 'f1', 'R1', 'label:0', or a
     * slider name (the dock row is scrolled into view). `field` focuses a
     * field (ids as in SceneIssue.field: 'expression', 'condition:2', ...);
     * without it the focus is dropped again, so no caret shows in pictures.
     * Returns false when nothing has that name.
     */
    async function reveal(source, field = null) {
        const found = await cdp.call(
            (name, fieldId) => {
                const M = window.__etzMedia;
                const m = M.requireEditor();
                if (m.build && m.build.reveal(name, fieldId === null ? undefined : fieldId)) {
                    if (fieldId === null && document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
                    return true;
                }
                const input = M.sliderInput(name, 'editor', 0);
                if (!input) return false;
                input.scrollIntoView({ block: 'nearest' });
                return true;
            },
            source,
            field
        );
        await frames(2);
        return found;
    }

    /** Set a slider by name as a drag to that value would: 'input' then 'change' on the range input. */
    async function setSlider(name, value, { scope = 'editor', chart = 0 } = {}) {
        const ok = await cdp.call(
            (n, v, s, i) => {
                const input = window.__etzMedia.sliderInput(n, s, i);
                if (!input) return false;
                input.value = String(v);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            },
            name,
            value,
            scope,
            chart
        );
        if (!ok) throw new Error(`setSlider: no slider named "${name}" in the ${scope === 'note' ? 'note' : 'Sliders dock'}`);
        await waitForRender({ settle: scope === 'note' ? 220 : 0 });
    }

    /** Current value of a slider as its range input shows it. */
    function sliderValue(name, { scope = 'editor', chart = 0 } = {}) {
        return cdp.call(
            (n, s, i) => {
                const input = window.__etzMedia.sliderInput(n, s, i);
                return input ? parseFloat(input.value) : null;
            },
            name,
            scope,
            chart
        );
    }

    /** The chart in the editor as "Insert into note" would write it (SettingsManager.serialize()). */
    const chart = () => cdp.call(() => JSON.parse(JSON.stringify(window.__etzMedia.requireEditor().settings.serialize())));

    /** Problems of the last full render: [{ source, field, message, severity }]. */
    const issues = () =>
        cdp.call(() =>
            (window.__etzMedia.requireEditor().issues || []).map((i) => ({ source: i.source, field: i.field === undefined ? null : i.field, message: i.message, severity: i.severity }))
        );

    /** Text of the status chip on the preview when it is visible, else null. */
    const statusChip = () =>
        cdp.call(() => {
            const m = window.__etzMedia.editor();
            const chip = m ? m.modalEl.querySelector('.etz-status-chip') : null;
            return chip && !chip.classList.contains('tikz-hidden') ? (chip.textContent || '').trim() : null;
        });

    /** What the editor shows right now, for assertions. */
    const editorState = () =>
        cdp.call(() => {
            const m = window.__etzMedia.editor();
            if (!m) return null;
            const el = m.modalEl;
            const text = (sel) => {
                const node = el.querySelector(sel);
                return node ? (node.textContent || '').trim() : null;
            };
            return {
                tab: m.activeTab,
                is3D: m.is3D(),
                cta: text('.etz-actionbar .mod-cta'),
                banner: text('.etz-banner-slot'),
                undo: el.querySelector('.etz-undo') && !el.querySelector('.etz-undo').classList.contains('tikz-hidden') ? text('.etz-undo') : null,
                hint: el.querySelector('.etz-drag-hint') && !el.querySelector('.etz-drag-hint').classList.contains('tikz-hidden') ? text('.etz-drag-hint') : null,
                narrow: !!el.querySelector('.etz-shell.is-narrow'),
            };
        });

    /** What the preview holds: { mode: '2d' | '3d', shapes, width, height } (shapes = drawn SVG elements, or 1 for a painted 3D canvas). */
    const previewInfo = () =>
        cdp.call(() => {
            const m = window.__etzMedia.requireEditor();
            const el = m.chartEl;
            const r = el.getBoundingClientRect();
            const canvas = el.querySelector('canvas.tikz-3d-canvas');
            if (m.is3D()) return { mode: '3d', shapes: canvas && canvas.width > 0 && canvas.height > 0 ? 1 : 0, width: Math.round(r.width), height: Math.round(r.height) };
            const svg = m.chartSvg;
            return { mode: '2d', shapes: svg ? svg.querySelectorAll('path, line, polyline, polygon, circle, rect, text').length : 0, width: Math.round(r.width), height: Math.round(r.height) };
        });

    /** The LaTeX in the Code tab (show the tab first). */
    const codeText = () =>
        cdp.call(() => {
            const area = window.__etzMedia.requireEditor().modalEl.querySelector('.etz-code-textarea');
            return area ? area.value : null;
        });

    /** Versions of the running app and plugin. */
    const versions = () =>
        cdp.call((id) => {
            const title = /Obsidian v?([\d.]+)/.exec(document.title);
            const manifest = app.plugins.manifests[id];
            return { obsidian: title ? title[1] : null, plugin: manifest ? manifest.version : null };
        }, PLUGIN_ID);

    /** Click the editor's primary button ("Insert into note" / "Save changes") and wait until the editor closed. */
    async function insertIntoNote() {
        await mouse.click({ selector: '.modal.tikz-modal .etz-actionbar .mod-cta' });
        await waitFor(() => cdp.call(() => !window.__etzMedia.editor()), { timeout: 5000, message: 'the editor to close after Insert into note (is a note open in editing mode?)' });
        await sleep(150);
        await waitForRender({ settle: 200 });
    }

    // ----------------------------------------------------------- notes

    const notePath = (name) => (name.endsWith('.md') ? name : `${name}.md`);

    /** Create or overwrite a note in the vault. */
    async function writeNote(name, markdown) {
        await cdp.call(
            async (file, text) => {
                const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
                if (dir && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
                const existing = app.vault.getAbstractFileByPath(file);
                if (existing) await app.vault.modify(existing, text);
                else await app.vault.create(file, text);
            },
            notePath(name),
            markdown
        );
    }

    /** Text of a note: what its open editor holds (saved first), else what is on disk. */
    const readNote = (name) =>
        cdp.call(async (file) => {
            const f = app.vault.getAbstractFileByPath(file);
            if (!f) throw new Error(`toolkit: no note ${file}`);
            for (const leaf of app.workspace.getLeavesOfType('markdown')) {
                const view = leaf.view;
                if (view && view.file && view.file.path === file && typeof view.getViewData === 'function') {
                    if (typeof view.save === 'function') await view.save();
                    return view.getViewData();
                }
            }
            return app.vault.read(f);
        }, notePath(name));

    /** Click a rendered chart in the active note (a real click) and wait for the editor it opens. */
    async function editChartInNote(index = 0) {
        const box = await cdp.call((i) => {
            const M = window.__etzMedia;
            const chartEl = M.inlineCharts()[i];
            const el = chartEl ? chartEl.querySelector('.etz-inline-box') : null;
            if (!el) return null;
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            // Above the middle: clear of the width slider along the bottom edge.
            return { x: r.left + r.width / 2, y: r.top + r.height * 0.4 };
        }, index);
        if (!box) throw new Error(`editChartInNote: the active note has no rendered chart ${index}`);
        await mouse.click(box);
        await waitFor(() => cdp.call(() => {
            const m = window.__etzMedia.editor();
            return !!m && m.ready === true;
        }), { timeout: 8000, message: 'the editor to open from the chart in the note' });
        await sleep(80);
        await waitForRender();
    }

    /**
     * Open a note in the main area.
     *   mode     'reading' (default), 'live' (Live Preview) or 'source'
     *   cursor   'end' (default) or 'start': where the text cursor goes in the editing modes
     *   charts   how many rendered charts to wait for (default: the number of easy-tikz blocks in the note)
     */
    async function openNote(name, { mode = 'reading', cursor = 'end', charts = null } = {}) {
        const expected = await cdp.call(
            async (file, viewMode, where) => {
                const f = app.vault.getAbstractFileByPath(file);
                if (!f) throw new Error(`toolkit: no note ${file}`);
                const leaf = app.workspace.getLeaf(false);
                await leaf.openFile(f, { active: true, state: { mode: viewMode === 'reading' ? 'preview' : 'source', source: viewMode === 'source' } });
                app.workspace.setActiveLeaf(leaf, { focus: true });
                const view = leaf.view;
                if (viewMode !== 'reading' && view && view.editor) {
                    const editor = view.editor;
                    if (where === 'start') editor.setCursor({ line: 0, ch: 0 });
                    else editor.setCursor({ line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length });
                    editor.focus();
                }
                const text = await app.vault.read(f);
                return (text.match(/^```easy-tikz\s*$/gm) || []).length;
            },
            notePath(name),
            mode,
            cursor
        );
        const want = charts === null ? expected : charts;
        if (want > 0) {
            await waitFor(() => cdp.call((n) => window.__etzMedia.inlineCharts().filter((c) => c.querySelector('svg, canvas')).length >= n, want), {
                timeout: 15000,
                message: `${want} chart(s) to render in ${notePath(name)} (charts below the fold render when scrolled to)`,
            });
        }
        await waitForRender({ settle: 250 });
    }

    /** State of the charts in the active note, for assertions. */
    const noteCharts = () =>
        cdp.call(() =>
            window.__etzMedia.inlineCharts().map((c) => {
                const issuesEl = c.querySelector('.etz-inline-issues');
                return {
                    drawn: !!c.querySelector('.etz-inline-box svg, .etz-inline-box canvas'),
                    sliders: Array.from(c.querySelectorAll('.etz-inline-strip .etz-inline-name')).map((n) => (n.textContent || '').trim()),
                    issues: issuesEl && !issuesEl.classList.contains('tikz-hidden') ? (issuesEl.textContent || '').trim() : null,
                    width: Math.round(c.getBoundingClientRect().width),
                };
            })
        );

    // ----------------------------------------------------------- screenshots

    /**
     * Save a PNG at device scale (2x by default).
     *   clip      'window' (default), 'editor' (the editor modal), 'preview' (the chart picture alone),
     *             'stage' (preview with its buttons and chip), 'panel' (the editor's left column), 'dock' (Sliders),
     *             'note' (the active note), 'page' (its text column), 'inline' (the first chart in the note with its slider strip),
     *             any CSS selector, or { x, y, width, height } in client px
     *   padding   px added around the clip (number or [horizontal, vertical]), kept inside the window
     *   scale     output scale relative to 2x (0.5 gives a 1x picture)
     * Returns { file, width, height } in output pixels.
     */
    async function screenshot(file, { clip = 'window', padding = 0, scale: outScale = 1 } = {}) {
        const rect = await cdp.call((c) => window.__etzMedia.clipRect(c), clip);
        if (!rect) throw new Error(`screenshot: nothing to show for clip ${JSON.stringify(clip)}`);
        const [px, py] = Array.isArray(padding) ? padding : [padding, padding];
        const view = await cdp.call(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }));
        const x0 = Math.max(0, Math.floor(rect.x - px));
        const y0 = Math.max(0, Math.floor(rect.y - py));
        const x1 = Math.min(view.w, Math.ceil(rect.x + rect.width + px));
        const y1 = Math.min(view.h, Math.ceil(rect.y + rect.height + py));
        if (x1 <= x0 || y1 <= y0) throw new Error(`screenshot: clip ${JSON.stringify(clip)} is outside the window`);
        await cdp.screenshot(file, { clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0, scale: outScale }, captureBeyondViewport: false });
        return { file, width: Math.round((x1 - x0) * view.dpr * outScale), height: Math.round((y1 - y0) * view.dpr * outScale) };
    }

    const obs = {
        port,
        workDir,
        vault: dirs.vault,
        logFile,
        cdp,
        call,
        evaluate: (expression) => cdp.evaluate(expression),
        frames,
        sleep,
        waitFor,
        // errors
        errors,
        clearErrors: () => errors.splice(0, errors.length),
        // window
        setWindowSize,
        setTheme,
        setSidebars,
        shield,
        // editor
        openEditor,
        closeEditor,
        clearDraft,
        loadChart,
        showTab,
        reveal,
        setSlider,
        sliderValue,
        chart,
        issues,
        statusChip,
        editorState,
        previewInfo,
        codeText,
        versions,
        insertIntoNote,
        waitForRender,
        waitForSelector,
        // geometry + input
        point,
        mathToClient: (x, y) => cdp.call((a, b) => window.__etzMedia.mathToClient(a, b), x, y),
        clientToMath: (x, y) => cdp.call((a, b) => window.__etzMedia.clientToMath(a, b), x, y),
        clipRect: (clip) => cdp.call((c) => window.__etzMedia.clipRect(c), clip),
        mouse,
        hover,
        key,
        keyDown,
        keyUp,
        type,
        selectAll,
        blur,
        // notes
        writeNote,
        readNote,
        openNote,
        noteCharts,
        editChartInNote,
        // pictures
        screenshot,
        quit,
    };

    say('plugin loaded');
    // Pictures assume overlay scroll bars (see the launch arguments): say so when the app uses the other kind.
    const barWidth = await cdp.call(() => {
        const probe = document.body.createDiv();
        probe.setCssStyles({ position: 'absolute', left: '-999px', width: '100px', height: '100px', overflow: 'scroll' });
        const taken = probe.offsetWidth - probe.clientWidth;
        probe.remove();
        return taken;
    });
    if (barWidth > 0) say(`warning: scroll bars take ${barWidth} px of every scrolling panel here, so pictures will differ from those made with overlay scroll bars`);
    if (options.shield !== false) await shield(true);
    await setWindowSize(width, height);
    if (options.sidebars !== true) await setSidebars(false);
    await setTheme(theme);
    // Park the pointer in a corner so nothing is hovered by accident.
    await mouse.move({ x: 2, y: 2 });
    return obs;
}
