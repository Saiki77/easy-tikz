/*
 * The pixel layer of 6.0 E: a picture over the plot that the scene
 * describes and the hosts paint (src/iterate/paint.ts: WebGL, or the CPU
 * in tiles; src/export.ts: a PNG). A PixelPrim holds both ways to paint
 * it: `tile` (64-bit, pure) and `shader` (a WebGL 1 fragment shader whose
 * sliders are uniforms). Both paint the same colours (colour.ts).
 *
 * Kinds: escape time (a recurrence over the plane), domain colouring (a
 * function of z), heat map (a function of x and y), and the bifurcation
 * diagram (a density of where orbits settle, CPU only).
 * Pure: no DOM, no Obsidian.
 */
import type { View } from '../geometry';
import type { MathContext } from '../mathcontext';
import type { PlaneColormap } from '../types';
import { GLSL_COMPLEX, compileComplex, compileValue, glslNumber, toGlsl } from '../values';
import type { ComplexFormula, GlslResult, Recurrence, RecurrenceStep, Value } from '../values';
import { compileRecurrence as compileStep } from '../values/recurrence';
import { ExprError } from '../expr';
import { t as msg } from '../i18n';
import { ESCAPE2, INSIDE, Rgb, SETTLE2, basinRgb, domainRgb, escapeRgb, glslColours, mapRgb, smoothSpeed } from './colour';

/** The fit holds the points whose orbit stays at least this many steps. */
const FIT_STAY = 8;
/** Steps per pixel at most (also the GLSL loop's bound). */
export const MAX_PIXEL_STEPS = 1000;
/** A bifurcation diagram's run-in and kept steps per column at most. */
export const BIFURCATION_RUN_IN = 400;
export const BIFURCATION_KEEP = 300;

export interface PixelUniform {
    uniform: string;
    read(): number;
}

/** A WebGL 1 fragment shader (GLSL ES 1.00): u_origin + gl_FragCoord.xy * u_step is the point; uniforms are the sliders. */
export interface PixelShader {
    source: string;
    uniforms: PixelUniform[];
}

/** A picture over the plot (SceneItem2D.pixels). */
export interface PixelPrim {
    /** The same key: the same picture of the same view (formula, sliders, steps, map). */
    key: string;
    /** 0..1, the whole layer. */
    opacity: number;
    /**
     * Paint pixels [x0, x1) x [y0, y1) of a w x h RGBA picture of `view`
     * (row 0 at the top, each pixel at its centre), 64-bit. A pixel with no
     * colour stays transparent (alpha 0).
     */
    tile(view: View, w: number, h: number, x0: number, y0: number, x1: number, y1: number, out: Uint8ClampedArray): void;
    /** The GPU's way, or null (the CPU only). */
    shader: PixelShader | null;
    /** About how many steps a pixel takes (the painter's budget). */
    cost: number;
    /** Whole columns are cheaper (a bifurcation diagram): tiles are strips of columns. */
    columns?: boolean;
    /** The box what it draws holds, for the fit; null when it covers the plane. */
    bounds?: () => View | null;
    // 6.0 ML
    /** Part of the still frame of something that moves (a picture of a script's frame(t)): hidden while the live canvas draws it. */
    still?: boolean;
}

// ---------------------------------------------------------------- shared

/** One step of a recurrence read already, in the scope of `ctx` (inputs hide the chart's names). Throws an ExprError. */
export function recurrenceStep(ctx: MathContext, rec: Recurrence, inputs: readonly string[] = []): RecurrenceStep {
    return compileStep(rec, ctx.envFor('value'), ctx.valueTable(), inputs);
}

function put(out: Uint8ClampedArray, k: number, c: Rgb | null): void {
    if (!c) {
        out[k + 3] = 0;
        return;
    }
    out[k] = Math.round(Math.max(0, Math.min(1, c[0])) * 255);
    out[k + 1] = Math.round(Math.max(0, Math.min(1, c[1])) * 255);
    out[k + 2] = Math.round(Math.max(0, Math.min(1, c[2])) * 255);
    out[k + 3] = 255;
}

