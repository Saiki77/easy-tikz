/*
 * One card per layer: region / curve / points / segment / plane tools and
 * text labels (annotations). Built from the UI kit (src/ui/kit.ts). A tool
 * card edits its tool object in place inside settings 'tools'; a label card
 * edits settings 'annotations'[index]. Every edit tells the host what kind
 * of change it was: typing -> requestUpdate, live sliders -> requestFrame,
 * structural changes (a tool added, a rename) -> commit. Field ids match
 * SceneIssue.field (scene.ts), so the status chip can reveal them.
 * Styles: src/ui/layers.css.
 */
import type { Menu } from 'obsidian';
import {
    Annotation,
    AnnotationAnchor,
    AnnotationSize,
    CurveTool,
    FillPattern,
    FunctionParameters,
    Function3DParameters,
    MarkerSize,
    OutlineStyle,
    Parameter,
    PlaneTool,
    PointsTool,
    RegionTool,
    SegmentStyle,
    SegmentTool,
    Tool,
} from '../types';
import { Issue, LABEL_LOCALS, ValidateKind, ValidateResult } from '../mathcontext';
import { FILL_PATTERN_OPTIONS } from '../colors';
import type { SceneIssue } from '../scene';
import { RESERVED_NAMES, RecipeContext, defaultTool, recipes } from '../migrate';
import { CardActions, PanelHost } from './host';
import {
    CardShellHandle,
    ChipHandle,
    DropdownHandle,
    DropdownOption,
    ExprInputHandle,
    FieldLayoutHandle,
    LiveSliderHandle,
    SegmentOption,
    SegmentedHandle,
    cardShell,
    chip,
    dropdown,
    exprInput,
    field,
    iconButton,
    liveSlider,
    segmented,
    textButton,
    thicknessPicker,
    uniqueId,
} from './kit';
import { t } from '../i18n';
import type { MessageKey } from '../i18n';

/** A tool object (mutated in place inside settings 'tools') or a label (index into settings 'annotations'). */
export type LayerItem = { kind: 'tool'; tool: Tool } | { kind: 'label'; index: number };

export interface LayerCardHandle {
    el: HTMLElement;
    item: LayerItem;
    /** Re-read values from settings into the inputs (e.g. after a rename or a preview drag). */
    refresh(): void;
    setCollapsed(collapsed: boolean): void;
    /** Expand, scroll into view and focus `field` (SceneIssue.field ids); select `selectText` if present. */
    reveal(field?: string, selectText?: string): void;
    /** True when any field of this card currently shows an error. */
    hasError(): boolean;
    /** Unregister fields, stop listeners. */
    destroy(): void;
    /**
     * v4 extra (optional): current collapsed state, so the Build panel can
     * keep it when it rebuilds its list.
     */
    isCollapsed?(): boolean;
    /**
     * v4 extra (optional): show the scene / render issues of this card.
     * Pass the full issue list; the card keeps the ones whose source is its
     * own (tool name or 'label:<index>'). Errors for a known field appear
     * under that field, everything else (and every 'info' issue, such as
     * "objective is unbounded") as a note at the bottom of the card. An
     * empty list clears them.
     */
    setIssues?(issues: SceneIssue[]): void;
    /**
     * Optional (SPEC3 4.7): re-read the expression inputs while a preview
     * drag rewrites the item: text only where it differs, no validation (the
     * drag's commit re-validates every field); the summary follows.
     */
    syncLive?(): void;
    /**
     * Optional (SPEC3 4.7): mark the card as the source of a preview drag
     * (is-drag-source) and the input of `field` (is-live; a label's x marks
     * its whole position); null clears both.
     */
    markLive?(field: string | null): void;
}

/** Card actions plus the Build panel hooks a layer card needs (v4 extras, all optional). */
export interface LayerCardActions extends CardActions {
    /** The card's error dot flipped: the Build tab dot re-checks hasErrors(). */
    onErrorChange?(): void;
    /**
     * Reveal an item this card just added (Mark corners, Find optimum, Add
     * feasible region, Add function): expand its card, scroll it into view
     * and focus `field`, or its first input when no field is given. With
     * `selectText` that part of the field's text is selected, so typing
     * replaces it (the sample objective of Find optimum).
     */
    revealAdded?(item: object, field?: string, selectText?: string): void;
}

export function createLayerCard(parent: HTMLElement, item: LayerItem, host: PanelHost, actions: LayerCardActions): LayerCardHandle {
    if (item.kind === 'label') return new LabelCard(parent, item, host, actions);
    const tool = item.tool;
    switch (tool.type) {
        case 'region':
            return new RegionCard(parent, item, tool, host, actions);
        case 'curve':
            return new CurveCard(parent, item, tool, host, actions);
        case 'points':
            return new PointsCard(parent, item, tool, host, actions);
        case 'segment':
            return new SegmentCard(parent, item, tool, host, actions);
        case 'plane3D':
            return new PlaneCard(parent, item, tool, host, actions);
        default: {
            const make = EXTRA_CARDS.get(tool.type);
            if (!make) throw new Error(`No card for a ${tool.type} tool`);
            return make(parent, item, tool, host, actions);
        }
    }
}

/** Makes the card of a tool type defined outside this file. */
export type ToolCardFactory = (parent: HTMLElement, item: LayerItem, tool: Tool, host: PanelHost, actions: LayerCardActions) => LayerCardHandle;

/** Cards of the tools beyond functions (5.0): src/beyond/cards.ts registers them when it loads. */
const EXTRA_CARDS = new Map<string, ToolCardFactory>();

export function registerToolCard(type: Tool['type'], make: ToolCardFactory): void {
    EXTRA_CARDS.set(type, make);
}

// ------------------------------------------------------------- constants

/** Referenceable name: letter first, then letters, digits, underscores (same rule as migrate.ts). */
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Derived value names of a tool: P1_x, P1_val, P1_y2, ... (same rule as mathcontext.ts). */
const DERIVED_RE = /^(.+)_(x|y|z|val|n)(\d*)$/;

/** Example of an offset expression position in the label card hint (SPEC3 4.7). */
const OFFSET_EXAMPLE = 'P1_x + 0.4';

const OK: ValidateResult = { ok: true };

/** Labels the points card treats as "Coordinates" (the preset it writes comes first). */
const COORD_LABELS_2D = ['({x:2}, {y:2})', '({x}, {y})'];
const COORD_LABELS_3D = ['({x:2}, {y:2}, {z:2})', '({x}, {y}, {z})'];

/** The kind of each tool card, read with its name by screen readers. */
const TOOL_KIND: Record<Tool['type'], MessageKey> = {
    region: 'build.kind.region',
    curve: 'build.kind.curve',
    points: 'build.kind.points',
    segment: 'build.kind.segment',
    plane3D: 'build.kind.plane',
    data: 'beyond.kind.data',
    dataPlot: 'beyond.kind.dataPlot',
    distribution: 'beyond.kind.distribution',
    probability: 'beyond.kind.probability',
    riemann: 'beyond.kind.riemann',
    slopeField: 'beyond.kind.slopeField',
    solution: 'beyond.kind.solution',
    // 6.0 B
    axisSet: 'notes6.kind.axisSet',
    chord: 'notes6.kind.chord',
};

// --------------------------------------------------------------- helpers

export function percent(v: number): string {
    return `${Math.round(v * 100)} %`;
}

