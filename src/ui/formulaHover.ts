/*
 * Every formula in a note is a chart (5.0): rest the pointer on a `$...$`
 * or `$$...$$` formula, in Reading view or Live Preview (also in callouts,
 * lists and tables), and a card with its chart opens next to it: the
 * formula on top, the chart in the look of the default chart for formulas
 * (a setting), a slider for every letter (a setting too), and the buttons
 * Open in the editor and Insert chart. On a phone a tap opens it. The
 * formula's TeX comes from the note's text: Reading view marks each
 * rendered formula (tag), Live Preview asks the editor where it sits.
 * Formulas that have a chart carry data-etz-mark="1": with the setting
 * Highlight formulas in notes, a dotted line goes under them (formula.css).
 */
import { App, MarkdownPostProcessorContext, TFile, finishRenderMath, renderMath, setIcon } from 'obsidian';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { Extension, Text } from '@codemirror/state';
import { FormulaKind, applyFormulaDefault, chartable, formulaChart, formulaLines, formulaRows, formulasIn } from '../formula';
import { parseChartText } from '../text/parse';
import { printChartText } from '../text/print';
import { SettingsManager } from '../settings';
import { SVGRenderer } from '../renderer';
import { SVG3DRenderer } from '../renderer3d';
import { Parameter } from '../types';
import { cloneData } from '../util';
import { liveSlider, textButton } from './kit';
import { MessageKey, t } from '../i18n';

export interface FormulaHoverHost {
    /** The setting Charts for formulas. */
    enabled(): boolean;
    /** The setting Sliders in formula charts. */
    sliders(): boolean;
    /** The default chart for formulas (set up in the editor), or null for the plugin's own. */
    formulaDefault(): Record<string, unknown> | null;
    /** The setting Invert vertical drag in 3D: a drag in the card turns a surface as the editor's preview does. */
    invertDrag3D(): boolean;
    /** Open the editor on this chart. */
    openChart(data: Record<string, unknown>, file: TFile | null): void;
}

/** Where a formula sits, to read it and to write its chart under it. */
interface Found {
    tex: string;
    insert(block: string): void | Promise<unknown>;
    file: TFile | null;
}

/** How long the pointer rests on a formula before its chart opens, and the grace to move onto the card. */
const OPEN_MS = 350;
const CLOSE_MS = 300;

const KIND_LABEL: Record<FormulaKind, MessageKey> = {
    function: 'plugin.formula.kind.function',
    surface: 'plugin.formula.kind.surface',
    polar: 'plugin.formula.kind.polar',
    equation: 'plugin.formula.kind.equation',
    region: 'plugin.formula.kind.region',
};

export class FormulaHover {
    private pop: HTMLElement | null = null;
    private target: HTMLElement | null = null;
    /** The row of an aligned block whose chart is open (undefined: the whole formula). */
    private row: number | undefined = undefined;
    /** What is tinted while the card is open: the formula, or its row. */
    private lit: HTMLElement | null = null;
    /** The card was used (a drag, a slider, a click in it): it stays open until a click outside, Esc or another formula. */
    private held = false;
    private openTimer: number | null = null;
    private closeTimer: number | null = null;

    constructor(
        private readonly app: App,
        private readonly host: FormulaHoverHost
    ) {}

    /** Reading view: each rendered formula of a section learns its TeX and the line its chart goes under. */
    tag(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
        const maths = Array.from(el.querySelectorAll<HTMLElement>('.math'));
        if (!maths.length) return;
        const info = ctx.getSectionInfo(el);
        if (!info) return;
        const text = info.text.split('\n').slice(info.lineStart, info.lineEnd + 1).join('\n');
        const found = formulasIn(text);
        maths.forEach((m, i) => {
            if (!found[i]) return;
            m.dataset.etzTex = found[i].tex;
            m.dataset.etzLine = String(info.lineEnd);
            m.dataset.etzPath = ctx.sourcePath;
            markMath(m, found[i].tex);
        });
        // MathJax may draw a formula after this (its first load): mark it again then.
        if (maths.some((m) => !m.querySelector('mjx-math'))) {
            window.setTimeout(() => {
                for (const m of maths) if (m.dataset.etzTex !== undefined && m.dataset.etzSeen !== drawnAs(m)) markMath(m, m.dataset.etzTex);
            }, 1500);
        }
    }

