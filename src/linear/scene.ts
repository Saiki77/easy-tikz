/*
 * 6.0 D: the tools of linear algebra and complex maps as scene primitives,
 * and the transforms that move what is drawn before them.
 *
 * Each tool draws itself where it is (the grid, î and ĵ, the eigenvectors,
 * the unit square, a span). A transform draws nothing of its own in the
 * memo: it compiles its map there. After the memo (transformItems), every
 * item drawn before a transform (functions of its step or earlier, tools
 * above it in the list) is carried through the map at the step's progress,
 * (1 - t)I + tA or (1 - t)z + t f(z): fills, strokes, markers, braces and
 * the spots of labels. The functions it moves are drawn by the transform
 * (the renderer and the export leave their curves out), the grid leaves a
 * faint copy where it was, and the unit square's label says its area now.
 * The axes stay. The export draws the still frame (progress 1), so the
 * preview and the PDF agree. 2D and 3D. Pure: no DOM, no Obsidian.
 */
import type { BasisVectorsTool, EigenvectorsTool, FunctionParameters, MotionFrame, PlaneGridTool, SpanTool, Tool, TransformTool, UnitSquareTool } from '../types';
import type { Pt, View } from '../geometry';
import type { FunctionInfo } from '../mathcontext';
import type { HandlePrim, SceneCtx, SceneItem2D, SceneOutput, SceneTextSpec, StrokePrim, Scene3D } from '../scene';
import { addIssue, fail, newOutput } from '../scene';
import { t as msg } from '../i18n';
import { errorText } from '../util';
import { compileValue, isComplex, isVec } from '../values/index';
import type { Value } from '../values/index';
import { stepOf, stepProgress, registerStepMover } from '../motion6/steps';
import { LinearMap, compileMap, eigenOf, mapLine, mapRing, matrixAt, matrixValue, pointsAt, ringArea, splitMapsto, stillAt } from './maps';
import { LINEAR_TYPES } from './tools';
import type { FitShapes } from '../beyond/fit';

export { LINEAR_TYPES };

// A transform moves while its step comes in: the player draws those frames.
registerStepMover('transform');

/** What a transform hands the pass after the memo. */
export interface LinearOutput {
    map: LinearMap;
}

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

/** A number as a label writes it: at most 3 decimals, no -0. */
export function nice(v: number): string {
    if (!Number.isFinite(v)) return String(v);
    const r = Math.round(v * 1000) / 1000;
    return String(Object.is(r, -0) ? 0 : r);
}

/** The formula of a map that the dependency graph and the cache key read: the right side of `z \mapsto ...`. */
function mapSource(src: string): string {
    const parts = splitMapsto(src);
    return parts ? parts.right : src;
}

/** Producers and evaluated sources of a tool of this part, for the scene's dependency graph and cache keys; false for any other tool. */
export function linearSources(t: Tool, scan: (src: unknown, field: string) => void): boolean {
    switch (t.type) {
        case 'planeGrid':
            scan(t.from, 'from');
            scan(t.to, 'to');
            scan(t.spacing, 'spacing');
            return true;
        case 'transform':
            scan(mapSource(str(t.map)), 'map');
            return true;
        case 'eigenvectors':
            scan(t.matrix, 'matrix');
            return true;
        case 'span':
            for (const v of vectorList(str(t.vectors))) scan(v, 'vectors');
            return true;
        case 'basisVectors':
        case 'unitSquare':
            return true;
        default:
            return false;
    }
}

/** The value of a number field; null after a problem. */
function fieldNumber(src: string, field: string, name: string, ctx: SceneCtx, out: SceneOutput): number | null {
    const res = ctx.math.tryValue(src);
    if (res.ok) return res.value;
    fail(out, name, field, res.message);
    return null;
}

/** How far lines through 0 reach: well past every corner of the view. */
function reach(view: View): number {
    return 4 * Math.max(Math.abs(view.xmin), Math.abs(view.xmax), Math.abs(view.ymin), Math.abs(view.ymax), view.xmax - view.xmin, view.ymax - view.ymin);
}

const unit = (dx: number, dy: number): Pt => {
    const len = Math.hypot(dx, dy);
    return len > 0 ? { x: dx / len, y: dy / len } : { x: Math.SQRT1_2, y: Math.SQRT1_2 };
};

// ------------------------------------------------------------------ 2D

/** A tool of this part computed in a 2D chart; null for any other tool. */
export function computeLinear(t: Tool, ctx: SceneCtx): SceneOutput | null {
    try {
        switch (t.type) {
            case 'planeGrid':
                return grid2D(t, ctx);
            case 'basisVectors':
                return basis2D(t);
            case 'transform':
                return transformNode(t, ctx, 2);
            case 'eigenvectors':
                return eigen2D(t, ctx);
            case 'unitSquare':
                return square2D(t);
            case 'span':
                return span2D(t, ctx);
            default:
                return null;
        }
    } catch (e) {
        return fail(newOutput(), t.name, undefined, errorText(e));
    }
}

/** The values the grid's lines stand at: from lo to hi in steps (at most MAX_LINES); null after a problem. */
const MAX_LINES = 401;

