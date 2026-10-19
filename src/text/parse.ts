/*
 * Easy TikZ charts as text: one line per object, written the way the math
 * reads, instead of one JSON object.
 *
 *   view x -3..3, y -4..4
 *   slider a = 0.8 in -1.1..1.1
 *   f(x) = x^3 - 3x | blue, thick, tangent at a, extrema
 *   g(x) = f(a) + (3a^2 - 3)(x - a) | hidden
 *   shade between f and g for min(a, -2a) <= x <= max(a, -2a) | orange
 *
 * parseChartText turns such a block into the same v4 chart object a JSON
 * block holds, so everything downstream (migration, scene, renderers,
 * export, the AI server's checks) is unchanged. Problems carry a line and a
 * column, so the note can point at the spot. Every field of the chart can
 * be written: options and `set` lines take `key=value` for anything the
 * words do not cover.
 */
import { RESERVED_NAMES } from '../migrate';

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
]);

export const COLORS = new Set(['black', 'gray', 'red', 'orange', 'brown', 'green', 'teal', 'blue', 'purple', 'magenta']);
const COLOR_ALIASES: Record<string, string> = { grey: 'gray', violet: 'purple', pink: 'magenta', cyan: 'teal', auto: 'black' };
export const THICKNESSES = ['very thin', 'very thick', 'thin', 'thick'];
export const PATTERNS = new Set(['solid', 'horizontal', 'vertical', 'crosshatch', 'dots', 'north-east', 'north-west']);
export const ANCHORS = new Set(['center', 'above', 'below', 'left', 'right']);
const AXIS_STYLES: Record<string, string> = { middle: 'middle', box: 'box', edges: 'axes', axes: 'axes' };
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

/** The statement and its options: everything after the first `|` that is not part of `||`, outside brackets and quotes. */
function splitOptions(s: string): { body: Piece; options: Piece | null } {
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
            return { body: trimPiece(s.slice(0, i), 0), options: trimPiece(s.slice(i + 1), i + 1) };
        }
    }
    return { body: trimPiece(s, 0), options: null };
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

/** Lines about the chart itself, and sliders: they take no options after `|`. */
const CHART_WORDS = new Set(['view', 'axes', 'grid', 'size', 'equal', 'polar', '3d', 'snippet', 'variables', 'set', 'slider']);

/** What each kind of object accepts after `|`, for messages. */
const OPTION_HELP: Record<string, string> = {
    function: 'a colour, thin, thick, dashed, hidden, legend "text", domain a..b, tangent at a, extrema, fill, opacity 0.3, pattern dots',
    region: 'a colour, opacity 0.3, pattern dots, outline, dashed outline, no fill, constraint lines, numbered, label "text", hidden',
    curve: 'a colour, thin, thick, dashed, label "text", hidden',
    points: 'a colour, small, large, drop lines, coordinates, label "text", labels "A; B", hidden',
    segment: 'a colour, thin, thick, dashed, label "text", hidden',
    text: 'a colour, small, large, above, below, left, right, center, hidden',
    surface: 'a colour, x a..b, y a..b, opacity 0.7, samples 40, wireframe, hidden',
    plane: 'a colour, opacity 0.25, hidden',
};

