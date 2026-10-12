/*
 * Every user-facing string of drag to edit (SPEC3 1.8, 1.11): hover, lock,
 * live and tip chips, undo bar labels, announcements. Pure: no DOM, no
 * Obsidian. The session and the modal build data; only this file words it.
 */
import { formatFixed, formatNumber } from '../expr';
import type { Chip, ChipPart, DragNumber, DragTarget, Gesture, HitShape, Lock, Restriction, VirtualKind } from './types';

// ------------------------------------------------------------- constants

/** Help and tooltip copy of the core rule (SPEC3 1.1). */
export const CORE_RULE =
    'Drag a line, curve, point or label: its numbers change so the part you grabbed follows the pointer. Shift-drag turns lines and stretches curves around ⊕.';

/** aria-label of the chart preview while dragging is on (SPEC3 1.8). */
export const CHART_LABEL =
    'Chart preview. Drag lines, curves, points and labels to change their numbers; Shift-drag turns or stretches. Drag empty space to pan, scroll to zoom.';

/** Pill toggle label (SPEC3 1.12). */
export const TOGGLE_LABEL = 'Edit shapes by dragging';

/** Undo bar buttons. */
export const UNDO_BUTTON = 'Undo';
export const MAKE_SLIDER_BUTTON = 'Make slider';

/** Longest chip text (characters) before it is cut around the first highlighted part. */
const MAX_TEXT = 48;
const ELLIPSIS = '…';
const MAX_NAMES = 3;

// ----------------------------------------------------------------- locks

export type LockReason =
    | { kind: 'optimum'; point: string; objective: string; region: string; sense: 'max' | 'min'; twinCurve: string | null }
    | { kind: 'intersection'; point: string; a: string; b: string }
    | { kind: 'corner'; point: string; region: string }
    | { kind: 'lattice'; point: string; region: string | null }
    | { kind: 'derivedClause'; region: string; name: string; tool: string }
    | { kind: 'derivedLevel'; curve: string; name: string; tool: string }
    | { kind: 'keywordTangent'; fn: string; keyword: string }
    | { kind: 'derivedTangent'; fn: string; name: string; tool: string }
    | { kind: 'splicedVertex'; segment: string; index: number; from: string; fromIsList: boolean }
    | { kind: 'splicedPath'; segment: string; from: string }
    | { kind: 'curveKind'; fn: string; fnKind: 'parametric' | 'polar' }
    | { kind: 'nothing'; subject: string }
    | { kind: 'axisSlider'; name: string }
    | { kind: 'cannotDragHere'; subject: string };

export function lockFor(reason: LockReason): Lock {
    switch (reason.kind) {
        case 'optimum':
            return {
                title: `${reason.point} is computed: the ${reason.sense} of ${reason.objective} over ${reason.region}`,
                detail: reason.twinCurve
                    ? `Drag ${reason.region}'s lines or ${reason.twinCurve} instead`
                    : `Drag ${reason.region}'s lines instead`,
            };
        case 'intersection':
            return { title: `${reason.point} is computed: where ${reason.a} meets ${reason.b}`, detail: `Drag ${reason.a} or ${reason.b} instead` };
        case 'corner':
            return { title: `${reason.point} is computed: the corners of ${reason.region}`, detail: `Drag ${reason.region}'s lines instead` };
        case 'lattice':
            return reason.region
                ? { title: `${reason.point} is computed: the integer points of ${reason.region}`, detail: `Drag ${reason.region}'s lines instead` }
                : { title: `${reason.point} is computed: the integer points of the view`, detail: 'Pan or zoom the view instead' };
        case 'derivedClause':
            return { title: `This edge of ${reason.region} follows ${reason.name}`, detail: `${reason.tool} computes it` };
        case 'derivedLevel':
            return { title: `${reason.curve}'s level is ${reason.name}`, detail: `${reason.tool} computes it. Shift-drag reshapes the curve` };
        case 'keywordTangent':
            return {
                title: `The tangent of ${reason.fn} sits at its ${reason.keyword}`,
                detail: 'Type a number or a slider in Tangent at to drag it',
            };
        case 'derivedTangent':
            return { title: `The tangent of ${reason.fn} follows ${reason.name}`, detail: `${reason.tool} computes it` };
        case 'splicedVertex':
            return {
                title: `${reason.segment} point ${reason.index} comes from ${reason.from}`,
                detail: reason.fromIsList ? `Drag it in ${reason.from} instead` : `${reason.from} computes it`,
            };
        case 'splicedPath':
            return { title: `${reason.segment} follows ${reason.from}'s points`, detail: 'Drag its own points instead' };
        case 'curveKind':
            return {
                title: `${reason.fn} is ${reason.fnKind}`,
                detail: 'Dragging works for y = f(x) curves, regions, curves, points, segments and labels',
            };
        case 'nothing':
            return { title: `Nothing in ${reason.subject} can change by dragging`, detail: 'Its text has no numbers or sliders' };
        case 'axisSlider':
            return { title: `${reason.name} also sets the axis range`, detail: 'Dragging leaves it alone. Change it in the dock' };
        case 'cannotDragHere':
            return { title: `${reason.subject} cannot be dragged here`, detail: 'Grab it where it is drawn' };
    }
}

