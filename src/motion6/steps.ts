/*
 * Steps (6.0): `then` before an object line starts the next step. Every
 * function, surface, tool and label has a step (absent or 0: from the
 * start); a chart shown at step k draws the objects of steps 0 to k, the
 * later ones are hidden as if they were `hidden` (still computed when
 * another object reads them). The export and print show the last step.
 *
 * For later parts (D: `transform the plane by A` moves with its step):
 * stepProgress(frame, tool.step) is 0 before the object's step, 0..1 while
 * its step comes in, and 1 after it. Pure: no DOM, no Obsidian.
 */
import type { MotionFrame } from '../types';

type Data = Record<string, unknown>;

/** The lists of a chart whose objects have a step. */
export const STEP_LISTS = ['functions', 'functions3D', 'tools', 'annotations'] as const;
export type StepList = (typeof STEP_LISTS)[number];

/** Most steps a chart can have (a step number above it is read as this one). */
export const MAX_STEP = 99;

/** The step of an object: a whole number from 0 to MAX_STEP (anything else is 0). */
export function stepOf(obj: unknown): number {
    const v = obj && typeof obj === 'object' ? (obj as Data).step : undefined;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
    return Math.min(MAX_STEP, Math.floor(v));
}

function items(data: Data, list: StepList): Data[] {
    const v = data[list];
    return Array.isArray(v) ? v.filter((x): x is Data => !!x && typeof x === 'object' && !Array.isArray(x)) : [];
}

/** The last step of a chart (0: it has no steps). */
export function lastStep(data: Data): number {
    let last = 0;
    for (const list of STEP_LISTS) for (const o of items(data, list)) last = Math.max(last, stepOf(o));
    return last;
}

/** The chart has more than one step. */
export function hasSteps(data: Data): boolean {
    return lastStep(data) > 0;
}

/**
 * The chart as shown at `step`: a copy in which the objects of later steps
 * are hidden. `step` at or past the last step gives the chart itself.
 */
export function atStep<T extends Data>(data: T, step: number): T {
    if (!(step < lastStep(data))) return data;
    const out: Data = { ...data };
    for (const list of STEP_LISTS) {
        const v = data[list];
        if (!Array.isArray(v)) continue;
        out[list] = v.map((o: unknown) => (o && typeof o === 'object' && stepOf(o) > step ? { ...(o as Data), hidden: true } : o));
    }
    return out as T;
}

/**
 * How far an object of step `objectStep` is in the frame: 1 when its step
 * is behind the one shown (or there is no frame: the still picture), the
 * frame's progress in its own step, 0 before it.
 */
export function stepProgress(frame: MotionFrame | undefined, objectStep: number | undefined): number {
    if (!frame) return 1;
    const s = typeof objectStep === 'number' && objectStep > 0 ? Math.floor(objectStep) : 0;
    if (s < frame.step) return 1;
    if (s > frame.step) return 0;
    const p = frame.progress;
    return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 1;
}

/**
 * The steps of every list, when each list is in step order (what `then`
 * lines can write); null when some list is not (the steps are then written
 * as `step=k` options).
 */
export function stepsInOrder(data: Data): Record<StepList, number[]> | null {
    const out = {} as Record<StepList, number[]>;
    for (const list of STEP_LISTS) {
        const steps = items(data, list).map(stepOf);
        for (let i = 1; i < steps.length; i++) if (steps[i] < steps[i - 1]) return null;
        out[list] = steps;
    }
    return out;
}

/** A copy of an object without its step (a `then` line says it). */
export function withoutStep(obj: Data): Data {
    if (!('step' in obj)) return obj;
    const copy: Data = { ...obj };
    delete copy.step;
    return copy;
}

/** Tool types whose objects move with their step's progress (part D's transforms register theirs). */
const STEP_MOVERS = new Set<string>();

/** A tool type that animates while its step comes in (it reads stepProgress). */
export function registerStepMover(type: string): void {
    STEP_MOVERS.add(type);
}

/** Whether a chart has objects that move while their step comes in (the player then draws those frames). */
export function movesWithSteps(data: Data): boolean {
    const tools = data.tools;
    return Array.isArray(tools) && tools.some((t: unknown) => !!t && typeof t === 'object' && STEP_MOVERS.has(String((t as Data).type)) && stepOf(t) > 0);
}
