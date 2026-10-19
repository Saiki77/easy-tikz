/*
 * Chart words (src/text/words.ts): a person's own words for the pieces of
 * the chart language, read as the built-in ones and written for them.
 * A German set (made here; the plugin ships only English) draws every
 * built-in chart: printed in German, read back the same, edited line by
 * line. Names, functions, titles and labels are never touched; problems
 * point at what was typed; clashes are named.
 */
import { test, assert } from './_lib';
import { EXAMPLES } from '../src/migrate';
import { GUIDES } from '../src/guides';
import { canonical } from '../src/chartdata';
import { parseChartText } from '../src/text/parse';
import { printChartText, writeChartText } from '../src/text/print';
import { ChartWords, NO_WORDS, clean, readWords, setChartWords, wordProblem, wordsFromText, wordsToText, writeWords } from '../src/text/words';

type Data = Record<string, unknown>;

const GERMAN: ChartWords = clean({
    words: {
        show: ['zeige'],
        size: ['Größe'],
        axes: ['Achsen'],
        'on-the-edges': ['an den Rändern'],
        'in-the-middle': ['in der Mitte'],
        'in-a-box': ['im Kasten'],
        'no-axes': ['keine Achsen'],
        'with-a-grid': ['mit Gitter'],
        'with-a-fine-grid': ['mit feinem Gitter'],
        'equal-scale': ['gleicher Maßstab'],
        title: ['Titel'],
        xlabel: ['x-Achse'],
        ylabel: ['y-Achse'],
        slider: ['Regler'],
        plot: ['plotte'],
        shade: ['schattiere'],
        draw: ['zeichne'],
        mark: ['markiere'],
        write: ['schreibe'],
        from: ['von'],
        to: ['bis', 'nach'],
        and: ['und'],
        where: ['wo'],
        between: ['zwischen'],
        under: ['unter'],
        'starting-at': ['beginnend bei'],
        'in-steps-of': ['in Schritten von'],
        'the-maximum-of': ['das Maximum von'],
        'the-minimum-of': ['das Minimum von'],
        'the-corners-of': ['die Ecken von'],
        cross: ['sich schneiden'],
        'the-integer-points-in': ['die ganzzahligen Punkte in'],
        'the-integer-maximum-of': ['das ganzzahlige Maximum von'],
        'in-the-region': ['im Bereich'],
        'the-region': ['dem Bereich'],
        'an-arrow': ['einen Pfeil'],
        'a-double-arrow': ['einen Doppelpfeil'],
        'a-line': ['eine Linie'],
        'a-polygon-through': ['ein Polygon durch'],
        'a-brace': ['eine Klammer'],
        'the-plane': ['die Ebene'],
        'the-level-curves-of': ['die Höhenlinien von'],
        at: ['bei'],
        dashed: ['gestrichelt'],
        thick: ['dick'],
        thin: ['dünn'],
        hidden: ['versteckt'],
        numbered: ['nummeriert'],
        'with-constraint-lines': ['mit Randgeraden'],
        outlined: ['umrandet'],
        'not-filled': ['ungefüllt'],
        filled: ['gefüllt'],
        'with-its-tangent-at': ['mit Tangente bei'],
        'with-its-extrema': ['mit Extrema'],
        'with-a-legend': ['mit Legende'],
        'with-the-legend': ['mit der Legende'],
        labelled: ['beschriftet'],
        large: ['groß'],
        small: ['klein'],
        'with-coordinates': ['mit Koordinaten'],
        'with-lines-to-the-axes': ['mit Linien zu den Achsen'],
        red: ['rot'],
        blue: ['blau'],
        green: ['grün'],
        purple: ['lila'],
        black: ['schwarz'],
        gray: ['grau'],
        brown: ['braun'],
        teal: ['türkis'],
    },
    bundles: [{ word: 'Ziel', means: 'in rot, gestrichelt' }],
    write: 'yours',
});

const LP_DE = [
    'Größe 12 x 6',
    'zeige x von 0 bis 5.5 und y von 0 bis 3',
    'Achsen an den Rändern',
    'schattiere wo x + y <= 4 und x + 3y <= 6 und x >= 0 und y >= 0, nummeriert',
    'Regler c von 0 bis 15, beginnend bei 6',
    'zeichne 2x + 3y = c, Ziel',
    'markiere das Maximum von 2x + 3y im Bereich, groß, mit Koordinaten',
].join('\n');

const LP_EN = [
    'size 12 x 6',
    'show x from 0 to 5.5 and y from 0 to 3',
    'axes on the edges',
    'shade where x + y <= 4 and x + 3y <= 6 and x >= 0 and y >= 0, numbered',
    'slider c from 0 to 15, starting at 6',
    'draw 2x + 3y = c in red, dashed',
    'mark the maximum of 2x + 3y in the region, large, with coordinates',
].join('\n');

function builtInCharts(): Array<{ id: string; data: Data }> {
    const out: Array<{ id: string; data: Data }> = EXAMPLES.map((e) => ({ id: `example ${e.id}`, data: e.data as Data }));
    for (const g of GUIDES) out.push({ id: `guide ${g.id}`, data: g.chart as unknown as Data });
    return out;
}

