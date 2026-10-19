/*
 * Charts that move when they change. Numbers glide to their new values
 * (a curve bends over, the view zooms, a point slides, computed labels
 * count along), and objects that were not in the picture before pop in:
 * curves draw themselves, points pop, regions, guides and labels fade up.
 * The renderers tag every element they draw with its object's name
 * (data-etz-item), which is all the pop-in needs. Styles: src/ui/motion.css.
 * Both follow the time of the animation frames.
 */
type Data = Record<string, unknown>;

/** One change of values. */
export const GLIDE_MS = 320;
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

type PopKind = 'etz-pop-draw' | 'etz-pop-dot' | 'etz-pop-rise' | 'etz-pop-fade';

/** How long each kind takes. */
const POP_MS: Record<PopKind, number> = { 'etz-pop-draw': 650, 'etz-pop-dot': 420, 'etz-pop-rise': 460, 'etz-pop-fade': 460 };
const POP_KINDS = Object.keys(POP_MS) as PopKind[];
const POP_LONGEST = Math.max(...Object.values(POP_MS));

/** How an element pops in, by the layer it is drawn in. */
function motionOf(el: Element): PopKind {
    const layer = el.parentElement?.getAttribute('class') ?? '';
    if (/etz-curves|etz-strokes/.test(layer) && el.tagName.toLowerCase() === 'path' && !el.getAttribute('stroke-dasharray')) return 'etz-pop-draw';
    if (/etz-markers/.test(layer)) return 'etz-pop-dot';
    if (/etz-texts|etz-labels/.test(layer)) return 'etz-pop-rise';
    return 'etz-pop-fade';
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
/** Overshoots a little before it settles: a point pops. */
const easeBack = (k: number) => {
    const s = 1.7;
    return 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
};

/** The look of an element `k` (0..1) through its pop-in, as the CSS variables of src/ui/motion.css. */
function popStyle(kind: PopKind, k: number): Record<string, string> {
    const t = Math.max(0, Math.min(1, k));
    if (kind === 'etz-pop-draw') return { '--etz-pop-d': String(1 - easeInOut(t)) };
    if (kind === 'etz-pop-dot') return { '--etz-pop-s': String(t <= 0 ? 0 : easeBack(t)) };
    if (kind === 'etz-pop-rise') return { '--etz-pop-o': String(ease(t)), '--etz-pop-y': `${(6 * (1 - ease(t))).toFixed(2)}px` };
    return { '--etz-pop-o': String(ease(t)) };
}

const NO_STYLE: Record<string, string> = { '--etz-pop-d': '', '--etz-pop-s': '', '--etz-pop-o': '', '--etz-pop-y': '' };

/** The pop-ins under way, handed from a chart to its next drawing (a block drawn again mid-way). */
export interface PopInState {
    born: Array<[string, number | null]>;
    wait: Array<[string, number]>;
    now: number;
}

/**
 * Pop-in across redraws. A chart is drawn anew for every frame of a glide,
 * so each object remembers when its pop-in started, and every drawing and
 * every animation frame styles its elements at the point the object has
 * reached. The time is that of the animation frames (what a film's capture
 * controls), never the wall clock.
 */
export class PopIn {
    /** Object name -> when its pop-in starts (null: at the next frame, plus its wait). */
    private readonly born = new Map<string, number | null>();
    /** Object name -> how long it waits for the ones before it. */
    private readonly wait = new Map<string, number>();
    private onScreen: Set<string>;
    private root: Element | null = null;
    private raf: number | null = null;
    private now = 0;

    /** `present`: what is already in the picture (it never pops in); `under`: pop-ins under way to carry on. */
    constructor(present: Iterable<string> = [], under?: PopInState) {
        this.onScreen = new Set(present);
        if (under) {
            for (const [name, start] of under.born) this.born.set(name, start);
            for (const [name, ms] of under.wait) this.wait.set(name, ms);
            this.now = under.now;
        }
    }

    /** The pop-ins under way, for the chart's next drawing. */
    snapshot(): PopInState {
        return { born: [...this.born], wait: [...this.wait], now: this.now };
    }

    /** Call after every drawing of the chart into `root`. */
    apply(root: Element | null, enabled = true) {
        if (!root) return;
        this.root = root;
        const names = drawnNames(root);
        let fresh = 0;
        for (const name of names) {
            if (this.onScreen.has(name)) continue;
            this.born.set(name, null);
            this.wait.set(name, STAGGER_MS * fresh++);
        }
        this.onScreen = names;
        if (!enabled) {
            this.born.clear();
            return;
        }
        // The new drawing shows each object where its pop-in is, before the browser paints it.
        this.paint();
        if (this.born.size && this.raf === null) this.raf = window.requestAnimationFrame((t) => this.frame(t));
    }

    /** Stop (the chart left the page). */
    stop() {
        if (this.raf !== null) window.cancelAnimationFrame(this.raf);
        this.raf = null;
    }

    private frame(t: number) {
        this.raf = null;
        this.now = t;
        for (const [name, start] of this.born) if (start === null) this.born.set(name, t + (this.wait.get(name) ?? 0));
        this.paint();
        if (this.born.size && this.root?.isConnected) this.raf = window.requestAnimationFrame((next) => this.frame(next));
    }

    private paint() {
        const root = this.root;
        if (!root) return;
        for (const [name, start] of [...this.born]) {
            const age = start === null ? 0 : this.now - start;
            const els = Array.from(root.querySelectorAll(`[data-etz-item="${CSS.escape(name)}"]`));
            if (age >= POP_LONGEST) this.born.delete(name);
            for (const el of els) {
                if (!el.instanceOf(SVGElement)) continue;
                const kind = POP_KINDS.find((k) => el.hasClass(k)) ?? motionOf(el);
                const k = Math.max(0, age) / POP_MS[kind];
                if (k >= 1) {
                    el.removeClass('etz-pop');
                    el.removeClass(kind);
                    el.setCssProps(NO_STYLE);
                    if (kind === 'etz-pop-draw') el.removeAttribute('pathLength');
                    continue;
                }
                if (!el.hasClass('etz-pop')) {
                    el.addClass('etz-pop');
                    el.addClass(kind);
                    if (kind === 'etz-pop-draw') el.setAttribute('pathLength', '1');
                }
                el.setCssProps(popStyle(kind, k));
            }
        }
    }
}
