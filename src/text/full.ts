/*
 * Full LaTeX (5.0): the chart language as LaTeX commands, a second way to
 * write the same charts. A block whose first line is \begin{chart} holds one
 * command per line, with its options in [ ] before its argument in { }, as
 * in pgfplots and TikZ (\addplot[blue]{x^2}); a formula in the argument is
 * LaTeX math without $:
 *
 *   \begin{chart}
 *   \axis[xmin=0, xmax=5, ymin=0, ymax=4.5]
 *   \slider[min=0, max=15, start=6]{c}
 *   \shade[numbered]{x + y \le 4, x + 3y \le 6, x \ge 0, y \ge 0}
 *   \draw[red, dashed, label={$z = {c}$}]{2x + 3y = c}
 *   \mark[max, large]{2x + 3y}
 *   \node[at={(3, 1.2)}]{optimum}
 *   \end{chart}
 *
 * readFull writes such a block in words (the built-in ones), line by line,
 * and remembers the line and column every character comes from, so the
 * words parser (src/text/parse.ts) reads it and its problems point at the
 * block. wordsToFull goes the other way: the chart lines merge into one
 * \axis line and each object keeps its own line. A line no command knows is
 * carried over as \<command>[<options>]{<rest>}, and read back as
 * <command> <rest>, <options>, so no chart is lost; whatever still reads
 * differently is written exactly (\set{field = json}, \raw[tool]{json}).
 * Pure: no DOM, no Obsidian.
 */
import { t as msg } from '../i18n';
import { quote, unquote } from './quote';
import { isColormap } from '../colormaps';
import { canonicalData, minimize, stableJson } from '../chartdata';
import { looksLikeLatex, stripMathDollars } from '../latex';
import type { LineTrace, ObjectList, TextChart, TextProblem } from './parse';
import { COLORS, LINE_BREAK, NAME_RE, THICKNESSES, definedNames, parseChartText, splitStatement, splitTop } from './parse';
import { NO_WORDS, chartWords, hasWords, readWords } from './words';
import { boxRatioOf } from '../box3d';
// 6.0 B
import { AXIS_FLAGS, readAxisSet, readChord } from '../notes6/text';
// 6.0 A
import { readListPoints, vectorFull, vectorWords } from '../values/text';
// 6.0 D
import { LINEAR_FULL_HELP, readLinearDraw, readLinearShade, readTransform } from '../linear/text';
// 6.0 E
import { readIterateDraw, readIteratePlane } from '../iterate/text';
import { givenParts, isPlaneColormap } from '../iterate/tools';
import { readRecurrence } from '../values/recurrence';

/** 6.0 A: the lines of values in Full LaTeX need no let names: they are written in the forms that say what they are. */
const NO_LETS: ReadonlySet<string> = new Set();

type Data = Record<string, unknown>;

// ---------------------------------------------------------------- setting

/** The form new charts are written in: lines in words with LaTeX math in $...$ (the default), or Full LaTeX. */
export type ChartLanguage = 'words' | 'full';

/** The chart language now (the plugin sets it from its settings; tests set their own). */
let current: ChartLanguage = 'words';

export function setChartLanguage(lang: unknown): void {
    current = lang === 'full' ? 'full' : 'words';
}

export function chartLanguage(): ChartLanguage {
    return current;
}

// -------------------------------------------------------------- the block

/** A control character (with `del`, DEL too), or a line or paragraph separator, anywhere in `s`. */
function hasControlChar(s: string, del = false): boolean {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x20 || (del && c === 0x7f) || c === 0x2028 || c === 0x2029) return true;
    }
    return false;
}

export const FULL_BEGIN = '\\begin{chart}';
export const FULL_END = '\\end{chart}';
const BEGIN = /^\\begin\s*\{\s*chart\s*\}/;
const END = /^\\end\s*\{\s*chart\s*\}/;

/** A block in Full LaTeX: its first line that is not blank or a % comment is \begin{chart}. */
export function isFullText(body: string): boolean {
    for (const raw of body.split(/\r\n?|\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('%')) continue;
        return BEGIN.test(line);
    }
    return false;
}

/**
 * What each kind of object takes in Full LaTeX, for "unknown option"
 * messages while a Full LaTeX block is read (chart language: stays English).
 */
export const FULL_OPTION_HELP: Record<string, string> = {
    function: 'a colour, thin, thick, dashed, hidden, legend, legend={text}, domain=a:b, tangent=a, extrema, fill, opacity=0.3, pattern=dots',
    region: 'a colour, opacity=0.3, pattern=dots, outline, dashed outline, no fill, constraint lines, numbered, label={text}, labels={(1), (2)}, domain=a:b, hidden',
    curve: 'a colour, thin, thick, dashed, label={text}, levels={1, 4}, hidden',
    points: 'a colour, small, large, drop lines, coordinates, label={text}, hidden; max, min, corners, integer, crossings and in=R1 say which points',
    segment: 'a colour, thin, thick, dashed, ->, <-, <->, brace, label={text}, hidden',
    text: 'a colour, small, large, above, below, left, right, center, hidden',
    surface: 'a colour, a colour map (colormap/viridis, heat, cool, diverging, rainbow, greyscale), domain=a:b, y domain=c:d, opacity=0.7, mesh=0.4, samples=40, wireframe, hidden',
    plane: 'a colour, opacity=0.25, hidden',
    // 6.0 B
    axisSet: 'a colour, thin, thick, labelled, label={text}, hidden; x-axis or y-axis says the axis',
    chord: 'a colour, thin, thick, dashed, labelled, label={text}, hidden; chord, from=a, to=b and at=λ say the chord',
    ...LINEAR_FULL_HELP, // 6.0 D
    // 6.0 E
    orbit: 'z_0=a start, c=a value, steps=40, a colour, thin, thick, small, large, as a path, labelled, hidden',
    cobweb: 'from=x_0, steps=40, a colour, thin, thick, hidden',
    bifurcation: 'r=a:b, x_0=a start, a colour, hidden',
    newton: 'from=x_0, steps=5, a colour, thin, thick, labelled, hidden',
    colourPlane: 'z_0=a start, c=a value, steps=200, colormap/viridis (heat, cool, diverging, rainbow, greyscale, cyclic), opacity=0.5, hidden',
    fourierCircles: 'wave, a colour, thin, thick, hidden',
};

// ------------------------------------------------------------ text pieces

/** Text with, for every character, the column (0-based) of the block line it stands for. */
class Mapped {
    text = '';
    cols: number[] = [];

    /** Text that stands for the source at `col` (every character points there). */
    put(s: string, col: number): this {
        this.text += s;
        for (let k = 0; k < s.length; k++) this.cols.push(col);
        return this;
    }

    /** Text copied from the source, starting at `col`. */
    copy(s: string, col: number): this {
        this.text += s;
        for (let k = 0; k < s.length; k++) this.cols.push(col + k);
        return this;
    }

    append(m: Mapped): this {
        this.text += m.text;
        this.cols.push(...m.cols);
        return this;
    }
}

/** A piece of a line and its column. */
interface Piece {
    text: string;
    at: number;
}

/** The index of the quote that closes the "string" opened at `at` (backslash escapes), or -1. */
function quoteEnd(s: string, at: number): number {
    for (let i = at + 1; i < s.length; i++) {
        if (s[i] === '\\') i++;
        else if (s[i] === '"') return i;
    }
    return -1;
}

/**
 * The index of the bracket that closes the group opened at `open` ({ or [),
 * or -1. Braces nest, \{ and \} are characters, and a "string" is skipped
 * whole, so JSON and labels with quotes stay one group.
 */
function groupEnd(s: string, open: number): number {
    const square = s[open] === '[';
    let depth = 0;
    for (let i = open + 1; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') {
            i++;
            continue;
        }
        if (c === '"') {
            const end = quoteEnd(s, i);
            if (end < 0) return -1;
            i = end;
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}') {
            if (depth === 0 && !square) return i;
            depth = Math.max(0, depth - 1);
        } else if (c === ']' && square && depth === 0) return i;
    }
    return -1;
}

/** The index of the bracket that closes the ( at `open`, or -1. */
function parenEnd(s: string, open: number): number {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') {
            i++;
            continue;
        }
        if (c === '"') {
            const end = quoteEnd(s, i);
            if (end < 0) return -1;
            i = end;
            continue;
        }
        if (c === '(') depth++;
        else if (c === ')' && --depth === 0) return i;
    }
    return -1;
}

/** Can `v` stand in braces, {v}, and read back as it is? */
function bracedOk(v: string): boolean {
    if (hasControlChar(v)) return false;
    const s = `{${v}}`;
    return groupEnd(s, 0) === s.length - 1;
}

/** Brackets ( ) that close in order. */
function parensBalanced(v: string): boolean {
    let depth = 0;
    for (const c of v) {
        if (c === '(') depth++;
        else if (c === ')' && --depth < 0) return false;
    }
    return depth === 0;
}

/** Can `v` stand bare as an option value? */
function bareOk(v: string): boolean {
    return !!v && v === v.trim() && !/[,=[\]{}"\r\n]/.test(v) && !v.endsWith('\\') && parensBalanced(v);
}

/** A formula or name as an option value: bare when it can be, else {v}, else as a JSON string (for text options). */
function encValue(v: string): string {
    if (bareOk(v)) return v;
    if (bracedOk(v)) return `{${v}}`;
    return quote(v);
}

/** A text (a label, a title, an axis name) as an option value: one word bare, else {text} as pgfplots writes it, else a JSON string. */
function encText(v: string): string {
    if (/^[\p{L}\p{N}_.*+-]+$/u.test(v)) return v;
    return bracedOk(v) ? `{${v}}` : quote(v);
}

/** One end of a range a:b: like a value, and braced when it holds a colon of its own. */
function encBound(v: string): string {
    return bareOk(v) && !v.includes(':') ? v : bracedOk(v) ? `{${v}}` : quote(v);
}

/** A field's value (JSON text, read back as written): bare, a "string" as it is, else braced. */
function encJson(v: string): string {
    if (bareOk(v)) return v;
    if (v.startsWith('"') && quoteEnd(v, 0) === v.length - 1) return v;
    return bracedOk(v) ? `{${v}}` : quote(v);
}

/** An item of a list option (labels={...}): empty, bare, braced or a JSON string. */
function encItem(v: string): string {
    if (!v) return '';
    if (bareOk(v)) return v;
    return bracedOk(v) && v === v.trim() ? `{${v}}` : quote(v);
}

/** Is `v` one {group}, whole? */
function braced(v: string): boolean {
    return v.startsWith('{') && groupEnd(v, 0) === v.length - 1;
}

/** A value without its braces ({a, b} is a, b), with its column. */
function inner(v: string, at: number): Piece {
    return braced(v) ? { text: v.slice(1, -1), at: at + 1 } : { text: v, at };
}

/** A text value: {text} as written, "text" as JSON, otherwise as written. */
function textOf(v: string): string {
    if (braced(v)) return v.slice(1, -1);
    if (v.startsWith('"') && quoteEnd(v, 0) === v.length - 1) return unquote(v.slice(1, -1));
    return v;
}

/** `s` split at commas outside braces, brackets and "strings", each piece trimmed, with its column. */
function splitCommas(s: string, at: number): Piece[] {
    const out: Piece[] = [];
    let brace = 0;
    let paren = 0;
    let start = 0;
    const cut = (end: number) => {
        const piece = s.slice(start, end);
        const lead = piece.length - piece.trimStart().length;
        out.push({ text: piece.trim(), at: at + start + lead });
        start = end + 1;
    };
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') {
            i++;
            continue;
        }
        if (c === '"') {
            const end = quoteEnd(s, i);
            i = end < 0 ? s.length : end;
            continue;
        }
        if (c === '{') brace++;
        else if (c === '}') brace = Math.max(0, brace - 1);
        else if (brace === 0 && c === '(') paren++;
        else if (brace === 0 && c === ')') paren = Math.max(0, paren - 1);
        else if (c === ',' && brace === 0 && paren === 0) cut(i);
    }
    cut(s.length);
    return out;
}

