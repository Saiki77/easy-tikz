import { RendererConfig, FunctionParameters } from './types';
import { MathHelper } from './math';

const SVG_NS = 'http://www.w3.org/2000/svg';

const COLOR_MAP: Record<string, string> = {
    black: 'var(--text-normal)',
    red: '#e74c3c',
    blue: '#3498db',
    teal: '#1abc9c',
    orange: '#e67e22',
    green: '#2ecc71',
    purple: '#9b59b6',
};

const THICKNESS_MAP: Record<string, number> = {
    'very thin': 1,
    thin: 1.5,
    thick: 2.5,
    'very thick': 3.5,
};

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
    if (Math.abs(value) >= 1000 || (Math.abs(value) < 0.01 && value !== 0)) {
        return value.toExponential(1);
    }
    const s = value.toPrecision(4);
    return parseFloat(s).toString();
}

function stripLatex(text: string): string {
    return text
        .replace(/\\[({]/g, '')
        .replace(/\\[)}]/g, '')
        .replace(/\\\\/g, '')
        .replace(/\\[a-zA-Z]+/g, (m) => {
            const map: Record<string, string> = {
                '\\sum': '\u2211',
                '\\int': '\u222B',
                '\\infty': '\u221E',
                '\\pi': '\u03C0',
                '\\alpha': '\u03B1',
                '\\beta': '\u03B2',
                '\\gamma': '\u03B3',
                '\\delta': '\u03B4',
                '\\theta': '\u03B8',
                '\\lambda': '\u03BB',
                '\\mu': '\u03BC',
                '\\sigma': '\u03C3',
                '\\phi': '\u03C6',
                '\\omega': '\u03C9',
            };
            return map[m] || m.replace('\\', '');
        });
}

export class SVGRenderer {
    private config: RendererConfig;
    private padding = { top: 45, right: 30, bottom: 45, left: 55 };
    private plotWidth: number;
    private plotHeight: number;

    constructor(config: RendererConfig) {
        this.config = config;
        this.plotWidth = config.width - this.padding.left - this.padding.right;
        this.plotHeight = config.height - this.padding.top - this.padding.bottom;
    }

    private toScreenX(mathX: number): number {
        return this.padding.left + ((mathX - this.config.xmin) / (this.config.xmax - this.config.xmin)) * this.plotWidth;
    }

    private toScreenY(mathY: number): number {
        return (
            this.config.height -
            this.padding.bottom -
            ((mathY - this.config.ymin) / (this.config.ymax - this.config.ymin)) * this.plotHeight
        );
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

        // Clip path for plot area
        const defs = this.el('defs');
        const clipPath = this.el('clipPath', { id: 'plot-clip' });
        clipPath.appendChild(
            this.el('rect', {
                x: String(this.padding.left),
                y: String(this.padding.top),
                width: String(this.plotWidth),
                height: String(this.plotHeight),
            })
        );
        defs.appendChild(clipPath);

        // Arrowhead marker
        const marker = this.el('marker', {
            id: 'arrowhead',
            markerWidth: '8',
            markerHeight: '6',
            refX: '8',
            refY: '3',
            orient: 'auto',
        });
        marker.appendChild(
            this.el('path', {
                d: 'M0,0 L8,3 L0,6 Z',
                fill: 'var(--text-muted)',
            })
        );
        defs.appendChild(marker);
        svg.appendChild(defs);

        this.drawGrid(svg);
        this.drawAxes(svg);
        this.drawFunctions(svg);
        this.drawTitle(svg);

        return svg;
    }

