/*
 * Formula recognition (6.2): a small network, all of its weights written by
 * hand, decides whether a formula of a note gets a hover card and which
 * kind. One formula (TeX) and what is around it in, one of 20 labels out:
 * none, or the card of src/formula.ts (function, surface, polar, implicit,
 * region), src/notes6/hover.ts (set, map, condition, interval, jensen,
 * epigraph), src/linear/hover.ts (matrix, product, det, eigen),
 * src/iterate/hover.ts (recurrence, sum, domain) or, 6.2.1,
 * src/linear/vector.ts (vector). 6.2.4: the network of round 4 of the design
 * (hover-ml designed4, the circuit best.mjs), ported line by line:
 *
 *   normalize.ts  the front end: canonical TeX (layout commands, comments, Unicode, sloppy spellings, a unit at the end,
 *                 v⃗, \R, ^\mathsf{T}, [[1, 2], [3, 4]]), and the flags prose, unreadable, rowCont
 *   features.ts   the encoder: tokens, items, parts, 305 features of 0 or 1 per part; round 3 reads written vectors
 *                 (columns, transposed tuples, \binom, angle brackets), set builders with ; : \middle| and words, a set
 *                 of pairs with one equation as that equation (a curve), and the note's vectors, matrices and domains;
 *                 round 4 reads the context line: the role word nearest before the formula (vector, point, value), the
 *                 other formulas there as facts about the note's program (x and y in a constraint, x a vector, x_3),
 *                 switches (letters in {0, 1}, Big-M), names with indices (x^1 to x^7), and the developer's rule C1 to
 *                 C3 (a bare expression in one small letter is a function)
 *   net.ts        the generic forward pass (four hidden layers of clipped sums, a linear output)
 *   weights.ts    the weights as named units (data): 134 units
 *
 * A formula is cut into parts (\qquad, \Rightarrow, a word such as für, a
 * list of statements, a chain f(x) = A = B): the first part that earns a
 * card decides; a side part (after für, in a bracket at the end) never
 * gives a card when a main part stands before it; all parts none, none.
 * About 0.08 ms per formula. Pure: no DOM, no Obsidian.
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

/**
 * recognize(), remembered per formula and what is around it (a note's
 * formulas are asked again on every redraw): `key` names the note's version
 * and the formula's block (what decides its definitions).
 */
export function recognizeCached(tex: string, ctx: RecognizeContext, key: string): Label {
    const k = `${key}\u0000${ctx.note ?? ''}\u0000${ctx.context ?? ''}\u0000${tex}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const label = recognize(tex, ctx);
    if (memo.size > 4000) memo.clear();
    memo.set(k, label);
    return label;
}
