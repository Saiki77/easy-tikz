/*
 * "What's new" popup for people who updated (when it opens: main.ts and
 * src/whatsnew.ts; what it says: src/whatsnew.ts). A slideshow: one feature
 * of 6.0 per slide, shown big with live charts, then the rest of 6.0, then
 * versions 5 and 4 in a list.
 *
 *   header      "Easy Graphs Charts and TikZ 6" and one line
 *   slide       icon, title and a sentence, then the feature: a live chart
 *               beside its text (with the player of steps and of the clock
 *               when it has them); a chart that asks its questions when a
 *               curve is clicked; a note with the card open on a set
 *   footer      the dots (one per slide), Open the guides, Try an example
 *               (the slide's chart in the editor), Back and Next (Done on
 *               the last slide); the arrow keys move between the slides
 *
 * A slide is built when it is first shown. The charts are drawn by the
 * plugin's own renderer, offline, like charts in a note. Everything they
 * start (play, draft and full render timers) stops in onClose. Nothing is
 * loaded from the network.
 */
import { App, Modal, finishRenderMath, loadMathJax, renderMath, setIcon } from 'obsidian';
import { localGuideById } from '../guides';
import { cloneData, errorText, fitPixelScale } from '../util';
import { parseChartText } from '../text/parse';
import { printChartText } from '../text/print';
import { SettingsManager } from '../settings';
import { MathContext } from '../mathcontext';
import { RenderLayout, DrawnScene, SVGRenderer } from '../renderer';
import { AskController, svgBoxOf } from '../notes6/askHost';
import { openAskMenu } from '../notes6/askMenu';
import {
    WHATS_NEW_AI,
    WHATS_NEW_ALSO,
    WHATS_NEW_FORMULA,
    WHATS_NEW_MORE,
    WHATS_NEW_NOTE_DEFINITION,
    WHATS_NEW_SLIDES,
    WHATS_NEW_TITLE,
    WHATS_NEW_V5,
    WhatsNewSlide,
    whatsNewCard,
    whatsNewSubtitle,
    WhatsNewItem,
} from '../whatsnew';
import { TextButtonHandle, textButton, trapEscape, uniqueId, visuallyHidden } from './kit';
import { LiveChart, LiveChartOptions } from './liveChart';
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


export class WhatsNewModal extends Modal {
    private readonly opts: WhatsNewOptions;
    /** The slides built so far (a slide is built when it is first shown), and their live charts. */
    private readonly slideEls = new Map<number, HTMLElement>();
    private readonly lives = new Map<number, LiveChart[]>();
    /** The chart of the Ask slide, by slide index. */
    private readonly asks = new Map<number, AskChart>();
    private index = 0;
    private actionsEl: HTMLElement | null = null;
    private dots: HTMLButtonElement[] = [];
    private counter: HTMLElement | null = null;
    private back: TextButtonHandle | null = null;
    private next: TextButtonHandle | null = null;
    private tryIt: TextButtonHandle | null = null;
    /** Keeps the tip of the formula card under the formula when the popup's width or the typeset formula changes. */
    private resize: ResizeObserver | null = null;

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

