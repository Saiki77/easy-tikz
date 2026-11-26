/*
 * Design A of the voting readers (6.2.4): a token tagger network with
 * hand-set weights. A port of the frozen designA.mjs (hover-ml readers),
 * line by line.
 *
 *   tokens ─► layer 0  input features x_i (class, value and bracket-context indicators of token i, 0 or 1)
 *          ─► layer 1  conjunction units  c_i = step(w · x_i + b)                    (weightsA.ts: CONJ)
 *          ─► layer 2  two recurrent layers of gated latches, left to right (L) and right to left (R):
 *                        s_i = 0                         when the reset input fires
 *                        s_i = min(1, s_{i-1} + set_i)   else (set_i may be gated by another latch)
 *                      the read-out of token i sees the states BEFORE token i (L) and AFTER token i (R)
 *          ─► layer 2b conjunction units on the latches                               (weightsA.ts: CONJ2)
 *          ─► layer 3  per kind: role logits  z_i[r] = W_r · [x_i, c_i, L_i, R_i] + b_r   (weightsA.ts: KINDS)
 *                      a switch gate g_i (may the role change at token i?), and pointer scores
 *          ─► decoder  Viterbi over the roles: the best role sequence under the gate (a role cannot change
 *                      inside a bracket whose gate is shut) and the order table of the kind
 *   roles ─► spans (runs of one role) and pointers (the best token of a pointer score) ─► the internal parse
 *
 * All numbers are in weightsA.ts. The code here knows no kind. Pure: no DOM, no Obsidian.
 */
import { Front, Tok, front, print } from './front';
import type { FnRead, Internal } from './internal';
import { CONJ, CONJ2, KINDS, LATCH_L, LATCH_R, Latch, Unit } from './weightsA';

const IDX = new Set(['n', 'k', 'i', 'j', 'm']);
const WEIGHTY = new Set(['\\lambda', '\\theta', '\\alpha', '\\mu', '\\beta', 't']);
const ANGLE = new Set(['\\theta', '\\varphi', '\\phi']);
const MATRIXENV = /^(?:[pbBvV]?matrix|smallmatrix|array)$/;

