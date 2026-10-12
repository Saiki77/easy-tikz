/*
 * Drag session (SPEC3 1.2, 1.3, 1.7, 2.3 to 2.7, 3.6, 3.7, 4.5): prepare a
 * target for a gesture (private context, units, numbers, evaluator, shape,
 * plan, pivot, hover chip), then turn pointer events into frames of field
 * texts and slider values (cursor pre-processing, solve, orientation guard,
 * quantization, rewrite with the safety net, twins), and finally a commit
 * (patches, undo label, Make slider offer) or a cancel (start state).
 * Pure: no DOM, no Obsidian. Nothing here throws into the pointer handler.
 */
import { Node, parse, tokenize } from '../expr';
import { MathContext } from '../mathcontext';
import type { DerivedValues } from '../mathcontext';
import { findExtrema1D } from '../math';
import type { Parameter } from '../types';
import { compileNumbers, discoverNumbers, outputSide, parseUnit, previewFields, rewriteUnits } from './numbers';
import type { Evaluator, ParsedUnit, RewrittenField, TwinInput } from './numbers';
import { buildShape } from './shapes';
import type { ShapeModel } from './shapes';
import { applyFamily, boundsFor, fromPx, planDrag, quantizeDrag, solveDrag, toPx } from './solver';
import type { Bounds, DragPlan, DragProblem, Family } from './solver';
import { choosePivot, pivotCandidates, pivotServes } from './pivot';
import type { GraphForm } from './pivot';
import { dragAnnouncement, hoverChip, liveChip, lockFor, noPivotLockFor, shiftLockFor, undoLabel } from './describe';
import type { HoverInfo, LiveStatus } from './describe';
import { fieldText, refKey, sliderUsers, variableSide } from './targets';
import type {
    Chip,
    DragCommit,
    DragContext,
    DragFrame,
    DragNumber,
    DragTarget,
    FieldEdit,
    FieldPatch,
    FieldRef,
    Gesture,
    HitShape,
    Lock,
    MakeSliderOffer,
    Mods,
    ParamEdit,
    ParamPatch,
    Pt,
    ScreenMap,
    UnitSpec,
} from './types';

// ------------------------------------------------------------- constants

/** Similarity unit R and stretch units U never go below these (px), SPEC3 2.3. */
const MIN_R_PX = 40;
const MIN_U_PX = 24;
/** Turns and resizes ignore cursor moves this close (px) to the pivot. */
const PIVOT_DEAD_PX = 12;
/** Snap within / release beyond (px), SPEC3 1.7. */
const SNAP_IN_PX = 8;
const SNAP_OUT_PX = 12;
const GRID_IN_PX = 6;
const GRID_OUT_PX = 9;
/** Within this distance (px) of the grab no snap applies (dragging back restores the start text). */
const AT_GRAB_PX = 2;
/** Shift on point-like targets: direction decided after this many px, kept within 22.5 + 4 degrees. */
const STRAIGHT_DECIDE_PX = 6;
const STRAIGHT_HYST_DEG = 4;
/** Turn detents: directions (p, q) with |p|, |q| <= 6 in math units, within 1.5 degrees on screen. */
const DETENT_MAX = 6;
const DETENT_DEG = 1.5;
/** A detent counts as reachable when the solve to it ends this close (px): exact directions solve far below it. */
const DETENT_EXACT_PX = 0.05;
/** Stretch detents and the axis magnet. */
const STRETCH_DETENTS = [1, -1, 0.5, 2];
const STRETCH_DETENT_REL = 0.03;
const MAGNET_PX = 8;
const SCALE_MIN = 0.05;
const SCALE_MAX = 20;
/** Functions turn at most this far from horizontal on screen. */
const MAX_GRAPH_DEG = 89;

const DEG = Math.PI / 180;

// ------------------------------------------------------------------ core

interface TwinLink {
    ref: FieldRef;
    key: string;
    name: string;
    /** Index of the equation unit the twin mirrors. */
    unit: number;
    /** Twin text at core start and the span of its expression. */
    text: string;
    side: [number, number];
    /** The equation field and its variable side at core start. */
    eqKey: string;
    eqSide: [number, number];
}

interface FieldInfo {
    ref: FieldRef;
    key: string;
    text: string;
}

/** Everything planned for one (target, gesture, pivot), from the texts and slider values at its start. */
interface Core {
    target: DragTarget;
    gesture: Gesture;
    /** Shift on a point-like target: translate with the 8-direction snap. */
    straightMove: boolean;
    grab: Pt;
    grabPx: Pt;
    math: MathContext;
    specs: UnitSpec[];
    units: ParsedUnit[];
    numbers: DragNumber[];
    ev: Evaluator;
    value0: Float64Array;
    lines: Pt[][];
    points: Pt[];
    shape: ShapeModel;
    family: Family;
    problem: DragProblem;
    plan: DragPlan;
    bounds: Bounds;
    pivot: Pt | null;
    /** A pivot gesture found no pivot for this grab (Shift moves; the lock says why). */
    noPivot: boolean;
    /** Unit fields at core start, in unit order (deduplicated). */
    fields: FieldInfo[];
    twins: TwinLink[];
    samples: Pt[][];
    shiftLock: Lock | null;
    /** Screen direction (px, unit) of a straight object, for detents, the 89 degree clamp and line snapping. */
    lineDir: Pt | null;
    /** Graph Move: the extremum of the grabbed run nearest the grab (grid snapping). */
    anchor: Pt | null;
    /** Tangent: x range the tangent point may slide in. */
    slideRange: [number, number] | null;
    info: HoverInfo;
    chip: Chip;
}

interface CoreOpts {
    pivot?: Pt;
    texts?: ReadonlyMap<string, string>;
    params?: ReadonlyMap<string, number>;
    derived?: DerivedValues;
    lines?: Pt[][];
    points?: Pt[];
}

function pointLike(t: DragTarget): boolean {
    return t.kind === 'point' || t.kind === 'vertex' || t.kind === 'label';
}

/** Units a gesture edits: a level's item on plain drag, its equation on Shift. */
function specsFor(t: DragTarget, gesture: Gesture): UnitSpec[] {
    if (t.kind === 'level') {
        const eq = t.units.find((u) => u.role === 'equation');
        const item = t.units.find((u) => u.role === 'levelItem');
        const one = gesture === 'move' ? item : eq;
        return one ? [one] : [];
    }
    return t.units;
}

function dist2(a: Pt, b: Pt): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function unitSpan(u: ParsedUnit): [number, number] {
    if (u.sides) return [Math.min(u.sides.lhs.s, u.sides.rhs.s), Math.max(u.sides.lhs.e, u.sides.rhs.e)];
    return [u.owned.s, u.owned.e];
}