/** The first `ch` outside braces, brackets and "strings" in `s`, or -1. */
function topIndex(s: string, ch: string): number {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') {
            i++;
            continue;
        }
        if (c === '"') {
            const end = quoteEnd(s, i);
            if (end < 0) return -1;
            i = end;
            continue;
        }
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
        else if (c === ch && depth === 0) return i;
    }
    return -1;
}

// ------------------------------------------------------------------ lexer

/** One option: a flag (`dashed`) or a key and its value (`label={A}`). */
interface Opt {
    /** As written, trimmed. */
    text: string;
    /** The key as written (a field name keeps its case). */
    name: string;
    /** The key, lowercase, single spaces (`axis lines`). */
    key: string;
    /** The value as written (braces kept), or null for a flag. */
    value: string | null;
    at: number;
    valueAt: number;
}

function option(text: string, at: number): Opt {
    const eq = topIndex(text, '=');
    if (eq > 0) {
        const name = text.slice(0, eq).trim();
        if (/^[A-Za-z][A-Za-z0-9 _/]*$/.test(name)) {
            const raw = text.slice(eq + 1);
            const lead = raw.length - raw.trimStart().length;
            return { text, name, key: name.replace(/\s+/g, ' ').toLowerCase(), value: raw.trim(), at, valueAt: at + eq + 1 + lead };
        }
    }
    return { text, name: text, key: text.replace(/\s+/g, ' ').toLowerCase(), value: null, at, valueAt: at };
}

function optionsOf(s: string, at: number): Opt[] {
    return splitCommas(s, at)
        .filter((p) => p.text)
        .map((p) => option(p.text, p.at));
}

/** A command line: \name[options]{argument}, TikZ's \node at (x, y) {text} and \draw (0, 0) -- (1, 1); too. */
interface Command {
    name: string;
    at: number;
    options: Opt[];
    /** The argument (without its braces), or null. */
    arg: Piece | null;
    /** \node ... at (x, y) {text}: the position written TikZ's way. */
    position: Piece | null;
    problems: Array<{ at: number; message: string }>;
}

/** The text from `i` on without a trailing ; and % comment, trimmed, with its column. */
function rest(line: string, i: number): Piece {
    let s = line.slice(i);
    const comment = /(^|[\s;])%/.exec(s);
    if (comment) s = s.slice(0, comment.index + comment[1].length);
    s = s.replace(/[\s;]+$/, '');
    const lead = s.length - s.trimStart().length;
    return { text: s.trim(), at: i + lead };
}

