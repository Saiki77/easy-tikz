/*
 * 6.2.4: products and eigen equations that write their vector (or their
 * matrix), for the cards of src/linear/hover.ts:
 *
 *   A (1, 1)^\top = (3, 3)^\top        S\,(1, 0)^T = (1, 0)^T        R(90°)\,(2, 1)^\top = (-1, 2)^\top
 *   P \begin{pmatrix} 1 \\ -5 \end{pmatrix} = 0.4 \begin{pmatrix} 1 \\ -5 \end{pmatrix}
 *   \begin{pmatrix} 3 & 1 \\ 0 & 2 \end{pmatrix}(1,-1)^\top = 2 (1, -1)^\top
 *   \tfrac12 \begin{pmatrix} 1 & 1 \\ 1 & 1 \end{pmatrix}\begin{pmatrix} 3 \\ 1 \end{pmatrix}
 *   \vec x \mapsto \begin{pmatrix} 2 & 0 \\ 0 & 3 \end{pmatrix} \vec x
 *
 * One side of the formula (cut at =, \approx, \mapsto) is a matrix applied
 * to a vector: the matrix by its name (a capital, maybe with a subscript or
 * an argument: R(90°), H_x(2)) or written (2 x 2, maybe with a number
 * before it), the vector written ((1, 1)^\top, a column) or, after a written
 * matrix or a matrix with an argument, by its name. Two matrices in a row
 * (A B v) and vectors of unknown size (\mathbf{1}) give none. The sides
 * that write more come first. The network chose product or eigen; the
 * parse is of that kind (an eigen card draws the matrix's eigenvectors).
 * Smart reads these after the vote and before reader 0. Pure: no DOM, no Obsidian.
 */
import type { CardKind, CardParse, Tex } from './types';

/** The formula with one spelling per sign: Unicode, spacing and sizes out, every transposition as ^\top. */
function plain(tex: string): string {
    return tex
        .replace(/[·⋅]/g, ' \\cdot ')
        .replace(/[−–]/g, '-')
        .replace(/°/g, '^\\circ ')
        .replace(/\\(?:left|right|bigl?|bigr?|Bigl?|Bigr?|displaystyle|textstyle)(?![A-Za-z])/g, ' ')
        .replace(/(?<!\\)\\[,;:! ]|~/g, ' ')
        .replace(/\{,\}/g, '.')
        .replace(/\^\s*(?:\{\s*(?:T|\\top|\\intercal|\\mathsf\s*\{?\s*T\s*\}?|\\mathrm\s*\{?\s*T\s*\}?)\s*\}|T(?![A-Za-z])|\\top(?![A-Za-z])|\\intercal(?![A-Za-z])|\\mathsf\s*\{\s*T\s*\})/g, '^\\top ')
        .replace(/[.,;]\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Split at the top level (outside brackets and environments) where re matches at the start of the rest. */
function topSplit(s: string, re: RegExp): string[] {
    const out: string[] = [];
    let d = 0;
    let from = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') {
            if (/^\\begin(?![A-Za-z])/.test(s.slice(i, i + 6))) d++;
            else if (/^\\end(?![A-Za-z])/.test(s.slice(i, i + 4))) d = Math.max(0, d - 1);
            else if (s[i + 1] === '{') d++;
            else if (s[i + 1] === '}') d = Math.max(0, d - 1);
            else if (d === 0) {
                const m = re.exec(s.slice(i));
                if (m && m.index === 0) {
                    out.push(s.slice(from, i).trim());
                    i += m[0].length - 1;
                    from = i + 1;
                    continue;
                }
            }
            if (s[i + 1] === '{' || s[i + 1] === '}') i++;
            continue;
        }
        if (c === '(' || c === '[' || c === '{') d++;
        else if (c === ')' || c === ']' || c === '}') d = Math.max(0, d - 1);
        else if (d === 0) {
            const m = re.exec(s.slice(i));
            if (m && m.index === 0) {
                out.push(s.slice(from, i).trim());
                i += m[0].length - 1;
                from = i + 1;
            }
        }
    }
    out.push(s.slice(from).trim());
    return out;
}

/** An entry or a component: no relation, no word, not empty. */
const ENTRY = (c: string) => !!c && !/=|<|>|\\(?:le|ge|ne|text|in|to|mapsto)(?![A-Za-z])|\\begin/.test(c);

/** The rows of a written matrix environment's body. */
function rowsOf(body: string): string[][] {
    return body
        .split(/\\\\/)
        .map((r) => r.trim())
        .filter((r) => r)
        .map((r) => r.split('&').map((c) => c.trim()));
}

