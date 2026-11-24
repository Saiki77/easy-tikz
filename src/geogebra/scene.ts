/*
 * 6.0 G: GeoGebra's lines as scene primitives, in GeoGebra's default look:
 * free points blue and dependent ones black, with their names; vectors
 * (Vector(A, B), a lower case name for (3, 1)) as arrows; lists of points
 * as dots; circles, segments, lines, rays, curves and functions as black
 * strokes; polygons brown with a light fill; texts at their point. The
 * preview and the pgfplots export draw them alike, as numeric coordinates.
 * 2D, and points, lists, segments, vectors, polylines, polygons and curves
 * in 3D. Pure: no DOM, no Obsidian.
 */
import type { GeoGebraTool, MarkerSize, Tool } from '../types';
import type { Pt } from '../geometry';
import type { SceneCtx, SceneOutput, SceneTextSpec } from '../scene';
import { UP_RIGHT, addIssue, fail, midSpot, newOutput } from '../scene';
import { ExprError } from '../expr';
import { t as msg } from '../i18n';
import { errorText } from '../util';
import { Cell, Locals, Part, ValueCompiler } from '../values/compile';
import { formatValue } from '../values/format';
import { parseValue } from '../values/parse';
import type { VCall, VNode } from '../values/parse';
import { toReal } from '../values/ops';
import { NUM, Value, isList } from '../values/types';
import type { FitShapes } from '../beyond/fit';
import { GObj, PointMap, circlePoints, circleThrough, clipLine, graphRuns, mapObject, reflectInLine, regularPolygon } from './objects';
import { commandTree, geogebraKind, objectNames } from './defs';
import { pointNumbers } from './commands';
import { OBJECT_COMMANDS } from './syntax';

const TRANSFORMS = new Set(['Translate', 'Rotate', 'Dilate', 'Reflect']);
import { closeOf, freeNames, topArgs, wholeCall } from './text';

/** The tool types of this part. */
export const GEOGEBRA_TYPES: ReadonlySet<string> = new Set(['geogebra']);

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
/** A list with more points than this draws them small (a point set such as the Mandelbrot set). */
const MANY_POINTS = 100;
/** Steps of a curve. */
const CURVE_STEPS = 400;

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

/** Producers and evaluated sources of a GeoGebra line, for the scene's dependency graph and cache keys; false for any other tool. */
export function geogebraSources(t: Tool, scan: (src: unknown, field: string) => void): boolean {
    if (t.type !== 'geogebra') return false;
    // The text of a Text("...") is no formula: only what is outside its quotes is read.
    scan(t.command.replace(/"(?:[^"\\]|\\.)*"/g, '""'), 'command');
    return true;
}

// ---------------------------------------------------------------- evaluate

class Problem extends Error {}

/** Evaluates a GeoGebra line to its object in the scope of the scene. */
class Evaluator {
    private readonly objects: Set<string>;

    constructor(
        private readonly t: GeoGebraTool,
        private readonly ctx: SceneCtx
    ) {
        this.objects = objectNames([...ctx.toolsByName.values()]);
    }

    private problem(message: string): never {
        throw new Problem(message);
    }

    /** A part of the command compiled (part A's compiler), with locals. */
    private compile(node: VNode, src: string, locals: Array<{ name: string; cell: Cell }> = []): Part {
        let chain: Locals | null = null;
        for (const l of locals) chain = new Locals(chain, l.name, l.cell, NUM);
        return new ValueCompiler({ env: this.ctx.math.envFor('value'), defs: this.ctx.math.valueTable(), locals: chain, src }).node(node);
    }

