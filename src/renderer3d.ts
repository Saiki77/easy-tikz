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
 * below 1.0 leaves margin for axis labels. 0.28 was chosen empirically as a
 * good fit for the default 550x400 preview.
 */
const VIEWPORT_SCALE = 0.28;

/** Default surface sampling resolution per axis when the function does not set its own. */
const DEFAULT_GRID_SAMPLES = 40;

/** Default target number of major ticks per 3D axis. */
const DEFAULT_TARGET_TICKS = 5;

interface Quad {
    points: { sx: number; sy: number }[];
    depth: number;
    zValue: number;
    color: string;
    wireframe: boolean;
    opacity: number;
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

export class SVG3DRenderer {
    private config: RendererConfig;
    private centerX: number;
    private centerY: number;
    private scale: number;

    private cosA: number;
    private sinA: number;
    private cosE: number;
    private sinE: number;

    constructor(config: RendererConfig) {
        this.config = config;
        this.centerX = config.width / 2;
        this.centerY = config.height / 2 + 20;

        const availW = config.width - PADDING_LEFT - PADDING_RIGHT;
        const availH = config.height - PADDING_TOP - PADDING_BOTTOM;
        this.scale = Math.min(availW, availH) * VIEWPORT_SCALE;

        const azimuth = (config.rotationZ * Math.PI) / 180;
        const elevation = (config.rotationX * Math.PI) / 180;
        this.cosA = Math.cos(azimuth);
        this.sinA = Math.sin(azimuth);
        this.cosE = Math.cos(elevation);
        this.sinE = Math.sin(elevation);
    }

    /**
     * Project a 3D point to screen coordinates. Normalises into [-1, 1],
     * rotates around the Z axis by azimuth, tilts around X by elevation, then
     * uses an orthographic projection. Returns the screen position and a
     * depth value usable for painter's-algorithm sorting (further = smaller).
     */
    private project(x: number, y: number, z: number): { sx: number; sy: number; depth: number } {
        const { xmin, xmax, ymin, ymax, zmin, zmax } = this.config;
        const nx = ((x - xmin) / (xmax - xmin)) * 2 - 1;
        const ny = ((y - ymin) / (ymax - ymin)) * 2 - 1;
        const nz = ((z - zmin) / (zmax - zmin)) * 2 - 1;

        const rx = nx * this.cosA - ny * this.sinA;
        const ry = nx * this.sinA + ny * this.cosA;
        const rz = nz;

        const ry2 = ry * this.cosE - rz * this.sinE;
        const rz2 = ry * this.sinE + rz * this.cosE;

        const sx = this.centerX + rx * this.scale;
        const sy = this.centerY - rz2 * this.scale;
        const depth = ry2;

        return { sx, sy, depth };
    }

    private el(tag: string, attrs: Record<string, string> = {}): SVGElement {
        const e = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) {
            e.setAttribute(k, v);
        }
        return e;
    }

    render(): SVGElement {
        const svg = this.el('svg', {
            width: String(this.config.width),
            height: String(this.config.height),
            viewBox: `0 0 ${this.config.width} ${this.config.height}`,
        }) as SVGSVGElement;

        svg.appendChild(
            this.el('rect', {
                width: String(this.config.width),
                height: String(this.config.height),
                fill: 'var(--background-primary)',
                rx: '4',
            })
        );

        const allQuads: Quad[] = [];

        for (const func of this.config.functions3D) {
            if (!func.expression) continue;
            try {
                const quads = this.sampleSurface(func);
                allQuads.push(...quads);
            } catch {
                // Bad domain or expression; skip this surface without aborting the render.
            }
        }

        this.drawAxes(svg, 'back');

        allQuads.sort((a, b) => a.depth - b.depth);

        const surfaceGroup = this.el('g', { class: 'tikz-3d-surface' });
        for (const quad of allQuads) {
            const pointsStr = quad.points.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' ');
            const baseColor = COLOR_MAP[quad.color] || quad.color;

            if (quad.wireframe) {
                surfaceGroup.appendChild(
                    this.el('polygon', {
                        points: pointsStr,
                        fill: 'none',
                        stroke: baseColor,
                        'stroke-width': '0.5',
                        'stroke-opacity': String(quad.opacity),
                    })
                );
            } else {
                const fillColor = shadeColor(baseColor, quad.zValue);
                surfaceGroup.appendChild(
                    this.el('polygon', {
                        points: pointsStr,
                        fill: fillColor,
                        'fill-opacity': String(quad.opacity),
                        stroke: baseColor,
                        'stroke-width': '0.3',
                        'stroke-opacity': '0.4',
                    })
                );
            }
        }
        svg.appendChild(surfaceGroup);

