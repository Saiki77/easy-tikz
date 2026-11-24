/*
 * 6.0 P: a python block as scene primitives. Its matplotlib calls
 * (pyplot.ts Draw) become strokes, fills, markers, texts and a pixel layer
 * (imshow), in the chart's theme colours, so the preview and the pgfplots
 * export draw them alike. A script with `def frame(t)` moves on the clock:
 * the preview's live canvas draws frame(time), the export the still frame
 * (frame at 0 or the chart's stillTime). Problems name the script's line.
 * Pure: no DOM.
 */
import type { MotionFrame, PythonTool, Tool } from '../types';
import type { Pt, View } from '../geometry';
import type { MathContext } from '../mathcontext';
import type { FillPrim, MarkerPrim, SceneCtx, SceneItem2D, SceneOutput, SceneTextSpec, StrokePrim } from '../scene';
import { addIssue, fail, newOutput } from '../scene';
import type { TextAnchor } from '../scene';
import { t as msg } from '../i18n';
import { clockTime, registerClockType } from '../motion6/clock';
import type { LiveShapes } from '../motion6/liveprims';
import { emptyShapes } from '../motion6/liveprims';
import type { PixelPrim } from '../iterate/pixels';
import { mapRgb } from '../iterate/colour';
import { Draw, FIRST, Figure, MAP_RGB } from './pyplot';
import { PyError } from './errors';
import { chartProgram, inputsOf } from './defs';
import { programOf } from './program';
import type { Program, RunResult } from './program';
import { hashText } from './program';

MAP_RGB.fn = (map, t) => mapRgb(map, t);

