/*
 * The motion tools (6.0) as scene primitives: a vector field's arrows (one
 * length on screen, coloured by length through a colour map when asked),
 * its streamlines and its moving particles, the rest points of a field
 * (filled when stable, open when not) and the solutions of systems, a curve
 * in 2D and a 3D curve in 3D (legs the 3D renderer paints in depth with the
 * rest, coloured by time when asked). Preview and export draw the same
 * primitives; the particles are the only part that follows the clock, so
 * they are added after the scene memo (motionStrokes). Pure: no DOM.
 */
import type { Colormap, RestPointsTool, Tool, TrajectoryTool, VectorFieldTool } from '../types';
import type { Pt } from '../geometry';
import type { Scene3D, SceneCtx, SceneOutput, StrokePrim } from '../scene';
import { addIssue, fail, newOutput, publish, UP_RIGHT } from '../scene';
import { t as msg } from '../i18n';
import { errorText } from '../util';
import { colormapRgb, isColormap } from '../colormaps';
import { MAX_STEPS, compileTuple, restPoints, setTupleMessages, solveSystem, streamlines } from './maths';
import type { RestKind, VectorFn } from './maths';
// 6.0 F4: what moves on the preview's live canvas.
import type { TraceRun } from './liveprims';
import { TIME_LEVELS, flowOf, optionValue, rampColor, speedOf, traceSeconds, tracedAt } from './liveprims';

/** The tool types of this module. */
export const MOTION_TYPES: ReadonlySet<string> = new Set(['vectorField', 'restPoints', 'trajectory']);
/** Of them, the ones a 3D chart draws. */
export const MOTION_3D_TYPES: ReadonlySet<string> = new Set(['trajectory']);

/** What a vector field hands its readers and the clock (kept on its scene output). */
export interface MotionOutput {
    /** F(x, y), which rest points read. */
    field?: (x: number, y: number) => number[];
    /** The moving particles: how fast (chart units a second per unit of |F|), in what colour. */
    particles?: { speed: number; color: string };
}

/** An arrow is this share of its grid cell long (on screen). */
const ARROW_SHARE = 0.75;
/** The head is this share of the arrow, at this half angle. */
const HEAD_SHARE = 0.32;
const HEAD_ANGLE = (25 * Math.PI) / 180;
/** Colour levels of a field or a solution coloured through a map. */
const LEVELS = 8;
/**
 * 6.0 F4: the still frame of a field with moving particles (the export, SVG
 * files, Copy SVG) is the same picture at rest: faint arrows and a few
 * streamlines. The preview's live canvas draws the flow itself
 * (src/motion6/live.ts), and hides these.
 */
const STILL_STREAM_GAP = 3.2;
/** The particles' width in screen pixels by the field's thickness. */
const PARTICLE_WIDTH: Record<string, number> = { 'very thin': 1, thin: 1.4, thick: 2.2, 'very thick': 3 };
const STILL_STREAM_OPACITY = 0.6;
/** Streamlines are this many arrow cells apart. */
const STREAM_GAP = 1.6;
/** A solution stops where it runs this many chart sizes away. */
const FAR = 1e6;

function str(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
}

let messagesSet = '';

/** The tuple problems in the reader's language (set once per language). */
function tupleMessages(): void {
    const lang = msg('motion6.problem.tuple', { count: 2 });
    if (lang === messagesSet) return;
    messagesSet = lang;
    setTupleMessages({
        notTuple: (dim) => msg('motion6.problem.tuple', { count: dim }),
        part: (index, message) => msg('motion6.problem.part', { index, message }),
    });
}

/**
 * Producers and evaluated sources of a tool of this module, for the scene's
 * dependency graph and cache keys (the pattern of src/beyond/scene.ts).
 */
export function motionSources(t: Tool, scan: (src: unknown, field: string) => void, refs: Array<{ name: string; field: string }>): void {
    switch (t.type) {
        case 'vectorField':
            scan(t.expression, 'expression');
            break;
        case 'restPoints': {
            const field = str(t.field).trim();
            if (field) refs.push({ name: field, field: 'field' });
            break;
        }
        case 'trajectory':
            scan(t.expression, 'expression');
            // Its points tools (P) are read by name: a drag on P moves the solution.
            scan(t.through, 'through');
            scan(t.from, 'from');
            scan(t.to, 'to');
            break;
    }
}

/** A 2D tool of this module computed; null for any other tool. */
export function computeMotion(t: Tool, ctx: SceneCtx): SceneOutput | null {
    switch (t.type) {
        case 'vectorField':
            return computeField(t, ctx);
        case 'restPoints':
            return computeRestPoints(t, ctx);
        case 'trajectory':
            return computeTrajectory(t, ctx);
        default:
            return null;
    }
}

