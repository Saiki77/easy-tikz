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
 */
import { Data, canonicalData, minimize, stableJson } from '../chartdata';
import { ANCHORS, COLORS, NAME_RE, ObjectList, PATTERNS, THICKNESSES, TOOL_PREFIX, definedNames, isSignCondition, niceStep, parseChartText, splitStatement, splitTop } from './parse';
import { chartWords, hasWords, writeWords } from './words';

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
    return s && s === s.trim() && !s.startsWith('"') && !s.startsWith(':') && !s.includes('|') && !hasControl(s) ? s : JSON.stringify(s);
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
        this.take('label', (v) => (typeof v === 'string' ? `labelled ${JSON.stringify(v)}` : null));
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
    for (const o of options) {
        if (!comma && rank(o) < 2) out += ` ${o}`;
        else if (lastWith && /^with\s/.test(o)) out += ` and ${o.slice(5)}`;
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
}

/** `slider c from 0 to 15, starting at 6`: the start left out when it is the low end, the step when it is the usual one. */
function sliderLine(p: Data): string {
    const parts = [`slider ${str(p.name)} from ${str(p.min)} to ${str(p.max)}`];
    const [value, min, max, step] = [p.value, p.min, p.max, p.step].map(Number);
    if (value !== min) parts.push(`starting at ${str(p.value)}`);
    if (step !== niceStep((max - min) / 100)) parts.push(`in steps of ${str(p.step)}`);
    return parts.join(', ');
}

function functionLine(min: Data, full: Data, ctx: Ctx): string {
    const name = str(full.name);
    const expr = str(full.expression);
    const exprY = str(full.expressionY);
    const parametric = full.parametric === true;
    if (!NAME_RE.test(name) || !expr.trim() || hasBar(expr) || (parametric && (!exprY.trim() || hasBar(exprY)))) return raw('function', min);
    const variable = parametric ? 't' : ctx.polar ? 'theta' : 'x';
    const head = parametric ? `plot ${name}(t) = (${expr}, ${exprY})` : `plot ${name}(${variable}) = ${expr}`;
    // A y(t) kept from a parametric past stays as an option.
    const o = new Options(min, parametric ? ['expression', 'expressionY', 'parametric'] : ['expression', 'parametric']);
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
        o.out.push(label ? `with the legend ${JSON.stringify(label)}` : 'with a legend');
    }
    const point = str(full.tangentPoint).trim();
    if (o.has('tangent') && min.tangent === true && point && cleanPiece(point, [',', ' and '])) {
        o.mark('tangent', 'tangentPoint');
        o.out.push(`with its tangent at ${point}`);
    }
    o.take('extrema', (v) => (v === true ? 'with its extrema' : null));
    return withOptions(head, o.finish());
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
    o.take('opacity', (v) => (typeof v === 'number' && Number.isFinite(v) ? `opacity ${v}` : null));
    o.take('samples', (v) => (typeof v === 'number' && Number.isFinite(v) ? `with ${v} samples` : null));
    o.take('wireframe', (v) => (v === true ? 'wireframe' : null));
    return withOptions(`plot ${name}(x, y) = ${expr}`, o.finish());
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
    const entry = (c: string, i: number) => (own(i) ? `${c} ${JSON.stringify(own(i))}` : c);
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
    if (objective && (hasBar(objective) || /\s(over|on|in)\s/i.test(objective))) return null;
    if (source === 'region') {
        if (!token(full.regionName)) return null;
        o.mark('source', 'regionName', 'objective');
        if (objective) o.mark('sense');
        return objective ? `mark the ${sense} of ${objective} in ${region(full.regionName)}` : `mark the corners of ${region(full.regionName)}`;
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
    const o = new Options(min, []);
    let head: string | null = null;
    if (type === 'region') head = regionHead(full, o);
    else if (type === 'curve') {
        const eq = str(full.equation).trim();
        const levels = str(full.levels).trim();
        if (eq && !hasBar(eq) && !hasBar(levels)) {
            if (levels && !/\sat\s/i.test(eq)) {
                const items = parts(levels, ',');
                const list = items.length > 1 && items.join(', ') === levels && items.every((v) => cleanPiece(v, [' and '])) ? andList(items) : levels;
                head = `draw the level curves of ${eq} at ${list}`;
            } else if (!levels && drawable(eq)) head = `draw ${eq}`;
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
    }
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
        o.take('label', (v) => (v === '({x:2}, {y:2})' ? 'with coordinates' : typeof v === 'string' ? `labelled ${JSON.stringify(v)}` : null));
    } else if (type === 'plane3D') {
        o.colour();
        o.take('fillOpacity', (v) => (typeof v === 'number' && Number.isFinite(v) ? `opacity ${v}` : null));
    } else {
        o.common();
        o.label();
    }
    const line = withOptions(head, o.finish());
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
    return withOptions(`write ${JSON.stringify(str(full.text))} at (${coords.join(', ')})`, o.finish());
}

