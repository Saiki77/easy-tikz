import { App, MarkdownPostProcessorContext, Notice, Plugin, PluginSettingTab, SettingDefinitionItem, TFile, setIcon } from 'obsidian';
import { TikzModal } from './src/modal';
import { SettingsManager } from './src/settings';
import { SVGRenderer } from './src/renderer';
import { SVG3DRenderer } from './src/renderer3d';
import { SceneCache, SceneIssue } from './src/scene';
import { MathContext } from './src/mathcontext';
import { normalizeParameters } from './src/migrate';
import { Parameter, RendererConfig } from './src/types';
import { ChartDraft, DEFAULT_PLUGIN_DATA, PluginData, UserTemplate } from './src/templates';
import { PluginHost } from './src/ui/host';
import { issueText, mergeViewErrors } from './src/issues';
import { cloneData, errorText, fitPixelScale } from './src/util';
import { IconButtonHandle, LiveSliderHandle, iconButton, liveSlider, textButton, uniqueId, visuallyHidden } from './src/ui/kit';

type FenceTag = 'easy-tikz' | 'tikz';
type Align = 'left' | 'center' | 'right';

/** Slider rows shown in a note before "Show N more". */
const STRIP_ROWS = 3;
/** Slider drags: full-quality render this long after the last input (draft frames in between). */
const FULL_RENDER_DELAY_MS = 150;
/** Width slider bounds for charts in notes (px). */
const MIN_NOTE_WIDTH = 200;
const MAX_NOTE_WIDTH = 2000;
/** Charts whose slider state is remembered for the session (oldest dropped first). */
const SESSION_LIMIT = 200;

/**
 * Slider positions changed in a note, kept for the session only: a
 * re-render (an edit nearby in Live Preview, scrolling the block out of
 * view) keeps them, and they never write the file. Keyed by sourceKey().
 */
interface SessionState {
    values: Record<string, number>;
    /** "Show N more" is open. */
    expanded: boolean;
}

const sessionStates = new Map<string, SessionState>();

function sessionGet(key: string): SessionState | undefined {
    const state = sessionStates.get(key);
    if (state) {
        // Re-insert so the Map's insertion order doubles as least-recently-used order.
        sessionStates.delete(key);
        sessionStates.set(key, state);
    }
    return state;
}

function sessionSet(key: string, state: SessionState | null) {
    sessionStates.delete(key);
    if (!state) return;
    sessionStates.set(key, state);
    while (sessionStates.size > SESSION_LIMIT) {
        const oldest = sessionStates.keys().next();
        if (oldest.done) break;
        sessionStates.delete(oldest.value);
    }
}

/** FNV-1a over the UTF-16 code units, plus the length: a cheap, stable fingerprint. */
function hashText(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36) + '.' + text.length.toString(36);
}

/**
 * Session key of a block: note path + hash of its chart data. The display
 * options are left out, so resizing or re-aligning the chart (which
 * rewrites the block) does not snap the sliders back.
 */
function sourceKey(sourcePath: string, data: Record<string, unknown>): string {
    const chart: Record<string, unknown> = { ...data };
    delete chart.displayWidth;
    delete chart.displayAlign;
    return sourcePath + '\n' + hashText(JSON.stringify(chart));
}

/** The block's JSON object, or a message saying why it is not one. */
function parseBlock(text: string): Record<string, unknown> | string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return e instanceof Error ? e.message : 'invalid JSON';
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'the block must contain a JSON object';
    return parsed as Record<string, unknown>;
}

/** The fenced block exactly as the note stores it (trailing whitespace of the body dropped). */
function blockText(fenceTag: FenceTag, body: string): string {
    return '```' + fenceTag + '\n' + body.replace(/\s+$/, '') + '\n```';
}

function isDraft(value: unknown): value is ChartDraft {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Partial<ChartDraft>;
    return typeof draft.savedAt === 'number' && Number.isFinite(draft.savedAt) && !!draft.data && typeof draft.data === 'object';
}

function showBlockError(el: HTMLElement, message: string) {
    el.createDiv({ cls: 'tikz-block-error', text: message });
}

export default class EasyTikzPlugin extends Plugin implements PluginHost {
    data: PluginData = { ...DEFAULT_PLUGIN_DATA };

