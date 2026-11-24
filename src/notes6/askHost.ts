/*
 * Ask the curve in a drawn chart (6.0 B): what a click (or a key) on the
 * chart asks, the menu, the answer shown faintly, and the answer added. The
 * editor's preview (src/modal.ts) and the chart under a block in Live Preview
 * (main.ts) each give an AskHost: the chart as it is, what was drawn, and
 * how an answer goes in (an edit with Undo, or the block's text).
 */
import type { MathContext } from '../mathcontext';
import type { DrawnScene, RenderLayout } from '../renderer';
import type { NoteTable } from '../beyond/table';
import type { FunctionParameters, Parameter, Tool } from '../types';
import { SVGRenderer } from '../renderer';
import { SettingsManager } from '../settings';
import { t } from '../i18n';
import { AskTarget, Question, answerPresent, applyAnswer, askContext, askQuestions, pickTarget, removeAnswer } from './ask';
import { markNew, openAskMenu, showAskMenu } from './askMenu';
import '../linear/ask'; // 6.0 D: the questions about arrows and transforms

type Data = Record<string, unknown>;

/** How near a click must come to a curve or a dot, in screen px (touch: a finger). */
const NEAR_PX = 10;
const NEAR_TOUCH_PX = 22;

export interface AskDrawn {
    layout: RenderLayout;
    drawn: DrawnScene;
    /** The chart's SVG as shown. */
    svg: SVGElement;
    /** Its on-screen box: scale and offset of the viewBox (preserveAspectRatio meet). */
    box: { s: number; ox: number; oy: number };
    pixelScale: number;
}

export interface AskHost {
    /** The chart as stored now (serialized), slider values as shown. */
    data(): Data;
    /** The chart's math, slider values set. */
    math(): MathContext;
    /** What the last full drawing drew, or null (3D, nothing yet). */
    drawn(): AskDrawn | null;
    noteTable?(): NoteTable | null | undefined;
    /** Put the chart `next` in place of `before`: what the question `label` changes. */
    apply(next: Data, before: Data, label: string): void;
    /** Where the focus goes after Escape. */
    focusEl(): HTMLElement | null;
    /** Take Escape first while the menu is open (the editor's key scope); returns the release. */
    trapEscape?(onEscape: () => void): () => void;
}

/** The SVG box of an element drawn with preserveAspectRatio meet. */
export function svgBoxOf(svg: Element, layout: RenderLayout): { s: number; ox: number; oy: number } | null {
    const r = svg.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const s = Math.min(r.width / layout.width, r.height / layout.height);
    return { s, ox: r.left + (r.width - layout.width * s) / 2, oy: r.top + (r.height - layout.height * s) / 2 };
}

/** The heading of a menu: f(x) = x^2 - 4, Region R1, Curve C1, Point P. */
export function askTitle(target: AskTarget, data: Data): string {
    if (target.kind === 'function') {
        const f = (Array.isArray(data.functions) ? (data.functions as FunctionParameters[]) : []).find((x) => x.name === target.name);
        return f ? `${target.name}(x) = ${f.expression.trim()}` : target.name;
    }
    // 6.0 D
    if (target.kind === 'vector') return t('linear.ask.title.vector', { name: target.name });
    if (target.kind === 'transform') return t('linear.ask.title.transform', { name: target.name });
    const key = target.kind === 'region' ? 'notes6.ask.group.region' : target.kind === 'curve' ? 'notes6.ask.group.curve' : 'notes6.ask.group.point';
    return t(key, { name: target.name });
}

export class AskController {
    /** The SVG the preview stands in for, while an answer shows. */
    private real: SVGElement | null = null;
    private shown: SVGElement | null = null;
    /** Redraws of the shown answer that a new $...$ label asked for. */
    private redraws = 0;

    constructor(private readonly host: AskHost) {}

    /** A click (or tap) at client px: open the questions of what is there. False when nothing is. */
    at(clientX: number, clientY: number, touch: boolean): boolean {
        const d = this.host.drawn();
        if (!d) return false;
        const { layout, box } = d;
        const v = layout.view;
        const fx = ((clientX - box.ox) / box.s - layout.plot.x) / layout.plot.w;
        const fy = ((clientY - box.oy) / box.s - layout.plot.y) / layout.plot.h;
        if (fx < -0.02 || fx > 1.02 || fy < -0.02 || fy > 1.02) return false;
        const p = { x: v.xmin + fx * (v.xmax - v.xmin), y: v.ymax - fy * (v.ymax - v.ymin) };
        const sx = (layout.plot.w * box.s) / (v.xmax - v.xmin);
        const sy = (layout.plot.h * box.s) / (v.ymax - v.ymin);
        const data = this.host.data();
        const tools = Array.isArray(data.tools) ? (data.tools as Tool[]) : [];
        const target = pickTarget(d.drawn, tools, p, sx, sy, touch ? NEAR_TOUCH_PX : NEAR_PX);
        if (!target) return false;
        return this.open(target, { x: clientX, y: clientY }, false);
    }

