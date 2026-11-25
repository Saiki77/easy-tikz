/*
 * "What's new" popup for people who updated (when it opens: main.ts and
 * src/whatsnew.ts; what it says: src/whatsnew.ts). A slideshow of 6.0: one
 * feature per slide, its live chart filling a 16:9 stage, then the film.
 *
 *   header      "Easy Graphs Charts and TikZ 6" and the button "Watch the
 *               film 2:21" (to the last slide, and the film plays)
 *   slide       the stage (the live chart with its player or sliders; on
 *               the Ask slide a chart that asks its questions when a curve
 *               is clicked; on the last slide the film's poster), then a
 *               small accent label, the title, one line and Try it (the
 *               slide's chart in the editor)
 *   footer      the dots (one per slide), n / 7, Back and Next (Done on the
 *               last slide); the arrow keys move between the slides
 *
 * A slide is built when it is first shown. The charts are drawn by the
 * plugin's own renderer, offline, like charts in a note; what moves runs
 * only while its slide is on screen. Everything a slide starts (play,
 * draft and full render timers, the film's player) stops when the slide is
 * left and in onClose. Nothing loads from the network until Play on the
 * film is clicked: the poster ships with the plugin, and only that click
 * puts YouTube's player in its place.
 */
import { App, Modal, setIcon } from 'obsidian';
import { cloneData, errorText, fitPixelScale } from '../util';
import { SettingsManager } from '../settings';
import { MathContext } from '../mathcontext';
import type { Parameter } from '../types';
import { RenderLayout, DrawnScene, SVGRenderer } from '../renderer';
import { AskController, svgBoxOf } from '../notes6/askHost';
import { openAskMenu } from '../notes6/askMenu';
import { WHATS_NEW_CHANGELOG, WHATS_NEW_FILM, WHATS_NEW_FILM_SLIDE, WHATS_NEW_SLIDES, WHATS_NEW_TITLE, WhatsNewSlide, whatsNewChartOf } from '../whatsnew';
import { TextButtonHandle, textButton, trapEscape, uniqueId, visuallyHidden } from './kit';
import { LiveChart, LiveChartOptions } from './liveChart';
import { t } from '../i18n';
// The film's poster: a JPEG inside main.js (esbuild's dataurl loader), so showing it loads nothing.
import FILM_POSTER from './assets/film-poster.jpg';

/** What the buttons of the popup do; the caller decides (a new editor, or the editor the popup was opened from). */
export interface WhatsNewActions {
    /** Open the editor on this chart: the slide's live chart with its sliders where the reader left them. */
    tryExample(chart: Record<string, unknown>): void;
    /** Open the editor's Help tab: its home (with the row New in 6), or one guide by id. */
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

export class WhatsNewModal extends Modal {
    private readonly opts: WhatsNewOptions;
    /** The slides built so far (a slide is built when it is first shown), and what moves on them. */
    private readonly slideEls = new Map<number, HTMLElement>();
    private readonly lives = new Map<number, LiveChart>();
    /** The chart of the Ask slide, by slide index. */
    private readonly asks = new Map<number, AskChart>();
    /** The film's poster and, after Play, its player. */
    private film: FilmPlayer | null = null;
    private index = 0;
    private deck: HTMLElement | null = null;
    private filmButton: HTMLElement | null = null;
    private actionsEl: HTMLElement | null = null;
    private dots: HTMLButtonElement[] = [];
    private counter: HTMLElement | null = null;
    private back: TextButtonHandle | null = null;
    private next: TextButtonHandle | null = null;

    constructor(app: App, opts: WhatsNewOptions) {
        super(app);
        this.opts = opts;
    }

