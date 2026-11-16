/*
 * The numbers behind the pictures beyond functions (5.0): the least-squares
 * line of a data set, the normal and binomial distributions, Riemann sums
 * and the trapezoid rule, a definite integral, and the numerical solution
 * of y' = f(x, y) (RK4). Also how their labels print the numbers. Pure: no
 * DOM, no Obsidian.
 */

// ------------------------------------------------------------- regression

export interface Regression {
    /** y = m x + b. */
    m: number;
    b: number;
    /** Coefficient of determination, 0..1 (1 when every y is the same). */
    r2: number;
    n: number;
}

/** The least-squares line through the points; null with fewer than two points or when every x is the same. */
export function leastSquares(points: readonly number[][]): Regression | null {
    const pts = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const n = pts.length;
    if (n < 2) return null;
    let mx = 0;
    let my = 0;
    for (const [x, y] of pts) {
        mx += x;
        my += y;
    }
    mx /= n;
    my /= n;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const [x, y] of pts) {
        sxx += (x - mx) * (x - mx);
        sxy += (x - mx) * (y - my);
        syy += (y - my) * (y - my);
    }
    if (!(sxx > 0)) return null;
    const m = sxy / sxx;
    const b = my - m * mx;
    const r2 = syy > 0 ? Math.min(1, (sxy * sxy) / (sxx * syy)) : 1;
    return { m, b, r2, n };
}

// ----------------------------------------------------------- distributions

const SQRT2 = Math.SQRT2;
const SQRT2PI = Math.sqrt(2 * Math.PI);

/** Complementary error function, relative error below 1.2e-7 everywhere (Numerical Recipes, erfcc). */
export function erfc(x: number): number {
    const z = Math.abs(x);
    const t = 1 / (1 + 0.5 * z);
    const r =
        t *
        Math.exp(
            -z * z -
                1.26551223 +
                t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
        );
    return x >= 0 ? r : 2 - r;
}

export function normalPdf(x: number, mean: number, sd: number): number {
    const z = (x - mean) / sd;
    return Math.exp(-0.5 * z * z) / (sd * SQRT2PI);
}

/** P(X <= x) for X ~ N(mean, sd^2). */
export function normalCdf(x: number, mean: number, sd: number): number {
    if (x === Infinity) return 1;
    if (x === -Infinity) return 0;
    return 0.5 * erfc(-(x - mean) / (sd * SQRT2));
}

/** P(a <= X <= b) for X ~ N(mean, sd^2), precise in both tails (a or b may be infinite). */
export function normalProbability(a: number, b: number, mean: number, sd: number): number {
    if (!(b > a)) return 0;
    // Upper tail: subtract the small tail areas instead of two numbers near 1.
    if (a > mean) {
        const upper = (x: number) => (x === Infinity ? 0 : 0.5 * erfc((x - mean) / (sd * SQRT2)));
        return Math.max(0, upper(a) - upper(b));
    }
    return Math.max(0, normalCdf(b, mean, sd) - normalCdf(a, mean, sd));
}

/** ln(k!) for k = 0..n. */
function logFactorials(n: number): number[] {
    const out = [0];
    for (let k = 1; k <= n; k++) out.push(out[k - 1] + Math.log(k));
    return out;
}

/** P(X = k) for k = 0..n, X ~ B(n, p). n is a whole number >= 0, p in [0, 1]. */
export function binomialPmf(n: number, p: number): number[] {
    if (p <= 0) return Array.from({ length: n + 1 }, (_, k) => (k === 0 ? 1 : 0));
    if (p >= 1) return Array.from({ length: n + 1 }, (_, k) => (k === n ? 1 : 0));
    const lf = logFactorials(n);
    const lp = Math.log(p);
    const lq = Math.log1p(-p);
    const out: number[] = [];
    for (let k = 0; k <= n; k++) out.push(Math.exp(lf[n] - lf[k] - lf[n - k] + k * lp + (n - k) * lq));
    return out;
}

// --------------------------------------------------------------- calculus

export type RiemannMethod = 'left' | 'right' | 'middle' | 'trapezoid';

export interface RiemannPart {
    x0: number;
    x1: number;
    /** Height at the left and the right side (the same for a rectangle). */
    y0: number;
    y1: number;
}

/**
 * The parts of a Riemann sum (left, right or middle rectangles) or of the
 * trapezoid rule of f over [a, b] with n equal parts, and their signed
 * area. A part where f has no value is left out, and the sum is then NaN.
 */
