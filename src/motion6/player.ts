/*
 * The player (6.0): steps and the animation clock of one chart on screen,
 * shared by charts in notes (main.ts, a row in the strip under the chart,
 * which print hides) and the editor's preview (a bar over the stage).
 *
 *   Steps: Previous, Play / Pause, Next and "Step k of n". A chart starts at
 *   its last step (the whole picture, as the export and print show it); Play
 *   goes back to the first step and on through every step. When a step comes
 *   in, its objects enter by kind; Previous fades the objects of the step
 *   that leaves (src/motion6/timeline.ts, entrances.ts).
 *   Clock: Pause / Play of the objects that move by themselves. It runs only
 *   while the chart is on screen (IntersectionObserver) and starts paused
 *   when the system asks for less motion.
 *
 * A chart without steps or moving objects gets no player and runs no frame
 * loop. The host draws each frame with player.frame() in its renderer config
 * (RendererConfig.motion), so the scene reads the clock's time and the step.
 */
import type { MotionFrame } from '../types';
import { IconButtonHandle, iconButton } from '../ui/kit';
import { t } from '../i18n';
import { reducedMotion } from '../motion';
import { StepTimeline } from './timeline';
import { entranceMs, entrancesOn } from './entrances';

export { STEP_MS, PROGRESS_MS } from './timeline';

/** A frame that came late moves the clock by at most this much. */
const MAX_FRAME_S = 0.1;

type Data = Record<string, unknown>;

export interface PlayerHost {
    /**
     * Draw the chart at `frame`. `clock`: a frame of the clock or of a step
     * coming in (draw it quickly, keep the problem line); otherwise the step
     * changed and the whole chart is drawn again.
     */
    draw(frame: MotionFrame, clock: boolean): void;
    /** The element on screen whose visibility the clock follows. */
    watched(): Element | null;
    /** 6.0 entrances: the chart as it is now (its objects enter by kind; `set entrances = off` stops them). Absent: the chart the player was made for. */
    chart?(): Data;
}

export interface PlayerOptions {
    /** The last step of the chart (0: no steps). */
    last: number;
    /** Objects move by themselves: the clock and its button. */
    clock: boolean;
    /** Objects move with their step's progress (part D's transforms): frames while a step comes in. */
    moversInSteps?: boolean;
    /** 6.0 entrances: the chart the player was made for. */
    chart?: Data;
}

export class MotionPlayer {
    private readonly host: PlayerHost;
    private readonly opts: PlayerOptions;
    /** The steps over time: the step chosen and drawn, how far it has come in (6.0 entrances). */
    private readonly steps: StepTimeline;
    private time = 0;
    /** The steps play on. */
    private playing = false;
    /** The clock runs (when the chart is on screen). */
    private running: boolean;
    private visible = false;
    private observer: IntersectionObserver | null = null;
    private raf: number | null = null;
    private last = 0;
    private destroyed = false;
    private playBtn: IconButtonHandle | null = null;
    private prevBtn: IconButtonHandle | null = null;
    private nextBtn: IconButtonHandle | null = null;
    private clockBtn: IconButtonHandle | null = null;
    private label: HTMLElement | null = null;

    constructor(host: PlayerHost, opts: PlayerOptions) {
        this.host = host;
        this.opts = opts;
        this.steps = new StepTimeline(opts.last, !!opts.moversInSteps);
        this.running = opts.clock && !reducedMotion();
    }

    /** The frame to draw now. */
    frame(): MotionFrame {
        return this.steps.frame(this.time);
    }

    /** The step shown, or null while every step shows (the last one). */
    shownStep(): number | null {
        const shown = this.steps.shown();
        return shown >= this.opts.last ? null : shown;
    }

    /** Start following the chart's visibility (call once the chart is on the page). */
    watch(): void {
        const el = this.host.watched();
        if (!el || this.observer || typeof IntersectionObserver === 'undefined') {
            this.visible = true;
            this.loop();
            return;
        }
        this.observer = new IntersectionObserver((entries) => {
            for (const e of entries) this.visible = e.isIntersecting;
            this.loop();
        });
        this.observer.observe(el);
    }

