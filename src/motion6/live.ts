/*
 * The live canvas of a 2D chart (6.0 F4): what moves on the clock, drawn
 * inside the chart's SVG on canvases in a <foreignObject> over the plot
 * rectangle (over the fills and lines, under the markers and labels). One
 * layer per chart on screen (a note's chart, the editor's preview): the
 * renderer mounts it into each new SVG (src/renderer.ts) and the host paints
 * it on every frame of the clock, so a frame costs the moving parts only,
 * never a new SVG.
 *
 *   The flow of a field (moving particles), the plan's recipe: every frame
 *   fades the canvas a little (so trails fade), draws the arrow grid very
 *   faintly (it settles at about a fifth of full strength), moves every
 *   particle one midpoint step and draws one segment per particle from its
 *   old place to its new one. A particle that is old or leaves the view
 *   starts again somewhere at random. The canvas is warmed up when it
 *   starts (and after a resize, a pan or a theme change), so the trails
 *   show at once, also while paused. The tool's options set the speed, the
 *   count, the trails, the width and the arrows (LiveParticles); without
 *   them it is the plan's picture exactly.
 *
 * Sharp: each canvas has one canvas pixel per screen pixel. Its place and
 * size are measured on screen (the SVG is scaled to its box) and moved onto
 * whole screen pixels, so the browser shows the canvas without resampling;
 * a new size, a new screen density or a pane resize measures again.
 *   Shapes at a time (a curve that draws itself, turning circles): drawn
 *   afresh each frame on a second canvas.
 *
 * The SVG keeps the still frame of those parts, hidden while the layer
 * draws them; exportableSvg (src/svgExport.ts) drops the canvases and shows
 * the still frame, so Copy SVG and the PNG are clean pictures.
 */
import { Platform } from 'obsidian';
import type { MarkerSize } from '../types';
import type { SceneItem2D } from '../scene';
import { resolveCssColor } from '../colors';
import { colormapRgb } from '../colormaps';
import type { LiveImage, LiveParticles, LivePrim, LiveShapes } from './liveprims';
import { themedColor } from './liveprims';

/** Canvas pixels per screen pixel at most. */
const MAX_DPR = 2;

// The flow (the plan's picture; the counts, fade, width and arrows come with the tool, LiveParticles).
/** Particles on a phone at most. */
const PARTICLES_PHONE = 300;
/** Arrows: points across and the share of a cell an arrow is long. */
const GRID_ACROSS = 19;
const GRID_SHARE = 0.43;
/** Particles: this opaque; a frame moves them at least 16 ms; they live 6 (of their time) at most. */
const PARTICLE_ALPHA = 0.85;
const MIN_STEP = 0.016;
const MAX_STEP = 0.05;
const PARTICLE_AGE = 6;
/** A new flow canvas runs this many steps before it is first shown. */
const WARM_STEPS = 40;

/** How the renderer draws: its plot rectangle, chart units to SVG units, thickness and marker sizes. */
export interface LiveGeometry {
    rect: { x: number; y: number; w: number; h: number };
    /** SVG x = ax + bx * x, SVG y = ay + by * y. */
    ax: number;
    bx: number;
    ay: number;
    by: number;
    view: { xmin: number; xmax: number; ymin: number; ymax: number };
    width(thickness: string): number;
    radius(size: MarkerSize): number;
    /** A chart colour as CSS (a palette name to its variable). */
    css(color: string): string;
    // 6.0 ML
    /** A dot's radius for a radius in points of a matplotlib figure (MarkerPrim.radius). */
    pointRadius?(pt: number): number;
    /** The font size of the chart's texts of a size, in SVG units. */
    fontSize?(size: MarkerSize): number;
}

/** 6.0 ML: pictures of frame(t) kept (by key), most recently used last. */
const PICTURES_KEPT = 96;

/** The particles of one field and the arrow grid they move over (screen positions in SVG units). */
interface Flow {
    p: LiveParticles;
    x: Float64Array;
    y: Float64Array;
    age: Float64Array;
    grid: Array<{ color: string; segs: number[] }>;
}

