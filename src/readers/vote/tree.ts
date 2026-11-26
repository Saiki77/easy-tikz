/*
 * The parse tree of a formula, for design B of the voting readers (6.2.4),
 * built from the tokens of front.ts. A port of the frozen tree.mjs
 * (hover-ml readers), line by line.
 *
 *   formula ─ part* (cut at \quad, a logic sign, a word, a row break; the cuts stay as 'cut' nodes)
 *   part    ─ stmt* (cut at , and ; of the top level; the separators stay in part.seps)
 *   stmt    ─ side* with the relation tokens between them (stmt.rels)
 *   side    ─ factor*: atom, grp, frac, sqrt, binom, fn, big, det, env, op, text, bang
 *   grp     ─ a bracket pair with a part inside; env ─ rows of cells, each cell a side
 *
 * Every node has its token span [i, j]. A factor keeps its scripts: sub and
 * sup (nodes of type side), primes, acc. The tree takes no decision about a
 * role. It is null when the brackets do not match. Pure: no DOM, no Obsidian.
 */
import { Front, Tok, argEnd, argPair } from './front';

/** A node of the tree. Design B adds its state (S) and its links (parent, callee, callArg, inScript). */
export interface TNode {
    type: string;
    i: number;
    j: number;
    kids?: TNode[];
    /** A value: an atom's letter (null for an accent around more than one atom), a cut's word or sign, an operator. */
    v?: string | null;
    /** An atom's token class, a cut's token class. */
    k?: string;
    /** A part's separators (token indexes). */
    seps?: number[];
    /** A statement's relations (token indexes). */
    rels?: number[];
    /** A bracket group's opening and closing bracket. */
    br?: string;
    cl?: string;
    /** An environment's rows of cells. */
    rows?: TNode[][];
    /** A set builder's cut (bar or colon) and all its bars. */
    cutAt?: number;
    bars?: number[];
    /** An accent atom: the accent and the side under it. */
    acc?: string;
    inner?: TNode | null;
    font?: string;
    sub?: TNode;
    sup?: TNode;
    primes?: number;
    // design B
    parent?: TNode | null;
    S?: Set<string>;
    callee?: boolean;
    callArg?: boolean;
    inScript?: boolean;
}

const CUT = new Set(['wsp', 'log', 'text', 'row']);

