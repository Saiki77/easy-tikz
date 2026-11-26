/*
 * 6.0 P: matplotlib.pyplot for chart scripts. The calls record what to
 * draw (Draw, plain data in chart coordinates); src/python/scene.ts turns
 * it into the chart's scene primitives, so the preview and the pgfplots
 * export draw it alike, in the chart's theme colours. matplotlib's colour
 * names and C0..C9 map to the plugin's colours. `fig, ax = plt.subplots()`
 * gives an axes with the same calls (ax.plot, ax.set_title, ...). Pure: no
 * DOM, no Obsidian.
 */
import { PyError, typeError, valueError } from './errors';
import { arg, intArg } from './ops';
import { num } from './builtins';
import { toArray } from './ndarray';
import { Kwargs, NDArray, PyBuiltin, PyComplex, PyModule, PyTuple, PyValue, isNum, iterate, str, truthy } from './values';
import type { Colormap } from '../types';

export type Pt2 = [number, number];
export type Size = 'small' | 'normal' | 'large';

/**
 * What a script drew. 6.2.1: `zorder` is the zorder the call gave (zorder=),
 * absent for matplotlib's default of that kind (python/scene.ts drawZ).
 */
export type Draw = DrawKind & { zorder?: number };

type DrawKind =
    | { k: 'line'; pts: Pt2[]; color: string; width: string; dashed: boolean; opacity: number; label: string | null; marker: boolean; markerSize: Size; markerOnly: boolean; closed?: boolean; markerRadius?: number }
    | { k: 'dots'; pts: Pt2[]; colors: string[]; size: Size; label: string | null; opacity: number; radii?: number[] }
    | { k: 'fill'; ring: Pt2[]; color: string; opacity: number; label: string | null; edge: string | null }
    | { k: 'arrow'; from: Pt2; to: Pt2; color: string; width: string }
    | { k: 'text'; x: number; y: number; text: string; color: string; size: Size; anchor: string }
    | { k: 'hline'; y: number; color: string; width: string; dashed: boolean; label: string | null }
    | { k: 'vline'; x: number; color: string; width: string; dashed: boolean; label: string | null }
    | { k: 'circle'; x: number; y: number; r: number; color: string; fill: string | null; opacity: number; width: string; dashed: boolean }
    | { k: 'image'; z: Float64Array; nx: number; ny: number; extent: [number, number, number, number]; map: Colormap | 'cyclic'; lower: boolean; vmin: number; vmax: number; opacity: number; smooth?: boolean }
    // 6.0 ML: contourf, filled bands between levels over a grid (xs, ys increasing), colour i between levels i and i + 1.
    | { k: 'bands'; xs: Float64Array; ys: Float64Array; z: Float64Array; levels: number[]; colors: string[]; opacity: number };

/** What a script drew, and the settings of its axes. */
export interface Figure {
    draws: Draw[];
    title: string | null;
    xlabel: string | null;
    ylabel: string | null;
    xlim: Pt2 | null;
    ylim: Pt2 | null;
    equal: boolean;
    legend: boolean;
    // 6.0 ML
    /** Where the legend goes: 'best' (null) or a corner, matplotlib's loc ('upper right', 'lower left', ...). */
    legendLoc?: string | null;
    /** The next colour of the cycle (C0, C1, ...). */
    cycle: number;
    /** Which block each draw came from (index into `draws`, the block of the chart). */
    blocks: number[];
}

export function newFigure(): Figure {
    return { draws: [], title: null, xlabel: null, ylabel: null, xlim: null, ylim: null, equal: false, legend: false, cycle: 0, blocks: [] };
}

// ------------------------------------------------------------ colours

/** The first colour of the cycle (C0): the colour of the block (blue unless `python in red:`), set by the scene. */
export const FIRST = '@C0';

/** matplotlib's colour cycle as the plugin's colours (C8 olive and C9 cyan as near ones). */
const CYCLE = [FIRST, 'orange', 'green', 'red', 'purple', 'brown', 'magenta', 'gray', '#bcbd22', 'teal'];

const NAMES: Record<string, string> = {
    b: 'blue',
    g: 'green',
    r: 'red',
    c: 'teal',
    m: 'magenta',
    y: '#d4ac0d',
    k: 'black',
    w: '#ffffff',
    blue: 'blue',
    green: 'green',
    red: 'red',
    cyan: 'teal',
    teal: 'teal',
    magenta: 'magenta',
    pink: 'magenta',
    fuchsia: 'magenta',
    yellow: '#d4ac0d',
    black: 'black',
    white: '#ffffff',
    gray: 'gray',
    grey: 'gray',
    orange: 'orange',
    purple: 'purple',
    brown: 'brown',
    olive: '#bcbd22',
    lightgray: '#c8c8c8',
    lightgrey: '#c8c8c8',
    skyblue: '#87ceeb',
    salmon: '#fa8072',
    // 6.0 ML: the shades are matplotlib's own colours, so two different names never draw alike (a legend tells them apart).
    gold: '#ffd700',
    darkgray: '#a9a9a9',
    darkgrey: '#a9a9a9',
    dimgray: '#696969',
    dimgrey: '#696969',
    silver: '#c0c0c0',
    darkorange: '#ff8c00',
    violet: '#ee82ee',
    indigo: '#4b0082',
    maroon: '#800000',
    navy: '#000080',
    darkblue: '#00008b',
    mediumblue: '#0000cd',
    royalblue: '#4169e1',
    steelblue: '#4682b4',
    dodgerblue: '#1e90ff',
    deepskyblue: '#00bfff',
    cornflowerblue: '#6495ed',
    midnightblue: '#191970',
    lightblue: '#add8e6',
    slateblue: '#6a5acd',
    slategray: '#708090',
    slategrey: '#708090',
    darkgreen: '#006400',
    lime: '#00ff00',
    limegreen: '#32cd32',
    forestgreen: '#228b22',
    seagreen: '#2e8b57',
    mediumseagreen: '#3cb371',
    springgreen: '#00ff7f',
    yellowgreen: '#9acd32',
    olivedrab: '#6b8e23',
    lightgreen: '#90ee90',
    crimson: '#dc143c',
    darkred: '#8b0000',
    firebrick: '#b22222',
    tomato: '#ff6347',
    orangered: '#ff4500',
    coral: '#ff7f50',
    hotpink: '#ff69b4',
    deeppink: '#ff1493',
    orchid: '#da70d6',
    plum: '#dda0dd',
    darkviolet: '#9400d3',
    mediumpurple: '#9370db',
    rebeccapurple: '#663399',
    turquoise: '#40e0d0',
    darkcyan: '#008b8b',
    aqua: '#00ffff',
    aquamarine: '#7fffd4',
    chocolate: '#d2691e',
    sienna: '#a0522d',
    peru: '#cd853f',
    tan: '#d2b48c',
    goldenrod: '#daa520',
    khaki: '#f0e68c',
};

