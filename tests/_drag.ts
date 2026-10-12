/*
 * Test context builder for the drag engine (SPEC3 6.1): a chart as the
 * modal would see it after a render (SettingsManager.fromJSON, the scene with
 * its handles, sampled function curves, the hit index, a 600 x 480 px plot),
 * plus helpers that drive a drag through prepareDrag + DragSession with a
 * straight pointer path and apply frames to the chart data like the modal.
 */
import { MathContext } from '../src/mathcontext';
import type { MathContextInput } from '../src/mathcontext';
import { SettingsManager } from '../src/settings';
import { computeScene2D } from '../src/scene';
import type { Scene2D, SceneItem2D } from '../src/scene';
import { marchingGrid, niceInterval, sampleCurve, tickValues } from '../src/util';
import { buildHitIndex } from '../src/drag/hits';
import { axisSliders, fieldText, resolveTarget, setFieldText } from '../src/drag/targets';
import type { ChartData } from '../src/drag/targets';
import { DragSession, prepareDrag } from '../src/drag/session';
import type { PreparedDrag } from '../src/drag/session';
import type { DrawnCurve } from '../src/renderer';
import type { AxisStyle, FunctionParameters } from '../src/types';
import type { DragCommit, DragContext, DragFrame, DragTarget, FieldRef, Gesture, Hit, Lock, Mods, Pt, View } from '../src/drag/types';

/** Curve samples per function, as the renderer draws them. */
const SAMPLES = 500;

export interface TestChart {
    settings: SettingsManager;
    data: ChartData;
    /** Rebuilt by `render()`; the drag context of the last render. */
    ctx: DragContext;
    scene: Scene2D;
    view: View;
    plot: { w: number; h: number };
    /** Re-render after the data changed (new math context, scene, curves, hits). */
    render(): DragContext;
}

export interface ChartOptions {
    /** Plot size in CSS px (default 600 x 480). */
    w?: number;
    h?: number;
    /** Equal units on both axes (letterboxed); default: the chart's equalScale setting. */
    equal?: boolean;
    mac?: boolean;
}

/** Chart JSON (any version) -> a test chart rendered once. */
export function makeChart(json: Record<string, unknown>, opts: ChartOptions = {}): TestChart {
    const settings = SettingsManager.fromJSON(json);
    const cfg = settings.toRendererConfig(settings.createMathContext({ memo: false }));
    const data: ChartData = {
        functions: cfg.functions,
        tools: cfg.tools,
        annotations: cfg.annotations,
        parameters: cfg.parameters,
    };
    const chart: TestChart = {
        settings,
        data,
        ctx: null as unknown as DragContext,
        scene: null as unknown as Scene2D,
        view: { xmin: cfg.xmin, xmax: cfg.xmax, ymin: cfg.ymin, ymax: cfg.ymax },
        plot: { w: 0, h: 0 },
        render: () => render(chart, cfg.axisStyle, cfg.variables, cfg.coordinateSystem === 'polar', opts.equal ?? cfg.equalScale, opts),
    };
    chart.render();
    return chart;
}

function render(chart: TestChart, axisStyle: AxisStyle, variables: string, polar: boolean, equal: boolean, opts: ChartOptions): DragContext {
    const { data, view } = chart;
    const input: MathContextInput = {
        parameters: data.parameters,
        functions: data.functions,
        polar,
        variables,
        toolNames: data.tools.map((t) => t.name).filter((n) => typeof n === 'string' && n.length > 0),
    };
    const math = new MathContext(input);
    const W = opts.w || 600;
    const H = opts.h || 480;
    const dx = view.xmax - view.xmin;
    const dy = view.ymax - view.ymin;
    let pw = W;
    let ph = H;
    if (equal || polar) {
        const s = Math.min(W / dx, H / dy);
        pw = dx * s;
        ph = dy * s;
    }
    chart.plot = { w: pw, h: ph };
    const scene = computeScene2D({
        functions: data.functions,
        tools: data.tools,
        math,
        view: { ...view },
        grid: marchingGrid(pw, ph, 1, 'full'),
        axisStyle,
        polar,
    });
    chart.scene = scene;
    const hiddenTools = new Set(data.tools.filter((t) => t.hidden).map((t) => t.name));
    const hiddenFns = new Set(data.functions.filter((f) => f.hidden).map((f) => f.name));
    const items: SceneItem2D[] = scene.items.filter((it) => (it.kind === 'tool' ? !hiddenTools.has(it.source) : !hiddenFns.has(it.source)));
    const curves: DrawnCurve[] = [];
    for (const info of math.functions()) {
        if (info.hidden || info.error || info.domainError) continue;
        const f = data.functions[info.index] as FunctionParameters | undefined;
        if (!f || !String(f.expression || '').trim()) continue;
        let lines;
        if (info.kind === 'cartesian') {
            const d = info.domain;
            const lo = d ? Math.max(d[0], view.xmin) : view.xmin;
            const hi = d ? Math.min(d[1], view.xmax) : view.xmax;
            lines = sampleCurve((x) => ({ x, y: info.fn(x) }), lo, hi, SAMPLES, view);
        } else {
            const [lo, hi] = info.domain || [0, 2 * Math.PI];
            const fy = info.fnY;
            lines =
                info.kind === 'parametric'
                    ? fy
                        ? sampleCurve((t) => ({ x: info.fn(t), y: fy(t) }), lo, hi, SAMPLES, view)
                        : []
                    : sampleCurve(
                          (t) => {
                              const r = info.fn(t);
                              return { x: r * Math.cos(t), y: r * Math.sin(t) };
                          },
                          lo,
                          hi,
                          SAMPLES,
                          view
                      );
        }
        curves.push({ name: info.name, index: info.index, kind: info.kind, lines });
    }
    const hits = buildHitIndex({ items, curves });
    const ranges = ['xmin', 'xmax', 'ymin', 'ymax'].map((k) => String(chart.settings.getValue(k) ?? ''));
    const ctx: DragContext = {
        functions: data.functions,
        tools: data.tools,
        annotations: data.annotations,
        parameters: data.parameters,
        math,
        mathInput: input,
        hits,
        map: { view: { ...view }, kx: pw / dx, ky: ph / dy },
        ticks: { x: tickValues(view.xmin, view.xmax, niceInterval(dx, 8)), y: tickValues(view.ymin, view.ymax, niceInterval(dy, 6)) },
        polar,
        axisSliders: axisSliders(ranges, math),
        keyNames: opts.mac === false ? { mod: 'Ctrl', alt: 'Alt' } : { mod: 'Cmd', alt: 'Option' },
    };
    chart.ctx = ctx;
    return ctx;
}