function gridValues(t: PlaneGridTool, ctx: SceneCtx, out: SceneOutput, auto: number): number[] | null {
    const stepSrc = str(t.spacing).trim();
    const step = stepSrc ? fieldNumber(stepSrc, 'spacing', t.name, ctx, out) : 1;
    if (step === null) return null;
    if (!(step > 0)) {
        fail(out, t.name, 'spacing', msg('linear.problem.gridStep'));
        return null;
    }
    let lo: number;
    let hi: number;
    const fromSrc = str(t.from).trim();
    const toSrc = str(t.to).trim();
    if (fromSrc || toSrc) {
        const a = fieldNumber(fromSrc || '0', 'from', t.name, ctx, out);
        const b = fieldNumber(toSrc || '0', 'to', t.name, ctx, out);
        if (a === null || b === null) return null;
        lo = Math.min(a, b);
        hi = Math.max(a, b);
    } else {
        const k = Math.ceil(auto / step);
        lo = -k * step;
        hi = k * step;
    }
    const first = Math.ceil(lo / step - 1e-9);
    const last = Math.floor(hi / step + 1e-9);
    if (last - first + 1 > MAX_LINES) {
        fail(out, t.name, 'spacing', msg('linear.problem.gridLines', { n: last - first + 1 }));
        return null;
    }
    const values: number[] = [];
    for (let k = first; k <= last; k++) values.push(Math.abs(k * step) < 1e-12 ? 0 : k * step);
    return values.length ? values : null;
}

function gridRange(values: number[]): [number, number] {
    return [values[0], values[values.length - 1]];
}

function grid2D(t: PlaneGridTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const v = ctx.view;
    const values = gridValues(t, ctx, out, 2 * Math.max(Math.abs(v.xmin), Math.abs(v.xmax), Math.abs(v.ymin), Math.abs(v.ymax)));
    if (!values) return out;
    const [lo, hi] = gridRange(values);
    const minor: Pt[][] = [];
    const axes: Pt[][] = [];
    for (const c of values) {
        const into = c === 0 ? axes : minor;
        into.push([{ x: c, y: lo }, { x: c, y: hi }]);
        into.push([{ x: lo, y: c }, { x: hi, y: c }]);
    }
    const color = str(t.color) || 'blue';
    const width = str(t.thickness) || 'thin';
    if (minor.length) out.strokes.push({ lines: minor, color, width, dashed: false, exact: true, opacity: 0.45 });
    // The lines through 0 (where the axes go) stronger.
    if (axes.length) out.strokes.push({ lines: axes, color, width, dashed: false, exact: true, opacity: 0.95 });
    return out;
}

/** The colours of î, ĵ, k̂: green, red, blue for the default (green); else all in the tool's colour. */
function basisColors(t: BasisVectorsTool): string[] {
    const c = str(t.color) || 'green';
    return c === 'green' ? ['green', 'red', 'blue'] : [c, c, c];
}

const HATS = ['$\\hat{\\imath}$', '$\\hat{\\jmath}$', '$\\hat{k}$'];

function basis2D(t: BasisVectorsTool): SceneOutput {
    const out = newOutput();
    const colors = basisColors(t);
    const width = str(t.thickness) || 'very thick';
    const tips: Pt[] = [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
    ];
    tips.forEach((tip, i) => {
        out.strokes.push({ lines: [[{ x: 0, y: 0 }, tip]], color: colors[i], width, dashed: false, arrow: 'forward', exact: true });
        if (t.valueLabel) out.texts.push({ x: tip.x, y: tip.y, template: 'label', literal: HATS[i], color: colors[i], size: 'normal', dir: tip });
    });
    return out;
}

function transformNode(t: TransformTool, ctx: SceneCtx, dim: 2 | 3): SceneOutput {
    const out = newOutput();
    const src = str(t.map).trim();
    if (!src) return out;
    try {
        out.linear = { map: compileMap(ctx.math, src, dim) };
    } catch (e) {
        if (ctx.math.deps(mapSource(src)).derived.length) addIssue(out, t.name, 'map', errorText(e), 'info');
        else fail(out, t.name, 'map', errorText(e));
    }
    return out;
}

/** Where a λ label goes on the line through 0 along `d`: `k` of the way to where it leaves the view (inset). */
function lineSpot(d: Pt, view: View, k: number): Pt {
    const inset = 0.08;
    const w = view.xmax - view.xmin;
    const h = view.ymax - view.ymin;
    const box = { xmin: view.xmin + inset * w, xmax: view.xmax - inset * w, ymin: view.ymin + inset * h, ymax: view.ymax - inset * h };
    // The ray from the origin (or the part of the line nearest the middle of the view when 0 is outside it).
    const mid = { x: (view.xmin + view.xmax) / 2, y: (view.ymin + view.ymax) / 2 };
    const s0 = mid.x * d.x + mid.y * d.y;
    const inside0 = box.xmin < 0 && box.xmax > 0 && box.ymin < 0 && box.ymax > 0;
    const base = inside0 ? { x: 0, y: 0 } : { x: s0 * d.x, y: s0 * d.y };
    let tmax = Infinity;
    if (d.x > 1e-12) tmax = Math.min(tmax, (box.xmax - base.x) / d.x);
    if (d.x < -1e-12) tmax = Math.min(tmax, (box.xmin - base.x) / d.x);
    if (d.y > 1e-12) tmax = Math.min(tmax, (box.ymax - base.y) / d.y);
    if (d.y < -1e-12) tmax = Math.min(tmax, (box.ymin - base.y) / d.y);
    if (!Number.isFinite(tmax) || tmax < 0) tmax = 0;
    return { x: base.x + k * tmax * d.x, y: base.y + k * tmax * d.y };
}

