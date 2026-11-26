/*
 * Reader 0 (6.2.2): the regex readers of 6.2.1 as a Reader of
 * src/readers/types.ts. For a card kind, the formula's spellings for that
 * kind's builder (src/notes6/recognize/adapt.ts: the formula as written, its
 * spacing plain, each part, each side of a chain, the kind's own rewrites)
 * in order, each read by its group's regex reader:
 *
 *   chart     readChart (src/formula.ts); the block's row first, as Rules reads it
 *   notes6    readNotes6 (src/notes6/hover.ts)
 *   linear    readLinear (src/linear/hover.ts)
 *   iterate   readIterate (src/iterate/hover.ts)
 *   vector    readVector (src/linear/vector.ts)
 *
 * The parses come out in that order, the same parse once. The hover then
 * builds them in order (src/notes6/recognize/decide.ts): the cards are the
 * cards of 6.2.1. Pure: no DOM, no Obsidian.
 */
import { readChart } from '../formula';
import { readNotes6 } from '../notes6/hover';
import { readLinear } from '../linear/hover';
import { readIterate } from '../iterate/hover';
import { readVector } from '../linear/vector';
import { spellings } from '../notes6/recognize/adapt';
import { groupOfKind } from './build';
import type { CardKind, CardParse, ReadContext, Reader } from './types';

/** The parse of one spelling by its group's reader, or null. */
function readOne(tex: string, kind: CardKind): CardParse | null {
    try {
        switch (groupOfKind(kind)) {
            case 'chart':
                return readChart(tex);
            case 'notes6':
                return readNotes6(tex);
            case 'linear':
                return readLinear(tex);
            case 'iterate':
                return readIterate(tex);
            case 'vector':
                return readVector(tex);
        }
    } catch {
        return null;
    }
    return null;
}

/** Reader 0: the spellings of 6.2.1, each read by the regex reader of the kind's builder. */
export const reader0: Reader = {
    read(tex: string, kind: CardKind, ctx: ReadContext = {}): CardParse[] {
        const out: CardParse[] = [];
        const seen = new Set<string>();
        const add = (p: CardParse | null) => {
            if (!p) return;
            const key = JSON.stringify(p);
            if (seen.has(key)) return;
            seen.add(key);
            out.push(p);
        };
        const group = groupOfKind(kind);
        if (!group) return out;
        const all = spellings(tex, kind, ctx.functions, ctx.domains);
        if (group === 'chart') {
            // The formula as Rules reads it first: the block's row (or the formula), then the other spellings.
            try {
                add(readChart(ctx.block ?? tex, ctx.block !== undefined ? ctx.row : undefined));
            } catch {
                // no chart
            }
            for (const s of all.slice(1)) {
                let p = readOne(s.tex, kind);
                // A function renamed into x: the x-axis keeps the formula's letter (functionSpellings' axis).
                if (p && s.axis && p.kind === 'function' && !p.variable && !p.axes?.x) p = { ...p, variable: s.axis };
                add(p);
            }
            return out;
        }
        for (const s of all) add(readOne(s.tex, kind));
        return out;
    },
};
