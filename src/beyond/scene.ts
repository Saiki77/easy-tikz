/*
 * The tools beyond functions (5.0) as scene primitives: data sets and their
 * plots (points, bars, a line, the least-squares line), normal and binomial
 * distributions and the probabilities shaded under them, Riemann sums and the
 * trapezoid rule, slope fields and the solutions through points. They draw
 * with the
 * scene's fills, strokes, markers and texts (src/scene.ts), so the preview
 * and the pgfplots export draw them alike, as numeric coordinates. 2D only:
 * a 3D chart names them as problems. Pure: no DOM, no Obsidian.
 */
import type { DataPlotTool, DataTool, DistributionTool, MarkerSize, ProbabilityTool, RiemannTool, SlopeFieldTool, SolutionTool, Tool } from '../types';
import type { Pt } from '../geometry';
import { t as msg } from '../i18n';
import { errorText } from '../util';
import type { SceneCtx, SceneOutput } from '../scene';
import { addIssue, fail, labelSpot, newOutput, publish, towardCenter, UP_RIGHT } from '../scene';
import { tableData } from './table';
import { Density, binomialPmf, decimal, densityProbability, integral, leastSquares, normalPdf, normalProbability, poissonPmf, probabilityText, regressionLabel, riemannSum, solveOde } from './maths';
import { eventBounds, eventLabel, readEvent } from './event';
import { DistributionField, KIND_FIELDS, MAX_LAMBDA, POISSON_SEEN, densityFor, isBadParameter, kindOf } from './kinds'; // 6.2.1

/** The tool types of this module: drawn in 2D charts only. */
export const BEYOND_TYPES: ReadonlySet<string> = new Set(['data', 'dataPlot', 'distribution', 'probability', 'riemann', 'slopeField', 'solution']);

/**
 * A distribution as the tools that shade it read it. 6.2.1: Poisson bars
 * (P(X = k) at k = 0 to the end of `pmf`), and the densities of the other
 * kinds (t, chi-square, exponential, uniform, gamma, beta).
 */
export type DistributionData =
    | { kind: 'normal'; mean: number; sd: number }
    | { kind: 'binomial'; n: number; p: number; pmf: number[] }
    | { kind: 'poisson'; lambda: number; pmf: number[] }
    | { kind: 'density'; density: Density };

/** What these tools hand the tools that read them (kept on the producer's scene output). */
export interface BeyondOutput {
    distribution?: DistributionData;
    /** A slope field's f(x, y), which its solutions follow. */
    field?: (x: number, y: number) => number;
}

/** Width of a binomial bar (k - 0.4 to k + 0.4): the shaded bars lie on the distribution's. */
export const BINOMIAL_BAR = 0.8;
/** Most trials a binomial distribution draws. */
export const MAX_TRIALS = 1000;
/** Most parts a Riemann sum draws. */
export const MAX_PARTS = 2000;
/** A slope field segment is this share of its grid cell long (on screen, whatever its slope). */
const SEGMENT_SHARE = 0.6;
/** A solution stops this many view heights above or below the view. */
const SOLUTION_MARGIN = 1;
/** Steps of a solution across the view (shorter where it is steep). */
const SOLUTION_STEPS = 400;
/** A solution ends where it rises this many times faster than it runs, on screen. */
const STEEP = 1000;

function str(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
}

const finitePair = (p: number[]) => Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * A ring cut to the view (Sutherland-Hodgman against its four sides); null
 * when nothing of it is inside. The export draws fills as they are, and
 * pgfplots clips no \fill: a bar taller than the view must end at its top.
 */
export function clipRing(ring: Pt[], view: { xmin: number; xmax: number; ymin: number; ymax: number }): Pt[] | null {
    const sides: Array<{ inside: (p: Pt) => boolean; cut: (a: Pt, b: Pt) => Pt }> = [
        { inside: (p) => p.x >= view.xmin, cut: (a, b) => ({ x: view.xmin, y: a.y + ((b.y - a.y) * (view.xmin - a.x)) / (b.x - a.x) }) },
        { inside: (p) => p.x <= view.xmax, cut: (a, b) => ({ x: view.xmax, y: a.y + ((b.y - a.y) * (view.xmax - a.x)) / (b.x - a.x) }) },
        { inside: (p) => p.y >= view.ymin, cut: (a, b) => ({ x: a.x + ((b.x - a.x) * (view.ymin - a.y)) / (b.y - a.y), y: view.ymin }) },
        { inside: (p) => p.y <= view.ymax, cut: (a, b) => ({ x: a.x + ((b.x - a.x) * (view.ymax - a.y)) / (b.y - a.y), y: view.ymax }) },
    ];
    let pts = ring.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    for (const side of sides) {
        if (!pts.length) return null;
        const next: Pt[] = [];
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            const ina = side.inside(a);
            const inb = side.inside(b);
            if (ina) next.push(a);
            if (ina !== inb) next.push(side.cut(a, b));
        }
        pts = next;
    }
    return pts.length >= 3 ? pts : null;
}

