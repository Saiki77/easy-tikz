/*
 * The lines of 6.0 B in the chart language: what the words parser
 * (src/text/parse.ts) reads, what the printer (src/text/print.ts) writes,
 * and their Full LaTeX commands (src/text/full.ts):
 *
 *   mark where $g(x) \le 0$ on the x-axis, labelled
 *   \mark[x-axis, labelled]{g(x) \le 0}
 *
 *   draw the chord of g from -1 to 3 at $\lambda$, labelled
 *   \draw[chord, from=-1, to=3, at=\lambda, labelled]{g}
 *
 * Pure: no DOM, no Obsidian.
 */

const NAME = '[A-Za-z][A-Za-z0-9_]*';

/** `where <condition> on the x-axis` (after `mark`): the condition and the axis, or null. */
export function readAxisSet(text: string): { condition: string; axis: 'x' | 'y' } | null {
    const m = /^where\s+(.+?)\s+on\s+the\s+([xy])[-\s]?axis$/i.exec(text.trim());
    if (!m || !m[1].trim()) return null;
    return { condition: m[1].trim(), axis: m[2].toLowerCase() === 'y' ? 'y' : 'x' };
}

/** `where ... on the ...` that is not quite a set on an axis: the parser names the form. */
export function looksLikeAxisSet(text: string): boolean {
    return /^where\s+.+\s+on\s+the\b/i.test(text.trim());
}

/** `the chord of g from a to b` or `... at λ` (after `draw`): its fields, or null. */
export function readChord(text: string): { function: string; from: string; to: string; at: string } | null {
    const m = new RegExp(`^the\\s+chord\\s+of\\s+(${NAME})\\s+from\\s+(.+?)\\s+to\\s+(.+?)(?:\\s+at\\s+(.+))?$`, 'i').exec(text.trim());
    if (!m) return null;
    return { function: m[1], from: m[2].trim(), to: m[3].trim(), at: (m[4] ?? '').trim() };
}

/** `the chord ...` that does not read: the parser names the form. */
export function looksLikeChord(text: string): boolean {
    return /^the\s+chord\b/i.test(text.trim());
}

/** The head of a set on an axis, given its condition as the line writes it (in $...$ when it is LaTeX). */
export function axisSetHead(condition: string, axis: 'x' | 'y'): string {
    return `mark where ${condition} on the ${axis}-axis`;
}

/** The head of a chord, its parts as the line writes them. */
export function chordHead(fn: string, from: string, to: string, at: string): string {
    return `draw the chord of ${fn} from ${from} to ${to}${at ? ` at ${at}` : ''}`;
}

/** A Full LaTeX line's flags that make a mark line a set on an axis. */
export const AXIS_FLAGS = ['x-axis', 'y-axis'];
