/*
 * 6.0 A: values as text, for labels ({v} is (2, 1)) and the editor:
 * complex numbers as a + bi, vectors in round brackets, matrices and lists
 * in the plain syntax. Pure: no DOM, no Obsidian.
 */
import { formatFixed } from '../expr';
import { Value } from './types';

/** Most list items written (a longer list ends with ...). */
const MAX_ITEMS = 12;

function num(n: number, decimals: number): string {
    return Number.isFinite(n) ? formatFixed(n, decimals) : '?';
}

/** A value as text with at most `decimals` decimals: 2, -0.8 + 0.156i, (2, 1), [[1, 2], [3, 4]], [1, 4, 9]. */
export function formatValue(v: Value, decimals = 3): string {
    if (typeof v === 'number') return num(v, decimals);
    switch (v.kind) {
        case 'complex': {
            const re = num(v.re, decimals);
            const im = num(Math.abs(v.im), decimals);
            if (im === '0') return re;
            const imText = im === '1' ? 'i' : `${im}i`;
            if (re === '0') return v.im < 0 ? `-${imText}` : imText;
            return `${re} ${v.im < 0 ? '-' : '+'} ${imText}`;
        }
        case 'vec':
            return `(${v.v.map((x) => num(x, decimals)).join(', ')})`;
        case 'mat': {
            const rows: string[] = [];
            for (let i = 0; i < v.rows; i++) rows.push(`[${v.a.slice(i * v.cols, (i + 1) * v.cols).map((x) => num(x, decimals)).join(', ')}]`);
            return `[${rows.join(', ')}]`;
        }
        case 'list': {
            const items = v.items.slice(0, MAX_ITEMS).map((x) => formatValue(x, decimals));
            if (v.items.length > MAX_ITEMS) items.push('...');
            return `[${items.join(', ')}]`;
        }
    }
}

/** A value in kernel LaTeX (for $...$ labels; the export has no amsmath): a + bi, (2, 1), a matrix as an array in brackets. */
export function valueTex(v: Value, decimals = 3): string {
    if (typeof v === 'number' || v.kind === 'complex' || v.kind === 'vec') return formatValue(v, decimals);
    if (v.kind === 'mat') {
        const rows: string[] = [];
        for (let i = 0; i < v.rows; i++) rows.push(v.a.slice(i * v.cols, (i + 1) * v.cols).map((x) => num(x, decimals)).join(' & '));
        return `\\left(\\begin{array}{${'c'.repeat(v.cols)}} ${rows.join(' \\\\ ')} \\end{array}\\right)`;
    }
    return formatValue(v, decimals);
}
