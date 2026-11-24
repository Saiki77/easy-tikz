/*
 * Ask the curve (6.0 B): a click on a function, a region, a curve or a point
 * of a chart opens a menu of questions about it, built from what the chart
 * holds (every other function adds its pair questions). A question's answer
 * is chart text: lines to add (`mark where $f(x) \le 0$ on the x-axis,
 * labelled`) or fields of the clicked object to set (`with its extrema`).
 *
 * Questions come from providers, registered per kind of object: parts D and
 * E add theirs with registerQuestions('function', provider) and the like
 * (docs/v6/notes6.md). The hosts (the editor's preview, the chart under a
 * block in Live Preview) find what was clicked with pickTarget, list the
 * questions with askQuestions, show an answer faintly with applyAnswer and
 * add it with applyAnswer (or take it away with removeAnswer when it is
 * there already). Pure: no DOM, no Obsidian.
 */
import type { FunctionParameters, Parameter, Tool } from '../types';
import type { MathContext } from '../mathcontext';
import type { View, Pt } from '../geometry';
import type { SceneItem2D } from '../scene';
import { SettingsManager } from '../settings';
import { parseChartText } from '../text/parse';
import { printWordsText } from '../text/print';
import { NO_WORDS } from '../text/words';
import { stableJson } from '../chartdata';
import { looksLikeLatex } from '../latex';
import { niceStep, stepDecimals } from '../fit';
import { decimal } from '../beyond/maths';
import { t } from '../i18n';
import { solveSet } from './sets';

type Data = Record<string, unknown>;

/** What a question is about. */
export type AskKind = 'function' | 'region' | 'curve' | 'point';

/** What was clicked: its kind and name, and where (math coordinates; for a function, the point on it). */
export interface AskTarget {
    kind: AskKind;
    name: string;
    x: number;
    y: number;
}

/** What a question adds: lines in the chart language (built-in words), fields of one object, or both. */
export interface Answer {
    lines?: string[];
    /** Fields of the object `name` of a list, set to `on`; taking the answer away sets them to `off`. */
    patch?: { list: 'functions' | 'tools'; name: string; on: Data; off: Data };
}

export interface Question {
    /** Stable id, unique in a menu: 'le', 'cross:g', 'tangent'. */
    id: string;
    /** The heading it stands under in the menu (the reader's language). */
    group: string;
    /** Its text in the menu (the reader's language). */
    label: string;
    answer: Answer;
}

/** What a provider reads. */
export interface AskContext {
    target: AskTarget;
    /** The chart as stored (serialized: every field filled in). */
    data: Data;
    view: View;
    /** The chart's math, slider values set. */
    math: MathContext;
    functions: FunctionParameters[];
    tools: Tool[];
    parameters: Parameter[];
    /** A number as a line writes it: rounded to what the view shows. */
    num(v: number): string;
    /** A formula as a line writes it: in $...$ when it is LaTeX. */
    formula(src: string): string;
    /** A name nobody in the chart has yet, from `wanted` on (wanted, wanted2, ...). */
    freeName(wanted: string): string;
    /** The cartesian functions of the chart that draw, other than `but`. */
    otherFunctions(but?: string): string[];
}

export type QuestionProvider = (ctx: AskContext) => Question[];

const PROVIDERS: Record<AskKind, QuestionProvider[]> = { function: [], region: [], curve: [], point: [] };

/** Add questions for a kind of object; returns a function that takes them away again. */
export function registerQuestions(kind: AskKind, provider: QuestionProvider): () => void {
    PROVIDERS[kind].push(provider);
    return () => {
        const i = PROVIDERS[kind].indexOf(provider);
        if (i >= 0) PROVIDERS[kind].splice(i, 1);
    };
}