    async onload() {
        const stored = (await this.loadData()) as Partial<PluginData> | null;
        const storedTemplates = stored?.userTemplates;
        const storedDraft = stored?.draft;
        this.data = {
            ...DEFAULT_PLUGIN_DATA,
            ...(stored ?? {}),
            userTemplates: Array.isArray(storedTemplates) ? storedTemplates : [],
            // A damaged draft is dropped instead of offered for restore.
            draft: isDraft(storedDraft) ? storedDraft : null,
        };

        this.addRibbonIcon('square-function', 'Easy TikZ', () => {
            new TikzModal(this.app, this).open();
        });

        // Command palette entry so users who hide the ribbon (or prefer
        // Cmd/Ctrl+P) can still launch the editor. Reported in #2.
        this.addCommand({
            id: 'open-editor',
            name: 'Open editor',
            callback: () => {
                new TikzModal(this.app, this).open();
            },
        });

        // Render `easy-tikz` blocks inline via the same SVG renderers the
        // modal uses for its live preview: no external TeX engine needed.
        this.registerMarkdownCodeBlockProcessor('easy-tikz', (source, el, ctx) => {
            this.renderEasyTikzBlock(source, el, ctx);
        });

        // Optionally also render plain `tikz` blocks the same way. Off by
        // default to coexist with `obsidian-tikzjax` and friends.
        if (this.data.renderTikzBlocks) {
            this.registerMarkdownCodeBlockProcessor('tikz', (source, el, ctx) => {
                this.renderEasyTikzBlock(source, el, ctx, /* fromTikzTag */ true);
            });
        }

        this.addSettingTab(new EasyTikzSettingTab(this.app, this));
    }

    async saveUserTemplates(templates: UserTemplate[]) {
        this.data.userTemplates = templates;
        await this.saveData(this.data);
    }

    async saveSettings() {
        await this.saveData(this.data);
    }

    /**
     * Render an `easy-tikz` code block inline. JSON problems (and raw
     * TikZ in a plain `tikz` block) get an error block; everything else
     * becomes an InlineChart: the chart (click to edit), a muted line
     * for render problems and, when the chart has parameters, a strip of
     * live sliders under it.
     */
    private renderEasyTikzBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext, fromTikzTag = false) {
        const trimmed = source.trim();
        // Plain `tikz` blocks that aren't JSON (real LaTeX) shouldn't
        // crash. Show a helpful note instead.
        if (fromTikzTag && !trimmed.startsWith('{')) {
            showBlockError(
                el,
                'This looks like raw TikZ / pgfplots code rather than an Easy TikZ JSON block. ' +
                    'Install obsidian-tikzjax (or similar) to render it, or recreate the chart via the Easy TikZ modal.'
            );
            return;
        }
        const data = parseBlock(trimmed);
        if (typeof data === 'string') {
            showBlockError(el, 'Easy TikZ render error: ' + data);
            return;
        }
        new InlineChart(this, el, ctx.sourcePath, source, data, fromTikzTag ? 'tikz' : 'easy-tikz').mount();
    }

    /**
     * Open the editor pre-filled with a block's settings. The raw block
     * text lets the modal locate and replace the block by content match
     * (more robust than line numbers when other parts of the file were
     * edited meanwhile).
     */
    openBlockEditor(sourcePath: string, source: string, data: Record<string, unknown>, fenceTag: FenceTag) {
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        new TikzModal(this.app, this, {
            // A copy: the editor must never change the object the note's display patches start from.
            data: cloneData(data),
            sourceFile: file instanceof TFile ? file : null,
            originalBlockText: blockText(fenceTag, source),
            fenceTag,
        }).open();
    }

    /**
     * Merge a display patch (width / alignment) into the block's JSON and
     * write the file. The markdown post-processor then re-renders the
     * block from the new source; slider positions survive (see sourceKey).
     * Returns the new block body, or null (after a Notice) when nothing
     * was saved.
     */
    async persistDisplayPatch(
        sourcePath: string,
        fenceTag: FenceTag,
        source: string,
        patch: Partial<{ displayWidth: number; displayAlign: Align }>
    ): Promise<string | null> {
        const notFound = () => {
            new Notice(
                'Easy TikZ could not find this chart in the note (it may be inside a callout, use a ~~~ fence, or have been edited), ' +
                    'so its width and alignment were not saved.'
            );
            return null;
        };
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (!(file instanceof TFile)) return notFound();
        // Re-parse the source so the patch starts from exactly what the note holds.
        const data = parseBlock(source.trim());
        if (typeof data === 'string') return notFound();
        const body = JSON.stringify({ ...data, ...patch }, null, 2);
        const original = blockText(fenceTag, source);
        const updated = blockText(fenceTag, body);
        let found = false;
        try {
            await this.app.vault.process(file, (content) => {
                // Index arithmetic, not String.replace: '$$' or "$'" in a label would be read as a replacement pattern.
                const at = content.indexOf(original);
                found = at >= 0;
                return at < 0 ? content : content.slice(0, at) + updated + content.slice(at + original.length);
            });
        } catch (e) {
            new Notice(`Could not save the chart width or alignment: ${errorText(e)}`);
            return null;
        }
        return found ? body : notFound();
    }
}