    /** The object of another line (or a points tool's point) named by `node`, else null. */
    private named(node: VNode): GObj | null {
        if (node.t !== 'name') return null;
        const name = node.name;
        const tool = this.ctx.toolsByName.get(name);
        if (!tool || tool === this.t) return null;
        if (tool.type === 'geogebra' && this.objects.has(name)) {
            const out = this.ctx.outputs.get(name);
            const obj = out && !out.failed ? out.geogebra : undefined;
            if (!obj) this.problem(msg('problems.scene.hasError', { name }));
            return obj;
        }
        if (tool.type === 'points') {
            const out = this.ctx.outputs.get(name);
            const p = out && !out.failed && out.points ? out.points[0] : undefined;
            if (!p) this.problem(msg('problems.scene.hasError', { name }));
            return { k: 'value', v: { kind: 'vec', v: p.slice(0, this.ctx.dim) } };
        }
        return null;
    }

    /** An argument as an object: another line's, an object command in it (Reflect(p, Line(A, B))), or its value. */
    private arg(node: VNode, src: string): GObj {
        const named = this.named(node);
        if (named) return named;
        if (node.t === 'call' && (OBJECT_COMMANDS.has(node.name) || (TRANSFORMS.has(node.name) && node.args.some((a) => a.t === 'call' || (a.t === 'name' && this.objects.has(a.name)))))) {
            const inner = this.tryObject(node, src);
            if (inner) return inner;
        }
        return { k: 'value', v: this.compile(node, src).f() };
    }

    /** An object command inside another one; null when it is a value after all (Rotate of a point). */
    private tryObject(node: VCall, src: string): GObj | null {
        if (TRANSFORMS.has(node.name)) {
            const first = node.args[0];
            const isObject = !!first && ((first.t === 'name' && this.objects.has(first.name)) || (first.t === 'call' && OBJECT_COMMANDS.has(first.name)));
            if (!isObject) return null;
        }
        return this.object(node, src);
    }

    private point(node: VNode, src: string, command: string): number[] {
        const o = this.arg(node, src);
        const p = o.k === 'value' ? pointNumbers(o.v) : null;
        if (!p || !p.every(Number.isFinite)) this.problem(msg('geogebra.problem.needsPoint', { name: command, text: src.slice(node.s, node.e) }));
        return p;
    }

    private number(node: VNode, src: string): number {
        const o = this.arg(node, src);
        const v = o.k === 'value' ? toReal(o.v) : NaN;
        if (!Number.isFinite(v)) this.problem(msg('geogebra.problem.needsNumber', { text: src.slice(node.s, node.e) }));
        return v;
    }

    /** The points of a list argument (or of the arguments from `from` on). */
    private points(args: VNode[], from: number, src: string, command: string): number[][] {
        if (args.length === from + 1) {
            const o = this.arg(args[from], src);
            if (o.k === 'value' && isList(o.v)) {
                const out: number[][] = [];
                for (const item of o.v.items) {
                    const p = pointNumbers(item);
                    if (p && p.every(Number.isFinite)) out.push(p);
                }
                return out;
            }
        }
        return args.slice(from).map((a) => this.point(a, src, command));
    }

    /** A function argument: a name of a function, or a formula in x. */
    private fn(node: VNode, src: string): (x: number) => number {
        const cell: Cell = { v: NaN };
        let part: Part;
        if (node.t === 'name' && (this.ctx.math.valueTable().isFunction(node.name) || !!this.ctx.math.envFor('value').fn(node.name))) {
            part = this.compile({ t: 'call', name: node.name, math: false, args: [{ t: 'name', name: '\u0001x', s: node.s, e: node.e }], ns: node.s, ne: node.e, s: node.s, e: node.e }, src, [{ name: '\u0001x', cell }]);
        } else part = this.compile(node, src, [{ name: 'x', cell }]);
        const f = part.f;
        return (x: number) => {
            cell.v = x;
            return toReal(f());
        };
    }

    evaluate(): GObj {
        const t = this.t;
        const src = t.command.trim();
        if (!src) this.problem(msg('geogebra.problem.empty'));
        const top = wholeCall(src);
        if (top === 'Text') return this.text(src);
        const table = this.ctx.math.valueTable();
        const kind = geogebraKind(src, this.objects);
        const own = t.named && table.has(t.name) ? table.problem(t.name) : undefined;
        if (own) this.problem(own);
        if (kind === 'function') return { k: 'function', f: this.fn(this.tree(src), src), from: NaN, to: NaN };
        const tree = this.tree(src);
        if (kind === 'value') {
            if (top === 'Vector' && tree.t === 'call') return this.vector(tree, src);
            const v = t.named && table.has(t.name) ? table.value(t.name) : this.compile(tree, src).f();
            return { k: 'value', v };
        }
        if (tree.t !== 'call') this.problem(msg('geogebra.problem.empty'));
        return this.object(tree, src);
    }

