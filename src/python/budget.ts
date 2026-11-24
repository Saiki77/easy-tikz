/*
 * 6.0 P: the budgets of a script run: steps (a statement, a loop turn, a
 * call; array work counts by its size), the depth of calls, and the time,
 * so a script cannot freeze the chart or a phone. One run at a time (the
 * plugin is single-threaded); a run inside a run keeps the outer one's.
 * Pure: no DOM, no Obsidian.
 */
import { PyError } from './errors';

export interface Budget {
    steps: number;
    maxSteps: number;
    depth: number;
    maxDepth: number;
    /** Date.now() past which the run stops (checked every 4096 steps). */
    deadline: number;
}

export const LIMITS = {
    /** Steps of one run of a script (the whole script, or one call from the chart). */
    steps: 2_000_000,
    /** Calls inside calls. */
    depth: 120,
    /** Milliseconds of one run. */
    ms: 1500,
};

export const budget: Budget = { steps: 0, maxSteps: LIMITS.steps, depth: 0, maxDepth: LIMITS.depth, deadline: Infinity };

let active = 0;

/** Run `fn` with fresh budgets (inside another run: the outer budgets go on). */
export function withBudget<T>(fn: () => T, limits: { steps?: number; ms?: number } = {}): T {
    if (active > 0) {
        active++;
        try {
            return fn();
        } finally {
            active--;
        }
    }
    budget.steps = 0;
    budget.maxSteps = limits.steps ?? LIMITS.steps;
    budget.depth = 0;
    budget.maxDepth = LIMITS.depth;
    budget.deadline = Date.now() + (limits.ms ?? LIMITS.ms);
    active = 1;
    try {
        return fn();
    } finally {
        active = 0;
        budget.deadline = Infinity;
    }
}

/** One step; throws when the steps or the time ran out. */
export function tick(): void {
    if (++budget.steps > budget.maxSteps) stepsOut();
    if ((budget.steps & 4095) === 0 && Date.now() > budget.deadline) timeOut();
}

/** Array work of n numbers (one step per 256). */
export function work(n: number): void {
    if (n < 256) return;
    budget.steps += n >> 8;
    if (budget.steps > budget.maxSteps) stepsOut();
    if (Date.now() > budget.deadline) timeOut();
}

function stepsOut(): never {
    throw new PyError('Budget', 'python.budget.steps', { count: budget.maxSteps.toLocaleString('en-US') });
}

function timeOut(): never {
    throw new PyError('Budget', 'python.budget.time', { ms: LIMITS.ms });
}