function hex2(v: number): string {
    return Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0');
}

/** A matplotlib colour as a chart colour (a name of the palette, or #rrggbb); null for None / 'none'. */
export function chartColour(v: PyValue | undefined, fig: Figure | null, fallback?: string): string | null {
    if (v === undefined || v === null) {
        if (fallback) return fallback;
        if (!fig) return 'blue';
        return CYCLE[fig.cycle++ % CYCLE.length];
    }
    if (typeof v === 'string') {
        const s = v.trim();
        const lower = s.toLowerCase();
        if (lower === 'none') return null;
        const c = /^c(\d)$/i.exec(s);
        if (c) return CYCLE[Number(c[1])];
        const tab = /^tab:(\w+)$/.exec(lower);
        if (tab) {
            const order = ['blue', 'orange', 'green', 'red', 'purple', 'brown', 'pink', 'gray', 'olive', 'cyan'];
            const i = order.indexOf(tab[1] === 'grey' ? 'gray' : tab[1]);
            if (i >= 0) return CYCLE[i];
        }
        if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
        if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
        if (/^#[0-9a-f]{8}$/i.test(s)) return s.slice(0, 7).toLowerCase();
        if (/^(?:0(?:\.\d+)?|1(?:\.0*)?)$/.test(s)) {
            const g = hex2(Number(s));
            return `#${g}${g}${g}`;
        }
        const name = NAMES[lower.replace(/^xkcd:/, '').replace(/\s+/g, '')];
        if (name) return name;
        throw valueError('python.plot.badColour', { colour: s });
    }
    if (v instanceof PyTuple || Array.isArray(v)) {
        const parts = iterate(v).map((x) => num(x));
        if (parts.length >= 3) return `#${hex2(parts[0])}${hex2(parts[1])}${hex2(parts[2])}`;
    }
    throw valueError('python.plot.badColour', { colour: str(v) });
}

/** A line width in points as the plugin's thickness. */
export function widthOf(v: PyValue | undefined, dflt = 'thick'): string {
    if (v === undefined || v === null) return dflt;
    const w = num(v);
    if (w <= 0.75) return 'very thin';
    if (w <= 1.25) return 'thin';
    if (w <= 2.5) return 'thick';
    return 'very thick';
}

function dashedOf(v: PyValue | undefined): boolean {
    if (v === undefined || v === null) return false;
    const s = str(v);
    return s === '--' || s === ':' || s === '-.' || s === 'dashed' || s === 'dotted' || s === 'dashdot';
}

function sizeOfPoints(s: number): Size {
    if (s <= 12) return 'small';
    if (s <= 60) return 'normal';
    return 'large';
}

/** A matplotlib colour map as one of the plugin's. */
export function mapOf(v: PyValue | undefined): Colormap | 'cyclic' {
    const s = typeof v === 'string' ? v.toLowerCase().replace(/_r$/, '') : 'viridis';
    if (/^(?:viridis|cividis)$/.test(s)) return 'viridis';
    if (/^(?:hot|inferno|magma|plasma|afmhot|gist_heat|ylorrd|orrd|reds|oranges|autumn|copper)$/.test(s)) return 'heat';
    if (/^(?:cool|blues|winter|ylgnbu|gnbu|pubu|bugn|greens|ocean|summer)$/.test(s)) return 'cool';
    if (/^(?:coolwarm|rdbu|bwr|seismic|rdylbu|spectral|piyg|prgn|brbg|puor|rdgy|rdylgn)$/.test(s)) return 'diverging';
    if (/^(?:jet|rainbow|hsv|turbo|gist_rainbow|nipy_spectral|tab10|tab20|set1|set2|set3|paired)$/.test(s)) return 'rainbow';
    if (/^(?:gray|grey|greys|binary|bone|gist_gray|gist_yarg)$/.test(s)) return 'greyscale';
    if (/^(?:twilight|twilight_shifted)$/.test(s)) return 'cyclic';
    return 'viridis';
}

// ------------------------------------------------------------ reading the arguments

function numbers(v: PyValue): Float64Array {
    const a = toArray(v);
    if (a.dtype === 'complex') return a.data.slice();
    return a.data;
}

function realXY(xv: PyValue | null, yv: PyValue): { x: Float64Array; y: Float64Array } {
    const y = numbers(yv);
    const x = xv === null ? Float64Array.from(y, (_, i) => i) : numbers(xv);
    if (x.length !== y.length) throw valueError('python.plot.lengths', { x: x.length, y: y.length });
    return { x, y };
}

function pairs(x: ArrayLike<number>, y: ArrayLike<number>): Pt2[] {
    const out: Pt2[] = [];
    for (let i = 0; i < x.length; i++) out.push([x[i], y[i]]);
    return out;
}

/** A format string: '-' solid, '--' dashed, 'o' dots, 'r', 'k:' ... */
function readFormat(fmt: string): { color: string | null; dashed: boolean; marker: boolean; line: boolean } {
    let s = fmt;
    let color: string | null = null;
    const c = /C\d|[bgrcmykw]/.exec(s);
    if (c) {
        color = c[0];
        s = s.replace(c[0], '');
    }
    const dashed = /--|-\.|:/.test(s);
    const marker = /[o.,sv^<>*+xXDdph8|_1234]/.test(s.replace(/--|-\.|-|:/g, ''));
    const line = /-|:/.test(s) || !marker;
    return { color, dashed, marker, line };
}

const isFmt = (v: PyValue | undefined): v is string => typeof v === 'string';

// ------------------------------------------------------------ the calls

type Call = (args: PyValue[], kw: Kwargs | null) => PyValue;

function axesCalls(fig: Figure, push: (d: Draw) => void): Map<string, Call> {
    const calls = new Map<string, Call>();
    const kwv = (kw: Kwargs | null, ...names: string[]): PyValue | undefined => {
        for (const n of names) if (kw && kw.has(n)) return kw.get(n);
        return undefined;
    };
    const opacityOf = (kw: Kwargs | null, dflt = 1) => {
        const a = kwv(kw, 'alpha');
        return a === undefined || a === null ? dflt : Math.max(0, Math.min(1, num(a)));
    };
    const labelOf = (kw: Kwargs | null): string | null => {
        const l = kwv(kw, 'label');
        if (l === undefined || l === null) return null;
        const s = str(l);
        return s.startsWith('_') ? null : s;
    };

    calls.set('plot', (args, kw) => {
        // Groups of x, y, fmt: plot(y), plot(x, y), plot(x, y, 'r--'), plot(x1, y1, x2, y2).
        let i = 0;
        let made = 0;
        while (i < args.length) {
            const first = args[i];
            const second = args[i + 1];
            let x: PyValue | null = null;
            let y: PyValue;
            if (second !== undefined && !isFmt(second)) {
                x = first;
                y = second;
                i += 2;
            } else {
                y = first;
                i += 1;
            }
            const fmt = isFmt(args[i]) ? readFormat(args[i] as string) : null;
            if (fmt) i++;
            const { x: xs, y: ys } = realXY(x, y);
            const color = chartColour(kwv(kw, 'color', 'c') ?? (fmt?.color ?? undefined), fig);
            const marker = !!fmt?.marker || (kwv(kw, 'marker') !== undefined && kwv(kw, 'marker') !== null && str(kwv(kw, 'marker') ?? '') !== '');
            const ls = kwv(kw, 'linestyle', 'ls');
            const noLine = (fmt ? !fmt.line : false) || ls === 'None' || ls === 'none' || ls === '';
            const ms = kwv(kw, 'markersize', 'ms');
            push({
                k: 'line',
                pts: pairs(xs, ys),
                color: color ?? 'blue',
                width: widthOf(kwv(kw, 'linewidth', 'lw')),
                dashed: dashedOf(ls) || !!fmt?.dashed,
                opacity: opacityOf(kw),
                label: made === 0 ? labelOf(kw) : null,
                marker,
                markerSize: ms === undefined || ms === null ? 'normal' : sizeOfPoints(num(ms) ** 2),
                markerOnly: noLine,
                ...(ms === undefined || ms === null ? {} : { markerRadius: Math.max(0, num(ms)) / 2 }), // 6.0 ML: markersize is a diameter in points
            });
            made++;
        }
        return null;
    });
    calls.set('scatter', (args, kw) => {
        const { x, y } = realXY(arg(args, kw, 0, 'x', null), arg(args, kw, 1, 'y', null));
        const s = arg(args, kw, 2, 's', null);
        const c = arg(args, kw, 3, 'c', null) ?? kwv(kw, 'color') ?? null;
        let colors: string[];
        if (c instanceof NDArray || (Array.isArray(c) && c.length && isNum(c[0]))) {
            const v = numbers(c);
            let lo = Infinity;
            let hi = -Infinity;
            for (const t of v) {
                if (t < lo) lo = t;
                if (t > hi) hi = t;
            }
            const map = mapOf(kwv(kw, 'cmap'));
            colors = Array.from(v, (t) => mapHex(map, hi > lo ? (t - lo) / (hi - lo) : 0.5));
        } else colors = [chartColour(c ?? undefined, fig) ?? 'blue'];
        const size = s === null ? 'normal' : sizeOfPoints(isNum(s) ? num(s) : (numbers(s)[0] ?? 36)); // 6.0 ML: a list of sizes too
        // 6.0 ML: s is matplotlib's area in points^2 (one, or one per dot): the dot's radius is sqrt(s) / 2 points.
        const radii = s === null ? undefined : Array.from(isNum(s) ? [num(s)] : numbers(s), (a) => Math.sqrt(Math.max(0, a)) / 2);
        push({ k: 'dots', pts: pairs(x, y), colors, size, label: labelOf(kw), opacity: opacityOf(kw), ...(radii && radii.length ? { radii } : {}) });
        return null;
    });
    calls.set('fill_between', (args, kw) => {
        const x = numbers(arg(args, kw, 0, 'x', null));
        const y1v = arg(args, kw, 1, 'y1', 0);
        const y2v = arg(args, kw, 2, 'y2', 0);
        const y1 = isNum(y1v) ? new Float64Array(x.length).fill(num(y1v)) : numbers(y1v);
        const y2 = isNum(y2v) ? new Float64Array(x.length).fill(num(y2v)) : numbers(y2v);
        const where = kwv(kw, 'where');
        const mask = where === undefined || where === null ? null : toArray(where).data;
        const color = chartColour(kwv(kw, 'color', 'facecolor', 'fc'), fig) ?? 'blue';
        const opacity = opacityOf(kw, 0.4);
        // One fill per run where the mask holds.
        let start = 0;
        let label = labelOf(kw);
        const flush = (a: number, b: number) => {
            if (b - a < 2) return;
            const ring: Pt2[] = [];
            for (let i = a; i < b; i++) ring.push([x[i], y1[i]]);
            for (let i = b - 1; i >= a; i--) ring.push([x[i], y2[i]]);
            push({ k: 'fill', ring, color, opacity, label, edge: null });
            label = null;
        };
        for (let i = 0; i <= x.length; i++) {
            if (i === x.length || (mask && !mask[i])) {
                flush(start, i);
                start = i + 1;
            }
        }
        return null;
    });
    calls.set('fill', (args, kw) => {
        const { x, y } = realXY(args[0] ?? null, args[1] ?? null);
        const color = chartColour(isFmt(args[2]) ? args[2] : kwv(kw, 'color', 'facecolor'), fig) ?? 'blue';
        push({ k: 'fill', ring: pairs(x, y), color, opacity: opacityOf(kw, 0.4), label: labelOf(kw), edge: null });
        return null;
    });
    calls.set('arrow', (args, kw) => {
        const x = num(arg(args, kw, 0, 'x', 0));
        const y = num(arg(args, kw, 1, 'y', 0));
        const dx = num(arg(args, kw, 2, 'dx', 0));
        const dy = num(arg(args, kw, 3, 'dy', 0));
        push({ k: 'arrow', from: [x, y], to: [x + dx, y + dy], color: chartColour(kwv(kw, 'color', 'fc', 'ec'), null, 'black') ?? 'black', width: widthOf(kwv(kw, 'width', 'linewidth', 'lw'), 'thin') });
        return null;
    });
    calls.set('quiver', (args, kw) => {
        let X: Float64Array;
        let Y: Float64Array;
        let U: Float64Array;
        let V: Float64Array;
        if (args.length >= 4) {
            X = numbers(args[0]);
            Y = numbers(args[1]);
            U = numbers(args[2]);
            V = numbers(args[3]);
        } else {
            U = numbers(args[0] ?? null);
            V = numbers(args[1] ?? null);
            X = Float64Array.from(U, (_, i) => i);
            Y = new Float64Array(U.length);
        }
        if (X.length === 1 && U.length > 1) X = new Float64Array(U.length).fill(X[0]);
        if (Y.length === 1 && U.length > 1) Y = new Float64Array(U.length).fill(Y[0]);
        const n = Math.min(X.length, Y.length, U.length, V.length);
        let k: number;
        const scale = kwv(kw, 'scale');
        const units = kwv(kw, 'scale_units');
        if (scale !== undefined && scale !== null && (units === 'xy' || units === undefined)) k = 1 / num(scale);
        else {
            // Like matplotlib's autoscale: the longest arrow about the spacing of the grid.
            let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity, big = 0;
            for (let i = 0; i < n; i++) {
                xlo = Math.min(xlo, X[i]);
                xhi = Math.max(xhi, X[i]);
                ylo = Math.min(ylo, Y[i]);
                yhi = Math.max(yhi, Y[i]);
                big = Math.max(big, Math.hypot(U[i], V[i]));
            }
            const area = Math.max(1e-12, (xhi - xlo) * (yhi - ylo));
            const spacing = n > 1 ? Math.sqrt(area / n) : 1;
            k = big > 0 ? (0.9 * spacing) / big : 1;
        }
        const color = chartColour(kwv(kw, 'color'), null, 'black') ?? 'black';
        const width = widthOf(kwv(kw, 'linewidth', 'lw'), 'thin');
        for (let i = 0; i < n; i++) {
            if (!(Math.hypot(U[i], V[i]) > 0)) continue;
            push({ k: 'arrow', from: [X[i], Y[i]], to: [X[i] + k * U[i], Y[i] + k * V[i]], color, width });
        }
        return null;
    });
    const textCall: Call = (args, kw) => {
        const x = num(arg(args, kw, 0, 'x', 0));
        const y = num(arg(args, kw, 1, 'y', 0));
        const s = str(arg(args, kw, 2, 's', ''));
        push({ k: 'text', x, y, text: s, color: chartColour(kwv(kw, 'color', 'c'), null, 'black') ?? 'black', size: fontSize(kwv(kw, 'fontsize', 'size')), anchor: anchorOf(kwv(kw, 'ha', 'horizontalalignment'), kwv(kw, 'va', 'verticalalignment')) });
        return null;
    };
    calls.set('text', textCall);
    calls.set('annotate', (args, kw) => {
        const text = str(arg(args, kw, 0, 'text', ''));
        const xy = iterate(arg(args, kw, 1, 'xy', null)).map((v) => num(v));
        const xyt = arg(args, kw, 2, 'xytext', null);
        const at = xyt === null ? xy : iterate(xyt).map((v) => num(v));
        const color = chartColour(kwv(kw, 'color'), null, 'black') ?? 'black';
        // 6.2.1: an annotation (and its arrow) is matplotlib's zorder 3: over lines and dots.
        if (xyt !== null && kwv(kw, 'arrowprops') !== undefined) push({ k: 'arrow', from: [at[0], at[1]], to: [xy[0], xy[1]], color, width: 'thin', zorder: zorderOf(kw) ?? 3 });
        push({ k: 'text', x: at[0], y: at[1], text, color, size: fontSize(kwv(kw, 'fontsize', 'size')), anchor: xyt === null ? 'above right' : 'center' });
        return null;
    });
    const hv = (horizontal: boolean): Call => (args, kw) => {
        const v = num(arg(args, kw, 0, horizontal ? 'y' : 'x', 0));
        const color = chartColour(kwv(kw, 'color', 'c'), null, 'black') ?? 'black';
        const width = widthOf(kwv(kw, 'linewidth', 'lw'), 'thin');
        const dashed = dashedOf(kwv(kw, 'linestyle', 'ls'));
        const label = labelOf(kw);
        push(horizontal ? { k: 'hline', y: v, color, width, dashed, label } : { k: 'vline', x: v, color, width, dashed, label });
        return null;
    };
    calls.set('axhline', hv(true));
    calls.set('axvline', hv(false));
    calls.set('hlines', (args, kw) => {
        const ys = numbers(arg(args, kw, 0, 'y', 0));
        const lo = numbers(arg(args, kw, 1, 'xmin', 0));
        const hi = numbers(arg(args, kw, 2, 'xmax', 1));
        const color = chartColour(kwv(kw, 'colors', 'color'), null, 'black') ?? 'black';
        ys.forEach((y, i) => push({ k: 'line', pts: [[lo[Math.min(i, lo.length - 1)], y], [hi[Math.min(i, hi.length - 1)], y]], color, width: widthOf(kwv(kw, 'linewidth', 'lw'), 'thin'), dashed: dashedOf(kwv(kw, 'linestyles', 'linestyle')), opacity: 1, label: null, marker: false, markerSize: 'normal', markerOnly: false }));
        return null;
    });
    calls.set('vlines', (args, kw) => {
        const xs = numbers(arg(args, kw, 0, 'x', 0));
        const lo = numbers(arg(args, kw, 1, 'ymin', 0));
        const hi = numbers(arg(args, kw, 2, 'ymax', 1));
        const color = chartColour(kwv(kw, 'colors', 'color'), null, 'black') ?? 'black';
        xs.forEach((x, i) => push({ k: 'line', pts: [[x, lo[Math.min(i, lo.length - 1)]], [x, hi[Math.min(i, hi.length - 1)]]], color, width: widthOf(kwv(kw, 'linewidth', 'lw'), 'thin'), dashed: dashedOf(kwv(kw, 'linestyles', 'linestyle')), opacity: 1, label: null, marker: false, markerSize: 'normal', markerOnly: false }));
        return null;
    });
    // 6.0 ML: contour and contourf read the grid alike; levels a count or a list, colors one colour or one per level.
    const grid = (args: PyValue[], kw: Kwargs | null) => {
        let X: NDArray, Y: NDArray, Z: NDArray;
        let levelsArg: PyValue | null = null;
        if (args.length >= 3) {
            X = toArray(args[0]);
            Y = toArray(args[1]);
            Z = toArray(args[2]);
            levelsArg = args[3] ?? kwv(kw, 'levels') ?? null;
        } else {
            Z = toArray(args[0] ?? null);
            const [ny, nx] = Z.shape;
            X = toArray(Array.from({ length: nx }, (_, i) => i));
            Y = toArray(Array.from({ length: ny }, (_, i) => i));
            levelsArg = args[1] ?? kwv(kw, 'levels') ?? null;
        }
        if (Z.ndim !== 2) throw valueError('python.plot.contour2D');
        const [ny, nx] = Z.shape;
        const xs = X.ndim === 2 ? Float64Array.from({ length: nx }, (_, j) => X.data[j]) : X.data;
        const ys = Y.ndim === 2 ? Float64Array.from({ length: ny }, (_, i) => Y.data[i * nx]) : Y.data;
        let lo = Infinity;
        let hi = -Infinity;
        for (const z of Z.data) {
            if (!Number.isFinite(z)) continue;
            if (z < lo) lo = z;
            if (z > hi) hi = z;
        }
        const count = levelsArg === null ? 7 : isNum(levelsArg) ? intArg(levelsArg) : null;
        const levels = count === null ? Array.from(numbers(levelsArg ?? [])).sort((a, b) => a - b) : null;
        return { xs, ys, z: Z.data, nx, ny, lo, hi, count, levels };
    };
    /** Colours from `colors=` (one, or one per level, cycled), else null. */
    const levelColours = (kw: Kwargs | null, n: number): string[] | null => {
        const colorsV = kwv(kw, 'colors');
        if (colorsV === undefined || colorsV === null) return null;
        if (typeof colorsV === 'string') return new Array<string>(n).fill(chartColour(colorsV, null) ?? 'black');
        const list = iterate(colorsV).map((c) => chartColour(c, null) ?? 'black');
        return list.length ? Array.from({ length: n }, (_, i) => list[i % list.length]) : null;
    };
    calls.set('contour', (args, kw) => {
        const g = grid(args, kw);
        const levels = g.levels ?? niceLevels(g.lo, g.hi, g.count ?? 7);
        const given = levelColours(kw, levels.length);
        const map = mapOf(kwv(kw, 'cmap'));
        const width = widthOf(kwv(kw, 'linewidths', 'linewidth'), 'thin');
        const styles = kwv(kw, 'linestyles', 'linestyle');
        const opacity = opacityOf(kw);
        levels.forEach((level, li) => {
            const color = given ? given[li] : mapHex(map, levels.length > 1 ? li / (levels.length - 1) : 0.5);
            // matplotlib draws the negative levels of a one-colour contour dashed.
            const dashed = styles !== undefined && styles !== null ? dashedOf(styles) : !!given && new Set(given).size === 1 && level < 0;
            for (const line of marching(g.xs, g.ys, g.z, g.nx, g.ny, level)) {
                push({ k: 'line', pts: line, color, width, dashed, opacity, label: null, marker: false, markerSize: 'normal', markerOnly: false });
            }
        });
        return null;
    });
    calls.set('contourf', (args, kw) => {
        const g = grid(args, kw);
        // Boundaries that hold every value: matplotlib's round levels, widened to the lowest and the highest.
        let levels = g.levels;
        if (!levels) {
            const inner = niceLevels(g.lo, g.hi, g.count ?? 7);
            const step = inner.length > 1 ? inner[1] - inner[0] : 1;
            levels = inner.slice();
            if (!(levels[0] <= g.lo)) levels.unshift(Number((levels[0] - step).toPrecision(12)));
            if (!(levels[levels.length - 1] >= g.hi)) levels.push(Number((levels[levels.length - 1] + step).toPrecision(12)));
        }
        if (levels.length < 2) levels = [g.lo, g.hi > g.lo ? g.hi : g.lo + 1];
        const bandCount = levels.length - 1;
        const given = levelColours(kw, bandCount);
        const map = mapOf(kwv(kw, 'cmap'));
        const colors = Array.from({ length: bandCount }, (_, i) => (given ? given[i] : mapHex(map, bandCount > 1 ? i / (bandCount - 1) : 0.5)));
        push({ k: 'bands', xs: Float64Array.from(g.xs), ys: Float64Array.from(g.ys), z: Float64Array.from(g.z), levels, colors, opacity: opacityOf(kw) });
        return null;
    });
    calls.set('imshow', (args, kw) => {
        const Z = toArray(arg(args, kw, 0, 'X', null));
        if (Z.ndim !== 2) throw valueError('python.plot.imshow2D');
        const [ny, nx] = Z.shape;
        const ext = kwv(kw, 'extent');
        const origin = kwv(kw, 'origin');
        // 6.0 ML: matplotlib's default extent follows the origin (row 0 at y = -0.5 with origin='lower').
        const extent: [number, number, number, number] = ext === undefined || ext === null ? (origin === 'lower' ? [-0.5, nx - 0.5, -0.5, ny - 0.5] : [-0.5, nx - 0.5, ny - 0.5, -0.5]) : (iterate(ext).map((v) => num(v)) as [number, number, number, number]);
        let lo = Infinity;
        let hi = -Infinity;
        for (const z of Z.data) {
            if (!Number.isFinite(z)) continue;
            if (z < lo) lo = z;
            if (z > hi) hi = z;
        }
        const vmin = kwv(kw, 'vmin');
        const vmax = kwv(kw, 'vmax');
        push({
            k: 'image',
            z: Z.data.slice(),
            nx,
            ny,
            extent,
            map: mapOf(kwv(kw, 'cmap')),
            lower: origin === 'lower',
            vmin: vmin === undefined || vmin === null ? lo : num(vmin),
            vmax: vmax === undefined || vmax === null ? hi : num(vmax),
            opacity: opacityOf(kw),
            smooth: smoothOf(kwv(kw, 'interpolation')), // 6.0 ML
        });
        return null;
    });
    calls.set('hist', (args, kw) => {
        // 6.0 ML: range=, weights=, bins='auto', cumulative, histtype 'step'; returns (n, bins, patches) as matplotlib.
        const data = numbers(arg(args, kw, 0, 'x', null)).filter((v) => Number.isFinite(v));
        const binsV = arg(args, kw, 1, 'bins', 10);
        const rangeV = kwv(kw, 'range');
        let lo = Infinity;
        let hi = -Infinity;
        if (rangeV !== undefined && rangeV !== null) [lo, hi] = iterate(rangeV).map((v) => num(v));
        else {
            for (const v of data) {
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        }
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1];
        if (!(hi > lo)) [lo, hi] = [lo - 0.5, lo + 0.5];
        let count = 10;
        let edges: number[];
        if (typeof binsV === 'string') {
            // 'auto' and the named rules: the larger of Sturges and Freedman-Diaconis, as numpy's 'auto'.
            const n = Math.max(1, data.length);
            const sturges = Math.ceil(Math.log2(n)) + 1;
            const sorted = Array.from(data).sort((a, b) => a - b);
            const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] ?? 0;
            const iqr = q(0.75) - q(0.25);
            const fd = iqr > 0 ? Math.ceil((hi - lo) / ((2 * iqr) / Math.cbrt(n))) : sturges;
            count = Math.max(1, Math.min(1000, Math.max(sturges, fd)));
            edges = Array.from({ length: count + 1 }, (_, i) => lo + ((hi - lo) * i) / count);
        } else if (isNum(binsV)) {
            count = Math.max(1, intArg(binsV));
            edges = Array.from({ length: count + 1 }, (_, i) => lo + ((hi - lo) * i) / count);
        } else edges = Array.from(numbers(binsV));
        const weightsV = kwv(kw, 'weights');
        const allW = weightsV === undefined || weightsV === null ? null : numbers(weightsV);
        const counts = new Array<number>(Math.max(0, edges.length - 1)).fill(0);
        const raw = numbers(arg(args, kw, 0, 'x', null));
        raw.forEach((v, idx) => {
            if (!Number.isFinite(v) || v < edges[0] || v > edges[edges.length - 1]) return;
            // The bin by binary search; the last bin holds its right edge.
            let a = 0;
            let b = counts.length - 1;
            while (a < b) {
                const mid = (a + b + 1) >> 1;
                if (v >= edges[mid]) a = mid;
                else b = mid - 1;
            }
            counts[a] += allW ? allW[idx] ?? 0 : 1;
        });
        const total = counts.reduce((p, c) => p + c, 0);
        if (truthy(kwv(kw, 'density') ?? false) && total > 0) {
            for (let i = 0; i < counts.length; i++) counts[i] /= total * (edges[i + 1] - edges[i]);
        }
        if (truthy(kwv(kw, 'cumulative') ?? false)) {
            for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
        }
        const color = chartColour(kwv(kw, 'color', 'facecolor', 'fc'), fig) ?? 'blue';
        let label = labelOf(kw);
        const type = kwv(kw, 'histtype');
        if (type === 'step') {
            // The outline only, as one line.
            const pts: Pt2[] = [[edges[0], 0]];
            counts.forEach((c, i) => pts.push([edges[i], c], [edges[i + 1], c]));
            pts.push([edges[edges.length - 1], 0]);
            push({ k: 'line', pts, color, width: widthOf(kwv(kw, 'linewidth', 'lw')), dashed: false, opacity: opacityOf(kw), label, marker: false, markerSize: 'normal', markerOnly: false });
        } else {
            const opacity = opacityOf(kw, 0.6);
            const edge = kwv(kw, 'edgecolor', 'ec');
            const edgeColour = edge === undefined ? color : chartColour(edge, null);
            counts.forEach((c, i) => {
                if (!c) return;
                push({ k: 'fill', ring: [[edges[i], 0], [edges[i + 1], 0], [edges[i + 1], c], [edges[i], c]], color, opacity, label, edge: edgeColour });
                label = null;
            });
        }
        return new PyTuple([toArray(counts), toArray(edges), []]);
    });
    calls.set('bar', (args, kw) => {
        const x = numbers(arg(args, kw, 0, 'x', null));
        const hv2 = arg(args, kw, 1, 'height', 0);
        const h = isNum(hv2) ? new Float64Array(x.length).fill(num(hv2)) : numbers(hv2);
        const w = num(arg(args, kw, 2, 'width', 0.8));
        const bottom = num(arg(args, kw, 3, 'bottom', 0));
        const color = chartColour(kwv(kw, 'color'), fig) ?? 'blue';
        let label = labelOf(kw);
        x.forEach((xi, i) => {
            push({ k: 'fill', ring: [[xi - w / 2, bottom], [xi + w / 2, bottom], [xi + w / 2, bottom + h[i]], [xi - w / 2, bottom + h[i]]], color, opacity: opacityOf(kw, 0.7), label, edge: color });
            label = null;
        });
        return null;
    });
    calls.set('stem', (args, kw) => {
        const { x, y } = realXY(args.length > 1 ? (args[0] ?? null) : null, args.length > 1 ? (args[1] ?? null) : (args[0] ?? null));
        const color = chartColour(kwv(kw, 'color'), fig) ?? 'blue';
        x.forEach((xi, i) => push({ k: 'line', pts: [[xi, 0], [xi, y[i]]], color, width: 'thin', dashed: false, opacity: 1, label: null, marker: false, markerSize: 'normal', markerOnly: false }));
        push({ k: 'dots', pts: pairs(x, y), colors: [color], size: 'normal', label: labelOf(kw), opacity: 1 });
        return null;
    });
    calls.set('step', (args, kw) => {
        const { x, y } = realXY(args[0] ?? null, args[1] ?? null);
        const pts: Pt2[] = [];
        for (let i = 0; i < x.length; i++) {
            if (i) pts.push([x[i], y[i - 1]]);
            pts.push([x[i], y[i]]);
        }
        push({ k: 'line', pts, color: chartColour(kwv(kw, 'color'), fig) ?? 'blue', width: widthOf(kwv(kw, 'linewidth', 'lw')), dashed: false, opacity: 1, label: labelOf(kw), marker: false, markerSize: 'normal', markerOnly: false });
        return null;
    });

    // The settings of the axes.
    const lim = (which: 'xlim' | 'ylim'): Call => (args, kw) => {
        if (!args.length && !kw) {
            const l = fig[which];
            return l ? new PyTuple([l[0], l[1]]) : null;
        }
        let lo: PyValue = arg(args, kw, 0, which === 'xlim' ? 'left' : 'bottom', null);
        let hi: PyValue = arg(args, kw, 1, which === 'xlim' ? 'right' : 'top', null);
        if (lo instanceof PyTuple || Array.isArray(lo)) [lo, hi] = iterate(lo);
        const old = fig[which];
        const a = lo === null ? (old ? old[0] : NaN) : num(lo);
        const b = hi === null ? (old ? old[1] : NaN) : num(hi);
        if (!(a !== b) || !Number.isFinite(a) || !Number.isFinite(b)) throw valueError('python.plot.badLimits');
        fig[which] = a < b ? [a, b] : [b, a];
        return null;
    };
    calls.set('xlim', lim('xlim'));
    calls.set('ylim', lim('ylim'));
    calls.set('set_xlim', lim('xlim'));
    calls.set('set_ylim', lim('ylim'));
    calls.set('axis', (args) => {
        const v = args[0];
        if (v === 'equal' || v === 'scaled' || v === 'image' || v === 'square') fig.equal = true;
        else if (v instanceof PyTuple || Array.isArray(v)) {
            const [a, b, c, d] = iterate(v).map((x) => num(x));
            fig.xlim = [Math.min(a, b), Math.max(a, b)];
            fig.ylim = [Math.min(c, d), Math.max(c, d)];
        }
        return null;
    });
    calls.set('set_aspect', (args) => {
        if (args[0] === 'equal' || (isNum(args[0] ?? null) && num(args[0]) === 1)) fig.equal = true;
        return null;
    });
    const title: Call = (args, kw) => {
        fig.title = str(arg(args, kw, 0, 'label', ''));
        return null;
    };
    calls.set('title', title);
    calls.set('set_title', title);
    calls.set('suptitle', title);
    const xlabel: Call = (args, kw) => {
        fig.xlabel = str(arg(args, kw, 0, 'xlabel', ''));
        return null;
    };
    const ylabel: Call = (args, kw) => {
        fig.ylabel = str(arg(args, kw, 0, 'ylabel', ''));
        return null;
    };
    calls.set('xlabel', xlabel);
    calls.set('set_xlabel', xlabel);
    calls.set('ylabel', ylabel);
    calls.set('set_ylabel', ylabel);
    calls.set('legend', (args, kw) => {
        fig.legend = true;
        // 6.0 ML: loc='upper left' and the other corners; 'best' (or none) finds the emptiest corner.
        const loc = arg(args, kw, -1, 'loc', null);
        fig.legendLoc = typeof loc === 'string' && /^(upper|lower) (left|right)$/.test(loc) ? loc : null;
        return null;
    });
    // Accepted and left to the chart: its grid, ticks, size and colour bar are its own lines.
    // 6.0 ML: colorbar and clabel too (the chart has no room beside the plot; the 6.0 plan).
    for (const name of ['grid', 'xticks', 'yticks', 'set_xticks', 'set_yticks', 'set_xticklabels', 'set_yticklabels', 'tick_params', 'margins', 'minorticks_on', 'set_facecolor', 'spines', 'colorbar', 'tight_layout', 'locator_params', 'clabel']) calls.set(name, () => null);
    calls.set('add_patch', (args) => {
        const p = args[0];
        if (p instanceof PyModule && p.typeName === 'Patch') {
            const d = PATCHES.get(p);
            if (d) push(d);
        }
        return p ?? null;
    });
    calls.set('add_artist', calls.get('add_patch') as Call);
    return calls;
}

