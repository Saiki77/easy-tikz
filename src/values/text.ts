/*
 * 6.0 A: the lines of values in the chart language, read and written:
 *
 *   let v = (2, 1)                          a value (a tool of type 'value')
 *   let f(x, y) = x^2 + 4y^2                a function of one or more variables
 *   draw v as an arrow                      vector arrows (type 'vector')
 *   draw v and w as arrows, labelled
 *   draw v from (1, 1)
 *   draw v + w tip to tail
 *   mark the points $\{...\}$, joined       points of a list (type 'listPoints')
 *   mark the points of S
 *
 * and their Full LaTeX: \let{v = (2, 1)}, \draw[vector, from={(1, 1)}]{v, w},
 * \draw[vector, tip to tail]{v + w}, \mark[list, joined]{S}. The parser
 * (src/text/parse.ts) and the printer (src/text/print.ts) call these.
 * Pure: no DOM, no Obsidian.
 */
import { splitTop } from '../text/parse';
import { looksLikeLatex } from '../latex';

type Data = Record<string, unknown>;

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A let line's parts: `f(x, y) = x^2` is f, [x, y], x^2; columns are 0-based in `text`. */
export interface LetParts {
    name: string;
    params: string[];
    expression: string;
    nameAt: number;
    exprAt: number;
    /** Options after the formula (`, hidden`), with their columns. */
    options: Array<{ text: string; at: number }>;
}

/** The first `=` of `s` that is no part of ==, <=, >=, != (outside brackets), or -1. */
function equalsAt(s: string): number {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
        else if (c === '=' && depth === 0 && !/[=<>!]/.test(s[i - 1] ?? '') && s[i + 1] !== '=') return i;
    }
    return -1;
}

/**
 * What follows `let ` (from column `at`): the name, the parameters and the
 * formula, and the options after a top-level comma that `isOption` takes
 * (the printer writes `hidden` there). Null when it is no definition.
 */
export function readLet(text: string, at: number, isOption: (o: string) => boolean): LetParts | null {
    const eq = equalsAt(text);
    if (eq < 0) return null;
    const head = text.slice(0, eq);
    const m = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\(\s*([^()]*?)\s*\))?\s*$/.exec(head);
    if (!m) return null;
    const params = m[2] === undefined ? [] : m[2].split(',').map((p) => p.trim().replace(/^\\/, ''));
    if (m[2] !== undefined && params.some((p) => !NAME.test(p))) return null;
    const rest = text.slice(eq + 1);
    const pieces = splitTop(rest, ',', at + eq + 1);
    let last = pieces.length;
    while (last > 1 && isOption(pieces[last - 1].text)) last--;
    const options = pieces.slice(last).map((p) => ({ text: p.text, at: p.at }));
    const exprEnd = last < pieces.length ? pieces[last].at - (at + eq + 1) : rest.length;
    const exprRaw = rest.slice(0, exprEnd).replace(/\s*,\s*$/, '');
    const expression = exprRaw.trim();
    const lead = exprRaw.length - exprRaw.trimStart().length;
    return { name: m[1], params, expression, nameAt: at + head.indexOf(m[1]), exprAt: at + eq + 1 + lead, options };
}

/** The let line of a value tool (null when no line form fits it). */
export function letHead(full: Data): string | null {
    const name = typeof full.name === 'string' ? full.name : '';
    const params = typeof full.params === 'string' ? full.params.trim() : '';
    const expr = typeof full.expression === 'string' ? full.expression.trim() : '';
    if (!NAME.test(name) || !expr || /[\r\n]/.test(expr)) return null;
    const list = params ? params.split(',').map((p) => p.trim()) : [];
    if (list.some((p) => !NAME.test(p))) return null;
    const body = `${name}${list.length ? `(${list.join(', ')})` : ''} = ${expr}`;
    return `let ${looksLikeLatex(expr) || expr.includes('|') ? `$${body}$` : body}`;
}

// ------------------------------------------------------------ vector arrows

/** The vectors of a draw line: `v and w as arrows from P`, `v from (1, 1)`, `v + w tip to tail`. */
export interface VectorParts {
    vectors: string[];
    from: string;
    tipToTail: boolean;
}

/** A start point: a bracketed point or a name. */
const pointLike = (p: string) => /^\(.*\)$/.test(p.trim()) || NAME.test(p.trim());

/** Split `v and w` (and `u, v and w` inside one piece) into the vectors. */
function vectorList(s: string): string[] {
    return splitTop(s, ' and ')
        .flatMap((p) => splitTop(p.text, ';'))
        .map((p) => p.text.trim())
        .filter((p) => p);
}

/**
 * The vector arrows a `draw` line asks for (what follows `draw`), or null:
 * `X as an arrow`, `X and Y as arrows`, either `... from P`, `X from P`
 * (when X is one of `lets` or reads one), `X tip to tail`, and `X` alone
 * when X is a let name.
 */
