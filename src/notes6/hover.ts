/*
 * The hover cards of 6.0 B (src/ui/formulaHover.ts shows them): formulas
 * that had no card before, as charts.
 *
 *   sets          \{x \in \mathbb{R}^n \mid g(x) \le 0\}, \{x \mid ...\}, \{(x, y) \mid ...\}
 *   maps          g: \mathbb{R}^n \to \mathbb{R}
 *   conditions    g(x) \le 0, x > 0, |x| < 1, x_1 \ge 2 (in one variable): a set on the x-axis,
 *                 named after the variable (x_1, \lambda, \alpha_1)
 *   intervals     \lambda \in [0, 1], [a, b], (a, b]; two plain numbers alone, (1, 2), are a point
 *   Jensen        g(\lambda x + (1 - \lambda) y) \le \lambda g(x) + (1 - \lambda) g(y): a chord with a slider λ
 *   epigraphs     \operatorname{epi} g = \{(x, t) \mid g(x) \le t\}: the shade above the graph
 *
 * A name the formula uses without defining it (g) is taken from the other
 * formulas of the note (`g(x) = x^2 - 4`); without one, the card uses an
 * example, g(x) = x² − 1, and says so. A formula in ℝⁿ gets a second chart
 * for n = 2, where g(x) reads as g(|x|): x² is x₁² + x₂². Pure: no DOM, no
 * Obsidian.
 */
import { formulaLines } from '../formula';
import { latexToPlain } from '../latex';
import { BUILTIN_FUNCTION_NAMES, CONSTANT_NAMES } from '../expr';
import { SettingsManager } from '../settings';
import { parseChartText } from '../text/parse';
import { compileCondition, solveSet } from './sets';

export type HoverKind = 'set' | 'map' | 'condition' | 'interval' | 'jensen' | 'epigraph';

export interface HoverCard {
    kind: HoverKind;
    /** The chart, in chart lines. */
    lines: string[];
    /** The chart for n = 2, when the formula is in ℝⁿ. */
    lines2?: string[];
    /** The function the card draws: its name, its body (LaTeX), and where it comes from. */
    fn?: { name: string; body: string; from: 'note' | 'example' };
    /** The letter the formula uses for its variable, when it is not x (the chart's x-axis is named after it). */
    variable?: string;
}

/** A definition from the note: the body of g(x) = ..., and the sliders its letters need. */
export interface NoteDefinition {
    body: string;
    sliders: string[];
}

/** The example function of a card whose note defines none: convex, with two zeros. */
export const EXAMPLE_BODY = 'x^2 - 1';

const KNOWN = new Set(['x', 'y', 'z', 'e', 'pi', ...BUILTIN_FUNCTION_NAMES, ...CONSTANT_NAMES]);
const REALS = String.raw`(?:\\mathbb\s*\{?\s*R\s*\}?|\\R(?![A-Za-z])|ℝ|\\mathbf\s*\{\s*R\s*\})`;
/** ℝ, ℝⁿ, ℝ^2: the power (n, a number) or none. */
const SPACE = new RegExp(String.raw`^${REALS}\s*(?:\^\s*\{?\s*([A-Za-z0-9]+)\s*\}?)?$`);
const REL = /\\(?:le|leq|ge|geq|lt|gt|leqslant|geqslant)(?![A-Za-z])|[<>]|≤|≥/;

