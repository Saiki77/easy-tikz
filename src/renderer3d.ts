import { RendererConfig, Function3DParameters } from './types';
import { MathHelper } from './math';
import { COLOR_MAP, resolveCssColor } from './colors';
import { niceInterval, formatTick, stripLatex, hexToRgb, rgbStringToRgb } from './util';

const SVG_NS = 'http://www.w3.org/2000/svg';

const PADDING_TOP = 40;
const PADDING_RIGHT = 40;
const PADDING_BOTTOM = 40;
const PADDING_LEFT = 40;

/**
 * Fraction of the available viewport used by the projected unit cube. Anything
 * below 1.0 leaves margin for axis labels.
 */
const VIEWPORT_SCALE = 0.28;

/** Default surface sampling resolution per axis when the function does not set its own. */
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

/**
 * Lighten a color towards white based on a 0..1 parameter. Handles hex,
 * `rgb(...)`, and CSS variables. If the color cannot be parsed the original
 * string is returned unchanged.
 */
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
 * Stateful 3D renderer designed for real-time camera interaction.
 *
 * Lifecycle:
 *  - `new SVG3DRenderer()` builds the SVG and its child groups once.
 *  - Each `render(config)` updates camera state, re-uses cached samples when
 *    only the camera changed, mutates pooled polygon elements in place,
 *    and clears+rebuilds the small overlay groups (axes, annotations, title).
 *
 * The returned SVGElement is the same node across calls, so the modal only
 * needs to attach it once.
 */
export class SVG3DRenderer {
    private svg: SVGSVGElement;
    private backgroundRect: SVGRectElement;
    private surfaceGroup: SVGGElement;
    private backAxesGroup: SVGGElement;
    private frontAxesGroup: SVGGElement;
    private annotationsGroup: SVGGElement;
    private titleEl: SVGTextElement;

    /** Polygon pool reused across renders. Grown on demand, never shrunk. */
    private surfacePool: SVGPolygonElement[] = [];

    /**
     * Sampled data per surface index. Key encodes everything that affects the
     * z values; if it matches the new key, we skip the function evaluation
     * loop entirely and only re-project.
     */
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

    // Scratch buffers for the project pass, grown lazily.
    private sxBuf = new Float64Array(0);
    private syBuf = new Float64Array(0);
    private depthBuf = new Float64Array(0);

    constructor() {
        this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;

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
    }

    private makeGroup(cls: string): SVGGElement {
        const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        g.setAttribute('class', cls);
        this.svg.appendChild(g);
        return g;
    }

    /** Discard cached data. Useful when settings outside the cache key change. */
    invalidateCache() {
        this.dataCache.clear();
    }

