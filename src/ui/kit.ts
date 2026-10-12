/*
 * Easy TikZ UI kit: the small typed building blocks every editor panel uses.
 * No framework. Each factory appends its DOM to `parent` and returns a
 * handle whose `el` is the root element. Setters on a handle never call the
 * component's own callbacks (no echo when a panel syncs values from
 * settings). Styles: src/ui/kit.css (class prefix `etz-`); design tokens
 * (--etz-*) live on `.tikz-modal` and `.etz-tokens` in src/styles.css, so
 * outside the editor (inline notes) add `etz-tokens` to a container.
 *
 * API overview
 *   uniqueId(prefix)                        'etz-<prefix>-<n>' for aria-controls / aria-labelledby
 *   visuallyHidden(parent, text)            screen-reader-only span (give it an id for aria-labelledby)
 *   iconButton(parent, {icon, label, onClick, size?, pressed?})
 *                                           .clickable-icon, aria-label only (Obsidian renders the tooltip)
 *   textButton(parent, {text, onClick, variant?, icon?, size?})
 *                                           variant 'default' | 'cta' | 'ghost' | 'link'
 *   segmented(parent, {label, options, value, onChange, fill?})
 *                                           radiogroup; arrows / Home / End move and select
 *   chip(parent, {label, value, onChange})  toggle button (aria-pressed) with a check mark
 *   liveSlider(parent, {min, max, step, value, label, onInput, onCommit?, readout?, format?, onRangeChange?})
 *                                           native range + Obsidian `slider` class; `input` event -> onInput,
 *                                           `change` -> onCommit; --slider-fill-ratio kept in sync on every set;
 *                                           ignores the wheel; values outside min..max widen the range
 *                                           (handle.input is exposed for pointerdown / pointerup listeners)
 *   numberInput(parent, {value, label, step?, min?, max?, onCommit, onInput?})
 *                                           Arrow Up/Down = step, Shift x10, Alt x0.1; commits on blur / Enter
 *   textInput(parent, {value, label?, placeholder?, onInput?, onCommit?, onEnter?, monospace?})
 *   exprInput(parent, {value, label, validate, onInput, onRewrite?, onAddParameter?, ...})
 *                                           monospace; message after 600 ms idle or on blur; quick-fix button
 *                                           from Issue.fix; handle.validate() / focus(selectText) match FieldHandle
 *   dropdown(parent, {label, options, value, onChange})
 *                                           native <select class="dropdown">; a missing value stays visible
 *   swatchPicker(parent, keys, {value, onChange})
 *                                           colour button + popover grid of COLOR_MAP (arrows, Escape)
 *   thicknessPicker(parent, {value, onChange})
 *                                           four line samples (segmented)
 *   disclosure(parent, {label, open?, onToggle?})
 *                                           button (aria-expanded / aria-controls) + body
 *   field(parent, {label, hint?, layout?})  label + control slot + hint; call bind(control) to link the label
 *   group(parent, title)                    small-caps section header + body (Chart tab groups)
 *   banner(parent, {text, actions?, note?}) 32 px notice row with buttons (draft restore, code edited)
 *   cardShell(parent, keys, {...})          card header (swatch, name badge with inline rename, summary,
 *                                           eye, more menu), body, collapsed state, Alt+Up / Alt+Down
 *   popover(anchor, keys, {label, build})   anchored panel: flips to stay in the modal; Escape, a click outside
 *                                           or tabbing out closes it; one open at a time (toggle on isOpen())
 *   closeAllPopovers()                      call from the modal's onClose and before rebuilding panels
 *   trapEscape(keys, onEscape)              route Escape to transient UI before the modal sees it
 *   openMenu(anchor, build, align?)         Obsidian Menu at the anchor's rect (works from the keyboard)
 *   menuFromButton(button, build, align?)   wire a button to toggle such a menu
 *   promptText(app, {title, value?, validate?})    Promise<string | null>
 *   confirmDialog(app, {title, message, confirmText?, destructive?})   Promise<boolean>
 *   formatDecimals(value, decimals?)          '1.5', '-2', '0.333333' (trailing zeros trimmed, -0 -> '0')
 *
 * `keys` is anything with `app` and `scope` (PanelHost qualifies). Obsidian
 * gives the first matching handler of a scope the key, and the modal
 * registers its own Escape handler first, so registering Escape on
 * host.scope is not enough: trapEscape pushes a child scope on top instead.
 */
import { App, Menu, Modal, Scope, setIcon } from 'obsidian';
import { COLOR_MAP, COLOR_OPTIONS, THICKNESS_MAP, THICKNESS_OPTIONS } from '../colors';
import type { Issue, IssueFix, ValidateResult } from '../mathcontext';

/** What keyboard-aware components need from the host (PanelHost satisfies it). */
export interface KeyContext {
    app: App;
    scope: Scope;
}

/** Delay before an inline field message appears while the user is typing. */
const MESSAGE_IDLE_MS = 600;

/** Distance between an anchor and its popover, and the minimum margin to the viewport and modal frame edges. */
const POPOVER_GAP = 6;
const VIEWPORT_MARGIN = 8;

/** Swatch popover grid width. */
const SWATCH_COLUMNS = 5;

// ------------------------------------------------------------- helpers

let idCounter = 0;

/** Document-unique id for aria-controls / aria-labelledby / aria-describedby. */
export function uniqueId(prefix: string): string {
    idCounter += 1;
    return `etz-${prefix}-${idCounter}`;
}

/** Screen-reader-only text. Absolutely positioned, so it never affects layout. */
export function visuallyHidden(parent: HTMLElement, text: string): HTMLElement {
    return parent.createSpan({ cls: 'etz-sr-only', text });
}

/**
 * Give `el` an accessible name through a hidden label instead of
 * aria-label: Obsidian shows a tooltip for every [aria-label] element,
 * which is noise on inputs and groups that already look labelled.
 */
function nameBy(el: HTMLElement, holder: HTMLElement, text: string): HTMLElement {
    const span = visuallyHidden(holder, text);
    span.id = uniqueId('name');
    el.setAttr('aria-labelledby', span.id);
    return span;
}

function asElement(target: EventTarget | null): Element | null {
    return target && (target as Node).nodeType === Node.ELEMENT_NODE ? (target as Element) : null;
}

/** True when keys typed into `target` belong to a text field or a native slider. */
function isEditingTarget(target: EventTarget | null): boolean {
    const el = asElement(target);
    return !!el && !!el.closest('input, textarea, select, [contenteditable="true"]');
}

/** Decimals needed to represent `step` (0.05 -> 2, 1e-7 -> 7, 5 -> 0). */
function stepDecimals(step: number): number {
    if (!Number.isFinite(step) || step <= 0) return 0;
    const [mantissa, exponent] = String(step).split('e');
    const dot = mantissa.indexOf('.');
    const fraction = dot < 0 ? 0 : mantissa.length - dot - 1;
    return Math.max(0, fraction - (exponent ? parseInt(exponent, 10) : 0));
}

/** Strip binary floating point noise (0.1 + 0.2 -> 0.3). */
function roundNoise(v: number): number {
    return Number.isFinite(v) ? Number(v.toPrecision(12)) : v;
}

/** Display a number with at most `decimals` decimals, trailing zeros trimmed, -0 as 0. */
export function formatDecimals(value: number, decimals = 6): string {
    if (!Number.isFinite(value)) return '';
    let s = roundNoise(value).toFixed(Math.min(Math.max(decimals, 0), 12));
    if (s.includes('.')) s = s.replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
}

/** Parse a typed number: accepts '1,5', a unicode minus and exponents. Null when not a finite number. */
function parseNumber(text: string): number | null {
    const s = text.trim().replace(/\u2212/g, '-').replace(',', '.');
    if (!s) return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
}

