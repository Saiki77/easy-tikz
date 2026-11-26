/*
 * The builders of the hover cards (6.2.2): a parse of src/readers/types.ts
 * and the note's definitions in, the card out. One builder per group of
 * kinds, each the card code of 6.2.1 reading named roles instead of TeX:
 *
 *   chart     function, surface, polar, implicit, region   src/formula.ts (chartLines, chartOfParse)
 *   notes6    set, map, condition, interval, jensen, epigraph   src/notes6/hover.ts (buildNotes6)
 *   linear    matrix, product, det, eigen   src/linear/hover.ts (buildLinear)
 *   iterate   recurrence, sum, domain   src/iterate/hover.ts (buildIterate)
 *   vector    vector   src/linear/vector.ts (buildVector)
 *
 * A card counts only when its chart lines parse (as the hover shows it).
 * Also here: parseKey, when two parses are the same; renameVariable, a
 * letter renamed as reader 0 renames it. Pure: no DOM, no Obsidian.
 */
import { FormulaKind, chartLines, chartOfParse, chartableParse, formulaKindOf } from '../formula';
import { parseChartText } from '../text/parse';
import { HoverCard, NoteDefinition, buildNotes6 } from '../notes6/hover';
import { LinearHoverCard, buildLinear } from '../linear/hover';
import { IterateHoverCard, buildIterate } from '../iterate/hover';
import { NoteVector, VectorHoverCard, buildVector } from '../linear/vector';
import type { CardKind, CardParse, ChartParse, IterateParse, LinearParse, Notes6Parse, VectorParse } from './types';

/** The builder a card kind belongs to. */
export type CardGroup = 'chart' | 'notes6' | 'linear' | 'iterate' | 'vector';