function buildCore(target: DragTarget, grab: Pt, gesture: Gesture, ctx: DragContext, opts: CoreOpts): { core: Core } | { lock: Lock } {
    if (target.lock) return { lock: target.lock };
    const nothing = (): { lock: Lock } => ({ lock: lockFor({ kind: 'nothing', subject: target.subject }) });
    const specs = specsFor(target, gesture);
    if (!specs.length) return nothing();

    // Private context: never the memoized one, derived names frozen at drag start.
    const math = new MathContext(ctx.mathInput);
    math.setParams(ctx.parameters || []);
    if (opts.params && opts.params.size) {
        const vals: Record<string, number> = {};
        opts.params.forEach((v, k) => (vals[k] = v));
        math.setParamValues(vals);
    }
    math.setDerived(opts.derived || ctx.math.derivedValues());

    const readText = (ref: FieldRef): string | null => {
        const k = refKey(ref);
        if (opts.texts && opts.texts.has(k)) return opts.texts.get(k) as string;
        return fieldText(ref, ctx);
    };
    const units: ParsedUnit[] = [];
    for (const spec of specs) {
        const text = readText(spec.ref);
        if (text === null) return nothing();
        const u = parseUnit(spec, text, math);
        if (!u) return nothing();
        units.push(u);
    }

    const sliders = new Map<string, Parameter>();
    for (const p of ctx.parameters || []) {
        if (!p || ctx.axisSliders.has(p.name)) continue;
        const v = opts.params && opts.params.has(p.name) ? (opts.params.get(p.name) as number) : p.value;
        sliders.set(p.name, { ...p, value: v });
    }
    const pushOrSlide = (target.kind === 'level' && gesture === 'move') || target.kind === 'tangent';
    const virtual = pushOrSlide ? [] : target.virtual;
    const numbers = discoverNumbers(units, { sliders, allowSliders: target.allowSliders, virtual });

    const noNumbersLock = (): { lock: Lock } => {
        // Why nothing can change: an axis slider, a derived level, or no numbers at all.
        const axis: string[] = [];
        for (const u of units) {
            for (const p of math.deps(u.text.slice(unitSpan(u)[0], unitSpan(u)[1])).params) if (ctx.axisSliders.has(p)) axis.push(p);
        }
        if (axis.length && target.allowSliders) return { lock: lockFor({ kind: 'axisSlider', name: axis[0] }) };
        if (target.kind === 'level' && gesture === 'move' && target.level) {
            const u = units[0];
            const d = math.deps(u.text.slice(unitSpan(u)[0], unitSpan(u)[1])).derived;
            if (d.length) {
                const m = /^(.+)_(x|y|z|val|n)(\d*)$/.exec(d[0]);
                return { lock: lockFor({ kind: 'derivedLevel', curve: target.cardSource, name: d[0], tool: m ? m[1] : d[0] }) };
            }
        }
        return nothing();
    };
    if (!numbers.length) return noNumbersLock();

    const ev = compileNumbers(units, numbers, math);
    const value0 = Float64Array.from(numbers.map((n) => n.value0));
    ev.values.set(value0);
    ev.apply();

    const map = ctx.map;
    // A level's value and equation as the texts read now (a re-base after a push or a reshape), not as
    // they were when the target was resolved.
    const level = target.level ? currentLevel(target, readText, math) : undefined;
    const base: DragTarget = level ? { ...target, level } : target;
    const tgt: DragTarget = opts.lines
        ? { ...base, lines: opts.lines, run: opts.lines.length === 1 ? 0 : -1, points: opts.points || target.points }
        : opts.points
        ? { ...base, points: opts.points }
        : base;
    const lines = opts.lines || (target.kind === 'graph' && target.run >= 0 && target.lines[target.run] ? [target.lines[target.run]] : target.lines);
    const points = opts.points || target.points;

    // Fixed closures of push and slide shapes.
    let fixedF: ((x: number, y: number) => number) | undefined;
    let fixedf: ((x: number) => number) | undefined;
    let slideRange: [number, number] | null = null;
    if (target.kind === 'level' && gesture === 'move' && target.level) {
        const eqRef = target.units.find((u) => u.role === 'equation');
        const eqText = eqRef ? readText(eqRef.ref) : null;
        try {
            fixedF = eqText !== null ? math.equation(eqText).F : undefined;
        } catch {
            fixedF = undefined;
        }
        if (!fixedF) return nothing();
    }
    if (target.kind === 'tangent' && target.fn) {
        const info = math.functionInfo(target.fn);
        if (!info) return nothing();
        fixedf = info.fn;
        const d = info.domain;
        slideRange = [Math.max(d ? d[0] : -Infinity, map.view.xmin), Math.min(d ? d[1] : Infinity, map.view.xmax)];
    }

    const shapeUnits = specs.map((_, i) => i);
    const grabPx = toPx(grab, map);
    const straightMove = gesture === 'pivot' && (pointLike(target) || target.shift === 'straight');
    // Points moved straight plan like a plain Move (the 8-direction snap is cursor pre-processing).
    const effGesture: Gesture = straightMove ? 'move' : gesture;

    const planFor = (family: Family, g: Gesture) => {
        const shape = buildShape({
            kind: target.kind,
            ev,
            units: shapeUnits,
            lines,
            points,
            map,
            F: fixedF,
            levelValue: target.kind === 'level' && gesture === 'pivot' && level ? level.value : undefined,
            f: fixedf,
            family,
        });
        const problem: DragProblem = { numbers, ev, shape, family, map, grab: grabPx, gesture: g };
        ev.values.set(value0);
        ev.apply();
        const plan = planDrag(problem);
        ev.values.set(value0);
        ev.apply();
        return { shape, problem, plan };
    };

    // Family and pivot.
    let family: Family;
    let pivot: Pt | null = null;
    let shiftLock: Lock | null = null;
    let noPivot = false;
    // A level's plain drag pushes its item; on Shift the units are the equation, which translates.
    const moveFamily = (): Family =>
        target.kind === 'level' && gesture === 'move' ? { kind: 'push' } : target.kind === 'tangent' ? { kind: 'slide' } : { kind: 'translate' };
    if (gesture === 'move' || straightMove || target.shift === 'none' || target.kind === 'tangent') {
        family = moveFamily();
    } else {
        const about = (at: Pt): Family => familyAbout(target, at, grabPx, map);
        if (opts.pivot) pivot = opts.pivot;
        else {
            const natural: Array<{ at: Pt; tier: number }> = [];
            if (target.straight) {
                const r = planFor({ kind: 'translate' }, 'pivot');
                for (const n of r.plan.naturalPivots || []) {
                    const num = numbers[n.number];
                    if (num) natural.push({ at: n.at, tier: num.tier });
                }
            }
            const f0 = ev.fns[0];
            const shapeFns: {
                f?: (x: number) => number;
                G?: (x: number, y: number) => number;
                graph?: GraphForm | null;
                natural: Array<{ at: Pt; tier: number }>;
            } = { natural };
            if (target.kind === 'graph') shapeFns.f = (x) => f0(x, NaN);
            else if (target.kind === 'level' && level) {
                const L = level.value;
                shapeFns.G = (x, y) => f0(x, y) - L;
            } else shapeFns.G = (x, y) => f0(x, y);
            const graphForm = target.kind !== 'graph' && !target.straight && !target.closed ? graphFormOf(units, shapeFns.G, grab) : null;
            shapeFns.graph = graphForm;
            const cands = pivotCandidates(tgt, grab, ctx, shapeFns);
            const cost =
                target.shift === 'stretch'
                    ? (at: Pt): number => {
                          // planDrag charges 1000 per family direction the numbers cannot achieve.
                          const r = planFor(about(at), 'pivot');
                          return r.plan.rowsLocked ? Infinity : r.plan.cost;
                      }
                    : null;
            const axis = target.shift === 'stretch' ? stretchAxisOf(target, units, graphForm, grab, map, shapeFns.G) : null;
            const choice = choosePivot(cands, grab, ctx, cost, axis ? axis.axis : null, !!axis && axis.guessed);
            pivot = choice ? choice.at : null;
        }
        if (pivot) family = about(pivot);
        else {
            // The numbers could change the shape; no candidate is far enough from this grab (every one within
            // 12 px, out of view, or level with it along the stretched axis).
            family = moveFamily();
            shiftLock = noPivotLockFor(target);
            noPivot = true;
        }
    }

    const { shape, problem, plan } = planFor(family, effGesture);
    const moveLike = family.kind === 'translate' || family.kind === 'push' || family.kind === 'slide';
    if (moveLike && plan.rmax === 0 && !shiftLock) return noNumbersLock();
    if (moveLike && plan.rowsLocked && !shiftLock) return { lock: lockFor({ kind: 'cannotDragHere', subject: target.subject }) };
    if (!moveLike && (plan.restricted !== 'none' || plan.rmax < 2 || plan.rowsLocked)) shiftLock = shiftLockFor(target, noTermOf(target, units, math));

    // Bounds: sliders stay inside their ranges, on min + k * step.
    const bounds: Bounds = boundsFor(numbers);

    // Fields (unit order, deduplicated) and twins.
    const fields: FieldInfo[] = [];
    units.forEach((u) => {
        const key = refKey(u.spec.ref);
        if (!fields.some((f) => f.key === key)) fields.push({ ref: u.spec.ref, key, text: u.text });
    });
    const twins: TwinLink[] = [];
    const eqIndex = units.findIndex((u) => u.spec.role === 'equation');
    const eqUnit = eqIndex >= 0 ? units[eqIndex] : null;
    if (eqUnit && target.twins.length) {
        const eqSide = variableSide(eqUnit.text, math);
        if (eqSide) {
            target.twins.forEach((tw, i) => {
                const text = readText(tw.ref);
                if (text === null) return;
                let root: Node;
                try {
                    root = parse(text);
                } catch {
                    return;
                }
                twins.push({
                    ref: tw.ref,
                    key: refKey(tw.ref),
                    name: (target.twinNames && target.twinNames[i]) || '',
                    unit: eqIndex,
                    text,
                    side: [root.s, root.e],
                    eqKey: refKey(eqUnit.spec.ref),
                    eqSide,
                });
            });
        }
    }

    const samplePts = shape.samples().slice();
    const samples = units.map(() => samplePts);
    const lineDir = target.straight ? lineDirPx(lines, map) : null;
    let anchor: Pt | null = null;
    if (target.kind === 'graph' && gesture === 'move' && lines.length) {
        const f0 = ev.fns[0];
        const run = lines[0];
        let lo = Infinity;
        let hi = -Infinity;
        for (const p of run) {
            lo = Math.min(lo, p.x);
            hi = Math.max(hi, p.x);
        }
        if (hi > lo) {
            const ext = findExtrema1D((x) => f0(x, NaN), lo, hi);
            let best: Pt | null = null;
            for (const e of ext) if (!best || dist2(e, grab) < dist2(best, grab)) best = { x: e.x, y: e.y };
            anchor = best;
        }
    }

    const core: Core = {
        target: tgt,
        gesture,
        straightMove,
        grab,
        grabPx,
        math,
        specs,
        units,
        numbers,
        ev,
        value0,
        lines,
        points,
        shape,
        family,
        problem,
        plan,
        bounds,
        pivot,
        noPivot,
        fields,
        twins,
        samples,
        shiftLock,
        lineDir,
        anchor,
        slideRange,
        info: null as unknown as HoverInfo,
        chip: null as unknown as Chip,
    };
    core.info = hoverInfo(core, ctx);
    core.chip = hoverChip(core.info, ctx.keyNames);
    return { core };
}

/** A level target's value (its levels item evaluated) and equation, from the texts read now. */
function currentLevel(t: DragTarget, readText: (ref: FieldRef) => string | null, math: MathContext): { value: number; equation: string } {
    const lv = t.level as { value: number; equation: string };
    const eqSpec = t.units.find((u) => u.role === 'equation');
    const itemSpec = t.units.find((u) => u.role === 'levelItem');
    const eq = eqSpec ? readText(eqSpec.ref) : null;
    let value = lv.value;
    const items = itemSpec ? readText(itemSpec.ref) : null;
    if (itemSpec && items !== null) {
        const u = parseUnit(itemSpec, items, math);
        if (u) {
            const v = math.value(items.slice(u.owned.s, u.owned.e), NaN);
            if (Number.isFinite(v)) value = v;
        }
    }
    return { value, equation: eq ?? lv.equation };
}

