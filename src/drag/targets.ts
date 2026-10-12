/*
 * Hit -> DragTarget (SPEC3 1.4, 1.5, 3.7): which fields and units a grabbed
 * part owns, delegation (extremum -> function, `y <= f1` -> f1), locks with
 * their reasons, twins, and the field read / write helpers every caller
 * shares. Pure: no DOM, no Obsidian.
 */
import { Node, linearForm, parse, parseTuples, tokenize, formatNumber, identifierTokens } from '../expr';
import { MathContext, conditionClauseNodes } from '../mathcontext';
import type { Annotation, CurveTool, FunctionParameters, Parameter, PointsTool, RegionTool, SegmentTool, Tool } from '../types';
import { lockFor } from './describe';
import type { DragContext, DragTarget, FieldRef, Hit, HitShape, Lock, Pt, UnitSpec, VirtualKind } from './types';

export interface ChartData {
    functions: FunctionParameters[];
    tools: Tool[];
    annotations: Annotation[];
    parameters: Parameter[];
}

const ALL_VIRTUAL: VirtualKind[] = ['add', 'factor', 'shiftVar', 'scaleVar'];
const TANGENT_KEYWORD_RE = /^\s*(min|max)(\d*)\s*$/;
const DERIVED_RE = /^(.+)_(x|y|z|val|n)(\d*)$/;
/** Two polyline ends this close (px) make a closed curve. */
const CLOSED_PX = 1;

// ---------------------------------------------------------------- fields

/** Current text of a field, or null when the item (or the entry) is gone. */
export function fieldText(ref: FieldRef, data: ChartData): string | null {
    if (ref.kind === 'function') {
        const f = (data.functions || []).find((g) => g && g.name === ref.name);
        if (!f) return null;
        return str(ref.field === 'expression' ? f.expression : f.tangentPoint);
    }
    if (ref.kind === 'label') {
        const a = (data.annotations || [])[ref.index];
        if (!a) return null;
        return str(ref.field === 'x' ? a.x : a.y);
    }
    const t = (data.tools || []).find((x) => x && x.id === ref.id);
    if (!t) return null;
    switch (ref.field) {
        case 'condition':
            if (t.type !== 'region' || !Array.isArray(t.conditions) || ref.entry < 0 || ref.entry >= t.conditions.length) return null;
            return str(t.conditions[ref.entry]);
        case 'equation':
            return t.type === 'curve' ? str(t.equation) : null;
        case 'levels':
            return t.type === 'curve' ? str(t.levels) : null;
        case 'points':
            return t.type === 'points' ? str(t.points) : null;
        case 'objective':
            return t.type === 'points' ? str(t.objective) : null;
        case 'path':
            return t.type === 'segment' ? str(t.path) : null;
    }
    return null;
}

/** Write in place; returns false when the item is gone. */
export function setFieldText(ref: FieldRef, data: ChartData, text: string): boolean {
    if (ref.kind === 'function') {
        const f = (data.functions || []).find((g) => g && g.name === ref.name);
        if (!f) return false;
        if (ref.field === 'expression') f.expression = text;
        else f.tangentPoint = text;
        return true;
    }
    if (ref.kind === 'label') {
        const a = (data.annotations || [])[ref.index];
        if (!a) return false;
        if (ref.field === 'x') a.x = text;
        else a.y = text;
        return true;
    }
    const t = (data.tools || []).find((x) => x && x.id === ref.id);
    if (!t) return false;
    switch (ref.field) {
        case 'condition':
            if (t.type !== 'region' || !Array.isArray(t.conditions) || ref.entry < 0 || ref.entry >= t.conditions.length) return false;
            t.conditions[ref.entry] = text;
            return true;
        case 'equation':
            if (t.type !== 'curve') return false;
            t.equation = text;
            return true;
        case 'levels':
            if (t.type !== 'curve') return false;
            t.levels = text;
            return true;
        case 'points':
            if (t.type !== 'points') return false;
            t.points = text;
            return true;
        case 'objective':
            if (t.type !== 'points') return false;
            t.objective = text;
            return true;
        case 'path':
            if (t.type !== 'segment') return false;
            t.path = text;
            return true;
    }
    return false;
}