/** Each pixel of a tile at its centre: (i, j) with i a column, j a row (0 at the top). */
function eachPixel(view: View, w: number, h: number, x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number, k: number) => void): void {
    const dx = (view.xmax - view.xmin) / w;
    const dy = (view.ymax - view.ymin) / h;
    for (let j = y0; j < y1; j++) {
        const y = view.ymax - (j + 0.5) * dy;
        for (let i = x0; i < x1; i++) fn(view.xmin + (i + 0.5) * dx, y, 4 * (j * w + i));
    }
}

/** The fragment shader around a body that sets `col` (vec4) from `p`. */
function shaderSource(map: PlaneColormap, uniforms: PixelUniform[], body: string[]): string {
    return [
        'precision highp float;',
        'uniform vec2 u_origin;',
        'uniform vec2 u_step;',
        'uniform float u_steps;',
        ...uniforms.map((u) => `uniform float ${u.uniform};`),
        GLSL_COMPLEX,
        glslColours(map),
        'void main() {',
        '    vec2 p = u_origin + gl_FragCoord.xy * u_step;',
        '    vec4 col = vec4(0.0);',
        ...body.map((l) => `    ${l}`),
        '    gl_FragColor = col;',
        '}',
    ].join('\n');
}

/** Uniforms of several toGlsl results, each once. */
function uniformsOf(results: GlslResult[]): PixelUniform[] {
    const seen = new Map<string, PixelUniform>();
    for (const r of results) for (const u of r.uniforms) if (!seen.has(u.uniform)) seen.set(u.uniform, { uniform: u.uniform, read: u.read });
    return Array.from(seen.values());
}

const asVec2 = (r: GlslResult) => (r.complex ? r.code : `vec2(${r.code}, 0.0)`);

// ------------------------------------------------------------ escape time

export interface EscapeSpec {
    rec: Recurrence;
    /** z_0 ('' = 0); reads x, y and the given names. */
    start: string;
    /** The names the recurrence reads, each a formula in x and y. */
    given: Array<{ name: string; value: string }>;
    steps: number;
    map: PlaneColormap;
    /** Orbits that settle colour by the point they reach (the plane is in z_0, the map is the same everywhere). */
    basins: boolean;
    opacity: number;
    key: string;
}

/**
 * The picture of a recurrence over the plane. Throws an ExprError when a
 * formula is no formula of complex numbers.
 */
