/*
 * Auto-fit: axis ranges that show everything a chart draws, with ends a
 * person would pick (`-25`, `0`, `1.2`). The Chart tab's Auto-fit and the
 * preview's fit button run it (src/modal.ts). Pure: no DOM, no Obsidian.
 *
 * fitAxis holds the rules for one axis; fitChart gathers what a chart draws
 * and fits each axis with it:
 * - 2D: functions (cartesian over their domain, or over the x range when
 *   they have none; parametric and polar over their parameter range),
 *   points (listed and computed: intersections, corners, optima), labels,
 *   segments, arrows, polylines, braces, and the regions and implicit curves
 *   that are bounded. A visible cartesian function without a domain goes on
 *   forever: x then stays as it is and only y is fitted, to what lies over
 *   the x range.
 * - 3D: x and y from the surfaces' domains (the view where a surface has
 *   none), z from the surface values, plus points, segment ends, planes at a
 *   value and labels. No padding: the box ends at the data, rounded outward.
 */
import type { Annotation, AxisStyle, Function3DParameters, FunctionParameters, Tool } from './types';
import type { MathContext } from './mathcontext';
import type { Pt, View } from './geometry';
import type { Scene2D, SceneItem2D } from './scene';
import type { SettingsManager } from './settings';
import { computeScene2D, computeScene3D } from './scene';

// ------------------------------------------------------------------ rules

/** A sampled curve is cut to its 1st / 99th percentile only when its whole range is more than this many times wider (an asymptote). */
const CUT_RATIO = 3;
const CUT_FRACTION = 0.01;
/** A low end above 0 by less than this fraction of the span becomes 0 (a high end below 0 likewise). */
const ZERO_PULL = 0.15;
/** A range whose |lo + hi| is below this fraction of the span becomes -m..m. */
const SYMMETRY = 0.12;
/** 2D padding on each side, a fraction of the span. */
const PAD = 0.05;
/** The ends are rounded outward to multiples of niceStep(span / STEPS). */
const STEPS = 20;
/** The multiples of a power of ten a step may be. */
const NICE = [1, 2, 2.5, 5, 10];
/** Relative slack for comparing numbers that went through float arithmetic. */
const REL = 1e-9;

/** What one axis has to show. */
export interface AxisData {
    /**
     * Sampled curves or surfaces, one list per curve: each is cut to its
     * 1st / 99th percentile when the rest runs off to an asymptote.
     */
    samples?: number[][];
    /** Values that are always shown: points, labels, segment ends, bounded regions and curves. */
    exact?: number[];
    /** Ends set exactly by a function's domain: an end there gets no padding. */
    hard?: number[];
}

export interface AxisFit {
    min: number;
    max: number;
    /** The grid the ends were rounded to. */
    step: number;
    /** The ends as the range fields take them: '-25', '1.25', '0'. */
    text: [string, string];
}

/** `v` without the float noise of the arithmetic that made it (2.5 * 0.1 -> 0.25). */
function clean(v: number): number {
    return Number(v.toPrecision(12));
}

/** 1, 2, 2.5, 5 or 10 times a power of ten: the smallest that is at least `raw`. */
export function niceStep(raw: number): number {
    if (!(raw > 0) || !Number.isFinite(raw)) return 1;
    const e = Math.floor(Math.log10(raw));
    // From one power lower: log10 may land just beside an exact power of ten.
    for (let k = e - 1; k <= e + 1; k++) {
        for (const m of NICE) {
            const step = clean(m * Math.pow(10, k));
            if (step >= raw * (1 - REL)) return step;
        }
    }
    return clean(Math.pow(10, e + 2));
}

/** Decimals that write `step` exactly: 0.25 -> 2, 0.5 -> 1, 5 -> 0. */
export function stepDecimals(step: number): number {
    for (let d = 0; d < 15; d++) {
        const scaled = step * Math.pow(10, d);
        if (Math.abs(scaled - Math.round(scaled)) <= REL * Math.max(1, Math.abs(scaled))) return d;
    }
    return 15;
}

/** A number as a range field takes it: no exponent, no float noise, no trailing zeros ('-25', '1.25', '0'). */
export function boundText(value: number, decimals: number): string {
    let s = value.toFixed(Math.max(0, Math.min(20, decimals)));
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
}

/**
 * The range of one sampled curve: the whole range, or the 1st to 99th
 * percentile when the whole range is more than three times that (a real
 * asymptote such as 1/x near 0 or tan x). A peak is never clipped.
 */