/**
 * Graph form (lead decision on SPEC3 D4) of a clause or equation unit, solved for its output variable: the
 * output side is a lone, optionally signed axis variable and the other side does not mention it, so G is
 * affine in the output coordinate and `f(input)` is its zero. Checked numerically at the grab as well (an
 * implicit call such as `x >= f1` may hide the variable). Null otherwise.
 */
function graphFormOf(units: readonly ParsedUnit[], G: ((x: number, y: number) => number) | undefined, grab: Pt): GraphForm | null {
    if (!G) return null;
    const u = units.find((v) => v.spec.role === 'clause' || v.spec.role === 'equation');
    const out = u ? outputSide(u) : null;
    if (!u || !out) return null;
    const names = u.vars[out.axis] || [];
    let mentions = false;
    const walk = (n: Node) => {
        if (mentions) return;
        if (n.t === 'name' && names.includes(n.name)) mentions = true;
        else children(n).forEach(walk);
    };
    walk(out.other);
    if (mentions) return null;
    const axis = out.axis;
    const at = (w: number, v: number) => (axis === 1 ? G(w, v) : G(v, w));
    const f = (w: number): number => {
        const g0 = at(w, 0);
        const d = at(w, 1) - g0;
        return Number.isFinite(d) && d !== 0 ? -g0 / d : NaN;
    };
    const w0 = axis === 1 ? grab.x : grab.y;
    for (const w of [w0, w0 + 1]) {
        const g0 = at(w, 0);
        const g1 = at(w, 1);
        const g2 = at(w, 2);
        if (!Number.isFinite(g0 + g1 + g2) || Math.abs(g2 - 2 * g1 + g0) > 1e-9 * (1 + Math.abs(g0) + Math.abs(g1) + Math.abs(g2))) return null;
    }
    return { f, axis };
}

/**
 * The axis a stretch of `t` acts on (0 = x, 1 = y), so the pivot never leaves it dead (pivot.ts): graphs
 * stretch vertically; a clause or equation in graph form along its output variable (`x >= y^2`: x); any other
 * implicit curve along the larger component of its screen normal at the grab (the way a drag across it goes).
 * `guessed` marks that last case: the pivot should then keep both axes live where it can.
 */
function stretchAxisOf(
    t: DragTarget,
    units: readonly ParsedUnit[],
    graphForm: GraphForm | null,
    grab: Pt,
    map: DragContext['map'],
    G: ((x: number, y: number) => number) | undefined
): { axis: 0 | 1; guessed: boolean } | null {
    if (t.kind === 'graph') return { axis: 1, guessed: false };
    if (graphForm) return { axis: graphForm.axis, guessed: false };
    const u = units.find((v) => v.spec.role === 'clause' || v.spec.role === 'equation');
    const out = u ? outputSide(u) : null;
    if (out) return { axis: out.axis, guessed: false };
    if (!G) return null;
    const hx = 1e-6 * (1 + Math.abs(grab.x));
    const hy = 1e-6 * (1 + Math.abs(grab.y));
    const gx = (G(grab.x + hx, grab.y) - G(grab.x - hx, grab.y)) / (2 * hx) / map.kx;
    const gy = (G(grab.x, grab.y + hy) - G(grab.x, grab.y - hy)) / (2 * hy) / map.ky;
    if (!Number.isFinite(gx) || !Number.isFinite(gy) || (gx === 0 && gy === 0)) return null;
    return { axis: Math.abs(gy) >= Math.abs(gx) ? 1 : 0, guessed: true };
}

/** The family of a pivot gesture about `at` (math), SPEC3 2.3. */
function familyAbout(t: DragTarget, at: Pt, grabPx: Pt, map: DragContext['map']): Family {
    const P = toPx(at, map);
    if (t.shift === 'stretch') {
        const dx = Math.abs(grabPx.x - P.x);
        const dy = Math.abs(grabPx.y - P.y);
        // A dead axis (grab within 24 px of the pivot along it) keeps factor 1 in the family itself, so no
        // number can drift with its member (stretch() also keeps the cursor's factor at 1).
        return { kind: 'stretch', pivot: P, ux: Math.max(dx, MIN_U_PX), uy: Math.max(dy, MIN_U_PX), liveX: dx >= MIN_U_PX, liveY: dy >= MIN_U_PX };
    }
    const unit = Math.max(dist2(grabPx, P), MIN_R_PX);
    // Lines: the scale part is invisible. Closed curves resize uniformly about their centre (an axis-aligned
    // ellipse, or a math circle under unequal axis scales, cannot turn with its numbers); legs turn and resize.
    const turnOnly = t.shift === 'turn' && t.kind !== 'path';
    if (t.shift === 'resize') return { kind: 'similar', pivot: P, unit, turnOnly: false, scaleOnly: true };
    return { kind: 'similar', pivot: P, unit, turnOnly };
}

/** `x <= 4` cannot turn: it has no y term (SPEC3 1.8). */
function noTermOf(t: DragTarget, units: ParsedUnit[], math: MathContext): { text: string; variable: string } | null {
    if (!t.straight || t.shift !== 'turn' || t.kind === 'graph' || !units.length) return null;
    const u = units[0];
    const [s, e] = unitSpan(u);
    const aliases = math.axisAliases;
    let tokens;
    try {
        tokens = tokenize(u.text.slice(s, e));
    } catch {
        return null;
    }
    const has = (k: 0 | 1) => tokens.some((tk) => tk.kind === 'id' && aliases[k].includes(tk.text));
    const name = (k: 0 | 1) => aliases[k][aliases[k].length - 1];
    const text = u.text.slice(s, e).replace(/\s+/g, ' ').trim();
    if (!has(1)) return { text, variable: name(1) };
    if (!has(0)) return { text, variable: name(0) };
    return null;
}

function lineDirPx(lines: Pt[][], map: DragContext['map']): Pt | null {
    let best: Pt | null = null;
    let bestLen = 0;
    for (const l of lines) {
        if (l.length < 2) continue;
        const a = l[0];
        const b = l[l.length - 1];
        const dx = (b.x - a.x) * map.kx;
        const dy = (b.y - a.y) * map.ky;
        const len = Math.hypot(dx, dy);
        if (len > bestLen) {
            bestLen = len;
            best = { x: dx / len, y: dy / len };
        }
    }
    return best;
}

// ------------------------------------------------------------- hover info

function hoverInfo(core: Core, ctx: DragContext): HoverInfo {
    const t = core.target;
    // Display text: the unit fields joined by ', ' (labels: x, y).
    let text = '';
    const offsets = new Map<string, number>();
    core.fields.forEach((f, i) => {
        if (i > 0) text += ', ';
        offsets.set(f.key, text.length);
        text += f.text;
    });
    const offOf = (unit: number): number => {
        const u = core.units[unit];
        return u ? offsets.get(refKey(u.spec.ref)) || 0 : 0;
    };
    const numSpans: Array<[number, number]> = [];
    const ghosts: Array<{ at: number; text: string }> = [];
    const kinds: string[] = [];
    const sharedSliders: Array<{ name: string; users: string[] }> = [];
    const twinTouch = new Set<number>();
    const active = core.shiftLock ? [] : core.plan.active;
    for (const i of active) {
        const n = core.numbers[i];
        if (!n) continue;
        if ((n.kind === 'literal' || n.kind === 'folded') && n.span) {
            const off = offOf(n.unit);
            numSpans.push([off + n.span[0], off + n.span[1]]);
            touchTwins(core, n.unit, n.span[0], twinTouch);
        } else if (n.kind === 'slider' && n.param) {
            const name = n.param.name;
            core.units.forEach((u, k) => {
                const off = offOf(k);
                for (const [a, b] of sliderSpans(u, name)) {
                    if (!numSpans.some(([x, y]) => x === off + a && y === off + b)) numSpans.push([off + a, off + b]);
                }
            });
            const users = sliderUsers(name, t, ctx);
            if (users.length) sharedSliders.push({ name, users });
        } else if (n.kind === 'virtual' && n.virtual) {
            if (!core.units[n.unit]) continue;
            const kind = n.virtual.kind;
            if (!kinds.includes(kind)) kinds.push(kind);
            touchTwins(core, n.unit, n.pos, twinTouch);
        }
    }
    // Ghosts: exactly the structure the rewriter would insert (parentheses, every occurrence), with the
    // placeholders k, a, h, s for the numbers (SPEC3 1.8).
    if (kinds.length) {
        try {
            for (const f of previewFields(core.units, core.numbers, active)) {
                const off = offsets.get(refKey(f.ref)) || 0;
                for (const g of f.ghosts) ghosts.push({ at: off + g.at, text: g.text });
            }
        } catch {
            // No ghosts: the chip still names the numbers and the note says what is added.
        }
    }
    const twins = core.twins.filter((_, i) => twinTouch.has(i)).map((tw) => tw.name).filter((s) => !!s);
    return {
        target: t,
        gesture: core.gesture,
        text,
        numSpans: numSpans.sort((a, b) => a[0] - b[0]),
        ghosts,
        virtualKinds: kinds,
        restricted: core.plan.restricted,
        pivot: core.pivot && !core.shiftLock ? { at: core.pivot } : null,
        sharedSliders,
        twins,
        passed: t.passed || null,
        shiftLock: core.shiftLock,
    };
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

/**
 * Spans of a slider's occurrences in a unit, each widened to its product chain when every other
 * factor is a literal: in `(a, 2a)` the whole `2a` belongs to the slider (SPEC3 2.2).
 */
function sliderSpans(u: ParsedUnit, name: string): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const roots = u.sides ? [u.sides.lhs, u.sides.rhs] : [u.owned];
    const isOcc = (n: Node) => (n.t === 'name' && n.name === name) || (n.t === 'call' && !n.math && n.name === name);
    const leavesOk = (n: Node): boolean => {
        if (n.t === 'binary' && (n.op === '*' || n.op === '/')) return leavesOk(n.left) && leavesOk(n.right);
        if (n.t === 'unary' && n.op === '-') return leavesOk(n.arg);
        return n.t === 'num' || (n.t === 'name' && n.name === name);
    };
    const visit = (n: Node) => {
        if (u.frozen.has(n)) return;
        if (isOcc(n)) {
            let top = n;
            let p = u.parent.get(top) || null;
            while (p && p.t === 'binary' && (p.op === '*' || p.op === '/') && leavesOk(p)) {
                top = p;
                p = u.parent.get(p) || null;
            }
            if (top.s >= 0 && top.e > top.s && !out.some(([a, b]) => a === top.s && b === top.e)) out.push([top.s, top.e]);
            if (n.t === 'name') return;
        }
        children(n).forEach(visit);
    };
    roots.forEach(visit);
    return out;
}