/** A script with frame(t) moves by itself (the chart gets a clock). */
export const FRAME_DEF = /^def\s+frame\s*\(/m;
registerClockType('python', (t) => t.type === 'python' && FRAME_DEF.test(t.code));

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** What a python tool hands the pass after the memo and the fit. */
interface PythonHeld {
    result: RunResult;
    block: number;
    /** frame(t) is drawn by this block. */
    moves: boolean;
    view: View;
    fit: Pt[];
}

const HELD = new WeakMap<object, PythonHeld>();

function pythonOf(ctx: SceneCtx): { program: Program; ids: string[]; codes: string[] } {
    const tools = Array.from(ctx.toolsByName.values()).filter((t): t is PythonTool => t.type === 'python');
    const codes = tools.map((t) => t.code);
    return { program: programOf(codes), ids: tools.map((t) => t.id), codes };
}

/** The chart's numbers a script reads, now. */
function reader(ctx: SceneCtx): (name: string) => number | undefined {
    const env = ctx.math.envFor('value');
    return (name) => (NAME_RE.test(name) ? env.scalar(name)?.read() : undefined);
}

/**
 * Producers and sources of a python tool, for the scene's graph and cache
 * keys: the names its script reads, and those every script of the chart
 * reads (they share one scope).
 */
export function pythonSources(t: Tool, scan: (src: unknown, field: string) => void, math: MathContext): boolean {
    if (t.type !== 'python') return false;
    const reads = new Set(programOf([t.code]).reads);
    for (const d of math.valueTable().definitions()) if (d.native) for (const n of d.expression.split(',')) if (n.trim()) reads.add(n.trim());
    if (reads.size) scan(Array.from(reads).join(', '), 'code');
    return true;
}

/** The still frame of a moving script into its scene item (after the memo; never changes the cached arrays). */
export function addPythonMotion(item: SceneItem2D, out: SceneOutput, frame: MotionFrame | undefined, issue: (message: string) => void): void {
    const moving = pythonMotion(item.kind === 'tool' ? TOOL_OF.get(out.fills) : undefined, out, frame);
    if (!moving) return;
    item.strokes = item.strokes.concat(moving.strokes);
    item.markers = item.markers.concat(moving.markers);
    if (moving.fills.length) {
        item.fills = item.fills.concat(moving.fills);
        const held = HELD.get(out.fills);
        if (held) HELD.set(item.fills, held);
    }
    if (moving.problem) issue(moving.problem);
}

/** The tool of each python output (by its fills array). */
const TOOL_OF = new WeakMap<object, Tool>();

/** The text of a problem of the script: "Line 4 of the script: ...". */
export function problemText(e: PyError, blocks: number, inFrame = false): string {
    const message = e.message;
    if (!e.line) return message;
    if (inFrame) return msg('python.problem.inFrame', { line: e.line, message });
    if (blocks > 1) return msg('python.problem.atBlock', { line: e.line, block: e.block + 1, message });
    return msg('python.problem.at', { line: e.line, message });
}

export function computePython(t: Tool, ctx: SceneCtx): SceneOutput | null {
    if (t.type !== 'python') return null;
    const out = newOutput();
    if (!t.code.trim()) return out;
    const { program, ids, codes } = pythonOf(ctx);
    const block = Math.max(0, ids.indexOf(t.id));
    const result = program.run(inputsOf(program, reader(ctx)));
    const err = result.error;
    if (err && err.block === block) fail(out, t.name, 'code', problemText(err, ids.length));
    else if (err && err.block < block) addIssue(out, t.name, 'code', msg('python.problem.earlier', { block: err.block + 1 }), 'info');
    const printed = result.printed.filter((p) => p.block === block).map((p) => p.text);
    if (printed.length) addIssue(out, t.name, 'code', msg('python.problem.printed', { text: printed.slice(0, 6).join(' | ') }), 'info');
    const view = { ...ctx.view };
    const fit: Pt[] = [];
    const fig = result.figure;
    const draws = fig.draws.filter((_, i) => fig.blocks[i] === block);
    const first = t.color || 'blue';
    drawInto(out, draws, view, fit, false, first);
    // The axes' own texts (title, labels, legend) go with the first block.
    if (block === 0) axesTexts(out, fig, view, first);
    if (fig.xlim) fit.push({ x: fig.xlim[0], y: NaN }, { x: fig.xlim[1], y: NaN });
    if (fig.ylim) fit.push({ x: NaN, y: fig.ylim[0] }, { x: NaN, y: fig.ylim[1] });
    // frame(t) is drawn by the block that defines it (the last block when none says `def frame(`).
    const moves = !!result.frame && (FRAME_DEF.test(t.code) || (block === ids.length - 1 && !codes.some((c) => FRAME_DEF.test(c))));
    HELD.set(out.fills, { result, block, moves, view, fit });
    TOOL_OF.set(out.fills, t);
    if (moves) {
        out.live = [
            {
                key: `${t.id}:frame`,
                at: (time) => {
                    const f = result.frameAt(time);
                    return liveShapes(f.figure.draws, view, first);
                },
            },
        ];
    }
    return out;
}

/**
 * The moving part of a script at the frame's time (the still frame: 0 or
 * the chart's stillTime), marked still: the preview's live canvas draws it
 * instead; the export, print and the SVG files draw these. Called after the
 * scene memo. Null for other tools.
 */
export function pythonMotion(tool: Tool | undefined, out: SceneOutput, frame: MotionFrame | undefined): { strokes: StrokePrim[]; fills: FillPrim[]; markers: MarkerPrim[]; problem: string | null } | null {
    if (!tool || tool.type !== 'python') return null;
    const held = HELD.get(out.fills);
    if (!held || !held.moves) return null;
    const f = held.result.frameAt(clockTime(frame));
    const still = newOutput();
    drawInto(still, f.figure.draws, held.view, null, true, tool.color || 'blue');
    return {
        strokes: still.strokes,
        fills: still.fills,
        markers: still.markers,
        problem: f.error ? problemText(f.error, 1, true) : null,
    };
}

/** What a python item adds to the fit; null for other tools. */
export function pythonFitShapes(tool: Tool, item: SceneItem2D): { points: Pt[]; lines: Array<{ pts: Pt[]; closed: boolean }>; unbounded?: boolean } | null {
    if (tool.type !== 'python') return null;
    const held = HELD.get(item.fills);
    if (!held) return { points: [], lines: [] };
    // A point with one coordinate (xlim, axhline) takes the other from a point that has both.
    const both = held.fit.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const any = both[0] ?? { x: 0, y: 0 };
    const points = held.fit.map((p) => ({ x: Number.isFinite(p.x) ? p.x : any.x, y: Number.isFinite(p.y) ? p.y : any.y }));
    const fig = held.result.figure;
    // xlim and ylim are the box: nothing else counts on that axis.
    const kept = points.filter((p) => (!fig.xlim || (p.x >= fig.xlim[0] && p.x <= fig.xlim[1])) && (!fig.ylim || (p.y >= fig.ylim[0] && p.y <= fig.ylim[1])));
    return { points: kept, lines: [] };
}

/**
 * The view of a 2D chart with python blocks and no range of its own (the
 * default one): the scripts' xlim and ylim, else what they draw with
 * matplotlib's margins. Null when they draw nothing.
 */
export function pythonView(tools: unknown, math: MathContext): View | null {
    const program = chartProgram(tools);
    if (!program) return null;
    const env = math.envFor('value');
    const result = program.run(inputsOf(program, (name) => (NAME_RE.test(name) ? env.scalar(name)?.read() : undefined)));
    return drawnBox(result);
}

/** The box a script's drawing holds (its xlim and ylim where it set them), for a chart with no range of its own. */
export function drawnBox(result: RunResult): View | null {
    const fig = result.figure;
    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    const add = (x: number, y: number) => {
        if (Number.isFinite(x)) {
            xmin = Math.min(xmin, x);
            xmax = Math.max(xmax, x);
        }
        if (Number.isFinite(y)) {
            ymin = Math.min(ymin, y);
            ymax = Math.max(ymax, y);
        }
    };
    const draws = [...fig.draws];
    if (result.frame) draws.push(...result.frameAt(0).figure.draws);
    for (const d of draws) {
        switch (d.k) {
            case 'line':
                d.pts.forEach((p) => add(p[0], p[1]));
                break;
            case 'dots':
                d.pts.forEach((p) => add(p[0], p[1]));
                break;
            case 'fill':
                d.ring.forEach((p) => add(p[0], p[1]));
                break;
            case 'arrow':
                add(d.from[0], d.from[1]);
                add(d.to[0], d.to[1]);
                break;
            case 'text':
                add(d.x, d.y);
                break;
            case 'circle':
                add(d.x - d.r, d.y - d.r);
                add(d.x + d.r, d.y + d.r);
                break;
            case 'image':
                add(d.extent[0], d.extent[2]);
                add(d.extent[1], d.extent[3]);
                break;
            case 'hline':
                add(NaN, d.y);
                break;
            case 'vline':
                add(d.x, NaN);
                break;
        }
    }
    // matplotlib's margins: 5 % on each side of what is drawn.
    const pad = (lo: number, hi: number): [number, number] => {
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [NaN, NaN];
        if (hi - lo < 1e-12) return [lo - 1, hi + 1];
        const m = 0.05 * (hi - lo);
        return [lo - m, hi + m];
    };
    const [x0, x1] = fig.xlim ?? pad(xmin, xmax);
    const [y0, y1] = fig.ylim ?? pad(ymin, ymax);
    if (![x0, x1, y0, y1].every(Number.isFinite)) return null;
    return { xmin: x0, xmax: x1, ymin: y0, ymax: y1 };
}

// ------------------------------------------------------------ draws to primitives

const RING_LEGS = 96;

function finiteRuns(pts: Array<[number, number]>): Pt[][] {
    const runs: Pt[][] = [];
    let run: Pt[] = [];
    for (const [x, y] of pts) {
        if (Number.isFinite(x) && Number.isFinite(y)) run.push({ x, y });
        else {
            if (run.length) runs.push(run);
            run = [];
        }
    }
    if (run.length) runs.push(run);
    return runs;
}

function ringOf(x: number, y: number, r: number): Pt[] {
    const out: Pt[] = [];
    for (let k = 0; k <= RING_LEGS; k++) {
        const a = (2 * Math.PI * k) / RING_LEGS;
        out.push({ x: x + r * Math.cos(a), y: y + r * Math.sin(a) });
    }
    return out;
}

function textSpec(x: number, y: number, text: string, color: string, size: 'small' | 'normal' | 'large', anchor: string): SceneTextSpec {
    return { x, y, template: 'label', literal: text, color, size, anchor: anchorOf(anchor) };
}

function anchorOf(a: string): SceneTextSpec['anchor'] {
    const ok: TextAnchor[] = ['center', 'above', 'below', 'left', 'right', 'above right', 'below left', 'above left', 'below right'];
    return (ok as string[]).includes(a) ? (a as SceneTextSpec['anchor']) : 'above right';
}

/** Draws as primitives into `out` (`fit` collects the points the fit holds); `still`: the still frame of something that moves. */
function drawInto(out: SceneOutput, raw: readonly Draw[], view: View, fit: Pt[] | null, still: boolean, first: string): void {
    const draws = withFirst(raw, first);
    const ms = (p: StrokePrim): StrokePrim => (still ? { ...p, still: true } : p);
    const mf = (p: FillPrim): FillPrim => (still ? { ...p, still: true } : p);
    const mm = (p: MarkerPrim): MarkerPrim => (still ? { ...p, still: true } : p);
    const keep = (pts: Pt[]) => {
        if (fit) for (const p of pts) fit.push(p);
    };
    for (const d of draws) {
        switch (d.k) {
            case 'line': {
                const runs = finiteRuns(d.pts);
                runs.forEach(keep);
                if (!d.markerOnly && runs.some((r) => r.length > 1)) {
                    const stroke: StrokePrim = { lines: runs.filter((r) => r.length > 1), color: d.color, width: d.width, dashed: d.dashed };
                    if (d.opacity < 1) stroke.opacity = d.opacity;
                    out.strokes.push(ms(stroke));
                }
                if (d.marker || d.markerOnly) for (const r of runs) for (const p of r) out.markers.push(mm({ x: p.x, y: p.y, color: d.color, size: d.markerSize === 'normal' ? 'small' : d.markerSize }));
                break;
            }
            case 'dots':
                d.pts.forEach(([x, y], i) => {
                    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                    out.markers.push(mm({ x, y, color: d.colors[i % d.colors.length] ?? 'blue', size: d.size }));
                    if (fit) fit.push({ x, y });
                });
                break;
            case 'fill': {
                const ring = finiteRuns(d.ring)[0];
                if (!ring || ring.length < 3) break;
                keep(ring);
                out.fills.push(mf({ rings: [ring], color: d.color, opacity: d.opacity, pattern: 'solid' }));
                if (d.edge) out.strokes.push(ms({ lines: [ring], color: d.edge, width: 'very thin', dashed: false, closed: true }));
                break;
            }
            case 'arrow': {
                const a = { x: d.from[0], y: d.from[1] };
                const b = { x: d.to[0], y: d.to[1] };
                if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) break;
                keep([a, b]);
                out.strokes.push(ms({ lines: [[a, b]], color: d.color, width: d.width, dashed: false, arrow: 'forward', exact: true }));
                break;
            }
            case 'text':
                if (!Number.isFinite(d.x) || !Number.isFinite(d.y) || !d.text) break;
                if (fit) fit.push({ x: d.x, y: d.y });
                if (!still) out.texts.push(textSpec(d.x, d.y, d.text, d.color, d.size, d.anchor));
                break;
            case 'hline':
                if (Number.isFinite(d.y)) out.strokes.push(ms({ lines: [[{ x: view.xmin, y: d.y }, { x: view.xmax, y: d.y }]], color: d.color, width: d.width, dashed: d.dashed, exact: true }));
                if (fit) fit.push({ x: NaN, y: d.y });
                break;
            case 'vline':
                if (Number.isFinite(d.x)) out.strokes.push(ms({ lines: [[{ x: d.x, y: view.ymin }, { x: d.x, y: view.ymax }]], color: d.color, width: d.width, dashed: d.dashed, exact: true }));
                if (fit) fit.push({ x: d.x, y: NaN });
                break;
            case 'circle': {
                if (![d.x, d.y, d.r].every(Number.isFinite) || !(d.r > 0)) break;
                const ring = ringOf(d.x, d.y, d.r);
                keep([{ x: d.x - d.r, y: d.y - d.r }, { x: d.x + d.r, y: d.y + d.r }]);
                if (d.fill) out.fills.push(mf({ rings: [ring], color: d.fill, opacity: d.opacity, pattern: 'solid' }));
                out.strokes.push(ms({ lines: [ring], color: d.color, width: d.width, dashed: d.dashed, closed: true }));
                break;
            }
            case 'image':
                if (still) break;
                (out.pixels ??= []).push(imagePrim(d));
                keep([{ x: d.extent[0], y: d.extent[2] }, { x: d.extent[1], y: d.extent[3] }]);
                break;
        }
    }
}