/** A direction of an eigenvector: right-pointing (or up), unit length. */
function towardRight(v: readonly number[]): Pt {
    const d = unit(v[0], v[1]);
    return d.x < -1e-9 || (Math.abs(d.x) <= 1e-9 && d.y < 0) ? { x: -d.x, y: -d.y } : d;
}

function eigen2D(t: EigenvectorsTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const src = str(t.matrix).trim();
    if (!src) return out;
    let m;
    try {
        m = matrixValue(ctx.math, src, 2);
    } catch (e) {
        return fail(out, t.name, 'matrix', errorText(e));
    }
    const { pairs, every } = eigenOf(m);
    const color = str(t.color) || 'orange';
    const width = str(t.thickness) || 'thick';
    const R = reach(ctx.view);
    const lines: Pt[][] = [];
    const label = (spot: Pt, d: Pt, text: string) => {
        if (t.valueLabel) out.texts.push({ x: spot.x, y: spot.y, template: 'label', literal: text, color, size: 'normal', dir: { x: -d.y, y: d.x }, halo: true });
    };
    if (every) {
        const lambda = pairs.length ? Number(pairs[0].value) : m.a[0];
        for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 8;
            lines.push([{ x: -R * Math.cos(a), y: -R * Math.sin(a) }, { x: R * Math.cos(a), y: R * Math.sin(a) }]);
        }
        label(lineSpot({ x: Math.cos(Math.PI / 8), y: Math.sin(Math.PI / 8) }, ctx.view, 0.85), unit(Math.cos(Math.PI / 8), Math.sin(Math.PI / 8)), `${msg('linear.label.everyVector')} $\\lambda = ${nice(lambda)}$`);
        addIssue(out, t.name, 'matrix', msg('linear.problem.everyVector', { value: nice(lambda) }), 'info');
    } else {
        const real = pairs.filter((p) => typeof p.value === 'number' && p.vector);
        real.forEach((p, i) => {
            const d = towardRight(p.vector as number[]);
            lines.push([{ x: -R * d.x, y: -R * d.y }, { x: R * d.x, y: R * d.y }]);
            const name = real.length > 1 ? `\\lambda_${i + 1}` : '\\lambda';
            label(lineSpot(d, ctx.view, i === 0 ? 0.85 : 0.6), d, `$${name} = ${nice(Number(p.value))}$`);
        });
        const complexOne = pairs.find((p) => typeof p.value !== 'number');
        if (!real.length && complexOne && typeof complexOne.value !== 'number') {
            const { re, im } = complexOne.value;
            addIssue(out, t.name, 'matrix', msg('linear.problem.complexEigen', { re: nice(re), im: nice(Math.abs(im)) }), 'info');
            if (t.valueLabel) {
                const v = ctx.view;
                out.texts.push({
                    x: v.xmin + 0.05 * (v.xmax - v.xmin),
                    y: v.ymax - 0.07 * (v.ymax - v.ymin),
                    template: 'label',
                    literal: `${msg('linear.label.noRealEigen')} $\\lambda = ${nice(re)} \\pm ${nice(Math.abs(im))}i$`,
                    color,
                    size: 'normal',
                    anchor: 'right',
                    halo: true,
                });
            }
        }
    }
    if (lines.length) out.strokes.push({ lines, color, width, dashed: !!t.dashed, exact: true });
    return out;
}

const SQUARE: Pt[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
];

function square2D(t: UnitSquareTool): SceneOutput {
    const out = newOutput();
    const color = str(t.color) || 'purple';
    out.fills.push({ rings: [SQUARE], color, opacity: typeof t.fillOpacity === 'number' ? t.fillOpacity : 0.3, pattern: 'solid' });
    out.strokes.push({ lines: [SQUARE], color, width: 'thin', dashed: false, closed: true, exact: true });
    const label = str(t.label).trim();
    const spec: SceneTextSpec = { x: 0.5, y: 0.5, template: 'label', color, size: 'normal', anchor: 'center', halo: true, locals: { area: 1, det: 1 } };
    if (label) out.texts.push(spec);
    else if (t.valueLabel) out.texts.push({ ...spec, literal: areaText(1, null, true) });
    return out;
}

/** The label of the unit square's area: `det A = 2.5` (one named matrix, all the way), `area = 1.5`, or `area ≈ 0.8` (a map that bends it). */
function areaText(area: number, det: string | null, linear: boolean, word: 'area' | 'volume' = 'area'): string {
    const w = msg(word === 'area' ? 'linear.label.area' : 'linear.label.volume');
    if (!linear) return `${w} $\\approx ${nice(area)}$`;
    if (det) return `$\\det ${det} = ${nice(area)}$`;
    return `${w} $= ${nice(area)}$`;
}

/** A vector field of the chart as numbers (a vector of dim numbers, a complex number); null with a problem. */
function vectorValue(src: string, dim: 2 | 3, name: string, ctx: SceneCtx, out: SceneOutput): number[] | null {
    let v: Value;
    try {
        v = compileValue(ctx.math, src).run();
    } catch (e) {
        fail(out, name, 'vectors', errorText(e));
        return null;
    }
    if (isVec(v) && v.v.length === dim) return [...v.v];
    if (isVec(v) && dim === 3 && v.v.length === 2) return [v.v[0], v.v[1], 0];
    if (dim === 2 && isComplex(v)) return [v.re, v.im];
    fail(out, name, 'vectors', msg('linear.problem.notVector', { text: src }));
    return null;
}