export function riemannSum(f: (x: number) => number, a: number, b: number, n: number, method: RiemannMethod): { parts: RiemannPart[]; sum: number } {
    const parts: RiemannPart[] = [];
    let sum = 0;
    const h = (b - a) / n;
    for (let i = 0; i < n; i++) {
        const x0 = a + i * h;
        const x1 = i === n - 1 ? b : a + (i + 1) * h;
        let y0: number;
        let y1: number;
        if (method === 'trapezoid') {
            y0 = f(x0);
            y1 = f(x1);
        } else {
            const at = method === 'left' ? x0 : method === 'right' ? x1 : (x0 + x1) / 2;
            y0 = y1 = f(at);
        }
        if (!Number.isFinite(y0) || !Number.isFinite(y1)) {
            sum = NaN;
            continue;
        }
        parts.push({ x0, x1, y0, y1 });
        sum += ((y0 + y1) / 2) * (x1 - x0);
    }
    return { parts, sum };
}

/**
 * Whether f has a pole in [a, b] or no value somewhere: where it changes sign
 * between two of 400 samples, closing in on the change (bisection) makes the
 * values shrink at a zero and grow at a pole.
 */
function hasPole(f: (x: number) => number, a: number, b: number): boolean {
    const N = 400;
    let x0 = a;
    let y0 = f(a);
    for (let i = 1; i <= N; i++) {
        const x1 = i === N ? b : a + ((b - a) * i) / N;
        const y1 = f(x1);
        if (!Number.isFinite(y0) || !Number.isFinite(y1)) return true;
        if (y0 * y1 < 0) {
            let lo = x0;
            let hi = x1;
            let ylo = y0;
            let yhi = y1;
            for (let k = 0; k < 60 && hi - lo > 0; k++) {
                const m = (lo + hi) / 2;
                const ym = f(m);
                if (!Number.isFinite(ym)) return true;
                if (ym === 0) break;
                if (ym * ylo < 0) {
                    hi = m;
                    yhi = ym;
                } else {
                    lo = m;
                    ylo = ym;
                }
            }
            if (Math.min(Math.abs(ylo), Math.abs(yhi)) > 10 * Math.max(Math.abs(y0), Math.abs(y1))) return true;
        }
        x0 = x1;
        y0 = y1;
    }
    return false;
}

/** The definite integral of f over [a, b] (adaptive Simpson); NaN where f has a pole or no value in between, or grows without bound where the estimate does not settle. */
export function integral(f: (x: number) => number, a: number, b: number): number {
    if (a === b) return 0;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    if (hasPole(f, Math.min(a, b), Math.max(a, b))) return NaN;
    const fa = f(a);
    const fb = f(b);
    const m = (a + b) / 2;
    const fm = f(m);
    if (![fa, fb, fm].every(Number.isFinite)) return NaN;
    const whole = ((b - a) / 6) * (fa + 4 * fm + fb);
    let budget = 20000;
    let settled = true;
    // The largest |f| seen: a piece that does not settle where f grows without bound is a pole.
    let peak = Math.max(Math.abs(fa), Math.abs(fb), Math.abs(fm));
    const start = Math.max(Math.abs(fa), Math.abs(fb), Math.abs(fm), 1e-300);
    const step = (lo: number, hi: number, flo: number, fmid: number, fhi: number, s: number, tol: number, depth: number): number => {
        const mid = (lo + hi) / 2;
        const l = (lo + mid) / 2;
        const r = (mid + hi) / 2;
        const fl = f(l);
        const fr = f(r);
        budget -= 2;
        peak = Math.max(peak, Math.abs(fl), Math.abs(fr));
        if (!Number.isFinite(fl) || !Number.isFinite(fr)) return NaN;
        const left = ((mid - lo) / 6) * (flo + 4 * fl + fmid);
        const right = ((hi - mid) / 6) * (fmid + 4 * fr + fhi);
        const diff = left + right - s;
        if (Math.abs(diff) <= 15 * tol) return left + right + diff / 15;
        if (depth <= 0 || budget <= 0) {
            settled = false;
            return left + right + diff / 15;
        }
        return step(lo, mid, flo, fl, fmid, left, tol / 2, depth - 1) + step(mid, hi, fmid, fr, fhi, right, tol / 2, depth - 1);
    };
    const scale = Math.max(1e-12, Math.abs(whole), Math.abs(b - a) * Math.max(Math.abs(fa), Math.abs(fb), Math.abs(fm)));
    const value = step(a, b, fa, fm, fb, whole, 1e-10 * scale, 40);
    // Slow to settle where f stays bounded (sqrt(x) at 0) is fine; where it blows up, there is no value.
    return settled || peak <= 1e6 * start ? value : NaN;
}