/** Twins whose mirrored side contains position `pos` of unit `unit`. */
function touchTwins(core: Core, unit: number, pos: number, out: Set<number>): void {
    const u = core.units[unit];
    if (!u || u.spec.role !== 'equation') return;
    core.twins.forEach((tw, i) => {
        if (pos >= tw.eqSide[0] && pos <= tw.eqSide[1]) out.add(i);
    });
}

// --------------------------------------------------------------- prepare

/** Everything planned for one (target, gesture, pivot): reused by hover and by the drag. */
export interface PreparedDrag {
    readonly target: DragTarget;
    readonly gesture: Gesture;
    readonly grab: Pt;
    readonly info: HoverInfo;
    readonly chip: Chip;
}

class Prepared implements PreparedDrag {
    readonly target: DragTarget;
    readonly gesture: Gesture;
    readonly grab: Pt;
    readonly info: HoverInfo;
    readonly chip: Chip;
    readonly core: Core;
    /** Slider values and derived names at prepare time (the session's start state). */
    readonly derived: DerivedValues;

    constructor(target: DragTarget, gesture: Gesture, grab: Pt, core: Core, derived: DerivedValues) {
        this.target = target;
        this.gesture = gesture;
        this.grab = grab;
        this.core = core;
        this.info = core.info;
        this.chip = core.chip;
        this.derived = derived;
    }
}

/**
 * Whether a prepared drag still serves a hover or a press at `grab` (the modal's plan cache): its grab lies
 * within `reusePx` (px) of `grab`, and for a pivot gesture its ⊕ is still live there (pivotServes: a slide along
 * the object must not leave a stretch axis that was live dead, nor bring the grab under 40 px of the pivot).
 * A pivot gesture that found no pivot is re-planned for any other grab (one may exist a few px away).
 */
export function preparedServes(p: PreparedDrag, grab: Pt, map: ScreenMap, reusePx: number): boolean {
    const d = Math.hypot((p.grab.x - grab.x) * map.kx, (p.grab.y - grab.y) * map.ky);
    if (!(d <= reusePx)) return false;
    if (!(p instanceof Prepared)) return true;
    const core = p.core;
    if (core.gesture !== 'pivot') return true;
    if (core.noPivot) return d <= 1e-9;
    if (!core.pivot || core.shiftLock) return true;
    const fam = core.family;
    const live = fam.kind === 'stretch' ? { x: fam.liveX !== false, y: fam.liveY !== false } : { x: false, y: false };
    return pivotServes(core.pivot, core.grab, grab, map, live);
}

/** Builds the private context (new MathContext(ctx.mathInput) + setDerived(ctx.math.derivedValues())), units, numbers, evaluator, shape, plan and pivot. */
export function prepareDrag(
    target: DragTarget,
    grab: Pt,
    gesture: Gesture,
    ctx: DragContext,
    opts?: { pivot?: Pt }
): PreparedDrag | { lock: Lock } {
    try {
        const derived = ctx.math.derivedValues();
        const res = buildCore(target, grab, gesture, ctx, { pivot: opts && opts.pivot, derived });
        if ('lock' in res) return res;
        return new Prepared(target, gesture, grab, res.core, derived);
    } catch {
        return { lock: lockFor({ kind: 'cannotDragHere', subject: target.subject }) };
    }
}

// --------------------------------------------------------------- session

interface SnapState {
    kind: 'marker' | 'origin' | 'through' | 'grid';
    key: string;
    at: Pt;
    label: string;
}

interface PreResult {
    cursor: Pt;
    status: LiveStatus;
    label?: string;
    snapped: Pt | null;
    /** A turn detent was applied: the cursor and status without it (used when the detent is out of reach). */
    free?: { cursor: Pt; status: LiveStatus; label?: string };
}

export class DragSession {
    readonly target: DragTarget;
    /** Start polylines / points (math) for the ghost. */
    readonly ghost: Pt[][];
    private core: Core;
    private readonly ctx: DragContext;
    private readonly derived: DerivedValues;
    /** Every field the drag may write, with its text at drag start. */
    private readonly startTexts = new Map<string, { ref: FieldRef; text: string; name: string }>();
    private readonly startParams = new Map<string, number>();
    private readonly curTexts = new Map<string, string>();
    private readonly curParams = new Map<string, number>();
    /** Texts the last frame handed out (structural detection). */
    private readonly sentTexts = new Map<string, string>();
    private changedSpans = new Map<string, Array<[number, number]>>();
    private shiftState: boolean;
    private warm: Float64Array | null = null;
    private prevCursorPx: Pt | null = null;
    private lastValues: Float64Array | null = null;
    private lastSteps: Float64Array | null = null;
    private lastZ: [number, number] = [0, 0];
    private lastCursor: Pt | null = null;
    /**
     * Re-base offset (math) added to every raw cursor, and the effective cursor of the last event. A re-base
     * starts the new plan at the grab's current image; whenever the object lagged the pointer (straight snap,
     * a clamped slider, a restriction, quantization) the offset keeps the first frame after it equal to the
     * last frame before it (SPEC3 1.3: no jump).
     */
    private rebaseOffset: Pt = { x: 0, y: 0 };
    private effLast: Pt | null = null;
    private lastProcessedPx: Pt | null = null;
    private snapState: SnapState | null = null;
    /** Snap targets at the grab when the core started (see snap()); null until the first snap. */
    private disarmed: Set<string> | null = null;
    private straightOrigin: Pt;
    private straightDir: number | null = null;
    private usedPivot = false;
    private rebased = false;
    private finished = false;
    /** Keyboard nudges: no geometric snapping; the offset accumulates from the grab. */
    private keyboard = false;
    private nudgeOffset: Pt = { x: 0, y: 0 };
    private nudgeGrab: Pt;

    static start(prepared: PreparedDrag, mods: Mods, ctx: DragContext): DragSession {
        return new DragSession(prepared as Prepared, mods, ctx);
    }

    /** `_mods`: the gesture comes from the prepared drag; a different Shift state re-bases on the first update. */
    private constructor(p: Prepared, _mods: Mods, ctx: DragContext) {
        this.ctx = ctx;
        this.target = p.target;
        this.derived = p.derived;
        let core = p.core;
        if (core.shiftLock && core.gesture === 'pivot') {
            // Shift cannot turn or stretch this target: the drag moves it instead.
            const res = buildCore(p.target, p.grab, 'move', ctx, { derived: p.derived });
            if ('core' in res) core = res.core;
        }
        this.core = core;
        core.ev.values.set(core.value0);
        core.ev.apply();
        this.shiftState = p.gesture === 'pivot';
        this.straightOrigin = core.grabPx;
        this.nudgeGrab = p.grab;
        const t = p.target;
        this.ghost = pointLike(t) || t.kind === 'tangent' ? t.points.map((q) => [q]) : t.lines;
        // Start texts of every field any gesture of this target may write (units of both gestures, twins).
        const names = new Map<string, string>();
        t.twins.forEach((tw, i) => names.set(refKey(tw.ref), `${(t.twinNames && t.twinNames[i]) || ''}'s objective`));
        for (const spec of [...t.units, ...t.twins]) {
            const key = refKey(spec.ref);
            if (this.startTexts.has(key)) continue;
            const own = core.fields.find((f) => f.key === key);
            const twin = core.twins.find((tw) => tw.key === key);
            const text = own ? own.text : twin ? twin.text : fieldText(spec.ref, ctx);
            if (text === null) continue;
            this.startTexts.set(key, { ref: spec.ref, text, name: names.get(key) || t.subject });
            this.curTexts.set(key, text);
            this.sentTexts.set(key, text);
        }
        for (const prm of ctx.parameters || []) {
            if (prm && typeof prm.name === 'string') this.startParams.set(prm.name, prm.value);
        }
    }

    /** Cursor in math coordinates; re-bases when mods.shift changed since the last call. */
    update(cursor: Pt, mods: Mods): DragFrame {
        try {
            if (this.finished) return this.frame({ cursor, status: 'none', snapped: null }, false);
            const shift = !!mods.shift;
            if (shift !== this.shiftState) this.rebase(shift);
            const eff = { x: cursor.x + this.rebaseOffset.x, y: cursor.y + this.rebaseOffset.y };
            this.effLast = eff;
            return this.step(eff, mods);
        } catch {
            return this.frame({ cursor, status: 'stuck', snapped: null }, true);
        }
    }

    /** Null when nothing changed (no history entry, no autosave). */
    commit(): DragCommit | null {
        if (this.finished) return null;
        this.finished = true;
        try {
            return this.buildCommit();
        } catch {
            return null;
        }
    }

