/*
 * A chart from pasted text (6.2.1, issue #10): what the clipboard holds
 * when someone pastes into the editor, picks "Paste a chart" or runs "New
 * chart from the clipboard", and what the AI tab's "Paste the chart" reads
 * (moved here from src/ui/aiPanel.ts). The text may be a whole
 * ```easy-tikz block (from a note or a chat, with words around it), the
 * lines alone (words or Full LaTeX), or a JSON chart. Without a fence, only
 * text that reads as a chart counts: no problems, at least one line that
 * draws something. Pure: no DOM, no Obsidian.
 */
import { blocksOf } from '../ai/charttool';
import { parseChartText } from './parse';
import { impliedV4, parseLenientJson } from '../blockjson';
import { t } from '../i18n';

type Data = Record<string, unknown>;

/** The lists of a chart that draw something (sliders alone draw nothing). */
const DRAWING_LISTS = ['functions', 'functions3D', 'tools', 'annotations'];

/** The chart has a line that draws something. */
function draws(data: Data): boolean {
    return DRAWING_LISTS.some((k) => {
        const items = data[k];
        return Array.isArray(items) && items.length > 0;
    });
}

/** What pasted text holds. */
export type Pasted =
    /** A chart, ready to open. */
    | { kind: 'chart'; data: Data }
    /** Meant as a chart (a fenced block or a JSON chart, or, asked for, lines that draw), but with a problem: the message says which. */
    | { kind: 'problem'; message: string }
    /** No chart: text of another kind, which pastes as before. */
    | { kind: 'none' };

/**
 * The chart in pasted text. `asked`: the reader asked for a chart (the
 * menu, the command), so lines that draw but have a problem name the
 * problem; a paste with Cmd/Ctrl+V lets such text be.
 */
export function readPasted(text: string, asked = false): Pasted {
    const trimmed = text.trim();
    if (!trimmed) return { kind: 'none' };
    // blocksOf hands back JSON text as a block of its own (line 0): a fence is a block on a line of the text.
    const blocks = blocksOf(trimmed).filter((b) => b.line > 0);
    const fenced = blocks.length > 0;
    const body = fenced ? blocks[0].text : trimmed;
    if (body.trim().startsWith('{')) {
        let parsed: unknown;
        try {
            parsed = parseLenientJson(body);
        } catch (e) {
            return fenced ? { kind: 'problem', message: t('panels.ai.notJson', { message: e instanceof Error ? e.message : String(e) }) } : { kind: 'none' };
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fenced ? { kind: 'problem', message: t('panels.ai.notObject') } : { kind: 'none' };
        const chart = parsed as Data;
        // Unfenced JSON counts only when it is a chart: version 4, or what a chart without "v" holds.
        if (!fenced && chart.v !== 4 && !impliedV4(chart)) return { kind: 'none' };
        if (!draws(chart)) return fenced ? { kind: 'problem', message: t('panels.ai.empty') } : { kind: 'none' };
        return { kind: 'chart', data: impliedV4(chart) ? { v: 4, ...chart } : chart };
    }
    const read = parseChartText(body);
    const drawing = draws(read.data);
    if (read.problems.length) {
        if (!fenced && !(asked && drawing)) return { kind: 'none' };
        const p = read.problems[0];
        return { kind: 'problem', message: t('panels.ai.problems', { count: read.problems.length, line: p.line, column: p.column, message: p.message }) };
    }
    if (!drawing) return fenced ? { kind: 'problem', message: t('panels.ai.empty') } : { kind: 'none' };
    return { kind: 'chart', data: read.data };
}

/** What the reader is told when they asked for the chart on the clipboard and it holds none (`text`: what it holds). */
export function pasteMessage(pasted: Pasted, text: string): string {
    if (pasted.kind === 'problem') return pasted.message;
    return text.trim() ? t('editor.paste.noChart') : t('panels.ai.clipboardEmpty');
}

/** The chart of the first easy-tikz block in `text` (or of `text` itself), text or JSON, as a note would read it (the AI tab's Paste the chart). */
export function chartFromText(text: string): Data | string {
    const trimmed = text.trim();
    if (!trimmed) return t('panels.ai.clipboardEmpty');
    const blocks = blocksOf(trimmed);
    const body = blocks.length ? blocks[0].text : trimmed;
    if (body.trim().startsWith('{')) {
        let data: unknown;
        try {
            data = parseLenientJson(body);
        } catch (e) {
            return t('panels.ai.notJson', { message: e instanceof Error ? e.message : String(e) });
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return t('panels.ai.notObject');
        const chart = data as Data;
        return impliedV4(chart) ? { v: 4, ...chart } : chart;
    }
    // Text: one line per object. Outside a fence only text that reads as a chart counts.
    const parsed = parseChartText(body);
    const objects = ['parameters', ...DRAWING_LISTS].some((k) => {
        const items = parsed.data[k];
        return Array.isArray(items) && items.length > 0;
    });
    if (!blocks.length && (parsed.problems.length || !objects)) {
        return t('panels.ai.noChart');
    }
    if (parsed.problems.length) {
        const p = parsed.problems[0];
        return t('panels.ai.problems', { count: parsed.problems.length, line: p.line, column: p.column, message: p.message });
    }
    if (!objects) return t('panels.ai.empty');
    return parsed.data;
}
