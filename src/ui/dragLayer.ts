/*
 * Drag-to-edit overlay (SPEC3 1.8, 4.6): a sibling SVG laid exactly over the
 * chart SVG (same viewBox, xMidYMid meet) that draws the hover halo, the grab
 * dot, the selection halo, the ghost of the start shape, the pivot mark with
 * its spoke and the snap ring; plus the hint chip (docked in the readout
 * corner while hovering, following the pointer while dragging).
 *
 * The overlay never takes pointer events and is never part of the chart SVG,
 * so Copy SVG / PNG (which clone the chart SVG only) cannot contain it.
 * Sizes are CSS px, converted to viewBox units with the chart's on-screen
 * scale (stroke widths, radii and dashes are SVG attributes; colours come
 * from drag.css).
 */
import type { RenderLayout } from '../renderer';
import type { Chip, Pt } from '../drag/types';

/** Overlay sizes in CSS px (SPEC3 1.8). */
const HALO_W = 6;
const SELECT_W = 4;
const RING_R = 7;
const HOVER_RING_W = 3;
const SELECT_RING_W = 4;
const GRAB_R = 4;
/** Background-coloured edge of the grab dot, so it reads on top of its line. */
const GRAB_EDGE_W = 1;
const PIVOT_R = 6;
const PIVOT_W = 2;
const PIVOT_CROSS = 8;
const PIVOT_CROSS_W = 1.5;
const SPOKE_W = 1;
const SPOKE_DASH = [3, 3];
const GHOST_W = 1.5;
const GHOST_DASH = [4, 3];
const GHOST_POINT_R = 4;
const SNAP_R = 9;
const SNAP_W = 1.5;
const SNAP_DASH = [3, 2.5];
/** Lines are clipped to the plot plus this much (the chart clips at 1 viewBox unit; halos are wider). */
const CLIP_PAD = 4;

/** Hint placement while dragging: offset from the pointer, and the margin kept to the stage edges (CSS px). */
const FOLLOW_DX = 14;
const FOLLOW_DY = 18;
const EDGE_MARGIN = 8;

export interface DragLayerHandle {
    el: SVGSVGElement;
    /** Place the overlay exactly over the chart SVG (same viewBox, xMidYMid meet, setCssStyles for left / top / width / height). Call after every render and on resize. */
    sync(layout: RenderLayout, chart: HTMLElement, svg: SVGElement): void;
    hover(lines: Pt[][] | null, point: Pt | null, grab: Pt | null): void;
    selection(lines: Pt[][] | null, point: Pt | null): void;
    ghost(lines: Pt[][] | null, points: Pt[] | null): void;
    pivot(at: Pt | null, spokeTo: Pt | null): void;
    snap(at: Pt | null): void;
    clear(): void;
    destroy(): void;
}

export interface DragHintHandle {
    el: HTMLElement;
    /** Hover: docked in the readout corner (bottom-left of the stage). */
    dock(chip: Chip): void;
    /** Dragging: 14 px right and 18 px below the pointer, flipped to stay inside the stage. */
    follow(chip: Chip, clientX: number, clientY: number): void;
    hide(): void;
    destroy(): void;
}

/** Unique clip-path ids: two overlays (or a re-opened modal) must not share one. */
let layerCount = 0;

function fmt(n: number): string {
    return String(Math.round(n * 100) / 100);
}

