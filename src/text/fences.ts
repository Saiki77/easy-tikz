/*
 * The chart blocks of a note, found from its lines the way Obsidian reads
 * fences: ``` or ~~~ (three or more), a language after the opening one, and
 * a closing fence of the same kind at least as long. Blocks in callouts and
 * quotes (`> ```easy-tikz`) count; their `>` markers are not part of the body.
 * A block nobody closed yet runs to the end of its quote or of the note.
 * Pure, so the Live Preview chart (src/live.ts) and its tests share it.
 */

export interface ChartFence {
    /** 1-based line of the opening fence. */
    first: number;
    /** 1-based line of the closing fence, or the block's last line when it is not closed. */
    last: number;
    closed: boolean;
    /** The language after the opening fence (easy-tikz, tikz). */
    tag: string;
    /** The lines between the fences, callout markers removed: what Obsidian gives the block's renderer. */
    body: string;
}

/** The `>` markers in front of a line (a callout or quote), with their spaces. */
const QUOTE = /^(?:[ \t]*>[ ]?)*/;
const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/;

const depthOf = (prefix: string) => (prefix.match(/>/g) ?? []).length;

/** The line without its first `depth` quote markers. */
function unquote(line: string, depth: number): string {
    let rest = line;
    for (let i = 0; i < depth; i++) rest = rest.replace(/^[ \t]*>[ ]?/, '');
    return rest;
}

/**
 * The fenced blocks of the note whose language is one of `tags`, in order.
 * `lineAt(n)` gives line n (1-based) of `count`.
 */
export function chartFences(count: number, lineAt: (n: number) => string, tags: ReadonlySet<string>): ChartFence[] {
    const out: ChartFence[] = [];
    let n = 1;
    while (n <= count) {
        const line = lineAt(n);
        const prefix = QUOTE.exec(line)?.[0] ?? '';
        const open = FENCE.exec(line.slice(prefix.length));
        // A backtick fence's info string has no backticks (`x` inline code is not a fence).
        if (!open || (open[1][0] === '`' && open[2].includes('`'))) {
            n++;
            continue;
        }
        const depth = depthOf(prefix);
        const closing = new RegExp(`^[ \\t]*\\${open[1][0]}{${open[1].length},}[ \\t]*$`);
        const body: string[] = [];
        let end = -1;
        let m = n + 1;
        for (; m <= count; m++) {
            const next = lineAt(m);
            // The quote ended: so does the block in it.
            if (depthOf(QUOTE.exec(next)?.[0] ?? '') < depth) break;
            const inner = unquote(next, depth);
            if (closing.test(inner)) {
                end = m;
                break;
            }
            body.push(inner);
        }
        const last = end > 0 ? end : m - 1;
        const tag = open[2].trim().split(/\s+/)[0] ?? '';
        if (tags.has(tag)) out.push({ first: n, last, closed: end > 0, tag, body: body.join('\n') });
        n = last + 1;
    }
    return out;
}
