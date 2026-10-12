/*
 * Function cards for the Build tab: one card per 2D function (y = f(x),
 * parametric x(t), y(t), polar r(theta)) and one per 3D surface z = f(x, y).
 * Cards write straight into the objects inside settings 'functions' /
 * 'functions3D'; the Build panel owns the list itself (add, remove,
 * reorder) and hands every card its CardActions.
 *
 * Update rules: typing calls host.requestUpdate(), live slider drags
 * host.requestFrame(), and changes that alter what other fields may
 * reference (kind, visibility, name, a committed expression or domain)
 * host.commit(), which also re-validates every other registered field.
 */
import { Menu, Notice } from 'obsidian';
import { FillPattern, Function3DParameters, FunctionParameters } from '../types';
import { FunctionKind, ValidateResult, fmtNum } from '../mathcontext';
import { splitDomain } from '../expr';
import { RESERVED_NAMES } from '../migrate';
import { FILL_PATTERN_OPTIONS, THICKNESS_OPTIONS } from '../colors';
import { MAX_SAMPLES_3D } from '../export';
import { MAX_PREVIEW_SAMPLES_3D } from '../renderer3d';
import { UserTemplate } from '../templates';
import { CardActions, PanelHost } from './host';
import {
    CardShellHandle,
    ChipHandle,
    DisclosureHandle,
    ExprInputHandle,
    FieldLayoutHandle,
    LiveSliderHandle,
    SegmentedHandle,
    cardShell,
    chip,
    disclosure,
    dropdown,
    exprInput,
    field,
    liveSlider,
    promptText,
    segmented,
    textButton,
    textInput,
    thicknessPicker,
} from './kit';

/** Referenceable name: letter first, then letters, digits, underscores. */
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Live tangent keywords: min, max, min2, max3, ... (the n-th extremum from the left). */
const TANGENT_KEYWORD_RE = /^\s*(min|max)\d*\s*$/;

/** Derived value names of a tool: P1_x, P1_y2, P1_val, ... */
const DERIVED_RE = /^(.+)_(?:x|y|z|val|n)\d*$/;

const OK: ValidateResult = { ok: true };

/** Surface sampling range: the 3D renderer clamps to the same bounds. */
const SURFACE_SAMPLES_MIN = 8;
const SURFACE_SAMPLES_DEFAULT_MAX = 80;

/** UI state of a card that survives panel rebuilds (kept by the Build panel per item). */
export interface CardUiState {
    collapsed: boolean;
    optionsOpen: boolean;
}

/** Extras the Build panel passes to a function or surface card. */
export interface FunctionCardOptions {
    /** Where the card sits in its section (Move up / Move down are disabled at the ends). */
    position?: () => { index: number; count: number };
    ui?: CardUiState;
    /** Some field of this card started or stopped showing an error. */
    onErrorChange?: () => void;
    /** 'Shade between two curves instead? Add region' in the fill options. */
    onAddRegion?: (fn: FunctionParameters) => void;
    /** After a rename: other cards show the new name in their fields. */
    onRenamed?: () => void;
    /** Badge text for a surface without a stored name (asked on every sync, the list order may change). */
    fallbackName?: () => string;
}

export interface FunctionCardHandle {
    el: HTMLElement;
    /** The function / surface object inside settings. */
    item: FunctionParameters | Function3DParameters;
    /** Name used by issues and the status chip ('f1'). */
    name(): string;
    /** Re-read every value from the item (rename, undo, external edits). */
    refresh(): void;
    setCollapsed(collapsed: boolean): void;
    /** Expand, scroll into view and focus `field` ('expression', 'domain', ...); select `selectText`. */
    reveal(field?: string, selectText?: string): void;
    /** Focus the header (after a delete or move of a neighbour). */
    focusHeader(): void;
    hasError(): boolean;
    /** Unregister fields, close popovers, remove the element. */
    destroy(): void;
    /**
     * Optional (SPEC3 4.7): re-read the inputs while a preview drag rewrites
     * the item: text only where it differs, no validation (the drag's commit
     * re-validates every field), header summary and option pills follow.
     */
    syncLive?(): void;
    /**
     * Optional (SPEC3 4.7): mark the card as the source of a preview drag
     * (is-drag-source) and the input of `field` (is-live); null clears both.
     */
    markLive?(field: string | null): void;
}

// ------------------------------------------------------------- helpers

/**
 * Axis variable names as the engine reads the 'variables' setting ('x, y'
 * by default; 'q p', 'q; p' and 'q, p' all give ['q', 'p']). Read from the
 * MathContext so the cards never parse the setting differently from it.
 */