/** Whitespace-collapsed text for summaries and dropdown entries. */
export function squash(s: string, max = 0): string {
    const t = s.replace(/\s+/g, ' ').trim();
    return max > 0 && t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Non-empty `;`-separated entries of a point list or path. */
function listEntries(src: string): string[] {
    return src
        .split(';')
        .map((s) => squash(s))
        .filter((s) => s.length > 0);
}

function isFocused(el: HTMLElement): boolean {
    return el.ownerDocument.activeElement === el;
}


/** Small segmented option whose visible text is short ('S') but whose accessible name is full ('Small'). */
function shortOption<T extends string>(value: T, text: string, ariaLabel: string): SegmentOption<T> {
    return { value, ariaLabel, render: (el) => el.setText(text) };
}

/** Small / medium / large, for marker and text sizes. */
export function sizeOptions<T extends string>(small: T, normal: T, large: T): SegmentOption<T>[] {
    return [
        shortOption(small, t('build.size.smallShort'), t('build.size.small')),
        shortOption(normal, t('build.size.mediumShort'), t('build.size.medium')),
        shortOption(large, t('build.size.largeShort'), t('build.size.large')),
    ];
}

// ------------------------------------------------------------- base card

/** One registered, focusable control of a card. */
interface CardField {
    /** Element to scroll to (and to test for visibility). */
    el: HTMLElement;
    focus(selectText?: string): void;
    validate(): void;
    hasError(): boolean;
    /** Issue reported by the scene for this field (null clears). */
    setIssue?(issue: Issue | null): void;
}

/** Something bound to settings: re-read on refresh, released on destroy. */
interface Binding {
    sync(): void;
    dispose(): void;
}

interface ExprFieldOptions {
    /** Field id (SceneIssue.field): 'equation', 'condition:2', ... */
    id: string;
    /** Accessible name. */
    label: string;
    kind: ValidateKind | (() => ValidateKind);
    get(): string;
    set(value: string): void;
    placeholder?: string;
    /** Blank text is fine (optional field such as the objective). */
    optional?: boolean;
    /** Blank text only counts as an error once the user typed in the field (a new card starts quiet). */
    required?: boolean;
    onEnter?(value: string): void;
    /** Extra work after each edit (visibility of dependent rows). */
    onEdit?(value: string): void;
    cls?: string;
    /** Template locals the label gets (LABEL_LOCALS); none when omitted. */
    locals?: readonly string[];
    /** Optional (5.0): validation of its own, instead of the math context's for `kind`. */
    check?(src: string): ValidateResult;
}

interface SelectFieldOptions {
    id: string;
    label: string;
    options(): DropdownOption<string>[];
    get(): string;
    set(value: string): void;
    /** Problem with the current value (message) or null. */
    check(value: string): string | null;
    cls?: string;
}

interface BoundExpr {
    h: ExprInputHandle;
    dispose(): void;
}

interface BoundSelect {
    el: HTMLElement;
    dd: DropdownHandle<string>;
    /** Reload options and re-check the value (after another field changed what is valid). */
    update(): void;
}

interface ShellSetup {
    kind: string;
    name: string;
    color: string;
    visible: boolean;
    renamable: boolean;
    cls: string;
}

/**
 * Shared frame: kit card shell (swatch, name badge, summary, eye, more
 * menu), field registration with the host, refresh bindings, error dot,
 * scene issue notes and reveal.
 */
abstract class BaseCard implements LayerCardHandle {
    readonly el: HTMLElement;
    readonly item: LayerItem;
    protected readonly host: PanelHost;
    protected readonly actions: LayerCardActions;
    protected readonly shell: CardShellHandle;
    protected readonly body: HTMLElement;
    private readonly fields = new Map<string, CardField>();
    private readonly registrations = new Map<string, () => void>();
    private readonly bindings = new Set<Binding>();
    /** Expression inputs by field id, for the live sync and marks of a preview drag. */
    private readonly exprs = new Map<string, { h: ExprInputHandle; get: () => string }>();
    /** Field marked by markLive (re-applied when condition rows are rebuilt). */
    private liveField: string | null = null;
    private readonly noteEl: HTMLElement;
    private notes: Array<{ text: string; error: boolean }> = [];
    private errorShown = false;
    private destroyed = false;

    protected constructor(parent: HTMLElement, item: LayerItem, host: PanelHost, actions: LayerCardActions, setup: ShellSetup) {
        this.item = item;
        this.host = host;
        this.actions = actions;
        this.shell = cardShell(parent, host, {
            name: setup.name,
            kind: setup.kind,
            summary: '',
            color: setup.color,
            onColorChange: (c) => {
                this.setColor(c);
                this.changed();
            },
            validateName: setup.renamable ? (n) => this.nameProblem(n) : undefined,
            onRename: setup.renamable ? (to) => this.rename(to) : undefined,
            visible: setup.visible,
            onVisibleChange: (v) => {
                this.setHidden(!v);
                this.changed();
            },
            menu: (menu) => this.fillMenu(menu),
            onMoveUp: () => this.actions.moveUp(),
            onMoveDown: () => this.actions.moveDown(),
            cls: setup.cls,
        });
        this.el = this.shell.el;
        this.body = this.shell.bodyEl;
        this.noteEl = this.body.createDiv({ cls: ['etz-layer-notes', 'tikz-hidden'], attr: { role: 'status' } });
    }

    // -------------------------------------------------- per-kind hooks

    /** Issue source: tool name or 'label:<index>'. */
    protected abstract source(): string;
    protected abstract summary(): string;
    protected abstract setColor(color: string): void;
    protected abstract setHidden(hidden: boolean): void;
    /** Position in its settings array (for Move up / Move down). */
    protected abstract position(): { index: number; count: number };
    /** Shell values (name, colour, eye) from settings. */
    protected abstract syncShell(): void;
    /** Show / hide dependent rows from the current values. Called after every change and on refresh. */
    protected syncState(): void {
        // Most cards have no dependent rows.
    }
    protected nameProblem(_name: string): string | null {
        return null;
    }
    protected rename(_to: string): void {
        // Labels have no name.
    }

    /** Build the body, then sync everything once. Subclasses call this at the end of their constructor. */
    protected finish(): void {
        // Notes stay the last element of the body.
        this.body.appendChild(this.noteEl);
        this.syncState();
        this.shell.setSummary(this.summary());
        this.syncError();
    }

    // ------------------------------------------------- change helpers

    /** Typing or a discrete option: full render after the host's debounce. */
    protected changed(): void {
        if (this.destroyed) return;
        this.syncState();
        this.shell.setSummary(this.summary());
        // A source switch can hide (or show) a field that has an error.
        this.syncError();
        this.host.requestUpdate();
    }

    /** Live slider drag: draft frame now, full render after the drag. */
    protected frame(): void {
        if (this.destroyed) return;
        this.host.requestFrame();
    }

    /** Added / removed items or names: the host rebuilds the math context and dependent UI. */
    protected structural(): void {
        if (this.destroyed) return;
        this.host.commit();
        if (!this.destroyed) this.refresh();
    }

    /**
     * Commit an item this card just added, then hand focus to its card (as
     * the + Add menu does), so a keyboard user lands in the new card instead
     * of on a button that may hide itself. Not part of structural(): renames
     * and other commits keep focus where it is.
     */
    protected structuralAdd(added: object, field?: string, selectText?: string): void {
        this.structural();
        if (!this.destroyed && this.actions.revealAdded) this.actions.revealAdded(added, field, selectText);
    }

    protected settingsList<T>(key: string): T[] {
        const v = this.host.settings.getValue<T[] | undefined>(key);
        return Array.isArray(v) ? v : [];
    }

    protected recipeContext(): RecipeContext {
        return {
            is3D: this.host.is3D(),
            functions: this.settingsList<FunctionParameters>('functions'),
            tools: this.settingsList<Tool>('tools'),
            parameters: this.settingsList<Parameter>('parameters'),
            polar: this.host.isPolar(),
        };
    }

    /** Options for defaultTool that keep new names clear of parameters too. */
    protected toolOptions(): { is3D: boolean; tools: Tool[]; functions: FunctionParameters[]; parameters: Parameter[] } {
        return {
            is3D: this.host.is3D(),
            tools: this.settingsList<Tool>('tools'),
            functions: this.settingsList<FunctionParameters>('functions'),
            parameters: this.settingsList<Parameter>('parameters'),
        };
    }

    /** Make sure settings 'tools' is a live array (a fresh chart may not have one yet). */
    protected toolsArray(): Tool[] {
        const tools = this.host.settings.getValue<Tool[] | undefined>('tools');
        if (Array.isArray(tools)) return tools;
        const created: Tool[] = [];
        this.host.settings.setValue('tools', created);
        return created;
    }

    // --------------------------------------------------- registration

    protected register(id: string, f: CardField): void {
        this.unregister(id);
        this.fields.set(id, f);
        const currentSource = () => this.source();
        this.registrations.set(
            id,
            this.host.registerField({
                // A getter, so a rename never leaves a stale source behind.
                get source() {
                    return currentSource();
                },
                field: id,
                validate: () => f.validate(),
                focus: (selectText?: string) => this.reveal(id, selectText),
            })
        );
    }

    protected unregister(id: string): void {
        const off = this.registrations.get(id);
        if (off) off();
        this.registrations.delete(id);
        this.fields.delete(id);
    }

    protected bind(binding: Binding): Binding {
        this.bindings.add(binding);
        return binding;
    }

    /** A refresh-only binding for plain controls (chips, segmented, sliders). */
    protected onSync(sync: () => void): void {
        this.bind({ sync, dispose: () => undefined });
    }

    // ------------------------------------------------------- controls

    /** Expression / template input with live validation, quick fixes and host registration. */
    protected exprField(parent: HTMLElement, o: ExprFieldOptions): BoundExpr {
        let touched = false;
        const kindOf = () => (typeof o.kind === 'function' ? o.kind() : o.kind);
        const h = exprInput(parent, {
            value: o.get(),
            label: o.label,
            placeholder: o.placeholder,
            cls: o.cls,
            validate: (src) => {
                if (!src.trim() && (o.optional || (o.required && !touched))) return OK;
                if (o.check) return o.check(src);
                return this.host.math().validate(src, kindOf(), undefined, o.locals);
            },
            onInput: (v) => {
                // Set before the kit validates this keystroke.
                touched = true;
                o.set(v);
                if (o.onEdit) o.onEdit(v);
                this.changed();
            },
            onEnter: o.onEnter ? (v: string) => o.onEnter?.(v) : undefined,
            onAddParameter: (name) => {
                this.host.addParameter(name);
            },
            onErrorChange: () => this.syncError(),
        });
        this.register(o.id, {
            el: h.el,
            focus: (sel) => h.focus(sel),
            validate: () => h.validate(),
            hasError: () => h.hasError(),
            setIssue: (issue) => h.setIssue(issue),
        });
        const live = { h, get: () => o.get() };
        this.exprs.set(o.id, live);
        if (this.liveField !== null && this.liveIds(this.liveField).includes(o.id)) h.el.addClass('is-live');
        const binding = this.bind({
            sync: () => {
                const v = o.get();
                if (h.getValue() !== v) h.setValue(v);
                // Never flash a message into the field the user is typing in.
                else if (!isFocused(h.input)) h.validate();
            },
            dispose: () => {
                h.destroy();
                this.unregister(o.id);
                if (this.exprs.get(o.id) === live) this.exprs.delete(o.id);
            },
        });
        return {
            h,
            dispose: () => {
                binding.dispose();
                this.bindings.delete(binding);
            },
        };
    }

    /** Native select plus an inline message line (missing or wrong references). */
    protected selectField(parent: HTMLElement, o: SelectFieldOptions): BoundSelect {
        const wrap = parent.createDiv({ cls: ['etz-layer-select'].concat(o.cls ? [o.cls] : []) });
        let optionsKey = '';
        const currentOptions = () => {
            const opts = o.options();
            optionsKey = JSON.stringify([opts, o.get()]);
            return opts;
        };
        const dd = dropdown<string>(wrap, {
            label: o.label,
            options: currentOptions(),
            value: o.get(),
            onChange: (v) => {
                o.set(v);
                show();
                this.changed();
            },
        });
        const msg = wrap.createDiv({ cls: ['etz-expr-msg', 'tikz-hidden'], attr: { 'aria-live': 'polite' } });
        const msgText = msg.createSpan({ cls: 'etz-expr-msg-text' });
        msgText.id = uniqueId('msg');
        let external: Issue | null = null;
        let shown: string | null = null;

        const show = () => {
            const problem = o.check(o.get()) ?? (external ? external.message : null);
            const had = shown !== null;
            shown = problem;
            msg.toggleClass('tikz-hidden', problem === null);
            msgText.setText(problem ?? '');
            dd.el.toggleClass('is-error', problem !== null);
            dd.el.setAttr('aria-invalid', problem !== null ? 'true' : null);
            dd.el.setAttr('aria-describedby', problem !== null ? msgText.id : null);
            if (had !== (problem !== null)) this.syncError();
        };
        const reload = () => {
            const opts = o.options();
            const key = JSON.stringify([opts, o.get()]);
            if (key === optionsKey) return;
            optionsKey = key;
            dd.setOptions(opts, o.get());
        };
        // Names can change while this card is open (a function added in its
        // own card): reload just before the list opens.
        dd.el.addEventListener('pointerdown', reload);
        dd.el.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') reload();
        });

        const update = () => {
            reload();
            show();
        };
        this.register(o.id, {
            el: wrap,
            focus: () => dd.el.focus(),
            validate: update,
            hasError: () => shown !== null,
            setIssue: (issue) => {
                external = issue;
                show();
            },
        });
        this.bind({ sync: update, dispose: () => this.unregister(o.id) });
        show();
        return { el: wrap, dd, update };
    }

    /** Inline "Needs a region. [Add feasible region]" block. */
    protected missingState(parent: HTMLElement, text: string, action: string, onAction: () => void): { el: HTMLElement; setText(text: string): void } {
        const el = parent.createDiv({ cls: 'etz-layer-missing' });
        const textEl = el.createSpan({ cls: 'etz-layer-missing-text', text });
        textButton(el, { text: action, variant: 'link', size: 'sm', onClick: () => onAction() });
        return { el, setText: (t) => textEl.setText(t) };
    }

    // ------------------------------------------------------------ menu

    private fillMenu(menu: Menu): void {
        const { index, count } = this.position();
        menu.addItem((i) => i.setTitle(t('common.duplicate')).setIcon('copy').onClick(() => this.actions.duplicate()));
        menu.addItem((i) =>
            i
                .setTitle(t('common.moveUp'))
                .setIcon('arrow-up')
                .setDisabled(index <= 0)
                .onClick(() => this.actions.moveUp())
        );
        menu.addItem((i) =>
            i
                .setTitle(t('common.moveDown'))
                .setIcon('arrow-down')
                .setDisabled(index < 0 || index >= count - 1)
                .onClick(() => this.actions.moveDown())
        );
        menu.addSeparator();
        menu.addItem((i) =>
            i
                .setTitle(t('common.delete'))
                .setIcon('trash-2')
                .setWarning(true)
                .onClick(() => this.actions.remove())
        );
    }

    // ---------------------------------------------------------- state

    /**
     * True when `el` belongs to the card's current form: inside the body and
     * not in a section the current values hide (the List input while the
     * source is Intersections). A collapsed card still counts its fields.
     */
    protected inUse(el: HTMLElement): boolean {
        let n: HTMLElement | null = el;
        while (n && n !== this.body) {
            if (n.hasClass('tikz-hidden')) return false;
            n = n.parentElement;
        }
        return n === this.body;
    }

    protected syncError(): void {
        if (this.destroyed) return;
        const has = this.hasError();
        if (has === this.errorShown) return;
        this.errorShown = has;
        this.shell.setError(has);
        // A message that clears after the last render (the kit's idle timer) must clear the tab dot too.
        if (this.actions.onErrorChange) this.actions.onErrorChange();
    }

    private renderNotes(): void {
        this.noteEl.empty();
        this.noteEl.toggleClass('tikz-hidden', this.notes.length === 0);
        for (const n of this.notes) {
            this.noteEl.createDiv({ cls: ['etz-layer-note'].concat(n.error ? ['mod-error'] : []), text: n.text });
        }
    }

    // ------------------------------------------------------ interface

    refresh(): void {
        if (this.destroyed) return;
        this.syncShell();
        for (const b of Array.from(this.bindings)) b.sync();
        this.syncState();
        this.shell.setSummary(this.summary());
        this.syncError();
    }

    setCollapsed(collapsed: boolean): void {
        this.shell.setCollapsed(collapsed);
    }

    isCollapsed(): boolean {
        return this.shell.isCollapsed();
    }

    reveal(fieldId?: string, selectText?: string): void {
        if (this.destroyed) return;
        this.shell.setCollapsed(false);
        let target: CardField | undefined;
        if (fieldId) {
            const f = this.fields.get(fieldId);
            if (f && this.inUse(f.el)) target = f;
        } else {
            // No field: the first visible input (a freshly added card).
            target = Array.from(this.fields.values()).find((f) => this.inUse(f.el));
        }
        if (target) {
            target.el.scrollIntoView({ block: 'nearest' });
            target.focus(selectText);
        } else {
            this.el.scrollIntoView({ block: 'nearest' });
            this.shell.focusHeader();
        }
    }

    hasError(): boolean {
        if (this.notes.some((n) => n.error)) return true;
        for (const f of this.fields.values()) {
            if (this.inUse(f.el) && f.hasError()) return true;
        }
        return false;
    }

    setIssues(issues: SceneIssue[]): void {
        if (this.destroyed) return;
        const src = this.source();
        const byField = new Map<string, Issue>();
        const notes: Array<{ text: string; error: boolean }> = [];
        for (const issue of issues) {
            if (issue.source !== src) continue;
            // Messages often repeat the source ('P1: R1 is empty', in Japanese with a full-width colon); the card already names it.
            const lead = [`${src}: `, `${src}：`].find((p) => issue.message.startsWith(p));
            const text = lead ? issue.message.slice(lead.length) : issue.message;
            const f = issue.field ? this.fields.get(issue.field) : undefined;
            if (issue.severity === 'error' && issue.field && f && f.setIssue && this.inUse(f.el)) {
                if (!byField.has(issue.field)) byField.set(issue.field, { message: text });
            } else if (!notes.some((n) => n.text === text)) {
                notes.push({ text, error: issue.severity === 'error' });
            }
        }
        for (const [id, f] of this.fields) {
            if (f.setIssue) f.setIssue(byField.get(id) ?? null);
        }
        this.notes = notes;
        this.renderNotes();
        this.syncError();
    }

    syncLive(): void {
        if (this.destroyed) return;
        for (const { h, get } of this.exprs.values()) {
            const v = get();
            if (h.input.value !== v) h.input.value = v;
        }
        this.shell.setSummary(this.summary());
    }

    markLive(fieldId: string | null): void {
        if (this.destroyed) return;
        this.liveField = fieldId;
        this.el.toggleClass('is-drag-source', fieldId !== null);
        const ids = fieldId === null ? [] : this.liveIds(fieldId);
        for (const [id, { h }] of this.exprs) h.el.toggleClass('is-live', ids.includes(id));
    }

    /** Inputs a drag of `fieldId` writes (one field, except where a drag edits several). */
    protected liveIds(fieldId: string): string[] {
        return [fieldId];
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const b of Array.from(this.bindings)) b.dispose();
        this.bindings.clear();
        for (const off of this.registrations.values()) off();
        this.registrations.clear();
        this.fields.clear();
        this.shell.destroy();
    }
}

