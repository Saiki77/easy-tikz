/*
 * The view of a hover card (6.0.1, clean look): framed on what matters
 * instead of y fitted to the whole x range. The key points of each function
 * (its real roots, its local extrema and where it crosses the y-axis) are
 * found over -10 to 10; the view holds the ones nearest to 0 with a margin,
 * in round numbers, and the curve may run on a little past them. The card
 * marks the roots and extrema of the view as dots (roots pink, extrema
 * violet), recomputed for each drawing (sliders, pans, zooms). Pure: no DOM,
 * no Obsidian.
 */
import { SettingsManager } from '../settings';
import { findExtrema1D } from '../math';
import type { Parameter } from '../types';

type Rec = Record<string, unknown>;

export interface KeyPoint {
    x: number;
    y: number;
}

export interface KeyPoints {
    roots: KeyPoint[];
    extrema: Array<KeyPoint & { type: 'minimum' | 'maximum' }>;
    /** Where the curve crosses the y-axis; null when f(0) is not a number. */
    intercept: KeyPoint | null;
}

export interface FrameView {
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
}

/** Key points are looked for over -REACH to REACH. */
const REACH = 10;
/** Samples for the roots over a range. */
const ROOT_SAMPLES = 800;
/** Samples for the extrema over a range. */
const EXTREMA_SAMPLES = 400;
/** More roots than this over a range: the function is 0 on a whole piece (no dots). */
const MAX_ROOTS = 60;
/** The view holds this many key places (x values) nearest to 0, and every one as near as the last of them. */
const KEY_PLACES = 5;
/** The narrowest view in x. */
const MIN_WIDTH = 4;
/** At most this many dots of each kind per function. */
const MAX_DOTS = 80;

const finite = (v: number) => Number.isFinite(v);

/** The real roots of f over [lo, hi]: sign changes (not poles) and touching zeros. */
function rootsOf(f: (x: number) => number, lo: number, hi: number, extrema: KeyPoints['extrema']): number[] {
    const out: number[] = [];
    const tolX = (hi - lo) * 1e-6;
    let maxAbs = 1;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= ROOT_SAMPLES; i++) {
        const x = lo + ((hi - lo) * i) / ROOT_SAMPLES;
        const y = f(x);
        xs.push(x);
        ys.push(y);
        if (finite(y)) maxAbs = Math.max(maxAbs, Math.abs(y));
    }
    // A root has a value near 0; a pole or a jump flips the sign too, with a large value there.
    const tolY = maxAbs * 1e-7;
    const push = (x: number) => {
        if (!out.some((r) => Math.abs(r - x) <= tolX)) out.push(x);
    };
    for (let i = 0; i <= ROOT_SAMPLES; i++) {
        const y = ys[i];
        if (y === 0) {
            push(xs[i]);
            continue;
        }
        if (i === 0) continue;
        const py = ys[i - 1];
        if (!finite(py) || !finite(y) || py === 0 || Math.sign(py) === Math.sign(y)) continue;
        let a = xs[i - 1];
        let b = xs[i];
        let fa = py;
        let ok = true;
        for (let k = 0; k < 64; k++) {
            const m = (a + b) / 2;
            const fm = f(m);
            if (!finite(fm)) {
                ok = false;
                break;
            }
            if (fm === 0) {
                a = b = m;
                break;
            }
            if (Math.sign(fm) === Math.sign(fa)) {
                a = m;
                fa = fm;
            } else b = m;
        }
        const r = (a + b) / 2;
        if (ok && Math.abs(f(r)) <= tolY) push(r);
    }
    // A zero the curve only touches (x^2 at 0): an extremum at height 0.
    for (const e of extrema) if (Math.abs(e.y) <= tolY) push(e.x);
    if (out.length > MAX_ROOTS) return [];
    return out.sort((p, q) => p - q);
}

