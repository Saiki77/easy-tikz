/*
 * "What's new" popup for people who updated to version 4 (when it opens:
 * main.ts and src/whatsnew.ts; what it says: src/whatsnew.ts).
 *
 *   header      "Easy TikZ 4" and one line
 *   new         what this release brings, the only items shown open
 *   hero        a live chart (the Tangent explorer with the area to its
 *               tangent) with the slider strip of a chart in a note, plus
 *               play; beside it the lines of text the chart is made of
 *   earlier     the rest of version 4, one line each, closed until opened
 *   actions     Try an example, Open the guides, Close
 *
 * The chart is drawn by the plugin's own renderer, offline, like a chart in
 * a note. Everything it starts (the play animation, draft and full render
 * timers) stops in onClose. Nothing is loaded from the network.
 */
import { App, Modal, setIcon } from 'obsidian';
import { localGuideById } from '../guides';
import { MathContext } from '../mathcontext';
import { normalizeParameters } from '../migrate';
import { SVGRenderer } from '../renderer';
import { SceneCache } from '../scene';
import { SettingsManager } from '../settings';
import { Parameter } from '../types';
import { cloneData, errorText, fitPixelScale } from '../util';
import {
    WHATS_NEW_RECENT,
    WHATS_NEW_AI,
    WHATS_NEW_CHART_GUIDE,
    WHATS_NEW_MORE,
    WHATS_NEW_TITLE,
    whatsNewChart,
    whatsNewRecentTitle,
    whatsNewSubtitle,
    whatsNewText,
    WhatsNewItem,
} from '../whatsnew';
import { IconButtonHandle, LiveSliderHandle, formatDecimals, iconButton, liveSlider, textButton, uniqueId, visuallyHidden } from './kit';
import { t } from '../i18n';

/** What the buttons of the popup do; the caller decides (a new editor, or the editor the popup was opened from). */
export interface WhatsNewActions {
    /** Open the editor on this chart: the popup's live chart with the slider where the reader left it. */
    tryExample(chart: Record<string, unknown>): void;
    /** Open the editor's Help tab: the guides, or one guide by id. */
    openGuides(guideId?: string): void;
    /** Open the editor's AI tab. */
    openAi?(): void;
}

export interface WhatsNewOptions {
    actions: WhatsNewActions;
    /** Runs once the popup is on screen: main.ts records right away that it was seen. */
    onShown?: () => void;
    /** Runs when the popup closed, whatever closed it. */
    onClosed?: () => void;
}

/** A slider drag draws draft frames, and full quality this long after the last move (as charts in notes do). */
const FULL_RENDER_DELAY_MS = 150;
/** Play: one sweep from one end of the slider to the other, as in the Sliders dock. */
const SWEEP_MS = 4000;
/** Longest frame step of the play animation (a stalled window does not make it jump). */
const MAX_FRAME_MS = 50;

export class WhatsNewModal extends Modal {
    private readonly opts: WhatsNewOptions;
    private live: LiveExample | null = null;
    private actionsEl: HTMLElement | null = null;

    constructor(app: App, opts: WhatsNewOptions) {
        super(app);
        this.opts = opts;
    }

