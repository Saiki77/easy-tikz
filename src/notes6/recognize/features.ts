/*
 * The input encoding of formula recognition (a port of the frozen
 * features.mjs, hover-ml designed-r1; the logic is the same line by line).
 * A formula is cut into parts (as formulaLines does: \qquad, ",\quad",
 * \Rightarrow, \iff, a \text{...} word), and every part becomes one 0/1
 * vector of token-level features. No decision is taken here: each feature
 * answers one small question about the tokens ("the head is name(letter) =",
 * "a top-level \le", "the letter x is free"). All decisions are weights
 * (weights.ts). Pure: no DOM, no Obsidian.
 */

/** What the encoder reads around a formula: the note's definitions, the words around it, the note's id. */
export interface RecognizeContext {
    /** The note's other formulas that define something (noteDefinitions or noteValues take them), in order. */
    defs?: string[];
    /** About 10 words on each side of the formula, with "[F]" in its place. */
    context?: string;
    /** The note's id: its path without .md, each folder and the name as a slug (cs-ml/machine-learning-grundlagen). */
    note?: string | null;
}

type Deco = 'hat' | 'bar' | 'vec' | 'dot';

/** One item of a formula: an atom with its subscript and marks, a number, a relation, a big operator, an environment, a bracket. */
interface Item {
    t: string;
    v?: string;
    base?: string;
    sub?: string;
    name?: string;
    hat?: number;
    bar?: number;
    vec?: number;
    dot?: number;
    dd?: number;
    cal?: number;
    star?: number;
    top?: number;
    prime?: number;
    layer?: number;
    inv?: number;
    /** A blackboard letter's power (ℝ^n). */
    pow?: string;
    /** A power of ten (10^3). */
    sci?: boolean;
    /** A big operator's limits. */
    lower?: string[];
    upper?: string[];
    /** An environment's cells (rows of cells of tokens). */
    rows?: string[][][];
}

/** The answers about one part: a name to a value; a true value sets the feature. */
type Answers = Record<string, unknown>;

const TOKEN = /\\[A-Za-z]+|\\[^A-Za-z]|[0-9]+(?:\.[0-9]+)?|[A-Za-z]|[ \t\n\r\f\v]+|[^]/gu;
const SPACE = /^[ \t\n\r\f\v]+$/;
export function tokenize(tex: string): string[] {
    const out: string[] = [];
    for (const m of String(tex).matchAll(TOKEN)) if (!SPACE.test(m[0])) out.push(m[0]);
    return out;
}

const set = (s: string) => new Set(s.split(' '));
const DROP = set('\\left \\right \\big \\Big \\bigg \\Bigg \\bigl \\bigr \\Bigl \\Bigr \\biggl \\biggr \\displaystyle \\textstyle \\limits \\nolimits \\! \\mathstrut \\, \\: \\> $ \\underline \\phantom \\hphantom');
const SP = new Set(['\\;', '\\ ', '~']);
const MAP: Record<string, string> = {
    '\\dfrac': '\\frac', '\\tfrac': '\\frac', '\\leq': '\\le', '\\geq': '\\ge', '\\neq': '\\ne', '\\leqslant': '\\le', '\\geqslant': '\\ge',
    '\\colon': ':', '\\rightarrow': '\\to', '\\longrightarrow': '\\to', '\\lvert': '|', '\\rvert': '|', '\\vert': '|', '\\lVert': '\\|', '\\rVert': '\\|',
    '\\dbinom': '\\binom', '\\tbinom': '\\binom', '\\phi': '\\varphi', '\\epsilon': '\\varepsilon', '\\ast': '*', '\\star': '*', '\\lbrace': '\\{', '\\rbrace': '\\}',
    '\\implies': '\\Rightarrow', '\\Longrightarrow': '\\Rightarrow', '\\Leftrightarrow': '\\iff', '\\Longleftrightarrow': '\\iff', '\\gets': '\\leftarrow',
    '\\dots': '\\dots', '\\ldots': '\\dots', '\\cdots': '\\dots', '\\vdots': '\\dots', '\\ddots': '\\dots', '\\lt': '<', '\\gt': '>', '≤': '\\le', '≥': '\\ge',
    '\\middle': '', '\\vartheta': '\\theta', '\\mid': '\\mid', '\\prime': "'", '\\land': '\\wedge', '\\lor': '\\vee', '\\ne': '\\ne', '\\not': '\\not',
};
const GREEK = set('\\alpha \\beta \\gamma \\delta \\varepsilon \\zeta \\eta \\theta \\iota \\kappa \\lambda \\mu \\nu \\xi \\rho \\sigma \\tau \\upsilon \\varphi \\chi \\psi \\omega \\Gamma \\Delta \\Theta \\Lambda \\Xi \\Pi \\Sigma \\Phi \\Psi \\Omega \\ell \\hbar \\pi');
const FN = set('\\sin \\cos \\tan \\cot \\exp \\ln \\log \\lg \\sqrt \\arctan \\arcsin \\arccos \\sinh \\cosh \\tanh');
const FNWORD = set('sin cos tan exp ln log sgn sign abs sinh cosh tanh arctan si sinc erf');
const BIG: Record<string, string> = { '\\sum': 'sum', '\\prod': 'prod', '\\int': 'int', '\\oint': 'int', '\\iint': 'int', '\\lim': 'lim', '\\max': 'max', '\\min': 'min', '\\sup': 'max', '\\inf': 'min', '\\argmax': 'max', '\\argmin': 'min', '\\limsup': 'lim', '\\liminf': 'lim' };
const DECO: Record<string, Deco | ''> = { '\\hat': 'hat', '\\widehat': 'hat', '\\bar': 'bar', '\\overline': 'bar', '\\tilde': 'hat', '\\widetilde': 'hat', '\\vec': 'vec', '\\mathbf': 'vec', '\\boldsymbol': 'vec', '\\bm': 'vec', '\\dot': 'dot', '\\ddot': 'dot', '\\mathit': '', '\\mathsf': '' };
const REL: Record<string, string> = { '=': 'eq', '<': 'lt', '>': 'gt', '\\le': 'le', '\\ge': 'ge', '\\ne': 'ne', '\\in': 'in', '\\to': 'to', '\\mapsto': 'mapsto', '\\approx': 'approx', '\\sim': 'sim', '\\equiv': 'equiv', '\\leftarrow': 'larrow', '\\propto': 'sim', '\\subset': 'sub', '\\subseteq': 'sub', '\\notin': 'in', '\\ll': 'other', '\\gg': 'other', '\\perp': 'other', '\\simeq': 'approx', '\\cong': 'equiv', ':': 'colon', '\\mid': 'mid', '\\nmid': 'mid' };
const JOIN = set('\\Rightarrow \\iff \\Leftarrow \\quad \\qquad');
const BB: Record<string, string> = { R: 'ℝ', C: 'ℂ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', E: '𝔼', P: 'ℙ', D: '𝔻', K: '𝕂', 1: '𝟙' };
const MATENV = set('pmatrix bmatrix Bmatrix matrix vmatrix Vmatrix smallmatrix array');

/** Raw tokens to a clean token list: synonyms mapped, sizes dropped, decimal commas merged. */
export function clean(tex: string): string[] {
    const t = tokenize(tex);
    const out: string[] = [];
    for (let i = 0; i < t.length; i++) {
        let k = t[i];
        if (/^[0-9]/.test(k)) {
            // 3{,}5 and 2\,500 are one number
            for (;;) {
                if (t[i + 1] === '{' && t[i + 2] === ',' && t[i + 3] === '}' && /^[0-9]+$/.test(t[i + 4] ?? '')) {
                    k += '.' + t[i + 4];
                    i += 4;
                } else if (t[i + 1] === '\\,' && /^[0-9]{3}$/.test(t[i + 2] ?? '')) {
                    k += t[i + 2];
                    i += 2;
                } else break;
            }
            out.push(k);
            continue;
        }
        if (DROP.has(k)) continue;
        if (k in MAP) k = MAP[k];
        if (k === '') continue;
        if (SP.has(k)) k = 'SP';
        if (k === '\\not' && t[i + 1] === '=') {
            k = '\\ne';
            i++;
        }
        if (k === ':' && t[i + 1] === '=') {
            k = '=';
            i++;
        }
        if (k === '\\coloneqq' || k === '\\triangleq') k = '=';
        if (k === '.' && i === t.length - 1) continue;
        out.push(k);
    }
    while (out.length && (out[out.length - 1] === 'SP' || out[out.length - 1] === ',' || out[out.length - 1] === '.')) out.pop();
    return out;
}

/** One unit after ^ _ or a command: a brace group (without its braces) or one token. */
function unit(t: string[], i: number): [string[], number] {
    if (t[i] === '{') {
        let d = 0;
        for (let j = i; j < t.length; j++) {
            if (t[j] === '{') d++;
            else if (t[j] === '}' && --d === 0) return [t.slice(i + 1, j), j + 1];
        }
        return [t.slice(i + 1), t.length];
    }
    return [i < t.length ? [t[i]] : [], i + 1];
}