    /**
     * Live Preview: the editor's rendered formulas learn whether they have a
     * chart, after each update of the editor (new formulas, a scroll, the
     * cursor leaving a formula). A formula is checked again when MathJax
     * draws it anew (it may draw a block's rows after the mark was set).
     */
    editorMarks(): Extension {
        return ViewPlugin.fromClass(
            class {
                private frame = 0;
                /** Check every formula at the next frame, also the marked ones. */
                private all = false;
                constructor(private readonly view: EditorView) {
                    // A new editor, or the plugin loaded again in an open note (an update): the marks an earlier
                    // version left are checked anew, so a changed rule shows without reopening the note (5.2.1).
                    this.schedule(true);
                }
                update(u: ViewUpdate) {
                    if (u.docChanged || u.viewportChanged || u.selectionSet || u.geometryChanged) this.schedule(false);
                }
                destroy() {
                    if (this.frame) window.cancelAnimationFrame(this.frame);
                }
                private schedule(all: boolean) {
                    this.all = this.all || all;
                    if (this.frame) return;
                    this.frame = window.requestAnimationFrame(() => {
                        this.frame = 0;
                        const all = this.all;
                        this.all = false;
                        for (const math of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>('.math'))) {
                            if (!all && math.dataset.etzMark !== undefined && math.dataset.etzSeen === drawnAs(math)) continue;
                            const found = formulaInEditor(this.view, math);
                            markMath(math, found ? found.tex : null);
                        }
                    });
                }
            }
        );
    }

    /** The pointer moved: open the chart of the formula under it after a short rest, or start closing. */
    over(e: MouseEvent): void {
        if (!this.host.enabled()) return;
        const el = e.target instanceof Element ? e.target : null;
        if (el && this.pop && this.pop.contains(el)) {
            this.cancelClose();
            return;
        }
        const math = el ? el.closest<HTMLElement>('.math') : null;
        const row = math ? rowAt(el, math) : undefined;
        if (math && math === this.target && this.pop) {
            this.cancelClose();
            // Another row of an aligned block: its own chart, after the same rest.
            if (row === this.row) return;
            this.cancelOpen();
            this.openTimer = window.setTimeout(() => this.open(math, row), OPEN_MS);
            return;
        }
        this.cancelOpen();
        if (!math) {
            if (this.pop) this.scheduleClose();
            return;
        }
        this.openTimer = window.setTimeout(() => this.open(math, row), OPEN_MS);
    }

    /** A tap on a formula (phones, where nothing hovers) opens its chart at once. */
    tap(e: MouseEvent): void {
        if (!this.host.enabled()) return;
        const math = e.target instanceof Element ? e.target.closest<HTMLElement>('.math') : null;
        if (math && !math.closest('.cm-editor')) this.open(math, rowAt(e.target instanceof Element ? e.target : null, math));
    }

    /** A press outside the card closes it (also a card that was used). */
    press(e: PointerEvent): void {
        if (this.pop && !(e.target instanceof Node && this.pop.contains(e.target))) this.close();
    }

    close(): void {
        this.cancelOpen();
        this.cancelClose();
        this.lit?.removeClass('etz-formula-open');
        this.lit = null;
        this.pop?.remove();
        this.pop = null;
        this.target = null;
        this.row = undefined;
        this.held = false;
    }

    private cancelOpen() {
        if (this.openTimer !== null) window.clearTimeout(this.openTimer);
        this.openTimer = null;
    }

    private cancelClose() {
        if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
        this.closeTimer = null;
    }

    private scheduleClose() {
        if (this.closeTimer !== null || this.held) return;
        this.closeTimer = window.setTimeout(() => this.close(), CLOSE_MS);
    }

    /** The formula an element shows: from Reading view's marks, or from the editor in Live Preview. */
    private find(math: HTMLElement): Found | null {
        if (math.dataset.etzTex !== undefined) {
            const file = this.app.vault.getAbstractFileByPath(math.dataset.etzPath ?? '');
            const line = Number(math.dataset.etzLine);
            if (!(file instanceof TFile) || !Number.isFinite(line)) return null;
            return {
                tex: math.dataset.etzTex,
                file,
                insert: (b) =>
                    this.app.vault.process(file, (data) => {
                        const lines = data.split('\n');
                        lines.splice(Math.min(line + 1, lines.length), 0, '', b);
                        return lines.join('\n');
                    }),
            };
        }
        // A table's cells have editors of their own: the note's editor is the one around the table. A formula
        // in a callout is no part of the editor itself: its editor is the one around it.
        const table = math.closest('table');
        const host = (table ?? math).closest<HTMLElement>('.cm-editor');
        const view = host ? EditorView.findFromDOM(host) : EditorView.findFromDOM(math);
        if (!view) return null;
        const found = formulaInEditor(view, math);
        if (!found) return null;
        const { tex, end } = found;
        const doc = view.state.doc;
        // Under the paragraph: the first empty line after the formula, or the end of the note.
        let line = doc.lineAt(end);
        while (line.number < doc.lines && doc.line(line.number + 1).text.trim() !== '') line = doc.line(line.number + 1);
        const at = line.to;
        const file = this.app.workspace.getActiveFile();
        return { tex, file, insert: (b) => view.dispatch({ changes: { from: at, insert: `\n\n${b}` } }) };
    }

    private open(math: HTMLElement, row?: number) {
        this.cancelOpen();
        const found = this.find(math);
        const rows = found ? formulaRows(found.tex) : [];
        const drawnRows = rows.length > 1 ? rowsOf(math) : [];
        const byRow = rows.length > 1 && drawnRows.length === rows.length;
        // A block of rows opens the chart of the row under the pointer, never all rows at once.
        const pick = byRow && row !== undefined && rows[row] !== undefined ? row : undefined;
        if (!found || (byRow && pick === undefined) || !chartable(found.tex, pick)) {
            // A row without a chart: the card of another row of the block closes.
            if (this.pop && this.target === math) this.scheduleClose();
            return;
        }
        const kind = formulaLines(found.tex, pick)?.kind;
        const lines = formulaChart(found.tex, pick);
        if (!lines || !kind) return;
        const parsed = parseChartText(lines.join('\n'));
        if (parsed.problems.length) return;
        this.close();
        this.target = math;
        this.row = row;
        this.lit = (pick !== undefined ? drawnRows[pick] : undefined) ?? math;
        this.lit.addClass('etz-formula-open');
        const doc = math.ownerDocument;
        const pop = doc.body.createDiv({ cls: 'etz-formula-pop etz-tokens', attr: { role: 'dialog', 'aria-label': t('plugin.formula.dialog') } });
        this.pop = pop;
        pop.addEventListener('mouseleave', () => this.scheduleClose());
        // A drag or a slider often ends outside the card: once used, the card stays open.
        pop.addEventListener('pointerdown', () => (this.held = true));
        pop.addEventListener('mouseenter', () => this.cancelClose());

        // The chart in the look of the default chart for formulas.
        const data = applyFormulaDefault(cloneData(parsed.data), this.host.formulaDefault());
        const is3D = data.dimension === true;
        const params = (Array.isArray(data.parameters) ? data.parameters : []) as Parameter[];

        // Head: the formula as the note shows it, what it is, and close.
        const head = pop.createDiv({ cls: 'etz-formula-head' });
        const texEl = head.createDiv({ cls: 'etz-formula-tex' });
        const shown = pick !== undefined ? rows[pick] : found.tex;
        try {
            texEl.appendChild(renderMath(shown, false));
            void finishRenderMath();
        } catch {
            texEl.setText(shown);
        }
        head.createSpan({ cls: 'etz-formula-kind', text: t(KIND_LABEL[kind]) });
        const close = head.createEl('button', { cls: 'etz-formula-close clickable-icon', attr: { type: 'button', 'aria-label': t('common.close') } });
        setIcon(close, 'x');
        close.addEventListener('click', () => this.close());

        const chartBox = pop.createDiv({ cls: 'etz-formula-chart' });
        const draw = () => {
            chartBox.empty();
            const view = cloneData(data);
            Object.assign(view, { previewSize: 340, parameters: params, size_x_cm: 8, size_y_cm: is3D ? 6 : 5.5 });
            const settings = SettingsManager.fromJSON(view);
            const ctx = settings.createMathContext({ memo: false });
            ctx.setParams(params);
            const config = settings.toRendererConfig(ctx);
            try {
                if (is3D) {
                    const r = new SVG3DRenderer();
                    chartBox.appendChild(r.getElement());
                    r.renderCanvas(config, { math: ctx });
                } else {
                    chartBox.appendChild(new SVGRenderer(config, { math: ctx }).render());
                }
            } catch {
                chartBox.setText(t('plugin.formula.cannotDraw'));
            }
        };
        draw();
        this.movable(chartBox, data, is3D, draw);

        // A slider for every letter of the formula (the setting may hide them): the chart follows.
        if (params.length && this.host.sliders()) {
            const sliders = pop.createDiv({ cls: 'etz-formula-sliders' });
            for (const p of params) {
                const row = sliders.createDiv({ cls: 'etz-formula-slider' });
                row.createSpan({ cls: 'etz-formula-name', text: p.name });
                liveSlider(row, {
                    min: Number(p.min),
                    max: Number(p.max),
                    step: Number(p.step) || 0.1,
                    value: Number(p.value),
                    label: p.name,
                    onInput: (v) => {
                        p.value = v;
                        draw();
                    },
                });
            }
        }

        const foot = pop.createDiv({ cls: 'etz-formula-foot' });
        const withValues = () => ({ ...data, parameters: params.map((p) => ({ ...p })) });
        textButton(foot, {
            text: t('plugin.formula.open'),
            icon: 'pencil',
            size: 'sm',
            onClick: () => {
                this.close();
                this.host.openChart(withValues(), found.file);
            },
        });
        textButton(foot, {
            text: t('plugin.formula.insert'),
            icon: 'plus',
            variant: 'cta',
            size: 'sm',
            onClick: () => {
                this.close();
                void found.insert(['```easy-tikz', printChartText(withValues()), '```'].join('\n'));
            },
        });
        this.place(pop, math);
    }

    /**
     * The chart of the card moves under the pointer: a drag pans it (2D) or
     * turns it (3D), the wheel zooms (about the pointer in 2D), a double click
     * goes back to where it started. Insert chart then writes this view.
     */
    private movable(box: HTMLElement, data: Record<string, unknown>, is3D: boolean, draw: () => void) {
        const win = box.ownerDocument.defaultView ?? window;
        const num = (v: unknown, d: number) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : d;
        };
        const round = (v: number) => Math.round(v * 1e4) / 1e4;
        const home = { xmin: data.xmin, xmax: data.xmax, ymin: data.ymin, ymax: data.ymax, rotationX: data.rotationX, rotationZ: data.rotationZ, zoom3D: data.zoom3D };
        let frame = 0;
        const redraw = () => {
            if (frame) return;
            frame = win.requestAnimationFrame(() => {
                frame = 0;
                if (box.isConnected) draw();
            });
        };
        box.addEventListener(
            'wheel',
            (e) => {
                e.preventDefault();
                const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
                if (is3D) {
                    data.zoom3D = round(Math.min(4, Math.max(0.3, num(data.zoom3D, 1) / k)));
                } else {
                    const r = box.getBoundingClientRect();
                    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
                    const fy = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
                    const [x0, x1, y0, y1] = [num(data.xmin, -5), num(data.xmax, 5), num(data.ymin, -5), num(data.ymax, 5)];
                    const cx = x0 + fx * (x1 - x0);
                    const cy = y0 + fy * (y1 - y0);
                    Object.assign(data, { xmin: round(cx - (cx - x0) * k), xmax: round(cx + (x1 - cx) * k), ymin: round(cy - (cy - y0) * k), ymax: round(cy + (y1 - cy) * k) });
                }
                redraw();
            },
            { passive: false }
        );
        let last: { x: number; y: number } | null = null;
        box.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            last = { x: e.clientX, y: e.clientY };
            box.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        box.addEventListener('pointermove', (e) => {
            if (!last) return;
            const dx = e.clientX - last.x;
            const dy = e.clientY - last.y;
            last = { x: e.clientX, y: e.clientY };
            if (is3D) {
                // As in the editor's preview: the same rates, and the setting Invert vertical drag in 3D.
                data.rotationZ = Math.round((((num(data.rotationZ, 45) + dx * 0.5) % 360) + 360) % 360);
                const tilt = this.host.invertDrag3D() ? dy : -dy;
                data.rotationX = Math.round(Math.min(90, Math.max(0, num(data.rotationX, 30) + tilt * 0.3)));
            } else {
                const r = box.getBoundingClientRect();
                const ux = (num(data.xmax, 5) - num(data.xmin, -5)) / Math.max(1, r.width);
                const uy = (num(data.ymax, 5) - num(data.ymin, -5)) / Math.max(1, r.height);
                Object.assign(data, {
                    xmin: round(num(data.xmin, -5) - dx * ux),
                    xmax: round(num(data.xmax, 5) - dx * ux),
                    ymin: round(num(data.ymin, -5) + dy * uy),
                    ymax: round(num(data.ymax, 5) + dy * uy),
                });
            }
            redraw();
        });
        const end = (e: PointerEvent) => {
            last = null;
            if (box.hasPointerCapture(e.pointerId)) box.releasePointerCapture(e.pointerId);
        };
        box.addEventListener('pointerup', end);
        box.addEventListener('pointercancel', end);
        box.addEventListener('dblclick', () => {
            Object.assign(data, home);
            redraw();
        });
    }

    /** Below the formula, or above it when the window ends; never past its sides. */
    private place(pop: HTMLElement, math: HTMLElement) {
        const win = math.ownerDocument.defaultView ?? window;
        const r = math.getBoundingClientRect();
        const w = pop.offsetWidth;
        const h = pop.offsetHeight;
        const margin = 8;
        const left = Math.max(margin, Math.min(r.left, win.innerWidth - w - margin));
        const below = r.bottom + margin;
        const above = below + h > win.innerHeight - margin && r.top - margin - h > margin;
        const top = above ? r.top - margin - h : Math.min(below, win.innerHeight - h - margin);
        pop.toggleClass('is-above', above);
        pop.setCssStyles({ left: `${Math.round(left)}px`, top: `${Math.round(Math.max(margin, top))}px` });
    }
}

