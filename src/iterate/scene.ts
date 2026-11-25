/*
 * The tools of part E (6.0) as scene primitives: the orbit of a recurrence
 * (points joined by lines), the cobweb of a map, Newton's method (tangents
 * down to the axis), the bifurcation diagram and the coloured plane (pixel
 * layers, src/iterate/pixels.ts), and the turning circles of a sum, whose
 * moving parts follow the clock and are added after the scene memo
 * (iterateMotion), as motion6's particles are. Preview and export draw the
 * same primitives. Pure: no DOM.
 */
import type { BifurcationTool, CobwebTool, FourierCirclesTool, MarkerSize, MotionFrame, NewtonTool, OrbitTool, PlaneColourTool, Tool } from '../types';
import type { Pt, View } from '../geometry';
import type { FillPrim, MarkerPrim, SceneCtx, SceneItem2D, SceneOutput, StrokePrim } from '../scene';
import { addIssue, fail, newOutput, UP_RIGHT } from '../scene';
import { t as msg } from '../i18n';
import { errorText } from '../util';
import { TIKZ_COLOR_DEFS } from '../colors';
import { compileValue, readRecurrence } from '../values';
import type { Recurrence, Value } from '../values';
import { clockTime, registerClockType } from '../motion6/clock';
import { givenParts, isPlaneColormap, topEquals } from './tools';
import { formulaParts, planeKind, readsLetter } from './forms';
import { PixelPrim, bifurcationPrim, bifurcationStep, domainPrim, escapePrim, heatPrim, heatRange, recurrenceStep } from './pixels';
import { FourierTerms, compileFourier, FOURIER_SPEED, MAX_COEFFICIENTS } from './fourier';
// 6.0 F4: what moves on the preview's live canvas.
import type { LiveShapes, TraceRun } from '../motion6/liveprims';
import { emptyShapes, orbitSeconds, speedOf, tracedAt } from '../motion6/liveprims';

/** The tool types of this part (all 2D). */
export const ITERATE_SCENE_TYPES: ReadonlySet<string> = new Set(['orbit', 'cobweb', 'bifurcation', 'newton', 'colourPlane', 'fourierCircles']);

// The circles turn by themselves: the chart gets a clock (src/motion6/clock.ts).
registerClockType('fourierCircles', (t) => t.type === 'fourierCircles');
// 6.0 F4: an orbit that draws itself.
registerClockType('orbit', (t) => t.type === 'orbit' && t.traced === true);

/** Caps, so that a chart cannot freeze a phone (the 6.0 plan). */
export const MAX_ORBIT = 2000;
export const MAX_COBWEB = 1000;
export const MAX_NEWTON = 100;
export const MAX_TERMS = 60;
/** An orbit drawn with dots: dots for the first this many points (the line goes on). */
const MAX_DOTS = 400;
/** Labels z_0, z_1, ... for the first this many points. */
const MAX_LABELS = 6;
/** An orbit stops where it runs this many chart sizes away. */
const FAR = 1e6;

/** What a tool of this part hands the clock and the fit (kept on its scene output). */
export interface IterateOutput {
    /** The turning circles: the terms at a time, the curve of the tip over one turn, the size of the chain. */
    circles?: { terms: FourierTerms; trace: Pt[]; reach: number; color: string; width: string; wave: boolean; speed: number; path?: boolean }; // path: 6.0 P
    /** What the fit holds of a line tool (the points it reaches; the lines across the view do not count). */
    fit?: Pt[];
}