export function axisVariables(host: PanelHost): [string, string] {
    try {
        const [first, second] = host.math().axisAliases;
        return [first[first.length - 1] || 'x', second[second.length - 1] || 'y'];
    } catch {
        return ['x', 'y'];
    }
}

/** True when `name` means an axis in the engine: an axis variable or one of its aliases (x, y). */
export function isAxisName(host: PanelHost, name: string): boolean {
    try {
        const [first, second] = host.math().axisAliases;
        return first.includes(name) || second.includes(name);
    } catch {
        return axisVariables(host).includes(name);
    }
}

function functionList(host: PanelHost): FunctionParameters[] {
    const list = host.settings.getValue<FunctionParameters[] | undefined>('functions');
    return Array.isArray(list) ? list : [];
}

function surfaceList(host: PanelHost): Function3DParameters[] {
    const list = host.settings.getValue<Function3DParameters[] | undefined>('functions3D');
    return Array.isArray(list) ? list : [];
}

/**
 * Why `name` cannot name a function (or null when it can). `self` is the
 * item being renamed, so its own current name does not count as taken.
 */
export function functionNameProblem(host: PanelHost, name: string, self: object | null): string | null {
    if (!name) return 'Enter a name';
    if (!NAME_RE.test(name)) return 'Start with a letter, then letters, digits or _';
    if (RESERVED_NAMES.has(name)) return `${name} is a reserved name`;
    if (isAxisName(host, name)) return `${name} is an axis variable`;
    const tools = host.settings.getValue<{ name: string }[] | undefined>('tools') || [];
    const params = host.settings.getValue<{ name: string }[] | undefined>('parameters') || [];
    const others: Array<{ name?: string }> = host.is3D() ? surfaceList(host) : functionList(host);
    if (others.some((f) => f !== self && f.name === name)) return `${name} is already used`;
    if (tools.some((t) => t.name === name)) return `${name} is already used by a tool`;
    if (params.some((p) => p.name === name)) return `${name} is already used by a slider`;
    const derived = DERIVED_RE.exec(name);
    if (derived && tools.some((t) => t.name === derived[1])) return `${name} is a value computed by ${derived[1]}`;
    return null;
}

/** ', 0 <= x <= 4' for a set domain, '' otherwise. */
function domainSummary(domain: string, variable: string): string {
    const d = domain.trim();
    if (!d) return '';
    const parts = splitDomain(d);
    return parts ? `, ${parts[0]} <= ${variable} <= ${parts[1]}` : `, ${variable} in ${d}`;
}

function kindOf(host: PanelHost, fn: FunctionParameters): FunctionKind {
    return fn.parametric ? 'parametric' : host.isPolar() ? 'polar' : 'cartesian';
}

/** Plain-language summary for the card header: 'y = x^2 - 2x, -3 <= x <= 3'. */
export function functionSummary(host: PanelHost, fn: FunctionParameters): string {
    const [v1, v2] = axisVariables(host);
    const kind = kindOf(host, fn);
    const x = fn.expression.trim();
    if (kind === 'parametric') {
        const y = fn.expressionY.trim();
        if (!x && !y) return 'Empty curve: type x(t) and y(t)';
        return `x = ${x || '?'}, y = ${y || '?'}${domainSummary(fn.domain, 't')}`;
    }
    if (!x) return 'Empty function: type a formula';
    if (kind === 'polar') return `r = ${x}${domainSummary(fn.domain, 'θ')}`;
    return `${v2} = ${x}${domainSummary(fn.domain, v1)}`;
}

export function surfaceSummary(surface: Function3DParameters): string {
    const z = surface.expression.trim();
    if (!z) return 'Empty surface: type a formula';
    return `z = ${z}${surface.wireframe ? ', wireframe' : ''}`;
}

/** Center of the visible x range, for prefilling the tangent point. */
function viewCenterX(host: PanelHost): string {
    try {
        const { view } = host.settings.resolveView(host.math());
        const mid = (view.xmin + view.xmax) / 2;
        if (Number.isFinite(mid)) return fmtNum(mid);
    } catch {
        // resolveView unavailable: fall back to the stored range below.
    }
    const lo = Number(host.settings.getValue('xmin'));
    const hi = Number(host.settings.getValue('xmax'));
    return Number.isFinite(lo) && Number.isFinite(hi) ? fmtNum((lo + hi) / 2) : '1';
}

/** One registered expression field of a card. */
interface CardField {
    id: string;
    handle: ExprInputHandle;
    unregister: () => void;
}

/**
 * Shared plumbing of both card kinds: expression fields registered with the
 * host (so the status chip can reach them) and the card's error dot.
 */
class CardFields {
    readonly fields: CardField[] = [];
    private lastError = false;

    constructor(
        private host: PanelHost,
        private source: () => string,
        private shell: () => CardShellHandle,
        private reveal: (field: string, selectText?: string) => void,
        private onErrorChange?: () => void,
    ) {}