/** Clean tokens to items: atoms with their subscripts and marks, numbers, relations, big operators, environments. */
function parse(tIn: string[]): Item[] {
    let t = tIn;
    const items: Item[] = [];
    let deco: Deco | null = null;
    const last = (): Item | undefined => items[items.length - 1];
    const push = (it: Item) => {
        if (deco && it.t === 'atom') {
            it[deco] = 1;
            deco = null;
        }
        items.push(it);
        return it;
    };
    let guard = 0;
    for (let i = 0; i < t.length; ) {
        if (++guard > 50 * (t.length + 20)) throw new Error('parse does not end');
        const k = t[i];
        if (k === '\\begin') {
            const [nameT, j] = unit(t, i + 1);
            const name = nameT.join('');
            let e = j;
            let d = 1;
            for (; e < t.length; e++) {
                if (t[e] === '\\begin') d++;
                else if (t[e] === '\\end' && --d === 0) break;
            }
            const body = t.slice(j, e);
            const [, after] = unit(t, e + 1);
            if (MATENV.has(name) || name === 'cases') {
                const rows: string[][][] = [[[]]];
                let bd = 0;
                for (let q = 0; q < body.length; q++) {
                    const b = body[q];
                    if (b === '{') bd++;
                    if (b === '}') bd--;
                    if (b === '\\\\' && bd === 0) {
                        rows.push([[]]);
                        if (body[q + 1] === '[') while (q < body.length && body[q] !== ']') q++;
                        continue;
                    }
                    if (b === '&' && bd === 0) {
                        rows[rows.length - 1].push([]);
                        continue;
                    }
                    const r = rows[rows.length - 1];
                    r[r.length - 1].push(b);
                }
                while (rows.length && rows[rows.length - 1].every((c) => !c.length)) rows.pop();
                items.push({ t: 'env', name, rows });
                i = after;
            } else {
                t = [...t.slice(0, i), ...body, ...t.slice(after)];
            }
            continue;
        }
        if (k === '\\end') {
            i = unit(t, i + 1)[1];
            continue;
        }
        if (k === '&') {
            i++;
            continue;
        }
        if (k === '\\mathbb' || k === '\\mathcal' || k === '\\mathscr' || k === '\\mathfrak') {
            const [u, j] = unit(t, i + 1);
            const s = u.join('');
            if (k === '\\mathbb') items.push({ t: 'bb', v: BB[s] ?? 'bb' });
            else if (s === 'O') items.push({ t: 'bigO' });
            else push({ t: 'atom', base: 'cal' + s, sub: '', cal: 1 });
            i = j;
            continue;
        }
        if (k === '\\text' || k === '\\mathrm' || k === '\\operatorname' || k === '\\textbf' || k === '\\textit' || k === '\\textrm' || k === '\\mathop') {
            let [u, j] = unit(t, i + 1);
            if (u[0] === '*') [u, j] = unit(t, j);
            const s = u.join('').replace(/SP/g, '');
            if (s === 'e') push({ t: 'atom', base: 'e', sub: '' });
            else if (s === 'd') push({ t: 'atom', base: 'd', sub: '', dd: 1 });
            else if (s === 'i' || s === 'j') push({ t: 'atom', base: s, sub: '' });
            else if (/^(min|max|argmin|argmax)$/.test(s)) {
                t = [...t.slice(0, i), '\\' + s.replace('arg', ''), ...t.slice(j)];
                continue;
            } else if (FNWORD.has(s)) items.push({ t: 'fn', name: s });
            else if (t[j] === '(' || t[j] === '[' || k === '\\operatorname' || k === '\\mathop') items.push({ t: 'name', name: s });
            else if (/^[A-Z][A-Za-z]{0,3}$/.test(s) && k === '\\mathrm' && t[j] === '_') items.push({ t: 'name', name: s });
            else items.push({ t: 'text', v: s });
            i = j;
            continue;
        }
        if (k === '\\underbrace' || k === '\\overbrace') {
            const [u, j] = unit(t, i + 1);
            const s = u.join('');
            if (/^(min|max)$/.test(s) || /^\\(min|max)$/.test(s)) {
                t = [...t.slice(0, i), '\\' + s.replace('\\', ''), ...t.slice(j)];
                continue;
            }
            // keep the content, drop the label
            let rest = t.slice(j);
            if (rest[0] === '_' || rest[0] === '^') rest = rest.slice(unit(rest, 1)[1]);
            t = [...t.slice(0, i), '(', ...u, ')', ...rest];
            continue;
        }
        if (k in DECO) {
            const mark = DECO[k];
            if (mark) deco = mark;
            if (t[i + 1] === '{') {
                // drop the braces of the decorated group
                const [u, j] = unit(t, i + 1);
                t = [...t.slice(0, i + 1), ...u, ...t.slice(j)];
            }
            i++;
            continue;
        }
        if (k in BIG) {
            const it: Item = { t: 'big', name: BIG[k], lower: [], upper: [] };
            let j = i + 1;
            for (let n = 0; n < 2; n++) {
                if (t[j] === '_') {
                    const [u, q] = unit(t, j + 1);
                    it.lower = u;
                    j = q;
                } else if (t[j] === '^') {
                    const [u, q] = unit(t, j + 1);
                    it.upper = u;
                    j = q;
                }
            }
            items.push(it);
            i = j;
            continue;
        }
        if (k === '_') {
            const [u, j] = unit(t, i + 1);
            const p = last();
            const s = u.filter((x) => x !== 'SP').join('');
            if (p && (p.t === 'atom' || p.t === 'name')) p.sub = (p.sub ?? '') + s;
            else if (p && p.t === 'bb') p.sub = s;
            else if (p && p.t === 'close' && p.v === ']') items.push({ t: 'big', name: 'int', lower: u, upper: [] });
            i = j;
            continue;
        }
        if (k === "'") {
            const p = last();
            if (p && (p.t === 'atom' || p.t === 'name')) p.prime = (p.prime ?? 0) + 1;
            else items.push({ t: 'sym', v: "'" });
            i++;
            continue;
        }
        if (k === '^') {
            const [u, j] = unit(t, i + 1);
            const s = u.join('');
            const p = last();
            const pa = !!p && (p.t === 'atom' || p.t === 'name');
            if (s === '*' || s === '\\dagger') {
                if (p && pa) p.star = 1;
                else items.push({ t: 'star' });
                i = j;
                continue;
            }
            if (s === '\\top' || s === 'T' || s === '\\intercal' || s === 'H') {
                if (p && pa) p.top = 1;
                items.push({ t: 'top' });
                i = j;
                continue;
            }
            if (s === "'" || s === "''") {
                if (p && pa) p.prime = (p.prime ?? 0) + s.length;
                i = j;
                continue;
            }
            if (/^\[.*\]$/.test(s) || /^\(.*\)$/.test(s)) {
                if (p && pa) p.layer = 1;
                items.push({ t: 'layer' });
                i = j;
                continue;
            }
            if (s === '-1' && p && pa && /^[A-Z]$/.test(String(p.base))) p.inv = 1;
            if (s === '-1' && p && pa && t[j] === '(') {
                p.inv = 1;
                i = j;
                continue;
            }
            if (p && p.t === 'bb') {
                p.pow = s;
                i = j;
                continue;
            }
            if (s === '\\circ' || s === '°') {
                items.push({ t: 'unit' });
                i = j;
                continue;
            }
            items.push({ t: 'pow', sci: !!p && p.t === 'num' && p.v === '10' && /^-?[0-9]+$/.test(s) });
            items.push({ t: 'lb' });
            for (const x of parse(u)) items.push(x);
            items.push({ t: 'rb' });
            i = j;
            continue;
        }
        if (k === '\\frac' || k === '\\binom') {
            let a: string[];
            let b: string[];
            let j = i + 1;
            if (t[j] !== '{' && /^[0-9]{2,}$/.test(t[j] ?? '')) {
                a = [t[j][0]];
                b = [t[j].slice(1)];
                j++;
            } else {
                [a, j] = unit(t, j);
                if (t[j] !== '{' && /^[0-9]{2,}$/.test(t[j] ?? '')) {
                    b = [t[j][0]];
                    t = [...t.slice(0, j), t[j][0], t[j].slice(1), ...t.slice(j + 1)];
                    j++;
                } else [b, j] = unit(t, j);
            }
            items.push({ t: k === '\\frac' ? 'frac' : 'binom' });
            items.push({ t: 'lb' });
            for (const x of parse(a)) items.push(x);
            items.push({ t: 'rb' }, { t: 'lb' });
            for (const x of parse(b)) items.push(x);
            items.push({ t: 'rb' });
            i = j;
            continue;
        }
        if (k === '\\sqrt' && t[i + 1] === '[' && t.indexOf(']', i) > 0) {
            const e = t.indexOf(']', i);
            items.push({ t: 'fn', name: 'sqrt' }, { t: 'lb' });
            for (const x of parse(t.slice(i + 2, e))) items.push(x);
            items.push({ t: 'rb' });
            i = e + 1;
            continue;
        }
        if (FN.has(k)) {
            items.push({ t: 'fn', name: k.slice(1) });
            i++;
            continue;
        }
        if (k in REL) {
            items.push({ t: 'rel', v: REL[k] });
            i++;
            continue;
        }
        if (JOIN.has(k)) {
            items.push({ t: 'join', v: k });
            i++;
            continue;
        }
        if (/^[0-9]/.test(k)) {
            items.push({ t: 'num', v: k });
            i++;
            continue;
        }
        if (k === '\\Delta' && t[i + 1] && (/^[A-Za-z]$/.test(t[i + 1]) || GREEK.has(t[i + 1]))) {
            push({ t: 'atom', base: 'Δ' + t[i + 1].replace('\\', ''), sub: '' });
            i += 2;
            continue;
        }
        if (/^[A-Za-z]$/.test(k) || GREEK.has(k)) {
            push({ t: 'atom', base: k.replace('\\', ''), sub: '' });
            i++;
            continue;
        }
        if (k === '{') {
            items.push({ t: 'lb' });
            i++;
            continue;
        }
        if (k === '}') {
            items.push({ t: 'rb' });
            i++;
            continue;
        }
        if (k === '(' || k === '[') {
            items.push({ t: 'open', v: k });
            i++;
            continue;
        }
        if (k === ')' || k === ']') {
            items.push({ t: 'close', v: k });
            i++;
            continue;
        }
        if (k === '\\{') {
            items.push({ t: 'sopen' });
            i++;
            continue;
        }
        if (k === '\\}') {
            items.push({ t: 'sclose' });
            i++;
            continue;
        }
        if (k === '\\langle') {
            items.push({ t: 'sym', v: 'angle' });
            i++;
            continue;
        }
        if (k === '\\lfloor' || k === '\\rfloor' || k === '\\lceil' || k === '\\rceil') {
            items.push({ t: 'sym', v: 'floor' });
            i++;
            continue;
        }
        if (k === '\\partial') {
            items.push({ t: 'sym', v: 'partial' });
            i++;
            continue;
        }
        if (k === '\\nabla') {
            items.push({ t: 'sym', v: 'nabla' });
            i++;
            continue;
        }
        if (k === '\\infty') {
            items.push({ t: 'inf' });
            i++;
            continue;
        }
        if (k === '\\det') {
            items.push({ t: 'det' });
            i++;
            continue;
        }
        if (k === '%' || k === '\\%' || k === '°' || k === '\\circ' || k === '€' || k === '\\degree') {
            items.push({ t: 'unit' });
            i++;
            continue;
        }
        if (k === '\\cdot' || k === '\\times' || k === '*') {
            items.push({ t: 'sym', v: k === '\\times' ? 'times' : 'cdot' });
            i++;
            continue;
        }
        if (k === 'SP') {
            items.push({ t: 'sp' });
            i++;
            continue;
        }
        items.push({ t: 'sym', v: k });
        i++;
    }
    return items;
}