    /** Texts and slider values at drag start. */
    cancel(): { edits: FieldEdit[]; params: ParamEdit[] } {
        this.finished = true;
        const edits: FieldEdit[] = [];
        this.startTexts.forEach((v) => edits.push({ ref: v.ref, text: v.text }));
        const params: ParamEdit[] = [];
        this.curParams.forEach((_, name) => {
            const v = this.startParams.get(name);
            if (v !== undefined) params.push({ name, value: v });
        });
        try {
            this.core.ev.values.set(this.core.value0);
            this.core.ev.apply();
        } catch {
            // The private context is discarded with the session.
        }
        return { edits, params };
    }

    /** Keyboard nudge: Move by `delta` (math) from the grab point, accumulated over the session. */
    nudgeBy(delta: Pt, mods: Mods): DragFrame {
        this.keyboard = true;
        this.nudgeOffset = { x: this.nudgeOffset.x + delta.x, y: this.nudgeOffset.y + delta.y };
        return this.update({ x: this.nudgeGrab.x + this.nudgeOffset.x, y: this.nudgeGrab.y + this.nudgeOffset.y }, { shift: false, alt: mods.alt });
    }

    /** True after commit or cancel. */
    get done(): boolean {
        return this.finished;
    }

    // ------------------------------------------------------------ steps

    private step(cursor: Pt, mods: Mods): DragFrame {
        const core = this.core;
        const map = this.ctx.map;
        let pre = this.preprocess(cursor, mods);
        let cursorPx = toPx(pre.cursor, map);
        let solved = solveDrag(core.problem, core.plan, cursorPx, this.prevCursorPx, this.warm, core.bounds);
        if (pre.free && (!solved.ok || solved.maxPx > DETENT_EXACT_PX)) {
            // The turn detent asks for a direction the numbers cannot reach (horizontal for `x + 3y <= 6` turned
            // about a corner needs an infinite y coefficient; the solve creeps to 1000y and stops a few tenths of
            // a px short): turn to the pointer's own direction instead.
            pre = { cursor: pre.free.cursor, status: pre.free.status, label: pre.free.label, snapped: pre.snapped };
            cursorPx = toPx(pre.cursor, map);
            this.lastProcessedPx = cursorPx;
            solved = solveDrag(core.problem, core.plan, cursorPx, this.prevCursorPx, this.warm, core.bounds);
        }
        // Rejected (non-finite, out of range, a jump) or turned inside out (orientation guard): keep the last
        // frame. A slider of a turn or stretch at its bound stops the object and says so.
        if (!solved.ok || !allFinite(solved.values)) {
            if (solved.failure === 'clamp' && solved.clamped.length) {
                const c = solved.clamped[0];
                const n = core.numbers[c.number];
                if (n && n.param) {
                    const at = c.at === 'max' ? n.param.max : n.param.min;
                    return this.keep(pre, c.at === 'max' ? 'clampMax' : 'clampMin', n.param.name, at);
                }
            }
            return this.keep(pre, solved.failure === 'flip' ? 'flip' : 'stuck');
        }
        // Keyboard nudges quantize like Alt: each press lands on the pixel step, and only the half-step
        // start magnet applies (the 2 px magnets would swallow a nudge of 1.6 px).
        const q = quantizeDrag(core.problem, core.plan, solved, core.bounds, { snap: !mods.alt && !this.keyboard });
        if (!allFinite(q.values)) return this.keep(pre, 'stuck');
        core.ev.values.set(q.values);
        core.ev.apply();
        const rewritten = this.rewrite(q.values, q.steps, false);
        if (!rewritten) return this.keep(pre, 'stuck');

        const texts = this.textsFrom(rewritten);
        texts.forEach((text, key) => this.curTexts.set(key, text));
        this.changedSpans = new Map();
        for (const f of rewritten) this.changedSpans.set(refKey(f.ref), f.changed);
        core.numbers.forEach((n, i) => {
            if (n.kind === 'slider' && n.param) this.curParams.set(n.param.name, q.values[i]);
        });
        this.warm = solved.warm;
        this.prevCursorPx = cursorPx;
        this.lastValues = Float64Array.from(q.values);
        this.lastSteps = Float64Array.from(q.steps);
        this.lastZ = [solved.z[0], solved.z[1]];
        this.lastCursor = pre.cursor;
        if (core.gesture === 'pivot' && !core.straightMove && changedAny(core, q.values)) this.usedPivot = true;

        let status: LiveStatus = pre.status;
        let label = pre.label;
        let bound: number | undefined;
        if (solved.clamped.length) {
            const c = solved.clamped[0];
            const n = core.numbers[c.number];
            if (n && n.param) {
                status = c.at === 'max' ? 'clampMax' : 'clampMin';
                label = n.param.name;
                bound = c.at === 'max' ? n.param.max : n.param.min;
            }
        }
        return this.frame({ ...pre, status, label }, false, bound);
    }

    /**
     * Rewrite every unit field (and the twins) for these values; null when a unit field failed the safety
     * net in both modes (the caller keeps the previous frame).
     */
    private rewrite(values: Float64Array, steps: Float64Array, tidy: boolean): RewrittenField[] | null {
        const core = this.core;
        const twins: TwinInput[] = core.twins.map((tw) => ({ unit: tw.unit, ref: tw.ref, text: tw.text }));
        const out = rewriteUnits(core.units, core.numbers, values, steps, core.ev, core.math, { tidy, samples: core.samples, twins });
        const twinKeys = new Set(core.twins.map((tw) => tw.key));
        if (out.some((f) => f.failed && !twinKeys.has(refKey(f.ref)))) return null;
        return out;
    }

    /** Field texts of a rewrite (unchanged fields keep the core's start text); a twin that cannot follow keeps its text. */
    private textsFrom(rewritten: RewrittenField[]): Map<string, string> {
        const core = this.core;
        const texts = new Map<string, string>();
        for (const f of core.fields) texts.set(f.key, f.text);
        const twinKeys = new Set(core.twins.map((tw) => tw.key));
        for (const r of rewritten) {
            const key = refKey(r.ref);
            if (r.failed) {
                if (twinKeys.has(key)) texts.set(key, this.curTexts.get(key) ?? r.text);
                continue;
            }
            texts.set(key, r.text);
        }
        return texts;
    }

    /** Keep the previous frame (rejected or guarded event); `label` / `bound` name a clamped slider. */
    private keep(pre: PreResult, status: LiveStatus, label?: string, bound?: number): DragFrame {
        const core = this.core;
        try {
            core.ev.values.set(this.lastValues || core.value0);
            core.ev.apply();
        } catch {
            // Values are restored on the next good event.
        }
        return this.frame({ cursor: pre.cursor, status, label, snapped: null }, true, bound);
    }

    private frame(pre: PreResult, stuck: boolean, bound?: number): DragFrame {
        const core = this.core;
        const edits: FieldEdit[] = [];
        let structural = false;
        this.startTexts.forEach((v, key) => {
            const text = this.curTexts.get(key);
            if (text === undefined) return;
            edits.push({ ref: v.ref, text });
            if (v.ref.kind === 'function' && v.ref.field === 'expression' && this.sentTexts.get(key) !== text) structural = true;
            this.sentTexts.set(key, text);
        });
        const params: ParamEdit[] = [];
        this.curParams.forEach((value, name) => params.push({ name, value }));
        const sliders: Array<{ name: string; value: number }> = [];
        this.curParams.forEach((value, name) => {
            const v0 = this.startParams.get(name);
            if (v0 === undefined || !sameNumber(v0, value)) sliders.push({ name, value });
        });
        const chipFields = core.fields.map((f) => ({ text: this.curTexts.get(f.key) ?? f.text, changed: this.changedSpans.get(f.key) || [] }));
        const pivotGesture = core.gesture === 'pivot' && !core.straightMove && !!core.pivot;
        let status = pre.status;
        if (status === 'none') {
            if (pivotGesture) status = core.target.shift === 'stretch' ? 'stretching' : core.target.shift === 'resize' ? 'resizing' : 'turning';
            else if (core.gesture === 'move' && core.plan.restricted === 'vertical') status = 'vertical';
            else if (core.gesture === 'move' && core.plan.restricted === 'horizontal') status = 'horizontal';
        }
        const chip = liveChip(this.target, chipFields, sliders, { kind: status, label: pre.label, pivot: core.pivot || undefined, bound });
        return {
            edits,
            params,
            structural,
            chip,
            pivot: pivotGesture ? core.pivot : null,
            snapped: pre.snapped,
            stuck,
            restricted: core.gesture === 'move' ? core.plan.restricted : 'none',
        };
    }

    // ----------------------------------------------------------- re-base

