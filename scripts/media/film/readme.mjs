/* eslint-env browser, node */
// The README film: one clean take with a pointer, 16:9, 1920 x 1080, 60 fps, about 50 s, filmed with kit.mjs in
// the isolated Obsidian of ../lib/obsidian.mjs (never the user's app). See README.md in this folder.
//
//   npm run media:readme                                # to <tmp>/easy-tikz-media/film/readme.mp4
//   npm run media:readme -- --root --sound --music      # the build in the repository root, with sound and a bed
//   node scripts/media/film/upload.mjs readme-music.mp4 --card thumbnail.png   # the copy to upload (under 10 MB)
//
// The parts, in order:
//   1  the editor, open on the chart of a note: + Add finds the Riemann sum, slider n from 6 to 24, the tangent
//      point along the curve, the label into the area; saved, the chart in the note follows
//   2  a plane typed under the chart, hovered: its card opens, the camera goes in, the plane turns
//   3  a new note: a 3D chart written by hand (solid, smooth, the most samples), its chart under it
//   4  a click on the chart: the editor, zoomed and turned
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PORTS, defaultWorkDir, launch } from '../lib/obsidian.mjs';
import { checkFilm } from './check.mjs';
import { createFilm, rectOf } from './kit.mjs';
import { addSound } from './sound.mjs';