/** Shift is unavailable for this target (SPEC3 1.8 "Shift unavailable"). `noTerm`: clause text and the missing variable. */
export function shiftLockFor(t: DragTarget, noTerm: { text: string; variable: string } | null): Lock {
    const verb = t.shift === 'stretch' ? 'stretch' : t.shift === 'resize' ? 'resize' : 'turn';
    if (noTerm && verb === 'turn') {
        return { title: `Shift-drag cannot turn ${noTerm.text}: it has no ${noTerm.variable} term`, detail: 'Drag without Shift to move it' };
    }
    return { title: `Shift-drag cannot ${verb} ${t.subject} with its numbers`, detail: 'Drag without Shift to move it' };
}

/**
 * Shift is unavailable at this grab only: the numbers could change the shape, but no pivot candidate is far
 * enough from the grab (every one within the dead zone, out of view, or level with it along the stretched axis).
 */
export function noPivotLockFor(t: DragTarget): Lock {
    const verb = t.shift === 'stretch' ? 'stretch' : t.shift === 'resize' ? 'resize' : 'turn';
    return { title: `Shift-drag has no ⊕ to ${verb} ${t.subject} from this point`, detail: `Grab it elsewhere to ${verb} it, or drag without Shift to move it` };
}

// ----------------------------------------------------------------- chips

export interface HoverInfo {
    target: DragTarget;
    gesture: Gesture;
    /** Unit texts and the spans that will change (numbers) or receive insertions (ghosts). */
    text: string;
    numSpans: Array<[number, number]>;
    ghosts: Array<{ at: number; text: string }>;
    virtualKinds: string[];
    restricted: Restriction;
    pivot: { at: { x: number; y: number } } | null;
    sharedSliders: Array<{ name: string; users: string[] }>;
    twins: string[];
    passed: HitShape | null;
    shiftLock: Lock | null;
}

/** Ghost text for an inserted number in the hover chip ('k', 'a', 'h', 's' placeholders). */
export function ghostText(kind: VirtualKind, style: { spacedOps: boolean; implicitMul: boolean }): string {
    switch (kind) {
        case 'add':
            return style.spacedOps ? ' + k' : '+k';
        case 'factor':
            return style.implicitMul ? 'a' : 'a*';
        case 'shiftVar':
            return style.spacedOps ? ' - h' : '-h';
        case 'scaleVar':
            return style.implicitMul ? 's' : 's*';
    }
}

/** Placeholder label of a virtual number (DragNumber.label). */
export function virtualLabel(kind: VirtualKind): string {
    return kind === 'add' ? 'k' : kind === 'factor' ? 'a' : kind === 'shiftVar' ? 'h' : 's';
}

export function hoverChip(info: HoverInfo, keys: { mod: 'Cmd' | 'Ctrl'; alt: 'Option' | 'Alt' }): Chip {
    void keys;
    const t = info.target;
    const parts = textParts(info.text, info.numSpans.map(([s, e]) => ({ s, e, kind: 'num' as const })), info.ghosts);
    return {
        title: [{ text: `${t.subject}: `, kind: 'plain' }, ...truncate(parts)],
        detail: hoverDetail(info),
        note: hoverNote(info),
        tone: 'normal',
    };
}

export function lockChip(lock: Lock): Chip {
    return { title: [{ text: lock.title, kind: 'plain' }], detail: lock.detail, note: '', tone: 'locked' };
}

export type LiveStatus =
    | 'none'
    | 'vertical'
    | 'horizontal'
    | 'snapMarker'
    | 'throughMarker'
    | 'grid'
    | 'slope'
    | 'turning'
    | 'stretching'
    | 'resizing'
    | 'clampMax'
    | 'clampMin'
    | 'stuck'
    | 'flip'
    | 'vertical89'
    | 'mirrored'
    | 'origin';