/** Layer 0: the input features of every token (sparse: a list of names per token). */
export function inputs(F: Front): string[][] {
    const { T, mate, depth } = F;
    const arg = F.arg as number[];
    const n = T.length;
    const X: string[][] = Array.from({ length: n }, (): string[] => []);
    // bracket context: the innermost container of each token
    const cont: number[] = new Array<number>(n).fill(-1);
    {
        const st: number[] = [];
        for (let i = 0; i < n; i++) {
            const k = T[i].k;
            if (k === 'close' || k === 'rb' || k === 'end') {
                if (mate[i] >= 0) while (st.length && st[st.length - 1] !== mate[i]) st.pop();
                st.pop();
            }
            cont[i] = st.length ? st[st.length - 1] : -1;
            if ((k === 'open' || k === 'lb' || k === 'beg') && mate[i] > i) st.push(i);
        }
    }
    // scripts: the tokens of a script (with its sign and braces), and the inside
    const scr: (string | null)[] = new Array<string | null>(n).fill(null);
    const mark = (a: number, b: number, tag: string) => {
        for (let q = a; q <= b && q < n; q++) scr[q] = scr[q] ?? tag;
    };
    for (let i = 0; i < n; i++) {
        if (T[i].k !== 'big') continue;
        let e = i;
        for (let g = 0; g < 2; g++) {
            const s = T[e + 1];
            if (!s || (s.k !== 'sub' && s.k !== 'sup')) break;
            const a = e + 1;
            const b = arg[e + 1];
            const braced = T[a + 1] && T[a + 1].k === 'lb' && mate[a + 1] === b;
            mark(a, a, 'bigScr');
            if (braced) {
                mark(a + 1, a + 1, 'bigScr');
                mark(b, b, 'bigScr');
                mark(a + 2, b - 1, s.k === 'sub' ? 'bigSub' : 'bigSup');
            } else mark(a + 1, b, s.k === 'sub' ? 'bigSub' : 'bigSup');
            e = b;
        }
    }
    const inSub: number[] = new Array<number>(n).fill(0);
    const inSup: number[] = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) if (T[i].k === 'sub' || T[i].k === 'sup') for (let q = i + 1; q <= arg[i] && q < n; q++) (T[i].k === 'sub' ? inSub : inSup)[q] = 1;
    // a call bracket: a round bracket right after a name (f(, f'(, f_a(, f^{-1}()
    const isCall: boolean[] = new Array<boolean>(n).fill(false);
    for (let i = 1; i < n; i++) {
        if (T[i].k !== 'open' || T[i].v !== '(') continue;
        let p = i - 1;
        while (p >= 0 && T[p].k === 'prime') p--;
        while (p >= 0 && (inSub[p] || inSup[p])) p--;
        while (p >= 0 && (T[p].k === 'sub' || T[p].k === 'sup')) p--;
        if (p >= 0 && T[p].k === 'rb' && mate[p] >= 0 && T[mate[p] - 1] && T[mate[p] - 1].k === 'acc') p = mate[p] - 1;
        if (p >= 0 && (T[p].k === 'let' || T[p].k === 'grk' || T[p].k === 'opn' || T[p].k === 'acc') && !(T[p].k === 'let' && T[p].v === 'e')) isCall[i] = true;
    }
    for (let i = 0; i < n; i++) {
        const t = T[i];
        const x = X[i];
        x.push(t.k);
        const d = depth[i];
        x.push(d === 0 ? 'd0' : d === 1 ? 'd1' : 'd2p');
        if (i === 0) x.push('first');
        if (i === n - 1) x.push('last');
        const v = t.v;
        if (t.k === 'rel') {
            if (v === '=') x.push('eq');
            else if (v === '<' || v === '>' || v === '\\le' || v === '\\ge') x.push('ineq');
            else if (v === '\\in') x.push('in');
            else if (v === '\\to') x.push('to');
            else if (v === '\\mapsto') x.push('mapsto');
            else if (v === '\\approx') x.push('approx');
            else x.push('otherrel');
            if (v === '\\le' || v === '<') x.push('less');
            if (v === '\\ge' || v === '>') x.push('greater');
        } else if (t.k === 'sep') x.push(v === ',' ? 'comma' : v === ';' ? 'semi' : v === ':' ? 'colon' : 'bar');
        else if (t.k === 'op') x.push(v === '+' ? 'plus' : v === '-' ? 'minus' : v === '\\cdot' || v === '\\times' ? 'cdot' : 'otherop');
        else if (t.k === 'big') x.push(v === '\\sum' ? 'sum' : /min|max|inf|sup/.test(v) ? 'minmax' : 'otherbig');
        else if (t.k === 'open' || t.k === 'close') x.push(v === '(' || v === ')' ? 'par' : v === '[' || v === ']' ? 'sq' : v === '\\{' || v === '\\}' ? 'setb' : v === '|' || v === '\\|' ? 'absb' : 'otherbr');
        else if (t.k === 'let') {
            if (v >= 'A' && v <= 'Z') x.push('upper');
            else x.push('lower');
            if ('xyztrsnz'.includes(v) && v.length === 1) x.push('is_' + v);
            if (IDX.has(v)) x.push('idx');
            if (v === 'I' || v === 'E') x.push('ident');
            if (v === 'T') x.push('isT');
            if (v === 'e' || v === 'i' || v === 'd') x.push('const');
            if (t.font) x.push('font');
        } else if (t.k === 'grk') {
            if (ANGLE.has(v)) x.push('angle');
            if (v === '\\pi') x.push('const');
            if (v === '\\lambda') x.push('lambda');
        } else if (t.k === 'num') {
            if (v === '0') x.push('zero');
            if (v === '1') x.push('one');
            if (v === '2') x.push('two');
        } else if (t.k === 'opn') x.push(v === 'epi' ? 'epi' : v === 'dom' ? 'domop' : 'otheropn');
        else if (t.k === 'beg' || t.k === 'end') x.push(MATRIXENV.test(v) ? (/^[vV]/.test(v) ? 'vmatrix' : 'matrixenv') : v === 'cases' ? 'cases' : 'otherenv');
        if (WEIGHTY.has(v) && (t.k === 'let' || t.k === 'grk')) x.push('weighty');
        if (t.k === 'let' || t.k === 'grk') x.push('name');
        if (t.sp) x.push('spaced');
        const sc = scr[i];
        if (sc) x.push(sc);
        if (sc === 'bigSub' || sc === 'bigSup') x.push('bigScr');
        if (inSub[i]) x.push('inSub');
        if (inSup[i]) x.push('inSup');
        if (isCall[i]) x.push('callOpen');
        if (t.k === 'close' && mate[i] >= 0 && isCall[mate[i]]) x.push('callClose');
        const c = cont[i];
        if (c >= 0) {
            const ct = T[c];
            const cd = depth[c];
            const kind = ct.k === 'lb' ? 'Grp' : ct.k === 'beg' ? 'Env' : ct.v === '\\{' ? 'Set' : ct.v === '|' || ct.v === '\\|' ? 'Abs' : ct.v === '(' || ct.v === '[' ? (isCall[c] ? 'Call' : 'Br') : 'Br';
            x.push('in' + kind);
            if (cd === 0) x.push('in' + kind + '0');
            // inside a bracket of a top-level set brace
            const cc = cont[c];
            if (cc >= 0 && T[cc].v === '\\{' && depth[cc] === 0) x.push('inSetChild');
            if (cc >= 0) {
                let a = c;
                let any = false;
                while (a >= 0) {
                    if (T[a].v === '\\{') any = true;
                    a = cont[a];
                }
                if (any) x.push('inSetAny');
            } else if (ct.v === '\\{') x.push('inSetAny');
        }
        // a window of two tokens to each side
        const p: Tok | undefined = T[i - 1];
        const q: Tok | undefined = T[i + 1];
        const p2: Tok | undefined = T[i - 2];
        const q2: Tok | undefined = T[i + 2];
        if (p) {
            x.push('p_' + p.k);
            if (p.k === 'opn') x.push('p_opn_' + p.v);
            if (p.k === 'op' && p.v === '-') x.push('p_minus');
            if (p.k === 'let' || p.k === 'grk') x.push('p_name');
        } else x.push('p_none');
        if (!p2) x.push('p2_none');
        if (!p || ((p.k === 'wsp' || p.k === 'log' || p.k === 'text' || p.k === 'row') && depth[i - 1] === 0)) x.push('partStart');
        if (p2) {
            x.push('p2_' + p2.k);
            if (p2.k === 'opn') x.push('p2_opn_' + p2.v);
            if (p2.k === 'num' && p2.v === '1') x.push('p2_one');
        }
        if (q) {
            x.push('n_' + q.k);
            if (q.k === 'rel' && q.v === '=') x.push('n_eq');
            if (isCall[i + 1]) x.push('n_call');
            if (q.k === 'let' || q.k === 'grk') x.push('n_name');
        } else x.push('n_none');
        if (q2) {
            x.push('n2_' + q2.k);
            if (isCall[i + 2]) x.push('n2_callOpen');
        }
        // the start and the end of a side: next to a relation, a cut, a separator, or the edge
        const edge = (y: Tok | undefined) => !y || y.k === 'rel' || y.k === 'wsp' || y.k === 'log' || y.k === 'text' || y.k === 'sep' || y.k === 'row';
        if (d === 0 && edge(p)) x.push('sideStart');
        {
            let e = i;
            if (cont[i] >= 0 && T[cont[i]].k === 'lb' && T[cont[i] - 1] && T[cont[i] - 1].k === 'acc' && mate[cont[i]] === i + 1) e = i + 1;
            let y: Tok | undefined = T[e + 1];
            if (y && y.k === 'sub') y = T[arg[e + 1] + 1];
            if (edge(y)) x.push('sideEnd');
        }
        // a vector's name after a matrix name: A v, A \cdot v, A\vec{v}, A\mathbf v
        {
            let a = i - 1;
            if (a >= 0 && T[a].k === 'lb' && T[a - 1] && T[a - 1].k === 'acc') a -= 2;
            else if (a >= 0 && T[a].k === 'acc') a--;
            if (a >= 0 && T[a].k === 'op' && T[a].v === '\\cdot') a--;
            if (a >= 0 && T[a].k === 'let' && T[a].v >= 'A' && T[a].v <= 'Z' && depth[a] === 0 && (t.k === 'let' || t.k === 'grk') && !(v >= 'A' && v <= 'Z')) x.push('p_mat');
        }
        if (q && ((q.k === 'let' && q.v >= 'a' && q.v <= 'z') || q.k === 'acc' || (q.k === 'op' && q.v === '\\cdot'))) x.push('n_vec');
    }
    return X;
}