/** 6.2.1: a call's zorder= as a number, or undefined (matplotlib's default for what it draws). */
function zorderOf(kw: Kwargs | null | undefined): number | undefined {
    const v = kw?.get('zorder');
    if (v === undefined || v === null) return undefined;
    const n = num(v);
    return Number.isFinite(n) ? n : undefined;
}

/** The draw of each patch object (plt.Circle, plt.Polygon, plt.Rectangle), for add_patch. */
const PATCHES = new WeakMap<PyModule, Draw>();

function fontSize(v: PyValue | undefined): Size {
    if (v === undefined || v === null) return 'normal';
    if (typeof v === 'string') return /small/.test(v) ? 'small' : /large/.test(v) ? 'large' : 'normal';
    const n = num(v);
    return n < 9 ? 'small' : n > 13 ? 'large' : 'normal';
}

/** 6.0 ML: imshow's interpolation: the smooth ones blend cells; 'nearest', 'none' and 'antialiased' (matplotlib's default, nearest when a cell is large) keep them square. */
function smoothOf(v: PyValue | undefined): boolean {
    return typeof v === 'string' && /^(?:bilinear|bicubic|spline16|spline36|hanning|hamming|hermite|kaiser|quadric|catrom|gaussian|bessel|mitchell|sinc|lanczos|blackman)$/.test(v);
}

