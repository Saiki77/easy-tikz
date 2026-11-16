/*
 * "What's new" popup for people who updated (when it opens: main.ts and
 * src/whatsnew.ts; what it says: src/whatsnew.ts). A slideshow: one feature
 * of 5.0 per slide, shown big with live charts, then version 4 in a list.
 *
 *   header      "Easy Graphs Charts and TikZ 5" and one line
 *   slide       icon, title and a sentence, then the feature: a note with
 *               the formula card open on a formula; a chart beside its text;
 *               two charts whose connected sliders move together; the vault
 *               with a chart's SVG file and the picture it holds
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
import { errorText } from '../util';
import { chartSvgElement } from '../svgFiles';
import { parseChartText } from '../text/parse';
import { ChartLanguage, chartLanguage, wordsToFull } from '../text/full';
import { tableAbove } from '../beyond/table';
import {
    WHATS_NEW_AI,
    WHATS_NEW_CHART_GUIDE,
    WHATS_NEW_FORMULA,
    WHATS_NEW_MORE,
    WHATS_NEW_SLIDES,
    WHATS_NEW_TITLE,
    WhatsNewSlide,
    whatsNewChart,
    whatsNewSubtitle,
    whatsNewText,
    WhatsNewItem,
} from '../whatsnew';
import { TextButtonHandle, segmented, textButton, uniqueId } from './kit';
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
        const example = WHATS_NEW_SLIDES[this.index]?.example;
        if (example) return parseChartText(example).data;
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

        const demo = el.createDiv({ cls: ['etz-whatsnew-demo', `mod-${x.id}`] });
        const lives: LiveChart[] = [];
        this.lives.set(i, lives);
        try {
            if (x.id === 'formulas') this.demoFormula(demo, lives);
            else if (x.id === 'language') this.demoLanguage(demo, x, lives);
            else if (x.id === 'connected') this.demoConnected(demo, x, lives);
            else if (x.id === 'svg') this.demoSvg(demo, x);
            else if (x.id === 'data') this.demoData(demo, x, lives);
            else if (x.id === 'earlier') this.demoEarlier(demo);
            else this.demoChart(demo, x, lives);
        } catch (e) {
            // Never on a working install, but the popup must still show the slide's words.
            demo.empty();
            demo.createDiv({ cls: 'etz-whatsnew-fallback', text: t('panels.whatsNew.drawFailed', { message: errorText(e) }) });
        }
        return el;
    }

    /** Every formula is a chart: a note's sentence with the formula under the pointer, the card that opens on it, and what Insert chart writes. */
    private demoFormula(demo: HTMLElement, lives: LiveChart[]) {
        const note = demo.createDiv({ cls: 'etz-whatsnew-hero' });
        note.createDiv({ cls: 'etz-whatsnew-recipe-title', text: t('panels.whatsNew.noteTitle') });
        const sentence = note.createEl('p', { cls: 'etz-whatsnew-note-text' });
        // Filled when the sentence places the formula (a holder: TypeScript does not see the callback assign it).
        const marked: { el: HTMLElement | null } = { el: null };
        appendWithPlaces(sentence, t('panels.whatsNew.note'), {
            formula: (into) => {
                // Marked as in a note with a chart open on it, and the pointer resting there.
                const mark = into.createSpan({ cls: 'etz-whatsnew-formula' });
                marked.el = mark;
                typeset(mark.createSpan(), WHATS_NEW_FORMULA);
                setIcon(mark.createSpan({ cls: 'etz-whatsnew-pointer', attr: { 'aria-hidden': 'true' } }), 'mouse-pointer-2');
            },
        });
        const stage = note.createDiv({ cls: 'etz-whatsnew-stage' });
        // The card as it opens on the formula: the formula and what it is, then the chart with its slider.
        const card = stage.createDiv({ cls: 'etz-whatsnew-card' });
        const head = card.createDiv({ cls: 'etz-formula-head' });
        typeset(head.createDiv({ cls: 'etz-formula-tex' }), WHATS_NEW_FORMULA);
        head.createSpan({ cls: 'etz-formula-kind', text: t('plugin.formula.kind.function') });
        lives.push(new LiveChart(card, whatsNewChart(), live()));

        // Beside the card: the block Insert chart writes under the paragraph, and how to play with it.
        const side = stage.createDiv({ cls: 'etz-whatsnew-side' });
        this.recipe(side, t('panels.whatsNew.recipe'), ['```easy-tikz', whatsNewText(), '```'].join('\n'));
        const caption = side.createDiv({ cls: 'etz-whatsnew-caption' });
        const chartGuide = localGuideById(WHATS_NEW_CHART_GUIDE);
        appendWithPlaces(caption, chartGuide ? t('panels.whatsNew.captionWithGuide') : t('panels.whatsNew.caption'), {
            slider: (into) => into.createEl('code', { text: 'a' }),
            guide: (into) => {
                if (chartGuide) this.guideLink(into, chartGuide.title, WHATS_NEW_CHART_GUIDE);
            },
        });

        // The card's tip points at the formula, wherever the sentence puts it.
        const formula = marked.el;
        if (formula) {
            const placeTip = () => {
                const at = formula.getBoundingClientRect();
                const box = card.getBoundingClientRect();
                if (!box.width) return;
                const x = Math.max(18, Math.min(box.width - 18, at.left + at.width / 2 - box.left));
                card.setCssProps({ '--etz-tip-x': `${Math.round(x)}px` });
            };
            this.resize?.disconnect();
            this.resize = new ResizeObserver(placeTip);
            this.resize.observe(note);
            this.resize.observe(formula);
        }
    }

    /** LaTeX is the chart language: a chart, and the text it is written in, in either chart language (the setting Chart language). */
    private demoLanguage(demo: HTMLElement, x: WhatsNewSlide, lives: LiveChart[]) {
        const frame = demo.createDiv({ cls: 'etz-whatsnew-frame' });
        lives.push(new LiveChart(frame, parseChartText(x.charts[0]).data, live()));
        const side = demo.createDiv({ cls: 'etz-whatsnew-side' });
        const forms: Record<ChartLanguage, string> = { words: x.charts[0], full: wordsToFull(x.charts[0]) };
        const block = (lang: ChartLanguage) => ['```easy-tikz', forms[lang], '```'].join('\n');
        const start: ChartLanguage = chartLanguage() === 'full' ? 'full' : 'words';
        segmented<ChartLanguage>(side, {
            label: t('plugin.settings.chartLanguage.name'),
            options: [
                { value: 'words', text: t('plugin.settings.chartLanguage.words') },
                { value: 'full', text: t('plugin.settings.chartLanguage.full') },
            ],
            value: start,
            onChange: (lang) => pre.setText(block(lang)),
        });
        const pre = this.recipe(side, t('panels.whatsNew.languageWords'), block(start));
        side.createDiv({ cls: 'etz-whatsnew-caption', text: t('panels.whatsNew.languageNote') });
    }

    /** Connected sliders: two charts of a note with a slider a each; moving one moves the other. */
    private demoConnected(demo: HTMLElement, x: WhatsNewSlide, lives: LiveChart[]) {
        const pair = demo.createDiv({ cls: 'etz-whatsnew-pair' });
        const frames = x.charts.map(() => pair.createDiv({ cls: 'etz-whatsnew-frame' }));
        const partner: { live: LiveChart | null } = { live: null };
        const left = new LiveChart(frames[0], parseChartText(x.charts[0]).data, live({ onValue: (v) => partner.live?.follow(v) }));
        const right = new LiveChart(frames[1], parseChartText(x.charts[1]).data, live({ onValue: (v) => left.follow(v) }));
        partner.live = right;
        lives.push(left, right);
        x.charts.forEach((text, k) => {
            const lines = text.split('\n').filter((l) => /^(slider|plot)\b/.test(l));
            frames[k].createEl('pre', { cls: 'etz-whatsnew-text mod-small', text: lines.join('\n') });
        });
        // Between the two: they are connected.
        const link = pair.createDiv({ cls: 'etz-whatsnew-pair-link', attr: { 'aria-hidden': 'true' } });
        setIcon(link, 'link-2');
        pair.insertBefore(link, frames[1]);
    }

    /** Charts as SVG files: the note and its chart's file in the vault, the picture as the file shows it, and the line that embeds it. */
    private demoSvg(demo: HTMLElement, x: WhatsNewSlide) {
        const left = demo.createDiv({ cls: 'etz-whatsnew-side' });
        const files = left.createDiv({ cls: 'etz-whatsnew-files', attr: { role: 'list', 'aria-label': t('panels.whatsNew.svgVault') } });
        const file = (icon: string, name: string, cls = '') => {
            const row = files.createDiv({ cls: ['etz-whatsnew-file'].concat(cls ? [cls] : []), attr: { role: 'listitem' } });
            setIcon(row.createSpan({ cls: 'etz-whatsnew-file-icon', attr: { 'aria-hidden': 'true' } }), icon);
            row.createSpan({ text: name });
        };
        file('folder-open', 'Calculus', 'mod-folder');
        file('file-text', 'Week 3.md');
        file('file-image', 'Week 3 · chart 1.svg', 'is-new');
        this.recipe(left, t('panels.whatsNew.svgEmbed'), '![[Week 3 · chart 1.svg]]');
        const paper = demo.createDiv({ cls: 'etz-whatsnew-paper' });
        const svg = chartSvgElement(parseChartText(x.charts[0]).data, this.modalEl.ownerDocument);
        if (svg) {
            svg.setAttr('role', 'img');
            svg.setAttr('aria-label', t('panels.whatsNew.svgPicture'));
            paper.appendChild(svg);
        } else paper.createDiv({ cls: 'etz-whatsnew-fallback', text: t('plugin.formula.cannotDraw') });
    }

    /** Data and a regression line: the note's table and the chart that reads it. */
    private demoData(demo: HTMLElement, x: WhatsNewSlide, lives: LiveChart[]) {
        const rows = x.table ?? [];
        const side = demo.createDiv({ cls: 'etz-whatsnew-side' });
        const note = side.createDiv({ cls: 'etz-whatsnew-recipe' });
        note.createDiv({ cls: 'etz-whatsnew-recipe-title', text: t('panels.whatsNew.noteTitle') });
        // The table as the note shows it: the header row, then the body rows (the separator row is Markdown only).
        const cells = (row: string) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
        const table = note.createEl('table', { cls: 'etz-whatsnew-table' });
        const head = table.createEl('thead').createEl('tr');
        for (const c of cells(rows[0] ?? '')) head.createEl('th', { text: c });
        const body = table.createEl('tbody');
        for (const row of rows.slice(2)) {
            const tr = body.createEl('tr');
            for (const c of cells(row)) tr.createEl('td', { text: c });
        }
        note.createEl('pre', { cls: 'etz-whatsnew-text', text: ['```easy-tikz', ...x.charts[0].split('\n').filter((l) => !/^(size|show|axes|with)\b/.test(l)), '```'].join('\n') });
        const frame = demo.createDiv({ cls: 'etz-whatsnew-frame' });
        lives.push(new LiveChart(frame, parseChartText(x.charts[0]).data, live({ table: tableAbove([...rows, '```easy-tikz'], rows.length + 1) })));
    }

    /** A new kind of picture: the chart, live with its slider, and the text it is written in. */
    private demoChart(demo: HTMLElement, x: WhatsNewSlide, lives: LiveChart[]) {
        const frame = demo.createDiv({ cls: 'etz-whatsnew-frame' });
        lives.push(new LiveChart(frame, parseChartText(x.charts[0]).data, live()));
        const side = demo.createDiv({ cls: 'etz-whatsnew-side' });
        this.recipe(side, t('panels.whatsNew.languageWords'), ['```easy-tikz', x.charts[0], '```'].join('\n'));
    }

    /** Version 4: one line each. */
    private demoEarlier(demo: HTMLElement) {
        const grid = demo.createDiv({ cls: ['etz-whatsnew-list', 'mod-grid'] });
        for (const item of WHATS_NEW_MORE) this.item(grid, item);
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

/** The live chart of a slide: one slider row, the labels and classes of What's new. */
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
