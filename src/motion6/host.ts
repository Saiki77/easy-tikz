/*
 * A player for a chart that needs one (6.0): steps, or objects that move by
 * themselves. Null otherwise: such a chart gets no buttons and no frame loop.
 */
import { MotionPlayer, PlayerHost } from './player';
import { lastStep, movesWithSteps } from './steps';
import { needsClock } from './clock';

type Data = Record<string, unknown>;

export function playerFor(data: Data, host: PlayerHost): MotionPlayer | null {
    const last = lastStep(data);
    const clock = needsClock(data);
    if (!last && !clock) return null;
    return new MotionPlayer(host, { last, clock, moversInSteps: movesWithSteps(data) });
}
