/*
 * 6.2.1: where a chart's legend goes. Up to 6.2.0 it always sat in the top
 * right corner of the plot, also on top of the labels there (the label
 * x* = 1 of a line under the legend). Now it stays there unless it would
 * cover a label, a written text, a marked point or the numbers of an axis;
 * then it takes the corner that covers least of them (lines it covers
 * decide between corners that cover none). The preview and the export
 * ask this with the same estimates (the label placer's text widths, the
 * exported figure's sizes), so the legend is in the same corner on screen
 * and in the PDF (`legend pos`).
 *
 * Pure: no DOM, no Obsidian.
 */
import type { Annotation, AnnotationSize, FunctionParameters } from './types';
import type { FunctionInfo, MathContext } from './mathcontext';
import type { Pt, View } from './geometry';
import { LabelMetrics, SceneItem2D, TextAnchor, labelWidthEm, textBoxPt } from './scene';
import { sampleCurve } from './util';

/** A corner of the plot, as pgfplots' `legend pos` names it. */
export type LegendCorner = 'north east' | 'north west' | 'south west' | 'south east';

/** In this order when they cover the same: the usual place first. */
export const LEGEND_CORNERS: readonly LegendCorner[] = ['north east', 'north west', 'south east', 'south west'];

/**
 * The legend's measures in em of its text (\footnotesize, 8 pt), as the
 * preview draws it: padding, the line sample, the gap before the text, the
 * row height, the inset from the plot's side and from its top or bottom.
 */
export const LEGEND_EM = { pad: 0.7, sample: 1.8, gap: 0.55, row: 1.8, inset: 0.9, insetY: 0.45 } as const;
/** The legend's text size in pt. */
export const LEGEND_PT = 8;

/** What covering one thing costs: a whole label, a marked point, the numbers of an axis, one pt of a line. */
const COVER = { label: 100, marker: 30, numbers: 30, line: 0.05 };
/** Samples per function for the lines the legend may cover. */
const CURVE_SAMPLES = 200;
/** A marked point counts as covered within this many pt of the legend. */
const MARKER_REACH_PT = 3;
/** The bands of numbers beside centred axes, in em of the numbers: under the x-axis, left of the y-axis. */
const NUMBERS_EM = { x: 1.5, y: 2.6 };
/** The size of the numbers in pt: \scriptsize in the clean look, 10 pt in Classic. */
const NUMBER_PT = { clean: 7, classic: 10 };

/** The text of a function's legend entry: its own, else its expression in math, as the preview writes it. */
export function legendLabelOf(info: FunctionInfo, f: FunctionParameters, math: MathContext): string {
    const custom = String(f.legendLabel ?? '').trim();
    if (custom) return custom;
    const tex = (src: string | undefined) => math.tex(String(src ?? ''));
    if (info.kind === 'parametric') return `$\\left(${tex(f.expression)},\\ ${tex(f.expressionY)}\\right)$`;
    if (info.kind === 'polar') return `$r = ${tex(f.expression)}$`;
    return `$${tex(f.expression)}$`;
}

/** A box in plot pt (origin bottom left, y up). */
interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

/** The legend's box in plot pt in `corner`, for entries `labels`, in a plot of `m.w` x `m.h` pt. */
export function legendBoxPt(labels: readonly string[], corner: LegendCorner, m: { w: number; h: number }): Box {
    const em = LEGEND_PT;
    const text = labels.reduce((w, l) => Math.max(w, labelWidthEm(l)), 0);
    const w = (2 * LEGEND_EM.pad + LEGEND_EM.sample + LEGEND_EM.gap + text) * em;
    const h = (labels.length * LEGEND_EM.row + 2 * LEGEND_EM.insetY) * em;
    const east = corner.endsWith('east');
    const north = corner.startsWith('north');
    const x0 = east ? m.w - LEGEND_EM.inset * em - w : LEGEND_EM.inset * em;
    const y0 = north ? m.h - LEGEND_EM.insetY * em - h : LEGEND_EM.insetY * em;
    return { x0, y0, x1: x0 + w, y1: y0 + h };
}

function overlap(a: Box, b: Box): number {
    const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return w > 0 && h > 0 ? w * h : 0;
}

/** Length of segment a-b inside box r (Liang-Barsky), 0 when it misses. */
function lengthInside(ax: number, ay: number, bx: number, by: number, r: Box): number {
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const edges: Array<[number, number]> = [
        [-dx, ax - r.x0],
        [dx, r.x1 - ax],
        [-dy, ay - r.y0],
        [dy, r.y1 - ay],
    ];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return 0;
            continue;
        }
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return 0;
    }
    return (t1 - t0) * Math.hypot(dx, dy);
}

/** What the legend may cover, in plot pt. */
export interface LegendObstacles {
    labels: Box[];
    markers: Pt[];
    numbers: Box[];
    lines: Pt[][];
}

/**
 * The obstacles of a chart in the plot pt of `metrics`: the scene's texts
 * and the written texts (as the label placer measures them), the marked
 * points, the numbers beside axes through the middle, and the drawn lines
 * and function curves.
 */
