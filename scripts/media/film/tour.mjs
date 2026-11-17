/* eslint-env browser, node */
// The 5.2 tour as one clean take with a pointer: 16:9, 1920 x 1080, 60 fps, about 70 s, filmed with kit.mjs in
// the isolated Obsidian of ../lib/obsidian.mjs (never the user's app). See README.md in this folder.
//
//   npm run media:tour                                  # the whole tour, to <tmp>/easy-tikz-media/film/tour.mp4
//   npm run media:tour -- proof                         # the opening only (about 12 s): to check a change quickly
//   npm run media:tour -- --root --out ~/Desktop/tour.mp4   # the build in the repository root, another file
//   npm run media:tour -- --sound --music               # also tour-sound.mp4 (effects) and tour-music.mp4 (with a bed)
//   npm run media:tour -- --size 1800x1200              # another frame: 3:2 here; the window takes the same aspect
//
// The parts, in order:
//   1  a plane typed in a note
//   2  hovered: its card opens, the camera goes in, the plane turns
//   3  a block typed line by line: its chart grows under it
//   4  into the editor (a click on the chart)
//   5  + Add finds the Riemann sum, slider n from 6 to 24, the tangent point along the curve, the label
//      into the area; saved, the chart in the note follows
//   6  a new chart from the command palette (Open editor): 3D, the Ripple template from + Add, zoom and turn
//   7  Help: down to the Showcase, a guide clicked through
// After filming, check.mjs measures the film for uneven frames and writes a contact sheet beside it.
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PORTS, defaultWorkDir, launch } from '../lib/obsidian.mjs';
import { checkFilm } from './check.mjs';
import { createFilm, rectOf } from './kit.mjs';
import { addSound } from './sound.mjs';

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        out: { type: 'string' },
        port: { type: 'string' },
        work: { type: 'string' },
        root: { type: 'boolean', default: false },
        size: { type: 'string', default: '1920x1080' },
        sound: { type: 'boolean', default: false },
        music: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h' },
    },
});
if (values.help) {
    console.log('Usage: node scripts/media/film/tour.mjs [proof] [--out FILE.mp4] [--size 1920x1080] [--port 9345] [--work DIR] [--root] [--sound] [--music]');
    process.exit(0);
}
const part = positionals[0] === 'proof' ? 'proof' : 'all';
const port = Number(values.port || process.env.ETZ_MEDIA_PORT || PORTS.film);
const OUT = path.resolve(values.out || path.join(os.tmpdir(), 'easy-tikz-media', 'film', part === 'proof' ? 'proof.mp4' : 'tour.mp4'));
const BASE = OUT.replace(/\.mp4$/i, '');
// The frame, and a window of the same aspect at the full-screen height of a 16 inch MacBook Pro (1117 CSS px):
// a wider frame shows more at the sides, never less above and below.
const [FRAME_W, FRAME_H] = values.size.split('x').map(Number);
if (!(FRAME_W > 0 && FRAME_H > 0)) throw new Error(`--size ${values.size}: expected WIDTHxHEIGHT, such as 1920x1080`);
const WINDOW = { width: Math.round((1117 * FRAME_W) / FRAME_H), height: 1117 };
const say = (s) => process.stderr.write(`[tour] ${s}\n`);

const BLOCK = [
    'show x from 0 to 8 and y from 0 to 6',
    'slider a from 0 to 8, starting at 2.5, in steps of 0.01',
    'plot f(x) = x/2 + sin(x) + 1 with its tangent at a',
    'shade under f from x = 0 to 4',
    'write "area under f" at (6, 1)',
].join('\n');
const f = (x) => x / 2 + Math.sin(x) + 1;

const obs = await launch({
    port,
    workDir: values.work ? path.resolve(values.work) : defaultWorkDir(port),
    plugin: values.root ? 'root' : 'source',
    theme: 'light',
    width: WINDOW.width,
    height: WINDOW.height,
    notes: { 'Planes and areas.md': '' },
    // Typing as it is typed: no auto-paired brackets or marks, no spelling marks.
    appConfig: { autoPairBrackets: false, autoPairMarkdown: false, spellcheck: false, showInlineTitle: true },
    corePlugins: { 'command-palette': true },
    quiet: true,
});