/** Rings cut to the view, those outside it left out. */
function inView(rings: Pt[][], view: SceneCtx['view']): Pt[][] {
    return rings.map((r) => clipRing(r, view)).filter((r): r is Pt[] => r !== null);
}

/**
 * Producers and evaluated sources of a tool of this module, for the scene's
 * dependency graph and cache keys: `scan(src, field)` adds an expression
 * field (its sliders, functions and tools), `refs` a tool read by name.
 */
export function beyondSources(t: Tool, scan: (src: unknown, field: string) => void, refs: Array<{ name: string; field: string }>): void {
    switch (t.type) {
        case 'data':
            if (t.source === 'list') scan(t.points, 'points');
            break;
        case 'dataPlot': {
            const data = str(t.data).trim();
            if (data) refs.push({ name: data, field: 'data' });
            break;
        }
        case 'distribution':
            // 6.2.1: the fields of its kind.
            for (const f of KIND_FIELDS[kindOf(t.kind)]) scan(t[f], f);
            break;
        case 'probability': {
            const dist = str(t.distribution).trim();
            if (dist) refs.push({ name: dist, field: 'distribution' });
            scan(t.event, 'event');
            break;
        }
        case 'riemann':
            // The function's name stands for its body: its sliders and the functions it calls count too.
            scan(t.function, 'function');
            scan(t.from, 'from');
            scan(t.to, 'to');
            scan(t.parts, 'parts');
            break;
        case 'slopeField':
            scan(t.expression, 'expression');
            break;
        case 'solution': {
            const field = str(t.field).trim();
            if (field) refs.push({ name: field, field: 'field' });
            // Its points tools (P) are read by name: a drag on P moves the solution.
            scan(t.through, 'through');
            break;
        }
    }
}

/** A tool of this module computed; null for any other tool. */
export function computeBeyond(t: Tool, ctx: SceneCtx): SceneOutput | null {
    switch (t.type) {
        case 'data':
            return computeData(t, ctx);
        case 'dataPlot':
            return computeDataPlot(t, ctx);
        case 'distribution':
            return computeDistribution(t, ctx);
        case 'probability':
            return computeProbability(t, ctx);
        case 'riemann':
            return computeRiemann(t, ctx);
        case 'slopeField':
            return computeSlopeField(t, ctx);
        case 'solution':
            return computeSolution(t, ctx);
        default:
            return null;
    }
}

/**
 * The value of a formula field; null after a problem (an error, or a note
 * while a computed value it reads, such as P1_x, is still unset).
 */
function fieldValue(src: string, field: string, name: string, ctx: SceneCtx, out: SceneOutput): number | null {
    const res = ctx.math.tryValue(src);
    if (res.ok) return res.value;
    if (ctx.math.validate(src, 'value').ok) addIssue(out, name, field, res.message, 'info');
    else fail(out, name, field, res.message);
    return null;
}

// -------------------------------------------------------------------- data

function computeData(t: DataTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const { math } = ctx;
    let pts: number[][] = [];
    if (t.source === 'list') {
        const src = str(t.points);
        if (!src.trim()) return out;
        try {
            pts = math.tuples(src, 2);
        } catch (e) {
            // Waiting for a computed value (P1_x) is not a typo.
            if (math.validate(src, 'tuples2').ok) addIssue(out, t.name, 'points', errorText(e), 'info');
            else return fail(out, t.name, 'points', errorText(e));
        }
    } else {
        const table = math.noteTable();
        if (table === undefined) {
            // A new chart in the editor or a check by an AI app: the note's table is read where the chart is drawn.
            addIssue(out, t.name, undefined, msg('beyond.problem.tableInNote'), 'info');
        } else if (table === null) {
            return fail(out, t.name, undefined, msg('beyond.problem.noTable'));
        } else {
            const d = tableData(table, str(t.xColumn), str(t.yColumn));
            if (!d.ok) {
                const columns = d.columns.join(', ');
                if (d.problem === 'noColumn') return fail(out, t.name, d.column === str(t.yColumn).trim() ? 'yColumn' : 'xColumn', msg('beyond.problem.noColumn', { column: d.column, columns }));
                return fail(out, t.name, undefined, msg('beyond.problem.noNumbers', { columns }));
            }
            pts = d.points;
            if (d.skipped) {
                const x = d.xName || msg('beyond.data.rowNumber');
                addIssue(out, t.name, undefined, msg('beyond.problem.rowsSkipped', { count: d.skipped, x, y: d.yName }), 'info');
            }
        }
    }
    pts = pts.filter(finitePair).map((p) => [p[0], p[1]]);
    out.points = pts;
    publish(out, t.name, pts, NaN, 2);
    return out;
}

// --------------------------------------------------------------- data plot

