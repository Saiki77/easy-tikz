/*
 * The key of the vote (6.2.4): when do two designs give the same parse? A
 * port of the frozen key.mjs (hover-ml readers). It is a string key of its
 * own, not parseKey of src/readers/build.ts: the vote was set by hand with
 * this one, and it must count the same agreements. Pure.
 */
import type { CardParse } from '../types';

/** Strings of a vector parse that only label the card. */
const LABEL_ONLY = new Set(['tex', 'nameTex', 'names']);

/** A space that stays (after a command, before a letter): a private-use sign while the other spaces go (the frozen key uses U+0001). */
const KEEP = '\uE00F';
const KEEP_RE = new RegExp(KEEP, 'g');

/** A TeX string as the vote compares it: sizes, layout and spaces out, one spelling of \le, \ne, \frac, a script in braces of one sign without them. */
export function voteTexKey(s: string, keepCdot = false): string {
    let t = s
        .replace(/\\(?:left|right|middle|bigl?|bigr?|Bigl?|Bigr?|biggl?|biggr?|Biggl?|Biggr?)(?![A-Za-z])/g, '')
        .replace(/\\(?:displaystyle|textstyle)(?![A-Za-z])/g, '')
        .replace(/\\[dt]frac(?![A-Za-z])/g, '\\frac')
        .replace(/\\(le|ge|ne)q(?![A-Za-z])/g, '\\$1')
        .replace(/\\neq(?![A-Za-z])/g, '\\ne')
        .replace(/\{,\}/g, '.')
        .replace(/\\[,;:! ]|~/g, ' ');
    if (!keepCdot) t = t.replace(/\\cdot(?![A-Za-z])|\*/g, ' ');
    t = t
        .replace(/(\\[A-Za-z]+)\s+(?=[A-Za-z])/g, `$1${KEEP}`)
        .replace(/\s+/g, '')
        .replace(KEEP_RE, ' ');
    return t.replace(/([\^_])\{(\\?[A-Za-z0-9])\}/g, '$1$2');
}

/** The vote's key of a parse: keys sorted, null and undefined left out, every TeX role as voteTexKey writes it. */
export function voteKey(p: CardParse): string {
    const vector = p.kind === 'vector';
    const norm = (v: unknown, key?: string): unknown => {
        if (typeof v === 'string') return key === 'kind' ? v : voteTexKey(v, vector);
        if (Array.isArray(v)) return (v as unknown[]).map((x) => norm(x));
        if (v && typeof v === 'object') {
            const o = v as Record<string, unknown>;
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(o).sort()) {
                if (o[k] === undefined || o[k] === null || (vector && LABEL_ONLY.has(k))) continue;
                out[k] = norm(o[k], k);
            }
            return out;
        }
        return v;
    };
    return JSON.stringify(norm(p));
}
