import { test, assert } from './_lib';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readVote } from '../src/readers/vote';
import { front, print } from '../src/readers/vote/front';
import { voteKey } from '../src/readers/vote/key';
import { smartReader } from '../src/readers/smart';
import { reader0 } from '../src/readers/reader0';
import { buildCard, CARD_KINDS } from '../src/readers/build';
import { definedFunctions, noteDomains } from '../src/notes6/recognize/adapt';
import { recognize } from '../src/notes6/recognize';
import type { CardKind, CardParse, ReadContext } from '../src/readers/types';

/** JSON with sorted keys (null kept, undefined left out): two parses are the same when this is. */
const sorted = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, (x as Record<string, unknown>)[q]])) : x));

const ctxOf = (defs: readonly string[] | undefined): ReadContext => ({ functions: definedFunctions(defs ?? []), domains: noteDomains(defs ?? []) });

interface VoteCase {
    tex: string;
    kind: CardKind;
    defs: string[];
    parses: CardParse[];
}

test('vote: the TypeScript port gives the frozen best.mjs parses on the committed fixture (tests/readers-vote-fixture.json, about 500 formulas)', () => {
    const cases = JSON.parse(fs.readFileSync('tests/readers-vote-fixture.json', 'utf8')) as VoteCase[];
    assert.ok(cases.length >= 500, `${cases.length} cases`);
    const wrong = cases.filter((c) => sorted(readVote(c.tex, c.kind, ctxOf(c.defs))) !== sorted(c.parses));
    assert.deepEqual(
        wrong.slice(0, 5).map((c) => `${c.kind}: ${c.tex}`),
        []
    );
    // every kind is in the fixture, with parses
    for (const k of CARD_KINDS) assert.ok(cases.some((c) => c.kind === k && c.parses.length), `no case of ${k}`);
});

// The frozen readers and the corpus (hover-ml): only on the machine that has them, so CI without them passes.
const SCRATCH = '/private/tmp/claude-501/-Users-justus-PycharmProjects-tikz-graph-help/d7060021-8494-476b-bf42-b1974d650603/scratchpad/hover-ml';
const FROZEN = `${SCRATCH}/readers-frozen/best.mjs`;
const CORPUS = ['train_r4', 'dev_r4', 'hard_dev_r4', 'r3_dev_r4', 'r4_dev'].map((f) => `${SCRATCH}/data/${f}.jsonl`);
const SUITE3 = `${SCRATCH}/designed3-frozen/suite.jsonl`;
const SUITE4 = `${SCRATCH}/designed4-frozen/suite.jsonl`;

interface Item {
    tex: string;
    label: string;
    defs?: string[];
    context?: string;
    note?: string | null;
}
type Frozen = { readAll: (tex: string, kind: string, ctx: ReadContext) => CardParse[] };
const readLines = (file: string) =>
    fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Item);

test('vote: the port gives the frozen best.mjs parses on the gap harness formulas and the suites, for the gold and the network kind (all 19 kinds on every 10th corpus formula; skipped without the corpus)', async () => {
    if (![FROZEN, ...CORPUS, SUITE3, SUITE4].every((f) => fs.existsSync(f))) {
        console.log('    (skipped: the hover-ml corpus or the frozen readers are not on this machine)');
        return;
    }
    const frozen = (await import(pathToFileURL(FROZEN).href)) as Frozen;
    const memo = new Map<string, ReadContext>();
    let calls = 0;
    let read = 0;
    const wrong: string[] = [];
    const same = (it: Item, kind: string) => {
        const key = JSON.stringify(it.defs ?? []);
        let ctx = memo.get(key);
        if (!ctx) memo.set(key, (ctx = ctxOf(it.defs)));
        calls++;
        const want = sorted(frozen.readAll(it.tex, kind, ctx));
        if (want !== '[]') read++;
        if (sorted(readVote(it.tex, kind, ctx)) !== want && wrong.length < 10) wrong.push(`${kind}: ${it.tex}`);
    };
    const kindsOf = (it: Item) => [...new Set([it.label, recognize(it.tex, { defs: it.defs ?? [], context: it.context ?? '', note: it.note ?? null })])].filter((k) => (CARD_KINDS as string[]).includes(k));
    CORPUS.flatMap(readLines).forEach((it, i) => {
        for (const k of i % 10 === 0 ? CARD_KINDS : kindsOf(it)) same(it, k);
    });
    for (const it of readLines(SUITE3)) for (const k of kindsOf(it)) same(it, k);
    readLines(SUITE4).forEach((it, i) => {
        if (i % 4 === 0) for (const k of kindsOf(it)) same(it, k);
    });
    console.log(`    ${calls} reads (${read} with parses), ${wrong.length} with other parses`);
    assert.ok(calls > 40000, `${calls} reads`);
    assert.deepEqual(wrong, []);
});