export function escapePrim(ctx: MathContext, s: EscapeSpec): PixelPrim {
    const names = s.given.map((g) => g.name);
    const givens: ComplexFormula[] = s.given.map((g) => compileComplex(ctx, g.value, ['x', 'y']));
    const start = compileComplex(ctx, s.start.trim() || '0', ['x', 'y', ...names]);
    const step = recurrenceStep(ctx, s.rec, [...names, 'x', 'y']).complex;
    if (!step) throw new ExprError(msg('iterate.problem.notComplex'), { pos: 0 });
    const steps = Math.max(1, Math.min(MAX_PIXEL_STEPS, Math.round(s.steps)));
    const G = names.length;
    const gin = new Float64Array(4);
    const gout = new Float64Array(2);
    const sin = new Float64Array(2 * (2 + G));
    const inp = new Float64Array(2 * (1 + G + 2));
    const out = new Float64Array(2);
    /** The colour of the pixel at (x, y), and how long its orbit stayed (for the fit). */
    const colour = (x: number, y: number, n: number): { c: Rgb | null; stayed: number } => {
        gin[0] = x;
        gin[1] = 0;
        gin[2] = y;
        gin[3] = 0;
        sin[0] = x;
        sin[1] = 0;
        sin[2] = y;
        sin[3] = 0;
        for (let g = 0; g < G; g++) {
            givens[g].run(gin, gout);
            inp[2 + 2 * g] = sin[4 + 2 * g] = gout[0];
            inp[3 + 2 * g] = sin[5 + 2 * g] = gout[1];
        }
        inp[2 + 2 * G] = x;
        inp[3 + 2 * G] = 0;
        inp[4 + 2 * G] = y;
        inp[5 + 2 * G] = 0;
        start.run(sin, out);
        inp[0] = out[0];
        inp[1] = out[1];
        for (let i = 0; i < n; i++) {
            step.run(inp, out);
            const re = out[0];
            const im = out[1];
            const d = re * re + im * im;
            if (!(d <= ESCAPE2)) {
                if (Number.isNaN(d)) return { c: INSIDE, stayed: n };
                return { c: escapeRgb(s.map, smoothSpeed(i, d), n), stayed: i };
            }
            if (s.basins) {
                const ex = re - inp[0];
                const ey = im - inp[1];
                if (ex * ex + ey * ey < SETTLE2 * Math.max(1, d)) return { c: basinRgb(re, im, i), stayed: n };
            }
            inp[0] = re;
            inp[1] = im;
        }
        return { c: INSIDE, stayed: n };
    };

    // The GPU: the same orbit in vec2s, sliders as uniforms.
    let shader: PixelShader | null = null;
    try {
        const xy = { x: { glsl: 'p.x', complex: false }, y: { glsl: 'p.y', complex: false } };
        const g = s.given.map((gv) => toGlsl(ctx, gv.value, { inputs: xy }));
        const ins: Record<string, { glsl: string; complex: boolean }> = { ...xy };
        names.forEach((n, i) => (ins[n] = { glsl: `g_${i}`, complex: true }));
        const z0 = toGlsl(ctx, s.start.trim() || '0', { inputs: ins });
        const next = toGlsl(ctx, s.rec.formula, { inputs: { ...ins, [s.rec.current]: { glsl: 'z', complex: true } } });
        const uniforms = uniformsOf([...g, z0, next]);
        const body = [
            ...g.map((r, i) => `vec2 g_${i} = ${asVec2(r)};`),
            `vec2 z = ${asVec2(z0)};`,
            'col = vec4(INSIDE, 1.0);',
            `for (int i = 0; i < ${MAX_PIXEL_STEPS}; i++) {`,
            '    if (float(i) >= u_steps) break;',
            `    vec2 w = ${asVec2(next)};`,
            '    float d = dot(w, w);',
            `    if (!(d <= ${glslNumber(ESCAPE2)})) {`,
            '        if (!(d >= 0.0)) break;',
            '        col = vec4(escapeColour(smoothSpeed(float(i), d), u_steps), 1.0);',
            '        break;',
            '    }',
            ...(s.basins ? [`    if (dot(w - z, w - z) < ${glslNumber(SETTLE2)} * max(1.0, d)) { col = vec4(basinColour(w, float(i)), 1.0); break; }`] : []),
            '    z = w;',
            '}',
        ];
        shader = { source: shaderSource(s.map, uniforms, body), uniforms };
    } catch {
        shader = null;
    }

    return {
        key: s.key,
        opacity: s.opacity,
        shader,
        cost: steps,
        tile(view, w, h, x0, y0, x1, y1, buf) {
            eachPixel(view, w, h, x0, y0, x1, y1, (x, y, k) => put(buf, k, colour(x, y, steps).c));
        },
        bounds() {
            if (s.basins) return null;
            // Where orbits stay a while (the set and the halo of slow orbits around it), on a grid over |x|, |y| <= 3.
            const n = 64;
            const r = 3;
            let box: View | null = null;
            const few = Math.min(steps, 120);
            for (let j = 0; j < n; j++) {
                for (let i = 0; i < n; i++) {
                    const x = -r + ((i + 0.5) * 2 * r) / n;
                    const y = -r + ((j + 0.5) * 2 * r) / n;
                    if (colour(x, y, few).stayed < Math.min(few, FIT_STAY)) continue;
                    if (!box) box = { xmin: x, xmax: x, ymin: y, ymax: y };
                    else {
                        box.xmin = Math.min(box.xmin, x);
                        box.xmax = Math.max(box.xmax, x);
                        box.ymin = Math.min(box.ymin, y);
                        box.ymax = Math.max(box.ymax, y);
                    }
                }
            }
            if (!box) return null;
            const half = r / n;
            return { xmin: box.xmin - half, xmax: box.xmax + half, ymin: box.ymin - half, ymax: box.ymax + half };
        },
    };
}

// -------------------------------------------------------- domain colouring

/** The value of a typed result as (re, im), NaN when it is no number. */
function complexOf(v: Value): [number, number] {
    if (typeof v === 'number') return [v, 0];
    if (v && typeof v === 'object' && v.kind === 'complex') return [v.re, v.im];
    return [NaN, NaN];
}