export function liveChip(
    t: DragTarget,
    fields: Array<{ text: string; changed: Array<[number, number]> }>,
    sliders: Array<{ name: string; value: number }>,
    status: { kind: LiveStatus; label?: string; pivot?: { x: number; y: number }; bound?: number }
): Chip {
    let text = '';
    const spans: Array<{ s: number; e: number; kind: 'changed' }> = [];
    fields.forEach((f, i) => {
        if (i > 0) text += ', ';
        const off = text.length;
        for (const [s, e] of f.changed) if (e > s) spans.push({ s: off + s, e: off + e, kind: 'changed' });
        text += f.text;
    });
    const parts = truncate(textParts(text, spans, []));
    const title: ChipPart[] = [{ text: `${t.subject}: `, kind: 'plain' }, ...parts];
    for (const s of sliders) {
        title.push({ text: '   ', kind: 'plain' });
        title.push({ text: `${s.name} = ${formatNumber(s.value)}`, kind: 'changed' });
    }
    return { title, detail: liveDetail(t, status), note: '', tone: 'normal' };
}

export function tipChip(keys: { mod: 'Cmd' | 'Ctrl' }): Chip {
    return {
        title: [{ text: 'Tip: drag lines and curves to change their numbers', kind: 'plain' }],
        detail: `Shift-drag turns or stretches. ${keys.mod}+Z undoes.`,
        note: '',
        tone: 'tip',
    };
}

// ----------------------------------------------------------- undo, a11y

export function undoLabel(t: DragTarget, gesture: Gesture, twin: boolean): string {
    let text: string;
    if (gesture === 'move' && t.kind === 'level') {
        const unit = t.units.find((u) => u.role === 'levelItem');
        text = `Changed ${t.cardSource} level ${unit && unit.item !== undefined ? unit.item + 1 : 1}`;
    } else {
        // Shift on a level reshapes the whole curve: the curve's own name.
        const subject = t.kind === 'level' ? t.cardSource : t.subject;
        text = `${verbFor(t, gesture)} ${subject}`;
    }
    if (twin) {
        const names = t.twinNames && t.twinNames.length ? t.twinNames : null;
        if (names) text += ` and ${joinNames(names.map((n) => `${n}'s objective`))}`;
    }
    return text;
}

/** Announcement when a target gets selected (SPEC3 1.8). */
export function selectAnnouncement(t: DragTarget, text: string): string {
    return `${t.subject} selected: ${text}. Arrow keys move it, Enter edits the text, Escape clears the selection.`;
}

/** Announcement after a drag: 'R1 (2): x + 3y <= 6.6'. */
export function dragAnnouncement(t: DragTarget, text: string): string {
    return `${t.subject}: ${text}`;
}

/**
 * Undo bar text after an undo or redo that skipped edited fields: null when
 * nothing was skipped. `names` are the patches that no longer held their value.
 */
export function staleText(names: readonly string[], applied: boolean): string | null {
    if (!names.length) return null;
    const list = joinNames(names);
    if (!applied) return `Nothing undone: ${list} ${names.length > 1 ? 'were' : 'was'} edited since`;
    return `Undone, except ${list}, which ${names.length > 1 ? 'were' : 'was'} edited since`;
}

/** Undo bar text after Make slider. */
export function madeSliderText(name: string, value: number): string {
    return `Made slider ${name} from ${formatNumber(value)}`;
}

/** Points print with fmtNum-style 3 decimals at most: '(3, 1)', '(1.5, -1.25)'. */
export function pointText(p: { x: number; y: number }): string {
    return `(${formatFixed(p.x, 3)}, ${formatFixed(p.y, 3)})`;
}

/** 'R1', 'R1 and Label 1', 'A, B and C', 'A, B, C and 2 more'. */
export function joinNames(names: readonly string[]): string {
    const list = names.filter((n, i) => names.indexOf(n) === i);
    if (list.length <= 1) return list.join('');
    if (list.length <= MAX_NAMES) return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
    return `${list.slice(0, MAX_NAMES).join(', ')} and ${list.length - MAX_NAMES} more`;
}

/** Chip label of a number: '6', 'c', '1/2', or the virtual placeholder. */
export function numberLabel(n: DragNumber): string {
    return n.label;
}