// ---------------------------------------------------------------- context

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** The context for a target: the chart's lists, the number and formula writers. */
export function askContext(target: AskTarget, data: Data, view: View, math: MathContext): AskContext {
    const functions = list<FunctionParameters>(data.functions);
    const tools = list<Tool>(data.tools);
    const parameters = list<Parameter>(data.parameters);
    const decimals = Math.min(6, stepDecimals(niceStep(Math.max(view.xmax - view.xmin, view.ymax - view.ymin) / 200)));
    const taken = new Set<string>([...functions.map((f) => f.name ?? ''), ...tools.map((x) => x.name), ...parameters.map((p) => p.name)]);
    return {
        target,
        data,
        view,
        math,
        functions,
        tools,
        parameters,
        num: (v) => decimal(v, decimals),
        formula: (src) => (looksLikeLatex(src) ? `$${src}$` : src),
        freeName: (wanted) => {
            if (!taken.has(wanted)) return wanted;
            for (let k = 2; ; k++) if (!taken.has(`${wanted}${k}`)) return `${wanted}${k}`;
        },
        otherFunctions: (but) =>
            math
                .functions()
                .filter((info) => info.kind === 'cartesian' && !info.hidden && !info.error && info.name !== but && !!functions[info.index]?.expression?.trim())
                .map((info) => info.name),
    };
}

/** Every question for the target, in the order the providers give them (an id once). */
export function askQuestions(ctx: AskContext): Question[] {
    const out: Question[] = [];
    const seen = new Set<string>();
    for (const provider of PROVIDERS[ctx.target.kind]) {
        let qs: Question[];
        try {
            qs = provider(ctx);
        } catch {
            continue;
        }
        for (const q of qs) {
            if (seen.has(q.id)) continue;
            seen.add(q.id);
            out.push(q);
        }
    }
    return out;
}

// ---------------------------------------------------------------- picking

/** What the hosts know of a drawn chart: its items and its function curves (SVGRenderer.drawn). */
export interface DrawnChart {
    items: SceneItem2D[];
    curves: Array<{ name: string; kind: string; lines: Pt[][] }>;
}

/** Distance from p to the segment ab in px, given px per math unit. */
function segmentPx(p: Pt, a: Pt, b: Pt, sx: number, sy: number): number {
    const ax = (a.x - p.x) * sx;
    const ay = (a.y - p.y) * sy;
    const bx = (b.x - p.x) * sx;
    const by = (b.y - p.y) * sy;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const k = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    return Math.hypot(ax + k * dx, ay + k * dy);
}

/** The nearest point on polylines, its distance in px. */
function nearest(lines: Pt[][], p: Pt, sx: number, sy: number): { d: number; at: Pt } | null {
    let best: { d: number; at: Pt } | null = null;
    for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
            const a = line[i - 1];
            const b = line[i];
            if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
            const d = segmentPx(p, a, b, sx, sy);
            if (!best || d < best.d) {
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len2 = dx * dx * sx * sx + dy * dy * sy * sy;
                const k = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx * sx * sx + (p.y - a.y) * dy * sy * sy) / len2)) : 0;
                best = { d, at: { x: a.x + k * dx, y: a.y + k * dy } };
            }
        }
    }
    return best;
}

/** Is p inside the even-odd rings? */
function inside(rings: Pt[][], p: Pt): boolean {
    let odd = false;
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[i];
            const b = ring[j];
            if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
        }
    }
    return odd;
}

/**
 * What a click at `p` (math coordinates) hits: a point first, then a
 * function's curve, a curve, a region. `sx`, `sy`: px per math unit;
 * `tol`: how near in px counts (larger for touch).
 */