function str(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
/**
 * Producers and evaluated sources of a tool of this part, for the scene's
 * dependency graph and cache keys. Points tools (P) are read by name: a
 * drag on P moves what reads it.
 */
export function iterateSources(t: Tool, scan: (src: unknown, field: string) => void): boolean {
    const rightSide = (src: string) => {
        const eq = topEquals(src);
        return eq < 0 ? src : src.slice(eq + 1);
    };
    const given = (g: string) => {
        for (const p of givenParts(g)) scan(p.value, 'given');
    };
    switch (t.type) {
        case 'orbit':
            scan(rightSide(t.recurrence), 'recurrence');
            scan(t.start, 'start');
            given(t.given);
            scan(t.steps, 'steps');
            return true;
        case 'cobweb':
            scan(rightSide(t.recurrence), 'recurrence');
            scan(t.start, 'start');
            scan(t.steps, 'steps');
            return true;
        case 'bifurcation':
            scan(rightSide(t.recurrence), 'recurrence');
            scan(t.from, 'from');
            scan(t.to, 'to');
            scan(t.start, 'start');
            return true;
        case 'newton':
            scan(t.function, 'function');
            scan(t.start, 'start');
            scan(t.steps, 'steps');
            return true;
        case 'colourPlane':
            scan(rightSide(t.formula), 'formula');
            scan(t.start, 'start');
            given(t.given);
            scan(t.steps, 'steps');
            return true;
        case 'fourierCircles':
            scan(t.sum, 'sum');
            return true;
        default:
            return false;
    }
}

/** A 2D tool of this part computed; null for any other tool. */
export function computeIterate(t: Tool, ctx: SceneCtx): SceneOutput | null {
    switch (t.type) {
        case 'orbit':
            return computeOrbit(t, ctx);
        case 'cobweb':
            return computeCobweb(t, ctx);
        case 'bifurcation':
            return computeBifurcation(t, ctx);
        case 'newton':
            return computeNewton(t, ctx);
        case 'colourPlane':
            return computePlane(t, ctx);
        case 'fourierCircles':
            return computeCircles(t, ctx);
        default:
            return null;
    }
}

// ---------------------------------------------------------------- shared

/** The value of a formula field; null after a problem (an error, or a note while a computed value it reads is still unset). */
function fieldValue(src: string, field: string, name: string, ctx: SceneCtx, out: SceneOutput): number | null {
    const res = ctx.math.tryValue(src);
    if (res.ok) return res.value;
    if (ctx.math.validate(src, 'value').ok) addIssue(out, name, field, res.message, 'info');
    else fail(out, name, field, res.message);
    return null;
}

/** A number of steps: a formula, rounded, from 0 to `cap` (an info note when it was more). */
function stepsOf(src: string, fallback: number, cap: number, name: string, ctx: SceneCtx, out: SceneOutput): number | null {
    const v = fieldValue(str(src).trim() || String(fallback), 'steps', name, ctx, out);
    if (v === null) return null;
    const n = Math.round(v);
    if (n > cap) addIssue(out, name, 'steps', msg('iterate.problem.capped', { steps: cap }), 'info');
    return Math.max(0, Math.min(cap, n));
}

/** The recurrence of a field; null (with the problem) when it is none. */
function recurrenceOf(src: string, name: string, field: string, out: SceneOutput): Recurrence | null {
    const rec = readRecurrence(str(src));
    if (!rec) {
        fail(out, name, field, msg('iterate.problem.recurrenceTakes'));
        return null;
    }
    return rec;
}

/** A start or given value: a points tool's point (a vector), else the formula's value. Null after a problem. */
function valueOf(src: string, field: string, name: string, ctx: SceneCtx, out: SceneOutput): Value | null {
    const s = src.trim();
    if (NAME_RE.test(s)) {
        const tool = ctx.toolsByName.get(s);
        if (tool && tool.type === 'points') {
            const prod = ctx.outputs.get(s);
            const p = prod && !prod.failed && prod.points ? prod.points[0] : undefined;
            if (!p) {
                fail(out, name, field, msg('problems.scene.hasError', { name: s }));
                return null;
            }
            return { kind: 'vec', v: [p[0], p[1]] };
        }
    }
    try {
        return compileValue(ctx.math, s).run();
    } catch (e) {
        fail(out, name, field, errorText(e));
        return null;
    }
}

/** A value as a point of the plane: a complex number, a vector of 2; numbers with their step as x. */
function pointOf(v: Value, n: number, complex: boolean): Pt | null {
    if (typeof v === 'number') return complex ? { x: v, y: 0 } : { x: n, y: v };
    if (v.kind === 'complex') return { x: v.re, y: v.im };
    if (v.kind === 'vec' && v.v.length === 2) return { x: v.v[0], y: v.v[1] };
    return null;
}

const isComplexLike = (v: Value) => typeof v !== 'number' && (v.kind === 'complex' || (v.kind === 'vec' && v.v.length === 2));
const toComplex = (v: Value): Value => (typeof v !== 'number' && v.kind === 'vec' && v.v.length === 2 ? { kind: 'complex', re: v.v[0], im: v.v[1] } : v);

/** The LaTeX name of step k of a state: z_{3}, \theta_{0}. */
function stepName(state: string, k: number): string {
    const greek = /^(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|xi|rho|sigma|tau|phi|chi|psi|omega)$/i.test(state);
    return `$${greek ? '\\' : ''}${state}_{${k}}$`;
}

/** A chart colour as 0..255 channels (the export's colours), for picture layers. */
function rgbOf(color: string): [number, number, number] {
    const def = TIKZ_COLOR_DEFS[color];
    const hex = def ? def.hex : /^#?([0-9a-f]{6})$/i.exec(color.trim())?.[1] ?? TIKZ_COLOR_DEFS.blue.hex;
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * What the fit holds of an item, by its output's own fill list (the scene
 * hands items the output's lists, so a cached output keeps its hint).
 */
const FIT_HINTS = new WeakMap<object, Pt[]>();

function hold(out: SceneOutput, it: IterateOutput): void {
    out.iterate = it;
    if (it.fit) FIT_HINTS.set(out.fills, it.fit);
}

function size(view: View): number {
    return Math.max(view.xmax - view.xmin, view.ymax - view.ymin);
}

// ----------------------------------------------------------------- orbit

/** 6.0 F4: arrow heads on the steps of an orbit, so many at most. */
const MAX_HEADS = 60;
/** A step this long on paper (pt) or longer gets a head. */
const HEAD_MIN_STEP = 16;

/** pt per unit on each axis (the scene's label metrics; the same on both with equal scale). */
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

/**
 * Small filled heads at 55 % of each step that is long enough on paper (the
 * first MAX_HEADS of them), sized in pt like the line; null when none fits.
 */
function stepHeads(pts: Pt[], ctx: SceneCtx, width: string, color: string): FillPrim | null {
    const { ux, uy } = plotUnits(ctx);
    if (!(ux > 0) || !(uy > 0)) return null;
    const v = ctx.view;
    const scale = width === 'very thick' ? 1.5 : width === 'thick' ? 1.25 : 1;
    const len = 4.2 * scale;
    const half = 2.6 * scale;
    const rings: Pt[][] = [];
    const placed: Pt[] = [];
    for (let i = 1; i < pts.length && rings.length < MAX_HEADS; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const dx = (b.x - a.x) * ux;
        const dy = (b.y - a.y) * uy;
        const L = Math.hypot(dx, dy);
        if (!(L >= HEAD_MIN_STEP)) continue;
        const mx = a.x + (b.x - a.x) * 0.55;
        const my = a.y + (b.y - a.y) * 0.55;
        if (mx < v.xmin || mx > v.xmax || my < v.ymin || my > v.ymax) continue;
        // An orbit that comes round again puts its head where one is already (two would cancel out).
        if (placed.some((q) => Math.hypot((q.x - mx) * ux, (q.y - my) * uy) < len)) continue;
        placed.push({ x: mx, y: my });
        const ex = dx / L;
        const ey = dy / L;
        // Tip ahead of the middle point, the base behind it (in pt, then back to chart units).
        const at = (along: number, side: number): Pt => ({ x: mx + (ex * along - ey * side) / ux, y: my + (ey * along + ex * side) / uy });
        rings.push([at(len * 0.55, 0), at(-len * 0.45, half), at(-len * 0.45, -half)]);
    }
    return rings.length ? { rings, color, opacity: 1, pattern: 'solid' } : null;
}

/** The points of an orbit (and why it stopped); null after a problem. */
export function orbitPoints(t: OrbitTool, ctx: SceneCtx, out: SceneOutput): { pts: Pt[]; rec: Recurrence } | null {
    const rec = recurrenceOf(t.recurrence, t.name, 'recurrence', out);
    if (!rec) return null;
    const steps = stepsOf(t.steps, 40, MAX_ORBIT, t.name, ctx, out);
    if (steps === null) return null;
    const given = givenParts(t.given);
    const values: Value[] = [];
    for (const g of given) {
        const v = valueOf(g.value, 'given', t.name, ctx, out);
        if (v === null) return null;
        values.push(v);
    }
    let z = valueOf(str(t.start).trim() || '0', 'start', t.name, ctx, out);
    if (z === null) return null;
    let step: ReturnType<typeof recurrenceStep>;
    try {
        step = recurrenceStep(
            ctx.math,
            rec,
            given.map((g) => g.name)
        );
    } catch (e) {
        fail(out, t.name, 'recurrence', errorText(e));
        return null;
    }
    // Points in the plane are complex numbers where the step is one of complex numbers.
    const complex = !!step.complex && (isComplexLike(z) || values.some(isComplexLike));
    if (complex) {
        z = toComplex(z);
        for (let i = 0; i < values.length; i++) values[i] = toComplex(values[i]);
    }
    const far = FAR * size(ctx.view);
    const pts: Pt[] = [];
    for (let n = 0; n <= steps; n++) {
        const p = pointOf(z, n, complex);
        if (!p) {
            fail(out, t.name, 'recurrence', msg('iterate.problem.orbitPoint'));
            return null;
        }
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > far || Math.abs(p.y) > far) break;
        pts.push(p);
        if (n < steps) z = step.step(z, ...values);
    }
    return { pts, rec };
}

function computeOrbit(t: OrbitTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    if (!str(t.recurrence).trim()) return out;
    const got = orbitPoints(t, ctx, out);
    if (!got) return out;
    const { pts, rec } = got;
    const d = out.derived;
    d[`${t.name}_n`] = pts.length;
    const last = pts[pts.length - 1];
    if (last) {
        d[`${t.name}_x`] = last.x;
        d[`${t.name}_y`] = last.y;
    }
    if (!pts.length) return out;
    const color = str(t.color) || 'red';
    const width = str(t.thickness) || 'thin';
    // 6.0 F4: a traced orbit draws itself on the live canvas; the SVG keeps it whole (the still frame).
    const traced = t.traced === true;
    if (pts.length > 1) out.strokes.push(traced ? { lines: [pts], color, width, dashed: false, exact: true, still: true } : { lines: [pts], color, width, dashed: false, exact: true });
    const dots = t.path ? (pts.length === 1 ? 1 : 0) : Math.min(pts.length, MAX_DOTS);
    const size: MarkerSize = t.size === 'normal' || t.size === 'large' ? t.size : 'small';
    for (let i = 0; i < dots; i++) out.markers.push(traced && i > 0 ? { x: pts[i].x, y: pts[i].y, color, size, still: true } : { x: pts[i].x, y: pts[i].y, color, size: i === 0 ? 'normal' : size });
    // 6.0 F4: small heads on the longer steps show which way the orbit goes.
    const heads = stepHeads(pts, ctx, width, color);
    if (heads) out.fills.push(traced ? { ...heads, still: true } : heads);
    if (traced && pts.length > 1) {
        const n = pts.length - 1;
        const run: TraceRun = { pts, u: pts.map((_, i) => i / n), color, line: 0 };
        const reached = pts.slice(1, dots).map((p, i) => ({ x: p.x, y: p.y, u: (i + 1) / n, color, size }));
        out.live = [{ key: `${str(t.id)}:trace`, at: tracedAt([run], { width, head: { size: 'normal' }, dots: reached, seconds: orbitSeconds(n) / speedOf(t) }) }];
    }
    if (t.valueLabel) {
        const v = ctx.view;
        for (let i = 0; i < Math.min(pts.length, MAX_LABELS); i++) {
            const p = pts[i];
            if (p.x < v.xmin || p.x > v.xmax || p.y < v.ymin || p.y > v.ymax) continue;
            out.texts.push({ x: p.x, y: p.y, template: 'label', part: i, literal: stepName(rec.state, i), color, size: 'small', dir: UP_RIGHT, marker: i === 0 ? 'normal' : size });
        }
    }
    hold(out, { fit: pts });
    return out;
}

// ---------------------------------------------------------------- cobweb

/** The step x -> F(x) of a recurrence of numbers; null (with the problem) when it does not compile. */
function realStep(rec: Recurrence, name: string, ctx: SceneCtx, out: SceneOutput, inputs: string[] = []): ((x: number, ...rest: number[]) => number) | null {
    let step: ReturnType<typeof recurrenceStep>;
    try {
        step = recurrenceStep(ctx.math, rec, inputs);
    } catch (e) {
        fail(out, name, 'recurrence', errorText(e));
        return null;
    }
    const fast = step.complex;
    if (fast) {
        const inp = new Float64Array(2 + 2 * inputs.length);
        const o = new Float64Array(2);
        return (x, ...rest) => {
            inp[0] = x;
            for (let i = 0; i < rest.length; i++) inp[2 + 2 * i] = rest[i];
            fast.run(inp, o);
            return Math.abs(o[1]) <= 1e-12 * Math.max(1, Math.abs(o[0])) ? o[0] : NaN;
        };
    }
    return (x, ...rest) => {
        const v = step.step(x, ...rest);
        return typeof v === 'number' ? v : NaN;
    };
}

/** Opacity levels of the cobweb, earliest steps faintest (6.0 F4: more of them, so it fades in smoothly). */
const COBWEB_LEVELS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.72, 0.85, 1];

