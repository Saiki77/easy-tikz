/*
 * Charts that move when they change. Numbers glide to their new values
 * (a curve bends over, the view zooms, a point slides, computed labels
 * count along), and objects that were not in the picture before pop in:
 * curves draw themselves, points pop, regions, guides and labels fade up.
 * The renderers tag every element they draw with its object's name
 * (data-etz-item), which is all the pop-in needs. Styles: src/ui/motion.css.
 */
type Data = Record<string, unknown>;

/** One change of values. */
export const GLIDE_MS = 320;
/** The longest pop-in (a curve drawing itself). */
const POP_MS = 650;
/** Between objects that arrive together. */
const STAGGER_MS = 70;

/** The system asks for less motion. */
export function reducedMotion(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Ease out: fast start, gentle landing. */
export function ease(k: number): number {
    const t = Math.max(0, Math.min(1, k));
    return 1 - Math.pow(1 - t, 3);
}

// ------------------------------------------------------------------ glide

/**
 * Which values glide: plain numbers, and numbers standing alone in math
 * text (0.5x^2, 2x + 3y <= 12). Names (f1, P1_x), labels, colours, counts
 * and powers change at once.
 */
const SNAP_KEY = /label|title|text|legend|name|color|pattern|anchor|type|source|style|axis|outline|thickness|size$/i;
const WHOLE_KEY = /^(v|step|samples\w*|minorTickNum|majorTickNum|gridSize|dim)$/;
const MATHY = /^[^{}"$\\:;#]*$/;

function isDigit(c: string | undefined): boolean {
    return c !== undefined && c >= '0' && c <= '9';
}

function isNameChar(c: string | undefined): boolean {
    return c !== undefined && /[A-Za-z0-9_.]/.test(c);
}

/** The text around the numbers of `s`, and the numbers. */
function numbersIn(s: string): { parts: string[]; nums: number[] } {
    const parts: string[] = [];
    const nums: number[] = [];
    let last = 0;
    let i = 0;
    while (i < s.length) {
        const starts = isDigit(s[i]) || (s[i] === '.' && isDigit(s[i + 1]));
        if (starts && !isNameChar(s[i - 1])) {
            let j = i;
            while (isDigit(s[j])) j++;
            if (s[j] === '.') {
                j++;
                while (isDigit(s[j])) j++;
            }
            parts.push(s.slice(last, i));
            nums.push(Number(s.slice(i, j)));
            last = i = j;
        } else i++;
    }
    parts.push(s.slice(last));
    return { parts, nums };
}

function mixText(a: string, b: string, k: number): string {
    const A = numbersIn(a);
    const B = numbersIn(b);
    if (A.nums.length !== B.nums.length || A.parts.join('\u0001') !== B.parts.join('\u0001')) return b;
    let out = B.parts[0];
    for (let i = 0; i < B.nums.length; i++) {
        // x^2.5 has no value left of 0, so powers jump.
        const n = /\^\s*\(?\s*$/.test(B.parts[i]) ? B.nums[i] : A.nums[i] + (B.nums[i] - A.nums[i]) * k;
        out += String(Math.round(n * 1e6) / 1e6) + B.parts[i + 1];
    }
    return out;
}

function mixValue(a: unknown, b: unknown, k: number, key: string): unknown {
    if (a === b) return b;
    if (typeof a === 'number' && typeof b === 'number') {
        return WHOLE_KEY.test(key) || !Number.isFinite(a) || !Number.isFinite(b) ? b : a + (b - a) * k;
    }
    if (typeof a === 'string' && typeof b === 'string') {
        return SNAP_KEY.test(key) || !MATHY.test(a) || !MATHY.test(b) ? b : mixText(a, b, k);
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        const from: unknown[] = a;
        const to: unknown[] = b;
        return to.map((v, i) => (i < from.length ? mixValue(from[i], v, k, key) : v));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const out: Data = {};
        for (const [p, v] of Object.entries(b as Data)) out[p] = p in (a as Data) ? mixValue((a as Data)[p], v, k, p) : v;
        return out;
    }
    return b;
}

/** The chart `k` of the way from `a` to `b` (0: a's numbers, 1: b). */
export function mixCharts(a: Data, b: Data, k: number): Data {
    return mixValue(a, b, k, '') as Data;
}

/** Whether going from `a` to `b` has anything to glide. */
export function glides(a: Data, b: Data): boolean {
    return JSON.stringify(mixCharts(a, b, 0)) !== JSON.stringify(b);
}

// ----------------------------------------------------------------- pop-in

/** The names drawn in `root` (the data-etz-item of every element). */
export function drawnNames(root: Element | null): Set<string> {
    const names = new Set<string>();
    if (root) root.querySelectorAll('[data-etz-item]').forEach((el) => names.add(el.getAttribute('data-etz-item') ?? ''));
    return names;
}

/** How an element pops in, by the layer it is drawn in. */
function motionOf(el: Element): string {
    const layer = el.parentElement?.getAttribute('class') ?? '';
    if (/etz-curves|etz-strokes/.test(layer) && el.tagName.toLowerCase() === 'path' && !el.getAttribute('stroke-dasharray')) {
        el.setAttribute('pathLength', '1');
        return 'etz-pop-draw';
    }
    if (/etz-markers/.test(layer)) return 'etz-pop-dot';
    if (/etz-texts|etz-labels/.test(layer)) return 'etz-pop-rise';
    return 'etz-pop-fade';
}

/**
 * Pop-in across redraws: a chart is drawn anew for every frame, so each
 * object remembers when its pop-in started, and later frames continue it
 * where it is (a negative animation delay).
 */
export class PopIn {
    private readonly born = new Map<string, number>();
    private onScreen: Set<string>;

    /** `present`: what is already in the picture (it never pops in). */
    constructor(present: Iterable<string> = []) {
        this.onScreen = new Set(present);
    }

    /** Call after every drawing of the chart into `root`. */
    apply(root: Element | null, enabled = true) {
        if (!root) return;
        const now = performance.now();
        const names = new Set<string>();
        let fresh = 0;
        root.querySelectorAll('[data-etz-item]').forEach((el) => {
            const name = el.getAttribute('data-etz-item') ?? '';
            if (!names.has(name)) {
                names.add(name);
                if (!this.onScreen.has(name)) this.born.set(name, now + STAGGER_MS * fresh++);
            }
            const start = this.born.get(name);
            if (!enabled || start === undefined || now - start >= POP_MS) return;
            if (!el.instanceOf(SVGElement)) return;
            el.addClass('etz-pop');
            el.addClass(motionOf(el));
            el.setCssProps({ '--etz-pop-delay': `${Math.round(start - now)}ms` });
        });
        this.onScreen = names;
    }
}