/** Apply the options after `|` to `target`. Returns false for nothing; problems are recorded. */
function applyOptions(b: Builder, kind: keyof typeof OPTION_HELP, target: Data, options: Piece | null) {
    if (!options || !options.text) return;
    for (const opt of splitTop(options.text, ',', options.at)) {
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
        m = word(/^(?:domain|t|theta|θ)\s+(.+)$/i);
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
        return false;
    }
    if (kind === 'curve' || kind === 'segment') {
        if (lower === 'dashed') return set(target, 'dashed', true);
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
        let m = word(/^([xy])\s+(.+)$/i);
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

/** Region condition entries from `between f and g`, `under f`, `a, b, c` and `... for ...`, each with an optional "label". */
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
    const [main, ...rest] = splitTop(body.text, ' for ', body.at);
    const mainPieces = /^(between|under)\s/i.test(main.text) ? [main] : splitTop(main.text, ',', main.at);
    for (const p of mainPieces) add(p);
    for (const r of rest) for (const p of splitTop(r.text, ',', r.at)) add(p);
    return { conditions, labels };
}

/** Is this condition a plain sign condition like x >= 0 (left out by `numbered`)? */
export function isSignCondition(c: string): boolean {
    return /^\s*[A-Za-z][A-Za-z0-9_]*\s*>=\s*0\s*$/.test(c) || /^\s*0\s*<=\s*[A-Za-z][A-Za-z0-9_]*\s*$/.test(c);
}

function addTool(b: Builder, type: string, name: string | null, fields: Data, options: Piece | null, kind: keyof typeof OPTION_HELP) {
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
}

/** Parse a text block into a v4 chart; with { trace: true } also what each line made. */
export function parseChartText(text: string, opts: { trace?: boolean } = {}): TextChart {
    const b = new Builder();
    const lines = text.split(LINE_BREAK);
    // Names first, so a line may use a name defined further down; and 3D charts read their tuples as (x, y, z).
    lines.forEach((raw) => {
        const t = raw.trim();
        const body = t.replace(new RegExp(`^${NAME}\\s*:(?!=)\\s*`), '');
        const surface = new RegExp(`^(${NAME})\\s*\\(\\s*[A-Za-z]+\\s*,\\s*[A-Za-z]+\\s*\\)\\s*=(?!=)`).exec(body);
        if (/^3d$/i.test(t) || /^plane\s+[xyz]\s*=/i.test(body) || /^z\s*=(?!=)/.test(body) || (surface && !RESERVED_NAMES.has(surface[1]))) {
            b.is3D = true;
        }
        const m = new RegExp(`^(?:(${NAME})\\s*:(?!=)|(${NAME})\\s*\\(\\s*[A-Za-zθ]+\\s*(?:,\\s*[A-Za-z]+\\s*)?\\)\\s*=(?!=)|slider\\s+(${NAME})\\b)`).exec(t);
        const explicit = m ? m[1] ?? m[2] ?? m[3] : rawName(t);
        if (explicit) b.explicit.add(explicit);
    });
    const traces: LineTrace[] = [];
    lines.forEach((raw, i) => {
        b.line = i + 1;
        const line = raw.replace(/\s+$/, '');
        const t = line.trim();
        const before = opts.trace ? b.snapshot() : null;
        if (t && !t.startsWith('%') && !t.startsWith('//')) statement(b, line);
        if (before) traces.push(b.traceSince(before, i + 1));
    });
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
    const { body: whole, options } = splitOptions(line);
    let body = whole;
    // An optional name: `R1: shade ...`, `P1: max 2x + 3y over R1`.
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
    if (options && CHART_WORDS.has(word)) b.problem(options.at - 1, `${word} takes no options after |`);
    const restAt = kw ? body.at + t.length - kw[2].length : body.at;
    const rest: Piece = { text: kw ? kw[2] : '', at: restAt };

    switch (word) {
        case 'view':
            return view(b, rest);
        case 'axes': {
            const style = rest.text.trim().toLowerCase();
            if (style === 'none') b.chart.showAxis = false;
            else if (AXIS_STYLES[style]) b.chart.axis_style = AXIS_STYLES[style];
            else b.problem(rest.at, 'axes takes middle, box, edges or none');
            return;
        }
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
        case 'shade':
            return addTool(b, 'region', name, conditionFields(b, rest), options, 'region');
        case 'line':
        case 'curve':
            return addTool(b, 'curve', name, { equation: rest.text.trim() }, options, 'curve');
        case 'levels': {
            const m = /^(.+?)\s+at\s+(.+)$/i.exec(rest.text);
            if (!m) return b.problem(rest.at, 'levels takes a formula and its values: levels x^2 + y^2 at 1, 4, 9');
            return addTool(b, 'curve', name, { equation: m[1].trim(), levels: m[2].trim() }, options, 'curve');
        }
        case 'point':
        case 'points': {
            const parts = splitTop(rest.text, ',', rest.at).filter((p) => p.text);
            return addTool(b, 'points', name, { dim: dims(b, parts), source: 'list', points: pathOf(parts) }, options, 'points');
        }
        case 'crossings':
        case 'intersections': {
            const m = /^of\s+(\S+)\s+and\s+(\S+)$/i.exec(rest.text.trim());
            if (!m) return b.problem(rest.at, `${word} takes "of f and g" (functions or curves)`);
            return addTool(b, 'points', name, { source: 'intersections', ref1: m[1], ref2: m[2] }, options, 'points');
        }
        case 'corners': {
            const m = /^of\s+(\S+)$/i.exec(rest.text.trim());
            if (!m) return b.problem(rest.at, 'corners takes "of R1" (a region)');
            return addTool(b, 'points', name, { source: 'region', regionName: m[1] }, options, 'points');
        }
        case 'max':
        case 'min': {
            const m = /^(.+?)\s+(?:over|on|in)\s+(\S+)$/i.exec(rest.text.trim());
            if (!m) return b.problem(rest.at, `${word} takes an objective and a region: ${word} 2x + 3y over R1`);
            return addTool(b, 'points', name, { source: 'region', regionName: m[2], objective: m[1].trim(), sense: word }, options, 'points');
        }
        case 'integer': {
            const t2 = rest.text.trim();
            let m = /^points(?:\s+(?:in|of)\s+(\S+))?$/i.exec(t2);
            if (m) return addTool(b, 'points', name, { source: 'lattice', regionName: m[1] ?? '' }, options, 'points');
            m = /^(max|min)\s+(.+?)\s+(?:over|on|in)\s+(\S+)$/i.exec(t2);
            if (m) return addTool(b, 'points', name, { source: 'lattice', regionName: m[3], objective: m[2].trim(), sense: m[1].toLowerCase() }, options, 'points');
            return b.problem(rest.at, 'integer takes "points in R1" or "max 3x + 4y in R1"');
        }
        case 'arrow':
        case 'segment':
        case 'polygon':
        case 'brace':
            return segment(b, word, name, rest, options);
        case 'text':
            return textLine(b, rest, options);
        case 'plane': {
            const m = /^([xyz])\s*=\s*(.+)$/i.exec(rest.text.trim());
            if (!m) return b.problem(rest.at, 'plane takes x = ..., y = ... or z = ...');
            b.is3D = true;
            return addTool(b, 'plane3D', name, { axis: m[1].toLowerCase(), value: m[2].trim() }, options, 'plane');
        }
        default:
            return formulaLine(b, name, body, options);
    }
}

function view(b: Builder, rest: Piece) {
    for (const part of splitTop(rest.text, ',', rest.at)) {
        const m = /^([xyz])\s+(.+)$/i.exec(part.text);
        const r = m ? parseRange(m[2]) : null;
        if (!m || !r) {
            b.problem(part.at, 'view takes ranges such as x -3..3, y -4..4');
            continue;
        }
        const axis = m[1].toLowerCase();
        b.chart[`${axis}min`] = r[0];
        b.chart[`${axis}max`] = r[1];
    }
}

function setLine(b: Builder, rest: Piece) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(rest.text.trim());
    if (!m) return b.problem(rest.at, 'set takes a field and a value: set previewSize = 900');
    b.chart[m[1]] = rawValue(m[2]);
}

