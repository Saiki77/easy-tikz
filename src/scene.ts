/*
 * Scene layer: turns functions' decorations (fill, tangent, extrema) and the
 * tool list into self-describing drawing primitives in math coordinates.
 * The SVG renderer and the TikZ exporter both draw exactly this output, so
 * preview and export cannot disagree. Pure: no DOM, no Obsidian.
 *
 * CONTRACT FILE. Exported names, signatures and documented semantics are
 * fixed; other modules are implemented against them in parallel.
 * Implementations may add private helpers and extra exports.
 */
import {
    AnnotationAnchor,
    AnnotationSize,
    AxisStyle,
    CurveTool,
    FillPattern,
    FunctionParameters,
    MarkerSize,
    PlaneTool,
    PointsTool,
    RegionTool,
    SegmentTool,
    Tool,
} from './types';
import { Affine, ConditionEntry, FunctionInfo, MathContext, PathEntry, fmtNum } from './mathcontext';
import {
    ConstraintSet,
    Grid,
    Pt,
    RegionResult,
    View,
    clipLineToView,
    clipPolylineToView,
    computeContours,
    computeRegion,
    crossingsAlongPolylines,
    feasibleBeyondView,
    findCrossings,
    intersectLines,
    labelPoint,
    latticePoints,
    optimizeOverRegion,
    pointInRings,
} from './geometry';
import { findExtrema1D } from './math';
import { errorText } from './util';

export type ArrowHeads = 'forward' | 'backward' | 'both';

export interface FillPrim {
    /** Even-odd rings. */
    rings: Pt[][];
    color: string;
    opacity: number;
    pattern: FillPattern;
}

export interface StrokePrim {
    lines: Pt[][];
    color: string;
    /** Thickness key: 'very thin' | 'thin' | 'thick' | 'very thick' (THICKNESS_MAP in colors.ts). */
    width: string;
    dashed: boolean;
    /** Arrow heads on every line in `lines` (each line = one leg). */
    arrow?: ArrowHeads;
    /** Draw each line closed (polygon outline). */
    closed?: boolean;
    /** Exact line segment: exporter may emit it as a plain 2-point \draw. */
    exact?: boolean;
}

export interface MarkerPrim {
    x: number;
    y: number;
    color: string;
    size: MarkerSize;
    /** Drawn with reduced opacity (e.g. optimum of an unbounded problem within the view). */
    dim?: boolean;
}

/** Side of its anchor point a scene text sits on: the annotation anchors plus the four diagonals. */
export type TextAnchor = AnnotationAnchor | 'above right' | 'below left' | 'above left' | 'below right';

export interface TextPrim {
    x: number;
    y: number;
    /** Final text: templates already interpolated. May contain $...$ math. */
    text: string;
    color: string;
    /**
     * Side of the anchor point the text sits on ('center': centred on it).
     * Free labels get the side the label placer scored best (clear of other
     * labels, strokes, function curves, markers, axes and the plot border).
     */
    anchor: TextAnchor;
    size: AnnotationSize;
    /** Bold text (region labels), drawn in a darker shade of `color`. */
    weight?: 'bold';
    /** Draw a background-coloured halo (labels on top of fills). */
    halo: boolean;
    /**
     * Extra shift of the text away from its anchor point, in pt of the
     * exported figure (x right, y up). Set by the label placer when every
     * spot right beside the point is taken or crossed by a line; absent
     * otherwise.
     */
    offset?: Pt;
}

/**
 * Curly brace from `from` to `to`. Convention (matches TikZ's brace
 * decoration without `mirror`): the tip bulges to the LEFT of the direction
 * from -> to in math coordinates; the label sits beyond the tip.
 */
export interface BracePrim {
    from: Pt;
    to: Pt;
    color: string;
    label: string;
}

/**
 * The part of a scene item a drag handle stands for (drag to edit, SPEC3 4.6).
 * Indices are positions in the item's own lists; `item` fields point into the
 * tool's TEXT, so the drag engine can find the numbers to change.
 */
export type PartRef =
    /** One clause of a region condition: conditions[entry], disjunct and clause as in math.conditions (DNF). */
    | { part: 'clause'; entry: number; disjunct: number; clause: number }
    /** item: index into parseList(levels); -1 when levels is empty (F = 0). */
    | { part: 'level'; index: number; item: number }
    /** item: index into parseTuples(points) for list sources (after objective selection), else -1. */
    | { part: 'point'; index: number; item: number }
    /** Leg `index` of a segment path (from vertex index to the next; the closing leg last); a brace has leg 0. */
    | { part: 'leg'; index: number }
    /** item: index into parseTuples(path, true); -1 when spliced from a points tool. */
    | { part: 'vertex'; index: number; item: number }
    | { part: 'tangent' }
    /** Extremum marker `index` of a function's Extrema option (left to right). */
    | { part: 'extremum'; index: number };

/** Why a marker cannot be dragged itself: the scene computes it from other items. */
export type LockKind = 'optimum' | 'intersection' | 'corner' | 'lattice';

/**
 * A grabbable part of a scene item, in math coordinates. Handles describe
 * what the preview draws so a pointer can find it; they live in the cached
 * node output (never part of a cache key) and the exporter ignores them.
 */
export interface HandlePrim {
    ref: PartRef;
    /** Math polylines (clause lines and runs, level curves, legs, the tangent line). */
    lines?: Pt[][];
    /** Math point (markers, vertices, the tangent point). */
    point?: Pt;
    /** Region corners lying on this clause (RegionResult.vertices whose tags include the clause id). */
    anchors?: Pt[];
    locked?: LockKind;
}

export interface SceneItem2D {
    /** Function name (f1) or tool name (R1). */
    source: string;
    kind: 'function' | 'tool';
    /** Tool id or function index as string, for caches / focusing. */
    key: string;
    fills: FillPrim[];
    strokes: StrokePrim[];
    /** Dashed thin guide lines (drop lines). */
    guides: StrokePrim[];
    markers: MarkerPrim[];
    braces: BracePrim[];
    texts: TextPrim[];
    /**
     * Drag handles (optional v4 addition, SPEC3 4.6): the parts a pointer can
     * grab in the preview. Shared with the scene memo (same objects on a memo
     * hit, never mutated); not drawn and never exported.
     */
    handles?: HandlePrim[];
}

export interface SceneIssue {
    /** 'f1', 'R1', 'P2', ... */
    source: string;
    /** Field the issue belongs to: 'expression', 'condition:2', 'equation', 'levels', 'path', 'objective', ... */
    field?: string;
    message: string;
    /** 'info' issues (unbounded / infeasible / truncated) are shown muted, not as errors. */
    severity: 'error' | 'info';
    /**
     * Issue of a hidden tool that no other tool or function reads: it draws
     * nothing and affects nothing, so hosts show it on the tool's own card
     * only, not in the chart's problem line or status chip.
     */
    hiddenSource?: boolean;
}

export interface Scene2D {
    /** Drawable items in list order: function decorations first (function order), then tools (list order). */
    items: SceneItem2D[];
    issues: SceneIssue[];
    /** Derived names published while computing (P1_x, P1_y, P1_val, P1_n, P1_x2, ...). */
    derived: Record<string, number>;
}

export interface SceneInput2D {
    functions: FunctionParameters[];
    tools: Tool[];
    math: MathContext;
    view: View;
    /** Marching-squares resolution (callers pick ~3 px cells for full quality, ~6 px for draft). */
    grid: Grid;
    axisStyle: AxisStyle;
    polar: boolean;
    /** Optional cross-frame memo; pass the same instance for every frame of one chart. */
    cache?: SceneCache;
    /**
     * Plot and font sizes the label placer measures texts with (see
     * labelMetricsFor). Preview and export should pass the same metrics, the
     * exported figure's, so both pick the same sides. Default: a 10 x 10 cm
     * figure.
     */
    labelMetrics?: LabelMetrics;
    /**
     * For the frames drawn while a slider or a drag moves (the preview's
     * draft frames; needs `cache`): every free label stays on the spot it had
     * in the previous frame for as long as nothing crosses it there, so
     * labels do not jump about during the gesture. Leave it unset for the
     * frame that settles the picture and for the export: placement is then
     * a pure function of the chart, the same in the editor, in a note and in
     * the PDF.
     */
    keepLabels?: boolean;
}

/** Plot size and font sizes for label placement, in pt. */
export interface LabelMetrics {
    /** Plot area (the axis box). */
    w: number;
    h: number;
    /** Font size per label size. */
    em: Record<AnnotationSize, number>;
}

/** pt per cm. */
const PT_PER_CM = 72.27 / 2.54;
/** Room pgfplots takes from `width` / `height` for tick labels and axis labels, in pt (approximately). */
const AXIS_DECOR_PT = { w: 40, h: 30 };
/** Export text sizes in pt: \footnotesize, \small and \large of a 10 pt document. */
const EXPORT_EM: Record<AnnotationSize, number> = { small: 8, normal: 9, large: 12 };

/** Label metrics of an exported figure of the given size (settings size_x_cm / size_y_cm). */
export function labelMetricsFor(widthCm: number, heightCm: number): LabelMetrics {
    const wPt = (Number.isFinite(widthCm) && widthCm > 0 ? widthCm : 10) * PT_PER_CM;
    const hPt = (Number.isFinite(heightCm) && heightCm > 0 ? heightCm : 10) * PT_PER_CM;
    return {
        w: Math.max(0.5 * wPt, wPt - AXIS_DECOR_PT.w),
        h: Math.max(0.5 * hPt, hPt - AXIS_DECOR_PT.h),
        em: { ...EXPORT_EM },
    };
}

// ------------------------------------------------------------------ tuning

/** Labels at the end of a line or curve sit this fraction of the view inside the border. */
const LABEL_INSET = 0.04;
/** Objective values within this relative distance of the best one are ties (all kept). */
const TIE_REL = 1e-9;
/** Relative step (of the view or domain span) for numerical derivatives. */
const DERIV_REL = 1e-6;
/** Two curves whose gap has a local minimum below this fraction of the view touch there (an intersection point). */
const TOUCH_REL = 1e-6;
/** Newton steps that sharpen a crossing of two nonlinear curves. */
const CROSS_NEWTON = 8;
/** Lines closer than this fraction of the view to a border coincide with it. */
const BORDER_REL = 1e-9;
/** A text gets a halo when the point this fraction of the view off its anchor, on its side, lies on a fill. */
const HALO_PROBE = 0.02;
/** Cached outputs kept per node (one per recent view / grid, e.g. the draft and the full-quality frame). */
const MEMO_PER_NODE = 2;

// ------------------------------------------------------------- internals

type Anchor = TextAnchor;

/** Label sides with their direction in normalized view units, in tie-break order. */
const ANCHOR_DIRS: Array<{ anchor: Anchor; x: number; y: number }> = [
    { anchor: 'above right', x: Math.SQRT1_2, y: Math.SQRT1_2 },
    { anchor: 'right', x: 1, y: 0 },
    { anchor: 'above', x: 0, y: 1 },
    { anchor: 'below left', x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
    { anchor: 'left', x: -1, y: 0 },
    { anchor: 'below', x: 0, y: -1 },
    { anchor: 'above left', x: -Math.SQRT1_2, y: Math.SQRT1_2 },
    { anchor: 'below right', x: Math.SQRT1_2, y: -Math.SQRT1_2 },
];

const UP_RIGHT: Pt = { x: Math.SQRT1_2, y: Math.SQRT1_2 };

/**
 * A label whose text is formatted after every tool has run. Templates then
 * read final derived values (a region label may show P1_val although P1 is
 * computed from that region, without a cycle), and editing a label never
 * invalidates cached geometry: the template is read from the tool each frame.
 */
interface TextSpec {
    x: number;
    y: number;
    /** Template field: the tool's `label`, or conditionLabels[k]. Ignored when `literal` is set. */
    template: 'label' | number;
    literal?: string;
    /** Point index for `;`-separated per-point labels. */
    part?: number;
    locals?: Record<string, number>;
    color: string;
    size: AnnotationSize;
    weight?: 'bold';
    /** Fixed side, or a preferred direction (normalized view units) resolved against borders and other labels. */
    anchor?: Anchor;
    dir?: Pt;
    /** Always draw a halo (region labels sit on their own fill). */
    halo?: boolean;
    /** The label of a point drawn with this marker: the text keeps clear of it. */
    marker?: MarkerSize;
    /** A region's own label: centred somewhere inside the region, (x, y) = its labelPoint. */
    region?: boolean;
    /**
     * The polyline (math coordinates) the label belongs to: a label of a line
     * or curve may slide along it to a spot where nothing crosses the text.
     * Shared with the cached geometry, never mutated.
     */
    slide?: Pt[];
}

/** Brace geometry; the label is the segment's template, formatted per frame. */
interface BraceSpec {
    from: Pt;
    to: Pt;
    color: string;
}

interface RegionData {
    result: RegionResult;
    set: ConstraintSet;
}

interface CurveData {
    F: (x: number, y: number) => number;
    affine: Affine | null;
    levels: number[];
    /** lines[k] = polylines of levels[k]. */
    lines: Pt[][][];
}

interface Point3Spec {
    x: number;
    y: number;
    z: number;
    color: string;
    size: MarkerSize;
    part: number;
    locals: Record<string, number>;
}

/** One node's result. Cached outputs are shared across frames and never mutated. */
interface Output {
    /** Unique per computation; dependents put producer stamps into their cache keys. */
    stamp: number;
    fills: FillPrim[];
    strokes: StrokePrim[];
    guides: StrokePrim[];
    markers: MarkerPrim[];
    braces: BraceSpec[];
    texts: TextSpec[];
    /** Drag handles of what this node draws (SceneItem2D.handles). */
    handles?: HandlePrim[];
    issues: SceneIssue[];
    /** An error stopped the computation (blank input and info issues do not count). */
    failed: boolean;
    derived: Record<string, number>;
    region?: RegionData;
    curve?: CurveData;
    /** Points of a points tool (2 or 3 coordinates each), spliced into segment paths. */
    points?: number[][];
    points3?: Point3Spec[];
    segments3?: Scene3D['segments'];
    planes3?: Scene3D['planes'];
}

/** A function's decorations or a tool, as a node of the dependency graph. */
interface SceneNode {
    /** Cache identity: 'tool:' + id or 'fn:' + function name. */
    id: string;
    /** Issue source; tools are referenced by it. */
    name: string;
    tool?: Tool;
    fn?: { params: FunctionParameters; info: FunctionInfo };
    /** Producer names this node reads, with the field that mentions each. */
    refs: Array<{ name: string; field: string }>;
    /** Expression sources the output depends on (math.depsKey). */
    sources: string[];
    /** The node's JSON with label texts reduced to whether they are set (labels are formatted per frame). */
    base: string;
}

interface Ctx {
    math: MathContext;
    view: View;
    grid: Grid;
    axisStyle: AxisStyle;
    dim: 2 | 3;
    /** Outputs of the nodes computed so far this frame, by name. */
    outputs: Map<string, Output>;
    /** Every tool of the chart by name (any type or dimension), for reference messages. */
    toolsByName: Map<string, Tool>;
    /** The chart's functions (FunctionInfo.index points into it); empty in 3D. */
    functions: FunctionParameters[];
}

interface CacheState {
    /** Context the memo belongs to: cached closures (region sets, curve F) read its scope. */
    math: MathContext | null;
    /** Most recent first, at most MEMO_PER_NODE per node id. */
    memo: Map<string, Array<{ key: string; out: Output }>>;
    good: Map<string, Output>;
    /** Tool and function names of the previous frame (a name that disappears drops every last good output). */
    names: Set<string> | null;
    /** Obstacle polylines of each function's curve for the label placer, with the key they were sampled for. */
    curves: Map<string, { key: string; lines: Pt[][] }>;
    /** Where each free label sat in the previous frame (SceneInput2D.keepLabels), by node id and text index. */
    labels: Map<string, LabelSpot>;
}

/** A free label's spot: index into SPOTS, ring, and steps slid along its line (0: its own place). */
interface LabelSpot {
    dir: number;
    ring: number;
    k: number;
}

/** SceneCache state lives here, so the class keeps exactly its contract shape. */
const CACHE_STATES = new WeakMap<SceneCache, CacheState>();

let stampCounter = 0;

function newOutput(): Output {
    return {
        stamp: ++stampCounter,
        fills: [],
        strokes: [],
        guides: [],
        markers: [],
        braces: [],
        texts: [],
        issues: [],
        failed: false,
        derived: {},
    };
}

/** Text of a field; numbers and booleans print, anything else (missing, objects) is blank. */
function str(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
}

function finite(n: number): boolean {
    return Number.isFinite(n);
}

function num(v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function validView(view: View | null | undefined): view is View {
    return (
        !!view &&
        finite(view.xmin) &&
        finite(view.xmax) &&
        finite(view.ymin) &&
        finite(view.ymax) &&
        view.xmax > view.xmin &&
        view.ymax > view.ymin
    );
}

function sanitizeGrid(grid: Grid | null | undefined): Grid {
    const n = (v: unknown) => Math.max(4, Math.min(2000, Math.round(num(v, 100))));
    return { nx: n(grid && grid.nx), ny: n(grid && grid.ny) };
}

function addIssue(out: Output, source: string, field: string | undefined, message: string, severity: 'error' | 'info' = 'error'): void {
    const issue: SceneIssue = { source, message, severity };
    if (field !== undefined) issue.field = field;
    out.issues.push(issue);
}

function addHandle(out: Output, handle: HandlePrim): void {
    (out.handles || (out.handles = [])).push(handle);
}

/** Record an error that stops this node; its last good output is drawn instead. */
function fail(out: Output, source: string, field: string | undefined, message: string): Output {
    addIssue(out, source, field, message, 'error');
    out.failed = true;
    return out;
}

function finiteAffine(a: Affine | null | undefined): Affine | null {
    return a && finite(a.a) && finite(a.b) && finite(a.c) ? a : null;
}

function lineLength(line: Pt[]): number {
    let len = 0;
    for (let i = 1; i < line.length; i++) len += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
    return len;
}

function longest(lines: Pt[][]): Pt[] | null {
    let best: Pt[] | null = null;
    let bestLen = -1;
    for (const l of lines) {
        if (l.length < 2) continue;
        const len = lineLength(l);
        if (len > bestLen) {
            best = l;
            bestLen = len;
        }
    }
    return best;
}

/** Direction (math units) in normalized view units, scaled to length 1; `fallback` when degenerate. */
function normDir(dx: number, dy: number, view: View, fallback: Pt = UP_RIGHT): Pt {
    const u = dx / (view.xmax - view.xmin);
    const v = dy / (view.ymax - view.ymin);
    const len = Math.hypot(u, v);
    return finite(len) && len > 0 ? { x: u / len, y: v / len } : fallback;
}

/** Gradient direction of g at p in normalized view units (towards g > 0, the infeasible side of g <= 0). */
function gradientDir(g: (x: number, y: number) => number, affine: Affine | null, p: Pt, view: View): Pt {
    if (affine) return normDir(affine.a * (view.xmax - view.xmin) ** 2, affine.b * (view.ymax - view.ymin) ** 2, view);
    const hx = (view.xmax - view.xmin) * DERIV_REL;
    const hy = (view.ymax - view.ymin) * DERIV_REL;
    const gx = (g(p.x + hx, p.y) - g(p.x - hx, p.y)) / (2 * hx);
    const gy = (g(p.x, p.y + hy) - g(p.x, p.y - hy)) / (2 * hy);
    // d g / d u = g_x * xSpan: the gradient in normalized units, mapped back to math units for normDir.
    return normDir(gx * (view.xmax - view.xmin) ** 2, gy * (view.ymax - view.ymin) ** 2, view);
}

function insetView(view: View): View {
    const ix = (view.xmax - view.xmin) * LABEL_INSET;
    const iy = (view.ymax - view.ymin) * LABEL_INSET;
    return { xmin: view.xmin + ix, xmax: view.xmax - ix, ymin: view.ymin + iy, ymax: view.ymax - iy };
}

/** Normalized distance from p to the view's top-right corner. */
function topRightDistance(p: Pt, view: View): number {
    return Math.hypot((view.xmax - p.x) / (view.xmax - view.xmin), (view.ymax - p.y) / (view.ymax - view.ymin));
}

/** True when `a` is a better label end than `b`: closer to the top-right, ties (symmetric curves) to the right. */
function betterEnd(a: Pt, b: Pt, view: View): boolean {
    const da = topRightDistance(a, view);
    const db = topRightDistance(b, view);
    if (Math.abs(da - db) > 1e-9) return da < db;
    return a.x > b.x || (a.x === b.x && a.y > b.y);
}

/** The best label spot of a polyline: an end, or any vertex of a contour or closed loop. */
function bestEnd(line: Pt[], view: View, anyVertex: boolean): Pt {
    if (anyVertex || closedLine(line)) return line.reduce((best, p) => (betterEnd(p, best, view) ? p : best), line[0]);
    const a = line[0];
    const b = line[line.length - 1];
    return betterEnd(b, a, view) ? b : a;
}

/**
 * Polyline to label: among the long ones (at least half the longest), the
 * one whose label spot lies closest to the top-right of the view, so labels
 * of symmetric curves (both branches of xy = c) land on the same side.
 */
function labelLine(lines: Pt[][], view: View, anyVertex: boolean): Pt[] | null {
    const top = longest(lines);
    if (!top) return null;
    const min = 0.5 * lineLength(top);
    let best: Pt[] | null = null;
    for (const l of lines) {
        if (l.length < 2 || lineLength(l) < min) continue;
        if (!best || betterEnd(bestEnd(l, view, anyVertex), bestEnd(best, view, anyVertex), view)) best = l;
    }
    return best;
}

function closedLine(line: Pt[]): boolean {
    const a = line[0];
    const b = line[line.length - 1];
    return line.length > 3 && a.x === b.x && a.y === b.y;
}

/**
 * Label spot on `line` closest to the view's top-right corner: one of its
 * ends for exact lines, any vertex for contours (the 45 degree point of
 * concentric circles), so the labels of neighbouring levels spread out
 * instead of crowding where the curves leave the view. A
 * spot in the LABEL_INSET margin is moved along the line until it lies
 * inside (clamped when the line never gets there). Returns the spot and the
 * local direction of the line.
 */
function labelSpot(line: Pt[], view: View, anyVertex: boolean): { p: Pt; dir: Pt } {
    const inset = insetView(view);
    const n = line.length;
    let k = 0;
    if (anyVertex || closedLine(line)) {
        for (let i = 1; i < n; i++) if (betterEnd(line[i], line[k], view)) k = i;
    } else if (betterEnd(line[n - 1], line[0], view)) k = n - 1;
    const p = line[k];
    const q = line[k + 1 < n ? k + 1 : k - 1];
    const inside = p.x >= inset.xmin && p.x <= inset.xmax && p.y >= inset.ymin && p.y <= inset.ymax;
    if (inside) return { p, dir: { x: q.x - p.x, y: q.y - p.y } };
    // Walk from the spot along the line (both ways for an inner vertex) to where it enters the inset view.
    const walks: Pt[][] = [];
    if (k < n - 1) walks.push(line.slice(k));
    if (k > 0) walks.push(line.slice(0, k + 1).reverse());
    let best: { p: Pt; dir: Pt } | null = null;
    let bestDist = Infinity;
    for (const walk of walks) {
        const pieces = clipPolylineToView(walk, inset);
        if (!pieces.length || pieces[0].length < 2) continue;
        const [a, b] = pieces[0];
        const d = Math.hypot((a.x - p.x) / (view.xmax - view.xmin), (a.y - p.y) / (view.ymax - view.ymin));
        if (d < bestDist) {
            bestDist = d;
            best = { p: a, dir: { x: b.x - a.x, y: b.y - a.y } };
        }
    }
    if (best) return best;
    return {
        p: { x: Math.min(inset.xmax, Math.max(inset.xmin, p.x)), y: Math.min(inset.ymax, Math.max(inset.ymin, p.y)) },
        dir: { x: q.x - p.x, y: q.y - p.y },
    };
}

/** Midpoint of a polyline by arc length, with the direction of the leg it lies on. */
function midSpot(line: Pt[]): { p: Pt; dir: Pt } {
    const half = lineLength(line) / 2;
    let acc = 0;
    for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (acc + len >= half && len > 0) {
            const t = (half - acc) / len;
            return { p: { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }, dir: { x: b.x - a.x, y: b.y - a.y } };
        }
        acc += len;
    }
    const a = line[0];
    const b = line[line.length - 1];
    return { p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dir: { x: b.x - a.x, y: b.y - a.y } };
}

/** Split a points label at top-level ';' (outside `{...}` placeholders and `$...$` / `\(...\)` math). */
function labelParts(template: string): string[] {
    const parts: string[] = [];
    let cur = '';
    let depth = 0;
    let math: '' | '$' | '(' = '';
    for (let i = 0; i < template.length; i++) {
        const ch = template[i];
        if (ch === '\\' && i + 1 < template.length) {
            const nx = template[i + 1];
            if (!math && nx === '(') math = '(';
            else if (math === '(' && nx === ')') math = '';
            cur += ch + nx;
            i++;
            continue;
        }
        if (ch === '$') math = math === '$' ? '' : math || '$';
        else if (ch === '{') depth++;
        else if (ch === '}' && depth > 0) depth--;
        else if (ch === ';' && depth === 0 && !math) {
            parts.push(cur.trim());
            cur = '';
            continue;
        }
        cur += ch;
    }
    parts.push(cur.trim());
    return parts;
}

/** Template text for point `part`: one part labels every point, several parts label points in order. */
function partOf(template: string, part: number | undefined): string {
    if (part === undefined) return template;
    const parts = labelParts(template);
    if (parts.length === 1) return parts[0];
    return part < parts.length ? parts[part] : '';
}

/** Split at depth-0 commas (levels lists with a non-finite item are evaluated item by item). */
function splitTopLevel(src: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of src) {
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        if (ch === sep && depth === 0) {
            out.push(cur);
            cur = '';
        } else cur += ch;
    }
    out.push(cur);
    return out;
}