/** The rank of vectors (0, 1, 2 or 3) and a basis of their span (Gram-Schmidt). */
function spanBasis(vs: number[][]): number[][] {
    const basis: number[][] = [];
    const scale = Math.max(1e-300, ...vs.flat().map(Math.abs));
    for (const v of vs) {
        const w = [...v];
        for (const b of basis) {
            const d = w.reduce((s, c, i) => s + c * b[i], 0);
            for (let i = 0; i < w.length; i++) w[i] -= d * b[i];
        }
        const len = Math.hypot(...w);
        if (len > 1e-9 * scale) basis.push(w.map((c) => c / len));
    }
    return basis;
}

/** The vectors of a span as LaTeX for its label: `\vec{v}` for names, the formula otherwise. */
function spanTex(vectors: string[]): string {
    return vectors.map((v) => (/^[A-Za-z][A-Za-z0-9_]*$/.test(v) ? `\\vec{${v}}` : v)).join(', ');
}

function span2D(t: SpanTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const vectors = vectorList(str(t.vectors));
    if (!vectors.length) return out;
    const vs: number[][] = [];
    for (const v of vectors) {
        const p = vectorValue(v, 2, t.name, ctx, out);
        if (!p) return out;
        vs.push(p);
    }
    const basis = spanBasis(vs);
    const color = str(t.color) || 'teal';
    const R = reach(ctx.view);
    const tex = spanTex(vectors);
    const view = ctx.view;
    if (basis.length >= 2) {
        out.fills.push({ rings: [[{ x: -R, y: -R }, { x: R, y: -R }, { x: R, y: R }, { x: -R, y: R }]], color, opacity: typeof t.fillOpacity === 'number' ? t.fillOpacity : 0.15, pattern: 'solid' });
        if (t.valueLabel) {
            out.texts.push({ x: view.xmax - 0.05 * (view.xmax - view.xmin), y: view.ymax - 0.07 * (view.ymax - view.ymin), template: 'label', literal: `$\\mathrm{span}(${tex}) = \\mathbb{R}^2$`, color, size: 'normal', anchor: 'left', halo: true });
        }
    } else if (basis.length === 1) {
        const d = towardRight(basis[0]);
        out.strokes.push({ lines: [[{ x: -R * d.x, y: -R * d.y }, { x: R * d.x, y: R * d.y }]], color, width: str(t.thickness) || 'thick', dashed: false, exact: true, opacity: 0.8 });
        if (t.valueLabel) {
            const spot = lineSpot(d, view, 0.7);
            out.texts.push({ x: spot.x, y: spot.y, template: 'label', literal: `$\\mathrm{span}(${tex})$`, color, size: 'normal', dir: { x: -d.y, y: d.x }, halo: true });
        }
    } else {
        out.markers.push({ x: 0, y: 0, color, size: 'normal' });
        if (t.valueLabel) out.texts.push({ x: 0, y: 0, template: 'label', literal: `$\\mathrm{span}(${tex}) = \\{0\\}$`, color, size: 'normal', dir: { x: Math.SQRT1_2, y: Math.SQRT1_2 }, marker: 'normal' });
    }
    return out;
}

// ------------------------------------------------------------ the pass

/** One item of the scene with what made it (the scene's node and memo output). */
export interface PassSpec {
    item: SceneItem2D;
    node: { tool?: Tool; fn?: { params: FunctionParameters; info: FunctionInfo } };
    out: SceneOutput;
}

/** What the pass changed besides the items: the labels and braces of moved items, and the functions the transforms draw. */
export interface Moved {
    texts: Map<number, SceneTextSpec[]>;
    braces: Map<number, SceneOutput['braces']>;
    /** Indices (into the chart's functions) of the functions a transform moves: the renderer and the export do not draw their curves. */
    functions: number[];
}

interface Active {
    index: number;
    tool: TransformTool;
    map: LinearMap;
    p: number;
    step: number;
}

/** The functions a transform draws, sampled well beyond the view (a map brings far parts into it). */
const FN_SAMPLES = 900;

function sampleFunction(info: FunctionInfo, view: View): Pt[][] {
    const w = view.xmax - view.xmin;
    const h = view.ymax - view.ymin;
    const far = 50 * Math.max(w, h);
    const runs: Pt[][] = [];
    let run: Pt[] = [];
    const push = (p: Pt) => {
        if (Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < far && Math.abs(p.y) < far) run.push(p);
        else {
            if (run.length > 1) runs.push(run);
            run = [];
        }
    };
    let lo: number;
    let hi: number;
    if (info.kind === 'cartesian') {
        lo = view.xmin - 2 * w;
        hi = view.xmax + 2 * w;
        if (info.domain) {
            lo = Math.max(lo, info.domain[0]);
            hi = Math.min(hi, info.domain[1]);
        }
    } else [lo, hi] = info.domain || [0, 2 * Math.PI];
    if (!(hi > lo)) return [];
    for (let i = 0; i <= FN_SAMPLES; i++) {
        const s = lo + ((hi - lo) * i) / FN_SAMPLES;
        if (info.kind === 'cartesian') push({ x: s, y: info.fn(s) });
        else if (info.kind === 'parametric') push({ x: info.fn(s), y: info.fnY ? info.fnY(s) : NaN });
        else {
            const r = info.fn(s);
            push({ x: r * Math.cos(s), y: r * Math.sin(s) });
        }
    }
    if (run.length > 1) runs.push(run);
    return runs;
}