/** Domain colouring of f(z) = body. Throws an ExprError for a formula that does not compile. */
export function domainPrim(ctx: MathContext, body: string, opacity: number, key: string): PixelPrim {
    let at: (x: number, y: number) => [number, number];
    try {
        const f = compileComplex(ctx, body, ['z']);
        const inp = new Float64Array(2);
        const out = new Float64Array(2);
        at = (x, y) => {
            inp[0] = x;
            inp[1] = y;
            f.run(inp, out);
            return [out[0], out[1]];
        };
    } catch {
        // Values the fast form has not (a let function, a sum): the typed compiler.
        const f = compileValue(ctx, body, ['z']);
        at = (x, y) => complexOf(f.run({ kind: 'complex', re: x, im: y }));
    }
    let shader: PixelShader | null = null;
    try {
        const g = toGlsl(ctx, body, { inputs: { z: { glsl: 'p', complex: true } } });
        const uniforms = uniformsOf([g]);
        const body2 = [`vec2 w = ${asVec2(g)};`, 'float m = dot(w, w);', 'if (m >= 0.0 && m < 1e37) col = vec4(domainColour(w), 1.0);'];
        shader = { source: shaderSource('cyclic', uniforms, body2), uniforms };
    } catch {
        shader = null;
    }
    return {
        key,
        opacity,
        shader,
        cost: 1,
        tile(view, w, h, x0, y0, x1, y1, buf) {
            eachPixel(view, w, h, x0, y0, x1, y1, (x, y, k) => {
                const [re, im] = at(x, y);
                put(buf, k, domainRgb(re, im));
            });
        },
        bounds: () => null,
    };
}

// ---------------------------------------------------------------- heat map

/** The lowest and highest value of F over the view (a 48 x 48 grid): the map's ends. */
export function heatRange(F: (x: number, y: number) => number, view: View): [number, number] | null {
    const n = 48;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const v = F(view.xmin + ((i + 0.5) * (view.xmax - view.xmin)) / n, view.ymin + ((j + 0.5) * (view.ymax - view.ymin)) / n);
            if (!Number.isFinite(v)) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
    }
    if (!Number.isFinite(lo)) return null;
    return hi > lo ? [lo, hi] : [lo - 1, hi + 1];
}

/** A heat map of F(x, y) = body through `map`, from lo to hi. `F` is the chart's own compile of the body. */
export function heatPrim(ctx: MathContext, body: string, F: (x: number, y: number) => number, range: [number, number], map: PlaneColormap, opacity: number, key: string): PixelPrim {
    const [lo, hi] = range;
    let shader: PixelShader | null = null;
    try {
        const g = toGlsl(ctx, body, { inputs: { x: { glsl: 'p.x', complex: false }, y: { glsl: 'p.y', complex: false } } });
        const uniforms = uniformsOf([g]);
        const v = g.complex ? `(${g.code}).x` : g.code;
        const body2 = [`float v = ${v};`, `if (v >= -1e37 && v <= 1e37) col = vec4(cmap((v - ${glslNumber(lo)}) / ${glslNumber(hi - lo)}), 1.0);`];
        shader = { source: shaderSource(map, uniforms, body2), uniforms };
    } catch {
        shader = null;
    }
    return {
        key,
        opacity,
        shader,
        cost: 1,
        tile(view, w, h, x0, y0, x1, y1, buf) {
            eachPixel(view, w, h, x0, y0, x1, y1, (x, y, k) => {
                const v = F(x, y);
                put(buf, k, Number.isFinite(v) ? mapRgb(map, (v - lo) / (hi - lo)) : null);
            });
        },
        bounds: () => null,
    };
}

// ------------------------------------------------------- bifurcation diagram

export interface BifurcationSpec {
    rec: Recurrence;
    parameter: string;
    from: number;
    to: number;
    start: number;
    /** 0..255 channels of the dots. */
    rgb: [number, number, number];
    key: string;
}

