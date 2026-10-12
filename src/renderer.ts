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
import { niceInterval, formatTick, marchingGrid, sampleCurve, stripLatex, tickValues } from './util';
import { extractMathSource, renderMathLabel, flushMathRenders } from './mathlabel';
import { FunctionInfo, FunctionKind, MathContext, labelDisplayText } from './mathcontext';
import {
    BracePrim,
    FillPrim,
    MarkerPrim,
    Scene2D,
    SceneCache,
    SceneIssue,
    SceneItem2D,
    StrokePrim,
    TextAnchor,
    TextPrim,
    computeScene2D,
    labelMetricsFor,
} from './scene';
import { Grid, Pt, View, pointInRings } from './geometry';

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
const Y_TICK_RATIO = 0.75;

/** The 3.x default view, used when a config arrives with an unusable range. */
const DEFAULT_VIEW: View = { xmin: -0.5, xmax: 10, ymin: -0.5, ymax: 5 };

const MARKER_RADIUS: Record<MarkerSize, number> = { small: 3, normal: 4, large: 5.5 };

/** Texts may sit this fraction of the view outside it (the export uses `clip mode=individual`). */
const TEXT_SLACK = 0.05;

/** Rough advance width of one character of label text, in em, for sizing the legend box and paddings. */
const CHAR_WIDTH_EM = 0.56;
/** Bold labels (region names) mix this much of the text colour into their own colour. */
const BOLD_INK_MIX = 0.6;

const BACKGROUND = 'var(--background-primary)';
const BORDER = 'var(--background-modifier-border)';
const TEXT_NORMAL = 'var(--text-normal)';
const TEXT_MUTED = 'var(--text-muted)';

type HAnchor = 'start' | 'middle' | 'end';
type VAnchor = 'above' | 'middle' | 'below';

/**
 * Where a text sits relative to its anchor point: offset in pt (TikZ's
 * inner sep between the point and the text) plus text alignment.
 */
const TEXT_PLACEMENT: Record<TextAnchor, { dx: number; dy: number; h: HAnchor; v: VAnchor }> = {
    center: { dx: 0, dy: 0, h: 'middle', v: 'middle' },
    above: { dx: 0, dy: -3, h: 'middle', v: 'above' },
    below: { dx: 0, dy: 3, h: 'middle', v: 'below' },
    left: { dx: -4.5, dy: 0, h: 'end', v: 'middle' },
    right: { dx: 4.5, dy: 0, h: 'start', v: 'middle' },
    'above right': { dx: 3.75, dy: -3, h: 'start', v: 'above' },
    'below left': { dx: -3.75, dy: 3, h: 'end', v: 'below' },
    'above left': { dx: -3.75, dy: -3, h: 'end', v: 'above' },
    'below right': { dx: 3.75, dy: 3, h: 'start', v: 'below' },
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
    /** Extra attributes on the outermost element drawn. */
    attrs?: Record<string, string>;
}

interface DrawnLabel {
    el: SVGElement;
    width: number;
    height: number;
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

/** Arrowhead length in px: grows with the line width like TikZ tips, but less than proportionally. */
function arrowLength(width: number): number {
    return 7 + 2 * width;
}

/** The next nice step above `step` (1, 2, 5 times a power of ten). */
function nextNiceStep(step: number): number {
    const mag = Math.pow(10, Math.floor(Math.log10(step) + 1e-9));
    const n = Math.round(step / mag);
    return (n < 2 ? 2 : n < 5 ? 5 : 10) * mag;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

function finitePt(p: Pt | null | undefined): p is Pt {
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
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
    /** Id prefix of the render in progress (`etz-<n>-`) and the defs registered under it. */
    private ids = '';
    private defs: SVGDefsElement | null = null;
    private readonly patterns = new Map<string, string>();
    private readonly arrows = new Map<string, string>();
    /** Set when a `$...$`-wrapped label was rendered via MathJax during this render() pass. */
    private usedMath = false;

    /** CONTRACT (v4): function + tool problems found during the last render(). */
    issues: SceneIssue[] = [];
    /** CONTRACT (v4): layout of the last render(), null before the first. */
    layout: RenderLayout | null = null;
    /** CONTRACT (v4, drag to edit): scene items and function curves of the last render(), null before the first. */
    drawn: DrawnScene | null = null;

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
                  });
        this.cache = opts ? opts.cache : undefined;
        this.quality = opts && opts.quality === 'draft' ? 'draft' : 'full';
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
        this.patterns.clear();
        this.arrows.clear();
        this.usedMath = false;
        this.textInk = null;
        this.issues = [];
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
            this.addIssue({ source: 'chart', message: 'Invalid axis range, showing the default view', severity: 'error' });
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

