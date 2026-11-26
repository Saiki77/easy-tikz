/*
 * The math of a note's text as Obsidian's Reading view finds it (6.2): the
 * hover gives the i-th drawn formula of a section the i-th formula found
 * here, so both must pair the dollar signs the same way.
 *
 *   inline    $...$: the opening $ is not followed by a space or a tab; the
 *             closing $ is not preceded by a space or a tab and not followed
 *             by a digit. So "costs 5$ and 10$", "$2.50 per hour" and "$ x $"
 *             are no math, and in "$x$5 and $y$" the math is "x$5 and $y".
 *             $$...$$ inside a line is display math, closed by the next $$.
 *             \$ is a dollar sign; a \ hides the sign after it inside math.
 *             Inline math may run over the lines of one paragraph, never
 *             past it, nor past a heading line, a list item or a table cell.
 *   code      `...` (any run of backticks, closed by a run of the same
 *             length) is never math; neither are fenced code blocks (``` or
 *             ~~~) and the front matter.
 *   block     a line that starts with $$ (and has no other $) opens a math
 *             block, closed by the first line that ends with $$ and has no
 *             $ before them; without one it runs to the end of the text.
 *
 * Callouts and quotes: the > signs of a line are no part of its math. Each
 * formula keeps its place in the text (start and end, dollars included).
 * Not covered: indented code blocks, HTML blocks, %% comments %%. Pure: no
 * DOM, no Obsidian.
 */

export interface MathSpan {
    /** The TeX between the dollars, trimmed (the > signs of a quote left out). */
    tex: string;
    /** Where the formula sits in the text, dollars included. */
    start: number;
    end: number;
    /** $$...$$ (a block, or display math inside a line). */
    display: boolean;
}

/** A run of text read as one inline unit (a paragraph, a heading, a table cell), with the place in the note of each of its characters. */
interface Run {
    text: string;
    /** at[i]: where character i sits in the note; at[text.length]: just after the last. */
    at: number[];
}

/** An ASCII sign a backslash escapes (CommonMark): \$ is a dollar, \\ a backslash, \` a backtick. */
const ESCAPABLE = /[!-/:-@[-`{-~]/;

/** The inline math of one run, in order. */
function inlineSpans(run: Run, out: MathSpan[]): void {
    const r = run.text;
    const n = r.length;
    let i = 0;
    while (i < n) {
        const c = r[i];
        if (c === '\\') {
            i += i + 1 < n && ESCAPABLE.test(r[i + 1]) ? 2 : 1;
            continue;
        }
        if (c === '`') {
            let k = i;
            while (k < n && r[k] === '`') k++;
            const len = k - i;
            // The closing run: the next run of exactly as many backticks.
            let j = k;
            let close = -1;
            while (j < n) {
                if (r[j] !== '`') {
                    j++;
                    continue;
                }
                let m = j;
                while (m < n && r[m] === '`') m++;
                if (m - j === len) {
                    close = m;
                    break;
                }
                j = m;
            }
            i = close < 0 ? k : close;
            continue;
        }
        if (c !== '$') {
            i++;
            continue;
        }
        const display = r[i + 1] === '$';
        const from = i + (display ? 2 : 1);
        if (!display && (r[from] === ' ' || r[from] === '\t')) {
            i++;
            continue;
        }
        let s = from;
        let end = -1;
        let contentEnd = -1;
        while (s < n) {
            const ch = r[s];
            if (ch === '$') {
                const prev = r[s - 1];
                const next = s + 1 < n ? r[s + 1] : '';
                const closes = prev !== ' ' && prev !== '\t' && !(next >= '0' && next <= '9');
                if (!display && closes) {
                    contentEnd = s;
                    end = s + 1;
                    break;
                }
                if (display && next === '$') {
                    contentEnd = s;
                    end = s + 2;
                    break;
                }
            } else if (ch === '\\') s++;
            s++;
        }
        if (end < 0) {
            i++;
            continue;
        }
        out.push({ tex: r.slice(from, contentEnd).trim(), start: run.at[i], end: run.at[end], display });
        i = end;
    }
}

/** A line of the text: where it starts, its > signs, and what follows them. */
interface Line {
    start: number;
    /** The length of its quote marks (> and the spaces around them). */
    quote: number;
    /** How deep it sits in quotes (the number of >). */
    depth: number;
    content: string;
}

function linesOf(text: string): Line[] {
    const out: Line[] = [];
    let start = 0;
    for (const raw of text.split('\n')) {
        const q = /^(?:[ \t]{0,3}>[ \t]?)+/.exec(raw);
        const quote = q ? q[0].length : 0;
        out.push({ start, quote, depth: q ? (q[0].match(/>/g) ?? []).length : 0, content: raw.slice(quote) });
        start += raw.length + 1;
    }
    return out;
}