/** pt per unit on each axis, the same on both with equal scale (src/beyond/scene.ts plotUnits). */
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

/** The colour of level k of LEVELS through a map, as #rrggbb (the export defines it, the preview paints it). */
export function levelColor(map: Colormap, k: number, levels = LEVELS): string {
    const rgb = colormapRgb(map, levels > 1 ? k / (levels - 1) : 0.5);
    return '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');
}

/** F of a vector field tool as a function of (x, y); null after a problem. */
function fieldFn(t: VectorFieldTool, ctx: SceneCtx, out: SceneOutput): ((x: number, y: number) => number[]) | null {
    tupleMessages();
    let f: VectorFn;
    try {
        f = compileTuple(ctx.math, str(t.expression), 2);
    } catch (e) {
        fail(out, t.name, 'expression', errorText(e));
        return null;
    }
    const at = [0, 0];
    return (x, y) => {
        at[0] = x;
        at[1] = y;
        return f(at, 0);
    };
}

// ---------------------------------------------------------------- field

function computeField(t: VectorFieldTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    if (!str(t.expression).trim()) return out;
    const F = fieldFn(t, ctx, out);
    if (!F) return out;
    const motion: MotionOutput = { field: F };
    out.motion = motion;
    const { view } = ctx;
    const { ux, uy } = plotUnits(ctx);
    const wPt = (view.xmax - view.xmin) * ux;
    const hPt = (view.ymax - view.ymin) * uy;
    const density = Number.isFinite(t.density) ? Math.min(60, Math.max(4, Math.round(t.density))) : 20;
    const cell = Math.max(wPt, hPt) / density;
    const nx = Math.max(1, Math.round(wPt / cell));
    const ny = Math.max(1, Math.round(hPt / cell));
    const len = ARROW_SHARE * Math.min(wPt / nx, hPt / ny);
    const color = str(t.color) || 'blue';
    const width = str(t.thickness) || 'thin';
    const map = isColormap(t.colormap) ? t.colormap : null;
    const arrows: Array<{ shaft: Pt[]; head: Pt[]; size: number }> = [];
    let counted = 0;
    for (let i = 0; i < nx; i++) {
        const x = view.xmin + ((i + 0.5) * (view.xmax - view.xmin)) / nx;
        for (let j = 0; j < ny; j++) {
            const y = view.ymin + ((j + 0.5) * (view.ymax - view.ymin)) / ny;
            const v = F(x, y);
            if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) continue;
            const size = Math.hypot(v[0], v[1]);
            counted++;
            // The direction in pt; an arrow of length `len` pt centred on its point.
            const sx = v[0] * ux;
            const sy = v[1] * uy;
            const s = Math.hypot(sx, sy);
            if (!(s > 0)) continue;
            const dx = sx / s;
            const dy = sy / s;
            const tail = { x: x - (dx * len) / 2 / ux, y: y - (dy * len) / 2 / uy };
            const tip = { x: x + (dx * len) / 2 / ux, y: y + (dy * len) / 2 / uy };
            const hl = HEAD_SHARE * len;
            const side = (a: number) => {
                const c = Math.cos(a);
                const sn = Math.sin(a);
                // The head's sides point back from the tip, turned by +-HEAD_ANGLE (in pt).
                const bx = -(dx * c - dy * sn);
                const by = -(dx * sn + dy * c);
                return { x: tip.x + (bx * hl) / ux, y: tip.y + (by * hl) / uy };
            };
            arrows.push({ shaft: [tail, tip], head: [side(HEAD_ANGLE), tip, side(-HEAD_ANGLE)], size });
        }
    }
    const flow = t.particles === true;
    const look = flowOf(t);
    // The particles' width follows the tool's thickness (thin: the plan's 1.4 px) unless `width` sets it.
    if (optionValue('particleWidth', t.particleWidth) === undefined) look.width = PARTICLE_WIDTH[width] ?? look.width;
    // 6.0 F4: under moving particles the arrows are as faint as the live canvas's settle (0.025 a frame, a tenth fading: 0.25).
    const faint = Math.min(1, look.arrows / Math.max(0.01, look.fade));
    const push = (list: typeof arrows, c: string) => {
        if (!list.length || (flow && !(faint > 0))) return;
        const s: StrokePrim = { lines: list.flatMap((a) => [a.shaft, a.head]), color: c, width, dashed: false, exact: true };
        // The live canvas draws its own (still: hidden there).
        if (flow) {
            s.opacity = Number(faint.toFixed(3));
            s.still = true;
        }
        out.strokes.push(s);
    };
    if (map && arrows.length) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const a of arrows) {
            lo = Math.min(lo, a.size);
            hi = Math.max(hi, a.size);
        }
        const groups: Array<typeof arrows> = Array.from({ length: LEVELS }, () => []);
        for (const a of arrows) {
            const k = hi > lo ? Math.min(LEVELS - 1, Math.floor(((a.size - lo) / (hi - lo)) * LEVELS)) : Math.floor(LEVELS / 2);
            groups[k].push(a);
        }
        groups.forEach((g, k) => push(g, levelColor(map, k)));
    } else push(arrows, color);

    if (t.streamlines === true) {
        const lines = streamlines(F, view, ux, uy, STREAM_GAP * cell);
        // In the tool's own colour: a map's light end would hardly show on paper.
        if (lines.length) out.strokes.push({ lines, color, width: 'thin', dashed: false });
    }
    if (flow && counted) {
        // 6.0 F4: the still frame of the flow: a few streamlines over the faint arrows (unless it draws its own).
        if (t.streamlines !== true) {
            const lines = streamlines(F, view, ux, uy, STILL_STREAM_GAP * cell);
            if (lines.length) out.strokes.push({ lines, color, width: 'thin', dashed: false, opacity: STILL_STREAM_OPACITY, still: true });
        }
        // The plan's flow: 1.4 s of the field's time a second (times `speed`), 450 particles, trails of 0.9.
        motion.particles = { speed: look.speed, color };
        out.live = [{ key: `${str(t.id)}:particles`, particles: { field: F, color, colormap: map, ...look } }];
    }
    return out;
}

