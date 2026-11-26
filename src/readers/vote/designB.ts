/*
 * Design B of the voting readers (6.2.4): a structure network over the
 * parse tree (tree.ts), all weights set by hand (weightsB.ts). A port of the
 * frozen designB.mjs (hover-ml readers), line by line.
 *
 *   tree ──► bottom-up   every node gets a state: a set of units that are on. A leaf state comes from its token
 *                        (class and value units). An inner node adds the units of its node type (UP: unit =
 *                        step(weights on the units of the children, addressed by their place)) and pools the
 *                        "any*" units of its children.
 *        ──► top-down    the role queries of the kind, in order (KINDS). A query looks at the nodes in the scope
 *                        of an earlier role (its children, its scripts, its cells) and scores each node:
 *                        score = W · [state, place units, relation-to-role units] + b. The best node (or all
 *                        nodes above 0, or the run of siblings above 0) takes the role.
 *   roles ──► token spans ──► the internal parse (internal.ts)
 *
 * The code here knows no kind. Pure: no DOM, no Obsidian.
 */
import { Front, Tok, front, print } from './front';
import { TNode, buildTree } from './tree';
import { KINDS, POOL, QueryB, UP, WeightsB } from './weightsB';
import type { FnRead, Internal } from './internal';

const IDX = new Set(['n', 'k', 'i', 'j', 'm']);
const MATRIXENV = /^(?:[pbBvV]?matrix|smallmatrix|array)$/;
const dot = (w: WeightsB, have: Set<string>): number => {
    let s = w.bias ?? 0;
    for (const k in w) if (k !== 'bias' && have.has(k)) s += w[k];
    return s;
};

/** The children of a node in order, with their place: kids, scripts, cells. */
function childrenOf(n: TNode): TNode[] {
    const out: TNode[] = [];
    (n.kids ?? []).forEach((k) => out.push(k));
    if (n.rows) n.rows.forEach((r) => r.forEach((c) => out.push(c)));
    if (n.sub) out.push(n.sub);
    if (n.sup) out.push(n.sup);
    if (n.inner) out.push(n.inner);
    return out;
}