const NOTE = '.workspace-leaf.mod-active .markdown-source-view';
const MODAL = '.modal.tikz-modal';
const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
/** The rectangle of the first visible element under `selector` whose text includes `text`. */
const rectOfText = (selector, text) =>
    obs.call(
        (s, t) => {
            const el = Array.from(document.querySelectorAll(s)).find((e) => e.getClientRects().length && (e.textContent || '').includes(t));
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.left, y: r.top, width: r.width, height: r.height };
        },
        selector,
        text,
    );
const waitFor = (fn, message, timeout = 8000) => obs.waitFor(() => obs.call(fn), { timeout, interval: 20, message });

try {
    await obs.openNote('Planes and areas', { mode: 'live', cursor: 'end' });
    await obs.sleep(800);
    const film = await createFilm(obs, { out: OUT, fps: 60, width: FRAME_W, height: FRAME_H, stills: `${BASE}-stills`, say });

    // ---------------------------------------------------------------- 1. the plane, typed
    const sizer = await rectOf(obs, `${NOTE} .cm-sizer`);
    const title = await rectOf(obs, `${NOTE} .inline-title`);
    const left = title.x - 36;
    // Close on the title and the sentence being typed; the pointer rests to the side, in the frame.
    film.camera({ cx: left + 360, cy: sizer.y + 140, w: 720 }, 0);
    await obs.mouse.move({ x: left + 560, y: sizer.y + 250 });
    await film.hold(0.6, { still: false });
    await film.type('The plane $z = 4 - x - 2y$ cuts all three axes.', 15);
    await film.hold(0.5, { still: false });

    // ---------------------------------------------------------------- 2. hovered: its chart opens, the camera goes in, the plane turns
    const math = await rectOf(obs, `${NOTE} .cm-content .math`);
    await film.move(math.x + math.width * 0.55, math.y + math.height * 0.6, 0.9);
    // The card opens after its delay (real time): the film holds still meanwhile, then the card fades in on the film clock.
    await film.hold(0.35);
    await waitFor(() => !!document.querySelector('.etz-formula-pop .etz-formula-chart svg, .etz-formula-pop .etz-formula-chart canvas'), 'the formula card');
    film.mark('pop');
    await film.tick(18);
    const card = await rectOf(obs, '.etz-formula-pop');
    film.camera(card, 1.0, { pad: 36 });
    await film.cameraWait();
    await film.hold(0.3, { still: false });
    const chartBox = await rectOf(obs, '.etz-formula-pop .etz-formula-chart');
    const cc = center(chartBox);
    await film.move(cc.x, cc.y, 0.5);
    await film.drag([[cc.x + 120, cc.y + 10], [cc.x - 60, cc.y - 25]], 2.0);
    await film.hold(0.5, { still: false });
    if (part === 'proof') {
        film.camera({ cx: left + 450, cy: sizer.y + 260, w: 900 }, 0.9);
        await film.cameraWait();
        await film.hold(0.5, { still: false });
    } else {
        // ---------------------------------------------------------------- 3. a block: the chart grows as its lines are typed
        await obs.key('Escape');
        // The whole height: the code and the chart that grows under it.
        film.camera('full', 1.0);
        await film.tick(20);
        await obs.key('End');
        await film.type('\n\n```easy-tikz\n\n```\n', 18);
        await obs.key('ArrowUp');
        await film.tick(4);
        await obs.key('ArrowUp');
        await film.tick(10);
        await film.type(BLOCK, 24);
        await film.hold(0.6, { still: false });
        // Out of the block: it becomes its chart.
        await obs.key('ArrowDown');
        await obs.key('ArrowDown');
        await film.tick(10);
        await waitFor(() => !!document.querySelector('.workspace-leaf.mod-active .block-language-easy-tikz .etz-inline-box svg'), 'the chart in the note', 15000);
        await film.tick(6);
        const block = await rectOf(obs, `${NOTE} .block-language-easy-tikz`);
        say(`block ${JSON.stringify(block)}`);
        film.camera(block, 0.9, { pad: 40 });
        await film.cameraWait();
        await film.hold(0.8, { still: false });

        // ---------------------------------------------------------------- 4. into the editor
        const box = await rectOf(obs, `${NOTE} .block-language-easy-tikz .etz-inline-box`);
        await film.click(box.x + box.width * 0.55, box.y + box.height * 0.35, 0.7);
        await waitFor(() => !!window.__etzMedia.editor() && window.__etzMedia.editor().ready === true, 'the editor');
        film.mark('pop');
        await film.tick(6);
        const modal = await rectOf(obs, MODAL);
        say(`modal ${JSON.stringify(modal)}`);
        film.camera(modal, 0.9, { pad: 12 });
        await film.cameraWait();
        await film.hold(0.4, { still: false });

        // ---------------------------------------------------------------- 5. integral steps, slopes, labels
        /** The preview with its Sliders dock: the camera's close shot of the editor. */
        const stageRect = () =>
            obs.call(() => {
                const m = window.__etzMedia.editor();
                const a = m.chartEl.getBoundingClientRect();
                const row = document.querySelector('.modal.tikz-modal input[type="range"]');
                const b = row ? row.getBoundingClientRect() : a;
                const x = Math.min(a.left, b.left);
                const y = Math.min(a.top, b.top);
                return { x, y, width: Math.max(a.right, b.right) - x, height: Math.max(a.bottom, b.bottom) - y };
            });
        const add = await rectOf(obs, `${MODAL} .etz-build-add`);
        await film.click(center(add).x, center(add).y, 0.8);
        await waitFor(() => !!document.querySelector('.etz-picker .etz-picker-input'), 'the + Add menu');
        film.mark('pop');
        await film.tick(12);
        await film.type('riemann', 12);
        await film.tick(16);
        await film.key('Enter');
        await film.tick(20);
        film.camera(await stageRect(), 0.9, { pad: 20 });
        await film.tick(20);
        // The number of rectangles: slider n from 6 to 24.
        const n0 = await obs.point({ slider: 'n' });
        const n1 = await obs.point({ slider: 'n', value: 24 });
        await film.move(n0.x, n0.y, 0.8);
        await film.drag([[n1.x, n1.y]], 2.4);
        say(`n = ${await obs.sliderValue('n')}`);
        await film.hold(0.4, { still: false });
        // The tangent point along the curve: slider a from 2.5 to 6.2.
        const t0 = await obs.point([2.5, f(2.5)]);
        await film.move(t0.x, t0.y, 0.8);
        const along = [];
        for (let x = 2.75; x <= 6.21; x += 0.25) {
            const p = await obs.point([x, f(x)]);
            along.push([p.x, p.y]);
        }
        await film.drag(along, 2.4);
        say(`a = ${await obs.sliderValue('a')}`);
        await film.hold(0.4, { still: false });
        // The label: grabbed at its text, dragged into the area it names.
        const text = await rectOfText(`${MODAL} svg text`, 'area under f');
        const from = await obs.point([6, 1]);
        const to = await obs.point([2, 1.45]);
        const g = center(text);
        await film.move(g.x, g.y, 0.7);
        await film.drag([[g.x + (to.x - from.x), g.y + (to.y - from.y)]], 1.5);
        await film.hold(0.6, { still: false });
        // Saved: the chart in the note follows.
        film.camera(modal, 0.8, { pad: 12 });
        const save = await rectOfText(`${MODAL} button`, 'Save changes');
        await film.click(center(save).x, center(save).y, 0.8);
        await film.tick(12);
        const saved = await rectOf(obs, `${NOTE} .block-language-easy-tikz`);
        film.camera(saved, 0.9, { pad: 40 });
        await film.cameraWait();
        await film.hold(0.9, { still: false });
        // A new chart: the command palette, Open editor.
        film.camera('full', 0.8);
        await film.cameraWait();
        await obs.key('p', { mod: true });
        await waitFor(() => !!document.querySelector('.prompt input'), 'the command palette');
        film.mark('pop');
        await film.tick(12);
        await film.type('open editor', 16);
        await film.tick(14);
        await obs.key('Enter');
        await waitFor(() => !!window.__etzMedia.editor() && window.__etzMedia.editor().ready === true, 'the new editor');
        film.mark('pop');
        await film.tick(8);
        const modal2 = await rectOf(obs, MODAL);
        film.camera(modal2, 0.8, { pad: 12 });
        await film.cameraWait();
        await film.hold(0.4, { still: false });

        // ---------------------------------------------------------------- 6. 3D from + Add and a template: zoom, turn
        const to3d = await rectOfText(`${MODAL} button`, '3D');
        await film.click(center(to3d).x, center(to3d).y, 0.8);
        await film.tick(20);
        const add3 = await rectOf(obs, `${MODAL} .etz-build-add`);
        await film.click(center(add3).x, center(add3).y, 0.8);
        await waitFor(() => !!document.querySelector('.etz-picker .etz-picker-input'), 'the + Add menu in 3D');
        film.mark('pop');
        await film.tick(12);
        await film.type('ripple', 12);
        await film.tick(16);
        await film.key('Enter');
        await film.tick(20);
        film.camera(await stageRect(), 0.9, { pad: 20 });
        await film.tick(16);
        const stage = await obs.point({ preview: [0.5, 0.5] });
        await film.move(stage.x, stage.y, 0.8);
        await film.wheel(stage.x, stage.y, -320, 1.2);
        await film.hold(0.2, { still: false });
        await film.drag([[stage.x + 260, stage.y + 30], [stage.x + 120, stage.y - 20]], 3.0);
        await film.wheel(stage.x, stage.y, 140, 0.9);
        await film.hold(0.5, { still: false });
        film.camera(modal2, 0.8, { pad: 12 });

        // ---------------------------------------------------------------- 7. Help: down to the Showcase, a guide clicked through
        const helpTab = await rectOfText(`${MODAL} button, ${MODAL} [role="tab"]`, 'Help');
        await film.click(center(helpTab).x, center(helpTab).y, 0.9);
        await waitFor(() => !!document.querySelector('.modal.tikz-modal .etz-help'), 'the Help tab');
        await film.tick(24);
        const scroller = await obs.call(() => {
            let el = document.querySelector('.modal.tikz-modal .etz-help');
            while (el && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
            if (!el) return null;
            el.dataset.filmScroll = '1';
            const tile = Array.from(document.querySelectorAll('.modal.tikz-modal button.etz-help-tile')).find((b) => (b.textContent || '').includes('Shade under a tangent'));
            const top = tile ? el.scrollTop + tile.getBoundingClientRect().top - el.getBoundingClientRect().top - 140 : el.scrollTop + 600;
            return { top };
        });
        await film.move(modal2.x + modal2.width * 0.6, modal2.y + modal2.height * 0.55, 0.6);
        await film.scroll('[data-film-scroll="1"]', scroller.top, 1.8);
        await film.hold(0.4, { still: false });
        const tile = await rectOfText(`${MODAL} button.etz-help-tile`, 'Shade under a tangent');
        await film.click(tile.x + tile.width * 0.5, tile.y + tile.height * 0.4, 0.8);
        await film.tick(30);
        for (let i = 0; i < 3; i++) {
            await film.hold(1.0, { still: false });
            const next = await rectOfText(`${MODAL} button`, 'Next');
            await film.click(center(next).x, center(next).y, i === 0 ? 0.8 : 0.4);
            await film.tick(30);
        }
        await film.hold(1.4, { still: false });
    }

    const r = await film.finish();
    say(`film: ${r.frames} frames, ${r.seconds.toFixed(2)} s, capture ${(r.captureMs / r.frames).toFixed(0)} ms per picture`);
} finally {
    await obs.quit();
}
const report = await checkFilm(OUT, { sheet: `${BASE}-sheet.png` });
say(`${OUT}\n${report.text}`);
// The sound, from the events the film wrote beside itself (sound.mjs): effects, and with --music the bed too.
if (values.sound || values.music) say(`with sound: ${await addSound(OUT, { music: false })}`);
if (values.music) say(`with music: ${await addSound(OUT, { music: true })}`);
