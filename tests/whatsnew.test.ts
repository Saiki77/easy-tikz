/*
 * The "What's new" popup (src/whatsnew.ts): who sees it, what it says and
 * the live chart inside it. The popup itself needs Obsidian; the smoke test
 * (scripts/media/smoke.mjs) opens it in a real app.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, assert, near } from './_lib';
import { GUIDES, guideById } from '../src/guides';
import { issueText } from '../src/issues';
import { LABEL_LOCALS } from '../src/mathcontext';
import { computeScene2D, labelMetricsFor, SceneIssue } from '../src/scene';
import { SettingsManager } from '../src/settings';
import { DEFAULT_PLUGIN_DATA } from '../src/templates';
import { Parameter } from '../src/types';
import { marchingGrid } from '../src/util';
import {
    AREA_FORMULA,
    WHATS_NEW_CHART_GUIDE,
    WHATS_NEW_ICONS,
    WHATS_NEW_LIVE,
    WHATS_NEW_MORE,
    WHATS_NEW_RECIPE,
    WHATS_NEW_SLIDER,
    WHATS_NEW_SUBTITLE,
    WHATS_NEW_TITLE,
    WHATS_NEW_VERSION,
    chartScanRank,
    compareVersions,
    hasEasyTikzBlock,
    isFreshInstall,
    needsVaultCheck,
    shouldShowWhatsNew,
    whatsNewChart,
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

const ITEMS = [...WHATS_NEW_LIVE, ...WHATS_NEW_MORE];

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
    assert.equal(WHATS_NEW_TITLE, 'Easy TikZ 4');
});

test('whats new: it covers the highlights of version 4, sliders and calculations first', () => {
    const all = ITEMS.map((i) => `${i.title} ${i.text}`.toLowerCase()).join('\n');
    for (const topic of ['editor', 'slider', 'play', 'drag', 'shift', 'five general tools', 'inequalities', 'equations', 'intersections', 'optimum', 'segments', '3d planes', 'p1_x', 'labels', 'notes', 'latex', 'guides', '3.x']) {
        assert.ok(all.includes(topic), `nothing says "${topic}"`);
    }
    assert.deepEqual(WHATS_NEW_LIVE.map((i) => i.title), ['Live sliders', 'Live calculations', 'Sliders in your notes']);
});

test('whats new: icons are lucide ids, guides exist', () => {
    for (const icon of WHATS_NEW_ICONS) assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(icon), `not an icon id: ${icon}`);
    assert.equal(new Set(ITEMS.map((i) => i.icon)).size, ITEMS.length, 'two items share an icon');
    for (const item of ITEMS) if (item.guide) assert.ok(guideById(item.guide), `${item.title}: no guide ${item.guide}`);
    for (const item of WHATS_NEW_LIVE) assert.ok(item.guide, `${item.title} links no guide`);
    assert.ok(guideById(WHATS_NEW_CHART_GUIDE), `no guide ${WHATS_NEW_CHART_GUIDE}`);
    const said = ITEMS.map((i) => /(\d+) step-by-step guides/.exec(i.text)).find((m) => m);
    assert.ok(said, 'no item counts the guides');
    assert.equal(Number(said[1]), GUIDES.length, 'the number of guides in the text');
});

test('whats new: the recipe beside the chart is what the chart holds', () => {
    const chart = whatsNewChart();
    const fields = [
        ...(chart.functions as Array<{ expression: string }>).map((f) => f.expression),
        ...(chart.tools as Array<{ conditions: string[]; label: string }>).flatMap((t) => [...t.conditions, t.label]),
        String(chart.title),
    ];
    assert.equal(WHATS_NEW_RECIPE.length, 6);
    for (const [code, where] of WHATS_NEW_RECIPE) {
        assert.ok(fields.includes(code), `"${code}" (${where}) is not a field of the chart`);
        assert.ok(!where.includes(EM_DASH) && where.length <= 40, where);
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
    const params = (settings.getValue('parameters') as Parameter[]).map((p) => ({ ...p, value: a }));
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

/** Shoelace area of the even-odd rings. */
function ringArea(rings: { x: number; y: number }[][]): number {
    let total = 0;
    for (const ring of rings) {
        let s = 0;
        for (let i = 0; i < ring.length; i++) {
            const p = ring[i];
            const q = ring[(i + 1) % ring.length];
            s += p.x * q.y - q.x * p.y;
        }
        total += Math.abs(s) / 2;
    }
    return total;
}