// ------------------------------------------------------------- tool card

export abstract class ToolCard<T extends Tool> extends BaseCard {
    protected readonly tool: T;

    protected constructor(parent: HTMLElement, item: LayerItem, tool: T, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, host, actions, {
            kind: t(TOOL_KIND[tool.type]),
            name: tool.name,
            color: tool.color,
            visible: !tool.hidden,
            renamable: true,
            cls: `etz-layer-card mod-${tool.type === 'plane3D' ? 'plane' : tool.type}`,
        });
        this.tool = tool;
    }

    protected source(): string {
        return this.tool.name;
    }

    protected setColor(color: string): void {
        this.tool.color = color;
    }

    protected setHidden(hidden: boolean): void {
        if (hidden) this.tool.hidden = true;
        else delete this.tool.hidden;
    }

    protected position(): { index: number; count: number } {
        const tools = this.settingsList<Tool>('tools');
        return { index: tools.indexOf(this.tool), count: tools.length };
    }

    protected syncShell(): void {
        this.shell.setName(this.tool.name);
        this.shell.setColor(this.tool.color);
        this.shell.setVisible(!this.tool.hidden);
    }

    /** Every other name in the chart (functions, surfaces, parameters, other tools). */
    private otherNames(): { all: Set<string>; tools: Set<string> } {
        const all = new Set<string>();
        const tools = new Set<string>();
        for (const f of this.settingsList<FunctionParameters>('functions')) if (f && f.name) all.add(f.name);
        for (const f of this.settingsList<Function3DParameters>('functions3D')) if (f && f.name) all.add(f.name);
        for (const p of this.settingsList<Parameter>('parameters')) if (p && p.name) all.add(p.name);
        for (const t of this.settingsList<Tool>('tools')) {
            if (!t || t === this.tool || !t.name) continue;
            all.add(t.name);
            tools.add(t.name);
        }
        return { all, tools };
    }

    protected nameProblem(name: string): string | null {
        if (!name) return t('common.enterName');
        if (!NAME_RE.test(name)) return t('build.name.startWithLetterUse');
        const [first, second] = this.host.math().axisAliases;
        if (RESERVED_NAMES.has(name) || first.includes(name) || second.includes(name)) return t('build.name.reserved', { name });
        const { all, tools } = this.otherNames();
        if (all.has(name)) return t('build.name.taken', { name });
        // Derived values (P1_x, P1_val, ...) must stay unambiguous in both directions.
        const own = DERIVED_RE.exec(name);
        if (own && tools.has(own[1])) return t('build.name.valueOf', { name, tool: own[1] });
        for (const other of all) {
            const m = DERIVED_RE.exec(other);
            if (m && m[1] === name) return t('build.name.clash', { name, other });
        }
        return null;
    }

    protected rename(to: string): void {
        const from = this.tool.name;
        if (to === from) return;
        // The tool carries its new name before the host rebuilds the math
        // context, so derived names (R1_x -> Feasible_x) resolve at once.
        this.tool.name = to;
        this.host.rename('tool', from, to);
        this.refresh();
    }

    /** Insert a new tool next to this one and commit. */
    protected insertTool(tool: Tool, where: 'before' | 'after'): void {
        const tools = this.toolsArray();
        const at = tools.indexOf(this.tool);
        if (at < 0) tools.push(tool);
        else tools.splice(where === 'before' ? at : at + 1, 0, tool);
    }

    /** Shared "Label" template row. */
    protected labelField(placeholder: string, locals?: readonly string[]): BoundExpr {
        const f = field(this.body, { label: t('common.label'), layout: 'inline' });
        const bound = this.exprField(f.controlEl, {
            id: 'label',
            label: t('common.label'),
            kind: 'template',
            locals,
            placeholder,
            get: () => (this.tool as { label?: string }).label ?? '',
            set: (v) => {
                (this.tool as { label?: string }).label = v;
            },
        });
        f.bind(bound.h.input);
        return bound;
    }

    /** Thickness samples plus chips in one row. */
    protected lineRow(o: { thickness: () => string; setThickness: (v: string) => void; chips: Array<{ label: string; get: () => boolean; set: (v: boolean) => void }> }): {
        el: HTMLElement;
        thickness: SegmentedHandle<string>;
        chips: ChipHandle[];
    } {
        const f = field(this.body, { label: t('build.card.line'), layout: 'inline' });
        const thickness = thicknessPicker(f.controlEl, {
            value: o.thickness(),
            onChange: (v) => {
                o.setThickness(v);
                this.changed();
            },
        });
        f.bind(thickness.el);
        const chips = o.chips.map((c) =>
            chip(f.controlEl, {
                label: c.label,
                value: c.get(),
                onChange: (v) => {
                    c.set(v);
                    this.changed();
                },
            })
        );
        this.onSync(() => {
            thickness.setValue(o.thickness());
            chips.forEach((h, i) => h.setValue(o.chips[i].get()));
        });
        return { el: f.el, thickness, chips };
    }
}