/** The roots, local extrema and y-intercept of f over [lo, hi]. */
export function keyPoints(f: (x: number) => number, lo: number, hi: number): KeyPoints {
    if (!(hi > lo) || !finite(lo) || !finite(hi)) return { roots: [], extrema: [], intercept: null };
    let extrema: KeyPoints['extrema'] = [];
    try {
        extrema = findExtrema1D(f, lo, hi, EXTREMA_SAMPLES);
    } catch {
        extrema = [];
    }
    const roots = rootsOf(f, lo, hi, extrema);
    const y0 = lo <= 0 && 0 <= hi ? f(0) : NaN;
    return {
        roots: roots.map((x) => ({ x, y: 0 })),
        // An extremum on the x-axis is a root's dot.
        extrema: extrema.filter((e) => !roots.some((r) => Math.abs(r - e.x) <= (hi - lo) * 1e-6)),
        intercept: finite(y0) ? { x: 0, y: y0 } : null,
    };
}

/** The largest of 1, 2, 5 times a power of ten that is at most v. */
function niceFloor(v: number): number {
    if (!(v > 0) || !finite(v)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const k = v / p;
    return (k >= 5 ? 5 : k >= 2 ? 2 : 1) * p;
}

/** A range widened to round numbers: steps of about a sixth of its width, at least halves. */
function roundOut(lo: number, hi: number): [number, number] {
    const step = Math.max(0.5, niceFloor((hi - lo) / 6));
    const clean = (v: number) => Number(v.toPrecision(12)) + 0;
    return [clean(Math.floor(lo / step + 1e-9) * step), clean(Math.ceil(hi / step - 1e-9) * step)];
}

/**
 * The view of a card for functions: x holds the key places nearest to 0
 * (and 0, so the y-axis shows) with a margin, at least MIN_WIDTH wide; y
 * holds the key points and the x-axis with a little room, and the curve
 * may run a little further where it goes on. Null when nothing is drawn.
 */
export function frameView(fns: Array<(x: number) => number>): FrameView | null {
    if (!fns.length) return null;
    const keys: KeyPoint[] = [];
    for (const f of fns) {
        const k = keyPoints(f, -REACH, REACH);
        keys.push(...k.roots, ...k.extrema);
        if (k.intercept) keys.push(k.intercept);
    }
    // The places nearest to 0: a periodic function (sin x) has key points everywhere.
    const places = Array.from(new Set([0, ...keys.map((k) => Number(k.x.toPrecision(9)))])).sort((a, b) => Math.abs(a) - Math.abs(b));
    const reach = Math.abs(places[Math.min(places.length, KEY_PLACES) - 1]) + 1e-9;
    const near = places.filter((x) => Math.abs(x) <= reach);
    let x0 = Math.min(...near);
    let x1 = Math.max(...near);
    const margin = Math.min(3, Math.max(1.5, 0.25 * (x1 - x0)));
    x0 -= margin;
    x1 += margin;
    if (x1 - x0 < MIN_WIDTH) {
        const mid = (x0 + x1) / 2;
        x0 = mid - MIN_WIDTH / 2;
        x1 = mid + MIN_WIDTH / 2;
    }
    [x0, x1] = roundOut(x0, x1);
    // y: the key points in view and the x-axis, then the curve a little past them.
    const inView = keys.filter((k) => k.x >= x0 && k.x <= x1 && finite(k.y));
    const ky0 = Math.min(0, ...inView.map((k) => k.y));
    const ky1 = Math.max(0, ...inView.map((k) => k.y));
    const span = Math.max(1, ky1 - ky0);
    const pad = Math.max(1, 0.15 * span);
    const run = Math.max(2, 0.75 * span);
    let cy0 = Infinity;
    let cy1 = -Infinity;
    for (const f of fns) {
        for (let i = 0; i <= 400; i++) {
            const y = f(x0 + ((x1 - x0) * i) / 400);
            if (!finite(y)) continue;
            cy0 = Math.min(cy0, y);
            cy1 = Math.max(cy1, y);
        }
    }
    if (!finite(cy0)) return null;
    const y0 = Math.min(ky0 - pad, Math.max(cy0, ky0 - run));
    const y1 = Math.max(ky1 + pad, Math.min(cy1, ky1 + run));
    const [ry0, ry1] = roundOut(y0, y1);
    return { xmin: x0, xmax: x1, ymin: ry0, ymax: ry1 };
}

/** The functions a chart draws as curves y = f(x), at its slider values. */
function chartFunctions(data: Rec): Array<{ fn: (x: number) => number; domain: [number, number] | null }> {
    if (data.dimension === true || data.coordinateSystem === 'polar') return [];
    const settings = SettingsManager.fromJSON(data);
    const math = settings.createMathContext({ memo: false });
    const params = settings.getValue('parameters');
    math.setParams(Array.isArray(params) ? (params as Parameter[]) : []);
    return math
        .functions()
        .filter((info) => info.kind === 'cartesian' && !info.hidden && !info.error && !info.domainError)
        .map((info) => ({ fn: info.fn, domain: info.domain }));
}

/**
 * A card's chart framed on what matters (frameView): its x and y, and y no
 * longer following x (a pan or a zoom moves both). Null when it has no
 * curve y = f(x) to frame (the chart then stays as it is).
 */
export function frameChart(data: Rec): Rec | null {
    let view: FrameView | null = null;
    try {
        const fns = chartFunctions(data);
        view = frameView(fns.map((f) => f.fn));
    } catch {
        view = null;
    }
    if (!view) return null;
    return { ...data, ...view, fitY: false };
}

/** A number as a chart's formula writes it: plain decimals (no 1e-7, which reads as 1 e - 7), to a millionth (a dot needs no more). */
function plain(v: number): string | null {
    if (!finite(v) || Math.abs(v) >= 1e12) return null;
    const s = v.toFixed(6).replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
}

function pointsText(points: KeyPoint[]): string {
    return points
        .map((p) => {
            const x = plain(p.x);
            const y = plain(p.y);
            return x !== null && y !== null ? `(${x}, ${y})` : '';
        })
        .filter((s) => s)
        .join('; ');
}

/** The colours of the dots: roots pink, extrema violet (the theme's own pink and purple, see src/colors.ts). */
export const ROOT_COLOR = 'magenta';
export const EXTREMUM_COLOR = 'purple';

/**
 * The dots of a function card for its view and slider values now: a points
 * list of the roots and one of the extrema, without labels. They are drawn
 * in the card only (Insert chart and Open in the editor leave them out).
 */
export function keyDots(data: Rec): Rec[] {
    const x0 = Number(data.xmin);
    const x1 = Number(data.xmax);
    if (!(x1 > x0)) return [];
    let fns: ReturnType<typeof chartFunctions> = [];
    try {
        fns = chartFunctions(data);
    } catch {
        return [];
    }
    const roots: KeyPoint[] = [];
    const extrema: KeyPoint[] = [];
    for (const { fn, domain } of fns) {
        const lo = domain ? Math.max(x0, domain[0]) : x0;
        const hi = domain ? Math.min(x1, domain[1]) : x1;
        const k = keyPoints(fn, lo, hi);
        roots.push(...k.roots.slice(0, MAX_DOTS));
        extrema.push(...k.extrema.slice(0, MAX_DOTS));
    }
    const tool = (name: string, list: KeyPoint[], color: string): Rec | null => {
        const points = pointsText(list);
        return points ? { type: 'points', name, dim: 2, source: 'list', points, label: '', color, size: 'normal' } : null;
    };
    return [tool('etzKeyExtrema', extrema, EXTREMUM_COLOR), tool('etzKeyRoots', roots, ROOT_COLOR)].filter((t): t is Rec => t !== null);
}