/** Run `fn` with these words set, as the plugin sets them from its settings. */
function withWords<T>(w: ChartWords, fn: () => T): T {
    setChartWords(w);
    try {
        return fn();
    } finally {
        setChartWords(NO_WORDS);
    }
}

test('words: a block in German, with a bundle, is the chart of the same block in English', () => {
    withWords(GERMAN, () => {
        const de = parseChartText(LP_DE);
        assert.deepEqual(de.problems, []);
        assert.equal(canonical(de.data), canonical(parseChartText(LP_EN).data));
    });
});

test('words: the built-in words keep working beside them', () => {
    withWords(GERMAN, () => {
        const r = parseChartText(LP_EN);
        assert.deepEqual(r.problems, []);
        assert.equal(canonical(r.data), canonical(parseChartText(LP_DE).data));
    });
});

test('words: every built-in chart, printed in German, reads back as the same chart, in German', () => {
    withWords(GERMAN, () => {
        const failures: string[] = [];
        for (const { id, data } of builtInCharts()) {
            const text = printChartText(data);
            const back = parseChartText(text);
            if (back.problems.length) failures.push(`${id}: ${back.problems.map((p) => `${p.line}:${p.column} ${p.message}`).join('; ')}\n${text}`);
            else if (canonical(back.data) !== canonical(data)) failures.push(`${id}: not the same chart\n${text}`);
            for (const line of text.split('\n')) {
                if (line.startsWith('raw ')) failures.push(`${id}: a raw line: ${line}`);
                if (/^(?:[A-Za-z0-9_]+: )?(show|plot|shade|draw|mark|slider|axes) /.test(line)) failures.push(`${id}: a line in the built-in words: ${line}`);
            }
        }
        assert.deepEqual(failures, []);
    });
});

test('words: "the plugin writes" can stay the built-in words while theirs are read', () => {
    withWords({ ...GERMAN, write: 'builtin' }, () => {
        const text = printChartText(parseChartText(LP_DE).data);
        assert.match(text, /^show x from 0 to 5\.5 and y from 0 to 3$/m);
        assert.doesNotMatch(text, /zeige|schattiere/);
    });
});

test('words: editing a German block rewrites the changed line in German and keeps the others as typed', () => {
    withWords(GERMAN, () => {
        const text = ['% ein lineares Programm', LP_DE].join('\n');
        const data = parseChartText(text).data;
        const tools = data.tools as Data[];
        const i = tools.findIndex((t) => t.type === 'curve');
        tools[i] = { ...tools[i], color: 'green' };
        const out = writeChartText(text, data).split('\n');
        const before = text.split('\n');
        const changed = out.filter((l, k) => l !== before[k]);
        assert.equal(out.length, before.length);
        assert.deepEqual(changed, ['zeichne 2x + 3y = c in grün, gestrichelt'], out.join('\n'));
        assert.equal(canonical(parseChartText(out.join('\n')).data), canonical(data));
    });
});

test('words: names, functions, titles and labels are never words', () => {
    withWords(GERMAN, () => {
        // A function called rot, a slider called blau used in a formula and a label, a title and a label text with chart words in them.
        const r = parseChartText(['Titel Rot und blau, von Hand', 'Regler blau von 0 bis 5, beginnend bei 1', 'plotte rot(x) = blau x^2 in grün', 'schreibe "rot und blau" bei (1, blau)'].join('\n'));
        assert.deepEqual(r.problems, []);
        assert.equal(r.data.title, 'Rot und blau, von Hand');
        assert.equal((r.data.parameters as Data[])[0].name, 'blau');
        assert.deepEqual([(r.data.functions as Data[])[0].name, (r.data.functions as Data[])[0].expression, (r.data.functions as Data[])[0].color], ['rot', 'blau x^2', 'green']);
        assert.deepEqual([(r.data.annotations as Data[])[0].text, (r.data.annotations as Data[])[0].y], ['rot und blau', 'blau']);
    });
});

test('words: a problem points at the word as it was typed', () => {
    withWords(GERMAN, () => {
        const r = parseChartText('plotte f(x) = x^2 in blau, gestrichelt, funkelnd');
        assert.equal(r.problems.length, 1);
        assert.equal(r.problems[0].column, 'plotte f(x) = x^2 in blau, gestrichelt, '.length + 1);
    });
});

test('words: one built-in word for two pieces, told apart by what follows (in red, in R1)', () => {
    const french = clean({ words: { mark: ['marque'], 'the-maximum-of': ['le maximum de'], 'in-region': ['dans'], 'in-colour': ['en'], red: ['rouge'], large: ['grand'] }, bundles: [], write: 'yours' });
    withWords(french, () => {
        const line = 'P1: marque le maximum de 2x + 3y dans R1 en rouge, grand';
        const r = parseChartText(`${line}\nR1: shade where x + y <= 4 and x >= 0 and y >= 0`);
        assert.deepEqual(r.problems, []);
        const p = (r.data.tools as Data[])[0];
        assert.deepEqual([p.regionName, p.color, p.size], ['R1', 'red', 'large']);
        assert.equal(writeWords('mark the maximum of 2x + 3y in R1 in red, large', french), 'marque le maximum de 2x + 3y dans R1 en rouge, grand');
    });
});

