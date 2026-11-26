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
 * The kind a builder builds may differ from the network's within the same
 * builder (formulaLines draws f(x) = ... in x and y as a surface): the
 * builder's kind shows. Pure: no DOM, no Obsidian.
 */
import { FormulaKind, chartable, formulaChart, formulaLines } from '../../formula';
import { parseChartText } from '../../text/parse';
import { HoverCard, NoteDefinition, hoverCard, hoverKind } from '../hover';
import { LinearHoverCard, linearHoverCard, linearHoverKind } from '../../linear/hover';
import { IterateHoverCard, iterateHoverCard, iterateHoverKind } from '../../iterate/hover';
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

/** Smart, for a chart label (function, surface, polar, implicit, region): the chart of the formula or of one of its spellings. */
export function smartChart(tex: string, row: number | undefined, rowTex: string, label: Label): ChartCard | null {
    const own = chartCard(tex, row);
    if (own) return own;
    for (const s of spellings(rowTex, label).slice(1)) {
        const card = chartCard(s.tex, undefined, s.axis);
        if (card) return card;
    }
    return null;
}

/** Smart, for recurrence, sum and domain: the card of src/iterate/hover.ts for the formula or a spelling of it. */
export function smartIterate(rowTex: string, label: Label): IterateHoverCard | null {
    for (const s of spellings(rowTex, label)) {
        const card = iterateHoverCard(s.tex);
        if (card && parses(card.lines)) return card;
    }
    return null;
}

/** Smart, for set, map, condition, interval, jensen and epigraph: the card of src/notes6/hover.ts with the note's definitions. */
export function smartNotes6(rowTex: string, label: Label, defs: Map<string, NoteDefinition>): HoverCard | null {
    for (const s of spellings(rowTex, label)) {
        const card = hoverCard(s.tex, defs);
        if (card && parses(card.lines) && (!card.lines2 || parses(card.lines2))) return card;
    }
    return null;
}

/** Smart, for matrix, product, det and eigen: the card of src/linear/hover.ts with the note's matrices and vectors. */
export function smartLinear(rowTex: string, label: Label, values: Map<string, string>): LinearHoverCard | null {
    for (const s of spellings(rowTex, label)) {
        const card = linearHoverCard(s.tex, values);
        if (card && parses(card.lines)) {
            // det of a written matrix: its card is the matrix's (the unit square and its area), named as a determinant.
            return label === 'det' && card.kind === 'matrix' ? { ...card, kind: 'det' } : card;
        }
    }
    return null;
}

/** Does any spelling of the formula pass the label's builder's own quick check (as the dotted mark asks, without parse checks)? */
function quick(tex: string, row: number | undefined, rowTex: string, label: Label): boolean {
    const group = groupOf(label);
    const all: Spelling[] = spellings(rowTex, label);
    switch (group) {
        case 'chart':
            return chartable(tex, row) || all.slice(1).some((s) => chartable(s.tex));
        case 'iterate':
            return all.some((s) => !!iterateHoverKind(s.tex));
        case 'notes6':
            return all.some((s) => !!hoverKind(s.tex));
        case 'linear':
            return all.some((s) => !!linearHoverKind(s.tex));
        default:
            return false;
    }
}

/** Smart: does a formula (or row `row` of it, rowTex) whose label the network gave carry the dotted mark? */
export function smartMark(tex: string, row: number | undefined, rowTex: string, label: Label): boolean {
    if (label === 'none') return false;
    // Its own builder, or (the fallback of open) a card of the rules.
    return quick(tex, row, rowTex, label) || rulesMark(tex, row, rowTex);
}
