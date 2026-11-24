/*
 * The lines of part E (6.0) in words, both ways: what parse.ts and
 * print.ts call for them. Pure: no DOM, no Obsidian.
 *
 *   draw the orbit of $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = P$, 40 steps, as a path, labelled
 *   draw the orbit of $p_{n+1} = p_n - \eta \nabla f(p_n)$, $p_0 = P$, 25 steps
 *   draw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps
 *   draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4
 *   draw Newton's method for f from 2.5, 5 steps, labelled
 *   colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = 0$, $c = x + iy$, 200 steps
 *   colour the plane by $f(z) = \frac{z^2 - 1}{z^2 + 1}$
 *   colour the plane by $f(x, y) = \sin x \cos y$, in viridis, opacity 0.8
 *   draw the circles of $\sum_{k=1}^{n} \frac{4}{\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave
 *
 * After the formula, the pieces between commas are the start (`z_0 = 0`),
 * the names the recurrence reads (`c = P`), the steps (`40 steps`) and
 * options. Full LaTeX: src/text/full.ts (6.0 E block).
 */
import type { MessageKey } from '../i18n';
import { looksLikeLatex, splitLetterRuns } from '../latex';
import { readRecurrence } from '../values';
import { givenParts, givenText, isPlaneColormap } from './tools';
import { planeKind } from './forms';

type Data = Record<string, unknown>;

/** A piece of a line and its column (0-based), as the parser keeps them. */
export interface Piece {
    text: string;
    at: number;
}

/** The kinds of this part, as option messages name them. */
export const ITERATE_KINDS = new Set(['orbit', 'cobweb', 'bifurcation', 'newton', 'colourPlane', 'fourierCircles']);

/** What each kind takes as options, for "unknown option" messages (chart words: they stay English). */
export const ITERATE_OPTION_HELP: Record<string, string> = {
    orbit: 'z_0 = a start, c = a value, 40 steps, in a colour, thin, thick, small, large, as a path, labelled, hidden',
    cobweb: 'from x_0, 40 steps, in a colour, thin, thick, hidden',
    bifurcation: 'for r from a to b, x_0 = a start, in a colour, hidden',
    newton: 'from x_0, 5 steps, in a colour, thin, thick, labelled, hidden',
    colourPlane: 'z_0 = a start, c = a value, 200 steps, in a colour map (viridis, heat, cool, diverging, rainbow, greyscale, cyclic), opacity 0.5, hidden',
    fourierCircles: 'with its wave, in a colour, thin, thick, hidden',
};

export const ITERATE_KIND_WORDS: Record<string, MessageKey> = {
    orbit: 'iterate.text.kindOrbit',
    cobweb: 'iterate.text.kindCobweb',
    bifurcation: 'iterate.text.kindBifurcation',
    newton: 'iterate.text.kindNewton',
    colourPlane: 'iterate.text.kindPlane',
    fourierCircles: 'iterate.text.kindCircles',
};

/** The fields of each kind: `steps = 40` with such a name is a field, not a name the recurrence reads. */
const FIELDS = new Set(['type', 'name', 'id', 'color', 'hidden', 'step', 'recurrence', 'start', 'given', 'steps', 'path', 'size', 'thickness', 'valueLabel', 'parameter', 'from', 'to', 'function', 'formula', 'colormap', 'opacity', 'sum', 'wave']);

// --------------------------------------------------------------- pieces

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

/** `steps`, `40 steps`, `n steps`: the count; null for anything else. */
function stepsPiece(o: string): string | null {
    const m = /^(\S+)\s+steps?$/i.exec(o.trim()) ?? /^steps?\s+(\S+)$/i.exec(o.trim());
    return m ? m[1] : null;
}

/** `name = value` (a start or a name a recurrence reads), with the name as written: z_{0} is z_0. */
function binding(o: string): { name: string; value: string } | null {
    const m = /^\s*\\?([A-Za-z][A-Za-z0-9]*(?:_\{?[A-Za-z0-9]+\}?)?)\s*=(?!=)\s*([\s\S]+?)\s*$/.exec(o);
    if (!m) return null;
    return { name: m[1].replace(/_\{([A-Za-z0-9]+)\}/, '_$1'), value: m[2] };
}