export function pickTarget(drawn: DrawnChart, tools: Tool[], p: Pt, sx: number, sy: number, tol: number): AskTarget | null {
    const type = (name: string) => tools.find((x) => x.name === name)?.type;
    const best: { d: number; target: AskTarget | null } = { d: Infinity, target: null };
    const offer = (d: number, target: AskTarget, bias = 0) => {
        if (d <= tol && d + bias < best.d) {
            best.d = d + bias;
            best.target = target;
        }
    };
    for (const item of drawn.items) {
        if (item.kind !== 'tool' || type(item.source) !== 'points') continue;
        for (const m of item.markers) offer(Math.hypot((m.x - p.x) * sx, (m.y - p.y) * sy), { kind: 'point', name: item.source, x: m.x, y: m.y }, -4);
    }
    for (const c of drawn.curves) {
        if (c.kind !== 'cartesian') continue;
        const n = nearest(c.lines, p, sx, sy);
        if (n) offer(n.d, { kind: 'function', name: c.name, x: n.at.x, y: n.at.y });
    }
    for (const item of drawn.items) {
        if (item.kind !== 'tool' || type(item.source) !== 'curve') continue;
        const n = nearest(item.strokes.flatMap((s) => s.lines), p, sx, sy);
        if (n) offer(n.d, { kind: 'curve', name: item.source, x: n.at.x, y: n.at.y });
    }
    if (best.target) return best.target;
    // A region: the click inside its fill (the last one drawn is on top).
    for (let i = drawn.items.length - 1; i >= 0; i--) {
        const item = drawn.items[i];
        if (item.kind !== 'tool' || type(item.source) !== 'region') continue;
        if (item.fills.some((f) => inside(f.rings, p))) return { kind: 'region', name: item.source, x: p.x, y: p.y };
    }
    return null;
}

// ------------------------------------------------------------- answering

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A list item as the chart stores it, without its id and name, for comparing. */
function sameKey(listName: string, item: Data): string {
    const full = SettingsManager.fromJSON({ v: 4, [listName]: [clone(item)] }).serialize();
    const one: Data = { ...(list<Data>(full[listName])[0] ?? {}) };
    delete one.id;
    delete one.name;
    return stableJson(one);
}

const LISTS = ['parameters', 'functions', 'tools', 'annotations'] as const;

/** The items the answer's lines make, per list, read in the chart's context (names taken stay taken). */
function newItems(data: Data, all: string[]): Record<(typeof LISTS)[number], Data[]> | null {
    // A slider the chart has already (the answer went in before) is not made twice.
    const sliders = new Set(list<Parameter>(data.parameters).map((p) => p.name));
    const lines = all.filter((l) => {
        const m = /^slider\s+([A-Za-z][A-Za-z0-9_]*)\b/.exec(l.trim());
        return !m || !sliders.has(m[1]);
    });
    const base = printWordsText(data, true);
    const before = parseChartText(base, { words: NO_WORDS });
    const after = parseChartText(`${base}\n${lines.join('\n')}`, { words: NO_WORDS });
    // A problem on a line of the answer: it does not read.
    const first = base.split('\n').length + 1;
    if (after.problems.some((p) => p.line >= first)) return null;
    const out: Record<(typeof LISTS)[number], Data[]> = { parameters: [], functions: [], tools: [], annotations: [] };
    for (const key of LISTS) {
        const a = list<Data>(before.data[key]);
        const b = list<Data>(after.data[key]);
        out[key] = b.slice(a.length);
    }
    return out;
}

/** The chart with the answer in it (lines added, fields set), as the chart stores it; null when the answer does not read. */
export function applyAnswer(data: Data, answer: Answer): Data | null {
    const next = clone(data);
    if (answer.lines && answer.lines.length) {
        const items = newItems(data, answer.lines);
        if (!items) return null;
        for (const key of LISTS) if (items[key].length) next[key] = [...list<Data>(next[key]), ...items[key]];
    }
    if (answer.patch) {
        const item = list<Data>(next[answer.patch.list]).find((x) => x.name === answer.patch?.name);
        if (!item) return null;
        Object.assign(item, clone(answer.patch.on));
    }
    return SettingsManager.fromJSON(next).serialize();
}