/** Spacing, sizes and Unicode as plain LaTeX: \left\{ is \{, ℝ is \mathbb{R}, ≤ is \le, λ is \lambda. */
export function normalize(tex: string): string {
    return tex
        .replace(/\\(?:left|right|bigl?|bigr?|Bigl?|Bigr?|biggl?|biggr?)(?![A-Za-z])/g, '')
        .replace(/\\(?:displaystyle|textstyle|quad|qquad)(?![A-Za-z])|\\[,;!: ]/g, ' ')
        .replace(/ℝ/g, '\\mathbb{R}')
        .replace(/∈/g, '\\in ')
        .replace(/≤/g, '\\le ')
        .replace(/≥/g, '\\ge ')
        .replace(/[→⟶]/g, '\\to ')
        .replace(/λ/g, '\\lambda ')
        .replace(/θ/g, '\\theta ')
        .replace(/[∣|]/g, (c) => (c === '∣' ? '\\mid ' : c))
        .replace(/:=|\\coloneqq/g, '=')
        .replace(/[.,;]\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** The functions a formula calls (names before a bracket that are no built-in). */
function calledNames(tex: string): string[] {
    const plain = latexToPlain(tex);
    const out: string[] = [];
    for (const m of plain.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*\(/g)) if (!KNOWN.has(m[1]) && !out.includes(m[1])) out.push(m[1]);
    return out;
}

/** The free letters of a formula (no function, no built-in). */
function letters(tex: string): string[] {
    const plain = latexToPlain(tex);
    const out: string[] = [];
    for (const m of plain.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)) {
        const name = m[0];
        const call = /^\s*\(/.test(plain.slice((m.index ?? 0) + name.length));
        if (call || out.includes(name) || (KNOWN.has(name) && name !== 'x' && name !== 'y' && name !== 'z')) continue;
        out.push(name);
    }
    return out;
}

/** The definitions of functions g(x) = ... among the formulas of a note. */
export function noteDefinitions(formulas: string[]): Map<string, NoteDefinition> {
    const defs = new Map<string, NoteDefinition>();
    for (const tex of formulas) {
        const head = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(\s*x\s*\)\s*(?:=|:=|\\coloneqq)/.exec(normalize(tex));
        if (!head || defs.has(head[1])) continue;
        let found: ReturnType<typeof formulaLines> = null;
        try {
            found = formulaLines(normalize(tex));
        } catch {
            found = null;
        }
        if (!found || found.kind !== 'function') continue;
        const plot = found.lines.map((l) => new RegExp(`^plot \\$${head[1]}\\(x\\) = (.*)\\$ in `).exec(l)).find((m) => m);
        if (!plot) continue;
        defs.set(head[1], { body: plot[1], sliders: found.lines.filter((l) => l.startsWith('slider ')) });
    }
    return defs;
}

/** The letter as a chart writes it: \lambda is lambda. */
const bare = (v: string) => v.replace(/^\\/, '');
const escapeRe = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/**
 * Where the variable `v` stands alone: a letter or a command such as
 * \lambda, with a subscript or none (x_1, x_{12}, \alpha_1; x_1 also as
 * x_{1}). Never inside a command or a longer name; x is not the x of x_1.
 */
function variablePattern(v: string): RegExp {
    const m = /^(\\?[A-Za-z]+)(?:_(?:\{([^{}]+)\}|(.)))?$/.exec(v);
    const base = m ? m[1] : v;
    const sub = m ? (m[2] ?? m[3]) : undefined;
    const head = base.startsWith('\\') ? `${escapeRe(base)}(?![A-Za-z])` : `(?<![\\\\A-Za-z_])${escapeRe(base)}(?![A-Za-z])`;
    const s = sub === undefined ? '' : escapeRe(sub);
    const tail = sub === undefined ? '(?!\\s*_)' : `\\s*_\\s*(?:\\{\\s*${s}\\s*\\}${sub.length === 1 ? `|${s}` : ''})`;
    return new RegExp(head + tail, 'g');
}

/** Replace the variable `v` (a letter or a command such as \lambda, maybe with a subscript: x_1) by `to`, where it stands alone. */
function renameVariable(tex: string, v: string, to: string): string {
    if (v === to) return tex;
    return tex.replace(variablePattern(v), to);
}

/** A variable as a head writes it: a letter or a command (\lambda), maybe with a subscript (x_1, x_{12}). */
const VARIABLE = String.raw`(?:[A-Za-z]|\\[a-z]+)(?:\s*_\s*(?:\{\s*[A-Za-z0-9]+\s*\}|[A-Za-z0-9]))?`;

/** A variable written one way: no spaces, a subscript of one sign without braces (x_{1} is x_1). */
const canonicalVariable = (v: string) => v.replace(/\s+/g, '').replace(/_\{([A-Za-z0-9])\}$/, '_$1');

/** Greek letters that may be a variable. */
const GREEK =/^(?:alpha|beta|gamma|delta|varepsilon|epsilon|zeta|eta|theta|vartheta|kappa|lambda|mu|nu|xi|rho|sigma|tau|varphi|phi|chi|psi|omega)$/;

/**
 * The variable of a formula as LaTeX writes it, from the name latexToPlain
 * gives it: x, x_1 (written x_1 or x_{1}), x_{12}, \lambda, \alpha_1. Null
 * when the formula does not write it so (a name the card cannot draw on an
 * axis).
 */
function texVariable(tex: string, name: string): string | null {
    const letter = /^([A-Za-z])(?:_([A-Za-z0-9]+))?$/.exec(name);
    const greek = /^([A-Za-z]+)(?:\s*_([A-Za-z0-9]+))?$/.exec(name);
    let v: string | null = null;
    if (letter) v = letter[2] === undefined ? letter[1] : `${letter[1]}_${letter[2].length === 1 ? letter[2] : `{${letter[2]}}`}`;
    else if (greek && GREEK.test(greek[1])) {
        // latexToPlain reads \varepsilon as epsilon: the formula's own spelling.
        const name = [greek[1], `var${greek[1]}`].find((g) => GREEK.test(g) && new RegExp(String.raw`\\${g}(?![A-Za-z])`).test(tex)) ?? greek[1];
        // latexToPlain drops the subscript of a Greek letter: \alpha_1 reads as alpha.
        const sub = new RegExp(String.raw`\\${name}(?![A-Za-z])\s*_\s*(?:\{\s*([A-Za-z0-9]+)\s*\}|([A-Za-z0-9]))`).exec(tex);
        const s = sub ? (sub[1] ?? sub[2]) : greek[2];
        v = s === undefined ? `\\${name}` : `\\${name}_${s.length === 1 ? s : `{${s}}`}`;
    }
    if (!v) return null;
    return tex.search(variablePattern(v)) >= 0 ? v : null;
}

/** A plain number as LaTeX writes it: 2, -0.5, 0{,}5, \tfrac12, \frac{4}{3}. */
const PLAIN_NUMBER = String.raw`[+-]?\s*(?:\d+(?:\.\d+|\{,\}\d+)?|\.\d+|\\[dt]?frac\s*(?:\{\s*\d+\s*\}|\d)\s*(?:\{\s*\d+\s*\}|\d))`;
const POINT_PAIR = new RegExp(String.raw`^\(\s*${PLAIN_NUMBER}\s*[,;]\s*${PLAIN_NUMBER}\s*\)$`);

/** A pair of two plain numbers in round brackets, alone: (1, 2), (3{,}5; 3{,}5), (\tfrac43, \tfrac83). A point, never an interval. */
export function isPointPair(tex: string): boolean {
    return POINT_PAIR.test(normalize(tex));
}

let endMath: ReturnType<SettingsManager['createMathContext']> | null = null;

/** The value of an interval's end as LaTeX writes it (2, -0.5, 0{,}5, -\tfrac12, \frac{13}{3}, \pi); NaN for a letter or \infty. */
function endValue(s: string): number {
    const t = s.trim();
    if (/^[+-]?\s*(?:\d+(?:\.\d+)?|\.\d+)$/.test(t)) return Number(t.replace(/\s+/g, ''));
    if (/\\infty|∞/.test(t)) return NaN;
    try {
        endMath ??= SettingsManager.fromJSON({}).createMathContext({ memo: false });
        return endMath.value(latexToPlain(t.replace(/\{,\}/g, '.')));
    } catch {
        return NaN;
    }
}

/** Where the view of a set looks for its ends: near 0 finely, then far out. */
const SET_REACHES = [12, 1000];
/** A set with more ends than this (sin x >= 0) keeps the plain view. */
const SET_MAX_ENDS = 4;

/**
 * The view of a set on the x-axis (its condition in x, no function): -4 to
 * 4, wider where an end of the set lies beyond, so each end shows with room
 * beside it (x \le 6 shows x from -4 to 7, 0 \le K < 60 from -4 to 66).
 */
function setView(cond: string): string {
    const plain = 'show x from -4 to 4';
    const ends: number[] = [];
    try {
        endMath ??= SettingsManager.fromJSON({}).createMathContext({ memo: false });
        const c = compileCondition(endMath, cond, 'x');
        for (const reach of SET_REACHES) {
            for (const p of solveSet(c, -reach, reach)) {
                for (const v of [p.a, p.b]) if (Number.isFinite(v) && Math.abs(v) < reach && !ends.some((e) => Math.abs(e - v) < 1e-6 * Math.max(1, Math.abs(v)))) ends.push(v);
            }
        }
    } catch {
        // A condition the chart reads otherwise: the plain view.
        return plain;
    }
    if (!ends.length || ends.length > SET_MAX_ENDS) return plain;
    const span = Math.max(8, Math.max(...ends) - Math.min(...ends));
    const room = Math.max(1, 0.08 * span);
    const lo = Math.min(-4, Math.floor(Math.min(...ends) - room));
    const hi = Math.max(4, Math.ceil(Math.max(...ends) + room));
    return `show x from ${lo} to ${hi}`;
}

/** g(x) read in the plane: x is the distance to 0, so x² is x₁² + x₂². */
const inPlane = (cond: string) => renameVariable(cond, 'x', '\\sqrt{x^2 + y^2}');

// ------------------------------------------------------------- recognise

interface Parsed {
    kind: HoverKind;
    /** The condition (sets, conditions, intervals), in its own variable. */
    cond?: string;
    variable?: string;
    /** ℝⁿ: a second chart for n = 2. */
    space?: boolean;
    /** The function the formula is about. */
    fn?: string;
    /** A set of pairs (x, y): a region. */
    pair?: [string, string];
}

/** What a formula is, for a card of this part; null for any other formula. */
function parse(texIn: string): Parsed | null {
    const tex = normalize(texIn);
    if (!tex) return null;
    // A map g: R^n -> R.
    const map = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+?)\s*\\(?:to|rightarrow|longrightarrow)\s*(.+)$/.exec(tex);
    if (map) {
        const from = SPACE.exec(map[2].trim());
        const to = SPACE.exec(map[3].trim());
        if (from && to) return { kind: 'map', fn: map[1], space: !!from[1] && from[1] !== '1' };
        return null;
    }
    // The epigraph: epi g = {(x, t) | g(x) <= t}, or epi g alone.
    const epi = /(?:\\operatorname\s*\{\s*epi\s*\}|\\mathrm\s*\{\s*epi\s*\}|\\text\s*\{\s*epi\s*\}|(?<![A-Za-z\\])epi)\s*\(?\s*([A-Za-z][A-Za-z0-9_]*)/.exec(tex);
    if (epi) return { kind: 'epigraph', fn: epi[1] };
    // A set {head | condition}, maybe named: S = {...}.
    const set = /(?:^|=\s*)\\\{\s*(.+?)\s*(?:\\mid|\\vert|\||:)\s*(.+?)\s*\\\}$/.exec(tex);
    if (set) {
        const head = set[1].trim();
        const cond = set[2].trim();
        const pair = /^\(\s*([A-Za-z]|\\[a-z]+)\s*,\s*([A-Za-z]|\\[a-z]+)\s*\)(?:\s*\\in\s*(.+))?$/.exec(head);
        if (pair) {
            const fn = calledNames(cond)[0];
            // {(x, t) | g(x) <= t}: the epigraph of g.
            if (fn && new RegExp(`${fn}\\s*\\(\\s*${pair[1].replace(/\\/g, '\\\\')}\\s*\\)`).test(cond) && REL.test(cond)) {
                const other = pair[2].replace(/\\/g, '\\\\');
                if (new RegExp(`(?:\\\\le|<=|\\\\leq)\\s*${other}(?![A-Za-z])|${other}\\s*(?:\\\\ge|>=|\\\\geq)`).test(cond)) return { kind: 'epigraph', fn };
            }
            return { kind: 'set', cond, pair: [pair[1], pair[2]], fn };
        }
        const one = new RegExp(String.raw`^(${VARIABLE})(?:\s*\\in\s*(.+))?$`).exec(head);
        if (!one) return null;
        const space = one[2] ? SPACE.exec(one[2].trim()) : null;
        if (one[2] && !space) return null;
        return { kind: 'set', cond, variable: canonicalVariable(one[1]), space: !!space && !!space[1] && space[1] !== '1', fn: calledNames(cond)[0] };
    }
    // An interval: lambda in [0, 1], x_1 in [0, 4], or [a, b] alone.
    const inInterval = new RegExp(String.raw`^(${VARIABLE})\s*\\in\s*([[(]\s*[^,]+,[^,]+[\])])$`).exec(tex);
    if (inInterval) {
        const v = canonicalVariable(inInterval[1]);
        return { kind: 'interval', cond: `${v} \\in ${inInterval[2]}`, variable: v };
    }
    // A pair of two plain numbers alone, (1, 2), is a point: no interval.
    if (isPointPair(tex)) return null;
    const bareInterval = /^([[(])\s*(-?[\d.]+|-?\\infty|[A-Za-z])\s*,\s*(-?[\d.]+|\\infty|[A-Za-z])\s*([\])])$/.exec(tex);
    if (bareInterval) return { kind: 'interval', cond: `x \\in ${tex}`, variable: 'x' };
    // Jensen: g(λx + (1 - λ)y) <= λ g(x) + (1 - λ) g(y).
    const lam = /1\s*-\s*(\\lambda|\\theta|\\alpha|\\mu|t)(?![A-Za-z])/.exec(tex);
    const fns = calledNames(tex);
    if (lam && fns.length && REL.test(tex) && (tex.match(new RegExp(`${fns[0]}\\s*\\(`, 'g')) ?? []).length >= 3) return { kind: 'jensen', fn: fns[0], variable: lam[1] };
    // A condition in one variable: g(x) <= 0, x > 0, |x| < 1.
    if (REL.test(tex) && !/=/.test(tex.replace(/\\(?:le|ge|leq|geq)|<=|>=/g, ''))) {
        const vars = letters(tex);
        if (vars.length === 1) {
            // The variable as the formula writes it (x_1, \lambda, \alpha_1): the card draws on an axis named after it.
            const v = texVariable(tex, vars[0]);
            if (!v) return null;
            return { kind: 'condition', cond: tex, variable: v, fn: calledNames(tex)[0] };
        }
    }
    return null;
}

/** Is this a formula of this part (sets, maps, conditions, intervals, Jensen, epigraphs)? */
export function hoverKind(tex: string): HoverKind | null {
    try {
        return parse(tex)?.kind ?? null;
    } catch {
        return null;
    }
}

// ------------------------------------------------------------------ charts

/** Nice levels between lo and hi (about five). */
function levelsBetween(lo: number, hi: number): number[] {
    if (!(hi > lo)) return [lo];
    const raw = (hi - lo) / 5;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 && out.length < 8; v += step) out.push(Number(v.toPrecision(10)));
    return out;
}

/** The values of g over the distances 0 to r, for the levels of a map in the plane. */
function radialRange(name: string, body: string, r: number): [number, number] | null {
    try {
        const parsed = parseChartText(`plot ${name}(x) = ${body}`);
        const math = SettingsManager.fromJSON(parsed.data).createMathContext({ memo: false });
        const fn = math.functionInfo(name)?.fn;
        if (!fn) return null;
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i <= 60; i++) {
            const v = fn((r * i) / 60);
            if (!Number.isFinite(v)) continue;
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
        }
        return Number.isFinite(lo) ? [lo, hi] : null;
    } catch {
        return null;
    }
}