export class LiveLayer {
    private fo: SVGForeignObjectElement | null = null;
    private box: HTMLDivElement | null = null;
    /** Where the canvases are, in SVG units: the plot rectangle moved onto whole screen pixels. */
    private pos = { x: 0, y: 0, w: 1, h: 1 };
    /** The rectangle the place was measured for. */
    private posFor = '';
    private resize: ResizeObserver | null = null;
    private watchedSvg: Element | null = null;
    private dprQuery: MediaQueryList | null = null;
    private readonly onDpr = () => this.remeasure();
    /** The flows' canvas (faded each frame) and the shapes' canvas (drawn afresh), made when needed. */
    private flowCanvas: HTMLCanvasElement | null = null;
    private shapeCanvas: HTMLCanvasElement | null = null;
    private prims: LivePrim[] = [];
    private geo: LiveGeometry | null = null;
    private readonly flows = new Map<string, Flow>();
    private readonly colors = new Map<string, string>();
    private dark = false;
    private background = '#ffffff';
    /** Screen px per SVG unit (measured once on screen), and canvas pixels per SVG unit. */
    private screen = 1;
    private density = 1;
    private measured = false;
    /** What the flow canvas shows: a new one (other view, size or theme) is cleared and warmed up. */
    private flowKey = '';
    private lastTime = NaN;
    // 6.0 ML
    /** The canvases of frame(t)'s pictures by key: a picture that comes again (the same snapshot) costs one drawImage. */
    private readonly pictures = new Map<string, HTMLCanvasElement>();
    /** The chart's title and axis names as the last frame set them (written into the SVG's own texts). */
    private axesTexts: { title?: string | null; xlabel?: string | null; ylabel?: string | null } = {};
    /** The font of the chart's texts (resolved once: a canvas does not read CSS variables). */
    private font = '';
    /** Milliseconds the last paint took; every 30th paint also on the layer (data-paint-ms), for the smoke test. */
    lastPaintMs = 0;
    private paints = 0;
    private paintSum = 0;

    /** Whether the last drawing had something that moves here. */
    active(): boolean {
        return this.prims.length > 0 && !!this.fo;
    }

    /**
     * The moving parts of a new drawing: the layer element to put into its
     * SVG (painted at `time` already), or null when nothing moves.
     */
    mount(items: SceneItem2D[], geo: LiveGeometry, time: number): SVGForeignObjectElement | null {
        const prims: LivePrim[] = [];
        for (const item of items) for (const p of item.live ?? []) prims.push(p);
        this.prims = prims;
        if (!prims.length) {
            this.fo?.remove();
            this.flows.clear();
            this.flowKey = '';
            return null;
        }
        this.geo = geo;
        this.colors.clear();
        this.axesTexts = {}; // 6.0 ML: a new drawing has its own title
        const body = typeof activeDocument !== 'undefined' ? activeDocument.body : null;
        this.dark = !!body && body.hasClass('theme-dark');
        this.background = this.color('var(--background-primary)');
        // 6.0 ML
        if (!this.font && body) this.font = getComputedStyle(body).getPropertyValue('--font-text').trim() || 'sans-serif';
        const { rect } = geo;
        if (!this.fo) {
            this.fo = createSvg('foreignObject', { cls: 'etz-motion-layer', attr: { 'pointer-events': 'none', 'aria-hidden': 'true' } });
            this.box = this.fo.createDiv({ cls: 'etz-motion-box' });
        }
        const fo = this.fo;
        const box = this.box ?? fo.createDiv({ cls: 'etz-motion-box' });
        this.box = box;
        // The place measured for this rectangle stays (a redraw of the same chart); a new rectangle starts from it.
        const rectKey = `${rect.x},${rect.y},${rect.w},${rect.h}`;
        if (rectKey !== this.posFor) {
            this.posFor = rectKey;
            this.pos = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
            this.measured = false;
        }
        this.place();
        const hasFlow = prims.some((p) => p.particles);
        const hasShapes = prims.some((p) => p.at);
        if (hasFlow && !this.flowCanvas) {
            this.flowCanvas = createEl('canvas', { cls: 'etz-motion-canvas' });
            box.prepend(this.flowCanvas);
        }
        if (!hasFlow && this.flowCanvas) {
            this.flowCanvas.remove();
            this.flowCanvas = null;
        }
        if (hasShapes && !this.shapeCanvas) this.shapeCanvas = box.createEl('canvas', { cls: 'etz-motion-canvas' });
        if (!hasShapes && this.shapeCanvas) {
            this.shapeCanvas.remove();
            this.shapeCanvas = null;
        }
        if (!this.measured) this.density = this.screen * Math.min(MAX_DPR, window.devicePixelRatio || 1);
        this.size();
        this.syncFlows();
        this.paint(time);
        // Once the drawing is on screen: one canvas pixel per screen pixel, on whole screen pixels.
        window.requestAnimationFrame(() => {
            this.watch();
            if (this.measure()) this.paint(this.lastTime);
            this.writeAxesTexts(); // 6.0 ML: the SVG's title is there now
        });
        return fo;
    }

