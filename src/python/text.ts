/*
 * 6.0 P: the python block in the chart text. In words:
 *
 *   python:
 *       import numpy as np
 *       c = np.fft.fft(heart) / len(heart)
 *
 * a `python:` line (optionally named, `PY2: python:`) and the lines below
 * it that are indented deeper (any consistent indent; blank lines between
 * them belong to it). In Full LaTeX: \begin{python} ... \end{python}. The
 * script is kept exactly as written; only the block's own indent goes.
 * Pure: no DOM, no Obsidian.
 */

/** The head of a block: `python:` or `NAME: python:`. */
export const PYTHON_HEAD = /^(\s*)(?:([A-Za-z][A-Za-z0-9_]*)\s*:\s*)?python\s*:\s*$/;
export const FULL_PY_BEGIN = /^\s*\\begin\s*\{\s*python\s*\}\s*$/;
export const FULL_PY_END = /^\s*\\end\s*\{\s*python\s*\}\s*$/;

export interface PythonBlock {
    /** 0-based line of `python:`. */
    head: number;
    /** 0-based line after its last line. */
    end: number;
    /** Its name when the line gives one (PY2: python:), and where it starts. */
    name: string | null;
    nameAt: number;
    /** The script without the block's indent. */
    code: string;
}

const lead = (s: string) => /^[ \t]*/.exec(s)?.[0] ?? '';

/** The common leading whitespace of the lines that are not blank. */
function commonIndent(lines: readonly string[]): string {
    let common: string | null = null;
    for (const l of lines) {
        if (!l.trim()) continue;
        const w = lead(l);
        if (common === null) common = w;
        else {
            let k = 0;
            while (k < common.length && k < w.length && common[k] === w[k]) k++;
            common = common.slice(0, k);
        }
    }
    return common ?? '';
}

/** Lines without their common indent, whitespace at their ends and blank lines at the start and end. */
export function normalizeCode(code: string): string {
    const lines = code.split(/\r\n?|\n/).map((l) => l.replace(/\s+$/, ''));
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const w = commonIndent(lines);
    return lines.map((l) => (l.trim() ? l.slice(w.length) : '')).join('\n');
}

/** The python blocks of a chart's lines. */
export function pythonBlocks(lines: readonly string[]): PythonBlock[] {
    const out: PythonBlock[] = [];
    for (let i = 0; i < lines.length; i++) {
        const m = PYTHON_HEAD.exec(lines[i]);
        if (!m) continue;
        const headIndent = m[1].length;
        let end = i + 1;
        let last = i;
        for (let j = i + 1; j < lines.length; j++) {
            const l = lines[j];
            if (!l.trim()) continue;
            if (lead(l).length <= headIndent) break;
            last = j;
        }
        end = last + 1;
        const body = lines.slice(i + 1, end);
        out.push({ head: i, end, name: m[2] ?? null, nameAt: m[1].length, code: normalizeCode(body.join('\n')) });
        i = end - 1;
    }
    return out;
}

/** A line of the script that would end the note's code block (``` or ~~~ at its start). */
const FENCE = /^\s*(`{3,}|~{3,})/;

/** The block in words: `python:` and the script, 4 spaces in; null when a line of it would end the code block. */
export function pythonWords(code: string, name: string | null): string | null {
    const lines = normalizeCode(code).split('\n');
    if (lines.some((l) => FENCE.test(l))) return null;
    const head = name ? `${name}: python:` : 'python:';
    return [head, ...lines.map((l) => (l ? `    ${l}` : ''))].join('\n');
}

/** The printed words of a block back to its parts (for Full LaTeX): its name and its script; null for any other line. */
export function readPythonWords(text: string): { name: string | null; code: string } | null {
    const lines = text.split('\n');
    const m = PYTHON_HEAD.exec(lines[0] ?? '');
    if (!m) return null;
    return { name: m[2] ?? null, code: normalizeCode(lines.slice(1).join('\n')) };
}

/** The block in Full LaTeX: \begin{python}, the script as it is, \end{python} (a name: % name in a comment is not kept; names go as name=). */
export function pythonFull(code: string, name: string | null): string {
    const lines = normalizeCode(code).split('\n');
    return [name ? `\\begin{python}[name=${name}]` : '\\begin{python}', ...lines, '\\end{python}'].join('\n');
}

/** `\begin{python}` or `\begin{python}[name=PY2]`: the name (or '' for none); null for any other line. */
export function fullPythonHead(line: string): string | null {
    const m = /^\s*\\begin\s*\{\s*python\s*\}\s*(?:\[\s*name\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*\])?\s*$/.exec(line);
    if (!m) return null;
    return m[1] ?? '';
}
