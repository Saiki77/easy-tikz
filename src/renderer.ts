import { RendererConfig } from './types';
import { MathHelper } from './math';
import { COLOR_MAP, THICKNESS_MAP } from './colors';
import { niceInterval, formatTick, stripLatex } from './util';

const SVG_NS = 'http://www.w3.org/2000/svg';

const PADDING_TOP = 45;
const PADDING_RIGHT = 30;
const PADDING_BOTTOM = 45;
const PADDING_LEFT = 55;

const SAMPLES_PER_FUNCTION = 500;

/**
 * Clamp limit for plotted y-values, expressed as a multiple of the y-axis
 * range. Asymptotes (e.g. tan, 1/x near 0) shoot to infinity; clamping keeps
 * the SVG path bounded without losing visible detail.
 */
const Y_CLAMP_FACTOR = 10;

const TARGET_TICKS_X = 8;
const TARGET_TICKS_Y = 6;

export class SVGRenderer {
    private config: RendererConfig;
    private plotWidth: number;
    private plotHeight: number;

    constructor(config: RendererConfig) {
        this.config = config;
        this.plotWidth = config.width - PADDING_LEFT - PADDING_RIGHT;
        this.plotHeight = config.height - PADDING_TOP - PADDING_BOTTOM;
    }

    private toScreenX(mathX: number): number {
        return PADDING_LEFT + ((mathX - this.config.xmin) / (this.config.xmax - this.config.xmin)) * this.plotWidth;
    }

    private toScreenY(mathY: number): number {
        return (
            this.config.height -
            PADDING_BOTTOM -
            ((mathY - this.config.ymin) / (this.config.ymax - this.config.ymin)) * this.plotHeight
        );
    }

    /** Create an SVG element with the given tag and attributes. */
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

        const defs = this.el('defs');
        const clipPath = this.el('clipPath', { id: 'plot-clip' });
        clipPath.appendChild(
            this.el('rect', {
                x: String(PADDING_LEFT),
                y: String(PADDING_TOP),
                width: String(this.plotWidth),
                height: String(this.plotHeight),
            })
        );
        defs.appendChild(clipPath);

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
        const majorInterval = niceInterval(xmax - xmin, TARGET_TICKS_X);
        const majorIntervalY = niceInterval(ymax - ymin, TARGET_TICKS_Y);

        const gridGroup = this.el('g', { class: 'tikz-grid' });

