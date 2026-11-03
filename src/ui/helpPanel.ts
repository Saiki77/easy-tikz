/*
 * Help tab: guides and the reference.
 *
 * Home is a search field and the guides (src/guides) as cards grouped by
 * category, each with a live thumbnail drawn by the plugin's own renderer.
 * A card opens the guide in the reader: outcomes, then every step on one
 * scrolling page with its copyable "type" rows, a live chart and "Open this
 * step in the editor" (host.loadChart, which asks before replacing a
 * non-empty chart). The reference is the last category: its sections are
 * data (makeSections below) rendered by a few small block types, with live
 * "Open example" buttons that load an entry of EXAMPLES (src/migrate.ts).
 *
 * Every text is in the reader's language (src/i18n, keys help.*): the guides
 * through localGuide (src/guides/ja.ts), their categories and levels through
 * guideCategoryLabel / guideLevelLabel, the reference through t(). Code,
 * formulas, chart lines and key names stay as they are.
 *
 * Inline `backticks` in any text become <code>, **bold** runs <strong>.
 * Charts are drawn lazily, when their fixed-aspect box scrolls into view,
 * so nothing shifts when they appear. Everything here describes v4
 * behaviour; keep the reference in sync with mathcontext.ts, migrate.ts
 * recipes and the editor panels when they change.
 */
import { Notice, Platform, setIcon } from 'obsidian';
import { ChartExample, EXAMPLES } from '../migrate';
import {
    ChartData,
    GUIDE_CATEGORIES,
    Guide,
    GuideStep,
    guideCategoryLabel,
    guideLevelLabel,
    guideUrl,
    guidesIn,
    localGuide,
    localGuideById,
    localGuides,
    searchGuides,
    searchScore,
    searchTokens,
    stepChart,
} from '../guides';
import { Language, language, t } from '../i18n';
import { MATH_REDRAW_LIMIT } from '../mathlabel';
import { SVGRenderer } from '../renderer';
import { SVG3DRenderer } from '../renderer3d';
import { SettingsManager } from '../settings';
import { cloneData, fitPixelScale } from '../util';
import { PanelHost } from './host';
import { iconButton, textButton, trapEscape, uniqueId, visuallyHidden } from './kit';

type Block =
    /** Paragraph. */
    | string
    /** Code sample: one entry per line; `[code, comment]` pairs are aligned in two columns. */
    | { code: (string | [string, string])[] }
    /** Bullet list. */
    | { list: string[] }
    /** Term / description pairs (terms are shown as code). */
    | { terms: [string, string][] }
    /** Keyboard shortcuts: alternatives separated by ' / ', keys of a combination by ' + '. */
    | { keys: [string, string][] }
    /** Example card with an "Open example" button; id of an EXAMPLES entry. */
    | { example: string }
    /** Small heading inside a section. */
    | { sub: string }
    /** Muted side note. */
    | { note: string };

interface Section {
    id: string;
    title: string;
    /** One line for the list of sections on the home page and for search results. */
    about: string;
    blocks: Block[];
}

/** Returned by createHelpPanel (the modal may ignore it). */
export interface HelpPanelHandle {
    el: HTMLElement;
    /** Back to the search field and the list of guides. */
    showHome(): void;
    /** Open a guide in the reader, optionally scrolled to a step (0-based). False when the id is unknown. */
    showGuide(id: string, step?: number): boolean;
    /** Open the reference, optionally at a section ('drag', 'keys', ...). False when the section is unknown. */
    showReference(section?: string): boolean;
    /** Stop observers and timers. Optional: a panel that left the document holds on to nothing. */
    destroy(): void;
}

const MOD = Platform.isMacOS ? 'Cmd' : 'Ctrl';

/** Thumbnail canvas: both sides below the renderer's compact limits (200 x 120), so it draws no ticks or texts. */
const THUMB_W = 196;
const THUMB_H = 98;
/** 3D thumbnails are drawn at this size, then zoomed onto the drawing. */
const THUMB_3D_W = 300;
const THUMB_3D_H = 150;
/** Charts start rendering this far (px) before they scroll into view. */
const LAZY_MARGIN_PX = 240;
/** Inline code up to this many characters never wraps (it fits the narrowest help pane). */
const INLINE_CODE_NOWRAP = 26;
/** Air above a heading the panel scrolled to (px). */
const SCROLL_GAP_PX = 12;
/** "Copied" stays on a Copy button this long. */
const COPIED_MS = 1500;
/**
 * Step figures of 3D charts: drawn at the width shown times this zoom (the
 * figure then zooms onto the drawing, which fills about 3 / 4 of the
 * canvas), within these limits in px, so their fixed-size texts stay readable.
 */
const FIGURE_3D_ZOOM = 1.3;
const FIGURE_3D_MIN_W = 320;
const FIGURE_3D_MAX_W = 640;

/** The reference in the reader's language, made once per language (a module constant would be made in English, before the language is set). */
let sectionsMade: { lang: Language; sections: Section[] } | null = null;

function referenceSections(): Section[] {
    const lang = language();
    if (!sectionsMade || sectionsMade.lang !== lang) sectionsMade = { lang, sections: makeSections() };
    return sectionsMade.sections;
}

