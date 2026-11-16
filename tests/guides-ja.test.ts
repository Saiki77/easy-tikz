/*
 * The guides in Japanese (src/guides/ja.ts): an overlay of the English
 * guides with exactly their ids, the same counts and structure and the same
 * code spans in the same order, written in the Japanese style of
 * src/i18n/README.md. localGuide puts it over the English guide while the
 * interface is Japanese; charts, screenshots and the texts to type stay the
 * English guide's. Also the Help tab around the guides: category and level
 * names, the search in Japanese, and the help.* texts of the catalogs.
 */
import { test, assert } from './_lib';
import {
    GUIDES,
    GUIDE_CATEGORIES,
    GUIDE_LEVEL_LABELS,
    Guide,
    GuideLevel,
    guideById,
    guideCategoryLabel,
    guideLevelLabel,
    localGuide,
    localGuideById,
    localGuides,
    searchGuides,
} from '../src/guides';
import { GuideText, JA_GUIDES, overlayGuide } from '../src/guides/ja';
import { EN, MessageKey } from '../src/i18n/en';
import { JA } from '../src/i18n/ja';
import { setLanguage } from '../src/i18n';

/** Hiragana, katakana (with ー), kanji and the iteration marks. */
const JP = '\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\u3005\\u3006';
/** Full-width punctuation of Japanese text. */
const FWP = '、。，．「」『』（）：；！？・';

function inJapanese<T>(fn: () => T): T {
    setLanguage('ja');
    try {
        return fn();
    } finally {
        setLanguage('en');
    }
}