    private tree(src: string): VNode {
        const tree = commandTree(src);
        if (tree) return tree;
        // The problem of the formula, as part A's reader words it.
        try {
            parseValue(src);
        } catch (e) {
            this.problem(errorText(e));
        }
        return this.problem(msg('geogebra.problem.empty'));
    }

    private vector(n: VCall, src: string): GObj {
        const a = n.args;
        if (a.length === 1) {
            const p = this.point(a[0], src, 'Vector');
            return { k: 'vector', a: p.map(() => 0), b: p };
        }
        if (a.length !== 2) this.problem(msg('geogebra.problem.takes', { name: 'Vector', usage: 'Vector(<point>) or Vector(<start point>, <end point>)' }));
        return { k: 'vector', a: this.point(a[0], src, 'Vector'), b: this.point(a[1], src, 'Vector') };
    }

    /** Text("...", P), Text("a = " + a, P): its text with the values in it, at P (the top left of the view without one). */
    private text(src: string): GObj {
        const open = src.indexOf('(');
        const close = closeOf(src, open);
        const args = topArgs(src.slice(open + 1, close));
        const pieces = splitPlus(args[0] ?? '');
        let text = '';
        for (const p of pieces) {
            const q = /^"((?:[^"\\]|\\.)*)"$/.exec(p);
            if (q) text += q[1].replace(/\\(["\\])/g, '$1');
            else if (p) {
                let v: Value;
                try {
                    v = this.ctx.math.valueTable().compileField(p, this.ctx.math.envFor('value')).f();
                } catch (e) {
                    return this.problem(errorText(e));
                }
                text += formatValue(v, 2);
            }
        }
        const view = this.ctx.view;
        let at = [view.xmin + 0.05 * (view.xmax - view.xmin), view.ymax - 0.08 * (view.ymax - view.ymin)];
        if (args[1]) {
            let v: Value;
            try {
                v = this.ctx.math.valueTable().compileField(args[1], this.ctx.math.envFor('value')).f();
            } catch (e) {
                const tool = NAME_RE.test(args[1].trim()) ? this.named({ t: 'name', name: args[1].trim(), s: 0, e: 0 }) : null;
                if (!tool || tool.k !== 'value') return this.problem(errorText(e));
                v = tool.v;
            }
            const p = pointNumbers(v);
            if (!p) this.problem(msg('geogebra.problem.needsPoint', { name: 'Text', text: args[1] }));
            at = p;
        }
        return { k: 'text', text, at };
    }

    private object(n: VCall, src: string): GObj {
        const a = n.args;
        const usage = () => this.problem(msg('geogebra.problem.takes', { name: n.name, usage: USAGE_OBJECTS[n.name] ?? `${n.name}(...)` }));
        switch (n.name) {
            case 'Circle': {
                if (a.length === 3) {
                    const c = circleThrough(this.point(a[0], src, n.name), this.point(a[1], src, n.name), this.point(a[2], src, n.name));
                    if (!c) this.problem(msg('geogebra.problem.onALine'));
                    return { k: 'circle', ...c };
                }
                if (a.length !== 2) usage();
                const c = this.point(a[0], src, n.name);
                const second = this.arg(a[1], src);
                const p = second.k === 'value' ? pointNumbers(second.v) : null;
                const r = p ? Math.hypot(p[0] - c[0], p[1] - c[1]) : second.k === 'value' ? toReal(second.v) : NaN;
                if (!(r >= 0)) this.problem(msg('geogebra.problem.needsNumber', { text: src.slice(a[1].s, a[1].e) }));
                return { k: 'circle', c, r };
            }
            case 'Segment':
            case 'Line':
            case 'Ray': {
                if (a.length !== 2) usage();
                const k = n.name === 'Segment' ? 'segment' : n.name === 'Line' ? 'line' : 'ray';
                return { k, a: this.point(a[0], src, n.name), b: this.point(a[1], src, n.name) };
            }
            case 'Polygon':
            case 'Polyline': {
                if (!a.length) usage();
                if (n.name === 'Polygon' && a.length === 3) {
                    const third = this.arg(a[2], src);
                    if (third.k === 'value' && typeof third.v === 'number') {
                        const count = Math.round(third.v);
                        if (!(count >= 3 && count <= 1000)) this.problem(msg('geogebra.problem.needsNumber', { text: src.slice(a[2].s, a[2].e) }));
                        return { k: 'polygon', pts: regularPolygon(this.point(a[0], src, n.name), this.point(a[1], src, n.name), count) };
                    }
                }
                const pts = this.points(a, 0, src, n.name);
                return { k: n.name === 'Polygon' ? 'polygon' : 'polyline', pts };
            }
            case 'Curve': {
                if (a.length !== 5 && a.length !== 6) usage();
                const v = a[a.length - 3];
                if (v.t !== 'name') usage();
                const cell: Cell = { v: NaN };
                const comps = a.slice(0, a.length - 3).map((c) => this.compile(c, src, [{ name: (v as { name: string }).name, cell }]).f);
                const lo = this.number(a[a.length - 2], src);
                const hi = this.number(a[a.length - 1], src);
                const pts: number[][] = [];
                for (let i = 0; i <= CURVE_STEPS; i++) {
                    cell.v = lo + ((hi - lo) * i) / CURVE_STEPS;
                    pts.push(comps.map((f) => toReal(f())));
                }
                return { k: 'curve', pts };
            }
            case 'Function': {
                if (a.length !== 3) usage();
                return { k: 'function', f: this.fn(a[0], src), from: this.number(a[1], src), to: this.number(a[2], src) };
            }
            case 'Translate':
            case 'Rotate':
            case 'Dilate':
            case 'Reflect':
                return this.transform(n, src);
            default:
                return this.problem(msg('geogebra.problem.object', { name: n.name, usage: USAGE_OBJECTS[n.name] ?? '' }));
        }
    }

    /** Translate, Rotate, Dilate, Reflect of an object (or of a point in an object, Reflect(A, l)). */
    private transform(n: VCall, src: string): GObj {
        const a = n.args;
        const usage = () => this.problem(msg('geogebra.problem.takes', { name: n.name, usage: USAGE_OBJECTS[n.name] }));
        if (a.length < 2) usage();
        const what = this.arg(a[0], src);
        let map: PointMap | null = null;
        switch (n.name) {
            case 'Translate': {
                const by = this.arg(a[1], src);
                const v = by.k === 'vector' ? by.b.map((x, i) => x - by.a[i]) : by.k === 'value' ? pointNumbers(by.v) : null;
                if (!v) this.problem(msg('geogebra.problem.needsPoint', { name: n.name, text: src.slice(a[1].s, a[1].e) }));
                map = { scale: 1, f: (p) => p.map((x, i) => x + (v[i] ?? 0)) };
                break;
            }
            case 'Rotate': {
                const angle = this.number(a[1], src);
                const c = a[2] ? this.point(a[2], src, n.name) : [0, 0];
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                map = { scale: 1, f: (p) => [c[0] + cos * (p[0] - c[0]) - sin * (p[1] - c[1]), c[1] + sin * (p[0] - c[0]) + cos * (p[1] - c[1]), ...p.slice(2)] };
                break;
            }
            case 'Dilate': {
                const k = this.number(a[1], src);
                const c = a[2] ? this.point(a[2], src, n.name) : [0, 0, 0];
                map = { scale: k, f: (p) => p.map((x, i) => (c[i] ?? 0) + k * (x - (c[i] ?? 0))) };
                break;
            }
            default: {
                const by = this.arg(a[1], src);
                if (by.k === 'line' || by.k === 'segment' || by.k === 'ray' || by.k === 'vector') map = reflectInLine(by.a, by.b);
                else {
                    const q = by.k === 'value' ? pointNumbers(by.v) : null;
                    if (!q) this.problem(msg('geogebra.problem.needsPoint', { name: n.name, text: src.slice(a[1].s, a[1].e) }));
                    map = { scale: 1, f: (p) => p.map((x, i) => 2 * (q[i] ?? 0) - x) };
                }
                if (!map) this.problem(msg('geogebra.problem.needsPoint', { name: n.name, text: src.slice(a[1].s, a[1].e) }));
            }
        }
        const m = map as PointMap;
        const view = this.ctx.view;
        const sample = (o: Extract<GObj, { k: 'function' }>) => {
            const from = Number.isFinite(o.from) ? Math.max(o.from, view.xmin) : view.xmin;
            const to = Number.isFinite(o.to) ? Math.min(o.to, view.xmax) : view.xmax;
            return graphRuns(o.f, from, to, view).flat();
        };
        const moved = mapObject(what, m, sample, (v) => mapValue(v, m));
        if (!moved) this.problem(msg('geogebra.problem.empty'));
        return moved;
    }
}

