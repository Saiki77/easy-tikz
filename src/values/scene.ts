/*
 * 6.0 A: the tools of values as scene primitives: a let definition draws
 * nothing (its problem shows on its card); vector arrows are strokes with
 * an arrow head, like the arrows of segments, from the origin, from a point
 * or end to end; the points of a list are markers, joined into a closed
 * polygon when asked. The preview and the pgfplots export draw them alike,
 * as numeric coordinates. 2D and 3D. Pure: no DOM, no Obsidian.
 */
import type { ListPointsTool, MarkerSize, Tool, VectorTool } from '../types';
import type { Pt } from '../geometry';
import type { SceneCtx, SceneOutput } from '../scene';
import { addIssue, fail, midSpot, newOutput, normDir, publish } from '../scene';
import { t as msg } from '../i18n';
import { errorText } from '../util';
import { Part, shapeText } from './compile';
import { formatValue } from './format';
import { VNode, parseValue } from './parse';
import { nodeTex, sumTerms } from './tex';
import { Value, isList, pointOf, shapeOf } from './types';
import { add, neg } from './ops';
import type { FitShapes } from '../beyond/fit';

/** The tool types of this module. */
export const VALUE_TYPES: ReadonlySet<string> = new Set(['value', 'vector', 'listPoints']);

function str(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
}

/** `v; w` as its formulas. */
function vectorList(src: string): string[] {
    return src
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s);
}

/**
 * Producers and evaluated sources of a tool of this module, for the scene's
 * dependency graph and cache keys; false for any other tool.
 */
export function valuesSources(t: Tool, scan: (src: unknown, field: string) => void): boolean {
    switch (t.type) {
        case 'value':
            scan(t.expression, 'expression');
            return true;
        case 'vector':
            for (const v of vectorList(str(t.vectors))) scan(v, 'vectors');
            scan(t.from, 'from');
            return true;
        case 'listPoints':
            scan(t.points, 'points');
            return true;
        default:
            return false;
    }
}

/** A formula of a value field, compiled, with its problem as an ExprError. */
function compiled(src: string, ctx: SceneCtx): Part {
    return ctx.math.valueTable().compileField(src, ctx.math.envFor('value'));
}

/** The value of a formula now; a problem fails the tool (an info while a computed value it reads is unset). */
function valueOf(src: string, field: string, name: string, ctx: SceneCtx, out: SceneOutput): Value | null {
    try {
        return compiled(src, ctx).f();
    } catch (e) {
        if (ctx.math.deps(src).derived.length) addIssue(out, name, field, errorText(e), 'info');
        else fail(out, name, field, errorText(e));
        return null;
    }
}

/** Is the name a vector (or a complex number) of the chart's definitions? For the arrows over names in labels. */
function vectorName(ctx: SceneCtx): (name: string) => boolean {
    const table = ctx.math.valueTable();
    return (name: string) => {
        if (!table.has(name) || table.isFunction(name)) return false;
        const k = table.shape(name).k;
        return k === 'vec' || k === 'complex';
    };
}

/** A tool of this module computed in a 2D chart; null for any other tool. */
export function computeValues(t: Tool, ctx: SceneCtx): SceneOutput | null {
    switch (t.type) {
        case 'value':
            return computeDefinition(t.name, ctx);
        case 'vector':
            return computeVectors(t, ctx, 2);
        case 'listPoints':
            return computeListPoints(t, ctx, 2);
        default:
            return null;
    }
}

/** A tool of this module computed in a 3D chart; null for any other tool. */
export function computeValues3D(t: Tool, ctx: SceneCtx): SceneOutput | null {
    switch (t.type) {
        case 'value':
            return computeDefinition(t.name, ctx);
        case 'vector':
            return computeVectors(t, ctx, 3);
        case 'listPoints':
            return computeListPoints(t, ctx, 3);
        default:
            return null;
    }
}