    private drawGrid(svg: SVGElement) {
        if (!this.config.gridMajor && !this.config.gridMinor) return;

        const { xmin, xmax, ymin, ymax } = this.config;
        const majorInterval = niceInterval(xmax - xmin, 8);
        const majorIntervalY = niceInterval(ymax - ymin, 6);

        const gridGroup = this.el('g', { class: 'tikz-grid' });

        if (this.config.gridMajor || this.config.gridMinor) {
            // Major grid lines — vertical
            const startX = Math.ceil(xmin / majorInterval) * majorInterval;
            for (let x = startX; x <= xmax; x += majorInterval) {
                gridGroup.appendChild(
                    this.el('line', {
                        x1: String(this.toScreenX(x)),
                        y1: String(this.padding.top),
                        x2: String(this.toScreenX(x)),
                        y2: String(this.config.height - this.padding.bottom),
                        stroke: 'var(--background-modifier-border)',
                        'stroke-width': '1',
                        'stroke-opacity': '0.5',
                    })
                );
            }
            // Major grid lines — horizontal
            const startY = Math.ceil(ymin / majorIntervalY) * majorIntervalY;
            for (let y = startY; y <= ymax; y += majorIntervalY) {
                gridGroup.appendChild(
                    this.el('line', {
                        x1: String(this.padding.left),
                        y1: String(this.toScreenY(y)),
                        x2: String(this.config.width - this.padding.right),
                        y2: String(this.toScreenY(y)),
                        stroke: 'var(--background-modifier-border)',
                        'stroke-width': '1',
                        'stroke-opacity': '0.5',
                    })
                );
            }
        }

        if (this.config.gridMinor) {
            const minorNum = this.config.minorTickNum;
            const minorStepX = majorInterval / minorNum;
            const minorStepY = majorIntervalY / minorNum;

            const startMX = Math.ceil(xmin / minorStepX) * minorStepX;
            for (let x = startMX; x <= xmax; x += minorStepX) {
                gridGroup.appendChild(
                    this.el('line', {
                        x1: String(this.toScreenX(x)),
                        y1: String(this.padding.top),
                        x2: String(this.toScreenX(x)),
                        y2: String(this.config.height - this.padding.bottom),
                        stroke: 'var(--background-modifier-border)',
                        'stroke-width': '0.5',
                        'stroke-opacity': '0.25',
                    })
                );
            }
            const startMY = Math.ceil(ymin / minorStepY) * minorStepY;
            for (let y = startMY; y <= ymax; y += minorStepY) {
                gridGroup.appendChild(
                    this.el('line', {
                        x1: String(this.padding.left),
                        y1: String(this.toScreenY(y)),
                        x2: String(this.config.width - this.padding.right),
                        y2: String(this.toScreenY(y)),
                        stroke: 'var(--background-modifier-border)',
                        'stroke-width': '0.5',
                        'stroke-opacity': '0.25',
                    })
                );
            }
        }

        svg.appendChild(gridGroup);
    }

