/*
 * 6.0 AI: what check_chart reports for the objects of version 6, so an AI
 * app reads what its chart computes: the value of every let name (a
 * matrix with its determinant and eigenvalues), sets on an axis as
 * intervals, rest points with their kinds, where solutions and orbits end,
 * the map of a transform, eigenvalues, what a script gives the chart and
 * draws, what each GeoGebra line is, which objects arrive in which step,
 * what moves on the clock and which objects are pictures (PNG files in the
 * export). Pure: no DOM, no Obsidian; English (charttool runs it inside
 * inEnglish).
 */
import type { MathContext } from '../mathcontext';
import type { Scene2D, Scene3D, SceneItem2D, SceneOutput, SceneReport } from '../scene';
import type { Tool } from '../types';
import type { Data } from '../chartdata';
import { compileValue, det, eigen, formatValue, letValue, trace } from '../values';
import type { Mat, Value } from '../values';
import { compileCondition, solveSet } from '../notes6/sets';
import type { AxisPiece } from '../notes6/sets';
import { restPoints } from '../motion6/maths';
import type { RestKind } from '../motion6/maths';
import { compileTuple, solveSystem } from '../motion6/maths';
import { movesByItself, turnSpeed, turns } from '../motion6/clock';
import { lastStep, stepOf } from '../motion6/steps';
import { planeKind } from '../iterate/forms';
import { chartProgram, inputsOf } from '../python/defs';
import { FRAME_DEF } from '../python/scene';

