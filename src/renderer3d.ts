import { RendererConfig, Function3DParameters } from './types';
import { MathHelper } from './math';
import { COLOR_MAP, resolveCssColor } from './colors';
import { niceInterval, formatTick, stripLatex, hexToRgb, rgbStringToRgb } from './util';

const SVG_NS = 'http://www.w3.org/2000/svg';

const PADDING_TOP = 40;
const PADDING_RIGHT = 40;
const PADDING_BOTTOM = 40;
const PADDING_LEFT = 40;

/** Fraction of the available viewport used by the projected unit cube. */
const VIEWPORT_SCALE = 0.28;

/** Default surface sampling resolution per axis. */
const DEFAULT_GRID_SAMPLES = 40;

/** Default target number of major ticks per 3D axis. */
const DEFAULT_TARGET_TICKS = 5;

interface Quad {
    p0x: number; p0y: number;
    p1x: number; p1y: number;
    p2x: number; p2y: number;
    p3x: number; p3y: number;
    depth: number;
    zValue: number;
    color: string;
    wireframe: boolean;
    opacity: number;
}

interface SurfaceData {
    key: string;
    samples: number;
    xs: Float64Array;
    ys: Float64Array;
    zs: Float64Array;
}

interface AxisGeometry {
    layer: 'back' | 'front';
    drawX: boolean;
    drawY: boolean;
    drawZ: boolean;
    origin: { sx: number; sy: number };
    xEnd: { sx: number; sy: number };
    yEnd: { sx: number; sy: number };
    zEnd: { sx: number; sy: number };
}

function shadeColor(baseColor: string, t: number): string {
    const resolved = resolveCssColor(baseColor);
    const rgb = hexToRgb(resolved) || rgbStringToRgb(resolved);
    if (!rgb) return baseColor;
    const factor = 0.3 + t * 0.7;
    const r = Math.round(rgb.r * factor + 255 * (1 - factor));
    const g = Math.round(rgb.g * factor + 255 * (1 - factor));
    const b = Math.round(rgb.b * factor + 255 * (1 - factor));
    return `rgb(${r},${g},${b})`;
}

