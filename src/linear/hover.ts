/*
 * 6.0 D: hover cards of linear algebra (src/ui/formulaHover.ts shows them).
 *
 *   matrix     \begin{pmatrix} 2 & 1 \\ 0 & 1 \end{pmatrix}, A = ...   its transform, with a slider s from 0 to 1
 *   product    A v, A\vec{v}                                           v and A v, the grid moving with s
 *   det        \det A, \det(A)                                         the unit square and its area
 *   eigen      A v = \lambda v                                         the eigenvectors of A, the grid moving with s
 *
 * A matrix or vector the formula names without writing it (A, v) comes
 * from the other formulas of the note (`A = \begin{pmatrix} ... \end{pmatrix}`,
 * `v = (1, 2)`); without one, the card uses an example and says so. The
 * slider s moves the grid from I (s = 0) to A (s = 1): (1 - s)I + sA.
 * Pure: no DOM, no Obsidian.
 */

export type LinearHoverKind = 'matrix' | 'product' | 'det' | 'eigen';

export interface LinearHoverCard {
    kind: LinearHoverKind;
    /** The chart, in chart lines. */
    lines: string[];
    /** The matrix's name the card uses (A). */
    name: string;
    /** A name the note does not define: the card uses an example. */
    example: boolean;
}

const MATRIX = /\\begin\s*\{\s*([pbvB]?matrix)\s*\}([\s\S]*?)\\end\s*\{\s*\1\s*\}/;
const EXAMPLE_MATRIX = '\\begin{pmatrix} 2 & 1 \\\\ 1 & 2 \\end{pmatrix}';
const EXAMPLE_VECTOR = '\\begin{pmatrix} 1 \\\\ 0.5 \\end{pmatrix}';
const IDENTITY: Record<2 | 3, string> = {
    2: '\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}',
    3: '\\begin{pmatrix} 1 & 0 & 0 \\\\ 0 & 1 & 0 \\\\ 0 & 0 & 1 \\end{pmatrix}',
};
/** The slider of the cards: s, not t (t is an axis variable). */
const S = 's';

