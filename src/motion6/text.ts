/*
 * The motion lines (6.0) in words, both ways: what parse.ts and print.ts
 * call for them. Pure: no DOM, no Obsidian.
 *
 *   then plot g(x) = x^2                     the next step (also a bare `then`)
 *   frames                                   the export shows every step side by side
 *   draw the vector field $F(x, y) = (y, -\sin x - 0.25y)$, coloured by length, with moving particles and streamlines
 *   mark the rest points of F, labelled
 *   draw the solution of $\dot{p} = (y, -x)$ through P for t from 0 to 10, coloured by time
 *
 * Full LaTeX carries them as \then \plot{...}, \axis[frames],
 * \draw[...]{the vector field ...} and \mark[...]{the rest points of F}.
 */
import type { MessageKey } from '../i18n';
import { isColormap } from '../colormaps';
import { looksLikeLatex, splitLetterRuns } from '../latex';
import { rightSide, tupleParts } from './maths';

type Data = Record<string, unknown>;

/** A piece of a line and its column (0-based), as the parser keeps them. */
export interface Piece {
    text: string;
    at: number;
}

/** The kinds of the motion tools, as option messages name them. */
export const MOTION_KINDS = new Set(['vectorField', 'restPoints', 'trajectory']);

/** What each motion kind takes as options, for "unknown option" messages (chart words: they stay English). */
export const MOTION_OPTION_HELP: Record<string, string> = {
    vectorField: 'in a colour, thin, thick, coloured by length (in a colour map), with moving particles, with streamlines, density=30, hidden',
    restPoints: 'in a colour, small, large, labelled, hidden',
    trajectory: 'in a colour, thin, thick, dashed, for t from a to b, coloured by time (in a colour map), hidden',
};

export const MOTION_KIND_WORDS: Record<string, MessageKey> = {
    vectorField: 'motion6.text.kindVectorField',
    restPoints: 'motion6.text.kindRestPoints',
    trajectory: 'motion6.text.kindTrajectory',
};

const NAME = '[A-Za-z][A-Za-z0-9_]*';
const NAME_RE = new RegExp(`^${NAME}$`);

// ------------------------------------------------------------------ then

