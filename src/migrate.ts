/*
 * Settings migration, defaults, recipes and starter examples.
 *
 * Every `easy-tikz` JSON block goes through `migrateSettings` exactly once,
 * at the SettingsManager.fromJSON boundary. Renderers, the exporter and the
 * modal only ever see migrated (v4) data.
 *
 * CONTRACT FILE. Exported names, signatures and documented semantics are
 * fixed; other modules are implemented against them in parallel.
 * Implementations may add private helpers and extra exports.
 */
import { THICKNESS_MAP } from './colors';
import { isColormap } from './colormaps';
import { GRID_OPACITY } from './opacity';
import { dollarMath, splitDomain } from './expr';
import { t } from './i18n';
// 6.0 C
import { MOTION_PREFIX, completeMotionTool, keptStep, restPointsDefaults, trajectoryDefaults, vectorFieldDefaults } from './motion6/tools';
// 6.0 B
import { axisSetDefaults, chordDefaults, completeAxisSet, completeChord } from './notes6/tools';
// 6.0 E
import { ITERATE_PREFIX, completeIterateTool, iterateDefaults } from './iterate/tools';
import { iterateRecipes } from './iterate/recipes';
// 6.0 G
import { GEOGEBRA_PREFIX, completeGeoGebraTool, geogebraDefaults } from './geogebra/tools';
import { geogebraRecipes } from './geogebra/recipes';
// 6.0 P
import { PYTHON_PREFIX, completePythonTool, pythonDefaults } from './python/tools';
import { pythonRecipes } from './python/recipes';
import { headName } from './ml/heads'; // 6.0 ML
import { notes6Recipes } from './notes6/recipes';
// 6.0 D
import { LINEAR_PREFIX, basisVectorsDefaults, completeLinearTool, eigenvectorsDefaults, planeGridDefaults, spanDefaults, transformDefaults, unitSquareDefaults } from './linear/tools';
import { linearRecipes } from './linear/recipes';
import {
    Annotation,
    AnnotationAnchor,
    AnnotationSize,
    ArrowStyle,
    CurveTool,
    DataPlotTool,
    DataTool,
    DistributionTool,
    FillPattern,
    Function3DParameters,
    FunctionParameters,
    MarkerSize,
    OutlineStyle,
    Parameter,
    PlaneTool,
    PointsTool,
    ProbabilityTool,
    RegionTool,
    RiemannTool,
    SlopeFieldTool,
    SolutionTool,
    RestPointsTool,
    TrajectoryTool,
    VectorFieldTool,
    SegmentStyle,
    SegmentTool,
    Tool,
    ToolType,
    // 6.0 A
    ListPointsTool,
    ValueTool,
    VectorTool,
} from './types';

export const SCHEMA_VERSION = 4;

/**
 * Names that can never be parameters / functions / tools: axis variables
 * (x y z t theta), constants (pi PI e E true false and the Math constants),
 * every builtin function name, 'Math', and 'and' / 'or'.
 */
export const RESERVED_NAMES: ReadonlySet<string> = new Set<string>([
    // axis and curve variables
    'x', 'y', 'z', 't', 'theta', 'θ',
    // constants
    'pi', 'PI', 'π', 'e', 'E', 'true', 'false',
    'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT2', 'SQRT1_2',
    // builtins (3.19.6 bare names and Math members, plus the v4 additions)
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
    'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
    'exp', 'log', 'log2', 'log10', 'log1p', 'expm1', 'ln',
    'sqrt', 'cbrt', 'pow', 'abs', 'sign', 'floor', 'ceil', 'round', 'trunc',
    'min', 'max', 'hypot', 'fround', 'random',
    'sec', 'csc', 'cot',
    // keywords
    'Math', 'and', 'or',
]);

// ---------------------------------------------------------------------------
// Small coercion helpers. Blocks are hand-editable JSON, so every field is
// checked; anything unusable falls back to the default.
// ---------------------------------------------------------------------------

/** Referenceable name: letter first, then letters, digits, underscores. */
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Plain unsigned number: substituted as is, everything else gets parentheses. */
const PLAIN_NUMBER_RE = /^\d+(\.\d+)?$/;
/** Signed numeric literal (decides whether legacy rectangle bounds can be sorted). */
const NUMERIC_LITERAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Tool ids end up in UI keys and caches; keep them boring. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const FILL_PATTERNS: readonly FillPattern[] = [
    'solid', 'horizontal', 'vertical', 'crosshatch', 'dots', 'north-east', 'north-west',
];
const OUTLINE_STYLES: readonly OutlineStyle[] = ['none', 'solid', 'dashed'];
const SEGMENT_STYLES: readonly SegmentStyle[] = ['line', 'forward', 'backward', 'both', 'brace'];
const MARKER_SIZES: readonly MarkerSize[] = ['small', 'normal', 'large'];
const ANNOTATION_SIZES: readonly AnnotationSize[] = ['small', 'normal', 'large'];
const ANNOTATION_ANCHORS: readonly AnnotationAnchor[] = ['center', 'above', 'below', 'left', 'right'];
const POINT_SOURCES: readonly PointsTool['source'][] = ['list', 'intersections', 'region', 'lattice'];
const RANGE_KEYS = ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'];
/** Plain-text (not template) label settings that 3.x exported as raw TeX. */
const LEGACY_TEXT_KEYS = ['axis_label_x', 'axis_label_y', 'axis_label_z', 'axis_label_x_polar', 'axis_label_y_polar'];

/** New regions take the first of these not used by another region. */
const REGION_COLORS = ['blue', 'orange', 'green', 'purple', 'red', 'teal', 'magenta', 'brown', 'gray'];
/** New functions (recipes) take the first of these not used by another function. */
const FUNCTION_COLORS = ['black', 'blue', 'red', 'green', 'purple', 'orange', 'teal', 'brown', 'magenta', 'gray'];

const TOOL_PREFIX: Record<ToolType, string> = {
    region: 'R',
    curve: 'C',
    points: 'P',
    segment: 'S',
    plane3D: 'PL',
    data: 'D',
    dataPlot: 'DP',
    distribution: 'X',
    probability: 'PR',
    riemann: 'RS',
    slopeField: 'SF',
    solution: 'Y',
    // 6.0 C
    ...MOTION_PREFIX,
    // 6.0 B
    axisSet: 'AX',
    chord: 'CH',
    // 6.0 A: values
    value: 'L',
    vector: 'V',
    listPoints: 'LP',
    // 6.0 D
    ...LINEAR_PREFIX,
    // 6.0 E
    ...ITERATE_PREFIX,
    // 6.0 G
    ...GEOGEBRA_PREFIX,
    // 6.0 P
    ...PYTHON_PREFIX,
};

const PARAMETER_LETTERS = ['a', 'b', 'c', 'd', 'k', 'm', 'n', 'p', 'q', 'r', 's', 'u', 'v', 'w'];

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback: string): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return fallback;
}

function num(v: unknown, fallback: number): number {
    if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
    return typeof v === 'boolean' ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}

function opacityOf(v: unknown, fallback: number): number {
    return clamp(num(v, fallback), 0, 1);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
    return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function colorOf(v: unknown, fallback: string): string {
    return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function thicknessOf(v: unknown, fallback: string): string {
    return typeof v === 'string' && Object.prototype.hasOwnProperty.call(THICKNESS_MAP, v) ? v : fallback;
}

/** Array of strings (numbers coerced, other items blanked so indices stay aligned); a lone string becomes one entry. */
function stringList(v: unknown, fallback: string[]): string[] {
    if (Array.isArray(v)) return v.map((item) => str(item, ''));
    if (typeof v === 'string') return [v];
    return fallback.slice();
}

function isValidName(name: string): boolean {
    return NAME_RE.test(name) && !RESERVED_NAMES.has(name);
}

/** Wrap a substituted source in parentheses unless it is a plain unsigned number. */
function wrap(src: string): string {
    const s = src.trim();
    return PLAIN_NUMBER_RE.test(s) ? s : `(${s})`;
}

/** A legacy coordinate field: trimmed text, or the 3.x parse fallback when blank. */
function legacyCoord(v: unknown, fallback: string): string {
    const s = str(v, '').trim();
    return s === '' ? fallback : s;
}

/** Index just past the `\(...\)` math opened at `at` (the first `\)` pair closes it), or -1 when it never closes. */
function parenMathEnd(text: string, at: number): number {
    for (let i = at + 2; i < text.length; i++) {
        if (text[i] !== '\\') continue;
        if (text[i + 1] === ')') return i + 2;
        i++;
    }
    return -1;
}

/**
 * Escape legacy free text so it reads the same as a v4 label template
 * (`{expr}` interpolates). Mirrors the template scanner (scanTemplate in
 * src/expr.ts): outside math, `{` and `}` are doubled (`{{` is a literal
 * brace); backslash pairs such as `\{` and everything inside math
 * (`$...$` as dollarMath pairs it, `\(...\)`) are copied as is, because
 * the scanner keeps LaTeX groups like `x_{1}` or `\frac{a}{b}` verbatim
 * there. Inside math a brace right after a placeholder or after a
 * no-argument command (`\cdot`, `\approx`, Greek letters) is a
 * placeholder again; legacyTexToText turns such groups into `\mathord{..}`
 * so none of them reaches the scanner as one.
 */
export function escapeTemplate(text: string): string {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '{' || ch === '}') {
            out += ch + ch;
            i++;
            continue;
        }
        let end = i + 1;
        // An unclosed `\(` is math to the end, as the scanner reads it.
        if (ch === '\\') end = text[i + 1] === '(' ? parenMathEnd(text, i) : Math.min(i + 2, text.length);
        if (end < 0) end = text.length;
        else if (ch === '$') end = dollarMath(text, i)?.end ?? i + 1;
        out += text.slice(i, end);
        i = end;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Legacy label text. 3.19.6 pasted titles, axis labels, legend entries,
// annotation texts and tool labels into the TikZ code as raw TeX, so 3.x
// blocks hold `50\%`, `R\&D`, `Erl\"ose` or `\textbf{EUR}`. legacyTexToText
// rewrites that into text the v4 export typesets the same way: plain
// characters (which the export escapes), Unicode letters, and `\(...\)`
// math for everything that has to stay LaTeX. Math typesets the same
// whether the export escapes all text outside math or reads backslash
// commands there as LaTeX, and `\(...\)` (unlike `$...$`) never depends on
// the characters around it.
// ---------------------------------------------------------------------------

/** Control symbols that only add space (`\,`) or nothing visible (`\-`). */
const TEX_SPACING: Record<string, string> = {
    ' ': ' ', ',': ' ', ';': ' ', ':': ' ', '>': ' ',
    '!': '', '-': '', '/': '', '@': '',
};

/**
 * Accent macros -> Unicode combining marks, composed with NFC. An empty
 * mark keeps the TeX (in an \mbox): pdflatex's default OT1 setup reads no
 * UTF-8 letter with an ogonek or a dot / bar below.
 */
const TEX_ACCENTS: Record<string, string> = {
    '"': '\u0308', "'": '\u0301', '`': '\u0300', '^': '\u0302', '~': '\u0303', '=': '\u0304', '.': '\u0307',
    c: '\u0327', v: '\u030C', u: '\u0306', H: '\u030B', r: '\u030A', k: '', d: '', b: '',
};

/** Text symbol macros whose character pdflatex reads back from UTF-8 input. */
const TEX_SYMBOLS: Record<string, string> = {
    ss: '\u00DF', ae: '\u00E6', AE: '\u00C6', oe: '\u0153', OE: '\u0152', o: '\u00F8', O: '\u00D8',
    aa: '\u00E5', AA: '\u00C5', l: '\u0142', L: '\u0141', i: '\u0131',
    S: '\u00A7', P: '\u00B6', pounds: '\u00A3', copyright: '\u00A9', textcopyright: '\u00A9',
    textasciitilde: '~', textasciicircum: '^', textunderscore: '_', textbar: '|', textless: '<', textgreater: '>',
    textendash: '--', textemdash: '---', ldots: '...', dots: '...', textellipsis: '...',
    // Line breaks: a node without `align` sets one line anyway.
    newline: ' ', linebreak: ' ', par: ' ',
};

/** Text-mode characters that only exist as LaTeX here: kept as math, which prints them in any setup. */
const TEX_MATH_SYMBOLS: Record<string, string> = {
    '{': '\\{', '}': '\\}', '$': '\\$', textbackslash: '\\backslash', textbraceleft: '\\{', textbraceright: '\\}', textdollar: '\\$',
};

/**
 * Font declarations (`{\bf ...}`, `\itshape ...`) as the text command that
 * both MathJax and math-mode TeX understand. `\em` becomes `\textit` (and
 * so does `\emph`), because `\emph` stops pdflatex in math mode.
 */
const TEX_FONT_DECLARATIONS: Record<string, string> = {
    bf: 'textbf', bfseries: 'textbf',
    it: 'textit', itshape: 'textit', em: 'textit', sl: 'textit', slshape: 'textit',
    tt: 'texttt', ttfamily: 'texttt', rm: 'textrm', rmfamily: 'textrm', sf: 'textsf', sffamily: 'textsf',
};

/** Declarations without a visible effect in a v4 label (sizes come from the item): dropped. */
const TEX_DROPPED_COMMANDS = new Set([
    'tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge',
    'noindent', 'centering', 'raggedright', 'raggedleft', 'hfill', 'relax', 'null', 'strut', 'protect', 'selectfont',
]);

/** Commands that stop pdflatex in math mode: kept in an \mbox. */
const TEX_TEXT_MODE_COMMANDS = new Set(['LaTeX', 'LaTeXe', 'TeX']);

function hasKey(map: Record<string, string>, key: string): boolean {
    return Object.getOwnPropertyDescriptor(map, key) !== undefined;
}

/** Index of the bracket closing the `{` or `[` at `open`, or -1. Backslash pairs never count. */
function closingBracket(text: string, open: number): number {
    const openCh = text[open];
    const closeCh = openCh === '[' ? ']' : '}';
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\\') {
            i++;
        } else if (ch === openCh) {
            depth++;
        } else if (ch === closeCh && --depth === 0) {
            return i;
        }
    }
    return -1;
}

