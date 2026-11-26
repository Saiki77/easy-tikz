/*
 * The gap harness of the formula hover (6.2.2): the plugin's own pipeline
 * (recognition network, a reader, the builders) offline over the labelled
 * corpus and the robustness suite. scripts/readers/gap.mjs bundles this file
 * and runs main(); README.md there says what it counts. Node only.
 */
import * as fs from 'node:fs';
import { recognize } from '../../src/notes6/recognize';
import type { Label } from '../../src/notes6/recognize';
import { definedFunctions, noteDomains } from '../../src/notes6/recognize/adapt';
import { SmartContext, chartCard, smartCard, smartMark } from '../../src/notes6/recognize/decide';
import { hoverCard, noteDefinitions } from '../../src/notes6/hover';
import { linearHoverCard, noteValues } from '../../src/linear/hover';
import { NoteVector, vectorValues } from '../../src/linear/vector';
import { iterateHoverCard } from '../../src/iterate/hover';
import { parseChartText } from '../../src/text/parse';
import { BuiltCard, CARD_KINDS, buildCard, parseKey, texKey } from '../../src/readers/build';
import { reader0 } from '../../src/readers/reader0';
import type { CardKind, CardParse, ReadContext, Reader } from '../../src/readers/types';

/** A formula of the corpus or the suite (the fields the harness reads). */
export interface Item {
    id: string;
    tex: string;
    label: string;
    defs?: string[];
    context?: string;
    note?: string | null;
    /** Suite only: keep (the label stays) or change, the plain spelling, the variant's family. */
    kind?: string;
    base?: string;
    variant?: string;
    /** The file it came from (set by the harness). */
    file?: string;
}

/** A gold parse: the card a careful reader would chart for a formula of the corpus, as a parse. */
export interface Gold {
    id: string;
    label: CardKind;
    parse: CardParse;
    checked?: boolean;
    fixed?: string;
}

/** The options of gap.mjs (see README.md). */
export interface Options {
    reader: string | null;
    readerName: string;
    corpus: string[];
    suite: string | null;
    gold: string | null;
    expected: string | null;
    json: string | null;
    limit: number;
    stride: number;
    examples: number;
    kinds: string[];
    writeGold: string | null;
    quiet: boolean;
}

/** A reader module as gap.mjs loads it: read(tex, kind, ctx), a `reader` object, or a default export; one parse or a list. */
type ReaderModule = Record<string, unknown>;

export function readerOf(mod: ReaderModule | null): Reader {
    if (!mod) return reader0;
    const pick = (o: unknown): ((tex: string, kind: CardKind, ctx?: ReadContext) => unknown) | null => {
        if (typeof o === 'function') return o as (tex: string, kind: CardKind, ctx?: ReadContext) => unknown;
        if (o && typeof o === 'object' && typeof (o as { read?: unknown }).read === 'function') {
            const r = o as Reader;
            return (tex, kind, ctx) => r.read(tex, kind, ctx);
        }
        return null;
    };
    const fn = pick(mod.read) ?? pick(mod.reader) ?? pick(mod.default);
    if (!fn) throw new Error('the reader module exports no read(tex, kind, ctx), reader or default');
    return {
        read(tex, kind, ctx) {
            const r = fn(tex, kind, ctx);
            if (!r) return [];
            return (Array.isArray(r) ? r : [r]).filter((p): p is CardParse => !!p && typeof p === 'object' && typeof (p as CardParse).kind === 'string');
        },
    };
}

export function readJsonl<T>(file: string): T[] {
    return fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as T);
}

/** What a note defines, worked out once per list of defining formulas. */
interface NoteFacts {
    ctx: SmartContext;
    vectors: Map<string, NoteVector>;
}

const facts = new Map<string, NoteFacts>();

function noteOf(it: Item): NoteFacts {
    const defs = it.defs ?? [];
    const key = JSON.stringify(defs);
    let f = facts.get(key);
    if (!f) {
        const vectors = vectorValues(defs);
        f = { ctx: { definitions: noteDefinitions(defs), values: noteValues(defs), vectors, domains: noteDomains(defs), functions: definedFunctions(defs) }, vectors };
        facts.set(key, f);
    }
    return f;
}