test('vote: the front end prints canonical TeX (one spelling per sign, sums with the lower bound first, sizes out)', () => {
    const canon = (tex: string) => {
        const F = front(tex);
        return print(F, 0, F.T.length - 1);
    };
    assert.equal(canon('\\displaystyle \\sum^n_{k=1} k'), '\\sum_{k = 1}^{n} k');
    assert.equal(canon('x \\leq 2 \\quad y \\geqslant 0'), 'x \\le 2 \\quad y \\ge 0');
    assert.equal(canon('\\left( a + b \\right)^2'), '(a + b)^2');
    assert.equal(canon('f(x) = x² − 1'), 'f(x) = x^2 - 1');
});

test('vote: two designs that agree beat one; the vote key reads \\tfrac12 and \\frac{1}{2}, \\le and \\leq, \\big alike', () => {
    const f = (body: string): CardParse => ({ kind: 'function', functions: [{ body }] });
    assert.equal(voteKey(f('\\tfrac12 x')), voteKey(f('\\frac12 x')));
    assert.equal(voteKey({ kind: 'condition', variable: 'x', condition: 'x \\leq 2' }), voteKey({ kind: 'condition', variable: 'x', condition: 'x \\le 2' }));
    assert.equal(voteKey(f('\\big( x \\big)')), voteKey(f('(x)')));
    assert.notEqual(voteKey(f('x^2')), voteKey(f('x^3')));
    // the parses of a plain formula: the one all three designs give leads
    assert.deepEqual(readVote('f(x) = x^2 - 4', 'function')[0], { kind: 'function', functions: [{ name: 'f', body: 'x^2 - 4' }] });
    assert.deepEqual(readVote('\\displaystyle \\sum^n_{k=1} k = \\frac{n(n+1)}{2}', 'sum')[0], { kind: 'sum', index: 'k', lower: '1', upper: 'n', body: 'k', value: '\\frac{n(n + 1)}{2}' });
});

test('Smart reader: the vote first, reader 0 after it, the same parse once; no formula loses a card that reader 0 draws (fixture)', () => {
    const cases = JSON.parse(fs.readFileSync('tests/readers-vote-fixture.json', 'utf8')) as VoteCase[];
    let r0 = 0;
    for (const c of cases) {
        const ctx = ctxOf(c.defs);
        const smart = smartReader.read(c.tex, c.kind, ctx);
        const vote = readVote(c.tex, c.kind, ctx);
        // the vote's parses lead, in their order
        assert.deepEqual(smart.slice(0, vote.length).map(sorted), vote.map(sorted), c.tex);
        // the same parse once
        const keys = smart.map((p) => JSON.stringify(p));
        assert.equal(new Set(keys).size, keys.length, c.tex);
        // a card of the kind that reader 0 builds, Smart builds too
        const ofKind = (list: CardParse[]) => list.some((p) => buildCard(p)?.kind === c.kind);
        if (ofKind(reader0.read(c.tex, c.kind, ctx))) {
            r0++;
            assert.ok(ofKind(smart), `${c.kind}: ${c.tex}`);
        }
    }
    assert.ok(r0 > 200, `${r0} cards of reader 0`);
});
