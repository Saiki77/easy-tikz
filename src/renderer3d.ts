import { RendererConfig, Function3DParameters } from './types';
import { MathHelper } from './math';

const SVG_NS = 'http://www.w3.org/2000/svg';

const COLOR_MAP: Record<string, string> = {
    black: '#888888',
    red: '#e74c3c',
    blue: '#3498db',
    teal: '#1abc9c',
    orange: '#e67e22',
    green: '#2ecc71',
    purple: '#9b59b6',
};

interface Quad {
    points: { sx: number; sy: number }[];
    depth: number;
    zValue: number; // normalized 0–1 for color shading
    color: string;
    wireframe: boolean;
    opacity: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function shadeColor(baseHex: string, t: number): string {
    const rgb = hexToRgb(baseHex);
    if (!rgb) return baseHex;
    // Lighten towards white as t increases (higher z = brighter)
    const factor = 0.3 + t * 0.7; // range 0.3 – 1.0
    const r = Math.round(rgb.r * factor + 255 * (1 - factor));
    const g = Math.round(rgb.g * factor + 255 * (1 - factor));
    const b = Math.round(rgb.b * factor + 255 * (1 - factor));
    return `rgb(${r},${g},${b})`;
}

function niceInterval(range: number, targetTicks: number): number {
    const rough = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    let nice: number;
    if (norm <= 1.5) nice = 1;
    else if (norm <= 3) nice = 2;
    else if (norm <= 7) nice = 5;
    else nice = 10;
    return nice * mag;
}

function formatTick(value: number): string {
    if (Math.abs(value) < 1e-10) return '0';
    const s = value.toPrecision(3);
    return parseFloat(s).toString();
}

function stripLatex(text: string): string {
    return text
        .replace(/\\[({]/g, '')
        .replace(/\\[)}]/g, '')
        .replace(/\\\\/g, '')
        .replace(/\\[a-zA-Z]+/g, (m) => m.replace('\\', ''));
}

export class SVG3DRenderer {
    private config: RendererConfig;
    private padding = { top: 40, right: 40, bottom: 40, left: 40 };
    private centerX: number;
    private centerY: number;
    private scale: number;

    // Precomputed rotation
    private cosA: number;
    private sinA: number;
    private cosE: number;
    private sinE: number;

    constructor(config: RendererConfig) {
        this.config = config;
        this.centerX = config.width / 2;
        this.centerY = config.height / 2 + 20; // shift down slightly for title

        // Scale to fit the viewport
        const availW = config.width - this.padding.left - this.padding.right;
        const availH = config.height - this.padding.top - this.padding.bottom;
        this.scale = Math.min(availW, availH) * 0.28;

        const azimuth = (config.rotationZ * Math.PI) / 180;
        const elevation = (config.rotationX * Math.PI) / 180;
        this.cosA = Math.cos(azimuth);
        this.sinA = Math.sin(azimuth);
        this.cosE = Math.cos(elevation);
        this.sinE = Math.sin(elevation);
    }

    private project(x: number, y: number, z: number): { sx: number; sy: number; depth: number } {
        // Normalize to [-1, 1] range
        const { xmin, xmax, ymin, ymax, zmin, zmax } = this.config;
        const nx = ((x - xmin) / (xmax - xmin)) * 2 - 1;
        const ny = ((y - ymin) / (ymax - ymin)) * 2 - 1;
        const nz = ((z - zmin) / (zmax - zmin)) * 2 - 1;

        // Rotate around Z-axis (azimuth)
        const rx = nx * this.cosA - ny * this.sinA;
        const ry = nx * this.sinA + ny * this.cosA;
        const rz = nz;

        // Tilt by elevation (rotate around X-axis)
        const ry2 = ry * this.cosE - rz * this.sinE;
        const rz2 = ry * this.sinE + rz * this.cosE;

        // Orthographic projection
        const sx = this.centerX + rx * this.scale;
        const sy = this.centerY - rz2 * this.scale;
        const depth = ry2; // depth for sorting (further = more negative)

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

        // Background
        svg.appendChild(
            this.el('rect', {
                width: String(this.config.width),
                height: String(this.config.height),
                fill: 'var(--background-primary)',
                rx: '4',
            })
        );

        // Collect all quads from all 3D functions
        const allQuads: Quad[] = [];

        for (const func of this.config.functions3D) {
            if (!func.expression) continue;
            const quads = this.sampleSurface(func);
            allQuads.push(...quads);
        }

        // Draw back axes first (behind surface)
        this.drawAxes(svg, 'back');

        // Sort quads back-to-front (painter's algorithm)
        allQuads.sort((a, b) => a.depth - b.depth);

        // Draw quads
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

        // Draw front axes (on top)
        this.drawAxes(svg, 'front');

        // Title
        this.drawTitle(svg);

        return svg;
    }

