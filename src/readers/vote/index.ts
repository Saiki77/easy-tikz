/*
 * The voting reader of the formula hover (6.2.4): three designs, one
 * answer, all weights set by hand (hover-ml readers, the frozen best.mjs,
 * ported line by line):
 *
 *   front (once) ──► design A (token tagger network, designA.ts)      ──► adapt ──► parses A
 *                ──► design B (structure network on a tree, designB.ts) ──► adapt ──► parses B
 *                ──► design C (canonical forms and templates, designC.ts) ──► adapt ──► parses C
 *
 * The vote: a parse gets, from every design that gives it, the weight of
 * the design (A 1.0, B 1.1, C 1.2) times 0.45 to the power of its rank in
 * that design's list; parses are the same when their vote key is (key.ts).
 * The parses come out by score, the best first: two designs that agree
 * beat one. After the asked kind's own parses, those of the kinds next to
 * it (det: also the written matrix). A vector is read by the plugin's value
 * reader (src/linear/vector.ts) on three spellings of the formula.
 *
 * The frozen best.mjs also takes ctx.check and ctx.reader0; the plugin does
 * not need them (the hover builds the parses in order, and src/readers/smart.ts
 * puts reader 0 after the vote). Pure: no DOM, no Obsidian.
 */
import { readVector } from '../../linear/vector';
import type { CardParse, ConditionParse, ReadContext, Reader, CardKind } from '../types';
import { AdaptContext, adapt, setCurve } from './adapt';
import { readA } from './designA';
import { readB } from './designB';
import { readC } from './designC';
import { Front, front, prenorm, print } from './front';
import type { Internal } from './internal';
import { voteKey } from './key';

type Design = 'A' | 'B' | 'C';

const DESIGNS: Record<Design, (tex: string, kind: string, F: Front) => Internal | null> = {
    A: readA,
    B: readB,
    C: (tex, kind, F) => readC(tex, kind, F),
};

/** How much the first parse of a design counts, per kind. Two designs that agree beat any single one. */
const WEIGHT: Record<string, Record<Design, number>> = {
    default: { A: 1.0, B: 1.1, C: 1.2 },
};
/** A parse at rank r of a design counts RANK_DECAY^r of its first. */
const RANK_DECAY = 0.45;
/** The kinds whose parses follow the asked kind's own (the same builder shows them). */
const NEXT_KINDS: Record<string, string[]> = {
    det: ['matrix'],
};

/** The parses of one design (A, B or C) for a kind, best first. */
export function readDesign(d: Design, tex: string, kind: string, ctx: AdaptContext, F0?: Front): CardParse[] {
    const F = F0 ?? front(tex);
    if (!F.T.length) return [];
    if (kind === 'vector') return vectorParses(d, tex, F);
    let out = adapt(kind, DESIGNS[d](tex, kind, F), ctx);
    if (kind === 'condition' && out.length) out = [...andConditions(out[0] as ConditionParse, F), ...out];
    // a set of pairs with one equation: its curve
    if (!out.length && (kind === 'implicit' || kind === 'function')) return setCurve(kind, DESIGNS[d](tex, 'set', F) ?? {});
    return out;
}

/**
 * More conditions on the same variable after a comma (x \ge 0, x \ne 4): all of them, joined by "and" as the card
 * reads it. Returns the joined parse, or nothing.
 */
function andConditions(p: ConditionParse, F: Front): ConditionParse[] {
    const whole = print(F, 0, F.T.length - 1);
    const pieces = whole.split(/\s*,\s*(?:\\quad\s*)?/);
    if (pieces.length < 2 || pieces.length > 4) return [];
    const flat = (t: string) => t.replace(/\s+/g, '');
    if (flat(pieces[0]) !== flat(p.condition)) return [];
    const v = p.variable.replace(/[\\{}]/g, (c) => '\\' + c);
    const rest = pieces.slice(1);
    const one = new RegExp(`^${v}\\s*(?:<|>|\\\\le|\\\\ge|\\\\ne)\\s*[-+0-9.,{}\\\\a-zA-Z ]+$`);
    if (!rest.every((r) => one.test(r) && !/\\(?:text|quad|in)(?![A-Za-z])/.test(r))) return [];
    return [{ ...p, condition: [p.condition, ...rest].join(' \\text{ and } ') }];
}

/**
 * A vector: the value reader of the plugin (src/linear/vector.ts) on three spellings of the formula: as written (A),
 * with the front end's spelling fixes (B), in canonical form (C).
 */
function vectorParses(d: Design, tex: string, F: Front): CardParse[] {
    let src = tex;
    if (d === 'B') src = prenorm(tex).replace(/\\(?:displaystyle|textstyle|limits)(?![A-Za-z])/g, ' ');
    // canonical: a bar between entries as written, a logic sign cuts as \qquad does (the vector after \Rightarrow is a statement of its own)
    if (d === 'C')
        src = print(F, 0, F.T.length - 1)
            .replace(/ \\mid /g, ' | ')
            .replace(/\\quad|\\Rightarrow|\\iff/g, '\\qquad');
    // the alignment sign of a row is layout
    if (d !== 'A' && !/\\begin/.test(src)) src = src.replace(/(^|[^\\])&/g, '$1 ');
    try {
        // a remark after the vector is no part of it: "... ; \text{ for all } x"
        if (d !== 'A') {
            const cut = src.search(/[;,]?\s*\\text\s*\{/);
            if (cut > 0) {
                const p = readVector(src.slice(0, cut));
                if (p) return [p];
            }
        }
        const p = readVector(src);
        return p ? [p] : [];
    } catch {
        return [];
    }
}

/** One parse in the vote: its score, how many designs gave it, and when it first came. */
interface Tally {
    p: CardParse;
    score: number;
    votes: number;
    order: number;
}

function vote(tex: string, kind: string, ctx: AdaptContext, F: Front): Tally[] {
    const tally = new Map<string, Tally>();
    let order = 0;
    for (const d of ['A', 'B', 'C'] as Design[]) {
        const w = (WEIGHT[kind] ?? WEIGHT.default)[d];
        if (!w) continue;
        const list = readDesign(d, tex, kind, ctx, F);
        list.forEach((p, rank) => {
            const key = voteKey(p);
            const hit = tally.get(key);
            const score = w * Math.pow(RANK_DECAY, rank);
            if (hit) {
                hit.score += score;
                hit.votes++;
            } else tally.set(key, { p, score, votes: 1, order: order++ });
        });
    }
    return [...tally.values()].sort((a, b) => b.score - a.score || a.order - b.order);
}

/** The parses of a formula for a card kind, best first (the vote of the three designs). */
export function readVote(tex: string, kind: string, ctx: ReadContext = {}): CardParse[] {
    let out: CardParse[] = [];
    try {
        const F = front(tex);
        if (F.T.length) {
            out = vote(tex, kind, ctx, F).map((x) => x.p);
            // the kinds next to the asked one, after its own parses
            for (const k of NEXT_KINDS[kind] ?? []) for (const x of vote(tex, k, ctx, F)) if (x.votes >= 2 || !out.length) out.push(x.p);
        }
    } catch {
        out = [];
    }
    return out;
}

/** The voting reader as a Reader of src/readers/types.ts. */
export const voteReader: Reader = {
    read(tex: string, kind: CardKind, ctx: ReadContext = {}): CardParse[] {
        return readVote(tex, kind, ctx);
    },
};
