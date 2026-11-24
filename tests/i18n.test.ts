/*
 * The interface in other languages (src/i18n): every language has every key
 * of the English, keeps every named place and plural block of it, has no
 * empty text and no em dash; t() fills places and plural forms, falls back
 * to English, follows Obsidian's language or the setting, and inEnglish
 * goes back to the language it found.
 */
import { test, assert } from './_lib';
import { EN, MessageKey } from '../src/i18n/en';
import { JA } from '../src/i18n/ja';
import { format, inEnglish, language, languageSetting, placesOf, pluralForms, resolveLanguage, setLanguage, t, tIn } from '../src/i18n';

const LANGS: Record<string, Readonly<Record<string, string>>> = { ja: JA };
const keys = Object.keys(EN) as MessageKey[];

test('every key starts with the name of its part', () => {
    const parts = new Set(['common', 'editor', 'build', 'panels', 'plugin', 'problems', 'help', 'beyond', 'values']);
    for (const k of keys) assert.ok(parts.has(k.split('.')[0]), `${k}: no part of that name`);
});

test('every language has exactly the English keys', () => {
    for (const [lang, cat] of Object.entries(LANGS)) {
        const missing = keys.filter((k) => !(k in cat));
        const extra = Object.keys(cat).filter((k) => !(k in EN));
        assert.deepEqual(missing, [], `${lang} is missing keys`);
        assert.deepEqual(extra, [], `${lang} has keys English does not`);
    }
});

test('every translation keeps the named places of its English text', () => {
    for (const [lang, cat] of Object.entries(LANGS)) {
        for (const k of keys) {
            assert.deepEqual(placesOf(cat[k]), placesOf(EN[k]), `${lang} ${k}: "${cat[k]}" vs "${EN[k]}"`);
        }
    }
});

test('plural blocks are well formed and have an other form', () => {
    const all: Array<[string, string]> = keys.map((k) => [`en ${k}`, EN[k]]);
    for (const [lang, cat] of Object.entries(LANGS)) for (const k of keys) all.push([`${lang} ${k}`, cat[k]]);
    for (const [where, text] of all) {
        for (const m of text.matchAll(/\{(\w+), plural,/g)) {
            const forms = pluralForms(text, (m.index ?? 0) + m[0].length);
            assert.ok(forms, `${where}: the plural block of ${m[1]} does not close`);
            assert.ok(forms.cases.has('other'), `${where}: the plural block of ${m[1]} has no other form`);
        }
    }
});

test('no text is empty, none has an em dash, none starts or ends with a space', () => {
    const cats: Array<[string, Readonly<Record<string, string>>]> = [['en', EN], ...Object.entries(LANGS)];
    for (const [lang, cat] of cats) {
        for (const k of keys) {
            const s = cat[k];
            assert.ok(s.trim().length > 0, `${lang} ${k} is empty`);
            assert.ok(!s.includes('—'), `${lang} ${k} has an em dash`);
            assert.equal(s, s.trim(), `${lang} ${k} starts or ends with a space`);
        }
    }
});

test('format fills places and plural forms, and leaves unknown places as written', () => {
    assert.equal(format('Delete {name}', { name: 'f1' }), 'Delete f1');
    assert.equal(format('optional, e.g. z = {level}', {}), 'optional, e.g. z = {level}');
    assert.equal(format('optional, e.g. z = {level}'), 'optional, e.g. z = {level}');
    const charts = 'Rewrite {count, plural, one {# chart} other {# charts}} in {notes, plural, one {# note} other {# notes}}';
    assert.equal(format(charts, { count: 1, notes: 1 }), 'Rewrite 1 chart in 1 note');
    assert.equal(format(charts, { count: 3, notes: 2 }), 'Rewrite 3 charts in 2 notes');
    assert.equal(format('{n, plural, =0 {nothing} one {one {thing}} other {# {thing}s}}', { n: 0, thing: 'chart' }), 'nothing');
    assert.equal(format('{n, plural, =0 {nothing} one {one {thing}} other {# {thing}s}}', { n: 1, thing: 'chart' }), 'one chart');
    assert.equal(format('{n, plural, =0 {nothing} one {one {thing}} other {# {thing}s}}', { n: 5, thing: 'chart' }), '5 charts');
    assert.equal(format('{n, plural, other {グラフ # 件}}', { n: 4 }), 'グラフ 4 件');
});

test('t follows the language, tIn picks one, inEnglish goes back', () => {
    const k: MessageKey = 'common.delete';
    setLanguage('en');
    assert.equal(t(k), EN[k]);
    setLanguage('ja');
    assert.equal(t(k), JA[k]);
    assert.equal(language(), 'ja');
    assert.equal(inEnglish(() => t(k)), EN[k]);
    assert.equal(language(), 'ja');
    assert.throws(() => inEnglish(() => { throw new Error('x'); }));
    assert.equal(language(), 'ja');
    assert.equal(tIn('en', k), EN[k]);
    setLanguage('en');
});

test('the language follows Obsidian unless the setting fixes one', () => {
    assert.equal(resolveLanguage('auto', 'ja'), 'ja');
    assert.equal(resolveLanguage('auto', 'ja-JP'), 'ja');
    assert.equal(resolveLanguage('auto', 'de'), 'en');
    assert.equal(resolveLanguage('auto', 'zh-TW'), 'en');
    assert.equal(resolveLanguage('auto', ''), 'en');
    assert.equal(resolveLanguage('auto', undefined), 'en');
    assert.equal(resolveLanguage('en', 'ja'), 'en');
    assert.equal(resolveLanguage('ja', 'en'), 'ja');
    assert.equal(languageSetting('ja'), 'ja');
    assert.equal(languageSetting('fr'), 'auto');
    assert.equal(languageSetting(undefined), 'auto');
});
