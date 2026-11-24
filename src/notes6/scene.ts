/*
 * The tools of 6.0 B as scene primitives: a set on an axis (a bar on the
 * axis, filled or open dots at its ends, arrows where it runs off the view,
 * the set in set notation) and the chord of a function (the chord, its ends,
 * the points at λ on the chord and on the graph, the gap between them).
 * They draw with the scene's strokes, markers, guides and texts, so the
 * preview and the pgfplots export draw them alike. 2D only. Pure: no DOM,
 * no Obsidian.
 */
import type { AxisSetTool, ChordTool, Tool } from '../types';
import type { Pt } from '../geometry';
import type { SceneCtx, SceneOutput } from '../scene';
import { addIssue, fail, newOutput, publish } from '../scene';
import { t as msg } from '../i18n';
import { errorText } from '../util';
import { decimal } from '../beyond/maths';
import { compileCondition, intervalCondition, setLabel, solveSet } from './sets';

/** The tool types of this part: drawn in 2D charts only. */
export const NOTES6_TYPES: ReadonlySet<string> = new Set(['axisSet', 'chord']);

/** The set is computed this many view widths beyond the view on each side (its label names ends out of sight). */
const SET_REACH = 1;
/** An arrow at the edge of the view stops this share of the view inside it. */
const ARROW_INSET = 0.004;

function str(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
}

/** The fields a tool of this part reads, for the scene's dependency graph and cache keys. */
export function notes6Sources(t: Tool, scan: (src: unknown, field: string) => void): void {
    if (t.type === 'axisSet') scan(t.condition, 'condition');
    else if (t.type === 'chord') {
        // The function's name stands for its body: its sliders and the functions it calls count too.
        scan(t.function, 'function');
        scan(t.from, 'from');
        scan(t.to, 'to');
        scan(t.at, 'at');
    }
}

/** A tool of this part computed; null for any other tool. */
export function computeNotes6(t: Tool, ctx: SceneCtx): SceneOutput | null {
    if (t.type === 'axisSet') return computeAxisSet(t, ctx);
    if (t.type === 'chord') return computeChord(t, ctx);
    return null;
}

/** The value of a formula field; null after a problem (an error, or a note while a computed value it reads is still unset). */
function fieldValue(src: string, field: string, name: string, ctx: SceneCtx, out: SceneOutput): number | null {
    const res = ctx.math.tryValue(src);
    if (res.ok) return res.value;
    if (ctx.math.validate(src, 'value').ok) addIssue(out, name, field, res.message, 'info');
    else fail(out, name, field, res.message);
    return null;
}

// --------------------------------------------------------------- axis set

/** Where the bar of a set on the axis lies: on the axis (0) when it is in view, else at the low edge. */
export function axisLevel(axis: 'x' | 'y', view: SceneCtx['view']): number {
    const [lo, hi] = axis === 'x' ? [view.ymin, view.ymax] : [view.xmin, view.xmax];
    return lo <= 0 && 0 <= hi ? 0 : lo;
}

