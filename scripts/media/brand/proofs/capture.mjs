/* eslint-env browser, node */
// Captures for the two brand proofs, taken from the real plugin in the
// isolated Obsidian of lib/obsidian.mjs: the whole window at 1728 x 1117
// CSS px, device scale 2 (3456 x 2234 pixels), light theme.
//
//   lp-editor        the editor on the Linear program example (hero)
//   lp-shift-hover   Shift held over the objective line: hover tip and pivot ring (card)
//   lp-turning       the Shift-drag of that line, held in the middle
//   lp-turned        the chart after the drag, with the undo bar
//
// Besides the pictures, capture() records where things sit (rectangles and
// points in CSS px of the window), so a template can crop and can aim a
// callout at the slider thumb, a line, the optimum or the hover tip, and
// what the app itself reported: the tip text, and the equation and the
// slider before and after the drag. Nothing in a proof is typed from memory,
// and every claim a proof makes is acted out here first:
//   "drag this line: its formula follows"   a real drag of constraint line (1) rewrites `x + y <= 4`
//   equations (1) and (2) of the card        a real Shift-drag from where the pointer rests in the picture
import fs from 'node:fs';
import path from 'node:path';
import { chartBlock, importTs, launch } from '../../lib/obsidian.mjs';

/** Full screen of a 16 inch MacBook Pro in CSS px; captures are twice that in pixels. */
export const VIEW = { width: 1728, height: 1117, scale: 2 };

const MODAL = '.modal.tikz-modal';
/** Where the pointer rests on the objective line 2x + 3y = 9 for the hover picture. */
export const HOVER_AT = [1.5, 2];
/** The Shift-drag of the objective line the card describes. It starts where the pointer rests in the picture. */
export const TURN = { from: HOVER_AT, to: [1.5, 2.25] };
/** The plain drag of constraint line (1), x + y = 4, that the title page points at. */
export const CONSTRAINT = { from: [1, 3], to: [1, 3.5] };

/**
 * Take the shots into `shotsDir` and write meta.json and meta.js
 * (window.BRAND_SHOTS). Returns the metadata.
 *   port, workDir, plugin   passed to launch() (see scripts/media/README.md)
 */