/** The maps of a chain, one after the other: the image of p under all of them. */
function compose(chain: Active[]): (p: readonly number[]) => number[] {
    const fs = chain.map((a) => pointsAt(a.map, a.p));
    return (p) => {
        let q: readonly number[] = p;
        for (const f of fs) q = f(q);
        return [...q];
    };
}

/** The signed area factor of a chain of matrices (null when one bends lines). */
function chainDet(chain: Active[]): number | null {
    let d = 1;
    for (const a of chain) {
        const m = matrixAt(a.map, a.p);
        if (!m) return null;
        d *= m.length === 4 ? m[0] * m[3] - m[1] * m[2] : m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    }
    return d;
}

/** The name of the product of a chain of named matrices all the way there (`A`, `BA`), else null. */
function chainName(chain: Active[]): string | null {
    if (!chain.length || chain.some((a) => !a.map.name || a.p < 1)) return null;
    const names = chain.map((a) => a.map.name as string).reverse();
    return names.length === 1 ? names[0] : `(${names.join('')})`;
}

/**
 * The transforms that move the item of spec `i`, in the order they apply:
 * a function of their step or earlier, a tool above them in the list (of
 * their step or earlier), the functions a transform draws itself; the image
 * of the unit square also under the transforms above it.
 */
function chainOf(specs: PassSpec[], i: number, active: Active[]): Active[] {
    const node = specs[i].node;
    if (node.fn) {
        const s = stepOf(node.fn.params);
        return active.filter((a) => s <= a.step);
    }
    const tool = node.tool;
    if (!tool) return [];
    const s = stepOf(tool);
    const image = tool.type === 'unitSquare' && tool.image === true;
    return active.filter((a) => (a.index === i && tool.type === 'transform') || (a.index > i && s <= a.step) || (image && a.index < i));
}

/** A label's preferred direction carried through `f` at its spot (direction in normalized view units). */
function mapDir(spec: SceneTextSpec, f: (p: readonly number[]) => number[], view: View): Pt | undefined {
    const d = spec.dir;
    if (!d) return undefined;
    const w = view.xmax - view.xmin;
    const h = view.ymax - view.ymin;
    const eps = 1e-4;
    const a = f([spec.x, spec.y]);
    const b = f([spec.x + eps * d.x * w, spec.y + eps * d.y * h]);
    const dx = (b[0] - a[0]) / w;
    const dy = (b[1] - a[1]) / h;
    return Number.isFinite(dx) && Number.isFinite(dy) && (dx || dy) ? unit(dx, dy) : d;
}

/**
 * The transforms of a 2D scene after the memo: every item drawn before a
 * transform is carried through it at its progress (new arrays: the memo's
 * stay as they are). Returns what the caller must use instead of the
 * output's own labels and braces, and the functions the transforms draw;
 * null when the chart has no transform and nothing else to do.
 */
export function transformItems(specs: PassSpec[], ctx: SceneCtx, motion: MotionFrame | undefined): Moved | null {
    const active: Active[] = [];
    specs.forEach((s, index) => {
        const tool = s.node.tool;
        const lin = s.out.linear;
        if (tool && tool.type === 'transform' && lin) active.push({ index, tool, map: lin.map, p: stepProgress(motion, tool.step), step: stepOf(tool) });
    });
    vectorTips(specs, ctx);
    if (!active.length && !specs.some((s) => s.node.tool?.type === 'unitSquare')) return null;
    const moved: Moved = { texts: new Map(), braces: new Map(), functions: [] };
    const view = ctx.view;
    const h = Math.max(view.xmax - view.xmin, view.ymax - view.ymin) / 200;

    // The functions a transform moves: the first transform of their step or later draws them.
    const drawn = new Map<number, Array<{ info: FunctionInfo; f: FunctionParameters }>>();
    if (active.length) {
        for (const info of ctx.math.functions()) {
            const f = ctx.functions[info.index];
            if (!f || info.hidden || info.error || info.domainError || !str(f.expression).trim()) continue;
            if (info.kind === 'parametric' && !str(f.expressionY).trim()) continue;
            const s = stepOf(f);
            const first = active.find((a) => s <= a.step);
            if (!first) continue;
            moved.functions.push(info.index);
            const list = drawn.get(first.index) ?? [];
            list.push({ info, f });
            drawn.set(first.index, list);
        }
        for (const [index, fns] of drawn) {
            const item = specs[index].item;
            const curves: StrokePrim[] = fns.map(({ info, f }) => ({ lines: sampleFunction(info, view), color: str(f.color) || 'black', width: str(f.thickness) || 'thick', dashed: !!f.dashed }));
            item.strokes = [...curves, ...item.strokes];
        }
    }

    specs.forEach((spec, i) => {
        const chain = chainOf(specs, i, active).filter((a) => !stillAt(a.map, a.p));
        const tool = spec.node.tool;
        const square = tool && tool.type === 'unitSquare' ? tool : null;
        if (!chain.length) {
            if (square) squareLabel(moved, i, spec, square, [], null);
            return;
        }
        const f = compose(chain);
        const exact = chain.every((a) => !!a.map.m);
        const item = spec.item;
        const ghost = tool && tool.type === 'planeGrid' ? item.strokes.map((s) => ({ ...s, color: 'gray', width: 'very thin', opacity: 0.35 })) : [];
        item.fills = item.fills.flatMap((fill) => {
            const rings = fill.rings.map((r) => mapRing(r, f, exact, h)).filter((r): r is Pt[] => !!r && r.length > 2);
            return rings.length ? [{ ...fill, rings }] : [];
        });
        const strokes = (list: StrokePrim[]) =>
            list.flatMap((s) => {
                if (exact) {
                    const lines = s.lines.map((l) => l.map((p) => toPt(f([p.x, p.y]))));
                    return [{ ...s, lines }];
                }
                const lines = s.lines.flatMap((l) => mapLine(l, f, false, h, view, !!s.closed));
                return lines.length ? [{ ...s, lines, closed: false, exact: false }] : [];
            });
        item.strokes = [...ghost, ...strokes(item.strokes)];
        item.guides = strokes(item.guides);
        item.markers = item.markers.flatMap((m) => {
            const q = f([m.x, m.y]);
            return Number.isFinite(q[0]) && Number.isFinite(q[1]) ? [{ ...m, x: q[0], y: q[1] }] : [];
        });
        // The memo's handles stand where the item was: none while it is moved.
        delete item.handles;
        const texts = spec.out.texts.flatMap((t) => {
            const q = f([t.x, t.y]);
            if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) return [];
            const next: SceneTextSpec = { ...t, x: q[0], y: q[1] };
            delete next.region;
            const dir = mapDir(t, f, view);
            if (dir) next.dir = dir;
            if (t.slide) {
                const runs = exact ? [t.slide.map((p) => toPt(f([p.x, p.y])))] : mapLine(t.slide, f, false, h, view);
                if (runs[0] && runs[0].length > 1) next.slide = runs[0];
                else delete next.slide;
            }
            return [next];
        });
        moved.texts.set(i, texts);
        moved.braces.set(
            i,
            spec.out.braces.map((b) => ({ ...b, from: toPt(f([b.from.x, b.from.y])), to: toPt(f([b.to.x, b.to.y])) }))
        );
        if (square) squareLabel(moved, i, spec, square, chain, f);
        if (tool && tool.type === 'basisVectors') basisTips(item, chain, f);
    });
    return moved;
}