/** Stable key of a field reference (maps, comparisons). */
export function refKey(ref: FieldRef): string {
    if (ref.kind === 'function') return `fn:${ref.name}:${ref.field}`;
    if (ref.kind === 'label') return `label:${ref.index}:${ref.field}`;
    return ref.field === 'condition' ? `tool:${ref.id}:condition:${ref.entry}` : `tool:${ref.id}:${ref.field}`;
}

/** Sliders read by xmin..ymax texts. */
export function axisSliders(rangeTexts: readonly string[], math: MathContext): Set<string> {
    const out = new Set<string>();
    for (const t of rangeTexts) {
        if (typeof t !== 'string' || !t.trim()) continue;
        for (const p of math.deps(t).params) out.add(p);
    }
    return out;
}

// --------------------------------------------------------------- targets

/** Delegation (extremum -> function, `y <= f1` -> f1), locks (reasons via describe.lockFor), units, twins. */
export function resolveTarget(hit: Hit | { label: number; at: { x: number; y: number } }, ctx: DragContext): DragTarget {
    try {
        if ('label' in hit) return labelTarget(hit.label, hit.at, ctx);
        const t = shapeTarget(hit, ctx);
        if (hit.passed && !t.lock) t.passed = hit.passed;
        return t;
    } catch {
        // Never throw into the pointer handler: an unreadable target is locked.
        const shape = 'label' in hit ? null : hit.shape;
        const subject = shape ? shape.source : `Label ${('label' in hit ? hit.label : 0) + 1}`;
        return locked(baseFrom(shape, subject), lockFor({ kind: 'nothing', subject }));
    }
}

function shapeTarget(hit: Hit, ctx: DragContext): DragTarget {
    const shape = hit.shape;
    const part = shape.part;
    switch (part.part) {
        case 'curve':
            return functionTarget(shape.source, shape, hit.run, ctx);
        case 'extremum': {
            const curve = ctx.hits.byKey(`fn:${shape.source}#curve`);
            if (!curve) return locked(baseFrom(shape, shape.source), lockFor({ kind: 'nothing', subject: shape.source }));
            const at = shape.point || hit.at;
            return functionTarget(shape.source, curve, nearestRun(curve.lines, at, ctx), ctx);
        }
        case 'tangent':
            return tangentTarget(shape, hit, ctx);
        case 'clause':
            return clauseTarget(shape, hit, part.entry, part.disjunct, part.clause, ctx);
        case 'level':
            return levelTarget(shape, hit, part.item, ctx);
        case 'point':
            return pointTarget(shape, part.item, ctx);
        case 'vertex':
            return vertexTarget(shape, part.index, part.item, ctx);
        case 'leg':
            return legTarget(shape, hit, ctx);
    }
    return locked(baseFrom(shape, shape.source), lockFor({ kind: 'nothing', subject: shape.source }));
}

function functionTarget(name: string, shape: HitShape, run: number, ctx: DragContext): DragTarget {
    const base = baseFrom(shape, name);
    base.cardSource = name;
    base.cardField = 'expression';
    base.lines = shape.lines;
    base.run = run;
    const f = (ctx.functions || []).find((g) => g && g.name === name);
    if (!f) return locked(base, lockFor({ kind: 'nothing', subject: name }));
    if (f.parametric) return locked(base, lockFor({ kind: 'curveKind', fn: name, fnKind: 'parametric' }));
    if (ctx.polar) return locked(base, lockFor({ kind: 'curveKind', fn: name, fnKind: 'polar' }));
    const straight = straightGraph(str(f.expression), ctx.math);
    const closed = closedRun(shape.lines, run, ctx);
    return {
        ...base,
        kind: 'graph',
        units: [{ ref: { kind: 'function', name, field: 'expression' }, role: 'body', fnKind: 'cartesian' }],
        straight,
        closed,
        allowSliders: true,
        virtual: ALL_VIRTUAL.slice(),
        shift: straight ? 'turn' : closed ? 'resize' : 'stretch',
    };
}