        this.drawGrid(svg);
        this.drawFills(svg, items);
        this.drawAxes(svg);
        const curves: DrawnCurve[] = [];
        const legend = this.drawCurves(svg, fns, curves);
        this.drawn = { items, curves };
        this.drawStrokes(svg, items);
        this.drawMarks(svg, items);
        this.drawBraces(svg, items);
        this.drawTexts(svg, items);
        this.drawAnnotations(svg, items);
        this.drawLegend(svg, legend);
        this.drawTitle(svg);
        if (this.usedMath) flushMathRenders();
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
        const cfg = this.config;
        const v = this.view;
        const [stepX, stepY] = this.tickSteps();
        const tickFs = this.fontPx(TICK_PT);
        const axisFs = this.fontPx(AXIS_LABEL_PT);
        const pt = (n: number) => n * this.ptPx;
        const ys = tickValues(v.ymin, v.ymax, stepY);
        const xs = tickValues(v.xmin, v.xmax, stepX);
        const yTickW = ys.reduce((m, y) => Math.max(m, formatTick(y).length * tickFs * CHAR_WIDTH_EM), 0);
        const lastX = xs.length ? formatTick(xs[xs.length - 1]).length * tickFs * CHAR_WIDTH_EM : 0;
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
        const v = this.view;
        const target = this.config.majorTickNum > 0 ? this.config.majorTickNum : DEFAULT_TARGET_TICKS_X;
        const dx = v.xmax - v.xmin;
        const dy = v.ymax - v.ymin;
        const equal = this.config.equalScale || this.polar;
        let sx = equal ? niceInterval(Math.max(dx, dy), target) : niceInterval(dx, target);
        let sy = equal ? sx : niceInterval(dy, Math.max(2, Math.round(target * Y_TICK_RATIO)));
        if (this.compact) return [sx, sy];
        // Roughly the plot size; the paddings follow from these steps, so the exact plot is not known yet.
        const plotW = this.width * 0.85;
        const plotH = this.height * 0.8;
        const fs = this.fontPx(TICK_PT);
        const fitsX = (step: number) => {
            const ticks = tickValues(v.xmin, v.xmax, step);
            const widest = ticks.reduce((m, t) => Math.max(m, formatTick(t).length), 1) * fs * CHAR_WIDTH_EM;
            return ticks.length < 2 || (plotW * step) / dx >= widest + fs * 0.8;
        };
        const fitsY = (step: number) => (plotH * step) / dy >= fs * 1.6;
        for (let k = 0; k < 8 && !(fitsX(sx) && (!equal || fitsY(sx))); k++) sx = nextNiceStep(sx);
        if (equal) return [sx, sx];
        for (let k = 0; k < 8 && !fitsY(sy); k++) sy = nextNiceStep(sy);
        return [sx, sy];
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
            });
            if (this.cache) lastGoodScene.set(this.cache, scene);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.addIssue({ source: 'chart', message: `Could not compute the shapes: ${message}`, severity: 'error' });
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

    /** Stroke width in px for a thickness key; thinner on thumbnails. */
    private strokeWidth(thickness: string | undefined): number {
        const w = (thickness && THICKNESS_MAP[thickness]) || 1.5;
        return this.compact ? w * 0.6 : w;
    }

    /** Palette key -> preview colour ('black' follows the theme's text colour). */
    private css(color: string | undefined): string {
        if (!color) return TEXT_NORMAL;
        return COLOR_MAP[color] || color;
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
     * MathJax when it is a single `$...$` or `\(...\)` expression, else the
     * text read the way the export reads it (labelDisplayText: text as
     * typed, LaTeX commands resolved, math through the `stripLatex()`
     * Unicode approximation). MathJax output lives in a
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
        if (mathSource !== null) {
            try {
                const { el, width, height } = renderMathLabel(mathSource, o.color, fs);
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
                fo.appendChild(el);
                let outer: SVGElement = fo;
                if (o.halo) {
                    // A stroke halo cannot reach into HTML, so math labels on fills get a soft backdrop.
                    outer = this.el('g');
                    const padX = 0.17 * fs;
                    const padY = 0.08 * fs;
                    outer.appendChild(
                        this.el('rect', {
                            x: num(fx - padX),
                            y: num(fy - padY),
                            width: num(w + 2 * padX),
                            height: num(h + 2 * padY),
                            rx: '3',
                            fill: BACKGROUND,
                            'fill-opacity': '0.8',
                        })
                    );
                    outer.appendChild(fo);
                }
                for (const [k, v] of Object.entries(o.attrs || {})) outer.setAttribute(k, v);
                parent.appendChild(outer);
                return { el: outer, width: w, height: h };
            } catch {
                // MathJax rejected the source (unbalanced braces, unknown
                // environment, ...); fall through to the plain-text path.
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
            attrs.stroke = BACKGROUND;
            attrs['stroke-width'] = num(0.25 * fs);
            attrs['stroke-linejoin'] = 'round';
            attrs['paint-order'] = 'stroke';
        }
        const t = this.el('text', { ...attrs, ...(o.attrs || {}) });
        t.textContent = plain;
        parent.appendChild(t);
        return { el: t, width: plain.length * fs * CHAR_WIDTH_EM, height: fs * 1.2 };
    }

    /** Draw a text placed beside math point (x, y) per a TikZ-style anchor. */
    private drawPlaced(
        parent: SVGElement,
        text: string,
        x: number,
        y: number,
        anchor: TextPrim['anchor'] | undefined,
        size: AnnotationSize | undefined,
        o: { color: string; halo: boolean; weight?: string; attrs?: Record<string, string> }
    ): DrawnLabel | null {
        const place = TEXT_PLACEMENT[anchor || 'center'] || TEXT_PLACEMENT.center;
        return this.drawLabel(parent, text, this.sx(x) + place.dx * this.ptPx, this.sy(y) + place.dy * this.ptPx, {
            color: o.color,
            fontSize: this.fontPx(FONT_PT[size || 'normal'] || FONT_PT.normal),
            hAnchor: place.h,
            vAnchor: place.v,
            weight: o.weight,
            halo: o.halo,
            attrs: o.attrs,
        });
    }

    // ------------------------------------------------------------ layers

    /** Layer 1. Minor lines follow pgfplots' `minor tick num=n`: n lines between two major ticks. */
    private drawGrid(svg: SVGElement): void {
        const cfg = this.config;
        if (!cfg.gridMajor && !cfg.gridMinor) return;
        const g = this.el('g', { class: 'etz-grid' });
        const v = this.view;
        const { x: left, y: top, w, h } = this.plot;
        const [stepX, stepY] = this.tickSteps();
        const draw = (xs: number[], ys: number[], width: string, opacity: string) => {
            const attrs = { stroke: BORDER, 'stroke-width': width, 'stroke-opacity': opacity };
            for (const x of xs) g.appendChild(this.line(this.sx(x), top, this.sx(x), top + h, attrs));
            for (const y of ys) g.appendChild(this.line(left, this.sy(y), left + w, this.sy(y), attrs));
        };
        const minor = Math.round(Number(cfg.minorTickNum));
        if (cfg.gridMinor && minor >= 1) {
            draw(
                tickValues(v.xmin, v.xmax, stepX / (minor + 1)),
                tickValues(v.ymin, v.ymax, stepY / (minor + 1)),
                '0.5',
                '0.25'
            );
        }
        draw(tickValues(v.xmin, v.xmax, stepX), tickValues(v.ymin, v.ymax, stepY), '1', '0.5');
        this.attach(svg, g);
    }

    /** Layer 2: function fills and region fills in item order; patterns over the tint like the export. */
    private drawFills(svg: SVGElement, items: SceneItem2D[]): void {
        const g = this.layer('etz-fills', true);
        for (const item of items) for (const fill of item.fills || []) this.drawFill(g, fill);
        this.attach(svg, g);
    }

    private drawFill(g: SVGElement, fill: FillPrim): void {
        const d = this.ringsPath(fill.rings);
        if (!d) return;
        const color = this.css(fill.color);
        const opacity = Number.isFinite(fill.opacity) ? clamp(fill.opacity, 0, 1) : 0.25;
        g.appendChild(this.el('path', { d, fill: color, 'fill-opacity': String(opacity), 'fill-rule': 'evenodd', stroke: 'none' }));
        const pattern = this.pattern(fill.pattern, color);
        if (pattern) g.appendChild(this.el('path', { d, fill: pattern, 'fill-rule': 'evenodd', stroke: 'none' }));
    }

    /** Layer 3: axis lines, ticks, tick labels and axis titles. */
    private drawAxes(svg: SVGElement): void {
        const cfg = this.config;
        const g = this.el('g', { class: 'etz-axes' });
        const v = this.view;
        const { x: left, y: top, w, h } = this.plot;
        const right = left + w;
        const bottom = top + h;
        const [stepX, stepY] = this.tickSteps();
        const xs = this.compact ? [] : tickValues(v.xmin, v.xmax, stepX);
        const ys = this.compact ? [] : tickValues(v.ymin, v.ymax, stepY);
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
        const xTickLabel = (value: number, x: number, y: number) => this.tickLabel(g, value, x, y + 0.78 * tickFs, 'middle', tickFs);
        const yTickLabel = (value: number, x: number, y: number) => this.tickLabel(g, value, x, y + 0.35 * tickFs, 'end', tickFs);

        if (cfg.axisStyle === 'middle') {
            axisLine(left, oy, right, oy);
            axisLine(ox, bottom, ox, top);
            for (const x of xs) {
                if (Math.abs(x) < stepX * 0.01) continue;
                const px = this.sx(x);
                tick(px, oy - 4, px, oy + 4);
                xTickLabel(x, px, oy + 4 + tickGap);
            }
            for (const y of ys) {
                if (Math.abs(y) < stepY * 0.01) continue;
                const py = this.sy(y);
                tick(ox - 4, py, ox + 4, py);
                yTickLabel(y, ox - 4 - tickGap, py);
            }
        } else if (cfg.axisStyle === 'axes') {
            // L-shaped axes along the lower-left corner of the plot, with arrowheads.
            axisLine(left, bottom, right, bottom);
            axisLine(left, bottom, left, top);
            for (const x of xs) {
                const px = this.sx(x);
                tick(px, bottom, px, bottom + TICK_LEN);
                xTickLabel(x, px, bottom + TICK_LEN + tickGap);
            }
            for (const y of ys) {
                const py = this.sy(y);
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
                const px = this.sx(x);
                tick(px, bottom, px, bottom + TICK_LEN);
                tick(px, top - TICK_LEN, px, top);
                xTickLabel(x, px, bottom + TICK_LEN + tickGap);
            }
            for (const y of ys) {
                const py = this.sy(y);
                tick(left - TICK_LEN, py, left, py);
                tick(right, py, right + TICK_LEN, py);
                yTickLabel(y, left - TICK_LEN - tickGap, py);
            }
        }

        if (!this.compact && cfg.showAxisLabels) {
            const axisFs = this.fontPx(AXIS_LABEL_PT);
            const gap = LABEL_GAP_PT * this.ptPx;
            const label = (hAnchor: HAnchor, vAnchor: VAnchor): LabelOptions => ({ color: TEXT_NORMAL, fontSize: axisFs, hAnchor, vAnchor, weight: '500' });
            if (cfg.axisStyle === 'middle') {
                // Beyond the arrow tips, unrotated, like the export (xlabel anchor=west, ylabel anchor=south).
                this.drawLabel(g, String(cfg.xLabel ?? ''), right + gap, oy, label('start', 'middle'));
                this.drawLabel(g, String(cfg.yLabel ?? ''), ox, top - gap, label('middle', 'above'));
            } else {
                const ys0 = tickValues(v.ymin, v.ymax, stepY);
                const yTickW = ys0.reduce((m, y) => Math.max(m, formatTick(y).length * tickFs * CHAR_WIDTH_EM), 0);
                this.drawLabel(g, String(cfg.xLabel ?? ''), left + w / 2, bottom + TICK_LEN + tickGap + tickFs * 1.1 + gap, label('middle', 'below'));
                const cx = Math.max(axisFs * 0.6, left - TICK_LEN - tickGap - yTickW - gap - axisFs * 0.6);
                const cy = top + h / 2;
                const rotated = this.el('g', { transform: `rotate(-90, ${num(cx)}, ${num(cy)})` });
                this.drawLabel(rotated, String(cfg.yLabel ?? ''), cx, cy, label('middle', 'middle'));
                this.attach(g, rotated);
            }
        }
        svg.appendChild(g);
    }

    /** One tick label with its baseline at (x, y). */
    private tickLabel(g: SVGElement, value: number, x: number, y: number, anchor: HAnchor, fs: number): void {
        const t = this.el('text', {
            x: num(x),
            y: num(y),
            'text-anchor': anchor,
            fill: TEXT_MUTED,
            'font-size': num(fs),
            'font-family': 'var(--font-text)',
        });
        t.textContent = formatTick(value);
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
            const color = this.css(f.color);
            const width = this.strokeWidth(f.thickness);
            const lines = this.sampleFunction(info);
            if (lines.length) {
                drawn.push({ name: info.name, index: info.index, kind: info.kind, lines });
                const attrs: Record<string, string> = {
                    d: lines.map((l) => this.pointsPath(l)).join(''),
                    fill: 'none',
                    stroke: color,
                    'stroke-width': String(width),
                    'stroke-linejoin': 'round',
                    'stroke-linecap': 'round',
                };
                if (f.dashed) attrs['stroke-dasharray'] = '6 4';
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
        for (const item of items) for (const s of item.strokes || []) this.drawStroke(g, s, false);
        this.attach(svg, g);
    }

    /** One stroke primitive; guides are always dashed 1 px at 60 % opacity. */
    private drawStroke(g: SVGElement, s: StrokePrim, guide: boolean): void {
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
        const runs: Pt[][] = [];
        for (const line of s.lines || []) runs.push(...finiteRuns(line));
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
        for (const item of items) for (const s of item.guides || []) this.drawStroke(guides, s, true);
        this.attach(svg, guides);
        const markers = this.layer('etz-markers', false);
        for (const item of items) for (const m of item.markers || []) this.drawMarker(markers, m);
        this.attach(svg, markers);
    }

    private drawMarker(g: SVGElement, m: MarkerPrim): void {
        if (!finitePt(m) || !this.inView(m.x, m.y, 0)) return;
        const r = (MARKER_RADIUS[m.size] || MARKER_RADIUS.normal) * (this.compact ? 0.6 : 1);
        const attrs: Record<string, string> = {
            cx: num(this.sx(m.x)),
            cy: num(this.sy(m.y)),
            r: String(r),
            fill: this.css(m.color),
            stroke: BACKGROUND,
            'stroke-width': this.compact ? '1' : '1.5',
        };
        if (m.dim) attrs.opacity = '0.45';
        g.appendChild(this.el('circle', attrs));
    }

    /** Layer 7. */
    private drawBraces(svg: SVGElement, items: SceneItem2D[]): void {
        const g = this.layer('etz-braces', false);
        for (const item of items) for (const b of item.braces || []) this.drawBrace(g, b);
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
            for (const t of item.texts || []) {
                if (!finitePt(t) || !this.inView(t.x, t.y, TEXT_SLACK)) continue;
                const bold = t.weight === 'bold';
                this.drawPlaced(g, t.text, t.x, t.y, t.anchor, t.size, {
                    color: bold ? this.boldInk(t.color) : this.css(t.color),
                    halo: !!t.halo,
                    weight: bold ? '600' : undefined,
                });
            }
        }
        this.attach(svg, g);
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
        const fillRings: Pt[][][] = [];
        for (const item of items) for (const fill of item.fills || []) fillRings.push(fill.rings || []);
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
            const attrs: Record<string, string> = { 'data-annotation-idx': String(idx), 'pointer-events': 'bounding-box' };
            this.drawPlaced(g, this.math.formatTemplate(text), x, y, a.anchor, a.size, {
                color: this.css(a.color),
                halo: fillRings.some((rings) => pointInRings({ x, y }, rings)),
                weight: '500',
                attrs,
            });
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