// ------------------------------------------------------------------ hits

export const MOUSE = { line: 6, point: 9 };

/** The hit at a math point (mouse tolerances), or throws. */
export function hitAt(ctx: DragContext, p: Pt): Hit {
    const h = ctx.hits.pick(p, MOUSE, ctx.map);
    if (!h) throw new Error(`nothing under (${p.x}, ${p.y})`);
    return h;
}

/** The hit shape with this key, picked at a point of its own (nearest to `near`). */
export function hitByKey(ctx: DragContext, key: string, near?: Pt): Hit {
    const shape = ctx.hits.byKey(key);
    if (!shape) throw new Error(`no hit shape ${key}`);
    let at: Pt | null = shape.point;
    let run = -1;
    if (!at) {
        let best = Infinity;
        shape.lines.forEach((l, i) => {
            for (const q of l) {
                const d = near ? Math.hypot((q.x - near.x) * ctx.map.kx, (q.y - near.y) * ctx.map.ky) : 0;
                if (d < best) {
                    best = d;
                    at = q;
                    run = i;
                }
                if (!near) break;
            }
        });
    }
    return { shape, at: at as Pt, run, distPx: 0, passed: null };
}

/** A target for the shape `key`, grabbed near `near`. */
export function targetOf(ctx: DragContext, key: string, near?: Pt): DragTarget {
    return resolveTarget(hitByKey(ctx, key, near), ctx);
}

// ----------------------------------------------------------------- drags

export interface DragRun {
    prepared: PreparedDrag;
    session: DragSession;
    frames: DragFrame[];
    commit: DragCommit | null;
    /** Max per-event update time (ms) and the prepare time. */
    maxMs: number;
    prepareMs: number;
    /** Every per-event update time (ms), in event order. */
    frameMs: number[];
}

export interface DragOptions {
    gesture?: Gesture;
    pivot?: Pt;
    steps?: number;
    mods?: Partial<Mods>;
    /** Apply every frame to the chart data (like the modal) and the commit after release. */
    apply?: TestChart;
    /** Explicit pointer path instead of the straight line from `from` to `to`. */
    path?: Pt[];
}

/** Prepare (or throw with the lock), then move the pointer in `steps` events from `from` to `to`, then commit. */
export function drag(ctx: DragContext, target: DragTarget, from: Pt, to: Pt, opts: DragOptions = {}): DragRun {
    const gesture = opts.gesture || 'move';
    const t0 = performance.now();
    const prep = prepareDrag(target, from, gesture, ctx, opts.pivot ? { pivot: opts.pivot } : undefined);
    const prepareMs = performance.now() - t0;
    if ('lock' in prep) throw new Error(`locked: ${(prep as { lock: Lock }).lock.title}`);
    const mods: Mods = { shift: gesture === 'pivot', alt: false, ...(opts.mods || {}) };
    const session = DragSession.start(prep, mods, ctx);
    const frames: DragFrame[] = [];
    const steps = opts.steps || 12;
    const path = opts.path || Array.from({ length: steps }, (_, k) => ({ x: from.x + ((to.x - from.x) * (k + 1)) / steps, y: from.y + ((to.y - from.y) * (k + 1)) / steps }));
    let maxMs = 0;
    const frameMs: number[] = [];
    for (const p of path) {
        const t1 = performance.now();
        const f = session.update(p, mods);
        const dt = performance.now() - t1;
        frameMs.push(dt);
        maxMs = Math.max(maxMs, dt);
        frames.push(f);
        if (opts.apply) applyFrame(opts.apply.data, f);
    }
    const commit = session.commit();
    if (opts.apply && commit) applyCommit(opts.apply.data, commit);
    return { prepared: prep, session, frames, commit, maxMs, prepareMs, frameMs };
}