const dot = (w: Unit, have: Set<string>): number => {
    let s = w.bias ?? 0;
    for (const k in w) if (k !== 'bias' && have.has(k)) s += w[k];
    return s;
};

/** Layers 1 and 2: for every token the set of active units: inputs, conjunctions, L.* and R.* latches. */
export function states(X: string[][]): Set<string>[] {
    const n = X.length;
    const A = X.map((x) => new Set(x));
    for (let i = 0; i < n; i++) for (const [name, w] of CONJ) if (dot(w, A[i]) > 0) A[i].add(name);
    const run = (latches: Latch[], prefix: string, order: number[]) => {
        const state: Record<string, number> = {};
        for (const [name] of latches) state[name] = 0;
        for (const i of order) {
            // read-out sees the state before the token
            for (const [name] of latches) if (state[name]) A[i].add(prefix + name);
            const before = { ...state };
            for (const [name, set, reset, gate] of latches) {
                if (reset && reset.some((r) => A[i].has(r))) state[name] = 0;
                else if (set.some((s) => A[i].has(s)) && (!gate || before[gate])) state[name] = 1;
            }
        }
    };
    const fwd = Array.from({ length: n }, (_, i) => i);
    run(LATCH_L, 'L.', fwd);
    run(LATCH_R, 'R.', fwd.slice().reverse());
    for (let i = 0; i < n; i++) for (const [name, w] of CONJ2) if (dot(w, A[i]) > 0) A[i].add(name);
    return A;
}

