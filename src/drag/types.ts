/*
 * Shared types of the drag-to-edit engine (src/drag/*), the overlay (src/ui/dragLayer.ts) and the modal.
 * Pure: no DOM, no Obsidian. CONTRACT FILE (SPEC3 4.2): members may be added, never changed.
 */
import type { Compiled, Node } from '../expr';
import type { Pt, View } from '../geometry';
import type { FunctionKind, MathContext, MathContextInput } from '../mathcontext';
import type { LockKind, PartRef } from '../scene';
import type { Annotation, FunctionParameters, Parameter, Tool } from '../types';

export type { Pt, View };

// ------------------------------------------------------------------ input

/** Modifier keys, read from every pointer and key event (never cached). */
export interface Mods {
    /** Pivot gesture; straight motion for point-like targets. */
    shift: boolean;
    /** Fine: no geometric snapping, no rounder-number magnet (the start-value magnet stays). */
    alt: boolean;
}

export type Gesture = 'move' | 'pivot';

/** Math units to on-screen CSS px: px = (x * kx, y * ky), y up. */
export interface ScreenMap {
    view: View;
    kx: number;
    ky: number;
}

// ----------------------------------------------------------------- fields

export type FieldRef =
    | { kind: 'function'; name: string; field: 'expression' | 'tangentPoint' }
    | { kind: 'tool'; id: string; field: 'equation' | 'levels' | 'points' | 'path' | 'objective' }
    | { kind: 'tool'; id: string; field: 'condition'; entry: number }
    | { kind: 'label'; index: number; field: 'x' | 'y' };

export type UnitRole = 'body' | 'equation' | 'clause' | 'levelItem' | 'tupleCoord' | 'value' | 'side';

/** The part of one field a target owns (SPEC3 2.1). */
export interface UnitSpec {
    ref: FieldRef;
    role: UnitRole;
    /** levelItem: index into parseList(levels); tupleCoord: index into parseTuples(text, names). */
    item?: number;
    /** tupleCoord: 0 = x, 1 = y. */
    coord?: 0 | 1;
    /** clause: position in conditionClauseNodes(conditions[entry]). */
    disjunct?: number;
    clause?: number;
    /** body: the function kind (Phase 1: always 'cartesian'). */
    fnKind?: FunctionKind;
}

// ---------------------------------------------------------------- numbers

export type NumberKind = 'slider' | 'literal' | 'folded' | 'virtual';
export type NumberRole = 'offset' | 'shift' | 'coef';
export type VirtualKind = 'add' | 'factor' | 'shiftVar' | 'scaleVar';

export interface DragNumber {
    /** Stable within a drag: 's:c', 'l:<unit>@<pos>', 'f:<unit>@<pos>', 'v:<unit>:add', 'v:<unit>:factor@<pos>', 'v:<unit>:shift:<axis>', 'v:<unit>:scale:<axis>'. */
    id: string;
    kind: NumberKind;
    role: NumberRole;
    tier: 1 | 2 | 3 | 4;
    /** Unit index (literal, folded, virtual); -1 for sliders (they may appear in several units). */
    unit: number;
    /** Value at drag start; virtual: 0 (add, shiftVar) or 1 (factor, scaleVar). */
    value0: number;
    /** Ordering position in the unit's field text (SPEC3 2.2). */
    pos: number;
    /** literal: the NumNode; folded: the '/' BinaryNode (of the normalized AST). */
    node?: Node;
    /** literal: the number token span; folded: the division span (field text offsets). */
    span?: [number, number];
    virtual?: { kind: VirtualKind; target?: Node; axis?: 0 | 1 };
    param?: { name: string; min: number; max: number; step: number };
    /** Chip label: '6', 'c', '1/2'; virtual: 'k' (add), 'a' (factor), 'h' (shiftVar), 's' (scaleVar). */
    label: string;
    /**
     * Addition (graph form): the implicit coefficient of a side that is a lone axis variable, optionally signed
     * (the scaleVar of y in `y <= x^2`). Never a number of a pivot gesture: turns and stretches take their
     * coefficients from the function side (`y <= 2x^2`, not `0.5y <= x^2`).
     */
    output?: boolean;
}

// ------------------------------------------------------------------- hits

export type HitPart = PartRef | { part: 'curve' };

export interface HitShape {
    /** `${itemKey}#${partKey}`, e.g. 't0#clause:1:0:0', 'fn:f1#curve', 't3#point:0', '0#tangent'. */
    key: string;
    /** SceneItem2D.key (tool id or function index), or 'fn:<name>' for drawn function curves. */
    itemKey: string;
    source: string;
    kind: 'function' | 'tool';
    part: HitPart;
    /** Math coordinates. Curves: every run, in drawing order. */
    lines: Pt[][];
    point: Pt | null;
    /** Notable points on the part (region corners on a clause). */
    anchors: Pt[];
    locked: LockKind | null;
    /** Draw order: higher is drawn later (on top). */
    layer: number;
}

export interface HitTolerance {
    /** CSS px. Mouse / pen: 6 and 9; touch: 14 and 16. */
    line: number;
    point: number;
}

