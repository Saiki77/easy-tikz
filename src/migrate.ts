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
import { dollarMath, splitDomain } from './expr';
import {
    Annotation,
    AnnotationAnchor,
    AnnotationSize,
    ArrowStyle,
    CurveTool,
    FillPattern,
    Function3DParameters,
    FunctionParameters,
    MarkerSize,
    OutlineStyle,
    Parameter,
    PlaneTool,
    PointsTool,
    RegionTool,
    SegmentStyle,
    SegmentTool,
    Tool,
    ToolType,
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
        thickness: 'thin',
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
        if (isValidName(entry.name) && !taken.has(entry.name)) {
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
        if (typeof src.name === 'string') surface.name = src.name;
        if (src.hidden === true) surface.hidden = true;
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

    const pending: { index: number; type: ToolType; body: ToolBody; hidden: boolean; id: string; name: string }[] = [];
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
        default:
            return null;
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
        out.push({ name, value, min, max, step });
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
    }
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/** A pre-filled item offered in the Build tab's Add menus. */
export interface Recipe {
    id: string;
    /** Menu section: 'Functions', 'Regions', 'Curves and lines', 'Points', 'Segments and arrows', 'Labels', 'Sliders', '3D'. */
    section: string;
    label: string;
    /** One-line hint shown in tooltips / empty states. */
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
    | { kind: 'parameter'; parameter: Parameter };

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
        label: 'Slider',
        hint: 'A named number you can drag and use in any formula, range or label.',
        available,
        build: (ctx) => ({ kind: 'parameter', parameter: defaultParameter(chartNames(ctx)) }),
    };
}

function labelRecipe(available: (ctx: RecipeContext) => boolean): Recipe {
    return {
        id: 'label',
        section: 'Labels',
        label: 'Text label',
        hint: 'Text at a point. Use $...$ for math and {a} to show a value.',
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
            label: 'Function y = f(x)',
            hint: 'A curve given by a formula in x, such as x^2 - 2x.',
            available: in2D,
            build: (ctx) => ({ kind: 'function', fn: defaultFunction(chartNames(ctx), nextFunctionColor(ctx.functions)) }),
        },
        {
            id: 'parametric',
            section: 'Functions',
            label: 'Parametric curve x(t), y(t)',
            hint: 'A curve traced by x(t) and y(t), such as an ellipse or a spiral.',
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
            label: 'Area between two functions',
            hint: 'Shades where the second function lies below the first (f2 <= y <= f1).',
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
            label: 'Area under a function',
            hint: 'Shades between a function and the x-axis over an interval.',
            available: in2D,
            build: (ctx) => {
                const f = callableFunctions(ctx)[0] || '(2 + sin(x))';
                return regionRecipe(ctx, { conditions: [`min(0, ${f}) <= y <= max(0, ${f})`, '1 <= x <= 4'] });
            },
        },
        {
            id: 'feasible-region',
            section: 'Regions',
            label: 'Feasible region (inequalities)',
            hint: 'Shades where every inequality holds, such as x + y <= 4. Add one per row.',
            available: in2D,
            build: (ctx) => regionRecipe(ctx, { conditions: ['x >= 0', 'y >= 0', ''], constraintLines: true }),
        },
        {
            id: 'rectangle',
            section: 'Regions',
            label: 'Rectangle',
            hint: 'A box a <= x <= b, c <= y <= d.',
            available: in2D,
            build: (ctx) => regionRecipe(ctx, { conditions: ['1 <= x <= 4', '1 <= y <= 3'], outline: 'solid' }),
        },
        {
            id: 'disk',
            section: 'Regions',
            label: 'Disk',
            hint: 'The inside of a circle with centre (a, b) and radius r.',
            available: in2D,
            build: (ctx) => regionRecipe(ctx, { conditions: ['(x - 3)^2 + (y - 2)^2 <= 2^2'], outline: 'solid' }),
        },
        {
            id: 'vertical-line',
            section: 'Curves and lines',
            label: 'Vertical line x = c',
            hint: 'A straight line at a fixed x value.',
            available: in2D,
            build: (ctx) => curveRecipe(ctx, { equation: 'x = 2', dashed: true, color: 'gray' }),
        },
        {
            id: 'horizontal-line',
            section: 'Curves and lines',
            label: 'Horizontal line y = c',
            hint: 'A straight line at a fixed y value.',
            available: in2D,
            build: (ctx) => curveRecipe(ctx, { equation: 'y = 2', dashed: true, color: 'gray' }),
        },
        {
            id: 'line-equation',
            section: 'Curves and lines',
            label: 'Line from an equation',
            hint: 'Any straight line written as an equation, such as 2x + 3y = 12.',
            available: in2D,
            build: (ctx) => curveRecipe(ctx, { equation: '2x + 3y = 12' }),
        },
        {
            id: 'circle',
            section: 'Curves and lines',
            label: 'Circle',
            hint: 'The outline of a circle (x - a)^2 + (y - b)^2 = r^2.',
            available: in2D,
            build: (ctx) => curveRecipe(ctx, { equation: '(x - 3)^2 + (y - 2)^2 = 2^2' }),
        },
        {
            id: 'level-curves',
            section: 'Curves and lines',
            label: 'Level curves of F(x, y)',
            hint: 'Curves where F(x, y) takes each listed value, such as indifference curves.',
            available: in2D,
            build: (ctx) => curveRecipe(ctx, { equation: 'x*y', levels: '2, 4, 8', label: '{level}', color: 'purple' }),
        },
        {
            id: 'points-list',
            section: 'Points',
            label: 'Points from a list',
            hint: 'Marks the points you type, such as (1, 2); (3, 4).',
            available: in2D,
            build: (ctx) => pointsRecipe(ctx, { points: '(1, 1); (2, 3); (4, 2)' }),
        },
        {
            id: 'intersections',
            section: 'Points',
            label: 'Intersections of two functions',
            hint: 'Marks where two functions or curves cross.',
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
            label: 'Corner points of a region',
            hint: 'Marks the corners of a shaded region with their coordinates.',
            available: in2D,
            build: (ctx) => pointsRecipe(ctx, { source: 'region', regionName: firstRegion(ctx), label: '({x}, {y})' }),
        },
        {
            id: 'optimum',
            section: 'Points',
            label: 'Optimum over a region',
            hint: 'Finds where an objective such as 2x + 3y is largest (or smallest) in a region.',
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
            label: 'Integer points in a region',
            hint: 'Marks every point with whole-number coordinates inside a region (or the whole view).',
            available: in2D,
            build: (ctx) => pointsRecipe(ctx, { source: 'lattice', regionName: firstRegion(ctx), size: 'small' }),
        },
        {
            id: 'segment',
            section: 'Segments and arrows',
            label: 'Line segment',
            hint: 'A straight segment between two points.',
            available: in2D,
            build: (ctx) => segmentRecipe(ctx, { path: '(1, 1); (4, 3)' }),
        },
        {
            id: 'arrow',
            section: 'Segments and arrows',
            label: 'Arrow',
            hint: 'A segment with an arrow head, such as a vector or a gradient.',
            available: in2D,
            build: (ctx) => segmentRecipe(ctx, { path: '(1, 1); (3, 3)', style: 'forward' }),
        },
        {
            id: 'polyline',
            section: 'Segments and arrows',
            label: 'Polyline or polygon',
            hint: 'Connects several points in order; Closed joins the last point back to the first.',
            available: in2D,
            build: (ctx) => segmentRecipe(ctx, { path: '(1, 1); (4, 1); (3, 3)', closed: true }),
        },
        {
            id: 'brace',
            section: 'Segments and arrows',
            label: 'Brace with label',
            hint: 'A curly brace between two points; it bulges to the left of the direction from the first point.',
            available: in2D,
            build: (ctx) => segmentRecipe(ctx, { path: '(1, 1); (4, 1)', style: 'brace', label: 'width' }),
        },
        labelRecipe(in2D),
        sliderRecipe(in2D),
    ];
}

