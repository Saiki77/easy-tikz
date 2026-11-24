/*
 * The player (6.0): steps and the animation clock of one chart on screen,
 * shared by charts in notes (main.ts, a row in the strip under the chart,
 * which print hides) and the editor's preview (a bar over the stage).
 *
 *   Steps: Previous, Play / Pause, Next and "Step k of n". A chart starts at
 *   its last step (the whole picture, as the export and print show it); Play
 *   goes back to the first step and on through every step.
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

/** How long a step stays when the steps play. */
export const STEP_MS = 1600;
/** How long a step takes to come in (its objects' progress 0 to 1). */
export const PROGRESS_MS = 700;
/** A frame that came late moves the clock by at most this much. */
const MAX_FRAME_S = 0.1;

export interface PlayerHost {
    /**
     * Draw the chart at `frame`. `clock`: a frame of the clock or of a step
     * coming in (draw it quickly, keep the problem line); otherwise the step
     * changed and the whole chart is drawn again.
     */
    draw(frame: MotionFrame, clock: boolean): void;
    /** The element on screen whose visibility the clock follows. */
    watched(): Element | null;
}

export interface PlayerOptions {
    /** The last step of the chart (0: no steps). */
    last: number;
    /** Objects move by themselves: the clock and its button. */
    clock: boolean;
    /** Objects move with their step's progress (part D's transforms): frames while a step comes in. */
    moversInSteps?: boolean;
}

export class MotionPlayer {
    private readonly host: PlayerHost;
    private readonly opts: PlayerOptions;
    /** The step shown (opts.last: every step). */
    private step: number;
    private progress = 1;
    private time = 0;
    /** The steps play on. */
    private playing = false;
    private stepStart = 0;
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
        this.step = opts.last;
        this.running = opts.clock && !reducedMotion();
    }

    /** The frame to draw now. */
    frame(): MotionFrame {
        return { time: this.time, step: this.step >= this.opts.last ? Infinity : this.step, progress: this.progress };
    }

    /** The step shown, or null while every step shows (the last one). */
    shownStep(): number | null {
        return this.step >= this.opts.last ? null : this.step;
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
            this.prevBtn = iconButton(row, { icon: 'skip-back', label: t('motion6.player.previous'), size: 'sm', onClick: () => this.go(this.step - 1) });
            this.playBtn = iconButton(row, { icon: 'play', label: t('motion6.player.play'), size: 'sm', pressed: false, onClick: () => this.togglePlay() });
            this.nextBtn = iconButton(row, { icon: 'skip-forward', label: t('motion6.player.next'), size: 'sm', onClick: () => this.go(this.step + 1) });
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
        const next = Math.max(0, Math.min(this.opts.last, Math.round(k)));
        if (!fromPlay) this.playing = false;
        if (next === this.step && !fromPlay) {
            this.sync();
            return;
        }
        const forward = next > this.step;
        this.step = next;
        // A step that comes in moves from 0 to 1; going back shows it settled.
        this.progress = forward && this.opts.moversInSteps && !reducedMotion() ? 0 : 1;
        this.stepStart = performance.now();
        this.host.draw(this.frame(), false);
        this.sync();
        this.loop();
    }

    private togglePlay(): void {
        if (this.playing) {
            this.playing = false;
            this.sync();
            return;
        }
        this.playing = true;
        this.go(this.step >= this.opts.last ? 0 : this.step + 1, true);
    }

    private toggleClock(): void {
        this.running = !this.running;
        this.sync();
        this.loop();
    }

    /** Run the frame loop while something moves and the chart is on screen; stop it otherwise. */
    private loop(): void {
        if (this.destroyed) return;
        const busy = this.visible && ((this.running && this.opts.clock) || this.playing || this.progress < 1);
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
        let draw = false;
        if (this.running && this.opts.clock) {
            this.time += dt;
            draw = true;
        }
        if (this.progress < 1) {
            this.progress = Math.min(1, this.progress + (dt * 1000) / PROGRESS_MS);
            draw = true;
        }
        if (draw) this.host.draw(this.frame(), true);
        if (this.playing && now - this.stepStart >= STEP_MS) {
            if (this.step >= this.opts.last) {
                this.playing = false;
                this.sync();
            } else this.go(this.step + 1, true);
        }
        if (this.raf === null) {
            const busy = this.visible && ((this.running && this.opts.clock) || this.playing || this.progress < 1);
            if (busy) this.raf = window.requestAnimationFrame((next) => this.tick(next));
        }
    }

    private sync(): void {
        if (this.playBtn) {
            this.playBtn.setIcon(this.playing ? 'pause' : 'play');
            this.playBtn.setLabel(t(this.playing ? 'motion6.player.pause' : 'motion6.player.play'));
            this.playBtn.setPressed(this.playing);
        }
        this.prevBtn?.setDisabled(this.step <= 0);
        this.nextBtn?.setDisabled(this.step >= this.opts.last);
        this.label?.setText(t('motion6.player.step', { step: this.step + 1, count: this.opts.last + 1 }));
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