function computeCobweb(t: CobwebTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    if (!str(t.recurrence).trim()) return out;
    const rec = recurrenceOf(t.recurrence, t.name, 'recurrence', out);
    if (!rec) return out;
    const F = realStep(rec, t.name, ctx, out);
    if (!F) return out;
    const x0 = fieldValue(str(t.start).trim() || '0.2', 'start', t.name, ctx, out);
    const steps = stepsOf(t.steps, 40, MAX_COBWEB, t.name, ctx, out);
    if (x0 === null || steps === null) return out;
    const { view } = ctx;
    const color = str(t.color) || 'orange';
    const width = str(t.thickness) || 'thin';
    // y = x across the view.
    const lo = Math.max(view.xmin, view.ymin);
    const hi = Math.min(view.xmax, view.ymax);
    if (hi > lo) out.strokes.push({ lines: [[{ x: lo, y: lo }, { x: hi, y: hi }]], color: 'gray', width: 'thin', dashed: false, exact: true });
    // The graph of the map, unless it is a function the chart draws already (x_{n+1} = f(x_n)).
    const call = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(\s*([A-Za-z]+_[A-Za-z]|[A-Za-z]+_\{[A-Za-z]\})\s*\)\s*$/.exec(rec.formula);
    const shown = call ? ctx.functions.find((f) => f.name === call[1] && !f.hidden) : undefined;
    if (!shown) {
        const lines: Pt[][] = [];
        let run: Pt[] = [];
        const n = 400;
        const span = view.ymax - view.ymin;
        for (let i = 0; i <= n; i++) {
            const x = view.xmin + ((view.xmax - view.xmin) * i) / n;
            const y = F(x);
            if (Number.isFinite(y) && y > view.ymin - 4 * span && y < view.ymax + 4 * span) run.push({ x, y });
            else {
                if (run.length > 1) lines.push(run);
                run = [];
            }
        }
        if (run.length > 1) lines.push(run);
        if (lines.length) out.strokes.push({ lines, color: 'blue', width: 'thick', dashed: false });
    }
    // The path: (x0, 0), (x0, x1), (x1, x1), (x1, x2), ...
    const far = FAR * size(view);
    const path: Pt[] = [{ x: x0, y: 0 }];
    let x = x0;
    let done = 0;
    for (let k = 0; k < steps; k++) {
        const y = F(x);
        if (!Number.isFinite(y) || Math.abs(y) > far) break;
        path.push({ x, y }, { x: y, y });
        x = y;
        done++;
    }
    out.derived[`${t.name}_x`] = x;
    out.derived[`${t.name}_n`] = done;
    const legs = path.length - 1;
    COBWEB_LEVELS.forEach((opacity, k) => {
        const a = Math.floor((k * legs) / COBWEB_LEVELS.length);
        const b = Math.floor(((k + 1) * legs) / COBWEB_LEVELS.length);
        if (b <= a) return;
        const s: StrokePrim = { lines: [path.slice(a, b + 1)], color, width, dashed: false, exact: true };
        if (opacity < 1) s.opacity = opacity;
        out.strokes.push(s);
    });
    out.markers.push({ x: x0, y: 0, color, size: 'normal' });
    hold(out, { fit: path });
    return out;
}

