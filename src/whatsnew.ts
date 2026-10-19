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

/** Version of the popup's content. Raise it when the popup says something new. */
export const WHATS_NEW_VERSION = '4.6.0';

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

export const WHATS_NEW_TITLE = 'Easy TikZ 4';
export const WHATS_NEW_SUBTITLE = 'Write a chart in plain words, or in your own, and watch it draw under the block as you type.';

/** The heading of the newest items, at the top. */
export const WHATS_NEW_RECENT_TITLE = 'New in 4.5 and 4.6';

/** New in 4.5 and 4.6, at the top. */
export const WHATS_NEW_RECENT: WhatsNewItem[] = [
    {
        icon: 'languages',
        title: 'Your own chart words',
        text: 'Give any piece of the chart language your own words, in your language or your own terms. Settings, Chart words.',
    },
    {
        icon: 'type',
        title: 'Charts in plain words',
        text: 'One line per object: `plot f(x) = x^2 in blue`. The editor writes these lines too, and keeps your other lines and comments.',
    },
    {
        icon: 'eye',
        title: 'The chart under the block',
        text: 'While you edit a block in Live Preview, its chart sits right under it and changes as you type.',
    },
    {
        icon: 'smartphone',
        title: 'On phones and tablets',
        text: "Charts draw in your notes on iOS and Android, and take your theme's colours in light and dark mode.",
    },
];

/** Next to the live chart: sliders and the values computed from them. */
export const WHATS_NEW_LIVE: WhatsNewItem[] = [
    {
        icon: 'sliders-horizontal',
        title: 'Live sliders',
        text: 'Any number can be a slider: in formulas, conditions, labels and axis ranges. Drag it or press play, and the picture moves along.',
        guide: 'sliders',
    },
    {
        icon: 'calculator',
        title: 'Live calculations',
        text: 'Computed points publish values like `P1_x` and `P1_val`. Use them in other formulas, or print them in labels: `{P1_val:2}`.',
        guide: 'computed-values',
    },
    {
        icon: 'file-text',
        title: 'Sliders in your notes',
        text: 'Charts in notes keep working sliders. Moving them never changes the note.',
        guide: 'charts-in-notes',
    },
];

/** The rest of version 4, one line each. */
export const WHATS_NEW_MORE: WhatsNewItem[] = [
    {
        icon: 'layout-panel-left',
        title: 'A redesigned editor',
        text: 'Five tabs, one card per object, and a preview that follows as you type.',
    },
    {
        icon: 'move',
        title: 'Drag to edit',
        text: 'Drag a line or a point and its formula follows. Shift turns or stretches.',
    },
    {
        icon: 'shapes',
        title: 'Five general tools, not eleven',
        text: 'Regions from inequalities, curves from equations, points (intersections, corners, the optimum), segments, 3D planes.',
    },
    {
        icon: 'file-code',
        title: 'Export to LaTeX that compiles',
        text: 'A standalone document by default, in the colours and layers of the preview.',
    },
    {
        icon: 'book-open',
        title: 'Guides in the Help tab',
        // The count comes from the guide list, so a new guide never leaves this line behind.
        text: `${GUIDES.length} step-by-step guides with live charts, and a reference you can search.`,
    },
    {
        icon: 'history',
        title: 'Charts from 3.x carry over',
        text: 'They are converted when they open. The note changes only when you save.',
    },
];

/** The live chart as its block writes it: what you type, line by line (src/text). */
export function whatsNewText(): string {
    return printChartText(whatsNewChart());
}

/** New in 4.3: AI makes charts. Its button opens the editor's AI tab. */
export const WHATS_NEW_AI: WhatsNewItem = {
    icon: 'bot',
    title: 'Let AI make your charts',
    text: 'Claude Code, Codex, Cursor and other AI apps check charts and add them to your notes. ChatGPT gets a guide to paste.',
};

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
