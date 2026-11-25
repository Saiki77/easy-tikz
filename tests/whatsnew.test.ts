/*
 * The "What's new" popup (src/whatsnew.ts): who sees it, what it says and
 * the live chart inside it. The popup itself needs Obsidian; the smoke test
 * (scripts/media/smoke.mjs) opens it in a real app.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { NO_WORDS } from '../src/text/words';
import { canonical } from '../src/chartdata';
import { GUIDES, guideById } from '../src/guides';
import { tIn } from '../src/i18n';
import { issueText } from '../src/issues';
import { LABEL_LOCALS } from '../src/mathcontext';
import { computeScene2D, computeScene3D, labelMetricsFor, SceneIssue } from '../src/scene';
import { SettingsManager } from '../src/settings';
import { DEFAULT_PLUGIN_DATA } from '../src/templates';
import { Parameter } from '../src/types';
import { marchingGrid } from '../src/util';
import { askContext, askQuestions, applyAnswer, answerPresent } from '../src/notes6/ask';
import '../src/linear/ask';
import '../src/iterate/ask';
import {
    WHATS_NEW_ASK_CHART,
    WHATS_NEW_CHANGELOG,
    WHATS_NEW_CHAOS_CHART,
    WHATS_NEW_CHART_TEXT,
    WHATS_NEW_FILM,
    WHATS_NEW_FILM_SLIDE,
    WHATS_NEW_FLOW_CHART,
    WHATS_NEW_ICONS,
    WHATS_NEW_ML_GUIDE,
    WHATS_NEW_SLIDER,
    WHATS_NEW_SLIDES,
    WHATS_NEW_STEPS_CHART,
    WHATS_NEW_TITLE,
    WHATS_NEW_VERSION,
    chartScanRank,
    compareVersions,
    hasEasyTikzBlock,
    isFreshInstall,
    needsVaultCheck,
    shouldShowWhatsNew,
    whatsNewChart,
    whatsNewChartOf,
    whatsNewSeen,
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

const slideById = (id: string) => {
    const x = WHATS_NEW_SLIDES.find((s) => s.id === id);
    if (!x) throw new Error(`no slide ${id}`);
    return x;
};
const chartOfSlide = (id: string) => whatsNewChartOf(slideById(id).chart ?? '');
type Tool = { type: string; step?: number; [key: string]: unknown };
const toolsOf = (chart: Record<string, unknown>) => (chart.tools as Tool[]) ?? [];

test('whats new: seven slides in order, the film last', () => {
    assert.deepEqual(WHATS_NEW_SLIDES.map((x) => x.id), ['flow', 'chaos', 'ml', 'steps', 'fractal', 'ask', 'film']);
    assert.deepEqual(WHATS_NEW_SLIDES.map((x) => x.title), [
        'Fields that flow',
        'Chaos in 3D',
        'Machine learning',
        'Step by step',
        'Fractals, live',
        'Ask your chart',
        'Every idea deserves a picture',
    ]);
    assert.deepEqual(WHATS_NEW_SLIDES.map((x) => x.label), [
        'Live: particles move',
        'Live: draws itself and turns',
        'Live: Python, frame by frame',
        'Plays in steps',
        'Live: drag a and b',
        'Click a curve',
        '',
    ]);
    assert.equal(slideById('film').text, 'See all of 6.0 in two minutes.');
    assert.equal(WHATS_NEW_FILM_SLIDE, WHATS_NEW_SLIDES.length - 1);
    assert.equal(WHATS_NEW_TITLE, 'Easy Graphs Charts and TikZ 6');
    assert.equal(WHATS_NEW_VERSION, '6.0.0');
    // Every slide but the film has a live chart; the film has none.
    for (const x of WHATS_NEW_SLIDES) assert.equal(!!x.chart, x.id !== 'film', `${x.id}: chart ${!!x.chart}`);
    assert.equal(slideById('fractal').chart, WHATS_NEW_CHART_TEXT);
    assert.equal(slideById('fractal').sliders, 2);
});

test('whats new: every line is short, plain and free of em dashes, in English and Japanese', () => {
    const keys = ['flow', 'chaos', 'ml', 'steps', 'fractal', 'ask', 'film'] as const;
    for (const lang of ['en', 'ja'] as const) {
        for (const id of keys) {
            const title = tIn(lang, `panels.whatsNew.${id}.title`);
            const text = tIn(lang, `panels.whatsNew.${id}.text`);
            for (const s of [title, text]) {
                assert.ok(!s.includes(EM_DASH), `em dash in "${s}"`);
                assert.ok(s.trim() === s && s.length > 0, `blank or padded text "${s}"`);
            }
            assert.ok(title.length <= 40, `${lang} title too long: ${title}`);
            assert.ok(text.length <= 130, `${lang} text too long (${text.length}): ${text}`);
            assert.ok(/[.。]$/.test(text), `${lang}: a sentence ends with a full stop: ${text}`);
            if (id !== 'film') assert.ok(tIn(lang, `panels.whatsNew.${id}.label`).length <= 32, `${lang} label of ${id} too long`);
        }
    }
});

test('whats new: every chart fills a 16:9 stage, the machine learning slide shows the Showcase page', () => {
    for (const x of WHATS_NEW_SLIDES) {
        if (!x.chart || x.id === 'ml') continue;
        const chart = whatsNewChartOf(x.chart);
        assert.deepEqual([chart.size_x_cm, chart.size_y_cm], [16, 9], `${x.id}: size`);
    }
    // Read in the built-in words, whatever words a reader set up for their own charts.
    for (const x of WHATS_NEW_SLIDES) if (x.chart) assert.deepEqual(parseChartText(x.chart, { words: NO_WORDS }).problems, [], `${x.id}: ${x.chart}`);
    const guide = guideById(WHATS_NEW_ML_GUIDE);
    assert.ok(guide, `no guide ${WHATS_NEW_ML_GUIDE}`);
    assert.equal(canonical(chartOfSlide('ml')), canonical(guide.chart), 'the slide shows the chart of the Showcase page');
    const python = toolsOf(chartOfSlide('ml')).find((t) => t.type === 'python');
    assert.ok(python && /^def frame\(t\):/m.test(String(python.code)), 'the script plays with frame(t)');
});

test('whats new: the flow slide moves by itself, the chaos slide draws itself and turns, the steps slide plays in steps', () => {
    assert.equal(slideById('flow').chart, WHATS_NEW_FLOW_CHART);
    const flow = chartOfSlide('flow');
    const field = toolsOf(flow).find((t) => t.type === 'vectorField');
    assert.ok(field && field.particles === true && field.count === 600 && field.trails === 0.92, `the field: ${JSON.stringify(field)}`);
    assert.equal(field.expression, '(y, -\\sin x - 0.25y)');
    assert.ok(toolsOf(flow).some((t) => t.type === 'restPoints'), 'the rest points are marked');
    assert.deepEqual([flow.xmin, flow.xmax, flow.ymin, flow.ymax].map(Number), [-6.3, 6.3, -3.6, 3.6]);

    assert.equal(slideById('chaos').chart, WHATS_NEW_CHAOS_CHART);
    const chaos = chartOfSlide('chaos');
    assert.equal(chaos.dimension, true);
    assert.equal(chaos.turning, true);
    assert.equal(chaos.rotationX, 12, 'seen low');
    assert.equal(chaos.rotationZ, 0, 'from the front: the butterfly faces the reader');
    const path = toolsOf(chaos).find((t) => t.type === 'trajectory');
    assert.ok(path && path.traced === true && path.byTime === true, `the path: ${JSON.stringify(path)}`);
    // The Lorenz system of the Showcase page, through the same point.
    const lorenz = guideById('lorenz-butterfly');
    const first = lorenz ? toolsOf(lorenz.steps[0].chart ?? lorenz.chart).find((t) => t.type === 'trajectory') : null;
    assert.ok(first, 'the Showcase page lorenz-butterfly draws a path');
    assert.equal(path.expression, first.expression);
    assert.equal(path.through, first.through);

    const steps = toolsOf(chartOfSlide('steps')).map((t) => t.step ?? 0);
    assert.equal(Math.max(...steps), 2, 'the matrix moves in step 2, its eigenvectors come in step 3');
    assert.equal(slideById('steps').chart, WHATS_NEW_STEPS_CHART);
});

test('whats new slides: every chart reads without a problem and draws without an error at both ends of its slider', () => {
    for (const x of WHATS_NEW_SLIDES) {
        if (!x.chart) continue;
        const settings = SettingsManager.fromJSON(whatsNewChartOf(x.chart));
        const params = (settings.getValue('parameters') as Parameter[]) ?? [];
        const ends = params.length ? [params[0].min, params[0].value, params[0].max] : [NaN];
        for (const v of ends) {
            const math = settings.createMathContext({ memo: false });
            math.setParams(params.map((p, k) => (k === 0 && Number.isFinite(v) ? { ...p, value: v } : p)));
            const config = settings.toRendererConfig(math);
            const issues: SceneIssue[] = [...math.parameterIssues()];
            if (config.is3D) {
                const view = { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax, zmin: config.zmin ?? -5, zmax: config.zmax ?? 5 };
                issues.push(...computeScene3D({ tools: config.tools, math, view }).issues);
            } else {
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
            }
            const errors = issues.filter((i) => i.severity === 'error').map((i) => issueText(i));
            for (const info of math.functions()) if (info.error) errors.push(`${info.name}: ${info.error}`);
            assert.deepEqual(errors, [], `${x.id} at ${v}`);
        }
    }
});

test('whats new: the ask slide asks real questions, and every answer draws', () => {
    const data = new SettingsManager().serialize();
    Object.assign(data, whatsNewChartOf(WHATS_NEW_ASK_CHART));
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

test('whats new: icons are lucide ids', () => {
    for (const icon of WHATS_NEW_ICONS) assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(icon), `not an icon id: ${icon}`);
    assert.equal(new Set(WHATS_NEW_ICONS).size, WHATS_NEW_ICONS.length, 'an icon is listed twice');
});

test('whats new: the number of guides it names is the number in the Help tab, on GitHub and in the README', () => {
    // 6.0: the popup no longer counts the guides (its list of earlier versions is gone); the Help tab's
    // number is the guide list's, and the pages on GitHub and the README must say the same.
    const count = GUIDES.length;
    // The pages on GitHub are files made by `npm run media:guides`, so they tell independently whether
    // a guide was added or removed without running the script: one page per guide, none left over.
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

// ------------------------------------------------------------------- film

/** The width and height of a baseline or progressive JPEG, from its SOF marker. */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        const length = bytes.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xc3) return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
        i += 2 + length;
    }
    return null;
}

