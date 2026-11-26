// 6.2.2: the typed reader interface of the hover cards (src/readers): the
// parse shapes build their cards, reader 0 gives named roles, the builders
// rename a formula's own variables, parseKey compares as the chart reads,
// and the gap harness (scripts/readers) keeps reader 0 and, 6.2.4, Smart's
// reader (the vote, then reader 0) within their counts on a committed subset
// of the hover-ml corpus and suite (and on all of it, when the corpus is on
// this machine), with the network of round 4.
import { test, assert } from './_lib';
import * as fs from 'node:fs';
import { parseChartText } from '../src/text/parse';
import { buildCard, parseKey, sameParse } from '../src/readers/build';
import { reader0 } from '../src/readers/reader0';
import { smartReader } from '../src/readers/smart';
import { inVariables } from '../src/formula';
import type { CardKind, CardParse } from '../src/readers/types';
import { Item, Measured, measure, readJsonl } from '../scripts/readers/harness';

const parses = (lines: string[]) => parseChartText(lines.join('\n')).problems;

/** One parse of each kind, as src/readers/types.ts writes them. */
const SHAPES: CardParse[] = [
    { kind: 'function', functions: [{ name: 'f', body: 'x^2 - 1' }] },
    { kind: 'function', functions: [{ body: 'x_0 e^{a t}' }], variables: ['t'] },
    { kind: 'function', functions: [{ body: '\\frac{m}{p_2} - \\frac{p_1}{p_2} x_1' }], variables: ['x_1', 'x_2'] },
    { kind: 'surface', body: '2x_1^2 + x_2^2', variables: ['x_1', 'x_2'] },
    { kind: 'polar', body: '1 + \\cos\\theta' },
    { kind: 'implicit', equation: 'x^2 + y^2 = 1' },
    { kind: 'region', condition: 'x_1 + x_2 \\le 4', variables: ['x_1', 'x_2'] },
    { kind: 'set', variables: ['x'], condition: 'g(x) \\le 0', space: 'n' },
    { kind: 'set', variables: ['x', 'y'], condition: 'x^2 + y^2 \\le 1' },
    { kind: 'map', name: 'g', domain: '\\mathbb{R}^n', codomain: '\\mathbb{R}' },
    { kind: 'condition', variable: 'x', condition: 'g(x) \\le 0' },
    { kind: 'interval', variable: '\\lambda', left: '[', lower: '0', upper: '1', right: ']' },
    { kind: 'jensen', name: 'g', weight: '\\lambda' },
    { kind: 'epigraph', name: 'g' },
    { kind: 'matrix', name: 'A', entries: [['2', '1'], ['0', '1']] },
    { kind: 'matrix', name: 'P', factor: '\\frac{1}{2}', entries: [['1', '1'], ['1', '1']] },
    { kind: 'product', matrix: 'A', vector: 'v' },
    { kind: 'product', entries: [['2', '1'], ['1', '2']], components: ['1', '0'] },
    { kind: 'det', matrix: 'A' },
    { kind: 'det', entries: [['1', '2'], ['3', '4']] },
    { kind: 'eigen', matrix: 'A', vector: 'v' },
    { kind: 'eigen', entries: [['2', '1'], ['1', '2']], vector: 'v' },
    { kind: 'recurrence', state: 'x', index: 'n', step: 'r x_n (1 - x_n)' },
    { kind: 'sum', index: 'k', lower: '1', upper: 'n', body: 'k^2' },
    { kind: 'domain', name: 'f', body: '\\frac{z^2 - 1}{z^2 + 1}' },
    { kind: 'domain', name: 'H', body: '\\frac{1}{s + 1}', variable: 's' },
    { kind: 'vector', statements: [{ name: 'v', nameTex: '\\vec v', sides: [{ value: '(2, 1)', tex: '(2, 1)' }], names: {} }] },
];

