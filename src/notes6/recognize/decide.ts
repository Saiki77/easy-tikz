/*
 * Formula recognition (6.2): which card a formula of a note opens, and
 * whether it carries the dotted mark, for the two settings of Formula
 * recognition (src/ui/formulaHover.ts asks these).
 *
 *   Rules   exactly 6.1: the first builder that takes the formula, in the
 *           order chart (src/formula.ts), iterate, notes6, linear.
 *   Smart   the network (index.ts) decides. none: no card and no mark. A
 *           card kind: the builder of that kind, on the parses a reader
 *           gives for that kind (src/readers: reader 0, the regex readers of
 *           6.2.1 on the formula and its spellings, adapt.ts). If that
 *           builder builds nothing, the formula falls back to Rules: so it
 *           gets a card only when the network and the rules both say "a
 *           card", and then the card the rules open. Otherwise no card.
 *
 * 6.2.1: the card is of the network's kind whenever the builder builds one
 * of that kind for the formula or a spelling of it (a = x \cdot y labelled
 * surface is the surface z = x y, not the curve the formula as written
 * draws). Only when it builds none of that kind may the kind differ within
 * the same builder (formulaLines draws f(x) = ... in x and y as a surface):
 * the builder's kind shows. 6.2.1, round 3: the label vector has its own
 * card (src/linear/vector.ts), with the vectors of the whole note; Rules
 * has no vector card (as 6.1). 6.2.2: the readers are pluggable (a Reader
 * of src/readers/types.ts, the last argument; reader 0 by default), and
 * smartCard gives the card of any kind with the parse it came from (for
 * scripts/readers/gap.mjs). Pure: no DOM, no Obsidian.
 */
import { chartable, formulaChart, formulaLines } from '../../formula';
import { parseChartText } from '../../text/parse';
import { HoverCard, NoteDefinition, hoverKind } from '../hover';
import { LinearHoverCard, linearHoverKind } from '../../linear/hover';
import { IterateHoverCard, buildIterate, iterateHoverKind } from '../../iterate/hover';
import { NoteVector, VectorHoverCard, buildVector } from '../../linear/vector';
import { chartableParse } from '../../formula';
import { Label } from './net';
import { groupOf, withAxis } from './adapt';
import { reader0 } from '../../readers/reader0';
import {
    BuiltCard,
    ChartCard,
    NoteValues,
    buildCard,
    buildChartCard,
    buildIterateCard,
    buildLinearCard,
    buildNotes6Card,
    buildVectorCard,
    isChartParse,
    isIterateParse,
    isLinearParse,
    isNotes6Parse,
    isVectorParse,
} from '../../readers/build';
import type { CardParse, ReadContext, Reader } from '../../readers/types';

export type { ChartCard } from '../../readers/build';

/** The setting Formula recognition: the network (default), or the rules of 6.1. */
export type RecognitionMode = 'smart' | 'rules';

/** The setting as stored: anything else is Smart. */
export function recognitionSetting(v: unknown): RecognitionMode {
    return v === 'rules' ? 'rules' : 'smart';
}

const parses = (lines: string[]) => parseChartText(lines.join('\n')).problems.length === 0;

/** Rules (6.1): does a formula (or row `row` of it) carry the dotted mark? Its card kinds, without the parse checks. */
export function rulesMark(tex: string, row: number | undefined, rowTex: string): boolean {
    return chartable(tex, row) || !!hoverKind(rowTex) || !!linearHoverKind(rowTex) || !!iterateHoverKind(rowTex);
}

/** The chart of a formula as Rules opens it (6.1): formulaLines and formulaChart, parsed; null when it has none. */
export function chartCard(tex: string, row?: number, axisName?: string): ChartCard | null {
    if (!chartable(tex, row)) return null;
    const formula = formulaLines(tex, row);
    const chart = formulaChart(tex, row);
    if (!formula || !chart) return null;
    const lines = withAxis(chart, axisName);
    return parses(lines) ? { kind: formula.kind, lines, axis: formula.axis } : null;
}

/** 6.2.1: is a card of this kind the label's own? implicit is formulaLines' equation; det is also the matrix card (shown as det). */
function ofLabel(kind: string, label: Label): boolean {
    if (label === 'implicit') return kind === 'equation' || kind === 'implicit';
    if (label === 'det') return kind === 'det' || kind === 'matrix';
    return kind === label;
}

/**
 * 6.2.1: the card of the network's kind. The candidates are the builder's
 * cards for the parses of the formula as written and of each of its
 * spellings, in that order; the first card of the label's kind wins, so
 * a = x \cdot y labelled surface opens the surface z = x y, not the curve
 * x y = a of the formula as written. Without one, the first card the
 * builder built (its kind shows: f(x) = ... in x and y is a surface).
 * 6.2.2: with the parse the card came from.
 */
function ofKind<P extends CardParse, T extends { kind: string }>(candidates: readonly P[], build: (p: P) => T | null, label: Label): { card: T; parse: P } | null {
    let first: { card: T; parse: P } | null = null;
    for (const parse of candidates) {
        let card: T | null;
        try {
            card = build(parse);
        } catch {
            card = null;
        }
        if (!card) continue;
        if (ofLabel(card.kind, label)) return { card, parse };
        first ??= { card, parse };
    }
    return first;
}

/** The parses a reader gives for a label (none for none), never throwing. */
function readFor(reader: Reader, tex: string, label: Label, ctx: ReadContext): CardParse[] {
    if (label === 'none') return [];
    try {
        return reader.read(tex, label, ctx);
    } catch {
        return [];
    }
}

