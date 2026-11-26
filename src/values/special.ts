/*
 * 6.0 A: factorials, binomials and the gamma function for every formula
 * field (n!, \binom{n}{k}). Plain numbers in, plain numbers out; no imports,
 * so src/expr.ts can use them without a cycle. Pure: no DOM, no Obsidian.
 */

/** Lanczos coefficients (g = 7, n = 9): about 15 correct digits for gamma. */
const LANCZOS = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** n! for n = 0..170 (171! is more than a double holds). */
const FACTORIALS: number[] = (() => {
    const out = [1];
    for (let n = 1; n <= 170; n++) out.push(out[n - 1] * n);
    return out;
})();

/** The gamma function: Γ(n + 1) = n!; NaN at 0, -1, -2, ... */
export function gamma(x: number): number {
    if (Number.isNaN(x)) return NaN;
    if (Number.isInteger(x)) {
        if (x <= 0) return NaN;
        return x <= 171 ? FACTORIALS[x - 1] : Infinity;
    }
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
    if (x > 171.7) return Infinity;
    const z = x - 1;
    let a = LANCZOS[0];
    const t = z + 7.5;
    for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
}

/**
 * 6.2.1: ln Γ(x) for x > 0 (NaN otherwise), about 15 correct digits, also
 * where Γ(x) itself is more than a double holds (the densities of the t,
 * chi-square, gamma and beta distributions with large parameters).
 */
export function lnGamma(x: number): number {
    if (!(x > 0)) return NaN;
    if (x === Infinity) return Infinity;
    // Below 0.5 by the reflection formula, as gamma does.
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
    const z = x - 1;
    let a = LANCZOS[0];
    const t = z + 7.5;
    for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** n!: exact for whole n up to 170, Γ(n + 1) between them, NaN for negative whole n. */
export function factorial(n: number): number {
    if (Number.isInteger(n)) {
        if (n < 0) return NaN;
        return n <= 170 ? FACTORIALS[n] : Infinity;
    }
    return gamma(n + 1);
}

/**
 * The binomial coefficient n over k: for whole k, the product
 * n (n - 1) ... (n - k + 1) / k! (any real n, 0 for k < 0); otherwise
 * Γ(n + 1) / (Γ(k + 1) Γ(n - k + 1)).
 */
export function binom(n: number, k: number): number {
    if (Number.isNaN(n) || Number.isNaN(k)) return NaN;
    if (Number.isInteger(k)) {
        if (k < 0) return 0;
        if (Number.isInteger(n) && n >= 0) {
            if (k > n) return 0;
            k = Math.min(k, n - k);
        }
        let out = 1;
        for (let i = 1; i <= k; i++) out = (out * (n - k + i)) / i;
        return Number.isInteger(n) ? Math.round(out) : out;
    }
    return gamma(n + 1) / (gamma(k + 1) * gamma(n - k + 1));
}

/** Most terms a sum, a product or a list takes; more give NaN (or an empty list), so a slider cannot freeze the chart. */
export const MAX_TERMS = 100000;

/** The whole numbers a sum runs over, lo to hi (bounds rounded); null when there are too many or a bound is not a number. */
export function termRange(lo: number, hi: number): [number, number] | null {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    const a = Math.round(lo);
    const b = Math.round(hi);
    if (b - a + 1 > MAX_TERMS) return null;
    return [a, b];
}
