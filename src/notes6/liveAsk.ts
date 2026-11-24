/*
 * Ask the curve under a block in Live Preview (6.0 B): the answer goes into
 * the block's text in the editor, so it is one edit of the note (the
 * editor's Undo takes it back) and the chart under the block draws it at
 * once. A text block keeps its lines (src/text/print.ts writeChartText adds
 * the new ones), a JSON block is written as JSON. Sliders keep the values
 * the block stores, whatever the strip shows.
 */
import { EditorView } from '@codemirror/view';
import type { Parameter } from '../types';
import { chartFences } from '../text/fences';
import { writeChartText } from '../text/print';
import { minimize } from '../chartdata';

type Data = Record<string, unknown>;

const QUOTE = /^(?:[ \t]*>[ ]?)*/;

/** The block whose chart is drawn in `el` (under its closing fence): its body lines, and the quote markers they carry. */
function bodyRange(view: EditorView, el: HTMLElement, tag: string, source: string): { from: number; to: number; first: number; last: number; prefix: string } | null {
    let at: number;
    try {
        at = view.posAtDOM(el);
    } catch {
        return null;
    }
    const doc = view.state.doc;
    const fences = chartFences(doc.lines, (n) => doc.line(n).text, new Set([tag])).filter((f) => f.body === source);
    if (!fences.length) return null;
    // The block right above the chart: its last line ends where the widget sits.
    const fence = fences.reduce((best, f) => (Math.abs(doc.line(f.last).to - at) < Math.abs(doc.line(best.last).to - at) ? f : best));
    const prefix = QUOTE.exec(doc.line(fence.first).text)?.[0] ?? '';
    const lastBody = fence.closed ? fence.last - 1 : fence.last;
    if (lastBody < fence.first + 1) return { from: doc.line(fence.first).to, to: doc.line(fence.first).to, first: fence.first, last: fence.last, prefix };
    return { from: doc.line(fence.first + 1).from, to: doc.line(lastBody).to, first: fence.first, last: fence.last, prefix };
}

/**
 * Write `next` (the chart with the answer) into the block of `source` whose
 * chart is drawn in `el`. `saved`: the sliders as the block stores them.
 * False when the block is not found.
 */
export function writeAnswerIntoBlock(el: HTMLElement, tag: string, source: string, format: 'text' | 'json', blockData: Data, saved: Parameter[], next: Data): boolean {
    const host = el.closest<HTMLElement>('.cm-editor');
    const view = EditorView.findFromDOM(el) ?? (host ? EditorView.findFromDOM(host) : null);
    if (!view) return false;
    const range = bodyRange(view, el, tag, source);
    if (!range) return false;
    // New sliders come from the answer; the block's own keep their stored values.
    const own = new Set(saved.map((p) => p.name));
    const params = [...saved, ...(Array.isArray(next.parameters) ? (next.parameters as Parameter[]) : []).filter((p) => !own.has(p.name))];
    const chart: Data = { ...next, parameters: params };
    const body = format === 'text' ? writeChartText(source.replace(/\s+$/, ''), chart) : JSON.stringify(minimize({ ...blockData, functions: chart.functions, tools: chart.tools, annotations: chart.annotations, parameters: params }), null, 2);
    const text = body
        .split('\n')
        .map((line) => range.prefix + line)
        .join('\n');
    const empty = range.from === range.to && range.from === view.state.doc.line(range.first).to;
    view.dispatch({ changes: { from: range.from, to: range.to, insert: empty ? `\n${text}` : text } });
    return true;
}
