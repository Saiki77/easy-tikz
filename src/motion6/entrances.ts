/*
 * Step entrances (6.0): when a step of a chart comes in, each of its objects
 * enters in its own way, as the approved demo showed:
 *
 *   draw    functions, curves, solutions, orbits, 3D curves: the line draws itself along its length (0.7 s)
 *   sweep   areas, regions, sets on an axis, the unit square: sweeps in from left to right (0.6 s)
 *   pop     points, corners, rest points, optima: pop in with a small overshoot, one after another (0.35 s each)
 *   grow    tangents, eigenvector lines: grow out from the point they belong to, both ways (0.5 s)
 *   arrow   arrows, vectors, basis vectors: grow from the tail to the tip (0.5 s)
 *   rise    labels: rise a few pixels and fade in, just after their object (0.35 s)
 *   ripple  vector fields, grids, coloured planes: ripple in from the centre (0.6 s)
 *   surface 3D surfaces: rise from the floor (0.7 s)
 *   fade    the rest (planes, braces, guides): fade in (0.35 s)
 *
 * Transforms keep their own motion (stepProgress over PROGRESS_MS). Only the
 * objects of the step that comes in move; Previous fades the objects of the
 * step that leaves (LEAVE_MS) and nothing plays backwards. The player
 * (timeline.ts) puts the time into the frame (MotionFrame.enter, .leave);
 * the renderers ask a StepEntrance how far each object is. The export,
 * print, SVG files and the AI tools draw the still frame: no entrance.
 *
 * Off for one chart with the chart line `set entrances = off` (the chart
 * field `entrances: false`), for every chart with the plugin setting (see
 * setStepEntrances), and under prefers-reduced-motion (the player).
 * Pure: no DOM.
 */
import type { Pt } from '../geometry';
import type { MotionFrame } from '../types';
import { STEP_LISTS, StepList, stepOf } from './steps';

type Data = Record<string, unknown>;

export type EntranceKind = 'draw' | 'sweep' | 'pop' | 'grow' | 'arrow' | 'rise' | 'ripple' | 'surface' | 'fade' | 'none';

/** How long each kind of entrance takes (ms). */
export const ENTRANCE_MS: Readonly<Record<EntranceKind, number>> = {
    draw: 700,
    sweep: 600,
    pop: 350,
    grow: 500,
    arrow: 500,
    rise: 350,
    ripple: 600,
    surface: 700,
    fade: 350,
    none: 0,
};

/** Between two points of a step that pop in. */
export const POP_STAGGER_MS = 40;
/** The last of many points starts popping by then (the stagger shrinks to fit). */
export const POP_STAGGER_MAX_MS = 320;
/** A label starts this far into its object's entrance. */
export const LABEL_AFTER = 0.6;
/** Previous: the objects of the step that leaves fade out in this long. */
export const LEAVE_MS = 200;
/** A label rises this far (px) while it fades in. */
export const RISE_PX = 8;
/** The soft edge of a ripple, as a part of its radius. */
export const RIPPLE_EDGE = 0.35;

// ------------------------------------------------------------------ off switches

let setting = true;

/** The plugin setting "Step entrances" (on by default): main.ts sets it on load and when it changes. */
export function setStepEntrances(on: boolean): void {
    setting = on;
}

/** Whether the plugin setting lets objects enter. */
export function stepEntrancesSetting(): boolean {
    return setting;
}

/** Whether the chart lets its objects enter (the chart line `set entrances = off` turns it off). */
export function chartEntrances(data: Data | null | undefined): boolean {
    const v = data ? data.entrances : undefined;
    return !(v === false || v === 'off' || v === 0);
}

/** Whether objects enter in this chart: the setting and the chart both let them (the player also asks the system for less motion). */
export function entrancesOn(data: Data | null | undefined): boolean {
    return setting && chartEntrances(data);
}

// ------------------------------------------------------------------ easing