function anchorOf(ha: PyValue | undefined, va: PyValue | undefined): string {
    const h = ha === 'center' ? '' : ha === 'right' ? 'left' : 'right';
    const v = va === 'center' || va === 'center_baseline' ? '' : va === 'top' ? 'below' : 'above';
    if (!h && !v) return 'center';
    if (!h) return v;
    if (!v) return h;
    return `${v} ${h}`;
}

/** About n round levels between lo and hi (matplotlib's MaxNLocator, roughly). */
function niceLevels(lo: number, hi: number, n: number): number[] {
    if (!(hi > lo)) return [lo];
    const raw = (hi - lo) / Math.max(1, n);
    const p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * step; v += step) out.push(Number(v.toPrecision(12)));
    return out;
}

/** Marching squares on a grid: the polylines where z = level. */
export function marching(xs: ArrayLike<number>, ys: ArrayLike<number>, z: ArrayLike<number>, nx: number, ny: number, level: number): Pt2[][] {
    const segs: Array<[Pt2, Pt2]> = [];
    const at = (i: number, j: number) => z[i * nx + j];
    const lerp = (a: Pt2, b: Pt2, za: number, zb: number): Pt2 => {
        const t = za === zb ? 0.5 : (level - za) / (zb - za);
        return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    };
    for (let i = 0; i + 1 < ny; i++) {
        for (let j = 0; j + 1 < nx; j++) {
            const p: Pt2[] = [[xs[j], ys[i]], [xs[j + 1], ys[i]], [xs[j + 1], ys[i + 1]], [xs[j], ys[i + 1]]];
            const v = [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)];
            if (v.some((x) => !Number.isFinite(x))) continue;
            const cut: Pt2[] = [];
            for (let e = 0; e < 4; e++) {
                const a = v[e];
                const b = v[(e + 1) % 4];
                if ((a < level) !== (b < level)) cut.push(lerp(p[e], p[(e + 1) % 4], a, b));
            }
            if (cut.length === 2) segs.push([cut[0], cut[1]]);
            else if (cut.length === 4) {
                segs.push([cut[0], cut[1]]);
                segs.push([cut[2], cut[3]]);
            }
        }
    }
    // Join the segments into polylines.
    const key = (p: Pt2) => `${p[0].toPrecision(10)},${p[1].toPrecision(10)}`;
    const ends = new Map<string, number[]>();
    segs.forEach((s, i) => {
        for (const p of s) {
            const k = key(p);
            const l = ends.get(k);
            if (l) l.push(i);
            else ends.set(k, [i]);
        }
    });
    const used = new Uint8Array(segs.length);
    const lines: Pt2[][] = [];
    for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue;
        used[i] = 1;
        const line: Pt2[] = [segs[i][0], segs[i][1]];
        for (const forward of [true, false]) {
            for (;;) {
                const tip = forward ? line[line.length - 1] : line[0];
                const next = (ends.get(key(tip)) ?? []).find((s) => !used[s]);
                if (next === undefined) break;
                used[next] = 1;
                const s = segs[next];
                const other = key(s[0]) === key(tip) ? s[1] : s[0];
                if (forward) line.push(other);
                else line.unshift(other);
            }
        }
        lines.push(line);
    }
    return lines;
}