// ---------------------------------------------------------- rest points

/** The kinds of rest points in the reader's words. */
const KIND_KEYS: Record<RestKind, 'motion6.rest.stableNode' | 'motion6.rest.unstableNode' | 'motion6.rest.stableSpiral' | 'motion6.rest.unstableSpiral' | 'motion6.rest.saddle' | 'motion6.rest.centre' | 'motion6.rest.degenerate'> = {
    stableNode: 'motion6.rest.stableNode',
    unstableNode: 'motion6.rest.unstableNode',
    stableSpiral: 'motion6.rest.stableSpiral',
    unstableSpiral: 'motion6.rest.unstableSpiral',
    saddle: 'motion6.rest.saddle',
    centre: 'motion6.rest.centre',
    degenerate: 'motion6.rest.degenerate',
};

export function restKindText(kind: RestKind): string {
    return msg(KIND_KEYS[kind]);
}

function computeRestPoints(t: RestPointsTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const name = str(t.field).trim();
    if (!name) return fail(out, t.name, 'field', msg('motion6.problem.chooseField'));
    const tool = ctx.toolsByName.get(name);
    if (!tool) return fail(out, t.name, 'field', msg('problems.scene.doesNotExist', { name }));
    if (tool.type !== 'vectorField') return fail(out, t.name, 'field', msg('motion6.problem.notField', { name }));
    const prod = ctx.outputs.get(name);
    const F = prod && !prod.failed ? prod.motion?.field : undefined;
    if (!F) {
        if (!prod || prod.failed) return fail(out, t.name, 'field', msg('problems.scene.hasError', { name }));
        return out;
    }
    const found = restPoints(F, ctx.view);
    publish(
        out,
        t.name,
        found.map((p) => [p.x, p.y]),
        NaN,
        2
    );
    if (!found.length) {
        addIssue(out, t.name, undefined, msg('motion6.problem.noRestPoints'), 'info');
        return out;
    }
    const color = str(t.color) || 'orange';
    const size = t.size === 'small' || t.size === 'large' ? t.size : 'normal';
    // A rest point on the border of the view keeps its marker; its name would not fit beside it.
    const mx = (ctx.view.xmax - ctx.view.xmin) * 0.03;
    const my = (ctx.view.ymax - ctx.view.ymin) * 0.03;
    const roomy = (p: { x: number; y: number }) => p.x > ctx.view.xmin + mx && p.x < ctx.view.xmax - mx && p.y > ctx.view.ymin + my && p.y < ctx.view.ymax - my;
    found.forEach((p, i) => {
        out.markers.push(p.stable ? { x: p.x, y: p.y, color, size } : { x: p.x, y: p.y, color, size, open: true });
        if (t.valueLabel && roomy(p)) out.texts.push({ x: p.x, y: p.y, template: 'label', part: i, literal: restKindText(p.kind), color, size: 'small', dir: UP_RIGHT, marker: size });
    });
    return out;
}