const clamp01 = (k: number) => (k > 0 ? (k < 1 ? k : 1) : 0);

/** Ease out (cubic): fast start, gentle landing. */
export function easeOut(k: number): number {
    const t = clamp01(k);
    return 1 - Math.pow(1 - t, 3);
}

/** The scale of a point popping in: 0 at the start, a small overshoot (about 12 %), 1 at the end. */
export function popScale(k: number): number {
    const t = clamp01(k);
    if (t <= 0) return 0;
    const c1 = 2.2;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** A label `k` (0..1, linear) through its rise: how far below its spot (px) and how opaque. */
export function riseAt(k: number): { dy: number; opacity: number } {
    return { dy: RISE_PX * (1 - easeOut(k)), opacity: clamp01(k * 1.5) };
}

/**
 * The opacity of a ripple at distance `d` from its centre (0 the centre, 1
 * the farthest point), `k` (eased, 0..1) through it: 1 inside the wave, 0
 * outside, a soft edge between. At k = 1 everything is in.
 */
export function rippleOpacity(k: number, d: number): number {
    const front = clamp01(k) * (1 + RIPPLE_EDGE);
    return clamp01((front - d) / RIPPLE_EDGE);
}

/** The gradient of a ripple at `k`: two stops (offset 0..1, opacity), linear between them, which is exactly rippleOpacity. */
export function rippleStops(k: number): Array<{ offset: number; opacity: number }> {
    const front = clamp01(k) * (1 + RIPPLE_EDGE);
    const a = Math.max(0, Math.min(1, front - RIPPLE_EDGE));
    const b = Math.max(a, Math.min(1, front));
    return [
        { offset: a, opacity: rippleOpacity(k, a) },
        { offset: b, opacity: rippleOpacity(k, b) },
    ];
}

// ------------------------------------------------------------------ kinds

/** The entrance of a tool by its type (and the options that change it). */
export function toolKind(tool: Data): EntranceKind {
    const type = String(tool.type);
    switch (type) {
        case 'region':
        case 'riemann':
        case 'probability':
        case 'unitSquare':
        case 'axisSet':
            return 'sweep';
        case 'points':
        case 'restPoints':
        case 'listPoints':
            return 'pop';
        case 'eigenvectors':
            return 'grow';
        case 'vector':
        case 'basisVectors':
            return 'arrow';
        case 'vectorField':
        case 'slopeField':
        case 'planeGrid':
        case 'colourPlane':
        case 'bifurcation':
        case 'span':
            return 'ripple';
        case 'segment': {
            const style = String(tool.style);
            if (style === 'forward' || style === 'backward' || style === 'both') return 'arrow';
            return style === 'brace' ? 'fade' : 'draw';
        }
        case 'dataPlot': {
            const style = String(tool.style);
            return style === 'bars' ? 'sweep' : style === 'points' ? 'pop' : 'draw';
        }
        case 'distribution':
            return String(tool.kind) === 'binomial' ? 'sweep' : 'draw';
        case 'trajectory':
        case 'orbit':
            // A traced one draws itself on the clock already.
            return tool.traced === true ? 'fade' : 'draw';
        case 'curve':
        case 'solution':
        case 'cobweb':
        case 'newton':
        case 'chord':
        case 'geogebra':
        case 'python':
            return 'draw';
        case 'transform':
        case 'value':
        case 'data':
            return 'none';
        default:
            return 'fade';
    }
}

/** The entrance of an object of a chart list (its main kind: its labels rise after it, its points pop). */
export function objectKind(list: StepList, obj: Data): EntranceKind {
    if (list === 'functions') return 'draw';
    if (list === 'functions3D') return 'surface';
    if (list === 'annotations') return 'rise';
    return toolKind(obj);
}

function itemsOf(data: Data, list: StepList): Data[] {
    const v = data[list];
    return Array.isArray(v) ? v.filter((x): x is Data => !!x && typeof x === 'object' && !Array.isArray(x)) : [];
}

/** When an object's labels start, after its own entrance of `kind` starting at `start`. */
export function labelStart(kind: EntranceKind, start = 0): number {
    return start + LABEL_AFTER * ENTRANCE_MS[kind];
}

/**
 * The timing of one step: when its free labels (`write ... at`) start, just
 * after the other objects of the step, and how long the whole step takes
 * to come in (0 when nothing in it enters). Points are counted as if many
 * popped, so the time is never too short.
 */
export function stepTiming(data: Data, step: number): { labels: number; total: number } {
    let main = 0;
    let end = 0;
    let freeLabels = false;
    for (const list of STEP_LISTS) {
        for (const obj of itemsOf(data, list)) {
            if (obj.hidden === true || stepOf(obj) !== step) continue;
            const kind = objectKind(list, obj);
            if (kind === 'none') continue;
            if (list === 'annotations') {
                freeLabels = true;
                continue;
            }
            const start = kind === 'pop' ? POP_STAGGER_MAX_MS : 0;
            main = Math.max(main, ENTRANCE_MS[kind]);
            // The object, then its labels (the time counts them whether it has any or not).
            end = Math.max(end, start + ENTRANCE_MS[kind], labelStart(kind, start) + ENTRANCE_MS.rise);
        }
    }
    const labels = LABEL_AFTER * main;
    if (freeLabels) end = Math.max(end, labels + ENTRANCE_MS.rise);
    return { labels, total: Math.ceil(end) };
}

/** How long step `step` of a chart takes to come in (ms); 0 when nothing in it enters. */
export function entranceMs(data: Data, step: number): number {
    return stepTiming(data, step).total;
}

/** The delay of point `i` of `n` that pop in together. */
export function popDelay(i: number, n: number): number {
    if (n <= 1 || i <= 0) return 0;
    const gap = Math.min(POP_STAGGER_MS, POP_STAGGER_MAX_MS / (n - 1));
    return Math.min(i, n - 1) * gap;
}

// ------------------------------------------------------------------ one frame

/**
 * The entrances of one frame, for a renderer: which objects move (those of
 * the step the frame shows, while it comes in or leaves) and how far each
 * kind of entrance is. Null (see `of`) when nothing moves: the still frame,
 * a settled step, or entrances off.
 */
export class StepEntrance {
    /** The step whose objects move. */
    readonly step: number;
    /** ms since the step came in (Infinity while it leaves: every entrance done). */
    readonly ms: number;
    /** The opacity of the objects that move: 1 while they come in, down to 0 while they leave. */
    readonly fade: number;
    /** When the free labels of the step start (ms). */
    readonly labels: number;

    private constructor(step: number, ms: number, fade: number, labels: number) {
        this.step = step;
        this.ms = ms;
        this.fade = fade;
        this.labels = labels;
    }

    /** The entrances of `frame` for a chart (its lists: functions, functions3D, tools, annotations), or null when nothing moves. */
    static of(frame: MotionFrame | undefined, chart: Data): StepEntrance | null {
        if (!frame || typeof frame.index !== 'number') return null;
        const leaving = typeof frame.leave === 'number' && Number.isFinite(frame.leave);
        const entering = typeof frame.enter === 'number' && Number.isFinite(frame.enter);
        if (!leaving && !entering) return null;
        const step = frame.index;
        if (leaving) return new StepEntrance(step, Infinity, 1 - clamp01(frame.leave as number), 0);
        return new StepEntrance(step, Math.max(0, frame.enter as number), 1, stepTiming(chart, step).labels);
    }

    /** Whether the object moves in this frame (its step is the one that comes in or leaves). */
    moves(obj: unknown): boolean {
        return !!obj && typeof obj === 'object' && stepOf(obj) === this.step;
    }

    /** Whether the objects that move are leaving (Previous). */
    get leaving(): boolean {
        return this.ms === Infinity;
    }

    /** The raw progress (0..1) of an entrance of `kind` that starts `delay` ms after the step. */
    linear(kind: EntranceKind, delay = 0): number {
        const ms = ENTRANCE_MS[kind];
        if (!(ms > 0)) return 1;
        return clamp01((this.ms - delay) / ms);
    }

    /** How far an entrance of `kind` that starts `delay` ms after the step is, eased (pop: the scale, past 1 for a moment). */
    at(kind: EntranceKind, delay = 0): number {
        const k = this.linear(kind, delay);
        if (kind === 'pop') return popScale(k);
        if (kind === 'rise' || kind === 'fade') return k;
        return easeOut(k);
    }
}

// ------------------------------------------------------------------ shapes

type Metric = (a: Pt, b: Pt) => number;
const plain: Metric = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** The first `f` (0..1) of a polyline's length, measured with `metric` (screen pixels, say). */
export function partialLine(line: Pt[], f: number, metric: Metric = plain): Pt[] {
    if (f >= 1 || line.length < 2) return line;
    if (f <= 0) return [line[0]];
    let total = 0;
    const lengths: number[] = [];
    for (let i = 1; i < line.length; i++) {
        const d = metric(line[i - 1], line[i]);
        const len = Number.isFinite(d) ? d : 0;
        lengths.push(len);
        total += len;
    }
    return cutAt(line, lengths, f * total);
}

function cutAt(line: Pt[], lengths: number[], want: number): Pt[] {
    const out: Pt[] = [line[0]];
    let left = want;
    for (let i = 1; i < line.length; i++) {
        const len = lengths[i - 1];
        if (left >= len) {
            out.push(line[i]);
            left -= len;
            if (left <= 0) break;
            continue;
        }
        const t = len > 0 ? left / len : 0;
        const a = line[i - 1];
        const b = line[i];
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        break;
    }
    return out;
}

/**
 * The polylines of an object `f` (0..1) of the way through drawing
 * themselves. `sequential`: one after another (the pieces of a function,
 * left to right); otherwise each piece draws at once from its start.
 */
export function partialLines(lines: Pt[][], f: number, sequential: boolean, metric: Metric = plain): Pt[][] {
    if (f >= 1) return lines;
    if (!sequential) return lines.map((l) => partialLine(l, f, metric));
    const lengths = lines.map((l) => {
        const out: number[] = [];
        for (let i = 1; i < l.length; i++) {
            const d = metric(l[i - 1], l[i]);
            out.push(Number.isFinite(d) ? d : 0);
        }
        return out;
    });
    const total = lengths.reduce((s, ls) => s + ls.reduce((a, b) => a + b, 0), 0);
    let left = Math.max(0, f) * total;
    const out: Pt[][] = [];
    lines.forEach((l, i) => {
        if (left <= 0 || l.length < 2) return;
        const len = lengths[i].reduce((a, b) => a + b, 0);
        out.push(left >= len ? l : cutAt(l, lengths[i], left));
        left -= len;
    });
    return out;
}

/** A line `e` (0..1) of the way grown out of `anchor`, both ways: every point moved toward it. */
export function grownLine(line: Pt[], anchor: Pt, e: number): Pt[] {
    if (e >= 1) return line;
    return line.map((p) => ({ x: anchor.x + (p.x - anchor.x) * e, y: anchor.y + (p.y - anchor.y) * e }));
}

/** The middle of a polyline's ends (where a line through the origin starts growing). */
export function middleOf(line: Pt[]): Pt {
    const a = line[0];
    const b = line[line.length - 1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The point of `line` nearest `p` (a tangent grows out of its touching point, which lies on it). */
export function nearestOn(line: Pt[], p: Pt): Pt {
    let best = line[0];
    let bestD = Infinity;
    for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
        const q = { x: a.x + dx * t, y: a.y + dy * t };
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
            bestD = d;
            best = q;
        }
    }
    return best;
}
