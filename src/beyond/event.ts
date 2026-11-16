/*
 * The event of a shaded probability, P(-1 <= X <= 1) (5.0): its sides and
 * relations, which side is the random variable, the bounds they give, and
 * how its label prints it. Plain (`<=`, `>=`) and LaTeX (`\le`, `\leq`,
 * `\geqslant`) relations read alike, and so do `≤` and `≥`. Pure: no DOM,
 * no Obsidian.
 */
import { decimal } from './maths';

export type Relation = '<=' | '<' | '>=' | '>' | '=';

export interface EventParts {
    /** The sides, trimmed, as written. */
    parts: string[];
    /** The relations between them. */
    ops: Relation[];
}

/** The event with its relations in the plain syntax (`\le` is `<=`, `≥` is `>=`, `==` is `=`). */
function plainRelations(event: string): string {
    return event
        .replace(/\\(?:leqslant|leq|le)(?![A-Za-z])/g, '<=')
        .replace(/\\(?:geqslant|geq|ge)(?![A-Za-z])/g, '>=')
        .replace(/\\lt(?![A-Za-z])/g, '<')
        .replace(/\\gt(?![A-Za-z])/g, '>')
        .replace(/≤|⩽/g, '<=')
        .replace(/≥|⩾/g, '>=')
        .replace(/==/g, '=');
}

/** The sides of an event and the relations between them, split outside brackets; null without a relation. */
export function splitEvent(event: string): EventParts | null {
    const s = plainRelations(event);
    const parts: string[] = [];
    const ops: Relation[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
        else if (depth === 0 && (c === '<' || c === '>' || c === '=')) {
            const two = (c === '<' || c === '>') && s[i + 1] === '=';
            parts.push(s.slice(start, i).trim());
            ops.push(two ? `${c}=` : c);
            if (two) i++;
            start = i + 1;
        }
    }
    parts.push(s.slice(start).trim());
    if (!ops.length || parts.some((p) => !p)) return null;
    return { parts, ops };
}

/** A read event: its sides, relations and which side is the random variable. */
export interface Event extends EventParts {
    variable: number;
}

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * The event read: `a <= X <= b` (the middle is the variable, both relations
 * one way), or two sides of which one is the variable (a name `isVariable`
 * accepts: the distribution's own name, or a name nothing else in the chart
 * has; the left one when both are). Null when it is none of these.
 */
export function readEvent(event: string, isVariable: (name: string) => boolean): Event | null {
    const split = splitEvent(event);
    if (!split) return null;
    const { parts, ops } = split;
    if (parts.length === 3) {
        const up = ops.every((o) => o === '<' || o === '<=');
        const down = ops.every((o) => o === '>' || o === '>=');
        return (up || down) && NAME.test(parts[1]) ? { parts, ops, variable: 1 } : null;
    }
    if (parts.length !== 2) return null;
    for (const k of [0, 1]) if (NAME.test(parts[k]) && isVariable(parts[k])) return { parts, ops, variable: k };
    return null;
}

/** The interval an event asks for: lo..hi (infinite when open), each end strict or not, or one value. */
export interface Bounds {
    lo: number;
    hi: number;
    loStrict: boolean;
    hiStrict: boolean;
    /** P(X = k). */
    equal?: number;
}

/** The bounds of a read event, with the values of its other sides (`values[k]` for side k). */
export function eventBounds(e: Event, values: number[]): Bounds {
    const out: Bounds = { lo: -Infinity, hi: Infinity, loStrict: false, hiStrict: false };
    if (e.parts.length === 3) {
        const up = e.ops[0] === '<' || e.ops[0] === '<=';
        const [a, b] = up ? [0, 2] : [2, 0];
        const [opA, opB] = up ? [e.ops[0], e.ops[1]] : [e.ops[1], e.ops[0]];
        out.lo = values[a];
        out.hi = values[b];
        out.loStrict = opA === '<' || opA === '>';
        out.hiStrict = opB === '<' || opB === '>';
        return out;
    }
    const other = e.variable === 0 ? 1 : 0;
    const v = values[other];
    // Read as X op v: with the variable on the right, the relation turns round.
    const op = e.variable === 0 ? e.ops[0] : ({ '<=': '>=', '<': '>', '>=': '<=', '>': '<', '=': '=' } as const)[e.ops[0]];
    if (op === '=') {
        out.equal = v;
        out.lo = out.hi = v;
    } else if (op === '<=' || op === '<') {
        out.hi = v;
        out.hiStrict = op === '<';
    } else {
        out.lo = v;
        out.loStrict = op === '>';
    }
    return out;
}

const TEX_RELATION: Record<Relation, string> = { '<=': '\\le', '<': '<', '>=': '\\ge', '>': '>', '=': '=' };

/** The label of a shaded probability: `$P(-1 \le X \le 1) = 0.683$`, the bounds as numbers. */
export function eventLabel(e: Event, values: number[], probability: string): string {
    const sides = e.parts.map((part, k) => (k === e.variable ? part : decimal(values[k], 3)));
    let inner = sides[0];
    e.ops.forEach((op, k) => {
        inner += ` ${TEX_RELATION[op]} ${sides[k + 1]}`;
    });
    return `$P(${inner}) = ${probability}$`;
}

/** The names in an event (not LaTeX commands): a distribution named in it is the one it is about. */
export function eventNames(event: string): string[] {
    const out: string[] = [];
    const re = /\\?[A-Za-z][A-Za-z0-9_]*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(event))) if (!m[0].startsWith('\\')) out.push(m[0]);
    return out;
}