        // --- the slides: one feature each, shown big
        const deck = contentEl.createDiv({ cls: 'etz-whatsnew-deck', attr: { role: 'region', 'aria-roledescription': t('panels.whatsNew.slides'), 'aria-label': WHATS_NEW_TITLE } });

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
            dot.addEventListener('click', () => this.show(deck, i));
            return dot;
        });
        this.counter = actions.createSpan({ cls: 'etz-whatsnew-counter', attr: { 'aria-hidden': 'true' } });
        actions.createDiv({ cls: 'etz-whatsnew-spacer' });
        textButton(actions, { text: t('panels.whatsNew.openGuides'), icon: 'book-open', variant: 'ghost', onClick: () => this.run((a) => a.openGuides()) });
        this.tryIt = textButton(actions, {
            text: t('panels.whatsNew.tryExample'),
            onClick: () => {
                const chart = this.currentChart();
                if (chart) this.run((a) => a.tryExample(chart));
            },
        });
        this.back = textButton(actions, { text: t('panels.whatsNew.back'), icon: 'arrow-left', onClick: () => this.show(deck, this.index - 1) });
        this.next = textButton(actions, {
            text: t('panels.whatsNew.next'),
            variant: 'cta',
            onClick: () => (this.index < count - 1 ? this.show(deck, this.index + 1) : this.close()),
        });
        // The arrow keys move between the slides, except in a field or on a slider (there they change its value).
        modalEl.addEventListener('keydown', (e) => {
            const el = e.target instanceof HTMLElement ? e.target : null;
            if (e.altKey || e.ctrlKey || e.metaKey || (el && (el.closest('input, textarea, select') || el.isContentEditable))) return;
            if (e.key === 'ArrowRight' && this.index < count - 1) this.show(deck, this.index + 1);
            else if (e.key === 'ArrowLeft' && this.index > 0) this.show(deck, this.index - 1);
            else return;
            e.preventDefault();
        });

        this.show(deck, 0);
        // The top of the popup stays in view (focusing a button at the bottom would scroll a low window).
        this.next.el.focus({ preventScroll: true });
        contentEl.scrollTop = 0;
        if (this.opts.onShown) this.opts.onShown();
    }

    onClose() {
        openAskMenu()?.close();
        for (const ask of this.asks.values()) ask.destroy();
        this.asks.clear();
        this.resize?.disconnect();
        this.resize = null;
        for (const lives of this.lives.values()) for (const live of lives) live.destroy();
        this.lives.clear();
        this.slideEls.clear();
        this.actionsEl?.remove();
        this.actionsEl = null;
        this.contentEl.empty();
        if (this.opts.onClosed) this.opts.onClosed();
    }

    /** Show slide `i` (built the first time), sliding in from the side it comes from. */
    private show(deck: HTMLElement, i: number) {
        const count = WHATS_NEW_SLIDES.length;
        if (i < 0 || i >= count) return;
        const from = this.index;
        if (i !== from) {
            openAskMenu()?.close();
            this.slideEls.get(from)?.addClass('tikz-hidden');
            for (const live of this.lives.get(from) ?? []) live.pause();
        }
        this.index = i;
        let el = this.slideEls.get(i);
        if (!el) {
            el = this.buildSlide(deck, i);
            this.slideEls.set(i, el);
        } else {
            el.removeClass('tikz-hidden');
            for (const live of this.lives.get(i) ?? []) live.redraw();
        }
        if (i !== from && !activeWindow.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const dx = i > from ? 14 : -14;
            el.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
        }
        this.dots.forEach((dot, k) => dot.setAttr('aria-current', k === i ? 'step' : 'false'));
        this.counter?.setText(`${i + 1} / ${count}`);
        this.back?.setDisabled(i === 0);
        this.next?.setText(i === count - 1 ? t('panels.whatsNew.done') : t('panels.whatsNew.next'));
        this.tryIt?.el.toggleClass('tikz-hidden', WHATS_NEW_SLIDES[i].charts.length === 0);
        this.contentEl.scrollTop = 0;
    }

    /** The chart of the slide on screen as it is now (its slider where the reader left it): what Try an example opens. */
    private currentChart(): Record<string, unknown> | null {
        const ask = this.asks.get(this.index);
        if (ask) return ask.chart();
        const live = (this.lives.get(this.index) ?? [])[0];
        if (live) return live.chart();
        const first = WHATS_NEW_SLIDES[this.index]?.charts[0];
        return first ? parseChartText(first).data : null;
    }

    /** A slide: its icon, title and sentence, then the feature shown big. */
    private buildSlide(deck: HTMLElement, i: number): HTMLElement {
        const x = WHATS_NEW_SLIDES[i];
        const count = WHATS_NEW_SLIDES.length;
        const el = deck.createDiv({
            cls: 'etz-whatsnew-slide',
            attr: { role: 'group', 'aria-roledescription': t('panels.whatsNew.slide'), 'aria-label': t('panels.whatsNew.goTo', { n: i + 1, count, title: x.title }) },
        });
        const head = el.createDiv({ cls: 'etz-whatsnew-slide-head' });
        setIcon(head.createSpan({ cls: 'etz-whatsnew-icon', attr: { 'aria-hidden': 'true' } }), x.icon);
        const words = head.createDiv({ cls: 'etz-whatsnew-slide-words' });
        const title = words.createDiv({ cls: 'etz-whatsnew-slide-title-row' });
        title.createEl('h3', { cls: 'etz-whatsnew-slide-title', text: x.title });
        const guide = x.guide ? localGuideById(x.guide) : undefined;
        if (guide) {
            const link = this.guideLink(title, t('panels.whatsNew.guide'), guide.id, 'etz-whatsnew-item-guide');
            link.el.setAttr('aria-label', t('panels.whatsNew.guideLabel', { title: guide.title }));
        }
        codeText(words.createEl('p', { cls: 'etz-whatsnew-slide-text' }), x.text);

        const chart = x.id !== 'hover' && x.charts.length > 0;
        const demo = el.createDiv({ cls: ['etz-whatsnew-demo', `mod-${x.id}`, ...(chart ? ['mod-chart'] : [])] });
        const lives: LiveChart[] = [];
        this.lives.set(i, lives);
        try {
            if (x.id === 'hover') this.demoHover(demo, x, lives);
            else if (x.id === 'ask') this.demoAsk(demo, x, i);
            else if (x.id === 'also') this.demoAlso(demo);
            else if (x.id === 'earlier') this.demoEarlier(demo);
            else this.demoChart(demo, x, lives);
        } catch (e) {
            // Never on a working install, but the popup must still show the slide's words.
            demo.empty();
            demo.createDiv({ cls: 'etz-whatsnew-fallback', text: t('panels.whatsNew.drawFailed', { message: errorText(e) }) });
        }
        return el;
    }

    /** A new kind of picture: the chart, live with its sliders (and its player), and the text it is written in. */
    private demoChart(demo: HTMLElement, x: WhatsNewSlide, lives: LiveChart[]) {
        const frame = demo.createDiv({ cls: 'etz-whatsnew-frame' });
        lives.push(new LiveChart(frame, parseChartText(x.charts[0]).data, live({ maxSliders: x.sliders ?? 1 })));
        const side = demo.createDiv({ cls: 'etz-whatsnew-side' });
        this.recipe(side, t('panels.whatsNew.languageWords'), ['```easy-tikz', x.charts[0], '```'].join('\n'));
    }

    /** Ask the curve: a chart that opens its questions when a curve is clicked, and its block as the answers change it. */
    private demoAsk(demo: HTMLElement, x: WhatsNewSlide, i: number) {
        const frame = demo.createDiv({ cls: 'etz-whatsnew-frame' });
        const side = demo.createDiv({ cls: 'etz-whatsnew-side' });
        const pre = this.recipe(side, t('panels.whatsNew.askLines'), '');
        const show = (data: Record<string, unknown>) => pre.setText(['```easy-tikz', printChartText(data), '```'].join('\n'));
        const ask = new AskChart(frame, parseChartText(x.charts[0]).data, this, show);
        this.asks.set(i, ask);
        show(ask.chart());
        const hint = frame.createDiv({ cls: ['etz-whatsnew-caption', 'mod-ask'] });
        setIcon(hint.createSpan({ cls: 'etz-whatsnew-hint-icon', attr: { 'aria-hidden': 'true' } }), 'mouse-pointer-2');
        hint.createSpan({ text: t('panels.whatsNew.askHint') });
    }

    /** Hover reads sets and maps: a note's sentence with a set under the pointer, and the card that opens on it. */
    private demoHover(demo: HTMLElement, x: WhatsNewSlide, lives: LiveChart[]) {
        const note = demo.createDiv({ cls: 'etz-whatsnew-hero' });
        note.createDiv({ cls: 'etz-whatsnew-recipe-title', text: t('panels.whatsNew.noteTitle') });
        const sentence = note.createEl('p', { cls: 'etz-whatsnew-note-text' });
        // Filled when the sentence places the formula (a holder: TypeScript does not see the callback assign it).
        const marked: { el: HTMLElement | null } = { el: null };
        appendWithPlaces(sentence, t('panels.whatsNew.hoverNote'), {
            definition: (into) => typeset(into.createSpan(), WHATS_NEW_NOTE_DEFINITION),
            formula: (into) => {
                // Marked as in a note with a card open on it, and the pointer resting there.
                const mark = into.createSpan({ cls: 'etz-whatsnew-formula' });
                marked.el = mark;
                typeset(mark.createSpan(), WHATS_NEW_FORMULA);
                setIcon(mark.createSpan({ cls: 'etz-whatsnew-pointer', attr: { 'aria-hidden': 'true' } }), 'mouse-pointer-2');
            },
        });
        const stage = note.createDiv({ cls: 'etz-whatsnew-stage' });
        // The card as it opens on the set: the formula and what it is, the chart, where g comes from.
        const card = stage.createDiv({ cls: 'etz-whatsnew-card' });
        const head = card.createDiv({ cls: 'etz-formula-head' });
        typeset(head.createDiv({ cls: 'etz-formula-tex' }), WHATS_NEW_FORMULA);
        head.createSpan({ cls: 'etz-formula-kind', text: t('notes6.hover.kind.set') });
        lives.push(new LiveChart(card, parseChartText(x.charts[0]).data, live()));
        const fn = whatsNewCard()?.fn;
        if (fn) card.createDiv({ cls: 'etz-whatsnew-caption', text: t('notes6.hover.fromNote', { name: fn.name, body: fn.body }) });

        // Beside the card: more formulas that open a chart now.
        const side = stage.createDiv({ cls: 'etz-whatsnew-side' });
        const more = side.createDiv({ cls: 'etz-whatsnew-recipe' });
        more.createDiv({ cls: 'etz-whatsnew-recipe-title', text: t('panels.whatsNew.hoverMore') });
        const formulas = more.createEl('ul', { cls: 'etz-whatsnew-formulas' });
        for (const tex of HOVER_MORE) typeset(formulas.createEl('li'), tex);

        // The card's tip points at the formula, wherever the sentence puts it.
        const formula = marked.el;
        if (formula) {
            const placeTip = () => {
                const at = formula.getBoundingClientRect();
                const box = card.getBoundingClientRect();
                if (!box.width) return;
                const left = Math.max(18, Math.min(box.width - 18, at.left + at.width / 2 - box.left));
                card.setCssProps({ '--etz-tip-x': `${Math.round(left)}px` });
            };
            this.resize?.disconnect();
            this.resize = new ResizeObserver(placeTip);
            this.resize.observe(note);
            this.resize.observe(formula);
        }
    }

    /** The rest of 6.0: one line each. */
    private demoAlso(demo: HTMLElement) {
        const grid = demo.createDiv({ cls: ['etz-whatsnew-list', 'mod-grid'] });
        for (const item of WHATS_NEW_ALSO) this.item(grid, item);
    }

    /** Versions 5 and 4: one line each, under a heading per version. */
    private demoEarlier(demo: HTMLElement) {
        for (const [title, items] of [
            [t('panels.whatsNew.v5Title'), WHATS_NEW_V5],
            [t('panels.whatsNew.v4Title'), WHATS_NEW_MORE],
        ] as const) {
            demo.createEl('h4', { cls: 'etz-whatsnew-group-title', text: title });
            const grid = demo.createDiv({ cls: ['etz-whatsnew-list', 'mod-grid'] });
            for (const item of items) this.item(grid, item);
        }
        demo.createDiv({ cls: 'etz-whatsnew-hint', text: t('panels.whatsNew.hint') });
    }

    /** A titled panel of text: chart lines, a file, a line to paste. Returns its text. */
    private recipe(parent: HTMLElement, title: string, text: string): HTMLElement {
        const recipe = parent.createDiv({ cls: 'etz-whatsnew-recipe' });
        const head = recipe.createDiv({ cls: 'etz-whatsnew-recipe-title', text: title });
        head.id = uniqueId('whatsnew-recipe');
        return recipe.createEl('pre', { cls: 'etz-whatsnew-text', text, attr: { 'aria-labelledby': head.id } });
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
    private item(parent: HTMLElement, item: WhatsNewItem): HTMLElement {
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
        codeText(body.createDiv({ cls: 'etz-whatsnew-item-text' }), item.text);
        return row;
    }
}

