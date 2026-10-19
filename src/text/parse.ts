/*
 * Easy TikZ charts as text: one line per object, written the way the math
 * reads, instead of one JSON object. Lines read like English:
 *
 *   show x from -3 to 3 and y from -4 to 4
 *   slider a from -1.1 to 1.1, starting at 0.8
 *   plot f(x) = x^3 - 3x in blue, thick, with its tangent at a and its extrema
 *   plot g(x) = f(a) + (3a^2 - 3)(x - a), hidden
 *   shade between f and g from x = min(a, -2a) to max(a, -2a) in orange
 *
 * and the short forms of 4.4.0 keep working (view x -3..3, y -4..4;
 * f(x) = x^3 - 3x | blue, tangent at a; shade ... | orange).
 *
 * parseChartText turns such a block into the same v4 chart object a JSON
 * block holds, so everything downstream (migration, scene, renderers,
 * export, the AI server's checks) is unchanged. Problems carry a line and a
 * column, so the note can point at the spot. Every field of the chart can
 * be written: options and `set` lines take `key=value` for anything the
 * words do not cover.
 */
import { RESERVED_NAMES } from '../migrate';
import { ChartWords, chartWords, hasWords, readWords, shadowed, typedColumn } from './words';

type Data = Record<string, unknown>;

export interface TextProblem {
    /** 1-based line of the block. */
    line: number;
    /** 1-based column. */
    column: number;
    message: string;
}

/** The lists of a chart that hold one object per line. */
export type ObjectList = 'parameters' | 'functions' | 'functions3D' | 'tools' | 'annotations';

/** What one line of the block made (parseChartText with trace). */
export interface LineTrace {
    /** 1-based line. */
    line: number;
    /** The object the line made: its list and index (null for chart lines, comments and lines with problems). */
    object: { list: ObjectList; index: number } | null;
    /** Chart fields the line set (view, title, ...). */
    chart: string[];
}

export interface TextChart {
    data: Data;
    problems: TextProblem[];
    /** One entry per line, with { trace: true }. */
    lines?: LineTrace[];
}

/** Words that start a line (a function may still be called like one: line(x) = ... is a function). */
export const KEYWORDS = new Set([
    'view', 'title', 'xlabel', 'ylabel', 'zlabel', 'axes', 'grid', 'size', 'equal', 'polar', '3d', 'snippet', 'variables', 'set',
    'slider', 'shade', 'line', 'curve', 'levels', 'point', 'points', 'crossings', 'intersections', 'corners', 'max', 'min',
    'integer', 'arrow', 'segment', 'polygon', 'brace', 'text', 'plane', 'raw',
    // the English verbs and openings
    'show', 'plot', 'draw', 'mark', 'write', 'with', 'no', 'double',
]);

export const COLORS = new Set(['black', 'gray', 'red', 'orange', 'brown', 'green', 'teal', 'blue', 'purple', 'magenta']);
const COLOR_ALIASES: Record<string, string> = { grey: 'gray', violet: 'purple', pink: 'magenta', cyan: 'teal', auto: 'black' };
export const THICKNESSES = ['very thin', 'very thick', 'thin', 'thick'];
export const PATTERNS = new Set(['solid', 'horizontal', 'vertical', 'crosshatch', 'dots', 'north-east', 'north-west']);
export const ANCHORS = new Set(['center', 'above', 'below', 'left', 'right']);
const AXIS_STYLES: Record<string, string> = { middle: 'middle', centre: 'middle', center: 'middle', box: 'box', edges: 'axes', edge: 'axes', axes: 'axes' };
export const TOOL_PREFIX: Record<string, string> = { region: 'R', curve: 'C', points: 'P', segment: 'S', plane3D: 'PL' };
const NAME = '[A-Za-z][A-Za-z0-9_]*';
/** A name the block can spell: letters, digits and _. */
export const NAME_RE = new RegExp(`^${NAME}$`);
/** f(x) = ..., c(t) = (..., ...), r(theta) = ..., s(x, y) = ... */
const DEFINITION = new RegExp(`^(${NAME})\\s*\\(\\s*([A-Za-zθ]+)\\s*(?:,\\s*([A-Za-z]+)\\s*)?\\)\\s*=(?!=)\\s*(.*)$`);

/** A piece of a line with where it starts (0-based column), for problems that point at it. */
interface Piece {
    text: string;
    at: number;
}

/** A block is text unless it is a JSON object (which may start with line or block comments). */
export function isChartText(body: string): boolean {
    let t = body.trimStart();
    for (;;) {
        if (t.startsWith('//')) {
            const end = t.indexOf('\n');
            t = end < 0 ? '' : t.slice(end + 1).trimStart();
        } else if (t.startsWith('/*')) {
            const end = t.indexOf('*/');
            t = end < 0 ? '' : t.slice(end + 2).trimStart();
        } else break;
    }
    return !t.startsWith('{');
}

/** Every line break an editor knows: \r\n, \n and a lone \r (CodeMirror splits there too). */
export const LINE_BREAK = /\r\n?|\n/;

/** Split at `sep` where it is outside brackets and quotes; each piece keeps its column. */
export function splitTop(s: string, sep: string, at = 0): Piece[] {
    const out: Piece[] = [];
    let depth = 0;
    let quote = false;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === '"') quote = false;
            continue;
        }
        if (c === '"') quote = true;
        else if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
        else if (depth === 0 && s.startsWith(sep, i)) {
            out.push(trimPiece(s.slice(start, i), at + start));
            start = i + sep.length;
            i += sep.length - 1;
        }
    }
    out.push(trimPiece(s.slice(start), at + start));
    return out;
}

function trimPiece(text: string, at: number): Piece {
    const lead = text.length - text.trimStart().length;
    return { text: text.trim(), at: at + lead };
}

/** The statement and its option phrases. */
interface Split {
    body: Piece;
    /** One piece per option phrase (a phrase may still join several with "and": `thick and dashed`). */
    options: Piece[];
    /** Where the `|` is (0-based), or -1 when the options are written in words. */
    bar: number;
}

/** Words that start an option phrase right after the statement, without a comma: `in red`, `from x = 0 to 4`, `with its extrema`. */
const PHRASE_START = /^(?:in|from|for|with|labelled|labeled)\s/i;

/**
 * The statement and its options: everything after the first `|` that is
 * not part of `||` (outside brackets and quotes), or, in words, the option
 * phrases the line ends with (`..., numbered`, `... in red, thick and
 * dashed`, `... with its tangent at a and its extrema`).
 */
function splitOptions(s: string, english: boolean): Split {
    let head = s;
    let options: Piece[] = [];
    let bar = -1;
    let depth = 0;
    let quote = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === '"') quote = false;
            continue;
        }
        if (c === '"') quote = true;
        else if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
        else if (c === '|' && depth === 0 && s[i - 1] !== '|' && s[i + 1] !== '|') {
            head = s.slice(0, i);
            options = splitTop(s.slice(i + 1), ',', i + 1).filter((p) => p.text);
            bar = i;
            break;
        }
    }
    if (!english) return { body: trimPiece(head, 0), options, bar };
    // In words: the pieces after commas, from the right, as long as each is an option phrase ...
    if (bar < 0) {
        const pieces = splitTop(head, ',');
        let first = pieces.length;
        while (first > 1 && isOptionList(pieces[first - 1].text)) first--;
        if (first < pieces.length) {
            options = pieces.slice(first);
            head = head.slice(0, pieces[first].at).replace(/\s*,\s*$/, '');
        }
    }
    // ... and the phrases right after the statement (`... from x = 0 to 4 in red`). After a bar the statement is all before it.
    for (;;) {
        const cut = bar < 0 ? lastPhrase(head) : -1;
        if (cut < 0) break;
        options.unshift(trimPiece(head.slice(cut), cut));
        head = head.slice(0, cut);
    }
    return { body: trimPiece(head, 0), options, bar };
}

