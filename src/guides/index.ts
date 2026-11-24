/*
 * Guides: the list the Help tab (src/ui/helpPanel.ts) and
 * scripts/media/build-guides.mjs read, plus the small pure helpers both
 * share: category order, level names, the chart a step shows, the GitHub
 * link of a guide and the search. No DOM, no Obsidian.
 *
 * The data is English and stays English (the GitHub pages and the AI tools
 * read GUIDES). The Help tab shows a guide through localGuide (src/guides/ja.ts)
 * and its category and level through guideCategoryLabel / guideLevelLabel,
 * which keep the English names as identifiers.
 */
import { MessageKey, t, tIn } from '../i18n';
import { ChartData, Guide, GuideCategory, GuideLevel } from './types';
import { START_GUIDES } from './start';
import { LANGUAGE_GUIDES } from './language';
import { SHOWCASE_GUIDES } from './showcase';
import { PYTHON_GUIDES } from './python'; // 6.0 P
import { FUNCTIONS_GUIDES } from './functions';
import { CALCULUS_GUIDES } from './calculus';
import { OPTIMISATION_GUIDES } from './optimisation';
import { DATA_GUIDES } from './data';
import { SHAPES_GUIDES } from './shapes';
import { SPACE_GUIDES } from './space';
import { NOTES_GUIDES } from './notes';
import { REFERENCE_GUIDES } from './reference';
// 6.0 F2: the guides of version 6 (each file holds guides of several categories; GUIDES sorts them)
import { VALUES_GUIDES } from './values';
import { INTERACT_GUIDES } from './interact';
import { LINEAR_GUIDES } from './linear';
import { DYNAMICS_GUIDES } from './dynamics';
// 6.0 G
import { GEOGEBRA_GUIDES } from './geogebra';
import { localGuide } from './ja';

/** Categories in display order (the order of the GuideCategory union). */
export const GUIDE_CATEGORIES: readonly GuideCategory[] = [
    'Getting started',
    'Chart language',
    'Showcase',
    'Functions and sliders',
    'Calculus',
    'Regions and optimisation',
    // 6.0 F2
    'Linear algebra and complex numbers',
    'Dynamics and fractals',
    'Data and probability',
    'Points, lines and labels',
    '3D',
    'Notes and export',
    'Reference',
];

/** The key of each category's name (the categories themselves are identifiers). */
const CATEGORY_KEYS: Readonly<Record<GuideCategory, MessageKey>> = {
    'Getting started': 'help.category.gettingStarted',
    'Chart language': 'help.category.chartLanguage',
    Showcase: 'help.category.showcase',
    'Functions and sliders': 'help.category.functionsSliders',
    Calculus: 'help.category.calculus',
    'Regions and optimisation': 'help.category.regionsOptimisation',
    // 6.0 F2
    'Linear algebra and complex numbers': 'help.category.linearComplex',
    'Dynamics and fractals': 'help.category.dynamicsFractals',
    'Data and probability': 'help.category.dataProbability',
    'Points, lines and labels': 'help.category.pointsLinesLabels',
    '3D': 'help.category.threeD',
    'Notes and export': 'help.category.notesExport',
    Reference: 'help.category.reference',
};

/** The key of each level's name. */
const LEVEL_KEYS: Readonly<Record<GuideLevel, MessageKey>> = {
    start: 'help.level.start',
    core: 'help.level.core',
    advanced: 'help.level.advanced',
};

/** Level names in English, as the guide pages on GitHub show them (the Help tab uses guideLevelLabel). */
export const GUIDE_LEVEL_LABELS: Readonly<Record<GuideLevel, string>> = {
    start: tIn('en', LEVEL_KEYS.start),
    core: tIn('en', LEVEL_KEYS.core),
    advanced: tIn('en', LEVEL_KEYS.advanced),
};

/** The name of a category in the reader's language; an unknown one as it is. */
export function guideCategoryLabel(category: GuideCategory): string {
    const key = CATEGORY_KEYS[category];
    return key ? t(key) : String(category);
}

