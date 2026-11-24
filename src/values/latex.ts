/*
 * 6.0 A: the LaTeX of values as the plain syntax, for latexToPlain
 * (src/latex.ts): matrices and vectors in pmatrix / bmatrix, lists from
 * sets (\{(k, k^2) : k = 1, \dots, 10\}) and where a sum's summand ends.
 * No imports, so src/latex.ts uses it without a cycle. Pure: no DOM, no
 * Obsidian.
 */

/** Matrix environments: their rows are vectors (one column) or matrices. */
export const MATRIX_ENVS = new Set(['pmatrix', 'bmatrix', 'Bmatrix', 'matrix', 'vmatrix', 'Vmatrix', 'smallmatrix', 'pmatrix*', 'bmatrix*']);

/** Commands that end the summand of a sum: relations, and the right half of \left ... \right. */
export const SUMMAND_ENDS = new Set(['le', 'leq', 'leqslant', 'ge', 'geq', 'geqslant', 'lt', 'gt', 'ne', 'neq', 'mid', 'right', 'quad', 'qquad', 'to', 'mapsto']);

/** Pieces of `src` split at `sep` (one character, or `\\`), outside braces, brackets and \left ... \right. */
function splitLatex(src: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '\\') {
            if (sep === '\\\\' && src[i + 1] === '\\' && depth === 0) {
                out.push(src.slice(start, i));
                start = i + 2;
            }
            i++;
            continue;
        }
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
        else if (depth === 0 && c === sep) {
            out.push(src.slice(start, i));
            start = i + 1;
        }
    }
    out.push(src.slice(start));
    return out;
}

/** `1 & 2 \\ 3 & 4` as [[1, 2], [3, 4]]; one column is a vector, (1, 2). */
export function matrixText(body: string, convert: (s: string) => string): string {
    const rows = splitLatex(body, '\\\\')
        .map((r) => splitLatex(r, '&').map((c) => convert(c)))
        .filter((r) => r.some((c) => c.trim()));
    if (!rows.length) return '()';
    if (rows.every((r) => r.length === 1)) return `(${rows.map((r) => r[0]).join(', ')})`;
    return `[${rows.map((r) => `[${r.join(', ')}]`).join(', ')}]`;
}

/** A piece of a list that only says "and so on": \dots, \ldots, \cdots, ... */
const DOTS = /^\s*(?:\\(?:dots|ldots|cdots|dotsc|dotsb)|\.\.\.)\s*$/;

/**
 * The inside of `\{ ... \}` as a list: `(k, k^2) : k = 1, \dots, 10` is
 * [(k, k^2) : k = 1..10] (also with \mid, and k \in \{1, \dots, 10\}),
 * `1, 2, 3` is [1, 2, 3]. Null when it is neither (the braces then group).
 */
export function setText(inner: string, convert: (s: string) => string): string | null {
    let at = -1;
    let len = 0;
    let depth = 0;
    for (let i = 0; i < inner.length && at < 0; i++) {
        const c = inner[i];
        if (c === '\\') {
            if (depth === 0 && /^\\mid(?![A-Za-z])/.test(inner.slice(i))) {
                at = i;
                len = 4;
            }
            i++;
            continue;
        }
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
        else if (depth === 0 && c === ':') {
            at = i;
            len = 1;
        }
    }
    if (at < 0) {
        const items = splitLatex(inner, ',');
        return items.length > 1 ? `[${items.map((p) => convert(p)).join(', ')}]` : null;
    }
    const body = inner.slice(0, at);
    const spec = /^\s*(\\[A-Za-z]+|[A-Za-z](?:_\{?[A-Za-z0-9]+\}?)?)\s*(?:=|\\in(?![A-Za-z]))\s*([\s\S]*)$/.exec(inner.slice(at + len));
    if (!spec) return null;
    const index = convert(spec[1]).replace(/[\s{}]+/g, '');
    let range = spec[2].trim();
    const braced = /^\\\{([\s\S]*)\\\}$/.exec(range);
    if (braced) range = braced[1];
    let items = splitLatex(range, ',').filter((p) => p.trim() && !DOTS.test(p));
    if (items.length === 1 && items[0].includes('..')) items = items[0].split('..');
    if (items.length < 2 || !/^[A-Za-z][A-Za-z0-9_]*$/.test(index)) return null;
    return `[(${convert(body)}) : ${index} = (${convert(items[0])})..(${convert(items[items.length - 1])})]`;
}