/** The points of the data set a plot reads; null (with the problem) when it cannot. */
function dataOf(t: DataPlotTool, ctx: SceneCtx, out: SceneOutput): Pt[] | null {
    const name = str(t.data).trim();
    if (!name) {
        fail(out, t.name, 'data', msg('beyond.problem.chooseData'));
        return null;
    }
    const tool = ctx.toolsByName.get(name);
    if (!tool) {
        fail(out, t.name, 'data', msg('problems.scene.doesNotExist', { name }));
        return null;
    }
    if (tool.type !== 'data') {
        fail(out, t.name, 'data', msg('beyond.problem.notData', { name }));
        return null;
    }
    const prod = ctx.outputs.get(name);
    if (!prod || prod.failed) {
        fail(out, t.name, 'data', msg('problems.scene.hasError', { name }));
        return null;
    }
    return (prod.points || []).filter(finitePair).map((p) => ({ x: p[0], y: p[1] }));
}

/** Bar width: 80 % of the smallest gap between two x values (0.8 when there is no gap). */
function barWidth(pts: Pt[]): number {
    const xs = Array.from(new Set(pts.map((p) => p.x))).sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 1; i < xs.length; i++) gap = Math.min(gap, xs[i] - xs[i - 1]);
    return 0.8 * (Number.isFinite(gap) && gap > 0 ? gap : 1);
}

function computeDataPlot(t: DataPlotTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const pts = dataOf(t, ctx, out);
    if (!pts) return out;
    const color = str(t.color) || 'blue';
    const width = str(t.thickness) || 'thin';
    const dashed = !!t.dashed;
    const label = str(t.label).trim();
    switch (t.style) {
        case 'bars': {
            const w = barWidth(pts);
            const outlines: Pt[][] = [];
            const opacity = Number.isFinite(t.fillOpacity) ? t.fillOpacity : 0.35;
            pts.forEach((p, i) => {
                // Its value over a bar (under one that goes down).
                if (!label && !t.valueLabel) return;
                const spec = { x: p.x, y: p.y, template: 'label' as const, part: i, locals: { x: p.x, y: p.y, i: i + 1 }, color, size: 'small' as const, anchor: p.y < 0 ? ('below' as const) : ('above' as const) };
                out.texts.push(label ? spec : { ...spec, literal: decimal(p.y, 3) });
            });
            for (const p of pts) {
                const ring = [
                    { x: p.x - w / 2, y: 0 },
                    { x: p.x + w / 2, y: 0 },
                    { x: p.x + w / 2, y: p.y },
                    { x: p.x - w / 2, y: p.y },
                ];
                // One fill per bar: bars at the same x must not cancel out (fills are even-odd).
                const shown = p.y !== 0 ? clipRing(ring, ctx.view) : null;
                if (shown) out.fills.push({ rings: [shown], color, opacity, pattern: 'solid' });
                outlines.push(ring);
            }
            if (outlines.length) out.strokes.push({ lines: outlines, color, width, dashed: false, closed: true, exact: true });
            break;
        }
        case 'line': {
            const line = pts.map((p, i) => ({ p, i })).sort((a, b) => a.p.x - b.p.x || a.i - b.i).map((e) => e.p);
            if (line.length >= 2) out.strokes.push({ lines: [line], color, width, dashed, exact: true });
            break;
        }
        case 'regression': {
            if (!pts.length) break;
            const r = leastSquares(pts.map((p) => [p.x, p.y]));
            if (!r) {
                addIssue(out, t.name, undefined, msg('beyond.problem.regressionTwoPoints'), 'info');
                break;
            }
            const xs = pts.map((p) => p.x);
            const x0 = Math.min(...xs);
            const x1 = Math.max(...xs);
            const line = [
                { x: x0, y: r.m * x0 + r.b },
                { x: x1, y: r.m * x1 + r.b },
            ];
            out.strokes.push({ lines: [line], color, width, dashed, exact: true });
            if (label || t.valueLabel) {
                const { p, dir } = labelSpot(line, ctx.view, false);
                const spec = { x: p.x, y: p.y, template: 'label' as const, locals: { m: r.m, b: r.b, r2: r.r2, n: r.n }, color, size: 'small' as const, dir: towardCenter(p, dir, ctx.view), slide: line };
                out.texts.push(label ? spec : { ...spec, literal: regressionLabel(r) });
            }
            break;
        }
        default: {
            const size: MarkerSize = t.size === 'small' || t.size === 'large' ? t.size : 'normal';
            pts.forEach((p) => out.markers.push({ x: p.x, y: p.y, color, size }));
            if (label || t.valueLabel) {
                // Their coordinates, unless a label of its own says otherwise.
                pts.forEach((p, i) => {
                    const spec = { x: p.x, y: p.y, template: 'label' as const, part: i, locals: { x: p.x, y: p.y, i: i + 1 }, color, size: 'small' as const, dir: UP_RIGHT, marker: size };
                    out.texts.push(label ? spec : { ...spec, literal: `(${decimal(p.x, 3)}, ${decimal(p.y, 3)})` });
                });
            }
        }
    }
    return out;
}

