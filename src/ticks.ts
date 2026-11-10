/*
 * The numbers on an axis (issue #5): Auto (the renderer's own ticks, as
 * before), Every (a step, also a formula such as `pi/2`), At (chosen values,
 * each with an optional label in quotes) and Off (no numbers and no tick
 * marks; the grid stays). Shared by the 2D and 3D previews and the export,
 * so the preview and the PDF show the same numbers. A step or a value whose
 * formula says pi prints as a multiple of π. Pure: no DOM, no Obsidian.
 *
 * Chart fields per axis a (x, y, z): `numbers_a` ('auto' | 'every' | 'at' |
 * 'off'), `numbers_step_a` (the step's formula) and `numbers_at_a` (the
 * values). The step and the values stay stored when the mode changes.
 */
import { formatTick, tickValues } from './util';

export type NumbersMode = 'auto' | 'every' | 'at' | 'off';
export type TickAxis = 'x' | 'y' | 'z';
export const NUMBERS_MODES: readonly NumbersMode[] = ['auto', 'every', 'at', 'off'];

/** What the chart says for one axis. */
export interface AxisNumbers {
    mode: NumbersMode;
    /** Every: the step's formula. */
    step: string;
    /** At: the values, `1, 3` or `a "a", b "b"`. */
    at: string;
}

export const AUTO_NUMBERS: Readonly<AxisNumbers> = { mode: 'auto', step: '', at: '' };

/** The chart fields of an axis. */
export function numbersKeys(axis: TickAxis): { mode: string; step: string; at: string } {
    return { mode: `numbers_${axis}`, step: `numbers_step_${axis}`, at: `numbers_at_${axis}` };
}

/** A stored mode, or Auto for anything else. */
export function numbersMode(v: unknown): NumbersMode {
    return typeof v === 'string' && (NUMBERS_MODES as readonly string[]).includes(v) ? (v as NumbersMode) : 'auto';
}

/** One tick: where it is and what it says. */
export interface Tick {
    value: number;
    /** What the preview prints: the user's label, a multiple of π, or the number. */
    text: string;
    /** The user's own label as written (it may hold `$...$`), when given. */
    label?: string;
    /** The LaTeX of a multiple of π (`$\frac{\pi}{2}$`), when the value is one and its formula says pi. */
    piTex?: string;
}

/** The ticks of one axis for one frame. */
export interface AxisTicks {
    mode: NumbersMode;
    /** Where tick marks and numbers go, in order (none for Off). */
    ticks: Tick[];
    /** False for Off: no tick marks either. */
    marks: boolean;
    /** Where the grid lines of this axis go: the ticks, or the renderer's own for Auto and Off. */
    grid: number[];
    /** Every: the step's value (the export writes it as `xtick distance`). */
    step?: number;
    /** Every: its formula says pi, so the numbers are multiples of π. */
    pi?: boolean;
    /** The step or a value could not be read; the ticks are the renderer's own (as Auto). */
    problem?: 'step' | 'at';
}

/** Something that turns a formula into a number (MathContext.value): NaN when it cannot. */
export type ValueOf = (src: string) => number;

/** The formula mentions pi (or π) as a name. */
export function mentionsPi(src: string): boolean {
    // `3pi/2` too (a number before pi multiplies it); not a longer name such as `api` or `pi2`.
    return /(^|[^A-Za-z_])pi($|[^A-Za-z0-9_])/.test(src) || src.includes('π');
}

const PI_DENOMINATORS = [1, 2, 3, 4, 6, 8, 12];

/** A value as k π / n, when it is one with a small n: text `3π/2`, LaTeX `$\frac{3\pi}{2}$`. */
export function piMultiple(value: number): { text: string; tex: string } | null {
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) < 1e-12) return { text: '0', tex: '$0$' };
    const r = value / Math.PI;
    for (const n of PI_DENOMINATORS) {
        const k = Math.round(r * n);
        if (k === 0 || Math.abs(r * n - k) > 1e-9 * Math.max(1, Math.abs(k))) continue;
        const g = gcd(Math.abs(k), n);
        const top = Math.abs(k) / g;
        const bottom = n / g;
        const sign = k < 0 ? '-' : '';
        const text = `${sign}${top === 1 ? '' : top}π${bottom === 1 ? '' : `/${bottom}`}`;
        const texTop = `${top === 1 ? '' : top}\\pi`;
        const tex = bottom === 1 ? `$${sign}${texTop}$` : `$${sign}\\frac{${texTop}}{${bottom}}$`;
        return { text, tex };
    }
    return null;
}

function gcd(a: number, b: number): number {
    return b ? gcd(b, a % b) : a || 1;
}

/** One value of an At list: its formula and its label (null without quotes). */
export interface AtItem {
    src: string;
    label: string | null;
}

