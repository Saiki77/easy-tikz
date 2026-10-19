/* eslint-env browser, node */
// Real-Obsidian smoke test: run it before a release.
//
// Starts an isolated Obsidian (own profile, throwaway vault, never the
// user's), installs the plugin and checks what no node test can: the
// plugin loads, the editor opens, every example and every guide chart
// loads without an issue, the tabs work, drag to edit works with real
// mouse events, a chart can be inserted into a note, edited from the note
// and saved back, the "What's new" popup opens once for a user who updated
// (and never for a fresh install), and nothing is logged to the console as
// an error.
//
//   npm run media:smoke                 # plugin bundled from the current sources
//   npm run media:smoke -- --root       # the main.js / styles.css in the repository root (after npm run build)
//   npm run media:smoke -- --port 9350 --work /tmp/etz-smoke
//
// Prints one PASS / FAIL line per check and exits non-zero when a check failed.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PLUGIN_ID, PORTS, defaultWorkDir, importTs, launch } from './lib/obsidian.mjs';

const { values: args } = parseArgs({
    options: {
        port: { type: 'string' },
        work: { type: 'string' },
        root: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
    },
});
if (args.help) {
    console.log('Usage: node scripts/media/smoke.mjs [--port 9341] [--work <dir>] [--root]');
    process.exit(0);
}
const port = Number(args.port || process.env.ETZ_MEDIA_PORT || PORTS.smoke);
const workDir = path.resolve(args.work || defaultWorkDir(port));

let passed = 0;
let failed = 0;
let skipped = 0;
let obs = null;
let seenErrors = 0;

const pass = (name, detail = '') => {
    passed++;
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
};
const fail = (name, reason) => {
    failed++;
    console.log(`FAIL  ${name}\n      ${String(reason).split('\n').join('\n      ')}`);
};
const skip = (name, reason) => {
    skipped++;
    console.log(`SKIP  ${name}  (${reason})`);
};
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

/** Console errors logged since the last call. */
function newErrors() {
    if (!obs) return [];
    const fresh = obs.errors.slice(seenErrors);
    seenErrors = obs.errors.length;
    return fresh;
}

/**
 * Run one check. It fails when `fn` throws or when the app logged a
 * console error meanwhile. `fn` may return a short detail for the PASS line.
 */
async function check(name, fn) {
    let detail = '';
    try {
        detail = (await fn()) || '';
        if (obs) await obs.sleep(30);
        const errors = newErrors();
        assert(!errors.length, `console errors:\n${errors.map((e) => `${e.type}: ${e.text}`).join('\n')}`);
        pass(name, detail);
        return true;
    } catch (e) {
        newErrors();
        let shot = '';
        if (obs) {
            const file = path.join(workDir, 'smoke', `fail-${failed + 1}.png`);
            shot = await obs.screenshot(file).then(
                () => `\nscreenshot: ${file}`,
                () => ''
            );
        }
        fail(name, (e && e.message ? e.message : String(e)) + shot);
        return false;
    }
}

/** Load a chart into the open editor and assert it drew without any issue. */
async function loadClean(chart, expect3D) {
    await obs.loadChart(chart);
    const [issues, chip, info, state] = [await obs.issues(), await obs.statusChip(), await obs.previewInfo(), await obs.editorState()];
    assert(!issues.length, `issues: ${issues.map((i) => `${i.source}${i.field ? ` ${i.field}` : ''}: ${i.message}`).join('; ')}`);
    assert(chip === null, `the status chip shows "${chip}"`);
    if (expect3D !== undefined) assert(state.is3D === expect3D, `expected a ${expect3D ? '3D' : '2D'} chart`);
    assert(info.shapes > (info.mode === '3d' ? 0 : 8), `the preview looks empty (${info.shapes} shapes)`);
    return info;
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------ data

let EXAMPLES = [];
let GUIDES = [];
await check('examples are defined in src/migrate.ts', async () => {
    ({ EXAMPLES } = await importTs('src/migrate.ts'));
    assert(Array.isArray(EXAMPLES) && EXAMPLES.length > 0, 'EXAMPLES is empty');
    return `${EXAMPLES.length} examples`;
});
let guidesLoaded = false;
await check('guides bundle from src/guides/index.ts', async () => {
    ({ GUIDES } = await importTs('src/guides/index.ts'));
    assert(Array.isArray(GUIDES), 'GUIDES is not an array');
    guidesLoaded = true;
    return `${GUIDES.length} guides`;
});
const lp = EXAMPLES.find((e) => e.id === 'lp');
let TEXT = null;
await check('the text syntax bundles from src/text/parse.ts and src/chartdata.ts', async () => {
    const { parseChartText } = await importTs('src/text/parse.ts');
    const { canonical } = await importTs('src/chartdata.ts');
    TEXT = { parseChartText, canonical };
});
/** The chart a block body holds, written as text or as JSON. */
const blockChart = (body) => (body.trim().startsWith('{') ? JSON.parse(body) : TEXT.parseChartText(body).data);
/** The same chart, whatever form either side is in. */
const sameChart = (a, b) => TEXT.canonical(a) === TEXT.canonical(b);
let WHATS_NEW = null;
await check('the "What\'s new" popup is defined in src/whatsnew.ts', async () => {
    WHATS_NEW = await importTs('src/whatsnew.ts');
    assert(typeof WHATS_NEW.WHATS_NEW_VERSION === 'string', 'WHATS_NEW_VERSION is missing');
    return `version ${WHATS_NEW.WHATS_NEW_VERSION}`;
});

// ---------------------------------------------------------- what's new

/** The plugin's data.json in the capture vault. */
const dataFile = () => path.join(obs.vault, '.obsidian', 'plugins', PLUGIN_ID, 'data.json');
const readData = () => (fs.existsSync(dataFile()) ? JSON.parse(fs.readFileSync(dataFile(), 'utf8')) : null);

/** What the open "What's new" popups show (normally one), with the state of the live example. */
const whatsNewState = () =>
    obs.call(() => {
        const modals = Array.from(document.querySelectorAll('.modal.etz-whatsnew'));
        const m = modals[0];
        if (!m) return { count: 0 };
        const svg = m.querySelector('.etz-whatsnew-chart svg');
        const texts = svg ? Array.from(svg.querySelectorAll('text, foreignObject')).map((t) => (t.textContent || '').trim()) : [];
        const input = m.querySelector('.etz-whatsnew-strip input[type=range]');
        const play = m.querySelector('.etz-whatsnew-play');
        return {
            count: modals.length,
            title: (m.querySelector('.etz-whatsnew-title') || { textContent: '' }).textContent.trim(),
            items: m.querySelectorAll('.etz-whatsnew-item').length,
            blankIcons: Array.from(m.querySelectorAll('.etz-whatsnew-icon, .etz-btn-icon, .etz-whatsnew-play')).filter((el) => !el.querySelector('svg')).length,
            slope: texts.find((t) => t.startsWith('slope')) || null,
            area: texts.find((t) => t.startsWith('A =')) || null,
            value: input ? Number(input.value) : null,
            playing: play ? play.getAttribute('aria-pressed') === 'true' : null,
        };
    });

/** Unload and load the plugin, as Obsidian does after an update, and give a popup time to open. */
async function reloadPlugin() {
    await obs.call(async (id) => {
        await app.plugins.disablePlugin(id);
        await app.plugins.enablePlugin(id);
    }, PLUGIN_ID);
    await obs.waitFor(() => obs.call((id) => !!app.plugins.plugins[id], PLUGIN_ID), { timeout: 10000, message: 'the plugin to load again' });
    await obs.sleep(700);
}

async function clickWhatsNewButton(text) {
    const ok = await obs.call((t) => {
        const button = Array.from(document.querySelectorAll('.modal.etz-whatsnew .etz-whatsnew-actions button')).find((b) => (b.textContent || '').trim() === t);
        if (button) button.click();
        return !!button;
    }, text);
    assert(ok, `the popup has no button "${text}"`);
    await obs.waitFor(() => obs.call(() => !document.querySelector('.modal.etz-whatsnew')), { timeout: 5000, message: 'the popup to close' });
}

/** Notes of the vault that hold an easy-tikz block (what the plugin looks for when it has no stored data). */
const notesWithCharts = () =>
    obs.call(async () => {
        const out = [];
        for (const file of app.vault.getMarkdownFiles()) {
            if (/^[ \t>]*(?:`{3,}|~{3,})[ \t]*easy-tikz/m.test(await app.vault.cachedRead(file))) out.push(file.path);
        }
        return out;
    });

/** Turn every easy-tikz block of the vault into a json block (a vault without charts); returns the old texts. */
const hideCharts = () =>
    obs.call(async () => {
        const held = {};
        for (const file of app.vault.getMarkdownFiles()) {
            const text = await app.vault.read(file);
            const next = text.replace(/^([ \t>]*(?:`{3,}|~{3,})[ \t]*)easy-tikz/gm, '$1json');
            if (next === text) continue;
            held[file.path] = text;
            await app.vault.modify(file, next);
        }
        return held;
    });

