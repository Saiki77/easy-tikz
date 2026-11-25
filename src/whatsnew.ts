/*
 * The "What's new" popup: when to show it, what it says, its live charts
 * and its film. Pure (no 'obsidian' import), so tests/whatsnew.test.ts
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
import { guideById } from './guides';
import { parseChartText } from './text/parse';
import { printChartText } from './text/print';
import { NO_WORDS } from './text/words';
import type { Parameter } from './types';
import { MessageKey, t } from './i18n';

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

/** Slider `a` of the fractal slide: the real part of c in z^2 + c. */
export const WHATS_NEW_SLIDER: Readonly<Parameter> = { name: 'a', value: -0.8, min: -1, max: 1, step: 0.01 };

/**
 * The fractal slide: a Julia set, every point of the plane coloured by its
 * orbit under z^2 + c, with c = a + bi on two sliders. The GPU paints it,
 * so the sliders move it live. 16:9, as the stage of a slide.
 */
export const WHATS_NEW_CHART_TEXT = [
    'show x from -2.1 to 2.1 and y from -1.2 to 1.2',
    'size 16 x 9',
    'equal scale',
    `slider ${WHATS_NEW_SLIDER.name} from ${WHATS_NEW_SLIDER.min} to ${WHATS_NEW_SLIDER.max}, starting at ${WHATS_NEW_SLIDER.value}, in steps of ${WHATS_NEW_SLIDER.step}`,
    'slider b from -1 to 1, starting at 0.156, in steps of 0.002',
    'colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = x + iy$, $c = a + bi$, 200 steps',
].join('\n');

/** The chart that chart text describes, read in the built-in words (whatever words the reader set up for their own charts). */
export function whatsNewChartOf(text: string): Record<string, unknown> {
    return parseChartText(text, { words: NO_WORDS }).data;
}

/** The fractal slide's chart as data. A new copy every time: the popup moves its own. */
export function whatsNewChart(): Record<string, unknown> {
    return whatsNewChartOf(WHATS_NEW_CHART_TEXT);
}

// ---------------------------------------------------------------- content

export const WHATS_NEW_TITLE = 'Easy Graphs Charts and TikZ 6';

/** Fields that flow: the damped pendulum's field, 600 particles on the clock, and its rest points (stable spirals and saddles). */
export const WHATS_NEW_FLOW_CHART = [
    'size 16 x 9',
    'show x from -6.3 to 6.3 and y from -3.6 to 3.6',
    'draw the vector field $F(x, y) = (y, -\\sin x - 0.25y)$, coloured by length, with moving particles, 600 particles, trails 0.92',
    'mark the rest points of F',
].join('\n');

/**
 * Chaos in 3D: one path of the Lorenz system, coloured by time, that draws
 * itself while the chart turns (the lines of the Showcase page
 * lorenz-butterfly). It starts seen from the front, low, so the butterfly
 * faces the reader; the box is lower than a cube (x : y : z = 1 : 1 : 0.6),
 * so the turning chart fills more of a 16:9 stage.
 */
export const WHATS_NEW_CHAOS_CHART = [
    '3d',
    'turning',
    'show x from -25 to 25, y from -30 to 30 and z from 0 to 50',
    'size 16 x 9',
    'set rotationX = 12',
    'set rotationZ = 0',
    'box 1 x 1 x 0.6',
    'draw the solution of $\\dot{p} = (10(y - x), x(28 - z) - y, xy - \\frac{8}{3}z)$ through (1, 1, 1) for t from 0 to 40, coloured by time, traced',
].join('\n');

/** The Showcase page whose chart the machine learning slide shows: a network learns (src/guides/ml.ts), a Python script with frame(t). */
export const WHATS_NEW_ML_GUIDE = 'network-learns';

/** The chart of that page, as chart text (its script as it is written there). */
function mlChart(): string {
    const guide = guideById(WHATS_NEW_ML_GUIDE);
    return guide ? printChartText(guide.chart) : '';
}

/** Step by step: a matrix moves the plane. The grid, î, ĵ and the unit square; then A moves them; then its eigenvectors. */
export const WHATS_NEW_STEPS_CHART = [
    'show x from -5.4 to 5.4 and y from -3 to 3',
    'size 16 x 9',
    'equal scale',
    'let $A = \\begin{pmatrix} 1.5 & 1 \\\\ 0.5 & 2 \\end{pmatrix}$',
    'draw the grid',
    'draw the basis vectors',
    'shade the unit square, labelled',
    'then transform the plane by A',
    'then draw the eigenvectors of A, labelled',
].join('\n');

