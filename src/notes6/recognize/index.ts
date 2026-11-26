/*
 * Formula recognition (6.2): a small network, all of its weights written by
 * hand, decides whether a formula of a note gets a hover card and which
 * kind. One formula (TeX) and what is around it in, one of 19 labels out:
 * none, or the card of src/formula.ts (function, surface, polar, implicit,
 * region), src/notes6/hover.ts (set, map, condition, interval, jensen,
 * epigraph), src/linear/hover.ts (matrix, product, det, eigen) or
 * src/iterate/hover.ts (recurrence, sum, domain).
 *
 *   features.ts   the encoder: tokens, items, parts, 215 features of 0 or 1 per part
 *   net.ts        the generic forward pass (three hidden layers of clipped sums, a linear output)
 *   weights.ts    the weights as named units (data)
 *
 * A formula is cut into parts (\qquad, \Rightarrow, a word such as für):
 * the first part that earns a card decides; all parts none, none. About
 * 0.05 ms per formula. Pure: no DOM, no Obsidian.
 */
import { FEATURES, RecognizeContext, encode } from './features';
import { LABELS, Label, argmax, compile, forward } from './net';
import { SPEC } from './weights';

export type { RecognizeContext } from './features';
export type { Label } from './net';
export { LABELS } from './net';

let compiled: ReturnType<typeof compile> | null = null;
let act: Float32Array | null = null;

/** The card of a formula: the first of its parts that earns a card decides (as formulaLines does). */
export function recognize(tex: string, ctx: RecognizeContext = {}): Label {
    compiled ??= compile(SPEC, FEATURES);
    act ??= new Float32Array(compiled.size);
    let parts: Float32Array[];
    try {
        parts = encode(tex, ctx);
    } catch {
        // A formula the encoder cannot read gets no card.
        return 'none';
    }
    for (const x of parts) {
        const label = argmax(forward(compiled, x, act));
        if (label !== 0) return LABELS[label];
    }
    return 'none';
}

const memo = new Map<string, Label>();

/** recognize(), remembered per formula and what is around it (a note's formulas are asked again on every redraw). */
export function recognizeCached(tex: string, ctx: RecognizeContext, noteKey: string): Label {
    const k = `${noteKey}\u0000${ctx.note ?? ''}\u0000${ctx.context ?? ''}\u0000${tex}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const label = recognize(tex, ctx);
    if (memo.size > 4000) memo.clear();
    memo.set(k, label);
    return label;
}