// ----------------------------------------------------------- region card

interface ConditionRow {
    el: HTMLElement;
    cond: BoundExpr;
    label: BoundExpr;
}

class RegionCard extends ToolCard<RegionTool> {
    private condList!: HTMLElement;
    private rows: ConditionRow[] = [];
    private numberBtn!: HTMLElement;
    private fillOpts!: HTMLElement;
    private opacity!: LiveSliderHandle;
    private outlineThickness!: SegmentedHandle<string>;

    constructor(parent: HTMLElement, item: LayerItem, tool: RegionTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.normalizeLabels();
        this.build();
        this.finish();
    }

    /** conditionLabels always has one entry per condition (hand-edited blocks may not). */
    private normalizeLabels(): void {
        const tool = this.tool;
        if (!Array.isArray(tool.conditions)) tool.conditions = [];
        if (!Array.isArray(tool.conditionLabels)) tool.conditionLabels = [];
        while (tool.conditionLabels.length < tool.conditions.length) tool.conditionLabels.push('');
        if (tool.conditionLabels.length > tool.conditions.length) tool.conditionLabels.length = tool.conditions.length;
    }

    private build(): void {
        const tool = this.tool;
        const body = this.body;

        // Conditions: one row each, ANDed.
        const condField = field(body, { label: t('build.region.conditions'), cls: 'etz-layer-conditions' });
        this.condList = condField.controlEl.createDiv({ cls: 'etz-layer-cond-list' });
        this.renderConditions();
        const condActions = condField.controlEl.createDiv({ cls: 'etz-layer-cond-actions' });
        textButton(condActions, { text: t('build.add.condition'), icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => this.addCondition() });
        this.numberBtn = textButton(condActions, {
            text: t('build.region.number'),
            variant: 'link',
            size: 'sm',
            onClick: () => this.numberConditions(),
        }).el;

        // Fill and constraint-line switches, then the fill's pattern and live opacity.
        const chipRow = body.createDiv({ cls: 'etz-layer-row' });
        const fill = chip(chipRow, {
            label: t('build.card.fill'),
            value: tool.fill,
            onChange: (v) => {
                tool.fill = v;
                this.changed();
            },
        });
        const lines = chip(chipRow, {
            label: t('build.region.constraintLines'),
            value: tool.constraintLines,
            onChange: (v) => {
                tool.constraintLines = v;
                this.changed();
            },
        });
        const shading = field(body, { label: t('build.region.shading'), layout: 'inline' });
        this.fillOpts = shading.el;
        const pattern = dropdown<FillPattern>(shading.controlEl, {
            label: t('build.card.fillPattern'),
            options: FILL_PATTERN_OPTIONS,
            value: tool.fillPattern,
            onChange: (v) => {
                tool.fillPattern = v;
                this.changed();
            },
        });
        this.opacity = liveSlider(shading.controlEl, {
            min: 0,
            max: 1,
            step: 0.05,
            value: tool.fillOpacity,
            label: t('build.card.fillOpacity'),
            format: percent,
            onInput: (v) => {
                tool.fillOpacity = v;
                this.frame();
            },
        });

        // Outline: none / solid / dashed + thickness.
        const outField = field(body, { label: t('build.region.outline'), layout: 'inline' });
        const outline = segmented<OutlineStyle>(outField.controlEl, {
            label: t('build.region.outline'),
            value: tool.outline,
            options: [
                { value: 'none', text: t('common.none') },
                { value: 'solid', text: t('common.solid') },
                { value: 'dashed', text: t('common.dashed') },
            ],
            onChange: (v) => {
                tool.outline = v;
                this.changed();
            },
        });
        outField.bind(outline.el);
        this.outlineThickness = thicknessPicker(outField.controlEl, {
            value: tool.thickness,
            label: t('build.region.outlineThickness'),
            onChange: (v) => {
                tool.thickness = v;
                this.changed();
            },
        });

        this.labelField(t('build.region.labelPlaceholder'));

        // Shortcuts that create linked points tools.
        const actionsRow = body.createDiv({ cls: 'etz-layer-actions' });
        textButton(actionsRow, { text: t('build.region.markCorners'), icon: 'crosshair', size: 'sm', onClick: () => this.markCorners() });
        textButton(actionsRow, { text: t('build.region.findOptimum'), icon: 'target', size: 'sm', onClick: () => this.findOptimum() });

        this.onSync(() => {
            this.normalizeLabels();
            if (this.rows.length !== tool.conditions.length) this.renderConditions();
            fill.setValue(tool.fill);
            pattern.setValue(tool.fillPattern);
            this.opacity.setValue(tool.fillOpacity);
            outline.setValue(tool.outline);
            this.outlineThickness.setValue(tool.thickness);
            lines.setValue(tool.constraintLines);
        });
    }