/** The name of a level in the reader's language; an unknown one as it is. */
export function guideLevelLabel(level: GuideLevel): string {
    const key = LEVEL_KEYS[level];
    return key ? t(key) : String(level);
}

/** Position of a category in the display order; unknown categories sort last. */
function categoryRank(category: string): number {
    const at = (GUIDE_CATEGORIES as readonly string[]).indexOf(category);
    return at < 0 ? GUIDE_CATEGORIES.length : at;
}

/**
 * Every guide, in display order: by category (GUIDE_CATEGORIES), and inside
 * a category in the order the data files list them.
 */
export const GUIDES: Guide[] = [
    ...START_GUIDES,
    ...LANGUAGE_GUIDES,
    ...SHOWCASE_GUIDES,
    ...FUNCTIONS_GUIDES,
    ...CALCULUS_GUIDES,
    ...OPTIMISATION_GUIDES,
    ...DATA_GUIDES,
    ...SHAPES_GUIDES,
    ...SPACE_GUIDES,
    ...NOTES_GUIDES,
    ...REFERENCE_GUIDES,
    // 6.0 F2
    ...VALUES_GUIDES,
    ...INTERACT_GUIDES,
    ...LINEAR_GUIDES,
    ...DYNAMICS_GUIDES,
    ...GEOGEBRA_GUIDES, // 6.0 G
    ...PYTHON_GUIDES, // 6.0 P
]
    .map((guide, index) => ({ guide, index }))
    .sort((a, b) => categoryRank(a.guide.category) - categoryRank(b.guide.category) || a.index - b.index)
    .map((entry) => entry.guide);

export function guideById(id: string): Guide | undefined {
    return GUIDES.find((g) => g.id === id);
}

export { localGuide };
// 6.0 F2: one example for each main new line (the editor and the AI tools list them)
export { V6_EXAMPLES } from './examples';

/**
 * The finished charts of the Showcase guides as examples for the editor
 * (5.2): the empty Build tab and the editor's menu offer them, with the
 * guide's title and summary in the reader's language.
 */
export function showcaseExamples(): Array<{ id: string; title: string; description: string; is3D: boolean; data: ChartData }> {
    return guidesIn('Showcase')
        .map(localGuide)
        .map((g) => ({ id: `showcase-${g.id}`, title: g.title, description: g.summary, is3D: g.chart.dimension === true, data: g.chart }));
}

/** Every guide in the reader's language, in display order (see localGuide). */
export function localGuides(): Guide[] {
    return GUIDES.map(localGuide);
}

/** A guide by id in the reader's language. */
export function localGuideById(id: string): Guide | undefined {
    const guide = guideById(id);
    return guide ? localGuide(guide) : undefined;
}

/** The guides of one category, in display order. */
export function guidesIn(category: GuideCategory, guides: readonly Guide[] = GUIDES): Guide[] {
    return guides.filter((g) => g.category === category);
}

/** Folder of the generated guide pages on GitHub. */
export const GUIDES_URL = 'https://github.com/Saiki77/easy-tikz/blob/main/docs/guides';

/** The page of a guide on GitHub (the same steps with screenshots). */
export function guideUrl(id: string): string {
    return `${GUIDES_URL}/${encodeURIComponent(id)}.md`;
}

/**
 * The chart a step shows: its own, otherwise the chart of the nearest
 * earlier step that has one. Null while no step so far has a chart.
 */
export function stepChart(guide: Guide, index: number): ChartData | null {
    const steps = Array.isArray(guide.steps) ? guide.steps : [];
    for (let i = Math.min(index, steps.length - 1); i >= 0; i--) {
        const chart = steps[i] && steps[i].chart;
        if (chart) return chart;
    }
    return null;
}

// ------------------------------------------------------------------ search

/**
 * Lower case, with the spelling differences people type folded away
 * ("optimization" finds "optimisation", "color" finds "colour"). Applied to
 * the query and to the searched text alike.
 */
export function searchText(text: string): string {
    return String(text ?? '')
        // Full-width letters, digits and spaces (as a Japanese input method types them) count as the plain ones.
        .normalize('NFKC')
        .toLowerCase()
        .replace(/z/g, 's')
        .replace(/colour/g, 'color');
}