function sentenceCase(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

// --------------------------------------------------------------- escape

/**
 * Route Escape to `onEscape` while some transient UI (popover, inline
 * rename) is open, so the editor modal does not close. Returns the release
 * function. Obsidian walks a scope's handlers in registration order and the
 * modal's own Escape handler comes first, so a child scope is pushed on the
 * keymap: it sees Escape first and hands every other key to its parent.
 */
export function trapEscape(keys: KeyContext, onEscape: () => void): () => void {
    const handler = () => {
        onEscape();
        return false;
    };
    const keymap = keys.app.keymap;
    if (keymap) {
        const scope = new Scope(keys.scope);
        scope.register([], 'Escape', handler);
        keymap.pushScope(scope);
        return () => keymap.popScope(scope);
    }
    // Hosts without a keymap (test shims) dispatch to the newest handler first.
    const registered = keys.scope.register([], 'Escape', handler);
    return () => keys.scope.unregister(registered);
}

// -------------------------------------------------------------- buttons

export interface IconButtonOptions {
    /** Lucide icon id, e.g. 'eye', 'more-horizontal', 'plus'. */
    icon: string;
    /** Accessible name; Obsidian shows it as the tooltip. No title attribute. */
    label: string;
    onClick?: (e: MouseEvent) => void;
    /** 'md' = 28 px (default), 'sm' = 22 px. */
    size?: 'sm' | 'md';
    /** Toggle buttons: initial aria-pressed state. */
    pressed?: boolean;
    tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
    cls?: string;
}

export interface IconButtonHandle {
    el: HTMLButtonElement;
    setIcon(icon: string): void;
    setLabel(label: string): void;
    setPressed(pressed: boolean): void;
    setDisabled(disabled: boolean): void;
}

export function iconButton(parent: HTMLElement, opts: IconButtonOptions): IconButtonHandle {
    const el = parent.createEl('button', {
        cls: ['clickable-icon', 'etz-icon-btn', opts.size === 'sm' ? 'mod-sm' : 'mod-md'].concat(opts.cls ? [opts.cls] : []),
        attr: { type: 'button', 'aria-label': opts.label },
    });
    if (opts.tooltipPosition) el.setAttr('data-tooltip-position', opts.tooltipPosition);
    setIcon(el, opts.icon);
    const setPressed = (pressed: boolean) => el.setAttr('aria-pressed', String(pressed));
    if (opts.pressed !== undefined) setPressed(opts.pressed);
    if (opts.onClick) {
        const onClick = opts.onClick;
        el.addEventListener('click', (e) => onClick(e));
    }
    return {
        el,
        setIcon: (icon) => setIcon(el, icon),
        setLabel: (label) => el.setAttr('aria-label', label),
        setPressed,
        setDisabled: (disabled) => {
            el.disabled = disabled;
        },
    };
}

export interface TextButtonOptions {
    text: string;
    onClick?: (e: MouseEvent) => void;
    /** 'default' Obsidian button, 'cta' primary (mod-cta), 'ghost' borderless, 'link' inline text link. */
    variant?: 'default' | 'cta' | 'ghost' | 'link';
    /** Leading icon. */
    icon?: string;
    /** 'md' = 28 px (default), 'sm' = 22 px. */
    size?: 'sm' | 'md';
    cls?: string;
}

export interface TextButtonHandle {
    el: HTMLButtonElement;
    setText(text: string): void;
    setDisabled(disabled: boolean): void;
}

export function textButton(parent: HTMLElement, opts: TextButtonOptions): TextButtonHandle {
    const variant = opts.variant ?? 'default';
    // `mod-cta` doubles as Obsidian's primary button class.
    const cls = ['etz-btn', `mod-${variant}`, opts.size === 'sm' ? 'mod-sm' : 'mod-md'];
    if (opts.cls) cls.push(opts.cls);
    const el = parent.createEl('button', { cls, attr: { type: 'button' } });
    if (opts.icon) setIcon(el.createSpan({ cls: 'etz-btn-icon', attr: { 'aria-hidden': 'true' } }), opts.icon);
    const textEl = el.createSpan({ cls: 'etz-btn-text', text: opts.text });
    if (opts.onClick) {
        const onClick = opts.onClick;
        el.addEventListener('click', (e) => onClick(e));
    }
    return {
        el,
        setText: (text) => textEl.setText(text),
        setDisabled: (disabled) => {
            el.disabled = disabled;
        },
    };
}

// ------------------------------------------------------------ segmented

export interface SegmentOption<T extends string> {
    value: T;
    /** Visible text. Icon-only or custom segments need `ariaLabel`. */
    text?: string;
    icon?: string;
    /** Accessible name (and Obsidian tooltip) for segments without text. */
    ariaLabel?: string;
    /** Custom content (thickness samples). */
    render?: (el: HTMLElement) => void;
    disabled?: boolean;
}

export interface SegmentedOptions<T extends string> {
    /** Accessible name of the group, e.g. 'Axis style'. */
    label: string;
    options: SegmentOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Stretch the segments over the full row width. */
    fill?: boolean;
    cls?: string;
}

export interface SegmentedHandle<T extends string> {
    el: HTMLElement;
    getValue(): T;
    setValue(value: T): void;
    setDisabled(disabled: boolean): void;
    focus(): void;
}

/**
 * Radio group of buttons. Only the checked segment is a Tab stop; arrow
 * keys, Home and End move the selection (WAI-ARIA radio group pattern).
 */
export function segmented<T extends string>(parent: HTMLElement, opts: SegmentedOptions<T>): SegmentedHandle<T> {
    const el = parent.createDiv({ cls: ['etz-segmented'].concat(opts.fill ? ['mod-fill'] : [], opts.cls ? [opts.cls] : []) });
    el.setAttr('role', 'radiogroup');
    nameBy(el, el, opts.label);
    let value = opts.value;
    let groupDisabled = false;
    const buttons = opts.options.map((o) => {
        const b = el.createEl('button', { cls: 'etz-seg', attr: { type: 'button', role: 'radio' } });
        if (o.icon) setIcon(b.createSpan({ cls: 'etz-seg-icon', attr: { 'aria-hidden': 'true' } }), o.icon);
        if (o.render) o.render(b.createSpan({ cls: 'etz-seg-custom', attr: { 'aria-hidden': 'true' } }));
        if (o.text) b.createSpan({ cls: 'etz-seg-text', text: o.text });
        if (!o.text && o.ariaLabel) b.setAttr('aria-label', o.ariaLabel);
        if (!o.text && !o.icon) b.addClass('mod-graphic');
        b.addEventListener('click', () => select(o.value, false));
        return b;
    });

    const enabledIndices = () =>
        opts.options.map((o, i) => (o.disabled || groupDisabled ? -1 : i)).filter((i) => i >= 0);

    const sync = () => {
        let checkedIndex = opts.options.findIndex((o) => o.value === value);
        buttons.forEach((b, i) => {
            const checked = i === checkedIndex;
            b.setAttr('aria-checked', String(checked));
            b.toggleClass('is-active', checked);
            b.disabled = groupDisabled || !!opts.options[i].disabled;
        });
        // Exactly one Tab stop: the checked segment, else the first enabled one.
        if (checkedIndex < 0 || buttons[checkedIndex].disabled) checkedIndex = enabledIndices()[0] ?? -1;
        buttons.forEach((b, i) => (b.tabIndex = i === checkedIndex ? 0 : -1));
    };

    const select = (next: T, focus: boolean) => {
        const changed = next !== value;
        value = next;
        sync();
        if (focus) buttons[opts.options.findIndex((o) => o.value === next)]?.focus();
        if (changed) opts.onChange(next);
    };

    el.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const order = enabledIndices();
        if (!order.length) return;
        const current = buttons.findIndex((b) => b === e.target);
        const pos = Math.max(0, order.indexOf(current));
        let target: number | null = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') target = order[(pos + 1) % order.length];
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') target = order[(pos - 1 + order.length) % order.length];
        else if (e.key === 'Home') target = order[0];
        else if (e.key === 'End') target = order[order.length - 1];
        if (target === null) return;
        e.preventDefault();
        select(opts.options[target].value, true);
    });

    sync();
    return {
        el,
        getValue: () => value,
        setValue: (next) => {
            value = next;
            sync();
        },
        setDisabled: (disabled) => {
            groupDisabled = disabled;
            el.toggleClass('is-disabled', disabled);
            sync();
        },
        focus: () => buttons.find((b) => b.tabIndex === 0)?.focus(),
    };
}

// ----------------------------------------------------------------- chip

export interface ChipOptions {
    label: string;
    value: boolean;
    onChange: (pressed: boolean) => void;
    cls?: string;
}

export interface ChipHandle {
    el: HTMLButtonElement;
    getValue(): boolean;
    setValue(pressed: boolean): void;
    setLabel(label: string): void;
    setDisabled(disabled: boolean): void;
}

/** On / off option as a pill button (aria-pressed); pressed chips show a check mark. */
export function chip(parent: HTMLElement, opts: ChipOptions): ChipHandle {
    const el = parent.createEl('button', { cls: ['etz-chip'].concat(opts.cls ? [opts.cls] : []), attr: { type: 'button' } });
    setIcon(el.createSpan({ cls: 'etz-chip-check', attr: { 'aria-hidden': 'true' } }), 'check');
    const textEl = el.createSpan({ cls: 'etz-chip-text', text: opts.label });
    let pressed = opts.value;
    const sync = () => el.setAttr('aria-pressed', String(pressed));
    el.addEventListener('click', () => {
        pressed = !pressed;
        sync();
        opts.onChange(pressed);
    });
    sync();
    return {
        el,
        getValue: () => pressed,
        setValue: (v) => {
            pressed = v;
            sync();
        },
        setLabel: (label) => textEl.setText(label),
        setDisabled: (disabled) => {
            el.disabled = disabled;
        },
    };
}