function recipes3D(): Recipe[] {
    const in3D = (ctx: RecipeContext) => ctx.is3D;
    return [
        {
            id: 'surface',
            section: 'Functions',
            label: 'Surface z = f(x, y)',
            hint: 'A surface given by a formula in x and y, such as x^2 - y^2.',
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
            label: 'Plane',
            hint: 'A flat plane where x, y or z is constant.',
            available: in3D,
            build: (ctx) => ({ kind: 'tool', tool: newPlane(toolOpts(ctx)) }),
        },
        {
            id: 'point',
            section: '3D',
            label: 'Point',
            hint: 'Marks a point (x, y, z).',
            available: in3D,
            build: (ctx) => pointsRecipe(ctx, { dim: 3, points: '(1, 1, 1)' }),
        },
        {
            id: 'segment',
            section: '3D',
            label: 'Segment',
            hint: 'A straight segment between two points in space.',
            available: in3D,
            build: (ctx) => segmentRecipe(ctx, { dim: 3, path: '(0, 0, 0); (1, 1, 1)' }),
        },
        {
            id: 'arrow',
            section: '3D',
            label: 'Arrow',
            hint: 'A segment with an arrow head, such as a vector.',
            available: in3D,
            build: (ctx) => segmentRecipe(ctx, { dim: 3, path: '(0, 0, 0); (1, 1, 1)', style: 'forward' }),
        },
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
        showLargeGrid: false,
        showSmallGrid: false,
        gridSize: 5,
        majorTickNum: 8,
        xmin: '-0.5',
        xmax: '10',
        ymin: '-0.5',
        ymax: '5',
        zmin: '-5',
        zmax: '5',
        axis_style: 'box',
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
        title: 'Linear program',
        description: 'Feasible region, objective line 2x + 3y = c and the optimum. Drag a line to change it.',
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
        title: 'Areas between two curves',
        description: 'sin and cos with the areas between them shaded in two colours.',
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
        title: 'Tangent explorer',
        description: 'Drag the tangent point, or the slider a, to slide the tangent along x^3 - 3x.',
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
        title: 'Level curves and a constraint',
        description: 'Minimise x^2 + y^2 subject to x + 2y >= 4: the optimal level curve touches the region. Drag the curves to explore.',
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
        title: 'Market equilibrium',
        description: 'Demand, supply, and the consumer and producer surplus at the equilibrium. Drag the curves to explore.',
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
        title: 'Surface and plane',
        description: 'The paraboloid x^2 + y^2 cut by the plane z = h; drag h.',
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