/** The chart of a formula of this part, with the note's definitions; null when it has none. */
export function hoverCard(texIn: string, defs: Map<string, NoteDefinition>): HoverCard | null {
    let p: Parsed | null;
    try {
        p = parse(texIn);
    } catch {
        p = null;
    }
    if (!p) return null;
    const name = p.fn;
    const def = name ? defs.get(name) : undefined;
    const fn = name ? { name, body: def ? def.body : EXAMPLE_BODY, from: def ? ('note' as const) : ('example' as const) } : undefined;
    const sliders = def ? def.sliders : [];
    const plot = fn ? [...sliders, `plot $${fn.name}(x) = ${fn.body}$ in blue, thick`] : [];
    const hidden = fn ? [...sliders, `plot $${fn.name}(x) = ${fn.body}$, hidden`] : [];
    const plane = ['show x from -3 to 3 and y from -3 to 3', 'equal scale'];
    const card = (lines: string[], extra: Partial<HoverCard> = {}): HoverCard => ({ kind: p ? p.kind : 'set', lines, ...(fn ? { fn } : {}), ...extra });
    switch (p.kind) {
        case 'map': {
            if (!fn) return null;
            const lines = ['show x from -4 to 4', ...plot];
            if (!p.space) return card(lines);
            const range = radialRange(fn.name, fn.body, 3 * Math.SQRT2);
            const levels = range ? levelsBetween(range[0], range[1]) : [0, 1, 2];
            return card(lines, { lines2: [...plane, ...hidden, `draw the level curves of $${fn.name}(\\sqrt{x^2 + y^2})$ at ${levels.join(', ')}`] });
        }
        case 'epigraph': {
            if (!fn) return null;
            return card(['show x from -4 to 4', ...plot, `shade where $y \\ge ${fn.name}(x)$, labelled "epi ${fn.name}"`]);
        }
        case 'jensen': {
            if (!fn) return null;
            return card(['show x from -3.5 to 3.5', 'slider lambda from 0 to 1, starting at 0.3', ...plot, `draw the chord of ${fn.name} from -1.5 to 2.5 at $\\lambda$, labelled`], p.variable ? { variable: p.variable } : {});
        }
        case 'set': {
            if (!p.cond) return null;
            if (p.pair) {
                // A set of pairs: a region in the plane, its letters as x and y.
                const cond = renameVariable(renameVariable(p.cond, p.pair[0], 'x'), p.pair[1], 'y');
                return card(['show x from -4 to 4 and y from -4 to 4', ...hidden, `shade where $${cond}$, outlined`]);
            }
            const v = p.variable ?? 'x';
            const cond = renameVariable(p.cond, v, 'x');
            const label = v !== 'x' ? [`xlabel $${v}$`] : [];
            const lines = [fn ? 'show x from -4 to 4' : setView(cond), ...label, ...plot, `mark where $${cond}$ on the x-axis, labelled`];
            return card(lines, { ...(p.space ? { lines2: [...plane, ...hidden, `shade where $${inPlane(cond)}$, outlined`] } : {}), ...(v !== 'x' ? { variable: v } : {}) });
        }
        case 'interval': {
            if (!p.cond) return null;
            const v = p.variable ?? 'x';
            const m = /([[(])\s*([^,]+?)\s*,\s*([^,]+?)\s*([\])])\s*$/.exec(p.cond);
            // The view around the ends, also ends such as -\tfrac12 or \frac{13}{3}.
            const num = (s: string | undefined, fallback: number) => {
                const n = endValue(String(s ?? ''));
                return Number.isFinite(n) ? n : fallback;
            };
            // Ends that are letters (a, b) become sliders.
            const ends = [m?.[2]?.trim() ?? '', m?.[3]?.trim() ?? ''];
            const sliders = ends.map((e, i) => (/^[A-Za-z]$/.test(e) && e !== 'x' ? `slider ${e} from -5 to 5, starting at ${i === 0 ? -1 : 2}` : '')).filter((l) => l);
            const a = /^[A-Za-z]$/.test(ends[0]) ? -1 : num(m?.[2], NaN);
            const b = /^[A-Za-z]$/.test(ends[1]) ? 2 : num(m?.[3], NaN);
            const lo = Number.isFinite(a) ? a : Number.isFinite(b) ? b - 4 : -4;
            const hi = Number.isFinite(b) ? b : lo + 4;
            const pad = Math.max(0.5, (hi - lo) / 2);
            const label = v !== 'x' ? [`xlabel $${v}$`] : [];
            return card([`show x from ${Number((lo - pad).toPrecision(6))} to ${Number((hi + pad).toPrecision(6))}`, ...label, ...sliders, `mark where $${renameVariable(p.cond, v, 'x')}$ on the x-axis, labelled`], v !== 'x' ? { variable: v } : {});
        }
        case 'condition': {
            if (!p.cond) return null;
            const v = p.variable ?? 'x';
            const label = v !== 'x' ? [`xlabel $${v}$`] : [];
            const cond = renameVariable(p.cond, v, 'x');
            return card([fn ? 'show x from -4 to 4' : setView(cond), ...label, ...plot, `mark where $${cond}$ on the x-axis, labelled`], v !== 'x' ? { variable: v } : {});
        }
    }
}

/** The plain name of the formula's variable, for the card's note (λ, t). */
export function variableName(v: string): string {
    const greek: Record<string, string> = { lambda: 'λ', theta: 'θ', alpha: 'α', mu: 'μ', t: 't' };
    return greek[bare(v)] ?? bare(v);
}