    private drawAxes(svg: SVGElement) {
        const { xmin, xmax, ymin, ymax } = this.config;
        const axisGroup = this.el('g', { class: 'tikz-axes' });

        const majorIntervalX = niceInterval(xmax - xmin, 8);
        const majorIntervalY = niceInterval(ymax - ymin, 6);

        if (this.config.axisMiddle) {
            // Middle-crossing axes
            const originX = this.toScreenX(0);
            const originY = this.toScreenY(0);
            const clampedOX = Math.max(this.padding.left, Math.min(this.config.width - this.padding.right, originX));
            const clampedOY = Math.max(this.padding.top, Math.min(this.config.height - this.padding.bottom, originY));

            // X-axis
            axisGroup.appendChild(
                this.el('line', {
                    x1: String(this.padding.left),
                    y1: String(clampedOY),
                    x2: String(this.config.width - this.padding.right),
                    y2: String(clampedOY),
                    stroke: 'var(--text-muted)',
                    'stroke-width': '1.5',
                    'marker-end': 'url(#arrowhead)',
                })
            );
            // Y-axis
            axisGroup.appendChild(
                this.el('line', {
                    x1: String(clampedOX),
                    y1: String(this.config.height - this.padding.bottom),
                    x2: String(clampedOX),
                    y2: String(this.padding.top),
                    stroke: 'var(--text-muted)',
                    'stroke-width': '1.5',
                    'marker-end': 'url(#arrowhead)',
                })
            );

            // Tick marks and labels for x-axis
            const startX = Math.ceil(xmin / majorIntervalX) * majorIntervalX;
            for (let x = startX; x <= xmax; x += majorIntervalX) {
                if (Math.abs(x) < majorIntervalX * 0.01) continue;
                const sx = this.toScreenX(x);
                axisGroup.appendChild(
                    this.el('line', {
                        x1: String(sx),
                        y1: String(clampedOY - 4),
                        x2: String(sx),
                        y2: String(clampedOY + 4),
                        stroke: 'var(--text-muted)',
                        'stroke-width': '1',
                    })
                );
                const label = this.el('text', {
                    x: String(sx),
                    y: String(clampedOY + 18),
                    'text-anchor': 'middle',
                    fill: 'var(--text-muted)',
                    'font-size': '11',
                    'font-family': 'var(--font-monospace)',
                });
                label.textContent = formatTick(x);
                axisGroup.appendChild(label);
            }

            // Tick marks and labels for y-axis
            const startY = Math.ceil(ymin / majorIntervalY) * majorIntervalY;
            for (let y = startY; y <= ymax; y += majorIntervalY) {
                if (Math.abs(y) < majorIntervalY * 0.01) continue;
                const sy = this.toScreenY(y);
                axisGroup.appendChild(
                    this.el('line', {
                        x1: String(clampedOX - 4),
                        y1: String(sy),
                        x2: String(clampedOX + 4),
                        y2: String(sy),
                        stroke: 'var(--text-muted)',
                        'stroke-width': '1',
                    })
                );
                const label = this.el('text', {
                    x: String(clampedOX - 8),
                    y: String(sy + 4),
                    'text-anchor': 'end',
                    fill: 'var(--text-muted)',
                    'font-size': '11',
                    'font-family': 'var(--font-monospace)',
                });
                label.textContent = formatTick(y);
                axisGroup.appendChild(label);
            }
        } else {
            // Box axes
            axisGroup.appendChild(
                this.el('rect', {
                    x: String(this.padding.left),
                    y: String(this.padding.top),
                    width: String(this.plotWidth),
                    height: String(this.plotHeight),
                    fill: 'none',
                    stroke: 'var(--text-muted)',
                    'stroke-width': '1.5',
                })
            );

            // X-axis ticks and labels
            const startX = Math.ceil(xmin / majorIntervalX) * majorIntervalX;
            for (let x = startX; x <= xmax; x += majorIntervalX) {
                const sx = this.toScreenX(x);
                // Bottom tick
                axisGroup.appendChild(
                    this.el('line', {
                        x1: String(sx),
                        y1: String(this.config.height - this.padding.bottom),
                        x2: String(sx),
                        y2: String(this.config.height - this.padding.bottom + 5),
                        stroke: 'var(--text-muted)',
                        'stroke-width': '1',
                    })
                );
                const label = this.el('text', {
                    x: String(sx),
                    y: String(this.config.height - this.padding.bottom + 18),
                    'text-anchor': 'middle',
                    fill: 'var(--text-muted)',
                    'font-size': '11',
                    'font-family': 'var(--font-monospace)',
                });
                label.textContent = formatTick(x);
                axisGroup.appendChild(label);
            }

            // Y-axis ticks and labels
            const startY = Math.ceil(ymin / majorIntervalY) * majorIntervalY;
            for (let y = startY; y <= ymax; y += majorIntervalY) {
                const sy = this.toScreenY(y);
                // Left tick
                axisGroup.appendChild(
                    this.el('line', {
                        x1: String(this.padding.left - 5),
                        y1: String(sy),
                        x2: String(this.padding.left),
                        y2: String(sy),
                        stroke: 'var(--text-muted)',
                        'stroke-width': '1',
                    })
                );
                const label = this.el('text', {
                    x: String(this.padding.left - 8),
                    y: String(sy + 4),
                    'text-anchor': 'end',
                    fill: 'var(--text-muted)',
                    'font-size': '11',
                    'font-family': 'var(--font-monospace)',
                });
                label.textContent = formatTick(y);
                axisGroup.appendChild(label);
            }
        }

        // Axis labels
        if (this.config.showAxisLabels) {
            const xLabelEl = this.el('text', {
                x: String(this.padding.left + this.plotWidth / 2),
                y: String(this.config.height - 5),
                'text-anchor': 'middle',
                fill: 'var(--text-normal)',
                'font-size': '13',
                'font-weight': '500',
            });
            xLabelEl.textContent = this.config.xLabel;
            axisGroup.appendChild(xLabelEl);

            const yLabelEl = this.el('text', {
                x: String(12),
                y: String(this.padding.top + this.plotHeight / 2),
                'text-anchor': 'middle',
                fill: 'var(--text-normal)',
                'font-size': '13',
                'font-weight': '500',
                transform: `rotate(-90, 12, ${this.padding.top + this.plotHeight / 2})`,
            });
            yLabelEl.textContent = this.config.yLabel;
            axisGroup.appendChild(yLabelEl);
        }

        svg.appendChild(axisGroup);
    }