/** The formulas of a note's text, worked out once per version of the text (the editor's text never changes in place). */
const docFormulas = new WeakMap<Text, Array<{ tex: string; start: number; end: number }>>();

function formulasOfDoc(doc: Text): Array<{ tex: string; start: number; end: number }> {
    let found = docFormulas.get(doc);
    if (!found) {
        found = formulasIn(doc.toString());
        docFormulas.set(doc, found);
    }
    return found;
}

/** The rows of an aligned block as MathJax draws them (the rows of its outer table), or none. */
function rowsOf(math: HTMLElement): HTMLElement[] {
    const table = math.querySelector('mjx-itable');
    return table ? Array.from(table.querySelectorAll<HTMLElement>(':scope > mjx-mtr, :scope > mjx-mlabeledtr')) : [];
}

/** How MathJax has drawn a formula so far (drawn or not, how many rows): a change means mark it again. */
function drawnAs(math: HTMLElement): string {
    return math.querySelector('mjx-math') ? `rows ${math.querySelectorAll('mjx-mtr, mjx-mlabeledtr').length}` : 'not drawn';
}

/** The row of an aligned block under the pointer, or undefined. */
function rowAt(el: Element | null, math: HTMLElement): number | undefined {
    if (!el) return undefined;
    const i = rowsOf(math).findIndex((r) => r.contains(el));
    return i < 0 ? undefined : i;
}