/** The words of a query (at most 8), normalised with searchText. */
export function searchTokens(query: string): string[] {
    return searchText(query)
        .split(/\s+/)
        .filter((t) => t.length > 0)
        .slice(0, 8);
}

/** What a match inside a word counts, relative to one at the start of a word. */
const INSIDE_WORD = 0.3;
/** Queries up to this length must start a word: "ax" is not found in "relaxation". */
const SHORT_TOKEN = 2;

/**
 * How well `token` occurs in `text` (both normalised with searchText): 1 at
 * the start of a word ("region" in "regions", "val" in "P1_val"),
 * INSIDE_WORD inside one ("gram" in "program"; never for a token of one or
 * two characters), 0 when it is missing.
 */
export function searchMatch(text: string, token: string): number {
    if (!token) return 0;
    let inside = false;
    for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + 1)) {
        if (at === 0 || !/[a-z0-9]/.test(text[at - 1])) return 1;
        inside = true;
    }
    return inside && token.length > SHORT_TOKEN ? INSIDE_WORD : 0;
}

/**
 * Score of `tokens` against weighted text fields: every token must occur in
 * at least one field (otherwise 0) and counts with the weight of the best
 * field that contains it. A token that only occurs inside a word counts
 * less than one that starts a word (see searchMatch).
 */
export function searchScore(tokens: readonly string[], fields: ReadonlyArray<readonly [string, number]>): number {
    if (!tokens.length) return 0;
    const texts = fields.map(([text, weight]) => [searchText(text), weight] as const);
    let score = 0;
    for (const token of tokens) {
        let best = 0;
        for (const [text, weight] of texts) {
            if (weight <= best) continue;
            const value = weight * searchMatch(text, token);
            if (value > best) best = value;
        }
        if (best === 0) return 0;
        score += best;
    }
    return score;
}

export interface GuideHit {
    guide: Guide;
    score: number;
    /**
     * Index of the first step that contains a search word, when the title,
     * summary and outcomes alone do not contain every word. Null otherwise.
     */
    step: number | null;
}

function stepText(step: Guide['steps'][number]): string {
    const typed = (step.type || []).map((row) => `${row.where} ${row.text}`).join(' ');
    return `${step.title} ${step.body} ${typed} ${step.tip || ''}`;
}

/**
 * Guides that contain every word of `query`, best first (title matches
 * before summary and outcomes, those before step text); ties keep the
 * display order. An empty query gives no hits. The Help tab searches
 * localGuides(), so a reader finds the words the guides show.
 */
export function searchGuides(query: string, guides: readonly Guide[] = GUIDES): GuideHit[] {
    const tokens = searchTokens(query);
    if (!tokens.length) return [];
    const hits: Array<GuideHit & { index: number }> = [];
    guides.forEach((guide, index) => {
        const head: Array<[string, number]> = [
            [guide.title, 10],
            [guide.summary, 5],
            [guideCategoryLabel(guide.category), 3],
            [(guide.outcomes || []).join(' '), 3],
        ];
        const steps = guide.steps || [];
        const fields = head.concat(
            steps.map((s): [string, number] => [s.title, 3]),
            steps.map((s): [string, number] => [(s.type || []).map((row) => `${row.where} ${row.text}`).join(' '), 2]),
            steps.map((s): [string, number] => [`${s.body} ${s.tip || ''}`, 1])
        );
        const score = searchScore(tokens, fields);
        if (score <= 0) return;
        let step: number | null = null;
        if (searchScore(tokens, head) <= 0) {
            // The words the head does not have are the ones a step was found for.
            const headText = searchText(head.map(([text]) => text).join(' '));
            const missing = tokens.filter((t) => searchMatch(headText, t) === 0);
            const at = steps.findIndex((s) => {
                const text = searchText(stepText(s));
                return missing.some((t) => searchMatch(text, t) > 0);
            });
            step = at >= 0 ? at : null;
        }
        hits.push({ guide, score, step, index });
    });
    hits.sort((a, b) => b.score - a.score || a.index - b.index);
    return hits.map(({ guide, score, step }) => ({ guide, score, step }));
}

export * from './types';