// ------------------------------------------------------------ distribution

function computeDistribution(t: DistributionTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const { view } = ctx;
    const color = str(t.color) || 'blue';
    const kind = kindOf(t.kind);
    /** The bars of P(X = k), those too small to see left out. */
    const bars = (pmf: number[]) => {
        const peak = Math.max(...pmf);
        const rings: Pt[][] = [];
        pmf.forEach((h, k) => {
            if (!(h > peak * 1e-9)) return;
            rings.push(bar(k, h));
        });
        const opacity = Number.isFinite(t.fillOpacity) ? t.fillOpacity : 0.35;
        const shown = inView(rings, view);
        if (shown.length) out.fills.push({ rings: shown, color, opacity, pattern: 'solid' });
        if (rings.length) out.strokes.push({ lines: rings, color, width: str(t.thickness) || 'thin', dashed: false, closed: true, exact: true });
    };
    if (kind === 'binomial') {
        const n = fieldValue(str(t.n), 'n', t.name, ctx, out);
        const p = fieldValue(str(t.p), 'p', t.name, ctx, out);
        if (n === null || p === null) return out;
        if (Math.abs(n - Math.round(n)) > 1e-9 || n < 0 || n > MAX_TRIALS) return fail(out, t.name, 'n', msg('beyond.problem.trials', { max: MAX_TRIALS }));
        if (!(p >= 0 && p <= 1)) return fail(out, t.name, 'p', msg('beyond.problem.successProbability'));
        const pmf = binomialPmf(Math.round(n), p);
        out.beyond = { distribution: { kind: 'binomial', n: Math.round(n), p, pmf } };
        bars(pmf);
        return out;
    }
    // 6.2.1: Poisson bars.
    if (kind === 'poisson') {
        const lambda = fieldValue(str(t.lambda), 'lambda', t.name, ctx, out);
        if (lambda === null) return out;
        if (!(lambda > 0 && lambda <= MAX_LAMBDA)) return fail(out, t.name, 'lambda', msg('beyond.problem.lambdaRange', { max: MAX_LAMBDA }));
        const pmf = poissonPmf(lambda);
        out.beyond = { distribution: { kind: 'poisson', lambda, pmf } };
        bars(pmf);
        return out;
    }
    // 6.2.1: the densities of the other kinds.
    if (kind !== 'normal') {
        const values = new Map<DistributionField, number>();
        for (const f of KIND_FIELDS[kind]) {
            const v = fieldValue(str(t[f]), f, t.name, ctx, out);
            if (v === null) return out;
            values.set(f, v);
        }
        const d = densityFor(kind, (f) => values.get(f) ?? NaN);
        if (isBadParameter(d)) return fail(out, t.name, d.field, msg(d.message, d.values));
        out.beyond = { distribution: { kind: 'density', density: d } };
        const lines = densityCurve(d, view.xmin, view.xmax, view);
        if (lines.length) out.strokes.push({ lines, color, width: str(t.thickness) || 'thin', dashed: !!t.dashed });
        return out;
    }
    const mean = fieldValue(str(t.mean), 'mean', t.name, ctx, out);
    const sd = fieldValue(str(t.sd), 'sd', t.name, ctx, out);
    if (mean === null || sd === null) return out;
    if (!(sd > 0)) return fail(out, t.name, 'sd', msg('beyond.problem.sdPositive'));
    out.beyond = { distribution: { kind: 'normal', mean, sd } };
    const line = densityLine(mean, sd, view.xmin, view.xmax);
    if (line.length >= 2) out.strokes.push({ lines: [line], color, width: str(t.thickness) || 'thin', dashed: !!t.dashed });
    return out;
}

/** A binomial bar at k with height h. */
function bar(k: number, h: number): Pt[] {
    const w = BINOMIAL_BAR / 2;
    return [
        { x: k - w, y: 0 },
        { x: k + w, y: 0 },
        { x: k + w, y: h },
        { x: k - w, y: h },
    ];
}

/** The normal density over [a, b]: evenly over the span, and closely around the mean so a narrow peak keeps its top. */
function densityLine(mean: number, sd: number, a: number, b: number): Pt[] {
    if (!(b > a)) return [];
    const xs: number[] = [];
    for (let i = 0; i <= 400; i++) xs.push(a + ((b - a) * i) / 400);
    for (let i = -160; i <= 160; i++) {
        const x = mean + (sd * i) / 40;
        if (x > a && x < b) xs.push(x);
    }
    xs.sort((u, v) => u - v);
    const pts: Pt[] = [];
    for (const x of xs) {
        if (pts.length && x - pts[pts.length - 1].x < 1e-12 * (b - a)) continue;
        pts.push({ x, y: normalPdf(x, mean, sd) });
    }
    return pts;
}

