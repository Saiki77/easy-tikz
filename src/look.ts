/*
 * The chart look (6.1): Clean (default) or Classic, a setting. Clean draws a
 * chart the way the 6.0 film shows it: axes through the middle without
 * arrowheads, thin and light grey (at the near edge when 0 is outside the
 * view), a light grid, small grey numbers without the 0 at the origin and
 * out of the way of marked points and curves, no axis letters unless the
 * chart names its axes, slightly thicker functions and value labels in
 * soft pills. Classic is the look of 6.0 and before.
 *
 * The look only fills in what a chart leaves open. What a chart sets wins:
 * axes in a box (the whole chart then draws as Classic), on the edges or in
 * the middle, a grid on or off, a grid opacity, axis names, a thickness.
 * Charts store "left open" as 'auto' (axis_style, showLargeGrid) and as an
 * empty thickness (functions), so the text syntax prints nothing for it and
 * both looks print the same text.
 *
 * Before 6.1 the editor wrote every field into JSON blocks, the defaults
 * too, so `"axis_style": "box"` there does not say that someone chose a
 * box. settleLook reads such blocks (a complete dump without the `look`
 * key, which 6.1 writes) with the old defaults as left open.
 *
 * Pure: no DOM, no Obsidian. The setting is module state, set by the plugin
 * when it loads (like the interface language).
 */
import type { AxisStyle, FunctionParameters } from './types';

export type ChartLook = 'clean' | 'classic';

/** A field the chart leaves open: the look decides. */
export const AUTO = 'auto';

let current: ChartLook = 'clean';

/** The setting Chart look. */
export function chartLook(): ChartLook {
    return current;
}

export function setChartLook(look: ChartLook): void {
    current = look;
}

/** A stored setting value as a look: Classic only when it says so. */
export function lookSetting(v: unknown): ChartLook {
    return v === 'classic' ? 'classic' : 'clean';
}

/** The look a chart draws in: its own `look` field ('clean' or 'classic'), else the setting. */
export function lookOf(own: unknown): ChartLook {
    return own === 'clean' || own === 'classic' ? own : current;
}

/** The axis style a chart stores: one of the three, or left open. */
export function storedAxisStyle(v: unknown): AxisStyle | 'auto' {
    return v === 'box' || v === 'middle' || v === 'axes' ? v : 'auto';
}

/**
 * The look a 2D chart is drawn in, and the axis style and major grid it
 * gets. Polar and 3D charts keep their own (Classic) look; a chart that asks
 * for axes in a box draws wholly as Classic, so it looks as it always did.
 */
export function resolveLook(look: ChartLook, stored: { axisStyle: unknown; grid: unknown; polar: boolean; is3D: boolean }): { look: ChartLook; axisStyle: AxisStyle; gridMajor: boolean } {
    const style = storedAxisStyle(stored.axisStyle);
    const clean = look === 'clean' && !stored.polar && !stored.is3D && style !== 'box';
    return {
        look: clean ? 'clean' : 'classic',
        axisStyle: style === 'auto' ? (clean ? 'middle' : 'box') : style,
        gridMajor: stored.grid === true || (stored.grid !== false && clean),
    };
}

/** Keys a complete dump of the editor always held (4.0 to 6.0, and 3.x): a JSON block written by hand or an AI rarely holds them all. */
const DUMP_KEYS = ['axis_style', 'showLargeGrid', 'showSmallGrid', 'show_axis_label', 'showAxis', 'gridSize', 'majorTickNum', 'previewSize'];

/**
 * A chart as stored, with the defaults a complete dump from before 6.1
 * wrote read as left open: axes in a box, no grid and thin functions were
 * written because they were the defaults, not because someone chose them.
 * Blocks with the `look` key (6.1 and later) and partial blocks (text,
 * minimized JSON, JSON by hand or an AI) stay as they are. Returns `data`
 * itself when nothing changes.
 */
export function settleLook<T extends Record<string, unknown>>(data: T): T {
    if (!data || typeof data !== 'object' || 'look' in data) return data;
    if (!DUMP_KEYS.every((k) => k in data)) return data;
    const out: Record<string, unknown> = { ...data };
    if (out.axis_style === 'box') out.axis_style = AUTO;
    if (out.showLargeGrid === false) out.showLargeGrid = AUTO;
    if (Array.isArray(out.functions)) {
        out.functions = out.functions.map((f: unknown) => (f && typeof f === 'object' && (f as FunctionParameters).thickness === 'thin' ? { ...(f as FunctionParameters), thickness: '' } : f));
    }
    return out as T;
}

// ------------------------------------------------------------ the clean look's sizes and colours

/** Width in px of a function's line that sets no thickness (Classic: thin, 1.5 px): as bold as thick (2.5 px), like the 6.0 film. */
export const CLEAN_LINE_PX = 2.5;
/** The same line in the export: thick (0.8pt), as on screen. */
export const CLEAN_LINE_TIKZ = 'thick';
/** Tick numbers in pt of the exported figure (\scriptsize); Classic sets them at 10 pt. */
export const CLEAN_TICK_PT = 7;
/** Axis lines in px. */
export const CLEAN_AXIS_PX = 1.2;
/** Grid lines: the grid ink at this many times the chart's grid opacity (0.5 by default: 0.12, about #eceef3 on white). */
export const CLEAN_GRID_ALPHA = 0.24;

/**
 * Theme colours of the clean look (styles.css defines them on body for the
 * light and the dark theme); the fallbacks are the light theme's, which the
 * export uses too.
 */
export const CLEAN_COLOURS = {
    grid: '#61719B',
    axis: '#B4B7C2',
    tick: '#8B8D98',
    pillLine: '#E3E4EA',
} as const;

