/*
 * The animation clock (6.0): objects that move by themselves (the moving
 * particles of a vector field; later E's turning circles) ask for it. A
 * chart with such an object gets a Pause / Play button in its strip; the
 * note and the editor then draw a frame on every animation frame while the
 * chart is on screen (src/motion6/player.ts), each with the clock's time in
 * RendererConfig.motion, which the renderer hands to the scene. The export
 * never runs the clock: it draws the still frame (time 0, or the chart's
 * `stillTime`). A chart without moving objects runs no frame loop at all.
 *
 * For later parts: a tool type that moves calls registerClockType(type, moves)
 * once at load; scene code reads clockTime(input.motion). Pure: no DOM.
 */
import type { MotionFrame, Tool } from '../types';

type Data = Record<string, unknown>;

/** The still frame: the export, print, and every chart before its first clock frame. */
export const STILL: MotionFrame = { time: 0, step: Infinity, progress: 1 };

/** Tool types that move by themselves, with whether a tool of the type does (its options may turn it off). */
const CLOCK_TYPES = new Map<string, (tool: Tool) => boolean>();

/** A tool type whose tools move by themselves when `moves` says so. */
export function registerClockType(type: string, moves: (tool: Tool) => boolean): void {
    CLOCK_TYPES.set(type, moves);
}

// The vector field's moving particles (src/motion6/scene.ts).
registerClockType('vectorField', (t) => t.type === 'vectorField' && t.particles === true);
// 6.0 F4: a solution that draws itself.
registerClockType('trajectory', (t) => t.type === 'trajectory' && t.traced === true);

/** Whether a tool moves by itself (a hidden one never does). */
export function movesByItself(tool: unknown): boolean {
    if (!tool || typeof tool !== 'object') return false;
    const t = tool as Tool;
    if (t.hidden === true) return false;
    const moves = CLOCK_TYPES.get(String(t.type));
    return !!moves && moves(t);
}

/** Whether a chart (its tools) needs the clock. */
export function needsClock(data: Data): boolean {
    const tools = data.tools;
    return turns(data) || (Array.isArray(tools) && tools.some(movesByItself)); // 6.0 F4: turns
}

// 6.0 F4: a 3D chart that turns by itself (chart line `turning`).

/** Degrees a turning 3D view turns a second: once round in half a minute. */
export const TURN_DEG_PER_S = 12;
/** Degrees a sideways drag turns it per pixel (as the editor's drag). */
export const TURN_DRAG_DEG_PER_PX = 0.5;

/** Whether the chart is a 3D chart that turns by itself. */
export function turns(data: Data): boolean {
    return data.turning === true && data.dimension === true;
}

/**
 * The turn of a turning view, for a host: the angle follows the clock, and a
 * drag holds it (the drag turns the view itself; the turn goes on from
 * there when it ends).
 */
export class Turn {
    private from = 0;
    private held = false;

    /** Degrees turned at clock time `time` (0 while held). */
    angle(time: number): number {
        if (this.held) this.from = time;
        return (time - this.from) * TURN_DEG_PER_S;
    }

    /** A drag starts (true) or ends (false) at clock time `time`: the turn starts again from 0 there. */
    hold(on: boolean, time: number): void {
        this.held = on;
        this.from = time;
    }
}

/** The time a scene draws: the frame's, or 0 for the still frame. */
export function clockTime(frame: MotionFrame | undefined): number {
    return frame && Number.isFinite(frame.time) ? frame.time : 0;
}

/** The still frame of a chart: time `stillTime` (a chart field, seconds) or 0, every step. */
export function stillFrame(stillTime: unknown): MotionFrame {
    const t = typeof stillTime === 'number' && Number.isFinite(stillTime) && stillTime >= 0 ? stillTime : 0;
    return t ? { ...STILL, time: t } : STILL;
}