function lexCommand(line: string): Command | null {
    const lead = line.length - line.trimStart().length;
    const m = /^\\([A-Za-z][A-Za-z0-9]*)/.exec(line.slice(lead));
    if (!m) return null;
    const cmd: Command = { name: m[1], at: lead, options: [], arg: null, position: null, problems: [] };
    let i = lead + m[0].length;
    const skip = () => {
        while (i < line.length && /\s/.test(line[i])) i++;
    };
    skip();
    if (line[i] === '[') {
        const end = groupEnd(line, i);
        let stop = end;
        if (end < 0) {
            cmd.problems.push({ at: i, message: msg('problems.text.fullUnclosed', { open: '[', close: ']' }) });
            // \draw[red{x = 2}: the options end where an argument that closes starts, else with the line.
            const open = line.indexOf('{', i);
            stop = open > i && groupEnd(line, open) >= 0 ? open : line.length;
        }
        cmd.options = optionsOf(line.slice(i + 1, stop), i + 1);
        i = end < 0 ? stop : end + 1;
        skip();
    }
    // \node at (3, 1.2) {text}
    const at = /^at\s*\(/.exec(line.slice(i));
    if (at && line[i] !== '{') {
        const open = i + at[0].length - 1;
        const close = parenEnd(line, open);
        if (close > open) {
            cmd.position = { text: line.slice(open, close + 1), at: open };
            i = close + 1;
            skip();
        }
    }
    if (line[i] === '{') {
        const end = groupEnd(line, i);
        if (end < 0) {
            cmd.problems.push({ at: i, message: msg('problems.text.fullUnclosed', { open: '{', close: '}' }) });
            cmd.arg = { text: line.slice(i + 1).trimEnd(), at: i + 1 };
            i = line.length;
        } else {
            cmd.arg = { text: line.slice(i + 1, end), at: i + 1 };
            i = end + 1;
        }
    } else if (i < line.length) {
        // TikZ's way: \draw[->] (0, 0) -- (3, 2);  the rest of the line is the argument.
        const r = rest(line, i);
        if (r.text) cmd.arg = r;
        i = line.length;
    }
    // After the argument: a ; and a % comment are fine; anything else reads as more options.
    const after = rest(line, i);
    if (after.text) cmd.options.push(...optionsOf(after.text, after.at));
    return cmd;
}

// --------------------------------------------------------- full to words

/** The argument trimmed, with its column ('' when there is none). */
function argOf(cmd: Command): Piece {
    if (!cmd.arg) return { text: '', at: cmd.at };
    const lead = cmd.arg.text.length - cmd.arg.text.trimStart().length;
    return { text: cmd.arg.text.trim(), at: cmd.arg.at + lead };
}

/** A formula as the words write it: LaTeX (5.0) in $...$, the plain syntax as it is (as the printer's mathText). */
function mathInto(m: Mapped, s: string, at: number) {
    if (s && looksLikeLatex(s) && !s.includes('$')) m.put('$', at).copy(s, at).put('$', at + s.length - 1);
    else m.copy(s, at);
}

type Kind = 'function' | 'surface' | 'region' | 'curve' | 'points' | 'segment' | 'plane' | 'text' | 'other';

/** `a:b` as two bounds (braces taken off), or null. */
function rangeOf(v: string, at: number): [Piece, Piece] | null {
    const colon = topIndex(v, ':');
    if (colon <= 0) return null;
    const a = v.slice(0, colon);
    const b = v.slice(colon + 1);
    const pa = inner(a.trim(), at + (a.length - a.trimStart().length));
    const pb = inner(b.trim(), at + colon + 1 + (b.length - b.trimStart().length));
    return pa.text.trim() && pb.text.trim() ? [pa, pb] : null;
}

/** One option of an object in words (`label={A}` is label "A", `domain=0:4` is from x = 0 to 4). */
function optionWords(o: Opt, kind: Kind, variable: string): Mapped {
    const m = new Mapped();
    if (o.value === null) {
        if (o.key.startsWith('colormap/')) {
            const slash = o.text.indexOf('/');
            return m.copy(o.text.slice(slash + 1).trim(), o.at + slash + 1);
        }
        const v = inner(o.text, o.at);
        return m.copy(v.text, v.at);
    }
    const v = inner(o.value, o.valueAt);
    switch (o.key) {
        case 'color':
        case 'colour':
        case 'colormap':
            return m.copy(v.text, v.at);
        case 'label':
        case 'legend':
            return m.put(`${o.key} `, o.at).put(quote(textOf(o.value)), o.valueAt);
        case 'tangent':
        case 'tangent at':
            return m.put('tangent at ', o.at).copy(v.text, v.at);
        case 'opacity':
        case 'fill opacity':
            return m.put('opacity ', o.at).copy(v.text, v.at);
        case 'mesh':
        case 'samples':
        case 'pattern':
            return m.put(`${o.key} `, o.at).copy(v.text, v.at);
        case 'domain':
        case 'x domain':
        case 'y domain': {
            const r = rangeOf(o.value, o.valueAt);
            if (!r) break;
            const y = o.key === 'y domain';
            const head =
                kind === 'surface'
                    ? `${y ? 'y' : 'x'} from `
                    : kind === 'function' && variable !== 'x'
                      ? `for ${variable} from `
                      : `from ${y ? 'y' : 'x'} = `;
            return m.put(head, o.at).copy(r[0].text, r[0].at).put(' to ', o.valueAt).copy(r[1].text, r[1].at);
        }
    }
    // A field: key=value, the value as JSON (as the words write it after a comma).
    return m.copy(o.name, o.at).put('=', o.valueAt).copy(v.text, v.at);
}

/** Keys the commands take with a value (name=R1, at=..., in=R1, levels=..., labels=..., text=...); the others they take as flags (max, ->, plane). */
const TAKES_VALUE = new Set(['name', 'at', 'in', 'levels', 'labels', 'text', 'from', 'to' /* 6.0 A, B */]);

/** The options of an object after a bar (`head | red, dashed`), but those its line itself takes. */
function barInto(m: Mapped, opts: Opt[], kind: Kind, variable: string, taken: ReadonlySet<string>, extra: Mapped[] = []) {
    const own = (o: Opt) => taken.has(o.key) && (TAKES_VALUE.has(o.key) ? o.value !== null : o.value === null);
    const words = [...extra, ...opts.filter((o) => !own(o)).map((o) => optionWords(o, kind, variable))];
    if (!words.length) return;
    m.put(' | ', words[0].cols[0] ?? m.cols[m.cols.length - 1] ?? 0);
    words.forEach((w, i) => {
        if (i) m.put(', ', w.cols[0] ?? 0);
        m.append(w);
    });
}

/** `R1: ` for a name=R1 option. */
function namedInto(m: Mapped, opts: Opt[]) {
    const name = opts.find((o) => o.key === 'name' && o.value !== null);
    if (name) m.put(`${textOf(name.value ?? '').trim()}: `, name.valueAt);
}

const flagOf = (opts: Opt[], ...keys: string[]) => opts.find((o) => o.value === null && keys.includes(o.key));
const valueOf = (opts: Opt[], ...keys: string[]) => opts.find((o) => o.value !== null && keys.includes(o.key));

/** A function head's variable: t (parametric), theta (polar) or x. */
function variableOf(head: string): string {
    if (/^[A-Za-z][A-Za-z0-9_]*\s*\(\s*t\s*\)\s*=/.test(head)) return 't';
    if (/^[A-Za-z][A-Za-z0-9_]*\s*\(\s*(?:\\?theta|θ)\s*\)\s*=/.test(head) || /^r\s*=(?!=)/.test(head)) return 'theta';
    return 'x';
}

/** s(x, y) = ... or z = ...: a surface. */
const SURFACE_HEAD = /^(?:[A-Za-z][A-Za-z0-9_]*\s*\(\s*[A-Za-z]+\s*,\s*[A-Za-z]+\s*\)|z)\s*=(?!=)/;

function plotWords(cmd: Command): Mapped {
    const m = new Mapped();
    namedInto(m, cmd.options);
    const arg = argOf(cmd);
    m.put('plot ', cmd.at);
    mathInto(m, arg.text, arg.at);
    const surface = SURFACE_HEAD.test(arg.text);
    barInto(m, cmd.options, surface ? 'surface' : 'function', surface ? 'x' : variableOf(arg.text), new Set(['name']));
    return m;
}

/** The items of a list option (labels={(1), , labour}) as text. */
function listOf(o: Opt): string[] {
    const v = inner(o.value ?? '', o.valueAt);
    return splitCommas(v.text, v.at).map((p) => textOf(p.text));
}

function shadeWords(cmd: Command): Mapped {
    const linear = unitSquareWords(cmd); // 6.0 D
    if (linear) return linear;
    const m = new Mapped();
    namedInto(m, cmd.options);
    m.put('shade ', cmd.at);
    const arg = argOf(cmd);
    const labelsOpt = valueOf(cmd.options, 'labels');
    const labels = labelsOpt ? listOf(labelsOpt) : [];
    const entries = splitCommas(arg.text, arg.at);
    if (/^(?:between|under)\s/i.test(entries[0]?.text ?? '')) {
        // between f and g, under f: more conditions follow "for" (shade between f and g for 0 <= x <= 2).
        m.copy(entries[0].text, entries[0].at);
        entries.slice(1).forEach((e, i) => {
            m.put(i ? ', ' : ' for ', e.at);
            mathInto(m, e.text, e.at);
        });
    } else {
        entries.forEach((e, i) => {
            if (i) m.put(', ', e.at);
            mathInto(m, e.text, e.at);
            if (labels[i] && labelsOpt) m.put(` ${quote(labels[i])}`, labelsOpt.valueAt);
        });
    }
    barInto(m, cmd.options, 'region', 'x', new Set(['name', 'labels']));
    return m;
}

/** A point of a path or list: (x, y), (x, y, z) or a points tool's name. */
const pointLike = (p: string) => /^\([\s\S]*\)$/.test(p.trim()) || NAME_RE.test(p.trim());

/** The points of a path a -- b -- c (-- cycle), or null when the argument is no path. */
function pathOf(arg: Piece): Piece[] | null {
    const pieces = splitTop(arg.text, '--', arg.at);
    if (pieces.length < 2) return null;
    const last = pieces[pieces.length - 1].text;
    const points = /^cycle$/i.test(last) ? pieces.slice(0, -1) : pieces;
    return points.length >= 2 && points.every((p) => pointLike(p.text)) ? pieces : null;
}

/** A list in words: `A`, `A and B`, `A, B and C`. */
function andListInto(m: Mapped, items: Piece[]) {
    items.forEach((p, i) => {
        if (i) m.put(i === items.length - 1 ? ' and ' : ', ', p.at);
        m.copy(p.text, p.at);
    });
}

function drawWords(cmd: Command): Mapped {
    const linear = linearDrawWords(cmd); // 6.0 D
    if (linear) return linear;
    const m = new Mapped();
    const opts = cmd.options;
    namedInto(m, opts);
    const arg = argOf(cmd);
    // 6.0 A: \draw[vector, from={(1, 1)}, tip to tail]{v, w} (src/values/text.ts).
    if (flagOf(opts, 'vector')) {
        const from = valueOf(opts, 'from');
        m.put(vectorWords(arg.text, from ? textOf(from.value ?? '').trim() : '', !!flagOf(opts, 'tip to tail')), cmd.at);
        barInto(m, opts, 'other', 'x', new Set(['name', 'vector', 'from', 'tip to tail']));
        return m;
    }
    const plane = flagOf(opts, 'plane');
    const levels = valueOf(opts, 'levels');
    if (plane) {
        m.put('draw the plane ', cmd.at).copy(arg.text, arg.at);
        barInto(m, opts, 'plane', 'x', new Set(['name', 'plane']));
        return m;
    }
    if (levels) {
        m.put('draw the level curves of ', cmd.at);
        mathInto(m, arg.text, arg.at);
        const v = inner(levels.value ?? '', levels.valueAt);
        m.put(' at ', levels.at).copy(v.text.trim(), v.at + (v.text.length - v.text.trimStart().length));
        barInto(m, opts, 'curve', 'x', new Set(['name', 'levels']));
        return m;
    }
    // 6.0 B: \draw[chord, from=a, to=b, at=λ]{g} is the chord of g.
    const chord = flagOf(opts, 'chord');
    const from = valueOf(opts, 'from');
    const to = valueOf(opts, 'to');
    if (chord && from && to && arg.text) {
        m.put('draw the chord of ', cmd.at).copy(arg.text, arg.at);
        const value = (o: Opt, word: string) => {
            const v = inner(o.value ?? '', o.valueAt);
            m.put(word, o.at);
            mathInto(m, v.text.trim(), v.at + (v.text.length - v.text.trimStart().length));
        };
        value(from, ' from ');
        value(to, ' to ');
        const at = valueOf(opts, 'at');
        if (at) value(at, ' at ');
        barInto(m, opts, 'other', 'x', new Set(['name', 'chord', 'from', 'to', 'at']));
        return m;
    }
    const path = pathOf(arg);
    if (path) {
        const arrow = flagOf(opts, '->', '<-', '<->');
        const brace = flagOf(opts, 'brace');
        const closed = /^cycle$/i.test(path[path.length - 1].text);
        const points = closed ? path.slice(0, -1) : path;
        const style = brace ? 'brace' : arrow?.key === '->' ? 'forward' : arrow?.key === '<-' ? 'backward' : arrow?.key === '<->' ? 'both' : 'line';
        const extra: Mapped[] = [];
        if (style === 'line' && closed) {
            m.put('draw a polygon through ', cmd.at);
            andListInto(m, points);
        } else {
            const head = { line: 'draw a line from ', brace: 'draw a brace from ', both: 'draw a double arrow from ', forward: 'draw an arrow from ', backward: 'draw an arrow from ' }[style];
            m.put(head, cmd.at);
            points.forEach((p, i) => {
                if (i) m.put(' to ', p.at);
                m.copy(p.text, p.at);
            });
            if (style === 'backward' && arrow) extra.push(new Mapped().put('backwards', arrow.at));
            if (closed) extra.push(new Mapped().put('closed=true', path[path.length - 1].at));
        }
        barInto(m, opts, 'segment', 'x', new Set(['name', '->', '<-', '<->', 'brace']), extra);
        return m;
    }
    m.put('draw ', cmd.at);
    mathInto(m, arg.text, arg.at);
    barInto(m, opts, 'curve', 'x', new Set(['name']));
    return m;
}

function markWords(cmd: Command): Mapped {
    const m = new Mapped();
    const opts = cmd.options;
    namedInto(m, opts);
    const arg = argOf(cmd);
    const inOpt = valueOf(opts, 'in');
    const region = inOpt ? inner(inOpt.value ?? '', inOpt.valueAt) : null;
    const regionInto = () => {
        if (!region) m.put('the region', cmd.at);
        else m.copy(textOf(inOpt?.value ?? '').trim(), region.at);
    };
    const sense = flagOf(opts, 'max', 'maximum') ? 'maximum' : flagOf(opts, 'min', 'minimum') ? 'minimum' : null;
    const taken = new Set(['name', 'in', 'max', 'maximum', 'min', 'minimum', 'corners', 'integer', 'crossings', 'intersections']);
    // 6.0 B: \mark[x-axis]{g(x) \le 0} is the set on the axis where the condition holds.
    const axisFlag = flagOf(opts, ...AXIS_FLAGS);
    if (axisFlag && arg.text) {
        m.put('mark where ', cmd.at);
        mathInto(m, arg.text, arg.at);
        m.put(` on the ${axisFlag.key}`, axisFlag.at);
        barInto(m, opts, 'other', 'x', new Set(['name', ...AXIS_FLAGS]));
        return m;
    }
    // 6.0 A: \mark[list, joined]{S}: the points of a list (src/values/text.ts).
    if (flagOf(opts, 'list')) {
        const direct = arg.text.startsWith('\\{') || arg.text.startsWith('[');
        m.put(`mark the points ${direct ? '' : 'of '}`, cmd.at);
        mathInto(m, arg.text, arg.at);
        barInto(m, opts, 'points', 'x', new Set(['name', 'list']));
        return m;
    }
    if (flagOf(opts, 'crossings', 'intersections')) {
        let refs = splitCommas(arg.text, arg.at).filter((p) => p.text);
        if (refs.length === 1) refs = splitTop(arg.text, ' and ', arg.at);
        m.put('mark where ', cmd.at);
        refs.forEach((p, i) => {
            if (i) m.put(' and ', p.at);
            m.copy(p.text, p.at);
        });
        m.put(' cross', cmd.at);
    } else if (flagOf(opts, 'corners')) {
        m.put('mark the corners of ', cmd.at);
        regionInto();
    } else if (flagOf(opts, 'integer') && sense) {
        m.put(`mark the integer ${sense} of `, cmd.at);
        mathInto(m, arg.text, arg.at);
        m.put(' in ', inOpt ? inOpt.at : cmd.at);
        regionInto();
    } else if (flagOf(opts, 'integer')) {
        if (region && !textOf(inOpt?.value ?? '').trim()) m.put('mark the integer points', cmd.at);
        else {
            m.put('mark the integer points in ', cmd.at);
            regionInto();
        }
    } else if (sense) {
        m.put(`mark the ${sense} of `, cmd.at);
        mathInto(m, arg.text, arg.at);
        m.put(' in ', inOpt ? inOpt.at : cmd.at);
        regionInto();
    } else {
        m.put('mark ', cmd.at).copy(arg.text, arg.at);
        taken.clear();
        taken.add('name');
    }
    barInto(m, opts, 'points', 'x', taken);
    return m;
}

function nodeWords(cmd: Command): Mapped {
    const m = new Mapped();
    const opts = cmd.options;
    namedInto(m, opts);
    const textOpt = valueOf(opts, 'text');
    const arg = argOf(cmd);
    m.put('write ', cmd.at).put(quote(textOpt ? textOf(textOpt.value ?? '') : arg.text), textOpt ? textOpt.valueAt : arg.at);
    const atOpt = valueOf(opts, 'at');
    const pos = atOpt ? inner(atOpt.value ?? '', atOpt.valueAt) : cmd.position;
    if (pos) {
        const p = pos.text.trim();
        const at = pos.at + (pos.text.length - pos.text.trimStart().length);
        m.put(' at ', atOpt ? atOpt.at : pos.at);
        if (p.startsWith('(')) m.copy(p, at);
        else m.put('(', at).copy(p, at).put(')', at + p.length - 1);
    }
    barInto(m, opts, 'text', 'x', new Set(['name', 'at', 'text']));
    return m;
}

function sliderWords(cmd: Command): Mapped {
    const m = new Mapped().put('slider', cmd.at);
    const arg = argOf(cmd);
    if (arg.text) m.put(' ', arg.at).copy(arg.text, arg.at);
    const opts = cmd.options;
    const used = new Set<Opt>();
    const get = (...keys: string[]) => {
        const o = valueOf(opts, ...keys);
        if (o) used.add(o);
        return o ? { o, v: inner(o.value ?? '', o.valueAt) } : null;
    };
    let lo = get('min');
    let hi = get('max');
    const start = get('start', 'value');
    const step = get('step');
    const domain = !lo && !hi ? get('domain') : null;
    if (domain) {
        const r = rangeOf(domain.o.value ?? '', domain.o.valueAt);
        if (r) {
            lo = { o: domain.o, v: r[0] };
            hi = { o: domain.o, v: r[1] };
        }
    }
    if (lo && hi) m.put(' from ', lo.o.at).copy(lo.v.text, lo.v.at).put(' to ', hi.o.at).copy(hi.v.text, hi.v.at);
    else if (lo || hi) {
        const one = (lo ?? hi) as { o: Opt; v: Piece };
        m.put(' from ', one.o.at).copy(one.v.text, one.v.at);
    }
    if (start) m.put(', starting at ', start.o.at).copy(start.v.text, start.v.at);
    if (step) m.put(', in steps of ', step.o.at).copy(step.v.text, step.v.at);
    // Anything else goes along as written (connected, ...): the slider line reads it or names it.
    for (const o of opts) if (!used.has(o)) m.put(', ', o.at).copy(o.text, o.at);
    return m;
}

function rawWords(cmd: Command): Mapped | null {
    const kind = cmd.options.find((o) => o.value === null && /^(tool|function|surface|label|slider)$/.test(o.key));
    if (!kind) return null;
    const arg = argOf(cmd);
    return new Mapped().put(`raw ${kind.key} `, cmd.at).copy(arg.text, arg.at);
}

/** A command no other one is: \<command>[<options>]{<rest>} as <command> <rest>, <options>. */
function genericWords(cmd: Command): Mapped {
    const m = new Mapped();
    namedInto(m, cmd.options);
    m.copy(cmd.name, cmd.at + 1);
    const arg = argOf(cmd);
    if (arg.text) m.put(' ', arg.at).copy(arg.text, arg.at);
    for (const o of cmd.options) {
        if (o.key === 'name' && o.value !== null) continue;
        m.put(', ', o.at).append(optionWords(o, 'other', 'x'));
    }
    return m;
}

/** \axis[...] keys whose value is text (a JSON "string" reads as the text it holds). */
const AXIS_LINES: Record<string, string> = { box: 'axes in a box', middle: 'axes in the middle', center: 'axes in the middle', left: 'axes on the edges', none: 'no axes' };
const GRID: Record<string, string[]> = {
    major: ['with a grid'],
    minor: ['with a minor grid'],
    both: ['with a fine grid'],
    none: ['set showLargeGrid = false', 'set showSmallGrid = false'],
};

/** A bound `show` can hold: no comma, `..`, ` to ` or ` and ` of its own. */
const boundOk = (b: string) => !!b.trim() && [',', '..', ' to ', ' and '].every((sep) => splitTop(b, sep).length === 1);

/** Text a title line holds bare when it reads back the same, else "quoted" (the printer's text()). */
function titleText(s: string): string {
    const plain = s && s === s.trim() && !s.startsWith('"') && !s.startsWith(':') && !s.includes('|') && !hasControlChar(s, true);
    return plain ? s : quote(s);
}

/** A size in cm: 12, 12cm, 120mm, 4in, 300pt. */
function centimetres(v: string): number | null {
    const m = /^([-+]?(?:\d+\.?\d*|\.\d+))\s*(cm|mm|in|pt)?$/i.exec(v.trim());
    if (!m) return null;
    const n = Number(m[1]);
    const unit = (m[2] ?? 'cm').toLowerCase();
    const cm = unit === 'mm' ? n / 10 : unit === 'in' ? n * 2.54 : unit === 'pt' ? n / 28.4528 : n;
    return Number.isFinite(cm) ? Number(cm.toPrecision(12)) : null;
}

/** \axis[...]: the chart lines in words, one per option (the ranges in one show line). */
function axisWords(cmd: Command, line: number, problems: TextProblem[]): Mapped[] {
    const out: Mapped[] = [];
    const say = (text: string, at: number) => out.push(new Mapped().put(text, at));
    const bounds = new Map<string, { o: Opt; v: Piece }>();
    let width: { o: Opt; n: number | null } | null = null;
    let height: { o: Opt; n: number | null } | null = null;
    const unknown = (o: Opt) => problems.push({ line, column: o.at + 1, message: msg('problems.text.fullAxisOption', { option: o.text }) });
    const args = cmd.arg && cmd.arg.text.trim() ? optionsOf(cmd.arg.text, cmd.arg.at) : [];
    for (const o of [...cmd.options, ...args]) {
        const v = o.value === null ? null : inner(o.value, o.valueAt);
        const tick = /^([xyz])tick( distance)?$/.exec(o.key);
        const label = /^([xyz])label$/.exec(o.key);
        if (o.value === null) {
            if (['3d', 'cube', 'polar', 'snippet', 'frames'].includes(o.key)) say(o.key, o.at); // frames: 6.0 C
            else if (o.key === 'hide axis') say('no axes', o.at);
            else if (o.key === 'axis equal' || o.key === 'axis equal image') say('equal scale', o.at);
            else unknown(o);
        } else if (!v) continue;
        else if (/^[xyz](min|max)$/.test(o.key)) bounds.set(o.key, { o, v });
        else if (o.key === 'plot box ratio') {
            const ratio = boxRatioOf(v.text.replace(/[{}]/g, ' '));
            if (ratio) say(`box ${ratio.join(' x ')}`, o.at);
            else unknown(o);
        }
        else if (o.key === 'axis lines') {
            const word = AXIS_LINES[v.text.trim().toLowerCase()];
            if (word) say(word, o.at);
            else out.push(new Mapped().put('axes ', o.at).copy(v.text, v.at));
        } else if (o.key === 'grid') {
            const words = GRID[v.text.trim().toLowerCase()];
            if (words) for (const w of words) say(w, o.at);
            else out.push(new Mapped().put('grid ', o.at).copy(v.text, v.at));
        } else if (o.key === 'grid opacity') out.push(new Mapped().put('grid opacity ', o.at).copy(v.text, v.at));
        else if (tick) {
            const off = !tick[2] && /^(?:\\empty|\{\}|none|off|)$/i.test(o.value.trim());
            if (off) say(`${tick[1]} numbers off`, o.at);
            else out.push(new Mapped().put(`${tick[1]} numbers ${tick[2] ? 'every' : 'at'} `, o.at).copy(v.text.trim(), v.at + (v.text.length - v.text.trimStart().length)));
        } else if (o.key === 'title' || label) {
            const text = textOf(o.value);
            out.push(new Mapped().put(`${o.key} `, o.at).put(titleText(text), o.valueAt));
        } else if (o.key === 'variables') out.push(new Mapped().put('variables ', o.at).copy(textOf(o.value), v.at));
        else if (o.key === 'width') width = { o, n: centimetres(v.text) };
        else if (o.key === 'height') height = { o, n: centimetres(v.text) };
        else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(o.name)) out.push(new Mapped().put(`set ${o.name} = `, o.at).copy(v.text, v.at));
        else unknown(o);
    }
    // The ranges: one show line for the axes that have both ends; a lone end is set as it is.
    const axes = ['x', 'y', 'z'].filter((a) => {
        const lo = bounds.get(`${a}min`);
        const hi = bounds.get(`${a}max`);
        return lo && hi && boundOk(lo.v.text) && boundOk(hi.v.text);
    });
    if (axes.length) {
        const m = new Mapped();
        axes.forEach((a, i) => {
            const lo = bounds.get(`${a}min`) as { o: Opt; v: Piece };
            const hi = bounds.get(`${a}max`) as { o: Opt; v: Piece };
            m.put(i === 0 ? 'show ' : ' and ', lo.o.at)
                .put(`${a} from `, lo.o.at)
                .copy(lo.v.text.trim(), lo.v.at + (lo.v.text.length - lo.v.text.trimStart().length))
                .put(' to ', hi.o.at)
                .copy(hi.v.text.trim(), hi.v.at + (hi.v.text.length - hi.v.text.trimStart().length));
        });
        out.unshift(m);
    }
    for (const [key, b] of bounds) {
        if (axes.includes(key[0])) continue;
        out.push(new Mapped().put(`set ${key} = ${JSON.stringify(b.v.text.trim())}`, b.o.at));
    }
    if (width && height && width.n !== null && height.n !== null) say(`size ${width.n} x ${height.n}`, width.o.at);
    else {
        for (const [key, s] of [['size_x_cm', width], ['size_y_cm', height]] as const) {
            if (!s) continue;
            if (s.n === null) unknown(s.o);
            else say(`set ${key} = ${s.n}`, s.o.at);
        }
    }
    return out;
}