function sortPoints(pts: Pt[]): Pt[] {
    return pts.sort((a, b) => a.x - b.x || a.y - b.y);
}

/** Drop points closer than `eps` (math units) to an earlier one. */
function dedupePoints(pts: Pt[], eps: number): Pt[] {
    const out: Pt[] = [];
    for (const p of pts) if (!out.some((q) => Math.abs(q.x - p.x) <= eps && Math.abs(q.y - p.y) <= eps)) out.push(p);
    return out;
}

// ------------------------------------------------------------- the cache

/**
 * Per-chart memo. Each tool's output is cached on a key made of the tool's
 * JSON, the view, the grid, math.depsKey(tool's expression fields) and the
 * keys of tools it references, so dragging a parameter only recomputes the
 * tools that depend on it. Also remembers the last successful output per
 * tool id; when a tool fails while it previously succeeded, the last good
 * output is drawn and the issue is still reported.
 */
export class SceneCache {
    clear(): void {
        CACHE_STATES.delete(this);
    }
}

function cacheState(cache: SceneCache): CacheState {
    let s = CACHE_STATES.get(cache);
    if (!s) {
        s = { math: null, memo: new Map(), good: new Map(), names: null, curves: new Map(), labels: new Map() };
        CACHE_STATES.set(cache, s);
    }
    return s;
}

// ------------------------------------------------------------ the graph

/**
 * JSON of a tool for its cache key. Label texts are formatted per frame, so
 * only whether a label (or each condition label) exists is part of the key:
 * it decides whether text specs are emitted at all. Editing a label that is
 * already set keeps the cached geometry; visibility never changes it.
 */
function toolBase(t: Tool): string {
    const copy: Record<string, unknown> = { ...(t as unknown as Record<string, unknown>) };
    copy.label = str(copy.label).trim() !== '';
    copy.conditionLabels = Array.isArray(copy.conditionLabels) ? copy.conditionLabels.map((l) => str(l).trim() !== '') : [];
    delete copy.hidden;
    return JSON.stringify(copy);
}

/** Producers and evaluated sources of a tool, for the dependency graph and the cache key. */
function toolNode(t: Tool, math: MathContext): SceneNode {
    const refs: SceneNode['refs'] = [];
    const sources: string[] = [];
    const scan = (src: unknown, field: string) => {
        const s = str(src);
        if (!s.trim()) return;
        sources.push(s);
        for (const name of math.deps(s).tools) refs.push({ name, field });
    };
    switch (t.type) {
        case 'region':
            (Array.isArray(t.conditions) ? t.conditions : []).forEach((c, i) => scan(c, `condition:${i}`));
            break;
        case 'curve':
            scan(t.equation, 'equation');
            scan(t.levels, 'levels');
            break;
        case 'points':
            if (t.source === 'list') scan(t.points, 'points');
            else if (t.source === 'intersections') {
                for (const field of ['ref1', 'ref2'] as const) {
                    const ref = str(t[field]).trim();
                    if (!ref) continue;
                    refs.push({ name: ref, field });
                    // A function reference reads the tools its body mentions (f1 = P2_y + x).
                    scan(ref, field);
                }
            } else {
                const region = str(t.regionName).trim();
                if (region) refs.push({ name: region, field: 'regionName' });
            }
            if (str(t.objective).trim() && t.dim !== 3) scan(t.objective, 'objective');
            break;
        case 'segment':
            scan(t.path, 'path');
            break;
        case 'plane3D':
            scan(t.value, 'value');
            break;
    }
    return { id: `tool:${t.id}`, name: str(t.name) || str(t.id), tool: t, refs, sources, base: toolBase(t) };
}

const TANGENT_KEYWORD_RE = /^\s*(min|max)(\d*)\s*$/;

function functionNode(params: FunctionParameters, info: FunctionInfo, math: MathContext): SceneNode {
    const refs: SceneNode['refs'] = [];
    // The function's name covers its body, domain and the functions it calls (math.deps is transitive).
    const sources = [info.name];
    for (const name of math.deps(info.name).tools) refs.push({ name, field: 'expression' });
    const tp = str(params.tangentPoint);
    if (params.tangent && tp.trim() && !TANGENT_KEYWORD_RE.test(tp)) {
        sources.push(tp);
        for (const name of math.deps(tp).tools) refs.push({ name, field: 'tangentPoint' });
    }
    const copy: Record<string, unknown> = { ...(params as unknown as Record<string, unknown>) };
    delete copy.legendLabel;
    delete copy.showLegend;
    return { id: `fn:${info.name}`, name: info.name, fn: { params, info }, refs, sources, base: JSON.stringify(copy) };
}

interface Cycle {
    /** Names along the cycle, starting and ending at this node. */
    path: string[];
    /** Field of this node that leads into the cycle. */
    field: string;
}

/** Tarjan's strongly connected components; returns the cycle through each cyclic node. */
function findCycles(nodes: SceneNode[], edges: Array<Array<{ to: number; field: string }>>): Map<number, Cycle> {
    const n = nodes.length;
    const index = new Array<number>(n).fill(-1);
    const low = new Array<number>(n).fill(0);
    const onStack = new Array<boolean>(n).fill(false);
    const comp = new Array<number>(n).fill(-1);
    const compSize: number[] = [];
    const stack: number[] = [];
    let counter = 0;
    const strong = (v: number): void => {
        index[v] = low[v] = counter++;
        stack.push(v);
        onStack[v] = true;
        for (const e of edges[v]) {
            if (index[e.to] < 0) {
                strong(e.to);
                low[v] = Math.min(low[v], low[e.to]);
            } else if (onStack[e.to]) low[v] = Math.min(low[v], index[e.to]);
        }
        if (low[v] === index[v]) {
            const id = compSize.length;
            let size = 0;
            let w: number;
            do {
                w = stack.pop() as number;
                onStack[w] = false;
                comp[w] = id;
                size++;
            } while (w !== v);
            compSize.push(size);
        }
    };
    for (let v = 0; v < n; v++) if (index[v] < 0) strong(v);

    const cycles = new Map<number, Cycle>();
    for (let v = 0; v < n; v++) {
        const self = edges[v].find((e) => e.to === v);
        if (self) {
            cycles.set(v, { path: [nodes[v].name, nodes[v].name], field: self.field });
            continue;
        }
        if (compSize[comp[v]] < 2) continue;
        // Shortest way back to v inside its component.
        const prev = new Map<number, { from: number; field: string }>();
        const queue: number[] = [v];
        let found = false;
        for (let qi = 0; qi < queue.length && !found; qi++) {
            const u = queue[qi];
            for (const e of edges[u]) {
                if (comp[e.to] !== comp[v]) continue;
                if (e.to === v) {
                    prev.set(-1, { from: u, field: e.field });
                    found = true;
                    break;
                }
                if (!prev.has(e.to)) {
                    prev.set(e.to, { from: u, field: e.field });
                    queue.push(e.to);
                }
            }
        }
        const chain: number[] = [];
        let cur = prev.get(-1);
        while (cur && cur.from !== v) {
            chain.unshift(cur.from);
            cur = prev.get(cur.from);
        }
        const first = chain.length ? chain[0] : v;
        const field = (edges[v].find((e) => e.to === first) || edges[v][0]).field;
        cycles.set(v, { path: [v, ...chain, v].map((i) => nodes[i].name), field });
    }
    return cycles;
}

/**
 * Evaluate `nodes` in dependency order: cache lookups, last-good fallback,
 * cycle errors, and derived values published after every points tool.
 * Returns each node's effective output (by node index).
 */
function runNodes(
    nodes: SceneNode[],
    ctx: Ctx,
    state: CacheState,
    frameKey: string,
    compute: (node: SceneNode) => Output,
    seen: Set<string>
): Output[] {
    const { math } = ctx;
    const derived: Record<string, number> = {};
    // Start from a clean slate: a node only ever reads values of tools computed before it.
    math.setDerived(derived);

    // Only tools produce something other nodes read: a reference to f1
    // means its body, never its decorations (so a tangent at P1_x with P1 =
    // crossings of f1 and f2 is not a cycle).
    const byName = new Map<string, number>();
    nodes.forEach((node, i) => {
        if (node.tool && !byName.has(node.name)) byName.set(node.name, i);
    });
    const edges = nodes.map((node) => {
        const out: Array<{ to: number; field: string }> = [];
        for (const r of node.refs) {
            const to = byName.get(r.name);
            if (to !== undefined && !out.some((e) => e.to === to)) out.push({ to, field: r.field });
        }
        return out;
    });
    const cycles = findCycles(nodes, edges);
    const results = new Array<Output | undefined>(nodes.length);

    const settle = (i: number, out: Output): void => {
        const node = nodes[i];
        let eff = out;
        if (out.failed) {
            const good = state.good.get(node.id);
            if (good) eff = { ...good, issues: out.issues, failed: true };
        } else state.good.set(node.id, out);
        results[i] = eff;
        ctx.outputs.set(node.name, eff);
        const keys = Object.keys(eff.derived);
        if (keys.length) {
            for (const k of keys) derived[k] = eff.derived[k];
            math.setDerived(derived);
        }
    };

    // Members of a cycle are not computed; they keep their last good shapes.
    cycles.forEach((cycle, i) => {
        const node = nodes[i];
        seen.add(node.id);
        const out = newOutput();
        const field = cycle.field;
        const msg =
            cycle.path.length === 2 && cycle.path[0] === cycle.path[1]
                ? `${node.name} uses its own result`
                : `circular reference: ${cycle.path.join(' -> ')}`;
        settle(i, fail(out, node.name, field, msg));
    });

    const done = new Array<boolean>(nodes.length).fill(false);
    const visit = (i: number): void => {
        if (done[i] || cycles.has(i)) return;
        done[i] = true;
        for (const e of edges[i]) visit(e.to);
        const node = nodes[i];
        seen.add(node.id);
        const stamps = node.refs.map((r) => {
            const o = ctx.outputs.get(r.name);
            return `${r.name}@${o ? o.stamp : '-'}`;
        });
        const key = `${node.base}|${frameKey}|${math.depsKey(node.sources)}|${stamps.join(',')}`;
        const list = state.memo.get(node.id) || [];
        const at = list.findIndex((m) => m.key === key);
        let out: Output;
        if (at >= 0) {
            out = list[at].out;
            list.splice(at, 1);
        } else {
            try {
                out = compute(node);
            } catch (e) {
                out = fail(newOutput(), node.name, undefined, `could not be computed: ${errorText(e)}`);
            }
        }
        list.unshift({ key, out });
        if (list.length > MEMO_PER_NODE) list.length = MEMO_PER_NODE;
        state.memo.set(node.id, list);
        settle(i, out);
    };
    for (let i = 0; i < nodes.length; i++) visit(i);
    return results.map((r) => r || newOutput());
}

/** Forget memo entries and last good outputs of nodes that no longer exist. */
function prune(state: CacheState, seen: Set<string>): void {
    for (const id of Array.from(state.memo.keys())) if (!seen.has(id)) state.memo.delete(id);
    for (const id of Array.from(state.good.keys())) if (!seen.has(id)) state.good.delete(id);
}

/**
 * The last good output stands in for a tool that is being edited (half-typed
 * input), not for one whose producer was deleted or renamed: then it would
 * keep drawing markers, and publishing derived values, that the export and
 * the note no longer contain. So when a tool or function name of the
 * previous frame is gone, every last good output is dropped.
 */