function computeAxisSet(t: AxisSetTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const src = str(t.condition).trim();
    if (!src) return out;
    const axis = t.axis === 'y' ? 'y' : 'x';
    let cond: ReturnType<typeof compileCondition>;
    try {
        cond = compileCondition(ctx.math, src, axis);
    } catch (e) {
        return fail(out, t.name, 'condition', errorText(e));
    }
    const { view } = ctx;
    const [lo, hi] = axis === 'x' ? [view.xmin, view.xmax] : [view.ymin, view.ymax];
    const span = hi - lo;
    const pieces = solveSet(cond, lo - SET_REACH * span, hi + SET_REACH * span);
    const level = axisLevel(axis, view);
    const at = (v: number): Pt => (axis === 'x' ? { x: v, y: level } : { x: level, y: v });
    const color = str(t.color) || 'teal';
    const width = str(t.thickness) || 'very thick';
    const inset = ARROW_INSET * span;
    const ends: number[][] = [];
    let first = Infinity;
    let last = -Infinity;
    for (const p of pieces) {
        for (const v of p.a === p.b ? [p.a] : [p.a, p.b]) if (Number.isFinite(v)) ends.push(axis === 'x' ? [v, level] : [level, v]);
        if (p.a === p.b) {
            if (p.a >= lo && p.a <= hi) out.markers.push({ ...at(p.a), color, size: 'normal' });
            first = Math.min(first, p.a);
            last = Math.max(last, p.a);
            continue;
        }
        const offA = p.a < lo;
        const offB = p.b > hi;
        const a = offA ? lo + inset : p.a;
        const b = offB ? hi - inset : p.b;
        if (!(b > a) || b < lo || a > hi) continue;
        const arrow = offA && offB ? 'both' : offA ? 'backward' : offB ? 'forward' : undefined;
        out.strokes.push({ lines: [[at(a), at(b)]], color, width, dashed: false, exact: true, ...(arrow ? { arrow } : {}) });
        // A cut end (the set goes on out of reach) gets no dot.
        if (!offA && !p.cutA) out.markers.push({ ...at(p.a), color, size: 'normal', ...(p.closedA ? {} : { open: true }) });
        if (!offB && !p.cutB) out.markers.push({ ...at(p.b), color, size: 'normal', ...(p.closedB ? {} : { open: true }) });
        first = Math.min(first, a);
        last = Math.max(last, b);
    }
    // Nothing is ever finite: the condition is not in this axis' variable.
    if (!pieces.length && !anyValue(cond, lo, hi)) addIssue(out, t.name, 'condition', msg(axis === 'x' ? 'notes6.problem.notInX' : 'notes6.problem.notInY'), 'info');
    publish(out, t.name, ends, pieces.length, 2);
    const label = str(t.label).trim();
    if (label || t.valueLabel) {
        const mid = Number.isFinite(first) && Number.isFinite(last) ? (Math.max(first, lo) + Math.min(last, hi)) / 2 : (lo + hi) / 2;
        // The label may slide along the bar to a spot where nothing crosses it.
        const bar = Number.isFinite(first) && Number.isFinite(last) && last > first ? [at(Math.max(first, lo)), at(Math.min(last, hi))] : undefined;
        const spec = { ...at(mid), template: 'label' as const, color, size: 'small' as const, dir: axis === 'x' ? { x: 0, y: 1 } : { x: 1, y: 0 }, ...(bar ? { slide: bar } : {}) };
        if (label) out.texts.push(spec);
        else out.texts.push({ ...spec, literal: setLabel(axis, ctx.math.tex(intervalCondition(src, axis)), pieces) });
    }
    return out;
}

/** Does any clause have a value anywhere in [lo, hi]? */
function anyValue(cond: ReturnType<typeof compileCondition>, lo: number, hi: number): boolean {
    const fns = cond.zeros ? [cond.zeros] : cond.disjuncts.flat().map((c) => c.g);
    for (let i = 0; i <= 64; i++) {
        const v = lo + ((hi - lo) * (i + 0.37)) / 64.37;
        if (fns.some((g) => Number.isFinite(g(v)))) return true;
    }
    return false;
}

// ------------------------------------------------------------------ chord

/** The point at λ between a and b, as in Jensen's inequality: λa + (1 - λ)b. */
export function chordX(a: number, b: number, lambda: number): number {
    return lambda * a + (1 - lambda) * b;
}

/** λ in a label: its TeX when it is a name (\lambda, t), else \lambda. */
function lambdaTex(ctx: SceneCtx, at: string): string {
    const s = at.trim();
    return /^\\?[A-Za-z][A-Za-z0-9_]*$/.test(s) ? ctx.math.tex(s.replace(/^\\/, '')) : '\\lambda';
}