function tangentTarget(shape: HitShape, hit: Hit, ctx: DragContext): DragTarget {
    const name = shape.source;
    const base = baseFrom(shape, `${name} tangent`);
    base.cardSource = name;
    base.cardField = 'tangentPoint';
    base.fn = name;
    base.points = shape.point ? [shape.point] : [hit.at];
    const f = (ctx.functions || []).find((g) => g && g.name === name);
    if (!f) return locked(base, lockFor({ kind: 'nothing', subject: base.subject }));
    const tp = str(f.tangentPoint);
    const kw = TANGENT_KEYWORD_RE.exec(tp);
    if (kw) return locked(base, lockFor({ kind: 'keywordTangent', fn: name, keyword: tp.trim() }));
    const derived = onlyDerived(tp, ctx);
    if (derived) return locked(base, lockFor({ kind: 'derivedTangent', fn: name, name: derived.name, tool: derived.tool }));
    return {
        ...base,
        kind: 'tangent',
        units: [{ ref: { kind: 'function', name, field: 'tangentPoint' }, role: 'value' }],
        allowSliders: true,
        virtual: [],
        shift: 'none',
    };
}

function clauseTarget(shape: HitShape, hit: Hit, entry: number, disjunct: number, clause: number, ctx: DragContext): DragTarget {
    const tool = toolById(shape.itemKey, ctx) as RegionTool | null;
    const name = tool ? tool.name : shape.source;
    const label = tool && Array.isArray(tool.conditionLabels) ? str(tool.conditionLabels[entry]).trim() : '';
    const subject = label ? `${name} ${label}` : `${name} condition ${entry + 1}`;
    const base = baseFrom(shape, subject);
    base.cardSource = name;
    base.cardField = `condition:${entry}`;
    base.run = hit.run;
    if (!tool || tool.type !== 'region' || !Array.isArray(tool.conditions)) return locked(base, lockFor({ kind: 'nothing', subject }));
    const text = str(tool.conditions[entry]);
    const nodes = conditionClauseNodes(text);
    const c = nodes[disjunct] && nodes[disjunct][clause];
    if (!c) return locked(base, lockFor({ kind: 'nothing', subject }));
    const frozen = frozenMiddles(text);
    const live = [c.lhs, c.rhs].filter((n) => !frozen.has(n));
    const scan = scanNodes(live, ctx);
    if (!scan.numbers && !scan.sliders.length) {
        // `y <= f1` (and the hit clause of `f2 <= y <= f1`): the edge is f1's graph.
        const fnName = graphOfClause(c.lhs, c.rhs, ctx);
        if (fnName) {
            // The function's own drawn run holds the grab: samples, halo and pivot candidates are those of a
            // direct grab of the function (the clause run is only the part between two intersections, and a
            // pivot from its midline turns sin about (3, 0.15) with four numbers instead of the origin with two).
            const curve = ctx.hits.byKey(`fn:${fnName}#curve`);
            const run = curve ? nearestRun(curve.lines, hit.at, ctx) : -1;
            const t = curve && run >= 0 ? functionTarget(fnName, curve, run, ctx) : functionTarget(fnName, shape, hit.run, ctx);
            if (curve) t.key = curve.key;
            t.source = fnName;
            return t;
        }
        if (!scan.functions.length && scan.derived.length) {
            const d = scan.derived[0];
            return locked(base, lockFor({ kind: 'derivedClause', region: name, name: d, tool: derivedTool(d) }));
        }
    }
    let straight = false;
    try {
        const entries = ctx.math.conditions([text]);
        const cl = entries[0] && entries[0].disjuncts[disjunct] && entries[0].disjuncts[disjunct][clause];
        straight = !!cl && cl.affine !== null;
    } catch {
        straight = false;
    }
    const closed = !straight && closedRun(shape.lines, hit.run, ctx);
    return {
        ...base,
        kind: 'clause',
        units: [{ ref: { kind: 'tool', id: tool.id, field: 'condition', entry }, role: 'clause', disjunct, clause }],
        straight,
        closed,
        allowSliders: true,
        virtual: ALL_VIRTUAL.slice(),
        shift: straight ? 'turn' : closed ? 'resize' : 'stretch',
    };
}