test('words: a word can belong to one piece only, and never be a name formulas use', () => {
    assert.match(wordProblem('draw', 'plot', GERMAN), /built-in word for "draw"/);
    assert.match(wordProblem('zeichne', 'plot', GERMAN), /already your word for "draw"/);
    assert.match(wordProblem('Ziel', 'plot', GERMAN), /bundle/);
    assert.match(wordProblem('sin', 'plot', GERMAN), /name formulas use/);
    assert.match(wordProblem('2x', 'plot', GERMAN), /letters/);
    assert.equal(wordProblem('Funktion', 'plot', GERMAN), '');
    assert.equal(wordProblem('zeichne', 'draw', GERMAN), '');
});

test('words: shared as text and read back', () => {
    const text = wordsToText(GERMAN);
    assert.match(text, /^plot = plotte$/m);
    assert.match(text, /^to = bis, nach$/m);
    assert.match(text, /^Ziel := in rot, gestrichelt$/m);
    const back = wordsFromText(text);
    assert.deepEqual(back.problems, []);
    assert.deepEqual(back.words, GERMAN);
    assert.match(wordsFromText('plot = graph\nnonsense line').problems[0], /line 2/);
});

test('words: reading is linear and cheap enough for every key', () => {
    const lines = Array.from({ length: 40 }, () => LP_DE).join('\n');
    const t0 = Date.now();
    for (let k = 0; k < 20; k++) readWords(lines, GERMAN);
    assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms for 20 reads of 280 lines`);
});

test('words: random editor edits on every built-in chart in German keep every comment and give the right chart', () => {
    withWords(GERMAN, () => {
        let seed = 11;
        const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
        const charts = builtInCharts().map((c) => c.data);
        const failures: string[] = [];
        for (let round = 0; round < 150; round++) {
            const lines = printChartText(pick(charts)).split('\n');
            const text = lines.flatMap((l, i) => (i % 2 === 0 ? [`% Notiz ${i}`, l] : [l])).join('\n');
            const data = JSON.parse(JSON.stringify(parseChartText(text).data)) as Data;
            const fns = (data.functions as Data[] | undefined) ?? [];
            const tools = (data.tools as Data[] | undefined) ?? [];
            const kind = pick(['recolour', 'move tool', 'rename tool', 'add function', 'view']);
            if (kind === 'recolour' && fns.length + tools.length) pick([...fns, ...tools]).color = 'green';
            if (kind === 'move tool' && tools.length > 1) tools.reverse();
            if (kind === 'rename tool' && tools.length) {
                const old = String(pick(tools).name);
                data.tools = JSON.parse(JSON.stringify(tools).replace(new RegExp(`\\b${old}\\b`, 'g'), 'Zed')) as Data[];
            }
            if (kind === 'add function') data.functions = [...fns, { name: 'neu', expression: 'x/2', color: 'red' }];
            if (kind === 'view') data.xmax = '11';
            const out = writeChartText(text, data);
            if (canonical(parseChartText(out).data) !== canonical(data)) failures.push(`${kind}: not the same chart\n${out}`);
            const notes = (t: string) => t.split('\n').filter((l) => l.startsWith('% Notiz')).length;
            if (notes(out) < notes(text)) failures.push(`${kind}: comments lost\n${out}`);
        }
        assert.deepEqual(failures.slice(0, 3), []);
    });
});

test('words: after a word changed, a note\'s charts that used it are rewritten in the new words, comments and callouts kept', () => {
    const { rewordNote } = require('../src/text/reword') as typeof import('../src/text/reword');
    const after = clean({ ...GERMAN, words: { ...GERMAN.words, draw: ['male'] } });
    const note = [
        'Text before.',
        '',
        '```easy-tikz',
        '% die Zielfunktion',
        LP_DE,
        '```',
        '',
        '> [!note] In a callout',
        '> ```easy-tikz',
        '> zeichne x = 2 in blau',
        '> ```',
        '',
        '```easy-tikz',
        'plotte f(x) = x^2',
        '```',
        '',
        '```easy-tikz',
        '{ "v": 4, "functions": [{ "name": "f", "expression": "x" }] }',
        '```',
    ].join('\n');
    const r = rewordNote(note, GERMAN, after);
    assert.equal(r.changed, 2, r.text);
    const lines = r.text.split('\n');
    assert.ok(lines.includes('% die Zielfunktion'), r.text);
    assert.ok(lines.includes('male 2x + 3y = c, Ziel'), r.text);
    assert.ok(lines.includes('> male x = 2 in blau'), r.text);
    assert.ok(lines.includes('plotte f(x) = x^2'), 'a block without the old word stays');
    assert.ok(r.text.includes('{ "v": 4, "functions": [{ "name": "f", "expression": "x" }] }'), 'a JSON block stays');
    assert.equal(rewordNote(note, GERMAN, GERMAN).changed, 0);
});