// ----------------------------------------------------------------- chart

/** The chart lines, each with the fields it covers, in the order a block lists them. */
const CHART_STATEMENTS: Array<{ keys: string[]; print(min: Data, full: Data): string[] }> = [
    { keys: ['dimension'], print: (m) => (m.dimension === true ? ['3d'] : 'dimension' in m ? [`set dimension = ${JSON.stringify(m.dimension)}`] : []) },
    {
        keys: ['coordinateSystem'],
        print: (m) => (m.coordinateSystem === 'polar' ? ['polar'] : 'coordinateSystem' in m ? [`set coordinateSystem = ${JSON.stringify(m.coordinateSystem)}`] : []),
    },
    { keys: ['documentSetup'], print: (m) => (m.documentSetup === false ? ['snippet'] : 'documentSetup' in m ? [`set documentSetup = ${JSON.stringify(m.documentSetup)}`] : []) },
    {
        keys: ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'],
        print: (m, f) => {
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
            else if ('showLargeGrid' in m) out.push(`set showLargeGrid = ${JSON.stringify(large)}`);
            if (small === true) out.push('with a minor grid');
            else if ('showSmallGrid' in m) out.push(`set showSmallGrid = ${JSON.stringify(small)}`);
            return out;
        },
    },
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
    // A line that points at the only region calls it "the region": that needs no name.
    const pointing = tools.map((t, j) => (region !== null && t.regionName === region && !rawTools.has(j) ? { ...t, regionName: '' } : t));
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
    /** A printed line in the words the plugin writes (a person's own words, when they set some). */
    say: (line: string) => string;
}

/** Lines in a person's own words, when they set some and want them written (src/text/words.ts). */
function sayer(full: Data): (line: string) => string {
    const words = chartWords();
    if (!hasWords(words) || words.write !== 'yours') return (line) => line;
    const names = definedNames(full);
    return (line) => writeWords(line, words, names);
}