function levelTarget(shape: HitShape, hit: Hit, item: number, ctx: DragContext): DragTarget {
    const tool = toolById(shape.itemKey, ctx) as CurveTool | null;
    const name = tool ? tool.name : shape.source;
    const base = baseFrom(shape, name);
    base.cardSource = name;
    base.run = hit.run;
    if (!tool || tool.type !== 'curve') return locked(base, lockFor({ kind: 'nothing', subject: name }));
    const eq = str(tool.equation);
    let straight = false;
    try {
        straight = ctx.math.equation(eq).affine !== null;
    } catch {
        straight = false;
    }
    const closed = !straight && closedRun(shape.lines, hit.run, ctx);
    const eqUnit: UnitSpec = { ref: { kind: 'tool', id: tool.id, field: 'equation' }, role: 'equation' };
    const twins = findTwins(eq, ctx);
    const shift = straight ? 'turn' : closed ? 'resize' : 'stretch';
    if (item < 0 || !str(tool.levels).trim()) {
        base.cardField = 'equation';
        return {
            ...base,
            kind: 'curve',
            units: [eqUnit],
            straight,
            closed,
            allowSliders: true,
            virtual: ALL_VIRTUAL.slice(),
            shift,
            twins: twins.units,
            twinNames: twins.names,
        };
    }
    const value = levelValue(str(tool.levels), item, ctx.math);
    base.subject = `${name} level ${Number.isFinite(value) ? formatNumber(value) : item + 1}`;
    base.cardField = 'levels';
    return {
        ...base,
        kind: 'level',
        // [0] the equation (Shift reshapes every level), [1] the grabbed level item (plain drag).
        units: [eqUnit, { ref: { kind: 'tool', id: tool.id, field: 'levels' }, role: 'levelItem', item }],
        straight,
        closed,
        allowSliders: true,
        // A constant on the equation is what levels are for: no `add` on Shift.
        virtual: ['factor', 'shiftVar', 'scaleVar'],
        shift,
        level: { value, equation: eq },
        twins: twins.units,
        twinNames: twins.names,
    };
}

function pointTarget(shape: HitShape, item: number, ctx: DragContext): DragTarget {
    const tool = toolById(shape.itemKey, ctx) as PointsTool | null;
    const name = tool ? tool.name : shape.source;
    const subject = item >= 0 ? `${name} point ${item + 1}` : name;
    const base = baseFrom(shape, subject);
    base.cardSource = name;
    base.cardField = 'points';
    base.points = shape.point ? [shape.point] : [];
    if (!tool || tool.type !== 'points') return locked(base, lockFor({ kind: 'nothing', subject }));
    if (shape.locked || tool.source !== 'list') {
        base.subject = name;
        return locked(base, computedLock(tool, shape.locked, ctx));
    }
    if (item < 0) return locked(base, lockFor({ kind: 'nothing', subject }));
    const ref: FieldRef = { kind: 'tool', id: tool.id, field: 'points' };
    return {
        ...base,
        kind: 'point',
        units: [
            { ref, role: 'tupleCoord', item, coord: 0 },
            { ref, role: 'tupleCoord', item, coord: 1 },
        ],
        allowSliders: true,
        virtual: [],
        shift: 'straight',
    };
}

function computedLock(tool: PointsTool, kind: HitShape['locked'], ctx: DragContext): Lock {
    const point = tool.name;
    const region = str(tool.regionName).trim();
    const k = kind || (tool.source === 'intersections' ? 'intersection' : tool.source === 'lattice' ? 'lattice' : tool.objective.trim() ? 'optimum' : 'corner');
    switch (k) {
        case 'optimum':
            return lockFor({
                kind: 'optimum',
                point,
                objective: str(tool.objective).trim(),
                region,
                sense: tool.sense === 'min' ? 'min' : 'max',
                twinCurve: twinCurveOf(str(tool.objective), ctx),
            });
        case 'intersection':
            return lockFor({ kind: 'intersection', point, a: str(tool.ref1).trim(), b: str(tool.ref2).trim() });
        case 'lattice':
            return lockFor({ kind: 'lattice', point, region: region || null });
        default:
            return lockFor({ kind: 'corner', point, region });
    }
}