export async function capture({ port, workDir, plugin, shotsDir, log = () => {} }) {
    const { EXAMPLES } = await importTs('src/migrate.ts');
    const example = EXAMPLES.find((e) => e.id === 'lp');
    if (!example) throw new Error('brand proofs: src/migrate.ts has no example "lp" any more');
    const lp = JSON.parse(JSON.stringify(example.data));
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
            'Linear program.md': `Maximise $z = 2x + 3y$ subject to $x + y \\le 4$ and $x + 3y \\le 6$.\n\n${chartBlock({ ...lp, displayWidth: 560 })}\n\nThe dashed line is the objective $2x + 3y = c$.\n`,
        },
    });

    const shots = {};
    try {
        const view = await obs.call(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, light: document.body.classList.contains('theme-light') }));
        if (view.width !== VIEW.width || view.height !== VIEW.height || view.dpr !== VIEW.scale || !view.light) {
            throw new Error(`capture: the window is ${view.width} x ${view.height} at ${view.dpr}x (light theme: ${view.light}), expected ${VIEW.width} x ${VIEW.height} at ${VIEW.scale}x, light`);
        }
        const versions = await obs.versions();
        log(`Obsidian ${versions.obsidian}, Easy TikZ ${versions.plugin}, ${view.width} x ${view.height} at ${view.dpr}x`);

        const state = async () => {
            const chart = await obs.chart();
            const tool = (name) => chart.tools.find((t) => t.name === name);
            return { equation: tool('C1').equation, objective: tool('P1').objective, c: chart.parameters[0].value };
        };
        /** Everything a template may want to aim at, in CSS px of the window. */
        const geometry = async () => {
            const math = {};
            for (const [name, at] of Object.entries({ origin: [0, 0], optimum: [3, 1], lineTop: [0, 3], lineMid: [1.5, 2], lineLow: [3.75, 0.5], constraint: CONSTRAINT.from, hover: HOVER_AT, turnFrom: TURN.from, turnTo: TURN.to })) {
                math[name] = await obs.mathToClient(at[0], at[1]);
            }
            const dom = await obs.call((modalSel) => {
                const box = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
                const modal = document.querySelector(modalSel);
                const texts = Array.from(modal.querySelectorAll('.etz-chart svg text'))
                    .map((el) => ({ text: (el.textContent || '').trim(), rect: box(el.getBoundingClientRect()) }))
                    .filter((t) => t.text && t.rect.width > 0);
                const pivot = modal.querySelector('.etz-drag-pivot');
                const pivotRect = pivot && pivot.childElementCount ? box(pivot.getBoundingClientRect()) : null;
                const radiusOf = (el) => (el ? parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 : 0);
                return { texts, pivot: pivotRect, radius: radiusOf(modal), radii: { hint: radiusOf(modal.querySelector('.etz-drag-hint')) } };
            }, MODAL);
            return { math, ...dom, sliderThumb: await obs.point({ slider: 'c' }) };
        };
        /**
         * One picture of the whole window.
         *   rects     { name: clip } resolved with obs.clipRect
         *   pointer   true: remember where the pointer is (it is not part of a capture)
         *   values    anything else the templates should print or check
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
            const geo = await geometry();
            const file = `${name}.png`;
            await obs.screenshot(path.join(shotsDir, file));
            shots[name] = { file, width: VIEW.width, height: VIEW.height, rects: resolved, points: { ...geo.math, sliderThumb: geo.sliderThumb }, texts: geo.texts, pivot: geo.pivot, radius: geo.radius, radii: geo.radii, pointer: pointer ? { x: obs.mouse.x, y: obs.mouse.y } : null, values };
            log(`shot ${name}`);
        };
        const park = () => obs.mouse.move({ x: 2, y: 2 });
        const editorRects = { editor: 'editor', panel: 'panel', stage: 'stage', preview: 'preview', dock: 'dock', actionbar: `${MODAL} .etz-actionbar` };

        // ---- 1. The editor on the Linear program, its note behind it.
        await obs.openNote('Linear program');
        await obs.openEditor({ chart: lp });
        await park();
        const before = await state();
        if (before.equation !== '2x + 3y = c' || before.c !== 9) throw new Error(`capture: the Linear program starts as "${before.equation}", c = ${before.c}; the proofs expect 2x + 3y = c with c = 9`);
        const panel = await tidyPanel(obs);
        log(`Build panel: ${panel.collapsed.join(' and ')} collapsed, scrolled ${panel.scrollTop} px: "${panel.first}" leads, the list ends ${panel.below} px above the edge`);
        await shot('lp-editor', { rects: { ...editorRects, conditions: `${MODAL} .etz-layer-conditions` }, values: { ...before, panel } });

        // ---- 1b. What the title page says of constraint line (1): "drag this line: its formula follows".
        const condition = async () => (await obs.chart()).tools.find((t) => t.name === 'R1').conditions[0];
        const constraint = { from: CONSTRAINT.from, to: CONSTRAINT.to, before: await condition(), tip: ((await obs.hover(CONSTRAINT.from)) || '').replace(/Drag to move.*$/, '').trim() };
        if (!/^R1 \(1\): x \+ y <= 4$/.test(constraint.tip)) throw new Error(`capture: the tip over constraint line (1) reads "${constraint.tip}"`);
        await obs.mouse.drag([CONSTRAINT.from, CONSTRAINT.to], { steps: 16 });
        await obs.waitForRender();
        constraint.after = await condition();
        if (constraint.before !== 'x + y <= 4' || constraint.after === constraint.before || !/^x \+ y <= [\d.]+$/.test(constraint.after)) {
            throw new Error(`capture: dragging constraint line (1) turned "${constraint.before}" into "${constraint.after}"; the title page says its formula follows`);
        }
        await obs.key('z', { mod: true });
        await obs.waitForRender();
        if ((await condition()) !== constraint.before) throw new Error('capture: undo did not restore constraint (1)');
        await park();
        log(`constraint (1): ${constraint.before}  ->  ${constraint.after}  (dragged from (${CONSTRAINT.from}) to (${CONSTRAINT.to}))`);

        // ---- 2. Shift held over the objective line: the tip says what a Shift-drag will do, the ring marks the pivot.
        // Shift goes down before the pointer arrives: the editor listens for the key on the modal, which
        // has no keyboard focus yet in this session, so it learns of Shift from the pointer events.
        const hint = async () => (await obs.editorState()).hint || '';
        const turns = (text) => /^C1: 2x \+ 3y = c/.test(text) && /turns around/.test(text) && /\(3, 1\)/.test(text);
        let tip = '';
        let attempts = 0;
        while (attempts < 3 && !turns(tip)) {
            if (attempts) {
                // Now and then (two of seven runs on the day this was written) no tip shows, or the tip of another
                // shape answers, although the pointer is on the line. The cause is not known. Say what was seen,
                // let go, rest and hover again; the checks that follow are the same for every attempt.
                const spot = await obs.mathToClient(HOVER_AT[0], HOVER_AT[1]);
                log(`Shift-hover, attempt ${attempts}: the tip read "${tip}" with the pointer at (${obs.mouse.x.toFixed(1)}, ${obs.mouse.y.toFixed(1)}) and the line at (${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}). Hovering again.`);
                await obs.keyUp('Shift');
                await park();
                await obs.waitForRender();
                await obs.sleep(400);
            }
            attempts++;
            await obs.keyDown('Shift');
            await obs.hover(HOVER_AT, { shift: true });
            for (let i = 0; i < 40; i++) {
                tip = await hint();
                if (turns(tip)) break;
                await obs.sleep(50);
            }
        }
        if (!turns(tip)) throw new Error(`capture: the Shift-hover tip reads "${tip}" after ${attempts} attempts, expected the objective line turning around (3, 1)`);
        const rest = await obs.mathToClient(HOVER_AT[0], HOVER_AT[1]);
        if (Math.hypot(obs.mouse.x - rest.x, obs.mouse.y - rest.y) > 1) throw new Error(`capture: the pointer rests at (${obs.mouse.x}, ${obs.mouse.y}), the line at (${rest.x}, ${rest.y})`);
        const tipLines = await obs.call((modalSel) => Array.from(document.querySelectorAll(`${modalSel} .etz-drag-hint > div`)).map((el) => (el.textContent || '').trim()).filter(Boolean), MODAL);
        await shot('lp-shift-hover', { rects: { ...editorRects, hint: `${MODAL} .etz-drag-hint` }, pointer: true, values: { tip: tipLines, attempts } });
        if (!shots['lp-shift-hover'].pivot) throw new Error('capture: no pivot ring is drawn during the Shift-hover');
        await obs.keyUp('Shift');
        await park();

        // ---- 3. The Shift-drag, held in the middle of the gesture (ghost of the old line, live tip) ...
        await obs.mouse.drag([TURN.from, TURN.to], { shift: true, hold: true, steps: 24, approach: 6 });
        await obs.waitForRender();
        const liveTip = (await obs.editorState()).hint || '';
        await shot('lp-turning', { rects: { ...editorRects, hint: `${MODAL} .etz-drag-hint` }, pointer: true, values: { tip: liveTip } });
        // ... and released: the app rewrites the equation and moves the slider.
        await obs.mouse.up();
        await obs.keyUp('Shift');
        await obs.waitForRender();
        const after = await state();
        const undo = ((await obs.editorState()).undo || '').replace(/Undo$/, '').trim();
        const m = /^(-?[\d.]*)x \+ (-?[\d.]*)y = c$/.exec(after.equation);
        if (!m) throw new Error(`capture: after the Shift-drag the equation reads "${after.equation}"`);
        const [a, b] = [m[1] === '' ? 1 : Number(m[1]), m[2] === '' ? 1 : Number(m[2])];
        if (Math.abs(a * 3 + b * 1 - after.c) > 1e-6) throw new Error(`capture: "${after.equation}" with c = ${after.c} does not pass through the pivot (3, 1)`);
        if (after.equation === before.equation) throw new Error('capture: the Shift-drag did not change the equation');
        await park();
        await shot('lp-turned', { rects: { ...editorRects }, values: { ...after, undo } });

        // Undo, so the session ends as it began (and the claim "one undo step" is checked on the way).
        await obs.key('z', { mod: true });
        await obs.waitForRender();
        const restored = await state();
        if (restored.equation !== before.equation || restored.c !== before.c) throw new Error(`capture: undo left "${restored.equation}", c = ${restored.c}`);
        await obs.closeEditor();

        if (obs.errors.length) {
            throw new Error(`capture: Obsidian logged ${obs.errors.length} console error(s):\n` + obs.errors.map((e) => `  ${e.type}: ${e.text}`).join('\n'));
        }
        const turn = { from: TURN.from, to: TURN.to, pivot: [3, 1], before, after, undo };
        const meta = { versions, view: { ...VIEW }, turn, constraint, shots };
        fs.writeFileSync(path.join(shotsDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
        fs.writeFileSync(path.join(shotsDir, 'meta.js'), `/* eslint-env browser */\n// Written by scripts/media/brand/proofs/capture.mjs. Do not edit.\nwindow.BRAND_SHOTS = ${JSON.stringify(meta, null, 2)};\n`);
        log(`turn: ${before.equation}, c = ${before.c}  ->  ${after.equation}, c = ${after.c}  ("${undo}")`);
        return meta;
    } finally {
        await obs.quit();
    }
}