function printParts(data: Data): Printed {
    const min = minimize(data);
    const full = canonicalData(data);
    const is3D = full.dimension === true;
    const polar = full.coordinateSystem === 'polar';
    const tools = pairs(min, full, 'tools');
    const regions = list(full.tools).filter((t) => t.type === 'region');
    const region = regions.length === 1 && NAME_RE.test(str(regions[0].name)) ? str(regions[0].name) : null;
    // Tools no line form fits are written raw; their names count as explicit.
    const probe: Ctx = { is3D, polar, shown: new Set(), region };
    const rawTools = new Set<number>();
    tools.forEach((t, i) => {
        if (toolLine(t.min, t.full, probe).startsWith('raw ')) rawTools.add(i);
    });
    const ctx: Ctx = { is3D, polar, shown: shownNames(full, rawTools, region), region };
    const say = sayer(full);
    return {
        chart: chartLines(min, full, null).map(say),
        objects: {
            parameters: list(full.parameters).map(sliderLine).map(say),
            functions: pairs(min, full, 'functions').map((p) => say(functionLine(p.min, p.full, ctx))),
            functions3D: pairs(min, full, 'functions3D').map((p) => say(surfaceLine(p.min, p.full, ctx))),
            tools: tools.map((p) => say(toolLine(p.min, p.full, ctx))),
            annotations: pairs(min, full, 'annotations').map((p) => say(labelLine(p.min, p.full))),
        },
        say,
    };
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

const join = (p: Printed) => [...p.chart, ...LIST_NAMES.flatMap((k) => p.objects[k])].join('\n');

/** The chart a text reads as, in a form that compares equal whatever order the keys came in. */
function readAs(text: string): string {
    return stableJson(canonicalData(parseChartText(text).data));
}

/**
 * The whole chart as text. It reads back as the same chart: an object the
 * words got wrong is written as a raw line instead, a chart field as a set
 * line, and as a last resort every object is raw.
 */
export function printChartText(data: Data): string {
    const full = canonicalData(data);
    const target = stableJson(full);
    const p = printParts(data);
    const min = minimize(data);
    // No printed line may end the code block.
    for (const key of LIST_NAMES) {
        p.objects[key] = p.objects[key].map((line, i) => (FENCE.test(line) ? rawLine(key, pairs(min, full, key)[i]?.min ?? {}) : line));
    }
    let text = join(p);
    if (readAs(text) === target) return text;
    const back = canonicalData(parseChartText(text).data);
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
    if (readAs(text) === target) return text;
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
 * unchanged objects keep their lines, comments and blank lines stay.
 */
export function writeChartText(oldText: string, data: Data): string {
    const target = stableJson(canonicalData(data));
    let result: string | null = null;
    try {
        result = rewrite(oldText, data);
    } catch {
        result = null;
    }
    if (result !== null && readAs(result) === target) return result;
    return printChartText(data);
}

/** One line of the result; an object line knows the key of its object in the new chart. */
interface OutLine {
    text: string;
    list: ObjectList | null;
    key?: string;
    /** A line about the chart itself (view, title, set, ...). */
    chart?: boolean;
}

/** A new object with its printed line. */
interface Fresh {
    list: ObjectList;
    line: string;
    item: Data;
}

function rewrite(oldText: string, data: Data): string {
    const old = parseChartText(oldText, { trace: true });
    const oldFull = canonicalData(old.data);
    const newFull = canonicalData(data);
    const newMin = minimize(data);
    const printed = printParts(data);
    const lines = oldText.split(/\r\n?|\n/);
    const traces = old.lines ?? [];

    // The new objects by key, and their order per list.
    const fresh = new Map<string, Fresh>();
    const order = {} as Record<ObjectList, string[]>;
    for (const key of LIST_NAMES) {
        order[key] = [];
        list(newFull[key]).forEach((item, i) => {
            const k = itemKey(key, item, i);
            fresh.set(k, { list: key, line: printed.objects[key][i], item });
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
            if (t.object?.list !== key) continue;
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
    for (const t of traces) {
        const source = lines[t.line - 1] ?? '';
        const indent = /^\s*/.exec(source)?.[0] ?? '';
        if (t.object) {
            const k = target.get(t.line);
            if (!k) continue; // deleted in the editor
            const f = fresh.get(k);
            if (!f || placed.has(k)) continue;
            placed.add(k);
            const was = before.get(t.line);
            out.push({ text: was && withoutId(was) === withoutId(f.item) ? source : indent + f.line, list: f.list, key: k });
            continue;
        }
        if (t.chart.length) {
            const groups = [...new Set(t.chart.map(group))];
            if (!groups.some((g) => dirty.has(g))) {
                out.push({ text: source, list: null, chart: true });
                continue;
            }
            for (const g of groups) {
                if (written.has(g)) continue;
                written.add(g);
                for (const l of chartLines(newMin, newFull, new Set(g.split(' ')))) out.push({ text: indent + printed.say(l), list: null, chart: true });
            }
            continue;
        }
        out.push({ text: source, list: null }); // comments, blank lines, lines with problems
    }

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
            at = first < 0 ? out.length : first;
        }
        out.splice(at, 0, ...chartLines(newMin, newFull, new Set(rest.flatMap((g) => g.split(' ')))).map((t) => ({ text: printed.say(t), list: null, chart: true })));
    }

    // New objects: after the last line of their kind, else before the first line of a later kind, else at the end.
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
                at = i < 0 ? out.length : i;
            }
            out.splice(at, 0, { text: f.line, list: key, key: k });
            placed.add(k);
        }
    }

    // Moved in the editor: the lines of each kind keep their places, in the new order.
    for (const key of LIST_NAMES) {
        const slots = out.map((l, i) => (l.list === key ? i : -1)).filter((i) => i >= 0);
        const byKey = new Map(slots.map((i) => [out[i].key, out[i]]));
        const wanted = order[key].map((k) => byKey.get(k)).filter((l): l is OutLine => !!l);
        if (wanted.length === slots.length) slots.forEach((slot, j) => (out[slot] = wanted[j]));
    }

    keepNames(out, fresh);
    return out.map((l) => l.text).join('\n');
}

/**
 * A kept line can lean on the lines around it: a line without a name
 * (`mark the corners of R1`, `y = 2x + 1`) gets its name from them, and
 * "the region" is the chart's only region. When those changed (an object
 * above was deleted, a name became explicit, a second region came), the
 * line says what it means: a tool only renamed gets `R2: ` in front, any
 * other line its printed form.
 */
function keepNames(out: OutLine[], fresh: Map<string, Fresh>) {
    for (let round = 0; round < 3; round++) {
        const parsed = parseChartText(out.map((l) => l.text).join('\n'), { trace: true });
        const read = canonicalData(parsed.data);
        let fixed = false;
        (parsed.lines ?? []).forEach((trace, i) => {
            const entry = out[i];
            const f = entry?.key ? fresh.get(entry.key) : undefined;
            if (!f || !trace.object || trace.object.list !== f.list || f.list === 'annotations' || f.list === 'parameters') return;
            const item = list(read[f.list])[trace.object.index];
            if (!item || withoutId(item) === withoutId(f.item)) return;
            const indent = /^\s*/.exec(entry.text)?.[0] ?? '';
            const renamed = f.list === 'tools' && withoutId({ ...item, name: f.item.name }) === withoutId(f.item);
            const line = renamed ? `${indent}${str(f.item.name)}: ${entry.text.trimStart()}` : indent + f.line;
            if (line === entry.text) return;
            entry.text = line;
            fixed = true;
        });
        if (!fixed) return;
    }
}
