import { App, MarkdownView, Menu, Modal, Notice, Platform, TFile, loadMathJax } from 'obsidian';
import { cloneData, errorText, fitPixelScale, niceInterval } from './util';
import { exportableSvg, svgToPng } from './svgExport';
import { issueText, mergeViewErrors } from './issues';
import { Annotation, Function3DParameters, FunctionParameters, Parameter, RendererConfig, Tool } from './types';
import { RANGE_DEFAULTS, RangeKey, SettingsManager } from './settings';
import { RenderLayout, SVGRenderer } from './renderer';
import { MATH_REDRAW_LIMIT } from './mathlabel';
import { SVG3DRenderer } from './renderer3d';
import { MathContext, renameIdentifier, renameToolReferences } from './mathcontext';
import { SceneCache, SceneIssue } from './scene';
import { View } from './geometry';
import { EXAMPLES, defaultParameter } from './migrate';
import type { ChartDraft } from './templates';
import type { BlockFormat } from './blockjson';
import { isChartText } from './text/parse';
import { printChartText, writeChartText } from './text/print';
import { PopIn, drawnNames, reducedMotion } from './motion';
import { FieldHandle, PanelHost, PluginHost } from './ui/host';
import type {
    Chip,
    DragCommit,
    DragContext,
    DragFrame,
    DragTarget,
    FieldEdit,
    FieldRef,
    Gesture,
    Hit,
    HitIndex,
    HitShape,
    HitTolerance,
    Lock,
    MakeSliderOffer,
    Mods,
    ParamEdit,
    Pt,
    ScreenMap,
} from './drag/types';
import { buildHitIndex } from './drag/hits';
import { axisSliders, fieldText, refKey, resolveTarget, setFieldText } from './drag/targets';
import { DragSession, PreparedDrag, nudge, prepareDrag, preparedServes } from './drag/session';
import {
    CHART_LABEL,
    MAKE_SLIDER_BUTTON,
    TOGGLE_LABEL,
    UNDO_BUTTON,
    joinNames,
    lockChip,
    lockFor,
    madeSliderText,
    selectAnnouncement,
    staleText,
    tipChip,
} from './drag/describe';
import { EditHistory, HistoryEntry, PatchIO, patchEntry } from './drag/history';
import { makeSliderEdit } from './drag/numbers';
import { DragHintHandle, DragLayerHandle, createDragHint, createDragLayer } from './ui/dragLayer';
import { BuildPanelHandle, createBuildPanel } from './ui/buildPanel';
import { HelpPanelHandle, createHelpPanel } from './ui/helpPanel';
import { AiPanelHandle, createAiPanel } from './ui/aiPanel';
import { SlidersDockHandle, createSlidersDock } from './ui/slidersDock';
import { ChartPanelHandle, createChartPanel } from './ui/chartPanel';
import { CodePanelHandle, createCodePanel } from './ui/codePanel';
import {
    BannerHandle,
    IconButtonHandle,
    SegmentedHandle,
    TextButtonHandle,
    banner,
    closeAllPopovers,
    confirmDialog,
    formatDecimals,
    iconButton,
    menuFromButton,
    segmented,
    textButton,
    trapEscape,
    uniqueId,
    visuallyHidden,
} from './ui/kit';

/**
 * Optional state passed when the modal is opened by clicking an
 * already-rendered easy-tikz block: pre-fills the SettingsManager and
 * remembers the source location so "Insert into note" can replace the
 * block in place instead of inserting at the cursor.
 */
export interface TikzModalInitialState {
    data: Record<string, unknown>;
    sourceFile?: TFile | null;
    originalBlockText?: string;
    /** Either 'easy-tikz' (default emit) or 'tikz' (when re-rendering an existing tikz-tagged block). */
    fenceTag?: 'easy-tikz' | 'tikz';
    /** How the block writes the chart; Save keeps it. */
    blockFormat?: BlockFormat;
}

/** The body of a fenced block as originalBlockText holds it. */
function blockBody(block: string): string {
    const start = block.indexOf('\n') + 1;
    const end = block.lastIndexOf('\n```');
    return end >= start ? block.slice(start, end) : '';
}

type TabId = 'build' | 'chart' | 'code' | 'help' | 'ai';

const TABS: Array<{ id: TabId; label: string }> = [
    { id: 'build', label: 'Build' },
    { id: 'chart', label: 'Chart' },
    { id: 'code', label: 'Code' },
    { id: 'help', label: 'Help' },
    { id: 'ai', label: 'AI' },
];

/** Typing: full render this long after the last keystroke. */
const UPDATE_DEBOUNCE_MS = 50;
/** Sliders and drags: full-quality render this long after the last draft frame request. */
const FULL_RENDER_DELAY_MS = 150;
/** The Code tab regenerates this long after the last full render (the exporter is heavier than the preview). */
const CODE_REFRESH_DELAY_MS = 300;
/** The status chip shows new problems only after this much quiet (half-typed input never flashes). */
const STATUS_IDLE_MS = 600;
/** Transient status messages ("Nothing to fit yet") stay this long. */
const FLASH_MS = 4000;
const AUTOSAVE_DELAY_MS = 1000;
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const UNDO_VISIBLE_MS = 6000;
const COPIED_LABEL_MS = 2000;
/**
 * Stacked layout (preview above the editor): always below STACK_WIDTH of
 * modal width, where the preview column beside the 400 px editor (and the
 * sliders dock under it) would be under 300 px wide and the dock's rows no
 * longer fit; below NARROW_WIDTH only when the modal is portrait-like
 * (taller than STACK_ASPECT x its width). Landscape windows keep the editor
 * at full height, as 3.x did: stacking them leaves only a few input rows.
 */
const STACK_WIDTH = 700;
const NARROW_WIDTH = 900;
const STACK_ASPECT = 0.8;

/**
 * Mouse drag rate: 1 pixel of horizontal drag rotates azimuth by 0.5 degrees,
 * 1 pixel of vertical drag tilts elevation by 0.3 degrees. Slightly lower
 * vertical sensitivity keeps elevation changes feeling proportional to the
 * shallower 0..90 range.
 */
const AZIMUTH_DRAG_RATE = 0.5;
const ELEVATION_DRAG_RATE = 0.3;
/** Step size for keyboard rotation when the preview has focus. */
const KEYBOARD_ROTATION_STEP = 5;
/** Arrow keys pan the 2D view by this fraction of the visible range. */
const KEYBOARD_PAN_FRACTION = 0.05;
/** Wheel zoom factor per WHEEL_PIXELS_PER_STEP of wheel delta. > 1 zooms out, < 1 zooms in. */
const WHEEL_ZOOM_FACTOR = 1.15;
/** Wheel pixels that make one WHEEL_ZOOM_FACTOR step: one classic mouse notch. */
const WHEEL_PIXELS_PER_STEP = 100;
/** Pixels per wheel delta unit in line mode (Firefox, some mice) and page mode. */
const WHEEL_LINE_PIXELS = 16;
const WHEEL_PAGE_PIXELS = 400;
/** Trackpad pinch arrives as ctrlKey wheel events with deltas of a few pixels; this makes it feel like a pinch. */
const PINCH_WHEEL_BOOST = 10;
/** One wheel event zooms by at most WHEEL_ZOOM_FACTOR ^ WHEEL_MAX_STEPS (about 1.5x). */
const WHEEL_MAX_STEPS = 3;
const ZOOM_3D_STEP = 1.25;
const ZOOM_3D_MIN = 0.3;
const ZOOM_3D_MAX = 4;
/** Fit samples per function / per surface axis. */
const FIT_SAMPLES = 400;
const FIT_SAMPLES_3D = 30;

// ---- drag to edit (SPEC3 1.2 to 1.12)
/** A press becomes an object drag after this much movement (CSS px): mouse and pen, touch. */
const PRESS_THRESHOLD_PX = 3;
const PRESS_THRESHOLD_TOUCH_PX = 8;
/** Hit tolerances in CSS px (SPEC3 1.12). */
const TOLERANCE_MOUSE: HitTolerance = { line: 6, point: 9 };
const TOLERANCE_TOUCH: HitTolerance = { line: 14, point: 16 };
/** The hover chip appears after this much dwell on the same target (no flicker while passing over lines). */
const HOVER_DWELL_MS = 120;
/** A hover plan is reused while the pointer stays this close (CSS px) to the point it was planned at. */
const HOVER_REPLAN_PX = 24;
/** A press reuses the hover plan only when it grabs (almost) the same point. */
const PRESS_REUSE_PX = 1;
/** Lock chip after a click on a computed point. */
const LOCK_CHIP_MS = 2000;
/** First-hover tip (SPEC3 1.12). */
const TIP_MS = 5000;
/** Arrow-key presses this close together form one undo step; the step commits this long after the last press. */
const KEY_SESSION_MS = 1000;
/** Screen-reader announcements are debounced by this much. */
const ANNOUNCE_DELAY_MS = 500;
const HISTORY_SIZE = 50;
/** Cursor classes on .etz-chart owned by the drag code (exactly one at a time). */
const CURSOR_CLASSES = ['is-over-object', 'is-over-object-ns', 'is-over-object-ew', 'is-dragging-object', 'is-space-pan'] as const;
type CursorClass = (typeof CURSOR_CLASSES)[number];

type DragState =
    | { kind: 'pan'; pointerId: number; startX: number; startY: number; view: View; plot: RenderLayout['plot']; scale: number; panX: boolean; panY: boolean }
    | { kind: 'rotate'; pointerId: number; startX: number; startY: number; azimuth: number; elevation: number }
    /** Pointer down on a draggable target: nothing changes until the pointer moves past the threshold. */
    | { kind: 'press'; pointerId: number; startX: number; startY: number; touch: boolean; target: DragTarget; grab: Pt; prepared: PreparedDrag | null }
    /**
     * A DragSession is running (SPEC3 1.2). `mods` are the ones of the last update (Shift / Alt key changes
     * re-run it); `offset` (math) is the grab point minus the press point, added to every pointer position
     * so the grabbed point moves by the pointer's motion (a press 5 px off a line never jumps onto it).
     */
    | { kind: 'object'; pointerId: number; touch: boolean; session: DragSession; lastX: number; lastY: number; releaseEscape: () => void; mods: Mods; cursor: Pt; offset: Pt };

/**
 * A press that did not start an object drag (pan path): released without
 * moving it is a click. On a locked target the click shows the lock chip;
 * a touch tap on a draggable target selects it; on empty space it clears
 * the selection.
 */
interface PendingClick {
    pointerId: number;
    startX: number;
    startY: number;
    touch: boolean;
    moved: boolean;
    lock: Lock | null;
    tap: { target: DragTarget; grab: Pt } | null;
}

/** What is under the pointer, resolved for dragging. */
interface Found {
    target: DragTarget;
    grab: Pt;
    /** Hit shape key (plus the passed marker), or 'label:<i>': re-resolve only when it changes. */
    hitKey: string;
}

/** Number of CSS px between two math points under `map`. */
function distPx(a: Pt, b: Pt, map: ScreenMap): number {
    return Math.hypot((a.x - b.x) * map.kx, (a.y - b.y) * map.ky);
}

/** Nearest point (CSS px metric) of a hit shape to `p`, and the index of its run (-1 for a point). */
function nearestOnShape(shape: HitShape, p: Pt, map: ScreenMap): { at: Pt; run: number } {
    let best = { at: shape.point ?? p, run: -1, d: Infinity };
    const px = p.x * map.kx;
    const py = p.y * map.ky;
    shape.lines.forEach((line, run) => {
        for (let i = 0; i < line.length; i++) {
            const a = line[i];
            const b = line[i + 1] ?? a;
            const ax = a.x * map.kx;
            const ay = a.y * map.ky;
            const dx = b.x * map.kx - ax;
            const dy = b.y * map.ky - ay;
            const len2 = dx * dx + dy * dy;
            const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
            const qx = ax + t * dx;
            const qy = ay + t * dy;
            const d = Math.hypot(px - qx, py - qy);
            if (Number.isFinite(d) && d < best.d) best = { at: { x: qx / map.kx, y: qy / map.ky }, run, d };
        }
    });
    return { at: best.at, run: best.run };
}

/** Smallest 1, 2 or 5 times a power of ten that is at least `x` (> 0). */
function niceCeil(x: number): number {
    const mag = Math.pow(10, Math.floor(Math.log10(x)));
    for (const m of [1, 2, 5, 10]) if (m * mag >= x * (1 - 1e-12)) return m * mag;
    return 10 * mag;
}

/** The 1, 2 or 5 times a power of ten nearest to `x` (> 0). */
function nearest125(x: number): number {
    const mag = Math.pow(10, Math.floor(Math.log10(x)));
    let best = mag;
    for (const m of [1, 2, 5, 10]) if (Math.abs(m * mag - x) < Math.abs(best - x)) best = m * mag;
    return best;
}

/** One step smaller on the 1-2-5 ladder (0.2 -> 0.1 -> 0.05). */
function smaller125(step: number): number {
    const mag = Math.pow(10, Math.floor(Math.log10(step) + 1e-9));
    const m = Math.round(step / mag);
    return m >= 5 ? 2 * mag : m >= 2 ? mag : 0.5 * mag;
}

/**
 * Range and step of a slider made from the dragged number `v` (SPEC3 1.11):
 * [0, nice(2v)] for v > 0, [nice(2v), 0] for v < 0, [-1, 1] for 0, the step
 * the 1-2-5 value nearest span / 100, made finer until `v` lies on the grid
 * (the slider must start exactly at the written number).
 */
function sliderRangeFor(v: number): { min: number; max: number; step: number } {
    const min = v > 0 ? 0 : v < 0 ? -niceCeil(-2 * v) : -1;
    const max = v > 0 ? niceCeil(2 * v) : v < 0 ? 0 : 1;
    let step = nearest125((max - min) / 100);
    const onGrid = (s: number) => Math.abs((v - min) / s - Math.round((v - min) / s)) < 1e-6;
    for (let i = 0; i < 12 && !onGrid(step); i++) step = smaller125(step);
    return { min, max, step };
}