/** A script's title or axis name the chart can take as its own (a template has no braces of its own). */
export function chartTakes(text: string | null): boolean {
    return !!text && !/[{}]/.test(text);
}

/**
 * The script's title, xlabel and ylabel: the chart takes them where it has
 * none (settings.toRendererConfig); one it cannot take (braces in it) is a
 * text in the plot. The legend is a key in the corner where it covers the
 * least of what is drawn (matplotlib's 'best').
 */
function axesTexts(out: SceneOutput, fig: Figure, view: View, first: string): void {
    const w = view.xmax - view.xmin;
    const h = view.ymax - view.ymin;
    const cx = view.xmin + w / 2;
    if (fig.title && !chartTakes(fig.title)) out.texts.push(textSpec(cx, view.ymax - 0.02 * h, fig.title, 'black', 'large', 'below'));
    if (fig.xlabel && !chartTakes(fig.xlabel)) out.texts.push(textSpec(view.xmax - 0.02 * w, view.ymin + 0.02 * h, fig.xlabel, 'black', 'normal', 'above left'));
    if (fig.ylabel && !chartTakes(fig.ylabel)) out.texts.push(textSpec(view.xmin + 0.02 * w, view.ymax - 0.02 * h, fig.ylabel, 'black', 'normal', 'below right'));
    if (!fig.legend) return;
    const draws = withFirst(fig.draws, first);
    const entries = draws.filter((d): d is Extract<Draw, { label: string | null }> => 'label' in d && !!d.label).slice(0, 12);
    if (!entries.length) return;
    const row = 0.075 * h;
    const boxW = 0.34 * w;
    const boxH = entries.length * row + 0.03 * h;
    const pts: Array<[number, number]> = [];
    for (const d of draws) {
        if (d.k === 'line') pts.push(...d.pts);
        else if (d.k === 'dots') pts.push(...d.pts);
        else if (d.k === 'fill') pts.push(...d.ring);
    }
    const corners = [
        { x0: view.xmax - boxW, y1: view.ymax },
        { x0: view.xmin + 0.02 * w, y1: view.ymax },
        { x0: view.xmax - boxW, y1: view.ymin + boxH },
        { x0: view.xmin + 0.02 * w, y1: view.ymin + boxH },
    ];
    let best = corners[0];
    let fewest = Infinity;
    for (const c of corners) {
        let n = 0;
        for (const [x, y] of pts) if (x >= c.x0 && x <= c.x0 + boxW && y <= c.y1 && y >= c.y1 - boxH) n++;
        if (n < fewest) {
            fewest = n;
            best = c;
        }
    }
    entries.forEach((d, i) => {
        const y = best.y1 - 0.05 * h - i * row;
        const x0 = best.x0 + 0.02 * w;
        const x1 = x0 + 0.06 * w;
        const color = d.k === 'dots' ? (d.colors[0] ?? 'blue') : d.color;
        if (d.k === 'fill') out.fills.push({ rings: [[{ x: x0, y: y - 0.02 * h }, { x: x1, y: y - 0.02 * h }, { x: x1, y: y + 0.02 * h }, { x: x0, y: y + 0.02 * h }]], color, opacity: Math.max(0.3, d.opacity), pattern: 'solid' });
        else if (d.k === 'dots') out.markers.push({ x: (x0 + x1) / 2, y, color, size: 'small' });
        else out.strokes.push({ lines: [[{ x: x0, y }, { x: x1, y }]], color, width: d.width, dashed: d.dashed, exact: true });
        out.texts.push({ ...textSpec(x1 + 0.01 * w, y, d.label ?? '', 'black', 'small', 'right'), halo: true });
    });
}