export function applyFrame(data: ChartData, f: { edits: Array<{ ref: FieldRef; text: string }>; params: Array<{ name: string; value: number }> }): void {
    for (const e of f.edits) setFieldText(e.ref, data, e.text);
    for (const p of f.params) {
        const prm = data.parameters.find((q) => q.name === p.name);
        if (prm) prm.value = p.value;
    }
}

export function applyCommit(data: ChartData, c: DragCommit): void {
    for (const p of c.fields) setFieldText(p.ref, data, p.after);
    for (const p of c.params) {
        const prm = data.parameters.find((q) => q.name === p.name);
        if (prm) prm.value = p.after;
    }
}

/** Text of the frame's edit for `ref` (or null). */
export function editText(f: DragFrame, ref: FieldRef): string | null {
    const e = f.edits.find((x) => JSON.stringify(x.ref) === JSON.stringify(ref));
    return e ? e.text : null;
}

export function paramValue(f: { params: Array<{ name: string; value: number }> }, name: string): number | null {
    const p = f.params.find((x) => x.name === name);
    return p ? p.value : null;
}

/** Final text of `ref` after a commit (the before text when the field did not change). */
export function committedText(run: DragRun, ref: FieldRef, data: ChartData): string | null {
    const p = run.commit ? run.commit.fields.find((x) => JSON.stringify(x.ref) === JSON.stringify(ref)) : null;
    return p ? p.after : fieldText(ref, data);
}

// ---------------------------------------------------------------- charts

export interface ChartSpec {
    view: [number, number, number, number];
    functions?: Array<Partial<FunctionParameters> & { expression: string }>;
    tools?: Array<Record<string, unknown>>;
    parameters?: Array<{ name: string; value: number; min: number; max: number; step: number }>;
    annotations?: Array<Record<string, unknown>>;
    equal?: boolean;
    axis?: AxisStyle;
}

/** A small v4 chart JSON. */
export function chartJson(spec: ChartSpec): Record<string, unknown> {
    const [xmin, xmax, ymin, ymax] = spec.view;
    return {
        v: 4,
        xmin: String(xmin),
        xmax: String(xmax),
        ymin: String(ymin),
        ymax: String(ymax),
        axis_style: spec.axis || 'box',
        equalScale: !!spec.equal,
        functions: (spec.functions || []).map((f, i) => ({
            expression: f.expression,
            domain: f.domain || '',
            showLegend: false,
            fill: false,
            fillOpacity: 0.2,
            fillPattern: 'solid',
            tangent: !!f.tangent,
            color: 'blue',
            dashed: false,
            tangentPoint: f.tangentPoint || '',
            extrema: !!f.extrema,
            thickness: 'thick',
            parametric: !!f.parametric,
            expressionY: f.expressionY || '',
            name: f.name || `f${i + 1}`,
        })),
        tools: spec.tools || [],
        parameters: spec.parameters || [],
        annotations: spec.annotations || [],
    };
}

export function regionTool(id: string, name: string, conditions: string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: 'region',
        id,
        name,
        color: 'blue',
        conditions,
        conditionLabels: conditions.map(() => ''),
        fill: true,
        fillOpacity: 0.25,
        fillPattern: 'solid',
        outline: 'none',
        thickness: 'thin',
        constraintLines: true,
        label: '',
        ...extra,
    };
}

export function curveTool(id: string, name: string, equation: string, levels = '', extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { type: 'curve', id, name, color: 'red', equation, levels, thickness: 'thin', dashed: false, label: '', ...extra };
}

export function pointsTool(id: string, name: string, extra: Record<string, unknown>): Record<string, unknown> {
    return {
        type: 'points',
        id,
        name,
        color: 'black',
        dim: 2,
        source: 'list',
        points: '',
        ref1: '',
        ref2: '',
        regionName: '',
        objective: '',
        sense: 'max',
        label: '',
        dropLines: false,
        size: 'normal',
        ...extra,
    };
}

export function segmentTool(id: string, name: string, path: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { type: 'segment', id, name, color: 'black', dim: 2, path, closed: false, style: 'line', thickness: 'thin', dashed: false, label: '', ...extra };
}

/** Distance (px) from math point q to the zero set of G (first-order). */
export function implicitDistPx(G: (x: number, y: number) => number, q: Pt, ctx: DragContext): number {
    const h = 1e-6;
    const gx = (G(q.x + h, q.y) - G(q.x - h, q.y)) / (2 * h);
    const gy = (G(q.x, q.y + h) - G(q.x, q.y - h)) / (2 * h);
    return Math.abs(G(q.x, q.y)) / Math.hypot(gx / ctx.map.kx, gy / ctx.map.ky);
}