/** How the object commands are written (the problem when the arguments do not fit). */
const USAGE_OBJECTS: Record<string, string> = {
    Circle: 'Circle(<center>, <radius>), Circle(<center>, <point>) or Circle(<point>, <point>, <point>)',
    Segment: 'Segment(<point>, <point>)',
    Line: 'Line(<point>, <point>)',
    Ray: 'Ray(<start point>, <point>)',
    Polygon: 'Polygon(<point>, ..., <point>), Polygon(<list of points>) or Polygon(<point>, <point>, <n>)',
    Polyline: 'Polyline(<point>, ..., <point>) or Polyline(<list of points>)',
    Curve: 'Curve(<x(t)>, <y(t)>, t, <from>, <to>)',
    Function: 'Function(<function>, <from>, <to>)',
    Translate: 'Translate(<object>, <vector>)',
    Rotate: 'Rotate(<object>, <angle>[, <point>])',
    Dilate: 'Dilate(<object>, <factor>[, <point>])',
    Reflect: 'Reflect(<object>, <point>) or Reflect(<object>, <line>)',
};

/** A value with its points moved (lists item by item). */
function mapValue(v: Value, m: PointMap): Value {
    if (isList(v)) return { kind: 'list', items: v.items.map((x) => mapValue(x, m)) };
    const p = pointNumbers(v);
    if (!p) return NaN;
    const q = m.f(p);
    if (!q) return NaN;
    return typeof v !== 'number' && v.kind === 'complex' ? { kind: 'complex', re: q[0], im: q[1] } : { kind: 'vec', v: q };
}