// ---------------------------------------------------------- numberInput

export interface NumberInputOptions {
    value: number;
    /** Accessible name. */
    label: string;
    /** Arrow key step (default 1). Shift multiplies by 10, Alt by 0.1. */
    step?: number;
    /** Optional clamp applied to arrow steps and commits. */
    min?: number;
    max?: number;
    /** Arrow key steps, Enter and blur with a changed value. */
    onCommit: (value: number) => void;
    /** Each keystroke that leaves a valid number in the field. */
    onInput?: (value: number) => void;
    format?: (value: number) => string;
    placeholder?: string;
    cls?: string;
}

export interface NumberInputHandle {
    el: HTMLInputElement;
    getValue(): number;
    setValue(value: number): void;
    setDisabled(disabled: boolean): void;
    focus(select?: boolean): void;
}

/**
 * Text field for one number (type=text + inputmode=decimal: no spinner,
 * no wheel stepping, accepts '1,5'). Invalid text reverts on commit.
 */
export function numberInput(parent: HTMLElement, opts: NumberInputOptions): NumberInputHandle {
    const step = opts.step && opts.step > 0 ? opts.step : 1;
    const format = opts.format ?? ((v: number) => formatDecimals(v, Math.max(6, stepDecimals(step))));
    const el = parent.createEl('input', {
        cls: ['etz-input', 'etz-number'].concat(opts.cls ? [opts.cls] : []),
        type: 'text',
        attr: { inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false' },
    });
    if (opts.placeholder) el.placeholder = opts.placeholder;
    nameBy(el, parent, opts.label);
    let value = opts.value;
    el.value = format(value);

    const clamp = (v: number) => {
        if (opts.min !== undefined && v < opts.min) return opts.min;
        if (opts.max !== undefined && v > opts.max) return opts.max;
        return v;
    };
    const commit = () => {
        const parsed = parseNumber(el.value);
        if (parsed === null) {
            el.value = format(value);
            return;
        }
        const next = clamp(parsed);
        el.value = format(next);
        if (next !== value) {
            value = next;
            opts.onCommit(next);
        }
    };

    el.addEventListener('input', () => {
        const parsed = parseNumber(el.value);
        if (parsed !== null && opts.onInput) opts.onInput(clamp(parsed));
    });
    el.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            return;
        }
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const base = parseNumber(el.value) ?? value;
        const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * mult;
        const next = clamp(roundNoise(base + delta));
        value = next;
        el.value = format(next);
        el.select();
        opts.onCommit(next);
    });
    el.addEventListener('blur', commit);

    return {
        el,
        getValue: () => value,
        setValue: (v) => {
            value = v;
            el.value = format(v);
        },
        setDisabled: (disabled) => {
            el.disabled = disabled;
        },
        focus: (select) => {
            el.focus();
            if (select) el.select();
        },
    };
}

// ----------------------------------------------------------- liveSlider

export interface LiveSliderOptions {
    min: number;
    max: number;
    /** Step of the native range; 0 means 'any'. */
    step: number;
    value: number;
    /** Accessible name ('Opacity'). */
    label: string;
    /** Every `input` event (drag, arrow keys): call host.requestFrame() from here. */
    onInput: (value: number) => void;
    /** `change` event (release) and committed readout edits. */
    onCommit?: (value: number) => void;
    /** 'text' (default) shows format(value), 'input' an editable number field (plain numbers), 'none' nothing. */
    readout?: 'text' | 'input' | 'none';
    format?: (value: number) => string;
    /** After the range widened to fit a typed or programmatic value (persist min / max here). */
    onRangeChange?: (min: number, max: number) => void;
    cls?: string;
}

export interface LiveSliderHandle {
    el: HTMLElement;
    /** The native range input (for pointerdown / pointerup listeners, e.g. pausing play). */
    input: HTMLInputElement;
    getValue(): number;
    /** Programmatic set (play, sync): moves thumb, fill and readout; widens the range if needed. No onInput. */
    setValue(value: number): void;
    setRange(min: number, max: number, step?: number): void;
    getRange(): { min: number; max: number; step: number };
    setDisabled(disabled: boolean): void;
}

/**
 * Range slider that updates live. Obsidian's SliderComponent reports on
 * release and only it maintains --slider-fill-ratio, so this builds the
 * native input with the `slider` class and keeps the fill in sync itself.
 * No wheel handler: wheel scrolls the panel, never the value.
 */
export function liveSlider(parent: HTMLElement, opts: LiveSliderOptions): LiveSliderHandle {
    let min = opts.min;
    let max = opts.max;
    let step = opts.step;
    let value = opts.value;
    const numeric = (v: number) => formatDecimals(v, Math.max(2, stepDecimals(step)));
    const format = opts.format ?? numeric;
    const readoutMode = opts.readout ?? 'text';

    const el = parent.createDiv({ cls: ['etz-slider'].concat(opts.cls ? [opts.cls] : []) });
    const input = el.createEl('input', { cls: ['slider', 'etz-slider-input'], type: 'range' });
    nameBy(input, el, opts.label);
    const textReadout = readoutMode === 'text' ? el.createSpan({ cls: 'etz-slider-value', attr: { 'aria-hidden': 'true' } }) : null;
    const typedReadout =
        readoutMode === 'input'
            ? numberInput(el, {
                  value,
                  label: `${opts.label} value`,
                  step: step > 0 ? step : undefined,
                  // The typed readout must stay parseable, so it ignores opts.format ('20 %').
                  format: numeric,
                  cls: 'etz-slider-number',
                  onCommit: (v) => {
                      apply(v);
                      opts.onInput(value);
                      if (opts.onCommit) opts.onCommit(value);
                  },
              })
            : null;

    const widenTo = (v: number) => {
        if (v >= min && v <= max) return;
        min = Math.min(min, v);
        max = Math.max(max, v);
        writeRange();
        if (opts.onRangeChange) opts.onRangeChange(min, max);
    };
    const writeRange = () => {
        input.min = String(min);
        input.max = String(max);
        input.step = step > 0 ? String(step) : 'any';
    };
    const render = () => {
        const ratio = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
        input.setCssProps({ '--slider-fill-ratio': String(ratio) });
        const text = format(value);
        input.setAttr('aria-valuetext', text);
        if (textReadout) textReadout.setText(text);
        if (typedReadout && activeDocument.activeElement !== typedReadout.el) typedReadout.setValue(value);
    };
    const apply = (v: number) => {
        if (!Number.isFinite(v)) return;
        widenTo(v);
        value = v;
        input.value = String(v);
        render();
    };

    input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v)) return;
        value = v;
        render();
        opts.onInput(v);
    });
    input.addEventListener('change', () => {
        if (opts.onCommit) opts.onCommit(value);
    });

    writeRange();
    apply(value);
    return {
        el,
        input,
        getValue: () => value,
        setValue: apply,
        setRange: (nextMin, nextMax, nextStep) => {
            min = Math.min(nextMin, nextMax);
            max = Math.max(nextMin, nextMax);
            if (nextStep !== undefined) step = nextStep;
            writeRange();
            input.value = String(value);
            render();
        },
        getRange: () => ({ min, max, step }),
        setDisabled: (disabled) => {
            input.disabled = disabled;
            if (typedReadout) typedReadout.setDisabled(disabled);
            el.toggleClass('is-disabled', disabled);
        },
    };
}

// ------------------------------------------------------------ textInput

export interface TextInputOptions {
    value: string;
    /** Accessible name (omit when a field() label is bound to it). */
    label?: string;
    placeholder?: string;
    /** Every keystroke. */
    onInput?: (value: string) => void;
    /** Blur / Enter with a changed value. */
    onCommit?: (value: string) => void;
    /** Enter key (after onCommit). */
    onEnter?: (value: string) => void;
    monospace?: boolean;
    cls?: string;
}

export interface TextInputHandle {
    el: HTMLInputElement;
    getValue(): string;
    setValue(value: string): void;
    setDisabled(disabled: boolean): void;
    /** Focus; select `selectText` when it occurs in the value, select all for `true`. */
    focus(selectText?: string | boolean): void;
}