export function sampleRange(values: number[]): [number, number] | null {
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    const drop = Math.floor(sorted.length * CUT_FRACTION);
    const cutLo = sorted[drop];
    const cutHi = sorted[sorted.length - 1 - drop];
    const cut = cutHi - cutLo;
    if (cut > 0 && hi - lo > CUT_RATIO * cut) return [cutLo, cutHi];
    return [lo, hi];
}

/** The range an axis has to show before the rules: every sampled curve (cut at an asymptote) and every exact value. */
export function dataRange(data: AxisData): [number, number] | null {
    let lo = Infinity;
    let hi = -Infinity;
    for (const values of data.samples || []) {
        const r = sampleRange(values);
        if (!r) continue;
        lo = Math.min(lo, r[0]);
        hi = Math.max(hi, r[1]);
    }
    for (const v of data.exact || []) {
        if (!Number.isFinite(v)) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
    }
    return lo <= hi ? [lo, hi] : null;
}

/**
 * Fit one axis. From the data range:
 * 1. all values equal: widened by 1 on each side (10 % of the value when that is more);
 * 2. a low end above 0 by less than 15 % of the span moves to 0, a high end below 0 likewise;
 * 3. |lo + hi| below 12 % of the span: -m..m with m the larger end;
 * 4. `pad` (2D): 5 % of the span on each side, except at an end that is 0 and at a hard end;
 * 5. the ends are rounded outward to multiples of niceStep(span / 20), without float noise.
 * Null when there is nothing to show.
 */
export function fitAxis(data: AxisData, opts: { pad: boolean }): AxisFit | null {
    const range = dataRange(data);
    if (!range) return null;
    let [lo, hi] = range;
    const hard = (data.hard || []).filter((v) => Number.isFinite(v));
    const same = (a: number, b: number) => Math.abs(a - b) <= REL * Math.max(1, Math.abs(a), Math.abs(b));
    const isHard = (v: number) => hard.some((h) => same(h, v));
    let loHard = isHard(lo);
    let hiHard = isHard(hi);

    if (same(lo, hi)) {
        const mid = (lo + hi) / 2;
        const d = Math.max(1, 0.1 * Math.abs(mid));
        lo = mid - d;
        hi = mid + d;
        loHard = hiHard = false;
    }
    let span = hi - lo;
    // Float noise around 0 (a fill's edge at -1e-17) is 0.
    if (Math.abs(lo) <= REL * span) lo = 0;
    if (Math.abs(hi) <= REL * span) hi = 0;
    if (lo > 0 && lo < ZERO_PULL * span) lo = 0;
    else if (hi < 0 && -hi < ZERO_PULL * span) hi = 0;
    span = hi - lo;
    if (Math.abs(lo + hi) < SYMMETRY * span) {
        const m = Math.max(-lo, hi);
        // Both ends mirror the larger one: they are hard only when every end that reaches m is.
        const hardEnd = (!same(-lo, m) || loHard) && (!same(hi, m) || hiHard);
        lo = -m;
        hi = m;
        loHard = hiHard = hardEnd;
    }
    span = hi - lo;
    if (opts.pad) {
        if (lo !== 0 && !loHard) lo -= PAD * span;
        if (hi !== 0 && !hiHard) hi += PAD * span;
    }
    const step = niceStep((hi - lo) / STEPS);
    const decimals = stepDecimals(step);
    const outward = (q: number, dir: 1 | -1) => {
        const slack = REL * Math.max(1, Math.abs(q));
        return dir < 0 ? Math.floor(q + slack) : Math.ceil(q - slack);
    };
    const min = tidy(outward(lo / step, -1) * step, decimals);
    const max = tidy(outward(hi / step, 1) * step, decimals);
    return { min, max, step, text: [boundText(min, decimals), boundText(max, decimals)] };
}

// ------------------------------------------------------------------ charts

/** Samples per function (2D) and per surface axis (3D). */
const SAMPLES_2D = 400;
const SAMPLES_3D = 40;
/** Marching-squares grid of the fit's scenes. */
const GRID = { nx: 300, ny: 300 };
/**
 * The window the fit computes regions, curves and computed points in: the
 * view and everything else grown by this many of its spans on each side. A
 * shape that still reaches the window's edge is computed once more in the
 * larger window before it counts as unbounded.
 */
const GROW = 1;
const GROW_MORE = 9;
/** A shape reaches the window's edge when it comes this close (a fraction of the window). */
const EDGE = 1e-6;

