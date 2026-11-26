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
import type { Density } from './maths';
import { DistributionField, POISSON_SEEN, densityFor, isBadParameter, isDiscrete, kindOf } from './kinds'; // 6.2.1
import type { DistributionTool } from '../types';

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
            // 6.2.1: Poisson bars run on to the right: the fit holds those that can be seen (a 500th of the highest).
            if (isDiscrete(tool.kind)) {
                const lines = itemLines(item);
                const top = (l: { pts: Pt[] }) => Math.max(...l.pts.map((p) => p.y));
                const peak = Math.max(0, ...lines.map(top));
                return { points: [], lines: lines.filter((l) => top(l) >= peak / POISSON_SEEN) };
            }
            // 6.2.1: the other densities: where most of their mass lies, and their peak there.
            if (tool.kind !== 'normal') return densityFit(tool, math);
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

/** A t distribution is held this far either side of 0: four standard deviations, at most 6 (df <= 2 has none). */
const T_SPAN = 4;
const T_MAX = 6;

/**
 * 6.2.1: what the fit holds of a t, chi-square, exponential, uniform, gamma
 * or beta density: its x range (four standard deviations right of the mean
 * of the ones on [0, ∞), five over the rate of the exponential one, [0, 1]
 * for beta, a quarter of the width beyond each side of the uniform one) and
 * its peak there. A density with a pole (chi-square with df < 2) is held up
 * to its value a twentieth into the range, so the rest of it stays tall.
 */
function densityFit(tool: DistributionTool, math: MathContext): FitShapes {
    const kind = kindOf(tool.kind);
    const v = (f: DistributionField) => math.value(String(tool[f]));
    const d = densityFor(kind, v);
    if (isBadParameter(d)) return { points: [], lines: [] };
    let lo: number;
    let hi: number;
    switch (kind) {
        case 'studentT': {
            const df = v('df');
            const half = df > 2 ? Math.min(T_MAX, T_SPAN * Math.sqrt(df / (df - 2))) : T_MAX;
            lo = -half;
            hi = half;
            break;
        }
        case 'chiSquare': {
            const df = v('df');
            lo = 0;
            hi = df + 4 * Math.sqrt(2 * df);
            break;
        }
        case 'exponential':
            lo = 0;
            hi = 5 / v('rate');
            break;
        case 'gamma': {
            const k = v('shape');
            lo = 0;
            hi = (k + 4 * Math.sqrt(k)) / v('rate');
            break;
        }
        case 'uniform': {
            const a = v('from');
            const b = v('to');
            lo = a - (b - a) / 4;
            hi = b + (b - a) / 4;
            break;
        }
        default:
            lo = 0;
            hi = 1;
    }
    return { points: [{ x: lo, y: 0 }, { x: hi, y: 0 }, { x: lo, y: densityPeak(d, lo, hi) }], lines: [] };
}

/** The highest value of a density over [lo, hi] (sampled), a pole left out: held at its value a twentieth into the range. */
function densityPeak(d: Density, lo: number, hi: number): number {
    const a = Math.max(lo, d.lo);
    const b = Math.min(hi, d.hi);
    if (!(b > a)) return 0;
    const pole = !Number.isFinite(d.pdf(a)) || !Number.isFinite(d.pdf(b));
    const from = pole && !Number.isFinite(d.pdf(a)) ? a + (b - a) / 20 : a;
    const to = pole && !Number.isFinite(d.pdf(b)) ? b - (b - a) / 20 : b;
    let peak = 0;
    for (let i = 0; i <= 200; i++) {
        const y = d.pdf(from + ((to - from) * i) / 200);
        if (Number.isFinite(y) && y > peak) peak = y;
    }
    // Its middle too, where the samples may step over a narrow peak.
    const m = d.pdf(d.mid);
    if (Number.isFinite(m) && d.mid >= from && d.mid <= to) peak = Math.max(peak, m);
    return peak;
}