/** A colour map at t as #rrggbb (for colours that follow a value: scatter c=, contour levels). */
export function mapHex(map: Colormap | 'cyclic', t: number): string {
    const rgb = MAP_RGB.fn(map, t);
    return `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;
}

/** Set by scene.ts (iterate/colour.ts mapRgb, 0..1 channels), so this file needs no chart module. */
export const MAP_RGB: { fn: (map: Colormap | 'cyclic', t: number) => [number, number, number] } = {
    fn: (_m, t) => [t, t, t],
};

// ------------------------------------------------------------ the module

/** matplotlib.pyplot over one figure; `block()` says which block of the chart is running. */
export function pyplotModule(fig: Figure, block: () => number): { plt: PyModule; matplotlib: PyModule } {
    // 6.2.1: the zorder= of the drawing call that runs now, for every draw it pushes.
    let zorder: number | undefined;
    const push = (d: Draw) => {
        if (fig.draws.length >= 20000) throw new PyError('MemoryError', 'python.plot.tooMany', { count: 20000 });
        if (zorder !== undefined && d.zorder === undefined) d.zorder = zorder;
        fig.draws.push(d);
        fig.blocks.push(block());
    };
    const calls = axesCalls(fig, push);
    const attrs = new Map<string, PyValue>();
    const axAttrs = new Map<string, PyValue>();
    for (const [name, call] of calls) {
        const f: typeof call = (a, kw) => {
            const before = zorder;
            zorder = zorderOf(kw);
            try {
                return call(a, kw);
            } finally {
                zorder = before;
            }
        };
        const b = new PyBuiltin(name, f);
        if (!name.startsWith('set_') && name !== 'add_patch' && name !== 'add_artist' && name !== 'set_aspect') attrs.set(name, b);
        axAttrs.set(name, b);
    }
    // plt.xlim and ax.set_xlim; ax.get_xlim.
    axAttrs.set('get_xlim', new PyBuiltin('get_xlim', () => (fig.xlim ? new PyTuple([fig.xlim[0], fig.xlim[1]]) : null)));
    axAttrs.set('get_ylim', new PyBuiltin('get_ylim', () => (fig.ylim ? new PyTuple([fig.ylim[0], fig.ylim[1]]) : null)));
    const ax = new PyModule('Axes', axAttrs, 'Axes');
    const figAttrs = new Map<string, PyValue>();
    const figure = new PyModule('Figure', figAttrs, 'Figure');
    figAttrs.set('add_subplot', new PyBuiltin('add_subplot', () => ax));
    figAttrs.set('gca', new PyBuiltin('gca', () => ax));
    figAttrs.set('suptitle', new PyBuiltin('suptitle', (a, kw) => calls.get('title')?.(a, kw) ?? null));
    for (const name of ['tight_layout', 'savefig', 'show', 'colorbar', 'set_size_inches', 'subplots_adjust']) figAttrs.set(name, new PyBuiltin(name, () => null));
    attrs.set('figure', new PyBuiltin('figure', () => figure));
    attrs.set('gcf', new PyBuiltin('gcf', () => figure));
    attrs.set('gca', new PyBuiltin('gca', () => ax));
    attrs.set('subplot', new PyBuiltin('subplot', () => ax));
    attrs.set('axes', new PyBuiltin('axes', () => ax));
    attrs.set('subplots', new PyBuiltin('subplots', (a, kw) => {
        const rows = intArg(arg(a, kw, 0, 'nrows', 1));
        const cols = intArg(arg(a, kw, 1, 'ncols', 1));
        if (rows * cols !== 1) throw valueError('python.plot.onePlot');
        return new PyTuple([figure, ax]);
    }));
    for (const name of ['show', 'savefig', 'close', 'clf', 'cla', 'ion', 'ioff', 'pause', 'draw', 'style', 'rcParams', 'set_cmap']) attrs.set(name, new PyBuiltin(name, () => null));
    attrs.set('cm', new PyModule('matplotlib.cm', new Map()));
    // Patches.
    const patch = (d: Draw) => {
        const p = new PyModule('Patch', new Map(), 'Patch');
        PATCHES.set(p, d);
        return p;
    };
    const patchLook = (kw: Kwargs | null, fill: boolean) => {
        const fc = kw?.get('facecolor') ?? kw?.get('fc') ?? kw?.get('color');
        const ec = kw?.get('edgecolor') ?? kw?.get('ec') ?? kw?.get('color');
        const filled = kw?.has('fill') ? truthy(kw.get('fill') ?? false) : fill;
        const alpha = kw?.get('alpha');
        return {
            edge: chartColour(ec ?? undefined, null, 'blue'),
            face: filled ? chartColour(fc ?? undefined, null, 'blue') : null,
            opacity: alpha === undefined || alpha === null ? 0.4 : num(alpha),
            width: widthOf(kw?.get('linewidth') ?? kw?.get('lw'), 'thin'),
            dashed: dashedOf(kw?.get('linestyle') ?? kw?.get('ls')),
        };
    };
    const circle = new PyBuiltin('Circle', (a, kw) => {
        const xy = iterate(a[0] ?? new PyTuple([0, 0])).map((v) => num(v));
        const r = num(arg(a, kw, 1, 'radius', 5));
        const look = patchLook(kw, true);
        return patch({ k: 'circle', x: xy[0], y: xy[1], r, color: look.edge ?? 'blue', fill: look.face, opacity: look.opacity, width: look.width, dashed: look.dashed, zorder: zorderOf(kw) });
    });
    const polygon = new PyBuiltin('Polygon', (a, kw) => {
        const ring = iterate(a[0] ?? []).map((p) => iterate(p).map((v) => num(v)) as Pt2);
        const closed = kw?.has('closed') ? truthy(kw.get('closed') ?? true) : true;
        const look = patchLook(kw, true);
        if (look.face) return patch({ k: 'fill', ring, color: look.face, opacity: look.opacity, label: null, edge: look.edge, zorder: zorderOf(kw) });
        return patch({ k: 'line', pts: closed ? [...ring, ring[0]] : ring, color: look.edge ?? 'blue', width: look.width, dashed: look.dashed, opacity: 1, label: null, marker: false, markerSize: 'normal', markerOnly: false, zorder: zorderOf(kw) ?? 1 }); // a patch outline: matplotlib's zorder 1
    });
    const rectangle = new PyBuiltin('Rectangle', (a, kw) => {
        const xy = iterate(a[0] ?? new PyTuple([0, 0])).map((v) => num(v));
        const w = num(arg(a, kw, 1, 'width', 1));
        const h = num(arg(a, kw, 2, 'height', 1));
        const ring: Pt2[] = [[xy[0], xy[1]], [xy[0] + w, xy[1]], [xy[0] + w, xy[1] + h], [xy[0], xy[1] + h]];
        const look = patchLook(kw, true);
        if (look.face) return patch({ k: 'fill', ring, color: look.face, opacity: look.opacity, label: null, edge: look.edge, zorder: zorderOf(kw) });
        return patch({ k: 'line', pts: [...ring, ring[0]], color: look.edge ?? 'blue', width: look.width, dashed: look.dashed, opacity: 1, label: null, marker: false, markerSize: 'normal', markerOnly: false, zorder: zorderOf(kw) ?? 1 }); // a patch outline: matplotlib's zorder 1
    });
    attrs.set('Circle', circle);
    attrs.set('Polygon', polygon);
    attrs.set('Rectangle', rectangle);
    const patches = new PyModule('matplotlib.patches', new Map<string, PyValue>([['Circle', circle], ['Polygon', polygon], ['Rectangle', rectangle]]));
    const plt = new PyModule('matplotlib.pyplot', attrs);
    const matplotlib = new PyModule('matplotlib', new Map<string, PyValue>([['pyplot', plt], ['patches', patches], ['use', new PyBuiltin('use', () => null)]]));
    return { plt, matplotlib };
}

/** The patches module alone (from matplotlib.patches import Circle). */
export function patchesOf(matplotlib: PyModule): PyModule | null {
    const p = matplotlib.attrs.get('patches');
    return p instanceof PyModule ? p : null;
}

/** A value that is a number for the scene (complex values have no place in a plot). */
export function realNumber(v: PyValue): number {
    if (v instanceof PyComplex) return v.re;
    if (isNum(v)) return Number(v);
    throw typeError('python.type.needNumber', { what: 'plot', type: 'value' });
}