/** The title and axis names a chart's scripts set (null when it has no python block). */
export function pythonAxes(tools: unknown, math: MathContext): { title: string | null; xlabel: string | null; ylabel: string | null } | null {
    const program = chartProgram(tools);
    if (!program) return null;
    const env = math.envFor('value');
    const fig = program.run(inputsOf(program, (name) => (NAME_RE.test(name) ? env.scalar(name)?.read() : undefined))).figure;
    return { title: chartTakes(fig.title) ? fig.title : null, xlabel: chartTakes(fig.xlabel) ? fig.xlabel : null, ylabel: chartTakes(fig.ylabel) ? fig.ylabel : null };
}

/** imshow as a pixel layer over its extent (nearest cell; row 0 at the top unless origin='lower'). */
function imagePrim(d: Extract<Draw, { k: 'image' }>): PixelPrim {
    const [x0, x1, y0, y1] = d.extent;
    const lo = d.vmin;
    const span = d.vmax - d.vmin;
    const key = `py-image:${hashText(`${d.nx}x${d.ny}|${d.extent.join(',')}|${d.map}|${d.lower}|${lo}|${span}|${Array.from(d.z.subarray(0, 64)).join(',')}|${d.z.length}|${sum(d.z)}`)}`;
    return {
        key,
        opacity: d.opacity,
        shader: null,
        cost: 1,
        tile(view, w, h, px0, py0, px1, py1, buf) {
            for (let py = py0; py < py1; py++) {
                const y = view.ymax - ((py + 0.5) / h) * (view.ymax - view.ymin);
                for (let px = px0; px < px1; px++) {
                    const x = view.xmin + ((px + 0.5) / w) * (view.xmax - view.xmin);
                    const k = (py * w + px) * 4;
                    const u = (x - x0) / (x1 - x0);
                    // Row 0 of the array is at y0 with origin='lower', else at the top (y1 for an extent written the usual way).
                    const vTop = (y1 - y) / (y1 - y0);
                    const v = d.lower ? 1 - vTop : vTop;
                    if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) {
                        buf[k + 3] = 0;
                        continue;
                    }
                    const j = Math.min(d.nx - 1, Math.floor(u * d.nx));
                    const i = Math.min(d.ny - 1, Math.floor((d.lower ? 1 - v : v) * d.ny));
                    const row = d.lower ? d.ny - 1 - i : i;
                    const z = d.z[(d.lower ? i : row) * d.nx + j];
                    if (!Number.isFinite(z)) {
                        buf[k + 3] = 0;
                        continue;
                    }
                    const c = mapRgb(d.map, span > 0 ? (z - lo) / span : 0.5);
                    buf[k] = Math.round(c[0] * 255);
                    buf[k + 1] = Math.round(c[1] * 255);
                    buf[k + 2] = Math.round(c[2] * 255);
                    buf[k + 3] = 255;
                }
            }
        },
        bounds: () => ({ xmin: Math.min(x0, x1), xmax: Math.max(x0, x1), ymin: Math.min(y0, y1), ymax: Math.max(y0, y1) }),
    };
}

