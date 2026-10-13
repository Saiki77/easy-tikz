/* eslint-env browser, node */
// Stage 1 of the promo build: every picture the cards are composed around
// is taken here, from the real plugin running in the isolated Obsidian of
// lib/obsidian.mjs. Each shot is the whole window at 1728 x 1117 CSS px,
// device scale 2 (3456 x 2234 pixels, the size of a full screen on a 16 inch
// MacBook Pro), light theme. The templates crop: capture() also records,
// per shot, where the editor, the preview, the Sliders dock, the hover tip
// and so on sit in the window, and where the pointer was.
//
// Nothing is drawn or retouched here. Gestures are real input events: the
// Shift-drag of the constraint line is held while the picture is taken and
// cancelled with Escape afterwards, the sliders are dragged by their thumbs.
import fs from 'node:fs';
import path from 'node:path';
import { chartBlock, importTs, launch } from '../lib/obsidian.mjs';
import { NOTES, promoCharts } from './charts.mjs';

/** Full screen of a 16 inch MacBook Pro in CSS px; captures are twice that in pixels. */
export const VIEW = { width: 1728, height: 1117, scale: 2 };

const MODAL = '.modal.tikz-modal';

/**
 * Take all shots into `shotsDir` and write shots/meta.js (loaded by the
 * templates as window.SHOTS) and shots/meta.json.
 *   port, workDir, plugin   passed to launch() (see scripts/media/README.md)
 *   log                     progress lines
 * Returns { meta, tex }: the metadata and the LaTeX of the Linear program
 * example exactly as the Code tab shows it.
 */