/** A run of one role: its first and last token. */
type Span = [number, number];

/** What the tagger read: the spans of each role, the pointers, the role of every token, the active units. */
export interface Tagged {
    spans: Record<string, Span[]>;
    ptr: Record<string, number>;
    seq: string[];
    A: Set<string>[];
}

/** Layer 3 and the decoder: the role of every token, and the pointers. */
export function tag(F: Front, kind: string): Tagged | null {
    const K = KINDS[kind];
    if (!K) return null;
    const A = states(inputs(F));
    const n = A.length;
    const roles = K.roles;
    const R = roles.length;
    const NEG = -1e9;
    // logits
    const gate = A.map((a) => dot(K.gate, a) > 0);
    // a token behind a shut gate takes the role of the token before it: its own logits do not count
    const Z = A.map((a, i) => roles.map((r) => (r === 'O' || !gate[i] ? 0 : dot(K.out[r], a))));
    const sw = K.switchCost ?? 0.5;
    const order = K.order;
    const allowed = (from: number, to: number) => from === to || !order || !order[roles[from]] || order[roles[from]].includes(roles[to]);
    // Viterbi
    let prev: number[] = Z[0] ? Z[0].slice() : [];
    const back: number[][] = [];
    for (let i = 1; i < n; i++) {
        const cur: number[] = new Array<number>(R).fill(NEG);
        const bk: number[] = new Array<number>(R).fill(0);
        for (let r = 0; r < R; r++) {
            let best = NEG;
            let arg = r;
            for (let p = 0; p < R; p++) {
                if (p !== r && (!gate[i] || !allowed(p, r))) continue;
                const s = prev[p] - (p === r ? 0 : sw);
                if (s > best) {
                    best = s;
                    arg = p;
                }
            }
            cur[r] = best + Z[i][r];
            bk[r] = arg;
        }
        back.push(bk);
        prev = cur;
    }
    const seq: number[] = new Array<number>(n);
    if (n) {
        let r = 0;
        for (let q = 1; q < R; q++) if (prev[q] > prev[r]) r = q;
        seq[n - 1] = r;
        for (let i = n - 1; i > 0; i--) {
            r = back[i - 1][r];
            seq[i - 1] = r;
        }
    }
    // spans: the runs of each role
    const spans: Record<string, Span[]> = {};
    for (let i = 0; i < n; ) {
        let j = i;
        while (j + 1 < n && seq[j + 1] === seq[i]) j++;
        const r = roles[seq[i]];
        if (r !== 'O') (spans[r] ??= []).push([i, j]);
        i = j + 1;
    }
    // pointers: the best token of each score, above its threshold
    const ptr: Record<string, number> = {};
    const ptrs = K.ptr ?? {};
    for (const p in ptrs) {
        let best = 0;
        let at = -1;
        for (let i = 0; i < n; i++) {
            const s = dot(ptrs[p], A[i]);
            if (s > best) {
                best = s;
                at = i;
            }
        }
        ptr[p] = at;
    }
    return { spans, ptr, seq: seq.map((r) => roles[r]), A };
}