/** The inline code spans of a text, with their backticks. */
function spans(text: string | undefined): string[] {
    return String(text ?? '').match(/`[^`]*`/g) || [];
}

/**
 * What a Japanese text does against the style of src/i18n/README.md, outside
 * its code spans: one half-width space between Japanese and Latin words,
 * numbers or code, none next to full-width punctuation, full-width
 * punctuation and brackets next to Japanese, no em dash, no full-width
 * letters, digits or spaces.
 */
function styleProblems(text: string): string[] {
    const out: string[] = [];
    if (/[—―]/.test(text)) out.push('em dash or long dash');
    if (/　/.test(text)) out.push('ideographic space');
    if (/[Ａ-Ｚａ-ｚ０-９]/.test(text)) out.push('full-width letters or digits');
    if ((text.match(/`/g) || []).length % 2) out.push('unbalanced backticks');
    const checks: Array<[RegExp, string]> = [
        [new RegExp(`[${JP}][A-Za-z0-9\\u0001]`), 'no space between Japanese and a Latin word, number or code'],
        [new RegExp(`[A-Za-z0-9\\u0001][${JP}]`), 'no space between a Latin word, number or code and Japanese'],
        [new RegExp(`[ \\t][${FWP}]|[${FWP}][ \\t]`), 'space next to full-width punctuation'],
        [new RegExp(`[${JP}][,.:;!?()]|[,.:;!?()][${JP}]`), 'half-width punctuation next to Japanese'],
        [new RegExp(`\\([^()]*[${JP}][^()]*\\)`), 'half-width brackets around Japanese'],
        [/ {2,}/, 'double space'],
    ];
    for (const raw of text.split('\n')) {
        // A list line starts with '- '; a code span counts as one Latin word.
        const line = raw.replace(/^- /, '').replace(/`[^`]*`/g, '\u0001');
        if (raw.trim() && raw !== raw.trim()) out.push(`line starts or ends with a space: '${raw.slice(0, 40)}'`);
        for (const [re, what] of checks) {
            const m = re.exec(line);
            if (m) out.push(`${what}: '…${line.slice(Math.max(0, m.index - 12), m.index + 14).replace(/\u0001/g, '`…`')}…'`);
        }
    }
    return out;
}

/** Paragraphs of a body as text lines (T) and list lines (L). */
function shape(body: string): string {
    return body
        .split(/\n[ \t]*\n/)
        .map((p) => p.split('\n').map((l) => (l.trim().startsWith('- ') ? 'L' : 'T')).join(''))
        .join('|');
}

/** Every text of a guide beside its Japanese, with a name for messages and whether it must be one line. */
function pairs(en: Guide, ja: GuideText): Array<{ at: string; en: string; ja: string; line: boolean }> {
    const out = [
        { at: `${en.id} title`, en: en.title, ja: ja.title, line: true },
        { at: `${en.id} summary`, en: en.summary, ja: ja.summary, line: true },
    ];
    en.outcomes.forEach((o, i) => out.push({ at: `${en.id} outcome ${i + 1}`, en: o, ja: ja.outcomes[i], line: true }));
    en.steps.forEach((step, i) => {
        const s = ja.steps[i];
        if (!s) return;
        const at = `${en.id} step ${i + 1}`;
        out.push({ at: `${at} title`, en: step.title, ja: s.title, line: true });
        out.push({ at: `${at} body`, en: step.body, ja: s.body, line: false });
        if (step.tip !== undefined && s.tip !== undefined) out.push({ at: `${at} tip`, en: step.tip, ja: s.tip, line: true });
        (step.type || []).forEach((row, j) => {
            const where = s.where && s.where[j];
            if (where !== undefined) out.push({ at: `${at} where ${j + 1}`, en: row.where, ja: where, line: true });
        });
    });
    return out;
}

function allPairs(): Array<{ at: string; en: string; ja: string; line: boolean }> {
    return GUIDES.flatMap((g) => (JA_GUIDES[g.id] ? pairs(g, JA_GUIDES[g.id]) : []));
}

// ---------------------------------------------------------------- overlay

test('guides ja: every guide has its Japanese texts, and nothing else does', () => {
    assert.deepEqual(Object.keys(JA_GUIDES).sort(), GUIDES.map((g) => g.id).sort());
    for (const [id, text] of Object.entries(JA_GUIDES)) {
        assert.deepEqual(Object.keys(text).sort(), ['outcomes', 'steps', 'summary', 'title'], `${id}: only title, summary, outcomes and steps`);
        for (const [i, step] of text.steps.entries()) {
            for (const key of Object.keys(step)) assert.ok(['title', 'body', 'where', 'tip'].includes(key), `${id} step ${i + 1}: unknown field ${key}`);
        }
    }
});

test('guides ja: the counts of the English: outcomes, steps, type rows, and a tip exactly where the English has one', () => {
    for (const g of GUIDES) {
        const ja = JA_GUIDES[g.id];
        assert.equal(ja.outcomes.length, g.outcomes.length, `${g.id}: outcomes`);
        assert.equal(ja.steps.length, g.steps.length, `${g.id}: steps`);
        g.steps.forEach((step, i) => {
            const s = ja.steps[i];
            const at = `${g.id} step ${i + 1}`;
            assert.equal((s.where || []).length, (step.type || []).length, `${at}: one where per type row`);
            assert.equal(s.tip !== undefined, step.tip !== undefined, `${at}: a tip exactly when the English has one`);
        });
    }
});

test('guides ja: every code span of the English, identical and in the same order, and no other', () => {
    const problems: string[] = [];
    for (const p of allPairs()) {
        const en = spans(p.en);
        const ja = spans(p.ja);
        if (JSON.stringify(en) !== JSON.stringify(ja)) problems.push(`${p.at}\n    en: ${en.join(' ')}\n    ja: ${ja.join(' ')}`);
    }
    assert.deepEqual(problems, [], problems.join('\n'));
});

test('guides ja: bodies keep the paragraphs and lists of the English', () => {
    for (const g of GUIDES) {
        g.steps.forEach((step, i) => {
            assert.equal(shape(JA_GUIDES[g.id].steps[i].body), shape(step.body), `${g.id} step ${i + 1}: paragraphs (|), text lines (T) and list lines (L)`);
        });
    }
});

test('guides ja: no empty text, one line where the English is one line, every text translated', () => {
    for (const p of allPairs()) {
        assert.ok(typeof p.ja === 'string' && p.ja.trim().length > 0, `${p.at} is empty`);
        assert.equal(p.ja, p.ja.trim(), `${p.at} starts or ends with a space`);
        if (p.line) assert.ok(!p.ja.includes('\n'), `${p.at} must be one line`);
        assert.ok(new RegExp(`[${JP}${FWP}]`).test(p.ja), `${p.at} has no Japanese: '${p.ja.slice(0, 60)}'`);
    }
});

test('guides ja: no em dash, and the spacing and punctuation of Japanese text', () => {
    const problems: string[] = [];
    for (const p of allPairs()) for (const problem of styleProblems(p.ja)) problems.push(`${p.at}: ${problem}`);
    assert.deepEqual(problems, [], problems.join('\n'));
});

test('styleProblems: finds the usual slips and passes clean text', () => {
    assert.deepEqual(styleProblems('`f1` カードの「オプション」を開き、2 つ目の関数を追加します（Windows では Ctrl+Enter）。'), []);
    assert.equal(styleProblems('`f1`カード').length, 1);
    assert.equal(styleProblems('2つ目').length, 1);
    assert.equal(styleProblems('開きます. 次に').length, 1);
    assert.equal(styleProblems('「追加」 をクリック').length, 1);
    assert.ok(styleProblems('(Windows では Ctrl+Enter)').length >= 1);
    assert.equal(styleProblems('a — b').length, 1);
    assert.equal(styleProblems('- 項目です。\n- `x` の値です。').length, 0);
});

// ------------------------------------------------------------- localGuide

test('localGuide: in English the English guide itself', () => {
    setLanguage('en');
    for (const g of GUIDES) {
        assert.equal(localGuide(g), g);
        assert.equal(localGuideById(g.id), g);
    }
    assert.deepEqual(localGuides(), GUIDES);
});

test('localGuide: in Japanese the texts of the overlay, the charts, shots, ids and texts to type of the English', () => {
    inJapanese(() => {
        for (const g of GUIDES) {
            const ja = JA_GUIDES[g.id];
            const out = localGuide(g);
            assert.equal(localGuide(g), out, `${g.id}: the same object each time`);
            assert.equal(localGuideById(g.id), out);
            assert.equal(guideById(g.id), g, `${g.id}: GUIDES stays English`);
            assert.equal(out.title, ja.title);
            assert.equal(out.summary, ja.summary);
            assert.deepEqual(out.outcomes, ja.outcomes);
            for (const key of ['id', 'category', 'level', 'minutes', 'requires', 'next', 'chart'] as const) assert.equal(out[key], g[key], `${g.id}: ${key}`);
            assert.equal(out.steps.length, g.steps.length);
            out.steps.forEach((step, i) => {
                const en = g.steps[i];
                const at = `${g.id} step ${i + 1}`;
                assert.equal(step.title, ja.steps[i].title, at);
                assert.equal(step.body, ja.steps[i].body, at);
                assert.equal(step.tip, ja.steps[i].tip, at);
                assert.equal(step.chart, en.chart, `${at}: the English chart`);
                assert.equal(step.shot, en.shot, `${at}: the English shot`);
                assert.deepEqual(
                    (step.type || []).map((row) => row.text),
                    (en.type || []).map((row) => row.text),
                    `${at}: the texts to type are the English ones`
                );
                assert.deepEqual((step.type || []).map((row) => row.where), ja.steps[i].where || [], `${at}: where`);
            });
        }
        assert.deepEqual(
            localGuides().map((g) => g.id),
            GUIDES.map((g) => g.id)
        );
    });
    // Back in English, the English guide again.
    assert.equal(localGuide(GUIDES[0]), GUIDES[0]);
});

test('overlayGuide: a text the overlay lacks keeps its English', () => {
    // A guide of its own: the guides of 5.1 have no step with both a tip and a type row.
    const g: Guide = {
        id: 'overlay-sample',
        title: 'Sample',
        summary: 'A sample guide.',
        category: 'Getting started',
        level: 'start',
        minutes: 1,
        outcomes: ['First outcome', 'Second outcome'],
        chart: {},
        steps: [
            { title: 'First step', body: 'A body.' },
            { title: 'Second step', body: 'A body.', tip: 'A tip.', type: [{ where: 'A field', text: 'x^2' }] },
            { title: 'Third step', body: 'A body.' },
        ],
    };
    const withTip = g.steps.findIndex((s) => s.tip !== undefined && s.type && s.type.length);
    const steps = g.steps.slice(0, withTip + 1).map((s, i) => (i === withTip ? { title: 'タイトル', body: '本文です。' } : { title: 'ステップ', body: '本文。' }));
    const out = overlayGuide(g, { title: '題', summary: '概要。', outcomes: ['一つ目'], steps });
    assert.equal(out.title, '題');
    assert.equal(out.outcomes[0], '一つ目');
    assert.deepEqual(out.outcomes.slice(1), g.outcomes.slice(1));
    assert.equal(out.steps[withTip].title, 'タイトル');
    assert.equal(out.steps[withTip].tip, g.steps[withTip].tip, 'no Japanese tip: the English one');
    assert.deepEqual(out.steps[withTip].type, g.steps[withTip].type, 'no where: the English rows');
    assert.deepEqual(out.steps.slice(withTip + 1), g.steps.slice(withTip + 1), 'steps the overlay lacks stay English');
    assert.equal(g.title, 'Sample', 'the English guide is not changed');
});

// ------------------------------------------------------- the Help tab

test('categories and levels: English names as identifiers, shown in the reader\'s language', () => {
    for (const c of GUIDE_CATEGORIES) assert.equal(guideCategoryLabel(c), c, `English name of ${c}`);
    for (const level of Object.keys(GUIDE_LEVEL_LABELS) as GuideLevel[]) assert.equal(guideLevelLabel(level), GUIDE_LEVEL_LABELS[level]);
    assert.deepEqual(GUIDE_LEVEL_LABELS, { start: 'Start here', core: 'Core', advanced: 'Advanced' });
    inJapanese(() => {
        assert.deepEqual(
            GUIDE_CATEGORIES.map(guideCategoryLabel),
            ['はじめに', 'グラフの言語', '関数とスライダー', '微分積分', '領域と最適化', 'データと確率', '点・線・ラベル', '3D', 'ノートと出力', 'リファレンス']
        );
        assert.deepEqual(
            (['start', 'core', 'advanced'] as const).map(guideLevelLabel),
            ['ここから', '基本', '応用']
        );
        assert.equal(GUIDE_LEVEL_LABELS.start, 'Start here', 'the GitHub pages stay English');
    });
});

test('search in Japanese: every guide by its own title, Japanese words and category names, full-width input', () => {
    inJapanese(() => {
        const local = localGuides();
        for (const g of local) {
            const hits = searchGuides(g.title, local);
            assert.ok(hits.some((h) => h.guide === g), `${g.id}: not found by its title '${g.title}'`);
        }
        assert.equal(searchGuides('接線', local)[0].guide.id, 'tangents-extrema');
        assert.ok(searchGuides('最適化', local).some((h) => h.guide.category === 'Regions and optimisation'), 'the Japanese category name is searched');
        // A full-width query, as an input method types it, finds the same as a half-width one.
        assert.deepEqual(
            searchGuides('ＬａＴｅＸ', local).map((h) => h.guide.id),
            searchGuides('latex', local).map((h) => h.guide.id)
        );
        assert.ok(searchGuides('latex', local).length > 0);
    });
});

test('help texts: the Japanese has the code spans of the English and the Japanese style', () => {
    const keys = (Object.keys(EN) as MessageKey[]).filter((k) => k.startsWith('help.'));
    assert.ok(keys.length > 100, `${keys.length} help keys`);
    const problems: string[] = [];
    for (const k of keys) {
        const en = spans(EN[k]).sort();
        const ja = spans(JA[k]).sort();
        if (JSON.stringify(en) !== JSON.stringify(ja)) problems.push(`${k}: code spans\n    en: ${en.join(' ')}\n    ja: ${ja.join(' ')}`);
        // A {place} is a value, not text.
        for (const problem of styleProblems(JA[k].replace(/\{\w+\}/g, '{}'))) problems.push(`${k}: ${problem}`);
        const bold = (s: string) => (s.match(/\*\*/g) || []).length;
        if (bold(EN[k]) !== bold(JA[k])) problems.push(`${k}: **bold** runs differ`);
    }
    assert.deepEqual(problems, [], problems.join('\n'));
});