/** Put back what hideCharts changed. */
const restoreCharts = (held) =>
    obs.call(async (texts) => {
        for (const [file, text] of Object.entries(texts)) {
            const note = app.vault.getAbstractFileByPath(file);
            if (note) await app.vault.modify(note, text);
        }
    }, held);

/** Choose a button of the editor's "Replace the current chart?" dialog. */
async function answerReplace(text) {
    await obs.waitFor(() => obs.call(() => !!document.querySelector('.modal.etz-dialog')), { timeout: 5000, message: 'the Replace dialog' });
    const ok = await obs.call((t) => {
        const dialog = Array.from(document.querySelectorAll('.modal.etz-dialog')).pop();
        const button = Array.from(dialog.querySelectorAll('.etz-dialog-actions button')).find((b) => (b.textContent || '').trim() === t);
        if (button) button.click();
        return !!button;
    }, text);
    assert(ok, `the Replace dialog has no button "${text}"`);
    await obs.waitFor(() => obs.call(() => !document.querySelector('.modal.etz-dialog')), { timeout: 5000, message: 'the Replace dialog to close' });
    await obs.sleep(150);
}

// ------------------------------------------------------------------ app

const started = await check('Obsidian starts and the plugin loads', async () => {
    obs = await launch({ port, workDir, plugin: args.root ? 'root' : 'source', width: 1440, height: 900, theme: 'light' });
    const v = await obs.versions();
    return `Obsidian ${v.obsidian}, Easy TikZ ${v.plugin}, ${args.root ? 'repository root build' : 'built from source'}`;
});