    /** From the keyboard: the questions of `target` (default: the first function drawn), the focus on the first. */
    fromKeyboard(target?: AskTarget): boolean {
        const d = this.host.drawn();
        if (!d) return false;
        let goal = target ?? null;
        if (!goal) {
            const v = d.layout.view;
            const curve = d.drawn.curves.find((c) => c.kind === 'cartesian');
            if (!curve) return false;
            // The point of its curve nearest the middle of the view.
            const mid = (v.xmin + v.xmax) / 2;
            let best: { x: number; y: number } | null = null;
            for (const line of curve.lines) for (const p of line) if (Number.isFinite(p.y) && p.y >= v.ymin && p.y <= v.ymax && (!best || Math.abs(p.x - mid) < Math.abs(best.x - mid))) best = p;
            if (!best) return false;
            goal = { kind: 'function', name: curve.name, x: best.x, y: best.y };
        }
        return this.open(goal, this.client(goal) ?? { x: d.box.ox, y: d.box.oy }, true);
    }

    /** Client px of a math point of the chart. */
    private client(p: { x: number; y: number }): { x: number; y: number } | null {
        const d = this.host.drawn();
        if (!d) return null;
        const { layout, box } = d;
        const v = layout.view;
        const fx = (p.x - v.xmin) / (v.xmax - v.xmin);
        const fy = (v.ymax - p.y) / (v.ymax - v.ymin);
        return { x: box.ox + (layout.plot.x + fx * layout.plot.w) * box.s, y: box.oy + (layout.plot.y + fy * layout.plot.h) * box.s };
    }

    private open(target: AskTarget, at: { x: number; y: number }, focus: boolean): boolean {
        const d = this.host.drawn();
        if (!d) return false;
        const data = this.host.data();
        const math = this.host.math();
        const questions = askQuestions(askContext(target, data, d.layout.view, math));
        if (!questions.length) return false;
        const present = new Map<string, boolean>();
        const has = (q: Question) => {
            let v = present.get(q.id);
            if (v === undefined) {
                v = answerPresent(data, q.answer);
                present.set(q.id, v);
            }
            return v;
        };
        const next = (q: Question) => (has(q) ? removeAnswer(data, q.answer) : applyAnswer(data, q.answer));
        const trap = this.host.trapEscape;
        showAskMenu({
            at,
            title: askTitle(target, data),
            questions,
            present: has,
            preview: (q) => this.preview(q ? next(q) : null),
            choose: (q) => {
                this.dropPreview();
                const after = next(q);
                if (after) this.host.apply(after, data, t(has(q) ? 'notes6.ask.removed' : 'notes6.ask.added', { question: q.label }));
            },
            focus,
            returnFocus: this.host.focusEl(),
            trapEscape: trap ? (fn) => trap.call(this.host, fn) : undefined,
        });
        return true;
    }

    /** Show `next` faintly where the chart is (null: the chart again). */
    preview(next: Data | null): void {
        if (!next) {
            this.dropPreview();
            return;
        }
        const d = this.host.drawn();
        if (!d) return;
        let svg: SVGElement;
        try {
            const settings = SettingsManager.fromJSON(next);
            const table = this.host.noteTable?.();
            if (table !== undefined) settings.noteTable = table;
            const math = settings.createMathContext({ memo: false });
            math.setParams(Array.isArray(next.parameters) ? (next.parameters as Parameter[]) : []);
            const config = settings.toRendererConfig(math);
            // The same view as the chart, so nothing but the answer moves.
            Object.assign(config, { xmin: d.layout.view.xmin, xmax: d.layout.view.xmax, ymin: d.layout.view.ymin, ymax: d.layout.view.ymax, width: d.layout.width, height: d.layout.height });
            const renderer = new SVGRenderer(config, { math, quality: 'full', pixelScale: d.pixelScale });
            svg = renderer.render();
            // A new $...$ label is measured before MathJax styled it: draw the answer once more when it has.
            const drawn = svg;
            void renderer.mathSettled?.then((again) => {
                if (again && this.shown === drawn && this.redraws++ < 2) this.preview(next);
            });
        } catch {
            return;
        }
        const real = this.real ?? d.svg;
        if (!real.isConnected && !this.shown) return;
        for (const c of Array.from(real.classList)) svg.classList.add(c);
        svg.classList.add('etz-ask-preview');
        markNew(real, svg);
        (this.shown ?? real).replaceWith(svg);
        this.real = real;
        this.shown = svg;
    }

    /** The chart as it is again (before a render, a choice, a close). */
    dropPreview(): void {
        this.redraws = 0;
        if (this.shown && this.real) {
            if (this.shown.isConnected) this.shown.replaceWith(this.real);
        }
        this.shown = null;
        this.real = null;
    }

    close(): void {
        this.dropPreview();
        openAskMenu()?.close();
    }
}
