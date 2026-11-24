/*
 * 6.0 G: GeoGebra input lines as chart lines, both ways (what parse.ts,
 * print.ts and full.ts call for them). Pure: no DOM, no Obsidian.
 *
 *   A = (1, 2)                                  a point (a free one is blue)
 *   u = (3, 1)                                  a vector: a lower case name, as in GeoGebra
 *   c = Circle(A, 3)                            an object of its own
 *   L = Sequence((k, k^2), k, 1, 10)            a list of points
 *   M = {{1, 2}, {3, 4}}                        a matrix (a value, drawn as nothing)
 *   f = x^2 - 2                                 a function of x
 *   a = Slider(0, 5)                            a slider
 *   IterationList(z^2 + c, z, {0 + 0ί}, 20)     a bare command (named G1, G2, ...)
 *
 * The line keeps its text: it prints back as written, its options after it
 * (`c = Circle(A, 3) in red, dashed`). Full LaTeX: \geogebra[red]{c = Circle(A, 3)}.
 * A line `name = formula` is GeoGebra's only when the name is no name of
 * the chart (a slider, a function, a let name, a named object): then
 * `a = x^2 + y^2` stays the curve it always was. A formula in x and y and
 * no command stays a curve too.
 */
import type { MessageKey } from '../i18n';
import { callsGeoGebra, isGeoGebraCommand } from './syntax';

type Data = Record<string, unknown>;

/** The kind of this part, as option messages name it. */
export const GEOGEBRA_KINDS: ReadonlySet<string> = new Set(['geogebra']);

/** What a GeoGebra line takes as options, for "unknown option" messages (chart words: they stay English). */
export const GEOGEBRA_OPTION_HELP: Record<string, string> = {
    geogebra: 'in a colour, thin, thick, dashed, small, large, opacity 0.3, labelled, labelled "text", no label, hidden',
};

export const GEOGEBRA_KIND_WORDS: Record<string, MessageKey> = { geogebra: 'geogebra.text.kind' };

/** Full LaTeX keys of a GeoGebra line, for messages. */
export const GEOGEBRA_FULL_HELP: Record<string, string> = {
    geogebra: 'a colour, thin, thick, dashed, small, large, opacity=0.3, labelled, label={text}, no label, hidden',
};

/** Names a GeoGebra line cannot take: the axis and curve variables and the constants (`y = 2x` stays a function). */
const NOT_NAMES = new Set(['x', 'y', 'z', 'r', 't', 'theta', 'pi', 'e', 'i', 'true', 'false', 'E', 'PI']);

/** A name the scene publishes for a tool (P1_x, OR1_n): never a GeoGebra name. */
const DERIVED_RE = /^[A-Z]+[0-9]+_[A-Za-z0-9]+$/;

const NAME = '[A-Za-z][A-Za-z0-9_]*';
const ASSIGN_RE = new RegExp(`^(${NAME})\\s*(?::=|=(?!=))\\s*([\\s\\S]*)$`);

/** A GeoGebra line read: its name (null: a bare command), the text after `=` and, for Slider(...), its numbers. */
export interface GeoGebraRead {
    name: string | null;
    /** Column of the name (0-based, in the body). */
    nameAt: number;
    command: string;
    commandAt: number;
    /** Slider(min, max[, step]) and, after it, `, starting at 2` (the value a slider was moved to). */
    slider: { min: string; max: string; step: string | null; start: string | null } | null;
}

/** Where the bracket that opens at `open` closes (-1 when it does not), quotes skipped. */
export function closeOf(s: string, open: number): number {
    let depth = 0;
    let quote = false;
    for (let i = open; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === '"') quote = false;
            continue;
        }
        if (c === '"') quote = true;
        else if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** `s` split at top-level commas (outside brackets and quotes). */
export function topArgs(s: string): string[] {
    const out: string[] = [];
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
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ',' && depth === 0) {
            out.push(s.slice(start, i).trim());
            start = i + 1;
        }
    }
    out.push(s.slice(start).trim());
    return out;
}

