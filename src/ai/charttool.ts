/*
 * Easy TikZ charts for AI assistants: read blocks from a note, check them
 * with the plugin's own code (problems, fields the plugin would ignore, and
 * what the chart computes), list the examples, and leave out default fields.
 * The local AI server's tools (src/ai/mcp.ts) are built on it. Pure: no
 * Obsidian, so tests/ai.test.ts runs it in Node.
 */
import { EXAMPLES, defaultFunction, defaultTool, migrateSettings } from '../migrate';
import { SettingsManager } from '../settings';
import { MathContext, fmtNum } from '../mathcontext';
import { Scene2D, SceneIssue, SceneItem2D, computeScene2D, computeScene3D, labelMetricsFor } from '../scene';
import { issueText } from '../issues';
import { marchingGrid } from '../util';
import { impliedV4, parseLenientJson } from '../blockjson';
import { GUIDES } from '../guides';
import { COLOR_MAP, THICKNESS_MAP } from '../colors';
import type { Pt } from '../geometry';
import type { Annotation, RendererConfig, Tool, ToolType } from '../types';

export type Data = Record<string, unknown>;

const TOOL_TYPES: ToolType[] = ['region', 'curve', 'points', 'segment', 'plane3D'];
/** Chart keys that hold lists, checked element by element. */
const LIST_KEYS = ['functions', 'tools', 'parameters', 'annotations', 'functions3D'] as const;
/** Keys a block may carry that the editor's defaults do not list: how the chart sits in the note. */
const DISPLAY_KEYS = ['displayWidth', 'displayAlign'];

// ------------------------------------------------------------------ input

export interface Block {
    /** 1-based line of the opening fence, or 0 for a bare JSON file. */
    line: number;
    /** 1-based line of the closing fence (0 when the block is not closed or the file is bare JSON). */
    end: number;
    /** What precedes the fence on its line (indentation, `> ` of a callout); every body line has it too. */
    prefix: string;
    text: string;
}

/** Every ```easy-tikz (or ~~~easy-tikz) block of a note, or the whole text when it is bare JSON. */
export function blocksOf(text: string): Block[] {
    if (text.trim().startsWith('{')) return [{ line: 0, end: 0, prefix: '', text }];
    const lines = text.split(/\r?\n/);
    const out: Block[] = [];
    for (let i = 0; i < lines.length; i++) {
        const open = /^(\s*(?:>\s*)*)(`{3,}|~{3,})\s*easy-tikz\s*$/.exec(lines[i]);
        if (!open) continue;
        const prefix = open[1];
        const fence = open[2];
        const body: string[] = [];
        let j = i + 1;
        for (; j < lines.length; j++) {
            const line = lines[j].startsWith(prefix) ? lines[j].slice(prefix.length) : lines[j];
            if (line.trim().startsWith(fence[0].repeat(fence.length)) && line.trim().replace(/[`~]/g, '') === '') break;
            body.push(line);
        }
        out.push({ line: i + 1, end: j < lines.length ? j + 1 : 0, prefix, text: body.join('\n') });
        i = j;
    }
    return out;
}

export function parseJson(text: string): { ok: true; data: Data } | { ok: false; message: string } {
    try {
        // As the note renderer reads blocks: comments and trailing commas are fine (check still asks for "v": 4).
        const data: unknown = parseLenientJson(text);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, message: 'the block must be one JSON object { ... }' };
        return { ok: true, data: data as Data };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const at = /position (\d+)/.exec(message);
        if (at) {
            const before = text.slice(0, Number(at[1]));
            const line = before.split('\n').length;
            const col = before.length - before.lastIndexOf('\n');
            return { ok: false, message: `${message} (line ${line} of the block, column ${col})` };
        }
        return { ok: false, message };
    }
}

// ------------------------------------------------------------- chart model

interface Loaded {
    settings: SettingsManager;
    math: MathContext;
    config: RendererConfig;
}

function load(data: Data): Loaded {
    const settings = SettingsManager.fromJSON(clone(data));
    const math = settings.createMathContext({ memo: false });
    return { settings, math, config: settings.toRendererConfig(math) };
}

export function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

/** The chart as the editor would store it, with ids left out (they are only UI keys). */
export function canonical(data: Data): string {
    const out = SettingsManager.fromJSON(clone(data)).serialize();
    for (const key of LIST_KEYS) {
        const list = out[key];
        if (Array.isArray(list)) for (const item of list) if (item && typeof item === 'object') delete (item as Data).id;
    }
    return JSON.stringify(out);
}

// --------------------------------------------------------------- defaults