// ------------------------------------------------------------ solutions

/** The value of a formula field; null after a problem. */
function fieldValue(src: string, field: string, name: string, ctx: SceneCtx, out: SceneOutput): number | null {
    const res = ctx.math.tryValue(src);
    if (res.ok) return res.value;
    if (ctx.math.validate(src, 'value').ok) addIssue(out, name, field, res.message, 'info');
    else fail(out, name, field, res.message);
    return null;
}

/** Where the solutions start: points and points tools' points of the chart's dimension; null (with the problem) when it cannot. */
function startPoints(t: TrajectoryTool, dim: 2 | 3, ctx: SceneCtx, out: SceneOutput): number[][] | null {
    const src = str(t.through);
    let entries: ReturnType<SceneCtx['math']['path']>;
    try {
        entries = ctx.math.path(src, dim);
    } catch (e) {
        if (ctx.math.validate(src, dim === 3 ? 'path3' : 'path2').ok) addIssue(out, t.name, 'through', errorText(e), 'info');
        else fail(out, t.name, 'through', errorText(e));
        return null;
    }
    const pts: number[][] = [];
    for (const entry of entries) {
        if ('point' in entry) {
            pts.push(entry.point.slice(0, dim));
            continue;
        }
        const tool = ctx.toolsByName.get(entry.name);
        if (!tool || tool.type !== 'points' || (dim === 3) !== (tool.dim === 3)) {
            fail(out, t.name, 'through', msg('problems.math.notPointsTool', { name: entry.name }));
            return null;
        }
        const prod = ctx.outputs.get(entry.name);
        if (!prod || !prod.points) {
            fail(out, t.name, 'through', msg('problems.scene.hasError', { name: entry.name }));
            return null;
        }
        for (const p of prod.points) pts.push(p.slice(0, dim));
    }
    return pts.filter((p) => p.length === dim && p.every(Number.isFinite));
}

interface Solved {
    lines: Array<{ pts: number[][]; ts: number[] }>;
    t0: number;
    t1: number;
}

/** The solutions of a trajectory tool; null after a problem. */
function solve(t: TrajectoryTool, dim: 2 | 3, ctx: SceneCtx, out: SceneOutput, size: number): Solved | null {
    if (!str(t.expression).trim() || !str(t.through).trim()) return null;
    tupleMessages();
    let f: VectorFn;
    try {
        f = compileTuple(ctx.math, str(t.expression), dim);
    } catch (e) {
        fail(out, t.name, 'expression', errorText(e));
        return null;
    }
    const t0 = fieldValue(str(t.from) || '0', 'from', t.name, ctx, out);
    const t1 = fieldValue(str(t.to) || '10', 'to', t.name, ctx, out);
    if (t0 === null || t1 === null) return null;
    if (!(t1 > t0)) {
        fail(out, t.name, 'to', msg('beyond.problem.fromBelowTo'));
        return null;
    }
    const starts = startPoints(t, dim, ctx, out);
    if (!starts) return null;
    const lines: Solved['lines'] = [];
    let capped = false;
    let stopped: number | null = null;
    for (const p of starts) {
        const s = solveSystem(f, p, t0, t1, FAR * size);
        capped = capped || s.capped;
        if (s.stopped !== null && stopped === null) stopped = s.stopped;
        if (s.pts.length >= 2) lines.push({ pts: s.pts, ts: s.ts });
    }
    if (capped) addIssue(out, t.name, 'to', msg('motion6.problem.capped', { steps: MAX_STEPS }), 'info');
    if (stopped !== null) addIssue(out, t.name, 'expression', msg('motion6.problem.stopped', { t: Number(stopped.toPrecision(3)) }), 'info');
    return { lines, t0, t1 };
}

/** The level (0..levels-1) of time `tt` in [t0, t1]. */
function levelOf(tt: number, t0: number, t1: number, levels = LEVELS): number {
    return Math.max(0, Math.min(levels - 1, Math.floor(((tt - t0) / (t1 - t0)) * levels)));
}

/**
 * 6.0 F4: how a solution is coloured by time: the default ramp (cobalt to
 * amber, `coloured by time`) or a colour map (`in viridis`); null when it is
 * one colour. TIME_LEVELS levels either way, so the gradient reads smooth.
 */
function timeColours(t: TrajectoryTool): ((k: number) => string) | null {
    const map = isColormap(t.colormap) ? t.colormap : null;
    if (map) return (k) => levelColor(map, k, TIME_LEVELS);
    if (t.byTime === true) return (k) => rampColor(k);
    return null;
}

