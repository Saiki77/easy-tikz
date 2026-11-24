/*
 * 6.0 D: drag the tip of an arrow whose numbers are those of a let value:
 * î and ĵ moved by a matrix (their tips are its columns), the arrows of let
 * vectors. The drag writes the new numbers into the text of the value
 * (`let A = ...`, or the transform's own matrix when it is written there),
 * when every entry there is a plain number. The scene (src/linear/scene.ts)
 * puts the handles on the tips with the parts { part: 'tip', owner,
 * entries, base }; the modal drives a TipSession as it drives the solver's
 * DragSession (src/drag/session.ts startSession). Pure: no DOM, no Obsidian.
 */
import type { Chip, DragCommit, DragContext, DragFrame, DragTarget, FieldEdit, FieldRef, Gesture, HitShape, Lock, Mods, ParamEdit, Pt } from '../drag/types';
import type { HoverInfo } from '../drag/describe';
import type { PreparedDrag } from '../drag/session';
import type { Tool } from '../types';
import { fieldText } from '../drag/targets';
import { t } from '../i18n';

/** The part of a handle a tip drag reads (src/scene.ts PartRef 'tip'). */
export interface TipPart {
    part: 'tip';
    index: number;
    owner: string;
    entries: number[];
    base?: [number, number];
}

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const NUM = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;

/**
 * The places of the numbers of a matrix or vector written as numbers
 * (`[[1, 1], [0, 1]]`, `(2, 1)`, `\begin{pmatrix} 1 & 1 \\ 0 & 1 \end{pmatrix}`),
 * in order; null when anything else stands in it (a name, a formula).
 */
export function numberSlots(text: string): Array<{ start: number; end: number; value: number }> | null {
    const skeleton = text
        .replace(/\\(?:begin|end)\s*\{\s*[pbB]?matrix\s*\}/g, '')
        .replace(/\\(?:left|right)(?![A-Za-z])/g, '')
        .replace(NUM, '');
    if (!/^[\s[\](),&\\]*$/.test(skeleton)) return null;
    const out: Array<{ start: number; end: number; value: number }> = [];
    for (const m of text.matchAll(NUM)) {
        const start = m.index ?? 0;
        // A number inside \begin{...}: none (the names hold no digits), but keep the check cheap and exact.
        out.push({ start, end: start + m[0].length, value: Number(m[0]) });
    }
    return out.length ? out : null;
}

/** The text with the numbers at `slots[k]` replaced by `values[k]`. */
function rewrite(text: string, slots: Array<{ start: number; end: number }>, values: Map<number, string>): string {
    let out = text;
    const order = [...values.keys()].sort((a, b) => slots[b].start - slots[a].start);
    for (const k of order) out = out.slice(0, slots[k].start) + values.get(k) + out.slice(slots[k].end);
    return out;
}

/** Where the numbers of a tip live: the field, its owner's name, and the tool. */
interface Owner {
    ref: FieldRef;
    name: string;
    /** The let name the numbers belong to (for the chip). */
    label: string;
}

function ownerOf(part: TipPart, tools: Tool[]): Owner | null {
    const tool = tools.find((x) => x.name === part.owner);
    if (!tool) return null;
    if (tool.type === 'value') return { ref: { kind: 'tool', id: tool.id, field: 'expression' }, name: tool.name, label: tool.name };
    if (tool.type === 'transform') {
        const map = tool.map.trim();
        if (NAME.test(map)) {
            const def = tools.find((x) => x.type === 'value' && x.name === map);
            return def ? { ref: { kind: 'tool', id: def.id, field: 'expression' }, name: def.name, label: def.name } : null;
        }
        return { ref: { kind: 'tool', id: tool.id, field: 'map' }, name: tool.name, label: tool.name };
    }
    return null;
}

const lockOf = (name: string): Lock => ({ title: t('linear.drag.notNumbers', { name }), detail: '' });

/** The drag target of a tip handle (src/drag/targets.ts calls it for parts 'tip'). */
export function tipTarget(shape: HitShape, part: TipPart, ctx: DragContext): DragTarget {
    const owner = ownerOf(part, ctx.tools || []);
    const name = owner ? owner.label : part.owner;
    const target: DragTarget = {
        key: shape.key,
        source: shape.source,
        subject: t('linear.drag.tip', { name: shape.source }),
        kind: 'tip',
        units: [],
        straight: false,
        closed: false,
        allowSliders: false,
        virtual: [],
        shift: 'none',
        lock: null,
        lines: [],
        run: -1,
        points: shape.point ? [shape.point] : [],
        twins: [],
        cardSource: owner ? owner.name : shape.source,
        cardField: owner && owner.ref.kind === 'tool' && owner.ref.field === 'map' ? 'map' : 'expression',
    };
    const text = owner ? fieldText(owner.ref, ctx) : null;
    const slots = text !== null ? numberSlots(text) : null;
    if (!owner || !slots || part.entries.some((e) => e >= slots.length)) return { ...target, lock: lockOf(name) };
    return target;
}

/** What a tip drag knows when it starts. */
interface TipCore {
    part: TipPart;
    owner: Owner;
    text: string;
    slots: Array<{ start: number; end: number; value: number }>;
    grab: Pt;
}