/**
 * One rendered block. Owns its SceneCache, so slider drags only recompute
 * the tools that depend on the dragged parameter. Its MathContext comes
 * from SettingsManager.createMathContext, which MathContext.create
 * memoizes by structure: blocks with the same structure (and an editor
 * open on this block) share one instance, so every evaluation must call
 * math.setParams(this.params) first (render() does). Scene caches stay
 * correct because their dependency keys embed parameter values. Layout:
 *
 *   .etz-inline (outer wrapper, width only, alignment)
 *     .etz-inline-stage
 *       .tikz-rendered-chart.etz-inline-box (aspect-sized; click / Enter / Space opens the editor)
 *       .tikz-rendered-controls (align buttons + width slider over the box, on hover)
 *     .etz-inline-issues (muted problem line)
 *     .etz-inline-strip (parameter sliders; keeps its events to itself)
 */
class InlineChart {
    private readonly plugin: EasyTikzPlugin;
    private readonly el: HTMLElement;
    private readonly sourcePath: string;
    /** Block body as the note holds it (updated after a display patch is saved). */
    private source: string;
    private readonly data: Record<string, unknown>;
    private readonly fenceTag: FenceTag;
    private readonly key: string;

    private manager!: SettingsManager;
    private math!: MathContext;
    private readonly cache = new SceneCache();
    private renderer3d: SVG3DRenderer | null = null;

    /** Parameters as stored in the block, and as currently shown. */
    private saved: Parameter[] = [];
    private params: Parameter[] = [];
    private sliders: LiveSliderHandle[] = [];
    private resetButton: IconButtonHandle | null = null;
    private expanded = false;

    private wrapper!: HTMLElement;
    /** Positions the overlay controls over the box without nesting them in its role=button. */
    private stage!: HTMLElement;
    private box!: HTMLElement;
    private issuesEl!: HTMLElement;
    /** The drawn chart: an <svg> (2D) or the 3D renderer's root. */
    private chartEl: Element | null = null;
    private width = 0;
    private aspect = 0;
    /** Content box of the chart box in CSS px, measured on full renders (draft frames reuse it). */
    private boxSize = { w: 0, h: 0 };

    private frameRaf: number | null = null;
    private fullTimer: number | null = null;

    constructor(plugin: EasyTikzPlugin, el: HTMLElement, sourcePath: string, source: string, data: Record<string, unknown>, fenceTag: FenceTag) {
        this.plugin = plugin;
        this.el = el;
        this.sourcePath = sourcePath;
        this.source = source;
        this.data = data;
        this.fenceTag = fenceTag;
        this.key = sourceKey(sourcePath, data);
    }

