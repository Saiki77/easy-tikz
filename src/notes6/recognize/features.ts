/*
 * The input encoding of formula recognition (a port of the frozen
 * features.mjs of round 4, hover-ml designed4; the logic is the same line by
 * line). Round 4 adds what the context line says (contextFormulas,
 * noteContext: role words, program facts, switches, names), parameters as
 * sliders (paramExpr), and the blocks marked round 4, C1, P2 in partFeatures. The front end (normalize.ts) writes the formula in canonical TeX;
 * it is cut into parts (\qquad, \Rightarrow, \iff, a word such as für, a
 * list of statements, a remark in brackets at the end, a chain f(x) = A = B),
 * and every part becomes one 0/1 vector of token-level features. No decision is taken here: each feature
 * answers one small question about the tokens ("the head is name(letter) =",
 * "a top-level \le", "the letter x is free"). All decisions are weights
 * (weights.ts). Pure: no DOM, no Obsidian.
 */
import { normalize } from './normalize';

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
    /** An array with a bar in its columns (augmented: no square matrix). */
    aug?: boolean;
    /** A bare matrix environment in its own brackets. */
    wrapped?: number;
    /** \circ as a unit sign (a composition when it stands between two letters). */
    circ?: number;
    /** An arrow over two or three capitals (\overrightarrow{AB}). */
    arrow?: number;
    /** A number with an arrow (\vec 0) as a vector element. */
    num?: number;
    /** Round 4: a bold capital (\mathbf{A}) is a matrix name, not an arrow. */
    bold?: number;
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
const DROP = set('\\left \\right \\big \\Big \\bigg \\Bigg \\bigl \\bigr \\Bigl \\Bigr \\biggl \\biggr \\displaystyle \\textstyle \\limits \\nolimits \\! \\mathstrut \\, \\: \\> $ \\phantom \\hphantom ✓ ✔ \\checkmark');
const SP = new Set(['\\;', '\\ ', '~']);
const MAP: Record<string, string> = {
    '\\dfrac': '\\frac', '\\tfrac': '\\frac', '\\leq': '\\le', '\\geq': '\\ge', '\\neq': '\\ne', '\\leqslant': '\\le', '\\geqslant': '\\ge',
    '\\colon': ':', '\\rightarrow': '\\to', '\\longrightarrow': '\\to', '\\lvert': '|', '\\rvert': '|', '\\vert': '|', '\\lVert': '\\|', '\\rVert': '\\|',
    '\\dbinom': '\\binom', '\\tbinom': '\\binom', '\\phi': '\\varphi', '\\epsilon': '\\varepsilon', '\\ast': '*', '\\star': '*', '\\lbrace': '\\{', '\\rbrace': '\\}',
    '\\implies': '\\Rightarrow', '\\Longrightarrow': '\\Rightarrow', '\\Leftrightarrow': '\\iff', '\\Longleftrightarrow': '\\iff', '\\gets': '\\leftarrow',
    '\\dots': '\\dots', '\\ldots': '\\dots', '\\cdots': '\\dots', '\\vdots': '\\dots', '\\ddots': '\\dots', '\\lt': '<', '\\gt': '>', '≤': '\\le', '≥': '\\ge',
    '\\middle': '', '\\imath': 'i', '\\jmath': 'j', '\\vartheta': '\\theta', '\\mid': '\\mid', '\\prime': "'", '\\land': '\\wedge', '\\lor': '\\vee', '\\ne': '\\ne', '\\not': '\\not',
};
const GREEK = set('\\alpha \\beta \\gamma \\delta \\varepsilon \\zeta \\eta \\theta \\iota \\kappa \\lambda \\mu \\nu \\xi \\rho \\sigma \\tau \\upsilon \\varphi \\chi \\psi \\omega \\Gamma \\Delta \\Theta \\Lambda \\Xi \\Pi \\Sigma \\Phi \\Psi \\Omega \\ell \\hbar \\pi');
const FN = set('\\sin \\cos \\tan \\cot \\exp \\ln \\log \\lg \\sqrt \\arctan \\arcsin \\arccos \\sinh \\cosh \\tanh');
const FNWORD = set('sin cos tan exp ln log sgn sign abs sinh cosh tanh arctan si sinc erf');
const BIG: Record<string, string> = { '\\sum': 'sum', '\\prod': 'prod', '\\int': 'int', '\\oint': 'int', '\\iint': 'int', '\\lim': 'lim', '\\max': 'max', '\\min': 'min', '\\sup': 'max', '\\inf': 'min', '\\argmax': 'max', '\\argmin': 'min', '\\limsup': 'lim', '\\liminf': 'lim' };
const DECO: Record<string, Deco | ''> = { '\\hat': 'hat', '\\widehat': 'hat', '\\bar': 'bar', '\\overline': 'bar', '\\tilde': 'hat', '\\widetilde': 'hat', '\\vec': 'vec', '\\mathbf': 'vec', '\\boldsymbol': 'vec', '\\bm': 'vec', '\\dot': 'dot', '\\ddot': 'dot', '\\mathit': '', '\\mathsf': '', '\\underline': '', '\\overrightarrow': 'vec', '\\vv': 'vec', '\\underrightarrow': 'vec' };
const REL: Record<string, string> = { '=': 'eq', '<': 'lt', '>': 'gt', '\\le': 'le', '\\ge': 'ge', '\\ne': 'ne', '\\in': 'in', '\\to': 'to', '\\mapsto': 'mapsto', '\\approx': 'approx', '\\sim': 'sim', '\\equiv': 'equiv', '\\leftarrow': 'larrow', '\\propto': 'sim', '\\subset': 'sub', '\\subseteq': 'sub', '\\notin': 'in', '\\ll': 'other', '\\gg': 'other', '\\perp': 'other', '\\simeq': 'approx', '\\cong': 'equiv', ':': 'colon', '\\mid': 'mid', '\\nmid': 'mid', '\\prec': 'other', '\\succ': 'other', '\\preceq': 'other', '\\succeq': 'other', '\\succsim': 'other', '\\precsim': 'other' };
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
    let delta = false;
    let boldDeco = false;
    const push = (it: Item) => {
        if (deco && it.t === 'atom') {
            if (deco === 'vec' && boldDeco && /^[A-Z]$|^(Sigma|Lambda|Phi|Pi|Gamma|Theta|Omega)$/.test(String(it.base))) it.bold = 1;
            else it[deco] = 1;
            deco = null;
        }
        if (delta && it.t === 'atom') {
            it.base = 'Δ' + String(it.base);
            delta = false;
        }
        items.push(it);
        return it;
    };
    let decoAt = -1;
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
            let body = t.slice(j, e);
            const [, after] = unit(t, e + 1);
            let aug = false;
            if (name === 'array' && body[0] === '{') {
                const [spec, q] = unit(body, 0);
                aug = spec.includes('|') && !(spec[0] === '|' && spec[spec.length - 1] === '|' && spec.filter((x) => x === '|').length === 2);
                body = body.slice(q);
            }
            if (name === 'array' && body[0] === '[') {
                const q = body.indexOf(']');
                if (q > 0 && q <= 2) body = body.slice(q + 1);
            }
            body = body.filter((x) => x !== '\\hline');
            if (MATENV.has(name.replace('*', '')) || name === 'cases') {
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
                items.push({ t: 'env', name: name.replace('*', ''), rows, aug });
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
            const sRaw = u.join('').replace(/SP/g, '␣');
            const s = sRaw.replace(/␣/g, '');
            if (s === 'e') push({ t: 'atom', base: 'e', sub: '' });
            else if (s === 'd') push({ t: 'atom', base: 'd', sub: '', dd: 1 });
            else if (s === 'i' || s === 'j') push({ t: 'atom', base: s, sub: '' });
            else if (/^(min|max|argmin|argmax)$/.test(s)) {
                t = [...t.slice(0, i), '\\' + s.replace('arg', ''), ...t.slice(j)];
                continue;
            } else if (s === 'det' || s === 'Det') items.push({ t: 'det' });
            else if (FNWORD.has(s)) items.push({ t: 'fn', name: s });
            else if (!/␣/.test(sRaw) && (t[j] === '(' || t[j] === '[' || k === '\\operatorname' || k === '\\mathop')) items.push({ t: 'name', name: s });
            else if (/^[A-Z][A-Za-z]{0,3}$/.test(s) && k === '\\mathrm' && t[j] === '_') items.push({ t: 'name', name: s });
            else items.push({ t: 'text', v: sRaw });
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
        // a decoration marks the next letter only: \vec 0 or \mathbf{1} does not mark a later letter
        if (deco && decoAt >= 0 && i >= decoAt && !(/^[A-Za-z]$/.test(k) || GREEK.has(k) || k === '\\Delta' || k in DECO || (i === decoAt && /^[0-9]/.test(k)))) deco = null;
        if (deco && decoAt >= 0 && i > decoAt && /^[0-9]/.test(k)) deco = null;
        if (k === '\\Delta' && t[i + 1] in DECO && DECO[t[i + 1]]) {
            delta = true;
            i++;
            continue;
        }
        if (k in DECO) {
            const mark = DECO[k];
            if (mark) {
                deco = mark;
                decoAt = i + 1;
                boldDeco = k === '\\mathbf' || k === '\\boldsymbol' || k === '\\bm';
            }
            if (t[i + 1] === '{') {
                const [u, j] = unit(t, i + 1);
                // an arrow over two or three capitals is one name: \overrightarrow{AB}
                if (mark === 'vec' && u.length >= 2 && u.length <= 3 && u.every((x) => /^[A-Z]$/.test(x))) {
                    deco = null;
                    items.push({ t: 'atom', base: u.join(''), sub: '', vec: 1, arrow: 1 });
                    i = j;
                    continue;
                }
                // drop the braces of the decorated group
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
            // (sci stays undefined after nothing, as in the frozen code: items are compared as JSON)
            items.push({ t: 'pow', sci: p === undefined ? undefined : p.t === 'num' && p.v === '10' && /^-?[0-9]+$/.test(s) });
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
            items.push(deco === 'vec' && decoAt === i ? { t: 'num', v: k, vec: 1 } : { t: 'num', v: k });
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
        if (k === '\\circ') {
            items.push({ t: 'unit', circ: 1 });
            i++;
            continue;
        }
        if (k === '%' || k === '\\%' || k === '°' || k === '€' || k === '\\degree') {
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
    return wrapEnvs(items);
}

/** A matrix environment in its own brackets is one item: ( matrix ), [ array ], | matrix | (a determinant). */
function wrapEnvs(items0: Item[]): Item[] {
    // a composition of two plain letters is one name: (g \circ f)(x), g \circ f = ...
    let items = items0;
    if (items.some((x) => x.t === 'unit' && x.circ)) {
        const plain = (x: Item | undefined) => !!x && x.t === 'atom' && !x.vec && !x.hat && !x.bar && /^[a-zA-Z]$|^(varphi|psi|sigma|tau)$/.test(String(x.base));
        const out: Item[] = [];
        for (let i = 0; i < items.length; i++) {
            const a = items[i];
            if (a.t === 'open' && a.v === '(' && plain(items[i + 1]) && items[i + 2] && items[i + 2].circ && plain(items[i + 3]) && items[i + 4] && items[i + 4].t === 'close') {
                out.push({ t: 'name', name: 'comp' });
                i += 4;
                continue;
            }
            if (plain(a) && items[i + 1] && items[i + 1].circ && plain(items[i + 2])) {
                out.push({ t: 'name', name: 'comp' });
                i += 2;
                continue;
            }
            out.push(a);
        }
        items = out;
    }
    if (!items.some((x) => x.t === 'env')) return items;
    const out: Item[] = [];
    for (let i = 0; i < items.length; i++) {
        const a = items[i];
        const e = items[i + 1];
        const b = items[i + 2];
        if (e && b && e.t === 'env' && e.name !== 'cases' && e.name !== 'vmatrix') {
            const bare = e.name === 'matrix' || e.name === 'array' || e.name === 'smallmatrix';
            if (a.t === 'open' && b.t === 'close' && bare) {
                out.push({ ...e, wrapped: 1 });
                i += 2;
                continue;
            }
            if (a.t === 'sym' && a.v === '|' && b.t === 'sym' && b.v === '|') {
                out.push({ ...e, name: 'vmatrix' });
                i += 2;
                continue;
            }
        }
        out.push(a);
    }
    return out;
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

/**
 * Parts of a formula (segmentation). Cuts, all at bracket depth 0:
 *   joins         \Rightarrow \iff \Leftarrow \quad \qquad, two space commands in a row
 *   words         \text{für}, \text{und}, \text{s.t.}, \text{(Kreis)} ... (a unit after a number and a name before a letter are no words)
 *   lists         a comma or semicolon when both sides are statements (each has a relation): "a = 2, b = 3" but not "x_1, x_2 \ge 0"
 *   side remarks  a bracket at the end that holds a statement: "... \; (x > 0)"
 * side[i] is true for a part that only restricts an earlier part (after für / for / if ..., or in a bracket).
 */
const W_COND = /(^|[^a-zäöüß])(für|fuer|fur|for|mit|with|wobei|where|falls|if|wenn|when|sofern|whenever|solange|while|da|since|weil|because|unless|given|gegeben|nur|only|provided|gilt|holds|valid|gültig)($|[^a-zäöüß])/i;
const W_AND = /(^|[^a-zäöüß])(und|and|oder|or|sowie|bzw|aber|but|also|dann|then|d\.h|i\.e|sei|let|somit|hence|thus|folglich|daher|damit|so|bzw\.|resp|sowie|ergibt|gives|yields|liefert|folgt|daraus)($|[^a-zäöüß])/i;
const W_ST = /^[␣(]*(s\.?␣?t\.?|u\.?␣?d\.?␣?N\.?|subject␣to|such␣that|unter␣der␣Nebenbedingung|unter␣den␣Nebenbedingungen|NB:?|u\.␣?d\.␣?NB\.?)[␣:)]*$/i;
const W_SET = /^[␣]*(mit|with|wobei|where|so␣?dass|such␣that|s\.␣?t\.|für␣die|for␣which|sodass|und|and)[␣:]*$/i;
const STMT = new Set(['eq', 'lt', 'gt', 'le', 'ge', 'ne', 'in', 'approx', 'to', 'mapsto', 'sub', 'equiv', 'sim', 'colon', 'larrow', 'other']);
const hasTopRel = (its: Item[]) => {
    const d = depths(its);
    return its.some((x, i) => d[i] === 0 && x.t === 'rel' && STMT.has(String(x.v)));
};
function segments(items: Item[]): { segs: Item[][]; joins: string[]; side: boolean[] } {
    const d = depths(items);
    // 1. joins and words
    const segs: Item[][] = [[]];
    const joins: string[] = [];
    const side: boolean[] = [false];
    const cut = (type: string, isSide?: boolean) => {
        segs.push([]);
        joins.push(type);
        side.push(!!isSide);
    };
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (d[i] !== 0) {
            segs[segs.length - 1].push(it);
            continue;
        }
        if (it.t === 'join') {
            cut(String(it.v), side[side.length - 1] && (it.v === '\\quad' || it.v === '\\qquad') && segs[segs.length - 1].length === 0);
            continue;
        }
        if (it.t === 'sp' && items[i + 1] && items[i + 1].t === 'sp') {
            while (items[i + 1] && items[i + 1].t === 'sp') i++;
            cut('\\quad', side[side.length - 1] && segs[segs.length - 1].length === 0);
            continue;
        }
        if (it.t === 'text') {
            const v = String(it.v);
            let j = i - 1;
            while (j >= 0 && items[j].t === 'sp') j--;
            const afterNum = j >= 0 && (items[j].t === 'num' || items[j].t === 'unit' || (items[j].t === 'rb' && /^[^␣]{1,4}$/.test(v)));
            const next = items[i + 1];
            if (W_ST.test(v)) {
                cut('st');
                continue;
            }
            if (afterNum && !/␣[a-zäöü]{2,}/i.test(v.replace(/^␣+/, '')) && !W_COND.test(v) && !W_AND.test(v)) {
                segs[segs.length - 1].push(it);
                continue;
            }
            if (W_COND.test(v)) {
                cut('cond', true);
                continue;
            }
            if (W_AND.test(v)) {
                cut('and');
                continue;
            }
            const glued = !/[␣(:.,]/.test(v) && next && d[i + 1] === 0 && (next.t === 'atom' || next.t === 'rel' || next.t === 'open' || next.t === 'sym');
            const gluedBefore = !/[␣(:.,]/.test(v) && i > 0 && (items[i - 1].t === 'rel' || (items[i - 1].t === 'sym' && /^(\+|-|cdot|times|\/)$/.test(String(items[i - 1].v))));
            if (glued || gluedBefore) {
                segs[segs.length - 1].push(it);
                continue;
            }
            // a label in brackets is a remark; other words stay in the part (a sentence about the formula)
            if (/^␣*\(.*\)[␣.,]*$/.test(v)) {
                cut('remark');
                continue;
            }
            segs[segs.length - 1].push(it);
            continue;
        }
        segs[segs.length - 1].push(it);
    }
    // 2. lists of statements
    const segs2: Item[][] = [];
    const joins2: string[] = [];
    const side2: boolean[] = [];
    segs.forEach((s, k) => {
        const ds = depths(s);
        const chunks: Item[][] = [[]];
        const seps: Item[] = [];
        s.forEach((x, i) => {
            if (ds[i] === 0 && x.t === 'sym' && (x.v === ',' || x.v === ';')) {
                chunks.push([]);
                seps.push(x);
            } else chunks[chunks.length - 1].push(x);
        });
        const outp: Item[][] = [];
        let pending: Item[] = [];
        chunks.forEach((c, i) => {
            if (hasTopRel(c)) {
                outp.push([...pending, ...c]);
                pending = [];
            } else {
                pending.push(...c);
                if (i < chunks.length - 1) pending.push(seps[i]);
            }
        });
        if (pending.length) {
            if (outp.length) outp[outp.length - 1].push({ t: 'sym', v: ',' }, ...pending);
            else outp.push(pending);
        }
        if (!outp.length) outp.push([]);
        outp.forEach((o, i) => {
            segs2.push(o);
            side2.push(side[k]);
            if (i > 0) joins2.push(',');
            else if (k > 0) joins2.push(joins[k - 1]);
        });
    });
    // 3. a bracket at the end that holds a statement
    const segs3: Item[][] = [];
    const joins3: string[] = [];
    const side3: boolean[] = [];
    segs2.forEach((s0, k) => {
        const s = s0.slice();
        while (s.length && (s[s.length - 1].t === 'sp' || (s[s.length - 1].t === 'sym' && /^[,.;]$/.test(String(s[s.length - 1].v))))) s.pop();
        const ds = depths(s);
        let open = -1;
        if (s.length && s[s.length - 1].t === 'close' && s[s.length - 1].v === ')')
            for (let i = s.length - 2; i >= 0; i--)
                if (ds[i] === 0 && s[i].t === 'open') {
                    open = s[i].v === '(' ? i : -1;
                    break;
                }
        const inner = open >= 0 ? s.slice(open + 1, -1) : null;
        if (k > 0) joins3.push(joins2[k - 1]);
        if (inner && hasTopRel(inner) && !inner.some((x, i) => depths(inner)[i] === 0 && x.t === 'sym' && x.v === ',') && (open === 0 || s[open - 1].t === 'sp')) {
            if (open > 0) {
                segs3.push(s.slice(0, open));
                side3.push(side2[k]);
                joins3.push('paren');
            }
            segs3.push(inner);
            side3.push(true);
        } else {
            segs3.push(s0);
            side3.push(side2[k]);
        }
    });
    const strip = (s: Item[]) => {
        let a = 0;
        let b = s.length;
        while (a < b && (s[a].t === 'sp' || (s[a].t === 'sym' && (s[a].v === ',' || s[a].v === ';')))) a++;
        while (b > a && (s[b - 1].t === 'sp' || (s[b - 1].t === 'sym' && (s[b - 1].v === ',' || s[b - 1].v === '.' || s[b - 1].v === ';')))) b--;
        return s.slice(a, b).filter((x) => x.t !== 'sp');
    };
    const out = segs3.map(strip);
    // a side part needs a main part before it
    let seen = false;
    const sideOut = out.map((s, i) => {
        const r = side3[i] && seen;
        if (s.length) seen = true;
        return r;
    });
    return { segs: out, joins: joins3, side: sideOut };
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
// round 4: an expression in parameters only (U, b + M, 2c): the letters the chart reads as sliders
const NOPARAM = /^(x|y|z|t|s|i|j|k|l|m|n|N|ell|u|e|d)$/;
function paramExpr(p: Item[], bin: ReadonlySet<string> | null | undefined): boolean {
    let atoms = 0;
    for (const x of p) {
        if (x.t === 'atom') {
            const b = String(x.base);
            if (!/^[a-zA-Z]$/.test(b) || NOPARAM.test(b) || x.star || x.prime || x.vec || x.hat || x.bar || (x.sub && !/^[0-9]$/.test(x.sub)) || (bin && bin.has(b))) return false;
            atoms++;
            continue;
        }
        if (x.t === 'num' || x.t === 'frac' || x.t === 'lb' || x.t === 'rb') continue;
        if (x.t === 'sym' && /^(\+|-|cdot|\/)$/.test(String(x.v))) continue;
        return false;
    }
    return atoms > 0;
}
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
    return { nums, r, c, square: !env.aug && r === c && (r === 2 || r === 3) && rows.every((x) => x.length === c), col: c === 1 && r >= 2, letters, dots: cells.some((cell) => cell.includes('\\dots')) };
}

// ---- round 3: written vectors, the note's values, set builders.

/** A written vector: where it ends, its entries, the letters in them, and what its spelling says. */
interface VecLit {
    end: number;
    n: number;
    letters: Set<string>;
    /** The spelling alone says vector (a column, a transposed row or tuple, angle brackets). */
    definite: boolean;
    kind: 'col' | 'row' | 'binom' | 'tuple' | 'top' | 'angle';
    zero: boolean;
    /** Shares that sum to 1 (a distribution). */
    stoch: boolean;
    /** How many entries hold a letter. */
    withLetter: number;
    /** Round 4: the entries as numbers (NaN where an entry is no single number). */
    vals: number[];
}

/** One element of a side read as a vector expression. */
type VecEl = { k: 'lit'; lit: VecLit } | { k: 'atom'; a: Item } | { k: 'num' } | { k: 'pm' } | { k: 'dot' } | { k: 'cross' };

/** What a side is (sideClass). */
interface SideClass {
    c: 'num' | 'param' | 'other' | 'prod' | 'lit' | 'comb' | 'nameprod' | 'namefactor' | 'names' | 'unknown';
    lits?: VecLit[];
    atoms?: Item[];
    single?: boolean;
    scalar?: boolean;
}

const isSepV = (x: Item) => (x.t === 'sym' && (x.v === ',' || x.v === ';' || x.v === '|')) || (x.t === 'rel' && x.v === 'mid');
const dkey = (a: Item) => String(a.base) + (a.sub ? '_' + a.sub : '');

/** The letters of one entry of a vector (a number, or an expression of numbers and letters); null when it is no entry. */
function entryLetters(its: Item[]): Set<string> | null {
    const letters = new Set<string>();
    let some = false;
    for (const x of its) {
        if (x.t === 'num') {
            some = true;
            continue;
        }
        if (x.t === 'frac' || x.t === 'lb' || x.t === 'rb' || x.t === 'pow' || x.t === 'fn') continue;
        if ((x.t === 'open' && x.v === '(') || (x.t === 'close' && x.v === ')')) continue;
        if (x.t === 'sym' && /^(\+|-|cdot|\/)$/.test(String(x.v))) continue;
        if (x.t === 'atom' && !x.star && !x.prime && !x.vec) {
            some = true;
            if (!((x.base === 'pi' || x.base === 'e') && !x.sub)) letters.add(key(x));
            continue;
        }
        return null;
    }
    return some ? letters : null;
}

/**
 * A written vector that starts at its[i]: a column environment, a row with
 * a transposition sign, a tuple, \binom, angle brackets; null when none
 * starts there.
 */
function vecLiteral(its: Item[], i: number): VecLit | null {
    const x = its[i];
    if (!x) return null;
    const mk = (entries: Item[][], end: number, definite: boolean, kind: VecLit['kind']): VecLit | null => {
        const letters = new Set<string>();
        for (const e of entries) {
            const l = entryLetters(e);
            if (!l) return null;
            for (const k of l) letters.add(k);
        }
        // the entries as numbers (when each is one number): the zero vector, and a list of shares that sum to 1
        const vals = entries.map((e) => {
            const q = e[0] && e[0].t === 'sym' && e[0].v === '-' ? e.slice(1) : e;
            return q.length === 1 && q[0].t === 'num' ? (q === e ? 1 : -1) * Number(q[0].v) : NaN;
        });
        const zero = vals.every((v) => v === 0);
        const stoch = vals.every((v) => v >= 0 && v < 1) && Math.abs(vals.reduce((a, b) => a + b, 0) - 1) < 1e-9;
        const withLetter = entries.filter((e) => (entryLetters(e)?.size ?? 0) > 0).length;
        return { end, n: entries.length, letters, definite, kind, zero, stoch, withLetter, vals };
    };
    if (x.t === 'env') {
        const rows = x.rows ?? [];
        if (x.name === 'vmatrix' || x.name === 'Vmatrix' || x.name === 'cases' || x.aug) return null;
        const r = rows.length;
        const c = Math.max(...rows.map((q) => q.length));
        if (c === 1 && r >= 2) return mk(rows.map((q) => parse(q[0])), i + 1, true, 'col');
        if (r === 1 && c >= 2 && its[i + 1] && its[i + 1].t === 'top') return mk(rows[0].map((q) => parse(q)), i + 2, true, 'row');
        return null;
    }
    if (x.t === 'binom') {
        const groups: Item[][] = [];
        let j = i + 1;
        for (let g = 0; g < 2; g++) {
            if (!its[j] || its[j].t !== 'lb') return null;
            let d = 0;
            const s = j;
            for (; j < its.length; j++) {
                if (its[j].t === 'lb') d++;
                else if (its[j].t === 'rb' && --d === 0) break;
            }
            groups.push(its.slice(s + 1, j));
            j++;
        }
        const b = mk(groups, j, false, 'binom');
        return b && b.letters.size === 0 ? b : null;
    }
    const angle = x.t === 'sym' && x.v === 'angle';
    if (x.t === 'open' || angle) {
        let j = i + 1;
        let d = 1;
        const entries: Item[][] = [[]];
        for (; j < its.length; j++) {
            const y = its[j];
            if (angle) {
                if (y.t === 'sym' && y.v === '\\rangle') break;
            } else if (y.t === 'open' || y.t === 'lb' || y.t === 'sopen') d++;
            else if (y.t === 'close' || y.t === 'rb' || y.t === 'sclose') {
                if (--d === 0) break;
            }
            if (d === 1 && isSepV(y)) entries.push([]);
            else entries[entries.length - 1].push(y);
        }
        if (j >= its.length || entries.length < 2) return null;
        if (!angle && (x.v === '(') !== (its[j].v === ')')) return null;
        const top = !!its[j + 1] && its[j + 1].t === 'top';
        if (!angle && x.v === '[' && !top) return null;
        const lit = mk(entries, top ? j + 2 : j + 1, top || angle, top ? 'top' : angle ? 'angle' : 'tuple');
        return angle && lit && lit.letters.size ? null : lit;
    }
    return null;
}

/** One side of an equation as a list of vector elements (written vectors, numbers, signs, product signs, letters); null when something else is in it. */
function vecSide(its: Item[]): VecEl[] | null {
    const els: VecEl[] = [];
    for (let i = 0; i < its.length; ) {
        // an inner product of two written vectors: < (1, -1), (1, 1) >
        if (its[i].t === 'sym' && its[i].v === 'angle') {
            const e = its.findIndex((y, q) => q > i && y.t === 'sym' && y.v === '\\rangle');
            const ch =
                e > 0
                    ? commaSplit(its.slice(i + 1, e)).map((c) => {
                          const l = vecLiteral(c, 0);
                          return l && l.end === c.length ? l : null;
                      })
                    : [];
            const [c0, c1] = ch;
            if (ch.length === 2 && c0 && c1) {
                els.push({ k: 'lit', lit: c0 }, { k: 'dot' }, { k: 'lit', lit: c1 });
                i = e + 1;
                continue;
            }
        }
        const lit = vecLiteral(its, i);
        if (lit) {
            els.push({ k: 'lit', lit });
            i = lit.end;
            continue;
        }
        const x = its[i];
        if (x.t === 'num' && x.vec) {
            els.push({ k: 'atom', a: { t: 'atom', base: x.v, sub: '', vec: 1, num: 1 } });
            i++;
            continue;
        }
        if (x.t === 'num') {
            els.push({ k: 'num' });
            i++;
            continue;
        }
        if (x.t === 'frac' || (x.t === 'fn' && x.name === 'sqrt')) {
            // a fraction or a root of numbers is a number
            let j = i + 1;
            let ok = true;
            for (let g = 0; g < (x.t === 'frac' ? 2 : 1); g++) {
                if (its[j] && its[j].t === 'lb') {
                    let d = 0;
                    for (; j < its.length; j++) {
                        const y = its[j];
                        if (y.t === 'lb') d++;
                        else if (y.t === 'rb') {
                            if (--d === 0) break;
                        } else if (!(y.t === 'num' || y.t === 'frac' || y.t === 'fn' || y.t === 'pow' || y.t === 'open' || y.t === 'close' || (y.t === 'sym' && /^(\+|-|cdot)$/.test(String(y.v))))) ok = false;
                    }
                    j++;
                } else if (its[j] && its[j].t === 'num') j++;
                else ok = false;
            }
            if (!ok) return null;
            els.push({ k: 'num' });
            i = j;
            continue;
        }
        if (x.t === 'sym' && (x.v === '+' || x.v === '-')) {
            els.push({ k: 'pm' });
            i++;
            continue;
        }
        if (x.t === 'sym' && x.v === 'cdot') {
            els.push({ k: 'dot' });
            i++;
            continue;
        }
        if (x.t === 'sym' && x.v === 'times') {
            els.push({ k: 'cross' });
            i++;
            continue;
        }
        if (x.t === 'atom' && !x.star && !x.prime && !x.top && !x.inv) {
            els.push({ k: 'atom', a: x });
            i++;
            // round 4: an iterate's index (v^{(1)}) belongs to its name
            if (its[i] && its[i].t === 'layer') i++;
            continue;
        }
        // a unit after a number is a label (3 N e_x); \circ between vectors is the dot product
        if (x.t === 'text' && i > 0 && (its[i - 1].t === 'num' || els[els.length - 1].k === 'lit') && /^[^␣]{1,6}$/.test(String(x.v))) {
            i++;
            continue;
        }
        if (x.t === 'unit' && els.length && (els[els.length - 1].k === 'lit' || els[els.length - 1].k === 'atom')) {
            els.push({ k: 'dot' });
            i++;
            continue;
        }
        return null;
    }
    return els;
}

/**
 * What a side is: num, lit (one written vector), comb (a sum of written
 * vectors with numbers as factors), prod (dot or cross product of two
 * written vectors), param (a letter times a written vector), names (a sum
 * of letters), nameprod, namefactor, other.
 */
function sideClass(els: VecEl[]): SideClass {
    const lits: VecLit[] = [];
    const atoms: Item[] = [];
    for (const e of els) {
        if (e.k === 'lit') lits.push(e.lit);
        else if (e.k === 'atom') atoms.push(e.a);
    }
    const k = (i: number) => (els[i] ? els[i].k : '');
    if (!lits.length && !atoms.length) return { c: 'num' };
    if (lits.length && atoms.length) return { c: 'param', lits };
    if (lits.length) {
        if (els.some((e, i) => e.k === 'lit' && k(i + 1) === 'lit')) return { c: 'other' };
        const prod = els.some((e, i) => (e.k === 'dot' || e.k === 'cross') && k(i - 1) === 'lit' && k(i + 1) === 'lit');
        // a cross product lives in space: (-1, 1) \times (-1, 1) is a product of intervals
        if (prod) return lits.length === 2 && els.length === 3 && (els[1].k === 'dot' || lits.every((l) => l.n === 3)) ? { c: 'prod', lits } : { c: 'other' };
        if (els.some((e) => e.k === 'cross')) return { c: 'other' };
        return { c: els.length === 1 ? 'lit' : 'comb', lits };
    }
    const prod = els.some((e, i) => (e.k === 'dot' || e.k === 'cross') && k(i - 1) === 'atom' && k(i + 1) === 'atom');
    const factor = els.some((e, i) => e.k === 'atom' && k(i + 1) === 'atom');
    const numAfter = els.some((e, i) => e.k === 'num' && (k(i - 1) === 'atom' || (k(i - 1) === 'dot' && k(i - 2) === 'atom')));
    return { c: prod ? 'nameprod' : factor || numAfter ? 'namefactor' : 'names', atoms, single: els.length === 1, scalar: els.some((e) => e.k === 'num') };
}

/** Split a list of items at its top-level commas and semicolons. */
function commaSplit(its: Item[]): Item[][] {
    const d = depths(its);
    const out: Item[][] = [[]];
    its.forEach((x, i) => {
        if (d[i] === 0 && x.t === 'sym' && (x.v === ',' || x.v === ';')) out.push([]);
        else out[out.length - 1].push(x);
    });
    return out;
}

/** The vector facts of one part. */
function vectorFacts(parts0: Item[][], rels0: string[], defs: DefNames): Answers {
    const f: Answers = {};
    let parts = parts0;
    let rels = rels0;
    // "... \in R^2" after a vector is a remark; "= \dots =" stands for steps
    if (rels.length && rels[rels.length - 1] === 'in' && parts[parts.length - 1].length === 1 && parts[parts.length - 1][0].t === 'bb') {
        parts = parts.slice(0, -1);
        rels = rels.slice(0, -1);
    }
    // a dot product of written vectors that ends in "\ne 0"
    if (rels.length >= 2 && rels[rels.length - 1] === 'ne' && isNumLike(parts[parts.length - 1])) {
        parts = parts.slice(0, -1);
        rels = rels.slice(0, -1);
    }
    if (!rels.every((r) => r === 'eq' || r === 'approx')) return f;
    parts = parts.filter((p) => !(p.length === 1 && p[0].t === 'sym' && p[0].v === '\\dots'));
    if (!parts.length || parts.some((p) => !p.length)) return f;
    const conclude = (lits: VecLit[], sure: boolean, soft: boolean) => {
        const n = lits[0].n;
        const letters = new Set(lits.flatMap((l) => [...l.letters]));
        // 2 or 3 entries; one parameter letter at most, and in one entry only (a point that moves with t is a line)
        if (!((n === 2 || n === 3) && lits.every((l) => l.n === n && l.withLetter <= 1) && letters.size <= 1)) return;
        if (sure || lits.every((l) => l.definite)) f.vecLit = true;
        else {
            f.vecPlain = true;
            f.vecSoft = soft || lits.every((l) => l.kind === 'binom');
        }
        f.vecZero = lits.every((l) => l.zero);
        f.vecStoch = lits.some((l) => l.stoch);
    };
    // a list of written vectors: (1, 0), (0, 1)
    if (parts.length === 1) {
        const ch = commaSplit(parts[0]);
        if (ch.length >= 2) {
            const lits: VecLit[] = [];
            for (const c of ch) {
                const l = vecLiteral(c, 0);
                if (!l || l.end !== c.length) return f;
                lits.push(l);
            }
            conclude(lits, false, true);
            return f;
        }
    }
    // each side: a class, or unknown (something that is no vector expression: a fraction with |a|, a call)
    const cls: SideClass[] = parts.map((p) => {
        const s = vecSide(p);
        return !s || !s.length || /^(pm|dot|cross)$/.test(s[s.length - 1].k) ? { c: 'unknown' } : sideClass(s);
    });
    const litsOf = (c: SideClass) => c.lits ?? [];
    const atomsOf = (c: SideClass) => c.atoms ?? [];
    // a tuple on one side of an equation: a pair of values, no curve
    f.tupleSide = parts.length >= 2 && cls.some((c) => c.c === 'lit' && (litsOf(c)[0].kind === 'tuple' || litsOf(c)[0].kind === 'top'));
    const headed = parts.length >= 2 && cls[0].c === 'names' && !!cls[0].single;
    const head = headed ? atomsOf(cls[0])[0] : null;
    const rest = headed ? cls.slice(1) : cls;
    // the first side must be a name or a vector expression; a letter times a written vector anywhere is a line
    // (an operator name with letters is a name too: \operatorname{proj}_a b = ...)
    // a numeric gradient (\nabla f = (3, 2), \nabla f(x^*) = (2, 2)) is a name with a value: an arrow only when the text says so
    const nablaHead = parts.length === 2 && parts[0][0].t === 'sym' && parts[0][0].v === 'nabla';
    const opHead = nablaHead || (parts.length >= 2 && parts[0][0].t === 'name' && parts[0].slice(1).every((x) => x.t === 'atom'));
    // any expression of small letters = one written tuple (x^* - x^{(0)} = (3, 1)): an arrow only when the text says so
    if (
        !headed &&
        !opHead &&
        cls[0].c === 'unknown' &&
        parts.length === 2 &&
        cls[1].c === 'lit' &&
        !parts[0].some((x) => x.t === 'env' || x.t === 'big' || x.t === 'open' || x.t === 'top' || (x.t === 'sym' && x.v === 'nabla') || (x.t === 'atom' && /^[A-Z]/.test(String(x.base)))) &&
        parts[0].filter((x) => x.t === 'atom').length >= 2
    ) {
        const before = f.tupleSide;
        conclude(litsOf(cls[1]), false, false);
        f.vecLit = false;
        f.vecAnyHead = !!f.vecPlain || litsOf(cls[1])[0].definite;
        f.vecPlain = false;
        f.tupleSide = before;
        if (f.vecAnyHead) {
            f.vecPlain = true;
            f.vecHeadData = true;
        }
        return f;
    }
    if (!headed && !opHead && (cls[0].c === 'unknown' || cls[0].c === 'other' || cls[0].c === 'num')) return f;
    // V10: a capital times something on the first side is a matrix product, never a vector calculation
    if (cls.some((s) => s.c === 'param') || (cls[0].c === 'namefactor' && atomsOf(cls[0]).some((x) => /^[A-Z]$/.test(String(x.base)) && !x.vec))) return f;
    const conc = rest.filter((s) => s.c === 'lit' || s.c === 'comb' || s.c === 'prod');
    let hasProd = false;
    if (conc.length) {
        hasProd = conc.some((s) => s.c === 'prod');
        const numSide = rest.some((s) => s.c === 'num');
        // the spelling is sure: a product, a sum or a multiple of written vectors, or a side of arrow names next to the tuple
        const sure = hasProd || conc.some((s) => s.c === 'comb') || rest.some((s) => (s.c === 'names' || s.c === 'nameprod') && atomsOf(s).every((x) => x.vec || x.bold));
        if (!numSide || hasProd) conclude(conc.flatMap(litsOf), sure && !nablaHead, false);
        if (nablaHead) {
            f.vecNabla = !!(f.vecLit || f.vecPlain);
            f.vecLit = false;
            f.vecPlain = false;
            f.vecSoft = false;
        }
    } else {
        // a sum, a difference or a multiple of names
        const side = rest.find((s) => s.c === 'names' && (atomsOf(s).length >= 2 || s.scalar));
        if (side && rest.every((s) => s.c === 'names')) {
            const a = atomsOf(side);
            const distinct = new Set(a.map(dkey)).size === a.length;
            if (a.every((x) => x.base === 'e' && /^[123xyz]$/.test(x.sub ?? '')) && distinct) {
                if (a.every((x) => x.vec || x.hat)) f.vecBasis = true;
                else f.vecBasisPlain = true;
            } else if (a.every((x) => /^[ijk]$/.test(String(x.base)) && !x.sub) && distinct && a.length >= 2) {
                if (a.every((x) => x.vec || x.hat)) f.vecBasis = true;
                else f.vecBasisPlain = true;
            } else if (a.every((x) => defs.sure.has(dkey(x)) || (x.vec && defs.vecs.has(dkey(x))))) f.vecNamesDef = true;
        }
    }
    if (head) {
        const base = String(head.base);
        f.vecHeadDeco = !!head.vec || !!head.bold || (!!head.hat && /^[a-z]$/.test(base));
        // known as a vector: an arrow elsewhere, a matrix applied to it in a formula nearby (A v), a basis vector e_1, e_2, e_3
        f.vecHeadKnown = defs.sure.has(dkey(head)) || defs.deco.has(base) || (defs.applied.has(base) && !/^[xyz]$/.test(base)) || (base === 'e' && /^[123]$/.test(head.sub ?? ''));
        f.vecHeadName = base + (head.sub ? '_' + head.sub : '');
        // T3: d is the search direction of a method in a note on optimisation
        f.vecHeadD = base === 'd' && !head.sub;
        f.vecHeadCap = /^[A-Z]$/.test(base) && !head.vec && !head.bold && !hasProd;
        // x, y, z, b: the letters of a linear system and of data points; pi, mu, nu: distributions
        f.vecHeadSys = /^[xyz]$/.test(base) || (base === 'b' && !head.vec);
        f.vecHeadIter = !!head.layer && !/^[uvwd]$/.test(base);
        // in a note on learning only a weight or normal vector without an index is an arrow (V7)
        f.vecHeadData = !(/^[wn]$/.test(base) && !head.sub);
        f.vecProb = /^(pi|mu|nu|lambda)$/.test(base);
    }
    if (!head) f.vecHeadData = true;
    return f;
}

/** What one formula of the note defines: names with a written vector (sure: by its spelling or an arrow), numeric square matrices, arrow letters, real domains. */
interface DefInfo {
    vecs: string[];
    sure: string[];
    mats: string[];
    mats3: string[];
    deco: string[];
    doms: string[];
}

const DEF_HINT = /\\begin\{|\\top|\^\s*\{?\s*T|\\vec|\\mathbf|\\overrightarrow|\\boldsymbol|\\binom|=\s*\(|\[\[|⃗/;
const defMemo = new Map<string, DefInfo>();

/** What one formula of the note defines (remembered per string). */
function defInfo(d: string): DefInfo {
    const known = defMemo.get(d);
    if (known) return known;
    const hit: DefInfo = { vecs: [], sure: [], mats: [], mats3: [], deco: [], doms: [] };
    for (const m of d.matchAll(/\\(?:vec|mathbf|boldsymbol|bm|overrightarrow)\s*\{?\s*([A-Za-z])/g)) hit.deco.push(m[1]);
    for (const m of d.matchAll(/([A-Za-z])⃗/g)) hit.deco.push(m[1]);
    for (const m of d.matchAll(/(?:^|[^A-Za-z\\])([A-Z])(?:_\{?[A-Za-z0-9]+\}?)?\s*(?::?=|\\subseteq|\\subset(?![a-z])|⊆|⊂)\s*(?:\\left\s*)?(?:\\mathbb|ℝ|\[|\(|\\\{|\\lbrace)/g)) hit.doms.push(m[1]);
    if (DEF_HINT.test(d)) {
        try {
            const its = parse(clean(normalize(d).tex));
            for (const seg of segments(its).segs) {
                const { parts, rels } = relSplit(seg);
                if (rels[0] !== 'eq' || parts[0].length !== 1 || parts[0][0].t !== 'atom') continue;
                const a = parts[0][0];
                for (const side of parts.slice(1)) {
                    const lit = vecLiteral(side, 0);
                    if (lit && lit.end === side.length && (lit.n === 2 || lit.n === 3) && lit.letters.size <= 1 && (lit.definite || a.vec || /^[a-z]/.test(String(a.base)))) {
                        hit.vecs.push(dkey(a));
                        if (lit.definite || a.vec) hit.sure.push(dkey(a));
                    }
                    if (side.length === 1 && side[0].t === 'env' && side[0].name !== 'vmatrix') {
                        const m = matrixInfo(side[0]);
                        if (m.square && m.nums && m.letters.size === 0) (m.r === 2 ? hit.mats : hit.mats3).push(String(a.base));
                    }
                }
            }
        } catch {
            // a formula the parser cannot read defines nothing
        }
    }
    if (defMemo.size > 4000) defMemo.clear();
    defMemo.set(d, hit);
    return hit;
}

/** A set in braces: the side it is (q), what is inside, the separator's index in it (or -1), the element and the condition. */
export interface SetBuilder {
    q: number;
    inner: Item[];
    sep: number;
    el: Item[];
    cond: Item[];
}

/** The first side of a part (of the first three) that is one pair of set braces, or null. */
function setBuilder(parts: Item[][], rels: string[]): SetBuilder | null {
    if (!rels.every((r) => r === 'eq' || r === 'approx')) return null;
    for (let q = 0; q < parts.length && q < 3; q++) {
        const p = parts[q];
        if (p.length < 3 || p[0].t !== 'sopen' || p[p.length - 1].t !== 'sclose') continue;
        const dp = depths(p);
        if (p.slice(1, -1).some((x, i) => x.t === 'sclose' && dp[i + 1] === 0)) continue;
        const inner = p.slice(1, -1);
        const di = depths(inner);
        let sep = inner.findIndex((x, i) => di[i] === 0 && ((x.t === 'rel' && (x.v === 'mid' || x.v === 'colon')) || (x.t === 'sym' && x.v === '|')));
        if (sep < 0) {
            // a semicolon or a word (mit, with, such that) separates when a condition follows
            const cand = inner.findIndex((x, i) => di[i] === 0 && ((x.t === 'sym' && x.v === ';') || (x.t === 'text' && W_SET.test(String(x.v)))));
            if (cand > 0 && hasTopRel(inner.slice(cand + 1)) && inner.filter((x, i) => di[i] === 0 && x.t === 'sym' && x.v === ';').length <= 1) sep = cand;
        }
        return { q, inner, sep, el: sep > 0 ? inner.slice(0, sep) : [], cond: sep > 0 ? inner.slice(sep + 1) : [] };
    }
    return null;
}

/** A set of pairs given by ONE equation is a curve (rubric_r3.md S3): the equation, with the two coordinates named x and y; null otherwise. */
function setCurve(sb: SetBuilder | null): Item[] | null {
    if (!sb || sb.sep <= 0) return null;
    const { el, cond } = sb;
    const pair =
        el.length >= 5 &&
        el[0].t === 'open' &&
        el[4].t === 'close' &&
        el[2].t === 'sym' &&
        el[2].v === ',' &&
        el[1].t === 'atom' &&
        el[3].t === 'atom' &&
        (el.length === 5 || (el.length === 7 && el[5].t === 'rel' && el[5].v === 'in' && el[6].t === 'bb' && el[6].v === 'ℝ'));
    const plane = el.length === 3 && el[0].t === 'atom' && el[1].t === 'rel' && el[1].v === 'in' && el[2].t === 'bb' && el[2].v === 'ℝ' && el[2].pow === '2';
    if (!pair && !plane) return null;
    const dc = depths(cond);
    if (cond.some((x, i) => dc[i] === 0 && ((x.t === 'sym' && (x.v === ',' || x.v === ';')) || x.t === 'text'))) return null;
    const { rels } = relSplit(cond);
    if (rels.length !== 1 || rels[0] !== 'eq') return null;
    if (!pair) return cond;
    const a = el[1];
    const b = el[3];
    const std = (key(a) === 'x' && key(b) === 'y') || (key(a) === 'x_1' && key(b) === 'x_2');
    if (std) return cond;
    return cond.map((x): Item => (x.t !== 'atom' ? x : key(x) === key(a) ? { t: 'atom', base: 'x', sub: '' } : key(x) === key(b) ? { t: 'atom', base: 'y', sub: '' } : x));
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
paramPair anyLogic anyVec anyPm afterWord genericProgram laterEval bodyHasInit
prose rowCont unreadable ctxLine c_lhsCtxVar ivHasInf laterSolve pointCoords
vecLit vecPlain vecNamesDef vecBasis vecBasisPlain vecHeadDeco vecHeadKnown vecHeadCap ctxVecWord ctxPointWord ctxTable
hcRandom vecHeadSys vecHeadData vecProb vecZero vecStoch vecSoft noteVec ctxSolveWord ctxDim ivDef ivImage setCallBad tupleSide matAlone prodWritten prodMixed prodEval prodMap matKnown setCondRel setSpace setText setEmpty mapRuleLater
setAbstract c_lhsXY c_midX12 c_midXY c_symVar bigM binVar bodyOnlyXk recMatStep ivLowHead
ctxProg2 ctxX3 ctxXVec ctxXScalar afterIndicator supName eqvForms ctxPlaneName argPair
ha_x1 ha_x2 setEqCall ivNoIv c_rhsParam c_endsPar lin2 extraVar nlOne vecBound ctxPairNear vecNabla ctxVecAfter vecHeadIter ctxIndicator ctxNumRow ha_u ctxProgWord
runOne hasOp lagr detPoly lin2eq ctxCountNoun vecHeadD runZ hasUnit`.split(/\s+/);
const INDEX = new Map(FEATURES.map((n, i) => [n, i]));
const at = (name: string): number => {
    const k = INDEX.get(name);
    if (k === undefined) throw new Error(`no feature ${name}`);
    return k;
};

/** The other formulas of a context line. The window of 10 words may cut a formula, so the dollars are paired from [F] outwards. */
export function contextFormulas(context: string | null | undefined): string[] {
    const c = String(context ?? '');
    const k = c.indexOf('[F]');
    const out: string[] = [];
    const b = (k >= 0 ? c.slice(0, k) : c).split('$');
    const a = k >= 0 ? c.slice(k + 3).split('$') : [];
    for (let i = b.length - 2; i >= 0; i -= 2) if (b[i].trim()) out.unshift(b[i]);
    for (let i = 1; i < a.length - 1; i += 2) if (a[i].trim()) out.push(a[i]);
    return out;
}

/** Round 4: what the words and the other formulas of the context line say about the note (no features themselves). */
interface ContextFacts {
    /** Letters a matrix is applied to in the formulas nearby (A v, Tv = 2v). */
    applied: Set<string>;
    /** The text right after the formula calls it a square or a power. */
    powWord: boolean;
    /** A formula nearby treats x as a number. */
    xScalarCtx: boolean;
    /** The binary letters (switches) of the note. */
    bin: Set<string>;
    /** A binary word stands nearby and names no letter. */
    binAll: boolean;
    /** The other formulas of the context line. */
    others: string[];
    /** x_1 and x_2 are two arguments of one function, not the coordinates of a plane. */
    argPair: boolean;
}

/** Key words of the note's name and of the words around the formula; round 4: the role words, the program facts and the switches. */
function noteContext(ctx: RecognizeContext | undefined): { f: Answers; facts: ContextFacts } {
    const note = String(ctx?.note ?? '').toLowerCase();
    const c = String(ctx?.context ?? '');
    const f: Answers = {};
    f.ctxNone = !note && !c;
    f.ctxML = /learning|neural|\bml\b|data-science/.test(note) || /ReLU|[Ss]igmoid|[Aa]ctivation|Aktivierung|logistic|Neuron/.test(c);
    f.ctxComplex = /complex|komplex|funktionentheorie/.test(note) || /holomorph|residue|Residu|conformal|konform|Möbius|meromorph/.test(c);
    f.ctxSignal = /signal|regelung|control|laplace|systemtheorie/.test(note) || /Übertragungsfunktion|transfer function|Laplace|z-Transform|Regler|Strecke|Kreis\b|Glied/.test(c);
    f.ctxProb = /wahrschein|stochast|statisti|probab|zeitreihen|okonometrie|econometr/.test(note);
    f.ctxSeq = /analysis-i\b|analysis-1|folgen|sequences/.test(note) || /\bFolge\b|sequence|Grenzwert|\bexplizit\b/.test(c);
    f.ctxPoint = /[Pp]unkt|[Pp]oint|Kante|[Ee]dge|bei \[F\]|at \[F\]|Kandidat|Lösung|Optimum|Nullen|Tupel|Kruskal|Scheitel|Ecke|Tangent|Bsp\.? \d|Max |Min /.test(c);
    f.ctxInterval = /Intervall|[Ii]nterval|auf \[F\]|on \[F\]|in \[F\]|into|segment|[Bb]ereich|to \[F\]/.test(c) || /\\to\s*$/.test(c.split('[F]')[0].replace(/\$\s*$/, ''));
    f.ctxVec = /optimi|ganzzahlig|operations-research/.test(note) || /\\mathbb\{[RZ]\}\^n|\bLP\b|Relaxation|Ax \\le|Ax =/.test(c);
    f.ctxLine =
        /(Gerade|[Ll]ine|Linie|Parallele)\b[^.$]{0,12}\$?\s*\[F\]/.test(c) ||
        /(senkrecht|waagerecht|vertikal|vertical|horizontal)\w*\s+(bei|at)\s+\$?\s*\[F\]/i.test(c) ||
        /\[F\]\s*\$?\s*(is |ist )?(tight|active|aktiv|bindend)\b/i.test(c);
    f.ctxPoint = f.ctxPoint || /(durch|through|[Ss]palten|columns?|entry|Eintrag|Punkte?n?|points?|[Vv]ektor(en)?|vectors?)\b[^.$]{0,25}\$?\s*\[F\]/.test(c);
    // words right before the formula (rubric_r3.md V1, V2); other formulas may stand in between, a sentence end may not
    const before = c.split('[F]')[0];
    // round 4: the role word NEAREST before the formula decides (vector, point, value); words of round 3 plus
    // words other writers use. The position of the last word of each class in the 45 (30) characters before the formula.
    const lastAt = (re: RegExp, n: number) => {
        let t = before.slice(-n);
        const cut = t.search(/[.?!]\s(?![^]*[.?!]\s)/);
        if (cut >= 0) t = t.slice(cut + 1);
        let pos = -1;
        for (const m of t.matchAll(re)) pos = before.length - t.length + (m.index ?? 0);
        return pos;
    };
    const VECW =
        /vektor|vector|pfeil|arrow|richtung|direction|verschiebung|displacement|translation|kraft|kräfte|force|geschwindigkeit|velocity|beschleunigung|acceleration|impuls|momentum|normale|\bnormals?\b|spalte|column|skalarprodukt|scalar product|dot product|kreuzprodukt|cross product|orthogonal|senkrecht|perpendicular|kollinear|collinear|parallel|projiz|projekt|project|spanned|\bspans?\b|aufgespannt|spannen|orthonormal|basis|linear unabhängig|linearly independent|linearkombination|linear combination|eigenraum|eigenspace|eigenwert|eigenvalue|\bkern\b|kernel|null ?space/gi;
    const POINTW = /punkt|point|ecke|eckpunkt|corner|vertex|vertices|koordinaten|coordinates?|scheitel|zentrum|cent(er|re)\b|ursprung|origin\b|(durch|through|bei|at|in)\s+\$?\s*$/gi;
    const SOLVEW =
        /lösung|solution|löst|lösen|solve[sd]?|gleichungssystem|linear system|\bLGS\b|optim|least squares|kleinste[nr]? quadrate|fixpunkt|fixed point|startwert|start value|iterat|homogen|verteilung|distribution|wahrscheinlichkeit|probabilit|data point|datenpunkt|minimi[sz]er|maximi[sz]er|strateg|payoff|auszahlung|preis|price|bündel|bundle|schranke|bounds?\b|anteil|shares?\b|liste\b|list\b|tupel|tuple|farbe|colou?r|rgb/gi;
    const decoAt = (() => {
        const t = before.slice(-90);
        let pos = -1;
        for (const m of t.matchAll(/\\(vec|overrightarrow)(?![a-zA-Z])/g)) pos = before.length - t.length + (m.index ?? 0);
        return pos;
    })();
    const vecAt = Math.max(lastAt(VECW, 45), decoAt);
    const pointAt = lastAt(POINTW, 45);
    const solveAt = lastAt(SOLVEW, 30);
    const eigenNear = lastAt(/eigenve[ck]tor/gi, 45) >= 0;
    const gradientNormal = /(der|the) Gradient\s*\$?\s*$/.test(before) && /senkrecht|perpendicular|orthogonal|normal/i.test(before);
    f.ctxVecWord =
        (vecAt >= 0 && vecAt >= pointAt && vecAt >= solveAt) ||
        eigenNear ||
        // "[F] is a vector", or the formula stands in a table row next to a matrix
        /\[F\]\s*(is |ist )?(a|ein|als|as a)\s+(vektor|vector)/i.test(c) ||
        /\[F\]\s*,?\s*(is|ist)\s[^.$|]{0,24}?(vektor|vector|richtung|direction)/i.test(c) ||
        gradientNormal ||
        (/\s\|\s/.test(c) && /\\(begin|end)\{[pbB]?matrix\}/.test(c));
    f.ctxVecAfter = /\[F\]\s*,?\s*(is|ist)\s[^.$|]{0,24}?(vektor|vector|richtung|direction)/i.test(c) || gradientNormal;
    // a constraint that holds only when a switch is set: "[F] nur wenn $y = 1$", "[F] if $y = 0$"
    f.ctxIndicator = /\[F\]\s*(nur |only )?(wenn|falls|if|when)\s*\$\s*\\?[a-z]+(_\{?\w\}?)?\s*=\s*[01]\s*\$/i.test(c);
    f.ctxPointWord = pointAt >= 0;
    f.ctxSolveWord = solveAt >= 0;
    // round 4: what the formulas next to this one say about the note's program
    const others = contextFormulas(c);
    // words of a program right there (for constraints in decision variables with other names)
    f.ctxProgWord = /nebenbedingung|restriktion|constraint|subject to|s\.\s?t\.|kapazit|capacity|grenze|ressource|resource|maschine|machine|zulässig|feasible/i.test(c);
    // C2: a count of objects (m + 1 variables, m - 1 dimensional)
    const [beforeF, afterF] = [c.split('[F]')[0], c.split('[F]')[1] ?? ''];
    f.ctxCountNoun =
        /^\s*\$?\s*-?\s*(dimensional|variables?\b|variablen|unknowns?\b|unbekannte|equations?\b|gleichungen|steps?\b|schritte|elements?\b|elemente|points?\b|punkte|nodes?\b|knoten|edges?\b|kanten|constraints?\b|nebenbedingungen|rows?\b|columns?\b|zeilen|spalten|terms?\b|summanden|entries|einträge|parameters?\b|times\b|mal\b|stück|items?\b|samples?\b|freiheitsgrade|degrees|stellen|digits?\b|bits?\b|bytes?\b|permutation|operation|vergleiche|comparisons?\b|multiplikation|additionen|blätter|leaves|ebenen|levels?\b|kinder|children|floats?\b|zahlen|numbers?\b|werte|values?\b)/i.test(afterF) ||
        /(tiefe|depth|höhe\b|height|freiheitsgrade|degrees of freedom|kanten|edges|kinder|children|eltern|parents?|anzahl|number of|index|indizes|position)\b[^.$|]{0,30}(\|\s*)?\$?\s*$/i.test(beforeF) ||
        (/(durch|by|mit|with)\s*\$?\s*$/i.test(beforeF) && /^\s*\$?\s*(ersetz|teil|dividier|replace|divide|multipli)/i.test(afterF));
    // a table row whose other cells are numbers: "| D | [F] | $1600$ |"
    f.ctxNumRow = /^\s*\|?\s*([^|$]{0,12}\|)?\s*\[F\]\s*(\|\s*\$?\s*-?[0-9][^|a-zA-Z]*\$?\s*)+\|?\s*$/.test(c);
    const lone = (ch: string) => new RegExp('(^|[^a-zA-Z\\\\])' + ch + '(?![a-zA-Z_])');
    const INEQW = /\\le|\\ge|<|>|≤|≥|\\max|\\min/;
    // a program in the plane: a formula there holds x and y (or x_1 and x_2) with an inequality or a goal
    f.ctxProg2 = others.some((o) => INEQW.test(o) && lone('x').test(o) && lone('y').test(o));
    // another bare pair of numbers next to this one: points in a list
    f.ctxPairNear = others.some((o) => /^\s*\(\s*-?[0-9][0-9.{},]*\s*[,;|]\s*-?[0-9][0-9.{},]*\s*\)\s*$/.test(o));
    // letters a matrix is applied to in the formulas nearby (A v, Tv = 2v)
    const applied = new Set<string>();
    for (const o of others) for (const m of o.matchAll(/(?:^|[^a-zA-Z\\])[A-Z]\s*(?:\\,|\\cdot)?\s*([a-z])(?![a-zA-Z(_^{'])/g)) applied.add(m[1]);
    const powWord = /^\s*(\*\*)?\s*(is|ist|for|für|ohne|als)\b[^.$|]{0,24}?(quadrat|square|parab|potenz|power)/i.test(afterF);
    f.ctxX3 = others.some((o) => /x_\{?([3-9ijnk]|[1-9][0-9])\}?/.test(o) || /\\mathbb\{?[RZ]\}?\^\{?([3-9nmdk])/.test(o));
    f.ctxXVec = others.some((o) => /\\mathbb\{?[RZNB]\}?(_\{?[^}^]*\}?)?\^\{?([2-9nmdk])|\\\{0,\s*1\\\}\^|[A-Z]\s*x(?![a-zA-Z_^])|(\\top|\^T|\^\{T\})\s*x(?![a-zA-Z_])|x_\{?[0-9ijnk]|\\(mathbf|vec|boldsymbol)\{?\s*x/.test(o));
    const xScalarCtx = others.some((o) => lone('x').test(o) && /x\s*\^|\\(frac|sqrt|ln|exp|sin|cos|lvert)|\|\s*x|e\^|[a-zA-Z]\(x\)/.test(o));
    // binary variables: letters declared in {0, 1}, or named next to a word (binär, binary, Big-M, indicator)
    const bin = new Set<string>();
    const binWord = /bin[aä]r|binar(y|ies)|\b0-1\b|0\/1|boole|indi[ck]ator|big-?\s?m\b|schalt|\bswitch(es)?\b|either-or|entweder-oder/i.test(c);
    // a note on mixed-integer programs: y, z and delta are its switches
    if (/milp|big-m|ganzzahl|integer|binaer|binar/.test(note)) for (const q of ['y', 'z', 'delta']) bin.add(q);
    for (const o of others) {
        const m = /^(.*?)\\in\s*\\\{\s*0\s*,\s*1\s*\\\}/.exec(o);
        if (m) for (const q of m[1].matchAll(/\\?([a-zA-Z]+)(?![a-zA-Z])/g)) if (!/^(in|quad|text|mathbb|dots|ldots|cdots)$/.test(q[1])) bin.add(q[1]);
        if (binWord) {
            const q = /^\s*\\?([a-zA-Z]+)(_\{?\w+\}?)?\s*$/.exec(o);
            if (q) bin.add(q[1]);
        }
    }
    const binAll = binWord && bin.size === 0;
    // "the [F]-plane", "the [F]-axis": the formula is a name
    f.ctxPlaneName = /\[F\]\s*-(Ebene|plane|Achse|axis|Richtung|direction|Koordinate|coordinate)/i.test(c);
    // x_1 and x_2 are two arguments of one function (f(x_1) = f(x_2), injective, monotone), not the coordinates of a plane
    const argPair = others.some((o) => /[a-zA-Z]\(x_\{?[12]\}?\)/.test(o)) || /injektiv|injective|monoton/i.test(c);
    f.ctxPoint = f.ctxPoint || /[Mm]inim|[Mm]axim|[Ee]xtrem|[Ss]attel|[Ss]addle|[Ss]tation[aä]r|[Kk]ritisch|[Cc]ritical|[Ss]chnitt|[Ii]ntersect/.test(beforeF.slice(-40));
    // a general dimension in the text or in the formula: R^n, m x n (a generic matrix, no concrete map)
    f.ctxDim = /\\mathbb\{?R\}?\^\{?[nmdk]|[mn]\s*\\times\s*[nmk]/.test(c);
    f.ctxTable =
        /(kostenmatrix|cost matrix|kostentabelle|\bkosten\b|\bcosts?\b|payoff|auszahlung|(?<![a-zäöü])spiel|summenspiel|matrixspiel|\bgames?\b|bimatrix|confusion|konfusion|kontingenz|contingency|häufigkeit|frequenc|tabelle|table\b|zuordnung|assignment|ungarisch|hungarian|transport|distanz|distance|entfernung|adjazenz|adjacency|datenmatrix|data matrix|tableau|zeilenminim|spaltenminim|row minim|column minim)/i.test(
            c
        );
    if (/game-theory|spieltheorie|matrixspiel/.test(note)) f.ctxTable = true;
    f.ctxSubst = /(Subst\w*|[Ss]etze|Sei|Let|Mit|With|with|where|wobei|mit)\s*\$?\s*\[F\]/.test(c);
    return { f, facts: { applied, powWord, xScalarCtx, bin, binAll, others, argPair } };
}

/**
 * The names of the functions (g(x) = ...) and matrices (A = \begin{pmatrix})
 * the note defines; round 3: the written vectors, numeric matrices, arrow
 * letters and real domains of the note (noteValues), and whether the text
 * or the formula speaks of a general dimension (R^n, m x n).
 */
interface DefNames {
    names: Set<string>;
    mats: Set<string>;
    vecs: Set<string>;
    sure: Set<string>;
    nmats: Set<string>;
    mats3: Set<string>;
    deco: Set<string>;
    doms: Set<string>;
    ctxDim?: boolean;
    /** Round 4: the note's switches (binary letters), a binary word without a letter, a {0, 1} declaration in the span itself. */
    bin: Set<string>;
    binAll: boolean;
    spanBin: boolean;
    /** Round 4: the letters a matrix is applied to in the formulas nearby. */
    applied: Set<string>;
}

function defNames(defs: unknown): DefNames {
    const out: DefNames = { names: new Set(), mats: new Set(), vecs: new Set(), sure: new Set(), nmats: new Set(), mats3: new Set(), deco: new Set(), doms: new Set(), bin: new Set(), binAll: false, spanBin: false, applied: new Set() };
    for (const d of Array.isArray(defs) ? (defs as unknown[]) : []) {
        const m = /^\s*(\\?[A-Za-z]+)\s*\(\s*[a-z]\s*\)\s*:?=/.exec(String(d));
        if (m) out.names.add(m[1].replace('\\', ''));
        const mm = /^\s*([A-Z])\s*=\s*\\begin\{[pbB]?matrix\}/.exec(String(d));
        if (mm) out.mats.add(mm[1]);
    }
    return out;
}

/** The written vectors, numeric matrices, arrow letters and real domains the note names (its definitions and the formulas next to this one). */
function noteValues(dn: DefNames, ctx: RecognizeContext | undefined): DefNames {
    const take = (d: unknown) => {
        const h = defInfo(String(d));
        for (const k of h.vecs) dn.vecs.add(k);
        for (const k of h.sure) dn.sure.add(k);
        for (const k of h.mats) dn.nmats.add(k);
        for (const k of h.mats3) dn.mats3.add(k);
        for (const k of h.deco) dn.deco.add(k);
        for (const k of h.doms) dn.doms.add(k);
    };
    for (const d of Array.isArray(ctx?.defs) ? ctx.defs : []) take(d);
    const c = String(ctx?.context ?? '');
    if (c.includes('$')) for (const piece of contextFormulas(c)) if (piece.length > 2) take(piece);
    return dn;
}

/** The head of a part: name(args) =, letter =, a name of capitals =, or an expression on the left. */
type Head = { kind: 'call'; name: Item; args: Item[][]; abs?: boolean } | { kind: 'atom'; a: Item; coef: boolean } | { kind: 'name'; a: Item } | { kind: 'expr' };

/** A matrix applied to a vector over all of a side: which of the two is written out (lit) or named; big: 3 x 3 or in space. */
interface Product {
    M: 'lit' | 'name';
    V: 'lit' | 'name';
    m: Item;
    v: Item[];
    big: boolean;
    /** Round 4: the matrix is named with numbers in brackets (R(90°) v): its value is known. */
    viaCall?: boolean;
}

/** The features of one part, its head's name, and the name of a map (f: D \to \mathbb{R}) it defines. */
function partFeatures(its: Item[], defs: DefNames, ctxVars: Set<string>): { f: Answers; headBase: string | null; mapName: string | null | undefined } {
    const f: Answers = {};
    const n = its.length;
    f.empty = n === 0;
    if (!n) return { f, headBase: null, mapName: null };
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
    // round 4: \Omega(n) of a running time
    const bigOmega = all.some((x, i) => x.t === 'atom' && x.base === 'Omega' && !x.sub && all[i + 1] && all[i + 1].t === 'open' && all[i + 1].v === '(' && all.slice(i + 2).some((y) => y.t === 'atom' && /^[nmk]$/.test(String(y.base))));
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
        bigOmega ||
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
                (() => {
                    const e = all.findIndex((y, q) => q > i + 1 && y.t === 'close');
                    return all.slice(i + 2, Math.min(i + 8, e < 0 ? i + 8 : e));
                })().some((y) => y.t === 'rel' || (y.t === 'atom' && /^[A-Z+]$/.test(String(y.base))) || (y.t === 'sym' && y.v === '+'))
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
    f.hasVec = atoms.some((a) => a.vec || a.bold);
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
            const two = h.length === 5 && h[0].t === 'open' && h[4].t === 'close' && h[2].t === 'sym' && h[2].v === ',' && plainAtom([h[1]]) && plainAtom([h[3]]);
            if (plainAtom(h)) head = { kind: 'call', name: { t: 'atom', base: '↦', sub: '' }, args: [h] };
            else if (two) head = { kind: 'call', name: { t: 'atom', base: '↦', sub: '' }, args: [[h[1]], [h[3]]] };
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
    f.has_x1 = L('x_1') || (!L('x') && !L('x_2') && L('theta_1'));
    f.has_x2 = L('x_2') || (!L('x') && !L('x_1') && L('theta_2'));
    f.pointCoords = L('y_1') || L('y_2') || L('x_0') || L('y_0');
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
    {
        const ks = [...letters.keys()];
        // C1, C3 (final text): the note's real variable (x, t, q, x_1, x_2) with parameters as sliders, or ONE other letter alone
        const T1 = /^(x|t|q|x_1|x_2)$/;
        const CNT = /^(n|k|i|j|m)$/;
        const SECOND = /^(y|z|s|u|v|w|j|l|theta|varphi|omega)(_.*)?$|^x_(?!1$|2$).+$/;
        const t1 = ks.filter((k) => T1.test(k));
        let run: string | null = null;
        let ok = false;
        if (t1.length === 1) {
            run = t1[0];
            const others = ks.filter((k) => k !== run);
            ok =
                others.length <= 3 &&
                others.every((k) => {
                    const a = letters.get(k);
                    return !!a && !SECOND.test(k) && !a.vec && !a.bold && !a.star && !a.hat && !a.bar && !a.cal && !defs.names.has(String(a.base)) && !defs.mats.has(String(a.base));
                });
            // a count in an exponent next to the variable (x^k) is a second running letter
            if (ok && others.some((k) => CNT.test(k))) {
                for (let i = 0; i < body.length && ok; i++)
                    if (body[i].t === 'pow') {
                        let dd = 0;
                        for (let j = i + 1; j < body.length; j++) {
                            if (body[j].t === 'lb') dd++;
                            else if (body[j].t === 'rb' && --dd === 0) break;
                            else if (body[j].t === 'atom' && CNT.test(key(body[j]))) ok = false;
                        }
                    }
            }
        } else if (t1.length === 0 && ks.length === 1) {
            // ONE letter alone, also a parameter (p(1-p), 1/\lambda, 4d^2, T - 1); not y, z, s (variables of other cards), no vector,
            // matrix or random variable, and no standard name written with an operation (\sigma^2, R^2, S^2, C^1, A^{-1}, 1 - \alpha, 1 - \beta)
            const a = letters.get(ks[0]);
            if (a) {
                const b = String(a.base);
                const pw = body.findIndex((x) => x.t === 'pow');
                const stdName =
                    (body.length <= 6 && pw === 1 && body[0] === a && (/^(sigma|R|S|s|C|r|a)$/.test(b) || (/^[A-Z]$/.test(b) && body.some((x) => x.t === 'sym' && x.v === '-')))) ||
                    (/^(alpha|beta)$/.test(b) && body.length === 3 && body[0].t === 'num' && body[0].v === '1') ||
                    (/^(alpha|beta|gamma|tau|delta|varepsilon|mu|omega|theta|varphi|pi|rho|eta)$/.test(b) && !body.some((x) => x.t === 'fn' || x.t === 'pow'));
                // (small Latin letters and lambda, sigma, phi, xi, theta only; no index: capitals and indexed letters are names far too often)
                if (
                    /^([a-z]|lambda|sigma|varphi|xi|theta)$/.test(b) &&
                    !a.sub &&
                    !defs.vecs.has(b) &&
                    !/^(y|z|s|e|d|o|l|f|g|h)$/.test(b) &&
                    !a.vec &&
                    !a.bold &&
                    !a.star &&
                    !a.prime &&
                    !a.hat &&
                    !a.bar &&
                    !a.cal &&
                    !a.top &&
                    !a.inv &&
                    !defs.mats.has(b) &&
                    !defs.names.has(b) &&
                    !stdName
                ) {
                    run = ks[0];
                    ok = true;
                }
            }
        }
        if (ok && all.some((x) => x.t === 'sym' && x.v === '.')) ok = false; // v2.3.1 is a version, no formula
        // z alone (the level of a family of lines): only in a note on optimisation (elsewhere z is complex or a coordinate)
        f.runZ = ks.length === 1 && ks[0] === 'z';
        // x^0 is the name of the constant term
        if (ok && body.some((x, i) => x.t === 'pow' && body[i + 2] && body[i + 2].t === 'num' && body[i + 2].v === '0' && body[i + 3] && body[i + 3].t === 'rb')) ok = false;
        if (ok && body.some((x, i) => x.t === 'atom' && key(x) !== run && (/^[A-Z]/.test(String(x.base)) || !!x.sub) && body[i + 1] && body[i + 1].t === 'open' && body[i + 1].v === '(')) ok = false;
        f.runOne = ok;
        f.runKey = ok ? run : null;
        // at least one operation (a number as a factor, a sum, a power, a fraction, a root, a function, a minus in front)
        f.hasOp = (n >= 2 && all.some((x) => x.t === 'num' || x.t === 'pow' || x.t === 'frac' || x.t === 'fn' || (x.t === 'sym' && /^(\+|-|\/|\|)$/.test(String(x.v))))) || (!!f.fnMaxMin && n >= 4);
        // G3: a Lagrangian L = body in one variable and its multiplier
        f.lagr =
            !!head &&
            ((head.kind === 'atom' && /^(L|calL)$/.test(String(head.a.base))) || (head.kind === 'call' && /^(L|calL)$/.test(head.name.base ?? ''))) &&
            t1.length === 1 &&
            ks.includes('lambda') &&
            ks.every((k) => k === t1[0] || k === 'lambda' || !/^(y|z|s|u|v|w|j|l|theta|varphi|omega)(_.*)?$/.test(k)) &&
            ks.length <= 4;
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
    f.idxSubs = [...letters.values()].some((a) => /^(i|j|ij|ji|ik|kj)$|^[ij][0-9]$|^[0-9][ij]$/.test(String(a.sub)));
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
            f.hcRandom = /^[XYZ]$/.test(nm.base ?? '') && a.some((x) => x.some((y) => y.t === 'atom' && /^[oO]mega$/.test(String(y.base))));
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
            f.ha_u = /^[uU]$/.test(String(a.base)) && !a.star && !a.prime;
            f.ha_subNum = /^[0-9]+$/.test(a.sub ?? '') || /^(min|max|eff|ges|kin|pot)$/.test(a.sub ?? '');
            f.bodyHasIdx = !!idx && L(idx);
            f.bodyHasInit = [...letters.values()].some((x) => x.base === a.base && (x.sub === '0' || x.sub === '1'));
            if (a.base === 'y' && !a.sub) f.ha_y = true;
            else if (a.base === 'x' && !a.sub) f.ha_x = true;
            else if (a.base === 'x' && (a.sub === '1' || a.sub === '2')) {
                f.ha_xsub = true;
                if (a.sub === '1') f.ha_x1 = true;
                else f.ha_x2 = true;
            }
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

    // sets: the first side that is one pair of set braces (alone, after a name, an image or a product, or before "= ...")
    {
        const sb = setBuilder(parts, rels);
        if (sb && sb.sep > 0) {
            f.setB = true;
            const { el, cond } = sb;
            f.setTuple = el[0].t === 'open';
            const inR = el.some((x) => x.t === 'bb' && x.v === 'ℝ');
            const tupleN = f.setTuple ? 1 + el.slice(0, el.findIndex((x) => x.t === 'close') + 1).filter((x) => x.t === 'sym' && x.v === ',').length : 0;
            f.setSpace = tupleN >= 3 || el.some((x) => x.t === 'bb' && /^([3-9]|[1-9][0-9])$/.test(x.pow ?? ''));
            f.setHasR = inR;
            f.setBadElem =
                el.some((x) => (x.t === 'bb' && (x.v !== 'ℝ' || /times/.test(x.pow ?? ''))) || x.cal) ||
                (!inR && el[0].t === 'atom' && /^(Omega|omega|n|k|v|z|i|j|m|N)$/.test(String(el[0].base))) ||
                (el[0].t === 'atom' && /^[A-Z]$/.test(String(el[0].base))) ||
                el.some((x, i) => x.t === 'atom' && x.base === 'C' && el[i + 1] && (el[i + 1].t === 'open' || el[i + 1].t === 'pow'));
            {
                // round 4: the element is a pair, or a letter with a real carrier, or x, y, t, u, theta, xi alone
                const inAt = el.findIndex((x) => x.t === 'rel' && x.v === 'in');
                const carrier = inAt >= 0 ? el.slice(inAt + 1) : null;
                const eh = (inAt >= 0 ? el.slice(0, inAt) : el).filter((x) => x.t !== 'sp' && !(x.t === 'sym' && x.v === ';'));
                const carrierOk = !carrier || carrier.some((x) => x.t === 'bb' || x.t === 'open' || (x.t === 'name' && x.name === 'dom')) || (carrier.length === 1 && carrier[0].t === 'atom' && !carrier[0].cal && defs.doms.has(String(carrier[0].base)));
                const headOk = !!f.setTuple || (eh.length === 1 && eh[0].t === 'atom' && (!!carrier || /^(x|y|t|u|theta|xi)$/.test(String(eh[0].base))));
                // the element given by a formula in other letters (x = \lambda a + (1 - \lambda) b): a set in parameter form
                const c0 = commaSplit(cond)[0] ?? [];
                const r0 = relSplit(c0);
                const paramForm =
                    eh.length === 1 &&
                    eh[0].t === 'atom' &&
                    r0.rels[0] === 'eq' &&
                    r0.parts[0].length === 1 &&
                    r0.parts[0][0].t === 'atom' &&
                    key(r0.parts[0][0]) === key(eh[0]) &&
                    r0.parts[1].some((x) => x.t === 'atom' && !((x.base === 'pi' || x.base === 'e') && !x.sub));
                f.setAbstract = !carrierOk || !headOk || paramForm;
            }
            const cr = relSplit(cond);
            const isC = (p: Item[]) => {
                const c = asCall(p);
                return !!c && c.name.t === 'atom' && c.args.length === 1;
            };
            f.setLhsCall = isC(cr.parts[0]);
            f.setRhsCall = cr.parts.length > 1 && isC(cr.parts[cr.parts.length - 1]);
            f.setLe = cr.rels.includes('le') || cr.rels.includes('lt');
            f.setGe = cr.rels.includes('ge') || cr.rels.includes('gt');
            f.setEqCall = cr.rels.length > 0 && cr.rels.every((r) => r === 'eq') && (!!f.setLhsCall || !!f.setRhsCall) && !f.setTuple;
            f.setCondRel = cr.rels.some((r) => r === 'lt' || r === 'le' || r === 'gt' || r === 'ge' || r === 'eq' || r === 'ne' || r === 'approx');
            // words inside the set other than und / and / oder / or
            f.setCallBad = calls(cond).some((c) => !(c.inner.length === 1 && c.inner[0].t === 'atom' && c.inner[0].base === 'x' && !c.inner[0].sub) && !(c.name.t === 'name' && FNWORD.has(String(c.name.name))) && !(c.name.t === 'atom' && c.name.cal));
            f.setText = [...el, ...cond].some((x) => x.t === 'text' && !/^[␣,]*(und|and|oder|or|sowie)[␣]*$/i.test(String(x.v)));
        } else if (sb) {
            // a set written by its condition only: \{x_1^2 + x_2^2 \le 4\} (two coordinates or one real variable)
            const chunks = commaSplit(sb.inner).map((c) => relSplit(c).rels);
            const ineq = (r: string) => r === 'lt' || r === 'le' || r === 'gt' || r === 'ge';
            const lets = new Set(sb.inner.filter((x) => x.t === 'atom' && !((x.base === 'pi' || x.base === 'e') && !x.sub)).map(key));
            const two = (lets.has('x') && lets.has('y')) || (lets.has('x_1') && lets.has('x_2'));
            const one = lets.size === 1 && (lets.has('x') || lets.has('t'));
            const r = relSplit(sb.inner);
            if (chunks.every((q) => q.length >= 1 && q.every((v) => ineq(v) || v === 'eq')) && chunks.some((q) => q.some(ineq)) && (two || one) && [...lets].every((k) => /^(x|y|x_1|x_2|t|[a-dr])$/.test(k))) {
                f.setB = true;
                f.setCondRel = true;
            } else if (r.rels.length === 1 && r.rels[0] === 'eq' && anyAtom(r.parts[0]) && r.parts[1].length === 1) f.setLevel = true;
            else f.setList = true;
        }
        f.epiOp = n >= 2 && has((x) => (x.t === 'name' || x.t === 'text') && /^epi$/.test(String(x.name ?? x.v)));
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
            // round 4: a small letter = a round pair is never a named interval
            f.ivLowHead = /^[a-z]$|^ell$/.test(String(P0[0].base));
        } else if (rels[0] === 'eq' && parts[1].length && parts[1][0].t === 'sopen' && P0.length >= 5 && P0[0].t === 'open') {
            s = P0;
            f.ivDef = true;
        } else if (
            rels[0] === 'eq' &&
            rels.length === 1 &&
            P0.length >= 4 &&
            (P0[0].t === 'atom' || P0[0].t === 'name') &&
            P0[1].t === 'open' &&
            P0[P0.length - 1].t === 'close' &&
            P0.slice(2, -1).some((x) => x.t === 'bb' || x.t === 'open')
        ) {
            s = all.slice(P0.length + 1);
            f.ivImage = true;
        } else if (rels[0] === 'eq' && rels.length === 1 && P0.length === 3 && P0[0].t === 'atom' && P0[2].t === 'atom' && P0[1].t === 'sym' && /^\\(cup|cap)$/.test(String(P0[1].v))) {
            s = all.slice(P0.length + 1);
            f.ivImage = true;
            f.ivSetName = true;
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
                    f.ivHasInf = A.some((x) => x.t === 'inf') || B.some((x) => x.t === 'inf');
                    if (f.ivImage && !(f.ivSquare || f.ivHasInf || f.ivSetName)) f.ivImage = false;
                    {
                        // round 4: no interval when a >= b, or when its ends are variable letters
                        const val = (p: Item[]) => {
                            const q = p[0] && p[0].t === 'sym' && p[0].v === '-' ? p.slice(1) : p;
                            return q.length === 1 && q[0].t === 'num' ? (q === p ? 1 : -1) * Number(q[0].v) : NaN;
                        };
                        const va = val(A);
                        const vb = val(B);
                        f.ivNoIv = (!!f.ivRound && va >= vb) || (!!f.ivRound && [A, B].some((p) => plainAtom(p) && /^[xyzt]$/.test(String(p[0].base))) && [A, B].every((p) => plainAtom(p)));
                    }
                    f.ivZeroSym = f.ivEndsNum && str(A) !== str(B) && (str(A) === '0' || str(A) === '-' + str(B) || A.some((x) => x.t === 'inf') || B.some((x) => x.t === 'inf'));
                } else if (seps.length >= 2) f.list3 = true;
            }
        }
        if (f.iv) f.numeric = false;
        if (!f.iv || !f.ivRound) f.ivLowHead = false;
        if (!f.iv) {
            f.ivApprox = false;
            f.ivMember = false;
            f.ivMemberAtom = false;
            f.ivNamed = false;
            f.ivDef = false;
            f.ivImage = false;
        }
    }

    // maps  name : domain -> codomain
    if (rels[0] === 'colon' && rels.filter((r) => r === 'to').length === 1 && rels.length === 2 && (anyAtom(P0) || (P0.length === 1 && P0[0].t === 'fn'))) {
        f.mapForm = true;
        const dom = parts[1];
        const cod = parts[2];
        const dim = (x: Item) => x.t === 'bb' && /^([2-9]|[1-9][0-9]|[a-zA-Z])$|times/.test(x.pow ?? '');
        f.mapCodR = (cod.length === 1 && cod[0].t === 'bb' && cod[0].v === 'ℝ' && !dim(cod[0])) || (cod.length >= 5 && cod[0].t === 'open' && cod[cod.length - 1].t === 'close');
        f.mapCodPow = cod.some(dim);
        // a domain letter is a real set when the note says so (D = [0, 1], D \subseteq R^2); D is the usual name of one
        const known = dom.length === 1 && dom[0].t === 'atom' && !dom[0].cal && defs.doms.has(String(dom[0].base));
        f.mapDomAbstract = !known && (dom.every((x) => x.t === 'atom') || !dom.some((x) => x.t === 'bb' || x.t === 'open') || dom.some((x) => x.t === 'bb' && /times|^([3-9]|[1-9][0-9])$/.test(x.pow ?? '')));
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
        const cap = (x: Item | undefined) => !!x && x.t === 'atom' && /^[A-Z]$/.test(String(x.base)) && !x.star && !x.prime;
        const low = (x: Item | undefined) => !!x && x.t === 'atom' && /^[a-z]$/.test(String(x.base)) && !x.star;
        const noDots = (p: Item[]) => p.filter((x) => !(x.t === 'sym' && x.v === 'cdot'));
        const matLit = (x: Item | undefined) => {
            if (!x || x.t !== 'env' || x.name === 'vmatrix' || x.name === 'cases') return false;
            const m = matrixInfo(x);
            return m.square && m.nums && m.letters.size <= 1;
        };
        const lit2 = (p: Item[], i: number) => {
            const l = vecLiteral(p, i);
            return l && l.definite && l.letters.size <= 1 ? l : null;
        };
        /** [matrix][vector] over all of a side: which of the two is written out; big: a 3 x 3 matrix or a vector in space (no card) */
        const prodOf = (p0: Item[]): Product | null => {
            let p = noDots(p0);
            // a number in front of the written matrix belongs to it: \tfrac12 (matrix)(vector)
            const e0 = p.findIndex((x) => x.t === 'env');
            if (e0 > 0) {
                const pre = vecSide(p0.slice(0, p0.indexOf(p[e0])));
                if (pre && pre.every((e) => e.k === 'num' || e.k === 'dot' || e.k === 'pm')) p = p.slice(e0);
            }
            if (p.length < 2) return null;
            let mEnd = 1;
            let M: 'lit' | 'name';
            let big = false;
            let viaCall = false;
            if (p[0].t === 'env') {
                if (!matLit(p[0])) return null;
                M = 'lit';
                big = matrixInfo(p[0]).r === 3;
            } else if (cap(p[0]) && !p[0].vec && !p[0].top && !p[0].inv) {
                M = 'name';
                // a matrix named with numbers in brackets: R(90°), S(2, 3); R_{90°}(2, 1)^\top is R times a written vector
                const direct = lit2(p, 1);
                if (direct && direct.end === p.length) {
                    // the bracket is the vector
                } else if (
                    cap(p[1]) &&
                    !p[1].vec &&
                    !p[1].top &&
                    !p[1].inv &&
                    !/^[XWZ]$/.test(String(p[0].base) + String(p[1].base)) &&
                    (() => {
                        const l2 = lit2(p, 2);
                        return !!l2 && l2.end === p.length;
                    })()
                )
                    mEnd = 2;
                else if (p[1].t === 'open' && p[1].v === '(') {
                    let j = 2;
                    while (j < p.length && (p[j].t === 'num' || p[j].t === 'unit' || (p[j].t === 'sym' && /^[,;-]$/.test(String(p[j].v))))) j++;
                    if (j > 2 && j < p.length && p[j].t === 'close') {
                        mEnd = j + 1;
                        viaCall = true;
                    } else return null;
                }
                // a product of two numeric matrices of the note as the matrix: BA (1, 1)^T
                if (mEnd === 1 && cap(p[1]) && !p[1].vec && defs.nmats.has(String(p[0].base)) && defs.nmats.has(String(p[1].base))) mEnd = 2;
                big = defs.mats3.has(String(p[0].base)) && !defs.nmats.has(String(p[0].base));
            } else return null;
            const l = lit2(p, mEnd);
            if (l && l.end === p.length) return { M, V: 'lit', m: p[0], v: p.slice(mEnd), big: big || l.n !== 2 };
            const v = p[mEnd];
            if (v && p.length === mEnd + 1 && ((low(v) && !v.top) || (v.t === 'num' && v.vec))) return { M, V: 'name', m: p[0], v: [v], big, viaCall };
            // round 4: an iterate as the vector (A v^{(1)})
            if (v && p.length === mEnd + 2 && p[mEnd + 1].t === 'layer' && low(v) && !v.top) return { M, V: 'name', m: p[0], v: [v, p[mEnd + 1]], big, viaCall };
            return null;
        };
        // alone: between the relations and commas around it there is only the matrix, with a number as a factor at most
        const stop = (q: number) => d[q] === 0 && (all[q].t === 'rel' || (all[q].t === 'sym' && (all[q].v === ',' || all[q].v === ';')));
        const aloneAt = (i: number) => {
            let a = i;
            while (a > 0 && !stop(a - 1)) a--;
            if (i < n - 1 && !stop(i + 1)) return false;
            const before = all.slice(a, i);
            if (before.length === 0) return true;
            const els = vecSide(before);
            return !!els && els.every((e) => e.k === 'num' || e.k === 'dot' || e.k === 'pm');
        };
        const squares = infos.filter((m) => m.square);
        const adjMat = squares.some((m) => squares.some((q) => q.i === m.i + 1 || (q.i === m.i + 2 && all[m.i + 1].t === 'sym' && all[m.i + 1].v === 'cdot')));
        // the object: the first square matrix when it stands alone (A = M = L U), else the last one when the span
        // multiplies no two written matrices (N = (I - Q)^{-1} = ... = M)
        let sq = squares.length ? squares[0] : undefined;
        if (sq && aloneAt(sq.i)) f.matAlone = true;
        else if (sq && !adjMat && aloneAt(squares[squares.length - 1].i)) {
            sq = squares[squares.length - 1];
            f.matAlone = true;
        }
        if (sq) {
            const at0 = sq.i;
            f.matSq = true;
            const lt = [...sq.letters];
            f.matNumeric = lt.length === 0 && sq.nums;
            f.matStateVar = lt.some((k) => /^(x|y|s|z|x_1|x_2)$/.test(k));
            f.matOneParam = lt.length === 1 && !f.matStateVar;
            f.matManyParams = lt.length >= 2;
            f.matDots = sq.dots;
            f.matAdjVec = infos.some((m) => m.col && (m.i === at0 + 1 || (m.i === at0 + 2 && all[at0 + 1].t === 'sym' && all[at0 + 1].v === 'cdot')));
        }
        f.matCol = infos.some((m) => m.col);
        // determinants: \det A, \det(A), \det of a written numeric matrix, a numeric vmatrix that leads its side
        const vm = envs.find(([x]) => x.name === 'vmatrix');
        const shortHead = (q: number) => q === 0 || (q === 1 && rels[0] === 'eq' && parts[0].length <= 4);
        if (vm) {
            f.vmat = true;
            const mi = matrixInfo(vm[0]);
            f.vmatNumeric = mi.square && mi.letters.size === 0 && mi.nums && parts.some((p, q) => p[0] === vm[0] && shortHead(q));
        }
        f.detAny = has((x) => x.t === 'det');
        {
            // E1: det(head) = ... = a polynomial in lambda
            const lam = (p: Item[]) => p.filter((x) => x.t === 'atom' && !((x.base === 'pi' || x.base === 'e') && !x.sub));
            const tail = parts.slice(1);
            f.detPoly =
                P0.length > 1 &&
                P0[0].t === 'det' &&
                rels.length >= 1 &&
                rels.every((r) => r === 'eq') &&
                tail.every((p) => p.length > 0 && !p.some((x) => x.t === 'env' || x.t === 'det') && lam(p).every((x) => x.base === 'lambda' && !x.sub)) &&
                lam(tail[tail.length - 1]).length > 0 &&
                P0.some((x) => (x.t === 'atom' && x.base === 'lambda') || (x.t === 'env' && (x.rows ?? []).flat().some((c) => c.includes('\\lambda'))));
        }
        const absDet = n >= 4 && all[0].t === 'sym' && all[0].v === '|' && all[n - 1].t === 'sym' && all[n - 1].v === '|' && all[1].t === 'det';
        if (all[0].t === 'det' || absDet) {
            f.detLead = true;
            const r = absDet ? all.slice(2, -1) : all.slice(1);
            const capD = (x: Item | undefined) => cap(x) && !x?.inv && !x?.top;
            f.detLone = (r.length === 1 && capD(r[0])) || (r.length === 3 && r[0].t === 'open' && capD(r[1]) && r[2].t === 'close');
        }
        f.detMat = parts.some((p, q) => {
            if (!p[0] || p[0].t !== 'det' || !shortHead(q)) return false;
            const dm = p[1] && p[1].t === 'env' ? p[1] : p[1] && p[1].t === 'open' && p[2] && p[2].t === 'env' ? p[2] : null;
            if (!dm) return false;
            const mi = matrixInfo(dm);
            return mi.square && mi.letters.size === 0 && mi.nums;
        });
        // matrix times vector (2 x 2 only: the card draws in the plane)
        const eqOnly = rels.every((r) => r === 'eq' || r === 'approx');
        const isDots = (p: Item[]) => p.length === 1 && p[0].t === 'sym' && p[0].v === '\\dots';
        const P = parts.map(prodOf);
        const kp = P.findIndex((x) => x);
        const ctxDimHere = !!defs.ctxDim;
        const pk = kp >= 0 ? P[kp] : null;
        if (pk && !pk.big) {
            const { M, V, m } = pk;
            const v = pk.v[0];
            // x, y, z without a value in the note are unknowns: A x = (1, 2) is a linear system
            const known = V === 'lit' || v.t === 'num' || (v.t === 'atom' && (defs.vecs.has(dkey(v)) || !/^[xyz]$/.test(String(v.base))));
            if (rels.length === 0) {
                if (M === 'name' && V === 'name') {
                    if (v.t === 'atom' && !/^[XWZ]$/.test(String(m.base))) {
                        f.prodVec = !!v.vec;
                        f.prodAv = (/^[ABMSTQUP]$/.test(String(m.base)) && !m.sub && /^[vxuw]$/.test(String(v.base))) || (defs.nmats.has(String(m.base)) && !m.sub && /^[a-z]$/.test(String(v.base)) && !v.top);
                    } else if (v.t === 'num') f.prodVec = true;
                } else if (M === 'lit' && V === 'lit') f.prodWritten = true;
                else if (M === 'name' || v.vec || /^[vxuw]$/.test(String(v.base))) f.prodMixed = true;
            } else if (eqOnly || rels[0] === 'mapsto') {
                const after = parts.slice(kp + 1).filter((p) => !isDots(p));
                const vec2 = (p: Item[]) => {
                    const l = vecLiteral(p, 0);
                    if (l && l.end === p.length) return l.n === 2;
                    const q = vecSide(p);
                    if (!q || !q.length) return false;
                    const c = sideClass(q);
                    return (c.c === 'lit' || c.c === 'comb') && (c.lits ?? []).every((x) => x.n === 2 && x.definite);
                };
                const resultOk = after.every((p) => {
                    if (vec2(p)) return true;
                    const o = prodOf(p);
                    return !!o && !o.big && o.V === 'lit';
                });
                const c0 = kp === 1 ? asCall(parts[0]) : null;
                const mapHead =
                    kp === 1 &&
                    V === 'name' &&
                    v.t === 'atom' &&
                    ((rels[0] === 'mapsto' && anyAtom(parts[0]) && parts[0][0].base === v.base) || (!!c0 && c0.args.length === 1 && anyAtom(c0.args[0]) && c0.args[0][0].base === v.base));
                if (mapHead && after.length === 0) {
                    f.prodMap = true;
                    f.matKnown = M === 'lit' || !!pk.viaCall || (defs.nmats.has(String(m.base)) && !ctxDimHere);
                } else if (
                    eqOnly &&
                    resultOk &&
                    after.length > 0 &&
                    parts.slice(0, kp).every((p) => (p.length <= 3 && p.every((x) => x.t === 'atom')) || (M === 'lit' && V === 'lit' && p.length <= 8 && !p.some((x) => x.t === 'env' || x.t === 'open')))
                ) {
                    if (M === 'lit' && V === 'lit') f.prodWritten = true;
                    else if (V === 'lit' || (M === 'lit' && known)) f.prodMixed = true;
                    else if (known) f.prodEval = true;
                }
            }
        }
        if (f.prodWritten) f.matAdjVec = true;
        // eigen equations: M v = s v (M a capital or a written 2 x 2 matrix, s a number or a Greek letter), also as a chain
        // with the product worked out in between, and (M - s I) v = 0
        if (rels.length >= 1 && eqOnly) {
            const same = (a: Item[], b: Item[]) => a.length === b.length && a.every((x, i) => (x.t === 'atom' ? b[i].t === 'atom' && dkey(x) === dkey(b[i]) : JSON.stringify(x) === JSON.stringify(b[i])));
            const sc = (x: Item | undefined) => !!x && (x.t === 'num' || (x.t === 'atom' && !low(x) && !cap(x)));
            // round 4: any scalar expression in front (\tfrac12 v, (1 - \lambda) v, -v)
            const scItem = (x: Item) => sc(x) || x.t === 'frac' || x.t === 'lb' || x.t === 'rb' || x.t === 'pow' || (x.t === 'fn' && x.name === 'sqrt') || (x.t === 'sym' && /^(\+|-|\/)$/.test(String(x.v))) || x.t === 'open' || x.t === 'close';
            const scaled = (p0: Item[], v: Item[]) => {
                const p = noDots(p0);
                const k = p.length - v.length;
                if (k < 1 || !same(p.slice(k), v)) return false;
                const pre = p.slice(0, k);
                if (pre.length === 1 && pre[0].t === 'sym' && pre[0].v === '-') return true;
                return pre.every(scItem) && pre.some((x) => sc(x)) && depths(pre).every((q) => q >= 0) && pre.filter((x) => x.t === 'open').length === pre.filter((x) => x.t === 'close').length;
            };
            const A0 = P[0];
            const Z = P[P.length - 1];
            // no card with 3 entries
            const has3 = parts.some((p) => {
                for (let q = 0; q < p.length; q++) {
                    const l = vecLiteral(p, q);
                    if (l && l.n >= 3) return true;
                }
                return false;
            });
            const A = has3 ? null : A0;
            // a side that is a multiple of a written pair: its entries and the factor
            const litAt = (p: Item[]): { vals: number[]; s: number } | null => {
                const q = noDots(p);
                for (let k = 0; k < q.length && k < 3; k++) {
                    const l = vecLiteral(q, k);
                    if (l && l.end === q.length && l.n === 2) {
                        const pre = q.slice(0, k);
                        const neg = !!pre[0] && pre[0].t === 'sym' && pre[0].v === '-';
                        const pp = neg ? pre.slice(1) : pre;
                        const sv = pp.length === 0 ? 1 : pp.length === 1 && pp[0].t === 'num' ? Number(pp[0].v) : NaN;
                        return { vals: l.vals, s: neg ? -sv : sv };
                    }
                }
                return null;
            };
            // a chain whose result is a multiple in numbers: M w = (3, 3) = 3 (1, 1)
            const numCheck = () => {
                if (!A || parts.length < 3) return false;
                const w = litAt(parts[parts.length - 1]);
                if (!w || Number.isNaN(w.s) || w.vals.some((v) => Number.isNaN(v)) || w.vals.every((v) => v === 0)) return false;
                return parts.slice(1, -1).some((p) => {
                    const r = litAt(p);
                    return !!r && r.s === 1 && r.vals.every((v, i) => Math.abs(v - w.s * w.vals[i]) < 1e-9);
                });
            };
            if (A && !A.big && scaled(parts[parts.length - 1], A.v)) f.eig1 = true;
            else if (A && !A.big && parts.length >= 3 && same(noDots(parts[parts.length - 1]), A.v) && A.V === 'lit') f.eig1 = true;
            else if (A && !A.big && numCheck()) f.eig1 = true;
            else if (Z && !Z.big && rels.length === 1 && scaled(parts[0], Z.v)) f.eig1 = true;
            // M v = v, written or named (eigenvalue 1, L7): P \mathbf{1} = \mathbf{1}, H_x(2) (1, 0)^T = (1, 0)^T
            else if (A && !A.big && rels.length === 1 && same(noDots(parts[1]), A.v)) f.eig1 = true;
            // M v - s v = 0
            else if (rels.length === 1 && parts[1].length === 1 && parts[1][0].t === 'num' && parts[1][0].v === '0') {
                const p = parts[0];
                const dp = depths(p);
                const cutAt = p.findIndex((x, i) => i > 0 && dp[i] === 0 && x.t === 'sym' && x.v === '-');
                const Lp = cutAt > 0 ? prodOf(p.slice(0, cutAt)) : null;
                if (Lp && !Lp.big && scaled(p.slice(cutAt + 1), Lp.v)) f.eig1 = true;
            }
            if (rels.length === 1) {
                // transposed forms: P^T pi^T = pi^T, (P^T - I) pi^T = 0 (the signs are dropped, the vector may be a Greek letter)
                const hadTop = all.some((x) => x.t === 'top');
                const strip = (p: Item[]) =>
                    noDots(p)
                        .filter((x) => x.t !== 'top')
                        .map((x) => (x.t === 'atom' && x.top ? { ...x, top: 0 } : x));
                const l = strip(parts[0]);
                const r = strip(parts[1]);
                const vecL = (x: Item | undefined) => low(x) || (hadTop && !!x && x.t === 'atom' && /^(pi|mu|nu)$/.test(String(x.base)));
                const big3 = (b: unknown) => defs.mats3.has(String(b)) && !defs.nmats.has(String(b));
                const two = (l: Item[], r: Item[]) => {
                    if (!(r.length === 1 && r[0].t === 'num' && r[0].v === '0' && l[0] && l[0].t === 'open')) return false;
                    if (l.length === 7 && l[5].t === 'close' && vecL(l[6])) {
                        if (l[2].t === 'sym' && l[2].v === '-' && cap(l[1]) && sc(l[3]) && cap(l[4])) return !big3(l[1].base);
                        return l[3].t === 'sym' && l[3].v === '-' && sc(l[1]) && cap(l[2]) && cap(l[4]) && !big3(l[4].base);
                    }
                    // (P - I) v = 0: eigenvalue 1
                    return l.length === 6 && l[4].t === 'close' && vecL(l[5]) && cap(l[1]) && l[2].t === 'sym' && l[2].v === '-' && cap(l[3]) && /^[IE]$/.test(String(l[3].base)) && !big3(l[1].base);
                };
                if (two(l, r) || two(r, l)) f.eig2 = true;
                if (hadTop && l.length === 2 && cap(l[0]) && vecL(l[1]) && same(r, [l[1]]) && parts[0].filter((x) => x.t === 'top').length === 2) f.eig1 = true;
            }
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
            // one coordinate alone on the left (x_1, 6x_1 + 8, |x_1|): a strip or half plane
            f.c_lhsX12 = lset.length === 1 && (lset[0] === 'x_1' || lset[0] === 'x_2') && lcl.length === 0 && !lhs.some((x) => x.star || x.prime || x.top);
            f.c_rhsParam = paramExpr(rhs, defs.bin);
            // a linear constraint in two decision variables with other names (2a + b <= 100)
            {
                const lv = lhs.filter((x) => x.t === 'atom');
                const names = new Set(lv.map(key));
                f.lin2 =
                    isNumLike(rhs) &&
                    names.size === 2 &&
                    (lv.every((x) => /^[a-df-hp-su-w]$/.test(String(x.base))) || lv.every((x) => /^[KL]$/.test(String(x.base)))) &&
                    lv.every((x) => !x.sub && !x.star && !x.prime && !x.vec && !x.hat && !x.bar) &&
                    lhs.every((x) => x.t === 'atom' || x.t === 'num' || (x.t === 'sym' && /^(\+|-|cdot|,)$/.test(String(x.v))));
            }
            f.c_lhsXY = plainAtom(lhs) && /^[xy]$/.test(String(lhs[0].base));
            f.c_lhsHasZL = lhs.some((x) => x.t === 'atom' && (x.base === 'lambda' || x.base === 'z'));
            f.c_lhsOmegaZ = plainAtom(lhs) && (lhs[0].base === 'omega' || lhs[0].base === 'z');
            f.c_lhsCtxVar = plainAtom(lhs) && !!ctxVars && ctxVars.has(String(lhs[0].base)) && !INT.has(String(lhs[0].base));
            f.c_lhsFn = lhs.some((x) => x.t === 'fn');
            f.c_rhsNum = isNumLike(rhs);
            f.c_rhsAtom = plainAtom(rhs);
            f.c_less = rels[0] === 'lt' || rels[0] === 'le';
        } else if (ineqs.length === 2) {
            const mid = parts[1];
            f.c_midAtom = plainAtom(mid) || (anyAtom(mid) && !!mid[0].sub && mid[0].base !== 'x' && !mid[0].star && !mid[0].prime && !mid[0].cal && !mid[0].vec && /^[a-zA-Z0-9]$/.test(mid[0].sub));
            f.c_midIdx = anyAtom(mid) && INT.has(String(mid[0].base));
            const end = parts[2];
            f.c_endsNum = isNumLike(parts[0]) && (isNumLike(end) || (end.length > 0 && end.every((x) => x.t !== 'atom' || x.base === 'pi') && end.some((x) => x.t === 'num')));
            f.c_midY = plainAtom(mid) && mid[0].base === 'y';
            f.c_midX12 = anyAtom(mid) && mid[0].base === 'x' && (mid[0].sub === '1' || mid[0].sub === '2') && !mid[0].star && !mid[0].prime;
            f.c_midXY = plainAtom(mid) && /^[xy]$/.test(String(mid[0].base));
            {
                // a <= x <= b with parameters: a piece with sliders
                const PARAM = /^(x|y|z|t|s|i|j|k|l|m|n|N|ell|u|e|d|M)$/;
                const par = (p: Item[]) => plainAtom(p) && /^[a-zA-Z]$/.test(String(p[0].base)) && !PARAM.test(String(p[0].base));
                const e0 = parts[0];
                const e2 = parts[2];
                f.c_endsPar = plainAtom(mid) && /^[xt]$/.test(String(mid[0].base)) && (par(e0) || isNumLike(e0)) && (par(e2) || isNumLike(e2)) && (par(e0) || par(e2)) && rels.every((r) => r === 'lt' || r === 'le');
            }
            // -c <= x <= c: the variable between plus and minus one parameter
            f.c_symVar =
                plainAtom(mid) &&
                /^[xt]$/.test(String(mid[0].base)) &&
                plainAtom(end) &&
                /^[a-zA-Z]$/.test(String(end[0].base)) &&
                parts[0].length === 2 &&
                parts[0][0].t === 'sym' &&
                parts[0][0].v === '-' &&
                plainAtom([parts[0][1]]) &&
                parts[0][1].base === end[0].base &&
                rels.every((r) => r === 'lt' || r === 'le');
            f.c_endsHaveX = [...parts[0], ...parts[2]].some((x) => x.t === 'atom' && x.base === 'x' && !x.sub);
            f.c_less = rels[0] === 'lt' || rels[0] === 'le';
        }
    }
    // round 4: a constraint with the big constant M or with a binary variable of the note
    // the big constant M times a letter, or a factor times (1 - letter): the letter is a switch
    f.bigM =
        ineqs.length > 0 &&
        all.some((x, i) => {
            const isM = x.t === 'atom' && x.base === 'M' && !x.cal;
            let j = i + 1;
            if (all[j] && all[j].t === 'sym' && all[j].v === 'cdot') j++;
            if (isM && all[j] && all[j].t === 'atom' && /^[a-z]$|^delta$/.test(String(all[j].base))) return true;
            if (
                (isM || x.t === 'num') &&
                all[j] &&
                all[j].t === 'open' &&
                all[j + 1] &&
                all[j + 1].t === 'num' &&
                all[j + 1].v === '1' &&
                all[j + 2] &&
                all[j + 2].t === 'sym' &&
                all[j + 2].v === '-' &&
                all[j + 3] &&
                all[j + 3].t === 'atom' &&
                all[j + 4] &&
                all[j + 4].t === 'close'
            )
                return true;
            return false;
        });
    // a variable of its own next to the two coordinates (a slack s_1): three variables
    f.extraVar =
        atoms.some(
            (a) =>
                a.base !== 'x' &&
                /^[0-9]$/.test(a.sub ?? '') &&
                (() => {
                    const i = all.indexOf(a);
                    const nb = (y: Item | undefined) => !!y && y.t === 'atom' && y.base === 'x';
                    return !nb(all[i - 1]) && !nb(all[i + 1]) && !(all[i - 1] && all[i - 1].t === 'sym' && all[i - 1].v === 'cdot') && !(all[i + 1] && all[i + 1].t === 'sym' && all[i + 1].v === 'cdot');
                })()
        ) &&
        atoms.some((a) => a.base === 'x' && a.sub === '1') &&
        atoms.some((a) => a.base === 'x' && a.sub === '2');
    f.nlOne = !!(f.hasPow || f.hasFn || f.hasAbs || f.fnMaxMin);
    // (P4: a bound on the real variable alone, by numbers or parameters, is not a constraint with a switch)
    const boundAlone = !!(f.c_rhsNum || f.c_rhsParam || f.c_endsNum || f.c_endsPar);
    f.binVar = rels.length > 0 && ((defs.spanBin && ineqs.length > 0) || (defs.binAll && ineqs.length > 0 && !boundAlone) || atoms.some((a) => defs.bin.has(String(a.base))));
    // P3: a relaxed binary between two numbers (0 <= y <= 1) is a piece of its axis
    if (f.binVar && ineqs.length === 2 && rels.length === 2 && f.c_endsNum && anyAtom(parts[1])) f.binVar = false;
    // P2: an equation that is linear in two decision variables with other names
    if (rels.length === 1 && rels[0] === 'eq') {
        const lv = all.filter((x) => x.t === 'atom');
        const names = new Set(lv.map(key));
        f.lin2eq =
            isNumLike(parts[1]) &&
            names.size === 2 &&
            (lv.every((x) => /^[a-df-hp-su-w]$/.test(String(x.base))) || lv.every((x) => /^[KL]$/.test(String(x.base)))) &&
            lv.every((x) => !x.sub && !x.star && !x.prime && !x.vec && !x.hat && !x.bar) &&
            parts[0].length >= 3 &&
            parts[0].every((x) => x.t === 'atom' || x.t === 'num' || (x.t === 'sym' && /^(\+|-|cdot)$/.test(String(x.v))));
    }
    f.bodyOnlyXk = letters.size === 1 && (L('x_1') || L('x_2'));
    f.recMatStep =
        !!headBase &&
        body.some((x, i) => x.t === 'atom' && /^[AMPTB]$/.test(String(x.base)) && !x.sub && ((body[i + 1] && body[i + 1].t === 'atom' && body[i + 1].base === headBase) || (body[i - 1] && body[i - 1].t === 'atom' && body[i - 1].base === headBase)));
    Object.assign(f, vectorFacts(parts, rels, defs));
    f.polarR = all.some((x) => x.t === 'atom' && x.base === 'r' && !x.sub) && all.some((x) => x.t === 'atom' && (x.base === 'theta' || x.base === 'varphi') && !x.sub) && nEq === 1;
    // (A built-in as the name, \ln: ..., has no base: undefined, as in the frozen code, matches no head.)
    return { f, headBase, mapName: f.mapForm ? P0[0].base : null };
}

/** The feature vectors of the parts of a formula, in order. Throws on a formula it cannot read. */
export function encode(tex: string, ctx?: RecognizeContext): Float32Array[] {
    const norm = normalize(tex, ctx);
    let items = parse(clean(norm.tex));
    // a label word with a colon in front names the formula (\text{Niveaulinie:} ...)
    if (items.length > 2 && (items[0].t === 'text' || items[0].t === 'name') && /:␣*$/.test(String(items[0].v ?? items[0].name))) {
        items = items.slice(1);
        while (items.length && (items[0].t === 'sp' || items[0].t === 'join')) items = items.slice(1);
    }
    const first = segments(items);
    {
        // round 4: the value of a bound after it, and the name of a constraint's function before it
        const isI = (r: string) => r === 'lt' || r === 'le' || r === 'gt' || r === 'ge';
        first.segs = first.segs.map((sg) => {
            const { parts, rels } = relSplit(sg);
            const dd = depths(sg);
            const relAt: number[] = [];
            sg.forEach((x, i) => {
                if (dd[i] === 0 && x.t === 'rel' && x.v !== 'mid') relAt.push(i);
            });
            const n = rels.length;
            // the value of a bound after it: x \le -2 + 6 = 4, x > 500/12 \approx 41.7
            const pn = (p: Item[]) => isNumLike(p) || paramExpr(p.filter((x) => !(x.t === 'num')).length ? p : [], null) || (p.some((x) => x.t === 'atom') && paramExpr(p, null));
            if (n >= 2 && (rels[n - 1] === 'eq' || rels[n - 1] === 'approx') && rels.slice(0, -1).every(isI) && pn(parts[n]) && pn(parts[n - 1])) return sg.slice(0, relAt[n - 1]);
            // a constraint written with the name of its function: g(x) = 2 - x_1 - x_2 \le 0
            if (n === 2 && rels[0] === 'eq' && isI(rels[1]) && parts[2].length === 1 && parts[2][0].t === 'num' && parts[2][0].v === '0') {
                const c = asCall(parts[0]);
                if (c && c.name.t === 'atom' && !c.name.prime && (/^[gh]$/.test(String(c.name.base)) || (c.name.base === 'f' && /^[0-9ij]$/.test(c.name.sub ?? '')))) return sg.slice(relAt[0] + 1);
            }
            return sg;
        });
    }
    const { f: cf, facts } = noteContext(ctx);
    const dn = noteValues(defNames(ctx?.defs), ctx);
    dn.ctxDim = !!cf.ctxDim || /\\mathbb\{?R\}?\^\{?[nmdk]|[mn]\s*\\times\s*[nmk]/.test(String(tex));
    cf.noteVec = dn.deco.size > 0;
    dn.bin = facts.bin;
    dn.binAll = facts.binAll;
    dn.applied = facts.applied;
    // a variable declared in {0, 1} in the span itself
    for (const m of String(norm.tex).matchAll(/\\in\s*\\\{\s*0\s*,\s*1\s*\\\}/g)) {
        const at0 = m.index ?? 0;
        const pre = /((?:\\?[a-zA-Z]+(?:_\{?\w{1,3}\}?)?\s*,\s*){0,3}\\?[a-zA-Z]+(?:_\{?\w{1,3}\}?)?)\s*$/.exec(String(norm.tex).slice(Math.max(0, at0 - 30), at0));
        if (pre)
            for (const q of pre[1].matchAll(/\\?([a-zA-Z]+)(?![a-zA-Z])/g))
                if (!/^(quad|qquad|text|in)$/.test(q[1])) {
                    dn.bin.add(q[1]);
                    dn.spanBin = true;
                }
    }
    // x is the scalar variable of the note: a function f(x) with a body in numbers is defined, or a formula nearby treats x as a number
    const xDef = (Array.isArray(ctx?.defs) ? ctx.defs : []).some((q) => /^\s*\\?[A-Za-z]+(_\{?\w+\}?)?\s*\(\s*x\s*\)\s*:?=/.test(String(q)) && !/\\top|\^T|\\\||\\lVert|x_\{?[0-9ijn]|[A-Z]\s*x(?![a-zA-Z_^])|\\sum/.test(String(q)));
    cf.ctxXScalar = !cf.ctxXVec && (xDef || facts.xScalarCtx);
    // names with a superscript index (x^1, x^2, ... as options, iterates): the lone formula letter^digit
    const core = String(norm.tex).replace(/(\\[,;:! ]|[\s.,;])+$/, '');
    const supM = /^\s*\\?([a-zA-Z]+)\s*\^\s*\{?\s*([0-9])\s*\}?\s*$/.exec(core);
    const context = String(ctx?.context ?? '');
    // a list of one letter with superscripts (x^1, x^2, \dots, x^7; x^4, x^6, x^7) is a list of names
    if (/^\s*([a-zA-Z])\s*\^\s*\{?\s*\w\s*\}?(\s*,\s*(\\[lc]?dots|([a-zA-Z])\s*\^\s*\{?\s*\w\s*\}?))+\s*$/.test(core)) {
        const ls = [...String(norm.tex).matchAll(/([a-zA-Z])\s*\^/g)].map((q) => q[1]);
        if (new Set(ls).size === 1) cf.supName = true;
    }
    // a superscript letter next to dominance words (x^a dominates x^b)
    if (/^\s*[a-zA-Z]\s*\^\s*\{?\s*[a-z]\s*\}?\s*$/.test(core) && /dominat|dominier|pareto/i.test(context)) cf.supName = true;
    if (supM) {
        const digits = new Set<number>();
        for (const o of facts.others) {
            const q = /^\s*\\?([a-zA-Z]+)\s*\^\s*\{?\s*([0-9])\s*\}?\s*$/.exec(o);
            if (q && q[1] === supM[1]) digits.add(Number(q[2]));
        }
        const listed = [...context.matchAll(new RegExp('(?:^|[^a-zA-Z\\\\])' + supM[1] + '\\^\\{?([0-9])', 'g'))].map((q) => Number(q[1]));
        for (const v of listed) digits.add(v);
        const own = Number(supM[2]);
        const all4 = new Set([...digits, own]);
        let run = 1;
        for (let v = own - 1; all4.has(v); v--) run++;
        for (let v = own + 1; all4.has(v); v++) run++;
        const before = context.split('[F]')[0];
        const itemWord = /(alternativ\w*|options?|lösung(en)?|solutions?|punkte?|points?|szenari\w*|scenarios?|kandidat\w*|candidates?|iterierte|iterates?|vektor\w*|vectors?)\s*\$?\s*$/i.test(before);
        // the label of a table row whose other cells are numbers
        const rowLabel = /^\s*\|\s*\[F\]\s*(\|\s*\$?-?[0-9][0-9.,{}]*\$?\s*)+\|?\s*$/.test(context);
        cf.supName = own === 1 || rowLabel || digits.has(1) || (run >= 4 && /\s\|\s/.test(context)) || itemWord || (digits.size > 0 && /dominat|dominier|pareto|effizient|efficient/i.test(context));
        // the text calls it a square or a power right there
        if (facts.powWord && own !== 1) cf.supName = false;
    }
    // the variable letters of the functions around the formula: K(q) = ... makes q a variable
    const ctxVars = new Set<string>();
    for (const src of [String(ctx?.context ?? ''), ...(Array.isArray(ctx?.defs) ? ctx.defs.map(String) : [])]) for (const m of src.matchAll(/[A-Za-z}']\s*\(\s*(\\?[a-zA-Z]+)\s*\)\s*(?::?=|\\approx)/g)) ctxVars.add(m[1].replace('\\', ''));
    // a set of pairs given by one equation is read as that equation (a curve)
    const fromSet = first.segs.map((sg) => {
        const { parts, rels } = relSplit(sg);
        return setCurve(setBuilder(parts, rels));
    });
    const segs1 = first.segs.map((sg, k) => fromSet[k] ?? sg);
    const curveAt = new Set<number>();
    // a chain "head(x) = A = B" that does not end in a number: every "head(x) = part" is read by itself
    const segs: Item[][] = [];
    const side: boolean[] = [];
    const joins: string[] = [];
    segs1.forEach((sg, k) => {
        const { parts, rels } = relSplit(sg);
        const chain = rels.length >= 2 && rels.every((r) => r === 'eq' || r === 'approx') && !!asCall(parts[0]) && !isNumLike(parts[parts.length - 1]) && parts.every((q) => q.length);
        const list = chain ? parts.slice(1).map((b): Item[] => [...parts[0], { t: 'rel', v: 'eq' }, ...b]) : [sg];
        list.forEach((q, i) => {
            if (fromSet[k]) curveAt.add(segs.length);
            segs.push(q);
            side.push(first.side[k]);
            if (k > 0 || i > 0) joins.push(i > 0 ? 'chain' : first.joins[k - 1]);
        });
    });
    const raw = segs.map((s) => partFeatures(s, dn, ctxVars));
    const prog = raw.some((q) => q.f.opt && (q.f.hasTop || q.f.capMul)) || (raw.some((q) => q.f.opt) && raw.some((q) => q.f.idxSubs));
    const out: Float32Array[] = [];
    const heads = raw.map((r) => r.headBase);
    // a pair of heads x(t), y(t) is a parametric curve
    const paramPair = raw.filter((r) => r.f.hc1 && r.f.hcArg_t).length >= 2 && heads.includes('x') && heads.includes('y');
    const anyOf = (name: string) => raw.some((q) => q.f[name]);
    const whole: Answers = {
        unreadable: norm.unreadable,
        prose: norm.prose,
        rowCont: norm.rowCont,
        paramPair,
        anyMapsto: anyOf('hasMapsto'),
        anyLogic: anyOf('op_logic'),
        anyPm: anyOf('hasPm'),
        anyVec: anyOf('hasTop') || anyOf('capMul') || anyOf('hasVec'),
        genericProgram: prog,
    };
    // P6: a concrete first form decides; a generic one has unknown calls and gets no card by itself (eqvForms stays 0)
    // C2: a letter that is a vector in the note is no running letter
    for (const q of raw) if (q.f.runOne && q.f.runKey === 'x' && cf.ctxXVec) q.f.runOne = false;
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
        if (side[i]) v[at('afterWord')] = 1;
        if (curveAt.has(i)) v[at('ctxLine')] = 1;
        // round 4: a vector whose name a constraint of the span bounds (x = (1, 2), x \ge 0)
        const headName = raw[i].f.vecHeadName;
        if (typeof headName === 'string' && raw.some((q, k) => k !== i && (q.f.ineq1 || q.f.ineq2) && segs[k].some((x) => x.t === 'atom' && String(x.base) + (x.sub ? '_' + x.sub : '') === headName))) v[at('vecBound')] = 1;
        if (facts.argPair && (raw[i].f.ha_xsub || (raw[i].f.has_x1 && raw[i].f.has_x2)) && !raw[i].f.hc) v[at('argPair')] = 1;
        // y = 1 => x <= b: a constraint that holds only when a switch is set
        // (every part after the arrow belongs to the switch)
        for (let k = 1; k <= i; k++)
            if (joins[k - 1] === '\\Rightarrow' && segs[k - 1].length === 3 && segs[k - 1][0].t === 'atom' && segs[k - 1][1].t === 'rel' && segs[k - 1][1].v === 'eq' && segs[k - 1][2].t === 'num' && /^[01]$/.test(String(segs[k - 1][2].v))) v[at('afterIndicator')] = 1;
        // a map whose rule follows in the same span: the rule decides
        if (raw[i].f.mapForm && raw.slice(i + 1).some((q) => q.f.hc && q.headBase === raw[i].mapName)) v[at('mapRuleLater')] = 1;
        if (i < raw.length - 1 && joins.includes('\\Rightarrow') && raw.slice(i + 1).some((q) => q.f.hcArgNum || q.f.hcArgExpr || q.f.hcArgMarked)) v[at('laterEval')] = 1;
        // a later part after an arrow solves for x or ends in a value: the chain is a calculation
        if (i < raw.length - 1 && joins.slice(i).some((j) => j === '\\Rightarrow' || j === '\\iff') && raw.slice(i + 1).some((q) => q.f.ha_x || (q.f.lastNumeric && q.f.eq1 && !q.f.hc && !q.f.hexpr))) v[at('laterSolve')] = 1;
        out.push(v);
    }
    return out;
}
