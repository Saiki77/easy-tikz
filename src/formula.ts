/*
 * Every formula in a note is a chart (5.0): the `$...$` formula at the
 * cursor becomes a chart block, fitted to what it draws. A function
 * (`f(x) = ...`, `y = ...` or just an expression in x) is plotted, an
 * equation in x and y (`x^2 + y^2 = 1`) is drawn, an inequality is shaded.
 * Pure: no DOM, no Obsidian; main.ts finds the formula and writes the block.
 */
import { SettingsManager } from './settings';
import type { Parameter } from './types';
import { fitSettings } from './fit';
import { parseChartText } from './text/parse';
import { printChartText } from './text/print';
import { BUILTIN_FUNCTION_NAMES, CONSTANT_NAMES } from './expr';
import { latexToPlain, splitLetterRuns } from './latex';

/** The inline formula `$...$` around column `ch` of a line: its TeX and where it sits (dollars included). */
export function formulaAt(line: string, ch: number): { tex: string; from: number; to: number } | null {
    const re = /(?<!\\)\$(?!\$)((?:[^$\\]|\\.)+?)(?<!\\)\$/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
        const from = m.index;
        const to = m.index + m[0].length;
        if (ch >= from && ch <= to) return { tex: m[1].trim(), from, to };
    }
    return null;
}

/** The `$...$` and `$$...$$` formulas of a text, in order (code spans and escaped dollars left out). */
export function formulasIn(text: string): Array<{ tex: string; start: number; end: number }> {
    const plain = text.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
    const out: Array<{ tex: string; start: number; end: number }> = [];
    const re = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<![\\$])\$(?!\$)((?:[^$\\\n]|\\.)+?)(?<!\\)\$/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(plain))) out.push({ tex: (m[1] ?? m[2] ?? '').trim(), start: m.index, end: m.index + m[0].length });
    return out;
}

/** Spacing and punctuation that a formula in prose carries: `\displaystyle`, `\quad`, a full stop at the end. */
function clean(tex: string): string {
    return tex
        .replace(/\\(displaystyle|textstyle|quad|qquad)\b/g, ' ')
        .replace(/[.,;]\s*$/, '')
        .trim();
}

/** Names a formula may use without a slider: the variables, the built-in functions and constants. */
const KNOWN = new Set(['x', 'y', 'z', 't', 'theta', 'r', ...BUILTIN_FUNCTION_NAMES, ...CONSTANT_NAMES]);

/** The other letters of a formula (a, b, k_1): each becomes a slider, so `ax^2 + b` draws and moves. */
export function freeNames(tex: string): string[] {
    const plain = latexToPlain(tex);
    const out: string[] = [];
    for (const m of plain.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)) {
        const name = m[0];
        // A name right before a bracket is a function (f(x)), not a slider.
        const call = plain[(m.index ?? 0) + name.length] === '(';
        if (KNOWN.has(name) || out.includes(name) || call) continue;
        out.push(name);
    }
    return out;
}

/** What a formula draws: a function of x, a surface z = f(x, y), a polar curve r(θ), an equation, a region. */
export type FormulaKind = 'function' | 'surface' | 'polar' | 'equation' | 'region';

/** The chart lines for a formula, without the view: what it is, written in the chart language. */
export function formulaLines(texIn: string): { kind: FormulaKind; lines: string[] } | null {
    // A formula from a note is LaTeX: ax^2 is a x^2.
    const tex = splitLetterRuns(clean(texIn));
    if (!tex) return null;
    const sliders = (body: string) => freeNames(body).map((n) => `slider ${n} from -5 to 5, starting at 1`);
    if (/\\(le|leq|ge|geq|lt|gt)\b|[<>]/.test(tex)) return { kind: 'region', lines: [...sliders(tex), `shade where $${tex}$`] };
    const eq = tex.split('=');
    if (eq.length === 2) {
        const left = eq[0].trim();
        const right = eq[1].trim();
        const named = /^([A-Za-z][A-Za-z0-9_]*)\s*\(\s*x\s*\)$/.exec(left);
        if (named) return { kind: 'function', lines: [...sliders(right), `plot $${named[1]}(x) = ${right}$ in blue, thick`] };
        if (/^y$/.test(left)) return { kind: 'function', lines: [...sliders(right), `plot $f(x) = ${right}$ in blue, thick`] };
        if (/^y$/.test(right)) return { kind: 'function', lines: [...sliders(left), `plot $f(x) = ${left}$ in blue, thick`] };
        // A surface: z = f(x, y), or f(x, y) = ...
        if (/^z$/.test(left) || /^[A-Za-z][A-Za-z0-9_]*\s*\(\s*x\s*,\s*y\s*\)$/.test(left)) {
            return { kind: 'surface', lines: ['3d', 'cube', ...sliders(right), `plot $z = ${right}$ in blue`] };
        }
        // A polar curve: r = f(θ), or r(θ) = ...
        if (/^r(\s*\(\s*\\?theta\s*\))?$/.test(left)) {
            return { kind: 'polar', lines: [...sliders(right), `plot $r(\\theta) = ${right}$ in blue, thick`] };
        }
        return { kind: 'equation', lines: [...sliders(tex), `draw $${tex}$ in blue, thick`] };
    }
    if (eq.length === 1) return { kind: 'function', lines: [...sliders(tex), `plot $f(x) = ${tex}$ in blue, thick`] };
    return null;
}