/** A line that starts with `then` (not a formula such as `then + x = 3`): the column after it, else -1. */
export function thenPrefix(line: string): number {
    const m = /^(\s*)then(?![A-Za-z0-9_(])\s*/i.exec(line);
    if (!m) return -1;
    const rest = line.slice(m[0].length);
    if (/^(?:[*/^=<>!]|[-+]\s)/.test(rest)) return -1;
    return m[0].length;
}

/** A changed line keeps the `then ` (or `\then `) its old line started with. */
export function keepThen(source: string, printed: string): string {
    const old = /^\s*(\\then\b\s*|then\s+)/i.exec(source);
    if (!old || /^\s*(\\then\b|then\b)/i.test(printed)) return printed;
    const lead = /^\s*/.exec(printed)?.[0] ?? '';
    return `${lead}${old[1].startsWith('\\') ? '\\then ' : 'then '}${printed.slice(lead.length)}`;
}

// --------------------------------------------------------------- options

/** `coloured by length`, `colored by time in heat`: which, and the map (viridis when none is named). */
function colouredBy(o: string): { by: 'length' | 'time'; map: string } | null {
    const m = /^colou?red\s+by\s+(length|size|time)(?:\s+in\s+([a-z]+))?$/i.exec(o.trim());
    if (!m) return null;
    const map = (m[2] ?? 'viridis').toLowerCase();
    if (!isColormap(map)) return null;
    return { by: m[1].toLowerCase() === 'time' ? 'time' : 'length', map };
}

/** An option in the words of the motion lines (already in its short form: no leading with/the). */
export function isMotionOption(o: string): boolean {
    const t = o.trim().toLowerCase();
    return t === 'moving particles' || t === 'particles' || t === 'streamlines' || colouredBy(t) !== null;
}

/** Apply a motion option to `target` of `kind`; true when it was one. */
export function motionOption(kind: string, target: Data, o: string, problem: (key: 'range') => void): boolean {
    const t = o.trim();
    const lower = t.toLowerCase();
    if (kind === 'vectorField') {
        if (lower === 'moving particles' || lower === 'particles') return set(target, 'particles', true);
        if (lower === 'streamlines') return set(target, 'streamlines', true);
        const c = colouredBy(t);
        if (c && c.by === 'length') {
            // `in heat` before it already chose the map.
            if (!/\sin\s/i.test(t) && isColormap(target.colormap)) return true;
            return set(target, 'colormap', c.map);
        }
        return false;
    }
    if (kind === 'restPoints') {
        if (lower === 'small' || lower === 'large' || lower === 'normal') return set(target, 'size', lower);
        if (lower === 'labelled' || lower === 'labeled') return set(target, 'valueLabel', true);
        return false;
    }
    if (kind === 'trajectory') {
        if (lower === 'dashed') return set(target, 'dashed', true);
        const c = colouredBy(t);
        if (c && c.by === 'time') {
            if (!/\sin\s/i.test(t) && isColormap(target.colormap)) return true;
            return set(target, 'colormap', c.map);
        }
        const m = /^(?:for\s+t\s+from|from\s+t\s*=)\s*(.+)$/i.exec(t);
        if (m) {
            const r = range(m[1]);
            if (!r) problem('range');
            else {
                target.from = r[0];
                target.to = r[1];
            }
            return true;
        }
        return false;
    }
    return false;
}

function set(target: Data, key: string, value: unknown): true {
    target[key] = value;
    return true;
}

/** `a to b` or `a..b` as two formulas. */
function range(s: string): [string, string] | null {
    for (const sep of [' to ', '..']) {
        const parts = splitAt(s, sep);
        if (parts.length === 2 && parts[0].text && parts[1].text) return [parts[0].text, parts[1].text];
    }
    return null;
}

/** `s` split at `sep` outside brackets, each piece trimmed with its column. */
function splitAt(s: string, sep: string, at = 0): Piece[] {
    const out: Piece[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') {
            i++;
            continue;
        }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
        else if (depth === 0 && s.startsWith(sep, i)) {
            out.push(trim(s.slice(start, i), at + start));
            start = i + sep.length;
            i += sep.length - 1;
        }
    }
    out.push(trim(s.slice(start), at + start));
    return out;
}

function trim(text: string, at: number): Piece {
    const lead = text.length - text.trimStart().length;
    return { text: text.trim(), at: at + lead };
}

// ------------------------------------------------------------- the lines

/** What a motion line makes: its tool's type and fields, and the name it gives itself (F of F(x, y) = ...). */
export interface MotionRead {
    type: 'vectorField' | 'restPoints' | 'trajectory';
    fields: Data;
    own?: Piece;
    /** Pieces after commas that are not part of the statement: options. */
    extra: Piece[];
    /** The line is one of these, but not written so: the message to show (nothing is added). */
    problem?: { at: number; key: MessageKey };
    /** The rest points name no field: the nearest vector field is theirs. */
    nearest?: boolean;
}

/** The statement and the pieces after its top-level commas. */
function statementOf(rest: Piece): { head: Piece; extra: Piece[] } {
    const pieces = splitAt(rest.text, ',', rest.at);
    return { head: pieces[0], extra: pieces.slice(1).filter((p) => p.text) };
}

/** The names the line gives itself, for the parser's first pass: `draw the vector field $F(x, y) = ...$` names F. */
export function ownName(body: string): string | null {
    const m = new RegExp(`^vector\\s+fields?\\s+(?:of\\s+)?\\$?\\s*(${NAME})\\s*\\(\\s*[A-Za-z]+\\s*,`, 'i').exec(body.trim());
    return m ? m[1] : null;
}