/** One line of a Full LaTeX block in words: none, one, or (an \axis line) several. */
function lineWords(line: string, no: number, problems: TextProblem[]): Mapped[] {
    // 6.0 C: \then before a command (or alone) starts the next step, as `then` does in words.
    const then = /^(\s*)\\then(?![A-Za-z])\s*/.exec(line);
    if (then) {
        const rest = lineWords(' '.repeat(then[0].length) + line.slice(then[0].length), no, problems);
        const head = new Mapped().put(rest.length && rest[0].text ? 'then ' : 'then', then[1].length);
        return [head.append(rest[0] ?? new Mapped()), ...rest.slice(1)];
    }
    const trimmed = line.trim();
    const lead = line.length - line.trimStart().length;
    if (!trimmed) return [new Mapped()];
    if (trimmed.startsWith('%')) return [new Mapped().copy(line, 0)];
    const edge = BEGIN.exec(trimmed) ?? END.exec(trimmed);
    if (edge) {
        const after = trimmed.slice(edge[0].length).trim();
        if (after && !after.startsWith('%')) {
            const word = BEGIN.test(trimmed) ? FULL_BEGIN : FULL_END;
            problems.push({ line: no, column: lead + trimmed.indexOf(after) + 1, message: msg('problems.text.standsAlone', { word }) });
        }
        return [new Mapped()];
    }
    const cmd = lexCommand(line);
    // Not a command: read as a line in words.
    if (!cmd) return [new Mapped().copy(line, 0)];
    for (const p of cmd.problems) problems.push({ line: no, column: p.at + 1, message: p.message });
    switch (cmd.name.toLowerCase()) {
        case 'axis':
            return axisWords(cmd, no, problems);
        case 'slider':
            return [sliderWords(cmd)];
        case 'plot':
        case 'addplot':
            return [plotWords(cmd)];
        case 'shade':
            return [shadeWords(cmd)];
        case 'draw':
            return [drawWords(cmd)];
        case 'mark':
            return [markWords(cmd)];
        case 'node':
            return [nodeWords(cmd)];
        case 'raw':
            return [rawWords(cmd) ?? genericWords(cmd)];
        // 6.0 C: vector fields, rest points, solutions of systems
        case 'vectorfield':
        case 'restpoints':
        case 'solution':
            return [motionWords(cmd)];
        // 6.0 D: \transform{A}
        case 'transform':
            return [transformWords(cmd)];
        // 6.0 E: orbits, cobwebs, bifurcation diagrams, Newton's method, coloured planes, turning circles
        case 'orbit':
        case 'cobweb':
        case 'bifurcation':
        case 'newton':
        case 'colourplane':
        case 'colorplane':
        case 'circles':
            return [iterateWords(cmd)];
        default:
            return [genericWords(cmd)];
    }
}

/** A title line keeps its $ (the parser reads it before it takes them out). */
const TITLED = /^(\s*)(title|xlabel|ylabel|zlabel)(?![A-Za-z0-9_(])\s*:?\s*(.*)$/i;

/**
 * The columns of a words line as the parser sees it: it takes the $ of
 * formulas out first, writes a bar in them as \vert and \theta as theta
 * (src/latex.ts stripMathDollars), and its problems count in that line.
 */
function parserColumns(text: string, cols: number[]): number[] {
    if (!text.includes('$') || TITLED.test(text)) return cols;
    const out: number[] = [];
    let s = '';
    let quoted = false;
    let math = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"' && !math) quoted = !quoted;
        if (c === '$' && !quoted) {
            math = !math;
            continue;
        }
        if (math && c === '|') {
            s += '\\vert ';
            for (let k = 0; k < 6; k++) out.push(cols[i]);
        } else {
            s += c;
            out.push(cols[i]);
        }
    }
    const drop = [...s.matchAll(/(?<![A-Za-z])\\theta\b/g)].map((m) => m.index ?? 0);
    for (let k = drop.length - 1; k >= 0; k--) out.splice(drop[k], 1);
    return out;
}

/** A Full LaTeX block as the words parser reads it. */
export interface FullRead {
    /** The block in words (the built-in ones). */
    text: string;
    /** For each line of `text`, the line of the block it comes from (1-based): an \axis line gives one line per setting. */
    lines: number[];
    /** For each line of `text`, the column of the block (0-based) of each character as the parser sees the line (its $ taken out). */
    columns: number[][];
    /** What the block itself gets wrong: a bracket not closed, an option \axis does not know. */
    problems: TextProblem[];
}

/**
 * A Full LaTeX block in words, line by line: \begin{chart}, \end{chart},
 * blank lines and comments stay one line each (blank or the comment), every
 * object line is one line in words, and an \axis line is one line per
 * setting. Lines that are no command are read as words.
 */
export function readFull(text: string): FullRead {
    const out: FullRead = { text: '', lines: [], columns: [], problems: [] };
    const words: string[] = [];
    text.split(LINE_BREAK).forEach((line, i) => {
        const made = lineWords(line, i + 1, out.problems);
        for (const m of made.length ? made : [new Mapped()]) {
            words.push(m.text);
            out.lines.push(i + 1);
            out.columns.push(parserColumns(m.text, m.cols));
        }
    });
    out.text = words.join('\n');
    return out;
}

/** A Full LaTeX block in words (the built-in ones). */
export function fullToWords(text: string): string {
    return readFull(text).text;
}

/** The problems and lines of the words a Full LaTeX block reads as, put back on the block's own lines and columns. */
export function mapFull(read: FullRead, parsed: TextChart, lineCount: number, trace: boolean): TextChart {
    const problems = parsed.problems.map((p) => {
        const cols = read.columns[p.line - 1] ?? [];
        const c = p.column - 1;
        const column = cols.length ? (c < cols.length ? cols[Math.max(0, c)] : cols[cols.length - 1] + 1) + 1 : 1;
        return { line: read.lines[p.line - 1] ?? p.line, column, message: p.message };
    });
    problems.push(...read.problems);
    problems.sort((a, b) => a.line - b.line || a.column - b.column);
    const out: TextChart = { data: parsed.data, problems };
    if (trace) {
        const lines: LineTrace[] = Array.from({ length: lineCount }, (_, k) => ({ line: k + 1, object: null, chart: [] }));
        for (const tr of parsed.lines ?? []) {
            const into = lines[(read.lines[tr.line - 1] ?? tr.line) - 1];
            if (!into) continue;
            if (tr.object) into.object = tr.object;
            for (const k of tr.chart) if (!into.chart.includes(k)) into.chart.push(k);
        }
        out.lines = lines;
    }
    return out;
}

// --------------------------------------------------------- words to full