/** A scene report to fill: what each object computed. */
export function newReport(): SceneReport {
    return { outputs: new Map(), spans3D: new Map() };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

function num(v: number): string {
    if (!Number.isFinite(v)) return String(v);
    const r = Math.round(v * 1000) / 1000;
    return String(Object.is(r, -0) ? 0 : r);
}

function pt(p: ArrayLike<number>): string {
    return `(${Array.from(p).map(num).join(', ')})`;
}

/** A value in one short line: lists say how long they are and show their ends. */
export function valueText(v: Value): string {
    if (typeof v === 'number') return num(v);
    if (v.kind === 'list') {
        const items = v.items;
        if (!items.length) return 'an empty list';
        const kinds = new Set(items.map((x) => (typeof x === 'number' ? 'number' : x.kind === 'vec' ? 'point' : x.kind === 'complex' ? 'complex number' : x.kind)));
        const what = kinds.size === 1 ? `${Array.from(kinds)[0]}${items.length > 1 ? 's' : ''}` : 'items';
        const shown = items.length <= 4 ? items.map((x) => formatValue(x, 3)).join(', ') : `${formatValue(items[0], 3)}, ${formatValue(items[1], 3)}, ..., ${formatValue(items[items.length - 1], 3)}`;
        return `a list of ${items.length} ${what}: ${shown.length > 240 ? `${shown.slice(0, 240)}...` : shown}`;
    }
    const text = formatValue(v, 3);
    if (v.kind === 'mat') return `${text}${matrixFacts(v)}`;
    if (v.kind === 'complex') return `${text} (modulus ${num(Math.hypot(v.re, v.im))}, argument ${num(Math.atan2(v.im, v.re))})`;
    return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

/** Determinant, trace and eigenvalues of a square 2 x 2 or 3 x 3 matrix. */
function matrixFacts(m: Mat): string {
    if (m.rows !== m.cols) return ` (${m.rows} x ${m.cols})`;
    const facts = [`det ${num(det(m))}`, `trace ${num(trace(m))}`];
    const pairs = eigen(m);
    if (pairs.length) {
        facts.push(
            `eigenvalues ${pairs
                .map((p) => (typeof p.value === 'number' ? num(p.value) : formatValue(p.value, 3)))
                .join(', ')}`
        );
        const real = pairs.filter((p) => p.vector);
        if (real.length) facts.push(`eigenvectors ${real.map((p) => pt(p.vector as number[])).join(', ')}`);
        else facts.push('no real eigenvectors');
    }
    return ` (${facts.join(', ')})`;
}

/** The value of a formula field, or why it has none. */
function valueOf(math: MathContext, src: string): string {
    try {
        return valueText(compileValue(math, src).run());
    } catch (e) {
        return `no value: ${e instanceof Error ? e.message : String(e)}`;
    }
}

/** The let names no tool line reports (names a script sets) with their values now. */
export function valuesLine(math: MathContext, tools: Tool[]): string | null {
    const reported = new Set(tools.filter((t) => t.type === 'value' || t.type === 'geogebra').map((t) => t.name));
    const defs = math.valueTable().definitions().filter((d) => !reported.has(d.name));
    if (!defs.length) return null;
    const parts = defs.map((d) => {
        if (d.params.length) return `${d.name}(${d.params.join(', ')}) a function`;
        let v: Value;
        try {
            v = letValue(math, d.name);
        } catch (e) {
            return `${d.name}: ${e instanceof Error ? e.message : String(e)}`;
        }
        if (typeof v === 'number' && Number.isNaN(v)) return `${d.name} has no value`;
        return `${d.name} = ${valueText(v)}`;
    });
    return `Values: ${parts.join('; ')}`;
}

/** Which objects arrive in which step, what moves on the clock, and what the export writes as pictures. */
export function chartLines(data: Data): string[] {
    const out: string[] = [];
    const last = lastStep(data);
    if (last > 0) {
        const byStep: string[][] = Array.from({ length: last + 1 }, () => []);
        const add = (list: unknown, name: (o: Data, i: number) => string) => {
            if (!Array.isArray(list)) return;
            list.forEach((o: unknown, i) => {
                if (!o || typeof o !== 'object') return;
                const k = stepOf(o);
                if (k <= last) byStep[k].push(name(o as Data, i));
            });
        };
        add(data.functions, (o, i) => str(o.name) || `f${i + 1}`);
        add(data.functions3D, (o, i) => str(o.name) || `surface ${i + 1}`);
        add(data.tools, (o) => str(o.name));
        add(data.annotations, (_o, i) => `label ${i + 1}`);
        const steps = byStep.map((names, k) => `step ${k + 1}: ${names.length ? names.join(', ') : '(a pause)'}`).join('; ');
        out.push(`Steps: ${last + 1} (${steps}). Notes start at the last step and show Previous, Play and Next; this check, render_chart and the export show the last step${data.frames === true ? ', and the export with frames draws every step side by side' : ''}.`);
    }
    const tools = Array.isArray(data.tools) ? (data.tools as Data[]) : [];
    const moving = tools.filter((t) => t && !t.hidden && movesByItself(t)).map((t) => `${str(t.name)} (${movingWhat(t)})`);
    if (moving.length) {
        const still = Number(data.stillTime) || 0;
        out.push(`Moves on the clock: ${moving.join(', ')}. In a note it plays by itself; this check, render_chart, the export and print draw the still frame at t = ${num(still)} s (set stillTime = ... to choose another).`);
    }
    if (turns(data)) out.push(`Turns by itself in notes (turning, ${num(turnSpeed(data.turnSpeed))} x the usual speed); render_chart and the export show the view as set.`);
    const pictures = tools.filter((t) => t && !t.hidden && (t.type === 'colourPlane' || t.type === 'bifurcation' || (t.type === 'python' && /\bimshow\s*\(/.test(str(t.code)))));
    if (pictures.length) out.push(`Pictures: ${pictures.map((t) => str(t.name)).join(', ')} ${pictures.length > 1 ? 'are pixel layers' : 'is a pixel layer'}. The LaTeX export draws each with \\addplot graphics from a PNG that must sit beside the .tex file (export_latex names it; the editor's Copy LaTeX saves it in the note's attachment folder).`);
    return out;
}

function movingWhat(t: Data): string {
    if (t.type === 'vectorField') return 'moving particles';
    if (t.type === 'fourierCircles') return 'turning circles';
    if (t.type === 'python') return 'frame(t) of the script';
    if (t.traced === true) return 'traced, draws itself';
    return 'moves';
}

// ------------------------------------------------------------------- 2D

const RE_KIND: Record<RestKind, string> = {
    stableNode: 'stable node',
    unstableNode: 'unstable node',
    stableSpiral: 'stable spiral',
    unstableSpiral: 'unstable spiral',
    saddle: 'saddle',
    centre: 'centre',
    degenerate: 'not isolated',
};

/** A set on the number line as intervals: [-2, 2], (-inf, -1) u (1, inf), {0, 3}. */
function setText(pieces: AxisPiece[]): string {
    if (!pieces.length) return 'empty';
    const end = (v: number) => (v === Infinity ? 'inf' : v === -Infinity ? '-inf' : num(v));
    const parts = pieces.slice(0, 8).map((p) => {
        if (p.a === p.b) return `{${end(p.a)}}`;
        return `${p.cutA ? '...' : p.closedA && Number.isFinite(p.a) ? '[' : '('}${end(p.a)}, ${end(p.b)}${p.cutB ? '...' : p.closedB && Number.isFinite(p.b) ? ']' : ')'}`;
    });
    return parts.join(' u ') + (pieces.length > 8 ? ` u ... (${pieces.length} pieces)` : '');
}

interface Helpers {
    /** The labels of items, as charttool writes them (` | label "..." above of (1, 2)`). */
    texts(items: SceneItem2D[]): string;
    bbox(points: Array<{ x: number; y: number }>): string;
}

/** A report line for a version 6 tool in a 2D chart; null for the older types. */
export function toolLine2D(tool: Tool, tools: Tool[], scene: Scene2D, report: SceneReport, math: MathContext, view: { xmin: number; xmax: number; ymin: number; ymax: number }, h: Helpers): string | null {
    const items = scene.items.filter((it) => it.kind === 'tool' && it.source === tool.name);
    const out = report.outputs.get(tool.name);
    const hidden = tool.hidden ? ' (hidden)' : '';
    const labels = h.texts(items);
    const d = scene.derived;
    const name = tool.name;
    const marks = items.flatMap((it) => it.markers);
    const lines = items.flatMap((it) => it.strokes.flatMap((s) => s.lines)).flat();
    const where = lines.length ? `, lines where ${h.bbox(lines)}` : '';
    switch (tool.type) {
        case 'value':
            return `${name}: let ${name}${tool.params.trim() ? `(${tool.params})` : ''} = ${tool.expression}${tool.params.trim() ? '' : ` = ${valueOf(math, name)}`}${hidden}`;
        case 'vector': {
            const vs = tool.vectors
                .split(';')
                .map((s) => s.trim())
                .filter(Boolean);
            const from = tool.from.trim() ? ` from ${tool.from.trim()}` : ' from the origin';
            return `${name} arrows${from}${tool.tipToTail ? ', tip to tail' : ''}: ${vs.map((v) => `${v} = ${valueOf(math, v)}`).join('; ')}${labels}${hidden}`;
        }
        case 'listPoints': {
            const n = d[`${name}_n`];
            return `${name} points of ${tool.points}: ${Number.isFinite(n) ? n : marks.length} points${marks.length ? ` ${marks.slice(0, 6).map((m) => pt([m.x, m.y])).join(' ')}${marks.length > 6 ? ' ...' : ''}` : ''}${tool.joined ? ', joined' : ''}${labels}${hidden}`;
        }
        case 'axisSet': {
            const axis = tool.axis === 'y' ? 'y' : 'x';
            let set = '';
            try {
                const cond = compileCondition(math, tool.condition, axis);
                const [lo, hi] = axis === 'x' ? [view.xmin, view.xmax] : [view.ymin, view.ymax];
                set = setText(solveSet(cond, lo - (hi - lo), hi + (hi - lo)));
            } catch (e) {
                set = `no set: ${e instanceof Error ? e.message : String(e)}`;
            }
            return `${name} set on the ${axis}-axis where ${tool.condition}: ${set}${labels}${hidden}`;
        }
        case 'chord': {
            const at = tool.at.trim();
            const facts = at
                ? `at ${at}: x = ${num(d[`${name}_x`])}, chord ${num(d[`${name}_y`])}, gap (chord minus graph) ${num(d[`${name}_val`])}`
                : `from ${pt([d[`${name}_x`], d[`${name}_y`]])} to ${pt([d[`${name}_x2`], d[`${name}_y2`]])}`;
            return `${name} chord of ${tool.function} from ${tool.from} to ${tool.to}: ${facts}${labels}${hidden}`;
        }
        case 'vectorField': {
            const extras = [tool.colormap ? `coloured by length (${tool.colormap})` : '', tool.particles ? 'moving particles' : '', tool.streamlines ? 'streamlines' : ''].filter(Boolean);
            return `${name} vector field ${tool.expression}: ${lines.length ? `arrows over the view (density ${tool.density})` : 'nothing drawn'}${extras.length ? `, ${extras.join(', ')}` : ''}${hidden}`;
        }
        case 'restPoints': {
            const field = report.outputs.get(tool.field)?.motion?.field;
            if (!field) return `${name} rest points of ${tool.field}: none computed${hidden}`;
            const found = restPoints(field, view);
            return `${name} rest points of ${tool.field}: ${found.length ? found.map((p) => `${pt([p.x, p.y])} ${RE_KIND[p.kind]}`).join(', ') : 'NONE in the view'}${labels}${hidden}`;
        }
        case 'trajectory':
            return `${name} solution of ${tool.expression}: ${trajectoryText(tool.expression, tool.through, tool.from, tool.to, 2, math, d)}${where}${tool.traced ? ', traced' : ''}${hidden}`;
        case 'planeGrid': {
            const count = items.reduce((s, it) => s + it.strokes.reduce((t, st) => t + st.lines.length, 0), 0);
            return `${name} grid: ${count} lines${where}${hidden}`;
        }
        case 'basisVectors': {
            const tips = items.flatMap((it) => it.strokes.flatMap((s) => s.lines.map((l) => l[l.length - 1])));
            return `${name} basis vectors: tips at ${tips.map((p) => pt([p.x, p.y])).join(', ') || 'nothing'}${labels}${hidden}`;
        }
        case 'transform': {
            const map = out?.linear?.map;
            let what = tool.map;
            if (map && map.m) {
                const m: Mat = { kind: 'mat', rows: map.dim, cols: map.dim, a: map.m };
                what = `${tool.map} = ${valueText(m)}`;
            } else if (map && map.complex) what = `${tool.map} (a complex map: lines bend)`;
            else if (map) what = `${tool.map} (a map of points)`;
            const moves = (scene.movedFunctions || []).length ? `; it draws ${scene.movedFunctions?.length} function${scene.movedFunctions?.length === 1 ? '' : 's'} it moves` : '';
            return `${name} transform by ${what}: moves the objects above it${stepOf(tool) > 0 ? ` while step ${stepOf(tool) + 1} comes in` : ''}${moves}${hidden}`;
        }
        case 'eigenvectors': {
            let facts: string;
            try {
                const m = compileValue(math, tool.matrix).run();
                facts = typeof m !== 'number' && m.kind === 'mat' ? eigenText(m) : 'not a matrix';
            } catch (e) {
                facts = e instanceof Error ? e.message : String(e);
            }
            return `${name} eigenvectors of ${tool.matrix}: ${facts}${labels}${hidden}`;
        }
        case 'unitSquare': {
            const ring = items.flatMap((it) => it.fills.flatMap((f) => f.rings)).flat();
            return `${name} unit square${tool.image ? ' (image)' : ''}: corners ${ring.slice(0, 4).map((p) => pt([p.x, p.y])).join(' ') || 'nothing drawn'}${labels}${hidden}`;
        }
        case 'span': {
            const fills = items.some((it) => it.fills.length);
            return `${name} span of ${tool.vectors}: ${fills ? 'the whole plane' : lines.length ? 'a line through 0' : 'the point 0'}${labels}${hidden}`;
        }
        case 'orbit': {
            const n = d[`${name}_n`];
            const first = marks[0] ?? lines[0];
            return `${name} orbit of ${tool.recurrence}: ${Number.isFinite(n) ? `${n} points` : 'no points'}${first ? ` from ${pt([first.x, first.y])}` : ''}, last ${pt([d[`${name}_x`], d[`${name}_y`]])}${where}${tool.traced ? ', traced' : ''}${labels}${hidden}`;
        }
        case 'cobweb':
            return `${name} cobweb of ${tool.recurrence} from ${tool.start || '0.2'}: ${num(d[`${name}_n`])} steps, last x ${num(d[`${name}_x`])}${hidden}`;
        case 'bifurcation':
            return `${name} bifurcation diagram of ${tool.recurrence} for ${tool.parameter} from ${tool.from} to ${tool.to}: a picture (pixel layer)${hidden}`;
        case 'newton': {
            const xs = marks.filter((m) => Math.abs(m.y) < 1e-12).map((m) => num(m.x));
            return `${name} Newton's method for ${tool.function} from ${tool.start}: x_k ${xs.slice(0, 8).join(', ')}${xs.length > 8 ? ', ...' : ''}; last x ${num(d[`${name}_x`])}, f there ${num(d[`${name}_val`])}, ${num(d[`${name}_n`])} steps${labels}${hidden}`;
        }
        case 'colourPlane': {
            const kind = planeKind(tool.formula);
            const what = kind === 'escape' ? `escape time of ${tool.formula}, start ${tool.start || '0'}${tool.given ? `, ${tool.given}` : ''}, ${tool.steps || '200'} steps` : kind === 'domain' ? `domain colouring of ${tool.formula}` : `heat map of ${tool.formula}`;
            const drawn = items.some((it) => it.pixels && it.pixels.length);
            return `${name} coloured plane: ${what}, colours ${tool.colormap ?? (kind === 'escape' ? 'cyclic' : kind === 'heat' ? 'viridis' : 'by angle')}${drawn ? ', a picture (pixel layer)' : ', NOT DRAWN'}${hidden}`;
        }
        case 'fourierCircles': {
            const c = out?.iterate?.circles;
            const count = c ? c.terms.count : 0;
            return `${name} turning circles of ${tool.sum}: ${count} circle${count === 1 ? '' : 's'}${c ? `, reach ${num(c.reach)}` : ''}${tool.wave ? ', with its wave' : ''}${tool.path ? ', with its path' : ''}${where}${hidden}`;
        }
        case 'geogebra':
            return `${name} GeoGebra ${tool.named ? `${name} = ` : ''}${tool.command}: ${geogebraText(out)}${labels}${hidden}`;
        case 'python':
            return pythonText(tool, tools, math, items, h) + hidden;
        default:
            return null;
    }
}

function eigenText(m: Mat): string {
    const pairs = eigen(m);
    if (!pairs.length) return 'none (not a 2 x 2 or 3 x 3 matrix of numbers)';
    return pairs.map((p, i) => `lambda${i + 1} = ${typeof p.value === 'number' ? num(p.value) : formatValue(p.value, 3)}${p.vector ? ` along ${pt(p.vector)}` : ' (complex: no line)'}`).join(', ');
}

/** Where the solutions of a system start and end. */
function trajectoryText(expression: string, through: string, from: string, to: string, dim: 2 | 3, math: MathContext, derived: Record<string, number>): string {
    let f;
    try {
        f = compileTuple(math, expression, dim);
    } catch (e) {
        return `no solution: ${e instanceof Error ? e.message : String(e)}`;
    }
    const t0 = math.tryValue(from || '0');
    const t1 = math.tryValue(to || '10');
    if (!t0.ok || !t1.ok) return 'no time range';
    let starts: number[][] = [];
    try {
        starts = math.path(through, dim).map((e) => ('point' in e ? e.point : dim === 3 ? [derived[`${e.name}_x`], derived[`${e.name}_y`], derived[`${e.name}_z`]] : [derived[`${e.name}_x`], derived[`${e.name}_y`]]));
    } catch (e) {
        return `no start: ${e instanceof Error ? e.message : String(e)}`;
    }
    const runs = starts.slice(0, 6).map((p) => {
        if (!p.every(Number.isFinite)) return 'a start with no value';
        const s = solveSystem(f, p, t0.value, t1.value);
        const end = s.pts[s.pts.length - 1];
        return `from ${pt(p)} at t = ${num(t0.value)} to ${pt(end)} at t = ${num(s.ts[s.ts.length - 1])}${s.stopped !== null ? ' (stopped: no value or blew up)' : ''}`;
    });
    return runs.join('; ') || 'no start points';
}

/** What a GeoGebra line is, in numbers. */
function geogebraText(out: SceneOutput | undefined): string {
    const o = out?.geogebra;
    if (!o) return out && out.failed ? 'not drawn (problem)' : 'nothing';
    switch (o.k) {
        case 'value':
            return valueText(o.v);
        case 'function':
            return `a function of x${Number.isFinite(o.from) && Number.isFinite(o.to) ? ` on [${num(o.from)}, ${num(o.to)}]` : ''}`;
        case 'circle':
            return `circle, centre ${pt(o.c)}, radius ${num(o.r)}`;
        case 'segment':
            return `segment ${pt(o.a)} to ${pt(o.b)}, length ${num(Math.hypot(...o.b.map((v, i) => v - o.a[i])))}`;
        case 'line':
        case 'ray':
        case 'vector':
            return `${o.k} ${pt(o.a)} to ${pt(o.b)}`;
        case 'polygon':
        case 'polyline':
        case 'curve':
            return `${o.k} of ${o.pts.length} points${o.k === 'polygon' ? `: ${o.pts.slice(0, 8).map(pt).join(' ')}${o.pts.length > 8 ? ' ...' : ''}` : ''}`;
        case 'text':
            return `text "${o.text}" at ${pt(o.at)}`;
    }
}

/** What a script gives the chart and what it draws (the chart's scripts run in order and share one scope). */
function pythonText(tool: Extract<Tool, { type: 'python' }>, tools: Tool[], math: MathContext, items: SceneItem2D[], h: Helpers): string {
    const head = `${tool.name} python script (${tool.code.split('\n').length} lines)`;
    const scripts = tools.filter((t) => t.type === 'python');
    const program = chartProgram(scripts);
    if (!program || !tool.code.trim()) return `${head}: empty`;
    const block = Math.max(0, scripts.indexOf(tool));
    const env = math.envFor('value');
    const result = program.run(inputsOf(program, (n) => env.scalar(n)?.read()));
    const parts: string[] = [];
    if (block === 0) {
        parts.push(`ran in ${num(result.ms)} ms`);
        const own = new Set(math.valueTable().definitions().map((d) => d.name));
        const given = program.defined.filter((d) => d.name !== 'frame' && !d.name.startsWith('_') && own.has(d.name)).map((d) => (d.params && d.params.length ? `${d.name}(${d.params.join(', ')})` : d.name));
        if (given.length) parts.push(`gives the chart ${given.join(', ')} (their values are in the Values line)`);
        if (program.reads.length) parts.push(`reads ${program.reads.join(', ')}`);
    }
    const kinds = new Map<string, number>();
    result.figure.draws.forEach((dr, i) => {
        if (result.figure.blocks[i] === block) kinds.set(dr.k, (kinds.get(dr.k) ?? 0) + 1);
    });
    const word: Record<string, [string, string]> = { line: ['line', 'lines'], dots: ['set of dots', 'sets of dots'], fill: ['fill', 'fills'], arrow: ['arrow', 'arrows'], text: ['text', 'texts'], hline: ['line across', 'lines across'], vline: ['line across', 'lines across'], circle: ['circle', 'circles'], image: ['picture (pixel layer)', 'pictures (pixel layers)'] };
    if (kinds.size) parts.push(`draws ${Array.from(kinds.entries()).map(([k, c]) => `${c} ${(word[k] ?? [k, `${k}s`])[c > 1 ? 1 : 0]}`).join(', ')}`);
    const drawn = items.flatMap((it) => [...it.strokes.flatMap((s) => s.lines).flat(), ...it.markers, ...it.fills.flatMap((f) => f.rings).flat()]);
    if (drawn.length) parts.push(`where ${h.bbox(drawn)}`);
    if (result.frame && FRAME_DEF.test(tool.code)) parts.push('frame(t) moves on the clock (the check shows frame(0))');
    if (block === 0 && result.figure.title) parts.push(`title "${result.figure.title}"`);
    if (result.error && result.error.block === block) parts.push(`STOPPED at line ${result.error.line}: ${result.error.message}`);
    if (!parts.length) parts.push('draws nothing');
    return `${head}: ${parts.join('; ')}${h.texts(items)}`;
}

// ------------------------------------------------------------------- 3D

/** Report lines for the tools of a 3D chart other than planes (what each draws, and the facts of the version 6 ones). */
export function toolLines3D(tools: Tool[], scene: Scene3D, report: SceneReport, math: MathContext): string[] {
    const out: string[] = [];
    for (const tool of tools) {
        if (tool.type === 'plane3D') continue;
        if (tool.type === 'value') {
            out.push(`${tool.name}: let ${tool.name}${tool.params.trim() ? `(${tool.params})` : ''} = ${tool.expression}${tool.params.trim() ? '' : ` = ${valueOf(math, tool.name)}`}`);
            continue;
        }
        const span = report.spans3D.get(tool.name);
        const hidden = tool.hidden ? ' (hidden)' : '';
        const segs = span ? scene.segments.slice(span.segments[0], span.segments[1]) : [];
        const pts = span ? scene.points.slice(span.points[0], span.points[1]) : [];
        const labels = pts.filter((p) => p.label).map((p) => `"${p.label}" at ${pt([p.x, p.y, p.z])}`);
        const drawn: string[] = [];
        if (segs.length) drawn.push(`${segs.length} segment${segs.length > 1 ? 's' : ''} where ${box3(segs.flatMap((s) => [s.a, s.b]))}`);
        const marks = pts.filter((p) => !p.bare);
        if (marks.length) drawn.push(`${marks.length} point${marks.length > 1 ? 's' : ''} ${marks.slice(0, 6).map((p) => pt([p.x, p.y, p.z])).join(' ')}${marks.length > 6 ? ' ...' : ''}`);
        const what = drawn.length ? drawn.join(', ') : tool.hidden ? 'nothing drawn' : 'nothing drawn';
        let facts = '';
        if (tool.type === 'trajectory') facts = `; ${trajectoryText(tool.expression, tool.through, tool.from, tool.to, tool.dim === 3 ? 3 : 2, math, scene.derived)}`;
        else if (tool.type === 'eigenvectors') {
            try {
                const m = compileValue(math, tool.matrix).run();
                facts = `; ${typeof m !== 'number' && m.kind === 'mat' ? eigenText(m) : 'not a matrix'}`;
            } catch (e) {
                facts = `; ${e instanceof Error ? e.message : String(e)}`;
            }
        } else if (tool.type === 'transform') {
            const map = report.outputs.get(tool.name)?.linear?.map;
            if (map && map.m) facts = `; ${tool.map} = ${valueText({ kind: 'mat', rows: map.dim, cols: map.dim, a: map.m })}`;
        } else if (tool.type === 'geogebra') facts = `; ${geogebraText(report.outputs.get(tool.name))}`;
        out.push(`${tool.name} ${KIND_3D[tool.type] ?? tool.type}: ${what}${facts}${labels.length ? ` | labels ${labels.join(', ')}` : ''}${hidden}`);
    }
    return out;
}

/** What a 3D tool is, in the words of its line. */
const KIND_3D: Record<string, string> = {
    trajectory: 'solution',
    planeGrid: 'grid cube',
    basisVectors: 'basis vectors',
    unitSquare: 'unit cube',
    listPoints: 'points of a list',
    vector: 'arrows',
    value: 'let',
    geogebra: 'GeoGebra',
};

function box3(ps: ArrayLike<number>[]): string {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const p of ps) {
        for (let i = 0; i < 3; i++) {
            if (!Number.isFinite(p[i])) continue;
            lo[i] = Math.min(lo[i], p[i]);
            hi[i] = Math.max(hi[i], p[i]);
        }
    }
    if (!Number.isFinite(lo[0])) return 'nowhere';
    return `x ${num(lo[0])}..${num(hi[0])}, y ${num(lo[1])}..${num(hi[1])}, z ${num(lo[2])}..${num(hi[2])}`;
}