function sum(a: Float64Array): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) s += a[i] * ((i % 7) + 1);
    return s;
}

// ------------------------------------------------------------ the live canvas

/** frame(t)'s draws as shapes of the live canvas (lines, rings, dots, fills, texts). */
export function liveShapes(raw: readonly Draw[], view: View, first: string): LiveShapes {
    const draws = withFirst(raw, first);
    const out = emptyShapes();
    for (const d of draws) {
        switch (d.k) {
            case 'line': {
                const runs = finiteRuns(d.pts);
                if (!d.markerOnly) for (const r of runs) if (r.length > 1) out.lines.push({ pts: r, color: d.color, width: d.width, dashed: d.dashed, opacity: d.opacity < 1 ? d.opacity : undefined });
                if (d.marker || d.markerOnly) for (const r of runs) for (const p of r) out.dots.push({ x: p.x, y: p.y, color: d.color, size: d.markerSize === 'normal' ? 'small' : d.markerSize });
                break;
            }
            case 'dots':
                d.pts.forEach(([x, y], i) => out.dots.push({ x, y, color: d.colors[i % d.colors.length] ?? 'blue', size: d.size }));
                break;
            case 'fill': {
                const ring = finiteRuns(d.ring)[0];
                if (ring && ring.length > 2) (out.fills ??= []).push({ pts: ring, color: d.color, opacity: d.opacity });
                if (ring && d.edge) out.lines.push({ pts: [...ring, ring[0]], color: d.edge, width: 'very thin' });
                break;
            }
            case 'arrow': {
                const a = { x: d.from[0], y: d.from[1] };
                const b = { x: d.to[0], y: d.to[1] };
                out.lines.push({ pts: [a, b], color: d.color, width: d.width });
                // A small head in chart units (a tenth of the arrow, at most 3 % of the view).
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                if (len > 0) {
                    const head = Math.min(0.25 * len, 0.03 * Math.max(view.xmax - view.xmin, view.ymax - view.ymin));
                    const ux = (b.x - a.x) / len;
                    const uy = (b.y - a.y) / len;
                    const side = (s: number) => ({ x: b.x - head * ux + s * 0.5 * head * -uy, y: b.y - head * uy + s * 0.5 * head * ux });
                    out.lines.push({ pts: [side(1), b, side(-1)], color: d.color, width: d.width });
                }
                break;
            }
            case 'text':
                (out.texts ??= []).push({ x: d.x, y: d.y, text: d.text.replace(/\$/g, ''), color: d.color, size: d.size, anchor: d.anchor });
                break;
            case 'hline':
                out.lines.push({ pts: [{ x: view.xmin, y: d.y }, { x: view.xmax, y: d.y }], color: d.color, width: d.width, dashed: d.dashed });
                break;
            case 'vline':
                out.lines.push({ pts: [{ x: d.x, y: view.ymin }, { x: d.x, y: view.ymax }], color: d.color, width: d.width, dashed: d.dashed });
                break;
            case 'circle':
                if (d.fill) (out.fills ??= []).push({ pts: ringOf(d.x, d.y, d.r), color: d.fill, opacity: d.opacity });
                out.lines.push({ pts: ringOf(d.x, d.y, d.r), color: d.color, width: d.width, dashed: d.dashed });
                break;
            case 'image':
                break;
        }
    }
    return out;
}

/** The draws with the first colour of the cycle (C0) as the block's colour. */
function withFirst(draws: readonly Draw[], first: string): Draw[] {
    const c = (x: string) => (x === FIRST ? first : x);
    return draws.map((d) => {
        switch (d.k) {
            case 'dots':
                return d.colors.includes(FIRST) ? { ...d, colors: d.colors.map(c) } : d;
            case 'fill':
                return d.color === FIRST || d.edge === FIRST ? { ...d, color: c(d.color), edge: d.edge === null ? null : c(d.edge) } : d;
            case 'circle':
                return d.color === FIRST || d.fill === FIRST ? { ...d, color: c(d.color), fill: d.fill === null ? null : c(d.fill) } : d;
            case 'image':
                return d;
            default:
                return d.color === FIRST ? { ...d, color: first } : d;
        }
    });
}