const toPt = (q: number[]): Pt => ({ x: q[0], y: q[1] });

/** The unit square's label after the pass: its area now (signed), as the label or the locals of its template. */
function squareLabel(moved: Moved, i: number, spec: PassSpec, t: UnitSquareTool, chain: Active[], f: ((p: readonly number[]) => number[]) | null): void {
    const exact = chain.every((a) => !!a.map.m);
    let area = 1;
    if (f) {
        const ring = mapRing(SQUARE, f, exact, 0.01);
        area = ring ? ringArea(ring) : NaN;
    }
    const det = exact ? (chainDet(chain) ?? area) : area;
    const texts = (moved.texts.get(i) ?? spec.out.texts).map((s) => {
        const next: SceneTextSpec = { ...s, locals: { area, det } };
        if (s.literal !== undefined && !str(t.label).trim()) next.literal = areaText(exact ? det : area, exact ? chainName(chain) : null, exact);
        return next;
    });
    moved.texts.set(i, texts);
}

/**
 * The tips of î and ĵ moved by one matrix all the way: drag handles that
 * change the numbers of the matrix (src/linear/drag.ts reads them).
 */
function basisTips(item: SceneItem2D, chain: Active[], f: (p: readonly number[]) => number[]): void {
    if (chain.length !== 1 || !chain[0].map.m || chain[0].p < 1) return;
    const map = chain[0].map;
    const tool = chain[0].tool;
    const handles: HandlePrim[] = [0, 1].map((k) => ({ ref: { part: 'tip', index: k, owner: tool.name, entries: map.dim === 2 ? [k, 2 + k] : [k, 3 + k] }, point: toPt(f(k === 0 ? [1, 0] : [0, 1])) }));
    item.handles = handles;
}

/**
 * Arrows of let vectors written as numbers, not moved: their tips are drag
 * handles that change those numbers (src/linear/drag.ts).
 */
function vectorTips(specs: PassSpec[], ctx: SceneCtx): void {
    const table = ctx.math.valueTable();
    for (const spec of specs) {
        const tool = spec.node.tool;
        if (!tool || tool.type !== 'vector' || tool.tipToTail) continue;
        const vectors = vectorList(str(tool.vectors));
        const strokes = spec.out.strokes;
        if (strokes.length !== vectors.length) continue;
        const handles: HandlePrim[] = [];
        vectors.forEach((name, k) => {
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !table.has(name) || table.isFunction(name)) return;
            const line = strokes[k].lines[0];
            if (!line || line.length < 2) return;
            handles.push({ ref: { part: 'tip', index: k, owner: name, entries: [0, 1], base: [line[0].x, line[0].y] }, point: line[line.length - 1] });
        });
        if (handles.length) spec.item.handles = [...(spec.item.handles ?? []), ...handles];
    }
}

// ------------------------------------------------------------------ 3D

/** A tool of this part computed in a 3D chart; null for any other tool. */
export function computeLinear3D(t: Tool, ctx: SceneCtx): SceneOutput | null {
    try {
        switch (t.type) {
            case 'planeGrid':
                return grid3D(t, ctx);
            case 'basisVectors':
                return basis3D(t);
            case 'transform':
                return transformNode(t, ctx, 3);
            case 'eigenvectors':
                return eigen3D(t, ctx);
            case 'unitSquare':
                return cube3D(t);
            case 'span':
                return span3D(t, ctx);
            default:
                return null;
        }
    } catch (e) {
        return fail(newOutput(), t.name, undefined, errorText(e));
    }
}

type Seg3 = Scene3D['segments'][number];
type P3 = [number, number, number];