/** The live chart of a slide: one slider row (unless more), the labels and classes of What's new. */
function live(more: Partial<LiveChartOptions> = {}): LiveChartOptions {
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

/** More formulas that open a chart in a note now (the hover slide). */
const HOVER_MORE = [
    'g: \\mathbb{R}^n \\to \\mathbb{R}',
    '\\lambda \\in [0, 1]',
    'g(\\lambda x + (1 - \\lambda) y) \\le \\lambda g(x) + (1 - \\lambda) g(y)',
    'A v = \\lambda v',
    'z_{n+1} = z_n^2 + c',
    '\\sum_{k=1}^{n} \\frac{1}{k^2}',
];

/**
 * The chart of the Ask slide: drawn as a live chart is (no sliders), and
 * asked as the chart under a block is (src/notes6/askHost.ts). A click on a
 * curve that does not move, or Enter on the chart, opens the questions;
 * an answer goes into this chart (the popup's own copy) and its block.
 */
class AskChart {
    private data: Record<string, unknown>;
    private readonly box: HTMLElement;
    private svg: SVGSVGElement | null = null;
    private drawn: { layout: RenderLayout; drawn: DrawnScene; pixelScale: number } | null = null;
    private math: MathContext | null = null;
    private readonly ask: AskController;
    private destroyed = false;

    constructor(parent: HTMLElement, data: Record<string, unknown>, keys: Modal, private readonly changed: (data: Record<string, unknown>) => void) {
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
                this.changed(this.chart());
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

    /** The chart as it is now, with the answers chosen: what Try an example opens. */
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
        const params = settings.getValue('parameters');
        math.setParams(Array.isArray(params) ? params : []);
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

/** Text with inline `backticks` as code. */
function codeText(el: HTMLElement, text: string): void {
    text.split('`').forEach((part, i) => {
        if (!part) return;
        if (i % 2 === 1) el.createEl('code', { text: part });
        else el.appendText(part);
    });
}


/**
 * Append `text`, a message whose named places are left unfilled, to `el`:
 * its words as text, and each {place} made by its function, so a
 * translation can put code or a link wherever its word order wants it.
 */
/** A formula typeset by Obsidian's MathJax; its TeX until MathJax is there (a vault without math has not loaded it). */
function typeset(el: HTMLElement, tex: string): void {
    el.setText(tex);
    void loadMathJax()
        .then(() => {
            el.empty();
            el.appendChild(renderMath(tex, false));
            return finishRenderMath();
        })
        .catch(() => el.setText(tex));
}

function appendWithPlaces(el: HTMLElement, text: string, places: Record<string, (into: HTMLElement) => void>): void {
    text.split(/\{(\w+)\}/).forEach((part, i) => {
        if (i % 2 === 0) {
            if (part) el.appendText(part);
        } else if (places[part]) places[part](el);
        else el.appendText(`{${part}}`);
    });
}