    private renderConditions(focusIndex?: number): void {
        for (const r of this.rows) {
            r.cond.dispose();
            r.label.dispose();
        }
        this.rows = [];
        this.condList.empty();
        this.tool.conditions.forEach((_, i) => this.rows.push(this.conditionRow(i)));
        if (focusIndex !== undefined && this.rows.length) {
            const row = this.rows[Math.max(0, Math.min(focusIndex, this.rows.length - 1))];
            row.cond.h.focus();
            row.el.scrollIntoView({ block: 'nearest' });
        }
    }

    private conditionRow(i: number): ConditionRow {
        const tool = this.tool;
        const el = this.condList.createDiv({ cls: 'etz-layer-cond-row' });
        const cond = this.exprField(el, {
            id: `condition:${i}`,
            label: t('build.region.condition', { n: i + 1 }),
            kind: 'condition',
            placeholder: t(i === 0 ? 'build.region.conditionPlaceholder' : 'build.region.conditionPlaceholderNext'),
            get: () => tool.conditions[i] ?? '',
            set: (v) => {
                tool.conditions[i] = v;
            },
            onEnter: (v) => {
                // Enter on the last filled row starts the next one.
                if (i === tool.conditions.length - 1) {
                    if (v.trim()) this.addCondition();
                } else {
                    this.rows[i + 1].cond.h.focus();
                }
            },
        });
        const label = this.exprField(el, {
            id: `conditionLabel:${i}`,
            label: t('build.region.conditionLabel', { n: i + 1 }),
            kind: 'template',
            placeholder: t('common.label'),
            cls: 'etz-layer-cond-label',
            get: () => tool.conditionLabels[i] ?? '',
            set: (v) => {
                tool.conditionLabels[i] = v;
            },
        });
        iconButton(el, {
            icon: 'x',
            label: t('build.region.removeCondition', { n: i + 1 }),
            cls: 'etz-layer-cond-remove',
            onClick: () => this.removeCondition(i),
        });
        return { el, cond, label };
    }

    private addCondition(): void {
        this.tool.conditions.push('');
        this.tool.conditionLabels.push('');
        this.renderConditions(this.tool.conditions.length - 1);
        this.changed();
    }

    private removeCondition(i: number): void {
        const tool = this.tool;
        if (tool.conditions.length <= 1) {
            // The last row is cleared rather than removed, so there is always somewhere to type.
            tool.conditions[0] = '';
            tool.conditionLabels[0] = '';
            this.refresh();
            this.rows[0]?.cond.h.focus();
        } else {
            tool.conditions.splice(i, 1);
            tool.conditionLabels.splice(i, 1);
            this.renderConditions(Math.min(i, tool.conditions.length - 1));
        }
        this.changed();
    }

    private numberConditions(): void {
        const tool = this.tool;
        let k = 0;
        tool.conditions.forEach((c, i) => {
            tool.conditionLabels[i] = c.trim() ? `(${++k})` : '';
        });
        this.refresh();
        this.changed();
    }

    private markCorners(): void {
        const p = defaultTool('points', this.toolOptions()) as PointsTool;
        p.source = 'region';
        p.regionName = this.tool.name;
        p.label = '({x}, {y})';
        this.insertTool(p, 'after');
        this.structuralAdd(p);
    }

    private findOptimum(): void {
        const p = defaultTool('points', this.toolOptions()) as PointsTool;
        // Written in the chart's own axis variables (2x1 + 3x2 when they are x1, x2).
        const [first, second] = this.host.math().axisAliases;
        const v1 = first[first.length - 1] || 'x';
        const v2 = second[second.length - 1] || 'y';
        p.source = 'region';
        p.regionName = this.tool.name;
        p.objective = `2${v1} + 3${v2}`;
        p.sense = 'max';
        p.label = '({x:2}, {y:2})';
        p.size = 'large';
        this.insertTool(p, 'after');
        // The sample objective is what the user edits next: it is selected, so typing replaces it.
        this.structuralAdd(p, 'objective', p.objective);
    }

    protected syncState(): void {
        const tool = this.tool;
        if (!this.fillOpts) return;
        this.fillOpts.toggleClass('tikz-hidden', !tool.fill);
        this.outlineThickness.el.toggleClass('tikz-hidden', tool.outline === 'none');
        const filled = tool.conditions.filter((c) => c.trim()).length;
        this.numberBtn.toggleClass('tikz-hidden', filled < 2);
    }

    protected summary(): string {
        const tool = this.tool;
        const conds = tool.conditions.map((c) => squash(c)).filter((c) => c.length > 0);
        if (!conds.length) return t('build.region.empty');
        const lead: MessageKey = tool.fill
            ? 'build.region.shaded'
            : tool.outline !== 'none'
              ? 'build.region.outlined'
              : tool.constraintLines
                ? 'build.region.lines'
                : 'build.region.where';
        return t(lead, { conditions: conds.join(', ') });
    }
}

// ------------------------------------------------------------ curve card

class CurveCard extends ToolCard<CurveTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: CurveTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const eqField = field(this.body, { label: t('build.curve.equation'), layout: 'inline' });
        const eq = this.exprField(eqField.controlEl, {
            id: 'equation',
            label: t('build.curve.equation'),
            kind: 'equation',
            required: true,
            placeholder: t('build.curve.equationPlaceholder'),
            get: () => tool.equation,
            set: (v) => {
                tool.equation = v;
            },
        });
        eqField.bind(eq.h.input);

        const lvField = field(this.body, { label: t('build.curve.levels'), layout: 'inline' });
        const levels = this.exprField(lvField.controlEl, {
            id: 'levels',
            label: t('build.curve.levels'),
            kind: 'levels',
            placeholder: t('build.curve.levelsPlaceholder'),
            get: () => tool.levels,
            set: (v) => {
                tool.levels = v;
            },
        });
        lvField.bind(levels.h.input);

        this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [
                {
                    label: t('common.dashed'),
                    get: () => tool.dashed,
                    set: (v) => {
                        tool.dashed = v;
                    },
                },
            ],
        });
        this.labelField(t('build.curve.labelPlaceholder'), LABEL_LOCALS.curve);
    }

    protected summary(): string {
        const tool = this.tool;
        const eq = squash(tool.equation);
        if (!eq) return t('build.curve.empty');
        const levels = squash(tool.levels);
        if (levels) return t('build.curve.levelCurves', { equation: eq, levels });
        let affine = false;
        try {
            affine = this.host.math().equation(tool.equation).affine !== null;
        } catch {
            affine = false;
        }
        return t(affine ? 'build.curve.line' : 'build.curve.curve', { equation: eq.includes('=') ? eq : `${eq} = 0` });
    }
}

// ----------------------------------------------------------- points card

type LabelMode = 'none' | 'coords' | 'custom';

class PointsCard extends ToolCard<PointsTool> {
    private sourceSeg!: SegmentedHandle<PointsTool['source']>;
    private listRow!: HTMLElement;
    private refsRow!: HTMLElement;
    private regionRow!: HTMLElement;
    private refs: BoundSelect[] = [];
    private andEl!: HTMLElement;
    private region!: BoundSelect;
    private missingFns!: { el: HTMLElement; setText(text: string): void };
    private missingRegion!: HTMLElement;
    private senseSeg!: SegmentedHandle<'max' | 'min'>;
    private objectiveField!: FieldLayoutHandle;
    /** 3D charts draw list points only, so their cards offer no objective (unless one is set already). */
    private showObjective = true;
    private labelMode: LabelMode = 'none';
    private labelSeg!: SegmentedHandle<LabelMode>;
    private labelInput!: BoundExpr;
    private dropLinesChip: ChipHandle | null = null;

    constructor(parent: HTMLElement, item: LayerItem, tool: PointsTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.labelMode = this.modeOf(tool.label);
        this.showObjective = !this.is3D() || !!tool.objective.trim();
        this.build();
        this.finish();
    }

    private is3D(): boolean {
        return this.tool.dim === 3;
    }