export const CLEAN_VARS = {
    grid: `var(--etz-clean-grid, ${CLEAN_COLOURS.grid})`,
    axis: `var(--etz-clean-axis, ${CLEAN_COLOURS.axis})`,
    tick: `var(--etz-clean-tick, ${CLEAN_COLOURS.tick})`,
    pillLine: `var(--etz-clean-pill-line, ${CLEAN_COLOURS.pillLine})`,
} as const;

// ------------------------------------------------------------ where the axes go

/** Where one axis line lies: through 0, or at the low or high edge of the view (0 is outside it). */
export type AxisPlace = 'zero' | 'low' | 'high';

/** The place of the axis that crosses the other axis at 0 of the range lo..hi. */
export function axisPlace(lo: number, hi: number): AxisPlace {
    if (lo > 0) return 'low';
    if (hi < 0) return 'high';
    return 'zero';
}

// ------------------------------------------------------------ numbers out of the way

/** A rectangle in screen units (y down). */
export interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

/** What a tick number keeps clear of: marked points (centre and radius) and drawn curves (polylines), in screen units. */
export interface TickObstacles {
    dots: Array<{ x: number; y: number; r: number }>;
    lines: Array<Array<{ x: number; y: number }>>;
}

/** Does the segment a-b touch the box? */
function segmentHitsBox(ax: number, ay: number, bx: number, by: number, b: Box): boolean {
    if (Math.max(ax, bx) < b.x0 || Math.min(ax, bx) > b.x1 || Math.max(ay, by) < b.y0 || Math.min(ay, by) > b.y1) return false;
    const inside = (x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
    if (inside(ax, ay) || inside(bx, by)) return true;
    // Liang-Barsky clip of the segment against the box.
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const edges: Array<[number, number]> = [
        [-dx, ax - b.x0],
        [dx, b.x1 - ax],
        [-dy, ay - b.y0],
        [dy, b.y1 - ay],
    ];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return false;
            continue;
        }
        const r = q / p;
        if (p < 0) {
            if (r > t1) return false;
            if (r > t0) t0 = r;
        } else {
            if (r < t0) return false;
            if (r < t1) t1 = r;
        }
    }
    return t0 <= t1;
}

/** A tick number in `box` is clear: no marked point within `gap` of it, no curve through it. */
export function tickClear(box: Box, obstacles: TickObstacles, gap: number): boolean {
    for (const d of obstacles.dots) {
        const nx = Math.max(box.x0, Math.min(d.x, box.x1));
        const ny = Math.max(box.y0, Math.min(d.y, box.y1));
        if (Math.hypot(nx - d.x, ny - d.y) < d.r + gap) return false;
    }
    for (const line of obstacles.lines) {
        for (let i = 0; i + 1 < line.length; i++) {
            const a = line[i];
            const b = line[i + 1];
            if (segmentHitsBox(a.x, a.y, b.x, b.y, box)) return false;
        }
    }
    return true;
}

/** Where the axes of a clean chart are on screen, to place their numbers (any one unit, y down). */
export interface CleanAxisFrame {
    sx(v: number): number;
    sy(v: number): number;
    /** Screen x of the y-axis line and screen y of the x-axis line. */
    ox: number;
    oy: number;
    place: { x: AxisPlace; y: AxisPlace };
    /** Font size of the numbers, their gap to the axis line, and a character's width in em. */
    fs: number;
    gap: number;
    charEm: number;
}

/** One number of an axis in the clean look: its text, where it is drawn (baseline) and whether it shows. */
export interface TickSpot<T> {
    tick: T;
    text: string;
    x: number;
    y: number;
    anchor: 'start' | 'middle' | 'end';
    box: Box;
    show: boolean;
}

/**
 * The numbers of one axis in the clean look, shared by the preview and the
 * export so both leave out the same ones: x numbers under the x-axis (over
 * it at the top edge), y numbers left of the y-axis (right of it at the
 * right edge); the 0 where the two axes cross is left out (unless the chart
 * lists it: `listed`), and so is a number on a marked point or under a curve.
 */
export function cleanTickSpots<T extends { value: number }>(
    axis: 'x' | 'y',
    ticks: readonly T[],
    textOf: (t: T) => string,
    o: { step: number; listed: boolean; frame: CleanAxisFrame; obstacles: TickObstacles }
): Array<TickSpot<T>> {
    const f = o.frame;
    const out: Array<TickSpot<T>> = [];
    for (const tick of ticks) {
        const text = textOf(tick);
        const tw = text.length * f.fs * f.charEm;
        let spot: TickSpot<T>;
        if (axis === 'x') {
            const px = f.sx(tick.value);
            const y0 = f.place.x === 'high' ? f.oy - f.gap - f.fs : f.oy + f.gap;
            spot = { tick, text, x: px, y: y0 + 0.8 * f.fs, anchor: 'middle', box: { x0: px - tw / 2, x1: px + tw / 2, y0, y1: y0 + f.fs }, show: true };
        } else {
            const py = f.sy(tick.value);
            const after = f.place.y === 'high';
            const x = after ? f.ox + f.gap : f.ox - f.gap;
            spot = { tick, text, x, y: py + 0.35 * f.fs, anchor: after ? 'start' : 'end', box: { x0: after ? x : x - tw, x1: after ? x + tw : x, y0: py - 0.5 * f.fs, y1: py + 0.5 * f.fs }, show: true };
        }
        const crossing = (axis === 'x' ? f.place.y : f.place.x) === 'zero' && !o.listed && Math.abs(tick.value) < o.step * 0.01;
        spot.show = !!text.trim() && !crossing && tickClear(spot.box, o.obstacles, 0.25 * f.fs);
        out.push(spot);
    }
    return out;
}