/** Bottom-up: the state of every node. */
function up(n: TNode, T: Tok[], parent: TNode | null): void {
    n.parent = parent;
    const kids = childrenOf(n);
    // a name right before a round bracket is called: f(x)
    if (n.type === 'side') {
        const sk = n.kids as TNode[];
        sk.forEach((k, i) => {
            const nx = sk[i + 1];
            if (k.type === 'atom' && (k.k === 'let' || k.k === 'grk' || k.k === 'opn' || k.k === 'acc') && nx && nx.type === 'grp' && nx.br === '(' && !(k.k === 'let' && k.v === 'e')) {
                k.callee = true;
                nx.callArg = true;
            }
        });
    }
    for (const k of kids) {
        if (n.inScript || k === n.sub || k === n.sup) k.inScript = true;
        up(k, T, n);
    }
    const S = new Set<string>();
    n.S = S;
    S.add(n.type);
    if (n.callee) S.add('callee');
    if (n.callArg) S.add('callArg');
    if (n.inScript) S.add('inScript');
    if (parent && parent.type === 'side' && (parent.kids as TNode[]).length === 1) S.add('solo');
    if (n.type === 'atom') {
        S.add('k_' + (n.k as string));
        const v = n.v;
        if (n.k === 'let') {
            const lv = v as string;
            S.add(lv >= 'A' && lv <= 'Z' ? 'upper' : 'lower');
            if (lv.length === 1 && 'xyztrsz'.includes(lv)) S.add('is_' + lv);
            if (IDX.has(lv)) S.add('idx');
            if (lv === 'I' || lv === 'E') S.add('ident');
            if (lv === 'T') S.add('isT');
            if (lv === 'e' || lv === 'i' || lv === 'd') S.add('const');
            if (n.font) S.add('font');
        } else if (n.k === 'grk') {
            if (/^\\(theta|varphi|phi)$/.test(v as string)) S.add('angle');
            if (v === '\\pi') S.add('const');
            if (v === '\\lambda') S.add('lambda');
        } else if (n.k === 'num') {
            if (v === '0') S.add('zero');
            if (v === '1') S.add('one');
        } else if (n.k === 'opn') S.add('opn_' + (v as string));
        else if (n.k === 'acc') {
            S.add('acc_' + (n.acc as string).slice(1));
            if (n.v && /^[A-Z]$/.test(n.v)) S.add('upper');
            else if (n.v && /^[a-z]$/.test(n.v)) S.add('lower');
        }
        if (/^(\\lambda|\\theta|\\alpha|\\mu|\\beta|t)$/.test(v ?? '')) S.add('weighty');
        if (n.k === 'let' || n.k === 'grk' || (n.k === 'acc' && n.v)) S.add('name');
        if (n.sub) S.add('hasSub');
        if (n.sup) S.add('hasSup');
        if (n.primes) S.add('primed');
    } else if (n.type === 'grp') {
        S.add(n.br === '(' ? 'par' : n.br === '[' ? 'sq' : n.br === '\\{' ? 'setb' : n.br === '|' || n.br === '\\|' ? 'absb' : n.br === '{' ? 'grpb' : 'otherbr');
        if (n.cl === ')') S.add('cl_par');
        else if (n.cl === ']') S.add('cl_sq');
        const inner = (n.kids as TNode[])[0];
        if (inner.type === 'builder') S.add('builder');
        else {
            const c = (inner.kids as TNode[]).length;
            S.add(c === 0 ? 'items0' : c === 1 ? 'items1' : c === 2 ? 'items2' : c === 3 ? 'items3' : 'items4p');
            if (c >= 2) S.add('items2p');
        }
        if (n.sup) {
            S.add('hasSup');
            const s = n.sup.kids?.[0]?.kids?.[0]?.kids?.[0];
            if (s && (s.k === 'top' || (s.k === 'let' && s.v === 'T'))) S.add('transposed');
        }
        if (n.sub) S.add('hasSub');
    } else if (n.type === 'env') {
        const rows = n.rows as TNode[][];
        const ev = n.v as string;
        S.add(MATRIXENV.test(ev) ? 'matrixenv' : ev === 'cases' ? 'cases' : 'otherenv');
        if (/^[vV]matrix$/.test(ev)) S.add('vmatrix');
        const r = rows.length;
        const c = rows[0]?.length ?? 0;
        const even = rows.every((x) => x.length === c);
        if (even && r === c && (r === 2 || r === 3)) S.add('square');
        if (even && c === 1 && r >= 2) S.add('column');
        if (even && r === 1 && c >= 2) S.add('rowvec');
    } else if (n.type === 'big') {
        const bv = n.v as string;
        S.add(bv === '\\sum' ? 'sum' : /min|max|inf|sup/.test(bv) ? 'minmax' : 'otherbig');
        if (n.sub) S.add('hasSub');
        if (n.sup) S.add('hasSup');
    } else if (n.type === 'op') S.add(n.v === '+' ? 'plus' : n.v === '-' ? 'minus' : n.v === '\\cdot' || n.v === '\\times' ? 'cdot' : n.v === '/' ? 'slash' : 'otherop');
    else if (n.type === 'cut') S.add('cut_' + (n.k as string));
    else if (n.type === 'stmt') {
        const r = (n.rels as number[]).map((q) => T[q].v);
        S.add(r.length === 0 ? 'rels0' : r.length === 1 ? 'rels1' : 'rels2p');
        for (const v of r) S.add(v === '=' ? 'hasEq' : v === '<' || v === '>' || v === '\\le' || v === '\\ge' ? 'hasIneq' : v === '\\in' ? 'hasIn' : v === '\\to' ? 'hasTo' : v === '\\mapsto' ? 'hasMapsto' : v === '\\approx' ? 'hasApprox' : 'hasOtherRel');
        if (r.length) S.add(r[0] === '=' ? 'rel0_eq' : r[0] === '\\approx' ? 'rel0_approx' : r[0] === '\\mapsto' ? 'rel0_mapsto' : r[0] === '\\to' ? 'rel0_to' : r[0] === '\\in' ? 'rel0_in' : 'rel0_other');
        if (r.length && r.every((v) => v === '=')) S.add('allEq');
        if (r.length && r.every((v) => v === '<' || v === '>' || v === '\\le' || v === '\\ge')) S.add('allIneq');
    } else if (n.type === 'side') {
        const c = (n.kids as TNode[]).length;
        S.add(c === 0 ? 'len0' : c === 1 ? 'len1' : c === 2 ? 'len2' : 'len3p');
    } else if (n.type === 'part') {
        const c = (n.kids as TNode[]).length;
        S.add(c === 1 ? 'stmts1' : c === 0 ? 'stmts0' : 'stmts2p');
    }
    // the units of the node type: weights on the units of the children by place (k0, k1, kL: first, second, last child)
    const place = new Set(S);
    kids.forEach((k, i) => {
        for (const u of k.S as Set<string>) {
            if (i === 0) place.add('k0.' + u);
            if (i === 1) place.add('k1.' + u);
            if (i === 2) place.add('k2.' + u);
            if (i === kids.length - 1) place.add('kL.' + u);
            place.add('k*.' + u);
        }
    });
    if (n.sub) for (const u of n.sub.S as Set<string>) place.add('sub.' + u);
    if (n.sup) for (const u of n.sup.S as Set<string>) place.add('sup.' + u);
    for (const [name, type, w] of UP)
        if ((type === '*' || type === n.type) && dot(w, place) > 0) {
            S.add(name);
            place.add(name);
        }
    // pooled units: on when any child has the unit (or its source unit)
    for (const [name, sources] of POOL) if (sources.some((s) => S.has(s)) || kids.some((k) => (k.S as Set<string>).has(name))) S.add(name);
}