/** Index after the argument of a `_` / `^` script starting at `from`: a group, a command or one character. */
function scriptEnd(text: string, from: number): number {
    const ch = text[from];
    if (ch === '{') return closingBracket(text, from) + 1 || from;
    if (ch === '\\') {
        const command = /^\\(?:[A-Za-z]+|[^A-Za-z\s])/.exec(text.slice(from));
        return command ? from + command[0].length : from;
    }
    return ch !== undefined && !/[\s{}$~%&#^_]/.test(ch) ? from + 1 : from;
}

/** Raw TeX for inside `\(...\)`: an inner `\(...\)` becomes `$...$`, so the first `\)` closes the outer math. */
function mathSafe(raw: string): string {
    return raw.replace(/\\[()]|\\[\s\S]/g, (m) => (m === '\\(' || m === '\\)' ? '$' : m));
}

/**
 * Math as v4 templates read it. A TeX group in math is an Ord atom, but
 * the template scanner keeps a brace group verbatim only after `^`, `_`,
 * `}`, `]` or a command (anything else interpolates: `{c}`), so the other
 * groups become `\mathord{...}`, which typesets the same: `1{,}5` ->
 * `1\mathord{,}5`. Spaces before a kept group go (TeX skips them).
 */
function templateMath(inner: string): string {
    let out = '';
    let group = false;
    let i = 0;
    while (i < inner.length) {
        const ch = inner[i];
        if (ch === '\\') {
            const command = /^\\(?:[A-Za-z]+|[\s\S]?)/.exec(inner.slice(i)) as RegExpExecArray;
            out += command[0];
            i += command[0].length;
            group = /[A-Za-z]$/.test(command[0]);
        } else if (ch === '{') {
            const close = closingBracket(inner, i);
            const end = close < 0 ? inner.length : close + 1;
            out += (group ? '' : '\\mathord') + inner.slice(i, end);
            i = end;
            group = true;
        } else if (/\s/.test(ch) && group && /^\s*\{/.test(inner.slice(i))) {
            i++;
        } else {
            out += ch;
            i++;
            group = ch === '^' || ch === '_' || ch === ']';
        }
    }
    return out;
}

/**
 * Turn 3.x label text (raw TeX) into v4 label text that exports to what
 * 3.19.6 typeset. Math (`$...$` as dollarMath pairs it, `$$...$$`,
 * `\(...\)`) is kept. Outside math:
 * - `\% \& \# \_` become the bare character; `\{ \} \$` and
 *   `\textbackslash` become math (`\(\{\)`).
 * - `~`, `\\`, `\ ` and `\,` become a space; bare braces (grouping) go.
 * - Accents (`\"o`, `\'{e}`, `\c{c}`) and `\ss`, `\o`, `\ldots`, ... become
 *   Unicode characters.
 * - Every other command, with its `[...]` / `{...}` arguments, becomes math
 *   (`\textbf{EUR}` -> `\(\textbf{EUR}\)`; `\emph` -> `\textit`), and so do
 *   `_` / `^` scripts (`x_{0}` -> `x\(_{0}\)`), which the 3.x preview drew
 *   as scripts. Adjacent math joins into one `\(...\)`.
 * - A font declaration (or `\color`) applies its text command to the rest
 *   of the group: `{\bf Profit} in EUR` -> `\(\textbf{Profit}\) in EUR`;
 *   size switches go.
 * `template`: the text is a v4 label template (title, annotations, tool
 * labels): see templateMath. It still needs escapeTemplate afterwards.
 */
export function legacyTexToText(text: string, template = false): string {
    if (!/[\\$~{}_^]/.test(text)) return text;
    let out = '';
    /** out.length right after a `\(...\)` the next math may extend, else -1. */
    let mathEnd = -1;

    const emitText = (s: string) => {
        if (!s) return;
        out += s;
        mathEnd = -1;
    };
    const emitMath = (content: string) => {
        if (!content.trim()) return;
        out = mathEnd === out.length ? `${out.slice(0, -2)} ${content}\\)` : `${out}\\(${content}\\)`;
        mathEnd = out.length;
    };
    /** Math copied from the 3.x text: delimiters kept, groups made explicit for templates. */
    const emitLegacyMath = (open: string, inner: string, close: string) => {
        emitText(open + (template ? templateMath(inner) : inner) + close);
    };

    /** The accent macro at `at` (its backslash); returns the index after its argument. */
    const accent = (s: string, at: number): number => {
        const name = s[at + 1];
        const letterName = /[A-Za-z]/.test(name);
        let i = at + 2;
        let base = '';
        if (s[i] === '{') {
            const close = closingBracket(s, i);
            if (close < 0) return i;
            base = s.slice(i + 1, close).trim();
            i = close + 1;
        } else {
            // `\"o`; a letter accent needs a space first (`\c c`).
            if (letterName) while (s[i] === ' ') i++;
            const dotless = /^\\[ij](?![A-Za-z])/.exec(s.slice(i));
            if (dotless) base = dotless[0];
            else if (/[A-Za-z]/.test(s[i] ?? '')) base = s[i];
            i += base.length;
        }
        if (!base) {
            // `\^{}` and `\~{}` are the usual way to write a bare caret or tilde.
            if (!letterName) emitText(name);
            return i;
        }
        const plain = base === '\\i' || base === '\\j' ? base[1] : base;
        const composed = TEX_ACCENTS[name] ? (plain + TEX_ACCENTS[name]).normalize('NFC') : '';
        // No single precomposed character: pdflatex cannot read a lone combining mark, so keep the TeX.
        if (composed && Array.from(composed).length === 1) emitText(composed);
        else emitMath(`\\mbox{${s.slice(at, i)}}`);
        return i;
    };

    /**
     * The `[...]` / `{...}` arguments after `from`. Only the first `{` may
     * follow after spaces (`\textbf {x}`, TeX skips them); later groups
     * must be adjacent, since `\textit{a} {b}` is an argument and a group.
     */
    const commandArguments = (s: string, from: number): { text: string; end: number } => {
        let args = '';
        let i = from;
        for (;;) {
            let j = i;
            if (!args) while (s[j] === ' ') j++;
            // An optional argument must follow directly: `\alpha [0, 1]` is text.
            if (s[j] !== '{' && !(s[j] === '[' && j === i)) break;
            const close = closingBracket(s, j);
            if (close < 0) break;
            args += s.slice(j, close + 1);
            i = close + 1;
        }
        // `\LaTeX{}`: an empty group only ends the command name.
        return { text: args === '{}' ? '' : args, end: i };
    };

    /** The control word at `at`; returns the index after it (and its arguments). */
    const command = (s: string, at: number): number => {
        const name = (/^[A-Za-z]+/.exec(s.slice(at + 1)) as RegExpExecArray)[0];
        const after = at + 1 + name.length;
        if (name.length === 1 && hasKey(TEX_ACCENTS, name) && (s[after] === '{' || s[after] === ' ')) {
            return accent(s, at);
        }
        if (hasKey(TEX_SYMBOLS, name) || hasKey(TEX_MATH_SYMBOLS, name) || TEX_DROPPED_COMMANDS.has(name)) {
            if (hasKey(TEX_SYMBOLS, name)) emitText(TEX_SYMBOLS[name]);
            else if (hasKey(TEX_MATH_SYMBOLS, name)) emitMath(TEX_MATH_SYMBOLS[name]);
            // TeX skips the spaces after a control word (`Stra\ss e`); `{}` ends it instead.
            let i = after;
            if (s.startsWith('{}', i)) i += 2;
            else while (s[i] === ' ') i++;
            return i;
        }
        const color = name === 'color' && s[after] === '{' ? closingBracket(s, after) : -1;
        if (hasKey(TEX_FONT_DECLARATIONS, name) || color >= 0) {
            // A declaration holds to the end of the current group.
            const head = color >= 0 ? `\\textcolor${s.slice(after, color + 1)}` : `\\${TEX_FONT_DECLARATIONS[name]}`;
            const rest = s.slice(color >= 0 ? color + 1 : after).trim();
            if (rest) emitMath(`${head}{${mathSafe(rest)}}`);
            return s.length;
        }
        const args = commandArguments(s, after);
        const run = `\\${name === 'emph' ? 'textit' : name}${args.text}`;
        emitMath(mathSafe(TEX_TEXT_MODE_COMMANDS.has(name) ? `\\mbox{${run}}` : run));
        return args.end;
    };

    /** A backslash sequence at `at`; returns the index after it. */
    const control = (s: string, at: number): number => {
        const next = s[at + 1];
        if (next === undefined) return at + 1;
        if (/[A-Za-z]/.test(next)) return command(s, at);
        if (next === '(') {
            const end = parenMathEnd(s, at);
            // An unclosed `\(` (3.x could not typeset it either) is a parenthesis.
            if (end < 0) emitText('(');
            else emitLegacyMath('\\(', s.slice(at + 2, end - 2), '\\)');
            return end < 0 ? at + 2 : end;
        }
        if (next === '\\') {
            // A line break (`\\`, `\\*`, `\\[2pt]`): a node without `align` sets one line anyway.
            let i = at + 2;
            if (s[i] === '*') i++;
            if (s[i] === '[') i = closingBracket(s, i) + 1 || i;
            emitText(' ');
            return i;
        }
        if (hasKey(TEX_ACCENTS, next)) return accent(s, at);
        if (hasKey(TEX_MATH_SYMBOLS, next)) emitMath(TEX_MATH_SYMBOLS[next]);
        else if (hasKey(TEX_SPACING, next)) emitText(TEX_SPACING[next]);
        // `\%`, `\&`, ... and any other control symbol (`\[`, `\|`) print their character.
        else emitText(next);
        return at + 2;
    };

    const walk = (s: string): void => {
        let i = 0;
        while (i < s.length) {
            const ch = s[i];
            if (ch === '\\') {
                i = control(s, i);
            } else if (ch === '$') {
                const m = dollarMath(s, i);
                const open = s[i + 1] === '$' ? '$$' : '$';
                // A dollar sign that opens no math stays text (the export escapes it).
                if (m) emitLegacyMath(open, s.slice(i + open.length, m.close), s.slice(m.close, m.end));
                else emitText('$');
                i = m ? m.end : i + 1;
            } else if (ch === '{') {
                // TeX grouping prints nothing; a declaration inside holds for the group only.
                const close = closingBracket(s, i);
                if (close >= 0) walk(s.slice(i + 1, close));
                i = close >= 0 ? close + 1 : i + 1;
            } else if (ch === '}') {
                i++;
            } else if (ch === '~') {
                emitText(' ');
                i++;
            } else if (ch === '_' || ch === '^') {
                const end = scriptEnd(s, i + 1);
                if (end > i + 1) emitMath(ch + mathSafe(s.slice(i + 1, end)));
                else emitText(ch);
                i = Math.max(end, i + 1);
            } else {
                emitText(ch);
                i++;
            }
        }
    };

    walk(text);
    return out;
}

/** A 3.x free-text label as a v4 label template. */
function legacyLabel(v: unknown): string {
    return escapeTemplate(legacyTexToText(str(v, ''), true));
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function functionDefaults(): FunctionParameters {
    return {
        expression: '',
        domain: '',
        showLegend: false,
        fill: false,
        fillOpacity: 0.2,
        fillPattern: 'solid',
        tangent: false,
        color: 'black',
        dashed: false,
        tangentPoint: '',
        extrema: false,
        thickness: '', // 6.1: left open, the chart look decides (Classic: thin)
        parametric: false,
        expressionY: '',
    };
}

/** A tool without its identity fields; normalizeTools / defaultTool add id and name. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type ToolBody = DistributiveOmit<Tool, 'id' | 'name' | 'hidden'>;
type RegionBody = Omit<RegionTool, 'id' | 'name' | 'hidden'>;
type CurveBody = Omit<CurveTool, 'id' | 'name' | 'hidden'>;
type PointsBody = Omit<PointsTool, 'id' | 'name' | 'hidden'>;
type SegmentBody = Omit<SegmentTool, 'id' | 'name' | 'hidden'>;
type PlaneBody = Omit<PlaneTool, 'id' | 'name' | 'hidden'>;
type DataBody = Omit<DataTool, 'id' | 'name' | 'hidden'>;
type DataPlotBody = Omit<DataPlotTool, 'id' | 'name' | 'hidden'>;
type DistributionBody = Omit<DistributionTool, 'id' | 'name' | 'hidden'>;
type ProbabilityBody = Omit<ProbabilityTool, 'id' | 'name' | 'hidden'>;
type RiemannBody = Omit<RiemannTool, 'id' | 'name' | 'hidden'>;
type SlopeFieldBody = Omit<SlopeFieldTool, 'id' | 'name' | 'hidden'>;
type SolutionBody = Omit<SolutionTool, 'id' | 'name' | 'hidden'>;
// 6.0 A
type ValueBody = Omit<ValueTool, 'id' | 'name' | 'hidden'>;
type VectorBody = Omit<VectorTool, 'id' | 'name' | 'hidden'>;
type ListPointsBody = Omit<ListPointsTool, 'id' | 'name' | 'hidden'>;

function regionDefaults(): RegionBody {
    return {
        type: 'region',
        color: 'blue',
        conditions: [''],
        conditionLabels: [''],
        fill: true,
        fillOpacity: 0.25,
        fillPattern: 'solid',
        outline: 'none',
        thickness: 'thin',
        constraintLines: false,
        label: '',
    };
}

function curveDefaults(): CurveBody {
    return { type: 'curve', color: 'black', equation: '', levels: '', thickness: 'thin', dashed: false, label: '' };
}

function pointsDefaults(dim: 2 | 3): PointsBody {
    return {
        type: 'points',
        color: 'red',
        dim,
        source: 'list',
        points: '',
        ref1: '',
        ref2: '',
        regionName: '',
        objective: '',
        sense: 'max',
        label: '',
        dropLines: false,
        size: 'normal',
    };
}

function segmentDefaults(dim: 2 | 3): SegmentBody {
    return {
        type: 'segment',
        color: 'black',
        dim,
        path: '',
        closed: false,
        style: 'line',
        thickness: 'thin',
        dashed: false,
        label: '',
    };
}

function planeDefaults(): PlaneBody {
    return { type: 'plane3D', color: 'orange', axis: 'z', value: '0', fillOpacity: 0.25 };
}

function dataDefaults(): DataBody {
    return { type: 'data', color: 'black', source: 'table', points: '', xColumn: '', yColumn: '' };
}

function dataPlotDefaults(): DataPlotBody {
    return {
        type: 'dataPlot',
        color: 'blue',
        data: '',
        style: 'points',
        size: 'normal',
        thickness: 'thin',
        dashed: false,
        fillOpacity: 0.35,
        label: '',
        valueLabel: false,
    };
}

function distributionDefaults(): DistributionBody {
    return { type: 'distribution', color: 'blue', kind: 'normal', mean: '0', sd: '1', n: '10', p: '0.5', thickness: 'thin', dashed: false, fillOpacity: 0.35 };
}

function riemannDefaults(): RiemannBody {
    return { type: 'riemann', color: 'orange', function: '', method: 'left', from: '0', to: '1', parts: '6', thickness: 'thin', fillOpacity: 0.35, label: '', valueLabel: false };
}

function slopeFieldDefaults(): SlopeFieldBody {
    return { type: 'slopeField', color: 'gray', expression: '', density: 20, thickness: 'thin' };
}

function solutionDefaults(): SolutionBody {
    return { type: 'solution', color: 'red', field: '', through: '', thickness: 'thick', dashed: false };
}

// 6.0 A: values (src/values/).
function valueDefaults(): ValueBody {
    return { type: 'value', color: 'black', params: '', expression: '' };
}

function vectorDefaults(): VectorBody {
    return { type: 'vector', color: 'blue', vectors: '', from: '', tipToTail: false, thickness: 'thick', dashed: false, label: '', valueLabel: false };
}

function listPointsDefaults(): ListPointsBody {
    return { type: 'listPoints', color: 'red', points: '', joined: false, size: 'normal', thickness: 'thin', label: '', valueLabel: false };
}

function completeValue(src: Record<string, unknown>): ValueBody {
    const d = valueDefaults();
    return { type: 'value', color: colorOf(src.color, d.color), params: str(src.params, d.params), expression: str(src.expression, d.expression) };
}

function completeVector(src: Record<string, unknown>): VectorBody {
    const d = vectorDefaults();
    return {
        type: 'vector',
        color: colorOf(src.color, d.color),
        vectors: str(src.vectors, d.vectors),
        from: str(src.from, d.from),
        tipToTail: bool(src.tipToTail, d.tipToTail),
        thickness: thicknessOf(src.thickness, d.thickness),
        dashed: bool(src.dashed, d.dashed),
        label: str(src.label, d.label),
        valueLabel: bool(src.valueLabel, d.valueLabel),
    };
}

function completeListPoints(src: Record<string, unknown>): ListPointsBody {
    const d = listPointsDefaults();
    return {
        type: 'listPoints',
        color: colorOf(src.color, d.color),
        points: str(src.points, d.points),
        joined: bool(src.joined, d.joined),
        size: oneOf(src.size, MARKER_SIZES, d.size),
        thickness: thicknessOf(src.thickness, d.thickness),
        label: str(src.label, d.label),
        valueLabel: bool(src.valueLabel, d.valueLabel),
    };
}

function probabilityDefaults(): ProbabilityBody {
    return { type: 'probability', color: 'orange', distribution: '', event: '', fillOpacity: 0.5, fillPattern: 'solid', label: '', valueLabel: false };
}

// ---------------------------------------------------------------------------
// migrateSettings
// ---------------------------------------------------------------------------

/**
 * Migrate a raw block (any version) to the v4 shape. Idempotent. Never
 * throws; garbage entries are dropped. Steps:
 * 1. normalizeFunctions (materialize + sanitize names; renames map).
 *    Blocks without `v`: functions with an expression but an empty domain
 *    get `hidden: true` (3.x skipped them, so the old picture is preserved).
 * 2. normalizeParameters.
 * 3. normalizeTools with the renames (legacy shapes -> v4, deterministic ids
 *    't0', 't1', ... for migrated tools, names assigned per kind in list
 *    order: R1.., C1.., P1.., S1.., PL1..).
 * 4. Annotations: keep valid entries, coerce x/y/z to strings.
 * 5. documentSetup: standalone = documentSetup !== false; drop documentClose.
 * 6. Defaults for new keys: parameters [], variables 'x, y', equalScale
 *    false, showSlidersInNote true; set v = 4.
 *
 * Also: numeric axis ranges become strings (invalid ones, and blank ones in
 * blocks without `v`, are removed so the SettingsManager defaults apply, as
 * 3.x fell back to them), and surfaces get their missing fields. In blocks
 * without `v` the free text (title, axis labels, legend entries, annotation
 * texts, tool labels) was raw TeX: legacyTexToText turns it into v4 label
 * text, and the template fields among it get their braces escaped.
 */
export function migrateSettings(data: Record<string, unknown>): Record<string, unknown> {
    const src: Record<string, unknown> = isRecord(data) ? data : {};
    const legacy = !(num(src.v, 0) >= SCHEMA_VERSION);
    const out: Record<string, unknown> = { ...src };

    const { functions, renames } = normalizeFunctions(src.functions);
    if (legacy) {
        for (const fn of functions) {
            if (fn.expression.trim() && !fn.domain.trim()) fn.hidden = true;
            if (fn.legendLabel !== undefined) fn.legendLabel = legacyTexToText(fn.legendLabel);
        }
    }
    out.functions = functions;

    const parameters = normalizeParameters(src.parameters);
    out.parameters = parameters;

    out.tools = normalizeTools(src.tools, {
        renames,
        functions,
        takenNames: parameters.map((p) => p.name),
        is3D: src.dimension === true,
    });
    out.annotations = normalizeAnnotations(src.annotations, legacy);
    out.functions3D = normalizeSurfaces(src.functions3D);

    out.documentSetup = src.documentSetup !== false;
    delete out.documentClose;

    for (const key of RANGE_KEYS) {
        const v = src[key];
        if (typeof v === 'number' && Number.isFinite(v)) out[key] = String(v);
        // 3.x saved a cleared range field as '' and drew (and exported) its default.
        else if (typeof v !== 'string' || (legacy && !v.trim())) delete out[key];
    }
    if (legacy) {
        if (typeof src.title === 'string') out.title = legacyLabel(src.title);
        for (const key of LEGACY_TEXT_KEYS) {
            const v = src[key];
            if (typeof v === 'string') out[key] = legacyTexToText(v);
        }
    }

    out.variables = typeof src.variables === 'string' && src.variables.trim() ? src.variables : 'x, y';
    out.equalScale = bool(src.equalScale, false);
    out.showSlidersInNote = bool(src.showSlidersInNote, true);
    out.v = SCHEMA_VERSION;
    return out;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Give every function a valid, unique name: keep a valid unique name; blank
 * -> 'f' + (index + 1); otherwise sanitize ([^A-Za-z0-9_] -> '_', leading
 * digit -> 'f_' prefix) and append 2, 3, ... for reserved or duplicate
 * names. `renames` maps every OLD effective name (including the implicit
 * 'f' + (i + 1) of blank names) to the new one when they differ.
 *
 * Valid names claim their spot first, so explicitly named functions keep
 * their names even when a blank one earlier in the list would have the same
 * implicit name. 3.x resolved duplicate names to the LAST function with that
 * name, so `renames` maps a duplicated old name to that function's new name.
 */
export function normalizeFunctions(raw: unknown): { functions: FunctionParameters[]; renames: Map<string, string> } {
    const entries: { index: number; src: Record<string, unknown>; name: string }[] = [];
    if (Array.isArray(raw)) {
        raw.forEach((item, index) => {
            if (isRecord(item)) entries.push({ index, src: item, name: str(item.name, '').trim() });
        });
    }

    const taken = new Set<string>();
    const names: string[] = entries.map(() => '');
    entries.forEach((entry, k) => {
        // 6.0 ML: t names a function of x (t(x) = ...), never a parametric curve.
        const tFunction = entry.name === 't' && entry.src.parametric !== true;
        if ((isValidName(entry.name) || tFunction) && !taken.has(entry.name)) {
            names[k] = entry.name;
            taken.add(entry.name);
        }
    });
    entries.forEach((entry, k) => {
        if (names[k]) return;
        let next: string;
        if (!entry.name) {
            const implicit = `f${entry.index + 1}`;
            next = taken.has(implicit) ? nextFunctionName(taken) : implicit;
        } else {
            next = uniqueName(sanitizeName(entry.name), taken);
        }
        names[k] = next;
        taken.add(next);
    });

    const functions = entries.map((entry, k) => {
        const fn = completeFunction(entry.src);
        fn.name = names[k];
        // 6.0 ML: the head as written, while it still names the function.
        if (typeof entry.src.head === 'string' && headName(entry.src.head) === fn.name) fn.head = entry.src.head;
        return fn;
    });

    // Old effective names as 3.x computed them; later duplicates won lookups.
    const resolved = new Map<string, number>();
    entries.forEach((entry, k) => resolved.set(entry.name || `f${entry.index + 1}`, k));
    const renames = new Map<string, string>();
    for (const [old, k] of resolved) {
        if (names[k] !== old) renames.set(old, names[k]);
    }
    return { functions, renames };
}

function sanitizeName(name: string): string {
    const s = name.replace(/[^A-Za-z0-9_]/g, '_');
    if (/^\d/.test(s)) return `f_${s}`;
    if (s.startsWith('_')) return `f${s}`;
    return s;
}

/** `base` when free, else base2, base3, ... (base_2 when base ends in a digit, so 'f1' never becomes 'f12'). */
function uniqueName(base: string, taken: ReadonlySet<string>): string {
    if (!RESERVED_NAMES.has(base) && !taken.has(base)) return base;
    const sep = /\d$/.test(base) ? '_' : '';
    for (let k = 2; ; k++) {
        const candidate = `${base}${sep}${k}`;
        if (!RESERVED_NAMES.has(candidate) && !taken.has(candidate)) return candidate;
    }
}

function completeFunction(src: Record<string, unknown>): FunctionParameters {
    const d = functionDefaults();
    const fn: FunctionParameters = {
        expression: str(src.expression, d.expression),
        domain: str(src.domain, d.domain),
        showLegend: bool(src.showLegend, d.showLegend),
        fill: bool(src.fill, d.fill),
        fillOpacity: opacityOf(src.fillOpacity, d.fillOpacity),
        fillPattern: oneOf(src.fillPattern, FILL_PATTERNS, d.fillPattern),
        tangent: bool(src.tangent, d.tangent),
        color: colorOf(src.color, d.color),
        dashed: bool(src.dashed, d.dashed),
        tangentPoint: str(src.tangentPoint, d.tangentPoint),
        extrema: bool(src.extrema, d.extrema),
        thickness: thicknessOf(src.thickness, d.thickness),
        parametric: bool(src.parametric, d.parametric),
        expressionY: str(src.expressionY, d.expressionY),
    };
    if (typeof src.legendLabel === 'string') fn.legendLabel = src.legendLabel;
    if (src.hidden === true) fn.hidden = true;
    // 6.0 C: the step it arrives in
    const step = keptStep(src);
    if (step) fn.step = step;
    return fn;
}

function normalizeSurfaces(raw: unknown): Function3DParameters[] {
    if (!Array.isArray(raw)) return [];
    const out: Function3DParameters[] = [];
    for (const src of raw) {
        if (!isRecord(src)) continue;
        const surface: Function3DParameters = {
            expression: str(src.expression, ''),
            xDomain: str(src.xDomain, '-5:5'),
            yDomain: str(src.yDomain, '-5:5'),
            color: colorOf(src.color, 'blue'),
            wireframe: bool(src.wireframe, false),
            opacity: opacityOf(src.opacity, 0.7),
            samples: Math.max(2, Math.round(num(src.samples, 40))),
        };
        // A colour map the plugin does not know is dropped: the surface keeps its own colour.
        if (isColormap(src.colormap)) surface.colormap = src.colormap;
        // Mesh lines: a number is clamped to 0..1, anything else dropped (absent draws them at 40 %).
        if (typeof src.meshOpacity === 'number' && Number.isFinite(src.meshOpacity)) surface.meshOpacity = clamp(src.meshOpacity, 0, 1);
        if (typeof src.name === 'string') surface.name = src.name;
        if (src.hidden === true) surface.hidden = true;
        const step = keptStep(src); // 6.0 C
        if (step) surface.step = step;
        out.push(surface);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

function normalizeAnnotations(raw: unknown, legacy: boolean): Annotation[] {
    if (!Array.isArray(raw)) return [];
    const out: Annotation[] = [];
    for (const src of raw) {
        if (!isRecord(src)) continue;
        const text = str(src.text, '');
        const a: Annotation = {
            x: str(src.x, '0'),
            y: str(src.y, '0'),
            text: legacy ? legacyLabel(text) : text,
            color: colorOf(src.color, 'black'),
            size: oneOf(src.size, ANNOTATION_SIZES, 'normal'),
            anchor: oneOf(src.anchor, ANNOTATION_ANCHORS, 'above'),
        };
        if (src.z !== undefined && src.z !== null) a.z = str(src.z, '0');
        if (src.hidden === true) a.hidden = true;
        const step = keptStep(src); // 6.0 C
        if (step) a.step = step;
        out.push(a);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Legacy -> v4 (substituted sources are wrapped in parentheses unless they
 * are plain unsigned numbers, e.g. `(x - (cx))^2 + (y - (cy))^2 <= (r)^2`):
 * - areaBetween(f, g, a:b) -> region ['min(f, g) <= y <= max(f, g)'] plus
 *   '(a) <= x <= (b)' when a domain is set; fill on, outline none.
 * - rectangle -> region ['xlo <= x <= xhi', 'ylo <= y <= yhi'] (numeric
 *   bounds sorted; expression bounds use min()/max()); fill per old flag,
 *   outline solid with the old thickness.
 * - circle -> fill ? region ['(x - cx)^2 + (y - cy)^2 <= (r)^2'] (outline
 *   solid) : curve '(x - cx)^2 + (y - cy)^2 = (r)^2'.
 * - verticalLine -> curve 'x = c'; horizontalLine -> curve 'y = c'.
 * - intersection -> points source 'intersections', ref1/ref2 = the function
 *   names, label '({x:2}, {y:2})' if showLabels else ''.
 * - segment (x1..y2, arrow) -> segment path '(x1, y1); (x2, y2)', style
 *   from arrow ('none' -> 'line'); brace -> style 'brace'.
 * - segment3D -> segment dim 3; point3D -> points dim 3 list '(x, y, z)'.
 * - plane3D -> plane3D.
 * Function references go through `renames`. v4 tools are completed with
 * defaults for missing fields. Unknown entries are dropped.
 *
 * Optional extras (v4 implementation):
 * - `functions`: the normalized function list. Function names count as
 *   taken tool names, and a legacy areaBetween / intersection whose function
 *   is missing or had no domain becomes `hidden` (3.x drew nothing for it).
 * - `takenNames`: further names tools must not use (parameters).
 * - `is3D`: dim for v4 points / segments that lack one.
 * Ids: valid unique ids are kept; others become 't' + list index (suffixed
 * '_2', '_3', ... on a clash). Names: valid unique names are kept; others
 * get the next free name of their kind, in list order.
 */
export function normalizeTools(
    raw: unknown,
    opts: {
        renames?: Map<string, string>;
        existingIds?: Set<string>;
        functions?: FunctionParameters[];
        takenNames?: Iterable<string>;
        is3D?: boolean;
    }
): Tool[] {
    if (!Array.isArray(raw)) return [];
    const renames = opts.renames || new Map<string, string>();
    const fnByName = opts.functions ? new Map(opts.functions.map((f) => [f.name || '', f])) : null;
    const ctx: ConvertContext = {
        ref: (v) => {
            const name = str(v, '').trim();
            return renames.get(name) ?? name;
        },
        drawable: (name) => {
            if (!fnByName) return name !== '';
            const fn = fnByName.get(name);
            return !!fn && fn.expression.trim() !== '' && fn.domain.trim() !== '';
        },
        dim: opts.is3D ? 3 : 2,
    };

    const pending: { index: number; type: ToolType; body: ToolBody; hidden: boolean; id: string; name: string; step?: number }[] = [];
    raw.forEach((item, index) => {
        if (!isRecord(item)) return;
        const converted = convertTool(item, ctx);
        if (!converted) return;
        pending.push({
            index,
            type: converted.body.type,
            body: converted.body,
            hidden: converted.hidden || item.hidden === true,
            id: typeof item.id === 'string' ? item.id : '',
            name: typeof item.name === 'string' ? item.name.trim() : '',
            step: keptStep(item), // 6.0 C
        });
    });

    const usedIds = new Set<string>(opts.existingIds ? Array.from(opts.existingIds) : []);
    const ids = pending.map((p) => {
        if (!ID_RE.test(p.id) || usedIds.has(p.id)) return '';
        usedIds.add(p.id);
        return p.id;
    });
    pending.forEach((p, k) => {
        if (ids[k]) return;
        let id = `t${p.index}`;
        for (let n = 2; usedIds.has(id); n++) id = `t${p.index}_${n}`;
        usedIds.add(id);
        ids[k] = id;
    });

    const takenNames = new Set<string>(opts.takenNames ? Array.from(opts.takenNames) : []);
    for (const f of opts.functions || []) if (f.name) takenNames.add(f.name);
    const names = pending.map((p) => {
        if (!isValidName(p.name) || takenNames.has(p.name)) return '';
        takenNames.add(p.name);
        return p.name;
    });
    pending.forEach((p, k) => {
        if (names[k]) return;
        names[k] = nextToolName(p.type, takenNames);
        takenNames.add(names[k]);
    });

    return pending.map((p, k) => {
        const tool: Tool = { ...p.body, id: ids[k], name: names[k] };
        if (p.hidden) tool.hidden = true;
        if (p.step) tool.step = p.step; // 6.0 C
        return tool;
    });
}

interface ConvertContext {
    /** Trimmed function reference with renames applied. */
    ref(v: unknown): string;
    /** Whether 3.x would have drawn a tool referencing this (renamed) function. */
    drawable(name: string): boolean;
    /** Default dim for v4 points / segments without one. */
    dim: 2 | 3;
}

function convertTool(src: Record<string, unknown>, ctx: ConvertContext): { body: ToolBody; hidden: boolean } | null {
    switch (src.type) {
        case 'region':
            return { body: completeRegion(src), hidden: false };
        case 'curve':
            return { body: completeCurve(src), hidden: false };
        case 'points':
            return { body: completePoints(src, ctx), hidden: false };
        case 'plane3D':
            // The legacy plane is the v4 plane minus id / name.
            return { body: completePlane(src), hidden: false };
        case 'data':
            return { body: completeData(src), hidden: false };
        case 'dataPlot':
            return { body: completeDataPlot(src), hidden: false };
        case 'distribution':
            return { body: completeDistribution(src), hidden: false };
        case 'probability':
            return { body: completeProbability(src), hidden: false };
        case 'riemann':
            return { body: completeRiemann(src), hidden: false };
        case 'slopeField':
            return { body: completeSlopeField(src), hidden: false };
        case 'solution':
            return { body: completeSolution(src), hidden: false };
        // 6.0 B
        case 'axisSet':
            return { body: completeAxisSet(src), hidden: false };
        case 'chord':
            return { body: completeChord(src), hidden: false };
        // 6.0 A
        case 'value':
            return { body: completeValue(src), hidden: false };
        case 'vector':
            return { body: completeVector(src), hidden: false };
        case 'listPoints':
            return { body: completeListPoints(src), hidden: false };
        case 'segment':
            return isLegacySegment(src) ? legacySegment(src) : { body: completeSegment(src, ctx), hidden: false };
        case 'areaBetween':
            return legacyAreaBetween(src, ctx);
        case 'intersection':
            return legacyIntersection(src, ctx);
        case 'verticalLine':
        case 'horizontalLine':
            return legacyLine(src);
        case 'rectangle':
            return legacyRectangle(src);
        case 'circle':
            return legacyCircle(src);
        case 'brace':
            return legacyBrace(src);
        case 'point3D':
            return legacyPoint3D(src);
        case 'segment3D':
            return legacySegment3D(src);
        default: {
            // 6.0 C: vector fields, rest points, solutions of systems
            const motion = completeMotionTool(src, ctx.dim);
            if (motion) return { body: motion, hidden: false };
            // 6.0 D: grids, basis vectors, transforms, eigenvectors, unit squares, spans
            const linear = completeLinearTool(src);
            if (linear) return { body: linear, hidden: false };
            // 6.0 E: orbits, cobwebs, bifurcation diagrams, Newton's method, coloured planes, turning circles
            const iterate = completeIterateTool(src);
            if (iterate) return { body: iterate, hidden: false };
            // 6.0 G: GeoGebra lines
            const geogebra = completeGeoGebraTool(src);
            if (geogebra) return { body: geogebra, hidden: false };
            // 6.0 P: a python script
            const python = completePythonTool(src);
            return python ? { body: python, hidden: false } : null;
        }
    }
}

/** A 'segment' without `path` but with any of the 3.x fields is the legacy shape. */
function isLegacySegment(src: Record<string, unknown>): boolean {
    if ('path' in src) return false;
    return ['x1', 'y1', 'x2', 'y2', 'arrow'].some((key) => key in src);
}

// --- v4 completion ---

function completeRegion(src: Record<string, unknown>): RegionBody {
    const d = regionDefaults();
    const conditions = stringList(src.conditions, d.conditions);
    const labels = stringList(src.conditionLabels, []);
    return {
        type: 'region',
        color: colorOf(src.color, d.color),
        conditions,
        conditionLabels: conditions.map((_, i) => labels[i] ?? ''),
        fill: bool(src.fill, d.fill),
        fillOpacity: opacityOf(src.fillOpacity, d.fillOpacity),
        fillPattern: oneOf(src.fillPattern, FILL_PATTERNS, d.fillPattern),
        outline: oneOf(src.outline, OUTLINE_STYLES, d.outline),
        thickness: thicknessOf(src.thickness, d.thickness),
        constraintLines: bool(src.constraintLines, d.constraintLines),
        label: str(src.label, d.label),
    };
}

function completeCurve(src: Record<string, unknown>): CurveBody {
    const d = curveDefaults();
    return {
        type: 'curve',
        color: colorOf(src.color, d.color),
        equation: str(src.equation, d.equation),
        levels: str(src.levels, d.levels),
        thickness: thicknessOf(src.thickness, d.thickness),
        dashed: bool(src.dashed, d.dashed),
        label: str(src.label, d.label),
    };
}

function dimOf(v: unknown, fallback: 2 | 3): 2 | 3 {
    const n = num(v, fallback);
    return n === 2 || n === 3 ? n : fallback;
}

function completePoints(src: Record<string, unknown>, ctx: ConvertContext): PointsBody {
    const d = pointsDefaults(dimOf(src.dim, ctx.dim));
    return {
        type: 'points',
        color: colorOf(src.color, d.color),
        dim: d.dim,
        source: oneOf(src.source, POINT_SOURCES, d.source),
        points: str(src.points, d.points),
        ref1: ctx.ref(src.ref1),
        ref2: ctx.ref(src.ref2),
        regionName: str(src.regionName, d.regionName).trim(),
        objective: str(src.objective, d.objective),
        sense: oneOf(src.sense, ['max', 'min'] as const, d.sense),
        label: str(src.label, d.label),
        dropLines: bool(src.dropLines, d.dropLines),
        size: oneOf(src.size, MARKER_SIZES, d.size),
    };
}

function completeSegment(src: Record<string, unknown>, ctx: ConvertContext): SegmentBody {
    const d = segmentDefaults(dimOf(src.dim, ctx.dim));
    return {
        type: 'segment',
        color: colorOf(src.color, d.color),
        dim: d.dim,
        path: str(src.path, d.path),
        closed: bool(src.closed, d.closed),
        style: oneOf(src.style, SEGMENT_STYLES, d.style),
        thickness: thicknessOf(src.thickness, d.thickness),
        dashed: bool(src.dashed, d.dashed),
        label: str(src.label, d.label),
    };
}

function completePlane(src: Record<string, unknown>): PlaneBody {
    const d = planeDefaults();
    return {
        type: 'plane3D',
        color: colorOf(src.color, d.color),
        axis: oneOf(src.axis, ['x', 'y', 'z'] as const, d.axis),
        value: str(src.value, d.value),
        fillOpacity: opacityOf(src.fillOpacity, d.fillOpacity),
    };
}

const DATA_PLOT_STYLES: readonly DataPlotTool['style'][] = ['points', 'bars', 'line', 'regression'];

function completeData(src: Record<string, unknown>): DataBody {
    const d = dataDefaults();
    return {
        type: 'data',
        color: colorOf(src.color, d.color),
        source: oneOf(src.source, ['table', 'list'] as const, d.source),
        points: str(src.points, d.points),
        xColumn: str(src.xColumn, d.xColumn),
        yColumn: str(src.yColumn, d.yColumn),
    };
}

function completeDataPlot(src: Record<string, unknown>): DataPlotBody {
    const d = dataPlotDefaults();
    return {
        type: 'dataPlot',
        color: colorOf(src.color, d.color),
        data: str(src.data, d.data).trim(),
        style: oneOf(src.style, DATA_PLOT_STYLES, d.style),
        size: oneOf(src.size, MARKER_SIZES, d.size),
        thickness: thicknessOf(src.thickness, d.thickness),
        dashed: bool(src.dashed, d.dashed),
        fillOpacity: opacityOf(src.fillOpacity, d.fillOpacity),
        label: str(src.label, d.label),
        valueLabel: bool(src.valueLabel, d.valueLabel),
    };
}

function completeDistribution(src: Record<string, unknown>): DistributionBody {
    const d = distributionDefaults();
    return {
        type: 'distribution',
        color: colorOf(src.color, d.color),
        kind: oneOf(src.kind, ['normal', 'binomial'] as const, d.kind),
        mean: str(src.mean, d.mean),
        sd: str(src.sd, d.sd),
        n: str(src.n, d.n),
        p: str(src.p, d.p),
        thickness: thicknessOf(src.thickness, d.thickness),
        dashed: bool(src.dashed, d.dashed),
        fillOpacity: opacityOf(src.fillOpacity, d.fillOpacity),
    };
}

function completeProbability(src: Record<string, unknown>): ProbabilityBody {
    const d = probabilityDefaults();
    return {
        type: 'probability',
        color: colorOf(src.color, d.color),
        distribution: str(src.distribution, d.distribution).trim(),
        event: str(src.event, d.event),
        fillOpacity: opacityOf(src.fillOpacity, d.fillOpacity),
        fillPattern: oneOf(src.fillPattern, FILL_PATTERNS, d.fillPattern),
        label: str(src.label, d.label),
        valueLabel: bool(src.valueLabel, d.valueLabel),
    };
}

const RIEMANN_METHODS: readonly RiemannTool['method'][] = ['left', 'right', 'middle', 'trapezoid'];

function completeRiemann(src: Record<string, unknown>): RiemannBody {
    const d = riemannDefaults();
    return {
        type: 'riemann',
        color: colorOf(src.color, d.color),
        function: str(src.function, d.function).trim(),
        method: oneOf(src.method, RIEMANN_METHODS, d.method),
        from: str(src.from, d.from),
        to: str(src.to, d.to),
        parts: str(src.parts, d.parts),
        thickness: thicknessOf(src.thickness, d.thickness),
        fillOpacity: opacityOf(src.fillOpacity, d.fillOpacity),
        label: str(src.label, d.label),
        valueLabel: bool(src.valueLabel, d.valueLabel),
    };
}

function completeSlopeField(src: Record<string, unknown>): SlopeFieldBody {
    const d = slopeFieldDefaults();
    return {
        type: 'slopeField',
        color: colorOf(src.color, d.color),
        expression: str(src.expression, d.expression),
        density: Math.round(clamp(num(src.density, d.density), 4, 60)),
        thickness: thicknessOf(src.thickness, d.thickness),
    };
}

function completeSolution(src: Record<string, unknown>): SolutionBody {
    const d = solutionDefaults();
    return {
        type: 'solution',
        color: colorOf(src.color, d.color),
        field: str(src.field, d.field).trim(),
        through: str(src.through, d.through),
        thickness: thicknessOf(src.thickness, d.thickness),
        dashed: bool(src.dashed, d.dashed),
    };
}

// --- legacy conversion ---
// Defaults mirror what the 3.19.6 renderer / exporter used for missing fields.

function arrowStyle(v: unknown): SegmentStyle {
    const arrow = oneOf<ArrowStyle>(v, ['none', 'forward', 'backward', 'both'], 'none');
    return arrow === 'none' ? 'line' : arrow;
}

function legacyAreaBetween(src: Record<string, unknown>, ctx: ConvertContext): { body: RegionBody; hidden: boolean } {
    const f = ctx.ref(src.func1Name);
    const g = ctx.ref(src.func2Name);
    let hidden = !ctx.drawable(f) || !ctx.drawable(g);
    // A blank reference still yields a parseable condition (the tool is hidden anyway).
    const a = f || '0';
    const b = g || '0';
    const conditions = [`min(${a}, ${b}) <= y <= max(${a}, ${b})`];
    const domain = str(src.domain, '').trim();
    if (domain) {
        const parts = splitDomain(domain);
        // 3.x drew nothing when the domain did not parse, or when its numbers were not in order (parseDomain).
        if (parts) conditions.push(`${wrap(parts[0])} <= x <= ${wrap(parts[1])}`);
        else hidden = true;
        if (parts && NUMERIC_LITERAL_RE.test(parts[0]) && NUMERIC_LITERAL_RE.test(parts[1]) && !(Number(parts[0]) < Number(parts[1]))) {
            hidden = true;
        }
    }
    const body: RegionBody = {
        ...regionDefaults(),
        color: colorOf(src.color, 'blue'),
        conditions,
        conditionLabels: conditions.map(() => ''),
        fill: true,
        fillOpacity: opacityOf(src.fillOpacity, 0.3),
        fillPattern: oneOf(src.fillPattern, FILL_PATTERNS, 'solid'),
        outline: 'none',
    };
    return { body, hidden };
}

function legacyIntersection(src: Record<string, unknown>, ctx: ConvertContext): { body: PointsBody; hidden: boolean } {
    const ref1 = ctx.ref(src.func1Name);
    const ref2 = ctx.ref(src.func2Name);
    const body: PointsBody = {
        ...pointsDefaults(2),
        color: colorOf(src.color, 'red'),
        source: 'intersections',
        ref1,
        ref2,
        label: src.showLabels === true ? '({x:2}, {y:2})' : '',
    };
    return { body, hidden: !ctx.drawable(ref1) || !ctx.drawable(ref2) };
}

function legacyLine(src: Record<string, unknown>): { body: CurveBody; hidden: boolean } {
    const vertical = src.type === 'verticalLine';
    const value = legacyCoord(vertical ? src.x : src.y, '0');
    const body: CurveBody = {
        ...curveDefaults(),
        color: colorOf(src.color, 'blue'),
        equation: `${vertical ? 'x' : 'y'} = ${wrap(value)}`,
        thickness: thicknessOf(src.thickness, 'thin'),
        dashed: bool(src.dashed, false),
        label: legacyLabel(src.label),
    };
    return { body, hidden: false };
}

/** Sorted bounds for numeric literals, min()/max() otherwise. */
function rangeBounds(a: string, b: string): [string, string] {
    if (NUMERIC_LITERAL_RE.test(a) && NUMERIC_LITERAL_RE.test(b)) {
        return Number(a) <= Number(b) ? [wrap(a), wrap(b)] : [wrap(b), wrap(a)];
    }
    return [`min(${wrap(a)}, ${wrap(b)})`, `max(${wrap(a)}, ${wrap(b)})`];
}

function legacyRectangle(src: Record<string, unknown>): { body: RegionBody; hidden: boolean } {
    const [xlo, xhi] = rangeBounds(legacyCoord(src.x1, '0'), legacyCoord(src.x2, '0'));
    const [ylo, yhi] = rangeBounds(legacyCoord(src.y1, '0'), legacyCoord(src.y2, '0'));
    const conditions = [`${xlo} <= x <= ${xhi}`, `${ylo} <= y <= ${yhi}`];
    const body: RegionBody = {
        ...regionDefaults(),
        color: colorOf(src.color, 'blue'),
        conditions,
        conditionLabels: ['', ''],
        fill: src.fill === true,
        fillOpacity: opacityOf(src.fillOpacity, 0.2),
        fillPattern: oneOf(src.fillPattern, FILL_PATTERNS, 'solid'),
        outline: 'solid',
        thickness: thicknessOf(src.thickness, 'thin'),
    };
    return { body, hidden: false };
}

function legacyCircle(src: Record<string, unknown>): { body: RegionBody | CurveBody; hidden: boolean } {
    const cx = legacyCoord(src.cx, '0');
    const cy = legacyCoord(src.cy, '0');
    const r = legacyCoord(src.r, '1');
    const square = (v: string, c: string) =>
        NUMERIC_LITERAL_RE.test(c) && Number(c) === 0 ? `${v}^2` : `(${v} - ${wrap(c)})^2`;
    const lhs = `${square('x', cx)} + ${square('y', cy)}`;
    const rhs = `${wrap(r)}^2`;
    // 3.x skipped circles whose radius was not positive.
    const hidden = NUMERIC_LITERAL_RE.test(r) && !(Number(r) > 0);
    const color = colorOf(src.color, 'blue');
    const thickness = thicknessOf(src.thickness, 'thin');
    if (src.fill === true) {
        const body: RegionBody = {
            ...regionDefaults(),
            color,
            conditions: [`${lhs} <= ${rhs}`],
            conditionLabels: [''],
            fill: true,
            fillOpacity: opacityOf(src.fillOpacity, 0.2),
            fillPattern: oneOf(src.fillPattern, FILL_PATTERNS, 'solid'),
            outline: 'solid',
            thickness,
        };
        return { body, hidden };
    }
    const body: CurveBody = { ...curveDefaults(), color, equation: `${lhs} = ${rhs}`, thickness };
    return { body, hidden };
}

function legacySegment(src: Record<string, unknown>): { body: SegmentBody; hidden: boolean } {
    const coords = ['x1', 'y1', 'x2', 'y2'].map((key) => wrap(legacyCoord(src[key], '0')));
    const body: SegmentBody = {
        ...segmentDefaults(2),
        color: colorOf(src.color, 'blue'),
        path: `(${coords[0]}, ${coords[1]}); (${coords[2]}, ${coords[3]})`,
        style: arrowStyle(src.arrow),
        thickness: thicknessOf(src.thickness, 'thin'),
        dashed: bool(src.dashed, false),
    };
    return { body, hidden: false };
}

function legacyBrace(src: Record<string, unknown>): { body: SegmentBody; hidden: boolean } {
    const coords = ['x1', 'y1', 'x2', 'y2'].map((key) => wrap(legacyCoord(src[key], '0')));
    const body: SegmentBody = {
        ...segmentDefaults(2),
        color: colorOf(src.color, 'blue'),
        path: `(${coords[0]}, ${coords[1]}); (${coords[2]}, ${coords[3]})`,
        style: 'brace',
        label: legacyLabel(src.label),
    };
    return { body, hidden: false };
}

function legacyPoint3D(src: Record<string, unknown>): { body: PointsBody; hidden: boolean } {
    const coords = ['x', 'y', 'z'].map((key) => wrap(legacyCoord(src[key], '0')));
    const body: PointsBody = {
        ...pointsDefaults(3),
        color: colorOf(src.color, 'red'),
        points: `(${coords.join(', ')})`,
        label: legacyLabel(src.label),
    };
    return { body, hidden: false };
}

function legacySegment3D(src: Record<string, unknown>): { body: SegmentBody; hidden: boolean } {
    const a = ['x1', 'y1', 'z1'].map((key) => wrap(legacyCoord(src[key], '0')));
    const b = ['x2', 'y2', 'z2'].map((key) => wrap(legacyCoord(src[key], '0')));
    const body: SegmentBody = {
        ...segmentDefaults(3),
        color: colorOf(src.color, 'blue'),
        path: `(${a.join(', ')}); (${b.join(', ')})`,
        style: arrowStyle(src.arrow),
        thickness: thicknessOf(src.thickness, 'thin'),
        dashed: bool(src.dashed, false),
    };
    return { body, hidden: false };
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/** Keep valid, unique, non-reserved names; coerce numbers; fix min > max and step <= 0. */
export function normalizeParameters(raw: unknown): Parameter[] {
    if (!Array.isArray(raw)) return [];
    const out: Parameter[] = [];
    const taken = new Set<string>();
    for (const src of raw) {
        if (!isRecord(src)) continue;
        const name = str(src.name, '').trim();
        if (!isValidName(name) || taken.has(name)) continue;
        taken.add(name);

        let min = num(src.min, -10);
        let max = num(src.max, 10);
        if (min > max) [min, max] = [max, min];
        if (min === max) {
            min -= 1;
            max += 1;
        }
        const value = num(src.value, clamp(1, min, max));
        // Widen rather than clamp: the stored value is what the picture shows.
        min = Math.min(min, value);
        max = Math.max(max, value);
        let step = num(src.step, NaN);
        if (!(step > 0)) step = niceStep(max - min);
        const p: Parameter = src.connected === true ? { name, value, min, max, step, connected: true } : { name, value, min, max, step };
        if (src.geogebra === true) p.geogebra = true; // 6.0 G: `a = Slider(0, 5)`
        out.push(p);
    }
    return out;
}

/** Power of ten giving about 100 slider steps over `range`. */
function niceStep(range: number): number {
    const step = Math.pow(10, Math.floor(Math.log10(range / 100)));
    return Number.isFinite(step) && step > 0 ? step : 0.1;
}

// ---------------------------------------------------------------------------
// Names, ids and defaults
// ---------------------------------------------------------------------------

/** Random stable id for new tools (e.g. 'k3f9x2'). Never starts with 't', so it cannot look like a migrated id. */
export function newId(): string {
    const first = 'abcdefghijklmnopqrsuvwxyz';
    const rest = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = first[Math.floor(Math.random() * first.length)];
    for (let i = 0; i < 5; i++) id += rest[Math.floor(Math.random() * rest.length)];
    return id;
}

/** First free name of a b c d k m n p q r s u v w, then a2, b2, ... */
export function nextParameterName(taken: Iterable<string>): string {
    const set = new Set(taken);
    for (let round = 1; ; round++) {
        for (const letter of PARAMETER_LETTERS) {
            const name = round === 1 ? letter : `${letter}${round}`;
            if (!set.has(name)) return name;
        }
    }
}

/** First free 'f' + n. */
export function nextFunctionName(taken: Iterable<string>): string {
    const set = new Set(taken);
    for (let n = 1; ; n++) {
        if (!set.has(`f${n}`)) return `f${n}`;
    }
}

/** First free name with the tool kind's prefix: region R, curve C, points P, segment S, plane3D PL. */
export function nextToolName(type: ToolType, taken: Iterable<string>): string {
    const set = new Set(taken);
    const prefix = TOOL_PREFIX[type];
    for (let n = 1; ; n++) {
        if (!set.has(`${prefix}${n}`)) return `${prefix}${n}`;
    }
}

/** A blank 2D function card state (empty domain = follow the view). */
export function defaultFunction(taken: Iterable<string>, color?: string): FunctionParameters {
    return { ...functionDefaults(), name: nextFunctionName(taken), color: color || 'black' };
}

/** A new parameter with defaults { value: 1, min: -10, max: 10, step: 0.1 } (value clamped into range). */
export function defaultParameter(taken: Iterable<string>, name?: string, value?: number): Parameter {
    const set = new Set(taken);
    const chosen = name && isValidName(name) && !set.has(name) ? name : nextParameterName(set);
    const v = typeof value === 'number' && Number.isFinite(value) ? value : 1;
    return { name: chosen, value: clamp(v, -10, 10), min: -10, max: 10, step: 0.1 };
}

interface ToolOpts {
    is3D: boolean;
    tools: Tool[];
    functions: FunctionParameters[];
    parameters?: Parameter[];
}

/** Id and name for a new tool of `type` that clash with nothing in the chart. */
function identity(type: ToolType, opts: ToolOpts): { id: string; name: string } {
    const ids = new Set(opts.tools.map((t) => t.id));
    let id = newId();
    while (ids.has(id)) id = newId();
    const taken = [
        ...opts.tools.map((t) => t.name),
        ...opts.functions.map((f) => f.name || ''),
        ...(opts.parameters || []).map((p) => p.name),
    ];
    return { id, name: nextToolName(type, taken) };
}

function nextRegionColor(tools: Tool[]): string {
    const regions = tools.filter((t) => t.type === 'region');
    const used = new Set(regions.map((t) => t.color));
    return REGION_COLORS.find((c) => !used.has(c)) ?? REGION_COLORS[regions.length % REGION_COLORS.length];
}

function nextFunctionColor(functions: FunctionParameters[]): string {
    const used = new Set(functions.map((f) => f.color));
    return FUNCTION_COLORS.find((c) => !used.has(c)) ?? FUNCTION_COLORS[functions.length % FUNCTION_COLORS.length];
}

function newRegion(opts: ToolOpts): RegionTool {
    return { ...regionDefaults(), ...identity('region', opts), color: nextRegionColor(opts.tools) };
}

function newCurve(opts: ToolOpts): CurveTool {
    return { ...curveDefaults(), ...identity('curve', opts) };
}

function newPoints(opts: ToolOpts): PointsTool {
    return { ...pointsDefaults(opts.is3D ? 3 : 2), ...identity('points', opts) };
}

function newSegment(opts: ToolOpts): SegmentTool {
    return { ...segmentDefaults(opts.is3D ? 3 : 2), ...identity('segment', opts) };
}

function newPlane(opts: ToolOpts): PlaneTool {
    return { ...planeDefaults(), ...identity('plane3D', opts) };
}

function newData(opts: ToolOpts): DataTool {
    return { ...dataDefaults(), ...identity('data', opts) };
}

function newDataPlot(opts: ToolOpts): DataPlotTool {
    return { ...dataPlotDefaults(), ...identity('dataPlot', opts) };
}

function newDistribution(opts: ToolOpts): DistributionTool {
    return { ...distributionDefaults(), ...identity('distribution', opts) };
}

function newProbability(opts: ToolOpts): ProbabilityTool {
    return { ...probabilityDefaults(), ...identity('probability', opts) };
}

function newRiemann(opts: ToolOpts): RiemannTool {
    return { ...riemannDefaults(), ...identity('riemann', opts) };
}

function newSlopeField(opts: ToolOpts): SlopeFieldTool {
    return { ...slopeFieldDefaults(), ...identity('slopeField', opts) };
}

function newSolution(opts: ToolOpts): SolutionTool {
    return { ...solutionDefaults(), ...identity('solution', opts) };
}

// 6.0 A
function newValue(opts: ToolOpts): ValueTool {
    return { ...valueDefaults(), ...identity('value', opts) };
}

function newVector(opts: ToolOpts): VectorTool {
    return { ...vectorDefaults(), ...identity('vector', opts) };
}

function newListPoints(opts: ToolOpts): ListPointsTool {
    return { ...listPointsDefaults(), ...identity('listPoints', opts) };
}

/**
 * Default tool of a kind. New regions cycle through the palette (next
 * colour not used by another region) at opacity 0.25.
 */
export function defaultTool(type: ToolType, opts: { is3D: boolean; tools: Tool[]; functions: FunctionParameters[] }): Tool {
    switch (type) {
        case 'region':
            return newRegion(opts);
        case 'curve':
            return newCurve(opts);
        case 'points':
            return newPoints(opts);
        case 'segment':
            return newSegment(opts);
        case 'plane3D':
            return newPlane(opts);
        case 'data':
            return newData(opts);
        case 'dataPlot':
            return newDataPlot(opts);
        case 'distribution':
            return newDistribution(opts);
        case 'probability':
            return newProbability(opts);
        case 'riemann':
            return newRiemann(opts);
        case 'slopeField':
            return newSlopeField(opts);
        case 'solution':
            return newSolution(opts);
        // 6.0 C
        case 'vectorField':
            return { ...vectorFieldDefaults(), ...identity('vectorField', opts) };
        case 'restPoints':
            return { ...restPointsDefaults(), ...identity('restPoints', opts) };
        case 'trajectory':
            return { ...trajectoryDefaults(opts.is3D ? 3 : 2), ...identity('trajectory', opts) };
        // 6.0 B
        case 'axisSet':
            return { ...axisSetDefaults(), ...identity('axisSet', opts) };
        case 'chord':
            return { ...chordDefaults(), ...identity('chord', opts) };
        // 6.0 A
        case 'value':
            return newValue(opts);
        case 'vector':
            return newVector(opts);
        case 'listPoints':
            return newListPoints(opts);
        // 6.0 D
        case 'planeGrid':
            return { ...planeGridDefaults(), ...identity('planeGrid', opts) };
        case 'basisVectors':
            return { ...basisVectorsDefaults(), ...identity('basisVectors', opts) };
        case 'transform':
            return { ...transformDefaults(), ...identity('transform', opts) };
        case 'eigenvectors':
            return { ...eigenvectorsDefaults(), ...identity('eigenvectors', opts) };
        case 'unitSquare':
            return { ...unitSquareDefaults(), ...identity('unitSquare', opts) };
        case 'span':
            return { ...spanDefaults(), ...identity('span', opts) };
        // 6.0 E
        case 'orbit':
        case 'cobweb':
        case 'bifurcation':
        case 'newton':
        case 'colourPlane':
        case 'fourierCircles':
            return { ...(iterateDefaults(type) as Omit<Tool, 'id' | 'name' | 'hidden'>), ...identity(type, opts) } as Tool;
        // 6.0 G
        case 'geogebra':
            return { ...geogebraDefaults(), ...identity('geogebra', opts) };
        // 6.0 P
        case 'python':
            return { ...pythonDefaults(), ...identity('python', opts) };
    }
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/** A pre-filled item offered in the Build tab's Add menus. */
export interface Recipe {
    id: string;
    /**
     * Menu section: 'Functions', 'Regions', 'Curves and lines', 'Points', 'Segments and arrows', 'Labels', 'Sliders', '3D'.
     * An identifier: the Build tab shows each section under a heading in the reader's language.
     */
    section: string;
    /** Menu text, in the reader's language (recipes() is called when a menu opens). */
    label: string;
    /** One-line hint shown in tooltips / empty states, in the reader's language. */
    hint: string;
    /** Only offered when this is true for the current chart. */
    available(ctx: RecipeContext): boolean;
    /** Returns what to add. Uses existing names (first two functions, first region) when sensible. */
    build(ctx: RecipeContext): RecipeResult;
}

export interface RecipeContext {
    is3D: boolean;
    functions: FunctionParameters[];
    tools: Tool[];
    parameters: Parameter[];
    /**
     * v4 implementation extra: polar chart. Function bodies are r(theta)
     * there, so recipes do not reference functions as y = f(x) and fall back
     * to self-contained formulas.
     */
    polar?: boolean;
}

/**
 * v4 implementation note: the 3D 'Surface' recipe returns kind 'function'
 * with the optional `surface` set; 3D charts add `surface` to functions3D
 * (`fn` then only carries the same expression as a 2D card state).
 */
export type RecipeResult =
    | { kind: 'function'; fn: FunctionParameters; surface?: Function3DParameters }
    | { kind: 'tool'; tool: Tool }
    | { kind: 'label' }
    | { kind: 'parameter'; parameter: Parameter }
    /**
     * Optional (5.0): several items at once (data and its plot), sliders and
     * functions first; the card of `reveal` (an index into tools) opens.
     */
    | { kind: 'items'; parameters?: Parameter[]; functions?: FunctionParameters[]; tools: Tool[]; reveal?: number };

/** Every name in the chart (functions, tools, parameters). */
function chartNames(ctx: RecipeContext): string[] {
    return [...ctx.functions.map((f) => f.name || ''), ...ctx.tools.map((t) => t.name), ...ctx.parameters.map((p) => p.name)];
}

/** Names usable as f(x) in conditions: named, non-parametric functions with an expression (none in polar charts). */
function callableFunctions(ctx: RecipeContext): string[] {
    if (ctx.polar) return [];
    return ctx.functions
        .filter((f) => !f.parametric && f.name && f.expression.trim())
        .map((f) => f.name as string);
}

function firstRegion(ctx: RecipeContext): string {
    const region = ctx.tools.find((t) => t.type === 'region');
    return region ? region.name : '';
}

function toolOpts(ctx: RecipeContext): ToolOpts {
    return { is3D: ctx.is3D, tools: ctx.tools, functions: ctx.functions, parameters: ctx.parameters };
}

function regionRecipe(ctx: RecipeContext, fields: Partial<RegionBody>): RecipeResult {
    const tool: RegionTool = { ...newRegion(toolOpts(ctx)), ...fields };
    tool.conditionLabels = tool.conditions.map(() => '');
    return { kind: 'tool', tool };
}

function curveRecipe(ctx: RecipeContext, fields: Partial<CurveBody>): RecipeResult {
    return { kind: 'tool', tool: { ...newCurve(toolOpts(ctx)), ...fields } };
}

function pointsRecipe(ctx: RecipeContext, fields: Partial<PointsBody>): RecipeResult {
    return { kind: 'tool', tool: { ...newPoints(toolOpts(ctx)), ...fields } };
}

function segmentRecipe(ctx: RecipeContext, fields: Partial<SegmentBody>): RecipeResult {
    return { kind: 'tool', tool: { ...newSegment(toolOpts(ctx)), ...fields } };
}

function sliderRecipe(available: (ctx: RecipeContext) => boolean): Recipe {
    return {
        id: 'slider',
        section: 'Sliders',
        label: t('build.recipe.slider'),
        hint: t('build.recipeHint.slider'),
        available,
        build: (ctx) => ({ kind: 'parameter', parameter: defaultParameter(chartNames(ctx)) }),
    };
}

function labelRecipe(available: (ctx: RecipeContext) => boolean): Recipe {
    return {
        id: 'label',
        section: 'Labels',
        label: t('build.recipe.label'),
        hint: t('build.recipeHint.label'),
        available,
        build: () => ({ kind: 'label' }),
    };
}

function recipes2D(): Recipe[] {
    const in2D = (ctx: RecipeContext) => !ctx.is3D;
    return [
        {
            id: 'function',
            section: 'Functions',
            label: t('build.recipe.function'),
            hint: t('build.recipeHint.function'),
            available: in2D,
            build: (ctx) => ({ kind: 'function', fn: defaultFunction(chartNames(ctx), nextFunctionColor(ctx.functions)) }),
        },
        {
            id: 'parametric',
            section: 'Functions',
            label: t('build.recipe.parametric'),
            hint: t('build.recipeHint.parametric'),
            available: in2D,
            build: (ctx) => ({
                kind: 'function',
                fn: {
                    ...defaultFunction(chartNames(ctx), nextFunctionColor(ctx.functions)),
                    parametric: true,
                    expression: '3 + 2cos(t)',
                    expressionY: '2 + 1.5sin(t)',
                    domain: '0:2*pi',
                },
            }),
        },
        {
            id: 'area-between',
            section: 'Regions',
            label: t('build.recipe.areaBetween'),
            hint: t('build.recipeHint.areaBetween'),
            available: in2D,
            build: (ctx) => {
                const [f, g] = callableFunctions(ctx);
                let condition: string;
                if (f && g) condition = `${g} <= y <= ${f}`;
                else if (f) condition = `min(${f}, 0) <= y <= max(${f}, 0)`;
                else condition = 'x^2 / 8 <= y <= sqrt(2x)';
                return regionRecipe(ctx, { conditions: [condition] });
            },
        },
        {
            id: 'area-under',
            section: 'Regions',
            label: t('build.recipe.areaUnder'),
            hint: t('build.recipeHint.areaUnder'),
            available: in2D,
            build: (ctx) => {
                const f = callableFunctions(ctx)[0] || '(2 + sin(x))';
                return regionRecipe(ctx, { conditions: [`min(0, ${f}) <= y <= max(0, ${f})`, '1 <= x <= 4'] });
            },
        },
        {
            id: 'feasible-region',
            section: 'Regions',
            label: t('build.recipe.feasibleRegion'),
            hint: t('build.recipeHint.feasibleRegion'),
            available: in2D,
            build: (ctx) => regionRecipe(ctx, { conditions: ['x >= 0', 'y >= 0', ''], constraintLines: true }),
        },
        {
            id: 'rectangle',
            section: 'Regions',
            label: t('build.recipe.rectangle'),
            hint: t('build.recipeHint.rectangle'),
            available: in2D,
            build: (ctx) => regionRecipe(ctx, { conditions: ['1 <= x <= 4', '1 <= y <= 3'], outline: 'solid' }),
        },
        {
            id: 'disk',
            section: 'Regions',
            label: t('build.recipe.disk'),
            hint: t('build.recipeHint.disk'),
            available: in2D,
            build: (ctx) => regionRecipe(ctx, { conditions: ['(x - 3)^2 + (y - 2)^2 <= 2^2'], outline: 'solid' }),
        },
        {
            id: 'vertical-line',
            section: 'Curves and lines',
            label: t('build.recipe.verticalLine'),
            hint: t('build.recipeHint.verticalLine'),
            available: in2D,
            build: (ctx) => curveRecipe(ctx, { equation: 'x = 2', dashed: true, color: 'gray' }),
        },
        {
            id: 'horizontal-line',
            section: 'Curves and lines',
            label: t('build.recipe.horizontalLine'),
            hint: t('build.recipeHint.horizontalLine'),
            available: in2D,
            build: (ctx) => curveRecipe(ctx, { equation: 'y = 2', dashed: true, color: 'gray' }),
        },
        {
            id: 'line-equation',
            section: 'Curves and lines',
            label: t('build.recipe.lineEquation'),
            hint: t('build.recipeHint.lineEquation'),
            available: in2D,
            build: (ctx) => curveRecipe(ctx, { equation: '2x + 3y = 12' }),
        },
        {
            id: 'circle',
            section: 'Curves and lines',
            label: t('build.recipe.circle'),
            hint: t('build.recipeHint.circle'),
            available: in2D,
            build: (ctx) => curveRecipe(ctx, { equation: '(x - 3)^2 + (y - 2)^2 = 2^2' }),
        },
        {
            id: 'level-curves',
            section: 'Curves and lines',
            label: t('build.recipe.levelCurves'),
            hint: t('build.recipeHint.levelCurves'),
            available: in2D,
            build: (ctx) => curveRecipe(ctx, { equation: 'x*y', levels: '2, 4, 8', label: '{level}', color: 'purple' }),
        },
        {
            id: 'points-list',
            section: 'Points',
            label: t('build.recipe.pointsList'),
            hint: t('build.recipeHint.pointsList'),
            available: in2D,
            build: (ctx) => pointsRecipe(ctx, { points: '(1, 1); (2, 3); (4, 2)' }),
        },
        {
            id: 'intersections',
            section: 'Points',
            label: t('build.recipe.intersections'),
            hint: t('build.recipeHint.intersections'),
            available: in2D,
            build: (ctx) => {
                const refs = [...callableFunctions(ctx), ...ctx.tools.filter((t) => t.type === 'curve').map((t) => t.name)];
                return pointsRecipe(ctx, {
                    source: 'intersections',
                    ref1: refs[0] || '',
                    ref2: refs[1] || '',
                    label: '({x:2}, {y:2})',
                });
            },
        },
        {
            id: 'corner-points',
            section: 'Points',
            label: t('build.recipe.cornerPoints'),
            hint: t('build.recipeHint.cornerPoints'),
            available: in2D,
            build: (ctx) => pointsRecipe(ctx, { source: 'region', regionName: firstRegion(ctx), label: '({x}, {y})' }),
        },
        {
            id: 'optimum',
            section: 'Points',
            label: t('build.recipe.optimum'),
            hint: t('build.recipeHint.optimum'),
            available: in2D,
            build: (ctx) =>
                pointsRecipe(ctx, {
                    source: 'region',
                    regionName: firstRegion(ctx),
                    objective: '2x + 3y',
                    sense: 'max',
                    label: '({x:2}, {y:2})',
                    size: 'large',
                }),
        },
        {
            id: 'lattice',
            section: 'Points',
            label: t('build.recipe.lattice'),
            hint: t('build.recipeHint.lattice'),
            available: in2D,
            build: (ctx) => pointsRecipe(ctx, { source: 'lattice', regionName: firstRegion(ctx), size: 'small' }),
        },
        {
            id: 'segment',
            section: 'Segments and arrows',
            label: t('build.recipe.segment'),
            hint: t('build.recipeHint.segment'),
            available: in2D,
            build: (ctx) => segmentRecipe(ctx, { path: '(1, 1); (4, 3)' }),
        },
        {
            id: 'arrow',
            section: 'Segments and arrows',
            label: t('build.recipe.arrow'),
            hint: t('build.recipeHint.arrow'),
            available: in2D,
            build: (ctx) => segmentRecipe(ctx, { path: '(1, 1); (3, 3)', style: 'forward' }),
        },
        {
            id: 'polyline',
            section: 'Segments and arrows',
            label: t('build.recipe.polyline'),
            hint: t('build.recipeHint.polyline'),
            available: in2D,
            build: (ctx) => segmentRecipe(ctx, { path: '(1, 1); (4, 1); (3, 3)', closed: true }),
        },
        {
            id: 'brace',
            section: 'Segments and arrows',
            label: t('build.recipe.brace'),
            hint: t('build.recipeHint.brace'),
            available: in2D,
            build: (ctx) => segmentRecipe(ctx, { path: '(1, 1); (4, 1)', style: 'brace', label: 'width' }),
        },
        ...beyondRecipes(in2D),
        ...motionRecipes(in2D), // 6.0 C
        // 6.0 B
        ...notes6Recipes(in2D, {
            identity: (type, ctx) => identity(type, toolOpts(ctx)),
            newFunction: (ctx, expression) => ({ ...defaultFunction(chartNames(ctx), nextFunctionColor(ctx.functions)), expression }),
            callable: callableFunctions,
            names: chartNames,
        }),
        // 6.0 A
        ...valueRecipes(in2D, false),
        // 6.0 D
        ...linearRecipes(in2D, { identity: (type, ctx) => identity(type, toolOpts(ctx)), names: chartNames }, false),
        // 6.0 E
        ...iterateRecipes(in2D, {
            tool: (type, ctx) => defaultTool(type as ToolType, toolOpts(ctx)),
            newFunction: (ctx, expression) => ({ ...defaultFunction(chartNames(ctx), nextFunctionColor(ctx.functions)), expression }),
            callable: callableFunctions,
            names: chartNames,
        }),
        // 6.0 G
        ...geogebraRecipes(in2D, { tool: (type, ctx) => defaultTool(type as ToolType, toolOpts(ctx)), names: chartNames }),
        // 6.0 P
        ...pythonRecipes(in2D, (type, ctx) => defaultTool(type as ToolType, toolOpts(ctx)), chartNames),
        labelRecipe(in2D),
        sliderRecipe(in2D),
    ];
}

// 6.0 C ---------------------------------------------------------- motion

/** A point to drag for a new solution, called P when that name is free. */
function dragPoint(ctx: RecipeContext, at: string, dim: 2 | 3): PointsTool {
    const point: PointsTool = { ...newPoints(toolOpts(ctx)), dim, points: at, size: 'large' };
    if (!chartNames(ctx).includes('P')) point.name = 'P';
    return point;
}

/** A new vector field, called F when that name is free. */
function newField(ctx: RecipeContext, fields: Partial<VectorFieldTool>): VectorFieldTool {
    const field: VectorFieldTool = { ...vectorFieldDefaults(), ...identity('vectorField', toolOpts(ctx)), expression: '(y, -sin(x) - 0.25y)', ...fields };
    if (!chartNames(ctx).includes('F')) field.name = 'F';
    return field;
}

/** The recipes of vector fields, rest points and solutions of systems (2D). */
function motionRecipes(in2D: (ctx: RecipeContext) => boolean): Recipe[] {
    return [
        {
            id: 'vector-field',
            section: 'Motion',
            label: t('motion6.recipe.vectorField'),
            hint: t('motion6.recipeHint.vectorField'),
            available: in2D,
            build: (ctx) => ({ kind: 'tool', tool: newField(ctx, {}) }),
        },
        {
            id: 'vector-field-particles',
            section: 'Motion',
            label: t('motion6.recipe.particles'),
            hint: t('motion6.recipeHint.particles'),
            available: in2D,
            build: (ctx) => ({ kind: 'tool', tool: newField(ctx, { particles: true }) }),
        },
        {
            id: 'rest-points',
            section: 'Motion',
            label: t('motion6.recipe.restPoints'),
            hint: t('motion6.recipeHint.restPoints'),
            available: in2D,
            build: (ctx) => {
                const fields = ctx.tools.filter((x) => x.type === 'vectorField');
                const field = fields.length ? null : newField(ctx, {});
                const c = withTools(ctx, field ? [field] : []);
                const rest: RestPointsTool = { ...restPointsDefaults(), ...identity('restPoints', toolOpts(c)), field: field ? field.name : fields[fields.length - 1].name };
                return field ? { kind: 'items', tools: [field, rest], reveal: 1 } : { kind: 'tool', tool: rest };
            },
        },
        {
            id: 'trajectory',
            section: 'Motion',
            label: t('motion6.recipe.trajectory'),
            hint: t('motion6.recipeHint.trajectory'),
            available: in2D,
            build: (ctx) => {
                const point = dragPoint(ctx, '(1, 0)', 2);
                const c = withTools(ctx, [point]);
                const solution: TrajectoryTool = { ...trajectoryDefaults(2), ...identity('trajectory', toolOpts(c)), expression: '(y, -x)', through: point.name };
                return { kind: 'items', tools: [point, solution], reveal: 1 };
            },
        },
    ];
}

// ------------------------------------------------- beyond functions (5.0)

/** Sample data for a new data set typed in the chart. */
const SAMPLE_DATA = '(1, 52); (2, 55); (3, 61); (4, 60); (5, 68)';

/** A chart's data sets, and a context whose names include the new tools so far (each new tool takes a name of its own). */
function withTools(ctx: RecipeContext, tools: Tool[]): RecipeContext {
    return { ...ctx, tools: [...ctx.tools, ...tools] };
}

/** The recipes of data, probability, Riemann sums and slope fields (2D). */
function beyondRecipes(in2D: (ctx: RecipeContext) => boolean): Recipe[] {
    return [
        {
            id: 'data-table',
            section: 'Data',
            label: t('beyond.recipe.dataTable'),
            hint: t('beyond.recipeHint.dataTable'),
            available: in2D,
            build: (ctx) => {
                const data = newData(toolOpts(ctx));
                const plot: DataPlotTool = { ...newDataPlot(toolOpts(withTools(ctx, [data]))), data: data.name };
                return { kind: 'items', tools: [data, plot], reveal: 0 };
            },
        },
        {
            id: 'data-points',
            section: 'Data',
            label: t('beyond.recipe.dataPoints'),
            hint: t('beyond.recipeHint.dataPoints'),
            available: in2D,
            build: (ctx) => {
                const data: DataTool = { ...newData(toolOpts(ctx)), source: 'list', points: SAMPLE_DATA };
                const plot: DataPlotTool = { ...newDataPlot(toolOpts(withTools(ctx, [data]))), data: data.name };
                return { kind: 'items', tools: [data, plot], reveal: 0 };
            },
        },
        {
            id: 'regression',
            section: 'Data',
            label: t('beyond.recipe.regression'),
            hint: t('beyond.recipeHint.regression'),
            available: in2D,
            build: (ctx) => {
                const existing = ctx.tools.filter((x) => x.type === 'data');
                const regression = (c: RecipeContext, data: string): DataPlotTool => ({
                    ...newDataPlot(toolOpts(c)),
                    data,
                    style: 'regression',
                    color: 'red',
                    valueLabel: true,
                });
                if (existing.length) return { kind: 'tool', tool: regression(ctx, existing[existing.length - 1].name) };
                const data: DataTool = { ...newData(toolOpts(ctx)), source: 'list', points: SAMPLE_DATA };
                const points: DataPlotTool = { ...newDataPlot(toolOpts(withTools(ctx, [data]))), data: data.name };
                return { kind: 'items', tools: [data, points, regression(withTools(ctx, [data, points]), data.name)], reveal: 2 };
            },
        },
        {
            id: 'normal-distribution',
            section: 'Probability',
            label: t('beyond.recipe.normal'),
            hint: t('beyond.recipeHint.normal'),
            available: in2D,
            build: (ctx) => ({ kind: 'tool', tool: newDistribution(toolOpts(ctx)) }),
        },
        {
            id: 'binomial-distribution',
            section: 'Probability',
            label: t('beyond.recipe.binomial'),
            hint: t('beyond.recipeHint.binomial'),
            available: in2D,
            build: (ctx) => ({ kind: 'tool', tool: { ...newDistribution(toolOpts(ctx)), kind: 'binomial', n: '10', p: '0.4' } }),
        },
        {
            id: 'probability',
            section: 'Probability',
            label: t('beyond.recipe.probability'),
            hint: t('beyond.recipeHint.probability'),
            available: in2D,
            build: (ctx) => {
                const shade = (c: RecipeContext, dist: Tool): ProbabilityTool => ({
                    ...newProbability(toolOpts(c)),
                    distribution: dist.name,
                    event: dist.type === 'distribution' && dist.kind === 'binomial' ? 'X <= 3' : '-1 <= X <= 1',
                    valueLabel: true,
                });
                const existing = ctx.tools.filter((x) => x.type === 'distribution');
                if (existing.length) return { kind: 'tool', tool: shade(ctx, existing[existing.length - 1]) };
                const dist = newDistribution(toolOpts(ctx));
                return { kind: 'items', tools: [dist, shade(withTools(ctx, [dist]), dist)], reveal: 1 };
            },
        },
        {
            id: 'riemann-sum',
            section: 'Calculus',
            label: t('beyond.recipe.riemann'),
            hint: t('beyond.recipeHint.riemann'),
            available: in2D,
            build: (ctx) => {
                // The number of parts on a slider n, when the name is free: the usual way to watch the sum close in.
                const taken = new Set(chartNames(ctx));
                const n = taken.has('n') ? null : { name: 'n', value: 6, min: 1, max: 40, step: 1 };
                const own = callableFunctions(ctx).find((name) => !ctx.functions.find((f) => f.name === name)?.hidden);
                const fn = own ? null : { ...defaultFunction(chartNames(ctx), nextFunctionColor(ctx.functions)), expression: 'x^2 / 4 + 1' };
                const c: RecipeContext = fn ? { ...ctx, functions: [...ctx.functions, fn] } : ctx;
                const sum: RiemannTool = { ...newRiemann(toolOpts(c)), function: own ?? fn?.name ?? '', from: '0', to: '4', parts: n ? 'n' : '6', valueLabel: true };
                if (!fn && !n) return { kind: 'tool', tool: sum };
                return { kind: 'items', parameters: n ? [n] : [], functions: fn ? [fn] : [], tools: [sum] };
            },
        },
        {
            id: 'slope-field',
            section: 'Calculus',
            label: t('beyond.recipe.slopeField'),
            hint: t('beyond.recipeHint.slopeField'),
            available: in2D,
            build: (ctx) => ({ kind: 'tool', tool: { ...newSlopeField(toolOpts(ctx)), expression: 'x - y' } }),
        },
        {
            id: 'solution',
            section: 'Calculus',
            label: t('beyond.recipe.solution'),
            hint: t('beyond.recipeHint.solution'),
            available: in2D,
            build: (ctx) => {
                const fields = ctx.tools.filter((x) => x.type === 'slopeField');
                const field: SlopeFieldTool | null = fields.length ? null : { ...newSlopeField(toolOpts(ctx)), expression: 'x - y' };
                const c1 = withTools(ctx, field ? [field] : []);
                // A point to drag, called P when that name is free.
                const point: PointsTool = { ...newPoints(toolOpts(c1)), points: '(0, 1)', size: 'large' };
                if (!chartNames(c1).includes('P')) point.name = 'P';
                const c2 = withTools(c1, [point]);
                const fieldName = field ? field.name : fields[fields.length - 1].name;
                const solution: SolutionTool = { ...newSolution(toolOpts(c2)), field: fieldName, through: point.name };
                return { kind: 'items', tools: [...(field ? [field] : []), point, solution], reveal: field ? 2 : 1 };
            },
        },
    ];
}

// ------------------------------------------------------------ values (6.0 A)

/** A free name for a new definition: the first of `wanted` no name of the chart has, else the next L1, L2, ... */
function freeName(ctx: RecipeContext, wanted: string[]): string | null {
    const taken = new Set(chartNames(ctx));
    return wanted.find((n) => !taken.has(n)) ?? null;
}

/** The recipes of let definitions, vector arrows and (2D) points of a list. */
function valueRecipes(available: (ctx: RecipeContext) => boolean, is3D: boolean): Recipe[] {
    const all: Recipe[] = [
        {
            id: 'let-definition',
            section: 'Values',
            label: t('values.recipe.let'),
            hint: t('values.recipeHint.let'),
            available,
            build: (ctx) => {
                const tool = { ...newValue(toolOpts(ctx)), expression: ctx.is3D ? '(1, 2, 2)' : '(2, 1)' };
                tool.name = freeName(ctx, ['v', 'w', 'u']) ?? tool.name;
                return { kind: 'tool', tool };
            },
        },
        {
            id: 'vector-arrow',
            section: 'Values',
            label: t('values.recipe.vector'),
            hint: t('values.recipeHint.vector'),
            available,
            build: (ctx) => {
                // The vector of the chart's first definition, else a new one called v.
                const existing = ctx.tools.find((x) => x.type === 'value' && !x.params.trim());
                const def: ValueTool | null = existing ? null : { ...newValue(toolOpts(ctx)), expression: ctx.is3D ? '(1, 2, 2)' : '(2, 1)' };
                if (def) def.name = freeName(ctx, ['v', 'w', 'u']) ?? def.name;
                const c = withTools(ctx, def ? [def] : []);
                const arrow: VectorTool = { ...newVector(toolOpts(c)), vectors: (existing ?? def)?.name ?? '', valueLabel: true };
                return def ? { kind: 'items', tools: [def, arrow], reveal: 1 } : { kind: 'tool', tool: arrow };
            },
        },
        {
            id: 'list-points',
            section: 'Values',
            label: t('values.recipe.listPoints'),
            hint: t('values.recipeHint.listPoints'),
            available,
            build: (ctx) => {
                const n = chartNames(ctx).includes('n') ? null : { name: 'n', value: 6, min: 3, max: 16, step: 1 };
                const tool: ListPointsTool = { ...newListPoints(toolOpts(ctx)), points: `\\{e^{2\\pi i k / ${n ? 'n' : '6'}} : k = 0, \\dots, ${n ? 'n' : '6'} - 1\\}`, joined: true };
                return { kind: 'items', parameters: n ? [n] : [], tools: [tool] };
            },
        },
    ];
    return is3D ? all.filter((r) => r.id !== 'list-points') : all;
}

function recipes3D(): Recipe[] {
    const in3D = (ctx: RecipeContext) => ctx.is3D;
    return [
        {
            id: 'surface',
            section: 'Functions',
            label: t('build.recipe.surface'),
            hint: t('build.recipeHint.surface'),
            available: in3D,
            build: (ctx) => ({
                kind: 'function',
                fn: defaultFunction(chartNames(ctx), 'blue'),
                surface: {
                    expression: '',
                    xDomain: '-5:5',
                    yDomain: '-5:5',
                    color: 'blue',
                    wireframe: false,
                    opacity: 0.7,
                    samples: 40,
                },
            }),
        },
        {
            id: 'plane',
            section: '3D',
            label: t('build.recipe.plane'),
            hint: t('build.recipeHint.plane'),
            available: in3D,
            build: (ctx) => ({ kind: 'tool', tool: newPlane(toolOpts(ctx)) }),
        },
        {
            id: 'point',
            section: '3D',
            label: t('build.recipe.point'),
            hint: t('build.recipeHint.point'),
            available: in3D,
            build: (ctx) => pointsRecipe(ctx, { dim: 3, points: '(1, 1, 1)' }),
        },
        {
            id: 'segment',
            section: '3D',
            label: t('build.recipe.segment3D'),
            hint: t('build.recipeHint.segment3D'),
            available: in3D,
            build: (ctx) => segmentRecipe(ctx, { dim: 3, path: '(0, 0, 0); (1, 1, 1)' }),
        },
        {
            id: 'arrow',
            section: '3D',
            label: t('build.recipe.arrow'),
            hint: t('build.recipeHint.arrow3D'),
            available: in3D,
            build: (ctx) => segmentRecipe(ctx, { dim: 3, path: '(0, 0, 0); (1, 1, 1)', style: 'forward' }),
        },
        // 6.0 C: the solution of a 3D system
        {
            id: 'trajectory-3d',
            section: '3D',
            label: t('motion6.recipe.trajectory3d'),
            hint: t('motion6.recipeHint.trajectory3d'),
            available: in3D,
            build: (ctx) => ({
                kind: 'tool',
                tool: {
                    ...trajectoryDefaults(3),
                    ...identity('trajectory', toolOpts(ctx)),
                    expression: '(10(y - x), x(28 - z) - y, xy - 8z/3)',
                    through: '(1, 1, 1)',
                    to: '40',
                    thickness: 'thin',
                    colormap: 'viridis',
                },
            }),
        },
        // 6.0 A
        ...valueRecipes(in3D, true),
        // 6.0 D
        ...linearRecipes(in3D, { identity: (type, ctx) => identity(type, toolOpts(ctx)), names: chartNames }, true),
        labelRecipe(in3D),
        sliderRecipe(in3D),
    ];
}

/**
 * Recipes (2D): Function, Parametric curve; Area between two functions
 * (f2 <= y <= f1), Area under a function (0 <= y <= f1, i.e. min/max form),
 * Feasible region (x >= 0; y >= 0; one empty row), Rectangle, Disk;
 * Vertical line x = c, Horizontal line y = c, Line from equation
 * (2x + 3y = 12), Circle, Level curves of F(x, y); Points from a list,
 * Intersections of two functions, Corner points of a region, Optimum over a
 * region, Integer points in a region; Line, Arrow, Polyline / polygon,
 * Brace with label; Text label; Slider. (3D): Surface, Plane, Point, Segment,
 * Arrow, Text label, Slider.
 *
 * Recipes that need a function or region use the chart's first ones; without
 * them the area recipes fall back to explicit formulas, while points recipes
 * leave the reference blank (the card then asks for the missing item).
 */
export function recipes(is3D: boolean): Recipe[] {
    return is3D ? recipes3D() : recipes2D();
}

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

/** Whole-chart starter example (data is a v4 settings object accepted by SettingsManager.fromJSON). */
export interface ChartExample {
    id: string;
    /** Title and description in the reader's language, read when shown; the chart in `data` stays English. */
    title: string;
    description: string;
    is3D: boolean;
    data: Record<string, unknown>;
}

/** Every key a chart stores, with the v4 defaults; examples override what they need. */
function exampleChart(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
        v: SCHEMA_VERSION,
        dimension: false,
        documentSetup: true,
        title: '',
        size_x_cm: 10,
        size_y_cm: 8,
        show_axis_label: true,
        axis_label_x: 'x',
        axis_label_y: 'y',
        showAxis: true,
        showLargeGrid: 'auto', // 6.1: the chart look decides
        showSmallGrid: false,
        gridOpacity: GRID_OPACITY,
        gridSize: 5,
        majorTickNum: 8,
        xmin: '-0.5',
        xmax: '10',
        ymin: '-0.5',
        ymax: '5',
        zmin: '-5',
        zmax: '5',
        axis_style: 'auto', // 6.1: the chart look decides
        look: 'auto',
        coordinateSystem: 'cartesian',
        axis_label_x_polar: '',
        axis_label_y_polar: '',
        axis_label_z: 'z',
        rotationX: 30,
        rotationZ: 45,
        zoom3D: 1,
        boxAspect: 'true',
        previewSize: 760,
        functions: [],
        functions3D: [],
        tools: [],
        annotations: [],
        parameters: [],
        variables: 'x, y',
        equalScale: false,
        showSlidersInNote: true,
        ...overrides,
    };
}

function exFunction(name: string, expression: string, fields: Partial<FunctionParameters>): FunctionParameters {
    return { ...functionDefaults(), name, expression, ...fields };
}

function exRegion(id: string, name: string, fields: Partial<RegionBody>): RegionTool {
    const tool: RegionTool = { ...regionDefaults(), id, name, ...fields };
    if (!fields.conditionLabels) tool.conditionLabels = tool.conditions.map(() => '');
    return tool;
}

function exCurve(id: string, name: string, fields: Partial<CurveBody>): CurveTool {
    return { ...curveDefaults(), id, name, ...fields };
}

function exPoints(id: string, name: string, fields: Partial<PointsBody>): PointsTool {
    return { ...pointsDefaults(2), id, name, ...fields };
}

/**
 * Starter examples, each verified to render and export:
 * 1. 'lp' Linear program: slider c 0..15 = 9; R1 conditions
 *    ['x + y <= 4', 'x + 3y <= 6', 'x >= 0', 'y >= 0'] blue fill 0.25,
 *    constraintLines on with labels; C1 '2x + 3y = c' red dashed label
 *    'z = {c}'; P1 region source over R1, objective '2x + 3y' max, label
 *    'x* = ({x:2}, {y:2})'; P2 region corners over R1, label '({x}, {y})';
 *    view 0..5 by 0..4.5, axis style 'axes'.
 * 2. 'areas' Areas between two curves: f1 sin(x), f2 cos(x) on 0:2*pi;
 *    R1 'f2 <= y <= f1' + '0 <= x <= 2pi' blue label 'A1'; R2
 *    'f1 <= y <= f2' + same x range orange label 'A2'; P1 intersections f1 f2.
 * 3. 'tangent' Tangent explorer: slider a -2..2; f1 'x^3 - 3x' tangent at a, extrema on;
 *    the live slope is the chart title (a tangent that sweeps the plot would run through
 *    any text inside it).
 * 4. 'levels' Level curves + constraint: C1 'x^2 + y^2' levels '1, 3.2, 6'
 *    with label '{level}'; R1 'x + 2y >= 4' light fill; P1 region R1 objective
 *    'x^2 + y^2' min; C2 'x^2 + y^2' levels 'P1_val' dashed (touches P1).
 * 5. 'surplus' Market equilibrium: demand f1 '10 - a*x', supply f2 '2 + x',
 *    slider a; P1 intersections f1 f2; R1 'P1_y <= y <= f1', '0 <= x <= P1_x'
 *    (consumer surplus); R2 'f2 <= y <= P1_y', '0 <= x <= P1_x' (producer surplus).
 * 6. 'plane3d' (3D) Surface x^2 + y^2 cut by plane z = h, slider h 0..8.
 *
 * Checked by hand: in 'lp' the corners are (0, 0), (4, 0), (3, 1), (0, 2) and
 * 2x + 3y is largest at (3, 1) with value 9 (the start value of c). In
 * 'levels' the point of x + 2y >= 4 closest to the origin is (0.8, 1.6) with
 * x^2 + y^2 = 3.2. In 'surplus' the equilibrium is (8 / (1 + a), 10 - a * 8 / (1 + a)),
 * (4, 6) at a = 1, inside the view for the whole slider range.
 */
export const EXAMPLES: ChartExample[] = [
    {
        id: 'lp',
        get title() {
            return t('build.example.lpTitle');
        },
        get description() {
            return t('build.example.lpDescription');
        },
        is3D: false,
        data: exampleChart({
            xmin: '0',
            xmax: '5',
            ymin: '0',
            ymax: '4.5',
            size_y_cm: 9,
            axis_style: 'axes',
            showLargeGrid: true,
            parameters: [{ name: 'c', value: 9, min: 0, max: 15, step: 0.1 }],
            tools: [
                exRegion('t0', 'R1', {
                    color: 'blue',
                    conditions: ['x + y <= 4', 'x + 3y <= 6', 'x >= 0', 'y >= 0'],
                    conditionLabels: ['(1)', '(2)', '', ''],
                    constraintLines: true,
                }),
                exCurve('t1', 'C1', { equation: '2x + 3y = c', color: 'red', dashed: true, thickness: 'thick', label: 'z = {c}' }),
                // Corners before the optimum so the optimum marker is drawn on top.
                exPoints('t2', 'P2', { source: 'region', regionName: 'R1', color: 'blue', label: '({x}, {y})' }),
                exPoints('t3', 'P1', {
                    source: 'region',
                    regionName: 'R1',
                    objective: '2x + 3y',
                    sense: 'max',
                    color: 'red',
                    size: 'large',
                    label: 'x* = ({x:2}, {y:2})',
                }),
            ],
        }),
    },
    {
        id: 'areas',
        get title() {
            return t('build.example.areasTitle');
        },
        get description() {
            return t('build.example.areasDescription');
        },
        is3D: false,
        data: exampleChart({
            xmin: '-0.5',
            xmax: '7',
            ymin: '-1.5',
            ymax: '2',
            size_x_cm: 12,
            size_y_cm: 6,
            axis_style: 'middle',
            functions: [
                exFunction('f1', 'sin(x)', { domain: '0:2*pi', showLegend: true, thickness: 'thick' }),
                exFunction('f2', 'cos(x)', { domain: '0:2*pi', showLegend: true, thickness: 'thick', color: 'gray' }),
            ],
            tools: [
                exRegion('t0', 'R1', { color: 'blue', conditions: ['f2 <= y <= f1', '0 <= x <= 2pi'], label: 'A1' }),
                exRegion('t1', 'R2', { color: 'orange', conditions: ['f1 <= y <= f2', '0 <= x <= 2pi'], label: 'A2' }),
                exPoints('t2', 'P1', { source: 'intersections', ref1: 'f1', ref2: 'f2', color: 'black' }),
            ],
        }),
    },
    {
        id: 'tangent',
        get title() {
            return t('build.example.tangentTitle');
        },
        get description() {
            return t('build.example.tangentDescription');
        },
        is3D: false,
        data: exampleChart({
            title: 'slope at x = {a}: {3a^2 - 3:2}',
            xmin: '-3',
            xmax: '3',
            ymin: '-4',
            ymax: '4',
            axis_style: 'middle',
            parameters: [{ name: 'a', value: 0.5, min: -2, max: 2, step: 0.05 }],
            functions: [
                exFunction('f1', 'x^3 - 3x', {
                    color: 'blue',
                    thickness: 'thick',
                    tangent: true,
                    tangentPoint: 'a',
                    extrema: true,
                }),
            ],
        }),
    },
    {
        id: 'levels',
        get title() {
            return t('build.example.levelsTitle');
        },
        get description() {
            return t('build.example.levelsDescription');
        },
        is3D: false,
        data: exampleChart({
            xmin: '-0.5',
            xmax: '4.5',
            ymin: '-0.5',
            ymax: '3.5',
            axis_style: 'middle',
            equalScale: true,
            tools: [
                exCurve('t0', 'C1', { equation: 'x^2 + y^2', levels: '1, 3.2, 6', color: 'gray', label: '{level}' }),
                exRegion('t1', 'R1', {
                    color: 'blue',
                    conditions: ['x + 2y >= 4'],
                    fillOpacity: 0.15,
                    constraintLines: true,
                    label: '$x + 2y \\ge 4$',
                }),
                exPoints('t2', 'P1', {
                    source: 'region',
                    regionName: 'R1',
                    objective: 'x^2 + y^2',
                    sense: 'min',
                    color: 'red',
                    size: 'large',
                    label: 'x* = ({x:2}, {y:2})',
                }),
                exCurve('t3', 'C2', { equation: 'x^2 + y^2', levels: 'P1_val', color: 'red', dashed: true, thickness: 'thick' }),
            ],
        }),
    },
    {
        id: 'surplus',
        get title() {
            return t('build.example.surplusTitle');
        },
        get description() {
            return t('build.example.surplusDescription');
        },
        is3D: false,
        data: exampleChart({
            xmin: '0',
            xmax: '12',
            ymin: '0',
            ymax: '11',
            axis_style: 'axes',
            axis_label_x: 'Quantity',
            axis_label_y: 'Price',
            parameters: [{ name: 'a', value: 1, min: 0.5, max: 3, step: 0.05 }],
            functions: [
                exFunction('f1', '10 - a*x', { color: 'blue', thickness: 'thick', showLegend: true, legendLabel: 'Demand' }),
                exFunction('f2', '2 + x', { color: 'orange', thickness: 'thick', showLegend: true, legendLabel: 'Supply' }),
            ],
            tools: [
                exPoints('t0', 'P1', { source: 'intersections', ref1: 'f1', ref2: 'f2', color: 'black', dropLines: true }),
                exRegion('t1', 'R1', { color: 'blue', conditions: ['P1_y <= y <= f1', '0 <= x <= P1_x'], label: 'CS' }),
                exRegion('t2', 'R2', { color: 'orange', conditions: ['f2 <= y <= P1_y', '0 <= x <= P1_x'], label: 'PS' }),
            ],
        }),
    },
    {
        id: 'plane3d',
        get title() {
            return t('build.example.plane3dTitle');
        },
        get description() {
            return t('build.example.plane3dDescription');
        },
        is3D: true,
        data: exampleChart({
            dimension: true,
            xmin: '-2',
            xmax: '2',
            ymin: '-2',
            ymax: '2',
            zmin: '0',
            zmax: '8',
            boxAspect: 'equal',
            parameters: [{ name: 'h', value: 3, min: 0, max: 8, step: 0.1 }],
            functions3D: [
                {
                    expression: 'x^2 + y^2',
                    xDomain: '-2:2',
                    yDomain: '-2:2',
                    color: 'blue',
                    wireframe: false,
                    opacity: 0.8,
                    samples: 30,
                    name: 'f1',
                },
            ],
            tools: [{ ...planeDefaults(), id: 't0', name: 'PL1', value: 'h', fillOpacity: 0.35 }],
            annotations: [{ x: '2', y: '-2', z: 'h', text: 'z = {h}', color: 'orange', size: 'normal', anchor: 'right' }],
        }),
    },
];
