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
import { defaultFunction, defaultTool, EXAMPLES } from './migrate';
import { printChartText } from './text/print';
import type { FunctionParameters, Parameter, RegionTool } from './types';
import { MessageKey, MessageValues, t, tIn } from './i18n';

/** Version of the popup's content. Raise it when the popup says something new. */
export const WHATS_NEW_VERSION = '4.8.0';

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
 * that Easy TikZ was used before (see shouldShowWhatsNew).
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

export const WHATS_NEW_TITLE = 'Easy TikZ 4';

/** The line under the title, in the reader's language. */
export const whatsNewSubtitle = (): string => t('panels.whatsNew.subtitle');
/** The same line in English, as the tests read it. */
export const WHATS_NEW_SUBTITLE = tIn('en', 'panels.whatsNew.subtitle');

/** The heading of the newest items, at the top, in the reader's language. */
export const whatsNewRecentTitle = (): string => t('panels.whatsNew.recentTitle');
/** The same heading in English, as the tests read it. */
export const WHATS_NEW_RECENT_TITLE = tIn('en', 'panels.whatsNew.recentTitle');

/** New in 4.7 and 4.8, at the top. */
export const WHATS_NEW_RECENT: WhatsNewItem[] = [
    item('palette', 'panels.whatsNew.colormaps.title', 'panels.whatsNew.colormaps.text'),
    item('maximize-2', 'panels.whatsNew.fit.title', 'panels.whatsNew.fit.text'),
    item('box', 'panels.whatsNew.cube.title', 'panels.whatsNew.cube.text'),
    item('globe', 'panels.whatsNew.language.title', 'panels.whatsNew.language.text'),
];

/** Next to the live chart: sliders and the values computed from them. */
export const WHATS_NEW_LIVE: WhatsNewItem[] = [
    item('sliders-horizontal', 'panels.whatsNew.sliders.title', 'panels.whatsNew.sliders.text', 'sliders'),
    item('calculator', 'panels.whatsNew.calculations.title', 'panels.whatsNew.calculations.text', 'computed-values'),
    item('file-text', 'panels.whatsNew.notes.title', 'panels.whatsNew.notes.text', 'charts-in-notes'),
];

/** The rest of version 4, one line each. */
export const WHATS_NEW_MORE: WhatsNewItem[] = [
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

/** New in 4.3: AI makes charts. Its button opens the editor's AI tab. */
export const WHATS_NEW_AI: WhatsNewItem = item('bot', 'panels.whatsNew.ai.title', 'panels.whatsNew.ai.text');

/** Every icon the popup uses (its items, buttons and the Help tab link). */
export const WHATS_NEW_ICONS: readonly string[] = [
    ...WHATS_NEW_RECENT.map((i) => i.icon),
    ...WHATS_NEW_LIVE.map((i) => i.icon),
    WHATS_NEW_AI.icon,
    ...WHATS_NEW_MORE.map((i) => i.icon),
    'play',
    'pause',
    'sparkles',
];

/** The guide the live chart comes from. */
export const WHATS_NEW_CHART_GUIDE = 'tangent-area';

// ------------------------------------------------------------------ chart

/** Slider `a` of the live chart: inside this range the shaded area stays inside the view. */
export const WHATS_NEW_SLIDER: Readonly<Parameter> = { name: 'a', value: 0.8, min: -1.1, max: 1.1, step: 0.05 };

/** The exact area between x^3 - 3x and its tangent at a (see whatsNewChart). */
export const AREA_FORMULA = '27a^4/4';
/** Label of the shaded area: its size, recalculated with every value of a. */
export const AREA_LABEL = `A = {${AREA_FORMULA}:2}`;

/**
 * The live chart of the popup: the Tangent explorer example (x^3 - 3x with
 * its tangent at the slider a and the slope as the title) plus the area
 * between the curve and the tangent, shaded and labelled with its size.
 *
 * The tangent is written out as the hidden function f2, because a region
 * can only use named functions (the curve's own tangent line draws it).
 * Curve minus tangent is (x - a)^2 (x + 2a): the tangent touches at a and
 * crosses again at -2a, so the area lies between those two, whichever is
 * further left, and is the integral of |(x - a)^2 (x + 2a)| from -2a to a,
 * which is 27a^4/4. It vanishes at a = 0 and changes sides with the sign
 * of a. For |a| <= 1.1 the crossing at -2a stays above y = -4.1 and the
 * view runs down to -4.5, so the shading stays inside the picture.
 */
export function whatsNewChart(): Record<string, unknown> {
    const example = EXAMPLES.find((e) => e.id === 'tangent');
    if (!example) throw new Error('The Tangent explorer example is missing');
    const chart = JSON.parse(JSON.stringify(example.data)) as Record<string, unknown>;
    const functions = (Array.isArray(chart.functions) ? chart.functions : []) as FunctionParameters[];
    const tangent: FunctionParameters = {
        ...defaultFunction(functions.map((f) => f.name || '')),
        name: 'f2',
        expression: 'f1(a) + (3a^2 - 3)(x - a)',
        color: 'blue',
        hidden: true,
    };
    const area: RegionTool = {
        ...(defaultTool('region', { is3D: false, tools: [], functions: [] }) as RegionTool),
        id: 't0',
        name: 'R1',
        color: 'orange',
        fillOpacity: 0.35,
        conditions: ['min(f1, f2) <= y <= max(f1, f2)', 'min(a, -2a) <= x <= max(a, -2a)'],
        conditionLabels: ['', ''],
        label: AREA_LABEL,
    };
    return {
        ...chart,
        ymin: '-4.5',
        ymax: '4.5',
        // A larger paper than the example's 10 x 8 cm: the same text then takes less of the picture.
        size_x_cm: 12,
        size_y_cm: 9.6,
        parameters: [{ ...WHATS_NEW_SLIDER }],
        functions: [...functions, tangent],
        tools: [area],
    };
}
