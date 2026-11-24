/*
 * The hover cards of 6.0 E (src/ui/formulaHover.ts shows them): formulas
 * of part E as charts.
 *
 *   z_{n+1} = z_n^2 + c         the orbit of 0 with c = a + bi on sliders
 *   x_{n+1} = r x_n (1 - x_n)   the cobweb from 0.2, its letters on sliders
 *   \sum_{k=1}^{n} ...          the partial sum with a slider n (a curve in x, else the sums as points)
 *   f(z) = ...                  its domain colouring
 *
 * Pure: no DOM, no Obsidian.
 */
import type { MessageKey } from '../i18n';
import { latexToPlain } from '../latex';
import { BUILTIN_FUNCTION_NAMES, CONSTANT_NAMES } from '../expr';
import { readRecurrence } from '../values';
import { readsLetter } from './forms';
import { topEquals } from './tools';

export type IterateHoverKind = 'recurrence' | 'sum' | 'domain';

export interface IterateHoverCard {
    kind: IterateHoverKind;
    /** The chart, in chart lines. */
    lines: string[];
    /** The note under the chart. */
    note: MessageKey;
}

const KNOWN = new Set(['x', 'y', 'z', 'e', 'i', 'pi', 'n', 'k', 't', ...BUILTIN_FUNCTION_NAMES, ...CONSTANT_NAMES]);

/** Spacing and sizes as plain LaTeX, and no trailing punctuation. */
function normalize(tex: string): string {
    return tex
        .replace(/\\(?:left|right|bigl?|bigr?|Bigl?|Bigr?)(?![A-Za-z])/g, '')
        .replace(/\\(?:displaystyle|textstyle|quad|qquad)(?![A-Za-z])|\\[,;!: ]/g, ' ')
        .replace(/:=|\\coloneqq/g, '=')
        .replace(/[.,;]\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** The free letters of a formula: single letters and Greek names that are no built-in and not `skip`. */
function freeLetters(tex: string, skip: string[]): string[] {
    const plain = latexToPlain(tex.replace(/([A-Za-z])_\{?[A-Za-z0-9+ ]+\}?/g, '$1'));
    const out: string[] = [];
    for (const m of plain.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)) {
        const name = m[0];
        const call = /^\s*\(/.test(plain.slice((m.index ?? 0) + name.length));
        if (call || out.includes(name) || KNOWN.has(name) || skip.includes(name)) continue;
        if (name.length > 1 && !/^(alpha|beta|gamma|delta|lambda|mu|eta|theta|omega|sigma|rho|tau|phi|epsilon)$/.test(name)) continue;
        out.push(name);
    }
    return out;
}

/** `\sum_{k=1}^{n} body`: its index, bounds and body. */
function sumParts(tex: string): { k: string; lo: string; hi: string; body: string } | null {
    const m = /^\\sum\s*_\s*\{\s*([A-Za-z])\s*=\s*([^{}]+?)\s*\}\s*\^\s*(?:\{\s*([^{}]+?)\s*\}|([A-Za-z0-9]))\s*([\s\S]+)$/.exec(tex);
    if (!m) return null;
    return { k: m[1], lo: m[2], hi: m[3] ?? m[4], body: m[5].trim() };
}

/** What a formula's card of this part is, or null. */
export function iterateHoverKind(tex: string): IterateHoverKind | null {
    return iterateHoverCard(tex)?.kind ?? null;
}

/** The chart of a formula of this part; null when it has none. */
export function iterateHoverCard(texIn: string): IterateHoverCard | null {
    const tex = normalize(texIn);
    if (!tex) return null;
    const rec = readRecurrence(tex);
    if (rec) {
        if (/\\nabla|\\begin|\\sum/.test(rec.formula)) return null;
        const letters = freeLetters(rec.formula, [rec.state]);
        if (/^(z|w|zeta)$/.test(rec.state)) {
            // A complex recurrence: the orbit of 0 with its first letter c = a + bi on two sliders.
            const c = letters[0];
            const sliders = c ? ['slider a from -2 to 1, starting at -0.12', 'slider b from -1.5 to 1.5, starting at 0.75'] : [];
            const rest = letters.slice(1).map((l) => `slider ${l} from -2 to 2, starting at 1`);
            const given = c ? `, $${c} = a + b i$` : '';
            // Behind the orbit, faint: the plane of c, each point coloured by its own orbit (the Mandelbrot set for z^2 + c).
            const plane = c ? [`colour the plane by $${tex}$, $${rec.state}_0 = 0$, $${c} = x + i y$, 100 steps, opacity 0.35`] : [];
            return {
                kind: 'recurrence',
                note: 'iterate.hover.recurrenceNote',
                lines: ['show x from -2 to 1 and y from -1.5 to 1.5', 'equal scale', ...sliders, ...rest, ...plane, `draw the orbit of $${tex}$, $${rec.state}_0 = 0$${given}, 40 steps`],
            };
        }
        const sliders = letters.map((l, i) => `slider ${l} from 0 to 4, starting at ${i === 0 ? 3.7 : 1}`);
        return {
            kind: 'recurrence',
            note: 'iterate.hover.cobwebNote',
            lines: ['show x from 0 to 1 and y from 0 to 1', ...sliders, `draw the cobweb of $${tex}$ from 0.2, 40 steps`],
        };
    }
    const sum = sumParts(tex);
    if (sum) {
        const letters = freeLetters(sum.body, [sum.k, 'x']).filter((l) => l !== sum.hi);
        const extra = letters.map((l) => `slider ${l} from -2 to 2, starting at 1`);
        const n = /^[A-Za-z]$/.test(sum.hi) && !['x', sum.k].includes(sum.hi) ? sum.hi : 'n';
        const slider = `slider ${n} from 1 to 30, starting at 5, in steps of 1`;
        if (readsLetter(sum.body, 'x')) {
            return {
                kind: 'sum',
                note: 'iterate.hover.sumNote',
                lines: ['show x from -7 to 7', slider, ...extra, `plot $S(x) = \\sum_{${sum.k}=${sum.lo}}^{${n}} ${sum.body}$ in blue, thick`],
            };
        }
        const m = n === 'm' ? 'j' : 'm';
        return {
            kind: 'sum',
            note: 'iterate.hover.sumNote',
            lines: [`show x from 0 to ${n} + 1`, slider, ...extra, `mark the points $\\{(${m}, \\sum_{${sum.k}=${sum.lo}}^{${m}} ${sum.body}) : ${m} = 1, \\dots, ${n}\\}$`],
        };
    }
    // A function of z: f(z) = ..., or a formula in z alone.
    const eq = topEquals(tex);
    const head = eq >= 0 ? /^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(\s*z\s*\)\s*$/.exec(tex.slice(0, eq)) : null;
    const body = head ? tex.slice(eq + 1).trim() : eq < 0 ? tex : '';
    if (body && readsLetter(body, 'z') && !readsLetter(body, 'x') && !readsLetter(body, 'y') && (head || /\\frac|\^|[*/]|\bi\b/.test(body))) {
        const letters = freeLetters(body, ['z']);
        return {
            kind: 'domain',
            note: 'iterate.hover.domainNote',
            lines: ['show x from -2 to 2 and y from -2 to 2', 'equal scale', ...letters.map((l) => `slider ${l} from -2 to 2, starting at 1`), `colour the plane by $${head ? `${head[1]}(z) = ` : ''}${body}$`],
        };
    }
    return null;
}
