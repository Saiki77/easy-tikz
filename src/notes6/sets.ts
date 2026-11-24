/*
 * Sets on an axis (6.0 B): where a condition in one variable holds, as
 * pieces of the number line with their ends (in the set or not), and the
 * set in set notation ({x | g(x) ≤ 0} = [-2, 2], unions, ∅, ℝ). The
 * condition is a region condition in one variable (`g(x) <= 0`, `|x| < 1`,
 * `x < -1 or x > 2`, `0 <= x <= 1`), an interval (`x \in [0, 1)`), or an
 * equation (`g(x) = 0`: its zeros). Pure: no DOM, no Obsidian.
 */
import type { MathContext } from '../mathcontext';
import { conditionClauseNodes } from '../mathcontext';
import { decimal } from '../beyond/maths';

/** One piece of a set on the number line; a === b is a single point. */
export interface AxisPiece {
    a: number;
    b: number;
    /** The end belongs to the set (a filled dot), or not (an open one). */
    closedA: boolean;
    closedB: boolean;
    /** The piece goes on past where the set was computed, but not for ever (a periodic set): the label ends it with dots. */
    cutA?: boolean;
    cutB?: boolean;
}

/** A condition in one variable, compiled: OR of ANDs of clauses g(t) <= 0 (or < 0), or the zeros of F(t). */
export interface Condition1 {
    /** Disjuncts of clauses: the clause holds where g(t) <= 0 (strict: < 0). */
    disjuncts: Array<Array<{ g: (t: number) => number; strict: boolean }>>;
    /** An equation: the set is where F(t) = 0. */
    zeros?: (t: number) => number;
}

/** Samples across the range the set is computed on. */
const SAMPLES = 1200;
/** Bisection steps for an end. */
const BISECT = 60;
/** Far points a piece that reaches the end of the range must hold at to go on for ever. */
const FAR = [2, 10, 100, 1e3, 1e4, 1e6];
/** Most pieces the label names (then `\cup \dots`). */
const LABEL_PIECES = 4;

/** A relation sign of an inequality (plain, LaTeX or Unicode). */
const INEQUALITY = /<|>|\\(?:le|ge|leq|geq|lt|gt|leqslant|geqslant)(?![A-Za-z])|≤|≥/;

/** Is the condition an equation (an `=` and no inequality)? */
export function isEquation(cond: string): boolean {
    const plain = cond.replace(/<=|>=|==|!=/g, '');
    return /=/.test(plain) && !INEQUALITY.test(cond);
}

/**
 * Membership in an interval as a chain of inequalities: `x \in [0, 1)` is
 * `0 <= x < 1`, `\lambda \in (a, b]` is `a < lambda <= b`; with `variable`
 * the letter becomes that one (λ ∈ [0, 1] on the x-axis is 0 <= x <= 1).
 * Anything else stays.
 */
export function intervalCondition(cond: string, variable?: string): string {
    const m = /^\s*([A-Za-z\\][A-Za-z0-9_\\]*)\s*(?:\\in|∈)\s*([[(])\s*([^,;]+?)\s*[,;]\s*([^,;]+?)\s*([\])])\s*$/.exec(cond);
    if (!m) return cond;
    const v = variable ?? m[1].replace(/^\\/, '');
    const lo = m[2] === '[' ? '<=' : '<';
    const hi = m[5] === ']' ? '<=' : '<';
    const a = m[3].replace(/^-\s*\\infty$|^-\s*∞$/, '');
    const b = m[4].replace(/^\+?\s*\\infty$|^\+?\s*∞$/, '');
    if (!a && !b) return `${v} = ${v}`;
    if (!a) return `${v} ${hi} ${b}`;
    if (!b) return `${a} ${lo} ${v}`;
    return `${a} ${lo} ${v} ${hi} ${b}`;
}

/**
 * The condition compiled for one axis: on the x-axis y is 0 and x runs, on
 * the y-axis the other way round, so `x^2 + y^2 = 4` on the x-axis is where
 * the circle crosses it. Throws ExprError like the region conditions.
 */
export function compileCondition(math: MathContext, condIn: string, axis: 'x' | 'y'): Condition1 {
    const cond = intervalCondition(condIn, axis);
    const at = (F: (x: number, y: number) => number) => (axis === 'x' ? (t: number) => F(t, 0) : (t: number) => F(0, t));
    if (isEquation(cond)) return { disjuncts: [], zeros: at(math.equation(cond).F) };
    const entry = math.conditions([cond])[0];
    if (!entry) return { disjuncts: [] };
    const ops = conditionClauseNodes(cond);
    return {
        disjuncts: entry.disjuncts.map((clauses, i) =>
            clauses.map((c, j) => {
                const op = ops[i]?.[j]?.op;
                return { g: at(c.g), strict: op === '<' || op === '>' };
            })
        ),
    };
}