    private coordLabels(): string[] {
        return this.is3D() ? COORD_LABELS_3D : COORD_LABELS_2D;
    }

    private modeOf(label: string): LabelMode {
        if (!label.trim()) return 'none';
        return this.coordLabels().includes(label.trim()) ? 'coords' : 'custom';
    }

    // Candidates for intersections: named, non-parametric functions and curve tools.
    private crossables(): Array<{ name: string; text: string }> {
        const out: Array<{ name: string; text: string }> = [];
        for (const f of this.settingsList<FunctionParameters>('functions')) {
            if (!f || !f.name || f.parametric) continue;
            out.push({ name: f.name, text: f.expression.trim() ? `${f.name}: ${squash(f.expression, 28)}` : f.name });
        }
        for (const t of this.settingsList<Tool>('tools')) {
            if (!t || t.type !== 'curve' || !t.name) continue;
            out.push({ name: t.name, text: t.equation.trim() ? `${t.name}: ${squash(t.equation, 28)}` : t.name });
        }
        return out;
    }

    private regions(): RegionTool[] {
        return this.settingsList<Tool>('tools').filter((t): t is RegionTool => !!t && t.type === 'region');
    }

    private build(): void {
        const tool = this.tool;
        const body = this.body;

        // Source. 3D charts only draw list points, so the other sources are
        // offered there only while one is still selected.
        const sources: Array<SegmentOption<PointsTool['source']>> = [
            { value: 'list', text: t('build.points.list') },
            { value: 'intersections', text: t('build.points.intersections') },
            // 'Region': corners without an objective, the best point anywhere in it with one.
            { value: 'region', text: t('build.points.fromRegion') },
            { value: 'lattice', text: t('build.points.integers') },
        ];
        this.sourceSeg = segmented<PointsTool['source']>(body, {
            label: t('build.points.source'),
            value: tool.source,
            fill: true,
            cls: 'etz-layer-source',
            options: this.is3D() ? sources.filter((s) => s.value === 'list' || s.value === tool.source) : sources,
            onChange: (v) => {
                tool.source = v;
                this.prefillReferences();
                this.changed();
                this.refreshSelects();
            },
        });

        // List source.
        const listField = field(body, { label: t('build.points.points'), layout: 'inline' });
        this.listRow = listField.el;
        const list = this.exprField(listField.controlEl, {
            id: 'points',
            label: t('build.points.points'),
            kind: () => (this.is3D() ? 'tuples3' : 'tuples2'),
            placeholder: this.is3D() ? '(1, 2, 3); (0, 0, 1)' : '(1, 2); (3, 4)',
            get: () => tool.points,
            set: (v) => {
                tool.points = v;
            },
        });
        listField.bind(list.h.input);

        // Intersections source: two references.
        const refsField = field(body, { label: t('build.points.of'), layout: 'inline', cls: 'etz-layer-refs' });
        this.refsRow = refsField.el;
        const refCheck = (which: 'ref1' | 'ref2') => (v: string) => {
            // Blank shows the 'Choose...' entry; the missing-dependency line covers too few candidates.
            if (!v || this.crossables().length < 2) return null;
            const problem = this.refProblem(v);
            if (problem) return problem;
            if (which === 'ref2' && v === tool.ref1) return t('build.points.different');
            return null;
        };
        const refOptions = (which: 'ref1' | 'ref2') => () => {
            const opts: DropdownOption<string>[] = this.crossables().map((c) => ({ value: c.name, text: c.text }));
            if (!tool[which]) opts.unshift({ value: '', text: t('build.points.choose') });
            return opts;
        };
        const refsWrap = refsField.controlEl.createDiv({ cls: 'etz-layer-row etz-layer-grow' });
        this.refs = (['ref1', 'ref2'] as const).map((which, i) => {
            if (i === 1) this.andEl = refsWrap.createSpan({ cls: 'etz-layer-and', text: t('build.points.and') });
            return this.selectField(refsWrap, {
                id: which,
                label: t(i === 0 ? 'build.points.first' : 'build.points.second'),
                options: refOptions(which),
                get: () => tool[which],
                set: (v) => {
                    tool[which] = v;
                    // ref2 is checked against ref1.
                    if (which === 'ref1') this.refs[1].update();
                },
                check: refCheck(which),
            });
        });
        this.missingFns = this.missingState(refsField.controlEl, '', t('build.add.function'), () => this.addFunction());

        // Region / integers source: a region.
        const regionField = field(body, { label: t('build.points.region'), layout: 'inline' });
        this.regionRow = regionField.el;
        this.region = this.selectField(regionField.controlEl, {
            id: 'regionName',
            label: t('build.points.region'),
            options: () => {
                const opts: DropdownOption<string>[] = this.regions().map((r) => ({
                    value: r.name,
                    text: r.conditions.some((c) => c.trim()) ? `${r.name}: ${squash(r.conditions.filter((c) => c.trim()).join(', '), 28)}` : r.name,
                }));
                if (tool.source === 'lattice') opts.unshift({ value: '', text: t('build.points.wholeView') });
                else if (!tool.regionName) opts.unshift({ value: '', text: t('build.points.choose') });
                return opts;
            },
            get: () => tool.regionName,
            set: (v) => {
                tool.regionName = v;
            },
            check: (v) => {
                if (tool.source !== 'region' && tool.source !== 'lattice') return null;
                if (!v) return null;
                const found = this.settingsList<Tool>('tools').find((x) => x && x.name === v);
                if (!found) return t('build.points.missing', { name: v });
                if (found.type !== 'region') return t('build.points.notRegion', { name: v });
                return null;
            },
        });
        this.missingRegion = this.missingState(regionField.controlEl, t('build.points.needsRegion'), t('build.add.feasibleRegion'), () => this.addRegion()).el;

        // Objective: keep only the best candidate(s).
        const objField = field(body, { label: t('build.points.objective'), layout: 'inline', cls: 'etz-layer-objective' });
        this.objectiveField = objField;
        const objective = this.exprField(objField.controlEl, {
            id: 'objective',
            label: t('build.points.objective'),
            kind: 'fn2',
            optional: true,
            placeholder: t('build.points.objectivePlaceholder'),
            get: () => tool.objective,
            set: (v) => {
                tool.objective = v;
            },
        });
        objField.bind(objective.h.input);
        this.senseSeg = segmented<'max' | 'min'>(objField.controlEl, {
            label: t('build.points.sense'),
            value: tool.sense,
            options: [
                { value: 'max', text: t('common.max') },
                { value: 'min', text: t('common.min') },
            ],
            onChange: (v) => {
                tool.sense = v;
                this.changed();
            },
        });

        // Labels: none / coordinates / custom template.
        const labelField = field(body, { label: t('common.label'), layout: 'inline' });
        this.labelSeg = segmented<LabelMode>(labelField.controlEl, {
            label: t('common.label'),
            value: this.labelMode,
            fill: true,
            options: [
                { value: 'none', text: t('common.none') },
                { value: 'coords', text: t('build.points.coordinates') },
                { value: 'custom', text: t('build.points.custom') },
            ],
            onChange: (v) => this.setLabelMode(v),
        });
        labelField.bind(this.labelSeg.el);
        this.labelInput = this.exprField(labelField.controlEl, {
            id: 'label',
            label: t('build.points.labelText'),
            kind: 'template',
            locals: tool.dim === 3 ? LABEL_LOCALS.points3 : LABEL_LOCALS.points2,
            placeholder: t('build.points.labelPlaceholder'),
            get: () => tool.label,
            set: (v) => {
                tool.label = v;
            },
        });
        // A 'label' issue reveals the template input when it is shown, else the mode switch.
        this.register('label', {
            el: labelField.el,
            focus: (sel) => (this.inUse(this.labelInput.h.el) ? this.labelInput.h.focus(sel) : this.labelSeg.focus()),
            validate: () => this.labelInput.h.validate(),
            hasError: () => this.inUse(this.labelInput.h.el) && this.labelInput.h.hasError(),
            setIssue: (issue) => this.labelInput.h.setIssue(issue),
        });

        // Marker size and drop lines.
        const sizeField = field(body, { label: t('build.card.size'), layout: 'inline' });
        const size = segmented<MarkerSize>(sizeField.controlEl, {
            label: t('build.points.markerSize'),
            value: tool.size,
            cls: 'etz-layer-size',
            options: sizeOptions<MarkerSize>('small', 'normal', 'large'),
            onChange: (v) => {
                tool.size = v;
                this.changed();
            },
        });
        sizeField.bind(size.el);
        if (!this.is3D()) {
            this.dropLinesChip = chip(sizeField.controlEl, {
                label: t('build.points.dropLines'),
                value: tool.dropLines,
                onChange: (v) => {
                    tool.dropLines = v;
                    this.changed();
                },
            });
        }

        this.onSync(() => {
            this.sourceSeg.setValue(tool.source);
            this.senseSeg.setValue(tool.sense);
            size.setValue(tool.size);
            if (this.dropLinesChip) this.dropLinesChip.setValue(tool.dropLines);
            // Custom mode survives a refresh even while its text is blank or still
            // the coordinates template it started from (the user is editing it).
            if (this.labelMode !== 'custom') this.labelMode = this.modeOf(tool.label);
            this.labelSeg.setValue(this.labelMode);
        });
    }