/** Depth of every item (round, square, set and group brackets all count). */
function depths(items: Item[]): number[] {
    const d: number[] = [];
    let c = 0;
    for (const it of items) {
        if (it.t === 'close' || it.t === 'rb' || it.t === 'sclose') c = Math.max(0, c - 1);
        d.push(c);
        if (it.t === 'open' || it.t === 'lb' || it.t === 'sopen') c++;
    }
    return d;
}

/** Parts of a formula: cut at \qquad, \quad, ", " followed by a space command, \Rightarrow, \iff (top level). */
function segments(items: Item[]): { segs: Item[][]; joins: string[] } {
    const d = depths(items);
    const segs: Item[][] = [[]];
    const joins: string[] = [];
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (d[i] === 0 && it.t === 'join') {
            segs.push([]);
            joins.push(String(it.v));
            continue;
        }
        if (d[i] === 0 && it.t === 'sym' && it.v === ',' && items[i + 1] && items[i + 1].t === 'sp') {
            segs.push([]);
            joins.push(',');
            continue;
        }
        if (d[i] === 0 && it.t === 'text' && /(^|[^a-zäöü])(für|for|mit|with|wobei|where|falls|if|wenn|when|und|and)($|[^a-zäöü])/i.test(String(it.v))) {
            segs.push([]);
            joins.push('word');
            continue;
        }
        if (d[i] === 0 && it.t === 'text' && /^(s\.t\.|u\.d\.N\.|subject to|NB:?)$/i.test(String(it.v).trim())) {
            segs.push([]);
            joins.push('text');
            continue;
        }
        segs[segs.length - 1].push(it);
    }
    const strip = (s: Item[]) => {
        let a = 0;
        let b = s.length;
        while (a < b && (s[a].t === 'sp' || (s[a].t === 'sym' && (s[a].v === ',' || s[a].v === ';')))) a++;
        while (b > a && (s[b - 1].t === 'sp' || (s[b - 1].t === 'sym' && (s[b - 1].v === ',' || s[b - 1].v === '.' || s[b - 1].v === ';')))) b--;
        return s.slice(a, b).filter((x) => x.t !== 'sp');
    };
    return { segs: segs.map(strip), joins };
}

const key = (a: Item) => String(a.base) + (a.hat || a.bar ? '^' : '') + (a.sub ? '_' + a.sub : '');
const isNumLike = (its: Item[]) =>
    its.length > 0 &&
    its.every(
        (x) =>
            x.t === 'num' ||
            x.t === 'unit' ||
            x.t === 'inf' ||
            x.t === 'lb' ||
            x.t === 'rb' ||
            x.t === 'frac' ||
            x.t === 'pow' ||
            (x.t === 'sym' && /^(\+|-|cdot|times|\/|\\pm|\.|,)$/.test(String(x.v))) ||
            (x.t === 'atom' && x.base === 'pi' && !x.sub) ||
            x.t === 'text' ||
            (x.t === 'fn' && x.name === 'sqrt') ||
            x.t === 'open' ||
            x.t === 'close'
    ) &&
    its.some((x) => x.t === 'num' || x.t === 'inf' || (x.t === 'atom' && x.base === 'pi'));
const INT = set('i j k l m n N');
const IDX = set('n k t m i j');

/** Split a list of items at its top-level relations. */
function relSplit(items: Item[]): { parts: Item[][]; rels: string[] } {
    const d = depths(items);
    const parts: Item[][] = [[]];
    const rels: string[] = [];
    for (let i = 0; i < items.length; i++) {
        if (d[i] === 0 && items[i].t === 'rel' && items[i].v !== 'mid') {
            rels.push(String(items[i].v));
            parts.push([]);
        } else parts[parts.length - 1].push(items[i]);
    }
    return { parts, rels };
}

/** name ( args ) spanning all of its: { name item, args: list of item lists } or null. */
function asCall(its: Item[]): { name: Item; args: Item[][] } | null {
    if (its.length < 4) return null;
    const h = its[0];
    if (!(h.t === 'atom' || h.t === 'name')) return null;
    if (its[1].t !== 'open' || its[1].v !== '(' || its[its.length - 1].t !== 'close') return null;
    const inner = its.slice(2, -1);
    const d = depths(inner);
    if (inner.some((x, i) => d[i] === 0 && x.t === 'close')) return null;
    const args: Item[][] = [[]];
    inner.forEach((x, i) => {
        if (d[i] === 0 && x.t === 'sym' && (x.v === ',' || x.v === ';')) args.push([]);
        else args[args.length - 1].push(x);
    });
    return { name: h, args };
}
const plainAtom = (its: Item[]) => its.length === 1 && its[0].t === 'atom' && !its[0].sub && !its[0].star && !its[0].prime && !its[0].cal;
const anyAtom = (its: Item[]) => its.length === 1 && its[0].t === 'atom';
const KNOWNCALL = set('sigma Phi Gamma');

interface Call {
    name: Item;
    inner: Item[];
    simple: boolean;
    at: number;
    end: number;
}

/** Calls inside its: an atom or a name directly followed by ( simple arguments ). */
function calls(its: Item[]): Call[] {
    const out: Call[] = [];
    for (let i = 0; i + 2 < its.length; i++) {
        const h = its[i];
        if (!(h.t === 'atom' || h.t === 'name') || its[i + 1].t !== 'open' || its[i + 1].v !== '(') continue;
        if (h.t === 'atom' && /^(i|j|e|pi)$/.test(String(h.base)) && !h.sub) continue;
        let j = i + 2;
        let d = 1;
        for (; j < its.length; j++) {
            if (its[j].t === 'open') d++;
            else if (its[j].t === 'close' && --d === 0) break;
        }
        const inner = its.slice(i + 2, j);
        const simple = inner.length > 0 && inner.every((x) => x.t === 'atom' || x.t === 'num' || (x.t === 'sym' && x.v === ','));
        const fname = h.t === 'name' || /^(f|g|h|F|Phi|psi|varphi)$/.test(String(h.base)) || (/^[A-Z]$/.test(String(h.base)) && !h.sub && inner.some((x) => x.t === 'atom' && x.base === 'z' && !x.sub));
        if (simple || fname) out.push({ name: h, inner, simple, at: i, end: j });
    }
    return out;
}

/** Matrix facts of an env item. */
function matrixInfo(env: Item) {
    const rows = env.rows ?? [];
    const r = rows.length;
    const c = Math.max(...rows.map((x) => x.length));
    const cells = rows.flat();
    const letters = new Set<string>();
    for (const cell of cells) for (const it of parse(cell)) if (it.t === 'atom' && it.base !== 'pi' && it.base !== 'e') letters.add(key(it));
    const nums = cells.every((cell) => cell.some((x) => /^[0-9]/.test(x)) || cell.some((x) => /^[A-Za-z]$|^\\[a-z]+$/.test(x)));
    return { nums, r, c, square: r === c && (r === 2 || r === 3) && rows.every((x) => x.length === c), col: c === 1 && r >= 2, letters, dots: cells.some((cell) => cell.includes('\\dots')) };
}

