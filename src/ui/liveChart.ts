/*
 * A live chart: a chart drawn as in a note, with the note's slider strip and
 * a play button, for the slides of What's new and the steps of the Help
 * (5.1). It owns a private MathContext and SceneCache, so nothing it does
 * reaches the memoized contexts of the editor or of notes. A 2D chart draws
 * a draft on each slider frame and the full picture after a pause; a 3D
 * chart is drawn by the 3D renderer and zoomed onto what it draws.
 */
import { NoteTable } from '../beyond/table';
import { MathContext } from '../mathcontext';
import { normalizeParameters } from '../migrate';
import { SVGRenderer } from '../renderer';
import { SVG3DRenderer } from '../renderer3d';
import { SceneCache } from '../scene';
import { SettingsManager } from '../settings';
import { Parameter } from '../types';
import { cloneData, fitPixelScale } from '../util';
import { IconButtonHandle, LiveSliderHandle, formatDecimals, iconButton, liveSlider, uniqueId, visuallyHidden } from './kit';

/** After the last slider frame, the full-quality picture follows this much later. */
const FULL_RENDER_DELAY_MS = 150;
/** Play sweeps the whole range in this time. */
const SWEEP_MS = 4000;
/** A frame that came late moves play by at most this much time. */
const MAX_FRAME_MS = 50;
/** 3D is drawn a little wider than shown: the view then zooms onto the drawing. */
const ZOOM_3D = 1.3;
const MIN_3D_W = 320;
const MAX_3D_W = 640;

export interface LiveChartOptions {
    /** The chart's name for screen readers. */
    label: string;
    /** The name of the slider strip for screen readers. */
    sliders: string;
    /** The label of the play button for slider `name`, while it does not play and while it plays. */
    play(name: string): string;
    pause(name: string): string;
    /** Extra classes for the chart box and the strip. */
    boxCls?: string;
    stripCls?: string;
    /** At most this many slider rows, the first sliders of the chart. Default 3. */
    maxSliders?: number;
    /** The first slider moved (drag, typing, play): a connected chart follows. */
    onValue?: (v: number) => void;
    /** The table above the chart in the note, for a chart that reads it. */
    table?: NoteTable | null;
}

/** Take the SVG out of a 3D renderer's root: outside the root no .tikz-3d-svg rule hides it. */
export function detach3D(renderer: SVG3DRenderer): SVGSVGElement | null {
    const svg = renderer.getElement().querySelector('svg');
    if (!svg) return null;
    svg.remove();
    svg.classList.remove('tikz-3d-svg');
    return svg;
}

/** Let CSS size the picture; the viewBox keeps its proportions. */
export function fluid(svg: SVGSVGElement): SVGSVGElement {
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('aria-hidden', 'true');
    return svg;
}

/**
 * 3D charts: the camera leaves wide margins around the box, so once the SVG
 * is in the document, zoom its viewBox onto what is drawn (the groups and
 * the title). Returns the new viewBox, or null when nothing has a size.
 */
export function fitToContent(svg: SVGSVGElement, pad: number): string | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const el of Array.from(svg.querySelectorAll<SVGGraphicsElement>(':scope > g, :scope > text'))) {
        let b: DOMRect;
        try {
            b = el.getBBox();
        } catch {
            continue;
        }
        if (!(b.width > 0 && b.height > 0)) continue;
        x0 = Math.min(x0, b.x);
        y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.width);
        y1 = Math.max(y1, b.y + b.height);
    }
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null;
    const viewBox = `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`;
    svg.setAttribute('viewBox', viewBox);
    return viewBox;
}

/** Nearest slider position min + k * step inside [min, max], without float noise. */
export function onStep(v: number, p: Parameter): number {
    const stepped = p.step > 0 ? p.min + Math.round((v - p.min) / p.step) * p.step : v;
    return Number(formatDecimals(Math.min(p.max, Math.max(p.min, stepped)), 10));
}

export class LiveChart {
    private readonly manager: SettingsManager;
    private readonly math: MathContext;
    private readonly cache = new SceneCache();
    private readonly params: Parameter[];
    private readonly box: HTMLElement;
    private readonly is3D: boolean;
    private chartEl: SVGSVGElement | null = null;
    private boxSize = { w: 0, h: 0 };
    private readonly sliders: LiveSliderHandle[] = [];
    private play: IconButtonHandle | null = null;

    private frameRaf: number | null = null;
    private fullTimer: number | null = null;
    private playRaf: number | null = null;
    private playLast = 0;
    private playDir = 1;
    private playRaw = 0;
    private destroyed = false;
    /** Redraws in a row that a new `$...$` label asked for. */
    private mathRedraws = 0;