function computeDefinition(name: string, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const problem = ctx.math.valueTable().problem(name);
    if (problem) fail(out, name, 'expression', problem);
    return out;
}

// ------------------------------------------------------------------ arrows

interface Arrow {
    from: number[];
    to: number[];
    /** Its formula as LaTeX, for `labelled`. */
    tex: string | null;
    /** A part of a sum drawn tip to tail (dashed). */
    part: boolean;
    /** The vector (for the label's locals). */
    v: number[];
}

/** A value as a vector of the chart: a vector of `dim` numbers, a complex number (re, im), a 2D vector in 3D (z = 0). */
function asVector(v: Value, dim: 2 | 3): number[] | null {
    if (typeof v === 'number' || isList(v)) return null;
    return pointOf(v, dim);
}

function computeVectors(t: VectorTool, ctx: SceneCtx, dim: 2 | 3): SceneOutput {
    const out = newOutput();
    const items = vectorList(str(t.vectors));
    if (!items.length) return out;
    // Where the arrows start.
    let start = dim === 2 ? [0, 0] : [0, 0, 0];
    const fromSrc = str(t.from).trim();
    if (fromSrc) {
        // A points tool (a dragged point moves the arrows); a let name is a value like any formula.
        const tool = ctx.toolsByName.get(fromSrc);
        if (tool && tool.type !== 'value') {
            const prod = ctx.outputs.get(fromSrc);
            const p = prod && prod.points && prod.points[0];
            if (!p) return fail(out, t.name, 'from', msg('problems.scene.hasError', { name: fromSrc }));
            start = dim === 2 ? [p[0], p[1]] : [p[0], p[1], p[2] ?? 0];
        } else {
            const v = valueOf(fromSrc, 'from', t.name, ctx, out);
            if (v === null) return out;
            const p = asVector(v, dim);
            if (!p) return fail(out, t.name, 'from', msg('values.problem.fromPoint', { what: shapeText(shapeOf(v)) }));
            start = p;
        }
    }
    const isVector = vectorName(ctx);
    const arrows: Arrow[] = [];
    const vectorOf = (v: Value, text: string): number[] | null => {
        if (typeof v !== 'number' && v.kind === 'vec' && v.v.length !== dim && !(dim === 3 && v.v.length === 2)) {
            fail(out, t.name, 'vectors', msg('values.problem.dimension', { text, n: v.v.length, dim }));
            return null;
        }
        const p = asVector(v, dim);
        if (!p) fail(out, t.name, 'vectors', msg('values.problem.notAVector', { text, what: shapeText(shapeOf(v)) }));
        return p;
    };
    if (t.tipToTail) {
        const src = items[0];
        const terms = sumTerms(src);
        if (!terms) {
            valueOf(src, 'vectors', t.name, ctx, out);
            return out;
        }
        if (terms.length < 2) addIssue(out, t.name, 'vectors', msg('values.problem.tipToTail'), 'info');
        const env = ctx.math.envFor('value');
        const table = ctx.math.valueTable();
        let at = start;
        let total: Value = dim === 2 ? { kind: 'vec', v: [0, 0] } : { kind: 'vec', v: [0, 0, 0] };
        for (const term of terms) {
            let v: Value;
            try {
                v = table.compileNode(term.node, env, src).f();
            } catch (e) {
                return fail(out, t.name, 'vectors', errorText(e));
            }
            if (term.sign < 0) v = neg(v);
            const p = vectorOf(v, src);
            if (!p) return out;
            const to = at.map((c, i) => c + p[i]);
            const body = nodeTex(term.node, isVector);
            arrows.push({ from: at, to, tex: body === null ? null : term.sign < 0 ? `-${body}` : body, part: terms.length > 1, v: p });
            at = to;
            total = add(total, { kind: 'vec', v: p });
        }
        if (terms.length > 1) {
            const sum = asVector(total, dim) ?? [];
            arrows.push({ from: start, to: at, tex: wholeTex(src, isVector), part: false, v: sum });
        }
    } else {
        for (const src of items) {
            const v = valueOf(src, 'vectors', t.name, ctx, out);
            if (v === null) return out;
            const p = vectorOf(v, src);
            if (!p) return out;
            arrows.push({ from: start, to: start.map((c, i) => c + p[i]), tex: wholeTex(src, isVector), part: false, v: p });
        }
    }
    const color = str(t.color) || 'blue';
    const width = str(t.thickness) || 'thick';
    const dashed = !!t.dashed;
    const label = str(t.label).trim();
    if (dim === 3) {
        out.segments3 = arrows.map((a) => ({
            a: [a.from[0], a.from[1], a.from[2]],
            b: [a.to[0], a.to[1], a.to[2]],
            color,
            width: a.part ? 'thin' : width,
            dashed: dashed || a.part,
            arrow: 'forward',
        }));
        // Labels at the tips, without markers.
        if (label || t.valueLabel) {
            out.points3 = arrows.map((a, i) => {
                // Tip to tail: at the middles (the tips of a part and of the sum meet).
                const at = t.tipToTail ? a.from.map((c, k) => (c + a.to[k]) / 2) : a.to;
                const p = { x: at[0], y: at[1], z: at[2], color, size: 'small' as const, part: i, locals: { x: a.v[0], y: a.v[1], z: a.v[2], i: i + 1 }, bare: true };
                return label || a.tex === null ? p : { ...p, literal: `$${a.tex}$` };
            });
        }
        return out;
    }
    arrows.forEach((a, i) => {
        const line: Pt[] = [
            { x: a.from[0], y: a.from[1] },
            { x: a.to[0], y: a.to[1] },
        ];
        out.strokes.push({ lines: [line], color, width: a.part ? 'thin' : width, dashed: dashed || a.part, arrow: 'forward', exact: true });
        if (!label && !t.valueLabel) return;
        // Beside the arrow, past its middle, on its left; it may slide along the arrow.
        const { p, dir } = midSpot(line);
        const d = normDir(dir.x, dir.y, ctx.view, { x: 1, y: 0 });
        const spot = { x: (p.x + line[1].x) / 2, y: (p.y + line[1].y) / 2 };
        const spec = { x: spot.x, y: spot.y, template: 'label' as const, part: i, locals: { x: a.v[0], y: a.v[1], i: i + 1 }, color, size: 'normal' as const, dir: { x: -d.y, y: d.x }, slide: line };
        if (label) out.texts.push(spec);
        else if (a.tex !== null) out.texts.push({ ...spec, literal: `$${a.tex}$` });
    });
    return out;
}

