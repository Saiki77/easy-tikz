/*
 * 2D SVG preview. Draws the grid, axes and function curves itself and
 * everything else (function fills, tangents and extrema, regions, curves,
 * points, segments, braces, their labels) generically from computeScene2D's
 * primitives, which the TikZ exporter draws too, so preview and export show
 * the same picture. Every evaluation goes through the chart's MathContext.
 *
 * Draw layers (shared with the exporter, scene.ts section 4 of the spec):
 *   1 grid, 2 fills, 3 axes, 4 function curves, 5 strokes, 6 guides then
 *   markers, 7 braces, 8 texts and labels; legend and title on top.
 * Within a layer, items keep their list order.
 */
import { AnnotationSize, FillPattern, FunctionParameters, MarkerSize, RendererConfig, Tool } from './types';
import { COLOR_MAP, THICKNESS_MAP, mixHex, resolveCssColor } from './colors';
import { marchingGrid, sampleCurve, stripLatex, tickValues } from './util';
import { AxisTicks, Tick, autoTickSteps, axisTicks } from './ticks';
import { ensureMathJax, extractMathSource, renderMathLabel, renderMixedLabel, flushMathRenders } from './mathlabel';
import { FunctionInfo, FunctionKind, MathContext, labelDisplayText, labelParts } from './mathcontext';
// 6.0 A
import { valueDefinitions } from './values/defs';
import {
    BracePrim,
    FillPrim,
    HaloTint,
    MarkerPrim,
    Scene2D,
    SceneCache,
    SceneIssue,
    SceneItem2D,
    StrokePrim,
    TEXT_GAP_PT,
    TextAnchor,
    TextPrim,
    computeScene2D,
    labelMetricsFor,
    tintsAt,
} from './scene';
import { Grid, Pt, View } from './geometry';
import { t as msg } from './i18n';
import { GRID_OPACITY, opacityValue } from './opacity';
import { pixelLayer } from './iterate/paint'; // 6.0 E
import type { LiveLayer } from './motion6/live'; // 6.0 F4
import { themedColor } from './motion6/liveprims'; // 6.0 F4
// 6.0 entrances
import { EntranceKind, StepEntrance, clipLines, clipSegment, grownLine, labelStart, middleOf, nearestOn, partialLines, popDelay, riseAt, rippleStops, toolKind } from './motion6/entrances';
// 6.1 clean look
import { AxisPlace, CLEAN_AXIS_PX, CLEAN_GRID_ALPHA, CLEAN_LINE_PX, CLEAN_TICK_PT, CLEAN_VARS, CleanAxisFrame, TickObstacles, axisPlace, cleanTickSpots } from './look';

/** 6.0 entrances: how a scene item whose step comes in enters (its object's kind, its start, where its points start popping). */
interface ItemEntrance {
    kind: EntranceKind;
    /** ms after the step the object starts (its first point, for points). */
    start: number;
    /** Index of its first marker among the markers of the step (they pop one after another). */
    first: number;
    /** Its tool (null: a function's tangent, fill and extrema). */
    tool: Tool | null;
}

/** CONTRACT (v4): options for one render. */
export interface SVGRendererOptions {
    /** Shared context (modal). Created from the config when omitted (inline notes). */
    math?: MathContext;
    /** Cross-frame scene memo for this chart. */
    cache?: SceneCache;
    /** 'draft' = ~6 px marching-squares cells (during drags / slider moves), 'full' = ~3 px (default). */
    quality?: 'draft' | 'full';
    /**
     * On-screen CSS px per viewBox unit (shown chart size / config size), so
     * the cells above are measured where the chart is actually seen. Rounded
     * to 0.05 and capped at 1 (normalizePixelScale in util.ts); 1 when
     * omitted. fitPixelScale (util.ts) computes it from the box the SVG is
     * drawn into.
     */
    pixelScale?: number;
    // 6.0 F4
    /**
     * The live canvas of a chart on screen (src/motion6/live.ts): what moves
     * on the clock is drawn there, its still frame hidden in the SVG. Absent
     * (the export, SVG files): the still frame shows.
     */
    live?: LiveLayer;
}

/** CONTRACT (v4): where the plot area ended up, for mapping pointer positions to math coordinates. */
export interface RenderLayout {
    /** SVG viewBox size (= config width / height). */
    width: number;
    height: number;
    /** Plot rectangle in viewBox units (letterboxed when equalScale). */
    plot: { x: number; y: number; w: number; h: number };
    view: View;
    /** Marching-squares resolution the scene ran with (regions, level curves, optimum). */
    grid: Grid;
    /** Major tick positions (math units) used by drawGrid / drawAxes; grid snapping of drag to edit. Optional v4 addition. */
    ticks?: { x: number[]; y: number[] };
}

/** CONTRACT (v4, drag to edit): one function curve as drawn, in math coordinates. */
export interface DrawnCurve {
    name: string;
    /** Index into the chart's functions. */
    index: number;
    kind: FunctionKind;
    /** Runs split at jumps and gaps, exactly the polylines of the drawn path (they may reach a little beyond the view). */
    lines: Pt[][];
}

/** CONTRACT (v4, drag to edit): what the last render drew, for hit testing. Never exported. */
export interface DrawnScene {
    /** Items as drawn (after hidden filtering). */
    items: SceneItem2D[];
    /** Visible, error-free functions as sampled by drawCurves (math coordinates, split at jumps). */
    curves: DrawnCurve[];
}

/**
 * Text scale. The preview canvas has the exported figure's aspect, so one
 * TeX pt of the figure is `width / paper width in pt` viewBox units. Texts
 * are set at the sizes the export typesets them (a 10 pt document), so the
 * preview shows the PDF's proportions; the paddings around the plot follow
 * from those sizes.
 */
const PT_PER_CM = 72.27 / 2.54;
const MIN_PT_PX = 0.8;
const MAX_PT_PX = 4;
/** Tool and user labels: \footnotesize, \small, \large. */
const FONT_PT: Record<AnnotationSize, number> = { small: 8, normal: 9, large: 12 };
/** Tick labels and axis labels (\normalsize), the title a little larger, the legend \footnotesize. */
const TICK_PT = 10;
const AXIS_LABEL_PT = 10;
const TITLE_PT = 11;
const LEGEND_PT = 8;
/** Gaps in pt: tick to tick label, tick labels to axis label, plot to title, canvas edge. */
const TICK_GAP_PT = 2;
const LABEL_GAP_PT = 3;
const TITLE_GAP_PT = 4;
const EDGE_PT = 2;
/** Tick length in px (outside the plot), as before the text scale. */
const TICK_LEN = 5;
/** The paddings never take more than this share of the canvas per direction. */
const MAX_PADDING_SHARE = 0.45;

/**
 * Charts smaller than this (example thumbnails) get a 3 px margin and a
 * hairline frame, and leave out ticks, axis labels, title, legend and texts:
 * the regular padding alone would be taller than a 56 px thumbnail.
 */
const COMPACT_MAX_WIDTH = 200;
const COMPACT_MAX_HEIGHT = 120;
const COMPACT_PADDING = 3;

const SAMPLES_PER_FUNCTION = 500;

/** Default target tick counts used when no user override is supplied. */
const DEFAULT_TARGET_TICKS_X = 8;

/** The 3.x default view, used when a config arrives with an unusable range. */
const DEFAULT_VIEW: View = { xmin: -0.5, xmax: 10, ymin: -0.5, ymax: 5 };

const MARKER_RADIUS: Record<MarkerSize, number> = { small: 3, normal: 4, large: 5.5 };
/** 6.1: the clean look's dots, a little larger, with a wider white rim (the film's). */
const CLEAN_MARKER_RADIUS: Record<MarkerSize, number> = { small: 3.5, normal: 4.75, large: 6.25 };
// 6.0 ML
/** matplotlib's default dot radius in points (scatter's s = 36): a dot with MarkerPrim.radius this big has the normal size. */
const MATPLOTLIB_NORMAL_PT = 3;

/** Texts may sit this fraction of the view outside it (the export uses `clip mode=individual`). */
const TEXT_SLACK = 0.05;

/** Rough advance width of one character of label text, in em, for sizing the legend box and paddings. */
const CHAR_WIDTH_EM = 0.56;
/** Bold labels (region names) mix this much of the text colour into their own colour. */
const BOLD_INK_MIX = 0.6;

const BACKGROUND = 'var(--background-primary)';
/** 6.2.1: how far a text's halo reaches beyond its glyphs, in em (plain text: a stroke twice as wide). */
const HALO_EM = 0.125;
const BORDER = 'var(--background-modifier-border)';
const TEXT_NORMAL = 'var(--text-normal)';
const TEXT_MUTED = 'var(--text-muted)';

type HAnchor = 'start' | 'middle' | 'end';
type VAnchor = 'above' | 'middle' | 'below';

/**
 * How a text is aligned on its anchor point, per side. The gap between the
 * point and the text (TikZ's inner sep, in pt) is TEXT_GAP_PT of the scene:
 * the label placer measures with the same numbers.
 */
const TEXT_ALIGN: Record<TextAnchor, { h: HAnchor; v: VAnchor }> = {
    center: { h: 'middle', v: 'middle' },
    above: { h: 'middle', v: 'above' },
    below: { h: 'middle', v: 'below' },
    left: { h: 'end', v: 'middle' },
    right: { h: 'start', v: 'middle' },
    'above right': { h: 'start', v: 'above' },
    'below left': { h: 'end', v: 'below' },
    'above left': { h: 'end', v: 'above' },
    'below right': { h: 'start', v: 'below' },
};