    /** The row of buttons, into `parent` (first when `first`). */
    controls(parent: HTMLElement, first = false): HTMLElement {
        const row = parent.createDiv({ cls: 'etz-motion6-row', attr: { role: 'group', 'aria-label': t('motion6.player.group') } });
        if (first) parent.prepend(row);
        if (this.opts.last > 0) {
            this.prevBtn = iconButton(row, { icon: 'skip-back', label: t('motion6.player.previous'), size: 'sm', onClick: () => this.go(this.steps.step - 1) });
            this.playBtn = iconButton(row, { icon: 'play', label: t('motion6.player.play'), size: 'sm', pressed: false, onClick: () => this.togglePlay() });
            this.nextBtn = iconButton(row, { icon: 'skip-forward', label: t('motion6.player.next'), size: 'sm', onClick: () => this.go(this.steps.step + 1) });
            this.label = row.createSpan({ cls: 'etz-motion6-step', attr: { 'aria-live': 'polite' } });
        }
        if (this.opts.clock) {
            this.clockBtn = iconButton(row, { icon: 'pause', label: '', size: 'sm', cls: 'etz-motion6-clock', onClick: () => this.toggleClock() });
        }
        this.sync();
        return row;
    }

    /** Show step `k` (clamped); the steps stop playing when a button moves them. */
    go(k: number, fromPlay = false): void {
        if (!fromPlay) this.playing = false;
        const chart = this.host.chart ? this.host.chart() : this.opts.chart;
        const changed = this.steps.go(k, {
            motion: !reducedMotion(),
            entrances: !!chart && entrancesOn(chart),
            enterMs: (step) => (chart ? entranceMs(chart, step) : 0),
            fromPlay,
        });
        if (!changed) {
            this.sync();
            return;
        }
        this.host.draw(this.frame(), false);
        this.sync();
        this.loop();
    }

    /**
     * 6.0 F4: play the steps once from the first (a slide or a page that opens);
     * nothing for a chart without steps or when the system asks for less motion.
     */
    playFromStart(): void {
        if (this.opts.last <= 0 || this.destroyed || reducedMotion()) return;
        this.playing = true;
        this.go(0, true);
    }

    private togglePlay(): void {
        if (this.playing) {
            this.playing = false;
            this.sync();
            return;
        }
        this.playing = true;
        const step = this.steps.step;
        this.go(step >= this.opts.last ? 0 : step + 1, true);
    }

    private toggleClock(): void {
        this.running = !this.running;
        this.sync();
        this.loop();
    }

    /** Something to draw on the next animation frames: the clock, the steps playing, or a step coming in or leaving. */
    private busy(): boolean {
        return this.visible && ((this.running && this.opts.clock) || this.playing || this.steps.busy());
    }

    /** Run the frame loop while something moves and the chart is on screen; stop it otherwise. */
    private loop(): void {
        if (this.destroyed) return;
        const busy = this.busy();
        if (busy && this.raf === null) {
            this.last = 0;
            this.raf = window.requestAnimationFrame((now) => this.tick(now));
        } else if (!busy && this.raf !== null) {
            window.cancelAnimationFrame(this.raf);
            this.raf = null;
        }
    }

    private tick(now: number): void {
        this.raf = null;
        if (this.destroyed) return;
        const el = this.host.watched();
        if (el && !el.isConnected) return;
        const dt = this.last ? Math.min(MAX_FRAME_S, Math.max(0, (now - this.last) / 1000)) : 0;
        this.last = now;
        let clock = false;
        if (this.running && this.opts.clock) {
            this.time += dt;
            clock = true;
        }
        const step = this.steps.advance(dt * 1000, this.playing);
        // A step that has come in (or the step before, after a fade) is drawn whole once more: the settled picture.
        if (step === 'settle') this.host.draw(this.frame(), false);
        else if (clock || step === 'frame') this.host.draw(this.frame(), true);
        if (this.playing && this.steps.ready()) {
            if (this.steps.step >= this.opts.last) {
                this.playing = false;
                this.sync();
            } else this.go(this.steps.step + 1, true);
        }
        if (this.raf === null && this.busy()) this.raf = window.requestAnimationFrame((next) => this.tick(next));
    }

    private sync(): void {
        if (this.playBtn) {
            this.playBtn.setIcon(this.playing ? 'pause' : 'play');
            this.playBtn.setLabel(t(this.playing ? 'motion6.player.pause' : 'motion6.player.play'));
            this.playBtn.setPressed(this.playing);
        }
        const step = this.steps.step;
        this.prevBtn?.setDisabled(step <= 0);
        this.nextBtn?.setDisabled(step >= this.opts.last);
        this.label?.setText(t('motion6.player.step', { step: step + 1, count: this.opts.last + 1 }));
        if (this.clockBtn) {
            this.clockBtn.setIcon(this.running ? 'pause' : 'play');
            this.clockBtn.setLabel(t(this.running ? 'motion6.player.clockPause' : 'motion6.player.clockPlay'));
            this.clockBtn.setPressed(!this.running);
        }
    }

    /** Stop everything (the chart left the page). */
    destroy(): void {
        this.destroyed = true;
        if (this.raf !== null) window.cancelAnimationFrame(this.raf);
        this.raf = null;
        this.observer?.disconnect();
        this.observer = null;
    }
}
