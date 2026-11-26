/*
 * 6.2.1: the sizes of the chart labels MathJax typesets (src/mathlabel.ts),
 * kept apart from MathJax so the rules are testable outside Obsidian.
 *
 * MathJax adds the CSS of new glyphs only when a render pass is flushed,
 * so a label measured before that can be too small. Up to 6.2.0 a size
 * counted as right as soon as a measurement after any later flush (also
 * another chart's) agreed with the one before, so two early measurements
 * could settle a wrong size for good. Now every label handed out with a
 * new size is measured again when the flush of its own pass has finished,
 * and the chart is drawn again when that size differs from the one it
 * drew with. (The other cause of too narrow formulas, MathJax's breakable
 * spaces waiting for a font, is fixed where the labels are made:
 * src/mathlabel.ts.)
 */

/** A rendered label and its size. */
export interface SizedLabel<T> {
    el: T;
    width: number;
    height: number;
}

interface Entry<T> extends SizedLabel<T> {
    /** Measured after the flush of its pass: the size the page shows. */
    settled: boolean;
}

/** A label handed out before its size settled: its key and the size it was drawn with. */
export interface Handed {
    key: string;
    width: number;
    height: number;
}

/** Two sizes agree within this many px. */
const SIZE_TOLERANCE = 0.05;

/**
 * Labels by key (font size, colour, source), most recently used last. A
 * label is served from the cache only once it is settled; until then every
 * call renders and measures it again.
 */
export class LabelCache<T> {
    private readonly entries = new Map<string, Entry<T>>();
    /** Labels handed out since the last flush began with a size not settled yet: key and the size handed out. */
    private pending: Handed[] = [];

    constructor(
        private readonly measure: (el: T) => { width: number; height: number },
        private readonly copy: (el: T) => T,
        private readonly limit = 200
    ) {}

    /** The label of `key`: a copy of the settled one, else `render()` measured now. Throws what `render` or `measure` throws. */
    get(key: string, render: () => T): SizedLabel<T> {
        const hit = this.entries.get(key);
        if (hit && hit.settled) {
            this.entries.delete(key);
            this.entries.set(key, hit);
            return { el: this.copy(hit.el), width: hit.width, height: hit.height };
        }
        const el = render();
        const size = this.measure(el);
        this.entries.delete(key);
        this.entries.set(key, { el: this.copy(el), width: size.width, height: size.height, settled: false });
        this.pending.push({ key, width: size.width, height: size.height });
        if (this.entries.size > this.limit) {
            const oldest = this.entries.keys().next();
            if (!oldest.done) this.entries.delete(oldest.value);
        }
        return { el, width: size.width, height: size.height };
    }

    /** Call when a render pass is flushed: the labels its flush covers. */
    beginFlush(): Handed[] {
        const handed = this.pending;
        this.pending = [];
        return handed;
    }

    /**
     * Call when that flush has finished (the stylesheet and the fonts are
     * in): the labels are measured again and keep that size. True when a
     * label was handed out with another size (or could not be measured),
     * so the chart must be drawn again.
     */
    settle(handed: Handed[]): boolean {
        let redraw = false;
        for (const h of handed) {
            const e = this.entries.get(h.key);
            if (!e) continue;
            if (!e.settled) {
                let size: { width: number; height: number };
                try {
                    size = this.measure(this.copy(e.el));
                } catch {
                    // Not measurable now: it stays unsettled and is rendered and measured again next time.
                    redraw = true;
                    continue;
                }
                e.width = size.width;
                e.height = size.height;
                e.settled = true;
            }
            if (Math.abs(h.width - e.width) > SIZE_TOLERANCE || Math.abs(h.height - e.height) > SIZE_TOLERANCE) redraw = true;
        }
        return redraw;
    }

    /** Number of labels kept (tests). */
    get size(): number {
        return this.entries.size;
    }
}