function vertexTarget(shape: HitShape, index: number, item: number, ctx: DragContext): DragTarget {
    const tool = toolById(shape.itemKey, ctx) as SegmentTool | null;
    const name = tool ? tool.name : shape.source;
    const subject = `${name} point ${index + 1}`;
    const base = baseFrom(shape, subject);
    base.cardSource = name;
    base.cardField = 'path';
    base.points = shape.point ? [shape.point] : [];
    if (!tool || tool.type !== 'segment') return locked(base, lockFor({ kind: 'nothing', subject }));
    if (item < 0) {
        const from = splicedSource(str(tool.path), index, ctx);
        if (from) {
            const src = (ctx.tools || []).find((t) => t && t.type === 'points' && t.name === from) as PointsTool | undefined;
            return locked(base, lockFor({ kind: 'splicedVertex', segment: name, index: index + 1, from, fromIsList: !!src && src.source === 'list' }));
        }
        return locked(base, lockFor({ kind: 'nothing', subject }));
    }
    const ref: FieldRef = { kind: 'tool', id: tool.id, field: 'path' };
    return {
        ...base,
        kind: 'vertex',
        units: [
            { ref, role: 'tupleCoord', item, coord: 0 },
            { ref, role: 'tupleCoord', item, coord: 1 },
        ],
        allowSliders: true,
        virtual: [],
        shift: 'straight',
    };
}

function legTarget(shape: HitShape, hit: Hit, ctx: DragContext): DragTarget {
    const tool = toolById(shape.itemKey, ctx) as SegmentTool | null;
    const name = tool ? tool.name : shape.source;
    const base = baseFrom(shape, name);
    base.cardSource = name;
    base.cardField = 'path';
    base.run = hit.run;
    if (!tool || tool.type !== 'segment') return locked(base, lockFor({ kind: 'nothing', subject: name }));
    const path = str(tool.path);
    const items = parseTuples(path, true);
    const spliced = items.find((it) => it.kind === 'name');
    if (spliced && spliced.kind === 'name') return locked(base, lockFor({ kind: 'splicedPath', segment: name, from: spliced.name }));
    let pts: number[][];
    try {
        pts = ctx.math.tuples(path, 2);
    } catch {
        return locked(base, lockFor({ kind: 'nothing', subject: name }));
    }
    const ref: FieldRef = { kind: 'tool', id: tool.id, field: 'path' };
    const units: UnitSpec[] = [];
    pts.forEach((_, i) => {
        units.push({ ref, role: 'tupleCoord', item: i, coord: 0 });
        units.push({ ref, role: 'tupleCoord', item: i, coord: 1 });
    });
    return {
        ...base,
        kind: 'path',
        units,
        allowSliders: true,
        virtual: [],
        shift: 'turn',
        points: pts.map((p) => ({ x: p[0], y: p[1] })),
    };
}

function labelTarget(index: number, at: { x: number; y: number }, ctx: DragContext): DragTarget {
    const subject = `Label ${index + 1}`;
    const base = baseFrom(null, subject);
    base.key = `label:${index}`;
    base.source = `label:${index}`;
    base.cardSource = `label:${index}`;
    base.cardField = 'x';
    const a = (ctx.annotations || [])[index];
    if (!a) return locked(base, lockFor({ kind: 'nothing', subject }));
    const x = ctx.math.value(str(a.x), at.x);
    const y = ctx.math.value(str(a.y), at.y);
    base.points = [{ x, y }];
    return {
        ...base,
        kind: 'label',
        units: [
            { ref: { kind: 'label', index, field: 'x' }, role: 'value' },
            { ref: { kind: 'label', index, field: 'y' }, role: 'value' },
        ],
        // Labels never move sliders: a slider moved by a label would move the chart under it.
        allowSliders: false,
        virtual: ['add'],
        shift: 'straight',
    };
}