/** An option of this part in the words (already in its short form: no leading with/the/its). */
export function isIterateOption(o: string): boolean {
    const t = o.trim().toLowerCase();
    // `40 steps` is part of the statement: a line ends with it before its options.
    return t === 'as a path' || t === 'path' || t === 'wave' || t === 'in cyclic' || t === 'cyclic';
}

/** Apply an option of this part to `target` of `kind`; true when it was one. */
export function iterateOption(kind: string, target: Data, o: string, problem: (key: 'number') => void): boolean {
    const t = o.trim();
    const lower = t.toLowerCase();
    const steps = stepsPiece(t);
    if (steps !== null && (kind === 'orbit' || kind === 'cobweb' || kind === 'newton' || kind === 'colourPlane')) return set(target, 'steps', steps);
    if (kind === 'orbit') {
        if (lower === 'as a path' || lower === 'path') return set(target, 'path', true);
        if (lower === 'labelled' || lower === 'labeled') return set(target, 'valueLabel', true);
        if (lower === 'small' || lower === 'large' || lower === 'normal') return set(target, 'size', lower);
        return false;
    }
    if (kind === 'newton') {
        if (lower === 'labelled' || lower === 'labeled') return set(target, 'valueLabel', true);
        const from = /^from\s+(.+)$/i.exec(t);
        if (from) return set(target, 'start', from[1].trim());
        return false;
    }
    if (kind === 'cobweb') {
        const from = /^from\s+(.+)$/i.exec(t);
        if (from) return set(target, 'start', from[1].trim());
        return false;
    }
    if (kind === 'colourPlane') {
        if (lower === 'in cyclic' || lower === 'cyclic') return set(target, 'colormap', 'cyclic');
        const m = /^opacity\s+(.+)$/i.exec(t);
        if (m) {
            const n = Number(m[1].trim());
            if (!Number.isFinite(n) || n < 0 || n > 1) problem('number');
            else target.opacity = n;
            return true;
        }
        return false;
    }
    if (kind === 'fourierCircles') {
        if (lower === 'wave' || lower === 'its wave' || lower === 'the wave') return set(target, 'wave', true);
        return false;
    }
    return false;
}

function set(target: Data, key: string, value: unknown): true {
    target[key] = value;
    return true;
}

// ------------------------------------------------------------- the lines

/** What a line of this part makes: its tool's type and fields, and the pieces that are options. */
export interface IterateRead {
    type: 'orbit' | 'cobweb' | 'bifurcation' | 'newton' | 'colourPlane' | 'fourierCircles';
    fields: Data;
    /** Pieces after commas that are not part of the statement: options. */
    extra: Piece[];
    /** The line is one of these, but not written so: the message to show (nothing is added). */
    problem?: { at: number; key: MessageKey };
}

/**
 * The start, names, steps and `from` among the pieces after the formula;
 * the rest are options. `state` names the start (z of z_0); `reads` tells
 * a name the formula reads.
 */
function sortPieces(pieces: Piece[], state: string | null, reads: (name: string) => boolean, fields: Data, takeFrom: boolean): Piece[] {
    const options: Piece[] = [];
    const given: Array<{ name: string; value: string }> = [];
    for (const p of pieces) {
        const steps = stepsPiece(p.text);
        if (steps !== null) {
            fields.steps = steps;
            continue;
        }
        const from = takeFrom ? /^from\s+(.+)$/i.exec(p.text) : null;
        if (from && !/^from\s+[xyt]\s*=/i.test(p.text)) {
            fields.start = from[1].trim();
            continue;
        }
        const b = binding(p.text);
        if (b && state && (b.name === `${state}_0` || b.name === `${state}0`)) {
            fields.start = b.value;
            continue;
        }
        if (b && !FIELDS.has(b.name) && (reads(b.name) || /^[A-Za-z]$/.test(b.name))) {
            given.push(b);
            continue;
        }
        options.push(p);
    }
    if (given.length) fields.given = givenText(given);
    return options;
}