/** The sections of the reference. Code lines and terms are chart language and formulas: only the texts around them are translated. */
function makeSections(): Section[] {
    return [
        {
            id: 'start',
            title: t('help.ref.start.title'),
            about: t('help.ref.start.about'),
            blocks: [
                t('help.ref.start.p1'),
                {
                    list: [t('help.ref.start.l1'), t('help.ref.start.l2'), t('help.ref.start.l3', { mod: MOD }), t('help.ref.start.l4')],
                },
                t('help.ref.start.p2'),
                { example: 'lp' },
            ],
        },
        {
            id: 'text',
            title: t('help.ref.text.title'),
            about: t('help.ref.text.about'),
            blocks: [
                t('help.ref.text.p1'),
                {
                    code: [
                        '```easy-tikz',
                        ['show x from 0 to 5 and y from 0 to 4.5', t('help.ref.text.c1')],
                        ['axes on the edges', t('help.ref.text.c2')],
                        ['slider c from 0 to 15, starting at 6', t('help.ref.text.c3')],
                        ['shade where x + y <= 4 and x + 3y <= 6 and x >= 0 and y >= 0, numbered', t('help.ref.text.c4')],
                        ['draw 2x + 3y = c in red, dashed, labelled "z = {c}"', t('help.ref.text.c5')],
                        ['mark the maximum of 2x + 3y in the region, large, with coordinates', t('help.ref.text.c6')],
                        '```',
                    ],
                },
                t('help.ref.text.p2'),
                { sub: t('help.ref.text.sub1') },
                {
                    terms: [
                        ['plot f(x) = x^2 - 2', t('help.ref.text.t1')],
                        ['shade where x + y <= 4 and x >= 0', t('help.ref.text.t2')],
                        ['draw x^2 + y^2 = 9', t('help.ref.text.t3')],
                        ['mark (1, 2) and (3, a)', t('help.ref.text.t4')],
                        ['draw an arrow from (0, 0) to (3, 2)', t('help.ref.text.t5')],
                        ['write "optimum" at (3, 1.2)', t('help.ref.text.t6')],
                        ['show, axes, with a grid, grid opacity 0.3, title, size 12 x 6, equal scale, polar, 3d, cube', t('help.ref.text.t7')],
                    ],
                },
                { note: t('help.ref.text.note') },
                t('help.ref.text.p3'),
            ],
        },
        {
            id: 'drag',
            title: t('help.ref.drag.title'),
            about: t('help.ref.drag.about'),
            blocks: [
                t('help.ref.drag.p1'),
                {
                    list: [t('help.ref.drag.l1'), t('help.ref.drag.l2'), t('help.ref.drag.l3'), t('help.ref.drag.l4'), t('help.ref.drag.l5')],
                },
                { example: 'lp' },
            ],
        },
        {
            id: 'expressions',
            title: t('help.ref.expressions.title'),
            about: t('help.ref.expressions.about'),
            blocks: [
                t('help.ref.expressions.p1'),
                { sub: t('help.ref.expressions.sub1') },
                {
                    terms: [
                        ['+  -  *  /', t('help.ref.expressions.t1')],
                        ['^', t('help.ref.expressions.t2')],
                        ['%', t('help.ref.expressions.t3')],
                        ['< <= > >= == !=', t('help.ref.expressions.t4')],
                        ['and  or  !', t('help.ref.expressions.t5')],
                        ['c ? a : b', t('help.ref.expressions.t6')],
                    ],
                },
                { sub: t('help.ref.expressions.sub2') },
                t('help.ref.expressions.p2'),
                {
                    code: [
                        ['2x', '2*x'],
                        ['3(x + 1)', '3*(x + 1)'],
                        ['(x + 1)(x - 1)', '(x + 1)*(x - 1)'],
                        ['2 pi', '2*pi'],
                        ['a x + b y', 'a*x + b*y'],
                    ],
                },
                t('help.ref.expressions.p3'),
                {
                    list: [t('help.ref.expressions.l1'), t('help.ref.expressions.l2'), t('help.ref.expressions.l3')],
                },
                { sub: t('help.ref.expressions.sub3') },
                {
                    terms: [
                        ['sin cos tan', t('help.ref.expressions.f1')],
                        ['sec csc cot', t('help.ref.expressions.f2')],
                        ['asin acos atan atan2(y, x)', t('help.ref.expressions.f3')],
                        ['sinh cosh tanh asinh acosh atanh', t('help.ref.expressions.f4')],
                        ['exp  ln  log  log10  log2', t('help.ref.expressions.f5')],
                        ['sqrt  cbrt  abs  sign', t('help.ref.expressions.f6')],
                        ['floor  ceil  round  trunc', t('help.ref.expressions.f7')],
                        ['min  max  hypot  pow(a, b)', t('help.ref.expressions.f8')],
                        ['pi  π  e', t('help.ref.expressions.f9')],
                    ],
                },
                { sub: t('help.ref.expressions.sub4') },
                t('help.ref.expressions.p4'),
                { sub: t('help.ref.expressions.sub5') },
                t('help.ref.expressions.p5'),
            ],
        },
        {
            id: 'sliders',
            title: t('help.ref.sliders.title'),
            about: t('help.ref.sliders.about'),
            blocks: [
                t('help.ref.sliders.p1'),
                {
                    list: [t('help.ref.sliders.l1'), t('help.ref.sliders.l2'), t('help.ref.sliders.l3'), t('help.ref.sliders.l4'), t('help.ref.sliders.l5')],
                },
                t('help.ref.sliders.p2'),
                { example: 'tangent' },
            ],
        },
        {
            id: 'functions',
            title: t('help.ref.functions.title'),
            about: t('help.ref.functions.about'),
            blocks: [
                t('help.ref.functions.p1'),
                {
                    terms: [
                        ['f1(2)  f1(x - 1)', t('help.ref.functions.t1')],
                        ['2 f1 + 1', t('help.ref.functions.t2')],
                        ['f2 <= y <= f1', t('help.ref.functions.t3')],
                    ],
                },
                {
                    list: [t('help.ref.functions.l1'), t('help.ref.functions.l2'), t('help.ref.functions.l3'), t('help.ref.functions.l4'), t('help.ref.functions.l5')],
                },
            ],
        },
        {
            id: 'regions',
            title: t('help.ref.regions.title'),
            about: t('help.ref.regions.about'),
            blocks: [
                t('help.ref.regions.p1'),
                {
                    code: [
                        ['x + y <= 4', t('help.ref.regions.c1')],
                        ['0 <= x <= 4', t('help.ref.regions.c2')],
                        ['f2 <= y <= f1', t('help.ref.regions.c3')],
                        ['min(0, f1) <= y <= max(0, f1)', t('help.ref.regions.c4')],
                        ['(x - 3)^2 + (y - 2)^2 <= 2^2', t('help.ref.regions.c5')],
                        ['x <= 1 or x >= 3', t('help.ref.regions.c6')],
                    ],
                },
                {
                    list: [
                        t('help.ref.regions.l1'),
                        t('help.ref.regions.l2'),
                        t('help.ref.regions.l3'),
                        t('help.ref.regions.l4'),
                        t('help.ref.regions.l5'),
                        t('help.ref.regions.l6'),
                    ],
                },
                t('help.ref.regions.p2'),
                { example: 'areas' },
            ],
        },
        {
            id: 'curves',
            title: t('help.ref.curves.title'),
            about: t('help.ref.curves.about'),
            blocks: [
                t('help.ref.curves.p1'),
                {
                    code: [
                        ['2x + 3y = 12', t('help.ref.curves.c1')],
                        ['x = 2', t('help.ref.curves.c2')],
                        ['(x - 3)^2 + (y - 2)^2 = 4', t('help.ref.curves.c3')],
                        ['x y = 4', t('help.ref.curves.c4')],
                        ['2x + 3y = c', t('help.ref.curves.c5')],
                    ],
                },
                t('help.ref.curves.p2'),
            ],
        },
        {
            id: 'points',
            title: t('help.ref.points.title'),
            about: t('help.ref.points.about'),
            blocks: [
                {
                    terms: [
                        [t('help.ref.points.list'), t('help.ref.points.listText')],
                        [t('help.ref.points.intersections'), t('help.ref.points.intersectionsText')],
                        [t('help.ref.points.region'), t('help.ref.points.regionText')],
                        [t('help.ref.points.integers'), t('help.ref.points.integersText')],
                    ],
                },
                t('help.ref.points.p1'),
                t('help.ref.points.p2'),
                { sub: t('help.ref.points.sub1') },
                t('help.ref.points.p3'),
                {
                    terms: [
                        ['P1_x  P1_y', t('help.ref.points.t1')],
                        ['P1_x2  P1_y2', t('help.ref.points.t2')],
                        ['P1_val', t('help.ref.points.t3')],
                        ['P1_n', t('help.ref.points.t4')],
                    ],
                },
                t('help.ref.points.p4'),
            ],
        },
        {
            id: 'segments',
            title: t('help.ref.segments.title'),
            about: t('help.ref.segments.about'),
            blocks: [
                t('help.ref.segments.p1'),
                {
                    list: [t('help.ref.segments.l1'), t('help.ref.segments.l2'), t('help.ref.segments.l3'), t('help.ref.segments.l4')],
                },
            ],
        },
        {
            id: 'labels',
            title: t('help.ref.labels.title'),
            about: t('help.ref.labels.about'),
            blocks: [
                t('help.ref.labels.p1'),
                t('help.ref.labels.p2'),
                {
                    terms: [
                        ['{a}', t('help.ref.labels.t1')],
                        ['{a/3:1}', t('help.ref.labels.t2')],
                        ['{{  }}', t('help.ref.labels.t3')],
                        ['$x^2$  \\(x^2\\)', t('help.ref.labels.t4')],
                    ],
                },
                t('help.ref.labels.p3'),
                {
                    list: [t('help.ref.labels.l1'), t('help.ref.labels.l2'), t('help.ref.labels.l3'), t('help.ref.labels.l4')],
                },
            ],
        },
        {
            id: 'recipes',
            title: t('help.ref.recipes.title'),
            about: t('help.ref.recipes.about'),
            blocks: [
                { sub: t('help.ref.recipes.sub1') },
                {
                    list: [
                        t('help.ref.recipes.l1'),
                        t('help.ref.recipes.l2'),
                        t('help.ref.recipes.l3'),
                        t('help.ref.recipes.l4'),
                        t('help.ref.recipes.l5'),
                        t('help.ref.recipes.l6'),
                    ],
                },
                { example: 'lp' },
                { sub: t('help.ref.recipes.sub2') },
                t('help.ref.recipes.p1'),
                { example: 'levels' },
                { sub: t('help.ref.recipes.sub3') },
                t('help.ref.recipes.p2'),
                { example: 'surplus' },
            ],
        },
        {
            id: 'threed',
            title: t('help.ref.threed.title'),
            about: t('help.ref.threed.about'),
            blocks: [
                t('help.ref.threed.p1'),
                {
                    list: [t('help.ref.threed.l1'), t('help.ref.threed.l2'), t('help.ref.threed.l3'), t('help.ref.threed.l4')],
                },
                { example: 'plane3d' },
            ],
        },
        {
            id: 'export',
            title: t('help.ref.export.title'),
            about: t('help.ref.export.about'),
            blocks: [
                t('help.ref.export.p1'),
                {
                    list: [
                        t('help.ref.export.l1'),
                        t('help.ref.export.l2'),
                        t('help.ref.export.l3'),
                        t('help.ref.export.l4'),
                        t('help.ref.export.l5'),
                        t('help.ref.export.l6'),
                    ],
                },
                { note: t('help.ref.export.note') },
            ],
        },
        {
            id: 'keys',
            title: t('help.ref.keys.title'),
            about: t('help.ref.keys.about'),
            blocks: [
                {
                    // Key names stay as they are on the keyboard; only "Arrow keys" is words.
                    keys: [
                        [`${MOD} + Enter`, t('help.ref.keys.insert')],
                        ['Escape', t('help.ref.keys.escape')],
                        [`${MOD} + Z / ${MOD} + Shift + Z`, t('help.ref.keys.undo')],
                        ['Left / Right', t('help.ref.keys.tabs')],
                        ['Alt + Up / Alt + Down', t('help.ref.keys.cards')],
                        ['Up / Down', t('help.ref.keys.number')],
                        [t('help.ref.keys.arrowKeys'), t('help.ref.keys.arrows')],
                        ['Enter', t('help.ref.keys.enter')],
                        ['Space', t('help.ref.keys.space')],
                    ],
                },
                t('help.ref.keys.p1'),
            ],
        },
    ];
}