test('reader interface: every shape of src/readers/types.ts builds its card, and its lines parse', () => {
    const kinds = new Set<CardKind>();
    for (const p of SHAPES) {
        const card = buildCard(p);
        assert.ok(card, `${JSON.stringify(p)}: no card`);
        assert.equal(card.kind, p.kind, JSON.stringify(p));
        assert.deepEqual(parses(card.lines), [], card.lines.join(' / '));
        kinds.add(p.kind);
        // plain JSON: the parse survives a round trip unchanged
        assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
    }
    assert.equal(kinds.size, 19);
});

test('reader 0: the parses name the roles (a sum and its value, a function in t, a surface in x_1 and x_2, a transfer function in s, an interval, a map, a vector)', () => {
    const first = (tex: string, kind: CardKind) => reader0.read(tex, kind)[0];
    assert.deepEqual(first('\\displaystyle \\sum^n_{k=1}k=\\frac{n(n+1)}{2}', 'sum'), { kind: 'sum', index: 'k', lower: '1', upper: 'n', body: 'k', value: '\\frac{n(n+1)}{2}' });
    assert.deepEqual(first('s(t) = 3t^2 + 1', 'function'), { kind: 'function', functions: [{ name: 's', body: '3t^2 + 1' }], variables: ['t'] });
    assert.deepEqual(first('f(x_1, x_2) = x_1^2 + x_2^2', 'surface'), { kind: 'surface', body: 'x_1^2 + x_2^2', variables: ['x_1', 'x_2'] });
    assert.deepEqual(first('H(s) = \\frac{1}{s + 1}', 'domain'), { kind: 'domain', name: 'H', body: '\\frac{1}{s + 1}', variable: 's' });
    assert.deepEqual(first('\\lambda \\in [0, 1]', 'interval'), { kind: 'interval', variable: '\\lambda', left: '[', lower: '0', upper: '1', right: ']' });
    assert.deepEqual(first('g: \\mathbb{R}^n \\to \\mathbb{R}', 'map'), { kind: 'map', name: 'g', domain: '\\mathbb{R}^n', codomain: '\\mathbb{R}' });
    assert.deepEqual(first('\\vec v = (2, 1)', 'vector'), { kind: 'vector', statements: [{ name: 'v', nameTex: '\\vec v', sides: [{ value: '(2, 1)', tex: '(2, 1)' }], names: {} }] });
    // det of a written matrix: reader 0 reads the matrix, and the hover shows its card as det.
    assert.deepEqual(first('\\det \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', 'det'), { kind: 'matrix', entries: [['1', '2'], ['3', '4']] });
    // the same parse once, in the order of the spellings
    const all = reader0.read('y = 2x + 1 = 3', 'function').map((p) => JSON.stringify(p));
    assert.equal(new Set(all).size, all.length);
});

test('builders: a parse in its own variables is drawn in x and y, its axes named after them', () => {
    const lines = (p: CardParse) => buildCard(p)?.lines ?? [];
    const t = lines({ kind: 'function', functions: [{ name: 's', body: '3t^2 + \\sin t' }], variables: ['t'] });
    assert.ok(t.includes('xlabel t') && t.includes('plot $s(x) = 3x^2 + \\sin x$ in blue, thick'), t.join(' / '));
    const n = lines({ kind: 'function', functions: [{ body: '1/n' }], variables: ['n'] });
    assert.equal(n[0], 'show x from 0 to 20', n.join(' / '));
    const s = lines({ kind: 'surface', body: 'x_1^2 + x_2^2', variables: ['x_1', 'x_2'] });
    assert.ok(s.includes('xlabel $x_1$') && s.includes('ylabel $x_2$') && s.includes('plot $z = x^2 + y^2$ in viridis'), s.join(' / '));
    const wave = lines({ kind: 'surface', body: 'A\\sin(k x + \\omega t)', variables: ['x', 't'] });
    assert.ok(wave.includes('ylabel $t$') && wave.some((l) => l.includes('\\omega y')), wave.join(' / '));
    const polar = lines({ kind: 'polar', body: '1 - \\sin\\phi', variable: '\\phi' });
    assert.ok(polar.includes('plot $r(\\theta) = 1 - \\sin\\theta$ in blue, thick'), polar.join(' / '));
    const h = lines({ kind: 'domain', name: 'H', body: '\\frac{1}{s + 1}', variable: 's' });
    assert.ok(h.includes('colour the plane by $H(z) = \\frac{1}{z + 1}$'), h.join(' / '));
    // a domain (no reader of 6.2.1 gives one): from x = a to b, and the lines parse
    const d = lines({ kind: 'function', functions: [{ body: '\\sqrt{x}' }], domain: { from: '0', to: '4' } });
    assert.ok(d.includes('plot $f(x) = \\sqrt{x}$ from x = 0 to 4 in blue, thick'), d.join(' / '));
    assert.deepEqual(parses(d), []);
    // x_0 is no x; through stand-ins, so x and y can swap
    assert.equal(inVariables('x_0 e^{a t} + t', 't', 'y', 'x', 'y'), 'x_0 e^{a x} + x');
    assert.equal(inVariables('u + 2v', 'v', 'u', 'x', 'y'), 'y + 2x');
});

