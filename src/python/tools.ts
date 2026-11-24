/*
 * 6.0 P: the python tool as data: its defaults, what the migration keeps
 * of a stored one, and the rename of a chart name inside its script (a
 * slider n renamed to m rewrites the names n of the script, not n in
 * strings, attributes or keywords). Pure: no DOM, no Obsidian.
 */
import type { PythonTool, Tool } from '../types';
import { tokenize } from './lexer';
import { normalizeCode } from './text';

type Data = Record<string, unknown>;

/** Name prefix: PY1, PY2, ... */
export const PYTHON_PREFIX = { python: 'PY' } as const;

export function pythonDefaults(): Omit<PythonTool, 'id' | 'name' | 'hidden'> {
    return { type: 'python', color: 'blue', code: '' };
}

/** A stored python tool with every field it needs; null for other types. */
export function completePythonTool(src: Data): Omit<PythonTool, 'id' | 'name' | 'hidden'> | null {
    if (src.type !== 'python') return null;
    return {
        type: 'python',
        color: typeof src.color === 'string' && src.color.trim() ? src.color.trim() : 'blue',
        code: typeof src.code === 'string' ? normalizeCode(src.code) : '',
    };
}

/** The python tools of a chart, in their order. */
export function pythonTools(tools: unknown): PythonTool[] {
    if (!Array.isArray(tools)) return [];
    return tools.filter((t): t is PythonTool => !!t && typeof t === 'object' && (t as Data).type === 'python' && typeof (t as Data).code === 'string');
}

/**
 * `code` with every name `from` (a name the script reads or sets) written
 * `to`; the script as it was when it does not read as Python.
 */
export function renameInCode(code: string, from: string, to: string): string {
    let toks;
    try {
        toks = tokenize(code);
    } catch {
        return code;
    }
    const lines = code.split('\n');
    // Spots from the end, so earlier columns stay right.
    const spots: Array<{ line: number; col: number }> = [];
    toks.forEach((t, i) => {
        if (t.t !== 'name' || t.v !== from) return;
        const prev = toks[i - 1];
        const next = toks[i + 1];
        if (prev && prev.t === 'op' && prev.v === '.') return;
        // A keyword argument f(n=1) names the function's parameter, not the chart's n.
        if (next && next.t === 'op' && next.v === '=' && prev && prev.t === 'op' && (prev.v === '(' || prev.v === ',')) return;
        spots.push({ line: t.line, col: t.col });
    });
    for (const s of spots.reverse()) {
        const l = lines[s.line - 1];
        if (l === undefined || l.slice(s.col - 1, s.col - 1 + from.length) !== from) continue;
        lines[s.line - 1] = l.slice(0, s.col - 1) + to + l.slice(s.col - 1 + from.length);
    }
    return lines.join('\n');
}

/** Rename a chart name in a python tool (the modal's rename); false for other tools. */
export function renameInPythonTool(t: Tool, from: string, to: string): boolean {
    if (t.type !== 'python') return false;
    t.code = renameInCode(t.code, from, to);
    return true;
}