    onOpen() {
        const { modalEl, titleEl, contentEl } = this;
        modalEl.addClass('etz-whatsnew', 'etz-tokens');
        contentEl.empty();

        // --- the header: the name with its version, and the film
        titleEl.empty();
        titleEl.addClass('etz-whatsnew-title');
        titleEl.id = uniqueId('whatsnew-title');
        const words = WHATS_NEW_TITLE.split(' ');
        const version = words.pop() || '';
        titleEl.appendText(words.join(' ') + ' ');
        titleEl.createSpan({ cls: 'etz-whatsnew-version', text: version });
        const film = (titleEl.parentElement ?? modalEl).createEl('button', { cls: 'etz-whatsnew-film', attr: { type: 'button' } });
        setIcon(film.createSpan({ cls: 'etz-whatsnew-film-dot', attr: { 'aria-hidden': 'true' } }), 'play');
        film.createSpan({ text: t('panels.whatsNew.watchFilm') });
        film.createSpan({ cls: 'etz-whatsnew-film-length', text: WHATS_NEW_FILM.length });
        // A click: the film may play at once.
        film.addEventListener('click', () => {
            this.show(WHATS_NEW_FILM_SLIDE);
            this.film?.play();
        });
        this.filmButton = film;

        // --- the slides: one feature each, shown big
        // Named by the title, not by aria-label: Obsidian shows an aria-label as a tooltip wherever the pointer rests.
        this.deck = contentEl.createDiv({ cls: 'etz-whatsnew-deck', attr: { role: 'region', 'aria-roledescription': t('panels.whatsNew.slides'), 'aria-labelledby': titleEl.id } });

        // --- the footer, outside the scrolling content: where you are, and the way on
        const actions = modalEl.createDiv({ cls: 'etz-whatsnew-actions' });
        this.actionsEl = actions;
        const count = WHATS_NEW_SLIDES.length;
        const dots = actions.createDiv({ cls: 'etz-whatsnew-dots' });
        this.dots = WHATS_NEW_SLIDES.map((x, i) => {
            const dot = dots.createEl('button', {
                cls: 'etz-whatsnew-dot',
                attr: { type: 'button', 'aria-label': t('panels.whatsNew.goTo', { n: i + 1, count, title: x.title }) },
            });
            dot.addEventListener('click', () => this.show(i));
            return dot;
        });
        this.counter = actions.createSpan({ cls: 'etz-whatsnew-counter', attr: { 'aria-hidden': 'true' } });
        actions.createDiv({ cls: 'etz-whatsnew-spacer' });
        this.back = textButton(actions, { text: t('panels.whatsNew.back'), icon: 'arrow-left', onClick: () => this.show(this.index - 1) });
        this.next = textButton(actions, {
            text: t('panels.whatsNew.next'),
            variant: 'cta',
            onClick: () => (this.index < count - 1 ? this.show(this.index + 1) : this.close()),
        });
        // The arrow keys move between the slides, except in a field or on a slider (there they change its value).
        modalEl.addEventListener('keydown', (e) => {
            const el = e.target instanceof HTMLElement ? e.target : null;
            if (e.altKey || e.ctrlKey || e.metaKey || (el && (el.closest('input, textarea, select') || el.isContentEditable))) return;
            if (e.key === 'ArrowRight' && this.index < count - 1) this.show(this.index + 1);
            else if (e.key === 'ArrowLeft' && this.index > 0) this.show(this.index - 1);
            else return;
            e.preventDefault();
        });

        this.show(0, true);
        // Next has the focus, not the film in the header (Obsidian focuses the first button of a modal after onOpen);
        // the top of the popup stays in view (focusing a button at the bottom would scroll a low window).
        const next = this.next.el;
        next.focus({ preventScroll: true });
        window.setTimeout(() => {
            if (next.isConnected && activeDocument.activeElement === film) next.focus({ preventScroll: true });
        }, 0);
        contentEl.scrollTop = 0;
        if (this.opts.onShown) this.opts.onShown();
    }

    onClose() {
        openAskMenu()?.close();
        // The player goes first: its sound stops with it.
        this.film?.stop();
        this.film = null;
        for (const ask of this.asks.values()) ask.destroy();
        this.asks.clear();
        for (const live of this.lives.values()) live.destroy();
        this.lives.clear();
        this.slideEls.clear();
        this.filmButton?.remove();
        this.filmButton = null;
        this.actionsEl?.remove();
        this.actionsEl = null;
        this.deck = null;
        this.contentEl.empty();
        if (this.opts.onClosed) this.opts.onClosed();
    }

