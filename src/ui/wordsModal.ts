/*
 * Chart words, edited: one field per piece of the chart language, by group,
 * with the words a person gives it; words of their own for several options
 * at once; and their words as text to share (copy) or to take over (paste
 * into the box). Every word is checked as it is typed (a word belongs to one
 * piece, and never to a name formulas use). Closing saves; main.ts then
 * offers to rewrite charts that used words that changed (src/text/reword.ts).
 */
import { App, Modal } from 'obsidian';
import { parseChartText } from '../text/parse';
import { Bundle, ChartWords, GROUP_TITLES, PIECES, WordGroup, clean, wordProblem, wordsFromText, wordsToText } from '../text/words';
import { textButton, uniqueId } from './kit';

export interface WordsHost {
    /** The words now. */
    words(): ChartWords;
    /** Called once when the window closes with changed words. */
    changed(before: ChartWords, after: ChartWords): void;
    /** Copy text and say so. */
    copy(text: string, done: string): void;
}

const GROUPS: WordGroup[] = ['lines', 'phrases', 'options', 'colours'];

export class ChartWordsModal extends Modal {
    private readonly host: WordsHost;
    private before: ChartWords;
    private draft: ChartWords;
    private listEl!: HTMLElement;
    private bundlesEl!: HTMLElement;
    private search = '';

    constructor(app: App, host: WordsHost) {
        super(app);
        this.host = host;
        this.before = clean(host.words());
        this.draft = clean(host.words());
    }

    onOpen() {
        this.modalEl.addClass('etz-words', 'etz-tokens');
        this.titleEl.setText('Chart words');
        const { contentEl } = this;
        contentEl.createEl('p', {
            cls: 'etz-words-intro',
            text:
                'Give any piece of the chart language your own words, in your language or your own terms: plot can be graph, or zeichne. ' +
                'The built-in words keep working beside yours. Several words for one piece: separate them with commas; the first is the one the plugin writes.',
        });
        const find = contentEl.createEl('input', { cls: 'etz-words-find', type: 'search', attr: { placeholder: 'Find a piece', 'aria-label': 'Find a piece' } });
        find.addEventListener('input', () => {
            this.search = find.value.trim().toLowerCase();
            this.filter();
        });
        this.listEl = contentEl.createDiv({ cls: 'etz-words-groups' });
        this.renderPieces();

        const bundles = contentEl.createEl('section', { cls: 'etz-words-bundles' });
        const bundlesTitle = bundles.createEl('h3', { cls: 'etz-words-h', text: 'Your own words for several options' });
        bundlesTitle.id = uniqueId('words-bundles');
        bundles.setAttr('aria-labelledby', bundlesTitle.id);
        bundles.createEl('p', { cls: 'etz-words-hint', text: 'One word for options you use together, written like any option: objective for "in red, dashed", then draw 2x + 3y = c, objective.' });
        this.bundlesEl = bundles.createDiv({ cls: 'etz-words-bundle-rows' });
        this.renderBundles();
        textButton(bundles, {
            text: 'Add a word',
            size: 'sm',
            onClick: () => {
                this.draft.bundles.push({ word: '', means: '' });
                this.renderBundles();
                this.bundlesEl.querySelector<HTMLInputElement>('.etz-words-bundle:last-child input')?.focus();
            },
        });

        const share = contentEl.createEl('section', { cls: 'etz-words-share' });
        const shareTitle = share.createEl('h3', { cls: 'etz-words-h', text: 'Share your words' });
        shareTitle.id = uniqueId('words-share');
        share.setAttr('aria-labelledby', shareTitle.id);
        share.createEl('p', { cls: 'etz-words-hint', text: 'Copy your words as text, for a class or another vault. Paste words someone gave you into the box and take them over.' });
        const row = share.createDiv({ cls: 'etz-words-share-row' });
        textButton(row, { text: 'Copy your words', size: 'sm', onClick: () => this.host.copy(wordsToText(clean(this.draft)), 'Your chart words are on the clipboard.') });
        const box = share.createEl('textarea', { cls: 'etz-words-paste', attr: { rows: '4', placeholder: 'Paste words here, one piece per line, such as: plot = graph', 'aria-label': 'Words to take over' } });
        const note = share.createDiv({ cls: 'etz-words-note', attr: { role: 'status' } });
        textButton(share, {
            text: 'Take over these words',
            size: 'sm',
            onClick: () => {
                const read = wordsFromText(box.value, this.draft.write);
                note.setText(read.problems.length ? `Not read: ${read.problems.join('; ')}` : '');
                this.draft = read.words;
                this.renderPieces();
                this.renderBundles();
                this.filter();
            },
        });

        const actions = contentEl.createDiv({ cls: 'etz-dialog-actions' });
        textButton(actions, { text: 'Done', variant: 'cta', onClick: () => this.close() });
    }

