/*
 * The colours of a coloured plane (6.0 E), each twice: in JavaScript (the
 * CPU path and the PNG of the export, 64-bit) and in GLSL (the preview's
 * fragment shader), so both paint the same picture.
 *
 *   escape     an orbit that leaves |z| > 16 colours by its smooth speed
 *              through the cyclic map (or another map); one that stays is
 *              dark (INSIDE)
 *   basin      an orbit that settles colours by the point it reaches
 *              (hue from its angle, shifted by its size), darker the
 *              longer it took
 *   domain     f(z): hue = arg f, light from |f| with bands at powers of 2
 *   heat       f(x, y) through a colour map, its range the view's
 *
 * Pure: no DOM, no Obsidian.
 */
import type { Colormap, PlaneColormap } from '../types';
import { COLORMAP_STOPS, colormapRgb } from '../colormaps';
import { glslNumber } from '../values';

/** Channels 0..1. */
export type Rgb = [number, number, number];

/** An orbit is gone once |z|^2 is above this (|z| > 16): a large radius smooths the colours. */
export const ESCAPE2 = 256;
/** Two states closer than this (squared) are one: the orbit settled. */
export const SETTLE2 = 1e-12;
/** The colour of orbits that neither leave nor settle. */
export const INSIDE: Rgb = [0.035, 0.045, 0.1];

/** The cyclic map of fractals: navy, blue, sky, cream, orange, wine and back. */
const CYCLIC: Rgb[] = [
    [0.03, 0.06, 0.16],
    [0.13, 0.27, 0.72],
    [0.47, 0.76, 0.95],
    [0.99, 0.96, 0.86],
    [0.97, 0.64, 0.18],
    [0.42, 0.1, 0.17],
];

/** The basins' wheel: blue, orange, rose and back (the roots of z^3 - 1 land on the three). */
const WHEEL: Rgb[] = [
    [0.2, 0.36, 0.85],
    [0.96, 0.62, 0.16],
    [0.86, 0.3, 0.42],
];