    mount() {
        try {
            // fromJSON migrates 3.x blocks; it gets a copy so `data` stays the block's own JSON.
            this.manager = SettingsManager.fromJSON(cloneData(this.data));
            this.math = this.manager.createMathContext();
        } catch (e) {
            showBlockError(this.el, 'Easy TikZ render error: ' + errorText(e));
            return;
        }
        this.saved = normalizeParameters(this.manager.getValue('parameters'));
        const session = sessionGet(this.key);
        this.expanded = !!session && session.expanded;
        this.params = this.saved.map((p) => {
            const v = session ? session.values[p.name] : undefined;
            return typeof v === 'number' && Number.isFinite(v) ? { ...p, value: v } : { ...p };
        });

        const align = this.data.displayAlign;
        this.wrapper = this.el.createDiv({ cls: 'etz-inline' });
        this.applyAlign(align === 'left' || align === 'right' ? align : 'center');
        this.stage = this.wrapper.createDiv({ cls: 'etz-inline-stage' });
        this.box = this.stage.createDiv({ cls: 'tikz-rendered-chart etz-inline-box' });
        this.box.setAttr('role', 'button');
        this.box.setAttr('tabindex', '0');
        // aria-labelledby, not aria-label: Obsidian shows a tooltip for every [aria-label] element.
        const name = visuallyHidden(this.box, 'Easy TikZ chart. Click to edit.');
        name.id = uniqueId('inline-chart');
        this.box.setAttr('aria-labelledby', name.id);
        this.issuesEl = this.wrapper.createDiv({ cls: 'etz-inline-issues tikz-hidden' });

        try {
            this.render('full');
        } catch (e) {
            // Nothing was drawn, so there is no partial chart to keep.
            this.wrapper.remove();
            showBlockError(this.el, 'Easy TikZ render error: ' + errorText(e));
            return;
        }

        this.buildHoverControls();
        this.buildStrip();

        this.box.addEventListener('click', () => this.openEditor());
        this.box.addEventListener('keydown', (e: KeyboardEvent) => {
            // Only the focused box itself opens the editor, never keys meant for a control.
            if (e.target !== this.box) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.openEditor();
            }
        });
    }

    private openEditor() {
        this.plugin.openBlockEditor(this.sourcePath, this.source, this.data, this.fenceTag);
    }

    // ------------------------------------------------------------ rendering

    /**
     * Draw the chart with the current slider values. Draft frames use the
     * coarse grid (2D) or the canvas (3D) and leave the problem line alone.
     * Throws only when the very first render fails (mount shows an error
     * block then); later failures keep the last drawing and report through
     * the problem line.
     */
    private render(quality: 'draft' | 'full') {
        if (quality === 'full') this.cancelFrames();
        let issues: SceneIssue[];
        try {
            const math = this.math;
            math.setParams(this.params);
            // Ranges may use parameters, so the config is rebuilt every frame.
            const config = this.manager.toRendererConfig(math);
            config.parameters = this.params;
            this.applySize(config);
            issues = config.is3D ? this.render3D(config, math, quality) : this.render2D(config, math, quality);
            // Hidden tools that nothing reads affect nothing: no problem line for them.
            issues = issues.filter((i) => !i.hiddenSource);
            if (quality === 'full') issues = mergeViewErrors(issues, () => this.manager.resolveView(math).errors, config.is3D).concat(math.parameterIssues());
        } catch (e) {
            if (!this.chartEl) throw e;
            issues = [{ source: 'chart', message: `Preview failed: ${errorText(e)}`, severity: 'error' }];
        }
        if (quality === 'full') this.showIssues(issues);
    }

    private render2D(config: RendererConfig, math: MathContext, quality: 'draft' | 'full'): SceneIssue[] {
        // Grid cells in on-screen px: measured on full renders only, never per drag frame.
        if ((quality === 'full' || !this.boxSize.w) && this.box.isConnected) {
            this.boxSize = { w: this.box.clientWidth, h: this.box.clientHeight };
        }
        const pixelScale = fitPixelScale(this.boxSize.w, this.boxSize.h, config.width, config.height);
        const renderer = new SVGRenderer(config, { math, cache: this.cache, quality, pixelScale });
        const svg = renderer.render();
        svg.addClass('etz-inline-svg');
        this.placeChart(svg);
        return renderer.issues;
    }

    /**
     * Notes show the renderer's SVG at rest (crisp, selectable). Slider
     * drafts paint the canvas instead: the SVG path rewrites one <path> per
     * surface quad, which costs several times the JS and a style recalc
     * per frame. The class flips only after a render succeeded, so a
     * failing frame never uncovers a stale picture; a full render follows
     * every drag (release, or the pause timer).
     */
    private render3D(config: RendererConfig, math: MathContext, quality: 'draft' | 'full'): SceneIssue[] {
        if (!this.renderer3d) this.renderer3d = new SVG3DRenderer();
        const root = this.renderer3d.getElement();
        this.placeChart(root);
        if (quality === 'draft') {
            this.renderer3d.renderCanvas(config, { math });
            root.addClass('etz-inline-drafting');
        } else {
            this.renderer3d.renderSvg(config, { math });
            root.removeClass('etz-inline-drafting');
        }
        return this.renderer3d.issues;
    }

    /** Put the chart first in the box (the overlay controls follow it). */
    private placeChart(chart: Element) {
        if (this.chartEl === chart) return;
        if (this.chartEl && this.chartEl.parentElement === this.box) this.chartEl.replaceWith(chart);
        else this.box.prepend(chart);
        this.chartEl = chart;
    }

    /**
     * Box aspect from the configured export size; wrapper width from the
     * block's saved displayWidth, else the chart's own width. CSS caps the
     * wrapper at the note width, so narrow panes shrink the chart.
     */
    private applySize(config: RendererConfig) {
        const aspect = config.width > 0 && config.height > 0 ? config.width / config.height : 1.5;
        if (aspect !== this.aspect) {
            this.aspect = aspect;
            this.box.setCssProps({ '--etz-inline-aspect': String(aspect) });
        }
        if (!this.width) {
            const saved = this.data.displayWidth;
            const natural = typeof saved === 'number' && Number.isFinite(saved) ? saved : config.width;
            this.setWidth(natural);
        }
    }

    private setWidth(width: number) {
        this.width = Math.round(Math.max(MIN_NOTE_WIDTH, Math.min(MAX_NOTE_WIDTH, width)));
        this.wrapper.setCssProps({ '--etz-inline-width': `${this.width}px` });
    }

    /**
     * Muted line under the chart: '2 problems: R1 condition 2: ...' (the
     * full list in the tooltip). Info notes (unbounded optimum, empty
     * region) show without a count when there is no error.
     */
    private showIssues(issues: SceneIssue[]) {
        const errors = issues.filter((i) => i.severity === 'error');
        const ordered = errors.concat(issues.filter((i) => i.severity !== 'error'));
        this.issuesEl.toggleClass('tikz-hidden', ordered.length === 0);
        this.issuesEl.toggleClass('is-error', errors.length > 0);
        if (!ordered.length) {
            this.issuesEl.empty();
            this.issuesEl.removeAttribute('title');
            return;
        }
        const first = issueText(ordered[0]);
        const count = errors.length === 1 ? '1 problem' : `${errors.length} problems`;
        this.issuesEl.setText(errors.length ? `${count}: ${first}` : first);
        this.issuesEl.setAttr('title', ordered.map((i) => issueText(i)).join('\n'));
    }

    // -------------------------------------------------------------- sliders

    /** Slider drag: draft frame on the next animation frame, full quality after a pause. */
    private requestFrame() {
        if (this.frameRaf === null) {
            this.frameRaf = window.requestAnimationFrame(() => {
                this.frameRaf = null;
                this.render('draft');
            });
        }
        if (this.fullTimer !== null) window.clearTimeout(this.fullTimer);
        this.fullTimer = window.setTimeout(() => {
            this.fullTimer = null;
            this.render('full');
        }, FULL_RENDER_DELAY_MS);
    }

    private cancelFrames() {
        if (this.frameRaf !== null) window.cancelAnimationFrame(this.frameRaf);
        if (this.fullTimer !== null) window.clearTimeout(this.fullTimer);
        this.frameRaf = this.fullTimer = null;
    }

    /**
     * Always-visible slider rows under the chart (when the chart has
     * parameters and 'Show sliders in note' is on): name, live slider,
     * editable value; up to STRIP_ROWS rows, then "Show N more".
     */
    private buildStrip() {
        if (!this.params.length || this.manager.getValue('showSlidersInNote') === false) return;
        const strip = this.wrapper.createDiv({ cls: 'etz-inline-strip etz-tokens' });
        // Keep pointer and key events inside the strip: Live Preview would
        // otherwise move the cursor into the block source mid-drag.
        for (const type of ['pointerdown', 'mousedown', 'click', 'keydown']) {
            strip.addEventListener(type, (e) => e.stopPropagation());
        }
        const name = visuallyHidden(strip, 'Chart sliders');
        name.id = uniqueId('inline-sliders');
        strip.setAttr('role', 'group');
        strip.setAttr('aria-labelledby', name.id);

        const rows = strip.createDiv({ cls: 'etz-inline-rows' });
        const extraRows: HTMLElement[] = [];
        this.sliders = this.params.map((p, i) => {
            const row = rows.createDiv({ cls: 'etz-inline-row' });
            row.createSpan({ cls: 'etz-inline-name', text: p.name, attr: { 'aria-hidden': 'true', title: p.name } });
            if (i >= STRIP_ROWS) extraRows.push(row);
            return liveSlider(row, {
                min: p.min,
                max: p.max,
                step: p.step,
                value: p.value,
                label: p.name,
                readout: 'input',
                onInput: (v) => this.setParam(i, v),
                // Release or a typed value: draw full quality now instead of after the pause.
                onCommit: () => this.render('full'),
            });
        });

        if (extraRows.length) {
            const more = textButton(rows, { text: '', variant: 'link', size: 'sm', cls: 'etz-inline-more' });
            const sync = () => {
                for (const row of extraRows) row.toggleClass('tikz-hidden', !this.expanded);
                more.setText(this.expanded ? 'Show less' : `Show ${extraRows.length} more`);
                more.el.setAttr('aria-expanded', String(this.expanded));
            };
            more.el.addEventListener('click', () => {
                this.expanded = !this.expanded;
                sync();
                this.storeSession();
            });
            sync();
        }

        this.resetButton = iconButton(strip, {
            icon: 'rotate-ccw',
            label: 'Reset sliders to the saved values',
            size: 'sm',
            cls: 'etz-inline-reset',
            onClick: () => this.resetParams(),
        });
        this.updateReset();
    }

    private setParam(index: number, value: number) {
        this.params[index] = { ...this.params[index], value };
        this.storeSession();
        this.updateReset();
        this.requestFrame();
    }

    private resetParams() {
        const hadFocus = !!this.resetButton && activeDocument.activeElement === this.resetButton.el;
        this.params = this.saved.map((p) => ({ ...p }));
        this.params.forEach((p, i) => this.sliders[i]?.setValue(p.value));
        this.storeSession();
        this.updateReset();
        // The button is disabled now; keep keyboard users in the strip.
        if (hadFocus) this.sliders[0]?.input.focus();
        this.render('full');
    }

    private isModified(): boolean {
        return this.params.some((p, i) => !Object.is(p.value, this.saved[i].value));
    }

    private updateReset() {
        this.resetButton?.setDisabled(!this.isModified());
    }

    private storeSession() {
        const values: Record<string, number> = {};
        this.params.forEach((p, i) => {
            if (!Object.is(p.value, this.saved[i].value)) values[p.name] = p.value;
        });
        const empty = Object.keys(values).length === 0 && !this.expanded;
        sessionSet(this.key, empty ? null : { values, expanded: this.expanded });
    }

    // ------------------------------------------------------- hover controls

    private applyAlign(align: Align) {
        this.wrapper.removeClass('align-left', 'align-center', 'align-right');
        this.wrapper.addClass('align-' + align);
    }

    /**
     * Floating overlay controls on the chart: align buttons on the left,
     * width slider along the bottom; both fade in on hover / focus via
     * CSS. They are siblings of the box, not children, so the box's
     * role=button has no interactive content. The width slider resizes
     * live on input and writes `displayWidth` to the block on release
     * (one file write per drag); align clicks save immediately. Their
     * events stop here, so Live Preview does not move the cursor either.
     */
    private buildHoverControls() {
        let align: Align = this.wrapper.hasClass('align-left') ? 'left' : this.wrapper.hasClass('align-right') ? 'right' : 'center';
        let savedWidth = this.width;
        /** Save the patch; on failure (a Notice says why) the chart goes back to what the note holds. */
        const persist = (patch: Partial<{ displayWidth: number; displayAlign: Align }>) => {
            void this.plugin.persistDisplayPatch(this.sourcePath, this.fenceTag, this.source, patch).then((body) => {
                if (body !== null) {
                    this.source = body;
                    Object.assign(this.data, patch);
                    if (patch.displayAlign) align = patch.displayAlign;
                    if (patch.displayWidth !== undefined) savedWidth = patch.displayWidth;
                    return;
                }
                if (patch.displayAlign) this.applyAlign(align);
                if (patch.displayWidth !== undefined) {
                    this.setWidth(savedWidth);
                    syncRange();
                }
            });
        };
        const stop = (e: Event) => e.stopPropagation();

        const alignBar = this.stage.createDiv({ cls: 'tikz-rendered-controls tikz-rendered-align' });
        const makeAlignBtn = (key: Align, icon: string, label: string) => {
            const btn = alignBar.createEl('button', { cls: 'tikz-rendered-btn', attr: { type: 'button', 'aria-label': label } });
            setIcon(btn, icon);
            btn.addEventListener('click', () => {
                this.applyAlign(key);
                persist({ displayAlign: key });
            });
        };
        makeAlignBtn('left', 'align-left', 'Align left');
        makeAlignBtn('center', 'align-center', 'Center');
        makeAlignBtn('right', 'align-right', 'Align right');

        const sizeBar = this.stage.createDiv({ cls: 'tikz-rendered-controls tikz-rendered-size' });
        const slider = sizeBar.createEl('input', {
            cls: 'tikz-rendered-slider',
            type: 'range',
            attr: { min: String(MIN_NOTE_WIDTH), step: '10', 'aria-label': 'Chart width' },
        });
        // The note width is only known once the block is in the document,
        // so the range is measured again when the slider is about to be used.
        const syncRange = () => {
            const available = this.wrapper.parentElement?.clientWidth || this.el.clientWidth || 0;
            const max = available > 0 ? Math.max(400, Math.min(MAX_NOTE_WIDTH, Math.round(available))) : Math.max(700, this.width);
            slider.max = String(max);
            // A saved width wider than the note is shown at the width the chart really has.
            slider.value = String(Math.min(this.width, max));
        };
        syncRange();
        for (const bar of [alignBar, sizeBar]) {
            for (const type of ['pointerdown', 'mousedown', 'click', 'keydown']) bar.addEventListener(type, stop);
        }
        slider.addEventListener('pointerdown', syncRange);
        slider.addEventListener('focus', syncRange);
        slider.addEventListener('input', () => this.setWidth(parseInt(slider.value, 10)));
        slider.addEventListener('change', () => persist({ displayWidth: this.width }));
    }
}