test('parseKey: two parses are the same when the chart reads them the same (a function name aside), not with a word left in', () => {
    const f = (body: string, name?: string): CardParse => ({ kind: 'function', functions: [{ ...(name ? { name } : {}), body }] });
    assert.ok(sameParse(f('\\tfrac12 x'), f('\\frac{1}{2} x')));
    assert.ok(sameParse(f('2 \\cdot x'), f('2x')));
    assert.ok(sameParse(f('\\lvert x \\rvert'), f('| x |')));
    assert.ok(sameParse(f('x^2', 'MC'), f('x^2', 'f')));
    assert.ok(!sameParse(f('x^2 \\nonumber'), f('x^2')));
    assert.ok(!sameParse(f('x^2'), f('x^3')));
    // a vector's TeX only labels its arrows
    const v = (tex: string): CardParse => ({ kind: 'vector', statements: [{ name: 'a', nameTex: tex, sides: [{ value: '(1, 2)', tex: '(1, 2)' }], names: {} }] });
    assert.equal(parseKey(v('\\vec a')), parseKey(v('\\vec{a}')));
});

interface Fixture {
    corpus: Item[];
    gold: Record<string, CardParse>;
    suite: Item[];
    expected: Record<string, CardParse>;
}

/** The counts of all kinds together. */
function totals(m: Measured) {
    const t = { net: 0, a: 0, b: 0, vNet: 0, c: 0 };
    for (const s of m.stats.values()) {
        t.net += s.net;
        t.a += s.a;
        t.b += s.b;
        t.vNet += s.vNet;
        t.c += s.cNone + s.cWrong;
    }
    return t;
}

test('gap harness on the committed subset (tests/readers-fixture.json): reader 0 and Smart\'s reader have no more gaps or false cards than before', () => {
    const fx = JSON.parse(fs.readFileSync('tests/readers-fixture.json', 'utf8')) as Fixture;
    const run = (name: string, reader: typeof reader0) => {
        const m = measure(reader, fx.corpus, new Map(Object.entries(fx.gold)), fx.suite, new Map(Object.entries(fx.expected)));
        const t = totals(m);
        console.log(`    ${name}: corpus ${fx.corpus.length}: a ${t.a} of ${t.net}, b ${t.b}; suite ${fx.suite.length}: c ${t.c} of ${t.vNet}; false cards shown ${m.falseCards.shown} of ${m.falseCards.netCard}`);
        return { t, m };
    };
    // reader 0 with the network of round 4 (6.2.4): it reads none of the new forms, so a is higher than with round 3 (26).
    const r0 = run('reader 0', reader0);
    assert.ok(r0.t.a <= 32, `a: ${r0.t.a}`);
    assert.ok(r0.t.b <= 14, `b: ${r0.t.b}`);
    assert.ok(r0.t.c <= 47, `c: ${r0.t.c}`);
    assert.ok(r0.m.falseCards.shown <= 70, `false cards: ${r0.m.falseCards.shown}`);
    // Smart's reader: the counts at the time of writing (b and c count other cards than reader 0's gold parses).
    const smart = run('Smart', smartReader);
    assert.ok(smart.t.a <= 12, `a: ${smart.t.a}`);
    assert.ok(smart.t.b <= 12, `b: ${smart.t.b}`);
    assert.ok(smart.t.c <= 12, `c: ${smart.t.c}`);
    assert.ok(smart.m.falseCards.shown <= 70, `false cards: ${smart.m.falseCards.shown}`);
});