// ---------------------------------------------------------------- roles to the internal parse

const clean = (s: string) => s.replace(/^[\s,;.]+|[\s,;.]+$/g, '');
const P = (F: Front, sp: Span) => clean(print(F, sp[0], sp[1]));
const first = (F: Front, G: Tagged, role: string): string | null => (G.spans[role] ? P(F, G.spans[role][0]) : null);

/** The name at a pointer: the letter with its subscript (x_1, \alpha_{12}). */
export function nameAt(F: Front, i: number): string | null {
    if (i < 0) return null;
    const { T } = F;
    const arg = F.arg as number[];
    let base = T[i].v;
    let j = i;
    // inside an accent group: the subscript may stand after the group
    if (T[i + 1] && T[i + 1].k === 'rb' && T[i - 1] && T[i - 1].k === 'lb' && T[i - 2] && T[i - 2].k === 'acc') j = i + 1;
    const s = T[j + 1];
    if (s && s.k === 'sub') {
        let a = j + 2;
        let b = arg[j + 1];
        if (T[a] && T[a].k === 'lb') {
            a++;
            b--;
        }
        const sub = print(F, a, b).replace(/\s+/g, '');
        if (sub) base += sub.length === 1 ? `_${sub}` : `_{${sub}}`;
    }
    return base;
}

/** The rows of cells of the environment that starts at token b. */
export function cellsOf(F: Front, b: number): string[][] | null {
    const { T, mate, depth } = F;
    const e = mate[b];
    if (e < 0) return null;
    const rows: string[][] = [[]];
    let from = b + 1;
    const d = depth[b] + 1;
    for (let q = b + 1; q <= e; q++) {
        const t = T[q];
        if (q === e || (depth[q] === d && (t.k === 'amp' || t.k === 'row'))) {
            const cell = from <= q - 1 ? print(F, from, q - 1).trim() : '';
            rows[rows.length - 1].push(cell);
            if (q < e && t.k === 'row') rows.push([]);
            from = q + 1;
        }
    }
    // an empty last row (a row break before \end)
    while (rows.length > 1 && rows[rows.length - 1].every((c) => !c)) rows.pop();
    return rows;
}

function fnLike(F: Front, G: Tagged): Internal | null {
    const bodies = G.spans.BODY ?? [];
    if (!bodies.length) return null;
    const { T } = F;
    const names = G.spans.NAME ?? [];
    const vars = G.spans.VAR ?? [];
    const more = G.spans.MORE ?? [];
    const fns: FnRead[] = [];
    let prevEnd = -1;
    bodies.forEach((b, q) => {
        const nextStart = q + 1 < bodies.length ? bodies[q + 1][0] : T.length;
        const nm = names.filter((s) => s[0] > prevEnd && s[1] < b[0]);
        const args = vars.filter((s) => s[0] > prevEnd && s[1] < b[0]).map((s) => P(F, s));
        // the name: its first run to its last run before the call bracket (f, f', f_a, f^{-1})
        const name = nm.length ? clean(print(F, nm[0][0], nm[nm.length - 1][1])) : null;
        // what stands before this function: a comma, a cut, or nothing
        const start = nm.length ? nm[0][0] : args.length ? (vars.find((s) => s[0] > prevEnd) as Span)[0] : b[0];
        let sep: string | null = null;
        // a logic sign wins, then a comma (also a comma before a wide space), then the cut
        for (let i = start - 1; i > prevEnd; i--) {
            const k = T[i].k;
            if (k === 'log') sep = 'log';
            else if (k === 'wsp' || k === 'text' || k === 'row') sep = sep ?? k;
            else if (k === 'sep' && T[i].v !== ':') {
                if (sep !== 'log') sep = 'comma';
                break;
            } else if (sep) break;
        }
        fns.push({ name, args, body: P(F, b), more: more.filter((s) => s[0] > b[1] && s[0] < nextStart).map((s) => P(F, s)), sep });
        prevEnd = b[1];
    });
    const conditions = (G.spans.COND ?? []).map((s) => P(F, s).replace(/^\((.*)\)$/, '$1'));
    return { fns, conditions };
}