/** The number written in a token span: '6.6', '-2', '(-2)', a unicode minus. Null when it is not a plain number. */
function tokenValue(text: string): number | null {
    let t = text.trim().replace(/\u2212/g, '-');
    while (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1).trim();
    if (!/^[-+]?\s*(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(t)) return null;
    const v = Number(t.replace(/\s+/g, ''));
    return Number.isFinite(v) ? v : null;
}

/** 'Moved R1 (2)' -> 'R1 (2)', 'Deleted R1' -> 'R1': the subject of an undo label, for the stale messages. */
function labelSubject(label: string): string {
    const at = label.indexOf(' ');
    return at > 0 ? label.slice(at + 1) : label;
}

/** Focus is in a text field, where Mod+Z belongs to the browser's own text undo. */
function isTextEditing(el: Element | null): boolean {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    // A focused range slider (the dock) or button leaves Mod+Z to the chart history.
    if (el.tagName === 'INPUT') return ['text', 'search', 'number', 'email', 'url', 'tel', 'password', ''].includes((el as HTMLInputElement).type);
    return (el as HTMLElement).isContentEditable === true;
}

/**
 * Trim the top and bottom percentile of the values then return min/max.
 * Keeps vertical asymptotes from blowing out auto-fit ranges.
 */
function trimmedRange(values: number[], percentile = 0.01): [number, number] {
    if (!values.length) return [0, 1];
    const sorted = values.slice().sort((a, b) => a - b);
    const drop = Math.floor(sorted.length * percentile);
    return [sorted[drop], sorted[sorted.length - 1 - drop]];
}

/** Decimals that resolve `step` (0.02 -> 2, 5 -> 0), clamped to 0..10. */
function decimalsFor(step: number): number {
    if (!Number.isFinite(step) || step <= 0) return 3;
    return Math.max(0, Math.min(10, Math.ceil(-Math.log10(step))));
}

/** Range text written by pan / zoom / fit: precise enough for the span, trailing zeros trimmed. */
function formatBound(value: number, span: number): string {
    return formatDecimals(value, decimalsFor(span) + 3);
}

/**
 * Zoom steps for one wheel event, proportional to its delta: a 100 px mouse
 * notch is one step, a trackpad's stream of 1 to 10 px events adds up to the
 * same amount of scrolling. Negative zooms in.
 */
function wheelZoomSteps(e: WheelEvent): number {
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PIXELS : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? WHEEL_PAGE_PIXELS : 1;
    const px = e.deltaY * unit * (e.ctrlKey ? PINCH_WHEEL_BOOST : 1);
    return Math.max(-WHEEL_MAX_STEPS, Math.min(WHEEL_MAX_STEPS, px / WHEEL_PIXELS_PER_STEP));
}

/** Real failures inside the editor that have no better place to go (a panel that failed to rebuild). */
function logError(e: unknown): void {
    console.error('Easy TikZ:', e);
}

function num(v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
}

/** 'Unsaved chart from 14:32' (today) or '... from Oct 3, 14:32'. */
function draftTime(savedAt: number): string {
    const date = new Date(savedAt);
    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return time;
    return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

export class TikzModal extends Modal implements PanelHost {
    settings: SettingsManager;
    plugin: PluginHost | null;

    private sourceFile: TFile | null = null;
    private originalBlockText: string | null = null;
    private fenceTag: 'easy-tikz' | 'tikz' = 'easy-tikz';
    /** Format of the block being edited; null for a new chart (the setting decides). */
    private blockFormat: BlockFormat | null = null;
    /** New objects in the preview pop in (+ Add, an example); what the editor opened with does not. */
    private popIn: PopIn | null = null;
    private readonly openedFromBlock: boolean;

    /** Shared by validation, renderers and export; null = rebuild on next use (memoized by structure). */
    private mathCtx: MathContext | null = null;
    private sceneCache = new SceneCache();
    private renderer3d: SVG3DRenderer | null = null;
    private chartMode: '2d' | '3d' | null = null;
    private chartSvg: SVGElement | null = null;
    private layout: RenderLayout | null = null;

    // DOM
    private shellEl: HTMLElement | null = null;
    private bannerSlot: HTMLElement | null = null;
    private dimSeg: SegmentedHandle<'2d' | '3d'> | null = null;
    private coordSeg: SegmentedHandle<'cartesian' | 'polar'> | null = null;
    private tabButtons = new Map<TabId, HTMLButtonElement>();
    private tabPanels = new Map<TabId, HTMLElement>();
    private tabErrorLabels = new Map<TabId, HTMLElement>();
    private tabScroll = new Map<TabId, number>();
    private activeTab: TabId = 'build';
    private undoEl: HTMLElement | null = null;
    private stageEl: HTMLElement | null = null;
    private chartEl: HTMLElement | null = null;
    /** Content box of `.etz-chart` in CSS px (the 100% x 100% SVG fills it), from the ResizeObserver. */
    private chartBox = { w: 0, h: 0 };
    /** pixelScale of the last 2D render (marching grid in on-screen px). */
    private gridScale = 1;
    private chartLabelEl: HTMLElement | null = null;
    private emptyEl: HTMLElement | null = null;
    private statusChip: HTMLButtonElement | null = null;
    private statusText: HTMLElement | null = null;
    private statusMore: HTMLElement | null = null;
    private readoutEl: HTMLElement | null = null;
    private pill2D: HTMLElement | null = null;
    private pill3D: HTMLElement | null = null;
    private gridBtn: IconButtonHandle | null = null;
    private lockBtn: IconButtonHandle | null = null;
    private ctaBtn: TextButtonHandle | null = null;

    // Panels
    private build: BuildPanelHandle | null = null;
    private chartPanel: ChartPanelHandle | null = null;
    private codePanel: CodePanelHandle | null = null;
    private helpPanel: HelpPanelHandle | null = null;
    private aiPanel: AiPanelHandle | null = null;
    /** Redraws in a row that a new `$...$` label asked for (see render2D). */
    private mathRedraws = 0;
    private dock: SlidersDockHandle | null = null;

    private fields = new Set<FieldHandle>();
    /** Set while commit() refreshes the Build panel. */
    private refreshingBuild = false;
    /** Problems of the last full render, errors first. */
    /** Issues the status chip, tab dots and first-issue focus use (hidden unread tools left out). */
    private issues: SceneIssue[] = [];
    /** Transient message in the status chip ("Nothing to fit yet"). */
    private flash: string | null = null;

    // Timers
    private frameRaf: number | null = null;
    private fullTimer: number | null = null;
    private updateTimer: number | null = null;
    private statusTimer: number | null = null;
    private flashTimer: number | null = null;
    /** Trailing Code tab regeneration, kept off the render path. */
    private codeTimer: number | null = null;
    private autosaveTimer: number | null = null;
    private undoTimer: number | null = null;
    private labelTimers = new Map<TextButtonHandle, { timer: number; original: string }>();

    // Interaction and lifecycle
    private drag: DragState | null = null;
    /** Wheel zoom steps not yet applied, and the plot fractions of the latest pointer (zoom anchor). Applied once per frame. */
    private wheelSteps = 0;
    private wheelAnchor: { fx: number; fy: number } | null = null;
    /** Unrounded view written by the last wheel frame, with the range text it was written as. */
    private wheelView: { view: View; text: string } | null = null;
    private panLocked = false;
    private isOpen = false;
    /** onOpen finished: from now on every change request counts as an edit. */
    private ready = false;
    /** The chart changed in this session (autosave, restore confirmation). */
    private dirty = false;
    /** Inserted / saved: no more autosaves. */
    private finished = false;
    /** savedAt of the last draft this session wrote. */
    private ownDraftAt: number | null = null;
    private draftBanner: BannerHandle | null = null;
    private draftSaveFailed = false;
    private resizeObserver: ResizeObserver | null = null;
    private lastStageSize = { w: 0, h: 0 };

    // Drag to edit (SPEC3 4.8)
    /** Hit index of the last 2D render (null in 3D and before the first render). */
    private hits: HitIndex | null = null;
    /** Built lazily from the last render; null after every render and resize. */
    private dragCtx: DragContext | null = null;
    private dragLayer: DragLayerHandle | null = null;
    private dragHint: DragHintHandle | null = null;
    private dragToggle: IconButtonHandle | null = null;
    /** The target under the (button-less) pointer; `timer` is the chip dwell. */
    private hover: {
        key: string;
        hitKey: string;
        target: DragTarget;
        grab: Pt;
        timer: number | null;
        clientX: number;
        clientY: number;
        /** The dwell ran (the chip shows): later moves on the same target update it at once. */
        chipShown: boolean;
        /** Shift state the chip was planned with. */
        chipShift: boolean;
    } | null = null;
    /** Last pointer position over the chart (hover is re-resolved there after renders). */
    private lastPointer: { clientX: number; clientY: number; pointerType: string } | null = null;
    private selected: { key: string; target: DragTarget; grab: Pt; releaseEscape: () => void; label: number | null; stale: boolean } | null = null;
    /** Plans per target, gesture and render (`${key}|${gesture}|${renderVersion}`), shared by hover and press. */
    private prepCache = new Map<string, PreparedDrag | { lock: Lock }>();
    /**
     * Texts (by field key) and slider values the running drag or keyboard session wrote last. A commit only
     * writes and records a patch whose field still holds them: anything typed or set since wins (AC7).
     */
    private liveFrame: { texts: Map<string, string>; params: Map<string, number> } | null = null;
    /** Lines whose plain drag is locked, per render (`${renderVersion}|${shape key}`), see preferUnlockedLine. */
    private lineLocks = new Map<string, boolean>();
    private renderVersion = 0;
    /** math() builds unmemoized contexts while an object drag or keyboard session edits texts (no LRU churn). */
    private objectDragActive = false;
    private history = new EditHistory(HISTORY_SIZE);
    private spaceHeld = false;
    private stageHovered = false;
    private keySession: { session: DragSession; prepared: PreparedDrag; timer: number } | null = null;
    /** Visually hidden aria-live span in the stage. */
    private announcer: HTMLElement | null = null;
    private announceTimer: number | null = null;
    /** Transient chip (lock after a click, the first-hover tip): hides or gives way to the hover chip. */
    private chipTimer: number | null = null;
    private tipUntil = 0;
    /** The hover chip sits in the readout corner: the readout stays hidden meanwhile. */
    private hintDocked = false;
    private pendingClick: PendingClick | null = null;
    /** An object drag just ended: re-run the hover after the next render. */
    private rehoverPending = false;
    /** Shift / Alt of the last pointer or key event (hover chip gesture, key-driven re-runs). */
    private mods: Mods = { shift: false, alt: false };
    /** Overlay state of the running drag, re-drawn after every render. */
    private dragOverlay: { ghost: Pt[][]; points: Pt[] | null; pivot: Pt | null; snapped: Pt | null } | null = null;
    private onModalKeyDown: ((e: KeyboardEvent) => void) | null = null;
    private onModalKeyUp: ((e: KeyboardEvent) => void) | null = null;
    private onWindowBlur: (() => void) | null = null;
    /** Drag toggle state when no plugin stores it (harness, tests). */
    private dragEditLocal = true;

    constructor(app: App, plugin?: PluginHost, initialState?: TikzModalInitialState) {
        super(app);
        this.plugin = plugin ?? null;
        this.openedFromBlock = !!(initialState && initialState.data);
        if (initialState && initialState.data) {
            this.settings = SettingsManager.fromJSON(initialState.data);
            this.sourceFile = initialState.sourceFile ?? null;
            this.originalBlockText = initialState.originalBlockText ?? null;
            this.fenceTag = initialState.fenceTag ?? 'easy-tikz';
            const original = this.originalBlockText;
            this.blockFormat = initialState.blockFormat ?? (original ? (isChartText(blockBody(original)) ? 'text' : 'json') : null);
        } else {
            // fromJSON runs the v4 migration, so new charts get the v4 defaults too.
            this.settings = SettingsManager.fromJSON({});
        }
    }

    // ================================================================ PanelHost

    is3D(): boolean {
        return this.settings.getValue('dimension') === true;
    }

    isPolar(): boolean {
        return !this.is3D() && this.settings.getValue('coordinateSystem') === 'polar';
    }

    math(): MathContext {
        // While a drag rewrites function texts every frame, each frame builds a fresh context
        // outside the shared memo (SPEC3 D20): no LRU churn for the inline charts.
        if (!this.mathCtx) this.mathCtx = this.settings.createMathContext({ memo: !this.objectDragActive });
        return this.mathCtx;
    }

    requestFrame(): void {
        this.markChanged();
        this.scheduleFrame();
    }

    requestUpdate(): void {
        // Any other edit ends a keyboard nudge session at once, so its commit never overwrites this edit.
        this.flushKeySession();
        this.forgetPlans();
        this.markChanged();
        // Typing may have changed a function body or a name: the next math() call rebuilds (memoized).
        this.mathCtx = null;
        this.scheduleUpdate();
    }

    commit(): void {
        this.flushKeySession();
        this.forgetPlans();
        this.mathCtx = null;
        // Cards for added / removed items, and dropdowns of function / region names. The
        // panel keeps every card whose item is still listed, so this is cheap; the guard
        // stops a card that commits while it is being built from re-entering the rebuild.
        if (this.build && !this.refreshingBuild) {
            this.refreshingBuild = true;
            try {
                this.build.refresh();
            } catch (e) {
                // A card failing to rebuild must not block validation and rendering.
                logError(e);
            } finally {
                this.refreshingBuild = false;
            }
        }
        for (const handle of Array.from(this.fields)) {
            try {
                handle.validate();
            } catch (e) {
                // One panel's validator failing must not keep the others stale.
                logError(e);
            }
        }
        this.dock?.refresh();
        this.updateTabDots();
        this.requestUpdate();
    }

    addParameter(name?: string, value?: number): Parameter {
        const params = this.list<Parameter>('parameters');
        const taken = [
            ...params.map((p) => p.name),
            ...this.list<FunctionParameters>('functions').map((f) => f.name || ''),
            ...this.list<Function3DParameters>('functions3D').map((f) => f.name || ''),
            ...this.list<Tool>('tools').map((t) => t.name),
        ];
        const param = defaultParameter(taken, name, value);
        this.settings.setValue('parameters', params.concat([param]));
        this.commit();
        return param;
    }

    rename(kind: 'function' | 'parameter' | 'tool', from: string, to: string): void {
        if (!from || !to || from === to) {
            this.commit();
            return;
        }
        // Tools are referenced by bare name (paths) and derived names (P1_x, P1_val, P1_x2, ...).
        const expr = (src: string | undefined) =>
            kind === 'tool' ? renameToolReferences(src ?? '', from, to) : renameIdentifier(src ?? '', from, to);
        const tpl = (src: string | undefined) =>
            kind === 'tool' ? renameToolReferences(src ?? '', from, to, true) : renameIdentifier(src ?? '', from, to, true);
        const ref = (name: string) => (name === from ? to : name);

        const functions = this.list<FunctionParameters>('functions');
        for (const f of functions) {
            if (kind === 'function' && f.name === from) f.name = to;
            f.expression = expr(f.expression);
            if (typeof f.expressionY === 'string') f.expressionY = expr(f.expressionY);
            f.domain = expr(f.domain);
            if (typeof f.tangentPoint === 'string') f.tangentPoint = expr(f.tangentPoint);
        }
        for (const s of this.list<Function3DParameters>('functions3D')) {
            if (kind === 'function' && s.name === from) s.name = to;
            s.expression = expr(s.expression);
            s.xDomain = expr(s.xDomain);
            s.yDomain = expr(s.yDomain);
        }
        for (const t of this.list<Tool>('tools')) {
            if (kind === 'tool' && t.name === from) t.name = to;
            switch (t.type) {
                case 'region':
                    t.conditions = t.conditions.map((c) => expr(c));
                    t.conditionLabels = t.conditionLabels.map((l) => tpl(l));
                    t.label = tpl(t.label);
                    break;
                case 'curve':
                    t.equation = expr(t.equation);
                    t.levels = expr(t.levels);
                    t.label = tpl(t.label);
                    break;
                case 'points':
                    t.points = expr(t.points);
                    if (kind !== 'parameter') {
                        t.ref1 = ref(t.ref1);
                        t.ref2 = ref(t.ref2);
                    }
                    if (kind === 'tool') t.regionName = ref(t.regionName);
                    t.objective = expr(t.objective);
                    t.label = tpl(t.label);
                    break;
                case 'segment':
                    t.path = expr(t.path);
                    t.label = tpl(t.label);
                    break;
                case 'plane3D':
                    t.value = expr(t.value);
                    break;
            }
        }
        for (const a of this.list<Annotation>('annotations')) {
            a.x = expr(a.x);
            a.y = expr(a.y);
            if (typeof a.z === 'string') a.z = expr(a.z);
            a.text = tpl(a.text);
        }
        for (const key of Object.keys(RANGE_DEFAULTS) as RangeKey[]) {
            const v = this.settings.getValue(key);
            if (typeof v === 'string') this.settings.setValue(key, expr(v));
        }
        const title = this.settings.getValue('title');
        if (typeof title === 'string') this.settings.setValue('title', tpl(title));
        if (kind === 'parameter') {
            for (const p of this.list<Parameter>('parameters')) if (p.name === from) p.name = to;
        }
        this.chartPanel?.refresh();
        this.commit();
    }

    registerField(field: FieldHandle): () => void {
        this.fields.add(field);
        return () => {
            this.fields.delete(field);
        };
    }

    showUndo(message: string, undo: () => void, extra?: { text: string; run: () => void }): void {
        // A running keyboard session goes into the history first (entries stay in the order of the edits).
        this.flushKeySession();
        // Deletes and other panel actions join the chart history, so Mod+Z undoes them too.
        const entry: HistoryEntry = {
            label: message,
            undo: () => {
                undo();
                return true;
            },
        };
        this.history.push(entry);
        this.showUndoBar(entry, extra);
    }

    pushHistory(entry: HistoryEntry): void {
        this.flushKeySession();
        this.history.push(entry);
    }

    /**
     * Drop the hover plans, line locks and the drag context: they were made from the texts before an edit
     * (undo, Make slider, typing), and a press must never start from a stale plan (AC7). A running session
     * keeps its own context.
     */
    private forgetPlans(): void {
        this.prepCache.clear();
        this.lineLocks.clear();
        this.dragCtx = null;
    }

    /** The bottom bar for a history entry: its Undo button runs the entry and drops it from the history. */
    private showUndoBar(entry: HistoryEntry, extra?: { text: string; run: () => void }): void {
        const el = this.undoEl;
        if (!el) return;
        this.hideUndo();
        el.createSpan({ cls: 'etz-undo-text', text: entry.label });
        textButton(el, {
            text: UNDO_BUTTON,
            size: 'sm',
            onClick: () => {
                this.hideUndo();
                this.flushKeySession();
                let applied = false;
                try {
                    applied = entry.undo();
                } catch (e) {
                    logError(e);
                }
                this.history.forget(entry);
                const stale = this.staleMessage(entry, applied, false);
                if (stale) this.showMessage(stale);
            },
        });
        if (extra) {
            textButton(el, {
                text: extra.text,
                size: 'sm',
                onClick: () => {
                    this.hideUndo();
                    extra.run();
                },
            });
        }
        el.removeClass('tikz-hidden');
        this.undoTimer = window.setTimeout(() => this.hideUndo(), UNDO_VISIBLE_MS);
    }

    /** The bottom bar with a message and an optional action (undo / redo results). */
    private showMessage(message: string, action?: { text: string; run: () => void }): void {
        const el = this.undoEl;
        if (!el) return;
        this.hideUndo();
        el.createSpan({ cls: 'etz-undo-text', text: message });
        if (action) {
            textButton(el, {
                text: action.text,
                size: 'sm',
                onClick: () => {
                    this.hideUndo();
                    action.run();
                },
            });
        }
        el.removeClass('tikz-hidden');
        this.undoTimer = window.setTimeout(() => this.hideUndo(), UNDO_VISIBLE_MS);
    }

    loadChart(data: Record<string, unknown>, onApplied?: () => void): void {
        if (!this.hasContent()) {
            this.applyChart(data);
            if (onApplied) onApplied();
            return;
        }
        void confirmDialog(this.app, {
            title: 'Replace the current chart?',
            message: 'The chart in the editor is replaced. Charts already in your notes are not affected.',
            confirmText: 'Replace',
            destructive: true,
        }).then((ok) => {
            if (!ok || !this.isOpen) return;
            this.applyChart(data);
            if (onApplied) onApplied();
        });
    }

    showTab(tab: TabId): void {
        const previous = this.activeTab;
        const prevPanel = this.tabPanels.get(previous);
        if (prevPanel && previous !== tab) this.tabScroll.set(previous, prevPanel.scrollTop);
        this.activeTab = tab;
        this.tabButtons.forEach((btn, id) => {
            const active = id === tab;
            btn.setAttr('aria-selected', String(active));
            btn.tabIndex = active ? 0 : -1;
            btn.toggleClass('is-active', active);
        });
        this.tabPanels.forEach((panel, id) => panel.toggleClass('tikz-hidden', id !== tab));
        const panel = this.tabPanels.get(tab);
        if (panel && previous !== tab) panel.scrollTop = this.tabScroll.get(tab) ?? 0;
        if (tab === 'code') this.codePanel?.onShow();
        if (tab === 'ai') this.aiPanel?.refresh();
    }

    /** The AI tab (the "What's new" popup links here). */
    openAi(): void {
        this.showTab('ai');
    }

    /** The Help tab on its list of guides, or on one guide (the "What's new" popup links here). */
    openHelp(guideId?: string): void {
        this.showTab('help');
        if (!guideId || !this.helpPanel?.showGuide(guideId)) this.helpPanel?.showHome();
    }

    // ================================================================ lifecycle

    onOpen() {
        this.isOpen = true;
        // Obsidian loads MathJax lazily, and renderMath() throws until it's
        // ready: without this kick, `$...$` labels would silently fall back
        // to the stripLatex() approximation until something else in the vault
        // rendered math. Re-render once loaded so open charts pick it up.
        void loadMathJax()
            .then(() => {
                if (this.isOpen) this.scheduleUpdate();
            })
            .catch(() => undefined);

        const { modalEl, contentEl } = this;
        modalEl.addClass('tikz-modal');
        this.titleEl.setText('Easy TikZ editor');
        this.titleEl.addClass('etz-sr-only');
        contentEl.empty();

        const shell = contentEl.createDiv({ cls: 'etz-shell' });
        this.shellEl = shell;
        this.buildEditor(shell);
        this.buildStage(shell);
        this.dock = createSlidersDock(shell, this);
        this.dock.el.addClass('etz-shell-dock');
        this.buildActionBar(shell);

        this.scope.register(['Mod'], 'Enter', () => {
            void this.emitBlock();
            return false;
        });
        this.bindDragKeys();

        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver((entries) => {
                for (const e of entries) if (e.target === this.chartEl) this.chartBox = { w: e.contentRect.width, h: e.contentRect.height };
                this.onResize();
                // The SVG's on-screen scale may have changed: the px map and the overlay follow it.
                this.dragCtx = null;
                this.syncOverlay();
                // Outside onResize: that returns early when the stage keeps its size, while is-narrow changes only the chart padding.
                this.checkGridScale();
            });
            this.resizeObserver.observe(shell);
            if (this.stageEl) this.resizeObserver.observe(this.stageEl);
            if (this.chartEl) this.resizeObserver.observe(this.chartEl);
        }
        if (this.chartEl) this.chartBox = { w: this.chartEl.clientWidth, h: this.chartEl.clientHeight };
        this.onResize();

        this.showTab('build');
        this.syncHeader();
        this.offerDraft();
        this.renderNow('full');
        this.ready = true;
    }

    onClose() {
        this.isOpen = false;
        this.ready = false;
        // A running drag restores its start texts before the draft flush; a keyboard nudge keeps its texts.
        this.abortObjectDrag(false);
        this.dropKeySession();
        this.clearSelection();
        this.clearHover();
        // Playing sliders snap back onto their step first, so the flushed draft never stores a sub-step value.
        this.dock?.stopAnimations();
        // Changes from the last second must not be lost: flush the pending autosave now.
        if (this.autosaveTimer !== null) {
            window.clearTimeout(this.autosaveTimer);
            this.autosaveTimer = null;
            void this.saveDraft();
        }
        for (const id of [this.fullTimer, this.updateTimer, this.statusTimer, this.flashTimer, this.undoTimer, this.codeTimer, this.announceTimer, this.chipTimer]) {
            if (id !== null) window.clearTimeout(id);
        }
        this.announceTimer = this.chipTimer = null;
        this.unbindDragKeys();
        this.dragLayer?.destroy();
        this.dragHint?.destroy();
        this.dragLayer = null;
        this.dragHint = null;
        this.dragToggle = null;
        this.announcer = null;
        this.history.clear();
        this.prepCache.clear();
        this.lineLocks.clear();
        this.hits = null;
        this.dragCtx = null;
        this.pendingClick = null;
        this.spaceHeld = false;
        this.dragOverlay = null;
        this.labelTimers.forEach((pending) => window.clearTimeout(pending.timer));
        this.labelTimers.clear();
        if (this.frameRaf !== null) window.cancelAnimationFrame(this.frameRaf);
        this.frameRaf = this.fullTimer = this.updateTimer = this.statusTimer = this.flashTimer = this.undoTimer = this.codeTimer = null;
        this.dropPendingWheel();
        closeAllPopovers();
        if (this.resizeObserver) this.resizeObserver.disconnect();
        this.resizeObserver = null;
        this.drag = null;
        this.fields.clear();
        this.tabButtons.clear();
        this.tabPanels.clear();
        this.tabErrorLabels.clear();
        // Help lets go of its lazy render jobs and of the Escape trap of its search field.
        this.helpPanel?.destroy();
        this.helpPanel = null;
        this.build = this.chartPanel = this.codePanel = this.dock = null;
        this.renderer3d = null;
        this.chartMode = null;
        this.chartSvg = null;
        this.layout = null;
        this.contentEl.empty();
    }

    // ================================================================ editor pane

    private buildEditor(shell: HTMLElement) {
        const editor = shell.createDiv({ cls: 'etz-editor' });
        this.buildHeader(editor);
        this.bannerSlot = editor.createDiv({ cls: 'etz-banner-slot' });
        this.buildTabs(editor);
        this.undoEl = editor.createDiv({ cls: ['etz-undo', 'tikz-hidden'], attr: { role: 'status' } });
    }

    private buildHeader(editor: HTMLElement) {
        const header = editor.createDiv({ cls: 'etz-header' });
        this.dimSeg = segmented<'2d' | '3d'>(header, {
            label: 'Chart type',
            value: this.is3D() ? '3d' : '2d',
            options: [
                { value: '2d', text: '2D' },
                { value: '3d', text: '3D' },
            ],
            onChange: (value) => this.setDimension(value === '3d'),
        });
        this.coordSeg = segmented<'cartesian' | 'polar'>(header, {
            label: 'Coordinates',
            value: this.isPolar() ? 'polar' : 'cartesian',
            options: [
                { value: 'cartesian', text: 'Cartesian' },
                { value: 'polar', text: 'Polar' },
            ],
            onChange: (value) => this.setCoordinates(value),
        });
        header.createDiv({ cls: 'etz-header-spacer' });
        const more = iconButton(header, { icon: 'more-horizontal', label: 'Examples and templates', tooltipPosition: 'bottom' });
        menuFromButton(more.el, (menu) => this.fillMoreMenu(menu), 'end');
    }

    private fillMoreMenu(menu: Menu) {
        menu.addItem((item) => item.setTitle('Examples').setIsLabel(true));
        for (const example of EXAMPLES) {
            menu.addItem((item) =>
                item
                    .setTitle(example.is3D ? `${example.title} (3D)` : example.title)
                    .setIcon(example.is3D ? 'box' : 'line-chart')
                    .onClick(() => this.loadChart(example.data))
            );
        }
        menu.addSeparator();
        menu.addItem((item) =>
            item
                .setTitle('Manage saved templates...')
                .setIcon('bookmark')
                .setDisabled(!this.plugin)
                .onClick(() => {
                    if (this.plugin) new TemplatesModal(this.app, this.plugin).open();
                })
        );
    }

    private buildTabs(editor: HTMLElement) {
        const list = editor.createDiv({ cls: 'etz-tabs', attr: { role: 'tablist' } });
        const listLabel = visuallyHidden(list, 'Editor sections');
        listLabel.id = uniqueId('tabs');
        list.setAttr('aria-labelledby', listLabel.id);
        const panels = editor.createDiv({ cls: 'etz-tabpanels' });

        for (const tab of TABS) {
            const btn = list.createEl('button', { cls: 'etz-tab', attr: { type: 'button', role: 'tab' } });
            btn.id = uniqueId(`tab-${tab.id}`);
            btn.createSpan({ cls: 'etz-tab-text', text: tab.label });
            btn.createSpan({ cls: 'etz-tab-dot', attr: { 'aria-hidden': 'true' } });
            this.tabErrorLabels.set(tab.id, btn.createSpan({ cls: 'etz-sr-only' }));
            btn.addEventListener('click', () => this.showTab(tab.id));
            this.tabButtons.set(tab.id, btn);

            const panel = panels.createDiv({ cls: ['etz-tabpanel', `mod-${tab.id}`], attr: { role: 'tabpanel' } });
            panel.id = uniqueId(`panel-${tab.id}`);
            panel.setAttr('aria-labelledby', btn.id);
            btn.setAttr('aria-controls', panel.id);
            this.tabPanels.set(tab.id, panel);
        }

        // Roving tabindex: arrows / Home / End move between tabs and activate them.
        list.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const ids = TABS.map((t) => t.id);
            const at = ids.indexOf(this.activeTab);
            let next: number | null = null;
            if (e.key === 'ArrowRight') next = (at + 1) % ids.length;
            else if (e.key === 'ArrowLeft') next = (at - 1 + ids.length) % ids.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = ids.length - 1;
            if (next === null) return;
            e.preventDefault();
            this.showTab(ids[next]);
            this.tabButtons.get(ids[next])?.focus();
        });

        const panel = (id: TabId) => this.tabPanels.get(id) as HTMLElement;
        this.build = createBuildPanel(panel('build'), this, {
            // Until onOpen has finished: the Start a chart field takes the focus of a new, empty editor.
            opening: () => !this.ready,
            onErrorsChange: () => this.updateTabDots(),
            // The default view cuts off most first formulas: fit it once, unless the user already set ranges.
            onStartAdded: () => {
                if (this.rangesAreDefault()) this.autoFit(true);
            },
        });
        this.chartPanel = createChartPanel(panel('chart'), this, {
            fit: () => this.autoFit(),
            reset: () => this.resetRanges(),
        });
        this.codePanel = createCodePanel(panel('code'), this, {
            generate: () => this.generateCode(),
            isVisible: () => this.activeTab === 'code',
            copy: (text, button) => void this.copyText(text, button),
        });
        this.helpPanel = createHelpPanel(panel('help'), this);
        this.aiPanel = createAiPanel(panel('ai'), this);
    }

    private syncHeader() {
        this.dimSeg?.setValue(this.is3D() ? '3d' : '2d');
        this.coordSeg?.setValue(this.isPolar() ? 'polar' : 'cartesian');
        this.coordSeg?.el.toggleClass('tikz-hidden', this.is3D());
        this.pill2D?.toggleClass('tikz-hidden', this.is3D());
        this.pill3D?.toggleClass('tikz-hidden', !this.is3D());
        if (this.chartLabelEl) {
            this.chartLabelEl.setText(
                this.is3D()
                    ? 'Chart preview. Drag or use the arrow keys to rotate.'
                    : this.dragEditOn()
                      ? CHART_LABEL
                      : 'Chart preview. Drag or use the arrow keys to pan, scroll to zoom, drag labels to move them.'
            );
        }
        this.chartEl?.toggleClass('is-3d', this.is3D());
        this.updateEmptyHint();
    }

    private setDimension(is3D: boolean) {
        if (is3D === this.is3D()) return;
        closeAllPopovers();
        this.dock?.stopAnimations();
        this.resetDrag();
        this.settings.setValue('dimension', is3D);
        this.drag = null;
        this.layout = null;
        this.hideReadout();
        this.syncHeader();
        this.build?.refresh();
        this.chartPanel?.refresh();
        this.commit();
    }

    private setCoordinates(system: 'cartesian' | 'polar') {
        if (this.settings.getValue('coordinateSystem') === system) return;
        closeAllPopovers();
        this.resetDrag();
        this.settings.setValue('coordinateSystem', system);
        this.syncHeader();
        // Function cards and axis labels differ per coordinate system.
        this.build?.refresh();
        this.chartPanel?.refresh();
        this.commit();
    }

    private hideUndo() {
        if (this.undoTimer !== null) window.clearTimeout(this.undoTimer);
        this.undoTimer = null;
        if (!this.undoEl) return;
        this.undoEl.empty();
        this.undoEl.addClass('tikz-hidden');
    }

    private updateTabDots() {
        const isError = (i: SceneIssue) => i.severity === 'error';
        const params = new Set(this.list<Parameter>('parameters').map((p) => p.name));
        let buildErr = this.issues.some((i) => isError(i) && i.source !== 'chart' && !params.has(i.source));
        let chartErr = this.issues.some((i) => isError(i) && i.source === 'chart');
        try {
            buildErr = buildErr || !!this.build?.hasErrors();
            chartErr = chartErr || !!this.chartPanel?.hasErrors();
        } catch (e) {
            // A broken panel: keep the render-based dots, the next render updates them again.
            logError(e);
        }
        const set = (id: TabId, on: boolean) => {
            this.tabButtons.get(id)?.toggleClass('has-error', on);
            this.tabErrorLabels.get(id)?.setText(on ? ' (has problems)' : '');
        };
        set('build', buildErr);
        set('chart', chartErr);
    }

    // ================================================================ preview stage

    private buildStage(shell: HTMLElement) {
        const stage = shell.createDiv({ cls: 'etz-stage' });
        this.stageEl = stage;

        const chart = stage.createDiv({ cls: 'etz-chart', attr: { tabindex: '0', role: 'img' } });
        this.chartEl = chart;
        this.chartLabelEl = visuallyHidden(stage, '');
        this.chartLabelEl.id = uniqueId('preview');
        chart.setAttr('aria-labelledby', this.chartLabelEl.id);
        this.bindPreviewPointer(chart);
        // Drag overlay (a sibling SVG over the chart, never exported), the chip and the announcer.
        this.dragLayer = createDragLayer(chart);
        this.dragHint = createDragHint(stage);
        this.announcer = stage.createSpan({ cls: 'etz-sr-only', attr: { 'aria-live': 'polite' } });
        stage.addEventListener('pointerenter', () => {
            this.stageHovered = true;
        });
        stage.addEventListener('pointerleave', () => {
            this.stageHovered = false;
        });

        this.emptyEl = stage.createDiv({ cls: ['etz-preview-empty', 'tikz-hidden'], attr: { 'aria-hidden': 'true' } });
        this.emptyEl.createDiv({ cls: 'etz-preview-empty-title', text: 'Your chart appears here' });
        this.emptyEl.createDiv({ cls: 'etz-preview-empty-hint' });

        // Status chip (top-left; the top-right corner stays free for the modal's close button).
        const live = stage.createDiv({ cls: 'etz-status', attr: { 'aria-live': 'polite' } });
        this.statusChip = live.createEl('button', { cls: ['etz-status-chip', 'tikz-hidden'], attr: { type: 'button' } });
        this.statusText = this.statusChip.createSpan({ cls: 'etz-status-text' });
        this.statusMore = this.statusChip.createSpan({ cls: 'etz-status-more' });
        this.statusChip.addEventListener('click', () => {
            if (this.flash !== null) {
                this.clearFlash();
                return;
            }
            const first = this.issues[0];
            if (first) this.focusIssue(first);
        });

        this.readoutEl = stage.createDiv({ cls: ['etz-readout', 'tikz-hidden'], attr: { 'aria-hidden': 'true' } });

        const pill = stage.createDiv({ cls: 'etz-pill' });
        iconButton(pill, { icon: 'maximize-2', label: 'Fit ranges to the functions', tooltipPosition: 'top', onClick: () => this.autoFit() });
        iconButton(pill, { icon: 'rotate-ccw', label: 'Reset ranges', tooltipPosition: 'top', onClick: () => this.resetRanges() });
        this.pill2D = pill.createDiv({ cls: 'etz-pill-group' });
        this.gridBtn = iconButton(this.pill2D, {
            icon: 'grid',
            label: 'Major grid',
            pressed: this.settings.getValue('showLargeGrid') === true,
            tooltipPosition: 'top',
            onClick: () => this.toggleGrid(),
        });
        this.lockBtn = iconButton(this.pill2D, {
            icon: 'lock-open',
            label: 'Lock pan and zoom',
            pressed: false,
            tooltipPosition: 'top',
            onClick: () => this.togglePanLock(),
        });
        this.dragToggle = iconButton(this.pill2D, {
            icon: 'mouse-pointer-2',
            label: TOGGLE_LABEL,
            pressed: this.dragEditOn(),
            tooltipPosition: 'top',
            onClick: () => this.toggleDragEdit(),
        });
        this.pill3D = pill.createDiv({ cls: 'etz-pill-group' });
        iconButton(this.pill3D, { icon: 'zoom-in', label: 'Zoom in', tooltipPosition: 'top', onClick: () => this.zoom3D(ZOOM_3D_STEP) });
        iconButton(this.pill3D, { icon: 'zoom-out', label: 'Zoom out', tooltipPosition: 'top', onClick: () => this.zoom3D(1 / ZOOM_3D_STEP) });
        iconButton(this.pill3D, { icon: 'scan', label: 'Reset zoom', tooltipPosition: 'top', onClick: () => this.zoom3D(0) });
    }

    private onResize() {
        const shell = this.shellEl;
        if (!shell) return;
        // The shell's size comes from the modal frame, never from this class, so toggling cannot loop.
        const { width, height } = shell.getBoundingClientRect();
        if (width > 0) shell.toggleClass('is-narrow', width < STACK_WIDTH || (width < NARROW_WIDTH && height > width * STACK_ASPECT));
        const stage = this.stageEl;
        if (!stage) return;
        const r = stage.getBoundingClientRect();
        const last = this.lastStageSize;
        if (Math.abs(r.width - last.w) < 0.5 && Math.abs(r.height - last.h) < 0.5) return;
        this.lastStageSize = { w: r.width, h: r.height };
        // The 2D SVG scales with CSS; the 3D canvas measures its parent, so it repaints.
        if (this.is3D() && this.chartMode === '3d') this.scheduleFrame();
    }

    /** The chart is shown at a new size: redraw the 2D scene once at the matching grid. */
    private checkGridScale() {
        if (this.chartMode !== '2d' || !this.layout) return;
        if (fitPixelScale(this.chartBox.w, this.chartBox.h, this.layout.width, this.layout.height) !== this.gridScale) this.scheduleUpdate();
    }

    private updateEmptyHint() {
        if (!this.emptyEl) return;
        const empty = !this.hasContent();
        this.emptyEl.toggleClass('tikz-hidden', !empty);
        const hint = this.emptyEl.querySelector('.etz-preview-empty-hint');
        if (hint) hint.setText(this.is3D() ? 'Drag to rotate' : 'Drag to pan, scroll to zoom');
    }

    // ================================================================ rendering

    private scheduleFrame() {
        this.cancelCodeRefresh();
        if (this.updateTimer !== null) {
            window.clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
        if (this.frameRaf === null) {
            this.frameRaf = window.requestAnimationFrame(() => {
                this.frameRaf = null;
                this.renderNow('draft');
            });
        }
        if (this.fullTimer !== null) window.clearTimeout(this.fullTimer);
        this.fullTimer = window.setTimeout(() => {
            this.fullTimer = null;
            this.renderNow('full');
        }, FULL_RENDER_DELAY_MS);
    }

    private scheduleUpdate() {
        this.cancelCodeRefresh();
        if (this.updateTimer !== null) window.clearTimeout(this.updateTimer);
        this.updateTimer = window.setTimeout(() => {
            this.updateTimer = null;
            this.renderNow('full');
        }, UPDATE_DEBOUNCE_MS);
    }

    private renderNow(quality: 'draft' | 'full') {
        if (!this.isOpen || !this.chartEl) return;
        if (quality === 'full') {
            // A full render supersedes every pending frame.
            if (this.frameRaf !== null) window.cancelAnimationFrame(this.frameRaf);
            if (this.fullTimer !== null) window.clearTimeout(this.fullTimer);
            if (this.updateTimer !== null) window.clearTimeout(this.updateTimer);
            this.frameRaf = this.fullTimer = this.updateTimer = null;
        }
        this.flushWheel();
        let issues: SceneIssue[] = [];
        try {
            const math = this.math();
            math.setParams(this.list<Parameter>('parameters'));
            const config = this.settings.toRendererConfig(math);
            issues = config.is3D ? this.render3D(config, math, quality) : this.render2D(config, math, quality);
        } catch (e) {
            // Keep the last good drawing; the problem goes to the status chip, never a Notice.
            issues = [{ source: 'chart', message: `Preview failed: ${errorText(e)}`, severity: 'error' }];
        }
        if (quality !== 'full') return;
        this.updateEmptyHint();
        this.setIssues(issues);
        this.updatePill();
        this.scheduleCodeRefresh();
    }

    /**
     * Regenerate the Code tab a moment after a full render, not inside it:
     * the exporter recomputes the whole scene at export resolution, which
     * would turn every pause in a slider drag or pan into a long task. Any
     * new frame or edit within the delay postpones it again, so it runs only
     * once the user has stopped. Copy always generates fresh code itself.
     */
    private scheduleCodeRefresh() {
        this.cancelCodeRefresh();
        if (this.activeTab !== 'code') return;
        this.codeTimer = window.setTimeout(() => {
            this.codeTimer = null;
            this.codePanel?.onFullRender();
        }, CODE_REFRESH_DELAY_MS);
    }

    private cancelCodeRefresh() {
        if (this.codeTimer !== null) window.clearTimeout(this.codeTimer);
        this.codeTimer = null;
    }

    private render2D(config: RendererConfig, math: MathContext, quality: 'draft' | 'full'): SceneIssue[] {
        const chart = this.chartEl as HTMLElement;
        // Leaving 3D: drop its canvas first, so a failing first 2D frame never leaves the 3D picture up.
        if (this.chartMode !== '2d') {
            chart.empty();
            this.chartSvg = null;
            this.chartMode = '2d';
        }
        const pixelScale = fitPixelScale(this.chartBox.w, this.chartBox.h, config.width, config.height);
        this.gridScale = pixelScale;
        const renderer = new SVGRenderer(config, { math, cache: this.sceneCache, quality, pixelScale });
        const svg = renderer.render();
        svg.addClass('etz-chart-svg');
        if (this.chartSvg && this.chartSvg.parentElement === chart) this.chartSvg.replaceWith(svg);
        else chart.appendChild(svg);
        this.chartSvg = svg;
        this.layout = renderer.layout;
        if (!this.popIn) this.popIn = new PopIn(drawnNames(svg));
        this.popIn.apply(svg, this.plugin?.data.animateCharts !== false && !reducedMotion());
        // A new `$...$` label is measured before MathJax has styled it: draw once more when it has.
        void renderer.mathSettled?.then((redraw) => {
            if (!redraw) this.mathRedraws = 0;
            else if (this.isOpen && this.chartSvg === svg && this.mathRedraws < MATH_REDRAW_LIMIT) {
                this.mathRedraws++;
                this.scheduleUpdate();
            }
        });
        this.afterRender2D(renderer.drawn);
        return quality === 'full' ? this.withViewErrors(renderer.issues ?? [], math) : [];
    }

    /**
     * New picture: rebuild the hit index, drop the drag context and the
     * plans (they belong to the previous picture), place the overlay over
     * the new SVG and re-resolve hover and selection by key.
     */
    private afterRender2D(drawn: SVGRenderer['drawn']) {
        this.renderVersion++;
        this.prepCache.clear();
        this.lineLocks.clear();
        this.dragCtx = null;
        try {
            this.hits = drawn ? buildHitIndex(drawn) : null;
        } catch (e) {
            // Dragging is unavailable for this frame; the picture itself is fine.
            this.hits = null;
            logError(e);
        }
        if (this.selected) this.selected.stale = true;
        this.syncOverlay();
        if (this.drag) return;
        // Hover follows the new picture under a still pointer (a slider moved the line away, or onto it).
        const p = this.lastPointer;
        if ((this.hover || this.rehoverPending) && p) this.updateHover(p.clientX, p.clientY, null, p.pointerType, true);
        this.rehoverPending = false;
    }

    private render3D(config: RendererConfig, math: MathContext, quality: 'draft' | 'full'): SceneIssue[] {
        if (this.hits || this.selected || this.hover) this.resetDrag();
        this.hits = null;
        if (!this.renderer3d) this.renderer3d = new SVG3DRenderer();
        const root = this.renderer3d.getElement();
        const chart = this.chartEl as HTMLElement;
        // Attach the 3D root BEFORE rendering, so its fit-contain sizing can
        // measure the parent on the very first paint.
        if (this.chartMode !== '3d' || root.parentElement !== chart) {
            chart.empty();
            this.chartSvg = null;
            chart.appendChild(root);
            this.chartMode = '3d';
        }
        this.layout = null;
        this.renderer3d.renderCanvas(config, { math });
        // Surface fields, the 3D scene's tools and labels; view fallbacks are added here.
        return quality === 'full' ? this.withViewErrors(this.renderer3d.issues, math) : [];
    }

    /**
     * Add settings.resolveView fallbacks ('xmax: Unknown name b') that the
     * renderer did not report itself, and sliders named like an axis.
     */
    private withViewErrors(issues: SceneIssue[], math: MathContext): SceneIssue[] {
        const out = mergeViewErrors(issues, () => this.settings.resolveView(math).errors, this.is3D());
        for (const issue of math.parameterIssues()) {
            if (!out.some((i) => i.source === issue.source && i.message === issue.message)) out.push(issue);
        }
        return out;
    }

    // ================================================================ status chip

    private setIssues(issues: SceneIssue[]) {
        // Errors first, then info (unbounded / infeasible / truncated); stable otherwise.
        const ordered = issues.filter((i) => i.severity === 'error').concat(issues.filter((i) => i.severity !== 'error'));
        // Hidden tools that nothing reads keep their card's dot but stay out of the chip and the tab dots.
        this.issues = ordered.filter((i) => !i.hiddenSource);
        if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
        this.statusTimer = null;
        const show = () => {
            // Cards show their own issues (info notes, scene errors on valid text) with the chip.
            this.build?.setIssues?.(ordered);
            this.renderStatus();
            this.updateTabDots();
        };
        if (!this.issues.length) {
            // Fixing a problem clears the chip at once; new problems wait for a pause.
            show();
            return;
        }
        this.statusTimer = window.setTimeout(() => {
            this.statusTimer = null;
            show();
        }, STATUS_IDLE_MS);
    }

    private renderStatus() {
        const chipEl = this.statusChip;
        if (!chipEl || !this.statusText || !this.statusMore) return;
        if (this.flash !== null) {
            chipEl.removeClass('tikz-hidden');
            chipEl.addClass('is-info');
            this.statusText.setText(this.flash);
            this.statusMore.setText('');
            chipEl.title = this.flash;
            return;
        }
        const first = this.issues[0];
        chipEl.toggleClass('tikz-hidden', !first);
        if (!first) {
            this.statusText.setText('');
            this.statusMore.setText('');
            return;
        }
        const text = issueText(first, ' · ');
        chipEl.toggleClass('is-info', first.severity !== 'error');
        this.statusText.setText(text);
        this.statusMore.setText(this.issues.length > 1 ? `+${this.issues.length - 1} more` : '');
        chipEl.title = this.issues.map((i) => issueText(i, ' · ')).join('\n');
    }

    /** Short-lived message in the status chip, for actions that could not do anything. */
    private flashStatus(text: string) {
        this.flash = text;
        if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
        this.flashTimer = window.setTimeout(() => this.clearFlash(), FLASH_MS);
        this.renderStatus();
    }

    private clearFlash() {
        if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
        this.flashTimer = null;
        this.flash = null;
        this.renderStatus();
    }

    /** Switch tab, expand the card, focus the field and select the offending name. */
    private focusIssue(issue: SceneIssue) {
        const selectText = /'([^']+)'/.exec(issue.message)?.[1];
        const handle = issue.field === undefined ? null : Array.from(this.fields).find((f) => f.source === issue.source && f.field === issue.field);
        if (issue.source === 'chart') {
            this.showTab('chart');
        } else if (!this.list<Parameter>('parameters').some((p) => p.name === issue.source)) {
            // Functions, tools and labels live in Build; parameters in the dock (always visible).
            this.showTab('build');
        }
        if (handle) {
            handle.focus(selectText);
            return;
        }
        if (issue.source !== 'chart') this.build?.reveal(issue.source, issue.field, selectText);
    }

    // ================================================================ preview pointer / keys

    private bindPreviewPointer(chart: HTMLElement) {
        chart.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        chart.addEventListener('pointermove', (e) => this.onPointerMove(e));
        chart.addEventListener('pointerup', (e) => this.endDrag(e, false));
        chart.addEventListener('pointercancel', (e) => this.endDrag(e, true));
        // The capture can go without a pointerup reaching the chart (released in another app after
        // Cmd+Tab): an object drag ends as on release, a press as on cancel. Our own releases come after
        // the drag state is gone and change nothing.
        chart.addEventListener('lostpointercapture', (e) => this.onLostCapture(e));
        // Focus leaving the chart (into a card input, the dock) ends a keyboard nudge session at once.
        chart.addEventListener('focusout', () => {
            this.flushKeySession();
            chart.removeClass('is-pointer-focus');
        });
        chart.addEventListener('pointerleave', () => {
            this.lastPointer = null;
            if (this.drag) return;
            this.hideReadout();
            this.clearHover();
        });
        // The middle button pans: keep the browser's autoscroll out of it.
        chart.addEventListener('mousedown', (e) => {
            if (e.button === 1 && !this.is3D()) e.preventDefault();
        });
        chart.addEventListener('dblclick', (e) => this.onDoubleClick(e));
        chart.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        chart.addEventListener('keydown', (e) => {
            // The keyboard takes over a preview that was focused by a press: its focus ring shows again.
            // Shift, Alt and the like only modify a drag, so they do not count.
            if (!['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) chart.removeClass('is-pointer-focus');
            this.onPreviewKey(e);
        });
    }

    /** Index into settings 'annotations' of the label under `target`, or null. */
    private labelAt(target: EventTarget | null): number | null {
        if (!target || (target as Node).nodeType !== Node.ELEMENT_NODE) return null;
        const hit = (target as Element).closest('[data-annotation-idx]');
        if (!hit) return null;
        const index = parseInt(hit.getAttribute('data-annotation-idx') ?? '', 10);
        return Number.isFinite(index) && index >= 0 ? index : null;
    }

    /** Pan / zoom may write an axis only when both its bounds are empty or plain numbers. */
    private axisFree(axis: 'x' | 'y' | 'z'): boolean {
        const free = (key: string) => {
            const v = this.settings.getValue(key);
            return v === undefined || v === null || str(v).trim() === '' || MathContext.isNumericLiteral(v);
        };
        return free(`${axis}min`) && free(`${axis}max`);
    }

    /** The chart SVG's on-screen box mapped to viewBox units (preserveAspectRatio meet). */
    private svgBox(): { s: number; ox: number; oy: number } | null {
        const svg = this.chartSvg;
        const layout = this.layout;
        if (!svg || !layout || !svg.isConnected) return null;
        const r = svg.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        const s = Math.min(r.width / layout.width, r.height / layout.height);
        return { s, ox: r.left + (r.width - layout.width * s) / 2, oy: r.top + (r.height - layout.height * s) / 2 };
    }

    /** Pointer position in math coordinates plus its fractions inside the plot rectangle. */
    private toMath(clientX: number, clientY: number): { x: number; y: number; fx: number; fy: number } | null {
        const box = this.svgBox();
        const layout = this.layout;
        if (!box || !layout || layout.plot.w <= 0 || layout.plot.h <= 0) return null;
        const vx = (clientX - box.ox) / box.s;
        const vy = (clientY - box.oy) / box.s;
        const fx = (vx - layout.plot.x) / layout.plot.w;
        const fy = (vy - layout.plot.y) / layout.plot.h;
        const v = layout.view;
        return { x: v.xmin + fx * (v.xmax - v.xmin), y: v.ymax - fy * (v.ymax - v.ymin), fx, fy };
    }

    /** Decimals matching one screen pixel of the current view. */
    private pixelDecimals(): number {
        const box = this.svgBox();
        const layout = this.layout;
        if (!box || !layout) return 3;
        const px = layout.plot.w * box.s;
        return decimalsFor((layout.view.xmax - layout.view.xmin) / Math.max(1, px));
    }

    /**
     * SPEC3 1.2: a press on a draggable target waits for the movement
     * threshold; anything else (empty space, a computed point, Space held,
     * the middle button, dragging switched off) pans as before. Touch edits
     * only the selected object: elsewhere it pans, and a tap selects.
     */
    private onPointerDown(e: PointerEvent) {
        const chart = this.chartEl;
        if (!chart) return;
        const middle = e.button === 1 && !this.is3D();
        if (e.button !== 0 && !middle) return;
        // A second finger or button while an object is pressed or dragged is ignored (no multi-touch editing).
        if (this.drag && (this.drag.kind === 'press' || this.drag.kind === 'object')) return;
        this.flushKeySession();
        this.readMods(e);
        // A press focuses the preview for the keys that follow, without the keyboard focus ring: the
        // browser would draw it after any key press before this one (Shift held for a Shift-drag,
        // Enter in a field), since the focus is set by script.
        chart.addClass('is-pointer-focus');
        chart.focus({ preventScroll: true });
        this.pendingClick = null;
        if (this.is3D()) {
            this.drag = {
                kind: 'rotate',
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                azimuth: num(this.settings.getValue('rotationZ'), 45),
                elevation: num(this.settings.getValue('rotationX'), 30),
            };
        } else {
            if (middle) e.preventDefault();
            const touch = e.pointerType === 'touch';
            const forcePan = middle || this.spaceHeld;
            const found = forcePan ? null : this.findTarget(e.clientX, e.clientY, e.target, e.pointerType);
            let lock: Lock | null = null;
            let tap: PendingClick['tap'] = null;
            if (found) {
                const known = this.prepCache.get(this.planKey(found.target, 'move'));
                if (found.target.lock) lock = found.target.lock;
                else if (known && 'lock' in known) lock = known.lock;
                else if (touch && (!this.selected || this.selected.key !== found.target.key)) tap = { target: found.target, grab: found.grab };
                else {
                    // Nothing changes visibly until the threshold: halo and chip stay as they are.
                    this.drag = {
                        kind: 'press',
                        pointerId: e.pointerId,
                        startX: e.clientX,
                        startY: e.clientY,
                        touch,
                        target: found.target,
                        grab: found.grab,
                        prepared: this.cachedPlan(found.target, found.grab, this.gestureFor(e.shiftKey && !touch)),
                    };
                    this.capture(e.pointerId);
                    return;
                }
            }
            if (!forcePan) this.pendingClick = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, touch, moved: false, lock, tap };
            if (!this.startPan(e)) return;
        }
        this.capture(e.pointerId);
        chart.addClass('is-dragging');
    }

    /** Start panning from the event's position; false when pan is locked or both axes are pinned. */
    private startPan(e: PointerEvent): boolean {
        const layout = this.layout;
        const box = this.svgBox();
        const panX = this.axisFree('x');
        const panY = this.axisFree('y');
        if (this.panLocked || !layout || !box || (!panX && !panY)) return false;
        this.drag = {
            kind: 'pan',
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            view: { ...layout.view },
            plot: { ...layout.plot },
            scale: box.s,
            panX,
            panY,
        };
        return true;
    }

    private capture(pointerId: number) {
        try {
            this.chartEl?.setPointerCapture(pointerId);
        } catch {
            // Without capture the drag still works while the pointer stays over the chart.
        }
    }

    private releaseCapture(pointerId: number) {
        const chart = this.chartEl;
        if (chart && chart.hasPointerCapture(pointerId)) chart.releasePointerCapture(pointerId);
    }

    /** See bindPreviewPointer: a lost capture ends an object drag (commit) or drops a press. */
    private onLostCapture(e: PointerEvent) {
        const drag = this.drag;
        if (!drag || drag.pointerId !== e.pointerId) return;
        if (drag.kind === 'object') this.finishObjectDrag(drag);
        else if (drag.kind === 'press') this.endDrag(e, true);
    }

    private onPointerMove(e: PointerEvent) {
        // A mouse or pen move without a button during a press or an object drag: the release never reached
        // the chart. End it as a release would, so button-less hover never keeps editing.
        const held = this.drag;
        if (held && held.pointerId === e.pointerId && e.pointerType !== 'touch' && e.buttons === 0 && (held.kind === 'press' || held.kind === 'object')) {
            if (held.kind === 'object') this.finishObjectDrag(held);
            else this.endDrag(e, true);
            return;
        }
        if (e.pointerType !== 'touch') this.lastPointer = { clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType };
        const click = this.pendingClick;
        if (click && click.pointerId === e.pointerId && !click.moved && Math.hypot(e.clientX - click.startX, e.clientY - click.startY) >= this.threshold(click.touch)) {
            click.moved = true;
        }
        const drag = this.drag;
        if (drag && drag.pointerId === e.pointerId) {
            if (drag.kind === 'rotate') this.moveRotate(drag, e);
            else if (drag.kind === 'pan') this.movePan(drag, e);
            else if (drag.kind === 'press') this.movePress(drag, e);
            else this.moveObject(drag, e);
        } else if (!drag && !this.is3D()) {
            this.readMods(e);
            if (e.buttons === 0) this.updateHover(e.clientX, e.clientY, e.target, e.pointerType, false);
            else this.clearHover();
        }
        if (!this.is3D()) this.updateReadout(e.clientX, e.clientY);
    }

    private endDrag(e: PointerEvent, cancelled: boolean) {
        const click = this.pendingClick;
        if (click && click.pointerId === e.pointerId) {
            this.pendingClick = null;
            if (!cancelled && !click.moved) this.onClick(click);
        }
        const drag = this.drag;
        if (!drag || drag.pointerId !== e.pointerId) return;
        if (drag.kind === 'object') {
            // pointercancel (the system took the pointer) restores like Escape.
            if (cancelled) this.cancelObjectDrag();
            else this.finishObjectDrag(drag);
            return;
        }
        this.drag = null;
        this.releaseCapture(e.pointerId);
        this.chartEl?.removeClass('is-dragging');
        // Released under the threshold: a click selects the object.
        if (drag.kind === 'press' && !cancelled) this.select(drag.target, drag.grab);
        if (e.pointerType !== 'touch' && e.buttons === 0) this.updateHover(e.clientX, e.clientY, null, e.pointerType, true);
    }

    private moveRotate(drag: Extract<DragState, { kind: 'rotate' }>, e: PointerEvent) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        // Vertical drag direction follows the plugin setting. Default
        // (invertDrag3D: false): drag down RAISES elevation (trackball-style,
        // "pulling the floor up"). invertDrag3D: true: drag down LOWERS
        // elevation (direct manipulation, the camera follows your finger).
        const invert = !!this.plugin?.data?.invertDrag3D;
        const azimuth = (((drag.azimuth + dx * AZIMUTH_DRAG_RATE) % 360) + 360) % 360;
        const elevation = Math.max(0, Math.min(90, drag.elevation + (invert ? dy : -dy) * ELEVATION_DRAG_RATE));
        this.applyRotation(Math.round(azimuth), Math.round(elevation));
    }

    private movePan(drag: Extract<DragState, { kind: 'pan' }>, e: PointerEvent) {
        const sensitivity = this.plugin?.data?.dragSensitivity2D ?? 1;
        const v = drag.view;
        const xSpan = v.xmax - v.xmin;
        const ySpan = v.ymax - v.ymin;
        const dx = drag.panX ? (-(e.clientX - drag.startX) / drag.scale / drag.plot.w) * xSpan * sensitivity : 0;
        const dy = drag.panY ? ((e.clientY - drag.startY) / drag.scale / drag.plot.h) * ySpan * sensitivity : 0;
        this.writeView({ xmin: v.xmin + dx, xmax: v.xmax + dx, ymin: v.ymin + dy, ymax: v.ymax + dy }, drag.panX, drag.panY);
    }

    // ================================================================ drag to edit (SPEC3 1.2 to 1.12)

    private threshold(touch: boolean): number {
        return touch ? PRESS_THRESHOLD_TOUCH_PX : PRESS_THRESHOLD_PX;
    }

    /** Shift and Alt are read from every pointer event (never cached across events). */
    private readMods(e: { shiftKey: boolean; altKey: boolean }): Mods {
        this.mods = { shift: e.shiftKey, alt: e.altKey };
        return this.mods;
    }

    private dragEditOn(): boolean {
        const plugin = this.plugin;
        return plugin ? plugin.data.dragEdit !== false : this.dragEditLocal;
    }

    private toggleDragEdit() {
        const on = !this.dragEditOn();
        const plugin = this.plugin;
        if (plugin) {
            plugin.data.dragEdit = on;
            void plugin.saveSettings().catch(() => new Notice('Could not update the plugin data file.'));
        } else {
            this.dragEditLocal = on;
        }
        if (!on) {
            this.flushKeySession();
            this.clearSelection();
            this.clearHover();
            this.hideChip();
        }
        this.updatePill();
        this.syncHeader();
    }

    /**
     * Shift held = the pivot gesture for every target: the session starts in
     * the state Shift says (a mismatch would re-base on the first frame).
     * Point-like targets plan it as a straight Move, targets without a
     * Shift feature as a Move (session.ts).
     */
    private gestureFor(shift: boolean): Gesture {
        return shift ? 'pivot' : 'move';
    }

    /** The engine's view of the chart (lazy, rebuilt after every render and resize). */
    private dragContext(): DragContext | null {
        if (this.dragCtx) return this.dragCtx;
        if (this.is3D() || this.chartMode !== '2d') return null;
        const layout = this.layout;
        const box = this.svgBox();
        const hits = this.hits;
        if (!layout || !box || !hits) return null;
        const view = layout.view;
        const sx = view.xmax - view.xmin;
        const sy = view.ymax - view.ymin;
        if (!(sx > 0) || !(sy > 0) || layout.plot.w <= 0 || layout.plot.h <= 0) return null;
        try {
            const math = this.math();
            const parameters = this.list<Parameter>('parameters');
            math.setParams(parameters);
            const ranges = (['xmin', 'xmax', 'ymin', 'ymax'] as const).map((k) => str(this.settings.getValue(k)));
            const mac = Platform.isMacOS;
            this.dragCtx = {
                functions: this.list<FunctionParameters>('functions'),
                tools: this.list<Tool>('tools'),
                annotations: this.list<Annotation>('annotations'),
                parameters,
                math,
                mathInput: this.settings.mathContextInput(),
                hits,
                map: { view: { ...view }, kx: (layout.plot.w * box.s) / sx, ky: (layout.plot.h * box.s) / sy },
                ticks: layout.ticks ?? { x: [], y: [] },
                polar: this.isPolar(),
                axisSliders: axisSliders(ranges, math),
                keyNames: { mod: mac ? 'Cmd' : 'Ctrl', alt: mac ? 'Option' : 'Alt' },
            };
        } catch (e) {
            logError(e);
            return null;
        }
        return this.dragCtx;
    }

    /** The settings arrays the engine reads and writes (live objects). */
    private chartData(): { functions: FunctionParameters[]; tools: Tool[]; annotations: Annotation[]; parameters: Parameter[] } {
        return {
            functions: this.list<FunctionParameters>('functions'),
            tools: this.list<Tool>('tools'),
            annotations: this.list<Annotation>('annotations'),
            parameters: this.list<Parameter>('parameters'),
        };
    }

    /** Card source of a field: 'f1', 'R1', 'label:2' (null when the item is gone). */
    private sourceOf(ref: FieldRef): string | null {
        if (ref.kind === 'function') return ref.name;
        if (ref.kind === 'label') return `label:${ref.index}`;
        const tool = this.list<Tool>('tools').find((t) => t.id === ref.id);
        return tool ? tool.name : null;
    }

    /** What is under the pointer: a label (by DOM), else the hit index (only with dragging on). */
    private probe(clientX: number, clientY: number, el: EventTarget | null, pointerType: string): { hitKey: string; grab: Pt; hit: Hit | null; label: number | null } | null {
        const ctx = this.dragContext();
        const p = this.toMath(clientX, clientY);
        if (!ctx || !p) return null;
        const at = { x: p.x, y: p.y };
        const label = this.labelAt(el);
        if (label !== null) return { hitKey: `label:${label}`, grab: at, hit: null, label };
        if (!this.dragEditOn()) return null;
        let hit: Hit | null = null;
        const tol = pointerType === 'touch' ? TOLERANCE_TOUCH : TOLERANCE_MOUSE;
        try {
            hit = ctx.hits.pick(at, tol, ctx.map);
            if (hit) hit = this.preferUnlockedLine(hit, at, tol, ctx);
        } catch (e) {
            logError(e);
        }
        if (!hit) return null;
        return { hitKey: hit.passed ? `${hit.shape.key}+${hit.passed.key}` : hit.shape.key, grab: hit.at, hit, label: null };
    }

    /**
     * A line whose plain drag is locked (a derived level like `P1_val`, a clause reading `P1_y`) gives way
     * to an unlocked line drawn within 1 px of it: the levels example draws C2 (`P1_val` = 3.2) exactly
     * over C1's level 3.2, and the 3.2 circle should push C1's level rather than pan. Where the locked
     * line is alone it is picked as before (lock chip, a press pans).
     */
    private preferUnlockedLine(hit: Hit, at: Pt, tol: HitTolerance, ctx: DragContext): Hit {
        if (hit.shape.point || !hit.shape.lines.length || !this.lineLocked(hit, ctx)) return hit;
        let best: Hit | null = null;
        for (const shape of ctx.hits.all()) {
            if (shape.key === hit.shape.key || shape.point || shape.locked || !shape.lines.length) continue;
            const near = nearestOnShape(shape, at, ctx.map);
            const d = distPx(near.at, at, ctx.map);
            if (d > tol.line || d > hit.distPx + 1 || (best && d >= best.distPx)) continue;
            const alt: Hit = { shape, at: near.at, run: near.run, distPx: d, passed: hit.passed };
            if (!this.lineLocked(alt, ctx)) best = alt;
        }
        return best ?? hit;
    }

    /** Whether a line hit's target cannot be dragged plainly (cached per shape and render). */
    private lineLocked(hit: Hit, ctx: DragContext): boolean {
        const key = `${this.renderVersion}|${hit.shape.key}`;
        const known = this.lineLocks.get(key);
        if (known !== undefined) return known;
        let locked = true;
        try {
            const target = resolveTarget(hit, ctx);
            locked = !!target.lock || 'lock' in this.prepare(target, hit.at, 'move', ctx, HOVER_REPLAN_PX);
        } catch (e) {
            logError(e);
        }
        if (this.lineLocks.size > 256) this.lineLocks.clear();
        this.lineLocks.set(key, locked);
        return locked;
    }

    private resolveProbe(probe: { grab: Pt; hit: Hit | null; label: number | null }): DragTarget | null {
        const ctx = this.dragContext();
        if (!ctx) return null;
        try {
            if (probe.label !== null) return resolveTarget({ label: probe.label, at: probe.grab }, ctx);
            return probe.hit ? resolveTarget(probe.hit, ctx) : null;
        } catch (e) {
            logError(e);
            return null;
        }
    }

    private findTarget(clientX: number, clientY: number, el: EventTarget | null, pointerType: string): Found | null {
        const probe = this.probe(clientX, clientY, el, pointerType);
        if (!probe) return null;
        const target = this.resolveProbe(probe);
        return target ? { target, grab: probe.grab, hitKey: probe.hitKey } : null;
    }

    private planKey(target: DragTarget, gesture: Gesture): string {
        return `${target.key}|${gesture}|${this.renderVersion}`;
    }

    /**
     * Plan a drag (cached per target, gesture and render). A cached plan is
     * reused while its grab point lies within `reusePx` of `grab`: the hover
     * chip tolerates the pointer sliding along the object, a press does not
     * (the first frame would jump by the difference). A Shift plan is also
     * re-made when the slide leaves its ⊕ dead for the new grab (preparedServes).
     */
    private prepare(target: DragTarget, grab: Pt, gesture: Gesture, ctx: DragContext, reusePx: number): PreparedDrag | { lock: Lock } {
        if (target.lock) return { lock: target.lock };
        const key = this.planKey(target, gesture);
        const cached = this.prepCache.get(key);
        if (cached && ('lock' in cached || preparedServes(cached, grab, ctx.map, reusePx))) return cached;
        let plan: PreparedDrag | { lock: Lock };
        try {
            plan = prepareDrag(target, grab, gesture, ctx);
        } catch (e) {
            logError(e);
            plan = { lock: lockFor({ kind: 'cannotDragHere', subject: target.subject }) };
        }
        this.prepCache.set(key, plan);
        return plan;
    }

    /** The hover plan for a press at `grab`, when it was made for (almost) the same point. */
    private cachedPlan(target: DragTarget, grab: Pt, gesture: Gesture): PreparedDrag | null {
        const ctx = this.dragContext();
        const cached = this.prepCache.get(this.planKey(target, gesture));
        if (!ctx || !cached || 'lock' in cached) return null;
        return preparedServes(cached, grab, ctx.map, PRESS_REUSE_PX) ? cached : null;
    }

    // ---------------------------------------------------------------- cursor, chip, overlay

    /** Exactly one drag cursor class on the chart (null: the chart's own cursor). */
    private setCursor(cls: CursorClass | null) {
        const chart = this.chartEl;
        if (!chart) return;
        for (const c of CURSOR_CLASSES) chart.toggleClass(c, c === cls);
    }

    /** Hover chip in the readout corner (the readout hides meanwhile). */
    private dockChip(chip: Chip) {
        if (!this.dragHint) return;
        this.dragHint.dock(chip);
        this.hintDocked = true;
        this.readoutEl?.addClass('tikz-hidden');
    }

    private hideChip() {
        if (this.chipTimer !== null) window.clearTimeout(this.chipTimer);
        this.chipTimer = null;
        this.dragHint?.hide();
        this.hintDocked = false;
    }

    /** A chip for a while (lock after a click, the tip); then the hover chip again, or nothing. */
    private showTransientChip(chip: Chip, ms: number) {
        this.dockChip(chip);
        if (this.chipTimer !== null) window.clearTimeout(this.chipTimer);
        this.chipTimer = window.setTimeout(() => {
            this.chipTimer = null;
            if (this.hover && this.hover.chipShown && !this.drag) this.showHoverChip();
            else if (!(this.drag && this.drag.kind === 'object')) {
                this.dragHint?.hide();
                this.hintDocked = false;
            }
        }, ms);
    }

    /** Place the overlay over the chart again and re-draw what it shows (after renders and resizes). */
    private syncOverlay() {
        const layer = this.dragLayer;
        const chart = this.chartEl;
        const svg = this.chartSvg;
        const layout = this.layout;
        if (!layer || !chart) return;
        if (!svg || !layout || this.chartMode !== '2d') {
            layer.clear();
            return;
        }
        layer.sync(layout, chart, svg);
        const overlay = this.dragOverlay;
        if (overlay && this.drag && this.drag.kind === 'object') {
            layer.ghost(overlay.ghost, overlay.points);
            layer.pivot(overlay.pivot, overlay.pivot ? this.drag.cursor : null);
            layer.snap(overlay.snapped);
        }
        this.drawSelection();
    }

    // ---------------------------------------------------------------- hover

    /**
     * Hit test on every button-less pointer move: halo and cursor at once,
     * the chip after HOVER_DWELL_MS on the same target. `force` re-resolves
     * the target even when the same shape is under the pointer (after a
     * render the shape may have moved).
     */
    private updateHover(clientX: number, clientY: number, el: EventTarget | null, pointerType: string, force: boolean) {
        if (this.is3D() || this.spaceHeld || this.drag) {
            this.clearHover();
            return;
        }
        const element = el ?? this.chartEl?.ownerDocument.elementFromPoint(clientX, clientY) ?? null;
        const probe = this.probe(clientX, clientY, element, pointerType);
        if (!probe) {
            this.clearHover();
            return;
        }
        const cur = this.hover;
        if (cur && cur.hitKey === probe.hitKey && !force) {
            cur.grab = probe.grab;
            cur.clientX = clientX;
            cur.clientY = clientY;
            this.drawHover();
            // Shift pressed or released while the focus was elsewhere: the chip changes gesture.
            if (cur.chipShown && cur.chipShift !== this.mods.shift) this.showHoverChip();
            // Slid along the object far from the planned grab: the pivot preview and the chip are re-planned after the dwell.
            else if (cur.chipShown && this.hoverPlanStale(cur.target, cur.grab)) this.scheduleDwell();
            return;
        }
        const target = this.resolveProbe(probe);
        if (!target) {
            this.clearHover();
            return;
        }
        const same = !!cur && cur.key === target.key;
        if (cur && cur.timer !== null) window.clearTimeout(cur.timer);
        this.hover = {
            key: target.key,
            hitKey: probe.hitKey,
            target,
            grab: probe.grab,
            timer: null,
            clientX,
            clientY,
            chipShown: same && !!cur && cur.chipShown,
            chipShift: cur ? cur.chipShift : this.mods.shift,
        };
        this.drawHover();
        if (this.hover.chipShown) this.showHoverChip();
        else this.scheduleDwell();
    }

    private scheduleDwell() {
        const h = this.hover;
        if (!h) return;
        if (h.timer !== null) window.clearTimeout(h.timer);
        h.timer = window.setTimeout(() => {
            h.timer = null;
            if (this.hover === h) this.showHoverChip();
        }, HOVER_DWELL_MS);
    }

    /**
     * The cached hover plan for the current gesture was made more than HOVER_REPLAN_PX away from `grab`, or
     * its ⊕ no longer serves `grab` (a stretch axis it kept live would be dead there).
     */
    private hoverPlanStale(target: DragTarget, grab: Pt): boolean {
        const ctx = this.dragContext();
        const plan = this.prepCache.get(this.planKey(target, this.gestureFor(this.mods.shift)));
        if (!ctx || !plan || 'lock' in plan) return false;
        return !preparedServes(plan, grab, ctx.map, HOVER_REPLAN_PX);
    }

    /** Re-run the hover at the last pointer position (after Space is released, after a drag). */
    private rehover() {
        const p = this.lastPointer;
        if (p) this.updateHover(p.clientX, p.clientY, null, p.pointerType, true);
    }

    private drawHover() {
        const h = this.hover;
        const layer = this.dragLayer;
        if (!h || !layer) return;
        const t = h.target;
        // Locked: no halo, the chart's own cursor (a press pans), the lock in the chip.
        const plan = this.prepCache.get(this.planKey(t, 'move'));
        if (t.lock || (plan && 'lock' in plan)) {
            layer.hover(null, null, null);
            this.setCursor(null);
            return;
        }
        // Dragging switched off: labels still move, without halo or chip.
        if (!this.dragEditOn()) {
            layer.hover(null, null, null);
            this.setCursor('is-over-object');
            return;
        }
        const pointLike = !t.lines.length;
        layer.hover(pointLike ? null : t.lines, pointLike ? (t.points[0] ?? null) : null, h.grab);
        const restricted = plan && !('lock' in plan) ? plan.info.restricted : 'none';
        this.setCursor(restricted === 'vertical' ? 'is-over-object-ns' : restricted === 'horizontal' ? 'is-over-object-ew' : 'is-over-object');
    }

    /** After the dwell: plan (cached), dock the chip, and with Shift held preview the pivot. */
    private showHoverChip() {
        const h = this.hover;
        if (!h || this.drag || !this.dragEditOn()) return;
        h.chipShown = true;
        h.chipShift = this.mods.shift;
        if (h.target.lock) {
            this.dockChip(lockChip(h.target.lock));
            this.dragLayer?.pivot(null, null);
            return;
        }
        if (this.maybeShowTip()) return;
        const ctx = this.dragContext();
        if (!ctx) return;
        const gesture = this.gestureFor(this.mods.shift);
        const plan = this.prepare(h.target, h.grab, gesture, ctx, HOVER_REPLAN_PX);
        if ('lock' in plan) {
            // Nothing can change: drop the halo and say why (a press pans).
            this.dragLayer?.hover(null, null, null);
            this.dragLayer?.pivot(null, null);
            this.setCursor(null);
            if (Date.now() >= this.tipUntil) this.dockChip(lockChip(plan.lock));
            return;
        }
        if (Date.now() >= this.tipUntil) this.dockChip(plan.chip);
        this.dragLayer?.pivot(gesture === 'pivot' && plan.info.pivot ? plan.info.pivot.at : null, null);
        this.drawHover();
    }

    /** The first hover over a draggable target ever shows the tip for TIP_MS (SPEC3 1.12). */
    private maybeShowTip(): boolean {
        const plugin = this.plugin;
        if (!plugin || plugin.data.dragTipSeen) return false;
        plugin.data.dragTipSeen = true;
        void plugin.saveSettings().catch(() => undefined);
        this.tipUntil = Date.now() + TIP_MS;
        this.showTransientChip(tipChip({ mod: Platform.isMacOS ? 'Cmd' : 'Ctrl' }), TIP_MS);
        return true;
    }

    private clearHover() {
        const h = this.hover;
        if (h && h.timer !== null) window.clearTimeout(h.timer);
        this.hover = null;
        const dragging = !!this.drag && this.drag.kind === 'object';
        this.dragLayer?.hover(null, null, null);
        if (!dragging) {
            this.dragLayer?.pivot(null, null);
            this.setCursor(this.spaceHeld ? 'is-space-pan' : null);
            // A transient chip (lock after a click, the tip) keeps its time; the hover chip goes.
            if (this.chipTimer === null && !this.keySession) {
                this.dragHint?.hide();
                this.hintDocked = false;
            }
        }
    }

    // ---------------------------------------------------------------- selection

    private labelIndexOf(target: DragTarget): number | null {
        const ref = target.units[0]?.ref;
        return target.kind === 'label' && ref && ref.kind === 'label' ? ref.index : null;
    }

    /** Text of the target's first field, for announcements. */
    private unitText(target: DragTarget): string {
        const ref = target.units[0]?.ref;
        return (ref && fieldText(ref, this.chartData())) ?? '';
    }

    /** Click on a draggable target (SPEC3 1.9): selection halo, card flash, announcement; focus stays on the chart. */
    private select(target: DragTarget, grab: Pt) {
        if (target.lock) return;
        const prev = this.selected;
        if (prev && prev.key === target.key) {
            prev.target = target;
            prev.grab = grab;
            prev.stale = false;
        } else {
            this.clearSelection();
            this.selected = {
                key: target.key,
                target,
                grab,
                label: this.labelIndexOf(target),
                stale: false,
                // Escape clears the selection before it can close the editor.
                releaseEscape: trapEscape(this, () => this.clearSelection()),
            };
        }
        this.drawSelection();
        if (this.activeTab === 'build') this.build?.flash?.(target.cardSource);
        this.announce(selectAnnouncement(target, this.unitText(target)));
    }

    private clearSelection() {
        const sel = this.selected;
        if (!sel) return;
        this.flushKeySession();
        this.selected = null;
        sel.releaseEscape();
        this.dragLayer?.selection(null, null);
    }

    /**
     * The selected target, re-resolved after renders by key (labels by
     * index). Null when its item is gone or it cannot be dragged any more:
     * the selection is dropped then.
     */
    private selectionTarget(): DragTarget | null {
        const sel = this.selected;
        if (!sel) return null;
        if (!sel.stale) return sel.target;
        const ctx = this.dragContext();
        if (!ctx) return null;
        let target: DragTarget | null = null;
        try {
            if (sel.label !== null) {
                if (this.list<Annotation>('annotations')[sel.label]) target = resolveTarget({ label: sel.label, at: sel.grab }, ctx);
            } else {
                const shape = ctx.hits.byKey(sel.key);
                if (shape) {
                    const near = nearestOnShape(shape, sel.grab, ctx.map);
                    target = resolveTarget({ shape, at: near.at, run: near.run, distPx: 0, passed: null }, ctx);
                    sel.grab = near.at;
                }
            }
        } catch (e) {
            logError(e);
        }
        if (!target || target.lock) {
            this.clearSelection();
            return null;
        }
        sel.target = target;
        sel.stale = false;
        return target;
    }

    /** Selection halo from the current picture (the hit shape by key; labels: their anchor). */
    private drawSelection() {
        const sel = this.selected;
        const layer = this.dragLayer;
        if (!sel || !layer) return;
        // Mid-drag a frame may lack the shape for a moment (an erroring text): keep the selection until the drag ends.
        const dragging = (!!this.drag && this.drag.kind === 'object') || !!this.keySession;
        if (sel.label !== null) {
            if (dragging) {
                // The label moves under the drag: its ring follows the current position.
                const a = this.list<Annotation>('annotations')[sel.label];
                const ctx = this.dragContext();
                if (!a || !ctx) return;
                try {
                    const at = { x: ctx.math.value(str(a.x), NaN), y: ctx.math.value(str(a.y), NaN) };
                    if (Number.isFinite(at.x) && Number.isFinite(at.y)) layer.selection(null, at);
                } catch {
                    // A half-written position: keep the last ring.
                }
                return;
            }
            const target = this.selectionTarget();
            if (target) layer.selection(null, target.points[0] ?? sel.grab);
            return;
        }
        const shape = this.hits ? this.hits.byKey(sel.key) : null;
        if (!shape) {
            // Deleted item, hidden or erroring: the selection goes with it.
            if (this.hits && !dragging) this.clearSelection();
            else layer.selection(null, null);
            return;
        }
        layer.selection(shape.lines.length ? shape.lines : null, shape.lines.length ? null : shape.point);
    }

    private onClick(click: PendingClick) {
        if (click.lock) {
            this.showTransientChip(lockChip(click.lock), LOCK_CHIP_MS);
            return;
        }
        if (click.tap) {
            this.select(click.tap.target, click.tap.grab);
            return;
        }
        this.clearSelection();
    }

    private onDoubleClick(e: MouseEvent) {
        if (this.is3D()) return;
        const found = this.findTarget(e.clientX, e.clientY, e.target, 'mouse');
        if (!found || found.target.lock) return;
        e.preventDefault();
        this.revealTarget(found.target, found.grab);
    }

    /** Focus the target's field and select the first number a Move would change (SPEC3 1.9). */
    private revealTarget(target: DragTarget, grab: Pt) {
        this.flushKeySession();
        let selectText: string | undefined;
        const ctx = this.dragContext();
        if (ctx) {
            const plan = this.prepare(target, grab, 'move', ctx, HOVER_REPLAN_PX);
            if (!('lock' in plan)) {
                const span = plan.info.numSpans[0];
                if (span) selectText = plan.info.text.slice(span[0], span[1]) || undefined;
            }
        }
        this.showTab('build');
        this.build?.reveal(target.cardSource, target.cardField, selectText);
    }

    private announce(text: string) {
        if (!this.announcer || !text) return;
        if (this.announceTimer !== null) window.clearTimeout(this.announceTimer);
        this.announceTimer = window.setTimeout(() => {
            this.announceTimer = null;
            this.announcer?.setText(text);
        }, ANNOUNCE_DELAY_MS);
    }

    // ---------------------------------------------------------------- object drag

    /** The press passed the threshold: plan with the gesture of this event, then run the session. */
    private movePress(drag: Extract<DragState, { kind: 'press' }>, e: PointerEvent) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < this.threshold(drag.touch)) return;
        const mods = this.readMods(e);
        const ctx = this.dragContext();
        if (!ctx) {
            this.drag = null;
            this.releaseCapture(drag.pointerId);
            return;
        }
        // Touch edits by Move only in Phase 1 (the Shift features need the Phase 2 handle).
        const gesture = this.gestureFor(mods.shift && !drag.touch);
        const plan = drag.prepared && drag.prepared.gesture === gesture ? drag.prepared : this.prepare(drag.target, drag.grab, gesture, ctx, PRESS_REUSE_PX);
        if ('lock' in plan) {
            // Nothing to change after all: pan from here (never a dead zone) and say why.
            this.drag = null;
            this.showTransientChip(lockChip(plan.lock), LOCK_CHIP_MS);
            if (this.startPan(e)) this.chartEl?.addClass('is-dragging');
            else this.releaseCapture(drag.pointerId);
            return;
        }
        let session: DragSession;
        try {
            session = DragSession.start(plan, mods, ctx);
        } catch (err) {
            logError(err);
            this.drag = null;
            if (this.startPan(e)) this.chartEl?.addClass('is-dragging');
            else this.releaseCapture(drag.pointerId);
            return;
        }
        this.clearHover();
        this.hideChip();
        // Playing sliders would fight the drag over the same numbers.
        this.dock?.stopAnimations();
        this.objectDragActive = true;
        const target = session.target;
        this.build?.markLive?.(target.cardSource, target.cardField);
        const points = !target.lines.length && target.points.length ? target.points : null;
        this.dragOverlay = { ghost: session.ghost, points, pivot: null, snapped: null };
        this.dragLayer?.ghost(session.ghost, points);
        // The grabbed point keeps its offset from the pointer: the object moves by the pointer's motion from
        // the press, so passing the threshold never jumps it onto the pointer (AC3 reads against this cursor).
        const start = this.toMath(drag.startX, drag.startY);
        const offset = start ? { x: drag.grab.x - start.x, y: drag.grab.y - start.y } : { x: 0, y: 0 };
        const p = this.toMath(e.clientX, e.clientY);
        const cursor = p ? { x: p.x + offset.x, y: p.y + offset.y } : drag.grab;
        this.liveFrame = null;
        const object: Extract<DragState, { kind: 'object' }> = {
            kind: 'object',
            pointerId: drag.pointerId,
            touch: drag.touch,
            session,
            lastX: e.clientX,
            lastY: e.clientY,
            // Escape cancels the drag (restores every text and slider) instead of closing the editor,
            // also while Shift or Alt is still held for the gesture.
            releaseEscape: trapEscape(this, () => this.cancelObjectDrag(), true),
            mods,
            cursor,
            offset,
        };
        this.drag = object;
        this.setCursor('is-dragging-object');
        this.runUpdate(object, cursor, mods, e.clientX, e.clientY);
    }

    private moveObject(drag: Extract<DragState, { kind: 'object' }>, e: PointerEvent) {
        const p = this.toMath(e.clientX, e.clientY);
        if (!p) return;
        this.runUpdate(drag, { x: p.x + drag.offset.x, y: p.y + drag.offset.y }, this.readMods(e), e.clientX, e.clientY);
    }

    /** One session update and its frame (pointer moves, and Shift / Alt changes without a move). */
    private runUpdate(drag: Extract<DragState, { kind: 'object' }>, cursor: Pt, mods: Mods, clientX: number, clientY: number) {
        const m: Mods = drag.touch ? { shift: false, alt: mods.alt } : mods;
        let frame: DragFrame;
        try {
            frame = drag.session.update(cursor, m);
        } catch (e) {
            // update() never throws by contract; keep the last frame if it does.
            logError(e);
            return;
        }
        drag.mods = m;
        drag.cursor = cursor;
        drag.lastX = clientX;
        drag.lastY = clientY;
        this.applyFrame(frame, { clientX, clientY, cursor });
    }

    /**
     * Write one frame: field texts, slider values, card and dock sync, the
     * chip, the overlay; then a draft render next frame and a full one
     * 150 ms after the last (requestFrame). `at` is null for keyboard nudges
     * (the chip stays docked).
     */
    private applyFrame(frame: DragFrame, at: { clientX: number; clientY: number; cursor: Pt } | null) {
        const data = this.chartData();
        const sources = new Set<string>();
        if (!this.liveFrame) this.liveFrame = { texts: new Map(), params: new Map() };
        const live = this.liveFrame;
        for (const edit of frame.edits) {
            if (!setFieldText(edit.ref, data, edit.text)) continue;
            live.texts.set(refKey(edit.ref), edit.text);
            const source = this.sourceOf(edit.ref);
            if (source) sources.add(source);
        }
        if (frame.params.length) {
            for (const edit of frame.params) {
                const p = data.parameters.find((q) => q.name === edit.name);
                if (!p) continue;
                p.value = edit.value;
                live.params.set(edit.name, edit.value);
            }
        }
        // A function text changed: the next render builds a fresh (unmemoized) context.
        if (frame.structural) this.mathCtx = null;
        this.syncCards(sources);
        if (frame.params.length) {
            this.dock?.syncValues();
            this.dock?.markLive?.(frame.params.map((p) => p.name));
        }
        if (at) this.dragHint?.follow(frame.chip, at.clientX, at.clientY);
        else this.dockChip(frame.chip);
        if (this.dragOverlay) {
            this.dragOverlay.pivot = frame.pivot;
            this.dragOverlay.snapped = frame.snapped;
        }
        this.dragLayer?.pivot(frame.pivot, frame.pivot && at ? at.cursor : null);
        this.dragLayer?.snap(frame.snapped);
        if (at) this.setCursor(frame.restricted === 'vertical' ? 'is-over-object-ns' : frame.restricted === 'horizontal' ? 'is-over-object-ew' : 'is-dragging-object');
        this.requestFrame();
    }

    /** Re-read the edited items' card inputs (the cards of the target and its twins). */
    private syncCards(sources: Set<string>) {
        const build = this.build;
        if (!build || !sources.size) return;
        if (build.syncItem) {
            for (const source of sources) build.syncItem(source);
            return;
        }
        // Panels without syncItem: labels re-read their position, everything else refreshes once.
        let other = false;
        for (const source of sources) {
            const label = /^label:(\d+)$/.exec(source);
            if (label) build.syncAnnotation(Number(label[1]));
            else other = true;
        }
        if (other) build.refresh();
    }

    private endLiveMarks() {
        this.build?.markLive?.(null, null);
        this.dock?.markLive?.([]);
    }

    /** Leave the object state: Escape trap, pointer capture, overlay, chip, cursor, live marks. */
    private endObjectDrag(drag: Extract<DragState, { kind: 'object' }>) {
        drag.releaseEscape();
        if (this.drag === drag) this.drag = null;
        this.objectDragActive = false;
        this.releaseCapture(drag.pointerId);
        this.dragOverlay = null;
        this.dragLayer?.ghost(null, null);
        this.dragLayer?.pivot(null, null);
        this.dragLayer?.snap(null);
        this.hideChip();
        this.setCursor(this.spaceHeld ? 'is-space-pan' : null);
        this.endLiveMarks();
        if (this.selected) this.selected.stale = true;
    }

    /** Release: one history entry, the undo bar (plus Make slider), the announcement, then commit. */
    private finishObjectDrag(drag: Extract<DragState, { kind: 'object' }>) {
        let commit: DragCommit | null = null;
        try {
            commit = drag.session.commit();
        } catch (e) {
            logError(e);
        }
        this.endObjectDrag(drag);
        if (commit) this.recordCommit(commit, drag.session.target);
        this.commit();
        // The pointer still rests on the object: hover it again once the committed picture is drawn.
        this.rehoverPending = true;
    }

    /**
     * Write the committed texts and slider values: tidy at release can differ from the last frame
     * (`1x + 1` becomes `x + 1`), and the history patches compare against these after-values.
     */
    private applyCommit(commit: DragCommit): DragCommit | null {
        const data = this.chartData();
        const live = this.liveFrame;
        this.liveFrame = null;
        const sources = new Set<string>();
        const fields: DragCommit['fields'] = [];
        for (const patch of commit.fields) {
            const now = fieldText(patch.ref, data);
            const last = live ? live.texts.get(refKey(patch.ref)) : undefined;
            // Edited since the session's last frame (typed into its card, another panel): that edit wins,
            // and the patch leaves the history entry (an undo must not restore over it either).
            if (now === null || (last !== undefined && now !== last && now !== patch.after)) continue;
            fields.push(patch);
            if (now === patch.after || !setFieldText(patch.ref, data, patch.after)) continue;
            const source = this.sourceOf(patch.ref);
            if (source) sources.add(source);
        }
        const params: DragCommit['params'] = [];
        for (const patch of commit.params) {
            const p = data.parameters.find((q) => q.name === patch.name);
            if (!p) continue;
            const last = live ? live.params.get(patch.name) : undefined;
            if (last !== undefined && p.value !== last && p.value !== patch.after) continue;
            params.push(patch);
            p.value = patch.after;
        }
        this.syncCards(sources);
        if (params.length) this.dock?.syncValues();
        if (!fields.length && !params.length) return null;
        if (fields.length === commit.fields.length && params.length === commit.params.length) return commit;
        const kept = new Set(fields.map((f) => refKey(f.ref)));
        const offer = commit.makeSlider && kept.has(refKey(commit.makeSlider.ref)) ? commit.makeSlider : null;
        return { ...commit, fields, params, makeSlider: offer };
    }

    private recordCommit(raw: DragCommit, target: DragTarget) {
        const commit = this.applyCommit(raw);
        if (!commit) return;
        const entry = patchEntry(commit, this.patchIO());
        this.history.push(entry);
        const offer = commit.makeSlider;
        this.showUndoBar(entry, offer ? { text: MAKE_SLIDER_BUTTON, run: () => this.makeSlider(offer) } : undefined);
        this.announce(commit.announce);
        if (this.activeTab === 'build') this.build?.flash?.(target.cardSource);
    }

    /** Escape or pointercancel during an object drag: every text and slider back to its start value, no history entry. */
    private cancelObjectDrag() {
        const drag = this.drag;
        if (!drag || drag.kind !== 'object') return;
        this.restoreStart(drag.session);
        this.endObjectDrag(drag);
        this.commit();
    }

    /** Drop a press or object drag without a history entry (mode switches, close). */
    private abortObjectDrag(commit: boolean) {
        const drag = this.drag;
        if (!drag) return;
        if (drag.kind === 'press') {
            this.drag = null;
            this.releaseCapture(drag.pointerId);
            return;
        }
        if (drag.kind !== 'object') return;
        this.restoreStart(drag.session);
        this.endObjectDrag(drag);
        if (commit) this.commit();
    }

    private restoreStart(session: DragSession) {
        this.liveFrame = null;
        let start: { edits: FieldEdit[]; params: ParamEdit[] };
        try {
            start = session.cancel();
        } catch (e) {
            logError(e);
            return;
        }
        const data = this.chartData();
        const sources = new Set<string>();
        for (const edit of start.edits) {
            if (!setFieldText(edit.ref, data, edit.text)) continue;
            const source = this.sourceOf(edit.ref);
            if (source) sources.add(source);
        }
        for (const edit of start.params) {
            const p = data.parameters.find((q) => q.name === edit.name);
            if (p) p.value = edit.value;
        }
        this.mathCtx = null;
        this.syncCards(sources);
        this.dock?.syncValues();
    }

    /** Leaving the picture (2D / 3D, polar, another chart): drop drags, selection, hover, plans and the overlay. */
    private resetDrag() {
        this.abortObjectDrag(false);
        this.flushKeySession();
        this.clearSelection();
        this.clearHover();
        this.hideChip();
        this.pendingClick = null;
        this.dragOverlay = null;
        this.dragLayer?.clear();
        this.prepCache.clear();
        this.lineLocks.clear();
        this.dragCtx = null;
    }

    // ---------------------------------------------------------------- keyboard

    /** Arrow keys with a selection: Move by a tenth of the tick step (Shift x10, Alt x0.1), one undo step per second of presses. */
    private nudgeSelection(e: KeyboardEvent) {
        const sel = this.selected;
        const view = this.layout?.view;
        if (!sel || !view) return;
        const ks = this.keySession;
        const target = ks ? ks.session.target : this.selectionTarget();
        const ctx = this.dragContext();
        if (!target || !ctx) return;
        const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        const sign = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1;
        const span = horizontal ? view.xmax - view.xmin : view.ymax - view.ymin;
        const step = (niceInterval(span, 8) / 10) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
        if (!(step > 0) || !Number.isFinite(step)) return;
        const delta = horizontal ? { x: sign * step, y: 0 } : { x: 0, y: sign * step };
        let prepared = ks ? ks.prepared : null;
        if (!prepared) {
            const plan = this.prepare(target, sel.grab, 'move', ctx, PRESS_REUSE_PX);
            if ('lock' in plan) {
                this.showTransientChip(lockChip(plan.lock), LOCK_CHIP_MS);
                return;
            }
            prepared = plan;
        }
        let result: { session: DragSession; frame: DragFrame };
        try {
            // Shift and Alt scale the step here; they never turn or stop snapping.
            result = nudge(ks ? ks.session : null, prepared, delta, { shift: false, alt: false }, ctx);
        } catch (err) {
            logError(err);
            return;
        }
        if (!ks) {
            this.liveFrame = null;
            this.dock?.stopAnimations();
            this.objectDragActive = true;
            this.build?.markLive?.(target.cardSource, target.cardField);
        } else {
            window.clearTimeout(ks.timer);
        }
        this.keySession = { session: result.session, prepared, timer: window.setTimeout(() => this.flushKeySession(), KEY_SESSION_MS) };
        sel.grab = { x: sel.grab.x + delta.x, y: sel.grab.y + delta.y };
        this.applyFrame(result.frame, null);
    }

    /** Commit the running keyboard session as one history entry (1 s after the last press, or at once on any other action). */
    private flushKeySession() {
        const ks = this.keySession;
        if (!ks) return;
        this.keySession = null;
        window.clearTimeout(ks.timer);
        this.objectDragActive = false;
        this.endLiveMarks();
        let commit: DragCommit | null = null;
        try {
            commit = ks.session.commit();
        } catch (e) {
            logError(e);
        }
        if (!this.hover && this.chipTimer === null) this.hideChip();
        if (this.selected) this.selected.stale = true;
        if (commit) this.recordCommit(commit, ks.session.target);
        this.commit();
    }

    /** Close: the nudged texts stay as they are, without a history entry. */
    private dropKeySession() {
        const ks = this.keySession;
        if (!ks) return;
        this.keySession = null;
        this.liveFrame = null;
        window.clearTimeout(ks.timer);
        this.objectDragActive = false;
    }

    /**
     * Mod+Z / Mod+Shift+Z on the modal scope (SPEC3 1.11), plus capture
     * listeners for Space (pan over objects) and Shift / Alt (re-run the
     * drag or the hover chip without a pointer move).
     */
    private bindDragKeys() {
        const undoKey = (redo: boolean) => (): boolean => {
            // Text fields keep the browser's own text undo.
            if (isTextEditing(this.modalEl.ownerDocument.activeElement)) return true;
            // Ignored while an object is pressed or dragged: the press holds a plan of the current texts.
            if (this.drag && (this.drag.kind === 'object' || this.drag.kind === 'press')) return false;
            if (redo) this.redoLast();
            else this.undoLast();
            return false;
        };
        // Shift turns the key into 'Z' in some layouts and hosts: register both spellings.
        this.scope.register(['Mod'], 'z', undoKey(false));
        this.scope.register(['Mod'], 'Z', undoKey(false));
        this.scope.register(['Mod', 'Shift'], 'z', undoKey(true));
        this.scope.register(['Mod', 'Shift'], 'Z', undoKey(true));

        const down = (e: KeyboardEvent) => this.onDragKey(e, true);
        const up = (e: KeyboardEvent) => this.onDragKey(e, false);
        const blur = () => {
            // Keys released while the window was in the background never send keyup.
            if (this.spaceHeld) {
                this.spaceHeld = false;
                if (!(this.drag && this.drag.kind === 'object')) this.setCursor(null);
            }
        };
        this.modalEl.addEventListener('keydown', down, true);
        this.modalEl.addEventListener('keyup', up, true);
        window.addEventListener('blur', blur);
        this.onModalKeyDown = down;
        this.onModalKeyUp = up;
        this.onWindowBlur = blur;
    }

    private unbindDragKeys() {
        if (this.onModalKeyDown) this.modalEl.removeEventListener('keydown', this.onModalKeyDown, true);
        if (this.onModalKeyUp) this.modalEl.removeEventListener('keyup', this.onModalKeyUp, true);
        if (this.onWindowBlur) window.removeEventListener('blur', this.onWindowBlur);
        this.onModalKeyDown = this.onModalKeyUp = this.onWindowBlur = null;
    }

    private onDragKey(e: KeyboardEvent, down: boolean) {
        if (e.key === ' ' || e.code === 'Space') {
            if (down) {
                const doc = this.modalEl.ownerDocument;
                const active = doc.activeElement;
                const chartFocused = !!active && active === this.chartEl;
                // Space belongs to buttons, inputs and links that have focus.
                const free = chartFocused || !active || active === doc.body || !active.closest('input, textarea, select, button, a, [contenteditable="true"]');
                if (this.is3D() || !free || !(this.stageHovered || chartFocused)) return;
                e.preventDefault();
                if (this.spaceHeld) return;
                this.spaceHeld = true;
                this.clearHover();
                if (!(this.drag && this.drag.kind === 'object')) this.setCursor('is-space-pan');
            } else if (this.spaceHeld) {
                this.spaceHeld = false;
                if (!(this.drag && this.drag.kind === 'object')) this.setCursor(null);
                this.rehover();
            }
            return;
        }
        if (e.key !== 'Shift' && e.key !== 'Alt') return;
        const mods: Mods = { shift: e.shiftKey, alt: e.altKey };
        if (mods.shift === this.mods.shift && mods.alt === this.mods.alt) return;
        this.mods = mods;
        const drag = this.drag;
        if (drag && drag.kind === 'object') {
            // Shift re-bases the drag (Move, then turn, in one drag); Alt toggles snapping live.
            this.runUpdate(drag, drag.cursor, mods, drag.lastX, drag.lastY);
            return;
        }
        if (!drag && this.hover && this.hover.chipShown) this.showHoverChip();
    }

    private undoLast() {
        this.flushKeySession();
        const r = this.history.undo();
        if (!r) {
            this.showMessage('Nothing to undo');
            return;
        }
        const stale = this.staleMessage(r.entry, r.applied, false);
        if (stale) this.showMessage(stale);
        else this.showMessage(`Undone: ${r.entry.label}`, this.history.canRedo ? { text: 'Redo', run: () => this.redoLast() } : undefined);
    }

    private redoLast() {
        this.flushKeySession();
        const r = this.history.redo();
        if (!r) {
            this.showMessage('Nothing to redo');
            return;
        }
        const stale = this.staleMessage(r.entry, r.applied, true);
        if (stale) this.showMessage(stale);
        else this.showMessage(`Redone: ${r.entry.label}`, { text: UNDO_BUTTON, run: () => this.undoLast() });
    }

    /**
     * Bar text when an undo / redo skipped edited fields (SPEC3 1.8):
     * 'Nothing undone: R1 (2) was edited since', 'Undone, except R1 (2),
     * which was edited since'. Null when nothing was skipped.
     */
    private staleMessage(entry: HistoryEntry, applied: boolean, redo: boolean): string | null {
        const names = entry.stale ?? [];
        if (!redo) {
            const text = staleText(names, applied);
            if (text) return text;
            return applied ? null : `Nothing undone: ${labelSubject(entry.label)} was edited since`;
        }
        const verb = names.length > 1 ? 'were' : 'was';
        if (names.length) return applied ? `Redone, except ${joinNames(names)}, which ${verb} edited since` : `Nothing redone: ${joinNames(names)} ${verb} edited since`;
        return applied ? null : `Nothing redone: ${labelSubject(entry.label)} was edited since`;
    }

    /** History patches read and write the live settings, then commit (cards, dock, validators, render). */
    private patchIO(): PatchIO {
        return {
            read: (ref) => fieldText(ref, this.chartData()),
            write: (ref, text) => {
                setFieldText(ref, this.chartData(), text);
            },
            readParam: (name) => {
                const p = this.list<Parameter>('parameters').find((q) => q.name === name);
                return p ? p.value : null;
            },
            writeParam: (name, value) => {
                const p = this.list<Parameter>('parameters').find((q) => q.name === name);
                if (p) p.value = value;
            },
            done: () => {
                this.dock?.syncValues();
                this.commit();
            },
        };
    }

    // ---------------------------------------------------------------- Make slider

    /**
     * SPEC3 1.11: replace the dragged number with a new slider (and the
     * same number in the twin), starting at the written value. Undo puts
     * the number back where the text still holds the slider name and
     * removes the slider when no field reads it any more.
     */
    private makeSlider(offer: MakeSliderOffer) {
        this.flushKeySession();
        const data = this.chartData();
        const value = offer.value;
        const sites = [{ ref: offer.ref, span: offer.span }, ...offer.twins];
        const taken = [
            ...data.parameters.map((p) => p.name),
            ...data.functions.map((f) => f.name || ''),
            ...this.list<Function3DParameters>('functions3D').map((f) => f.name || ''),
            ...data.tools.map((t) => t.name),
        ];
        const name = defaultParameter(taken).name;
        const edits: Array<{ ref: FieldRef; before: string; after: string }> = [];
        for (const site of sites) {
            const before = fieldText(site.ref, data);
            if (before === null) continue;
            // The field was edited since the drag: its number is somewhere else now.
            const written = tokenValue(before.slice(site.span[0], site.span[1]));
            if (written === null || Math.abs(written - value) > 1e-9 * Math.max(1, Math.abs(value))) continue;
            edits.push({ ref: site.ref, before, after: makeSliderEdit(before, site.span, name) });
        }
        if (!edits.length) {
            this.showMessage('Nothing changed: the number was edited since');
            return;
        }
        for (const edit of edits) setFieldText(edit.ref, data, edit.after);
        const range = sliderRangeFor(value);
        const param: Parameter = { name, value, min: range.min, max: range.max, step: range.step };
        this.settings.setValue('parameters', data.parameters.concat([param]));
        const entry: HistoryEntry = {
            label: madeSliderText(name, value),
            undo: () => {
                const now = this.chartData();
                let restored = false;
                for (const edit of edits) {
                    if (fieldText(edit.ref, now) !== edit.after) continue;
                    setFieldText(edit.ref, now, edit.before);
                    restored = true;
                }
                if (!this.readsName(name)) {
                    this.settings.setValue(
                        'parameters',
                        this.list<Parameter>('parameters').filter((p) => p.name !== name)
                    );
                    restored = true;
                }
                this.commit();
                return restored;
            },
        };
        this.history.push(entry);
        this.showUndoBar(entry);
        this.commit();
    }

    /** True when any expression, template or range of the chart reads `name` (same fields as rename()). */
    private readsName(name: string): boolean {
        const probe = `${name}_etz_probe`;
        const reads = (src: string | undefined, template = false) => typeof src === 'string' && src !== '' && renameIdentifier(src, name, probe, template) !== src;
        for (const f of this.list<FunctionParameters>('functions')) {
            if (reads(f.expression) || reads(f.expressionY) || reads(f.domain) || (typeof f.tangentPoint === 'string' && reads(f.tangentPoint))) return true;
        }
        for (const s of this.list<Function3DParameters>('functions3D')) {
            if (reads(s.expression) || reads(s.xDomain) || reads(s.yDomain)) return true;
        }
        for (const t of this.list<Tool>('tools')) {
            switch (t.type) {
                case 'region':
                    if (t.conditions.some((c) => reads(c)) || t.conditionLabels.some((l) => reads(l, true)) || reads(t.label, true)) return true;
                    break;
                case 'curve':
                    if (reads(t.equation) || reads(t.levels) || reads(t.label, true)) return true;
                    break;
                case 'points':
                    if (reads(t.points) || reads(t.objective) || reads(t.label, true)) return true;
                    break;
                case 'segment':
                    if (reads(t.path) || reads(t.label, true)) return true;
                    break;
                case 'plane3D':
                    if (reads(t.value)) return true;
                    break;
            }
        }
        for (const a of this.list<Annotation>('annotations')) {
            if (reads(a.x) || reads(a.y) || reads(a.z) || reads(a.text, true)) return true;
        }
        for (const key of Object.keys(RANGE_DEFAULTS) as RangeKey[]) {
            const v = this.settings.getValue(key);
            if (typeof v === 'string' && reads(v)) return true;
        }
        const title = this.settings.getValue('title');
        return typeof title === 'string' && reads(title, true);
    }

    /**
     * Zoom around the pointer by an amount proportional to the wheel delta
     * (see wheelZoomSteps). Trackpads send dozens of small events per
     * gesture, so the steps are summed and applied once per frame, by the
     * next render (flushWheel): one settings write per frame, no rounding
     * drift from many tiny writes.
     */
    private onWheel(e: WheelEvent) {
        if (this.is3D() || this.panLocked || e.deltaY === 0) return;
        // The view stays fixed while an object is pressed or dragged (its px map belongs to the drag).
        if (this.drag && (this.drag.kind === 'press' || this.drag.kind === 'object')) {
            e.preventDefault();
            return;
        }
        if (!this.axisFree('x') && !this.axisFree('y')) return;
        const p = this.toMath(e.clientX, e.clientY);
        if (!p || p.fx < -0.05 || p.fx > 1.05 || p.fy < -0.05 || p.fy > 1.05) return;
        e.preventDefault();
        this.wheelSteps += wheelZoomSteps(e);
        this.wheelAnchor = { fx: p.fx, fy: p.fy };
        this.requestFrame();
    }

    /** Apply the wheel zoom collected since the last frame (renderNow calls this first). */
    private flushWheel() {
        const steps = this.wheelSteps;
        const anchor = this.wheelAnchor;
        this.dropPendingWheel();
        if (!anchor || steps === 0 || this.is3D() || this.panLocked) return;
        const zoomX = this.axisFree('x');
        const zoomY = this.axisFree('y');
        // Continue from the exact view of the previous wheel frame while the settings still hold
        // its rounded text: many tiny steps then add up without rounding drift.
        const kept = this.wheelView;
        const view = kept && kept.text === this.rangeText() ? kept.view : this.currentView();
        if (!view || (!zoomX && !zoomY)) return;
        const factor = Math.pow(WHEEL_ZOOM_FACTOR, steps);
        const xSpan = (view.xmax - view.xmin) * factor;
        const ySpan = (view.ymax - view.ymin) * factor;
        // Keep the math point under the pointer in place (the fractions do not depend on the view).
        const cx = view.xmin + anchor.fx * (view.xmax - view.xmin);
        const cy = view.ymax - anchor.fy * (view.ymax - view.ymin);
        const xmin = cx - anchor.fx * xSpan;
        const ymax = cy + anchor.fy * ySpan;
        const next: View = {
            xmin: zoomX ? xmin : view.xmin,
            xmax: zoomX ? xmin + xSpan : view.xmax,
            ymin: zoomY ? ymax - ySpan : view.ymin,
            ymax: zoomY ? ymax : view.ymax,
        };
        if (this.setView(next, zoomX, zoomY)) this.wheelView = { view: next, text: this.rangeText() };
    }

    /** The 2D range settings as one string, to tell whether anything but the wheel changed them. */
    private rangeText(): string {
        return (['xmin', 'xmax', 'ymin', 'ymax'] as const).map((k) => str(this.settings.getValue(k))).join(',');
    }

    /** Forget wheel zoom that has not been applied yet (Reset and Fit win over it, closing drops it). */
    private dropPendingWheel() {
        this.wheelSteps = 0;
        this.wheelAnchor = null;
    }

    private onPreviewKey(e: KeyboardEvent) {
        const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
        // The view stays fixed while an object is pressed or dragged (its px map belongs to the drag), as for the wheel.
        if (this.drag && (this.drag.kind === 'press' || this.drag.kind === 'object') && keys.includes(e.key)) {
            e.preventDefault();
            return;
        }
        // With a selection (SPEC3 1.10): arrows move it (Shift x10, Alt x0.1), Enter reveals its field.
        if (!this.is3D() && this.selected && !e.ctrlKey && !e.metaKey && !(this.drag && this.drag.kind === 'object')) {
            if (keys.includes(e.key)) {
                e.preventDefault();
                this.nudgeSelection(e);
                return;
            }
            if (e.key === 'Enter' && !e.altKey && !e.shiftKey) {
                const target = this.selectionTarget();
                if (target && this.selected) {
                    e.preventDefault();
                    this.revealTarget(target, this.selected.grab);
                    return;
                }
            }
        }
        // Any other key ends a keyboard nudge session (modifiers alone do not).
        if (!keys.includes(e.key) && e.key !== 'Shift' && e.key !== 'Alt' && e.key !== 'Control' && e.key !== 'Meta') this.flushKeySession();
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (!keys.includes(e.key)) return;
        if (this.is3D()) {
            const az = num(this.settings.getValue('rotationZ'), 45);
            const el = num(this.settings.getValue('rotationX'), 30);
            const step = KEYBOARD_ROTATION_STEP;
            e.preventDefault();
            if (e.key === 'ArrowLeft') this.applyRotation((((az - step) % 360) + 360) % 360, el);
            else if (e.key === 'ArrowRight') this.applyRotation((az + step) % 360, el);
            else if (e.key === 'ArrowUp') this.applyRotation(az, Math.min(90, el + step));
            else this.applyRotation(az, Math.max(0, el - step));
            return;
        }
        const view = this.currentView();
        if (this.panLocked || !view) return;
        const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        if (horizontal ? !this.axisFree('x') : !this.axisFree('y')) return;
        e.preventDefault();
        const sign = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1;
        const dx = horizontal ? sign * (view.xmax - view.xmin) * KEYBOARD_PAN_FRACTION : 0;
        const dy = horizontal ? 0 : sign * (view.ymax - view.ymin) * KEYBOARD_PAN_FRACTION;
        this.writeView({ xmin: view.xmin + dx, xmax: view.xmax + dx, ymin: view.ymin + dy, ymax: view.ymax + dy }, horizontal, !horizontal);
    }

    /** The numeric view the settings resolve to now (pan start values may be one frame old). */
    private currentView(): View | null {
        try {
            return this.settings.resolveView(this.math()).view;
        } catch {
            return this.layout ? this.layout.view : null;
        }
    }

    private writeView(v: View, xAxis: boolean, yAxis: boolean) {
        if (this.setView(v, xAxis, yAxis)) this.requestFrame();
    }

    /** Write the view's bounds for the given axes into the settings and the Chart tab; false when nothing was valid. */
    private setView(v: View, xAxis: boolean, yAxis: boolean): boolean {
        const ok = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && a < b;
        let changed = false;
        if (xAxis && ok(v.xmin, v.xmax)) {
            const span = v.xmax - v.xmin;
            this.settings.setValue('xmin', formatBound(v.xmin, span));
            this.settings.setValue('xmax', formatBound(v.xmax, span));
            changed = true;
        }
        if (yAxis && ok(v.ymin, v.ymax)) {
            const span = v.ymax - v.ymin;
            this.settings.setValue('ymin', formatBound(v.ymin, span));
            this.settings.setValue('ymax', formatBound(v.ymax, span));
            changed = true;
        }
        if (changed) this.chartPanel?.syncView();
        return changed;
    }

    private applyRotation(azimuth: number, elevation: number) {
        this.settings.setValue('rotationZ', azimuth);
        this.settings.setValue('rotationX', elevation);
        this.chartPanel?.syncView();
        this.requestFrame();
    }

    private updateReadout(clientX: number, clientY: number) {
        const el = this.readoutEl;
        if (!el) return;
        // The hover chip docks in the readout corner.
        if (this.hintDocked) {
            el.addClass('tikz-hidden');
            return;
        }
        const p = this.toMath(clientX, clientY);
        if (!p || p.fx < 0 || p.fx > 1 || p.fy < 0 || p.fy > 1) {
            this.hideReadout();
            return;
        }
        const names = String(this.settings.getValue('variables') ?? '')
            .split(/[,;\s]+/)
            .filter((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
        const [vx, vy] = names.length === 2 && names[0] !== names[1] && !this.isPolar() ? names : ['x', 'y'];
        const d = this.pixelDecimals();
        el.setText(`${vx} = ${formatDecimals(p.x, d)}   ${vy} = ${formatDecimals(p.y, d)}`);
        el.removeClass('tikz-hidden');
    }

    private hideReadout() {
        this.readoutEl?.addClass('tikz-hidden');
    }

    // ================================================================ action pill

    private updatePill() {
        this.gridBtn?.setPressed(this.settings.getValue('showLargeGrid') === true);
        this.dragToggle?.setPressed(this.dragEditOn());
        const lock = this.lockBtn;
        if (!lock) return;
        lock.setPressed(this.panLocked);
        lock.setIcon(this.panLocked ? 'lock' : 'lock-open');
        const pinned = (['x', 'y'] as const).filter((a) => !this.axisFree(a));
        let label = this.panLocked ? 'Unlock pan and zoom' : 'Lock pan and zoom';
        if (pinned.length === 2) label += ' (both ranges use expressions, so they stay fixed)';
        else if (pinned.length === 1) label += ` (the ${pinned[0]} range uses an expression, so it stays fixed)`;
        lock.setLabel(label);
        this.chartEl?.toggleClass('is-pan-off', this.panLocked || pinned.length === 2);
    }

    private toggleGrid() {
        this.settings.setValue('showLargeGrid', this.settings.getValue('showLargeGrid') !== true);
        this.gridBtn?.setPressed(this.settings.getValue('showLargeGrid') === true);
        this.chartPanel?.syncView();
        this.requestUpdate();
    }

    private togglePanLock() {
        this.panLocked = !this.panLocked;
        this.updatePill();
    }

    /** factor 0 resets the zoom. */
    private zoom3D(factor: number) {
        const current = num(this.settings.getValue('zoom3D'), 1);
        const next = factor === 0 ? 1 : Math.max(ZOOM_3D_MIN, Math.min(ZOOM_3D_MAX, current * factor));
        this.settings.setValue('zoom3D', next);
        this.requestFrame();
    }

    /** The visible axis ranges are still the defaults (2D: x and y, 3D: all three). */
    private rangesAreDefault(): boolean {
        const keys: RangeKey[] = this.is3D() ? ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'] : ['xmin', 'xmax', 'ymin', 'ymax'];
        return keys.every((key) => String(this.settings.getValue(key) ?? '').trim() === RANGE_DEFAULTS[key]);
    }

    private resetRanges() {
        this.dropPendingWheel();
        const keys: RangeKey[] = this.is3D() ? ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'] : ['xmin', 'xmax', 'ymin', 'ymax'];
        for (const key of keys) this.settings.setValue(key, RANGE_DEFAULTS[key]);
        if (this.is3D()) this.settings.setValue('zoom3D', 1);
        this.chartPanel?.syncView();
        this.requestUpdate();
    }

    /**
     * Fit the ranges to what the functions (2D) or surfaces (3D) draw.
     * Drops outliers beyond the 1st / 99th percentile so a vertical
     * asymptote does not blow out the range. Ranges written as expressions
     * stay as they are, like pan and zoom. `quiet` (the automatic fit after
     * the first formula) skips the status messages.
     */
    private autoFit(quiet = false) {
        this.dropPendingWheel();
        let math: MathContext;
        try {
            math = this.math();
            math.setParams(this.list<Parameter>('parameters'));
        } catch (e) {
            if (!quiet) this.flashStatus(`Cannot fit: ${errorText(e)}`);
            return;
        }
        const view = this.currentView() ?? this.settings.resolveView(math).view;
        const xs: number[] = [];
        const ys: number[] = [];
        const zs: number[] = [];
        const push = (x: number, y: number, z?: number) => {
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            if (z !== undefined && !Number.isFinite(z)) return;
            xs.push(x);
            ys.push(y);
            if (z !== undefined) zs.push(z);
        };

        if (this.is3D()) {
            for (const s of this.list<Function3DParameters>('functions3D')) {
                if (s.hidden || !str(s.expression).trim()) continue;
                try {
                    const f = math.fn2(s.expression);
                    const [x0, x1] = math.domain(s.xDomain, [view.xmin, view.xmax]);
                    const [y0, y1] = math.domain(s.yDomain, [view.ymin, view.ymax]);
                    for (let i = 0; i <= FIT_SAMPLES_3D; i++) {
                        const x = x0 + ((x1 - x0) * i) / FIT_SAMPLES_3D;
                        for (let j = 0; j <= FIT_SAMPLES_3D; j++) {
                            const y = y0 + ((y1 - y0) * j) / FIT_SAMPLES_3D;
                            push(x, y, f(x, y));
                        }
                    }
                } catch {
                    // A broken surface is reported in the status chip; fit the others.
                }
            }
        } else {
            for (const info of math.functions()) {
                if (info.hidden || info.error) continue;
                if (info.kind === 'cartesian') {
                    const [a, b] = info.domain ?? [view.xmin, view.xmax];
                    for (let i = 0; i <= FIT_SAMPLES; i++) {
                        const x = a + ((b - a) * i) / FIT_SAMPLES;
                        push(x, info.fn(x));
                    }
                } else {
                    const [a, b] = info.domain ?? [0, 2 * Math.PI];
                    for (let i = 0; i <= FIT_SAMPLES; i++) {
                        const t = a + ((b - a) * i) / FIT_SAMPLES;
                        if (info.kind === 'parametric') push(info.fn(t), info.fnY ? info.fnY(t) : NaN);
                        else push(info.fn(t) * Math.cos(t), info.fn(t) * Math.sin(t));
                    }
                }
            }
        }

        if (!xs.length) {
            if (quiet) return;
            this.flashStatus(this.is3D() ? 'Nothing to fit yet: add a surface first.' : 'Nothing to fit yet: add a function first.');
            return;
        }
        const axes: Array<{ axis: 'x' | 'y' | 'z'; values: number[]; trim: boolean }> = [
            { axis: 'x', values: xs, trim: false },
            { axis: 'y', values: ys, trim: true },
        ];
        if (this.is3D()) axes.push({ axis: 'z', values: zs, trim: true });
        let wrote = false;
        for (const { axis, values, trim } of axes) {
            if (!this.axisFree(axis)) continue;
            const [lo, hi] = trim ? trimmedRange(values) : [Math.min(...values), Math.max(...values)];
            const pad = (hi - lo) * 0.05 || 0.5;
            const span = hi - lo + 2 * pad;
            this.settings.setValue(`${axis}min`, formatBound(lo - pad, span));
            this.settings.setValue(`${axis}max`, formatBound(hi + pad, span));
            wrote = true;
        }
        if (!wrote) {
            if (!quiet) this.flashStatus('The ranges use expressions: edit them in Chart > Ranges.');
            return;
        }
        this.chartPanel?.syncView();
        this.requestUpdate();
    }

    // ================================================================ action bar

    private buildActionBar(shell: HTMLElement) {
        const bar = shell.createDiv({ cls: 'etz-actionbar' });
        const copySvg = textButton(bar, { text: 'Copy SVG', onClick: () => void this.copySvg(copySvg) });
        const copyPng = textButton(bar, { text: 'Copy PNG', onClick: () => void this.copyPng(copyPng) });
        const copyTikz = textButton(bar, {
            text: 'Copy TikZ',
            onClick: () => {
                let text: string;
                try {
                    text = this.codePanel ? this.codePanel.copyText() : this.generateCode();
                } catch (e) {
                    this.flashStatus(`Could not generate TikZ: ${errorText(e)}`);
                    return;
                }
                void this.copyText(text, copyTikz);
            },
        });
        bar.createDiv({ cls: 'etz-actionbar-spacer' });
        this.ctaBtn = textButton(bar, { text: '', variant: 'cta', onClick: () => void this.emitBlock() });
        this.syncCta();
    }

    private syncCta() {
        const btn = this.ctaBtn;
        if (!btn) return;
        const text = this.sourceFile ? 'Save changes' : 'Insert into note';
        btn.setText(text);
        btn.el.setAttr('aria-label', `${text} (${Platform.isMacOS ? 'Cmd' : 'Ctrl'}+Enter)`);
    }

    /** Swap a button's text for a moment ("Copied"); UI state instead of a Notice. */
    private flashButton(button: TextButtonHandle, text: string) {
        const pending = this.labelTimers.get(button);
        if (pending !== undefined) window.clearTimeout(pending.timer);
        const original = pending ? pending.original : (button.el.querySelector('.etz-btn-text')?.textContent ?? '');
        button.setText(text);
        const timer = window.setTimeout(() => {
            this.labelTimers.delete(button);
            button.setText(original);
        }, COPIED_LABEL_MS);
        this.labelTimers.set(button, { timer, original });
    }

    private async copyText(text: string, button: TextButtonHandle) {
        try {
            await navigator.clipboard.writeText(text);
            this.flashButton(button, 'Copied');
        } catch {
            new Notice('Could not copy to the clipboard.');
        }
    }

    /** Fresh TikZ code generated from the current settings. */
    private generateCode(): string {
        const math = this.math();
        math.setParams(this.list<Parameter>('parameters'));
        return this.is3D() ? this.settings.generate3DTikzCode(math) : this.settings.generateTikzCode(math);
    }

    /**
     * Clone the live SVG and prepare it for export: swap MathJax labels for
     * text, resolve every `var(--...)` to its computed value (so the image
     * survives outside Obsidian) and drop the background rect for
     * transparency.
     */
    private prepareSvgForExport(): SVGElement | null {
        let svg: SVGElement | null = null;
        if (this.is3D()) {
            // 3D's on-screen view is canvas-only; the off-screen SVG holds the
            // exportable DOM and is refreshed here just before we read it.
            if (!this.renderer3d) return null;
            const math = this.math();
            math.setParams(this.list<Parameter>('parameters'));
            this.renderer3d.renderSvg(this.settings.toRendererConfig(math), { math });
            svg = this.renderer3d.getElement().querySelector<SVGElement>(':scope > svg');
        } else {
            svg = this.chartSvg;
        }
        if (!svg) return null;
        return exportableSvg(svg, this.modalEl.ownerDocument);
    }

    private async copySvg(button: TextButtonHandle) {
        let clone: SVGElement | null = null;
        try {
            clone = this.prepareSvgForExport();
        } catch (e) {
            this.flashStatus(`Could not export the preview: ${errorText(e)}`);
            return;
        }
        if (!clone) {
            new Notice('Nothing to copy yet: the chart has not rendered.');
            return;
        }
        const svgString = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + new XMLSerializer().serializeToString(clone);
        try {
            await navigator.clipboard.writeText(svgString);
            this.flashButton(button, 'Copied');
        } catch {
            new Notice('Could not copy the SVG to the clipboard.');
        }
    }

    private async copyPng(button: TextButtonHandle) {
        let clone: SVGElement | null = null;
        try {
            clone = this.prepareSvgForExport();
        } catch (e) {
            this.flashStatus(`Could not export the preview: ${errorText(e)}`);
            return;
        }
        if (!clone) {
            new Notice('Nothing to copy yet: the chart has not rendered.');
            return;
        }
        try {
            // 2x for a sharper result on Hi-DPI displays.
            const pngBlob = await svgToPng(clone, 2);
            // Older lib.dom.d.ts in this toolchain requires Promise<Blob>; the runtime accepts a Blob too.
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(pngBlob) })]);
            this.flashButton(button, 'Copied');
        } catch (e) {
            new Notice(`Could not copy the PNG: ${errorText(e)}`);
        }
    }

    /**
     * Emit the current settings as an `easy-tikz` code block: text (one
     * line per object) or JSON, as the block being edited is written, and
     * for a new chart as the setting says. A text block keeps the lines of
     * every object that did not change. If the modal was opened by
     * clicking an existing rendered chart, replace that block in its
     * source file; otherwise insert a new block at the active editor's
     * cursor.
     */
    private async emitBlock() {
        const data = this.settings.serialize();
        const original = this.originalBlockText;
        const oldBody = original ? blockBody(original) : null;
        // Plain `tikz` blocks render JSON only.
        const format = this.fenceTag === 'tikz' ? 'json' : (this.blockFormat ?? this.plugin?.data.blockFormat ?? 'text');
        let body: string;
        if (format === 'json') body = JSON.stringify(data, null, 2);
        else body = oldBody !== null && oldBody.trim() && isChartText(oldBody) ? writeChartText(oldBody, data) : printChartText(data);
        const block = '```' + this.fenceTag + '\n' + body + '\n```';
        const file = this.sourceFile;
        if (file && original) {
            let found = false;
            try {
                await this.app.vault.process(file, (content) => {
                    const at = content.indexOf(original);
                    if (at < 0) return content;
                    found = true;
                    // Splice by index: String.replace would expand `$&` / `$$` in labels.
                    return content.slice(0, at) + block + content.slice(at + original.length);
                });
            } catch (e) {
                new Notice(`Could not save the chart to the file: ${errorText(e)}`);
                return;
            }
            if (!found) {
                new Notice('Could not find the original chart in the note (it may have been edited), so it was inserted at the current position.');
                this.insertAtCursor(block);
                return;
            }
            // Later saves of this session still find the block.
            this.originalBlockText = block;
            this.finish();
            return;
        }
        this.insertAtCursor(block);
    }

    private insertAtCursor(block: string) {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            new Notice('No active note to insert into. Open a note and try again.');
            return;
        }
        view.editor.replaceSelection(block + '\n');
        this.finish();
    }

    /** After Insert / Save: drop this chart's draft and close. */
    private finish() {
        this.finished = true;
        if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer);
        this.autosaveTimer = null;
        const plugin = this.plugin;
        const draft = plugin?.data?.draft;
        if (plugin && draft && (draft.savedAt === this.ownDraftAt || this.draftMatchesBlock(draft))) {
            plugin.data.draft = null;
            void plugin.saveSettings().catch(() => new Notice('Could not update the plugin data file.'));
        }
        this.close();
    }

    // ================================================================ drafts

    private markChanged() {
        // Panels may validate or request a render while they are being built; that is not an edit.
        if (!this.ready) return;
        this.dirty = true;
        this.scheduleAutosave();
    }

    private scheduleAutosave() {
        if (!this.plugin || this.finished) return;
        if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer);
        this.autosaveTimer = window.setTimeout(() => {
            this.autosaveTimer = null;
            void this.saveDraft();
        }, AUTOSAVE_DELAY_MS);
    }

    private async saveDraft() {
        const plugin = this.plugin;
        if (!plugin || this.finished || !this.dirty || !this.hasContent()) return;
        const draft: ChartDraft = {
            savedAt: Date.now(),
            sourcePath: this.sourceFile ? this.sourceFile.path : null,
            originalBlockText: this.originalBlockText,
            data: cloneData(this.settings.serialize()),
        };
        plugin.data.draft = draft;
        this.ownDraftAt = draft.savedAt;
        try {
            await plugin.saveSettings();
        } catch {
            // Tell once per session; a failing disk must not raise a Notice every second.
            if (!this.draftSaveFailed) new Notice('Could not autosave the chart draft.');
            this.draftSaveFailed = true;
        }
    }

    private draftMatchesBlock(draft: ChartDraft): boolean {
        return this.openedFromBlock && draft.sourcePath === (this.sourceFile ? this.sourceFile.path : null) && draft.originalBlockText === this.originalBlockText;
    }

    /** Banner "Unsaved chart from 14:32 [Restore] [Discard]" for a recent draft that belongs here. */
    private offerDraft() {
        const draft = this.plugin?.data?.draft;
        const slot = this.bannerSlot;
        if (!slot || !draft || typeof draft !== 'object' || !draft.data || typeof draft.data !== 'object') return;
        if (!Number.isFinite(draft.savedAt) || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) return;
        if (this.openedFromBlock && !this.draftMatchesBlock(draft)) return;
        if (JSON.stringify(draft.data) === JSON.stringify(this.settings.serialize())) return;
        const when = draftTime(draft.savedAt);
        let text = `Unsaved chart from ${when}`;
        if (this.openedFromBlock) text = `Unsaved changes from ${when}`;
        else if (draft.sourcePath) text = `Unsaved edit of a chart in ${draft.sourcePath.replace(/^.*\//, '').replace(/\.md$/, '')} from ${when}`;
        // Keep the draft in memory: autosaves of this session may overwrite the stored one.
        const kept: ChartDraft = { ...draft, data: cloneData(draft.data) };
        this.draftBanner = banner(slot, {
            text,
            actions: [
                { text: 'Restore', cta: true, onClick: () => this.restoreDraft(kept) },
                { text: 'Discard', onClick: () => this.discardDraft(kept) },
            ],
        });
    }

    private removeDraftBanner() {
        if (this.draftBanner) this.draftBanner.remove();
        this.draftBanner = null;
    }

    private restoreDraft(draft: ChartDraft) {
        const apply = () => {
            this.removeDraftBanner();
            // A fresh editor restoring a block's draft re-links it, so Save replaces that block.
            if (!this.openedFromBlock && draft.sourcePath && draft.originalBlockText) {
                const file = this.app.vault.getAbstractFileByPath(draft.sourcePath);
                if (file instanceof TFile) {
                    this.sourceFile = file;
                    this.originalBlockText = draft.originalBlockText;
                    this.fenceTag = draft.originalBlockText.startsWith('```tikz\n') ? 'tikz' : 'easy-tikz';
                    this.blockFormat = isChartText(blockBody(draft.originalBlockText)) ? 'text' : 'json';
                    this.syncCta();
                }
            }
            this.applyChart(draft.data);
        };
        if (!this.dirty || !this.hasContent()) {
            apply();
            return;
        }
        void confirmDialog(this.app, {
            title: 'Restore the unsaved chart?',
            message: 'Your changes in this editor are replaced by the restored chart.',
            confirmText: 'Restore',
            destructive: true,
        }).then((ok) => {
            if (ok && this.isOpen) apply();
        });
    }

    private discardDraft(draft: ChartDraft) {
        this.removeDraftBanner();
        const plugin = this.plugin;
        if (!plugin || !plugin.data.draft || plugin.data.draft.savedAt !== draft.savedAt) return;
        plugin.data.draft = null;
        void plugin.saveSettings().catch(() => new Notice('Could not update the plugin data file.'));
    }

    // ================================================================ chart replacement

    /** Replace every setting in place (panels keep their SettingsManager reference). */
    private applyChart(data: Record<string, unknown>) {
        closeAllPopovers();
        this.dock?.stopAnimations();
        this.resetDrag();
        // Entries of the old chart could patch a tool of the new one that has the same id.
        this.history.clear();
        // The bar's Undo would run an entry of the old chart.
        this.hideUndo();
        const next = SettingsManager.fromJSON(cloneData(data)).serialize();
        for (const key of Object.keys(this.settings.serialize())) {
            if (!(key in next)) this.settings.setValue(key, undefined);
        }
        for (const [key, value] of Object.entries(next)) this.settings.setValue(key, value);
        this.mathCtx = null;
        this.sceneCache = new SceneCache();
        this.renderer3d?.invalidateCache();
        this.layout = null;
        this.hideReadout();
        this.syncHeader();
        this.build?.refresh();
        this.chartPanel?.refresh();
        this.codePanel?.refresh();
        this.commit();
    }

    // ================================================================ helpers

    private list<T>(key: string): T[] {
        const v = this.settings.getValue<unknown>(key);
        return Array.isArray(v) ? (v as T[]) : [];
    }

    /** Anything worth keeping: autosave, the replace confirmation and the preview's empty hint use this. */
    private hasContent(): boolean {
        const filled = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
        return (
            this.list<FunctionParameters>('functions').some((f) => filled(f.expression) || filled(f.expressionY)) ||
            this.list<Function3DParameters>('functions3D').some((s) => filled(s.expression)) ||
            this.list<Tool>('tools').length > 0 ||
            this.list<Annotation>('annotations').some((a) => filled(a.text)) ||
            this.list<Parameter>('parameters').length > 0
        );
    }
}

