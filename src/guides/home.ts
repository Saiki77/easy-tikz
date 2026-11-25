/*
 * 6.0: how the Help home (src/ui/helpPanel.ts) groups the guides. From the
 * top: Start here (Getting started), the language tour, a row "New in 6"
 * with four Showcase pages of version 6, topic sections (each a few
 * categories, and a few guides placed by id), and the Reference at the end.
 *
 * The guides keep their categories: docs/guides and the AI tools read those.
 * Only the home groups them this way. Pure: no DOM, no Obsidian.
 */
import type { MessageKey } from '../i18n';
import type { ChartData, Guide, GuideCategory } from './types';
import { GUIDES, stepChart } from './index';

/** The guide of the language tour: the home shows it as a card of its own. */
export const TOUR_ID = 'chart-language';

/**
 * The row "New in 6": the Showcase pages of version 6 that show most, as
 * large tiles. `step` (0-based) picks the chart of a step as the picture:
 * the coloured plane of z² for the complex functions, whose finished chart
 * is a grid.
 */
export const NEW_IN_6: ReadonlyArray<{ id: string; step?: number }> = [
    { id: 'lorenz-butterfly' },
    { id: 'complex-two-ways', step: 1 },
    { id: 'fourier-circles' },
    { id: 'mandelbrot-orbit' },
];

const NEW_IDS: ReadonlySet<string> = new Set(NEW_IN_6.map((n) => n.id));

/** Tiles a section shows before its "Show all" button. */
export const SECTION_FIRST = 4;

export type HomeSectionId = 'basics' | 'showcase' | 'calculus' | 'regions' | 'linear' | 'dynamics' | 'scripting' | 'space' | 'notes';

interface SectionRule {
    id: HomeSectionId;
    title: MessageKey;
    about: MessageKey;
    /** The categories whose guides the section shows. */
    categories: GuideCategory[];
    /** Guides of other sections it shows as well, after its own (the 3D section: the guides whose chart is 3D). */
    also?: (guide: Guide) => boolean;
}

/** Topic sections in display order. */
const RULES: readonly SectionRule[] = [
    { id: 'basics', title: 'help.home.section.basics', about: 'help.home.about.basics', categories: ['Chart language', 'Points, lines and labels'] },
    { id: 'showcase', title: 'help.category.showcase', about: 'help.home.about.showcase', categories: ['Showcase'] },
    { id: 'calculus', title: 'help.home.section.calculus', about: 'help.home.about.calculus', categories: ['Functions and sliders', 'Calculus'] },
    { id: 'regions', title: 'help.home.section.regions', about: 'help.home.about.regions', categories: ['Regions and optimisation', 'Data and probability'] },
    { id: 'linear', title: 'help.category.linearComplex', about: 'help.home.about.linear', categories: ['Linear algebra and complex numbers'] },
    { id: 'dynamics', title: 'help.category.dynamicsFractals', about: 'help.home.about.dynamics', categories: ['Dynamics and fractals'] },
    { id: 'scripting', title: 'help.home.section.scripting', about: 'help.home.about.scripting', categories: [] },
    { id: 'space', title: 'help.category.threeD', about: 'help.home.about.space', categories: ['3D'], also: (g) => g.chart.dimension === true },
    { id: 'notes', title: 'help.home.section.notes', about: 'help.home.about.notes', categories: ['Notes and export'] },
];

/**
 * Guides the home shows in another section than their category's, in this
 * order before the section's own: the let values with linear algebra, and
 * every guide of Python and GeoGebra (Chart language, Showcase) in Scripting.
 */
const PLACED: ReadonlyArray<readonly [string, HomeSectionId]> = [
    ['values-let', 'linear'],
    ['python-chart', 'scripting'],
    ['geogebra-commands', 'scripting'],
    ['python-heart', 'scripting'],
    ['python-plot', 'scripting'],
    ['python-wave', 'scripting'],
];

/** Categories the home shows above the sections (Start here) or below them (Reference). */
const OUTSIDE: ReadonlySet<GuideCategory> = new Set<GuideCategory>(['Getting started', 'Reference']);

export interface HomeSection {
    id: HomeSectionId;
    /** Keys of the heading and of the one line under it. */
    title: MessageKey;
    about: MessageKey;
    /** Its guides in display order: the first SECTION_FIRST show, the rest behind "Show all". */
    guides: Guide[];
}

/** The section a guide's own place is in, or null for Start here, the tour, New in 6 and the Reference. */
function homeOf(guide: Guide): HomeSectionId | null {
    if (guide.id === TOUR_ID || NEW_IDS.has(guide.id) || OUTSIDE.has(guide.category)) return null;
    const placed = PLACED.find(([id]) => id === guide.id);
    if (placed) return placed[1];
    const rule = RULES.find((r) => r.categories.includes(guide.category));
    return rule ? rule.id : null;
}

/**
 * The topic sections of the home, from `guides` (in display order; the Help
 * passes them in the reader's language). Every guide but those of Start
 * here, the tour, New in 6 and the Reference is in exactly one section as
 * its own; the 3D section shows the 3D guides of the others as well.
 */
export function homeSections(guides: readonly Guide[] = GUIDES): HomeSection[] {
    return RULES.map((rule) => {
        const placed = PLACED.filter(([, at]) => at === rule.id)
            .map(([id]) => guides.find((g) => g.id === id))
            .filter((g): g is Guide => !!g && homeOf(g) === rule.id);
        const own = guides.filter((g) => homeOf(g) === rule.id && !placed.includes(g));
        // Not the pages of New in 6 again: they are just above.
        const also = rule.also ? guides.filter((g) => rule.also?.(g) && homeOf(g) !== rule.id && homeOf(g) !== null) : [];
        return { id: rule.id, title: rule.title, about: rule.about, guides: [...placed, ...own, ...also] };
    }).filter((s) => s.guides.length > 0);
}

/** The guides of the row "New in 6" in its order, each with the chart its tile shows (from `guides`, as homeSections). */
export function newInSix(guides: readonly Guide[] = GUIDES): Array<{ guide: Guide; chart: ChartData }> {
    const out: Array<{ guide: Guide; chart: ChartData }> = [];
    for (const { id, step } of NEW_IN_6) {
        const guide = guides.find((g) => g.id === id);
        if (!guide) continue;
        out.push({ guide, chart: (step !== undefined ? stepChart(guide, step) : null) ?? guide.chart });
    }
    return out;
}
