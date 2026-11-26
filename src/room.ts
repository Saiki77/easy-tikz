/*
 * 6.2.2: the room around the 2D plot while a hand moves the view.
 *
 * The room (the paddings that hold the numbers, the axis names and the
 * title) follows from the numbers in view: half of the first and the last x
 * number, the widest y number, an axis that comes near an edge of the view.
 * A pan brings a new grid line in at one edge and drops one at the other, so
 * the room changed from frame to frame, and the plot shrank and shifted under
 * the hand by a few pixels (the content also stopped following the hand: a
 * pan turns pixels into math units with the plot of its start).
 *
 * So the editor holds the room of the frame drawn before a pan, a wheel zoom
 * or an arrow key started to move the view: the plot keeps its size and place
 * for the whole gesture, and the content follows the hand (or stays under the
 * pointer of a zoom) exactly. A number or name that does not fit in the held
 * room is left out until it fits. When the hand lets go, the held room stays
 * while the chart's own room fits in it (nothing moves on release); when the
 * chart needs more room than is held (a wider number came in, an axis came to
 * an edge), the room eases to the chart's own in ROOM_EASE_MS. Charts that
 * nothing moves (in notes, in the export, a new editor) always get their own room.
 */
import type { RendererConfig } from './types';

/** Room around the plot, in viewBox units (the renderer's Padding). */
export interface Room {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/** How long the room takes to ease to the chart's own after a gesture that needs more room. */
export const ROOM_EASE_MS = 200;
/** Differences of room smaller than this (viewBox units) do not count. */
const ROOM_SLACK = 0.5;
const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Ease out: fast start, gentle landing (as motion.ts ease). */
function easeOut(k: number): number {
    const t = Math.max(0, Math.min(1, k));
    return 1 - Math.pow(1 - t, 3);
}

/**
 * What the room depends on besides the view: a held room belongs to the
 * chart (size, look, axes, names, title, numbers) it was held on. The view
 * itself is not part of it: the view is what the hand moves.
 */
export function roomKey(c: RendererConfig): string {
    return JSON.stringify([
        c.width,
        c.height,
        c.paperWidthCm ?? null,
        c.look ?? null,
        c.axes ?? null,
        c.axisStyle,
        c.showAxis !== false,
        !!c.showAxisLabels,
        String(c.xLabel ?? ''),
        String(c.yLabel ?? ''),
        !!String(c.title ?? '').trim(),
        c.numbers ?? null,
        c.majorTickNum,
        !!c.equalScale,
        c.coordinateSystem,
    ]);
}

/** A room the renderer can use on a width x height canvas: finite, not negative, and leaving a plot. */
export function usableRoom(room: Room | null | undefined, width: number, height: number): room is Room {
    if (!room) return false;
    if (!SIDES.every((s) => Number.isFinite(room[s]) && room[s] >= 0)) return false;
    return room.left + room.right < width - 1 && room.top + room.bottom < height - 1;
}

/** Every side of `own` fits in `held`: what the chart needs is held. */
export function roomFits(own: Room, held: Room): boolean {
    return SIDES.every((s) => own[s] <= held[s] + ROOM_SLACK);
}

/** The two rooms are the same (up to the slack). */
export function sameRoom(a: Room, b: Room): boolean {
    return SIDES.every((s) => Math.abs(a[s] - b[s]) <= ROOM_SLACK);
}

/** The room `k` (0 to 1) of the way from `a` to `b`, eased. */
export function easeRoom(a: Room, b: Room, k: number): Room {
    const e = easeOut(k);
    return { top: a.top + (b.top - a.top) * e, right: a.right + (b.right - a.right) * e, bottom: a.bottom + (b.bottom - a.bottom) * e, left: a.left + (b.left - a.left) * e };
}

/**
 * The editor's held room. A gesture grabs the room of the frame drawn last
 * (grab), every view it writes is recorded (moved), and every frame asks for
 * the room to draw with (roomFor: the held room while the chart and its range
 * are the ones the gesture left, else null for the chart's own). When the
 * hand lets go (release), the hold stays while the chart's own room fits in
 * it, or eases to the chart's own (step, once per animation frame).
 */
export class RoomHold {
    private held: { room: Room; key: string; range: string } | null = null;
    private ease: { from: Room; to: Room; start: number | null; at: number | null } | null = null;

    /** A hand starts to move the view of a chart (its room key) at `range`: hold `room`, the room of the frame drawn last. An ease that runs stops where it is. */
    grab(room: Room | null | undefined, key: string | null | undefined, range: string): void {
        this.ease = null;
        if (!room || typeof key !== 'string') {
            this.held = null;
            return;
        }
        this.held = { room: { ...room }, key, range };
    }

    /** The gesture wrote this range into the chart. */
    moved(range: string): void {
        if (this.held) this.held.range = range;
    }

    /** The room to draw the chart (key, range) with: the held one, or null for the chart's own. A hold that is not for this chart and range any more is dropped. */
    roomFor(key: string, range: string): Room | null {
        const h = this.held;
        if (!h) return null;
        if (h.key !== key || h.range !== range) {
            this.drop();
            return null;
        }
        return { ...h.room };
    }

    /**
     * The hand let go, and `own` is the chart's own room at the view it left
     * (null: not known). The held room stays when `own` fits in it; when they
     * are the same there is nothing to hold. Otherwise the room eases to `own`
     * (true: call step once per animation frame), or, with `still` (the system
     * asks for less motion), the hold is dropped and the next frame has the
     * chart's own room.
     */
    release(own: Room | null | undefined, still = false): boolean {
        const h = this.held;
        if (!h || this.ease) return false;
        if (!own || sameRoom(own, h.room)) {
            this.drop();
            return false;
        }
        if (roomFits(own, h.room)) return false;
        if (still) {
            this.drop();
            return false;
        }
        this.ease = { from: { ...h.room }, to: { ...own }, start: null, at: null };
        return true;
    }

    /**
     * One frame of the ease at `now` (ms, the time of the animation frame):
     * the room it draws with (roomFor returns it too), or null when the ease
     * is over and the hold is gone (the chart's own room from then on).
     */
    step(now: number): Room | null {
        const e = this.ease;
        const h = this.held;
        if (!e || !h) return null;
        if (e.start === null) e.start = now;
        const k = (now - e.start) / ROOM_EASE_MS;
        if (k >= 1) {
            this.drop();
            return null;
        }
        h.room = easeRoom(e.from, e.to, k);
        e.at = now;
        return { ...h.room };
    }

    /** A room is held. */
    holding(): boolean {
        return this.held !== null;
    }

    /** The room eases. */
    easing(): boolean {
        return this.ease !== null;
    }

    /** The ease has a frame to draw: any while it runs, or, given the time of the frame (the media toolkit's film clock), that frame. */
    pending(now?: number): boolean {
        return this.ease !== null && (now === undefined || this.ease.at !== now);
    }

    /** Forget the hold and the ease: the chart's own room from the next frame on. */
    drop(): void {
        this.held = null;
        this.ease = null;
    }
}
