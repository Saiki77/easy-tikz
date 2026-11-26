/*
 * Charts as text, the other way round (src/text/parse.ts reads it).
 *
 * printChartText writes a whole chart, one line per object, in words
 * (`plot f(x) = x^2 in blue, thick`, `shade where x + y <= 4 and x >= 0`),
 * leaving out what the plugin fills in by itself. Whatever the words cannot
 * say goes into `key=value` options and `set` lines, and an object no line
 * form fits becomes a `raw` line, so every chart reads back as the same chart.
 *
 * writeChartText updates a block someone wrote: lines whose object did not
 * change stay exactly as they were (comments, order and spacing included),
 * changed objects get a new line in place, new ones are added next to their
 * kind. If the result would not read back as the same chart, the whole
 * chart is printed instead.
 *
 * Both forms of the language (5.0): new charts are printed in the form the
 * setting "Chart language" says (src/text/full.ts: words, or Full LaTeX);
 * a block someone wrote keeps its form.
 */
import { Data, canonicalData, minimize, stableJson } from '../chartdata';
import { headName } from '../ml/heads'; // 6.0 ML
import { quote } from './quote';
import { ANCHORS, COLORS, NAME_RE, ObjectList, PATTERNS, THICKNESSES, TOOL_PREFIX, definedNames, isSignCondition, niceStep, parseChartText, splitStatement, splitTop } from './parse';
import { NO_WORDS, chartWords, hasWords, readWords, typedColumn, writeWords } from './words';
import { FULL_END, axisLines, chartLanguage, exactFull, fullLine, isFullText, withName, wordsToFull } from './full';
import { isColormap } from '../colormaps';
import { looksLikeLatex } from '../latex';
import { eventNames } from '../beyond/event';
import { KIND_FIELDS } from '../beyond/kinds'; // 6.2.1
import type { DistributionKind } from '../types';
import { boxRatioOf } from '../box3d';
// 6.0 C
import { MOTION_KINDS, OWN_NAME_TYPES, keepThen, motionHead, motionOptions, thenPrefix } from '../motion6/text';
import { STEP_LISTS, hasSteps, stepOf, stepsInOrder, withoutStep } from '../motion6/steps';
import type { StepList } from '../motion6/steps';
// 6.0 B
import { axisSetHead, chordHead } from '../notes6/text';
// 6.0 D
import { LINEAR_TYPES, linearHead, linearOptions } from '../linear/text';
// 6.0 A
import { letHead, listPointsHead, vectorHead } from '../values/text';
// 6.0 P
import { pythonWords } from '../python/text';
// 6.0 E
import { ITERATE_KINDS, iterateHead, iterateOptions } from '../iterate/text';
// 6.0 F1
import { letLines } from '../values/order';
// 6.0 G
import { geogebraHead, geogebraOptions } from '../geogebra/text';

// ---------------------------------------------------------------- values

const list = (v: unknown): Data[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Data[]) : []);

/** A field as the line writes it: text as is, numbers and booleans in their usual form. */
function str(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return v === undefined || v === null ? '' : JSON.stringify(v);
}

/** A line break or another control character: a line never holds one bare (it would end the line, or the block). */
function hasControl(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
    }
    return false;
}

/** Text a line holds bare when it reads back the same, else "quoted". */
function text(s: string): string {
    return s && s === s.trim() && !s.startsWith('"') && !s.startsWith(':') && !s.includes('|') && !hasControl(s) ? s : quote(s);
}

/** Text a line cannot hold bare: a `|` that would end the statement (`||` is "or"), or a line break. */
function hasBar(s: string): boolean {
    return /(^|[^|])\|(?!\|)/.test(s) || hasControl(s);
}

/** Parts of `s` split at a top-level `sep`. */
function parts(s: string, sep: string): string[] {
    return splitTop(s, sep).map((p) => p.text);
}

/** One piece that a list line can hold: no separator of the line at the top level. */
function cleanPiece(p: string, separators: string[]): boolean {
    return !!p && !hasBar(p) && separators.every((sep) => parts(p, sep).length === 1);
}

/** A bound a line can hold in `from a to b`: no separator of the words at its top level. */
const bound = (p: string) => !!p.trim() && cleanPiece(p, [',', '..', ' to ', ' and ']);

/** `a:b` of a domain as its two bounds, or null. */
function domainBounds(d: unknown): [string, string] | null {
    const ab = typeof d === 'string' ? parts(d, ':') : [];
    return ab.length === 2 && bound(ab[0]) && bound(ab[1]) ? [ab[0], ab[1]] : null;
}