    constructor(
        parent: HTMLElement,
        data: Record<string, unknown>,
        private readonly opts: LiveChartOptions
    ) {
        this.manager = SettingsManager.fromJSON(cloneData(data));
        if (opts.table) this.manager.noteTable = opts.table;
        this.math = this.manager.createMathContext({ memo: false });
        this.params = normalizeParameters(this.manager.getValue('parameters'));
        this.is3D = this.manager.getValue('dimension') === true;

        this.box = parent.createDiv({ cls: ['etz-live-chart', ...(opts.boxCls ? [opts.boxCls] : [])] });
        this.box.setAttr('role', 'img');
        const name = visuallyHidden(parent, opts.label);
        name.id = uniqueId('live-chart');
        this.box.setAttr('aria-labelledby', name.id);
        this.render('full');
        this.buildStrip(parent);
    }

    /** The chart as it is now, the sliders back on their steps: what Open in the editor and Try an example take. */
    chart(): Record<string, unknown> {
        const data = this.manager.serialize();
        data.parameters = this.params.map((p) => ({ ...p, value: onStep(p.value, p) }));
        return cloneData(data);
    }

    /** The first slider of a connected chart moved: this one takes the value, without passing it back. */
    follow(v: number): void {
        const p = this.params[0];
        if (!p || this.destroyed || Object.is(p.value, v)) return;
        this.stopPlay(false);
        this.setValue(0, v);
        this.sliders[0]?.setValue(v);
        this.requestFrame();
    }

    /** Out of view: stop playing. */
    pause(): void {
        this.stopPlay(true);
    }

    /** In view again: draw at full quality for the size the box has now. */
    redraw(): void {
        this.safeRender('full');
    }

    destroy(): void {
        this.destroyed = true;
        this.stopPlay(false);
        if (this.frameRaf !== null) window.cancelAnimationFrame(this.frameRaf);
        if (this.fullTimer !== null) window.clearTimeout(this.fullTimer);
        this.frameRaf = this.fullTimer = null;
        this.sliders.length = 0;
        this.play = null;
        this.chartEl = null;
    }

    private render(quality: 'draft' | 'full') {
        if (this.destroyed) return;
        if (quality === 'full') {
            if (this.frameRaf !== null) window.cancelAnimationFrame(this.frameRaf);
            if (this.fullTimer !== null) window.clearTimeout(this.fullTimer);
            this.frameRaf = this.fullTimer = null;
        }
        this.math.setParams(this.params);
        const config = this.manager.toRendererConfig(this.math);
        config.parameters = this.params;
        const aspect = config.width > 0 && config.height > 0 ? config.width / config.height : 1.25;
        this.box.setCssProps({ '--etz-live-aspect': String(Math.round(aspect * 1000) / 1000) });
        // Measured on full renders only, never per drag frame.
        if ((quality === 'full' || !this.boxSize.w) && this.box.isConnected) {
            this.boxSize = { w: this.box.clientWidth, h: this.box.clientHeight };
        }
        if (this.is3D) {
            const width = Math.round(Math.max(MIN_3D_W, Math.min(MAX_3D_W, (this.boxSize.w > 0 ? this.boxSize.w : MAX_3D_W) * ZOOM_3D)));
            config.width = width;
            config.height = Math.round(width / aspect);
            const renderer = new SVG3DRenderer();
            renderer.renderSvg(config, { math: this.math });
            const svg = detach3D(renderer);
            if (!svg) return;
            this.place(fluid(svg));
            fitToContent(svg, 8);
            return;
        }
        const renderer = new SVGRenderer(config, {
            math: this.math,
            cache: this.cache,
            quality,
            pixelScale: fitPixelScale(this.boxSize.w, this.boxSize.h, config.width, config.height),
        });
        const svg = renderer.render() as SVGSVGElement;
        this.place(svg);
        // A new `$...$` label is measured before MathJax has styled it: draw once more when it has (as charts in notes do).
        void renderer.mathSettled?.then((redraw) => {
            if (!redraw) this.mathRedraws = 0;
            else if (this.chartEl === svg && svg.isConnected && !this.destroyed && this.mathRedraws < 3) {
                this.mathRedraws++;
                this.safeRender('full');
            }
        });
    }

    private place(svg: SVGSVGElement) {
        svg.addClass('etz-live-svg');
        if (this.chartEl && this.chartEl.parentElement === this.box) this.chartEl.replaceWith(svg);
        else this.box.prepend(svg);
        this.chartEl = svg;
    }

    /** A frame for the latest values: a draft on the next animation frame, full quality after a pause. */
    private requestFrame() {
        if (this.destroyed) return;
        if (this.frameRaf === null) {
            this.frameRaf = window.requestAnimationFrame(() => {
                this.frameRaf = null;
                this.safeRender('draft');
            });
        }
        if (this.fullTimer !== null) window.clearTimeout(this.fullTimer);
        this.fullTimer = window.setTimeout(() => {
            this.fullTimer = null;
            this.safeRender('full');
        }, FULL_RENDER_DELAY_MS);
    }