const GROUP: Record<CardKind, CardGroup> = {
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

/** The builder of a kind. */
export function groupOfKind(kind: CardKind): CardGroup {
    return GROUP[kind];
}

/** The card kinds, in the order of the network's labels. */
export const CARD_KINDS = Object.keys(GROUP) as CardKind[];

export const isChartParse = (p: CardParse): p is ChartParse => GROUP[p.kind] === 'chart';
export const isNotes6Parse = (p: CardParse): p is Notes6Parse => GROUP[p.kind] === 'notes6';
export const isLinearParse = (p: CardParse): p is LinearParse => GROUP[p.kind] === 'linear';
export const isIterateParse = (p: CardParse): p is IterateParse => GROUP[p.kind] === 'iterate';
export const isVectorParse = (p: CardParse): p is VectorParse => p.kind === 'vector';

const parses = (lines: string[]) => parseChartText(lines.join('\n')).problems.length === 0;

/** A chart of src/formula.ts: its kind, its lines with the view, and the formula's variable (a sequence's n). */
export interface ChartCard {
    kind: FormulaKind;
    lines: string[];
    axis?: string;
}

/** The chart card of a chart parse: it draws without an error and its lines parse; null otherwise. */
export function buildChartCard(p: ChartParse): ChartCard | null {
    if (!chartableParse(p)) return null;
    const found = chartLines(p);
    const lines = chartOfParse(p);
    if (!found || !lines) return null;
    return parses(lines) ? { kind: found.kind, lines, axis: found.axis } : null;
}

/** The card of a set, map, condition, interval, Jensen or epigraph parse, with the note's functions; null when its lines do not parse. */
export function buildNotes6Card(p: Notes6Parse, defs: ReadonlyMap<string, NoteDefinition>): HoverCard | null {
    const card = buildNotes6(p, defs);
    return card && parses(card.lines) && (!card.lines2 || parses(card.lines2)) ? card : null;
}

/** The card of a matrix, product, det or eigen parse, with the note's matrices and vectors; null when its lines do not parse. */
export function buildLinearCard(p: LinearParse, values: ReadonlyMap<string, string>): LinearHoverCard | null {
    const card = buildLinear(p, values);
    return card && parses(card.lines) ? card : null;
}

/** The card of a recurrence, sum or domain parse; null when its lines do not parse. */
export function buildIterateCard(p: IterateParse): IterateHoverCard | null {
    const card = buildIterate(p);
    return card && parses(card.lines) ? card : null;
}

/** The vector card of a vector parse, with the note's vectors; null when its lines do not parse. */
export function buildVectorCard(p: VectorParse, vectors: ReadonlyMap<string, NoteVector>): VectorHoverCard | null {
    const card = buildVector(p, vectors);
    return card && parses(card.lines) ? card : null;
}

/** What a note defines, for the builders (all optional). */
export interface NoteValues {
    /** Its functions (g(x) = x^2 - 4): noteDefinitions of src/notes6/hover.ts. */
    definitions?: ReadonlyMap<string, NoteDefinition>;
    /** Its matrices and vectors as LaTeX (A = \begin{pmatrix} ... \end{pmatrix}, v = (1, 2)): noteValues of src/linear/hover.ts. */
    values?: ReadonlyMap<string, string>;
    /** Its vectors for the vector card (\vec a = (1, 2, 3)): vectorValues of src/linear/vector.ts. */
    vectors?: ReadonlyMap<string, NoteVector>;
}

/** A card of any builder: the kind it shows, its chart lines (and the chart for n = 2 of a set or map in ℝⁿ). */
export interface BuiltCard {
    group: CardGroup;
    kind: CardKind;
    lines: string[];
    lines2?: string[];
}

/** A card's kind as a card kind: formulaLines' equation is implicit. */
export function cardKindOf(kind: string): CardKind {
    return (kind === 'equation' ? 'implicit' : kind) as CardKind;
}

/** The card of any parse, with the note's definitions; null when it does not build. */
export function buildCard(p: CardParse, note: NoteValues = {}): BuiltCard | null {
    const group = GROUP[p.kind];
    if (!group) return null;
    let card: { kind: string; lines: string[]; lines2?: string[] } | null = null;
    try {
        if (isChartParse(p)) card = buildChartCard(p);
        else if (isNotes6Parse(p)) card = buildNotes6Card(p, note.definitions ?? new Map());
        else if (isLinearParse(p)) card = buildLinearCard(p, note.values ?? new Map());
        else if (isIterateParse(p)) card = buildIterateCard(p);
        else if (isVectorParse(p)) card = buildVectorCard(p, note.vectors ?? new Map());
    } catch {
        card = null;
    }
    if (!card) return null;
    // det of a written matrix: the matrix card, named as a determinant.
    const kind = p.kind === 'det' ? 'det' : cardKindOf(card.kind);
    return { group, kind, lines: card.lines, ...(card.lines2 ? { lines2: card.lines2 } : {}) };
}

/** The chart kind of a chart parse as formulaLines names it (implicit is equation). */
export { formulaKindOf };

// ------------------------------------------------------------------ comparing parses

/** Strings of a parse that only label the card (a vector's TeX): parseKey leaves them out. */
const LABEL_ONLY = new Set(['tex', 'nameTex', 'names']);

/**
 * A TeX string as parseKey compares it: no spaces or spacing commands, no
 * sizes, \dfrac and \tfrac as \frac, \leq as \le, a decimal comma as a
 * point, one sign after ^ or _ without braces, \cdot between factors out
 * (2 \cdot x is 2x; not in a vector's values, where it is a dot product).
 */
export function texKey(s: string, keepCdot = false): string {
    let t = s
        .replace(/\\(?:left|right|middle|bigl?|bigr?|Bigl?|Bigr?|biggl?|biggr?|Biggl?|Biggr?)(?![A-Za-z])/g, '')
        .replace(/\\(?:displaystyle|textstyle)(?![A-Za-z])/g, '')
        .replace(/\\[dt]frac(?![A-Za-z])/g, '\\frac')
        .replace(/\\(le|ge|ne)q(?![A-Za-z])/g, '\\$1')
        .replace(/\\neq(?![A-Za-z])/g, '\\ne')
        .replace(/\{,\}/g, '.')
        .replace(/\\[,;:! ]|~/g, ' ');
    if (!keepCdot) t = t.replace(/\\cdot(?![A-Za-z])|\*/g, ' ');
    // A space ends a command name before a letter: keep it as a mark, drop the others.
    t = t.replace(/(\\[A-Za-z]+)\s+(?=[A-Za-z])/g, '$1\u0001').replace(/\s+/g, '').replace(/\u0001/g, ' ');
    return t.replace(/([\^_])\{(\\?[A-Za-z0-9])\}/g, '$1$2');
}

/** A canonical string of a parse: two parses with the same key build the same card (labels aside). */
export function parseKey(p: CardParse): string {
    const vector = p.kind === 'vector';
    const norm = (v: unknown, key?: string): unknown => {
        if (typeof v === 'string') return key === 'kind' ? v : texKey(v, vector);
        if (Array.isArray(v)) return v.map((x) => norm(x));
        if (v && typeof v === 'object') {
            const o = v as Record<string, unknown>;
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(o).sort()) {
                if (o[k] === undefined || (vector && LABEL_ONLY.has(k))) continue;
                out[k] = norm(o[k], k);
            }
            return out;
        }
        return v;
    };
    return JSON.stringify(norm(p));
}

/** Are two parses the same (parseKey)? */
export function sameParse(a: CardParse, b: CardParse): boolean {
    return parseKey(a) === parseKey(b);
}

/**
 * A letter renamed where it stands alone, as reader 0 renames a formula's
 * variable into the chart's x (never inside a command such as \sin, a longer
 * name, or a subscript): renameVariable('3t^2 + \sin t', 't', 'x') is
 * 3x^2 + \sin x.
 */
export function renameVariable(tex: string, letter: string, to: string): string {
    const esc = letter.replace(/\\/g, '\\\\');
    const re = letter.startsWith('\\') ? new RegExp(`${esc}(?![A-Za-z])`, 'g') : new RegExp(`(?<![\\\\A-Za-z_]|_\\{)${esc}(?![A-Za-z])`, 'g');
    return tex.replace(re, to);
}
