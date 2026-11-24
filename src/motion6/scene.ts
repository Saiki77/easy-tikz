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
import type { Colormap, MotionFrame, RestPointsTool, Tool, TrajectoryTool, VectorFieldTool } from '../types';
import type { Pt } from '../geometry';
import type { Scene3D, SceneCtx, SceneOutput, StrokePrim } from '../scene';
import { addIssue, fail, newOutput, publish, UP_RIGHT } from '../scene';
import { t as msg } from '../i18n';
import { errorText } from '../util';
import { colormapRgb, isColormap } from '../colormaps';
import { MAX_STEPS, PARTICLE_LIFE, compileTuple, particlesAt, restPoints, setTupleMessages, solveSystem, streamlines } from './maths';
import type { RestKind, VectorFn } from './maths';
import { clockTime } from './clock';

/** The tool types of this module. */
export const MOTION_TYPES: ReadonlySet<string> = new Set(['vectorField', 'restPoints', 'trajectory']);
/** Of them, the ones a 3D chart draws. */
export const MOTION_3D_TYPES: ReadonlySet<string> = new Set(['trajectory']);

/** What a vector field hands its readers and the clock (kept on its scene output). */
export interface MotionOutput {
    /** F(x, y), which rest points read. */
    field?: (x: number, y: number) => number[];
    /** The moving particles: how many, how fast, how drawn. */
    particles?: { count: number; speed: number; color: string; width: string };
}

/** An arrow is this share of its grid cell long (on screen). */
const ARROW_SHARE = 0.75;
/** The head is this share of the arrow, at this half angle. */
const HEAD_SHARE = 0.32;
const HEAD_ANGLE = (25 * Math.PI) / 180;
/** Colour levels of a field or a solution coloured through a map. */
const LEVELS = 8;
/** Arrows under moving particles are drawn this faint. */
const UNDER_PARTICLES = 0.4;
/** Particles per grid cell of the arrows, and their bounds. */
const PARTICLES_PER_CELL = 0.9;
const MIN_PARTICLES = 40;
const MAX_PARTICLES = 400;
/** Opacity levels of the particles' trails (oldest part faintest). */
const TRAIL_LEVELS = [0.15, 0.35, 0.6, 1];
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
    let sum = 0;
    let counted = 0;
    for (let i = 0; i < nx; i++) {
        const x = view.xmin + ((i + 0.5) * (view.xmax - view.xmin)) / nx;
        for (let j = 0; j < ny; j++) {
            const y = view.ymin + ((j + 0.5) * (view.ymax - view.ymin)) / ny;
            const v = F(x, y);
            if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) continue;
            const size = Math.hypot(v[0], v[1]);
            sum += size;
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
    const faint = t.particles === true ? UNDER_PARTICLES : undefined;
    const push = (list: typeof arrows, c: string) => {
        if (!list.length) return;
        const s: StrokePrim = { lines: list.flatMap((a) => [a.shaft, a.head]), color: c, width, dashed: false, exact: true };
        if (faint !== undefined) s.opacity = faint;
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
    if (t.particles === true && counted) {
        const count = Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, Math.round(nx * ny * PARTICLES_PER_CELL)));
        // A typical arrow's own cell is crossed in about a second: |F| times speed is cell / 1 s.
        const mean = sum / counted;
        const cellUnits = Math.hypot(cell / ux, cell / uy) / Math.SQRT2;
        const speed = mean > 0 ? cellUnits / mean : 0;
        motion.particles = { count, speed, color, width: 'thick' };
    }
    return out;
}

/**
 * The particles of a vector field at the frame's time, as strokes that fade
 * along their trails (the still frame: time 0 or the chart's stillTime).
 * Null when the tool has none. Called after the scene memo, every frame.
 */