    /** Shift changed mid-drag: the current numbers become the start of a new plan; the undo step stays one. */
    private rebase(shift: boolean): void {
        const old = this.core;
        const gesture: Gesture = shift ? 'pivot' : 'move';
        const map = this.ctx.map;
        if (this.lastValues) {
            old.ev.values.set(this.lastValues);
            old.ev.apply();
        }
        const z = this.lastZ;
        let grabNow: Pt;
        if (old.family.kind === 'push' || old.family.kind === 'slide') grabNow = this.lastCursor || old.grab;
        else grabNow = this.lastValues ? fromPx(applyFamily(old.family, z, old.grabPx), map) : old.grab;
        // The quantized shape passes near, not through, the grab's image: start the new plan on the shape
        // itself (a level pushed after a Shift reshape would otherwise jump to the image's level).
        if (this.lastValues) grabNow = projectOnShape(old, grabNow);
        // The new plan starts at grabNow; the raw cursor keeps its offset from it (no jump, SPEC3 1.3).
        if (this.effLast) {
            this.rebaseOffset = { x: this.rebaseOffset.x + grabNow.x - this.effLast.x, y: this.rebaseOffset.y + grabNow.y - this.effLast.y };
        }
        const geo = currentGeometry(old, this.lastValues ? z : [0, 0], map);
        const texts = new Map<string, string>(this.curTexts);
        const res = buildCore(this.target, grabNow, gesture, this.ctx, {
            texts,
            params: this.curParams,
            derived: this.derived,
            lines: geo.lines,
            points: geo.points,
        });
        this.shiftState = shift;
        if ('lock' in res) return;
        let core = res.core;
        if (core.shiftLock && gesture === 'pivot') {
            const mv = buildCore(this.target, grabNow, 'move', this.ctx, { texts, params: this.curParams, derived: this.derived, lines: geo.lines, points: geo.points });
            if ('lock' in mv) return;
            core = mv.core;
        }
        // Fields the new core writes that the drag has not touched yet start at their current text.
        for (const f of core.fields) {
            if (!this.startTexts.has(f.key)) {
                this.startTexts.set(f.key, { ref: f.ref, text: f.text, name: this.target.subject });
                this.curTexts.set(f.key, f.text);
            }
        }
        this.core = core;
        this.rebased = true;
        this.warm = null;
        this.prevCursorPx = null;
        this.lastValues = null;
        this.lastSteps = null;
        this.lastZ = [0, 0];
        this.snapState = null;
        this.disarmed = null;
        this.straightDir = null;
        this.straightOrigin = core.grabPx;
        this.lastProcessedPx = null;
        this.changedSpans = new Map();
    }

    // ------------------------------------------------------- pre-process

    private preprocess(cursor: Pt, mods: Mods): PreResult {
        const core = this.core;
        const t = core.target;
        const map = this.ctx.map;
        let c: Pt = { x: cursor.x, y: cursor.y };
        let status: LiveStatus = 'none';
        let label: string | undefined;
        let snapped: Pt | null = null;
        const snapOn = !mods.alt && !this.keyboard;

        if (core.straightMove) {
            c = this.straightSnap(c);
        }
        if (t.kind === 'label') {
            const v = map.view;
            c = { x: Math.min(v.xmax, Math.max(v.xmin, c.x)), y: Math.min(v.ymax, Math.max(v.ymin, c.y)) };
        }
        if (t.kind === 'tangent') {
            // Relative to the grab: grabbed on the line 1 unit from the tangent point, the point moves by the
            // pointer's x motion instead of jumping under the pointer (SPEC3 1.1: the grabbed part follows).
            const x0 = core.points[0] && Number.isFinite(core.points[0].x) ? core.points[0].x : core.grab.x;
            c = { x: x0 + (c.x - core.grab.x), y: c.y };
            if (core.slideRange) {
                const [lo, hi] = core.slideRange;
                if (hi >= lo) c = { x: Math.min(hi, Math.max(lo, c.x)), y: c.y };
            }
        }

        const moveLike = core.family.kind === 'translate' || core.family.kind === 'push';
        if (moveLike && !core.straightMove && snapOn && t.kind !== 'tangent') {
            const s = this.snap(c);
            if (s) {
                c = s.cursor;
                status = s.status;
                label = s.label;
                snapped = s.snapped;
            }
        }
        if (core.family.kind === 'similar' && core.pivot) {
            const r = this.turnOrResize(c, mods);
            c = r.cursor;
            if (r.status !== 'none') {
                status = r.status;
                label = r.label;
            }
            if (r.free) return { cursor: c, status, label, snapped, free: r.free };
        } else if (core.family.kind === 'stretch' && core.pivot) {
            const r = this.stretch(c, mods);
            c = r.cursor;
            if (r.status !== 'none') status = r.status;
        }
        return { cursor: c, status, label, snapped };
    }

    /** Shift on point-like targets: motion along the nearest of 8 screen directions (SPEC3 1.3). */
    private straightSnap(c: Pt): Pt {
        const map = this.ctx.map;
        const o = this.straightOrigin;
        const p = toPx(c, map);
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        const len = Math.hypot(dx, dy);
        if (this.straightDir === null && len < STRAIGHT_DECIDE_PX) return fromPx(o, map);
        if (len > 0) {
            const ang = Math.atan2(dy, dx);
            if (this.straightDir === null || Math.abs(angleDiff(ang, this.straightDir)) > (22.5 + STRAIGHT_HYST_DEG) * DEG) {
                this.straightDir = Math.round(ang / (45 * DEG)) * 45 * DEG;
            }
        }
        const a = this.straightDir === null ? 0 : this.straightDir;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const s = dx * ux + dy * uy;
        return fromPx({ x: o.x + s * ux, y: o.y + s * uy }, map);
    }

    /**
     * SPEC3 1.7 rules 1 to 3 for Moves: markers, line through a marker, grid. Targets that already sit at
     * the grab when the drag starts (the corners on a constraint line, the grid node under a point) are
     * disarmed until the drag has left them by the release distance, so a press never starts in a dead zone.
     */
    private snap(c: Pt): { cursor: Pt; status: LiveStatus; label?: string; snapped: Pt } | null {
        const core = this.core;
        const t = core.target;
        const map = this.ctx.map;
        const px = (a: Pt, b: Pt) => Math.hypot((a.x - b.x) * map.kx, (a.y - b.y) * map.ky);
        const prev = this.snapState;
        const v = map.view;
        // Back at the grab nothing snaps (a snap held by its hysteresis would keep the moved text there), so
        // the start-value magnet restores the text byte for byte (SPEC3 6.4 #4).
        if (px(c, core.grab) <= AT_GRAB_PX) {
            this.snapState = null;
            return null;
        }

        // Candidates: markers of other items and the origin (rule 1), markers (rule 2), the grid node (rule 3).
        const points: Array<{ key: string; at: Pt; label: string; origin: boolean; layer: number }> = this.markers().map((m) => ({
            key: m.key,
            at: m.point as Pt,
            label: m.source,
            origin: false,
            layer: m.layer,
        }));
        if (v.xmin <= 0 && v.xmax >= 0 && v.ymin <= 0 && v.ymax >= 0) points.push({ key: 'origin', at: { x: 0, y: 0 }, label: 'the origin', origin: true, layer: -1 });
        const through = t.straight && core.lineDir && !pointLike(t) ? core.lineDir : null;
        /** Offset (px) from the line through `at` (parallel to the start line) to marker m. */
        const lineOff = (at: Pt, m: Pt) => {
            const d = through as Pt;
            const cp = toPx(at, map);
            const mp = toPx(m, map);
            const wx = mp.x - cp.x;
            const wy = mp.y - cp.y;
            const along = wx * d.x + wy * d.y;
            return { nx: wx - along * d.x, ny: wy - along * d.y };
        };
        const xs = (this.ctx.ticks && this.ctx.ticks.x) || [];
        const ys = (this.ctx.ticks && this.ctx.ticks.y) || [];
        const probeAt = (at: Pt): Pt | null => {
            if (!xs.length || !ys.length) return null;
            if (pointLike(t)) return at;
            if (t.kind === 'graph' && core.anchor) return { x: core.anchor.x + at.x - core.grab.x, y: core.anchor.y + at.y - core.grab.y };
            return null;
        };
        const nodeOf = (probe: Pt): Pt => ({ x: nearest(xs, probe.x), y: nearest(ys, probe.y) });

        if (!this.disarmed) {
            const g = core.grab;
            const dis = new Set<string>();
            for (const m of points) if (px(g, m.at) <= SNAP_IN_PX) dis.add(`m:${m.key}`);
            if (through) for (const m of points) if (!m.origin && Math.hypot(lineOff(g, m.at).nx, lineOff(g, m.at).ny) <= SNAP_IN_PX) dis.add(`t:${m.key}`);
            const gp = probeAt(g);
            if (gp) {
                const node = nodeOf(gp);
                if (px(gp, node) <= GRID_IN_PX) dis.add(`g:${node.x},${node.y}`);
            }
            this.disarmed = dis;
        }
        const disarmed = this.disarmed;
        /** False while a start target is disarmed; re-arms it once the drag is beyond `out`. */
        const armed = (key: string, d: number, out: number): boolean => {
            if (!disarmed.has(key)) return true;
            if (d > out) disarmed.delete(key);
            return false;
        };
        /** Nearest within reach; distances within 1 px prefer the marker drawn on top. */
        const better = (d: number, layer: number, best: { d: number; layer: number } | null) =>
            !best || d < best.d - 1 || (Math.abs(d - best.d) <= 1 && (layer > best.layer || (layer === best.layer && d < best.d)));

        // 1. Marker snap: the cursor is where the grab point goes.
        let pick: { m: (typeof points)[number]; d: number; layer: number } | null = null;
        for (const m of points) {
            const d = px(c, m.at);
            if (!armed(`m:${m.key}`, d, SNAP_OUT_PX)) continue;
            const reach = prev && (prev.kind === 'marker' || prev.kind === 'origin') && prev.key === m.key ? SNAP_OUT_PX : SNAP_IN_PX;
            if (d <= reach && better(d, m.layer, pick)) pick = { m, d, layer: m.layer };
        }
        if (pick) {
            const s: SnapState = { kind: pick.m.origin ? 'origin' : 'marker', key: pick.m.key, at: pick.m.at, label: pick.m.label };
            this.snapState = s;
            return this.snapped(s, pick.m.at);
        }

        // 2. Line through a marker (straight objects): shift along the normal so the line passes through it.
        if (through) {
            let best: { m: (typeof points)[number]; d: number; layer: number; nx: number; ny: number } | null = null;
            for (const m of points) {
                if (m.origin) continue;
                const o = lineOff(c, m.at);
                const d = Math.hypot(o.nx, o.ny);
                if (!armed(`t:${m.key}`, d, SNAP_OUT_PX)) continue;
                const reach = prev && prev.kind === 'through' && prev.key === m.key ? SNAP_OUT_PX : SNAP_IN_PX;
                if (d <= reach && better(d, m.layer, best)) best = { m, d, layer: m.layer, ...o };
            }
            if (best) {
                this.snapState = { kind: 'through', key: best.m.key, at: best.m.at, label: best.m.label };
                const cp = toPx(c, map);
                return { cursor: fromPx({ x: cp.x + best.nx, y: cp.y + best.ny }, map), status: 'throughMarker', label: best.m.label, snapped: best.m.at };
            }
        }

        // 3. Grid: point-like targets snap the cursor, graphs their extremum.
        const probe = probeAt(c);
        if (probe) {
            const node = nodeOf(probe);
            const d = px(probe, node);
            const key = `g:${node.x},${node.y}`;
            const keep = prev && prev.kind === 'grid' && prev.at.x === node.x && prev.at.y === node.y;
            if (armed(key, d, GRID_OUT_PX) && d <= (keep ? GRID_OUT_PX : GRID_IN_PX)) {
                this.snapState = { kind: 'grid', key, at: node, label: '' };
                return { cursor: { x: c.x + node.x - probe.x, y: c.y + node.y - probe.y }, status: 'grid', snapped: node };
            }
        }
        this.snapState = null;
        return null;
    }