    onOpen() {
        const { modalEl, titleEl, contentEl } = this;
        modalEl.addClass('etz-whatsnew', 'etz-tokens');
        contentEl.empty();

        titleEl.empty();
        titleEl.addClass('etz-whatsnew-title');
        const words = WHATS_NEW_TITLE.split(' ');
        const version = words.pop() || '';
        titleEl.appendText(words.join(' ') + ' ');
        titleEl.createSpan({ cls: 'etz-whatsnew-version', text: version });
        contentEl.createEl('p', { cls: 'etz-whatsnew-subtitle', text: whatsNewSubtitle() });

        // --- the newest items
        const fresh = contentEl.createEl('section', { cls: 'etz-whatsnew-new' });
        const freshHeading = fresh.createEl('h3', { cls: 'etz-whatsnew-h', text: whatsNewRecentTitle() });
        freshHeading.id = uniqueId('whatsnew-new');
        fresh.setAttr('aria-labelledby', freshHeading.id);
        const freshGrid = fresh.createDiv({ cls: ['etz-whatsnew-list', 'mod-new'] });
        for (const item of WHATS_NEW_RECENT) this.item(freshGrid, item);

        // --- hero: the live chart, and what makes it move
        const hero = contentEl.createDiv({ cls: 'etz-whatsnew-hero' });
        const figure = hero.createEl('figure', { cls: 'etz-whatsnew-figure' });
        try {
            this.live = new LiveExample(figure, whatsNewChart());
        } catch (e) {
            // Never on a working install, but the popup must still open without its picture.
            figure.empty();
            figure.addClass('is-fallback');
            figure.createDiv({ cls: 'etz-whatsnew-fallback', text: t('panels.whatsNew.drawFailed', { message: errorText(e) }) });
            this.live = null;
        }
        const caption = figure.createEl('figcaption', { cls: 'etz-whatsnew-caption' });
        const chartGuide = localGuideById(WHATS_NEW_CHART_GUIDE);
        appendWithPlaces(caption, chartGuide ? t('panels.whatsNew.captionWithGuide') : t('panels.whatsNew.caption'), {
            slider: (into) => into.createEl('code', { text: 'a' }),
            guide: (into) => {
                if (chartGuide) this.guideLink(into, chartGuide.title, WHATS_NEW_CHART_GUIDE);
            },
        });

        const side = hero.createDiv({ cls: 'etz-whatsnew-side' });

        // The chart beside, as its block writes it: these lines are the whole chart.
        const recipe = side.createDiv({ cls: 'etz-whatsnew-recipe' });
        const recipeTitle = recipe.createDiv({ cls: 'etz-whatsnew-recipe-title', text: t('panels.whatsNew.recipe') });
        recipeTitle.id = uniqueId('whatsnew-recipe');
        recipe.createEl('pre', { cls: 'etz-whatsnew-text', text: whatsNewText(), attr: { 'aria-labelledby': recipeTitle.id } });

        // --- the rest of version 4, closed: the popup is about this release
        const more = contentEl.createEl('details', { cls: 'etz-whatsnew-more' });
        const summary = more.createEl('summary', { cls: 'etz-whatsnew-h' });
        summary.createSpan({ text: t('panels.whatsNew.moreTitle') });
        summary.createSpan({ cls: 'etz-whatsnew-count', text: String(WHATS_NEW_MORE.length) });
        const grid = more.createDiv({ cls: ['etz-whatsnew-list', 'mod-grid'] });
        for (const item of WHATS_NEW_MORE) this.item(grid, item);

        // --- actions: a footer outside the scrolling content, so they stay in view in a low window
        const actions = modalEl.createDiv({ cls: 'etz-whatsnew-actions' });
        this.actionsEl = actions;
        actions.createDiv({ cls: 'etz-whatsnew-hint', text: t('panels.whatsNew.hint') });
        textButton(actions, { text: t('common.close'), onClick: () => this.close() });
        textButton(actions, { text: t('panels.whatsNew.openGuides'), icon: 'book-open', onClick: () => this.run((a) => a.openGuides()) });
        const tryIt = textButton(actions, {
            text: t('panels.whatsNew.tryExample'),
            variant: 'cta',
            onClick: () => {
                const chart = this.live ? this.live.chart() : whatsNewChart();
                this.run((a) => a.tryExample(chart));
            },
        });

        // The top of the popup stays in view (focusing a button at the bottom would scroll a low window).
        tryIt.el.focus({ preventScroll: true });
        contentEl.scrollTop = 0;
        if (this.opts.onShown) this.opts.onShown();
    }

