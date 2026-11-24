/*
 * Build tab: functions / surfaces and layer cards (tools + labels) in one
 * list, the "+ Add" recipe menus and the empty state with starter examples.
 *
 * The panel owns the item lists in settings ('functions' or 'functions3D',
 * 'tools', 'annotations'): adding, removing (with Undo), duplicating and
 * reordering happen here, followed by host.commit(). Cards are keyed by the
 * item objects themselves, so refresh() keeps every card (and its focus,
 * collapsed state and half-typed text) whose item is still in the list and
 * only builds cards for new items. That makes refresh() cheap enough for
 * the modal to call after every commit.
 */
import { Annotation, Function3DParameters, FunctionParameters, Parameter, Tool } from '../types';
import { ValidateResult, fmtNum } from '../mathcontext';
import { ChartExample, EXAMPLES, Recipe, RecipeContext, newId, nextFunctionName, nextToolName, recipes } from '../migrate';
import { showcaseExamples } from '../guides';
import { BUILT_IN_2D, BUILT_IN_3D } from '../templates';
import { RANGE_DEFAULTS, RangeKey, SettingsManager } from '../settings';
import { SVGRenderer } from '../renderer';
import { SVG3DRenderer } from '../renderer3d';
import type { SceneIssue } from '../scene';
import { PanelHost } from './host';
import { cloneData } from '../util';
import { LayerCardActions, LayerCardHandle, createLayerCard } from './layerCards';
// The cards of data, probability, Riemann sums and slope fields register themselves with the layer cards (5.0).
import '../beyond/cards';
import '../motion6/cards'; // 6.0 C
import '../linear/cards'; // 6.0 D
// 6.0 B: sets on an axis and chords.
import '../notes6/cards';
// 6.0 A
import '../values/cards';
import { CardUiState, FunctionCardHandle, createFunctionCard, createSurfaceCard } from './functionCards';
import { ExprInputHandle, IconButtonHandle, exprInput, group, iconButton, textButton, trapEscape } from './kit';
import { PickerContent, PickerGroup, PickerItem, addPicker } from './addPicker';
import { t } from '../i18n';
import type { MessageKey } from '../i18n';

export interface BuildPanelHandle {
    el: HTMLElement;
    /** Rebuild all cards from host.settings (after loadChart, 2D/3D switch, undo). */
    refresh(): void;
    /** Re-read annotation `index` position from settings into its card inputs (preview drag). */
    syncAnnotation(index: number): void;
    /** Reveal + focus the field for an issue. Returns false when no such card/field exists. */
    reveal(source: string, field?: string, selectText?: string): boolean;
    /** Names (functions, tools) whose cards currently show an error, for tab error dots. */
    hasErrors(): boolean;
    /**
     * Optional (v4 addition): the issues of the last full render. Layer cards
     * show their own ones (info notes such as 'unbounded', scene errors on a
     * field whose text is valid).
     */
    setIssues?(issues: SceneIssue[]): void;
    /**
     * Optional (SPEC3 4.7): re-read one item's card inputs from settings
     * while a preview drag rewrites it ('f1', 'R1', 'label:2'): text only
     * where it differs, no validation, no rebuild. Does nothing for an
     * unknown source.
     */
    syncItem?(source: string): void;
    /**
     * Optional (SPEC3 4.7): mark the card being dragged (class
     * is-drag-source) and its live field's input (is-live; field ids as in
     * reveal). null clears every mark.
     */
    markLive?(source: string | null, field: string | null): void;
    /** Optional (SPEC3 4.7): scroll the card into view (block nearest) and flash it for 600 ms without moving focus. */
    flash?(source: string): void;
}

/** Optional extras for createBuildPanel (v4 addition, not part of the fixed contract). */
export interface BuildPanelOptions {
    /** A card started or stopped showing an inline error: re-check hasErrors() for the tab dot. */
    onErrorsChange?: () => void;
    /**
     * A function, surface, template or shape was just added (the empty
     * state's formula field, or + Add). The host may fit the view to it while
     * the ranges are still the defaults (they cut off most first formulas, a
     * polar cardioid for one).
     */
    onStartAdded?: () => void;
    /**
     * True while the editor is still opening. Obsidian moves the focus to the
     * first button of a modal it opens (the 2D / 3D switch): during that time
     * the focus being there is not the user at work, and the empty state may
     * take it for its formula field.
     */
    opening?: () => boolean;
}

/** Charts that arrive with more cards than this start with every card collapsed. */
const COLLAPSE_THRESHOLD = 4;

/** Length of the card flash after a click on its object in the preview (matches .is-canvas-flash in drag.css). */
const FLASH_MS = 600;

/**
 * Thumbnail rendering: the plot area is cropped out of a chart rendered at
 * this plot size (about the 140 x 56 tile aspect). The padding mirrors the
 * renderer's defaults; renderer.layout reports the real plot rectangle.
 */
const THUMB_PLOT_W = 400;
const THUMB_PLOT_H = 160;
const THUMB_PAD_X = 85;
const THUMB_PAD_Y = 90;

/** The icon every item of a recipe section gets (sections are identifiers, see SECTION_TITLES). */
const SECTION_ICONS: Record<string, string> = {
    Functions: 'line-chart',
    Regions: 'paint-bucket',
    'Curves and lines': 'spline',
    Points: 'circle-dot',
    'Segments and arrows': 'move-up-right',
    Labels: 'type',
    Sliders: 'sliders-horizontal',
    '3D': 'box',
    Data: 'table',
    Probability: 'bar-chart-2',
    Calculus: 'sigma',
    Motion: 'wind', // 6.0 C
    // 6.0 A
    Values: 'braces',
    'Linear algebra': 'grid-3x3', // 6.0 D
};