class EasyTikzSettingTab extends PluginSettingTab {
    private plugin: EasyTikzPlugin;

    constructor(app: App, plugin: EasyTikzPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /**
     * Declarative settings (Obsidian 1.13+). The framework renders these
     * and indexes them for the settings search; values flow through
     * `getControlValue` / `setControlValue` below.
     */
    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                name: 'Invert vertical drag in 3D',
                desc:
                    'Off (default): drag down tilts the scene up (camera elevation rises), drag up tilts the scene down - the trackball convention. ' +
                    'On: drag down lowers the camera, drag up raises it - direct manipulation.',
                control: { type: 'toggle', key: 'invertDrag3D', defaultValue: false },
            },
            {
                name: 'Max 3D samples per axis',
                desc:
                    'Upper bound of the Samples slider on each 3D surface card (default 80, at most 120). ' +
                    'The exported pgfplots code always uses at most 60 samples per axis, because pdflatex runs out of memory above that. ' +
                    'Re-open the Easy TikZ modal after changing this.',
                control: { type: 'slider', key: 'maxSamples3D', min: 40, max: 120, step: 10, defaultValue: 80 },
            },
            {
                name: '2D pan sensitivity',
                desc:
                    'Default 1.0 - direct manipulation: moving the mouse by N pixels pans the chart by exactly N chart pixels. ' +
                    'Lower values dampen the drag for finer control on dense plots (e.g. 0.5 = half-step pan); higher values overshoot. ' +
                    'The pan rate also scales with the current axis range, so this multiplier stays consistent as you zoom in or out.',
                control: { type: 'slider', key: 'dragSensitivity2D', min: 0.1, max: 2.0, step: 0.05, defaultValue: 1.0 },
            },
            {
                name: 'Also render plain `tikz` blocks',
                desc:
                    'Off by default. When on, the plugin renders blocks tagged plain ```tikz the same way it renders ```easy-tikz blocks. ' +
                    'Useful if you want one tag for everything, but conflicts with `obsidian-tikzjax` and other plugins that claim ```tikz. ' +
                    'Reload Obsidian after changing this for the registration to take effect.',
                control: { type: 'toggle', key: 'renderTikzBlocks', defaultValue: false },
            },
        ];
    }

    getControlValue(key: string): unknown {
        return this.plugin.data[key as keyof PluginData];
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        switch (key) {
            case 'invertDrag3D':
                this.plugin.data.invertDrag3D = Boolean(value);
                break;
            case 'renderTikzBlocks':
                this.plugin.data.renderTikzBlocks = Boolean(value);
                break;
            case 'maxSamples3D':
                this.plugin.data.maxSamples3D = Number(value);
                break;
            case 'dragSensitivity2D':
                this.plugin.data.dragSensitivity2D = Number(value);
                break;
            default:
                return;
        }
        await this.plugin.saveSettings();
    }
}