    onClose() {
        if (this.live) this.live.destroy();
        this.live = null;
        this.actionsEl?.remove();
        this.actionsEl = null;
        this.contentEl.empty();
        if (this.opts.onClosed) this.opts.onClosed();
    }

    /** Close first, then act: the editor (or its Replace dialog) opens on its own, not under the popup. */
    private run(action: (actions: WhatsNewActions) => void) {
        this.close();
        action(this.opts.actions);
    }

    private guideLink(parent: HTMLElement, text: string, guideId: string, cls = 'etz-whatsnew-guide') {
        return textButton(parent, {
            text,
            variant: 'link',
            cls,
            onClick: () => this.run((a) => a.openGuides(guideId)),
        });
    }

    /** Icon tile, title (with a link to its guide, when there is one) and one line; inline `backticks` become code. */
    private item(parent: HTMLElement, item: WhatsNewItem) {
        const row = parent.createDiv({ cls: 'etz-whatsnew-item' });
        setIcon(row.createSpan({ cls: 'etz-whatsnew-icon', attr: { 'aria-hidden': 'true' } }), item.icon);
        const body = row.createDiv({ cls: 'etz-whatsnew-item-body' });
        const head = body.createDiv({ cls: 'etz-whatsnew-item-head' });
        head.createSpan({ cls: 'etz-whatsnew-item-title', text: item.title });
        const guide = item.guide ? localGuideById(item.guide) : undefined;
        if (guide) {
            // The visible word is short; the name (and Obsidian's tooltip) says which guide.
            const link = this.guideLink(head, t('panels.whatsNew.guide'), guide.id, 'etz-whatsnew-item-guide');
            link.el.setAttr('aria-label', t('panels.whatsNew.guideLabel', { title: guide.title }));
        } else if (item === WHATS_NEW_AI && this.opts.actions.openAi) {
            textButton(head, { text: t('panels.whatsNew.openAi'), variant: 'link', cls: 'etz-whatsnew-item-guide', onClick: () => this.run((a) => a.openAi?.()) });
        }
        const text = body.createDiv({ cls: 'etz-whatsnew-item-text' });
        item.text.split('`').forEach((part, i) => {
            if (!part) return;
            if (i % 2 === 1) text.createEl('code', { text: part });
            else text.appendText(part);
        });
    }
}

/**
 * The live chart: drawn like a chart in a note (main.ts InlineChart, without
 * its click-to-edit and width controls) with the note's slider strip and a
 * play button. Owns a private MathContext and SceneCache.
 */
class LiveExample {
    private readonly manager: SettingsManager;
    private readonly math: MathContext;
    private readonly cache = new SceneCache();
    private readonly params: Parameter[];
    private readonly box: HTMLElement;
    private chartEl: SVGSVGElement | null = null;
    private boxSize = { w: 0, h: 0 };
    private slider: LiveSliderHandle | null = null;
    private play: IconButtonHandle | null = null;

    private frameRaf: number | null = null;
    private fullTimer: number | null = null;
    private playRaf: number | null = null;
    private playLast = 0;
    private playDir = 1;
    private playRaw = 0;
    private destroyed = false;

    constructor(parent: HTMLElement, data: Record<string, unknown>) {
        this.manager = SettingsManager.fromJSON(cloneData(data));
        // Private: nothing the popup does reaches the memoized contexts of the editor or of notes.
        this.math = this.manager.createMathContext({ memo: false });
        this.params = normalizeParameters(this.manager.getValue('parameters'));

        this.box = parent.createDiv({ cls: 'etz-whatsnew-chart' });
        this.box.setAttr('role', 'img');
        const name = visuallyHidden(parent, t('panels.whatsNew.chartLabel'));
        name.id = uniqueId('whatsnew-chart');
        this.box.setAttr('aria-labelledby', name.id);
        this.render('full');
        this.buildStrip(parent);
    }