/**
 * The Build panel as the title page shows it. Untouched, its first words are an empty state ("No
 * functions yet") and the editor's lower edge cuts a card in half. So two cards are collapsed with
 * real clicks on their headers (C1 and P2: their one-line summaries stay) and the list is scrolled
 * to its end with the wheel: "Shapes and marks" then leads, and the list ends with the whole P1 card.
 * Returns what was done; throws when the panel does not end up that way.
 */
async function tidyPanel(obs) {
    const PANEL = `${MODAL} .etz-tabpanel.mod-build`;
    const collapsed = ['C1', 'P2'];
    for (const name of collapsed) {
        const at = await obs.call(
            (panelSel, cardName) => {
                const card = Array.from(document.querySelectorAll(`${panelSel} .etz-card`)).find((el) => ((el.querySelector('.etz-card-name') || {}).textContent || '').trim() === cardName);
                const chevron = card && !card.classList.contains('is-collapsed') ? card.querySelector('.etz-card-chevron') : null;
                if (!chevron) return null;
                chevron.scrollIntoView({ block: 'nearest' });
                const r = chevron.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            },
            PANEL,
            name
        );
        if (!at) throw new Error(`capture: no open card "${name}" in the Build panel`);
        await obs.mouse.click(at);
        await obs.waitForRender();
    }
    const measure = () =>
        obs.call((panelSel) => {
            const panel = document.querySelector(panelSel);
            const box = panel.getBoundingClientRect();
            const headers = Array.from(panel.querySelectorAll('.etz-group-header')).filter((el) => el.getBoundingClientRect().bottom > box.top + 1);
            const cards = panel.querySelectorAll('.etz-card');
            const last = cards[cards.length - 1].getBoundingClientRect();
            const head = headers.length ? headers[0].getBoundingClientRect() : null;
            const title = headers.length ? headers[0].querySelector('.etz-group-title') : null;
            return {
                scrollTop: Math.round(panel.scrollTop),
                atEnd: panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1,
                first: title ? (title.textContent || '').trim() : '',
                above: head ? Math.round((head.top - box.top) * 10) / 10 : -1,
                below: Math.round((box.bottom - last.bottom) * 10) / 10,
                open: Array.from(cards).filter((el) => !el.classList.contains('is-collapsed')).map((el) => ((el.querySelector('.etz-card-name') || {}).textContent || '').trim()),
            };
        }, PANEL);
    let m = await measure();
    for (let i = 0; i < 20 && !m.atEnd; i++) {
        await obs.mouse.wheel(PANEL, 400);
        await obs.sleep(120);
        m = await measure();
    }
    await obs.blur();
    await obs.mouse.move({ x: 2, y: 2 });
    await obs.waitForRender();
    await obs.sleep(2500); // the overlay scroll bar fades out
    m = await measure();
    if (!m.atEnd || m.first !== 'Shapes and marks' || m.above < 8 || m.below < 8 || m.open.join(',') !== 'R1,P1') {
        throw new Error(`capture: the Build panel is not tidy: ${JSON.stringify(m)} (expected "Shapes and marks" to lead, R1 and P1 open, and the list to end above the edge)`);
    }
    return { collapsed, ...m };
}

// Run directly: node scripts/media/brand/proofs/capture.mjs [--port 9371] [--work dir] [--shots dir]
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    const { parseArgs } = await import('node:util');
    const { values } = parseArgs({ options: { port: { type: 'string' }, work: { type: 'string' }, shots: { type: 'string' }, plugin: { type: 'string' } } });
    const here = path.dirname(new URL(import.meta.url).pathname);
    await capture({
        port: Number(values.port || process.env.ETZ_MEDIA_PORT || 9371),
        workDir: values.work,
        plugin: values.plugin,
        shotsDir: path.resolve(values.shots || path.join(here, 'shots')),
        log: (text) => process.stderr.write(`[brand] ${text}\n`),
    });
}