function forgetOnRemoval(state: CacheState, names: Set<string>): void {
    const prev = state.names;
    state.names = names;
    if (prev && Array.from(prev).some((n) => !names.has(n))) state.good.clear();
}

// ----------------------------------------------------- function decorations

/** Fill to the x-axis, tangent and extrema of one cartesian function. */
function computeDecorations(f: FunctionParameters, info: FunctionInfo, ctx: Ctx): Output {
    const out = newOutput();
    const name = info.name;
    if (info.error) return fail(out, name, 'expression', info.error);
    if (info.domainError) return fail(out, name, 'domain', info.domainError);
    const { view, grid } = ctx;
    const fn = info.fn;
    const [lo, hi] = info.domain || [view.xmin, view.xmax];
    const color = str(f.color) || 'black';

    if (f.fill) {
        // min(f, 0) <= y <= max(f, 0) within the effective domain: the same
        // region engine as region tools, so the fill is clipped to the view
        // and exports as a plain polygon. g1 and g2 ask for f at the same x
        // back to back; a one-entry memo halves the evaluations.
        let lastX = NaN;
        let lastV = NaN;
        const at = (x: number): number => {
            if (x !== lastX) {
                lastX = x;
                lastV = fn(x);
            }
            return lastV;
        };
        const set: ConstraintSet = {
            entries: [
                { disjuncts: [[{ id: 0, g: (x, y) => Math.min(at(x), 0) - y, affine: null }]] },
                { disjuncts: [[{ id: 1, g: (x, y) => y - Math.max(at(x), 0), affine: null }]] },
                { disjuncts: [[{ id: 2, g: (x) => lo - x, affine: { a: -1, b: 0, c: lo } }]] },
                { disjuncts: [[{ id: 3, g: (x) => x - hi, affine: { a: 1, b: 0, c: -hi } }]] },
            ],
        };
        const region = computeRegion(set, view, grid);
        if (!region.empty && region.rings.length) {
            out.fills.push({
                rings: region.rings,
                color,
                opacity: num(f.fillOpacity, 0.2),
                pattern: f.fillPattern || 'solid',
            });
        }
    }

    let extrema: ReturnType<typeof findExtrema1D> | null = null;
    const getExtrema = () => extrema || (extrema = findExtrema1D(fn, lo, hi));

    const tp = str(f.tangentPoint).trim();
    if (f.tangent && tp) tangent(out, name, fn, lo, hi, tp, color, getExtrema, ctx);

    if (f.extrema) {
        for (const [index, e] of getExtrema().entries()) {
            out.markers.push({ x: e.x, y: e.y, color, size: 'normal' });
            addHandle(out, { ref: { part: 'extremum', index }, point: { x: e.x, y: e.y } });
            const min = e.type === 'minimum';
            // Below a minimum, above a maximum, unless a line (the tangent, another curve) runs there.
            out.texts.push({
                x: e.x,
                y: e.y,
                template: 'label',
                literal: min ? 'min' : 'max',
                color,
                size: 'small',
                dir: { x: 0, y: min ? -1 : 1 },
                marker: 'normal',
            });
        }
    }
    return out;
}

function tangent(
    out: Output,
    name: string,
    fn: (x: number) => number,
    lo: number,
    hi: number,
    tp: string,
    color: string,
    getExtrema: () => ReturnType<typeof findExtrema1D>,
    ctx: Ctx
): void {
    const { math, view } = ctx;
    let x0: number;
    const kw = TANGENT_KEYWORD_RE.exec(tp);
    if (kw) {
        // Live keyword: the n-th local minimum / maximum from the left.
        const want = kw[1] === 'min' ? 'minimum' : 'maximum';
        const n = kw[2] ? Number(kw[2]) : 1;
        if (!(n >= 1)) {
            fail(out, name, 'tangentPoint', `Use ${kw[1]}, ${kw[1]}2, ${kw[1]}3, ... (counted from the left)`);
            return;
        }
        const found = getExtrema().filter((e) => e.type === want);
        if (found.length < n) {
            const what = found.length ? `only ${found.length} local ${want === 'minimum' ? 'minima' : 'maxima'}` : `no local ${want}`;
            fail(out, name, 'tangentPoint', `${name} has ${what} for the tangent at ${kw[1]}${kw[2]}`);
            return;
        }
        x0 = found[n - 1].x;
    } else {
        const res = math.tryValue(tp);
        if (!res.ok) {
            // Not yet available (a derived name like P1_x without a value) is not a typo.
            if (math.validate(tp, 'value').ok) addIssue(out, name, 'tangentPoint', res.message, 'info');
            else fail(out, name, 'tangentPoint', res.message);
            return;
        }
        x0 = res.value;
    }
    const y0 = fn(x0);
    if (!finite(y0)) {
        fail(out, name, 'tangentPoint', `${name} is not defined at x = ${fmtNum(x0)}`);
        return;
    }
    const h = Math.max(hi - lo, Math.abs(x0)) * DERIV_REL;
    const fp = fn(x0 + h);
    const fm = fn(x0 - h);
    let slope = (fp - fm) / (2 * h);
    if (!finite(slope)) slope = finite(fp) ? (fp - y0) / h : (y0 - fm) / h;
    if (!finite(slope)) {
        fail(out, name, 'tangentPoint', `${name} has no tangent at x = ${fmtNum(x0)}`);
        return;
    }
    // Drawn across the function's domain (the view when the domain follows it).
    const span: View = { xmin: Math.max(view.xmin, lo), xmax: Math.min(view.xmax, hi), ymin: view.ymin, ymax: view.ymax };
    const seg = span.xmax > span.xmin ? clipLineToView(slope, -1, y0 - slope * x0, span) : null;
    if (seg) out.strokes.push({ lines: [[seg[0], seg[1]]], color, width: 'thin', dashed: true, exact: true });
    out.markers.push({ x: x0, y: y0, color, size: 'normal' });
    addHandle(out, { ref: { part: 'tangent' }, point: { x: x0, y: y0 }, lines: seg ? [[seg[0], seg[1]]] : [] });
}

// ------------------------------------------------------------------ region

interface Clause {
    id: number;
    entry: number;
    /** Position in the entry's DNF: disjunct index and clause index within it. */
    disjunct: number;
    index: number;
    g: (x: number, y: number) => number;
    affine: Affine | null;
    text: string;
}

/** True when a x + b y + c = 0 is (numerically) one of the view's border lines. */
function onViewBorder(a: number, b: number, c: number, view: View): boolean {
    const scale = Math.abs(a) + Math.abs(b);
    if (!(scale > 0)) return false;
    if (Math.abs(b) <= 1e-12 * scale) {
        const x = -c / a;
        const tol = BORDER_REL * (view.xmax - view.xmin);
        return Math.abs(x - view.xmin) <= tol || Math.abs(x - view.xmax) <= tol;
    }
    if (Math.abs(a) <= 1e-12 * scale) {
        const y = -c / b;
        const tol = BORDER_REL * (view.ymax - view.ymin);
        return Math.abs(y - view.ymin) <= tol || Math.abs(y - view.ymax) <= tol;
    }
    return false;
}

/** A contour lying entirely on one border line (g = 0 along x = xmin, say). */
function polylineOnBorder(line: Pt[], view: View): boolean {
    const tx = BORDER_REL * (view.xmax - view.xmin);
    const ty = BORDER_REL * (view.ymax - view.ymin);
    const all = (test: (p: Pt) => boolean) => line.every(test);
    return (
        all((p) => Math.abs(p.x - view.xmin) <= tx) ||
        all((p) => Math.abs(p.x - view.xmax) <= tx) ||
        all((p) => Math.abs(p.y - view.ymin) <= ty) ||
        all((p) => Math.abs(p.y - view.ymax) <= ty)
    );
}

/** One issue per broken condition entry (math.conditions stops at the first). */
function conditionErrors(out: Output, t: RegionTool, conds: string[], e: unknown, math: MathContext): void {
    let any = false;
    conds.forEach((c, i) => {
        if (!c.trim()) return;
        const v = math.validate(c, 'condition');
        if (v.ok) return;
        any = true;
        fail(out, t.name, `condition:${i}`, `condition ${i + 1}: ${v.message}`);
    });
    if (!any) {
        const idx = e && typeof e === 'object' && typeof (e as { index?: unknown }).index === 'number' ? (e as { index: number }).index : undefined;
        fail(out, t.name, idx === undefined ? undefined : `condition:${idx}`, errorText(e));
    }
}

function computeRegionTool(t: RegionTool, ctx: Ctx): Output {
    const out = newOutput();
    const { math, view, grid } = ctx;
    const conds = (Array.isArray(t.conditions) ? t.conditions : []).map(str);
    // No condition yet (a fresh card): nothing to draw, nothing wrong.
    if (!conds.some((c) => c.trim())) return out;
    let entries: ConditionEntry[];
    try {
        entries = math.conditions(conds);
    } catch (e) {
        conditionErrors(out, t, conds, e, math);
        return out;
    }
    const clauses: Clause[] = [];
    const set: ConstraintSet = {
        entries: entries.map((en) => ({
            disjuncts: en.disjuncts.map((d, di) =>
                d.map((c, ci) => {
                    const id = clauses.length;
                    clauses.push({ id, entry: en.entry, disjunct: di, index: ci, g: c.g, affine: finiteAffine(c.affine), text: c.text });
                    return { id, g: c.g, affine: c.affine };
                })
            ),
        })),
    };
    const result = computeRegion(set, view, grid);
    out.region = { result, set };
    const color = str(t.color) || 'blue';
    const width = str(t.thickness) || 'thin';

    if (t.fill && !result.empty && result.rings.length) {
        out.fills.push({ rings: result.rings, color, opacity: num(t.fillOpacity, 0.25), pattern: t.fillPattern || 'solid' });
    }
    if ((t.outline === 'solid' || t.outline === 'dashed') && result.boundary.length) {
        out.strokes.push({
            lines: result.boundary.map((b) => b.line),
            color,
            width,
            dashed: t.outline === 'dashed',
            exact: result.exact,
        });
    }

    // Constraint lines g = 0 across the view, one per distinct clause.
    const clauseLines = new Map<number, Pt[][]>();
    if (t.constraintLines) {
        const exact: Pt[][] = [];
        const curved: Pt[][] = [];
        const drawn = new Map<string, Pt[][]>();
        for (const c of clauses) {
            const af = c.affine;
            let dedupe: string;
            if (af) {
                const n = Math.hypot(af.a, af.b);
                const s = af.a > 0 || (af.a === 0 && af.b > 0) ? 1 : -1;
                dedupe = n > 0 ? [af.a, af.b, af.c].map((v) => ((s * v) / n).toPrecision(10)).join(',') : `zero:${c.id}`;
            } else dedupe = `text:${c.text}`;
            let lines = drawn.get(dedupe);
            if (!lines) {
                if (af) {
                    const seg = onViewBorder(af.a, af.b, af.c, view) ? null : clipLineToView(af.a, af.b, af.c, view);
                    lines = seg ? [[seg[0], seg[1]]] : [];
                    exact.push(...lines);
                } else {
                    lines = computeContours(c.g, [0], view, grid)[0].filter((l) => l.length >= 2 && !polylineOnBorder(l, view));
                    curved.push(...lines);
                }
                drawn.set(dedupe, lines);
            }
            clauseLines.set(c.id, lines);
        }
        if (exact.length) out.strokes.push({ lines: exact, color, width, dashed: false, exact: true });
        if (curved.length) out.strokes.push({ lines: curved, color, width, dashed: false });
    }

    // Drag handles, one per clause: its constraint line(s) and, when the
    // region draws a fill or an outline, its own boundary runs (a clause on
    // the view border is grabbed there). Deduplicated constraint lines stay
    // grabbable for every clause that shares them.
    const drawsBoundary = (t.fill && !result.empty && result.rings.length > 0) || t.outline === 'solid' || t.outline === 'dashed';
    for (const c of clauses) {
        const lines: Pt[][] = [...(clauseLines.get(c.id) || [])];
        if (drawsBoundary) for (const run of result.boundary) if (run.tag === c.id && run.line.length >= 2) lines.push(run.line);
        if (!lines.length) continue;
        const anchors = result.vertices.filter((v) => v.tags[0] === c.id || v.tags[1] === c.id).map((v) => ({ x: v.x, y: v.y }));
        addHandle(out, { ref: { part: 'clause', entry: c.entry, disjunct: c.disjunct, clause: c.index }, lines, anchors });
    }

    // Condition labels: on the constraint line's visible end (lines on), or
    // beside the region's own boundary run of that condition (lines off).
    const labels = Array.isArray(t.conditionLabels) ? t.conditionLabels.map(str) : [];
    conds.forEach((_, k) => {
        if (!(labels[k] || '').trim()) return;
        const own = clauses.filter((c) => c.entry === k);
        let spot: { p: Pt; clause: Clause; line: Pt[] } | null = null;
        if (t.constraintLines) {
            for (const c of own) {
                const line = labelLine(clauseLines.get(c.id) || [], view, !c.affine);
                if (line) {
                    spot = { p: labelSpot(line, view, !c.affine).p, clause: c, line };
                    break;
                }
            }
        } else {
            let best: { line: Pt[]; clause: Clause } | null = null;
            for (const run of result.boundary) {
                const c = own.find((x) => x.id === run.tag);
                if (c && (!best || lineLength(run.line) > lineLength(best.line))) best = { line: run.line, clause: c };
            }
            if (best) spot = { p: midSpot(best.line).p, clause: best.clause, line: best.line };
        }
        if (!spot) return;
        out.texts.push({
            x: spot.p.x,
            y: spot.p.y,
            template: k,
            color,
            size: 'small',
            dir: gradientDir(spot.clause.g, spot.clause.affine, spot.p, view),
            slide: spot.line,
        });
    });

    if (result.empty) addIssue(out, t.name, undefined, 'no point of the view satisfies all conditions', 'info');
    else if (str(t.label).trim()) {
        const p = labelPoint(result, view);
        // Moved off the axes and other labels per frame (layoutTexts), once the text is known.
        if (p) out.texts.push({ x: p.x, y: p.y, template: 'label', color, size: 'large', weight: 'bold', anchor: 'center', halo: true, region: true });
    }
    return out;
}

// ------------------------------------------------------------------- curve

/**
 * Levels of a curve; null after a real error. Values missing only because a
 * derived name is unset are skipped. `items[k]` is the position of
 * `values[k]` in the levels list (parseList), -1 for the implicit 0 of an
 * empty list.
 */
function curveLevels(t: CurveTool, ctx: Ctx, out: Output): { values: number[]; items: number[] } | null {
    const src = str(t.levels);
    if (!src.trim()) return { values: [0], items: [-1] };
    try {
        const values = ctx.math.values(src);
        return { values, items: values.map((_, i) => i) };
    } catch (e) {
        if (!ctx.math.validate(src, 'levels').ok) {
            fail(out, t.name, 'levels', errorText(e));
            return null;
        }
        addIssue(out, t.name, 'levels', errorText(e), 'info');
        const values: number[] = [];
        const items: number[] = [];
        splitTopLevel(src, ',').forEach((item, i) => {
            const v = ctx.math.value(item);
            if (!finite(v)) return;
            values.push(v);
            items.push(i);
        });
        return { values, items };
    }
}

function computeCurveTool(t: CurveTool, ctx: Ctx): Output {
    const out = newOutput();
    const { math, view, grid } = ctx;
    const eq = str(t.equation);
    if (!eq.trim()) return out;
    let parsed: { F: (x: number, y: number) => number; affine: Affine | null };
    try {
        parsed = math.equation(eq);
    } catch (e) {
        return fail(out, t.name, 'equation', errorText(e));
    }
    const listed = curveLevels(t, ctx, out);
    if (!listed) return out;
    const levels = listed.values;
    const affine = finiteAffine(parsed.affine);
    const lines = levels.length ? computeContours(parsed.F, levels, view, grid, affine) : [];
    out.curve = { F: parsed.F, affine, levels, lines };
    const color = str(t.color) || 'black';
    const all: Pt[][] = [];
    lines.forEach((perLevel, k) => {
        const drawn = perLevel.filter((l) => l.length >= 2);
        for (const l of drawn) all.push(l);
        if (drawn.length) addHandle(out, { ref: { part: 'level', index: k, item: listed.items[k] }, lines: drawn });
    });
    if (all.length) out.strokes.push({ lines: all, color, width: str(t.thickness) || 'thin', dashed: !!t.dashed, exact: !!affine });

    if (str(t.label).trim()) {
        lines.forEach((perLevel, k) => {
            const line = labelLine(perLevel, view, !affine);
            if (!line) return;
            const { p, dir } = labelSpot(line, view, !affine);
            out.texts.push({
                x: p.x,
                y: p.y,
                template: 'label',
                locals: { level: levels[k] },
                color,
                size: 'small',
                dir: towardCenter(p, dir, view),
                slide: line,
            });
        });
    }
    return out;
}

/** The normal of direction `dir` (math units) at p that points towards the view centre, in normalized units. */
function towardCenter(p: Pt, dir: Pt, view: View): Pt {
    const d = normDir(dir.x, dir.y, view, { x: 1, y: 0 });
    let n = { x: -d.y, y: d.x };
    const cx = (view.xmin + view.xmax) / 2 - p.x;
    const cy = (view.ymin + view.ymax) / 2 - p.y;
    const c = normDir(cx, cy, view, n);
    if (n.x * c.x + n.y * c.y < 0) n = { x: -n.x, y: -n.y };
    return n;
}

// ------------------------------------------------------------------ points

type Crossable =
    | { kind: 'fn'; name: string; fn: (x: number) => number; lo: number; hi: number }
    | { kind: 'curve'; name: string; data: CurveData };

/** Resolve an intersections reference; null when blank or broken (an issue is recorded for broken ones). */
function crossable(ref: string, field: 'ref1' | 'ref2', t: PointsTool, ctx: Ctx, out: Output): Crossable | null {
    const name = ref.trim();
    if (!name) return null;
    const info = ctx.math.functionInfo(name);
    if (info) {
        if (info.kind === 'parametric') {
            fail(out, t.name, field, `${name} is parametric: choose a function y = f(x) or a curve`);
            return null;
        }
        if (info.kind === 'polar') {
            fail(out, t.name, field, `${name} is a polar function: choose a function y = f(x) or a curve`);
            return null;
        }
        if (info.error || info.domainError) {
            // A fresh function card with no formula yet is not a mistake (like a curve without equation).
            const params = ctx.functions[info.index];
            if (!info.domainError && params && !str(params.expression).trim()) {
                addIssue(out, t.name, field, `${name} has no formula yet`, 'info');
                return null;
            }
            fail(out, t.name, field, `${name} has an error: ${info.error || info.domainError}`);
            return null;
        }
        const [lo, hi] = info.domain || [ctx.view.xmin, ctx.view.xmax];
        return { kind: 'fn', name, fn: info.fn, lo, hi };
    }
    const tool = ctx.toolsByName.get(name);
    if (!tool) {
        fail(out, t.name, field, `${name} does not exist`);
        return null;
    }
    if (tool.type !== 'curve') {
        fail(out, t.name, field, `${name} is not a function or curve`);
        return null;
    }
    const prod = ctx.outputs.get(name);
    if (!prod || !prod.curve) {
        if (!prod || prod.failed) fail(out, t.name, field, `${name} has an error`);
        else addIssue(out, t.name, field, `${name} has no equation yet`, 'info');
        return null;
    }
    return { kind: 'curve', name, data: prod.curve };
}