const recognizeCtx = (it: Item) => ({ defs: it.defs ?? [], context: it.context ?? '', note: it.note ?? null });

const parses = (lines: string[]) => parseChartText(lines.join('\n')).problems.length === 0;

/** Does Rules (the fall back of Smart) open a card for the formula? chart, iterate, notes6, linear, as src/ui/formulaHover.ts. */
function rulesCard(it: Item): boolean {
    const n = noteOf(it).ctx;
    try {
        if (chartCard(it.tex)) return true;
        const iterate = iterateHoverCard(it.tex);
        if (iterate && parses(iterate.lines)) return true;
        const sets = hoverCard(it.tex, new Map(n.definitions ?? []));
        if (sets && parses(sets.lines)) return true;
        const linear = linearHoverCard(it.tex, new Map(n.values ?? []));
        if (linear && parses(linear.lines)) return true;
    } catch {
        return false;
    }
    return false;
}

/** The Smart card of a formula for a label, with the parse it came from. */
function cardFor(it: Item, label: Label, reader: Reader): { card: BuiltCard; parse: CardParse } | null {
    if (label === 'none') return null;
    const n = noteOf(it);
    try {
        return smartCard(it.tex, label, { ...n.ctx, defs: it.defs ?? [], context: it.context ?? '', note: it.note ?? null }, reader);
    } catch {
        return null;
    }
}

/** A chart line as compared: its words as they are, each formula in it ($...$) as texKey writes it. */
const lineKey = (l: string) => l.replace(/\$([^$]*)\$/g, (_m: string, f: string) => `$${texKey(f)}$`).replace(/\s+/g, ' ');
/** The card lines as compared. */
const linesKey = (c: BuiltCard) => JSON.stringify([c.kind, c.lines.map(lineKey), (c.lines2 ?? []).map(lineKey)]);

/** Does a card from `parse` draw what the gold parse draws? The same parse, or the same card lines. */
function agrees(it: Item, got: { card: BuiltCard; parse: CardParse }, gold: CardParse): boolean {
    if (parseKey(got.parse) === parseKey(gold)) return true;
    const want = buildCard(gold, noteOf(it).ctx);
    return !!want && linesKey(want) === linesKey(got.card);
}

/** The false cards: gold none, and the network gives a card (the reader's, a card with the fall back to Rules, a dotted mark). */
export interface FalseCards {
    goldNone: number;
    netCard: number;
    smart: number;
    shown: number;
    marked: number;
}

/** The counts of one kind (README.md says what each is). */
export interface KindStats {
    gold: number;
    net: number;
    a: number;
    aOther: number;
    aRules: number;
    b: number;
    noGold: number;
    // suite
    variants: number;
    vNet: number;
    cNone: number;
    cWrong: number;
}

const blank = (): KindStats => ({ gold: 0, net: 0, a: 0, aOther: 0, aRules: 0, b: 0, noGold: 0, variants: 0, vNet: 0, cNone: 0, cWrong: 0 });