// ---------------------------------------------------------------- Newton

function computeNewton(t: NewtonTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const name = str(t.function).trim();
    if (!name) return fail(out, t.name, 'function', msg('beyond.problem.chooseFunction'));
    const info = ctx.math.functionInfo(name);
    if (!info) return fail(out, t.name, 'function', msg('problems.scene.doesNotExist', { name }));
    if (info.kind !== 'cartesian') return fail(out, t.name, 'function', msg('beyond.problem.notCartesian', { name }));
    if (info.error || info.domainError) return fail(out, t.name, 'function', msg('problems.scene.hasError', { name }));
    const x0 = fieldValue(str(t.start).trim() || '1', 'start', t.name, ctx, out);
    const steps = stepsOf(t.steps, 5, MAX_NEWTON, t.name, ctx, out);
    if (x0 === null || steps === null) return out;
    const f = info.fn;
    const color = str(t.color) || 'red';
    const width = str(t.thickness) || 'thin';
    const fnColor = str(ctx.functions[info.index]?.color) || 'blue';
    const xs: number[] = [x0];
    let x = x0;
    const tangents: Pt[][] = [];
    const ups: Pt[][] = [];
    let stopped = false;
    for (let k = 0; k < steps; k++) {
        const y = f(x);
        const h = 1e-5 * Math.max(1, Math.abs(x));
        const slope = (f(x + h) - f(x - h)) / (2 * h);
        if (!Number.isFinite(y) || !Number.isFinite(slope) || slope === 0) {
            stopped = true;
            break;
        }
        const next = x - y / slope;
        if (!Number.isFinite(next)) {
            stopped = true;
            break;
        }
        ups.push([{ x, y: 0 }, { x, y }]);
        tangents.push([{ x, y }, { x: next, y: 0 }]);
        xs.push(next);
        x = next;
    }
    if (stopped) addIssue(out, t.name, 'start', msg('iterate.problem.newtonStopped', { k: xs.length - 1 }), 'info');
    const last = xs[xs.length - 1];
    out.derived[`${t.name}_x`] = last;
    out.derived[`${t.name}_val`] = f(last);
    out.derived[`${t.name}_n`] = xs.length - 1;
    if (ups.length) out.guides.push({ lines: ups, color: 'gray', width: 'thin', dashed: true, exact: true });
    if (tangents.length) out.strokes.push({ lines: tangents, color, width, dashed: false, exact: true });
    const span = ctx.view.xmax - ctx.view.xmin;
    xs.forEach((xk, k) => {
        out.markers.push({ x: xk, y: 0, color, size: k === xs.length - 1 ? 'normal' : 'small' });
        const yk = f(xk);
        if (k < xs.length - 1 && Number.isFinite(yk)) out.markers.push({ x: xk, y: yk, color: fnColor, size: 'small' });
        // A label only while it stands apart from the one before (the steps close in on the root).
        if (t.valueLabel && k <= MAX_LABELS && (k === 0 || Math.abs(xk - xs[k - 1]) > 0.04 * span)) {
            out.texts.push({ x: xk, y: 0, template: 'label', part: k, literal: `$x_{${k}}$`, color, size: 'small', dir: { x: 0, y: yk > 0 || !Number.isFinite(yk) ? -1 : 1 }, marker: 'small' });
        }
    });
    hold(out, { fit: [...xs.map((xk) => ({ x: xk, y: 0 })), ...ups.map((u) => u[1])] });
    return out;
}