/** Smart, for a chart label (function, surface, polar, implicit, region): the chart of the formula or of one of its spellings, of the label's kind first; 6.2.1: `functions`, the note's functions (their calls are no products). */
export function smartChart(tex: string, row: number | undefined, rowTex: string, label: Label, functions?: ReadonlySet<string>, reader: Reader = reader0): ChartCard | null {
    const candidates = readFor(reader, rowTex, label, { block: tex, row, functions }).filter(isChartParse);
    return ofKind(candidates, buildChartCard, label)?.card ?? null;
}

/** Smart, for recurrence, sum and domain: the card of src/iterate/hover.ts for the formula or a spelling of it, of the label's kind first. */
export function smartIterate(rowTex: string, label: Label, reader: Reader = reader0): IterateHoverCard | null {
    const candidates = readFor(reader, rowTex, label, {}).filter(isIterateParse);
    return ofKind(candidates, buildIterateCard, label)?.card ?? null;
}

/**
 * Smart, for set, map, condition, interval, jensen and epigraph: the card
 * of src/notes6/hover.ts with the note's definitions, of the label's kind
 * first. 6.2.1: `domains`, the sets the note names (noteDomains), for a
 * map's domain letter.
 */
export function smartNotes6(rowTex: string, label: Label, defs: Map<string, NoteDefinition>, domains?: ReadonlyMap<string, string>, reader: Reader = reader0): HoverCard | null {
    const candidates = readFor(reader, rowTex, label, { domains }).filter(isNotes6Parse);
    return ofKind(candidates, (p) => buildNotes6Card(p, defs), label)?.card ?? null;
}

/** Smart, for matrix, product, det and eigen: the card of src/linear/hover.ts with the note's matrices and vectors, of the label's kind first. */
export function smartLinear(rowTex: string, label: Label, values: Map<string, string>, reader: Reader = reader0): LinearHoverCard | null {
    const candidates = readFor(reader, rowTex, label, {}).filter(isLinearParse);
    const card = ofKind(candidates, (p) => buildLinearCard(p, values), label)?.card ?? null;
    // det of a written matrix: its card is the matrix's (the unit square and its area), named as a determinant.
    return card && label === 'det' && card.kind === 'matrix' ? { ...card, kind: 'det' } : card;
}

/** 6.2.1, Smart, for vector: the vector card of src/linear/vector.ts for the formula or a spelling of it, with the note's vectors. */
export function smartVector(rowTex: string, vectors: ReadonlyMap<string, NoteVector>, reader: Reader = reader0): VectorHoverCard | null {
    const candidates = readFor(reader, rowTex, 'vector', {}).filter(isVectorParse);
    return ofKind(candidates, (p) => buildVectorCard(p, vectors), 'vector')?.card ?? null;
}

/** 6.2.2: what smartCard reads around a formula: the note's definitions, functions and sets, and the block of a row. */
export interface SmartContext extends NoteValues, ReadContext {}

/**
 * 6.2.2: the Smart card of any label with the parse it came from (the
 * builder's card of the label's kind first, as the hover opens it, without
 * the fall back to Rules); null when the reader's parses build none.
 */
export function smartCard(rowTex: string, label: Label, ctx: SmartContext = {}, reader: Reader = reader0): { card: BuiltCard; parse: CardParse } | null {
    const group = groupOf(label);
    if (!group) return null;
    const candidates = readFor(reader, rowTex, label, ctx);
    const hit = ofKind(candidates, (p) => (groupOf(p.kind) === group ? buildCard(p, ctx) : null), label);
    if (!hit) return null;
    // det of a written matrix: its card is the matrix's, named as a determinant.
    return label === 'det' && hit.card.kind === 'matrix' ? { card: { ...hit.card, kind: 'det' }, parse: hit.parse } : hit;
}

/** Does any parse of the formula pass the label's builder's own quick check (as the dotted mark asks, without parse checks)? */
function quick(tex: string, row: number | undefined, rowTex: string, label: Label, functions: ReadonlySet<string> | undefined, vectors: (() => ReadonlyMap<string, NoteVector>) | undefined, reader: Reader): boolean {
    const group = groupOf(label);
    if (!group) return false;
    const all = readFor(reader, rowTex, label, { block: tex, row, functions });
    switch (group) {
        case 'chart':
            return all.some((p) => isChartParse(p) && chartableParse(p));
        case 'iterate':
            return all.some((p) => isIterateParse(p) && !!buildIterate(p));
        case 'notes6':
            return all.some(isNotes6Parse);
        case 'linear':
            return all.some(isLinearParse);
        case 'vector': {
            const v = vectors ? vectors() : new Map<string, NoteVector>();
            return all.some((p) => isVectorParse(p) && !!buildVector(p, v));
        }
        default:
            return false;
    }
}

/**
 * Smart: does a formula (or row `row` of it, rowTex) whose label the network
 * gave carry the dotted mark? 6.2.1: `functions` as for smartChart;
 * `vectors`, the note's vectors (asked only for the label vector).
 */
export function smartMark(tex: string, row: number | undefined, rowTex: string, label: Label, functions?: ReadonlySet<string>, vectors?: () => ReadonlyMap<string, NoteVector>, reader: Reader = reader0): boolean {
    if (label === 'none') return false;
    // Its own builder, or (the fall back of open) a card of the rules.
    return quick(tex, row, rowTex, label, functions, vectors, reader) || rulesMark(tex, row, rowTex);
}