/** The LaTeX of a whole formula, with arrows on its vector names. */
function wholeTex(src: string, isVector: (name: string) => boolean): string | null {
    let node: VNode;
    try {
        node = parseValue(src);
    } catch {
        return null;
    }
    return nodeTex(node, isVector);
}

// ------------------------------------------------------------ list points

function computeListPoints(t: ListPointsTool, ctx: SceneCtx, dim: 2 | 3): SceneOutput {
    const out = newOutput();
    const src = str(t.points).trim();
    if (!src) return out;
    const value = valueOf(src, 'points', t.name, ctx, out);
    if (value === null) return out;
    const items = isList(value) ? value.items : [value];
    const pts: number[][] = [];
    for (const item of items) {
        const p = pointOf(item, dim);
        if (!p) return fail(out, t.name, 'points', msg('values.problem.notPoints', { what: shapeText(shapeOf(item)) }));
        if (p.every(Number.isFinite)) pts.push(p);
    }
    out.points = pts;
    publish(out, t.name, pts, NaN, dim);
    const color = str(t.color) || 'red';
    const size: MarkerSize = t.size === 'small' || t.size === 'large' ? t.size : 'normal';
    const width = str(t.thickness) || 'thin';
    const label = str(t.label).trim();
    if (dim === 3) {
        out.points3 = pts.map((p, i) => ({ x: p[0], y: p[1], z: p[2], color, size, part: i, locals: { x: p[0], y: p[1], z: p[2], val: NaN, i: i + 1 } }));
        if (t.joined && pts.length > 1) {
            const loop = pts.length > 2 ? [...pts, pts[0]] : pts;
            out.segments3 = loop.slice(1).map((b, i) => ({ a: [loop[i][0], loop[i][1], loop[i][2]], b: [b[0], b[1], b[2]], color, width, dashed: false }));
        }
        return out;
    }
    const ring = pts.map((p) => ({ x: p[0], y: p[1] }));
    if (t.joined && ring.length > 1) out.strokes.push({ lines: [ring], color, width, dashed: false, closed: ring.length > 2, exact: true });
    for (const p of ring) out.markers.push({ x: p.x, y: p.y, color, size });
    if (label || t.valueLabel) {
        const shown = items.filter((item) => {
            const p = pointOf(item, 2);
            return !!p && p.every(Number.isFinite);
        });
        ring.forEach((p, i) => {
            const spec = { x: p.x, y: p.y, template: 'label' as const, part: i, locals: { x: p.x, y: p.y, i: i + 1 }, color, size: 'small' as const, dir: outward(p, ring), marker: size };
            out.texts.push(label ? spec : { ...spec, literal: formatValue(shown[i] ?? NaN, 3) });
        });
    }
    return out;
}