    /** The chart as it is now, the slider value back on its step: what "Try an example" opens. */
    chart(): Record<string, unknown> {
        const data = this.manager.serialize();
        data.parameters = this.params.map((p) => ({ ...p, value: onStep(p.value, p) }));
        return cloneData(data);
    }

    destroy(): void {
        this.destroyed = true;
        this.stopPlay(false);
        if (this.frameRaf !== null) window.cancelAnimationFrame(this.frameRaf);
        if (this.fullTimer !== null) window.clearTimeout(this.fullTimer);
        this.frameRaf = this.fullTimer = null;
        this.slider = null;
        this.play = null;
        this.chartEl = null;
    }

    private render(quality: 'draft' | 'full') {
        if (this.destroyed) return;
        if (quality === 'full') {
            if (this.frameRaf !== null) window.cancelAnimationFrame(this.frameRaf);
            if (this.fullTimer !== null) window.clearTimeout(this.fullTimer);
            this.frameRaf = this.fullTimer = null;
        }
        this.math.setParams(this.params);
        const config = this.manager.toRendererConfig(this.math);
        config.parameters = this.params;
        const aspect = config.width > 0 && config.height > 0 ? config.width / config.height : 1.25;
        this.box.setCssProps({ '--etz-whatsnew-aspect': String(aspect) });
        // Grid cells in on-screen px: measured on full renders only, never per drag frame.
        if ((quality === 'full' || !this.boxSize.w) && this.box.isConnected) {
            this.boxSize = { w: this.box.clientWidth, h: this.box.clientHeight };
        }
        const renderer = new SVGRenderer(config, {
            math: this.math,
            cache: this.cache,
            quality,
            pixelScale: fitPixelScale(this.boxSize.w, this.boxSize.h, config.width, config.height),
        });
        const svg = renderer.render() as SVGSVGElement;
        svg.addClass('etz-whatsnew-svg');
        if (this.chartEl && this.chartEl.parentElement === this.box) this.chartEl.replaceWith(svg);
        else this.box.prepend(svg);
        this.chartEl = svg;
    }

    /** A frame for the latest value: draft on the next animation frame, full quality after a pause. */
    private requestFrame() {
        if (this.destroyed) return;
        if (this.frameRaf === null) {
            this.frameRaf = window.requestAnimationFrame(() => {
                this.frameRaf = null;
                this.safeRender('draft');
            });
        }
        if (this.fullTimer !== null) window.clearTimeout(this.fullTimer);
        this.fullTimer = window.setTimeout(() => {
            this.fullTimer = null;
            this.safeRender('full');
        }, FULL_RENDER_DELAY_MS);
    }

    /** Later frames keep the last drawing when one fails (the first one, in the constructor, throws). */
    private safeRender(quality: 'draft' | 'full') {
        try {
            this.render(quality);
        } catch {
            // The picture of the previous value stays.
        }
    }

    /** The slider strip of a chart in a note (same classes, so it looks the same), plus play. */
    private buildStrip(parent: HTMLElement) {
        const p = this.params[0];
        if (!p) return;
        const strip = parent.createDiv({ cls: ['etz-inline-strip', 'etz-whatsnew-strip'] });
        const name = visuallyHidden(strip, t('panels.whatsNew.sliderGroup'));
        name.id = uniqueId('whatsnew-sliders');
        strip.setAttr('role', 'group');
        strip.setAttr('aria-labelledby', name.id);
        const row = strip.createDiv({ cls: 'etz-inline-rows' }).createDiv({ cls: 'etz-inline-row' });
        row.createSpan({ cls: 'etz-inline-name', text: p.name, attr: { 'aria-hidden': 'true' } });
        this.slider = liveSlider(row, {
            min: p.min,
            max: p.max,
            step: p.step,
            value: p.value,
            label: p.name,
            readout: 'input',
            // A typed 5 stays 1.1: outside its range the shading would leave the view.
            fixedRange: true,
            onInput: (v) => {
                this.setValue(v);
                this.requestFrame();
            },
            onCommit: () => this.safeRender('full'),
        });
        // A press on the slider pauses play, as in the Sliders dock.
        this.slider.input.addEventListener('pointerdown', () => this.stopPlay(true));
        this.play = iconButton(strip, {
            icon: 'play',
            label: t('panels.whatsNew.play', { name: p.name }),
            size: 'sm',
            pressed: false,
            cls: 'etz-whatsnew-play',
            onClick: () => (this.playRaf === null ? this.startPlay() : this.stopPlay(true)),
        });
    }