/** A list in words: `A`, `A and B`, `A, B and C`. */
function andList(items: string[]): string {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const generic = (key: string, value: unknown) => `${key}=${JSON.stringify(value)}`;
const raw = (kind: 'tool' | 'function' | 'surface' | 'label' | 'slider', item: Data) => `raw ${kind} ${JSON.stringify(item)}`;

/** A number from 0 to 1, what `grid opacity` and `mesh` read; anything else is written as a field. */
const fraction = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Options in a fixed order: the words first, then `key=value` for the rest. */
class Options {
    readonly out: string[] = [];
    private readonly done = new Set<string>();

    constructor(
        private readonly min: Data,
        skip: string[]
    ) {
        for (const k of [...skip, 'id', 'name', 'type']) this.done.add(k);
    }

    has(key: string): boolean {
        return key in this.min && !this.done.has(key);
    }

    get(key: string): unknown {
        return this.min[key];
    }

    /** A word for `key` when `word` gives one, else `key=value`. */
    take(key: string, word: (v: unknown) => string | null) {
        if (!this.has(key)) return;
        this.done.add(key);
        this.out.push(word(this.min[key]) ?? generic(key, this.min[key]));
    }

    /** Mark keys as written by the statement itself. */
    mark(...keys: string[]) {
        for (const k of keys) this.done.add(k);
    }

    colour() {
        this.take('color', (v) => (typeof v === 'string' && COLORS.has(v) ? `in ${v}` : null));
    }

    common() {
        this.colour();
        this.take('thickness', (v) => (typeof v === 'string' && THICKNESSES.includes(v) ? v : null));
        this.take('dashed', (v) => (v === true ? 'dashed' : null));
    }

    label() {
        this.take('label', (v) => (typeof v === 'string' ? `labelled ${quote(v)}` : null));
    }

    fillLook() {
        this.take('fillOpacity', (v) => (typeof v === 'number' && Number.isFinite(v) ? `opacity ${v}` : null));
        this.take('fillPattern', (v) => (typeof v === 'string' && PATTERNS.has(v) ? `pattern ${v}` : null));
    }

    finish(): string[] {
        this.take('hidden', (v) => (v === true ? 'hidden' : null));
        for (const k of Object.keys(this.min)) if (!this.done.has(k)) this.out.push(generic(k, this.min[k]));
        this.done.clear();
        return this.out;
    }
}

/** Where an option goes: a range right after the statement, then the colour, then the rest after commas. */
const rank = (o: string) => (/^(from|for)\s/.test(o) ? 0 : /^in\s/.test(o) ? 1 : 2);

/** The options in words: `head from x = 0 to 4 in blue, thick, with its tangent at a and its extrema`. */
function inWords(head: string, options: string[]): string {
    let out = head;
    // After "... in the region" a colour reads better behind a comma: "..., in red".
    let comma = /\s(in|over|on)\s+(the\s+region|\S+)$/.test(head);
    let lastWith = false;
    let lastIn = false;
    for (const o of options) {
        // A second "in" (a surface's colour and its colour map) goes behind a comma: "in red, in viridis".
        const isIn = /^in\s/.test(o);
        if (!comma && rank(o) < 2 && !(isIn && lastIn)) {
            out += ` ${o}`;
            lastIn = isIn;
        } else if (lastWith && /^with\s/.test(o)) out += ` and ${o.slice(5)}`;
        else {
            out += `, ${o}`;
            comma = true;
            lastWith = /^with\s/.test(o);
        }
    }
    return out;
}

/**
 * A statement with its options, in words when they read back as written;
 * else after a bar, which says where the options start (`head | ...`).
 */
function withOptions(head: string, options: string[]): string {
    const sorted = options.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map((x) => x.o);
    const barred = `${head} | ${sorted.join(', ')}`;
    const want = splitStatement(barred).options.join('\n');
    const words = inWords(head, sorted);
    const back = splitStatement(words);
    if (back.body === head && back.options.join('\n') === want) return words;
    return sorted.length ? barred : `${head} |`;
}

// --------------------------------------------------------------- objects

/** Context the object lines need: 3D and polar change how a line reads. */
interface Ctx {
    is3D: boolean;
    polar: boolean;
    /** Tool names a line spells out (the rest are the names the parser gives by itself). */
    shown: Set<string>;
    /** The name of the chart's only region, which lines call "the region"; null when there are none or several. */
    region: string | null;
    /** 5.0: the chart's tools and the position of the one being printed, for lines that point at the nearest tool of a type ("the data"). */
    tools: Data[];
    index: number;
}

/** `slider c from 0 to 15, starting at 6, connected`: the start left out when it is the low end, the step when it is the usual one. */
function sliderLine(p: Data): string {
    // 6.0 G: `a = Slider(0, 5)`, the step after them when it is not 0.1; moved off its low end, `, starting at 2` (GeoGebra's slider has no start).
    if (p.geogebra === true) {
        const head = `${str(p.name)} = Slider(${str(p.min)}, ${str(p.max)}${Number(p.step) === 0.1 ? '' : `, ${str(p.step)}`})`;
        return Number(p.value) === Number(p.min) ? head : `${head}, starting at ${str(p.value)}`;
    }
    const parts = [`slider ${str(p.name)} from ${str(p.min)} to ${str(p.max)}`];
    const [value, min, max, step] = [p.value, p.min, p.max, p.step].map(Number);
    if (value !== min) parts.push(`starting at ${str(p.value)}`);
    if (step !== niceStep((max - min) / 100)) parts.push(`in steps of ${str(p.step)}`);
    if (p.connected === true) parts.push('connected');
    return parts.join(', ');
}

/** A formula as the chart text writes it: LaTeX (5.0) in $...$, the plain syntax as it is. `probe` says which. */
function mathText(text: string, probe: string = text): string {
    return looksLikeLatex(probe) ? `$${text}$` : text;
}

function functionLine(min: Data, full: Data, ctx: Ctx): string {
    const name = str(full.name);
    const expr = str(full.expression);
    const exprY = str(full.expressionY);
    const parametric = full.parametric === true;
    // A LaTeX formula (5.0) is written in $...$, where a bar is an absolute value, not the option bar.
    // 6.0 ML: a head written in LaTeX (\sigma, \mathrm{ReLU}) is printed as written, in $...$.
    const head = typeof full.head === 'string' && headName(full.head) === name && !parametric ? full.head : null;
    const latex = !!head || looksLikeLatex(expr) || (parametric && looksLikeLatex(exprY));
    if (!NAME_RE.test(name) || !expr.trim() || (!latex && hasBar(expr)) || (parametric && (!exprY.trim() || (!latex && hasBar(exprY))))) return raw('function', min);
    const variable = parametric ? 't' : ctx.polar ? 'theta' : 'x';
    const body = parametric ? `${name}(t) = (${expr}, ${exprY})` : `${head ?? name}(${variable}) = ${expr}`;
    const line = `plot ${latex ? `$${body}$` : body}`;
    // A y(t) kept from a parametric past stays as an option.
    const o = new Options(min, parametric ? ['expression', 'expressionY', 'parametric'] : ['expression', 'parametric', 'head']);
    o.take('domain', (v) => {
        const r = domainBounds(v);
        if (!r) return null;
        return variable === 'x' ? `from x = ${r[0]} to ${r[1]}` : `for ${variable} from ${r[0]} to ${r[1]}`;
    });
    o.common();
    o.take('fill', (v) => (v === true ? 'filled' : null));
    o.fillLook();
    if (o.has('showLegend') && min.showLegend === true) {
        const label = str(full.legendLabel);
        o.mark('showLegend');
        if (label) o.mark('legendLabel');
        o.out.push(label ? `with the legend ${quote(label)}` : 'with a legend');
    }
    const point = str(full.tangentPoint).trim();
    if (o.has('tangent') && min.tangent === true && point && cleanPiece(point, [',', ' and '])) {
        o.mark('tangent', 'tangentPoint');
        o.out.push(`with its tangent at ${point}`);
    }
    o.take('extrema', (v) => (v === true ? 'with its extrema' : null));
    return withOptions(line, o.finish());
}

function surfaceLine(min: Data, full: Data, ctx: Ctx): string {
    const name = str(full.name);
    const expr = str(full.expression);
    // In a 2D chart a surface line would make it 3D.
    if (!ctx.is3D || !NAME_RE.test(name) || !expr.trim() || hasBar(expr)) return raw('surface', min);
    const o = new Options(min, ['expression']);
    // for x from -2 to 2 and y from -2 to 2
    const ranges = (['x', 'y'] as const)
        .map((axis) => ({ axis, key: `${axis}Domain`, r: o.has(`${axis}Domain`) ? domainBounds(min[`${axis}Domain`]) : null }))
        .filter((d) => d.r);
    if (ranges.length) {
        o.mark(...ranges.map((d) => d.key));
        o.out.push(`for ${ranges.map((d) => `${d.axis} from ${d.r?.[0] ?? ''} to ${d.r?.[1] ?? ''}`).join(' and ')}`);
    }
    o.colour();
    o.take('colormap', (v) => (isColormap(v) ? `in ${v}` : null));
    o.take('opacity', (v) => (typeof v === 'number' && Number.isFinite(v) ? `opacity ${v}` : null));
    o.take('meshOpacity', (v) => (fraction(v) ? `mesh ${v}` : null));
    o.take('samples', (v) => (typeof v === 'number' && Number.isFinite(v) ? `with ${v} samples` : null));
    o.take('wireframe', (v) => (v === true ? 'wireframe' : null));
    return withOptions(`plot ${mathText(`${name}(x, y) = ${expr}`, expr)}`, o.finish());
}

/** Labels that `numbered` writes: (1), (2), ... for every condition but the plain sign ones. */
function numberedLabels(conditions: string[]): string[] {
    let k = 0;
    return conditions.map((c) => (isSignCondition(c) ? '' : `(${++k})`));
}

/** The words of the conditions: `shade between f and g from x = a to b`, `shade where A and B`, or (4.4.0) `shade A, B`. */
function regionHead(full: Data, o: Options): string | null {
    const conditions = Array.isArray(full.conditions) ? full.conditions.map(str) : [];
    const labels = Array.isArray(full.conditionLabels) ? full.conditionLabels.map(str) : [];
    // An empty condition (a row still to be filled in) is an empty entry: `shade x >= 0, y >= 0,`.
    const printable = (c: string) =>
        c === '' || (!!c.trim() && cleanPiece(c, [',']) && !/\sfor\s/i.test(c) && !/^(between|under|where|the)\s/i.test(c) && !/"\s*$/.test(c));
    if (!conditions.some((c) => c.trim()) || !conditions.every(printable)) return null;
    const expected = numberedLabels(conditions);
    const numbered = labels.some((l) => l) && conditions.every((_, i) => (labels[i] ?? '') === expected[i]);
    // A label on an empty condition has nothing to stand behind: the labels go in as an option.
    const labelsApart = !numbered && conditions.some((c, i) => c === '' && !!labels[i]);
    const own = (i: number) => (!numbered && !labelsApart ? labels[i] ?? '' : '');
    const entry = (c: string, i: number) => (own(i) ? `${mathText(c)} ${quote(own(i))}` : mathText(c));
    o.mark('conditions');
    if (!labelsApart) o.mark('conditionLabels');
    if (numbered) o.out.push('numbered');
    // between f and g, under f: the shapes the parser writes out, and an x range closing them.
    const token = (v: string) => /^[A-Za-z][A-Za-z0-9_]*$/.test(v);
    const shape = (c: string): string | null => {
        const between = /^min\((\S+), (\S+)\) <= y <= max\((\S+), (\S+)\)$/.exec(c);
        if (between && between[1] === between[3] && between[2] === between[4] && token(between[1]) && token(between[2]) && between[1] !== '0') {
            return `between ${between[1]} and ${between[2]}`;
        }
        const under = /^min\(0, (\S+)\) <= y <= max\(0, (\S+)\)$/.exec(c);
        return under && under[1] === under[2] && token(under[1]) ? `under ${under[1]}` : null;
    };
    const first = shape(conditions[0]);
    if (first && conditions.length <= 2) {
        const range = conditions.length === 2 ? /^(.+?) <= x <= (.+)$/.exec(conditions[1]) : null;
        if (conditions.length === 1) return `shade ${entry(first, 0)}`;
        if (range && bound(range[1]) && bound(range[2]) && !/[<>]/.test(range[1] + range[2]) && !own(1)) {
            o.out.push(`from x = ${range[1]} to ${range[2]}`);
            return `shade ${entry(first, 0)}`;
        }
    }
    // where A and B: every condition one clause (no and, or or comma of its own), none empty.
    const simple = conditions.every((c) => c.trim() && parts(c, ' and ').length === 1 && parts(c, ' or ').length === 1 && parts(c, '||').length === 1);
    if (simple) return `shade where ${conditions.map(entry).join(' and ')}`;
    return `shade ${conditions.map(entry).join(', ')}`.replace(/\s+$/, '');
}

/** An equation `draw` reads as the equation itself: not a definition, a shape word or an inequality. */
function drawable(eq: string): boolean {
    return (
        !/[<>]/.test(eq) &&
        /=/.test(eq.replace(/<=|>=|==|!=/g, '')) &&
        !/^(?:(?:a|an|the)\s+)?(?:double\s+arrow|arrow|line|segment|polygon|brace|plane|curve|level\s+curves?|levels|contours?)(?![A-Za-z0-9_(])/i.test(eq) &&
        !/^(?:[*/^=<>!]|[-+]\s)/.test(eq) &&
        !/^[A-Za-z][A-Za-z0-9_]*\s*\(\s*[A-Za-zθ]+\s*(?:,\s*[A-Za-z]+\s*)?\)\s*=(?!=)/.test(eq)
    );
}

/** Points and segments read (x, y, z) in 3D charts and when a point has three coordinates. */
function inferredDim(pieces: string[], ctx: Ctx): number {
    const three = pieces.some((p) => p.startsWith('(') && parts(p.slice(1, -1), ',').length === 3);
    return ctx.is3D || three ? 3 : 2;
}

function pointsHead(full: Data, o: Options, ctx: Ctx): string | null {
    const source = str(full.source);
    if (source === 'list') {
        const pieces = parts(str(full.points), ';');
        if (!pieces.length || !pieces.every((p) => cleanPiece(p, [',', ' and ']) && (p.startsWith('(') || NAME_RE.test(p)))) return null;
        o.mark('points', 'source');
        if (Number(full.dim) === inferredDim(pieces, ctx)) o.mark('dim');
        else o.out.push(generic('dim', full.dim));
        return `mark ${andList(pieces)}`;
    }
    const token = (v: unknown) => NAME_RE.test(str(v));
    /** The region by name, or "the region" when it is the chart's only one. */
    const region = (v: unknown) => (str(v) === ctx.region ? 'the region' : str(v));
    if (source === 'intersections') {
        if (!token(full.ref1) || !token(full.ref2)) return null;
        o.mark('source', 'ref1', 'ref2');
        return `mark where ${str(full.ref1)} and ${str(full.ref2)} cross`;
    }
    const objective = str(full.objective).trim();
    const sense = str(full.sense) === 'min' ? 'minimum' : 'maximum';
    if (objective && ((!looksLikeLatex(objective) && hasBar(objective)) || /\s(over|on|in)\s/i.test(objective))) return null;
    if (source === 'region') {
        if (!token(full.regionName)) return null;
        o.mark('source', 'regionName', 'objective');
        if (objective) o.mark('sense');
        return objective ? `mark the ${sense} of ${mathText(objective)} in ${region(full.regionName)}` : `mark the corners of ${region(full.regionName)}`;
    }
    if (source === 'lattice') {
        const name = str(full.regionName);
        if (name && !token(name)) return null;
        if (objective && !name) return null;
        o.mark('source', 'regionName', 'objective');
        if (objective) o.mark('sense');
        if (objective) return `mark the integer ${sense} of ${objective} in ${region(name)}`;
        return name ? `mark the integer points in ${region(name)}` : 'mark the integer points';
    }
    return null;
}

function segmentHead(full: Data, o: Options, ctx: Ctx): string | null {
    const pieces = parts(str(full.path), ';');
    const separators = [',', '--', '->', '<-', ' to ', ' and '];
    if (pieces.length < 2 || !pieces.every((p) => cleanPiece(p, separators))) return null;
    const style = str(full.style) || 'line';
    const closed = full.closed === true;
    const path = pieces.join(' to ');
    let head: string;
    if (style === 'line' && closed) head = `draw a polygon through ${andList(pieces)}`;
    else if (style === 'line') head = `draw a line from ${path}`;
    else if (style === 'brace' && pieces.length === 2) head = `draw a brace from ${path}`;
    else if (style === 'forward' || style === 'backward') head = `draw an arrow from ${path}`;
    else if (style === 'both') head = `draw a double arrow from ${path}`;
    else return null;
    o.mark('path', 'style');
    if (style === 'backward') o.out.push('backwards');
    if (style === 'line' && closed) o.mark('closed');
    if (Number(full.dim) === inferredDim(pieces, ctx)) o.mark('dim');
    else o.out.push(generic('dim', full.dim));
    return head;
}

function toolLine(min: Data, full: Data, ctx: Ctx): string {
    const type = str(full.type);
    const name = str(full.name);
    // 6.0 P: a python block, its script as written (a name only when something shows it).
    if (type === 'python') {
        if (!NAME_RE.test(name) || /^(title|xlabel|ylabel|zlabel)$/i.test(name) || Object.keys(full).some((k) => !['type', 'name', 'id', 'code', 'color'].includes(k))) return raw('tool', min);
        return pythonWords(str(full.code), ctx.shown.has(name) ? name : null, str(full.color) || null) ?? raw('tool', min);
    }
    const o = new Options(min, []);
    let head: string | null = null;
    if (type === 'region') head = regionHead(full, o);
    else if (type === 'curve') {
        const eq = str(full.equation).trim();
        const levels = str(full.levels).trim();
        if (eq && (looksLikeLatex(eq) || !hasBar(eq)) && !hasBar(levels)) {
            if (levels && !/\sat\s/i.test(eq)) {
                const items = parts(levels, ',');
                const list = items.length > 1 && items.join(', ') === levels && items.every((v) => cleanPiece(v, [' and '])) ? andList(items) : levels;
                head = `draw the level curves of ${mathText(eq)} at ${list}`;
            } else if (!levels && drawable(eq)) head = `draw ${mathText(eq)}`;
            if (head) o.mark('equation', 'levels');
        }
    } else if (type === 'points') head = pointsHead(full, o, ctx);
    else if (type === 'segment') head = segmentHead(full, o, ctx);
    else if (type === 'plane3D' && ctx.is3D) {
        const axis = str(full.axis);
        const value = str(full.value).trim();
        if (/^[xyz]$/.test(axis) && value && !hasBar(value)) {
            head = `draw the plane ${axis} = ${value}`;
            o.mark('axis', 'value');
        }
    } else if (type === 'axisSet' || type === 'chord') head = notes6Head(full, o); // 6.0 B
    else if (BEYOND_HEADS[type]) head = BEYOND_HEADS[type](full, o, ctx);
    else if (MOTION_KINDS.has(type)) head = motionHead(full, o, { is3D: ctx.is3D, shown: ctx.shown.has(name) }); // 6.0 C
    else if (LINEAR_TYPES.has(type)) head = linearHead(full, o, ctx.is3D); // 6.0 D
    else if (ITERATE_KINDS.has(type)) head = iterateHead(full, o); // 6.0 E
    else if (type === 'geogebra') head = geogebraHead(full, o); // 6.0 G
    // `title: ...` would read as a title line, so such a name only fits a raw line.
    if (!head || !NAME_RE.test(name) || /^(title|xlabel|ylabel|zlabel)$/i.test(name)) return raw('tool', min);
    if (type === 'region') {
        o.common();
        o.fillLook();
        o.take('outline', (v) => (v === 'solid' ? 'outlined' : v === 'dashed' ? 'with a dashed outline' : null));
        o.take('fill', (v) => (v === false ? 'not filled' : null));
        o.take('constraintLines', (v) => (v === true ? 'with constraint lines' : null));
        o.label();
    } else if (type === 'points') {
        o.colour();
        o.take('size', (v) => (v === 'small' || v === 'large' || v === 'normal' ? v : null));
        o.take('dropLines', (v) => (v === true ? 'with lines to the axes' : null));
        o.take('label', (v) => (v === '({x:2}, {y:2})' ? 'with coordinates' : typeof v === 'string' ? `labelled ${quote(v)}` : null));
    } else if (type === 'plane3D') {
        o.colour();
        o.take('fillOpacity', (v) => (typeof v === 'number' && Number.isFinite(v) ? `opacity ${v}` : null));
    } else if (type === 'axisSet' || type === 'chord') {
        // 6.0 B
        o.colour();
        o.take('thickness', (v) => (typeof v === 'string' && THICKNESSES.includes(v) ? v : null));
        if (type === 'chord') o.take('dashed', (v) => (v === true ? 'dashed' : null));
        o.take('label', (v) => (typeof v === 'string' ? `labelled ${quote(v)}` : null));
        o.take('valueLabel', (v) => (v === true ? 'labelled' : null));
    } else if (BEYOND_HEADS[type]) {
        beyondOptions(type, o);
    } else if (MOTION_KINDS.has(type)) {
        motionOptions(type, o, full); // 6.0 C
    } else if (LINEAR_TYPES.has(type)) {
        linearOptions(type, o); // 6.0 D
    } else if (ITERATE_KINDS.has(type)) {
        iterateOptions(type, o); // 6.0 E
    } else if (type === 'geogebra') {
        geogebraOptions(o); // 6.0 G
    } else {
        o.common();
        o.label();
    }
    // 6.0 A: a definition's line names it (`let v = ...`); its options follow a comma.
    if (type === 'value') {
        const options = o.finish();
        return options.length ? `${head}, ${options.join(', ')}` : head;
    }
    const line = withOptions(head, o.finish());
    // 6.0 C: a vector field's line holds its name (F(x, y) = ...).
    if (OWN_NAME_TYPES.has(type)) return line;
    // 6.0 G: so does a GeoGebra line written with its name (A = (1, 2)).
    if (type === 'geogebra' && full.named === true) return line;
    return ctx.shown.has(name) ? `${name}: ${line}` : line;
}

function labelLine(min: Data, full: Data): string {
    const x = str(full.x).trim();
    const y = str(full.y).trim();
    const z = str(full.z).trim();
    const coords = z ? [x, y, z] : [x, y];
    if (!coords.every((c) => cleanPiece(c, [',']))) return raw('label', min);
    const o = new Options(min, z ? ['text', 'x', 'y', 'z'] : ['text', 'x', 'y']);
    o.colour();
    o.take('anchor', (v) => (typeof v === 'string' && ANCHORS.has(v) ? v : null));
    o.take('size', (v) => (v === 'small' || v === 'large' || v === 'normal' ? v : null));
    return withOptions(`write ${quote(str(full.text))} at (${coords.join(', ')})`, o.finish());
}

// ----------------------------------------------------------------- chart

/** The chart lines, each with the fields it covers, in the order a block lists them. */
const CHART_STATEMENTS: Array<{ keys: string[]; print(min: Data, full: Data): string[] }> = [
    { keys: ['dimension'], print: (m) => (m.dimension === true ? ['3d'] : 'dimension' in m ? [`set dimension = ${JSON.stringify(m.dimension)}`] : []) },
    // The 3D box as a cube, or with its own lengths x : y : z; without a line it follows the data ranges (the stored default).
    {
        keys: ['boxAspect', 'boxRatio'],
        print: (m) => {
            if (m.boxAspect === 'equal' && !('boxRatio' in m)) return ['cube'];
            const ratio = m.boxAspect === 'custom' ? boxRatioOf(m.boxRatio) : null;
            if (ratio) return [`box ${ratio.map((v) => str(v)).join(' x ')}`];
            return (['boxAspect', 'boxRatio'] as const).filter((k) => k in m).map((k) => `set ${k} = ${JSON.stringify(m[k])}`);
        },
    },
    {
        keys: ['coordinateSystem'],
        print: (m) => (m.coordinateSystem === 'polar' ? ['polar'] : 'coordinateSystem' in m ? [`set coordinateSystem = ${JSON.stringify(m.coordinateSystem)}`] : []),
    },
    { keys: ['documentSetup'], print: (m) => (m.documentSetup === false ? ['snippet'] : 'documentSetup' in m ? [`set documentSetup = ${JSON.stringify(m.documentSetup)}`] : []) },
    // 6.0 C: the export shows every step side by side.
    { keys: ['frames'], print: (m) => (m.frames === true ? ['frames'] : 'frames' in m ? [`set frames = ${JSON.stringify(m.frames)}`] : []) },
    // 6.0 entrances: the objects of a step appear at once in this chart.
    { keys: ['entrances'], print: (m) => (typeof m.entrances === 'boolean' ? [`set entrances = ${m.entrances ? 'on' : 'off'}`] : 'entrances' in m ? [`set entrances = ${JSON.stringify(m.entrances)}`] : []) },
    // 6.0 F4: a 3D chart that turns by itself.
    {
        keys: ['turning', 'turnSpeed'],
        print: (m) => {
            const speed = typeof m.turnSpeed === 'number' && Number.isFinite(m.turnSpeed) && m.turnSpeed > 0 ? m.turnSpeed : null;
            if (m.turning === true) return [speed !== null ? `turning, speed ${speed}` : 'turning', ...(speed === null && 'turnSpeed' in m ? [`set turnSpeed = ${JSON.stringify(m.turnSpeed)}`] : [])];
            return (['turning', 'turnSpeed'] as const).filter((k) => k in m).map((k) => `set ${k} = ${JSON.stringify(m[k])}`);
        },
    },
    {
        keys: ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax', 'fitY'],
        print: (m, f) => {
            // 6.0 B: y follows what is drawn: x only (a y range of its own, which it does not draw, as set lines).
            if (m.fitY === true) {
                const flat = f.dimension !== true && f.coordinateSystem !== 'polar';
                const x = [str(f.xmin), str(f.xmax)];
                const out = flat && x.every((p) => bound(p)) ? [`show x from ${x[0]} to ${x[1]}`] : ['set fitY = true', ...(['xmin', 'xmax'] as const).filter((k) => k in m).map((k) => `set ${k} = ${JSON.stringify(m[k])}`)];
                for (const k of ['ymin', 'ymax', 'zmin', 'zmax']) if (k in m) out.push(`set ${k} = ${JSON.stringify(m[k])}`);
                return out;
            }
            if ('fitY' in m) return [`set fitY = ${JSON.stringify(m.fitY)}`];
            if (!['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'].some((k) => k in m)) return [];
            const axes = ['x', 'y'];
            if (f.dimension === true || 'zmin' in m || 'zmax' in m) axes.push('z');
            const pieces = axes.map((a) => [str(f[`${a}min`]), str(f[`${a}max`])]);
            if (pieces.flat().some((p) => !bound(p))) {
                return ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'].filter((k) => k in m).map((k) => `set ${k} = ${JSON.stringify(m[k])}`);
            }
            return [`show ${andList(axes.map((a, i) => `${a} from ${pieces[i][0]} to ${pieces[i][1]}`))}`];
        },
    },
    {
        keys: ['size_x_cm', 'size_y_cm'],
        print: (m, f) => {
            if (!('size_x_cm' in m) && !('size_y_cm' in m)) return [];
            const w = f.size_x_cm;
            const h = f.size_y_cm;
            const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
            if (ok(w) && ok(h)) return [`size ${str(w)} x ${str(h)}`];
            return (['size_x_cm', 'size_y_cm'] as const).filter((k) => k in m).map((k) => `set ${k} = ${JSON.stringify(m[k])}`);
        },
    },
    { keys: ['equalScale'], print: (m) => (m.equalScale === true ? ['equal scale'] : 'equalScale' in m ? [`set equalScale = ${JSON.stringify(m.equalScale)}`] : []) },
    {
        keys: ['axis_style', 'showAxis'],
        print: (m) => {
            const out: string[] = [];
            if ('axis_style' in m) {
                const words: Record<string, string> = { axes: 'axes on the edges', middle: 'axes in the middle', box: 'axes in a box' };
                const word = typeof m.axis_style === 'string' ? words[m.axis_style] : undefined;
                out.push(word ?? `set axis_style = ${JSON.stringify(m.axis_style)}`);
            }
            if ('showAxis' in m) out.push(m.showAxis === false ? 'no axes' : `set showAxis = ${JSON.stringify(m.showAxis)}`);
            return out;
        },
    },
    {
        keys: ['showLargeGrid', 'showSmallGrid'],
        print: (m) => {
            const large = m.showLargeGrid;
            const small = m.showSmallGrid;
            if (large === true && small === true) return ['with a fine grid'];
            const out: string[] = [];
            if (large === true) out.push('with a grid');
            // 6.1: no grid, also where the chart look draws one.
            else if (large === false) out.push('no grid');
            else if ('showLargeGrid' in m) out.push(`set showLargeGrid = ${JSON.stringify(large)}`);
            if (small === true) out.push('with a minor grid');
            else if ('showSmallGrid' in m) out.push(`set showSmallGrid = ${JSON.stringify(small)}`);
            return out;
        },
    },
    // The grid's opacity, after the grid lines; without the line it is the default, 0.5.
    {
        keys: ['gridOpacity'],
        print: (m) => (fraction(m.gridOpacity) ? [`grid opacity ${m.gridOpacity}`] : 'gridOpacity' in m ? [`set gridOpacity = ${JSON.stringify(m.gridOpacity)}`] : []),
    },
    // The numbers of each axis (src/ticks.ts): a line for every mode but Auto; a step or values kept while
    // another mode is chosen stay as `set` lines.
    ...(['x', 'y', 'z'] as const).map((a) => ({
        keys: [`numbers_${a}`, `numbers_step_${a}`, `numbers_at_${a}`],
        print: (m: Data, f: Data) => {
            const mode = f[`numbers_${a}`];
            const step = f[`numbers_step_${a}`];
            const at = f[`numbers_at_${a}`];
            const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && !/[\r\n]/.test(v);
            const out: string[] = [];
            let usedStep = false;
            let usedAt = false;
            if (mode === 'off') out.push(`${a} numbers off`);
            else if (mode === 'every' && filled(step)) {
                out.push(`${a} numbers every ${step.trim()}`);
                usedStep = true;
            } else if (mode === 'at' && filled(at)) {
                out.push(`${a} numbers at ${at.trim()}`);
                usedAt = true;
            } else if (`numbers_${a}` in m) out.push(`set numbers_${a} = ${JSON.stringify(mode)}`);
            if (!usedStep && `numbers_step_${a}` in m) out.push(`set numbers_step_${a} = ${JSON.stringify(step)}`);
            if (!usedAt && `numbers_at_${a}` in m) out.push(`set numbers_at_${a} = ${JSON.stringify(at)}`);
            return out;
        },
    })),
    { keys: ['title'], print: (m) => (typeof m.title === 'string' ? [`title ${text(m.title)}`] : 'title' in m ? [`set title = ${JSON.stringify(m.title)}`] : []) },
    ...(['x', 'y', 'z'] as const).map((a) => ({
        keys: [`axis_label_${a}`],
        print: (m: Data) => {
            const v = m[`axis_label_${a}`];
            return typeof v === 'string' ? [`${a}label ${text(v)}`] : `axis_label_${a}` in m ? [`set axis_label_${a} = ${JSON.stringify(v)}`] : [];
        },
    })),
    {
        keys: ['variables'],
        print: (m) =>
            typeof m.variables === 'string' && m.variables.trim() && !hasBar(m.variables)
                ? [`variables ${m.variables.trim()}`]
                : 'variables' in m
                  ? [`set variables = ${JSON.stringify(m.variables)}`]
                  : [],
    },
];

const LIST_NAMES: ObjectList[] = ['parameters', 'functions', 'functions3D', 'tools', 'annotations'];
const COVERED = new Set(['v', ...LIST_NAMES, ...CHART_STATEMENTS.flatMap((s) => s.keys)]);

/** The chart lines for `keys` (all chart fields when null): the statements above, then `set` for the rest. */
function chartLines(min: Data, full: Data, keys: Set<string> | null): string[] {
    const out: string[] = [];
    for (const s of CHART_STATEMENTS) if (!keys || s.keys.some((k) => keys.has(k))) out.push(...s.print(min, full));
    for (const k of Object.keys(min)) {
        if (COVERED.has(k) || (keys && !keys.has(k))) continue;
        out.push(`set ${k} = ${JSON.stringify(min[k])}`);
    }
    return out;
}

/** The statement a chart field belongs to (its keys), or the field alone for `set` lines. */
function statementKeys(key: string): string[] {
    return CHART_STATEMENTS.find((s) => s.keys.includes(key))?.keys ?? [key];
}

// ----------------------------------------------------------------- names

/** A name is used by another line (as a word, or with a derived suffix such as P1_x). */
function referenced(name: string, others: string): boolean {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9_])${escaped}(_[A-Za-z0-9]+)?(?![A-Za-z0-9_])`).test(others);
}

/**
 * The tool names a line must spell out. A tool keeps its name off the line
 * when the parser gives it that name by itself (R1, P2, ...) and no other
 * line uses the name; everything else is written `R1: ...`.
 */
function shownNames(full: Data, rawTools: Set<number>, region: string | null): Set<string> {
    const tools = list(full.tools);
    const base = new Set<string>();
    for (const key of ['parameters', 'functions', 'functions3D'] as const) for (const item of list(full[key])) base.add(str(item.name));
    const show = new Set<number>(rawTools);
    // A line that points at the only region calls it "the region": that needs no name. So does "the data" (5.0).
    const pointing = tools.map((t, j) => {
        if (rawTools.has(j)) return t;
        let out = region !== null && t.regionName === region ? { ...t, regionName: '' } : t;
        const ref = BEYOND_REFS[str(t.type)];
        if (ref && str(out[ref.field]) && bareRef(tools, j, ref) === str(out[ref.field])) out = { ...out, [ref.field]: '' };
        return out;
    });
    tools.forEach((t, i) => {
        const name = str(t.name);
        if (!TOOL_PREFIX[str(t.type)] || !NAME_RE.test(name)) show.add(i);
        const others = stableJson({ ...full, tools: pointing.filter((_, j) => j !== i) });
        if (referenced(name, others)) show.add(i);
    });
    for (;;) {
        const explicit = new Set([...base, ...[...show].map((i) => str(tools[i].name))]);
        const taken = new Set(base);
        let changed = false;
        for (let i = 0; i < tools.length; i++) {
            const name = str(tools[i].name);
            if (show.has(i)) {
                taken.add(name);
                continue;
            }
            const prefix = TOOL_PREFIX[str(tools[i].type)];
            let n = 1;
            while (taken.has(`${prefix}${n}`) || explicit.has(`${prefix}${n}`)) n++;
            if (`${prefix}${n}` !== name) {
                show.add(i);
                changed = true;
                break;
            }
            taken.add(name);
        }
        if (!changed) return new Set([...show].map((i) => str(tools[i].name)));
    }
}

// ------------------------------------------------------------------ text

/** The items of a list in the minimized and in the canonical chart, matched by name (labels by position). */
function pairs(min: Data, full: Data, key: ObjectList): Array<{ min: Data; full: Data }> {
    const mins = list(min[key]);
    return list(full[key]).map((f, i) => {
        const byName = key === 'annotations' ? undefined : mins.find((m) => m.name === f.name);
        return { min: byName ?? mins[i] ?? {}, full: f };
    });
}

interface Printed {
    chart: string[];
    objects: Record<ObjectList, string[]>;
    /** 6.0 C: the step of every object, when `then` lines say them (each list in step order). */
    steps?: Record<StepList, number[]>;
    /** 6.0 F1: per tool, a let line that prints right after the sliders (src/values/order.ts). */
    lets?: boolean[];
    /** A printed line in the words the plugin writes (a person's own words, when they set some). */
    say: (line: string) => string;
}

/** Lines in a person's own words, when they set some and want them written (src/text/words.ts); `builtin`: the built-in words. */
function sayer(full: Data, builtin = false): (line: string) => string {
    const words = builtin ? NO_WORDS : chartWords();
    if (!hasWords(words) || words.write !== 'yours') return (line) => line;
    const names = definedNames(full);
    return (line) => writeWords(line, words, names);
}

function printParts(source: Data, builtin = false): Printed {
    // 6.0 C: with each list in step order, the steps are `then` lines (join), not options.
    const staged = hasSteps(source) ? stepsInOrder(canonicalData(source)) : null;
    const data = staged ? withoutSteps(source) : source;
    const min = minimize(data);
    const full = canonicalData(data);
    const is3D = full.dimension === true;
    const polar = full.coordinateSystem === 'polar';
    const tools = pairs(min, full, 'tools');
    const regions = list(full.tools).filter((t) => t.type === 'region');
    const region = regions.length === 1 && NAME_RE.test(str(regions[0].name)) ? str(regions[0].name) : null;
    const all = list(full.tools);
    // Tools no line form fits are written raw; their names count as explicit.
    const probe: Ctx = { is3D, polar, shown: new Set(), region, tools: all, index: -1 };
    const rawTools = new Set<number>();
    tools.forEach((t, i) => {
        if (toolLine(t.min, t.full, { ...probe, index: i }).startsWith('raw ')) rawTools.add(i);
    });
    const ctx: Ctx = { is3D, polar, shown: shownNames(full, rawTools, region), region, tools: all, index: -1 };
    const say = sayer(full, builtin);
    return {
        chart: chartLines(min, full, null).map(say),
        objects: {
            parameters: list(full.parameters).map(sliderLine).map(say),
            functions: pairs(min, full, 'functions').map((p) => say(functionLine(p.min, p.full, ctx))),
            functions3D: pairs(min, full, 'functions3D').map((p) => say(surfaceLine(p.min, p.full, ctx))),
            // 6.0 P: a python block is not in anyone's words (its script stays as written).
            tools: tools.map((p, i) => (str(p.full.type) === 'python' ? toolLine(p.min, p.full, { ...ctx, index: i }) : say(toolLine(p.min, p.full, { ...ctx, index: i })))),
            annotations: pairs(min, full, 'annotations').map((p) => say(labelLine(p.min, p.full))),
        },
        say,
        ...(staged ? { steps: staged } : {}),
        ...lets(full, staged), // 6.0 F1
    };
}

/** 6.0 F1: which tool lines are let lines that print right after the sliders. */
function lets(full: Data, staged: Record<StepList, number[]> | null): { lets?: boolean[] } {
    const lines = letLines(list(full.tools), staged?.tools);
    return lines ? { lets: lines } : {};
}

/** 6.0 F1: the object lines of a list, let lines out of the tools (they print after the sliders). */
function linesOf(p: Printed, key: ObjectList, lets: boolean): string[] {
    if (key !== 'tools' || !p.lets) return lets ? [] : p.objects[key];
    return p.objects.tools.filter((_, i) => !!p.lets?.[i] === lets);
}

/** 6.0 C: the chart without the steps of its objects (`then` lines write them). */
function withoutSteps(data: Data): Data {
    const out: Data = { ...data };
    for (const key of STEP_LISTS) if (Array.isArray(data[key])) out[key] = list(data[key]).map(withoutStep);
    return out;
}

/** 6.0 C: chart lines and sliders, then the objects step by step, `then` before the first line of every later step. */
function joinSteps(p: Printed, steps: Record<StepList, number[]>): string {
    const out = [...p.chart, ...p.objects.parameters];
    const last = Math.max(0, ...STEP_LISTS.flatMap((k) => steps[k]));
    for (let s = 0; s <= last; s++) {
        // 6.0 F1: the let lines of a step first.
        const inStep = (k: StepList, lets: boolean) => (_: string, i: number) => (steps[k][i] ?? 0) === s && (k !== 'tools' || !!p.lets?.[i] === lets);
        const lines = [...p.objects.tools.filter(inStep('tools', true)), ...STEP_LISTS.flatMap((k) => p.objects[k].filter(inStep(k, false)))];
        const then = p.say('then'); // 6.0 F1: in a person's own word for then
        if (s > 0 && !lines.length) out.push(then);
        lines.forEach((l, i) => out.push(s > 0 && i === 0 ? `${then} ${l}` : l));
    }
    return out.join('\n');
}

/** A line that would end the code block it sits in (``` or ~~~ at its start). */
const FENCE = /^\s*(`{3,}|~{3,})/;

/** An object exactly as raw JSON, for what the words cannot say. */
function rawLine(key: ObjectList, item: Data): string {
    const copy: Data = { ...item };
    delete copy.id;
    const kind = key === 'parameters' ? 'slider' : key === 'functions' ? 'function' : key === 'functions3D' ? 'surface' : key === 'tools' ? 'tool' : 'label';
    return raw(kind, copy);
}

// steps: 6.0 C; let lines after the sliders: 6.0 F1
const join = (p: Printed) => (p.steps ? joinSteps(p, p.steps) : [...p.chart, ...p.objects.parameters, ...linesOf(p, 'tools', true), ...LIST_NAMES.filter((k) => k !== 'parameters').flatMap((k) => linesOf(p, k, false))].join('\n'));

/** The chart a text reads as, in a form that compares equal whatever order the keys came in; `builtin`: only the built-in words. */
function readAs(text: string, builtin = false): string {
    return stableJson(canonicalData(parseChartText(text, builtin ? { words: NO_WORDS } : {}).data));
}

/** The whole chart as text, in the form the setting "Chart language" says: words (the default) or Full LaTeX. */
export function printChartText(data: Data): string {
    return chartLanguage() === 'full' ? printFullText(data) : printWordsText(data);
}

/**
 * The whole chart as lines in Full LaTeX (src/text/full.ts): the printed
 * words (the built-in ones) written as commands. It reads back as the same
 * chart; as a last resort every field is set and every object raw.
 */
export function printFullText(data: Data): string {
    const target = stableJson(canonicalData(data));
    const text = wordsToFull(printWordsText(data, true), { builtin: true });
    return readAs(text) === target ? text : exactFull(data);
}

/**
 * The whole chart as lines in words. It reads back as the same chart: an
 * object the words got wrong is written as a raw line instead, a chart
 * field as a set line, and as a last resort every object is raw.
 * `builtin`: in the built-in words, whatever words the person set.
 */
export function printWordsText(data: Data, builtin = false): string {
    const full = canonicalData(data);
    const target = stableJson(full);
    const p = printParts(data, builtin);
    const min = minimize(data);
    // No printed line may end the code block.
    for (const key of LIST_NAMES) {
        p.objects[key] = p.objects[key].map((line, i) => (FENCE.test(line) ? rawLine(key, pairs(min, full, key)[i]?.min ?? {}) : line));
    }
    let text = join(p);
    if (readAs(text, builtin) === target) return text;
    const back = canonicalData(parseChartText(text, builtin ? { words: NO_WORDS } : {}).data);
    for (const key of LIST_NAMES) {
        const got = list(back[key]);
        pairs(min, full, key).forEach((pair, i) => {
            if (withoutId(pair.full) !== withoutId(got[i] ?? {})) p.objects[key][i] = rawLine(key, pair.min);
        });
    }
    for (const k of Object.keys(full)) {
        if ((LIST_NAMES as readonly string[]).includes(k) || k === 'v') continue;
        if (stableJson(full[k]) !== stableJson(back[k])) p.chart.push(`set ${k} = ${JSON.stringify(full[k])}`);
    }
    text = join(p);
    if (readAs(text, builtin) === target) return text;
    const chart = Object.keys(min)
        .filter((k) => k !== 'v' && !(LIST_NAMES as readonly string[]).includes(k))
        .map((k) => `set ${k} = ${JSON.stringify(min[k])}`);
    return [...chart, ...LIST_NAMES.flatMap((key) => list(min[key]).map((item) => rawLine(key, item)))].join('\n');
}

/** Key of a list item: its name, or its position for labels. */
function itemKey(list: ObjectList, item: Data, index: number): string {
    return list === 'annotations' ? `annotations:${index}` : `${list}:${str(item.name)}`;
}

const withoutId = (item: Data): string => {
    const copy: Data = { ...item };
    delete copy.id;
    return stableJson(copy);
};

/**
 * The block text for `data`, starting from `oldText` (what the note holds):
 * unchanged objects keep their lines, comments and blank lines stay. The
 * block keeps its form: a block in Full LaTeX stays Full LaTeX, one in
 * words stays in words, whatever the setting says for new charts.
 */
export function writeChartText(oldText: string, data: Data): string {
    const target = stableJson(canonicalData(data));
    const full = isFullText(oldText);
    let result: string | null = null;
    try {
        result = rewrite(oldText, data, full ? FULL_FORM : wordsForm(printParts(data)));
    } catch {
        result = null;
    }
    if (result !== null && readAs(result) === target) return result;
    return full ? printFullText(data) : printWordsText(data);
}

/** How a block writes its lines: in words (the person's own, when they set some) or in Full LaTeX. */
interface Form {
    full: boolean;
    /** The printed lines (built-in words for Full LaTeX). */
    printed(data: Data): Printed;
    /** A printed object line in this form. */
    object(line: string): string;
    /** Printed chart lines in this form (Full LaTeX: one \axis line). */
    chart(lines: string[]): string[];
    /** A line with its object's name spelled out. */
    named(line: string, name: string): string;
}

function wordsForm(p: Printed): Form {
    return { full: false, printed: () => p, object: (l) => l, chart: (lines) => lines.map(p.say), named: (l, name) => `${name}: ${l}` };
}

const FULL_FORM: Form = { full: true, printed: (data) => printParts(data, true), object: fullLine, chart: axisLines, named: withName };

/** One line of the result; an object line knows the key of its object in the new chart. */
interface OutLine {
    text: string;
    list: ObjectList | null;
    key?: string;
    /** A line about the chart itself (view, title, set, ...). */
    chart?: boolean;
    /** 6.0 F1: the `then` of a deleted line that started a step. */
    bare?: boolean;
}

/** A new object with its printed line. */
interface Fresh {
    list: ObjectList;
    line: string;
    item: Data;
    /** 6.0 F1: the printed line in words (before the block's form), for a step written out. */
    words: string;
}

function rewrite(oldText: string, data: Data, form: Form): string {
    const old = parseChartText(oldText, { trace: true });
    const oldFull = canonicalData(old.data);
    const newFull = canonicalData(data);
    const newMin = minimize(data);
    const printed = form.printed(data);
    const lines = oldText.split(/\r\n?|\n/);
    const traces = old.lines ?? [];

    // The new objects by key, and their order per list.
    const fresh = new Map<string, Fresh>();
    const order = {} as Record<ObjectList, string[]>;
    for (const key of LIST_NAMES) {
        order[key] = [];
        list(newFull[key]).forEach((item, i) => {
            const k = itemKey(key, item, i);
            fresh.set(k, { list: key, line: form.object(printed.objects[key][i]), item, words: printed.objects[key][i] });
            order[key].push(k);
        });
    }

    // Which new object each old object line writes: the one with its name, else (renamed) the next one
    // left over in the same list, so the line stays where it was.
    const target = new Map<number, string>();
    const before = new Map<number, Data>();
    for (const key of LIST_NAMES) {
        const olds = list(oldFull[key]);
        const used = new Set<string>();
        const leftover: number[] = [];
        for (const t of traces) {
            if (t.object?.list !== key || t.part) continue; // part: 6.0 P
            const item = olds[t.object.index] ?? {};
            before.set(t.line, item);
            const k = itemKey(key, item, t.object.index);
            if (fresh.has(k) && !used.has(k)) {
                target.set(t.line, k);
                used.add(k);
            } else leftover.push(t.line);
        }
        const free = order[key].filter((k) => !used.has(k));
        leftover.forEach((line, i) => {
            if (i < free.length) target.set(line, free[i]);
        });
    }

    // Chart fields: the statements whose fields changed are written once, where their first line was.
    const group = (k: string) => statementKeys(k).join(' ');
    const dirty = new Set<string>();
    for (const k of new Set([...Object.keys(oldFull), ...Object.keys(newFull)])) {
        if ((LIST_NAMES as readonly string[]).includes(k) || k === 'v') continue;
        if (stableJson(oldFull[k]) !== stableJson(newFull[k])) dirty.add(group(k));
    }
    const written = new Set<string>();

    const out: OutLine[] = [];
    const placed = new Set<string>();
    // 6.0 P: the line whose object kept its text: its further lines (a script) stay with it.
    let kept: OutLine | null = null;
    for (const t of traces) {
        const source = lines[t.line - 1] ?? '';
        const indent = /^\s*/.exec(source)?.[0] ?? '';
        if (t.part) {
            if (kept) kept.text += '\n' + source;
            // A chart comment between the lines of a script written anew (or deleted) stays, after it.
            else if (/^\s*(?:%|\/\/)/.test(source)) out.push({ text: source, list: null });
            continue;
        }
        kept = null;
        if (t.object) {
            const k = target.get(t.line);
            if (!k) {
                // Deleted in the editor. 6.0 F1: a line that started a step leaves its `then`, so the steps below keep their numbers.
                if (startsStep(source, form.full)) out.push({ text: indent + (form.full ? '\\then' : printed.say('then')), list: null, bare: true });
                continue;
            }
            const f = fresh.get(k);
            if (!f || placed.has(k)) continue;
            placed.add(k);
            const was = before.get(t.line);
            // keepThen: 6.0 C, a changed line stays in its step.
            const same = !!was && withoutId(was) === withoutId(f.item);
            // 6.0 P: a python block whose script stayed: its head line anew, its script lines as they were.
            const script = str(f.item.type) === 'python' && !!was && str(was.code) === str(f.item.code);
            const pyText = script ? indent + f.line.split('\n')[0].trim() : indent + f.line;
            const line: OutLine = { text: same ? source : str(f.item.type) === 'python' ? pyText : indent + keepThenIn(source, keepForm(source, f.line), form, printed.say), list: f.list, key: k };
            out.push(line);
            if (same || script) kept = line; // 6.0 P
            continue;
        }
        if (t.chart.length) {
            const groups = [...new Set(t.chart.map(group))];
            if (!groups.some((g) => dirty.has(g))) {
                out.push({ text: source, list: null, chart: true });
                continue;
            }
            // The line again with everything it set (a Full LaTeX \axis line sets many fields at once), each field once.
            const todo = groups.filter((g) => !written.has(g));
            for (const g of todo) written.add(g);
            const keys = (g: string[]) => new Set(g.flatMap((x) => x.split(' ')));
            const made = form.full ? form.chart(chartLines(newMin, newFull, keys(todo))) : todo.flatMap((g) => form.chart(chartLines(newMin, newFull, keys([g]))));
            for (const l of made) out.push({ text: indent + l, list: null, chart: true });
            continue;
        }
        out.push({ text: source, list: null }); // comments, blank lines, lines with problems, \begin{chart} and \end{chart}
    }

    /** The end of the block's lines: before \end{chart} in Full LaTeX. */
    const end = () => {
        if (!form.full) return out.length;
        for (let i = out.length - 1; i >= 0; i--) if (out[i].list === null && out[i].text.trim() === FULL_END) return i;
        return out.length;
    };

    // Changed chart fields no line set: after the last chart line, else before the first object.
    const rest = [...dirty].filter((g) => !written.has(g));
    if (rest.length) {
        let at = -1;
        for (let i = out.length - 1; i >= 0; i--) {
            if (out[i].chart) {
                at = i + 1;
                break;
            }
        }
        if (at < 0) {
            const first = out.findIndex((l) => l.list !== null);
            at = first < 0 ? end() : first;
        }
        out.splice(at, 0, ...form.chart(chartLines(newMin, newFull, new Set(rest.flatMap((g) => g.split(' '))))).map((t) => ({ text: t, list: null, chart: true })));
    }

    // New objects: after the last line of their kind, else before the first line of a later kind, else at the end.
    // 6.0 F1: the `then` of a deleted line goes onto the object line right below it, when that starts no step.
    for (let i = out.length - 2; i >= 0; i--) {
        if (out[i].bare && out[i + 1].list !== null && !startsStep(out[i + 1].text, form.full)) out.splice(i, 2, withThen(out[i + 1], true, form, printed.say));
    }
    // 6.0 F1: in a chart with steps, at the end of their step (stepSpot).
    const stepped = hasSteps(newFull) || out.some((l) => startsStep(l.text, form.full));
    for (const key of LIST_NAMES) {
        for (const k of order[key]) {
            if (placed.has(k)) continue;
            const f = fresh.get(k);
            if (!f) continue;
            let at = -1;
            for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].list === key) {
                    at = i + 1;
                    break;
                }
            }
            if (at < 0) {
                const later = LIST_NAMES.slice(LIST_NAMES.indexOf(key) + 1);
                const i = out.findIndex((l) => l.list !== null && later.includes(l.list));
                at = i < 0 ? end() : i;
            }
            // 6.0 F1: a new let line that leads the tools goes after the let lines, else after the sliders.
            if (key === 'tools' && order.tools.slice(0, order.tools.indexOf(k) + 1).every((x) => fresh.get(x)?.item.type === 'value') && !stepOf(f.item)) at = letSpot(out, fresh, at);
            const put = stepped ? stepSpot(out, at, k, f, order[key], form, printed.say, end()) : { at, text: f.line }; // 6.0 F1
            out.splice(put.at, 0, { text: put.text, list: key, key: k });
            placed.add(k);
        }
    }

    // Moved in the editor: the lines of each kind keep their places, in the new order.
    for (const key of LIST_NAMES) {
        const slots = out.map((l, i) => (l.list === key ? i : -1)).filter((i) => i >= 0);
        const byKey = new Map(slots.map((i) => [out[i].key, out[i]]));
        const wanted = order[key].map((k) => byKey.get(k)).filter((l): l is OutLine => !!l);
        // 6.0 F1: in a chart with steps a step starts where it started: the `then` stays with the place, not the line.
        const starts = stepped ? slots.map((i) => startsStep(out[i].text, form.full)) : [];
        if (wanted.length === slots.length) slots.forEach((slot, j) => (out[slot] = stepped && wanted[j] !== out[slot] ? withThen(wanted[j], starts[j], form, printed.say) : wanted[j]));
    }
    if (stepped) writeSteps(out, fresh, form, printed.say); // 6.0 F1

    // 6.0 AI: a line that cannot say its object in words is written raw, as the whole print writes it.
    keepNames(out, fresh, form, (f) => form.object(rawLine(f.list, list(newMin[f.list]).find((m) => m.name === f.item.name) ?? f.item)));
    return out.map((l) => l.text).join('\n');
}

/** 6.0 F1: keepThen for a line that may start with a person's own word for then: the new line starts with the word the plugin writes. */
function keepThenIn(source: string, printed: string, form: Form, say: (line: string) => string): string {
    const words = chartWords();
    if (form.full || !hasWords(words)) return keepThen(source, printed);
    const out = keepThen(readWords(source, words).text, printed);
    if (out === printed) return out;
    const lead = /^\s*/.exec(out)?.[0] ?? '';
    return `${lead}${say('then')}${out.slice(lead.length + 'then'.length)}`;
}

/** 6.0 F1: does a line of the block start a step (`then ...`, a person's word for then, `\\then`)? */
function startsStep(text: string, full: boolean): boolean {
    if (full) return /^\s*\\then\b/.test(text);
    const words = chartWords();
    return thenPrefix(hasWords(words) ? readWords(text, words).text : text) >= 0;
}

/**
 * 6.0 F1: where a new line goes in a chart with steps, and its text: at the
 * end of its step (before the line that starts the next one, or at the end;
 * `then` before it when it starts a new last step), when the order of its
 * list allows that; else where its list puts it, with its step written out.
 */
function stepSpot(out: OutLine[], at: number, k: string, f: Fresh, order: string[], form: Form, say: (line: string) => string, last: number): { at: number; text: string } {
    const step = stepOf(f.item);
    const starts = out.map((l) => startsStep(l.text, form.full));
    const stepAt = (i: number) => starts.slice(0, i).filter(Boolean).length;
    const idx = order.indexOf(k);
    // The lines of its list above the spot hold the objects before it, those below the ones after it.
    const fits = (c: number) => out.every((l, i) => l.list !== f.list || !l.key || (i < c ? order.indexOf(l.key) < idx : order.indexOf(l.key) > idx));
    if (stepAt(at) === step && fits(at)) return { at, text: f.line };
    const total = stepAt(out.length);
    if (step <= total) {
        let c = last;
        for (let i = 0; i < out.length; i++) {
            if (starts[i] && stepAt(i) === step) {
                c = i;
                break;
            }
        }
        if (fits(c)) return { at: c, text: f.line };
    } else if (step === total + 1 && fits(last)) {
        return { at: last, text: form.full ? `\\then ${f.line}` : `${say('then')} ${f.line}` };
    }
    return { at, text: /\bstep=/.test(f.words) ? f.line : form.object(`${f.words}, step=${step}`) };
}

/** 6.0 F1: a line with or without the `then` that starts a step (in the words the block uses). */
function withThen(l: OutLine, then: boolean, form: Form, say: (line: string) => string): OutLine {
    if (startsStep(l.text, form.full) === then) return l;
    const indent = /^\s*/.exec(l.text)?.[0] ?? '';
    const body = l.text.slice(indent.length);
    if (then) return { ...l, text: `${indent}${form.full ? '\\then' : say('then')} ${body}` };
    if (form.full) return { ...l, text: indent + body.replace(/^\\then\b\s*/, '') };
    const words = chartWords();
    if (!hasWords(words)) return { ...l, text: indent + body.slice(Math.max(0, thenPrefix(body))) };
    const read = readWords(body, words);
    return { ...l, text: indent + body.slice(typedColumn(read.maps, 1, thenPrefix(read.text) + 1) - 1) };
}

/** 6.0 F1: an object line whose place gives it another step than its own (it moved, or a `then` above it went): its step written out. */
function writeSteps(out: OutLine[], fresh: Map<string, Fresh>, form: Form, say: (line: string) => string) {
    let step = 0;
    out.forEach((l, i) => {
        const then = startsStep(l.text, form.full);
        if (then) step++;
        const f = l.key ? fresh.get(l.key) : undefined;
        if (!f || l.list === 'parameters' || stepOf(f.item) === step || /\bstep=/.test(l.text)) return;
        const line = /\bstep=/.test(f.words) ? f.line : form.object(`${f.words}, step=${stepOf(f.item)}`);
        const indent = /^\s*/.exec(l.text)?.[0] ?? '';
        out[i] = withThen({ ...l, text: indent + line }, then, form, say);
    });
}

/** 6.0 F1: where a new let line goes: after the last let line, else after the last slider line, else before the first object line (`fallback` when none). */
function letSpot(out: OutLine[], fresh: Map<string, Fresh>, fallback: number): number {
    for (let i = out.length - 1; i >= 0; i--) {
        const item = out[i].list === 'tools' && out[i].key ? fresh.get(out[i].key ?? '')?.item : undefined;
        if (item && item.type === 'value' && !stepOf(item)) return i + 1;
    }
    for (let i = out.length - 1; i >= 0; i--) if (out[i].list === 'parameters') return i + 1;
    const first = out.findIndex((l) => l.list !== null);
    return first < 0 ? fallback : Math.min(first, fallback);
}

/**
 * A kept line can lean on the lines around it: a line without a name
 * (`mark the corners of R1`, `y = 2x + 1`) gets its name from them, and
 * "the region" is the chart's only region. When those changed (an object
 * above was deleted, a name became explicit, a second region came), the
 * line says what it means: a tool only renamed gets `R2: ` in front, any
 * other line its printed form.
 */
function keepNames(out: OutLine[], fresh: Map<string, Fresh>, form: Form, raw: (f: Fresh) => string) {
    // 6.0 AI: lines written anew once that still read as another object (a shade whose distribution went: the printed line points at the nearest one).
    const tried = new Set<OutLine>();
    for (let round = 0; round < 3; round++) {
        const parsed = parseChartText(out.map((l) => l.text).join('\n'), { trace: true });
        const read = canonicalData(parsed.data);
        let fixed = false;
        // 6.0 AI: the entry each text line starts (an entry may hold several lines: a python block).
        const entryAt = new Map<number, OutLine>();
        let at = 1;
        for (const l of out) {
            entryAt.set(at, l);
            at += l.text.split('\n').length;
        }
        (parsed.lines ?? []).forEach((trace) => {
            const entry = entryAt.get(trace.line);
            const f = entry?.key ? fresh.get(entry.key) : undefined;
            if (!entry || !f || !trace.object || trace.part || trace.object.list !== f.list || f.list === 'annotations' || f.list === 'parameters') return;
            const item = list(read[f.list])[trace.object.index];
            if (!item || withoutId(item) === withoutId(f.item)) return;
            const indent = /^\s*/.exec(entry.text)?.[0] ?? '';
            const renamed = f.list === 'tools' && withoutId({ ...item, name: f.item.name }) === withoutId(f.item);
            let line = renamed ? indent + form.named(entry.text.trimStart(), str(f.item.name)) : indent + f.line;
            if (tried.has(entry) && !entry.text.includes('\n')) line = indent + raw(f); // 6.0 AI
            tried.add(entry);
            if (line === entry.text) return;
            entry.text = line;
            fixed = true;
        });
        if (!fixed) return;
    }
}

// ---------------------------------------------------- beyond functions (5.0)

/**
 * Fields that name a tool a line may point at without its name ("the data"),
 * by the type of the pointing tool; `names` are names in the line itself that
 * pick one (P(X2 <= 1)).
 */
const BEYOND_REFS: Record<string, { field: string; type: string; names?: (t: Data) => string[] }> = {
    dataPlot: { field: 'data', type: 'data' },
    solution: { field: 'field', type: 'slopeField' },
    probability: { field: 'distribution', type: 'distribution', names: (t) => eventNames(str(t.event)) },
};

/** The tool of `ref.type` the parser gives tool `index` when its line names none: one its line names, else the nearest above, else the first below. */
function bareRef(tools: Data[], index: number, ref: { type: string; names?: (t: Data) => string[] }): string {
    const of = tools.map((t, i) => ({ t, i })).filter((c) => c.t.type === ref.type);
    const own = tools[index];
    for (const n of own && ref.names ? ref.names(own) : []) if (of.some((c) => str(c.t.name) === n)) return n;
    const above = of.filter((c) => c.i < index);
    const pick = above.length ? above[above.length - 1] : of.find((c) => c.i > index);
    return pick ? str(pick.t.name) : '';
}

/** ` of D2`, or '' when the line points at it without its name (the nearest above); null when no line form says it. */
function refPhrase(full: Data, ctx: Ctx, field: string): string | null {
    const name = str(full[field]);
    const ref = BEYOND_REFS[str(full.type)];
    if (name && ref && ctx.index >= 0 && bareRef(ctx.tools, ctx.index, ref) === name) return '';
    return NAME_RE.test(name) ? ` of ${name}` : null;
}

/** Round brackets in pairs, none closed before it opens. */
function balanced(s: string): boolean {
    let depth = 0;
    for (const c of s) {
        if (c === '(') depth++;
        else if (c === ')' && --depth < 0) return false;
    }
    return depth === 0;
}

/** A formula of a line: in $...$ when it is LaTeX, and only when no separator of the line can cut it. */
function part(v: unknown): string | null {
    const s = str(v).trim();
    return s && bound(s) ? mathText(s) : null;
}

/** A column name as `columns ...` reads it back: bare when it is a plain name, else in quotes. */
function columnName(name: string): string {
    return name === name.trim() && /^[^",|]+$/.test(name) && splitTop(name, ' and ').length === 1 && !/^(?:and|with)\b/i.test(name) ? name : quote(name);
}

/** 6.2.1: the line of each new kind of distribution, from the values of its fields (KIND_FIELDS order). */
const NEW_KINDS: Record<string, (v: string[]) => string> = {
    studentT: ([df]) => `the t distribution with df = ${df}`,
    chiSquare: ([df]) => `the chi-square distribution with df = ${df}`,
    exponential: ([rate]) => `the exponential distribution with rate ${rate}`,
    uniform: ([from, to]) => `the uniform distribution from ${from} to ${to}`,
    poisson: ([lambda]) => `the Poisson distribution with mean ${lambda}`,
    gamma: ([shape, rate]) => `the gamma distribution with shape ${shape} and rate ${rate}`,
    beta: ([a, b]) => `the beta distribution with a = ${a} and b = ${b}`,
};

/** The statement of each type of tool beyond functions (null: no line form fits, the tool is written raw). */
const BEYOND_HEADS: Record<string, (full: Data, o: Options, ctx: Ctx) => string | null> = {
    data: (full, o) => {
        if (str(full.source) === 'list') {
            const pieces = parts(str(full.points), ';');
            if (!pieces.length || !pieces.every((p) => cleanPiece(p, [',', ' and ']) && /^\(.*\)$/.test(p))) return null;
            o.mark('source', 'points');
            return `data ${pieces.join(', ')}`;
        }
        o.mark('source');
        const x = str(full.xColumn);
        const y = str(full.yColumn);
        if (!x || hasControl(x) || hasControl(y)) return 'use the table above';
        o.mark('xColumn');
        if (y) o.mark('yColumn');
        return `use the table above, columns ${columnName(x)}${y ? ` and ${columnName(y)}` : ''}`;
    },
    dataPlot: (full, o, ctx) => {
        const of = refPhrase(full, ctx, 'data');
        if (of === null) return null;
        o.mark('data', 'style');
        switch (str(full.style)) {
            case 'bars':
                return `draw the data${of} as bars`;
            case 'line':
                return `draw the data${of} as a line`;
            case 'regression':
                return of ? `draw the regression line${of}` : 'draw its regression line';
            default:
                return `mark the data${of}`;
        }
    },
    distribution: (full, o) => {
        // 6.2.1: the t, chi-square, exponential, uniform, Poisson, gamma and beta distributions.
        const kind = str(full.kind);
        const own = NEW_KINDS[kind];
        if (own) {
            const values = KIND_FIELDS[kind as DistributionKind].map((f) => part(full[f]));
            if (values.some((v) => v === null)) return null;
            o.mark('kind', ...KIND_FIELDS[kind as DistributionKind]);
            return `plot ${own(values as string[])}`;
        }
        if (str(full.kind) === 'binomial') {
            const n = part(full.n);
            const p = part(full.p);
            if (n === null || p === null) return null;
            o.mark('kind', 'n', 'p');
            return `plot the binomial distribution with n = ${n} and p = ${p}`;
        }
        const mean = part(full.mean);
        const sd = part(full.sd);
        if (mean === null || sd === null) return null;
        o.mark('kind', 'mean', 'sd');
        return `plot the normal distribution with mean ${mean} and sd ${sd}`;
    },
    slopeField: (full, o) => {
        const expr = str(full.expression).trim();
        const latex = looksLikeLatex(expr);
        if (!expr || hasControl(expr) || (!latex && hasBar(expr)) || parts(expr, ',').length !== 1) return null;
        o.mark('expression');
        return `draw the slope field of ${mathText(`y' = ${expr}`, expr)}`;
    },
    solution: (full, o, ctx) => {
        const pieces = parts(str(full.through), ';');
        if (!pieces.length || !pieces.every((p) => cleanPiece(p, [',', ' and ']) && (/^\(.*\)$/.test(p) || NAME_RE.test(p)))) return null;
        const of = refPhrase(full, ctx, 'field');
        if (of === null) return null;
        o.mark('field', 'through');
        return `draw the ${pieces.length > 1 ? 'solutions' : 'solution'}${of} through ${andList(pieces)}`;
    },
    riemann: (full, o) => {
        const fn = str(full.function);
        const from = part(full.from);
        const to = part(full.to);
        const parts = part(full.parts);
        if (!NAME_RE.test(fn) || from === null || to === null || parts === null || /\swith\s/i.test(to)) return null;
        o.mark('function', 'method', 'from', 'to', 'parts');
        const method = str(full.method);
        const what = method === 'trapezoid' ? 'the trapezoid rule' : `the ${method === 'right' || method === 'middle' ? method : 'left'} Riemann sum`;
        return `draw ${what} of ${fn} from ${from} to ${to} with ${parts} ${parts === '1' ? 'part' : 'parts'}`;
    },
    // 6.0 A: values (src/values/text.ts).
    value: (full, o) => {
        const head = letHead(full);
        if (head) o.mark('params', 'expression');
        return head;
    },
    vector: (full, o) => {
        const head = vectorHead(full);
        if (head) o.mark('vectors', 'from', 'tipToTail');
        return head;
    },
    listPoints: (full, o) => {
        const head = listPointsHead(full);
        if (head) o.mark('points');
        return head;
    },
    probability: (full, o, ctx) => {
        const event = str(full.event).trim();
        // The event stands in brackets: no bar, no line break, and its brackets in pairs.
        if (!event || hasControl(event) || (!looksLikeLatex(event) && hasBar(event)) || !balanced(event)) return null;
        const of = refPhrase(full, ctx, 'distribution');
        if (of === null) return null;
        o.mark('event', 'distribution');
        return `shade ${mathText(`P(${event})`, event)}${of}`;
    },
};

/** The options of a tool beyond functions, in words where they have some. */
function beyondOptions(type: string, o: Options) {
    o.colour();
    if (type === 'distribution') {
        o.take('thickness', (v) => (typeof v === 'string' && THICKNESSES.includes(v) ? v : null));
        o.take('dashed', (v) => (v === true ? 'dashed' : null));
        o.take('fillOpacity', (v) => (typeof v === 'number' && Number.isFinite(v) ? `opacity ${v}` : null));
    }
    if (type === 'slopeField' || type === 'solution') {
        o.take('thickness', (v) => (typeof v === 'string' && THICKNESSES.includes(v) ? v : null));
        o.take('dashed', (v) => (v === true ? 'dashed' : null));
    }
    if (type === 'riemann') {
        o.take('thickness', (v) => (typeof v === 'string' && THICKNESSES.includes(v) ? v : null));
        o.take('fillOpacity', (v) => (typeof v === 'number' && Number.isFinite(v) ? `opacity ${v}` : null));
        o.take('label', (v) => (typeof v === 'string' ? `labelled ${quote(v)}` : null));
        o.take('valueLabel', (v) => (v === true ? 'labelled' : null));
    }
    if (type === 'probability') {
        o.fillLook();
        o.take('label', (v) => (typeof v === 'string' ? `labelled ${quote(v)}` : null));
        o.take('valueLabel', (v) => (v === true ? 'labelled' : null));
    }
    // 6.0 A
    if (type === 'vector') {
        o.take('thickness', (v) => (typeof v === 'string' && THICKNESSES.includes(v) ? v : null));
        o.take('dashed', (v) => (v === true ? 'dashed' : null));
        o.take('label', (v) => (typeof v === 'string' ? `labelled ${quote(v)}` : null));
        o.take('valueLabel', (v) => (v === true ? 'labelled' : null));
    }
    if (type === 'listPoints') {
        o.take('joined', (v) => (v === true ? 'joined' : null));
        o.take('size', (v) => (v === 'small' || v === 'large' || v === 'normal' ? v : null));
        o.take('thickness', (v) => (typeof v === 'string' && THICKNESSES.includes(v) ? v : null));
        o.take('label', (v) => (typeof v === 'string' ? `labelled ${quote(v)}` : null));
        o.take('valueLabel', (v) => (v === true ? 'labelled' : null));
    }
    if (type === 'dataPlot') {
        o.take('size', (v) => (v === 'small' || v === 'large' || v === 'normal' ? v : null));
        o.take('thickness', (v) => (typeof v === 'string' && THICKNESSES.includes(v) ? v : null));
        o.take('dashed', (v) => (v === true ? 'dashed' : null));
        o.take('fillOpacity', (v) => (typeof v === 'number' && Number.isFinite(v) ? `opacity ${v}` : null));
        o.take('label', (v) => (v === '({x:2}, {y:2})' ? 'with coordinates' : typeof v === 'string' ? `labelled ${quote(v)}` : null));
        o.take('valueLabel', (v) => (v === true ? 'labelled' : null));
    }
}

// ------------------------------------------------------------- 6.0 B

/** The statement of a set on an axis or a chord (null: no line form fits, the tool is written raw). */
function notes6Head(full: Data, o: Options): string | null {
    if (str(full.type) === 'axisSet') {
        const cond = str(full.condition).trim();
        const latex = looksLikeLatex(cond);
        // The condition stands between `where` and `on the x-axis`: no comma or bar of the line, no `on the` of its own.
        if (!cond || hasControl(cond) || (!latex && hasBar(cond)) || parts(cond, ',').length !== 1 || /\son\s+the\s/i.test(cond)) return null;
        const axis = str(full.axis) === 'y' ? 'y' : 'x';
        o.mark('condition', 'axis');
        return axisSetHead(mathText(cond), axis);
    }
    const fn = str(full.function);
    const from = part(full.from);
    const to = part(full.to);
    const atRaw = str(full.at).trim();
    const at = atRaw ? part(atRaw) : '';
    if (!NAME_RE.test(fn) || from === null || to === null || at === null || /\s(?:to|at)\s/i.test(to) || /\sat\s/i.test(from) || /\sat\s/i.test(at)) return null;
    o.mark('function', 'from', 'to', 'at');
    return chordHead(fn, from, to, at);
}

/**
 * A changed line keeps the form it was written in where the printer has
 * another one for it (5.0): `mark P at (1, 2)` stays so when P moves, where
 * a whole print writes `P: mark (1, 2.5)`. Anything else is the printed line.
 */
function keepForm(source: string, printed: string): string {
    const old = /^\s*mark\s+([A-Za-z][A-Za-z0-9_]*)\s+at\s+\(/i.exec(source);
    if (!old) return printed;
    const head = `${old[1]}: mark (`;
    if (!printed.startsWith(head)) return printed;
    // The point's closing bracket, then nothing but options after a comma or a phrase.
    let depth = 0;
    let end = -1;
    for (let i = head.length - 1; i < printed.length; i++) {
        if (printed[i] === '(') depth++;
        else if (printed[i] === ')' && --depth === 0) {
            end = i;
            break;
        }
    }
    if (end < 0) return printed;
    const rest = printed.slice(end + 1);
    if (/^\s*(?:and\b|,\s*\()/.test(rest)) return printed;
    return `mark ${old[1]} at ${printed.slice(head.length - 1, end + 1)}${rest}`;
}
