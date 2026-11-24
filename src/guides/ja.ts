/*
 * The guides of the Help tab in Japanese: an overlay of the English guides
 * (src/guides/*.ts), keyed by guide id, with everything a reader reads and
 * nothing else. Charts, screenshots, ids, links and the texts to type (chart
 * code) stay the English guide's; a step keeps the order and the count of
 * the English one, its type rows give only `where`.
 *
 * localGuide puts these texts over an English guide while the interface is
 * Japanese. The guide pages on GitHub (scripts/media/build-guides.mjs) and
 * the AI tools read GUIDES, which stays English.
 *
 * tests/guides-ja.test.ts checks that every guide is here with the counts of
 * the English, that every inline code span of a body or tip is kept, in
 * order, and the spacing and punctuation of the Japanese style
 * (src/i18n/README.md). UI names are the labels of the Japanese interface.
 */
import { language } from '../i18n';
import type { Guide, GuideStep } from './types';
import { START_JA } from './start.ja';
import { LANGUAGE_JA } from './language.ja';
import { SHOWCASE_JA } from './showcase.ja';
import { FUNCTIONS_JA } from './functions.ja';
import { CALCULUS_JA } from './calculus.ja';
import { OPTIMISATION_JA } from './optimisation.ja';
import { DATA_JA } from './data.ja';
import { SHAPES_JA } from './shapes.ja';
import { SPACE_JA } from './space.ja';
import { NOTES_JA } from './notes.ja';
import { REFERENCE_JA } from './reference.ja';
// 6.0 F2
import { VALUES_JA } from './values.ja';
import { INTERACT_JA } from './interact.ja';
import { LINEAR_JA } from './linear.ja';
import { DYNAMICS_JA } from './dynamics.ja';
// 6.0 G
import { GEOGEBRA_JA } from './geogebra.ja';
import { PYTHON_JA } from './python.ja'; // 6.0 P

/** The Japanese texts of one guide. */
export interface GuideText {
    title: string;
    summary: string;
    /** One per English outcome, in order. */
    outcomes: string[];
    /** One per English step, in order. */
    steps: StepText[];
}

export interface StepText {
    title: string;
    /** Paragraphs and '- ' lists like the English body, with the same code spans in the same order. */
    body: string;
    /** The `where` of each type row, in order; the `text` to type is chart code and stays as it is. */
    where?: string[];
    /** Exactly when the English step has a tip. */
    tip?: string;
}

/** Every guide, in the order of GUIDES. */

const merged = new WeakMap<Guide, Guide>();

/**
 * A guide in the reader's language: in Japanese the texts above over the
 * English guide (the same object for the same guide each time), otherwise
 * the English guide itself.
 */
/** Every guide in Japanese: each group's file over the old texts. */
export const JA_GUIDES: Readonly<Record<string, GuideText>> = {
    ...START_JA,
    ...LANGUAGE_JA,
    ...SHOWCASE_JA,
    ...FUNCTIONS_JA,
    ...CALCULUS_JA,
    ...OPTIMISATION_JA,
    ...DATA_JA,
    ...SHAPES_JA,
    ...SPACE_JA,
    ...NOTES_JA,
    ...REFERENCE_JA,
    // 6.0 F2
    ...VALUES_JA,
    ...INTERACT_JA,
    ...LINEAR_JA,
    ...DYNAMICS_JA,
    ...GEOGEBRA_JA, // 6.0 G
    ...PYTHON_JA, // 6.0 P
};

export function localGuide(guide: Guide): Guide {
    if (language() !== 'ja') return guide;
    const text = Object.prototype.hasOwnProperty.call(JA_GUIDES, guide.id) ? JA_GUIDES[guide.id] : undefined;
    if (!text) return guide;
    let out = merged.get(guide);
    if (!out) {
        out = overlayGuide(guide, text);
        merged.set(guide, out);
    }
    return out;
}

/** `guide` with `text` over it. A text the overlay lacks keeps its English; charts, shots and the texts to type are the English guide's. */
export function overlayGuide(guide: Guide, text: GuideText): Guide {
    return {
        ...guide,
        title: text.title,
        summary: text.summary,
        outcomes: (guide.outcomes || []).map((outcome, i) => text.outcomes[i] ?? outcome),
        steps: (guide.steps || []).map((step, i) => overlayStep(step, text.steps[i])),
    };
}

function overlayStep(step: GuideStep, text: StepText | undefined): GuideStep {
    if (!text) return step;
    const out: GuideStep = { ...step, title: text.title, body: text.body };
    if (step.tip !== undefined) out.tip = text.tip ?? step.tip;
    if (step.type) out.type = step.type.map((row, j) => ({ where: (text.where && text.where[j]) || row.where, text: row.text }));
    return out;
}