/** Where the option phrase that ends `s` starts (after its last top-level comma), or -1. */
function lastPhrase(s: string): number {
    const starts: number[] = [];
    let depth = 0;
    let quote = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === '"') quote = false;
            continue;
        }
        if (c === '"') quote = true;
        else if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
        else if (depth === 0 && c === ',') starts.length = 0;
        else if (depth === 0 && /\s/.test(c) && PHRASE_START.test(s.slice(i + 1))) starts.push(i + 1);
    }
    for (let k = starts.length - 1; k >= 0; k--) if (isOptionList(s.slice(starts[k]))) return starts[k];
    return -1;
}

/** One line in words or with a bar, as parseChartText reads it: the statement and its option phrases. */
export function splitStatement(line: string): { body: string; options: string[] } {
    const split = splitOptions(line, isEnglish(line));
    return { body: split.body.text, options: split.options.flatMap(optionWords).map((p) => p.text) };
}

/** The options of a piece, one each: `thick and dashed` is two, `label "A and B"` one. */
function optionWords(p: Piece): Piece[] {
    const words = isOptionList(p.text) ? splitTop(p.text, ' and ', p.at) : [p];
    return words.map((w) => ({ text: plainOption(w.text), at: w.at }));
}

const isColour = (w: string) => COLORS.has(COLOR_ALIASES[w.toLowerCase()] ?? w.toLowerCase());