    /** Show slide `i` (built the first time); the slide left stops what it started. */
    private show(i: number, first = false) {
        const count = WHATS_NEW_SLIDES.length;
        const deck = this.deck;
        if (!deck || i < 0 || i >= count) return;
        const from = this.index;
        if (i === from && !first) return;
        if (!first) {
            openAskMenu()?.close();
            this.slideEls.get(from)?.addClass('tikz-hidden');
            this.lives.get(from)?.pause();
            if (WHATS_NEW_SLIDES[from].id === 'film') this.film?.stop();
        }
        this.index = i;
        let el = this.slideEls.get(i);
        if (!el) {
            el = this.buildSlide(deck, i);
            this.slideEls.set(i, el);
        } else {
            el.removeClass('tikz-hidden');
            this.lives.get(i)?.redraw();
        }
        // A short, calm arrival (CSS; none when the system asks for less motion).
        el.removeClass('is-in');
        void el.offsetWidth;
        el.addClass('is-in');
        this.dots.forEach((dot, k) => dot.setAttr('aria-current', k === i ? 'step' : 'false'));
        this.counter?.setText(`${i + 1} / ${count}`);
        this.back?.setDisabled(i === 0);
        this.next?.setText(i === count - 1 ? t('panels.whatsNew.done') : t('panels.whatsNew.next'));
        this.contentEl.scrollTop = 0;
    }

    /** The chart of the slide on screen as it is now (its sliders where the reader left them): what Try it opens. */
    private currentChart(): Record<string, unknown> | null {
        const ask = this.asks.get(this.index);
        if (ask) return ask.chart();
        const live = this.lives.get(this.index);
        if (live) return live.chart();
        const text = WHATS_NEW_SLIDES[this.index]?.chart;
        return text ? whatsNewChartOf(text) : null;
    }

    /** A slide: the stage with its live chart (or the film), then the label, the title, the line and its buttons. */
    private buildSlide(deck: HTMLElement, i: number): HTMLElement {
        const x = WHATS_NEW_SLIDES[i];
        const count = WHATS_NEW_SLIDES.length;
        const el = deck.createDiv({ cls: ['etz-whatsnew-slide', `mod-${x.id}`], attr: { role: 'group', 'aria-roledescription': t('panels.whatsNew.slide') } });
        // Its name in hidden text (an aria-label would show as a tooltip over the whole slide).
        const name = visuallyHidden(el, t('panels.whatsNew.goTo', { n: i + 1, count, title: x.title }));
        name.id = uniqueId('whatsnew-slide');
        el.setAttr('aria-labelledby', name.id);
        const stage = el.createDiv({ cls: ['etz-whatsnew-stage', `mod-${x.id}`] });
        try {
            if (x.id === 'film') this.film = new FilmPlayer(stage);
            else if (x.id === 'ask') this.demoAsk(stage, x, i);
            else if (x.chart) this.demoChart(stage, x, i);
        } catch (e) {
            // Never on a working install, but the popup must still show the slide's words.
            stage.empty();
            stage.createDiv({ cls: 'etz-whatsnew-fallback', text: t('panels.whatsNew.drawFailed', { message: errorText(e) }) });
        }

        const copy = el.createDiv({ cls: 'etz-whatsnew-copy' });
        const words = copy.createDiv({ cls: 'etz-whatsnew-words' });
        if (x.label) words.createSpan({ cls: 'etz-whatsnew-label', text: x.label });
        words.createEl('h3', { cls: 'etz-whatsnew-slide-title', text: x.title });
        const line = words.createEl('p', { cls: 'etz-whatsnew-slide-text', text: x.text });
        const buttons = copy.createDiv({ cls: 'etz-whatsnew-buttons' });
        if (x.id === 'film') {
            // Next to the film: the browser, for whoever wants it there.
            line.appendText(' ');
            const link = line.createEl('a', { cls: 'etz-whatsnew-youtube', href: WHATS_NEW_FILM.watch, attr: { target: '_blank', rel: 'noopener' } });
            link.createSpan({ text: t('panels.whatsNew.film.youtube') });
            setIcon(link.createSpan({ cls: 'etz-whatsnew-youtube-icon', attr: { 'aria-hidden': 'true' } }), 'external-link');
            textButton(buttons, { text: t('panels.whatsNew.film.help'), icon: 'book-open', onClick: () => this.run((a) => a.openGuides()) });
            textButton(buttons, { text: t('panels.whatsNew.film.changelog'), onClick: () => window.open(WHATS_NEW_CHANGELOG, '_blank') });
        } else {
            const tryIt = textButton(buttons, {
                text: t('panels.whatsNew.tryIt'),
                cls: 'etz-whatsnew-try',
                onClick: () => {
                    const chart = this.currentChart();
                    if (chart) this.run((a) => a.tryExample(chart));
                },
            });
            tryIt.el.setAttr('aria-label', t('panels.whatsNew.tryItLabel'));
        }
        return el;
    }

