/*
 * Line opacities shared by the previews and the export: the grid of a chart
 * and the mesh lines on a filled 3D surface. The defaults are the look the
 * plugin had before the sliders existed, so charts that never set them do
 * not change. Pure: no DOM, no Obsidian.
 */

/** Opacity of the major grid lines (chart field `gridOpacity`); minor grid lines draw at half of it. */
export const GRID_OPACITY = 0.5;

/** Opacity of the mesh lines on a filled surface (surface field `meshOpacity`); 0 draws a smooth surface. */
export const MESH_OPACITY = 0.4;

/** A stored opacity clamped to 0..1, or `fallback` when it is not a finite number. */
export function opacityValue(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}
