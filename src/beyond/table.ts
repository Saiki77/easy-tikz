/*
 * Data from the note (5.0): the nearest Markdown table above a chart block
 * and the two columns a data set takes from it. The table is read where the
 * chart renders (a note in Reading view or Live Preview, the chart under a
 * block being edited, the editor opened from the block) and handed to the
 * chart as a side input on its MathContext: it is never written into the
 * block, so the block keeps `use the table above` and follows the table.
 * Pure: no DOM, no Obsidian.
 */

export interface NoteTable {
    /** Header cells, trimmed, as written. */
    headers: string[];
    /** Body rows, one cell per header ('' where a row has fewer cells). */
    rows: string[][];
}

/** The `>` markers of a callout or quote in front of a line, with their spaces. */
const QUOTE = /^(?:[ \t]*>[ ]?)*/;
/** An opening or closing code fence. */
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
/** A separator row: cells of dashes with optional colons for the alignment. */
const SEPARATOR_CELL = /^:?-+:?$/;

/** A line without the quote markers of a callout. */
function unquoted(line: string): string {
    return line.slice((QUOTE.exec(line)?.[0] ?? '').length);
}

/** The cells of a table row: split at `|` (not `\|`), the outer bars dropped, each cell trimmed. */
export function rowCells(row: string): string[] {
    let s = row.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const out: string[] = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\' && s[i + 1] === '|') {
            cur += '|';
            i++;
            continue;
        }
        if (c === '|') {
            out.push(cur.trim());
            cur = '';
            continue;
        }
        cur += c;
    }
    out.push(cur.trim());
    return out;
}

function isSeparator(line: string): boolean {
    if (!line.includes('-')) return false;
    const cells = rowCells(line);
    return cells.length > 0 && cells.every((c) => SEPARATOR_CELL.test(c)) && (line.includes('|') || cells.length > 1);
}

/** A table starting at `lines[i]` (its header row), and the index after its last row; null when none starts there. */
function tableAt(lines: string[], i: number, end: number): { table: NoteTable; next: number } | null {
    if (i + 1 >= end) return null;
    const head = lines[i];
    const sep = lines[i + 1];
    if (!head.includes('|') || !isSeparator(sep)) return null;
    const headers = rowCells(head);
    if (rowCells(sep).length !== headers.length) return null;
    const rows: string[][] = [];
    let k = i + 2;
    for (; k < end; k++) {
        const line = lines[k];
        if (!line.trim() || !line.includes('|')) break;
        const cells = rowCells(line);
        rows.push(headers.map((_, c) => cells[c] ?? ''));
    }
    return { table: { headers, rows }, next: k };
}

/**
 * The nearest Markdown table above the chart block whose opening fence is
 * on line `fenceLine` (1-based) of `lines`: a header row, a separator row
 * (`|---|:--:|`) and the body rows. Tables in other code blocks do not
 * count; tables in callouts and quotes do. Null when there is none.
 */
export function tableAbove(lines: readonly string[], fenceLine: number): NoteTable | null {
    const end = Math.max(0, Math.min(lines.length, fenceLine - 1));
    // The lines above the block, with those inside code blocks blanked out.
    const text: string[] = [];
    let fence: { mark: string; size: number } | null = null;
    for (let n = 0; n < end; n++) {
        const line = unquoted(lines[n] ?? '');
        const m = FENCE.exec(line);
        if (fence) {
            if (m && m[1][0] === fence.mark && m[1].length >= fence.size && !line.slice(m[0].length).trim()) fence = null;
            text.push('');
            continue;
        }
        if (m) {
            fence = { mark: m[1][0], size: m[1].length };
            text.push('');
            continue;
        }
        text.push(line);
    }
    let found: NoteTable | null = null;
    for (let i = 0; i < text.length; ) {
        const hit = tableAt(text, i, text.length);
        if (hit) {
            found = hit.table;
            i = hit.next;
        } else i++;
    }
    return found;
}

/** A short key that is the same for the same table (for caches). */
export function tableKey(table: NoteTable | null | undefined): string {
    if (table === undefined) return '-';
    if (table === null) return '0';
    const text = JSON.stringify([table.headers, table.rows]);
    // cyrb53: two 32-bit FNV-like lanes, mixed.
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `${text.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** Markdown emphasis, code or math around a cell's text: `**3**`, `` `3` ``, `$3$`. */
const WRAPPED = /^(\*\*|__|\*|_|`|\$)(.*)\1$/;