/** One failure of the reader: its category (a, a.other, b, c.none, c.wrong), the parse it gave and the gold one. */
export interface Failure {
    id: string;
    kind: string;
    cat: string;
    tex: string;
    shown?: string;
    parse?: CardParse;
    gold?: CardParse;
    lines?: string[];
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');

function loadCorpus(o: Options): Item[] {
    const out: Item[] = [];
    for (const f of o.corpus) for (const it of readJsonl<Item>(f)) out.push({ ...it, file: f.split('/').pop() });
    return out;
}

/** Every `stride`-th item, at most `limit` (0: all). */
function subset<T>(list: T[], o: Options): T[] {
    const s = o.stride > 1 ? list.filter((_x, i) => i % o.stride === 0) : list;
    return o.limit > 0 ? s.slice(0, o.limit) : s;
}

/** Write the gold parses of reader 0 (with the hand review merged in) to o.writeGold. */
function writeGold(o: Options, corpus: Item[]): void {
    const dir = o.writeGold as string;
    fs.mkdirSync(dir, { recursive: true });
    const reviewFile = `${dir}/review.jsonl`;
    const review = new Map<string, { id: string; verdict: string; parse?: CardParse; note?: string }>();
    if (fs.existsSync(reviewFile)) for (const r of readJsonl<{ id: string; verdict: string; parse?: CardParse; note?: string }>(reviewFile)) review.set(r.id, r);
    const gold: string[] = [];
    const missing: string[] = [];
    const goldById = new Map<string, CardParse>();
    for (const it of corpus) {
        if (it.label === 'none' || !(CARD_KINDS as string[]).includes(it.label)) continue;
        const label = it.label as CardKind;
        const network = recognize(it.tex, recognizeCtx(it));
        const hit = cardFor(it, label, reader0);
        const r = review.get(it.id);
        const base = { id: it.id, file: it.file, tex: it.tex, label, network, note: it.note ?? null, context: it.context ?? '', defs: it.defs ?? [] };
        if (r && r.verdict === 'fixed' && r.parse) {
            // A parse fixed by hand: its card as the builders draw it.
            const card = buildCard(r.parse, noteOf(it).ctx);
            gold.push(JSON.stringify({ ...base, parse: r.parse, lines: card ? card.lines : null, checked: true, fixed: r.note ?? 'fixed by hand', reader0: hit && hit.card.kind === label ? hit.parse : null }));
            goldById.set(it.id, r.parse);
            continue;
        }
        if (hit && hit.card.kind === label) {
            // det of a written matrix: reader 0 reads the matrix (its card, named det); the gold parse is the det's.
            const parse: CardParse = label === 'det' && hit.parse.kind === 'matrix' ? { kind: 'det', entries: hit.parse.entries } : hit.parse;
            gold.push(JSON.stringify({ ...base, parse, lines: hit.card.lines, ...(r ? { checked: true, ...(r.verdict !== 'ok' ? { doubt: r.note ?? r.verdict } : {}) } : {}) }));
            if (!r || r.verdict === 'ok') goldById.set(it.id, parse);
            continue;
        }
        let read: CardParse[] = [];
        try {
            read = reader0.read(it.tex, label, { ...noteOf(it).ctx });
        } catch {
            read = [];
        }
        missing.push(JSON.stringify({ ...base, shown: hit ? { kind: hit.card.kind, parse: hit.parse } : null, reader0: read.slice(0, 4) }));
    }
    fs.writeFileSync(`${dir}/gold.jsonl`, gold.join('\n') + '\n');
    fs.writeFileSync(`${dir}/missing.jsonl`, missing.join('\n') + '\n');
    let expected = 0;
    if (o.suite && fs.existsSync(o.suite)) {
        const lines: string[] = [];
        const baseMemo = new Map<string, CardParse | null>();
        const inCorpus = new Set(corpus.map((c) => c.id));
        for (const it of readJsonl<Item>(o.suite)) {
            if (it.kind !== 'keep' || it.label === 'none' || !(CARD_KINDS as string[]).includes(it.label)) continue;
            const baseId = it.id.split('~')[0];
            let parse = goldById.get(baseId) ?? null;
            let source = 'gold';
            // A corpus formula without a gold parse has no expected parse; a seed of the suite (no corpus formula)
            // takes reader 0's parse of its plain spelling.
            if (!parse && !inCorpus.has(baseId)) {
                const key = `${it.label}\u0000${it.base}\u0000${JSON.stringify(it.defs ?? [])}`;
                if (!baseMemo.has(key)) {
                    const hit = cardFor({ ...it, tex: it.base ?? '' }, it.label as Label, reader0);
                    baseMemo.set(key, hit && hit.card.kind === it.label ? hit.parse : null);
                }
                parse = baseMemo.get(key) ?? null;
                source = 'reader0-base';
            }
            if (!parse) continue;
            lines.push(JSON.stringify({ id: it.id, base: baseId, variant: it.variant, tex: it.tex, label: it.label, parse, source }));
            expected++;
        }
        fs.writeFileSync(`${dir}/suite-expected.jsonl`, lines.join('\n') + '\n');
    }
    console.log(`gold parses ${gold.length}, missing ${missing.length}, suite expected ${expected}: ${dir}`);
}

/** What measure counts: per kind, the false cards, every failure, the time per card. */
export interface Measured {
    stats: Map<string, KindStats>;
    falseCards: FalseCards;
    fails: Failure[];
    msPerCard: number;
}

/**
 * Measure a reader: the corpus formulas (gold labels) against their gold
 * parses, the suite variants (label-keeping) against the expected parses of
 * their plain spellings. Pure apart from the time.
 */
export function measure(reader: Reader, corpus: Item[], gold: ReadonlyMap<string, CardParse>, suite: Item[], expected: ReadonlyMap<string, CardParse>, kinds: readonly string[] = CARD_KINDS): Measured {
    const stats = new Map<string, KindStats>(CARD_KINDS.map((k) => [k, blank()]));
    const fails: Failure[] = [];
    const falseCards: FalseCards = { goldNone: 0, netCard: 0, shown: 0, marked: 0, smart: 0 };
    let readMs = 0;
    let reads = 0;
    const timed = (it: Item, label: Label) => {
        const t0 = performance.now();
        const hit = cardFor(it, label, reader);
        readMs += performance.now() - t0;
        reads++;
        return hit;
    };
    for (const it of corpus) {
        const label = recognize(it.tex, recognizeCtx(it));
        if (it.label === 'none') {
            falseCards.goldNone++;
            if (label === 'none') continue;
            falseCards.netCard++;
            const hit = timed(it, label);
            if (hit) falseCards.smart++;
            if (hit || rulesCard(it)) falseCards.shown++;
            const n = noteOf(it);
            if (smartMark(it.tex, undefined, it.tex, label, n.ctx.functions, () => n.vectors, reader)) falseCards.marked++;
            continue;
        }
        const s = stats.get(it.label);
        if (!s || !kinds.includes(it.label)) continue;
        s.gold++;
        if (label !== it.label) continue;
        s.net++;
        const hit = timed(it, label);
        const want = gold.get(it.id);
        if (!want) s.noGold++;
        if (!hit || hit.card.kind !== it.label) {
            s.a++;
            if (hit) s.aOther++;
            else if (rulesCard(it)) s.aRules++;
            fails.push({ id: it.id, kind: it.label, cat: hit ? 'a.other' : 'a', tex: it.tex, ...(hit ? { shown: hit.card.kind, parse: hit.parse } : {}), ...(want ? { gold: want } : {}) });
            continue;
        }
        if (want && !agrees(it, hit, want)) {
            s.b++;
            fails.push({ id: it.id, kind: it.label, cat: 'b', tex: it.tex, parse: hit.parse, gold: want, lines: hit.card.lines });
        }
    }
    // The suite: label-keeping variants whose plain spelling has a gold parse (suite-expected.jsonl).
    {
        for (const it of suite) {
            if (!kinds.includes(it.label)) continue;
            const s = stats.get(it.label);
            const want = expected.get(it.id);
            if (!s || !want) continue;
            s.variants++;
            const label = recognize(it.tex, recognizeCtx(it));
            if (label !== it.label) continue;
            s.vNet++;
            const hit = timed(it, label);
            if (!hit || hit.card.kind !== it.label) {
                s.cNone++;
                fails.push({ id: it.id, kind: it.label, cat: 'c.none', tex: it.tex, gold: want, ...(hit ? { shown: hit.card.kind, parse: hit.parse } : {}) });
            } else if (!agrees(it, hit, want)) {
                s.cWrong++;
                fails.push({ id: it.id, kind: it.label, cat: 'c.wrong', tex: it.tex, parse: hit.parse, gold: want });
            }
        }
    }
    return { stats, falseCards, fails, msPerCard: readMs / Math.max(1, reads) };
}

export async function main(mod: ReaderModule | null, o: Options): Promise<void> {
    const reader = readerOf(mod);
    const corpus = loadCorpus(o);
    if (o.writeGold) {
        writeGold(o, corpus);
        return;
    }
    const kinds = o.kinds.length ? o.kinds : (CARD_KINDS as string[]);
    const gold = new Map<string, CardParse>();
    if (o.gold && fs.existsSync(o.gold)) for (const g of readJsonl<Gold & { doubt?: string }>(o.gold)) if (!g.doubt) gold.set(g.id, g.parse);
    const expected = new Map<string, CardParse>();
    let suite: Item[] = [];
    if (o.expected && fs.existsSync(o.expected) && o.suite && fs.existsSync(o.suite)) {
        for (const e of readJsonl<{ id: string; parse: CardParse }>(o.expected)) expected.set(e.id, e.parse);
        suite = subset(readJsonl<Item>(o.suite).filter((it) => expected.has(it.id)), o);
    }
    const m = measure(reader, subset(corpus, o), gold, suite, expected, kinds);
    report(o, m.stats, m.falseCards, m.fails, m.msPerCard);
}

function report(o: Options, stats: Map<string, KindStats>, falseCards: FalseCards, fails: Failure[], msPerCard: number): void {
    const rows = [...stats.entries()].filter(([, s]) => s.gold || s.variants);
    const total = rows.reduce((t, [, s]) => {
        for (const k of Object.keys(t) as (keyof KindStats)[]) t[k] += s[k];
        return t;
    }, blank());
    const head = ['kind', 'gold', 'net=K', 'a', 'a%', 'other', 'rules', 'b', 'b%', 'nogold', 'variants', 'net=K', 'c.none', 'c.wrong', 'c%'];
    const line = (k: string, s: KindStats) => [k, s.gold, s.net, s.a, pct(s.a, s.net), s.aOther, s.aRules, s.b, pct(s.b, s.net), s.noGold, s.variants, s.vNet, s.cNone, s.cWrong, pct(s.cNone + s.cWrong, s.vNet)].map(String);
    const table = [head, ...rows.map(([k, s]) => line(k, s)), line('all', total)];
    const widths = head.map((_h, i) => Math.max(...table.map((r) => r[i].length)));
    console.log(`reader: ${o.readerName}`);
    for (const r of table) console.log(r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  '));
    console.log(`false cards (gold none ${falseCards.goldNone}): network gives a card ${falseCards.netCard}, the reader's card ${falseCards.smart}, a card shows (with the rules) ${falseCards.shown}, marked ${falseCards.marked}`);
    console.log(`${msPerCard.toFixed(3)} ms per card (reader and builder)`);
    if (o.examples > 0) {
        for (const cat of ['a', 'a.other', 'b', 'c.none', 'c.wrong']) {
            const list = fails.filter((f) => f.cat === cat);
            if (!list.length) continue;
            console.log(`--- ${cat} (${list.length})`);
            for (const k of CARD_KINDS) {
                for (const f of list.filter((x) => x.kind === k).slice(0, o.examples)) {
                    console.log(`  ${k.padEnd(10)} ${f.id}  ${f.tex.replace(/\s+/g, ' ').slice(0, 110)}${f.shown ? `  [shows ${f.shown}]` : ''}`);
                    if (f.parse && !o.quiet) console.log(`             got  ${JSON.stringify(f.parse).slice(0, 200)}`);
                    if (f.gold && !o.quiet && f.cat !== 'a') console.log(`             gold ${JSON.stringify(f.gold).slice(0, 200)}`);
                }
            }
        }
    }
    if (o.json) {
        const out = { reader: o.readerName, kinds: Object.fromEntries(rows), total, falseCards, msPerCard, failures: fails };
        fs.writeFileSync(o.json, JSON.stringify(out, null, 1));
        console.log(`written ${o.json}`);
    }
}
