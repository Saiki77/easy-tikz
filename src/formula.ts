/*
 * Every formula in a note is a chart (5.0): the `$...$` formula at the
 * cursor becomes a chart block, fitted to what it draws. A function
 * (`f(x) = ...`, `y = ...` or just an expression in x) is plotted, an
 * equation in x and y (`x^2 + y^2 = 1`) is drawn, an inequality is shaded.
 * Pure: no DOM, no Obsidian; main.ts finds the formula and writes the block.
 */
import { SettingsManager } from './settings';
import { computeScene2D, labelMetricsFor } from './scene';
import { marchingGrid } from './util';
import type { Parameter } from './types';
import { fitSettings } from './fit';
import { parseChartText } from './text/parse';
import { printChartText } from './text/print';
import { BUILTIN_FUNCTION_NAMES, CONSTANT_NAMES } from './expr';
import { latexToPlain, splitLetterRuns } from './latex';
// 6.0 B
import { RESERVED_NAMES } from './migrate';
import { settleLook } from './look'; // 6.1
import { lineSpans, mathSpans } from './mathspans'; // 6.2

/** The inline formula `$...$` around column `ch` of a line: its TeX and where it sits (dollars included); 6.2: the dollars paired as Obsidian pairs them (src/mathspans.ts). */
export function formulaAt(line: string, ch: number): { tex: string; from: number; to: number } | null {
    const hit = lineSpans(line).find((s) => ch >= s.start && ch <= s.end && s.tex);
    return hit ? { tex: hit.tex, from: hit.start, to: hit.end } : null;
}

/**
 * The `$...$` and `$$...$$` formulas of a text, in order. 6.2: as Obsidian's
 * Reading view finds them (src/mathspans.ts): a money sign (5$, $2.50) or
 * "$ x $" is no formula, code is none, \$ is a dollar sign.
 */
