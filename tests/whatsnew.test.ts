/*
 * The "What's new" popup (src/whatsnew.ts): who sees it, what it says and
 * the live chart inside it. The popup itself needs Obsidian; the smoke test
 * (scripts/media/smoke.mjs) opens it in a real app.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { canonical } from '../src/chartdata';
import { GUIDES, guideById } from '../src/guides';
import { issueText } from '../src/issues';
import { LABEL_LOCALS } from '../src/mathcontext';
import { computeScene2D, labelMetricsFor, SceneIssue } from '../src/scene';
import { SettingsManager } from '../src/settings';
import { DEFAULT_PLUGIN_DATA } from '../src/templates';
import { Parameter } from '../src/types';
import { marchingGrid } from '../src/util';
import { askContext, askQuestions, applyAnswer, answerPresent } from '../src/notes6/ask';
import '../src/linear/ask';
import '../src/iterate/ask';
import {
    WHATS_NEW_ALSO,
    WHATS_NEW_ASK_CHART,
    WHATS_NEW_CHART_TEXT,
    WHATS_NEW_FORMULA,
    WHATS_NEW_SLIDES,
    WHATS_NEW_RECENT,
    WHATS_NEW_AI,
    WHATS_NEW_ICONS,
    WHATS_NEW_LIVE,
    WHATS_NEW_MORE,
    WHATS_NEW_SLIDER,
    WHATS_NEW_SUBTITLE,
    WHATS_NEW_TITLE,
    WHATS_NEW_V5,
    WHATS_NEW_VERSION,
    chartScanRank,
    compareVersions,
    hasEasyTikzBlock,
    isFreshInstall,
    needsVaultCheck,
    shouldShowWhatsNew,
    whatsNewCard,
    whatsNewChart,
    whatsNewSeen,
    whatsNewText,
} from '../src/whatsnew';

const EM_DASH = String.fromCharCode(0x2014);
const V = WHATS_NEW_VERSION;

// ---------------------------------------------------------------- trigger

/** data.json as 3.19.x wrote it after a settings change: no record of the popup. */
const DATA_3X = { userTemplates: [], invertDrag3D: false, maxSamples3D: 80, renderTikzBlocks: false, dragSensitivity2D: 1 };
/** data.json of 4.0 / 4.1 after some editing: a draft, the drag tip, still no record. */
const DATA_41 = { ...DATA_3X, dragTipSeen: true, dragEdit: true, draft: { savedAt: 1, sourcePath: null, originalBlockText: null, data: { v: 4 } } };

test('whats new: a fresh install (no stored data, no charts in the vault) never sees it', () => {
    for (const stored of [null, undefined]) {
        assert.equal(isFreshInstall(stored), true);
        assert.equal(shouldShowWhatsNew(stored, V, true), false);
        assert.equal(shouldShowWhatsNew(stored, V, true, false), false);
        assert.equal(whatsNewSeen(stored, V), false, 'not seen yet, so main.ts records it after the vault check');
        assert.equal(needsVaultCheck(stored, V, true), true, 'no data: only the vault can tell');
    }
});

test('whats new: no stored data but charts in the vault (a 3.x user who never changed a setting) sees it', () => {
    for (const stored of [null, undefined]) {
        assert.equal(shouldShowWhatsNew(stored, V, true, true), true);
        assert.equal(shouldShowWhatsNew(stored, V, false, true), false, 'the setting still wins');
    }
    // Stored data decides on its own: the vault is not looked at.
    for (const stored of [DATA_3X, DATA_41, { ...DATA_3X, whatsNewSeen: V }]) {
        assert.equal(needsVaultCheck(stored, V, true), false, JSON.stringify(stored));
    }
    assert.equal(shouldShowWhatsNew({ ...DATA_3X, whatsNewSeen: V }, V, true, true), false, 'seen is seen, charts or not');
    assert.equal(needsVaultCheck(null, V, false), false, 'switched off: no need to look');
});