// ----------------------------------------------------------- bifurcation

function computeBifurcation(t: BifurcationTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    if (!str(t.recurrence).trim()) return out;
    const rec = recurrenceOf(t.recurrence, t.name, 'recurrence', out);
    if (!rec) return out;
    const parameter = str(t.parameter).trim() || 'r';
    const a = fieldValue(str(t.from), 'from', t.name, ctx, out);
    const b = fieldValue(str(t.to), 'to', t.name, ctx, out);
    const x0 = fieldValue(str(t.start).trim() || '0.5', 'start', t.name, ctx, out);
    if (a === null || b === null || x0 === null) return out;
    if (!(b > a)) return fail(out, t.name, 'to', msg('beyond.problem.fromBelowTo'));
    let F: (x: number, r: number) => number;
    try {
        F = bifurcationStep(ctx.math, rec, parameter);
    } catch (e) {
        return fail(out, t.name, 'recurrence', errorText(e));
    }
    const color = str(t.color) || 'blue';
    const key = JSON.stringify(['bifurcation', rec.formula, parameter, a, b, x0, color, ctx.math.depsKey([rec.formula])]);
    out.pixels = [bifurcationPrim(F, { rec, parameter, from: a, to: b, start: x0, rgb: rgbOf(color), key })];
    return out;
}