/** More words that find a recipe in the + Add picker (English, as people search): vector finds Arrow. */
const RECIPE_WORDS: Record<string, string> = {
    function: 'graph plot curve',
    parametric: 'ellipse spiral path',
    'area-between': 'integral shade between curves',
    'area-under': 'integral shade definite',
    'feasible-region': 'inequality inequalities constraint linear program lp shade',
    rectangle: 'box',
    disk: 'circle filled',
    'vertical-line': 'asymptote',
    'horizontal-line': 'asymptote',
    'line-equation': 'objective straight',
    circle: 'round',
    'level-curves': 'contour indifference isoline',
    'points-list': 'mark dot coordinates',
    intersections: 'cross root zero crossing',
    'corner-points': 'vertex vertices',
    optimum: 'maximum minimum best lp objective',
    lattice: 'integer whole numbers',
    segment: 'line',
    arrow: 'vector gradient',
    polyline: 'polygon triangle path',
    brace: 'rise run curly',
    label: 'text annotation',
    slider: 'parameter animate play',
    'data-table': 'csv markdown',
    'data-points': 'scatter',
    regression: 'fit linear trend least squares',
    'normal-distribution': 'gaussian bell',
    'binomial-distribution': 'bernoulli bars',
    probability: 'p value area shade',
    'riemann-sum': 'integral rectangles left right midpoint',
    'slope-field': 'ode differential equation direction',
    // 6.0 C
    'vector-field': 'quiver flow phase portrait ode system',
    'vector-field-particles': 'flow animation moving streamlines phase portrait',
    'rest-points': 'equilibrium equilibria fixed stationary stable saddle',
    trajectory: 'ode system orbit phase portrait solution path',
    'trajectory-3d': 'lorenz attractor ode system orbit',
    // 6.0 B
    'axis-set': 'interval sublevel set number line where below zero',
    chord: 'jensen convex secant lambda',
    // 6.0 A
    'let-definition': 'let define matrix complex function variable name',
    'vector-arrow': 'vector arrow let tip tail',
    'list-points': 'list roots unity complex polygon',
    // 6.0 D
    'transform-matrix': 'matrix linear map transformation shear rotation grid basis determinant det 3blue1brown',
    eigenvectors: 'eigenvalue eigenvector lambda matrix invariant line',
    'grid-basis': 'basis vectors i hat j hat grid lattice',
    'complex-map': 'complex function conformal z squared mapsto warp',
};

/** Menu heading per recipe section (Functions reads Surfaces in 3D charts). */
const SECTION_TITLES: Record<string, MessageKey> = {
    Functions: 'build.section.functions',
    Regions: 'build.section.regions',
    'Curves and lines': 'build.section.curves',
    Points: 'build.section.points',
    'Segments and arrows': 'build.section.segments',
    Labels: 'build.section.labels',
    Sliders: 'build.section.sliders',
    '3D': 'build.section.shapesInSpace',
    Data: 'beyond.section.data',
    Probability: 'beyond.section.probability',
    Calculus: 'beyond.section.calculus',
    Motion: 'motion6.section', // 6.0 C
    // 6.0 A
    Values: 'values.section.values',
    'Linear algebra': 'linear.section', // 6.0 D
};

/** One-click links under the starter examples: [text key, recipe id]. */
const EMPTY_LINKS_2D: [MessageKey, string][] = [
    ['build.add.region', 'feasible-region'],
    ['build.add.line', 'line-equation'],
    ['build.add.points', 'points-list'],
    ['build.add.slider', 'slider'],
];
const EMPTY_LINKS_3D: [MessageKey, string][] = [
    ['build.add.plane', 'plane'],
    ['build.add.point', 'point'],
    ['build.add.arrow', 'arrow'],
    ['build.add.slider', 'slider'],
];

type AddScope = 'all' | 'functions' | 'shapes';
type Item = FunctionParameters | Function3DParameters | Tool | Annotation;

/** Rendered example thumbnails, cloned into each empty state (failures are retried next time). */
const THUMBNAILS = new Map<string, SVGSVGElement>();

function setShown(el: HTMLElement, shown: boolean): void {
    el.toggleClass('tikz-hidden', !shown);
}

/** Tools drawn in the current dimension (the 'tools' list is shared by 2D and 3D). */
function inDimension(tool: Tool, is3D: boolean): boolean {
    if (tool.type === 'plane3D') return is3D;
    if (tool.type === 'points' || tool.type === 'segment') return (tool.dim === 3) === is3D;
    return !is3D;
}

function shortText(text: string, max = 24): string {
    const s = text.trim();
    return s.length > max ? `${s.slice(0, max - 1)}...` : s;
}

/** A text with a link after it on the same line: a space between them, none after full-width punctuation (。？). */
function beforeLink(text: string): string {
    return /[\u3000-\u303f\uff01-\uff60]$/.test(text) ? text : `${text} `;
}

/** Plot-area crop of a 2D example: curves and fills only (CSS hides the text). */
function render2DThumbnail(example: ChartExample): SVGSVGElement {
    const settings = SettingsManager.fromJSON(cloneData(example.data));
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    config.width = THUMB_PLOT_W + THUMB_PAD_X;
    config.height = THUMB_PLOT_H + THUMB_PAD_Y;
    config.title = '';
    config.showAxisLabels = false;
    const renderer = new SVGRenderer(config, { math, quality: 'draft' });
    const svg = renderer.render() as SVGSVGElement;
    const plot = renderer.layout ? renderer.layout.plot : null;
    // A 2 px margin keeps box-style axes on the plot border visible.
    if (plot) svg.setAttribute('viewBox', `${plot.x - 2} ${plot.y - 2} ${plot.w + 4} ${plot.h + 4}`);
    return svg;
}

function render3DThumbnail(example: ChartExample): SVGSVGElement | null {
    const settings = SettingsManager.fromJSON(cloneData(example.data));
    const math = settings.createMathContext();
    const config = settings.toRendererConfig(math);
    config.width = 300;
    config.height = 150;
    config.title = '';
    const renderer = new SVG3DRenderer();
    renderer.renderSvg(config, { math });
    const svg = renderer.getElement().querySelector('svg');
    if (!svg) return null;
    svg.remove();
    // Outside the renderer root the export-only SVG is not hidden by .tikz-3d-root rules; drop its class anyway.
    svg.classList.remove('tikz-3d-svg');
    return svg;
}