/** Option words that stand alone in both forms. */
const FLAGS = new Set([
    'hidden', 'dashed', 'numbered', 'extrema', 'legend', 'fill', 'outline', 'dashed outline', 'no fill', 'constraint lines',
    'coordinates', 'drop lines', 'small', 'large', 'normal', 'wireframe', 'backwards', 'above', 'below', 'left', 'right', 'center',
]);
const COLOUR_ALIASES = new Set(['grey', 'violet', 'pink', 'cyan', 'auto']);

/** A "quoted" string at the start of `s` (JSON escapes, LaTeX commands in math as written: see quote.ts), and what follows it. */
function takeQuoted(s: string): { text: string; rest: string } | null {
    const t = s.trimStart();
    if (!t.startsWith('"')) return null;
    const end = quoteEnd(t, 0);
    if (end < 0) return null;
    return { text: unquote(t.slice(1, end)), rest: t.slice(end + 1).trim() };
}

/** A text option's value as the words write it: "quoted" (JSON) or bare. */
function wordsText(s: string): string {
    const q = takeQuoted(s);
    return q && !q.rest ? q.text : s.trim();
}

/** `a..b` or `a to b` as two bounds (the parser's parseRange). */
function wordsRange(s: string): [string, string] | null {
    for (const sep of ['..', ' to ']) {
        const parts = splitTop(s, sep);
        if (parts.length === 2 && parts[0].text && parts[1].text) return [parts[0].text, parts[1].text];
    }
    return null;
}

/** A range option in words: from x = 0 to 4, for t from 0 to 2pi, y from -2 to 2, domain 0..4. */
function rangeOption(o: string): { y: boolean; range: [string, string] } | null {
    const forms: Array<[RegExp, (m: RegExpExecArray) => boolean]> = [
        [/^from\s+([xyt])\s*=\s*(.+)$/i, (m) => m[1].toLowerCase() === 'y'],
        [/^for\s+(x|y|t|theta|θ)\s+from\s+(.+)$/i, (m) => m[1].toLowerCase() === 'y'],
        [/^([xy])\s+from\s+(.+)$/i, (m) => m[1].toLowerCase() === 'y'],
        [/^(domain|t|theta|θ|x|y)\s+(\S.*\.\..*\S)$/i, (m) => m[1].toLowerCase() === 'y'],
    ];
    for (const [re, isY] of forms) {
        const m = re.exec(o);
        if (!m) continue;
        const range = wordsRange(m[2]);
        if (range) return { y: isY(m), range };
    }
    return null;
}

/** One option in words (as splitStatement gives them: `red`, `label "A"`, `tangent at a`) as a Full LaTeX option. */
function optionFull(o: string, kind: Kind): string {
    const t = o.trim();
    const lower = t.toLowerCase();
    if (COLORS.has(lower) || COLOUR_ALIASES.has(lower) || THICKNESSES.includes(lower) || FLAGS.has(lower)) return t;
    if (isColormap(lower)) return kind === 'surface' ? `colormap/${lower}` : t;
    let m = /^(?:label|labels)\s+(.+)$/i.exec(t);
    if (m) return `label=${encText(wordsText(m[1]))}`;
    m = /^legend\s+(.+)$/i.exec(t);
    if (m) return `legend=${encText(wordsText(m[1]))}`;
    m = /^tangent(?:\s+at)?\s+(.+)$/i.exec(t);
    if (m) return `tangent=${encValue(m[1].trim())}`;
    m = /^(opacity|mesh|samples|pattern)\s+(.+)$/i.exec(t);
    if (m) return `${m[1].toLowerCase()}=${encValue(m[2].trim())}`;
    const r = rangeOption(t);
    if (r) return `${r.y ? 'y domain' : 'domain'}=${encBound(r.range[0])}:${encBound(r.range[1])}`;
    m = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(t);
    if (m) return `${m[1]}=${encJson(m[2].trim())}`;
    return bareOk(t) || /^<?->?$/.test(t) ? t : bracedOk(t) ? `{${t}}` : quote(t);
}

/** \command[options]{argument} (null when the argument cannot stand in braces). */
function command(name: string, own: string, opts: string[], arg: string | null): string | null {
    if (arg !== null && !bracedOk(arg)) return null;
    const all = own ? [own, ...opts] : opts;
    const head = `\\${name}${all.length ? `[${all.join(', ')}]` : ''}`;
    return arg === null ? head : `${head}{${arg}}`;
}

/** f(x) = ..., c(t) = (..., ...), r(theta) = ..., s(x, y) = ... (the parser's DEFINITION). */
const DEFINITION = /^[A-Za-z][A-Za-z0-9_]*\s*\(\s*[A-Za-zθ]+\s*(?:,\s*[A-Za-z]+\s*)?\)\s*=(?!=)/;
/** What `draw` may draw by name (the parser's DRAW_NOUN). */
const DRAW_NOUN = /^(?:(?:a|an|the)\s+)?(double\s+arrow|arrow|line|segment|polygon|brace|plane|curve|level\s+curves?|levels|contours?)(?![A-Za-z0-9_(])\s*/i;

function drawFull(own: string, rest: string, options: string[]): string | null {
    const t = rest.trim();
    if (!t) return null;
    // 6.0 A: vector arrows.
    const vector = vectorFull(t, NO_LETS);
    if (vector) return command('draw', own, [...vector.flags, ...options.map((o) => optionFull(o, 'other'))], vector.arg);
    if (DEFINITION.test(t)) return command('plot', own, options.map((o) => optionFull(o, 'function')), t);
    // 6.0 B: the chord of a function.
    const chord = readChord(t);
    if (chord) {
        const lead = ['chord', `from=${encValue(chord.from)}`, `to=${encValue(chord.to)}`, ...(chord.at ? [`at=${encValue(chord.at)}`] : [])];
        return command('draw', own, [...lead, ...options.map((o) => optionFull(o, 'other'))], chord.function);
    }
    const noun = DRAW_NOUN.exec(t);
    const curve = (eq: string) => command('draw', own, options.map((o) => optionFull(o, 'curve')), eq);
    if (!noun) return curve(t);
    const what = noun[1].toLowerCase().replace(/\s+/g, ' ');
    const after = t.slice(noun[0].length).trim();
    if (what === 'plane') {
        if (!/^(?:at\s+)?[xyz]\s*=/i.test(after)) return null;
        return command('draw', own, ['plane', ...options.map((o) => optionFull(o, 'plane'))], after.replace(/^at\s+/i, ''));
    }
    if (what === 'curve' || (what === 'line' && !/^from\s/i.test(after))) return curve(after);
    if (/^(?:level|levels|contour)/.test(what)) {
        const m = /^(?:of\s+)?(.+?)\s+at\s+(.+)$/i.exec(after);
        if (!m) return null;
        const values = m[2].trim();
        const list =
            splitTop(values, ' and ').length > 1
                ? splitTop(values, ',')
                      .flatMap((p) => splitTop(p.text, ' and '))
                      .map((p) => p.text)
                      .join(', ')
                : values;
        return command('draw', own, [`levels=${encValue(list)}`, ...options.map((o) => optionFull(o, 'curve'))], m[1].trim());
    }
    let points: string[];
    let style: 'line' | 'forward' | 'both' | 'brace' = 'line';
    let closed = false;
    if (what === 'polygon') {
        const q = after.replace(/^(?:through|with\s+corners|with\s+vertices)\s+/i, '');
        points = splitTop(q, ',').flatMap((p) => splitTop(p.text, ' and ')).map((p) => p.text);
        closed = true;
    } else if (what === 'brace') {
        points = splitTop(after.replace(/^from\s+/i, ''), ' to ').map((p) => p.text);
        style = 'brace';
    } else {
        const from = /^from\s+([\s\S]*)$/i.exec(after);
        if (!from) return null;
        points = splitTop(from[1], ' to ').map((p) => p.text);
        style = what === 'arrow' ? 'forward' : what === 'double arrow' ? 'both' : 'line';
    }
    points = points.filter((p) => p);
    if (points.length < 2 || !points.every(pointLike) || points.some((p) => /^cycle$/i.test(p))) return null;
    let opts = options;
    const flags: string[] = [];
    if (style === 'forward' && opts.some((o) => o.toLowerCase() === 'backwards')) {
        flags.push('<-');
        opts = opts.filter((o) => o.toLowerCase() !== 'backwards');
    } else if (style === 'forward') flags.push('->');
    else if (style === 'both') flags.push('<->');
    else if (style === 'brace') flags.push('brace');
    return command('draw', own, [...flags, ...opts.map((o) => optionFull(o, 'segment'))], points.join(' -- ') + (closed ? ' -- cycle' : ''));
}

function markFull(own: string, rest: string, options: string[]): string | null {
    const p = rest.trim().replace(/^the\s+/i, '');
    // 6.0 A: the points of a list.
    const values = readListPoints(p, NO_LETS);
    if (values !== null) return command('mark', own, ['list', ...options.map((o) => optionFull(o, 'points'))], values);
    const region = (r: string): string[] => (/^the\s+region$/i.test(r) ? [] : [`in=${encValue(r)}`]);
    const opts = (lead: string[]) => [...lead, ...options.map((o) => optionFull(o, 'points'))];
    // 6.0 B: a set on an axis.
    const set = /^where\s/i.test(p) ? readAxisSet(p) : null;
    if (set) return command('mark', own, [`${set.axis}-axis`, ...options.map((o) => optionFull(o, 'other'))], set.condition);
    let m = /^where\s+(\S+)\s+and\s+(\S+)\s+(?:cross|meet|intersect)$/i.exec(p) ?? /^(?:crossings|intersections|crossing\s+points|intersection\s+points)\s+of\s+(\S+)\s+and\s+(\S+)$/i.exec(p);
    if (m) return command('mark', own, opts(['crossings']), `${m[1]}, ${m[2]}`);
    m = /^corners\s+of\s+(the\s+region|\S+)$/i.exec(p);
    if (m) return command('mark', own, opts(['corners', ...region(m[1])]), null);
    m = /^(maximum|minimum|max|min)\s+of\s+(.+?)\s+(?:in|over|on)\s+(the\s+region|\S+)$/i.exec(p);
    if (m) return command('mark', own, opts([m[1].slice(0, 3).toLowerCase(), ...region(m[3])]), m[2].trim());
    m = /^integer\s+points(?:\s+(?:in|of)\s+(the\s+region|\S+))?$/i.exec(p);
    if (m) return command('mark', own, opts(['integer', ...(m[1] ? region(m[1]) : ['in={}'])]), null);
    m = /^integer\s+(maximum|minimum|max|min)\s+(?:of\s+)?(.+?)\s+(?:in|over|on)\s+(the\s+region|\S+)$/i.exec(p);
    if (m) return command('mark', own, opts(['integer', m[1].slice(0, 3).toLowerCase(), ...region(m[3])]), m[2].trim());
    // The points of the chart's data (5.0): `mark the data`, `mark the data of D1` keep their words (never a point named data).
    if (/^data(?:\s+of\s+\S+)?$/i.test(p)) return command('mark', own, opts([]), rest.trim());
    // A list of points: (1, 2), (3, a) and P1.
    const list = p.replace(/^points?\s+/i, '');
    const pieces = splitTop(list, ',')
        .flatMap((q) => splitTop(q.text, ' and '))
        .map((q) => q.text)
        .filter((q) => q);
    const arg = pieces.length && pieces.every(pointLike) ? pieces.join(', ') : rest.trim();
    return command('mark', own, opts([]), arg);
}

/** Region conditions as the parser reads them (conditionsOf): `where a and b`, `between f and g`, `a, b`, `... for ...`, each with an optional "label". */
function shadeFull(own: string, rest: string, options: string[]): string | null {
    const where = /^(?:the\s+(?:region|area)\s+)?where\s+/i.exec(rest);
    const lead = where ? rest.slice(where[0].length) : rest.replace(/^the\s+(?:region|area)\s+(?=(?:between|under)\s)/i, '');
    const entries = (s: string): string[] => {
        const parts = splitTop(s, ',').map((p) => p.text);
        if (!where || splitTop(s, ' or ').length > 1 || splitTop(s, '||').length > 1) return parts;
        return parts.flatMap((q) => splitTop(q, ' and ').map((x) => x.text));
    };
    const [main, ...more] = splitTop(lead, ' for ').map((p) => p.text);
    const items = [...(/^(between|under)\s/i.test(main) ? [main] : entries(main)), ...more.flatMap(entries)];
    const conditions: string[] = [];
    const labels: string[] = [];
    for (const item of items) {
        let c = item;
        let label = '';
        const q = /"((?:[^"\\]|\\.)*)"\s*$/.exec(c);
        if (q && q.index > 0) {
            label = unquote(q[1]);
            c = c.slice(0, q.index).trim();
        }
        conditions.push(c);
        labels.push(label);
    }
    // A condition with a comma of its own would be two: such a line stays as it is.
    if (conditions.some((c) => splitCommas(c, 0).length > 1)) return null;
    const lead2 = labels.some((l) => l) ? [`labels={${labels.map(encItem).join(', ')}}`] : [];
    return command('shade', own, [...lead2, ...options.map((o) => optionFull(o, 'region'))], conditions.join(', '));
}

