/*
 * Guides: step-by-step tutorials with live charts.
 *
 * One source of truth for two outputs:
 *   - the Help tab of the editor renders a guide with live charts drawn by
 *     the plugin's own renderer (no bundled images) and an "Open in editor"
 *     button per step;
 *   - `scripts/media/build-guides.mjs` turns the same data into
 *     `docs/guides/<id>.md` and captures a real Obsidian screenshot per step.
 *
 * CONTRACT FILE: exported names and documented semantics are fixed. Guide
 * authors add data files next to it; they never change these types.
 * Pure: no DOM, no Obsidian.
 */

/** A complete chart: the object SettingsManager.fromJSON accepts (v4 shape, see EXAMPLES in src/migrate.ts). */
export type ChartData = Record<string, unknown>;

export type GuideLevel = 'start' | 'core' | 'advanced';

/** Groups shown as sections in the Help tab and on docs/guides/README.md, in this order. */
export type GuideCategory = 'Getting started' | 'Functions and sliders' | 'Regions and optimisation' | 'Points, lines and labels' | '3D' | 'Notes and export' | 'Reference';

/**
 * What the screenshot of a step should show (GitHub guides only; the Help
 * tab ignores it). The capture script loads `chart` into the real editor,
 * applies `view`, then performs `actions` in order before the picture.
 */
export interface GuideShot {
    /** Editor tab to show. Default 'build'. */
    tab?: 'build' | 'chart' | 'code' | 'help';
    /** 'editor' = the whole editor modal (default); 'preview' = only the chart preview; 'note' = the chart rendered inside a note; 'none' = no screenshot for this step. */
    frame?: 'editor' | 'preview' | 'note' | 'none';
    /** Sources whose cards should be expanded and scrolled into view ('f1', 'R1', 'label:0', a slider name). */
    reveal?: string[];
    /**
     * Scripted gestures before the picture, in order. Coordinates are math
     * coordinates of the chart. Each is one of:
     *   { hover: [x, y], shift?: boolean }            show the hover tip (and the pivot ring with shift)
     *   { drag: [[x0, y0], [x1, y1]], shift?: boolean, hold?: boolean }   drag; hold keeps the button down for the picture
     *   { slider: [name, value] }                     set a slider through the dock
     *   { focus: [source, field] }                    focus a field (same ids as SceneIssue.field)
     *   { menu: 'add' }                               open the + Add menu. The picture then shows the menu over the
     *                                                 chart of the step BEFORE (a new chart for the first step): that
     *                                                 is what the reader sees when the menu opens
     */
    actions?: Array<Record<string, unknown>>;
    /** Short caption under the image. */
    caption?: string;
}

export interface GuideStep {
    /** Imperative, at most 8 words: "Add the constraint lines". */
    title: string;
    /**
     * What to do and why, as a few short paragraphs separated by blank
     * lines. Inline code uses backticks. Lines starting with '- ' form a
     * list. No other markdown. No em dashes.
     */
    body: string;
    /** Things to type, shown as copyable rows: { where: 'R1, condition 2', text: 'x + 3y <= 6' }. */
    type?: Array<{ where: string; text: string }>;
    /** The chart as it should look AFTER this step. Omit to keep the previous step's chart. */
    chart?: ChartData;
    shot?: GuideShot;
    /** One-line tip or warning shown in a callout. */
    tip?: string;
}

export interface Guide {
    /** Stable kebab-case id: file name on GitHub and deep link in Help. */
    id: string;
    title: string;
    /** One sentence, shown on the card. */
    summary: string;
    category: GuideCategory;
    level: GuideLevel;
    /** Honest reading-and-doing time in minutes. */
    minutes: number;
    /** What the reader can do afterwards, 2 to 4 short bullets. */
    outcomes: string[];
    /** Ids of guides worth reading first. */
    requires?: string[];
    /** The finished chart (card thumbnail, hero image of the guide page). */
    chart: ChartData;
    steps: GuideStep[];
    /** Ids of good next guides. */
    next?: string[];
}