/**
 * 3D thumbnails: the camera leaves wide margins around the box, so once the
 * SVG is in the document, zoom its viewBox onto the drawn groups (texts are
 * display: none in tiles and do not count). The cached original keeps the
 * fitted viewBox for later clones.
 */
function fitToContent(svg: SVGSVGElement, id: string): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const g of Array.from(svg.querySelectorAll<SVGGElement>(':scope > g'))) {
        const b = g.getBBox();
        if (!(b.width > 0 && b.height > 0)) continue;
        x0 = Math.min(x0, b.x);
        y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.width);
        y1 = Math.max(y1, b.y + b.height);
    }
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return;
    const viewBox = `${x0 - 4} ${y0 - 4} ${x1 - x0 + 8} ${y1 - y0 + 8}`;
    svg.setAttribute('viewBox', viewBox);
    const cached = THUMBNAILS.get(id);
    if (cached) cached.setAttribute('viewBox', viewBox);
}

/** Thumbnail SVG for an example tile, or null when the renderers cannot draw it (the tile shows a placeholder). */
function exampleThumbnail(example: ChartExample): SVGSVGElement | null {
    let svg = THUMBNAILS.get(example.id) ?? null;
    if (!svg) {
        try {
            svg = example.is3D ? render3DThumbnail(example) : render2DThumbnail(example);
        } catch {
            svg = null;
        }
        if (!svg) return null;
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('aria-hidden', 'true');
        THUMBNAILS.set(example.id, svg);
    }
    return svg.cloneNode(true) as SVGSVGElement;
}

