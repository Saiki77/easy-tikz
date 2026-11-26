/*
 * Every formula in a note is a chart (5.0): rest the pointer on a `$...$`
 * or `$$...$$` formula, in Reading view or Live Preview (also in callouts,
 * lists and tables), and a card with its chart opens next to it: the
 * chart in the look of the default chart for formulas (a setting), a slider
 * for every letter (a setting too), and the buttons Open in the editor and
 * Insert chart, small at the bottom. 6.0.1, clean look: no header (the note
 * already highlights the formula); a close button shows on hover or focus
 * (always on touch screens); a function's chart is framed on its roots,
 * extrema and y-intercept, with dots on the roots (pink) and extrema
 * (violet) (src/notes6/frame.ts). On a phone a tap opens it. The
 * formula's TeX comes from the note's text: Reading view marks each
 * rendered formula (tag), Live Preview asks the editor where it sits.
 * Formulas that have a chart carry data-etz-mark="1": with the setting
 * Highlight formulas in notes, a dotted line goes under them (formula.css).
 * 6.2: the setting Formula recognition decides which formulas have one:
 * Smart (default), a hand-designed network that reads the formula, the
 * words around it and the note's other formulas (src/notes6/recognize), or
 * Rules, the builders' own checks as in 6.1. 6.2.1: a concrete vector opens
 * the vector card (src/linear/vector.ts: its arrow, a sum tip to tail, both
 * arrows of a product), under Smart only.
 */
import { App, MarkdownPostProcessorContext, Platform, TFile, editorInfoField, finishRenderMath, renderMath, setIcon } from 'obsidian';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { Extension, Text } from '@codemirror/state';
import { FormulaKind, applyFormulaDefault, chartable, formulaRows, formulasIn } from '../formula';
import { parseChartText } from '../text/parse';
import { printChartText } from '../text/print';
import { SettingsManager } from '../settings';
import { SVGRenderer } from '../renderer';
import { SVG3DRenderer } from '../renderer3d';
import { Parameter } from '../types';
import { cloneData } from '../util';
import { liveSlider, textButton, uniqueId, visuallyHidden } from './kit';
import { MessageKey, t } from '../i18n';
// 6.0 B: sets, maps, conditions, intervals, Jensen and epigraphs (src/notes6/hover.ts).
import { HoverCard, HoverKind, NoteDefinition, hoverCard, hoverKind, noteDefinitions } from '../notes6/hover';
// 6.0.1, clean look: the view framed on what matters, and the dots of roots and extrema.
import { frameChart, keyDots } from '../notes6/frame';
// 6.0 D: matrices, A v, det A and A v = λ v (src/linear/hover.ts).
import { LinearHoverCard, LinearHoverKind, linearHoverCard, linearHoverKind, noteValues } from '../linear/hover';
// 6.0 E: recurrences, sums and functions of z (src/iterate/hover.ts).
import { IterateHoverCard, IterateHoverKind, iterateHoverCard } from '../iterate/hover';
// 6.2: formula recognition, the network that decides which card a formula opens (src/notes6/recognize).
import { recognizeCached } from '../notes6/recognize';
import { NoteContext, formulaContext, noteFacts, noteVectors } from '../notes6/recognize/context';
import { definedFunctions, groupOf, noteDomains } from '../notes6/recognize/adapt';
import { ChartCard, RecognitionMode, chartCard, rulesMark, smartChart, smartIterate, smartLinear, smartMark, smartNotes6, smartVector } from '../notes6/recognize/decide';
// 6.2.1: concrete vectors, their sums and products (src/linear/vector.ts).
import { NoteVector, VectorHoverCard, VectorShape } from '../linear/vector';

export interface FormulaHoverHost {
    /** The setting Charts for formulas. */
    enabled(): boolean;
    /** The setting Sliders in formula charts. */
    sliders(): boolean;
    /** The default chart for formulas (set up in the editor), or null for the plugin's own. */
    formulaDefault(): Record<string, unknown> | null;
    /** The setting Invert vertical drag in 3D: a drag in the card turns a surface as the editor's preview does. */
    invertDrag3D(): boolean;
    /** 6.2: the setting Formula recognition: Smart (the network) or Rules (as 6.1). */
    recognition(): RecognitionMode;
    /** Open the editor on this chart. */
    openChart(data: Record<string, unknown>, file: TFile | null): void;
}

