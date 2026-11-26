/* eslint-env browser, node */
// The README film: a clean take with a pointer, 16:9, 1920 x 1080, 60 fps, about 70 s, filmed with kit.mjs in
// the isolated Obsidian of ../lib/obsidian.mjs (never the user's app), in parts that are kept (parts.mjs): a run
// films only the parts whose code or start changed and joins them with the kept ones. See README.md here.
//
//   npm run media:readme -- --plugin DIR --sound --music   # the plugin files in DIR (the release: gh release download)
//   npm run media:readme -- --root                          # the build in the repository root
//   npm run media:readme -- --refilm plane                  # film a part again although nothing changed (or all)
//   node scripts/media/film/upload.mjs readme-music.mp4 --card thumbnail.png   # the copy to upload (under 10 MB)
//
// The parts, in order:
//   build   the function of the 5.2 tour typed as display math ($$...$$), hovered: its card; Open in the editor;
//           Options, Tangent (its point dragged over the hill into the valley, to x = 4); + Add, Area under a
//           function (1 <= x <= 4 at first, its 1 typed over with 0: from the y-axis to the tangent); + Add,
//           Riemann sum (from 0 to 4, its default; its fill to 0 %, outlines on the area; its numbers off; slider
//           n from 6 to 24); Save changes: the chart under the formula
//   plane   a plane typed under the chart, hovered: its card opens, the camera goes in, the plane turns; a new
//           note (Cmd+N)
//   ripple  the new note: a 3D chart typed by hand (solid, smooth, the most samples), its chart under it; a click
//           on the chart: the editor, zoomed and turned
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PORTS, REPO, defaultWorkDir } from '../lib/obsidian.mjs';
import { checkFilm } from './check.mjs';
import { rectOf } from './kit.mjs';
import { filmParts, pluginKey } from './parts.mjs';
import { addSound } from './sound.mjs';

const { values } = parseArgs({
    options: {
        out: { type: 'string' },
        port: { type: 'string' },
        work: { type: 'string' },
        cache: { type: 'string' },
        plugin: { type: 'string' },
        root: { type: 'boolean', default: false },
        refilm: { type: 'string', default: '' },
        size: { type: 'string', default: '1920x1080' },
        sound: { type: 'boolean', default: false },
        music: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h' },
    },
});
if (values.help) {
    console.log('Usage: node scripts/media/film/readme.mjs [--plugin DIR | --root] [--refilm build,plane,ripple|all] [--out FILE.mp4] [--cache DIR] [--size 1920x1080] [--port 9345] [--sound] [--music]');
    process.exit(0);
}
const port = Number(values.port || process.env.ETZ_MEDIA_PORT || PORTS.film);
const OUT = path.resolve(values.out || path.join(os.tmpdir(), 'easy-tikz-media', 'film', 'readme.mp4'));
const BASE = OUT.replace(/\.mp4$/i, '');
const CACHE = path.resolve(values.cache || path.join(REPO, '.media-cache', 'film', 'readme'));
// The frame, and a window of the same aspect at the full-screen height of a 16 inch MacBook Pro (1117 CSS px).
const [FRAME_W, FRAME_H] = values.size.split('x').map(Number);
if (!(FRAME_W > 0 && FRAME_H > 0)) throw new Error(`--size ${values.size}: expected WIDTHxHEIGHT, such as 1920x1080`);
const WINDOW = { width: Math.round((1117 * FRAME_W) / FRAME_H), height: 1117 };
const PLUGIN = values.plugin ? path.resolve(values.plugin) : 'root';
const say = (s) => process.stderr.write(`[readme] ${s}\n`);

// The function of the 5.2 tour, as the note writes it (display math); the point of its tangent; and the range of the
// area under it: from 0 (the y-axis) to the tangent's point. The area starts as 1 <= x <= 4: its 1 is typed over
// with 0. The Riemann sum starts from 0 to 4 and is not changed, so both end at the tangent.
const DISPLAY = '$$f(x) = \\frac{x}{2} + \\sin(x) + 1$$';
const TANGENT_AT = 4;
const AREA_FROM = '0';
// The look of formula charts (the setting Default chart for formulas): axes through the origin, so an area or a
// Riemann sum stands on the x-axis. In the box of the default look the line y = 0 is not drawn and they float.
const FORMULA_LOOK = { formulaDefault: { axis_style: 'middle' } };
// The 3D chart typed by hand: the Ripple, solid (opacity 1), smooth (mesh 0), at the most samples of the editor's
// slider (80, the plugin's default cap), in a cube whose z range is the surface's, so the waves stand tall.
const RIPPLE = [
    '3d',
    'cube',
    'show x from -5 to 5, y from -5 to 5 and z from -1 to 1',
    'plot f(x, y) = sin(sqrt(x^2 + y^2)) in viridis, opacity 1, mesh 0, 80 samples',
].join('\n');