/**
 * Stateful 3D renderer with two output paths:
 *  - `renderSvg(config)`: mutates a pool of `<polygon>` elements inside a
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
    private root: HTMLDivElement;
    private svg: SVGSVGElement;
    private backgroundRect: SVGRectElement;
    private surfaceGroup: SVGGElement;
    private backAxesGroup: SVGGElement;
    private frontAxesGroup: SVGGElement;
    private annotationsGroup: SVGGElement;
    private titleEl: SVGTextElement;

    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;

    /** Polygon pool reused across renders. */
    private surfacePool: SVGPolygonElement[] = [];

    /** Sampled data per surface index. */
    private dataCache: Map<number, SurfaceData> = new Map();

    // Camera state (refreshed per render).
    private config: RendererConfig | null = null;
    private centerX = 0;
    private centerY = 0;
    private scale = 1;
    private cosA = 1;
    private sinA = 0;
    private cosE = 1;
    private sinE = 0;

    private sxBuf = new Float64Array(0);
    private syBuf = new Float64Array(0);
    private depthBuf = new Float64Array(0);

    /** Most recent gathered + sorted quad list. Set by `prepareScene`. */
    private quads: Quad[] = [];

    /** Resolved theme colors, refreshed per render so theme switches repaint. */
    private themeColors: { textNormal: string; textMuted: string; bgPrimary: string } = {
        textNormal: '#000',
        textMuted: '#666',
        bgPrimary: '#fff',
    };

    constructor() {
        this.root = document.createElement('div');
        this.root.className = 'tikz-3d-root tikz-3d-mode-svg';

        this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
        this.svg.setAttribute('class', 'tikz-3d-svg');

        this.backgroundRect = document.createElementNS(SVG_NS, 'rect') as SVGRectElement;
        this.backgroundRect.setAttribute('fill', 'var(--background-primary)');
        this.backgroundRect.setAttribute('rx', '4');
        this.svg.appendChild(this.backgroundRect);

        this.backAxesGroup = this.makeGroup('tikz-3d-axes-back');
        this.surfaceGroup = this.makeGroup('tikz-3d-surface');
        this.frontAxesGroup = this.makeGroup('tikz-3d-axes-front');
        this.annotationsGroup = this.makeGroup('tikz-3d-annotations');

        this.titleEl = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
        this.titleEl.setAttribute('text-anchor', 'middle');
        this.titleEl.setAttribute('fill', 'var(--text-normal)');
        this.titleEl.setAttribute('font-size', '15');
        this.titleEl.setAttribute('font-weight', '600');
        this.svg.appendChild(this.titleEl);

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'tikz-3d-canvas';
        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        this.ctx = ctx;

        this.root.appendChild(this.svg);
        this.root.appendChild(this.canvas);
    }

    private makeGroup(cls: string): SVGGElement {
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        g.setAttribute('class', cls);
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
     * Update the persistent SVG to reflect `config`. Sets the root into
     * "SVG mode" so the SVG shows and the canvas is hidden.
     */
    renderSvg(config: RendererConfig) {
        this.prepareScene(config);
        this.updateSurfacePool(this.quads);

        clearChildren(this.backAxesGroup);
        clearChildren(this.frontAxesGroup);
        clearChildren(this.annotationsGroup);
        this.drawAxesToSvg('back');
        this.drawAxesToSvg('front');
        this.drawAnnotationsToSvg();
        this.updateTitleSvg();

        if (this.root.className !== 'tikz-3d-root tikz-3d-mode-svg') {
            this.root.className = 'tikz-3d-root tikz-3d-mode-svg';
        }
    }

    /**
     * Paint to the canvas to reflect `config`. Sets the root into "canvas
     * mode" so the canvas shows and the SVG is hidden. The SVG keeps its
     * last state until renderSvg is called again.
     */
    renderCanvas(config: RendererConfig) {
        this.prepareScene(config);
        this.paintCanvas();

        if (this.root.className !== 'tikz-3d-root tikz-3d-mode-canvas') {
            this.root.className = 'tikz-3d-root tikz-3d-mode-canvas';
        }
    }

    /**
     * Shared phase: refresh camera, resize SVG, sample data (cached if
     * possible), project, sort. Leaves the result in `this.quads`.
     */
    private prepareScene(config: RendererConfig) {
        this.config = config;
        this.refreshThemeColors();

        // SVG dimensions (only matters for the SVG path, but cheap to set).
        this.svg.setAttribute('width', String(config.width));
        this.svg.setAttribute('height', String(config.height));
        this.svg.setAttribute('viewBox', `0 0 ${config.width} ${config.height}`);
        this.backgroundRect.setAttribute('width', String(config.width));
        this.backgroundRect.setAttribute('height', String(config.height));
        this.root.style.width = config.width + 'px';
        this.root.style.height = config.height + 'px';

        // Canvas dimensions, hi-DPI aware.
        const dpr = window.devicePixelRatio || 1;
        const pxW = Math.round(config.width * dpr);
        const pxH = Math.round(config.height * dpr);
        if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
            this.canvas.width = pxW;
            this.canvas.height = pxH;
        }
        this.canvas.style.width = config.width + 'px';
        this.canvas.style.height = config.height + 'px';

        this.centerX = config.width / 2;
        this.centerY = config.height / 2 + 20;
        const availW = config.width - PADDING_LEFT - PADDING_RIGHT;
        const availH = config.height - PADDING_TOP - PADDING_BOTTOM;
        this.scale = Math.min(availW, availH) * VIEWPORT_SCALE;
        const az = (config.rotationZ * Math.PI) / 180;
        const el = (config.rotationX * Math.PI) / 180;
        this.cosA = Math.cos(az);
        this.sinA = Math.sin(az);
        this.cosE = Math.cos(el);
        this.sinE = Math.sin(el);

        // Prune stale cache entries.
        const liveCount = config.functions3D.length;
        for (const idx of Array.from(this.dataCache.keys())) {
            if (idx >= liveCount) this.dataCache.delete(idx);
        }

        const allQuads: Quad[] = [];
        for (let i = 0; i < liveCount; i++) {
            const func = config.functions3D[i];
            if (!func.expression) {
                this.dataCache.delete(i);
                continue;
            }
            try {
                const data = this.getSurfaceData(i, func);
                this.projectQuads(data, func, allQuads);
            } catch {
                this.dataCache.delete(i);
            }
        }
        allQuads.sort(quadDepthCompare);
        this.quads = allQuads;
    }

    private refreshThemeColors() {
        const cs = getComputedStyle(document.body);
        this.themeColors.textNormal = cs.getPropertyValue('--text-normal').trim() || '#000';
        this.themeColors.textMuted = cs.getPropertyValue('--text-muted').trim() || '#666';
        this.themeColors.bgPrimary = cs.getPropertyValue('--background-primary').trim() || '#fff';
    }

    /** Surface data (cached). */
    private getSurfaceData(idx: number, func: Function3DParameters): SurfaceData {
        const cfg = this.config!;
        const samples = Math.max(4, Math.min(120, func.samples || DEFAULT_GRID_SAMPLES));
        const key = `${func.expression}|${func.xDomain}|${func.yDomain}|${cfg.zmin}|${cfg.zmax}|${samples}`;
        const existing = this.dataCache.get(idx);
        if (existing && existing.key === key) return existing;

        const [xmin, xmax] = MathHelper.parseDomain(func.xDomain);
        const [ymin, ymax] = MathHelper.parseDomain(func.yDomain);
        const evalFn = MathHelper.compile2D(func.expression);
        const stride = samples + 1;
        const total = stride * stride;
        const xs = new Float64Array(total);
        const ys = new Float64Array(total);
        const zs = new Float64Array(total);
        const stepX = (xmax - xmin) / samples;
        const stepY = (ymax - ymin) / samples;
        try {
            for (let i = 0; i <= samples; i++) {
                const x = xmin + i * stepX;
                const rowOffset = i * stride;
                for (let j = 0; j <= samples; j++) {
                    const y = ymin + j * stepY;
                    const off = rowOffset + j;
                    xs[off] = x;
                    ys[off] = y;
                    const z = evalFn(x, y);
                    zs[off] = z === z && z !== Infinity && z !== -Infinity ? z : NaN;
                }
            }
        } catch {
            for (let k = 0; k < total; k++) {
                if (!(zs[k] === zs[k])) zs[k] = NaN;
            }
        }

        const data: SurfaceData = { key, samples, xs, ys, zs };
        this.dataCache.set(idx, data);
        return data;
    }

    /** Project cached samples and emit one Quad per grid cell. */
    private projectQuads(data: SurfaceData, func: Function3DParameters, out: Quad[]) {
        const cfg = this.config!;
        const { xmin, xmax, ymin, ymax, zmin, zmax } = cfg;
        const xRangeInv = 1 / (xmax - xmin);
        const yRangeInv = 1 / (ymax - ymin);
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

        for (let k = 0; k < total; k++) {
            const z = data.zs[k];
            if (z !== z) {
                depthBuf[k] = -Infinity;
                continue;
            }
            const x = data.xs[k];
            const y = data.ys[k];
            const nx = (x - xmin) * xRangeInv * 2 - 1;
            const ny = (y - ymin) * yRangeInv * 2 - 1;
            const nz = (z - zmin) * zRangeInv * 2 - 1;

            const rx = nx * cosA - ny * sinA;
            const ry = nx * sinA + ny * cosA;
            const ry2 = ry * cosE - nz * sinE;
            const rz2 = ry * sinE + nz * cosE;

            sxBuf[k] = cx + rx * scl;
            syBuf[k] = cy - rz2 * scl;
            depthBuf[k] = ry2;
        }

        const color = func.color;
        const wireframe = func.wireframe;
        const opacity = func.opacity;
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
                const avgZ = ((zs[i00] + zs[i10] + zs[i01] + zs[i11]) * 0.25 - zmin) * zRangeInv;
                out.push({
                    p0x: sxBuf[i00], p0y: syBuf[i00],
                    p1x: sxBuf[i10], p1y: syBuf[i10],
                    p2x: sxBuf[i11], p2y: syBuf[i11],
                    p3x: sxBuf[i01], p3y: syBuf[i01],
                    depth: avgDepth,
                    zValue: avgZ < 0 ? 0 : avgZ > 1 ? 1 : avgZ,
                    color,
                    wireframe,
                    opacity,
                });
            }
        }
    }

    private project(x: number, y: number, z: number): { sx: number; sy: number; depth: number } {
        const cfg = this.config!;
        const nx = ((x - cfg.xmin) / (cfg.xmax - cfg.xmin)) * 2 - 1;
        const ny = ((y - cfg.ymin) / (cfg.ymax - cfg.ymin)) * 2 - 1;
        const nz = ((z - cfg.zmin) / (cfg.zmax - cfg.zmin)) * 2 - 1;
        const rx = nx * this.cosA - ny * this.sinA;
        const ry = nx * this.sinA + ny * this.cosA;
        const ry2 = ry * this.cosE - nz * this.sinE;
        const rz2 = ry * this.sinE + nz * this.cosE;
        return { sx: this.centerX + rx * this.scale, sy: this.centerY - rz2 * this.scale, depth: ry2 };
    }

    private computeAxisGeometry(layer: 'back' | 'front'): AxisGeometry {
        const cfg = this.config!;
        const { xmin, xmax, ymin, ymax, zmin, zmax } = cfg;
        const origin = this.project(xmin, ymin, zmin);
        const xEnd = this.project(xmax, ymin, zmin);
        const yEnd = this.project(xmin, ymax, zmin);
        const zEnd = this.project(xmin, ymin, zmax);
        const xMid = this.project((xmin + xmax) / 2, ymin, zmin);
        const yMid = this.project(xmin, (ymin + ymax) / 2, zmin);
        const isXBack = xMid.depth < origin.depth;
        const isYBack = yMid.depth < origin.depth;
        return {
            layer,
            drawX: (layer === 'back') === isXBack || (layer === 'front' && !isXBack),
            drawY: (layer === 'back') === isYBack || (layer === 'front' && !isYBack),
            drawZ: layer === 'front',
            origin, xEnd, yEnd, zEnd,
        };
    }

    // ---- SVG path ----

    private updateSurfacePool(quads: Quad[]) {
        const pool = this.surfacePool;
        const surfaceGroup = this.surfaceGroup;
        while (pool.length < quads.length) {
            const poly = document.createElementNS(SVG_NS, 'polygon') as SVGPolygonElement;
            surfaceGroup.appendChild(poly);
            pool.push(poly);
        }
        for (let i = 0; i < quads.length; i++) {
            const q = quads[i];
            const poly = pool[i];
            poly.setAttribute(
                'points',
                q.p0x.toFixed(1) + ',' + q.p0y.toFixed(1) + ' ' +
                q.p1x.toFixed(1) + ',' + q.p1y.toFixed(1) + ' ' +
                q.p2x.toFixed(1) + ',' + q.p2y.toFixed(1) + ' ' +
                q.p3x.toFixed(1) + ',' + q.p3y.toFixed(1)
            );
            const baseColor = COLOR_MAP[q.color] || q.color;
            if (q.wireframe) {
                poly.setAttribute('fill', 'none');
                poly.setAttribute('stroke', baseColor);
                poly.setAttribute('stroke-width', '0.5');
                poly.setAttribute('stroke-opacity', String(q.opacity));
                poly.removeAttribute('fill-opacity');
            } else {
                poly.setAttribute('fill', shadeColor(baseColor, q.zValue));
                poly.setAttribute('fill-opacity', String(q.opacity));
                poly.setAttribute('stroke', baseColor);
                poly.setAttribute('stroke-width', '0.3');
                poly.setAttribute('stroke-opacity', '0.4');
            }
            if (poly.style.display) poly.style.display = '';
        }
        for (let i = quads.length; i < pool.length; i++) {
            const poly = pool[i];
            if (poly.style.display !== 'none') poly.style.display = 'none';
        }
    }

    private drawAnnotationsToSvg() {
        const cfg = this.config!;
        const annotations = cfg.annotations || [];
        if (!annotations.length) return;
        const group = this.annotationsGroup;
        for (const a of annotations) {
            if (!a.text) continue;
            const x = parseFloat(a.x);
            const y = parseFloat(a.y);
            const z = parseFloat(a.z ?? '0');
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
            const p = this.project(x, y, z);
            const color = COLOR_MAP[a.color] || a.color || 'var(--text-normal)';
            const fontSize = a.size === 'small' ? '10' : a.size === 'large' ? '15' : '12';
            let textAnchor = 'middle';
            let dx = 0;
            let dy = 4;
            switch (a.anchor) {
                case 'above': textAnchor = 'middle'; dy = -6; break;
                case 'below': textAnchor = 'middle'; dy = 14; break;
                case 'left': textAnchor = 'end'; dx = -6; dy = 4; break;
                case 'right': textAnchor = 'start'; dx = 6; dy = 4; break;
                case 'center': default: textAnchor = 'middle'; dy = 4; break;
            }
            const t = document.createElementNS(SVG_NS, 'text');
            t.setAttribute('x', String(p.sx + dx));
            t.setAttribute('y', String(p.sy + dy));
            t.setAttribute('text-anchor', textAnchor);
            t.setAttribute('fill', color);
            t.setAttribute('font-size', fontSize);
            t.setAttribute('font-weight', '500');
            t.setAttribute('font-family', 'var(--font-text)');
            t.textContent = a.text;
            group.appendChild(t);
        }
    }

    private drawAxesToSvg(layer: 'back' | 'front') {
        const cfg = this.config!;
        const geom = this.computeAxisGeometry(layer);
        const axisGroup = layer === 'back' ? this.backAxesGroup : this.frontAxesGroup;
        const axisColor = 'var(--text-muted)';
        const axisWidth = '1.5';

        if (geom.drawX) {
            this.svgLine(axisGroup, geom.origin.sx, geom.origin.sy, geom.xEnd.sx, geom.xEnd.sy, axisColor, axisWidth);
            this.svgAxisTicks(axisGroup, 'x', cfg.xmin, cfg.xmax, cfg.ymin, cfg.zmin);
            if (cfg.showAxisLabels) {
                const lp = this.project(cfg.xmax, cfg.ymin, cfg.zmin);
                this.svgLabel(axisGroup, lp.sx + 10, lp.sy + 5, cfg.xLabel, 'start');
            }
        }
        if (geom.drawY) {
            this.svgLine(axisGroup, geom.origin.sx, geom.origin.sy, geom.yEnd.sx, geom.yEnd.sy, axisColor, axisWidth);
            this.svgAxisTicks(axisGroup, 'y', cfg.ymin, cfg.ymax, cfg.xmin, cfg.zmin);
            if (cfg.showAxisLabels) {
                const lp = this.project(cfg.xmin, cfg.ymax, cfg.zmin);
                this.svgLabel(axisGroup, lp.sx - 15, lp.sy + 5, cfg.yLabel, 'end');
            }
        }
        if (geom.drawZ) {
            this.svgLine(axisGroup, geom.origin.sx, geom.origin.sy, geom.zEnd.sx, geom.zEnd.sy, axisColor, axisWidth);
            this.svgAxisTicks(axisGroup, 'z', cfg.zmin, cfg.zmax, cfg.xmin, cfg.ymin);
            if (cfg.showAxisLabels) {
                const lp = this.project(cfg.xmin, cfg.ymin, cfg.zmax);
                this.svgLabel(axisGroup, lp.sx - 10, lp.sy - 8, cfg.zLabel, 'end');
            }
        }
    }

    private svgLine(parent: SVGElement, x1: number, y1: number, x2: number, y2: number, stroke: string, width: string) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('stroke', stroke);
        line.setAttribute('stroke-width', width);
        parent.appendChild(line);
    }

    private svgLabel(parent: SVGElement, x: number, y: number, text: string, anchor: string) {
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', String(x));
        t.setAttribute('y', String(y));
        if (anchor !== 'start') t.setAttribute('text-anchor', anchor);
        t.setAttribute('fill', 'var(--text-normal)');
        t.setAttribute('font-size', '13');
        t.setAttribute('font-weight', '500');
        t.textContent = text;
        parent.appendChild(t);
    }

    private svgAxisTicks(group: SVGElement, axis: 'x' | 'y' | 'z', min: number, max: number, fixedA: number, fixedB: number) {
        const cfg = this.config!;
        const target = cfg.majorTickNum ? Math.max(2, Math.round(cfg.majorTickNum * 0.6)) : DEFAULT_TARGET_TICKS;
        const interval = niceInterval(max - min, target);
        const start = Math.ceil(min / interval) * interval;

        for (let v = start; v <= max; v += interval) {
            let p: { sx: number; sy: number };
            if (axis === 'x') p = this.project(v, fixedA, fixedB);
            else if (axis === 'y') p = this.project(fixedA, v, fixedB);
            else p = this.project(fixedA, fixedB, v);

            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('cx', String(p.sx));
            circle.setAttribute('cy', String(p.sy));
            circle.setAttribute('r', '2');
            circle.setAttribute('fill', 'var(--text-muted)');
            group.appendChild(circle);

            const label = document.createElementNS(SVG_NS, 'text');
            label.setAttribute('x', String(p.sx));
            label.setAttribute('y', String(p.sy + (axis === 'z' ? -8 : 14)));
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('fill', 'var(--text-muted)');
            label.setAttribute('font-size', '10');
            label.setAttribute('font-family', 'var(--font-monospace)');
            label.textContent = formatTick(v);
            group.appendChild(label);
        }
    }

    private updateTitleSvg() {
        const cfg = this.config!;
        if (!cfg.title) {
            this.titleEl.textContent = '';
            return;
        }
        this.titleEl.setAttribute('x', String(cfg.width / 2));
        this.titleEl.setAttribute('y', String(PADDING_TOP - 10));
        this.titleEl.textContent = stripLatex(cfg.title);
    }

    // ---- Canvas path ----

    private paintCanvas() {
        const cfg = this.config!;
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

        // Back axes -> surface -> front axes -> annotations -> title.
        this.drawAxesToCanvas('back');
        this.drawQuadsToCanvas(this.quads);
        this.drawAxesToCanvas('front');
        this.drawAnnotationsToCanvas();
        this.drawTitleToCanvas();

        ctx.restore();
    }

    private drawQuadsToCanvas(quads: Quad[]) {
        const ctx = this.ctx;
        for (let i = 0; i < quads.length; i++) {
            const q = quads[i];
            const baseColor = COLOR_MAP[q.color] || q.color;
            const resolved = resolveCssColor(baseColor);
            ctx.beginPath();
            ctx.moveTo(q.p0x, q.p0y);
            ctx.lineTo(q.p1x, q.p1y);
            ctx.lineTo(q.p2x, q.p2y);
            ctx.lineTo(q.p3x, q.p3y);
            ctx.closePath();
            if (q.wireframe) {
                ctx.strokeStyle = resolved;
                ctx.lineWidth = 0.5;
                ctx.globalAlpha = q.opacity;
                ctx.stroke();
                ctx.globalAlpha = 1;
            } else {
                ctx.fillStyle = shadeColor(baseColor, q.zValue);
                ctx.globalAlpha = q.opacity;
                ctx.fill();
                ctx.globalAlpha = 0.4;
                ctx.strokeStyle = resolved;
                ctx.lineWidth = 0.3;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
        }
    }

    private drawAxesToCanvas(layer: 'back' | 'front') {
        const cfg = this.config!;
        const geom = this.computeAxisGeometry(layer);
        const ctx = this.ctx;
        const axisColor = this.themeColors.textMuted;
        ctx.strokeStyle = axisColor;
        ctx.fillStyle = axisColor;
        ctx.lineWidth = 1.5;

        if (geom.drawX) {
            this.canvasLine(geom.origin.sx, geom.origin.sy, geom.xEnd.sx, geom.xEnd.sy);
            this.canvasAxisTicks('x', cfg.xmin, cfg.xmax, cfg.ymin, cfg.zmin);
            if (cfg.showAxisLabels) {
                const lp = this.project(cfg.xmax, cfg.ymin, cfg.zmin);
                this.canvasLabel(lp.sx + 10, lp.sy + 5, cfg.xLabel, 'left');
            }
        }
        if (geom.drawY) {
            this.canvasLine(geom.origin.sx, geom.origin.sy, geom.yEnd.sx, geom.yEnd.sy);
            this.canvasAxisTicks('y', cfg.ymin, cfg.ymax, cfg.xmin, cfg.zmin);
            if (cfg.showAxisLabels) {
                const lp = this.project(cfg.xmin, cfg.ymax, cfg.zmin);
                this.canvasLabel(lp.sx - 15, lp.sy + 5, cfg.yLabel, 'right');
            }
        }
        if (geom.drawZ) {
            this.canvasLine(geom.origin.sx, geom.origin.sy, geom.zEnd.sx, geom.zEnd.sy);
            this.canvasAxisTicks('z', cfg.zmin, cfg.zmax, cfg.xmin, cfg.ymin);
            if (cfg.showAxisLabels) {
                const lp = this.project(cfg.xmin, cfg.ymin, cfg.zmax);
                this.canvasLabel(lp.sx - 10, lp.sy - 8, cfg.zLabel, 'right');
            }
        }
    }

    private canvasLine(x1: number, y1: number, x2: number, y2: number) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    private canvasAxisTicks(axis: 'x' | 'y' | 'z', min: number, max: number, fixedA: number, fixedB: number) {
        const cfg = this.config!;
        const ctx = this.ctx;
        const target = cfg.majorTickNum ? Math.max(2, Math.round(cfg.majorTickNum * 0.6)) : DEFAULT_TARGET_TICKS;
        const interval = niceInterval(max - min, target);
        const start = Math.ceil(min / interval) * interval;

        ctx.font = '10px var(--font-monospace, monospace)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';

        for (let v = start; v <= max; v += interval) {
            let p: { sx: number; sy: number };
            if (axis === 'x') p = this.project(v, fixedA, fixedB);
            else if (axis === 'y') p = this.project(fixedA, v, fixedB);
            else p = this.project(fixedA, fixedB, v);
            ctx.beginPath();
            ctx.arc(p.sx, p.sy, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillText(formatTick(v), p.sx, p.sy + (axis === 'z' ? -8 : 14));
        }
    }

    private canvasLabel(x: number, y: number, text: string, align: 'left' | 'right' | 'center') {
        const ctx = this.ctx;
        ctx.fillStyle = this.themeColors.textNormal;
        ctx.font = '500 13px var(--font-text, sans-serif)';
        ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(text, x, y);
        ctx.fillStyle = this.themeColors.textMuted;
    }

    private drawAnnotationsToCanvas() {
        const cfg = this.config!;
        const annotations = cfg.annotations || [];
        if (!annotations.length) return;
        const ctx = this.ctx;
        for (const a of annotations) {
            if (!a.text) continue;
            const x = parseFloat(a.x);
            const y = parseFloat(a.y);
            const z = parseFloat(a.z ?? '0');
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
            const p = this.project(x, y, z);
            const baseColor = COLOR_MAP[a.color] || a.color || 'var(--text-normal)';
            const fillColor = resolveCssColor(baseColor);
            const fontSize = a.size === 'small' ? 10 : a.size === 'large' ? 15 : 12;
            let align: CanvasTextAlign = 'center';
            let dx = 0;
            let dy = 4;
            switch (a.anchor) {
                case 'above': align = 'center'; dy = -6; break;
                case 'below': align = 'center'; dy = 14; break;
                case 'left': align = 'right'; dx = -6; dy = 4; break;
                case 'right': align = 'left'; dx = 6; dy = 4; break;
                case 'center': default: align = 'center'; dy = 4; break;
            }
            ctx.fillStyle = fillColor;
            ctx.font = `500 ${fontSize}px var(--font-text, sans-serif)`;
            ctx.textAlign = align;
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(a.text, p.sx + dx, p.sy + dy);
        }
    }

    private drawTitleToCanvas() {
        const cfg = this.config!;
        if (!cfg.title) return;
        const ctx = this.ctx;
        ctx.fillStyle = this.themeColors.textNormal;
        ctx.font = '600 15px var(--font-text, sans-serif)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(stripLatex(cfg.title), cfg.width / 2, PADDING_TOP - 10);
    }
}

function quadDepthCompare(a: Quad, b: Quad): number {
    return a.depth - b.depth;
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