    private refProblem(name: string): string | null {
        if (this.crossables().some((c) => c.name === name)) return null;
        const fn = this.settingsList<FunctionParameters>('functions').find((f) => f && f.name === name);
        if (fn && fn.parametric) return t('build.points.parametric', { name });
        const tool = this.settingsList<Tool>('tools').find((x) => x && x.name === name);
        if (tool) return t('build.points.notCrossable', { name });
        return t('build.points.missing', { name });
    }

    /** A source switch picks the chart's first candidates (like the recipes), so the card works at once. */
    private prefillReferences(): void {
        const tool = this.tool;
        if (tool.source === 'intersections') {
            const names = this.crossables().map((c) => c.name);
            if (!tool.ref1) tool.ref1 = names.find((n) => n !== tool.ref2) ?? '';
            if (!tool.ref2) tool.ref2 = names.find((n) => n !== tool.ref1) ?? '';
        } else if ((tool.source === 'region' || tool.source === 'lattice') && !tool.regionName) {
            const first = this.regions()[0];
            if (first) tool.regionName = first.name;
        }
    }

    private refreshSelects(): void {
        for (const r of this.refs) r.update();
        this.region.update();
    }

    private setLabelMode(mode: LabelMode): void {
        const tool = this.tool;
        const prev = this.labelMode;
        this.labelMode = mode;
        if (mode === 'none') tool.label = '';
        else if (mode === 'coords') tool.label = this.coordLabels()[0];
        // Custom starts from the coordinates template (easy to edit) or blank.
        else if (prev === 'none') tool.label = '';
        this.labelInput.h.setValue(tool.label);
        this.changed();
        if (mode === 'custom') this.labelInput.h.focus();
    }

    private addRegion(): void {
        const recipe = recipes(false).find((r) => r.id === 'feasible-region');
        const ctx = this.recipeContext();
        const built = recipe && recipe.available(ctx) ? recipe.build(ctx) : null;
        const region = built && built.kind === 'tool' ? built.tool : defaultTool('region', this.toolOptions());
        this.insertTool(region, 'before');
        this.tool.regionName = region.name;
        // The button that ran this hides now: focus moves into the new region.
        this.structuralAdd(region);
    }

    private addFunction(): void {
        const recipe = recipes(false).find((r) => r.id === 'function');
        const ctx = this.recipeContext();
        const built = recipe && recipe.available(ctx) ? recipe.build(ctx) : null;
        if (!built || built.kind !== 'function') return;
        let functions = this.host.settings.getValue<FunctionParameters[] | undefined>('functions');
        if (!Array.isArray(functions)) {
            functions = [];
            this.host.settings.setValue('functions', functions);
        }
        functions.push(built.fn);
        // The new function fills the first empty slot of this card.
        const name = built.fn.name || '';
        if (!this.tool.ref1) this.tool.ref1 = name;
        else if (!this.tool.ref2 && this.tool.ref1 !== name) this.tool.ref2 = name;
        this.structuralAdd(built.fn);
    }

    protected syncState(): void {
        const tool = this.tool;
        if (!this.labelInput) return;
        this.sourceSeg.el.toggleClass('tikz-hidden', this.is3D() && tool.source === 'list');
        this.listRow.toggleClass('tikz-hidden', tool.source !== 'list');
        this.refsRow.toggleClass('tikz-hidden', tool.source !== 'intersections');
        this.regionRow.toggleClass('tikz-hidden', tool.source !== 'region' && tool.source !== 'lattice');

        const crossables = this.crossables().length;
        const fnsMissing = tool.source === 'intersections' && crossables < 2;
        this.missingFns.el.toggleClass('tikz-hidden', !fnsMissing);
        this.missingFns.setText(t(crossables === 0 ? 'build.points.needsTwo' : 'build.points.addSecond'));
        for (const r of this.refs) r.el.toggleClass('tikz-hidden', fnsMissing);
        this.andEl.toggleClass('tikz-hidden', fnsMissing);

        const regionMissing = tool.source === 'region' && this.regions().length === 0 && !tool.regionName;
        this.missingRegion.toggleClass('tikz-hidden', !regionMissing);
        this.region.el.toggleClass('tikz-hidden', regionMissing);

        this.objectiveField.el.toggleClass('tikz-hidden', !this.showObjective);
        this.senseSeg.setDisabled(!tool.objective.trim());
        // Source 'Region' marks the corners; with an objective it is the continuous
        // optimum, which may lie on an edge or inside. The hint says which one applies.
        const region = tool.regionName;
        this.objectiveField.setHint(
            tool.source !== 'region'
                ? ''
                : tool.objective.trim()
                  ? region
                      ? t('build.points.bestIn', { region })
                      : t('build.points.bestInRegion')
                  : region
                    ? t('build.points.everyCorner', { region })
                    : t('build.points.everyCornerRegion')
        );
        this.labelInput.h.el.toggleClass('tikz-hidden', this.labelMode !== 'custom');
        this.labelSeg.setValue(this.labelMode);
    }

    /** 'Corners of R1', 'Max of 2x + 3y over R1', 'Points (1, 2); (3, 4)', ...: one whole text per case, so a translation can order it. */
    protected summary(): string {
        const tool = this.tool;
        const objective = squash(tool.objective);
        const min = tool.sense === 'min';
        switch (tool.source) {
            case 'list': {
                const pts = listEntries(tool.points);
                if (!pts.length) return t('build.points.empty');
                if (pts.length === 1) {
                    if (!objective) return t('build.points.point', { point: pts[0] });
                    return t(min ? 'build.points.minPoint' : 'build.points.maxPoint', { objective, point: pts[0] });
                }
                if (!objective) return t('build.points.pointList', { points: pts.join('; ') });
                return t(min ? 'build.points.minPoints' : 'build.points.maxPoints', { objective, count: pts.length, points: pts.join('; ') });
            }
            case 'intersections': {
                const pair = { first: tool.ref1 || '?', second: tool.ref2 || '?' };
                if (!objective) return t('build.points.crossings', pair);
                return t(min ? 'build.points.minCrossings' : 'build.points.maxCrossings', { objective, ...pair });
            }
            case 'region': {
                const region = tool.regionName || '?';
                if (!objective) return t('build.points.corners', { region });
                return t(min ? 'build.points.minOver' : 'build.points.maxOver', { objective, region });
            }
            case 'lattice': {
                const region = tool.regionName;
                if (!region) {
                    if (!objective) return t('build.points.integerPointsView');
                    return t(min ? 'build.points.minIntegersView' : 'build.points.maxIntegersView', { objective });
                }
                if (!objective) return t('build.points.integerPoints', { region });
                return t(min ? 'build.points.minIntegers' : 'build.points.maxIntegers', { objective, region });
            }
        }
    }
}

// ---------------------------------------------------------- segment card

class SegmentCard extends ToolCard<SegmentTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: SegmentTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const is3D = tool.dim === 3;
        const pathField = field(this.body, { label: t('build.segment.path'), layout: 'inline' });
        const path = this.exprField(pathField.controlEl, {
            id: 'path',
            label: t('build.segment.path'),
            kind: () => (tool.dim === 3 ? 'path3' : 'path2'),
            placeholder: is3D ? '(0, 0, 0); (1, 1, 1)' : '(0, 0); (3, 2)',
            get: () => tool.path,
            set: (v) => {
                tool.path = v;
            },
        });
        pathField.bind(path.h.input);

        // Braces are 2D only; a 3D segment keeps the option only while it is selected.
        const styles: Array<SegmentOption<SegmentStyle>> = [
            { value: 'line', text: t('build.segment.line') },
            { value: 'forward', icon: 'arrow-right', ariaLabel: t('build.segment.arrowEnd') },
            { value: 'backward', icon: 'arrow-left', ariaLabel: t('build.segment.arrowStart') },
            { value: 'both', icon: 'move-horizontal', ariaLabel: t('build.segment.arrowBoth') },
            { value: 'brace', text: t('build.segment.brace') },
        ];
        const styleField = field(this.body, { label: t('build.card.style'), layout: 'inline' });
        const style = segmented<SegmentStyle>(styleField.controlEl, {
            label: t('build.card.style'),
            value: tool.style,
            options: is3D ? styles.filter((s) => s.value !== 'brace' || tool.style === 'brace') : styles,
            onChange: (v) => {
                tool.style = v;
                this.changed();
            },
        });
        styleField.bind(style.el);

        this.lineRow({
            thickness: () => tool.thickness,
            setThickness: (v) => {
                tool.thickness = v;
            },
            chips: [
                {
                    label: t('common.dashed'),
                    get: () => tool.dashed,
                    set: (v) => {
                        tool.dashed = v;
                    },
                },
                {
                    label: t('build.segment.closed'),
                    get: () => tool.closed,
                    set: (v) => {
                        tool.closed = v;
                    },
                },
            ],
        });
        this.labelField(t('build.segment.labelPlaceholder'));
        this.onSync(() => style.setValue(tool.style));
    }

    protected summary(): string {
        const tool = this.tool;
        const pts = listEntries(tool.path);
        if (!pts.length) return t('build.segment.empty');
        let shape: MessageKey;
        if (tool.style === 'brace') shape = 'build.segment.kindBrace';
        else if (tool.style !== 'line') shape = pts.length > 2 ? 'build.segment.kindArrows' : 'build.segment.kindArrow';
        else if (tool.closed) shape = 'build.segment.kindPolygon';
        else shape = pts.length > 2 ? 'build.segment.kindPath' : 'build.segment.kindSegment';
        const kind = t(shape);
        const label = squash(tool.label);
        let text: string;
        if (pts.length === 1) text = t('build.segment.through', { kind, point: pts[0] });
        else if (pts.length === 2 || tool.style === 'brace') text = t('build.segment.fromTo', { kind, from: pts[0], to: pts[1] });
        else text = t('build.segment.throughCount', { kind, count: pts.length });
        return label ? t('build.segment.labelled', { text, label }) : text;
    }
}