export function createBuildPanel(parent: HTMLElement, host: PanelHost, options: BuildPanelOptions = {}): BuildPanelHandle {
    const el = parent.createDiv({ cls: 'etz-build' });

    // ---- toolbar
    const toolbar = el.createDiv({ cls: 'etz-build-toolbar' });
    const addButton = textButton(toolbar, { text: t('common.add'), icon: 'plus', cls: 'etz-build-add' });
    pickerOn(addButton.el, 'all', 'start');

    // ---- empty state
    const emptyEl = el.createDiv({ cls: ['etz-build-empty', 'tikz-hidden'] });
    /** Mode the empty state was built for ('2d', '3d', 'polar'); null while the list shows. */
    let emptyMode: string | null = null;
    let thumbTimer: number | null = null;
    let startInput: ExprInputHandle | null = null;

    // ---- list with two sections
    const listEl = el.createDiv({ cls: 'etz-build-list' });
    const fnGroup = group(listEl, t('build.section.functions'), 'etz-build-section');
    const fnTitle = fnGroup.headerEl.querySelector<HTMLElement>('.etz-group-title');
    const fnAdd: IconButtonHandle = iconButton(fnGroup.headerEl, { icon: 'plus', label: t('build.add.function'), size: 'sm' });
    pickerOn(fnAdd.el, 'functions', 'end');
    const fnEmpty = fnGroup.body.createDiv({ cls: 'etz-build-section-empty' });
    const fnList = fnGroup.body.createDiv({ cls: 'etz-build-cards' });

    const layerGroup = group(listEl, t('build.section.shapes'), 'etz-build-section');
    const layerAdd = iconButton(layerGroup.headerEl, { icon: 'plus', label: t('build.add.shape'), size: 'sm' });
    pickerOn(layerAdd.el, 'shapes', 'end');
    const layerEmpty = layerGroup.body.createDiv({ cls: 'etz-build-section-empty' });
    const layerHint = layerGroup.body.createDiv({ cls: 'etz-build-hint', text: t('build.panel.fillsBelow') });
    const layerList = layerGroup.body.createDiv({ cls: 'etz-build-cards' });

    // ---- cards, keyed by the item objects inside settings
    const fnCards = new Map<object, FunctionCardHandle>();
    /** Tools and labels; `index` is the annotation index (-1 for tools): a moved label gets a new card. */
    const layerCards = new Map<object, { card: LayerCardHandle; index: number }>();
    const uiStates = new WeakMap<object, CardUiState>();
    /** Set while an add is in progress, so the new card is not created collapsed. */
    let adding = false;
    /** Card marked by markLive (a preview drag in progress); re-applied after rebuilds. */
    let live: { source: string; field: string | null } | null = null;
    /** Pending flash of a card: the frame that restarts the animation and the timer that ends it. */
    const flashes = new Map<HTMLElement, { frame: number | null; timer: number | null }>();

    // ------------------------------------------------------------ settings

    /** A list inside settings; a missing one is created and stored, so callers can push into it. */
    const listOf = <T>(key: string): T[] => {
        const v = host.settings.getValue<T[] | undefined>(key);
        if (Array.isArray(v)) return v;
        const fresh: T[] = [];
        host.settings.setValue(key, fresh);
        return fresh;
    };
    const functions = () => listOf<FunctionParameters>('functions');
    const surfaces = () => listOf<Function3DParameters>('functions3D');
    const tools = () => listOf<Tool>('tools');
    const annotations = () => listOf<Annotation>('annotations');
    const parameters = () => listOf<{ name: string }>('parameters');
    const fnKey = () => (host.is3D() ? 'functions3D' : 'functions');
    const fnItems = (): Array<FunctionParameters | Function3DParameters> => (host.is3D() ? surfaces() : functions());
    const visibleTools = () => tools().filter((t) => inDimension(t, host.is3D()));

    const isEmpty = () => fnItems().length === 0 && visibleTools().length === 0 && annotations().length === 0 && parameters().length === 0;

    /** Every name in the chart: new names must clash with none of them. */
    const takenNames = (): string[] => [
        ...functions().map((f) => f.name || ''),
        ...surfaces().map((s) => s.name || ''),
        ...tools().map((t) => t.name),
        ...parameters().map((p) => p.name),
    ];

    const recipeContext = (): RecipeContext => ({
        is3D: host.is3D(),
        functions: functions(),
        tools: tools(),
        parameters: listOf('parameters'),
        polar: host.isPolar(),
    });

    /** Middle of the visible view, for new labels. */
    const viewCenter = (): { x: number; y: number; z: number } => {
        try {
            const { view } = host.settings.resolveView(host.math());
            return { x: (view.xmin + view.xmax) / 2, y: (view.ymin + view.ymax) / 2, z: (view.zmin + view.zmax) / 2 };
        } catch {
            const num = (key: RangeKey) => {
                const v = Number(host.settings.getValue(key));
                return Number.isFinite(v) ? v : Number(RANGE_DEFAULTS[key]);
            };
            return {
                x: (num('xmin') + num('xmax')) / 2,
                y: (num('ymin') + num('ymax')) / 2,
                z: (num('zmin') + num('zmax')) / 2,
            };
        }
    };

    // ------------------------------------------------------------ reconcile

    /** Put `els` into `container` in this order, moving only the ones out of place. */
    const place = (container: HTMLElement, els: HTMLElement[]) => {
        els.forEach((child, i) => {
            const at = container.children[i];
            if (at !== child) container.insertBefore(child, at ?? null);
        });
    };

    const uiFor = (item: object, collapsed: boolean): CardUiState => {
        let ui = uiStates.get(item);
        if (!ui) {
            ui = { collapsed, optionsOpen: false };
            uiStates.set(item, ui);
        }
        return ui;
    };

    const notifyErrors = () => {
        if (options.onErrorsChange) options.onErrorsChange();
    };

    const createFnCard = (item: FunctionParameters | Function3DParameters, collapsed: boolean): FunctionCardHandle => {
        const actions = itemActions(item);
        const common = {
            ui: uiFor(item, collapsed),
            position: () => ({ index: fnItems().indexOf(item), count: fnItems().length }),
            onErrorChange: notifyErrors,
            onRenamed: () => reconcile(),
        };
        if (host.is3D()) {
            return createSurfaceCard(fnList, item as Function3DParameters, host, actions, {
                ...common,
                fallbackName: () => `f${surfaces().indexOf(item as Function3DParameters) + 1}`,
            });
        }
        return createFunctionCard(fnList, item as FunctionParameters, host, actions, {
            ...common,
            onAddRegion: (fn) => addRegionFor(fn),
        });
    };

    const createToolOrLabelCard = (item: Tool | Annotation, index: number, collapsed: boolean): LayerCardHandle => {
        const card =
            index < 0
                ? createLayerCard(layerList, { kind: 'tool', tool: item as Tool }, host, itemActions(item))
                : createLayerCard(layerList, { kind: 'label', index }, host, itemActions(item));
        if (collapsed && !card.hasError()) card.setCollapsed(true);
        return card;
    };

    const destroyLayer = (entry: { card: LayerCardHandle }) => {
        entry.card.destroy();
        entry.card.el.remove();
    };

    const clearCards = () => {
        fnCards.forEach((card) => card.destroy());
        fnCards.clear();
        layerCards.forEach(destroyLayer);
        layerCards.clear();
    };

    /**
     * Bring the cards in line with settings: keep cards whose item is still
     * listed (refreshing their values), drop the rest, create the missing
     * ones, and restore focus when a moved card lost it.
     */
    function reconcile(): void {
        const is3D = host.is3D();
        const active = activeDocument.activeElement instanceof HTMLElement ? activeDocument.activeElement : null;
        const empty = isEmpty();
        setShown(emptyEl, empty);
        setShown(listEl, !empty);
        if (empty) {
            clearCards();
            showEmptyState();
            return;
        }
        hideEmptyState();

        if (fnTitle) fnTitle.setText(t(is3D ? 'build.section.surfaces' : 'build.section.functions'));
        fnAdd.setLabel(t(is3D ? 'build.add.surface' : 'build.add.function'));
        layerAdd.setLabel(t(is3D ? 'build.add.shape3D' : 'build.add.shape'));

        const fns = fnItems();
        const shownTools = visibleTools();
        const labels = annotations();
        // A chart that arrives with many items (opened from a note, an example, a 2D / 3D
        // switch) starts collapsed: no card of the previous list survives.
        const survivors = fns.some((f) => fnCards.has(f)) || shownTools.some((t) => layerCards.has(t)) || labels.some((a) => layerCards.has(a));
        const fresh = !survivors && !adding;
        const collapse = fresh && fns.length + shownTools.length + labels.length > COLLAPSE_THRESHOLD;

        const keepFns = new Set<object>(fns);
        fnCards.forEach((card, key) => {
            if (keepFns.has(key)) return;
            card.destroy();
            fnCards.delete(key);
        });
        const fnEls = fns.map((item) => {
            let card = fnCards.get(item);
            if (card) card.refresh();
            else {
                card = createFnCard(item, collapse);
                // Collapsing must not hide a problem: cards with an error stay open.
                if (collapse && card.hasError()) card.setCollapsed(false);
                fnCards.set(item, card);
            }
            return card.el;
        });
        place(fnList, fnEls);

        const wanted = new Map<object, number>();
        shownTools.forEach((t) => wanted.set(t, -1));
        labels.forEach((a, i) => wanted.set(a, i));
        layerCards.forEach((entry, key) => {
            if (wanted.get(key) === entry.index) return;
            destroyLayer(entry);
            layerCards.delete(key);
        });
        const layerEls: HTMLElement[] = [];
        wanted.forEach((index, item) => {
            let entry = layerCards.get(item);
            if (entry) entry.card.refresh();
            else {
                entry = { card: createToolOrLabelCard(item as Tool | Annotation, index, collapse), index };
                layerCards.set(item, entry);
            }
            layerEls.push(entry.card.el);
        });
        place(layerList, layerEls);

        fnEmpty.empty();
        setShown(fnEmpty, fns.length === 0);
        if (fns.length === 0) {
            fnEmpty.createSpan({ text: beforeLink(t(is3D ? 'build.panel.noSurfaces' : 'build.panel.noFunctions')) });
            const recipe = recipeById(is3D ? 'surface' : 'function');
            if (recipe) textButton(fnEmpty, { text: t(is3D ? 'build.add.aSurface' : 'build.add.aFunction'), variant: 'link', onClick: () => applyRecipe(recipe) });
        }
        setShown(layerEmpty, layerEls.length === 0);
        layerEmpty.setText(t(is3D ? 'build.panel.layersEmpty3D' : 'build.panel.layersEmpty'));
        setShown(layerHint, !is3D && shownTools.some((t) => t.type === 'region') && layerEls.length > 1);

        // Moving a card re-inserts its element, which drops focus inside it.
        if (active && active.isConnected && activeDocument.activeElement !== active && el.contains(active)) {
            active.focus({ preventScroll: true });
        }
        // A rebuilt card keeps the drag marks.
        if (live) applyLive(live);
    }

    // ------------------------------------------------- preview drag sync

    /** The card of an item by source: function name, tool name or 'label:<index>'. */
    function cardFor(source: string): FunctionCardHandle | LayerCardHandle | null {
        for (const card of fnCards.values()) if (card.name() === source) return card;
        const label = /^label:(\d+)$/.exec(source);
        for (const entry of layerCards.values()) {
            const item = entry.card.item;
            const match = label ? item.kind === 'label' && item.index === Number(label[1]) : item.kind === 'tool' && item.tool.name === source;
            if (match) return entry.card;
        }
        return null;
    }

    /** Cards take '' as "the card, no field" (their null clears). */
    function applyLive(mark: { source: string; field: string | null }): void {
        const card = cardFor(mark.source);
        if (card && card.markLive) card.markLive(mark.field ?? '');
    }

    function markLive(source: string | null, field: string | null): void {
        if (live) {
            const old = cardFor(live.source);
            if (old && old.markLive) old.markLive(null);
        }
        live = source === null ? null : { source, field };
        if (live) applyLive(live);
    }

    function syncItem(source: string): void {
        const card = cardFor(source);
        if (!card) return;
        if (card.syncLive) card.syncLive();
        else card.refresh();
    }

    /** Scroll a card into view and play its 600 ms outline (CSS .is-canvas-flash); focus stays put. */
    function flash(source: string): void {
        const card = cardFor(source);
        if (!card) return;
        const cardEl = card.el;
        cardEl.scrollIntoView({ block: 'nearest' });
        const pending = flashes.get(cardEl);
        if (pending) {
            if (pending.frame !== null) window.cancelAnimationFrame(pending.frame);
            if (pending.timer !== null) window.clearTimeout(pending.timer);
        }
        cardEl.removeClass('is-canvas-flash');
        const state: { frame: number | null; timer: number | null } = { frame: null, timer: null };
        flashes.set(cardEl, state);
        // Adding the class a frame after removing it restarts the animation of a repeated flash.
        state.frame = window.requestAnimationFrame(() => {
            state.frame = null;
            cardEl.addClass('is-canvas-flash');
            state.timer = window.setTimeout(() => {
                cardEl.removeClass('is-canvas-flash');
                if (flashes.get(cardEl) === state) flashes.delete(cardEl);
            }, FLASH_MS);
        });
    }

    // ---------------------------------------------------------- empty state

    function hideEmptyState(): void {
        if (emptyMode === null) return;
        emptyMode = null;
        if (thumbTimer !== null) window.clearTimeout(thumbTimer);
        thumbTimer = null;
        if (startInput) startInput.destroy();
        startInput = null;
        emptyEl.empty();
    }

    /** Built once per mode, so refresh() calls while it shows keep the typed text and focus. */
    function showEmptyState(): void {
        const is3D = host.is3D();
        const mode = is3D ? '3d' : host.isPolar() ? 'polar' : '2d';
        if (emptyMode === mode) return;
        hideEmptyState();
        emptyMode = mode;

        emptyEl.createDiv({ cls: 'etz-build-empty-title', text: t('build.empty.title'), attr: { role: 'heading', 'aria-level': '2' } });
        const placeholder = is3D
            ? t('build.empty.placeholder3D')
            : mode === 'polar'
              ? t('build.empty.placeholderPolar')
              : // An example that sits inside the default view (the Help's Quick start uses the same one).
                t('build.empty.placeholder');
        const start = exprInput(emptyEl, {
            value: '',
            label: t(is3D ? 'build.empty.label3D' : 'build.empty.label'),
            placeholder,
            cls: 'etz-build-start',
            validate: (src): ValidateResult => {
                if (!src.trim()) return { ok: true };
                return is3D ? host.math().validate(src, 'fn2') : host.math().validate(src, 'fn1', mode === 'polar' ? 'polar' : 'cartesian');
            },
            onInput: () => undefined,
            onEnter: (v) => {
                if (v.trim()) addFromStart(v.trim());
            },
            // 'Add slider k' (or 'Use k*x, add slider k'): create the slider and the function in one go.
            onAddParameter: (name) => {
                host.addParameter(name);
                const v = start.getValue().trim();
                if (v) addFromStart(v);
                else reconcile();
            },
        });
        startInput = start;
        emptyEl.createDiv({ cls: 'etz-build-hint', text: t('build.empty.hint') });

        emptyEl.createDiv({ cls: 'etz-build-empty-sub', text: t('build.empty.examples') });
        const grid = emptyEl.createDiv({ cls: 'etz-build-examples' });
        // Examples of the current mode first; the others switch the chart to their mode.
        // The Showcase charts (5.2) first: parts that follow each other.
        const all: ChartExample[] = [...showcaseExamples(), ...EXAMPLES];
        const examples = [...all.filter((e) => e.is3D === is3D), ...all.filter((e) => e.is3D !== is3D)];
        const thumbs: Array<[HTMLElement, ChartExample]> = [];
        for (const example of examples) {
            const tile = grid.createEl('button', { cls: 'etz-build-example', attr: { type: 'button' } });
            const thumb = tile.createDiv({ cls: 'etz-build-thumb', attr: { 'aria-hidden': 'true' } });
            const title = tile.createDiv({ cls: 'etz-build-example-title', text: example.title });
            if (example.is3D) title.createSpan({ cls: 'etz-build-example-tag', text: '3D' });
            tile.createDiv({ cls: 'etz-build-example-desc', text: example.description });
            tile.addEventListener('click', () => host.loadChart(cloneData(example.data)));
            thumbs.push([thumb, example]);
        }

        const links = emptyEl.createDiv({ cls: 'etz-build-empty-links' });
        (is3D ? EMPTY_LINKS_3D : EMPTY_LINKS_2D).forEach(([text, id], i) => {
            if (i > 0) links.createSpan({ cls: 'etz-build-dot', text: '·', attr: { 'aria-hidden': 'true' } });
            textButton(links, {
                text: t(text),
                variant: 'link',
                onClick: () => {
                    const recipe = recipeById(id);
                    if (recipe) applyRecipe(recipe);
                },
            });
        });

        // Thumbnails render one per task after the panel is on screen (cached for the session).
        const step = () => {
            thumbTimer = null;
            const next = thumbs.shift();
            if (!next || !next[0].isConnected) return;
            const svg = exampleThumbnail(next[1]);
            if (svg) {
                next[0].appendChild(svg);
                if (next[1].is3D) fitToContent(svg, next[1].id);
            } else next[0].addClass('is-fallback');
            if (thumbs.length) thumbTimer = window.setTimeout(step, 0);
        };
        thumbTimer = window.setTimeout(step, 0);

        // Autofocus, unless the user is busy with a control outside the panel (2D / 3D switch).
        // An empty state built while the editor opens always takes the focus: what holds it then
        // is the button Obsidian focused for the new modal, not a choice of the user.
        const opening = options.opening ? options.opening() : false;
        window.setTimeout(() => {
            const a = activeDocument.activeElement;
            const idle = opening || !a || a === activeDocument.body || el.contains(a) || a.matches('.modal, .modal-container, .modal-content');
            if (idle && start.input.isConnected) start.input.focus();
        }, 0);
    }

    /** Enter in the empty state's formula field: the first function (or surface) with that formula. */
    function addFromStart(expression: string): void {
        const recipe = recipeById(host.is3D() ? 'surface' : 'function');
        if (!recipe) return;
        const result = recipe.build(recipeContext());
        if (result.kind !== 'function') return;
        result.fn.expression = expression;
        if (result.surface) result.surface.expression = expression;
        addRecipeResult(result.fn, result.surface);
        if (options.onStartAdded) options.onStartAdded();
    }

    // -------------------------------------------------------- add / remove

    function recipeById(id: string): Recipe | null {
        return recipes(host.is3D()).find((r) => r.id === id) ?? null;
    }

    /** Structural change: rebuild the affected cards, then let the modal re-validate and re-render. */
    function afterStructural(): void {
        reconcile();
        host.commit();
        notifyErrors();
    }

    /** Expand, scroll to and focus `field` (default: the first input) of a freshly added card; `selectText` is selected in it. */
    function revealNew(item: object, field?: string, selectText?: string): void {
        const fnCard = fnCards.get(item);
        if (fnCard) {
            fnCard.reveal(field, selectText);
            return;
        }
        const entry = layerCards.get(item);
        if (!entry) return;
        entry.card.reveal(field, selectText);
        if (!entry.card.el.contains(activeDocument.activeElement)) {
            const first = entry.card.el.querySelector<HTMLElement>('.etz-card-body input:not([disabled]), .etz-card-body textarea, .etz-card-body select');
            if (first) first.focus();
        }
        entry.card.el.scrollIntoView({ block: 'nearest' });
        // A card taller than the panel scrolls by its edge: keep the focused field itself in view.
        const focused = activeDocument.activeElement;
        if (focused instanceof HTMLElement && entry.card.el.contains(focused)) focused.scrollIntoView({ block: 'nearest' });
    }

    /** Focus a card's header (after a delete or move), or the Add button when there is none. */
    function focusHeader(item: object | null): void {
        const fnCard = item ? fnCards.get(item) : undefined;
        if (fnCard) {
            fnCard.focusHeader();
            return;
        }
        const entry = item ? layerCards.get(item) : undefined;
        const header = entry ? entry.card.el.querySelector<HTMLElement>('.etz-card-summary, button, [tabindex="0"]') : null;
        if (header) header.focus();
        else if (addButton.el.isConnected) addButton.el.focus();
    }

    function insert<T>(list: T[], item: T, at: number): void {
        list.splice(Math.max(0, Math.min(at, list.length)), 0, item);
    }

    function addRecipeResult(fn: FunctionParameters, surface?: Function3DParameters): void {
        let item: FunctionParameters | Function3DParameters;
        if (host.is3D()) {
            const s: Function3DParameters = surface ?? {
                expression: fn.expression,
                xDomain: '',
                yDomain: '',
                color: fn.color,
                wireframe: false,
                opacity: 0.7,
                samples: 40,
            };
            // Surfaces are not part of the 2D name space, so give them a name no other item uses.
            if (!s.name || takenNames().includes(s.name)) s.name = nextFunctionName(takenNames());
            surfaces().push(s);
            item = s;
        } else {
            functions().push(fn);
            item = fn;
        }
        addItem(item);
    }

    /** Common tail of every add: build the card expanded, commit, focus its first field. */
    function addItem(item: object): void {
        adding = true;
        try {
            afterStructural();
        } finally {
            adding = false;
        }
        revealNew(item);
    }

    function applyRecipe(recipe: Recipe): void {
        const result = recipe.build(recipeContext());
        switch (result.kind) {
            case 'function':
                addRecipeResult(result.fn, result.surface);
                options.onStartAdded?.();
                return;
            case 'tool':
                tools().push(result.tool);
                addItem(result.tool);
                options.onStartAdded?.();
                return;
            case 'items': {
                if (result.parameters && result.parameters.length) {
                    const params = host.settings.getValue<Parameter[] | undefined>('parameters');
                    host.settings.setValue('parameters', [...(Array.isArray(params) ? params : []), ...result.parameters]);
                }
                for (const fn of result.functions ?? []) functions().push(fn);
                for (const tool of result.tools) tools().push(tool);
                const shown = result.tools[result.reveal ?? 0] ?? result.tools[0] ?? (result.functions ?? [])[0];
                if (shown) addItem(shown);
                options.onStartAdded?.();
                return;
            }
            case 'label': {
                const c = viewCenter();
                const label: Annotation = {
                    x: fmtNum(c.x),
                    y: fmtNum(c.y),
                    // Chart data, written into the note and the TikZ code: stays English like the examples.
                    text: 'Label',
                    color: 'black',
                    size: 'normal',
                    anchor: 'center',
                };
                if (host.is3D()) label.z = fmtNum(c.z);
                annotations().push(label);
                addItem(label);
                return;
            }
            case 'parameter': {
                // Sliders live in the dock under the preview; the host adds and commits.
                host.addParameter(result.parameter.name, result.parameter.value);
                reconcile();
                // An empty-state link that started this is gone now: keep focus in the panel.
                const a = activeDocument.activeElement;
                if (!a || a === activeDocument.body) addButton.el.focus();
                return;
            }
        }
    }

    /** A function from a built-in or saved template. */
    function applyTemplate(template: { expression: string; domain?: string; xDomain?: string; yDomain?: string; color?: string }): void {
        const recipe = recipeById(host.is3D() ? 'surface' : 'function');
        if (!recipe) return;
        const result = recipe.build(recipeContext());
        if (result.kind !== 'function') return;
        result.fn.expression = template.expression;
        result.fn.domain = template.domain ?? '';
        if (template.color) result.fn.color = template.color;
        if (result.surface) {
            result.surface.expression = template.expression;
            result.surface.xDomain = template.xDomain ?? result.surface.xDomain;
            result.surface.yDomain = template.yDomain ?? result.surface.yDomain;
            if (template.color) result.surface.color = template.color;
        }
        addRecipeResult(result.fn, result.surface);
        options.onStartAdded?.();
    }

    /**
     * 'Shade between two curves instead? Add region' on a function's fill:
     * a region between this function and the next callable one (or the
     * x-axis) over the function's domain, in its colour. The function's own
     * fill is switched off, the region replaces it.
     */
    function addRegionFor(fn: FunctionParameters): void {
        const recipe = recipeById('area-between');
        const self = fn.name;
        if (!recipe || !self) return;
        const result = recipe.build(recipeContext());
        if (result.kind !== 'tool' || result.tool.type !== 'region') return;
        const region = result.tool;
        let callable: string[] = [];
        try {
            callable = host.math().callableNames();
        } catch {
            callable = functions().filter((f) => !f.parametric && f.name).map((f) => f.name as string);
        }
        const other = callable.find((n) => n !== self);
        const conditions = [other ? `${other} <= y <= ${self}` : `min(${self}, 0) <= y <= max(${self}, 0)`];
        const domain = fn.domain.trim();
        const colon = domain.indexOf(':');
        if (colon > 0 && colon === domain.lastIndexOf(':') && !domain.includes('?')) {
            conditions.push(`${domain.slice(0, colon).trim()} <= x <= ${domain.slice(colon + 1).trim()}`);
        }
        region.conditions = conditions;
        region.conditionLabels = conditions.map(() => '');
        region.color = fn.color;
        region.fillOpacity = fn.fillOpacity;
        region.fillPattern = fn.fillPattern;
        fn.fill = false;
        tools().push(region);
        addItem(region);
    }

    /** Remove / duplicate / move for any listed item, plus the layer cards' error and reveal hooks. */
    function itemActions(item: Item): LayerCardActions {
        return {
            remove: () => removeItem(item),
            duplicate: () => duplicateItem(item),
            moveUp: () => moveItem(item, -1),
            moveDown: () => moveItem(item, 1),
            onErrorChange: notifyErrors,
            // The card has committed already, so reconcile has built the new card.
            revealAdded: (added, field, selectText) => revealNew(added, field, selectText),
        };
    }

    /** The settings list holding `item`, and the "Deleted ..." message for it. */
    function locate(item: Item): { key: string; list: Item[]; deleted: string } | null {
        const fns = fnItems() as Item[];
        if (fns.includes(item)) {
            const name = (item as FunctionParameters).name || fnCards.get(item)?.name();
            return { key: fnKey(), list: fns, deleted: name ? t('build.panel.deleted', { name }) : t('build.panel.deletedFunction') };
        }
        const ts = tools() as Item[];
        if (ts.includes(item)) return { key: 'tools', list: ts, deleted: t('build.panel.deleted', { name: (item as Tool).name }) };
        const labels = annotations() as Item[];
        if (labels.includes(item)) {
            const text = shortText((item as Annotation).text);
            return { key: 'annotations', list: labels, deleted: text ? t('build.panel.deletedLabel', { text }) : t('build.panel.deletedEmptyLabel') };
        }
        return null;
    }

    /** Cards in display order, for picking the neighbour that gets focus after a delete. */
    function displayOrder(): object[] {
        return [...fnItems(), ...visibleTools(), ...annotations()];
    }

    function removeItem(item: Item): void {
        const where = locate(item);
        if (!where) return;
        const order = displayOrder();
        const pos = order.indexOf(item);
        const next = order[pos + 1] ?? order[pos - 1] ?? null;
        const index = where.list.indexOf(item);
        where.list.splice(index, 1);
        afterStructural();
        focusHeader(next);
        host.showUndo(where.deleted, () => {
            insert(listOf<Item>(where.key), item, index);
            afterStructural();
            focusHeader(item);
        });
    }

    function duplicateItem(item: Item): void {
        const where = locate(item);
        if (!where) return;
        const copy = JSON.parse(JSON.stringify(item)) as typeof item;
        if (where.key === 'tools') {
            const tool = copy as Tool;
            const ids = new Set(tools().map((t) => t.id));
            let id = newId();
            while (ids.has(id)) id = newId();
            tool.id = id;
            tool.name = nextToolName(tool.type, takenNames());
        } else if (where.key !== 'annotations') {
            (copy as FunctionParameters | Function3DParameters).name = nextFunctionName(takenNames());
        }
        insert(where.list, copy, where.list.indexOf(item) + 1);
        addItem(copy);
    }

    /** Swap with the neighbour in display order (tools of the other dimension keep their places). */
    function moveItem(item: Item, dir: -1 | 1): void {
        const where = locate(item);
        if (!where) return;
        const shown = where.key === 'tools' ? (visibleTools() as Item[]) : where.list;
        const i = shown.indexOf(item);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= shown.length) return;
        const a = where.list.indexOf(item);
        const b = where.list.indexOf(shown[j]);
        where.list[a] = shown[j];
        where.list[b] = item;
        afterStructural();
        // Labels are keyed by index, so a moved label has a new card: give its header the focus.
        const entry = layerCards.get(item);
        const card = fnCards.get(item)?.el ?? entry?.card.el;
        if (card && !card.contains(activeDocument.activeElement)) focusHeader(item);
    }

    // ------------------------------------------------------------- menus

    /**
     * What the + Add picker offers: the recipes of the chart's dimension by
     * section, and the templates (built-in and saved) as a group of their own.
     * 'functions' and 'shapes' are the per-section + buttons; 'all' is the
     * toolbar's Add button.
     */
    function pickerContent(scope: AddScope): PickerContent {
        const is3D = host.is3D();
        const ctx = recipeContext();
        const groups: PickerGroup[] = [];
        const items: PickerItem[] = [];
        const heading = (section: string) => {
            if (section === 'Functions' && is3D) return t('build.section.surfaces');
            const title = SECTION_TITLES[section];
            return title ? t(title) : section;
        };
        for (const r of recipes(is3D)) {
            if (!r.available(ctx)) continue;
            const isFunction = r.section === 'Functions';
            if (scope === 'functions' && !isFunction) continue;
            if (scope === 'shapes' && (isFunction || r.section === 'Sliders')) continue;
            const icon = SECTION_ICONS[r.section] ?? 'plus';
            if (!groups.some((g) => g.id === r.section)) groups.push({ id: r.section, title: heading(r.section), icon });
            items.push({ label: r.label, hint: r.hint, icon, group: r.section, words: RECIPE_WORDS[r.id], run: () => applyRecipe(r) });
        }
        if (scope !== 'shapes') {
            const saved = (host.plugin && Array.isArray(host.plugin.data.userTemplates) ? host.plugin.data.userTemplates : []).filter(
                (template) => !!template.is3D === is3D,
            );
            const builtIn = is3D ? BUILT_IN_3D : BUILT_IN_2D;
            if (builtIn.length || saved.length) groups.push({ id: 'Templates', title: t('build.picker.templates'), icon: 'bookmark' });
            for (const template of builtIn) {
                items.push({
                    label: t('build.menu.template', { name: template.name, expression: template.expression }),
                    hint: t('build.menu.builtIn'),
                    icon: is3D ? 'box' : 'line-chart',
                    group: 'Templates',
                    words: 'template example',
                    run: () => applyTemplate(template),
                });
            }
            for (const template of saved) {
                items.push({
                    label: t('build.menu.template', { name: template.name, expression: template.expression }),
                    hint: t('build.menu.saved'),
                    icon: 'bookmark',
                    group: 'Templates',
                    words: 'template saved',
                    run: () => applyTemplate(template),
                });
            }
        }
        return { groups, items };
    }

    /** The + Add picker on a button: Escape closes it, not the editor. */
    function pickerOn(button: HTMLElement, scope: AddScope, align: 'start' | 'end'): void {
        addPicker(button, () => pickerContent(scope), { trapEscape: (onEscape) => trapEscape(host, onEscape), align });
    }

    // ------------------------------------------------------------- handle

    reconcile();

    return {
        el,
        refresh: reconcile,
        syncAnnotation: (index) => {
            layerCards.forEach((entry) => {
                if (entry.index === index) entry.card.refresh();
            });
        },
        reveal: (source, field, selectText) => {
            for (const card of fnCards.values()) {
                if (card.name() !== source) continue;
                host.showTab('build');
                card.reveal(field, selectText);
                return true;
            }
            const label = /^label:(\d+)$/.exec(source);
            for (const entry of layerCards.values()) {
                const item = entry.card.item;
                const match = label ? item.kind === 'label' && item.index === Number(label[1]) : item.kind === 'tool' && item.tool.name === source;
                if (!match) continue;
                host.showTab('build');
                entry.card.reveal(field, selectText);
                return true;
            }
            return false;
        },
        hasErrors: () => {
            for (const card of fnCards.values()) if (card.hasError()) return true;
            for (const entry of layerCards.values()) if (entry.card.hasError()) return true;
            return false;
        },
        setIssues: (issues) => {
            layerCards.forEach((entry) => {
                if (entry.card.setIssues) entry.card.setIssues(issues);
            });
        },
        syncItem,
        markLive,
        flash,
    };
}