    /** A live chart filling the stage, with its player (steps, the clock) or its sliders under it. */
    private demoChart(stage: HTMLElement, x: WhatsNewSlide, i: number) {
        const live = new LiveChart(stage, whatsNewChartOf(x.chart ?? ''), liveOptions({ maxSliders: x.sliders ?? 1 }));
        this.lives.set(i, live);
    }

    /** Ask your chart: a chart that opens its questions when a curve is clicked; an answer goes into the chart. */
    private demoAsk(stage: HTMLElement, x: WhatsNewSlide, i: number) {
        this.asks.set(i, new AskChart(stage, whatsNewChartOf(x.chart ?? ''), this));
    }

    /** Close first, then act: the editor (or its Replace dialog) opens on its own, not under the popup. */
    private run(action: (actions: WhatsNewActions) => void) {
        this.close();
        action(this.opts.actions);
    }
}

/** The live chart of a slide: one slider row (unless more), the labels and classes of What's new. */
function liveOptions(more: Partial<LiveChartOptions> = {}): LiveChartOptions {
    return {
        label: t('panels.whatsNew.chartLabel'),
        sliders: t('panels.whatsNew.sliderGroup'),
        play: (name) => t('panels.whatsNew.play', { name }),
        pause: (name) => t('panels.whatsNew.pause', { name }),
        boxCls: 'etz-whatsnew-chart',
        stripCls: 'etz-whatsnew-strip',
        maxSliders: 1,
        ...more,
    };
}

/**
 * The film: its poster (inside the plugin) with a play button, and after a
 * click YouTube's player in its place. Leaving the slide or closing the
 * popup removes the player, so the sound stops and the poster is back.
 */
class FilmPlayer {
    private readonly poster: HTMLButtonElement;
    private frame: HTMLIFrameElement | null = null;

    constructor(private readonly stage: HTMLElement) {
        this.poster = stage.createEl('button', { cls: 'etz-whatsnew-poster', attr: { type: 'button' } });
        // The button's name in hidden text: the play sign says it to the eye, and no tooltip covers the poster.
        visuallyHidden(this.poster, t('panels.whatsNew.film.play', { length: WHATS_NEW_FILM.length }));
        this.poster.createEl('img', { cls: 'etz-whatsnew-poster-img', attr: { src: FILM_POSTER, alt: '', draggable: 'false' } });
        setIcon(this.poster.createSpan({ cls: 'etz-whatsnew-poster-play', attr: { 'aria-hidden': 'true' } }), 'play');
        this.poster.createSpan({ cls: 'etz-whatsnew-poster-length', text: WHATS_NEW_FILM.length, attr: { 'aria-hidden': 'true' } });
        this.poster.addEventListener('click', () => this.play());
    }

    /** The player in place of the poster; it starts the film (a click asked for it). */
    play(): void {
        if (this.frame || !this.stage.isConnected) return;
        const frame = this.stage.createEl('iframe', {
            cls: 'etz-whatsnew-player',
            attr: {
                src: WHATS_NEW_FILM.embed,
                title: t('panels.whatsNew.film.player'),
                allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
                allowfullscreen: 'true',
                referrerpolicy: 'strict-origin-when-cross-origin',
            },
        });
        this.frame = frame;
        this.poster.addClass('tikz-hidden');
        frame.focus();
    }