test('whats new: the film plays from YouTube only after a click; the poster ships with the plugin', () => {
    const root = process.cwd();
    const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
    // The only addresses: the player, the film's page and the changelog, all in src/whatsnew.ts.
    const urls = (text: string) => text.match(/https?:\/\/[^\s'"`)]+/g) ?? [];
    assert.deepEqual(urls(read('src/whatsnew.ts')).sort(), [WHATS_NEW_CHANGELOG, WHATS_NEW_FILM.embed, WHATS_NEW_FILM.watch].sort());
    assert.ok(WHATS_NEW_FILM.embed.startsWith('https://www.youtube-nocookie.com/embed/X--vCnK-u7Q?'), WHATS_NEW_FILM.embed);
    assert.ok(/[?&]autoplay=1(&|$)/.test(WHATS_NEW_FILM.embed) && /[?&]playsinline=1(&|$)/.test(WHATS_NEW_FILM.embed), 'the player starts at once, also on phones');
    assert.equal(WHATS_NEW_FILM.watch, 'https://www.youtube.com/watch?v=X--vCnK-u7Q');
    assert.equal(WHATS_NEW_FILM.length, '2:21');
    for (const file of ['src/whatsnew.ts', 'src/ui/whatsNewModal.ts', 'src/ui/whatsnew.css']) {
        const text = read(file);
        if (file !== 'src/whatsnew.ts') assert.deepEqual(urls(text), [], `${file} names a URL`);
        assert.ok(!/\bfetch\(|requestUrl|XMLHttpRequest|preconnect|dns-prefetch|url\(/.test(text), `${file} loads something`);
    }
    // The popup makes one picture, the poster (a data: URL in main.js), and one player.
    const modal = read('src/ui/whatsNewModal.ts');
    assert.ok(/^import FILM_POSTER from '\.\/assets\/film-poster\.jpg';$/m.test(modal), 'the poster is the bundled picture');
    assert.equal((modal.match(/createEl\('img'/g) || []).length, 1, 'one picture');
    assert.ok(/createEl\('img', \{[^}]*src: FILM_POSTER\b/.test(modal), 'its source is the bundled poster');
    assert.equal((modal.match(/createEl\('iframe'/g) || []).length, 1, 'one player');
    // The player is made in FilmPlayer.play, and play() runs only from a click (the poster, the header's button).
    const play = /\n {4}play\(\): void \{\n([\s\S]*?)\n {4}\}\n/.exec(modal);
    assert.ok(play && play[1].includes("createEl('iframe'"), 'the player is made in play()');
    const calls = [...modal.matchAll(/\.play\(\)/g)].map((m) => modal.slice(Math.max(0, (m.index ?? 0) - 240), m.index));
    assert.equal(calls.length, 2, `play() is called ${calls.length} times`);
    for (const before of calls) assert.ok(/addEventListener\('click', \(\) => \{?[^}]*$/.test(before), `play() outside a click: ...${before.slice(-120)}`);
    assert.ok(/allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen'/.test(modal) && /referrerpolicy: 'strict-origin-when-cross-origin'/.test(modal) && /allowfullscreen/.test(modal), 'the player is allowed to play and go full screen');
    // The poster: a JPEG of about 960 x 540, at most 100 KB, bundled as a data: URL.
    const poster = fs.readFileSync(path.join(root, 'src', 'ui', 'assets', 'film-poster.jpg'));
    assert.ok(poster.length <= 100 * 1024, `the poster is ${poster.length} bytes`);
    assert.deepEqual(jpegSize(poster), { width: 960, height: 540 });
    assert.ok(/'\.jpg': 'dataurl'/.test(read('esbuild.config.mjs')), 'esbuild.config.mjs bundles .jpg as data: URLs');
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