/** One run from pieces of lines (columns from to of each line's content), joined by line breaks. */
function runOf(parts: Array<{ line: Line; from: number; to: number }>): Run {
    let text = '';
    const at: number[] = [];
    parts.forEach((p, k) => {
        if (k) {
            // The line break between two lines of a paragraph.
            text += '\n';
            at.push(p.line.start - 1);
        }
        for (let i = p.from; i < p.to; i++) {
            text += p.line.content[i];
            at.push(p.line.start + p.line.quote + i);
        }
    });
    const last = parts[parts.length - 1];
    at.push(last ? last.line.start + last.line.quote + last.to : 0);
    return { text, at };
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** The cells of a table row: from and to columns of its content, split at | that are not escaped. */
function cellsOf(content: string): Array<[number, number]> {
    const cells: Array<[number, number]> = [];
    let from = 0;
    for (let i = 0; i < content.length; i++) {
        if (content[i] === '\\') {
            i++;
            continue;
        }
        if (content[i] === '|') {
            cells.push([from, i]);
            from = i + 1;
        }
    }
    cells.push([from, content.length]);
    return cells;
}

/** The $$ block that opens on this line: how many dollars open it, and the column after them; null when the line opens none. */
function blockOpening(content: string): { dollars: number; after: number; at: number } | null {
    const m = /^(\s*)(\${2,})/.exec(content);
    if (!m) return null;
    const after = m[0].length;
    // A $ later on the line: the line is inline math ($$x$$), no block.
    if (content.slice(after).includes('$')) return null;
    return { dollars: m[2].length, after, at: m[1].length };
}

/** The math of a note's text (or of a part of it), as Obsidian's Reading view finds it, in order. */
export function mathSpans(textIn: string): MathSpan[] {
    // The front matter: no math (its length kept, so every place stays where it is).
    const text = textIn.replace(/^---\n[\s\S]*?\n---(?=\n|$)/, (m) => m.replace(/[^\n]/g, ' '));
    const lines = linesOf(text);
    const out: MathSpan[] = [];
    let para: Array<{ line: Line; from: number; to: number }> = [];
    let paraDepth = 0;
    const flush = () => {
        if (para.length) inlineSpans(runOf(para), out);
        para = [];
    };
    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const c = line.content;
        if (para.length && line.depth !== paraDepth) flush();
        if (!c.trim()) {
            flush();
            continue;
        }
        const fence = FENCE.exec(c);
        if (fence) {
            flush();
            const mark = fence[1];
            const closing = new RegExp(`^\\s*${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`);
            let k = li + 1;
            while (k < lines.length && !closing.test(lines[k].content)) k++;
            li = k;
            continue;
        }
        // A $$ line opens a block only with a line after it.
        const open = li + 1 < lines.length ? blockOpening(c) : null;
        if (open) {
            flush();
            const texLines: string[] = [];
            const first = c.slice(open.after).trim();
            if (first) texLines.push(first);
            let end = text.length;
            let k = li + 1;
            for (; k < lines.length; k++) {
                const l = lines[k].content;
                const trimmed = l.replace(/\s+$/, '');
                const tail = /\$+$/.exec(trimmed);
                if (tail && tail[0].length >= open.dollars && l.indexOf('$') === tail.index) {
                    const before = trimmed.slice(0, tail.index).trim();
                    if (before) texLines.push(before);
                    end = lines[k].start + lines[k].quote + trimmed.length;
                    break;
                }
                texLines.push(l);
            }
            out.push({ tex: texLines.join('\n').trim(), start: line.start + line.quote + open.at, end, display: true });
            li = k;
            continue;
        }
        if (HEADING.test(c) || RULE.test(c)) {
            flush();
            if (HEADING.test(c)) inlineSpans(runOf([{ line, from: 0, to: c.length }]), out);
            continue;
        }
        // A table: a row with | and under it the row of dashes; each cell is read alone.
        const next = lines[li + 1];
        if (c.includes('|') && next && next.depth === line.depth && TABLE_DELIMITER.test(next.content) && next.content.includes('-') && next.content.includes('|')) {
            flush();
            let k = li;
            for (; k < lines.length && lines[k].depth === line.depth && lines[k].content.trim() && lines[k].content.includes('|'); k++) {
                if (k === li + 1) continue;
                for (const [from, to] of cellsOf(lines[k].content)) inlineSpans(runOf([{ line: lines[k], from, to }]), out);
            }
            li = k - 1;
            continue;
        }
        if (LIST_ITEM.test(c)) flush();
        if (!para.length) paraDepth = line.depth;
        para.push({ line, from: 0, to: c.length });
    }
    flush();
    return out;
}

/** The inline math of one line, as Obsidian reads it (for the formula at the cursor). */
export function lineSpans(line: string): MathSpan[] {
    const out: MathSpan[] = [];
    const at: number[] = [];
    for (let i = 0; i <= line.length; i++) at.push(i);
    inlineSpans({ text: line, at }, out);
    return out;
}