function mixRgb(a: Rgb, b: Rgb, f: number): Rgb {
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function round(stops: Rgb[], t: number): Rgb {
    const n = stops.length;
    const u = (t - Math.floor(t)) * n;
    const i = Math.min(n - 1, Math.floor(u));
    return mixRgb(stops[i], stops[(i + 1) % n], u - i);
}

/** The cyclic map at t (it repeats every 1). */
export function cyclicRgb(t: number): Rgb {
    return round(CYCLIC, Number.isFinite(t) ? t : 0);
}

/** A colour map at t in 0..1 (cyclic: once round). */
export function mapRgb(map: PlaneColormap, t: number): Rgb {
    if (map === 'cyclic') return cyclicRgb(t);
    const c = colormapRgb(map, t);
    return [c[0] / 255, c[1] / 255, c[2] / 255];
}

/** The smooth speed of an orbit that left at step i with |z|^2 = d (about the step it left, without bands). */
export function smoothSpeed(i: number, d: number): number {
    return Math.max(0, i + 1 - Math.log2(Math.max(1e-300, 0.5 * Math.log(d))));
}

/** The colour of an orbit that left: the cyclic map turns slowly with the speed; another map spreads over the steps. */
export function escapeRgb(map: PlaneColormap, mu: number, steps: number): Rgb {
    if (map === 'cyclic') return cyclicRgb(Math.max(0, 0.2 * Math.log2(1 + mu) - 0.18));
    return mapRgb(map, Math.log(1 + mu) / Math.log(1 + Math.max(2, steps)));
}

/** The colour of an orbit that settled at w = (re, im) after i steps. */
export function basinRgb(re: number, im: number, i: number): Rgb {
    const size = Math.hypot(re, im);
    const t = Math.atan2(im, re) / (2 * Math.PI) + 0.15 * Math.log2(Math.max(1e-9, size));
    const c = round(WHEEL, t);
    const shade = 0.28 + 0.72 * Math.exp(-0.11 * i);
    return [c[0] * shade, c[1] * shade, c[2] * shade];
}

function hsl(h: number, s: number, l: number): Rgb {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
        const k = (n + h * 12) % 12;
        return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
}

/** Domain colouring of the value (re, im): null where it has none. */
export function domainRgb(re: number, im: number): Rgb | null {
    if (!Number.isFinite(re) || !Number.isFinite(im)) return null;
    const m = Math.hypot(re, im);
    const hue = (Math.atan2(im, re) / (2 * Math.PI) + 1) % 1;
    const band = Math.log2(m || 1e-300);
    let l = 0.08 + 0.84 * (2 / Math.PI) * Math.atan(Math.pow(m, 0.55));
    l *= 0.84 + 0.16 * (band - Math.floor(band));
    return hsl(hue, 0.78, Math.min(0.97, l));
}

// ------------------------------------------------------------------ GLSL

const vec3 = (c: Rgb) => `vec3(${c.map(glslNumber).join(', ')})`;

/** A GLSL function `name(float t)` mixing `stops` round (cyclic) or from 0 to 1. */
function glslStops(name: string, stops: Array<{ at: number; rgb: Rgb }>, cyclic: boolean): string {
    const lines = [`vec3 ${name}(float t) {`];
    if (cyclic) {
        const n = stops.length;
        lines.push(`    t = fract(t) * ${glslNumber(n)};`);
        for (let i = 0; i < n; i++) {
            const a = vec3(stops[i].rgb);
            const b = vec3(stops[(i + 1) % n].rgb);
            lines.push(i < n - 1 ? `    if (t < ${glslNumber(i + 1)}) return mix(${a}, ${b}, t - ${glslNumber(i)});` : `    return mix(${a}, ${b}, t - ${glslNumber(i)});`);
        }
    } else {
        lines.push('    t = clamp(t, 0.0, 1.0);');
        for (let i = 1; i < stops.length; i++) {
            const a = stops[i - 1];
            const b = stops[i];
            const span = b.at - a.at;
            const mixed = span > 0 ? `mix(${vec3(a.rgb)}, ${vec3(b.rgb)}, (t - ${glslNumber(a.at)}) / ${glslNumber(span)})` : vec3(b.rgb);
            lines.push(i < stops.length - 1 ? `    if (t <= ${glslNumber(b.at)}) return ${mixed};` : `    return ${mixed};`);
        }
    }
    lines.push('}');
    return lines.join('\n');
}

/** GLSL of the map `map` as `vec3 cmap(float t)` (the same colours as mapRgb). */
export function glslMap(map: PlaneColormap): string {
    if (map === 'cyclic') return glslStops('cmap', CYCLIC.map((rgb, i) => ({ at: i, rgb })), true);
    const stops = COLORMAP_STOPS[map as Colormap].map((s) => ({ at: s.at, rgb: [s.rgb[0] / 255, s.rgb[1] / 255, s.rgb[2] / 255] as Rgb }));
    return glslStops('cmap', stops, false);
}

/** GLSL of escapeRgb, basinRgb and domainRgb (after glslMap). */
export function glslColours(map: PlaneColormap): string {
    const escape =
        map === 'cyclic'
            ? 'vec3 escapeColour(float mu, float steps) { return cmap(max(0.0, 0.2 * log2(1.0 + mu) - 0.18)); }'
            : 'vec3 escapeColour(float mu, float steps) { return cmap(log(1.0 + mu) / log(1.0 + max(2.0, steps))); }';
    return [
        glslMap(map),
        glslStops('wheel', WHEEL.map((rgb, i) => ({ at: i, rgb })), true),
        `const vec3 INSIDE = ${vec3(INSIDE)};`,
        escape,
        'float smoothSpeed(float i, float d) { return max(0.0, i + 1.0 - log2(max(1e-30, 0.5 * log(d)))); }',
        'vec3 basinColour(vec2 w, float i) {',
        '    float t = atan(w.y, w.x) / 6.283185307179586 + 0.15 * log2(max(1e-9, length(w)));',
        '    return wheel(t) * (0.28 + 0.72 * exp(-0.11 * i));',
        '}',
        'vec3 hsl(float h, float s, float l) {',
        '    float a = s * min(l, 1.0 - l);',
        '    vec3 k = mod(vec3(0.0, 8.0, 4.0) + h * 12.0, 12.0);',
        '    return l - a * max(vec3(-1.0), min(min(k - 3.0, 9.0 - k), vec3(1.0)));',
        '}',
        'vec3 domainColour(vec2 w) {',
        '    float m = length(w);',
        '    float hue = fract(atan(w.y, w.x) / 6.283185307179586 + 1.0);',
        '    float band = log2(max(m, 1e-30));',
        '    float l = 0.08 + 0.84 * 0.6366197723675814 * atan(pow(m, 0.55));',
        '    l *= 0.84 + 0.16 * fract(band);',
        '    return hsl(hue, 0.78, min(0.97, l));',
        '}',
    ].join('\n');
}
