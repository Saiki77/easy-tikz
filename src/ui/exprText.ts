/*
 * 6.2.2: what the formula fields of the editor read from their text, kept
 * free of the DOM so the tests can run it: the text on one line, the
 * bracket that matches the one at the caret, how deep the brackets nest,
 * and whether a formula is long or nested enough for its typeset preview.
 * The field itself is exprInput in src/ui/kit.ts.
 */

const OPEN = '([{';
const CLOSE = ')]}';

/** A formula field has one line: line breaks (from a paste or a drop) become spaces. */
export function oneLine(text: string): string {
    return text.replace(/\r\n|\r|\n/g, ' ');
}

/**
 * The bracket next to the caret and the one that matches it, as two
 * indices (the opening bracket first), or null. The bracket before the
 * caret wins, as in code editors; a bracket without a partner (still being
 * typed) gives null.
 */
export function bracketPair(text: string, caret: number): [number, number] | null {
    for (const at of [caret - 1, caret]) {
        if (at < 0 || at >= text.length) continue;
        const ch = text[at];
        const open = OPEN.indexOf(ch);
        const close = CLOSE.indexOf(ch);
        if (open < 0 && close < 0) continue;
        const other = open >= 0 ? partner(text, at, 1) : partner(text, at, -1);
        if (other < 0) return null;
        return open >= 0 ? [at, other] : [other, at];
    }
    return null;
}

/** Index of the bracket that matches the one at `at`, walking in `dir`; -1 when there is none or the kinds differ. */
function partner(text: string, at: number, dir: 1 | -1): number {
    const stack: string[] = [];
    for (let i = at; i >= 0 && i < text.length; i += dir) {
        const ch = text[i];
        const isOpen = OPEN.indexOf(ch) >= 0;
        const isClose = CLOSE.indexOf(ch) >= 0;
        if (!isOpen && !isClose) continue;
        // Walking right, an opening bracket nests; walking left, a closing one does.
        if (dir === 1 ? isOpen : isClose) {
            stack.push(ch);
            continue;
        }
        const top = stack.pop();
        if (top === undefined) return -1;
        const want = dir === 1 ? CLOSE[OPEN.indexOf(top)] : OPEN[CLOSE.indexOf(top)];
        if (ch !== want) return -1;
        if (!stack.length) return i;
    }
    return -1;
}

/** How deep the brackets nest: 0 for 'x^2', 1 for 'sin(x)', 2 for 'sqrt(1 - (x/2)^2)'. */
export function bracketDepth(text: string): number {
    let depth = 0;
    let deepest = 0;
    for (const ch of text) {
        if (OPEN.indexOf(ch) >= 0) deepest = Math.max(deepest, ++depth);
        else if (CLOSE.indexOf(ch) >= 0) depth = Math.max(0, depth - 1);
    }
    return deepest;
}

/** Formulas at least this long get the typeset preview, nested or not. */
export const PREVIEW_MIN_LENGTH = 24;

/** Nested formulas at least this long get it too ('f(g(x))' reads well as typed). */
export const PREVIEW_MIN_NESTED = 12;

/**
 * True when a formula is long or nested enough that the typeset preview
 * under its field helps: at least PREVIEW_MIN_LENGTH characters, or
 * brackets inside brackets in at least PREVIEW_MIN_NESTED. 'sin(x)^2 + 1'
 * reads well as typed.
 */
export function wantsPreview(text: string): boolean {
    const s = text.trim();
    if (s.length >= PREVIEW_MIN_LENGTH) return true;
    return s.length >= PREVIEW_MIN_NESTED && bracketDepth(s) >= 2;
}