/** Is the answer in the chart already (its objects there, its fields set)? */
export function answerPresent(data: Data, answer: Answer): boolean {
    if (answer.patch) {
        const item = list<Data>(data[answer.patch.list]).find((x) => x.name === answer.patch?.name);
        if (!item || !Object.entries(answer.patch.on).every(([k, v]) => stableJson(item[k]) === stableJson(v))) return false;
    }
    if (answer.lines && answer.lines.length) {
        const items = newItems(data, answer.lines);
        if (!items) return false;
        // Sliders an answer brings along (lambda, n) do not count: the objects do.
        for (const key of ['functions', 'tools', 'annotations'] as const) {
            const have = new Set(list<Data>(data[key]).map((x) => sameKey(key, x)));
            if (!items[key].every((x) => have.has(sameKey(key, x)))) return false;
        }
        if (!items.functions.length && !items.tools.length && !items.annotations.length) return false;
    }
    return !!(answer.patch || (answer.lines && answer.lines.length));
}

/** The chart without the answer: its objects taken out, its fields set back. */
export function removeAnswer(data: Data, answer: Answer): Data {
    const next = clone(data);
    if (answer.patch) {
        const item = list<Data>(next[answer.patch.list]).find((x) => x.name === answer.patch?.name);
        if (item) Object.assign(item, clone(answer.patch.off));
    }
    if (answer.lines && answer.lines.length) {
        const items = newItems(data, answer.lines);
        if (items) {
            for (const key of ['functions', 'tools', 'annotations'] as const) {
                const drop = new Set(items[key].map((x) => sameKey(key, x)));
                next[key] = list<Data>(next[key]).filter((x) => !drop.has(sameKey(key, x)));
            }
        }
    }
    return SettingsManager.fromJSON(next).serialize();
}

// -------------------------------------------------------------- questions

/** Where g has a zero, near the view. */
function zerosOf(g: (x: number) => number, view: View): number[] {
    const span = view.xmax - view.xmin;
    return solveSet({ disjuncts: [], zeros: g }, view.xmin - span, view.xmax + span)
        .filter((p) => p.a === p.b)
        .map((p) => p.a);
}

/** The interval around x0 between the zeros next to it; one side the view when there is no zero there. */
function around(x0: number, zeros: number[], view: View): [number, number] | null {
    const left = zeros.filter((z) => z < x0).pop();
    const right = zeros.find((z) => z > x0);
    if (left === undefined && right === undefined) return null;
    return [left ?? x0, right ?? x0].map((v) => Math.max(view.xmin, Math.min(view.xmax, v))) as [number, number];
}

