/*
 * 6.0 G: the GeoGebra line as data: its defaults, what the migration keeps
 * of a stored one, and its fields for the editor's rename (the pattern of
 * src/iterate/tools.ts). Pure: no DOM, no Obsidian.
 */
import type { GeoGebraTool, Tool } from '../types';
import type { Renamer } from '../beyond/tools';
import { THICKNESS_MAP } from '../colors';

type Data = Record<string, unknown>;
export type GeoGebraBody = Omit<GeoGebraTool, 'id' | 'name' | 'hidden'>;

/** The name prefix of a bare command: G1, G2, ... */
export const GEOGEBRA_PREFIX = { geogebra: 'G' } as const;

export function geogebraDefaults(): GeoGebraBody {
    return { type: 'geogebra', command: '', named: true, color: '', thickness: '', dashed: false, size: '', fillOpacity: -1, nameLabel: 'auto', label: '' };
}

/** A stored GeoGebra line with every field it needs (unknown values give way to the defaults); null for other types. */
export function completeGeoGebraTool(src: Data): GeoGebraBody | null {
    if (src.type !== 'geogebra') return null;
    const d = geogebraDefaults();
    const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
    const thickness = typeof src.thickness === 'string' && (src.thickness === '' || Object.prototype.hasOwnProperty.call(THICKNESS_MAP, src.thickness)) ? src.thickness : d.thickness;
    const size = src.size === 'small' || src.size === 'normal' || src.size === 'large' ? src.size : d.size;
    const opacity = typeof src.fillOpacity === 'number' && Number.isFinite(src.fillOpacity) && src.fillOpacity <= 1 ? Math.max(-1, src.fillOpacity) : d.fillOpacity;
    const nameLabel = src.nameLabel === 'shown' || src.nameLabel === 'hidden' ? src.nameLabel : d.nameLabel;
    return {
        type: 'geogebra',
        command: str(src.command, d.command),
        named: typeof src.named === 'boolean' ? src.named : d.named,
        color: str(src.color, d.color).trim(),
        thickness,
        dashed: typeof src.dashed === 'boolean' ? src.dashed : d.dashed,
        size,
        fillOpacity: opacity,
        nameLabel,
        label: str(src.label, d.label),
    };
}

/** Rewrite the fields of a GeoGebra line after a rename. */
export function renameInGeoGebraTool(t: Tool, r: Renamer): void {
    if (t.type !== 'geogebra') return;
    t.command = renameCommand(t.command, r);
    t.label = r.tpl(t.label);
}

/** The command renamed; the text of a Text("...") stays as it is. */
function renameCommand(command: string, r: Renamer): string {
    const parts = command.split(/("(?:[^"\\]|\\.)*")/);
    if (parts.length === 1) return r.expr(command);
    // Rename each piece outside the quotes on its own (the expressions between them).
    return parts.map((p, i) => (i % 2 ? p : p ? r.expr(p) : p)).join('');
}

/** Does a GeoGebra line read the name? */
export function geogebraToolReads(t: Tool, reads: (src: string | undefined, template?: boolean) => boolean): boolean {
    if (t.type !== 'geogebra') return false;
    const outside = t.command.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    return reads(outside) || reads(t.label, true);
}