/** Where a formula sits, to read it and to write its chart under it. */
interface Found {
    tex: string;
    insert(block: string): void | Promise<unknown>;
    file: TFile | null;
    /** 6.0 B: the note's text, for the definitions a formula uses (g(x) = ... elsewhere in the note). */
    note(): Promise<string>;
    /** 6.2: what formula recognition reads around it (the words around it, the note's name and definitions). */
    ctx?: NoteContext;
}

/** Where a card opens: the formula, the row under the pointer, the row picked, the rows MathJax drew. */
interface Place {
    math: HTMLElement;
    row: number | undefined;
    pick: number | undefined;
    drawnRows: HTMLElement[];
}

/** How a card that needs the note's text ended: shown, none to show, or the pointer moved on meanwhile. */
type Opened = 'shown' | 'none' | 'stale';

/** 6.2, Reading view: what formula recognition reads around each drawn formula (set when the section is drawn). */
const mathContexts = new WeakMap<HTMLElement, NoteContext>();

/** 6.0 B: what a card shows besides its chart: one grey line (where g comes from, or what to move), the n = 2 chart. */
interface CardExtra {
    note: string;
    two: Record<string, unknown> | null;
    /** 6.0.1: where g comes from, as one line with the formula in math: g(x) = x^2 - 4, from this note. */
    from?: { name: string; body: string; example: boolean };
    /** 6.0.1: the line under it while n = 2 shows: what n = 2 means. */
    plane?: string;
    /** 6.2.1: the note's vectors a vector card uses, each a line with its formula in math: \vec a = (1, 2, 3), from this note. */
    fromNote?: string[];
}

/** 6.0.1: what a card draws besides its chart's own lines. */
interface CardDraw {
    /** The dots of the roots and extrema (function cards). */
    dots?: boolean;
}

const NOTES6_KIND: Record<HoverKind, MessageKey> = {
    set: 'notes6.hover.kind.set',
    map: 'notes6.hover.kind.map',
    condition: 'notes6.hover.kind.condition',
    interval: 'notes6.hover.kind.interval',
    jensen: 'notes6.hover.kind.jensen',
    epigraph: 'notes6.hover.kind.epigraph',
};

/** 6.0 D: what a card of src/linear/hover.ts is. */
const LINEAR_KIND: Record<LinearHoverKind, MessageKey> = {
    matrix: 'linear.hover.kind.matrix',
    product: 'linear.hover.kind.product',
    det: 'linear.hover.kind.det',
    eigen: 'linear.hover.kind.eigen',
};

/** 6.2.1: what a vector card draws. */
const VECTOR_KIND: Record<VectorShape, MessageKey> = {
    one: 'linear.hover.kind.vector',
    sum: 'linear.hover.kind.vectorSum',
    multiple: 'linear.hover.kind.vectorMultiple',
    dot: 'linear.hover.kind.dot',
    cross: 'linear.hover.kind.cross',
    list: 'linear.hover.kind.vectors',
};

/** 6.0 E: what each card of src/iterate/hover.ts is. */
const ITERATE_KIND: Record<IterateHoverKind, MessageKey> = {
    recurrence: 'iterate.hover.recurrence',
    sum: 'iterate.hover.sum',
    domain: 'iterate.hover.domain',
};

/** 6.0.1: the grey line of a card of this part: where its function comes from; what n = 2 means while n = 2 shows. (The x-axis names its letter itself.) */
function cardExtra(card: HoverCard): Pick<CardExtra, 'from' | 'plane'> {
    return {
        // 6.2.1: a built-in (\ln as a map's name) needs no line: the chart is the function.
        ...(card.fn && card.fn.from !== 'builtin' ? { from: { name: card.fn.name, body: card.fn.body, example: card.fn.from === 'example' } } : {}),
        ...(card.lines2 && card.fn ? { plane: t('notes6.hover.plane', { name: card.fn.name }) } : {}),
    };
}

/** The index letters of formulaLines (n, k): their charts start at 0 as sequences do, and keep their view. */
const INDEX_AXES = new Set(['n', 'k']);

/** 6.0.1: a card of these kinds draws a function over the x-axis: its view is framed as a function's. */
const FRAMED_NOTES6: ReadonlySet<HoverKind> = new Set(['set', 'condition']);