// ------------------------------------------------------- colour the plane

function computePlane(t: PlaneColourTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const formula = str(t.formula).trim();
    if (!formula) return out;
    const opacity = Number.isFinite(t.opacity) ? Math.max(0, Math.min(1, t.opacity)) : 1;
    const kind = planeKind(formula);
    const sources = [formula, str(t.start), str(t.given), str(t.steps)];
    const key = (extra: unknown[]) => JSON.stringify(['plane', kind, formula, str(t.start), str(t.given), t.colormap ?? '', opacity, ...extra, ctx.math.depsKey(sources)]);
    let prim: PixelPrim;
    const rec = readRecurrence(formula);
    try {
        if (rec) {
            const steps = stepsOf(t.steps, 200, 1000, t.name, ctx, out);
            if (steps === null) return out;
            const given = givenParts(t.given);
            const start = str(t.start).trim();
            const xy = (s: string) => readsLetter(s, 'x') || readsLetter(s, 'y');
            // The plane in z_0 and one map for every pixel: the orbits that settle show the basins.
            const basins = xy(start) && !xy(rec.formula) && !given.some((g) => xy(g.value));
            const map = isPlaneColormap(t.colormap) ? t.colormap : 'cyclic';
            prim = escapePrim(ctx.math, { rec, start, given, steps, map, basins, opacity, key: key([steps]) });
        } else if (kind === 'domain') {
            prim = domainPrim(ctx.math, formulaParts(formula).body, opacity, key([]));
        } else {
            const parts = formulaParts(formula);
            const F = ctx.math.fn2(parts.body);
            const range = heatRange(F, ctx.view);
            if (!range) return fail(out, t.name, 'formula', msg('iterate.problem.noValues'));
            const map = isPlaneColormap(t.colormap) ? t.colormap : 'viridis';
            prim = heatPrim(ctx.math, parts.body, F, range, map, opacity, key([range]));
        }
    } catch (e) {
        return fail(out, t.name, 'formula', errorText(e));
    }
    out.pixels = [prim];
    return out;
}

// ------------------------------------------------------- turning circles