function nodeFull(own: string, rest: string, options: string[]): string | null {
    const q = takeQuoted(rest);
    const at = q ? /^at\s+(\(.+\))$/i.exec(q.rest) : null;
    if (!q || !at) return null;
    const opts = [`at=${encValue(at[1])}`];
    const plain = q.text === q.text.trim() && bracedOk(q.text);
    if (!plain) opts.push(`text=${quote(q.text)}`);
    return command('node', own, [...opts, ...options.map((o) => optionFull(o, 'text'))], plain ? q.text : null);
}

/** slider c from 0 to 15, starting at 6, in steps of 0.1 (any order), and whatever else it holds (connected). */
function sliderFull(line: string): string | null {
    const head = /^slider\s+([A-Za-z][A-Za-z0-9_]*)(?![A-Za-z0-9_])\s*(.*)$/i.exec(line.trim());
    if (!head) return null;
    let tail = head[2];
    let lo: string | undefined;
    let hi: string | undefined;
    let start: string | undefined;
    let step: string | undefined;
    const extra: string[] = [];
    for (;;) {
        tail = tail.replace(/^[\s,]+/, '');
        if (!tail) break;
        let hit = /^=\s*([^\s,]+)/.exec(tail);
        if (hit) start = hit[1];
        else if ((hit = /^(?:in\s+)?steps?\s+(?:of\s+)?([^\s,]+)/i.exec(tail))) step = hit[1];
        else if ((hit = /^(?:from|in|between)\s+([^\s,]+?)\s*(?:\.\.|\bto\b|\band\b)\s*([^\s,]+)/i.exec(tail))) [lo, hi] = [hit[1], hit[2]];
        else if ((hit = /^(?:start(?:ing|s)?\s+)?at\s+([^\s,]+)/i.exec(tail))) start = hit[1];
        else {
            // Anything else up to the next comma is a flag (`connected`): it passes through.
            const word = /^[^,]+/.exec(tail);
            if (!word) break;
            hit = word;
            extra.push(word[0].trim());
        }
        tail = tail.slice(hit[0].length);
    }
    const opts: string[] = [];
    if (lo !== undefined) opts.push(`min=${encValue(lo)}`);
    if (hi !== undefined) opts.push(`max=${encValue(hi)}`);
    if (start !== undefined) opts.push(`start=${encValue(start)}`);
    if (step !== undefined) opts.push(`step=${encValue(step)}`);
    for (const e of extra) opts.push(bareOk(e) ? e : bracedOk(e) ? `{${e}}` : quote(e));
    return command('slider', '', opts, head[1]);
}

/** A name a line starts with (`R1: ...`), not a title's colon. */
function nameOf(body: string): { name: string | null; rest: string } {
    const named = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(?!=)/.exec(body);
    if (named && !/^(title|xlabel|ylabel|zlabel)$/i.test(named[1])) return { name: named[1], rest: body.slice(named[0].length).trim() };
    return { name: null, rest: body };
}