function computeTrajectory(t: TrajectoryTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    if (t.dim === 3) return out;
    const { view } = ctx;
    const solved = solve(t, 2, ctx, out, Math.max(view.xmax - view.xmin, view.ymax - view.ymin));
    if (!solved) return out;
    const color = str(t.color) || 'red';
    const width = str(t.thickness) || 'thick';
    const dashed = !!t.dashed;
    const colours = timeColours(t);
    // 6.0 F4: a traced solution draws itself on the live canvas; the SVG keeps it whole (the still frame).
    const traced = t.traced === true;
    const runs: TraceRun[] = [];
    const span = solved.t1 - solved.t0;
    const uOf = (ts: number[]) => ts.map((v) => (v - solved.t0) / span);
    if (!colours) {
        const lines = solved.lines.map((l) => l.pts.map((p) => ({ x: p[0], y: p[1] })));
        if (lines.length) out.strokes.push(traced ? { lines, color, width, dashed, still: true } : { lines, color, width, dashed });
        if (traced) lines.forEach((pts, i) => runs.push({ pts, u: uOf(solved.lines[i].ts), color, line: i }));
    } else {
        // Coloured by time: the run of each level its own stroke (neighbouring runs share their end point).
        const groups: Pt[][][] = Array.from({ length: TIME_LEVELS }, () => []);
        solved.lines.forEach((l, line) => {
            let start = 0;
            for (let i = 1; i <= l.pts.length; i++) {
                const k = levelOf(l.ts[start], solved.t0, solved.t1, TIME_LEVELS);
                if (i < l.pts.length && levelOf(l.ts[i], solved.t0, solved.t1, TIME_LEVELS) === k) continue;
                const to = Math.min(l.pts.length, i + 1);
                const run = l.pts.slice(start, to).map((p) => ({ x: p[0], y: p[1] }));
                if (run.length >= 2) {
                    groups[k].push(run);
                    if (traced) runs.push({ pts: run, u: uOf(l.ts.slice(start, to)), color: colours(k), line });
                }
                start = i;
            }
        });
        groups.forEach((lines, k) => {
            if (!lines.length) return;
            const s: StrokePrim = { lines, color: colours(k), width, dashed };
            if (traced) s.still = true;
            out.strokes.push(s);
        });
    }
    if (traced && runs.length) {
        const look = { width, dashed, head: { size: 'normal' as const }, seconds: traceSeconds(solved.t0, solved.t1) / speedOf(t) };
        out.live = [{ key: `${str(t.id)}:trace`, at: tracedAt(runs, look) }];
    }
    return out;
}

/** A 3D tool of this module computed (legs for the 3D scene); null for any other tool. */
export function computeMotion3D(t: Tool, ctx: SceneCtx): SceneOutput | null {
    if (t.type !== 'trajectory') return null;
    const out = newOutput();
    const { view } = ctx;
    const solved = solve(t, 3, ctx, out, Math.max(view.xmax - view.xmin, view.ymax - view.ymin));
    if (!solved) return out;
    const color = str(t.color) || 'red';
    // 6.0 F4: thin by default in 3D (trajectoryDefaults), a smooth ramp when coloured by time.
    const width = str(t.thickness) || 'thin';
    const dashed = !!t.dashed;
    const colours = timeColours(t);
    const traced = t.traced === true;
    const seconds = traceSeconds(solved.t0, solved.t1) / speedOf(t);
    const span = solved.t1 - solved.t0;
    const legs: Scene3D['segments'] = [];
    let runCounter = 0;
    for (const l of solved.lines) {
        // One run per line and colour: the export joins its legs into one path.
        let run = ++runCounter;
        let last = -1;
        for (let i = 1; i < l.pts.length; i++) {
            const a = l.pts[i - 1];
            const b = l.pts[i];
            const k = colours ? levelOf(l.ts[i - 1], solved.t0, solved.t1, TIME_LEVELS) : 0;
            if (last >= 0 && k !== last) run = ++runCounter;
            last = k;
            const leg: Scene3D['segments'][number] = { a: [a[0], a[1], a[2]], b: [b[0], b[1], b[2]], color: colours ? colours(k) : color, width, dashed, run, curve: true };
            // 6.0 F4: where the leg comes in when the curve draws itself (0..1), and how long that takes.
            if (traced) {
                leg.trace = [(l.ts[i - 1] - solved.t0) / span, (l.ts[i] - solved.t0) / span];
                leg.traceSeconds = seconds;
            }
            legs.push(leg);
        }
    }
    out.segments3 = legs;
    return out;
}
