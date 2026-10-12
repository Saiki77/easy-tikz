/*
 * Parameter sliders dock under the preview (visible in every tab).
 *
 * One to four parameters: a two-line row each.
 *   line 1   name  =  value                      play  more
 *   line 2   min  [------------ slider ------------]  max
 * Five or more: wrapping pills ('a = 1.5'); one pill at a time expands into
 * the same row below the pills.
 *
 * Data flow: every value change (drag, typing, play) writes the settings
 * 'parameters' entry, pushes the values into the shared MathContext with
 * setParams (no recompilation) and asks the host for a frame. Adding,
 * deleting and renaming go through the host (commit / rename), which
 * refreshes the dock in turn. refresh() rebuilds the DOM only when the
 * number of parameters (and so the layout) changed; otherwise it syncs the
 * existing controls, so a commit never steals focus from a dock field.
 * Rows look their parameter up by index on every event because the host
 * may replace the parameter objects between events (rename, undo).
 *
 * A slider added from outside the dock (the 'Add slider k' quick fix,
 * + Add > Slider) is spotted by refresh() and, in pills mode, opened right
 * away so it can be dragged without hunting for its pill.
 */
import { Parameter } from '../types';
import { RESERVED_NAMES } from '../migrate';
import type { HistoryEntry } from '../drag/history';
import { PanelHost } from './host';
import {
    NumberInputHandle,
    PopoverHandle,
    field,
    formatDecimals,
    iconButton,
    liveSlider,
    numberInput,
    popover,
    textButton,
    textInput,
    trapEscape,
    uniqueId,
} from './kit';

export interface SlidersDockHandle {
    el: HTMLElement;
    /** Rebuild rows from settings 'parameters' (hidden when there are none). */
    refresh(): void;
    /** Re-read values into sliders / inputs without rebuilding (after external changes). */
    syncValues(): void;
    /** Stop every play animation (modal close, 2D/3D switch). */
    stopAnimations(): void;
    /**
     * Optional (SPEC3 4.7): tint the rows (or pills) of the sliders a
     * preview drag is moving (class is-live); [] clears. Kept across rebuilds.
     */
    markLive?(names: string[]): void;
}

/** One sweep from min to max (or back) while playing. */
const SWEEP_MS = 4000;
/** From this many parameters on, the dock shows pills instead of rows. */
const PILL_THRESHOLD = 5;
/** Longest time step the animation accepts, so a background tab does not make it jump on return. */
const MAX_FRAME_MS = 100;
/** Delay before a name error appears while typing (the kit's inline messages use the same). */
const MESSAGE_IDLE_MS = 600;

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Values a tool publishes: P1_x, P1_y, P1_z, P1_val, P1_n and indexed ones like P1_x2. */
const DERIVED_RE = /^([A-Za-z][A-Za-z0-9_]*)_(x|y|z|val|n)\d*$/;

type Bound = 'min' | 'max' | 'step';
type Mode = 'empty' | 'rows' | 'pills';

interface Row {
    index: number;
    el: HTMLElement;
    /** Re-read name, value, range, step and play state (skips fields the user is editing). */
    sync(p: Parameter): void;
    /** Value only: thumb, fill and value field (play animation, typing). */
    syncValue(p: Parameter): void;
    focusName(): void;
    /** Release timers and Escape traps before the row leaves the DOM. */
    destroy(): void;
}

interface Pill {
    el: HTMLButtonElement;
    sync(p: Parameter, expanded: boolean): void;
}

interface Anim {
    /** Unsnapped position, so a sweep over a coarse step still advances every frame. */
    raw: number;
    dir: 1 | -1;
    /** Last value the animation wrote. Anything else means the user moved it: continue from there. */
    shown: number;
}

/** Strip binary floating point noise so stored values stay readable (0.30000000000000004 -> 0.3). */
function clean(v: number): number {
    return Number(v.toPrecision(12));
}

/** Slider values compared for the undo history (a hair of tolerance for floating point noise). */
function sameValue(a: number, b: number): boolean {
    return a === b || Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}

/** Decimals needed to show `step` exactly (0.05 -> 2, 1e-7 -> 7, 5 -> 0). */
function decimalsOf(step: number): number {
    if (!Number.isFinite(step) || step <= 0) return 0;
    const [mantissa, exponent] = String(step).split('e');
    const dot = mantissa.indexOf('.');
    const fraction = dot < 0 ? 0 : mantissa.length - dot - 1;
    return Math.max(0, fraction - (exponent ? parseInt(exponent, 10) : 0));
}

/** Nearest slider position min + k * step inside [min, max]. */
function snap(v: number, p: Parameter): number {
    const stepped = p.step > 0 ? p.min + Math.round((v - p.min) / p.step) * p.step : v;
    return clean(clamp(stepped, p.min, p.max));
}

/** Updates per second a play sweep aims for (one per display frame). */
const PLAY_UPDATES_PER_S = 60;

