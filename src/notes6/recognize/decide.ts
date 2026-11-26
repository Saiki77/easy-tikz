/*
 * Formula recognition (6.2): which card a formula of a note opens, and
 * whether it carries the dotted mark, for the two settings of Formula
 * recognition (src/ui/formulaHover.ts asks these).
 *
 *   Rules   exactly 6.1: the first builder that takes the formula, in the
 *           order chart (src/formula.ts), iterate, notes6, linear.
 *   Smart   the network (index.ts) decides. none: no card and no mark. A
 *           card kind: the builder of that kind, on the formula and on its
 *           spellings for that builder (adapt.ts). If that builder builds
 *           nothing, the formula falls back to Rules: so it gets a card only
 *           when the network and the rules both say "a card", and then the
 *           card the rules open. Otherwise no card.
 *
 * 6.2.1: the card is of the network's kind whenever the builder builds one
 * of that kind for the formula or a spelling of it (a = x \cdot y labelled
 * surface is the surface z = x y, not the curve the formula as written
 * draws). Only when it builds none of that kind may the kind differ within
 * the same builder (formulaLines draws f(x) = ... in x and y as a surface):
 * the builder's kind shows. 6.2.1, round 3: the label vector has its own
 * card (src/linear/vector.ts), with the vectors of the whole note; Rules
 * has no vector card (as 6.1). Pure: no DOM, no Obsidian.
 */
import { FormulaKind, chartable, formulaChart, formulaLines } from '../../formula';
import { parseChartText } from '../../text/parse';
import { HoverCard, NoteDefinition, hoverCard, hoverKind } from '../hover';
import { LinearHoverCard, linearHoverCard, linearHoverKind } from '../../linear/hover';
import { IterateHoverCard, iterateHoverCard, iterateHoverKind } from '../../iterate/hover';
import { NoteVector, VectorHoverCard, vectorHoverCard } from '../../linear/vector';
import { Label } from './net';
import { Spelling, groupOf, spellings, withAxis } from './adapt';

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

/** A chart of src/formula.ts: its kind, its lines with the view, and formulaLines' axis (a sequence's n). */
export interface ChartCard {
    kind: FormulaKind;
    lines: string[];
    axis?: string;
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
    if (label === 'implicit') return kind === 'equation';
    if (label === 'det') return kind === 'det' || kind === 'matrix';
    return kind === label;
}

/**
 * 6.2.1: the card of the network's kind. The candidates are the builder's
 * cards for the formula as written and for each of its spellings, in that
 * order; the first card of the label's kind wins, so a = x \cdot y
 * labelled surface opens the surface z = x y, not the curve x y = a of the
 * formula as written. Without one, the first card the builder built (its
 * kind shows: f(x) = ... in x and y is a surface).
 */
function ofKind<T extends { kind: string }>(candidates: Iterable<T | null>, label: Label): T | null {
    let first: T | null = null;
    for (const card of candidates) {
        if (!card) continue;
        if (ofLabel(card.kind, label)) return card;
        first ??= card;
    }
    return first;
}

/** Smart, for a chart label (function, surface, polar, implicit, region): the chart of the formula or of one of its spellings, of the label's kind first; 6.2.1: `functions`, the note's functions (their calls are no products). */
export function smartChart(tex: string, row: number | undefined, rowTex: string, label: Label, functions?: ReadonlySet<string>): ChartCard | null {
    function* cards(): Generator<ChartCard | null> {
        yield chartCard(tex, row);
        for (const s of spellings(rowTex, label, functions).slice(1)) yield chartCard(s.tex, undefined, s.axis);
    }
    return ofKind(cards(), label);
}

/** Smart, for recurrence, sum and domain: the card of src/iterate/hover.ts for the formula or a spelling of it, of the label's kind first. */
export function smartIterate(rowTex: string, label: Label): IterateHoverCard | null {
    function* cards(): Generator<IterateHoverCard | null> {
        for (const s of spellings(rowTex, label)) {
            const card = iterateHoverCard(s.tex);
            yield card && parses(card.lines) ? card : null;
        }
    }
    return ofKind(cards(), label);
}

/**
 * Smart, for set, map, condition, interval, jensen and epigraph: the card
 * of src/notes6/hover.ts with the note's definitions, of the label's kind
 * first. 6.2.1: `domains`, the sets the note names (noteDomains), for a
 * map's domain letter.
 */
export function smartNotes6(rowTex: string, label: Label, defs: Map<string, NoteDefinition>, domains?: ReadonlyMap<string, string>): HoverCard | null {
    function* cards(): Generator<HoverCard | null> {
        for (const s of spellings(rowTex, label, undefined, domains)) {
            const card = hoverCard(s.tex, defs);
            yield card && parses(card.lines) && (!card.lines2 || parses(card.lines2)) ? card : null;
        }
    }
    return ofKind(cards(), label);
}

/** Smart, for matrix, product, det and eigen: the card of src/linear/hover.ts with the note's matrices and vectors, of the label's kind first. */
export function smartLinear(rowTex: string, label: Label, values: Map<string, string>): LinearHoverCard | null {
    function* cards(): Generator<LinearHoverCard | null> {
        for (const s of spellings(rowTex, label)) {
            const card = linearHoverCard(s.tex, values);
            yield card && parses(card.lines) ? card : null;
        }
    }
    const card = ofKind(cards(), label);
    // det of a written matrix: its card is the matrix's (the unit square and its area), named as a determinant.
    return card && label === 'det' && card.kind === 'matrix' ? { ...card, kind: 'det' } : card;
}

/** 6.2.1, Smart, for vector: the vector card of src/linear/vector.ts for the formula or a spelling of it, with the note's vectors. */
export function smartVector(rowTex: string, vectors: ReadonlyMap<string, NoteVector>): VectorHoverCard | null {
    for (const s of spellings(rowTex, 'vector')) {
        const card = vectorHoverCard(s.tex, vectors);
        if (card && parses(card.lines)) return card;
    }
    return null;
}

/** Does any spelling of the formula pass the label's builder's own quick check (as the dotted mark asks, without parse checks)? */
function quick(tex: string, row: number | undefined, rowTex: string, label: Label, functions?: ReadonlySet<string>, vectors?: () => ReadonlyMap<string, NoteVector>): boolean {
    const group = groupOf(label);
    const all: Spelling[] = spellings(rowTex, label, functions);
    switch (group) {
        case 'chart':
            return chartable(tex, row) || all.slice(1).some((s) => chartable(s.tex));
        case 'iterate':
            return all.some((s) => !!iterateHoverKind(s.tex));
        case 'notes6':
            return all.some((s) => !!hoverKind(s.tex));
        case 'linear':
            return all.some((s) => !!linearHoverKind(s.tex));
        case 'vector': {
            const v = vectors ? vectors() : new Map<string, NoteVector>();
            return all.some((s) => !!vectorHoverCard(s.tex, v));
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
export function smartMark(tex: string, row: number | undefined, rowTex: string, label: Label, functions?: ReadonlySet<string>, vectors?: () => ReadonlyMap<string, NoteVector>): boolean {
    if (label === 'none') return false;
    // Its own builder, or (the fallback of open) a card of the rules.
    return quick(tex, row, rowTex, label, functions, vectors) || rulesMark(tex, row, rowTex);
}