const NOTE = '.workspace-leaf.mod-active .markdown-source-view';
const MODAL = '.modal.tikz-modal';

/** The helpers every part uses, for one launch (`obs`) and its film. Their code is part of every part's key. */
function tools(obs, film) {
    const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    const waitFor = (fn, message, timeout = 8000) => obs.waitFor(() => obs.call(fn), { timeout, interval: 20, message });
    const t = {
        center,
        waitFor,
        f: (x) => x / 2 + Math.sin(x) + 1,
        editorReady: () => waitFor(() => !!window.__etzMedia.editor() && window.__etzMedia.editor().ready === true, 'the editor'),
        /** The rectangle of the first visible element under `selector` whose text includes `text`. */
        rectOfText: (selector, text) =>
            obs.call(
                (s, x) => {
                    const el = Array.from(document.querySelectorAll(s)).find((e) => e.getClientRects().length && (e.textContent || '').includes(x));
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { x: r.left, y: r.top, width: r.width, height: r.height };
                },
                selector,
                text,
            ),
        /** The rectangle of the first visible input of the editor whose value matches `pattern` (a RegExp source). */
        inputMatching: (pattern) =>
            obs.call((p) => {
                const el = Array.from(document.querySelectorAll('.modal.tikz-modal input, .modal.tikz-modal textarea')).find((e) => e.getClientRects().length && new RegExp(p).test(e.value));
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: r.left, y: r.top, width: r.width, height: r.height };
            }, pattern),
        /** Select the text of the focused field, so what is typed next replaces it (a Cmd+A key event does not select in the test app on macOS). */
        selectField: () =>
            obs.call(() => {
                const el = document.activeElement;
                if (el instanceof HTMLInputElement) el.select();
            }),
        /** The last line of the active note (an empty line under the chart). */
        lastLine: () =>
            obs.call((s) => {
                const lines = Array.from(document.querySelectorAll(`${s} .cm-content .cm-line`));
                const r = lines[lines.length - 1].getBoundingClientRect();
                return { x: r.left, y: r.top, width: r.width, height: r.height };
            }, NOTE),
        /** The editor's preview with its Sliders dock: the camera's close shot of the editor. */
        stageRect: () =>
            obs.call(() => {
                const m = window.__etzMedia.editor();
                const a = m.chartEl.getBoundingClientRect();
                // A slider of the Sliders dock, not one of a card in the Build tab (a region's opacity).
                const row = Array.from(document.querySelectorAll('.modal.tikz-modal input[type="range"]')).find((e) => e.getClientRects().length && !e.closest('.etz-build'));
                const b = row ? row.getBoundingClientRect() : a;
                const x = Math.min(a.left, b.left);
                const y = Math.min(a.top, b.top);
                return { x, y, width: Math.max(a.right, b.right) - x, height: Math.max(a.bottom, b.bottom) - y };
            }),
        /** + Add, a search, Enter: the first item. */
        addFromMenu: async (search) => {
            // A long Build tab scrolls + Add out of sight: back to the top first, on camera.
            const scrolled = await obs.call(() => {
                let el = document.querySelector('.modal.tikz-modal .etz-build-add');
                while (el && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
                if (!el) return 0;
                el.dataset.filmScroll = 'build';
                return el.scrollTop;
            });
            if (scrolled > 0) await film.scroll('[data-film-scroll="build"]', 0, 0.6);
            const add = await rectOf(obs, `${MODAL} .etz-build-add`);
            await film.click(center(add).x, center(add).y, 0.8);
            await waitFor(() => !!document.querySelector('.etz-picker .etz-picker-input'), 'the + Add menu');
            film.mark('pop');
            await film.tick(12);
            await film.type(search, 12);
            await film.tick(16);
            await film.key('Enter');
            await film.tick(20);
        },
        /** A drag with Alt held: the dragged value follows the pointer pixel by pixel (without Alt it snaps to round numbers within 2 px, and the chart would move in jumps). */
        fineDrag: async (points, seconds) => {
            await obs.keyDown('Alt');
            await film.drag(points, seconds);
            await obs.keyUp('Alt');
        },
    };
    return t;
}