function computeCircles(t: FourierCirclesTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const src = str(t.sum).trim();
    if (!src) return out;
    let terms: FourierTerms;
    // 6.0 P: how many circles of a list of coefficients (`using n circles`).
    let count: number | undefined;
    if (str(t.count).trim()) {
        const v = fieldValue(str(t.count), 'count', t.name, ctx, out);
        if (v === null) return out;
        count = v;
    }
    try {
        terms = compileFourier(ctx.math, src, MAX_TERMS, count);
    } catch (e) {
        return fail(out, t.name, 'sum', errorText(e));
    }
    if (terms.capped) addIssue(out, t.name, 'sum', msg('iterate.problem.terms', { count: count === undefined && terms.count < MAX_COEFFICIENTS ? MAX_TERMS : MAX_COEFFICIENTS }), 'info');
    // The curve of the tip over one turn (t from 0 to 2 pi), and how far the chain reaches.
    const trace: Pt[] = [];
    let reach = 0;
    const n = 360;
    for (let i = 0; i <= n; i++) {
        const cs = terms.at((2 * Math.PI * i) / n);
        let re = 0;
        let im = 0;
        let r = 0;
        for (const c of cs) {
            re += c[0];
            im += c[1];
            r += Math.hypot(c[0], c[1]);
        }
        if (Number.isFinite(re) && Number.isFinite(im)) trace.push({ x: re, y: im });
        if (Number.isFinite(r)) reach = Math.max(reach, r);
    }
    const color = str(t.color) || 'blue';
    const width = str(t.thickness) || 'thick';
    // The curve of the tip, faint: the wave and the circles are what moves (6.0 F4: fainter still).
    if (trace.length > 1) out.strokes.push({ lines: [trace], color, width: 'thin', dashed: false, opacity: 0.25 });
    const circles = { terms, trace, reach, color, width, wave: !!t.wave, speed: FOURIER_SPEED * speedOf(t), path: t.path === true }; // path: 6.0 P
    hold(out, { circles, fit: trace });
    // 6.0 F4: the circles turn on the preview's live canvas.
    const view = { ...ctx.view };
    out.live = [{ key: `${str(t.id)}:circles`, at: (time) => circleShapes(circlesAt(circles, time * circles.speed, view), circles, time * circles.speed) }]; // tau: 6.0 P
    return out;
}

/** Circle polylines have this many legs. */
const CIRCLE_LEGS = 72;
/** 6.0 F4: the wave is red beside the circles' colour (rose beside cobalt, as the plan's picture). */
const WAVE_COLOR = 'red';

type Circles = NonNullable<IterateOutput['circles']>;

/** The turning circles at tau (radians of t): the circles, the arms, the tip, and the wave with where it starts. */
interface CircleParts {
    rings: Array<{ x: number; y: number; r: number }>;
    arms: Pt[];
    tip: Pt;
    wave: { pts: Pt[]; x0: number } | null;
}

function circlesAt(c: Circles, tau: number, view: View): CircleParts {
    const rings: CircleParts['rings'] = [];
    const arms: Pt[] = [{ x: 0, y: 0 }];
    let re = 0;
    let im = 0;
    for (const term of c.terms.at(tau)) {
        const r = Math.hypot(term[0], term[1]);
        if (!Number.isFinite(r)) break;
        if (r > 1e-9) rings.push({ x: re, y: im, r });
        re += term[0];
        im += term[1];
        arms.push({ x: re, y: im });
    }
    let wave: CircleParts['wave'] = null;
    if (c.wave) {
        // The imaginary part over the last turn, to the right of the circles, the newest point nearest them.
        const x0 = Math.max(c.reach * 1.25, view.xmin + 0.5 * (view.xmax - view.xmin));
        const span = view.xmax - x0;
        if (span > 0) {
            const pts: Pt[] = [];
            const n = 240;
            for (let i = 0; i <= n; i++) {
                const s = tau - (2 * Math.PI * i) / n;
                let y = 0;
                for (const term of c.terms.at(s)) y += term[1];
                if (Number.isFinite(y)) pts.push({ x: x0 + (span * i) / n, y });
            }
            wave = { pts, x0 };
        }
    }
    return { rings, arms, tip: { x: re, y: im }, wave };
}

