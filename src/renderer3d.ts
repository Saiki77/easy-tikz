import { RendererConfig, Function3DParameters, MarkerSize, AnnotationSize } from './types';
import { LABEL_LOCALS, MathContext, labelDisplayText } from './mathcontext';
import { ArrowHeads, Scene3D, SceneIssue, computeScene3D } from './scene';
import { COLOR_MAP, THICKNESS_MAP, resolveCssColor } from './colors';
import { niceInterval, formatTick, stripLatex, hexToRgb, rgbStringToRgb } from './util';


const PADDING_TOP = 40;
const PADDING_RIGHT = 40;
const PADDING_BOTTOM = 40;
const PADDING_LEFT = 40;

/** Fraction of the available viewport used by the projected unit cube. */
const VIEWPORT_SCALE = 0.28;

/** Default surface sampling resolution per axis. */
const DEFAULT_GRID_SAMPLES = 40;
/** Most surface samples per axis the preview draws (the Samples slider stops here too). */
export const MAX_PREVIEW_SAMPLES_3D = 120;

/** Default target number of major ticks per 3D axis. */
const DEFAULT_TARGET_TICKS = 5;

/**
 * Planes are split into PLANE_CELLS x PLANE_CELLS cells that are depth
 * sorted together with the surface quads, so a surface visibly pokes through
 * a cutting plane instead of the whole plane being painted on top of it.
 */
const PLANE_CELLS = 24;

/** Marker radius in px per points-tool size (same sizes as the 2D preview). */
const MARKER_RADIUS: Record<MarkerSize, number> = { small: 3, normal: 4, large: 5.5 };

const ANNOTATION_FONT_SIZE: Record<AnnotationSize, number> = { small: 10, normal: 12, large: 15 };

/**
 * Surface shading is looked up from this many precomputed levels instead of
 * formatting an rgb() string per quad and frame. 256 levels are finer than
 * the integer channel steps, so the result is the same.
 */
const SHADE_LEVELS = 256;

const NO_TOOLS: Scene3D = { points: [], segments: [], planes: [], issues: [], derived: {} };

interface Quad {
    p0x: number; p0y: number;
    p1x: number; p1y: number;
    p2x: number; p2y: number;
    p3x: number; p3y: number;
    depth: number;
    /** Resolved fill: shaded by height for surface quads, flat for plane cells. */
    fill: string;
    /** Resolved base colour, used for edges. */
    stroke: string;
    wireframe: boolean;
    opacity: number;
    /**
     * -1 for surface quads; for plane cells the plane's index. Consecutive
     * cells of one plane are filled as a single path so their shared edges
     * do not show anti-aliasing seams through the translucent fill.
     */
    plane: number;
}

interface SurfaceData {
    key: string;
    samples: number;
    xs: Float64Array;
    ys: Float64Array;
    zs: Float64Array;
}

interface ProjectedPoint {
    sx: number;
    sy: number;
    depth: number;
}

interface BoxEdge {
    p1Idx: number;
    p2Idx: number;
    layer: 'back' | 'front';
}

interface TickEdge {
    /** Endpoints in screen space (for axis label placement at midpoint). */
    p1: ProjectedPoint;
    p2: ProjectedPoint;
    /** Coordinate values that stay constant along this edge. */
    fixedA: number;
    fixedB: number;
    /** Unit vector in screen space pointing away from the box centroid. */
    outwardX: number;
    outwardY: number;
}

interface ColorInfo {
    /** Concrete CSS colour (theme variables resolved). */
    css: string;
    rgb: { r: number; g: number; b: number } | null;
    /** Height shades (SHADE_LEVELS entries, built on first use); null when `css` is not parseable. */
    shades: string[] | null;
}

/** Border of a plane tool, stroked on top of the sorted quads. */
interface PlaneOutline {
    pts: ProjectedPoint[];
    color: string;
    opacity: number;
}

/** One projected segment leg. Screen-space endpoints are already shortened under arrow heads. */
interface SegmentMark {
    x1: number; y1: number;
    x2: number; y2: number;
    color: string;
    width: number;
    dashed: boolean;
    /** Arrow head triangles as [tipX, tipY, leftX, leftY, rightX, rightY]. */
    heads: number[][];
}

interface MarkerMark {
    sx: number;
    sy: number;
    r: number;
    color: string;
    /** Plain text (LaTeX stripped); '' for none. */
    label: string;
}

interface TextMark {
    x: number;
    y: number;
    text: string;
    color: string;
    fontSize: number;
    align: 'start' | 'middle' | 'end';
}