function slider(b: Builder, rest: Piece) {
    const m = new RegExp(`^(${NAME})\\s*=\\s*([^\\s]+)(?:\\s+in\\s+(.+?))?(?:\\s+step\\s+([^\\s]+))?$`).exec(rest.text.trim());
    if (!m) return b.problem(rest.at, 'slider takes a name and a value: slider a = 1 in 0..5 step 0.1');
    const name = b.claim(m[1], rest.at);
    const value = numberOf(m[2]);
    if (value === null) return b.problem(rest.at, `the value of slider ${m[1]} must be a number`);
    let min = Math.min(0, value);
    let max = Math.max(10, value);
    if (m[3]) {
        const r = parseRange(m[3]);
        const lo = r ? numberOf(r[0]) : null;
        const hi = r ? numberOf(r[1]) : null;
        if (lo === null || hi === null || !(lo < hi)) return b.problem(rest.at, `the range of slider ${m[1]} must be numbers, low..high`);
        min = lo;
        max = hi;
    }
    let step = m[4] ? numberOf(m[4]) : niceStep((max - min) / 100);
    if (step === null || !(step > 0)) {
        b.problem(rest.at, `the step of slider ${m[1]} must be a positive number`);
        step = 0.1;
    }
    if (name) b.parameters.push({ name, value, min, max, step });
}

function conditionFields(b: Builder, rest: Piece): Data {
    const { conditions, labels } = conditionsOf(b, rest);
    if (!conditions.some((c) => c.trim())) b.problem(rest.at, 'shade needs conditions: shade x + y <= 4, x >= 0');
    return { conditions, conditionLabels: labels };
}