    /**
     * Update the SVG to reflect `config`. Returns the persistent SVG element
     * (always the same node across calls).
     */
    render(config: RendererConfig): SVGElement {
        this.config = config;

        // SVG dimensions
        this.svg.setAttribute('width', String(config.width));
        this.svg.setAttribute('height', String(config.height));
        this.svg.setAttribute('viewBox', `0 0 ${config.width} ${config.height}`);
        this.backgroundRect.setAttribute('width', String(config.width));
        this.backgroundRect.setAttribute('height', String(config.height));

        // Camera (sin/cos precomputed so the projection inner loop is just multiply-add).
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

        // Prune cache entries for surfaces that no longer exist.
        const liveCount = config.functions3D.length;
        for (const idx of Array.from(this.dataCache.keys())) {
            if (idx >= liveCount) this.dataCache.delete(idx);
        }

        // Collect all quads from all surfaces (depth-sorted across surfaces).
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
                // Bad domain or compile error; surface skipped silently.
                this.dataCache.delete(i);
            }
        }

        allQuads.sort(quadDepthCompare);

        this.updateSurfacePool(allQuads);

        // Axes and annotations rebuild each frame (cheap; just a few dozen elements).
        clearChildren(this.backAxesGroup);
        clearChildren(this.frontAxesGroup);
        clearChildren(this.annotationsGroup);
        this.drawAxes('back');
        this.drawAxes('front');
        this.drawAnnotations();
        this.updateTitle();

        return this.svg;
    }

    /**
     * Return cached samples for surface `idx`, sampling fresh only if the
     * cache key (expression + domains + z range + samples) does not match.
     */
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

    /**
     * Project cached samples through the current camera and push one Quad
     * per cell of the grid into `out`. Two-pass to avoid the 4x redundant
     * projection that a per-quad pass would do.
     */
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

        // Grow scratch buffers if needed.
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

        // Pass 1: project each grid vertex once. NaN cells get sentinel depth = -Infinity.
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

        // Pass 2: emit a quad per (i, j) cell, dropping any cell with a NaN corner.
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

    /**
     * Mutate the pool to match the new quad list:
     *  - reuse `quads.length` polygons by setattr;
     *  - hide the rest;
     *  - lazily grow the pool when needed.
     */
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

    /**
     * Project a single 3D point using the current camera. Used by the
     * (relatively rare) axes and annotation passes.
     */
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

    private drawAnnotations() {
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

    private drawAxes(layer: 'back' | 'front') {
        const cfg = this.config!;
        const { xmin, xmax, ymin, ymax, zmin, zmax } = cfg;
        const axisGroup = layer === 'back' ? this.backAxesGroup : this.frontAxesGroup;

        const origin = this.project(xmin, ymin, zmin);
        const xEnd = this.project(xmax, ymin, zmin);
        const yEnd = this.project(xmin, ymax, zmin);
        const zEnd = this.project(xmin, ymin, zmax);

        const xMid = this.project((xmin + xmax) / 2, ymin, zmin);
        const yMid = this.project(xmin, (ymin + ymax) / 2, zmin);

        const isXBack = xMid.depth < origin.depth;
        const isYBack = yMid.depth < origin.depth;

        const drawX = (layer === 'back') === isXBack || (layer === 'front' && !isXBack);
        const drawY = (layer === 'back') === isYBack || (layer === 'front' && !isYBack);
        const drawZ = layer === 'front';

        const axisColor = 'var(--text-muted)';
        const axisWidth = '1.5';

        if (drawX) {
            this.appendLine(axisGroup, origin.sx, origin.sy, xEnd.sx, xEnd.sy, axisColor, axisWidth);
            this.drawAxisTicks(axisGroup, 'x', xmin, xmax, ymin, zmin);
            if (cfg.showAxisLabels) {
                const lp = this.project(xmax, ymin, zmin);
                this.appendLabel(axisGroup, lp.sx + 10, lp.sy + 5, cfg.xLabel, 'start');
            }
        }

        if (drawY) {
            this.appendLine(axisGroup, origin.sx, origin.sy, yEnd.sx, yEnd.sy, axisColor, axisWidth);
            this.drawAxisTicks(axisGroup, 'y', ymin, ymax, xmin, zmin);
            if (cfg.showAxisLabels) {
                const lp = this.project(xmin, ymax, zmin);
                this.appendLabel(axisGroup, lp.sx - 15, lp.sy + 5, cfg.yLabel, 'end');
            }
        }

        if (drawZ) {
            this.appendLine(axisGroup, origin.sx, origin.sy, zEnd.sx, zEnd.sy, axisColor, axisWidth);
            this.drawAxisTicks(axisGroup, 'z', zmin, zmax, xmin, ymin);
            if (cfg.showAxisLabels) {
                const lp = this.project(xmin, ymin, zmax);
                this.appendLabel(axisGroup, lp.sx - 10, lp.sy - 8, cfg.zLabel, 'end');
            }
        }
    }

    private appendLine(parent: SVGElement, x1: number, y1: number, x2: number, y2: number, stroke: string, width: string) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('stroke', stroke);
        line.setAttribute('stroke-width', width);
        parent.appendChild(line);
    }

    private appendLabel(parent: SVGElement, x: number, y: number, text: string, anchor: string) {
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

    private drawAxisTicks(
        group: SVGElement,
        axis: 'x' | 'y' | 'z',
        min: number,
        max: number,
        fixedA: number,
        fixedB: number
    ) {
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

    private updateTitle() {
        const cfg = this.config!;
        if (!cfg.title) {
            this.titleEl.textContent = '';
            return;
        }
        this.titleEl.setAttribute('x', String(cfg.width / 2));
        this.titleEl.setAttribute('y', String(PADDING_TOP - 10));
        this.titleEl.textContent = stripLatex(cfg.title);
    }
}

function quadDepthCompare(a: Quad, b: Quad): number {
    return a.depth - b.depth;
}

function clearChildren(el: SVGElement) {
    while (el.firstChild) el.removeChild(el.firstChild);
}
