/*
 * Contracts between the editor modal (src/modal.ts) and its panels
 * (src/ui/*.ts). CONTRACT FILE: names and semantics are fixed; implementers
 * may add optional members but must not change or remove existing ones.
 */
import { App, Scope } from 'obsidian';
import { SettingsManager } from '../settings';
import { MathContext } from '../mathcontext';
import { Parameter } from '../types';
import { UserTemplate } from '../templates';
import type { ChartDraft } from '../templates';
import type { HistoryEntry } from '../drag/history';
import type { WhatsNewActions } from './whatsNewModal';

/** The plugin object the modal receives (main.ts implements it). */
export interface PluginHost {
    data: {
        userTemplates: UserTemplate[];
        invertDrag3D?: boolean;
        maxSamples3D?: number;
        dragSensitivity2D?: number;
        /** Autosaved unsaved chart (see ChartDraft in templates.ts). */
        draft?: ChartDraft | null;
        /** "Edit shapes by dragging" pill in the preview (SPEC3 1.12). Undefined = on. */
        dragEdit?: boolean;
        /** The first-hover drag tip was shown once (SPEC3 1.12). */
        dragTipSeen?: boolean;
    };
    saveUserTemplates(templates: UserTemplate[]): Promise<void>;
    /** Persist `data` (drafts). */
    saveSettings(): Promise<void>;
    /**
     * Optional: open the "What's new" popup (src/ui/whatsNewModal.ts). The
     * Help tab passes `actions` so the popup's buttons act on its editor.
     */
    showWhatsNew?(actions?: WhatsNewActions): void;
}

/** Something a panel registered so the modal can validate / focus it. */
export interface FieldHandle {
    /** Function or tool name ('f1', 'R1'), parameter name, 'chart' for Chart-tab fields, or 'label:<index>'. */
    source: string;
    /** Same field ids as SceneIssue.field: 'expression', 'domain', 'condition:2', 'equation', ... */
    field: string;
    /** Re-run validation and update the inline message. */
    validate(): void;
    /** Reveal (switch tab, expand card, scroll) and focus the input; select `unknown` text if given. */
    focus(selectText?: string): void;
}

export interface PanelHost {
    app: App;
    /**
     * The modal's keyboard scope. Do not register Escape on it: the modal's
     * own Escape handler comes first, so a later one never fires and Escape
     * closes the whole editor. Transient UI (popovers, inline renames) calls
     * kit.trapEscape(host, onEscape) instead and calls the returned release
     * function when it closes.
     */
    scope: Scope;
    settings: SettingsManager;
    plugin: PluginHost | null;

    is3D(): boolean;
    isPolar(): boolean;

    /**
     * Shared MathContext for validation and rendering. Rebuilt lazily after
     * `commit()`; parameter value changes are applied in place.
     * MathContext.create memoizes by structure, so the same instance may also
     * serve inline charts with the same structure: call
     * `math().setParams(...)` before evaluating anything with slider values.
     */
    math(): MathContext;

    /**
     * Continuous changes (slider drag, play animation, preview drag): render a
     * draft frame on the next animation frame (coarse grid, coalesced) and a
     * full-quality frame 150 ms after the last call. Does not rebuild panels.
     */
    requestFrame(): void;

    /** Typing: full render after a 50 ms debounce. Inline error messages appear after 600 ms idle or on blur. */
    requestUpdate(): void;

    /**
     * Structural change (a function / tool / parameter / label added,
     * removed, reordered or renamed, or its kind changed): invalidate the
     * MathContext, re-run every registered validator, refresh dependent UI
     * (dropdowns of function / region names, sliders dock, tab error dots)
     * and request an update. Also schedules the draft autosave.
     */
    commit(): void;

    /** Create a parameter (default name / value when omitted), add it to the dock, commit, return it. */
    addParameter(name?: string, value?: number): Parameter;

    /**
     * Propagate a rename through every expression / template / reference
     * field of functions, tools, annotations, axis ranges and parameters
     * (via renameIdentifier, plus regionName / ref1 / ref2 / path entries
     * and derived names like P1_x when a tool is renamed). Then commit().
     */
    rename(kind: 'function' | 'parameter' | 'tool', from: string, to: string): void;

    /** Register an input for validation / focusing; returns an unregister function. */
    registerField(field: FieldHandle): () => void;

    /**
     * Bottom bar 'Deleted R1 [Undo]' for 6 s. The modal also adds the undo
     * to the chart's history (Mod+Z). `extra` adds a second button
     * ('Make slider' after a drag).
     */
    showUndo(message: string, undo: () => void, extra?: { text: string; run: () => void }): void;

    /**
     * Optional (SPEC3 4.7): add an entry to the chart's undo history
     * (Mod+Z / Mod+Shift+Z). The sliders dock pushes its value changes here.
     */
    pushHistory?(entry: HistoryEntry): void;

    /**
     * Replace the whole chart (examples, draft restore). Asks for confirmation
     * when the chart is not empty; `onApplied` runs once the chart is in (not
     * when the reader cancels).
     */
    loadChart(data: Record<string, unknown>, onApplied?: () => void): void;

    /** Switch the left panel to a tab. */
    showTab(tab: 'build' | 'chart' | 'code' | 'help'): void;
}

/** Common card actions handed to function and layer cards by the Build panel. */
export interface CardActions {
    /** Remove the item (Build panel stores it for Undo). */
    remove(): void;
    duplicate(): void;
    moveUp(): void;
    moveDown(): void;
}