/**
 * The values of an At list: separated by commas outside brackets and
 * quotes, each a formula with an optional label in double quotes after it
 * (`a "a", 3pi/2 "$\frac{3\pi}{2}$"`). An item without a formula is left out.
 */
export function parseNumbersAt(src: string): AtItem[] {
    const items: AtItem[] = [];
    let depth = 0;
    let quoted = false;
    let start = 0;
    const push = (end: number) => {
        const raw = src.slice(start, end).trim();
        start = end + 1;
        if (!raw) return;
        const m = /^([\s\S]*?)\s*"([^"]*)"\s*$/.exec(raw);
        const formula = (m ? m[1] : raw).trim();
        if (formula) items.push({ src: formula, label: m ? m[2] : null });
    };
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '"') quoted = !quoted;
        else if (quoted) continue;
        else if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
        else if (c === ',' && depth === 0) push(i);
    }
    push(src.length);
    return items;
}

/** At most this many ticks on an axis; a step that makes more is a problem. */
export const MAX_TICKS = 200;

/**
 * The ticks of one axis from lo to hi. `auto` holds the renderer's own tick
 * values (2D and 3D choose them differently), used for Auto, for the grid of
 * Off, and when the step or the values cannot be read.
 */
export function axisTicks(n: AxisNumbers, lo: number, hi: number, auto: readonly number[], valueOf: ValueOf): AxisTicks {
    const autoTicks = (): Tick[] => auto.map((value) => ({ value, text: formatTick(value) }));
    const tol = 1e-9 * Math.max(1, Math.abs(hi - lo));
    switch (n.mode) {
        case 'off':
            return { mode: 'off', ticks: [], marks: false, grid: [...auto] };
        case 'every': {
            const step = n.step.trim() ? valueOf(n.step) : NaN;
            const values = step > 0 && Number.isFinite(step) ? tickValues(lo, hi, step, MAX_TICKS) : [];
            if (!values.length) return { mode: 'auto', ticks: autoTicks(), marks: true, grid: [...auto], problem: 'step' };
            const pi = mentionsPi(n.step);
            const ticks = values.map((value): Tick => {
                const m = pi ? piMultiple(value) : null;
                return m ? { value, text: m.text, piTex: m.tex } : { value, text: formatTick(value) };
            });
            return { mode: 'every', ticks, marks: true, grid: values, step, pi };
        }
        case 'at': {
            const items = parseNumbersAt(n.at);
            const ticks: Tick[] = [];
            let bad = false;
            for (const item of items) {
                const value = valueOf(item.src);
                if (!Number.isFinite(value)) {
                    bad = true;
                    continue;
                }
                if (value < lo - tol || value > hi + tol) continue;
                if (item.label !== null) {
                    ticks.push({ value, text: item.label, label: item.label });
                    continue;
                }
                const m = mentionsPi(item.src) ? piMultiple(value) : null;
                ticks.push(m ? { value, text: m.text, piTex: m.tex } : { value, text: formatTick(value) });
            }
            if (bad || !items.length) return { mode: 'auto', ticks: autoTicks(), marks: true, grid: [...auto], problem: 'at' };
            ticks.sort((a, b) => a.value - b.value);
            return { mode: 'at', ticks, marks: true, grid: ticks.map((t) => t.value) };
        }
        default:
            return { mode: 'auto', ticks: autoTicks(), marks: true, grid: [...auto] };
    }
}

/**
 * The pgfplots options of an axis, so the PDF shows the preview's numbers:
 * nothing for Auto; Off keeps pgfplots' ticks for the grid but prints no
 * numbers and draws no marks; Every without pi is `xtick distance`; Every
 * in π and At list the ticks, with their labels when any has one. `num`
 * prints a number for TeX and `labelTex` makes a user's label safe for it.
 */
export function tickOptions(axis: TickAxis, t: AxisTicks, num: (v: number) => string, labelTex: (raw: string) => string): string[] {
    switch (t.mode) {
        case 'off':
            return [`${axis}ticklabels={}`, `${axis} tick style={draw=none}`];
        case 'every':
            if (!t.pi && t.step !== undefined) return [`${axis}tick distance=${num(t.step)}`];
            break;
        case 'at':
            break;
        default:
            return [];
    }
    if (!t.ticks.length) return [`${axis}tick=\\empty`];
    const opts = [`${axis}tick={${t.ticks.map((k) => num(k.value)).join(',')}}`];
    if (t.ticks.some((k) => k.label !== undefined || k.piTex !== undefined)) {
        const labels = t.ticks.map((k) => (k.label !== undefined ? labelTex(k.label) : k.piTex !== undefined ? k.piTex : `$\\pgfmathprintnumber{${num(k.value)}}$`));
        opts.push(`${axis}ticklabels={${labels.map((l) => `{${l}}`).join(',')}}`);
    }
    return opts;
}
