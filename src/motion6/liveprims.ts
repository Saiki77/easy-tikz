/*
 * What moves on the clock in the preview (6.0 F4). The scene hands each
 * moving thing as a LivePrim: particles that follow a field, or shapes at a
 * time (a curve that draws itself, turning circles). The preview draws them
 * on a canvas inside the chart every frame (src/motion6/live.ts) while the
 * SVG keeps the still frame: there those parts are hidden in notes and the
 * editor, and drawn by the export, Copy SVG and the SVG files.
 *
 * Also here: the timing of a traced curve, and the default ramp of
 * `coloured by time`. Pure: no DOM.
 */
import type { Pt } from '../geometry';
import type { Colormap, MarkerSize } from '../types';

export interface LiveLine {
    pts: Pt[];
    /** A chart colour name or a hex colour. */
    color: string;
    /** Thickness key (THICKNESS_MAP). */
    width: string;
    opacity?: number;
    dashed?: boolean;
}

/** A circle in chart units (an ellipse on screen when the axes differ). */
export interface LiveRing {
    x: number;
    y: number;
    r: number;
    color: string;
    opacity?: number;
}

export interface LiveDot {
    x: number;
    y: number;
    color: string;
    size: MarkerSize;
    open?: boolean;
}

export interface LiveShapes {
    lines: LiveLine[];
    rings: LiveRing[];
    dots: LiveDot[];
}

/** A flow: particles that follow F and leave fading trails over faint arrows (src/motion6/live.ts). */
export interface LiveParticles {
    field: (x: number, y: number) => number[];
    /** Chart units per second per unit of |F|. */
    speed: number;
    color: string;
    /** The arrows' colour map (`coloured by length`); null: the text colour. */
    colormap: Colormap | null;
}

export interface LivePrim {
    /** The same across drawings of a chart (the tool's id and its part). */
    key: string;
    particles?: LiveParticles;
    /** The shapes at a time on the clock (seconds). */
    at?: (time: number) => LiveShapes;
}

export function emptyShapes(): LiveShapes {
    return { lines: [], rings: [], dots: [] };
}

// ---------------------------------------------------------- traced curves

/** A traced curve holds its whole picture this long before it starts again. */
export const TRACE_HOLD = 1.6;

/**
 * How much of a traced curve shows at a clock time: 0..1. The still frame
 * (time 0: the export, print, and a chart before its clock ran) shows it
 * whole; then it draws itself in `seconds`, stays whole a moment, and
 * starts again.
 */
export function traceFraction(time: number, seconds: number): number {
    if (!(time > 0) || !(seconds > 0)) return 1;
    const cycle = seconds + TRACE_HOLD;
    const phase = time - Math.floor(time / cycle) * cycle;
    return Math.min(1, phase / seconds);
}

/** Seconds a solution over t from t0 to t1 takes to draw itself. */
export function traceSeconds(t0: number, t1: number): number {
    const span = Number.isFinite(t1 - t0) ? t1 - t0 : 10;
    return Math.max(4, Math.min(20, span * 0.5));
}

/** Seconds an orbit of n steps takes to draw itself. */
export function orbitSeconds(steps: number): number {
    return Math.max(2, Math.min(12, steps * 0.25));
}

/** A run of one colour of a traced line: its points with where each comes in (0..1 of the drawing). */
export interface TraceRun {
    pts: Pt[];
    u: number[];
    color: string;
    /** Runs of one line share it: the head is drawn once per line. */
    line: number;
}

export interface TraceLook {
    width: string;
    dashed?: boolean;
    /** The dot at the head of each line (in the colour of the run it is on). */
    head: { size: MarkerSize };
    /** Dots the curve passes (an orbit's points), shown once reached. */
    dots?: Array<{ x: number; y: number; u: number; color: string; size: MarkerSize }>;
    seconds: number;
}

/** The first index of `u` (sorted) above f. */
function firstAbove(u: number[], f: number): number {
    let lo = 0;
    let hi = u.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (u[mid] <= f) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** The shapes of a traced curve at a clock time: each run up to the head, a dot at each head, the dots reached. */
export function tracedAt(runs: TraceRun[], look: TraceLook): (time: number) => LiveShapes {
    return (time) => {
        const f = traceFraction(time, look.seconds);
        const out = emptyShapes();
        const heads = new Map<number, { p: Pt; u: number; color: string }>();
        for (const run of runs) {
            const n = run.pts.length;
            if (!n || run.u[0] > f) continue;
            const k = firstAbove(run.u, f);
            const pts = run.pts.slice(0, k);
            let end = pts[pts.length - 1];
            let endU = run.u[k - 1];
            if (k < n && f < 1) {
                // The head lies between point k - 1 and point k.
                const a = run.pts[k - 1];
                const b = run.pts[k];
                const span = run.u[k] - run.u[k - 1];
                const s = span > 0 ? (f - run.u[k - 1]) / span : 0;
                end = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
                endU = f;
                pts.push(end);
            }
            if (pts.length > 1) out.lines.push({ pts, color: run.color, width: look.width, dashed: look.dashed });
            const h = heads.get(run.line);
            if (!h || endU >= h.u) heads.set(run.line, { p: end, u: endU, color: run.color });
        }
        for (const d of look.dots ?? []) if (d.u <= f) out.dots.push({ x: d.x, y: d.y, color: d.color, size: d.size });
        // The head in the colour of the curve where it is (a gradient's colour of the moment).
        if (f < 1) for (const h of heads.values()) out.dots.push({ x: h.p.x, y: h.p.y, color: h.color, size: look.head.size });
        return out;
    };
}

// ------------------------------------------------------------ time ramp

/**
 * The default ramp of `coloured by time`: cobalt, violet, rose, amber (the
 * plan's colours), light theme (the export) and dark theme. Through violet
 * and rose the middle stays bright, where a straight mix would turn grey.
 */
const RAMP_LIGHT: [number, number, number][] = [
    [37, 70, 196],
    [108, 61, 189],
    [189, 51, 80],
    [168, 100, 0],
];
const RAMP_DARK: [number, number, number][] = [
    [130, 160, 255],
    [184, 146, 255],
    [243, 120, 146],
    [242, 170, 60],
];

function hex(rgb: number[]): string {
    return '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');
}

function mix(stops: [number, number, number][], t: number): string {
    const k = Math.max(0, Math.min(1, t)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(k));
    const f = k - i;
    return hex([0, 1, 2].map((c) => stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f));
}

/** Colour levels of a curve coloured by time (the export defines each one). */
export const TIME_LEVELS = 24;

/** Level k of TIME_LEVELS of the default ramp, as #rrggbb (light theme, as the export prints it). */
export function rampColor(k: number, levels = TIME_LEVELS): string {
    return mix(RAMP_LIGHT, levels > 1 ? k / (levels - 1) : 0.5);
}

/** Light ramp colours with their dark-theme twins, for the renderers. */
const DARK_TWIN = new Map<string, string>();
for (let k = 0; k < TIME_LEVELS; k++) DARK_TWIN.set(rampColor(k), mix(RAMP_DARK, k / (TIME_LEVELS - 1)));

/** A colour as the preview shows it: a ramp colour in its dark-theme twin when the theme is dark. */
export function themedColor(color: string, dark: boolean): string {
    return dark ? DARK_TWIN.get(color) ?? color : color;
}

/** A dark-theme ramp colour back in its light twin (copied pictures in light colours), else the colour as it is. */
export function lightColor(color: string): string {
    for (const [light, dark] of DARK_TWIN) if (dark === color) return light;
    return color;
}