/**
 * The solution of y' = f(x, y) through (x0, y0), forwards and backwards with
 * the classical Runge-Kutta method, until it leaves [xmin, xmax] or the band
 * [ylo, yhi], has no value, or turns steeper than `maxSlope` (a vertical
 * tangent, where y(x) ends: y' = -x/y at the x-axis). Steps get shorter
 * where the slope is steep, so each moves at most about `xStep` across and
 * `yStep` up or down.
 */
export function solveOde(
    f: (x: number, y: number) => number,
    x0: number,
    y0: number,
    box: { xmin: number; xmax: number; ylo: number; yhi: number; maxSlope?: number },
    xStep: number,
    yStep: number
): Array<{ x: number; y: number }> {
    const maxSlope = box.maxSlope ?? Infinity;
    const run = (dir: 1 | -1): Array<{ x: number; y: number }> => {
        const out: Array<{ x: number; y: number }> = [];
        let x = x0;
        let y = y0;
        for (let k = 0; k < 20000; k++) {
            if (dir > 0 ? x >= box.xmax : x <= box.xmin) break;
            const s = f(x, y);
            if (!Number.isFinite(s) || Math.abs(s) > maxSlope) break;
            // Shorter steps where the curve is steep: about yStep up or down per step.
            let h = Math.min(xStep, yStep / Math.max(1e-12, Math.abs(s)));
            h = Math.max(h, xStep * 1e-4);
            const left = dir > 0 ? box.xmax - x : x - box.xmin;
            if (h > left) h = left;
            const hs = dir * h;
            const k1 = s;
            const k2 = f(x + hs / 2, y + (hs / 2) * k1);
            const k3 = f(x + hs / 2, y + (hs / 2) * k2);
            const k4 = f(x + hs, y + hs * k3);
            const ny = y + (hs / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
            if (!Number.isFinite(ny) || ![k2, k3, k4].every((k) => Math.abs(k) <= maxSlope)) break;
            x += hs;
            y = ny;
            out.push({ x, y });
            if (y < box.ylo || y > box.yhi) break;
        }
        return out;
    };
    const back = run(-1).reverse();
    return [...back, { x: x0, y: y0 }, ...run(1)];
}

// ------------------------------------------------------------------ labels

/** `v` with `digits` significant digits, no exponent, trailing zeros dropped: 4.2133 -> 4.21, 47.62 -> 47.6, 1234.5 -> 1235. */
export function significant(v: number, digits = 3): string {
    if (!Number.isFinite(v)) return '?';
    if (v === 0) return '0';
    const abs = Math.abs(v);
    let s: string;
    if (abs >= Math.pow(10, digits)) s = String(Math.round(v));
    else {
        const decimals = Math.max(0, Math.min(12, digits - 1 - Math.floor(Math.log10(abs))));
        s = v.toFixed(decimals);
        if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    return s === '-0' ? '0' : s;
}

/** `v` with at most `decimals` decimals, trailing zeros dropped (2.50 -> 2.5, -0 -> 0). */
export function decimal(v: number, decimals = 3): string {
    if (!Number.isFinite(v)) return '?';
    let s = v.toFixed(decimals);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
}

/** The regression label: `$y = 4.21x + 47.6$, $R^2 = 0.98$`. */
export function regressionLabel(r: Regression): string {
    const m = significant(r.m);
    const b = significant(Math.abs(r.b));
    let eq: string;
    if (m === '0') eq = `y = ${significant(r.b)}`;
    else {
        const slope = m === '1' ? 'x' : m === '-1' ? '-x' : `${m}x`;
        eq = b === '0' ? `y = ${slope}` : `y = ${slope} ${r.b < 0 ? '-' : '+'} ${b}`;
    }
    // Two decimals, three when that is the only way to tell it from 1.
    const r2 = r.r2 >= 0.995 && r.r2 < 1 ? decimal(r.r2, 3) : decimal(r.r2, 2);
    return `$${eq}$, $R^2 = ${r2}$`;
}

/**
 * A probability as a label prints it: three decimals (0.683); near 1 as many
 * as it takes not to read as 1 (0.99977); below 0.0005 two significant
 * digits times a power of ten.
 */
export function probabilityText(p: number): string {
    if (!Number.isFinite(p)) return '?';
    if (p <= 0) return '0';
    if (p >= 1) return '1';
    if (p < 0.0005) {
        const e = Math.floor(Math.log10(p));
        const mant = significant(p / Math.pow(10, e), 2);
        return `${mant} \\cdot 10^{${e}}`;
    }
    if (p > 0.9995) return decimal(p, Math.min(12, Math.ceil(-Math.log10(1 - p)) + 1));
    return decimal(p, 3);
}