/** The nodes in a scope of a node. */
function scopeOf(n: TNode | null | undefined, scope: string): TNode[] {
    if (!n) return [];
    switch (scope) {
        case 'kids':
            return n.kids ?? [];
        case 'self':
            return [n];
        case 'parent':
            return n.parent ? [n.parent] : [];
        case 'siblings':
            return n.parent ? childrenOf(n.parent).filter((x) => x !== n) : [];
        case 'stmts': {
            const out: TNode[] = [];
            const walk = (x: TNode) => {
                for (const k of x.kids ?? []) {
                    if (k.type === 'stmt') out.push(k);
                    else if (k.type === 'part' || k.type === 'formula') walk(k);
                }
            };
            walk(n);
            return out;
        }
        case 'sub':
            return n.sub ? [n.sub] : [];
        case 'sup':
            return n.sup ? [n.sup] : [];
        case 'cells':
            return n.rows ? n.rows.flat() : [];
        case 'inner': {
            // through wrappers with one child: grp > part > stmt > side
            let x: TNode = n;
            for (let g = 0; g < 6 && x && (x.kids ?? []).length === 1 && (x.type === 'grp' || x.type === 'part' || x.type === 'stmt' || (x.type === 'side' && (x.kids as TNode[])[0].type === 'grp')); g++) x = (x.kids as TNode[])[0];
            return x ? [x] : [];
        }
        case 'grandkids':
            return (n.kids ?? []).flatMap((k) => k.kids ?? []);
        case 'desc': {
            const out: TNode[] = [];
            const walk = (x: TNode) => {
                for (const k of childrenOf(x)) {
                    out.push(k);
                    walk(k);
                }
            };
            walk(n);
            return out;
        }
        default:
            return [];
    }
}

/** What a role holds: one node (mode one), nodes (all, run), one node or null per base node (each). */
type Slot = TNode | null | Array<TNode | null>;
/** The roles of a kind: role to its slot (ROOT: the tree). */
type Roles = Record<string, Slot>;