/** Ask your chart: two functions to click. The menu's questions come from src/notes6/ask.ts. */
export const WHATS_NEW_ASK_CHART = [
    'show x from -5 to 5 and y from -5 to 7',
    'size 16 x 9',
    'plot $g(x) = x^2 - 4$ in blue, thick',
    'plot $h(x) = 2 - x$ in red, thick',
].join('\n');

/**
 * The film of 6.0 on YouTube (2:21). The slide shows a poster that ships
 * with the plugin; only a click on Play puts the player there, so nothing
 * loads from the network before it. The player comes from
 * youtube-nocookie.com, which sets no cookies until the film plays.
 */
export const WHATS_NEW_FILM = {
    /** The player a click on Play puts in place of the poster. */
    embed: 'https://www.youtube-nocookie.com/embed/X--vCnK-u7Q?autoplay=1&rel=0&playsinline=1',
    /** The film's page, for the link "Open on YouTube" (opens the browser). */
    watch: 'https://www.youtube.com/watch?v=X--vCnK-u7Q',
    /** How long it is, as the poster and the header button say it. */
    length: '2:21',
} as const;

/** The changelog on GitHub (the film slide's button "Changelog" opens it in the browser). */
export const WHATS_NEW_CHANGELOG = 'https://github.com/Saiki77/easy-tikz/blob/main/CHANGELOG.md';

/** What a slide of the popup shows (src/ui/whatsNewModal.ts draws each). */
export type WhatsNewSlideId = 'flow' | 'chaos' | 'ml' | 'steps' | 'fractal' | 'ask' | 'film';

/** One slide of the popup: a feature of 6.0, its live chart filling a 16:9 stage, then a label, a title and one line. */
export interface WhatsNewSlide {
    id: WhatsNewSlideId;
    /** The small accent line over the title: what moves, or what to do. Empty on the film slide. In the reader's language. */
    readonly label: string;
    /** In the reader's language. */
    readonly title: string;
    /** One line in the reader's language. */
    readonly text: string;
    /** Its live chart, as chart text in the built-in words; none on the film slide. */
    chart?: string;
    /** Slider rows under its live chart (default 1). */
    sliders?: number;
}

/**
 * A slide whose words are read in the reader's language each time they are
 * shown: the language is set after this module loads, and the tests read
 * them in English.
 */
function slide(id: WhatsNewSlideId, label: MessageKey | null, title: MessageKey, text: MessageKey, chart?: string, sliders?: number): WhatsNewSlide {
    const out: WhatsNewSlide = {
        id,
        get label() {
            return label ? t(label) : '';
        },
        get title() {
            return t(title);
        },
        get text() {
            return t(text);
        },
    };
    if (chart) out.chart = chart;
    if (sliders) out.sliders = sliders;
    return out;
}

/**
 * The slides, in order: fields that flow, chaos in 3D, machine learning,
 * steps, fractals, asking a chart, and the film. Back, Next, the dots and
 * the arrow keys move between them; the header's "Watch the film" jumps to
 * the last.
 */
export const WHATS_NEW_SLIDES: WhatsNewSlide[] = [
    slide('flow', 'panels.whatsNew.flow.label', 'panels.whatsNew.flow.title', 'panels.whatsNew.flow.text', WHATS_NEW_FLOW_CHART),
    slide('chaos', 'panels.whatsNew.chaos.label', 'panels.whatsNew.chaos.title', 'panels.whatsNew.chaos.text', WHATS_NEW_CHAOS_CHART),
    slide('ml', 'panels.whatsNew.ml.label', 'panels.whatsNew.ml.title', 'panels.whatsNew.ml.text', mlChart()),
    slide('steps', 'panels.whatsNew.steps.label', 'panels.whatsNew.steps.title', 'panels.whatsNew.steps.text', WHATS_NEW_STEPS_CHART),
    slide('fractal', 'panels.whatsNew.fractal.label', 'panels.whatsNew.fractal.title', 'panels.whatsNew.fractal.text', WHATS_NEW_CHART_TEXT, 2),
    slide('ask', 'panels.whatsNew.ask.label', 'panels.whatsNew.ask.title', 'panels.whatsNew.ask.text', WHATS_NEW_ASK_CHART),
    slide('film', null, 'panels.whatsNew.film.title', 'panels.whatsNew.film.text'),
];

/** The index of the film slide (the header's button jumps there). */
export const WHATS_NEW_FILM_SLIDE = WHATS_NEW_SLIDES.findIndex((x) => x.id === 'film');

/** Every icon the popup uses (its buttons, the player, and the Help tab link that opens it). */
export const WHATS_NEW_ICONS: readonly string[] = ['play', 'pause', 'arrow-left', 'book-open', 'external-link', 'sparkles'];
