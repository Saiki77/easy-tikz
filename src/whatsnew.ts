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

/** Version of the popup's content. Raise it when the popup says something new. */
export const WHATS_NEW_VERSION = '5.0.0';

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

/** The formula of the live chart, as a note writes it (typeset beside the chart). */
export const WHATS_NEW_FORMULA = 'f(x) = \\frac{x^3}{3} - a x';

/** Slider `a` of the live chart: from no extremum (a <= 0) to two that move apart; they stay inside the view. */
export const WHATS_NEW_SLIDER: Readonly<Parameter> = { name: 'a', value: 1, min: -1, max: 2, step: 0.05 };

/** The live chart as its block is written: the chart of the formula, with its extrema. */
export const WHATS_NEW_CHART_TEXT = [
    'show x from -3 to 3 and y from -3 to 3',
    'axes in the middle',
    'with a grid',
    'size 12 x 8',
    `slider ${WHATS_NEW_SLIDER.name} from ${WHATS_NEW_SLIDER.min} to ${WHATS_NEW_SLIDER.max}, starting at ${WHATS_NEW_SLIDER.value}, in steps of ${WHATS_NEW_SLIDER.step}`,
    `plot $${WHATS_NEW_FORMULA}$ in blue, thick, with its extrema`,
].join('\n');

/**
 * The live chart of the popup: the chart of a formula as every formula in
 * a note now has one (5.0). f(x) = x^3/3 - a x has f'(x) = x^2 - a: no
 * extremum for a <= 0, and for a > 0 a maximum at -sqrt(a) and a minimum at
 * sqrt(a) with the values +-(2/3) a sqrt(a), at most 1.89 for a = 2, so both
 * stay inside the view. A new copy every time: the popup moves its own.
 */
export function whatsNewChart(): Record<string, unknown> {
    return parseChartText(WHATS_NEW_CHART_TEXT).data;
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

export const WHATS_NEW_TITLE = 'Easy Graphs Charts and TikZ 5';

/** The line under the title, in the reader's language. */
export const whatsNewSubtitle = (): string => t('panels.whatsNew.subtitle');
/** The same line in English, as the tests read it. */
export const WHATS_NEW_SUBTITLE = tIn('en', 'panels.whatsNew.subtitle');

/** What a slide of the popup shows (src/ui/whatsNewModal.ts draws each). */
export type WhatsNewSlideId = 'formulas' | 'language' | 'connected' | 'svg' | 'data' | 'probability' | 'riemann' | 'slope' | 'earlier';

/** One slide of the popup: a feature of 5.0, shown big with its live charts. */
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
    /** The Markdown table above the chart in the note, for a chart that reads it (`use the table above`). */
    table?: string[];
    /** What Try an example opens, when it is not the slide's chart (the editor has no note table: the points written out). */
    example?: string;
}

function slide(id: WhatsNewSlideId, icon: string, title: MessageKey, text: MessageKey, charts: string[], more: { guide?: string; table?: string[]; example?: string } = {}): WhatsNewSlide {
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
    if (more.table) out.table = more.table;
    if (more.example) out.example = more.example;
    return out;
}

/** The chart of the slide on the chart language: a linear program, formulas in LaTeX. */
const LANGUAGE_CHART = [
    'size 12 x 8',
    'show x from 0 to 5 and y from 0 to 4.5',
    'axes on the edges',
    'slider c from 0 to 15, starting at 6',
    'shade where $x + y \\le 4$ and $x + 3y \\le 6$ and $x \\ge 0$ and $y \\ge 0$, numbered',
    'draw $2x + 3y = c$ in red, dashed, labelled "$z = {c}$"',
    'mark the maximum of $2x + 3y$ in the region, large',
].join('\n');

/** The two charts of the slide on connected sliders: each has a slider a, connected. */
const CONNECTED_CHARTS = [
    ['size 12 x 8', 'show x from -3 to 3 and y from -1 to 5', 'axes in the middle', 'with a grid', 'slider a from 0.25 to 2, starting at 1, connected', 'plot $f(x) = a x^2$ in blue, thick'].join('\n'),
    ['size 12 x 8', 'show x from -4 to 4 and y from -2.5 to 2.5', 'axes in the middle', 'with a grid', 'slider a from 0.25 to 2, starting at 1, connected', 'plot $g(x) = a \\sin(x)$ in red, thick'].join('\n'),
];

/** The chart of the slide on SVG files, as its file shows it. */
const SVG_CHART = ['size 12 x 8', 'show x from -3 to 5 and y from -3 to 5', 'axes in the middle', 'with a grid', 'plot $f(x) = \\frac{1}{2}(x - 1)^2 - 2$ in blue, thick'].join('\n');

/** The table above the chart of the data slide, as the note holds it: hours of study and the test score. */
const DATA_TABLE = ['| hours | score |', '|---|---|', '| 1 | 52 |', '| 2 | 55 |', '| 3 | 61 |', '| 4 | 64 |', '| 5 | 70 |', '| 6 | 71 |', '| 7 | 77 |'];

/** The chart that reads it: the points and their regression line. */
const DATA_CHART = ['size 12 x 8', 'show x from 0 to 8 and y from 40 to 85', 'axes on the edges', 'with a grid', 'use the table above', 'mark the data', 'draw its regression line, labelled'].join('\n');

