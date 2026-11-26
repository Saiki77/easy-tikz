/*
 * Formula recognition (6.2): the spellings of a formula that the builder of
 * its card is tried on. The network reads notation the card builders were
 * never written for (x(t) = x_0 e^{at}, 0{,}5, a part after \qquad, \Sigma
 * = \begin{pmatrix}, f\colon \mathbb{R} \to \mathbb{R}); each builder reads
 * one spelling. Given the network's label, these rewrites say the same
 * formula in the builder's spelling: the formula itself first, then its
 * spacing and decimal commas plain, then each part, each side of a chain of
 * =, and the rewrites of the label's kind. Only the Smart setting uses them,
 * and only after the formula as written did not build. Pure: no DOM, no
 * Obsidian.
 */
import type { Label } from './net';
import { splitLetterRuns } from '../../latex';
import { isEmptyPair } from '../hover';

/** The builder a label's card comes from. */
export type CardGroup = 'chart' | 'notes6' | 'linear' | 'iterate' | 'vector';

const GROUP: Record<Exclude<Label, 'none'>, CardGroup> = {
    function: 'chart',
    surface: 'chart',
    polar: 'chart',
    implicit: 'chart',
    region: 'chart',
    set: 'notes6',
    map: 'notes6',
    condition: 'notes6',
    interval: 'notes6',
    jensen: 'notes6',
    epigraph: 'notes6',
    matrix: 'linear',
    product: 'linear',
    det: 'linear',
    eigen: 'linear',
    recurrence: 'iterate',
    sum: 'iterate',
    domain: 'iterate',
    vector: 'vector',
};

/** The builder of a label's card: src/formula.ts (chart), src/notes6/hover.ts, src/linear/hover.ts, src/iterate/hover.ts; null for none. */
export function groupOf(label: Label): CardGroup | null {
    return label === 'none' ? null : GROUP[label];
}

/** One spelling of a formula for its card's builder; for a function renamed into x, the letter its x-axis is named after. */
export interface Spelling {
    tex: string;
    axis?: string;
}

/**
 * Split at the top level (outside braces, brackets and environments) where
 * `sep` (a sticky regex) matches. Returns the pieces and the separators.
 */
function topSplit(tex: string, sep: RegExp): { pieces: string[]; seps: string[] } {
    const pieces: string[] = [];
    const seps: string[] = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < tex.length; ) {
        const c = tex[i];
        if (c === '\\') {
            const cmd = /^\\(?:begin|end)(?![A-Za-z])|^\\[{}]/.exec(tex.slice(i, i + 6));
            if (depth === 0) {
                sep.lastIndex = i;
                const m = sep.exec(tex);
                if (m && m.index === i && m[0].length) {
                    pieces.push(tex.slice(from, i));
                    seps.push(m[0]);
                    i += m[0].length;
                    from = i;
                    continue;
                }
            }
            if (cmd) {
                if (cmd[0] === '\\begin' || cmd[0] === '\\{') depth++;
                else depth = Math.max(0, depth - 1);
                i += cmd[0].length;
                continue;
            }
            // Any other command, or an escaped sign: one step past it.
            const word = /^\\(?:[A-Za-z]+|.)/.exec(tex.slice(i));
            i += word ? word[0].length : 1;
            continue;
        }
        if (c === '{' || c === '(' || c === '[') {
            depth++;
            i++;
            continue;
        }
        if (c === '}' || c === ')' || c === ']') {
            depth = Math.max(0, depth - 1);
            i++;
            continue;
        }
        if (depth === 0) {
            sep.lastIndex = i;
            const m = sep.exec(tex);
            if (m && m.index === i && m[0].length) {
                pieces.push(tex.slice(from, i));
                seps.push(m[0]);
                i += m[0].length;
                from = i;
                continue;
            }
        }
        i++;
    }
    pieces.push(tex.slice(from));
    return { pieces, seps };
}

/** Where a formula of a note splits into parts, as the network cuts it: \qquad, \Rightarrow, \iff, a word, ", " before a space. */
const PART =
    /\\(?:qquad|quad|Rightarrow|Longrightarrow|implies|iff|Leftrightarrow|Longleftrightarrow)(?![A-Za-z])|\\(?:text|textrm|mathrm)\s*\{[^{}]*?(?:für|for|mit|with|wobei|where|falls|if|wenn|when|und|and|s\.t\.|subject to)[^{}]*\}|,(?=\s*(?:\\[,;: ]|\\q?quad(?![A-Za-z])|~))/y;

/** The parts of a formula (at least two), or none. */
function partsOf(tex: string): string[] {
    const { pieces } = topSplit(tex, PART);
    const parts = pieces.map((p) => p.trim()).filter((p) => p && !/^[,;.]$/.test(p));
    return parts.length > 1 ? parts : [];
}