// -------------------------------------------------------------------- text

/** Paragraph-level text: `code` spans and **bold** runs. */
function rich(parent: HTMLElement, text: string): void {
    const parts = text.split(/(`[^`]+`|\*\*.+?\*\*)/);
    for (const part of parts) {
        if (!part) continue;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
            const code = part.slice(1, -1);
            // A short formula stays on one line; a long one may wrap anywhere rather than overflow.
            parent.createEl('code', { cls: code.length <= INLINE_CODE_NOWRAP ? ['etz-help-code-inline', 'mod-short'] : 'etz-help-code-inline', text: code });
        } else if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
            parent.createEl('strong', { text: part.slice(2, -2) });
        } else {
            parent.appendText(part);
        }
    }
}

/** An example's title and description, in the reader's language (src/migrate.ts reads them when they are shown). */
function exampleText(example: ChartExample): { title: string; description: string } {
    return { title: example.title, description: example.description };
}

/**
 * The text of a template before and after one of its places, for content that
 * is not text: 'Read first: {guides}' gives ['Read first: ', ''], so the links
 * go where the language wants them.
 */
function around(template: string, place: string): [string, string] {
    const mark = `{${place}}`;
    const at = template.indexOf(mark);
    return at < 0 ? [template, ''] : [template.slice(0, at), template.slice(at + mark.length)];
}

function renderBlock(parent: HTMLElement, block: Block, host: PanelHost): void {
    if (typeof block === 'string') {
        rich(parent.createEl('p', { cls: 'etz-help-p' }), block);
        return;
    }
    if ('sub' in block) {
        parent.createEl('h4', { cls: 'etz-help-sub', text: block.sub });
        return;
    }
    if ('note' in block) {
        rich(parent.createEl('p', { cls: 'etz-help-note' }), block.note);
        return;
    }
    if ('list' in block) {
        const ul = parent.createEl('ul', { cls: 'etz-help-list' });
        for (const item of block.list) rich(ul.createEl('li'), item);
        return;
    }
    if ('code' in block) {
        const pre = parent.createEl('pre', { cls: 'etz-help-code' });
        const width = Math.max(0, ...block.code.map((line) => (Array.isArray(line) ? line[0].length : 0)));
        const lines = block.code.map((line) => (Array.isArray(line) ? `${line[0].padEnd(width + 3)}${line[1]}` : line));
        // Comments are muted: one span per line keeps them selectable as plain text.
        const code = pre.createEl('code');
        lines.forEach((text, i) => {
            const line = block.code[i];
            if (Array.isArray(line)) {
                code.appendText(text.slice(0, width + 3));
                code.createSpan({ cls: 'etz-help-comment', text: line[1] });
            } else {
                code.appendText(text);
            }
            if (i < lines.length - 1) code.appendText('\n');
        });
        return;
    }
    if ('terms' in block) {
        const dl = parent.createEl('dl', { cls: 'etz-help-terms' });
        for (const [term, desc] of block.terms) {
            dl.createEl('dt').createEl('code', { cls: 'etz-help-code-inline', text: term });
            rich(dl.createEl('dd'), desc);
        }
        return;
    }
    if ('keys' in block) {
        const dl = parent.createEl('dl', { cls: ['etz-help-terms', 'mod-keys'] });
        for (const [keys, desc] of block.keys) {
            const dt = dl.createEl('dt');
            keys.split(' / ').forEach((combo, i) => {
                if (i > 0) dt.appendText(' / ');
                combo.split(' + ').forEach((key, j) => {
                    if (j > 0) dt.appendText('+');
                    dt.createEl('kbd', { cls: 'etz-help-kbd', text: key });
                });
            });
            rich(dl.createEl('dd'), desc);
        }
        return;
    }
    if ('example' in block) {
        const example = EXAMPLES.find((ex) => ex.id === block.example);
        if (!example) return;
        const words = exampleText(example);
        const card = parent.createDiv({ cls: 'etz-help-example' });
        const text = card.createDiv({ cls: 'etz-help-example-text' });
        const titleEl = text.createDiv({ cls: 'etz-help-example-title', text: words.title });
        titleEl.id = uniqueId('help-example');
        if (example.is3D) titleEl.createSpan({ cls: 'etz-help-badge', text: '3D' });
        text.createDiv({ cls: 'etz-help-example-desc', text: words.description });
        const button = textButton(card, {
            text: t('help.example.open'),
            size: 'sm',
            cls: 'etz-help-example-btn',
            onClick: () => host.loadChart(cloneData(example.data)),
        });
        button.el.setAttr('aria-describedby', titleEl.id);
    }
}

/** Plain text of a reference block, for the search. */
function blockText(block: Block): string {
    if (typeof block === 'string') return block;
    if ('sub' in block) return block.sub;
    if ('note' in block) return block.note;
    if ('list' in block) return block.list.join(' ');
    if ('code' in block) return block.code.map((line) => (Array.isArray(line) ? line.join(' ') : line)).join(' ');
    if ('terms' in block) return block.terms.map((pair) => pair.join(' ')).join(' ');
    if ('keys' in block) return block.keys.map((pair) => pair.join(' ')).join(' ');
    const example = EXAMPLES.find((ex) => ex.id === block.example);
    if (!example) return '';
    const words = exampleText(example);
    return `${words.title} ${words.description}`;
}

/** Reference sections that contain every word of the query, best first. */
function searchSections(query: string): Section[] {
    const tokens = searchTokens(query);
    if (!tokens.length) return [];
    return referenceSections().map((section, index) => ({
        section,
        index,
        score: searchScore(tokens, [
            [section.title, 10],
            [section.about, 5],
            [section.blocks.map(blockText).join(' '), 1],
        ]),
    }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((hit) => hit.section);
}

/**
 * Body of a guide step: paragraphs separated by blank lines; consecutive
 * lines starting with '- ' form a list.
 */
function renderBody(parent: HTMLElement, body: string): void {
    for (const paragraph of String(body ?? '').split(/\n[ \t]*\n/)) {
        let text: string[] = [];
        let items: string[] = [];
        const flushText = () => {
            if (text.length) rich(parent.createEl('p', { cls: 'etz-help-p' }), text.join(' '));
            text = [];
        };
        const flushItems = () => {
            if (items.length) {
                const ul = parent.createEl('ul', { cls: 'etz-help-list' });
                for (const item of items) rich(ul.createEl('li'), item);
            }
            items = [];
        };
        for (const raw of paragraph.split('\n')) {
            const line = raw.trim();
            if (!line) continue;
            if (line.startsWith('- ')) {
                flushText();
                items.push(line.slice(2).trim());
            } else {
                flushItems();
                text.push(line);
            }
        }
        flushText();
        flushItems();
    }
}

// ------------------------------------------------------------------ charts

/** Rendered guide thumbnails by thumbnailKey, cloned into cards (failures are retried next time). */
const THUMBNAILS = new Map<string, SVGSVGElement>();

/**
 * Cache key of a guide's thumbnail. 2D charts are drawn with the theme's CSS
 * variables and follow a theme switch by themselves; the 3D renderer resolves
 * its colours when it draws, so those thumbnails are kept per theme.
 */
function thumbnailKey(guide: Guide): string {
    if (!chartIs3D(guide.chart)) return guide.id;
    return `${guide.id}|${activeDocument.body.hasClass('theme-dark') ? 'dark' : 'light'}`;
}

/** Where the reader was when the editor closed: the Help tab opens there again (this session only). */
let lastRead: { guide: string; scroll: number } | null = null;

function chartIs3D(chart: ChartData): boolean {
    return chart.dimension === true;
}

/** Take the SVG out of a 3D renderer's root: outside the root no .tikz-3d-svg rule hides it. */
function detach3D(renderer: SVG3DRenderer): SVGSVGElement | null {
    const svg = renderer.getElement().querySelector('svg');
    if (!svg) return null;
    svg.remove();
    svg.classList.remove('tikz-3d-svg');
    return svg;
}

/** Let CSS size the picture; the viewBox keeps its proportions. */
function fluid(svg: SVGSVGElement): SVGSVGElement {
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('aria-hidden', 'true');
    return svg;
}

/** Width : height of the preview canvas of a chart (its paper size), 1.25 when it cannot be read. */
function chartAspect(chart: ChartData): number {
    try {
        const { width, height } = SettingsManager.fromJSON(cloneData(chart)).previewCanvas();
        return width > 0 && height > 0 ? width / height : 1.25;
    } catch {
        return 1.25;
    }
}

/**
 * A chart as the editor would draw it, with the chart's own slider values.
 * The math context is private: the memoized one may be the editor's own
 * (same structure after "Open this step in the editor"), and its slider and
 * computed values must stay the editor's.
 */
function chartConfig(chart: ChartData) {
    const settings = SettingsManager.fromJSON(cloneData(chart));
    const math = settings.createMathContext({ memo: false });
    return { math, config: settings.toRendererConfig(math) };
}

/** Thumbnail of a chart: 2D in the renderer's compact mode (no ticks, no texts), 3D as a small export SVG. */
function renderThumbnail(chart: ChartData): SVGSVGElement | null {
    const { math, config } = chartConfig(chart);
    config.title = '';
    if (config.is3D) {
        config.width = THUMB_3D_W;
        config.height = THUMB_3D_H;
        const renderer = new SVG3DRenderer();
        renderer.renderSvg(config, { math });
        return detach3D(renderer);
    }
    config.width = THUMB_W;
    config.height = THUMB_H;
    // Grid lines are noise at this size.
    config.gridMajor = false;
    config.gridMinor = false;
    return new SVGRenderer(config, { math }).render() as SVGSVGElement;
}

/**
 * 3D charts: the camera leaves wide margins around the box, so once the SVG
 * is in the document, zoom its viewBox onto what is drawn (the groups and
 * the title; texts are display: none in thumbnails and do not count).
 * Returns the new viewBox, or null when nothing has a size.
 */
function fitToContent(svg: SVGSVGElement, pad: number): string | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const el of Array.from(svg.querySelectorAll<SVGGraphicsElement>(':scope > g, :scope > text'))) {
        let b: DOMRect;
        try {
            b = el.getBBox();
        } catch {
            continue;
        }
        if (!(b.width > 0 && b.height > 0)) continue;
        x0 = Math.min(x0, b.x);
        y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.width);
        y1 = Math.max(y1, b.y + b.height);
    }
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null;
    const viewBox = `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`;
    svg.setAttribute('viewBox', viewBox);
    return viewBox;
}

let cloneCount = 0;

/**
 * Give a cloned chart its own ids. A clone repeats the ids of its original,
 * and `url(#id)` resolves to the first element with that id in the document:
 * when that copy sits in a hidden view (the home cards while a guide is
 * open), the clone's arrowheads, patterns and clip paths would not draw.
 */
function ownIds(svg: SVGSVGElement): SVGSVGElement {
    const suffix = `-c${++cloneCount}`;
    const ids = new Set<string>();
    for (const el of Array.from(svg.querySelectorAll('[id]'))) {
        ids.add(el.id);
        el.id += suffix;
    }
    if (!ids.size) return svg;
    for (const el of Array.from(svg.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
            if (attr.name === 'id' || !attr.value.includes('#')) continue;
            let value = attr.value.replace(/url\((["']?)#([^)"']+)\1\)/g, (match: string, quote: string, id: string) =>
                ids.has(id) ? `url(${quote}#${id}${suffix}${quote})` : match
            );
            if ((attr.name === 'href' || attr.name === 'xlink:href') && value.startsWith('#') && ids.has(value.slice(1))) value += suffix;
            if (value !== attr.value) el.setAttribute(attr.name, value);
        }
    }
    return svg;
}

/**
 * Thumbnail SVG of a guide's finished chart (a clone of the cached drawing
 * with ids of its own), or null when it cannot be drawn. `key` is its cache
 * entry; `fresh` is true for a first render.
 */
function guideThumbnail(guide: Guide): { svg: SVGSVGElement; key: string; fresh: boolean } | null {
    const key = thumbnailKey(guide);
    let svg = THUMBNAILS.get(key) ?? null;
    const fresh = !svg;
    if (!svg) {
        try {
            svg = renderThumbnail(guide.chart);
        } catch {
            svg = null;
        }
        if (!svg) return null;
        THUMBNAILS.set(key, fluid(svg));
    }
    return { svg: ownIds(svg.cloneNode(true) as SVGSVGElement), key, fresh };
}

/** A drawn figure, and (2D charts with `$...$` labels) the renderer's promise that says whether to draw it again. */
interface DrawnFigure {
    svg: SVGSVGElement;
    settled: Promise<boolean> | null;
}

/** The full chart for a figure box of `boxW` x `boxH` CSS px, or null when it cannot be drawn. */
function renderFigure(chart: ChartData, boxW: number, boxH: number): DrawnFigure | null {
    try {
        const { math, config } = chartConfig(chart);
        if (config.is3D) {
            // 3D texts have a fixed size in viewBox units: draw near the size
            // shown, a little larger because the figure zooms onto the drawing.
            const aspect = config.width > 0 && config.height > 0 ? config.width / config.height : 1.25;
            const width = Math.round(Math.max(FIGURE_3D_MIN_W, Math.min(FIGURE_3D_MAX_W, (boxW > 0 ? boxW : FIGURE_3D_MAX_W) * FIGURE_3D_ZOOM)));
            config.width = width;
            config.height = Math.round(width / aspect);
            const renderer = new SVG3DRenderer();
            renderer.renderSvg(config, { math });
            const svg = detach3D(renderer);
            return svg ? { svg: fluid(svg), settled: null } : null;
        }
        const pixelScale = fitPixelScale(boxW, boxH, config.width, config.height);
        const renderer = new SVGRenderer(config, { math, pixelScale });
        const svg = fluid(renderer.render() as SVGSVGElement);
        return { svg, settled: renderer.mathSettled };
    } catch {
        return null;
    }
}

/**
 * Runs render jobs when their element scrolls into view, one per task so the
 * tab stays responsive. A class of its own on purpose: the observer keeps
 * its callback alive, and the callback must not hold on to the panel (the
 * jobs do, but they sit in a WeakMap keyed by their element), so a panel
 * that left the document is garbage like any other.
 */
class LazyJobs {
    private readonly jobs = new WeakMap<Element, () => void>();
    private queue: Array<() => void> = [];
    private timer: number | null = null;
    private observer: IntersectionObserver | null = null;

    constructor(scroller: HTMLElement) {
        if (typeof IntersectionObserver === 'undefined') return;
        this.observer = new IntersectionObserver(this.onEntries.bind(this), { root: scroller, rootMargin: `${LAZY_MARGIN_PX}px 0px` });
    }

    /** Run `job` once `el` is (nearly) visible; without IntersectionObserver, as soon as the queue gets to it. */
    add(el: Element, job: () => void): void {
        if (!this.observer) {
            this.queue.push(job);
            this.pump();
            return;
        }
        this.jobs.set(el, job);
        this.observer.observe(el);
    }

    /** Forget every pending job. */
    clear(): void {
        if (this.observer) this.observer.disconnect();
        this.queue = [];
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
    }

    private onEntries(entries: IntersectionObserverEntry[]): void {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            if (this.observer) this.observer.unobserve(entry.target);
            const job = this.jobs.get(entry.target);
            if (!job) continue;
            this.jobs.delete(entry.target);
            this.queue.push(job);
        }
        this.pump();
    }

    private pump(): void {
        if (this.timer !== null || !this.queue.length) return;
        this.timer = window.setTimeout(() => {
            this.timer = null;
            const job = this.queue.shift();
            if (job) {
                try {
                    job();
                } catch {
                    // A picture that fails leaves its placeholder; the rest still render.
                }
            }
            this.pump();
        }, 0);
    }
}

// ------------------------------------------------------------------- panel

export function createHelpPanel(parent: HTMLElement, host: PanelHost): HelpPanelHandle {
    const root = parent.createDiv({ cls: 'etz-help' });
    /** The tab panel scrolls; the views below swap inside it. */
    const scroller = parent;
    const homeEl = root.createDiv({ cls: 'etz-help-home' });
    const guideEl = root.createDiv({ cls: ['etz-help-page', 'mod-guide', 'tikz-hidden'] });
    const referenceEl = root.createDiv({ cls: ['etz-help-page', 'mod-reference', 'tikz-hidden'] });

    const homeLazy = new LazyJobs(scroller);
    const pageLazy = new LazyJobs(scroller);

    let view: 'home' | 'guide' | 'reference' = 'home';
    let openGuide: Guide | null = null;
    /** Scroll position of the home view and the control that left it, restored by "All guides". */
    let homeScroll = 0;
    let returnFocus: HTMLElement | null = null;
    /** Headings of the reference sections, once the reference is built. */
    let sectionHeadings: Map<string, HTMLElement> | null = null;
    let releaseEscape: (() => void) | null = null;
    let destroyed = false;

    // ---------------------------------------------------------------- views

    /**
     * Scroll the tab panel so `el` sits at its top, below the sticky bar of a
     * page. Not scrollIntoView: that also scrolls every ancestor that can
     * scroll, the editor modal included (its overflow is hidden, so the user
     * could not scroll it back).
     */
    function scrollToTop(el: HTMLElement): void {
        const bar = view === 'home' ? null : (view === 'guide' ? guideEl : referenceEl).querySelector<HTMLElement>('.etz-help-bar');
        const offset = (bar ? bar.offsetHeight : 0) + SCROLL_GAP_PX;
        scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
    }

    function show(next: 'home' | 'guide' | 'reference'): void {
        view = next;
        homeEl.toggleClass('tikz-hidden', next !== 'home');
        guideEl.toggleClass('tikz-hidden', next !== 'guide');
        referenceEl.toggleClass('tikz-hidden', next !== 'reference');
        if (next !== 'guide') lastRead = null;
        syncEscape();
    }

    /** Leave the home view for a page, remembering where to come back to. */
    function leaveHome(from: HTMLElement | null): void {
        if (view !== 'home') return;
        homeScroll = scroller.scrollTop;
        returnFocus = from;
    }

    function showHome(): void {
        if (view === 'home') return;
        show('home');
        pageLazy.clear();
        guideEl.empty();
        openGuide = null;
        scroller.scrollTop = homeScroll;
        const target = returnFocus && returnFocus.isConnected ? returnFocus : searchInput;
        returnFocus = null;
        if (root.isShown()) target.focus({ preventScroll: true });
    }

    function showGuide(id: string, step?: number): boolean {
        const guide = localGuideById(id);
        if (!guide) return false;
        show('guide');
        const steps = buildGuide(guide);
        lastRead = { guide: guide.id, scroll: 0 };
        scroller.scrollTop = 0;
        const stepEl = typeof step === 'number' ? steps[step] : undefined;
        if (stepEl) scrollToTop(stepEl);
        // Opened at a step: the focus goes to that step's heading, so the next Tab continues from
        // there. (On the guide title it would be far above the view, and Tab would scroll back up.)
        const target = (stepEl ? stepEl.querySelector<HTMLElement>('.etz-help-step-title') : null) || guideEl.querySelector<HTMLElement>('.etz-help-title');
        if (target && root.isShown()) target.focus({ preventScroll: true });
        return true;
    }

    function showReference(section?: string): boolean {
        if (!sectionHeadings) sectionHeadings = buildReference();
        const heading = section ? sectionHeadings.get(section) : undefined;
        if (section && !heading) return false;
        show('reference');
        pageLazy.clear();
        guideEl.empty();
        openGuide = null;
        scroller.scrollTop = 0;
        const target = heading || referenceEl.querySelector<HTMLElement>('.etz-help-title');
        if (heading) scrollToTop(heading);
        if (target && root.isShown()) target.focus({ preventScroll: true });
        return true;
    }

    // ----------------------------------------------------------- components

    /** "All guides" bar that stays at the top of a page while it scrolls. */
    function pageBar(page: HTMLElement, crumb: string): void {
        const bar = page.createDiv({ cls: 'etz-help-bar' });
        textButton(bar, { text: t('help.bar.allGuides'), icon: 'arrow-left', variant: 'ghost', size: 'sm', cls: 'etz-help-back', onClick: () => showHome() });
        bar.createSpan({ cls: 'etz-help-crumb', text: crumb });
    }

    /** Fixed-aspect thumbnail box; the picture arrives when the box scrolls into view. */
    function thumbnail(card: HTMLElement, guide: Guide, lazy: LazyJobs): void {
        const box = card.createSpan({ cls: 'etz-help-thumb', attr: { 'aria-hidden': 'true' } });
        lazy.add(box, () => {
            if (!box.isConnected) return;
            const thumb = guideThumbnail(guide);
            if (!thumb) {
                box.addClass('is-fallback');
                return;
            }
            box.appendChild(thumb.svg);
            if (thumb.fresh && chartIs3D(guide.chart)) {
                // The cached original keeps the fitted viewBox for later clones.
                const viewBox = fitToContent(thumb.svg, 4);
                const cached = THUMBNAILS.get(thumb.key);
                if (viewBox && cached) cached.setAttribute('viewBox', viewBox);
            }
        });
    }

    /** A guide (in the reader's language) as a card: thumbnail, title, summary, level and minutes. `hit` names the step a search found. */
    function guideCard(grid: HTMLElement, guide: Guide, lazy: LazyJobs, hit?: number | null): HTMLButtonElement {
        const card = grid.createEl('button', { cls: 'etz-help-card', attr: { type: 'button' } });
        thumbnail(card, guide, lazy);
        const text = card.createSpan({ cls: 'etz-help-card-text' });
        const title = text.createSpan({ cls: 'etz-help-card-title', text: guide.title });
        if (chartIs3D(guide.chart)) title.createSpan({ cls: 'etz-help-badge', text: '3D' });
        text.createSpan({ cls: 'etz-help-card-summary', text: guide.summary });
        const found = typeof hit === 'number' && guide.steps[hit] ? hit : null;
        if (found !== null) text.createSpan({ cls: 'etz-help-card-hit', text: t('help.card.step', { n: found + 1, title: guide.steps[found].title }) });
        const meta = text.createSpan({ cls: 'etz-help-card-meta' });
        meta.createSpan({ cls: ['etz-help-level', `mod-${guide.level}`], text: guideLevelLabel(guide.level) });
        meta.createSpan({ text: t('help.card.minutes', { minutes: guide.minutes }) });
        card.addEventListener('click', () => {
            leaveHome(card);
            showGuide(guide.id, found ?? undefined);
        });
        return card;
    }

    /** A chart in a fixed-aspect box, drawn when it scrolls into view. */
    function figure(parent: HTMLElement, chart: ChartData, label: string): HTMLElement {
        const box = parent.createDiv({ cls: 'etz-help-figure', attr: { role: 'img' } });
        const name = visuallyHidden(box, label);
        name.id = uniqueId('help-figure');
        box.setAttr('aria-labelledby', name.id);
        box.setCssProps({ '--etz-help-aspect': String(Math.round(chartAspect(chart) * 1000) / 1000) });
        let shown: SVGSVGElement | null = null;
        const draw = (redraws: number): void => {
            if (!box.isConnected) return;
            const drawn = renderFigure(chart, box.clientWidth, box.clientHeight);
            if (!drawn) {
                // A redraw that fails keeps the picture that is there.
                if (!shown) box.addClass('is-fallback');
                return;
            }
            if (shown) shown.replaceWith(drawn.svg);
            else box.appendChild(drawn.svg);
            shown = drawn.svg;
            if (chartIs3D(chart)) fitToContent(drawn.svg, 8);
            // A new `$...$` label is measured before MathJax has styled it: draw again when it has.
            if (drawn.settled && redraws < MATH_REDRAW_LIMIT) {
                void drawn.settled.then((redraw) => {
                    if (redraw && shown === drawn.svg) draw(redraws + 1);
                });
            }
        };
        pageLazy.add(box, () => draw(0));
        return box;
    }

    /** "Type" rows: where to type, the text, and a Copy button. */
    function typeRows(parent: HTMLElement, rows: NonNullable<GuideStep['type']>): void {
        const list = parent.createDiv({ cls: 'etz-help-type' });
        for (const row of rows) {
            const el = list.createDiv({ cls: 'etz-help-type-row' });
            const main = el.createDiv({ cls: 'etz-help-type-main' });
            main.createDiv({ cls: 'etz-help-type-where', text: row.where });
            const code = main.createEl('code', { cls: 'etz-help-type-text', text: row.text });
            code.id = uniqueId('help-type');
            const button = textButton(el, { text: t('common.copy'), variant: 'ghost', size: 'sm', cls: 'etz-help-copy' });
            button.el.setAttr('aria-describedby', code.id);
            let timer: number | null = null;
            button.el.addEventListener('click', () => {
                void navigator.clipboard.writeText(row.text).then(
                    () => {
                        button.setText(t('common.copied'));
                        if (timer !== null) window.clearTimeout(timer);
                        timer = window.setTimeout(() => {
                            timer = null;
                            button.setText(t('common.copy'));
                        }, COPIED_MS);
                    },
                    () => new Notice(t('help.copyFailed'))
                );
            });
        }
    }

    // ----------------------------------------------------------------- home

    const search = homeEl.createDiv({ cls: 'etz-help-search' });
    setIcon(search.createSpan({ cls: 'etz-help-search-icon', attr: { 'aria-hidden': 'true' } }), 'search');
    const searchInput = search.createEl('input', {
        cls: ['etz-input', 'etz-help-search-input'],
        type: 'text',
        attr: { autocomplete: 'off', spellcheck: 'false', placeholder: t('help.search.label') },
    });
    const searchLabel = visuallyHidden(search, t('help.search.label'));
    searchLabel.id = uniqueId('help-search');
    searchInput.setAttr('aria-labelledby', searchLabel.id);
    const clearButton = iconButton(search, { icon: 'x', label: t('help.search.clear'), size: 'sm', cls: 'etz-help-search-clear', onClick: () => clearSearch(true) });
    clearButton.el.addClass('tikz-hidden');

    const resultsEl = homeEl.createDiv({ cls: ['etz-help-results', 'tikz-hidden'] });
    const browseEl = homeEl.createDiv({ cls: 'etz-help-browse' });

    /** Escape clears a typed query instead of closing the editor (only while the field has focus and text). */
    function syncEscape(): void {
        const wanted = !destroyed && view === 'home' && searchInput.value !== '' && searchInput.isConnected && activeDocument.activeElement === searchInput;
        if (wanted && !releaseEscape) {
            releaseEscape = trapEscape(host, () => {
                // The editor may have closed without a blur: let go, the key was not ours.
                if (!searchInput.isConnected) syncEscape();
                else clearSearch(true);
            });
        } else if (!wanted && releaseEscape) {
            releaseEscape();
            releaseEscape = null;
        }
    }

    function clearSearch(focus: boolean): void {
        searchInput.value = '';
        runSearch();
        if (focus) searchInput.focus();
        syncEscape();
    }

    /** Buttons of the reference sections: title and one line about each. */
    function topicList(parent: HTMLElement, sections: Section[]): void {
        const list = parent.createDiv({ cls: 'etz-help-topics' });
        for (const section of sections) {
            const button = list.createEl('button', { cls: 'etz-help-topic', attr: { type: 'button' } });
            button.createSpan({ cls: 'etz-help-topic-title', text: section.title });
            button.createSpan({ cls: 'etz-help-topic-about', text: section.about });
            button.addEventListener('click', () => {
                leaveHome(button);
                showReference(section.id);
            });
        }
    }

    function runSearch(): void {
        const query = searchInput.value.trim();
        clearButton.el.toggleClass('tikz-hidden', searchInput.value === '');
        resultsEl.empty();
        resultsEl.toggleClass('tikz-hidden', !query);
        browseEl.toggleClass('tikz-hidden', !!query);
        if (!query) return;
        // The guides as the reader sees them, so the search finds the words on screen.
        const guides = searchGuides(query, localGuides());
        const sections = searchSections(query);
        const status = resultsEl.createDiv({ cls: 'etz-help-status', attr: { role: 'status' } });
        if (!guides.length && !sections.length) {
            status.setText(t('help.search.nothing', { query }));
            return;
        }
        if (guides.length && sections.length) status.setText(t('help.search.both', { guides: guides.length, sections: sections.length }));
        else if (guides.length) status.setText(t('help.search.guides', { count: guides.length }));
        else status.setText(t('help.search.sections', { count: sections.length }));
        if (guides.length) {
            const grid = resultsEl.createDiv({ cls: 'etz-help-cards' });
            for (const hit of guides) guideCard(grid, hit.guide, homeLazy, hit.step);
        }
        if (sections.length) {
            if (guides.length) resultsEl.createEl('h3', { cls: 'etz-help-h', text: guideCategoryLabel('Reference') });
            topicList(resultsEl, sections);
        }
    }

    searchInput.addEventListener('input', () => {
        runSearch();
        syncEscape();
    });
    searchInput.addEventListener('focus', syncEscape);
    searchInput.addEventListener('blur', syncEscape);
    searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
        // Mod+Enter belongs to the editor (Insert into note).
        if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
        const first = resultsEl.querySelector<HTMLElement>('button.etz-help-card, button.etz-help-topic');
        if (!first) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            first.click();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            first.focus();
        }
    });

    // "What's new in version 4": the popup people who updated see once, to open again. Its buttons stay in this editor.
    const plugin = host.plugin;
    if (plugin && typeof plugin.showWhatsNew === 'function') {
        const news = browseEl.createDiv({ cls: 'etz-help-news' });
        textButton(news, {
            text: t('help.whatsNew'),
            icon: 'sparkles',
            variant: 'link',
            size: 'sm',
            cls: 'etz-help-news-link',
            onClick: () =>
                plugin.showWhatsNew?.({
                    // To the Build tab once the chart is in: a cancelled Replace leaves the reader here.
                    tryExample: (chart) => host.loadChart(chart, () => host.showTab('build')),
                    openGuides: (guideId) => {
                        host.showTab('help');
                        if (!guideId || !showGuide(guideId)) showHome();
                    },
                    openAi: () => host.showTab('ai'),
                }),
        });
    }

    // Jump links: the reference is the last category, a long scroll below the guide cards.
    const jump = browseEl.createEl('nav', { cls: 'etz-help-toc' });
    const jumpLabel = visuallyHidden(jump, t('help.categories'));
    jumpLabel.id = uniqueId('help-jump');
    jump.setAttr('aria-labelledby', jumpLabel.id);
    const jumpList = jump.createDiv({ cls: 'etz-help-toc-list' });

    for (const category of GUIDE_CATEGORIES) {
        const guides = guidesIn(category).map(localGuide);
        const reference = category === 'Reference';
        if (!guides.length && !reference) continue;
        const name = guideCategoryLabel(category);
        const section = browseEl.createEl('section', { cls: 'etz-help-category' });
        const heading = section.createEl('h3', { cls: 'etz-help-h', text: name, attr: { tabindex: '-1' } });
        heading.id = uniqueId('help-category');
        section.setAttr('aria-labelledby', heading.id);
        if (guides.length) {
            const grid = section.createDiv({ cls: 'etz-help-cards' });
            for (const guide of guides) guideCard(grid, guide, homeLazy);
        }
        if (reference) {
            if (guides.length) section.createEl('h4', { cls: 'etz-help-sub', text: t('help.referenceSections') });
            topicList(section, referenceSections());
        }
        textButton(jumpList, {
            text: name,
            variant: 'ghost',
            size: 'sm',
            cls: 'etz-help-toc-btn',
            onClick: () => {
                scrollToTop(heading);
                heading.focus({ preventScroll: true });
            },
        });
    }

    // ---------------------------------------------------------------- guide

    /** Build the reader page of a guide (in the reader's language); returns its step elements. */
    function buildGuide(guide: Guide): HTMLElement[] {
        pageLazy.clear();
        guideEl.empty();
        openGuide = guide;
        pageBar(guideEl, guideCategoryLabel(guide.category));

        const head = guideEl.createEl('header', { cls: 'etz-help-guide-head' });
        head.createEl('h3', { cls: ['etz-help-h', 'etz-help-title'], text: guide.title, attr: { tabindex: '-1' } });
        const meta = head.createDiv({ cls: 'etz-help-meta' });
        meta.createSpan({ cls: ['etz-help-level', `mod-${guide.level}`], text: guideLevelLabel(guide.level) });
        meta.createSpan({ text: t('help.card.minutes', { minutes: guide.minutes }) });
        meta.createSpan({ text: t('help.guide.steps', { count: guide.steps.length }) });
        head.createEl('p', { cls: 'etz-help-p', text: guide.summary });

        const before = (guide.requires || []).map((id) => localGuideById(id)).filter((g): g is Guide => !!g);
        if (before.length) {
            const line = head.createEl('p', { cls: ['etz-help-p', 'etz-help-requires'] });
            // The links go where the template has {guides}; between two of them, what listJoin has between {before} and {after}.
            const [lead, trail] = around(t('help.guide.readFirst'), 'guides');
            const join = around(around(t('help.guide.listJoin'), 'before')[1], 'after')[0];
            if (lead) line.appendText(lead);
            before.forEach((g, i) => {
                if (i > 0) line.appendText(join);
                textButton(line, { text: g.title, variant: 'link', onClick: () => showGuide(g.id) });
            });
            if (trail) line.appendText(trail);
        }

        // What the reader gets: the outcomes beside the finished chart (the picture of the guide's card).
        const lead = guideEl.createDiv({ cls: 'etz-help-lead' });
        const outcomes = lead.createEl('section', { cls: 'etz-help-outcomes' });
        outcomes.createEl('h4', { cls: 'etz-help-sub', text: t('help.guide.outcomes') });
        const ul = outcomes.createEl('ul', { cls: 'etz-help-list' });
        for (const outcome of guide.outcomes || []) rich(ul.createEl('li'), outcome);
        const finished = lead.createDiv({ cls: 'etz-help-finished' });
        thumbnail(finished, guide, pageLazy);
        textButton(finished, { text: t('help.guide.openFinished'), variant: 'link', cls: 'etz-help-open-finished', onClick: () => host.loadChart(cloneData(guide.chart)) });

        // Before and after the text of a tip: read only by screen readers.
        const [tipLead, tipTrail] = around(t('help.guide.tip'), 'tip');
        const stepEls: HTMLElement[] = [];
        guide.steps.forEach((step, index) => {
            const el = guideEl.createEl('section', { cls: 'etz-help-step' });
            const stepHead = el.createDiv({ cls: 'etz-help-step-head' });
            stepHead.createSpan({ cls: 'etz-help-step-num', text: String(index + 1), attr: { 'aria-hidden': 'true' } });
            const title = stepHead.createEl('h4', { cls: 'etz-help-step-title', attr: { tabindex: '-1' } });
            // The number is on screen already: the words around the title are read only by screen readers.
            const [stepLead, stepTrail] = around(t('help.card.step', { n: index + 1 }), 'title');
            if (stepLead) visuallyHidden(title, stepLead);
            title.appendText(step.title);
            if (stepTrail) visuallyHidden(title, stepTrail);
            title.id = uniqueId('help-step');
            el.setAttr('aria-labelledby', title.id);

            renderBody(el, step.body);
            if (step.type && step.type.length) typeRows(el, step.type);
            if (step.tip) {
                const tip = el.createDiv({ cls: 'etz-help-tip' });
                setIcon(tip.createSpan({ cls: 'etz-help-tip-icon', attr: { 'aria-hidden': 'true' } }), 'lightbulb');
                const text = tip.createDiv({ cls: 'etz-help-tip-text' });
                if (tipLead) visuallyHidden(text, tipLead);
                rich(text, step.tip);
                if (tipTrail) visuallyHidden(text, tipTrail);
            }
            if (step.chart) figure(el, step.chart, t('help.guide.figure', { n: index + 1, title: step.title }));
            // A step without its own chart keeps the previous one: the button still opens the chart of this point of the guide.
            const chart = stepChart(guide, index);
            if (chart) {
                textButton(el, { text: t('help.guide.openStep'), size: 'sm', cls: 'etz-help-open', onClick: () => host.loadChart(cloneData(chart)) });
            }
            stepEls.push(el);
        });

        const next = (guide.next || []).map((id) => localGuideById(id)).filter((g): g is Guide => !!g && g.id !== guide.id);
        if (next.length) {
            const section = guideEl.createEl('section', { cls: 'etz-help-next' });
            section.createEl('h3', { cls: 'etz-help-h', text: t('help.guide.next') });
            const grid = section.createDiv({ cls: 'etz-help-cards' });
            for (const g of next) guideCard(grid, g, pageLazy);
        }

        const foot = guideEl.createEl('p', { cls: ['etz-help-p', 'etz-help-foot'] });
        const link = foot.createEl('a', { cls: 'external-link', text: t('help.guide.github'), href: guideUrl(guide.id) });
        link.setAttr('target', '_blank');
        link.setAttr('rel', 'noopener');
        return stepEls;
    }

    // ------------------------------------------------------------ reference

    /** Build the reference page once; returns the heading of every section by id. */
    function buildReference(): Map<string, HTMLElement> {
        const headings = new Map<string, HTMLElement>();
        pageBar(referenceEl, guideCategoryLabel('Reference'));
        const intro = referenceEl.createDiv({ cls: 'etz-help-intro' });
        intro.createEl('h3', { cls: ['etz-help-h', 'etz-help-title'], text: t('help.reference.title'), attr: { tabindex: '-1' } });
        intro.createEl('p', { cls: 'etz-help-p', text: t('help.reference.intro') });

        // Contents: buttons that scroll their section into view and move focus to its heading.
        const nav = intro.createEl('nav', { cls: 'etz-help-toc' });
        const navLabel = nav.createDiv({ cls: 'etz-help-toc-label', text: t('help.reference.contents') });
        navLabel.id = uniqueId('help-toc');
        nav.setAttr('aria-labelledby', navLabel.id);
        const navList = nav.createDiv({ cls: 'etz-help-toc-list' });

        for (const section of referenceSections()) {
            const el = referenceEl.createEl('section', { cls: 'etz-help-section' });
            const heading = el.createEl('h3', { cls: 'etz-help-h', text: section.title, attr: { tabindex: '-1' } });
            heading.id = uniqueId(`help-${section.id}`);
            el.setAttr('aria-labelledby', heading.id);
            for (const block of section.blocks) renderBlock(el, block, host);
            headings.set(section.id, heading);

            textButton(navList, {
                text: section.title,
                variant: 'ghost',
                size: 'sm',
                cls: 'etz-help-toc-btn',
                onClick: () => {
                    scrollToTop(heading);
                    heading.focus({ preventScroll: true });
                },
            });
        }
        return headings;
    }

    // -------------------------------------------------------------- resume

    // Remember how far the open guide was read, so the next editor (a chart
    // inserted into a note closes this one) opens the Help tab there again.
    scroller.addEventListener(
        'scroll',
        () => {
            if (view === 'guide' && openGuide && lastRead && lastRead.guide === openGuide.id && root.isShown()) lastRead.scroll = scroller.scrollTop;
        },
        { passive: true }
    );
    const resume = lastRead && localGuideById(lastRead.guide) ? { ...lastRead } : null;
    if (resume) {
        showGuide(resume.guide);
        lastRead = { ...resume };
        // The tab panel is hidden until the Help tab is picked: scroll once it shows.
        homeLazy.add(root, () => {
            if (view === 'guide' && openGuide && openGuide.id === resume.guide) scroller.scrollTop = resume.scroll;
        });
    }

    return {
        el: root,
        showHome,
        showGuide: (id, step) => {
            if (!localGuideById(id)) return false;
            leaveHome(null);
            return showGuide(id, step);
        },
        showReference: (section) => {
            if (section && !referenceSections().some((s) => s.id === section)) return false;
            leaveHome(null);
            return showReference(section);
        },
        destroy: () => {
            destroyed = true;
            homeLazy.clear();
            pageLazy.clear();
            syncEscape();
        },
    };
}