function coreOf(target: DragTarget, grab: Pt, ctx: DragContext): TipCore | null {
    const shape = ctx.hits.byKey(target.key);
    if (!shape || shape.part.part !== 'tip') return null;
    const part = shape.part;
    const owner = ownerOf(part, ctx.tools || []);
    if (!owner) return null;
    const text = fieldText(owner.ref, ctx);
    const slots = text !== null ? numberSlots(text) : null;
    if (text === null || !slots || part.entries.some((e) => e >= slots.length)) return null;
    return { part, owner, text, slots, grab };
}

/** A planned tip drag (the hover chip, and what the press starts). */
export class TipPlan implements PreparedDrag {
    readonly target: DragTarget;
    readonly gesture: Gesture;
    readonly grab: Pt;
    readonly info: HoverInfo;
    readonly chip: Chip;
    readonly core: TipCore;

    constructor(target: DragTarget, gesture: Gesture, core: TipCore) {
        this.target = target;
        this.gesture = gesture;
        this.grab = core.grab;
        this.core = core;
        const spans = core.part.entries.map((e): [number, number] => [core.slots[e].start, core.slots[e].end]);
        this.info = {
            target,
            gesture,
            text: core.text,
            numSpans: spans,
            ghosts: [],
            virtualKinds: [],
            restricted: 'none',
            pivot: null,
            sharedSliders: [],
            twins: [],
            passed: null,
            shiftLock: null,
        };
        const nums = core.part.entries.map((e) => String(core.slots[e].value));
        this.chip = chipOf(core, nums, 'num');
    }
}

function chipOf(core: TipCore, nums: string[], kind: 'num' | 'changed'): Chip {
    const detail = core.part.base === undefined && core.owner.ref.kind === 'tool' ? t('linear.drag.column', { k: core.part.index + 1, name: core.owner.label }) : t('linear.drag.tip', { name: core.owner.label });
    return { title: [{ text: `${core.owner.label}: (`, kind: 'plain' }, { text: nums.join(', '), kind }, { text: ')', kind: 'plain' }], detail, note: '', tone: 'normal' };
}

/** Plan a tip drag (src/drag/session.ts prepareDrag calls it for targets of kind 'tip'). */
export function prepareTip(target: DragTarget, grab: Pt, gesture: Gesture, ctx: DragContext): PreparedDrag | { lock: Lock } {
    if (target.lock) return { lock: target.lock };
    const core = coreOf(target, grab, ctx);
    if (!core) return { lock: lockOf(target.cardSource) };
    return new TipPlan(target, gesture, core);
}

export function isTipPlan(p: PreparedDrag): p is TipPlan {
    return p instanceof TipPlan;
}

/** Decimals a drag writes: about 8 px per step of the last digit (Alt: ten times finer). */
function decimalsFor(kx: number, fine: boolean): number {
    const d = Math.ceil(Math.log10(Math.max(1e-9, kx) / 8));
    return Math.max(0, Math.min(4, d + (fine ? 1 : 0)));
}

function numberText(v: number, decimals: number): string {
    const r = Number(v.toFixed(decimals));
    return String(Object.is(r, -0) ? 0 : r);
}

/** A running tip drag: the modal drives it as it drives a DragSession. */
export class TipSession {
    readonly target: DragTarget;
    readonly ghost: Pt[][];
    private readonly core: TipCore;
    private readonly ctx: DragContext;
    private text: string;
    private finished = false;
    private nudged: Pt = { x: 0, y: 0 };

    constructor(plan: TipPlan, ctx: DragContext) {
        this.core = plan.core;
        this.ctx = ctx;
        this.target = plan.target;
        this.ghost = plan.target.points.map((p) => [p]);
        this.text = plan.core.text;
    }

    get done(): boolean {
        return this.finished;
    }

    /** The tip follows the cursor (math): its numbers are the cursor less the arrow's start. */
    update(cursor: Pt, mods: Mods): DragFrame {
        const core = this.core;
        const base = core.part.base ?? [0, 0];
        const decimals = decimalsFor(Math.min(this.ctx.map.kx, this.ctx.map.ky), mods.alt);
        const nums = [cursor.x - base[0], cursor.y - base[1]].map((v) => numberText(v, decimals));
        const values = new Map<number, string>();
        core.part.entries.slice(0, 2).forEach((e, k) => values.set(e, nums[k]));
        this.text = rewrite(core.text, core.slots, values);
        const edits: FieldEdit[] = [{ ref: core.owner.ref, text: this.text }];
        return { edits, params: [], structural: true, chip: chipOf(core, nums, 'changed'), pivot: null, snapped: null, stuck: false, restricted: 'none' };
    }

    nudgeBy(delta: Pt, mods: Mods): DragFrame {
        this.nudged = { x: this.nudged.x + delta.x, y: this.nudged.y + delta.y };
        const at = this.target.points[0] ?? this.core.grab;
        return this.update({ x: at.x + this.nudged.x, y: at.y + this.nudged.y }, mods);
    }

    commit(): DragCommit | null {
        if (this.finished) return null;
        this.finished = true;
        if (this.text === this.core.text) return null;
        const name = this.core.owner.label;
        return {
            label: t('linear.drag.moved', { name, value: this.text }),
            subject: name,
            fields: [{ ref: this.core.owner.ref, before: this.core.text, after: this.text, name }],
            params: [],
            makeSlider: null,
            announce: t('linear.drag.moved', { name, value: this.text }),
        };
    }

    cancel(): { edits: FieldEdit[]; params: ParamEdit[] } {
        this.finished = true;
        return { edits: [{ ref: this.core.owner.ref, text: this.core.text }], params: [] };
    }
}