// --------------------------------------------------------------- private

function verbFor(t: DragTarget, gesture: Gesture): string {
    if (gesture === 'move') return 'Moved';
    switch (t.shift) {
        case 'turn':
            return 'Turned';
        case 'stretch':
            return 'Stretched';
        case 'resize':
            return 'Resized';
        default:
            return 'Moved';
    }
}

function pointLike(t: DragTarget): boolean {
    return t.kind === 'point' || t.kind === 'vertex' || t.kind === 'label';
}

function shiftPart(t: DragTarget): string {
    switch (t.shift) {
        case 'turn':
            if (t.kind === 'path') return t.points.length === 2 ? 'Shift-drag to turn around the other end' : 'Shift-drag to turn';
            return 'Shift-drag to turn';
        case 'stretch':
            return 'Shift-drag to stretch';
        case 'resize':
            return 'Shift-drag to resize';
        case 'straight':
            return t.kind === 'label' ? '' : 'Shift-drag moves straight';
        default:
            return '';
    }
}

function moveDetail(t: DragTarget, restricted: Restriction): string {
    if (t.kind === 'level') return 'Drag to change this level · Shift-drag to reshape all levels';
    if (t.kind === 'tangent') return 'Drag along the curve';
    let base = 'Drag to move';
    if (restricted === 'vertical') base = 'Drag to move up and down';
    else if (restricted === 'horizontal') base = 'Drag to move sideways';
    else if (restricted === 'line') base = 'Drag to slide it along its path';
    // Points that can only slide have no straight-line option worth naming.
    if (restricted !== 'none' && pointLike(t)) return base;
    const shift = shiftPart(t);
    return shift ? `${base} · ${shift}` : base;
}

function hoverDetail(info: HoverInfo): string {
    const t = info.target;
    if (info.gesture === 'move') return moveDetail(t, info.restricted);
    if (info.shiftLock) return info.shiftLock.title;
    const at = info.pivot ? ` ${pointText(info.pivot.at)}` : '';
    switch (t.shift) {
        case 'turn':
            return info.pivot ? `Shift-drag turns around ⊕${at}` : 'Shift-drag turns';
        case 'stretch':
            return info.pivot ? `Shift-drag stretches from ⊕${at}` : 'Shift-drag stretches';
        case 'resize':
            return info.pivot ? `Shift-drag resizes around ⊕${at}` : 'Shift-drag resizes';
        case 'straight':
            return t.kind === 'label' ? 'Drag to move' : 'Shift-drag moves straight';
        default:
            return moveDetail(t, info.restricted);
    }
}

const INSERT_ORDER: VirtualKind[] = ['shiftVar', 'add', 'factor', 'scaleVar'];
const INSERT_WORDS: Record<VirtualKind, string> = { shiftVar: 'a shift', add: 'an offset', factor: 'a factor', scaleVar: 'a scale' };

function hoverNote(info: HoverInfo): string {
    const notes: string[] = [];
    const kinds = INSERT_ORDER.filter((k) => info.virtualKinds.includes(k));
    if (kinds.length) notes.push(`Adds ${joinAll(kinds.map((k) => INSERT_WORDS[k]))}`);
    for (const s of info.sharedSliders) {
        if (s.users.length) notes.push(`${s.name} is also used by ${joinNames(s.users)}`);
    }
    for (const twin of info.twins) notes.push(`Also changes ${twin}'s objective (same text)`);
    if (info.passed) notes.push(`${info.passed.source} is computed: dragging here moves ${info.target.subject}`);
    return notes.join('. ');
}