/** Sharpen a crossing of F1 = 0 and F2 = 0 with a few Newton steps; keeps p unless the step converged nearby. */
function refineCrossing(F1: (x: number, y: number) => number, F2: (x: number, y: number) => number, p: Pt, ctx: Ctx): Pt {
    const { view, grid } = ctx;
    const hx = (view.xmax - view.xmin) * DERIV_REL;
    const hy = (view.ymax - view.ymin) * DERIV_REL;
    const cell = Math.max((view.xmax - view.xmin) / grid.nx, (view.ymax - view.ymin) / grid.ny);
    const residual = (x: number, y: number) => Math.max(Math.abs(F1(x, y)), Math.abs(F2(x, y)));
    let x = p.x;
    let y = p.y;
    for (let k = 0; k < CROSS_NEWTON; k++) {
        const f1 = F1(x, y);
        const f2 = F2(x, y);
        if (!finite(f1) || !finite(f2) || (f1 === 0 && f2 === 0)) break;
        const a = (F1(x + hx, y) - F1(x - hx, y)) / (2 * hx);
        const b = (F1(x, y + hy) - F1(x, y - hy)) / (2 * hy);
        const c = (F2(x + hx, y) - F2(x - hx, y)) / (2 * hx);
        const d = (F2(x, y + hy) - F2(x, y - hy)) / (2 * hy);
        const det = a * d - b * c;
        if (!finite(det) || det === 0) break;
        x -= (f1 * d - b * f2) / det;
        y -= (a * f2 - c * f1) / det;
    }
    const r0 = residual(p.x, p.y);
    const r1 = residual(x, y);
    if (finite(x) && finite(y) && Math.hypot(x - p.x, y - p.y) <= 2 * cell && finite(r1) && !(r1 > r0)) return { x, y };
    return p;
}

/**
 * Crossings of two functions / curves (curve levels included). Points where
 * the two only touch (a tangent line, a level curve touching a budget line)
 * are found too, wherever the gap between them has a local minimum within
 * TOUCH_REL of the view of zero.
 */
function intersections(a: Crossable, b: Crossable, ctx: Ctx): Pt[] {
    const pts: Pt[] = [];
    const { view } = ctx;
    const xSpan = view.xmax - view.xmin;
    const ySpan = view.ymax - view.ymin;
    const reach = TOUCH_REL * Math.max(xSpan, ySpan);
    const hx = xSpan * DERIV_REL;
    const hy = ySpan * DERIV_REL;
    // F(x, y) = v lies within `reach` of the zero set of F (to first order).
    const nearZero = (F: (x: number, y: number) => number, x: number, y: number, v: number): boolean => {
        const gx = (F(x + hx, y) - F(x - hx, y)) / (2 * hx);
        const gy = (F(x, y + hy) - F(x, y - hy)) / (2 * hy);
        const g = Math.hypot(gx, gy);
        return finite(g) && g > 0 && Math.abs(v) <= reach * g;
    };
    if (a.kind === 'fn' && b.kind === 'fn') {
        const lo = Math.max(a.lo, b.lo);
        const hi = Math.min(a.hi, b.hi);
        // f - g is a vertical gap in y units.
        const touch = (_x: number, v: number) => Math.abs(v) <= TOUCH_REL * ySpan;
        for (const x of findCrossings((x) => a.fn(x) - b.fn(x), lo, hi, undefined, touch)) pts.push({ x, y: a.fn(x) });
    } else if (a.kind === 'fn' || b.kind === 'fn') {
        const f = (a.kind === 'fn' ? a : b) as Extract<Crossable, { kind: 'fn' }>;
        const c = (a.kind === 'curve' ? a : b) as Extract<Crossable, { kind: 'curve' }>;
        for (const level of c.data.levels) {
            const Fc = (x: number, y: number) => c.data.F(x, y) - level;
            const touch = (x: number, v: number) => nearZero(Fc, x, f.fn(x), v);
            for (const x of findCrossings((x) => Fc(x, f.fn(x)), f.lo, f.hi, undefined, touch)) pts.push({ x, y: f.fn(x) });
        }
    } else if (a.kind === 'curve' && b.kind === 'curve') {
        const da = a.data;
        const db = b.data;
        if (da.affine && db.affine) {
            for (const la of da.levels) {
                for (const lb of db.levels) {
                    const p = intersectLines(
                        { a: da.affine.a, b: da.affine.b, c: da.affine.c - la },
                        { a: db.affine.a, b: db.affine.b, c: db.affine.c - lb }
                    );
                    if (p) pts.push(p);
                }
            }
        } else {
            // Walk the exact line when there is one (a sign-change scan along
            // it, like a function), else the first curve's contour polylines,
            // and look for sign changes of the other curve's F.
            const [walk, other] = db.affine && !da.affine ? [db, da] : [da, db];
            walk.levels.forEach((lw, k) => {
                const Fw = (x: number, y: number) => walk.F(x, y) - lw;
                for (const lv of other.levels) {
                    const Fo = (x: number, y: number) => other.F(x, y) - lv;
                    for (const line of walk.lines[k] || []) {
                        if (walk.affine && line.length === 2) {
                            const [p, q] = line;
                            const at = (s: number): Pt => ({ x: p.x + s * (q.x - p.x), y: p.y + s * (q.y - p.y) });
                            const along = (s: number): number => {
                                const r = at(s);
                                return Fo(r.x, r.y);
                            };
                            const touch = (s: number, v: number): boolean => {
                                const r = at(s);
                                return nearZero(Fo, r.x, r.y, v);
                            };
                            for (const s of findCrossings(along, 0, 1, undefined, touch)) pts.push(at(s));
                        } else {
                            for (const p of crossingsAlongPolylines([line], Fo)) pts.push(refineCrossing(Fw, Fo, p, ctx));
                        }
                    }
                }
            });
        }
    }
    const eps = 1e-9 * Math.max(xSpan, ySpan);
    return dedupePoints(sortPoints(pts.filter((p) => finite(p.x) && finite(p.y))), eps);
}

/** Info text for a region with no point in the view: infeasible only when that is certain. */
function emptyRegionText(name: string, region: RegionData, view: View): string {
    return feasibleBeyondView(region.set, view) === false ? `${name} is empty (infeasible)` : `${name} has no points in the view`;
}

/** Bounding box of region rings, padded by a grid cell (marching-squares rings run up to a cell inside the boundary). */
function ringBounds(rings: Pt[][], view: View, grid: Grid): View {
    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const ring of rings) {
        for (const p of ring) {
            if (p.x < xmin) xmin = p.x;
            if (p.x > xmax) xmax = p.x;
            if (p.y < ymin) ymin = p.y;
            if (p.y > ymax) ymax = p.y;
        }
    }
    const cw = (view.xmax - view.xmin) / grid.nx;
    const ch = (view.ymax - view.ymin) / grid.ny;
    return { xmin: xmin - cw, xmax: xmax + cw, ymin: ymin - ch, ymax: ymax + ch };
}

/** The region a points tool reads; null (with an issue when needed) when it is not usable. */
function regionOf(t: PointsTool, ctx: Ctx, out: Output): RegionData | null {
    const name = str(t.regionName).trim();
    const tool = ctx.toolsByName.get(name);
    if (!tool) {
        fail(out, t.name, 'regionName', `${name} does not exist`);
        return null;
    }
    if (tool.type !== 'region') {
        fail(out, t.name, 'regionName', `${name} is not a region`);
        return null;
    }
    const prod = ctx.outputs.get(name);
    if (!prod || !prod.region) {
        if (!prod || prod.failed) fail(out, t.name, 'regionName', `${name} has an error`);
        else addIssue(out, t.name, 'regionName', `${name} has no conditions yet`, 'info');
        return null;
    }
    return prod.region;
}

/**
 * List points; null after a real error. Points missing only because a derived
 * name is unset are skipped. When `items` is given, it receives the position
 * of each returned point in the list (parseTuples index).
 */
function listPoints(src: string, dim: 2 | 3, name: string, ctx: Ctx, out: Output, items?: number[]): number[][] | null {
    const { math } = ctx;
    if (!src.trim()) return [];
    try {
        const pts = math.tuples(src, dim);
        if (items) pts.forEach((_, i) => items.push(i));
        return pts;
    } catch (e) {
        if (!math.validate(src, dim === 2 ? 'tuples2' : 'tuples3').ok) {
            fail(out, name, 'points', errorText(e));
            return null;
        }
        addIssue(out, name, 'points', errorText(e), 'info');
        const pts: number[][] = [];
        // Empty items are skipped by the list parser too, so only non-empty ones count.
        let index = 0;
        for (const item of splitTopLevel(src, ';')) {
            if (!item.trim()) continue;
            const at = index++;
            try {
                for (const p of math.tuples(item, dim)) {
                    pts.push(p);
                    if (items) items.push(at);
                }
            } catch {
                // This point waits for its derived value.
            }
        }
        return pts;
    }
}

/**
 * Corner points in ring order (counter-clockwise). A single polygon starts at
 * its bottom-left corner, so `A; B; C; D` labels do not depend on where the
 * region engine happened to start the ring.
 */
function corners(result: RegionResult, view: View): Pt[] {
    const pts = result.vertices.map((v) => ({ x: v.x, y: v.y }));
    if (result.rings.length !== 1 || pts.length < 2) return pts;
    const key = (p: Pt) => (p.x - view.xmin) / (view.xmax - view.xmin) + (p.y - view.ymin) / (view.ymax - view.ymin);
    let k = 0;
    for (let i = 1; i < pts.length; i++) {
        const d = key(pts[i]) - key(pts[k]);
        if (d < -1e-12 || (Math.abs(d) <= 1e-12 && pts[i].y < pts[k].y)) k = i;
    }
    return pts.slice(k).concat(pts.slice(0, k));
}

/** Publish P_x, P_y (P_z), P_val, P_n and the indexed P_x2, P_y2, ... */
function publish(out: Output, name: string, pts: number[][], val: number, dim: 2 | 3): void {
    const d = out.derived;
    d[`${name}_n`] = pts.length;
    d[`${name}_val`] = val;
    const axes = dim === 3 ? ['x', 'y', 'z'] : ['x', 'y'];
    pts.forEach((p, i) => {
        axes.forEach((axis, j) => {
            d[i === 0 ? `${name}_${axis}` : `${name}_${axis}${i + 1}`] = p[j];
        });
    });
}

function computePointsTool(t: PointsTool, ctx: Ctx): Output {
    const out = newOutput();
    const { math, view, grid } = ctx;
    const name = t.name;
    let pts: Pt[] = [];
    /** Position of each point in the `points` list (list source), else -1. Filtered along with `pts`. */
    let items: number[] = [];
    let vals: number[] | null = null;
    let best = NaN;
    let dim = false;
    const objective = str(t.objective).trim();
    const regionName = str(t.regionName).trim();

    switch (t.source) {
        case 'list': {
            const list = listPoints(str(t.points), 2, name, ctx, out, items);
            if (!list) return out;
            pts = list.map((p) => ({ x: p[0], y: p[1] }));
            break;
        }
        case 'intersections': {
            const a = crossable(str(t.ref1), 'ref1', t, ctx, out);
            const b = crossable(str(t.ref2), 'ref2', t, ctx, out);
            if (out.failed || !a || !b) break;
            if (a.name === b.name) return fail(out, name, 'ref2', 'Choose two different items');
            pts = intersections(a, b, ctx);
            if (!pts.length) addIssue(out, name, 'ref2', `${a.name} and ${b.name} do not cross in the view`, 'info');
            break;
        }
        case 'region': {
            if (!regionName) break;
            const region = regionOf(t, ctx, out);
            if (!region) break;
            if (region.result.empty) {
                addIssue(out, name, 'regionName', emptyRegionText(regionName, region, view), 'info');
                break;
            }
            if (!objective) {
                pts = corners(region.result, view);
                break;
            }
            let obj: (x: number, y: number) => number;
            try {
                obj = math.fn2(objective);
            } catch (e) {
                return fail(out, name, 'objective', errorText(e));
            }
            let objAffine: Affine | null = null;
            try {
                objAffine = finiteAffine(math.equation(objective).affine);
            } catch {
                objAffine = null;
            }
            const sense = t.sense === 'min' ? 'min' : 'max';
            const res = optimizeOverRegion(obj, objAffine, region.result, region.set, view, grid, sense);
            if (res.status === 'empty') {
                addIssue(out, name, 'regionName', emptyRegionText(regionName, region, view), 'info');
                break;
            }
            if (res.status === 'unbounded') {
                addIssue(out, name, 'objective', `objective is unbounded on ${regionName}`, 'info');
                dim = true;
            } else if (res.status === 'outside') {
                // Proven finite only on the exact path; otherwise it may also be unbounded.
                const exact = !!objAffine && region.result.exact;
                const msg = exact ? `the optimum on ${regionName} lies outside the view` : `the objective still improves beyond the view on ${regionName}`;
                addIssue(out, name, 'objective', msg, 'info');
                dim = true;
            }
            pts = res.points.filter((p) => finite(p.x) && finite(p.y));
            best = res.value;
            vals = pts.map(() => res.value);
            break;
        }
        case 'lattice': {
            let set: ConstraintSet | null = null;
            let bounds: View | undefined;
            if (regionName) {
                const region = regionOf(t, ctx, out);
                if (!region) break;
                if (region.result.empty) {
                    addIssue(out, name, 'regionName', emptyRegionText(regionName, region, view), 'info');
                    break;
                }
                set = region.set;
                bounds = ringBounds(region.result.rings, view, grid);
            }
            if (!objective) {
                const res = latticePoints(set, view, undefined, { bounds });
                pts = res.points;
                if (res.truncated) addIssue(out, name, 'regionName', `showing the first ${pts.length} integer points`, 'info');
                break;
            }
            // Integer optimum: the objective is evaluated during the scan, so no point is skipped.
            let obj: (x: number, y: number) => number;
            try {
                obj = math.fn2(objective);
            } catch (e) {
                return fail(out, name, 'objective', errorText(e));
            }
            const sense = t.sense === 'min' ? 'min' : 'max';
            const res = latticePoints(set, view, undefined, { bounds, select: { f: obj, sense, tieRel: TIE_REL } });
            pts = res.points;
            const value = res.value === undefined ? NaN : res.value;
            if (pts.length && finite(value)) {
                best = value;
                vals = pts.map(() => value);
            } else if (res.inside) addIssue(out, name, 'objective', 'objective is not defined at any of the points', 'info');
            if (res.truncated) {
                addIssue(out, name, 'objective', 'the integer optimum was searched over the first million integer points only', 'info');
                dim = true;
            }
            const count = res.count || 0;
            if (count > pts.length) addIssue(out, name, 'objective', `showing ${pts.length} of ${count} tied integer optima`, 'info');
            break;
        }
    }
    if (out.failed) return out;
    // -0 (lattice scans from a negative view edge) prints and compares as 0.
    pts = pts.map((p) => ({ x: p.x === 0 ? 0 : p.x, y: p.y === 0 ? 0 : p.y }));
    if (t.source !== 'list') items = pts.map(() => -1);

    // Objective selection over a discrete candidate set: keep the best one(s).
    // (Region optima and lattice optima are selected by the geometry engine.)
    if (objective && (t.source === 'list' || t.source === 'intersections')) {
        let obj: (x: number, y: number) => number;
        try {
            obj = math.fn2(objective);
        } catch (e) {
            return fail(out, name, 'objective', errorText(e));
        }
        if (pts.length) {
            const sign = t.sense === 'min' ? -1 : 1;
            const all = pts.map((p) => obj(p.x, p.y));
            let top = -Infinity;
            for (const v of all) if (finite(v) && sign * v > top) top = sign * v;
            if (top === -Infinity) {
                addIssue(out, name, 'objective', 'objective is not defined at any of the points', 'info');
                pts = [];
                items = [];
            } else {
                const tol = TIE_REL * Math.max(1, Math.abs(top));
                const keep = pts.map((_, i) => finite(all[i]) && sign * all[i] >= top - tol);
                pts = pts.filter((_, i) => keep[i]);
                items = items.filter((_, i) => keep[i]);
                vals = all.filter((_, i) => keep[i]);
                best = sign * top;
            }
        }
    }

    out.points = pts.map((p) => [p.x, p.y]);
    publish(out, name, out.points, best, 2);

    const color = str(t.color) || 'red';
    const size: MarkerSize = t.size === 'small' || t.size === 'large' ? t.size : 'normal';
    // Only list points are typed numbers; every other source computes its points.
    const locked: LockKind | undefined =
        t.source === 'region' ? (objective ? 'optimum' : 'corner') : t.source === 'intersections' ? 'intersection' : t.source === 'lattice' ? 'lattice' : undefined;
    pts.forEach((p, index) => {
        const m: MarkerPrim = { x: p.x, y: p.y, color, size };
        if (dim) m.dim = true;
        out.markers.push(m);
        const handle: HandlePrim = { ref: { part: 'point', index, item: items[index] ?? -1 }, point: { x: p.x, y: p.y } };
        if (locked) handle.locked = locked;
        addHandle(out, handle);
    });

    if (t.dropLines) {
        // To the axes: y = 0 / x = 0 for centred axes when 0 is visible, else the view edge.
        const middle = ctx.axisStyle === 'middle';
        const yBase = middle && view.ymin <= 0 && view.ymax >= 0 ? 0 : view.ymin;
        const xBase = middle && view.xmin <= 0 && view.xmax >= 0 ? 0 : view.xmin;
        const lines: Pt[][] = [];
        for (const p of pts) {
            if (p.x < view.xmin || p.x > view.xmax || p.y < view.ymin || p.y > view.ymax) continue;
            lines.push([{ x: p.x, y: yBase }, { x: p.x, y: p.y }, { x: xBase, y: p.y }]);
        }
        if (lines.length) out.guides.push({ lines, color, width: 'thin', dashed: true, exact: true });
    }

    if (str(t.label).trim()) {
        pts.forEach((p, i) => {
            out.texts.push({
                x: p.x,
                y: p.y,
                template: 'label',
                part: i,
                locals: { x: p.x, y: p.y, val: vals ? vals[i] : NaN, i: i + 1 },
                color,
                size: 'small',
                dir: UP_RIGHT,
                marker: size,
            });
        });
    }
    return out;
}