export function motionStrokes(tool: Tool | undefined, out: SceneOutput, ctx: SceneCtx, frame: MotionFrame | undefined): StrokePrim[] | null {
    if (!tool || tool.type !== 'vectorField' || tool.particles !== true) return null;
    const motion = out.motion;
    if (!motion || !motion.field || !motion.particles) return null;
    const p = motion.particles;
    const time = clockTime(frame);
    const parts = particlesAt(motion.field, ctx.view, p.count, p.speed, time);
    const levels: Pt[][][] = TRAIL_LEVELS.map(() => []);
    for (const part of parts) {
        const n = part.trail.length;
        // The trail in as many pieces as levels, the newest one the most opaque.
        for (let k = 0; k < TRAIL_LEVELS.length; k++) {
            const a = Math.floor((k * (n - 1)) / TRAIL_LEVELS.length);
            const b = Math.floor(((k + 1) * (n - 1)) / TRAIL_LEVELS.length);
            if (b <= a) continue;
            const alpha = TRAIL_LEVELS[k] * part.life;
            // Nearest level at or below: a piece fades with its particle's life.
            let level = 0;
            for (let j = 0; j < TRAIL_LEVELS.length; j++) if (TRAIL_LEVELS[j] <= alpha + 1e-9) level = j;
            if (alpha < TRAIL_LEVELS[0] * 0.5) continue;
            levels[level].push(part.trail.slice(a, b + 1));
        }
    }
    const strokes: StrokePrim[] = [];
    levels.forEach((lines, k) => {
        if (lines.length) strokes.push({ lines, color: p.color, width: p.width, dashed: false, opacity: TRAIL_LEVELS[k] });
    });
    return strokes;
}

/** How long one round of a particle takes (the clock's natural period, for a film or a guide). */
export const PARTICLE_PERIOD = PARTICLE_LIFE;

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
    const color = str(t.color) || 'red';
    const size = t.size === 'small' || t.size === 'large' ? t.size : 'normal';
    found.forEach((p, i) => {
        out.markers.push(p.stable ? { x: p.x, y: p.y, color, size } : { x: p.x, y: p.y, color, size, open: true });
        if (t.valueLabel) out.texts.push({ x: p.x, y: p.y, template: 'label', part: i, literal: restKindText(p.kind), color, size: 'small', dir: UP_RIGHT, marker: size });
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

/** The level (0..LEVELS-1) of time `tt` in [t0, t1]. */
function levelOf(tt: number, t0: number, t1: number): number {
    return Math.max(0, Math.min(LEVELS - 1, Math.floor(((tt - t0) / (t1 - t0)) * LEVELS)));
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
    const map = isColormap(t.colormap) ? t.colormap : null;
    if (!map) {
        const lines = solved.lines.map((l) => l.pts.map((p) => ({ x: p[0], y: p[1] })));
        if (lines.length) out.strokes.push({ lines, color, width, dashed });
        return out;
    }
    // Coloured by time: the run of each level its own stroke (neighbouring runs share their end point).
    const groups: Pt[][][] = Array.from({ length: LEVELS }, () => []);
    for (const l of solved.lines) {
        let start = 0;
        for (let i = 1; i <= l.pts.length; i++) {
            const k = levelOf(l.ts[start], solved.t0, solved.t1);
            if (i < l.pts.length && levelOf(l.ts[i], solved.t0, solved.t1) === k) continue;
            const run = l.pts.slice(start, Math.min(l.pts.length, i + 1)).map((p) => ({ x: p[0], y: p[1] }));
            if (run.length >= 2) groups[k].push(run);
            start = i;
        }
    }
    groups.forEach((lines, k) => {
        if (lines.length) out.strokes.push({ lines, color: levelColor(map, k), width, dashed });
    });
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
    const width = str(t.thickness) || 'thick';
    const dashed = !!t.dashed;
    const map = isColormap(t.colormap) ? t.colormap : null;
    const legs: Scene3D['segments'] = [];
    let runCounter = 0;
    for (const l of solved.lines) {
        // One run per line and colour: the export joins its legs into one path.
        let run = ++runCounter;
        let last = -1;
        for (let i = 1; i < l.pts.length; i++) {
            const a = l.pts[i - 1];
            const b = l.pts[i];
            const k = map ? levelOf(l.ts[i - 1], solved.t0, solved.t1) : 0;
            if (last >= 0 && k !== last) run = ++runCounter;
            last = k;
            legs.push({ a: [a[0], a[1], a[2]], b: [b[0], b[1], b[2]], color: map ? levelColor(map, k) : color, width, dashed, run });
        }
    }
    out.segments3 = legs;
    return out;
}