/** Away from the middle of the points (labels of a polygon's corners sit outside it). */
function outward(p: Pt, ring: Pt[]): Pt {
    let cx = 0;
    let cy = 0;
    for (const q of ring) {
        cx += q.x / ring.length;
        cy += q.y / ring.length;
    }
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy);
    return len > 0 ? { x: dx / len, y: dy / len } : { x: Math.SQRT1_2, y: Math.SQRT1_2 };
}

// ------------------------------------------------------------------ fit

/** What a scene item of a tool of this module adds to the auto-fit; null for other tools. */
export function valuesFitShapes(tool: Tool, item: { strokes: Array<{ lines: Pt[][]; closed?: boolean }>; markers: Pt[] }): FitShapes | null {
    switch (tool.type) {
        case 'value':
            return { points: [], lines: [] };
        case 'vector':
            return { points: [], lines: item.strokes.flatMap((s) => s.lines.map((pts) => ({ pts, closed: false }))) };
        case 'listPoints': {
            const points = item.markers.map((m) => ({ x: m.x, y: m.y }));
            // 6.0 F1: labelled, the labels sit outward of the points: the fit leaves them room.
            const labelled = tool.valueLabel || !!str(tool.label).trim();
            return { points: labelled ? [...points, ...labelRoom(points)] : points, lines: [] };
        }
        default:
            return null;
    }
}

/**
 * 6.0 F1: a point beyond each labelled point of a list where its label
 * ends: outward of the points (the side the label sits on), about as far
 * as the label is long. A label of c characters is some 0.02 c of the
 * view wide (small text in a chart of usual size), 0.06 of it high.
 */
export function labelRoom(points: Pt[]): Pt[] {
    if (!points.length) return [];
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (!(span > 0)) return [];
    const width = (p: Pt) => {
        const re = formatValue(p.x, 3);
        const im = formatValue(Math.abs(p.y), 3);
        return Math.abs(p.y) < 1e-9 ? re.length : Math.abs(p.x) < 1e-9 ? im.length + 1 : re.length + im.length + 4;
    };
    // The view is wider than the points by the room itself: about twice their span at most.
    const view = span * 1.6;
    return points.map((p) => {
        const d = outward(p, points);
        return { x: p.x + Math.sign(d.x) * (0.02 * width(p) * Math.abs(d.x) + 0.03) * view, y: p.y + Math.sign(d.y) * (0.06 * Math.abs(d.y) + 0.02) * view };
    });
}