/** A formula as a whole chart: its lines with a view fitted to what they draw, or null when it does not draw. */
export function formulaChart(tex: string): string[] | null {
    const found = formulaLines(tex);
    if (!found) return null;
    const { kind, lines } = found;
    // Functions go on forever: x from -5 to 5 (the fit then takes y); equations and regions fit both axes.
    const view = kind === 'surface' ? 'show x from -3 to 3, y from -3 to 3 and z from -5 to 5' : 'show x from -5 to 5 and y from -5 to 5';
    const start = [view, ...lines];
    const parsed = parseChartText(start.join('\n'));
    if (parsed.problems.length) return null;
    const settings = SettingsManager.fromJSON(parsed.data);
    const math = settings.createMathContext({ memo: false });
    const params = settings.getValue('parameters');
    math.setParams(Array.isArray(params) ? (params as Parameter[]) : []);
    try {
        const fit = fitSettings(settings, math, { x: true, y: true, z: true });
        if (fit.nothing === 'empty') return null;
        const x = fit.x ? fit.x.text : kind === 'surface' ? ['-3', '3'] : ['-5', '5'];
        const y = fit.y ? fit.y.text : kind === 'surface' ? ['-3', '3'] : ['-5', '5'];
        if (kind === 'surface') {
            const z = fit.z ? fit.z.text : ['-5', '5'];
            return [`show x from ${x[0]} to ${x[1]}, y from ${y[0]} to ${y[1]} and z from ${z[0]} to ${z[1]}`, ...lines];
        }
        return [`show x from ${x[0]} to ${x[1]} and y from ${y[0]} to ${y[1]}`, ...lines];
    } catch {
        return start;
    }
}

/** What a default chart for formulas sets: how the chart looks, never what it draws or where. */
const DEFAULT_CHART_KEYS = [
    'axis_style', 'show_axis_label', 'axis_label_x', 'axis_label_y', 'axis_label_z',
    'showLargeGrid', 'showSmallGrid', 'gridOpacity', 'gridSize', 'majorTickNum',
    'numbers_x', 'numbers_step_x', 'numbers_at_x', 'numbers_y', 'numbers_step_y', 'numbers_at_y', 'numbers_z', 'numbers_step_z', 'numbers_at_z',
    'equalScale', 'size_x_cm', 'size_y_cm', 'boxAspect', 'rotationX', 'rotationZ', 'zoom3D', 'documentSetup', 'showSlidersInNote',
];
/** The style of a line the default's first function gives every function and curve of a formula chart. */
const LINE_STYLE = ['color', 'thickness', 'dashed', 'extrema', 'showLegend', 'fill', 'fillOpacity', 'fillPattern'];
/** The style the default's first surface gives a surface. */
const SURFACE_STYLE = ['color', 'colormap', 'opacity', 'meshOpacity', 'wireframe', 'samples'];

type Rec = Record<string, unknown>;
const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * A formula's chart in the look of the default chart for formulas (a
 * setting the person sets up in the editor): its axes, grid, numbers, size
 * and 3D view, and the style of its first function and surface. What the
 * formula draws and the fitted view stay the formula's.
 */
export function applyFormulaDefault(data: Rec, def: Rec | null | undefined): Rec {
    if (!def) return data;
    const out = copy(data);
    for (const k of DEFAULT_CHART_KEYS) if (k in def) out[k] = copy(def[k]);
    const first = (key: string): Rec | null => {
        const list = def[key];
        return Array.isArray(list) && list[0] && typeof list[0] === 'object' ? (list[0] as Rec) : null;
    };
    const style = (list: unknown, from: Rec | null, keys: readonly string[]) => {
        if (!from || !Array.isArray(list)) return;
        for (const item of list as Rec[]) for (const k of keys) if (k in from) item[k] = copy(from[k]);
    };
    const line = first('functions');
    style(out.functions, line, LINE_STYLE);
    style(out.functions3D, first('functions3D'), SURFACE_STYLE);
    // A curve (an equation) takes the line's colour, thickness and dashes.
    if (line && Array.isArray(out.tools)) {
        for (const tool of out.tools as Rec[]) {
            if (tool.type !== 'curve') continue;
            for (const k of ['color', 'thickness', 'dashed']) if (k in line) tool[k] = copy(line[k]);
        }
    }
    return out;
}

/** The chart block body of a formula in the default look, as the plugin writes it; null when it does not draw. */
export function formulaBlock(tex: string, def: Rec | null | undefined): string | null {
    const lines = formulaChart(tex);
    if (!lines) return null;
    const parsed = parseChartText(lines.join('\n'));
    if (parsed.problems.length) return null;
    return printChartText(applyFormulaDefault(parsed.data, def));
}

/** The variables a chart of a formula runs along: a formula without any of them (E = mc^2, a lone 1/2) has no chart. */
const VARIABLES = new Set(['x', 'y', 'z', 'r', 'theta']);

const chartableMemo = new Map<string, boolean>();

/**
 * Does a formula of a note have a chart (5.0)? It reads as chart lines
 * without a problem and uses a variable (x, y, z, r, theta). The card opens
 * only for these, and the setting Highlight formulas in notes marks them.
 */
export function chartable(tex: string): boolean {
    const hit = chartableMemo.get(tex);
    if (hit !== undefined) return hit;
    let ok = false;
    try {
        const f = formulaLines(tex);
        const names = latexToPlain(splitLetterRuns(clean(tex))).match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [];
        ok = !!f && names.some((n) => VARIABLES.has(n)) && parseChartText(f.lines.join('\n')).problems.length === 0;
    } catch {
        ok = false;
    }
    if (chartableMemo.size > 500) chartableMemo.clear();
    chartableMemo.set(tex, ok);
    return ok;
}