    private setValue(v: number) {
        const p = this.params[0];
        if (!p || !Number.isFinite(v)) return;
        this.params[0] = { ...p, value: v };
    }

    private startPlay() {
        const p = this.params[0];
        if (!p || !(p.max > p.min) || this.destroyed) return;
        this.playRaw = p.value;
        this.playDir = p.value >= p.max ? -1 : 1;
        this.playLast = 0;
        this.playRaf = window.requestAnimationFrame((t) => this.tick(t));
        this.syncPlay();
    }

    /** Stop playing; `settle` puts the value back on its step and draws it at full quality. */
    private stopPlay(settle: boolean) {
        if (this.playRaf === null) return;
        window.cancelAnimationFrame(this.playRaf);
        this.playRaf = null;
        this.playLast = 0;
        this.syncPlay();
        const p = this.params[0];
        if (!settle || !p || this.destroyed) return;
        const v = onStep(p.value, p);
        this.setValue(v);
        this.slider?.setValue(v);
        this.safeRender('full');
    }

    private tick(now: number) {
        this.playRaf = null;
        const p = this.params[0];
        if (this.destroyed || !p || !this.box.isConnected) return;
        const dt = this.playLast ? Math.min(MAX_FRAME_MS, now - this.playLast) : 0;
        this.playLast = now;
        const span = p.max - p.min;
        let raw = this.playRaw + (this.playDir * span * dt) / SWEEP_MS;
        // Bounce off the ends.
        if (raw >= p.max) {
            raw = 2 * p.max - raw;
            this.playDir = -1;
        } else if (raw <= p.min) {
            raw = 2 * p.min - raw;
            this.playDir = 1;
        }
        this.playRaw = Math.min(p.max, Math.max(p.min, raw));
        // A tenth of the step while playing, so the chart moves every frame; stopping snaps back.
        const v = onStep(this.playRaw, { ...p, step: p.step / 10 });
        if (v !== p.value) {
            this.setValue(v);
            this.slider?.setValue(v);
            this.safeRender('draft');
        }
        this.playRaf = window.requestAnimationFrame((t) => this.tick(t));
    }

    private syncPlay() {
        const playing = this.playRaf !== null;
        const name = this.params[0] ? this.params[0].name : '';
        this.play?.setPressed(playing);
        this.play?.setIcon(playing ? 'pause' : 'play');
        this.play?.setLabel(playing ? t('panels.whatsNew.pause', { name }) : t('panels.whatsNew.play', { name }));
    }
}

/** Nearest slider position min + k * step inside [min, max], without float noise. */
function onStep(v: number, p: Parameter): number {
    const stepped = p.step > 0 ? p.min + Math.round((v - p.min) / p.step) * p.step : v;
    return Number(formatDecimals(Math.min(p.max, Math.max(p.min, stepped)), 10));
}

/**
 * Append `text`, a message whose named places are left unfilled, to `el`:
 * its words as text, and each {place} made by its function, so a
 * translation can put code or a link wherever its word order wants it.
 */
function appendWithPlaces(el: HTMLElement, text: string, places: Record<string, (into: HTMLElement) => void>): void {
    text.split(/\{(\w+)\}/).forEach((part, i) => {
        if (i % 2 === 0) {
            if (part) el.appendText(part);
        } else if (places[part]) places[part](el);
        else el.appendText(`{${part}}`);
    });
}