// ==================================================================== the parts
const parts = [
    {
        id: 'build',
        inputs: { DISPLAY, TANGENT_AT, AREA_FROM },
        pluginData: FORMULA_LOOK,
        // Empty lines: the formula goes on the first; Save puts the chart under it; the plane is typed on the last.
        notes: () => ({ 'Planes and areas.md': '\n\n\n' }),
        async setup(obs) {
            await obs.openNote('Planes and areas', { mode: 'live', cursor: 'start' });
            await obs.sleep(400);
        },
        async film(film, obs) {
            const t = tools(obs, film);
            const { center, f } = t;
            const title = await rectOf(obs, `${NOTE} .inline-title`);
            const left = title.x - 36;
            // The formula typed as display math, close on the title and its line; out of the line, it is set.
            film.camera({ cx: left + 360, cy: title.y + 150, w: 760 }, 0);
            await obs.mouse.move({ x: left + 600, y: title.y + 330 });
            await film.hold(0.6, { still: false });
            await film.type(DISPLAY, 14);
            await film.tick(8);
            await obs.key('ArrowDown');
            await film.tick(24);
            // Hovered: its card opens after its delay (real time: the film holds still meanwhile).
            const math = await rectOf(obs, `${NOTE} .math-block`);
            await film.move(math.x + math.width * 0.5, math.y + math.height * 0.55, 0.9);
            await film.hold(0.35);
            await t.waitFor(() => !!document.querySelector('.etz-formula-pop .etz-formula-chart svg, .etz-formula-pop .etz-formula-chart canvas'), 'the formula card');
            film.mark('pop');
            await film.tick(18);
            const card = await rectOf(obs, '.etz-formula-pop');
            const x0 = Math.min(card.x, math.x);
            const x1 = Math.max(card.x + card.width, math.x + math.width);
            film.camera({ x: x0, y: math.y - 10, width: x1 - x0, height: card.y + card.height - math.y + 10 }, 1.0, { pad: 30 });
            await film.cameraWait();
            await film.hold(0.6, { still: false });
            // Open in the editor.
            const open = await t.rectOfText('.etz-formula-pop button', 'Open in the editor');
            await film.click(center(open).x, center(open).y, 0.7);
            await t.editorReady();
            film.mark('pop');
            await film.tick(6);
            const modal = await rectOf(obs, MODAL);
            film.camera(modal, 0.9, { pad: 12 });
            await film.cameraWait();
            await film.hold(0.3, { still: false });
            // The tangent: Options, Tangent; its point dragged along the curve over the hill into the valley, to x = 4,
            // where the area and the Riemann sum end.
            const options = await t.rectOfText(`${MODAL} button.etz-disclosure-btn`, 'Options');
            await film.click(center(options).x, center(options).y, 0.8);
            await film.tick(14);
            const tangent = await t.rectOfText(`${MODAL} button`, 'Tangent');
            await film.click(center(tangent).x, center(tangent).y, 0.6);
            await film.tick(24);
            const at = Number(
                await obs.call(() => {
                    const i = Array.from(document.querySelectorAll('.modal.tikz-modal .etz-input')).find((e) => e.getClientRects().length && (e.getAttribute('placeholder') || '').startsWith('e.g. 1, a'));
                    return i ? i.value : 'NaN';
                }),
            );
            film.camera(await t.stageRect(), 0.9, { pad: 20 });
            await film.cameraWait();
            const t0 = await obs.point([at, f(at)]);
            await film.move(t0.x, t0.y, 0.8);
            const goal = TANGENT_AT;
            const step = goal > at ? 0.2 : -0.2;
            const along = [];
            for (let x = at + step; (goal - x) * step > 0.02; x += step) {
                const p = await obs.point([x, f(x)]);
                along.push([p.x, p.y]);
            }
            const top = await obs.point([goal, f(goal)]);
            along.push([top.x, top.y]);
            await t.fineDrag(along, 3.0);
            const tangentAt = await obs.call(() => {
                const i = Array.from(document.querySelectorAll('.modal.tikz-modal .etz-input')).find((e) => e.getClientRects().length && (e.getAttribute('placeholder') || '').startsWith('e.g. 1, a'));
                return i ? i.value : '';
            });
            if (Number(tangentAt) !== TANGENT_AT) say(`build: the tangent ended at ${tangentAt}, not at ${TANGENT_AT}`);
            await film.hold(0.5, { still: false });
            // + Add, Area under a function: from 1 to 4 at first. In its range (1 <= x <= 4) the 1 is selected and
            // typed over with 0: the area then runs from the y-axis to the tangent's point.
            film.camera(modal, 0.8, { pad: 12 });
            await t.addFromMenu('area under');
            await film.tick(16);
            const range = await t.inputMatching('^\\s*1\\s*(<=|≤)\\s*x\\s*(<=|≤)\\s*4\\s*$');
            if (!range) throw new Error('readme: the range of the area (1 <= x <= 4) is not in sight');
            await film.click(range.x + Math.min(24, range.width * 0.2), range.y + range.height / 2, 0.7);
            await obs.call(() => {
                const el = document.activeElement;
                if (!(el instanceof HTMLInputElement)) return;
                const at = el.value.indexOf('1');
                el.setSelectionRange(at, at + 1);
            });
            await film.tick(10);
            await film.type(AREA_FROM, 8);
            await film.tick(30);
            // + Add, Riemann sum (from 0 to 4, as the area now); its fill to 0 %, so its outlines lie on the blue
            // area (two fills over each other turn brown); the number of rectangles: slider n from 6 to 24.
            await t.addFromMenu('riemann');
            await film.tick(16);
            const fill = await obs.call(() => {
                const all = Array.from(document.querySelectorAll('.modal.tikz-modal .etz-build input[type="range"]')).filter((e) => e.getClientRects().length);
                const el = all[all.length - 1];
                const r = el.getBoundingClientRect();
                const at = (v) => r.left + 8 + ((r.width - 16) * (v - Number(el.min || 0))) / (Number(el.max || 1) - Number(el.min || 0));
                return { from: { x: at(Number(el.value)), y: r.top + r.height / 2 }, to: { x: at(Number(el.min || 0)), y: r.top + r.height / 2 } };
            });
            await film.move(fill.from.x, fill.from.y, 0.8);
            await film.drag([[fill.to.x, fill.to.y]], 0.9);
            await film.tick(12);
            // Its numbers off: the label placer moves them off the curve, and in this view onto the y-axis.
            const numbers = await t.rectOfText(`${MODAL} button`, 'Sum and integral');
            await film.click(center(numbers).x, center(numbers).y, 0.7);
            await film.hold(0.4, { still: false });
            film.camera(await t.stageRect(), 0.9, { pad: 20 });
            await film.tick(20);
            const n0 = await obs.point({ slider: 'n' });
            const n1 = await obs.point({ slider: 'n', value: 24 });
            await film.move(n0.x, n0.y, 0.8);
            await film.drag([[n1.x, n1.y]], 2.4);
            await film.hold(0.6, { still: false });
            // Saved: the chart under the formula in the note; the cursor to the end of the note, where the next part opens it.
            film.camera(modal, 0.8, { pad: 12 });
            const save = await t.rectOfText(`${MODAL} button`, 'Save changes');
            await film.click(center(save).x, center(save).y, 0.8);
            await t.waitFor(() => !!document.querySelector('.workspace-leaf.mod-active .block-language-easy-tikz .etz-inline-box svg'), 'the chart in the note', 15000);
            await obs.call(() => {
                const editor = app.workspace.activeEditor && app.workspace.activeEditor.editor;
                if (editor) editor.setCursor({ line: editor.lastLine(), ch: 0 });
            });
            await film.tick(12);
            const block = await rectOf(obs, `${NOTE} .block-language-easy-tikz`);
            const formula = await rectOf(obs, `${NOTE} .math-block`);
            film.camera({ x: block.x, y: formula.y - 10, width: block.width, height: block.y + block.height - formula.y + 10 }, 0.9, { pad: 30 });
            await film.cameraWait();
            await film.hold(1.0, { still: false });
            const note = await obs.call(() => app.workspace.activeEditor.editor.getValue());
            return { camera: film.cameraNow(), pointer: film.pointerNow(), note };
        },
    },
    {
        id: 'plane',
        pluginData: FORMULA_LOOK,
        // The note as the part before left it, the chart in it.
        notes: (start) => ({ 'Planes and areas.md': start.note }),
        async setup(obs) {
            await obs.openNote('Planes and areas', { mode: 'live', cursor: 'end' });
            await obs.sleep(400);
        },
        async film(film, obs) {
            const t = tools(obs, film);
            const { center } = t;
            const title = await rectOf(obs, `${NOTE} .inline-title`);
            const left = title.x - 36;
            const line = await t.lastLine();
            film.camera({ cx: left + 360, cy: line.y + line.height / 2 - 40, w: 720 }, 0.9);
            await film.click(line.x + 24, line.y + line.height / 2, 0.8);
            await film.tick(8);
            await film.type('The plane $z = 4 - x - 2y$ cuts all three axes.', 15);
            await film.hold(0.5, { still: false });
            // The formula in the typed line: the last in a line of text (not the display math above, nor one in the chart).
            const math = await obs.call((s) => {
                const all = Array.from(document.querySelectorAll(`${s} .cm-content .cm-line .math`)).filter((e) => e.getClientRects().length && !e.classList.contains('math-block'));
                const r = all[all.length - 1].getBoundingClientRect();
                return { x: r.left, y: r.top, width: r.width, height: r.height };
            }, NOTE);
            await film.move(math.x + math.width * 0.55, math.y + math.height * 0.6, 0.9);
            // The card opens after its delay (real time): the film holds still meanwhile, then the card fades in on the film clock.
            await film.hold(0.35);
            await t.waitFor(() => !!document.querySelector('.etz-formula-pop .etz-formula-chart svg, .etz-formula-pop .etz-formula-chart canvas'), 'the formula card');
            film.mark('pop');
            await film.tick(18);
            const card = await rectOf(obs, '.etz-formula-pop');
            film.camera(card, 1.0, { pad: 36 });
            await film.cameraWait();
            await film.hold(0.3, { still: false });
            const cc = center(await rectOf(obs, '.etz-formula-pop .etz-formula-chart'));
            await film.move(cc.x, cc.y, 0.5);
            await film.drag([[cc.x + 120, cc.y + 10], [cc.x - 60, cc.y - 25]], 2.0);
            await film.hold(0.5, { still: false });
            // A new note. The camera on the top of the note column, the pointer at rest in it: there the next part starts.
            await obs.key('Escape');
            film.camera({ cx: left + 36 + 350, cy: title.y + 315, w: 1300 }, 1.0);
            await film.move(left + 36 + 640, title.y + 560, 0.9);
            await film.cameraWait();
            await film.tick(12);
            await obs.key('n', { mod: true });
            await t.waitFor(() => {
                const el = document.querySelector('.workspace-leaf.mod-active .inline-title');
                return !!el && document.activeElement === el;
            }, 'the new note');
            film.mark('pop');
            await film.tick(10);
            return { camera: film.cameraNow(), pointer: film.pointerNow() };
        },
    },
    {
        id: 'ripple',
        inputs: { RIPPLE },
        // A new note open, its title Untitled selected, as the part before ended.
        notes: () => ({ 'Planes and areas.md': '' }),
        async setup(obs) {
            await obs.openNote('Planes and areas', { mode: 'live' });
            await obs.key('n', { mod: true });
            await tools(obs, null).waitFor(() => {
                const el = document.querySelector('.workspace-leaf.mod-active .inline-title');
                return !!el && document.activeElement === el;
            }, 'the new note');
            await obs.sleep(300);
        },
        async film(film, obs, start) {
            const t = tools(obs, film);
            // Closer while the note is still empty: its title and the first lines of the block fill the frame.
            const title = await rectOf(obs, `${NOTE} .inline-title`);
            film.camera({ cx: start.camera.cx, cy: title.y + 230, w: 1000 }, 0.8);
            await film.type('Ripple', 10);
            await film.tick(8);
            await film.key('Enter');
            await film.tick(10);
            await film.type('```easy-tikz\n\n```\n', 18);
            await obs.key('ArrowUp');
            await film.tick(4);
            await obs.key('ArrowUp');
            await film.tick(10);
            await film.type(RIPPLE, 26);
            await film.hold(0.3, { still: false });
            // Back, until the whole surface under the code is in the frame.
            film.camera({ cx: start.camera.cx, cy: title.y + 470, w: 1800 }, 1.0);
            await film.cameraWait();
            await film.hold(1.2, { still: false });
            // Out of the block: it becomes its chart.
            await obs.key('ArrowDown');
            await obs.key('ArrowDown');
            await film.tick(10);
            await t.waitFor(() => !!document.querySelector('.workspace-leaf.mod-active .block-language-easy-tikz .etz-inline-box svg, .workspace-leaf.mod-active .block-language-easy-tikz .etz-inline-box canvas'), 'the 3D chart in the note', 15000);
            await film.tick(6);
            const block = await rectOf(obs, `${NOTE} .block-language-easy-tikz`);
            // The chart with the note's title over it (the block alone cuts the title in half at the top edge).
            const head = await rectOf(obs, `${NOTE} .inline-title`);
            film.camera({ x: block.x, y: head.y - 12, width: block.width, height: block.y + block.height - head.y + 12 }, 0.9, { pad: 30 });
            await film.cameraWait();
            await film.hold(1.0, { still: false });
            // A click on the chart: the editor, zoomed and turned.
            const box = await rectOf(obs, `${NOTE} .block-language-easy-tikz .etz-inline-box`);
            await film.click(box.x + box.width * 0.5, box.y + box.height * 0.45, 0.7);
            await t.editorReady();
            film.mark('pop');
            await film.tick(6);
            const modal = await rectOf(obs, MODAL);
            film.camera(modal, 0.9, { pad: 12 });
            await film.cameraWait();
            await film.hold(0.6, { still: false });
            // The preview alone (the sliders of the surface card are not a Sliders dock).
            const preview = await obs.call(() => {
                const r = window.__etzMedia.editor().chartEl.getBoundingClientRect();
                return { x: r.left, y: r.top, width: r.width, height: r.height };
            });
            film.camera(preview, 0.9, { pad: 20 });
            await film.tick(16);
            const stage = await obs.point({ preview: [0.5, 0.5] });
            await film.move(stage.x, stage.y, 0.8);
            await film.wheel(stage.x, stage.y, -320, 1.2);
            await film.hold(0.2, { still: false });
            await film.drag([[stage.x + 260, stage.y + 30], [stage.x + 120, stage.y - 20]], 3.2);
            await film.wheel(stage.x, stage.y, 140, 0.9);
            await film.hold(0.5, { still: false });
            film.camera(modal, 0.9, { pad: 12 });
            await film.cameraWait();
            await film.hold(1.4, { still: false });
            return {};
        },
    },
];

