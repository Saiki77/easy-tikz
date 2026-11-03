/*
 * Colour maps by height for 3D surfaces. A surface with a map takes the
 * colour of each patch from its height: t = 0 at the bottom of the box and
 * 1 at its top (diverging spreads over a range symmetric about z = 0, so its
 * light middle is z = 0). The stops are pgfplots' own maps (viridis, hot2,
 * cool, jet, blackwhite) plus one the export writes inline (diverging), and
 * the preview mixes them linearly in RGB as pgfplots does, so it shows the
 * colours the PDF prints.
 *
 * Pure: the migration, the chart text, the renderer, the export, the surface
 * card and the tests share it.
 */
import type { Colormap } from './types';
import { t } from './i18n';
import type { MessageKey } from './i18n';

/** The maps, in the order the surface card and the chart words list them. */
export const COLORMAPS: readonly Colormap[] = ['viridis', 'heat', 'cool', 'diverging', 'rainbow', 'greyscale'];

type Rgb = readonly [number, number, number];

/** One stop of a map: where it sits (0..1) and its colour as 0..255 channels. */
export interface ColormapStop {
    at: number;
    rgb: Rgb;
}

/** Stops spread evenly over 0..1, the way pgfplots places entries written without a position. */
function evenly(colours: readonly Rgb[]): ColormapStop[] {
    return colours.map((rgb, i) => ({ at: i / (colours.length - 1), rgb }));
}

/** pgfplots' colormap/viridis: 18 entries, channels as fractions of 1. */
const VIRIDIS: readonly Rgb[] = [
    [0.267, 0.00487, 0.32942],
    [0.28192, 0.08966, 0.41241],
    [0.28026, 0.1657, 0.4765],
    [0.26366, 0.23763, 0.51877],
    [0.23744, 0.3052, 0.54192],
    [0.20862, 0.36775, 0.55267],
    [0.18225, 0.42618, 0.55711],
    [0.1592, 0.48224, 0.55807],
    [0.13777, 0.53749, 0.5549],
    [0.12115, 0.59274, 0.54465],
    [0.12808, 0.64775, 0.5235],
    [0.18065, 0.7014, 0.48819],
    [0.27415, 0.75198, 0.4366],
    [0.39517, 0.79747, 0.36775],
    [0.53561, 0.83578, 0.2819],
    [0.68895, 0.86545, 0.18272],
    [0.84557, 0.88733, 0.0997],
    [0.99324, 0.90616, 0.14394],
];

/** The stops of every map, lowest first. */
export const COLORMAP_STOPS: Readonly<Record<Colormap, readonly ColormapStop[]>> = {
    viridis: evenly(VIRIDIS.map(([r, g, b]) => [r * 255, g * 255, b * 255] as const)),
    // colormap/hot2: black, red at 3/8, yellow at 6/8, white.
    heat: [
        { at: 0, rgb: [0, 0, 0] },
        { at: 3 / 8, rgb: [255, 0, 0] },
        { at: 6 / 8, rgb: [255, 255, 0] },
        { at: 1, rgb: [255, 255, 255] },
    ],
    // colormap/cool: white, azure, magenta.
    cool: evenly([
        [255, 255, 255],
        [0, 128, 255],
        [255, 0, 255],
    ]),
    // Blue below, near white at z = 0, red above (pgfplots has no such map: colormapOption writes it).
    diverging: evenly([
        [33, 102, 172],
        [247, 247, 247],
        [178, 24, 43],
    ]),
    // colormap/jet.
    rainbow: [
        { at: 0, rgb: [0, 0, 128] },
        { at: 1 / 8, rgb: [0, 0, 255] },
        { at: 3 / 8, rgb: [0, 255, 255] },
        { at: 5 / 8, rgb: [255, 255, 0] },
        { at: 7 / 8, rgb: [255, 0, 0] },
        { at: 1, rgb: [128, 0, 0] },
    ],
    // colormap/blackwhite.
    greyscale: evenly([
        [0, 0, 0],
        [255, 255, 255],
    ]),
};

/** pgfplots' name of each built-in map the export picks (diverging is written inline instead). */
const PGF_NAMES: Readonly<Record<Exclude<Colormap, 'diverging'>, string>> = {
    viridis: 'viridis',
    heat: 'hot2',
    cool: 'cool',
    rainbow: 'jet',
    greyscale: 'blackwhite',
};

/** Each map's name for people: keys, shown with t() where the name is shown (the language is set after this module loads). */
export const COLORMAP_NAMES: Readonly<Record<Colormap, MessageKey>> = {
    viridis: 'build.colormap.viridis',
    heat: 'build.colormap.heat',
    cool: 'build.colormap.cool',
    diverging: 'build.colormap.diverging',
    rainbow: 'build.colormap.rainbow',
    greyscale: 'build.colormap.greyscale',
};

export function isColormap(v: unknown): v is Colormap {
    return typeof v === 'string' && (COLORMAPS as readonly string[]).includes(v);
}

/** The map's name in the reader's language. */
export function colormapName(map: Colormap): string {
    return t(COLORMAP_NAMES[map]);
}

/** The colour of a map at t (0 lowest, 1 highest, clamped) as 0..255 channels, mixed linearly between its two stops. */
export function colormapRgb(map: Colormap, t: number): [number, number, number] {
    const stops = COLORMAP_STOPS[map];
    const k = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
    let i = 1;
    while (i < stops.length - 1 && stops[i].at < k) i++;
    const a = stops[i - 1];
    const b = stops[i];
    const u = b.at > a.at ? (k - a.at) / (b.at - a.at) : 0;
    return [a.rgb[0] + (b.rgb[0] - a.rgb[0]) * u, a.rgb[1] + (b.rgb[1] - a.rgb[1]) * u, a.rgb[2] + (b.rgb[2] - a.rgb[2]) * u];
}

/** 0..255 channels as CSS, rounded: `rgb(68,1,84)`. */
export function rgbCss(rgb: readonly number[]): string {
    return `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
}

/** The colour of a map at t as CSS. */
export function colormapCss(map: Colormap, t: number): string {
    return rgbCss(colormapRgb(map, t));
}

/**
 * The heights a map spreads over in a box from zmin to zmax: the box's z
 * range; for diverging -m..m with m = max(|zmin|, |zmax|), so that its middle
 * is z = 0.
 */
export function colormapRange(map: Colormap, zmin: number, zmax: number): [number, number] {
    if (map !== 'diverging') return [zmin, zmax];
    const m = Math.max(Math.abs(zmin), Math.abs(zmax));
    return m > 0 ? [-m, m] : [zmin, zmax];
}

/**
 * The pgfplots option that colours one `\addplot3` with the map:
 * `colormap/viridis` (also hot2, cool, jet, blackwhite), and for diverging
 * its definition, `colormap={etDiverging}{rgb255=(..) ...}`. Neither needs a
 * library.
 */
export function colormapOption(map: Colormap): string {
    if (map === 'diverging') {
        const entries = COLORMAP_STOPS.diverging.map((s) => `rgb255=(${s.rgb.join(',')})`);
        return `colormap={etDiverging}{${entries.join(' ')}}`;
    }
    return `colormap/${PGF_NAMES[map]}`;
}