/** `draw ...` (after the verb): a vector field or the solution of a system; null for any other line. */
export function readMotionDraw(rest: Piece, is3D: boolean): MotionRead | null {
    const field = /^(?:the\s+|a\s+)?vector\s+field\b\s*(?:of\s+)?/i.exec(rest.text);
    if (field) {
        const { head, extra } = statementOf(rest);
        const def = trim(head.text.slice(field[0].length), head.at + field[0].length);
        const named = new RegExp(`^(${NAME})\\s*\\(\\s*([A-Za-z]+)\\s*,\\s*([A-Za-z]+)\\s*\\)\\s*=(?!=)\\s*`).exec(def.text);
        const expr = trim(def.text.slice(named ? named[0].length : 0), def.at + (named ? named[0].length : 0));
        const parts = tupleParts(expr.text);
        if (!parts || parts.length !== 2) return { type: 'vectorField', fields: {}, extra, problem: { at: rest.at, key: 'motion6.text.vectorFieldTakes' } };
        const out: MotionRead = { type: 'vectorField', fields: { expression: expr.text }, extra };
        if (named) out.own = { text: named[1], at: def.at };
        return out;
    }
    const sol = /^the\s+solutions?\s+of\s+/i.exec(rest.text);
    if (!sol) return null;
    const { head, extra } = statementOf(rest);
    const body = head.text.slice(sol[0].length);
    const through = splitAt(body, ' through ', head.at + sol[0].length);
    if (through.length !== 2) {
        // `the solution of SF2 through P` (a slope field, 5.0) is not this line.
        return null;
    }
    const system = through[0];
    // A name (a slope field) belongs to the 5.0 line.
    if (NAME_RE.test(system.text)) return null;
    const parts = tupleParts(system.text);
    const dim = is3D ? 3 : 2;
    if (!parts || parts.length !== dim) return { type: 'trajectory', fields: {}, extra, problem: { at: system.at, key: 'motion6.text.trajectoryTakes' } };
    const points = splitAt(through[1].text, ',', through[1].at)
        .flatMap((p) => splitAt(p.text, ' and ', p.at))
        .filter((p) => p.text);
    if (!points.length || !points.every((p) => /^\(.*\)$/.test(p.text) || NAME_RE.test(p.text))) {
        return { type: 'trajectory', fields: {}, extra, problem: { at: through[1].at, key: 'motion6.text.trajectoryTakes' } };
    }
    return {
        type: 'trajectory',
        fields: { expression: rightSide(system.text), through: points.map((p) => p.text).join('; '), dim },
        extra,
    };
}

/** `mark ...` (after the verb): the rest points of a field; null for any other line. */
export function readMotionMark(rest: Piece): MotionRead | null {
    const m = /^(?:the\s+)?(?:rest|equilibrium|fixed|stationary)\s+points?\b\s*/i.exec(rest.text);
    if (!m) return null;
    const { head, extra } = statementOf(rest);
    const after = head.text.slice(m[0].length).trim();
    if (!after) return { type: 'restPoints', fields: {}, extra, nearest: true };
    const of = new RegExp(`^of\\s+(${NAME})$`, 'i').exec(after);
    if (!of) return { type: 'restPoints', fields: {}, extra, problem: { at: rest.at, key: 'motion6.text.restPointsTakes' } };
    return { type: 'restPoints', fields: { field: of[1] }, extra };
}

// ---------------------------------------------------------------- print

/** What print.ts's Options does for a line: the words for some fields, `key=value` for the rest. */
export interface LineOptions {
    has(key: string): boolean;
    take(key: string, word: (v: unknown) => string | null): void;
    mark(...keys: string[]): void;
    colour(): void;
    out: string[];
}

const strOf = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

/** Text a line can hold as one piece: no line break, no top-level comma or ` through `, no bar outside LaTeX. */
function clean(s: string, seps: string[]): boolean {
    if (!s.trim() || /[\r\n]/.test(s)) return false;
    if (!looksLikeLatex(s) && /(^|[^|])\|(?!\|)/.test(s)) return false;
    return seps.every((sep) => splitAt(s, sep).length === 1);
}

/** A formula with its left side, in $...$ when that reads back as written. */
function inMath(body: string, keep: ReadonlySet<string>): string {
    if (looksLikeLatex(body)) return `$${body}$`;
    return splitLetterRuns(body, keep) === body ? `$${body}$` : body;
}