    onClose() {
        const after = clean(this.draft);
        this.contentEl.empty();
        if (JSON.stringify(after) !== JSON.stringify(this.before)) this.host.changed(this.before, after);
    }

    /** The draft without one piece's words (or one bundle): what a word is checked against. */
    private others(id: string | null, bundle?: Bundle): ChartWords {
        const words = { ...this.draft.words };
        if (id) delete words[id];
        return { words, bundles: this.draft.bundles.filter((b) => b !== bundle && b.word), write: this.draft.write };
    }

    private renderPieces() {
        this.listEl.empty();
        for (const group of GROUPS) {
            const box = this.listEl.createEl('section', { cls: 'etz-words-group' });
            const h = box.createEl('h3', { cls: 'etz-words-h', text: GROUP_TITLES[group] });
            h.id = uniqueId('words-group');
            box.setAttr('aria-labelledby', h.id);
            for (const p of PIECES.filter((x) => x.group === group)) {
                const row = box.createDiv({ cls: 'etz-words-piece', attr: { 'data-find': `${p.builtin} ${p.what}`.toLowerCase() } });
                const what = row.createDiv({ cls: 'etz-words-what' });
                what.createEl('code', { text: p.builtin });
                what.createSpan({ text: p.what });
                const input = row.createEl('input', {
                    type: 'text',
                    value: (this.draft.words[p.id] ?? []).join(', '),
                    attr: { placeholder: p.builtin, 'aria-label': `Your words for ${p.builtin}`, spellcheck: 'false' },
                });
                const note = row.createDiv({ cls: 'etz-words-note', attr: { role: 'status' } });
                input.addEventListener('change', () => {
                    const others = this.others(p.id);
                    const kept: string[] = [];
                    const problems: string[] = [];
                    for (const w of input.value.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean)) {
                        const why = wordProblem(w, p.id, { ...others, words: { ...others.words, [p.id]: kept } });
                        if (why) problems.push(why);
                        else kept.push(w);
                    }
                    if (kept.length) this.draft.words[p.id] = kept;
                    else delete this.draft.words[p.id];
                    note.setText(problems.join(' '));
                    input.toggleClass('is-bad', problems.length > 0);
                    row.setAttr('data-find', `${p.builtin} ${p.what} ${kept.join(' ')}`.toLowerCase());
                });
            }
        }
        this.filter();
    }

    private renderBundles() {
        this.bundlesEl.empty();
        for (const b of this.draft.bundles) {
            const row = this.bundlesEl.createDiv({ cls: 'etz-words-bundle' });
            const word = row.createEl('input', { type: 'text', value: b.word, attr: { placeholder: 'Your word', 'aria-label': 'Your own word', spellcheck: 'false' } });
            const means = row.createEl('input', { type: 'text', value: b.means, attr: { placeholder: 'Stands for, such as: in red, dashed', 'aria-label': 'What it stands for', spellcheck: 'false' } });
            textButton(row, {
                text: 'Remove',
                size: 'sm',
                onClick: () => {
                    this.draft.bundles = this.draft.bundles.filter((x) => x !== b);
                    this.renderBundles();
                },
            });
            const note = row.createDiv({ cls: 'etz-words-note', attr: { role: 'status' } });
            const check = () => {
                const w = word.value.trim().replace(/\s+/g, ' ');
                const why = w ? wordProblem(w, null, this.others(null, b)) : '';
                b.word = why ? '' : w;
                b.means = means.value.trim();
                // What it stands for must read as options of a line, in these words.
                let wrong = '';
                if (b.word && b.means) {
                    const probe = parseChartText(`plot q(x) = x, ${b.word}`, { words: clean(this.draft) });
                    if (probe.problems.length) wrong = `"${b.means}" is not a list of options: ${probe.problems[0].message}`;
                }
                note.setText([why, wrong].filter(Boolean).join(' '));
                word.toggleClass('is-bad', !!why);
                means.toggleClass('is-bad', !!wrong);
            };
            word.addEventListener('change', check);
            means.addEventListener('change', check);
        }
    }

    private filter() {
        const q = this.search;
        for (const row of Array.from(this.listEl.querySelectorAll<HTMLElement>('.etz-words-piece'))) {
            row.toggleClass('tikz-hidden', !!q && !(row.getAttribute('data-find') ?? '').includes(q));
        }
        for (const group of Array.from(this.listEl.querySelectorAll<HTMLElement>('.etz-words-group'))) {
            group.toggleClass('tikz-hidden', !group.querySelector('.etz-words-piece:not(.tikz-hidden)'));
        }
    }
}
