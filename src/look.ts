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
 * 6.2.1: four settings change the axes of either look one by one: Axis
 * lines (thin or thick), Axis arrows, Axis names (x and y always, or only
 * names the chart gives) and Axis numbers (small or large), each As the look
 * by default. A chart can set each of them itself (axis_lines, axis_arrows,
 * axis_names, axis_numbers: the lines `thick axes`, `axes with arrows`,
 * `with axis names`, `small numbers` and their opposites, or the editor's
 * Chart tab), and what it sets wins (resolveAxes).
 *
 * Pure: no DOM, no Obsidian. The settings are module state, set by the
 * plugin when it loads (like the interface language).
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
export function resolveLook(look: ChartLook, stored: { axisStyle: unknown; grid: unknown; polar: boolean; is3D: boolean; showAxis?: boolean }): { look: ChartLook; axisStyle: AxisStyle; gridMajor: boolean } {
    const style = storedAxisStyle(stored.axisStyle);
    const clean = look === 'clean' && !stored.polar && !stored.is3D && style !== 'box';
    return {
        look: clean ? 'clean' : 'classic',
        axisStyle: style === 'auto' ? (clean ? 'middle' : 'box') : style,
        // 6.2: a chart with `no axes` (a diagram) gets no grid unless it asks for one.
        gridMajor: stored.grid === true || (stored.grid !== false && clean && stored.showAxis !== false),
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

// ------------------------------------------------------------ 6.2.1: the axes, one by one

/** The axis lines: thin (the clean look's thin light grey line) or thick (Classic's darker, wider line). */
export type AxisLine = 'thin' | 'thick';
/** The axis names: always (the letters x and y too) or only names the chart gives its axes (named). */
export type AxisNames = 'always' | 'named';
/** The axis numbers: small (\scriptsize, 7 pt, the clean look's) or large (10 pt, Classic's). */
export type AxisNumberSize = 'small' | 'large';

/** How a chart draws its axes: what its look gives, what the four settings change and what the chart sets itself. */
export interface AxisLook {
    line: AxisLine;
    /** Arrowheads at the ends of axis lines (never on a box). */
    arrows: boolean;
    names: AxisNames;
    numbers: AxisNumberSize;
}

/** What each look draws. */
export const LOOK_AXES: Readonly<Record<ChartLook, Readonly<AxisLook>>> = {
    clean: { line: 'thin', arrows: false, names: 'named', numbers: 'small' },
    classic: { line: 'thick', arrows: true, names: 'always', numbers: 'large' },
};

/** The four settings under Chart look (Axis lines, Axis arrows, Axis names, Axis numbers): 'look' is As the look. */
export interface AxisSettings {
    line: 'look' | AxisLine;
    arrows: 'look' | 'on' | 'off';
    names: 'look' | AxisNames;
    numbers: 'look' | AxisNumberSize;
}

/** Every setting As the look: the axes of the chosen look, as up to 6.2.0. */
export const AS_THE_LOOK: Readonly<AxisSettings> = { line: 'look', arrows: 'look', names: 'look', numbers: 'look' };

let axes: AxisSettings = { ...AS_THE_LOOK };

/** The four settings now. */
export function axisSettings(): AxisSettings {
    return { ...axes };
}

export function setAxisSettings(s: AxisSettings): void {
    axes = { ...s };
}

const pick = <T extends string>(v: unknown, values: readonly T[]): T | null => (typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : null);

/** Stored setting values (plugin data axisLines, axisArrows, axisNames, axisNumbers) as settings: As the look unless one says otherwise. */
export function axisSettingsOf(stored: { axisLines?: unknown; axisArrows?: unknown; axisNames?: unknown; axisNumbers?: unknown } | null | undefined): AxisSettings {
    const s = stored ?? {};
    return {
        line: pick(s.axisLines, ['thin', 'thick'] as const) ?? 'look',
        arrows: pick(s.axisArrows, ['on', 'off'] as const) ?? 'look',
        names: pick(s.axisNames, ['always', 'named'] as const) ?? 'look',
        numbers: pick(s.axisNumbers, ['small', 'large'] as const) ?? 'look',
    };
}

/**
 * What a chart sets itself (the chart fields axis_lines, axis_arrows,
 * axis_names and axis_numbers: `thin axes`, `axes without arrows`, `no axis
 * letters`, `large numbers`, ...): one of their values, else null, left open
 * ('auto', the default). Arrows also take true and false.
 */
export function ownAxes(fields: { line?: unknown; arrows?: unknown; names?: unknown; numbers?: unknown }): { line: AxisLine | null; arrows: boolean | null; names: AxisNames | null; numbers: AxisNumberSize | null } {
    const arrows = fields.arrows === true || fields.arrows === 'on' ? true : fields.arrows === false || fields.arrows === 'off' ? false : null;
    return {
        line: pick(fields.line, ['thin', 'thick'] as const),
        arrows,
        names: pick(fields.names, ['always', 'named'] as const),
        numbers: pick(fields.numbers, ['small', 'large'] as const),
    };
}

/**
 * The axes of a chart drawn in `look` (the look it is drawn in: a box, a
 * polar or a 3D chart is Classic): each of the four is what the chart sets,
 * else the setting, else the look's.
 */
export function resolveAxes(look: ChartLook, fields: { line?: unknown; arrows?: unknown; names?: unknown; numbers?: unknown }, settings: AxisSettings = axes): AxisLook {
    const own = ownAxes(fields);
    const base = LOOK_AXES[look];
    return {
        line: own.line ?? (settings.line !== 'look' ? settings.line : base.line),
        arrows: own.arrows ?? (settings.arrows !== 'look' ? settings.arrows === 'on' : base.arrows),
        names: own.names ?? (settings.names !== 'look' ? settings.names : base.names),
        numbers: own.numbers ?? (settings.numbers !== 'look' ? settings.numbers : base.numbers),
    };
}

// ------------------------------------------------------------ the clean look's sizes and colours

/** Width in px of a function's line that sets no thickness (Classic: thin, 1.5 px): as bold as thick (2.5 px), like the 6.0 film. */
export const CLEAN_LINE_PX = 2.5;
/** The same line in the export: thick (0.8pt), as on screen. */
export const CLEAN_LINE_TIKZ = 'thick';
/** Tick numbers in pt of the exported figure (\scriptsize); Classic sets them at 10 pt. */
export const CLEAN_TICK_PT = 7;
/** 6.2.1: the numbers of an axis in pt: small (the clean look's \scriptsize) or large (Classic's 10 pt, pgfplots' own size). */
export const NUMBER_PT: Readonly<Record<AxisNumberSize, number>> = { small: CLEAN_TICK_PT, large: 10 };
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

/** A tick number in `box` is clear: no marked point within `gap` of it, no curve within `gap` of it. */
export function tickClear(box: Box, obstacles: TickObstacles, gap: number): boolean {
    for (const d of obstacles.dots) {
        const nx = Math.max(box.x0, Math.min(d.x, box.x1));
        const ny = Math.max(box.y0, Math.min(d.y, box.y1));
        if (Math.hypot(nx - d.x, ny - d.y) < d.r + gap) return false;
    }
    const near: Box = { x0: box.x0 - gap, y0: box.y0 - gap, x1: box.x1 + gap, y1: box.y1 + gap };
    for (const line of obstacles.lines) {
        for (let i = 0; i + 1 < line.length; i++) {
            const a = line[i];
            const b = line[i + 1];
            if (segmentHitsBox(a.x, a.y, b.x, b.y, near)) return false;
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
    /** 6.2.1: how far the number moved away from its axis to clear a marked point or a curve (0: not moved). */
    shift: number;
}

/**
 * 6.2.1: the ink of a number (digits are about 0.72 em tall, standing on
 * the baseline) within its box, in em of its font: top and bottom below
 * the top of an x number's box, and above and below the middle of a
 * y number's box.
 */
const INK_X = { top: 0.08, bottom: 0.8 };
const INK_Y = { top: 0.37, bottom: 0.35 };
/** 6.2.1: a number counts as covered when a marked point's rim or a curve comes this close to its ink, in em. */
const CLEAR_EM = 0.1;
/** 6.2.1: how far a covered number may move away from its axis to clear it, tried in this order (em). */
const TICK_SHIFTS_EM = [0.1, 0.2, 0.3];

/**
 * The numbers of one axis in the clean look, shared by the preview and the
 * export so both show the same ones: x numbers under the x-axis (over it
 * at the top edge), y numbers left of the y-axis (right of it at the right
 * edge); the 0 where the two axes cross is left out (unless the chart lists
 * it: `listed`). 6.2.1: a number is left out only when a marked point or a
 * curve really covers its digits (up to 6.2.0 a dot on the axis next to
 * it was enough: the integer points on an axis hid all its whole numbers);
 * when moving it a little away from its axis clears them, it moves instead.
 */
export function cleanTickSpots<T extends { value: number }>(
    axis: 'x' | 'y',
    ticks: readonly T[],
    textOf: (t: T) => string,
    o: { step: number; listed: boolean; frame: CleanAxisFrame; obstacles: TickObstacles }
): Array<TickSpot<T>> {
    const f = o.frame;
    const out: Array<TickSpot<T>> = [];
    // Away from the axis: down (up at the top edge) for x numbers, left (right at the right edge) for y numbers.
    const away = axis === 'x' ? (f.place.x === 'high' ? -1 : 1) : f.place.y === 'high' ? 1 : -1;
    for (const tick of ticks) {
        const text = textOf(tick);
        const tw = text.length * f.fs * f.charEm;
        let spot: TickSpot<T>;
        let ink: Box;
        if (axis === 'x') {
            const px = f.sx(tick.value);
            const y0 = f.place.x === 'high' ? f.oy - f.gap - f.fs : f.oy + f.gap;
            spot = { tick, text, x: px, y: y0 + 0.8 * f.fs, anchor: 'middle', box: { x0: px - tw / 2, x1: px + tw / 2, y0, y1: y0 + f.fs }, show: true, shift: 0 };
            ink = { x0: px - tw / 2, x1: px + tw / 2, y0: y0 + INK_X.top * f.fs, y1: y0 + INK_X.bottom * f.fs };
        } else {
            const py = f.sy(tick.value);
            const after = f.place.y === 'high';
            const x = after ? f.ox + f.gap : f.ox - f.gap;
            spot = { tick, text, x, y: py + 0.35 * f.fs, anchor: after ? 'start' : 'end', box: { x0: after ? x : x - tw, x1: after ? x + tw : x, y0: py - 0.5 * f.fs, y1: py + 0.5 * f.fs }, show: true, shift: 0 };
            ink = { x0: spot.box.x0, x1: spot.box.x1, y0: py - INK_Y.top * f.fs, y1: py + INK_Y.bottom * f.fs };
        }
        const crossing = (axis === 'x' ? f.place.y : f.place.x) === 'zero' && !o.listed && Math.abs(tick.value) < o.step * 0.01;
        if (!text.trim() || crossing) {
            spot.show = false;
            out.push(spot);
            continue;
        }
        const moved = (b: Box, d: number): Box => (axis === 'x' ? { ...b, y0: b.y0 + away * d, y1: b.y1 + away * d } : { ...b, x0: b.x0 + away * d, x1: b.x1 + away * d });
        const gap = CLEAR_EM * f.fs;
        let shift = tickClear(ink, o.obstacles, gap) ? 0 : -1;
        for (const k of TICK_SHIFTS_EM) {
            if (shift >= 0) break;
            if (tickClear(moved(ink, k * f.fs), o.obstacles, gap)) shift = k * f.fs;
        }
        spot.show = shift >= 0;
        if (shift > 0) {
            spot.shift = shift;
            spot.box = moved(spot.box, shift);
            if (axis === 'x') spot.y += away * shift;
            else spot.x += away * shift;
        }
        out.push(spot);
    }
    return out;
}