function seg(a: P3, b: P3, color: string, width: string, extra: Partial<Seg3> = {}): Seg3 {
    return { a, b, color, width, dashed: false, ...extra };
}

/** The z range of a 3D chart's box (the view holds x and y). */
function zOf(ctx: SceneCtx): [number, number] {
    return ctx.zRange ?? [-5, 5];
}

function grid3D(t: PlaneGridTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const v = ctx.view;
    const [zmin, zmax] = zOf(ctx);
    const half = Math.min(Math.abs(v.xmin), Math.abs(v.xmax), Math.abs(v.ymin), Math.abs(v.ymax), Math.abs(zmin), Math.abs(zmax));
    const auto = Math.max(1, Math.min(3, Math.floor(0.6 * half)));
    const values = gridValues(t, ctx, out, auto);
    if (!values) return out;
    if (values.length > 21) {
        fail(out, t.name, 'spacing', msg('linear.problem.gridLines', { n: values.length }));
        return out;
    }
    const [lo, hi] = gridRange(values);
    const color = str(t.color) || 'blue';
    const width = str(t.thickness) || 'thin';
    for (const a of values) {
        for (const b of values) {
            const axis = a === 0 && b === 0;
            const w = axis ? 'thick' : width;
            out.segments3 = out.segments3 ?? [];
            out.segments3.push(seg([lo, a, b], [hi, a, b], color, w), seg([a, lo, b], [a, hi, b], color, w), seg([a, b, lo], [a, b, hi], color, w));
        }
    }
    return out;
}

function basis3D(t: BasisVectorsTool): SceneOutput {
    const out = newOutput();
    const colors = basisColors(t);
    const width = str(t.thickness) || 'very thick';
    const tips: P3[] = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
    ];
    out.segments3 = tips.map((tip, i) => seg([0, 0, 0], tip, colors[i], width, { arrow: 'forward' }));
    if (t.valueLabel) out.points3 = tips.map((tip, i) => ({ x: tip[0] * 1.15, y: tip[1] * 1.15, z: tip[2] * 1.15, color: colors[i], size: 'small' as const, part: i, locals: {}, literal: HATS[i], bare: true }));
    return out;
}

function eigen3D(t: EigenvectorsTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const src = str(t.matrix).trim();
    if (!src) return out;
    let m;
    try {
        m = matrixValue(ctx.math, src, 3);
    } catch (e) {
        return fail(out, t.name, 'matrix', errorText(e));
    }
    const { pairs, every } = eigenOf(m);
    const color = str(t.color) || 'orange';
    const width = str(t.thickness) || 'thick';
    const v = ctx.view;
    const [zmin, zmax] = zOf(ctx);
    const R = 3 * Math.max(Math.abs(v.xmin), Math.abs(v.xmax), Math.abs(v.ymin), Math.abs(v.ymax), Math.abs(zmin), Math.abs(zmax));
    const L = 0.8 * Math.min(Math.abs(v.xmax), Math.abs(v.ymax), Math.abs(zmax)) || 1;
    const real = pairs.filter((p) => typeof p.value === 'number' && p.vector);
    out.segments3 = [];
    out.points3 = [];
    real.forEach((p, i) => {
        const d = p.vector as number[];
        out.segments3?.push(seg([-R * d[0], -R * d[1], -R * d[2]], [R * d[0], R * d[1], R * d[2]], color, width, { dashed: !!t.dashed }));
        if (t.valueLabel) {
            const name = every ? '\\lambda' : real.length > 1 ? `\\lambda_${i + 1}` : '\\lambda';
            if (!every || i === 0) out.points3?.push({ x: L * d[0], y: L * d[1], z: L * d[2], color, size: 'small', part: i, locals: {}, literal: `$${name} = ${nice(Number(p.value))}$`, bare: true });
        }
    });
    if (every) addIssue(out, t.name, 'matrix', msg('linear.problem.everyVector', { value: nice(Number(pairs[0]?.value ?? m.a[0])) }), 'info');
    const c = pairs.find((p) => typeof p.value !== 'number');
    if (c && typeof c.value !== 'number') addIssue(out, t.name, 'matrix', msg('linear.problem.complexEigen', { re: nice(c.value.re), im: nice(Math.abs(c.value.im)) }), 'info');
    return out;
}

const CUBE: P3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
];
const CUBE_EDGES: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
];

function cube3D(t: UnitSquareTool): SceneOutput {
    const out = newOutput();
    const color = str(t.color) || 'purple';
    out.segments3 = CUBE_EDGES.map(([a, b]) => seg(CUBE[a], CUBE[b], color, 'thick'));
    const label = str(t.label).trim();
    if (label || t.valueLabel) {
        const p = { x: 0.5, y: 0.5, z: 0.5, color, size: 'small' as const, part: 0, locals: { area: 1, det: 1 }, bare: true };
        out.points3 = [label ? p : { ...p, literal: areaText(1, null, true, 'volume') }];
    }
    return out;
}