export function defaultsByPart(): Record<string, Data> {
    const top = new SettingsManager().serialize();
    const fn = defaultFunction([]) as unknown as Data;
    const parameter: Data = { name: 'a', value: 1, min: 0, max: 10, step: 0.1 };
    const migrated = migrateSettings({ v: 4, annotations: [{ x: '0', y: '0', text: 'A' }], functions3D: [{ expression: 'x' }] });
    const label = (migrated.annotations as Data[])[0];
    const surface = (migrated.functions3D as Data[])[0];
    const out: Record<string, Data> = { chart: top, function: fn, parameter, label, surface };
    for (const type of TOOL_TYPES) {
        const tool = defaultTool(type, { is3D: type === 'plane3D', tools: [], functions: [] }) as unknown as Data;
        out[type] = tool;
    }
    return out;
}

/** Keys of a part that the plugin reads (its defaults), plus the keys every part may have. */
function knownKeys(part: string, defaults: Record<string, Data>): Set<string> {
    const keys = new Set(Object.keys(defaults[part] || {}));
    keys.add('name');
    keys.add('hidden');
    keys.add('id');
    if (part === 'chart') {
        for (const k of DISPLAY_KEYS) keys.add(k);
        for (const k of Object.keys(migrateSettings({ v: 4 }))) keys.add(k);
        keys.add('v');
    }
    if (TOOL_TYPES.includes(part as ToolType)) keys.add('type');
    if (part === 'function') keys.add('legendLabel');
    if (part === 'label') keys.add('z');
    return keys;
}

/** The closest known key, for "did you mean". */
function nearest(word: string, keys: Iterable<string>): string | null {
    let best: string | null = null;
    let bestScore = Infinity;
    for (const k of keys) {
        const d = editDistance(word.toLowerCase(), k.toLowerCase());
        if (d < bestScore) {
            bestScore = d;
            best = k;
        }
    }
    return best !== null && bestScore <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

function editDistance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return row[b.length];
}

/**
 * Fields the plugin would ignore or replace: unknown keys, and values the
 * migration changed (a colour it does not know, a wrong type, a tool type
 * that does not exist). These never show as problems in the editor, so an
 * assistant would otherwise not learn that its block says something else.
 */
function fieldNotes(data: Data, loaded: Loaded, defaults: Record<string, Data>): string[] {
    const notes: string[] = [];
    const chartKeys = knownKeys('chart', defaults);
    for (const key of Object.keys(data)) {
        if (chartKeys.has(key)) continue;
        const hint = nearest(key, chartKeys);
        notes.push(`"${key}" is not a chart field and is ignored${hint ? ` (did you mean "${hint}"?)` : ''}`);
    }
    if (data.v !== 4) {
        notes.push(
            impliedV4(data)
                ? '"v": 4 is missing. Add it as the first field: Easy TikZ guesses version 4 for this block, but a block without it can be read as an old 3.x chart.'
                : '"v": 4 is missing: the block is read as a 3.x chart, where text fields are TeX. Add "v": 4 as the first field.'
        );
    }

    const migrated = loaded.settings.serialize();
    const checkList = (key: (typeof LIST_KEYS)[number], partOf: (item: Data) => string) => {
        const list = data[key];
        if (list === undefined) return;
        if (!Array.isArray(list)) {
            notes.push(`"${key}" must be a list [ ... ]`);
            return;
        }
        const after = (migrated[key] as Data[]) || [];
        list.forEach((item: unknown, i: number) => {
            const where = `${key}[${i}]`;
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                notes.push(`${where} must be an object { ... }`);
                return;
            }
            const obj = item as Data;
            const part = partOf(obj);
            // The object's name for messages ("" when it has none or it is not text).
            const name = typeof obj.name === 'string' || typeof obj.name === 'number' ? String(obj.name) : '';
            if (key === 'tools' && !TOOL_TYPES.includes(part as ToolType)) {
                notes.push(`${where}: "type" must be one of ${TOOL_TYPES.map((t) => `"${t}"`).join(', ')}; got ${JSON.stringify(obj.type)}`);
                return;
            }
            const keys = knownKeys(part, defaults);
            for (const k of Object.keys(obj)) {
                if (keys.has(k)) continue;
                const hint = nearest(k, keys);
                notes.push(`${where} (${part}${name ? ` ${name}` : ''}): "${k}" is not a field and is ignored${hint ? ` (did you mean "${hint}"?)` : ''}`);
            }
            if (typeof obj.color === 'string' && !(obj.color in COLOR_MAP)) {
                notes.push(`${where}${name ? ` (${name})` : ''}: colour "${obj.color}" is not one of the plugin's colours, so the LaTeX export can fail${allowed('color')}`);
            }
            const out = after[i];
            if (!out || typeof out !== 'object') return;
            for (const k of Object.keys(obj)) {
                if (!keys.has(k) || k === 'id') continue;
                const was = obj[k];
                const now = out[k];
                if (sameValue(was, now)) continue;
                if (k === 'name' && typeof now === 'string') {
                    notes.push(`${where}: name ${JSON.stringify(was)} became "${now}" (names are letters, digits and _, unique, and not a reserved word)`);
                    continue;
                }
                notes.push(`${where}${name ? ` (${name})` : ''}: "${k}": ${JSON.stringify(was)} is not valid here; the chart uses ${JSON.stringify(now)}${allowed(k)}`);
            }
        });
    };
    checkList('functions', () => 'function');
    checkList('parameters', () => 'parameter');
    checkList('annotations', () => 'label');
    checkList('functions3D', () => 'surface');
    checkList('tools', (o) => String(o.type));

    for (const key of Object.keys(data)) {
        if ((LIST_KEYS as readonly string[]).includes(key) || !chartKeys.has(key) || key === 'v') continue;
        if (!(key in migrated)) continue;
        if (!sameValue(data[key], migrated[key])) {
            notes.push(`"${key}": ${JSON.stringify(data[key])} is not valid here; the chart uses ${JSON.stringify(migrated[key])}${allowed(key)}`);
        }
    }
    return notes;
}