/** A template with one formula in it, as text with the formula drawn by MathJax (plain text before MathJax loads). */
function lineWithMath(el: HTMLElement, template: (formula: string) => string, tex: string): void {
    const mark = '\u0001';
    const [before, after = ''] = template(mark).split(mark);
    if (before) el.appendText(before);
    const math = el.createSpan({ cls: 'etz-formula-from-math' });
    try {
        math.appendChild(renderMath(tex, false));
        void finishRenderMath();
    } catch {
        math.setText(tex);
    }
    if (after) el.appendText(after);
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
        const lines = info.text.split('\n');
        const text = lines.slice(info.lineStart, info.lineEnd + 1).join('\n');
        const found = formulasIn(text);
        // 6.2: where the section starts in the note, for the words around each formula; the note's definitions.
        let offset = 0;
        for (let k = 0; k < info.lineStart; k++) offset += lines[k].length + 1;
        const facts = noteFacts(ctx.sourcePath, info.text);
        const mode = this.host.recognition();
        maths.forEach((m, i) => {
            if (!found[i]) return;
            m.dataset.etzTex = found[i].tex;
            m.dataset.etzLine = String(info.lineEnd);
            m.dataset.etzPath = ctx.sourcePath;
            const around = formulaContext(facts, info.text, offset + found[i].start, offset + found[i].end, found[i].tex);
            mathContexts.set(m, around);
            markMath(m, found[i].tex, around, mode);
        });
        // MathJax may draw a formula after this (its first load): mark it again then.
        if (maths.some((m) => !m.querySelector('mjx-math'))) {
            window.setTimeout(() => {
                for (const m of maths) if (m.dataset.etzTex !== undefined && m.dataset.etzSeen !== drawnAs(m)) markMath(m, m.dataset.etzTex, mathContexts.get(m), this.host.recognition());
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
        const mode = () => this.host.recognition();
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
                            markMath(math, found ? found.tex : null, found?.ctx, mode());
                        }
                    });
                }
            }
        );
    }

    /** 6.2: the setting Formula recognition changed: every drawn formula of this window is marked anew. */
    refresh(doc: Document): void {
        this.close();
        const mode = this.host.recognition();
        for (const math of Array.from(doc.querySelectorAll<HTMLElement>('.math'))) {
            if (math.dataset.etzTex !== undefined) {
                markMath(math, math.dataset.etzTex, mathContexts.get(math), mode);
                continue;
            }
            const view = editorOf(math);
            if (!view) continue;
            const found = formulaInEditor(view, math);
            markMath(math, found ? found.tex : null, found?.ctx, mode);
        }
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
                ctx: mathContexts.get(math),
                note: () => this.app.vault.cachedRead(file),
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
        const view = editorOf(math);
        if (!view) return null;
        const found = formulaInEditor(view, math);
        if (!found) return null;
        const { tex, end, ctx } = found;
        const doc = view.state.doc;
        // Under the paragraph: the first empty line after the formula, or the end of the note.
        let line = doc.lineAt(end);
        while (line.number < doc.lines && doc.line(line.number + 1).text.trim() !== '') line = doc.line(line.number + 1);
        const at = line.to;
        const file = this.app.workspace.getActiveFile();
        return { tex, file, ctx, note: () => Promise.resolve(doc.toString()), insert: (b) => view.dispatch({ changes: { from: at, insert: `\n\n${b}` } }) };
    }

    private open(math: HTMLElement, row?: number) {
        this.cancelOpen();
        const found = this.find(math);
        const rows = found ? formulaRows(found.tex) : [];
        const drawnRows = rows.length > 1 ? rowsOf(math) : [];
        const byRow = rows.length > 1 && drawnRows.length === rows.length;
        // A block of rows opens the chart of the row under the pointer, never all rows at once.
        const pick = byRow && row !== undefined && rows[row] !== undefined ? row : undefined;
        const at: Place = { math, row, pick, drawnRows };
        if (!found || (byRow && pick === undefined) || this.host.recognition() === 'rules') {
            this.openRules(at, found, byRow, rows);
            return;
        }
        this.openSmart(at, found, byRow, rows);
    }

    /** Rules (6.1, the setting Formula recognition): the first card a builder takes the formula for, chart first. */
    private openRules(at: Place, found: Found | null, byRow: boolean, rows: string[]) {
        const { math, pick } = at;
        if (!found || (byRow && pick === undefined) || !chartable(found.tex, pick)) {
            // 6.0 B: a set, a map, a condition, an interval, Jensen's inequality, an epigraph: its card, with the note's definitions.
            const tex = found ? (pick !== undefined ? rows[pick] : found.tex) : '';
            // 6.0 E: a recurrence, a sum, a function of z.
            const iterate = found && !(byRow && pick === undefined) ? iterateHoverCard(tex) : null;
            if (found && iterate) {
                const parsed = parseChartText(iterate.lines.join('\n'));
                if (!parsed.problems.length) {
                    this.showIterate(at, found, iterate);
                    return;
                }
            }
            if (found && !(byRow && pick === undefined) && hoverKind(tex)) {
                void this.openNotes6(at, found, (defs) => hoverCard(tex, defs));
                return;
            }
            // 6.0 D: a matrix, A v, det A, A v = λ v.
            if (found && !(byRow && pick === undefined) && linearHoverKind(tex)) {
                void this.openLinear(at, found, (values) => linearHoverCard(tex, values));
                return;
            }
            // A row without a chart: the card of another row of the block closes.
            if (this.pop && this.target === math) this.scheduleClose();
            return;
        }
        const card = chartCard(found.tex, pick);
        if (card) this.showChart(at, found, card);
    }

    /**
     * 6.2, Smart: the network decides (src/notes6/recognize). The rule:
     *   1. Its label is none: no card (and no dotted mark, see markMath).
     *   2. A card kind: the builder of that kind, on the formula and on its
     *      spellings for that builder (src/notes6/recognize/adapt.ts):
     *      formulaLines and formulaChart for function, surface, polar,
     *      implicit and region; hoverCard for set, map, condition, interval,
     *      jensen and epigraph; the linear card for matrix, product, det and
     *      eigen; the iterate card for recurrence, sum and domain; 6.2.1, the
     *      vector card for vector.
     *   3. That builder builds nothing: the rules decide (openRules). The
     *      network said "a card", so the formula gets the rules' card when
     *      the rules have one ("card" both times), and none when they have
     *      none.
     */
    private openSmart(at: Place, found: Found, byRow: boolean, rows: string[]) {
        const { math, pick } = at;
        const tex = pick !== undefined ? rows[pick] : found.tex;
        const label = recognizeCached(tex, found.ctx ?? {}, found.ctx?.key ?? '');
        const fallBack = () => this.openRules(at, found, byRow, rows);
        switch (groupOf(label)) {
            case null:
                if (this.pop && this.target === math) this.scheduleClose();
                return;
            case 'chart': {
                // 6.2.1: with the note's functions (a letter before a bracket that is none is a product).
                const card = smartChart(found.tex, pick, tex, label, definedFunctions(found.ctx?.defs));
                if (card) this.showChart(at, found, card);
                else fallBack();
                return;
            }
            case 'iterate': {
                const card = smartIterate(tex, label);
                if (card) this.showIterate(at, found, card);
                else fallBack();
                return;
            }
            case 'notes6':
                void this.openNotes6(at, found, (defs, domains) => smartNotes6(tex, label, defs, domains)).then((r) => r === 'none' && fallBack());
                return;
            case 'linear':
                void this.openLinear(at, found, (values) => smartLinear(tex, label, values)).then((r) => r === 'none' && fallBack());
                return;
            case 'vector':
                void this.openVector(at, found, (vectors) => smartVector(tex, vectors)).then((r) => r === 'none' && fallBack());
                return;
        }
    }

    /** A chart of src/formula.ts: 6.0.1, a function's card is framed on its roots, extrema and y-intercept, with their dots (not a sequence: it keeps 0 to 20). */
    private showChart(at: Place, found: Found, card: ChartCard) {
        const parsed = parseChartText(card.lines.join('\n'));
        if (parsed.problems.length) return;
        const fn = card.kind === 'function' && !(card.axis && INDEX_AXES.has(card.axis));
        const chart = (fn ? frameChart(parsed.data) : null) ?? parsed.data;
        this.show(at.math, at.row, at.pick, at.drawnRows, found, t(KIND_LABEL[card.kind]), chart, null, { dots: fn });
    }

    /** 6.0 E: the card of a recurrence, a sum or a function of z. */
    private showIterate(at: Place, found: Found, card: IterateHoverCard) {
        const parsed = parseChartText(card.lines.join('\n'));
        if (parsed.problems.length) return;
        this.show(at.math, at.row, at.pick, at.drawnRows, found, t(ITERATE_KIND[card.kind]), parsed.data, { note: t(card.note), two: null });
    }

    /** 6.0 B: the card of a formula of src/notes6/hover.ts, once the note is read (build: the card, from the note's definitions). */
    private async openNotes6(at: Place, found: Found, build: (defs: Map<string, NoteDefinition>, domains: ReadonlyMap<string, string>) => HoverCard | null): Promise<Opened> {
        const { math } = at;
        let note = '';
        try {
            note = await found.note();
        } catch {
            note = '';
        }
        // The pointer may have moved on meanwhile.
        if (!math.isConnected || (this.pop && this.target !== math && this.held)) return 'stale';
        const formulas = formulasIn(note)
            .map((f) => f.tex)
            .filter((f) => f !== found.tex);
        // 6.2.1: and the sets the note names, for a map's domain (f: D \to \mathbb{R} with D = [0, 1])
        const card = build(noteDefinitions(formulas), noteDomains(formulas));
        if (!card) return 'none';
        const read = (lines: string[]) => {
            const parsed = parseChartText(lines.join('\n'));
            return parsed.problems.length ? null : parsed.data;
        };
        const read1 = read(card.lines);
        if (!read1) return 'none';
        // 6.0.1: a set or a condition over the graph of g is framed as g's card is (no dots: the set has its own ends).
        const one = (FRAMED_NOTES6.has(card.kind) && card.fn ? frameChart(read1) : null) ?? read1;
        this.show(math, at.row, at.pick, at.drawnRows, found, t(NOTES6_KIND[card.kind]), one, { note: '', two: card.lines2 ? read(card.lines2) : null, ...cardExtra(card) });
        return 'shown';
    }

    /** 6.0 D: the card of a formula of src/linear/hover.ts, with the note's matrices and vectors (build: the card, from them). */
    private async openLinear(at: Place, found: Found, build: (values: Map<string, string>) => LinearHoverCard | null): Promise<Opened> {
        const { math } = at;
        let note = '';
        try {
            note = await found.note();
        } catch {
            note = '';
        }
        if (!math.isConnected || (this.pop && this.target !== math && this.held)) return 'stale';
        const card = build(noteValues(formulasIn(note).map((f) => f.tex).filter((f) => f !== found.tex)));
        if (!card) return 'none';
        const parsed = parseChartText(card.lines.join('\n'));
        if (parsed.problems.length) return 'none';
        const text = [card.example ? t('linear.hover.note.example', { name: card.name }) : '', t('linear.hover.note.t', { name: card.name })].filter((x) => x).join(' ');
        this.show(math, at.row, at.pick, at.drawnRows, found, t(LINEAR_KIND[card.kind]), parsed.data, { note: text, two: null });
        return 'shown';
    }

    /** 6.2.1: the card of a concrete vector, a sum, a multiple or a product of vectors, with the note's vectors (build: the card, from them). */
    private async openVector(at: Place, found: Found, build: (vectors: ReadonlyMap<string, NoteVector>) => VectorHoverCard | null): Promise<Opened> {
        const { math } = at;
        let note = '';
        try {
            note = await found.note();
        } catch {
            note = '';
        }
        if (!math.isConnected || (this.pop && this.target !== math && this.held)) return 'stale';
        const card = build(noteVectors(note));
        if (!card) return 'none';
        const parsed = parseChartText(card.lines.join('\n'));
        if (parsed.problems.length) return 'none';
        this.show(math, at.row, at.pick, at.drawnRows, found, t(VECTOR_KIND[card.shape]), parsed.data, { note: '', two: null, fromNote: card.fromNote });
        return 'shown';
    }

    /**
     * The card (6.0.1, clean look): its chart with sliders, then one grey
     * line (where g comes from, or what to move) with the n = 1 / n = 2
     * switch, and Open in the editor and Insert chart, small at the bottom.
     * No header: the note highlights the formula already. Close (x) shows
     * on hover or focus, always on touch screens. Every control is a button
     * named for screen readers by its text or a hidden label, never by
     * aria-label (Obsidian would show it as a tooltip over the card).
     */
    private show(math: HTMLElement, row: number | undefined, pick: number | undefined, drawnRows: HTMLElement[], found: Found, kindText: string, chart: Record<string, unknown>, extra: CardExtra | null, opts: CardDraw = {}) {
        this.close();
        this.target = math;
        this.row = row;
        this.lit = (pick !== undefined ? drawnRows[pick] : undefined) ?? math;
        this.lit.addClass('etz-formula-open');
        const doc = math.ownerDocument;
        const pop = doc.body.createDiv({ cls: 'etz-formula-pop etz-tokens', attr: { role: 'dialog' } });
        // Phones and tablets: no hover, so close always shows (with the (hover: none) rule of formula.css).
        if (Platform.isMobile) pop.addClass('is-touch');
        const name = visuallyHidden(pop, t('plugin.formula.dialogKind', { kind: kindText }));
        name.id = uniqueId('formula-pop');
        pop.setAttr('aria-labelledby', name.id);
        this.pop = pop;
        pop.addEventListener('mouseleave', () => this.scheduleClose());
        // A drag or a slider often ends outside the card: once used, the card stays open.
        pop.addEventListener('pointerdown', () => (this.held = true));
        pop.addEventListener('mouseenter', () => this.cancelClose());

        // The chart in the look of the default chart for formulas.
        const data = applyFormulaDefault(cloneData(chart), this.host.formulaDefault());
        const is3D = data.dimension === true;
        const params = (Array.isArray(data.parameters) ? data.parameters : []) as Parameter[];
        // The dots of the roots and extrema belong to the first chart (a switch to n = 2 drops them).
        let dots = !!opts.dots && !is3D;

        const close = pop.createEl('button', { cls: 'etz-formula-close', attr: { type: 'button' } });
        setIcon(close.createSpan({ cls: 'etz-formula-close-icon', attr: { 'aria-hidden': 'true' } }), 'x');
        visuallyHidden(close, t('common.close'));
        close.addEventListener('click', () => this.close());

        const chartBox = pop.createDiv({ cls: 'etz-formula-chart' });
        // 6.0 F1: a new $...$ label is measured before MathJax styled it: draw once more when it has (at most twice).
        let redraws = 0;
        let drawn = 0;
        const draw = () => {
            const pass = ++drawn;
            chartBox.empty();
            const view = cloneData(data);
            Object.assign(view, { previewSize: 340, parameters: params, size_x_cm: 8, size_y_cm: is3D ? 6 : 5.5 });
            // 6.0.1: the roots and extrema of the view at the slider values now, as dots (the card only: Insert chart leaves them out).
            if (dots) {
                const own: unknown[] = Array.isArray(view.tools) ? (view.tools as unknown[]) : [];
                view.tools = [...own, ...keyDots(view)];
            }
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
                    const renderer = new SVGRenderer(config, { math: ctx });
                    chartBox.appendChild(renderer.render());
                    void renderer.mathSettled?.then((again) => {
                        if (again && pass === drawn && pop.isConnected && redraws++ < 2) draw();
                    });
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
                row.createSpan({ cls: 'etz-formula-name', text: p.name, attr: { 'aria-hidden': 'true' } });
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

        // 6.0 B: n = 1 / n = 2 for a formula in R^n (bottom left), and one grey line: where g comes from, or what to move.
        if (extra && (extra.two || extra.note || extra.from || extra.fromNote?.length)) {
            const foot = pop.createDiv({ cls: 'etz-formula-foot' });
            const two = extra.two;
            let plane: HTMLElement | null = null;
            if (two) {
                const one = cloneData(data);
                const second = applyFormulaDefault(cloneData(two), this.host.formulaDefault());
                const bar = foot.createDiv({ cls: 'etz-formula-switch', attr: { role: 'group' } });
                const label = visuallyHidden(bar, t('notes6.hover.dimension'));
                label.id = uniqueId('formula-n');
                bar.setAttr('aria-labelledby', label.id);
                const buttons = [t('notes6.hover.n1'), t('notes6.hover.n2')].map((text, i) => {
                    const b = bar.createEl('button', { cls: 'etz-formula-n', text, attr: { type: 'button', 'aria-pressed': i === 0 ? 'true' : 'false' } });
                    b.addEventListener('click', () => {
                        for (const k of Object.keys(data)) delete data[k];
                        Object.assign(data, cloneData(i === 0 ? one : second));
                        dots = false;
                        buttons.forEach((x, k) => x.setAttr('aria-pressed', k === i ? 'true' : 'false'));
                        plane?.toggleClass('tikz-hidden', i === 0);
                        draw();
                    });
                    return b;
                });
            }
            const from = extra.from;
            if (from) {
                const line = foot.createDiv({ cls: 'etz-formula-from' });
                lineWithMath(line, (formula) => (from.example ? t('notes6.hover.exampleLine', { formula, name: from.name }) : t('notes6.hover.fromLine', { formula })), `${from.name}(x) = ${from.body}`);
            } else if (extra.fromNote?.length) {
                // 6.2.1: where the vector card's names come from, one line with all of them
                const line = foot.createDiv({ cls: 'etz-formula-from' });
                lineWithMath(line, (formula) => t('linear.hover.vector.fromLine', { formula }), extra.fromNote.join(',\\quad '));
            } else if (extra.note) foot.createDiv({ cls: 'etz-formula-from', text: extra.note });
            if (extra.plane && two) plane = foot.createDiv({ cls: 'etz-formula-from etz-formula-plane tikz-hidden', text: extra.plane });
        }

        // Open in the editor and Insert chart: always there, small at the bottom right.
        const acts = pop.createDiv({ cls: 'etz-formula-acts' });
        const withValues = () => ({ ...data, parameters: params.map((p) => ({ ...p })) });
        textButton(acts, {
            text: t('plugin.formula.open'),
            variant: 'ghost',
            size: 'sm',
            cls: 'etz-formula-open-btn',
            onClick: () => {
                this.close();
                this.host.openChart(withValues(), found.file);
            },
        });
        textButton(acts, {
            text: t('plugin.formula.insert'),
            variant: 'cta',
            size: 'sm',
            cls: 'etz-formula-insert-btn',
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
                    Object.assign(data, { xmin: round(cx - (cx - x0) * k), xmax: round(cx + (x1 - cx) * k) });
                    // 6.0 B: a chart whose y follows what is drawn zooms x only (y follows).
                    if (data.fitY !== true) Object.assign(data, { ymin: round(cy - (cy - y0) * k), ymax: round(cy + (y1 - cy) * k) });
                }
                redraw();
            },
            { passive: false }
        );
        let last: { x: number; y: number } | null = null;
        // The angles of a turn, in fractions of a degree while it runs (smooth at any speed, no step lost); whole degrees at the end.
        let turn: { z: number; x: number } | null = null;
        box.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            last = { x: e.clientX, y: e.clientY };
            turn = { z: num(data.rotationZ, 45), x: num(data.rotationX, 30) };
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
                turn ??= { z: num(data.rotationZ, 45), x: num(data.rotationX, 30) };
                turn.z = (((turn.z + dx * 0.5) % 360) + 360) % 360;
                const tilt = this.host.invertDrag3D() ? dy : -dy;
                turn.x = Math.min(90, Math.max(0, turn.x + tilt * 0.3));
                data.rotationZ = turn.z;
                data.rotationX = turn.x;
            } else {
                const r = box.getBoundingClientRect();
                const ux = (num(data.xmax, 5) - num(data.xmin, -5)) / Math.max(1, r.width);
                const uy = (num(data.ymax, 5) - num(data.ymin, -5)) / Math.max(1, r.height);
                Object.assign(data, { xmin: round(num(data.xmin, -5) - dx * ux), xmax: round(num(data.xmax, 5) - dx * ux) });
                // 6.0 B: a chart whose y follows what is drawn pans x only (y follows).
                if (data.fitY !== true) Object.assign(data, { ymin: round(num(data.ymin, -5) + dy * uy), ymax: round(num(data.ymax, 5) + dy * uy) });
            }
            redraw();
        });
        const end = (e: PointerEvent) => {
            last = null;
            if (box.hasPointerCapture(e.pointerId)) box.releasePointerCapture(e.pointerId);
            if (is3D && turn) {
                data.rotationZ = Math.round(turn.z) % 360;
                data.rotationX = Math.round(turn.x);
                redraw();
            }
            turn = null;
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
 * 6.2: Rules marks what a builder takes (as 6.1); Smart marks what the
 * network gives a card and its builder, or the rules, can build (the same
 * rule as openSmart, without the parse checks), never a formula it calls none.
 */
function markMath(math: HTMLElement, tex: string | null, ctx: NoteContext | undefined, mode: RecognitionMode): void {
    math.dataset.etzSeen = drawnAs(math);
    if (!tex) {
        math.dataset.etzMark = '0';
        return;
    }
    const functions = mode === 'rules' ? undefined : definedFunctions(ctx?.defs); // 6.2.1
    const has = (row: number | undefined, rowTex: string) => (mode === 'rules' ? rulesMark(tex, row, rowTex) : smartMark(tex, row, rowTex, recognizeCached(rowTex, ctx ?? {}, ctx?.key ?? ''), functions, ctx?.vectors));
    const rows = formulaRows(tex);
    const drawn = rows.length > 1 ? rowsOf(math) : [];
    if (rows.length > 1 && drawn.length === rows.length) {
        let any = false;
        drawn.forEach((tr, i) => {
            const ok = has(i, rows[i]); // 6.0 B, D, E
            tr.dataset.etzMark = ok ? '1' : '0';
            any = any || ok;
        });
        math.dataset.etzMark = any ? 'rows' : '0';
        return;
    }
    // 6.0 B: sets, maps, conditions, intervals, Jensen and epigraphs open a card too; 6.0 D: matrices; 6.0 E: recurrences, sums and functions of z.
    math.dataset.etzMark = has(undefined, tex) ? '1' : '0';
}

/** The editor of a formula in Live Preview: a table's cells and a callout have editors of their own, the note's editor is the one around them. */
function editorOf(math: HTMLElement): EditorView | null {
    const table = math.closest('table');
    const host = (table ?? math).closest<HTMLElement>('.cm-editor');
    return host ? EditorView.findFromDOM(host) : EditorView.findFromDOM(math);
}

/** The text of an editor's note, once per version of it (the editor's text never changes in place). */
const docTexts = new WeakMap<Text, string>();

/** 6.2: what formula recognition reads around the formula at doc[start, end) of an editor (its note's path from the editor). */
function editorContext(view: EditorView, start: number, end: number, tex: string): NoteContext {
    const doc = view.state.doc;
    let text = docTexts.get(doc);
    if (text === undefined) {
        text = doc.toString();
        docTexts.set(doc, text);
    }
    const path = view.state.field(editorInfoField, false)?.file?.path ?? '';
    return formulaContext(noteFacts(path, text), text, start, end, tex);
}

/** The formula a rendered formula of the editor shows: its TeX, and the end of the line where it ends. */
function formulaInEditor(view: EditorView, math: HTMLElement): { tex: string; end: number; ctx: NoteContext } | null {
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
        // Without the > of a callout, so a $$ block over its lines reads as one formula; 6.2: with where each line starts in the note.
        const starts: Array<{ at: number; from: number }> = [];
        let acc = 0;
        const parts: string[] = [];
        for (let n = first.number; n <= last.number; n++) {
            const l = doc.line(n);
            const cut = (/^\s*(?:>\s?)*/.exec(l.text) ?? [''])[0].length;
            starts.push({ at: acc, from: l.from + cut });
            parts.push(l.text.slice(cut));
            acc += l.text.length - cut + 1;
        }
        const text = parts.join('\n');
        const toDoc = (o: number) => {
            let k = starts.length - 1;
            while (k > 0 && starts[k].at > o) k--;
            return starts[k].from + (o - starts[k].at);
        };
        const index = Array.from(widget.querySelectorAll('.math')).indexOf(math);
        const found = formulasIn(text)[index];
        return found ? { tex: found.tex, end: last.to, ctx: editorContext(view, toDoc(found.start), toDoc(found.end), found.tex) } : null;
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
        if (f.start <= pos && pos <= f.end) return { tex: f.tex, end: doc.lineAt(Math.min(doc.length, f.end)).to, ctx: editorContext(view, f.start, f.end, f.tex) };
    }
    return null;
}