    /** Later frames keep the last drawing when one fails (the first one, in the constructor, throws). */
    private safeRender(quality: 'draft' | 'full') {
        try {
            this.render(quality);
        } catch {
            // The picture of the previous values stays.
        }
    }

    /** The slider strip of a chart in a note (same classes, so it looks the same): a row per slider, play on the first. */
    private buildStrip(parent: HTMLElement) {
        const shown = this.params.slice(0, this.opts.maxSliders ?? 3);
        if (!shown.length) return;
        const strip = parent.createDiv({ cls: ['etz-inline-strip', 'etz-live-strip', ...(this.opts.stripCls ? [this.opts.stripCls] : [])] });
        const name = visuallyHidden(strip, this.opts.sliders);
        name.id = uniqueId('live-sliders');
        strip.setAttr('role', 'group');
        strip.setAttr('aria-labelledby', name.id);
        const rows = strip.createDiv({ cls: 'etz-inline-rows' });
        shown.forEach((p, i) => {
            const row = rows.createDiv({ cls: 'etz-inline-row' });
            row.createSpan({ cls: 'etz-inline-name', text: p.name, attr: { 'aria-hidden': 'true' } });
            const slider = liveSlider(row, {
                min: p.min,
                max: p.max,
                step: p.step,
                value: p.value,
                label: p.name,
                readout: 'input',
                // A typed value stays in its range: outside it the picture would leave the view.
                fixedRange: true,
                onInput: (v) => {
                    this.setValue(i, v);
                    if (i === 0) this.opts.onValue?.(v);
                    this.requestFrame();
                },
                onCommit: () => this.safeRender('full'),
            });
            // A press on a slider pauses play, as in the Sliders dock.
            slider.input.addEventListener('pointerdown', () => this.stopPlay(true));
            this.sliders.push(slider);
        });
        const first = shown[0];
        this.play = iconButton(strip, {
            icon: 'play',
            label: this.opts.play(first.name),
            size: 'sm',
            pressed: false,
            cls: 'etz-live-play',
            onClick: () => (this.playRaf === null ? this.startPlay() : this.stopPlay(true)),
        });
    }

    private setValue(i: number, v: number) {
        const p = this.params[i];
        if (!p || !Number.isFinite(v)) return;
        this.params[i] = { ...p, value: v };
    }

    private startPlay() {
        const p = this.params[0];
        if (!p || !(p.max > p.min) || this.destroyed) return;
        this.playRaw = p.value;
        this.playDir = p.value >= p.max ? -1 : 1;
        this.playLast = 0;
        this.playRaf = window.requestAnimationFrame((now) => this.tick(now));
        this.syncPlay();
    }

    /** Stop playing; `settle` puts the value back on its step and draws it at full quality. */
    private stopPlay(settle: boolean) {
        if (this.playRaf === null) return;
        window.cancelAnimationFrame(this.playRaf);
        this.playRaf = null;
        this.playLast = 0;
        this.syncPlay();
        const p = this.params[0];
        if (!settle || !p || this.destroyed) return;
        const v = onStep(p.value, p);
        this.setValue(0, v);
        this.opts.onValue?.(v);
        this.sliders[0]?.setValue(v);
        this.safeRender('full');
    }

    private tick(now: number) {
        this.playRaf = null;
        const p = this.params[0];
        if (this.destroyed || !p || !this.box.isConnected) return;
        const dt = this.playLast ? Math.min(MAX_FRAME_MS, now - this.playLast) : 0;
        this.playLast = now;
        const span = p.max - p.min;
        let raw = this.playRaw + (this.playDir * span * dt) / SWEEP_MS;
        // Bounce off the ends.
        if (raw >= p.max) {
            raw = 2 * p.max - raw;
            this.playDir = -1;
        } else if (raw <= p.min) {
            raw = 2 * p.min - raw;
            this.playDir = 1;
        }
        this.playRaw = Math.min(p.max, Math.max(p.min, raw));
        // A tenth of the step while playing, so the chart moves every frame; stopping snaps back.
        const v = onStep(this.playRaw, { ...p, step: p.step / 10 });
        if (v !== p.value) {
            this.setValue(0, v);
            this.opts.onValue?.(v);
            this.sliders[0]?.setValue(v);
            this.safeRender(this.is3D ? 'full' : 'draft');
        }
        this.playRaf = window.requestAnimationFrame((next) => this.tick(next));
    }

    private syncPlay() {
        const playing = this.playRaf !== null;
        const name = this.params[0] ? this.params[0].name : '';
        this.play?.setPressed(playing);
        this.play?.setIcon(playing ? 'pause' : 'play');
        this.play?.setLabel(playing ? this.opts.pause(name) : this.opts.play(name));
    }
}