// ----------------------------------------------------------------- segment

/**
 * Path points (spliced points tools included); null after an error or while a
 * derived value is missing. When `items` is given, it receives each point's
 * entry in the path text (parseTuples index), -1 for spliced points.
 */
function pathPoints(t: SegmentTool, dim: 2 | 3, ctx: Ctx, out: Output, items?: number[]): number[][] | null {
    const { math } = ctx;
    const src = str(t.path);
    let entries: PathEntry[];
    try {
        entries = math.path(src, dim);
    } catch (e) {
        if (math.validate(src, dim === 2 ? 'path2' : 'path3').ok) addIssue(out, t.name, 'path', errorText(e), 'info');
        else fail(out, t.name, 'path', errorText(e));
        return null;
    }
    const pts: number[][] = [];
    for (const [i, entry] of entries.entries()) {
        if ('point' in entry) {
            pts.push(entry.point);
            if (items) items.push(i);
            continue;
        }
        const tool = ctx.toolsByName.get(entry.name);
        if (!tool || tool.type !== 'points' || (tool.dim === 3 ? 3 : 2) !== dim) {
            fail(out, t.name, 'path', `'${entry.name}' is not a points tool`);
            return null;
        }
        const prod = ctx.outputs.get(entry.name);
        if (!prod || !prod.points) {
            fail(out, t.name, 'path', `${entry.name} has an error`);
            return null;
        }
        for (const p of prod.points) {
            pts.push(p);
            if (items) items.push(-1);
        }
    }
    return pts;
}

const ARROWS: Record<string, ArrowHeads | undefined> = { forward: 'forward', backward: 'backward', both: 'both' };

function computeSegmentTool(t: SegmentTool, ctx: Ctx): Output {
    const out = newOutput();
    if (!str(t.path).trim()) return out;
    const items: number[] = [];
    const raw = pathPoints(t, 2, ctx, out, items);
    if (!raw) return out;
    const pts = raw.map((p) => ({ x: p[0], y: p[1] }));
    if (pts.length < 2) {
        addIssue(out, t.name, 'path', 'a path needs at least two points', 'info');
        return out;
    }
    const color = str(t.color) || 'black';
    // Drag handles: vertices as drawn and the legs between them (a brace uses the first two points).
    const drawnCount = t.style === 'brace' ? 2 : pts.length;
    for (let i = 0; i + 1 < drawnCount; i++) addHandle(out, { ref: { part: 'leg', index: i }, lines: [[pts[i], pts[i + 1]]] });
    if (t.style !== 'brace' && t.closed && pts.length > 2) {
        addHandle(out, { ref: { part: 'leg', index: pts.length - 1 }, lines: [[pts[pts.length - 1], pts[0]]] });
    }
    for (let i = 0; i < drawnCount; i++) addHandle(out, { ref: { part: 'vertex', index: i, item: items[i] ?? -1 }, point: { x: pts[i].x, y: pts[i].y } });
    if (t.style === 'brace') {
        out.braces.push({ from: pts[0], to: pts[1], color });
        return out;
    }
    const arrow = ARROWS[t.style];
    const width = str(t.thickness) || 'thin';
    const dashed = !!t.dashed;
    if (arrow) {
        // Arrow heads on every leg (a simplex path), closing leg included.
        const legs: Pt[][] = [];
        for (let i = 1; i < pts.length; i++) legs.push([pts[i - 1], pts[i]]);
        if (t.closed && pts.length > 2) legs.push([pts[pts.length - 1], pts[0]]);
        out.strokes.push({ lines: legs, color, width, dashed, arrow, exact: true });
    } else {
        const s: StrokePrim = { lines: [pts], color, width, dashed, exact: true };
        if (t.closed && pts.length > 2) s.closed = true;
        out.strokes.push(s);
    }
    if (str(t.label).trim()) {
        const line = t.closed && pts.length > 2 ? [...pts, pts[0]] : pts;
        const { p, dir } = midSpot(line);
        const d = normDir(dir.x, dir.y, ctx.view, { x: 1, y: 0 });
        out.texts.push({ x: p.x, y: p.y, template: 'label', color, size: 'normal', dir: { x: -d.y, y: d.x }, slide: line });
    }
    return out;
}

// --------------------------------------------------------------- 2D scene

/**
 * Compute the 2D scene.
 * - Tools are evaluated in dependency order (regionName, ref1/ref2, path
 *   entries naming points tools, and derived names like P1_x in any
 *   expression or template field); cycles become errors on each tool in the
 *   cycle. After each points tool, its derived values are published with
 *   math.setDerived so later tools (and the caller) can use them.
 * - Hidden tools are computed when referenced but produce no primitives;
 *   issues of hidden tools nothing reads carry `hiddenSource`.
 * - Function decorations: fill (region min(f,0) <= y <= max(f,0) over the
 *   effective domain), tangent (stroke + marker; tangentPoint may be a
 *   number, expression, or live keyword min / max / minN / maxN),
 *   extrema (markers + 'min' / 'max' texts anchored below / above).
 * - Region: fills (tint; the exporter adds the pattern pass), outline
 *   strokes along `boundary` runs, constraint lines across the view when
 *   `constraintLines` (skipping lines that coincide with the view border),
 *   condition labels at the visible end of each constraint line, label text
 *   (large, bold) centred at labelPoint with halo, or nearby inside the
 *   region when the label there would sit on the axes, a stroke or a label.
 * - Curve: computeContours of the equation for F = 0 or each level; label
 *   template (with {level}) near the end of the longest polyline, nudged
 *   inside the view.
 * - Points: candidates from the source, optional objective selection,
 *   markers, per-point label templates, drop lines to the axes (to y = 0 /
 *   x = 0 when axisStyle is 'middle' and 0 is in view, else the view edge).
 *   'outside' / 'unbounded' / 'empty' optimum statuses become info issues
 *   (outside and unbounded draw the best visible points dimmed); a region
 *   without points in the view is called infeasible only when it is.
 *   Intersections include points where the two curves only touch.
 * - Segment: polyline legs with arrows, or a brace for style 'brace'.
 * Never throws.
 *
 * Template fields (labels) are formatted after every tool has run, so they
 * always see final derived values and never take part in cycles. Then the
 * label placer picks each free label's spot (see layoutTexts), measuring
 * texts with `labelMetrics`: clear of every stroke, function curve, marker
 * and other label, and inside the plot frame, wherever such a spot exists.
 */
export function computeScene2D(input: SceneInput2D): Scene2D {
    try {
        return scene2D(input);
    } catch (e) {
        return {
            items: [],
            issues: [{ source: 'chart', message: `Could not compute the shapes: ${errorText(e)}`, severity: 'error' }],
            derived: {},
        };
    }
}

function scene2D(input: SceneInput2D): Scene2D {
    const math = input && input.math;
    const view = input && input.view;
    if (!math || !validView(view)) return { items: [], issues: [], derived: {} };
    const grid = sanitizeGrid(input.grid);
    const tools = (Array.isArray(input.tools) ? input.tools : []).filter((t): t is Tool => !!t && typeof t === 'object');
    const params = Array.isArray(input.functions) ? input.functions : [];
    const state = cacheState(input.cache || new SceneCache());
    if (state.math !== math) {
        state.math = math;
        state.memo.clear();
        state.curves.clear();
        state.labels.clear();
    }
    const axisStyle: AxisStyle = input.axisStyle || 'box';
    const ctx: Ctx = { math, view, grid, axisStyle, dim: 2, outputs: new Map(), toolsByName: toolMap(tools), functions: params };

    const nodes: SceneNode[] = [];
    for (const info of math.functions()) {
        const f = params[info.index];
        if (!f || info.hidden || info.kind !== 'cartesian') continue;
        if (!(f.fill || f.tangent || f.extrema)) continue;
        if (!str(f.expression).trim()) continue;
        nodes.push(functionNode(f, info, math));
    }
    for (const t of tools) {
        if (t.type === 'plane3D') continue;
        if ((t.type === 'points' || t.type === 'segment') && t.dim === 3) continue;
        nodes.push(toolNode(t, math));
    }

    forgetOnRemoval(state, new Set([...Array.from(ctx.toolsByName.keys()), ...math.functions().map((f) => f.name)]));
    const frameKey = `${view.xmin},${view.xmax},${view.ymin},${view.ymax}|${grid.nx}x${grid.ny}|${axisStyle}`;
    const seen = new Set<string>();
    const outs = runNodes(nodes, ctx, state, frameKey, (node) => compute2D(node, ctx), seen);
    prune(state, seen);

    const derived: Record<string, number> = {};
    for (const out of outs) Object.assign(derived, out.derived);
    math.setDerived(derived);

    // Items in list order; hidden tools were computed but draw nothing.
    const items: SceneItem2D[] = [];
    const itemSpecs: Array<{ item: SceneItem2D; node: SceneNode; out: Output }> = [];
    const issues: SceneIssue[] = [];
    const read = readNames(nodes, math);
    nodes.forEach((node, i) => {
        const out = outs[i];
        pushIssues(issues, out.issues, node, read);
        if (node.tool && node.tool.hidden) return;
        const item: SceneItem2D = {
            source: node.name,
            kind: node.fn ? 'function' : 'tool',
            key: node.fn ? String(node.fn.info.index) : str((node.tool as Tool).id),
            fills: out.fills,
            strokes: out.strokes,
            guides: out.guides,
            markers: out.markers,
            braces: [],
            texts: [],
        };
        // The memo's own array: a cached frame hands out the same handle objects.
        if (out.handles && out.handles.length) item.handles = out.handles;
        items.push(item);
        itemSpecs.push({ item, node, out });
    });

    // Texts last: final derived values, then sides (and region label spots)
    // chosen by the label placer, then halos over any drawn fill.
    const jobs: TextJob[] = [];
    // Only asked for when there is a text to place.
    let moving: Set<SceneNode> | null = null;
    for (const { item, node, out } of itemSpecs) {
        const formatter = labelFormatter(node, math, issues);
        for (const b of out.braces) item.braces.push({ from: b.from, to: b.to, color: b.color, label: formatter({ template: 'label' }) });
        const rank = labelRank(node);
        for (const [index, spec] of out.texts.entries()) {
            const text = formatter(spec);
            if (!text.trim()) continue;
            if (!moving) moving = movingNodes(nodes, math);
            jobs.push({
                key: `${node.id}#${index}`,
                item,
                spec,
                text,
                rank,
                order: jobs.length,
                moving: moving.has(node),
                region: spec.region && out.region ? out.region.result : null,
                x: spec.x,
                y: spec.y,
                anchor: spec.anchor || 'above right',
                w: 0,
                h: 0,
                em: 0,
                dir: 0,
                ring: 0,
                k: 0,
                base: 0,
                box: -1,
                own: -1,
                kept: false,
            });
        }
    }
    // The curves of the functions are obstacles too; sampled only when there is a label to place.
    const curves = jobs.length ? functionCurves(math, params, view, input.cache ? state : null) : [];
    const before = input.cache && input.keepLabels ? state.labels : null;
    layoutTexts(jobs, items, curves, view, axisStyle, validMetrics(input.labelMetrics), before);
    if (input.cache) {
        // Every frame remembers its spots: the first frame of a gesture starts from the settled picture.
        const spots = new Map<string, LabelSpot>();
        for (const job of jobs) if (job.scored) spots.set(job.key, { dir: job.dir, ring: job.ring, k: job.k });
        state.labels = spots;
    }
    const fills = items.reduce<Pt[][][]>((acc, it) => {
        for (const f of it.fills) acc.push(f.rings);
        return acc;
    }, []);
    for (const job of jobs) {
        const { spec } = job;
        const side = anchorDir(job.anchor);
        // The text body sits a little off the anchor point, on its side: test there.
        const body = {
            x: job.x + side.x * HALO_PROBE * (view.xmax - view.xmin),
            y: job.y + side.y * HALO_PROBE * (view.ymax - view.ymin),
        };
        const halo = !!spec.halo || fills.some((rings) => pointInRings(body, rings));
        const prim: TextPrim = { x: job.x, y: job.y, text: job.text, color: spec.color, anchor: job.anchor, size: spec.size, halo };
        if (spec.weight) prim.weight = spec.weight;
        if (job.offset) prim.offset = job.offset;
        job.item.texts.push(prim);
    }
    return { items, issues, derived };
}

/** Names of the tools some node or function body reads. */
function readNames(nodes: SceneNode[], math: MathContext): Set<string> {
    const read = new Set<string>();
    for (const n of nodes) for (const r of n.refs) read.add(r.name);
    // Function bodies that are not nodes (no decorations) still read tools: f1 = P2_y + x.
    for (const info of math.functions()) for (const name of math.deps(info.name).tools) read.add(name);
    return read;
}

/**
 * Report a node's issues. Those of a hidden tool that nothing reads are
 * tagged `hiddenSource` (e.g. 3.x tools that drew nothing and were hidden by
 * the migration): hosts keep them on the tool's card but out of the chart's
 * problem line. A hidden tool that is read keeps plain issues, because its
 * error is then the root cause of what its readers show.
 */
function pushIssues(into: SceneIssue[], issues: SceneIssue[], node: SceneNode, read: Set<string>): void {
    const quiet = !!node.tool && node.tool.hidden === true && !read.has(node.name);
    for (const issue of issues) into.push(quiet ? { ...issue, hiddenSource: true } : issue);
}

function compute2D(node: SceneNode, ctx: Ctx): Output {
    if (node.fn) return computeDecorations(node.fn.params, node.fn.info, ctx);
    const t = node.tool as Tool;
    switch (t.type) {
        case 'region':
            return computeRegionTool(t, ctx);
        case 'curve':
            return computeCurveTool(t, ctx);
        case 'points':
            return computePointsTool(t, ctx);
        case 'segment':
            return computeSegmentTool(t, ctx);
        default:
            return newOutput();
    }
}

function toolMap(tools: Tool[]): Map<string, Tool> {
    const m = new Map<string, Tool>();
    for (const t of tools) {
        const name = str(t.name);
        if (name && !m.has(name)) m.set(name, t);
    }
    return m;
}

function anchorDir(anchor: Anchor): Pt {
    const a = ANCHOR_DIRS.find((d) => d.anchor === anchor);
    return a ? { x: a.x, y: a.y } : { x: 0, y: 0 };
}

// ------------------------------------------------------------ label layout

/**
 * Text box model, in em: the advance of a glyph by class (digits, narrow
 * punctuation, brackets, wide letters, capitals; CHAR_EM for the rest and
 * for tick labels), the height of a line of text (ascender to descender,
 * a little more than the ink), and the extra width of bold text. Close to
 * both the preview's text font and the PDF's Computer Modern.
 */
const CHAR_EM = 0.56;
const DIGIT_EM = 0.6;
const NARROW_EM = 0.3;
const BRACKET_EM = 0.38;
const WIDE_EM = 0.85;
const CAPITAL_EM = 0.68;
const LINE_EM = 1.1;
const BOLD_WIDTH = 1.08;
/**
 * Where a text starts relative to its anchor point, per side, in pt (x right,
 * y up): the gap the preview draws, about the inner sep of the exported node.
 * The preview reads this table, so the placer measures what is drawn.
 */
export const TEXT_GAP_PT: Record<TextAnchor, Pt> = {
    center: { x: 0, y: 0 },
    above: { x: 0, y: 3 },
    below: { x: 0, y: -3 },
    left: { x: -4.5, y: 0 },
    right: { x: 4.5, y: 0 },
    'above right': { x: 3.75, y: 3 },
    'below left': { x: -3.75, y: -3 },
    'above left': { x: -3.75, y: 3 },
    'below right': { x: 3.75, y: -3 },
};
/**
 * Outer rings of label spots: per ring the text moves one line further out
 * (straight for the four sides; up or down and a little outwards for the
 * diagonals, so it clears a label on the ring before on the same side).
 * RINGS counts them, the ring right beside the point included.
 */
const FAR_EM = 1.25;
const FAR_DIAGONAL_EM = 0.5;
const RINGS = 3;
/**
 * Strokes, markers and labels that only touch the edge of a box (within this
 * many em: a hair, against rounding) do not count as crossing it. The box
 * is no larger than the text needs: where the text begins, ink reaches its edge.
 */
const GRAZE_EM = 0.01;
/**
 * A stroke that passes a box closer than NEAR_EM (em) without crossing it
 * brushes the text, and so does a label closer than NEAR_LABEL_EM (less
 * than the gap between two labels that stand as two lines): spots to avoid
 * when another is as good. The line a label belongs to never brushes it.
 */
const NEAR_EM = 0.15;
const NEAR_LABEL_EM = 0.1;
/** A label keeps this far (em) inside the plot frame. */
const FRAME_EM = 0.25;
/** Marker radii in pt, as exported. */
const MARKER_PT: Record<MarkerSize, number> = { small: 1.5, normal: 2, large: 2.8 };
/** Tick labels next to centred axes: tick length plus label sep, and the widest label in characters. */
const TICK_PT = 3;
const TICK_CHARS = 3;
/**
 * Placement costs, in two classes.
 *
 * Hits (LabelLayout.cost): a box that leaves the plot frame (COST_FRAME,
 * up to twice as much by the share outside), a box on a label placed
 * before (COST_LABEL, up to twice by the share covered), a stroke through
 * the box (COST_STROKE for a clipped corner, up to twice for a line through
 * its whole length), a marker under it, and the share on a tick-label band.
 *
 * Preferences (the `base` of a spot): the side (COST_SIDE for the side
 * opposite to the one the label likes; half as much for the label of a
 * line, which reads as well from either side of it), each ring further out
 * (COST_FAR, more than the side, so a nearer ring wins), each step slid
 * along a line (COST_SLIDE: all SLIDE_STEPS together cost less than a ring,
 * and the other side of the line costs as much as a slide of half that
 * length, so a line label first changes sides, then moves along its line,
 * and leaves it last), a spot on the side a label of the
 * same point already took (COST_SAME_SIDE: a corner that is also the
 * optimum gets its two labels on different sides, or else as two lines),
 * a spot that a stroke separates from its point or line (COST_SEPARATED:
 * the text then reads as the label of something else), and a stroke or
 * a label that brushes the box without touching it (COST_NEAR each, at
 * most two count: LabelLayout.near).
 *
 * All preferences together stay below one COST_STROKE, so a spot with no
 * hit always wins over a spot with one, and among spots with hits the one
 * with the least overlap wins. The tick-label band is the one soft hit: it
 * runs along the whole axis while tick labels stand only here and there,
 * so a box pays for the share of it that lies on the band and no more.
 */