function finitePt(p: Pt | null | undefined): p is Pt {
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

export function createDragLayer(chart: HTMLElement): DragLayerHandle {
    const clipId = `etz-drag-clip-${++layerCount}`;
    const el = chart.createSvg('svg', {
        cls: 'etz-drag-layer',
        attr: { 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid meet' },
    });
    const defs = el.createSvg('defs');
    const clipPath = defs.createSvg('clipPath', { attr: { id: clipId } });
    const clipRect = clipPath.createSvg('rect');
    const clipped = (cls: string) => el.createSvg('g', { cls, attr: { 'clip-path': `url(#${clipId})` } });
    // Bottom to top: ghost, selection, hover, spoke, pivot, snap ring, grab dot.
    const ghostLines = clipped('etz-drag-ghost');
    const ghostPoints = el.createSvg('g', { cls: 'etz-drag-ghost' });
    const selectLines = clipped('etz-drag-select');
    const selectPoint = el.createSvg('g', { cls: ['etz-drag-select', 'is-ring'] });
    const hoverLines = clipped('etz-drag-halo');
    const hoverPoint = el.createSvg('g', { cls: ['etz-drag-halo', 'is-ring'] });
    const spokeG = el.createSvg('g', { cls: 'etz-drag-spoke' });
    const pivotG = el.createSvg('g', { cls: 'etz-drag-pivot' });
    const snapG = el.createSvg('g', { cls: 'etz-drag-snap' });
    const grabG = el.createSvg('g', { cls: 'etz-drag-grab' });

    let layout: RenderLayout | null = null;
    /** CSS px per viewBox unit of the chart on screen. */
    let scale = 1;
    let hoverState: { lines: Pt[][] | null; point: Pt | null; grab: Pt | null } = { lines: null, point: null, grab: null };
    let selectState: { lines: Pt[][] | null; point: Pt | null } = { lines: null, point: null };
    let ghostState: { lines: Pt[][] | null; points: Pt[] | null } = { lines: null, points: null };
    let pivotState: { at: Pt | null; spokeTo: Pt | null } = { at: null, spokeTo: null };
    let snapState: Pt | null = null;

    /** CSS px to viewBox units. */
    const u = (px: number) => px / scale;
    const dash = (d: number[]) => d.map((v) => fmt(u(v))).join(' ');

    const sx = (x: number): number => {
        const l = layout as RenderLayout;
        return l.plot.x + ((x - l.view.xmin) / (l.view.xmax - l.view.xmin)) * l.plot.w;
    };
    const sy = (y: number): number => {
        const l = layout as RenderLayout;
        return l.plot.y + l.plot.h - ((y - l.view.ymin) / (l.view.ymax - l.view.ymin)) * l.plot.h;
    };

    /** Path data through polylines (math), split at non-finite points; '' when nothing is drawable. */
    const pathData = (lines: Pt[][]): string => {
        let d = '';
        for (const line of lines) {
            if (!Array.isArray(line)) continue;
            let run = '';
            let count = 0;
            for (const p of line) {
                if (!finitePt(p)) {
                    if (count >= 2) d += run;
                    run = '';
                    count = 0;
                    continue;
                }
                run += `${count ? 'L' : 'M'}${fmt(sx(p.x))},${fmt(sy(p.y))}`;
                count++;
            }
            if (count >= 2) d += run;
        }
        return d;
    };

    const ready = () => layout !== null && layout.plot.w > 0 && layout.plot.h > 0 && layout.view.xmax > layout.view.xmin && layout.view.ymax > layout.view.ymin;

    const drawLines = (g: SVGGElement, lines: Pt[][] | null, width: number, dashes: number[] | null) => {
        g.empty();
        if (!lines || !ready()) return;
        const d = pathData(lines);
        if (!d) return;
        const attr: Record<string, string> = { d, 'stroke-width': fmt(u(width)) };
        if (dashes) attr['stroke-dasharray'] = dash(dashes);
        g.createSvg('path', { attr });
    };

    const drawRing = (g: SVGGElement, p: Pt | null, r: number, width: number, dashes: number[] | null) => {
        if (!finitePt(p) || !ready()) return;
        const attr: Record<string, string> = { cx: fmt(sx(p.x)), cy: fmt(sy(p.y)), r: fmt(u(r)), 'stroke-width': fmt(u(width)) };
        if (dashes) attr['stroke-dasharray'] = dash(dashes);
        g.createSvg('circle', { attr });
    };

    const renderHoverLines = () => drawLines(hoverLines, hoverState.lines, HALO_W, null);
    const renderHoverPoint = () => {
        hoverPoint.empty();
        drawRing(hoverPoint, hoverState.point, RING_R, HOVER_RING_W, null);
    };
    const renderGrab = () => {
        grabG.empty();
        const p = hoverState.grab;
        if (!finitePt(p) || !ready()) return;
        grabG.createSvg('circle', { attr: { cx: fmt(sx(p.x)), cy: fmt(sy(p.y)), r: fmt(u(GRAB_R)), 'stroke-width': fmt(u(GRAB_EDGE_W)) } });
    };
    const renderSelection = () => {
        drawLines(selectLines, selectState.lines, SELECT_W, null);
        selectPoint.empty();
        drawRing(selectPoint, selectState.point, RING_R, SELECT_RING_W, null);
    };
    const renderGhost = () => {
        drawLines(ghostLines, ghostState.lines, GHOST_W, GHOST_DASH);
        ghostPoints.empty();
        for (const p of ghostState.points || []) drawRing(ghostPoints, p, GHOST_POINT_R, GHOST_W, GHOST_DASH);
    };
    const renderPivot = () => {
        spokeG.empty();
        pivotG.empty();
        const at = pivotState.at;
        if (!finitePt(at) || !ready()) return;
        const cx = sx(at.x);
        const cy = sy(at.y);
        const to = pivotState.spokeTo;
        if (finitePt(to)) {
            spokeG.createSvg('line', {
                attr: { x1: fmt(cx), y1: fmt(cy), x2: fmt(sx(to.x)), y2: fmt(sy(to.y)), 'stroke-width': fmt(u(SPOKE_W)), 'stroke-dasharray': dash(SPOKE_DASH) },
            });
        }
        pivotG.createSvg('circle', { cls: 'etz-drag-pivot-disc', attr: { cx: fmt(cx), cy: fmt(cy), r: fmt(u(PIVOT_R)), 'stroke-width': fmt(u(PIVOT_W)) } });
        const h = u(PIVOT_CROSS) / 2;
        const w = fmt(u(PIVOT_CROSS_W));
        pivotG.createSvg('line', { cls: 'etz-drag-pivot-cross', attr: { x1: fmt(cx - h), y1: fmt(cy), x2: fmt(cx + h), y2: fmt(cy), 'stroke-width': w } });
        pivotG.createSvg('line', { cls: 'etz-drag-pivot-cross', attr: { x1: fmt(cx), y1: fmt(cy - h), x2: fmt(cx), y2: fmt(cy + h), 'stroke-width': w } });
    };
    const renderSnap = () => {
        snapG.empty();
        drawRing(snapG, snapState, SNAP_R, SNAP_W, SNAP_DASH);
    };
    const renderAll = () => {
        renderGhost();
        renderSelection();
        renderHoverLines();
        renderHoverPoint();
        renderPivot();
        renderSnap();
        renderGrab();
    };

    const updateClip = () => {
        if (!layout) return;
        const pad = u(CLIP_PAD);
        clipRect.setAttribute('x', fmt(layout.plot.x - pad));
        clipRect.setAttribute('y', fmt(layout.plot.y - pad));
        clipRect.setAttribute('width', fmt(layout.plot.w + 2 * pad));
        clipRect.setAttribute('height', fmt(layout.plot.h + 2 * pad));
    };

    /** Forget and erase everything drawn (shared by clear() and destroy(), no `this` needed). */
    const clear = () => {
        hoverState = { lines: null, point: null, grab: null };
        selectState = { lines: null, point: null };
        ghostState = { lines: null, points: null };
        pivotState = { at: null, spokeTo: null };
        snapState = null;
        for (const g of [ghostLines, ghostPoints, selectLines, selectPoint, hoverLines, hoverPoint, spokeG, pivotG, snapG, grabG]) g.empty();
    };

    return {
        el,
        sync(next, host, svg) {
            // The chart is emptied when it switches to 3D and back; come back on top of the new SVG.
            if (el.parentElement !== host) host.appendChild(el);
            layout = next;
            if (!layout || !(layout.width > 0) || !(layout.height > 0)) {
                el.addClass('tikz-hidden');
                return;
            }
            el.removeClass('tikz-hidden');
            el.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
            const hr = host.getBoundingClientRect();
            const sr = svg.getBoundingClientRect();
            // CSS px of the host, also under a transformed (scaled) modal.
            const zoom = host.offsetWidth > 0 && hr.width > 0 ? hr.width / host.offsetWidth : 1;
            const w = sr.width / zoom;
            const h = sr.height / zoom;
            el.setCssStyles({
                left: `${(sr.left - hr.left) / zoom - host.clientLeft}px`,
                top: `${(sr.top - hr.top) / zoom - host.clientTop}px`,
                width: `${w}px`,
                height: `${h}px`,
            });
            const s = Math.min(w / layout.width, h / layout.height);
            scale = Number.isFinite(s) && s > 0 ? s : 1;
            updateClip();
            renderAll();
        },
        hover(lines, point, grab) {
            const same = lines === hoverState.lines && point === hoverState.point;
            hoverState = { lines, point, grab };
            if (!same) {
                renderHoverLines();
                renderHoverPoint();
            }
            renderGrab();
        },
        selection(lines, point) {
            if (lines === selectState.lines && point === selectState.point) return;
            selectState = { lines, point };
            renderSelection();
        },
        ghost(lines, points) {
            if (lines === ghostState.lines && points === ghostState.points) return;
            ghostState = { lines, points };
            renderGhost();
        },
        pivot(at, spokeTo) {
            pivotState = { at, spokeTo };
            renderPivot();
        },
        snap(at) {
            snapState = at;
            renderSnap();
        },
        clear,
        destroy() {
            clear();
            el.remove();
        },
    };
}

/** Stable text of a chip, to skip redundant DOM work on every pointer move. */
function chipKey(chip: Chip): string {
    return JSON.stringify([chip.tone, chip.detail, chip.note, chip.title.map((p) => [p.kind, p.text])]);
}

export function createDragHint(stage: HTMLElement): DragHintHandle {
    // Read by sight only: the modal announces selections and results through its own live region.
    const el = stage.createDiv({ cls: ['etz-drag-hint', 'tikz-hidden'], attr: { 'aria-hidden': 'true' } });
    const title = el.createDiv({ cls: 'etz-drag-hint-title' });
    const detail = el.createDiv({ cls: 'etz-drag-hint-detail' });
    const note = el.createDiv({ cls: 'etz-drag-hint-note' });
    let shown = '';
    /**
     * Size of the rendered chip (CSS px). A ResizeObserver keeps it current after the browser's own layout;
     * reading offsetWidth on every changed text would force a layout of the modal mid-frame (about 2 ms a
     * frame while the cards and the chart change). Measured synchronously only when unknown.
     */
    let size: { w: number; h: number } | null = null;
    /** Stage box while the chip follows a drag, read once per drag for the same reason. */
    let box: { left: number; top: number; zoom: number; w: number; h: number } | null = null;
    /** Pointer position (stage CSS px) while following; null while docked or hidden. */
    let pointer: { x: number; y: number } | null = null;

    const place = () => {
        if (!pointer || !box || !size) return;
        const W = box.w;
        const H = box.h;
        let x = pointer.x + FOLLOW_DX;
        let y = pointer.y + FOLLOW_DY;
        // Flip to the other side of the pointer when the chip would leave the stage, then keep it inside.
        if (x + size.w > W - EDGE_MARGIN) x = pointer.x - FOLLOW_DX - size.w;
        if (y + size.h > H - EDGE_MARGIN) y = pointer.y - FOLLOW_DY - size.h;
        x = Math.max(EDGE_MARGIN, Math.min(x, W - EDGE_MARGIN - size.w));
        y = Math.max(EDGE_MARGIN, Math.min(y, H - EDGE_MARGIN - size.h));
        el.setCssStyles({ left: `${Math.round(x)}px`, top: `${Math.round(y)}px` });
    };
    const observer =
        typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => {
                  const w = el.offsetWidth;
                  const h = el.offsetHeight;
                  // Hidden (display none): keep the last real size.
                  if (w === 0 && h === 0) return;
                  if (size && size.w === w && size.h === h) return;
                  size = { w, h };
                  place();
              })
            : null;
    observer?.observe(el);

    const render = (chip: Chip) => {
        const key = chipKey(chip);
        if (key === shown) return;
        shown = key;
        if (!observer) size = null;
        title.empty();
        for (const part of chip.title) {
            if (!part.text) continue;
            if (part.kind === 'plain') title.createSpan({ text: part.text });
            else title.createSpan({ cls: `is-${part.kind}`, text: part.text });
        }
        detail.setText(chip.detail);
        detail.toggleClass('tikz-hidden', !chip.detail);
        note.setText(chip.note);
        note.toggleClass('tikz-hidden', !chip.note);
        el.toggleClass('is-locked', chip.tone === 'locked');
        el.toggleClass('is-tip', chip.tone === 'tip');
    };

    return {
        el,
        dock(chip) {
            render(chip);
            box = null;
            pointer = null;
            el.addClass('is-docked');
            el.setCssStyles({ left: '', top: '' });
            el.removeClass('tikz-hidden');
        },
        follow(chip, clientX, clientY) {
            render(chip);
            el.removeClass('is-docked');
            el.removeClass('tikz-hidden');
            if (!box) {
                const r = stage.getBoundingClientRect();
                const zoom = stage.offsetWidth > 0 && r.width > 0 ? r.width / stage.offsetWidth : 1;
                box = { left: r.left, top: r.top, zoom, w: stage.clientWidth, h: stage.clientHeight };
            }
            pointer = { x: (clientX - box.left) / box.zoom, y: (clientY - box.top) / box.zoom };
            if (!size || (size.w === 0 && size.h === 0)) size = { w: el.offsetWidth, h: el.offsetHeight };
            place();
        },
        hide() {
            box = null;
            pointer = null;
            el.addClass('tikz-hidden');
        },
        destroy() {
            observer?.disconnect();
            el.remove();
        },
    };
}