/** "Manage saved templates...": the user's function templates with delete. */
class TemplatesModal extends Modal {
    private plugin: PluginHost;

    constructor(app: App, plugin: PluginHost) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        this.modalEl.addClass('etz-dialog', 'etz-tokens', 'etz-templates-dialog');
        this.titleEl.setText('Saved templates');
        this.renderList();
    }

    private renderList() {
        const { contentEl } = this;
        contentEl.empty();
        const templates = this.plugin.data.userTemplates ?? [];
        if (!templates.length) {
            contentEl.createDiv({ cls: 'etz-dialog-desc', text: 'No saved templates yet. Save a function as a template from its card menu.' });
            return;
        }
        const list = contentEl.createDiv({ cls: 'etz-template-list', attr: { role: 'list' } });
        templates.forEach((t, index) => {
            const row = list.createDiv({ cls: 'etz-template-row', attr: { role: 'listitem' } });
            const text = row.createDiv({ cls: 'etz-template-text' });
            text.createDiv({ cls: 'etz-template-name', text: t.name });
            text.createDiv({ cls: 'etz-template-meta', text: `${t.is3D ? '3D' : '2D'} · ${t.expression}` });
            iconButton(row, {
                icon: 'trash-2',
                label: `Delete ${t.name}`,
                onClick: () => {
                    const next = templates.filter((_, i) => i !== index);
                    void this.plugin
                        .saveUserTemplates(next)
                        .then(() => this.renderList())
                        .catch(() => new Notice('Could not update the plugin data file.'));
                },
            });
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