    private sampleSurface(func: Function3DParameters): Quad[] {
        const quads: Quad[] = [];
        const [xmin, xmax] = MathHelper.parseDomain(func.xDomain);
        const [ymin, ymax] = MathHelper.parseDomain(func.yDomain);
        const { zmin, zmax } = this.config;
        const zRange = zmax - zmin || 1;

        const gridSize = 40;
        const stepX = (xmax - xmin) / gridSize;
        const stepY = (ymax - ymin) / gridSize;

        // Sample all z values
        const zValues: (number | null)[][] = [];
        for (let i = 0; i <= gridSize; i++) {
            zValues[i] = [];
            for (let j = 0; j <= gridSize; j++) {
                const x = xmin + i * stepX;
                const y = ymin + j * stepY;
                try {
                    const z = MathHelper.evaluateExpression2D(func.expression, x, y);
                    zValues[i][j] = isFinite(z) ? z : null;
                } catch {
                    zValues[i][j] = null;
                }
            }
        }

        // Build quads
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const z00 = zValues[i][j];
                const z10 = zValues[i + 1][j];
                const z01 = zValues[i][j + 1];
                const z11 = zValues[i + 1][j + 1];

                if (z00 === null || z10 === null || z01 === null || z11 === null) continue;

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

        // Axis endpoints
        const origin = this.project(xmin, ymin, zmin);
        const xEnd = this.project(xmax, ymin, zmin);
        const yEnd = this.project(xmin, ymax, zmin);
        const zEnd = this.project(xmin, ymin, zmax);

        // Determine which axes go behind vs in front based on camera
        // Simple heuristic: axes going "away" from camera are back, toward camera are front
        const xMid = this.project((xmin + xmax) / 2, ymin, zmin);
        const yMid = this.project(xmin, (ymin + ymax) / 2, zmin);

        const isXBack = xMid.depth < origin.depth;
        const isYBack = yMid.depth < origin.depth;

        const drawX = (layer === 'back') === isXBack || layer === 'front' && !isXBack;
        const drawY = (layer === 'back') === isYBack || layer === 'front' && !isYBack;
        const drawZ = layer === 'front'; // Z-axis usually in front

        const axisColor = 'var(--text-muted)';
        const axisWidth = '1.5';

        if (drawX) {
            axisGroup.appendChild(
                this.el('line', {
                    x1: String(origin.sx), y1: String(origin.sy),
                    x2: String(xEnd.sx), y2: String(xEnd.sy),
                    stroke: axisColor, 'stroke-width': axisWidth,
                })
            );
            // X ticks
            this.drawAxisTicks(axisGroup, 'x', xmin, xmax, ymin, zmin);
            // Label
            if (this.config.showAxisLabels) {
                const lp = this.project(xmax, ymin, zmin);
                const label = this.el('text', {
                    x: String(lp.sx + 10), y: String(lp.sy + 5),
                    fill: 'var(--text-normal)', 'font-size': '13', 'font-weight': '500',
                });
                label.textContent = this.config.xLabel;
                axisGroup.appendChild(label);
            }
        }

        if (drawY) {
            axisGroup.appendChild(
                this.el('line', {
                    x1: String(origin.sx), y1: String(origin.sy),
                    x2: String(yEnd.sx), y2: String(yEnd.sy),
                    stroke: axisColor, 'stroke-width': axisWidth,
                })
            );
            // Y ticks
            this.drawAxisTicks(axisGroup, 'y', ymin, ymax, xmin, zmin);
            // Label
            if (this.config.showAxisLabels) {
                const lp = this.project(xmin, ymax, zmin);
                const label = this.el('text', {
                    x: String(lp.sx - 15), y: String(lp.sy + 5),
                    'text-anchor': 'end',
                    fill: 'var(--text-normal)', 'font-size': '13', 'font-weight': '500',
                });
                label.textContent = this.config.yLabel;
                axisGroup.appendChild(label);
            }
        }

        if (drawZ) {
            axisGroup.appendChild(
                this.el('line', {
                    x1: String(origin.sx), y1: String(origin.sy),
                    x2: String(zEnd.sx), y2: String(zEnd.sy),
                    stroke: axisColor, 'stroke-width': axisWidth,
                })
            );
            // Z ticks
            this.drawAxisTicks(axisGroup, 'z', zmin, zmax, xmin, ymin);
            // Label
            if (this.config.showAxisLabels) {
                const lp = this.project(xmin, ymin, zmax);
                const label = this.el('text', {
                    x: String(lp.sx - 10), y: String(lp.sy - 8),
                    'text-anchor': 'end',
                    fill: 'var(--text-normal)', 'font-size': '13', 'font-weight': '500',
                });
                label.textContent = this.config.zLabel;
                axisGroup.appendChild(label);
            }
        }

        svg.appendChild(axisGroup);
    }

    private drawAxisTicks(group: SVGElement, axis: 'x' | 'y' | 'z', min: number, max: number, fixedA: number, fixedB: number) {
        const interval = niceInterval(max - min, 5);
        const start = Math.ceil(min / interval) * interval;

        for (let v = start; v <= max; v += interval) {
            let p: { sx: number; sy: number };
            if (axis === 'x') p = this.project(v, fixedA, fixedB);
            else if (axis === 'y') p = this.project(fixedA, v, fixedB);
            else p = this.project(fixedA, fixedB, v);

            // Tick mark (small cross)
            group.appendChild(
                this.el('circle', {
                    cx: String(p.sx), cy: String(p.sy), r: '2',
                    fill: 'var(--text-muted)',
                })
            );

            // Label
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
            y: String(this.padding.top - 10),
            'text-anchor': 'middle',
            fill: 'var(--text-normal)',
            'font-size': '15',
            'font-weight': '600',
        });
        titleEl.textContent = stripLatex(this.config.title);
        svg.appendChild(titleEl);
    }
}
