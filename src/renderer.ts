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

/** Default target tick counts used when no user override is supplied. */
const DEFAULT_TARGET_TICKS_X = 8;
const Y_TICK_RATIO = 0.75;

export class SVGRenderer {
    private config: RendererConfig;
    private plotWidth: number;
    private plotHeight: number;
    private defs: SVGElement | null = null;
    private patternIds: Map<string, string> = new Map();
    private patternCounter = 0;

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
        this.defs = defs;
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
        this.drawAnnotations(svg);
        this.drawTitle(svg);

        return svg;
    }

    /**
     * Return an existing or freshly registered `<pattern>` def for the given
     * pattern style and color. The pattern URL is suitable as a `fill` value.
     * Returns null for the solid case so the caller falls back to a flat fill.
     */
    private getOrCreatePattern(style: string, color: string): string | null {
        if (!style || style === 'solid' || !this.defs) return null;
        const key = `${style}|${color}`;
        if (this.patternIds.has(key)) return this.patternIds.get(key)!;
        const id = `tikz-pattern-${++this.patternCounter}`;
        const pattern = this.el('pattern', {
            id,
            patternUnits: 'userSpaceOnUse',
            width: '8',
            height: '8',
        });
        const stroke = color;
        if (style === 'horizontal') {
            pattern.appendChild(this.el('line', { x1: '0', y1: '4', x2: '8', y2: '4', stroke, 'stroke-width': '1.2' }));
        } else if (style === 'vertical') {
            pattern.appendChild(this.el('line', { x1: '4', y1: '0', x2: '4', y2: '8', stroke, 'stroke-width': '1.2' }));
        } else if (style === 'crosshatch') {
            pattern.appendChild(this.el('line', { x1: '0', y1: '0', x2: '8', y2: '8', stroke, 'stroke-width': '1' }));
            pattern.appendChild(this.el('line', { x1: '8', y1: '0', x2: '0', y2: '8', stroke, 'stroke-width': '1' }));
        } else if (style === 'dots') {
            pattern.appendChild(this.el('circle', { cx: '4', cy: '4', r: '1.2', fill: stroke }));
        } else if (style === 'north-east') {
            pattern.appendChild(this.el('line', { x1: '0', y1: '8', x2: '8', y2: '0', stroke, 'stroke-width': '1.2' }));
        } else if (style === 'north-west') {
            pattern.appendChild(this.el('line', { x1: '0', y1: '0', x2: '8', y2: '8', stroke, 'stroke-width': '1.2' }));
        } else {
            return null;
        }
        this.defs.appendChild(pattern);
        this.patternIds.set(key, `url(#${id})`);
        return this.patternIds.get(key)!;
    }

    private drawGrid(svg: SVGElement) {
        if (!this.config.gridMajor && !this.config.gridMinor) return;

        const { xmin, xmax, ymin, ymax } = this.config;
        const targetX = this.config.majorTickNum || DEFAULT_TARGET_TICKS_X;
        const targetY = Math.max(2, Math.round(targetX * Y_TICK_RATIO));
        const majorInterval = niceInterval(xmax - xmin, targetX);
        const majorIntervalY = niceInterval(ymax - ymin, targetY);

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

        const targetX = this.config.majorTickNum || DEFAULT_TARGET_TICKS_X;
        const targetY = Math.max(2, Math.round(targetX * Y_TICK_RATIO));
        const majorIntervalX = niceInterval(xmax - xmin, targetX);
        const majorIntervalY = niceInterval(ymax - ymin, targetY);

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

            const isPolar = this.config.coordinateSystem === 'polar';

            let domMin: number;
            let domMax: number;
            let evalFn: (x: number) => number;
            try {
                [domMin, domMax] = MathHelper.parseDomain(func.domain);
                // Polar uses `theta` as the variable; rewrite to `x` so the
                // compile cache stays unified.
                const exprToCompile = isPolar
                    ? func.expression.replace(/\btheta\b/g, 'x')
                    : func.expression;
                evalFn = MathHelper.compile1D(exprToCompile);
            } catch {
                continue;
            }

            // Cache scaling factors so the hot loop avoids repeated property
            // accesses and computes the screen coords inline (no method call).
            const xmin = this.config.xmin;
            const xRange = this.config.xmax - xmin;
            const ymax = this.config.ymax;
            const yRange = ymax - this.config.ymin;
            const plotW = this.plotWidth;
            const plotH = this.plotHeight;
            const padLeft = PADDING_LEFT;
            const baselineY = this.config.height - PADDING_BOTTOM;
            const yClamp = yRange * Y_CLAMP_FACTOR;

            // Allocate once; fill via index assignment to avoid array resizing.
            const sampleCount = SAMPLES_PER_FUNCTION + 1;
            const xs = new Float64Array(sampleCount);
            const ys = new Float64Array(sampleCount);
            const step = (domMax - domMin) / SAMPLES_PER_FUNCTION;
            try {
                if (isPolar) {
                    // The user's domain is in theta. Evaluate r = f(theta), then
                    // emit Cartesian (r*cos(theta), r*sin(theta)) so the existing
                    // path-builder code stays unchanged.
                    for (let i = 0; i < sampleCount; i++) {
                        const theta = domMin + i * step;
                        const r = evalFn(theta);
                        if (r === r && r !== Infinity && r !== -Infinity) {
                            xs[i] = r * Math.cos(theta);
                            ys[i] = r * Math.sin(theta);
                        } else {
                            xs[i] = NaN;
                            ys[i] = NaN;
                        }
                    }
                } else {
                    for (let i = 0; i < sampleCount; i++) {
                        const mx = domMin + i * step;
                        xs[i] = mx;
                        const my = evalFn(mx);
                        ys[i] = my === my && my !== Infinity && my !== -Infinity ? my : NaN;
                    }
                }
            } catch {
                // Expression threw at runtime. Mark remaining as NaN.
                for (let i = 0; i < sampleCount; i++) {
                    if (!(ys[i] === ys[i])) ys[i] = NaN;
                    if (!(xs[i] === xs[i])) xs[i] = NaN;
                }
            }

            const pathParts: string[] = [];
            let inSegment = false;
            for (let i = 0; i < sampleCount; i++) {
                const y = ys[i];
                if (y !== y || y > yClamp || y < -yClamp) {
                    inSegment = false;
                    continue;
                }
                const sx = padLeft + ((xs[i] - xmin) / xRange) * plotW;
                const sy = baselineY - ((y - this.config.ymin) / yRange) * plotH;
                pathParts.push(`${inSegment ? 'L' : 'M'}${sx.toFixed(2)},${sy.toFixed(2)}`);
                inSegment = true;
            }
            const pathD = pathParts.join(' ');

            if (pathD) {
                if (func.fill) {
                    const yAxisScreen = this.toScreenY(0);
                    const fillParts: string[] = [];
                    let lastX = 0;
                    let segInProgress = false;
                    for (let i = 0; i < sampleCount; i++) {
                        const y = ys[i];
                        if (y !== y || y > yClamp || y < -yClamp) {
                            if (segInProgress) {
                                const closeSx = padLeft + ((lastX - xmin) / xRange) * plotW;
                                fillParts.push(`L${closeSx.toFixed(2)},${yAxisScreen.toFixed(2)} Z`);
                                segInProgress = false;
                            }
                            continue;
                        }
                        const sx = padLeft + ((xs[i] - xmin) / xRange) * plotW;
                        const sy = baselineY - ((y - this.config.ymin) / yRange) * plotH;
                        if (!segInProgress) {
                            fillParts.push(`M${sx.toFixed(2)},${yAxisScreen.toFixed(2)} L${sx.toFixed(2)},${sy.toFixed(2)}`);
                            segInProgress = true;
                        } else {
                            fillParts.push(`L${sx.toFixed(2)},${sy.toFixed(2)}`);
                        }
                        lastX = xs[i];
                    }
                    if (segInProgress) {
                        const closeSx = padLeft + ((lastX - xmin) / xRange) * plotW;
                        fillParts.push(`L${closeSx.toFixed(2)},${yAxisScreen.toFixed(2)} Z`);
                    }

                    const opacity = typeof func.fillOpacity === 'number' ? func.fillOpacity : 0.15;
                    const patternUrl = this.getOrCreatePattern(func.fillPattern || 'solid', cssColor);
                    funcGroup.appendChild(
                        this.el('path', {
                            d: fillParts.join(' '),
                            fill: patternUrl || cssColor,
                            'fill-opacity': String(opacity),
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

    private drawAnnotations(svg: SVGElement) {
        const annotations = this.config.annotations || [];
        if (!annotations.length) return;
        const group = this.el('g', { class: 'tikz-annotations' });
        for (let idx = 0; idx < annotations.length; idx++) {
            const a = annotations[idx];
            if (!a.text) continue;
            const x = parseFloat(a.x);
            const y = parseFloat(a.y);
            if (!isFinite(x) || !isFinite(y)) continue;
            if (x < this.config.xmin || x > this.config.xmax) continue;
            if (y < this.config.ymin || y > this.config.ymax) continue;
            const sx = this.toScreenX(x);
            const sy = this.toScreenY(y);
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
                x: String(sx + dx),
                y: String(sy + dy),
                'text-anchor': textAnchor,
                fill: color,
                'font-size': fontSize,
                'font-weight': '500',
                'font-family': 'var(--font-text)',
                'data-annotation-idx': String(idx),
                'pointer-events': 'bounding-box',
            });
            t.style.cursor = 'grab';
            t.textContent = a.text;
            group.appendChild(t);
        }
        svg.appendChild(group);
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