// The hover-ml corpus and the reader data: only on the machine that has them, so CI without them passes.
const SCRATCH = '/private/tmp/claude-501/-Users-justus-PycharmProjects-tikz-graph-help/d7060021-8494-476b-bf42-b1974d650603/scratchpad/hover-ml';
const CORPUS = ['train_r4', 'dev_r4', 'hard_dev_r4', 'r3_dev_r4', 'r4_dev'].map((f) => `${SCRATCH}/data/${f}.jsonl`);
const GOLD = `${SCRATCH}/reader-data/gold.jsonl`;
const EXPECTED = `${SCRATCH}/reader-data/suite-expected.jsonl`;
const SUITE = `${SCRATCH}/designed3-frozen/suite.jsonl`;

test('gap harness on the whole corpus and every fourth suite variant: reader 0 and Smart\'s reader within their counts (skipped without the corpus)', () => {
    if (![...CORPUS, GOLD, EXPECTED, SUITE].every((f) => fs.existsSync(f))) {
        console.log('    (skipped: the hover-ml corpus or reader-data is not on this machine)');
        return;
    }
    const corpus = CORPUS.flatMap((f) => readJsonl<Item>(f));
    const gold = new Map(readJsonl<{ id: string; parse: CardParse; doubt?: string }>(GOLD).filter((g) => !g.doubt).map((g) => [g.id, g.parse]));
    const expected = new Map(readJsonl<{ id: string; parse: CardParse }>(EXPECTED).map((e) => [e.id, e.parse]));
    const suite = readJsonl<Item>(SUITE).filter((it) => expected.has(it.id)).filter((_it, i) => i % 4 === 0);
    const run = (name: string, reader: typeof reader0) => {
        const m = measure(reader, corpus, gold, suite, expected);
        const t = totals(m);
        console.log(`    ${name}: corpus: a ${t.a} of ${t.net} (${((100 * t.a) / t.net).toFixed(1)}%), b ${t.b}; suite: c ${t.c} of ${t.vNet} (${((100 * t.c) / t.vNet).toFixed(1)}%); false cards shown ${m.falseCards.shown}`);
        return { t, m };
    };
    // reader 0 with the network of round 4 (6.2.4: 1819 formulas get a card kind, 1673 with round 3)
    const r0 = run('reader 0', reader0);
    assert.ok(r0.t.a / r0.t.net <= 0.126, `a: ${r0.t.a} of ${r0.t.net}`);
    assert.ok(r0.t.b <= 14, `b: ${r0.t.b}`);
    assert.ok(r0.t.c / r0.t.vNet <= 0.385, `c: ${r0.t.c} of ${r0.t.vNet}`);
    assert.ok(r0.m.falseCards.shown <= 71, `false cards: ${r0.m.falseCards.shown}`);
    // Smart's reader (6.2.4): b and c count other cards than reader 0's gold parses (DESIGN-READERS.md section 6)
    const smart = run('Smart', smartReader);
    assert.ok(smart.t.a / smart.t.net <= 0.04, `a: ${smart.t.a} of ${smart.t.net}`);
    assert.ok(smart.t.b <= 92, `b: ${smart.t.b}`);
    assert.ok(smart.t.c / smart.t.vNet <= 0.065, `c: ${smart.t.c} of ${smart.t.vNet}`);
    assert.ok(smart.m.falseCards.shown <= 78, `false cards: ${smart.m.falseCards.shown}`);
});