/** The step x -> F(x, r) of a bifurcation diagram (fast when it can be). Throws an ExprError. */
export function bifurcationStep(ctx: MathContext, rec: Recurrence, parameter: string): (x: number, r: number) => number {
    const step = recurrenceStep(ctx, rec, [parameter]);
    const fast = step.complex;
    if (fast) {
        const inp = new Float64Array(4);
        const out = new Float64Array(2);
        return (x, r) => {
            inp[0] = x;
            inp[2] = r;
            fast.run(inp, out);
            return out[0];
        };
    }
    return (x, r) => {
        const v = step.step(x, r);
        return typeof v === 'number' ? v : NaN;
    };
}

/** Where the orbit of x0 settles for one r: the kept values after the run-in. */
export function settledValues(F: (x: number, r: number) => number, r: number, x0: number, runIn = BIFURCATION_RUN_IN, keep = BIFURCATION_KEEP): number[] {
    let x = x0;
    for (let k = 0; k < runIn; k++) {
        x = F(x, r);
        if (!Number.isFinite(x) || Math.abs(x) > 1e12) return [];
    }
    const out: number[] = [];
    for (let k = 0; k < keep; k++) {
        x = F(x, r);
        if (!Number.isFinite(x) || Math.abs(x) > 1e12) break;
        out.push(x);
    }
    return out;
}

/** The bifurcation diagram as a density picture: each column one r, each kept value a hit of its row. */
/** 6.0 F4: the dots of a bifurcation diagram are this share of their colour's channels (a deeper shade). */
const DEEPER = 0.78;

export function bifurcationPrim(F: (x: number, r: number) => number, s: BifurcationSpec): PixelPrim {
    return {
        key: s.key,
        opacity: 1,
        shader: null,
        cost: BIFURCATION_RUN_IN + BIFURCATION_KEEP,
        columns: true,
        tile(view, w, h, x0, y0, x1, y1, buf) {
            const dx = (view.xmax - view.xmin) / w;
            const dy = (view.ymax - view.ymin) / h;
            const hits = new Float64Array(h);
            for (let i = x0; i < x1; i++) {
                const r = view.xmin + (i + 0.5) * dx;
                for (let j = y0; j < y1; j++) buf[4 * (j * w + i) + 3] = 0;
                if (r < Math.min(s.from, s.to) || r > Math.max(s.from, s.to)) continue;
                hits.fill(0);
                for (const x of settledValues(F, r, s.start)) {
                    const j = Math.floor((view.ymax - x) / dy);
                    if (j >= y0 && j < y1) hits[j]++;
                }
                for (let j = y0; j < y1; j++) {
                    if (!hits[j]) continue;
                    const k = 4 * (j * w + i);
                    // Sparse rows faint, often-visited rows full (as the plan's prototype).
                    // 6.0 F4: a deeper shade of the colour and a stronger start, so the chaotic part reads as a density.
                    const a = Math.min(1, 0.38 + Math.sqrt(hits[j] * (300 / BIFURCATION_KEEP)) * 0.34);
                    buf[k] = s.rgb[0] * DEEPER;
                    buf[k + 1] = s.rgb[1] * DEEPER;
                    buf[k + 2] = s.rgb[2] * DEEPER;
                    buf[k + 3] = Math.round(a * 255);
                }
            }
        },
        bounds() {
            // The values over r from `from` to `to` (40 columns).
            let lo = Infinity;
            let hi = -Infinity;
            for (let i = 0; i < 40; i++) {
                const r = s.from + ((i + 0.5) * (s.to - s.from)) / 40;
                for (const x of settledValues(F, r, s.start, 200, 100)) {
                    lo = Math.min(lo, x);
                    hi = Math.max(hi, x);
                }
            }
            if (!Number.isFinite(lo)) return null;
            return { xmin: Math.min(s.from, s.to), xmax: Math.max(s.from, s.to), ymin: lo, ymax: hi > lo ? hi : lo + 1 };
        },
    };
}

/** A whole picture (export, SVG files): w x h RGBA. */
export function paintAll(prim: PixelPrim, view: View, w: number, h: number): Uint8ClampedArray {
    const buf = new Uint8ClampedArray(w * h * 4);
    prim.tile(view, w, h, 0, 0, w, h, buf);
    if (prim.opacity < 1) for (let k = 3; k < buf.length; k += 4) buf[k] = Math.round(buf[k] * Math.max(0, prim.opacity));
    return buf;
}
