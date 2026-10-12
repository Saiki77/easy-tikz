/*
 * Chart-level undo history (SPEC3 D11, 1.11): drag commits, keyboard
 * sessions, deletes and dock slider changes. Patch entries only restore a
 * field (or slider) that still holds the value the entry wrote, so an undo
 * never overwrites a later edit. Pure: no DOM, no Obsidian.
 */
import type { DragCommit, FieldRef } from './types';

export interface HistoryEntry {
    label: string;
    /** True when something was restored. */
    undo(): boolean;
    redo?(): boolean;
    /**
     * Optional addition: display names of the patches the last undo / redo
     * skipped because they were edited since (describe.staleText words it).
     */
    stale?: string[];
}

export interface PatchIO {
    read(ref: FieldRef): string | null;
    write(ref: FieldRef, text: string): void;
    readParam(name: string): number | null;
    writeParam(name: string, value: number): void;
    /** After applying: host.commit(). */
    done(): void;
}

/** Slider values written by a drag sit on min + k * step; compare with a hair of tolerance. */
function sameNumber(a: number, b: number): boolean {
    return a === b || Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** undo / redo apply a patch only when the current value equals the patch's after / before value. */
export function patchEntry(commit: DragCommit, io: PatchIO): HistoryEntry {
    const entry: HistoryEntry = {
        label: commit.label,
        stale: [],
        undo: () => apply(false),
        redo: () => apply(true),
    };
    const apply = (forward: boolean): boolean => {
        const stale: string[] = [];
        let applied = 0;
        for (const p of commit.fields) {
            const from = forward ? p.before : p.after;
            const to = forward ? p.after : p.before;
            const cur = io.read(p.ref);
            if (cur === to) continue;
            if (cur !== from) {
                stale.push(p.name || refName(p.ref));
                continue;
            }
            io.write(p.ref, to);
            applied++;
        }
        for (const p of commit.params) {
            const from = forward ? p.before : p.after;
            const to = forward ? p.after : p.before;
            const cur = io.readParam(p.name);
            if (cur !== null && sameNumber(cur, to)) continue;
            if (cur === null || !sameNumber(cur, from)) {
                stale.push(p.name);
                continue;
            }
            io.writeParam(p.name, to);
            applied++;
        }
        entry.stale = stale;
        if (applied) io.done();
        // Nothing to restore and nothing stale (already at the target state) still counts as done.
        return applied > 0 || stale.length === 0;
    };
    return entry;
}

function refName(ref: FieldRef): string {
    if (ref.kind === 'function') return ref.name;
    if (ref.kind === 'label') return `Label ${ref.index + 1}`;
    return ref.id;
}

export class EditHistory {
    private readonly max: number;
    private readonly undoStack: HistoryEntry[] = [];
    private readonly redoStack: HistoryEntry[] = [];

    constructor(max = 50) {
        this.max = Number.isFinite(max) && max >= 1 ? Math.floor(max) : 50;
    }

    /** Adds an entry; clears the redo stack. */
    push(e: HistoryEntry): void {
        this.undoStack.push(e);
        while (this.undoStack.length > this.max) this.undoStack.shift();
        this.redoStack.length = 0;
    }

    /** Pops and runs undo; entries with redo move to the redo stack. Returns the entry and whether it applied. */
    undo(): { entry: HistoryEntry; applied: boolean } | null {
        const entry = this.undoStack.pop();
        if (!entry) return null;
        let applied = false;
        try {
            applied = entry.undo();
        } catch {
            applied = false;
        }
        if (applied && entry.redo) this.redoStack.push(entry);
        return { entry, applied };
    }

    redo(): { entry: HistoryEntry; applied: boolean } | null {
        const entry = this.redoStack.pop();
        if (!entry || !entry.redo) return null;
        let applied = false;
        try {
            applied = entry.redo();
        } catch {
            applied = false;
        }
        if (applied) {
            this.undoStack.push(entry);
            while (this.undoStack.length > this.max) this.undoStack.shift();
        }
        return { entry, applied };
    }

    /** Removes an entry that was undone through its undo bar button. */
    forget(e: HistoryEntry): void {
        for (const stack of [this.undoStack, this.redoStack]) {
            const i = stack.lastIndexOf(e);
            if (i >= 0) stack.splice(i, 1);
        }
    }

    clear(): void {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }
}