// ----------------------------------------------------------------- twins

/** Token texts of `src` inside [s, e), joined by one space (unicode operators normalized). */
function tokenText(src: string, s: number, e: number): { text: string; count: number } | null {
    let tokens;
    try {
        tokens = tokenize(src);
    } catch {
        return null;
    }
    const inside = tokens.filter((t) => t.kind !== 'end' && t.pos >= s && t.end <= e);
    return { text: inside.map((t) => t.text).join(' '), count: inside.length };
}

/** Span of the variable side of a curve equation (SPEC3 3.7), or null. */
export function variableSide(eq: string, math: MathContext): [number, number] | null {
    let root: Node;
    try {
        root = parse(eq, 'eq');
    } catch {
        return null;
    }
    const aliases = math.axisAliases;
    const isVar = (n: string) => aliases[0].includes(n) || aliases[1].includes(n);
    if (root.t === 'binary' && root.equation) {
        const l = readsName(root.left, isVar);
        const r = readsName(root.right, isVar);
        if (l === r) return null;
        const side = l ? root.left : root.right;
        return [side.s, side.e];
    }
    return [root.s, root.e];
}

/** Points-tool objectives with the same tokens as the variable side of `eq` (at least 3 tokens, one axis variable). */
export function findTwins(eq: string, ctx: DragContext): { units: UnitSpec[]; names: string[] } {
    const out = { units: [] as UnitSpec[], names: [] as string[] };
    const side = variableSide(eq, ctx.math);
    if (!side) return out;
    const want = tokenText(eq, side[0], side[1]);
    if (!want || want.count < 3) return out;
    for (const t of ctx.tools || []) {
        if (!t || t.type !== 'points' || t.dim === 3) continue;
        const obj = str(t.objective);
        if (!obj.trim()) continue;
        const got = tokenText(obj, 0, obj.length);
        if (got && got.text === want.text) {
            out.units.push({ ref: { kind: 'tool', id: t.id, field: 'objective' }, role: 'side' });
            out.names.push(t.name);
        }
    }
    return out;
}

/** The curve tool whose equation side is the same text as `objective` (optimum lock copy). */
function twinCurveOf(objective: string, ctx: DragContext): string | null {
    const got = tokenText(objective, 0, objective.length);
    if (!got || got.count < 3) return null;
    for (const t of ctx.tools || []) {
        if (!t || t.type !== 'curve') continue;
        const eq = str(t.equation);
        const side = variableSide(eq, ctx.math);
        if (!side) continue;
        const want = tokenText(eq, side[0], side[1]);
        if (want && want.text === got.text) return t.name;
    }
    return null;
}

// ---------------------------------------------------------- shared sliders

/** Other items that read slider `name` (functions, tools, labels), by display name. */
export function sliderUsers(name: string, t: DragTarget, ctx: DragContext): string[] {
    const users: string[] = [];
    const math = ctx.math;
    const reads = (text: unknown, template: boolean): boolean => {
        const s = str(text);
        if (!s.trim()) return false;
        if (!template) return math.deps(s).params.includes(name);
        const tokens = identifierTokens(s, true) || [];
        return tokens.some((tok) => tok.text === name || math.deps(tok.text).params.includes(name));
    };
    const ownFn = t.kind === 'graph' || t.kind === 'tangent' ? t.cardSource : null;
    for (const f of ctx.functions || []) {
        if (!f || f.name === ownFn) continue;
        const texts = [f.expression, f.parametric ? f.expressionY : '', f.domain, f.tangent ? f.tangentPoint : ''];
        if (texts.some((x) => reads(x, false))) users.push(str(f.name));
    }
    const ownTool = t.units.length && t.units[0].ref.kind === 'tool' ? t.units[0].ref.id : null;
    for (const tool of ctx.tools || []) {
        if (!tool || tool.id === ownTool) continue;
        let plain: unknown[] = [];
        let templates: unknown[] = [];
        switch (tool.type) {
            case 'region':
                plain = tool.conditions || [];
                templates = [tool.label, ...(tool.conditionLabels || [])];
                break;
            case 'curve':
                plain = [tool.equation, tool.levels];
                templates = [tool.label];
                break;
            case 'points':
                plain = [tool.source === 'list' ? tool.points : '', tool.objective];
                templates = [tool.label];
                break;
            case 'segment':
                plain = [tool.path];
                templates = [tool.label];
                break;
            default:
                break;
        }
        if (plain.some((x) => reads(x, false)) || templates.some((x) => reads(x, true))) users.push(tool.name);
    }
    (ctx.annotations || []).forEach((a, i) => {
        if (!a || (t.kind === 'label' && t.cardSource === `label:${i}`)) return;
        if (reads(a.x, false) || reads(a.y, false) || reads(a.text, true)) users.push(`Label ${i + 1}`);
    });
    return users;
}