    /** The layer element at `pos`. */
    private place(): void {
        const fo = this.fo;
        if (!fo) return;
        const p = this.pos;
        for (const [k, v] of Object.entries({ x: p.x, y: p.y, width: p.w, height: p.h })) fo.setAttribute(k, String(v));
    }

    /** Size the canvases to the place at the current density (a new size clears them). */
    private size(): void {
        const w = Math.max(1, Math.round(this.pos.w * this.density));
        const h = Math.max(1, Math.round(this.pos.h * this.density));
        for (const c of [this.flowCanvas, this.shapeCanvas]) {
            if (!c) continue;
            if (c.width !== w) c.width = w;
            if (c.height !== h) c.height = h;
        }
    }

    /** Measure again when the chart's box or the screen density changes (a pane resize, another screen). */
    private watch(): void {
        const svg = this.fo?.ownerSVGElement ?? null;
        if (svg && svg !== this.watchedSvg && typeof ResizeObserver !== 'undefined') {
            this.resize?.disconnect();
            this.resize = new ResizeObserver(() => this.remeasure());
            this.resize.observe(svg);
            this.watchedSvg = svg;
        }
        const dpr = window.devicePixelRatio || 1;
        if (!this.dprQuery || !this.dprQuery.matches) {
            this.dprQuery?.removeEventListener('change', this.onDpr);
            this.dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
            this.dprQuery.addEventListener('change', this.onDpr);
        }
    }

    private remeasure(): void {
        this.measured = false;
        if (this.measure()) this.paint(this.lastTime);
        this.watch();
    }

    /**
     * Measure the layer on screen and move it onto whole screen pixels: its
     * edges on whole device pixels and one canvas pixel per device pixel, so
     * the browser shows the canvases without resampling (soft lines). True
     * when the canvases changed size (they were cleared and warmed up again).
     */
    private measure(): boolean {
        const fo = this.fo;
        if (this.measured || !fo || !fo.isConnected) return false;
        this.measured = true;
        const box = fo.getBoundingClientRect();
        const p = this.pos;
        if (!(box.width > 0) || !(box.height > 0) || !(p.w > 0)) return false;
        const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
        // CSS px per SVG unit, and the edges on whole device pixels.
        const scale = box.width / p.w;
        const left = Math.round(box.left * dpr) / dpr;
        const top = Math.round(box.top * dpr) / dpr;
        const w = Math.max(1, Math.round(box.width * dpr));
        const h = Math.max(1, Math.round(box.height * dpr));
        this.pos = { x: p.x + (left - box.left) / scale, y: p.y + (top - box.top) / scale, w: w / dpr / scale, h: h / dpr / scale };
        this.place();
        this.screen = scale;
        const density = scale * dpr;
        const resized = Math.abs(density - this.density) > 1e-6 || [this.flowCanvas, this.shapeCanvas].some((c) => !!c && (c.width !== w || c.height !== h));
        this.density = density;
        if (!resized) return false;
        this.size();
        this.flowKey = '';
        this.syncFlows();
        return true;
    }

