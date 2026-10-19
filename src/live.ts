/*
 * The chart under a block while you edit it. In Live Preview Obsidian shows
 * a code block's lines while the cursor is in it and its chart once the
 * cursor leaves; meanwhile this puts the chart right under the lines and
 * draws it again on every change, so it moves as you type (src/motion.ts:
 * numbers glide, new objects pop in, a half-typed line keeps its last
 * working version). Leaving the block hands the picture to the chart
 * Obsidian draws, so nothing jumps.
 */
import { EditorState, Extension, RangeSetBuilder, StateEffect, StateField, Text } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import { ChartFence, chartFences } from './text/fences';

/** What the plugin does for the chart under a block. */
export interface LiveHost {
    /** The setting is on. */
    enabled(): boolean;
    /** The fence languages charts are drawn for (easy-tikz, and tikz when that setting is on). */
    tags(): ReadonlySet<string>;
    /** Draw the chart of `body` into `el`, replacing the one drawn there before; `typed`: the block changed (not: the cursor came in). */
    draw(el: HTMLElement, sourcePath: string, tag: string, body: string, typed: boolean): void;
    /** `el` left the editor: let go of its chart. */
    release(el: HTMLElement): void;
}

class LiveChart extends WidgetType {
    constructor(
        private readonly host: LiveHost,
        readonly sourcePath: string,
        readonly tag: string,
        readonly body: string
    ) {
        super();
    }

    eq(other: LiveChart): boolean {
        return other.body === this.body && other.tag === this.tag && other.sourcePath === this.sourcePath;
    }

    toDOM(): HTMLElement {
        const el = createDiv({ cls: 'etz-live' });
        this.host.draw(el, this.sourcePath, this.tag, this.body, false);
        return el;
    }

    /** The block changed: the same element draws the new chart, which moves from the old one. */
    updateDOM(dom: HTMLElement): boolean {
        this.host.draw(dom, this.sourcePath, this.tag, this.body, true);
        return true;
    }

    destroy(dom: HTMLElement) {
        this.host.release(dom);
    }

    /** Sliders and the chart keep their pointer and keys: the cursor stays where it is. */
    ignoreEvent(): boolean {
        return true;
    }
}

/** The chart blocks of a document, found once per version of it. */
const found = new WeakMap<Text, ChartFence[]>();

function fencesOf(doc: Text, tags: ReadonlySet<string>): ChartFence[] {
    let fences = found.get(doc);
    if (!fences) {
        fences = chartFences(doc.lines, (n) => doc.line(n).text, tags);
        found.set(doc, fences);
    }
    return fences;
}

/** A chart under every chart block the selection is in (Obsidian shows those blocks as lines). */
function charts(state: EditorState, host: LiveHost): DecorationSet {
    if (!host.enabled() || !state.field(editorLivePreviewField, false)) return Decoration.none;
    const file = state.field(editorInfoField, false)?.file;
    if (!file) return Decoration.none;
    const { doc, selection } = state;
    const builder = new RangeSetBuilder<Decoration>();
    for (const fence of fencesOf(doc, host.tags())) {
        const from = doc.line(fence.first).from;
        const to = doc.line(fence.last).to;
        if (!selection.ranges.some((r) => r.from <= to && r.to >= from)) continue;
        builder.add(to, to, Decoration.widget({ widget: new LiveChart(host, file.path, fence.tag, fence.body), block: true, side: 1 }));
    }
    return builder.finish();
}

/** Look at the selection again (the mouse button came up). */
const refresh = StateEffect.define<null>();

/**
 * The mouse button is down in an editor: a click or a drag is still
 * choosing where the cursor goes. Obsidian keeps showing the blocks as they
 * are until it is up, and so do the charts under them; then both change in
 * the same frame.
 */
let pointerDown = false;

const pointer = EditorView.domEventHandlers({
    mousedown(event, view) {
        if (event.button !== 0) return false;
        pointerDown = true;
        const doc = view.dom.ownerDocument;
        const win = doc.defaultView;
        const up = () => {
            doc.removeEventListener('mouseup', up, true);
            doc.removeEventListener('pointercancel', up, true);
            win?.removeEventListener('blur', up);
            pointerDown = false;
            if (view.dom.isConnected) view.dispatch({ effects: refresh.of(null) });
        };
        doc.addEventListener('mouseup', up, true);
        doc.addEventListener('pointercancel', up, true);
        win?.addEventListener('blur', up);
        return false;
    },
});

/** The editor extension: block widgets come from a state field (CodeMirror takes them from nowhere else). */
export function editingCharts(host: LiveHost): Extension {
    const field = StateField.define<DecorationSet>({
        create: (state) => charts(state, host),
        update(value, tr) {
            if (tr.effects.some((e) => e.is(refresh))) return charts(tr.state, host);
            const toggled = tr.state.field(editorLivePreviewField, false) !== tr.startState.field(editorLivePreviewField, false);
            if (!tr.docChanged && !tr.selection && !toggled) return value;
            if (pointerDown && !tr.docChanged && !toggled) return value;
            return charts(tr.state, host);
        },
        provide: (f) => EditorView.decorations.from(f),
    });
    return [field, pointer];
}
