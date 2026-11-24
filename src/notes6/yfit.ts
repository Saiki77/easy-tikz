/*
 * A chart without a y range (6.0 B): the line `show x from -5 to 5` and no
 * y. Before 6.0 such a chart showed the default y range, -0.5 to 5, which
 * rarely held its curve. Now the chart field `fitY` says "y follows what is
 * drawn": the parser sets it for a 2D chart whose text gives x and not y,
 * the view's y is then fitted over the x range (src/fit.ts) every time the
 * view is resolved, so it follows sliders and edits live, and the printer
 * writes x only. A chart with a y range keeps it; writing y (the Chart tab,
 * a pan or a zoom) turns fitY off. Pure: no DOM, no Obsidian.
 */
import type { MathContext } from '../mathcontext';
import type { Annotation, AxisStyle, FunctionParameters, Tool } from '../types';
import type { View } from '../geometry';
import { fitChart } from '../fit';

/** The chart field. */
export const FIT_Y = 'fitY';

/** What the fit reads of a chart. */
export interface FitYChart {
    functions: FunctionParameters[];
    tools: Tool[];
    annotations: Annotation[];
    axisStyle: AxisStyle;
    polar: boolean;
}

/** The last fitted y per chart, by what it was fitted from. */
const memo = new WeakMap<object, { key: string; y: [number, number] | null }>();

/**
 * The y range a chart with fitY draws over the x range of `view`: what the
 * auto-fit gives for y with x fixed, or null when nothing is drawn (the
 * chart then keeps the y it has). `owner` keys the memo (the settings).
 */
export function followY(owner: object, chart: FitYChart, math: MathContext, view: View): [number, number] | null {
    let key: string;
    try {
        key = `${view.xmin},${view.xmax}|${math.paramsKey}|${JSON.stringify([chart.functions, chart.tools, chart.annotations, chart.axisStyle, chart.polar])}`;
    } catch {
        return null;
    }
    const hit = memo.get(owner);
    if (hit && hit.key === key) return hit.y;
    let y: [number, number] | null = null;
    try {
        const fit = fitChart({ is3D: false, polar: chart.polar, functions: chart.functions, functions3D: [], tools: chart.tools, annotations: chart.annotations, axisStyle: chart.axisStyle, math, view: { ...view, zmin: -5, zmax: 5 }, free: { x: false, y: true, z: false } });
        if (fit.y && Number.isFinite(fit.y.min) && Number.isFinite(fit.y.max) && fit.y.max > fit.y.min) y = [fit.y.min, fit.y.max];
    } catch {
        y = null;
    }
    memo.set(owner, { key, y });
    return y;
}