/** The names of the features, in the order of the input vector (the meaning of each is in the design notes). */
export const FEATURES: string[] = `empty lone loneCall numeric textOnly rel0 bare capMul usesDefMatrix anyMapsto
eq1 eq2p ineq1 ineq2 ineq3p hasNe hasIn hasTo hasColon hasSim hasEquiv hasLarrow hasSub hasMid hasOtherRel
op_int op_lim op_sum op_prod op_ddx op_nabla op_bigO op_mod op_logic op_prob op_binom deco_hat deco_bar hasCases hasDots hasText hasPm hasStar hasTop hasVec hasNorm hasAngle hasSetOps hasArr hasLayer hasImag hasReIm hasAbs hasFloor hasFact hasBB
hasFn hasPow hasFrac varProduct fnMaxMin knownCall
has_x has_y has_z has_t has_s has_n has_k has_x1 has_x2 has_x3p has_xi
let4 let5 let6p let7p
hc hcArg_x hcArg_t hcArg_z hcArg_s hcArg_ang hcArg_omega hcArg_other hcArgMarked hcArgNum hcArgExpr hc2 hcAbs hcJw hcSubCap hn_sigma hn_r hn_word
ha_y ha_x ha_xsub ha_z ha_r ha_fname ha_subst ha_cap ha_other ha_subIdx ha_hat ha_star ha_prime hname hexpr
bodyHasArg bodyHasBothArgs bodyHasIdx bodyOnly1 bodyOnlyX bodyOnlyQ lastNumeric firstBodyNumeric bodyTuple selfRef unkCall unkCallMarked callNonX primeBody defCall idxSubs
lhsFn rhsFn
setB setList setLevel setTuple setLhsCall setRhsCall setLe setGe setBadElem epiOp
iv ivSquare ivRound ivEndsNum ivEndsAB ivEndsExpr ivZeroSym ivMemberAtom ivNamed ivApprox list3
mapForm mapCodR mapCodPow mapDomAbstract mapHasC
oneMinus2 callSame3 jensenE jensenSum
mat1 mat2p matSq matNumeric matOneParam matStateVar matAdjVec matDots vmat vmatNumeric detLead detLone detMat detAny
eig1 eig2 prodAv prodVec
recNext recPrev recTwoStep recOtherIdx
sumLead sumBounds sumData
c_lhsX c_lhsT c_lhsAbs c_lhsCallX c_lhsX12 c_lhsHasZL c_rhsNum c_rhsAtom c_less c_midAtom c_midIdx c_endsNum c_midY c_endsHaveX c_lhsOmegaZ
polarR
ctxML ctxComplex ctxSignal ctxProb ctxSeq ctxPoint ctxInterval ctxVec
paramPair anyLogic anyVec anyPm afterWord genericProgram laterEval bodyHasInit`.split(/\s+/);
const INDEX = new Map(FEATURES.map((n, i) => [n, i]));
const at = (name: string): number => {
    const k = INDEX.get(name);
    if (k === undefined) throw new Error(`no feature ${name}`);
    return k;
};

/** Key words of the note's name and of the words around the formula. */
function noteContext(ctx: RecognizeContext | undefined): Answers {
    const note = String(ctx?.note ?? '').toLowerCase();
    const c = String(ctx?.context ?? '');
    const f: Answers = {};
    f.ctxNone = !note && !c;
    f.ctxML = /learning|neural|\bml\b|data-science/.test(note) || /ReLU|[Ss]igmoid|[Aa]ctivation|Aktivierung|logistic|Neuron/.test(c);
    f.ctxComplex = /complex|komplex|funktionentheorie/.test(note) || /holomorph|residue|Residu|conformal|konform|Möbius|meromorph/.test(c);
    f.ctxSignal = /signal|regelung|control|laplace|systemtheorie/.test(note) || /Übertragungsfunktion|transfer function|Laplace|z-Transform|Regler|Strecke|Kreis\b|Glied/.test(c);
    f.ctxProb = /wahrschein|stochast|statisti|probab|zeitreihen|okonometrie|econometr/.test(note);
    f.ctxSeq = /analysis-i\b|analysis-1|folgen|sequences/.test(note) || /\bFolge\b|sequence|Grenzwert|\bexplizit\b/.test(c);
    f.ctxPoint = /Punkt|[Pp]oint|Kante|[Ee]dge|bei \[F\]|at \[F\]|Kandidat|Lösung|Optimum|Nullen|Tupel|Kruskal|Scheitel|Ecke|Tangent|Bsp\.? \d|Max |Min /.test(c);
    f.ctxInterval = /Intervall|[Ii]nterval|auf \[F\]|on \[F\]|in \[F\]|into|segment|[Bb]ereich|to \[F\]/.test(c) || /\\to\s*$/.test(c.split('[F]')[0].replace(/\$\s*$/, ''));
    f.ctxVec = /optimi|ganzzahlig|operations-research/.test(note) || /\\mathbb\{[RZ]\}\^n|\bLP\b|Relaxation|Ax \\le|Ax =/.test(c);
    f.ctxSubst = /(Subst\w*|[Ss]etze|Sei|Let|Mit|With|with|where|wobei|mit)\s*\$?\s*\[F\]/.test(c);
    return f;
}

/** The names of the functions (g(x) = ...) and matrices (A = \begin{pmatrix}) the note defines. */
interface DefNames {
    names: Set<string>;
    mats: Set<string>;
}

function defNames(defs: unknown): DefNames {
    const out: DefNames = { names: new Set(), mats: new Set() };
    for (const d of Array.isArray(defs) ? (defs as unknown[]) : []) {
        const m = /^\s*(\\?[A-Za-z]+)\s*\(\s*[a-z]\s*\)\s*:?=/.exec(String(d));
        if (m) out.names.add(m[1].replace('\\', ''));
        const mm = /^\s*([A-Z])\s*=\s*\\begin\{[pbB]?matrix\}/.exec(String(d));
        if (mm) out.mats.add(mm[1]);
    }
    return out;
}

/** The head of a part: name(args) =, letter =, a name of capitals =, or an expression on the left. */
type Head = { kind: 'call'; name: Item; args: Item[][]; abs?: boolean } | { kind: 'atom'; a: Item; coef: boolean } | { kind: 'name'; a: Item } | { kind: 'expr' };

