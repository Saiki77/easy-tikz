/*
 * The "What's new" popup: when to show it, what it says, and the live
 * chart inside it. Pure (no 'obsidian' import), so tests/whatsnew.test.ts
 * can check all of it; the popup itself is src/ui/whatsNewModal.ts and
 * main.ts decides when to open it.
 *
 * The popup is for people who UPDATED. Two signs tell an update from a
 * fresh install:
 *   - the plugin had stored data before this load (Obsidian's loadData
 *     returned an object): everyone who changed a setting or saved a
 *     template in 3.x, and everyone who opened the editor in 4.0 or 4.1;
 *   - no stored data, but the vault already holds an easy-tikz block:
 *     3.x wrote its data file only when a setting was changed or a
 *     template saved, so most 3.x users have charts in their notes and no
 *     data. main.ts looks for one block once the layout is ready
 *     (hasEasyTikzBlock, chartScanRank) and stops at the first.
 * Neither sign: a fresh install, which never sees the popup and records it
 * as seen. The record is the version of the popup's content
 * (WHATS_NEW_VERSION), not the version of the plugin: a later release that
 * keeps this content does not show it again, and one that brings new
 * content raises WHATS_NEW_VERSION.
 */
import { GUIDES } from './guides';
import { parseChartText } from './text/parse';
import { printChartText } from './text/print';
import type { Parameter } from './types';
import { MessageKey, MessageValues, t, tIn } from './i18n';
import { HoverCard, hoverCard, noteDefinitions } from './notes6/hover';

/** Version of the popup's content. Raise it when the popup says something new. */
export const WHATS_NEW_VERSION = '6.0.0';

/**
 * Compare two version strings numerically, part by part ('4.10.0' > '4.9.1',
 * '4.2' = '4.2.0'). Parts that are not numbers count as 0.
 */
export function compareVersions(a: string, b: string): number {
    const parts = (v: string) => v.split('.').map((p) => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
    });
    const pa = parts(a);
    const pb = parts(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Obsidian's loadData returns null when the plugin never saved anything (or
 * its data file cannot be read): a fresh install, unless the vault shows
 * that Easy Graphs Charts and TikZ was used before (see shouldShowWhatsNew).
 */
export function isFreshInstall(stored: unknown): boolean {
    return !isRecord(stored);
}

/** The stored data records that the popup of `version` (or a later one) was seen. */
export function whatsNewSeen(stored: unknown, version: string = WHATS_NEW_VERSION): boolean {
    if (!isRecord(stored)) return false;
    const seen = stored.whatsNewSeen;
    return typeof seen === 'string' && seen.trim() !== '' && compareVersions(seen, version) >= 0;
}

/**
 * Show the popup on this load? Only to a user who updated and has not seen
 * this version of it, with the setting "Show what's new after updates" on
 * (`enabled`). A user who updated has stored data, or, without stored data,
 * charts in the vault from before (`usedBefore`, found by main.ts).
 */
export function shouldShowWhatsNew(stored: unknown, version: string, enabled: boolean, usedBefore = false): boolean {
    if (!enabled || whatsNewSeen(stored, version)) return false;
    return !isFreshInstall(stored) || usedBefore;
}

/**
 * Look through the vault for charts from before? Only when the stored data
 * cannot tell: there is none, and the popup is switched on (the default).
 */
export function needsVaultCheck(stored: unknown, version: string, enabled: boolean): boolean {
    return enabled && isFreshInstall(stored) && !whatsNewSeen(stored, version);
}

/**
 * The opening line of an easy-tikz block: ``` or ~~~ (three or more), then
 * the language. Also indented (a list) or quoted (a callout, a blockquote).
 */