/** The tool types whose line holds their name (a vector field's F): no `name: ` before it. */
export const OWN_NAME_TYPES: ReadonlySet<string> = new Set(['vectorField']);

/** The statement of a motion tool (null: no line form fits; it is written raw). `shown`: its name must be written. */
export function motionHead(full: Data, o: LineOptions, ctx: { is3D: boolean; shown: boolean }): string | null {
    const type = strOf(full.type);
    const name = strOf(full.name);
    if (type === 'vectorField') {
        const expr = strOf(full.expression).trim();
        const parts = tupleParts(expr);
        if (!parts || parts.length !== 2 || !clean(expr, [',', ' and ']) || expr !== expr.trim()) return null;
        if (!/^\(/.test(expr) && !/^\\left/.test(expr)) return null;
        o.mark('expression');
        const body = ctx.shown || !/^VF\d+$/.test(name) ? `${name}(x, y) = ${expr}` : expr;
        if (!NAME_RE.test(name)) return null;
        return `draw the vector field ${inMath(body, new Set([name]))}`;
    }
    if (type === 'restPoints') {
        const field = strOf(full.field);
        if (!NAME_RE.test(field)) return null;
        o.mark('field');
        return `mark the rest points of ${field}`;
    }
    if (type === 'trajectory') {
        const expr = strOf(full.expression).trim();
        const dim = full.dim === 3 ? 3 : 2;
        const parts = tupleParts(expr);
        if (!parts || parts.length !== dim || !clean(expr, [',', ' and ', ' through ']) || !/^\(|^\\left/.test(expr)) return null;
        if (dim !== (ctx.is3D ? 3 : 2)) return null;
        const points = strOf(full.through)
            .split(';')
            .map((p) => p.trim());
        if (!points.length || !points.every((p) => (/^\(.*\)$/.test(p) || NAME_RE.test(p)) && clean(p, [',', ' and ', ' to ']))) return null;
        o.mark('expression', 'through', 'dim');
        const system = looksLikeLatex(expr) || splitLetterRuns(expr) === expr ? `$\\dot{p} = ${expr}$` : `p' = ${expr}`;
        const list = points.length < 2 ? points[0] : `${points.slice(0, -1).join(', ')} and ${points[points.length - 1]}`;
        return `draw the solution of ${system} through ${list}`;
    }
    return null;
}

/** The options of a motion tool, in words where they have some. */
export function motionOptions(type: string, o: LineOptions, full: Data): void {
    const thickness = (v: unknown) => (typeof v === 'string' && ['very thin', 'thin', 'thick', 'very thick'].includes(v) ? v : null);
    const mapWord = (by: string) => (v: unknown) => (isColormap(v) ? `coloured by ${by}${v === 'viridis' ? '' : ` in ${v}`}` : null);
    if (type === 'trajectory') {
        const from = strOf(full.from).trim();
        const to = strOf(full.to).trim();
        if (o.has('from') || o.has('to')) {
            if (from && to && clean(from, [',', ' to ', '..', ' and ']) && clean(to, [',', ' to ', '..', ' and '])) {
                o.mark('from', 'to');
                o.out.push(`for t from ${from} to ${to}`);
            }
        } else o.out.push('for t from 0 to 10');
    }
    o.colour();
    if (type === 'vectorField') {
        o.take('thickness', thickness);
        o.take('colormap', mapWord('length'));
        o.take('particles', (v) => (v === true ? 'with moving particles' : null));
        o.take('streamlines', (v) => (v === true ? 'with streamlines' : null));
    } else if (type === 'restPoints') {
        o.take('size', (v) => (v === 'small' || v === 'large' || v === 'normal' ? v : null));
        o.take('valueLabel', (v) => (v === true ? 'labelled' : null));
    } else if (type === 'trajectory') {
        o.take('thickness', thickness);
        o.take('dashed', (v) => (v === true ? 'dashed' : null));
        o.take('colormap', mapWord('time'));
    }
}