/**
 * Grid a play sweep moves on: the step itself, or a half, fifth or tenth of
 * a fractional step when whole steps would change the chart fewer than
 * about 60 times per second. Whole-number steps stay whole (exponents and
 * counts must not become fractions mid-play). Stopping snaps back onto the
 * step, so stored and exported values stay step-aligned.
 */
function playStep(p: Parameter): number {
    if (!(p.step > 0) || Number.isInteger(p.step) || !(p.max > p.min)) return p.step;
    const wanted = (p.step * PLAY_UPDATES_PER_S * SWEEP_MS) / 1000 / (p.max - p.min);
    for (const k of [1, 2, 5, 10]) if (k >= wanted) return p.step / k;
    return p.step / 10;
}

/** Pill text and end labels: up to 3 decimals, more when the step needs them. */
function formatValue(v: number, step: number): string {
    return formatDecimals(v, Math.max(3, decimalsOf(step)));
}

/** Kit controls are named through a hidden label (aria-labelledby); point it at new text. */
function relabel(el: HTMLElement, text: string): void {
    const id = el.getAttribute('aria-labelledby');
    const label = id ? el.ownerDocument.getElementById(id) : null;
    if (label) label.setText(text);
}

/** Mark a focusable control so focus can return to the same place after a rebuild. */
function slot(el: HTMLElement, kind: string, index: number): void {
    el.setAttr('data-etz-slot', `${kind}:${index}`);
}