/** Mix `rgb` toward white by height: t = 0 (lowest) keeps 30 % of the colour, t = 1 all of it. */
function shadeRgb(rgb: { r: number; g: number; b: number }, t: number): string {
    const factor = 0.3 + t * 0.7;
    const r = Math.round(rgb.r * factor + 255 * (1 - factor));
    const g = Math.round(rgb.g * factor + 255 * (1 - factor));
    const b = Math.round(rgb.b * factor + 255 * (1 - factor));
    return `rgb(${r},${g},${b})`;
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * Context for a config rendered without one (inline notes). Memoized by
 * MathContext.create, which also applies the current parameter values.
 */
function contextFromConfig(config: RendererConfig): MathContext {
    return MathContext.create({
        parameters: config.parameters,
        functions: config.functions,
        variables: config.variables,
        toolNames: (Array.isArray(config.tools) ? config.tools : []).map((t) => t.name),
    });
}

/**
 * Stateful 3D renderer with two output paths:
 *  - `renderSvg(config)`: mutates a pool of `<path>` elements inside a
 *    persistent SVG. Use for the idle / settled state where Copy SVG and
 *    Copy PNG need a queryable DOM tree.
 *  - `renderCanvas(config)`: paints to a `<canvas>` with no DOM ops in the
 *    inner loop. Use during continuous interaction (drag, wheel, slider).
 *
 * Both paths share the same data cache and the same project + sort pass.
 * The renderer owns a root `<div>` that contains both the SVG and the
 * canvas; the modal attaches the root once and the renderer toggles which
 * sibling is visible.
 */
export class SVG3DRenderer {
    /**
     * Problems found during the last render: surface expression / domain
     * errors (source = surface name, field 'expression' | 'xDomain' |
     * 'yDomain'), the 3D scene's issues, and label positions (source
     * 'label:<index>', field 'x' | 'y' | 'z' | 'text').
     */
    issues: SceneIssue[] = [];

    private root: HTMLDivElement;
    private svg: SVGSVGElement;
    private backgroundRect: SVGRectElement;
    private surfaceGroup: SVGGElement;
    private backAxesGroup: SVGGElement;
    private toolsGroup: SVGGElement;
    private frontAxesGroup: SVGGElement;
    private annotationsGroup: SVGGElement;
    private titleEl: SVGTextElement;

    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;

    /** Path pool reused across renders (one per surface quad or per run of plane cells). */
    private surfacePool: SVGPathElement[] = [];

    /** Sampled data per surface index. */
    private dataCache: Map<number, SurfaceData> = new Map();

    // Camera state (refreshed per render).
    private config: RendererConfig | null = null;

    /** The config of the render in progress (set first thing by prepareScene). */
    private requireConfig(): RendererConfig {
        if (!this.config) throw new Error('3D renderer used before a config was set');
        return this.config;
    }
    private centerX = 0;
    private centerY = 0;
    private scale = 1;
    private cosA = 1;
    private sinA = 0;
    private cosE = 1;
    private sinE = 0;
    // Per-axis normalization (applied before rotation). Set by `prepareScene`
    // based on `config.boxAspect`. In 'equal' mode each factor is 2/<axis range>
    // so the box is a unit cube; in 'true' mode all three use 2/maxRange so the
    // box reflects data proportions while still fitting the canvas.
    private xCenter = 0;
    private yCenter = 0;
    private zCenter = 0;
    private xNormFactor = 1;
    private yNormFactor = 1;
    private zNormFactor = 1;

    private sxBuf = new Float64Array(0);
    private syBuf = new Float64Array(0);
    private depthBuf = new Float64Array(0);

    /** Most recent gathered + sorted quad list (surfaces and plane cells). Set by `prepareScene`. */
    private quads: Quad[] = [];

    /** Projected tool marks and texts. Set by `prepareScene`, drawn by either path. */
    private planeOutlines: PlaneOutline[] = [];
    private segmentMarks: SegmentMark[] = [];
    private markerMarks: MarkerMark[] = [];
    private annotationMarks: TextMark[] = [];
    private titleText = '';

    /** Box geometry. Refreshed per render via `prepareBox`. */
    private boxCorners: ProjectedPoint[] = [];
    private boxEdges: BoxEdge[] = [];
    private xTickEdge: TickEdge | null = null;
    private yTickEdge: TickEdge | null = null;
    private zTickEdge: TickEdge | null = null;

    /** Resolved theme colors, refreshed per render so theme switches repaint. */
    private themeColors: { textNormal: string; textMuted: string; bgPrimary: string } = {
        textNormal: '#000',
        textMuted: '#666',
        bgPrimary: '#fff',
    };

    /** Theme text font for canvas text (`--font-text` resolved), and the raw value it came from. */
    private fontFamily = 'sans-serif';
    private fontFamilySource: string | null = null;

    /** Resolved palette colours, cleared per render (theme switches change 'black'). */
    private colorCache: Map<string, ColorInfo> = new Map();

    /** Memoized fit-contain result so we don't write to the root's style on every drag frame. */
    private lastFit: { parentW: number; parentH: number; configW: number; configH: number; w: number; h: number } | null = null;

    constructor() {
        // Single static class. The renderer used to toggle between
        // `tikz-3d-mode-svg` and `tikz-3d-mode-canvas` to swap which
        // sibling was visible; canvas is now the only display path, and
        // the SVG (kept for export) is hidden via a CSS `display: none`
        // rule on `.tikz-3d-svg`.
        this.root = createDiv({ cls: 'tikz-3d-root' });

        this.svg = createSvg('svg', { cls: 'tikz-3d-svg' });

        this.backgroundRect = createSvg('rect');
        this.backgroundRect.setAttribute('fill', 'var(--background-primary)');
        this.backgroundRect.setAttribute('rx', '4');
        this.svg.appendChild(this.backgroundRect);

        this.backAxesGroup = this.makeGroup('tikz-3d-axes-back');
        this.surfaceGroup = this.makeGroup('tikz-3d-surface');
        this.toolsGroup = this.makeGroup('tikz-3d-tools');
        this.frontAxesGroup = this.makeGroup('tikz-3d-axes-front');
        this.annotationsGroup = this.makeGroup('tikz-3d-annotations');

        this.titleEl = createSvg('text');
        this.titleEl.setAttribute('text-anchor', 'middle');
        this.titleEl.setAttribute('fill', 'var(--text-normal)');
        this.titleEl.setAttribute('font-size', '15');
        this.titleEl.setAttribute('font-weight', '600');
        this.svg.appendChild(this.titleEl);

        this.canvas = createEl('canvas', { cls: 'tikz-3d-canvas' });
        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        this.ctx = ctx;

        this.root.appendChild(this.svg);
        this.root.appendChild(this.canvas);
    }

    private makeGroup(cls: string): SVGGElement {
        const g = createSvg('g', { cls });
        this.svg.appendChild(g);
        return g;
    }

    /** The container holding both the SVG and the canvas. Attach this once. */
    getElement(): HTMLElement {
        return this.root;
    }

    invalidateCache() {
        this.dataCache.clear();
    }

    /**
     * Update the off-screen SVG to reflect `config`. The SVG is hidden via
     * CSS (`display: none` on `.tikz-3d-svg`); only the export path calls
     * this method, then reads the now-fresh SVG via `querySelector`.
     * CONTRACT (v4): `opts.math` shared context (created from config when omitted).
     */
    renderSvg(config: RendererConfig, opts?: { math?: MathContext }) {
        this.prepareScene(config, opts?.math);
        this.updateSurfacePool(this.quads);

        clearChildren(this.backAxesGroup);
        clearChildren(this.toolsGroup);
        clearChildren(this.frontAxesGroup);
        clearChildren(this.annotationsGroup);
        this.drawBoxToSvg('back');
        this.drawToolsToSvg();
        this.drawBoxToSvg('front');
        this.drawAnnotationsToSvg();
        this.updateTitleSvg();
    }

    /**
     * Paint to the canvas to reflect `config`. The canvas is the only
     * visible render path now (the SVG is kept for export only), so this
     * is what `updatePreview` calls every frame.
     * CONTRACT (v4): `opts.math` shared context (created from config when omitted).
     */
    renderCanvas(config: RendererConfig, opts?: { math?: MathContext }) {
        this.prepareScene(config, opts?.math);
        this.sizeCanvas(config);
        this.paintCanvas();
    }

    /**
     * Canvas dimensions, hi-DPI aware. The internal pixel buffer is the
     * hi-DPI size; CSS sizing is left to the .tikz-3d-canvas rule
     * (width: 100% / height: 100% of the root) so the canvas tracks
     * whatever box the SVG would occupy. Otherwise an inline pixel
     * width would over-ride CSS and the canvas would visibly clip /
     * appear larger than the SVG once the root hit its max-width.
     * Only the canvas path sizes the buffer, so SVG-only users (inline
     * notes) never allocate it.
     */
    private sizeCanvas(config: RendererConfig) {
        const dpr = window.devicePixelRatio || 1;
        const pxW = Math.round(config.width * dpr);
        const pxH = Math.round(config.height * dpr);
        if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
            this.canvas.width = pxW;
            this.canvas.height = pxH;
        }
    }

    /**
     * Compute the largest box that fits in the parent's content area with
     * the configured `aspectW / aspectH` ratio, and write it to the root's
     * inline width/height. Memoized: skips the DOM write when parent /
     * config dimensions are unchanged, so a 60fps drag does not write
     * inline styles each frame. If the parent measures 0 (modal hasn't
     * finished laying out yet), falls back to the configured size.
     */
    private applyRootFitContain(aspectW: number, aspectH: number) {
        const parent = this.root.parentElement;
        let parentW = 0;
        let parentH = 0;
        if (parent) {
            const rect = parent.getBoundingClientRect();
            const style = getComputedStyle(parent);
            const padX = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
            const padY = parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0');
            parentW = Math.max(0, rect.width - padX);
            parentH = Math.max(0, rect.height - padY);
        }

        let w: number;
        let h: number;
        if (parentW < 1 || parentH < 1) {
            // Layout not settled yet (first paint inside `onOpen` before
            // the modal has fully sized itself). Use the configured logical
            // size as a sensible fallback; the next render after layout
            // settles will measure properly.
            w = aspectW;
            h = aspectH;
        } else {
            // Fit the largest possible box of the requested aspect into the
            // parent's content area. Notably, we do NOT cap at the
            // configured (aspectW, aspectH) - the canvas should scale UP to
            // use the available preview space, not stay locked to the
            // configured "logical" pixel size, which is purely an export
            // hint via Width/Height (cm).
            const containerRatio = parentW / parentH;
            const configRatio = aspectW / aspectH;
            if (containerRatio > configRatio) {
                // Container is wider than the chart aspect - height is the bottleneck.
                h = parentH;
                w = h * configRatio;
            } else {
                // Container is taller than the chart aspect - width is the bottleneck.
                w = parentW;
                h = w / configRatio;
            }
            w = Math.max(100, w);
            h = Math.max(100, h);
        }

        const last = this.lastFit;
        if (
            last &&
            last.parentW === parentW &&
            last.parentH === parentH &&
            last.configW === aspectW &&
            last.configH === aspectH
        ) {
            // Inputs unchanged; previous (w, h) already on the element.
            return;
        }
        this.lastFit = { parentW, parentH, configW: aspectW, configH: aspectH, w, h };
        // The aspect-ratio reset clears any inline style left over from
        // previous plugin versions.
        this.root.setCssStyles({ width: w + 'px', height: h + 'px', aspectRatio: '' });
    }

    /**
     * Shared phase: refresh camera, resize SVG, evaluate tools, sample
     * surfaces (cached if possible), project, sort. Leaves the result in
     * `this.quads`, the tool marks, the texts and `this.issues`.
     */
    private prepareScene(config: RendererConfig, shared?: MathContext) {
        this.config = config;
        this.issues = [];
        this.colorCache.clear();
        this.refreshThemeColors();
        const math = shared || contextFromConfig(config);

        // SVG dimensions (only matters for the SVG path, but cheap to set).
        this.svg.setAttribute('width', String(config.width));
        this.svg.setAttribute('height', String(config.height));
        this.svg.setAttribute('viewBox', `0 0 ${config.width} ${config.height}`);
        this.backgroundRect.setAttribute('width', String(config.width));
        this.backgroundRect.setAttribute('height', String(config.height));
        // Fit-contain the root inside the preview area. Measure the parent
        // each render and write explicit pixel width/height that preserve
        // the configured aspect ratio. Previously we relied on CSS
        // `aspect-ratio` + `max-width: 100%` + `max-height: 100%`, but
        // when both axes were constrained the aspect-ratio rule was
        // ignored and the root went rectangular - canvas (CSS 100%/100%)
        // then stretched while SVG (`preserveAspectRatio` default)
        // letter-boxed, causing a visible flash between the two paths.
        this.applyRootFitContain(config.width, config.height);

        this.centerX = config.width / 2;
        this.centerY = config.height / 2 + 20;
        const availW = config.width - PADDING_LEFT - PADDING_RIGHT;
        const availH = config.height - PADDING_TOP - PADDING_BOTTOM;
        const zoom = Math.max(0.1, Math.min(10, config.zoom3D || 1));
        this.scale = Math.min(availW, availH) * VIEWPORT_SCALE * zoom;
        const az = (config.rotationZ * Math.PI) / 180;
        const el = (config.rotationX * Math.PI) / 180;
        this.cosA = Math.cos(az);
        this.sinA = Math.sin(az);
        this.cosE = Math.cos(el);
        this.sinE = Math.sin(el);

        // Per-axis normalization. The box and surfaces share this space.
        //  - 'equal': each axis spans [-1, 1] independently - cube box.
        //  - 'true':  divide every axis by the LARGEST range so the box's
        //    edge lengths reflect data proportions while still fitting
        //    the canvas (a non-normalising "true" projection would put
        //    box corners far off-canvas for typical data ranges).
        const xRange = config.xmax - config.xmin || 1;
        const yRange = config.ymax - config.ymin || 1;
        const zRange = config.zmax - config.zmin || 1;
        this.xCenter = (config.xmin + config.xmax) / 2;
        this.yCenter = (config.ymin + config.ymax) / 2;
        this.zCenter = (config.zmin + config.zmax) / 2;
        if (config.boxAspect === 'true') {
            const maxRange = Math.max(xRange, yRange, zRange);
            this.xNormFactor = 2 / maxRange;
            this.yNormFactor = 2 / maxRange;
            this.zNormFactor = 2 / maxRange;
        } else {
            this.xNormFactor = 2 / xRange;
            this.yNormFactor = 2 / yRange;
            this.zNormFactor = 2 / zRange;
        }

        // Tools first: points tools publish derived names (P1_x, ...) that
        // surfaces and labels may read.
        const scene = this.computeTools(config, math);

        const allQuads: Quad[] = [];
        this.prepareSurfaces(math, allQuads);
        this.planeOutlines = [];
        scene.planes.forEach((plane, i) => this.pushPlane(plane, i, allQuads));
        allQuads.sort(quadDepthCompare);
        this.quads = allQuads;

        for (const issue of scene.issues) this.issues.push(issue);
        this.prepareSegments(scene);
        this.prepareMarkers(scene);
        this.prepareAnnotations(math);
        this.titleText = this.prepareTitle(math);

        this.prepareBox();
    }

    /** Title text for the preview; a template problem is reported on the chart's title field like the 2D chart does. */
    private prepareTitle(math: MathContext): string {
        const raw = String(this.config?.title ?? '');
        if (!raw.trim()) return '';
        const check = math.validate(raw, 'template', undefined, LABEL_LOCALS.plain);
        if (!check.ok) this.issues.push({ source: 'chart', field: 'title', message: check.message, severity: 'error' });
        return labelDisplayText(math.formatTemplate(raw), stripLatex);
    }

    /**
     * Planes, points and segments via the scene. A throwing scene (it never
     * should) costs only the tools: surfaces and labels still render.
     */
    private computeTools(config: RendererConfig, math: MathContext): Scene3D {
        let scene: Scene3D;
        try {
            // Also called without tools: the scene then clears derived
            // values left over from tools that no longer draw in 3D.
            scene = computeScene3D({
                tools: Array.isArray(config.tools) ? config.tools : [],
                math,
                view: {
                    xmin: config.xmin,
                    xmax: config.xmax,
                    ymin: config.ymin,
                    ymax: config.ymax,
                    zmin: config.zmin,
                    zmax: config.zmax,
                },
            });
        } catch (e) {
            this.issues.push({ source: 'chart', message: `Shapes could not be drawn: ${errorMessage(e)}`, severity: 'error' });
            return NO_TOOLS;
        }
        // The scene publishes derived values itself; repeating it is a no-op
        // then, and keeps labels working if it only returned them.
        if (scene.derived) math.setDerived(scene.derived);
        return scene;
    }

    /** Sample (cached) and project every visible surface into `out`. */
    private prepareSurfaces(math: MathContext, out: Quad[]) {
        const cfg = this.requireConfig();
        const surfaces = Array.isArray(cfg.functions3D) ? cfg.functions3D : [];

        // Prune stale cache entries.
        const liveCount = surfaces.length;
        for (const idx of Array.from(this.dataCache.keys())) {
            if (idx >= liveCount) this.dataCache.delete(idx);
        }

        for (let i = 0; i < liveCount; i++) {
            const func = surfaces[i];
            // Hidden surfaces keep their cache so showing them again is instant.
            if (!func || func.hidden) continue;
            if (!func.expression || !func.expression.trim()) {
                this.dataCache.delete(i);
                continue;
            }
            // Same fallback name as the editor's status chip uses for unnamed surfaces.
            const source = func.name || `Surface ${i + 1}`;
            let fn: (x: number, y: number) => number;
            try {
                fn = math.fn2(func.expression);
            } catch (e) {
                this.issues.push({ source, field: 'expression', message: errorMessage(e), severity: 'error' });
                this.dataCache.delete(i);
                continue;
            }
            const xDomain = this.surfaceDomain(math, func.xDomain, [cfg.xmin, cfg.xmax], source, 'xDomain');
            const yDomain = this.surfaceDomain(math, func.yDomain, [cfg.ymin, cfg.ymax], source, 'yDomain');
            const data = this.getSurfaceData(i, func, fn, xDomain, yDomain, math);
            this.projectQuads(data, func, out);
        }
    }

    /**
     * A surface's x / y domain. Empty follows the view; a broken domain is
     * reported on its field and also falls back to the view range so the
     * surface stays visible while the user is typing.
     */
    private surfaceDomain(
        math: MathContext,
        src: string,
        fallback: [number, number],
        source: string,
        field: 'xDomain' | 'yDomain'
    ): [number, number] {
        if (!src || !src.trim()) return fallback;
        try {
            return math.domain(src);
        } catch (e) {
            this.issues.push({ source, field, message: errorMessage(e), severity: 'error' });
            return fallback;
        }
    }

    /**
     * Compute the 12 box edges, classify them as front/back, and decide
     * which edges hold the x/y/z tick marks based on which face is away
     * from the camera.
     */
    private prepareBox() {
        const cfg = this.requireConfig();
        const { xmin, xmax, ymin, ymax, zmin, zmax } = cfg;

        // 8 corners indexed by bit pattern: bit 0 = x (0=min, 1=max), bit 1 = y, bit 2 = z.
        const corners: ProjectedPoint[] = [
            this.project(xmin, ymin, zmin), // 0: ---
            this.project(xmax, ymin, zmin), // 1: x++
            this.project(xmin, ymax, zmin), // 2: y++
            this.project(xmax, ymax, zmin), // 3: xy++
            this.project(xmin, ymin, zmax), // 4: z++
            this.project(xmax, ymin, zmax), // 5: xz++
            this.project(xmin, ymax, zmax), // 6: yz++
            this.project(xmax, ymax, zmax), // 7: xyz++
        ];
        this.boxCorners = corners;

        let cdepth = 0;
        let csx = 0;
        let csy = 0;
        for (const c of corners) {
            cdepth += c.depth;
            csx += c.sx;
            csy += c.sy;
        }
        cdepth /= 8;
        csx /= 8;
        csy /= 8;

        // 12 edges of the cuboid as corner-index pairs.
        const edgeIndices: [number, number][] = [
            // Bottom face (z=zmin).
            [0, 1], [1, 3], [3, 2], [2, 0],
            // Top face (z=zmax).
            [4, 5], [5, 7], [7, 6], [6, 4],
            // Vertical edges connecting bottom and top.
            [0, 4], [1, 5], [2, 6], [3, 7],
        ];
        this.boxEdges = edgeIndices.map(([i, j]) => {
            const midDepth = (corners[i].depth + corners[j].depth) / 2;
            return {
                p1Idx: i,
                p2Idx: j,
                layer: midDepth < cdepth ? 'back' : 'front',
            };
        });

        // Pick the back face along each direction so ticks live on the edge
        // the user is "looking into".
        const yMinFace = this.project((xmin + xmax) / 2, ymin, (zmin + zmax) / 2);
        const yMaxFace = this.project((xmin + xmax) / 2, ymax, (zmin + zmax) / 2);
        const yBack = yMinFace.depth < yMaxFace.depth ? ymin : ymax;

        const xMinFace = this.project(xmin, (ymin + ymax) / 2, (zmin + zmax) / 2);
        const xMaxFace = this.project(xmax, (ymin + ymax) / 2, (zmin + zmax) / 2);
        const xBack = xMinFace.depth < xMaxFace.depth ? xmin : xmax;

        // Tick-bearing edges.
        const xP1 = this.project(xmin, yBack, zmin);
        const xP2 = this.project(xmax, yBack, zmin);
        this.xTickEdge = this.buildTickEdge(xP1, xP2, yBack, zmin, csx, csy);

        const yP1 = this.project(xBack, ymin, zmin);
        const yP2 = this.project(xBack, ymax, zmin);
        this.yTickEdge = this.buildTickEdge(yP1, yP2, xBack, zmin, csx, csy);

        const zP1 = this.project(xBack, yBack, zmin);
        const zP2 = this.project(xBack, yBack, zmax);
        this.zTickEdge = this.buildTickEdge(zP1, zP2, xBack, yBack, csx, csy);
    }

    private buildTickEdge(p1: ProjectedPoint, p2: ProjectedPoint, fixedA: number, fixedB: number, centroidSx: number, centroidSy: number): TickEdge {
        const ex = p2.sx - p1.sx;
        const ey = p2.sy - p1.sy;
        let perpX = -ey;
        let perpY = ex;
        const len = Math.hypot(perpX, perpY) || 1;
        perpX /= len;
        perpY /= len;
        const mx = (p1.sx + p2.sx) / 2;
        const my = (p1.sy + p2.sy) / 2;
        const towardOutside = (mx - centroidSx) * perpX + (my - centroidSy) * perpY;
        if (towardOutside < 0) {
            perpX = -perpX;
            perpY = -perpY;
        }
        return { p1, p2, fixedA, fixedB, outwardX: perpX, outwardY: perpY };
    }

    private refreshThemeColors() {
        const cs = getComputedStyle(activeDocument.body);
        this.themeColors.textNormal = cs.getPropertyValue('--text-normal').trim() || '#000';
        this.themeColors.textMuted = cs.getPropertyValue('--text-muted').trim() || '#666';
        this.themeColors.bgPrimary = cs.getPropertyValue('--background-primary').trim() || '#fff';
        // Canvas `font` does not understand var(): an invalid font string is
        // silently ignored and the previous (10px) font stays. Resolve the
        // theme's text font once and keep it only if the canvas accepts it.
        const family = cs.getPropertyValue('--font-text').trim();
        if (family !== this.fontFamilySource) {
            this.fontFamilySource = family;
            this.fontFamily = 'sans-serif';
            if (family) {
                this.ctx.font = '10px sans-serif';
                const before = this.ctx.font;
                this.ctx.font = `10px ${family}`;
                if (this.ctx.font !== before) this.fontFamily = family;
            }
        }
    }

    /** Canvas font shorthand in the theme's text font. */
    private canvasFont(px: number, weight = ''): string {
        return `${weight ? weight + ' ' : ''}${px}px ${this.fontFamily}`;
    }

    /** Concrete colour for a palette key or raw CSS colour; empty means the theme text colour. */
    private colorInfo(key: string): ColorInfo {
        const k = key || 'black';
        let info = this.colorCache.get(k);
        if (!info) {
            const css = resolveCssColor(COLOR_MAP[k] || k);
            info = { css, rgb: hexToRgb(css) || rgbStringToRgb(css), shades: null };
            this.colorCache.set(k, info);
        }
        return info;
    }

    /**
     * Surface data (cached). The key holds everything the samples depend
     * on: the expression, the resolved numeric domains, the resolution, the
     * z range and `depsKey` (values of the parameters / derived names the
     * expression reads, sources of the functions it calls). A slider the
     * surface does not use, or a camera move, therefore never re-samples.
     */
    private getSurfaceData(
        idx: number,
        func: Function3DParameters,
        fn: (x: number, y: number) => number,
        xDomain: [number, number],
        yDomain: [number, number],
        math: MathContext
    ): SurfaceData {
        const cfg = this.requireConfig();
        const samples = Math.max(4, Math.min(MAX_PREVIEW_SAMPLES_3D, Math.round(func.samples) || DEFAULT_GRID_SAMPLES));
        const key = [
            func.expression,
            `${xDomain[0]}:${xDomain[1]}`,
            `${yDomain[0]}:${yDomain[1]}`,
            cfg.zmin,
            cfg.zmax,
            samples,
            math.depsKey([func.expression]),
        ].join('|');
        const existing = this.dataCache.get(idx);
        if (existing && existing.key === key) return existing;

        const [xmin, xmax] = xDomain;
        const [ymin, ymax] = yDomain;
        const stride = samples + 1;
        const total = stride * stride;
        const xs = new Float64Array(total);
        const ys = new Float64Array(total);
        const zs = new Float64Array(total);
        const stepX = (xmax - xmin) / samples;
        const stepY = (ymax - ymin) / samples;
        // Compiled closures never throw; runtime failures come back as NaN.
        for (let i = 0; i <= samples; i++) {
            const x = xmin + i * stepX;
            const rowOffset = i * stride;
            for (let j = 0; j <= samples; j++) {
                const y = ymin + j * stepY;
                const off = rowOffset + j;
                xs[off] = x;
                ys[off] = y;
                const z = fn(x, y);
                zs[off] = Number.isFinite(z) ? z : NaN;
            }
        }

        const data: SurfaceData = { key, samples, xs, ys, zs };
        this.dataCache.set(idx, data);
        return data;
    }

    /** Project cached samples and emit one Quad per grid cell. */
    private projectQuads(data: SurfaceData, func: Function3DParameters, out: Quad[]) {
        const cfg = this.requireConfig();
        const { zmin, zmax } = cfg;
        const zRange = zmax - zmin || 1;
        const zRangeInv = 1 / zRange;

        const samples = data.samples;
        const stride = samples + 1;
        const total = stride * stride;

        if (this.sxBuf.length < total) {
            this.sxBuf = new Float64Array(total);
            this.syBuf = new Float64Array(total);
            this.depthBuf = new Float64Array(total);
        }
        const sxBuf = this.sxBuf;
        const syBuf = this.syBuf;
        const depthBuf = this.depthBuf;

        const cosA = this.cosA;
        const sinA = this.sinA;
        const cosE = this.cosE;
        const sinE = this.sinE;
        const cx = this.centerX;
        const cy = this.centerY;
        const scl = this.scale;
        // Per-axis normalization (shared with `project` so surfaces stay
        // aligned with the box outline). See `prepareScene` for how these
        // are set from `config.boxAspect`.
        const xCenter = this.xCenter;
        const yCenter = this.yCenter;
        const zCenter = this.zCenter;
        const xNF = this.xNormFactor;
        const yNF = this.yNormFactor;
        const zNF = this.zNormFactor;

        for (let k = 0; k < total; k++) {
            const z = data.zs[k];
            if (Number.isNaN(z)) {
                depthBuf[k] = -Infinity;
                continue;
            }
            const x = data.xs[k];
            const y = data.ys[k];
            const nx = (x - xCenter) * xNF;
            const ny = (y - yCenter) * yNF;
            const nz = (z - zCenter) * zNF;

            const rx = nx * cosA - ny * sinA;
            const ry = nx * sinA + ny * cosA;
            const ry2 = ry * cosE - nz * sinE;
            const rz2 = ry * sinE + nz * cosE;

            sxBuf[k] = cx + rx * scl;
            syBuf[k] = cy - rz2 * scl;
            depthBuf[k] = ry2;
        }

        const color = this.colorInfo(func.color);
        const rgb = color.rgb;
        let shades = color.shades;
        if (rgb && !shades) {
            shades = [];
            for (let k = 0; k < SHADE_LEVELS; k++) shades.push(shadeRgb(rgb, k / (SHADE_LEVELS - 1)));
            color.shades = shades;
        }
        const wireframe = func.wireframe;
        const opacity = Number.isFinite(func.opacity) ? Math.max(0, Math.min(1, func.opacity)) : 0.7;
        const zs = data.zs;
        for (let i = 0; i < samples; i++) {
            const rowA = i * stride;
            const rowB = rowA + stride;
            for (let j = 0; j < samples; j++) {
                const i00 = rowA + j;
                const i10 = rowB + j;
                const i01 = rowA + j + 1;
                const i11 = rowB + j + 1;
                const d00 = depthBuf[i00];
                const d10 = depthBuf[i10];
                const d01 = depthBuf[i01];
                const d11 = depthBuf[i11];
                if (d00 === -Infinity || d10 === -Infinity || d01 === -Infinity || d11 === -Infinity) continue;
                const avgDepth = (d00 + d10 + d11 + d01) * 0.25;
                let fill = color.css;
                if (!wireframe && shades) {
                    const t = ((zs[i00] + zs[i10] + zs[i01] + zs[i11]) * 0.25 - zmin) * zRangeInv;
                    fill = shades[Math.round((t < 0 ? 0 : t > 1 ? 1 : t) * (SHADE_LEVELS - 1))];
                }
                out.push({
                    p0x: sxBuf[i00], p0y: syBuf[i00],
                    p1x: sxBuf[i10], p1y: syBuf[i10],
                    p2x: sxBuf[i11], p2y: syBuf[i11],
                    p3x: sxBuf[i01], p3y: syBuf[i01],
                    depth: avgDepth,
                    fill,
                    stroke: color.css,
                    wireframe,
                    opacity,
                    plane: -1,
                });
            }
        }
    }

    /**
     * A plane spanning the box at a constant x, y or z: emit its cells into
     * the sorted quad list and remember its border. Planes outside the box
     * are not drawn.
     */
    private pushPlane(plane: Scene3D['planes'][number], index: number, out: Quad[]) {
        const cfg = this.requireConfig();
        const c = plane.value;
        const [lo, hi] = plane.axis === 'x' ? [cfg.xmin, cfg.xmax] : plane.axis === 'y' ? [cfg.ymin, cfg.ymax] : [cfg.zmin, cfg.zmax];
        const tol = 1e-9 * Math.abs(hi - lo);
        if (!Number.isFinite(c) || c < lo - tol || c > hi + tol) return;

        // (u, v) are the two in-plane axes, each spanning the box.
        const [uMin, uMax, vMin, vMax] =
            plane.axis === 'x' ? [cfg.ymin, cfg.ymax, cfg.zmin, cfg.zmax] :
            plane.axis === 'y' ? [cfg.xmin, cfg.xmax, cfg.zmin, cfg.zmax] :
            [cfg.xmin, cfg.xmax, cfg.ymin, cfg.ymax];
        const at = (u: number, v: number): ProjectedPoint =>
            plane.axis === 'x' ? this.project(c, u, v) :
            plane.axis === 'y' ? this.project(u, c, v) :
            this.project(u, v, c);

        const n = PLANE_CELLS;
        const stride = n + 1;
        const grid: ProjectedPoint[] = [];
        for (let i = 0; i <= n; i++) {
            const u = uMin + ((uMax - uMin) * i) / n;
            for (let j = 0; j <= n; j++) grid.push(at(u, vMin + ((vMax - vMin) * j) / n));
        }

        const css = this.colorInfo(plane.color).css;
        const opacity = Number.isFinite(plane.opacity) ? Math.max(0, Math.min(1, plane.opacity)) : 0.2;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const a = grid[i * stride + j];
                const b = grid[(i + 1) * stride + j];
                const d = grid[(i + 1) * stride + j + 1];
                const e = grid[i * stride + j + 1];
                out.push({
                    p0x: a.sx, p0y: a.sy,
                    p1x: b.sx, p1y: b.sy,
                    p2x: d.sx, p2y: d.sy,
                    p3x: e.sx, p3y: e.sy,
                    depth: (a.depth + b.depth + d.depth + e.depth) * 0.25,
                    fill: css,
                    stroke: css,
                    wireframe: false,
                    opacity,
                    plane: index,
                });
            }
        }
        this.planeOutlines.push({
            pts: [at(uMin, vMin), at(uMax, vMin), at(uMax, vMax), at(uMin, vMax)],
            color: css,
            opacity: Math.min(1, opacity + 0.3),
        });
    }

    /** Clip every segment leg to the box and project it, with arrow heads at unclipped ends. */
    private prepareSegments(scene: Scene3D) {
        const cfg = this.requireConfig();
        const lo: [number, number, number] = [cfg.xmin, cfg.ymin, cfg.zmin];
        const hi: [number, number, number] = [cfg.xmax, cfg.ymax, cfg.zmax];
        this.segmentMarks = [];
        for (const seg of scene.segments) {
            const { a, b } = seg;
            if (![...a, ...b].every(Number.isFinite)) continue;
            const span = clipToBox(a, b, lo, hi);
            if (!span) continue;
            const [t0, t1] = span;
            const lerp = (t: number, k: number) => a[k] + (b[k] - a[k]) * t;
            const p1 = this.project(lerp(t0, 0), lerp(t0, 1), lerp(t0, 2));
            const p2 = this.project(lerp(t1, 0), lerp(t1, 1), lerp(t1, 2));
            const width = THICKNESS_MAP[seg.width] || 1.5;
            const mark: SegmentMark = {
                x1: p1.sx, y1: p1.sy,
                x2: p2.sx, y2: p2.sy,
                color: this.colorInfo(seg.color).css,
                width,
                dashed: !!seg.dashed,
                heads: [],
            };
            // A head on a clipped end would point at the box wall, not at the real endpoint.
            const arrow: ArrowHeads | undefined = seg.arrow;
            const len = Math.hypot(p2.sx - p1.sx, p2.sy - p1.sy);
            if (arrow && len > 1e-6) {
                const ux = (p2.sx - p1.sx) / len;
                const uy = (p2.sy - p1.sy) / len;
                // Heads grow with the line width but never swallow a short (foreshortened) leg.
                const hl = Math.min(6 + 2 * width, len * 0.45);
                const hw = hl * 0.6;
                if ((arrow === 'forward' || arrow === 'both') && t1 >= 1) {
                    mark.heads.push(arrowHead(p2.sx, p2.sy, ux, uy, hl, hw));
                    mark.x2 -= ux * hl * 0.75;
                    mark.y2 -= uy * hl * 0.75;
                }
                if ((arrow === 'backward' || arrow === 'both') && t0 <= 0) {
                    mark.heads.push(arrowHead(p1.sx, p1.sy, -ux, -uy, hl, hw));
                    mark.x1 += ux * hl * 0.75;
                    mark.y1 += uy * hl * 0.75;
                }
            }
            this.segmentMarks.push(mark);
        }
    }

    /** Project the scene's points; points outside the box are not drawn. */
    private prepareMarkers(scene: Scene3D) {
        const cfg = this.requireConfig();
        this.markerMarks = [];
        for (const p of scene.points) {
            if (!insideRange(p.x, cfg.xmin, cfg.xmax) || !insideRange(p.y, cfg.ymin, cfg.ymax) || !insideRange(p.z, cfg.zmin, cfg.zmax)) continue;
            const q = this.project(p.x, p.y, p.z);
            this.markerMarks.push({
                sx: q.sx,
                sy: q.sy,
                r: MARKER_RADIUS[p.size] || MARKER_RADIUS.normal,
                color: this.colorInfo(p.color).css,
                label: p.label ? labelDisplayText(p.label, stripLatex) : '',
            });
        }
    }

    /**
     * Labels: positions via `math.value` (expressions, parameters and
     * derived names), text via `formatTemplate`. Hidden labels are skipped;
     * a position that does not evaluate is reported and the label dropped.
     */
    private prepareAnnotations(math: MathContext) {
        const cfg = this.requireConfig();
        const annotations = Array.isArray(cfg.annotations) ? cfg.annotations : [];
        this.annotationMarks = [];
        annotations.forEach((a, index) => {
            if (!a || a.hidden || !a.text) return;
            const source = `label:${index}`;
            const coord = (src: string | undefined, field: 'x' | 'y' | 'z'): number => {
                // Labels migrated from a 2D chart have no z: they sit on z = 0.
                if (field === 'z' && (src === undefined || src === null || !String(src).trim())) return 0;
                const v = math.value(src);
                if (Number.isFinite(v)) return v;
                const res = math.tryValue(src);
                this.issues.push({ source, field, message: res.ok ? 'Not a finite number' : res.message, severity: 'error' });
                return NaN;
            };
            const x = coord(a.x, 'x');
            const y = coord(a.y, 'y');
            const z = coord(a.z, 'z');
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;

            const formatted = math.formatTemplate(a.text);
            // formatTemplate renders a failing placeholder as '?'; say why on the text field.
            if (formatted.includes('?') && a.text.includes('{')) {
                const check = math.validate(a.text, 'template');
                if (!check.ok) this.issues.push({ source, field: 'text', message: check.message, severity: 'error' });
            }
            const text = labelDisplayText(formatted, stripLatex);
            if (!text) return;

            const p = this.project(x, y, z);
            let align: TextMark['align'] = 'middle';
            let dx = 0;
            let dy = 4;
            switch (a.anchor) {
                case 'above': dy = -6; break;
                case 'below': dy = 14; break;
                case 'left': align = 'end'; dx = -6; break;
                case 'right': align = 'start'; dx = 6; break;
                case 'center': default: break;
            }
            this.annotationMarks.push({
                x: p.sx + dx,
                y: p.sy + dy,
                text,
                color: this.colorInfo(a.color).css,
                fontSize: ANNOTATION_FONT_SIZE[a.size] || ANNOTATION_FONT_SIZE.normal,
                align,
            });
        });
    }

    private project(x: number, y: number, z: number): { sx: number; sy: number; depth: number } {
        // Use the per-axis normalization computed in prepareScene so the
        // box and surfaces honour `boxAspect`: 'equal' uses each axis's own
        // range (cube), 'true' uses the largest range for all axes (data
        // proportions).
        const nx = (x - this.xCenter) * this.xNormFactor;
        const ny = (y - this.yCenter) * this.yNormFactor;
        const nz = (z - this.zCenter) * this.zNormFactor;
        const rx = nx * this.cosA - ny * this.sinA;
        const ry = nx * this.sinA + ny * this.cosA;
        const ry2 = ry * this.cosE - nz * this.sinE;
        const rz2 = ry * this.sinE + nz * this.cosE;
        return { sx: this.centerX + rx * this.scale, sy: this.centerY - rz2 * this.scale, depth: ry2 };
    }

    // ---- SVG path ----

    private updateSurfacePool(quads: Quad[]) {
        const pool = this.surfacePool;
        const surfaceGroup = this.surfaceGroup;
        let used = 0;
        const next = (): SVGPathElement => {
            if (used === pool.length) {
                const path = createSvg('path');
                surfaceGroup.appendChild(path);
                pool.push(path);
            }
            const path = pool[used++];
            // Visibility via the SVG `display` presentation attribute rather
            // than inline style - same effect, and it serializes with the
            // element on export.
            if (path.hasAttribute('display')) path.removeAttribute('display');
            return path;
        };

        for (let i = 0; i < quads.length; i++) {
            const q = quads[i];
            const path = next();
            if (q.plane >= 0) {
                // One path for the run of consecutive cells of this plane.
                let d = quadPathData(q);
                while (i + 1 < quads.length && quads[i + 1].plane === q.plane) d += ' ' + quadPathData(quads[++i]);
                path.setAttribute('d', d);
                path.setAttribute('fill', q.fill);
                path.setAttribute('fill-opacity', String(q.opacity));
                path.setAttribute('stroke', 'none');
                path.removeAttribute('stroke-width');
                path.removeAttribute('stroke-opacity');
                continue;
            }
            path.setAttribute('d', quadPathData(q));
            if (q.wireframe) {
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', q.stroke);
                path.setAttribute('stroke-width', '0.5');
                path.setAttribute('stroke-opacity', String(q.opacity));
                path.removeAttribute('fill-opacity');
            } else {
                path.setAttribute('fill', q.fill);
                path.setAttribute('fill-opacity', String(q.opacity));
                path.setAttribute('stroke', q.stroke);
                path.setAttribute('stroke-width', '0.3');
                path.setAttribute('stroke-opacity', '0.4');
            }
        }
        for (let i = used; i < pool.length; i++) {
            const path = pool[i];
            if (path.getAttribute('display') !== 'none') path.setAttribute('display', 'none');
        }
    }

    private drawToolsToSvg() {
        const group = this.toolsGroup;
        for (const o of this.planeOutlines) {
            const poly = createSvg('polygon');
            poly.setAttribute('points', o.pts.map((p) => `${p.sx.toFixed(2)},${p.sy.toFixed(2)}`).join(' '));
            poly.setAttribute('fill', 'none');
            poly.setAttribute('stroke', o.color);
            poly.setAttribute('stroke-opacity', String(o.opacity));
            poly.setAttribute('stroke-width', '1');
            group.appendChild(poly);
        }
        for (const s of this.segmentMarks) {
            const line = createSvg('line');
            line.setAttribute('x1', s.x1.toFixed(2));
            line.setAttribute('y1', s.y1.toFixed(2));
            line.setAttribute('x2', s.x2.toFixed(2));
            line.setAttribute('y2', s.y2.toFixed(2));
            line.setAttribute('stroke', s.color);
            line.setAttribute('stroke-width', String(s.width));
            line.setAttribute('stroke-linecap', 'round');
            if (s.dashed) line.setAttribute('stroke-dasharray', '6 4');
            group.appendChild(line);
            // Heads are plain triangles: no <marker> ids that could collide between charts.
            for (const h of s.heads) {
                const head = createSvg('polygon');
                head.setAttribute('points', `${h[0].toFixed(2)},${h[1].toFixed(2)} ${h[2].toFixed(2)},${h[3].toFixed(2)} ${h[4].toFixed(2)},${h[5].toFixed(2)}`);
                head.setAttribute('fill', s.color);
                group.appendChild(head);
            }
        }
        for (const m of this.markerMarks) {
            const circle = createSvg('circle');
            circle.setAttribute('cx', m.sx.toFixed(2));
            circle.setAttribute('cy', m.sy.toFixed(2));
            circle.setAttribute('r', String(m.r));
            circle.setAttribute('fill', m.color);
            circle.setAttribute('stroke', this.themeColors.bgPrimary);
            circle.setAttribute('stroke-width', '1.5');
            group.appendChild(circle);
        }
        for (const m of this.markerMarks) {
            if (!m.label) continue;
            const text = createSvg('text');
            text.setAttribute('x', (m.sx + m.r + 2).toFixed(2));
            text.setAttribute('y', (m.sy - m.r - 2).toFixed(2));
            text.setAttribute('fill', m.color);
            text.setAttribute('font-size', '11');
            text.setAttribute('font-family', 'var(--font-text)');
            // Background halo keeps the label readable on top of a surface.
            text.setAttribute('stroke', this.themeColors.bgPrimary);
            text.setAttribute('stroke-width', '3');
            text.setAttribute('stroke-linejoin', 'round');
            text.setAttribute('paint-order', 'stroke');
            text.textContent = m.label;
            group.appendChild(text);
        }
    }

    private drawAnnotationsToSvg() {
        const group = this.annotationsGroup;
        for (const a of this.annotationMarks) {
            const t = createSvg('text');
            t.setAttribute('x', String(a.x));
            t.setAttribute('y', String(a.y));
            t.setAttribute('text-anchor', a.align);
            t.setAttribute('fill', a.color);
            t.setAttribute('font-size', String(a.fontSize));
            t.setAttribute('font-weight', '500');
            t.setAttribute('font-family', 'var(--font-text)');
            t.textContent = a.text;
            group.appendChild(t);
        }
    }

    /** Draw the cuboid edges plus (front layer only) tick marks and labels. */
    private drawBoxToSvg(layer: 'back' | 'front') {
        const cfg = this.requireConfig();
        const axisGroup = layer === 'back' ? this.backAxesGroup : this.frontAxesGroup;
        const axisColor = 'var(--text-muted)';

        // Edges classified to this layer.
        for (const edge of this.boxEdges) {
            if (edge.layer !== layer) continue;
            const c1 = this.boxCorners[edge.p1Idx];
            const c2 = this.boxCorners[edge.p2Idx];
            this.svgLine(axisGroup, c1.sx, c1.sy, c2.sx, c2.sy, axisColor, '1', layer === 'back' ? 0.4 : 0.85);
        }

        // Tick marks, tick labels, and axis-name labels live in the front
        // layer so they are never occluded by the surface.
        if (layer === 'front') {
            this.drawTicksToSvg(axisGroup);
            if (cfg.showAxisLabels) this.drawAxisNameLabelsToSvg(axisGroup);
        }
    }

    private drawTicksToSvg(group: SVGElement) {
        if (this.xTickEdge) this.drawTicksOnEdgeSvg(group, 'x', this.xTickEdge);
        if (this.yTickEdge) this.drawTicksOnEdgeSvg(group, 'y', this.yTickEdge);
        if (this.zTickEdge) this.drawTicksOnEdgeSvg(group, 'z', this.zTickEdge);
    }

    private drawTicksOnEdgeSvg(group: SVGElement, axis: 'x' | 'y' | 'z', edge: TickEdge) {
        const cfg = this.requireConfig();
        const target = cfg.majorTickNum ? Math.max(2, Math.round(cfg.majorTickNum * 0.6)) : DEFAULT_TARGET_TICKS;
        const [min, max] = axis === 'x' ? [cfg.xmin, cfg.xmax] : axis === 'y' ? [cfg.ymin, cfg.ymax] : [cfg.zmin, cfg.zmax];
        const interval = niceInterval(max - min, target);
        const start = Math.ceil(min / interval) * interval;
        const tickColor = 'var(--text-muted)';
        const TICK_LENGTH = 6;
        const LABEL_OFFSET = 14;

        for (let v = start; v <= max + interval * 1e-6; v += interval) {
            const p =
                axis === 'x' ? this.project(v, edge.fixedA, edge.fixedB) :
                axis === 'y' ? this.project(edge.fixedA, v, edge.fixedB) :
                this.project(edge.fixedA, edge.fixedB, v);

            const markX2 = p.sx + edge.outwardX * TICK_LENGTH;
            const markY2 = p.sy + edge.outwardY * TICK_LENGTH;
            this.svgLine(group, p.sx, p.sy, markX2, markY2, tickColor, '1');

            const label = createSvg('text');
            label.setAttribute('x', String(p.sx + edge.outwardX * LABEL_OFFSET));
            label.setAttribute('y', String(p.sy + edge.outwardY * LABEL_OFFSET));
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'central');
            label.setAttribute('fill', tickColor);
            label.setAttribute('font-size', '10');
            label.setAttribute('font-family', 'var(--font-text)');
            label.textContent = formatTick(v);
            group.appendChild(label);
        }
    }

    private drawAxisNameLabelsToSvg(group: SVGElement) {
        const cfg = this.requireConfig();
        const AXIS_LABEL_OFFSET = 30;
        const edges: { edge: TickEdge | null; text: string }[] = [
            { edge: this.xTickEdge, text: labelDisplayText(cfg.xLabel, stripLatex) },
            { edge: this.yTickEdge, text: labelDisplayText(cfg.yLabel, stripLatex) },
            { edge: this.zTickEdge, text: labelDisplayText(cfg.zLabel, stripLatex) },
        ];
        for (const { edge, text } of edges) {
            if (!edge) continue;
            const mx = (edge.p1.sx + edge.p2.sx) / 2;
            const my = (edge.p1.sy + edge.p2.sy) / 2;
            const label = createSvg('text');
            label.setAttribute('x', String(mx + edge.outwardX * AXIS_LABEL_OFFSET));
            label.setAttribute('y', String(my + edge.outwardY * AXIS_LABEL_OFFSET));
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'central');
            label.setAttribute('fill', 'var(--text-normal)');
            label.setAttribute('font-size', '13');
            label.setAttribute('font-weight', '500');
            label.textContent = text;
            group.appendChild(label);
        }
    }

    private svgLine(parent: SVGElement, x1: number, y1: number, x2: number, y2: number, stroke: string, width: string, opacity?: number) {
        const line = createSvg('line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('stroke', stroke);
        line.setAttribute('stroke-width', width);
        if (opacity !== undefined && opacity !== 1) line.setAttribute('stroke-opacity', String(opacity));
        parent.appendChild(line);
    }

    private updateTitleSvg() {
        const cfg = this.requireConfig();
        if (!this.titleText) {
            this.titleEl.textContent = '';
            return;
        }
        this.titleEl.setAttribute('x', String(cfg.width / 2));
        this.titleEl.setAttribute('y', String(PADDING_TOP - 10));
        this.titleEl.textContent = this.titleText;
    }

    // ---- Canvas path ----

    private paintCanvas() {
        const cfg = this.requireConfig();
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.scale(dpr, dpr);

        // Background (matches the SVG's background rect).
        ctx.fillStyle = this.themeColors.bgPrimary;
        ctx.beginPath();
        // Rounded rect for parity with the SVG `rx=4`.
        roundedRectPath(ctx, 0, 0, cfg.width, cfg.height, 4);
        ctx.fill();

        // Back axes -> surfaces and plane cells -> tools -> front axes -> annotations -> title.
        this.drawBoxToCanvas('back');
        this.drawQuadsToCanvas(this.quads);
        this.drawToolsToCanvas();
        this.drawBoxToCanvas('front');
        this.drawAnnotationsToCanvas();
        this.drawTitleToCanvas();

        ctx.restore();
    }

    private drawQuadsToCanvas(quads: Quad[]) {
        const ctx = this.ctx;
        for (let i = 0; i < quads.length; i++) {
            const q = quads[i];
            ctx.beginPath();
            quadPath(ctx, q);
            if (q.plane >= 0) {
                // One fill for the run of consecutive cells of this plane.
                while (i + 1 < quads.length && quads[i + 1].plane === q.plane) quadPath(ctx, quads[++i]);
                ctx.fillStyle = q.fill;
                ctx.globalAlpha = q.opacity;
                ctx.fill();
                ctx.globalAlpha = 1;
            } else if (q.wireframe) {
                ctx.strokeStyle = q.stroke;
                ctx.lineWidth = 0.5;
                ctx.globalAlpha = q.opacity;
                ctx.stroke();
                ctx.globalAlpha = 1;
            } else {
                ctx.fillStyle = q.fill;
                ctx.globalAlpha = q.opacity;
                ctx.fill();
                ctx.globalAlpha = 0.4;
                ctx.strokeStyle = q.stroke;
                ctx.lineWidth = 0.3;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
        }
    }

    private drawToolsToCanvas() {
        const ctx = this.ctx;
        for (const o of this.planeOutlines) {
            ctx.beginPath();
            o.pts.forEach((p, i) => {
                if (i === 0) ctx.moveTo(p.sx, p.sy);
                else ctx.lineTo(p.sx, p.sy);
            });
            ctx.closePath();
            ctx.globalAlpha = o.opacity;
            ctx.strokeStyle = o.color;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        ctx.lineCap = 'round';
        for (const s of this.segmentMarks) {
            ctx.beginPath();
            ctx.moveTo(s.x1, s.y1);
            ctx.lineTo(s.x2, s.y2);
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.width;
            ctx.setLineDash(s.dashed ? [6, 4] : []);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = s.color;
            for (const h of s.heads) {
                ctx.beginPath();
                ctx.moveTo(h[0], h[1]);
                ctx.lineTo(h[2], h[3]);
                ctx.lineTo(h[4], h[5]);
                ctx.closePath();
                ctx.fill();
            }
        }
        ctx.lineCap = 'butt';

        for (const m of this.markerMarks) {
            ctx.beginPath();
            ctx.arc(m.sx, m.sy, m.r, 0, Math.PI * 2);
            ctx.fillStyle = m.color;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = this.themeColors.bgPrimary;
            ctx.stroke();
        }
        ctx.font = this.canvasFont(11);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = 'round';
        for (const m of this.markerMarks) {
            if (!m.label) continue;
            const x = m.sx + m.r + 2;
            const y = m.sy - m.r - 2;
            // Background halo keeps the label readable on top of a surface.
            ctx.lineWidth = 3;
            ctx.strokeStyle = this.themeColors.bgPrimary;
            ctx.strokeText(m.label, x, y);
            ctx.fillStyle = m.color;
            ctx.fillText(m.label, x, y);
        }
        ctx.lineJoin = 'miter';
    }

    /** Draw the cuboid edges on the canvas plus, in front layer, tick marks and labels. */
    private drawBoxToCanvas(layer: 'back' | 'front') {
        const ctx = this.ctx;
        const cfg = this.requireConfig();
        const axisColor = this.themeColors.textMuted;
        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = layer === 'back' ? 0.4 : 0.85;
        for (const edge of this.boxEdges) {
            if (edge.layer !== layer) continue;
            const c1 = this.boxCorners[edge.p1Idx];
            const c2 = this.boxCorners[edge.p2Idx];
            ctx.beginPath();
            ctx.moveTo(c1.sx, c1.sy);
            ctx.lineTo(c2.sx, c2.sy);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        if (layer === 'front') {
            this.drawTicksToCanvas();
            if (cfg.showAxisLabels) this.drawAxisNameLabelsToCanvas();
        }
    }

    private drawTicksToCanvas() {
        if (this.xTickEdge) this.drawTicksOnEdgeCanvas('x', this.xTickEdge);
        if (this.yTickEdge) this.drawTicksOnEdgeCanvas('y', this.yTickEdge);
        if (this.zTickEdge) this.drawTicksOnEdgeCanvas('z', this.zTickEdge);
    }

    private drawTicksOnEdgeCanvas(axis: 'x' | 'y' | 'z', edge: TickEdge) {
        const cfg = this.requireConfig();
        const ctx = this.ctx;
        const target = cfg.majorTickNum ? Math.max(2, Math.round(cfg.majorTickNum * 0.6)) : DEFAULT_TARGET_TICKS;
        const [min, max] = axis === 'x' ? [cfg.xmin, cfg.xmax] : axis === 'y' ? [cfg.ymin, cfg.ymax] : [cfg.zmin, cfg.zmax];
        const interval = niceInterval(max - min, target);
        const start = Math.ceil(min / interval) * interval;
        const TICK_LENGTH = 6;
        const LABEL_OFFSET = 14;

        ctx.strokeStyle = this.themeColors.textMuted;
        ctx.fillStyle = this.themeColors.textMuted;
        ctx.lineWidth = 1;
        ctx.font = this.canvasFont(10);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (let v = start; v <= max + interval * 1e-6; v += interval) {
            const p =
                axis === 'x' ? this.project(v, edge.fixedA, edge.fixedB) :
                axis === 'y' ? this.project(edge.fixedA, v, edge.fixedB) :
                this.project(edge.fixedA, edge.fixedB, v);
            ctx.beginPath();
            ctx.moveTo(p.sx, p.sy);
            ctx.lineTo(p.sx + edge.outwardX * TICK_LENGTH, p.sy + edge.outwardY * TICK_LENGTH);
            ctx.stroke();
            ctx.fillText(
                formatTick(v),
                p.sx + edge.outwardX * LABEL_OFFSET,
                p.sy + edge.outwardY * LABEL_OFFSET
            );
        }
    }

    private drawAxisNameLabelsToCanvas() {
        const cfg = this.requireConfig();
        const ctx = this.ctx;
        const AXIS_LABEL_OFFSET = 30;
        ctx.fillStyle = this.themeColors.textNormal;
        ctx.font = this.canvasFont(13, '500');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const edges: { edge: TickEdge | null; text: string }[] = [
            { edge: this.xTickEdge, text: labelDisplayText(cfg.xLabel, stripLatex) },
            { edge: this.yTickEdge, text: labelDisplayText(cfg.yLabel, stripLatex) },
            { edge: this.zTickEdge, text: labelDisplayText(cfg.zLabel, stripLatex) },
        ];
        for (const { edge, text } of edges) {
            if (!edge) continue;
            const mx = (edge.p1.sx + edge.p2.sx) / 2;
            const my = (edge.p1.sy + edge.p2.sy) / 2;
            ctx.fillText(text, mx + edge.outwardX * AXIS_LABEL_OFFSET, my + edge.outwardY * AXIS_LABEL_OFFSET);
        }
    }

    private drawAnnotationsToCanvas() {
        const ctx = this.ctx;
        ctx.textBaseline = 'alphabetic';
        for (const a of this.annotationMarks) {
            ctx.fillStyle = a.color;
            ctx.font = this.canvasFont(a.fontSize, '500');
            ctx.textAlign = a.align === 'start' ? 'left' : a.align === 'end' ? 'right' : 'center';
            ctx.fillText(a.text, a.x, a.y);
        }
    }

    private drawTitleToCanvas() {
        const cfg = this.requireConfig();
        if (!this.titleText) return;
        const ctx = this.ctx;
        ctx.fillStyle = this.themeColors.textNormal;
        ctx.font = this.canvasFont(15, '600');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(this.titleText, cfg.width / 2, PADDING_TOP - 10);
    }
}

function quadDepthCompare(a: Quad, b: Quad): number {
    return a.depth - b.depth;
}

function quadPath(ctx: CanvasRenderingContext2D, q: Quad) {
    ctx.moveTo(q.p0x, q.p0y);
    ctx.lineTo(q.p1x, q.p1y);
    ctx.lineTo(q.p2x, q.p2y);
    ctx.lineTo(q.p3x, q.p3y);
    ctx.closePath();
}

function quadPathData(q: Quad): string {
    return (
        'M' + q.p0x.toFixed(1) + ' ' + q.p0y.toFixed(1) +
        'L' + q.p1x.toFixed(1) + ' ' + q.p1y.toFixed(1) +
        'L' + q.p2x.toFixed(1) + ' ' + q.p2y.toFixed(1) +
        'L' + q.p3x.toFixed(1) + ' ' + q.p3y.toFixed(1) + 'Z'
    );
}

/** Triangle with its tip at (tx, ty) pointing along the unit vector (ux, uy). */
function arrowHead(tx: number, ty: number, ux: number, uy: number, length: number, halfWidth: number): number[] {
    const bx = tx - ux * length;
    const by = ty - uy * length;
    return [tx, ty, bx + uy * halfWidth, by - ux * halfWidth, bx - uy * halfWidth, by + ux * halfWidth];
}

/** v within [lo, hi], with a little slack for values computed right on the box wall. */
function insideRange(v: number, lo: number, hi: number): boolean {
    const tol = 1e-9 * Math.abs(hi - lo);
    return Number.isFinite(v) && v >= lo - tol && v <= hi + tol;
}

/**
 * Parameter span [t0, t1] of the part of a -> b inside the box lo..hi
 * (Liang-Barsky), or null when the segment misses the box.
 */
function clipToBox(
    a: [number, number, number],
    b: [number, number, number],
    lo: [number, number, number],
    hi: [number, number, number]
): [number, number] | null {
    let t0 = 0;
    let t1 = 1;
    for (let k = 0; k < 3; k++) {
        const tol = 1e-9 * Math.abs(hi[k] - lo[k]);
        const min = lo[k] - tol;
        const max = hi[k] + tol;
        const d = b[k] - a[k];
        if (d === 0) {
            if (a[k] < min || a[k] > max) return null;
            continue;
        }
        let ta = (min - a[k]) / d;
        let tb = (max - a[k]) / d;
        if (ta > tb) {
            const swap = ta;
            ta = tb;
            tb = swap;
        }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return null;
    }
    return [t0, t1];
}

function clearChildren(el: SVGElement) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
}