/** Spacing commands and decimal commas as the builders read them: 0{,}5 is 0.5, 2\,500 is 2500, \, is a space, \tfrac12 is \frac{1}{2}. */
export function plainSpacing(tex: string): string {
    return tex
        .replace(/(\d)\s*\\,\s*(\d{3})(?!\d)/g, '$1$2')
        .replace(/\{,\}/g, '.')
        .replace(/:=|\\coloneqq(?![A-Za-z])/g, '=')
        .replace(/\\[dt]?frac\s*([0-9])\s*([0-9A-Za-z])/g, '\\frac{$1}{$2}')
        .replace(/\\[dt]frac(?![A-Za-z])/g, '\\frac')
        // A row break \\ stays; \, \; \: \! and "\ " are spaces.
        .replace(/\\\\|\\[,;:! ]|~/g, (m) => (m === '\\\\' ? m : ' '))
        .replace(/\\(?:displaystyle|textstyle)(?![A-Za-z])/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/[.,;]\s*$/, '')
        .trim();
}

/** An equals sign (not part of <= or !=). */
const EQUALS = /(?<![<>!])=/y;
const EQ = /(?<![<>!])=|\\approx(?![A-Za-z])/y;

/** A chain a = b = c (or ≈) said shorter: a = b, a = c; a value after ≈ at the end dropped. */
function chainsOf(tex: string): string[] {
    const { pieces, seps } = topSplit(tex, EQ);
    if (pieces.length < 2) return [];
    const p = pieces.map((x) => x.trim());
    const out: string[] = [];
    if (p.length >= 3) out.push(`${p[0]} = ${p[1]}`, `${p[0]} = ${p[p.length - 1]}`);
    if (seps[0] !== '=') out.push(`${p[0]} = ${p[1]}`);
    if (seps[seps.length - 1] !== '=') {
        // A value after ≈ at the end: the formula without it.
        let short = p[0];
        for (let i = 1; i < p.length - 1; i++) short += ` ${seps[i - 1]} ${p[i]}`;
        out.push(short);
    }
    return out.filter((x) => x.trim());
}

/** The left and the right side of a formula with one =, or null. */
function sides(tex: string): { head: string; body: string } | null {
    const { pieces } = topSplit(tex, EQUALS);
    if (pieces.length !== 2) return null;
    const head = pieces[0].trim();
    const body = pieces[1].trim();
    return head && body ? { head, body } : null;
}

/** Greek letters that may be a variable. */
const GREEK_VAR = /^\\(?:alpha|beta|gamma|delta|varepsilon|epsilon|zeta|eta|theta|vartheta|kappa|lambda|mu|nu|xi|rho|sigma|tau|varphi|phi|chi|psi|omega|Omega|Theta|Phi)$/;

/** A head name(v) with one variable v (a letter or a Greek letter): name and v, or null. */
function callHead(head: string): { name: string; v: string } | null {
    const m = /^(.+?)\s*\(\s*(\\[A-Za-z]+|[A-Za-z])\s*\)$/.exec(head);
    if (!m || /[()=]/.test(m[1])) return null;
    const v = m[2];
    return /^[A-Za-z]$/.test(v) || GREEK_VAR.test(v) ? { name: m[1].trim(), v } : null;
}

/** The letter v where it stands alone (not in a command, a longer name, or a subscript; x_0 is another name). */
function alone(v: string): RegExp {
    const esc = v.replace(/\\/g, '\\\\');
    return v.startsWith('\\') ? new RegExp(`${esc}(?![A-Za-z_])`, 'g') : new RegExp(`(?<![\\\\A-Za-z_]|_\\{)${esc}(?![A-Za-z_])`, 'g');
}

const uses = (tex: string, v: string) => alone(v).test(tex);

/** 6.2.4: re replaced by `to`; a letter put in right after a command gets a space (\lvert x, not \lvertx: \lvert\theta renamed into x). */
function putIn(tex: string, re: RegExp, to: string): string {
    return tex.replace(re, (_m: string, ...rest: unknown[]) => {
        const at = rest.find((r) => typeof r === 'number') as number;
        return /^[A-Za-z]/.test(to) && /\\[A-Za-z]+$/.test(tex.slice(0, at)) ? ` ${to}` : to;
    });
}
const rename = (tex: string, v: string, to: string) => putIn(tex, alone(v), to);
/** The stand-ins of two coordinates as x and y. */
const standInsXY = (tex: string) => putIn(putIn(tex, /\uE000/g, 'x'), /\uE001/g, 'y');

/** A function name the formula does not use: f, g, h, p, q or u. */
function freshName(tex: string): string {
    return ['f', 'g', 'h', 'p', 'q', 'u'].find((n) => !uses(tex, n)) ?? 'f';
}