// ------------------------------------------------------------ plane card

class PlaneCard extends ToolCard<PlaneTool> {
    constructor(parent: HTMLElement, item: LayerItem, tool: PlaneTool, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, tool, host, actions);
        this.build();
        this.finish();
    }

    private build(): void {
        const tool = this.tool;
        const planeField = field(this.body, { label: t('build.plane.plane'), layout: 'inline', cls: 'etz-layer-plane' });
        const axis = segmented<PlaneTool['axis']>(planeField.controlEl, {
            label: t('build.plane.axis'),
            value: tool.axis,
            options: [
                { value: 'x', text: 'x' },
                { value: 'y', text: 'y' },
                { value: 'z', text: 'z' },
            ],
            onChange: (v) => {
                tool.axis = v;
                this.changed();
            },
        });
        planeField.bind(axis.el);
        planeField.controlEl.createSpan({ cls: 'etz-layer-eq', text: '=', attr: { 'aria-hidden': 'true' } });
        this.exprField(planeField.controlEl, {
            id: 'value',
            label: t('build.plane.value'),
            kind: 'value',
            required: true,
            placeholder: t('build.plane.valuePlaceholder'),
            get: () => tool.value,
            set: (v) => {
                tool.value = v;
            },
        });

        const opField = field(this.body, { label: t('build.card.opacity'), layout: 'inline' });
        const opacity = liveSlider(opField.controlEl, {
            min: 0,
            max: 1,
            step: 0.05,
            value: tool.fillOpacity,
            label: t('build.card.opacity'),
            format: percent,
            onInput: (v) => {
                tool.fillOpacity = v;
                this.frame();
            },
        });
        opField.bind(opacity.input);
        this.onSync(() => {
            axis.setValue(tool.axis);
            opacity.setValue(tool.fillOpacity);
        });
    }

    protected summary(): string {
        return t('build.plane.summary', { axis: this.tool.axis, value: squash(this.tool.value) || '?' });
    }
}

// ------------------------------------------------------------ label card

class LabelCard extends BaseCard {
    private readonly index: number;
    /** Stand-in when the index no longer exists (the Build panel rebuilds shortly). */
    private readonly detached: Annotation = { x: '0', y: '0', text: '', color: 'black', size: 'normal', anchor: 'above' };
    private dragHint!: HTMLElement;

    constructor(parent: HTMLElement, item: LayerItem & { kind: 'label' }, host: PanelHost, actions: LayerCardActions) {
        super(parent, item, host, actions, LabelCard.setup(host, item.index));
        this.index = item.index;
        this.build();
        this.finish();
    }

    private static setup(host: PanelHost, index: number): ShellSetup {
        const list = host.settings.getValue<Annotation[] | undefined>('annotations');
        const ann = Array.isArray(list) ? list[index] : undefined;
        return {
            kind: t('build.kind.label'),
            name: t('build.label.name', { n: index + 1 }),
            color: ann ? ann.color : 'black',
            visible: !(ann && ann.hidden),
            renamable: false,
            cls: 'etz-layer-card mod-label',
        };
    }

    private ann(): Annotation {
        const list = this.settingsList<Annotation>('annotations');
        return list[this.index] ?? this.detached;
    }

    protected source(): string {
        return `label:${this.index}`;
    }

    protected setColor(color: string): void {
        this.ann().color = color;
    }

    protected setHidden(hidden: boolean): void {
        const a = this.ann();
        if (hidden) a.hidden = true;
        else delete a.hidden;
    }

    protected position(): { index: number; count: number } {
        return { index: this.index, count: this.settingsList<Annotation>('annotations').length };
    }

    protected syncShell(): void {
        const a = this.ann();
        this.shell.setColor(a.color);
        this.shell.setVisible(!a.hidden);
    }

    private build(): void {
        const is3D = this.host.is3D();
        const textField = field(this.body, { label: t('build.label.text'), layout: 'inline' });
        const text = this.exprField(textField.controlEl, {
            id: 'text',
            label: t('build.label.text'),
            kind: 'template',
            placeholder: t('build.label.textPlaceholder'),
            get: () => this.ann().text,
            set: (v) => {
                this.ann().text = v;
            },
        });
        textField.bind(text.h.input);

        // Position: one value input per axis (expressions, sliders and P1_x allowed).
        const posField = field(this.body, { label: t('build.label.position'), layout: 'inline', cls: 'etz-layer-position' });
        const axes: Array<'x' | 'y' | 'z'> = is3D ? ['x', 'y', 'z'] : ['x', 'y'];
        const posRow = posField.controlEl.createDiv({ cls: 'etz-layer-pos' });
        for (const axis of axes) {
            const cell = posRow.createDiv({ cls: 'etz-layer-pos-cell' });
            cell.createSpan({ cls: 'etz-layer-pos-axis', text: axis, attr: { 'aria-hidden': 'true' } });
            this.exprField(cell, {
                id: axis,
                label: t('build.label.axisPosition', { axis }),
                kind: 'value',
                required: true,
                placeholder: '0',
                get: () => this.ann()[axis] ?? '',
                set: (v) => {
                    this.ann()[axis] = v;
                },
            });
        }
        this.dragHint = posField.hintEl;

        const sizeField = field(this.body, { label: t('build.card.size'), layout: 'inline' });
        const size = segmented<AnnotationSize>(sizeField.controlEl, {
            label: t('build.label.textSize'),
            value: this.ann().size,
            cls: 'etz-layer-size',
            options: sizeOptions<AnnotationSize>('small', 'normal', 'large'),
            onChange: (v) => {
                this.ann().size = v;
                this.changed();
            },
        });
        sizeField.bind(size.el);

        const anchorField = field(this.body, { label: t('build.label.place'), layout: 'inline' });
        const anchor = segmented<AnnotationAnchor>(anchorField.controlEl, {
            label: t('build.label.placeText'),
            value: this.ann().anchor,
            options: [
                { value: 'center', icon: 'circle-dot', ariaLabel: t('build.label.center') },
                { value: 'above', icon: 'arrow-up', ariaLabel: t('build.label.above') },
                { value: 'below', icon: 'arrow-down', ariaLabel: t('build.label.below') },
                { value: 'left', icon: 'arrow-left', ariaLabel: t('build.label.left') },
                { value: 'right', icon: 'arrow-right', ariaLabel: t('build.label.right') },
            ],
            onChange: (v) => {
                this.ann().anchor = v;
                this.changed();
            },
        });
        anchorField.bind(anchor.el);

        this.onSync(() => {
            size.setValue(this.ann().size);
            anchor.setValue(this.ann().anchor);
        });
    }

    protected syncState(): void {
        if (!this.dragHint) return;
        if (this.host.is3D()) {
            this.dragHint.addClass('tikz-hidden');
            return;
        }
        // Dragging writes numbers, or adds an offset to an expression position (SPEC3 1.4). The example is an
        // identifier, kept out of the checked sentence.
        this.dragHint.setText(t('build.label.dragHint', { example: OFFSET_EXAMPLE }));
        this.dragHint.removeClass('tikz-hidden');
    }

    /** A label drag writes x and y together. */
    protected liveIds(fieldId: string): string[] {
        return fieldId === 'x' || fieldId === 'y' ? ['x', 'y'] : [fieldId];
    }

    protected summary(): string {
        const a = this.ann();
        const text = squash(a.text);
        if (!text) return t('build.label.empty');
        const pos = this.host.is3D() ? [a.x, a.y, a.z ?? ''] : [a.x, a.y];
        return t('build.label.summary', { text, position: pos.map((p) => squash(p) || '?').join(', ') });
    }
}