function computeChord(t: ChordTool, ctx: SceneCtx): SceneOutput {
    const out = newOutput();
    const name = str(t.function).trim();
    if (!name) return fail(out, t.name, 'function', msg('beyond.problem.chooseFunction'));
    const info = ctx.math.functionInfo(name);
    if (!info) return fail(out, t.name, 'function', msg('problems.scene.doesNotExist', { name }));
    if (info.kind !== 'cartesian') return fail(out, t.name, 'function', msg('beyond.problem.notCartesian', { name }));
    if (info.error || info.domainError) return fail(out, t.name, 'function', msg('problems.scene.hasError', { name }));
    const a = fieldValue(str(t.from), 'from', t.name, ctx, out);
    const b = fieldValue(str(t.to), 'to', t.name, ctx, out);
    if (a === null || b === null) return out;
    const ga = info.fn(a);
    const gb = info.fn(b);
    if (!Number.isFinite(ga) || !Number.isFinite(gb)) return fail(out, t.name, Number.isFinite(ga) ? 'to' : 'from', msg('notes6.problem.noValueAt', { name, x: decimal(Number.isFinite(ga) ? b : a) }));
    const color = str(t.color) || 'red';
    const width = str(t.thickness) || 'thick';
    const A = { x: a, y: ga };
    const B = { x: b, y: gb };
    out.strokes.push({ lines: [[A, B]], color, width, dashed: !!t.dashed, exact: true });
    out.markers.push({ ...A, color, size: 'normal' }, { ...B, color, size: 'normal' });
    const at = str(t.at).trim();
    const label = str(t.label).trim();
    if (!at) {
        publish(out, t.name, [[a, ga], [b, gb]], NaN, 2);
        if (label) out.texts.push({ x: (a + b) / 2, y: (ga + gb) / 2, template: 'label', color, size: 'small', dir: { x: 0, y: 1 }, locals: { lambda: NaN, x: NaN, chord: NaN, graph: NaN, gap: NaN } });
        return out;
    }
    const lambda = fieldValue(at, 'at', t.name, ctx, out);
    if (lambda === null) return out;
    const x = chordX(a, b, lambda);
    const chord = lambda * ga + (1 - lambda) * gb;
    const graph = info.fn(x);
    const gap = chord - graph;
    const C = { x, y: chord };
    const fnColor = str(ctx.functions[info.index]?.color) || 'blue';
    out.markers.push({ ...C, color, size: 'normal' });
    if (Number.isFinite(graph)) {
        const D = { x, y: graph };
        out.guides.push({ lines: [[C, D]], color, width: 'thin', dashed: true, exact: true });
        out.markers.push({ ...D, color: fnColor, size: 'normal' });
    } else addIssue(out, t.name, 'at', msg('notes6.problem.noValueAt', { name, x: decimal(x) }), 'info');
    out.derived[`${t.name}_x`] = x;
    out.derived[`${t.name}_y`] = chord;
    out.derived[`${t.name}_val`] = gap;
    const locals = { lambda, x, chord, graph, gap };
    // The point on the chord on the side away from the graph, the point on the graph on the other side.
    const up = gap >= 0 ? 1 : -1;
    if (label) out.texts.push({ ...C, template: 'label', color, size: 'small', dir: { x: 0, y: up }, locals, marker: 'normal' });
    else if (t.valueLabel) {
        const l = lambdaTex(ctx, at);
        const fn = ctx.math.tex(name);
        out.texts.push({ ...C, template: 'label', color, size: 'small', dir: { x: 0, y: up }, locals, marker: 'normal', literal: `$${l}\\,${fn}(${decimal(a)}) + (1 - ${l})\\,${fn}(${decimal(b)}) = ${decimal(chord)}$` });
        if (Number.isFinite(graph)) out.texts.push({ x, y: graph, template: 'label', color: fnColor, size: 'small', dir: { x: 0, y: -up }, locals, marker: 'normal', literal: `$${fn}(${decimal(x)}) = ${decimal(graph)}$` });
    }
    return out;
}