    /** The poster again; the player and its sound are gone. */
    stop(): void {
        if (!this.frame) return;
        this.frame.remove();
        this.frame = null;
        this.poster.removeClass('tikz-hidden');
    }
}

/**
 * The chart of the Ask slide: drawn as a live chart is (no sliders), and
 * asked as the chart under a block is (src/notes6/askHost.ts). A click on a
 * curve that does not move, or Enter on the chart, opens the questions;
 * an answer goes into this chart (the popup's own copy).
 */
class AskChart {
    private data: Record<string, unknown>;
    private readonly box: HTMLElement;
    private svg: SVGSVGElement | null = null;
    private drawn: { layout: RenderLayout; drawn: DrawnScene; pixelScale: number } | null = null;
    private math: MathContext | null = null;
    private readonly ask: AskController;
    private destroyed = false;

    constructor(parent: HTMLElement, data: Record<string, unknown>, keys: Modal) {
        this.data = SettingsManager.fromJSON(cloneData(data)).serialize();
        this.box = parent.createDiv({ cls: ['etz-live-chart', 'etz-whatsnew-chart', 'etz-askable'], attr: { tabindex: '0', role: 'button', 'aria-haspopup': 'menu' } });
        const name = visuallyHidden(parent, t('panels.whatsNew.askLabel'));
        name.id = uniqueId('whatsnew-ask');
        this.box.setAttr('aria-labelledby', name.id);
        this.ask = new AskController({
            data: () => cloneData(this.data),
            math: () => this.math ?? this.mathOf(SettingsManager.fromJSON(this.data)),
            drawn: () => {
                const svg = this.svg;
                const d = this.drawn;
                if (!d || !svg || !svg.isConnected) return null;
                const b = svgBoxOf(svg, d.layout);
                return b ? { layout: d.layout, drawn: d.drawn, svg, box: b, pixelScale: d.pixelScale } : null;
            },
            apply: (next) => {
                this.data = next;
                this.render();
            },
            focusEl: () => this.box,
            trapEscape: (fn) => trapEscape(keys, fn),
        });
        let down: { id: number; x: number; y: number; touch: boolean } | null = null;
        this.box.addEventListener('pointerdown', (e) => {
            if (e.button === 0) down = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' };
        });
        this.box.addEventListener('pointerup', (e) => {
            const d = down;
            down = null;
            // A click that did not move: a drag is no question.
            if (!d || d.id !== e.pointerId || Math.hypot(e.clientX - d.x, e.clientY - d.y) > (d.touch ? 10 : 5)) return;
            this.ask.at(e.clientX, e.clientY, d.touch);
        });
        this.box.addEventListener('pointercancel', () => (down = null));
        this.box.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.target !== this.box) return;
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                if (this.ask.fromKeyboard()) e.preventDefault();
            }
        });
        this.render();
        // The first drawing does not know the box's size yet: draw again once it does.
        window.requestAnimationFrame(() => this.render());
    }

    /** The chart as it is now, with the answers chosen: what Try it opens. */
    chart(): Record<string, unknown> {
        return cloneData(this.data);
    }

    destroy(): void {
        this.destroyed = true;
        this.ask.close();
        this.svg = null;
    }

    /** The chart's math, its sliders set. */
    private mathOf(settings: SettingsManager): MathContext {
        const math = settings.createMathContext({ memo: false });
        const params: unknown = settings.getValue('parameters');
        math.setParams(Array.isArray(params) ? (params as Parameter[]) : []);
        return math;
    }

    private render(): void {
        if (this.destroyed) return;
        try {
            const settings = SettingsManager.fromJSON(this.data);
            const math = this.mathOf(settings);
            const config = settings.toRendererConfig(math);
            const aspect = config.width > 0 && config.height > 0 ? config.width / config.height : 1.25;
            this.box.setCssProps({ '--etz-live-aspect': String(Math.round(aspect * 1000) / 1000) });
            const pixelScale = fitPixelScale(this.box.clientWidth, this.box.clientHeight, config.width, config.height);
            const renderer = new SVGRenderer(config, { math, quality: 'full', pixelScale });
            const svg = renderer.render() as SVGSVGElement;
            svg.addClass('etz-live-svg');
            if (this.svg && this.svg.parentElement === this.box) this.svg.replaceWith(svg);
            else this.box.prepend(svg);
            this.svg = svg;
            this.math = math;
            this.drawn = renderer.layout && renderer.drawn ? { layout: renderer.layout, drawn: renderer.drawn, pixelScale } : null;
        } catch {
            // The last drawing stays.
        }
    }
}