/**
 * Mark a formula that has a chart (data-etz-mark="1"). In a block of rows
 * that MathJax draws as rows, the rows with a chart are marked instead
 * ("rows" on the formula), so the line runs only under rows that open one.
 */
function markMath(math: HTMLElement, tex: string | null): void {
    math.dataset.etzSeen = drawnAs(math);
    if (!tex) {
        math.dataset.etzMark = '0';
        return;
    }
    const rows = formulaRows(tex);
    const drawn = rows.length > 1 ? rowsOf(math) : [];
    if (rows.length > 1 && drawn.length === rows.length) {
        let any = false;
        drawn.forEach((tr, i) => {
            const ok = chartable(tex, i);
            tr.dataset.etzMark = ok ? '1' : '0';
            any = any || ok;
        });
        math.dataset.etzMark = any ? 'rows' : '0';
        return;
    }
    math.dataset.etzMark = chartable(tex) ? '1' : '0';
}

/** The formula a rendered formula of the editor shows: its TeX, and the end of the line where it ends. */
function formulaInEditor(view: EditorView, math: HTMLElement): { tex: string; end: number } | null {
    // Live Preview draws a table or a callout as one widget: every place in it is the widget's start. The
    // formula is the one at the same place among the formulas of the widget's lines.
    const table = math.closest('table');
    const widget = table ?? math.closest<HTMLElement>('.cm-callout');
    if (widget) {
        let at: number;
        try {
            at = view.posAtDOM(widget);
        } catch {
            return null;
        }
        const doc = view.state.doc;
        const inside = table ? /^\s*(?:>\s*)*\|/ : /^\s*>/;
        let first = doc.lineAt(Math.min(at, doc.length));
        while (first.number < doc.lines && !inside.test(first.text)) first = doc.line(first.number + 1);
        while (first.number > 1 && inside.test(doc.line(first.number - 1).text)) first = doc.line(first.number - 1);
        let last = first;
        while (last.number < doc.lines && inside.test(doc.line(last.number + 1).text)) last = doc.line(last.number + 1);
        // Without the > of a callout, so a $$ block over its lines reads as one formula.
        const text = doc
            .sliceString(first.from, last.to)
            .split('\n')
            .map((l) => l.replace(/^\s*(?:>\s?)*/, ''))
            .join('\n');
        const index = Array.from(widget.querySelectorAll('.math')).indexOf(math);
        const found = formulasIn(text)[index];
        return found ? { tex: found.tex, end: last.to } : null;
    }
    let pos: number;
    try {
        pos = view.posAtDOM(math);
    } catch {
        return null;
    }
    // The formula around pos, among the formulas of the whole note: a part of the note could cut a $$ block
    // in two, and the $$ would then pair up wrong.
    const doc = view.state.doc;
    for (const f of formulasOfDoc(doc)) {
        if (f.start <= pos && pos <= f.end) return { tex: f.tex, end: doc.lineAt(Math.min(doc.length, f.end)).to };
    }
    return null;
}