/** A cell's text without the Markdown around it, for numbers and header names. */
function bare(cell: string): string {
    let s = cell.trim();
    for (let k = 0; k < 4; k++) {
        const m = WRAPPED.exec(s);
        if (!m) break;
        s = m[2].trim();
    }
    return s;
}

/**
 * The number in a table cell, or null: `52`, `-3.5`, `−3.5` (a typeset
 * minus), `1e3`, `**7**`, `$2.5$`, and digits grouped by thin or plain
 * spaces (`12 500`).
 */
export function cellNumber(cell: string): number | null {
    let s = bare(cell).replace(/−/g, '-');
    if (/^[-+]?\d{1,3}(?:[ \u00a0\u2009\u202f]\d{3})+(?:\.\d+)?$/.test(s)) s = s.replace(/[ \u00a0\u2009\u202f]/g, '');
    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/** A header as names are compared: without Markdown, spaces collapsed, lower case. */
function headerKey(s: string): string {
    return bare(s).replace(/\s+/g, ' ').toLowerCase();
}

/** A header as an axis label: its text without Markdown. */
export function headerText(s: string): string {
    return bare(s).replace(/\s+/g, ' ');
}

/** Columns most of whose filled cells are numbers (at least one). */
export function numericColumns(table: NoteTable): number[] {
    const out: number[] = [];
    table.headers.forEach((_, c) => {
        let filled = 0;
        let numbers = 0;
        for (const row of table.rows) {
            const cell = (row[c] ?? '').trim();
            if (!cell) continue;
            filled++;
            if (cellNumber(cell) !== null) numbers++;
        }
        if (numbers > 0 && numbers * 2 >= filled) out.push(c);
    });
    return out;
}

/** The points a data set takes from a table, or why it cannot. */
export type TableData =
    | {
          ok: true;
          /** Column indices; x is -1 when the rows are numbered 1, 2, 3, ... (the table has one numeric column). */
          x: number;
          y: number;
          /** Headers of the columns, as axis labels ('' for numbered rows). */
          xName: string;
          yName: string;
          points: number[][];
          /** Rows left out because a used cell is not a number (rows with every cell empty do not count). */
          skipped: number;
      }
    | { ok: false; problem: 'noColumn'; column: string; columns: string[] }
    | { ok: false; problem: 'noNumbers'; columns: string[] };

/**
 * The x and y columns of a table: by header name (case and Markdown
 * ignored), else the first two numeric columns. A table with one numeric
 * column numbers its rows for x (1, 2, 3, ...). Rows with a non-number in a
 * used column are skipped and counted.
 */
export function tableData(table: NoteTable, xColumn: string, yColumn: string): TableData {
    const columns = table.headers.map(headerText);
    const find = (name: string): number => {
        const key = headerKey(name);
        return table.headers.findIndex((h) => headerKey(h) === key);
    };
    const xs = xColumn.trim();
    const ys = yColumn.trim();
    let x = -2;
    let y = -2;
    if (xs) {
        x = find(xs);
        if (x < 0) return { ok: false, problem: 'noColumn', column: xs, columns };
    }
    if (ys) {
        y = find(ys);
        if (y < 0) return { ok: false, problem: 'noColumn', column: ys, columns };
    }
    const numeric = numericColumns(table);
    if (x === -2 && y === -2) {
        if (numeric.length >= 2) [x, y] = [numeric[0], numeric[1]];
        else if (numeric.length === 1) [x, y] = [-1, numeric[0]];
        else return { ok: false, problem: 'noNumbers', columns };
    } else if (x === -2) {
        const other = numeric.find((c) => c !== y);
        x = other === undefined ? -1 : other;
    } else if (y === -2) {
        const other = numeric.find((c) => c !== x);
        if (other === undefined) return { ok: false, problem: 'noNumbers', columns };
        y = other;
    }
    const points: number[][] = [];
    let skipped = 0;
    let index = 0;
    for (const row of table.rows) {
        if (row.every((cell) => !cell.trim())) continue;
        index++;
        const vx = x < 0 ? index : cellNumber(row[x] ?? '');
        const vy = cellNumber(row[y] ?? '');
        if (vx === null || vy === null) {
            skipped++;
            continue;
        }
        points.push([vx, vy]);
    }
    return { ok: true, x, y, xName: x < 0 ? '' : columns[x], yName: columns[y], points, skipped };
}