/** A comparison or an equation at the top level (outside brackets and quotes): `a = x^2 + y^2 = 3`, `x + y <= 4`. */
function topRelation(s: string): boolean {
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
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (depth === 0 && (c === '=' || c === '<' || c === '>' || c === '≤' || c === '≥' || c === '≠')) return true;
    }
    return false;
}

/** The names a formula reads (outside quotes), but those called like functions (x(A) is a coordinate). */
export function freeNames(s: string): Set<string> {
    const out = new Set<string>();
    const text = s.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const re = /[A-Za-z_][A-Za-z0-9_]*/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
        const before = m.index > 0 ? text[m.index - 1] : '';
        if (/[0-9.]/.test(before) && /^[eE][0-9]/.test(m[0])) continue;
        const after = text.slice(m.index + m[0].length);
        if (/^\s*\(/.test(after)) continue;
        out.add(m[0]);
    }
    return out;
}

/** The whole text is one call `Name(...)`: its name, else null. */
export function wholeCall(s: string): string | null {
    const m = /^([A-Za-z][A-Za-z0-9_]*)\s*\(/.exec(s);
    if (!m) return null;
    const close = closeOf(s, m[0].length - 1);
    return close === s.length - 1 ? m[1] : null;
}

/**
 * The formula after `=` is GeoGebra's: it calls a command, holds a list
 * in braces, is a point or vector, or is a value or a function of x alone
 * (no comparison at the top, not a formula in x and y).
 */
export function isGeoGebraValue(rhs: string): boolean {
    const t = rhs.trim();
    if (!t || topRelation(t) || /[\\$|]/.test(t.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) return false;
    if (callsGeoGebra(t) || t.includes('{')) return true;
    const names = freeNames(t);
    return !(names.has('x') && names.has('y'));
}

/**
 * A GeoGebra input line, or null for any other line. `chartName` says
 * whether a name belongs to the chart already (then `name = ...` is the
 * curve it always was).
 */
export function readGeoGebraLine(body: string, chartName: (name: string) => boolean): GeoGebraRead | null {
    const t = body.trim();
    const lead = body.length - body.trimStart().length;
    const assign = ASSIGN_RE.exec(t);
    if (assign) {
        const name = assign[1];
        if (NOT_NAMES.has(name) || DERIVED_RE.test(name) || chartName(name)) return null;
        const command = assign[2].trim();
        // A slider moved off its low end: `a = Slider(0, 5), starting at 2`.
        const moved = /^(Slider\s*\([\s\S]*\))\s*,\s*starting\s+at\s+(\S+)$/.exec(command);
        if (moved && wholeCall(moved[1]) === 'Slider') {
            const slider = sliderOf(moved[1]);
            return slider ? { name, nameAt: lead, command: moved[1], commandAt: lead + t.length - assign[2].trimStart().length, slider: { ...slider, start: moved[2] } } : null;
        }
        if (!isGeoGebraValue(command)) return null;
        const commandAt = lead + t.length - assign[2].trimStart().length;
        return { name, nameAt: lead, command, commandAt, slider: sliderOf(command) };
    }
    // A bare command spells GeoGebra's name exactly (Line(A, B), not the words' `line from ...`).
    const call = wholeCall(t);
    if (call && isGeoGebraCommand(call) && call !== 'Slider') return { name: null, nameAt: lead, command: t, commandAt: lead, slider: null };
    return null;
}

/** Slider(min, max[, step, ...]) with its numbers as written; null for anything else. */
function sliderOf(command: string): GeoGebraRead['slider'] {
    if (wholeCall(command) !== 'Slider') return null;
    const inner = command.slice(command.indexOf('(') + 1, -1);
    const args = topArgs(inner);
    return { min: args[0] ?? '', max: args[1] ?? '', step: args[2] ?? null, start: null };
}

/** The names-first pass: the name a line gives itself the GeoGebra way (`A = ...`), else null. */
export function geogebraName(line: string): string | null {
    const m = ASSIGN_RE.exec(line.trim());
    if (!m || NOT_NAMES.has(m[1]) || DERIVED_RE.test(m[1])) return null;
    return isGeoGebraValue(m[2]) ? m[1] : null;
}

// ----------------------------------------------------------------- options

/** An option of this part in the words: `no label` (the others are the words' own). */
export function isGeoGebraOption(o: string): boolean {
    return /^no\s+label$/i.test(o.trim());
}

/** Apply an option of a GeoGebra line; true when it was one. `problem` takes an option that needs a number. */
export function geogebraOption(target: Data, o: string, problem: () => void): boolean {
    const t = o.trim();
    const lower = t.toLowerCase();
    if (lower === 'dashed') return set(target, 'dashed', true);
    if (lower === 'small' || lower === 'large' || lower === 'normal') return set(target, 'size', lower);
    if (lower === 'labelled' || lower === 'labeled') return set(target, 'nameLabel', 'shown');
    if (/^no\s+label$/.test(lower)) return set(target, 'nameLabel', 'hidden');
    const m = /^opacity\s+(.+)$/i.exec(t);
    if (m) {
        const v = Number(m[1]);
        if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(m[1].trim()) || !(v >= 0 && v <= 1)) problem();
        else target.fillOpacity = v;
        return true;
    }
    return false;
}

function set(target: Data, key: string, value: unknown): true {
    target[key] = value;
    return true;
}

// ------------------------------------------------------------------- print

/** What print.ts's Options does for a line. */
export interface LineOptions {
    take(key: string, word: (v: unknown) => string | null): void;
    mark(...keys: string[]): void;
    colour(): void;
}

const strOf = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The line of a GeoGebra tool without its options, as written; null when it cannot be one line. */
export function geogebraHead(full: Data, o: LineOptions): string | null {
    const command = strOf(full.command).trim();
    if (!command || /[\r\n]/.test(command)) return null;
    o.mark('command', 'named');
    if (full.named !== true) return wholeCall(command) && isGeoGebraCommand(wholeCall(command) ?? '') ? command : null;
    return `${strOf(full.name)} = ${command}`;
}

/** The options of a GeoGebra tool in words. */
export function geogebraOptions(o: LineOptions): void {
    o.colour();
    o.take('thickness', (v) => (v === 'thin' || v === 'thick' || v === 'very thin' || v === 'very thick' ? v : null));
    o.take('dashed', (v) => (v === true ? 'dashed' : null));
    o.take('size', (v) => (v === 'small' || v === 'large' || v === 'normal' ? v : null));
    o.take('fillOpacity', (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? `opacity ${v}` : null));
    o.take('nameLabel', (v) => (v === 'shown' ? 'labelled' : v === 'hidden' ? 'no label' : null));
    o.take('label', (v) => (typeof v === 'string' ? `labelled ${JSON.stringify(v)}` : null));
}

/** The words line of a GeoGebra line (as written) in Full LaTeX: \geogebra[options]{line}; undefined for any other line. */
export function geogebraFull(own: string, rest: string, options: string[], optionFull: (o: string) => string): string | null | undefined {
    const t = rest.trim();
    const assign = ASSIGN_RE.exec(t);
    const call = wholeCall(t);
    const isLine = (assign && !NOT_NAMES.has(assign[1]) && !DERIVED_RE.test(assign[1]) && isGeoGebraValue(assign[2])) || (call && isGeoGebraCommand(call));
    if (!isLine) return undefined;
    if (/[{}]/.test(t) && !balanced(t)) return null;
    const opts = [own, ...options.map(optionFull)].filter((x) => x);
    return `\\geogebra${opts.length ? `[${opts.join(', ')}]` : ''}{${t}}`;
}

/** Braces that close in order (the argument of \geogebra{...} must). */
function balanced(s: string): boolean {
    let depth = 0;
    for (const c of s) {
        if (c === '{') depth++;
        else if (c === '}' && --depth < 0) return false;
    }
    return depth === 0;
}