function sameValue(a: unknown, b: unknown): boolean {
    if (typeof a === 'number' && typeof b === 'string') return String(a) === b || Number(b) === a;
    // Optional fields such as "hidden": false are left out when they hold their default.
    if (b === undefined && (a === false || a === '' || a === null)) return true;
    return JSON.stringify(a) === JSON.stringify(b);
}

/** The values a field takes, where they are a short list. */
function allowed(key: string): string {
    const lists: Record<string, string[]> = {
        color: Object.keys(COLOR_MAP),
        thickness: Object.keys(THICKNESS_MAP),
        axis_style: ['box', 'middle', 'axes'],
        coordinateSystem: ['cartesian', 'polar'],
        fillPattern: ['solid', 'horizontal', 'vertical', 'crosshatch', 'dots', 'north-east', 'north-west'],
        outline: ['none', 'solid', 'dashed'],
        style: ['line', 'forward', 'backward', 'both', 'brace'],
        source: ['list', 'intersections', 'region', 'lattice'],
        sense: ['max', 'min'],
        size: ['small', 'normal', 'large'],
        anchor: ['center', 'above', 'below', 'left', 'right'],
        axis: ['x', 'y', 'z'],
    };
    const list = lists[key];
    return list ? ` (allowed: ${list.map((v) => `"${v}"`).join(', ')})` : '';
}

// ------------------------------------------------------------------ check

export interface Report {
    errors: string[];
    infos: string[];
    lines: string[];
}

function n(v: number): string {
    return Number.isFinite(v) ? fmtNum(Math.round(v * 1000) / 1000) : String(v);
}

function pt(p: ArrayLike<number>): string {
    return `(${Array.from(p).map(n).join(', ')})`;
}

function bbox(points: Pt[]): string {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of points) {
        const x = p.x;
        const y = p.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
    }
    if (!Number.isFinite(x0)) return 'nothing';
    return `x ${n(x0)}..${n(x1)}, y ${n(y0)}..${n(y1)}`;
}

function ringArea(ring: Pt[]): number {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
}

/** The labels of scene items with where the placer put them: `"z = 9" right of (3, 1)`. */
function texts(items: SceneItem2D[]): string {
    const all = items.flatMap((it) => it.texts).filter((t) => t.text.trim());
    if (!all.length) return '';
    const one = (t: SceneItem2D['texts'][number]) => {
        // The placer moved it clear of lines and other labels; how far, in pt of the exported figure (a line of text is about 9 pt).
        const moved = t.offset ? ` (moved ${Math.round(Math.hypot(t.offset.x, t.offset.y))} pt off its point to stay clear)` : '';
        return `"${t.text}" ${t.anchor === 'center' ? 'at' : `${t.anchor} of`} ${pt([t.x, t.y])}${moved}`;
    };
    return ` | label${all.length > 1 ? 's' : ''} ${all.map(one).join(', ')}`;
}

/**
 * Limits for charts that come from AI apps (the local AI server checks every
 * chart before it draws or writes it). Far above any real chart; they keep a
 * small request from costing minutes of work on Obsidian's main thread.
 */
export const LIMITS = { functions: 50, tools: 50, labels: 100, surfaces: 10, sliders: 50, conditions: 50, levels: 200, points: 1000, text: 2000, expansion: 1000 };

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strOf = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * What makes a chart too costly to check or draw, found on the raw block
 * without computing anything: too many parts, very long fields, and
 * functions that call each other so often that one point costs thousands of
 * evaluations (f2 = f1(x) + f1(x + 1), f3 = f2(x) + f2(x + 1), ... doubles
 * with every function).
 */
