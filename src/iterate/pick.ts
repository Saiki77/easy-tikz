/*
 * 6.0 F1: what a click can ask about in a chart of part E (Ask the curve,
 * src/notes6/ask.ts): an orbit (its path and its dots) and a coloured
 * plane (a click anywhere on its picture). Reads the drawn scene only; the
 * drawing of orbits and planes is src/iterate/scene.ts. Pure: no DOM, no
 * Obsidian.
 */
import type { Pt } from '../geometry';
import type { SceneItem2D } from '../scene';
import type { Tool } from '../types';

/** Lines and dots of an orbit a click may be near. */
export interface OrbitCandidate {
    name: string;
    lines: Pt[][];
    dots: Pt[];
}

const typeOf = (tools: Tool[], name: string) => tools.find((x) => x.name === name)?.type;

export function orbitCandidates(items: SceneItem2D[], tools: Tool[]): OrbitCandidate[] {
    const out: OrbitCandidate[] = [];
    for (const item of items) {
        if (item.kind !== 'tool' || typeOf(tools, item.source) !== 'orbit') continue;
        out.push({ name: item.source, lines: item.strokes.flatMap((s) => s.lines), dots: item.markers.map((m) => ({ x: m.x, y: m.y })) });
    }
    return out;
}

/** The coloured plane drawn on top (the last one with a picture), or null. */
export function planeAt(items: SceneItem2D[], tools: Tool[]): string | null {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind === 'tool' && typeOf(tools, item.source) === 'colourPlane' && item.pixels && item.pixels.length) return item.source;
    }
    return null;
}