/** Top-down: the role queries of a kind. Returns role -> node (mode one), nodes (mode all, run, each). */
function assign(root: TNode, T: Tok[], kind: string): Roles | null {
    const K = KINDS[kind];
    if (!K) return null;
    const R: Roles = { ROOT: root };
    const nm = (v: string) => (v === '=' ? 'eq' : v === '<' || v === '>' || v === '\\le' || v === '\\ge' ? 'ineq' : v === '\\in' ? 'in' : v === '\\to' ? 'to' : v === '\\mapsto' ? 'mapsto' : v === '\\approx' ? 'approx' : 'other');
    const scoreAll = (q: QueryB, cands: TNode[]): Array<[number, TNode]> =>
        cands.map((c, i): [number, TNode] => {
            const have = new Set(c.S);
            // place units among the candidates
            have.add(i === 0 ? 'pos0' : i === 1 ? 'pos1' : i === 2 ? 'pos2' : 'pos3p');
            if (i === cands.length - 1) have.add('posL');
            if (cands.length === 1) have.add('only');
            if (c.parent && c.parent.type === 'part' && (c.parent.kids as TNode[]).length === 1) have.add('alone');
            const p = c.parent;
            // the relation before and after a side of a statement
            if (p && p.type === 'stmt') {
                const at = (p.kids as TNode[]).indexOf(c);
                const rels = p.rels as number[];
                have.add(at > 0 ? 'relB_' + nm(T[rels[at - 1]].v) : 'relB_none');
                have.add(at < rels.length ? 'relA_' + nm(T[rels[at]].v) : 'relA_none');
            }
            if (p) {
                const sib = childrenOf(p);
                const at = sib.indexOf(c);
                // the units of the siblings before and after
                if (at > 0) for (const u of sib[at - 1].S as Set<string>) have.add('prevS.' + u);
                else have.add('prevS.none');
                if (at < sib.length - 1) for (const u of sib[at + 1].S as Set<string>) have.add('nextS.' + u);
                else have.add('nextS.none');
                if (p.type === 'formula') {
                    const pb = sib[at - 1];
                    if (pb && pb.type === 'cut') have.add('lead_' + (pb.k as string));
                }
            }
            // units of relation to the roles already given
            for (const r in R) {
                const x = R[r];
                if (!x || r === 'ROOT') continue;
                for (const y of Array.isArray(x) ? x : [x]) {
                    if (!y) continue;
                    if (y === c) have.add('is:' + r);
                    if (y.parent === c.parent && y.parent) {
                        const sib = childrenOf(y.parent);
                        const a = sib.indexOf(y);
                        const b = sib.indexOf(c);
                        if (b > a) have.add('after:' + r);
                        if (b === a + 1) have.add('next:' + r);
                        if (b < a) have.add('before:' + r);
                        if (b === a - 1) have.add('prev:' + r);
                    }
                    if (c.i > y.j) have.add('right:' + r);
                    if (c.j < y.i) have.add('left:' + r);
                    if (c.i >= y.i && c.j <= y.j && c !== y) have.add('inside:' + r);
                }
            }
            // alternatives: the best of several weight vectors
            const ws = Array.isArray(q.w) ? q.w : [q.w];
            let best = -1e9;
            for (const w of ws) best = Math.max(best, dot(w, have));
            return [best - 0.001 * i, c];
        });
    const pick = (q: QueryB, cands: TNode[]): TNode | TNode[] | null => {
        const good = scoreAll(q, cands).filter(([s]) => s > 0);
        if (q.mode === 'all' || q.mode === 'run') return good.map(([, c]) => c);
        good.sort((a, b) => b[0] - a[0]);
        return good.length ? good[0][1] : null;
    };
    for (const q of K.queries) {
        const base = R[q.in];
        const from = Array.isArray(base) ? base : base ? [base] : [];
        if (q.mode === 'each') R[q.role] = from.map((b) => (b ? (pick({ ...q, mode: 'one' }, scopeOf(b, q.scope)) as TNode | null) : null));
        else R[q.role] = pick(q, from.flatMap((b) => (b ? scopeOf(b, q.scope) : [])));
        const got = R[q.role];
        if (q.need && (!got || (Array.isArray(got) && !got.some((x) => x)))) return null;
    }
    return R;
}

const clean = (s: string) => s.replace(/^[\s,;.]+|[\s,;.]+$/g, '');
/** The canonical TeX of a node, or of a run of nodes. */
function texOf(F: Front, x: Slot | undefined): string | null {
    if (!x) return null;
    if (Array.isArray(x)) return x.length ? clean(print(F, (x[0] as TNode).i, (x[x.length - 1] as TNode).j)) : null;
    return x.i <= x.j ? clean(print(F, x.i, x.j)) : null;
}

const strip1 = (s: string | null) => (s ? s.replace(/^\((.*)\)$/, '$1') : s);
/** The name of an atom: the letter with its subscript (x_1, \alpha_{12}); the letter inside an accent. */
function nameOf(F: Front, n: Slot | undefined): string | null {
    if (!n || Array.isArray(n) || n.type !== 'atom') return null;
    let base = n.v;
    if (base === null || base === undefined) return null;
    if (n.sub && n.sub.i <= n.sub.j) {
        const sub = print(F, n.sub.i, n.sub.j).replace(/\s+/g, '');
        base += sub.length === 1 ? `_${sub}` : `_{${sub}}`;
    }
    return base;
}

