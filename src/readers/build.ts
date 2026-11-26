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
 * Also here: parseKey, when two parses are the same; inVariables, a
 * letter renamed as reader 0 renames it. Pure: no DOM, no Obsidian.
 */
import { FormulaKind, chartLines, chartOfParse, chartableParse, formulaKindOf, inVariables } from '../formula';
import { parseChartText } from '../text/parse';
import { latexToPlain } from '../latex';
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
 * A TeX string as parseKey compares it: as the chart reads it (latexToPlain:
 * \frac{1}{2} and \tfrac12 alike, | z | and \lvert z \rvert alike, \big( and (
 * alike), without
 * spaces, and 2 \cdot x as 2x (not in a vector's values, where \cdot is a
 * dot product). Words the chart does not know stay (x^2 \nonumber is not
 * x^2: the chart would read nonumber as a name).
 */
export function texKey(s: string, keepCdot = false): string {
    let t: string;
    // Spacing (~, \,, \quad) and an alignment & are layout only. 6.2.4: so are the sizes \big, \Big, \bigg, \Bigg (with l, r or m): the
    // chart would read \alpha\big as alpha big.
    const plain = s
        .replace(/\\(?:big|Big|bigg|Bigg)[lrm]?(?![A-Za-z])/g, ' ')
        .replace(/\\[dt]frac(?![A-Za-z])/g, '\\frac')
        .replace(/\{,\}/g, '.')
        .replace(/\\(?:q?quad|displaystyle|textstyle)(?![A-Za-z])|\\[,;:! ]|~|(?<!\\)&/g, ' ');
    try {
        t = latexToPlain(plain);
    } catch {
        t = s;
    }
    if (!keepCdot) t = t.replace(/\*/g, ' ');
    return t.replace(/\s+/g, '');
}

/** A canonical string of a parse: two parses with the same key build the same card (labels aside). */
export function parseKey(p: CardParse): string {
    const vector = p.kind === 'vector';
    // A function's own name only names its graph (f or MC): left out too.
    const label = (k: string, parent?: string) => (vector && LABEL_ONLY.has(k)) || (parent === 'functions' && k === 'name');
    const norm = (v: unknown, key?: string, parent?: string): unknown => {
        if (typeof v === 'string') return key === 'kind' ? v : texKey(v, vector);
        if (Array.isArray(v)) return v.map((x) => norm(x, undefined, key));
        if (v && typeof v === 'object') {
            const o = v as Record<string, unknown>;
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(o).sort()) {
                if (o[k] === undefined || label(k, parent)) continue;
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
 * A chart body's variables renamed as the chart builder renames them
 * (src/formula.ts): inVariables('3t^2 + \sin t', 't', 'y', 'x', 'y') is
 * 3x^2 + \sin x; a letter where it stands alone (never inside a command
 * such as \sin, a longer name, or a subscript: x_0 stays), x_1 and x_2 as x
 * and y.
 */
export { inVariables };