const { values } = parseArgs({
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
    console.log('Usage: node scripts/media/film/readme.mjs [--out FILE.mp4] [--size 1920x1080] [--port 9345] [--work DIR] [--root] [--sound] [--music]');
    process.exit(0);
}
const port = Number(values.port || process.env.ETZ_MEDIA_PORT || PORTS.film);
const OUT = path.resolve(values.out || path.join(os.tmpdir(), 'easy-tikz-media', 'film', 'readme.mp4'));
const BASE = OUT.replace(/\.mp4$/i, '');
// The frame, and a window of the same aspect at the full-screen height of a 16 inch MacBook Pro (1117 CSS px).
const [FRAME_W, FRAME_H] = values.size.split('x').map(Number);
if (!(FRAME_W > 0 && FRAME_H > 0)) throw new Error(`--size ${values.size}: expected WIDTHxHEIGHT, such as 1920x1080`);
const WINDOW = { width: Math.round((1117 * FRAME_W) / FRAME_H), height: 1117 };
const say = (s) => process.stderr.write(`[readme] ${s}\n`);

// The chart of the note the film opens on (the tour's chart: its tangent slider has fine steps, so a drag is smooth).
const AREA = [
    'show x from 0 to 8 and y from 0 to 6',
    'slider a from 0 to 8, starting at 2.5, in steps of 0.01',
    'plot f(x) = x/2 + sin(x) + 1 with its tangent at a',
    'shade under f from x = 0 to 4',
    'write "area under f" at (6, 1)',
].join('\n');
const f = (x) => x / 2 + Math.sin(x) + 1;
// The 3D chart typed by hand: the Ripple, solid (opacity 1), smooth (mesh 0), at the most samples of the editor's
// slider (80, the plugin's default cap), in a cube whose z range is the surface's, so the waves stand tall.
const RIPPLE = [
    '3d',
    'cube',
    'show x from -5 to 5, y from -5 to 5 and z from -1 to 1',
    'plot f(x, y) = sin(sqrt(x^2 + y^2)) in viridis, opacity 1, mesh 0, 80 samples',
].join('\n');

const obs = await launch({
    port,
    workDir: values.work ? path.resolve(values.work) : defaultWorkDir(port),
    plugin: values.root ? 'root' : 'source',
    theme: 'light',
    width: WINDOW.width,
    height: WINDOW.height,
    notes: { 'Planes and areas.md': `\`\`\`easy-tikz\n${AREA}\n\`\`\`\n\n` },
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
/** The last line of the active note (an empty line under the chart). */
const lastLine = () =>
    obs.call((s) => {
        const lines = Array.from(document.querySelectorAll(`${s} .cm-content .cm-line`));
        const r = lines[lines.length - 1].getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
    }, NOTE);
/** The editor's preview with its Sliders dock: the camera's close shot of the editor. */
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
const waitFor = (fn, message, timeout = 8000) => obs.waitFor(() => obs.call(fn), { timeout, interval: 20, message });
const editorReady = () => !!window.__etzMedia.editor() && window.__etzMedia.editor().ready === true;

try {
    await obs.openNote('Planes and areas', { mode: 'live', cursor: 'end' });
    const title = await rectOf(obs, `${NOTE} .inline-title`);
    const left = title.x - 36;
    // The film opens in the editor: it is opened before the first picture.
    await obs.editChartInNote(0);
    await waitFor(editorReady, 'the editor');
    const modal = await rectOf(obs, MODAL);
    await obs.sleep(600);
    const film = await createFilm(obs, { out: OUT, fps: 60, width: FRAME_W, height: FRAME_H, stills: `${BASE}-stills`, say });

    // ---------------------------------------------------------------- 1. integral steps, slopes, labels
    film.camera(modal, 0, { pad: 12 });
    await obs.mouse.move({ x: modal.x + modal.width * 0.3, y: modal.y + modal.height * 0.55 });
    await film.hold(0.8, { still: false });
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
    say(`saved ${JSON.stringify(saved)}`);
    film.camera(saved, 0.9, { pad: 40 });
    await film.cameraWait();
    await film.hold(0.8, { still: false });

    // ---------------------------------------------------------------- 2. a plane under the chart, hovered
    const line = await lastLine();
    say(`last line ${JSON.stringify(line)}`);
    film.camera({ cx: left + 360, cy: line.y + line.height / 2 - 40, w: 720 }, 0.9);
    await film.click(line.x + 24, line.y + line.height / 2, 0.8);
    await film.tick(8);
    await film.type('The plane $z = 4 - x - 2y$ cuts all three axes.', 15);
    await film.hold(0.5, { still: false });
    // The formula in the typed line, not a formula drawn in the chart above it.
    const math = await rectOf(obs, `${NOTE} .cm-content .cm-line .math`);
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
    const cc = center(await rectOf(obs, '.etz-formula-pop .etz-formula-chart'));
    await film.move(cc.x, cc.y, 0.5);
    await film.drag([[cc.x + 120, cc.y + 10], [cc.x - 60, cc.y - 25]], 2.0);
    await film.hold(0.5, { still: false });

    // ---------------------------------------------------------------- 3. a new note: 3D written by hand
    await obs.key('Escape');
    // The top of the note column: its title changes in place when the new note opens (no empty page passes by),
    // and the code typed there stays readable with the top of the chart that grows under it.
    const column = { cx: left + 36 + 350, cy: title.y + 315, w: 1300 };
    film.camera(column, 1.0);
    await film.cameraWait();
    await film.tick(12);
    await obs.key('n', { mod: true });
    await waitFor(() => {
        const t = document.querySelector('.workspace-leaf.mod-active .inline-title');
        return !!t && document.activeElement === t;
    }, 'the new note');
    film.mark('pop');
    await film.tick(10);
    // Closer while the note is still empty: its title and the first lines of the block fill the frame.
    const title2 = await rectOf(obs, `${NOTE} .inline-title`);
    film.camera({ cx: column.cx, cy: title2.y + 230, w: 1000 }, 0.8);
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
    film.camera({ cx: column.cx, cy: title2.y + 470, w: 1800 }, 1.0);
    await film.cameraWait();
    await film.hold(1.2, { still: false });
    // Out of the block: it becomes its chart.
    await obs.key('ArrowDown');
    await obs.key('ArrowDown');
    await film.tick(10);
    await waitFor(() => !!document.querySelector('.workspace-leaf.mod-active .block-language-easy-tikz .etz-inline-box svg, .workspace-leaf.mod-active .block-language-easy-tikz .etz-inline-box canvas'), 'the 3D chart in the note', 15000);
    await film.tick(6);
    const block = await rectOf(obs, `${NOTE} .block-language-easy-tikz`);
    say(`3D block ${JSON.stringify(block)}`);
    // The chart with the note's title over it (the block alone cuts the title in half at the top edge).
    const head = await rectOf(obs, `${NOTE} .inline-title`);
    film.camera({ x: block.x, y: head.y - 12, width: block.width, height: block.y + block.height - head.y + 12 }, 0.9, { pad: 30 });
    await film.cameraWait();
    await film.hold(1.0, { still: false });

    // ---------------------------------------------------------------- 4. into the editor: zoom, turn
    const box = await rectOf(obs, `${NOTE} .block-language-easy-tikz .etz-inline-box`);
    await film.click(box.x + box.width * 0.5, box.y + box.height * 0.45, 0.7);
    await waitFor(editorReady, 'the 3D editor');
    film.mark('pop');
    await film.tick(6);
    const modal2 = await rectOf(obs, MODAL);
    film.camera(modal2, 0.9, { pad: 12 });
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
    film.camera(modal2, 0.9, { pad: 12 });
    await film.cameraWait();
    await film.hold(1.4, { still: false });

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