/** The tree of a front, or null (brackets that do not match, no tokens). */
export function buildTree(F: Front): TNode | null {
    const { T, mate, arg, ok } = F;
    if (!ok || !T.length) return null;
    const N = (type: string, i: number, j: number, more: Partial<TNode>): TNode => ({ type, i, j, ...more });

    /** The indexes in [i, j] at the level of the span where test holds. */
    const topIdx = (i: number, j: number, test: (t: Tok, q: number) => boolean): number[] => {
        const out: number[] = [];
        for (let q = i; q <= j; q++) {
            const t = T[q];
            if (test(t, q)) out.push(q);
            if ((t.k === 'open' || t.k === 'lb' || t.k === 'beg') && mate[q] > q) q = mate[q];
            else if (t.k === 'sub' || t.k === 'sup') q = Math.max(q, arg[q] as number);
            else if (t.k === 'frac' || t.k === 'binom') q = Math.max(q, (arg[q] as [number, number])[1]);
            else if (t.k === 'sqrt' || t.k === 'acc') q = Math.max(q, arg[q] as number);
        }
        return out;
    };
    const splitAt = (i: number, j: number, cuts: number[]): Array<[number, number]> => {
        const spans: Array<[number, number]> = [];
        let from = i;
        for (const c of cuts) {
            spans.push([from, c - 1]);
            from = c + 1;
        }
        spans.push([from, j]);
        return spans;
    };

    function formula(i: number, j: number): TNode {
        const cuts = topIdx(i, j, (t) => CUT.has(t.k));
        const kids: TNode[] = [];
        splitAt(i, j, cuts).forEach(([a, b], q) => {
            if (a <= b) kids.push(part(a, b));
            if (q < cuts.length) kids.push(N('cut', cuts[q], cuts[q], { v: T[cuts[q]].k === 'text' ? T[cuts[q]].v : T[cuts[q]].k === 'log' ? T[cuts[q]].v : T[cuts[q]].k, k: T[cuts[q]].k }));
        });
        return N('formula', i, j, { kids });
    }
    function part(i: number, j: number): TNode {
        const cuts = topIdx(i, j, (t) => t.k === 'sep' && (t.v === ',' || t.v === ';'));
        const kids = splitAt(i, j, cuts)
            .filter(([a, b]) => a <= b)
            .map(([a, b]) => stmt(a, b));
        return N('part', i, j, { kids, seps: cuts });
    }
    function stmt(i: number, j: number): TNode {
        const rels = topIdx(i, j, (t) => t.k === 'rel');
        const sides = splitAt(i, j, rels).map(([a, b]) => side(a, b));
        return N('stmt', i, j, { kids: sides, rels });
    }
    /** The inside of a bracket: a part, with a head and a condition when a bar or a colon cuts it (a set builder). */
    function inside(i: number, j: number): TNode {
        if (i > j) return N('part', i, j, { kids: [], seps: [] });
        const bars = topIdx(i, j, (t) => t.k === 'sep' && (t.v === '|' || t.v === ':'));
        if (bars.length) {
            const c = bars[0];
            return N('builder', i, j, { kids: [part(i, c - 1), part(c + 1, j)], cutAt: c, bars });
        }
        return part(i, j);
    }
    function script(q: number): TNode {
        // the argument of the script token q, without its group braces
        let a = q + 1;
        let b = argEnd(F, q);
        if (T[a] && T[a].k === 'lb' && mate[a] === b) {
            a++;
            b--;
        }
        return inside(a, b);
    }
    function side(i: number, j: number): TNode {
        const kids: TNode[] = [];
        for (let q = i; q <= j; ) {
            const t = T[q];
            let node: TNode;
            let next = q + 1;
            if (t.k === 'open') {
                const e = mate[q] > q && mate[q] <= j ? mate[q] : j;
                node = N('grp', q, e, { br: t.v, cl: T[e].v, kids: [inside(q + 1, mate[q] > q && mate[q] <= j ? e - 1 : e)] });
                next = e + 1;
            } else if (t.k === 'lb') {
                const e = mate[q] > q && mate[q] <= j ? mate[q] : j;
                node = N('grp', q, e, { br: '{', cl: '}', kids: [inside(q + 1, e - 1)] });
                next = e + 1;
            } else if (t.k === 'beg') {
                const e = mate[q] > q && mate[q] <= j ? mate[q] : j;
                const rowCuts = topIdx(q + 1, e - 1, (x) => x.k === 'row');
                const rows = splitAt(q + 1, e - 1, rowCuts)
                    .filter(([a, b]) => a <= b)
                    .map(([a, b]) => splitAt(a, b, topIdx(a, b, (x) => x.k === 'amp')).map(([c, d]) => side(c, d)));
                node = N('env', q, e, { v: t.v, rows });
                next = e + 1;
            } else if (t.k === 'frac' || t.k === 'binom') {
                const [e1, e2] = argPair(F, q);
                const un = (a: number, b: number) => (T[a] && T[a].k === 'lb' && mate[a] === b ? side(a + 1, b - 1) : side(a, b));
                node = N(t.k, q, Math.min(e2, j), { kids: [un(q + 1, e1), un(e1 + 1, Math.min(e2, j))] });
                next = Math.min(e2, j) + 1;
            } else if (t.k === 'sqrt') {
                const e = Math.min(argEnd(F, q), j);
                let a = q + 1;
                if (T[a] && T[a].k === 'open' && T[a].v === '[' && mate[a] > 0) a = mate[a] + 1;
                node = N('sqrt', q, e, { kids: [T[a] && T[a].k === 'lb' && mate[a] === e ? side(a + 1, e - 1) : side(a, e)] });
                next = e + 1;
            } else if (t.k === 'acc') {
                // an accent with its argument: one atom
                const e = Math.min(argEnd(F, q), j);
                let a = q + 1;
                let b = e;
                if (T[a] && T[a].k === 'lb' && mate[a] === b) {
                    a++;
                    b--;
                }
                const inner = a <= b ? side(a, b) : null;
                const only = inner && (inner.kids as TNode[]).length === 1 ? (inner.kids as TNode[])[0] : null;
                node = N('atom', q, e, { k: 'acc', acc: t.v, v: inner && only && only.type === 'atom' ? only.v : null, inner });
                // \vec{v_1}: the subscript inside the accent is the name's subscript
                if (inner && only && only.sub) node.sub = only.sub;
                next = e + 1;
            } else if (t.k === 'sub' || t.k === 'sup') {
                // a script without a base (rare): a base of nothing
                node = N('atom', q, q - 1, { k: 'none', v: '' });
                next = q;
            } else if (t.k === 'prime') {
                node = N('atom', q, q - 1, { k: 'none', v: '' });
                next = q;
            } else if (t.k === 'op') node = N('op', q, q, { v: t.v });
            else if (t.k === 'fn' || t.k === 'big' || t.k === 'det') node = N(t.k, q, q, { v: t.v });
            else if (t.k === 'text') node = N('text', q, q, { v: t.v });
            else if (t.k === 'bang') node = N('bang', q, q, {});
            else node = N('atom', q, q, { k: t.k, v: t.v, font: t.font });
            // scripts and primes after the factor
            let guard = 0;
            while (next <= j && guard++ < 8) {
                const s = T[next];
                if (s.k === 'sub' && !node.sub) {
                    node.sub = script(next);
                    next = argEnd(F, next) + 1;
                } else if (s.k === 'sup' && !node.sup) {
                    node.sup = script(next);
                    next = argEnd(F, next) + 1;
                } else if (s.k === 'prime') {
                    node.primes = (node.primes ?? 0) + 1;
                    next++;
                } else break;
            }
            node.j = Math.max(node.j, Math.min(next - 1, j));
            kids.push(node);
            q = Math.max(next, q + (next === q ? 1 : 0));
        }
        return N('side', i, j, { kids });
    }
    try {
        return formula(0, T.length - 1);
    } catch {
        return null;
    }
}
