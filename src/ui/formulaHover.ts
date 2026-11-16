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
import type { Extension } from '@codemirror/state';
import { FormulaKind, applyFormulaDefault, chartable, formulaChart, formulaLines, formulasIn } from '../formula';
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
            m.dataset.etzMark = chartable(found[i].tex) ? '1' : '0';
        });
    }

    /**
     * Live Preview: the editor's rendered formulas learn whether they have a
     * chart, after each update of the editor (new formulas, a scroll, the
     * cursor leaving a formula). A formula is checked once per element.
     */
    editorMarks(): Extension {
        return ViewPlugin.fromClass(
            class {
                private frame = 0;
                constructor(private readonly view: EditorView) {
                    this.schedule();
                }
                update(u: ViewUpdate) {
                    if (u.docChanged || u.viewportChanged || u.selectionSet || u.geometryChanged) this.schedule();
                }
                destroy() {
                    if (this.frame) window.cancelAnimationFrame(this.frame);
                }
                private schedule() {
                    if (this.frame) return;
                    this.frame = window.requestAnimationFrame(() => {
                        this.frame = 0;
                        for (const math of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>('.math:not([data-etz-mark])'))) {
                            const found = formulaInEditor(this.view, math);
                            math.dataset.etzMark = found && chartable(found.tex) ? '1' : '0';
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
        if (math && math === this.target && this.pop) {
            this.cancelClose();
            return;
        }
        this.cancelOpen();
        if (!math) {
            if (this.pop) this.scheduleClose();
            return;
        }
        this.openTimer = window.setTimeout(() => this.open(math), OPEN_MS);
    }

    /** A tap on a formula (phones, where nothing hovers) opens its chart at once. */
    tap(e: MouseEvent): void {
        if (!this.host.enabled()) return;
        const math = e.target instanceof Element ? e.target.closest<HTMLElement>('.math') : null;
        if (math && !math.closest('.cm-editor')) this.open(math);
    }

    close(): void {
        this.cancelOpen();
        this.cancelClose();
        this.target?.removeClass('etz-formula-open');
        this.pop?.remove();
        this.pop = null;
        this.target = null;
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
        if (this.closeTimer !== null) return;
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
        const view = EditorView.findFromDOM(math);
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

    private open(math: HTMLElement) {
        this.cancelOpen();
        const found = this.find(math);
        if (!found || !chartable(found.tex)) return;
        const kind = formulaLines(found.tex)?.kind;
        const lines = formulaChart(found.tex);
        if (!lines || !kind) return;
        const parsed = parseChartText(lines.join('\n'));
        if (parsed.problems.length) return;
        this.close();
        this.target = math;
        math.addClass('etz-formula-open');
        const doc = math.ownerDocument;
        const pop = doc.body.createDiv({ cls: 'etz-formula-pop etz-tokens', attr: { role: 'dialog', 'aria-label': t('plugin.formula.dialog') } });
        this.pop = pop;
        pop.addEventListener('mouseleave', () => this.scheduleClose());
        pop.addEventListener('mouseenter', () => this.cancelClose());

        // The chart in the look of the default chart for formulas.
        const data = applyFormulaDefault(cloneData(parsed.data), this.host.formulaDefault());
        const is3D = data.dimension === true;
        const params = (Array.isArray(data.parameters) ? data.parameters : []) as Parameter[];

        // Head: the formula as the note shows it, what it is, and close.
        const head = pop.createDiv({ cls: 'etz-formula-head' });
        const texEl = head.createDiv({ cls: 'etz-formula-tex' });
        try {
            texEl.appendChild(renderMath(found.tex, false));
            void finishRenderMath();
        } catch {
            texEl.setText(found.tex);
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

/** The formula a rendered formula of the editor shows: its TeX, and the end of the line where it ends. */
function formulaInEditor(view: EditorView, math: HTMLElement): { tex: string; end: number } | null {
    let pos: number;
    try {
        pos = view.posAtDOM(math);
    } catch {
        return null;
    }
    const doc = view.state.doc;
    const lineAt = doc.lineAt(pos);
    // The formula around pos: inline on its line, or a $$ block that may span lines.
    const from = Math.max(0, lineAt.from - 2000);
    const to = Math.min(doc.length, lineAt.to + 2000);
    const text = doc.sliceString(from, to);
    for (const f of formulasIn(text)) {
        if (from + f.start <= pos && pos <= from + f.end) return { tex: f.tex, end: doc.lineAt(Math.min(doc.length, from + f.end)).to };
    }
    return null;
}