const COST_FRAME = 48;
const COST_LABEL = 32;
const COST_STROKE = 8;
const COST_MARKER = 8;
const COST_BAND = 8;
const COST_SIDE = 1;
const COST_SIDE_LINE = 0.5;
const COST_SAME_SIDE = 1;
const COST_SEPARATED = 1.5;
const COST_FAR = 1.2;
const COST_SLIDE = 0.06;
const COST_NEAR = 0.6;
/**
 * A text may sit a quarter of its width back over its point (between
 * 'above' and 'above right', say): often the one spot beside a point that
 * clears a line through it. NUDGE_COST makes the plain sides win ties.
 */
const NUDGE = 0.25;
const NUDGE_COST = 0.05;
/** The first pt of the way from a point to its label do not count as separating them: lines through the point itself start there. */
const SEPARATED_SKIP_PT = 2;

/**
 * Candidate spots of a free label on one ring, in tie-break order: the
 * eight sides (ANCHOR_DIRS), then the four diagonals nudged back over the
 * point. `side` is the index into ANCHOR_DIRS of the text anchor, (x, y)
 * the direction the spot lies in (for the side preference), `nudge` the
 * share of the text width the box moves along x.
 */
const SPOTS: Array<{ side: number; x: number; y: number; nudge: number }> = [
    ...ANCHOR_DIRS.map((d, side) => ({ side, x: d.x, y: d.y, nudge: 0 })),
    ...ANCHOR_DIRS.map((d, side) => ({ side, x: d.x, y: d.y, nudge: 0 }))
        .filter((d) => d.x !== 0 && d.y !== 0)
        .map((d) => {
            // Halfway between the diagonal and straight above / below.
            const len = Math.hypot(d.x / 2, d.y);
            return { side: d.side, x: d.x / 2 / len, y: d.y / len, nudge: d.x > 0 ? -NUDGE : NUDGE };
        }),
];

/** Steps a line label may slide to either side, and a re-placed label moves only for a gain above SWEEP_GAIN. */
const SLIDE_STEPS = 16;
const SWEEP_GAIN = 0.05;
/** A region label may move this many text heights off its labelPoint. */
const REGION_STEPS = [1, 1.5, 2, 2.5, 3];
/** Buckets per axis of the obstacle index. */
const BUCKETS = 16;
/** Samples per function for the obstacle polylines of its curve (the preview draws 500). */
const OBSTACLE_SAMPLES = 128;

const DEFAULT_METRICS = labelMetricsFor(10, 10);

/** One text to place: its spec, final text and (after layoutTexts) its spot and side. */
interface TextJob {
    /** Node id and index of the text in the node's output: the same label in the next frame. */
    key: string;
    item: SceneItem2D;
    spec: TextSpec;
    text: string;
    /** Placement order class (labelRank); ties keep list order. */
    rank: number;
    order: number;
    /** The item's shapes follow a slider (movingNodes): placed after the labels of everything that stands still. */
    moving: boolean;
    /** The region a region label belongs to. */
    region: RegionResult | null;
    x: number;
    y: number;
    anchor: Anchor;
    /** Shift of the text off the plain spot beside its point (outer ring, nudge), in pt. */
    offset?: Pt;
    /** Text size in pt (set by LabelLayout.measure). */
    w: number;
    h: number;
    em: number;
    /** The spot chosen for a free label: index into SPOTS, ring, steps slid along its line, and its cost without obstacles. */
    dir: number;
    ring: number;
    k: number;
    base: number;
    /** Id of the placed box, -1 while not placed. */
    box: number;
    /** The stroke the label belongs to (its slide line as an obstacle), -1 without one. */
    own: number;
    /** The spot was scored by the placer (a free label below SCORED_MAX). */
    scored?: boolean;
    /** The label stays on the spot of the previous frame (SceneInput2D.keepLabels). */
    kept: boolean;
    /** The slide line in plot pt, built on first use; null without one. */
    track?: Track | null;
}

/** Axis-aligned box in plot pt (origin bottom-left, y up). */
interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

/** A candidate spot of a free label. */
interface Choice {
    /** Anchor point in plot pt. */
    X: number;
    Y: number;
    /** Index into SPOTS, the ring, and the steps slid along the label's line (0: its own place). */
    dir: number;
    ring: number;
    k: number;
    /** Preference cost that belongs to the spot itself (side, ring, slide, nudge). */
    base: number;
    /** Obstacle cost (LabelLayout.cost): 0 for a clear spot. */
    hit: number;
    /** Everything: preferences plus hits. */
    cost: number;
}

/** A polyline in plot pt with the arc length up to each vertex, for sliding a label along it. */
interface Track {
    xs: number[];
    ys: number[];
    acc: number[];
    /** Arc length of the label's own spot. */
    s0: number;
}

function validMetrics(m: LabelMetrics | undefined): LabelMetrics {
    const ok = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (!m || !ok(m.w) || !ok(m.h) || !m.em || !ok(m.em.small) || !ok(m.em.normal) || !ok(m.em.large)) return DEFAULT_METRICS;
    return m;
}

/**
 * The nodes whose shapes follow a slider: a source of theirs reads a
 * parameter (directly, through a function, or through the computed values of
 * a tool that does). Their labels are placed after those of everything that
 * stands still, so while a slider moves only the labels of what moves look
 * for a new spot, and a standing label moves only when a line reaches it.
 */
function movingNodes(nodes: SceneNode[], math: MathContext): Set<SceneNode> {
    const byName = new Map<string, SceneNode>();
    for (const n of nodes) if (n.tool && !byName.has(n.name)) byName.set(n.name, n);
    const state = new Map<SceneNode, boolean>();
    const visit = (n: SceneNode): boolean => {
        const known = state.get(n);
        if (known !== undefined) return known;
        // A node on a cycle is not computed: it stands still.
        state.set(n, false);
        let moves = n.sources.some((src) => math.deps(src).params.length > 0);
        if (!moves) {
            for (const r of n.refs) {
                const producer = byName.get(r.name);
                if (producer && producer !== n && visit(producer)) {
                    moves = true;
                    break;
                }
            }
        }
        state.set(n, moves);
        return moves;
    };
    const out = new Set<SceneNode>();
    for (const n of nodes) if (visit(n)) out.add(n);
    return out;
}

/**
 * Who places first: labels of an optimum (points tool with an objective),
 * then other point labels (min / max of a function among them), curve
 * labels, condition labels, segment labels. Fixed sides and region labels
 * go before all of them.
 */
function labelRank(node: SceneNode): number {
    const t = node.tool;
    if (!t) return 1;
    if (t.type === 'points') return str(t.objective).trim() ? 0 : 1;
    if (t.type === 'curve') return 2;
    if (t.type === 'region') return 3;
    return 4;
}

/**
 * Width of a label in em, roughly as it renders: math delimiters and braces
 * dropped, a command counts as one glyph, every other character by its class.
 */
function plainWidth(text: string): number {
    const t = text
        .replace(/\\[()]/g, '')
        .replace(/\$/g, '')
        .replace(/\\[a-zA-Z]+\s*/g, 'x')
        .replace(/\\./g, 'x')
        .replace(/[{}^_]/g, '');
    let w = 0;
    for (let i = 0; i < t.length; i++) {
        const c = t.charCodeAt(i);
        if (c >= 48 && c <= 57) w += DIGIT_EM;
        else if (c === 32 || c === 46 || c === 44 || c === 58 || c === 59 || c === 39 || c === 33 || c === 124 || c === 105 || c === 106 || c === 108) w += NARROW_EM;
        else if (c === 40 || c === 41 || c === 91 || c === 93 || c === 45 || c === 42 || c === 47 || c === 102 || c === 116 || c === 114) w += BRACKET_EM;
        else if (c === 109 || c === 119 || c === 77 || c === 87) w += WIDE_EM;
        else if (c >= 65 && c <= 90) w += CAPITAL_EM;
        else w += CHAR_EM;
    }
    return Math.max(NARROW_EM, w);
}

/** Width and height of a label text in pt, as the placer measures it. */
function textSize(text: string, size: AnnotationSize, weight: TextPrim['weight'], m: LabelMetrics): { w: number; h: number; em: number } {
    const em = m.em[size] || m.em.normal;
    return { w: plainWidth(text) * em * (weight === 'bold' ? BOLD_WIDTH : 1), h: LINE_EM * em, em };
}

/** Shift in pt of a text on ring `ring` (1 or more) of side `anchor`. */
function farOffset(anchor: Anchor, em: number, ring: number): Pt {
    const g = TEXT_GAP_PT[anchor] || TEXT_GAP_PT.center;
    const sx = Math.sign(g.x);
    const sy = Math.sign(g.y);
    if (sx !== 0 && sy !== 0) return { x: sx * FAR_DIAGONAL_EM * em * ring, y: sy * FAR_EM * em * ring };
    return { x: sx * FAR_EM * em * ring, y: sy * FAR_EM * em * ring };
}

/** Box of a w x h text on side `anchor` of the plot point (X, Y), shifted by (ox, oy) pt. */
function boxAt(anchor: Anchor, X: number, Y: number, w: number, h: number, ox: number, oy: number): Box {
    const g = TEXT_GAP_PT[anchor] || TEXT_GAP_PT.center;
    const px = X + g.x + ox;
    const py = Y + g.y + oy;
    const x0 = g.x > 0 ? px : g.x < 0 ? px - w : px - w / 2;
    const y0 = g.y > 0 ? py : g.y < 0 ? py - h : py - h / 2;
    return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/**
 * The box of a scene text in pt of the plot area (origin bottom-left, y up),
 * as the label placer measures it: as wide as its characters by class, one
 * line high, beside its anchor point as the preview draws it (TEXT_GAP_PT
 * plus the text's own `offset`). For checks and tests.
 */
export function textBoxPt(
    t: Pick<TextPrim, 'x' | 'y' | 'text' | 'anchor' | 'size' | 'weight' | 'offset'>,
    view: View,
    metrics: LabelMetrics
): { x0: number; y0: number; x1: number; y1: number } {
    const m = validMetrics(metrics);
    const { w, h } = textSize(t.text, t.size, t.weight, m);
    const X = ((t.x - view.xmin) / (view.xmax - view.xmin)) * m.w;
    const Y = ((t.y - view.ymin) / (view.ymax - view.ymin)) * m.h;
    return boxAt(t.anchor, X, Y, w, h, t.offset ? t.offset.x : 0, t.offset ? t.offset.y : 0);
}

function overlapArea(a: Box, b: Box): number {
    const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return w > 0 && h > 0 ? w * h : 0;
}

/** Liang-Barsky: length of the part of segment a-b inside the box, -1 when it misses the box. */
function clippedLength(ax: number, ay: number, bx: number, by: number, r: Box): number {
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    for (let i = 0; i < 4; i++) {
        const p = i === 0 ? -dx : i === 1 ? dx : i === 2 ? -dy : dy;
        const q = i === 0 ? ax - r.x0 : i === 1 ? r.x1 - ax : i === 2 ? ay - r.y0 : r.y1 - ay;
        if (p === 0) {
            if (q < 0) return -1;
            continue;
        }
        const t = q / p;
        if (p < 0) {
            if (t > t1) return -1;
            if (t > t0) t0 = t;
        } else {
            if (t < t0) return -1;
            if (t < t1) t1 = t;
        }
    }
    return (t1 - t0) * Math.hypot(dx, dy);
}

/** True when segments a-b and c-d cross in a single point inside both. */
function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
    const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) return false;
    const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    if ((d3 > 0 && d4 > 0) || (d3 < 0 && d4 < 0)) return false;
    return d1 !== d2 && d3 !== d4;
}

/** Uniform grid of buckets over the plot, for nearby-obstacle queries; ids are reported once per query. */
class Buckets {
    private cells: number[][] = [];
    private seen: number[] = [];
    private mark = 0;
    private w: number;
    private h: number;

    constructor(w: number, h: number) {
        this.w = w;
        this.h = h;
        for (let i = 0; i < BUCKETS * BUCKETS; i++) this.cells.push([]);
    }

    private cell(v: number, size: number): number {
        return Math.max(0, Math.min(BUCKETS - 1, Math.floor((v / size) * BUCKETS)));
    }

    add(id: number, x0: number, y0: number, x1: number, y1: number): void {
        if (!finite(x0) || !finite(x1) || !finite(y0) || !finite(y1)) return;
        const i0 = this.cell(x0, this.w);
        const i1 = this.cell(x1, this.w);
        const j0 = this.cell(y0, this.h);
        const j1 = this.cell(y1, this.h);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * BUCKETS + i].push(id);
    }

    /** Writes the ids of the entries near box b into `out` and returns how many. */
    query(b: Box, out: number[]): number {
        const i0 = this.cell(b.x0, this.w);
        const i1 = this.cell(b.x1, this.w);
        const j0 = this.cell(b.y0, this.h);
        const j1 = this.cell(b.y1, this.h);
        const mark = ++this.mark;
        const seen = this.seen;
        let n = 0;
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const cell = this.cells[j * BUCKETS + i];
                for (let k = 0; k < cell.length; k++) {
                    const id = cell[k];
                    if (seen[id] === mark) continue;
                    seen[id] = mark;
                    out[n++] = id;
                }
            }
        }
        return n;
    }
}

/**
 * Preference cost of spot `spot` (index into SPOTS) on ring `ring`, `k`
 * steps along the label's line, for a label that prefers direction `pref`.
 * `side` is what the side opposite to `pref` costs: COST_SIDE for the
 * label of a point, COST_SIDE_LINE for the label of a line.
 */
function spotBase(spot: number, ring: number, k: number, pref: Pt, side: number): number {
    const d = SPOTS[spot];
    return COST_FAR * ring + COST_SLIDE * Math.abs(k) + 0.5 * side * (1 - (d.x * pref.x + d.y * pref.y)) + (d.nudge ? NUDGE_COST : 0);
}

/**
 * Obstacles of one frame in plot pt: drawn strokes and guides, the curves
 * of the functions, markers, axes through the origin with their tick-label
 * bands, the plot frame, and the boxes of labels placed so far.
 */
class LabelLayout {
    private view: View;
    private m: LabelMetrics;
    /** Segments as ax, ay, bx, by and the id of the stroke (one polyline) they belong to. */
    private segs: number[] = [];
    private segIndex: Buckets;
    private strokes = 0;
    /** Stroke id of each polyline, by the array itself: a label finds the line it belongs to (TextSpec.slide). */
    private strokeOf = new Map<Pt[], number>();
    /** Per stroke: the query that last hit it and the length inside that query's box. */
    private hitMark: number[] = [];
    private hitLen: number[] = [];
    private hitList: number[] = [];
    private query = 0;
    private marks: number[] = [];
    private markIndex: Buckets;
    /** Placed label boxes; null once removed (re-placed by the refinement sweeps). */
    private boxes: Array<Box | null> = [];
    private boxIndex: Buckets;
    /** Tick-label bands (and the axis line) of centred axes. */
    private bands: Box[] = [];
    /** Sides taken at each anchor point (key: the point in half pt), as indices into ANCHOR_DIRS. */
    private sides = new Map<number, number[]>();
    private ids: number[] = [];
    /** Set by cost(): the preference cost of the strokes that brush the box it was asked about. */
    near = 0;
    /** More labels than the refinement sweeps take (REFINE_MAX): each one only tries the spots right beside its point. */
    dense = false;

    constructor(view: View, m: LabelMetrics, axisStyle: AxisStyle, items: SceneItem2D[], curves: Pt[][]) {
        this.view = view;
        this.m = m;
        this.segIndex = new Buckets(m.w, m.h);
        this.markIndex = new Buckets(m.w, m.h);
        this.boxIndex = new Buckets(m.w, m.h);
        for (const it of items) {
            for (const s of it.strokes) for (const line of s.lines) this.addLine(line, !!s.closed);
            for (const s of it.guides) for (const line of s.lines) this.addLine(line, !!s.closed);
            for (const b of it.braces) this.addLine([b.from, b.to], false);
            for (const mk of it.markers) this.addMarker(mk);
        }
        for (const line of curves) this.addLine(line, false);
        if (axisStyle === 'middle') this.addAxes();
    }

    X(x: number): number {
        return ((x - this.view.xmin) / (this.view.xmax - this.view.xmin)) * this.m.w;
    }

    Y(y: number): number {
        return ((y - this.view.ymin) / (this.view.ymax - this.view.ymin)) * this.m.h;
    }

    toMath(X: number, Y: number): Pt {
        const v = this.view;
        return { x: v.xmin + (X / this.m.w) * (v.xmax - v.xmin), y: v.ymin + (Y / this.m.h) * (v.ymax - v.ymin) };
    }

    /** One polyline as one stroke: a label it crosses counts it once, however many segments run through. */
    private addLine(line: Pt[], closed: boolean): void {
        if (!line || line.length < 2) return;
        const id = this.strokes++;
        this.strokeOf.set(line, id);
        for (let i = 1; i < line.length; i++) this.addSegment(line[i - 1], line[i], id);
        if (closed && line.length > 2) this.addSegment(line[line.length - 1], line[0], id);
    }