export function createSlidersDock(parent: HTMLElement, host: PanelHost): SlidersDockHandle {
    const el = parent.createDiv({ cls: ['etz-dock', 'tikz-hidden'] });
    const header = el.createDiv({ cls: 'etz-dock-header' });
    const title = header.createDiv({ cls: 'etz-dock-title', text: 'Sliders', attr: { role: 'heading', 'aria-level': '2' } });
    title.id = uniqueId('dock-title');
    el.setAttr('role', 'region');
    el.setAttr('aria-labelledby', title.id);
    const addButton = textButton(header, { text: 'Add slider', icon: 'plus', variant: 'ghost', size: 'sm', cls: 'etz-dock-add', onClick: () => addSlider() });
    const body = el.createDiv({ cls: 'etz-dock-body' });

    let mode: Mode = 'empty';
    // -1 forces the first refresh() to build.
    let count = -1;
    let rows: Row[] = [];
    let pills: Pill[] = [];
    /** Pills mode: the expanded parameter's row and its container. */
    let editor: Row | null = null;
    let editorEl: HTMLElement | null = null;
    let expanded: string | null = null;
    /** Parameter names at the last refresh or rebuild, to spot one added from outside the dock. */
    let known: Set<string> | null = null;
    let options: { handle: PopoverHandle; anchor: HTMLElement } | null = null;
    /** True while rebuild() tears down and recreates the DOM (removed inputs may fire blur). */
    let rebuilding = false;
    /**
     * True during rename(): the host's commit refreshes the dock while the
     * old and new name are both in flight, which must not drop the play
     * state or the expanded pill. The dock syncs once the rename is done.
     */
    let renaming = false;

    /** Sliders a preview drag is moving (markLive); their rows or pills get is-live. */
    let liveNames: string[] = [];

    // Play state, keyed by parameter name (a rename moves the entry).
    const anims = new Map<string, Anim>();
    /** Parameters the user is dragging or typing into: the animation leaves them alone. */
    const held = new Set<string>();
    let frame: number | null = null;
    let lastTime = 0;

    // ------------------------------------------------------------ data

    const params = (): Parameter[] => {
        const list = host.settings.getValue<Parameter[] | undefined>('parameters');
        return Array.isArray(list) ? list : [];
    };

    /** Store `list` and update the preview: values in place, then a draft frame. */
    const publish = (list: Parameter[]) => {
        host.settings.setValue('parameters', list);
        host.math().setParams(list);
        host.requestFrame();
    };

    const modeFor = (n: number): Mode => (n === 0 ? 'empty' : n >= PILL_THRESHOLD ? 'pills' : 'rows');

    const names = (key: 'functions' | 'functions3D' | 'tools'): string[] => {
        const list = host.settings.getValue<unknown[] | undefined>(key);
        if (!Array.isArray(list)) return [];
        const out: string[] = [];
        for (const item of list) {
            const name = item && typeof item === 'object' ? (item as { name?: unknown }).name : undefined;
            if (typeof name === 'string' && name) out.push(name);
        }
        return out;
    };

    /** True when the engine reads `name` as an axis ('q p', 'q; p' and 'q, p' all make p the second axis). */
    const isAxisName = (name: string): boolean => {
        try {
            const [first, second] = host.math().axisAliases;
            return first.includes(name) || second.includes(name);
        } catch {
            return name === 'x' || name === 'y';
        }
    };

    /** Why `name` cannot name parameter `index`, or null when it can. */
    const nameProblem = (name: string, index: number): string | null => {
        if (!name) return 'Enter a name';
        if (!NAME_RE.test(name)) return 'Start with a letter, then letters, digits or _';
        if (RESERVED_NAMES.has(name)) return `${name} is a built-in name`;
        if (isAxisName(name)) return `${name} is an axis variable`;
        if (params().some((p, i) => i !== index && p.name === name)) return `${name} is already a slider`;
        const tools = names('tools');
        if (names('functions').includes(name) || names('functions3D').includes(name) || tools.includes(name)) {
            return `${name} is already used`;
        }
        const derived = DERIVED_RE.exec(name);
        if (derived && tools.includes(derived[1])) return `${name} is a value computed by ${derived[1]}`;
        return null;
    };

    /** Why `value` cannot become `key` of parameter `p`, or null. */
    const rangeProblem = (p: Parameter, key: Bound, value: number): string | null => {
        if (key === 'min' && value >= p.max) return 'Min must be less than max';
        if (key === 'max' && value <= p.min) return 'Max must be greater than min';
        if (key === 'step' && value <= 0) return 'Step must be greater than 0';
        if (key === 'step' && value > p.max - p.min) return 'Step must fit inside the range';
        return null;
    };

    // --------------------------------------------------------- changes

    /** Live value change (drag, typing, arrow keys): no range widening yet. */
    const changeValue = (index: number, value: number) => {
        const list = params();
        const p = list[index];
        if (!p || !Number.isFinite(value)) return;
        const v = clean(value);
        if (v === p.value) return;
        p.value = v;
        publish(list);
        showValue(index, p);
    };

    /** Committed value (Enter, blur, arrow step): a value outside the range widens it. */
    const commitValue = (index: number, value: number) => {
        const list = params();
        const p = list[index];
        if (!p || !Number.isFinite(value)) return;
        const v = clean(value);
        const widened = v < p.min || v > p.max;
        p.min = Math.min(p.min, v);
        p.max = Math.max(p.max, v);
        p.value = v;
        publish(list);
        syncAll();
        // The range is chart data too (inline sliders, autosave).
        if (widened) host.requestUpdate();
    };

    /** Validated min / max / step edit; the value is pulled back inside the new range. */
    const changeRange = (index: number, key: Bound, value: number) => {
        const list = params();
        const p = list[index];
        if (!p) return;
        p[key] = clean(value);
        const inside = clamp(p.value, p.min, p.max);
        if (inside !== p.value) {
            p.value = inside;
            host.math().setParams(list);
        }
        host.settings.setValue('parameters', list);
        syncAll();
        host.requestUpdate();
    };

    /**
     * Undo / redo of one history entry: move slider `name` from `from` to
     * `to`, only while it still holds `from` (a later change wins; the entry
     * then reports the slider as stale).
     */
    const restoreValue = (entry: HistoryEntry, name: string, from: number, to: number): boolean => {
        const list = params();
        const p = list.find((q) => q.name === name);
        if (!p || !sameValue(p.value, from)) {
            entry.stale = [name];
            return false;
        }
        entry.stale = [];
        p.value = to;
        publish(list);
        syncAll();
        return true;
    };

    /** A finished change (slider gesture, typed value) becomes one entry of the chart's undo history (Mod+Z). */
    const recordChange = (name: string, before: number, after: number) => {
        if (!host.pushHistory || sameValue(before, after)) return;
        const entry: HistoryEntry = {
            label: `Changed slider ${name}`,
            stale: [],
            undo: () => restoreValue(entry, name, after, before),
            redo: () => restoreValue(entry, name, before, after),
        };
        host.pushHistory(entry);
    };

    const rename = (index: number, to: string) => {
        const p = params()[index];
        if (!p || p.name === to) return;
        const from = p.name;
        const anim = anims.get(from);
        if (anim) {
            anims.delete(from);
            anims.set(to, anim);
        }
        if (held.delete(from)) held.add(to);
        if (expanded === from) expanded = to;
        renaming = true;
        try {
            host.rename('parameter', from, to);
            // host.rename propagates the name through every field; if it left
            // the parameter entry itself alone, rename that too.
            const list = params();
            const stale = list.find((q) => q.name === from);
            if (stale) {
                stale.name = to;
                host.settings.setValue('parameters', list);
                host.commit();
            }
        } finally {
            renaming = false;
        }
        refresh();
    };

    const remove = (index: number) => {
        const list = params();
        const p = list[index];
        if (!p) return;
        anims.delete(p.name);
        held.delete(p.name);
        if (expanded === p.name) expanded = null;
        list.splice(index, 1);
        host.settings.setValue('parameters', list);
        host.commit();
        refresh();
        host.showUndo(`Deleted slider ${p.name}`, () => {
            const current = params();
            // The name may have been taken again in the meantime.
            if (current.some((q) => q.name === p.name)) return;
            current.splice(Math.min(index, current.length), 0, p);
            host.settings.setValue('parameters', current);
            host.commit();
            refresh();
        });
    };

    /** The row showing parameter `name`: its row, or the pills editor while that pill is open. */
    const rowOf = (name: string): Row | null => {
        const index = params().findIndex((q) => q.name === name);
        if (index < 0) return null;
        if (mode === 'rows') return rows[index] ?? null;
        return editor && editor.index === index ? editor : null;
    };

    const addSlider = () => {
        const p = host.addParameter();
        // The host's commit usually refreshed the dock already, which opened the new pill.
        if (params().length >= PILL_THRESHOLD) expanded = p.name;
        refresh();
        const row = rowOf(p.name);
        if (!row) return;
        row.el.scrollIntoView({ block: 'nearest' });
        row.focusName();
    };

    // ------------------------------------------------------------ play

    const tick = (now: number) => {
        frame = null;
        if (!el.isConnected) {
            stopAnimations();
            return;
        }
        const dt = lastTime ? Math.min(MAX_FRAME_MS, now - lastTime) : 0;
        lastTime = now;
        const list = params();
        let changed = false;
        list.forEach((p, index) => {
            const anim = anims.get(p.name);
            if (!anim || held.has(p.name)) return;
            const span = p.max - p.min;
            if (!(span > 0)) return;
            if (anim.shown !== p.value) anim.raw = p.value;
            let raw = anim.raw + (anim.dir * span * dt) / SWEEP_MS;
            // Bounce off the ends.
            if (raw >= p.max) {
                raw = 2 * p.max - raw;
                anim.dir = -1;
            } else if (raw <= p.min) {
                raw = 2 * p.min - raw;
                anim.dir = 1;
            }
            anim.raw = clamp(raw, p.min, p.max);
            // A finer grid than the step while playing, so the chart moves every frame.
            const v = snap(anim.raw, { ...p, step: playStep(p) });
            anim.shown = v;
            if (v !== p.value) {
                p.value = v;
                changed = true;
                showValue(index, p);
            }
        });
        for (const name of Array.from(anims.keys())) {
            if (!list.some((p) => p.name === name)) anims.delete(name);
        }
        if (changed) publish(list);
        if (anims.size) frame = window.requestAnimationFrame(tick);
        else lastTime = 0;
    };

    /**
     * Put stopped parameters back on their step (play moves on a finer grid).
     * `render` asks for a frame; closing or switching charts skips it.
     */
    const settleOnStep = (names: string[], render: boolean) => {
        const list = params();
        let moved = false;
        for (const p of list) {
            if (!names.includes(p.name)) continue;
            const v = snap(p.value, p);
            if (v === p.value) continue;
            p.value = v;
            moved = true;
        }
        if (!moved) return;
        if (render) publish(list);
        else {
            host.settings.setValue('parameters', list);
            host.math().setParams(list);
        }
    };

    const togglePlay = (index: number) => {
        const p = params()[index];
        if (!p) return;
        if (anims.has(p.name)) {
            anims.delete(p.name);
            settleOnStep([p.name], true);
        } else if (p.max > p.min) {
            anims.set(p.name, { raw: p.value, dir: p.value >= p.max ? -1 : 1, shown: p.value });
            if (frame === null) {
                lastTime = 0;
                frame = window.requestAnimationFrame(tick);
            }
        }
        syncAll();
    };

    const stopAnimations = () => {
        const playing = Array.from(anims.keys());
        anims.clear();
        held.clear();
        // No frame: the modal is closing, switching 2D / 3D or loading another chart, and renders itself.
        if (playing.length) {
            try {
                settleOnStep(playing, false);
            } catch {
                // A math context that cannot be built leaves the values as they are.
            }
        }
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = null;
        lastTime = 0;
        if (el.isConnected) syncAll();
    };

    /** Pause the animation of parameter `index` until the pointer is released anywhere. */
    const holdWhileDragging = (index: number) => {
        const p = params()[index];
        if (!p) return;
        const name = p.name;
        held.add(name);
        const doc = el.ownerDocument;
        const release = () => {
            held.delete(name);
            doc.removeEventListener('pointerup', release, true);
            doc.removeEventListener('pointercancel', release, true);
        };
        doc.addEventListener('pointerup', release, true);
        doc.addEventListener('pointercancel', release, true);
    };

    // --------------------------------------------------------- options

    const closeOptions = () => {
        if (options) options.handle.close();
        options = null;
    };

    /** Popover with min / max / step and Delete, anchored at a row's more button (toggles). */
    const openOptions = (index: number, anchor: HTMLElement) => {
        const wasOpenHere = !!options && options.anchor === anchor && options.handle.isOpen();
        closeOptions();
        const p = params()[index];
        if (wasOpenHere || !p) return;
        const handle = popover(anchor, host, {
            label: `Slider ${p.name} options`,
            align: 'end',
            // The dock sits right above the action bar: open the sheet over the preview.
            placement: 'above',
            cls: 'etz-dock-pop',
            build: (pop, self) => {
                const grid = pop.createDiv({ cls: 'etz-dock-pop-grid' });
                const msg = pop.createDiv({ cls: ['etz-dock-msg', 'tikz-hidden'], attr: { role: 'alert' } });
                const bound = (key: Bound, label: string) => {
                    const f = field(grid, { label });
                    const current = params()[index];
                    const input: NumberInputHandle = numberInput(f.controlEl, {
                        value: current ? current[key] : 0,
                        label,
                        step: current && current.step > 0 ? current.step : undefined,
                        cls: 'etz-dock-pop-input',
                        onCommit: (v) => {
                            const q = params()[index];
                            if (!q) return;
                            const problem = rangeProblem(q, key, v);
                            msg.setText(problem ?? '');
                            msg.toggleClass('tikz-hidden', !problem);
                            input.el.toggleClass('is-error', !!problem);
                            if (problem) input.setValue(q[key]);
                            else changeRange(index, key, v);
                        },
                    });
                    f.bind(input.el);
                };
                bound('min', 'Min');
                bound('max', 'Max');
                bound('step', 'Step');
                textButton(pop, {
                    text: 'Delete slider',
                    icon: 'trash-2',
                    size: 'sm',
                    cls: 'etz-dock-delete',
                    onClick: () => {
                        self.close();
                        remove(index);
                    },
                });
            },
            onClose: () => {
                if (options && options.handle === handle) options = null;
            },
        });
        options = { handle, anchor };
    };

    // ------------------------------------------------------------- row

    const buildRow = (container: HTMLElement, index: number, initial: Parameter): Row => {
        let name = initial.name;
        let step = initial.step;
        let playingShown = false;
        // False once the row is being removed: inputs blurred by the removal must not commit.
        let alive = true;
        const doc = container.ownerDocument;
        const focused = (input: HTMLElement) => doc.activeElement === input;

        const rowEl = container.createDiv({ cls: 'etz-dock-row' });
        const line = rowEl.createDiv({ cls: 'etz-dock-line' });

        // Name: validated while typing, applied on Enter / blur, reverted on Escape.
        const nameInput = textInput(line, { value: name, label: 'Slider name', monospace: true, cls: 'etz-dock-name' });
        slot(nameInput.el, 'name', index);
        line.createSpan({ cls: 'etz-dock-eq', text: '=', attr: { 'aria-hidden': 'true' } });

        // Undo history: the value when a slider gesture (pointer or key) or a typing session
        // started; the gesture's end or the typed commit records one entry from there.
        let gestureStart: number | null = null;
        let typedStart: number | null = null;
        const currentValue = (): number | null => {
            const p = params()[index];
            return p ? p.value : null;
        };
        const record = (start: number | null) => {
            const p = params()[index];
            if (alive && start !== null && p) recordChange(p.name, start, p.value);
        };

        // Value field: recreated when the step changes (arrow keys use the step it was built with).
        const valueHolder = line.createSpan({ cls: 'etz-dock-value-holder' });
        let valueInput: NumberInputHandle;
        const buildValueInput = (p: Parameter) => {
            valueHolder.empty();
            valueInput = numberInput(valueHolder, {
                value: p.value,
                label: `Value of ${name}`,
                step: p.step > 0 ? p.step : undefined,
                cls: 'etz-dock-value',
                onInput: (v) => {
                    if (!alive) return;
                    // Typing changes the value live: the entry starts before the first keystroke.
                    if (typedStart === null) typedStart = currentValue();
                    changeValue(index, v);
                },
                onCommit: (v) => {
                    if (!alive) return;
                    commitValue(index, v);
                    record(typedStart);
                    typedStart = currentValue();
                },
            });
            slot(valueInput.el, 'value', index);
            // The animation must not overwrite what the user is typing.
            valueInput.el.addEventListener('focus', () => {
                held.add(name);
                typedStart = currentValue();
            });
            // The kit commits on blur first (its listener is older), then the session ends.
            valueInput.el.addEventListener('blur', () => {
                held.delete(name);
                typedStart = null;
            });
        };
        buildValueInput(initial);

        line.createDiv({ cls: 'etz-dock-spacer' });
        const play = iconButton(line, { icon: 'play', label: `Play ${name}`, pressed: false, onClick: () => togglePlay(index) });
        slot(play.el, 'play', index);
        const more = iconButton(line, { icon: 'more-horizontal', label: `Options for ${name}`, onClick: () => openOptions(index, more.el) });
        slot(more.el, 'more', index);

        const msg = rowEl.createDiv({ cls: ['etz-dock-msg', 'tikz-hidden'], attr: { 'aria-live': 'polite' } });
        msg.id = uniqueId('dock-msg');
        const showMessage = (text: string | null) => {
            msg.setText(text ?? '');
            msg.toggleClass('tikz-hidden', !text);
        };

        // Line 2: full-width slider between editable end labels.
        const range = rowEl.createDiv({ cls: 'etz-dock-range' });
        const ends: { which: 'min' | 'max'; set(p: Parameter): void; relabel(): void }[] = [];
        const endEditor = (which: 'min' | 'max') => {
            const wrap = range.createDiv({ cls: ['etz-dock-end', `mod-${which}`] });
            const button = wrap.createEl('button', { cls: 'etz-dock-end-btn', attr: { type: 'button' } });
            slot(button, which, index);
            const srLabel = () => `${which === 'min' ? 'Minimum' : 'Maximum'} of ${name}, click to edit`;
            const buttonText = button.createSpan({ attr: { 'aria-hidden': 'true' } });
            const buttonLabel = button.createSpan({ cls: 'etz-sr-only', text: srLabel() });
            // Holds the number field (and its hidden label) while editing.
            const holder = wrap.createSpan({ cls: 'etz-dock-end-holder' });
            let input: NumberInputHandle | null = null;
            let invalid = false;
            let releaseEscape: (() => void) | null = null;

            const close = (refocus: boolean) => {
                if (!input) return;
                input = null;
                if (releaseEscape) releaseEscape();
                releaseEscape = null;
                invalid = false;
                showMessage(null);
                holder.empty();
                button.removeClass('tikz-hidden');
                if (refocus) button.focus();
            };
            const open = () => {
                const p = params()[index];
                if (!p || input) return;
                button.addClass('tikz-hidden');
                const editing: NumberInputHandle = numberInput(holder, {
                    value: p[which],
                    label: which === 'min' ? `Minimum of ${name}` : `Maximum of ${name}`,
                    step: p.step > 0 ? p.step : undefined,
                    cls: 'etz-dock-end-input',
                    onCommit: (v) => {
                        const q = params()[index];
                        if (!q || !alive) return;
                        const problem = rangeProblem(q, which, v);
                        invalid = !!problem;
                        editing.el.toggleClass('is-error', invalid);
                        editing.el.setAttr('aria-invalid', String(invalid));
                        showMessage(problem);
                        if (problem) editing.setValue(q[which]);
                        else changeRange(index, which, v);
                    },
                });
                input = editing;
                editing.el.setAttr('aria-describedby', msg.id);
                editing.el.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter' && !invalid) close(true);
                });
                editing.el.addEventListener('blur', () => close(false));
                releaseEscape = trapEscape(host, () => {
                    // Revert first so the blur caused by removing the field commits nothing.
                    const q = params()[index];
                    if (q) editing.setValue(q[which]);
                    close(true);
                });
                editing.focus(true);
            };
            button.addEventListener('click', open);
            ends.push({
                which,
                set: (p) => {
                    buttonText.setText(formatValue(p[which], p.step));
                    if (input && !focused(input.el)) input.setValue(p[which]);
                },
                relabel: () => buttonLabel.setText(srLabel()),
            });
            return { close };
        };

        const minEnd = endEditor('min');
        const slider = liveSlider(range, {
            min: initial.min,
            max: initial.max,
            step: initial.step,
            value: initial.value,
            label: name,
            readout: 'none',
            cls: 'etz-dock-slider',
            onInput: (v) => changeValue(index, v),
            // 'change': the pointer was released, or a key step finished.
            onCommit: () => {
                record(gestureStart);
                gestureStart = null;
            },
        });
        slot(slider.input, 'slider', index);
        const startGesture = () => {
            gestureStart = currentValue();
        };
        slider.input.addEventListener('pointerdown', () => {
            startGesture();
            holdWhileDragging(index);
        });
        slider.input.addEventListener('keydown', startGesture);
        const maxEnd = endEditor('max');

        // Name editing.
        let messageTimer: number | null = null;
        let releaseNameEscape: (() => void) | null = null;
        const clearTimer = () => {
            if (messageTimer !== null) window.clearTimeout(messageTimer);
            messageTimer = null;
        };
        const setNameError = (problem: string | null, immediate: boolean) => {
            nameInput.el.toggleClass('is-error', !!problem);
            nameInput.el.setAttr('aria-invalid', String(!!problem));
            clearTimer();
            if (!problem || immediate) {
                showMessage(problem);
                return;
            }
            messageTimer = window.setTimeout(() => {
                messageTimer = null;
                showMessage(problem);
            }, MESSAGE_IDLE_MS);
        };
        const revertName = () => {
            nameInput.setValue(name);
            setNameError(null, true);
            if (releaseNameEscape) releaseNameEscape();
            releaseNameEscape = null;
        };
        nameInput.el.setAttr('aria-describedby', msg.id);
        nameInput.el.addEventListener('input', () => {
            const typed = nameInput.el.value.trim();
            const dirty = typed !== name;
            setNameError(dirty ? nameProblem(typed, index) : null, false);
            if (dirty && !releaseNameEscape) releaseNameEscape = trapEscape(host, revertName);
            else if (!dirty && releaseNameEscape) {
                releaseNameEscape();
                releaseNameEscape = null;
            }
        });
        const applyName = (fromEnter: boolean) => {
            if (!alive) return;
            const typed = nameInput.el.value.trim();
            if (typed === name) {
                revertName();
                return;
            }
            const problem = nameProblem(typed, index);
            if (problem) {
                // Enter keeps the field open with the reason; leaving it reverts.
                if (fromEnter) setNameError(problem, true);
                else revertName();
                return;
            }
            if (releaseNameEscape) releaseNameEscape();
            releaseNameEscape = null;
            setNameError(null, true);
            rename(index, typed);
        };
        nameInput.el.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            e.preventDefault();
            applyName(true);
        });
        nameInput.el.addEventListener('blur', () => applyName(false));

        const syncValue = (p: Parameter) => {
            // A value typed outside the range moves the thumb once it is committed (and widens the range).
            if (p.value >= p.min && p.value <= p.max) slider.setValue(p.value);
            if (!focused(valueInput.el)) valueInput.setValue(p.value);
        };

        const row: Row = {
            index,
            el: rowEl,
            syncValue,
            sync: (p) => {
                if (p.name !== name) {
                    name = p.name;
                    relabel(valueInput.el, `Value of ${name}`);
                    relabel(slider.input, name);
                    play.setLabel(`Play ${name}`);
                    more.setLabel(`Options for ${name}`);
                    for (const end of ends) end.relabel();
                }
                if (!releaseNameEscape && !focused(nameInput.el)) nameInput.setValue(name);
                if (p.step !== step && !focused(valueInput.el)) {
                    step = p.step;
                    buildValueInput(p);
                }
                slider.setRange(p.min, p.max, p.step);
                syncValue(p);
                for (const end of ends) end.set(p);
                const playing = anims.has(p.name);
                if (playing !== playingShown) {
                    playingShown = playing;
                    play.setPressed(playing);
                    play.setIcon(playing ? 'pause' : 'play');
                }
            },
            focusName: () => nameInput.focus(true),
            destroy: () => {
                alive = false;
                clearTimer();
                if (releaseNameEscape) releaseNameEscape();
                releaseNameEscape = null;
                minEnd.close(false);
                maxEnd.close(false);
                held.delete(name);
            },
        };
        // End labels and play state start empty until the first sync.
        row.sync(initial);
        return row;
    };

    // ------------------------------------------------------------ pill

    const buildPill = (container: HTMLElement, index: number): Pill => {
        const pill = container.createEl('button', { cls: 'etz-dock-pill', attr: { type: 'button', 'aria-expanded': 'false' } });
        slot(pill, 'pill', index);
        pill.createSpan({ cls: 'etz-dock-pill-dot', attr: { 'aria-hidden': 'true' } });
        const nameEl = pill.createSpan({ cls: 'etz-dock-pill-name' });
        pill.createSpan({ cls: 'etz-dock-pill-eq', text: '=' });
        const valueEl = pill.createSpan({ cls: 'etz-dock-pill-value' });
        const stateEl = pill.createSpan({ cls: 'etz-sr-only' });
        pill.addEventListener('click', () => {
            const p = params()[index];
            if (!p) return;
            expanded = expanded === p.name ? null : p.name;
            syncAll();
        });
        return {
            el: pill,
            sync: (p, isExpanded) => {
                nameEl.setText(p.name);
                valueEl.setText(formatValue(p.value, p.step));
                const playing = anims.has(p.name);
                pill.toggleClass('is-playing', playing);
                stateEl.setText(playing ? ', playing' : '');
                pill.setAttr('aria-expanded', String(isExpanded));
            },
        };
    };

    // ------------------------------------------------------- rendering

    const renderEditor = () => {
        if (editor) editor.destroy();
        editor = null;
        if (!editorEl) return;
        editorEl.empty();
        const list = params();
        const index = expanded === null ? -1 : list.findIndex((p) => p.name === expanded);
        if (index < 0) expanded = null;
        editorEl.toggleClass('tikz-hidden', index < 0);
        if (index >= 0) editor = buildRow(editorEl, index, list[index]);
        applyLive();
    };

    /** is-live on the rows / pills (and the open pill's row) of the sliders a preview drag moves. */
    const applyLive = () => {
        const list = params();
        const isLive = (i: number) => !!list[i] && liveNames.includes(list[i].name);
        for (const row of rows) row.el.toggleClass('is-live', isLive(row.index));
        pills.forEach((pill, i) => pill.el.toggleClass('is-live', isLive(i)));
        if (editor) editor.el.toggleClass('is-live', isLive(editor.index));
    };

    /** Value change of parameter `index`: update every control that shows it. */
    const showValue = (index: number, p: Parameter) => {
        if (mode === 'rows') {
            const row = rows[index];
            if (row) row.syncValue(p);
            return;
        }
        const pill = pills[index];
        if (pill) pill.sync(p, p.name === expanded);
        if (editor && editor.index === index) editor.syncValue(p);
    };

    const syncAll = () => {
        if (rebuilding || renaming) return;
        const list = params();
        if (list.length !== count) {
            rebuild();
            return;
        }
        for (const row of rows) {
            const p = list[row.index];
            if (p) row.sync(p);
        }
        pills.forEach((pill, i) => {
            if (list[i]) pill.sync(list[i], list[i].name === expanded);
        });
        if (mode === 'pills') {
            const index = expanded === null ? -1 : list.findIndex((p) => p.name === expanded);
            if ((editor ? editor.index : -1) !== index) renderEditor();
            else if (editor && index >= 0) editor.sync(list[index]);
        }
    };

    const focusedSlot = (): string | null => {
        const active = el.ownerDocument.activeElement;
        if (!active || !el.contains(active)) return null;
        const holder = active.closest('[data-etz-slot]');
        return holder ? holder.getAttribute('data-etz-slot') : null;
    };

    /**
     * Focus the control in the same slot, else the same control of the
     * previous row (after a delete), else that parameter's pill (the layout
     * switched to pills), else the Add button.
     */
    const restoreFocus = (id: string) => {
        const [kind, at] = id.split(':');
        const index = parseInt(at, 10);
        const candidates = [`${kind}:${index}`, `${kind}:${index - 1}`, `pill:${index}`, `pill:${index - 1}`];
        for (const c of candidates) {
            const target = body.querySelector<HTMLElement>(`[data-etz-slot="${c}"]`);
            if (target) {
                target.focus();
                return;
            }
        }
        if (mode !== 'empty') addButton.el.focus();
    };

    const rebuild = () => {
        if (rebuilding) return;
        const restore = focusedSlot();
        closeOptions();
        rebuilding = true;
        try {
            for (const row of rows) row.destroy();
            if (editor) editor.destroy();
            rows = [];
            pills = [];
            editor = null;
            editorEl = null;
            body.empty();
            const list = params();
            count = list.length;
            mode = modeFor(count);
            // A rebuild through syncValues() must not make the next refresh() report these names as new.
            known = new Set(list.map((p) => p.name));
            el.toggleClass('tikz-hidden', mode === 'empty');
            el.toggleClass('mod-pills', mode === 'pills');
            if (mode === 'rows') {
                const grid = body.createDiv({ cls: 'etz-dock-rows' });
                rows = list.map((p, i) => buildRow(grid, i, p));
            } else if (mode === 'pills') {
                if (expanded !== null && !list.some((p) => p.name === expanded)) expanded = null;
                const wrap = body.createDiv({ cls: 'etz-dock-pills', attr: { role: 'group', 'aria-labelledby': title.id } });
                pills = list.map((_, i) => buildPill(wrap, i));
                editorEl = body.createDiv({ cls: 'etz-dock-editor' });
                editorEl.id = uniqueId('dock-editor');
                for (const pill of pills) pill.el.setAttr('aria-controls', editorEl.id);
            }
        } finally {
            rebuilding = false;
        }
        renderEditor();
        syncAll();
        applyLive();
        if (restore) restoreFocus(restore);
    };

    /**
     * Note the current names and return the one parameter added since the
     * last call (quick fix 'Add slider k', + Add > Slider, Undo of a delete),
     * or null. Loading a chart or renaming does not count.
     */
    const takeAdded = (list: Parameter[]): string | null => {
        const before = known;
        known = new Set(list.map((p) => p.name));
        if (!before || list.length !== before.size + 1) return null;
        const added = list.filter((p) => !before.has(p.name));
        return added.length === 1 ? added[0].name : null;
    };

    const refresh = () => {
        if (rebuilding || renaming) return;
        const list = params();
        for (const name of Array.from(anims.keys())) {
            if (!list.some((p) => p.name === name)) anims.delete(name);
        }
        // In pills mode a new slider opens at once, so the user can drag the slider they just asked for.
        // Focus stays where it is (the quick fix keeps it in the expression field).
        const added = takeAdded(list);
        if (added !== null && modeFor(list.length) === 'pills') expanded = added;
        if (list.length !== count || modeFor(list.length) !== mode) rebuild();
        else syncAll();
        const row = added !== null ? rowOf(added) : null;
        if (row) row.el.scrollIntoView({ block: 'nearest' });
    };

    const markLive = (live: string[]) => {
        liveNames = live.slice();
        applyLive();
    };

    refresh();
    return { el, refresh, syncValues: syncAll, stopAnimations, markLive };
}
