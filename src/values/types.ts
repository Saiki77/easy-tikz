/*
 * 6.0 A: the values a formula can have besides a number: complex numbers,
 * vectors (2D, 3D or any length), matrices and lists, and their static
 * shapes (what the compiler knows before it runs). Values are never
 * changed after they are made. Pure: no DOM, no Obsidian.
 */

/** A complex number re + im i. */
export interface Complex {
    readonly kind: 'complex';
    readonly re: number;
    readonly im: number;
}

/** A vector of real numbers: (2, 1), (1, 0, 2). */
export interface Vec {
    readonly kind: 'vec';
    readonly v: readonly number[];
}

/** A matrix of real numbers, row by row: rows x cols entries in `a`. */
export interface Mat {
    readonly kind: 'mat';
    readonly rows: number;
    readonly cols: number;
    readonly a: readonly number[];
}

/** A list of values: {(k, k^2) : k = 1, ..., 10}, the n-th roots of unity. */
export interface List {
    readonly kind: 'list';
    readonly items: readonly Value[];
}

export type Value = number | Complex | Vec | Mat | List;

export function complex(re: number, im: number): Complex {
    return { kind: 'complex', re, im };
}

export function vec(v: readonly number[]): Vec {
    return { kind: 'vec', v };
}

export function mat(rows: number, cols: number, a: readonly number[]): Mat {
    return { kind: 'mat', rows, cols, a };
}

export function list(items: readonly Value[]): List {
    return { kind: 'list', items };
}

export const isComplex = (v: Value): v is Complex => typeof v !== 'number' && v.kind === 'complex';
export const isVec = (v: Value): v is Vec => typeof v !== 'number' && v.kind === 'vec';
export const isMat = (v: Value): v is Mat => typeof v !== 'number' && v.kind === 'mat';
export const isList = (v: Value): v is List => typeof v !== 'number' && v.kind === 'list';

/** The imaginary unit. */
export const I: Complex = complex(0, 1);

/**
 * What the compiler knows of a value before it runs. A length of 0 is not
 * known (a list's length follows a slider). 'any' is any value.
 */
export type Shape =
    | { readonly k: 'num' }
    | { readonly k: 'complex' }
    | { readonly k: 'vec'; readonly n: number }
    | { readonly k: 'mat'; readonly r: number; readonly c: number }
    | { readonly k: 'list'; readonly of: Shape }
    | { readonly k: 'any' };

export const NUM: Shape = { k: 'num' };
export const COMPLEX: Shape = { k: 'complex' };
export const ANY: Shape = { k: 'any' };

export function vecShape(n: number): Shape {
    return { k: 'vec', n };
}

export function matShape(r: number, c: number): Shape {
    return { k: 'mat', r, c };
}

export function listShape(of: Shape): Shape {
    return { k: 'list', of };
}

/** The shape of a value (lists by their first item). */
export function shapeOf(v: Value): Shape {
    if (typeof v === 'number') return NUM;
    switch (v.kind) {
        case 'complex':
            return COMPLEX;
        case 'vec':
            return vecShape(v.v.length);
        case 'mat':
            return matShape(v.rows, v.cols);
        case 'list':
            return listShape(v.items.length ? shapeOf(v.items[0]) : ANY);
    }
}

/** Two shapes that may hold the same values (unknown lengths and 'any' match everything). */
export function sameShape(a: Shape, b: Shape): boolean {
    if (a.k === 'any' || b.k === 'any') return true;
    if (a.k !== b.k) return false;
    if (a.k === 'vec' && b.k === 'vec') return !a.n || !b.n || a.n === b.n;
    if (a.k === 'mat' && b.k === 'mat') return (!a.r || !b.r || a.r === b.r) && (!a.c || !b.c || a.c === b.c);
    if (a.k === 'list' && b.k === 'list') return sameShape(a.of, b.of);
    return true;
}

/** A number or a complex number: what the complex functions take. */
export const scalarLike = (s: Shape) => s.k === 'num' || s.k === 'complex' || s.k === 'any';

/** The real number a value is (a complex number with no imaginary part counts), else NaN. */
export function realOf(v: Value): number {
    if (typeof v === 'number') return v;
    if (v.kind === 'complex') return v.im === 0 ? v.re : NaN;
    return NaN;
}

/** A point of the plane or of space from a value: a complex number (re, im), a vector (its first 2 or 3 numbers); null otherwise. */
export function pointOf(v: Value, dim: 2 | 3): number[] | null {
    if (typeof v === 'number') return null;
    if (v.kind === 'complex') return dim === 2 ? [v.re, v.im] : [v.re, v.im, 0];
    if (v.kind === 'vec') {
        if (v.v.length === dim) return v.v.slice();
        if (dim === 3 && v.v.length === 2) return [v.v[0], v.v[1], 0];
        return null;
    }
    return null;
}