/** Like joinNames, without the 'and N more' cut. */
function joinAll(list: readonly string[]): string {
    if (list.length <= 1) return list.join('');
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function liveDetail(t: DragTarget, status: { kind: LiveStatus; label?: string; pivot?: { x: number; y: number }; bound?: number }): string {
    const at = status.pivot ? ` ${pointText(status.pivot)}` : '';
    const bound = status.bound !== undefined && Number.isFinite(status.bound) ? formatNumber(status.bound) : '';
    switch (status.kind) {
        case 'none':
            return '';
        case 'vertical':
            return 'only up and down';
        case 'horizontal':
            return 'only sideways';
        case 'snapMarker':
            return `snapped to ${status.label || 'the point'}`;
        case 'origin':
            return 'snapped to the origin';
        case 'throughMarker':
            return `through ${status.label || 'the point'}`;
        case 'grid':
            return 'on the grid';
        case 'slope':
            if (status.label === 'horizontal' || status.label === 'vertical') return status.label;
            return `slope ${status.label || ''}`.trim();
        case 'turning':
            return `turning around ⊕${at}`;
        case 'stretching':
            return `stretching from ⊕${at}`;
        case 'resizing':
            return `resizing around ⊕${at}`;
        case 'clampMax':
            return `${status.label || 'The slider'} is at its maximum (${bound})`;
        case 'clampMin':
            return `${status.label || 'The slider'} is at its minimum (${bound})`;
        case 'stuck':
            return 'cannot follow further';
        case 'flip':
            return `${t.subject} cannot turn further this way`;
        case 'vertical89':
            return 'a function cannot turn vertical: use a curve like x = 2';
        case 'mirrored':
            return 'mirrored';
    }
}

/** Plain text with highlighted spans and ghost insertions as chip parts (spans must not overlap). */
function textParts(text: string, spans: Array<{ s: number; e: number; kind: ChipPart['kind'] }>, ghosts: ReadonlyArray<{ at: number; text: string }>): ChipPart[] {
    const sorted = spans
        .map((sp) => ({ s: Math.max(0, Math.min(text.length, sp.s)), e: Math.max(0, Math.min(text.length, sp.e)), kind: sp.kind }))
        .filter((sp) => sp.e > sp.s)
        .sort((a, b) => a.s - b.s || b.e - a.e);
    // Drop spans nested in or overlapping an earlier one.
    const kept: typeof sorted = [];
    for (const sp of sorted) if (!kept.length || sp.s >= kept[kept.length - 1].e) kept.push(sp);
    const gs = ghosts
        .map((g) => ({ at: Math.max(0, Math.min(text.length, g.at)), text: g.text }))
        .sort((a, b) => a.at - b.at);
    const out: ChipPart[] = [];
    const push = (s: string, kind: ChipPart['kind']) => {
        if (!s) return;
        const last = out[out.length - 1];
        if (last && last.kind === kind) last.text += s;
        else out.push({ text: s, kind });
    };
    let pos = 0;
    let gi = 0;
    const plainTo = (end: number) => {
        while (pos < end) {
            while (gi < gs.length && gs[gi].at <= pos) push(gs[gi++].text, 'ghost');
            const next = gi < gs.length && gs[gi].at < end ? gs[gi].at : end;
            push(text.slice(pos, next), 'plain');
            pos = next;
        }
    };
    for (const sp of kept) {
        plainTo(sp.s);
        while (gi < gs.length && gs[gi].at <= pos) push(gs[gi++].text, 'ghost');
        // Ghosts inside a highlighted span (rare) go after it.
        push(text.slice(sp.s, sp.e), sp.kind);
        pos = sp.e;
    }
    plainTo(text.length);
    while (gi < gs.length) push(gs[gi++].text, 'ghost');
    return out;
}

/** Cut texts longer than MAX_TEXT around the first highlighted part, with '…' on the cut sides. */
function truncate(parts: ChipPart[]): ChipPart[] {
    const total = parts.reduce((n, p) => n + p.text.length, 0);
    if (total <= MAX_TEXT) return parts;
    let first = 0;
    let firstLen = 0;
    let off = 0;
    for (const p of parts) {
        if (p.kind !== 'plain') {
            first = off;
            firstLen = p.text.length;
            break;
        }
        off += p.text.length;
    }
    // Keep a little context before the highlight; never run past the end.
    const lead = Math.max(0, Math.floor((MAX_TEXT - Math.min(firstLen, MAX_TEXT)) / 3));
    const start = Math.max(0, Math.min(first - lead, total - MAX_TEXT));
    const end = start + MAX_TEXT;
    const out: ChipPart[] = [];
    if (start > 0) out.push({ text: ELLIPSIS, kind: 'plain' });
    off = 0;
    for (const p of parts) {
        const s = Math.max(start, off);
        const e = Math.min(end, off + p.text.length);
        if (e > s) {
            const text = p.text.slice(s - off, e - off);
            const last = out[out.length - 1];
            if (last && last.kind === p.kind) last.text += text;
            else out.push({ text, kind: p.kind });
        }
        off += p.text.length;
    }
    if (end < total) {
        const last = out[out.length - 1];
        if (last && last.kind === 'plain') last.text += ELLIPSIS;
        else out.push({ text: ELLIPSIS, kind: 'plain' });
    }
    return out;
}