    private color(css: string): string {
        let c = this.colors.get(css);
        if (c === undefined) {
            c = resolveCssColor(css);
            this.colors.set(css, c);
        }
        return c;
    }

    /** A chart colour on the canvas: the theme's value (and a time ramp colour in its dark twin). */
    private chartColor(color: string): string {
        const geo = this.geo;
        const themed = themedColor(color, this.dark);
        return this.color(geo ? geo.css(themed) : themed);
    }

    // ------------------------------------------------------------- flows

    /** The flows of this drawing: new particles and a warm-up when the view, size or theme changed. */
    private syncFlows(): void {
        const geo = this.geo;
        const canvas = this.flowCanvas;
        if (!geo || !canvas) {
            this.flows.clear();
            return;
        }
        const v = geo.view;
        const key = [v.xmin, v.xmax, v.ymin, v.ymax, canvas.width, canvas.height, this.dark ? 1 : 0, this.background].join('|');
        const fresh = key !== this.flowKey;
        this.flowKey = key;
        const keep = new Set<string>();
        for (const prim of this.prims) {
            if (!prim.particles) continue;
            keep.add(prim.key);
            const old = this.flows.get(prim.key);
            if (old && !fresh) {
                // The same particles in a field that changed (a slider moved): they go on from where they are.
                old.p = prim.particles;
                old.grid = this.grid(prim.particles);
                continue;
            }
            this.flows.set(prim.key, this.newFlow(prim.particles));
        }
        for (const k of Array.from(this.flows.keys())) if (!keep.has(k)) this.flows.delete(k);
        if (fresh) {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < WARM_STEPS; i++) this.flowFrame(ctx, MIN_STEP);
        }
    }

    private newFlow(p: LiveParticles): Flow {
        const n = Math.max(1, Math.round(Platform.isMobile ? Math.min(PARTICLES_PHONE, p.count) : p.count));
        const flow: Flow = { p, x: new Float64Array(n), y: new Float64Array(n), age: new Float64Array(n), grid: this.grid(p) };
        for (let i = 0; i < n; i++) flow.age[i] = this.spawn(flow, i) * 5;
        return flow;
    }

    /**
     * A particle somewhere at random, age 0. As the plan's spawn it takes three
     * random numbers (x, y, and the age a first particle starts with, returned).
     */
    private spawn(flow: Flow, i: number): number {
        const v = this.geo?.view;
        if (!v) return 0;
        flow.x[i] = v.xmin + Math.random() * (v.xmax - v.xmin);
        flow.y[i] = v.ymin + Math.random() * (v.ymax - v.ymin);
        flow.age[i] = 0;
        return Math.random();
    }

    /** The arrow grid in SVG units: short lines along F, the same length on screen, by colour. */
    private grid(p: LiveParticles): Flow['grid'] {
        const geo = this.geo;
        if (!geo) return [];
        const { view: v, rect, ax, bx, ay, by } = geo;
        const nx = GRID_ACROSS;
        // 19 x 13 on a plot of 3 : 2, as the plan.
        const ny = Math.max(2, Math.round(((GRID_ACROSS - 1) * rect.h) / rect.w) + 1);
        const len = (GRID_SHARE * rect.w) / (GRID_ACROSS - 1);
        const pts: Array<{ x: number; y: number; dx: number; dy: number; size: number }> = [];
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < nx; i++) {
            for (let j = 0; j < ny; j++) {
                const x = v.xmin + ((v.xmax - v.xmin) * i) / (nx - 1);
                const y = v.ymin + ((v.ymax - v.ymin) * j) / (ny - 1);
                const f = p.field(x, y);
                const sx = f[0] * bx;
                const sy = f[1] * by;
                const L = Math.hypot(sx, sy);
                if (!(L > 0) || !Number.isFinite(L)) continue;
                const size = Math.hypot(f[0], f[1]);
                lo = Math.min(lo, size);
                hi = Math.max(hi, size);
                pts.push({ x: ax + bx * x, y: ay + by * y, dx: (sx / L) * len, dy: (sy / L) * len, size });
            }
        }
        const groups = new Map<string, number[]>();
        const ink = this.color('var(--text-normal)');
        for (const q of pts) {
            const map = p.colormap;
            const color = map ? rgbText(colormapRgb(map, hi > lo ? (q.size - lo) / (hi - lo) : 0.5)) : ink;
            let segs = groups.get(color);
            if (!segs) groups.set(color, (segs = []));
            segs.push(q.x, q.y, q.x + q.dx, q.y + q.dy);
        }
        return Array.from(groups, ([color, segs]) => ({ color, segs }));
    }

    /** One frame of every flow: fade, the faint arrows, one step of every particle. */
    private flowFrame(ctx: CanvasRenderingContext2D, dt: number): void {
        const geo = this.geo;
        const canvas = this.flowCanvas;
        if (!geo || !canvas) return;
        const d = this.density;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1;
        const first = this.flows.values().next().value;
        ctx.fillStyle = `rgba(0, 0, 0, ${first ? first.p.fade : 0.1})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.setTransform(d, 0, 0, d, -this.pos.x * d, -this.pos.y * d);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const px = 1 / this.screen;
        const { ax, bx, ay, by, view: v } = geo;
        const h = Math.max(dt, MIN_STEP);
        for (const flow of this.flows.values()) {
            ctx.globalAlpha = flow.p.arrows;
            ctx.lineWidth = px;
            for (const g of flow.p.arrows > 0 ? flow.grid : []) {
                ctx.strokeStyle = g.color;
                ctx.beginPath();
                const s = g.segs;
                for (let i = 0; i < s.length; i += 4) {
                    ctx.moveTo(s[i], s[i + 1]);
                    ctx.lineTo(s[i + 2], s[i + 3]);
                }
                ctx.stroke();
            }
            const F = flow.p.field;
            // The plan's step: hdt = max(dt, 0.016) * 1.4 (its speed), in the field's own time.
            const k = h * flow.p.speed;
            ctx.globalAlpha = PARTICLE_ALPHA;
            ctx.lineWidth = flow.p.width * px;
            ctx.strokeStyle = this.chartColor(flow.p.color);
            ctx.beginPath();
            const n = flow.x.length;
            for (let i = 0; i < n; i++) {
                const x = flow.x[i];
                const y = flow.y[i];
                const a = F(x, y);
                const b = F(x + 0.5 * k * a[0], y + 0.5 * k * a[1]);
                const nx = x + k * b[0];
                const ny = y + k * b[1];
                if (Number.isFinite(nx) && Number.isFinite(ny)) {
                    ctx.moveTo(ax + bx * x, ay + by * y);
                    ctx.lineTo(ax + bx * nx, ay + by * ny);
                }
                flow.x[i] = nx;
                flow.y[i] = ny;
                flow.age[i] += k;
                if (!(flow.age[i] <= PARTICLE_AGE) || !(nx >= v.xmin && nx <= v.xmax && ny >= v.ymin && ny <= v.ymax)) this.spawn(flow, i);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // ----------------------------------------------------------- painting

    /** Draw the moving parts at `time` (seconds on the clock). */
    paint(time: number): void {
        const geo = this.geo;
        if (!geo || !this.prims.length) return;
        const start = performance.now();
        const step = Number.isFinite(this.lastTime) ? time - this.lastTime : 0;
        this.lastTime = time;
        const flowCtx = this.flowCanvas?.getContext('2d');
        // The flow moves when the clock does (a redraw at the same time leaves it as it is).
        if (flowCtx && step > 0) this.flowFrame(flowCtx, Math.min(MAX_STEP, step));
        const canvas = this.shapeCanvas;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
            const d = this.density;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.setTransform(d, 0, 0, d, -this.pos.x * d, -this.pos.y * d);
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            for (const p of this.prims) {
                if (!p.at) continue;
                try {
                    const shapes = p.at(time);
                    this.shapes(ctx, shapes);
                    // 6.0 ML: a frame's title and axis names.
                    if (shapes.title !== undefined || shapes.xlabel !== undefined || shapes.ylabel !== undefined) {
                        this.axesTexts = { title: shapes.title, xlabel: shapes.xlabel, ylabel: shapes.ylabel };
                        this.writeAxesTexts();
                    }
                } catch {
                    // A part that cannot be drawn now is left out of this frame.
                }
            }
        }
        this.lastPaintMs = performance.now() - start;
        // The mean of 30 frames that moved something, on the layer (data-paint-ms), for the smoke test.
        if (step > 0) {
            this.paintSum += this.lastPaintMs;
            if (++this.paints % 30 === 0 && this.fo) {
                this.fo.dataset.paintMs = (this.paintSum / 30).toFixed(2);
                this.paintSum = 0;
            }
        }
    }

    private shapes(ctx: CanvasRenderingContext2D, s: LiveShapes): void {
        const geo = this.geo;
        if (!geo) return;
        const { ax, bx, ay, by } = geo;
        // 6.0 ML: pictures first, under the frame's lines and dots.
        for (const img of s.images ?? []) this.picture(ctx, img);
        // 6.0 P: fills of a script's frame(t), under its lines.
        for (const f of s.fills ?? []) {
            if (f.pts.length < 3) continue;
            ctx.beginPath();
            f.pts.forEach((p, i) => (i ? ctx.lineTo(ax + bx * p.x, ay + by * p.y) : ctx.moveTo(ax + bx * p.x, ay + by * p.y)));
            ctx.closePath();
            ctx.globalAlpha = f.opacity;
            ctx.fillStyle = this.chartColor(f.color);
            ctx.fill('evenodd');
        }
        ctx.globalAlpha = 1;
        for (const r of s.rings) {
            if (!(r.r > 0)) continue;
            ctx.beginPath();
            ctx.ellipse(ax + bx * r.x, ay + by * r.y, Math.abs(bx * r.r), Math.abs(by * r.r), 0, 0, 2 * Math.PI);
            ctx.globalAlpha = r.opacity ?? 1;
            ctx.strokeStyle = this.chartColor(r.color);
            ctx.lineWidth = geo.width('thin') * 0.8;
            ctx.stroke();
        }
        for (const l of s.lines) {
            if (l.pts.length < 2) continue;
            ctx.beginPath();
            let pen = false;
            for (const p of l.pts) {
                if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
                    pen = false;
                    continue;
                }
                const x = ax + bx * p.x;
                const y = ay + by * p.y;
                if (pen) ctx.lineTo(x, y);
                else ctx.moveTo(x, y);
                pen = true;
            }
            ctx.globalAlpha = l.opacity ?? 1;
            ctx.strokeStyle = this.chartColor(l.color);
            ctx.lineWidth = geo.width(l.width);
            ctx.setLineDash(l.dashed ? [6, 4] : []);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        for (const dot of s.dots) {
            if (!Number.isFinite(dot.x) || !Number.isFinite(dot.y)) continue;
            // 6.0 ML: a dot with matplotlib's radius: the colour that wide and a thin rim, as the SVG draws it.
            const sized = dot.radius !== undefined && !!geo.pointRadius;
            const r = sized && geo.pointRadius ? geo.pointRadius(dot.radius ?? 3) + 0.375 : geo.radius(dot.size);
            ctx.beginPath();
            ctx.arc(ax + bx * dot.x, ay + by * dot.y, r, 0, 2 * Math.PI);
            const c = this.chartColor(dot.color);
            ctx.fillStyle = dot.open ? this.background : c;
            ctx.fill();
            ctx.lineWidth = dot.open ? 2 : sized ? 0.75 : 1.5;
            ctx.strokeStyle = dot.open ? c : this.background;
            ctx.stroke();
        }
        // 6.0 P: texts of a script's frame(t), beside their point as the anchor says.
        for (const t of s.texts ?? []) {
            if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !t.text) continue;
            // 6.0 ML: the chart's font and sizes (a canvas cannot read the CSS variable itself).
            const px = geo.fontSize ? geo.fontSize(t.size) : t.size === 'large' ? 15 : t.size === 'small' ? 10 : 12;
            ctx.font = `${px}px ${this.font || 'sans-serif'}`;
            ctx.textAlign = t.anchor.includes('right') ? 'left' : t.anchor.includes('left') ? 'right' : 'center';
            ctx.textBaseline = t.anchor.includes('above') ? 'bottom' : t.anchor.includes('below') ? 'top' : 'middle';
            const gap = 0.35 * px;
            const dx = ctx.textAlign === 'left' ? gap : ctx.textAlign === 'right' ? -gap : 0;
            const dy = ctx.textBaseline === 'bottom' ? -gap : ctx.textBaseline === 'top' ? gap : 0;
            const x = ax + bx * t.x + dx;
            const y = ay + by * t.y + dy;
            if (t.halo) {
                ctx.lineJoin = 'round';
                ctx.lineWidth = 0.25 * px;
                ctx.strokeStyle = this.background;
                ctx.strokeText(t.text, x, y);
            }
            ctx.fillStyle = this.chartColor(t.color);
            ctx.fillText(t.text, x, y);
        }
    }

    /**
     * 6.0 ML: a picture of frame(t) over its box: its own pixels on a small
     * canvas, kept by key (a picture that comes again is drawn at once),
     * scaled with or without blending (imshow's bilinear or its sharp cells).
     */
    private picture(ctx: CanvasRenderingContext2D, img: LiveImage): void {
        const geo = this.geo;
        if (!geo || !(img.w > 0) || !(img.h > 0)) return;
        let source = this.pictures.get(img.key);
        if (source) {
            // Most recently used last.
            this.pictures.delete(img.key);
            this.pictures.set(img.key, source);
        } else {
            source = createEl('canvas');
            source.width = img.w;
            source.height = img.h;
            const sctx = source.getContext('2d');
            if (!sctx) return;
            const data = sctx.createImageData(img.w, img.h);
            data.data.set(img.rgba());
            sctx.putImageData(data, 0, 0);
            this.pictures.set(img.key, source);
            while (this.pictures.size > PICTURES_KEPT) {
                const first = this.pictures.keys().next().value;
                if (first === undefined) break;
                this.pictures.delete(first);
            }
        }
        const { ax, bx, ay, by } = geo;
        const left = ax + bx * img.x0;
        const right = ax + bx * img.x1;
        const top = ay + by * img.y1;
        const bottom = ay + by * img.y0;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, img.opacity));
        ctx.imageSmoothingEnabled = img.smooth;
        if (img.smooth) ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, Math.min(left, right), Math.min(top, bottom), Math.abs(right - left), Math.abs(bottom - top));
        ctx.restore();
    }

    /** 6.0 ML: the last frame's title and axis names into the chart's own SVG texts (plain texts only; math stays as drawn). */
    private writeAxesTexts(): void {
        const svg = this.fo?.ownerSVGElement;
        if (!svg) return;
        const put = (selector: string, text: string | null | undefined) => {
            if (text === undefined || text === null) return;
            const el = svg.querySelector(selector);
            if (el && el.tagName.toLowerCase() === 'text' && el.textContent !== text) el.textContent = text;
        };
        put('.etz-title text', this.axesTexts.title);
        put('text[data-etz-axis-name="x"]', this.axesTexts.xlabel);
        put('text[data-etz-axis-name="y"]', this.axesTexts.ylabel);
    }

    /** The chart left the page. */
    destroy(): void {
        this.resize?.disconnect();
        this.resize = null;
        this.dprQuery?.removeEventListener('change', this.onDpr);
        this.dprQuery = null;
        this.fo?.remove();
        this.fo = null;
        this.box = null;
        this.flowCanvas = null;
        this.shapeCanvas = null;
        this.prims = [];
        this.flows.clear();
        this.flowKey = '';
        this.pictures.clear(); // 6.0 ML
    }
}

/** 0..255 channels as an rgb() colour. */
function rgbText(rgb: readonly number[]): string {
    return `rgb(${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c)))).join(', ')})`;
}
