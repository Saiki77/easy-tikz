/*
 * After someone changes their chart words: the chart blocks of a note that
 * read differently with the new words (they used a word that is gone or
 * now means another piece) are written again in the new words, line by
 * line, so comments, blank lines and the order of the lines stay. A block is
 * only rewritten when the result reads as exactly the chart it was. Pure:
 * main.ts reads and writes the notes.
 */
import { canonical } from '../chartdata';
import { chartFences } from './fences';
import { definedNames, isChartText, parseChartText } from './parse';
import { ChartWords, hasWords, readWords, renameWords, writeWords } from './words';

const QUOTE = /^(?:[ \t]*>[ ]?)*/;

/** The chart of a block body with these words, compared by its canonical form; null when the body cannot be read. */
function chartOf(body: string, words: ChartWords): string | null {
    try {
        return canonical(parseChartText(body, { words }).data);
    } catch {
        return null;
    }
}

/** Does this block body read differently with the new words? */
export function leansOnWords(body: string, from: ChartWords, to: ChartWords): boolean {
    if (!isChartText(body)) return false;
    const before = parseChartText(body, { words: from });
    const after = parseChartText(body, { words: to });
    return chartOf(body, from) !== chartOf(body, to) || after.problems.length > before.problems.length;
}

/**
 * The block body in the new words (null when they cannot say the same
 * chart): first only the words that changed are renamed; when that does not
 * read as the same chart, the whole block is written in the new words.
 */
export function rewordBody(body: string, from: ChartWords, to: ChartWords): string | null {
    const before = parseChartText(body, { words: from });
    const names = definedNames(before.data);
    const want = chartOf(body, from);
    const renamed = renameWords(body, from, to, names);
    if (chartOf(renamed, to) === want) return renamed;
    const builtin = readWords(body, from, names).text.split('\n');
    const lines = hasWords(to) && to.write === 'yours' ? builtin.map((l) => writeWords(l, to, names)) : builtin;
    const next = lines.join('\n');
    return chartOf(next, to) === want ? next : null;
}

/** A note's text with every chart block that leans on changed words written in the new ones, and how many changed. */
export function rewordNote(text: string, from: ChartWords, to: ChartWords): { text: string; changed: number } {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    let changed = 0;
    for (const fence of chartFences(lines.length, (n) => lines[n - 1], new Set(['easy-tikz']))) {
        if (!leansOnWords(fence.body, from, to)) continue;
        const next = rewordBody(fence.body, from, to);
        if (next === null) continue;
        // Line by line: each body line keeps the quote markers it had (a block in a callout).
        next.split('\n').forEach((line, k) => {
            const at = fence.first + k; // 0-based index of body line k (the fence is line `first`, 1-based)
            const prefix = QUOTE.exec(lines[at])?.[0] ?? '';
            lines[at] = prefix + line;
        });
        changed++;
    }
    return changed ? { text: lines.join(eol), changed } : { text, changed: 0 };
}