/** The parts as live shapes: faint circles, the arms in the tool's colour, the wave in red with a dashed line to the tip. */
function circleShapes(p: CircleParts, c: Circles, tau = 0): LiveShapes {
    const out = emptyShapes();
    // 6.0 P: `with its path`: the last turn of the tip behind it, in the colour of the circles, older parts fainter (nothing jumps when a turn ends).
    if (c.path && c.trace.length > 2) {
        const turn = 2 * Math.PI;
        const n = c.trace.length - 1;
        const done = ((tau % turn) + turn) % turn;
        const k = Math.floor((done / turn) * n);
        const tail = [...c.trace.slice(k + 1, n), ...c.trace.slice(0, k + 1), p.tip];
        const pieces = 16;
        const per = Math.ceil(tail.length / pieces);
        for (let j = 0; j < pieces; j++) {
            const pts = tail.slice(j * per, Math.min(tail.length, (j + 1) * per + 1));
            if (pts.length > 1) out.lines.push({ pts, color: c.color, width: c.width, opacity: Math.round(((j + 1) / pieces) * 100) / 100 });
        }
    }
    for (const r of p.rings) out.rings.push({ ...r, color: 'gray', opacity: 0.4 });
    if (p.arms.length > 1) out.lines.push({ pts: p.arms, color: c.color, width: 'thin' });
    if (p.wave) {
        if (p.wave.pts.length > 1) out.lines.push({ pts: p.wave.pts, color: WAVE_COLOR, width: c.width });
        out.lines.push({ pts: [p.tip, { x: p.wave.x0, y: p.tip.y }], color: 'gray', width: 'thin', dashed: true, opacity: 0.7 });
        out.dots.push({ x: p.wave.x0, y: p.tip.y, color: WAVE_COLOR, size: 'small' });
    }
    out.dots.push({ x: p.tip.x, y: p.tip.y, color: c.color, size: 'small' });
    return out;
}

/**
 * The moving parts of turning circles at the frame's time (the still
 * frame: time 0 or the chart's stillTime): the circles, the arms, the tip,
 * and the wave. Null for other tools. Called after the scene memo. 6.0 F4:
 * marked still (the preview's live canvas turns them; the export draws these).
 */
export function iterateMotion(tool: Tool | undefined, out: SceneOutput, ctx: SceneCtx, frame: MotionFrame | undefined): { strokes: StrokePrim[]; markers: MarkerPrim[] } | null {
    if (!tool || tool.type !== 'fourierCircles') return null;
    const c = out.iterate?.circles;
    if (!c) return null;
    const p = circlesAt(c, clockTime(frame) * c.speed, ctx.view);
    const strokes: StrokePrim[] = [];
    const circles = p.rings.map((r) => {
        const ring: Pt[] = [];
        for (let k = 0; k <= CIRCLE_LEGS; k++) {
            const a = (2 * Math.PI * k) / CIRCLE_LEGS;
            ring.push({ x: r.x + r.r * Math.cos(a), y: r.y + r.r * Math.sin(a) });
        }
        return ring;
    });
    if (circles.length) strokes.push({ lines: circles, color: 'gray', width: 'thin', dashed: false, opacity: 0.4, still: true });
    if (p.arms.length > 1) strokes.push({ lines: [p.arms], color: c.color, width: 'thin', dashed: false, exact: true, still: true });
    // 6.0 P: `with its path`: the export draws the whole path (the preview draws it as the tip goes).
    if (c.path && c.trace.length > 1) strokes.push({ lines: [c.trace], color: c.color, width: c.width, dashed: false, still: true });
    const markers: MarkerPrim[] = [{ x: p.tip.x, y: p.tip.y, color: c.color, size: 'small', still: true }];
    if (p.wave) {
        if (p.wave.pts.length > 1) strokes.push({ lines: [p.wave.pts], color: WAVE_COLOR, width: c.width, dashed: false, still: true });
        strokes.push({ lines: [[p.tip, { x: p.wave.x0, y: p.tip.y }]], color: 'gray', width: 'thin', dashed: true, exact: true, opacity: 0.7, still: true });
        markers.push({ x: p.wave.x0, y: p.tip.y, color: WAVE_COLOR, size: 'small', still: true });
    }
    return { strokes, markers };
}

/** What a scene item of this part adds to the fit; null for other tools. */
export function iterateFitShapes(tool: Tool, item: SceneItem2D): { points: Pt[]; lines: Array<{ pts: Pt[]; closed: boolean }>; unbounded?: boolean } | null {
    if (!ITERATE_SCENE_TYPES.has(tool.type)) return null;
    if (tool.type === 'bifurcation' || tool.type === 'colourPlane') {
        const box = item.pixels?.[0]?.bounds?.() ?? null;
        if (!box) return { points: [], lines: [], unbounded: true };
        return { points: [{ x: box.xmin, y: box.ymin }, { x: box.xmax, y: box.ymax }], lines: [] };
    }
    const fit = FIT_HINTS.get(item.fills);
    if (fit) return { points: fit.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), lines: [] };
    return { points: item.markers.map((m) => ({ x: m.x, y: m.y })), lines: [] };
}