export function legendObstacles(
    input: { functions: FunctionParameters[]; annotations?: Annotation[]; axisStyle?: string; clean?: boolean },
    math: MathContext,
    items: readonly SceneItem2D[],
    view: View,
    metrics: LabelMetrics
): LegendObstacles {
    const X = (x: number) => ((x - view.xmin) / (view.xmax - view.xmin)) * metrics.w;
    const Y = (y: number) => ((y - view.ymin) / (view.ymax - view.ymin)) * metrics.h;
    const ok = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y);
    const out: LegendObstacles = { labels: [], markers: [], numbers: [], lines: [] };
    for (const item of items) {
        for (const t of item.texts || []) if (ok(t) && String(t.text ?? '').trim()) out.labels.push(textBoxPt(t, view, metrics));
        for (const mk of item.markers || []) if (ok(mk)) out.markers.push({ x: X(mk.x), y: Y(mk.y) });
        for (const s of [...(item.strokes || []), ...(item.guides || [])]) for (const line of s.lines || []) out.lines.push(line.filter(ok).map((p) => ({ x: X(p.x), y: Y(p.y) })));
    }
    for (const a of input.annotations || []) {
        if (!a || a.hidden) continue;
        const text = math.formatTemplate(String(a.text ?? ''));
        const r = { x: math.tryValue(String(a.x ?? '')), y: math.tryValue(String(a.y ?? '')) };
        if (!text.trim() || !r.x.ok || !r.y.ok) continue;
        const size: AnnotationSize = a.size || 'normal';
        const anchor: TextAnchor = a.anchor || 'center';
        out.labels.push(textBoxPt({ x: r.x.value, y: r.y.value, text, anchor, size, weight: undefined, offset: undefined }, view, metrics));
    }
    const fns = input.functions || [];
    for (const info of math.functions()) {
        const f = fns[info.index];
        if (!f || info.hidden || info.error || info.domainError || !String(f.expression ?? '').trim()) continue;
        let runs: Pt[][] = [];
        try {
            if (info.kind === 'cartesian') {
                const d = info.domain;
                const lo = d ? Math.max(d[0], view.xmin) : view.xmin;
                const hi = d ? Math.min(d[1], view.xmax) : view.xmax;
                runs = sampleCurve((x) => ({ x, y: info.fn(x) }), lo, hi, CURVE_SAMPLES, view);
            } else {
                const [lo, hi] = info.domain || [0, 2 * Math.PI];
                const fy = info.fnY;
                if (info.kind === 'parametric' && fy) runs = sampleCurve((t) => ({ x: info.fn(t), y: fy(t) }), lo, hi, CURVE_SAMPLES, view);
                else if (info.kind === 'polar') runs = sampleCurve((th) => ({ x: info.fn(th) * Math.cos(th), y: info.fn(th) * Math.sin(th) }), lo, hi, CURVE_SAMPLES, view);
            }
        } catch {
            runs = [];
        }
        for (const run of runs) out.lines.push(run.filter(ok).map((p) => ({ x: X(p.x), y: Y(p.y) })));
    }
    // Axes through the middle: the line and the band of its numbers (below the x-axis, left of the y-axis).
    if (input.axisStyle === 'middle') {
        const pt = input.clean ? NUMBER_PT.clean : NUMBER_PT.classic;
        if (view.ymin < 0 && view.ymax > 0) {
            const y0 = Y(0);
            out.lines.push([{ x: 0, y: y0 }, { x: metrics.w, y: y0 }]);
            out.numbers.push({ x0: 0, x1: metrics.w, y0: y0 - NUMBERS_EM.x * pt, y1: y0 });
        }
        if (view.xmin < 0 && view.xmax > 0) {
            const x0 = X(0);
            out.lines.push([{ x: x0, y: 0 }, { x: x0, y: metrics.h }]);
            out.numbers.push({ x0: x0 - NUMBERS_EM.y * pt, x1: x0, y0: 0, y1: metrics.h });
        }
    }
    return out;
}

/** What the legend in box `b` covers: labels, marked points and numbers (`hard`), and the length of lines (`lines`, pt). */
export function legendCover(b: Box, o: LegendObstacles): { hard: number; lines: number } {
    let hard = 0;
    for (const l of o.labels) {
        const area = Math.max(1e-9, (l.x1 - l.x0) * (l.y1 - l.y0));
        hard += COVER.label * (overlap(b, l) / area);
    }
    for (const p of o.markers) {
        const nx = Math.max(b.x0, Math.min(p.x, b.x1));
        const ny = Math.max(b.y0, Math.min(p.y, b.y1));
        if (Math.hypot(nx - p.x, ny - p.y) <= MARKER_REACH_PT) hard += COVER.marker;
    }
    for (const n of o.numbers) {
        const area = Math.max(1e-9, Math.min(n.x1 - n.x0, b.x1 - b.x0) * Math.min(n.y1 - n.y0, b.y1 - b.y0));
        hard += COVER.numbers * Math.min(1, overlap(b, n) / area);
    }
    let lines = 0;
    for (const line of o.lines) for (let i = 1; i < line.length; i++) lines += lengthInside(line[i - 1].x, line[i - 1].y, line[i].x, line[i].y, b);
    return { hard, lines };
}

/**
 * The corner of the legend with entries `labels`: the top right one unless
 * it covers a label, a written text, a marked point or numbers; then the
 * corner that covers least of them, and of lines.
 */
export function legendCorner(labels: readonly string[], o: LegendObstacles, metrics: { w: number; h: number }): LegendCorner {
    if (!labels.length) return 'north east';
    const scored = LEGEND_CORNERS.map((corner) => {
        const c = legendCover(legendBoxPt(labels, corner, metrics), o);
        return { corner, hard: c.hard, cost: c.hard + COVER.line * c.lines };
    });
    if (scored[0].hard < 1) return 'north east';
    let best = scored[0];
    for (const s of scored) if (s.cost < best.cost - 1e-6) best = s;
    return best.corner;
}