/** The features of one part. */
function partFeatures(its: Item[], defs: DefNames): { f: Answers; headBase: string | null } {
    const f: Answers = {};
    const n = its.length;
    f.empty = n === 0;
    if (!n) return { f, headBase: null };
    const d = depths(its);
    const { parts, rels } = relSplit(its);
    const P0 = parts[0];
    const nEq = rels.filter((r) => r === 'eq' || r === 'approx').length;
    const ineqs: string[] = rels.filter((r) => r === 'lt' || r === 'le' || r === 'gt' || r === 'ge');
    f.eq0 = nEq === 0;
    f.eq1 = nEq === 1;
    f.eq2p = nEq >= 2;
    f.ineq1 = ineqs.length === 1;
    f.ineq2 = ineqs.length === 2;
    f.ineq3p = ineqs.length >= 3;
    f.hasNe = rels.includes('ne');
    f.hasIn = rels.includes('in');
    f.hasTo = rels.includes('to');
    f.hasMapsto = rels.includes('mapsto');
    f.hasColon = rels.includes('colon');
    f.hasApprox = rels.includes('approx');
    f.hasSim = rels.includes('sim');
    f.hasEquiv = rels.includes('equiv');
    f.hasLarrow = rels.includes('larrow');
    f.hasSub = rels.includes('sub');
    f.hasOtherRel = rels.includes('other');
    f.hasMid = its.some((x, i) => x.t === 'rel' && x.v === 'mid' && d[i] === 0);
    f.firstEq = rels[0] === 'eq' || (rels[0] === 'approx' && parts[0].length > 0);
    f.firstIneq = ineqs.includes(rels[0]);
    f.firstIn = rels[0] === 'in';
    const all = its;
    const has = (pred: (x: Item) => boolean) => all.some(pred);
    f.rel0 = rels.length === 0;
    f.capMul = all.some(
        (x, i) =>
            x.t === 'atom' &&
            /^[A-Z]$/.test(String(x.base)) &&
            !x.sub &&
            all[i + 1] &&
            all[i + 1].t === 'atom' &&
            /^[xvwb]$/.test(String(all[i + 1].base)) &&
            !all[i + 1].sub &&
            (!all[i + 2] || all[i + 2].t !== 'open')
    );
    const atoms = all.filter((x) => x.t === 'atom');
    f.textOnly = all.every((x) => x.t === 'text' || x.t === 'open' || x.t === 'close');
    f.numeric = isNumLike(all) || (all.length <= 2 && all.every((x) => x.t === 'num' || x.t === 'sym'));
    f.short3 = n <= 3;
    f.lone =
        rels.length === 0 &&
        ((n === 1 && all[0].t !== 'env') ||
            (atoms.length <= 1 && all.every((x) => x.t === 'atom' || x.t === 'bb' || x.t === 'top' || x.t === 'layer' || x.t === 'star' || (x.t === 'sym' && (x.v === 'nabla' || x.v === 'partial')))));
    const cl = calls(all);
    f.loneCall = rels.length === 0 && cl.length === 1 && cl[0].at === 0 && cl[0].end === n - 1 && cl[0].name.t === 'atom';

    // operators and marks
    const bigs = all.filter((x) => x.t === 'big');
    f.op_int = bigs.some((b) => b.name === 'int');
    f.op_lim = bigs.some((b) => b.name === 'lim');
    f.op_sum = bigs.some((b) => b.name === 'sum');
    f.op_prod = bigs.some((b) => b.name === 'prod');
    f.op_nabla = has((x) => x.t === 'sym' && x.v === 'nabla');
    let ddx = has((x) => x.t === 'sym' && x.v === 'partial') || atoms.some((a) => a.dot || a.dd);
    for (let i = 0; i + 1 < n; i++) {
        if (all[i].t === 'atom' && all[i].base === 'd' && !all[i].sub && all[i + 1].t === 'atom' && (i === 0 || all[i - 1].t === 'lb' || (all[i - 1].t === 'sym' && all[i - 1].v === '/') || all[i - 1].t === 'frac')) {
            // d x right at the start of a group or after / : a differential
            if ((i > 0 && all[i - 1].t === 'lb') || (i > 0 && all[i - 1].t === 'sym')) ddx = true;
            if (i === 0 && all[i + 2] && all[i + 2].t === 'sym' && all[i + 2].v === '/') ddx = true;
        }
        if (all[i].t === 'frac' && all[i + 2] && all[i + 2].t === 'atom' && all[i + 2].base === 'd') ddx = true;
    }
    f.op_ddx = ddx;
    f.op_bigO =
        has((x) => x.t === 'bigO') ||
        all.some(
            (x, i) =>
                (x.t === 'atom' && /^(O|Theta|Omega|o)$/.test(String(x.base)) && !x.sub && all[i + 1] && all[i + 1].t === 'open' && all[i + 1].v === '(' && x.base !== 'Omega') ||
                (x.t === 'atom' && x.base === 'Theta' && all[i + 1] && all[i + 1].t === 'open')
        );
    f.op_mod = has((x) => x.t === 'sym' && /^\\(pmod|bmod|gcd|mod|lcm)$/.test(String(x.v))) || has((x) => x.t === 'name' && /^(ggT|gcd|kgV|lcm|mod)$/.test(String(x.name)));
    f.op_logic = has((x) => x.t === 'sym' && /^\\(forall|exists|wedge|vee|neg|lnot|nexists)$/.test(String(x.v)));
    const probCall =
        cl.some((c) => /^(P|E|ℙ)$/.test(c.name.base ?? '') && c.inner.some((x) => (x.t === 'atom' && /^[A-Z]$/.test(String(x.base))) || x.t === 'rel')) ||
        all.some(
            (x, i) =>
                x.t === 'atom' &&
                /^[PE]$/.test(String(x.base)) &&
                all[i + 1] &&
                all[i + 1].t === 'open' &&
                all.slice(i + 2, i + 8).some((y) => y.t === 'rel' || (y.t === 'atom' && /^[A-Z+]$/.test(String(y.base))) || (y.t === 'sym' && y.v === '+'))
        );
    f.op_prob =
        probCall ||
        has((x) => x.t === 'bb' && (x.v === '𝔼' || x.v === 'ℙ' || x.v === '𝟙')) ||
        has((x) => x.t === 'name' && /^(Var|Cov|E|Corr|Bin|Poi|Exp|SE|se|Pr|Bias|MSE)$/.test(String(x.name))) ||
        all.some((x, i) => x.t === 'atom' && x.base === 'E' && all[i + 1] && all[i + 1].t === 'open' && all[i + 1].v === '[') ||
        has((x) => x.t === 'atom' && !!x.cal && /^cal[NBU]$/.test(String(x.base))) ||
        all.some((x) => x.t === 'rel' && x.v === 'mid' && !all.some((y) => y.t === 'sopen'));
    f.op_binom = has((x) => x.t === 'binom');
    f.hasFact = has((x) => x.t === 'sym' && x.v === '!');
    f.deco_hat = atoms.some((a) => a.hat);
    f.deco_bar = atoms.some((a) => a.bar);
    f.hasCases = has((x) => x.t === 'env' && x.name === 'cases');
    f.hasDots = has((x) => x.t === 'sym' && x.v === '\\dots');
    f.hasText = has((x) => x.t === 'text');
    f.hasUnit = has((x) => x.t === 'unit') || all.some((x, i) => x.t === 'text' && i > 0 && all[i - 1].t === 'num');
    f.hasPm = has((x) => x.t === 'sym' && (x.v === '\\pm' || x.v === '\\mp'));
    f.hasInf = has((x) => x.t === 'inf');
    f.hasStar = atoms.some((a) => a.star) || has((x) => x.t === 'star');
    f.hasTop = has((x) => x.t === 'top');
    f.hasVec = atoms.some((a) => a.vec);
    f.hasNorm = has((x) => x.t === 'sym' && x.v === '\\|');
    f.hasAngle = has((x) => x.t === 'sym' && x.v === 'angle');
    f.hasSetOps = has((x) => x.t === 'sym' && /^\\(cup|cap|setminus|emptyset|varnothing|times|circ|otimes|oplus)$/.test(String(x.v))) || has((x) => x.t === 'sym' && x.v === 'times');
    f.hasArr = all.some((x, i) => x.t === 'atom' && all[i + 1] && all[i + 1].t === 'open' && all[i + 1].v === '[');
    f.hasLayer = has((x) => x.t === 'layer');
    f.hasBB = has((x) => x.t === 'bb');
    const imagIn = (its2: Item[]) =>
        its2.some(
            (x, i) =>
                x.t === 'atom' &&
                (x.base === 'i' || x.base === 'j') &&
                !x.sub &&
                ((i > 0 && (its2[i - 1].t === 'atom' || its2[i - 1].t === 'num' || (its2[i - 1].t === 'sym' && its2[i - 1].v === '\\pm'))) ||
                    (its2[i + 1] && (its2[i + 1].t === 'atom' || its2[i + 1].t === 'fn' || its2[i + 1].t === 'frac' || (its2[i + 1].t === 'open' && its2[i + 1].v === '(' && i > 0))))
        );
    f.hasImag = imagIn(all);
    f.hasReIm = has((x) => (x.t === 'name' && /^(Re|Im|Arg|arg|Res|Log)$/.test(String(x.name))) || (x.t === 'sym' && /^\\(arg|Re|Im)$/.test(String(x.v)))) || atoms.some((a) => a.bar && a.base === 'z');
    f.hasAbs = has((x) => x.t === 'sym' && x.v === '|');
    f.hasFloor = has((x) => x.t === 'sym' && x.v === 'floor');
    const isExp = (i: number) => all[i].t === 'atom' && all[i].base === 'e' && !all[i].sub && all[i + 1] && all[i + 1].t === 'pow';
    f.hasFn = has((x) => x.t === 'fn') || all.some((_x, i) => isExp(i));
    f.hasPow = has((x) => x.t === 'pow' && !x.sci);
    f.hasFrac = has((x) => x.t === 'frac' || (x.t === 'sym' && x.v === '/'));
    f.hasNum = has((x) => x.t === 'num');
    f.fnMaxMin = all.some((x, i) => x.t === 'big' && (x.name === 'max' || x.name === 'min') && !(x.lower ?? []).length && all[i + 1] && (all[i + 1].t === 'open' || all[i + 1].t === 'sopen'));
    const optIt = all.find((x, i) => x.t === 'big' && (x.name === 'max' || x.name === 'min') && !(all[i + 1] && !(x.lower ?? []).length && (all[i + 1].t === 'open' || all[i + 1].t === 'sopen')));
    f.opt = !!optIt || (rels.includes('to') && bigs.some((b) => b.name === 'min' || b.name === 'max'));
    f.optSub = !!optIt && (optIt.lower ?? []).length > 0;
    f.bare = f.rel0 || (f.opt && rels.every((r) => r === 'to'));
    const known = (c: Call) => (c.name.base === 'Gamma' && !c.name.sub) || (KNOWNCALL.has(c.name.base ?? '') && c.inner.length === 1 && c.inner[0].t === 'atom' && /^[zx]$/.test(String(c.inner[0].base)));
    f.knownCall = cl.some(known);

    // head
    let head: Head | null = null;
    let headLen = 0;
    const firstIsEq = f.firstEq || rels[0] === 'mapsto';
    if (firstIsEq && P0.length) {
        let h = P0;
        let coef = false;
        let abs = false;
        if (h.length > 1 && h[0].t === 'num') {
            h = h.slice(1);
            coef = true;
        }
        if (h.length > 2 && h[0].t === 'sym' && h[0].v === '|' && h[h.length - 1].t === 'sym' && h[h.length - 1].v === '|') {
            h = h.slice(1, -1);
            abs = true;
        }
        if (h[0].t === 'fn' && h[1] && h[1].t === 'open') h = [{ t: 'name', name: h[0].name }, ...h.slice(1)];
        const c = asCall(h);
        if (rels[0] === 'mapsto') {
            if (plainAtom(h)) head = { kind: 'call', name: { t: 'atom', base: '↦', sub: '' }, args: [h] };
            else head = { kind: 'expr' };
        } else if (c) head = { kind: 'call', name: c.name, args: c.args, abs };
        else if (h.length === 1 && h[0].t === 'atom') head = { kind: 'atom', a: h[0], coef };
        else if (h.length === 1 && h[0].t === 'name') head = { kind: 'name', a: h[0] };
        else if (h.length >= 2 && h.length <= 3 && h.every((x) => x.t === 'atom' && /^[A-Z]$/.test(String(x.base)) && !x.star && !x.prime) && h.slice(0, -1).every((x) => !x.sub)) head = { kind: 'name', a: h[h.length - 1] };
        else head = { kind: 'expr' };
        headLen = head.kind === 'expr' ? 0 : P0.length + 1;
    }
    const body = all.slice(headLen);
    f.hasImag = imagIn(body);
    if (head && head.kind === 'call') f.capMul = false;
    f.usesDefMatrix = all.some((x) => x.t === 'atom' && !x.sub && defs.mats.has(String(x.base))) && !all.some((x) => x.t === 'env');
    // free letters of the body (or of everything when there is no head)
    const callNameAt = new Set(
        calls(body)
            .filter((c) => c.name.t === 'atom')
            .map((c) => c.at)
    );
    const letters = new Map<string, Item>();
    body.forEach((x, i) => {
        if (x.t !== 'atom') return;
        if (x.base === 'pi' && !x.sub) return;
        if (x.base === 'e' && !x.sub && body[i + 1] && body[i + 1].t === 'pow') return;
        if (x.base === 'e' && !x.sub && !x.hat) return;
        if (x.dd || (x.base === 'd' && !x.sub && body[i + 1] && body[i + 1].t === 'atom' && f.op_ddx)) return;
        if (callNameAt.has(i)) return;
        if ((x.base === 'i' || x.base === 'j') && !x.sub && f.hasImag) return;
        letters.set(key(x), x);
    });
    for (const b of bigs) for (const x of parse(b.upper ?? [])) if (x.t === 'atom') letters.set(key(x), x);
    const L = (k: string) => letters.has(k);
    f.has_x = L('x');
    f.has_y = L('y');
    f.has_z = L('z');
    f.has_t = L('t');
    f.has_s = L('s');
    f.has_n = L('n');
    f.has_k = L('k');
    f.has_q = L('q');
    f.has_p = L('p');
    f.has_r = L('r');
    f.has_ang = L('theta') || L('varphi');
    f.has_omega = L('omega');
    f.has_lambda = L('lambda');
    f.has_xi = L('xi');
    f.has_x1 = L('x_1');
    f.has_x2 = L('x_2');
    f.has_x3p = [...letters.keys()].some((k) => /^x_(3|4|5|i|j|n|k|m|d)$/.test(k));
    const bases: Record<string, Set<string>> = {};
    for (const a of letters.values()) if (a.sub === '1' || a.sub === '2') (bases[String(a.base)] ??= new Set()).add(a.sub);
    f.pair12 = Object.entries(bases).some(([b, s]) => b !== 'x' && s.size === 2 && ![...letters.values()].some((a) => a.base === b && a.sub && a.sub !== '1' && a.sub !== '2'));
    let nl = letters.size;
    if (head && head.kind !== 'expr' && rels.length > 1) {
        const first = new Set<string>();
        const p1 = parts[1];
        const c1 = new Set(
            calls(p1)
                .filter((c) => c.name.t === 'atom')
                .map((c) => c.at)
        );
        p1.forEach((x, i) => {
            if (x.t === 'atom' && letters.has(key(x)) && !c1.has(i)) first.add(key(x));
        });
        nl = first.size;
    }
    f.let0 = nl === 0;
    f.let1 = nl === 1;
    f.let2 = nl === 2;
    f.let3 = nl === 3;
    f.let4 = nl === 4;
    f.let5 = nl === 5;
    f.let6p = nl >= 6;
    f.let7p = nl >= 7;
    f.capsOnly = nl > 0 && [...letters.values()].every((a) => /^[A-Z]/.test(String(a.base)));
    f.idxSubs = [...letters.values()].some((a) => /^(i|j|ij|ji|ik|kj)$/.test(String(a.sub)));
    // products of two variables (x y, x_1 x_2)
    const isVar = (x: Item | undefined) => !!x && x.t === 'atom' && /^(x|y)$/.test(String(x.base)) && (!x.sub || x.sub === '1' || x.sub === '2');
    f.varProduct = body.some(
        (x, i) =>
            isVar(x) &&
            (isVar(body[i + 1]) ||
                (body[i + 1] && body[i + 1].t === 'sym' && body[i + 1].v === 'cdot' && isVar(body[i + 2])) ||
                (body[i + 1] &&
                    body[i + 1].t === 'pow' &&
                    (() => {
                        let j = i + 2;
                        let dd = 0;
                        for (; j < body.length; j++) {
                            if (body[j].t === 'lb') dd++;
                            else if (body[j].t === 'rb' && --dd === 0) break;
                        }
                        return isVar(body[j + 1]);
                    })()))
    );

    const bcl = calls(body);
    const dn = defs.names;
    const headKey = head && head.kind !== 'expr' ? (head.kind === 'call' ? head.name : head.a) : null;
    const headBase = headKey ? (headKey.base ?? headKey.name ?? null) : null;
    const unk = bcl.filter((c) => !known(c) && !(c.name.t === 'name' && FNWORD.has(String(c.name.name))) && !/^(P|E)$/.test(c.name.base ?? ''));
    f.defCall = unk.some((c) => dn.has(String(c.name.base ?? c.name.name)));
    const unk2 = unk.filter((c) => !dn.has(String(c.name.base ?? c.name.name)));
    f.unkCall = unk2.length > 0;
    f.unkCallMarked = unk.some((c) => c.inner.some((x) => x.t === 'num' || (x.t === 'atom' && (x.sub || x.star))));
    f.callNonX = unk.some((c) => !(c.inner.length === 1 && c.inner[0].t === 'atom' && c.inner[0].base === 'x' && !c.inner[0].sub));
    f.primeBody = body.some((x) => (x.t === 'atom' || x.t === 'name') && x.prime) || body.some((x) => x.t === 'sym' && x.v === "'");
    f.selfRef =
        !!headBase &&
        !!head &&
        head.kind === 'call' &&
        body.some((x, i) => (x.t === 'atom' || x.t === 'name') && (x.base ?? x.name) === headBase && (x.sub ?? '') === (headKey?.sub ?? '') && body[i + 1] && body[i + 1].t === 'open');

    if (head) {
        if (head.kind === 'call') {
            f.hc = true;
            const a = head.args;
            const nm = head.name;
            f.hcAbs = !!head.abs;
            f.hcPrime = !!nm.prime;
            f.hcSubCap = /^[A-Z]/.test(nm.sub ?? '') && (nm.sub ?? '').length <= 3 && !/^[A-Z]$/.test(nm.base ?? 'x') ? true : /^(X|Y|Z)$/.test(nm.sub ?? '');
            f.hn_word = nm.t === 'name' && String(nm.name).length >= 2;
            f.hn_sigma = nm.base === 'sigma';
            f.hn_r = nm.base === 'r' && !nm.sub;
            f.hn_cap = /^[A-Z]$/.test(nm.base ?? '');
            f.hn_T = nm.base === 'T' && !nm.sub;
            if (a.length === 1) {
                const x = a[0];
                if (plainAtom(x)) {
                    f.hc1 = true;
                    const b = x[0].base;
                    if (b === 'x' || b === 'xi') f.hcArg_x = true;
                    else if (b === 't') f.hcArg_t = true;
                    else if (b === 'z') f.hcArg_z = true;
                    else if (b === 's') f.hcArg_s = true;
                    else if (/^(n|k|m|i|j)$/.test(String(b))) f.hcArg_n = true;
                    else if (b === 'theta' || b === 'varphi') f.hcArg_ang = true;
                    else if (b === 'omega' || b === 'Omega') f.hcArg_omega = true;
                    else f.hcArg_other = true;
                    f.bodyHasArg = L(key(x[0]));
                } else if (x.length === 2 && x[0].t === 'atom' && x[0].base === 'j' && x[1].t === 'atom' && x[1].base === 'omega') {
                    f.hcJw = true;
                    f.bodyHasArg = L('omega');
                } else if (anyAtom(x)) f.hcArgMarked = true;
                else if (isNumLike(x) || (x.some((y) => y.t === 'num') && x.every((y) => y.t !== 'atom' || y.sub))) f.hcArgNum = true;
                else f.hcArgExpr = true;
            } else if (a.length === 2) {
                if (a.every(plainAtom) || a.every((x) => anyAtom(x) && (x[0].sub === '1' || x[0].sub === '2') && !x[0].star)) {
                    f.hc2 = true;
                    f.bodyHasBothArgs = a.every((x) => L(key(x[0])));
                } else if (a.some((x) => isNumLike(x))) f.hcArgNum = true;
                else f.hcArgMarked = true;
            } else f.hc3p = true;
        } else if (head.kind === 'atom') {
            const a = head.a;
            f.ha = true;
            f.ha_coef = !!head.coef;
            f.ha_hat = !!(a.hat || a.bar);
            f.ha_star = !!a.star;
            f.ha_prime = !!a.prime;
            const idx = IDX.has(a.sub ?? '') ? (a.sub ?? '') : null;
            f.ha_subIdx = !!idx;
            f.ha_subNum = /^[0-9]+$/.test(a.sub ?? '') || /^(min|max|eff|ges|kin|pot)$/.test(a.sub ?? '');
            f.bodyHasIdx = !!idx && L(idx);
            f.bodyHasInit = [...letters.values()].some((x) => x.base === a.base && (x.sub === '0' || x.sub === '1'));
            if (a.base === 'y' && !a.sub) f.ha_y = true;
            else if (a.base === 'x' && !a.sub) f.ha_x = true;
            else if (a.base === 'x' && (a.sub === '1' || a.sub === '2')) f.ha_xsub = true;
            else if (a.base === 'z' && !a.sub) f.ha_z = true;
            else if (a.base === 'r' && !a.sub) f.ha_r = true;
            else if (/^(f|g|h|F|L|H|C|R)$/.test(String(a.base))) f.ha_fname = true;
            else if (/^(u|v|w|t|s|a|b|c|k|m|n|d)$/.test(String(a.base))) f.ha_subst = true;
            else if (/^[A-Z]$/.test(String(a.base))) f.ha_cap = true;
            else f.ha_other = true;
            // recurrences: X_{n+1} = ... X_n ...,  X_n = ... X_{n-1} ...
            const m = /^([a-zA-Z])\+1$/.exec(a.sub ?? '');
            const subsOf = [...letters.values()].filter((x) => x.base === a.base).map((x) => x.sub);
            if (m) {
                f.recNext = subsOf.includes(m[1]);
                f.recTwoStep = subsOf.some((s) => s === m[1] + '-1' || s === m[1] + '+2');
                f.recOtherIdx = [...letters.values()].some((x) => x.base !== a.base && x.sub && new RegExp('(^|[^a-z])' + m[1] + '($|[^a-z])').test(x.sub));
            } else if (idx) {
                f.recPrev = subsOf.includes(idx + '-1');
                f.recTwoStep = subsOf.includes(idx + '-2');
                f.recOtherIdx = [...letters.values()].some((x) => x.base !== a.base && x.sub && new RegExp('(^|[^a-z])' + idx + '($|[^a-z])').test(x.sub));
            }
        } else if (head.kind === 'name') {
            f.hname = true;
        } else f.hexpr = true;
        f.bodyOnly1 = letters.size === 1;
        f.bodyOnlyX = letters.size === 1 && L('x');
        f.bodyOnlyQ = letters.size === 1 && L('q');
        f.firstBodyNumeric = parts.length > 1 && isNumLike(parts[1]);
        const b1 = parts[1] ?? [];
        f.bodyTuple =
            b1.length >= 3 &&
            b1[0].t === 'open' &&
            b1[b1.length - 1].t === 'close' &&
            b1.some((x, i) => x.t === 'sym' && (x.v === ',' || x.v === ';') && depths(b1)[i] === 1) &&
            !depths(b1)
                .slice(1, -1)
                .some((q) => q === 0);
    }
    f.lastNumeric = rels.length > 0 && isNumLike(parts[parts.length - 1]) && (rels[rels.length - 1] === 'eq' || rels[rels.length - 1] === 'approx');
    if (rels.length && rels[0] === 'eq') {
        const lf = (p: Item[]) => p.some((x) => x.t === 'fn' && x.name !== 'sqrt');
        f.lhsFn = lf(parts[0]);
        f.rhsFn = lf(parts[parts.length - 1]);
    }

    // sets
    {
        let s = all;
        if (rels[0] === 'eq' && P0.length <= 4 && parts.length >= 2) s = all.slice(P0.length + 1);
        const o = s.findIndex((x) => x.t === 'sopen');
        if (o === 0 && s[s.length - 1].t === 'sclose' && !s.slice(1, -1).some((x, i) => x.t === 'sclose' && depths(s)[i + 1] === 0)) {
            const inner = s.slice(1, -1);
            const di = depths(inner);
            const sep = inner.findIndex((x, i) => di[i] === 0 && ((x.t === 'rel' && (x.v === 'mid' || x.v === 'colon')) || (x.t === 'sym' && x.v === '|')));
            if (sep > 0) {
                f.setB = true;
                const el = inner.slice(0, sep);
                const cond = inner.slice(sep + 1);
                f.setTuple = el[0].t === 'open';
                f.setHasR = el.some((x) => x.t === 'bb' && x.v === 'ℝ');
                f.setBadElem = el.some((x) => (x.t === 'bb' && x.v !== 'ℝ') || (x.t === 'atom' && /^(Omega|omega|n|k|v|z)$/.test(String(x.base)) && el[0] === x));
                const cr = relSplit(cond);
                const isC = (p: Item[]) => {
                    const c = asCall(p);
                    return !!c && c.name.t === 'atom' && c.args.length === 1;
                };
                f.setLhsCall = isC(cr.parts[0]);
                f.setRhsCall = cr.parts.length > 1 && isC(cr.parts[cr.parts.length - 1]);
                f.setLe = cr.rels.includes('le') || cr.rels.includes('lt');
                f.setGe = cr.rels.includes('ge') || cr.rels.includes('gt');
            } else {
                const r = relSplit(inner);
                if (r.rels.length === 1 && r.rels[0] === 'eq' && anyAtom(r.parts[0]) && r.parts[1].length === 1) f.setLevel = true;
                else f.setList = true;
            }
        }
        f.epiOp = has((x) => (x.t === 'name' || x.t === 'text') && /^epi$/.test(String(x.name ?? x.v)));
    }

    // intervals
    {
        let s = all;
        if (s.length && s[0].t === 'rel' && s[0].v === 'approx') {
            s = s.slice(1);
            f.ivApprox = true;
        }
        if (rels[0] === 'in' && rels.length === 1) {
            s = all.slice(P0.length + 1);
            f.ivMember = true;
            f.ivMemberAtom = anyAtom(P0) && !P0[0].cal;
        } else if (rels[0] === 'eq' && rels.length === 1 && plainAtom(P0)) {
            s = all.slice(P0.length + 1);
            f.ivNamed = true;
        }
        if (s.length >= 5 && s[0].t === 'open' && s[s.length - 1].t === 'close') {
            const ds = depths(s);
            if (
                !ds
                    .slice(1, -1)
                    .some((q) => q === 0)
            ) {
                const seps: number[] = [];
                s.forEach((x, i) => {
                    if (ds[i] === 1 && x.t === 'sym' && (x.v === ',' || x.v === ';')) seps.push(i);
                });
                if (seps.length === 1) {
                    f.iv = true;
                    const A = s.slice(1, seps[0]);
                    const B = s.slice(seps[0] + 1, -1);
                    f.ivSquare = s[0].v === '[' || s[s.length - 1].v === ']';
                    f.ivRound = !f.ivSquare;
                    const num = (p: Item[]) => isNumLike(p);
                    const let1 = (p: Item[]) => plainAtom(p);
                    f.ivEndsNum = num(A) && num(B);
                    f.ivEndsAB = (let1(A) && let1(B)) || (num(A) && let1(B)) || (let1(A) && num(B));
                    f.ivEndsExpr = !f.ivEndsNum && !f.ivEndsAB;
                    const str = (p: Item[]) => p.map((x) => x.v ?? x.t).join('');
                    f.ivZeroSym = f.ivEndsNum && str(A) !== str(B) && (str(A) === '0' || str(A) === '-' + str(B) || A.some((x) => x.t === 'inf') || B.some((x) => x.t === 'inf'));
                } else if (seps.length >= 2) f.list3 = true;
            }
        }
        if (f.iv) f.numeric = false;
        if (!f.iv) {
            f.ivApprox = false;
            f.ivMember = false;
            f.ivMemberAtom = false;
            f.ivNamed = false;
        }
    }

    // maps  name : domain -> codomain
    if (rels[0] === 'colon' && rels.filter((r) => r === 'to').length === 1 && rels.length === 2 && anyAtom(P0)) {
        f.mapForm = true;
        const dom = parts[1];
        const cod = parts[2];
        f.mapCodR = (cod.length === 1 && cod[0].t === 'bb' && cod[0].v === 'ℝ' && !cod[0].pow) || (cod.length >= 5 && cod[0].t === 'open' && cod[cod.length - 1].t === 'close');
        f.mapCodPow = cod.some((x) => x.t === 'bb' && x.pow);
        f.mapDomAbstract = dom.every((x) => x.t === 'atom') || !dom.some((x) => x.t === 'bb' || x.t === 'open');
        f.mapHasC = [...dom, ...cod].some((x) => x.t === 'bb' && x.v !== 'ℝ');
    }

    // Jensen
    {
        let om = 0;
        for (let i = 0; i + 2 < n; i++) if (all[i].t === 'num' && all[i].v === '1' && all[i + 1].t === 'sym' && all[i + 1].v === '-' && all[i + 2].t === 'atom') om++;
        f.oneMinus2 = om >= 2;
        const cnt: Record<string, number> = {};
        all.forEach((x, i) => {
            if (x.t === 'atom' && all[i + 1] && all[i + 1].t === 'open' && all[i + 1].v === '(') cnt[String(x.base)] = (cnt[String(x.base)] ?? 0) + 1;
        });
        f.callSame3 = Object.entries(cnt).some(([b, c]) => c >= 3 && /^[a-zA-Z]$|^varphi$|^phi$/.test(b) && b !== 'E');
        const isE = (x: Item | undefined) => !!x && ((x.t === 'atom' && x.base === 'E') || (x.t === 'bb' && x.v === '𝔼'));
        let fe = false;
        let ef = false;
        for (let i = 0; i + 3 < n; i++) {
            if (all[i].t === 'atom' && all[i + 1].t === 'open' && isE(all[i + 2]) && all[i + 3].t === 'open') fe = true;
            if (isE(all[i]) && all[i + 1].t === 'open' && all[i + 2].t === 'atom' && all[i + 3].t === 'open') ef = true;
        }
        f.jensenE = fe && ef;
        f.jensenSum = n > 6 && all[0].t === 'atom' && all[1].t === 'open' && all[2].t === 'big' && all[2].name === 'sum' && bigs.filter((b) => b.name === 'sum').length === 2;
    }

    // matrices, determinants, products, eigen equations
    {
        const envs = all.map((x, i): [Item, number] => [x, i]).filter(([x]) => x.t === 'env' && x.name !== 'cases');
        const mats = envs.filter(([x]) => x.name !== 'vmatrix');
        f.mat1 = mats.length === 1;
        f.mat2p = mats.length >= 2;
        const infos = mats.map(([x, i]) => ({ ...matrixInfo(x), i }));
        const sq = infos.find((m) => m.square);
        if (sq) {
            f.matSq = true;
            const lt = [...sq.letters];
            f.matNumeric = lt.length === 0 && sq.nums;
            f.matStateVar = lt.some((k) => /^(x|y|s|z|x_1|x_2)$/.test(k));
            f.matOneParam = lt.length === 1 && !f.matStateVar;
            f.matManyParams = lt.length >= 2;
            f.matDots = sq.dots;
            f.matAdjVec = infos.some((m) => m.col && m.i === sq.i + 1);
        }
        f.matCol = infos.some((m) => m.col);
        const vm = envs.find(([x]) => x.name === 'vmatrix');
        if (vm) {
            f.vmat = true;
            const mi = matrixInfo(vm[0]);
            f.vmatNumeric = mi.square && mi.letters.size === 0;
        }
        f.detAny = has((x) => x.t === 'det');
        if (all[0].t === 'det') {
            f.detLead = true;
            const r = all.slice(1);
            const cap = (x: Item | undefined) => !!x && x.t === 'atom' && /^[A-Z]$/.test(String(x.base)) && !x.inv;
            f.detLone = (r.length === 1 && cap(r[0])) || (r.length === 3 && r[0].t === 'open' && cap(r[1]) && r[2].t === 'close');
            const dm = r[0] && r[0].t === 'env' ? r[0] : r[0] && r[0].t === 'open' && r[1] && r[1].t === 'env' ? r[1] : null;
            f.detMat = !!dm && matrixInfo(dm).letters.size === 0;
        }
        const cap = (x: Item | undefined) => !!x && x.t === 'atom' && /^[A-Z]$/.test(String(x.base)) && !x.star && !x.prime;
        const low = (x: Item | undefined) => !!x && x.t === 'atom' && /^[a-z]$/.test(String(x.base)) && !x.star;
        if (n === 2 && cap(all[0]) && low(all[1])) {
            f.prodVec = !!all[1].vec;
            f.prodAv = /^[ABMSTQUP]$/.test(String(all[0].base)) && !all[0].sub && /^[vxuw]$/.test(String(all[1].base));
        }
        if (rels.length === 1 && rels[0] === 'eq') {
            const l = parts[0];
            const r = parts[1];
            if (l.length === 2 && cap(l[0]) && low(l[1]) && r.length === 2 && (r[0].t === 'atom' || r[0].t === 'num') && low(r[1]) && r[1].base === l[1].base && !low(r[0])) f.eig1 = true;
            if (l.length === 2 && cap(l[0]) && low(l[1]) && r.length === 2 && r[0].t === 'atom' && r[0].base === 'lambda' && r[1].base === l[1].base) f.eig1 = true;
            if (
                l.length >= 6 &&
                l[0].t === 'open' &&
                cap(l[1]) &&
                l[2].t === 'sym' &&
                l[2].v === '-' &&
                l[3].t === 'atom' &&
                cap(l[4]) &&
                l[5].t === 'close' &&
                low(l[6]) &&
                l.length === 7 &&
                r.length === 1 &&
                r[0].t === 'num' &&
                r[0].v === '0'
            )
                f.eig2 = true;
        }
    }

    // sums
    {
        const si = body.findIndex((x) => x.t === 'big' && x.name === 'sum');
        if (si >= 0) {
            const sm = body[si];
            f.sumLead = si === 0;
            const lo = (sm.lower ?? []).join('');
            const m = /^([a-zA-Z])=/.exec(lo);
            f.sumBounds = !!m && (sm.upper ?? []).length > 0;
            const ix = m ? m[1] : /^[a-z]$/.test(lo) ? lo : null;
            if (ix) {
                const rest = body.slice(si + 1);
                f.sumData = rest.some((x) => x.t === 'atom' && x.sub && new RegExp('(^|[^a-z])' + ix + '($|[^a-z])').test(x.sub));
                f.sumIdxTerm = rest.some((x) => x.t === 'atom' && x.base === ix && !x.sub);
            }
        }
    }

    // inequalities
    if ((ineqs.length && nEq === 0) || (ineqs.length === 2 && rels[rels.length - 1] === 'approx')) {
        const lhs = parts[0];
        const lt = new Set(lhs.filter((x) => x.t === 'atom').map((x) => key(x)));
        const lcl = calls(lhs);
        const lset = [...lt].filter((k) => !lcl.some((c) => key(c.name) === k));
        if (ineqs.length === 1 && rels.length === 1) {
            const rhs = parts[1];
            f.c_lhsAtom = plainAtom(lhs);
            f.c_lhsAbs =
                lhs.length >= 3 &&
                lhs[0].t === 'sym' &&
                lhs[0].v === '|' &&
                lhs[lhs.length - 1].t === 'sym' &&
                lhs[lhs.length - 1].v === '|' &&
                lhs.length <= 6 &&
                !lhs.some((x) => x.t === 'fn' || x.t === 'open' || x.prime || x.star || x.hat || x.bar || (x.t === 'atom' && x.sub && x.sub !== '0'));
            const only = (v: string) => lset.length > 0 && lset.includes(v) && lset.every((k) => k === v || k === v + '_0' || /^[a-c]$/.test(k));
            f.c_lhsX = only('x') && !lhs.some((x) => x.t === 'sym' && x.v === '\\|') && !lhs.some((x) => x.top || x.star || x.prime) && lcl.length === 0;
            f.c_lhsT = only('t') && lcl.length === 0;
            const c = asCall(lhs);
            f.c_lhsCallX = !!c && c.name.t === 'atom' && c.args.length === 1 && plainAtom(c.args[0]) && c.args[0][0].base === 'x' && !c.name.prime && !c.name.sub && /^[fgh]$/.test(String(c.name.base));
            f.c_lhsX12 = anyAtom(lhs) && lhs[0].base === 'x' && (lhs[0].sub === '1' || lhs[0].sub === '2');
            f.c_lhsHasZL = lhs.some((x) => x.t === 'atom' && (x.base === 'lambda' || x.base === 'z'));
            f.c_lhsOmegaZ = plainAtom(lhs) && (lhs[0].base === 'omega' || lhs[0].base === 'z');
            f.c_lhsFn = lhs.some((x) => x.t === 'fn');
            f.c_rhsNum = isNumLike(rhs);
            f.c_rhsAtom = plainAtom(rhs);
            f.c_less = rels[0] === 'lt' || rels[0] === 'le';
        } else if (ineqs.length === 2) {
            const mid = parts[1];
            f.c_midAtom = plainAtom(mid);
            f.c_midIdx = anyAtom(mid) && INT.has(String(mid[0].base));
            const end = parts[2];
            f.c_endsNum = isNumLike(parts[0]) && (isNumLike(end) || (end.length > 0 && end.every((x) => x.t !== 'atom' || x.base === 'pi') && end.some((x) => x.t === 'num')));
            f.c_midY = plainAtom(mid) && mid[0].base === 'y';
            f.c_endsHaveX = [...parts[0], ...parts[2]].some((x) => x.t === 'atom' && x.base === 'x' && !x.sub);
            f.c_less = rels[0] === 'lt' || rels[0] === 'le';
        }
    }
    f.polarR = all.some((x) => x.t === 'atom' && x.base === 'r' && !x.sub) && all.some((x) => x.t === 'atom' && (x.base === 'theta' || x.base === 'varphi') && !x.sub) && nEq === 1;
    return { f, headBase };
}