/** Does the condition hold at t; `tol` counts values that close to 0 as 0 (at an end). */
function holds(c: Condition1, t: number, tol: number): boolean {
    if (c.zeros) {
        const v = c.zeros(t);
        return Number.isFinite(v) && Math.abs(v) <= tol;
    }
    return c.disjuncts.some((clauses) =>
        clauses.every((cl) => {
            const v = cl.g(t);
            if (!Number.isFinite(v)) return false;
            return cl.strict ? v < -tol : v <= tol;
        })
    );
}

/** The functions whose zeros and gaps can end a piece. */
function edgeFunctions(c: Condition1): Array<(t: number) => number> {
    if (c.zeros) return [c.zeros];
    return c.disjuncts.flat().map((cl) => cl.g);
}

/** Bisect between a and b where `side(t)` changes. */
function bisect(a: number, b: number, side: (t: number) => boolean): number {
    const sa = side(a);
    let lo = a;
    let hi = b;
    for (let k = 0; k < BISECT; k++) {
        const mid = (lo + hi) / 2;
        if (mid === lo || mid === hi) break;
        if (side(mid) === sa) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/** Where |g| has its smallest value between a and b (golden section). */
function touch(g: (t: number) => number, a: number, b: number): number {
    const r = (Math.sqrt(5) - 1) / 2;
    let lo = a;
    let hi = b;
    let c = hi - r * (hi - lo);
    let d = lo + r * (hi - lo);
    for (let k = 0; k < BISECT; k++) {
        if (Math.abs(g(c)) < Math.abs(g(d))) hi = d;
        else lo = c;
        c = hi - r * (hi - lo);
        d = lo + r * (hi - lo);
    }
    return (lo + hi) / 2;
}

/**
 * Round an end to a short decimal when the condition does not tell the
 * difference (a root found as 1.9999999999 is 2): the nearest number with
 * few digits that lies on the same side of every function as the found one.
 */
function tidyEnd(t: number, span: number): number {
    for (let d = 0; d <= 12; d++) {
        const v = Number(t.toFixed(d));
        if (Math.abs(v - t) <= 1e-9 * Math.max(1, span)) return v === 0 ? 0 : v;
    }
    return t;
}

/**
 * The set where the condition holds, on [lo, hi]: its pieces left to
 * right. A piece that reaches an end of the range and holds far beyond it
 * goes on for ever (±Infinity); one that does not is cut there (cutA / cutB).
 */
export function solveSet(c: Condition1, lo: number, hi: number): AxisPiece[] {
    const span = hi - lo;
    if (!(span > 0) || !Number.isFinite(span)) return [];
    const n = SAMPLES;
    const ts: number[] = [];
    for (let i = 0; i <= n; i++) ts.push(lo + (span * i) / n);
    const breaks: number[] = [];
    for (const g of edgeFunctions(c)) {
        const vs = ts.map((t) => g(t));
        let scale = 0;
        for (const v of vs) if (Number.isFinite(v)) scale = Math.max(scale, Math.abs(v));
        const tol = 1e-9 * Math.max(1, scale);
        for (let i = 0; i < n; i++) {
            const a = vs[i];
            const b = vs[i + 1];
            const fa = Number.isFinite(a);
            const fb = Number.isFinite(b);
            if (fa !== fb) breaks.push(bisect(ts[i], ts[i + 1], (t) => Number.isFinite(g(t))));
            else if (fa && fb && a <= 0 !== b <= 0) breaks.push(bisect(ts[i], ts[i + 1], (t) => g(t) <= 0));
            else if (fa && fb && a < 0 !== b < 0) breaks.push(bisect(ts[i], ts[i + 1], (t) => g(t) < 0));
            if (i > 0 && fa && fb && Number.isFinite(vs[i - 1])) {
                // A touch: |g| smallest here, the same sign on both sides, and (nearly) 0.
                const p = vs[i - 1];
                if (Math.abs(a) <= Math.abs(p) && Math.abs(a) <= Math.abs(b) && Math.sign(p) === Math.sign(b) && Math.abs(a) <= 0.05 * Math.max(1e-12, scale)) {
                    const t = touch(g, ts[i - 1], ts[i + 1]);
                    if (Math.abs(g(t)) <= tol) breaks.push(t);
                }
            }
        }
    }
    breaks.sort((p, q) => p - q);
    const ends: number[] = [];
    for (const b of breaks) {
        const t = tidyEnd(b, span);
        if (!(t > lo && t < hi)) continue;
        if (ends.length && Math.abs(t - ends[ends.length - 1]) <= 1e-9 * span) continue;
        ends.push(t);
    }
    const tolAt = (t: number) => {
        let s = 0;
        for (const g of edgeFunctions(c)) {
            const v = g(t + span * 1e-6);
            if (Number.isFinite(v)) s = Math.max(s, Math.abs(v));
        }
        return 1e-7 * Math.max(1, s);
    };
    // The line as stretches and ends in turn: S0, E0, S1, E1, ..., Sk. A piece is a run of those where it holds.
    const cuts = [lo, ...ends, hi];
    const elements: Array<{ holds: boolean; a: number; b: number; end: boolean; first: boolean; last: boolean }> = [];
    for (let i = 0; i < cuts.length - 1; i++) {
        elements.push({ holds: holds(c, (cuts[i] + cuts[i + 1]) / 2, 0), a: cuts[i], b: cuts[i + 1], end: false, first: i === 0, last: i === cuts.length - 2 });
        if (i < ends.length) elements.push({ holds: holds(c, ends[i], tolAt(ends[i])), a: ends[i], b: ends[i], end: true, first: false, last: false });
    }
    const pieces: AxisPiece[] = [];
    for (let i = 0; i < elements.length; i++) {
        if (!elements[i].holds) continue;
        let j = i;
        while (j + 1 < elements.length && elements[j + 1].holds) j++;
        const s = elements[i];
        const e = elements[j];
        const piece: AxisPiece = { a: s.a, b: e.b, closedA: s.end, closedB: e.end };
        if (!s.end && s.first) {
            piece.cutA = true;
            piece.closedA = true;
        }
        if (!e.end && e.last) {
            piece.cutB = true;
            piece.closedB = true;
        }
        pieces.push(piece);
        i = j;
    }
    // Pieces that reach the ends of the range: for ever, when the condition holds far beyond.
    for (const p of pieces) {
        if (p.cutA) {
            if (FAR.every((k) => holds(c, lo - k * span, 0))) {
                p.a = -Infinity;
                p.closedA = false;
                delete p.cutA;
            }
        }
        if (p.cutB) {
            if (FAR.every((k) => holds(c, hi + k * span, 0))) {
                p.b = Infinity;
                p.closedB = false;
                delete p.cutB;
            }
        }
    }
    return pieces;
}

/** A number in a label: short, -0 as 0, ±∞. */
export function setNumber(v: number): string {
    if (v === Infinity) return '\\infty';
    if (v === -Infinity) return '-\\infty';
    return decimal(v, 3);
}

/** The set in set notation (TeX, no dollars): [-2, 2], (-\infty, 0) \cup (1, \infty), \{-2, 2\}, \emptyset, \mathbb{R}. */
export function setTex(pieces: AxisPiece[]): string {
    if (!pieces.length) return '\\emptyset';
    if (pieces.length === 1 && pieces[0].a === -Infinity && pieces[0].b === Infinity) return '\\mathbb{R}';
    const parts: string[] = [];
    let points: string[] = [];
    const flush = () => {
        if (points.length) parts.push(`\\{${points.join(', ')}\\}`);
        points = [];
    };
    for (const p of pieces) {
        if (p.a === p.b) {
            points.push(setNumber(p.a));
            continue;
        }
        flush();
        const left = p.cutA ? '\\dots' : `${p.closedA ? '[' : '('}${setNumber(p.a)}`;
        const right = p.cutB ? '\\dots' : `${setNumber(p.b)}${p.closedB ? ']' : ')'}`;
        parts.push(`${left}, ${right}`);
    }
    flush();
    if (parts.length > LABEL_PIECES) return `${parts.slice(0, LABEL_PIECES - 1).join(' \\cup ')} \\cup \\dots`;
    return parts.join(' \\cup ');
}

/** The label of a set on an axis: $\{x \mid g(x) \le 0\} = [-2, 2]$. */
export function setLabel(variable: string, conditionTex: string, pieces: AxisPiece[]): string {
    return `$\\{${variable} \\mid ${conditionTex}\\} = ${setTex(pieces)}$`;
}