/** The single letters of a formula as LaTeX reads them (ax is a and x), without e, i and the names of commands. */
function lettersOf(tex: string): string[] {
    const out: string[] = [];
    for (const m of splitLetterRuns(tex).matchAll(/(?<![\\A-Za-z_]|_\{)([A-Za-df-hj-z])(?![A-Za-z_])/g)) if (!out.includes(m[1])) out.push(m[1]);
    return out;
}

/** A function's arguments in brackets, as a chart reads them: \sin\omega_0 t is \sin(\omega_0 t), \ln x is \ln(x). */
function bracketArguments(tex: string): string {
    const factor = String.raw`(?:[0-9.]+|\\(?!(?:sin|cos|tan|sinh|cosh|tanh|ln|log|exp|cdot|frac|sqrt|left|right)(?![A-Za-z]))[A-Za-z]+|[A-Za-z])(?:\s*_\s*(?:\{[^{}]*\}|[A-Za-z0-9]))?`;
    const re = new RegExp(String.raw`\\(sin|cos|tan|sinh|cosh|tanh|ln|log|exp)(?![A-Za-z])\s*(?![({^_]|\\left(?![A-Za-z]))((?:\s*${factor})+)`, 'g');
    return tex.replace(re, (_m, fn: string, arg: string) => `\\${fn}(${arg.trim()})`);
}

/**
 * A function whose head the chart cannot read (x(t) =, \Phi(x) =, i(t) =,
 * \hat y =, V(\eta) =, MC = 2q + 10): f(x) = ..., its letter as x and the
 * axis named after it. And its arguments in brackets (\sin\omega_0 t).
 */
function functionSpellings(tex: string): Spelling[] {
    const out: Spelling[] = [];
    const add = (s: Spelling) => {
        out.push(s);
        const b = bracketArguments(s.tex);
        if (b !== s.tex) out.push({ ...s, tex: b });
    };
    const b0 = bracketArguments(tex);
    if (b0 !== tex) out.push({ tex: b0 });
    const hb = sides(tex);
    if (!hb) return out;
    const head = hb.head;
    const body = splitLetterRuns(hb.body);
    const fn = freshName(body);
    const call = callHead(head);
    if (call) {
        const { v } = call;
        if (v === 'x') add({ tex: `${fn}(x) = ${body}` });
        else if (uses(body, 'x')) return out;
        // n and k keep their letter: formulaLines draws them as sequences from 0.
        else if (v === 'n' || v === 'k') add({ tex: `${fn}(${v}) = ${body}` });
        else add({ tex: `${fn}(x) = ${rename(body, v, 'x')}`, axis: v });
        return out;
    }
    if (/[()]/.test(head)) return out;
    if (uses(body, 'x')) {
        add({ tex: `${fn}(x) = ${body}` });
        return out;
    }
    const idx = /_\s*\{?\s*([tnk])\s*\}?\s*$/.exec(head);
    const only = lettersOf(body);
    const v = idx && uses(body, idx[1]) ? idx[1] : only.length === 1 ? only[0] : null;
    if (!v) return out;
    if (v === 'n' || v === 'k') add({ tex: `${fn}(${v}) = ${body}` });
    else add({ tex: `${fn}(x) = ${rename(body, v, 'x')}`, axis: v });
    return out;
}

/** min{a, b} as min(a, b) (a set brace the chart reads as a call). */
const minCall = (tex: string) => tex.replace(/\\(min|max)\s*\\\{([^{}]*)\\\}/g, '\\$1($2)');

/** A surface whose head the chart cannot read (u = ..., L = ..., F(K, L) = ...): z = ..., its variables as x and y. */
function surfaceSpellings(tex: string): Spelling[] {
    const out: Spelling[] = [];
    const plain = minCall(tex);
    if (plain !== tex) out.push({ tex: plain });
    const hb = sides(plain);
    if (!hb) return out;
    const two = /^(.+?)\s*\(\s*(\\[A-Za-z]+|[A-Za-z])\s*,\s*(\\[A-Za-z]+|[A-Za-z])\s*\)$/.exec(hb.head);
    if (two && !/[()]/.test(two[1])) {
        const [a, b] = [two[2], two[3]];
        if (!(a === 'x' && b === 'y') && !uses(hb.body, 'x') && !uses(hb.body, 'y')) out.push({ tex: `z = ${rename(rename(hb.body, a, 'x'), b, 'y')}` });
    } else if (!/[()]/.test(hb.head) && hb.head !== 'z') out.push({ tex: `z = ${hb.body}` });
    return out;
}

/** A polar curve the chart cannot read: φ as θ, \sin 3\theta as \sin(3\theta), a(1 + ...) as a \cdot (1 + ...), r^2 = ... as r = \sqrt{...}. */
function polarSpellings(tex: string): Spelling[] {
    let s = tex.replace(/\\(?:var)?phi(?![A-Za-z])/g, '\\theta');
    s = s.replace(/\\(sin|cos|tan)\s*([0-9.]*\s*\\theta)(?![A-Za-z])/g, '\\$1($2)');
    const hb = sides(s);
    if (!hb) return s !== tex ? [{ tex: s }] : [];
    const body = hb.body.replace(/(^|[^\\A-Za-z])([a-qs-z])\s*\(/g, '$1$2 \\cdot (');
    const square = /^r\s*\^\s*\{?\s*2\s*\}?$/.test(hb.head);
    return [{ tex: square ? `r = \\sqrt{${body}}` : `${hb.head} = ${body}` }];
}

const REALS = /^\\mathbb\s*\{?\s*R\s*\}?(?:\s*\^\s*(?:\{[^{}]*\}|[A-Za-z0-9]))?$/;

/** 6.2.1: the sets of a note that a map's domain letter may name: letter to the space it lies in (\mathbb{R}, or \mathbb{R}^2 for a set in the plane). */
export function noteDomains(formulas: readonly string[] | undefined): Map<string, string> {
    const out = new Map<string, string>();
    for (const f of formulas ?? []) {
        const m = /^\s*([A-Z])(?:_\{?[A-Za-z0-9]+\}?)?\s*(?::=|=|\\coloneqq|\\subseteq|\\subset(?![A-Za-z])|⊆|⊂)\s*([\s\S]+)$/.exec(f);
        if (!m || out.has(m[1])) continue;
        const rhs = m[2].replace(/\\(?:left|right|big|Big)(?![A-Za-z])/g, '');
        // a set of numbers or of pairs: ℝ, an interval, a ray, ℝ \ {0}; ℝ², a product of intervals, {(x, y) | ...}
        const plane = /\^\s*\{?\s*2\s*\}?|\\times|^\s*\\\{\s*\(\s*[A-Za-z](?:_\{?\w+\}?)?\s*,\s*[A-Za-z](?:_\{?\w+\}?)?\s*\)/.test(rhs);
        const space3 = /\^\s*\{?\s*[3-9]\s*\}?|\(\s*[A-Za-z]\s*,\s*[A-Za-z]\s*,\s*[A-Za-z]\s*\)/.test(rhs);
        const real = /^\s*(?:\\mathbb\s*\{?\s*R|ℝ|[[(]|\]|\\\{\s*(?:x|t)\b)/.test(rhs);
        if (space3) continue;
        if (plane) out.set(m[1], '\\mathbb{R}^2');
        else if (real) out.set(m[1], '\\mathbb{R}');
    }
    return out;
}

/**
 * A map the card cannot read: \colon as :, \longrightarrow as \to, a
 * domain or codomain that is no ℝ or ℝⁿ (an interval, ℝ_{>0}, ℝ \ {0}) as
 * ℝ; 6.2.1: a domain letter (D) as the space of the set the note gives it
 * (`domains`: D = [0, 1] is ℝ, D \subseteq ℝ² is ℝ²), and a built-in
 * function as the name (\ln, \sin: the card draws it).
 */
function mapSpellings(tex: string, domains?: ReadonlyMap<string, string>): Spelling[] {
    const s = tex.replace(/\\colon(?![A-Za-z])/g, ':').replace(/\\(?:rightarrow|longrightarrow)(?![A-Za-z])/g, '\\to');
    const m = /^\s*(\\?[A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+?)\s*\\to\s*(.+?)\s*$/.exec(s);
    if (!m) return s !== tex ? [{ tex: s }] : [];
    const space = (x: string) => {
        const t = x.trim();
        if (REALS.test(t)) return t;
        return domains?.get(t) ?? '\\mathbb{R}';
    };
    return [{ tex: `${m[1].replace(/^\\/, '')}: ${space(m[2])} \\to ${space(m[3])}` }];
}

/** The set braces \{ ... \} of a formula that hold a set builder: where they start and end, and what is inside; null without one. */
function setBraces(tex: string): { start: number; end: number; inner: string } | null {
    for (let i = tex.indexOf('\\{'); i >= 0; i = tex.indexOf('\\{', i + 2)) {
        let depth = 0;
        for (let j = i; j < tex.length; j++) {
            if (tex.startsWith('\\{', j)) {
                depth++;
                j++;
            } else if (tex.startsWith('\\}', j)) {
                depth--;
                j++;
                if (depth === 0) {
                    const inner = tex.slice(i + 2, j - 1).trim();
                    // a builder: a separator or a relation inside (\{1\}, \{0, 1\} are lists)
                    if (/\\mid|\\vert|\||:|;|\\colon|\\text|\\le|\\ge|<|>|=/.test(inner)) return { start: i, end: j + 1, inner };
                    break;
                }
            } else if (tex[j] === '\\') j++;
        }
    }
    return null;
}

/** Where a set builder's head ends: the first separator at the top level (\mid, |, \vert, :, \colon, ;, a word such as mit or with). */
const SET_SEPARATOR = /\\mid(?![A-Za-z])|\\vert(?![A-Za-z])|\\colon(?![A-Za-z])|\\(?:text|textrm|mathrm)\s*\{\s*(?:mit|with|wobei|where|so\s*dass|sodass|such\s+that|für\s+die|for\s+which)\s*\}|[|:;]/y;

/** A set's spelling as the set card reads it: sizes out (\middle| is |), \lbrace as \{, ℝ, ∈ and ∣ as LaTeX. */
const plainSet = (tex: string) =>
    tex
        .replace(/\\(?:left|right|middle|bigl?|bigr?|bigm|Bigl?|Bigr?|Bigm|biggl?|biggr?|Biggl?|Biggr?)(?![A-Za-z])/g, '')
        .replace(/\\lbrace(?![A-Za-z])/g, '\\{')
        .replace(/\\rbrace(?![A-Za-z])/g, '\\}')
        .replace(/ℝ/g, '\\mathbb{R}')
        .replace(/∈/g, '\\in ')
        .replace(/∣/g, '\\mid ');

/** A set builder as head and condition; a set given by its condition alone gets its head. Null without a set builder. */
function setBuilderOf(texIn: string): { head: string; cond: string } | null {
    const b = setBraces(plainSet(texIn));
    if (!b) return null;
    const { pieces, seps } = topSplit(b.inner, SET_SEPARATOR);
    let head = '';
    let cond = '';
    if (pieces.length >= 2 && pieces[0].trim()) {
        head = pieces[0].trim();
        // the rest is the condition, with its own bars (|x - 1| \le 3)
        cond = b.inner.slice(pieces[0].length + seps[0].length).trim();
    } else {
        // a set written by its condition only: \{x_1^2 + x_2^2 \le 4\}, \{x + y \le 1, x \ge 0\}
        cond = b.inner;
        const used = (v: string) => new RegExp(`(?<![A-Za-z\\\\])${v.replace('_', '\\s*_\\s*\\{?')}(?![A-Za-z0-9])`).test(cond);
        if (used('x_1') && used('x_2')) head = '(x_1, x_2)';
        else if (/(?<![A-Za-z\\])x(?![A-Za-z_])/.test(cond) && /(?<![A-Za-z\\])y(?![A-Za-z_])/.test(cond)) head = '(x, y)';
        else if (/(?<![A-Za-z\\])x(?![A-Za-z_])/.test(cond)) head = 'x';
        else return null;
    }
    return cond ? { head, cond } : null;
}

/** The coordinates of a set's head: (x, y), (x_1, x_2), (u, v) with \in \mathbb{R}^2, or x \in \mathbb{R}^2 with x_1 and x_2 in the condition; null for one variable. */
function pairOf(head: string, cond: string): [string, string] | null {
    const name = String.raw`[A-Za-z](?:\s*_\s*(?:\{\s*[A-Za-z0-9]+\s*\}|[A-Za-z0-9]))?`;
    const pair = new RegExp(String.raw`^\(\s*(${name})\s*,\s*(${name})\s*\)(?:\s*\\in\s*\\mathbb\s*\{?\s*R\s*\}?\s*\^\s*\{?\s*2\s*\}?)?$`).exec(head);
    if (pair) return [pair[1].replace(/[\s{}]/g, ''), pair[2].replace(/[\s{}]/g, '')];
    const plane = /^([A-Za-z])(?:\s*\\in\s*\\mathbb\s*\{?\s*R\s*\}?\s*\^\s*\{?\s*2\s*\}?)?$/.exec(head);
    if (plane && new RegExp(`${plane[1]}\\s*_\\s*\\{?\\s*1`).test(cond) && new RegExp(`${plane[1]}\\s*_\\s*\\{?\\s*2`).test(cond)) return [`${plane[1]}_1`, `${plane[1]}_2`];
    return null;
}

/** A coordinate (x_1) replaced by a letter (x) in a condition. */
function renameCoordinate(tex: string, from: string, to: string): string {
    const [base, sub] = from.split('_');
    const re = sub ? new RegExp(`(?<![A-Za-z\\\\])${base}\\s*_\\s*(?:\\{\\s*${sub}\\s*\\}|${sub})(?![0-9])`, 'g') : new RegExp(`(?<![A-Za-z\\\\_])${base}(?![A-Za-z_])`, 'g');
    return tex.replace(re, to);
}

/**
 * 6.2.1, round 3: a set the card cannot read (DESIGN3.md, section 3): the
 * separators ;, :, \colon, \middle|, \vert and words (mit, with, such
 * that) as \mid; the set alone, without a name or image before it and a
 * value after it (= (-2, 2), = \emptyset); a set given by its condition only
 * with its head; x \in \mathbb{R}^n written in the condition moved into the
 * head; the coordinates x_1, x_2 (or u, v) as x and y, with x \ge 0 for
 * both; a domain the card does not draw (\operatorname{dom} f) left out.
 */
function setSpellings(tex: string): Spelling[] {
    const sb = setBuilderOf(tex);
    if (!sb) return [];
    let head = sb.head.replace(/\s*\\in\s*\\operatorname\s*\{\s*dom\s*\}\s*[A-Za-z]$/, '');
    let cond = sb.cond.replace(/[.,;]\s*$/, '');
    // x \mid x \in R^n, g(x) \le 0
    const member = /^([A-Za-z])\s*\\in\s*(\\mathbb\s*\{?\s*R\s*\}?(?:\s*\^\s*(?:\{[^{}]*\}|[A-Za-z0-9]))?)\s*,\s*([\s\S]+)$/.exec(cond);
    if (member && member[1] === head) {
        head = `${head} \\in ${member[2]}`;
        cond = member[3];
    }
    const pair = pairOf(head, cond);
    if (pair) {
        const [a, b] = pair;
        // x \ge 0 for a vector x in the plane: both coordinates
        const vec = /^([A-Za-z])_1$/.exec(a);
        if (vec) cond = cond.replace(new RegExp(`(?<![A-Za-z\\\\])${vec[1]}\\s*(\\\\ge|\\\\geq|\\\\le|\\\\leq|>|<)\\s*0(?![0-9.])`, 'g'), `${a} $1 0, ${vec[1]}_2 $1 0`);
        if (!(a === 'x' && b === 'y')) cond = standInsXY(renameCoordinate(renameCoordinate(cond, a, '\uE000'), b, '\uE001'));
        return [{ tex: `\\{(x, y) \\mid ${cond}\\}` }];
    }
    return [{ tex: `\\{${head} \\mid ${cond}\\}` }];
}

/**
 * 6.2.1, round 3, S3: a set of pairs given by ONE equation is the curve of
 * that equation: its chart is the equation's, with the two coordinates as x
 * and y (\{(x, y) \mid x^2 + y^2 = 1\} is x^2 + y^2 = 1, \{(u, v) \mid u = 1\}
 * is x = 1). setCurve in features.ts reads the set the same way.
 */
function setCurveSpellings(tex: string): Spelling[] {
    const sb = setBuilderOf(tex);
    if (!sb) return [];
    const pair = pairOf(sb.head, sb.cond);
    if (!pair) return [];
    const cond = sb.cond.replace(/[.,;]\s*$/, '');
    // one equation: one = at the top level, no inequality, no list, no words
    const { pieces } = topSplit(cond, EQUALS);
    if (pieces.length !== 2 || /\\(?:le|ge|leq|geq|ne|neq|lt|gt|text)(?![A-Za-z])|[<>]/.test(cond) || topSplit(cond, /[,;]/y).pieces.length > 1) return [];
    const [a, b] = pair;
    let eq = cond;
    if (!(a === 'x' && b === 'y')) {
        // through a stand-in, so a coordinate named y does not meet the new y
        eq = standInsXY(renameCoordinate(renameCoordinate(eq, a, '\uE000'), b, '\uE001'));
    }
    return [{ tex: eq.trim() }];
}

/** An interval the card cannot read: after ≈ or =, named (I = [0, 1]), with ; between its ends, of a letter with a subscript, with ends that are no numbers. */
function intervalSpellings(tex: string): Spelling[] {
    let s = tex.replace(/^\s*(?:\\approx(?![A-Za-z])|=|\\Rightarrow(?![A-Za-z]))\s*/, '').replace(/;/g, ',');
    const named = /^\s*[A-Za-z](?:_\{?\w+\}?)?\s*=\s*([[(][\s\S]*[\])])\s*$/.exec(s);
    // 6.2.1, round 3 (S6): an interval after an image or a set operation (g(\mathbb{R}) = [0, \infty), A \cup B = [-2, 4]),
    // and the interval a set defines ([a, b] = \{x \in \mathbb{R} \mid a \le x \le b\})
    const image = /^[^=]*\S\s*=\s*([[(][^=]*[\])])\s*$/.exec(s);
    const defined = /^\s*([[(][^=]*?[\])])\s*=\s*\\\{/.exec(s);
    if (named) s = named[1];
    else if (defined) s = defined[1];
    else if (image) s = image[1];
    const out: Spelling[] = [{ tex: s }];
    const member = /^\s*(\\?[A-Za-z]+)(?:\s*_\s*\{?\w+\}?)?\s*\\in\s*([[(][\s\S]*[\])])\s*$/.exec(s);
    if (member) out.push({ tex: `x \\in ${member[2]}` });
    // 6.2.1: a pair of equal or reversed numbers alone, (1,1), is a point: no x in it.
    else if (/^\s*[[(][^,]+,[^,]+[\])]\s*$/.test(s) && !isEmptyPair(s)) out.push({ tex: `x \\in ${s.trim()}` });
    return out;
}

/** A condition with bars the card cannot read: \lvert, \rvert, \vert as |. */
function conditionSpellings(tex: string): Spelling[] {
    const s = tex.replace(/\\[lr]?vert(?![A-Za-z])/g, '|');
    return s !== tex ? [{ tex: s }] : [];
}

const WRITTEN = /^\\begin\s*\{\s*([pbB]?matrix)\s*\}[\s\S]*?\\end\s*\{\s*\1\s*\}$/;

/** A matrix with a head the card cannot read (\Sigma =, H_L =, A^{-1} =, A - 2I =): the written matrix alone. */
function matrixSpellings(tex: string): Spelling[] {
    return topSplit(tex, EQUALS)
        .pieces.map((p) => p.trim())
        .filter((p) => WRITTEN.test(p))
        .map((p) => ({ tex: p }));
}

/** A determinant of a written matrix (\det \begin{pmatrix} ... \end{pmatrix}, a vmatrix): the matrix (its card shows the same square and area). */
function detSpellings(tex: string): Spelling[] {
    const s = tex.replace(/\\(begin|end)\s*\{\s*vmatrix\s*\}/g, '\\$1{pmatrix}');
    const first = topSplit(s, EQUALS).pieces[0].trim();
    const m = /^(?:\\det\s*)?\(?\s*(\\begin\{pmatrix\}[\s\S]*?\\end\{pmatrix\})\s*\)?$/.exec(first);
    // 6.2.1: the area factor |\det A| (L5)
    const abs = /^\|\s*(\\det\s*\(?\s*[A-Z]\s*\)?)\s*\|$/.exec(first.replace(/\\[lr]?vert(?![A-Za-z])/g, '|'));
    return m ? [{ tex: m[1] }] : abs ? [{ tex: abs[1] }] : [];
}

/** 6.2.1: a vector's name without its arrow or bold, and without a subscript (\vec v_2 is v): the linear card reads one letter. */
const plainVector = (tex: string) =>
    tex
        .replace(/\\(?:vec|mathbf|boldsymbol|bm)\s*\{\s*([a-z])\s*\}/g, '$1')
        .replace(/\\(?:vec|mathbf|boldsymbol|bm)\s+([a-z])/g, '$1')
        .replace(/(?<![A-Za-z\\])([a-z])\s*_\s*(?:\{\s*\w+\s*\}|\w)/g, '$1');

/**
 * (A - \lambda I) v = 0 as A v = \lambda v; 6.2.1, round 3: also with a
 * number for λ ((A - 5I)v = 0), A v = 2 v, the chain of a numeric check
 * (A \vec v_2 = (3, 3)^\top = 3 \vec v_2) and a vector with an arrow.
 */
function eigenSpellings(texIn: string): Spelling[] {
    const tex = plainVector(texIn);
    const m = /^\s*\(\s*([A-Z])\s*-\s*(?:\\[a-z]+|[0-9.]+)(?:\s*_\s*\{?\w+\}?)?\s*I\s*\)\s*([a-z])\s*=\s*0\s*$/.exec(tex);
    if (m) return [{ tex: `${m[1]} ${m[2]} = \\lambda ${m[2]}` }];
    const sides = topSplit(tex, EQUALS).pieces.map((p) => p.trim());
    const left = /^([A-Z])\s*([a-z])$/.exec(sides[0]);
    const right = /^(?:-?\s*[0-9.]+|\\[a-z]+)\s*([a-z])$/.exec(sides[sides.length - 1]);
    return sides.length >= 2 && left && right && right[1] === left[2] ? [{ tex: `${left[1]} ${left[2]} = \\lambda ${left[2]}` }] : [];
}

/** 6.2.1, round 3: a matrix applied to a named vector as the card reads it (A v): A\vec v = ... with its result, G(\vec x) = A\vec x, \vec x \mapsto A\vec x. */
function productSpellings(texIn: string): Spelling[] {
    const tex = plainVector(texIn);
    const sides = topSplit(tex, EQUALS).pieces.map((p) => p.trim());
    const product = /^([A-Z])\s*(?:\\cdot\s*)?([a-z])$/;
    const out: Spelling[] = [];
    if (sides.length >= 2 && product.test(sides[0])) out.push({ tex: sides[0] });
    const last = sides[sides.length - 1].replace(/^[\s\S]*\\mapsto\s*/, '');
    if (product.test(last) && last !== tex.trim()) out.push({ tex: last });
    return out;
}

/** X_n = ... X_{n-1} ... as X_{n+1} = ... X_n ... (the card reads the step forward). */
function recurrenceSpellings(tex: string): Spelling[] {
    const hb = sides(tex);
    if (!hb) return [];
    const m = /^(\\?[A-Za-z]+)\s*_\s*\{?\s*([a-z])\s*\}?$/.exec(hb.head);
    if (!m) return [];
    const [, x, n] = m;
    const esc = x.replace(/\\/g, '\\\\');
    const prev = new RegExp(`${esc}\\s*_\\s*\\{\\s*${n}\\s*-\\s*1\\s*\\}`, 'g');
    const now = new RegExp(`${esc}\\s*_\\s*\\{?\\s*${n}\\s*\\}?(?![A-Za-z0-9+-])`);
    if (!prev.test(hb.body) || now.test(hb.body)) return [];
    return [{ tex: `${x}_{${n}+1} = ${hb.body.replace(prev, `${x}_${n}`)}` }];
}

/** A sum with a name (s_n = \sum ...): the sum alone. */
function sumSpellings(tex: string): Spelling[] {
    const hb = sides(tex);
    return hb && /^\\sum(?![A-Za-z])/.test(hb.body) ? [{ tex: hb.body }] : [];
}

/** A function of a complex variable the card cannot read: s as z (a transfer function), a formula alone as f(z) = ..., a head with a Greek name. */
function domainSpellings(tex: string): Spelling[] {
    let s = tex;
    if (!uses(s, 'z') && uses(s, 's')) s = rename(s, 's', 'z');
    const out: Spelling[] = s !== tex ? [{ tex: s }] : [];
    const hb = sides(s);
    if (!hb) out.push({ tex: `${freshName(s)}(z) = ${s}` });
    else if (callHead(hb.head)?.v === 'z') out.push({ tex: `${freshName(hb.body)}(z) = ${hb.body}` });
    return out;
}

/**
 * A Greek letter with a subscript (\omega_0) as the letter alone, when the
 * formula has no other \omega: the chart language reads no Greek letter
 * with a subscript, and the slider is then ω.
 */
function plainGreek(tex: string): string {
    const re = /\\(alpha|beta|gamma|delta|varepsilon|epsilon|zeta|eta|theta|kappa|lambda|mu|nu|xi|rho|sigma|tau|varphi|phi|chi|psi|omega)\s*_\s*(\{[^{}]*\}|[A-Za-z0-9])/g;
    const subs = new Map<string, Set<string>>();
    for (const m of tex.matchAll(re)) {
        const set = subs.get(m[1]) ?? new Set<string>();
        set.add(m[2].replace(/[{}\s]/g, ''));
        subs.set(m[1], set);
    }
    let out = tex;
    for (const [name, set] of subs) {
        if (set.size !== 1 || new RegExp(`\\\\${name}(?![A-Za-z_\\s]*_)(?![A-Za-z])`).test(tex.replace(re, ''))) continue;
        out = out.replace(new RegExp(`\\\\${name}\\s*_\\s*(?:\\{[^{}]*\\}|[A-Za-z0-9])`, 'g'), `\\${name}`);
    }
    return out;
}

/** Single letters that call a function before a bracket even when the note defines none: f, g and h, as notes name functions. */
const FUNCTION_LETTERS: ReadonlySet<string> = new Set(['f', 'g', 'h']);
/** A bracket of names alone, as a call writes its arguments: (x), (t), (K, L), (x_1, x_2), (\lambda). */
const ARGUMENTS = /^\s*(?:\\?[A-Za-z]+(?:\s*_\s*(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]))?\s*,\s*)*\\?[A-Za-z]+(?:\s*_\s*(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]))?\s*$/;

/** The bracket closing the one opened at `open` (tex[open] is "("), or -1. */
function closing(tex: string, open: number): number {
    let depth = 0;
    for (let i = open; i < tex.length; i++) {
        if (tex[i] === '(') depth++;
        else if (tex[i] === ')' && --depth === 0) return i;
    }
    return -1;
}

/**
 * 6.2.1: a single letter before a bracket that is no function of the note,
 * as a product: M(1 - y) is M \cdot (1 - y), a(x - 1) is a \cdot (x - 1).
 * A call stays a call: a name the note defines as a function (`functions`),
 * f, g and h, a built-in or a longer name (\sin, \max, exp), a bracket of
 * names alone (f(x), g(t), M(x), F(K, L)).
 */
export function productsOf(tex: string, functions: ReadonlySet<string> = new Set()): string {
    let out = '';
    let from = 0;
    for (const m of tex.matchAll(/(?<![\\A-Za-z_^])([A-Za-z])\s*\(/g)) {
        const at = m.index ?? 0;
        const letter = m[1];
        const open = at + m[0].length - 1;
        const close = closing(tex, open);
        if (close < 0 || functions.has(letter) || FUNCTION_LETTERS.has(letter) || ARGUMENTS.test(tex.slice(open + 1, close))) continue;
        out += `${tex.slice(from, at)}${letter} \\cdot (`;
        from = open + 1;
    }
    return from === 0 ? tex : out + tex.slice(from);
}

/** The labels whose card is a chart of src/formula.ts. */
const CHART_LABELS: ReadonlySet<Label> = new Set(['function', 'surface', 'polar', 'implicit', 'region']);

const OWN: Partial<Record<Label, (tex: string, domains?: ReadonlyMap<string, string>) => Spelling[]>> = {
    function: functionSpellings,
    surface: surfaceSpellings,
    polar: polarSpellings,
    set: setSpellings,
    map: mapSpellings,
    interval: intervalSpellings,
    condition: conditionSpellings,
    matrix: matrixSpellings,
    product: productSpellings,
    det: detSpellings,
    eigen: eigenSpellings,
    recurrence: recurrenceSpellings,
    sum: sumSpellings,
    domain: domainSpellings,
};

/** At most this many spellings per formula (each may cost a chart check). */
const MAX = 16;

/**
 * The spellings of a formula for the builder of the label's card, in the
 * order to try: the formula as written first, then plain spacing, then each
 * part and each shorter chain, each with the rewrites of the label's kind.
 * 6.2.1: for a chart, then each with a letter before a bracket as a product
 * (M(1 - y)), unless the note defines it as a function (`functions`); a
 * set of pairs with one equation as that equation (implicit, function);
 * `domains`, the sets the note names (noteDomains), for a map's domain.
 */
export function spellings(tex: string, label: Label, functions?: ReadonlySet<string>, domains?: ReadonlyMap<string, string>): Spelling[] {
    const out: Spelling[] = [];
    const add = (s: Spelling) => {
        if (out.length < MAX && s.tex.trim() && !out.some((o) => o.tex === s.tex && o.axis === s.axis)) out.push(s);
    };
    add({ tex });
    if (label === 'none') return out;
    const own = OWN[label];
    const pieces = [tex, ...partsOf(tex)].map(plainSpacing).filter((p) => p);
    for (const p of pieces) {
        const forms = [p, ...chainsOf(p)];
        for (const f of forms) add({ tex: f });
        if (own) for (const f of forms) for (const s of own(f, domains)) add(s);
        if (label === 'implicit' || label === 'function') for (const f of forms) for (const s of setCurveSpellings(f)) add(s);
    }
    if (CHART_LABELS.has(label)) {
        // 6.2.1: the formula as written too (-\alpha_1 \le x_1 + x_2 \le \alpha_1 has no other spelling).
        for (const s of out.slice()) add({ ...s, tex: plainGreek(s.tex) });
        for (const s of out.slice()) add({ ...s, tex: productsOf(s.tex, functions) });
    }
    return out;
}

/** 6.2.1: the functions a note defines (g(x) = ...), by the heads of its defining formulas: their calls are no products. */
export function definedFunctions(defs: readonly string[] | undefined): Set<string> {
    const out = new Set<string>();
    for (const d of defs ?? []) {
        const head = /^\s*\\?([A-Za-z][A-Za-z0-9_]*)\s*\(/.exec(d);
        if (head) out.add(head[1]);
    }
    return out;
}

/** Chart lines with the x-axis named after a letter (a function renamed into x): after the view, `xlabel t` or `xlabel $\eta$`. */
export function withAxis(lines: string[], axis: string | undefined): string[] {
    if (!axis || lines.some((l) => l.startsWith('xlabel '))) return lines;
    const label = /^[A-Za-z]$/.test(axis) ? `xlabel ${axis}` : `xlabel $${axis}$`;
    const at = lines.findIndex((l) => l.startsWith('show '));
    return at < 0 ? [label, ...lines] : [...lines.slice(0, at + 1), label, ...lines.slice(at + 1)];
}