const EASY_TIKZ_FENCE = /^[ \t>]*(?:`{3,}|~{3,})[ \t]*easy-tikz(?![\w-])/m;

/** The note text holds an easy-tikz block. */
export function hasEasyTikzBlock(text: string): boolean {
    return EASY_TIKZ_FENCE.test(text);
}

/**
 * How likely a note holds an easy-tikz block, from the section types of
 * Obsidian's metadata cache (null: not indexed yet):
 *   2  a code block: read it first
 *   1  not indexed yet, or a list, callout or blockquote (a fence inside one is not a section of its own)
 *   0  none of these: no need to read it
 */
export function chartScanRank(sectionTypes: readonly string[] | null): 0 | 1 | 2 {
    if (!sectionTypes) return 1;
    if (sectionTypes.includes('code')) return 2;
    return sectionTypes.some((t) => t === 'list' || t === 'callout' || t === 'blockquote') ? 1 : 0;
}


// ------------------------------------------------------------------ chart

/** Slider `a` of the first live chart: the real part of c in z^2 + c. */
export const WHATS_NEW_SLIDER: Readonly<Parameter> = { name: 'a', value: -0.8, min: -1, max: 1, step: 0.01 };

/**
 * The first live chart: a Julia set, every point of the plane coloured by
 * its orbit under z^2 + c, with c = a + bi on two sliders (6.0: every idea
 * is a picture). The GPU paints it, so the sliders move it live.
 */
export const WHATS_NEW_CHART_TEXT = [
    'show x from -1.8 to 1.8 and y from -1.2 to 1.2',
    'size 12 x 8',
    'equal scale',
    `slider ${WHATS_NEW_SLIDER.name} from ${WHATS_NEW_SLIDER.min} to ${WHATS_NEW_SLIDER.max}, starting at ${WHATS_NEW_SLIDER.value}, in steps of ${WHATS_NEW_SLIDER.step}`,
    'slider b from -1 to 1, starting at 0.156, in steps of 0.002',
    'colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = x + iy$, $c = a + bi$, 200 steps',
].join('\n');

/** The first live chart as data. A new copy every time: the popup moves its own. */
export function whatsNewChart(): Record<string, unknown> {
    return parseChartText(WHATS_NEW_CHART_TEXT).data;
}

/** The first live chart as its block writes it: what you type, line by line (src/text). */
export function whatsNewText(): string {
    return printChartText(whatsNewChart());
}

// ---------------------------------------------------------------- content

export interface WhatsNewItem {
    /** Lucide id known to Obsidian 1.13 (the smoke test checks that it draws: svg.lucide-<id>). */
    icon: string;
    title: string;
    /** One line. Inline `backticks` become code. */
    text: string;
    /** A guide in the Help tab (src/guides) that shows it step by step. */
    guide?: string;
}

/**
 * An item whose title and text are read in the reader's language each time
 * they are shown: the language is set after this module loads, and the tests
 * read them in English.
 */
function item(icon: string, title: MessageKey, text: MessageKey, guide?: string, values?: MessageValues): WhatsNewItem {
    const out: WhatsNewItem = {
        icon,
        get title() {
            return t(title);
        },
        get text() {
            return t(text, values);
        },
    };
    if (guide) out.guide = guide;
    return out;
}

export const WHATS_NEW_TITLE = 'Easy Graphs Charts and TikZ 6';

/** The line under the title, in the reader's language. */
export const whatsNewSubtitle = (): string => t('panels.whatsNew.subtitle');
/** The same line in English, as the tests read it. */
export const WHATS_NEW_SUBTITLE = tIn('en', 'panels.whatsNew.subtitle');

/** What a slide of the popup shows (src/ui/whatsNewModal.ts draws each). */
export type WhatsNewSlideId = 'picture' | 'matrix' | 'motion' | 'ask' | 'hover' | 'values' | 'also' | 'earlier';

/** One slide of the popup: a feature of 6.0, shown big with its live chart. */
export interface WhatsNewSlide {
    id: WhatsNewSlideId;
    /** Lucide id known to Obsidian 1.13. */
    icon: string;
    /** In the reader's language. */
    readonly title: string;
    /** One or two sentences in the reader's language; inline `backticks` become code. */
    readonly text: string;
    /** A guide in the Help tab that shows it step by step. */
    guide?: string;
    /** Its charts, as chart text: the live charts of the slide. */
    charts: string[];
    /** Slider rows under its live chart (default 1). */
    sliders?: number;
}

function slide(id: WhatsNewSlideId, icon: string, title: MessageKey, text: MessageKey, charts: string[], more: { guide?: string; sliders?: number } = {}): WhatsNewSlide {
    const out: WhatsNewSlide = {
        id,
        icon,
        get title() {
            return t(title);
        },
        get text() {
            return t(text);
        },
        charts,
    };
    if (more.guide) out.guide = more.guide;
    if (more.sliders) out.sliders = more.sliders;
    return out;
}

/** A matrix moves the plane: the grid, î, ĵ and the unit square, then A in the next step, then its eigenvectors. Play moves it. */
const MATRIX_CHART = [
    'show x from -4.5 to 4.5 and y from -3 to 3',
    'size 12 x 8',
    'equal scale',
    'let $A = \\begin{pmatrix} 1.5 & 1 \\\\ 0.5 & 2 \\end{pmatrix}$',
    'draw the grid',
    'draw the basis vectors',
    'shade the unit square, labelled',
    'then transform the plane by A',
    'then draw the eigenvectors of A, labelled',
].join('\n');

/** Motion: the damped pendulum's field, particles on the clock, and its rest points (stable spirals and saddles). */
const MOTION_CHART = [
    'show x from -6.3 to 6.3 and y from -4.2 to 4.2',
    'size 12 x 8',
    'draw the vector field $F(x, y) = (y, -\\sin x - 0.25y)$, coloured by length, with moving particles',
    'mark the rest points of F, labelled',
].join('\n');

/** Ask the curve: two functions to click. The menu's questions come from src/notes6/ask.ts. */
export const WHATS_NEW_ASK_CHART = [
    'show x from -4 to 4 and y from -5 to 7',
    'size 12 x 8',
    'plot $g(x) = x^2 - 4$ in blue, thick',
    'plot $h(x) = 2 - x$ in red, thick',
].join('\n');

/** The note of the hover slide: it defines g, and its formula is a set. */
export const WHATS_NEW_NOTE_DEFINITION = 'g(x) = x^2 - 4';
export const WHATS_NEW_FORMULA = '\\{x \\in \\mathbb{R}^n \\mid g(x) \\le 0\\}';

/** The card of the formula, as a note shows it (src/notes6/hover.ts): g from the note, the set on the x-axis. */
export function whatsNewCard(): HoverCard | null {
    return hoverCard(WHATS_NEW_FORMULA, noteDefinitions([WHATS_NEW_NOTE_DEFINITION]));
}

/** The chart of that card, in chart lines. */
const HOVER_CHART = ['size 12 x 8', ...(whatsNewCard()?.lines ?? [])].join('\n');

/** Values and sums: the Taylor polynomial of sin x, its degree on a slider. */
const VALUES_CHART = [
    'show x from -7.5 to 7.5 and y from -3 to 3',
    'size 12 x 8',
    'slider n from 0 to 12, starting at 4, in steps of 1',
    'plot $\\sin x$ in gray, thick',
    'plot $T(x) = \\sum_{k=0}^{n} \\frac{(-1)^k x^{2k+1}}{(2k+1)!}$ in red, thick',
].join('\n');

/**
 * The slides, in order: what 6.0 brings, one feature each, then the rest
 * of 6.0 in one list, then versions 5 and 4. Back, Next, the dots and the
 * arrow keys move between them.
 */
export const WHATS_NEW_SLIDES: WhatsNewSlide[] = [
    slide('picture', 'snowflake', 'panels.whatsNew.picture.title', 'panels.whatsNew.picture.text', [WHATS_NEW_CHART_TEXT], { sliders: 2 }),
    slide('matrix', 'axis-3d', 'panels.whatsNew.matrix.title', 'panels.whatsNew.matrix.text', [MATRIX_CHART]),
    slide('motion', 'waves', 'panels.whatsNew.motion.title', 'panels.whatsNew.motion.text', [MOTION_CHART]),
    slide('ask', 'mouse-pointer-click', 'panels.whatsNew.ask.title', 'panels.whatsNew.ask.text', [WHATS_NEW_ASK_CHART]),
    slide('hover', 'scan-search', 'panels.whatsNew.hover.title', 'panels.whatsNew.hover.text', [HOVER_CHART]),
    slide('values', 'braces', 'panels.whatsNew.values.title', 'panels.whatsNew.values.text', [VALUES_CHART]),
    slide('also', 'list-plus', 'panels.whatsNew.alsoTitle', 'panels.whatsNew.alsoText', []),
    slide('earlier', 'list', 'panels.whatsNew.moreTitle', 'panels.whatsNew.earlierText', []),
];

/** The features of 6.0 that have a slide of their own, in the order of the slides. */
export const WHATS_NEW_RECENT: WhatsNewItem[] = WHATS_NEW_SLIDES.filter((x) => x.charts.length > 0).map((x) => {
    const out: WhatsNewItem = {
        icon: x.icon,
        get title() {
            return x.title;
        },
        get text() {
            return x.text;
        },
    };
    if (x.guide) out.guide = x.guide;
    return out;
});

/** The rest of 6.0, one line each (the slide "Also new"). */
export const WHATS_NEW_ALSO: WhatsNewItem[] = [
    item('repeat', 'panels.whatsNew.orbits.title', 'panels.whatsNew.orbits.text'),
    item('git-fork', 'panels.whatsNew.bifurcation.title', 'panels.whatsNew.bifurcation.text'),
    item('crosshair', 'panels.whatsNew.newton.title', 'panels.whatsNew.newton.text'),
    item('circle-dot', 'panels.whatsNew.fourier.title', 'panels.whatsNew.fourier.text'),
    item('infinity', 'panels.whatsNew.systems.title', 'panels.whatsNew.systems.text'),
    item('film', 'panels.whatsNew.steps.title', 'panels.whatsNew.steps.text'),
    item('spline', 'panels.whatsNew.sets.title', 'panels.whatsNew.sets.text'),
    item('move-vertical', 'panels.whatsNew.fitY.title', 'panels.whatsNew.fitY.text'),
    item('hand', 'panels.whatsNew.dragTips.title', 'panels.whatsNew.dragTips.text'),
    item('file-down', 'panels.whatsNew.pictures.title', 'panels.whatsNew.pictures.text'),
];

/** Version 5, one line each (the first group of "Earlier versions"). */
export const WHATS_NEW_V5: WhatsNewItem[] = [
    item('square-function', 'panels.whatsNew.formulaCharts.title', 'panels.whatsNew.formulaCharts.text', 'notes-formulas'),
    item('sigma', 'panels.whatsNew.latexLanguage.title', 'panels.whatsNew.latexLanguage.text', 'formulas'),
    item('link-2', 'panels.whatsNew.connected.title', 'panels.whatsNew.connected.text'),
    item('table', 'panels.whatsNew.data.title', 'panels.whatsNew.data.text'),
    item('percent', 'panels.whatsNew.probability.title', 'panels.whatsNew.probability.text'),
    item('chart-column', 'panels.whatsNew.riemann.title', 'panels.whatsNew.riemann.text'),
    item('wind', 'panels.whatsNew.slopeField.title', 'panels.whatsNew.slopeField.text'),
    item('file-image', 'panels.whatsNew.svgFiles.title', 'panels.whatsNew.svgFiles.text'),
];

/** What makes a chart move: sliders and the values computed from them. */
export const WHATS_NEW_LIVE: WhatsNewItem[] = [
    item('sliders-horizontal', 'panels.whatsNew.sliders.title', 'panels.whatsNew.sliders.text', 'sliders'),
    item('calculator', 'panels.whatsNew.calculations.title', 'panels.whatsNew.calculations.text', 'computed-values'),
    item('file-text', 'panels.whatsNew.notes.title', 'panels.whatsNew.notes.text', 'charts-in-notes'),
];

/** New in 4.3: AI makes charts. Its link opens the editor's AI tab. */
export const WHATS_NEW_AI: WhatsNewItem = item('bot', 'panels.whatsNew.ai.title', 'panels.whatsNew.ai.text');

/** Version 4, newest first, one line each (the second group of "Earlier versions"). */
export const WHATS_NEW_MORE: WhatsNewItem[] = [
    item('ruler', 'panels.whatsNew.numbers.title', 'panels.whatsNew.numbers.text'),
    item('image', 'panels.whatsNew.white.title', 'panels.whatsNew.white.text'),
    item('layers', 'panels.whatsNew.solid.title', 'panels.whatsNew.solid.text'),
    item('grid', 'panels.whatsNew.gridOpacity.title', 'panels.whatsNew.gridOpacity.text'),
    item('blend', 'panels.whatsNew.mesh.title', 'panels.whatsNew.mesh.text'),
    item('palette', 'panels.whatsNew.colormaps.title', 'panels.whatsNew.colormaps.text'),
    item('maximize-2', 'panels.whatsNew.fit.title', 'panels.whatsNew.fit.text'),
    item('box', 'panels.whatsNew.cube.title', 'panels.whatsNew.cube.text'),
    item('globe', 'panels.whatsNew.language.title', 'panels.whatsNew.language.text'),
    ...WHATS_NEW_LIVE,
    WHATS_NEW_AI,
    item('languages', 'panels.whatsNew.words.title', 'panels.whatsNew.words.text'),
    item('type', 'panels.whatsNew.plain.title', 'panels.whatsNew.plain.text'),
    item('eye', 'panels.whatsNew.under.title', 'panels.whatsNew.under.text'),
    item('layout-panel-left', 'panels.whatsNew.editor.title', 'panels.whatsNew.editor.text'),
    item('move', 'panels.whatsNew.drag.title', 'panels.whatsNew.drag.text'),
    item('shapes', 'panels.whatsNew.tools.title', 'panels.whatsNew.tools.text'),
    item('file-code', 'panels.whatsNew.latex.title', 'panels.whatsNew.latex.text'),
    // The count comes from the guide list, so a new guide never leaves this line behind.
    item('book-open', 'panels.whatsNew.guides.title', 'panels.whatsNew.guides.text', undefined, { count: GUIDES.length }),
    item('history', 'panels.whatsNew.carryOver.title', 'panels.whatsNew.carryOver.text'),
    item('smartphone', 'panels.whatsNew.phones.title', 'panels.whatsNew.phones.text'),
];

/** Every icon the popup uses (its items, buttons and the Help tab link). */
export const WHATS_NEW_ICONS: readonly string[] = [
    ...WHATS_NEW_RECENT.map((i) => i.icon),
    ...WHATS_NEW_ALSO.map((i) => i.icon),
    ...WHATS_NEW_V5.map((i) => i.icon),
    ...WHATS_NEW_MORE.map((i) => i.icon),
    ...WHATS_NEW_SLIDES.map((x) => x.icon),
    'play',
    'pause',
    'sparkles',
    'mouse-pointer-2',
    'arrow-left',
];
