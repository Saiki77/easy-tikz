/*
 * 6.0 A: a value formula as LaTeX, for the labels of vector arrows: the
 * names of vectors get an arrow (\vec{v} + \vec{w}, A\vec{v}, 2\vec{v}),
 * numbers and other names stay as they are. Pure: no DOM, no Obsidian.
 */
import { formatNumber, texName } from '../expr';
import type { VNode } from './parse';
import { parseValue } from './parse';

const P_ADD = 1;
const P_MUL = 2;
const P_UNARY = 3;
const P_ATOM = 4;

interface Tex {
    s: string;
    p: number;
}

function paren(t: Tex, min: number): string {
    return t.p >= min ? t.s : `\\left(${t.s}\\right)`;
}

function tex(n: VNode, isVector: (name: string) => boolean): Tex {
    switch (n.t) {
        case 'num':
            return { s: formatNumber(n.value), p: P_ATOM };
        case 'name':
            return { s: isVector(n.name) ? `\\vec{${texName(n.name)}}` : texName(n.name), p: P_ATOM };
        case 'unary': {
            const a = tex(n.arg, isVector);
            return n.op === '-' ? { s: `-${paren(a, P_UNARY)}`, p: P_UNARY } : a;
        }
        case 'binary': {
            const l = tex(n.left, isVector);
            const r = tex(n.right, isVector);
            if (n.op === '+' || n.op === '-') return { s: `${l.s} ${n.op} ${r.p <= P_ADD && n.op === '-' ? `\\left(${r.s}\\right)` : r.s}`, p: P_ADD };
            if (n.op === '*') {
                const op = n.cross ? ' \\times ' : n.implicit ? ' ' : ' \\cdot ';
                return { s: `${paren(l, P_MUL)}${op}${paren(r, P_UNARY)}`, p: P_MUL };
            }
            if (n.op === '/') return { s: `\\frac{${l.s}}{${r.s}}`, p: P_ATOM };
            return { s: `${paren(l, P_ATOM)}^{${r.s}}`, p: P_ATOM };
        }
        // Kernel LaTeX (the export has no amsmath): (2, 1) and an array in brackets.
        case 'vec':
            return { s: `\\left(${n.items.map((it) => tex(it, isVector).s).join(', ')}\\right)`, p: P_ATOM };
        case 'mat':
            return { s: `\\left(\\begin{array}{${'c'.repeat(n.rows[0].length)}} ${n.rows.map((row) => row.map((it) => tex(it, isVector).s).join(' & ')).join(' \\\\ ')} \\end{array}\\right)`, p: P_ATOM };
        case 'call':
            return { s: `${texName(n.name)}\\left(${n.args.map((a) => tex(a, isVector).s).join(', ')}\\right)`, p: P_ATOM };
        default:
            return { s: '?', p: P_ATOM };
    }
}

/** The formula as LaTeX with arrows on the vector names (`isVector`), or null when it does not read. */
export function vectorTex(src: string, isVector: (name: string) => boolean): string | null {
    try {
        const out = tex(parseValue(src), isVector).s;
        return out.includes('?') ? null : out;
    } catch {
        return null;
    }
}

/** A node as LaTeX with arrows on the vector names, or null when part of it has no LaTeX here. */
export function nodeTex(n: VNode, isVector: (name: string) => boolean): string | null {
    const out = tex(n, isVector).s;
    return out.includes('?') ? null : out;
}

/** The terms of a sum with their signs: `v + w - u` is v, w and u with -1; a formula that is no sum is one term. Null when it does not read. */
export function sumTerms(src: string): Array<{ sign: 1 | -1; node: VNode }> | null {
    let root: VNode;
    try {
        root = parseValue(src);
    } catch {
        return null;
    }
    const out: Array<{ sign: 1 | -1; node: VNode }> = [];
    const walk = (n: VNode, sign: 1 | -1) => {
        if (n.t === 'binary' && (n.op === '+' || n.op === '-') && !n.equation) {
            walk(n.left, sign);
            walk(n.right, n.op === '-' ? (sign === 1 ? -1 : 1) : sign);
            return;
        }
        out.push({ sign, node: n });
    };
    walk(root, 1);
    return out;
}