export interface FitInput {
    is3D: boolean;
    polar?: boolean;
    functions: FunctionParameters[];
    functions3D: Function3DParameters[];
    tools: Tool[];
    annotations: Annotation[];
    axisStyle?: AxisStyle;
    /** The chart's context, slider values set. Its derived values (P1_x, ...) are recomputed. */
    math: MathContext;
    /** The chart's current numeric view (settings.resolveView). */
    view: View & { zmin: number; zmax: number };
    /** Axes the fit may change (default all): a range written as an expression stays, and in 2D y is then fitted over the x range. */
    free?: { x?: boolean; y?: boolean; z?: boolean };
}

export interface FitResult {
    /** New ranges; an axis missing here keeps its range. */
    x?: AxisFit;
    y?: AxisFit;
    z?: AxisFit;
    /** Nothing to fit: 'empty' when nothing is drawn, 'unbounded' when everything drawn goes on forever (2D lines and half-planes). */
    nothing?: 'empty' | 'unbounded';
}

/** fitChart for the chart a SettingsManager holds (the editor and the tests). */
export function fitSettings(settings: SettingsManager, math: MathContext, free?: FitInput['free']): FitResult {
    const list = <T>(key: string): T[] => {
        const v = settings.getValue<unknown>(key);
        return Array.isArray(v) ? (v as T[]) : [];
    };
    const style = settings.getValue('axis_style');
    return fitChart({
        is3D: settings.getValue('dimension') === true,
        polar: settings.getValue('coordinateSystem') === 'polar',
        functions: list<FunctionParameters>('functions'),
        functions3D: list<Function3DParameters>('functions3D'),
        tools: list<Tool>('tools'),
        annotations: list<Annotation>('annotations'),
        axisStyle: style === 'middle' || style === 'axes' ? style : 'box',
        math,
        view: settings.resolveView(math).view,
        free,
    });
}

/** Fit the ranges to what the chart draws (see the top of this file). */
export function fitChart(input: FitInput): FitResult {
    return input.is3D ? fit3D(input) : fit2D(input);
}

function str(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
}

function tidy(value: number, decimals: number): number {
    const v = Number(value.toFixed(Math.max(0, Math.min(20, decimals))));
    return v === 0 ? 0 : v;
}

