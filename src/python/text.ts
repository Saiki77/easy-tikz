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

/** The head of a block: `python:`, `NAME: python:`, `python in red:` (the colour of its first curves, C0). */
export const PYTHON_HEAD = /^(\s*)(?:([A-Za-z][A-Za-z0-9_]*)\s*:\s*)?python(?:\s+in\s+([A-Za-z]+|#[0-9a-fA-F]{3,8}))?\s*:\s*$/;
export const FULL_PY_END = /^\s*\\end\s*\{\s*python\s*\}\s*$/;

/** The colour a block has when its line names none. */
export const PYTHON_COLOUR = 'blue';

export interface PythonBlock {
    /** 0-based line of `python:`. */
    head: number;
    /** 0-based line after its last line. */
    end: number;
    /** Its name when the line gives one (PY2: python:), and where it starts. */
    name: string | null;
    nameAt: number;
    /** Its colour when the line gives one (python in red:). */
    color: string | null;
    /** The script without the block's indent. */
    code: string;
}

/** A chart comment between script lines (% or //, or # at the start of the line): no line of the script, and no end of the block. */
export function isChartComment(line: string, headIndent: number): boolean {
    const t = line.trim();
    return t.startsWith('%') || t.startsWith('//') || (t.startsWith('#') && lead(line).length <= headIndent);
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
        let closed = false;
        for (let j = i + 1; j < lines.length; j++) {
            const l = lines[j];
            // \end{python} (a Full LaTeX block read as words) closes the block and belongs to it.
            if (FULL_PY_END.test(l)) {
                last = j;
                closed = true;
                break;
            }
            if (!l.trim() || isChartComment(l, headIndent)) continue;
            if (lead(l).length <= headIndent) break;
            last = j;
        }
        end = last + 1;
        const body = lines.slice(i + 1, closed ? end - 1 : end).filter((l) => !isChartComment(l, headIndent));
        out.push({ head: i, end, name: m[2] ?? null, nameAt: m[1].length, color: m[3] ?? null, code: normalizeCode(body.join('\n')) });
        i = end - 1;
    }
    return out;
}

/** A line of the script that would end the note's code block (``` or ~~~ at its start). */
const FENCE = /^\s*(`{3,}|~{3,})/;

const COLOUR_WORD = /^(?:[A-Za-z]+|#[0-9a-fA-F]{3,8})$/;

/** The head line in words: `python:`, `PY2: python:`, `python in red:`. */
export function pythonHead(name: string | null, color: string | null): string | null {
    const c = color && color !== PYTHON_COLOUR ? color : null;
    if (c && !COLOUR_WORD.test(c)) return null;
    return `${name ? `${name}: ` : ''}python${c ? ` in ${c}` : ''}:`;
}

/** The block in words: its head and the script, 4 spaces in; null when a line of it would end the code block. */
export function pythonWords(code: string, name: string | null, color: string | null = null): string | null {
    const lines = normalizeCode(code).split('\n');
    const head = pythonHead(name, color);
    if (!head || lines.some((l) => FENCE.test(l))) return null;
    return [head, ...lines.map((l) => (l ? `    ${l}` : ''))].join('\n');
}

/** The printed words of a block back to its parts (for Full LaTeX): name, colour and script; null for any other line. */
export function readPythonWords(text: string): { name: string | null; color: string | null; code: string } | null {
    const lines = text.split('\n');
    const m = PYTHON_HEAD.exec(lines[0] ?? '');
    if (!m) return null;
    return { name: m[2] ?? null, color: m[3] ?? null, code: normalizeCode(lines.slice(1).join('\n')) };
}

/** The head line in Full LaTeX: `\begin{python}`, `\begin{python}[name=PY2, red]`. */
export function fullHead(name: string | null, color: string | null): string {
    const opts = [name ? `name=${name}` : '', color && color !== PYTHON_COLOUR ? (/^[A-Za-z]+$/.test(color) ? color : `color=${color}`) : ''].filter((o) => o);
    return opts.length ? `\\begin{python}[${opts.join(', ')}]` : '\\begin{python}';
}

/** The block in Full LaTeX: \begin{python}, the script as it is, \end{python}. */
export function pythonFull(code: string, name: string | null, color: string | null = null): string {
    const lines = normalizeCode(code).split('\n');
    return [fullHead(name, color), ...lines, '\\end{python}'].join('\n');
}

/** `\begin{python}` with its options (name=PY2, a colour): its name and colour; null for any other line. */
export function fullPythonHead(line: string): { name: string | null; color: string | null } | null {
    const m = /^\s*\\begin\s*\{\s*python\s*\}\s*(?:\[([^\]]*)\])?\s*$/.exec(line);
    if (!m) return null;
    let name: string | null = null;
    let color: string | null = null;
    for (const raw of (m[1] ?? '').split(',')) {
        const o = raw.trim();
        if (!o) continue;
        const kv = /^(name|color|colour)\s*=\s*(.+)$/i.exec(o);
        if (kv && kv[1].toLowerCase() === 'name' && /^[A-Za-z][A-Za-z0-9_]*$/.test(kv[2].trim())) name = kv[2].trim();
        else if (kv) color = kv[2].trim().replace(/^"(.*)"$/, '$1');
        else if (COLOUR_WORD.test(o)) color = o;
    }
    return { name, color };
}

/** The scripts of a chart as comments of its TikZ (the export draws their result as coordinates; the Code tab shows the script). */
export function pythonComments(tools: unknown): string[] {
    if (!Array.isArray(tools)) return [];
    const out: string[] = [];
    for (const t of tools) {
        if (!t || typeof t !== 'object' || Reflect.get(t, 'type') !== 'python') continue;
        const code: unknown = Reflect.get(t, 'code');
        const name: unknown = Reflect.get(t, 'name');
        if (typeof code !== 'string' || !code.trim()) continue;
        out.push(`% Python ${typeof name === 'string' ? name : ''} (Easy TikZ ran it; its drawing is the coordinates below):`.replace('  ', ' '));
        for (const line of normalizeCode(code).split('\n')) out.push(line ? `%   ${line}` : '%');
    }
    return out;
}
