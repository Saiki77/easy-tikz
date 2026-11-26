/*
 * The reader of Smart (6.2.4): the voting reader first (src/readers/vote:
 * three hand-designed designs and their vote), reader 0 after it (the
 * regex readers of 6.2.1, src/readers/reader0.ts). The hover builds the
 * parses in order and the first card of the network's kind wins, so the
 * vote's robust parse leads, and a formula whose card only reader 0 reads
 * keeps it. Rules does not read parses (src/notes6/recognize/decide.ts).
 *
 * The parses of one formula are remembered (the hover asks for them on
 * every redraw of a note, for the dotted mark). Pure: no DOM, no Obsidian.
 */
import { reader0 } from './reader0';
import type { CardKind, CardParse, ReadContext, Reader } from './types';
import { readVote } from './vote';

/** The vote, then reader 0; the same parse once. */
function readSmart(tex: string, kind: CardKind, ctx: ReadContext): CardParse[] {
    const out: CardParse[] = [];
    const seen = new Set<string>();
    const add = (list: CardParse[]) => {
        for (const p of list) {
            const key = JSON.stringify(p);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(p);
        }
    };
    add(readVote(tex, kind, ctx));
    add(reader0.read(tex, kind, ctx));
    return out;
}

/** What decides a formula's parses: its kind, the formula, and what the readers read around it. */
function keyOf(tex: string, kind: CardKind, ctx: ReadContext): string {
    const functions = ctx.functions ? [...ctx.functions].sort().join(',') : '';
    const domains = ctx.domains ? [...ctx.domains].map(([k, v]) => `${k}=${v}`).join(',') : '';
    return `${kind}\u0000${tex}\u0000${ctx.block ?? ''}\u0000${ctx.row ?? ''}\u0000${functions}\u0000${domains}`;
}

const memo = new Map<string, CardParse[]>();

/** Smart's reader: the vote, then reader 0 (src/readers/types.ts: Reader). */
export const smartReader: Reader = {
    read(tex: string, kind: CardKind, ctx: ReadContext = {}): CardParse[] {
        const key = keyOf(tex, kind, ctx);
        const hit = memo.get(key);
        if (hit) return hit;
        const out = readSmart(tex, kind, ctx);
        if (memo.size > 4000) memo.clear();
        memo.set(key, out);
        return out;
    },
};