export function formulasIn(text: string): Array<{ tex: string; start: number; end: number }> {
    return mathSpans(text).map(({ tex, start, end }) => ({ tex, start, end }));
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

/**
 * Formulas without a chart: matrices and vectors, transposes, gradients and
 * partial derivatives, sums, products, integrals and limits, sets and maps,
 * factorials, a derivative of order n (f^{(n)}).
 */
const NOT_A_CHART =
    /\\(?:begin|end|nabla|partial|sum|prod|int|iint|oint|lim|top|intercal|mathbf|boldsymbol|vec|mathbb|forall|exists|subset|subseteq|supset|cup|cap|det|to|mapsto|rightarrow|cdots|ldots|dots|vdots|binom|choose|in|notin)(?![A-Za-z])|(?<!\\)!|\^\s*\{?\s*T\s*\}?(?![A-Za-z])|\^\s*\{\s*\(/;

/** A braced group, one level of nested braces inside: {x \in R^2}, {x_{1}}. */
const GROUP = String.raw`\{(?:[^{}]|\{[^{}]*\})*\}`;

/**
 * An optimisation problem charts its objective: min, max, argmin, inf, sup,
 * written as \min_{x \in \mathbb{R}^2}, \underbrace{min}_{x \in R^2},
 * \underset{x}{\min}, \operatorname{argmin}_x or a plain min, go with their
 * subscripts. A min that is called, min(x, 1), is a function and stays.
 * Constraints after s.t. are left out.
 */
function objective(tex: string): string {
    const op = String.raw`(?:arg\s*)?(?:min|max|inf|sup)`;
    const sub = String.raw`(?:\s*_\s*(?:${GROUP}|[A-Za-z0-9]))?`;
    return tex
        .replace(/\\text\s*\{\s*(?:s\.\s*t\.|u\.\s*d\.\s*N\.|subject to|unter)[\s\S]*$/i, '')
        .replace(/(?:^|\s)s\.\s*t\.[\s\S]*$/i, '')
        .replace(new RegExp(String.raw`\\underbrace\s*\{\s*\\?${op}\s*\}${sub}`, 'g'), ' ')
        .replace(new RegExp(String.raw`\\underset\s*${GROUP}\s*\{\s*\\?${op}\s*\}`, 'g'), ' ')
        .replace(new RegExp(String.raw`(?:\\operatorname\*?\s*\{\s*${op}\s*\}|\\arg\s*\\(?:min|max)|\\text\s*\{\s*${op}\s*\})${sub}`, 'g'), ' ')
        .replace(new RegExp(String.raw`\\(?:min|max|inf|sup)\s*_\s*(?:${GROUP}|[A-Za-z0-9])`, 'g'), ' ')
        .replace(new RegExp(String.raw`(^|[^A-Za-z\\])(?:arg)?(?:min|max)\s*_\s*(?:${GROUP}|[A-Za-z0-9])`, 'g'), '$1 ')
        .replace(/(^|[^A-Za-z\\])((?:\\)?(?:arg)?(?:min|max|inf|sup))(?![A-Za-z])(?!\s*\()/g, '$1 ')
        .trim();
}

/**
 * The axes of a formula in x_1, x_2 (also x_{1}): x_1 is x and x_2 is y, so
 * 2x_1^2 + x_2^2 is the surface z = 2x^2 + y^2. A third one (x_3) has no
 * chart: null.
 */
function axesOf(tex: string): string | null {
    if (/x_\s*\{?\s*[3-9]/.test(tex)) return null;
    return tex.replace(X1, 'x').replace(X2, 'y');
}
const X1 = /x_\s*\{\s*1\s*\}|x_\s*1(?![0-9])/g;
const X2 = /x_\s*\{\s*2\s*\}|x_\s*2(?![0-9])/g;

/** 6.2.1: the names of the axes of a formula in x_1, x_2: the x-axis is x_1 where x_1 became x, the y-axis x_2 where x_2 became y. */
function axisNamesOf(tex: string): { x?: string; y?: string } {
    return { ...(tex.search(X1) >= 0 ? { x: 'x_1' } : {}), ...(tex.search(X2) >= 0 ? { y: 'x_2' } : {}) };
}

/**
 * 6.2.1: a goal written after the objective, (x-1)^2 + 2 \to \min: the
 * objective alone (\to, \rightarrow, \longrightarrow or an arrow sign; min
 * or max, also as \text{min}, maybe with a subscript).
 */
const GOAL = new RegExp(
    String.raw`\s*(?:\\(?:to|rightarrow|longrightarrow)(?![A-Za-z])|→|⟶)\s*(?:\\(?:min|max)(?![A-Za-z])|\\(?:text|mathrm|operatorname)\s*\{\s*(?:min|max)\s*\}|(?:min|max)(?![A-Za-z]))(?:\s*_\s*(?:${GROUP}|[A-Za-z0-9]))?\s*[.,;!]?\s*$`
);

/** The names of a formula after it reads as the plain syntax. */
function namesOf(tex: string): Set<string> {
    return new Set(latexToPlain(tex).match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []);
}

/** Signs typed as Unicode that a formula may use: products, a minus, relations, Greek letters, squares. */
const UNICODE: Record<string, string> = {
    '·': ' \\cdot ', '⋅': ' \\cdot ', '∙': ' \\cdot ', '×': ' \\cdot ', '−': '-', '–': '-',
    '≤': ' \\le ', '≥': ' \\ge ', '²': '^2', '³': '^3',
    'π': ' \\pi ', 'θ': ' \\theta ', 'α': ' \\alpha ', 'β': ' \\beta ', 'γ': ' \\gamma ', 'δ': ' \\delta ', 'λ': ' \\lambda ', 'μ': ' \\mu ',
    'σ': ' \\sigma ', 'ω': ' \\omega ', 'φ': ' \\phi ', 'ρ': ' \\rho ', 'τ': ' \\tau ',
};

/** Unicode signs as LaTeX; null when a sign is left that has no chart (Σ, ∫, ∞, →, ∈, a word such as für). */
function plainSigns(tex: string): string | null {
    const out = tex.replace(/[·⋅∙×−–≤≥²³πθαβγδλμσωφρτ]/g, (c) => UNICODE[c] ?? c);
    return /[\u0080-\uFFFF]/.test(out) ? null : out;
}

/** The variable of a formula without x and y: an index (n, k) or the time (t), before the formula's only letter. */
const OTHER_VARIABLES = ['n', 't', 'k'];
/** Index letters: their charts start at 0, as sequences do. */
const INDEX_VARIABLES = new Set(['n', 'k']);

/**
 * A formula in another variable written in x, for the chart: the letter where
 * it stands alone becomes x (never inside a command such as \sin, a longer
 * name, or a subscript), and a sequence's name on the left (a_n =) becomes a
 * function head a(x).
 */
function inX(tex: string, letter: string): string {
    const head = new RegExp(`^\\s*([A-Za-z])_\\{?${letter}\\}?\\s*=`);
    return tex.replace(head, (_m, name: string) => `${name}(x) =`).replace(new RegExp(`(?<![\\\\A-Za-z_]|_\\{)${letter}(?![A-Za-z])`, 'g'), 'x');
}

/** One formula of a note made ready to chart: its objective, its axes x and y, ax^2 as a x^2. Null: it has no chart. */
function prepared(part: string): { tex: string; vector: boolean; axis?: string; axisNames?: { x?: string; y?: string } } | null {
    // 6.2.1: a goal after the objective (\to \min) is no part of it.
    const signs = plainSigns(part.replace(GOAL, ''));
    if (signs === null) return null;
    const tex = clean(objective(clean(signs)));
    if (!tex || NOT_A_CHART.test(tex)) return null;
    const axes = axesOf(tex);
    if (axes === null) return null;
    const split = splitLetterRuns(axes);
    const names = namesOf(split);
    // i alone is the imaginary unit (e^{ix}): no chart of real numbers.
    if (names.has('i')) return null;
    if (names.has('x') || names.has('y') || names.has('theta')) return { tex: split, vector: axes !== tex, axisNames: axisNamesOf(tex) };
    // No x and no y (\frac{2n^2 + n + 1}{3n^2 + 2}, s(t) = ...): n, t or k, or the only letter, is the variable.
    const letters = [...names].filter((n) => /^[A-Za-df-hj-qs-z]$/.test(n));
    const variable = OTHER_VARIABLES.find((l) => names.has(l)) ?? (letters.length === 1 ? letters[0] : null);
    return variable ? { tex: inX(split, variable), vector: false, axis: variable } : { tex: split, vector: false };
}

/** Environments whose rows are formulas of their own (aligned, align, gathered, ...); cases and arrays are not. */
const ROWS = /\\begin\{(aligned|align\*?|alignat\*?|gathered|gather\*?|split|eqnarray\*?|multline\*?)\}(?:\{[^}]*\})?([\s\S]*?)\\end\{\1\}/;

/**
 * The rows of a formula: the lines of an aligned block (or of a formula with
 * line breaks \\), without the & of the alignment, tags and labels. A formula
 * of one line is one row. A matrix is no row list (it has no chart).
 */
export function formulaRows(tex: string): string[] {
    const env = ROWS.exec(tex);
    if (!env && (!tex.includes('\\\\') || /\\begin\{/.test(tex))) return [tex];
    const body = env ? env[2] : tex;
    const rows = body
        .split(/\\\\(?:\s*\[[^\]]*\])?/)
        .map((r) => r.replace(/\\(?:tag|label)\s*\{[^}]*\}|\\(?:nonumber|notag)/g, '').replace(/&/g, ' ').trim());
    // MathJax drops an empty last row (a \\ before \end) but draws empty rows between: the indexes follow its rows.
    while (rows.length > 1 && !rows[rows.length - 1]) rows.pop();
    return rows;
}

/** A head of a function of x: y, f(x), f'(x), g''(x). Its name, or null. */
const FUNCTION_HEAD = /^(?:y|([A-Za-z][A-Za-z0-9_]*)\s*(?:\^\s*\{\s*-\s*1\s*\})?\s*'*\s*\(\s*x\s*\))$/;
/** An inverse function applied: f^{-1}(y). Only as the head f^{-1}(x) = ... it defines a chart. */
const INVERSE = /[A-Za-z]\s*\^\s*\{\s*-\s*1\s*\}\s*\(/;
/** A head of a function of x and y: z, f(x, y). */
const SURFACE_HEAD = /^(?:z|[A-Za-z][A-Za-z0-9_]*\s*'*\s*\(\s*x\s*,\s*y\s*\))$/;
/** A head of a polar curve: r, r(θ). */
const POLAR_HEAD = /^r(?:\s*\(\s*\\?theta\s*\))?$/;

/** What one prepared formula draws, with the formula to plot (its right side, or all of it); 6.0 B: and the note's name of a function (g(x) = ...: g). */
function kindOf(tex: string, vector = false): { kind: FormulaKind; body: string; name?: string } | null {
    const names = namesOf(tex);
    const usesX = names.has('x');
    const usesY = names.has('y');
    // A lone variable (x, y) is no chart.
    if (/^[xy]$/.test(tex)) return null;
    // A condition on one variable (x > 0, |x| < 1) is a condition, not a region.
    if (/\\(?:le|leq|ge|geq|lt|gt)(?![A-Za-z])|[<>]/.test(tex)) return usesX && usesY ? { kind: 'region', body: tex } : null;
    const sides = tex.split('=');
    if (sides.length > 2) return null;
    if (sides.length === 2) {
        const left = sides[0].trim();
        const right = sides[1].trim();
        if (INVERSE.test(right) || (INVERSE.test(left) && !FUNCTION_HEAD.test(left))) return null;
        const rightNames = namesOf(right);
        if (SURFACE_HEAD.test(left)) return { kind: 'surface', body: right };
        if (FUNCTION_HEAD.test(left)) {
            // f(x) = x_1^2 + x_2^2 with x a vector: a surface. f(x) = y names a value: no chart.
            if (rightNames.has('y')) return vector ? { kind: 'surface', body: right } : null;
            // 6.0 B: g(x) = ... stays g (not g'(x), not g^{-1}(x): those are other functions).
            const own = /^([A-Za-z][A-Za-z0-9_]*)\s*\(\s*x\s*\)$/.exec(left);
            return own && !RESERVED_NAMES.has(own[1]) ? { kind: 'function', body: right, name: own[1] } : { kind: 'function', body: right };
        }
        if (/^y$/.test(right) && !namesOf(left).has('y')) return { kind: 'function', body: left };
        if (POLAR_HEAD.test(left)) return { kind: 'polar', body: right };
        return usesX || usesY ? { kind: 'equation', body: tex } : null;
    }
    if (INVERSE.test(tex)) return null;
    if (usesY) return { kind: 'surface', body: tex };
    return usesX ? { kind: 'function', body: tex } : null;
}

/** At most this many sliders: a formula with more letters is notation, not a chart. */
const MAX_SLIDERS = 4;
/** 6.2.1: the built-in view of a formula's surface: lower and turned off the diagonal, so a ridge along x = y shows its height. */
const SURFACE_VIEW = ['set rotationX = 25', 'set rotationZ = 30'];
const COLOURS = ['blue', 'red', 'green'];

/**
 * The chart lines for a formula, without the view: what it is, written in
 * the chart language. A formula of a note may hold several parts joined by
 * an equivalence or an implication (ln(x^2 + 1) \iff x^2 + 1): the first part
 * with a chart decides what is drawn; in 2D the other functions join it,
 * each in its own colour.
 */
export function formulaLines(texIn: string, row?: number): { kind: FormulaKind; lines: string[]; axis?: string } | null {
    // The rows of an aligned block: the one under the pointer, or all of them.
    const rows = formulaRows(texIn);
    const chosen = (row !== undefined && rows[row] !== undefined ? [rows[row]] : rows).filter((r) => r.length > 0);
    const parts = chosen
        .flatMap((r) => clean(r).split(/\\(?:iff|Leftrightarrow|Longleftrightarrow|Rightarrow|Longrightarrow|implies|impliedby|Leftarrow|Longleftarrow)(?![A-Za-z])|⟺|⇔|⇒|⟹/))
        // A list of definitions in one line: f(x) = ..., g(x) = ...
        .flatMap((part) => part.split(/[,;]\s*(?=[A-Za-z][A-Za-z0-9_]*\s*'*\s*\(\s*x(?:_\{?1\}?)?\s*\)\s*=)/))
        .map((part) => prepared(part))
        .map((p) => (p ? { tex: p.tex, axis: p.axis, vector: p.vector, axisNames: p.axisNames, found: kindOf(p.tex, p.vector) } : null))
        // n = 5 gives a value, not a curve: an equation in another variable has no chart.
        .filter(
            (x): x is { tex: string; axis: string | undefined; vector: boolean; axisNames: { x?: string; y?: string } | undefined; found: { kind: FormulaKind; body: string; name?: string } } =>
                !!x && !!x.found && !(x.axis && x.found.kind === 'equation')
        );
    if (!parts.length) return null;
    const first = parts[0].found;
    const axis = parts[0].axis;
    const kind = first.kind;
    // The axis keeps the formula's own letter; 6.2.1: x_1 and x_2 name the axes they became (as math).
    const named = parts[0].axisNames ?? {};
    const xName = axis ? `xlabel ${axis}` : named.x ? `xlabel $${named.x}$` : null;
    const yName = named.y && kind !== 'polar' ? `ylabel $${named.y}$` : null;
    const label = [xName, yName].filter((l): l is string => !!l);
    const fns = kind === 'function' ? parts.filter((p) => p.found.kind === 'function').slice(0, COLOURS.length) : [];
    const bodies = kind === 'function' ? fns.map((p) => p.found.body) : [first.body];
    const free = Array.from(new Set(bodies.flatMap((b) => freeNames(b))));
    if (free.length > MAX_SLIDERS) return null;
    const sliders = free.map((n) => `slider ${n} from -5 to 5, starting at 1`);
    const body = bodies[0];
    switch (kind) {
        case 'function': {
            // 6.0 B: each function keeps the note's name (g stays g); f, g, h for the others, never one taken.
            const taken = new Set<string>(free);
            const names = fns.map((p) => {
                const own = p.found.name;
                const name = own && !taken.has(own) ? own : ['f', 'g', 'h', 'p', 'q', 'u'].find((n) => !taken.has(n) && !fns.some((q) => q.found.name === n)) ?? 'f';
                taken.add(name);
                return name;
            });
            return { kind, axis, lines: [...label, ...sliders, ...bodies.map((b, i) => `plot $${names[i]}(x) = ${b}$ in ${COLOURS[i]}, thick`)] };
        }
        case 'surface':
            // 6.2.1: a view that shows the height (seen from 45 degrees, max(x_1, x_2) was a flat diamond), and the
            // axes named by the formula's own variables (x_1 and x_2, as math).
            return { kind, lines: ['3d', 'cube', ...SURFACE_VIEW, ...label, ...sliders, `plot $z = ${body}$ in viridis`] };
        case 'polar':
            return { kind, lines: [...sliders, `plot $r(\\theta) = ${body}$ in blue, thick`] };
        case 'region':
            return { kind, lines: [...label, ...sliders, `shade where $${body}$`] };
        default:
            return { kind, lines: [...label, ...sliders, `draw $${body}$ in blue, thick`] };
    }
}

/** A formula as a whole chart: its lines with a view fitted to what they draw, or null when it does not draw. */
export function formulaChart(tex: string, row?: number): string[] | null {
    const found = formulaLines(tex, row);
    if (!found) return null;
    const { kind, lines } = found;
    // Functions go on forever: x from -5 to 5 (the fit then takes y), a sequence (in n or k) from 0 to 20;
    // equations and regions fit both axes.
    const xs = found.axis && INDEX_VARIABLES.has(found.axis) ? ['0', '20'] : ['-5', '5'];
    const view = kind === 'surface' ? 'show x from -3 to 3, y from -3 to 3 and z from -5 to 5' : `show x from ${xs[0]} to ${xs[1]} and y from -5 to 5`;
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
        const x = fit.x ? fit.x.text : kind === 'surface' ? ['-3', '3'] : xs;
        const y = fit.y ? fit.y.text : kind === 'surface' ? ['-3', '3'] : ['-5', '5'];
        if (kind === 'surface') {
            const z = fit.z ? fit.z.text : ['-5', '5'];
            return [`show x from ${x[0]} to ${x[1]}, y from ${y[0]} to ${y[1]} and z from ${z[0]} to ${z[1]}`, ...lines];
        }
        // 6.0 B: a function's chart gives x only, so y follows what it draws (src/notes6/yfit.ts) when x changes.
        if (kind === 'function') return [`show x from ${x[0]} to ${x[1]}`, ...lines];
        return [`show x from ${x[0]} to ${x[1]} and y from ${y[0]} to ${y[1]}`, ...lines];
    } catch {
        return start;
    }
}

/** What a default chart for formulas sets: how the chart looks, never what it draws or where. showAxis: `no axes` (6.2.1). */
const DEFAULT_CHART_KEYS = [
    'axis_style', 'showAxis', 'show_axis_label', 'axis_label_x', 'axis_label_y', 'axis_label_z',
    'axis_lines', 'axis_arrows', 'axis_names', 'axis_numbers', // 6.2.1
    'showLargeGrid', 'showSmallGrid', 'gridOpacity', 'gridSize', 'majorTickNum',
    'numbers_x', 'numbers_step_x', 'numbers_at_x', 'numbers_y', 'numbers_step_y', 'numbers_at_y', 'numbers_z', 'numbers_step_z', 'numbers_at_z',
    'equalScale', 'size_x_cm', 'size_y_cm', 'boxAspect', 'boxRatio', 'rotationX', 'rotationZ', 'zoom3D', 'documentSetup', 'showSlidersInNote',
];
/** The axis names every chart starts with. */
const PLAIN_NAMES: Record<string, string> = { axis_label_x: 'x', axis_label_y: 'y', axis_label_z: 'z' };
/** The 3D view of a default chart: it counts only when the default is 3D. */
const VIEW_3D = ['boxAspect', 'boxRatio', 'rotationX', 'rotationZ', 'zoom3D'];
/** The style of a line the default's first function gives the functions and curves of a formula chart (its colour: the first only). */
const LINE_STYLE = ['color', 'thickness', 'dashed', 'extrema', 'showLegend', 'fill', 'fillOpacity', 'fillPattern'];
/** The style the default's first surface gives a surface. */
const SURFACE_STYLE = ['color', 'colormap', 'opacity', 'meshOpacity', 'wireframe', 'samples'];
/** Surface fields whose absence is a choice: no colour map is the surface's own colour, no mesh opacity the default one (6.2.1). */
const SURFACE_OPTIONAL = ['colormap', 'meshOpacity'];

type Rec = Record<string, unknown>;
const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * The default chart that gives a formula's chart its look: the 3D default
 * for a 3D chart when the person set one up (6.2.1), else the default chart
 * for formulas, as before 6.2.1 (a 3D chart then takes its axes, grid and
 * numbers, and its 3D view when that default is 3D itself).
 */
export function formulaDefaultFor(data: Rec, stored: Rec | null | undefined, stored3D?: Rec | null): Rec | null {
    if (data.dimension === true && stored3D) return stored3D;
    return stored ?? null;
}

/**
 * A formula's chart in the look of the default chart for formulas (a
 * setting the person sets up in the editor): its axes, grid, numbers, size
 * and 3D view, and the style of its first function and surface. What the
 * formula draws and the fitted view stay the formula's. A 3D chart takes
 * the 3D default when there is one (6.2.1: box, colours by height, mesh
 * lines, view, axes and grid).
 */
export function applyFormulaDefault(data: Rec, stored: Rec | null | undefined, stored3D?: Rec | null): Rec {
    const chosen = formulaDefaultFor(data, stored, stored3D);
    if (!chosen) return data;
    // 6.1: a default saved before the chart look holds every field, the defaults too: those leave the look open.
    const def = settleLook(chosen);
    const out = copy(data);
    for (const k of DEFAULT_CHART_KEYS) {
        // A 2D default holds the 3D view untouched (its stored Proportional box made surfaces thin columns):
        // only a 3D default sets the box, the turn and the zoom.
        if (!(k in def) || (def.dimension !== true && VIEW_3D.includes(k))) continue;
        // 6.2.1: in 3D, a default's plain axis name (x, y, z, as every chart starts) keeps the formula's own (x_1, x_2).
        if (data.dimension === true && def[k] === PLAIN_NAMES[k] && typeof data[k] === 'string' && data[k] !== '') continue;
        out[k] = copy(def[k]);
    }
    const first = (key: string): Rec | null => {
        const list = def[key];
        return Array.isArray(list) && list[0] && typeof list[0] === 'object' ? (list[0] as Rec) : null;
    };
    // The default's colour goes to the first line only: further functions keep their own, so they stay apart.
    let drawn = 0;
    const style = (list: unknown, from: Rec | null, keys: readonly string[], optional: readonly string[] = []) => {
        if (!from || !Array.isArray(list)) return;
        for (const item of list as Rec[]) {
            for (const k of keys) {
                if (k in from && (k !== 'color' || drawn === 0)) item[k] = copy(from[k]);
                else if (optional.includes(k)) delete item[k];
            }
            drawn++;
        }
    };
    const line = first('functions');
    style(out.functions, line, LINE_STYLE);
    drawn = 0;
    // A default surface in its own colour gives a surface its own colour too, not the formula's viridis (6.2.1).
    style(out.functions3D, first('functions3D'), SURFACE_STYLE, SURFACE_OPTIONAL);
    // A curve (an equation) takes the line's thickness and dashes, and its colour when it is the first line.
    drawn = Array.isArray(out.functions) ? out.functions.length : 0;
    if (line && Array.isArray(out.tools)) style(out.tools.filter((t: Rec) => t.type === 'curve'), line, ['color', 'thickness', 'dashed']);
    return out;
}

/** The chart block body of a formula in the default look (def3D: the 3D default, 6.2.1), as the plugin writes it; null when it does not draw. */
export function formulaBlock(tex: string, def: Rec | null | undefined, def3D?: Rec | null): string | null {
    const lines = formulaChart(tex);
    if (!lines) return null;
    const parsed = parseChartText(lines.join('\n'));
    if (parsed.problems.length) return null;
    return printChartText(applyFormulaDefault(parsed.data, def, def3D));
}

const chartableMemo = new Map<string, boolean>();

/**
 * Does an equation draw a curve? Not when its sides agree everywhere (an
 * identity: ln(xy) = ln x + ln y, e^x e^{-x} = 1; its curve is rounding
 * noise) or nowhere (x^2 + y^2 = 0: no sign change in the view).
 */
function curveShows(math: ReturnType<SettingsManager['createMathContext']>, equation: string, view: { xmin: number; xmax: number; ymin: number; ymax: number }): boolean {
    const sides = equation.split('=');
    if (sides.length !== 2) return true;
    let left: (x: number, y: number) => number;
    let right: (x: number, y: number) => number;
    try {
        left = math.equation(sides[0]).F;
        right = math.equation(sides[1]).F;
    } catch {
        return true;
    }
    const n = 24;
    let finite = 0;
    let same = 0;
    let below = false;
    let above = false;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            // Off the round numbers, where ln 0 or 1/0 sit.
            const x = view.xmin + ((view.xmax - view.xmin) * (i + 0.37)) / n;
            const y = view.ymin + ((view.ymax - view.ymin) * (j + 0.61)) / n;
            const a = left(x, y);
            const b = right(x, y);
            if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
            finite++;
            if (Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) same++;
            else if (a < b) below = true;
            else above = true;
        }
    }
    if (!finite || same >= finite * 0.9) return false;
    return (below && above) || same > 0;
}

/** Do these chart lines draw without an error: every formula known, nothing in the scene a problem? */
function drawable(lines: string[]): boolean {
    const parsed = parseChartText(lines.join('\n'));
    if (parsed.problems.length) return false;
    const settings = SettingsManager.fromJSON(parsed.data);
    const math = settings.createMathContext({ memo: false });
    const params = settings.getValue('parameters');
    math.setParams(Array.isArray(params) ? (params as Parameter[]) : []);
    if (math.functions().some((info) => !!info.error)) return false;
    if (math.parameterIssues().some((i) => i.severity === 'error')) return false;
    if (settings.getValue('dimension') === true) return true;
    const config = settings.toRendererConfig(math);
    const view = { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax };
    for (const tool of config.tools ?? []) if (tool.type === 'curve' && !curveShows(math, tool.equation, view)) return false;
    const scene = computeScene2D({
        functions: config.functions || [],
        tools: config.tools,
        math,
        view,
        grid: marchingGrid(config.width * 0.85, config.height * 0.8, 1, 'draft'),
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(config.paperWidthCm ?? 10, config.paperHeightCm ?? 10),
    });
    return !scene.issues.some((i) => i.severity === 'error');
}

/**
 * Does a formula of a note have a chart (5.0)? Its chart draws without an
 * error: it uses a variable (x, y, x_1, x_2, z, r, theta), and it is no
 * matrix, sum or set. With `row`, that row of an aligned block. The card
 * opens only for these, and the setting Highlight formulas in notes marks
 * them, so a marked formula always opens.
 */
export function chartable(tex: string, row?: number): boolean {
    const key = row === undefined ? tex : `${row}\u0000${tex}`;
    const hit = chartableMemo.get(key);
    if (hit !== undefined) return hit;
    let ok = false;
    try {
        const lines = formulaChart(tex, row);
        ok = !!lines && drawable(lines);
    } catch {
        ok = false;
    }
    if (chartableMemo.size > 500) chartableMemo.clear();
    chartableMemo.set(key, ok);
    return ok;
}