/** An option in its short form: the words that only fill it out dropped (`with its tangent at a` is `tangent at a`, `in red` is `red`). */
function plainOption(o: string): string {
    let t = o.trim();
    for (;;) {
        const next = t.replace(/^(?:and|with|its|the|a|an)\s+(?=[A-Za-z0-9"])/i, '');
        if (next === t) break;
        t = next;
    }
    const colour = /^in\s+([A-Za-z]+)$/i.exec(t);
    if (colour && isColour(colour[1])) return colour[1];
    const words: Record<string, string> = {
        filled: 'fill',
        'not filled': 'no fill',
        outlined: 'outline',
        'lines to the axes': 'drop lines',
        backward: 'backwards',
        'pointing back': 'backwards',
    };
    const word = words[t.toLowerCase()];
    if (word) return word;
    let m = /^(?:labelled|labeled)\s+(.+)$/i.exec(t);
    if (m) return `label ${m[1]}`;
    m = /^([\d.]+)\s+samples$/i.exec(t);
    if (m) return `samples ${m[1]}`;
    return t;
}

const OPTION_WORDS = new Set([
    'hidden', 'dashed', 'numbered', 'extrema', 'legend', 'fill', 'outline', 'dashed outline', 'no fill', 'constraint lines',
    'coordinates', 'drop lines', 'small', 'large', 'normal', 'wireframe', 'backwards', 'above', 'below', 'left', 'right', 'center',
]);

/** Is this piece an option, in either form (`red`, `in red`, `with its tangent at a`, `numbered`, `key=value`)? */
function isOption(raw: string): boolean {
    const o = plainOption(raw);
    const lower = o.toLowerCase();
    if (!o || splitTop(o, ',').length > 1) return false;
    if (isColour(lower) || THICKNESSES.includes(lower) || OPTION_WORDS.has(lower)) return true;
    if (/^(label|labels|legend)\s+"/i.test(o)) return true;
    if (/^tangent(\s+at)?\s+\S/i.test(o)) return true;
    if (/^(opacity\s+[-+\d.e]+|pattern\s+[a-z-]+|samples\s+[\d.]+)$/i.test(o)) return true;
    if (/^(domain|t|theta|θ)\s+\S.*\.\..*\S$/i.test(o)) return true;
    if (/^(from\s+(x|t|theta|θ)\s*=|for\s+(x|y|t|theta|θ)\s+from\s).+\sto\s.+$/i.test(o)) return true;
    if (/^[xy]\s+(from\s.+\sto\s.+|\S.*\.\..*\S)$/i.test(o)) return true;
    // key=value with a field name (not an equation such as x = 3 or c = 6) and a JSON value.
    const kv = /^([A-Za-z][A-Za-z0-9_]{2,})\s*=\s*(.+)$/.exec(o);
    if (kv && !/[<>!]/.test(kv[2])) {
        try {
            JSON.parse(kv[2]);
            return true;
        } catch {
            return false;
        }
    }
    return false;
}

/** One option phrase, or several joined by "and" (`thick and dashed`, `its tangent at a and its extrema`). */
function isOptionList(text: string): boolean {
    const t = text.trim();
    return !!t && splitTop(t, ' and ').every((p) => isOption(p.text));
}

/** A line in words: anything but the chart lines (view, axes, slider, ...), whose words are their own. */
function isEnglish(line: string): boolean {
    const named = new RegExp(`^\\s*(${NAME})\\s*:(?!=)`).exec(line);
    const body = (named ? line.slice(named[0].length) : line).trim();
    if (DEFINITION.test(body)) return true;
    const lead = /^([A-Za-z0-9]+)/.exec(body);
    return !lead || !CHART_WORDS.has(lead[1].toLowerCase());
}

/** A "quoted" string at the start of `s` (JSON escapes), and what follows it. */
function takeQuoted(s: string): { text: string; rest: string } | null {
    const t = s.trimStart();
    if (!t.startsWith('"')) return null;
    for (let i = 1; i < t.length; i++) {
        if (t[i] === '\\') {
            i++;
            continue;
        }
        if (t[i] === '"') {
            try {
                return { text: JSON.parse(t.slice(0, i + 1)) as string, rest: t.slice(i + 1).trim() };
            } catch {
                return null;
            }
        }
    }
    return null;
}

/** Text that may be quoted or not: `"slope at {a}"` or slope at {a}. */
function textValue(s: string): string {
    const q = takeQuoted(s);
    return q && !q.rest ? q.text : s.trim();
}

/** `a..b` (or `a to b`) as two formula strings. */
function parseRange(s: string): [string, string] | null {
    const parts = splitTop(s, '..');
    if (parts.length === 2 && parts[0].text && parts[1].text) return [parts[0].text, parts[1].text];
    const to = splitTop(s, ' to ');
    if (to.length === 2 && to[0].text && to[1].text) return [to[0].text, to[1].text];
    return null;
}

function numberOf(s: string): number | null {
    const t = s.trim();
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

/** A raw `key=value`: the value as JSON when it is JSON, otherwise as text. */
function rawValue(s: string): unknown {
    const t = s.trim();
    try {
        return JSON.parse(t);
    } catch {
        return t;
    }
}

class Builder {
    readonly problems: TextProblem[] = [];
    readonly chart: Data = { v: 4 };
    readonly parameters: Data[] = [];
    readonly functions: Data[] = [];
    readonly tools: Data[] = [];
    readonly annotations: Data[] = [];
    readonly surfaces: Data[] = [];
    readonly taken = new Set<string>();
    /** Names the block gives explicitly somewhere: automatic names (R1, P1, f1, ...) never take them. */
    readonly explicit = new Set<string>();
    line = 0;
    is3D = false;
    /** Tools that point at "the region": the one region of the chart, known once every line is read. */
    readonly theRegion: Array<{ tool: Data; line: number; at: number }> = [];

    problem(at: number, message: string) {
        this.problems.push({ line: this.line, column: at + 1, message });
    }

    /** A name the user gave, checked: letters, digits and _, not a built-in, not taken twice. */
    claim(name: string, at: number): string | null {
        if (RESERVED_NAMES.has(name)) {
            this.problem(at, `"${name}" is a built-in name; pick another name`);
            return null;
        }
        if (this.taken.has(name)) {
            this.problem(at, `the name ${name} is used twice`);
            return null;
        }
        this.taken.add(name);
        return name;
    }

    nextName(prefix: string): string {
        for (let n = 1; ; n++) {
            const name = `${prefix}${n}`;
            if (!this.taken.has(name) && !this.explicit.has(name)) {
                this.taken.add(name);
                return name;
            }
        }
    }

    /** The list lengths and chart fields now, to see what the next line adds. */
    snapshot(): { lengths: number[]; chart: Map<string, string> } {
        const chart = new Map<string, string>();
        for (const [k, v] of Object.entries(this.chart)) chart.set(k, JSON.stringify(v));
        return { lengths: this.lists().map(([, list]) => list.length), chart };
    }

    traceSince(before: { lengths: number[]; chart: Map<string, string> }, line: number): LineTrace {
        let object: LineTrace['object'] = null;
        this.lists().forEach(([list, items], i) => {
            if (items.length > before.lengths[i]) object = { list, index: items.length - 1 };
        });
        const chart = Object.keys(this.chart).filter((k) => before.chart.get(k) !== JSON.stringify(this.chart[k]));
        return { line, object, chart };
    }

    private lists(): Array<[ObjectList, Data[]]> {
        return [
            ['parameters', this.parameters],
            ['functions', this.functions],
            ['functions3D', this.surfaces],
            ['tools', this.tools],
            ['annotations', this.annotations],
        ];
    }

    data(): Data {
        const out: Data = { ...this.chart };
        if (this.parameters.length) out.parameters = this.parameters;
        if (this.functions.length) out.functions = this.functions;
        if (this.surfaces.length) out.functions3D = this.surfaces;
        if (this.tools.length) out.tools = this.tools;
        if (this.annotations.length) out.annotations = this.annotations;
        return out;
    }
}

/** Lines about the chart itself, and sliders: their words are their own, and they take no options. */
const CHART_WORDS = new Set(['view', 'show', 'axes', 'no', 'grid', 'with', 'size', 'equal', 'polar', '3d', 'snippet', 'variables', 'set', 'slider']);

/** What each kind of object accepts as options, for messages. */
const OPTION_HELP: Record<string, string> = {
    function:
        'in a colour, thin, thick, dashed, hidden, with a legend, with the legend "text", from x = a to b, with its tangent at a, with its extrema, filled, opacity 0.3, pattern dots',
    region: 'in a colour, opacity 0.3, pattern dots, outlined, with a dashed outline, not filled, with constraint lines, numbered, labelled "text", hidden',
    curve: 'in a colour, thin, thick, dashed, labelled "text", hidden',
    points: 'in a colour, small, large, with lines to the axes, with coordinates, labelled "text", hidden',
    segment: 'in a colour, thin, thick, dashed, backwards, labelled "text", hidden',
    text: 'in a colour, small, large, above, below, left, right, center, hidden',
    surface: 'in a colour, for x from a to b and y from c to d, opacity 0.7, 40 samples, wireframe, hidden',
    plane: 'in a colour, opacity 0.25, hidden',
};

/** Apply the options to `target`; problems are recorded. */
function applyOptions(b: Builder, kind: keyof typeof OPTION_HELP, target: Data, options: Piece[]) {
    for (const opt of options.flatMap(optionWords)) {
        const o = opt.text;
        if (!o) continue;
        const lower = o.toLowerCase();
        const color = COLOR_ALIASES[lower] ?? lower;
        if (COLORS.has(color)) {
            target.color = color;
            continue;
        }
        const thick = THICKNESSES.find((t) => lower === t);
        if (thick && kind !== 'text' && kind !== 'points' && kind !== 'surface' && kind !== 'plane') {
            target.thickness = thick;
            continue;
        }
        if (lower === 'hidden') {
            target.hidden = true;
            continue;
        }
        const raw = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(o);
        if (raw && !/[<>!=]$/.test(raw[1])) {
            target[raw[1]] = rawValue(raw[2]);
            continue;
        }
        if (/^label\s/i.test(o) && kind !== 'text' && kind !== 'surface' && kind !== 'plane') {
            target.label = textValue(o.slice(5));
            continue;
        }
        if (applyKindOption(b, kind, target, opt)) continue;
        b.problem(opt.at, `unknown option "${o}"; a ${kind} takes: ${OPTION_HELP[kind]}`);
    }
}

function applyKindOption(b: Builder, kind: string, target: Data, opt: Piece): boolean {
    const o = opt.text;
    const lower = o.toLowerCase();
    const word = (re: RegExp) => re.exec(o);
    if (kind === 'function') {
        if (lower === 'dashed') return set(target, 'dashed', true);
        if (lower === 'extrema') return set(target, 'extrema', true);
        if (lower === 'fill') return set(target, 'fill', true);
        if (lower === 'legend') return set(target, 'showLegend', true);
        let m = word(/^legend\s+(.+)$/i);
        if (m) {
            target.showLegend = true;
            target.legendLabel = textValue(m[1]);
            return true;
        }
        m = word(/^(?:domain|t|theta|θ)\s+(.+)$/i) ?? word(/^(?:from\s+[xt]\s*=|for\s+(?:x|t|theta|θ)\s+from)\s*(.+)$/i);
        if (m) {
            const r = parseRange(m[1]);
            if (!r) return badRange(b, opt);
            target.domain = `${r[0]}:${r[1]}`;
            return true;
        }
        m = word(/^tangent(?:\s+at)?\s+(.+)$/i);
        if (m) {
            target.tangent = true;
            target.tangentPoint = m[1].trim();
            return true;
        }
        m = word(/^opacity\s+(.+)$/i);
        if (m) return numberOption(b, opt, target, 'fillOpacity', m[1]);
        m = word(/^pattern\s+(.+)$/i);
        if (m) return patternOption(b, opt, target, m[1]);
        return false;
    }
    if (kind === 'region') {
        let m = word(/^opacity\s+(.+)$/i);
        if (m) return numberOption(b, opt, target, 'fillOpacity', m[1]);
        m = word(/^pattern\s+(.+)$/i);
        if (m) return patternOption(b, opt, target, m[1]);
        if (lower === 'outline') return set(target, 'outline', 'solid');
        if (lower === 'dashed outline') return set(target, 'outline', 'dashed');
        if (lower === 'no fill') return set(target, 'fill', false);
        if (lower === 'constraint lines') return set(target, 'constraintLines', true);
        if (lower === 'numbered') return set(target, 'numbered', true);
        if (lower === 'fill') return true;
        m = word(/^(?:from|for)\s+([xy])\s*(?:=|from)\s*(.+)$/i);
        if (m) {
            const r = parseRange(m[2]);
            if (!r) return badRange(b, opt);
            (target.conditions as string[]).push(`${r[0]} <= ${m[1].toLowerCase()} <= ${r[1]}`);
            if (Array.isArray(target.conditionLabels)) (target.conditionLabels as string[]).push('');
            return true;
        }
        return false;
    }
    if (kind === 'curve' || kind === 'segment') {
        if (lower === 'dashed') return set(target, 'dashed', true);
        if (kind === 'segment' && lower === 'backwards' && target.style === 'forward') return set(target, 'style', 'backward');
        return false;
    }
    if (kind === 'points') {
        if (lower === 'small' || lower === 'large' || lower === 'normal') return set(target, 'size', lower);
        if (lower === 'drop lines') return set(target, 'dropLines', true);
        if (lower === 'coordinates') return set(target, 'label', '({x:2}, {y:2})');
        const m = word(/^labels\s+(.+)$/i);
        if (m) return set(target, 'label', textValue(m[1]));
        return false;
    }
    if (kind === 'text') {
        if (ANCHORS.has(lower)) return set(target, 'anchor', lower);
        if (lower === 'small' || lower === 'large' || lower === 'normal') return set(target, 'size', lower);
        return false;
    }
    if (kind === 'surface') {
        let m = word(/^(?:for\s+)?([xy])\s+(?:from\s+)?(.+)$/i);
        if (m) {
            const r = parseRange(m[2]);
            if (!r) return badRange(b, opt);
            target[m[1].toLowerCase() === 'x' ? 'xDomain' : 'yDomain'] = `${r[0]}:${r[1]}`;
            return true;
        }
        m = word(/^opacity\s+(.+)$/i);
        if (m) return numberOption(b, opt, target, 'opacity', m[1]);
        m = word(/^samples\s+(.+)$/i);
        if (m) return numberOption(b, opt, target, 'samples', m[1]);
        if (lower === 'wireframe') return set(target, 'wireframe', true);
        return false;
    }
    if (kind === 'plane') {
        const m = word(/^opacity\s+(.+)$/i);
        if (m) return numberOption(b, opt, target, 'fillOpacity', m[1]);
        return false;
    }
    return false;
}

function set(target: Data, key: string, value: unknown): true {
    target[key] = value;
    return true;
}

function badRange(b: Builder, opt: Piece): true {
    b.problem(opt.at, `"${opt.text}" needs a range such as 0..2pi`);
    return true;
}

function numberOption(b: Builder, opt: Piece, target: Data, key: string, value: string): true {
    const n = numberOf(value);
    if (n === null) b.problem(opt.at, `"${opt.text}" needs a number`);
    else target[key] = n;
    return true;
}

function patternOption(b: Builder, opt: Piece, target: Data, value: string): true {
    const p = value.trim().toLowerCase();
    if (!PATTERNS.has(p)) b.problem(opt.at, `unknown pattern "${value.trim()}"; patterns: ${[...PATTERNS].join(', ')}`);
    else target.fillPattern = p;
    return true;
}

/** A path of points: `(0, 0) -- (3, 2) -- P1` as the plugin's `(0, 0); (3, 2); P1`. */
function pathOf(parts: Piece[]): string {
    return parts.map((p) => p.text).join('; ');
}

/** `p` without the start `re` matches (its column moved along), or null when it does not start so. */
function after(p: Piece, re: RegExp): Piece | null {
    const m = re.exec(p.text);
    if (!m || m.index !== 0) return null;
    return trimPiece(p.text.slice(m[0].length), p.at + m[0].length);
}

/** `p` without the start `re` matches, when it does. */
const drop = (p: Piece, re: RegExp): Piece => after(p, re) ?? p;

/**
 * Region condition entries from `where a and b`, `between f and g`,
 * `under f`, `a, b, c` and `... for ...`, each with an optional "label".
 */
function conditionsOf(b: Builder, body: Piece): { conditions: string[]; labels: string[] } {
    const conditions: string[] = [];
    const labels: string[] = [];
    const add = (piece: Piece) => {
        let t = piece.text;
        let label = '';
        const q = /"((?:[^"\\]|\\.)*)"\s*$/.exec(t);
        if (q && q.index > 0) {
            try {
                label = JSON.parse(`"${q[1]}"`) as string;
            } catch {
                label = q[1];
            }
            t = t.slice(0, q.index).trim();
        }
        const between = /^between\s+(\S+)\s+and\s+(\S+)$/i.exec(t);
        const under = /^under\s+(\S+)$/i.exec(t);
        if (between) t = `min(${between[1]}, ${between[2]}) <= y <= max(${between[1]}, ${between[2]})`;
        else if (under) t = `min(0, ${under[1]}) <= y <= max(0, ${under[1]})`;
        // An empty entry (`x >= 0, y >= 0,`) is a condition still to be filled in, as in the editor.
        conditions.push(t);
        labels.push(label);
    };
    // After "where", "and" joins conditions too (unless an "or" groups them: and binds tighter).
    const where = after(body, /^(?:the\s+(?:region|area)\s+)?where\s+/i);
    const lead = where ?? drop(body, /^the\s+(?:region|area)\s+(?=(?:between|under)\s)/i);
    const entries = (p: Piece) => {
        const parts = splitTop(p.text, ',', p.at);
        if (!where || splitTop(p.text, ' or ').length > 1 || splitTop(p.text, '||').length > 1) return parts;
        return parts.flatMap((q) => splitTop(q.text, ' and ', q.at));
    };
    const [main, ...rest] = splitTop(lead.text, ' for ', lead.at);
    const mainPieces = /^(between|under)\s/i.test(main.text) ? [main] : entries(main);
    for (const p of mainPieces) add(p);
    for (const r of rest) for (const p of entries(r)) add(p);
    return { conditions, labels };
}

/** Is this condition a plain sign condition like x >= 0 (left out by `numbered`)? */
export function isSignCondition(c: string): boolean {
    return /^\s*[A-Za-z][A-Za-z0-9_]*\s*>=\s*0\s*$/.test(c) || /^\s*0\s*<=\s*[A-Za-z][A-Za-z0-9_]*\s*$/.test(c);
}

function addTool(b: Builder, type: string, name: string | null, fields: Data, options: Piece[], kind: keyof typeof OPTION_HELP): Data {
    const tool: Data = { type, name: name ?? b.nextName(TOOL_PREFIX[type]), ...fields };
    applyOptions(b, kind, tool, options);
    if (type === 'region') {
        const conditions = tool.conditions as string[];
        const labels = (tool.conditionLabels as string[]) || conditions.map(() => '');
        if (tool.numbered) {
            let k = 0;
            tool.conditionLabels = conditions.map((c, i) => labels[i] || (isSignCondition(c) ? '' : `(${++k})`));
            delete tool.numbered;
        } else if (labels.some((l) => l)) tool.conditionLabels = labels;
        else delete tool.conditionLabels;
    }
    b.tools.push(tool);
    return tool;
}

/**
 * Parse a text block into a v4 chart; with { trace: true } also what each
 * line made. A person's own chart words (src/text/words.ts, the settings'
 * by default) are read as the built-in ones; problems point at the line as
 * it was typed.
 */
export function parseChartText(text: string, opts: { trace?: boolean; words?: ChartWords } = {}): TextChart {
    const words = opts.words ?? chartWords();
    if (!hasWords(words)) return parseBuiltin(text, opts);
    let read = readWords(text, words);
    let out = parseBuiltin(read.text, opts);
    // A name the chart defines stays a name, even when it is spelled like one of their words.
    const names = definedNames(out.data);
    if (shadowed(words, names)) {
        read = readWords(text, words, names);
        out = parseBuiltin(read.text, opts);
    }
    for (const p of out.problems) p.column = typedColumn(read.maps, p.line, p.column);
    return out;
}

/** The names a chart defines (sliders, functions, surfaces, shapes), lowercase. */
export function definedNames(data: Data): Set<string> {
    const names = new Set<string>();
    for (const key of ['parameters', 'functions', 'functions3D', 'tools']) {
        const list = data[key];
        if (!Array.isArray(list)) continue;
        for (const item of list) if (item && typeof item === 'object' && typeof (item as Data).name === 'string') names.add(((item as Data).name as string).toLowerCase());
    }
    return names;
}

function parseBuiltin(text: string, opts: { trace?: boolean }): TextChart {
    const b = new Builder();
    const lines = text.split(LINE_BREAK);
    // Names first, so a line may use a name defined further down; and 3D charts read their tuples as (x, y, z).
    lines.forEach((raw) => {
        const t = raw.trim();
        const named = new RegExp(`^(${NAME})\\s*:(?!=)\\s*`).exec(t);
        // plot and draw only say what the line does: `plot z = ...` is a surface as `z = ...` is.
        const body = (named ? t.slice(named[0].length) : t).replace(/^(?:plot|draw)\s+(?:the\s+)?/i, '');
        const surface = new RegExp(`^(${NAME})\\s*\\(\\s*[A-Za-z]+\\s*,\\s*[A-Za-z]+\\s*\\)\\s*=(?!=)`).exec(body);
        if (/^3d$/i.test(t) || /^plane\s+(?:at\s+)?[xyz]\s*=/i.test(body) || /^z\s*=(?!=)/.test(body) || (surface && !RESERVED_NAMES.has(surface[1]))) {
            b.is3D = true;
        }
        const def = new RegExp(`^(${NAME})\\s*\\(\\s*[A-Za-zθ]+\\s*(?:,\\s*[A-Za-z]+\\s*)?\\)\\s*=(?!=)`).exec(body);
        const slider = new RegExp(`^slider\\s+(${NAME})\\b`).exec(t);
        const explicit = named?.[1] ?? def?.[1] ?? slider?.[1] ?? rawName(t);
        if (explicit) b.explicit.add(explicit);
    });
    const traces: LineTrace[] = [];
    lines.forEach((raw, i) => {
        b.line = i + 1;
        const line = raw.replace(/\s+$/, '');
        const t = line.trim();
        const before = opts.trace ? b.snapshot() : null;
        if (t && !t.startsWith('%') && !t.startsWith('//') && !t.startsWith('#')) statement(b, line);
        if (before) traces.push(b.traceSince(before, i + 1));
    });
    // "the region" is the chart's one region.
    const regions = b.tools.filter((tool) => tool.type === 'region');
    for (const ref of b.theRegion) {
        if (regions.length === 1) ref.tool.regionName = regions[0].name;
        else {
            const message = regions.length
                ? `"the region" is unclear: this chart shades ${regions.length} regions. Name one (R1: shade ...) and write R1 instead`
                : '"the region" needs a shaded region: shade where x + y <= 4 and x >= 0 and y >= 0';
            b.problems.push({ line: ref.line, column: ref.at + 1, message });
        }
    }
    b.problems.sort((p, q) => p.line - q.line || p.column - q.column);
    if (b.is3D) b.chart.dimension = true;
    const out: TextChart = { data: b.data(), problems: b.problems };
    if (opts.trace) out.lines = traces;
    return out;
}

/** The name in a `raw tool {...}` line, for the names-first pass. */
function rawName(t: string): string | undefined {
    const m = /^raw\s+(?:tool|function|surface|slider)\s+(\{.*\})$/i.exec(t);
    if (!m) return undefined;
    try {
        const obj = JSON.parse(m[1]) as unknown;
        const name = obj && typeof obj === 'object' ? (obj as Data).name : undefined;
        return typeof name === 'string' && new RegExp(`^${NAME}$`).test(name) ? name : undefined;
    } catch {
        return undefined;
    }
}

function statement(b: Builder, line: string) {
    // A title or axis name is the whole rest of the line, `|` included (quote it to keep spaces at its ends).
    const titled = /^(\s*)(title|xlabel|ylabel|zlabel)(?![A-Za-z0-9_(])\s*:?\s*(.*)$/i.exec(line);
    if (titled) {
        const key = titled[2].toLowerCase();
        const value = textValue(titled[3]);
        if (key === 'title') b.chart.title = value;
        else b.chart[`axis_label_${key[0]}`] = value;
        return;
    }
    const split = splitOptions(line, isEnglish(line));
    const options = split.options;
    let body = split.body;
    // An optional name: `R1: shade ...`, `P1: mark the maximum of 2x + 3y in R1`.
    let name: string | null = null;
    const named = new RegExp(`^(${NAME})\\s*:\\s*(?!=)`).exec(body.text);
    if (named && !/^(title|xlabel|ylabel|zlabel)$/i.test(named[1])) {
        name = b.claim(named[1], body.at);
        body = { text: body.text.slice(named[0].length).trim(), at: body.at + named[0].length };
    }
    const t = body.text;
    // A definition first: a function may be called like a keyword (line(x) = ..., size(x) = ...).
    // A built-in at the start (max(x, y) = 1, min(f, g) <= y) begins a formula instead.
    const call = /^([A-Za-z][A-Za-z0-9_]*)\s*\(/.exec(t);
    if (call && RESERVED_NAMES.has(call[1])) return formulaLine(b, name, body, options);
    if (DEFINITION.test(t)) return formulaLine(b, name, body, options);
    const kw = /^([A-Za-z0-9]+)\b\s*(.*)$/.exec(t);
    const word = kw ? kw[1].toLowerCase() : '';
    if (split.bar >= 0 && CHART_WORDS.has(word)) b.problem(split.bar, `${word} takes no options after |`);
    const restAt = kw ? body.at + t.length - kw[2].length : body.at;
    const rest: Piece = { text: kw ? kw[2] : '', at: restAt };
    // A formula that starts with a name like a word of the syntax (`mark + x = 3`, a slider called mark) is a formula.
    if (/^(show|no|with|plot|draw|mark|write|double)$/.test(word) && /^(?:[*/^=<>!]|[-+]\s)/.test(rest.text)) return formulaLine(b, name, body, options);

    switch (word) {
        case 'view':
        case 'show':
            return view(b, word, rest);
        case 'axes':
            return axes(b, rest);
        case 'no':
            if (/^axes$/i.test(rest.text.trim())) b.chart.showAxis = false;
            else b.problem(body.at, 'did you mean "no axes"?');
            return;
        case 'with':
            return withLine(b, rest);
        case 'grid': {
            const g = rest.text.trim().toLowerCase();
            if (!g || g === 'major') b.chart.showLargeGrid = true;
            else if (g === 'minor') b.chart.showSmallGrid = true;
            else if (g === 'fine' || g === 'both') b.chart.showLargeGrid = b.chart.showSmallGrid = true;
            else b.problem(rest.at, 'grid takes nothing, major, minor or fine');
            return;
        }
        case 'size': {
            const m = /^([\d.]+)\s*(?:x|by|×)\s*([\d.]+)\s*(cm)?$/i.exec(rest.text.trim());
            if (!m) return b.problem(rest.at, 'size takes width x height in cm, such as size 12 x 6');
            b.chart.size_x_cm = Number(m[1]);
            b.chart.size_y_cm = Number(m[2]);
            return;
        }
        case 'equal':
            if (/^scale$/i.test(rest.text.trim())) b.chart.equalScale = true;
            else b.problem(body.at, 'did you mean "equal scale"?');
            return;
        case 'polar':
            if (rest.text.trim()) b.problem(rest.at, 'polar stands alone on its line');
            b.chart.coordinateSystem = 'polar';
            return;
        case '3d':
            if (rest.text.trim()) b.problem(rest.at, '3d stands alone on its line');
            b.chart.dimension = true;
            return;
        case 'raw':
            return rawLine(b, rest);
        case 'snippet':
            if (rest.text.trim()) b.problem(rest.at, 'snippet stands alone on its line');
            b.chart.documentSetup = false;
            return;
        case 'variables':
            b.chart.variables = rest.text.trim();
            return;
        case 'set':
            return setLine(b, rest);
        case 'slider':
            return slider(b, rest);
        case 'plot':
            return plot(b, name, rest, options);
        case 'draw':
            return draw(b, name, rest, options);
        case 'mark':
            return mark(b, name, rest, options);
        case 'write':
        case 'text':
            return textLine(b, word, rest, options);
        case 'shade':
            addTool(b, 'region', name, conditionFields(b, rest), options, 'region');
            return;
        case 'line':
            if (after(rest, /^from\s/i)) return segment(b, 'segment', name, rest, options);
            return curve(b, name, rest, options);
        case 'curve':
            return curve(b, name, rest, options);
        case 'levels':
            return levels(b, name, rest, options);
        case 'point':
        case 'points':
            return pointList(b, name, rest, options);
        case 'crossings':
        case 'intersections':
            return mark(b, name, { text: `${word} ${rest.text}`, at: body.at }, options);
        case 'corners':
            return mark(b, name, { text: `corners ${rest.text}`, at: body.at }, options);
        case 'max':
        case 'min': {
            const m = /^(?:of\s+)?(.+?)\s+(?:over|on|in)\s+(the\s+region|\S+)$/i.exec(rest.text.trim());
            if (!m) return b.problem(rest.at, `${word} takes an objective and a region: ${word} 2x + 3y over R1`);
            return regionPoints(b, name, 'region', m[2], rest, { objective: m[1].trim(), sense: word }, options);
        }
        case 'integer':
            return mark(b, name, { text: `integer ${rest.text}`, at: body.at }, options);
        case 'double':
            if (/^arrows?\b/i.test(rest.text)) return segment(b, 'double', name, drop(rest, /^arrows?\s*/i), options);
            return b.problem(body.at, 'did you mean "double arrow from A to B"?');
        case 'arrow':
        case 'segment':
        case 'polygon':
        case 'brace':
            return segment(b, word, name, rest, options);
        case 'plane':
            return plane(b, name, rest, options);
        default:
            return formulaLine(b, name, body, options);
    }
}

function view(b: Builder, word: string, rest: Piece) {
    for (const piece of splitTop(rest.text, ',', rest.at)) {
        for (const part of splitTop(piece.text, ' and ', piece.at)) {
            const m = /^([xyz])\s+(?:from\s+)?(.+)$/i.exec(part.text);
            const r = m ? parseRange(m[2]) : null;
            if (!m || !r) {
                b.problem(part.at, word === 'view' ? 'view takes ranges such as x -3..3, y -4..4' : 'show takes ranges such as x from -3 to 3 and y from -4 to 4');
                continue;
            }
            const axis = m[1].toLowerCase();
            b.chart[`${axis}min`] = r[0];
            b.chart[`${axis}max`] = r[1];
        }
    }
}

function axes(b: Builder, rest: Piece) {
    const style = rest.text
        .trim()
        .toLowerCase()
        .replace(/^(?:on|in|at)\s+(?:the\s+|a\s+)?/, '');
    if (style === 'none') b.chart.showAxis = false;
    else if (AXIS_STYLES[style]) b.chart.axis_style = AXIS_STYLES[style];
    else b.problem(rest.at, 'axes takes on the edges, in the middle or in a box (or write no axes)');
}

function withLine(b: Builder, rest: Piece) {
    const g = rest.text
        .trim()
        .toLowerCase()
        .replace(/^(?:a|an|the)\s+/, '');
    if (g === 'grid' || g === 'major grid') b.chart.showLargeGrid = true;
    else if (g === 'fine grid') b.chart.showLargeGrid = b.chart.showSmallGrid = true;
    else if (g === 'minor grid') b.chart.showSmallGrid = true;
    else if (g === 'equal scale') b.chart.equalScale = true;
    else b.problem(rest.at, 'with takes a grid, a fine grid or a minor grid');
}

function setLine(b: Builder, rest: Piece) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(rest.text.trim());
    if (!m) return b.problem(rest.at, 'set takes a field and a value: set previewSize = 900');
    b.chart[m[1]] = rawValue(m[2]);
}

/** The parts of a slider line after its name, in any order: `= 6`, `from 0 to 15`, `in 0..15`, `starting at 6`, `in steps of 0.5`, `step 0.5`. */
const SLIDER_PARTS: Array<{ re: RegExp; part: 'value' | 'range' | 'step' }> = [
    { re: /^=\s*([^\s,]+)/, part: 'value' },
    { re: /^(?:in\s+)?steps?\s+(?:of\s+)?([^\s,]+)/i, part: 'step' },
    { re: /^(?:from|in|between)\s+([^\s,]+?)\s*(?:\.\.|\bto\b|\band\b)\s*([^\s,]+)/i, part: 'range' },
    { re: /^(?:start(?:ing|s)?\s+)?at\s+([^\s,]+)/i, part: 'value' },
];

function slider(b: Builder, rest: Piece) {
    const text = rest.text.trim();
    const head = new RegExp(`^(${NAME})(?![A-Za-z0-9_])\\s*(.*)$`).exec(text);
    if (!head) return b.problem(rest.at, 'slider takes a name and a range: slider a from 0 to 5, starting at 1');
    const got: { value?: string; lo?: string; hi?: string; step?: string } = {};
    let tail = head[2];
    for (;;) {
        tail = tail.replace(/^[\s,]+/, '');
        if (!tail) break;
        const hit = SLIDER_PARTS.map((p) => ({ p, m: p.re.exec(tail) })).find((h) => h.m);
        if (!hit || !hit.m) return b.problem(rest.at + text.length - tail.length, `slider ${head[1]}: "${tail}" is not a range, start or step. Write: slider ${head[1]} from 0 to 5, starting at 1`);
        if (hit.p.part === 'range') [got.lo, got.hi] = [hit.m[1], hit.m[2]];
        else got[hit.p.part] = hit.m[1];
        tail = tail.slice(hit.m[0].length);
    }
    const name = b.claim(head[1], rest.at);
    if (got.value === undefined && got.lo === undefined) return b.problem(rest.at, `slider ${head[1]} needs a range: slider ${head[1]} from 0 to 10`);
    let min = 0;
    let max = 10;
    if (got.lo !== undefined && got.hi !== undefined) {
        const lo = numberOf(got.lo);
        const hi = numberOf(got.hi);
        if (lo === null || hi === null || !(lo < hi)) return b.problem(rest.at, `the range of slider ${head[1]} must be numbers, low to high`);
        min = lo;
        max = hi;
    }
    const value = got.value === undefined ? min : numberOf(got.value);
    if (value === null) return b.problem(rest.at, `the value of slider ${head[1]} must be a number`);
    if (got.lo === undefined) {
        min = Math.min(0, value);
        max = Math.max(10, value);
    }
    let step = got.step === undefined ? niceStep((max - min) / 100) : numberOf(got.step);
    if (step === null || !(step > 0)) {
        b.problem(rest.at, `the step of slider ${head[1]} must be a positive number`);
        step = 0.1;
    }
    if (name) b.parameters.push({ name, value, min, max, step });
}

function conditionFields(b: Builder, rest: Piece): Data {
    const { conditions, labels } = conditionsOf(b, rest);
    if (!conditions.some((c) => c.trim())) b.problem(rest.at, 'shade needs conditions: shade where x + y <= 4 and x >= 0');
    return { conditions, conditionLabels: labels };
}

function dims(b: Builder, parts: Piece[]): number {
    const three = parts.some((p) => /^\(/.test(p.text) && splitTop(p.text.slice(1, -1), ',').length === 3);
    return b.is3D || three ? 3 : 2;
}

/** A region the line points at: a name, or "the region" (the chart's one region, filled in when every line is read). */
function regionPoints(b: Builder, name: string | null, source: string, region: string, rest: Piece, fields: Data, options: Piece[]) {
    const the = /^the\s+region$/i.test(region);
    const tool = addTool(b, 'points', name, { source, regionName: the ? '' : region, ...fields }, options, 'points');
    if (the) b.theRegion.push({ tool, line: b.line, at: rest.at + Math.max(0, rest.text.toLowerCase().lastIndexOf('the region')) });
}

/** Points: `(1, 2), (3, 4) and P1`. */
function pointList(b: Builder, name: string | null, rest: Piece, options: Piece[]) {
    const parts = splitTop(rest.text, ',', rest.at)
        .flatMap((p) => splitTop(p.text, ' and ', p.at))
        .filter((p) => p.text);
    addTool(b, 'points', name, { dim: dims(b, parts), source: 'list', points: pathOf(parts) }, options, 'points');
}

/** `mark ...`: points, crossings, corners, optima and integer points. */
function mark(b: Builder, name: string | null, rest: Piece, options: Piece[]) {
    const p = drop(rest, /^the\s+/i);
    const t = p.text;
    let m = /^where\s+(\S+)\s+and\s+(\S+)\s+(?:cross|meet|intersect)$/i.exec(t) ?? /^(?:crossings|intersections|crossing\s+points|intersection\s+points)\s+of\s+(\S+)\s+and\s+(\S+)$/i.exec(t);
    if (m) {
        addTool(b, 'points', name, { source: 'intersections', ref1: m[1], ref2: m[2] }, options, 'points');
        return;
    }
    m = /^corners\s+of\s+(the\s+region|\S+)$/i.exec(t);
    if (m) return regionPoints(b, name, 'region', m[1], p, {}, options);
    m = /^(maximum|minimum|max|min)\s+of\s+(.+?)\s+(?:in|over|on)\s+(the\s+region|\S+)$/i.exec(t);
    if (m) return regionPoints(b, name, 'region', m[3], p, { objective: m[2].trim(), sense: m[1].slice(0, 3).toLowerCase() }, options);
    m = /^integer\s+points(?:\s+(?:in|of)\s+(the\s+region|\S+))?$/i.exec(t);
    if (m) return regionPoints(b, name, 'lattice', m[1] ?? '', p, {}, options);
    m = /^integer\s+(maximum|minimum|max|min)\s+(?:of\s+)?(.+?)\s+(?:in|over|on)\s+(the\s+region|\S+)$/i.exec(t);
    if (m) return regionPoints(b, name, 'lattice', m[3], p, { objective: m[2].trim(), sense: m[1].slice(0, 3).toLowerCase() }, options);
    const hints: Array<[RegExp, string]> = [
        [/^(maximum|minimum|max|min)\b/i, 'mark the maximum of 2x + 3y in R1 (or in the region)'],
        [/^corners\b/i, 'mark the corners of R1 (or of the region)'],
        [/^(crossings|intersections|crossing|intersection)\b/i, 'mark the crossings of f and g (or: mark where f and g cross)'],
        [/^where\b/i, 'mark where f and g cross'],
        [/^integer\b/i, 'mark the integer points in R1, or mark the integer maximum of 3x + 4y in R1'],
    ];
    const hint = hints.find(([re]) => re.test(t));
    if (hint) return b.problem(p.at, `write: ${hint[1]}`);
    pointList(b, name, drop(p, /^points?\s+/i), options);
}

/** `plot ...`: a function (plot f(x) = ..., plot y = ..., plot sin(x)), a surface (plot z = ...) or what the formula is. */
function plot(b: Builder, name: string | null, rest: Piece, options: Piece[]) {
    const t = rest.text.trim();
    if (!t) return b.problem(rest.at, 'plot takes a function: plot f(x) = x^2');
    if (/[=<>]/.test(t)) return formulaLine(b, name, rest, options);
    fn(b, name ?? b.nextName('f'), 'x', t, rest, options);
}

/** What `draw` may draw by name: `draw an arrow from ...`, `draw the plane z = 2`. */
const DRAW_NOUN = /^(?:(?:a|an|the)\s+)?(double\s+arrow|arrow|line|segment|polygon|brace|plane|curve|level\s+curves?|levels|contours?)(?![A-Za-z0-9_(])\s*/i;

/** `draw ...`: an equation's curve (draw 2x + 3y = c), level curves, arrows, lines, polygons, braces and planes. */
function draw(b: Builder, name: string | null, rest: Piece, options: Piece[]) {
    const t = rest.text.trim();
    if (!t) return b.problem(rest.at, 'draw takes an equation or a shape: draw 2x + 3y = 12, draw an arrow from (0, 0) to (3, 2)');
    if (DEFINITION.test(t)) return formulaLine(b, name, rest, options);
    const m = DRAW_NOUN.exec(t);
    if (m) {
        const noun = m[1].toLowerCase().replace(/\s+/g, ' ');
        const inner = drop(rest, DRAW_NOUN);
        if (noun === 'double arrow') return segment(b, 'double', name, inner, options);
        if (noun === 'arrow' || noun === 'polygon' || noun === 'brace' || noun === 'segment') return segment(b, noun, name, inner, options);
        if (noun === 'line') return after(inner, /^from\s/i) ? segment(b, 'segment', name, inner, options) : curve(b, name, inner, options);
        if (noun === 'plane') return plane(b, name, inner, options);
        if (noun === 'curve') return curve(b, name, inner, options);
        return levels(b, name, inner, options);
    }
    if (/[<>]/.test(t)) return formulaLine(b, name, rest, options);
    curve(b, name, rest, options);
}

function curve(b: Builder, name: string | null, rest: Piece, options: Piece[]) {
    const f = formulaOptions(rest, options);
    addTool(b, 'curve', name, { equation: f.formula.text }, f.options, 'curve');
}

/** `levels F at 1, 4`, `the level curves of F at 1, 4 and 9`. */
function levels(b: Builder, name: string | null, rest: Piece, options: Piece[]) {
    const m = /^(?:of\s+)?(.+?)\s+at\s+(.+)$/i.exec(rest.text.trim());
    if (!m) return b.problem(rest.at, 'level curves take a formula and its values: draw the level curves of x^2 + y^2 at 1, 4 and 9');
    const values = m[2].trim();
    const list = splitTop(values, ' and ').length > 1 ? splitTop(values, ',').flatMap((p) => splitTop(p.text, ' and ')).map((p) => p.text).join(', ') : values;
    addTool(b, 'curve', name, { equation: m[1].trim(), levels: list }, options, 'curve');
}

function plane(b: Builder, name: string | null, rest: Piece, options: Piece[]) {
    const m = /^(?:at\s+)?([xyz])\s*=\s*(.+)$/i.exec(rest.text.trim());
    if (!m) return b.problem(rest.at, 'a plane takes x = ..., y = ... or z = ...: draw the plane z = 2');
    b.is3D = true;
    addTool(b, 'plane3D', name, { axis: m[1].toLowerCase(), value: m[2].trim() }, options, 'plane');
}

/** Arrows, lines, polygons and braces: `arrow from A to B`, `line from A to B to C`, `polygon through A, B and C`, `brace from A to B`, and `arrow A -> B`. */
function segment(b: Builder, word: string, name: string | null, rest: Piece, options: Piece[]) {
    let parts: Piece[];
    let style = 'line';
    let closed = false;
    if (word === 'polygon') {
        const p = drop(rest, /^(?:through|with\s+corners|with\s+vertices)\s+/i);
        parts = splitTop(p.text, ',', p.at).flatMap((q) => splitTop(q.text, ' and ', q.at));
        closed = true;
    } else if (word === 'brace') {
        const p = drop(rest, /^from\s+/i);
        parts = splitTop(p.text, ' to ', p.at);
        style = 'brace';
        if (parts.length !== 2) return b.problem(rest.at, 'a brace takes two points: brace from (0, 0) to (4, 0)');
    } else {
        const from = after(rest, /^from\s+/i);
        const arrow = from ? null : ['<->', '->', '<-'].find((a) => splitTop(rest.text, a).length > 1);
        if (from) parts = splitTop(from.text, ' to ', from.at);
        else if ((word === 'arrow' || word === 'double') && !arrow) return b.problem(rest.at, 'an arrow takes points: arrow from (0, 0) to (2, 1)');
        else parts = splitTop(rest.text, arrow ?? '--', rest.at);
        if (from) style = word === 'arrow' ? 'forward' : word === 'double' ? 'both' : 'line';
        else style = arrow === '->' ? 'forward' : arrow === '<-' ? 'backward' : arrow === '<->' ? 'both' : 'line';
    }
    parts = parts.filter((p) => p.text);
    if (parts.length < 2) return b.problem(rest.at, `${word === 'double' ? 'a double arrow' : word === 'arrow' ? 'an arrow' : `a ${word === 'segment' ? 'line' : word}`} needs at least two points`);
    const fields: Data = { dim: dims(b, parts), path: pathOf(parts) };
    if (style !== 'line') fields.style = style;
    if (closed) fields.closed = true;
    addTool(b, 'segment', name, fields, options, 'segment');
}

function textLine(b: Builder, word: string, rest: Piece, options: Piece[]) {
    const q = takeQuoted(rest.text);
    const m = q ? /^at\s+(\(.+\))$/i.exec(q.rest) : null;
    if (!q || !m) return b.problem(rest.at, `${word} takes "words" at (x, y): ${word} "optimum" at (3, 1.2)`);
    const coords = splitTop(m[1].slice(1, -1), ',');
    if (coords.length < 2 || coords.length > 3) return b.problem(rest.at, `${word} needs a position (x, y) or (x, y, z)`);
    const a: Data = { text: q.text, x: coords[0].text, y: coords[1].text };
    if (coords.length === 3) a.z = coords[2].text;
    applyOptions(b, 'text', a, options);
    b.annotations.push(a);
}

/**
 * A formula that ran into options the words did not catch (`x^2 in blue,
 * sparkly`): the formula, and the rest as options, so the unknown one is
 * named. A formula never holds a comma outside brackets.
 */
function formulaOptions(body: Piece, options: Piece[]): { formula: Piece; options: Piece[] } {
    const pieces = splitTop(body.text, ',', body.at);
    if (pieces.length < 2) return { formula: body, options };
    let head = pieces[0].text;
    const extra: Piece[] = [];
    for (;;) {
        const cut = lastPhrase(head);
        if (cut < 0) break;
        extra.unshift(trimPiece(head.slice(cut), pieces[0].at + cut));
        head = head.slice(0, cut);
    }
    return { formula: trimPiece(head, pieces[0].at), options: [...extra, ...pieces.slice(1), ...options] };
}

/** `raw tool {...}`, `raw function {...}`, `raw surface {...}`, `raw label {...}`: an object as JSON, for what the words cannot say. */
function rawLine(b: Builder, rest: Piece) {
    const m = /^(tool|function|surface|label|slider)\s+(\{.*\})$/i.exec(rest.text.trim());
    if (!m) return b.problem(rest.at, 'raw takes tool, function, surface, label or slider and a JSON object: raw tool {"type": "curve", "equation": "x = 1"}');
    let obj: unknown;
    try {
        obj = JSON.parse(m[2]);
    } catch (e) {
        return b.problem(rest.at, `raw ${m[1]}: ${e instanceof Error ? e.message : 'not valid JSON'}`);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return b.problem(rest.at, `raw ${m[1]} needs a JSON object { ... }`);
    const item = obj as Data;
    const kind = m[1].toLowerCase();
    if (kind === 'label') {
        b.annotations.push(item);
        return;
    }
    if (kind === 'slider') {
        const name = typeof item.name === 'string' ? b.claim(item.name, rest.at) : null;
        if (name) b.parameters.push(item);
        else if (typeof item.name !== 'string') b.problem(rest.at, 'raw slider needs a "name"');
        return;
    }
    const given = typeof item.name === 'string' && item.name ? b.claim(item.name, rest.at) : null;
    if (kind === 'tool') {
        // Exact: a raw object never makes the chart 3D by itself.
        const prefix = TOOL_PREFIX[typeof item.type === 'string' ? item.type : ''] ?? 'T';
        b.tools.push({ ...item, name: given ?? b.nextName(prefix) });
    } else if (kind === 'function') {
        b.functions.push({ ...item, name: given ?? b.nextName('f') });
    } else {
        b.surfaces.push({ ...item, name: given ?? b.nextName('s') });
    }
}

/** A line without a keyword: a function, a surface, a curve (an equation) or a region (inequalities). */
function formulaLine(b: Builder, name: string | null, body: Piece, options: Piece[]) {
    const t = body.text;
    /** The formula from `text` on (the end of the line), with any options it ran into. */
    const formula = (text: string) => formulaOptions({ text, at: body.at + t.length - text.length }, options);
    // f(x) = ..., c(t) = (x(t), y(t)), r(theta) = ..., s(x, y) = ...
    // A built-in name (max(x, y) = 1) is a call in an equation, not a definition.
    const found = DEFINITION.exec(t);
    const def = found && !RESERVED_NAMES.has(found[1]) ? found : null;
    if (def && !def[4].trim()) return b.problem(body.at + t.length, `${def[1]}(${def[2]}) = needs a formula after =`);
    if (def) {
        const fname = b.claim(def[1], body.at) ?? def[1];
        const v = def[2];
        const f = formula(def[4]);
        if (def[3]) return surface(b, fname, f.formula.text, f.options);
        return fn(b, fname, v, f.formula.text, body, f.options);
    }
    // y = ..., z = ..., r = ...
    const auto = /^([yzr])\s*=(?!=)\s*(.+)$/.exec(t);
    if (auto && !/[<>]/.test(auto[2].replace(/<=|>=/g, ''))) {
        const f = formula(auto[2]);
        if (auto[1] === 'z') return surface(b, name ?? b.nextName('s'), f.formula.text, f.options);
        const v = auto[1] === 'r' ? 'theta' : 'x';
        return fn(b, name ?? b.nextName('f'), v, f.formula.text, body, f.options);
    }
    const relations = t.replace(/<=|>=|==|!=/g, '');
    if (/[<>]|<=|>=/.test(t) && !/\b(and|or)\s*$/.test(t)) {
        addTool(b, 'region', name, conditionFields(b, body), options, 'region');
        return;
    }
    if (/=/.test(relations)) return curve(b, name, body, options);
    b.problem(
        body.at,
        'this line is not a chart object. Lines start with show, plot, draw, shade, mark, write, slider, title, xlabel, ylabel, axes, size or set, or are formulas (f(x) = x^2, 2x + 3y = 12, x + y <= 4)'
    );
}

function fn(b: Builder, name: string, v: string, rhs: string, body: Piece, options: Piece[]) {
    const f: Data = { name, expression: rhs.trim() };
    if (v === 't') {
        const tuple = /^\((.*)\)$/.exec(rhs.trim());
        const parts = tuple ? splitTop(tuple[1], ',') : [];
        if (parts.length !== 2) return b.problem(body.at, `${name}(t) needs a pair: ${name}(t) = (cos(t), sin(t))`);
        f.parametric = true;
        f.expression = parts[0].text;
        f.expressionY = parts[1].text;
    } else if (v === 'theta' || v === 'θ') {
        b.chart.coordinateSystem = 'polar';
    } else if (v !== 'x') {
        return b.problem(body.at, `${name}(${v}): functions use x, parametric curves t and polar curves theta`);
    }
    applyOptions(b, 'function', f, options);
    b.functions.push(f);
}

function surface(b: Builder, name: string, rhs: string, options: Piece[]) {
    b.is3D = true;
    const s: Data = { name, expression: rhs.trim() };
    applyOptions(b, 'surface', s, options);
    b.surfaces.push(s);
}

/** The smallest of 1, 2, 5 times a power of ten that is at least `raw`: a slider step people expect. */
export function niceStep(raw: number): number {
    if (!(raw > 0)) return 0.1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const k of [1, 2, 5, 10]) if (k * p >= raw - 1e-12) return Number((k * p).toPrecision(12));
    return 10 * p;
}