/** One object line in words (built-in words) as a Full LaTeX line, or null when no command of its kind fits it. */
function objectFull(raw: string): string | null {
    const line = stripMathDollars(raw).trim();
    if (!line) return null;
    // 6.0 C: `then` before an object line is \then before its command; a bare `then` is \then alone.
    const then = /^then(?![A-Za-z0-9_(])\s*/i.exec(line);
    if (then && !/^(?:[*/^=<>!]|[-+]\s)/.test(line.slice(then[0].length))) {
        const rest = line.slice(then[0].length);
        if (!rest) return '\\then';
        const inner = objectFull(rest) ?? genericFull(rest);
        return inner ? `\\then ${inner}` : null;
    }
    const rawLine = /^raw\s+(tool|function|surface|label|slider)\s+(\{.*\})$/i.exec(line);
    if (rawLine) return command('raw', rawLine[1].toLowerCase(), [], rawLine[2]);
    if (/^slider\s/i.test(line)) return sliderFull(line);
    const split = splitStatement(line);
    const { name, rest } = nameOf(split.body);
    const own = name ? `name=${name}` : '';
    const options = split.options;
    const motion = motionFull(own, rest, options); // 6.0 C
    if (motion !== undefined) return motion;
    const linear = linearFull(own, rest, options); // 6.0 D
    if (linear !== undefined) return linear;
    const iterate = iterateFull(own, rest, options); // 6.0 E
    if (iterate !== undefined) return iterate;
    if (DEFINITION.test(rest)) return command('plot', own, options.map((o) => optionFull(o, SURFACE_HEAD.test(rest) ? 'surface' : 'function')), rest);
    const kw = /^([A-Za-z0-9]+)\b\s*([\s\S]*)$/.exec(rest);
    const word = kw ? kw[1].toLowerCase() : '';
    const after = kw ? kw[2] : '';
    switch (word) {
        case 'plot': {
            const t = after.trim();
            return command('plot', own, options.map((o) => optionFull(o, SURFACE_HEAD.test(t) ? 'surface' : 'function')), t);
        }
        case 'shade':
            return shadeFull(own, after, options);
        case 'draw':
            return drawFull(own, after, options);
        case 'mark':
            return markFull(own, after, options);
        case 'write':
        case 'text':
            return nodeFull(own, after, options);
        default:
            return null;
    }
}

/** <command> <rest>, <options> as \<command>[<options>]{<rest>}, for any line that starts with a word; null otherwise. */
function genericFull(raw: string): string | null {
    const line = stripMathDollars(raw).trim();
    const split = splitStatement(line);
    const { name, rest } = nameOf(split.body);
    const kw = /^([A-Za-z][A-Za-z0-9]*)(?![A-Za-z0-9_])\s*([\s\S]*)$/.exec(rest);
    if (!kw) return null;
    const opts = split.options.map((o) => optionFull(o, 'other'));
    return command(kw[1], name ? `name=${name}` : '', opts, kw[2].trim() ? kw[2].trim() : null);
}

/** A formula line without a verb (4.4: f(x) = x^2, x + y <= 4) given the verb its object needs. */
function withVerb(line: string, verb: string): string {
    const lead = /^\s*/.exec(line)?.[0] ?? '';
    const { name, rest } = nameOf(line.trim());
    return `${lead}${name ? `${name}: ` : ''}${verb} ${rest}`;
}

/** The kind of object a list item is, for the verb a formula line needs. */
function verbFor(list: ObjectList, item: Data | undefined): string | null {
    if (list === 'functions' || list === 'functions3D') return 'plot';
    if (list === 'tools' && item?.type === 'region') return 'shade';
    if (list === 'tools' && item?.type === 'curve') return 'draw';
    return null;
}

/** A line that starts a chart line in words (show, axes, title, set, x numbers, ...). */
const CHART_LINE = /^(?:(?:view|show|axes|no|with|grid|size|equal|polar|3d|cube|box|snippet|frames|variables|set|title|xlabel|ylabel|zlabel)(?![A-Za-z0-9_(])|[xyz]\s+numbers\b)/i; // frames: 6.0 C

const listItems = (v: unknown): Data[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Data[]) : []);

function withoutId(item: Data | null | undefined): string {
    if (!item) return 'null';
    const copy: Data = { ...item };
    delete copy.id;
    return stableJson(copy);
}

const LISTS: ObjectList[] = ['parameters', 'functions', 'functions3D', 'tools', 'annotations'];
const RAW_KIND: Record<ObjectList, string> = { parameters: 'slider', functions: 'function', functions3D: 'surface', tools: 'tool', annotations: 'label' };

/** An object exactly, as JSON. */
function rawFull(list: ObjectList, item: Data): string {
    const copy: Data = { ...item };
    delete copy.id;
    return `\\raw[${RAW_KIND[list]}]{${JSON.stringify(copy)}}`;
}

/** A chart field exactly, as JSON. */
const setFull = (key: string, value: unknown) => `\\set{${key} = ${JSON.stringify(value)}}`;

const fraction = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && !/[\r\n]/.test(v);
const AXIS_STYLE: Record<string, string> = { box: 'box', middle: 'middle', axes: 'left' };

/**
 * Chart fields as one \axis line, in pgfplots' words where it has them
 * (xmin, axis lines, grid, xtick, title, width, ...); `key=value` for the
 * rest. A value a key cannot hold (a title that is a number) gets a \set
 * line after it.
 */
function axisFull(fields: string[], chart: Data): string[] {
    const opts: string[] = [];
    const sets: string[] = [];
    const done = new Set<string>();
    const has = (k: string) => fields.includes(k) && k in chart;
    const generic = (k: string) => opts.push(`${k}=${encJson(JSON.stringify(chart[k]))}`);
    const take = (k: string, write: (v: unknown) => void) => {
        if (!has(k) || done.has(k)) return;
        done.add(k);
        write(chart[k]);
    };
    take('dimension', (v) => (v === true ? opts.push('3d') : generic('dimension')));
    take('boxAspect', (v) => {
        // pgfplots' own key for a box with its own lengths.
        const ratio = v === 'custom' ? boxRatioOf(chart.boxRatio) : null;
        if (v === 'equal') opts.push('cube');
        else if (ratio) {
            opts.push(`plot box ratio={${ratio.join(' ')}}`);
            done.add('boxRatio');
        } else generic('boxAspect');
    });
    take('coordinateSystem', (v) => (v === 'polar' ? opts.push('polar') : generic('coordinateSystem')));
    take('documentSetup', (v) => (v === false ? opts.push('snippet') : generic('documentSetup')));
    take('frames', (v) => (v === true ? opts.push('frames') : generic('frames'))); // 6.0 C
    for (const k of ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax']) {
        take(k, (v) => (typeof v === 'string' || typeof v === 'number' ? opts.push(`${k}=${encValue(String(v).trim())}`) : sets.push(setFull(k, v))));
    }
    const size = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    take('size_x_cm', (v) => (size(v) ? opts.push(`width=${v}cm`) : generic('size_x_cm')));
    take('size_y_cm', (v) => (size(v) ? opts.push(`height=${v}cm`) : generic('size_y_cm')));
    take('equalScale', (v) => (v === true ? opts.push('axis equal') : generic('equalScale')));
    take('axis_style', (v) => (typeof v === 'string' && AXIS_STYLE[v] ? opts.push(`axis lines=${AXIS_STYLE[v]}`) : generic('axis_style')));
    take('showAxis', (v) => (v === false ? opts.push('hide axis') : generic('showAxis')));
    const large = has('showLargeGrid') ? chart.showLargeGrid : undefined;
    const small = has('showSmallGrid') ? chart.showSmallGrid : undefined;
    if (large === true && small === true) opts.push('grid=both');
    else {
        if (large === true) opts.push('grid=major');
        else if (large !== undefined) generic('showLargeGrid');
        if (small === true) opts.push('grid=minor');
        else if (small !== undefined) generic('showSmallGrid');
    }
    done.add('showLargeGrid').add('showSmallGrid');
    take('gridOpacity', (v) => (fraction(v) ? opts.push(`grid opacity=${v}`) : generic('gridOpacity')));
    for (const a of ['x', 'y', 'z']) {
        const [mode, step, at] = [`numbers_${a}`, `numbers_step_${a}`, `numbers_at_${a}`];
        if (!has(mode) && !has(step) && !has(at)) continue;
        let usedStep = false;
        let usedAt = false;
        const v = chart[mode];
        if (has(mode) && v === 'off') opts.push(`${a}tick=\\empty`);
        else if (has(mode) && v === 'every' && filled(chart[step])) {
            opts.push(`${a}tick distance=${encValue(chart[step].trim())}`);
            usedStep = true;
        } else if (has(mode) && v === 'at' && filled(chart[at])) {
            opts.push(`${a}tick=${bracedOk(chart[at].trim()) ? `{${chart[at].trim()}}` : quote(chart[at])}`);
            usedAt = true;
        } else if (has(mode)) generic(mode);
        if (!usedStep && has(step)) generic(step);
        if (!usedAt && has(at)) generic(at);
        done.add(mode).add(step).add(at);
    }
    const text = (k: string, key: string) => take(k, (v) => (typeof v === 'string' ? opts.push(`${key}=${encText(v)}`) : sets.push(setFull(k, v))));
    text('title', 'title');
    text('axis_label_x', 'xlabel');
    text('axis_label_y', 'ylabel');
    text('axis_label_z', 'zlabel');
    text('variables', 'variables');
    for (const k of fields) if (!done.has(k) && k in chart && k !== 'v' && !(LISTS as readonly string[]).includes(k)) take(k, () => generic(k));
    return [...(opts.length ? [`\\axis[${opts.join(', ')}]`] : []), ...sets];
}

/** Chart lines in words (show ..., axes ..., title ..., set ...) as Full LaTeX: one \axis line, and \set lines for what it cannot hold. */
export function axisLines(lines: string[]): string[] {
    const real = lines.filter((l) => l.trim());
    if (!real.length) return [];
    const parsed = parseChartText(real.join('\n'), { trace: true, words: NO_WORDS });
    const fields: string[] = [];
    for (const tr of parsed.lines ?? []) for (const k of tr.chart) if (!fields.includes(k)) fields.push(k);
    return axisFull(fields, parsed.data);
}

/** One object line in words (built-in words) as a Full LaTeX line: its command, else the generic one, else as it is. */
export function fullLine(line: string): string {
    return objectFull(line) ?? genericFull(line) ?? line.trim();
}

/** A Full LaTeX line with its object's name spelled out (name=R2 first in its options). */
export function withName(line: string, name: string): string {
    const lead = /^\s*/.exec(line)?.[0] ?? '';
    const cmd = lexCommand(line);
    if (!cmd || BEGIN.test(line.trim()) || END.test(line.trim())) return `${lead}${name}: ${line.trim()}`;
    const known = cmd.options.find((o) => o.key === 'name');
    if (known) return line.slice(0, known.at) + `name=${name}` + line.slice(known.at + known.text.length);
    const after = cmd.at + 1 + cmd.name.length;
    let i = after;
    while (i < line.length && /\s/.test(line[i])) i++;
    if (line[i] === '[') {
        const empty = line[i + 1] === ']';
        return `${line.slice(0, i + 1)}name=${name}${empty ? '' : ', '}${line.slice(i + 1)}`;
    }
    return `${line.slice(0, after)}[name=${name}]${line.slice(after)}`;
}

/** The chart a text reads as, in a form that compares equal whatever order the keys came in. */
const chartOf = (data: Data): string => stableJson(canonicalData(data));

/** Every chart field set and every object raw: what always reads back as the chart. */
export function exactFull(data: Data): string {
    const min = minimize(data);
    const lines = [FULL_BEGIN];
    for (const k of Object.keys(min)) if (k !== 'v' && !(LISTS as readonly string[]).includes(k)) lines.push(setFull(k, min[k]));
    for (const key of LISTS) for (const item of listItems(min[key])) lines.push(rawFull(key, item));
    lines.push(FULL_END);
    return lines.join('\n');
}

interface Entry {
    /** The line of the words (0-based) an object line comes from; -1 for blank lines, comments and the \axis line. */
    from: number;
    /** Blank lines and comments: the line as it is written. */
    text: string;
    /** How the line is written: 0 its command, 1 the generic command, 2 exactly (raw), 3 the words as they are. */
    level: number;
}

/**
 * A block in words as Full LaTeX: \begin{chart}, the chart lines (show,
 * axes, title, set, ...) merged into one \axis line where the first of
 * them was, every other line its command (blank lines and comments stay,
 * # and // comments become %), \end{chart}. It reads back as the same
 * chart: a line that would not is written with the generic command, then
 * exactly. `builtin`: the words are the built-in ones (the printer's); else
 * a person's own words are read too.
 */
export function wordsToFull(text: string, opts: { builtin?: boolean } = {}): string {
    if (isFullText(text)) return text;
    const words = opts.builtin ? NO_WORDS : chartWords();
    const want = parseChartText(text, { trace: true, words });
    const plain = hasWords(words) ? readWords(text, words, definedNames(want.data)).text : text;
    const lines = plain.split(LINE_BREAK);
    const traces = want.lines ?? [];
    const bad = new Set(want.problems.map((p) => p.line));
    const entries: Entry[] = [];
    const fields: string[] = [];
    let axisAt = -1;
    // Blank lines at the very start and end go: \begin{chart} and \end{chart} take their place.
    let first = lines.findIndex((l) => l.trim());
    if (first < 0) first = lines.length;
    let last = lines.length - 1;
    while (last >= first && !lines[last].trim()) last--;
    lines.forEach((line, i) => {
        const t = line.trim();
        const tr = traces[i];
        if (i < first || i > last) return;
        if (!t) entries.push({ from: -1, text: '', level: 0 });
        else if (/^(%|\/\/|#)/.test(t)) entries.push({ from: -1, text: t.startsWith('%') ? t : `% ${t.replace(/^(\/\/|#)\s?/, '')}`, level: 0 });
        else if (tr && !tr.object && tr.chart.length && !bad.has(i + 1) && CHART_LINE.test(t)) {
            for (const k of tr.chart) if (!fields.includes(k)) fields.push(k);
            if (axisAt < 0) {
                axisAt = entries.length;
                entries.push({ from: -1, text: '', level: 0 });
            }
        } else entries.push({ from: i, text: '', level: 0 });
    });
    const objectAt = (i: number): { list: ObjectList; item: Data } | null => {
        const o = traces[i]?.object;
        const item = o ? listItems(want.data[o.list])[o.index] : undefined;
        return o && item ? { list: o.list, item } : null;
    };
    const render = (e: Entry): string => {
        const line = lines[e.from];
        for (;;) {
            let out: string | null = null;
            if (e.level === 0) {
                out = objectFull(line);
                const obj = objectAt(e.from);
                const verb = obj ? verbFor(obj.list, obj.item) : null;
                // A formula without a verb (4.4): the verb its object needs.
                if (out === null && verb && /[=<>]/.test(line) && !/^\s*(?:[A-Za-z][A-Za-z0-9_]*\s*:\s*)?(?:plot|shade|draw|mark|write|text|slider|raw)\s/i.test(line)) {
                    out = objectFull(withVerb(line, verb));
                }
            } else if (e.level === 1) out = genericFull(line);
            else if (e.level === 2) {
                const obj = objectAt(e.from);
                out = obj ? rawFull(obj.list, obj.item) : null;
            } else return line.trim();
            if (out !== null) return out;
            e.level++;
        }
    };
    const sets: string[] = [];
    for (let round = 0; round < 6; round++) {
        const out = [FULL_BEGIN];
        const origin = [-1];
        const axis = axisAt >= 0 ? axisFull(fields, want.data) : [];
        if (axisAt < 0 && sets.length) {
            out.push(...sets);
            origin.push(...sets.map(() => -1));
        }
        entries.forEach((e, k) => {
            const made = k === axisAt ? [...axis, ...sets] : [e.from < 0 ? e.text : render(e)];
            for (const s of made) {
                out.push(s);
                origin.push(k);
            }
        });
        out.push(FULL_END);
        origin.push(-1);
        const full = out.join('\n');
        const got = parseChartText(full, { trace: true });
        if (chartOf(got.data) === chartOf(want.data)) return full;
        // Lines whose object reads differently go one step further (generic, exact, as written) ...
        let changed = false;
        (got.lines ?? []).forEach((tr, j) => {
            const e = entries[origin[j]];
            if (!e || e.from < 0) return;
            const w = traces[e.from]?.object ?? null;
            const before = w ? listItems(want.data[w.list])[w.index] : null;
            const after = tr.object ? listItems(got.data[tr.object.list])[tr.object.index] : null;
            if ((w?.list ?? null) !== (tr.object?.list ?? null) || withoutId(before) !== withoutId(after)) {
                if (e.level < 3) {
                    e.level++;
                    changed = true;
                }
            }
        });
        // ... and chart fields that read differently are set exactly.
        const a = canonicalData(want.data);
        const b = canonicalData(got.data);
        for (const k of Object.keys(a)) {
            if (k === 'v' || (LISTS as readonly string[]).includes(k) || stableJson(a[k]) === stableJson(b[k])) continue;
            const line = setFull(k, a[k]);
            if (!sets.includes(line)) {
                sets.push(line);
                changed = true;
            }
        }
        if (!changed) break;
    }
    return exactFull(want.data);
}

/** The AI guide with a note on the form this person writes new charts in, when it is Full LaTeX. */
export function guideWithLanguage(guide: string): string {
    if (current !== 'full') return guide;
    return [
        guide.trimEnd(),
        '',
        "## This person's chart language",
        '',
        'They write new charts in Full LaTeX (Settings, Chart language): write new blocks in that form, `\\begin{chart}` to `\\end{chart}` with one command per line (see "Full LaTeX" above). The plugin reads both forms, and a chart keeps the form its block has.',
        '',
    ].join('\n');
}

// ------------------------------------------------------------ 6.0 C: motion

/**
 * \vectorfield[particles, streamlines, colormap/viridis]{F(x, y) = (y, -x)},
 * \restpoints[labelled]{F} and \solution[through=P, t=0:10]{(y, -x)} in words:
 * `draw the vector field ...`, `mark the rest points of F`, `draw the
 * solution of ... through P | for t from 0 to 10`.
 */
function motionWords(cmd: Command): Mapped {
    const m = new Mapped();
    const opts = cmd.options;
    namedInto(m, opts);
    const arg = argOf(cmd);
    const kind = cmd.name.toLowerCase();
    if (kind === 'restpoints') {
        m.put(arg.text ? 'mark the rest points of ' : 'mark the rest points', cmd.at).copy(arg.text, arg.at);
        barInto(m, opts, 'other', 'x', new Set(['name']));
        return m;
    }
    if (kind === 'vectorfield') {
        m.put('draw the vector field ', cmd.at);
        mathInto(m, arg.text, arg.at);
        barInto(m, opts, 'other', 'x', new Set(['name']));
        return m;
    }
    m.put('draw the solution of ', cmd.at);
    mathInto(m, arg.text, arg.at);
    const through = valueOf(opts, 'through');
    if (through) {
        const v = inner(through.value ?? '', through.valueAt);
        const points = splitCommas(v.text, v.at).filter((p) => p.text);
        m.put(' through ', through.at);
        points.forEach((p, i) => {
            if (i) m.put(i === points.length - 1 ? ' and ' : ', ', p.at);
            m.copy(p.text, p.at);
        });
    }
    const t = valueOf(opts, 't');
    const extra: Mapped[] = [];
    const r = t ? rangeOf(t.value ?? '', t.valueAt) : null;
    if (t && r) extra.push(new Mapped().put('for t from ', t.at).copy(r[0].text, r[0].at).put(' to ', t.valueAt).copy(r[1].text, r[1].at));
    barInto(m, r ? opts.filter((o) => o !== t) : opts, 'other', 'x', new Set(['name', 'through']), extra);
    return m;
}

/** A motion line in words as its Full LaTeX command; undefined for any other line, null when no command fits it. */
function motionFull(own: string, rest: string, options: string[]): string | null | undefined {
    const opt = (o: string): string => {
        const c = /^colou?red\s+by\s+(?:length|size|time)(?:\s+in\s+([a-z]+))?$/i.exec(o.trim());
        if (c) return `colormap/${(c[1] ?? 'viridis').toLowerCase()}`;
        if (/^moving\s+particles$/i.test(o.trim())) return 'particles';
        return optionFull(o, 'other');
    };
    const field = /^draw\s+the\s+vector\s+field\s+(?:of\s+)?([\s\S]+)$/i.exec(rest);
    if (field) return command('vectorfield', own, options.map(opt), field[1].trim());
    const restPoints = /^mark\s+the\s+rest\s+points(?:\s+of\s+([A-Za-z][A-Za-z0-9_]*))?$/i.exec(rest);
    if (restPoints) return command('restpoints', own, options.map(opt), restPoints[1] ?? null);
    const sol = /^draw\s+the\s+solutions?\s+of\s+([\s\S]+?)\s+through\s+([\s\S]+)$/i.exec(rest);
    if (!sol || NAME_RE.test(sol[1].trim())) return undefined;
    const points = splitTop(sol[2], ',').flatMap((p) => splitTop(p.text, ' and ')).map((p) => p.text).filter((p) => p);
    const list = points.length === 1 && bareOk(points[0]) ? points[0] : `{${points.join(', ')}}`;
    if (!bracedOk(points.join(', '))) return null;
    const out = [`through=${list}`];
    for (const o of options) {
        const r = /^for\s+t\s+from\s+(.+)$/i.exec(o.trim());
        const range = r ? wordsRange(r[1]) : null;
        if (range) out.push(`t=${encBound(range[0])}:${encBound(range[1])}`);
        else out.push(opt(o));
    }
    return command('solution', own, out, sol[1].trim());
}

// ------------------------------------------------------------ 6.0 D: linear algebra

/**
 * \transform{A} in words: `transform by A` (the parser reads it in 2D and
 * 3D; the printer writes `transform the plane by` or `transform space by`).
 */
function transformWords(cmd: Command): Mapped {
    const m = new Mapped();
    namedInto(m, cmd.options);
    const arg = argOf(cmd);
    m.put('transform by ', cmd.at);
    mathInto(m, arg.text, arg.at);
    barInto(m, cmd.options, 'other', 'x', new Set(['name']));
    return m;
}

/** \draw[grid, from=a, to=b, spacing=s], \draw[basis vectors], \draw[eigenvectors]{A}, \draw[span]{v, w} in words; null for any other \draw. */
function linearDrawWords(cmd: Command): Mapped | null {
    const opts = cmd.options;
    const grid = flagOf(opts, 'grid');
    const basis = flagOf(opts, 'basis vectors', 'basis');
    const eig = flagOf(opts, 'eigenvectors');
    const span = flagOf(opts, 'span');
    if (!grid && !basis && !eig && !span) return null;
    const m = new Mapped();
    namedInto(m, opts);
    const arg = argOf(cmd);
    const used = new Set<Opt>();
    if (grid) {
        used.add(grid);
        m.put('draw the grid', cmd.at);
        const from = valueOf(opts, 'from');
        const to = valueOf(opts, 'to');
        const spacing = valueOf(opts, 'spacing');
        const value = (o: Opt, word: string) => {
            used.add(o);
            const v = inner(o.value ?? '', o.valueAt);
            m.put(word, o.at).copy(v.text.trim(), v.at + (v.text.length - v.text.trimStart().length));
        };
        if (from && to) {
            value(from, ' from ');
            value(to, ' to ');
        }
        if (spacing) value(spacing, ' in steps of ');
    } else if (basis) {
        used.add(basis);
        m.put('draw the basis vectors', cmd.at);
    } else if (eig) {
        used.add(eig);
        m.put('draw the eigenvectors of ', cmd.at);
        mathInto(m, arg.text, arg.at);
    } else if (span) {
        used.add(span);
        m.put('draw the span of ', cmd.at);
        const items = splitCommas(arg.text, arg.at).filter((p) => p.text);
        items.forEach((p, i) => {
            if (i) m.put(i === items.length - 1 ? ' and ' : ', ', p.at);
            mathInto(m, p.text, p.at);
        });
    }
    barInto(
        m,
        opts.filter((o) => !used.has(o)),
        'other',
        'x',
        new Set(['name'])
    );
    return m;
}

/** \shade[unit square] (image, unit cube) in words; null for any other \shade. */
function unitSquareWords(cmd: Command): Mapped | null {
    const opts = cmd.options;
    const square = flagOf(opts, 'unit square', 'unit cube');
    if (!square) return null;
    const image = flagOf(opts, 'image');
    const m = new Mapped();
    namedInto(m, opts);
    m.put(`shade the ${image ? 'image of the ' : ''}${square.key}`, cmd.at);
    barInto(
        m,
        opts.filter((o) => o !== square && o !== image),
        'other',
        'x',
        new Set(['name'])
    );
    return m;
}

/** A line of 6.0 D in words as its Full LaTeX command; undefined for any other line, null when no command fits it. */
function linearFull(own: string, rest: string, options: string[]): string | null | undefined {
    const opts = options.map((o) => optionFull(o, 'other'));
    const transform = /^transform\s+([\s\S]*)$/i.exec(rest);
    if (transform) {
        const read = readTransform(transform[1]);
        if (!read || read.problem) return undefined;
        return command('transform', own, opts, String(read.fields.map));
    }
    const shade = /^shade\s+([\s\S]*)$/i.exec(rest);
    if (shade) {
        const read = readLinearShade(shade[1]);
        if (!read) return undefined;
        const cube = /\bcube\s*$/i.test(shade[1]);
        return command('shade', own, [cube ? 'unit cube' : 'unit square', ...(read.fields.image ? ['image'] : []), ...opts], null);
    }
    const draw = /^draw\s+([\s\S]*)$/i.exec(rest);
    if (!draw) return undefined;
    const read = readLinearDraw(draw[1]);
    if (!read || read.problem) return undefined;
    const f = read.fields;
    switch (read.type) {
        case 'planeGrid': {
            const lead = ['grid'];
            if (typeof f.from === 'string' && typeof f.to === 'string') lead.push(`from=${encValue(f.from)}`, `to=${encValue(f.to)}`);
            if (typeof f.spacing === 'string') lead.push(`spacing=${encValue(f.spacing)}`);
            return command('draw', own, [...lead, ...opts], null);
        }
        case 'basisVectors':
            return command('draw', own, ['basis vectors', ...opts], null);
        case 'eigenvectors':
            return command('draw', own, ['eigenvectors', ...opts], String(f.matrix));
        case 'span':
            return command('draw', own, ['span', ...opts], String(f.vectors).split(';').map((v) => v.trim()).join(', '));
        default:
            return undefined;
    }
}


// ------------------------------------------------------------ 6.0 E: iterate

/** The commands of part E, by tool type. */
const ITERATE_COMMANDS: Record<string, string> = { orbit: 'orbit', cobweb: 'cobweb', bifurcation: 'bifurcation', newton: 'newton', colourPlane: 'colourplane', fourierCircles: 'circles' };
/** Keys of these commands that are no name a recurrence reads. */
const ITERATE_KEYS = new Set(['name', 'steps', 'from', 'to', 'opacity', 'color', 'colour', 'colormap', 'label', 'thickness', 'size', 'step']);

/**
 * \orbit[z_0=0, c=P, steps=40, as a path]{z_{n+1} = z_n^2 + c}, \cobweb[from=0.2, steps=80]{x_{n+1} = f(x_n)},
 * \bifurcation[r=2.5:4]{x_{n+1} = r x_n (1 - x_n)}, \newton[from=2.5, steps=5]{f},
 * \colourplane[z_0=0, c=x + iy, steps=200, colormap/cyclic]{z_{n+1} = z_n^2 + c} and \circles[wave]{\sum ...}
 * in words: `draw the orbit of $...$, $z_0 = 0$, $c = P$, 40 steps | as a path`, and so on.
 */
function iterateWords(cmd: Command): Mapped {
    const m = new Mapped();
    const opts = cmd.options;
    namedInto(m, opts);
    const arg = argOf(cmd);
    const kind = cmd.name.toLowerCase();
    const taken = new Set<Opt>();
    const steps = valueOf(opts, 'steps');
    const from = valueOf(opts, 'from');
    const head: Record<string, string> = { orbit: 'draw the orbit of ', cobweb: 'draw the cobweb of ', bifurcation: 'draw the bifurcation diagram of ', newton: "draw Newton's method for ", colourplane: 'colour the plane by ', colorplane: 'colour the plane by ', circles: 'draw the circles of ' };
    m.put(head[kind] ?? 'draw ', cmd.at);
    if (kind === 'newton') m.copy(arg.text, arg.at);
    else mathInto(m, arg.text, arg.at);
    // A bifurcation's parameter: r=2.5:4 is `for r from 2.5 to 4`.
    if (kind === 'bifurcation') {
        const range = opts.find((o) => o.value !== null && !ITERATE_KEYS.has(o.key) && rangeOf(o.value, o.valueAt));
        const r = range && range.value !== null ? rangeOf(range.value, range.valueAt) : null;
        if (range && r) {
            taken.add(range);
            m.put(` for ${range.name} from `, range.at).copy(r[0].text, r[0].at).put(' to ', range.valueAt).copy(r[1].text, r[1].at);
        }
    }
    if ((kind === 'cobweb' || kind === 'newton') && from) {
        taken.add(from);
        const v = inner(from.value ?? '', from.valueAt);
        m.put(' from ', from.at).copy(v.text, v.at);
    }
    // The start and the names the recurrence reads: $z_0 = 0$, $c = P$.
    if (kind !== 'circles' && kind !== 'newton') {
        for (const o of opts) {
            if (o.value === null || ITERATE_KEYS.has(o.key) || taken.has(o) || o.key.includes(' ')) continue;
            taken.add(o);
            const v = inner(o.value, o.valueAt);
            m.put(', $', o.at).copy(o.name, o.at).put(' = ', o.valueAt).copy(v.text, v.at).put('$', o.valueAt + o.value.length - 1);
        }
    }
    if (steps && kind !== 'circles' && kind !== 'bifurcation') {
        taken.add(steps);
        const v = inner(steps.value ?? '', steps.valueAt);
        m.put(', ', steps.at).copy(v.text, v.at).put(' steps', steps.at);
    }
    barInto(
        m,
        opts.filter((o) => !taken.has(o)),
        'other',
        'x',
        new Set(['name'])
    );
    return m;
}

/** A line of part E in words as its Full LaTeX command; undefined for any other line, null when no command fits it. */
function iterateFull(own: string, rest: string, options: string[]): string | null | undefined {
    const draw = /^draw\s+([\s\S]+)$/i.exec(rest);
    const colour = /^colou?r\s+([\s\S]+)$/i.exec(rest);
    const piece = { text: (draw ?? colour)?.[1] ?? '', at: 0 };
    const read = draw ? readIterateDraw(piece, []) : colour ? readIteratePlane(piece, []) : null;
    if (!read) return undefined;
    if (read.problem) return null;
    const f = read.fields;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const opts: string[] = [];
    const formula = str(f.recurrence) || str(f.formula);
    const rec = formula ? readRecurrence(formula) : null;
    if (read.type === 'bifurcation') opts.push(`${str(f.parameter)}=${encBound(str(f.from))}:${encBound(str(f.to))}`);
    if (read.type === 'cobweb' || read.type === 'newton') {
        if (f.start !== undefined) opts.push(`from=${encValue(str(f.start))}`);
    } else if (f.start !== undefined && rec) opts.push(`${rec.state}_0=${encValue(str(f.start))}`);
    for (const g of givenParts(str(f.given))) opts.push(`${g.name}=${encValue(g.value)}`);
    if (f.steps !== undefined) opts.push(`steps=${encValue(str(f.steps))}`);
    if (f.wave === true) opts.push('wave');
    for (const raw of [...read.extra.map((p) => p.text), ...options]) {
        const o = raw.trim().replace(/^(?:with\s+(?:its\s+|the\s+)?|in\s+)(?=[A-Za-z])/i, '');
        const lower = o.toLowerCase();
        if (read.type === 'colourPlane' && isPlaneColormap(lower)) opts.push(`colormap/${lower}`);
        else if (lower === 'wave') opts.push('wave');
        else opts.push(optionFull(o, 'other'));
    }
    const arg = read.type === 'newton' ? str(f.function) : read.type === 'fourierCircles' ? str(f.sum) : formula;
    return command(ITERATE_COMMANDS[read.type], own, opts, arg);
}