export interface Hit {
    shape: HitShape;
    /** Nearest point on the shape (math). */
    at: Pt;
    /** Index of the run in shape.lines that holds `at` (-1 for points). */
    run: number;
    distPx: number;
    /** A locked marker within the tolerance that the pick skipped in favour of `shape`. */
    passed: HitShape | null;
}

export interface HitIndex {
    pick(p: Pt, tol: HitTolerance, map: ScreenMap): Hit | null;
    byKey(key: string): HitShape | null;
    /** Every point shape (markers, vertices), locked ones included. */
    points(): readonly HitShape[];
    all(): readonly HitShape[];
}

// ---------------------------------------------------------------- targets

export type TargetKind = 'graph' | 'clause' | 'curve' | 'level' | 'point' | 'vertex' | 'path' | 'tangent' | 'label';
export type ShiftKind = 'turn' | 'stretch' | 'resize' | 'straight' | 'none';

export interface Lock {
    title: string;
    detail: string;
}

export interface DragTarget {
    /** Hit key after delegation (byKey re-resolves halos after renders). */
    key: string;
    source: string;
    /** Chip subject: 'f1', 'R1 (2)', 'C1 level 3.2', 'P1 point 2', 'S1', 'S1 point 2', 'f1 tangent', 'Label 2'. */
    subject: string;
    kind: TargetKind;
    units: UnitSpec[];
    straight: boolean;
    closed: boolean;
    allowSliders: boolean;
    virtual: VirtualKind[];
    shift: ShiftKind;
    lock: Lock | null;
    /** Polylines of the grabbed part (math) at resolve time: samples, ghost, halo. */
    lines: Pt[][];
    /** Grabbed run of `lines` (graphs), -1 = all. */
    run: number;
    /** Point-like targets: the points at resolve time (path: every vertex). */
    points: Pt[];
    /** level: the grabbed level's value and the equation text. */
    level?: { value: number; equation: string };
    /** tangent: the function name. */
    fn?: string;
    /** Phase 1: points-tool objectives with the same tokens as the dragged equation side. */
    twins: UnitSpec[];
    /** Card to sync and flash: 'f1', 'R1', 'label:2'. */
    cardSource: string;
    /** Field id for build.reveal / markLive: 'expression', 'condition:1', 'levels', 'points', 'path', 'x', 'tangentPoint', 'equation'. */
    cardField: string;
    /** Optional addition: tool names of `twins` (same order), for the chip note and the undo label. */
    twinNames?: string[];
    /** Optional addition: the locked marker the hit passed through (Hit.passed), for the chip note. */
    passed?: HitShape | null;
}

/** What the engine reads from the chart. The modal builds it after every render. */
export interface DragContext {
    functions: FunctionParameters[];
    tools: Tool[];
    annotations: Annotation[];
    parameters: Parameter[];
    /** Shared render context of the last render: derived values, function infos, deps. Read only. */
    math: MathContext;
    /** Input for the session's private context (settings.mathContextInput()). */
    mathInput: MathContextInput;
    hits: HitIndex;
    map: ScreenMap;
    /** Major tick positions (grid snapping). */
    ticks: { x: number[]; y: number[] };
    polar: boolean;
    /** Sliders read by any axis range text. */
    axisSliders: ReadonlySet<string>;
    keyNames: { mod: 'Cmd' | 'Ctrl'; alt: 'Option' | 'Alt' };
}

// ------------------------------------------------------------------- chip

export interface ChipPart {
    text: string;
    kind: 'plain' | 'num' | 'ghost' | 'changed';
}

export interface Chip {
    title: ChipPart[];
    detail: string;
    note: string;
    tone: 'normal' | 'locked' | 'tip';
}

// ----------------------------------------------------------------- frames

export interface FieldEdit {
    ref: FieldRef;
    text: string;
}

export interface ParamEdit {
    name: string;
    value: number;
}

export type Restriction = 'none' | 'vertical' | 'horizontal' | 'line' | 'fixed';

export interface DragFrame {
    edits: FieldEdit[];
    params: ParamEdit[];
    /** A function expression changed: the modal drops its context (rebuilt with memo:false). */
    structural: boolean;
    chip: Chip;
    /** Math coordinates for the overlay. */
    pivot: Pt | null;
    snapped: Pt | null;
    stuck: boolean;
    restricted: Restriction;
}

export interface FieldPatch {
    ref: FieldRef;
    before: string;
    after: string;
    /** Optional addition: display name for stale-undo texts, e.g. 'R1 (2)' or "P1's objective". */
    name?: string;
}

export interface ParamPatch {
    name: string;
    before: number;
    after: number;
}

export interface MakeSliderOffer {
    ref: FieldRef;
    /** Token span in the committed text (a parenthesized negative: the whole '(-2)'). */
    span: [number, number];
    value: number;
    twins: Array<{ ref: FieldRef; span: [number, number] }>;
}

export interface DragCommit {
    /** Undo bar text, e.g. 'Turned C1 and P1's objective'. */
    label: string;
    fields: FieldPatch[];
    params: ParamPatch[];
    makeSlider: MakeSliderOffer | null;
    /** Announcement after the drag, e.g. 'R1 (2): x + 3y <= 6.6'. */
    announce: string;
}

/** Compiled closure re-export for module signatures. */
export type { Compiled };