if (started) {
    try {
        await check('no "What\'s new" popup at the start (the toolkit\'s data marks it seen)', async () => {
            await obs.sleep(300);
            const state = await whatsNewState();
            assert(state.count === 0, `the popup "${state.title}" is open`);
            const data = readData();
            assert(data && data.whatsNewSeen === WHATS_NEW.WHATS_NEW_VERSION, `data.json: whatsNewSeen is ${data && data.whatsNewSeen}`);
        });

        await check('the editor opens on an empty chart', async () => {
            await obs.openEditor();
            const state = await obs.editorState();
            assert(state.tab === 'build', `the editor opened on the ${state.tab} tab`);
            assert(state.cta === 'Insert into note', `the primary button says "${state.cta}"`);
            assert(!state.banner, `a banner shows: "${state.banner}"`);
            assert((await obs.statusChip()) === null, 'the status chip is visible on an empty chart');
            const tiles = await obs.call(() => document.querySelectorAll('.modal.tikz-modal .etz-build-example').length);
            assert(tiles === EXAMPLES.length, `${tiles} example tiles for ${EXAMPLES.length} examples`);
        });

        // Math labels, before any chart is drawn in this run: the figure of a guide step in Help is drawn once,
        // and a `$...$` label nobody drew before is measured before MathJax has styled it. The figure has to
        // draw itself again with the label's real box (it used to keep a 1 px box with the text hanging off it).
        const mathStep = (() => {
            for (const guide of GUIDES) {
                const at = (guide.steps || []).findIndex((s) => s.chart && /:"\$[^"$]+\$"/.test(JSON.stringify(s.chart)));
                if (at >= 0) return { guide, at };
            }
            return null;
        })();
        if (!mathStep) skip('Help: math labels in a guide figure', 'no guide step has a $...$ label');
        else {
            await check('Help: a guide figure draws new $...$ labels with their real box', async () => {
                await obs.showTab('help');
                const opened = await obs.call((title) => {
                    const cards = Array.from(document.querySelectorAll('.modal.tikz-modal .etz-help-home .etz-help-browse .etz-help-card'));
                    const card = cards.find((c) => {
                        const t = c.querySelector('.etz-help-card-title');
                        return t && t.firstChild && t.firstChild.textContent === title;
                    });
                    if (card) card.click();
                    return !!card;
                }, mathStep.guide.title);
                assert(opened, `the Help home has no card for the guide "${mathStep.guide.title}"`);
                // Scrolls the step's figure into view (it draws when it gets there) and measures its MathJax labels.
                const measure = () =>
                    obs.call((n) => {
                        const step = document.querySelectorAll('.modal.tikz-modal .etz-help-page.mod-guide .etz-help-step')[n];
                        const box = step ? step.querySelector('.etz-help-figure') : null;
                        if (!box) return null;
                        const scroller = document.querySelector('.modal.tikz-modal .etz-tabpanel.mod-help');
                        scroller.scrollTop += box.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 80;
                        const px = (el) => Math.round(el.getBoundingClientRect().width * 10) / 10;
                        return Array.from(box.querySelectorAll('svg foreignObject')).map((f) => ({ text: f.getAttribute('data-export-text'), box: px(f), content: px(f.firstElementChild) }));
                    }, mathStep.at);
                const fits = (l) => l.content > 4 && Math.abs(l.box - l.content) <= 1.5;
                await obs.waitFor(async () => {
                    const list = await measure();
                    return Array.isArray(list) && list.length > 0;
                }, { timeout: 4000, interval: 100, message: 'the figure to draw' }).catch(() => {});
                // Right after the first drawing box and label still agree (both unstyled). Judge the settled picture:
                // MathJax's rules and fonts arrive within a few frames, and the figure then draws again.
                await obs.sleep(1500);
                const labels = await measure();
                assert(Array.isArray(labels) && labels.length > 0, 'the figure shows no MathJax label (did it draw, is MathJax loaded?)');
                const bad = labels.filter((l) => !fits(l));
                assert(!bad.length, bad.map((l) => `${l.text} is ${l.content} px wide but its box is ${l.box} px`).join('; '));
                // Leave Help as it was found: the home view, and the Build tab in front.
                await obs.call(() => {
                    const back = document.querySelector('.modal.tikz-modal .etz-help-page.mod-guide .etz-help-back');
                    if (back) back.click();
                });
                await obs.showTab('build');
                return `${labels.length} labels in step ${mathStep.at + 1} of ${mathStep.guide.id}`;
            });
        }

        // Every example, through the modal's loadChart (the second load also answers the Replace dialog).
        for (const example of EXAMPLES) {
            await check(`example ${example.id}: ${example.title}`, async () => {
                const info = await loadClean(example.data, example.is3D);
                return `${info.mode}, ${info.shapes} shapes`;
            });
        }

        // Every chart of every guide: the finished chart and each step.
        if (!guidesLoaded) skip('guide charts', 'src/guides did not bundle');
        else if (!GUIDES.length) skip('guide charts', 'src/guides defines no guides yet');
        for (const guide of GUIDES) {
            await check(`guide ${guide.id}: ${guide.title}`, async () => {
                const charts = [['finished chart', guide.chart]];
                (guide.steps || []).forEach((step, i) => {
                    if (step.chart) charts.push([`step ${i + 1}`, step.chart]);
                });
                const done = new Set();
                for (const [label, chart] of charts) {
                    const key = JSON.stringify(chart);
                    if (done.has(key)) continue;
                    done.add(key);
                    await loadClean(chart).catch((e) => {
                        throw new Error(`${label}: ${e.message}`);
                    });
                }
                return `${done.size} chart${done.size === 1 ? '' : 's'}`;
            });
        }

        await check('tabs: Build, Chart, Code and Help show their panels', async () => {
            await loadClean(lp.data, false);
            const seen = [];
            for (const tab of ['chart', 'code', 'help', 'build']) {
                await obs.showTab(tab);
                const shown = await obs.call((id) => {
                    const m = window.__etzMedia.requireEditor();
                    const panels = Array.from(m.modalEl.querySelectorAll('.etz-tabpanel')).filter((p) => !p.classList.contains('tikz-hidden'));
                    const active = m.modalEl.querySelector('.etz-tab.is-active .etz-tab-text');
                    return {
                        count: panels.length,
                        mine: panels.length === 1 && panels[0].classList.contains(`mod-${id}`),
                        text: panels.length ? (panels[0].textContent || '').trim().length : 0,
                        label: active ? active.textContent : null,
                    };
                }, tab);
                assert(shown.count === 1 && shown.mine, `tab ${tab}: ${shown.count} panels visible`);
                assert(shown.text > 20, `tab ${tab}: the panel is empty`);
                seen.push(shown.label);
                if (tab === 'code') {
                    const code = (await obs.codeText()) || '';
                    assert(code.includes('\\begin{tikzpicture}') && code.includes('\\end{document}'), 'the Code tab does not show a standalone tikzpicture');
                }
            }
            assert(sameJson(seen, ['Chart', 'Code', 'Help', 'Build']), `tab labels: ${seen.join(', ')}`);
        });

        await check('sliders dock: setting c redraws and stores the value', async () => {
            await obs.setSlider('c', 6);
            const chart = await obs.chart();
            assert(chart.parameters[0].value === 6, `c is ${chart.parameters[0].value}, expected 6`);
            assert((await obs.issues()).length === 0, 'issues after moving the slider');
            await obs.setSlider('c', 9);
        });

        // Drag to edit with real mouse events (the golden rows of the changelog).
        const lpState = async () => {
            const chart = await obs.chart();
            const tool = (name) => chart.tools.find((t) => t.name === name);
            return { c: chart.parameters[0].value, equation: tool('C1').equation, objective: tool('P1').objective };
        };
        await check('drag to edit: dragging the objective line moves slider c', async () => {
            await loadClean(lp.data, false);
            await obs.mouse.drag([[1.5, 2], [1.8, 2.2]], { steps: 12 });
            await obs.waitForRender();
            const after = await lpState();
            assert(after.equation === '2x + 3y = c', `the equation text changed to "${after.equation}"`);
            assert(Math.abs(after.c - 10.2) < 0.11, `c is ${after.c}, expected about 10.2`);
            assert(Math.abs((await obs.sliderValue('c')) - after.c) < 1e-9, 'the dock slider does not show the new value');
            const undo = (await obs.editorState()).undo || '';
            assert(/Moved C1/.test(undo), `the undo bar says "${undo}"`);
            await obs.key('z', { mod: true });
            await obs.waitForRender();
            const undone = await lpState();
            assert(undone.c === 9, `after undo c is ${undone.c}, expected 9`);
            return `c 9 to ${after.c}, undo back to 9`;
        });
        await check('drag to edit: Shift-drag turns the line around the optimum', async () => {
            await loadClean(lp.data, false);
            await obs.mouse.move([1.5, 2], { steps: 3 });
            await obs.keyDown('Shift');
            await obs.sleep(600);
            const hint = (await obs.editorState()).hint || '';
            await obs.keyUp('Shift');
            assert(/turns around/.test(hint) && /\(3, 1\)/.test(hint), `the hover tip says "${hint}"`);
            await obs.mouse.drag([[1.5, 2], [1.5, 2.5]], { shift: true, steps: 12 });
            await obs.waitForRender();
            const after = await lpState();
            assert(after.equation !== '2x + 3y = c', 'the equation did not change');
            const m = /^(-?[\d.]*)x \+ (-?[\d.]*)y = c$/.exec(after.equation);
            assert(m, `unexpected equation "${after.equation}"`);
            const [a, b] = [m[1] === '' ? 1 : Number(m[1]), m[2] === '' ? 1 : Number(m[2])];
            assert(Math.abs(a * 3 + b * 1 - after.c) < 1e-6, `"${after.equation}" with c = ${after.c} no longer passes through (3, 1)`);
            assert(after.objective === after.equation.replace(/ = c$/, ''), `P1's objective "${after.objective}" did not follow the line`);
            return `2x + 3y = c became ${after.equation}, c = ${after.c}`;
        });
        await check('drag to edit: Escape cancels a drag, also with Shift held', async () => {
            const condition = async () => (await obs.chart()).tools.find((t) => t.name === 'R1').conditions[1];
            for (const shift of [false, true]) {
                await loadClean(lp.data, false);
                // Constraint (2), x + 3y = 6, passes through (0.6, 1.8).
                await obs.mouse.drag([[0.6, 1.8], [0.6, 2.4]], { shift, hold: true, steps: 8 });
                const during = await condition();
                await obs.key('Escape', shift ? { shift: true } : {});
                await obs.frames(2);
                await obs.mouse.up();
                if (shift) await obs.keyUp('Shift');
                assert(await obs.call(() => !!window.__etzMedia.editor()), 'Escape closed the editor instead of cancelling the drag');
                await obs.waitForRender();
                const after = await condition();
                const undo = (await obs.editorState()).undo;
                assert(during !== 'x + 3y <= 6', `the ${shift ? 'Shift-' : ''}drag did not change the condition`);
                assert(after === 'x + 3y <= 6', `after Escape${shift ? ' with Shift held' : ''} the condition is "${after}", expected "x + 3y <= 6"`);
                assert(!undo, `a cancelled drag left an undo bar: "${undo}"`);
            }
            return 'condition (2) back to x + 3y <= 6 both times';
        });

        await check('typing a formula adds a function', async () => {
            await obs.openEditor();
            await obs.mouse.click({ selector: '.modal.tikz-modal .etz-build-start input, .modal.tikz-modal .etz-build-start textarea' });
            await obs.type('x^2 - 2');
            await obs.key('Enter');
            await obs.waitForRender();
            const chart = await obs.chart();
            assert(chart.functions.length === 1 && chart.functions[0].expression === 'x^2 - 2', `functions: ${JSON.stringify(chart.functions.map((f) => f.expression))}`);
            assert((await obs.issues()).length === 0, 'issues after adding the function');
            await obs.closeEditor();
        });

        // Notes: insert, render, sliders, edit from the note, save back.
        const note = 'Smoke test';
        let inserted = null;
        await check('Insert into note writes an easy-tikz block', async () => {
            await obs.writeNote(note, 'A chart from the smoke test:\n\n');
            await obs.openNote(note, { mode: 'live' });
            await obs.openEditor({ chart: lp.data });
            inserted = await obs.chart();
            await obs.insertIntoNote();
            const text = await obs.readNote(note);
            const m = /```easy-tikz\n([\s\S]*?)\n```/.exec(text);
            assert(m, 'the note has no easy-tikz block');
            assert(!m[1].trim().startsWith('{'), 'a new chart is not written as text');
            assert(sameChart(blockChart(m[1]), inserted), `the block differs from the chart in the editor:\n${m[1]}`);
            return `${m[1].split('\n').length} lines of text`;
        });
        await check('the chart renders in the note with its slider strip', async () => {
            await obs.openNote(note, { mode: 'reading' });
            const charts = await obs.noteCharts();
            assert(charts.length === 1 && charts[0].drawn, `rendered charts: ${JSON.stringify(charts)}`);
            assert(sameJson(charts[0].sliders, ['c']), `slider strip: ${JSON.stringify(charts[0].sliders)}`);
            assert(charts[0].issues === null, `the chart shows a problem line: "${charts[0].issues}"`);
            const before = await obs.readNote(note);
            await obs.setSlider('c', 6, { scope: 'note' });
            assert((await obs.sliderValue('c', { scope: 'note' })) === 6, 'the strip slider did not move');
            assert((await obs.readNote(note)) === before, 'moving a slider in the note changed the file');
        });
        await check('clicking the chart reopens it in the editor, Save changes writes it back', async () => {
            await obs.editChartInNote(0);
            const state = await obs.editorState();
            assert(state.cta === 'Save changes', `the primary button says "${state.cta}"`);
            assert(sameChart(await obs.chart(), inserted), 'the reopened chart differs from the inserted one');
            assert((await obs.issues()).length === 0 && (await obs.statusChip()) === null, 'the reopened chart has issues');
            await obs.setSlider('c', 7.5);
            await obs.insertIntoNote();
            const text = await obs.readNote(note);
            const m = /```easy-tikz\n([\s\S]*?)\n```/.exec(text);
            assert(m && blockChart(m[1]).parameters[0].value === 7.5, 'the saved block does not hold c = 7.5');
            assert((text.match(/```easy-tikz/g) || []).length === 1, 'the note now has more than one block');
            const charts = await obs.noteCharts();
            assert(charts.length === 1 && charts[0].drawn && charts[0].issues === null, `after saving: ${JSON.stringify(charts)}`);
        });

        // Charts written as text: drawn, problems named by line, saved back line by line, and moving when they change.
        const textNote = 'Text chart';
        const textBlock = (lines) => 'Written by hand:\n\n```easy-tikz\n' + lines.join('\n') + '\n```\n';
        const handWritten = ['% a parabola', 'view x -3..3, y -4..4', 'slider a = 1 in 0..2', 'f(x) = a x^2 - 2 | blue, sparkly'];
        await check('text: a text block draws, and its problem names the line and column', async () => {
            await obs.writeNote(textNote, textBlock(handWritten));
            await obs.openNote(textNote, { mode: 'reading' });
            const charts = await obs.noteCharts();
            assert(charts.length === 1 && charts[0].drawn, `rendered charts: ${JSON.stringify(charts)}`);
            assert(sameJson(charts[0].sliders, ['a']), `slider strip: ${JSON.stringify(charts[0].sliders)}`);
            assert(/Line 4, column \d+: unknown option "sparkly"/.test(charts[0].issues || ''), `problem line: "${charts[0].issues}"`);
            return charts[0].issues;
        });
        await check('text: Save changes writes text back, keeping the comment and every unchanged line', async () => {
            await obs.editChartInNote(0);
            await obs.setSlider('a', 1.5);
            await obs.insertIntoNote();
            const m = /```easy-tikz\n([\s\S]*?)\n```/.exec(await obs.readNote(textNote));
            assert(m, 'the note lost its block');
            const lines = m[1].split('\n');
            assert(lines[0] === handWritten[0] && lines[1] === handWritten[1] && lines[3] === handWritten[3], `block:\n${m[1]}`);
            // The changed line is written in words.
            assert(/^slider a from 0 to 2, starting at 1\.5\b/.test(lines[2]), `slider line: ${lines[2]}`);
        });
        await check('motion: a block that changes glides, and its new object pops in', async () => {
            await obs.openNote(textNote, { mode: 'reading' });
            await obs.sleep(400);
            const changed = (await obs.readNote(textNote)).replace('view x -3..3,', 'view x -3..4,').replace('sparkly\n```', 'sparkly\ng(x) = x | red\n```');
            await obs.writeNote(textNote, changed);
            await obs.waitFor(() => obs.call(() => !!document.querySelector('.workspace-leaf.mod-active [data-etz-item="g"]')), {
                timeout: 8000,
                message: 'the new function to be drawn',
            });
            // The first drawing comes first; the next frame finds the old picture and starts the pop-in.
            const state = () =>
                obs.call(() => {
                    const leaf = document.querySelector('.workspace-leaf.mod-active');
                    const cls = (sel) => Array.from(leaf.querySelectorAll(sel)).map((e) => e.getAttribute('class') || '');
                    return { g: cls('[data-etz-item="g"]'), f: cls('.etz-curves [data-etz-item="f"]'), reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
                });
            const popped = await obs
                .waitFor(async () => (await state()).g.some((c) => /\betz-pop\b/.test(c)), { timeout: 3000, message: 'the pop-in' })
                .then(() => true, () => false);
            const now = await state();
            assert(popped, `the new function did not pop in: ${JSON.stringify(now.g)}${now.reduced ? ' (the system asks for reduced motion)' : ''}`);
            assert(!now.f.some((c) => /\betz-pop\b/.test(c)), 'the function that was there popped in again');
        });
        await check('live: an empty block shows nothing under it, and its first line makes the chart appear', async () => {
            const emptyNote = 'Empty block';
            // Lines 0-4; line 3 is the empty line in the block.
            await obs.writeNote(emptyNote, 'A chart to come:\n\n```easy-tikz\n\n```\n');
            await obs.openNote(emptyNote, { mode: 'live', cursor: 'end', charts: 0 });
            await obs.call(() => {
                const ed = app.workspace.activeEditor.editor;
                ed.setCursor({ line: 3, ch: 0 });
                ed.focus();
            });
            await obs.sleep(400);
            const under = () =>
                obs.call(() => {
                    const ed = document.querySelector('.workspace-leaf.mod-active .cm-editor');
                    return { chart: !!ed.querySelector('.etz-live .etz-inline svg'), error: !!ed.querySelector('.etz-live .tikz-block-error') };
                });
            const before = await under();
            assert(!before.chart && !before.error, `under the empty block: ${JSON.stringify(before)}`);
            await obs.type('size 12 x 6', { instant: true });
            await obs.waitFor(async () => (await under()).chart, { timeout: 4000, message: 'the chart under the block after its first line' });
        });
        await check('live: the chart sits under a block while you edit it, changes as you type, and hands over when you leave', async () => {
            const liveNote = 'Live chart';
            // Lines 0-8; line 5 is the empty line in the block.
            await obs.writeNote(liveNote, 'Typed in Live Preview:\n\n```easy-tikz\nshow x from 0 to 5 and y from 0 to 4.5\nshade where x + y <= 4 and x >= 0 and y >= 0\n\n```\n\nAfter.\n');
            await obs.openNote(liveNote, { mode: 'live', cursor: 'end' });
            const count = () =>
                obs.call(() => {
                    const ed = document.querySelector('.workspace-leaf.mod-active .cm-editor');
                    return { live: ed.querySelectorAll('.etz-live .etz-inline svg').length, all: ed.querySelectorAll('.etz-inline').length, optimum: !!ed.querySelector('.etz-live [data-etz-item="P1"]') };
                });
            let c = await count();
            assert(c.live === 0 && c.all === 1, `cursor outside the block: ${JSON.stringify(c)}`);
            await obs.call(() => {
                const ed = app.workspace.activeEditor.editor;
                ed.setCursor({ line: 5, ch: 0 });
                ed.focus();
            });
            await obs.waitFor(async () => (await count()).live === 1, { timeout: 4000, message: 'the chart under the block' });
            c = await count();
            assert(c.all === 1, `more than one chart while editing: ${JSON.stringify(c)}`);
            await obs.type('mark the maximum of 2x + 3y in the region', { instant: true });
            await obs.waitFor(async () => (await count()).optimum, { timeout: 4000, message: 'the typed optimum in the chart under the block' });
            await obs.call(() => {
                const ed = app.workspace.activeEditor.editor;
                ed.setCursor({ line: ed.lastLine(), ch: 0 });
            });
            await obs.waitFor(
                async () => {
                    const n = await count();
                    return n.live === 0 && n.all === 1;
                },
                { timeout: 4000, message: 'the chart Obsidian draws, alone again' }
            );
        });

        await check('dark theme: the editor opens and draws', async () => {
            await obs.setTheme('dark');
            await obs.openEditor({ chart: lp.data });
            assert((await obs.issues()).length === 0, 'issues in the dark theme');
            assert((await obs.previewInfo()).shapes > 8, 'the preview looks empty');
            await obs.closeEditor();
            await obs.setTheme('light');
        });

        // "What's new": who sees it, once, and what it does. Obsidian reloads a plugin after an update,
        // so each case writes data.json as that user would have it and reloads the plugin.
        const version = WHATS_NEW ? WHATS_NEW.WHATS_NEW_VERSION : null;
        const template = { name: 'Smoke parabola', is3D: false, expression: 'x^2', domain: '-2:2' };
        await check('what\'s new: data like a 3.x user\'s shows the popup once, with its title', async () => {
            await obs.openNote('Start');
            // data.json as 3.19.x wrote it after a settings change: no record of the popup.
            fs.writeFileSync(dataFile(), JSON.stringify({ userTemplates: [template], invertDrag3D: false, maxSamples3D: 100, renderTikzBlocks: false, dragSensitivity2D: 1 }, null, 2));
            await reloadPlugin();
            await obs.waitFor(async () => (await whatsNewState()).count > 0, { timeout: 5000, message: 'the popup to open after the plugin loaded' });
            const state = await whatsNewState();
            assert(state.count === 1, `${state.count} popups are open`);
            assert(state.title === 'Easy TikZ 4', `the title is "${state.title}"`);
            const expected = WHATS_NEW.WHATS_NEW_RECENT.length + WHATS_NEW.WHATS_NEW_LIVE.length + 1 + WHATS_NEW.WHATS_NEW_MORE.length;
            assert(state.items === expected, `${state.items} highlights, expected ${expected}`);
            assert(state.blankIcons === 0, `${state.blankIcons} icons are blank (an icon id Obsidian does not know)`);
            assert(state.slope === 'slope at x = 0.8: -1.08' && state.area === 'A = 2.76', `the live example shows "${state.slope}" and "${state.area}"`);
            // Seen as soon as it opened, and nothing else of the user's data changed.
            await obs.waitFor(() => (readData() || {}).whatsNewSeen === version, { timeout: 3000, message: 'data.json to record the popup' });
            const data = readData();
            assert(data.maxSamples3D === 100 && data.userTemplates.length === 1 && data.userTemplates[0].name === template.name, `the user's data changed: ${JSON.stringify(data)}`);
            return `whatsNewSeen ${data.whatsNewSeen}`;
        });
        await check('what\'s new: the live example responds to its slider and to play', async () => {
            await obs.call(() => {
                const input = document.querySelector('.modal.etz-whatsnew .etz-whatsnew-strip input[type=range]');
                input.value = '-0.9';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            });
            await obs.sleep(250);
            let state = await whatsNewState();
            // At a = -0.9 the slope is 3a^2 - 3 = -0.57 and the area 27a^4/4 = 4.43.
            assert(state.slope === 'slope at x = -0.9: -0.57' && state.area === 'A = 4.43', `after the slider: "${state.slope}", "${state.area}"`);
            await obs.mouse.click('.modal.etz-whatsnew .etz-whatsnew-play');
            await obs.sleep(600);
            state = await whatsNewState();
            assert(state.playing === true, 'play is not pressed');
            assert(state.slope !== 'slope at x = -0.9: -0.57', 'playing did not move the chart');
            await obs.mouse.click('.modal.etz-whatsnew .etz-whatsnew-play');
            await obs.sleep(250);
            state = await whatsNewState();
            const a = Number(/x = (-?[\d.]+)/.exec(state.slope || '')?.[1]);
            assert(state.playing === false, 'play is still pressed');
            assert(Number.isFinite(a) && Math.abs(a * 20 - Math.round(a * 20)) < 1e-9, `after play a = ${a} is not on the slider's step 0.05`);
            // A typed value outside -1.1..1.1 stops at the end (a wider slider would push the shading out of the view).
            const typed = await obs.call(() => {
                const box = document.querySelector('.modal.etz-whatsnew .etz-whatsnew-strip .etz-slider-number');
                const range = document.querySelector('.modal.etz-whatsnew .etz-whatsnew-strip input[type=range]');
                box.focus();
                box.value = '5';
                box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                box.blur();
                return { box: box.value, max: range.max, value: range.value };
            });
            await obs.sleep(250);
            state = await whatsNewState();
            assert(typed.max === '1.1' && typed.value === '1.1' && typed.box === '1.1', `typing 5: ${JSON.stringify(typed)}`);
            // At a = 1.1: slope 3(1.21) - 3 = 0.63, area 27(1.4641)/4 = 9.88.
            assert(state.slope === 'slope at x = 1.1: 0.63' && state.area === 'A = 9.88', `after typing 5: "${state.slope}", "${state.area}"`);
            return `slider to -0.9, play stopped at a = ${a}, typing 5 gives 1.1`;
        });
        await check('what\'s new: Close removes it, and reloading the plugin does not show it again', async () => {
            await clickWhatsNewButton('Close');
            await obs.sleep(300);
            await reloadPlugin();
            const state = await whatsNewState();
            assert(state.count === 0, 'the popup opened a second time');
        });
        // No data.json: 3.x saved one only after a settings change, so most 3.x users have none. Charts in the vault tell.
        await check('what\'s new: no data.json but a chart in a note (a 3.x user who never changed a setting) shows it once', async () => {
            await obs.writeNote('Made with 3.x', 'A chart from before version 4:\n\n```easy-tikz\n' + JSON.stringify(lp.data, null, 2) + '\n```\n');
            fs.rmSync(dataFile(), { force: true });
            await reloadPlugin();
            await obs.waitFor(async () => (await whatsNewState()).count > 0, { timeout: 8000, message: 'the popup to open after the vault check' });
            const state = await whatsNewState();
            assert(state.count === 1 && state.title === 'Easy TikZ 4', `${state.count} popups, title "${state.title}"`);
            await obs.waitFor(() => (readData() || {}).whatsNewSeen === version, { timeout: 3000, message: 'data.json to record the popup' });
            await clickWhatsNewButton('Close');
            await reloadPlugin();
            assert((await whatsNewState()).count === 0, 'the popup opened a second time');
            return `${(await notesWithCharts()).length} notes with charts`;
        });
        let held = null;
        await check('what\'s new: no data.json and no chart in the vault (a fresh install) shows none and records it as seen', async () => {
            held = await hideCharts();
            await obs.sleep(300);
            const left = await notesWithCharts();
            assert(!left.length, `notes still holding a chart: ${left.join(', ')}`);
            fs.rmSync(dataFile(), { force: true });
            await reloadPlugin();
            await obs.waitFor(() => (readData() || {}).whatsNewSeen === version, { timeout: 5000, message: 'data.json to record the popup as seen' });
            assert((await whatsNewState()).count === 0, 'a fresh install got the popup');
            await reloadPlugin();
            assert((await whatsNewState()).count === 0, 'the popup opened after the next start');
            return `${Object.keys(held).length} notes held back`;
        });
        await check('what\'s new: an unreadable data.json is left on disk as it is', async () => {
            const broken = '{ "userTemplates": [ broken';
            fs.writeFileSync(dataFile(), broken);
            await reloadPlugin();
            await obs.sleep(1200);
            assert((await whatsNewState()).count === 0, 'the popup opened');
            assert(fs.readFileSync(dataFile(), 'utf8') === broken, `data.json was rewritten: ${fs.readFileSync(dataFile(), 'utf8').slice(0, 80)}`);
            // Obsidian itself logs that it could not read the file: expected here, so it does not fail the run.
            for (let i = obs.errors.length - 1; i >= seenErrors; i--) if (/json/i.test(obs.errors[i].text)) obs.errors.splice(i, 1);
        });
        if (held) await restoreCharts(held);
        await check('what\'s new: the setting is on by default and switches it off, and loading writes nothing', async () => {
            const on = await obs.call((id) => app.plugins.plugins[id].data.showWhatsNew, PLUGIN_ID);
            assert(on === true, `showWhatsNew is ${on}`);
            const off = JSON.stringify({ userTemplates: [], showWhatsNew: false }, null, 2);
            fs.writeFileSync(dataFile(), off);
            await reloadPlugin();
            assert((await whatsNewState()).count === 0, 'the popup opened with the setting off');
            assert(fs.readFileSync(dataFile(), 'utf8') === off, 'data.json was written while the plugin loaded');
        });
        await check('what\'s new: the command opens it, and Try an example opens the editor on its chart', async () => {
            const ok = await obs.call((id) => app.commands.executeCommandById(`${id}:show-whats-new`), PLUGIN_ID);
            assert(ok !== false, 'the command easy-tikz:show-whats-new does not exist');
            await obs.waitFor(async () => (await whatsNewState()).count === 1, { timeout: 5000, message: 'the popup to open from the command' });
            await clickWhatsNewButton('Try an example');
            await obs.waitFor(() => obs.call(() => {
                const m = window.__etzMedia.editor();
                return !!m && m.ready === true;
            }), { timeout: 8000, message: 'the editor to open' });
            await obs.waitForRender();
            const chart = await obs.chart();
            assert(chart.parameters.length === 1 && chart.parameters[0].name === 'a' && chart.parameters[0].value === 0.8, `sliders: ${JSON.stringify(chart.parameters)}`);
            assert(chart.tools.length === 1 && chart.tools[0].name === 'R1', `tools: ${chart.tools.map((t) => t.name).join(', ')}`);
            assert((await obs.issues()).length === 0 && (await obs.statusChip()) === null, 'the example has issues in the editor');
            await obs.closeEditor();
        });
        // An icon id Obsidian does not know draws nothing: every id must show up as a drawn icon (svg.lucide-<id>).
        const drawnIcons = (root) =>
            obs.call((selector) => {
                const out = new Set();
                for (const svg of document.querySelectorAll(`${selector} svg`)) {
                    for (const c of svg.classList) if (c.startsWith('lucide-')) out.add(c.slice('lucide-'.length));
                }
                return Array.from(out);
            }, root);
        await check('what\'s new: every icon it uses is one Obsidian draws', async () => {
            const seen = new Set();
            await obs.call((id) => app.commands.executeCommandById(`${id}:show-whats-new`), PLUGIN_ID);
            await obs.waitFor(async () => (await whatsNewState()).count === 1, { timeout: 5000, message: 'the popup to open from the command' });
            for (const icon of await drawnIcons('.modal.etz-whatsnew')) seen.add(icon);
            await obs.mouse.click('.modal.etz-whatsnew .etz-whatsnew-play');
            await obs.sleep(150);
            for (const icon of await drawnIcons('.modal.etz-whatsnew')) seen.add(icon);
            await clickWhatsNewButton('Close');
            await obs.openEditor();
            await obs.showTab('help');
            for (const icon of await drawnIcons('.modal.tikz-modal .etz-help-news')) seen.add(icon);
            await obs.closeEditor();
            const missing = WHATS_NEW.WHATS_NEW_ICONS.filter((icon) => !seen.has(icon));
            assert(!missing.length, `icons that did not draw (unknown ids?): ${missing.join(', ')}`);
            return `${WHATS_NEW.WHATS_NEW_ICONS.length} icons`;
        });
        await check('what\'s new: the link in the Help tab opens it, and its buttons stay in that editor', async () => {
            // An editor with a chart in it: Try an example asks before replacing it.
            await obs.openEditor({ chart: lp.data });
            await obs.showTab('help');
            assert(await obs.call(() => !!document.querySelector('.modal.tikz-modal .etz-help-news-link .etz-btn-icon svg')), 'the link in the Help tab has no icon');
            const tryFromHelp = async (answer) => {
                await obs.mouse.click('.modal.tikz-modal .etz-help-news-link');
                await obs.waitFor(async () => (await whatsNewState()).count === 1, { timeout: 5000, message: 'the popup to open from the Help tab' });
                await clickWhatsNewButton('Try an example');
                await answerReplace(answer);
                await obs.waitForRender();
                return [await obs.editorState(), await obs.chart()];
            };
            // Cancel: the reader stays on the Help tab with the old chart.
            let [state, chart] = await tryFromHelp('Cancel');
            assert(state.tab === 'help', `after Cancel the editor shows the ${state.tab} tab`);
            assert(sameJson(chart.tools.map((t) => t.name), lp.data.tools.map((t) => t.name)), 'Cancel replaced the chart');
            // Replace: the example is in, on the Build tab.
            [state, chart] = await tryFromHelp('Replace');
            assert(state.tab === 'build', `after Replace the editor shows the ${state.tab} tab`);
            assert(chart.tools.length === 1 && chart.tools[0].name === 'R1', 'the example did not load into this editor');
            const editors = await obs.call(() => document.querySelectorAll('.modal.tikz-modal').length);
            assert(editors === 1, `${editors} editors are open`);
            await obs.closeEditor();
        });

        // ---------------------------------------------------- AI access (src/ai)
        // A port of its own, away from 27150 where the user's own Obsidian may answer.
        const aiPort = 27190 + (port % 10);
        const aiToken = '5a0e0123456789abcdef0123456789ab';
        const ai = (pathname, init = {}) => fetch(`http://127.0.0.1:${aiPort}${pathname}`, init);
        const aiTool = async (name, args) => {
            const r = await ai(`/tools/${name}?token=${aiToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
            assert(r.status === 200, `${name}: HTTP ${r.status}`);
            return r.json();
        };

        await check('AI access: off by default, nothing listens', async () => {
            const off = await obs.call((id) => ({ on: app.plugins.plugins[id].data.aiServer, running: !!app.plugins.plugins[id].aiServer }), PLUGIN_ID);
            assert(off.on === false && off.running === false, `AI access is ${JSON.stringify(off)} in a new vault`);
            const reached = await ai('/').then(() => true, () => false);
            assert(!reached, `something answers on ${aiPort} before AI access is on`);
        });

        await check('AI access: switching it on starts the server; every request needs the token and JSON, and may not come from a web page', async () => {
            await obs.call(async (id, p, t) => {
                const plugin = app.plugins.plugins[id];
                Object.assign(plugin.data, { aiServer: true, aiPort: p, aiToken: t });
                await plugin.startAi();
            }, PLUGIN_ID, aiPort, aiToken);
            assert((await ai('/')).status === 401, 'GET / answered without a token');
            const info = await ai(`/?token=${aiToken}`);
            assert(info.status === 200 && (await info.json()).name === 'easy-tikz', 'GET / does not name the server');
            assert((await ai('/guide')).status === 401, 'the guide answered without a token');
            const form = await ai(`/tools/list_examples?token=${aiToken}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
            assert(form.status === 415, `a POST that is not JSON got ${form.status}`);
            const page = await ai('/guide', { headers: { Authorization: `Bearer ${aiToken}`, Origin: 'https://example.com' } });
            assert(page.status === 403, `a request with an Origin header got ${page.status}`);
            const guide = await ai('/guide', { headers: { Authorization: `Bearer ${aiToken}` } });
            assert(guide.status === 200 && (await guide.text()).startsWith('# Easy TikZ: guide for AI assistants'), 'the guide did not come back');
        });

        await check('AI access: MCP initialize and tools/list', async () => {
            const rpc = async (body) => (await ai(`/mcp?token=${aiToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) })).json();
            const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } });
            assert(init.result && init.result.serverInfo.name === 'easy-tikz' && /get_guide/.test(init.result.instructions), 'initialize did not answer as the server');
            const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
            const names = list.result.tools.map((t) => t.name);
            for (const want of ['check_chart', 'render_chart', 'add_chart', 'update_chart']) assert(names.includes(want), `tools/list lacks ${want}`);
        });

        const aiChart = { v: 4, xmin: '0', xmax: '5', ymin: '0', ymax: '4.5', tools: [{ type: 'region', name: 'R1', conditions: ['x + y <= 4', 'x + 3y <= 6', 'x >= 0', 'y >= 0'] }, { type: 'points', name: 'P1', source: 'region', regionName: 'R1', objective: '2x + 3y', label: 'z* = {val}' }] };

        await check('AI access: check_chart reports what the chart computes, and refuses mistakes', async () => {
            const good = await aiTool('check_chart', { chart: aiChart });
            assert(good.ok && /^OK/.test(good.text) && /\(3, 1\)/.test(good.text), `check_chart: ${good.text.slice(0, 200)}`);
            const bad = await aiTool('add_chart', { chart: { v: 4, functions: [{ name: 'f1', expression: 'ax^2' }] }, note: 'AI smoke', create: true });
            assert(!bad.ok && /Unknown name 'ax'/.test(bad.text), 'a chart with a problem was not refused');
        });

        await check('AI access: render_chart returns a PNG of the chart', async () => {
            const r = await aiTool('render_chart', { chart: aiChart });
            assert(r.ok && r.image && r.image.mimeType === 'image/png', 'no image came back');
            const bytes = Buffer.from(r.image.base64, 'base64');
            assert(bytes.length > 5000 && bytes.slice(1, 4).toString() === 'PNG', `not a PNG (${bytes.length} bytes)`);
        });

        await check('AI access: add_chart writes the chart into a note, which renders it', async () => {
            const missing = await aiTool('add_chart', { chart: aiChart, note: 'AI smoke' });
            assert(!missing.ok && /create/.test(missing.text), 'a missing note was made without "create"');
            const added = await aiTool('add_chart', { chart: aiChart, note: 'AI smoke', create: true });
            assert(added.ok, `add_chart: ${added.text.slice(0, 200)}`);
            await obs.openNote('AI smoke');
            const charts = await obs.noteCharts();
            assert(charts.length === 1 && charts[0].drawn && !charts[0].issues, `the note shows ${JSON.stringify(charts)}`);
            const listed = await aiTool('list_charts', { note: 'AI smoke' });
            assert(listed.ok && /1 chart/.test(listed.text), 'list_charts does not see the chart');
        });

        await check('AI access: switching it off stops the server', async () => {
            await obs.call(async (id) => {
                const plugin = app.plugins.plugins[id];
                plugin.data.aiServer = false;
                await plugin.stopAi();
            }, PLUGIN_ID);
            const reached = await ai('/').then(() => true, () => false);
            assert(!reached, 'the server still answers after it was switched off');
        });

        // Last: Obsidian's mobile mode reloads the app, which the helpers above do not survive.
        await check('phone: in mobile mode a text chart draws, the editor fills the screen, and the AI tab says AI apps need a computer', async () => {
            await obs.writeNote('Phone', 'On the phone:\n\n```easy-tikz\nview x -3..3, y -4..4\nslider a = 0.8 in -1.1..1.1 step 0.05\nf(x) = x^3 - 3x | blue, tangent at a\n```\n');
            await obs.setWindowSize(390, 844);
            await obs.call(() => app.emulateMobile(true));
            await obs.sleep(3000);
            const until = async (fn, what) => {
                const t = Date.now();
                while (Date.now() - t < 20000) {
                    if (await obs.call(fn).catch(() => false)) return;
                    await obs.sleep(150);
                }
                throw new Error(`timed out waiting for ${what}`);
            };
            await until(() => !!(window.app && app.workspace && app.workspace.layoutReady && app.plugins.plugins['easy-tikz']), 'the plugin in mobile mode');
            assert(await obs.call(() => app.isMobile && document.body.classList.contains('is-phone')), 'Obsidian is not in phone mode');
            await obs.call(async () => app.workspace.openLinkText('Phone', '', false));
            await until(() => !!document.querySelector('.workspace-leaf.mod-active .etz-inline svg'), 'the chart in the note');
            await obs.call(() => document.querySelector('.workspace-leaf.mod-active .etz-inline-box').click());
            await until(() => !!document.querySelector('.modal.tikz-modal .etz-chart svg'), 'the editor');
            const editor = await obs.call(() => {
                const r = document.querySelector('.modal.tikz-modal').getBoundingClientRect();
                return { w: Math.round(r.width), h: Math.round(r.height), narrow: !!document.querySelector('.etz-shell.is-narrow'), wide: document.documentElement.scrollWidth > innerWidth };
            });
            assert(editor.w === 390 && editor.h === 844 && editor.narrow && !editor.wide, `editor: ${JSON.stringify(editor)}`);
            const ai = await obs.call(() => {
                Array.from(document.querySelectorAll('.modal.tikz-modal [role="tab"]')).find((t) => /AI/.test(t.textContent || ''))?.click();
                return { titles: Array.from(document.querySelectorAll('.etz-ai-card-title')).map((e) => e.textContent), toggle: !!document.querySelector('.etz-ai-card .etz-chip') };
            });
            assert(ai.titles[0] === 'AI apps on a computer' && !ai.toggle, `AI tab: ${JSON.stringify(ai)}`);
            return `${editor.w} x ${editor.h}, stacked`;
        });

        await check('no console errors in the whole run', async () => {
            assert(!obs.errors.length, obs.errors.map((e) => `${e.type}: ${e.text}`).join('\n'));
        });
    } finally {
        await obs.quit();
    }
}

console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