/** `"a = " + a + "!"` as its pieces at the top level ('+' outside brackets and quotes). */
function splitPlus(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let quote = false;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === '"') quote = false;
            continue;
        }
        if (c === '"') quote = true;
        else if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === '+' && depth === 0) {
            out.push(s.slice(start, i).trim());
            start = i + 1;
        }
    }
    out.push(s.slice(start).trim());
    // A + inside a formula between texts stays in it: join the pieces that are no texts.
    const joined: string[] = [];
    for (const p of out) {
        const last = joined.length ? joined[joined.length - 1] : null;
        if (last !== null && !/^".*"$/.test(last) && !/^".*"$/.test(p)) joined[joined.length - 1] = `${last} + ${p}`;
        else joined.push(p);
    }
    return joined;
}

// -------------------------------------------------------------------- draw

/** The name as a label: one letter (with an index) in math, Z_0 as Z₀; a longer name as it is. */
export function nameLabel(name: string): string {
    const greek = /^(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|chi|psi|omega)$/;
    const m = /^([A-Za-z]+)(?:_?([A-Za-z0-9]+))?$/.exec(name);
    if (!m) return name;
    const [, base, sub] = m;
    const head = greek.test(base) ? `\\${base}` : base.length === 1 ? base : null;
    if (head === null) return name;
    if (!sub) return `$${head}$`;
    return `$${head}_{${sub}}$`;
}

