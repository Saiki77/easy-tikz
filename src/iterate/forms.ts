/*
 * What a formula of part E (6.0) is, from its text: a recurrence, a
 * function of z, or a function of x and y. Pure: no DOM, no Obsidian.
 */
import { readRecurrence } from '../values';
import { topEquals } from './tools';

/** The right side of `f(z) = body` and its head's parameters, or the text itself. */
export function formulaParts(src: string): { name: string | null; params: string[]; body: string } {
    const eq = topEquals(src);
    if (eq < 0) return { name: null, params: [], body: src.trim() };
    const head = /^\s*\\?([A-Za-z][A-Za-z0-9_]*)\s*\(\s*([^()]*)\)\s*$/.exec(src.slice(0, eq));
    if (!head) return { name: null, params: [], body: src.trim() };
    return { name: head[1], params: head[2].split(',').map((p) => p.trim()), body: src.slice(eq + 1).trim() };
}

/** Does the formula read the letter `v` alone (not z_n, not a command)? */
export function readsLetter(src: string, v: string): boolean {
    return new RegExp(`(?<![A-Za-z0-9_\\\\])${v}(?![A-Za-z0-9_])`).test(src);
}

/** What a coloured plane is from its formula: a recurrence, a function of z, or a function of x and y. */
export function planeKind(formula: string): 'escape' | 'domain' | 'heat' {
    if (readRecurrence(formula)) return 'escape';
    const p = formulaParts(formula);
    if (p.name && p.params.length === 1) return 'domain';
    if (p.name && p.params.length === 2) return 'heat';
    return readsLetter(p.body, 'z') && !readsLetter(p.body, 'x') && !readsLetter(p.body, 'y') ? 'domain' : 'heat';
}
