/* eslint-env browser, node */
// Real-Obsidian smoke test: run it before a release.
//
// Starts an isolated Obsidian (own profile, throwaway vault, never the
// user's), installs the plugin and checks what no node test can: the
// plugin loads, the editor opens, every example and every guide chart
// loads without an issue, the tabs work, drag to edit works with real
// mouse events, a chart can be inserted into a note, edited from the note
// and saved back, and nothing is logged to the console as an error.
//
//   npm run media:smoke                 # plugin bundled from the current sources
//   npm run media:smoke -- --root       # the main.js / styles.css in the repository root (after npm run build)
//   npm run media:smoke -- --port 9350 --work /tmp/etz-smoke
//
// Prints one PASS / FAIL line per check and exits non-zero when a check failed.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PORTS, defaultWorkDir, importTs, launch } from './lib/obsidian.mjs';

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

// ------------------------------------------------------------------ app

const started = await check('Obsidian starts and the plugin loads', async () => {
    obs = await launch({ port, workDir, plugin: args.root ? 'root' : 'source', width: 1440, height: 900, theme: 'light' });
    const v = await obs.versions();
    return `Obsidian ${v.obsidian}, Easy TikZ ${v.plugin}, ${args.root ? 'repository root build' : 'built from source'}`;
});

if (started) {
    try {
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
            assert(sameJson(JSON.parse(m[1]), inserted), 'the block differs from the chart in the editor');
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
            assert(sameJson(await obs.chart(), inserted), 'the reopened chart differs from the inserted one');
            assert((await obs.issues()).length === 0 && (await obs.statusChip()) === null, 'the reopened chart has issues');
            await obs.setSlider('c', 7.5);
            await obs.insertIntoNote();
            const text = await obs.readNote(note);
            const m = /```easy-tikz\n([\s\S]*?)\n```/.exec(text);
            assert(m && JSON.parse(m[1]).parameters[0].value === 7.5, 'the saved block does not hold c = 7.5');
            assert((text.match(/```easy-tikz/g) || []).length === 1, 'the note now has more than one block');
            const charts = await obs.noteCharts();
            assert(charts.length === 1 && charts[0].drawn && charts[0].issues === null, `after saving: ${JSON.stringify(charts)}`);
        });

        await check('dark theme: the editor opens and draws', async () => {
            await obs.setTheme('dark');
            await obs.openEditor({ chart: lp.data });
            assert((await obs.issues()).length === 0, 'issues in the dark theme');
            assert((await obs.previewInfo()).shapes > 8, 'the preview looks empty');
            await obs.closeEditor();
            await obs.setTheme('light');
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