export function costProblems(data: Data): string[] {
    const out: string[] = [];
    const count = (key: string, what: string, max: number) => {
        const n = list(data[key]).length;
        if (n > max) out.push(`too many ${what}: ${n} (at most ${max})`);
    };
    count('functions', 'functions', LIMITS.functions);
    count('tools', 'shapes in "tools"', LIMITS.tools);
    count('annotations', 'text labels', LIMITS.labels);
    count('functions3D', 'surfaces', LIMITS.surfaces);
    count('parameters', 'sliders', LIMITS.sliders);

    const longText = (where: string, v: unknown) => {
        if (strOf(v).length > LIMITS.text) out.push(`${where} is ${strOf(v).length} characters long (at most ${LIMITS.text})`);
    };
    for (const [k, v] of Object.entries(data)) if (typeof v === 'string') longText(`"${k}"`, v);
    list(data.tools).forEach((t, i) => {
        if (!t || typeof t !== 'object') return;
        const tool = t as Data;
        const where = `tools[${i}]`;
        for (const [k, v] of Object.entries(tool)) {
            if (typeof v === 'string') longText(`${where} "${k}"`, v);
            if (Array.isArray(v)) v.forEach((x, j) => longText(`${where} "${k}"[${j}]`, x));
        }
        if (list(tool.conditions).length > LIMITS.conditions) out.push(`${where}: too many conditions (at most ${LIMITS.conditions})`);
        const levels = strOf(tool.levels).split(',').filter((x) => x.trim()).length;
        if (levels > LIMITS.levels) out.push(`${where}: too many levels: ${levels} (at most ${LIMITS.levels})`);
        const points = strOf(tool.points).split(';').filter((x) => x.trim()).length;
        if (points > LIMITS.points) out.push(`${where}: too many points: ${points} (at most ${LIMITS.points})`);
    });
    for (const key of ['functions', 'annotations', 'functions3D', 'parameters']) {
        list(data[key]).forEach((item, i) => {
            if (item && typeof item === 'object') for (const [k, v] of Object.entries(item as Data)) if (typeof v === 'string') longText(`${key}[${i}] "${k}"`, v);
        });
    }

    // How many evaluations of user functions one point of each function costs.
    const fns = list(data.functions).filter((f): f is Data => !!f && typeof f === 'object');
    const names = fns.map((f, i) => (strOf(f.name).trim() || `f${i + 1}`));
    const body = fns.map((f) => [f.expression, f.expressionY, f.domain].map(strOf).join(' '));
    const calls = (from: number, to: number) => {
        const name = names[to].replace(/[^A-Za-z0-9_]/g, '');
        if (!name) return 0;
        const re = new RegExp(`(^|[^A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, 'g');
        return (body[from].match(re) || []).length;
    };
    const memo = new Map<number, number>();
    const visiting = new Set<number>();
    const expansion = (i: number): number => {
        const known = memo.get(i);
        if (known !== undefined) return known;
        // A cycle is the plugin's own error ("cycle"); it costs nothing here.
        if (visiting.has(i)) return 1;
        visiting.add(i);
        let total = 1;
        for (let j = 0; j < names.length && total <= LIMITS.expansion; j++) {
            if (j === i) continue;
            const n = calls(i, j);
            if (n) total += n * expansion(j);
        }
        visiting.delete(i);
        memo.set(i, total);
        return total;
    };
    names.forEach((name, i) => {
        const cost = expansion(i);
        if (cost > LIMITS.expansion) out.push(`${name} calls other functions so often that one point costs over ${LIMITS.expansion} evaluations; write it out instead of nesting calls`);
    });
    return out;
}

/** TeX that the LaTeX export would pass through and pdflatex would run: reading or writing files, new definitions, leaving the picture. */
const UNSAFE_TEX = /\\(input|include|openin|openout|read|readline|write|immediate|catcode|def|edef|gdef|xdef|let|csname|special|directlua|usepackage|RequirePackage|documentclass|newwrite|newread|makeatletter|ShellEscape|pdfprimitive)(?![A-Za-z])|\\(begin|end)\s*\{\s*(document|tikzpicture|axis)\s*\}/;

/** Text fields (title, axis names, legends, labels) that carry TeX the export would run. */
export function texProblems(data: Data): string[] {
    const out: string[] = [];
    const look = (where: string, v: unknown) => {
        const m = UNSAFE_TEX.exec(strOf(v));
        if (m) out.push(`${where} contains ${m[0].replace(/\s+/g, '')}, which pdflatex would run when the chart is exported; text fields from AI apps may not hold it`);
    };
    for (const k of ['title', 'axis_label_x', 'axis_label_y', 'axis_label_z', 'axis_label_x_polar', 'axis_label_y_polar']) look(`"${k}"`, data[k]);
    list(data.functions).forEach((f, i) => f && typeof f === 'object' && look(`functions[${i}] "legendLabel"`, (f as Data).legendLabel));
    list(data.annotations).forEach((a, i) => a && typeof a === 'object' && look(`annotations[${i}] "text"`, (a as Data).text));
    list(data.tools).forEach((t, i) => {
        if (!t || typeof t !== 'object') return;
        look(`tools[${i}] "label"`, (t as Data).label);
        list((t as Data).conditionLabels).forEach((c, j) => look(`tools[${i}] "conditionLabels"[${j}]`, c));
    });
    return out;
}

/** The chart with some sliders set to other values (to check the ends of their ranges). Unknown names are reported. */
export function withSliders(data: Data, sliders: Record<string, number>, report?: Report): Data {
    const names = Object.keys(sliders || {});
    if (!names.length) return data;
    const out = clone(data);
    const params = Array.isArray(out.parameters) ? (out.parameters as Data[]) : [];
    for (const name of names) {
        const value = Number(sliders[name]);
        const p = params.find((q) => q && q.name === name);
        if (!p || !Number.isFinite(value)) {
            report?.errors.push(`sliders: "${name}" is not a slider of this chart${Number.isFinite(value) ? '' : ' or its value is not a number'}`);
            continue;
        }
        p.value = value;
    }
    return out;
}

export function check(data: Data, sliders: Record<string, number> = {}): Report {
    const defaults = defaultsByPart();
    const report: Report = { errors: [], infos: [], lines: [] };
    // Nothing is computed for a chart over the limits: that is what they protect.
    const cost = costProblems(data);
    if (cost.length) {
        report.errors.push(...cost.map((c) => `too large to check: ${c}`));
        report.lines.push('Not computed: the chart is over the limits for charts from AI apps.');
        return report;
    }
    let loaded: Loaded;
    try {
        // Read as a note reads it: a block without "v" and without 3.x fields is a version 4 chart.
        loaded = load(withSliders(impliedV4(data) ? { v: 4, ...data } : data, sliders, report));
    } catch (e) {
        report.errors.push(`could not load the chart: ${e instanceof Error ? e.message : String(e)}`);
        return report;
    }
    const { settings, math, config } = loaded;
    const issues: SceneIssue[] = [];
    for (const text of settings.resolveView(math).errors) {
        if (/^z(min|max)/.test(text) && !config.is3D) continue;
        issues.push({ source: 'chart', message: text, severity: 'error' });
    }
    for (const p of math.parameterIssues()) issues.push(p);

    const L = report.lines;
    L.push(`${config.is3D ? '3D chart' : config.coordinateSystem === 'polar' ? 'Polar chart' : '2D chart'}: x ${n(config.xmin)}..${n(config.xmax)}, y ${n(config.ymin)}..${n(config.ymax)}${config.is3D ? `, z ${n(config.zmin)}..${n(config.zmax)}` : ''}${config.is3D ? '' : `, axis style ${config.axisStyle}`}`);
    if (config.parameters.length) {
        L.push(`Sliders: ${config.parameters.map((p) => `${p.name} = ${n(p.value)} (${n(p.min)}..${n(p.max)}, step ${n(p.step)})`).join('; ')}`);
    }

    if (config.is3D) {
        const scene = computeScene3D({
            tools: config.tools,
            math,
            view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax, zmin: config.zmin, zmax: config.zmax },
        });
        issues.push(...scene.issues);
        (config.functions3D || []).forEach((surface, i) => {
            if (!surface || !String(surface.expression ?? '').trim()) return;
            const source = surface.name || `Surface ${i + 1}`;
            let note = '';
            try {
                const f = math.fn2(surface.expression);
                const v = f((config.xmin + config.xmax) / 2, (config.ymin + config.ymax) / 2);
                note = `, z at the centre of the view = ${n(v)}`;
            } catch (e) {
                issues.push({ source, field: 'expression', message: e instanceof Error ? e.message : String(e), severity: 'error' });
            }
            L.push(`${source}: z = ${surface.expression}${surface.hidden ? ' (hidden)' : ''}${note}`);
        });
        if (scene.points.length) L.push(`Points: ${scene.points.map((p) => pt([p.x, p.y, p.z]) + (p.label ? ` "${p.label}"` : '')).join(' ')}`);
        if (scene.segments.length) L.push(`Segments: ${scene.segments.map((s) => `${pt(s.a)} to ${pt(s.b)}`).join('; ')}`);
        if (scene.planes.length) L.push(`Planes: ${scene.planes.map((p) => `${p.axis} = ${n(p.value)}`).join('; ')}`);
        for (const tool of config.tools) {
            if (tool.type !== 'plane3D') continue;
            const v = math.tryValue(tool.value);
            if (!v.ok) issues.push({ source: tool.name, field: 'value', message: v.message, severity: 'error' });
            else if (!scene.planes.length) L.push(`${tool.name} plane ${tool.axis} = ${n(v.value)}${tool.hidden ? ' (hidden)' : ''}`);
        }
    } else {
        const functions = config.functions || [];
        const infos = math.functions();
        for (const info of infos) {
            const f = functions[info.index];
            if (!f || (!String(f.expression ?? '').trim() && !(f.parametric && String(f.expressionY ?? '').trim()))) continue;
            if (info.error) issues.push({ source: info.name, field: 'expression', message: info.error, severity: 'error' });
            else if (info.domainError) issues.push({ source: info.name, field: 'domain', message: info.domainError, severity: 'error' });
            const opts: string[] = [];
            if (f.hidden) opts.push('hidden');
            if (f.domain && f.domain.trim()) opts.push(`domain ${f.domain}`);
            if (f.tangent) opts.push(`tangent at ${f.tangentPoint || '?'}`);
            if (f.extrema) opts.push('extrema');
            if (f.fill) opts.push('filled to the x-axis');
            if (f.showLegend) opts.push(`legend ${JSON.stringify(f.legendLabel || f.expression)}`);
            let shape = '';
            if (!info.error && !info.domainError && !f.hidden) shape = sampledShape(info, config);
            const what = info.kind === 'parametric' ? `x(t) = ${f.expression}, y(t) = ${f.expressionY}` : info.kind === 'polar' ? `r(theta) = ${f.expression}` : `y = ${f.expression}`;
            L.push(`${info.name}: ${what}${opts.length ? ` [${opts.join(', ')}]` : ''}${shape}`);
        }
        const scene: Scene2D = computeScene2D({
            functions,
            tools: config.tools,
            math,
            view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
            grid: marchingGrid(config.width * 0.85, config.height * 0.8, 1, 'full'),
            axisStyle: config.axisStyle,
            polar: config.coordinateSystem === 'polar',
            labelMetrics: labelMetricsFor(config.paperWidthCm ?? 10, config.paperHeightCm ?? 10),
        });
        issues.push(...scene.issues);
        for (const info of infos) {
            const f = functions[info.index];
            if (!f || f.hidden || info.error || info.domainError) continue;
            const items = scene.items.filter((it) => it.kind === 'function' && it.source === info.name);
            const parts: string[] = [];
            if (f.tangent) {
                const at = math.tryValue(String(f.tangentPoint ?? ''));
                if (at.ok && info.kind === 'cartesian') {
                    const x0 = at.value;
                    const h = 1e-5 * (1 + Math.abs(x0));
                    const slope = (info.fn(x0 + h) - info.fn(x0 - h)) / (2 * h);
                    parts.push(`tangent at ${pt([x0, info.fn(x0)])}, slope ${n(slope)}`);
                } else {
                    parts.push(`tangent at ${String(f.tangentPoint || '?')}${items.some((it) => it.strokes.length) ? '' : ' (NOT DRAWN)'}`);
                }
            }
            const extrema = items.flatMap((it) => it.texts.filter((t) => /^(max|min)/.test(t.text)).map((t) => `${t.text} ${pt([t.x, t.y])}`));
            if (f.extrema) parts.push(extrema.length ? `extrema: ${extrema.join(', ')}` : 'extrema: none in the view');
            if (parts.length) L.push(`  ${info.name}: ${parts.join('; ')}`);
        }
        for (const tool of config.tools) L.push(toolLine(tool, scene));
        // A points tool without an objective publishes no value (NaN): leave it out.
        const derived = Object.entries(scene.derived).filter(([, v]) => Number.isFinite(v));
        if (derived.length) L.push(`Computed values: ${derived.map(([k, v]) => `${k} = ${n(v)}`).join(', ')}`);
    }

    const title = String(config.title ?? '').trim();
    if (title) {
        const ok = math.validate(title, 'template');
        if (!ok.ok) issues.push({ source: 'chart', field: 'title', message: ok.message, severity: 'error' });
        L.push(`Title: "${math.formatTemplate(title)}"`);
    }
    (config.annotations || []).forEach((a: Annotation, i) => {
        if (!a || !String(a.text ?? '').trim()) return;
        const source = `label:${i}`;
        const ok = math.validate(a.text, 'template');
        if (!ok.ok) issues.push({ source, field: 'text', message: ok.message, severity: 'error' });
        const pos: string[] = [];
        for (const field of ['x', 'y', 'z'] as const) {
            if (field === 'z' && !config.is3D) continue;
            const res = math.tryValue(String(a[field] ?? ''));
            if (!res.ok) issues.push({ source, field, message: res.message, severity: 'error' });
            else pos.push(n(res.value));
        }
        L.push(`Label ${i + 1}: "${math.formatTemplate(a.text)}" at (${pos.join(', ')})${a.hidden ? ' (hidden)' : ''}`);
    });

    for (const issue of issues) {
        if (issue.hiddenSource) continue;
        const text = issueText(issue);
        const fix = fixHint(issue.message);
        if (issue.severity === 'info') report.infos.push(text + fix);
        else report.errors.push(text + fix);
    }
    report.errors.push(...fieldNotes(data, loaded, defaults));
    report.errors.push(...texProblems(data));
    return report;
}

/** Where a function is visible in the view, from 400 samples: catches a plot that runs off the chart. */
function sampledShape(info: ReturnType<MathContext['functions']>[number], config: RendererConfig): string {
    if (info.kind !== 'cartesian') return '';
    const lo = info.domain ? Math.max(info.domain[0], config.xmin) : config.xmin;
    const hi = info.domain ? Math.min(info.domain[1], config.xmax) : config.xmax;
    let shown = 0;
    let total = 0;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i <= 400; i++) {
        const x = lo + ((hi - lo) * i) / 400;
        const y = info.fn(x);
        if (!Number.isFinite(y)) continue;
        total++;
        if (y >= config.ymin && y <= config.ymax) shown++;
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
    }
    if (!total) return ' | no values in the view';
    const share = Math.round((100 * shown) / total);
    return ` | y ${n(y0)}..${n(y1)} over the view, ${share} % of it inside the y range`;
}

function toolLine(tool: Tool, scene: Scene2D): string {
    const items = scene.items.filter((it) => it.kind === 'tool' && it.source === tool.name);
    const hidden = tool.hidden ? ' (hidden)' : '';
    switch (tool.type) {
        case 'region': {
            const rings = items.flatMap((it) => it.fills.flatMap((f) => f.rings));
            const area = rings.reduce((s, r) => s + ringArea(r), 0);
            const shaded = area > 1e-9 ? `shaded where ${bbox(rings.flat())}` : 'EMPTY: nothing is shaded in the view';
            const lines = items.reduce((s, it) => s + it.strokes.length, 0);
            return `${tool.name} region (${tool.conditions.filter((c) => c.trim()).join('; ')}): ${tool.fill === false ? 'no fill, ' : ''}${shaded}${lines ? `, ${lines} line set${lines > 1 ? 's' : ''}` : ''}${texts(items)}${hidden}`;
        }
        case 'curve': {
            const lines = items.flatMap((it) => it.strokes.flatMap((s) => s.lines));
            const drawn = lines.length ? `drawn where ${bbox(lines.flat())}` : 'NOT VISIBLE in the view';
            return `${tool.name} curve ${tool.equation}${tool.levels.trim() ? ` at levels ${tool.levels}` : ''}: ${drawn}${texts(items)}${hidden}`;
        }
        case 'points': {
            const marks = items.flatMap((it) => it.markers.map((m) => pt([m.x, m.y])));
            const what =
                tool.source === 'list'
                    ? 'list'
                    : tool.source === 'intersections'
                      ? `intersections of ${tool.ref1} and ${tool.ref2}`
                      : tool.source === 'region'
                        ? tool.objective.trim()
                            ? `best point of region ${tool.regionName}`
                            : `corners of region ${tool.regionName}`
                        : `integer points${tool.regionName ? ` of region ${tool.regionName}` : ''}`;
            const objective = tool.objective.trim() ? `, ${tool.sense} ${tool.objective}` : '';
            return `${tool.name} points (${what}${objective}): ${marks.length ? marks.join(' ') : 'NONE'}${texts(items)}${hidden}`;
        }
        case 'segment': {
            const lines = items.flatMap((it) => it.strokes.flatMap((s) => s.lines));
            const pts = lines.flat();
            return `${tool.name} segment (${tool.style}${tool.closed ? ', closed' : ''}): ${pts.length ? pts.map((p) => pt([p.x, p.y])).join(' to ') : 'NOT DRAWN'}${texts(items)}${hidden}`;
        }
        default:
            return `${tool.name} ${tool.type}${hidden}`;
    }
}

/** A concrete fix for the problems an assistant meets most. */
function fixHint(message: string): string {
    if (/Did you mean/.test(message)) return '';
    const unknown = /Unknown name '?([A-Za-z_][A-Za-z0-9_]*)'?/.exec(message);
    if (unknown) {
        const name = unknown[1];
        if (/^[a-z][a-z]+$/.test(name) && name.length > 1 && name.length <= 3) {
            return ` -> if "${name}" is a product, write it with a space or * (for example "${name.split('').join(' ')}"); if it is a slider, add {"name": "${name}", "value": 1, "min": 0, "max": 10, "step": 0.1} to "parameters"`;
        }
        return ` -> add a slider: {"name": "${name}", "value": 1, "min": 0, "max": 10, "step": 0.1} in "parameters", or use a defined name`;
    }
    return '';
}

// ------------------------------------------------------------- minimize

/** The block with every field left out that equals what the plugin would fill in. Same chart, much shorter. */
export function minimize(data: Data): Data {
    const base = canonical(data);
    let cur = clone(data);
    if (cur.v === undefined) cur = { v: 4, ...cur };
    const tryDelete = (mutate: (d: Data) => void) => {
        const trial = clone(cur);
        mutate(trial);
        if (canonical(trial) === base) cur = trial;
    };
    for (const key of Object.keys(cur)) {
        if (key === 'v' || (LIST_KEYS as readonly string[]).includes(key)) continue;
        tryDelete((d) => delete d[key]);
    }
    for (const key of LIST_KEYS) {
        const list = cur[key];
        if (!Array.isArray(list)) continue;
        if (list.length === 0) {
            tryDelete((d) => delete d[key]);
            continue;
        }
        if (key === 'parameters') continue;
        for (let i = 0; i < list.length; i++) {
            const item = (cur[key] as Data[])[i];
            for (const k of Object.keys(item)) {
                if (k === 'type' || k === 'name') continue;
                tryDelete((d) => delete (d[key] as Data[])[i][k]);
            }
        }
    }
    return ordered(cur);
}

/** Chart keys in reading order (v, title, view, sliders, functions, tools, labels), and type and name first in every list item. */
function ordered(data: Data): Data {
    const first = ['v', 'dimension', 'title', 'xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax', 'axis_style', 'parameters', 'functions', 'functions3D', 'tools', 'annotations'];
    const out: Data = {};
    for (const k of first) if (k in data) out[k] = data[k];
    for (const k of Object.keys(data)) if (!(k in out)) out[k] = data[k];
    for (const key of LIST_KEYS) {
        const list = out[key];
        if (!Array.isArray(list)) continue;
        out[key] = list.map((item: Data) => {
            const o: Data = {};
            for (const k of ['type', 'name']) if (k in item) o[k] = item[k];
            for (const k of Object.keys(item)) if (!(k in o)) o[k] = item[k];
            return o;
        });
    }
    return out;
}

/** JSON with short objects and lists on one line, as the README's example block. */
export function compactJson(value: unknown, indent = ''): string {
    const flat = inlineJson(value);
    if (flat.length + indent.length <= 100 || value === null || typeof value !== 'object') return flat;
    const inner = indent + '  ';
    if (Array.isArray(value)) return `[\n${value.map((v) => inner + compactJson(v, inner)).join(',\n')}\n${indent}]`;
    const entries = Object.entries(value as Data).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${compactJson(v, inner)}`);
    return `{\n${entries.join(',\n')}\n${indent}}`;
}

/** JSON on one line with a space after every `,` and `:` between tokens (strings are written exactly as JSON.stringify writes them). */
function inlineJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(inlineJson).join(', ')}]`;
    return `{${Object.entries(value as Data)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${JSON.stringify(k)}: ${inlineJson(v)}`)
        .join(', ')}}`;
}

export function fenced(data: Data): string {
    return '```easy-tikz\n' + compactJson(data) + '\n```';
}

// ------------------------------------------------------------- examples

interface Example {
    id: string;
    title: string;
    about: string;
    data: Data;
}

export function examples(): Example[] {
    const out: Example[] = EXAMPLES.map((e) => ({ id: e.id, title: e.title, about: e.description, data: e.data }));
    for (const g of GUIDES) out.push({ id: g.id, title: g.title, about: g.summary, data: g.chart });
    return out;
}


/** The pgfplots code the plugin exports for a chart: a standalone document, or the tikzpicture alone. */
export function tikzOf(data: Data, standalone = true): string {
    const loaded = load(data);
    if (!standalone) loaded.settings.setValue('documentSetup', false);
    return loaded.settings.generateTikzCode(loaded.math);
}

/** Every part of a chart with its default fields, as `fields` prints it. */
export function fieldsText(): string {
    const out: string[] = [];
    for (const [part, d] of Object.entries(defaultsByPart())) {
        const shown = clone(d);
        delete shown.id;
        out.push(`${part}: ${compactJson(shown)}`);
    }
    return out.join('\n\n');
}