        if (this.config.gridMajor || this.config.gridMinor) {
            const startX = Math.ceil(xmin / majorInterval) * majorInterval;
            for (let x = startX; x <= xmax; x += majorInterval) {
                gridGroup.appendChild(
                    this.el('line', {
                        x1: String(this.toScreenX(x)),
                        y1: String(PADDING_TOP),
                        x2: String(this.toScreenX(x)),
                        y2: String(this.config.height - PADDING_BOTTOM),
                        stroke: 'var(--background-modifier-border)',
                        'stroke-width': '1',
                        'stroke-opacity': '0.5',
                    })
                );
            }
            const startY = Math.ceil(ymin / majorIntervalY) * majorIntervalY;
            for (let y = startY; y <= ymax; y += majorIntervalY) {
                gridGroup.appendChild(
                    this.el('line', {
                        x1: String(PADDING_LEFT),
                        y1: String(this.toScreenY(y)),
                        x2: String(this.config.width - PADDING_RIGHT),
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
                        y1: String(PADDING_TOP),
                        x2: String(this.toScreenX(x)),
                        y2: String(this.config.height - PADDING_BOTTOM),
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
                        x1: String(PADDING_LEFT),
                        y1: String(this.toScreenY(y)),
                        x2: String(this.config.width - PADDING_RIGHT),
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

        const majorIntervalX = niceInterval(xmax - xmin, TARGET_TICKS_X);
        const majorIntervalY = niceInterval(ymax - ymin, TARGET_TICKS_Y);

        if (this.config.axisMiddle) {
            const originX = this.toScreenX(0);
            const originY = this.toScreenY(0);
            const clampedOX = Math.max(PADDING_LEFT, Math.min(this.config.width - PADDING_RIGHT, originX));
            const clampedOY = Math.max(PADDING_TOP, Math.min(this.config.height - PADDING_BOTTOM, originY));

            axisGroup.appendChild(
                this.el('line', {
                    x1: String(PADDING_LEFT),
                    y1: String(clampedOY),
                    x2: String(this.config.width - PADDING_RIGHT),
                    y2: String(clampedOY),
                    stroke: 'var(--text-muted)',
                    'stroke-width': '1.5',
                    'marker-end': 'url(#arrowhead)',
                })
            );
            axisGroup.appendChild(
                this.el('line', {
                    x1: String(clampedOX),
                    y1: String(this.config.height - PADDING_BOTTOM),
                    x2: String(clampedOX),
                    y2: String(PADDING_TOP),
                    stroke: 'var(--text-muted)',
                    'stroke-width': '1.5',
                    'marker-end': 'url(#arrowhead)',
                })
            );

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
            axisGroup.appendChild(
                this.el('rect', {
                    x: String(PADDING_LEFT),
                    y: String(PADDING_TOP),
                    width: String(this.plotWidth),
                    height: String(this.plotHeight),
                    fill: 'none',
                    stroke: 'var(--text-muted)',
                    'stroke-width': '1.5',
                })
            );

            const startX = Math.ceil(xmin / majorIntervalX) * majorIntervalX;
            for (let x = startX; x <= xmax; x += majorIntervalX) {
                const sx = this.toScreenX(x);
                axisGroup.appendChild(
                    this.el('line', {
                        x1: String(sx),
                        y1: String(this.config.height - PADDING_BOTTOM),
                        x2: String(sx),
                        y2: String(this.config.height - PADDING_BOTTOM + 5),
                        stroke: 'var(--text-muted)',
                        'stroke-width': '1',
                    })
                );
                const label = this.el('text', {
                    x: String(sx),
                    y: String(this.config.height - PADDING_BOTTOM + 18),
                    'text-anchor': 'middle',
                    fill: 'var(--text-muted)',
                    'font-size': '11',
                    'font-family': 'var(--font-monospace)',
                });
                label.textContent = formatTick(x);
                axisGroup.appendChild(label);
            }

            const startY = Math.ceil(ymin / majorIntervalY) * majorIntervalY;
            for (let y = startY; y <= ymax; y += majorIntervalY) {
                const sy = this.toScreenY(y);
                axisGroup.appendChild(
                    this.el('line', {
                        x1: String(PADDING_LEFT - 5),
                        y1: String(sy),
                        x2: String(PADDING_LEFT),
                        y2: String(sy),
                        stroke: 'var(--text-muted)',
                        'stroke-width': '1',
                    })
                );
                const label = this.el('text', {
                    x: String(PADDING_LEFT - 8),
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

        if (this.config.showAxisLabels) {
            const xLabelEl = this.el('text', {
                x: String(PADDING_LEFT + this.plotWidth / 2),
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
                y: String(PADDING_TOP + this.plotHeight / 2),
                'text-anchor': 'middle',
                fill: 'var(--text-normal)',
                'font-size': '13',
                'font-weight': '500',
                transform: `rotate(-90, 12, ${PADDING_TOP + this.plotHeight / 2})`,
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

            let domMin: number;
            let domMax: number;
            try {
                [domMin, domMax] = MathHelper.parseDomain(func.domain);
            } catch {
                continue;
            }

            const step = (domMax - domMin) / SAMPLES_PER_FUNCTION;
            const points: { x: number; y: number }[] = [];
            for (let i = 0; i <= SAMPLES_PER_FUNCTION; i++) {
                const mx = domMin + i * step;
                try {
                    const my = MathHelper.evaluateExpression(func.expression, mx);
                    points.push({ x: mx, y: isFinite(my) ? my : NaN });
                } catch {
                    points.push({ x: mx, y: NaN });
                }
            }

            let pathD = '';
            let inSegment = false;
            const yClamp = (this.config.ymax - this.config.ymin) * Y_CLAMP_FACTOR;

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

            if (func.tangent && func.tangentPoint) {
                try {
                    const domain = MathHelper.parseDomain(func.domain);
                    const tangentX = MathHelper.parseTangentPoint(func.tangentPoint, domain);
                    const tangentExpr = MathHelper.calculateTangentLine(func.expression, tangentX);
                    const ty0 = MathHelper.evaluateExpression(func.expression, tangentX);

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
                        } catch {
                            // Skip samples that fail to evaluate; the rest of the line still renders.
                        }
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
                } catch {
                    // Tangent failed (bad point, domain mismatch). Skip without breaking the curve.
                }
            }

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
                            y: String(this.toScreenY(pt.y) + (pt.type === 'minimum' ? 18 : -10)),
                            'text-anchor': 'middle',
                            fill: cssColor,
                            'font-size': '11',
                            'font-weight': '600',
                        });
                        label.textContent = pt.type === 'minimum' ? 'min' : 'max';
                        funcGroup.appendChild(label);
                    }
                } catch {
                    // Extrema search failed; skip silently.
                }
            }

            if (func.showLegend) {
                legendEntries.push({ color: cssColor, label: func.expression });
            }
        }

        svg.appendChild(funcGroup);

        if (legendEntries.length > 0) {
            this.drawLegend(svg, legendEntries);
        }
    }

    private drawLegend(svg: SVGElement, entries: { color: string; label: string }[]) {
        const legendGroup = this.el('g', { class: 'tikz-legend' });
        const boxX = this.config.width - PADDING_RIGHT - 10;
        const lineHeight = 20;
        const boxHeight = entries.length * lineHeight + 10;
        const boxWidth = 140;
        const startX = boxX - boxWidth;
        const startY = PADDING_TOP + 5;

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
            y: String(PADDING_TOP - 12),
            'text-anchor': 'middle',
            fill: 'var(--text-normal)',
            'font-size': '15',
            'font-weight': '600',
        });
        titleEl.textContent = stripLatex(this.config.title);
        svg.appendChild(titleEl);
    }
}