    private snapped(s: SnapState, at: Pt): { cursor: Pt; status: LiveStatus; label?: string; snapped: Pt } {
        return { cursor: { x: at.x, y: at.y }, status: s.kind === 'origin' ? 'origin' : 'snapMarker', label: s.label, snapped: at };
    }

    /** Markers of other items (snapping targets). */
    private markers(): HitShape[] {
        const t = this.core.target;
        const own = t.key.split('#')[0];
        // points() also lists markers outside the view: an invisible marker is never a snap target.
        const v = this.ctx.map.view;
        const inView = (p: Pt) => p.x >= v.xmin && p.x <= v.xmax && p.y >= v.ymin && p.y <= v.ymax;
        return this.ctx.hits.points().filter((h) => !!h.point && inView(h.point) && h.itemKey !== own && h.source !== t.cardSource);
    }

    /** Turns (straight objects, legs) and resizes (closed curves) about the pivot (SPEC3 2.3, 1.7 rule 4). */
    private turnOrResize(
        c: Pt,
        mods: Mods
    ): { cursor: Pt; status: LiveStatus; label?: string; free?: { cursor: Pt; status: LiveStatus; label?: string } } {
        const core = this.core;
        const map = this.ctx.map;
        const P = toPx(core.pivot as Pt, map);
        const g = core.grabPx;
        let p = toPx(c, map);
        if (dist2(p, P) < PIVOT_DEAD_PX) p = this.lastProcessedPx || g;
        const gx = g.x - P.x;
        const gy = g.y - P.y;
        const gl = Math.hypot(gx, gy);
        let vx = p.x - P.x;
        let vy = p.y - P.y;
        let vl = Math.hypot(vx, vy);
        if (!(gl > 0) || !(vl > 0)) return { cursor: c, status: 'none' };
        const fam = core.family;
        const turnOnly = fam.kind === 'similar' && fam.turnOnly;
        if (!turnOnly) {
            // Resize: the scale factor stays in [0.05, 20].
            const k = vl / gl;
            const kc = Math.min(SCALE_MAX, Math.max(SCALE_MIN, k));
            if (kc !== k) {
                vx *= kc / k;
                vy *= kc / k;
                vl = kc * gl;
            }
            if (fam.kind === 'similar' && fam.scaleOnly) {
                // Uniform resize: the grabbed point keeps its direction from ⊕ at the pointer's distance.
                vx = gx * kc;
                vy = gy * kc;
            }
        }
        if (core.target.straight && core.lineDir && turnOnly) {
            const rot = Math.atan2(vy, vx) - Math.atan2(gy, gx);
            const a0 = Math.atan2(core.lineDir.y, core.lineDir.x);
            const raw = a0 + rot;
            /** The cursor for line angle a (graphs clamped to 89 degrees on screen). */
            const at = (a: number, status: LiveStatus, label?: string): { cursor: Pt; px: Pt; status: LiveStatus; label?: string } => {
                let b = a;
                let st = status;
                let lb = label;
                if (core.target.kind === 'graph') {
                    const n = normalizeHalf(b);
                    if (Math.abs(n) > MAX_GRAPH_DEG * DEG) {
                        b = b + (Math.sign(n) * MAX_GRAPH_DEG * DEG - n);
                        st = 'vertical89';
                        lb = undefined;
                    }
                }
                const r = b - a0;
                const cr = Math.cos(r);
                const sr = Math.sin(r);
                const px = { x: P.x + ((gx * cr - gy * sr) / gl) * vl, y: P.y + ((gx * sr + gy * cr) / gl) * vl };
                return { cursor: fromPx(px, map), px, status: st, label: lb };
            };
            const free = at(raw, 'none');
            // The start direction wins inside its own window, so wiggling back restores the text (a slope of
            // 3.1 next to the slope 3 detent never becomes 3 on the press).
            const det = !mods.alt && !this.keyboard && Math.abs(normalizeHalf(raw - a0)) > DETENT_DEG * DEG ? detent(raw, map, core.target.kind !== 'graph') : null;
            if (det) {
                const snapped = at(det.angle, 'slope', det.label);
                this.lastProcessedPx = snapped.px;
                return { cursor: snapped.cursor, status: snapped.status, label: snapped.label, free: { cursor: free.cursor, status: free.status, label: free.label } };
            }
            this.lastProcessedPx = free.px;
            return { cursor: free.cursor, status: free.status, label: free.label };
        }
        const out = { x: P.x + vx, y: P.y + vy };
        this.lastProcessedPx = out;
        return { cursor: fromPx(out, map), status: 'none' };
    }

    /** Stretch of open curves (SPEC3 2.3, 1.7 rule 5). */
    private stretch(c: Pt, mods: Mods): { cursor: Pt; status: LiveStatus } {
        const core = this.core;
        const map = this.ctx.map;
        const P = toPx(core.pivot as Pt, map);
        const g = core.grabPx;
        const p = toPx(c, map);
        const gx = g.x - P.x;
        const gy = g.y - P.y;
        const liveX = Math.abs(gx) >= MIN_U_PX;
        const liveY = Math.abs(gy) >= MIN_U_PX;
        let dx = p.x - g.x;
        let dy = p.y - g.y;
        const snapOn = !mods.alt && !this.keyboard;
        if (snapOn) {
            if (Math.abs(dx) < MAGNET_PX && Math.abs(dx) < Math.abs(dy) / 3) dx = 0;
            if (Math.abs(dy) < MAGNET_PX && Math.abs(dy) < Math.abs(dx) / 3) dy = 0;
        }
        let sx = liveX ? (g.x + dx - P.x) / gx : 1;
        let sy = liveY ? (g.y + dy - P.y) / gy : 1;
        if (snapOn) {
            for (const D of STRETCH_DETENTS) {
                if (liveX && Math.abs(sx - D) <= STRETCH_DETENT_REL * Math.abs(D)) sx = D;
                if (liveY && Math.abs(sy - D) <= STRETCH_DETENT_REL * Math.abs(D)) sy = D;
            }
        }
        sx = Math.min(SCALE_MAX, Math.max(SCALE_MIN, sx));
        if (sy >= 0) sy = Math.min(SCALE_MAX, Math.max(SCALE_MIN, sy));
        else sy = Math.max(-SCALE_MAX, Math.min(-SCALE_MIN, sy));
        const out = { x: P.x + sx * gx, y: P.y + sy * gy };
        return { cursor: fromPx(out, map), status: sy < 0 ? 'mirrored' : 'none' };
    }

    // ------------------------------------------------------------ commit

    private buildCommit(): DragCommit | null {
        const core = this.core;
        const final = new Map<string, string>(this.curTexts);
        let tidyFields: RewrittenField[] | null = null;
        if (this.lastValues && this.lastSteps) {
            try {
                core.ev.values.set(this.lastValues);
                core.ev.apply();
                const tidy = this.rewrite(this.lastValues, this.lastSteps, true);
                if (tidy) {
                    tidyFields = tidy;
                    this.textsFrom(tidy).forEach((text, key) => final.set(key, text));
                }
            } catch {
                tidyFields = null;
            }
        }
        const fields: FieldPatch[] = [];
        this.startTexts.forEach((v, key) => {
            const after = final.get(key);
            if (after !== undefined && after !== v.text) fields.push({ ref: v.ref, before: v.text, after, name: v.name });
        });
        const params: ParamPatch[] = [];
        this.curParams.forEach((after, name) => {
            const before = this.startParams.get(name);
            if (before !== undefined && !sameNumber(before, after)) params.push({ name, before, after });
        });
        if (!fields.length && !params.length) return null;
        const twinChanged = core.twins.some((tw) => fields.some((f) => refKey(f.ref) === tw.key));
        const gesture: Gesture = this.usedPivot ? 'pivot' : 'move';
        const label = undoLabel(this.target, gesture, twinChanged);
        const display = core.fields.map((f) => final.get(f.key) ?? f.text).join(', ');
        return {
            label,
            fields,
            params,
            makeSlider: this.rebased ? null : this.makeSliderOffer(final, tidyFields),
            announce: dragAnnouncement(this.target, display),
        };
    }