    add(id: string, handle: ExprInputHandle): ExprInputHandle {
        const source = this.source;
        const reveal = this.reveal;
        const unregister = this.host.registerField({
            // Getter: the card keeps its registration across renames.
            get source() {
                return source();
            },
            field: id,
            validate: () => handle.validate(),
            focus: (selectText) => reveal(id, selectText),
        });
        this.fields.push({ id, handle, unregister });
        return handle;
    }

    get(id: string): ExprInputHandle | null {
        const f = this.fields.find((x) => x.id === id);
        return f ? f.handle : null;
    }

    hasError(): boolean {
        return this.fields.some((f) => f.handle.hasError());
    }

    /** Preview drag marks: the card (is-drag-source) and the input of field `id` (is-live); null clears. */
    markLive(cardEl: HTMLElement, id: string | null): void {
        cardEl.toggleClass('is-drag-source', id !== null);
        for (const f of this.fields) f.handle.el.toggleClass('is-live', f.id === id);
    }

    /** Refresh the header dot and tell the panel when the card's error state flipped. */
    syncError(): void {
        const has = this.hasError();
        this.shell().setError(has);
        if (has !== this.lastError) {
            this.lastError = has;
            if (this.onErrorChange) this.onErrorChange();
        }
    }

    destroy(): void {
        for (const f of this.fields) {
            f.unregister();
            f.handle.destroy();
        }
        this.fields.length = 0;
    }
}

/** Duplicate / Move up / Move down / [Save as template] / Delete. */
function fillCardMenu(menu: Menu, actions: CardActions, opts: FunctionCardOptions, saveTemplate: (() => void) | null): void {
    const pos = opts.position ? opts.position() : null;
    menu.addItem((i) => i.setTitle('Duplicate').setIcon('copy').onClick(() => actions.duplicate()));
    menu.addItem((i) =>
        i
            .setTitle('Move up')
            .setIcon('arrow-up')
            .setDisabled(!!pos && pos.index <= 0)
            .onClick(() => actions.moveUp()),
    );
    menu.addItem((i) =>
        i
            .setTitle('Move down')
            .setIcon('arrow-down')
            .setDisabled(!!pos && pos.index >= pos.count - 1)
            .onClick(() => actions.moveDown()),
    );
    if (saveTemplate) {
        const save = saveTemplate;
        menu.addItem((i) => i.setTitle('Save as template...').setIcon('bookmark-plus').onClick(() => save()));
    }
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Delete').setIcon('trash-2').setWarning(true).onClick(() => actions.remove()));
}

/** Ask for a template name and append it to the saved templates. Notice only when writing fails. */
async function saveUserTemplate(host: PanelHost, suggestion: string, make: (name: string) => UserTemplate): Promise<void> {
    const plugin = host.plugin;
    if (!plugin) return;
    const is3D = make('').is3D;
    const existing = () => (Array.isArray(plugin.data.userTemplates) ? plugin.data.userTemplates : []);
    const name = await promptText(host.app, {
        title: 'Save as template',
        value: suggestion,
        placeholder: 'Template name',
        description: is3D
            ? 'Saved surfaces appear in the Add menu under Surfaces > From a template.'
            : 'Saved functions appear in the Add menu under Functions > From a template.',
        validate: (v) => (existing().some((t) => t.is3D === is3D && t.name === v) ? `A saved template is already called ${v}` : null),
    });
    if (!name) return;
    try {
        await plugin.saveUserTemplates([...existing(), make(name)]);
    } catch (e) {
        new Notice(`Could not save the template: ${e instanceof Error ? e.message : String(e)}`);
    }
}

/** Inline field (label left, control right) holding one expression input. */
function exprRow(
    parent: HTMLElement,
    label: string,
    cls: string,
    build: (control: HTMLElement) => ExprInputHandle,
): { row: FieldLayoutHandle; input: ExprInputHandle } {
    const row = field(parent, { label, layout: 'inline', cls });
    const input = build(row.controlEl);
    row.bind(input.input);
    return { row, input };
}

function setShown(el: HTMLElement, shown: boolean): void {
    el.toggleClass('tikz-hidden', !shown);
}

/** Write a value into an input only when it differs (keeps caret and pending messages). */
function syncExpr(handle: ExprInputHandle, value: string): void {
    if (handle.getValue() !== value) handle.setValue(value);
}

/**
 * Text only, no validation: a preview drag rewrites the field every frame and
 * the host re-validates once on release. Returns true when the text changed.
 */
function liveExpr(handle: ExprInputHandle, value: string): boolean {
    if (handle.input.value === value) return false;
    handle.input.value = value;
    return true;
}

