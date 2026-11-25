/*
 * The steps of one chart on screen over time (6.0): the step chosen, the
 * step drawn, how far it has come in, and when Play may go on. The player
 * (player.ts) runs it on animation frames; it holds no DOM and no clock of
 * its own, so the tests drive it with plain numbers.
 *
 *   Next (or Play): the new step comes in. Transforms move over PROGRESS_MS
 *   (`progress`, stepProgress); the step's other objects enter by kind for
 *   entranceMs of the chart (`enter`, src/motion6/entrances.ts).
 *   Previous: the objects of the step that leaves fade out over LEAVE_MS
 *   (`leave`), then the step before shows, settled. Nothing plays backwards.
 *   Play from the last step (and a page that plays its chart once) starts
 *   again at the first step, which then comes in too.
 *   Play goes on when a step has fully come in and has stood for STEP_MS
 *   (at least HOLD_MS after its entrance).
 */
import type { MotionFrame } from '../types';
import { LEAVE_MS } from './entrances';

/** How long a step stays when the steps play. */
export const STEP_MS = 1600;
/** How long a step takes to come in for the objects that move with it (transforms: progress 0 to 1). */
export const PROGRESS_MS = 700;
/** Play holds a step at least this long after its objects have come in. */
export const HOLD_MS = 650;

export interface GoOptions {
    /** Things may move (false when the system asks for less motion). */
    motion: boolean;
    /** The objects of a step enter by kind (the setting and the chart allow it). */
    entrances: boolean;
    /** How long step `k` takes to come in (ms, entranceMs of the chart). */
    enterMs(k: number): number;
    /** Play moves the steps: going back to the first step lets it come in again. */
    fromPlay?: boolean;
}

/** What a step of time asks the host for: nothing, a quick frame, or the settled picture drawn whole. */
export type Advance = 'none' | 'frame' | 'settle';

export class StepTimeline {
    /** The last step of the chart (0: no steps). */
    readonly last: number;
    /** The chart has objects that move with their step (transforms). */
    private readonly movers: boolean;
    /** The step chosen (what "Step k of n" says). */
    step: number;
    /** How far the shown step has come in for transforms, 0..1. */
    progress = 1;
    /** ms since the shown step came in while its objects enter; null when they stand. */
    enter: number | null = null;
    /** How long the current entrance takes (0: none). */
    enterTotal = 0;
    /** Previous: the step whose objects fade out, and for how long they have. */
    leaving: { from: number; ms: number } | null = null;
    /** How long the step has been on while the steps play (ms of frames). */
    stepTime = 0;

    constructor(last: number, movers: boolean) {
        this.last = Math.max(0, Math.floor(last));
        this.movers = movers;
        this.step = this.last;
    }

    /** The step drawn: the one that leaves while it fades out, else the step chosen. */
    shown(): number {
        return this.leaving ? this.leaving.from : this.step;
    }

    /** The frame at clock time `time`. */
    frame(time: number): MotionFrame {
        const shown = this.shown();
        const f: MotionFrame = { time, step: shown >= this.last ? Infinity : shown, progress: this.progress, index: shown };
        if (this.enter !== null) f.enter = this.enter;
        if (this.leaving) f.leave = Math.min(1, this.leaving.ms / LEAVE_MS);
        return f;
    }

    /** Something is under way: a transform moving, objects coming in, or objects fading out. */
    busy(): boolean {
        return this.progress < 1 || this.enter !== null || this.leaving !== null;
    }

    /** Choose step `k` (clamped). Returns whether anything changed. */
    go(k: number, o: GoOptions): boolean {
        const to = Math.max(0, Math.min(this.last, Math.round(k)));
        const before = this.step;
        if (to === before && !o.fromPlay) return false;
        this.leaving = null;
        this.enter = null;
        this.enterTotal = 0;
        this.stepTime = 0;
        const forward = to > before;
        // Transforms move from 0 to 1 when their step comes in; going back shows a step settled.
        this.progress = forward && this.movers && o.motion ? 0 : 1;
        this.step = to;
        if (!o.motion || !o.entrances) return true;
        if (forward || o.fromPlay) {
            // Play from the end starts again: the first step comes in from nothing.
            const total = Math.max(0, o.enterMs(to));
            if (total > 0) {
                this.enter = 0;
                this.enterTotal = total;
            }
        } else if (before - to === 1) {
            // Previous: the step's objects fade out (a fade under way is dropped: its step goes at once).
            this.leaving = { from: before, ms: 0 };
        }
        return true;
    }

    /** `dt` ms of frames went by. */
    advance(dt: number, playing: boolean): Advance {
        const ms = Number.isFinite(dt) && dt > 0 ? dt : 0;
        let ended = false;
        if (this.enter !== null) {
            this.enter += ms;
            if (this.enter >= this.enterTotal) {
                this.enter = null;
                ended = true;
            }
        }
        if (this.leaving) {
            this.leaving.ms += ms;
            if (this.leaving.ms >= LEAVE_MS) {
                this.leaving = null;
                ended = true;
            }
        }
        if (this.progress < 1) {
            this.progress = Math.min(1, this.progress + ms / PROGRESS_MS);
            if (this.progress >= 1) ended = true;
        }
        if (playing) this.stepTime += ms;
        if (this.busy()) return 'frame';
        return ended ? 'settle' : 'none';
    }

    /** Play may go on to the next step: this one has come in and stood long enough. */
    ready(): boolean {
        return !this.busy() && this.stepTime >= Math.max(STEP_MS, this.enterTotal + HOLD_MS);
    }
}
