/*
 * 6.0 D: what a click can ask about in a chart of this part (Ask the curve,
 * src/notes6/ask.ts): an arrow (the basis vectors, vector arrows) and a
 * transform (the moved grid and the functions a transform draws; a grid
 * with no transform asks for one). Pure: no DOM, no Obsidian.
 */
import type { Pt } from '../geometry';
import type { SceneItem2D } from '../scene';
import type { Tool } from '../types';
import { stepOf } from '../motion6/steps';

/** Lines a click may be near, the target they stand for, and a bias (px) against other targets. */
export interface LinearCandidate {
    lines: Pt[][];
    kind: 'vector' | 'transform';
    name: string;
    bias: number;
}

/** The transform that moves a tool (the first one below it, of its step or later, not hidden), or null. */
export function moverOf(tools: Tool[], name: string): Tool | null {
    const i = tools.findIndex((t) => t.name === name);
    if (i < 0) return null;
    const s = stepOf(tools[i]);
    return tools.slice(i + 1).find((t) => t.type === 'transform' && !t.hidden && stepOf(t) >= s) ?? null;
}

export function linearCandidates(items: SceneItem2D[], tools: Tool[]): LinearCandidate[] {
    const type = (name: string) => tools.find((x) => x.name === name)?.type;
    const out: LinearCandidate[] = [];
    for (const item of items) {
        if (item.kind !== 'tool') continue;
        const kind = type(item.source);
        const lines = item.strokes.filter((s) => s.color !== 'gray').flatMap((s) => s.lines);
        if (kind === 'vector' || kind === 'basisVectors') out.push({ lines, kind: 'vector', name: item.source, bias: -2 });
        else if (kind === 'transform') out.push({ lines, kind: 'transform', name: item.source, bias: 1 });
        else if (kind === 'planeGrid') out.push({ lines, kind: 'transform', name: moverOf(tools, item.source)?.name ?? item.source, bias: 3 });
    }
    return out;
}