/** Samples of a density curve over [a, b] past which it is cut: this many view heights above the view. */
const CURVE_HEADROOM = 1;

/**
 * 6.2.1: the x values a density is sampled at over [a, b] (within its
 * support): evenly, closely around its middle, and closer and closer to an
 * end of the support where the density may shoot up (chi-square with
 * df < 2 at 0) or jump (the uniform distribution's sides, drawn upright).
 */
function densityXs(d: Density, a: number, b: number): number[] {
    const lo = Math.max(a, d.lo);
    const hi = Math.min(b, d.hi);
    if (!(hi > lo)) return [];
    const xs: number[] = [];
    for (let i = 0; i <= 400; i++) xs.push(lo + ((hi - lo) * i) / 400);
    const span = b - a;
    for (let i = -80; i <= 80; i++) {
        const x = d.mid + (span * i) / 1600;
        if (x > lo && x < hi) xs.push(x);
    }
    // Towards an end of the support inside the range: 1e-1 .. 1e-9 of the span from it.
    for (const edge of [d.lo, d.hi]) {
        if (!(edge >= lo && edge <= hi)) continue;
        const inward = edge === d.lo ? 1 : -1;
        for (let k = 1; k <= 36; k++) {
            const x = edge + inward * span * Math.pow(10, -k / 4);
            if (x > lo && x < hi) xs.push(x);
        }
    }
    xs.sort((u, v) => u - v);
    const out: number[] = [];
    for (const x of xs) if (!out.length || x - out[out.length - 1] >= 1e-12 * span) out.push(x);
    return out;
}

/**
 * 6.2.1: a density as polylines over [a, b]: cut where it runs more than a
 * view height above the view (a pole), and for the uniform distribution
 * with its upright sides, a box on the x-axis.
 */
function densityCurve(d: Density, a: number, b: number, view: SceneCtx['view']): Pt[][] {
    const top = view.ymax + CURVE_HEADROOM * (view.ymax - view.ymin);
    const xs = densityXs(d, a, b);
    if (!xs.length) return [];
    const pts: Pt[] = xs.map((x) => ({ x, y: d.pdf(x) }));
    // A density that is not 0 at an end of its support (the uniform one, the exponential at 0) stands on the x-axis there.
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first.x === d.lo && Number.isFinite(first.y) && first.y > 0) pts.unshift({ x: first.x, y: 0 });
    if (last.x === d.hi && Number.isFinite(last.y) && last.y > 0) pts.push({ x: last.x, y: 0 });
    return cutAbove(pts, top);
}

/** A polyline cut where it runs above `top` (or has no value): the pieces below it, each crossing ending on `top`. */
function cutAbove(pts: Pt[], top: number): Pt[][] {
    const lines: Pt[][] = [];
    let cur: Pt[] = [];
    const end = () => {
        if (cur.length >= 2) lines.push(cur);
        cur = [];
    };
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const inside = Number.isFinite(p.y) && p.y <= top;
        const prev = i > 0 ? pts[i - 1] : null;
        const prevInside = !!prev && Number.isFinite(prev.y) && prev.y <= top;
        if (inside) {
            // Coming down from above: start on the cut.
            if (prev && !prevInside && Number.isFinite(prev.y)) cur.push({ x: prev.x + ((p.x - prev.x) * (prev.y - top)) / (prev.y - p.y), y: top });
            else if (prev && !prevInside) cur.push({ x: p.x, y: top });
            cur.push(p);
        } else if (prevInside && prev) {
            // Going up and out: end on the cut.
            cur.push(Number.isFinite(p.y) ? { x: prev.x + ((p.x - prev.x) * (top - prev.y)) / (p.y - prev.y), y: top } : { x: prev.x, y: top });
            end();
        }
    }
    end();
    return lines;
}

// ------------------------------------------------------------- probability

/** The distribution a probability shades; null (with the problem) when it cannot. */
function distributionOf(t: ProbabilityTool, ctx: SceneCtx, out: SceneOutput): DistributionData | null {
    const name = str(t.distribution).trim();
    if (!name) {
        fail(out, t.name, 'distribution', msg('beyond.problem.chooseDistribution'));
        return null;
    }
    const tool = ctx.toolsByName.get(name);
    if (!tool) {
        fail(out, t.name, 'distribution', msg('problems.scene.doesNotExist', { name }));
        return null;
    }
    if (tool.type !== 'distribution') {
        fail(out, t.name, 'distribution', msg('beyond.problem.notDistribution', { name }));
        return null;
    }
    const prod = ctx.outputs.get(name);
    const dist = prod && !prod.failed ? prod.beyond?.distribution : undefined;
    if (!dist) {
        if (!prod || prod.failed) fail(out, t.name, 'distribution', msg('problems.scene.hasError', { name }));
        return null;
    }
    return dist;
}

