/*
 * The + Add picker (5.1): what can be added to a chart, with a search field
 * on top, the groups on the left and the items of one group on the right,
 * each with its one-line hint. Typing searches every group: the names, the
 * hints and a few other words people use (vector, gaussian, integral). The
 * arrow keys choose, Enter adds, Tab moves to the next group while the field
 * is empty, Escape closes the picker (not the editor around it).
 */
import { setIcon } from 'obsidian';
import { t } from '../i18n';
import { uniqueId } from './kit';

export interface PickerGroup {
    id: string;
    title: string;
    icon: string;
}

export interface PickerItem {
    label: string;
    hint: string;
    icon: string;
    /** The id of its group. */
    group: string;
    /** More words that find it (English): vector for Arrow. */
    words?: string;
    run(): void;
}

export interface PickerContent {
    groups: PickerGroup[];
    items: PickerItem[];
}

export interface PickerOptions {
    /** While the picker is open, Escape closes it: returns the function that lets the key go again. */
    trapEscape(onEscape: () => void): () => void;
    /** The side of the button the picker lines up with. */
    align?: 'start' | 'end';
}

export interface PickerHandle {
    open(): void;
    close(): void;
}

/** Most of the window, at most this wide (px). */
const PICKER_W = 580;

/** Make `button` open the picker of `content()`, made fresh on every open. */
export function addPicker(button: HTMLElement, content: () => PickerContent, opts: PickerOptions): PickerHandle {
    button.setAttr('aria-haspopup', 'dialog');
    button.setAttr('aria-expanded', 'false');
    let pop: HTMLElement | null = null;
    let release: (() => void) | null = null;
    let detach: (() => void) | null = null;

    const close = (focusButton = false): void => {
        if (!pop) return;
        pop.remove();
        pop = null;
        release?.();
        release = null;
        detach?.();
        detach = null;
        button.removeClass('has-active-menu');
        button.setAttr('aria-expanded', 'false');
        if (focusButton) button.focus();
    };

    const open = (): void => {
        if (pop) return;
        const { groups, items } = content();
        if (!items.length) return;
        const doc = button.ownerDocument;
        const win = doc.defaultView ?? window;
        const el = doc.body.createDiv({ cls: 'etz-picker', attr: { role: 'dialog', 'aria-label': t('build.picker.label') } });
        pop = el;
        button.addClass('has-active-menu');
        button.setAttr('aria-expanded', 'true');

        const search = el.createDiv({ cls: 'etz-picker-search' });
        setIcon(search.createSpan({ cls: 'etz-picker-icon', attr: { 'aria-hidden': 'true' } }), 'search');
        const input = search.createEl('input', {
            cls: 'etz-picker-input',
            type: 'text',
            attr: { placeholder: t('build.picker.search'), 'aria-label': t('build.picker.search'), autocomplete: 'off', spellcheck: 'false' },
        });
        const body = el.createDiv({ cls: 'etz-picker-body' });
        const titles = new Map(groups.map((g) => [g.id, g.title]));
        const counts = new Map<string, number>();
        for (const item of items) counts.set(item.group, (counts.get(item.group) ?? 0) + 1);
        const shownGroups = groups.filter((g) => (counts.get(g.id) ?? 0) > 0);
        const rail = shownGroups.length > 1 ? body.createDiv({ cls: 'etz-picker-rail', attr: { role: 'group', 'aria-label': t('build.picker.groups') } }) : null;
        if (!rail) body.addClass('is-single');
        const list = body.createDiv({ cls: 'etz-picker-list', attr: { role: 'listbox', 'aria-label': t('build.picker.label') } });
        list.id = uniqueId('picker-list');
        input.setAttr('aria-controls', list.id);
        el.createDiv({ cls: 'etz-picker-foot', text: rail ? t('build.picker.keys') : t('build.picker.keysSingle') });

        let group = shownGroups[0]?.id ?? '';
        let shown: PickerItem[] = [];
        let sel = 0;
        const railButtons = new Map<string, HTMLButtonElement>();

        const mark = (): void => {
            const rows = Array.from(list.querySelectorAll<HTMLElement>('.etz-picker-item'));
            rows.forEach((row, i) => {
                row.toggleClass('is-selected', i === sel);
                row.setAttr('aria-selected', String(i === sel));
            });
            const current = rows[sel];
            if (current) {
                input.setAttr('aria-activedescendant', current.id);
                current.scrollIntoView({ block: 'nearest' });
            } else input.removeAttribute('aria-activedescendant');
        };

        const choose = (item: PickerItem): void => {
            close();
            item.run();
        };

        const render = (): void => {
            const words = input.value.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0);
            const fits = (item: PickerItem) => {
                const text = `${item.label} ${item.hint} ${item.words ?? ''} ${titles.get(item.group) ?? ''}`.toLowerCase();
                return words.every((w) => text.includes(w));
            };
            shown = words.length ? items.filter(fits) : items.filter((item) => item.group === group);
            sel = Math.min(sel, Math.max(0, shown.length - 1));
            for (const [id, b] of railButtons) {
                const on = !words.length && id === group;
                b.toggleClass('is-on', on);
                b.setAttr('aria-pressed', String(on));
            }
            list.empty();
            if (!shown.length) {
                list.createDiv({ cls: 'etz-picker-empty', text: t('build.picker.nothing', { query: input.value.trim() }) });
                mark();
                return;
            }
            let last = '';
            shown.forEach((item, i) => {
                if (words.length && item.group !== last) {
                    list.createDiv({ cls: 'etz-picker-heading', text: titles.get(item.group) ?? item.group, attr: { role: 'presentation' } });
                    last = item.group;
                }
                const row = list.createDiv({ cls: 'etz-picker-item', attr: { role: 'option', 'aria-selected': 'false' } });
                row.id = `${list.id}-${i}`;
                setIcon(row.createSpan({ cls: 'etz-picker-icon', attr: { 'aria-hidden': 'true' } }), item.icon);
                const text = row.createSpan({ cls: 'etz-picker-text' });
                text.createSpan({ cls: 'etz-picker-label', text: item.label });
                if (item.hint) text.createSpan({ cls: 'etz-picker-hint', text: item.hint });
                row.addEventListener('pointermove', () => {
                    if (sel === i) return;
                    sel = i;
                    mark();
                });
                row.addEventListener('click', () => choose(item));
            });
            mark();
        };

        if (rail) {
            for (const g of shownGroups) {
                const b = rail.createEl('button', { cls: 'etz-picker-group', attr: { type: 'button', 'aria-pressed': 'false' } });
                setIcon(b.createSpan({ cls: 'etz-picker-icon', attr: { 'aria-hidden': 'true' } }), g.icon);
                b.createSpan({ cls: 'etz-picker-group-title', text: g.title });
                b.createSpan({ cls: 'etz-picker-count', text: String(counts.get(g.id) ?? 0) });
                b.addEventListener('click', () => {
                    input.value = '';
                    group = g.id;
                    sel = 0;
                    render();
                    input.focus();
                });
                railButtons.set(g.id, b);
            }
        }

        input.addEventListener('input', () => {
            sel = 0;
            render();
        });
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.isComposing) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!shown.length) return;
                sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
                mark();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const item = shown[sel];
                if (item) choose(item);
            } else if (e.key === 'Tab' && rail && !input.value) {
                e.preventDefault();
                const ids = shownGroups.map((g) => g.id);
                group = ids[(ids.indexOf(group) + (e.shiftKey ? -1 : 1) + ids.length) % ids.length];
                sel = 0;
                render();
            }
        });

        release = opts.trapEscape(() => close(true));
        // A press anywhere else closes the picker (the button's own click toggles it).
        const outside = (e: PointerEvent) => {
            const target = e.target instanceof Node ? e.target : null;
            if (pop && target && !pop.contains(target) && !button.contains(target)) close();
        };
        // A resized window would leave the picker where the button was.
        const resized = () => close();
        doc.addEventListener('pointerdown', outside, true);
        win.addEventListener('resize', resized);
        detach = () => {
            doc.removeEventListener('pointerdown', outside, true);
            win.removeEventListener('resize', resized);
        };

        render();
        place(el, button, win, opts.align ?? 'start');
        input.focus();
    };

    button.addEventListener('click', () => (pop ? close() : open()));
    return { open, close: () => close() };
}

/** Under the button, or above it when the window ends there; never past the window's sides. */
function place(el: HTMLElement, button: HTMLElement, win: Window, align: 'start' | 'end'): void {
    const r = button.getBoundingClientRect();
    const width = Math.min(PICKER_W, win.innerWidth - 16);
    el.setCssStyles({ width: `${width}px` });
    const x = Math.min(Math.max(8, align === 'end' ? r.right - width : r.left), Math.max(8, win.innerWidth - width - 8));
    const height = el.offsetHeight;
    const below = win.innerHeight - r.bottom - 8;
    const y = below >= height || below >= r.top ? r.bottom + 4 : Math.max(8, r.top - height - 4);
    el.setCssStyles({ left: `${x}px`, top: `${y}px` });
}