export function textInput(parent: HTMLElement, opts: TextInputOptions): TextInputHandle {
    const el = parent.createEl('input', {
        cls: ['etz-input'].concat(opts.monospace ? ['mod-mono'] : [], opts.cls ? [opts.cls] : []),
        type: 'text',
        attr: { autocomplete: 'off', spellcheck: opts.monospace ? 'false' : 'true' },
    });
    el.value = opts.value;
    if (opts.placeholder) el.placeholder = opts.placeholder;
    if (opts.label) nameBy(el, parent, opts.label);
    let committed = opts.value;
    const commit = () => {
        if (el.value === committed) return;
        committed = el.value;
        if (opts.onCommit) opts.onCommit(committed);
    };
    el.addEventListener('input', () => {
        if (opts.onInput) opts.onInput(el.value);
    });
    el.addEventListener('blur', commit);
    el.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        commit();
        if (opts.onEnter) opts.onEnter(el.value);
    });
    return {
        el,
        getValue: () => el.value,
        setValue: (v) => {
            el.value = v;
            committed = v;
        },
        setDisabled: (disabled) => {
            el.disabled = disabled;
        },
        focus: (selectText) => focusInput(el, selectText),
    };
}

/** Focus an input and select `selectText` (identifier-bounded match first), all text for `true`, else caret at end. */
function focusInput(el: HTMLInputElement, selectText?: string | boolean): void {
    el.focus();
    if (selectText === true) {
        el.select();
        return;
    }
    const text = el.value;
    let start = -1;
    if (typeof selectText === 'string' && selectText) {
        const escaped = selectText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const bounded = new RegExp(`(^|[^A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).exec(text);
        start = bounded ? bounded.index + bounded[1].length : text.indexOf(selectText);
    }
    if (start >= 0 && typeof selectText === 'string') el.setSelectionRange(start, start + selectText.length);
    else el.setSelectionRange(text.length, text.length);
}

// ------------------------------------------------------------ exprInput

export interface ExprInputOptions {
    value: string;
    /** Accessible name ('Expression', 'Condition 2'). */
    label: string;
    /** Validation of the current text, usually (src) => host.math().validate(src, kind). */
    validate: (src: string) => ValidateResult;
    /** Every keystroke: write the setting and call host.requestUpdate(). */
    onInput: (value: string) => void;
    /** Blur / Enter with a changed value. */
    onCommit?: (value: string) => void;
    /** Enter key (after onCommit). */
    onEnter?: (value: string) => void;
    /** Quick fix replaced the text (the field already shows it). Defaults to onInput. */
    onRewrite?: (text: string) => void;
    /** Quick fix 'Add slider k': create the parameter (host.addParameter(name)). Without it no such button. */
    onAddParameter?: (name: string) => void;
    /** Called when the shown error state flips (card header dots, tab dots). */
    onErrorChange?: (hasError: boolean) => void;
    placeholder?: string;
    cls?: string;
}

export interface ExprInputHandle {
    el: HTMLElement;
    input: HTMLInputElement;
    getValue(): string;
    /** Replace the text (no onInput) and show the new validation result at once. */
    setValue(value: string): void;
    /** Re-run validate() and update the message now (FieldHandle.validate). */
    validate(): void;
    /** Show an issue from elsewhere (scene, render) while the text itself is valid; null clears it. */
    setIssue(issue: Issue | null): void;
    /** Focus and select the first match of `selectText` (FieldHandle.focus). */
    focus(selectText?: string): void;
    /** True while an error message is shown. */
    hasError(): boolean;
    setDisabled(disabled: boolean): void;
    /** Clear the idle timer. */
    destroy(): void;
}

/**
 * Monospace expression field with inline validation. Validation runs on
 * every keystroke, but a new message only appears after MESSAGE_IDLE_MS
 * without typing (or on blur), so half-typed input never flashes red.
 * Fixing the text clears a shown message at once.
 */
export function exprInput(parent: HTMLElement, opts: ExprInputOptions): ExprInputHandle {
    const el = parent.createDiv({ cls: ['etz-expr'].concat(opts.cls ? [opts.cls] : []) });
    const input = el.createEl('input', {
        cls: ['etz-input', 'mod-mono', 'etz-expr-input'],
        type: 'text',
        attr: { autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' },
    });
    input.value = opts.value;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    nameBy(input, el, opts.label);
    const msgEl = el.createDiv({ cls: ['etz-expr-msg', 'tikz-hidden'], attr: { 'aria-live': 'polite' } });
    const msgText = msgEl.createSpan({ cls: 'etz-expr-msg-text' });
    msgText.id = uniqueId('msg');
    const fixBtn = msgEl.createEl('button', { cls: ['etz-btn', 'mod-quickfix', 'tikz-hidden'], attr: { type: 'button' } });
    // Keep focus (and the caret) in the input while the fix is clicked.
    fixBtn.addEventListener('mousedown', (e) => e.preventDefault());

    let shown: Issue | null = null;
    let external: Issue | null = null;
    let fix: IssueFix | null = null;
    let timer: number | null = null;
    let committed = opts.value;

    const run = (): Issue | null => {
        let result: ValidateResult;
        try {
            result = opts.validate(input.value);
        } catch (e) {
            result = { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
        return result.ok ? external : result;
    };
    const show = (issue: Issue | null) => {
        const had = !!shown;
        shown = issue;
        el.toggleClass('is-error', !!issue);
        msgEl.toggleClass('tikz-hidden', !issue);
        input.setAttr('aria-invalid', issue ? 'true' : null);
        input.setAttr('aria-describedby', issue ? msgText.id : null);
        msgText.setText(issue ? issue.message : '');
        fix = issue && issue.fix && (issue.fix.rewrite !== undefined || (issue.fix.addParameter && opts.onAddParameter)) ? issue.fix : null;
        fixBtn.toggleClass('tikz-hidden', !fix);
        fixBtn.setText(fix ? fix.label : '');
        if (had !== !!issue && opts.onErrorChange) opts.onErrorChange(!!issue);
    };
    const cancelTimer = () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
    };
    const refresh = () => {
        cancelTimer();
        show(run());
    };

    input.addEventListener('input', () => {
        opts.onInput(input.value);
        cancelTimer();
        // A scene issue belongs to the old text; the next render reports it again if it still applies.
        external = null;
        const issue = run();
        // Clearing is instant; a new or changed message waits for a pause.
        if (!issue) show(null);
        else timer = window.setTimeout(() => {
            timer = null;
            show(run());
        }, MESSAGE_IDLE_MS);
    });
    const commit = () => {
        if (input.value === committed) return;
        committed = input.value;
        if (opts.onCommit) opts.onCommit(committed);
    };
    input.addEventListener('blur', () => {
        commit();
        refresh();
    });
    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        commit();
        refresh();
        if (opts.onEnter) opts.onEnter(input.value);
    });
    fixBtn.addEventListener('click', () => {
        const applied = fix;
        if (!applied) return;
        if (applied.rewrite !== undefined) {
            input.value = applied.rewrite;
            committed = applied.rewrite;
            (opts.onRewrite ?? opts.onInput)(applied.rewrite);
        }
        if (applied.addParameter && opts.onAddParameter) opts.onAddParameter(applied.addParameter);
        refresh();
        input.focus();
    });

    show(run());
    return {
        el,
        input,
        getValue: () => input.value,
        setValue: (v) => {
            input.value = v;
            committed = v;
            refresh();
        },
        validate: refresh,
        setIssue: (issue) => {
            external = issue;
            // Mid-typing (a message is pending) the idle timer shows the result, external issue included.
            if (timer === null) refresh();
        },
        focus: (selectText) => focusInput(input, selectText),
        hasError: () => !!shown,
        setDisabled: (disabled) => {
            input.disabled = disabled;
        },
        destroy: cancelTimer,
    };
}

// ------------------------------------------------------------- dropdown

export interface DropdownOption<T extends string> {
    value: T;
    text: string;
}

export interface DropdownOptions<T extends string> {
    label: string;
    options: DropdownOption<T>[];
    value: T;
    onChange: (value: T) => void;
    cls?: string;
}

export interface DropdownHandle<T extends string> {
    el: HTMLSelectElement;
    getValue(): T;
    setValue(value: T): void;
    /** Replace the option list (function / region names changed). */
    setOptions(options: DropdownOption<T>[], value?: T): void;
    setDisabled(disabled: boolean): void;
}

/**
 * Native select with Obsidian's `dropdown` styling. A current value that is
 * not in the list (a deleted function) stays visible as "f3 (missing)"
 * instead of silently switching to the first option.
 */
export function dropdown<T extends string>(parent: HTMLElement, opts: DropdownOptions<T>): DropdownHandle<T> {
    const el = parent.createEl('select', { cls: ['dropdown', 'etz-select'].concat(opts.cls ? [opts.cls] : []) });
    nameBy(el, parent, opts.label);
    let options = opts.options;
    let value = opts.value;
    const fill = () => {
        el.empty();
        if (value && !options.some((o) => o.value === value)) {
            el.createEl('option', { text: `${value} (missing)`, value, attr: { disabled: true } });
        }
        for (const o of options) el.createEl('option', { text: o.text, value: o.value });
        el.value = value;
        el.toggleClass('is-missing', !!value && !options.some((o) => o.value === value));
    };
    el.addEventListener('change', () => {
        value = el.value as T;
        el.toggleClass('is-missing', false);
        opts.onChange(value);
    });
    fill();
    return {
        el,
        getValue: () => value,
        setValue: (v) => {
            value = v;
            fill();
        },
        setOptions: (next, v) => {
            options = next;
            if (v !== undefined) value = v;
            fill();
        },
        setDisabled: (disabled) => {
            el.disabled = disabled;
        },
    };
}

// -------------------------------------------------------------- popover

export interface PopoverOptions {
    /** Accessible name of the dialog ('Colour'). */
    label: string;
    /** Fill the popover. */
    build: (el: HTMLElement, popover: PopoverHandle) => void;
    /** 'start' aligns left edges (default), 'end' right edges. */
    align?: 'start' | 'end';
    /** Preferred side of the anchor (default 'below'); the other side is used when the preferred one does not fit the modal frame. */
    placement?: 'below' | 'above';
    /** Element to focus on open; default: the pressed / checked item, else the first focusable one. */
    initialFocus?: (el: HTMLElement) => HTMLElement | null;
    onClose?: () => void;
    cls?: string;
}

export interface PopoverHandle {
    el: HTMLElement;
    close(): void;
    /** Re-measure after the content changed size. */
    reposition(): void;
    isOpen(): boolean;
}

let activePopover: PopoverHandle | null = null;

/** Close the open popover, if any (modal close, panel rebuild). */
export function closeAllPopovers(): void {
    if (activePopover) activePopover.close();
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Floating panel anchored below `anchor` (or above, see `placement`; it
 * flips when the preferred side has no room), kept inside the enclosing
 * modal frame and the viewport. Escape (via trapEscape), a pointer press
 * outside, or focus leaving it closes it; Escape returns focus to the
 * anchor. Mounted in the modal container so the modal's Tab focus trap
 * and stacking order both include it.
 */
export function popover(anchor: HTMLElement, keys: KeyContext, opts: PopoverOptions): PopoverHandle {
    closeAllPopovers();
    const doc = anchor.ownerDocument;
    const mount = anchor.closest<HTMLElement>('.modal-container') ?? doc.body;
    const el = mount.createDiv({ cls: ['etz-popover', 'etz-tokens'].concat(opts.cls ? [opts.cls] : []) });
    el.setAttr('role', 'dialog');
    nameBy(el, el, opts.label);
    anchor.setAttr('aria-expanded', 'true');

    let open = true;
    let frame: number | null = null;

    const place = () => {
        frame = null;
        if (!open) return;
        if (!anchor.isConnected) {
            handle.close();
            return;
        }
        const a = anchor.getBoundingClientRect();
        const vw = doc.documentElement.clientWidth;
        const vh = doc.documentElement.clientHeight;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        // Stay inside the modal frame, not just the viewport: below a bar at the
        // frame's bottom edge there is still viewport room, but the popover would
        // hang out of the frame over the modal's own buttons.
        const bounds = anchor.closest('.modal')?.getBoundingClientRect() ?? null;
        const minX = Math.max(VIEWPORT_MARGIN, bounds ? bounds.left + VIEWPORT_MARGIN : 0);
        const maxX = Math.min(vw - VIEWPORT_MARGIN, bounds ? bounds.right - VIEWPORT_MARGIN : vw);
        const minY = Math.max(VIEWPORT_MARGIN, bounds ? bounds.top + VIEWPORT_MARGIN : 0);
        const maxY = Math.min(vh - VIEWPORT_MARGIN, bounds ? bounds.bottom - VIEWPORT_MARGIN : vh);
        const below = a.bottom + POPOVER_GAP;
        const above = a.top - POPOVER_GAP - h;
        const fitsBelow = below + h <= maxY;
        const fitsAbove = above >= minY;
        let top = opts.placement === 'above' ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
        // Fits neither side: stay on screen at least.
        top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - h - VIEWPORT_MARGIN));
        let left = opts.align === 'end' ? a.right - w : a.left;
        left = Math.max(minX, Math.min(left, maxX - w));
        el.toggleClass('is-above', top < a.top);
        el.setCssProps({ '--etz-popover-top': `${Math.round(top)}px`, '--etz-popover-left': `${Math.round(left)}px` });
    };
    const schedule = () => {
        if (frame === null) frame = window.requestAnimationFrame(place);
    };
    const onPointerDown = (e: PointerEvent) => {
        const target = e.target as Node | null;
        if (!target || el.contains(target) || anchor.contains(target)) return;
        handle.close();
    };
    const onFocusOut = (e: FocusEvent) => {
        const next = e.relatedTarget as Node | null;
        // relatedTarget is null for clicks on non-focusable popover padding: keep it open.
        if (next && !el.contains(next) && !anchor.contains(next)) handle.close();
    };
    // Leaving by Tab closes the popover and focuses the anchor: Shift+Tab stops
    // there, Tab lets the browser continue to the control after the anchor.
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
        const stops = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.tabIndex >= 0);
        const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
        if (edge && doc.activeElement !== edge) return;
        if (e.shiftKey) e.preventDefault();
        handle.close();
    };

    const handle: PopoverHandle = {
        el,
        isOpen: () => open,
        reposition: schedule,
        close: () => {
            if (!open) return;
            open = false;
            const hadFocus = el.contains(doc.activeElement);
            releaseEscape();
            if (frame !== null) window.cancelAnimationFrame(frame);
            doc.removeEventListener('pointerdown', onPointerDown, true);
            doc.removeEventListener('scroll', schedule, true);
            doc.defaultView?.removeEventListener('resize', schedule);
            el.remove();
            anchor.setAttr('aria-expanded', 'false');
            if (activePopover === handle) activePopover = null;
            if (hadFocus && anchor.isConnected) anchor.focus();
            if (opts.onClose) opts.onClose();
        },
    };
    const releaseEscape = trapEscape(keys, () => {
        // Focus moves back to the anchor even when it was elsewhere (Escape is a keyboard path).
        handle.close();
        if (anchor.isConnected) anchor.focus();
    });

    opts.build(el, handle);
    place();
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('scroll', schedule, true);
    doc.defaultView?.addEventListener('resize', schedule);
    el.addEventListener('focusout', onFocusOut);
    el.addEventListener('keydown', onKeyDown);
    activePopover = handle;

    const first =
        (opts.initialFocus && opts.initialFocus(el)) ??
        el.querySelector<HTMLElement>('[aria-pressed="true"], [aria-checked="true"]') ??
        el.querySelector<HTMLElement>(FOCUSABLE);
    if (first) first.focus();
    return handle;
}

// --------------------------------------------------------- swatchPicker

export interface SwatchPickerOptions {
    /** Palette key ('blue'). */
    value: string;
    onChange: (color: string) => void;
    /** Name of the property, used in the accessible name ('Colour: Blue'). */
    label?: string;
    /** Palette keys to offer (default: every COLOR_MAP entry). */
    colors?: string[];
    cls?: string;
}

export interface SwatchPickerHandle {
    el: HTMLButtonElement;
    getValue(): string;
    setValue(color: string): void;
    setDisabled(disabled: boolean): void;
    open(): void;
    close(): void;
}

function colorName(key: string): string {
    return COLOR_OPTIONS[key] ?? sentenceCase(key);
}

/** Paint a swatch dot. 'black' is drawn split: theme text colour and real black (what the export uses). */
function paintSwatch(dot: HTMLElement, key: string): void {
    dot.toggleClass('is-auto', key === 'black');
    dot.setCssProps({ '--etz-swatch-color': COLOR_MAP[key] ?? key });
}

/** Colour button that opens a popover grid of the palette. */
export function swatchPicker(parent: HTMLElement, keys: KeyContext, opts: SwatchPickerOptions): SwatchPickerHandle {
    const label = opts.label ?? 'Colour';
    const colors = opts.colors ?? Object.keys(COLOR_MAP);
    const el = parent.createEl('button', {
        cls: ['etz-swatch-btn'].concat(opts.cls ? [opts.cls] : []),
        attr: { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
    });
    const dot = el.createSpan({ cls: 'etz-swatch', attr: { 'aria-hidden': 'true' } });
    let value = opts.value;
    let current: PopoverHandle | null = null;

    const sync = () => {
        paintSwatch(dot, value);
        el.setAttr('aria-label', `${label}: ${colorName(value)}`);
    };
    const choose = (key: string) => {
        if (current) current.close();
        el.focus();
        if (key === value) return;
        value = key;
        sync();
        opts.onChange(key);
    };
    const openPicker = () => {
        current = popover(el, keys, {
            label,
            cls: 'etz-swatch-popover',
            onClose: () => {
                current = null;
            },
            build: (pop) => {
                const grid = pop.createDiv({ cls: 'etz-swatch-grid', attr: { role: 'group' } });
                grid.setCssProps({ '--etz-swatch-columns': String(Math.min(SWATCH_COLUMNS, colors.length)) });
                // One Tab stop (the current colour); arrow keys move between cells.
                const current = Math.max(0, colors.indexOf(value));
                const cells = colors.map((key, i) => {
                    const cell = grid.createEl('button', {
                        cls: 'etz-swatch-cell',
                        attr: { type: 'button', 'aria-label': colorName(key), 'aria-pressed': String(key === value), tabindex: i === current ? 0 : -1 },
                    });
                    paintSwatch(cell.createSpan({ cls: 'etz-swatch', attr: { 'aria-hidden': 'true' } }), key);
                    setIcon(cell.createSpan({ cls: 'etz-swatch-check', attr: { 'aria-hidden': 'true' } }), 'check');
                    cell.addEventListener('click', () => choose(key));
                    return cell;
                });
                grid.addEventListener('keydown', (e: KeyboardEvent) => {
                    const i = cells.indexOf(e.target as HTMLButtonElement);
                    if (i < 0) return;
                    const n = cells.length;
                    let next: number | null = null;
                    if (e.key === 'ArrowRight') next = (i + 1) % n;
                    else if (e.key === 'ArrowLeft') next = (i - 1 + n) % n;
                    else if (e.key === 'ArrowDown') next = i + SWATCH_COLUMNS < n ? i + SWATCH_COLUMNS : i % SWATCH_COLUMNS;
                    else if (e.key === 'ArrowUp') {
                        if (i - SWATCH_COLUMNS >= 0) next = i - SWATCH_COLUMNS;
                        else {
                            // Wrap to the same column in the last row.
                            const lastRowStart = Math.floor((n - 1) / SWATCH_COLUMNS) * SWATCH_COLUMNS;
                            next = Math.min(lastRowStart + i, n - 1);
                        }
                    } else if (e.key === 'Home') next = 0;
                    else if (e.key === 'End') next = n - 1;
                    if (next === null) return;
                    e.preventDefault();
                    cells[i].tabIndex = -1;
                    cells[next].tabIndex = 0;
                    cells[next].focus();
                });
            },
        });
    };
    el.addEventListener('click', () => {
        if (current) current.close();
        else openPicker();
    });
    sync();
    return {
        el,
        getValue: () => value,
        setValue: (key) => {
            value = key;
            sync();
        },
        setDisabled: (disabled) => {
            el.disabled = disabled;
        },
        open: () => {
            if (!current) openPicker();
        },
        close: () => {
            if (current) current.close();
        },
    };
}

// ------------------------------------------------------ thicknessPicker

export interface ThicknessPickerOptions {
    /** THICKNESS_MAP key ('thin'). */
    value: string;
    onChange: (thickness: string) => void;
    label?: string;
    cls?: string;
}

/** Four line samples at their preview widths (1, 1.5, 2.5, 3.5 px), named by aria-label. */
export function thicknessPicker(parent: HTMLElement, opts: ThicknessPickerOptions): SegmentedHandle<string> {
    return segmented<string>(parent, {
        label: opts.label ?? 'Line thickness',
        value: opts.value,
        onChange: opts.onChange,
        cls: ['etz-thickness'].concat(opts.cls ? [opts.cls] : []).join(' '),
        options: Object.keys(THICKNESS_MAP).map((key) => ({
            value: key,
            ariaLabel: sentenceCase(THICKNESS_OPTIONS[key] ?? key),
            render: (holder: HTMLElement) => {
                const svg = holder.createSvg('svg', { attr: { width: 24, height: 12, viewBox: '0 0 24 12' } });
                svg.createSvg('line', {
                    attr: { x1: 3, y1: 6, x2: 21, y2: 6, stroke: 'currentColor', 'stroke-width': THICKNESS_MAP[key], 'stroke-linecap': 'round' },
                });
            },
        })),
    });
}

// ----------------------------------------------------------- disclosure

export interface DisclosureOptions {
    label: string;
    open?: boolean;
    onToggle?: (open: boolean) => void;
    /** Muted text after the label (e.g. a summary of active options). */
    meta?: string;
    cls?: string;
}

export interface DisclosureHandle {
    el: HTMLElement;
    button: HTMLButtonElement;
    body: HTMLElement;
    isOpen(): boolean;
    setOpen(open: boolean): void;
    setMeta(meta: string): void;
}

export function disclosure(parent: HTMLElement, opts: DisclosureOptions): DisclosureHandle {
    const el = parent.createDiv({ cls: ['etz-disclosure'].concat(opts.cls ? [opts.cls] : []) });
    const button = el.createEl('button', { cls: 'etz-disclosure-btn', attr: { type: 'button' } });
    setIcon(button.createSpan({ cls: 'etz-disclosure-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-right');
    button.createSpan({ cls: 'etz-disclosure-label', text: opts.label });
    const metaEl = button.createSpan({ cls: 'etz-disclosure-meta', text: opts.meta ?? '' });
    const body = el.createDiv({ cls: 'etz-disclosure-body' });
    body.id = uniqueId('disclosure');
    button.setAttr('aria-controls', body.id);
    let open = !!opts.open;
    const sync = () => {
        button.setAttr('aria-expanded', String(open));
        el.toggleClass('is-open', open);
        body.toggleClass('tikz-hidden', !open);
    };
    button.addEventListener('click', () => {
        open = !open;
        sync();
        if (opts.onToggle) opts.onToggle(open);
    });
    sync();
    return {
        el,
        button,
        body,
        isOpen: () => open,
        setOpen: (next) => {
            open = next;
            sync();
        },
        setMeta: (meta) => metaEl.setText(meta),
    };
}

// ---------------------------------------------------------------- field

export interface FieldOptions {
    label: string;
    hint?: string;
    /** 'stack' puts the label above the control (default), 'inline' to its left. */
    layout?: 'stack' | 'inline';
    cls?: string;
}

export interface FieldLayoutHandle {
    el: HTMLElement;
    labelEl: HTMLLabelElement;
    /** Put the control(s) in here. */
    controlEl: HTMLElement;
    hintEl: HTMLElement;
    setLabel(label: string): void;
    /** Muted line under the control; empty hides it. */
    setHint(hint: string): void;
    /** Link the label to a control: `for` on inputs / selects, aria-labelledby on anything else. */
    bind(control: HTMLElement): void;
}

export function field(parent: HTMLElement, opts: FieldOptions): FieldLayoutHandle {
    const el = parent.createDiv({ cls: ['etz-field', opts.layout === 'inline' ? 'mod-inline' : 'mod-stack'].concat(opts.cls ? [opts.cls] : []) });
    const labelEl = el.createEl('label', { cls: 'etz-field-label', text: opts.label });
    labelEl.id = uniqueId('label');
    const main = el.createDiv({ cls: 'etz-field-main' });
    const controlEl = main.createDiv({ cls: 'etz-field-control' });
    const hintEl = main.createDiv({ cls: 'etz-field-hint' });
    const setHint = (hint: string) => {
        hintEl.setText(hint);
        hintEl.toggleClass('tikz-hidden', !hint);
    };
    setHint(opts.hint ?? '');
    return {
        el,
        labelEl,
        controlEl,
        hintEl,
        setLabel: (label) => labelEl.setText(label),
        setHint,
        bind: (control) => {
            const tag = control.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
                if (!control.id) control.id = uniqueId('control');
                labelEl.htmlFor = control.id;
                // The visible label replaces the hidden one a kit factory may have added.
                const hiddenId = control.getAttribute('aria-labelledby');
                const hidden = hiddenId ? control.ownerDocument.getElementById(hiddenId) : null;
                if (hidden && hidden.hasClass('etz-sr-only')) hidden.remove();
                control.removeAttribute('aria-labelledby');
            } else {
                control.setAttr('aria-labelledby', labelEl.id);
                labelEl.addEventListener('click', () => {
                    const focusable = control.matches(FOCUSABLE) ? control : control.querySelector<HTMLElement>('[tabindex="0"], ' + FOCUSABLE);
                    if (focusable) focusable.focus();
                });
            }
        },
    };
}

// ---------------------------------------------------------------- group

export interface GroupHandle {
    el: HTMLElement;
    /** Header row: append extra buttons here (e.g. an "Add" icon button). */
    headerEl: HTMLElement;
    body: HTMLElement;
}

/** Titled section with a 12 px small-caps header (Chart tab groups, Build sections). */
export function group(parent: HTMLElement, title: string, cls?: string): GroupHandle {
    const el = parent.createDiv({ cls: ['etz-group'].concat(cls ? [cls] : []) });
    const headerEl = el.createDiv({ cls: 'etz-group-header' });
    const heading = headerEl.createDiv({ cls: 'etz-group-title', text: title, attr: { role: 'heading', 'aria-level': '3' } });
    heading.id = uniqueId('group');
    el.setAttr('role', 'group');
    el.setAttr('aria-labelledby', heading.id);
    const body = el.createDiv({ cls: 'etz-group-body' });
    return { el, headerEl, body };
}

// --------------------------------------------------------------- banner

export interface BannerAction {
    text: string;
    onClick: () => void;
    cta?: boolean;
}

export interface BannerOptions {
    text: string;
    actions?: BannerAction[];
    /** Muted second line. */
    note?: string;
    tone?: 'info' | 'warning';
    cls?: string;
}

export interface BannerHandle {
    el: HTMLElement;
    setText(text: string): void;
    remove(): void;
}

/** 32 px notice row with inline buttons ("Unsaved chart from 14:32 [Restore] [Discard]"). */
export function banner(parent: HTMLElement, opts: BannerOptions): BannerHandle {
    const el = parent.createDiv({ cls: ['etz-banner', `mod-${opts.tone ?? 'info'}`].concat(opts.cls ? [opts.cls] : []) });
    el.setAttr('role', 'status');
    const row = el.createDiv({ cls: 'etz-banner-row' });
    const textEl = row.createSpan({ cls: 'etz-banner-text', text: opts.text });
    const actions = row.createDiv({ cls: 'etz-banner-actions' });
    for (const a of opts.actions ?? []) {
        textButton(actions, { text: a.text, size: 'sm', variant: a.cta ? 'cta' : 'default', onClick: () => a.onClick() });
    }
    if (opts.note) el.createDiv({ cls: 'etz-banner-note', text: opts.note });
    return { el, setText: (text) => textEl.setText(text), remove: () => el.remove() };
}

// ---------------------------------------------------------------- menus

/**
 * Show an Obsidian Menu under `anchor` (keyboard-safe: showAtMouseEvent from
 * a keyboard click opens at 0, 0). 'end' aligns the menu's right edge with
 * the anchor's; Obsidian flips it when there is no room.
 */
export function openMenu(anchor: HTMLElement, build: (menu: Menu) => void, align: 'start' | 'end' = 'start'): Menu {
    const menu = new Menu();
    build(menu);
    const r = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom + 2, width: r.width, overlap: true, left: align === 'end' }, anchor.ownerDocument);
    return menu;
}

export interface MenuButtonHandle {
    open(): void;
    close(): void;
}

/**
 * Make `button` toggle a menu built fresh on every open. A press on the
 * button while its menu is open closes it instead of reopening it.
 */
export function menuFromButton(button: HTMLElement, build: (menu: Menu) => void, align: 'start' | 'end' = 'start'): MenuButtonHandle {
    button.setAttr('aria-haspopup', 'menu');
    button.setAttr('aria-expanded', 'false');
    let menu: Menu | null = null;
    // Obsidian hides an open menu on any mousedown outside it, before our click arrives.
    let pressedWhileOpen = false;
    const open = () => {
        if (menu) return;
        const shown = openMenu(button, build, align);
        menu = shown;
        button.addClass('has-active-menu');
        button.setAttr('aria-expanded', 'true');
        shown.onHide(() => {
            if (menu === shown) menu = null;
            button.removeClass('has-active-menu');
            button.setAttr('aria-expanded', 'false');
        });
    };
    button.addEventListener('pointerdown', () => {
        pressedWhileOpen = menu !== null;
    });
    button.addEventListener('click', () => {
        const wasOpen = pressedWhileOpen || menu !== null;
        pressedWhileOpen = false;
        if (wasOpen) {
            if (menu) menu.hide();
            return;
        }
        open();
    });
    return {
        open,
        close: () => {
            if (menu) menu.hide();
        },
    };
}

// ------------------------------------------------------------ cardShell

export interface CardShellOptions {
    /** Name badge ('f1', 'R1'). */
    name: string;
    /** Plain-language summary, truncated with the full text in the title attribute. */
    summary: string;
    /** Kind for screen readers ('Function', 'Region'). */
    kind?: string;
    /** Header swatch; omit for none. */
    color?: string;
    onColorChange?: (color: string) => void;
    /**
     * Inline rename: return an error message ('f2 is already used') or null
     * to accept. Without validateName and onRename the badge is static.
     */
    validateName?: (name: string) => string | null;
    onRename?: (to: string) => void;
    /** Eye toggle; omit onVisibleChange for none. */
    visible?: boolean;
    onVisibleChange?: (visible: boolean) => void;
    /** Fills the "More" menu each time it opens; omit for no button. */
    menu?: (menu: Menu) => void;
    collapsed?: boolean;
    onCollapsedChange?: (collapsed: boolean) => void;
    /** Alt+Up / Alt+Down while focus is in the card (outside text fields). */
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    cls?: string;
}

export interface CardShellHandle {
    el: HTMLElement;
    headerEl: HTMLElement;
    bodyEl: HTMLElement;
    setName(name: string): void;
    setSummary(summary: string): void;
    setColor(color: string): void;
    setVisible(visible: boolean): void;
    isCollapsed(): boolean;
    /** No onCollapsedChange call. */
    setCollapsed(collapsed: boolean): void;
    /** Error dot in the header (fields inside show the details). */
    setError(hasError: boolean): void;
    /** Focus the header (after a delete / move, focus the neighbour's header). */
    focusHeader(): void;
    startRename(): void;
    destroy(): void;
}

/**
 * Common card frame for function and layer cards. Header: swatch, name
 * badge, summary (also the collapse toggle), error dot, eye, more. Clicking
 * empty header space collapses / expands as well.
 */
export function cardShell(parent: HTMLElement, keys: KeyContext, opts: CardShellOptions): CardShellHandle {
    const el = parent.createDiv({ cls: ['etz-card'].concat(opts.cls ? [opts.cls] : []) });
    el.setAttr('role', 'group');
    const headerEl = el.createDiv({ cls: 'etz-card-header' });
    const bodyEl = el.createDiv({ cls: 'etz-card-body' });
    bodyEl.id = uniqueId('card');

    const swatch =
        opts.color !== undefined
            ? swatchPicker(headerEl, keys, {
                  value: opts.color,
                  onChange: (c) => {
                      if (opts.onColorChange) opts.onColorChange(c);
                  },
              })
            : null;

    const renamable = !!(opts.validateName || opts.onRename);
    const nameWrap = headerEl.createDiv({ cls: 'etz-card-name-wrap' });
    const badge = renamable
        ? nameWrap.createEl('button', { cls: 'etz-card-name mod-editable', attr: { type: 'button' } })
        : nameWrap.createSpan({ cls: 'etz-card-name' });
    badge.id = uniqueId('card-name');
    const kindEl = opts.kind ? visuallyHidden(headerEl, opts.kind) : null;
    if (kindEl) kindEl.id = uniqueId('card-kind');
    el.setAttr('aria-labelledby', [kindEl ? kindEl.id : '', badge.id].filter(Boolean).join(' '));

    const toggle = headerEl.createEl('button', {
        cls: 'etz-card-summary',
        attr: { type: 'button', 'aria-controls': bodyEl.id },
    });
    const summaryText = toggle.createSpan({ cls: 'etz-card-summary-text' });
    setIcon(toggle.createSpan({ cls: 'etz-card-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
    const errorDot = headerEl.createSpan({ cls: ['etz-card-error-dot', 'tikz-hidden'] });
    visuallyHidden(errorDot, 'Has an error');

    const eye = opts.onVisibleChange
        ? iconButton(headerEl, {
              icon: 'eye',
              label: 'Show in chart',
              pressed: opts.visible !== false,
              cls: 'etz-card-eye',
              onClick: () => {
                  visible = !visible;
                  syncVisible();
                  if (opts.onVisibleChange) opts.onVisibleChange(visible);
              },
          })
        : null;
    if (opts.menu) {
        const more = iconButton(headerEl, { icon: 'more-horizontal', label: 'More actions', cls: 'etz-card-more' });
        menuFromButton(more.el, opts.menu, 'end');
    }

    let name = opts.name;
    let visible = opts.visible !== false;
    let collapsed = !!opts.collapsed;

    const syncName = () => badge.setText(name);
    const syncVisible = () => {
        el.toggleClass('is-hidden-item', !visible);
        if (eye) {
            eye.setPressed(visible);
            eye.setIcon(visible ? 'eye' : 'eye-off');
        }
    };
    const syncCollapsed = () => {
        el.toggleClass('is-collapsed', collapsed);
        bodyEl.toggleClass('tikz-hidden', collapsed);
        toggle.setAttr('aria-expanded', String(!collapsed));
    };
    const setSummary = (summary: string) => {
        summaryText.setText(summary);
        toggle.setAttr('title', summary);
    };
    const flipCollapsed = () => {
        collapsed = !collapsed;
        syncCollapsed();
        if (opts.onCollapsedChange) opts.onCollapsedChange(collapsed);
    };

    toggle.addEventListener('click', flipCollapsed);
    headerEl.addEventListener('click', (e: MouseEvent) => {
        const target = asElement(e.target);
        if (!target || target.closest('button, input, select, textarea, a')) return;
        flipCollapsed();
    });
    el.addEventListener('keydown', (e: KeyboardEvent) => {
        if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isEditingTarget(e.target)) return;
        const move = e.key === 'ArrowUp' ? opts.onMoveUp : e.key === 'ArrowDown' ? opts.onMoveDown : undefined;
        if (!move) return;
        e.preventDefault();
        move();
    });

    // Inline rename: the badge turns into an input; Enter / blur commit, Escape cancels.
    let editing: { input: HTMLInputElement; release: () => void; error: HTMLElement } | null = null;
    const endRename = (commitIt: boolean, restoreFocus: boolean) => {
        if (!editing) return;
        const { input, release, error } = editing;
        const next = input.value.trim();
        if (commitIt && next !== name) {
            const problem = opts.validateName ? opts.validateName(next) : next ? null : 'Enter a name';
            if (problem) {
                error.setText(problem);
                error.removeClass('tikz-hidden');
                input.addClass('is-error');
                input.setAttr('aria-invalid', 'true');
                return;
            }
        }
        editing = null;
        release();
        input.remove();
        error.remove();
        badge.removeClass('tikz-hidden');
        if (commitIt && next !== name) {
            name = next;
            syncName();
            if (opts.onRename) opts.onRename(next);
        }
        // Keyboard endings return to the badge; a blur leaves focus where the user moved it.
        if (restoreFocus) badge.focus();
    };
    const startRename = () => {
        if (!renamable || editing) return;
        badge.addClass('tikz-hidden');
        const input = nameWrap.createEl('input', {
            cls: ['etz-input', 'mod-mono', 'etz-card-name-input'],
            type: 'text',
            attr: { autocomplete: 'off', spellcheck: 'false', size: Math.max(4, name.length + 2) },
        });
        input.value = name;
        nameBy(input, nameWrap, 'Name');
        const error = nameWrap.createDiv({ cls: ['etz-card-name-error', 'tikz-hidden'], attr: { role: 'alert' } });
        const release = trapEscape(keys, () => endRename(false, true));
        editing = { input, release, error };
        input.addEventListener('input', () => {
            input.setAttr('size', String(Math.max(4, input.value.length + 2)));
            error.addClass('tikz-hidden');
            input.removeClass('is-error');
            input.removeAttribute('aria-invalid');
        });
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                endRename(true, true);
            }
        });
        // Blur commits a valid name and quietly drops an invalid one.
        input.addEventListener('blur', () => {
            if (!editing) return;
            const next = input.value.trim();
            const problem = next === name ? null : opts.validateName ? opts.validateName(next) : next ? null : 'Enter a name';
            endRename(!problem, false);
        });
        input.focus();
        input.select();
    };
    if (renamable) badge.addEventListener('click', startRename);

    syncName();
    setSummary(opts.summary);
    syncVisible();
    syncCollapsed();

    return {
        el,
        headerEl,
        bodyEl,
        setName: (next) => {
            name = next;
            syncName();
        },
        setSummary,
        setColor: (c) => {
            if (swatch) swatch.setValue(c);
        },
        setVisible: (v) => {
            visible = v;
            syncVisible();
        },
        isCollapsed: () => collapsed,
        setCollapsed: (c) => {
            collapsed = c;
            syncCollapsed();
        },
        setError: (hasError) => {
            errorDot.toggleClass('tikz-hidden', !hasError);
            el.toggleClass('has-error', hasError);
        },
        focusHeader: () => toggle.focus(),
        startRename,
        destroy: () => {
            if (editing) {
                editing.release();
                editing = null;
            }
            if (swatch) swatch.close();
            el.remove();
        },
    };
}

// -------------------------------------------------------------- dialogs

export interface PromptTextOptions {
    title: string;
    value?: string;
    placeholder?: string;
    /** Primary button text (default 'Save'). */
    submitText?: string;
    /** Muted line under the title. */
    description?: string;
    /** Return an error message to refuse the (trimmed) value, or null. Empty input is always refused. */
    validate?: (value: string) => string | null;
}

/**
 * Single-field text prompt (Electron has no window.prompt). Resolves with
 * the trimmed text on submit, or null on cancel / Escape / dismiss.
 */
export function promptText(app: App, opts: PromptTextOptions): Promise<string | null> {
    return new Promise((resolve) => new TextPromptModal(app, opts, resolve).open());
}

class TextPromptModal extends Modal {
    private resolve: ((value: string | null) => void) | null;
    private opts: PromptTextOptions;

    constructor(app: App, opts: PromptTextOptions, resolve: (value: string | null) => void) {
        super(app);
        this.opts = opts;
        this.resolve = resolve;
    }

    onOpen() {
        this.modalEl.addClass('etz-dialog', 'etz-tokens');
        this.titleEl.setText(this.opts.title);
        const { contentEl } = this;
        if (this.opts.description) contentEl.createDiv({ cls: 'etz-dialog-desc', text: this.opts.description });
        const input = contentEl.createEl('input', {
            cls: ['etz-input', 'etz-dialog-input'],
            type: 'text',
            attr: { autocomplete: 'off', spellcheck: 'false' },
        });
        input.value = this.opts.value ?? '';
        if (this.opts.placeholder) input.placeholder = this.opts.placeholder;
        nameBy(input, contentEl, this.opts.title);
        const error = contentEl.createDiv({ cls: ['etz-dialog-error', 'tikz-hidden'], attr: { role: 'alert' } });
        const actions = contentEl.createDiv({ cls: 'etz-dialog-actions' });
        textButton(actions, { text: 'Cancel', onClick: () => this.close() });
        const submitBtn = textButton(actions, { text: this.opts.submitText ?? 'Save', variant: 'cta', onClick: () => submit() });

        // Empty input is refused silently ('' problem); other problems are shown as you type.
        const problemOf = (v: string) => (v ? (this.opts.validate ? this.opts.validate(v) : null) : '');
        const sync = () => {
            const problem = problemOf(input.value.trim());
            error.setText(problem ?? '');
            error.toggleClass('tikz-hidden', !problem);
            input.toggleClass('is-error', !!problem);
            input.setAttr('aria-invalid', problem ? 'true' : null);
            submitBtn.setDisabled(problem !== null);
            return problem;
        };
        const submit = () => {
            if (sync() !== null) return;
            const resolve = this.resolve;
            this.resolve = null;
            if (resolve) resolve(input.value.trim());
            this.close();
        };
        input.addEventListener('input', sync);
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                submit();
            }
        });
        sync();
        input.focus();
        input.select();
    }

    onClose() {
        this.contentEl.empty();
        const resolve = this.resolve;
        this.resolve = null;
        if (resolve) resolve(null);
    }
}

export interface ConfirmDialogOptions {
    title: string;
    message: string;
    /** Default 'OK'. */
    confirmText?: string;
    cancelText?: string;
    /** Red primary button (replacing or deleting things). */
    destructive?: boolean;
}

/** Yes / no question. Resolves true on confirm, false on cancel / Escape / dismiss. */
export function confirmDialog(app: App, opts: ConfirmDialogOptions): Promise<boolean> {
    return new Promise((resolve) => new ConfirmModal(app, opts, resolve).open());
}

class ConfirmModal extends Modal {
    private resolve: ((ok: boolean) => void) | null;
    private opts: ConfirmDialogOptions;

    constructor(app: App, opts: ConfirmDialogOptions, resolve: (ok: boolean) => void) {
        super(app);
        this.opts = opts;
        this.resolve = resolve;
    }

    onOpen() {
        this.modalEl.addClass('etz-dialog', 'etz-tokens');
        this.titleEl.setText(this.opts.title);
        this.contentEl.createDiv({ cls: 'etz-dialog-desc', text: this.opts.message });
        const actions = this.contentEl.createDiv({ cls: 'etz-dialog-actions' });
        textButton(actions, { text: this.opts.cancelText ?? 'Cancel', onClick: () => this.close() });
        const ok = textButton(actions, {
            text: this.opts.confirmText ?? 'OK',
            variant: 'cta',
            cls: this.opts.destructive ? 'mod-destructive' : undefined,
            onClick: () => {
                const resolve = this.resolve;
                this.resolve = null;
                if (resolve) resolve(true);
                this.close();
            },
        });
        ok.el.focus();
    }

    onClose() {
        this.contentEl.empty();
        const resolve = this.resolve;
        this.resolve = null;
        if (resolve) resolve(false);
    }
}