function computeProbability(t: ProbabilityTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const src = str(t.event);
    if (!src.trim()) return out;
    const dist = distributionOf(t, ctx, out);
    if (!dist) return out;
    const distName = str(t.distribution).trim();
    const { math, view } = ctx;
    // The variable: the distribution's name, or a name the chart has no value for (X).
    const e = readEvent(src, (name) => name === distName || !math.tryValue(name).ok);
    if (!e) return fail(out, t.name, 'event', msg('beyond.problem.eventTakes'));
    const values: number[] = [];
    for (let k = 0; k < e.parts.length; k++) {
        if (k === e.variable) {
            values.push(NaN);
            continue;
        }
        const v = fieldValue(e.parts[k], 'event', t.name, ctx, out);
        if (v === null) return out;
        values.push(v);
    }
    const b = eventBounds(e, values);
    const color = str(t.color) || 'orange';
    const opacity = Number.isFinite(t.fillOpacity) ? t.fillOpacity : 0.5;
    const pattern = t.fillPattern || 'solid';
    let p: number;
    let spot: Pt;
    if (dist.kind === 'normal') {
        p = b.equal !== undefined ? 0 : normalProbability(b.lo, b.hi, dist.mean, dist.sd);
        const lo = Math.max(b.lo, view.xmin);
        const hi = Math.min(b.hi, view.xmax);
        if (b.equal === undefined && hi > lo) {
            const top = densityLine(dist.mean, dist.sd, lo, hi);
            const shown = inView([[{ x: lo, y: 0 }, ...top, { x: hi, y: 0 }]], view);
            if (shown.length) out.fills.push({ rings: shown, color, opacity, pattern });
        }
        const mid = b.equal !== undefined ? b.equal : hi > lo ? (lo + hi) / 2 : Number.isFinite(b.lo) ? b.lo : b.hi;
        spot = { x: mid, y: normalPdf(mid, dist.mean, dist.sd) };
    } else if (dist.kind === 'density') {
        // 6.2.1: the area under the density of a t, chi-square, exponential, uniform, gamma or beta distribution.
        const d = dist.density;
        p = b.equal !== undefined ? 0 : densityProbability(d, b.lo, b.hi);
        const lo = Math.max(b.lo, view.xmin, d.lo);
        const hi = Math.min(b.hi, view.xmax, d.hi);
        if (b.equal === undefined && hi > lo) {
            const top = view.ymax + CURVE_HEADROOM * (view.ymax - view.ymin);
            const curve = densityXs(d, lo, hi).map((x) => ({ x, y: Math.min(top, d.pdf(x)) }));
            const ring = [{ x: lo, y: 0 }, ...curve.filter((q) => Number.isFinite(q.y)), { x: hi, y: 0 }];
            const shown = inView([ring], view);
            if (shown.length) out.fills.push({ rings: shown, color, opacity, pattern });
        }
        const mid = b.equal !== undefined ? b.equal : hi > lo ? (lo + hi) / 2 : Number.isFinite(b.lo) ? b.lo : b.hi;
        // Over a pole (chi-square with df < 2 near 0) the label stays inside the view.
        const y = d.pdf(mid);
        spot = { x: mid, y: Number.isFinite(y) ? Math.min(y, view.ymin + 0.85 * (view.ymax - view.ymin)) : view.ymin + 0.85 * (view.ymax - view.ymin) };
    } else {
        // The bars in range: binomial, and (6.2.1) Poisson.
        const n = dist.pmf.length - 1;
        let kmin = b.lo === -Infinity ? 0 : b.loStrict ? Math.floor(b.lo) + 1 : Math.ceil(b.lo - 1e-9);
        let kmax = b.hi === Infinity ? n : b.hiStrict ? Math.ceil(b.hi) - 1 : Math.floor(b.hi + 1e-9);
        kmin = Math.max(0, kmin);
        kmax = Math.min(n, kmax);
        p = 0;
        const rings: Pt[][] = [];
        for (let k = kmin; k <= kmax; k++) {
            p += dist.pmf[k];
            if (dist.pmf[k] > 0) rings.push(bar(k, dist.pmf[k]));
        }
        p = Math.min(1, p);
        const shown = inView(rings, view);
        if (shown.length) out.fills.push({ rings: shown, color, opacity, pattern });
        // 6.2.1: Poisson bars run on to the right: a label over the bars that can be seen, inside the view.
        let last = kmax;
        if (dist.kind === 'poisson') {
            const peak = Math.max(...dist.pmf);
            let seen = dist.pmf.length - 1;
            while (seen > 0 && dist.pmf[seen] < peak / POISSON_SEEN) seen--;
            last = Math.max(kmin, Math.min(kmax, seen, Math.floor(view.xmax)));
        }
        const k = kmax >= kmin ? Math.round((kmin + last) / 2) : Math.min(n, Math.max(0, Math.round(Number.isFinite(b.lo) ? b.lo : b.hi)));
        spot = { x: k, y: dist.pmf[k] ?? 0 };
    }
    out.derived[`${t.name}_val`] = p;
    const label = str(t.label).trim();
    if ((label || t.valueLabel) && Number.isFinite(spot.x) && Number.isFinite(spot.y)) {
        const spec = { x: spot.x, y: spot.y, template: 'label' as const, locals: { p }, color, size: 'small' as const, dir: { x: 0, y: 1 } };
        out.texts.push(label ? spec : { ...spec, literal: eventLabel(e, values, probabilityText(p)) });
    }
    return out;
}