export async function capture({ port, workDir, plugin, shotsDir, log = () => {} }) {
    const { EXAMPLES, recipes } = await importTs('src/migrate.ts');
    const charts = promoCharts(EXAMPLES);
    fs.mkdirSync(shotsDir, { recursive: true });

    const obs = await launch({
        port,
        workDir,
        plugin,
        width: VIEW.width,
        height: VIEW.height,
        scale: VIEW.scale,
        theme: 'light',
        notes: {
            [`${NOTES.lp.name}.md`]: NOTES.lp.text(chartBlock({ ...charts.lp, displayWidth: 560 })),
            [`${NOTES.wave.name}.md`]: NOTES.wave.text(chartBlock({ ...charts.wave, displayWidth: 640 })),
        },
    });

    const shots = {};
    let tex = '';
    try {
        const view = await obs.call(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, light: document.body.classList.contains('theme-light') }));
        if (view.width !== VIEW.width || view.height !== VIEW.height || view.dpr !== VIEW.scale || !view.light) {
            throw new Error(`capture: the window is ${view.width} x ${view.height} at ${view.dpr}x (light theme: ${view.light}), expected ${VIEW.width} x ${VIEW.height} at ${VIEW.scale}x, light`);
        }
        const versions = await obs.versions();
        log(`Obsidian ${versions.obsidian}, Easy TikZ ${versions.plugin}, ${view.width} x ${view.height} at ${view.dpr}x`);

        /**
         * One picture of the whole window.
         *   rects     { name: clip } resolved with obs.clipRect (a clip name of the toolkit or a CSS selector)
         *   pointer   true: remember where the pointer is, so a template can draw it (it is not part of a capture)
         *   values    anything the templates should print (slider values read back from the app)
         */
        const shot = async (name, { rects = {}, pointer = false, values = {} } = {}) => {
            await obs.waitForRender();
            const chip = await obs.statusChip().catch(() => null);
            if (chip) throw new Error(`capture: ${name}: the status chip shows "${chip}"`);
            const resolved = {};
            for (const [key, clip] of Object.entries(rects)) {
                const r = clip ? await obs.clipRect(clip) : null;
                if (!r) throw new Error(`capture: ${name}: nothing on screen for "${key}"`);
                resolved[key] = { x: r.x, y: r.y, width: r.width, height: r.height };
            }
            const file = `${name}.png`;
            await obs.screenshot(path.join(shotsDir, file));
            shots[name] = { file, width: VIEW.width, height: VIEW.height, rects: resolved, pointer: pointer ? { x: obs.mouse.x, y: obs.mouse.y } : null, values };
            log(`shot ${name}`);
        };
        const park = () => obs.mouse.move({ x: 2, y: 2 });
        const editorRects = { editor: 'editor', panel: 'panel', stage: 'stage', preview: 'preview' };

        /**
         * Drag a slider's thumb to `value` with the mouse and keep the button
         * down for the picture. The value the app shows afterwards is read
         * back and returned. A drag that did not arrive (now and then the
         * range input stops following after its first step) is released and
         * done again, so no picture shows a pointer away from its thumb.
         */
        const holdSlider = async (name, value, scope = 'editor') => {
            const read = () =>
                obs.call(
                    (n, sc) => {
                        const input = window.__etzMedia.sliderInput(n, sc, 0);
                        return input ? { value: parseFloat(input.value), min: parseFloat(input.min), max: parseFloat(input.max), step: parseFloat(input.step) || 0 } : null;
                    },
                    name,
                    scope
                );
            let last = null;
            for (let attempt = 1; attempt <= 4; attempt++) {
                await obs.waitForRender({ settle: 250 });
                await obs.mouse.drag([{ slider: name, scope }, { slider: name, value, scope }], { hold: true, steps: 16, approach: 4 });
                await obs.waitForRender({ settle: 220 });
                last = await read();
                if (!last) throw new Error(`capture: no slider "${name}" in the ${scope}`);
                const tolerance = Math.max(last.step * 1.5, (last.max - last.min) * 0.01);
                if (Math.abs(last.value - value) <= tolerance) return last.value;
                await obs.mouse.up();
                log(`slider ${name}: the drag stopped at ${last.value} instead of ${value}, again (attempt ${attempt})`);
            }
            throw new Error(`capture: slider "${name}" did not follow the drag to ${value} (it shows ${last ? last.value : 'nothing'})`);
        };
        /** The part of the note's text column that holds something: title, text, chart, slider strip. */
        const noteContent = () =>
            obs.call(() => {
                const M = window.__etzMedia;
                const root = M.noteEl();
                const sizer = root ? Array.from(root.querySelectorAll('.markdown-preview-sizer')).find(M.visible) : null;
                if (!sizer) return null;
                let top = Infinity;
                let bottom = -Infinity;
                for (const el of sizer.querySelectorAll('.inline-title, p, .etz-inline')) {
                    const r = el.getBoundingClientRect();
                    if (r.height < 1) continue;
                    top = Math.min(top, r.top);
                    bottom = Math.max(bottom, r.bottom);
                }
                const s = sizer.getBoundingClientRect();
                return Number.isFinite(top) ? { x: s.left, y: top, width: s.width, height: bottom - top } : null;
            });
        const releaseSlider = async () => {
            await obs.mouse.up();
            await obs.waitForRender({ settle: 220 });
        };

        // ---- Linear program: the editor in the window, with its note behind (hero, social).
        await obs.openNote(NOTES.lp.name);
        await obs.openEditor({ chart: charts.lp });
        await park();
        await shot('lp-editor', { rects: { ...editorRects, dock: 'dock', conditions: `${MODAL} .etz-layer-conditions`, card: `${MODAL} .etz-card` } });

        // ---- Export: the LaTeX exactly as the Code tab holds it (compiled by build-promo.mjs).
        await obs.showTab('code');
        tex = await obs.codeText();
        if (!tex || !tex.includes('\\documentclass') || !tex.includes('\\begin{tikzpicture}')) throw new Error('capture: the Code tab holds no standalone document');
        await shot('lp-code', { rects: { ...editorRects, code: `${MODAL} .etz-code-textarea` } });
        await obs.showTab('build');

        // ---- + Add: the list of recipes.
        await obs.mouse.click(`${MODAL} .etz-build-add`);
        if (!(await obs.waitForSelector('.menu'))) throw new Error('capture: the + Add menu did not open');
        await obs.mouse.move({ selector: '.menu .menu-item', text: 'Feasible region (inequalities)', at: [0.93, 0.62] }, { steps: 4 });
        await obs.sleep(150);
        // The menu is one tall list; the card shows it as two crops, split at the separator nearest its middle.
        const halves = await obs.call(() => {
            const box = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
            const menu = document.querySelector('.menu');
            const m = menu.getBoundingClientRect();
            const middle = (m.top + m.bottom) / 2;
            const separators = Array.from(menu.querySelectorAll('.menu-separator')).map((el) => el.getBoundingClientRect());
            if (!separators.length) return null;
            separators.sort((a, b) => Math.abs(a.top - middle) - Math.abs(b.top - middle));
            const cut = separators[0];
            return {
                top: box(new DOMRect(m.left, m.top, m.width, cut.top - m.top)),
                bottom: box(new DOMRect(m.left, cut.bottom, m.width, m.bottom - cut.bottom)),
                recipes: menu.querySelectorAll('.menu-item:not(.is-label)').length,
            };
        });
        if (!halves) throw new Error('capture: the + Add menu has no groups any more');
        await shot('lp-add', { rects: { ...editorRects, menu: '.menu', menuTop: halves.top, menuBottom: halves.bottom }, pointer: true, values: { entries: halves.recipes } });
        await obs.key('Escape');
        await obs.waitForSelector('.menu', { gone: true });
        await park();

        // ---- Drag to edit, on the example without its objective line (charts.lpDrag): rest on
        // constraint (2) with Shift held (hover tip, pivot ring) ...
        await obs.loadChart(charts.lpDrag);
        await park();
        const tip = await obs.hover([1.5, 1.5], { shift: true });
        if (!tip || !/x \+ 3y <= 6/.test(tip)) throw new Error(`capture: the hover tip reads "${tip}", expected constraint (2) of the Linear program`);
        await shot('lp-hover', { rects: { ...editorRects, hint: `${MODAL} .etz-drag-hint` }, pointer: true });
        await obs.keyUp('Shift');
        await park();

        // ... then Shift-drag it from (0.6, 1.8) to (0.6, 2.2): it turns around the corner (3, 1) into x + 2y <= 5.
        await obs.mouse.drag([[0.6, 1.8], [0.6, 2.2]], { shift: true, hold: true, steps: 30, approach: 6 });
        await obs.waitForRender();
        const live = (await obs.editorState()).hint || '';
        if (!/x \+ 2y <= 5/.test(live)) throw new Error(`capture: the Shift-drag reads "${live}", expected "x + 2y <= 5"`);
        await shot('lp-turn', { rects: { ...editorRects, hint: `${MODAL} .etz-drag-hint`, conditions: `${MODAL} .etz-layer-conditions` }, pointer: true });
        // Cancel the drag, so every text goes back. Shift is released first: the editor listens for a
        // plain Escape, and with Shift still held the key press would not cancel anything.
        await obs.keyUp('Shift');
        await obs.key('Escape');
        await obs.mouse.up();
        await park();
        await obs.waitForRender();
        const restored = JSON.stringify((await obs.chart()).tools[0].conditions);
        if (restored !== JSON.stringify(charts.lpDrag.tools[0].conditions)) throw new Error(`capture: Escape did not restore the Linear program (${restored})`);

        // ---- Areas between two curves.
        await obs.loadChart(charts.areas);
        await shot('areas-editor', { rects: { ...editorRects } });

        // ---- Market equilibrium as it ships (surplus-1, kept for templates; no card uses it now) and at
        // two values of the slider a, each taken while the thumb is held there.
        await obs.loadChart(charts.surplus);
        await shot('surplus-1', { rects: { ...editorRects, dock: 'dock' }, values: { a: await obs.sliderValue('a') } });
        for (const [name, value] of [['surplus-2', 2.2], ['surplus-0', 0.6]]) {
            const a = await holdSlider('a', value);
            await shot(name, { rects: { ...editorRects, dock: 'dock' }, pointer: true, values: { a } });
            await releaseSlider();
        }
        await park();

        // ---- 3D: the surface cut by the plane z = h.
        await obs.loadChart(charts.plane3d);
        await obs.waitForRender({ settle: 600 });
        await shot('plane3d-editor', { rects: { editor: 'editor', panel: 'panel', stage: 'stage', dock: 'dock', canvas: `${MODAL} canvas.tikz-3d-canvas` }, values: { h: await obs.sliderValue('h') } });
        await obs.closeEditor();

        // ---- A chart in a note, with its slider strip. The damping slider k is being dragged in the note.
        await obs.openNote(NOTES.wave.name);
        const inNote = (await obs.noteCharts())[0];
        if (!inNote || !inNote.drawn || inNote.issues) throw new Error(`capture: the chart in the note is not clean: ${JSON.stringify(inNote || null)}`);
        const k = await holdSlider('k', 0.45, 'note');
        await shot('note-wave', { rects: { page: 'page', inline: 'inline', note: 'note', strip: '.etz-inline-strip', content: await noteContent() }, pointer: true, values: { k } });
        await releaseSlider();
        await park();

        if (obs.errors.length) {
            throw new Error(`capture: Obsidian logged ${obs.errors.length} console error(s):\n` + obs.errors.map((e) => `  ${e.type}: ${e.text}`).join('\n'));
        }
        // Numbers the cards print come from the sources, not from memory.
        const facts = { recipes2D: recipes(false).length, recipes3D: recipes(true).length, examples: EXAMPLES.length };
        const meta = { versions, facts, view: { width: VIEW.width, height: VIEW.height, scale: VIEW.scale }, shots };
        fs.writeFileSync(path.join(shotsDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
        fs.writeFileSync(path.join(shotsDir, 'meta.js'), `/* eslint-env browser */\n// Written by scripts/media/promo/capture.mjs. Do not edit.\nwindow.SHOTS = ${JSON.stringify(meta, null, 2)};\n`);
        return { meta, tex };
    } finally {
        await obs.quit();
    }
}
