/*
 * The generic network of formula recognition: dense layers with skip connections.
 *
 *   h_0 = x (the features of one part of a formula)
 *   h_l = clip01( W_l · [h_0; h_1; ...; h_{l-1}] + b_l )      l = 1..L   (clip01(v) = min(1, max(0, v)))
 *   out = W_out · [h_0; ...; h_L] + b_out                      one score per label, argmax
 *
 * Nothing in here knows a feature or a label: all of that is in the matrices,
 * which compile() builds from the named units of weights.ts. A port of the
 * frozen net.mjs (hover-ml, designed3: round 3, with the label vector): the
 * same Float32 arithmetic, so it gives the same labels. Pure: no DOM, no Obsidian.
 */

export const LABELS = ['none', 'function', 'surface', 'polar', 'implicit', 'region', 'set', 'map', 'condition', 'interval', 'jensen', 'epigraph', 'matrix', 'product', 'det', 'eigen', 'recurrence', 'sum', 'domain', 'vector'] as const;

/** What a formula's hover shows: no card, or the card of this kind. */
export type Label = (typeof LABELS)[number];

/** One unit: its name, its bias, and its inputs with their weights ('input weight input weight ...'). */
export type UnitSpec = [string, number, string];

/** The network as hand-written data: hidden units in order, and the output layer (one row per label). */
export interface NetSpec {
    units: UnitSpec[];
    out: UnitSpec[];
}

interface Dense {
    rows: number;
    cols: number;
    W: Float32Array;
    b: Float32Array;
}

export interface Net {
    /** The names of each layer: the inputs first, then the hidden layers. */
    layers: string[][];
    hidden: Dense[];
    out: Dense;
    /** Inputs and hidden units together: the length of the activations. */
    size: number;
}

/** Named units to dense matrices. A unit's layer is one more than the deepest of its inputs. */
export function compile(spec: NetSpec, inputNames: string[]): Net {
    const where = new Map<string, { layer: number; index: number }>();
    inputNames.forEach((n, i) => where.set(n, { layer: 0, index: i }));
    const layers: string[][] = [inputNames.slice()];
    const parsed: Array<{ name: string; bias: number; w: Array<[string, number]>; layer: number }> = [];
    for (const [name, bias, ins] of spec.units) {
        const w: Array<[string, number]> = [];
        const toks = ins.trim().split(/\s+/).filter(Boolean);
        if (toks.length % 2) throw new Error(`unit ${name}: odd weight list`);
        let layer = 1;
        for (let i = 0; i < toks.length; i += 2) {
            const src = where.get(toks[i]);
            if (!src) throw new Error(`unit ${name}: unknown input ${toks[i]}`);
            const val = Number(toks[i + 1]);
            if (!Number.isFinite(val)) throw new Error(`unit ${name}: bad weight for ${toks[i]}`);
            w.push([toks[i], val]);
            layer = Math.max(layer, src.layer + 1);
        }
        if (where.has(name)) throw new Error(`duplicate unit ${name}`);
        (layers[layer] ??= []).push(name);
        where.set(name, { layer, index: layers[layer].length - 1 });
        parsed.push({ name, bias, w, layer });
    }
    const offset = [0];
    for (let l = 0; l < layers.length; l++) offset.push(offset[l] + layers[l].length);
    const col = (n: string) => {
        const s = where.get(n);
        if (!s) throw new Error(`unknown unit ${n}`);
        return offset[s.layer] + s.index;
    };
    const hidden: Dense[] = [];
    for (let l = 1; l < layers.length; l++) {
        const rows = layers[l].length;
        const cols = offset[l];
        const W = new Float32Array(rows * cols);
        const b = new Float32Array(rows);
        for (const u of parsed.filter((p) => p.layer === l)) {
            const r = where.get(u.name)?.index ?? 0;
            b[r] = u.bias;
            for (const [n, v] of u.w) W[r * cols + col(n)] += v;
        }
        hidden.push({ rows, cols, W, b });
    }
    const cols = offset[layers.length];
    const W = new Float32Array(LABELS.length * cols);
    const b = new Float32Array(LABELS.length);
    const labels: readonly string[] = LABELS;
    for (const [label, bias, ins] of spec.out) {
        const r = labels.indexOf(label);
        if (r < 0) throw new Error(`unknown label ${label}`);
        b[r] += bias;
        const toks = ins.trim().split(/\s+/).filter(Boolean);
        for (let i = 0; i < toks.length; i += 2) {
            if (!where.has(toks[i])) throw new Error(`out ${label}: unknown input ${toks[i]}`);
            W[r * cols + col(toks[i])] += Number(toks[i + 1]);
        }
    }
    return { layers, hidden, out: { rows: LABELS.length, cols, W, b }, size: cols };
}

/**
 * Forward pass: the scores of the labels (and the activations of all units
 * in `act`, when given). Inputs and activations are mostly 0, so each layer
 * sums over the active columns only (the same product W·a).
 */
const active = new Int32Array(4096);
export function forward(net: Net, x: Float32Array, act?: Float32Array): Float32Array {
    const a = act ?? new Float32Array(net.size);
    a.set(x, 0);
    let n = 0;
    for (let c = 0; c < x.length; c++) if (x[c] !== 0) active[n++] = c;
    let filled = x.length;
    for (const { rows, cols, W, b } of net.hidden) {
        for (let r = 0; r < rows; r++) {
            let s = b[r];
            const o = r * cols;
            for (let k = 0; k < n; k++) s += W[o + active[k]] * a[active[k]];
            a[filled + r] = s <= 0 ? 0 : s >= 1 ? 1 : s;
        }
        for (let r = 0; r < rows; r++) if (a[filled + r] !== 0) active[n++] = filled + r;
        filled += rows;
    }
    const { rows, cols, W, b } = net.out;
    const scores = new Float32Array(rows);
    for (let r = 0; r < rows; r++) {
        let s = b[r];
        const o = r * cols;
        for (let k = 0; k < n; k++) s += W[o + active[k]] * a[active[k]];
        scores[r] = s;
    }
    return scores;
}

/** The index of the largest score (the first one on a tie). */
export function argmax(scores: Float32Array): number {
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    return best;
}