export function readVectors(rest: string, lets: ReadonlySet<string>): VectorParts | null {
    const t = rest.trim();
    let m = /^([\s\S]+?)\s+tip\s+to\s+tail$/i.exec(t);
    if (m) return { vectors: [m[1].trim()], from: '', tipToTail: true };
    m = /^([\s\S]+?)\s+as\s+(?:an?\s+)?arrows?(?:\s+from\s+([\s\S]+))?$/i.exec(t);
    if (m) {
        const from = (m[2] ?? '').trim();
        if (from && !pointLike(from)) return null;
        const vectors = vectorList(m[1]);
        return vectors.length ? { vectors, from, tipToTail: false } : null;
    }
    const readsLet = (s: string) => (s.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []).some((w) => lets.has(w));
    m = /^([\s\S]+?)\s+from\s+([\s\S]+)$/i.exec(t);
    if (m && pointLike(m[2]) && !/[=<>]/.test(m[1]) && readsLet(m[1])) {
        const vectors = vectorList(m[1]);
        return vectors.length ? { vectors, from: m[2].trim(), tipToTail: false } : null;
    }
    if (NAME.test(t) && lets.has(t)) return { vectors: [t], from: '', tipToTail: false };
    return null;
}

/** One vector as the line writes it: LaTeX in $...$. */
const vectorText = (v: string) => (looksLikeLatex(v) ? `$${v}$` : v);

/** The draw line of a vector tool (null when no line form fits it). */
export function vectorHead(full: Data): string | null {
    const vectors = (typeof full.vectors === 'string' ? full.vectors : '')
        .split(';')
        .map((v) => v.trim())
        .filter((v) => v);
    const from = typeof full.from === 'string' ? full.from.trim() : '';
    if (!vectors.length || vectors.some((v) => /[\r\n"]/.test(v) || splitTop(v, ' and ').length > 1 || splitTop(v, ',').length > 1)) return null;
    if (from && (!pointLike(from) || splitTop(from, ' and ').length > 1)) return null;
    if (full.tipToTail === true) {
        if (vectors.length !== 1 || from) return null;
        return `draw ${vectorText(vectors[0])} tip to tail`;
    }
    const list = vectors.map(vectorText);
    const names = list.length > 1 ? `${list.slice(0, -1).join(' and ')} and ${list[list.length - 1]}` : list[0];
    if (from) return list.length > 1 ? `draw ${names} as arrows from ${from}` : `draw ${names} as an arrow from ${from}`;
    return list.length > 1 ? `draw ${names} as arrows` : `draw ${names} as an arrow`;
}

// ------------------------------------------------------------ points of a list

/**
 * The list of a `mark the points ...` line (what follows `mark the`), or
 * null: `points of X` (any formula), `points \{...\}` or `points [...]`,
 * and `points S` for a let name S.
 */
export function readListPoints(rest: string, lets: ReadonlySet<string>): string | null {
    const m = /^points?\s+([\s\S]+)$/i.exec(rest.trim());
    if (!m) return null;
    const of = /^of\s+([\s\S]+)$/i.exec(m[1].trim());
    if (of) return of[1].trim();
    const t = m[1].trim();
    if (t.startsWith('\\{') || t.startsWith('[')) return t;
    if (NAME.test(t) && lets.has(t)) return t;
    return null;
}

/** The mark line of a list-points tool (null when no line form fits it). */
export function listPointsHead(full: Data): string | null {
    const points = typeof full.points === 'string' ? full.points.trim() : '';
    if (!points || /[\r\n"]/.test(points)) return null;
    const direct = points.startsWith('\\{') || points.startsWith('[');
    return `mark the points ${direct ? '' : 'of '}${vectorText(points)}`;
}

// ------------------------------------------------------------ Full LaTeX

/** `draw ...` in words as \draw[vector, ...]{v, w}: the flags and the argument, or null. */
export function vectorFull(rest: string, lets: ReadonlySet<string>): { flags: string[]; arg: string } | null {
    const v = readVectors(rest, lets);
    if (!v) return null;
    const flags = ['vector'];
    if (v.tipToTail) flags.push('tip to tail');
    if (v.from) flags.push(`from={${v.from}}`);
    return { flags, arg: v.vectors.join(', ') };
}

/** \draw[vector, ...]{v, w} in words: the line without its options. */
export function vectorWords(arg: string, from: string, tipToTail: boolean): string {
    const vectors = splitTop(arg, ',')
        .map((p) => p.text)
        .filter((p) => p);
    return vectorHead({ vectors: vectors.join('; '), from, tipToTail }) ?? `draw ${arg} as arrows`;
}