function span3D(t: SpanTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const vectors = vectorList(str(t.vectors));
    if (!vectors.length) return out;
    const vs: number[][] = [];
    for (const v of vectors) {
        const p = vectorValue(v, 3, t.name, ctx, out);
        if (!p) return out;
        vs.push(p);
    }
    const basis = spanBasis(vs);
    const color = str(t.color) || 'teal';
    const width = str(t.thickness) || 'thick';
    const v = ctx.view;
    const [zmin, zmax] = zOf(ctx);
    const R = 2 * Math.max(Math.abs(v.xmin), Math.abs(v.xmax), Math.abs(v.ymin), Math.abs(v.ymax), Math.abs(zmin), Math.abs(zmax));
    out.segments3 = [];
    const at = (a: number, b: number): P3 => {
        const p = [0, 1, 2].map((i) => a * basis[0][i] + (basis[1] ? b * basis[1][i] : 0));
        return [p[0], p[1], p[2]];
    };
    if (basis.length === 1) out.segments3.push(seg(at(-R, 0), at(R, 0), color, width));
    else if (basis.length === 2) {
        // The plane as a mesh of lines.
        const n = 6;
        const s = R / 2;
        for (let k = -n; k <= n; k++) {
            const c = (k * s) / n;
            out.segments3.push(seg(at(c, -s), at(c, s), color, 'thin'), seg(at(-s, c), at(s, c), color, 'thin'));
        }
    } else if (!basis.length) out.points3 = [{ x: 0, y: 0, z: 0, color, size: 'normal', part: 0, locals: {} }];
    if (t.valueLabel && basis.length) {
        const tex = spanTex(vectors);
        const text = basis.length >= 3 ? `$\\mathrm{span}(${tex}) = \\mathbb{R}^3$` : `$\\mathrm{span}(${tex})$`;
        const p = basis.length >= 3 ? [0, 0, 0] : at(0.6 * Math.abs(v.xmax || 1), 0);
        out.points3 = [{ x: p[0], y: p[1], z: p[2], color, size: 'small', part: 0, locals: {}, literal: text, bare: true }];
    }
    return out;
}

/** One tool's share of the 3D scene: where its points and segments start and end in the scene's lists. */
export interface Span3D {
    tool: Tool;
    out: SceneOutput;
    points: [number, number];
    segments: [number, number];
}

/**
 * The transforms of a 3D scene: the points and segments of every tool
 * above a transform (of its step or earlier) carried through it at its
 * progress; a map that bends lines cuts segments into pieces first. The
 * grid cube leaves a faint copy, the unit cube's label says its volume now.
 */
export function transformScene3D(scene: Scene3D, spans: Span3D[], motion: MotionFrame | undefined): void {
    const active: Active[] = [];
    spans.forEach((s, index) => {
        if (s.tool.type === 'transform' && s.out.linear) active.push({ index, tool: s.tool, map: s.out.linear.map, p: stepProgress(motion, s.tool.step), step: stepOf(s.tool) });
    });
    if (!active.length) return;
    const points: Scene3D['points'] = [];
    const segments: Scene3D['segments'] = [];
    spans.forEach((span, i) => {
        const pts = scene.points.slice(span.points[0], span.points[1]);
        const segs = scene.segments.slice(span.segments[0], span.segments[1]);
        const s = stepOf(span.tool);
        const image = span.tool.type === 'unitSquare' && span.tool.image === true;
        const chain = active.filter((a) => ((a.index > i && s <= a.step) || (image && a.index < i)) && !stillAt(a.map, a.p));
        if (!chain.length) {
            points.push(...pts);
            segments.push(...segs);
            return;
        }
        const f = compose(chain);
        const exact = chain.every((a) => !!a.map.m);
        // Where the grid cube was: thin, dashed and gray (3D lines have no opacity).
        if (span.tool.type === 'planeGrid') for (const g of segs) segments.push({ ...g, color: 'gray', width: 'very thin', dashed: true });
        for (const g of segs) {
            const n = exact ? 1 : 24;
            for (let k = 0; k < n; k++) {
                const a = g.a.map((c, j) => c + ((g.b[j] - c) * k) / n);
                const b = g.a.map((c, j) => c + ((g.b[j] - c) * (k + 1)) / n);
                const fa = f(a);
                const fb = f(b);
                if (![...fa, ...fb].every(Number.isFinite)) continue;
                const piece: Seg3 = { ...g, a: [fa[0], fa[1], fa[2]], b: [fb[0], fb[1], fb[2]] };
                // Arrow heads on the last piece only.
                if (g.arrow && k < n - 1) delete piece.arrow;
                segments.push(piece);
            }
        }
        for (const p of pts) {
            const q = f([p.x, p.y, p.z]);
            if (!q.every(Number.isFinite)) continue;
            const next = { ...p, x: q[0], y: q[1], z: q[2] };
            if (span.tool.type === 'unitSquare' && !str(span.tool.label).trim() && span.tool.valueLabel) {
                const det = chainDet(chain);
                if (det !== null) next.label = areaText(det, chainName(chain), true, 'volume');
            }
            points.push(next);
        }
    });
    scene.points = points;
    scene.segments = segments;
}

// ------------------------------------------------------------------ fit

/** What a scene item of a tool of this part adds to the auto-fit; null for other tools. */
export function linearFitShapes(tool: Tool, item: SceneItem2D): FitShapes | null {
    switch (tool.type) {
        case 'basisVectors':
            return { points: [], lines: item.strokes.flatMap((s) => s.lines.map((pts) => ({ pts, closed: false }))) };
        case 'unitSquare':
            return { points: [], lines: item.fills.flatMap((f) => f.rings.map((pts) => ({ pts, closed: true }))) };
        case 'planeGrid':
        case 'transform':
        case 'eigenvectors':
        case 'span':
            // Lines through 0 and grids reach past the view: they never set it.
            return { points: [], lines: [] };
        default:
            return null;
    }
}