/** A role that holds one node (mode one). */
const one = (R: Roles, role: string) => R[role] as TNode | null | undefined;
/** A role that holds a list (mode all, run, each). */
const list = (R: Roles, role: string) => R[role] as Array<TNode | null> | undefined;

/** One statement of the function family as design B reads it: args, body and more may hold null (an empty side). */
interface FnB {
    name: string | null;
    args: Array<string | null>;
    body: string | null;
    more: Array<string | null>;
    sep: string | null | undefined;
}

function fnLike(F: Front, R: Roles): Internal | null {
    const { T } = F;
    const fns: FnB[] = [];
    (list(R, 'FSTMT') ?? []).forEach((st, q) => {
        const body = (list(R, 'BODY') as Array<TNode | null>)[q];
        if (!st || !body) return;
        const head = (list(R, 'HEAD') as Array<TNode | null>)[q];
        let name: string | null = null;
        let args: Array<string | null> = [];
        const stS = st.S as Set<string>;
        if (head && stS.has('rel0_mapsto')) {
            // v \mapsto body (maybe after "f:"): the variable is the last name of the left side
            const hk = head.kids as TNode[];
            const last = hk[hk.length - 1];
            args = [nameOf(F, last) ?? texOf(F, last)];
        } else if (head) {
            const ha = (list(R, 'HARGS') as Array<TNode | null>)[q];
            const hk = head.kids as TNode[];
            // a label before the head: "g: y = ..."
            let from = head.i;
            if (hk.length >= 3 && hk[1].type === 'atom' && hk[1].k === 'sep' && hk[1].v === ':' && (hk[0].S as Set<string>).has('name')) from = hk[2].i;
            if (ha) {
                name = clean(print(F, from, ha.i - 1));
                args = ((ha.kids as TNode[])[0].kids as TNode[]).map((x) => texOf(F, x));
            } else name = clean(print(F, from, head.j));
        }
        // the later sides of a chain a = b = c
        const sk = st.kids as TNode[];
        const rels = st.rels as number[];
        const at = sk.indexOf(body);
        const more: Array<string | null> = [];
        if (head)
            for (let k = at + 1; k < sk.length; k++) {
                const v = T[rels[k - 1]].v;
                if (v !== '=' && v !== '\\approx') break;
                more.push(texOf(F, sk[k]));
            }
        // what stands before the statement: a comma, a cut, or nothing
        const part = st.parent as TNode;
        let sep: string | null | undefined = null;
        if ((part.kids as TNode[]).indexOf(st) > 0) sep = 'comma';
        else {
            // a logic sign wins, then a comma at the end of the part before, then the cut
            const sib = part.parent ? (part.parent.kids as TNode[]) : [];
            let k = sib.indexOf(part) - 1;
            for (; k >= 0 && sib[k].type === 'cut'; k--) sep = sib[k].k === 'log' || sep === 'log' ? 'log' : sep ?? sib[k].k;
            const before = k >= 0 ? sib[k] : null;
            if (sep && sep !== 'log' && before && before.seps && before.seps.length && before.seps[before.seps.length - 1] === before.j) sep = 'comma';
        }
        fns.push({ name, args, body: texOf(F, body), more, sep });
    });
    if (!fns.length) return null;
    // An empty side gives null in args, body or more (as the frozen design B): adapt.ts takes the JSON as it is.
    return { fns: fns as unknown as FnRead[], conditions: (list(R, 'CONDP') ?? []).map((x) => strip1(texOf(F, x))).filter((x): x is string => !!x) };
}