// --------------------------------------------------------------- private

function str(v: unknown): string {
    if (typeof v === 'string') return v;
    return typeof v === 'number' ? String(v) : '';
}

function baseFrom(shape: HitShape | null, subject: string): DragTarget {
    return {
        key: shape ? shape.key : '',
        source: shape ? shape.source : subject,
        subject,
        kind: 'graph',
        units: [],
        straight: false,
        closed: false,
        allowSliders: true,
        virtual: [],
        shift: 'none',
        lock: null,
        lines: shape ? shape.lines : [],
        run: -1,
        points: shape && shape.point ? [shape.point] : [],
        twins: [],
        cardSource: shape ? shape.source : subject,
        cardField: '',
    };
}

function locked(t: DragTarget, lock: Lock): DragTarget {
    return { ...t, lock, units: [], virtual: [], shift: 'none', twins: [] };
}

function toolById(id: string, ctx: DragContext): Tool | null {
    return (ctx.tools || []).find((t) => t && t.id === id) || null;
}

function straightGraph(expression: string, math: MathContext): boolean {
    try {
        return linearForm(parse(expression), math.envFor('fn1', 'cartesian')) !== null;
    } catch {
        return false;
    }
}

/** The grabbed polyline's ends lie within 1 px. */
function closedRun(lines: Pt[][], run: number, ctx: DragContext): boolean {
    const line = run >= 0 ? lines[run] : lines.length === 1 ? lines[0] : null;
    if (!line || line.length < 3) return false;
    const a = line[0];
    const b = line[line.length - 1];
    return Math.hypot((a.x - b.x) * ctx.map.kx, (a.y - b.y) * ctx.map.ky) <= CLOSED_PX;
}