function finitePt(p: Pt): boolean {
    return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function newData(): { samples: number[][]; exact: number[]; hard: number[] } {
    return { samples: [], exact: [], hard: [] };
}

/** Bounding box of a view and some ranges per axis. */
function box(view: View, xs: Array<[number, number] | null>, ys: Array<[number, number] | null>): View {
    const out = { ...view };
    for (const r of xs) {
        if (!r) continue;
        out.xmin = Math.min(out.xmin, r[0]);
        out.xmax = Math.max(out.xmax, r[1]);
    }
    for (const r of ys) {
        if (!r) continue;
        out.ymin = Math.min(out.ymin, r[0]);
        out.ymax = Math.max(out.ymax, r[1]);
    }
    return out;
}

function grow(v: View, by: number): View {
    const dx = (v.xmax - v.xmin) * by;
    const dy = (v.ymax - v.ymin) * by;
    return { xmin: v.xmin - dx, xmax: v.xmax + dx, ymin: v.ymin - dy, ymax: v.ymax + dy };
}

function inside(p: Pt, v: View): boolean {
    const tx = REL * (v.xmax - v.xmin);
    const ty = REL * (v.ymax - v.ymin);
    return p.x >= v.xmin - tx && p.x <= v.xmax + tx && p.y >= v.ymin - ty && p.y <= v.ymax + ty;
}

/** Some point of the lines comes up to the edge of the window `w`: the shape was cut off there. */
function reachesEdge(lines: Pt[][], w: View): boolean {
    const tx = EDGE * (w.xmax - w.xmin);
    const ty = EDGE * (w.ymax - w.ymin);
    for (const line of lines) {
        for (const p of line) {
            if (p.x <= w.xmin + tx || p.x >= w.xmax - tx || p.y <= w.ymin + ty || p.y >= w.ymax - ty) return true;
        }
    }
    return false;
}

/** The y values where the polyline enters, crosses and leaves a <= x <= b (the ends of each piece inside). */
function clipYs(pts: Pt[], closed: boolean, a: number, b: number, out: number[]): void {
    const n = pts.length;
    if (n === 1) {
        if (finitePt(pts[0]) && pts[0].x >= a && pts[0].x <= b) out.push(pts[0].y);
        return;
    }
    const edges = closed && n > 2 ? n : n - 1;
    for (let k = 0; k < edges; k++) {
        const p = pts[k];
        const q = pts[(k + 1) % n];
        if (!finitePt(p) || !finitePt(q)) continue;
        let t0 = 0;
        let t1 = 1;
        const dx = q.x - p.x;
        if (dx === 0) {
            if (p.x < a || p.x > b) continue;
        } else {
            const ta = (a - p.x) / dx;
            const tb = (b - p.x) / dx;
            t0 = Math.max(t0, Math.min(ta, tb));
            t1 = Math.min(t1, Math.max(ta, tb));
            if (t0 > t1) continue;
        }
        out.push(p.y + (q.y - p.y) * t0, p.y + (q.y - p.y) * t1);
    }
}

/**
 * What a 2D chart shows, per axis. With a fixed x range only y is
 * collected, from the parts that lie over that range.
 */
class Collector2D {
    readonly x = newData();
    readonly y = newData();
    private readonly range: [number, number] | null;

    constructor(range: [number, number] | null) {
        if (!range) {
            this.range = null;
            return;
        }
        const slack = REL * (range[1] - range[0]);
        this.range = [range[0] - slack, range[1] + slack];
    }

    get fixed(): boolean {
        return this.range !== null;
    }

    point(p: Pt): void {
        if (!finitePt(p)) return;
        if (this.range) {
            if (p.x >= this.range[0] && p.x <= this.range[1]) this.y.exact.push(p.y);
            return;
        }
        this.x.exact.push(p.x);
        this.y.exact.push(p.y);
    }

    line(pts: Pt[], closed: boolean): void {
        if (this.range) clipYs(pts, closed, this.range[0], this.range[1], this.y.exact);
        else for (const p of pts) this.point(p);
    }

    /** A sampled cartesian function: its values, all over the x range already when x is fixed. */
    graph(xs: number[], ys: number[]): void {
        if (!this.range) this.x.samples.push(xs);
        this.y.samples.push(ys);
    }

    /** A sampled parametric or polar curve. */
    curve(pts: Pt[]): void {
        if (this.range) {
            const ys: number[] = [];
            clipYs(pts, false, this.range[0], this.range[1], ys);
            this.y.samples.push(ys);
            return;
        }
        const drawn = pts.filter(finitePt);
        this.x.samples.push(drawn.map((p) => p.x));
        this.y.samples.push(drawn.map((p) => p.y));
    }

    ranges(): { x: [number, number] | null; y: [number, number] | null } {
        return { x: dataRange(this.x), y: dataRange(this.y) };
    }
}

function blank(f: FunctionParameters): boolean {
    return !str(f.expression).trim() && !(f.parametric && str(f.expressionY).trim());
}

/** Tools as the fit computes them: no labels or drop lines, and every region filled so its extent shows. */
function fitTools(tools: Tool[]): Tool[] {
    return tools.map((t): Tool => {
        if (t.type === 'region') return { ...t, fill: true, outline: 'none', constraintLines: false, label: '', conditionLabels: [] };
        if (t.type === 'points') return { ...t, label: '', dropLines: false };
        if (t.type === 'curve' || t.type === 'segment') return { ...t, label: '' };
        return t;
    });
}

/** Region that draws something (a fill, an outline or its constraint lines). */
function regionDraws(t: Tool): boolean {
    return t.type === 'region' && (t.fill === true || t.outline === 'solid' || t.outline === 'dashed' || t.constraintLines === true);
}

/**
 * The shapes of a scene item whose extent depends on the window it was
 * computed in: function fills and region fills (closed rings), implicit
 * curves (polylines). A function's tangent runs across the window and is
 * left out (its point is a marker).
 */
function windowShapes(item: SceneItem2D, tool: Tool | undefined): { lines: Pt[][]; closed: boolean } | null {
    if (item.kind === 'function') return item.fills.length ? { lines: item.fills.flatMap((f) => f.rings), closed: true } : null;
    if (!tool) return null;
    if (tool.type === 'region') return regionDraws(tool) ? { lines: item.fills.flatMap((f) => f.rings), closed: true } : null;
    if (tool.type === 'curve') return { lines: item.strokes.flatMap((s) => s.lines).filter((l) => l.length > 0), closed: false };
    return null;
}

function itemKey(item: SceneItem2D): string {
    return `${item.kind}:${item.key}`;
}

function fit2D(input: FitInput): FitResult {
    const { math, view } = input;
    const free = input.free || {};
    const functions = Array.isArray(input.functions) ? input.functions : [];
    const infos = math.functions().filter((info) => {
        const f = functions[info.index];
        return !!f && !info.hidden && !info.error && !info.domainError && !blank(f);
    });
    // A cartesian function without a domain goes on forever: x stays, y is fitted over it.
    const xFixed = free.x === false || infos.some((info) => info.kind === 'cartesian' && !info.domain);
    const c = new Collector2D(xFixed ? [view.xmin, view.xmax] : null);

    for (const info of infos) {
        const fn = info.fn;
        if (info.kind === 'cartesian') {
            let [a, b] = info.domain || [view.xmin, view.xmax];
            if (xFixed) {
                a = Math.max(a, view.xmin);
                b = Math.min(b, view.xmax);
            }
            if (!(b >= a)) continue;
            const xs: number[] = [];
            const ys: number[] = [];
            for (let i = 0; i <= SAMPLES_2D; i++) {
                const x = i === SAMPLES_2D ? b : a + ((b - a) * i) / SAMPLES_2D;
                const y = fn(x);
                if (!Number.isFinite(y)) continue;
                xs.push(x);
                ys.push(y);
            }
            c.graph(xs, ys);
            if (info.domain && !xFixed) c.x.hard.push(info.domain[0], info.domain[1]);
            continue;
        }
        const [a, b] = info.domain || [0, 2 * Math.PI];
        const fy = info.fnY;
        if (info.kind === 'parametric' && !fy) continue;
        const pts: Pt[] = [];
        for (let i = 0; i <= SAMPLES_2D; i++) {
            const t = i === SAMPLES_2D ? b : a + ((b - a) * i) / SAMPLES_2D;
            if (fy) {
                pts.push({ x: fn(t), y: fy(t) });
            } else {
                const r = fn(t);
                pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
            }
        }
        c.curve(pts);
    }

    // Labels where they stand now (derived names as the preview computed them).
    for (const a of Array.isArray(input.annotations) ? input.annotations : []) {
        if (!a || a.hidden || !str(a.text).trim()) continue;
        c.point({ x: math.value(a.x), y: math.value(a.y) });
    }

    let unbounded = false;
    const tools = (Array.isArray(input.tools) ? input.tools : []).filter((t): t is Tool => !!t && typeof t === 'object');
    const decorated = infos.some((info) => {
        const f = functions[info.index];
        return info.kind === 'cartesian' && (f.fill || f.tangent || f.extrema);
    });
    if (tools.length || decorated) {
        const original = new Map<string, Tool>();
        for (const t of tools) original.set(str(t.id), t);
        const fitted = fitTools(tools);
        const sceneIn = (w: View): Scene2D =>
            computeScene2D({
                functions,
                tools: fitted,
                math,
                view: w,
                grid: { ...GRID },
                axisStyle: input.axisStyle || 'box',
                polar: !!input.polar,
            });
        const r = c.ranges();
        const core = box(view, [r.x], [r.y]);
        const near = grow(core, GROW);
        const scene = sceneIn(near);
        let far: Scene2D | null = null;
        const farScene = (): Scene2D => {
            if (!far) {
                far = sceneIn(grow(core, GROW_MORE));
                // Derived values (P1_x, ...) as the nearer window has them.
                math.setDerived(scene.derived);
            }
            return far;
        };

        // Shapes cut off at the edge of the window: once more in the larger window.
        const cut = new Set<string>();
        const computed: Array<{ key: string; p: Pt }> = [];
        for (const item of scene.items) {
            const tool = item.kind === 'tool' ? original.get(item.key) : undefined;
            if (item.kind === 'tool' && !tool) continue;
            const shapes = windowShapes(item, tool);
            if (shapes && shapes.lines.length) {
                if (!reachesEdge(shapes.lines, near)) for (const l of shapes.lines) c.line(l, shapes.closed);
                else cut.add(itemKey(item));
            }
            if (tool && tool.type === 'segment') {
                for (const s of item.strokes) for (const l of s.lines) c.line(l, !!s.closed);
                for (const b of item.braces) c.line([b.from, b.to], false);
            }
            for (const m of item.markers) {
                // Dimmed: the best point the window shows of an unbounded or outside optimum.
                if (m.dim) continue;
                if (!tool || (tool.type === 'points' && tool.source === 'list')) c.point(m);
                else if (tool.type === 'points' && tool.source !== 'lattice') computed.push({ key: item.key, p: { x: m.x, y: m.y } });
            }
        }
        if (cut.size) {
            const farWindow = grow(core, GROW_MORE);
            for (const item of farScene().items) {
                if (!cut.has(itemKey(item))) continue;
                const shapes = windowShapes(item, item.kind === 'tool' ? original.get(item.key) : undefined);
                if (shapes && shapes.lines.length && !reachesEdge(shapes.lines, farWindow)) for (const l of shapes.lines) c.line(l, shapes.closed);
                else unbounded = true;
            }
        }

        // Computed points: those over what the chart shows anyway, all of them when the larger window finds no more.
        if (computed.length) {
            const r2 = c.ranges();
            const shown = box(view, [r2.x], [r2.y]);
            const finite = new Set<string>();
            if (computed.some(({ p }) => !inside(p, shown))) {
                const count = (s: Scene2D) => {
                    const n = new Map<string, number>();
                    for (const item of s.items) if (item.kind === 'tool') n.set(item.key, item.markers.filter((m) => !m.dim).length);
                    return n;
                };
                const nearCount = count(scene);
                const farCount = count(farScene());
                for (const [key, n] of nearCount) if (farCount.get(key) === n) finite.add(key);
            }
            for (const { key, p } of computed) if (finite.has(key) || inside(p, shown)) c.point(p);
        }
    }

    const result: FitResult = {};
    if (!c.fixed) {
        const x = fitAxis(c.x, { pad: true });
        if (x) result.x = x;
    }
    const y = fitAxis(c.y, { pad: true });
    if (y) result.y = y;
    if (!result.x && !result.y) result.nothing = unbounded ? 'unbounded' : 'empty';
    return result;
}

function fit3D(input: FitInput): FitResult {
    const { math, view } = input;
    const axes = { x: newData(), y: newData(), z: newData() };
    const point = (x: number, y: number, z: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
        axes.x.exact.push(x);
        axes.y.exact.push(y);
        axes.z.exact.push(z);
    };
    const domain = (src: string, fallback: [number, number]): [number, number] => (str(src).trim() ? math.domain(src, fallback) : fallback);

    for (const s of Array.isArray(input.functions3D) ? input.functions3D : []) {
        if (!s || s.hidden || !str(s.expression).trim()) continue;
        let f: (x: number, y: number) => number;
        try {
            f = math.fn2(s.expression);
        } catch {
            // A broken surface draws nothing; the status chip says why.
            continue;
        }
        const [x0, x1] = domain(s.xDomain, [view.xmin, view.xmax]);
        const [y0, y1] = domain(s.yDomain, [view.ymin, view.ymax]);
        axes.x.exact.push(x0, x1);
        axes.y.exact.push(y0, y1);
        const zs: number[] = [];
        for (let i = 0; i <= SAMPLES_3D; i++) {
            const x = i === SAMPLES_3D ? x1 : x0 + ((x1 - x0) * i) / SAMPLES_3D;
            for (let j = 0; j <= SAMPLES_3D; j++) {
                const y = j === SAMPLES_3D ? y1 : y0 + ((y1 - y0) * j) / SAMPLES_3D;
                const z = f(x, y);
                if (Number.isFinite(z)) zs.push(z);
            }
        }
        axes.z.samples.push(zs);
    }

    const tools = (Array.isArray(input.tools) ? input.tools : []).filter((t): t is Tool => !!t && typeof t === 'object');
    const scene = computeScene3D({ tools, math, view });
    for (const p of scene.points) point(p.x, p.y, p.z);
    for (const s of scene.segments) {
        point(s.a[0], s.a[1], s.a[2]);
        point(s.b[0], s.b[1], s.b[2]);
    }
    for (const plane of scene.planes) if (Number.isFinite(plane.value)) axes[plane.axis].exact.push(plane.value);
    for (const a of Array.isArray(input.annotations) ? input.annotations : []) {
        if (!a || a.hidden || !str(a.text).trim()) continue;
        // A label without z (one from a 2D chart) sits on z = 0, as the preview draws it.
        point(math.value(a.x), math.value(a.y), str(a.z).trim() ? math.value(a.z) : 0);
    }

    const result: FitResult = {};
    for (const axis of ['x', 'y', 'z'] as const) {
        const fit = fitAxis(axes[axis], { pad: false });
        if (fit) result[axis] = fit;
    }
    if (!result.x && !result.y && !result.z) result.nothing = 'empty';
    return result;
}