/** The same chart with the table's points written in it, for the editor (Try an example). */
const DATA_EXAMPLE = DATA_CHART.replace('use the table above', 'xlabel hours\nylabel score\ndata (1, 52), (2, 55), (3, 61), (4, 64), (5, 70), (6, 71), (7, 77)');

/** A normal distribution with the probability between -a and a shaded. */
const PROBABILITY_CHART = [
    'size 12 x 7',
    'show x from -4 to 4 and y from 0 to 0.5',
    'axes on the edges',
    'slider a from 0 to 3, starting at 1',
    'plot the normal distribution with mean 0 and sd 1',
    'shade $P(-a \\le X \\le a)$, labelled',
].join('\n');

/** The left Riemann sum of x^2 from 0 to 2, n parts on a slider. */
const RIEMANN_CHART = [
    'size 12 x 7',
    'show x from -0.2 to 2.2 and y from -0.3 to 4.4',
    'axes on the edges',
    'slider n from 1 to 40, starting at 6, in steps of 1',
    'plot $f(x) = x^2$ in blue, thick',
    'draw the left Riemann sum of f from 0 to 2 with n parts, labelled',
].join('\n');

/** The slope field of y' = x - y and the solution through P, which a slider moves up and down. */
const SLOPE_CHART = [
    'size 12 x 8',
    'show x from -3 to 3 and y from -3 to 3',
    'axes in the middle',
    'slider b from -2.5 to 2.5, starting at 1',
    "draw the slope field of $y' = x - y$",
    'mark P at (0, b)',
    'draw the solution through P',
].join('\n');

/**
 * The slides, in order: what 5.0 brings, one feature each, then version 4
 * in one list. Back, Next, the dots and the arrow keys move between them.
 */
export const WHATS_NEW_SLIDES: WhatsNewSlide[] = [
    slide('formulas', 'square-function', 'panels.whatsNew.formulaCharts.title', 'panels.whatsNew.formulaCharts.text', [WHATS_NEW_CHART_TEXT]),
    slide('language', 'sigma', 'panels.whatsNew.latexLanguage.title', 'panels.whatsNew.latexLanguage.text', [LANGUAGE_CHART], { guide: 'formulas' }),
    slide('connected', 'link-2', 'panels.whatsNew.connected.title', 'panels.whatsNew.connected.text', CONNECTED_CHARTS),
    slide('data', 'table', 'panels.whatsNew.data.title', 'panels.whatsNew.data.text', [DATA_CHART], { table: DATA_TABLE, example: DATA_EXAMPLE }),
    slide('probability', 'percent', 'panels.whatsNew.probability.title', 'panels.whatsNew.probability.text', [PROBABILITY_CHART]),
    slide('riemann', 'chart-column', 'panels.whatsNew.riemann.title', 'panels.whatsNew.riemann.text', [RIEMANN_CHART]),
    slide('slope', 'wind', 'panels.whatsNew.slopeField.title', 'panels.whatsNew.slopeField.text', [SLOPE_CHART]),
    slide('svg', 'file-image', 'panels.whatsNew.svgFiles.title', 'panels.whatsNew.svgFiles.text', [SVG_CHART]),
    slide('earlier', 'list', 'panels.whatsNew.moreTitle', 'panels.whatsNew.earlierText', []),
];

/** Every feature new in 5.0, in the order of the slides. */
export const WHATS_NEW_RECENT: WhatsNewItem[] = WHATS_NEW_SLIDES.filter((x) => x.id !== 'earlier').map((x) => {
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

/** What makes the live chart move: sliders and the values computed from them. */
export const WHATS_NEW_LIVE: WhatsNewItem[] = [
    item('sliders-horizontal', 'panels.whatsNew.sliders.title', 'panels.whatsNew.sliders.text', 'sliders'),
    item('calculator', 'panels.whatsNew.calculations.title', 'panels.whatsNew.calculations.text', 'computed-values'),
    item('file-text', 'panels.whatsNew.notes.title', 'panels.whatsNew.notes.text', 'charts-in-notes'),
];

/** New in 4.3: AI makes charts. Its link opens the editor's AI tab. */
export const WHATS_NEW_AI: WhatsNewItem = item('bot', 'panels.whatsNew.ai.title', 'panels.whatsNew.ai.text');

/** Version 4, newest first, one line each, behind "Earlier in version 4" (closed). */
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

/** The live chart as its block writes it: what you type, line by line (src/text). */
export function whatsNewText(): string {
    return printChartText(whatsNewChart());
}

/** Every icon the popup uses (its items, buttons and the Help tab link). */
export const WHATS_NEW_ICONS: readonly string[] = [
    ...WHATS_NEW_RECENT.map((i) => i.icon),
    ...WHATS_NEW_MORE.map((i) => i.icon),
    ...WHATS_NEW_SLIDES.map((x) => x.icon),
    'play',
    'pause',
    'sparkles',
    'mouse-pointer-2',
    'arrow-left',
    'folder-open',
];

/** The guide on formulas, linked under the live chart. */
export const WHATS_NEW_CHART_GUIDE = 'notes-formulas';