test('whats new chart: the Tangent explorer with the area to its tangent, slider a', () => {
    const chart = whatsNewChart();
    const functions = chart.functions as Array<{ name: string; expression: string; hidden?: boolean; tangent?: boolean; tangentPoint?: string }>;
    assert.equal(functions[0].expression, 'x^3 - 3x');
    assert.ok(functions[0].tangent && functions[0].tangentPoint === 'a', 'f1 draws its tangent at a');
    assert.deepEqual([functions[1].name, functions[1].expression, functions[1].hidden], ['f2', 'f1(a) + (3a^2 - 3)(x - a)', true]);
    const region = (chart.tools as Array<{ name: string; conditions: string[]; label: string }>)[0];
    assert.deepEqual(region.conditions, ['min(f1, f2) <= y <= max(f1, f2)', 'min(a, -2a) <= x <= max(a, -2a)']);
    assert.equal(region.label, `A = {${AREA_FORMULA}:2}`);
    assert.deepEqual(chart.parameters, [WHATS_NEW_SLIDER]);
    // A copy every time: the popup changes the slider value of its own copy only.
    (whatsNewChart().parameters as Parameter[])[0].value = 99;
    assert.equal((whatsNewChart().parameters as Parameter[])[0].value, WHATS_NEW_SLIDER.value);
});

const EMPTY_NOTE = 'R1: no point of the view satisfies all conditions';

test('whats new chart: no problem anywhere on the slider, the hidden tangent included', () => {
    const { min, max, step } = WHATS_NEW_SLIDER;
    for (let k = 0; min + k * step <= max + 1e-9; k++) {
        const a = Number((min + k * step).toFixed(6));
        const { errors, notes } = sceneAt(a);
        assert.deepEqual(errors, [], `a = ${a}`);
        // Close to 0 the area is thinner than the tracing grid: the editor then says the region is empty (an info note).
        assert.deepEqual(notes, Math.abs(a) <= 0.1 + 1e-9 ? notes.filter((n) => n === EMPTY_NOTE) : [], `a = ${a}`);
    }
    assert.deepEqual(sceneAt(WHATS_NEW_SLIDER.value).notes, [], 'the start value draws without a note');
});

test('whats new chart: the shading is the area 27a^4/4, inside the view, and its label says so', () => {
    for (const a of [-1.1, -0.8, -0.3, 0.25, 0.5, WHATS_NEW_SLIDER.value, 1, 1.1]) {
        const { scene, config, math } = sceneAt(a);
        const item = scene.items.find((i) => i.source === 'R1');
        assert.ok(item && item.fills.length > 0, `a = ${a}: nothing shaded`);
        const rings = item.fills.flatMap((f) => f.rings);
        const exact = (27 * a ** 4) / 4;
        near(ringArea(rings), exact, Math.max(0.02, exact * 0.02), `a = ${a}: shaded area`);
        for (const ring of rings) {
            for (const p of ring) {
                assert.ok(p.x >= Math.min(a, -2 * a) - 1e-6 && p.x <= Math.max(a, -2 * a) + 1e-6, `a = ${a}: x = ${p.x} outside the contact points`);
                assert.ok(p.y > config.ymin && p.y < config.ymax, `a = ${a}: y = ${p.y} outside the view`);
            }
        }
        const label = item.texts.map((t) => t.text).join(' ');
        assert.equal(label, `A = ${Number(exact.toFixed(2))}`, `a = ${a}`);
        assert.equal(math.formatTemplate(String(config.title)), `slope at x = ${a}: ${Number((3 * a * a - 3).toFixed(2))}`);
    }
});

test('whats new chart: at a = 0 the area vanishes without an error', () => {
    const { scene, errors, notes } = sceneAt(0);
    assert.deepEqual(errors, []);
    assert.deepEqual(notes, [EMPTY_NOTE]);
    const item = scene.items.find((i) => i.source === 'R1');
    const area = item ? ringArea(item.fills.flatMap((f) => f.rings)) : 0;
    assert.ok(area < 1e-6, `area ${area} at a = 0`);
});