/** Where f'' changes sign in the view (numerically). */
function inflections(f: (x: number) => number, view: View): number[] {
    const n = 400;
    const span = view.xmax - view.xmin;
    const h = span / n;
    const d2 = (x: number) => (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
    const out: number[] = [];
    let prev = d2(view.xmin);
    for (let i = 1; i <= n; i++) {
        const x = view.xmin + i * h;
        const cur = d2(x);
        if (Number.isFinite(prev) && Number.isFinite(cur) && prev !== 0 && Math.sign(prev) !== Math.sign(cur) && Math.abs(prev - cur) < 1e6) {
            let a = x - h;
            let b = x;
            for (let k = 0; k < 40; k++) {
                const m = (a + b) / 2;
                if (Math.sign(d2(m)) === Math.sign(d2(a))) a = m;
                else b = m;
            }
            out.push((a + b) / 2);
        }
        prev = cur;
    }
    return out.slice(0, 6);
}

/** The questions about a function y = f(x). */
function functionQuestions(ctx: AskContext): Question[] {
    const f = ctx.target.name;
    const info = ctx.math.functionInfo(f);
    if (!info || info.kind !== 'cartesian') return [];
    const fn = info.fn;
    const { view, num } = ctx;
    const x0 = ctx.target.x;
    const q: Question[] = [];
    const axis = t('notes6.ask.group.axis');
    const sign: Array<[string, string, 'notes6.ask.le' | 'notes6.ask.ge' | 'notes6.ask.lt' | 'notes6.ask.gt']> = [
        ['le', '\\le', 'notes6.ask.le'],
        ['ge', '\\ge', 'notes6.ask.ge'],
        ['lt', '<', 'notes6.ask.lt'],
        ['gt', '>', 'notes6.ask.gt'],
    ];
    for (const [id, op, key] of sign) q.push({ id, group: axis, label: t(key, { f }), answer: { lines: [`mark where $${f}(x) ${op} 0$ on the x-axis, labelled`] } });
    q.push({ id: 'zeros', group: axis, label: t('notes6.ask.zeros', { f }), answer: { lines: [`mark where $${f}(x) = 0$ on the x-axis, labelled`] } });

    const shape = t('notes6.ask.group.shape');
    q.push({ id: 'extrema', group: shape, label: t('notes6.ask.extrema'), answer: { patch: { list: 'functions', name: f, on: { extrema: true }, off: { extrema: false } } } });
    const turns = inflections(fn, view);
    if (turns.length) {
        const pts = turns.map((x) => `(${num(x)}, ${f}(${num(x)}))`);
        q.push({ id: 'inflection', group: shape, label: t('notes6.ask.inflection', { count: turns.length }), answer: { lines: [`mark ${pts.join(' and ')}, with coordinates`] } });
    }

    const here = t('notes6.ask.group.here', { x: num(x0) });
    q.push({ id: 'tangent', group: here, label: t('notes6.ask.tangent'), answer: { patch: { list: 'functions', name: f, on: { tangent: true, tangentPoint: num(x0) }, off: { tangent: false } } } });
    q.push({ id: 'value', group: here, label: t('notes6.ask.value'), answer: { lines: [`mark (${num(x0)}, ${f}(${num(x0)})), with coordinates`] } });
    const reach = (view.xmax - view.xmin) / 4;
    const x1 = x0 + reach <= view.xmax ? x0 + reach : x0 - reach;
    const lambdaSlider = ctx.parameters.find((p) => p.name === 'lambda');
    const lambda = lambdaSlider ? 'lambda' : ctx.freeName('lambda');
    const chordLines = lambdaSlider ? [] : [`slider ${lambda} from 0 to 1, starting at 0.5`];
    chordLines.push(`draw the chord of ${f} from ${num(Math.min(x0, x1))} to ${num(Math.max(x0, x1))} at ${lambda === 'lambda' ? '$\\lambda$' : lambda}, labelled`);
    q.push({ id: 'chord', group: here, label: t('notes6.ask.chord'), answer: { lines: chordLines } });

    const areas = t('notes6.ask.group.area');
    const span = around(x0, zerosOf(fn, view), view) ?? [view.xmin, view.xmax];
    const [a, b] = span[0] < span[1] ? span : [span[1], span[0]];
    if (b > a) {
        q.push({ id: 'area', group: areas, label: t('notes6.ask.area', { f, a: num(a), b: num(b) }), answer: { lines: [`shade under ${f} from x = ${num(a)} to ${num(b)}`] } });
        const nSlider = ctx.parameters.find((p) => p.name === 'n');
        const n = nSlider ? 'n' : ctx.freeName('n');
        const riemann = nSlider ? [] : [`slider ${n} from 1 to 40, starting at 6, in steps of 1`];
        riemann.push(`draw the left Riemann sum of ${f} from ${num(a)} to ${num(b)} with ${n} parts, labelled`);
        q.push({ id: 'riemann', group: areas, label: t('notes6.ask.riemann', { a: num(a), b: num(b) }), answer: { lines: riemann } });
    }

    for (const g of ctx.otherFunctions(f)) {
        const other = ctx.math.functionInfo(g);
        if (!other) continue;
        const with_ = t('notes6.ask.group.with', { g });
        q.push({ id: `cross:${g}`, group: with_, label: t('notes6.ask.cross', { f, g }), answer: { lines: [`mark where ${f} and ${g} cross, with coordinates`] } });
        q.push({ id: `below:${g}`, group: with_, label: t('notes6.ask.below', { f, g }), answer: { lines: [`mark where $${f}(x) \\le ${g}(x)$ on the x-axis, labelled`] } });
        const between = around(x0, zerosOf((x) => fn(x) - other.fn(x), view), view);
        const range = between && between[1] > between[0] ? ` from x = ${num(between[0])} to ${num(between[1])}` : '';
        q.push({ id: `between:${g}`, group: with_, label: t('notes6.ask.between', { f, g }), answer: { lines: [`shade between ${f} and ${g}${range}`] } });
    }
    return q;
}

/** The questions about a region. */
function regionQuestions(ctx: AskContext): Question[] {
    const r = ctx.target.name;
    const group = t('notes6.ask.group.region', { name: r });
    const q: Question[] = [
        { id: 'corners', group, label: t('notes6.ask.corners'), answer: { lines: [`mark the corners of ${r}, with coordinates`] } },
        { id: 'outline', group, label: t('notes6.ask.outline'), answer: { patch: { list: 'tools', name: r, on: { outline: 'solid' }, off: { outline: 'none' } } } },
        { id: 'lines', group, label: t('notes6.ask.conditionLines'), answer: { patch: { list: 'tools', name: r, on: { constraintLines: true }, off: { constraintLines: false } } } },
    ];
    const optima: Array<[string, string, string, 'notes6.ask.highest' | 'notes6.ask.lowest' | 'notes6.ask.rightmost' | 'notes6.ask.leftmost']> = [
        ['max-y', 'maximum', 'y', 'notes6.ask.highest'],
        ['min-y', 'minimum', 'y', 'notes6.ask.lowest'],
        ['max-x', 'maximum', 'x', 'notes6.ask.rightmost'],
        ['min-x', 'minimum', 'x', 'notes6.ask.leftmost'],
    ];
    for (const [id, sense, of, key] of optima) q.push({ id, group, label: t(key), answer: { lines: [`mark the ${sense} of ${of} in ${r}, with coordinates`] } });
    return q;
}

/** The questions about a curve (an equation in x and y). */
function curveQuestions(ctx: AskContext): Question[] {
    const c = ctx.target.name;
    const tool = ctx.tools.find((x) => x.name === c);
    if (!tool || tool.type !== 'curve') return [];
    const group = t('notes6.ask.group.curve', { name: c });
    const q: Question[] = [];
    const eq = tool.equation.trim();
    if (eq && !tool.levels.trim() && eq.includes('=')) {
        const plain = looksLikeLatex(eq) ? `$${eq}$` : `$${eq}$`;
        q.push({ id: 'x-axis', group, label: t('notes6.ask.curveX'), answer: { lines: [`mark where ${plain} on the x-axis, labelled`] } });
        q.push({ id: 'y-axis', group, label: t('notes6.ask.curveY'), answer: { lines: [`mark where ${plain} on the y-axis, labelled`] } });
    }
    for (const g of [...ctx.otherFunctions(), ...ctx.tools.filter((x) => x.type === 'curve' && x.name !== c && !x.hidden).map((x) => x.name)]) {
        q.push({ id: `cross:${g}`, group, label: t('notes6.ask.cross', { f: c, g }), answer: { lines: [`mark where ${c} and ${g} cross, with coordinates`] } });
    }
    return q;
}

/** The questions about a point (of a points tool). */
function pointQuestions(ctx: AskContext): Question[] {
    const p = ctx.target.name;
    const tool = ctx.tools.find((x) => x.name === p);
    if (!tool || tool.type !== 'points') return [];
    const group = t('notes6.ask.group.point', { name: p });
    return [
        { id: 'drop', group, label: t('notes6.ask.dropLines'), answer: { patch: { list: 'tools', name: p, on: { dropLines: true }, off: { dropLines: false } } } },
        { id: 'coordinates', group, label: t('notes6.ask.coordinates'), answer: { patch: { list: 'tools', name: p, on: { label: '({x:2}, {y:2})' }, off: { label: '' } } } },
    ];
}

registerQuestions('function', functionQuestions);
registerQuestions('region', regionQuestions);
registerQuestions('curve', curveQuestions);
registerQuestions('point', pointQuestions);
