/*
 * 6.0 F1: Ask the curve (6.0 B's menu) learns two more kinds of part E:
 *
 *   an orbit           more steps, fewer steps, its points labelled z₀, z₁, ...
 *   a coloured plane   made from a recurrence whose plane point is x + iy (the
 *                      Mandelbrot set: c = x + iy; a Julia set: z_0 = x + iy):
 *                      "The orbit of this point" adds a point P at the click
 *                      and `draw the orbit of ...` with that point in place
 *                      of x + iy.
 *
 * Registered when this module loads (src/notes6/askHost.ts imports it).
 * Pure: no DOM.
 */
import { registerQuestions } from '../notes6/ask';
import type { AskContext, Question } from '../notes6/ask';
import type { OrbitTool, PlaneColourTool } from '../types';
import { readRecurrence } from '../values/recurrence';
import { givenParts } from './tools';
import { t } from '../i18n';

/** Most steps of an orbit (src/iterate/scene.ts MAX_ORBIT). */
const MAX_STEPS = 2000;
/** Steps of the orbit "The orbit of this point" adds. */
const ORBIT_STEPS = 40;

/** A whole number of steps written as a number, else null (a formula or a slider). */
function plainSteps(src: string): number | null {
    const s = src.trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function orbitQuestions(ctx: AskContext): Question[] {
    const tool = ctx.tools.find((x): x is OrbitTool => x.name === ctx.target.name && x.type === 'orbit');
    if (!tool) return [];
    const group = t('iterate.ask.orbitGroup', { name: tool.name });
    const out: Question[] = [];
    const steps = plainSteps(tool.steps || '40');
    if (steps !== null) {
        const more = Math.min(MAX_STEPS, steps * 2);
        const fewer = Math.max(1, Math.round(steps / 2));
        if (more > steps) out.push({ id: 'orbit-more', group, label: t('iterate.ask.moreSteps', { steps: more }), answer: { patch: { list: 'tools', name: tool.name, on: { steps: String(more) }, off: { steps: String(steps) } } } });
        if (fewer < steps) out.push({ id: 'orbit-fewer', group, label: t('iterate.ask.fewerSteps', { steps: fewer }), answer: { patch: { list: 'tools', name: tool.name, on: { steps: String(fewer) }, off: { steps: String(steps) } } } });
    }
    out.push({ id: 'orbit-labels', group, label: t('iterate.ask.labelPoints'), answer: { patch: { list: 'tools', name: tool.name, on: { valueLabel: true }, off: { valueLabel: false } } } });
    return out;
}

/** Is this value the point of the plane, x + iy (also x + yi, x + i y, (x, y))? */
export function isPlanePoint(value: string): boolean {
    const s = value
        .replace(/\$/g, '')
        .replace(/\\left|\\right|\\,|\\cdot|\*|\s+/g, '')
        .toLowerCase();
    return s === 'x+iy' || s === 'x+yi' || s === '(x,y)';
}

export function planeQuestions(ctx: AskContext): Question[] {
    const tool = ctx.tools.find((x): x is PlaneColourTool => x.name === ctx.target.name && x.type === 'colourPlane');
    if (!tool) return [];
    const rec = readRecurrence(tool.formula.trim());
    if (!rec) return [];
    const given = givenParts(tool.given);
    const start = tool.start.trim() || '0';
    // The point of the plane stands in the start or in a name the recurrence reads; nowhere else.
    const inStart = isPlanePoint(start);
    const inGiven = given.filter((g) => isPlanePoint(g.value));
    if (!inStart && !inGiven.length) return [];
    const reads = (v: string) => /(^|[^A-Za-z\\])[xy]([^A-Za-z]|$)/.test(v);
    if ((!inStart && reads(start)) || given.some((g) => !isPlanePoint(g.value) && reads(g.value))) return [];
    const p = ctx.freeName('P');
    const point = (v: string) => (isPlanePoint(v) ? p : v);
    const bind = (name: string, value: string) => `$${name} = ${value}$`;
    const orbit = [`draw the orbit of ${ctx.formula(tool.formula.trim())}`, bind(`${rec.state}_0`, point(start)), ...given.map((g) => bind(g.name, point(g.value))), `${ORBIT_STEPS} steps`].join(', ');
    return [
        {
            id: 'plane-orbit',
            group: t('iterate.ask.planeGroup', { name: tool.name }),
            label: t('iterate.ask.orbitHere'),
            answer: { lines: [`mark ${p} at (${ctx.num(ctx.target.x)}, ${ctx.num(ctx.target.y)})`, orbit] },
        },
    ];
}

registerQuestions('orbit', orbitQuestions);
registerQuestions('plane', planeQuestions);