const ASM: Record<string, (F: Front, G: Tagged) => Internal | null> = {
    function: fnLike,
    surface: fnLike,
    polar: fnLike,
    domain: fnLike,
    implicit(F, G) {
        const equation = first(F, G, 'EQN');
        return equation ? { equation } : null;
    },
    region(F, G) {
        const c = (G.spans.COND ?? []).map((s) => P(F, s)).filter((x) => x);
        return c.length ? { conditions: c } : null;
    },
    condition(F, G) {
        const condition = first(F, G, 'COND');
        if (!condition) return null;
        return { condition: condition.replace(/^\((.*)\)$/, '$1'), variable: nameAt(F, G.ptr.VAR) };
    },
    interval(F, G) {
        const left = first(F, G, 'LB');
        const lo = first(F, G, 'LO');
        const hi = first(F, G, 'HI');
        const right = first(F, G, 'RB');
        if (!left || !lo || !hi || !right) return null;
        return { variable: nameAt(F, G.ptr.VAR), left, lo, hi, right };
    },
    set(F, G) {
        const condition = first(F, G, 'COND');
        if (!condition) return null;
        const variables = (G.spans.VAR ?? []).map((s) => nameAt(F, s[0]));
        return { variables, space: first(F, G, 'SPACE'), condition };
    },
    epigraph(F, G) {
        return G.ptr.FN >= 0 ? { fn: nameAt(F, G.ptr.FN) } : null;
    },
    jensen(F, G) {
        return G.ptr.FN >= 0 && G.ptr.W >= 0 ? { fn: nameAt(F, G.ptr.FN), weight: nameAt(F, G.ptr.W) } : null;
    },
    map(F, G) {
        const name = first(F, G, 'NAME');
        const domain = first(F, G, 'DOM');
        const codomain = first(F, G, 'COD');
        return name && domain && codomain ? { name, domain, codomain } : null;
    },
    matrix(F, G) {
        const s = G.spans.ENV;
        if (!s) return null;
        // the first square matrix among the written ones (a run may hold several: its environments in turn)
        const begs: number[] = [];
        for (const [i, j] of s) for (let q = i; q <= j; q++) if (F.T[q].k === 'beg' && F.depth[q] <= 1) begs.push(q);
        const all = begs.map((q) => cellsOf(F, q)).filter((e): e is string[][] => !!e);
        const entries = all.find((e) => e.length >= 2 && e.every((r) => r.length === e.length)) ?? all[0];
        return entries ? { name: G.ptr.NAME >= 0 && entries === all[0] ? F.T[G.ptr.NAME].v : null, entries } : null;
    },
    det(F, G) {
        const s = G.spans.ENV;
        const entries = s ? cellsOf(F, s[0][0]) : null;
        if (entries) return { name: null, entries };
        return G.ptr.M >= 0 ? { name: nameAt(F, G.ptr.M), entries: null } : null;
    },
    product(F, G) {
        return G.ptr.M >= 0 && G.ptr.V >= 0 ? { matrix: F.T[G.ptr.M].v, vector: F.T[G.ptr.V].v } : null;
    },
    eigen(F, G) {
        return G.ptr.M >= 0 && G.ptr.V >= 0 ? { matrix: F.T[G.ptr.M].v, vector: F.T[G.ptr.V].v } : null;
    },
    recurrence(F, G) {
        const step = first(F, G, 'STEP');
        if (!step || G.ptr.STATE < 0 || G.ptr.INDEX < 0) return null;
        const st = G.ptr.STATE;
        const sub = F.T[st + 1] && F.T[st + 1].k === 'sub' ? print(F, st + 2, F.arg[st + 1] as number).replace(/^\{(.*)\}$/, '$1').replace(/\s+/g, '') : '';
        return { state: F.T[st].v, index: F.T[G.ptr.INDEX].v, headSub: sub, step };
    },
    sum(F, G) {
        const index = first(F, G, 'INDEX');
        const lo = first(F, G, 'LO');
        const hi = first(F, G, 'HI');
        const body = first(F, G, 'BODY');
        if (!index || !lo || !hi || !body) return null;
        return { index, lo, hi, body, rhs: first(F, G, 'VALUE') };
    },
};

/** The internal parse of design A for a kind, or null. */
export function readA(tex: string, kind: string, F0?: Front): Internal | null {
    try {
        const F = F0 ?? front(tex);
        if (!F.T.length || !KINDS[kind] || !ASM[kind]) return null;
        const G = tag(F, kind);
        return G ? ASM[kind](F, G) : null;
    } catch {
        return null;
    }
}