// --------------------------------------------------------- 2D function

/**
 * Card for one 2D function. Body: expression (x(t) and y(t) when
 * parametric), domain, active-option pills, and an Options disclosure with
 * the type, line thickness, style chips and their dependent rows.
 */
export function createFunctionCard(
    parent: HTMLElement,
    fn: FunctionParameters,
    host: PanelHost,
    actions: CardActions,
    opts: FunctionCardOptions = {},
): FunctionCardHandle {
    const ui: CardUiState = opts.ui ?? { collapsed: false, optionsOpen: false };
    const kind = () => kindOf(host, fn);
    const cartesian = () => kind() === 'cartesian';

    const setVisible = (visible: boolean) => {
        if (visible) delete fn.hidden;
        else fn.hidden = true;
        host.commit();
    };

    const rename = (to: string) => {
        const from = fn.name || '';
        host.rename('function', from, to);
        // host.rename updates references; make sure the function itself carries the new name.
        if (fn.name !== to) {
            fn.name = to;
            host.commit();
        }
        if (opts.onRenamed) opts.onRenamed();
    };

    const saveTemplate = () =>
        saveUserTemplate(host, fn.expression.trim().slice(0, 40) || 'My function', (name) => ({
            name,
            is3D: false,
            expression: fn.expression,
            domain: fn.domain,
            color: fn.color,
        }));

    const shell = cardShell(parent, host, {
        name: fn.name || '',
        kind: 'Function',
        summary: functionSummary(host, fn),
        color: fn.color,
        onColorChange: (c) => {
            fn.color = c;
            host.requestUpdate();
        },
        validateName: (n) => functionNameProblem(host, n, fn),
        onRename: rename,
        visible: !fn.hidden,
        onVisibleChange: setVisible,
        // Parametric functions have no template shape (templates store one expression).
        menu: (m) => fillCardMenu(m, actions, opts, host.plugin && !fn.parametric ? () => void saveTemplate() : null),
        collapsed: ui.collapsed,
        onCollapsedChange: (c) => {
            ui.collapsed = c;
        },
        onMoveUp: () => actions.moveUp(),
        onMoveDown: () => actions.moveDown(),
        cls: 'etz-fn-card',
    });
    const fields = new CardFields(
        host,
        () => fn.name || '',
        () => shell,
        (id, sel) => reveal(id, sel),
        opts.onErrorChange,
    );
    const body = shell.bodyEl;
    const updateSummary = () => shell.setSummary(functionSummary(host, fn));

    // ---- expression(s)
    const validateBody = (src: string, which: 'expression' | 'expressionY'): ValidateResult => {
        // An empty field is a fresh card, not a mistake: the summary asks for a formula.
        if (!src.trim() || (which === 'expressionY' && !fn.parametric)) return OK;
        const math = host.math();
        const result = math.validate(src, 'fn1', kind());
        if (result.ok) return result;
        // A reference cycle reads better from the function's own point of view.
        const info = fn.name ? math.functionInfo(fn.name) : null;
        if (info && info.error && info.error.startsWith(`${fn.name} refers to itself`)) {
            return { ok: false, message: info.error, pos: result.pos };
        }
        return result;
    };
    const exprOptions = (key: 'expression' | 'expressionY', label: string) => ({
        value: fn[key],
        label,
        validate: (src: string) => validateBody(src, key),
        onInput: (v: string) => {
            fn[key] = v;
            updateSummary();
            host.requestUpdate();
        },
        // Other fields may call this function: re-validate them once the edit settles.
        onCommit: () => host.commit(),
        onAddParameter: (name: string) => {
            host.addParameter(name);
        },
        onErrorChange: () => fields.syncError(),
    });
    const main = exprRow(body, '', 'etz-fn-row mod-expr', (c) => exprInput(c, exprOptions('expression', 'Expression')));
    fields.add('expression', main.input);
    const yRow = exprRow(body, 'y(t) =', 'etz-fn-row mod-expr', (c) => exprInput(c, exprOptions('expressionY', 'y(t)')));
    fields.add('expressionY', yRow.input);

    // ---- domain
    const domainRow = exprRow(body, '', 'etz-fn-row', (c) =>
        exprInput(c, {
            value: fn.domain,
            label: 'Domain',
            validate: (src) => (src.trim() ? host.math().validate(src, 'domain') : OK),
            onInput: (v) => {
                fn.domain = v;
                updateSummary();
                host.requestUpdate();
            },
            onCommit: () => host.commit(),
            onAddParameter: (name) => {
                host.addParameter(name);
            },
            onErrorChange: () => fields.syncError(),
        }),
    );
    fields.add('domain', domainRow.input);

    // ---- options: header row with pills for the options that are on
    const options: DisclosureHandle = disclosure(body, {
        label: 'Options',
        open: ui.optionsOpen,
        cls: 'etz-fn-options',
        onToggle: (open) => {
            ui.optionsOpen = open;
            syncPills();
        },
    });
    const pillsEl = options.el.createDiv({ cls: 'etz-fn-pills' });
    options.el.insertBefore(pillsEl, options.body);

    const openOptions = (focus?: HTMLElement | null) => {
        options.setOpen(true);
        ui.optionsOpen = true;
        syncPills();
        if (focus) focus.focus();
    };

    const typeSeg: SegmentedHandle<'graph' | 'parametric'> = segmented(options.body, {
        label: 'Function type',
        value: fn.parametric ? 'parametric' : 'graph',
        fill: true,
        options: [
            { value: 'graph', text: 'y = f(x)' },
            { value: 'parametric', text: 'x(t), y(t)' },
        ],
        onChange: (v) => {
            fn.parametric = v === 'parametric';
            sync();
            host.commit();
        },
    });

    const lineRow = field(options.body, { label: 'Line', layout: 'inline', cls: 'etz-fn-row' });
    const thickness = thicknessPicker(lineRow.controlEl, {
        value: fn.thickness,
        onChange: (t) => {
            fn.thickness = t;
            syncPills();
            host.requestUpdate();
        },
    });
    lineRow.bind(thickness.el);

    const chipsEl = options.body.createDiv({ cls: 'etz-fn-chips' });
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void): ChipHandle =>
        chip(chipsEl, {
            label,
            value: get(),
            onChange: (v) => {
                set(v);
                syncRows();
                syncPills();
                host.requestUpdate();
            },
        });
    const dashedChip = toggle('Dashed', () => fn.dashed, (v) => (fn.dashed = v));
    const legendChip = toggle('Legend', () => fn.showLegend, (v) => (fn.showLegend = v));
    const fillChip = toggle('Fill to x-axis', () => fn.fill, (v) => (fn.fill = v));
    const tangentChip = toggle(
        'Tangent',
        () => fn.tangent,
        (v) => {
            fn.tangent = v;
            // A tangent needs a point; start in the middle of the view and let the user edit it.
            if (v && !fn.tangentPoint.trim()) {
                fn.tangentPoint = viewCenterX(host);
                syncExpr(tangent.input, fn.tangentPoint);
            }
            tangent.input.validate();
        },
    );
    const extremaChip = toggle('Extrema', () => fn.extrema, (v) => (fn.extrema = v));

    // Dependent rows, shown only while their chip is on.
    const legendRow = field(options.body, { label: 'Legend', layout: 'inline', cls: 'etz-fn-row etz-fn-dep' });
    const legendInput = textInput(legendRow.controlEl, {
        value: fn.legendLabel ?? '',
        placeholder: 'Default: the formula',
        onInput: (v) => {
            fn.legendLabel = v;
            host.requestUpdate();
        },
    });
    legendRow.bind(legendInput.el);

    const fillRow = field(options.body, { label: 'Fill', layout: 'inline', cls: 'etz-fn-row etz-fn-dep' });
    const fillControls = fillRow.controlEl.createDiv({ cls: 'etz-fn-fill' });
    const pattern = dropdown<FillPattern>(fillControls, {
        label: 'Fill pattern',
        options: FILL_PATTERN_OPTIONS,
        value: fn.fillPattern,
        onChange: (v) => {
            fn.fillPattern = v;
            host.requestUpdate();
        },
    });
    const opacity: LiveSliderHandle = liveSlider(fillControls, {
        min: 0.05,
        max: 1,
        step: 0.05,
        value: fn.fillOpacity,
        label: 'Fill opacity',
        format: (v) => `${Math.round(v * 100)} %`,
        onInput: (v) => {
            fn.fillOpacity = v;
            syncPills();
            host.requestFrame();
        },
    });
    const regionLink = fillRow.controlEl.createDiv({ cls: 'etz-fn-link-row' });
    regionLink.createSpan({ text: 'Shade between two curves instead? ' });
    textButton(regionLink, {
        text: 'Add region',
        variant: 'link',
        onClick: () => {
            if (opts.onAddRegion) opts.onAddRegion(fn);
        },
    });

    const tangent = exprRow(options.body, 'At x', 'etz-fn-row etz-fn-dep', (c) =>
        exprInput(c, {
            value: fn.tangentPoint,
            label: 'Tangent point',
            placeholder: 'e.g. 1, a, or max',
            validate: (src) => {
                // A hidden row never reports: the point only matters while Tangent is on.
                if (!fn.tangent || !cartesian()) return OK;
                if (!src.trim()) return { ok: false, message: 'Enter a point: a number, an expression, min or max' };
                if (TANGENT_KEYWORD_RE.test(src)) return OK;
                return host.math().validate(src, 'value');
            },
            onInput: (v) => {
                fn.tangentPoint = v;
                syncPills();
                host.requestUpdate();
            },
            onAddParameter: (name) => {
                host.addParameter(name);
            },
            onErrorChange: () => fields.syncError(),
        }),
    );
    tangent.row.setHint('A number, an expression, or min / max (min2, max2, ... from the left).');
    fields.add('tangentPoint', tangent.input);

    // ---- sync

    /** Pills for the options that are on, shown while Options is closed. Each one opens Options. */
    function syncPills(): void {
        pillsEl.empty();
        const isCartesian = cartesian();
        const pills: { text: string; target: () => HTMLElement | null }[] = [];
        if (fn.dashed) pills.push({ text: 'Dashed', target: () => dashedChip.el });
        if (fn.thickness && fn.thickness !== 'thin') {
            pills.push({ text: THICKNESS_OPTIONS[fn.thickness] ?? fn.thickness, target: () => thickness.el.querySelector('[tabindex="0"]') });
        }
        if (fn.showLegend) pills.push({ text: 'Legend', target: () => legendInput.el });
        if (isCartesian && fn.fill) pills.push({ text: `Fill ${Math.round(fn.fillOpacity * 100)} %`, target: () => opacity.input });
        if (isCartesian && fn.tangent) pills.push({ text: `Tangent at ${fn.tangentPoint.trim() || '?'}`, target: () => tangent.input.input });
        if (isCartesian && fn.extrema) pills.push({ text: 'Extrema', target: () => extremaChip.el });
        setShown(pillsEl, !options.isOpen() && pills.length > 0);
        for (const p of pills) {
            const b = pillsEl.createEl('button', { cls: 'etz-fn-pill', text: p.text, attr: { type: 'button' } });
            b.addEventListener('click', () => openOptions(p.target()));
        }
        options.setMeta(options.isOpen() || pills.length ? '' : isCartesian ? 'Line, legend, fill, tangent' : 'Line, legend');
    }

    /** Dependent rows follow their chips; decorations exist for y = f(x) graphs only. */
    function syncRows(): void {
        const isCartesian = cartesian();
        setShown(fillChip.el, isCartesian);
        setShown(tangentChip.el, isCartesian);
        setShown(extremaChip.el, isCartesian);
        setShown(legendRow.el, fn.showLegend);
        setShown(fillRow.el, isCartesian && fn.fill);
        setShown(tangent.row.el, isCartesian && fn.tangent);
    }

    /** Labels and placeholders that depend on the function kind and the axis variables. */
    function syncKind(): void {
        const k = kind();
        const [v1, v2] = axisVariables(host);
        typeSeg.setValue(fn.parametric ? 'parametric' : 'graph');
        // The type control offers the chart's graph form: r(θ) in polar charts.
        const graphText = host.isPolar() ? 'r = f(θ)' : `${v2} = f(${v1})`;
        const graphSeg = typeSeg.el.querySelector('.etz-seg .etz-seg-text');
        if (graphSeg) graphSeg.setText(graphText);
        if (k === 'parametric') {
            main.row.setLabel('x(t) =');
            main.input.input.placeholder = 'E.g. 3 + 2cos(t)';
            yRow.input.input.placeholder = 'E.g. 2 + 1.5sin(t)';
            domainRow.row.setLabel('t range');
            domainRow.input.input.placeholder = '0:2pi (default)';
        } else if (k === 'polar') {
            main.row.setLabel('r =');
            main.input.input.placeholder = 'E.g. 1 + cos(theta)';
            domainRow.row.setLabel('θ range');
            domainRow.input.input.placeholder = '0:2pi (default)';
        } else {
            main.row.setLabel(`${v2} =`);
            tangent.row.setLabel(`At ${v1}`);
            main.input.input.placeholder = `E.g. ${v1}^2 - 2${v1}`;
            domainRow.row.setLabel('Domain');
            domainRow.input.input.placeholder = 'Auto (visible range)';
        }
        setShown(yRow.row.el, k === 'parametric');
    }

    function sync(): void {
        shell.setName(fn.name || '');
        shell.setColor(fn.color);
        shell.setVisible(!fn.hidden);
        updateSummary();
        syncKind();
        syncExpr(main.input, fn.expression);
        syncExpr(yRow.input, fn.expressionY);
        syncExpr(domainRow.input, fn.domain);
        syncExpr(tangent.input, fn.tangentPoint);
        if (legendInput.getValue() !== (fn.legendLabel ?? '')) legendInput.setValue(fn.legendLabel ?? '');
        thickness.setValue(fn.thickness);
        dashedChip.setValue(fn.dashed);
        legendChip.setValue(fn.showLegend);
        fillChip.setValue(fn.fill);
        tangentChip.setValue(fn.tangent);
        extremaChip.setValue(fn.extrema);
        if (pattern.getValue() !== fn.fillPattern) pattern.setValue(fn.fillPattern);
        if (opacity.getValue() !== fn.fillOpacity) opacity.setValue(fn.fillOpacity);
        syncRows();
        syncPills();
        fields.syncError();
    }

    function reveal(id?: string, selectText?: string): void {
        shell.setCollapsed(false);
        ui.collapsed = false;
        if (id === 'tangentPoint' || id === 'legendLabel') openOptions(null);
        const target = (id && fields.get(id)) || main.input;
        shell.el.scrollIntoView({ block: 'nearest' });
        target.input.scrollIntoView({ block: 'nearest' });
        target.focus(selectText);
    }

    /** Preview drag frame: the expression (or tangent point) follows the pointer. */
    function syncLive(): void {
        liveExpr(main.input, fn.expression);
        liveExpr(yRow.input, fn.expressionY);
        liveExpr(domainRow.input, fn.domain);
        // 'Tangent at 1.5' pill.
        if (liveExpr(tangent.input, fn.tangentPoint)) syncPills();
        updateSummary();
    }

    sync();

    return {
        el: shell.el,
        item: fn,
        name: () => fn.name || '',
        refresh: sync,
        setCollapsed: (c) => {
            ui.collapsed = c;
            shell.setCollapsed(c);
        },
        reveal,
        focusHeader: () => shell.focusHeader(),
        hasError: () => fields.hasError(),
        destroy: () => {
            fields.destroy();
            shell.destroy();
        },
        syncLive,
        markLive: (id) => fields.markLive(shell.el, id),
    };
}