    private addSegment(a: Pt, b: Pt, stroke: number): void {
        const ax = this.X(a.x);
        const ay = this.Y(a.y);
        const bx = this.X(b.x);
        const by = this.Y(b.y);
        if (!finite(ax) || !finite(ay) || !finite(bx) || !finite(by)) return;
        const id = this.segs.length / 5;
        this.segs.push(ax, ay, bx, by, stroke);
        this.segIndex.add(id, Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
    }

    private addMarker(mk: MarkerPrim): void {
        const x = this.X(mk.x);
        const y = this.Y(mk.y);
        const r = MARKER_PT[mk.size] || MARKER_PT.normal;
        if (!finite(x) || !finite(y)) return;
        const id = this.marks.length / 3;
        this.marks.push(x, y, r);
        this.markIndex.add(id, x - r, y - r, x + r, y + r);
    }

    /** Centred axes (when 0 is inside the view): the axis lines plus the tick labels below / left of them. */
    private addAxes(): void {
        const { view, m } = this;
        const em = m.em.normal;
        // The axis line itself plus a label gap on its other side.
        const above = TEXT_GAP_PT.above.y;
        if (view.ymin < 0 && view.ymax > 0) {
            const y0 = this.Y(0);
            this.addLine([{ x: view.xmin, y: 0 }, { x: view.xmax, y: 0 }], false);
            this.bands.push({ x0: 0, x1: m.w, y0: y0 - TICK_PT - LINE_EM * em, y1: y0 + above });
        }
        if (view.xmin < 0 && view.xmax > 0) {
            const x0 = this.X(0);
            this.addLine([{ x: 0, y: view.ymin }, { x: 0, y: view.ymax }], false);
            this.bands.push({ x0: x0 - TICK_PT - TICK_CHARS * CHAR_EM * em, x1: x0 + above, y0: 0, y1: m.h });
        }
    }

    /** Sets the job's text size in pt, and the stroke it belongs to. */
    measure(job: TextJob): void {
        const s = textSize(job.text, job.spec.size, job.spec.weight, this.m);
        job.w = s.w;
        job.h = s.h;
        job.em = s.em;
        const own = job.spec.slide ? this.strokeOf.get(job.spec.slide) : undefined;
        job.own = own === undefined ? -1 : own;
    }

    /** Shift in pt of the job's text on spot `spot` of ring `ring`: the outer ring's distance plus the nudge. */
    private shift(job: TextJob, spot: number, ring: number): Pt {
        const sp = SPOTS[spot];
        const o = ring ? farOffset(ANCHOR_DIRS[sp.side].anchor, job.em, ring) : { x: 0, y: 0 };
        o.x += sp.nudge * job.w;
        return o;
    }

    /** The job's text box on spot `spot` (index into SPOTS) of the plot point (X, Y), on ring `ring` (0: right beside the point). */
    private spotBox(job: TextJob, spot: number, X: number, Y: number, ring: number): Box {
        const o = this.shift(job, spot, ring);
        return boxAt(ANCHOR_DIRS[SPOTS[spot].side].anchor, X, Y, job.w, job.h, o.x, o.y);
    }

    /**
     * True when a stroke runs between the plot point (X, Y) and box b, on
     * the way to the middle of the box; strokes through the point itself do
     * not count.
     */
    private separated(X: number, Y: number, b: Box): boolean {
        const qx = (b.x0 + b.x1) / 2;
        const qy = (b.y0 + b.y1) / 2;
        const len = Math.hypot(qx - X, qy - Y);
        if (len <= SEPARATED_SKIP_PT) return false;
        const t = SEPARATED_SKIP_PT / len;
        const px = X + (qx - X) * t;
        const py = Y + (qy - Y) * t;
        const way: Box = { x0: Math.min(px, qx), y0: Math.min(py, qy), x1: Math.max(px, qx), y1: Math.max(py, qy) };
        const segs = this.segs;
        const ids = this.ids;
        const n = this.segIndex.query(way, ids);
        for (let i = 0; i < n; i++) {
            const k = 5 * ids[i];
            if (segmentsCross(px, py, qx, qy, segs[k], segs[k + 1], segs[k + 2], segs[k + 3])) return true;
        }
        return false;
    }

    /** Add a label box as an obstacle; returns its id. */
    place(b: Box): number {
        const id = this.boxes.length;
        this.boxIndex.add(id, b.x0, b.y0, b.x1, b.y1);
        this.boxes.push(b);
        return id;
    }

    remove(id: number): void {
        if (id >= 0) this.boxes[id] = null;
    }

    /**
     * Cost of drawing a text in box b (preferences excluded): 0 when the box
     * lies inside the frame and nothing crosses it. `bands` false skips the
     * tick-label bands. Also sets `near`, the preference cost of the
     * strokes and labels that brush the box without touching it; the stroke
     * `own`, the line the label belongs to, is not one of them.
     */
    cost(b: Box, em: number, bands = true, own = -1): number {
        const full = Math.max(1e-9, (b.x1 - b.x0) * (b.y1 - b.y0));
        let c = 0;
        // The plot frame: fully inside, with a margin.
        const f = FRAME_EM * em;
        const fx1 = this.m.w - f;
        const fy1 = this.m.h - f;
        if (b.x0 < f || b.y0 < f || b.x1 > fx1 || b.y1 > fy1) {
            const w = Math.max(0, Math.min(b.x1, fx1) - Math.max(b.x0, f));
            const h = Math.max(0, Math.min(b.y1, fy1) - Math.max(b.y0, f));
            c += COST_FRAME * (2 - (w * h) / full);
        }
        const g = Math.min(GRAZE_EM * em, 0.25 * (b.x1 - b.x0), 0.25 * (b.y1 - b.y0));
        const inner: Box = { x0: b.x0 + g, y0: b.y0 + g, x1: b.x1 - g, y1: b.y1 - g };
        const area = Math.max(1e-9, (inner.x1 - inner.x0) * (inner.y1 - inner.y0));
        const ids = this.ids;
        let brushing = 0;
        // Labels placed before.
        const gap = NEAR_LABEL_EM * em;
        const around: Box = { x0: b.x0 - gap, y0: b.y0 - gap, x1: b.x1 + gap, y1: b.y1 + gap };
        let n = this.boxIndex.query(around, ids);
        for (let i = 0; i < n; i++) {
            const other = this.boxes[ids[i]];
            if (!other) continue;
            const a = overlapArea(inner, other);
            if (a > 0) c += COST_LABEL * (1 + a / area);
            else if (overlapArea(around, other) > 0) brushing++;
        }
        // Strokes: once per polyline, by the length that runs through the box. A polyline that only
        // comes close (inside the box widened by NEAR_EM) is remembered with the length -1.
        const segs = this.segs;
        const q = ++this.query;
        const hits = this.hitList;
        const pad = NEAR_EM * em;
        const outer: Box = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
        let nh = 0;
        n = this.segIndex.query(outer, ids);
        for (let i = 0; i < n; i++) {
            const k = 5 * ids[i];
            const s = segs[k + 4];
            const len = clippedLength(segs[k], segs[k + 1], segs[k + 2], segs[k + 3], inner);
            if (len < 0) {
                if (s !== own && this.hitMark[s] !== q && clippedLength(segs[k], segs[k + 1], segs[k + 2], segs[k + 3], outer) >= 0) {
                    this.hitMark[s] = q;
                    this.hitLen[s] = -1;
                    hits[nh++] = s;
                }
                continue;
            }
            if (this.hitMark[s] !== q) {
                this.hitMark[s] = q;
                this.hitLen[s] = 0;
                hits[nh++] = s;
            } else if (this.hitLen[s] < 0) this.hitLen[s] = 0;
            this.hitLen[s] += len;
        }
        if (nh) {
            const diag = Math.hypot(inner.x1 - inner.x0, inner.y1 - inner.y0);
            for (let i = 0; i < nh; i++) {
                const len = this.hitLen[hits[i]];
                if (len < 0) brushing++;
                else c += COST_STROKE * (1 + Math.min(1, len / diag));
            }
        }
        this.near = COST_NEAR * Math.min(2, brushing);
        // Markers.
        const marks = this.marks;
        n = this.markIndex.query(inner, ids);
        for (let i = 0; i < n; i++) {
            const k = 3 * ids[i];
            const dx = Math.max(inner.x0 - marks[k], 0, marks[k] - inner.x1);
            const dy = Math.max(inner.y0 - marks[k + 1], 0, marks[k + 1] - inner.y1);
            if (dx * dx + dy * dy < marks[k + 2] * marks[k + 2]) c += COST_MARKER;
        }
        if (bands) for (const band of this.bands) c += (COST_BAND * overlapArea(b, band)) / full;
        return c;
    }

    private sideKey(X: number, Y: number): number {
        return Math.round(X * 2) * 100003 + Math.round(Y * 2);
    }

    /** Bit set of the sides labels placed so far take at the plot point (X, Y). */
    private taken(X: number, Y: number): number {
        const list = this.sides.get(this.sideKey(X, Y));
        let bits = 0;
        if (list) for (const d of list) bits |= 1 << d;
        return bits;
    }

    /** The spots of (X, Y) on one ring (SPOTS): the cheapest one replaces `best` when it costs less. */
    private ring(job: TextJob, X: number, Y: number, pref: Pt, ring: number, k: number, best: Choice): void {
        const taken = this.taken(X, Y);
        for (let spot = 0; spot < SPOTS.length; spot++) {
            const base = spotBase(spot, ring, k, pref, job.spec.slide ? COST_SIDE_LINE : COST_SIDE);
            const start = base + (taken & (1 << SPOTS[spot].side) ? COST_SAME_SIDE : 0);
            // Obstacles only add cost: a spot that starts above the best one cannot win.
            if (start >= best.cost - 1e-9) continue;
            const b = this.spotBox(job, spot, X, Y, ring);
            const hit = this.cost(b, job.em, true, job.own);
            let c = start + hit + this.near;
            if (c < best.cost && this.separated(X, Y, b)) c += COST_SEPARATED;
            if (c < best.cost - 1e-9) {
                best.cost = c;
                best.hit = hit;
                best.X = X;
                best.Y = Y;
                best.dir = spot;
                best.ring = ring;
                best.k = k;
                best.base = base;
            }
        }
    }

    /** The slide polyline of a job in plot pt, with the arc length of the job's own spot on it. */
    private track(line: Pt[], X0: number, Y0: number): Track | null {
        const xs: number[] = [];
        const ys: number[] = [];
        const acc: number[] = [];
        for (const p of line) {
            const X = this.X(p.x);
            const Y = this.Y(p.y);
            if (!finite(X) || !finite(Y)) continue;
            const n = xs.length;
            if (n && X === xs[n - 1] && Y === ys[n - 1]) continue;
            acc.push(n ? acc[n - 1] + Math.hypot(X - xs[n - 1], Y - ys[n - 1]) : 0);
            xs.push(X);
            ys.push(Y);
        }
        if (xs.length < 2) return null;
        let s0 = 0;
        let bestD = Infinity;
        for (let i = 1; i < xs.length; i++) {
            const dx = xs[i] - xs[i - 1];
            const dy = ys[i] - ys[i - 1];
            const len2 = dx * dx + dy * dy;
            const t = Math.max(0, Math.min(1, ((X0 - xs[i - 1]) * dx + (Y0 - ys[i - 1]) * dy) / len2));
            const d = Math.hypot(xs[i - 1] + t * dx - X0, ys[i - 1] + t * dy - Y0);
            if (d < bestD - 1e-9) {
                bestD = d;
                s0 = acc[i - 1] + t * Math.sqrt(len2);
            }
        }
        return { xs, ys, acc, s0 };
    }

    /** The job's slide line in plot pt (built once per frame); null when it has none. */
    private trackOf(job: TextJob): Track | null {
        if (job.track === undefined) job.track = job.spec.slide ? this.track(job.spec.slide, this.X(job.spec.x), this.Y(job.spec.y)) : null;
        return job.track;
    }

    /**
     * The plot point `k` steps along the job's line from its own spot (a
     * step is a little more than half the text), with the side of the line
     * the label prefers there. Null when the line ends before, or the point
     * lies in the border inset the label's own spot keeps out of.
     */
    private slid(job: TextJob, track: Track, k: number, pref: Pt): { X: number; Y: number; pref: Pt } | null {
        const { xs, ys, acc } = track;
        const { w, h } = this.m;
        const s = track.s0 + k * Math.max(0.6 * job.w, 1.5 * job.em);
        if (s < 0 || s > acc[acc.length - 1]) return null;
        let i = 1;
        while (i < acc.length - 1 && acc[i] < s) i++;
        const span = acc[i] - acc[i - 1];
        const t = span > 0 ? (s - acc[i - 1]) / span : 0;
        const tx = xs[i] - xs[i - 1];
        const ty = ys[i] - ys[i - 1];
        const X = xs[i - 1] + t * tx;
        const Y = ys[i - 1] + t * ty;
        if (X < LABEL_INSET * w || X > (1 - LABEL_INSET) * w || Y < LABEL_INSET * h || Y > (1 - LABEL_INSET) * h) return null;
        // The normal of the line here, on the label's side of it (in pt, where the text sides are measured).
        let nx = -ty;
        let ny = tx;
        if (nx * pref.x * w + ny * pref.y * h < 0) {
            nx = -nx;
            ny = -ny;
        }
        const len = Math.hypot(nx, ny);
        return { X, Y, pref: len > 0 ? { x: nx / len, y: ny / len } : pref };
    }

    /**
     * Slide a line label along its line: one step after the other to both
     * sides of its own spot, nearest first, for as long as a step alone
     * costs less than the best spot so far. So the label stops at the
     * nearest clear place, and goes a little further only when a stroke
     * brushes it there or runs between it and its line.
     */
    private slide(job: TextJob, pref: Pt, best: Choice): void {
        const track = this.trackOf(job);
        if (!track) return;
        for (let k = 1; k <= SLIDE_STEPS; k++) {
            if (COST_SLIDE * k >= best.cost - 1e-9) return;
            for (let side = 0; side < 2; side++) {
                const p = this.slid(job, track, side ? -k : k, pref);
                if (p) this.ring(job, p.X, p.Y, p.pref, 0, side ? -k : k, best);
            }
        }
    }

    /**
     * The spot a label had in the previous frame, scored against this
     * frame; null when it no longer exists (the line got shorter).
     */
    revisit(job: TextJob, spot: LabelSpot): Choice | null {
        if (!(spot.dir >= 0 && spot.dir < SPOTS.length && spot.ring >= 0 && spot.ring < RINGS)) return null;
        let X = this.X(job.spec.x);
        let Y = this.Y(job.spec.y);
        let pref = job.spec.dir || UP_RIGHT;
        if (spot.k) {
            const track = this.trackOf(job);
            const p = track ? this.slid(job, track, spot.k, pref) : null;
            if (!p) return null;
            X = p.X;
            Y = p.Y;
            pref = p.pref;
        }
        const base = spotBase(spot.dir, spot.ring, spot.k, pref, job.spec.slide ? COST_SIDE_LINE : COST_SIDE);
        const hit = this.cost(this.spotBox(job, spot.dir, X, Y, spot.ring), job.em, true, job.own);
        return { X, Y, dir: spot.dir, ring: spot.ring, k: spot.k, base, hit, cost: base + hit };
    }

    /**
     * The best spot for a free label. It starts with the spots right beside
     * the label's point or its place on its line (SPOTS). A clear one, with
     * no stroke brushing it or running between it and its point, is taken
     * at once: a label never moves for a nicer side alone. Otherwise a
     * label of a line slides along its line, and then the same spots are
     * tried one line further out and two lines out; each of these stages
     * costs more than the one before, so it only wins when the nearer
     * spots have a hit or that trouble. Earlier candidates win ties
     * (preferred side first), so equal frames give equal labels.
     */
    choose(job: TextJob): Choice {
        const X = this.X(job.spec.x);
        const Y = this.Y(job.spec.y);
        const pref = job.spec.dir || UP_RIGHT;
        const best: Choice = { X, Y, dir: 0, ring: 0, k: 0, base: 0, hit: Infinity, cost: Infinity };
        this.ring(job, X, Y, pref, 0, 0, best);
        if (this.dense || (best.hit === 0 && best.cost - best.base < 1e-9)) return best;
        if (job.spec.slide) this.slide(job, pref, best);
        // Spots that start above the best one so far are skipped unscored, so this is cheap once a good spot is known.
        for (let ring = 1; ring < RINGS; ring++) this.ring(job, X, Y, pref, ring, 0, best);
        return best;
    }

    /** Obstacle cost of the job's current spot against the obstacles as they are now (0: clear). */
    hits(job: TextJob): number {
        return this.cost(this.spotBox(job, job.dir, this.X(job.x), this.Y(job.y), job.ring), job.em, true, job.own);
    }

    /** Preference cost of the job's current spot; call right after hits(job), whose strokes that brush the box it counts. */
    prefs(job: TextJob): number {
        const near = this.near;
        const X = this.X(job.x);
        const Y = this.Y(job.y);
        const taken = this.taken(X, Y) & (1 << SPOTS[job.dir].side) ? COST_SAME_SIDE : 0;
        return job.base + near + taken + (this.separated(X, Y, this.spotBox(job, job.dir, X, Y, job.ring)) ? COST_SEPARATED : 0);
    }

    /** Move the job to a chosen spot (not yet an obstacle: see put). */
    apply(job: TextJob, c: Choice): void {
        // Its own place keeps its exact coordinates.
        const p = c.k === 0 ? { x: job.spec.x, y: job.spec.y } : this.toMath(c.X, c.Y);
        job.x = p.x;
        job.y = p.y;
        job.anchor = ANCHOR_DIRS[SPOTS[c.dir].side].anchor;
        job.dir = c.dir;
        job.ring = c.ring;
        job.k = c.k;
        job.base = c.base;
        job.scored = true;
        const o = this.shift(job, c.dir, c.ring);
        job.offset = o.x !== 0 || o.y !== 0 ? o : undefined;
    }

    /** Make the job's text an obstacle for the labels placed after it (`free`: a label on a spot of SPOTS). */
    put(job: TextJob, free: boolean): void {
        const X = this.X(job.x);
        const Y = this.Y(job.y);
        if (!free) {
            job.box = this.place(boxAt(job.anchor, X, Y, job.w, job.h, 0, 0));
            return;
        }
        job.box = this.place(this.spotBox(job, job.dir, X, Y, job.ring));
        const side = SPOTS[job.dir].side;
        const key = this.sideKey(X, Y);
        const list = this.sides.get(key);
        if (list) list.push(side);
        else this.sides.set(key, [side]);
    }

    /** Take a free label off the obstacles again (it is being re-placed). */
    lift(job: TextJob): void {
        this.remove(job.box);
        job.box = -1;
        const list = this.sides.get(this.sideKey(this.X(job.x), this.Y(job.y)));
        if (!list) return;
        const at = list.indexOf(SPOTS[job.dir].side);
        if (at >= 0) list.splice(at, 1);
    }

    /**
     * Spot for a region's own label: its labelPoint unless the text box there
     * leaves the region, touches the axes or their tick labels, or crosses a
     * stroke, a marker or another label; then the cheapest spot up to three
     * text heights away whose box lies inside the region and off the axes.
     */
    regionSpot(job: TextJob, region: RegionResult): Pt {
        const X0 = this.X(job.x);
        const Y0 = this.Y(job.y);
        const { w, h, em } = job;
        let bestX = X0;
        let bestY = Y0;
        let bestCost = Infinity;
        const consider = (X: number, Y: number, dist: number): void => {
            const b: Box = { x0: X - w / 2, y0: Y - h / 2, x1: X + w / 2, y1: Y + h / 2 };
            if (b.x0 < 0 || b.y0 < 0 || b.x1 > this.m.w || b.y1 > this.m.h) return;
            if (this.bands.some((band) => overlapArea(b, band) > 0)) return;
            const probes = [
                [b.x0, b.y0],
                [b.x1, b.y0],
                [b.x1, b.y1],
                [b.x0, b.y1],
                [X, b.y0],
                [b.x1, Y],
                [X, b.y1],
                [b.x0, Y],
            ];
            if (!probes.every(([px, py]) => pointInRings(this.toMath(px, py), region.rings))) return;
            const c = dist + this.cost(b, em, false) + this.near;
            if (c < bestCost - 1e-9) {
                bestCost = c;
                bestX = X;
                bestY = Y;
            }
        };
        consider(X0, Y0, 0);
        for (const k of REGION_STEPS) {
            if (bestCost <= k) break;
            for (const d of ANCHOR_DIRS) consider(X0 + k * h * d.x, Y0 + k * h * d.y, k);
        }
        // No spot fits (a sliver of a region): keep the labelPoint.
        return bestCost < Infinity ? this.toMath(bestX, bestY) : { x: job.x, y: job.y };
    }
}

/** Index into ANCHOR_DIRS of the side closest to direction `dir` (earlier sides win ties). */
function preferredSide(dir: Pt): number {
    let best = 0;
    for (let k = 1; k < ANCHOR_DIRS.length; k++) {
        const d = ANCHOR_DIRS[k];
        const b = ANCHOR_DIRS[best];
        if (d.x * dir.x + d.y * dir.y > b.x * dir.x + b.y * dir.y + 1e-9) best = k;
    }
    return best;
}

/** Sweeps that re-place each free label against all the others (greedy order effects). */
const REFINE_SWEEPS = 2;
/**
 * Free labels up to which the refinement sweeps run and a label may slide
 * or move out a line (REFINE_MAX), and up to which sides are scored at all
 * (SCORED_MAX): beyond that (a densely labelled lattice, unreadable anyway)
 * labels keep their preferred side so frames stay fast.
 */
const REFINE_MAX = 200;
const SCORED_MAX = 600;

/**
 * The curve of a visible function as obstacle polylines (math coordinates):
 * coarser than the preview draws it, but a label only has to keep off it.
 * A stretch that leaves the view is kept up to its first sample outside, so
 * the curve reaches the frame; a jump across the whole view (a pole) breaks
 * the polyline.
 */
function obstacleCurve(info: FunctionInfo, view: View): Pt[][] {
    const fn = info.fn;
    let lo: number;
    let hi: number;
    let at: (t: number) => Pt;
    if (info.kind === 'cartesian') {
        const d = info.domain;
        lo = d ? Math.max(d[0], view.xmin) : view.xmin;
        hi = d ? Math.min(d[1], view.xmax) : view.xmax;
        at = (x) => ({ x, y: fn(x) });
    } else {
        [lo, hi] = info.domain || [0, 2 * Math.PI];
        const fy = info.fnY;
        if (info.kind === 'parametric') {
            if (!fy) return [];
            at = (t) => ({ x: fn(t), y: fy(t) });
        } else {
            at = (theta) => {
                const r = fn(theta);
                return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
            };
        }
    }
    if (!(hi > lo) || !finite(lo) || !finite(hi)) return [];
    // Which side of the view a point lies on: 0 inside, else a code that is negated on the opposite side.
    const side = (p: Pt): number => (p.y > view.ymax ? 1 : p.y < view.ymin ? -1 : 0) + (p.x > view.xmax ? 3 : p.x < view.xmin ? -3 : 0);
    const lines: Pt[][] = [];
    let cur: Pt[] = [];
    let prev: Pt | null = null;
    let prevSide = 0;
    const flush = () => {
        if (cur.length > 1) lines.push(cur);
        cur = [];
    };
    for (let i = 0; i <= OBSTACLE_SAMPLES; i++) {
        const p = at(lo + ((hi - lo) * i) / OBSTACLE_SAMPLES);
        if (!finite(p.x) || !finite(p.y)) {
            flush();
            prev = null;
            continue;
        }
        const s = side(p);
        if (prev) {
            // Both ends outside on the same side: not in the picture. On opposite sides in one step: a pole.
            if (prevSide !== 0 && s !== 0 && (s === prevSide || s === -prevSide)) flush();
            else {
                if (!cur.length) cur.push(prev);
                cur.push(p);
            }
        }
        prev = p;
        prevSide = s;
    }
    flush();
    return lines;
}

/**
 * Obstacle polylines of every visible function, sampled after the scene has
 * published its derived values (a body may read P1_x). With a cache, a
 * curve is sampled again only when something it depends on, or the view,
 * changed.
 */
function functionCurves(math: MathContext, params: FunctionParameters[], view: View, state: CacheState | null): Pt[][] {
    const out: Pt[][] = [];
    const seen = new Set<string>();
    const frame = `${view.xmin},${view.xmax},${view.ymin},${view.ymax}`;
    for (const info of math.functions()) {
        const f = params[info.index];
        if (!f || info.hidden || info.error || info.domainError) continue;
        if (!str(f.expression).trim() && !(f.parametric && str(f.expressionY).trim())) continue;
        let lines: Pt[][] | null = null;
        const key = state ? `${frame}|${math.depsKey([info.name])}` : '';
        if (state) {
            seen.add(info.name);
            const hit = state.curves.get(info.name);
            if (hit && hit.key === key) lines = hit.lines;
        }
        if (!lines) {
            lines = obstacleCurve(info, view);
            if (state) state.curves.set(info.name, { key, lines });
        }
        for (const line of lines) out.push(line);
    }
    if (state) for (const name of Array.from(state.curves.keys())) if (!seen.has(name)) state.curves.delete(name);
    return out;
}

/**
 * Place every text of the frame. Fixed sides first, as obstacles; then
 * region labels (centred inside their region, moved off the axes and
 * strokes when needed); then free labels in labelRank order, each on the
 * spot with the lowest cost: no hit before any hit, then the least overlap
 * (see the COST_ constants). Candidates are the eight sides of the label's
 * point on two rings; a label of a line or curve also slides along it.
 * Obstacles are every stroke and guide of the scene, the curves of the
 * functions (`curves`), markers, centred axes with their tick labels,
 * labels placed before, and the plot frame. Labels of shapes that stand
 * still go before labels of shapes on a slider (movingNodes). Greedy
 * placement cannot see labels placed after it, so a few sweeps then move a
 * label that has a hit when another spot is cheaper now that every label is
 * known.
 *
 * Without `before` the result is a pure function of the frame (no memory of
 * earlier frames), so the settled preview, a chart in a note and the export
 * agree; candidates are tried in a fixed order and only a strictly cheaper
 * one wins. With `before` (the spots of the previous frame, see
 * SceneInput2D.keepLabels) a label first tries the spot it had and keeps it
 * while it is clear, so during a gesture a label moves only when something
 * reaches it. Sets each job's x, y, anchor and offset.
 */
function layoutTexts(
    jobs: TextJob[],
    items: SceneItem2D[],
    curves: Pt[][],
    view: View,
    axisStyle: AxisStyle,
    metrics: LabelMetrics,
    before: Map<string, LabelSpot> | null
): void {
    if (!jobs.length) return;
    const layout = new LabelLayout(view, metrics, axisStyle, items, curves);
    for (const job of jobs) layout.measure(job);
    for (const job of jobs) {
        if (!job.spec.anchor || job.spec.region) continue;
        layout.put(job, false);
    }
    for (const job of jobs) {
        if (!job.spec.region) continue;
        if (job.region) {
            const p = layout.regionSpot(job, job.region);
            job.x = p.x;
            job.y = p.y;
        }
        layout.put(job, false);
    }
    const free = jobs.filter((j) => !j.spec.anchor).sort((a, b) => Number(a.moving) - Number(b.moving) || a.rank - b.rank || a.order - b.order);
    if (free.length > SCORED_MAX) {
        for (const job of free) {
            // The first eight SPOTS are the sides of ANCHOR_DIRS.
            job.dir = preferredSide(job.spec.dir || UP_RIGHT);
            job.anchor = ANCHOR_DIRS[job.dir].anchor;
        }
        return;
    }
    layout.dense = free.length > REFINE_MAX;
    for (const job of free) {
        // During a gesture a label keeps the spot of the frame before while that spot is clear.
        const spot = before ? before.get(job.key) : undefined;
        const kept = spot ? layout.revisit(job, spot) : null;
        job.kept = !!kept && kept.hit === 0;
        layout.apply(job, kept && kept.hit === 0 ? kept : layout.choose(job));
        layout.put(job, true);
    }
    for (let sweep = 0; sweep < REFINE_SWEEPS && free.length <= REFINE_MAX; sweep++) {
        let moved = false;
        for (const job of free) {
            layout.lift(job);
            const hit = layout.hits(job);
            // A clear label beside its point stays where it is: nothing to gain but a nicer side.
            if (hit > 0 || (job.ring > 0 && !job.kept)) {
                const now = hit + layout.prefs(job);
                const best = layout.choose(job);
                if (best.cost < now - SWEEP_GAIN) {
                    layout.apply(job, best);
                    job.kept = false;
                    moved = true;
                }
            }
            layout.put(job, true);
        }
        if (!moved) break;
    }
}

/**
 * Formats a node's label specs. A template that renders a '?' or keeps a
 * stray brace is validated once per field and its problem reported.
 */
function labelFormatter(node: SceneNode, math: MathContext, issues: SceneIssue[]): (spec: Pick<TextSpec, 'template' | 'literal' | 'part' | 'locals'>) => string {
    const checked = new Set<string>();
    const tool = node.tool;
    return (spec) => {
        if (spec.literal !== undefined) return spec.literal;
        let src = '';
        let field = 'label';
        if (spec.template === 'label') src = tool && 'label' in tool ? str(tool.label) : '';
        else if (tool && tool.type === 'region') {
            src = str((tool.conditionLabels || [])[spec.template]);
            field = `conditionLabel:${spec.template}`;
        }
        if (!src.trim()) return '';
        const text = math.formatTemplate(partOf(src, spec.part), spec.locals);
        if (!checked.has(field) && (text.indexOf('?') >= 0 || text.indexOf('{') >= 0 || text.indexOf('}') >= 0)) {
            checked.add(field);
            const v = math.validate(src, 'template', undefined, spec.locals ? Object.keys(spec.locals) : []);
            if (!v.ok) issues.push({ source: node.name, field, message: v.message, severity: 'error' });
        }
        return text;
    };
}

// --------------------------------------------------------------- 3D scene

/**
 * Where a 3D text label goes when it is centred on a point that lies on an
 * edge or a corner of the box: 'left', 'right', 'above' or 'below', the
 * side away from the middle of the box as the camera shows it, so the text
 * stands beside the edge and the edge does not run through it. Null for
 * any other point (the label stays centred).
 *
 * `ex`, `ey`, `ez` are the screen vectors (right, up) of one data unit
 * along x, y and z: the preview's camera, which the export reproduces. The
 * side depends only on the point, the box and the camera, never on text or
 * picture sizes, so the preview and the PDF agree.
 */
export function edgeLabelSide3D(
    p: [number, number, number],
    box: View & { zmin: number; zmax: number },
    ex: [number, number],
    ey: [number, number],
    ez: [number, number]
): 'left' | 'right' | 'above' | 'below' | null {
    const lo = [box.xmin, box.ymin, box.zmin];
    const hi = [box.xmax, box.ymax, box.zmax];
    const vecs = [ex, ey, ez];
    // From the middle of the box to the point, as far as the point sits on a face: a screen vector.
    let vx = 0;
    let vy = 0;
    let on = 0;
    let free = -1;
    for (let k = 0; k < 3; k++) {
        const range = hi[k] - lo[k];
        if (!(range > 0) || !finite(p[k]) || !finite(vecs[k][0]) || !finite(vecs[k][1])) return null;
        const tol = 1e-6 * range;
        const sign = Math.abs(p[k] - hi[k]) <= tol ? 1 : Math.abs(p[k] - lo[k]) <= tol ? -1 : 0;
        if (!sign) {
            if (p[k] < lo[k] || p[k] > hi[k]) return null;
            free = k;
            continue;
        }
        on++;
        vx += sign * (range / 2) * vecs[k][0];
        vy += sign * (range / 2) * vecs[k][1];
    }
    if (on < 2) return null;
    if (on === 2) {
        // Along an edge: only the part of the way out that is square to the edge counts.
        const tx = vecs[free][0];
        const ty = vecs[free][1];
        const len2 = tx * tx + ty * ty;
        if (len2 > 0) {
            const along = (vx * tx + vy * ty) / len2;
            vx -= along * tx;
            vy -= along * ty;
            // The edge runs through the middle of the picture: either side is as good, take the one on the right or above.
            if (Math.hypot(vx, vy) < 1e-9 * Math.sqrt(len2)) {
                vx = Math.abs(ty);
                vy = ty === 0 ? Math.abs(tx) : 0;
            }
        }
    }
    if (!(Math.hypot(vx, vy) > 0)) return null;
    if (Math.abs(vx) >= Math.abs(vy)) return vx > 0 ? 'right' : 'left';
    return vy > 0 ? 'above' : 'below';
}

export interface Scene3D {
    points: Array<{ x: number; y: number; z: number; color: string; size: MarkerSize; label?: string }>;
    segments: Array<{
        a: [number, number, number];
        b: [number, number, number];
        color: string;
        width: string;
        dashed: boolean;
        arrow?: ArrowHeads;
    }>;
    planes: Array<{ axis: 'x' | 'y' | 'z'; value: number; color: string; opacity: number }>;
    issues: SceneIssue[];
    derived: Record<string, number>;
}

export interface SceneInput3D {
    tools: Tool[];
    math: MathContext;
    view: View & { zmin: number; zmax: number };
}

function computePoints3D(t: PointsTool, ctx: Ctx): Output {
    const out = newOutput();
    if (t.source !== 'list') {
        addIssue(out, t.name, 'points', 'only list points in 3D', 'info');
        return out;
    }
    if (str(t.objective).trim()) addIssue(out, t.name, 'objective', 'the objective is not used in 3D', 'info');
    const list = listPoints(str(t.points), 3, t.name, ctx, out);
    if (!list) return out;
    out.points = list;
    publish(out, t.name, list, NaN, 3);
    const color = str(t.color) || 'red';
    const size: MarkerSize = t.size === 'small' || t.size === 'large' ? t.size : 'normal';
    out.points3 = list.map((p, i) => ({
        x: p[0],
        y: p[1],
        z: p[2],
        color,
        size,
        part: i,
        locals: { x: p[0], y: p[1], z: p[2], val: NaN, i: i + 1 },
    }));
    return out;
}

function computeSegment3D(t: SegmentTool, ctx: Ctx): Output {
    const out = newOutput();
    if (!str(t.path).trim()) return out;
    const pts = pathPoints(t, 3, ctx, out);
    if (!pts) return out;
    if (pts.length < 2) {
        addIssue(out, t.name, 'path', 'a path needs at least two points', 'info');
        return out;
    }
    if (t.style === 'brace') addIssue(out, t.name, undefined, 'braces are drawn as plain lines in 3D', 'info');
    const triple = (p: number[]): [number, number, number] => [p[0], p[1], p[2]];
    const legs: Array<[number[], number[]]> = [];
    for (let i = 1; i < pts.length; i++) legs.push([pts[i - 1], pts[i]]);
    if (t.closed && pts.length > 2) legs.push([pts[pts.length - 1], pts[0]]);
    const arrow = ARROWS[t.style];
    const color = str(t.color) || 'black';
    const width = str(t.thickness) || 'thin';
    out.segments3 = legs.map(([a, b]) => {
        const s: Scene3D['segments'][number] = { a: triple(a), b: triple(b), color, width, dashed: !!t.dashed };
        if (arrow) s.arrow = arrow;
        return s;
    });
    return out;
}

function computePlane(t: PlaneTool, ctx: Ctx): Output {
    const out = newOutput();
    const src = str(t.value);
    if (!src.trim()) return out;
    const res = ctx.math.tryValue(src);
    if (!res.ok) {
        if (ctx.math.validate(src, 'value').ok) addIssue(out, t.name, 'value', res.message, 'info');
        else fail(out, t.name, 'value', res.message);
        return out;
    }
    const axis = t.axis === 'x' || t.axis === 'y' ? t.axis : 'z';
    out.planes3 = [{ axis, value: res.value, color: str(t.color) || 'orange', opacity: num(t.fillOpacity, 0.25) }];
    return out;
}

/** 3D scene: dim-3 points (list source) and segments, planes. Other tools are skipped. Never throws. */
export function computeScene3D(input: SceneInput3D): Scene3D {
    try {
        return scene3D(input);
    } catch (e) {
        return {
            points: [],
            segments: [],
            planes: [],
            issues: [{ source: 'chart', message: `Could not compute the shapes: ${errorText(e)}`, severity: 'error' }],
            derived: {},
        };
    }
}

function scene3D(input: SceneInput3D): Scene3D {
    const empty: Scene3D = { points: [], segments: [], planes: [], issues: [], derived: {} };
    const math = input && input.math;
    if (!math) return empty;
    const tools = (Array.isArray(input.tools) ? input.tools : []).filter((t): t is Tool => !!t && typeof t === 'object');
    const v = input.view;
    const view: View = validView(v) ? v : { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
    const ctx: Ctx = {
        math,
        view,
        grid: { nx: 1, ny: 1 },
        axisStyle: 'box',
        dim: 3,
        outputs: new Map(),
        toolsByName: toolMap(tools),
        functions: [],
    };
    const nodes: SceneNode[] = [];
    for (const t of tools) {
        if (t.type === 'plane3D' || ((t.type === 'points' || t.type === 'segment') && t.dim === 3)) nodes.push(toolNode(t, math));
    }
    if (!nodes.length) {
        math.setDerived({});
        return empty;
    }
    // 3D tools are cheap: no cross-frame memo, a fresh state per call.
    const state: CacheState = { math, memo: new Map(), good: new Map(), names: null, curves: new Map(), labels: new Map() };
    const outs = runNodes(
        nodes,
        ctx,
        state,
        '3d',
        (node) => {
            const t = node.tool as Tool;
            if (t.type === 'points') return computePoints3D(t, ctx);
            if (t.type === 'segment') return computeSegment3D(t, ctx);
            if (t.type === 'plane3D') return computePlane(t, ctx);
            return newOutput();
        },
        new Set()
    );
    const scene: Scene3D = { points: [], segments: [], planes: [], issues: [], derived: {} };
    for (const out of outs) Object.assign(scene.derived, out.derived);
    math.setDerived(scene.derived);
    const read = readNames(nodes, math);
    nodes.forEach((node, i) => {
        const out = outs[i];
        pushIssues(scene.issues, out.issues, node, read);
        const t = node.tool as Tool;
        if (t.hidden) return;
        const formatter = labelFormatter(node, math, scene.issues);
        for (const p of out.points3 || []) {
            const point: Scene3D['points'][number] = { x: p.x, y: p.y, z: p.z, color: p.color, size: p.size };
            const label = formatter({ template: 'label', part: p.part, locals: p.locals });
            if (label.trim()) point.label = label;
            scene.points.push(point);
        }
        for (const s of out.segments3 || []) scene.segments.push(s);
        for (const p of out.planes3 || []) scene.planes.push(p);
    });
    return scene;
}