/** A written matrix environment; its name is group `n` of the whole pattern, its body group n + 1. */
const env = (n: number) => String.raw`\\begin\s*\{\s*([pbB]?matrix)\s*\}([\s\S]*?)\\end\s*\{\s*` + `\\${n}` + String.raw`\s*\}`;
/** A number before a written matrix: 2, 0.5, -1, \tfrac12, \frac{1}{2}. */
const FACTOR = String.raw`(-?\d+(?:\.\d+)?|-?\\[dt]?frac\s*(?:\{\s*\d+\s*\}|\d)\s*(?:\{\s*\d+\s*\}|\d))`;
const NAME = String.raw`(?:([A-Z])|\\mathbf\s*\{\s*([A-Z])\s*\})(_\s*(?:\{[^{}]*\}|[A-Za-z0-9]))?(\([^()]*\))?`;

/** A matrix at the start of a side: its name or its entries, and the rest of the side. */
interface MatrixAt {
    name?: string;
    entries?: Tex[][];
    /** Written, or a name with a subscript or an argument (R(90°), H_x). */
    argued: boolean;
    rest: string;
}

/** The ways a side can start with a matrix: written, or a name with or without its bracket (S(1, 1)^\top is S applied to (1, 1)). */
function matricesAt(side: string): MatrixAt[] {
    const w = new RegExp(String.raw`^(?:${FACTOR}\s*(?:\\cdot\s*)?)?${env(2)}`).exec(side);
    if (w) {
        const rows = rowsOf(w[3]);
        if (rows.length !== 2 || rows.some((r) => r.length !== 2 || !r.every(ENTRY))) return [];
        const f = w[1];
        const entries = f ? rows.map((r) => r.map((c) => (/^-?\d+(?:\.\d+)?$/.test(c) ? `${f} \\cdot ${c}` : `${f} \\cdot (${c})`))) : rows;
        return [{ entries, argued: true, rest: side.slice(w[0].length) }];
    }
    const n = new RegExp(`^${NAME}`).exec(side);
    if (!n) return [];
    const name = n[1] ?? n[2];
    const out: MatrixAt[] = [{ name, argued: !!(n[3] || n[4]), rest: side.slice(n[0].length) }];
    // the bracket after the name may be the vector itself
    if (n[4]) out.push({ name, argued: !!n[3], rest: side.slice(n[0].length - n[4].length) });
    return out;
}

/** The vector that is the whole rest of a side: its components, or its name; null when none. */
function vectorAt(rest0: string, named: boolean): { components?: Tex[]; name?: string } | null {
    const rest = rest0.replace(/^\s*(?:\\cdot\s*)?/, '').trim();
    const t = /^\(([^()]*)\)\s*\^\\top$/.exec(rest);
    const col = new RegExp(`^${env(1)}$`).exec(rest);
    let comps: string[] | null = null;
    if (t) comps = t[1].split(/[,;]/).map((c) => c.trim());
    else if (col) {
        const rows = rowsOf(col[2]);
        if (rows.every((r) => r.length === 1)) comps = rows.map((r) => r[0]);
    }
    if (comps) return comps.length >= 2 && comps.length <= 3 && comps.every(ENTRY) ? { components: comps } : null;
    if (!named) return null;
    const v = /^(?:\\vec\s*\{?\s*([a-z])\s*\}?|\\mathbf\s*\{\s*([a-z])\s*\}|([a-z]))$/.exec(rest);
    return v ? { name: v[1] ?? v[2] ?? v[3] } : null;
}

/** The parses of a product or an eigen equation that writes its vector or its matrix (any other kind: none). */
export function writtenLinear(tex: string, kind: CardKind): CardParse[] {
    if (kind !== 'product' && kind !== 'eigen') return [];
    let s: string;
    try {
        s = plain(tex);
    } catch {
        return [];
    }
    const part = topSplit(s, /^\\q?quad(?![A-Za-z])/)[0].replace(/[,;]\s*$/, '');
    const found: Array<{ p: CardParse; written: number }> = [];
    for (const side of topSplit(part, /^(?:=|\\approx(?![A-Za-z])|\\mapsto(?![A-Za-z]))/)) {
        for (const m of matricesAt(side)) {
            // a vector by its name only after a written matrix or a matrix with an argument (A v is reader 0's and the vote's)
            const v = vectorAt(m.rest, m.argued);
            if (!v) continue;
            const matrix = m.entries ? { entries: m.entries } : { matrix: m.name };
            const vector = v.components ? { components: v.components } : { vector: v.name };
            found.push({ p: { kind, ...matrix, ...vector }, written: (m.entries ? 1 : 0) + (v.components ? 1 : 0) });
            break;
        }
    }
    return found.sort((a, b) => b.written - a.written).map((f) => f.p);
}
