/*
 * What the auto-fit (src/fit.ts) holds of the tools beyond functions (5.0):
 * the points, bars and lines of a data plot, a normal density from four
 * standard deviations left of its mean to four right of it and up to its
 * peak, a binomial distribution's bars, the parts of a Riemann sum. A tool
 * that covers the whole view, whatever it is, never sets the ranges. Pure:
 * no DOM, no Obsidian.
 */
import type { Tool } from '../types';
import type { Pt } from '../geometry';
import type { SceneItem2D } from '../scene';
import type { MathContext } from '../mathcontext';
import { normalPdf } from './maths';

/** A normal density is held from this many standard deviations left of its mean to as many right of it. */
const NORMAL_SPAN = 4;

/** Fills and strokes of an item as polylines (fills closed). */
function itemLines(item: SceneItem2D): FitShapes['lines'] {
    const lines: FitShapes['lines'] = [];
    for (const f of item.fills) for (const ring of f.rings) lines.push({ pts: ring, closed: true });
    for (const s of item.strokes) for (const l of s.lines) lines.push({ pts: l, closed: !!s.closed });
    return lines;
}

export interface FitShapes {
    /** Points the ranges hold. */
    points: Pt[];
    /** Polylines the ranges hold (closed: a ring). */
    lines: Array<{ pts: Pt[]; closed: boolean }>;
    /** It goes on forever (a slope field): it fits nothing, and a chart of only such tools is unbounded. */
    unbounded?: boolean;
}

/** The tool as the fit computes it: its labels left out (they never set the ranges). */
export function fitBeyondTool(t: Tool): Tool {
    switch (t.type) {
        case 'dataPlot':
        case 'probability':
        case 'riemann':
            return { ...t, label: '', valueLabel: false };
        default:
            return t;
    }
}

/** What a scene item of a tool of this module adds to the fit; null for other tools. */
export function beyondFitShapes(tool: Tool, item: SceneItem2D, math: MathContext): FitShapes | null {
    switch (tool.type) {
        case 'data':
        case 'probability':
            // A data set draws nothing; a probability lies under its distribution.
            return { points: [], lines: [] };
        case 'dataPlot':
            return { points: item.markers.map((m) => ({ x: m.x, y: m.y })), lines: itemLines(item) };
        case 'riemann':
            return { points: [], lines: itemLines(item) };
        case 'slopeField':
        case 'solution':
            // Over the whole view, or up to its edges: they follow the view and never set it.
            return { points: [], lines: [], unbounded: true };
        case 'distribution': {
            if (tool.kind === 'binomial') return { points: [], lines: itemLines(item) };
            const mean = math.value(tool.mean);
            const sd = math.value(tool.sd);
            if (!Number.isFinite(mean) || !(sd > 0)) return { points: [], lines: [] };
            return {
                points: [
                    { x: mean - NORMAL_SPAN * sd, y: 0 },
                    { x: mean + NORMAL_SPAN * sd, y: 0 },
                    { x: mean, y: normalPdf(mean, mean, sd) },
                ],
                lines: [],
            };
        }
        default:
            return null;
    }
}
