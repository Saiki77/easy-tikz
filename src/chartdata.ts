/*
 * Chart data as the editor stores it: a deep copy, the canonical form two
 * charts are compared by, and the shortest block that draws the same chart
 * (every field that equals what the plugin fills in left out). Shared by the
 * text syntax (src/text), notes and the AI tools (src/ai/charttool.ts).
 */
import { SettingsManager } from './settings';

export type Data = Record<string, unknown>;

/** Chart keys that hold lists. */
export const LIST_KEYS = ['functions', 'tools', 'parameters', 'annotations', 'functions3D'] as const;

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

/** The chart as the editor would store it, as an object (ids left out). */
export function canonicalData(data: Data): Data {
    return JSON.parse(canonical(data)) as Data;
}

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

/** JSON with the keys of every object sorted: equal for equal values, whatever order the keys came in. */
export function stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    const obj = value as Data;
    return `{${Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
        .join(',')}}`;
}