// ------------------------------------------------------------- Riemann sum

/** The symbol of each method in a label: L_6, R_6, M_6, T_6. */
const SUM_SYMBOL: Record<RiemannTool['method'], string> = { left: 'L', right: 'R', middle: 'M', trapezoid: 'T' };

function computeRiemann(t: RiemannTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const name = str(t.function).trim();
    if (!name) return fail(out, t.name, 'function', msg('beyond.problem.chooseFunction'));
    const info = ctx.math.functionInfo(name);
    if (!info) return fail(out, t.name, 'function', msg('problems.scene.doesNotExist', { name }));
    if (info.kind !== 'cartesian') return fail(out, t.name, 'function', msg('beyond.problem.notCartesian', { name }));
    if (info.error || info.domainError) return fail(out, t.name, 'function', msg('problems.scene.hasError', { name }));
    const a = fieldValue(str(t.from), 'from', t.name, ctx, out);
    const b = fieldValue(str(t.to), 'to', t.name, ctx, out);
    const count = fieldValue(str(t.parts), 'parts', t.name, ctx, out);
    if (a === null || b === null || count === null) return out;
    const n = Math.round(count);
    if (!(n >= 1 && n <= MAX_PARTS)) return fail(out, t.name, 'parts', msg('beyond.problem.parts', { max: MAX_PARTS }));
    if (!(b > a)) return fail(out, t.name, 'to', msg('beyond.problem.fromBelowTo'));
    const method = t.method === 'right' || t.method === 'middle' || t.method === 'trapezoid' ? t.method : 'left';
    const { parts, sum } = riemannSum(info.fn, a, b, n, method);
    const color = str(t.color) || 'orange';
    const rings = parts.map((p) => [
        { x: p.x0, y: 0 },
        { x: p.x1, y: 0 },
        { x: p.x1, y: p.y1 },
        { x: p.x0, y: p.y0 },
    ]);
    // Parts touch but never overlap: one even-odd fill holds them all.
    const shown = inView(rings, ctx.view);
    if (shown.length) out.fills.push({ rings: shown, color, opacity: Number.isFinite(t.fillOpacity) ? t.fillOpacity : 0.35, pattern: 'solid' });
    if (rings.length) out.strokes.push({ lines: rings, color, width: str(t.thickness) || 'thin', dashed: false, closed: true, exact: true });
    if (parts.length < n) addIssue(out, t.name, 'function', msg('beyond.problem.noValueSomewhere', { name }), 'info');
    out.derived[`${t.name}_val`] = sum;
    const label = str(t.label).trim();
    if (label || t.valueLabel) {
        const exact = integral(info.fn, a, b);
        const top = parts.reduce((m, p) => Math.max(m, p.y0, p.y1), 0);
        const spec = { x: (a + b) / 2, y: top, template: 'label' as const, locals: { sum, exact, n }, color, size: 'small' as const, dir: { x: 0, y: 1 } };
        if (label) out.texts.push(spec);
        else {
            let text = `$${SUM_SYMBOL[method]}_{${n}} = ${decimal(sum, 3)}$`;
            if (Number.isFinite(exact) && Number.isFinite(sum)) text += `, $\\int_{${decimal(a, 3)}}^{${decimal(b, 3)}} ${name}(x)\\,dx = ${decimal(exact, 3)}$`;
            out.texts.push({ ...spec, literal: text });
        }
    }
    return out;
}

// -------------------------------------------------------------- slope field

/**
 * Units of the plot in pt per math unit, x and y: from the figure's plot
 * size (label metrics), the same in both directions when the chart has equal
 * scale. The preview has the figure's shape, so a length in pt is the same
 * on screen and on paper.
 */
function plotUnits(ctx: SceneCtx): { ux: number; uy: number } {
    const { view } = ctx;
    const m = ctx.metrics;
    const w = m && m.w > 0 ? m.w : 250;
    const h = m && m.h > 0 ? m.h : 250;
    let ux = w / (view.xmax - view.xmin);
    let uy = h / (view.ymax - view.ymin);
    if (ctx.equalScale) ux = uy = Math.min(ux, uy);
    return { ux, uy };
}