/** Does `formula` read the name (alone, not part of a longer name)? */
function readsName(formula: string, name: string): boolean {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![A-Za-z0-9_])\\\\?${esc}(?![A-Za-z0-9_])`).test(formula);
}

/** `draw ...` (after the verb): a line of this part; null for any other line. */
export function readIterateDraw(rest: Piece, options: Piece[]): IterateRead | null {
    const pieces = splitAt(rest.text, ',', rest.at);
    const head = pieces[0];
    const after = [...pieces.slice(1).filter((p) => p.text), ...options];
    let m = /^(?:the\s+|an?\s+)?orbits?\s+of\s+/i.exec(head.text);
    if (m) {
        const formula = head.text.slice(m[0].length).trim();
        const rec = readRecurrence(formula);
        if (!rec) return { type: 'orbit', fields: {}, extra: [], problem: { at: head.at, key: 'iterate.text.orbitTakes' } };
        const fields: Data = { recurrence: formula };
        const extra = sortPieces(after, rec.state, (n) => readsName(rec.formula, n), fields, false);
        return { type: 'orbit', fields, extra };
    }
    m = /^(?:the\s+|a\s+)?cobweb(?:\s+(?:plot|diagram))?\s+of\s+/i.exec(head.text);
    if (m) {
        let body = head.text.slice(m[0].length).trim();
        const fields: Data = {};
        const from = splitAt(body, ' from ');
        if (from.length === 2 && from[1].text) {
            body = from[0].text;
            fields.start = from[1].text;
        }
        // A function's name alone: x_{n+1} = f(x_n).
        const formula = /^[A-Za-z][A-Za-z0-9_]*$/.test(body) ? `x_{n+1} = ${body}(x_n)` : body;
        const rec = readRecurrence(formula);
        if (!rec) return { type: 'cobweb', fields: {}, extra: [], problem: { at: head.at, key: 'iterate.text.cobwebTakes' } };
        fields.recurrence = formula;
        const extra = sortPieces(after, rec.state, () => false, fields, true);
        return { type: 'cobweb', fields, extra };
    }
    m = /^(?:the\s+|a\s+)?bifurcation\s+diagram\s+of\s+/i.exec(head.text);
    if (m) {
        const body = head.text.slice(m[0].length).trim();
        const fr = /^([\s\S]+?)\s+for\s+\\?([A-Za-z][A-Za-z0-9_]*)\s+from\s+([\s\S]+?)\s+to\s+([\s\S]+)$/i.exec(body);
        const rec = readRecurrence(fr ? fr[1] : body);
        if (!rec || !fr) return { type: 'bifurcation', fields: {}, extra: [], problem: { at: head.at, key: 'iterate.text.bifurcationTakes' } };
        const fields: Data = { recurrence: fr[1].trim(), parameter: fr[2], from: fr[3].trim(), to: fr[4].trim() };
        const extra = sortPieces(after, rec.state, () => false, fields, false);
        delete fields.given;
        return { type: 'bifurcation', fields, extra };
    }
    m = /^(?:the\s+)?newton(?:'s|’s|s)?\s+method\b\s*(?:(?:for|of|on)\b\s*)?/i.exec(head.text);
    if (m) {
        const body = head.text.slice(m[0].length).trim();
        const fm = /^([A-Za-z][A-Za-z0-9_]*)(?:\s+from\s+([\s\S]+))?$/.exec(body);
        if (!fm) return { type: 'newton', fields: {}, extra: [], problem: { at: head.at, key: 'iterate.text.newtonTakes' } };
        const fields: Data = { function: fm[1] };
        if (fm[2]) fields.start = fm[2].trim();
        const extra = sortPieces(after, 'x', () => false, fields, true);
        delete fields.given;
        return { type: 'newton', fields, extra };
    }
    m = /^(?:the\s+)?(?:turning\s+|fourier\s+)?circles\s+of\s+/i.exec(head.text);
    if (m) {
        let body = head.text.slice(m[0].length).trim();
        const fields: Data = {};
        const wave = /\s+with\s+(?:its|the)\s+wave$/i.exec(body);
        if (wave) {
            body = body.slice(0, wave.index).trim();
            fields.wave = true;
        }
        if (!/^\\sum(?![A-Za-z])|^sum\s*\(/.test(body)) return { type: 'fourierCircles', fields: {}, extra: [], problem: { at: head.at, key: 'iterate.text.circlesTakes' } };
        fields.sum = body;
        return { type: 'fourierCircles', fields, extra: after };
    }
    return null;
}

/** `colour the plane by ...` (after the verb, `colour` or `color`); null for any other line. */
export function readIteratePlane(rest: Piece, options: Piece[]): IterateRead | null {
    const m = /^the\s+plane\s+(?:by|with)\s+/i.exec(rest.text);
    if (!m) return { type: 'colourPlane', fields: {}, extra: [], problem: { at: rest.at, key: 'iterate.text.planeTakes' } };
    const pieces = splitAt(rest.text, ',', rest.at);
    const head = pieces[0];
    const after = [...pieces.slice(1).filter((p) => p.text), ...options];
    const formula = head.text.slice(m[0].length).trim();
    if (!formula) return { type: 'colourPlane', fields: {}, extra: [], problem: { at: rest.at, key: 'iterate.text.planeTakes' } };
    const fields: Data = { formula };
    const rec = readRecurrence(formula);
    const extra = sortPieces(after, rec ? rec.state : null, (n) => !!rec && readsName(rec.formula, n), fields, false);
    return { type: 'colourPlane', fields, extra };
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
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Text a line can hold as one piece: no line break, no top-level comma (or `seps`), no bar outside LaTeX. */
function clean(s: string, seps: string[] = []): boolean {
    if (!s.trim() || /[\r\n]/.test(s) || s.includes('$') || s.includes('"')) return false;
    if (!looksLikeLatex(s) && /(^|[^|])\|(?!\|)/.test(s)) return false;
    return [',', ...seps].every((sep) => splitAt(s, sep).length === 1);
}

/** A formula as a line writes it: in $...$ when that reads back as written. */
function inMath(body: string): string {
    if (looksLikeLatex(body)) return `$${body}$`;
    return splitLetterRuns(body) === body ? `$${body}$` : body;
}

/** The start and the names a line writes after its formula: `$z_0 = 0$, $c = P$`. */
function bindings(state: string, start: string, given: string, alwaysStart: boolean): string[] | null {
    const out: string[] = [];
    if (start.trim() || alwaysStart) {
        if (!clean(start || '0')) return null;
        out.push(inMath(`${state}_0 = ${start.trim() || '0'}`));
    }
    for (const g of givenParts(given)) {
        if (!clean(g.value)) return null;
        out.push(inMath(`${g.name} = ${g.value}`));
    }
    return out;
}

/** The statement of a tool of this part (null: no line form fits; it is written raw). */
export function iterateHead(full: Data, o: LineOptions): string | null {
    const type = strOf(full.type);
    if (type === 'orbit') {
        const formula = strOf(full.recurrence).trim();
        const rec = readRecurrence(formula);
        if (!rec || !clean(formula) || formula !== strOf(full.recurrence)) return null;
        const b = bindings(rec.state, strOf(full.start), strOf(full.given), true);
        const steps = strOf(full.steps).trim() || '40';
        if (!b || !/^\S+$/.test(steps) || !clean(steps)) return null;
        o.mark('recurrence', 'start', 'given', 'steps');
        return [`draw the orbit of ${inMath(formula)}`, ...b, `${steps} steps`].join(', ');
    }
    if (type === 'cobweb') {
        const formula = strOf(full.recurrence).trim();
        const rec = readRecurrence(formula);
        const start = strOf(full.start).trim() || '0.2';
        const steps = strOf(full.steps).trim() || '40';
        if (!rec || !clean(formula, [' from ']) || formula !== strOf(full.recurrence) || !clean(start) || !/^\S+$/.test(steps) || !clean(steps)) return null;
        o.mark('recurrence', 'start', 'steps');
        return `draw the cobweb of ${inMath(formula)} from ${start}, ${steps} steps`;
    }
    if (type === 'bifurcation') {
        const formula = strOf(full.recurrence).trim();
        const rec = readRecurrence(formula);
        const param = strOf(full.parameter).trim() || 'r';
        const from = strOf(full.from).trim();
        const to = strOf(full.to).trim();
        if (!rec || !clean(formula, [' for ']) || formula !== strOf(full.recurrence) || !NAME_RE.test(param) || !clean(from, [' to ']) || !clean(to)) return null;
        const parts = [`draw the bifurcation diagram of ${inMath(formula)} for ${param} from ${from} to ${to}`];
        o.mark('recurrence', 'parameter', 'from', 'to');
        if (o.has('start')) {
            const b = bindings(rec.state, strOf(full.start), '', true);
            if (b) {
                o.mark('start');
                parts.push(...b);
            }
        }
        return parts.join(', ');
    }
    if (type === 'newton') {
        const f = strOf(full.function).trim();
        const start = strOf(full.start).trim() || '1';
        const steps = strOf(full.steps).trim() || '5';
        if (!NAME_RE.test(f) || !clean(start) || !/^\S+$/.test(steps) || !clean(steps)) return null;
        o.mark('function', 'start', 'steps');
        return `draw Newton's method for ${f} from ${start}, ${steps} steps`;
    }
    if (type === 'colourPlane') {
        const formula = strOf(full.formula).trim();
        if (!clean(formula) || formula !== strOf(full.formula)) return null;
        const parts = [`colour the plane by ${inMath(formula)}`];
        const rec = readRecurrence(formula);
        o.mark('formula');
        if (rec) {
            const b = bindings(rec.state, strOf(full.start), strOf(full.given), false);
            const steps = strOf(full.steps).trim() || '200';
            if (!b || !/^\S+$/.test(steps) || !clean(steps)) return null;
            o.mark('start', 'given', 'steps');
            parts.push(...b, `${steps} steps`);
        } else if (planeKind(formula) === 'escape') return null;
        return parts.join(', ');
    }
    if (type === 'fourierCircles') {
        const sum = strOf(full.sum).trim();
        if (!clean(sum, [' with ']) || sum !== strOf(full.sum)) return null;
        o.mark('sum');
        return `draw the circles of ${inMath(sum)}`;
    }
    return null;
}

/** The options of a tool of this part, in words where they have some. */
export function iterateOptions(type: string, o: LineOptions): void {
    const thickness = (v: unknown) => (typeof v === 'string' && ['very thin', 'thin', 'thick', 'very thick'].includes(v) ? v : null);
    if (type !== 'colourPlane') o.colour();
    if (type === 'orbit') {
        o.take('thickness', thickness);
        o.take('size', (v) => (v === 'small' || v === 'large' || v === 'normal' ? v : null));
        o.take('path', (v) => (v === true ? 'as a path' : null));
        o.take('valueLabel', (v) => (v === true ? 'labelled' : null));
    } else if (type === 'cobweb' || type === 'newton' || type === 'fourierCircles') {
        o.take('thickness', thickness);
        if (type === 'newton') o.take('valueLabel', (v) => (v === true ? 'labelled' : null));
        if (type === 'fourierCircles') o.take('wave', (v) => (v === true ? 'with its wave' : null));
    } else if (type === 'colourPlane') {
        o.take('colormap', (v) => (isPlaneColormap(v) ? `in ${v}` : null));
        o.take('opacity', (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? `opacity ${v}` : null));
        // A plane has no line colour: the bifurcation's colour is its dots'.
        o.colour();
    }
}
