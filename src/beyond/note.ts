/*
 * A chart block in its note (5.0): whether its chart reads the table above
 * it, and that table, found from the note's text. The plugin reads it where
 * charts render (main.ts, src/live.ts) and again when the note changes, so a
 * chart follows its table. Pure: no DOM, no Obsidian.
 */
import { chartFences } from '../text/fences';
import { NoteTable, tableAbove } from './table';

/** Does a chart (block data, any version) have a data set that reads the note's table? */
export function readsTable(data: Record<string, unknown> | null | undefined): boolean {
    const tools = data && Array.isArray(data.tools) ? (data.tools as unknown[]) : [];
    return tools.some((t) => {
        if (!t || typeof t !== 'object') return false;
        const tool = t as Record<string, unknown>;
        // A data tool reads the table unless it lists its points (the default source is the table).
        return tool.type === 'data' && tool.source !== 'list';
    });
}

/** The lines of a note's text. */
export function noteLines(text: string): string[] {
    return text.split(/\r\n?|\n/);
}

/**
 * The table above the chart block whose body is `body`, in a note's text:
 * the block with that body nearest to line `near` (1-based, its opening
 * fence when it was last seen). Undefined when the note no longer has the
 * block (it is being edited: keep what the chart has).
 */
export function tableForBlock(text: string, body: string, near: number, tags: ReadonlySet<string>): { table: NoteTable | null; line: number } | undefined {
    const lines = noteLines(text);
    const want = body.replace(/\s+$/, '');
    const fences = chartFences(lines.length, (n) => lines[n - 1] ?? '', tags).filter((f) => f.body.replace(/\s+$/, '') === want);
    if (!fences.length) return undefined;
    let best = fences[0];
    for (const f of fences) if (Math.abs(f.first - near) < Math.abs(best.first - near)) best = f;
    return { table: tableAbove(lines, best.first), line: best.first };
}