function dims(b: Builder, parts: Piece[]): number {
    const three = parts.some((p) => /^\(/.test(p.text) && splitTop(p.text.slice(1, -1), ',').length === 3);
    return b.is3D || three ? 3 : 2;
}

function segment(b: Builder, word: string, name: string | null, rest: Piece, options: Piece | null) {
    const t = rest.text;
    let parts: Piece[];
    let style = 'line';
    let closed = false;
    if (word === 'polygon') {
        parts = splitTop(t, ',', rest.at);
        closed = true;
    } else if (word === 'brace') {
        parts = splitTop(t, ' to ', rest.at);
        style = 'brace';
        if (parts.length !== 2) return b.problem(rest.at, 'brace takes two points: brace (0, 0) to (4, 0)');
    } else {
        const arrow = ['<->', '->', '<-'].find((a) => splitTop(t, a).length > 1);
        if (word === 'arrow' && !arrow) return b.problem(rest.at, 'arrow takes points joined by ->, <- or <->: arrow (0, 0) -> (2, 1)');
        parts = splitTop(t, arrow ?? '--', rest.at);
        style = arrow === '->' ? 'forward' : arrow === '<-' ? 'backward' : arrow === '<->' ? 'both' : 'line';
    }
    parts = parts.filter((p) => p.text);
    if (parts.length < 2) return b.problem(rest.at, `${word} needs at least two points`);
    const fields: Data = { dim: dims(b, parts), path: pathOf(parts) };
    if (style !== 'line') fields.style = style;
    if (closed) fields.closed = true;
    addTool(b, 'segment', name, fields, options, 'segment');
}

function textLine(b: Builder, rest: Piece, options: Piece | null) {
    const q = takeQuoted(rest.text);
    const m = q ? /^at\s+(\(.+\))$/i.exec(q.rest) : null;
    if (!q || !m) return b.problem(rest.at, 'text takes "words" at (x, y): text "optimum" at (3, 1.2)');
    const coords = splitTop(m[1].slice(1, -1), ',');
    if (coords.length < 2 || coords.length > 3) return b.problem(rest.at, 'text needs a position (x, y) or (x, y, z)');
    const a: Data = { text: q.text, x: coords[0].text, y: coords[1].text };
    if (coords.length === 3) a.z = coords[2].text;
    applyOptions(b, 'text', a, options);
    b.annotations.push(a);
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
function formulaLine(b: Builder, name: string | null, body: Piece, options: Piece | null) {
    const t = body.text;
    // f(x) = ..., c(t) = (x(t), y(t)), r(theta) = ..., s(x, y) = ...
    // A built-in name (max(x, y) = 1) is a call in an equation, not a definition.
    const found = DEFINITION.exec(t);
    const def = found && !RESERVED_NAMES.has(found[1]) ? found : null;
    if (def && !def[4].trim()) return b.problem(body.at + t.length, `${def[1]}(${def[2]}) = needs a formula after =`);
    if (def) {
        const fname = b.claim(def[1], body.at) ?? def[1];
        const v = def[2];
        if (def[3]) return surface(b, fname, def[4], options);
        return fn(b, fname, v, def[4], body, options);
    }
    // y = ..., z = ..., r = ...
    const auto = /^([yzr])\s*=(?!=)\s*(.+)$/.exec(t);
    if (auto && !/[<>]/.test(auto[2].replace(/<=|>=/g, ''))) {
        if (auto[1] === 'z') return surface(b, name ?? b.nextName('s'), auto[2], options);
        const v = auto[1] === 'r' ? 'theta' : 'x';
        return fn(b, name ?? b.nextName('f'), v, auto[2], body, options);
    }
    const relations = t.replace(/<=|>=|==|!=/g, '');
    if (/[<>]|<=|>=/.test(t) && !/\b(and|or)\s*$/.test(t)) {
        return addTool(b, 'region', name, conditionFields(b, body), options, 'region');
    }
    if (/=/.test(relations)) return addTool(b, 'curve', name, { equation: t }, options, 'curve');
    b.problem(
        body.at,
        `this line is not a chart object. Lines are formulas (f(x) = x^2, 2x + 3y = 12, x + y <= 4) or start with: view, title, axes, grid, size, slider, shade, line, levels, points, crossings, corners, max, min, integer, arrow, segment, polygon, brace, text, plane, set`
    );
}

function fn(b: Builder, name: string, v: string, rhs: string, body: Piece, options: Piece | null) {
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

function surface(b: Builder, name: string, rhs: string, options: Piece | null) {
    b.is3D = true;
    const s: Data = { name, expression: rhs.trim() };
    applyOptions(b, 'surface', s, options);
    b.surfaces.push(s);
}

/** The smallest of 1, 2, 5 times a power of ten that is at least `raw`: a slider step people expect. */
function niceStep(raw: number): number {
    if (!(raw > 0)) return 0.1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const k of [1, 2, 5, 10]) if (k * p >= raw - 1e-12) return Number((k * p).toPrecision(12));
    return 10 * p;
}