/** The feature vectors of the parts of a formula, in order. Throws on a formula it cannot read. */
export function encode(tex: string, ctx?: RecognizeContext): Float32Array[] {
    const items = parse(clean(tex));
    const { segs, joins } = segments(items);
    const cf = noteContext(ctx);
    const dn = defNames(ctx?.defs);
    const raw = segs.map((s) => partFeatures(s, dn));
    const prog = raw.some((q) => q.f.opt && (q.f.unkCall || q.f.hasTop || q.f.capMul));
    const out: Float32Array[] = [];
    const heads = raw.map((r) => r.headBase);
    // a pair of heads x(t), y(t) is a parametric curve
    const paramPair = raw.filter((r) => r.f.hc1 && r.f.hcArg_t).length >= 2 && heads.includes('x') && heads.includes('y');
    const anyOf = (name: string) => raw.some((q) => q.f[name]);
    const whole: Answers = { paramPair, anyMapsto: anyOf('hasMapsto'), anyLogic: anyOf('op_logic'), anyPm: anyOf('hasPm'), anyVec: anyOf('hasTop') || anyOf('capMul') || anyOf('hasVec'), genericProgram: prog };
    const put = (v: Float32Array, obj: Answers) => {
        for (const name in obj)
            if (obj[name]) {
                const k = INDEX.get(name);
                if (k !== undefined) v[k] = 1;
            }
    };
    for (let i = 0; i < raw.length; i++) {
        const v = new Float32Array(FEATURES.length);
        put(v, raw[i].f);
        put(v, cf);
        put(v, whole);
        if (i > 0 && joins.slice(0, i).includes('word')) v[at('afterWord')] = 1;
        if (i < raw.length - 1 && joins.includes('\\Rightarrow') && raw.slice(i + 1).some((q) => q.f.hcArgNum || q.f.hcArgExpr || q.f.hcArgMarked)) v[at('laterEval')] = 1;
        out.push(v);
    }
    return out;
}