        this.drawAxes(svg, 'front');
        this.drawAnnotations(svg);
        this.drawTitle(svg);

        return svg;
    }

    private drawAnnotations(svg: SVGElement) {
        const annotations = this.config.annotations || [];
        if (!annotations.length) return;
        const group = this.el('g', { class: 'tikz-3d-annotations' });
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
            const t = this.el('text', {
                x: String(p.sx + dx),
                y: String(p.sy + dy),
                'text-anchor': textAnchor,
                fill: color,
                'font-size': fontSize,
                'font-weight': '500',
                'font-family': 'var(--font-text)',
            });
            t.textContent = a.text;
            group.appendChild(t);
        }
        svg.appendChild(group);
    }

    private sampleSurface(func: Function3DParameters): Quad[] {
        const quads: Quad[] = [];
        const [xmin, xmax] = MathHelper.parseDomain(func.xDomain);
        const [ymin, ymax] = MathHelper.parseDomain(func.yDomain);
        const { zmin, zmax } = this.config;
        const zRange = zmax - zmin || 1;

        const samples = Math.max(4, Math.min(120, func.samples || DEFAULT_GRID_SAMPLES));
        const stepX = (xmax - xmin) / samples;
        const stepY = (ymax - ymin) / samples;

        // Compile once instead of N*N times via evaluateExpression2D.
        const evalFn = MathHelper.compile2D(func.expression);

        // Flat Float64Array is faster than a 2D nested array. NaN marks invalid cells.
        const stride = samples + 1;
        const zValues = new Float64Array(stride * stride);
        try {
            for (let i = 0; i <= samples; i++) {
                const x = xmin + i * stepX;
                const rowOffset = i * stride;
                for (let j = 0; j <= samples; j++) {
                    const y = ymin + j * stepY;
                    const z = evalFn(x, y);
                    zValues[rowOffset + j] = z === z && z !== Infinity && z !== -Infinity ? z : NaN;
                }
            }
        } catch {
            // Defensive: leave any unfilled cells as NaN (Float64Array defaults to 0,
            // but NaN-or-0 sentinel is fine because we only check NaN below).
            for (let k = 0; k < zValues.length; k++) {
                if (zValues[k] === 0 && !(zValues[k] === zValues[k])) zValues[k] = NaN;
            }
        }
        const z = (i: number, j: number): number => zValues[i * stride + j];

        for (let i = 0; i < samples; i++) {
            for (let j = 0; j < samples; j++) {
                const z00 = z(i, j);
                const z10 = z(i + 1, j);
                const z01 = z(i, j + 1);
                const z11 = z(i + 1, j + 1);

                if (z00 !== z00 || z10 !== z10 || z01 !== z01 || z11 !== z11) continue;

                const x0 = xmin + i * stepX;
                const x1 = xmin + (i + 1) * stepX;
                const y0 = ymin + j * stepY;
                const y1 = ymin + (j + 1) * stepY;

                const p00 = this.project(x0, y0, z00);
                const p10 = this.project(x1, y0, z10);
                const p11 = this.project(x1, y1, z11);
                const p01 = this.project(x0, y1, z01);

                const avgDepth = (p00.depth + p10.depth + p11.depth + p01.depth) / 4;
                const avgZ = ((z00 + z10 + z01 + z11) / 4 - zmin) / zRange;

                quads.push({
                    points: [
                        { sx: p00.sx, sy: p00.sy },
                        { sx: p10.sx, sy: p10.sy },
                        { sx: p11.sx, sy: p11.sy },
                        { sx: p01.sx, sy: p01.sy },
                    ],
                    depth: avgDepth,
                    zValue: Math.max(0, Math.min(1, avgZ)),
                    color: func.color,
                    wireframe: func.wireframe,
                    opacity: func.opacity,
                });
            }
        }

        return quads;
    }

    private drawAxes(svg: SVGElement, layer: 'back' | 'front') {
        const { xmin, xmax, ymin, ymax, zmin, zmax } = this.config;
        const axisGroup = this.el('g', { class: `tikz-3d-axes-${layer}` });

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
            axisGroup.appendChild(
                this.el('line', {
                    x1: String(origin.sx),
                    y1: String(origin.sy),
                    x2: String(xEnd.sx),
                    y2: String(xEnd.sy),
                    stroke: axisColor,
                    'stroke-width': axisWidth,
                })
            );
            this.drawAxisTicks(axisGroup, 'x', xmin, xmax, ymin, zmin);
            if (this.config.showAxisLabels) {
                const lp = this.project(xmax, ymin, zmin);
                const label = this.el('text', {
                    x: String(lp.sx + 10),
                    y: String(lp.sy + 5),
                    fill: 'var(--text-normal)',
                    'font-size': '13',
                    'font-weight': '500',
                });
                label.textContent = this.config.xLabel;
                axisGroup.appendChild(label);
            }
        }

        if (drawY) {
            axisGroup.appendChild(
                this.el('line', {
                    x1: String(origin.sx),
                    y1: String(origin.sy),
                    x2: String(yEnd.sx),
                    y2: String(yEnd.sy),
                    stroke: axisColor,
                    'stroke-width': axisWidth,
                })
            );
            this.drawAxisTicks(axisGroup, 'y', ymin, ymax, xmin, zmin);
            if (this.config.showAxisLabels) {
                const lp = this.project(xmin, ymax, zmin);
                const label = this.el('text', {
                    x: String(lp.sx - 15),
                    y: String(lp.sy + 5),
                    'text-anchor': 'end',
                    fill: 'var(--text-normal)',
                    'font-size': '13',
                    'font-weight': '500',
                });
                label.textContent = this.config.yLabel;
                axisGroup.appendChild(label);
            }
        }

        if (drawZ) {
            axisGroup.appendChild(
                this.el('line', {
                    x1: String(origin.sx),
                    y1: String(origin.sy),
                    x2: String(zEnd.sx),
                    y2: String(zEnd.sy),
                    stroke: axisColor,
                    'stroke-width': axisWidth,
                })
            );
            this.drawAxisTicks(axisGroup, 'z', zmin, zmax, xmin, ymin);
            if (this.config.showAxisLabels) {
                const lp = this.project(xmin, ymin, zmax);
                const label = this.el('text', {
                    x: String(lp.sx - 10),
                    y: String(lp.sy - 8),
                    'text-anchor': 'end',
                    fill: 'var(--text-normal)',
                    'font-size': '13',
                    'font-weight': '500',
                });
                label.textContent = this.config.zLabel;
                axisGroup.appendChild(label);
            }
        }

        svg.appendChild(axisGroup);
    }

    private drawAxisTicks(
        group: SVGElement,
        axis: 'x' | 'y' | 'z',
        min: number,
        max: number,
        fixedA: number,
        fixedB: number
    ) {
        const target = this.config.majorTickNum ? Math.max(2, Math.round(this.config.majorTickNum * 0.6)) : DEFAULT_TARGET_TICKS;
        const interval = niceInterval(max - min, target);
        const start = Math.ceil(min / interval) * interval;

        for (let v = start; v <= max; v += interval) {
            let p: { sx: number; sy: number };
            if (axis === 'x') p = this.project(v, fixedA, fixedB);
            else if (axis === 'y') p = this.project(fixedA, v, fixedB);
            else p = this.project(fixedA, fixedB, v);

            group.appendChild(
                this.el('circle', {
                    cx: String(p.sx),
                    cy: String(p.sy),
                    r: '2',
                    fill: 'var(--text-muted)',
                })
            );

            const label = this.el('text', {
                x: String(p.sx),
                y: String(p.sy + (axis === 'z' ? -8 : 14)),
                'text-anchor': 'middle',
                fill: 'var(--text-muted)',
                'font-size': '10',
                'font-family': 'var(--font-monospace)',
            });
            label.textContent = formatTick(v);
            group.appendChild(label);
        }
    }

    private drawTitle(svg: SVGElement) {
        if (!this.config.title) return;
        const titleEl = this.el('text', {
            x: String(this.config.width / 2),
            y: String(PADDING_TOP - 10),
            'text-anchor': 'middle',
            fill: 'var(--text-normal)',
            'font-size': '15',
            'font-weight': '600',
        });
        titleEl.textContent = stripLatex(this.config.title);
        svg.appendChild(titleEl);
    }
}