/** Spacing and sizes out, \vec{v} and \mathbf{v} as v. */
function normalize(tex: string): string {
    return tex
        .replace(/\\(?:left|right|bigl?|bigr?|Bigl?|Bigr?)(?![A-Za-z])/g, '')
        .replace(/\\(?:displaystyle|textstyle|quad|qquad)(?![A-Za-z])|(?<!\\)\\[,;!: ]/g, ' ')
        .replace(/\\(?:vec|mathbf|boldsymbol|bm|overrightarrow)\s*\{\s*([A-Za-z])\s*\}/g, '$1')
        .replace(/\\(?:vec|mathbf)\s+([A-Za-z])/g, '$1')
        .replace(/[.,;]\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** The rows and columns of a written matrix (null when it is not a square 2 x 2 or 3 x 3 of entries, or a column). */
function shapeOfMatrix(body: string): { rows: number; cols: number } | null {
    const rows = body
        .split(/\\\\/)
        .map((r) => r.trim())
        .filter((r) => r);
    if (!rows.length) return null;
    const cols = rows.map((r) => r.split('&').length);
    if (cols.some((c) => c !== cols[0])) return null;
    return { rows: rows.length, cols: cols[0] };
}

interface Parsed {
    kind: LinearHoverKind;
    /** The matrix's name (A), and the written matrix when the formula holds it. */
    name: string;
    matrix?: string;
    /** The vector's name (product). */
    vector?: string;
}

function parse(texIn: string): Parsed | null {
    const tex = normalize(texIn);
    if (!tex) return null;
    const m = MATRIX.exec(tex);
    if (m) {
        const whole = /^(?:([A-Z])\s*(?::=|=)\s*)?\\begin\s*\{\s*([pbvB]?matrix)\s*\}[\s\S]*?\\end\s*\{\s*\2\s*\}$/.exec(tex);
        const shape = shapeOfMatrix(m[2]);
        if (!whole || !shape || shape.rows !== shape.cols || (shape.rows !== 2 && shape.rows !== 3) || m[1] === 'vmatrix') return null;
        return { kind: 'matrix', name: whole[1] ?? 'A', matrix: m[0] };
    }
    const det = /^\\det\s*\(?\s*([A-Z])\s*\)?$/.exec(tex);
    if (det) return { kind: 'det', name: det[1] };
    const eig = /^([A-Z])\s*([a-z])\s*=\s*\\lambda\s*\2$/.exec(tex);
    if (eig) return { kind: 'eigen', name: eig[1], vector: eig[2] };
    const product = /^([A-Z])\s*(?:\\cdot\s*)?([a-z])$/.exec(tex);
    if (product) return { kind: 'product', name: product[1], vector: product[2] };
    return null;
}

/** Is this a formula with a card of this part? */
export function linearHoverKind(tex: string): LinearHoverKind | null {
    try {
        return parse(tex)?.kind ?? null;
    } catch {
        return null;
    }
}

/** The matrices and vectors the note's formulas define: name to LaTeX (`A = \begin{pmatrix} ... \end{pmatrix}`, `v = (1, 2)`). */
export function noteValues(formulas: string[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const f of formulas) {
        const tex = normalize(f);
        const def = /^([A-Za-z])\s*(?:=|:=)\s*([\s\S]+)$/.exec(tex);
        if (!def || out.has(def[1])) continue;
        const value = def[2].trim();
        const m = MATRIX.exec(value);
        if (m && m.index === 0 && m[0].length === value.length && m[1] !== 'vmatrix') out.set(def[1], value);
        else if (/^\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*(?:,\s*-?[\d.]+\s*)?\)$/.test(value)) out.set(def[1], value);
    }
    return out;
}

/** The size of a written matrix (2 or 3), 2 for anything else. */
function dimOf(matrix: string): 2 | 3 {
    const m = MATRIX.exec(matrix);
    const shape = m ? shapeOfMatrix(m[2]) : null;
    return shape && shape.rows === 3 ? 3 : 2;
}

/** The chart of a formula of this part, with the note's matrices and vectors; null when it has none. */
export function linearHoverCard(tex: string, defs: Map<string, string>): LinearHoverCard | null {
    let p: Parsed | null;
    try {
        p = parse(tex);
    } catch {
        p = null;
    }
    if (!p) return null;
    // A name that is the slider's: the card calls it A.
    const name = p.name === S ? 'A' : p.name;
    let example = false;
    let matrix = p.matrix ?? defs.get(p.name);
    if (!matrix || !MATRIX.test(matrix)) {
        matrix = p.kind === 'det' || p.kind === 'matrix' ? EXAMPLE_MATRIX : EXAMPLE_MATRIX;
        example = !p.matrix;
    }
    const dim = dimOf(matrix);
    if (dim === 3 && (p.kind === 'product' || p.kind === 'eigen')) return null;
    const slider = `slider ${S} from 0 to 1, starting at 1, in steps of 0.01`;
    const moving = `transform ${dim === 3 ? 'space' : 'the plane'} by $(1 - ${S}) \\cdot ${IDENTITY[dim]} + ${S} ${name}$`;
    const head =
        dim === 3
            ? ['3d', 'show x from -3 to 3 and y from -3 to 3 and z from -3 to 3', slider, `let $${name} = ${matrix}$`]
            : ['show x from -4 to 4 and y from -3 to 3', 'equal scale', slider, `let $${name} = ${matrix}$`];
    const card = (lines: string[]): LinearHoverCard => ({ kind: p ? p.kind : 'matrix', lines: [...head, ...lines], name, example });
    switch (p.kind) {
        case 'matrix':
        case 'det':
            return card(['draw the grid' + (dim === 3 ? ' from -1 to 1' : ''), 'draw the basis vectors', `shade the unit ${dim === 3 ? 'cube' : 'square'}, labelled`, moving]);
        case 'eigen':
            return card(['draw the grid', 'draw the basis vectors', moving, `draw the eigenvectors of ${name}, labelled`]);
        case 'product': {
            const v = p.vector && p.vector !== S && p.vector !== name ? p.vector : 'v';
            let vector = p.vector ? defs.get(p.vector) : undefined;
            if (!vector) {
                vector = EXAMPLE_VECTOR;
                example = true;
            }
            return {
                ...card(['draw the grid', moving, `draw ${v} as an arrow in blue, labelled`, `draw $(1 - ${S}) ${v} + ${S} ${name} ${v}$ as an arrow in red, labelled "$${name}\\vec{${v}}$"`]),
                lines: [...head, `let $${v} = ${vector}$`, 'draw the grid', moving, `draw ${v} as an arrow in blue, labelled`, `draw $(1 - ${S}) ${v} + ${S} ${name} ${v}$ as an arrow in red, labelled "$${name}\\vec{${v}}$"`],
                example,
            };
        }
    }
}