/** A free point: its text is numbers only (and i). */
function isFree(command: string): boolean {
    if (/[A-Z][a-z]*\s*\(/.test(command)) return false;
    for (const n of freeNames(command)) if (n !== 'i' && n !== 'pi') return false;
    return true;
}

const view2 = (p: number[]): Pt => ({ x: p[0], y: p[1] });

/** A GeoGebra line computed in a 2D chart; null for any other tool. */
export function computeGeoGebra(t: Tool, ctx: SceneCtx): SceneOutput | null {
    if (t.type !== 'geogebra') return null;
    const out = newOutput();
    let obj: GObj;
    try {
        obj = new Evaluator(t, ctx).evaluate();
    } catch (e) {
        if (e instanceof Problem || e instanceof ExprError) return fail(out, t.name, 'command', e.message);
        return fail(out, t.name, 'command', errorText(e));
    }
    out.geogebra = obj;
    if (ctx.dim === 3) draw3(obj, t, ctx, out);
    else draw2(obj, t, ctx, out);
    return out;
}

/** The look of a line: its own options, else GeoGebra's for what it draws. */
function look(t: GeoGebraTool, kind: 'free' | 'point' | 'polygon' | 'other') {
    const color = t.color || (kind === 'free' ? 'blue' : kind === 'polygon' ? 'brown' : 'black');
    const width = t.thickness || 'thick';
    return { color, width, dashed: !!t.dashed };
}

function draw2(obj: GObj, t: GeoGebraTool, ctx: SceneCtx, out: SceneOutput): void {
    const view = ctx.view;
    const label = str(t.label).trim();
    const showName = t.named && t.nameLabel !== 'hidden';
    /** The label at a spot: the template when there is one, else the name. */
    const labelAt = (p: Pt, dir: Pt, marker?: MarkerSize, slide?: Pt[], always = false, color = look(t, 'other').color) => {
        if (!label && !(showName && (always || t.nameLabel === 'shown'))) return;
        const spec: SceneTextSpec = { x: p.x, y: p.y, template: 'label', locals: { x: p.x, y: p.y }, color, size: 'normal', dir };
        if (marker) spec.marker = marker;
        if (slide) spec.slide = slide;
        out.texts.push(label ? spec : { ...spec, literal: nameLabel(t.name) });
    };
    const stroke = (line: Pt[], kind: 'polygon' | 'other', extra: { closed?: boolean; arrow?: 'forward' } = {}) => {
        const l = look(t, kind);
        out.strokes.push({ lines: [line], color: l.color, width: l.width, dashed: l.dashed, exact: true, ...extra });
    };
    const fill = (ring: Pt[], kind: 'polygon' | 'other', opacity: number) => {
        if (!(opacity > 0) || ring.length < 3) return;
        out.fills.push({ rings: [ring], color: look(t, kind).color, opacity, pattern: 'solid' });
    };
    switch (obj.k) {
        case 'value': {
            const v = obj.v;
            const single = pointNumbers(v);
            if (single && !isList(v)) {
                if (!single.every(Number.isFinite)) return;
                // A lower case name of a vector is GeoGebra's vector: an arrow from the origin.
                if (t.named && /^[a-z]/.test(t.name) && typeof v !== 'number' && v.kind === 'vec') {
                    const line = [{ x: 0, y: 0 }, view2(single)];
                    stroke(line, 'other', { arrow: 'forward' });
                    const { p, dir } = midSpot(line);
                    labelAt(p, { x: -dir.y, y: dir.x }, undefined, line);
                    return;
                }
                const color = look(t, isFree(t.command) ? 'free' : 'point').color;
                const size: MarkerSize = t.size || 'normal';
                out.markers.push({ x: single[0], y: single[1], color, size });
                out.points = [single];
                labelAt(view2(single), UP_RIGHT, size, undefined, true, color);
                return;
            }
            if (!isList(v)) return;
            const pts = flatPoints(v);
            out.points = pts;
            const size: MarkerSize = t.size || (pts.length > MANY_POINTS ? 'small' : 'normal');
            const color = look(t, 'point').color;
            for (const p of pts) out.markers.push({ x: p[0], y: p[1], color, size });
            if (pts.length && (label || t.nameLabel === 'shown')) labelAt(view2(pts[0]), UP_RIGHT, size, undefined, false, color);
            return;
        }
        case 'function': {
            const from = Number.isFinite(obj.from) ? Math.max(obj.from, view.xmin) : view.xmin;
            const to = Number.isFinite(obj.to) ? Math.min(obj.to, view.xmax) : view.xmax;
            if (!(to > from)) return;
            const runs = graphRuns(obj.f, from, to, view);
            const l = look(t, 'other');
            if (runs.length) out.strokes.push({ lines: runs.map((r) => r.map(view2)), color: l.color, width: l.width, dashed: l.dashed });
            const longest = runs.reduce<number[][]>((a, r) => (r.length > a.length ? r : a), []);
            if (longest.length > 1) {
                const line = longest.map(view2);
                const at = line[Math.floor(line.length * 0.8)];
                labelAt(at, UP_RIGHT, undefined, line);
            }
            return;
        }
        case 'circle': {
            const ring = circlePoints(obj.c, obj.r).map(view2);
            const opacity = t.fillOpacity >= 0 ? t.fillOpacity : 0;
            fill(ring.slice(0, -1), 'other', opacity);
            stroke(ring, 'other', { closed: true });
            labelAt(ring[Math.round(ring.length / 8)], UP_RIGHT, undefined, ring);
            return;
        }
        case 'segment':
        case 'vector': {
            const line = [view2(obj.a), view2(obj.b)];
            stroke(line, 'other', obj.k === 'vector' ? { arrow: 'forward' } : {});
            const { p, dir } = midSpot(line);
            labelAt(p, { x: -dir.y, y: dir.x }, undefined, line);
            return;
        }
        case 'line':
        case 'ray': {
            const cut = clipLine(obj.a, obj.b, view, obj.k === 'line' ? -Infinity : 0);
            if (!cut) return;
            const line = cut.map(view2);
            stroke(line, 'other');
            const { p, dir } = midSpot(line);
            labelAt(p, { x: -dir.y, y: dir.x }, undefined, line);
            return;
        }
        case 'polygon':
        case 'polyline':
        case 'curve': {
            const kind = obj.k === 'polygon' ? 'polygon' : 'other';
            const runs = splitRuns(obj.pts).map((r) => r.map(view2));
            if (!runs.length) return;
            if (obj.k === 'polygon') {
                fill(runs[0], kind, t.fillOpacity >= 0 ? t.fillOpacity : 0.1);
                stroke(runs[0], kind, { closed: true });
                const centre = runs[0].reduce((acc, q) => ({ x: acc.x + q.x / runs[0].length, y: acc.y + q.y / runs[0].length }), { x: 0, y: 0 });
                labelAt(centre, UP_RIGHT, undefined, undefined, false, look(t, kind).color);
                return;
            } else {
                const l = look(t, kind);
                out.strokes.push({ lines: runs, color: l.color, width: l.width, dashed: l.dashed, exact: obj.k === 'polyline' });
            }
            const { p, dir } = midSpot(runs[0]);
            labelAt(p, { x: -dir.y, y: dir.x }, undefined, runs[0]);
            return;
        }
        case 'text': {
            const at = view2(obj.at);
            out.texts.push({ x: at.x, y: at.y, template: 'label', literal: label ? undefined : obj.text, locals: { x: at.x, y: at.y }, color: look(t, 'other').color, size: 'normal', anchor: 'right' });
            return;
        }
    }
}

/** The points of a list (nested lists too) with numbers. */
function flatPoints(v: Value): number[][] {
    const out: number[][] = [];
    const walk = (x: Value) => {
        if (isList(x)) {
            for (const item of x.items) walk(item);
            return;
        }
        const p = pointNumbers(x);
        if (p && p.every(Number.isFinite)) out.push(p);
    };
    walk(v);
    return out;
}

/** A polyline cut where a point has no value. */
function splitRuns(pts: number[][]): number[][][] {
    const runs: number[][][] = [];
    let run: number[][] = [];
    for (const p of pts) {
        if (p.every(Number.isFinite)) run.push(p);
        else {
            if (run.length > 1) runs.push(run);
            run = [];
        }
    }
    if (run.length > 1) runs.push(run);
    return runs;
}

function draw3(obj: GObj, t: GeoGebraTool, ctx: SceneCtx, out: SceneOutput): void {
    const l = look(t, obj.k === 'polygon' ? 'polygon' : 'other');
    const p3 = (p: number[]): [number, number, number] => [p[0], p[1], p[2] ?? 0];
    const legs = (pts: number[][], closed: boolean, arrow = false) => {
        const loop = closed && pts.length > 2 ? [...pts, pts[0]] : pts;
        const segs = (out.segments3 = out.segments3 || []);
        for (let i = 1; i < loop.length; i++) {
            const seg: NonNullable<SceneOutput['segments3']>[number] = { a: p3(loop[i - 1]), b: p3(loop[i]), color: l.color, width: l.width, dashed: l.dashed };
            if (arrow && i === loop.length - 1) seg.arrow = 'forward';
            segs.push(seg);
        }
    };
    const name = t.named && t.nameLabel !== 'hidden' ? nameLabel(t.name) : '';
    switch (obj.k) {
        case 'value': {
            const v = obj.v;
            if (!isList(v)) {
                const p = pointNumbers(v);
                if (!p || !p.every(Number.isFinite)) return;
                if (t.named && /^[a-z]/.test(t.name) && typeof v !== 'number' && v.kind === 'vec') return legs([[0, 0, 0], p], false, true);
                const color = look(t, isFree(t.command) ? 'free' : 'point').color;
                out.points3 = [{ x: p[0], y: p[1], z: p[2] ?? 0, color, size: t.size || 'normal', part: 0, locals: { x: p[0], y: p[1], z: p[2] ?? 0 }, literal: str(t.label).trim() ? undefined : name || undefined }];
                return;
            }
            const pts = flatPoints(v);
            const size: MarkerSize = t.size || (pts.length > MANY_POINTS ? 'small' : 'normal');
            out.points3 = pts.map((p, i) => ({ x: p[0], y: p[1], z: p[2] ?? 0, color: look(t, 'point').color, size, part: i, locals: { x: p[0], y: p[1], z: p[2] ?? 0 } }));
            return;
        }
        case 'segment':
        case 'vector':
            return legs([obj.a, obj.b], false, obj.k === 'vector');
        case 'polygon':
            return legs(obj.pts, true);
        case 'polyline':
        case 'curve':
            for (const run of splitRuns(obj.pts)) legs(run, false);
            return;
        default:
            addIssue(out, t.name, 'command', msg('geogebra.problem.only2D', { name: t.name }), 'info');
    }
}

// --------------------------------------------------------------------- fit

/** What a GeoGebra line adds to the auto-fit; null for other tools (and for lines, rays and functions: the generic rules). */
export function geogebraFitShapes(tool: Tool, item: { strokes: Array<{ lines: Pt[][]; closed?: boolean }>; markers: Pt[]; texts?: Pt[] }): FitShapes | null {
    if (tool.type !== 'geogebra') return null;
    const top = wholeCall(tool.command.trim());
    if (top === 'Line' || top === 'Ray') return { points: [], lines: [] };
    if (top === 'Function' || top === 'Derivative' || freeNames(tool.command).has('x')) return null;
    const points = item.markers.map((m) => ({ x: m.x, y: m.y }));
    if (top === 'Text' && item.texts) points.push(...item.texts.map((p) => ({ x: p.x, y: p.y })));
    return { points, lines: item.strokes.flatMap((s) => s.lines.map((pts) => ({ pts, closed: !!s.closed }))) };
}