/** Plot padding in viewBox units. */
interface Padding {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

type TileShape = { tag: 'line' | 'circle'; attrs: Record<string, string> };

/**
 * 8 x 8 px pattern tiles approximating the TikZ patterns the exporter emits
 * (horizontal lines, vertical lines, crosshatch, crosshatch dots, north east
 * lines, north west lines). TikZ's crosshatch is the two diagonals, so its
 * tile is too. Diagonals carry corner stubs so neighbouring tiles join
 * without gaps.
 */
const PATTERN_TILES: Record<string, TileShape[]> = {
    horizontal: [{ tag: 'line', attrs: { x1: '0', y1: '4', x2: '8', y2: '4', 'stroke-width': '1.2' } }],
    vertical: [{ tag: 'line', attrs: { x1: '4', y1: '0', x2: '4', y2: '8', 'stroke-width': '1.2' } }],
    crosshatch: [
        { tag: 'line', attrs: { x1: '0', y1: '8', x2: '8', y2: '0', 'stroke-width': '1' } },
        { tag: 'line', attrs: { x1: '-1', y1: '1', x2: '1', y2: '-1', 'stroke-width': '1' } },
        { tag: 'line', attrs: { x1: '7', y1: '9', x2: '9', y2: '7', 'stroke-width': '1' } },
        { tag: 'line', attrs: { x1: '0', y1: '0', x2: '8', y2: '8', 'stroke-width': '1' } },
        { tag: 'line', attrs: { x1: '-1', y1: '7', x2: '1', y2: '9', 'stroke-width': '1' } },
        { tag: 'line', attrs: { x1: '7', y1: '-1', x2: '9', y2: '1', 'stroke-width': '1' } },
    ],
    dots: [
        { tag: 'circle', attrs: { cx: '2', cy: '2', r: '1.1' } },
        { tag: 'circle', attrs: { cx: '6', cy: '6', r: '1.1' } },
    ],
    'north-east': [
        { tag: 'line', attrs: { x1: '0', y1: '8', x2: '8', y2: '0', 'stroke-width': '1.2' } },
        { tag: 'line', attrs: { x1: '-1', y1: '1', x2: '1', y2: '-1', 'stroke-width': '1.2' } },
        { tag: 'line', attrs: { x1: '7', y1: '9', x2: '9', y2: '7', 'stroke-width': '1.2' } },
    ],
    'north-west': [
        { tag: 'line', attrs: { x1: '0', y1: '0', x2: '8', y2: '8', 'stroke-width': '1.2' } },
        { tag: 'line', attrs: { x1: '-1', y1: '7', x2: '1', y2: '9', 'stroke-width': '1.2' } },
        { tag: 'line', attrs: { x1: '7', y1: '-1', x2: '9', y2: '1', 'stroke-width': '1.2' } },
    ],
};

interface LabelOptions {
    color: string;
    fontSize: number;
    hAnchor: HAnchor;
    vAnchor: VAnchor;
    weight?: string;
    /** Background-coloured outline (texts on top of fills). */
    halo?: boolean;
    /** 6.2.1: the halo's colour (haloInk): the fill under the text over the background. Absent: the background. */
    haloInk?: string;
    /** Extra attributes on the outermost element drawn. */
    attrs?: Record<string, string>;
}

interface DrawnLabel {
    el: SVGElement;
    width: number;
    height: number;
    /** 6.1: its top left corner (viewBox units), for the pill of a value label. */
    x0: number;
    y0: number;
}

/** 6.1: a canvas to measure plain label text with (the pill of a value label fits its text). */
let measureCanvas: CanvasRenderingContext2D | null | undefined;
/** 6.2.1: the theme's text font, read once per render (render() clears it). */
let measureFamily: string | null = null;

/** 6.1: the width of a plain text at `fs` px in the theme's text font, or null where nothing can measure it. */
function measuredWidth(text: string, fs: number, weight: string | null): number | null {
    try {
        if (measureCanvas === undefined) measureCanvas = createEl('canvas').getContext('2d');
        if (!measureCanvas || typeof activeDocument === 'undefined') return null;
        if (measureFamily === null) measureFamily = getComputedStyle(activeDocument.body).getPropertyValue('--font-text').trim() || 'sans-serif';
        const family = measureFamily;
        measureCanvas.font = `${weight || '400'} ${fs}px ${family}`;
        const w = measureCanvas.measureText(text).width;
        return Number.isFinite(w) && w > 0 ? w : null;
    } catch {
        return null;
    }
}

interface LegendEntry {
    color: string;
    width: number;
    dashed: boolean;
    label: string;
}

interface ChartFunction {
    info: FunctionInfo;
    f: FunctionParameters;
}

/** Render counter for unique ids: two charts in one note must not share clip paths, patterns or markers. */
let renderCount = 0;

/**
 * Last scene computed without throwing, per chart (keyed by the chart's
 * SceneCache). computeScene2D never throws by contract; should it anyway,
 * the chart keeps its last good shapes instead of losing them all.
 */
const lastGoodScene = new WeakMap<SceneCache, Scene2D>();

/** Short coordinate text for path data and attributes. */
function num(n: number): string {
    return String(Math.round(n * 100) / 100);
}

/**
 * 6.2.1: a halo around HTML text (MathJax labels) as CSS text shadows: 12
 * copies on a ring of `r` px, slightly blurred so the ring closes, in `ink`.
 */
function haloShadow(ink: string, r: number): string {
    const parts: string[] = [];
    for (let k = 0; k < 12; k++) {
        const a = (k * Math.PI) / 6;
        parts.push(`${num(r * Math.cos(a))}px ${num(r * Math.sin(a))}px ${num(0.5 * r)}px ${ink}`);
    }
    return parts.join(', ');
}

/** Arrowhead length in px: grows with the line width like TikZ tips, but less than proportionally. */
function arrowLength(width: number): number {
    return 7 + 2 * width;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

function finitePt(p: Pt | null | undefined): p is Pt {
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** 6.0 entrances: the children of `g` from index `from` on (what one item drew into it). */
function kidsFrom(g: SVGElement, from: number): Element[] {
    return Array.from(g.children).slice(from);
}

/** 6.0 entrances: multiply an element's opacity by `k`. */
function fadeEl(el: Element, k: number): void {
    const before = Number(el.getAttribute('opacity') ?? '1');
    el.setAttribute('opacity', num((Number.isFinite(before) ? before : 1) * Math.max(0, Math.min(1, k))));
}

/** Split a polyline at non-finite points; runs shorter than two points are dropped. */
function finiteRuns(line: Pt[] | null | undefined): Pt[][] {
    const runs: Pt[][] = [];
    let run: Pt[] = [];
    for (const p of line || []) {
        if (finitePt(p)) {
            run.push(p);
        } else {
            if (run.length >= 2) runs.push(run);
            run = [];
        }
    }
    if (run.length >= 2) runs.push(run);
    return runs;
}

/** No expression typed yet: nothing to draw and nothing to report. */
function isBlank(f: FunctionParameters): boolean {
    return !String(f.expression ?? '').trim() && !(f.parametric && String(f.expressionY ?? '').trim());
}

/** A usable axis range, or the default pair (and a flag) when it is not. */
function axisRange(lo: number, hi: number, dlo: number, dhi: number): [number, number, boolean] {
    return Number.isFinite(lo) && Number.isFinite(hi) && lo < hi ? [lo, hi, false] : [dlo, dhi, true];
}

export class SVGRenderer {
    private readonly config: RendererConfig;
    private readonly math: MathContext;
    /** True when the context was built here (inline notes): parameter values are re-applied on every render. */
    private readonly ownsMath: boolean;
    private readonly cache: SceneCache | undefined;
    private readonly quality: 'draft' | 'full';
    private readonly polar: boolean;
    private readonly width: number;
    private readonly height: number;
    private readonly compact: boolean;
    private readonly view: View;
    private readonly viewFallback: boolean;
    private readonly plot: { x: number; y: number; w: number; h: number };
    /** viewBox units per pt of the exported figure (text scale; 1 on thumbnails, which draw no text). */
    private readonly ptPx: number;
    /** Padding around the plot rectangle (before equal-scale letterboxing). */
    private readonly pad: Padding;
    /** Baseline region of the title: its bottom edge, in viewBox units. */
    private readonly titleBottom: number;
    /** Text colour resolved to a concrete value, for bold label ink (once per render). */
    private textInk: string | null = null;
    /** Marching-squares resolution for the scene (SVGRendererOptions quality and pixelScale). */
    private readonly grid: Grid;
    /** Major tick steps, see computeTickSteps. */
    private steps: [number, number] | null = null;
    /** The ticks of x and y for this frame (src/ticks.ts), from the chart's numbers. */
    private axisTicksCache: { x: AxisTicks; y: AxisTicks } | null = null;
    /** Id prefix of the render in progress (`etz-<n>-`) and the defs registered under it. */
    private ids = '';
    private defs: SVGDefsElement | null = null;
    private readonly patterns = new Map<string, string>();
    private readonly arrows = new Map<string, string>();
    /** Set when a `$...$`-wrapped label was rendered via MathJax during this render() pass. */
    private usedMath = false;
    /** 6.2.1: a `$...$` label fell back to plain text (MathJax may not be loaded yet). */
    private mathFailed = false;

    /** CONTRACT (v4): function + tool problems found during the last render(). */
    issues: SceneIssue[] = [];
    /** CONTRACT (v4): layout of the last render(), null before the first. */
    layout: RenderLayout | null = null;
    /** CONTRACT (v4, drag to edit): scene items and function curves of the last render(), null before the first. */
    drawn: DrawnScene | null = null;
    /** 6.0 D: the functions a transform moves (the scene draws them; their curves are left out). */
    private movedFns: ReadonlySet<number> = new Set();
    // 6.1
    /** Drawn in the clean look (src/look.ts): RendererConfig.look. */
    private readonly clean: boolean;
    /** Function polylines sampled this render (by function index), shared by the axes' numbers and the curves. */
    private readonly sampled = new Map<number, Pt[][]>();
    /** 6.0 F4: the live canvas, and whether it draws this render's moving parts (their still frame is hidden then). */
    private readonly live: LiveLayer | null;
    private liveOn = false;
    private dark = false;
    // 6.0 entrances
    /** The entrances of this frame (null: nothing moves, the still picture). */
    private ent: StepEntrance | null = null;
    /** Scene items whose object moves in this frame, with their entrance. */
    private readonly entering = new Map<SceneItem2D, ItemEntrance>();
    /** Markers of the step that pop in, all together (their stagger). */
    private popCount = 0;
    /** Masks made this render (sweeps and ripples), by item and kind. */
    private readonly masks = new Map<string, string>();
    /**
     * Set by render() when the drawing has `$...$` labels typeset by MathJax
     * (null otherwise). MathJax styles the glyphs of a new label only after
     * the pass, so its first box can be too small: the promise resolves true
     * when that happened and drawing the chart again now gives the label
     * its real size, false when nothing needs a redraw.
     */
    mathSettled: Promise<boolean> | null = null;

    constructor(config: RendererConfig, opts?: SVGRendererOptions) {
        this.config = config;
        this.polar = config.coordinateSystem === 'polar';
        this.ownsMath = !(opts && opts.math);
        this.math =
            opts && opts.math
                ? opts.math
                : MathContext.create({
                      parameters: config.parameters || [],
                      functions: config.functions || [],
                      polar: this.polar,
                      variables: config.variables,
                      toolNames: (config.tools || []).map((t) => t && t.name).filter((n): n is string => typeof n === 'string'),
                      // 6.0 A: let definitions.
                      values: valueDefinitions(config.tools),
                  });
        this.cache = opts ? opts.cache : undefined;
        this.quality = opts && opts.quality === 'draft' ? 'draft' : 'full';
        this.live = opts?.live ?? null; // 6.0 F4
        this.clean = config.look === 'clean'; // 6.1
        this.width = Number.isFinite(config.width) && config.width > 0 ? config.width : 760;
        this.height = Number.isFinite(config.height) && config.height > 0 ? config.height : 480;
        this.compact = this.width < COMPACT_MAX_WIDTH || this.height < COMPACT_MAX_HEIGHT;
        const [xmin, xmax, badX] = axisRange(config.xmin, config.xmax, DEFAULT_VIEW.xmin, DEFAULT_VIEW.xmax);
        const [ymin, ymax, badY] = axisRange(config.ymin, config.ymax, DEFAULT_VIEW.ymin, DEFAULT_VIEW.ymax);
        this.view = { xmin, xmax, ymin, ymax };
        this.viewFallback = badX || badY;
        this.ptPx = this.textScale();
        [this.pad, this.titleBottom] = this.padding();
        this.plot = this.plotRect();
        // ~3 / ~6 on-screen px marching-squares cells over the plot rectangle.
        this.grid = marchingGrid(this.plot.w, this.plot.h, opts && opts.pixelScale, this.quality);
    }

    render(): SVGElement {
        const cfg = this.config;
        this.ids = `etz-${++renderCount}-`;
        measureFamily = null;
        this.patterns.clear();
        this.arrows.clear();
        this.usedMath = false;
        this.mathFailed = false;
        this.textInk = null;
        this.issues = [];
        this.sampled.clear(); // 6.1
        if (this.ownsMath) this.math.setParams(cfg.parameters || []);
        const [stepX, stepY] = this.tickSteps();
        const v = this.view;
        this.layout = {
            width: this.width,
            height: this.height,
            plot: { ...this.plot },
            view: { ...v },
            grid: { ...this.grid },
            ticks: { x: tickValues(v.xmin, v.xmax, stepX), y: tickValues(v.ymin, v.ymax, stepY) },
        };
        this.drawn = null;
        if (this.viewFallback) {
            this.addIssue({ source: 'chart', message: msg('problems.render.invalidRange'), severity: 'error' });
        }

        const svg = this.el('svg', {
            width: String(this.width),
            height: String(this.height),
            viewBox: `0 0 ${this.width} ${this.height}`,
        });
        svg.appendChild(this.el('rect', { width: String(this.width), height: String(this.height), fill: BACKGROUND, rx: '4' }));
        const defs = this.el('defs');
        this.defs = defs;
        svg.appendChild(defs);
        // One px of slack so strokes lying exactly on the view border are not cut in half.
        const clip = this.el('clipPath', { id: `${this.ids}clip` });
        clip.appendChild(
            this.el('rect', {
                x: num(this.plot.x - 1),
                y: num(this.plot.y - 1),
                width: num(this.plot.w + 2),
                height: num(this.plot.h + 2),
            })
        );
        defs.appendChild(clip);

        // The scene runs before anything is sampled: it publishes derived
        // values (P1_x, ...) that function bodies, labels and the title read.
        const fns = this.chartFunctions();
        this.reportFunctionIssues(fns);
        const items = this.sceneItems(fns);
        this.planEntrances(items); // 6.0 entrances

        this.drawPixels(svg, items); // 6.0 E
        this.liveOn = !!this.live && items.some((i) => !!i.live && i.live.length > 0); // 6.0 F4
        this.dark = typeof activeDocument !== 'undefined' && !!activeDocument.body && activeDocument.body.hasClass('theme-dark'); // 6.0 F4
        this.drawGrid(svg);
        this.drawFills(svg, items);
        // 6.1: the clean look's axes and numbers. 6.2: `no axes` draws none of them.
        if (this.config.showAxis !== false) {
            if (this.clean) this.drawCleanAxes(svg, fns, items);
            else this.drawAxes(svg);
        }
        const curves: DrawnCurve[] = [];
        const legend = this.drawCurves(svg, fns, curves);
        this.drawn = { items, curves };
        this.drawStrokes(svg, items);
        this.drawLive(svg, items); // 6.0 F4
        this.drawMarks(svg, items);
        this.drawFrontStrokes(svg, items); // 6.2.1
        this.drawBraces(svg, items);
        this.drawTexts(svg, items);
        this.drawAnnotations(svg, items);
        this.drawLegend(svg, legend);
        this.drawTitle(svg);
        this.mathSettled = this.usedMath ? flushMathRenders() : null;
        // 6.2.1: a label that fell back because MathJax was not loaded yet: load it, then draw again.
        if (this.mathFailed) {
            const flushed = this.mathSettled;
            this.mathSettled = ensureMathJax().then(async (loaded) => loaded || (flushed ? await flushed : false));
        }
        return svg;
    }

    // ------------------------------------------------------------ layout

    /** viewBox units per pt: the canvas spans the paper width (it has the paper's aspect). */
    private textScale(): number {
        if (this.compact) return 1;
        const paperCm = Number(this.config.paperWidthCm);
        const paperPt = (Number.isFinite(paperCm) && paperCm > 0 ? paperCm : 10) * PT_PER_CM;
        return clamp(this.width / paperPt, MIN_PT_PX, MAX_PT_PX);
    }

    /** Font size in viewBox units for a size in pt. */
    private fontPx(pt: number): number {
        return pt * this.ptPx;
    }

    /** 6.1: tick numbers in pt: small in the clean look. */
    private tickPt(): number {
        return this.clean ? CLEAN_TICK_PT : TICK_PT;
    }

    /** Estimated width of a line of label text (MathJax and plain text alike), in viewBox units. */
    private textWidth(text: string, fs: number): number {
        const plain = labelDisplayText(String(text ?? ''), stripLatex);
        return plain.length * fs * CHAR_WIDTH_EM;
    }

    /** True when an axis label will be drawn. */
    private hasAxisLabel(text: string | undefined): boolean {
        return !!this.config.showAxisLabels && !this.compact && !!String(text ?? '').trim();
    }

    /**
     * Room around the plot for ticks, tick labels, axis labels and the title,
     * from the text sizes. Box and L axes put the labels below and left;
     * middle axes put them beyond the arrow tips (right and above), as the
     * export does.
     */
    private padding(): [Padding, number] {
        if (this.compact) return [{ top: COMPACT_PADDING, right: COMPACT_PADDING, bottom: COMPACT_PADDING, left: COMPACT_PADDING }, 0];
        if (this.clean) return this.cleanPadding(); // 6.1
        const cfg = this.config;
        const tickFs = this.fontPx(TICK_PT);
        const axisFs = this.fontPx(AXIS_LABEL_PT);
        const pt = (n: number) => n * this.ptPx;
        const yt = this.ticks('y').ticks;
        const xt = this.ticks('x').ticks;
        const yTickW = yt.reduce((m, k) => Math.max(m, tickText(k).length * tickFs * CHAR_WIDTH_EM), 0);
        const lastX = xt.length ? tickText(xt[xt.length - 1]).length * tickFs * CHAR_WIDTH_EM : 0;
        const titleH = String(cfg.title ?? '').trim() ? this.fontPx(TITLE_PT) * 1.25 : 0;
        const title = titleH ? titleH + pt(TITLE_GAP_PT) : 0;
        const middle = cfg.axisStyle === 'middle';
        const p: Padding = middle
            ? {
                  left: TICK_LEN + pt(TICK_GAP_PT) + yTickW + pt(EDGE_PT),
                  bottom: TICK_LEN + pt(TICK_GAP_PT) + tickFs * 1.1 + pt(EDGE_PT),
                  right: Math.max(
                      lastX / 2 + pt(EDGE_PT),
                      this.hasAxisLabel(cfg.xLabel) ? pt(LABEL_GAP_PT) + this.textWidth(String(cfg.xLabel), axisFs) + pt(EDGE_PT) : pt(EDGE_PT) + 4
                  ),
                  top:
                      (this.hasAxisLabel(cfg.yLabel) ? pt(LABEL_GAP_PT) + axisFs * 1.2 : tickFs * 0.6) + pt(EDGE_PT) + title,
              }
            : {
                  left: TICK_LEN + pt(TICK_GAP_PT) + yTickW + (this.hasAxisLabel(cfg.yLabel) ? pt(LABEL_GAP_PT) + axisFs * 1.2 : 0) + pt(EDGE_PT),
                  bottom: TICK_LEN + pt(TICK_GAP_PT) + tickFs * 1.1 + (this.hasAxisLabel(cfg.xLabel) ? pt(LABEL_GAP_PT) + axisFs * 1.2 : 0) + pt(EDGE_PT),
                  right: Math.max(lastX / 2, TICK_LEN) + pt(EDGE_PT),
                  top: tickFs * 0.6 + pt(EDGE_PT) + title,
              };
        // Very small canvases: shrink the paddings rather than the plot.
        const kx = Math.min(1, (MAX_PADDING_SHARE * this.width) / Math.max(1, p.left + p.right));
        const ky = Math.min(1, (MAX_PADDING_SHARE * this.height) / Math.max(1, p.top + p.bottom));
        return [{ left: p.left * kx, right: p.right * kx, top: p.top * ky, bottom: p.bottom * ky }, titleH * ky];
    }

    /** Plot rectangle inside the padding; letterboxed to equal units per axis when equalScale (always in polar). */
    private plotRect(): { x: number; y: number; w: number; h: number } {
        const pad = this.pad;
        let x = pad.left;
        let y = pad.top;
        let w = Math.max(1, this.width - pad.left - pad.right);
        let h = Math.max(1, this.height - pad.top - pad.bottom);
        if (this.config.equalScale || this.polar) {
            const v = this.view;
            const scale = Math.min(w / (v.xmax - v.xmin), h / (v.ymax - v.ymin));
            const ew = (v.xmax - v.xmin) * scale;
            const eh = (v.ymax - v.ymin) * scale;
            x += (w - ew) / 2;
            y += (h - eh) / 2;
            w = ew;
            h = eh;
        }
        return { x, y, w, h };
    }

    /**
     * 6.1: where the axis lines lie in the clean look: the x-axis (at y = 0)
     * and the y-axis (at x = 0), each through 0, or at the near edge of the
     * view when 0 is outside it. Axes on the edges lie at the low edges.
     */
    private cleanPlaces(): { x: AxisPlace; y: AxisPlace } {
        if (this.config.axisStyle === 'axes') return { x: 'low', y: 'low' };
        const v = this.view;
        return { x: axisPlace(v.ymin, v.ymax), y: axisPlace(v.xmin, v.xmax) };
    }

    /** 6.1: the gap between an axis line and its numbers in the clean look. */
    private cleanGap(): number {
        return TICK_GAP_PT * this.ptPx + 2;
    }

    /**
     * 6.1: room around the plot in the clean look. The grid runs to the
     * edges; only the numbers of an axis at an edge, numbers that would not
     * fit between an axis near an edge and that edge, the axis names beyond
     * the ends of the axes and the title take room.
     */
    private cleanPadding(): [Padding, number] {
        const cfg = this.config;
        const v = this.view;
        const tickFs = this.fontPx(CLEAN_TICK_PT);
        const axisFs = this.fontPx(AXIS_LABEL_PT);
        const pt = (n: number) => n * this.ptPx;
        const edge = pt(EDGE_PT);
        const gap = this.cleanGap();
        const yt = this.ticks('y').ticks;
        const xt = this.ticks('x').ticks;
        const yTickW = yt.reduce((m, k) => Math.max(m, tickText(k).length * tickFs * CHAR_WIDTH_EM), 0);
        const lastX = xt.length ? tickText(xt[xt.length - 1]).length * tickFs * CHAR_WIDTH_EM : 0;
        const firstX = xt.length ? tickText(xt[0]).length * tickFs * CHAR_WIDTH_EM : 0;
        const titleH = String(cfg.title ?? '').trim() ? this.fontPx(TITLE_PT) * 1.25 : 0;
        const title = titleH ? titleH + pt(TITLE_GAP_PT) : 0;
        const place = this.cleanPlaces();
        // Roughly the plot size (the paddings are not known yet).
        const estW = this.width * 0.92;
        const estH = this.height * 0.9;
        // Numbers at the ends of the axes fit inside the chart: half a number beyond each edge of the plot.
        const p: Padding = { top: tickFs * 0.6 + edge, right: lastX / 2 + edge, bottom: tickFs * 0.6 + edge, left: firstX / 2 + edge };
        const needX = gap + tickFs * 1.1;
        if (place.x === 'low') p.bottom = Math.max(p.bottom, needX + edge);
        else if (place.x === 'high') p.top = Math.max(p.top, needX + edge);
        else {
            const room = ((0 - v.ymin) / (v.ymax - v.ymin)) * estH;
            if (room < needX) p.bottom = Math.max(p.bottom, needX - room + edge);
        }
        const needY = gap + yTickW;
        if (place.y === 'low') p.left = Math.max(p.left, needY + edge);
        else if (place.y === 'high') p.right = Math.max(p.right, needY + edge);
        else {
            const room = ((0 - v.xmin) / (v.xmax - v.xmin)) * estW;
            if (room < needY) p.left = Math.max(p.left, needY - room + edge);
        }
        // Names: beyond the end of an axis through 0 (as the middle axes of Classic have them), beside the numbers of an axis at an edge.
        const nameH = pt(LABEL_GAP_PT) + axisFs * 1.2;
        if (this.hasAxisLabel(cfg.xLabel)) {
            if (place.x === 'zero') p.right = Math.max(p.right, pt(LABEL_GAP_PT) + this.textWidth(String(cfg.xLabel), axisFs) + edge);
            else if (place.x === 'low') p.bottom += nameH;
            else p.top += nameH;
        }
        if (this.hasAxisLabel(cfg.yLabel)) {
            if (place.y === 'zero') p.top = Math.max(p.top, nameH + edge);
            else if (place.y === 'low') p.left += nameH;
            else p.right += nameH;
        }
        p.top += title;
        const kx = Math.min(1, (MAX_PADDING_SHARE * this.width) / Math.max(1, p.left + p.right));
        const ky = Math.min(1, (MAX_PADDING_SHARE * this.height) / Math.max(1, p.top + p.bottom));
        return [{ left: p.left * kx, right: p.right * kx, top: p.top * ky, bottom: p.bottom * ky }, titleH * ky];
    }

    private sx(x: number): number {
        const v = this.view;
        return this.plot.x + ((x - v.xmin) / (v.xmax - v.xmin)) * this.plot.w;
    }

    private sy(y: number): number {
        const v = this.view;
        return this.plot.y + this.plot.h - ((y - v.ymin) / (v.ymax - v.ymin)) * this.plot.h;
    }

    /** Inside the view, widened by `slack` (a fraction of the view) plus a hair for rounding. */
    private inView(x: number, y: number, slack: number): boolean {
        const v = this.view;
        const ex = (v.xmax - v.xmin) * (slack + 1e-9);
        const ey = (v.ymax - v.ymin) * (slack + 1e-9);
        return x >= v.xmin - ex && x <= v.xmax + ex && y >= v.ymin - ey && y <= v.ymax + ey;
    }

    /** The ticks of an axis: Auto, Every, At or Off (src/ticks.ts), with this renderer's own steps for Auto. */
    private ticks(axis: 'x' | 'y'): AxisTicks {
        if (!this.axisTicksCache) {
            const v = this.view;
            const [sx, sy] = this.tickSteps();
            const numbers = this.config.numbers;
            const of = (src: string) => this.math.value(src);
            const auto = { mode: 'auto' as const, step: '', at: '' };
            this.axisTicksCache = {
                x: axisTicks(numbers ? numbers.x : auto, v.xmin, v.xmax, tickValues(v.xmin, v.xmax, sx), of),
                y: axisTicks(numbers ? numbers.y : auto, v.ymin, v.ymax, tickValues(v.ymin, v.ymax, sy), of),
            };
        }
        return this.axisTicksCache[axis];
    }

    /** Major tick steps for x and y (computed once, before the layout). */
    private tickSteps(): [number, number] {
        if (!this.steps) this.steps = this.computeTickSteps();
        return this.steps;
    }

    /**
     * Major tick steps from the 'Major divisions' target. Equal scale uses
     * one step on both axes, so ticks match the equal units. Steps grow
     * (1, 2, 5, 10, ...) until the tick labels, set at the PDF's size, have
     * room: pgfplots spaces its ticks out the same way.
     */
    private computeTickSteps(): [number, number] {
        const target = this.config.majorTickNum > 0 ? this.config.majorTickNum : DEFAULT_TARGET_TICKS_X;
        // Roughly the plot size; the paddings follow from these steps, so the exact plot is not known yet.
        return autoTickSteps(this.view, {
            target,
            equal: this.config.equalScale || this.polar,
            compact: this.compact,
            plotW: this.width * 0.85,
            plotH: this.height * 0.8,
            fs: this.fontPx(this.tickPt()), // 6.1: the clean look's numbers are smaller
            // 6.1: the clean look's y target follows the plot's shape, so a square chart gets square grid cells.
            yRatio: this.clean ? (this.height * 0.8) / (this.width * 0.85) : undefined,
        });
    }

    // ------------------------------------------------------- scene and issues

    /** Functions paired with the context's info for them (same list position). */
    private chartFunctions(): ChartFunction[] {
        const funcs = this.config.functions || [];
        const out: ChartFunction[] = [];
        for (const info of this.math.functions()) {
            const f = funcs[info.index];
            if (f) out.push({ info, f });
        }
        return out;
    }

    private addIssue(issue: SceneIssue): void {
        const dup = this.issues.some((i) => i.source === issue.source && i.field === issue.field && i.message === issue.message);
        if (!dup) this.issues.push(issue);
    }

    /** Compile and domain problems of every function, hidden ones included (they can still be referenced). */
    private reportFunctionIssues(fns: ChartFunction[]): void {
        for (const { info, f } of fns) {
            if (isBlank(f)) continue;
            if (info.error) {
                // Parametric functions have two bodies; point at y(t) when x(t) compiles on its own.
                const inY = info.kind === 'parametric' && this.math.validate(String(f.expression ?? ''), 'fn1', 'parametric').ok;
                this.addIssue({ source: info.name, field: inY ? 'expressionY' : 'expression', message: info.error, severity: 'error' });
            } else if (info.domainError) {
                this.addIssue({ source: info.name, field: 'domain', message: info.domainError, severity: 'error' });
            }
        }
    }

    /**
     * Run computeScene2D and return the items to draw. A throwing scene (it
     * never should) becomes one issue; the chart then draws the last good
     * scene of this chart, if any, minus items whose tool or function is gone.
     */
    private sceneItems(fns: ChartFunction[]): SceneItem2D[] {
        const cfg = this.config;
        this.movedFns = new Set(); // 6.0 D
        const tools = (cfg.tools || []).filter((t): t is Tool => !!t && typeof t === 'object');
        const decorated = fns.some(({ f }) => f.fill || f.tangent || f.extrema);
        if (!tools.length && !decorated) {
            // Nothing for the scene to do; drop derived values of deleted tools so labels stop showing them.
            this.math.setDerived({});
            return [];
        }
        let scene: Scene2D;
        let stale = false;
        try {
            scene = computeScene2D({
                functions: cfg.functions || [],
                tools,
                math: this.math,
                view: { ...this.view },
                grid: { ...this.grid },
                axisStyle: cfg.axisStyle || 'box',
                polar: this.polar,
                cache: this.cache,
                // The exported figure's sizes, so preview and PDF pick the same label sides.
                labelMetrics: labelMetricsFor(cfg.paperWidthCm ?? 10, cfg.paperHeightCm ?? 10),
                // Slope fields draw their segments the same length on screen (5.0).
                equalScale: !!cfg.equalScale,
                // Draft frames are the frames of a slider or drag gesture: labels hold their spots there.
                // The full frame that follows places them afresh, as the export does.
                keepLabels: this.quality === 'draft' && !!this.cache,
                // 6.0 C: the clock's time and the step shown (absent: the still frame).
                motion: cfg.motion,
                clean: this.clean, // 6.1
            });
            if (this.cache) lastGoodScene.set(this.cache, scene);
            this.movedFns = new Set(scene.movedFunctions ?? []); // 6.0 D
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.addIssue({ source: 'chart', message: msg('problems.scene.shapesFailed', { error: message }), severity: 'error' });
            const last = this.cache ? lastGoodScene.get(this.cache) : undefined;
            if (!last) return [];
            scene = last;
            stale = true;
        }
        if (!stale) for (const issue of scene.issues || []) this.addIssue(issue);

        const fnNames = new Set(fns.map(({ info }) => info.name));
        const hiddenFns = new Set(fns.filter(({ info }) => info.hidden).map(({ info }) => info.name));
        const toolsById = new Map<string, Tool>();
        for (const t of tools) toolsById.set(t.id, t);
        return (scene.items || []).filter((item) => {
            if (item.kind === 'function') return !hiddenFns.has(item.source) && (!stale || fnNames.has(item.source));
            const tool = toolsById.get(item.key);
            if (stale && !tool) return false;
            return !(tool && tool.hidden);
        });
    }

    // ------------------------------------------------------------ helpers

    /** Create an SVG element with the given tag and attributes. */
    private el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
        const e = createSvg(tag);
        for (const [k, v] of Object.entries(attrs)) {
            e.setAttribute(k, v);
        }
        return e;
    }

    private line(x1: number, y1: number, x2: number, y2: number, attrs: Record<string, string>): SVGLineElement {
        return this.el('line', { x1: num(x1), y1: num(y1), x2: num(x2), y2: num(y2), ...attrs });
    }

    /** A layer group; clipped layers are cut to the plot rectangle. */
    private layer(cls: string, clipped: boolean): SVGGElement {
        return this.el('g', clipped ? { class: cls, 'clip-path': `url(#${this.ids}clip)` } : { class: cls });
    }

    /** Append a layer group only when something was drawn into it. */
    private attach(svg: SVGElement, g: SVGElement): void {
        if (g.childNodes.length) svg.appendChild(g);
    }

    /**
     * Name the chart object (f, R1, P2, ...) behind the elements drawn into g
     * since child `from`, so a view can animate one object. Never exported.
     */
    private tag(g: SVGElement, from: number, name: string): void {
        const kids = g.children;
        for (let i = from; i < kids.length; i++) kids[i].setAttribute('data-etz-item', name);
    }

    /**
     * Stroke width in px for a thickness key; thinner on thumbnails. 6.1: an
     * empty thickness (a function that sets none) and 'semithick' are the
     * look's line: a little thicker in the clean look, thin in Classic.
     */
    private strokeWidth(thickness: string | undefined): number {
        const own = this.clean && (thickness === '' || thickness === 'semithick') ? CLEAN_LINE_PX : 0;
        const w = own || (thickness && THICKNESS_MAP[thickness]) || 1.5;
        return this.compact ? w * 0.6 : w;
    }

    /** 6.1: a function's polylines this render (sampled once, for the axes' numbers and the curve). */
    private linesOf(info: FunctionInfo): Pt[][] {
        let lines = this.sampled.get(info.index);
        if (!lines) {
            lines = this.sampleFunction(info);
            this.sampled.set(info.index, lines);
        }
        return lines;
    }

    /** Palette key -> preview colour ('black' follows the theme's text colour). */
    private css(color: string | undefined): string {
        if (!color) return TEXT_NORMAL;
        return COLOR_MAP[color] || themedColor(color, this.dark); // 6.0 F4: a time ramp colour in its dark-theme twin
    }

    /**
     * Arrowhead marker for a `color` line of stroke width `width` (one per
     * colour and width per render). The head is arrowLength(width) px long and
     * its tip lies half a head beyond the path's end vertex: callers pull the
     * line back by that much (arrowPath), so the tip lands on the end point and
     * the butt-capped line end stays hidden inside the head. auto-start-reverse
     * turns the same marker around for marker-start.
     */
    private arrow(color: string, width: number): string {
        const key = `${color}|${width}`;
        let ref = this.arrows.get(key);
        if (!ref) {
            const id = `${this.ids}arrow-${this.arrows.size + 1}`;
            const len = arrowLength(width);
            const marker = this.el('marker', {
                id,
                viewBox: '0 0 8 6',
                markerUnits: 'userSpaceOnUse',
                markerWidth: num(len),
                markerHeight: num(len * 0.75),
                refX: '4',
                refY: '3',
                orient: 'auto-start-reverse',
            });
            marker.appendChild(this.el('path', { d: 'M0,0 L8,3 L0,6 Z', fill: color }));
            if (this.defs) this.defs.appendChild(marker);
            ref = `url(#${id})`;
            this.arrows.set(key, ref);
        }
        return ref;
    }

    /**
     * Screen path through `pts` (math coordinates) with the arrowed ends
     * pulled back by half a head (see `arrow`). Legs too short to pull back
     * keep their end point; the tip then overshoots slightly.
     */
    private arrowPath(pts: Pt[], atStart: boolean, atEnd: boolean, width: number): string {
        const s = pts.map((p) => ({ x: this.sx(p.x), y: this.sy(p.y) }));
        const inset = arrowLength(width) / 2;
        const pull = (end: { x: number; y: number }, toward: { x: number; y: number }) => {
            const d = Math.hypot(toward.x - end.x, toward.y - end.y);
            if (d <= inset * 1.5) return;
            end.x += ((toward.x - end.x) / d) * inset;
            end.y += ((toward.y - end.y) / d) * inset;
        };
        if (atEnd && s.length >= 2) pull(s[s.length - 1], s[s.length - 2]);
        if (atStart && s.length >= 2) pull(s[0], s[1]);
        return s.map((p, i) => `${i ? 'L' : 'M'}${num(p.x)},${num(p.y)}`).join('');
    }

    /** `url(#...)` of a pattern tile in `color`, or null for solid fills. */
    private pattern(style: FillPattern | undefined, color: string): string | null {
        if (!style || style === 'solid' || !this.defs) return null;
        const tile = PATTERN_TILES[style];
        if (!tile) return null;
        const key = `${style}|${color}`;
        const known = this.patterns.get(key);
        if (known) return known;
        const id = `${this.ids}pattern-${this.patterns.size + 1}`;
        const pattern = this.el('pattern', { id, patternUnits: 'userSpaceOnUse', width: '8', height: '8' });
        for (const shape of tile) {
            pattern.appendChild(this.el(shape.tag, shape.tag === 'circle' ? { ...shape.attrs, fill: color } : { ...shape.attrs, stroke: color }));
        }
        this.defs.appendChild(pattern);
        const ref = `url(#${id})`;
        this.patterns.set(key, ref);
        return ref;
    }

    /** Path data through `pts` (math coordinates). */
    private pointsPath(pts: Pt[]): string {
        let d = '';
        for (let i = 0; i < pts.length; i++) {
            d += `${i ? 'L' : 'M'}${num(this.sx(pts[i].x))},${num(this.sy(pts[i].y))}`;
        }
        return d;
    }

    /** Closed sub-paths for even-odd filling; non-finite vertices are skipped. */
    private ringsPath(rings: Pt[][] | null | undefined): string {
        let d = '';
        for (const ring of rings || []) {
            const pts = (ring || []).filter(finitePt);
            if (pts.length >= 3) d += `${this.pointsPath(pts)}Z`;
        }
        return d;
    }

    /**
     * Draw `text` at (x, y) in viewBox units: real LaTeX via Obsidian's
     * MathJax when it is a single `$...$` or `\(...\)` expression; 6.2.1:
     * words and math in one line when it mixes them (the words in the text
     * font, the math from MathJax); else the text read the way the export
     * reads it (labelDisplayText: text as typed, LaTeX commands resolved,
     * math through the `stripLatex()` Unicode approximation), which is also
     * the fallback while MathJax is not loaded. MathJax output lives in a
     * `<foreignObject>`; its data-export-* attributes let the SVG / PNG copy
     * path swap it for a plain `<text>` (MathJax only renders inside the
     * app document). Returns null for blank text.
     */
    private drawLabel(parent: SVGElement, text: string, x: number, y: number, o: LabelOptions): DrawnLabel | null {
        if (!text || !text.trim()) return null;
        const fs = o.fontSize;
        // Baseline for <text>: 'above' puts the text's bottom at y, 'below' its top, 'middle' its centre.
        const baseline = o.vAnchor === 'above' ? y - 0.22 * fs : o.vAnchor === 'below' ? y + 0.78 * fs : y + 0.35 * fs;
        const mathSource = extractMathSource(text);
        const parts = mathSource === null ? labelParts(text, stripLatex) : null;
        if (mathSource !== null || parts) {
            try {
                const { el, width, height } = parts ? renderMixedLabel(parts, o.color, fs, o.weight) : renderMathLabel(mathSource ?? '', o.color, fs);
                this.usedMath = true;
                const w = Math.max(width, 1);
                const h = Math.max(height, 1);
                const fx = o.hAnchor === 'middle' ? x - w / 2 : o.hAnchor === 'end' ? x - w : x;
                const fy = o.vAnchor === 'above' ? y - h : o.vAnchor === 'below' ? y : y - h / 2;
                const fo = this.el('foreignObject', {
                    x: num(fx),
                    y: num(fy),
                    width: num(w),
                    height: num(h),
                    overflow: 'visible',
                    'pointer-events': 'all',
                    'data-export-text': text,
                    'data-export-x': num(x),
                    'data-export-y': num(baseline),
                    'data-export-anchor': o.hAnchor,
                    'data-export-fill': o.color,
                    'data-export-font-size': String(fs),
                });
                if (parts) {
                    // A copy writes the words and the math as one plain text, read as the fallback reads it.
                    fo.setAttribute('data-export-plain', labelDisplayText(text, stripLatex));
                    if (o.weight) fo.setAttribute('font-weight', o.weight);
                }
                // 6.2.1: a stroke cannot reach into HTML, so the halo of a math label is a ring of text
                // shadows in the colour under it: shaped like the glyphs, not a box.
                if (o.halo) {
                    const ink = o.haloInk ?? BACKGROUND;
                    el.setCssStyles({ textShadow: haloShadow(ink, HALO_EM * fs) });
                    // Copies draw the label as plain text with this stroke (svgExport).
                    fo.setAttribute('data-export-halo', ink);
                    fo.setAttribute('data-export-halo-width', num(2 * HALO_EM * fs));
                }
                fo.appendChild(el);
                for (const [k, v] of Object.entries(o.attrs || {})) fo.setAttribute(k, v);
                parent.appendChild(fo);
                return { el: fo, width: w, height: h, x0: fx, y0: fy };
            } catch {
                // MathJax rejected the source (unbalanced braces, unknown
                // environment, ...) or is not loaded yet (6.2.1: render()
                // loads it and asks for a redraw); fall through to the
                // plain-text path.
                this.mathFailed = true;
            }
        }
        const plain = labelDisplayText(text, stripLatex);
        if (!plain.trim()) return null;
        const attrs: Record<string, string> = {
            x: num(x),
            y: num(baseline),
            'text-anchor': o.hAnchor,
            fill: o.color,
            'font-size': String(fs),
            'font-family': 'var(--font-text)',
        };
        if (o.weight) attrs['font-weight'] = o.weight;
        if (o.halo) {
            attrs.stroke = o.haloInk ?? BACKGROUND; // 6.2.1: the colour under the text
            attrs['stroke-width'] = num(2 * HALO_EM * fs);
            attrs['stroke-linejoin'] = 'round';
            attrs['paint-order'] = 'stroke';
        }
        const t = this.el('text', { ...attrs, ...(o.attrs || {}) });
        t.textContent = plain;
        parent.appendChild(t);
        // 6.2.1: its real width where the theme's font can be measured (the legend box, keeping texts inside), else the estimate.
        const tw = measuredWidth(plain, fs, o.weight ?? null) ?? plain.length * fs * CHAR_WIDTH_EM;
        return { el: t, width: tw, height: fs * 1.2, x0: o.hAnchor === 'middle' ? x - tw / 2 : o.hAnchor === 'end' ? x - tw : x, y0: baseline - 0.95 * fs };
    }

    /**
     * Draw a text placed beside math point (x, y) per a TikZ-style anchor.
     * `offset` moves it further, in pt of the figure (x right, y up): the
     * label placer's shift for a text that has no room right beside its point.
     */
    private drawPlaced(
        parent: SVGElement,
        text: string,
        x: number,
        y: number,
        anchor: TextPrim['anchor'] | undefined,
        size: AnnotationSize | undefined,
        o: { color: string; halo: boolean; haloInk?: string; weight?: string; attrs?: Record<string, string>; offset?: Pt }
    ): DrawnLabel | null {
        const side = anchor && TEXT_ALIGN[anchor] ? anchor : 'center';
        const place = TEXT_ALIGN[side];
        const gap = TEXT_GAP_PT[side];
        const dx = gap.x + (o.offset ? o.offset.x : 0);
        const dy = gap.y + (o.offset ? o.offset.y : 0);
        // Screen y points down.
        return this.drawLabel(parent, text, this.sx(x) + dx * this.ptPx, this.sy(y) - dy * this.ptPx, {
            color: o.color,
            fontSize: this.fontPx(FONT_PT[size || 'normal'] || FONT_PT.normal),
            hAnchor: place.h,
            vAnchor: place.v,
            weight: o.weight,
            halo: o.halo,
            haloInk: o.haloInk,
            attrs: o.attrs,
        });
    }

    // ---------------------------------------------------- 6.0 entrances

    /** Screen distance of two math points: lines draw themselves at an even pace on screen. */
    private readonly screenMetric = (a: Pt, b: Pt): number => Math.hypot(this.sx(b.x) - this.sx(a.x), this.sy(b.y) - this.sy(a.y));

    /** Which items move in this frame and how (src/motion6/entrances.ts); nothing for the still picture. */
    private planEntrances(items: SceneItem2D[]): void {
        this.entering.clear();
        this.masks.clear();
        this.popCount = 0;
        const cfg = this.config;
        this.ent = StepEntrance.of(cfg.motion, cfg);
        if (!this.ent) return;
        const tools = new Map<string, Tool>();
        for (const t of cfg.tools || []) if (t && typeof t === 'object') tools.set(String(t.id), t);
        const plans: ItemEntrance[] = [];
        for (const item of items) {
            const tool = item.kind === 'tool' ? tools.get(item.key) ?? null : null;
            const obj = item.kind === 'function' ? (cfg.functions || [])[Number(item.key)] : tool;
            if (!this.ent.moves(obj)) continue;
            const plan: ItemEntrance = { kind: tool ? toolKind(tool) : 'draw', start: 0, first: this.popCount, tool };
            // A transform moves the plane instead (stepProgress); it only fades out with its step.
            if (plan.kind === 'none' && !this.ent.leaving) continue;
            this.popCount += (item.markers || []).length;
            this.entering.set(item, plan);
            plans.push(plan);
        }
        // Points start when their first point pops; everything else at once.
        for (const plan of plans) if (plan.kind === 'pop') plan.start = popDelay(plan.first, this.popCount);
    }

    /** How far marker `i` of the step has popped in. */
    private popOf(i: number): number {
        const ent = this.ent;
        if (!ent || ent.leaving) return 1;
        return ent.at('pop', popDelay(i, this.popCount));
    }

    /** The lines of a stroke of a moving item as far as they have come in: drawn along, grown from a point, or tail to tip. */
    private strokeShape(item: SceneItem2D, plan: ItemEntrance, s: StrokePrim): ((runs: Pt[][]) => Pt[][]) | undefined {
        const ent = this.ent;
        if (!ent || ent.leaving) return undefined;
        if (plan.kind === 'sweep' || plan.kind === 'ripple' || plan.kind === 'fade' || plan.kind === 'none') return undefined;
        if (!plan.tool) {
            // A function's tangent grows out of the point where it touches.
            const touch = (item.handles || []).find((h) => h.ref.part === 'tangent')?.point;
            const e = ent.at('grow', plan.start);
            return (runs) => runs.map((r) => this.grown(r, touch && finitePt(touch) ? nearestOn(r, touch) : middleOf(r), e));
        }
        if (plan.kind === 'grow') {
            // Eigenvector lines run through the origin from both sides: they grow out of their middle.
            const e = ent.at('grow', plan.start);
            return (runs) => runs.map((r) => this.grown(r, middleOf(r), e));
        }
        if (s.arrow || plan.kind === 'arrow') {
            const e = ent.at('arrow', plan.start);
            if (s.arrow === 'both') return (runs) => runs.map((r) => grownLine(r, middleOf(r), e));
            if (s.arrow === 'backward') return (runs) => runs.map((r) => partialLines([r.slice().reverse()], e, false, this.screenMetric)[0].reverse());
            return (runs) => partialLines(runs, e, false, this.screenMetric);
        }
        // Each line draws itself over the part of it the view shows (lines side by side at once).
        const e = ent.at('draw', plan.start);
        return (runs) => runs.flatMap((r) => partialLines(clipLines([r], this.seenBox()), e, true, this.screenMetric));
    }

    /** The view and a little around it: what a line that comes in is cut to. */
    private seenBox(): { xmin: number; xmax: number; ymin: number; ymax: number } {
        const v = this.view;
        const mx = (v.xmax - v.xmin) * 0.02;
        const my = (v.ymax - v.ymin) * 0.02;
        return { xmin: v.xmin - mx, xmax: v.xmax + mx, ymin: v.ymin - my, ymax: v.ymax + my };
    }

    /** A line grown `e` of the way out of `anchor`, to the edges of the view (a straight line through it is first cut to the view). */
    private grown(run: Pt[], anchor: Pt, e: number): Pt[] {
        if (run.length !== 2) return grownLine(run, anchor, e);
        const seen = clipSegment(run[0], run[1], this.seenBox());
        return grownLine(seen ?? run, anchor, e);
    }

    /**
     * The elements of a moving item (or a label) as far as they have come in:
     * `sweep` and `ripple` through a mask, `fade` and `rise` by their opacity
     * (a rise also from a little below). While the step leaves, every element
     * of it fades out instead.
     */
    private enterEls(els: Element[], item: SceneItem2D, kind: EntranceKind): void {
        const ent = this.ent;
        const plan = this.entering.get(item);
        if (!ent || !plan || !els.length) return;
        if (ent.leaving) {
            for (const el of els) fadeEl(el, ent.fade);
            return;
        }
        if (kind === 'sweep' || kind === 'ripple') {
            const url = this.maskOf(item, plan, kind);
            if (url) for (const el of els) el.setAttribute('mask', url);
        } else if (kind === 'fade') {
            const k = ent.at('fade', plan.start);
            for (const el of els) fadeEl(el, k);
        } else if (kind === 'rise') {
            this.riseEls(els, labelStart(plan.kind, plan.start));
        }
    }

    /** Labels that rise in, starting `delay` ms after their step (or fade out with it). */
    private riseEls(els: Element[], delay: number): void {
        const ent = this.ent;
        if (!ent) return;
        if (ent.leaving) {
            for (const el of els) fadeEl(el, ent.fade);
            return;
        }
        const { dy, opacity } = riseAt(ent.linear('rise', delay));
        for (const el of els) {
            fadeEl(el, opacity);
            if (dy > 0.01) {
                const before = el.getAttribute('transform');
                el.setAttribute('transform', `translate(0 ${num(dy)})${before ? ` ${before}` : ''}`);
            }
        }
    }

    /**
     * The mask of a sweep (a rectangle that grows over the item from left to
     * right; a set on the y-axis from the bottom up) or a ripple (a soft disc
     * that grows from the middle of the plot), one per item and kind.
     */
    private maskOf(item: SceneItem2D, plan: ItemEntrance, kind: 'sweep' | 'ripple'): string | null {
        const ent = this.ent;
        if (!ent || !this.defs) return null;
        const key = `${kind}|${plan.first}|${item.source}|${item.key}`;
        const known = this.masks.get(key);
        if (known) return known;
        const id = `${this.ids}enter-${this.masks.size + 1}`;
        const W = this.width;
        const H = this.height;
        const mask = this.el('mask', { id, maskUnits: 'userSpaceOnUse', x: '0', y: '0', width: num(W), height: num(H) });
        if (kind === 'ripple') {
            const { x, y, w, h } = this.plot;
            const gradient = this.el('radialGradient', { id: `${id}-g`, gradientUnits: 'userSpaceOnUse', cx: num(x + w / 2), cy: num(y + h / 2), r: num(Math.hypot(w, h) / 2) });
            for (const stop of rippleStops(ent.at('ripple', plan.start))) {
                gradient.appendChild(this.el('stop', { offset: num(stop.offset), 'stop-color': '#fff', 'stop-opacity': num(stop.opacity) }));
            }
            this.defs.appendChild(gradient);
            mask.appendChild(this.el('rect', { x: '0', y: '0', width: num(W), height: num(H), fill: `url(#${id}-g)` }));
        } else {
            const box = this.screenBox(item);
            const e = ent.at('sweep', plan.start);
            const up = !!plan.tool && plan.tool.type === 'axisSet' && plan.tool.axis === 'y';
            const rect = !box
                ? { x: 0, y: 0, width: W * e, height: H }
                : up
                  ? { x: 0, y: box.y1 - (box.y1 - box.y0) * e - 1, width: W, height: (box.y1 - box.y0) * e + 2 }
                  : { x: box.x0 - 1, y: 0, width: (box.x1 - box.x0) * e + 2, height: H };
            if (e > 0) mask.appendChild(this.el('rect', { x: num(rect.x), y: num(rect.y), width: num(Math.max(0, rect.width)), height: num(Math.max(0, rect.height)), fill: '#fff' }));
        }
        this.defs.appendChild(mask);
        const url = `url(#${id})`;
        this.masks.set(key, url);
        return url;
    }

    /** The screen box of an item's fills and lines (what a sweep goes over), within the plot. */
    private screenBox(item: SceneItem2D): { x0: number; x1: number; y0: number; y1: number } | null {
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        const add = (p: Pt) => {
            if (!finitePt(p)) return;
            const x = this.sx(p.x);
            const y = this.sy(p.y);
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
        };
        for (const f of item.fills || []) for (const ring of f.rings || []) for (const p of ring || []) add(p);
        for (const s of item.strokes || []) for (const line of s.lines || []) for (const p of line || []) add(p);
        for (const m of item.markers || []) add(m);
        if (!(x1 >= x0)) return null;
        const { x, y, w, h } = this.plot;
        return { x0: Math.max(x0, x), x1: Math.min(x1, x + w), y0: Math.max(y0, y), y1: Math.min(y1, y + h) };
    }

    // ------------------------------------------------------------ layers

    /**
     * Layer 1. Minor lines follow pgfplots' `minor tick num=n`: n lines between two major ticks.
     * Major lines take the chart's grid opacity, minor lines half of it.
     */
    private drawGrid(svg: SVGElement): void {
        const cfg = this.config;
        if (!cfg.gridMajor && !cfg.gridMinor) return;
        const g = this.el('g', { class: 'etz-grid' });
        const v = this.view;
        const { x: left, y: top, w, h } = this.plot;
        const xT = this.ticks('x');
        const yT = this.ticks('y');
        // 6.1: the clean look's grid is its own light ink, at the chart's opacity (0.5 by default: about #eceef3 on white).
        const opacity = opacityValue(cfg.gridOpacity, GRID_OPACITY) * (this.clean ? CLEAN_GRID_ALPHA : 1);
        const ink = this.clean ? CLEAN_VARS.grid : BORDER;
        const draw = (xs: number[], ys: number[], width: string, alpha: number) => {
            const attrs = { stroke: ink, 'stroke-width': width, 'stroke-opacity': String(alpha) };
            for (const x of xs) g.appendChild(this.line(this.sx(x), top, this.sx(x), top + h, attrs));
            for (const y of ys) g.appendChild(this.line(left, this.sy(y), left + w, this.sy(y), attrs));
        };
        const minor = Math.round(Number(cfg.minorTickNum));
        const [stepX, stepY] = this.tickSteps();
        // Minor lines: n between two major ones; for chosen values (At) only between them, as pgfplots does.
        const minorOf = (t: AxisTicks, lo: number, hi: number, auto: number): number[] => {
            if (t.mode !== 'at') return tickValues(lo, hi, (t.mode === 'every' && t.step ? t.step : auto) / (minor + 1));
            const out: number[] = [];
            for (let i = 0; i + 1 < t.grid.length; i++) {
                for (let k = 1; k <= minor; k++) out.push(t.grid[i] + ((t.grid[i + 1] - t.grid[i]) * k) / (minor + 1));
            }
            return out;
        };
        if (cfg.gridMinor && minor >= 1) draw(minorOf(xT, v.xmin, v.xmax, stepX), minorOf(yT, v.ymin, v.ymax, stepY), '0.5', opacity / 2);
        draw(xT.grid, yT.grid, '1', opacity);
        this.attach(svg, g);
    }

    /** 6.0 E: pictures over the plot (a coloured plane, a bifurcation diagram), under the grid (src/iterate/paint.ts). */
    private drawPixels(svg: SVGElement, items: SceneItem2D[]): void {
        const rect = this.plot;
        for (const item of items) {
            for (const prim of item.pixels ?? []) {
                // 6.0 ML: the still picture of a frame(t) is hidden (and not painted) while the live canvas draws the moving one.
                const hidden = !!prim.still && this.liveOn;
                const fo = pixelLayer(prim, { ...this.view }, rect, this.quality === 'draft', hidden);
                fo.setAttribute('data-etz-item', item.source);
                if (hidden) for (const [k, v] of Object.entries(this.stillAttrs(prim, {}))) fo.setAttribute(k, k === 'class' ? `etz-pixels ${v}` : v);
                svg.appendChild(fo);
                this.enterEls([fo], item, 'ripple'); // 6.0 entrances
            }
        }
    }

    /**
     * 6.0 F4: the live canvas over the lines, under the markers and labels:
     * what moves on the clock, painted at the frame's time now and by the
     * host on every frame of the clock.
     */
    private drawLive(svg: SVGElement, items: SceneItem2D[]): void {
        if (!this.live) return;
        const v = this.view;
        const bx = this.plot.w / (v.xmax - v.xmin);
        const by = -this.plot.h / (v.ymax - v.ymin);
        const fo = this.live.mount(
            this.liveOn ? items : [],
            {
                rect: { ...this.plot },
                ax: this.plot.x - v.xmin * bx,
                bx,
                ay: this.plot.y + this.plot.h - v.ymin * by,
                by,
                view: { ...v },
                width: (w) => this.strokeWidth(w),
                radius: (size) => (MARKER_RADIUS[size] || MARKER_RADIUS.normal) * (this.compact ? 0.6 : 1),
                css: (c) => this.css(c),
                // 6.0 ML: dots with matplotlib's radius, and texts at the sizes of the chart's texts.
                pointRadius: (pt) => Math.max(0.3, pt * (MARKER_RADIUS.normal / MATPLOTLIB_NORMAL_PT) * (this.compact ? 0.6 : 1)),
                fontSize: (size) => this.fontPx(FONT_PT[size] || FONT_PT.normal),
            },
            this.config.motion?.time ?? 0
        );
        if (fo) svg.appendChild(fo);
    }

    /** 6.0 F4: a part of the still frame of something the live canvas draws: hidden here (exportableSvg shows it). */
    private stillAttrs(prim: { still?: boolean }, attrs: Record<string, string>): Record<string, string> {
        if (prim.still && this.liveOn) {
            attrs.display = 'none';
            attrs.class = 'etz-still';
        }
        return attrs;
    }

    /** Layer 2: function fills and region fills in item order; patterns over the tint like the export. */
    private drawFills(svg: SVGElement, items: SceneItem2D[]): void {
        const g = this.layer('etz-fills', true);
        for (const item of items) {
            const from = g.children.length;
            for (const fill of item.fills || []) this.drawFill(g, fill);
            this.tag(g, from, item.source);
            // 6.0 entrances: a fill sweeps in (a span or a coloured plane ripples).
            const plan = this.entering.get(item);
            if (plan) this.enterEls(kidsFrom(g, from), item, plan.kind === 'ripple' ? 'ripple' : 'sweep');
        }
        this.attach(svg, g);
    }

    private drawFill(g: SVGElement, fill: FillPrim): void {
        const d = this.ringsPath(fill.rings);
        if (!d) return;
        const color = this.css(fill.color);
        const opacity = Number.isFinite(fill.opacity) ? clamp(fill.opacity, 0, 1) : 0.25;
        g.appendChild(this.el('path', this.stillAttrs(fill, { d, fill: color, 'fill-opacity': String(opacity), 'fill-rule': 'evenodd', stroke: 'none' }))); // 6.0 F4: stillAttrs
        const pattern = this.pattern(fill.pattern, color);
        if (pattern) g.appendChild(this.el('path', { d, fill: pattern, 'fill-rule': 'evenodd', stroke: 'none' }));
    }

    /** Layer 3: axis lines, ticks, tick labels and axis titles. */
    private drawAxes(svg: SVGElement): void {
        const cfg = this.config;
        const g = this.el('g', { class: 'etz-axes' });
        const { x: left, y: top, w, h } = this.plot;
        const right = left + w;
        const bottom = top + h;
        const [stepX, stepY] = this.tickSteps();
        const xT = this.ticks('x');
        const yT = this.ticks('y');
        const xs = this.compact ? [] : xT.ticks;
        const ys = this.compact ? [] : yT.ticks;
        const tickAttrs = { stroke: TEXT_MUTED, 'stroke-width': '1' };
        const axisWidth = this.compact ? 1 : 1.5;
        const axisAttrs = { stroke: TEXT_MUTED, 'stroke-width': String(axisWidth) };
        const tickFs = this.fontPx(TICK_PT);
        const tickGap = TICK_GAP_PT * this.ptPx;
        // Axes through the origin, pinned to the plot edge when 0 is outside the view.
        const ox = clamp(this.sx(0), left, right);
        const oy = clamp(this.sy(0), top, bottom);
        // Axis line from (x1, y1) to an arrowhead at (x2, y2) (no heads on thumbnails).
        const axisLine = (x1: number, y1: number, x2: number, y2: number) => {
            if (this.compact) {
                g.appendChild(this.line(x1, y1, x2, y2, axisAttrs));
                return;
            }
            const d = Math.hypot(x2 - x1, y2 - y1) || 1;
            const inset = arrowLength(axisWidth) / 2;
            const ex = x2 - ((x2 - x1) / d) * inset;
            const ey = y2 - ((y2 - y1) / d) * inset;
            g.appendChild(this.line(x1, y1, ex, ey, { ...axisAttrs, 'marker-end': this.arrow(TEXT_MUTED, axisWidth) }));
        };
        const tick = (x1: number, y1: number, x2: number, y2: number) => g.appendChild(this.line(x1, y1, x2, y2, tickAttrs));
        // x tick labels hang below (x, y); y tick labels end at (x, y), centred on it.
        const xTickLabel = (k: Tick, x: number, y: number) => this.tickLabel(g, tickText(k), x, y + 0.78 * tickFs, 'middle', tickFs);
        const yTickLabel = (k: Tick, x: number, y: number) => this.tickLabel(g, tickText(k), x, y + 0.35 * tickFs, 'end', tickFs);
        // At the origin of middle axes the axes cross: no 0 there, unless the chart lists it (At).
        const atOrigin = (k: Tick, step: number, t: AxisTicks) => t.mode !== 'at' && Math.abs(k.value) < step * 0.01;

        if (cfg.axisStyle === 'middle') {
            axisLine(left, oy, right, oy);
            axisLine(ox, bottom, ox, top);
            for (const x of xs) {
                if (atOrigin(x, stepX, xT)) continue;
                const px = this.sx(x.value);
                if (xT.marks) tick(px, oy - 4, px, oy + 4);
                xTickLabel(x, px, oy + 4 + tickGap);
            }
            for (const y of ys) {
                if (atOrigin(y, stepY, yT)) continue;
                const py = this.sy(y.value);
                if (yT.marks) tick(ox - 4, py, ox + 4, py);
                yTickLabel(y, ox - 4 - tickGap, py);
            }
        } else if (cfg.axisStyle === 'axes') {
            // L-shaped axes along the lower-left corner of the plot, with arrowheads.
            axisLine(left, bottom, right, bottom);
            axisLine(left, bottom, left, top);
            for (const x of xs) {
                const px = this.sx(x.value);
                tick(px, bottom, px, bottom + TICK_LEN);
                xTickLabel(x, px, bottom + TICK_LEN + tickGap);
            }
            for (const y of ys) {
                const py = this.sy(y.value);
                tick(left - TICK_LEN, py, left, py);
                yTickLabel(y, left - TICK_LEN - tickGap, py);
            }
        } else {
            // Box: four explicit border lines in the full-contrast text colour,
            // so the frame reads clearly in light and dark themes. Ticks are
            // mirrored on the top and right bars.
            const border = { stroke: TEXT_NORMAL, 'stroke-width': this.compact ? '1' : '2', 'stroke-linecap': 'square' };
            g.appendChild(this.line(left, bottom, right, bottom, border));
            g.appendChild(this.line(left, top, right, top, border));
            g.appendChild(this.line(left, top, left, bottom, border));
            g.appendChild(this.line(right, top, right, bottom, border));
            for (const x of xs) {
                const px = this.sx(x.value);
                tick(px, bottom, px, bottom + TICK_LEN);
                tick(px, top - TICK_LEN, px, top);
                xTickLabel(x, px, bottom + TICK_LEN + tickGap);
            }
            for (const y of ys) {
                const py = this.sy(y.value);
                tick(left - TICK_LEN, py, left, py);
                tick(right, py, right + TICK_LEN, py);
                yTickLabel(y, left - TICK_LEN - tickGap, py);
            }
        }

        if (!this.compact && cfg.showAxisLabels) {
            const axisFs = this.fontPx(AXIS_LABEL_PT);
            const gap = LABEL_GAP_PT * this.ptPx;
            // 6.0 ML: each axis name says which it is, so the live canvas can write a script's frame(t) xlabel and ylabel into it.
            const label = (hAnchor: HAnchor, vAnchor: VAnchor, axis?: 'x' | 'y'): LabelOptions => ({ color: TEXT_NORMAL, fontSize: axisFs, hAnchor, vAnchor, weight: '500', attrs: axis ? { 'data-etz-axis-name': axis } : undefined });
            if (cfg.axisStyle === 'middle') {
                // Beyond the arrow tips, unrotated, like the export (xlabel anchor=west, ylabel anchor=south).
                this.drawLabel(g, String(cfg.xLabel ?? ''), right + gap, oy, label('start', 'middle', 'x'));
                this.drawLabel(g, String(cfg.yLabel ?? ''), ox, top - gap, label('middle', 'above', 'y'));
            } else {
                const yTickW = yT.ticks.reduce((m, k) => Math.max(m, tickText(k).length * tickFs * CHAR_WIDTH_EM), 0);
                this.drawLabel(g, String(cfg.xLabel ?? ''), left + w / 2, bottom + TICK_LEN + tickGap + tickFs * 1.1 + gap, label('middle', 'below', 'x'));
                const cx = Math.max(axisFs * 0.6, left - TICK_LEN - tickGap - yTickW - gap - axisFs * 0.6);
                const cy = top + h / 2;
                const rotated = this.el('g', { transform: `rotate(-90, ${num(cx)}, ${num(cy)})` });
                this.drawLabel(rotated, String(cfg.yLabel ?? ''), cx, cy, label('middle', 'middle', 'y'));
                this.attach(g, rotated);
            }
        }
        svg.appendChild(g);
    }

    /**
     * 6.1: a soft pill behind the label drawn at child `at` of g: the
     * background colour, a thin line, fully rounded (the film's value labels).
     */
    private pillBehind(g: SVGElement, at: number, label: DrawnLabel, fs: number): void {
        const padX = 0.45 * fs;
        const padY = 0.2 * fs;
        const h = label.height + 2 * padY;
        // A plain text: its real width (the estimate is for layout only), about its anchor.
        let x0 = label.x0;
        let width = label.width;
        if (label.el.tagName.toLowerCase() === 'text') {
            const real = measuredWidth(label.el.textContent ?? '', fs, label.el.getAttribute('font-weight'));
            if (real !== null) {
                const anchor = label.el.getAttribute('text-anchor');
                const ax = anchor === 'middle' ? x0 + width / 2 : anchor === 'end' ? x0 + width : x0;
                x0 = anchor === 'middle' ? ax - real / 2 : anchor === 'end' ? ax - real : ax;
                width = real;
            }
        }
        const rect = this.el('rect', {
            x: num(x0 - padX),
            y: num(label.y0 - padY),
            width: num(width + 2 * padX),
            height: num(h),
            rx: num(h / 2),
            fill: BACKGROUND,
            stroke: CLEAN_VARS.pillLine,
            'stroke-width': '1',
            class: 'etz-pill',
        });
        const first = g.children[at];
        if (first) g.insertBefore(rect, first);
        else g.appendChild(rect);
    }

    /**
     * 6.1: what the axes' numbers keep clear of in the clean look: the
     * marked points and the drawn function curves, in viewBox units.
     */
    private tickObstacles(fns: ChartFunction[], items: SceneItem2D[]): TickObstacles {
        const dots: TickObstacles['dots'] = [];
        for (const item of items) {
            for (const m of item.markers || []) {
                if (!finitePt(m) || !this.inView(m.x, m.y, 0)) continue;
                // 6.2.1: with the half of its 2 px rim that lies outside the dot.
                dots.push({ x: this.sx(m.x), y: this.sy(m.y), r: (CLEAN_MARKER_RADIUS[m.size] || CLEAN_MARKER_RADIUS.normal) + 1 });
            }
        }
        const lines: TickObstacles['lines'] = [];
        for (const { info, f } of fns) {
            if (info.hidden || info.error || info.domainError || isBlank(f) || this.movedFns.has(info.index)) continue;
            for (const run of this.linesOf(info)) lines.push(run.map((p) => ({ x: this.sx(p.x), y: this.sy(p.y) })));
        }
        return { dots, lines };
    }

    /**
     * 6.1, layer 3 in the clean look: thin light axis lines without
     * arrowheads (at the near edge where 0 is outside the view), no tick
     * marks, small grey numbers without the 0 where the axes cross, left out
     * where they would sit on a marked point or a curve or run off the
     * chart, and the axes' names (only names the chart gives) beyond their ends.
     */
    private drawCleanAxes(svg: SVGElement, fns: ChartFunction[], items: SceneItem2D[]): void {
        const cfg = this.config;
        const g = this.el('g', { class: 'etz-axes' });
        const { x: left, y: top, w, h } = this.plot;
        const right = left + w;
        const bottom = top + h;
        const place = this.cleanPlaces();
        const oy = place.x === 'low' ? bottom : place.x === 'high' ? top : this.sy(0);
        const ox = place.y === 'low' ? left : place.y === 'high' ? right : this.sx(0);
        const axisAttrs = { stroke: CLEAN_VARS.axis, 'stroke-width': num(this.compact ? 1 : CLEAN_AXIS_PX) };
        g.appendChild(this.line(left, oy, right, oy, axisAttrs));
        g.appendChild(this.line(ox, top, ox, bottom, axisAttrs));
        if (!this.compact) {
            const [stepX, stepY] = this.tickSteps();
            const xT = this.ticks('x');
            const yT = this.ticks('y');
            const fs = this.fontPx(CLEAN_TICK_PT);
            const frame: CleanAxisFrame = { sx: (v) => this.sx(v), sy: (v) => this.sy(v), ox, oy, place, fs, gap: this.cleanGap(), charEm: CHAR_WIDTH_EM };
            const obstacles = this.tickObstacles(fns, items);
            const inCanvas = (b: { x0: number; x1: number; y0: number; y1: number }) => b.x0 >= 0.5 && b.x1 <= this.width - 0.5 && b.y0 >= 0.5 && b.y1 <= this.height - 0.5;
            for (const [axis, t, step] of [['x', xT, stepX], ['y', yT, stepY]] as const) {
                for (const spot of cleanTickSpots(axis, t.ticks, tickText, { step, listed: t.mode === 'at', frame, obstacles })) {
                    if (spot.show && inCanvas(spot.box)) this.tickLabel(g, spot.text, spot.x, spot.y, spot.anchor, fs, CLEAN_VARS.tick);
                }
            }
            if (cfg.showAxisLabels) {
                const axisFs = this.fontPx(AXIS_LABEL_PT);
                const lgap = LABEL_GAP_PT * this.ptPx;
                const gap = this.cleanGap();
                const label = (hAnchor: HAnchor, vAnchor: VAnchor, axis: 'x' | 'y'): LabelOptions => ({ color: TEXT_NORMAL, fontSize: axisFs, hAnchor, vAnchor, weight: '500', attrs: { 'data-etz-axis-name': axis } });
                const xName = String(cfg.xLabel ?? '');
                const yName = String(cfg.yLabel ?? '');
                // An axis through 0: its name beyond its end. An axis at an edge: its name beside its numbers, as in a box.
                if (place.x === 'zero') this.drawLabel(g, xName, right + lgap, oy, label('start', 'middle', 'x'));
                else if (place.x === 'low') this.drawLabel(g, xName, left + w / 2, bottom + gap + fs * 1.1 + lgap, label('middle', 'below', 'x'));
                else this.drawLabel(g, xName, left + w / 2, top - gap - fs * 1.1 - lgap, label('middle', 'above', 'x'));
                if (place.y === 'zero') this.drawLabel(g, yName, ox, top - lgap, label('middle', 'above', 'y'));
                else if (yName.trim()) {
                    const yTickW = yT.ticks.reduce((m, k) => Math.max(m, tickText(k).length * fs * CHAR_WIDTH_EM), 0);
                    const reach = gap + yTickW + lgap + axisFs * 0.6;
                    const cx = place.y === 'low' ? Math.max(axisFs * 0.6, left - reach) : Math.min(this.width - axisFs * 0.6, right + reach);
                    const cy = top + h / 2;
                    const rotated = this.el('g', { transform: `rotate(-90, ${num(cx)}, ${num(cy)})` });
                    this.drawLabel(rotated, yName, cx, cy, label('middle', 'middle', 'y'));
                    this.attach(g, rotated);
                }
            }
        }
        svg.appendChild(g);
    }

    /** One tick label with its baseline at (x, y); `fill`: 6.1, the clean look's grey. */
    private tickLabel(g: SVGElement, text: string, x: number, y: number, anchor: HAnchor, fs: number, fill = TEXT_MUTED): void {
        const t = this.el('text', {
            x: num(x),
            y: num(y),
            'text-anchor': anchor,
            fill,
            'font-size': num(fs),
            'font-family': 'var(--font-text)',
        });
        t.textContent = text;
        g.appendChild(t);
    }

    /**
     * Layer 4: visible functions (hidden, broken and blank ones are skipped).
     * Returns the legend entries; the sampled polylines go to `drawn`.
     */
    private drawCurves(svg: SVGElement, fns: ChartFunction[], drawn: DrawnCurve[]): LegendEntry[] {
        const g = this.layer('etz-curves', true);
        const legend: LegendEntry[] = [];
        for (const { info, f } of fns) {
            if (info.hidden || info.error || info.domainError || isBlank(f)) continue;
            if (this.movedFns.has(info.index)) {
                // 6.0 D: a transform draws it. 6.0 F1: its legend entry stays.
                if (f.showLegend) legend.push({ color: this.css(f.color), width: this.strokeWidth(f.thickness), dashed: !!f.dashed, label: this.legendLabel(info, f) });
                continue;
            }
            const color = this.css(f.color);
            const width = this.strokeWidth(f.thickness);
            const lines = this.linesOf(info); // 6.1: sampled once per render
            if (lines.length) {
                drawn.push({ name: info.name, index: info.index, kind: info.kind, lines });
                // 6.0 entrances: a function that comes in draws itself, its pieces left to right.
                const ent = this.ent && this.ent.moves(f) ? this.ent : null;
                const shown = ent && !ent.leaving ? partialLines(clipLines(lines, this.seenBox()), ent.at('draw'), true, this.screenMetric) : lines;
                const attrs: Record<string, string> = {
                    d: shown.map((l) => this.pointsPath(l)).join(''),
                    fill: 'none',
                    stroke: color,
                    'stroke-width': String(width),
                    'stroke-linejoin': 'round',
                    'stroke-linecap': 'round',
                };
                if (f.dashed) attrs['stroke-dasharray'] = '6 4';
                attrs['data-etz-item'] = info.name;
                if (ent && ent.leaving) attrs.opacity = num(ent.fade);
                g.appendChild(this.el('path', attrs));
            }
            if (f.showLegend) legend.push({ color, width, dashed: !!f.dashed, label: this.legendLabel(info, f) });
        }
        this.attach(svg, g);
        return legend;
    }

    /**
     * Polylines of one function in math coordinates. Cartesian: the domain
     * (empty = the visible x range) intersected with the view; parametric and
     * polar: the domain or 0..2pi.
     */
    private sampleFunction(info: FunctionInfo): Pt[][] {
        const v = this.view;
        const fn = info.fn;
        if (info.kind === 'cartesian') {
            const d = info.domain;
            const lo = d ? Math.max(d[0], v.xmin) : v.xmin;
            const hi = d ? Math.min(d[1], v.xmax) : v.xmax;
            return sampleCurve((x) => ({ x, y: fn(x) }), lo, hi, SAMPLES_PER_FUNCTION, v);
        }
        const [lo, hi] = info.domain || [0, 2 * Math.PI];
        if (info.kind === 'parametric') {
            const fy = info.fnY;
            if (!fy) return [];
            return sampleCurve((t) => ({ x: fn(t), y: fy(t) }), lo, hi, SAMPLES_PER_FUNCTION, v);
        }
        return sampleCurve(
            (theta) => {
                const r = fn(theta);
                return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
            },
            lo,
            hi,
            SAMPLES_PER_FUNCTION,
            v
        );
    }

    /** Custom legend text, else the expression typeset like the export's `\( tex(expr) \)`. */
    private legendLabel(info: FunctionInfo, f: FunctionParameters): string {
        const custom = String(f.legendLabel ?? '').trim();
        if (custom) return custom;
        const tex = (src: string | undefined) => this.math.tex(String(src ?? ''));
        if (info.kind === 'parametric') return `$\\left(${tex(f.expression)},\\ ${tex(f.expressionY)}\\right)$`;
        if (info.kind === 'polar') return `$r = ${tex(f.expression)}$`;
        return `$${tex(f.expression)}$`;
    }

    /** Layer 5: curves, segments, outlines, constraint lines, tangents. */
    private drawStrokes(svg: SVGElement, items: SceneItem2D[]): void {
        const g = this.layer('etz-strokes', true);
        for (const item of items) {
            const from = g.children.length;
            const plan = this.entering.get(item);
            for (const s of item.strokes || []) if (!s.front) this.drawStroke(g, s, false, plan ? this.strokeShape(item, plan, s) : undefined);
            this.tag(g, from, item.source);
            // 6.0 entrances: lines of a region or a set sweep with their fill, a field's or a grid's ripple, a brace fades.
            if (plan) this.enterEls(kidsFrom(g, from), item, plan.kind === 'sweep' || plan.kind === 'ripple' || plan.kind === 'fade' ? plan.kind : 'none');
        }
        this.attach(svg, g);
    }

    /** 6.2.1: lines and arrows that go over the markers (a script's arrow over its scatter dots), right after them. */
    private drawFrontStrokes(svg: SVGElement, items: SceneItem2D[]): void {
        const g = this.layer('etz-front', true);
        for (const item of items) {
            const from = g.children.length;
            const plan = this.entering.get(item);
            for (const s of item.strokes || []) if (s.front) this.drawStroke(g, s, false, plan ? this.strokeShape(item, plan, s) : undefined);
            this.tag(g, from, item.source);
            if (plan) this.enterEls(kidsFrom(g, from), item, plan.kind === 'sweep' || plan.kind === 'ripple' || plan.kind === 'fade' ? plan.kind : 'none');
        }
        this.attach(svg, g);
    }

    /** One stroke primitive; guides are always dashed 1 px at 60 % opacity. `shape`: 6.0 entrances, the lines as far as they have come in. */
    private drawStroke(g: SVGElement, s: StrokePrim, guide: boolean, shape?: (runs: Pt[][]) => Pt[][]): void {
        const color = this.css(s.color);
        const arrow = guide ? undefined : s.arrow;
        const attrs: Record<string, string> = guide
            ? { fill: 'none', stroke: color, 'stroke-width': '1', 'stroke-dasharray': '4 3', 'stroke-opacity': '0.6' }
            : {
                  fill: 'none',
                  stroke: color,
                  'stroke-width': String(this.strokeWidth(s.width)),
                  'stroke-linejoin': 'round',
                  'stroke-linecap': arrow ? 'butt' : 'round',
              };
        if (!guide && s.dashed) attrs['stroke-dasharray'] = '6 4';
        // 6.0 C: faded lines (the trails of moving particles).
        if (!guide && typeof s.opacity === 'number' && s.opacity >= 0 && s.opacity < 1) attrs['stroke-opacity'] = String(s.opacity);
        if (!guide) this.stillAttrs(s, attrs); // 6.0 F4
        let runs: Pt[][] = [];
        for (const line of s.lines || []) runs.push(...finiteRuns(line));
        if (!runs.length) return;
        // 6.0 entrances: nothing yet of a line that has not started to come in.
        if (shape) runs = shape(runs).filter((r) => r.length >= 2);
        if (!runs.length) return;
        const close = s.closed ? 'Z' : '';
        if (!arrow) {
            g.appendChild(this.el('path', { ...attrs, d: runs.map((r) => this.pointsPath(r) + close).join('') }));
            return;
        }
        // Markers sit on a path's first and last vertex, so every leg gets its own path.
        const width = this.strokeWidth(s.width);
        const head = this.arrow(color, width);
        const atEnd = arrow === 'forward' || arrow === 'both';
        const atStart = arrow === 'backward' || arrow === 'both';
        for (const run of runs) {
            const legAttrs: Record<string, string> = { ...attrs, d: this.arrowPath(run, atStart, atEnd, width) + close };
            if (atEnd) legAttrs['marker-end'] = head;
            if (atStart) legAttrs['marker-start'] = head;
            g.appendChild(this.el('path', legAttrs));
        }
    }

    /**
     * Layer 6: guides (clipped), then markers. Markers are not clipped, so a
     * corner on the view border is drawn whole as in pgfplots, but markers
     * outside the view are dropped.
     */
    private drawMarks(svg: SVGElement, items: SceneItem2D[]): void {
        const guides = this.layer('etz-guides', true);
        for (const item of items) {
            const from = guides.children.length;
            for (const s of item.guides || []) this.drawStroke(guides, s, true);
            this.tag(guides, from, item.source);
            if (this.entering.has(item)) this.enterEls(kidsFrom(guides, from), item, 'fade'); // 6.0 entrances
        }
        this.attach(svg, guides);
        const markers = this.layer('etz-markers', false);
        for (const item of items) {
            const from = markers.children.length;
            // 6.0 entrances: the points of a step pop in one after another.
            const plan = this.entering.get(item);
            (item.markers || []).forEach((m, i) => this.drawMarker(markers, m, plan ? this.popOf(plan.first + i) : 1));
            this.tag(markers, from, item.source);
            if (plan && this.ent?.leaving) this.enterEls(kidsFrom(markers, from), item, 'none');
        }
        this.attach(svg, markers);
    }

    /** `scale`: 6.0 entrances, how far the marker has popped in (1: whole). */
    private drawMarker(g: SVGElement, m: MarkerPrim, scale = 1): void {
        if (!finitePt(m) || !this.inView(m.x, m.y, 0)) return;
        const radii = this.clean ? CLEAN_MARKER_RADIUS : MARKER_RADIUS; // 6.1
        let r = (radii[m.size] || radii.normal) * (this.compact ? 0.6 : 1);
        let rim = this.compact ? '1' : this.clean ? '2' : '1.5';
        // 6.0 ML: a dot with matplotlib's radius in points: the colour that wide (3 points is the normal size), a thin rim outside it.
        if (m.radius !== undefined) {
            const k = (MARKER_RADIUS.normal / MATPLOTLIB_NORMAL_PT) * (this.compact ? 0.6 : 1);
            r = Math.max(0.3, m.radius * k + 0.375);
            rim = '0.75';
        }
        const attrs: Record<string, string> = {
            cx: num(this.sx(m.x)),
            cy: num(this.sy(m.y)),
            r: num(r),
            fill: this.css(m.color),
            stroke: BACKGROUND,
            'stroke-width': rim,
        };
        if (m.dim) attrs.opacity = '0.45';
        else if (typeof m.opacity === 'number' && m.opacity >= 0 && m.opacity < 1) attrs.opacity = num(m.opacity); // 6.2.1: scatter's alpha
        // 6.0 B, C: an open dot (an end a set does not hold, a rest point that is not stable) is a ring in the colour around the background.
        if (m.open) {
            attrs.fill = BACKGROUND;
            attrs.stroke = this.css(m.color);
            attrs['stroke-width'] = this.compact ? '1.2' : '2';
        }
        this.stillAttrs(m, attrs); // 6.0 F4
        if (scale !== 1) {
            // 6.0 entrances: popping in, about its own centre.
            const cx = this.sx(m.x);
            const cy = this.sy(m.y);
            attrs.transform = `translate(${num(cx)} ${num(cy)}) scale(${num(Math.max(0, scale))}) translate(${num(-cx)} ${num(-cy)})`;
        }
        g.appendChild(this.el('circle', attrs));
    }

    /** Layer 7. */
    private drawBraces(svg: SVGElement, items: SceneItem2D[]): void {
        const g = this.layer('etz-braces', false);
        for (const item of items) {
            const from = g.children.length;
            for (const b of item.braces || []) this.drawBrace(g, b);
            this.tag(g, from, item.source);
            if (this.entering.has(item)) this.enterEls(kidsFrom(g, from), item, 'fade'); // 6.0 entrances
        }
        this.attach(svg, g);
    }

    /**
     * Curly brace from `from` to `to` with its tip bulging to the left of the
     * direction in math coordinates (TikZ's brace decoration without mirror),
     * raised 3 px off the line like `raise=2pt`; the label sits beyond the tip.
     */
    private drawBrace(g: SVGElement, b: BracePrim): void {
        if (!finitePt(b.from) || !finitePt(b.to)) return;
        const x1 = this.sx(b.from.x);
        const y1 = this.sy(b.from.y);
        const x2 = this.sx(b.to.x);
        const y2 = this.sy(b.to.y);
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 1) return;
        const ux = (x2 - x1) / len;
        const uy = (y2 - y1) / len;
        // Screen y points down, which mirrors orientation: the math-space left
        // normal of from -> to is (uy, -ux) on screen.
        const nx = uy;
        const ny = -ux;
        const raise = 3;
        const amp = 7;
        const half = amp / 2;
        const q = Math.min(amp, len / 4);
        const ax = x1 + nx * raise;
        const ay = y1 + ny * raise;
        const bx = x2 + nx * raise;
        const by = y2 + ny * raise;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const p = (x: number, y: number) => `${num(x)},${num(y)}`;
        const d = [
            `M${p(ax, ay)}`,
            `Q${p(ax + nx * half, ay + ny * half)} ${p(ax + ux * q + nx * half, ay + uy * q + ny * half)}`,
            `L${p(mx - ux * q + nx * half, my - uy * q + ny * half)}`,
            `Q${p(mx + nx * half, my + ny * half)} ${p(mx + nx * amp, my + ny * amp)}`,
            `Q${p(mx + nx * half, my + ny * half)} ${p(mx + ux * q + nx * half, my + uy * q + ny * half)}`,
            `L${p(bx - ux * q + nx * half, by - uy * q + ny * half)}`,
            `Q${p(bx + nx * half, by + ny * half)} ${p(bx, by)}`,
        ].join(' ');
        const color = this.css(b.color);
        g.appendChild(
            this.el('path', {
                d,
                fill: 'none',
                stroke: color,
                'stroke-width': '1.5',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
            })
        );
        if (this.compact || !b.label) return;
        const gap = 2 * this.ptPx;
        const tipX = mx + nx * (amp + gap);
        const tipY = my + ny * (amp + gap);
        const vertical = Math.abs(ny) >= Math.abs(nx);
        this.drawLabel(g, b.label, tipX, tipY, {
            color,
            fontSize: this.fontPx(FONT_PT.normal),
            hAnchor: vertical ? 'middle' : nx > 0 ? 'start' : 'end',
            vAnchor: vertical ? (ny < 0 ? 'above' : 'below') : 'middle',
            weight: '500',
        });
    }

    /** Layer 8: scene texts (point / region / curve / segment labels), with halos where the scene asks. */
    private drawTexts(svg: SVGElement, items: SceneItem2D[]): void {
        if (this.compact) return;
        const g = this.layer('etz-texts', false);
        for (const item of items) {
            const from = g.children.length;
            for (const t of item.texts || []) {
                if (!finitePt(t) || !this.inView(t.x, t.y, TEXT_SLACK)) continue;
                const bold = t.weight === 'bold';
                // 6.1: a value the plugin writes sits in a soft pill in the clean look.
                const pill = this.clean && !!t.value && !bold;
                const at = g.children.length;
                let offset = finitePt(t.offset) ? t.offset : undefined;
                if (pill) {
                    // The pill's padding stays off the point the text belongs to, as the export's node border does.
                    const pt = FONT_PT[t.size || 'normal'] || FONT_PT.normal;
                    const side = TEXT_ALIGN[t.anchor] ?? TEXT_ALIGN.center;
                    const dx = side.h === 'start' ? 0.45 * pt : side.h === 'end' ? -0.45 * pt : 0;
                    const dy = side.v === 'above' ? 0.2 * pt + 1 : side.v === 'below' ? -0.2 * pt - 1 : 0;
                    offset = { x: (offset?.x ?? 0) + dx, y: (offset?.y ?? 0) + dy };
                }
                const drawnText = this.drawPlaced(g, t.text, t.x, t.y, t.anchor, t.size, {
                    color: bold ? this.boldInk(t.color) : this.css(t.color),
                    halo: !!t.halo && !pill,
                    haloInk: this.haloInk(t.under), // 6.2.1
                    weight: bold ? '600' : undefined,
                    offset,
                    attrs: t.still ? this.stillAttrs(t, {}) : undefined, // 6.0 ML: a frame(t) text the live canvas draws
                });
                if (pill && drawnText) this.pillBehind(g, at, drawnText, this.fontPx(FONT_PT[t.size || 'normal'] || FONT_PT.normal));
            }
            this.tag(g, from, item.source);
            if (this.entering.has(item)) this.enterEls(kidsFrom(g, from), item, 'rise'); // 6.0 entrances: just after its object
        }
        this.attach(svg, g);
    }

    /**
     * 6.2.1: the colour of a halo over `under` (the tints under a text, in
     * drawing order): each tint over what lies below it, as the fills paint
     * it, ending on the background. A theme variable expression, so it
     * follows the theme; copies flatten it to a hex (svgExport). Undefined
     * when nothing lies under the text: the halo is the background then.
     */
    private haloInk(under: HaloTint[] | undefined): string | undefined {
        if (!under || !under.length) return undefined;
        let ink = BACKGROUND;
        for (const t of under) {
            const opacity = Number.isFinite(t.opacity) ? clamp(t.opacity, 0, 1) : 0.25; // as drawFill
            ink = `color-mix(in srgb, ${this.css(t.color)} ${num(opacity * 100)}%, ${ink})`;
        }
        return ink;
    }

    /**
     * Ink of a bold label: its colour mixed toward the theme's text colour,
     * as a concrete hex so a copied SVG keeps it (the export uses
     * `<colour>!70!black`).
     */
    private boldInk(color: string): string {
        if (this.textInk === null) this.textInk = resolveCssColor(TEXT_NORMAL);
        return mixHex(resolveCssColor(this.css(color)), this.textInk, BOLD_INK_MIX);
    }

    /**
     * Layer 8, user labels: positions via math.value (expressions, sliders,
     * derived names), text via formatTemplate. `data-annotation-idx` is the
     * index into the chart's annotations for dragging (any label can be
     * dragged: expression positions get an offset; the host's cursor classes
     * show it). Labels sitting on a fill get a halo.
     */
    private drawAnnotations(svg: SVGElement, items: SceneItem2D[]): void {
        const list = this.config.annotations || [];
        if (!list.length) return;
        const fills: FillPrim[] = [];
        for (const item of items) fills.push(...(item.fills || []));
        const g = this.layer('etz-labels', false);
        list.forEach((a, idx) => {
            if (!a || a.hidden) return;
            const text = String(a.text ?? '');
            if (!text.trim()) return;
            const source = `label:${idx}`;
            const check = this.math.validate(text, 'template');
            if (!check.ok) this.addIssue({ source, field: 'text', message: check.message, severity: 'error' });
            const x = this.labelCoordinate(a.x, source, 'x');
            const y = this.labelCoordinate(a.y, source, 'y');
            if (this.compact || !Number.isFinite(x) || !Number.isFinite(y) || !this.inView(x, y, TEXT_SLACK)) return;
            const attrs: Record<string, string> = { 'data-annotation-idx': String(idx), 'data-etz-item': source, 'pointer-events': 'bounding-box' };
            const from = g.children.length;
            const under = tintsAt({ x, y }, fills); // 6.2.1
            this.drawPlaced(g, this.math.formatTemplate(text), x, y, a.anchor, a.size, {
                color: this.css(a.color),
                halo: under.length > 0,
                haloInk: this.haloInk(under),
                weight: '500',
                attrs,
            });
            // 6.0 entrances: a label of the step rises in just after the step's other objects.
            if (this.ent && this.ent.moves(a)) this.riseEls(kidsFrom(g, from), this.ent.labels);
        });
        this.attach(svg, g);
    }

    /** A label coordinate, or NaN after reporting why (unless it waits on a derived name, whose tool reports). */
    private labelCoordinate(src: string | undefined, source: string, field: 'x' | 'y'): number {
        const text = String(src ?? '');
        const r = this.math.tryValue(text);
        if (r.ok) return r.value;
        if (!this.math.deps(text).derived.length) this.addIssue({ source, field, message: r.message, severity: 'error' });
        return NaN;
    }

    /** Legend box in the top-right corner of the plot, sized to its widest entry; \footnotesize like the export. */
    private drawLegend(svg: SVGElement, entries: LegendEntry[]): void {
        if (!entries.length || this.compact) return;
        const g = this.el('g', { class: 'etz-legend' });
        const fs = this.fontPx(LEGEND_PT);
        const pad = 0.7 * fs;
        const sample = 1.8 * fs;
        const gap = 0.55 * fs;
        const inset = 0.9 * fs;
        let y = 0.45 * fs;
        let textWidth = 0;
        for (const entry of entries) {
            const row = this.el('g');
            const line: Record<string, string> = {
                stroke: entry.color,
                'stroke-width': String(Math.min(entry.width, 3)),
                'stroke-linecap': 'round',
            };
            if (entry.dashed) line['stroke-dasharray'] = '5 3';
            row.appendChild(this.line(pad, 0, pad + sample, 0, line));
            const drawn = this.drawLabel(row, entry.label, pad + sample + gap, 0, {
                color: TEXT_NORMAL,
                fontSize: fs,
                hAnchor: 'start',
                vAnchor: 'middle',
            });
            const rowHeight = Math.max(1.8 * fs, drawn ? drawn.height + 0.35 * fs : 0);
            if (drawn) textWidth = Math.max(textWidth, drawn.width);
            row.setAttribute('transform', `translate(0, ${num(y + rowHeight / 2)})`);
            g.appendChild(row);
            y += rowHeight;
        }
        // Right-aligned in the plot; a very wide legend grows left into the padding rather than overflowing.
        const boxWidth = Math.min(pad + sample + gap + textWidth + pad, Math.max(60, this.plot.x + this.plot.w - 15));
        const boxHeight = y + 0.45 * fs;
        g.insertBefore(
            this.el('rect', {
                x: '0',
                y: '0',
                width: num(boxWidth),
                height: num(boxHeight),
                fill: BACKGROUND,
                stroke: BORDER,
                'stroke-width': '1',
                rx: '4',
                'fill-opacity': '0.9',
            }),
            g.firstChild
        );
        g.setAttribute('transform', `translate(${num(this.plot.x + this.plot.w - inset - boxWidth)}, ${num(this.plot.y + inset / 2)})`);
        svg.appendChild(g);
    }

    /** Title above the plot, centred on it like pgfplots; `{expr}` templates are interpolated. */
    private drawTitle(svg: SVGElement): void {
        const raw = String(this.config.title ?? '');
        if (this.compact || !raw.trim()) return;
        const check = this.math.validate(raw, 'template');
        if (!check.ok) this.addIssue({ source: 'chart', field: 'title', message: check.message, severity: 'error' });
        const g = this.el('g', { class: 'etz-title' });
        // Above the tick-label (or middle-axis label) band; follows a letterboxed plot down.
        const titleFs = this.fontPx(TITLE_PT);
        const y = this.plot.y - (this.pad.top - this.titleBottom);
        this.drawLabel(g, this.math.formatTemplate(raw), this.plot.x + this.plot.w / 2, Math.max(titleFs, y), {
            color: TEXT_NORMAL,
            fontSize: titleFs,
            hAnchor: 'middle',
            vAnchor: 'above',
            weight: '600',
        });
        this.attach(svg, g);
    }
}

/** What a tick prints: the user's label as plain text (`$a$` shows as a), a multiple of π, or the number. */
function tickText(k: Tick): string {
    return k.label !== undefined ? stripLatex(k.label) : k.text;
}