    private drawFunctions(svg: SVGElement) {
        const funcGroup = this.el('g', {
            class: 'tikz-functions',
            'clip-path': 'url(#plot-clip)',
        });

        const legendEntries: { color: string; label: string }[] = [];

        for (const func of this.config.functions) {
            if (!func.expression || !func.domain) continue;

            const cssColor = COLOR_MAP[func.color] || func.color;
            const strokeWidth = THICKNESS_MAP[func.thickness] || 1.5;

            try {
                const [domMin, domMax] = MathHelper.parseDomain(func.domain);
                const samples = 500;
                const step = (domMax - domMin) / samples;

                const points: { x: number; y: number }[] = [];
                for (let i = 0; i <= samples; i++) {
                    const mx = domMin + i * step;
                    try {
                        const my = MathHelper.evaluateExpression(func.expression, mx);
                        if (isFinite(my)) {
                            points.push({ x: mx, y: my });
                        } else {
                            points.push({ x: mx, y: NaN });
                        }
                    } catch {
                        points.push({ x: mx, y: NaN });
                    }
                }

                // Build path
                let pathD = '';
                let inSegment = false;
                const yClamp = (this.config.ymax - this.config.ymin) * 10;

                for (const p of points) {
                    if (isNaN(p.y) || Math.abs(p.y) > yClamp) {
                        inSegment = false;
                        continue;
                    }
                    const sx = this.toScreenX(p.x);
                    const sy = this.toScreenY(p.y);
                    if (!inSegment) {
                        pathD += `M${sx.toFixed(2)},${sy.toFixed(2)} `;
                        inSegment = true;
                    } else {
                        pathD += `L${sx.toFixed(2)},${sy.toFixed(2)} `;
                    }
                }

                if (pathD) {
                    // Fill under curve
                    if (func.fill) {
                        let fillD = '';
                        let firstX: number | null = null;
                        let lastX: number | null = null;
                        let segInProgress = false;
                        const yAxisScreen = this.toScreenY(0);

                        for (const p of points) {
                            if (isNaN(p.y) || Math.abs(p.y) > yClamp) {
                                if (segInProgress && lastX !== null) {
                                    fillD += `L${this.toScreenX(lastX).toFixed(2)},${yAxisScreen.toFixed(2)} Z `;
                                    segInProgress = false;
                                    firstX = null;
                                }
                                continue;
                            }
                            const sx = this.toScreenX(p.x);
                            const sy = this.toScreenY(p.y);
                            if (!segInProgress) {
                                fillD += `M${sx.toFixed(2)},${yAxisScreen.toFixed(2)} L${sx.toFixed(2)},${sy.toFixed(2)} `;
                                firstX = p.x;
                                segInProgress = true;
                            } else {
                                fillD += `L${sx.toFixed(2)},${sy.toFixed(2)} `;
                            }
                            lastX = p.x;
                        }
                        if (segInProgress && lastX !== null) {
                            fillD += `L${this.toScreenX(lastX).toFixed(2)},${yAxisScreen.toFixed(2)} Z`;
                        }

                        funcGroup.appendChild(
                            this.el('path', {
                                d: fillD,
                                fill: cssColor,
                                'fill-opacity': '0.15',
                                stroke: 'none',
                            })
                        );
                    }

                    // Curve stroke
                    const attrs: Record<string, string> = {
                        d: pathD,
                        fill: 'none',
                        stroke: cssColor,
                        'stroke-width': String(strokeWidth),
                        'stroke-linejoin': 'round',
                        'stroke-linecap': 'round',
                    };
                    if (func.dashed) {
                        attrs['stroke-dasharray'] = '6 4';
                    }
                    funcGroup.appendChild(this.el('path', attrs));
                }

                // Tangent line
                if (func.tangent && func.tangentPoint) {
                    try {
                        const domain = MathHelper.parseDomain(func.domain);
                        const tangentX = MathHelper.parseTangentPoint(func.tangentPoint, domain);
                        const tangentExpr = MathHelper.calculateTangentLine(func.expression, tangentX);
                        const ty0 = MathHelper.evaluateExpression(func.expression, tangentX);

                        // Draw tangent line across visible range
                        const tLinePoints: string[] = [];
                        for (let i = 0; i <= 100; i++) {
                            const mx = domMin + (i / 100) * (domMax - domMin);
                            try {
                                const my = MathHelper.evaluateExpression(tangentExpr, mx);
                                if (isFinite(my)) {
                                    tLinePoints.push(
                                        `${i === 0 ? 'M' : 'L'}${this.toScreenX(mx).toFixed(2)},${this.toScreenY(my).toFixed(2)}`
                                    );
                                }
                            } catch {}
                        }
                        if (tLinePoints.length > 1) {
                            funcGroup.appendChild(
                                this.el('path', {
                                    d: tLinePoints.join(' '),
                                    fill: 'none',
                                    stroke: cssColor,
                                    'stroke-width': '1.5',
                                    'stroke-dasharray': '6 3',
                                    'stroke-opacity': '0.7',
                                })
                            );
                        }

                        // Tangent point marker
                        funcGroup.appendChild(
                            this.el('circle', {
                                cx: String(this.toScreenX(tangentX).toFixed(2)),
                                cy: String(this.toScreenY(ty0).toFixed(2)),
                                r: '5',
                                fill: cssColor,
                                stroke: 'var(--background-primary)',
                                'stroke-width': '2',
                            })
                        );
                    } catch {}
                }

                // Extrema markers
                if (func.extrema) {
                    try {
                        const extremaPoints = MathHelper.findExtrema(func.expression, func.domain);
                        for (const pt of extremaPoints) {
                            funcGroup.appendChild(
                                this.el('circle', {
                                    cx: String(this.toScreenX(pt.x).toFixed(2)),
                                    cy: String(this.toScreenY(pt.y).toFixed(2)),
                                    r: '5',
                                    fill: cssColor,
                                    stroke: 'var(--background-primary)',
                                    'stroke-width': '2',
                                })
                            );
                            const label = this.el('text', {
                                x: String(this.toScreenX(pt.x).toFixed(2)),
                                y: String(
                                    this.toScreenY(pt.y) + (pt.type === 'minimum' ? 18 : -10)
                                ),
                                'text-anchor': 'middle',
                                fill: cssColor,
                                'font-size': '11',
                                'font-weight': '600',
                            });
                            label.textContent = pt.type === 'minimum' ? 'min' : 'max';
                            funcGroup.appendChild(label);
                        }
                    } catch {}
                }

                if (func.showLegend) {
                    legendEntries.push({ color: cssColor, label: func.expression });
                }
            } catch {}
        }

        svg.appendChild(funcGroup);

        // Legend
        if (legendEntries.length > 0) {
            this.drawLegend(svg, legendEntries);
        }
    }