// ---------------------------------------------------------- 3D surface

/** Card for one surface z = f(x, y): formula, x / y ranges, wireframe, live opacity and samples. */
export function createSurfaceCard(
    parent: HTMLElement,
    surface: Function3DParameters,
    host: PanelHost,
    actions: CardActions,
    opts: FunctionCardOptions = {},
): FunctionCardHandle {
    const ui: CardUiState = opts.ui ?? { collapsed: false, optionsOpen: false };
    const displayName = () => surface.name || (opts.fallbackName ? opts.fallbackName() : '');

    const saveTemplate = () =>
        saveUserTemplate(host, surface.expression.trim().slice(0, 40) || 'My surface', (name) => ({
            name,
            is3D: true,
            expression: surface.expression,
            xDomain: surface.xDomain,
            yDomain: surface.yDomain,
            color: surface.color,
        }));

    const shell = cardShell(parent, host, {
        name: displayName(),
        kind: 'Surface',
        summary: surfaceSummary(surface),
        color: surface.color,
        onColorChange: (c) => {
            surface.color = c;
            host.requestUpdate();
        },
        // Surfaces are not referenced from formulas, so a rename only relabels the card.
        validateName: (n) => functionNameProblem(host, n, surface),
        onRename: (to) => {
            surface.name = to;
            host.commit();
            if (opts.onRenamed) opts.onRenamed();
        },
        visible: !surface.hidden,
        onVisibleChange: (visible) => {
            if (visible) delete surface.hidden;
            else surface.hidden = true;
            host.requestUpdate();
        },
        menu: (m) => fillCardMenu(m, actions, opts, host.plugin ? () => void saveTemplate() : null),
        collapsed: ui.collapsed,
        onCollapsedChange: (c) => {
            ui.collapsed = c;
        },
        onMoveUp: () => actions.moveUp(),
        onMoveDown: () => actions.moveDown(),
        cls: 'etz-fn-card mod-surface',
    });
    const fields = new CardFields(host, displayName, () => shell, (id, sel) => reveal(id, sel), opts.onErrorChange);
    const body = shell.bodyEl;

    const main = exprRow(body, 'z =', 'etz-fn-row mod-expr', (c) =>
        exprInput(c, {
            value: surface.expression,
            label: 'Surface formula',
            placeholder: 'e.g. x^2 - y^2',
            validate: (src) => (src.trim() ? host.math().validate(src, 'fn2') : OK),
            onInput: (v) => {
                surface.expression = v;
                shell.setSummary(surfaceSummary(surface));
                host.requestUpdate();
            },
            onAddParameter: (name) => {
                host.addParameter(name);
            },
            onErrorChange: () => fields.syncError(),
        }),
    );
    fields.add('expression', main.input);

    const rangeRow = (key: 'xDomain' | 'yDomain', label: string, axis: string) => {
        const r = exprRow(body, label, 'etz-fn-row', (c) =>
            exprInput(c, {
                value: surface[key],
                label,
                placeholder: `auto (${axis} range)`,
                validate: (src) => (src.trim() ? host.math().validate(src, 'domain') : OK),
                onInput: (v) => {
                    surface[key] = v;
                    host.requestUpdate();
                },
                onAddParameter: (name) => {
                    host.addParameter(name);
                },
                onErrorChange: () => fields.syncError(),
            }),
        );
        fields.add(key, r.input);
        return r;
    };
    const xRange = rangeRow('xDomain', 'x range', 'x');
    const yRange = rangeRow('yDomain', 'y range', 'y');

    const styleRow = field(body, { label: 'Style', layout: 'inline', cls: 'etz-fn-row' });
    const wireframe = chip(styleRow.controlEl, {
        label: 'Wireframe',
        value: surface.wireframe,
        onChange: (v) => {
            surface.wireframe = v;
            shell.setSummary(surfaceSummary(surface));
            host.requestUpdate();
        },
    });
    styleRow.bind(wireframe.el);

    const opacityRow = field(body, { label: 'Opacity', layout: 'inline', cls: 'etz-fn-row' });
    const opacity = liveSlider(opacityRow.controlEl, {
        min: 0.05,
        max: 1,
        step: 0.05,
        value: surface.opacity,
        label: 'Opacity',
        format: (v) => `${Math.round(v * 100)} %`,
        onInput: (v) => {
            surface.opacity = v;
            host.requestFrame();
        },
    });
    opacityRow.bind(opacity.input);

    // The plugin setting sets the slider's top, but never past what the preview can draw.
    const maxSamples = Math.max(40, Math.min(MAX_PREVIEW_SAMPLES_3D, (host.plugin && host.plugin.data.maxSamples3D) || SURFACE_SAMPLES_DEFAULT_MAX));
    const samplesRow = field(body, { label: 'Samples', layout: 'inline', cls: 'etz-fn-row' });
    const samples = liveSlider(samplesRow.controlEl, {
        min: SURFACE_SAMPLES_MIN,
        max: maxSamples,
        step: 1,
        value: Math.min(Math.max(surface.samples, SURFACE_SAMPLES_MIN), maxSamples),
        label: 'Samples per axis',
        format: (v) => String(Math.round(v)),
        onInput: (v) => {
            surface.samples = Math.round(v);
            syncSamplesHint();
            host.requestFrame();
        },
    });
    samplesRow.bind(samples.input);
    /** The export cap is stated once the slider passes it, so the preview never promises more than the code. */
    function syncSamplesHint(): void {
        const n = Math.round(surface.samples);
        samplesRow.setHint(
            n > MAX_SAMPLES_3D
                ? `Grid points per axis. The preview uses ${n}; the exported code uses at most ${MAX_SAMPLES_3D}, the most pdflatex has memory for.`
                : 'Grid points per axis. More is smoother but slower. The TikZ export uses at most ' +
                      `${MAX_SAMPLES_3D} and shares a budget between surfaces so pdflatex can compile it.`
        );
    }
    syncSamplesHint();

    function sync(): void {
        shell.setName(displayName());
        shell.setColor(surface.color);
        shell.setVisible(!surface.hidden);
        shell.setSummary(surfaceSummary(surface));
        syncExpr(main.input, surface.expression);
        syncExpr(xRange.input, surface.xDomain);
        syncExpr(yRange.input, surface.yDomain);
        wireframe.setValue(surface.wireframe);
        if (opacity.getValue() !== surface.opacity) opacity.setValue(surface.opacity);
        if (samples.getValue() !== surface.samples) samples.setValue(surface.samples);
        syncSamplesHint();
        fields.syncError();
    }

    function reveal(id?: string, selectText?: string): void {
        shell.setCollapsed(false);
        ui.collapsed = false;
        const target = (id && fields.get(id)) || main.input;
        shell.el.scrollIntoView({ block: 'nearest' });
        target.input.scrollIntoView({ block: 'nearest' });
        target.focus(selectText);
    }

    sync();

    return {
        el: shell.el,
        item: surface,
        name: displayName,
        refresh: sync,
        setCollapsed: (c) => {
            ui.collapsed = c;
            shell.setCollapsed(c);
        },
        reveal,
        focusHeader: () => shell.focusHeader(),
        hasError: () => fields.hasError(),
        destroy: () => {
            fields.destroy();
            shell.destroy();
        },
        // Surfaces are never dragged (3D); the marks still work for a uniform card API.
        syncLive: () => {
            liveExpr(main.input, surface.expression);
            liveExpr(xRange.input, surface.xDomain);
            liveExpr(yRange.input, surface.yDomain);
            shell.setSummary(surfaceSummary(surface));
        },
        markLive: (id) => fields.markLive(shell.el, id),
    };
}