const refilm = values.refilm === 'all' ? 'all' : values.refilm.split(',').map((s) => s.trim()).filter(Boolean);
const r = await filmParts(parts, {
    out: OUT,
    cache: CACHE,
    width: FRAME_W,
    height: FRAME_H,
    fps: 60,
    refilm,
    shared: [tools],
    plugin: pluginKey(PLUGIN === 'root' ? REPO : PLUGIN),
    say,
    launchOptions: () => ({
        port,
        workDir: values.work ? path.resolve(values.work) : defaultWorkDir(port),
        plugin: PLUGIN,
        theme: 'light',
        width: WINDOW.width,
        height: WINDOW.height,
        // Typing as it is typed: no auto-paired brackets or marks, no spelling marks.
        appConfig: { autoPairBrackets: false, autoPairMarkdown: false, spellcheck: false, showInlineTitle: true },
        corePlugins: { 'command-palette': true },
        quiet: true,
    }),
});
say(`film: ${r.seconds.toFixed(2)} s; ${r.parts.map((p) => `${p.id} ${p.filmed ? 'filmed' : 'kept'}`).join(', ')}`);
const report = await checkFilm(OUT, { sheet: `${BASE}-sheet.png` });
say(`${OUT}\n${report.text}`);
// The sound, from the events beside the film (sound.mjs): effects, and with --music the bed too.
if (values.sound || values.music) say(`with sound: ${await addSound(OUT, { music: false })}`);
if (values.music) say(`with music: ${await addSound(OUT, { music: true })}`);