    private drawLegend(svg: SVGElement, entries: { color: string; label: string }[]) {
        const legendGroup = this.el('g', { class: 'tikz-legend' });
        const boxX = this.config.width - this.padding.right - 10;
        const lineHeight = 20;
        const boxHeight = entries.length * lineHeight + 10;
        const boxWidth = 140;
        const startX = boxX - boxWidth;
        const startY = this.padding.top + 5;

        // Background
        legendGroup.appendChild(
            this.el('rect', {
                x: String(startX),
                y: String(startY),
                width: String(boxWidth),
                height: String(boxHeight),
                fill: 'var(--background-primary)',
                stroke: 'var(--background-modifier-border)',
                'stroke-width': '1',
                rx: '4',
                'fill-opacity': '0.9',
            })
        );

        entries.forEach((entry, i) => {
            const y = startY + 15 + i * lineHeight;
            // Color line
            legendGroup.appendChild(
                this.el('line', {
                    x1: String(startX + 8),
                    y1: String(y),
                    x2: String(startX + 28),
                    y2: String(y),
                    stroke: entry.color,
                    'stroke-width': '2.5',
                })
            );
            // Label
            const label = this.el('text', {
                x: String(startX + 34),
                y: String(y + 4),
                fill: 'var(--text-normal)',
                'font-size': '11',
                'font-family': 'var(--font-monospace)',
            });
            label.textContent = entry.label;
            legendGroup.appendChild(label);
        });

        svg.appendChild(legendGroup);
    }

    private drawTitle(svg: SVGElement) {
        if (!this.config.title) return;
        const titleEl = this.el('text', {
            x: String(this.config.width / 2),
            y: String(this.padding.top - 12),
            'text-anchor': 'middle',
            fill: 'var(--text-normal)',
            'font-size': '15',
            'font-weight': '600',
        });
        titleEl.textContent = stripLatex(this.config.title);
        svg.appendChild(titleEl);
    }
}