test('whats new: an easy-tikz block in a note is found, other code is not', () => {
    const json = '{"v": 4, "functions": []}';
    const yes = [
        '```easy-tikz\n' + json + '\n```',
        'Text before.\n\n```easy-tikz\n' + json + '\n```\nText after.',
        '~~~easy-tikz\n' + json + '\n~~~',
        '````easy-tikz\n' + json + '\n````',
        '``` easy-tikz\n' + json + '\n```',
        '```easy-tikz \n' + json + '\n```',
        '> [!note] A chart\n> ```easy-tikz\n> ' + json + '\n> ```',
        '- an item\n\n    ```easy-tikz\n    ' + json + '\n    ```',
        '```easy-tikz\r\n' + json + '\r\n```',
    ];
    for (const text of yes) assert.equal(hasEasyTikzBlock(text), true, text);
    const no = [
        '',
        'No charts here.',
        '```tikz\n\\draw (0,0) -- (1,1);\n```',
        '```easy-tikzx\n```',
        '```easy-tikz-old\n```',
        'The plugin renders `easy-tikz` blocks.',
        'Write ```easy-tikz in a note to start.',
        '```python\nprint("```easy-tikz")\n```',
        '``easy-tikz\n``',
    ];
    for (const text of no) assert.equal(hasEasyTikzBlock(text), false, text);
});

test('whats new: the vault check reads notes with code blocks first, and skips notes without any', () => {
    assert.equal(chartScanRank(['paragraph', 'code', 'heading']), 2);
    assert.equal(chartScanRank(null), 1, 'not indexed yet: read it');
    for (const t of ['list', 'callout', 'blockquote']) assert.equal(chartScanRank(['paragraph', t]), 1, t);
    assert.equal(chartScanRank([]), 0);
    assert.equal(chartScanRank(['yaml', 'heading', 'paragraph', 'table', 'math']), 0);
});

test('whats new: users of 3.x and of 4.0 / 4.1 see it once', () => {
    for (const stored of [DATA_3X, DATA_41, {}]) {
        assert.equal(isFreshInstall(stored), false);
        assert.equal(shouldShowWhatsNew(stored, V, true), true, JSON.stringify(stored));
        // main.ts writes the record as soon as the popup opens: from then on it stays away.
        const after = { ...stored, whatsNewSeen: V };
        assert.equal(whatsNewSeen(after, V), true);
        assert.equal(shouldShowWhatsNew(after, V, true), false);
    }
});

test('whats new: the setting switches it off', () => {
    assert.equal(shouldShowWhatsNew(DATA_3X, V, false), false);
    assert.equal(shouldShowWhatsNew(DATA_41, V, false), false);
    assert.equal(DEFAULT_PLUGIN_DATA.showWhatsNew, true, 'on by default');
    assert.equal('whatsNewSeen' in DEFAULT_PLUGIN_DATA, false, 'the defaults must not claim it was seen');
});

test('whats new: the record is a version, compared by number', () => {
    assert.equal(shouldShowWhatsNew({ whatsNewSeen: V }, V, true), false);
    assert.equal(shouldShowWhatsNew({ whatsNewSeen: '4.10.0' }, '4.2.0', true), false, 'a later popup was seen (downgrade)');
    assert.equal(shouldShowWhatsNew({ whatsNewSeen: '4.1.9' }, '4.2.0', true), true, 'an older popup was seen');
    assert.equal(shouldShowWhatsNew({ whatsNewSeen: '4.2.0' }, '5.0.0', true), true, 'new content raises the version');
    assert.equal(shouldShowWhatsNew({ whatsNewSeen: '5.0.0' }, V, true), true, 'who saw the popup of 5.0 sees the one of 6.0');
    // Damaged records count as not seen.
    for (const bad of [42, '', '  ', null, true, ['4.2.0']]) {
        assert.equal(shouldShowWhatsNew({ whatsNewSeen: bad }, V, true), true, JSON.stringify(bad));
    }
    // Stored data that is not an object is no data (Obsidian would not return it, but nothing must throw).
    for (const odd of ['text', 3, [], true]) assert.equal(shouldShowWhatsNew(odd, V, true), false, JSON.stringify(odd));
});

test('whats new: compareVersions', () => {
    assert.equal(compareVersions('4.2.0', '4.2.0'), 0);
    assert.equal(compareVersions('4.2', '4.2.0'), 0);
    assert.equal(compareVersions('4.10.0', '4.9.9'), 1);
    assert.equal(compareVersions('3.19.6', '4.0.0'), -1);
    assert.equal(compareVersions('4.2.1', '4.2.0'), 1);
    assert.equal(compareVersions('x.y', '0.0'), 0);
});

