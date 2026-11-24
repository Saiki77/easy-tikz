/*
 * The menu of Ask the curve (6.0 B): the questions about what was clicked,
 * by group, each a menu item that says whether its answer is in the chart
 * already. Pointing at a question (or moving the focus onto it) shows its
 * answer faintly; choosing it (click, tap, Enter or Space) adds the answer,
 * or takes it away when it is there. Arrow keys, Home and End move between
 * the questions; Escape and a press outside close the menu. Shared by the
 * editor's preview and the chart under a block in Live Preview.
 */
import type { Question } from './ask';
import { t } from '../i18n';

export interface AskMenuOptions {
    /** Where the menu opens, in client px (it stays inside the window). */
    at: { x: number; y: number };
    /** The menu's heading: what was clicked (f(x) = x^2 - 4). */
    title: string;
    questions: Question[];
    /** Is the question's answer in the chart already? */
    present(q: Question): boolean;
    /** Show the answer faintly (null: show the chart as it is). */
    preview(q: Question | null): void;
    choose(q: Question): void;
    /** The menu closed (chosen, Escape, a press outside). */
    closed?(): void;
    /** Move the focus to the first question (opened from the keyboard). */
    focus?: boolean;
    /** Where the focus goes back to after Escape; the menu mounts in its modal, if it is in one. */
    returnFocus?: HTMLElement | null;
    /** Take Escape before anyone else (the editor's key scope); returns the release. Without it, a window listener. */
    trapEscape?(onEscape: () => void): () => void;
}

export interface AskMenuHandle {
    el: HTMLElement;
    close(): void;
}

let open: AskMenuHandle | null = null;

/** The open menu, if any. */
export function openAskMenu(): AskMenuHandle | null {
    return open && open.el.isConnected ? open : null;
}

/** Open the menu (closing one that is open). */
export function showAskMenu(o: AskMenuOptions): AskMenuHandle {
    open?.close();
    const doc = o.returnFocus?.ownerDocument ?? activeDocument;
    const win = doc.defaultView ?? window;
    // In a modal (the editor) the menu mounts in its container: inside its focus trap and above it.
    const mount = o.returnFocus?.closest<HTMLElement>('.modal-container') ?? doc.body;
    const el = mount.createDiv({ cls: 'etz-ask-menu etz-tokens', attr: { role: 'menu', 'aria-label': t('notes6.ask.menu', { name: o.title }) } });
    el.createDiv({ cls: 'etz-ask-title', text: o.title, attr: { 'aria-hidden': 'true' } });
    const items: HTMLButtonElement[] = [];
    let previewing: Question | null = null;
    const setPreview = (q: Question | null) => {
        if (previewing === q) return;
        previewing = q;
        o.preview(q);
    };
    let group = '';
    const list = el.createDiv({ cls: 'etz-ask-list' });
    if (!o.questions.length) list.createDiv({ cls: 'etz-ask-empty', text: t('notes6.ask.none') });
    for (const q of o.questions) {
        if (q.group !== group) {
            group = q.group;
            list.createDiv({ cls: 'etz-ask-group', text: group, attr: { role: 'presentation' } });
        }
        const on = o.present(q);
        const b = list.createEl('button', { cls: 'etz-ask-item', attr: { type: 'button', role: 'menuitemcheckbox', 'aria-checked': on ? 'true' : 'false', tabindex: '-1' } });
        b.createSpan({ cls: 'etz-ask-box', text: on ? '✓' : '', attr: { 'aria-hidden': 'true' } });
        b.createSpan({ cls: 'etz-ask-text', text: q.label });
        b.addEventListener('pointerenter', (e) => {
            if (e.pointerType !== 'touch') setPreview(q);
        });
        b.addEventListener('pointerleave', (e) => {
            if (e.pointerType !== 'touch' && previewing === q) setPreview(null);
        });
        b.addEventListener('focus', () => setPreview(q));
        b.addEventListener('click', (e) => {
            e.preventDefault();
            handle.close();
            o.choose(q);
        });
        items.push(b);
    }
    el.createDiv({ cls: 'etz-ask-hint', text: t('notes6.ask.hint') });

    const move = (to: number) => {
        if (!items.length) return;
        const i = (to + items.length) % items.length;
        items.forEach((b, k) => b.setAttr('tabindex', k === i ? '0' : '-1'));
        items[i].focus();
    };
    el.addEventListener('keydown', (e) => {
        const at = items.findIndex((b) => b === doc.activeElement);
        if (e.key === 'ArrowDown') move(at + 1);
        else if (e.key === 'ArrowUp') move(at < 0 ? items.length - 1 : at - 1);
        else if (e.key === 'Home') move(0);
        else if (e.key === 'End') move(items.length - 1);
        else if (e.key === 'Tab') {
            handle.close();
            return;
        } else return;
        e.preventDefault();
        e.stopPropagation();
    });
    // Escape first (before the editor or the selection take it), and a press outside closes.
    const escape = () => {
        const back = o.returnFocus;
        handle.close();
        back?.focus({ preventScroll: true });
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        escape();
    };
    const onPress = (e: PointerEvent) => {
        if (!(e.target instanceof Node && el.contains(e.target))) handle.close();
    };
    const release = o.trapEscape ? o.trapEscape(escape) : null;
    if (!release) win.addEventListener('keydown', onKey, true);
    // After this press (the one that opened the menu) has ended.
    const arm = win.setTimeout(() => doc.addEventListener('pointerdown', onPress, true), 0);

    let closed = false;
    const handle: AskMenuHandle = {
        el,
        close: () => {
            if (closed) return;
            closed = true;
            win.clearTimeout(arm);
            if (release) release();
            else win.removeEventListener('keydown', onKey, true);
            doc.removeEventListener('pointerdown', onPress, true);
            setPreview(null);
            el.remove();
            if (open === handle) open = null;
            o.closed?.();
        },
    };
    open = handle;
    place(el, o.at, win);
    if (o.focus) move(0);
    else if (items.length) items[0].setAttr('tabindex', '0');
    return handle;
}

/** Beside the point, inside the window. */
function place(el: HTMLElement, at: { x: number; y: number }, win: Window) {
    const margin = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = at.x + 12;
    let top = at.y + 12;
    if (left + w > win.innerWidth - margin) left = Math.max(margin, at.x - 12 - w);
    if (top + h > win.innerHeight - margin) top = Math.max(margin, win.innerHeight - margin - h);
    el.setCssProps({ '--etz-ask-left': `${Math.round(left)}px`, '--etz-ask-top': `${Math.round(top)}px` });
}

/**
 * The answer faintly: every element of `next` that `before` did not have
 * (a path, a dot, a text that is new or moved) is drawn at low opacity.
 */
export function markNew(before: Element | null, next: Element): void {
    const seen = new Map<string, number>();
    const sign = (e: Element) => {
        const parts = [e.tagName];
        for (const a of ['d', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'width', 'height', 'transform']) {
            const v = e.getAttribute(a);
            if (v !== null) parts.push(`${a}=${v}`);
        }
        if (!e.children.length) parts.push(e.textContent ?? '');
        return parts.join('|');
    };
    const leaves = (root: Element) => Array.from(root.querySelectorAll('path, circle, line, polyline, polygon, text, foreignObject, image, rect'));
    if (before) for (const e of leaves(before)) seen.set(sign(e), (seen.get(sign(e)) ?? 0) + 1);
    for (const e of leaves(next)) {
        const s = sign(e);
        const n = seen.get(s) ?? 0;
        if (n > 0) {
            seen.set(s, n - 1);
            continue;
        }
        e.classList.add('etz-ask-faint');
    }
}
