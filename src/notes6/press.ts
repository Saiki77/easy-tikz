/*
 * 6.0 F1: a long press of a finger on a chart asks it a question (Ask the
 * curve), as a tap does: the menu opens while the finger is still down. A
 * finger that moves (a pan, a scroll) or lifts first is no long press. The
 * editor's preview (src/modal.ts) and the chart under a block in Live
 * Preview (main.ts) each keep one.
 */

/** How long a finger rests before the menu opens, in ms. */
export const LONG_PRESS_MS = 500;
/** How far a resting finger may move, in px. */
const SLOP_PX = 10;

export class LongPress {
    private timer = 0;
    private win: Window | null = null;
    private at: { id: number; x: number; y: number } | null = null;
    private fired = -1;

    /** `fire` gets the client px where the finger rests; true when it opened something. */
    constructor(private readonly fire: (x: number, y: number) => boolean) {}

    /** A pointer went down: a finger starts the wait. */
    down(e: PointerEvent): void {
        this.cancel();
        this.fired = -1;
        if (e.pointerType !== 'touch' || e.button !== 0) return;
        const at = { id: e.pointerId, x: e.clientX, y: e.clientY };
        this.at = at;
        this.win = activeWindow;
        this.timer = this.win.setTimeout(() => {
            this.timer = 0;
            this.at = null;
            if (this.fire(at.x, at.y)) this.fired = at.id;
        }, LONG_PRESS_MS);
    }

    /** A pointer moved: a finger that left its spot is no long press. */
    move(e: PointerEvent): void {
        const at = this.at;
        if (at && e.pointerId === at.id && Math.hypot(e.clientX - at.x, e.clientY - at.y) > SLOP_PX) this.cancel();
    }

    /** The press of this pointer ends (up or cancel): true when it was a long press that asked (the tap asks nothing more). */
    end(e: PointerEvent): boolean {
        if (this.at && this.at.id === e.pointerId) this.cancel();
        const fired = this.fired === e.pointerId;
        this.fired = -1;
        return fired;
    }

    /** A finger rests (or rested and asked): the platform's own long-press menu stays away. */
    busy(): boolean {
        return this.at !== null || this.fired !== -1;
    }

    cancel(): void {
        if (this.timer && this.win) this.win.clearTimeout(this.timer);
        this.timer = 0;
        this.at = null;
    }
}
