/*
 * Easy Graphs Charts and TikZ charts as text: one line per object, written the way the math
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
import { readTexHead, tNamesFunction } from '../ml/heads'; // 6.0 ML
import { unquote } from './quote';
import { isColormap } from '../colormaps';
import { ChartWords, chartWords, hasWords, readWords, shadowed, typedColumn } from './words';
import { MessageKey, t as msg } from '../i18n';
import { stripMathDollars } from '../latex';
import { FULL_OPTION_HELP, isFullText, mapFull, readFull } from './full';
import { eventNames } from '../beyond/event';
import { boxRatioOf } from '../box3d';
// 6.0 C
import { MOTION_KINDS, MOTION_KIND_WORDS, MOTION_OPTION_HELP, isMotionOption, motionOption, ownName, readMotionDraw, readMotionMark, thenPrefix } from '../motion6/text';
import { optionValue } from '../motion6/liveprims'; // 6.0 F4
import type { MotionRead } from '../motion6/text';
import { MOTION_PREFIX } from '../motion6/tools';
// 6.0 B
import { looksLikeAxisSet, looksLikeChord, readAxisSet, readChord } from '../notes6/text';
// 6.0 A
import { readLet, readListPoints, readVectors } from '../values/text';
// 6.0 D
import { LINEAR_KIND_WORDS, LINEAR_OPTION_HELP, LINEAR_TYPES, linearOption, readLinearDraw, readLinearShade, readTransform } from '../linear/text';
import type { LinearRead } from '../linear/text';
import { LINEAR_PREFIX } from '../linear/tools';
// 6.0 E
import { ITERATE_KINDS, ITERATE_KIND_WORDS, ITERATE_OPTION_HELP, isIterateOption, iterateOption, readIterateDraw, readIteratePlane } from '../iterate/text';
import type { IterateRead } from '../iterate/text';
import { ITERATE_PREFIX } from '../iterate/tools';
// 6.0 G
import { GEOGEBRA_KIND_WORDS, GEOGEBRA_OPTION_HELP, geogebraName, geogebraOption, isGeoGebraOption, readGeoGebraLine } from '../geogebra/text';
import type { GeoGebraRead } from '../geogebra/text';
// 6.0 P
import { pythonBlocks } from '../python/text';
import { PYTHON_PREFIX } from '../python/tools';

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
    // 6.0 P
    /** A further line of the object above (the script lines of a python block): the line with `object` set starts it. */
    part?: boolean;
}

export interface TextChart {
    data: Data;
    problems: TextProblem[];
    /** One entry per line, with { trace: true }. */
    lines?: LineTrace[];
}

/** Words that start a line (a function may still be called like one: line(x) = ... is a function). */
export const KEYWORDS = new Set([
    'view', 'title', 'xlabel', 'ylabel', 'zlabel', 'axes', 'grid', 'size', 'equal', 'polar', '3d', 'cube', 'box', 'snippet', 'variables', 'set',
    'slider', 'shade', 'line', 'curve', 'levels', 'point', 'points', 'crossings', 'intersections', 'corners', 'max', 'min',
    'integer', 'arrow', 'segment', 'polygon', 'brace', 'text', 'plane', 'raw',
    // the English verbs and openings
    'show', 'plot', 'draw', 'mark', 'write', 'with', 'no', 'double',
    // beyond functions (5.0)
    'use', 'data',
    // motion (6.0 C)
    'then', 'frames',
    // 6.0 F4
    'turning',
    // 6.0 D
    'transform',
    // colour the plane (6.0 E)
    'colour', 'color',
]);

export const COLORS = new Set(['black', 'gray', 'red', 'orange', 'brown', 'green', 'teal', 'blue', 'purple', 'magenta']);
const COLOR_ALIASES: Record<string, string> = { grey: 'gray', violet: 'purple', pink: 'magenta', cyan: 'teal', auto: 'black' };
export const THICKNESSES = ['very thin', 'very thick', 'thin', 'thick'];
export const PATTERNS = new Set(['solid', 'horizontal', 'vertical', 'crosshatch', 'dots', 'north-east', 'north-west']);
export const ANCHORS = new Set(['center', 'above', 'below', 'left', 'right']);
const AXIS_STYLES: Record<string, string> = { middle: 'middle', centre: 'middle', center: 'middle', box: 'box', edges: 'axes', edge: 'axes', axes: 'axes' };
// 6.0 A: value (L), vector (V), listPoints (LP); 6.0 B: axisSet, chord; 6.0 C: MOTION_PREFIX.
export const TOOL_PREFIX: Record<string, string> = { region: 'R', curve: 'C', points: 'P', segment: 'S', plane3D: 'PL', data: 'D', dataPlot: 'DP', distribution: 'X', probability: 'PR', riemann: 'RS', slopeField: 'SF', solution: 'Y', ...MOTION_PREFIX, axisSet: 'AX', chord: 'CH', value: 'L', vector: 'V', listPoints: 'LP', ...LINEAR_PREFIX /* 6.0 D */, ...ITERATE_PREFIX /* 6.0 E */, geogebra: 'G' /* 6.0 G */, ...PYTHON_PREFIX /* 6.0 P */ };
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

