/*
 * The tools of 6.0 B as data: their defaults and the completion of a stored
 * tool (src/migrate.ts calls these), their fields for the editor's rename
 * and its check of whether a name is still used, and what the auto-fit
 * holds of them. Pure: no DOM, no Obsidian.
 */
import type { AxisSetTool, ChordTool, Tool } from '../types';
import type { SceneItem2D } from '../scene';
import type { Pt } from '../geometry';
import type { Renamer } from '../beyond/tools';
import { THICKNESS_MAP } from '../colors';

export type AxisSetBody = Omit<AxisSetTool, 'id' | 'name' | 'hidden'>;
export type ChordBody = Omit<ChordTool, 'id' | 'name' | 'hidden'>;

export function axisSetDefaults(): AxisSetBody {
    return { type: 'axisSet', color: 'teal', condition: '', axis: 'x', thickness: 'very thick', label: '', valueLabel: false };
}

export function chordDefaults(): ChordBody {
    return { type: 'chord', color: 'red', function: '', from: '-1', to: '1', at: '', thickness: 'thick', dashed: false, label: '', valueLabel: false };
}

const text = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : fallback);
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const colour = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const thickness = (v: unknown, fallback: string): string => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(THICKNESS_MAP, v) ? v : fallback);

/** A stored set on an axis with every field filled in. */
export function completeAxisSet(src: Record<string, unknown>): AxisSetBody {
    const d = axisSetDefaults();
    return {
        type: 'axisSet',
        color: colour(src.color, d.color),
        condition: text(src.condition, d.condition),
        axis: src.axis === 'y' ? 'y' : 'x',
        thickness: thickness(src.thickness, d.thickness),
        label: text(src.label, d.label),
        valueLabel: flag(src.valueLabel, d.valueLabel),
    };
}

/** A stored chord with every field filled in. */
export function completeChord(src: Record<string, unknown>): ChordBody {
    const d = chordDefaults();
    return {
        type: 'chord',
        color: colour(src.color, d.color),
        function: text(src.function, d.function).trim(),
        from: text(src.from, d.from),
        to: text(src.to, d.to),
        at: text(src.at, d.at),
        thickness: thickness(src.thickness, d.thickness),
        dashed: flag(src.dashed, d.dashed),
        label: text(src.label, d.label),
        valueLabel: flag(src.valueLabel, d.valueLabel),
    };
}

/** Rewrite the fields of a tool of this part after a rename; false for any other tool. */
export function renameInNotes6Tool(t: Tool, r: Renamer): boolean {
    if (t.type === 'axisSet') {
        t.condition = r.expr(t.condition);
        t.label = r.tpl(t.label);
        return true;
    }
    if (t.type === 'chord') {
        if (r.kind === 'function') t.function = r.ref(t.function);
        t.from = r.expr(t.from);
        t.to = r.expr(t.to);
        t.at = r.expr(t.at);
        t.label = r.tpl(t.label);
        return true;
    }
    return false;
}

/** Does a tool of this part read the name (`reads(src, template)` tests one field)? */
export function notes6ToolReads(t: Tool, reads: (src: string | undefined, template?: boolean) => boolean): boolean {
    if (t.type === 'axisSet') return reads(t.condition) || reads(t.label, true);
    if (t.type === 'chord') return reads(t.function) || reads(t.from) || reads(t.to) || reads(t.at) || reads(t.label, true);
    return false;
}

/** The tool as the fit computes it: its labels left out (they never set the ranges). */
export function fitNotes6Tool(t: Tool): Tool {
    if (t.type === 'axisSet' || t.type === 'chord') return { ...t, label: '', valueLabel: false };
    return t;
}

/**
 * What a scene item of a tool of this part adds to the fit; null for other
 * tools. A set on an axis holds its ends (its dots), never its bar (that
 * runs to the edge of whatever view it is in); a chord holds its line and
 * its points.
 */
export function notes6FitShapes(tool: Tool, item: SceneItem2D): { points: Pt[]; lines: Array<{ pts: Pt[]; closed: boolean }>; unbounded?: boolean } | null {
    if (tool.type === 'axisSet') return { points: item.markers.map((m) => ({ x: m.x, y: m.y })), lines: [] };
    if (tool.type === 'chord') {
        return {
            points: item.markers.map((m) => ({ x: m.x, y: m.y })),
            lines: item.strokes.flatMap((s) => s.lines.map((pts) => ({ pts, closed: false }))),
        };
    }
    return null;
}