function nearestRun(lines: Pt[][], p: Pt, ctx: DragContext): number {
    let best = -1;
    let bestD = Infinity;
    lines.forEach((line, i) => {
        for (const q of line) {
            const d = Math.hypot((q.x - p.x) * ctx.map.kx, (q.y - p.y) * ctx.map.ky);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
    });
    return best;
}

function children(n: Node): Node[] {
    switch (n.t) {
        case 'call':
            return n.args;
        case 'unary':
            return [n.arg];
        case 'binary':
        case 'logic':
            return [n.left, n.right];
        case 'cmp':
            return n.args;
        case 'ternary':
            return [n.test, n.then, n.else];
        default:
            return [];
    }
}

function readsName(n: Node, pred: (name: string) => boolean): boolean {
    if (n.t === 'name' && pred(n.name)) return true;
    if (n.t === 'call' && !n.math && pred(n.name)) return true;
    return children(n).some((c) => readsName(c, pred));
}

/** Middle arguments of comparison chains with two or more operators (SPEC3 2.1 frozen nodes). */
function frozenMiddles(text: string): Set<Node> {
    const out = new Set<Node>();
    let root: Node;
    try {
        root = parse(text, 'cond');
    } catch {
        return out;
    }
    const walk = (n: Node) => {
        if (n.t === 'cmp' && n.args.length >= 3) for (let i = 1; i < n.args.length - 1; i++) out.add(n.args[i]);
        children(n).forEach(walk);
    };
    walk(root);
    return out;
}

/** `y op f1` or `y op f1(x)` (either order): the function whose graph the clause edge is, else null. */
function graphOfClause(lhs: Node, rhs: Node, ctx: DragContext): string | null {
    const [xs, ys] = ctx.math.axisAliases;
    const fns = new Set((ctx.functions || []).map((f) => f && f.name));
    const isY = (n: Node) => n.t === 'name' && ys.includes(n.name);
    const fnOf = (n: Node): string | null => {
        if (n.t === 'name' && fns.has(n.name)) return n.name;
        if (n.t === 'call' && !n.math && fns.has(n.name) && n.args.length === 1) {
            const a = n.args[0];
            return a.t === 'name' && xs.includes(a.name) ? n.name : null;
        }
        return null;
    };
    if (isY(lhs)) return fnOf(rhs);
    if (isY(rhs)) return fnOf(lhs);
    return null;
}

/** What a clause reads: literals, usable sliders, user functions, derived names. */
function scanNodes(nodes: Node[], ctx: DragContext): { numbers: boolean; sliders: string[]; functions: string[]; derived: string[] } {
    const out = { numbers: false, sliders: [] as string[], functions: [] as string[], derived: [] as string[] };
    const params = new Set((ctx.parameters || []).map((p) => p && p.name));
    const fns = new Set((ctx.functions || []).map((f) => f && f.name));
    const add = (list: string[], v: string) => {
        if (!list.includes(v)) list.push(v);
    };
    const walk = (n: Node) => {
        if (n.t === 'num') out.numbers = true;
        if (n.t === 'name' || (n.t === 'call' && !n.math)) {
            if (params.has(n.name) && !ctx.axisSliders.has(n.name)) add(out.sliders, n.name);
            else if (fns.has(n.name)) add(out.functions, n.name);
            else if (DERIVED_RE.test(n.name)) add(out.derived, n.name);
        }
        children(n).forEach(walk);
    };
    nodes.forEach(walk);
    return out;
}

/** A value text that only reads derived names (no number, no usable slider): the first derived name. */
function onlyDerived(text: string, ctx: DragContext): { name: string; tool: string } | null {
    let root: Node;
    try {
        root = parse(text);
    } catch {
        return null;
    }
    const scan = scanNodes([root], ctx);
    if (scan.numbers || scan.sliders.length || !scan.derived.length) return null;
    return { name: scan.derived[0], tool: derivedTool(scan.derived[0]) };
}

function derivedTool(name: string): string {
    const m = DERIVED_RE.exec(name);
    return m ? m[1] : name;
}

function levelValue(levels: string, item: number, math: MathContext): number {
    try {
        const vals = math.values(levels);
        if (item < vals.length) return vals[item];
    } catch {
        // Fall back to the single item (another item may not resolve).
    }
    const parts = splitTopLevel(levels);
    return item < parts.length ? math.value(parts[item]) : NaN;
}

function splitTopLevel(src: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
            out.push(src.slice(start, i));
            start = i + 1;
        }
    }
    out.push(src.slice(start));
    return out;
}

/** Name of the points tool spliced in at drawn vertex `index` of a path, or null. */
function splicedSource(path: string, index: number, ctx: DragContext): string | null {
    let items;
    try {
        items = parseTuples(path, true);
    } catch {
        return null;
    }
    const derived = ctx.math.derivedValues();
    let k = 0;
    let lastName: string | null = null;
    for (const it of items) {
        if (it.kind === 'tuple') {
            if (k === index) return null;
            k++;
            continue;
        }
        lastName = it.name;
        const nRaw = derived[`${it.name}_n`];
        const n = typeof nRaw === 'number' && Number.isFinite(nRaw) ? Math.max(0, Math.round(nRaw)) : ctx.hits.points().filter((h) => h.source === it.name).length;
        if (index < k + n) return it.name;
        k += n;
    }
    return lastName;
}