    /** SPEC3 1.11: exactly one literal or folded number changed in one field (plus its twin), no slider, no insertion. */
    private makeSliderOffer(final: Map<string, string>, tidy: RewrittenField[] | null): MakeSliderOffer | null {
        const core = this.core;
        const vals = this.lastValues;
        if (!vals || !tidy) return null;
        const changed: number[] = [];
        core.numbers.forEach((n, i) => {
            const v0 = core.value0[i];
            if (Math.abs(vals[i] - v0) > 1e-12 * Math.max(1, Math.abs(v0))) changed.push(i);
        });
        if (changed.length !== 1) return null;
        const n = core.numbers[changed[0]];
        if (n.kind !== 'literal' && n.kind !== 'folded') return null;
        const unit = core.units[n.unit];
        if (!unit) return null;
        const key = refKey(unit.spec.ref);
        const field = tidy.find((f) => refKey(f.ref) === key);
        const text = final.get(key);
        if (!field || text === undefined) return null;
        let span: [number, number] | null = null;
        let value = NaN;
        for (const [s, e] of field.changed) {
            const piece = text.slice(s, e);
            const m = /^\s*(\(\s*-\s*)?((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(\s*\))?\s*$/.exec(piece);
            if (!m || !!m[1] !== !!m[3]) continue;
            if (span) return null;
            const lead = piece.length - piece.trimStart().length;
            const trail = piece.length - piece.trimEnd().length;
            span = [s + lead, e - trail];
            value = (m[1] ? -1 : 1) * Number(m[2]);
        }
        if (!span || !Number.isFinite(value)) return null;
        const twins: Array<{ ref: FieldRef; span: [number, number] }> = [];
        for (const tw of core.twins) {
            const twText = final.get(tw.key);
            if (twText === undefined || twText === tw.text) continue;
            const mapped = mapSpan(text, span, twText, core.math);
            if (mapped) twins.push({ ref: tw.ref, span: mapped });
        }
        return { ref: unit.spec.ref, span, value, twins };
    }
}

/** Keyboard nudge: Move by `delta` (math) from the target's grab point; reuse `session` within 1 s. */
export function nudge(session: DragSession | null, prepared: PreparedDrag, delta: Pt, mods: Mods, ctx: DragContext): { session: DragSession; frame: DragFrame } {
    let s = session;
    if (!s || s.done || s.target.key !== prepared.target.key) s = DragSession.start(prepared, { shift: false, alt: mods.alt }, ctx);
    return { session: s, frame: s.nudgeBy(delta, mods) };
}

// --------------------------------------------------------------- helpers

function allFinite(a: Float64Array): boolean {
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
    return true;
}

function sameNumber(a: number, b: number): boolean {
    return a === b || Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
}

function changedAny(core: Core, vals: Float64Array): boolean {
    for (let i = 0; i < vals.length; i++) {
        const v0 = core.value0[i];
        if (Math.abs(vals[i] - v0) > 1e-12 * Math.max(1, Math.abs(v0))) return true;
    }
    return false;
}

/** Angle difference wrapped to (-pi, pi]. */
function angleDiff(a: number, b: number): number {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    return d;
}

/** Line angle wrapped to (-pi/2, pi/2]. */
function normalizeHalf(a: number): number {
    let d = a;
    while (d > Math.PI / 2) d -= Math.PI;
    while (d <= -Math.PI / 2) d += Math.PI;
    return d;
}

function nearest(list: readonly number[], v: number): number {
    let best = list[0];
    for (const x of list) if (Math.abs(x - v) < Math.abs(best - v)) best = x;
    return best;
}

/** Turn detent: the nearest direction (p, q) in math units within 1.5 degrees on screen. */
function detent(a: number, map: DragContext['map'], allowVertical: boolean): { angle: number; label: string } | null {
    let best: { angle: number; label: string; diff: number } | null = null;
    for (let p = 0; p <= DETENT_MAX; p++) {
        for (let q = -DETENT_MAX; q <= DETENT_MAX; q++) {
            if (p === 0 && q !== 1) continue;
            if (p > 0 && gcd(p, Math.abs(q)) !== 1) continue;
            if (p === 0 && !allowVertical) continue;
            const ang = Math.atan2(q * map.ky, p * map.kx);
            const diff = normalizeHalf(a - ang);
            if (Math.abs(diff) <= DETENT_DEG * DEG && (!best || Math.abs(diff) < Math.abs(best.diff))) {
                const label = p === 0 ? 'vertical' : q === 0 ? 'horizontal' : p === 1 ? String(q) : `${q}/${p}`;
                best = { angle: a - diff, label, diff };
            }
        }
    }
    return best ? { angle: best.angle, label: best.label } : null;
}

function gcd(a: number, b: number): number {
    let x = a;
    let y = b;
    while (y) [x, y] = [y, x % y];
    return x;
}

/** Re-base geometry: the core's lines and points moved by z and projected onto the current shape. */
function currentGeometry(core: Core, z: readonly [number, number], map: DragContext['map']): { lines: Pt[][]; points: Pt[] } {
    const t = core.target;
    const fns = core.ev.fns;
    const move = (p: Pt): Pt => {
        if (core.family.kind === 'push' || core.family.kind === 'slide') return p;
        return fromPx(applyFamily(core.family, z, toPx(p, map)), map);
    };
    if (pointLike(t) || t.kind === 'path') {
        const points = core.points.map((p, k) => {
            const fx = fns[2 * k];
            const fy = fns[2 * k + 1];
            const x = fx ? fx(NaN, NaN) : p.x;
            const y = fy ? fy(NaN, NaN) : p.y;
            return { x: Number.isFinite(x) ? x : p.x, y: Number.isFinite(y) ? y : p.y };
        });
        const lines = t.kind === 'path' ? [points] : core.lines;
        return { lines, points };
    }
    if (t.kind === 'tangent') {
        const x0 = fns[0] ? fns[0](NaN, NaN) : NaN;
        const p0 = core.points[0];
        return { lines: core.lines, points: Number.isFinite(x0) && p0 ? [{ x: x0, y: p0.y }] : core.points };
    }
    if (t.kind === 'graph') {
        const f = fns[0];
        const lines = core.lines.map((l) =>
            l
                .map(move)
                .map((p) => ({ x: p.x, y: f(p.x, NaN) }))
                .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        );
        return { lines: lines.filter((l) => l.length >= 2), points: core.points };
    }
    // Implicit: 3 Newton steps along grad G (level push: F - L with the new level).
    const G = implicitG(core);
    const lines = core.lines.map((l) => l.map(move).map((p) => newton(G, p)).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    return { lines: lines.filter((l) => l.length >= 2), points: core.points };
}

/** The implicit function whose zero set is the dragged curve at the current numbers (level push: F - L, L the new level). */
function implicitG(core: Core): (x: number, y: number) => number {
    const t = core.target;
    const fns = core.ev.fns;
    if (t.kind === 'level' && core.family.kind === 'push') {
        const eqText = t.level ? t.level.equation : '';
        let F: (x: number, y: number) => number;
        try {
            F = core.math.equation(eqText).F;
        } catch {
            F = () => NaN;
        }
        const L = fns[0] ? fns[0](NaN, NaN) : 0;
        return (x, y) => F(x, y) - L;
    }
    const F = fns[0];
    if (!F) return () => NaN;
    if (t.kind === 'level' && t.level) {
        const L = t.level.value;
        return (x, y) => F(x, y) - L;
    }
    return (x, y) => F(x, y);
}

/** `p` moved onto the dragged shape at the current numbers (graphs: y = f(x); implicit: 3 Newton steps); else `p`. */
function projectOnShape(core: Core, p: Pt): Pt {
    const t = core.target;
    let q = p;
    if (t.kind === 'graph') {
        const f = core.ev.fns[0];
        q = { x: p.x, y: f ? f(p.x, NaN) : NaN };
    } else if (t.kind === 'clause' || t.kind === 'curve' || t.kind === 'level') {
        q = newton(implicitG(core), p);
    }
    return Number.isFinite(q.x) && Number.isFinite(q.y) ? q : p;
}

function newton(G: (x: number, y: number) => number, p: Pt): Pt {
    let x = p.x;
    let y = p.y;
    for (let it = 0; it < 3; it++) {
        const g = G(x, y);
        if (!Number.isFinite(g) || g === 0) break;
        const hx = 1e-6 * (1 + Math.abs(x));
        const hy = 1e-6 * (1 + Math.abs(y));
        const gx = (G(x + hx, y) - G(x - hx, y)) / (2 * hx);
        const gy = (G(x, y + hy) - G(x, y - hy)) / (2 * hy);
        const nn = gx * gx + gy * gy;
        if (!Number.isFinite(nn) || nn === 0) break;
        x -= (g * gx) / nn;
        y -= (g * gy) / nn;
    }
    return { x, y };
}

/** Map a span of the equation text onto the twin by token index inside the variable sides (SPEC3 3.7). */
function mapSpan(eq: string, span: [number, number], twin: string, math: MathContext): [number, number] | null {
    const side = variableSide(eq, math);
    if (!side) return null;
    let a;
    let b;
    try {
        a = tokenize(eq).filter((t) => t.kind !== 'end' && t.pos >= side[0] && t.end <= side[1]);
        b = tokenize(twin).filter((t) => t.kind !== 'end');
    } catch {
        return null;
    }
    const i = a.findIndex((t) => t.pos === span[0]);
    const j = a.findIndex((t) => t.end === span[1]);
    if (i < 0 || j < i || j >= b.length) return null;
    return [b[i].pos, b[j].end];
}