/** A block is text (in words or Full LaTeX) unless it is a JSON object (which may start with line or block comments). */
export function isChartText(body: string): boolean {
    if (isFullText(body)) return true;
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

/**
 * Names the block being read gives itself (sliders, functions, named shapes),
 * lowercase, set while parseBuiltin reads its lines. Such a name stays a name
 * where a colour map's word could stand (a region called heat in `mark the
 * maximum of p in heat`), so every line reads as it did before the maps came.
 */
let namesNow: ReadonlySet<string> = new Set();

/** A colour map's word (`viridis`, `heat`, ...) that the block does not use as a name. */
const isMapWord = (w: string) => isColormap(w.toLowerCase()) && !namesNow.has(w.toLowerCase());

/** An option in its short form: the words that only fill it out dropped (`with its tangent at a` is `tangent at a`, `in red` is `red`). */
function plainOption(o: string): string {
    let t = o.trim();
    for (;;) {
        const next = t.replace(/^(?:and|with|its|the|a|an)\s+(?=[A-Za-z0-9"])/i, '');
        if (next === t) break;
        t = next;
    }
    const colour = /^in\s+([A-Za-z]+)$/i.exec(t);
    if (colour && (isColour(colour[1]) || isMapWord(colour[1]))) return colour[1];
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
    // 5.0: labelled with the value it computes (a regression line's equation, a probability, a sum)
    'labelled', 'labeled',
    // 6.0 A: points of a list joined into a polygon, vectors end to end
    'joined', 'tip to tail',
]);

/** Is this piece an option, in either form (`red`, `in red`, `with its tangent at a`, `numbered`, `key=value`)? */
function isOption(raw: string): boolean {
    const o = plainOption(raw);
    const lower = o.toLowerCase();
    if (!o || splitTop(o, ',').length > 1) return false;
    if (isColour(lower) || isMapWord(lower) || THICKNESSES.includes(lower) || OPTION_WORDS.has(lower)) return true;
    if (/^(label|labels|legend)\s+"/i.test(o)) return true;
    if (isMotionOption(o)) return true; // 6.0 C
    if (isIterateOption(o)) return true; // 6.0 E
    if (isGeoGebraOption(o)) return true; // 6.0 G
    if (/^tangent(\s+at)?\s+\S/i.test(o)) return true;
    if (/^((?:opacity|mesh)\s+[-+\d.e]+|pattern\s+[a-z-]+|samples\s+[\d.]+)$/i.test(o)) return true;
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

/** A "quoted" string at the start of `s` (JSON escapes, LaTeX commands in math as written: see quote.ts), and what follows it. */
function takeQuoted(s: string): { text: string; rest: string } | null {
    const t = s.trimStart();
    if (!t.startsWith('"')) return null;
    for (let i = 1; i < t.length; i++) {
        if (t[i] === '\\') {
            i++;
            continue;
        }
        if (t[i] === '"') return { text: unquote(t.slice(1, i)), rest: t.slice(i + 1).trim() };
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
    /** 6.0 A: the names of the let lines of the block (known before any line is read). */
    readonly lets = new Set<string>();
    /** Tools that point at "the region": the one region of the chart, known once every line is read. */
    readonly theRegion: Array<{ tool: Data; line: number; at: number }> = [];
    /**
     * 5.0: tools that point at "the data" (and later "the distribution", "the
     * slope field"): the nearest one above the line, else the first below,
     * known once every line is read. `field` is the tool's field that names it.
     */
    readonly nearest: Array<{ tool: Data; type: string; field: string; line: number; at: number; missing: MessageKey; candidates?: string[] }> = [];
    /** 6.0 C: the step the lines are in now (`then` starts the next one). */
    step = 0;
    /** 6.0 G: the names the chart gives without GeoGebra's lines (`a = x^2 + y^2` with a slider a stays a curve). */
    chartNames: ReadonlySet<string> = new Set();

    problem(at: number, message: string) {
        this.problems.push({ line: this.line, column: at + 1, message });
    }

    /** A name the user gave, checked: letters, digits and _, not a built-in, not taken twice. */
    claim(name: string, at: number): string | null {
        if (RESERVED_NAMES.has(name)) {
            this.problem(at, msg('problems.text.builtInName', { name }));
            return null;
        }
        if (this.taken.has(name)) {
            this.problem(at, msg('problems.text.nameTwice', { name }));
            return null;
        }
        this.taken.add(name);
        return name;
    }

    // 6.0 ML
    /** The name t for a function of x (t(x) = ...): taken once, like any name the user gives. */
    claimFunctionT(at: number): string | null {
        if (this.taken.has('t')) {
            this.problem(at, msg('problems.text.nameTwice', { name: 't' }));
            return null;
        }
        this.taken.add('t');
        return 't';
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
// 6.0 F4: not `turning`: its line takes an option after a comma (`turning, speed 2`).
const CHART_WORDS = new Set(['view', 'show', 'axes', 'no', 'grid', 'with', 'size', 'equal', 'polar', '3d', 'snippet', 'variables', 'set', 'slider', 'frames']); // frames: 6.0 C

/** What each kind of object accepts as options, for messages (words of the chart language: they stay English). */
const OPTION_HELP: Record<string, string> = {
    function:
        'in a colour, thin, thick, dashed, hidden, with a legend, with the legend "text", from x = a to b, with its tangent at a, with its extrema, filled, opacity 0.3, pattern dots',
    region: 'in a colour, opacity 0.3, pattern dots, outlined, with a dashed outline, not filled, with constraint lines, numbered, labelled "text", hidden',
    curve: 'in a colour, thin, thick, dashed, labelled "text", hidden',
    points: 'in a colour, small, large, with lines to the axes, with coordinates, labelled "text", hidden',
    segment: 'in a colour, thin, thick, dashed, backwards, labelled "text", hidden',
    text: 'in a colour, small, large, above, below, left, right, center, hidden',
    surface:
        'in a colour, in a colour map (viridis, heat, cool, diverging, rainbow, greyscale), for x from a to b and y from c to d, opacity 0.7, mesh 0.4, 40 samples, wireframe, hidden',
    plane: 'in a colour, opacity 0.25, hidden',
    data: 'hidden',
    dataPlot: 'in a colour, small, large, thin, thick, dashed, opacity 0.35, with coordinates, labelled, labelled "text", hidden',
    distribution: 'in a colour, thin, thick, dashed, opacity 0.35, hidden',
    probability: 'in a colour, opacity 0.5, pattern dots, labelled, labelled "text", hidden',
    riemann: 'in a colour, thin, thick, opacity 0.35, labelled, labelled "text", hidden',
    slopeField: 'in a colour, thin, thick, hidden',
    solution: 'in a colour, thin, thick, dashed, hidden',
    ...MOTION_OPTION_HELP, // 6.0 C
    // 6.0 B
    axisSet: 'in a colour, thin, thick, labelled, labelled "text", hidden',
    chord: 'in a colour, thin, thick, dashed, labelled, labelled "text", hidden',
    // 6.0 A
    value: 'hidden',
    vector: 'in a colour, thin, thick, dashed, labelled, labelled "text", tip to tail, hidden',
    listPoints: 'in a colour, small, large, thin, thick, joined, labelled, labelled "text", hidden',
    ...LINEAR_OPTION_HELP, // 6.0 D
    ...ITERATE_OPTION_HELP, // 6.0 E
    ...GEOGEBRA_OPTION_HELP, // 6.0 G
};

/** Each kind of object in words, for messages. */
const KIND_WORDS: Record<keyof typeof OPTION_HELP, MessageKey> = {
    function: 'problems.text.kindFunction',
    region: 'problems.text.kindRegion',
    curve: 'problems.text.kindCurve',
    points: 'problems.text.kindPoints',
    segment: 'problems.text.kindSegment',
    text: 'problems.text.kindText',
    surface: 'problems.text.kindSurface',
    plane: 'problems.text.kindPlane',
    data: 'beyond.text.kindData',
    dataPlot: 'beyond.text.kindDataPlot',
    distribution: 'beyond.text.kindDistribution',
    probability: 'beyond.text.kindProbability',
    riemann: 'beyond.text.kindRiemann',
    slopeField: 'beyond.text.kindSlopeField',
    solution: 'beyond.text.kindSolution',
    ...MOTION_KIND_WORDS, // 6.0 C
    // 6.0 B
    axisSet: 'notes6.text.kindAxisSet',
    chord: 'notes6.text.kindChord',
    // 6.0 A
    value: 'values.kind.value',
    vector: 'values.text.kindVector',
    listPoints: 'values.text.kindListPoints',
    ...LINEAR_KIND_WORDS, // 6.0 D
    ...ITERATE_KIND_WORDS, // 6.0 E
    ...GEOGEBRA_KIND_WORDS, // 6.0 G
};

/** A kind of object in the reader's words, for messages. */
function kindWord(kind: string): string {
    return Object.prototype.hasOwnProperty.call(KIND_WORDS, kind) ? msg(KIND_WORDS[kind]) : kind;
}

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
        // Colours by height: a surface's option; anything else is told to take a colour.
        if (isMapWord(lower)) {
            if (kind === 'surface' || kind === 'vectorField' || kind === 'trajectory' || kind === 'colourPlane') target.colormap = lower; // 6.0 C, E
            else b.problem(opt.at, msg('problems.text.colormapNotSurface', { map: lower, kind: kindWord(kind) }));
            continue;
        }
        const thick = THICKNESSES.find((t) => lower === t);
        if (thick && kind !== 'text' && kind !== 'points' && kind !== 'surface' && kind !== 'plane' && kind !== 'data' && kind !== 'probability' && kind !== 'restPoints' && kind !== 'transform' && kind !== 'unitSquare' /* 6.0 D */) {
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
        if (/^label\s/i.test(o) && kind !== 'text' && kind !== 'surface' && kind !== 'plane' && kind !== 'data' && kind !== 'distribution' && kind !== 'slopeField' && kind !== 'solution' && !MOTION_KINDS.has(kind) && !(LINEAR_TYPES.has(kind) && kind !== 'unitSquare') /* 6.0 D */ && !ITERATE_KINDS.has(kind) /* 6.0 E */) {
            target.label = textValue(o.slice(5));
            continue;
        }
        if (applyKindOption(b, kind, target, opt)) continue;
        b.problem(opt.at, msg('problems.text.unknownOption', { option: o, kind: kindWord(kind), options: (fullNow ? FULL_OPTION_HELP : OPTION_HELP)[kind] }));
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
        // The mesh lines on a filled surface, 0 to 1 (0: a smooth surface).
        m = word(/^mesh\s+(.+)$/i);
        if (m) return fractionOption(b, opt, target, 'meshOpacity', m[1]);
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
    // 6.0 B: sets on an axis and chords.
    if (kind === 'axisSet' || kind === 'chord') {
        if (lower === 'labelled' || lower === 'labeled') return set(target, 'valueLabel', true);
        if (kind === 'chord' && lower === 'dashed') return set(target, 'dashed', true);
        return false;
    }
    // 6.0 D: grids, basis vectors, transforms, eigenvectors, unit squares, spans
    if (LINEAR_TYPES.has(kind)) return linearOption(kind, target, o, () => b.problem(opt.at, msg('problems.text.needsFraction', { option: opt.text })));
    // 6.0 G: GeoGebra lines
    if (kind === 'geogebra') return geogebraOption(target, o, () => b.problem(opt.at, msg('problems.text.needsFraction', { option: opt.text })));
    return beyondOption(b, kind, target, opt);
}

function set(target: Data, key: string, value: unknown): true {
    target[key] = value;
    return true;
}

function badRange(b: Builder, opt: Piece): true {
    b.problem(opt.at, msg('problems.text.needsRange', { option: opt.text }));
    return true;
}

function numberOption(b: Builder, opt: Piece, target: Data, key: string, value: string): true {
    const n = numberOf(value);
    if (n === null) b.problem(opt.at, msg('problems.text.needsNumber', { option: opt.text }));
    else target[key] = n;
    return true;
}

/** A number from 0 to 1, such as an opacity; anything else is a problem and is left out. */
function fractionOption(b: Builder, opt: Piece, target: Data, key: string, value: string): true {
    const n = numberOf(value);
    if (n === null) b.problem(opt.at, msg('problems.text.needsNumber', { option: opt.text }));
    else if (n < 0 || n > 1) b.problem(opt.at, msg('problems.text.needsFraction', { option: opt.text }));
    else target[key] = n;
    return true;
}

function patternOption(b: Builder, opt: Piece, target: Data, value: string): true {
    const p = value.trim().toLowerCase();
    if (!PATTERNS.has(p)) b.problem(opt.at, msg('problems.text.unknownPattern', { pattern: value.trim(), patterns: [...PATTERNS].join(', ') }));
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
            label = unquote(q[1]);
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
    // In LaTeX too: `x \ge 0`, `x \geq 0`, `0 \le x`, `0 \leq x`.
    const plain = c.replace(/\\geq?(?![A-Za-z])/g, '>=').replace(/\\leq?(?![A-Za-z])/g, '<=');
    return /^\s*[A-Za-z][A-Za-z0-9_]*\s*>=\s*0\s*$/.test(plain) || /^\s*0\s*<=\s*[A-Za-z][A-Za-z0-9_]*\s*$/.test(plain);
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
    if (isFullText(text)) return parseFull(text, opts);
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

/** A Full LaTeX block is being read: messages name its options (src/text/full.ts). */
let fullNow = false;

/**
 * A Full LaTeX block (src/text/full.ts): read in the built-in words, line
 * by line, its problems and lines put back on the block's own lines and
 * columns. A person's own chart words do not apply to it.
 */
function parseFull(text: string, opts: { trace?: boolean }): TextChart {
    const read = readFull(text);
    const outside = fullNow;
    fullNow = true;
    try {
        return mapFull(read, parseBuiltin(read.text, { trace: opts.trace }), text.split(LINE_BREAK).length, !!opts.trace);
    } finally {
        fullNow = outside;
    }
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
    // 6.0 P: python blocks: the script lines are no chart lines (src/python/text.ts).
    const blocks = pythonBlocks(lines);
    const scriptLine = new Set<number>();
    for (const blk of blocks) for (let k = blk.head + 1; k < blk.end; k++) scriptLine.add(k);
    const blockAt = new Map(blocks.map((blk) => [blk.head, blk]));
    // 6.0 A: the let names first, so `draw f(x, y) = 1` of a let function f is its curve, not a surface.
    lines.forEach((raw, i) => {
        if (scriptLine.has(i)) return; // 6.0 P
        const m = new RegExp(`^let\\s+\\$?\\s*(${NAME})\\s*(?:\\(([^()]*)\\))?\\s*=`).exec(raw.trim());
        if (m) b.lets.add(m[1]);
    });
    // Names first, so a line may use a name defined further down; and 3D charts read their tuples as (x, y, z).
    const ggNames = new Set<string>(); // 6.0 G
    lines.forEach((raw, i) => {
        if (scriptLine.has(i)) return; // 6.0 P
        // 6.0 C: `then plot g(x) = ...` names g as `plot g(x) = ...` does.
        const t = raw.trim().replace(/^then\s+(?=[A-Za-z\\$])/i, '');
        const named = new RegExp(`^(${NAME})\\s*:(?!=)\\s*`).exec(t);
        // plot and draw only say what the line does: `plot z = ...` is a surface as `z = ...` is.
        const body = (named ? t.slice(named[0].length) : t).replace(/^(?:plot|draw)\s+(?:the\s+)?/i, '');
        const surface = new RegExp(`^(${NAME})\\s*\\(\\s*[A-Za-z]+\\s*,\\s*[A-Za-z]+\\s*\\)\\s*=(?!=)`).exec(body);
        if (/^3d$/i.test(t) || /^plane\s+(?:at\s+)?[xyz]\s*=/i.test(body) || /^z\s*=(?!=)/.test(body) || (surface && !RESERVED_NAMES.has(surface[1]) && !(/^draw\s/i.test(t) && b.lets.has(surface[1])))) {
            b.is3D = true;
        }
        const def = new RegExp(`^(${NAME})\\s*\\(\\s*[A-Za-zθ]+\\s*(?:,\\s*[A-Za-z]+\\s*)?\\)\\s*=(?!=)`).exec(body);
        const slider = new RegExp(`^slider\\s+(${NAME})\\b`).exec(t);
        const markAt = new RegExp(`^mark\\s+(${NAME})\\s+at\\s+\\(`).exec(body);
        const explicit = named?.[1] ?? def?.[1] ?? slider?.[1] ?? markAt?.[1] ?? rawName(t) ?? ownName(body) ?? undefined; // ownName: 6.0 C
        if (explicit) b.explicit.add(explicit);
        // 6.0 A: `let v = ...`, `let $f(rate) = ...$`: the name and its parameters stay whole in $...$.
        const letName = new RegExp(`^let\\s+\\$?\\s*(${NAME})\\s*(?:\\(([^()]*)\\))?\\s*=`).exec(t);
        if (letName) {
            b.explicit.add(letName[1]);
            for (const p of (letName[2] ?? '').split(',')) if (/^[A-Za-z]{2,}$/.test(p.trim())) b.explicit.add(p.trim());
        }
        // 6.0 G: `A = (1, 2)`, `c = Circle(A, 3)`: GeoGebra's names, known once every name of the chart is.
        const gg = explicit ? null : geogebraName(t);
        if (gg) ggNames.add(gg);
    });
    // 6.0 G
    b.chartNames = new Set(b.explicit);
    for (const n of ggNames) b.explicit.add(n);
    const traces: LineTrace[] = [];
    const outside = namesNow;
    namesNow = new Set([...b.explicit].map((n) => n.toLowerCase()));
    try {
        let script: LineTrace['object'] = null; // 6.0 P
        lines.forEach((raw, i) => {
            b.line = i + 1;
            // 6.0 P: a python block: its head makes the tool, its lines belong to it.
            if (scriptLine.has(i)) {
                if (opts.trace) traces.push({ line: i + 1, object: script, chart: [], part: true });
                return;
            }
            const blk = blockAt.get(i);
            if (blk) {
                const before = b.snapshot();
                pythonLine(b, blk);
                const tr = b.traceSince(before, i + 1);
                script = tr.object;
                if (opts.trace) traces.push(tr);
                return;
            }
            const line = raw.replace(/\s+$/, '');
            const t = line.trim();
            const before = opts.trace ? b.snapshot() : null;
            if (t && !t.startsWith('%') && !t.startsWith('//') && !t.startsWith('#')) stepped(b, line); // 6.0 C: statement(b, line) in its step
            if (before) traces.push(b.traceSince(before, i + 1));
        });
    } finally {
        namesNow = outside;
    }
    // "the region" is the chart's one region.
    const regions = b.tools.filter((tool) => tool.type === 'region');
    for (const ref of b.theRegion) {
        if (regions.length === 1) ref.tool.regionName = regions[0].name;
        else {
            const message = regions.length ? msg('problems.text.theRegionUnclear', { count: regions.length }) : msg('problems.text.theRegionMissing');
            b.problems.push({ line: ref.line, column: ref.at + 1, message });
        }
    }
    resolveNearest(b);
    b.problems.sort((p, q) => p.line - q.line || p.column - q.column);
    // 6.0 B: a 2D chart that gives x and no y: y follows what is drawn (src/notes6/yfit.ts).
    const c = b.chart;
    if (!b.is3D && c.dimension !== true && c.coordinateSystem !== 'polar' && ('xmin' in c || 'xmax' in c) && !('ymin' in c) && !('ymax' in c) && !('fitY' in c)) c.fitY = true;
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
    // LaTeX formulas (5.0) sit in $...$ as in a note; the dollars go, labels in quotes keep theirs.
    line = stripMathDollars(line, b.explicit);
    // Axis numbers keep the rest of the line as written (commas included): `x numbers every pi/2`,
    // `x numbers at a "a", b "b"`, `x numbers off`.
    const numbers = /^(\s*)([xyz])\s+numbers\b\s*(every|at|off)?\b\s*(.*)$/i.exec(line);
    if (numbers) {
        const axis = numbers[2].toLowerCase();
        const how = (numbers[3] || '').toLowerCase();
        const arg = numbers[4].trim();
        const at = numbers[1].length;
        if (how === 'off' && !arg) b.chart[`numbers_${axis}`] = 'off';
        else if ((how === 'every' || how === 'at') && arg) {
            b.chart[`numbers_${axis}`] = how;
            b.chart[how === 'every' ? `numbers_step_${axis}` : `numbers_at_${axis}`] = arg;
        } else b.problem(at, msg('problems.text.numbersTakes', { axis }));
        return;
    }
    // 6.0 A: a definition, `let v = (2, 1)`, `let f(x, y) = x^2 + 4y^2` (src/values/text.ts): its formula is the rest of the line.
    if (/^\s*let\s+[A-Za-z]/.test(line)) return letLine(b, line);
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
    if (DEFINITION.test(readTexHead(t)?.rest ?? '')) return formulaLine(b, name, body, options); // 6.0 ML: \sigma(x) = ...
    // 6.0 G: a GeoGebra input line, `A = (1, 2)`, `c = Circle(A, 3)`, `IterationList(...)` (src/geogebra/text.ts).
    const gg = readGeoGebraLine(t, (n) => b.chartNames.has(n));
    if (gg) return geogebraLine(b, name, body, gg, options);
    const kw = /^([A-Za-z0-9]+)\b\s*(.*)$/.exec(t);
    const word = kw ? kw[1].toLowerCase() : '';
    if (split.bar >= 0 && CHART_WORDS.has(word)) b.problem(split.bar, msg('problems.text.noOptions', { word }));
    const restAt = kw ? body.at + t.length - kw[2].length : body.at;
    const rest: Piece = { text: kw ? kw[2] : '', at: restAt };
    // A formula that starts with a name like a word of the syntax (`mark + x = 3`, a slider called mark) is a formula.
    if (/^(show|no|with|plot|draw|mark|write|double|use|data|transform|colour|color)$/.test(word) && /^(?:[*/^=<>!]|[-+]\s)/.test(rest.text)) return formulaLine(b, name, body, options); // transform: 6.0 D; colour, color: 6.0 E

    switch (word) {
        case 'view':
        case 'show':
            return view(b, word, rest);
        case 'axes':
            return axes(b, rest);
        case 'no':
            if (/^axes$/i.test(rest.text.trim())) b.chart.showAxis = false;
            // 6.1: no grid, also where the chart look draws one.
            else if (/^grid$/i.test(rest.text.trim())) b.chart.showLargeGrid = false;
            else b.problem(body.at, msg('problems.text.didYouMean', { phrase: /^g/i.test(rest.text.trim()) ? 'no grid' : 'no axes' }));
            return;
        case 'with':
            return withLine(b, rest);
        case 'grid': {
            const g = rest.text.trim().toLowerCase();
            // grid opacity 0.3: the major lines at 0.3, the minor ones at half.
            const opacity = /^opacity(?:\s+(.*))?$/i.exec(rest.text.trim());
            if (opacity) {
                fractionOption(b, { text: `grid ${rest.text.trim()}`, at: body.at }, b.chart, 'gridOpacity', opacity[1] ?? '');
                return;
            }
            if (!g || g === 'major') b.chart.showLargeGrid = true;
            else if (g === 'minor') b.chart.showSmallGrid = true;
            else if (g === 'fine' || g === 'both') b.chart.showLargeGrid = b.chart.showSmallGrid = true;
            else b.problem(rest.at, msg('problems.text.gridTakes'));
            return;
        }
        case 'size': {
            const m = /^([\d.]+)\s*(?:x|by|×)\s*([\d.]+)\s*(cm)?$/i.exec(rest.text.trim());
            if (!m) return b.problem(rest.at, msg('problems.text.sizeTakes'));
            b.chart.size_x_cm = Number(m[1]);
            b.chart.size_y_cm = Number(m[2]);
            return;
        }
        case 'equal':
            if (/^scale$/i.test(rest.text.trim())) b.chart.equalScale = true;
            else b.problem(body.at, msg('problems.text.didYouMean', { phrase: 'equal scale' }));
            return;
        case 'polar':
            if (rest.text.trim()) b.problem(rest.at, msg('problems.text.standsAlone', { word: 'polar' }));
            b.chart.coordinateSystem = 'polar';
            return;
        case '3d':
            if (rest.text.trim()) b.problem(rest.at, msg('problems.text.standsAlone', { word: '3d' }));
            b.chart.dimension = true;
            return;
        case 'cube':
            // The 3D box as a cube. Only the word alone: `cube + x = 3` (a slider called cube) stays a formula.
            if (rest.text.trim()) return formulaLine(b, name, body, options);
            if (options.length) b.problem(options[0].at, msg('problems.text.standsAlone', { word: 'cube' }));
            b.chart.boxAspect = 'equal';
            return;
        case 'box': {
            // The 3D box with its own lengths, x : y : z: `box 1 x 2 x 0.6`. A line that does not start with a number
            // stays a formula (`box + x = 3`, a slider called box).
            const lengths = rest.text.trim();
            if (!/^[\d.]/.test(lengths)) return formulaLine(b, name, body, options);
            const ratio = boxRatioOf(lengths);
            if (!ratio || options.length) return b.problem(rest.at, msg('problems.text.boxTakes'));
            b.chart.boxAspect = 'custom';
            b.chart.boxRatio = ratio;
            return;
        }
        case 'raw':
            return rawLine(b, rest);
        // 6.0 D: transform the plane by A, transform space by B.
        case 'transform':
            if (!linearLine(b, name, readTransform(rest.text), options, rest.at)) return formulaLine(b, name, body, options);
            return;
        // 6.0 C: the export shows every step side by side. Only the word alone: `frames + x = 3` stays a formula.
        case 'frames':
            if (rest.text.trim()) return formulaLine(b, name, body, options);
            if (options.length) b.problem(options[0].at, msg('motion6.text.framesAlone'));
            b.chart.frames = true;
            return;
        // 6.0 F4: a 3D chart turns by itself in notes and the editor. Only the word alone: `turning + x = 3` stays a formula.
        case 'turning':
            if (rest.text.trim()) return formulaLine(b, name, body, options);
            // Its one option: how fast it turns, `turning, speed 2`.
            for (const o of options) {
                const speed = /^speed\s+(\S+)$/i.exec(o.text.trim());
                const v = speed ? optionValue('speed', speed[1]) : undefined;
                if (v !== undefined) b.chart.turnSpeed = v;
                else b.problem(o.at, msg('problems.text.standsAlone', { word: 'turning' }));
            }
            b.chart.turning = true;
            return;
        case 'snippet':
            if (rest.text.trim()) b.problem(rest.at, msg('problems.text.standsAlone', { word: 'snippet' }));
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
            if (shadeProbability(b, name, rest, options)) return;
            if (linearLine(b, name, readLinearShade(rest.text), options, rest.at)) return; // 6.0 D
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
            if (!m) return b.problem(rest.at, msg('problems.text.optimumTakes', { word }));
            return regionPoints(b, name, 'region', m[2], rest, { objective: m[1].trim(), sense: word }, options);
        }
        case 'integer':
            return mark(b, name, { text: `integer ${rest.text}`, at: body.at }, options);
        case 'double':
            if (/^arrows?\b/i.test(rest.text)) return segment(b, 'double', name, drop(rest, /^arrows?\s*/i), options);
            return b.problem(body.at, msg('problems.text.didYouMean', { phrase: 'double arrow from A to B' }));
        case 'arrow':
        case 'segment':
        case 'polygon':
        case 'brace':
            return segment(b, word, name, rest, options);
        case 'plane':
            return plane(b, name, rest, options);
        case 'use':
            return useTable(b, name, rest, options);
        case 'data':
            return dataList(b, name, rest, options);
        // 6.0 E: colour the plane by ...
        case 'colour':
        case 'color':
            if (iterateLine(b, name, readIteratePlane(rest, options))) return;
            return formulaLine(b, name, body, options);
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
                b.problem(part.at, msg(word === 'view' ? 'problems.text.viewTakes' : 'problems.text.showTakes'));
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
    else b.problem(rest.at, msg('problems.text.axesTakes'));
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
    else b.problem(rest.at, msg('problems.text.withTakes'));
}

function setLine(b: Builder, rest: Piece) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(rest.text.trim());
    if (!m) return b.problem(rest.at, msg('problems.text.setTakes'));
    // 6.0 entrances: `set entrances = off` (or `on`) is the chart field `entrances`, false (or true).
    const word = /^(off|on)$/i.exec(m[2].trim());
    if (m[1] === 'entrances' && word) {
        b.chart.entrances = word[1].toLowerCase() === 'on';
        return;
    }
    b.chart[m[1]] = rawValue(m[2]);
}

/** The parts of a slider line after its name, in any order: `= 6`, `from 0 to 15`, `in 0..15`, `starting at 6`, `in steps of 0.5`, `step 0.5`. */
const SLIDER_PARTS: Array<{ re: RegExp; part: 'value' | 'range' | 'step' | 'connected' }> = [
    { re: /^(connected)\b/i, part: 'connected' },
    { re: /^=\s*([^\s,]+)/, part: 'value' },
    { re: /^(?:in\s+)?steps?\s+(?:of\s+)?([^\s,]+)/i, part: 'step' },
    { re: /^(?:from|in|between)\s+([^\s,]+?)\s*(?:\.\.|\bto\b|\band\b)\s*([^\s,]+)/i, part: 'range' },
    { re: /^(?:start(?:ing|s)?\s+)?at\s+([^\s,]+)/i, part: 'value' },
];

function slider(b: Builder, rest: Piece) {
    const text = rest.text.trim();
    const head = new RegExp(`^(${NAME})(?![A-Za-z0-9_])\\s*(.*)$`).exec(text);
    if (!head) return b.problem(rest.at, msg('problems.text.sliderTakes'));
    const got: { value?: string; lo?: string; hi?: string; step?: string; connected?: string } = {};
    let tail = head[2];
    for (;;) {
        tail = tail.replace(/^[\s,]+/, '');
        if (!tail) break;
        const hit = SLIDER_PARTS.map((p) => ({ p, m: p.re.exec(tail) })).find((h) => h.m);
        if (!hit || !hit.m) return b.problem(rest.at + text.length - tail.length, msg('problems.text.sliderPart', { name: head[1], text: tail }));
        if (hit.p.part === 'range') [got.lo, got.hi] = [hit.m[1], hit.m[2]];
        else got[hit.p.part] = hit.m[1];
        tail = tail.slice(hit.m[0].length);
    }
    const name = b.claim(head[1], rest.at);
    if (got.value === undefined && got.lo === undefined) return b.problem(rest.at, msg('problems.text.sliderNeedsRange', { name: head[1] }));
    let min = 0;
    let max = 10;
    if (got.lo !== undefined && got.hi !== undefined) {
        const lo = numberOf(got.lo);
        const hi = numberOf(got.hi);
        if (lo === null || hi === null || !(lo < hi)) return b.problem(rest.at, msg('problems.text.sliderRange', { name: head[1] }));
        min = lo;
        max = hi;
    }
    const value = got.value === undefined ? min : numberOf(got.value);
    if (value === null) return b.problem(rest.at, msg('problems.text.sliderValue', { name: head[1] }));
    if (got.lo === undefined) {
        min = Math.min(0, value);
        max = Math.max(10, value);
    }
    let step = got.step === undefined ? niceStep((max - min) / 100) : numberOf(got.step);
    if (step === null || !(step > 0)) {
        b.problem(rest.at, msg('problems.text.sliderStep', { name: head[1] }));
        step = 0.1;
    }
    if (name) b.parameters.push(got.connected !== undefined ? { name, value, min, max, step, connected: true } : { name, value, min, max, step });
}

function conditionFields(b: Builder, rest: Piece): Data {
    const { conditions, labels } = conditionsOf(b, rest);
    if (!conditions.some((c) => c.trim())) b.problem(rest.at, msg('problems.text.shadeNeedsConditions'));
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
    if (motionLine(b, name, readMotionMark(rest), options)) return; // 6.0 C
    const p = drop(rest, /^the\s+/i);
    const t = p.text;
    // 6.0 A: the points of a list, `mark the points $\{e^{2\pi i k / n} : k = 0, \dots, n - 1\}$`, `mark the points of S`.
    const list = readListPoints(t, b.lets);
    if (list !== null) {
        addTool(b, 'listPoints', name, { points: list }, options, 'listPoints');
        return;
    }
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
    // 5.0: mark P at (1, 2), a point with its name.
    m = new RegExp(`^(${NAME})\\s+at\\s+(\\(.*\\))$`).exec(t);
    if (m && !RESERVED_NAMES.has(m[1])) {
        const own = name ?? b.claim(m[1], p.at);
        const point = trimPiece(m[2], p.at + t.length - m[2].length);
        addTool(b, 'points', own, { dim: dims(b, [point]), source: 'list', points: point.text }, options, 'points');
        return;
    }
    // 6.0 B: mark where g(x) <= 0 on the x-axis, a set on an axis.
    if (/^where\s/i.test(rest.text.trim()) && looksLikeAxisSet(rest.text)) {
        // Options the words did not catch (`..., sparkly`) are named, not read as part of the condition.
        const f = formulaOptions(p, options);
        const set = readAxisSet(f.formula.text);
        if (set) {
            addTool(b, 'axisSet', name, set, f.options, 'axisSet');
            return;
        }
    }
    if (/^where\s/i.test(rest.text.trim()) && looksLikeAxisSet(rest.text)) return b.problem(p.at, msg('notes6.text.axisSetTakes'));
    // 5.0: mark the data (of D2); options the words did not catch are named.
    if (/^the\s+data\b/i.test(rest.text.trim())) {
        const f = formulaOptions(p, options);
        m = new RegExp(`^data(?:\\s+of\\s+(${NAME}))?$`, 'i').exec(f.formula.text);
        if (m) return dataPlot(b, name, 'points', m[1], rest, f.options);
    }
    const hints: Array<[RegExp, MessageKey]> = [
        [/^(maximum|minimum|max|min)\b/i, 'problems.text.markOptimumHint'],
        [/^corners\b/i, 'problems.text.markCornersHint'],
        [/^(crossings|intersections|crossing|intersection)\b/i, 'problems.text.markCrossingsHint'],
        [/^where\b/i, 'problems.text.markWhereHint'],
        [/^integer\b/i, 'problems.text.markIntegerHint'],
    ];
    const hint = hints.find(([re]) => re.test(t));
    if (hint) return b.problem(p.at, msg(hint[1]));
    pointList(b, name, drop(p, /^points?\s+/i), options);
}

/** `plot ...`: a function (plot f(x) = ..., plot y = ..., plot sin(x)), a surface (plot z = ...) or what the formula is. */
function plot(b: Builder, name: string | null, rest: Piece, options: Piece[]) {
    const t = rest.text.trim();
    if (!t) return b.problem(rest.at, msg('problems.text.plotTakes'));
    if (distribution(b, name, rest, options)) return;
    if (/[=<>]/.test(t)) return formulaLine(b, name, rest, options);
    fn(b, name ?? b.nextName('f'), 'x', t, rest, options);
}

/** What `draw` may draw by name: `draw an arrow from ...`, `draw the plane z = 2`. */
const DRAW_NOUN = /^(?:(?:a|an|the)\s+)?(double\s+arrow|arrow|line|segment|polygon|brace|plane|curve|level\s+curves?|levels|contours?)(?![A-Za-z0-9_(])\s*/i;

/** `draw ...`: an equation's curve (draw 2x + 3y = c), level curves, arrows, lines, polygons, braces and planes. */
function draw(b: Builder, name: string | null, rest: Piece, options: Piece[]) {
    const t = rest.text.trim();
    if (!t) return b.problem(rest.at, msg('problems.text.drawTakes'));
    // 6.0 A: `draw f(x, y) = 1` with a let function f is its curve, not a new function f.
    const letCall = /^([A-Za-z][A-Za-z0-9_]*)\s*\(/.exec(t);
    if (letCall && b.lets.has(letCall[1])) return curve(b, name, rest, options);
    if (DEFINITION.test(t) || DEFINITION.test(readTexHead(t)?.rest ?? '')) return formulaLine(b, name, rest, options); // 6.0 ML: or \sigma(x) = ...
    if (motionLine(b, name, readMotionDraw(rest, b.is3D), options)) return; // 6.0 C
    if (iterateLine(b, name, readIterateDraw(rest, options))) return; // 6.0 E
    // 6.0 B: draw the chord of g from a to b (at λ).
    const chord = readChord(t);
    if (chord) {
        addTool(b, 'chord', name, chord, options, 'chord');
        return;
    }
    if (looksLikeChord(t)) return b.problem(rest.at, msg('notes6.text.chordTakes'));
    // 6.0 D: draw the grid, the basis vectors, the eigenvectors of A, the span of v and w.
    if (linearLine(b, name, readLinearDraw(t), options, rest.at)) return;
    // 6.0 A: vector arrows, `draw v and w as arrows`, `draw v + w tip to tail`.
    const vectors = readVectors(t, b.lets);
    if (vectors) {
        const fields: Data = { vectors: vectors.vectors.join('; ') };
        if (vectors.from) fields.from = vectors.from;
        if (vectors.tipToTail) fields.tipToTail = true;
        addTool(b, 'vector', name, fields, options, 'vector');
        return;
    }
    if (drawBeyond(b, name, rest, options)) return;
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
    if (!m) return b.problem(rest.at, msg('problems.text.levelsTake'));
    const values = m[2].trim();
    const list = splitTop(values, ' and ').length > 1 ? splitTop(values, ',').flatMap((p) => splitTop(p.text, ' and ')).map((p) => p.text).join(', ') : values;
    addTool(b, 'curve', name, { equation: m[1].trim(), levels: list }, options, 'curve');
}

function plane(b: Builder, name: string | null, rest: Piece, options: Piece[]) {
    const m = /^(?:at\s+)?([xyz])\s*=\s*(.+)$/i.exec(rest.text.trim());
    if (!m) return b.problem(rest.at, msg('problems.text.planeTakes'));
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
        if (parts.length !== 2) return b.problem(rest.at, msg('problems.text.braceTakes'));
    } else {
        const from = after(rest, /^from\s+/i);
        const arrow = from ? null : ['<->', '->', '<-'].find((a) => splitTop(rest.text, a).length > 1);
        if (from) parts = splitTop(from.text, ' to ', from.at);
        else if ((word === 'arrow' || word === 'double') && !arrow) return b.problem(rest.at, msg('problems.text.arrowTakes'));
        else parts = splitTop(rest.text, arrow ?? '--', rest.at);
        if (from) style = word === 'arrow' ? 'forward' : word === 'double' ? 'both' : 'line';
        else style = arrow === '->' ? 'forward' : arrow === '<-' ? 'backward' : arrow === '<->' ? 'both' : 'line';
    }
    parts = parts.filter((p) => p.text);
    if (parts.length < 2) {
        const key = Object.prototype.hasOwnProperty.call(TWO_POINTS, word) ? TWO_POINTS[word] : null;
        return b.problem(rest.at, key ? msg(key) : msg('problems.text.shapeTwoPoints', { shape: word }));
    }
    const fields: Data = { dim: dims(b, parts), path: pathOf(parts) };
    if (style !== 'line') fields.style = style;
    if (closed) fields.closed = true;
    addTool(b, 'segment', name, fields, options, 'segment');
}

/** 'an arrow needs at least two points', by the word that drew it. */
const TWO_POINTS: Record<string, MessageKey> = {
    double: 'problems.text.doubleArrowTwoPoints',
    arrow: 'problems.text.arrowTwoPoints',
    segment: 'problems.text.lineTwoPoints',
    polygon: 'problems.text.polygonTwoPoints',
    brace: 'problems.text.braceTwoPoints',
};

function textLine(b: Builder, word: string, rest: Piece, options: Piece[]) {
    const q = takeQuoted(rest.text);
    const m = q ? /^at\s+(\(.+\))$/i.exec(q.rest) : null;
    if (!q || !m) return b.problem(rest.at, msg('problems.text.textTakes', { word }));
    const coords = splitTop(m[1].slice(1, -1), ',');
    if (coords.length < 2 || coords.length > 3) return b.problem(rest.at, msg('problems.text.textPosition', { word }));
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
    if (!m) return b.problem(rest.at, msg('problems.text.rawTakes'));
    let obj: unknown;
    try {
        obj = JSON.parse(m[2]);
    } catch (e) {
        return b.problem(rest.at, msg('problems.text.rawJson', { kind: m[1], error: e instanceof Error ? e.message : msg('problems.text.notValidJson') }));
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return b.problem(rest.at, msg('problems.text.rawNeedsObject', { kind: m[1] }));
    const item = obj as Data;
    const kind = m[1].toLowerCase();
    if (kind === 'label') {
        b.annotations.push(item);
        return;
    }
    if (kind === 'slider') {
        const name = typeof item.name === 'string' ? b.claim(item.name, rest.at) : null;
        if (name) b.parameters.push(item);
        else if (typeof item.name !== 'string') b.problem(rest.at, msg('problems.text.rawSliderName'));
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
    // 6.0 ML: a head as ML notes write it (\sigma(x), \mathrm{ReLU}(x)) names the function by its plain name; t(x) = ... is a function t.
    const tex = readTexHead(t);
    const found = DEFINITION.exec(tex ? tex.rest : t);
    const tFunction = !!found && tNamesFunction(found[1], found[2], found[3]);
    const def = found && (!RESERVED_NAMES.has(found[1]) || tFunction) ? found : null;
    if (def && !def[4].trim()) return b.problem(body.at + t.length, msg('problems.text.needsFormula', { head: `${tex ? tex.head : def[1]}(${def[2]})` }));
    if (def) {
        const fname = (tFunction ? b.claimFunctionT(body.at) : b.claim(def[1], body.at)) ?? def[1];
        const v = def[2];
        const f = formula(def[4]);
        if (def[3]) return surface(b, fname, f.formula.text, f.options);
        return fn(b, fname, v, f.formula.text, body, f.options, tex ? tex.head : undefined);
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
    b.problem(body.at, msg(fullNow ? 'problems.text.fullNotAChartLine' : 'problems.text.notAChartLine'));
}

function fn(b: Builder, name: string, v: string, rhs: string, body: Piece, options: Piece[], head?: string) {
    const f: Data = { name, expression: rhs.trim() };
    if (head) f.head = head; // 6.0 ML: printed as written (\sigma, \mathrm{ReLU})
    if (v === 't') {
        const tuple = /^\((.*)\)$/.exec(rhs.trim());
        const parts = tuple ? splitTop(tuple[1], ',') : [];
        if (parts.length !== 2) return b.problem(body.at, msg('problems.text.needsPair', { name }));
        f.parametric = true;
        f.expression = parts[0].text;
        f.expressionY = parts[1].text;
    } else if (v === 'theta' || v === 'θ') {
        b.chart.coordinateSystem = 'polar';
    } else if (v !== 'x') {
        return b.problem(body.at, msg('problems.text.whichVariable', { head: `${name}(${v})` }));
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

// ---------------------------------------------------- beyond functions (5.0)

/** Kinds of the tools beyond functions, whose options beyondOption reads. */
function beyondOption(b: Builder, kind: string, target: Data, opt: Piece): boolean {
    const o = opt.text;
    const lower = o.toLowerCase();
    if (kind === 'dataPlot') {
        if (lower === 'dashed') return set(target, 'dashed', true);
        if (lower === 'small' || lower === 'large' || lower === 'normal') return set(target, 'size', lower);
        if (lower === 'coordinates') return set(target, 'label', '({x:2}, {y:2})');
        if (lower === 'labelled' || lower === 'labeled') return set(target, 'valueLabel', true);
        let m = /^labels\s+(.+)$/i.exec(o);
        if (m) return set(target, 'label', textValue(m[1]));
        m = /^opacity\s+(.+)$/i.exec(o);
        if (m) return numberOption(b, opt, target, 'fillOpacity', m[1]);
        return false;
    }
    if (kind === 'distribution') {
        if (lower === 'dashed') return set(target, 'dashed', true);
        const m = /^opacity\s+(.+)$/i.exec(o);
        if (m) return numberOption(b, opt, target, 'fillOpacity', m[1]);
        return false;
    }
    if (kind === 'solution') {
        if (lower === 'dashed') return set(target, 'dashed', true);
        return false;
    }
    if (kind === 'riemann') {
        if (lower === 'labelled' || lower === 'labeled') return set(target, 'valueLabel', true);
        const m = /^opacity\s+(.+)$/i.exec(o);
        if (m) return numberOption(b, opt, target, 'fillOpacity', m[1]);
        return false;
    }
    if (kind === 'probability') {
        if (lower === 'labelled' || lower === 'labeled') return set(target, 'valueLabel', true);
        let m = /^opacity\s+(.+)$/i.exec(o);
        if (m) return numberOption(b, opt, target, 'fillOpacity', m[1]);
        m = /^pattern\s+(.+)$/i.exec(o);
        if (m) return patternOption(b, opt, target, m[1]);
        return false;
    }
    // 6.0 C: vector fields, rest points, solutions of systems
    if (MOTION_KINDS.has(kind)) return motionOption(kind, target, o, () => badRange(b, opt));
    // 6.0 E: orbits, cobwebs, bifurcation diagrams, Newton's method, coloured planes, turning circles
    if (ITERATE_KINDS.has(kind)) return iterateOption(kind, target, o, () => b.problem(opt.at, msg('problems.text.needsFraction', { option: o })));
    // 6.0 A: vector arrows and the points of a list.
    if (kind === 'vector') {
        if (lower === 'dashed') return set(target, 'dashed', true);
        if (lower === 'labelled' || lower === 'labeled') return set(target, 'valueLabel', true);
        if (lower === 'tip to tail') return set(target, 'tipToTail', true);
        return false;
    }
    if (kind === 'listPoints') {
        if (lower === 'joined') return set(target, 'joined', true);
        if (lower === 'labelled' || lower === 'labeled' || lower === 'coordinates') return set(target, 'valueLabel', true);
        if (lower === 'small' || lower === 'large' || lower === 'normal') return set(target, 'size', lower);
        return false;
    }
    return false;
}

/** 6.0 G: a GeoGebra input line (src/geogebra/text.ts): `a = Slider(0, 5)` is a slider, any other line a tool that keeps its text. */
function geogebraLine(b: Builder, name: string | null, body: Piece, gg: GeoGebraRead, options: Piece[]) {
    if (gg.slider) {
        const nums = [gg.slider.min, gg.slider.max, gg.slider.step ?? '0.1', gg.slider.start ?? gg.slider.min].map(numberOf);
        if (nums.some((v) => v === null) || !(nums[1]! > nums[0]!) || !(nums[2]! > 0)) return b.problem(body.at + gg.commandAt, msg('geogebra.text.sliderTakes'));
        if (options.length) b.problem(options[0].at, msg('problems.text.noOptions', { word: 'Slider' }));
        const own = b.claim(gg.name ?? '', body.at + gg.nameAt);
        if (!own) return;
        const [min, max, step, value] = nums as number[];
        b.parameters.push({ name: own, value, min, max, step, geogebra: true });
        return;
    }
    const own = gg.name !== null ? b.claim(gg.name, body.at + gg.nameAt) : name;
    if (gg.name !== null && !own) return;
    addTool(b, 'geogebra', own, { command: gg.command, named: gg.name !== null }, options, 'geogebra');
}

/** 6.0 A: `let v = (2, 1)`, `let f(x, y) = x^2 + 4y^2`: a value tool named by the definition. */
function letLine(b: Builder, line: string) {
    const lead = /^\s*let\s+/.exec(line);
    const at = lead ? lead[0].length : 0;
    const parts = readLet(line.slice(at), at, (o) => isOption(o));
    if (!parts || !parts.expression) return b.problem(at, msg('values.text.letTakes'));
    const name = b.claim(parts.name, parts.nameAt);
    if (!name) return;
    addTool(b, 'value', name, { params: parts.params.join(', '), expression: parts.expression }, parts.options, 'value');
}

/**
 * A line that points at the nearest tool of `type` ("the data"): the field
 * is filled in once every line is read (resolveNearest), unless the line
 * names it (`of D2`).
 */
function pointAtNearest(b: Builder, tool: Data, type: string, field: string, named: string | undefined, at: number, missing: MessageKey, candidates?: string[]) {
    if (named) tool[field] = named;
    else b.nearest.push({ tool, type, field, line: b.line, at, missing, candidates });
}

/** "the data" and the like: the nearest tool of the type above the line, else the first one below. */
function resolveNearest(b: Builder) {
    for (const ref of b.nearest) {
        const at = b.tools.indexOf(ref.tool);
        const candidates = b.tools.map((t, i) => ({ t, i })).filter((c) => c.t.type === ref.type);
        // A name the line holds (P(X2 <= 1)) picks that one.
        const byName = (ref.candidates ?? []).map((n) => candidates.find((c) => c.t.name === n)).find((c) => c);
        if (byName) {
            ref.tool[ref.field] = byName.t.name;
            continue;
        }
        const above = candidates.filter((c) => c.i < at);
        const pick = above.length ? above[above.length - 1] : candidates.find((c) => c.i > at);
        if (pick) ref.tool[ref.field] = pick.t.name;
        else b.problems.push({ line: ref.line, column: ref.at + 1, message: msg(ref.missing) });
    }
}

/** Column names after `columns`: `hours and score`, `"hours studied", score`. */
function columnNames(text: string): string[] | null {
    const names = splitTop(text, ',')
        .flatMap((p) => splitTop(p.text, ' and '))
        .map((p) => textValue(p.text))
        .filter((n) => n.length > 0);
    return names.length >= 1 && names.length <= 2 ? names : null;
}

/** `use the table above` and `use the table above, columns hours and score`: a data set from the note's table. */
function useTable(b: Builder, name: string | null, rest: Piece, options: Piece[]) {
    const m = /^the\s+table\s+above\b\s*,?\s*(.*)$/i.exec(rest.text.trim());
    if (!m) return b.problem(rest.at, msg('beyond.text.useTakes'));
    const fields: Data = { source: 'table' };
    const tail = m[1].trim();
    if (tail) {
        const c = /^(?:with\s+(?:the\s+)?)?columns?\s+(.+)$/i.exec(tail);
        const names = c ? columnNames(c[1]) : null;
        if (!names) return b.problem(rest.at + rest.text.length - tail.length, msg('beyond.text.useTakes'));
        fields.xColumn = names[0];
        if (names[1]) fields.yColumn = names[1];
    }
    addTool(b, 'data', name, fields, options, 'data');
}

/** `data (1, 52), (2, 55) and (3, 61)`: a data set typed in the chart. */
function dataList(b: Builder, name: string | null, rest: Piece, options: Piece[]) {
    const parts = splitTop(rest.text, ',', rest.at)
        .flatMap((p) => splitTop(p.text, ' and ', p.at))
        .filter((p) => p.text);
    if (!parts.length || !parts.every((p) => /^\(.*\)$/.test(p.text))) return b.problem(rest.at, msg('beyond.text.dataTakes'));
    addTool(b, 'data', name, { source: 'list', points: pathOf(parts) }, options, 'data');
}

/** A data plot of "the data" (or of a named data set). */
function dataPlot(b: Builder, name: string | null, style: string, of: string | undefined, rest: Piece, options: Piece[]) {
    const tool = addTool(b, 'dataPlot', name, { style }, options, 'dataPlot');
    pointAtNearest(b, tool, 'data', 'data', of, rest.at, 'beyond.text.theDataMissing');
}

/** The draw lines of 5.0: the data as bars or a line, its regression line. True when the line was one of them. */
function drawBeyond(b: Builder, name: string | null, rest: Piece, all: Piece[]): boolean {
    // Options the words did not catch (`..., sparkly`) are named, not read as part of the line.
    const { formula, options } = /^(?:the\s+data|its|the\s+regression|the\s+\S+\s+riemann\s+sum|the\s+trapezoid)\b/i.test(rest.text.trim())
        ? formulaOptions(rest, all)
        : { formula: rest, options: all };
    const t = formula.text.trim();
    if (riemann(b, name, formula, options)) return true;
    if (slopeField(b, name, rest, all)) return true;
    if (solution(b, name, rest, all)) return true;
    let m = new RegExp(`^the\\s+data(?:\\s+of\\s+(${NAME}))?\\s+as\\s+(bars|a\\s+line|points|dots)$`, 'i').exec(t);
    if (m) {
        const how = m[2].toLowerCase().replace(/\s+/g, ' ');
        dataPlot(b, name, how === 'bars' ? 'bars' : how === 'a line' ? 'line' : 'points', m[1], rest, options);
        return true;
    }
    m = new RegExp(`^(?:its|the)\\s+regression\\s+line(?:\\s+of\\s+(${NAME}))?$`, 'i').exec(t);
    if (m) {
        dataPlot(b, name, 'regression', m[1], rest, options);
        return true;
    }
    if (/^the\s+data\b/i.test(t)) {
        b.problem(rest.at, msg('beyond.text.drawDataTakes'));
        return true;
    }
    return false;
}

/** The parts of `with mean 0 and sd 1` / `with n = 10 and p = 0.4`, by name; null when one does not read. */
function distributionParts(text: string): Record<string, string> | null {
    const out: Record<string, string> = {};
    const t = text.trim().replace(/^with\s+/i, '');
    if (!t) return out;
    for (const part of splitTop(t, ' and ')) {
        const m =
            /^(mean|mu|\\mu|μ)\s*(?:=|\s)\s*(.+)$/i.exec(part.text) ??
            /^(sd|standard\s+deviation|sigma|\\sigma|σ)\s*(?:=|\s)\s*(.+)$/i.exec(part.text) ??
            /^(n|p)\s*(?:=|\s)\s*(.+)$/.exec(part.text);
        if (!m) return null;
        const key = m[1].toLowerCase();
        const field = key === 'n' || key === 'p' ? key : /^(mean|mu|\\mu|μ)$/i.test(key) ? 'mean' : 'sd';
        out[field] = m[2].trim();
    }
    return out;
}

/** `plot the normal distribution with mean 0 and sd 1`, `plot the binomial distribution with n = 10 and p = 0.4`. True when the line was one. */
function distribution(b: Builder, name: string | null, rest: Piece, all: Piece[]): boolean {
    if (!/^the\s+(standard\s+)?(normal|binomial)\s+distribution\b/i.test(rest.text.trim())) return false;
    // Options the words did not catch (`..., sparkly`) are named, not read as a parameter.
    const { formula, options } = formulaOptions(rest, all);
    const m = /^the\s+(standard\s+)?(normal|binomial)\s+distribution\b\s*(.*)$/i.exec(formula.text.trim());
    if (!m) return false;
    const kind = m[2].toLowerCase();
    const parts = distributionParts(m[3]);
    const fields: Data = { kind };
    const allowed = kind === 'normal' ? ['mean', 'sd'] : ['n', 'p'];
    if (!parts || Object.keys(parts).some((k) => !allowed.includes(k)) || (m[1] && kind !== 'normal')) {
        b.problem(rest.at, msg(parts ? 'beyond.text.distributionPart' : 'beyond.text.distributionTakes'));
        return true;
    }
    Object.assign(fields, parts);
    addTool(b, 'distribution', name, fields, options, 'distribution');
    return true;
}

/** `shade P(-1 <= X <= 1)`, `shade P(X <= 2) of X2`: a probability shaded under a distribution. True when the line was one. */
function shadeProbability(b: Builder, name: string | null, rest: Piece, all: Piece[]): boolean {
    if (!/^(?:P|\\Pr)\s*\(/.test(rest.text.trim())) return false;
    const { formula, options } = formulaOptions(rest, all);
    const m = new RegExp(`^(?:P|\\\\Pr)\\s*\\((.*)\\)(?:\\s+of\\s+(${NAME}))?$`).exec(formula.text.trim());
    // Its brackets in pairs: `P(x) >= max(0, y)` (a function called P) is a region.
    if (!m || !bracketsPair(m[1])) return false;
    const event = m[1].trim();
    if (!event) {
        b.problem(rest.at, msg('beyond.text.probabilityTakes'));
        return true;
    }
    const tool = addTool(b, 'probability', name, { event }, options, 'probability');
    pointAtNearest(b, tool, 'distribution', 'distribution', m[2], rest.at, 'beyond.text.theDistributionMissing', eventNames(event));
    return true;
}

/**
 * `draw the left Riemann sum of f from 0 to 2 with 6 parts` (left, right,
 * middle, midpoint) and `draw the trapezoid rule of f from 0 to 2 with n
 * parts`. True when the line was one.
 */
function riemann(b: Builder, name: string | null, rest: Piece, options: Piece[]): boolean {
    const t = rest.text.trim();
    const head = /^the\s+(?:(left|right|middle|midpoint)\s+riemann\s+sum|(trapezoid(?:al)?)\s+rule)\s+of\s+/i.exec(t);
    if (!head) return false;
    const method = head[2] ? 'trapezoid' : head[1].toLowerCase() === 'midpoint' ? 'middle' : head[1].toLowerCase();
    const m = new RegExp(`^(${NAME})\\s+from\\s+(.+?)\\s+to\\s+(.+)\\s+with\\s+(.+?)\\s+parts?$`, 'i').exec(t.slice(head[0].length));
    if (!m) {
        b.problem(rest.at, msg('beyond.text.riemannTakes'));
        return true;
    }
    addTool(b, 'riemann', name, { function: m[1], method, from: m[2].trim(), to: m[3].trim(), parts: m[4].trim() }, options, 'riemann');
    return true;
}

/** The right side of y' = f(x, y), dy/dx = ..., \frac{dy}{dx} = ...; the formula itself when it has no left side. */
function slopeOf(text: string): string {
    const m = /^(?:y\s*'|\\[dt]?frac\s*\{\s*dy\s*\}\s*\{\s*dx\s*\}|dy\s*\/\s*dx)\s*=(?!=)\s*(.*)$/i.exec(text.trim());
    return (m ? m[1] : text).trim();
}

/** `draw the slope field of $y' = x - y$`. True when the line was one. */
function slopeField(b: Builder, name: string | null, rest: Piece, options: Piece[]): boolean {
    const m = /^the\s+slope\s+field\b\s*(?:of\s+)?(.*)$/i.exec(rest.text.trim());
    if (!m) return false;
    const expression = slopeOf(m[1]);
    if (!expression) {
        b.problem(rest.at, msg('beyond.text.slopeFieldTakes'));
        return true;
    }
    const f = formulaOptions({ text: expression, at: rest.at + rest.text.length - expression.length }, options);
    addTool(b, 'slopeField', name, { expression: f.formula.text }, f.options, 'slopeField');
    return true;
}

/** `draw the solution through P`, `draw the solutions through P and (0, -1)`, `draw the solution of SF2 through P`. True when the line was one. */
function solution(b: Builder, name: string | null, rest: Piece, options: Piece[]): boolean {
    const t = rest.text.trim();
    const head = new RegExp(`^the\\s+solutions?(?:\\s+of\\s+(${NAME}))?\\s+through\\s+`, 'i').exec(t);
    if (!head) {
        if (/^the\s+solutions?\b/i.test(t)) {
            b.problem(rest.at, msg('beyond.text.solutionTakes'));
            return true;
        }
        return false;
    }
    const list = trimPiece(t.slice(head[0].length), rest.at + head[0].length);
    const pieces = splitTop(list.text, ',', list.at).filter((p) => p.text);
    // The points (and points tools) come first; a piece after them that is neither is an option the words did not catch.
    const isPoint = (p: Piece) => /^\(.*\)$/.test(p.text) || NAME_RE.test(p.text);
    const parts: Piece[] = [];
    let k = 0;
    for (; k < pieces.length; k++) {
        const own = splitTop(pieces[k].text, ' and ', pieces[k].at).filter((p) => p.text);
        if (!own.every(isPoint)) break;
        parts.push(...own);
    }
    if (!parts.length) {
        b.problem(rest.at, msg('beyond.text.solutionTakes'));
        return true;
    }
    const tool = addTool(b, 'solution', name, { through: pathOf(parts) }, [...pieces.slice(k), ...options], 'solution');
    pointAtNearest(b, tool, 'slopeField', 'field', head[1], rest.at, 'beyond.text.theFieldMissing');
    return true;
}

/** Round brackets in pairs, none closed before it opens. */
function bracketsPair(s: string): boolean {
    let depth = 0;
    for (const c of s) {
        if (c === '(') depth++;
        else if (c === ')' && --depth < 0) return false;
    }
    return depth === 0;
}

// ------------------------------------------------------------ 6.0 C: motion

/**
 * A line in its step: `then` before it starts the next step (a bare `then`
 * only starts it), and every object the line makes arrives in the step the
 * lines are in, unless it says its own (`step=3`).
 */
function stepped(b: Builder, line: string) {
    const cut = thenPrefix(line);
    let text = line;
    if (cut >= 0) {
        b.step++;
        // Spaces keep the columns of the line's problems.
        text = ' '.repeat(cut) + line.slice(cut);
        if (!text.trim()) return;
    }
    const lists = [b.functions, b.surfaces, b.tools, b.annotations];
    const before = lists.map((l) => l.length);
    const problems = b.problems.length;
    statement(b, text);
    let made = false;
    lists.forEach((l, k) => {
        for (let i = before[k]; i < l.length; i++) {
            made = true;
            if (b.step > 0 && l[i].step === undefined) l[i].step = b.step;
            // 6.0 F1: step=0 written out (a line below a `then` that belongs to the first step) is no step.
            if (l[i].step === 0) delete l[i].step;
        }
    });
    if (cut >= 0 && !made && b.problems.length === problems) b.problem(0, msg('motion6.text.thenObject'));
}

/** A motion line read (src/motion6/text.ts) added as its tool; true when the line was one. */
function motionLine(b: Builder, name: string | null, read: MotionRead | null, options: Piece[]): boolean {
    if (!read) return false;
    if (read.problem) {
        b.problem(read.problem.at, msg(read.problem.key));
        return true;
    }
    const own = name ?? (read.own ? b.claim(read.own.text, read.own.at) : null);
    const fields: Data = { ...read.fields };
    if (read.type === 'trajectory') fields.dim = b.is3D ? 3 : 2;
    const tool = addTool(b, read.type, own, fields, [...read.extra, ...options], read.type);
    if (read.nearest) pointAtNearest(b, tool, 'vectorField', 'field', undefined, read.extra[0]?.at ?? 0, 'motion6.text.theFieldMissing');
    return true;
}

// ------------------------------------------------------------ 6.0 D: linear algebra

/** A line of src/linear/text.ts added as its tool; true when the line was one. */
function linearLine(b: Builder, name: string | null, read: LinearRead | null, options: Piece[], at: number): boolean {
    if (!read) return false;
    if (read.problem) {
        b.problem(at, msg(read.problem));
        return true;
    }
    addTool(b, read.type, name, read.fields, options, read.type);
    return true;
}

// ------------------------------------------------------------ 6.0 E: iterate

/** A line of part E read (src/iterate/text.ts) added as its tool; true when the line was one. */
function iterateLine(b: Builder, name: string | null, read: IterateRead | null): boolean {
    if (!read) return false;
    if (read.problem) {
        b.problem(read.problem.at, msg(read.problem.key));
        return true;
    }
    addTool(b, read.type, name, { ...read.fields }, read.extra, read.type);
    return true;
}

// ------------------------------------------------------------ 6.0 P: python

/** A python block (src/python/text.ts) as its tool; a block with no script lines is a problem. */
function pythonLine(b: Builder, blk: { name: string | null; nameAt: number; color: string | null; code: string }) {
    if (!blk.code.trim()) return b.problem(blk.nameAt, msg('python.problem.noBlock'));
    const name = blk.name ? b.claim(blk.name, blk.nameAt) : null;
    const tool: Data = { type: 'python', name: name ?? b.nextName(TOOL_PREFIX.python), code: blk.code };
    if (blk.color) tool.color = COLOR_ALIASES[blk.color.toLowerCase()] ?? (COLORS.has(blk.color.toLowerCase()) ? blk.color.toLowerCase() : blk.color);
    b.tools.push(tool);
}