// ---------------------------------------------------------------- content

// The slides of 6.0, the rest of 6.0, version 5, and version 4 (with the live and AI items): every item once.
const ITEMS = [...WHATS_NEW_RECENT, ...WHATS_NEW_ALSO, ...WHATS_NEW_V5, ...WHATS_NEW_MORE];

test('whats new: every line is short, plain and free of em dashes', () => {
    const texts = [WHATS_NEW_TITLE, WHATS_NEW_SUBTITLE, ...ITEMS.flatMap((i) => [i.title, i.text])];
    for (const text of texts) {
        assert.ok(!text.includes(EM_DASH), `em dash in "${text}"`);
        assert.ok(text.trim() === text && text.length > 0, `blank or padded text "${text}"`);
    }
    for (const item of ITEMS) {
        assert.ok(item.title.length <= 40, `title too long: ${item.title}`);
        assert.ok(item.text.length <= 150, `text too long (${item.text.length}): ${item.text}`);
        assert.ok(/[.]$/.test(item.text), `a sentence ends with a full stop: ${item.text}`);
        assert.equal((item.text.match(/`/g) || []).length % 2, 0, `unbalanced backticks: ${item.text}`);
    }
    assert.equal(WHATS_NEW_TITLE, 'Easy Graphs Charts and TikZ 6');
});

test('whats new: it covers the highlights of version 4, with sliders, calculations and AI among them', () => {
    const all = ITEMS.map((i) => `${i.title} ${i.text}`.toLowerCase()).join('\n');
    for (const topic of ['editor', 'slider', 'play', 'drag', 'shift', 'five general tools', 'inequalities', 'equations', 'intersections', 'optimum', 'segments', '3d planes', 'p1_x', 'labels', 'notes', 'latex', 'guides', '3.x']) {
        assert.ok(all.includes(topic), `nothing says "${topic}"`);
    }
    assert.deepEqual(WHATS_NEW_LIVE.map((i) => i.title), ['Live sliders', 'Live calculations', 'Sliders in your notes']);
    for (const item of [...WHATS_NEW_LIVE, WHATS_NEW_AI]) assert.ok(WHATS_NEW_MORE.includes(item), `${item.title} is not in the popup`);
});

test('whats new: icons are lucide ids, guides exist', () => {
    for (const icon of WHATS_NEW_ICONS) assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(icon), `not an icon id: ${icon}`);
    assert.equal(new Set(ITEMS.map((i) => i.icon)).size, ITEMS.length, 'two items share an icon');
    for (const item of ITEMS) if (item.guide) assert.ok(guideById(item.guide), `${item.title}: no guide ${item.guide}`);
    for (const item of WHATS_NEW_LIVE) assert.ok(item.guide, `${item.title} links no guide`);
});

test('whats new: the number of guides it names is the number in the Help tab, on GitHub and in the README', () => {
    const said = ITEMS.map((i) => /(\d+) step-by-step guides/.exec(i.text)).find((m) => m);
    assert.ok(said, 'no item counts the guides');
    const count = Number(said[1]);
    assert.equal(count, GUIDES.length, 'the number of guides in the text');
    // The text takes its number from the guide list. The pages on GitHub are files made by
    // `npm run media:guides`, so they tell independently whether a guide was added or removed
    // without running the script: one page per guide, none left over.
    const root = process.cwd();
    const pages = fs
        .readdirSync(path.join(root, 'docs', 'guides'))
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .map((f) => f.slice(0, -'.md'.length))
        .sort();
    assert.deepEqual(pages, GUIDES.map((g) => g.id).sort(), 'docs/guides holds one page per guide');
    // The index of the pages and the README say the same number.
    for (const file of [path.join('docs', 'guides', 'README.md'), 'README.md']) {
        const m = /(\d+) step-by-step guides/i.exec(fs.readFileSync(path.join(root, file), 'utf8'));
        assert.ok(m, `${file} does not say how many guides there are`);
        assert.equal(Number(m[1]), count, `${file} counts the guides differently`);
    }
});

test('whats new: the text beside the chart is the whole chart, in a few lines', () => {
    const text = whatsNewText();
    const back = parseChartText(text);
    assert.deepEqual(back.problems, []);
    assert.equal(canonical(back.data), canonical(whatsNewChart()));
    const lines = text.split('\n');
    assert.ok(lines.length <= 10, `${lines.length} lines`);
    assert.ok(!lines.some((l) => l.startsWith('raw ') || l.startsWith('set ')), text);
});

test('whats new: a slideshow of 6.0, one feature per slide, then the rest of 6.0, then versions 5 and 4', () => {
    assert.deepEqual(WHATS_NEW_SLIDES.map((x) => x.id), ['picture', 'matrix', 'motion', 'ask', 'hover', 'values', 'also', 'earlier']);
    assert.deepEqual(WHATS_NEW_RECENT.map((i) => i.title), [
        'Every idea is a picture',
        'A matrix moves the plane',
        'Motion',
        'Ask the curve',
        'Hover reads sets and maps',
        'Values and sums',
    ]);
    assert.equal(WHATS_NEW_SLIDES[WHATS_NEW_SLIDES.length - 2].title, 'Also new in 6.0');
    assert.equal(WHATS_NEW_SLIDES[WHATS_NEW_SLIDES.length - 1].title, 'Earlier versions');
    assert.deepEqual(WHATS_NEW_V5.map((i) => i.title), [
        'Every formula is a chart',
        'LaTeX is the chart language',
        'Connected sliders',
        'Data and a regression line',
        'Probability',
        'Riemann sums',
        'Slope fields',
        'Charts as SVG files',
    ]);
    assert.deepEqual(WHATS_NEW_MORE.slice(0, 3).map((i) => i.title), ['Axis numbers your way', 'White background for images', 'Solid surfaces in 3D']);
    assert.equal(WHATS_NEW_VERSION, '6.0.0');
    // Each feature slide shows something live; the first is the Julia set with its two sliders.
    for (const x of WHATS_NEW_SLIDES) if (x.id !== 'also' && x.id !== 'earlier') assert.ok(x.charts.length > 0, `${x.id} has no chart`);
    assert.equal(WHATS_NEW_SLIDES[0].charts[0], WHATS_NEW_CHART_TEXT);
    assert.equal(WHATS_NEW_SLIDES[0].sliders, 2);
    // The examples in the texts are lines the plugin reads (with what they need around them).
    const needs: Record<string, string> = {
        'Every idea is a picture': '',
        'A matrix moves the plane': 'let A = [[1, 1], [0, 1]]',
        'LaTeX is the chart language': '',
        'Connected sliders': '',
        "Newton's method": 'plot f(x) = x^2 - 2',
        'Sets on an axis and chords': 'plot g(x) = x^2 - 4',
    };
    for (const [title, before] of Object.entries(needs)) {
        const it = ITEMS.find((i) => i.title === title);
        const example = it ? /`([^`]+)`/.exec(it.text) : null;
        assert.ok(it && example, `no example in ${title}`);
        const text = [before, example[1]].filter((l) => l).join('\n');
        assert.deepEqual(parseChartText(text).problems, [], text);
    }
    // The example of the mesh lines is a surface option the plugin reads.
    const mesh = WHATS_NEW_MORE.find((i) => i.title === 'Mesh lines');
    const option = mesh ? /`([^`]+)`/.exec(mesh.text) : null;
    assert.ok(mesh && option && parseChartText(`3d\nplot z = x^2 - y^2, ${option[1]}`).problems.length === 0, mesh ? mesh.text : 'no item Mesh lines');
    // The example of the lines in words is a line the plugin reads.
    const plain = ITEMS.find((i) => i.title === 'Charts in plain words');
    const example = plain ? /`([^`]+)`/.exec(plain.text) : null;
    assert.ok(plain && example && parseChartText(example[1]).problems.length === 0, plain ? plain.text : 'no item Charts in plain words');
});

test('whats new: the matrix slide plays in steps, the motion slide moves by itself', () => {
    const matrix = WHATS_NEW_SLIDES.find((x) => x.id === 'matrix');
    const motion = WHATS_NEW_SLIDES.find((x) => x.id === 'motion');
    const steps = (text: string) => ((parseChartText(text).data.tools as Array<{ step?: number }>) ?? []).map((x) => x.step ?? 0);
    assert.ok(matrix && Math.max(...steps(matrix.charts[0])) === 2, 'the matrix moves in step 2, its eigenvectors come in step 3');
    const field = motion ? (parseChartText(motion.charts[0]).data.tools as Array<{ type: string; particles?: boolean }>).find((x) => x.type === 'vectorField') : null;
    assert.ok(field && field.particles === true, 'the field has moving particles');
});

test('whats new: the hover slide is the card a note shows for the set, with g from the note', () => {
    const card = whatsNewCard();
    assert.ok(card, `no card for ${WHATS_NEW_FORMULA}`);
    assert.equal(card.kind, 'set');
    assert.deepEqual(card.fn, { name: 'g', body: 'x^2 - 4', from: 'note' });
    const hover = WHATS_NEW_SLIDES.find((x) => x.id === 'hover');
    assert.ok(hover && card.lines.every((line) => hover.charts[0].includes(line)), 'the slide draws the lines of the card');
});

test('whats new: the ask slide asks real questions, and every answer draws', () => {
    const data = new SettingsManager().serialize();
    Object.assign(data, parseChartText(WHATS_NEW_ASK_CHART).data);
    const chart = SettingsManager.fromJSON(data).serialize();
    const settings = SettingsManager.fromJSON(chart);
    const math = settings.createMathContext({ memo: false });
    math.setParams([]);
    const view = settings.resolveView(math).view;
    const questions = askQuestions(askContext({ kind: 'function', name: 'g', x: 1.5, y: -1.75 }, chart, { xmin: view.xmin, xmax: view.xmax, ymin: view.ymin, ymax: view.ymax }, math));
    const ids = questions.map((q) => q.id);
    for (const id of ['le', 'zeros', 'extrema', 'tangent', 'value']) assert.ok(ids.includes(id), `no question ${id} in ${ids.join(', ')}`);
    assert.ok(ids.some((id) => id.includes('h')), `no question about g and h in ${ids.join(', ')}`);
    for (const q of questions) {
        assert.equal(answerPresent(chart, q.answer), false, `${q.id} is answered before it is asked`);
        const next = applyAnswer(chart, q.answer);
        assert.ok(next, `${q.id}: the answer does not read`);
        assert.equal(answerPresent(next, q.answer), true, `${q.id}: the answer is not in the chart after it`);
    }
});

test('whats new: the popup loads nothing from the network', () => {
    const root = process.cwd();
    for (const file of ['src/whatsnew.ts', 'src/ui/whatsNewModal.ts', 'src/ui/whatsnew.css']) {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        assert.ok(!/https?:\/\//.test(text), `${file} names a URL`);
        assert.ok(!/\bfetch\(|requestUrl|XMLHttpRequest|<img|createEl\('img'|url\(/.test(text), `${file} loads something`);
    }
});

// ------------------------------------------------------------------ chart

function sceneAt(a: number) {
    const settings = SettingsManager.fromJSON(whatsNewChart());
    const math = settings.createMathContext({ memo: false });
    // The first slider (a) at the value asked for; the others where the chart starts them.
    const params = (settings.getValue('parameters') as Parameter[]).map((p, k) => (k === 0 ? { ...p, value: a } : p));
    math.setParams(params);
    const config = settings.toRendererConfig(math);
    const issues: SceneIssue[] = [];
    for (const text of settings.resolveView(math).errors) if (!/^z(min|max)/.test(text)) issues.push({ source: 'chart', message: text, severity: 'error' });
    issues.push(...math.parameterIssues());
    for (const info of math.functions()) {
        if (info.error) issues.push({ source: info.name, field: 'expression', message: info.error, severity: 'error' });
    }
    const scene = computeScene2D({
        functions: config.functions || [],
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: marchingGrid(config.width * 0.85, config.height * 0.8, 1, 'full'),
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(config.paperWidthCm ?? 10, config.paperHeightCm ?? 10),
    });
    issues.push(...scene.issues);
    const title = math.validate(String(config.title ?? ''), 'template', undefined, LABEL_LOCALS.plain);
    if (!title.ok) issues.push({ source: 'chart', field: 'title', message: title.message, severity: 'error' });
    const shown = issues.filter((i) => !i.hiddenSource);
    return {
        settings,
        math,
        config,
        scene,
        errors: shown.filter((i) => i.severity !== 'info').map((i) => issueText(i)),
        notes: shown.filter((i) => i.severity === 'info').map((i) => issueText(i)),
    };
}


test('whats new chart: a Julia set, c = a + bi on two sliders, coloured by the GPU', () => {
    const chart = whatsNewChart();
    const tools = chart.tools as Array<{ type: string; formula?: string; start?: string; given?: string }>;
    assert.equal(tools.length, 1);
    assert.equal(tools[0].type, 'colourPlane');
    assert.equal(tools[0].formula, 'z_{n+1} = z_n^2 + c');
    assert.deepEqual((chart.parameters as Parameter[]).map((p) => p.name), ['a', 'b']);
    assert.deepEqual((chart.parameters as Parameter[])[0], WHATS_NEW_SLIDER);
    // A copy every time: the popup changes the slider value of its own copy only.
    (whatsNewChart().parameters as Parameter[])[0].value = 99;
    assert.equal((whatsNewChart().parameters as Parameter[])[0].value, WHATS_NEW_SLIDER.value);
    // The GPU paints it (sliders as uniforms), so a slider moves it live.
    const { scene } = sceneAt(WHATS_NEW_SLIDER.value);
    const pixels = scene.items.flatMap((i) => i.pixels ?? []);
    assert.equal(pixels.length, 1);
    assert.ok(pixels[0].shader, 'no shader: the CPU would paint it');
    assert.ok(pixels[0].shader.uniforms.length >= 2, 'a and b are uniforms');
});

test('whats new chart: no problem anywhere on the slider', () => {
    const { min, max, step } = WHATS_NEW_SLIDER;
    for (let k = 0; min + k * step <= max + 1e-9; k += 5) {
        const a = Number((min + k * step).toFixed(6));
        const { errors } = sceneAt(a);
        assert.deepEqual(errors, [], `a = ${a}`);
    }
    assert.deepEqual(sceneAt(WHATS_NEW_SLIDER.value).notes, [], 'the start value draws without a note');
});

test('whats new chart: the set has an inside and an outside at the start and at both ends of a', () => {
    for (const a of [WHATS_NEW_SLIDER.min, WHATS_NEW_SLIDER.value, WHATS_NEW_SLIDER.max]) {
        const { scene, config } = sceneAt(a);
        const prim = scene.items.flatMap((i) => i.pixels ?? [])[0];
        const w = 36;
        const h = 24;
        const out = new Uint8ClampedArray(w * h * 4);
        prim.tile({ xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax }, w, h, 0, 0, w, h, out);
        const colours = new Set<string>();
        for (let k = 0; k < w * h; k++) colours.add(`${out[4 * k]},${out[4 * k + 1]},${out[4 * k + 2]}`);
        assert.ok(colours.size > 20, `a = ${a}: only ${colours.size} colours`);
    }
});

test('whats new slides: every chart reads without a problem and draws without an error at both ends of its slider', () => {
    for (const x of WHATS_NEW_SLIDES) {
        for (const text of x.charts) {
            const parsed = parseChartText(text);
            assert.deepEqual(parsed.problems, [], `${x.id}: ${text}`);
            const settings = SettingsManager.fromJSON(parsed.data);
            const params = (settings.getValue('parameters') as Parameter[]) ?? [];
            const ends = params.length ? [params[0].min, params[0].value, params[0].max] : [NaN];
            for (const v of ends) {
                const math = settings.createMathContext({ memo: false });
                math.setParams(params.map((p, k) => (k === 0 && Number.isFinite(v) ? { ...p, value: v } : p)));
                const config = settings.toRendererConfig(math);
                const scene = computeScene2D({
                    functions: config.functions || [],
                    tools: config.tools,
                    math,
                    view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
                    grid: marchingGrid(config.width * 0.85, config.height * 0.8, 1, 'full'),
                    axisStyle: config.axisStyle,
                    polar: false,
                    labelMetrics: labelMetricsFor(config.paperWidthCm ?? 10, config.paperHeightCm ?? 10),
                });
                const errors = [...math.parameterIssues(), ...scene.issues].filter((i) => i.severity === 'error').map((i) => issueText(i));
                for (const info of math.functions()) if (info.error) errors.push(`${info.name}: ${info.error}`);
                assert.deepEqual(errors, [], `${x.id} at ${v}`);
            }
        }
    }
});