function computeSlopeField(t: SlopeFieldTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const src = str(t.expression);
    if (!src.trim()) return out;
    let f: (x: number, y: number) => number;
    try {
        f = ctx.math.fn2(src);
    } catch (e) {
        return fail(out, t.name, 'expression', errorText(e));
    }
    out.beyond = { field: f };
    const { view } = ctx;
    const { ux, uy } = plotUnits(ctx);
    const wPt = (view.xmax - view.xmin) * ux;
    const hPt = (view.ymax - view.ymin) * uy;
    const density = Number.isFinite(t.density) ? Math.min(60, Math.max(4, Math.round(t.density))) : 20;
    const cell = Math.max(wPt, hPt) / density;
    const nx = Math.max(1, Math.round(wPt / cell));
    const ny = Math.max(1, Math.round(hPt / cell));
    // Every segment is this long in pt, so they all look the same length.
    const half = (SEGMENT_SHARE * Math.min(wPt / nx, hPt / ny)) / 2;
    const lines: Pt[][] = [];
    for (let i = 0; i < nx; i++) {
        const x = view.xmin + ((i + 0.5) * (view.xmax - view.xmin)) / nx;
        for (let j = 0; j < ny; j++) {
            const y = view.ymin + ((j + 0.5) * (view.ymax - view.ymin)) / ny;
            const s = f(x, y);
            let dx: number;
            let dy: number;
            if (Number.isFinite(s)) {
                // The direction (1, s) in pt is (ux, s uy): half a segment along it, back in math units.
                const len = Math.hypot(ux, s * uy);
                dx = half / len;
                dy = (half * s) / len;
            } else if (s === Infinity || s === -Infinity) {
                dx = 0;
                dy = half / uy;
            } else continue;
            lines.push([
                { x: x - dx, y: y - dy },
                { x: x + dx, y: y + dy },
            ]);
        }
    }
    if (lines.length) out.strokes.push({ lines, color: str(t.color) || 'gray', width: str(t.thickness) || 'thin', dashed: false, exact: true });
    return out;
}

// ---------------------------------------------------------------- solution

/** The points a solution goes through: points and points tools' points; null (with the problem) when it cannot. */
function startPoints(t: SolutionTool, ctx: SceneCtx, out: SceneOutput): Pt[] | null {
    const src = str(t.through);
    let entries: ReturnType<SceneCtx['math']['path']>;
    try {
        entries = ctx.math.path(src, 2);
    } catch (e) {
        if (ctx.math.validate(src, 'path2').ok) addIssue(out, t.name, 'through', errorText(e), 'info');
        else fail(out, t.name, 'through', errorText(e));
        return null;
    }
    const pts: Pt[] = [];
    for (const entry of entries) {
        if ('point' in entry) {
            pts.push({ x: entry.point[0], y: entry.point[1] });
            continue;
        }
        const tool = ctx.toolsByName.get(entry.name);
        if (!tool || tool.type !== 'points' || tool.dim === 3) {
            fail(out, t.name, 'through', msg('problems.math.notPointsTool', { name: entry.name }));
            return null;
        }
        const prod = ctx.outputs.get(entry.name);
        if (!prod || !prod.points) {
            fail(out, t.name, 'through', msg('problems.scene.hasError', { name: entry.name }));
            return null;
        }
        for (const p of prod.points) pts.push({ x: p[0], y: p[1] });
    }
    return pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function computeSolution(t: SolutionTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const name = str(t.field).trim();
    if (!name) return fail(out, t.name, 'field', msg('beyond.problem.chooseField'));
    const tool = ctx.toolsByName.get(name);
    if (!tool) return fail(out, t.name, 'field', msg('problems.scene.doesNotExist', { name }));
    if (tool.type !== 'slopeField') return fail(out, t.name, 'field', msg('beyond.problem.notField', { name }));
    const prod = ctx.outputs.get(name);
    const f = prod && !prod.failed ? prod.beyond?.field : undefined;
    if (!f) {
        if (!prod || prod.failed) return fail(out, t.name, 'field', msg('problems.scene.hasError', { name }));
        return out;
    }
    if (!str(t.through).trim()) return out;
    const starts = startPoints(t, ctx, out);
    if (!starts) return out;
    const { view } = ctx;
    const height = view.ymax - view.ymin;
    // Steeper than this it is vertical on screen: y(x) ends there (a circle's solution at the x-axis).
    const { ux, uy } = plotUnits(ctx);
    const box = {
        xmin: view.xmin,
        xmax: view.xmax,
        ylo: view.ymin - SOLUTION_MARGIN * height,
        yhi: view.ymax + SOLUTION_MARGIN * height,
        maxSlope: (STEEP * ux) / uy,
    };
    const lines: Pt[][] = [];
    for (const p of starts) {
        const line = solveOde(f, p.x, p.y, box, (view.xmax - view.xmin) / SOLUTION_STEPS, height / SOLUTION_STEPS);
        if (line.length >= 2) lines.push(line);
    }
    if (lines.length) out.strokes.push({ lines, color: str(t.color) || 'red', width: str(t.thickness) || 'thick', dashed: !!t.dashed });
    return out;
}