const ASM: Record<string, (F: Front, R: Roles) => Internal | null> = {
    function: fnLike,
    surface: fnLike,
    polar: fnLike,
    domain: fnLike,
    implicit(F, R) {
        const l = texOf(F, R.LEFT);
        const r = texOf(F, R.RIGHT);
        return l && r ? { equation: `${l} = ${r}` } : null;
    },
    region(F, R) {
        const listVar = list(R, 'LISTVAR') as TNode[];
        const nodes = [...((list(R, 'CONDS') ?? []) as TNode[]), ...((list(R, 'LISTVAR') ?? []) as TNode[])].sort((a, b) => a.i - b.i);
        const out: string[] = [];
        let carry: TNode | null = null;
        for (const n of nodes) {
            if (listVar.includes(n)) {
                carry = carry ?? n;
                continue;
            }
            out.push(clean(print(F, (carry ?? n).i, n.j)));
            carry = null;
        }
        return out.length ? { conditions: out } : null;
    },
    condition(F, R) {
        const c = texOf(F, R.COND);
        return c ? { condition: strip1(c), variable: nameOf(F, R.VARNODE) } : null;
    },
    interval(F, R) {
        const lo = texOf(F, R.LO);
        const hi = texOf(F, R.HI);
        const iv = one(R, 'IV');
        if (!iv || !lo || !hi) return null;
        const vside = one(R, 'VSIDE');
        const v = vside ? nameOf(F, (vside.kids as TNode[])[0]) : null;
        return { variable: v, left: iv.br, lo, hi, right: iv.cl };
    },
    set(F, R) {
        const condition = texOf(F, R.CONDB ?? R.CONDW);
        if (!condition) return null;
        let variables: Array<string | null> = [];
        const vs = one(R, 'VARSIDE');
        const vk = vs ? (vs.kids as TNode[]) : [];
        if (vs && vk.length === 1 && vk[0].type === 'atom') variables = [nameOf(F, vk[0])];
        else if (vs && vk.length === 1 && vk[0].type === 'grp')
            variables = (((vk[0].kids as TNode[])[0].kids as TNode[]).map((st) => {
                const stk = st.kids as TNode[];
                return stk.length === 1 && (stk[0].kids as TNode[]).length === 1 ? nameOf(F, (stk[0].kids as TNode[])[0]) : texOf(F, st);
            }));
        else if (vs) variables = [texOf(F, vs)];
        return { variables, space: texOf(F, R.SPACE), condition };
    },
    epigraph(F, R) {
        const n = R.FN1 ?? R.FN2;
        return n ? { fn: nameOf(F, n) } : null;
    },
    jensen(F, R) {
        return R.FN && R.W ? { fn: nameOf(F, R.FN), weight: nameOf(F, R.W) } : null;
    },
    map(F, R) {
        const name = texOf(F, R.NAME);
        const domain = texOf(F, R.DOM);
        const codomain = texOf(F, R.COD);
        return name && domain && codomain ? { name, domain, codomain } : null;
    },
    matrix(F, R) {
        const env = one(R, 'ENV');
        if (!env) return null;
        const entries = (env.rows as TNode[][]).map((r) => r.map((c) => (c.i <= c.j ? print(F, c.i, c.j).trim() : '')));
        const nside = one(R, 'NSIDE');
        return { name: nside ? (nside.kids as TNode[])[0].v : null, entries };
    },
    det(F, R) {
        const env = one(R, 'ENV');
        if (env) return { name: null, entries: (env.rows as TNode[][]).map((r) => r.map((c) => (c.i <= c.j ? print(F, c.i, c.j).trim() : ''))) };
        const m = R.M1 ?? R.M2;
        return m ? { name: nameOf(F, m), entries: null } : null;
    },
    product(F, R) {
        const m = one(R, 'M');
        const v = one(R, 'V');
        return m && v ? { matrix: m.v, vector: v.v } : null;
    },
    eigen(F, R) {
        const m = one(R, 'M');
        const v = one(R, 'V');
        return m && v ? { matrix: m.v, vector: v.v } : null;
    },
    recurrence(F, R) {
        const step = texOf(F, R.STEP);
        const h = one(R, 'HATOM');
        const index = one(R, 'INDEX');
        if (!step || !h || !h.sub || !index) return null;
        return { state: h.v, index: index.v, headSub: print(F, h.sub.i, h.sub.j).replace(/\s+/g, ''), step };
    },
    sum(F, R) {
        const index = texOf(F, R.INDEX);
        const lo = texOf(F, R.LO);
        const hi = texOf(F, R.HI);
        const body = texOf(F, R.BODY);
        if (!index || !lo || !hi || !body) return null;
        return { index, lo, hi, body, rhs: texOf(F, R.VALUE) };
    },
};

/** The internal parse of design B for a kind, or null. */
export function readB(tex: string, kind: string, F0?: Front): Internal | null {
    try {
        const F = F0 ?? front(tex);
        if (!KINDS[kind] || !ASM[kind]) return null;
        const root = buildTree(F);
        if (!root) return null;
        up(root, F.T, null);
        const R = assign(root, F.T, kind);
        return R ? ASM[kind](F, R) : null;
    } catch {
        return null;
    }
}
