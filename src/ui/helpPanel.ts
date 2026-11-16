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
import { LiveChart, detach3D, fitToContent, fluid } from './liveChart';
import { printChartText } from '../text/print';
import type { GuideCategory } from '../guides/types';

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

/** The guide of the language tour: its finished chart heads the home page, in words and as a picture. */
const TOUR_ID = 'chart-language';
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
                        ['shade where $x + y \\le 4$ and $x + 3y \\le 6$ and $x \\ge 0$ and $y \\ge 0$, numbered', t('help.ref.text.c4')],
                        ['draw $2x + 3y = c$ in red, dashed, labelled "$z = {c}$"', t('help.ref.text.c5')],
                        ['mark the maximum of $2x + 3y$ in the region, large, with coordinates', t('help.ref.text.c6')],
                        '```',
                    ],
                },
                t('help.ref.text.p2'),
                { sub: t('help.ref.text.sub1') },
                {
                    terms: [
                        ['plot $f(x) = x^2 - 2$', t('help.ref.text.t1')],
                        ['shade where $x + y \\le 4$ and $x \\ge 0$', t('help.ref.text.t2')],
                        ['draw $x^2 + y^2 = 9$', t('help.ref.text.t3')],
                        ['mark (1, 2) and (3, a)', t('help.ref.text.t4')],
                        ['draw an arrow from (0, 0) to (3, 2)', t('help.ref.text.t5')],
                        ['write "optimum" at (3, 1.2)', t('help.ref.text.t6')],
                        ['plot $f(x) = \\frac{1}{2}x^2$', t('help.ref.text.t8')],
                        ['slider a from 0 to 2, connected', t('help.ref.text.t9')],
                        ['use the table above', t('help.ref.text.t10')],
                        ['plot the normal distribution with mean 0 and sd 1', t('help.ref.text.t11')],
                        ['draw the left Riemann sum of f from 0 to 2 with 6 parts', t('help.ref.text.t12')],
                        ["draw the slope field of $y' = x - y$", t('help.ref.text.t13')],
                        ['show, axes, with a grid, grid opacity 0.3, x numbers every 1, title, size 12 x 6, equal scale, polar, 3d, cube', t('help.ref.text.t7')],
                    ],
                },
                { note: t('help.ref.text.note') },
                t('help.ref.text.p3'),
                { sub: t('help.ref.text.sub2') },
                t('help.ref.text.full'),
                {
                    code: [
                        '```easy-tikz',
                        '\\begin{chart}',
                        ['\\axis[xmin=0, xmax=5, ymin=0, ymax=4.5, axis lines=left]', t('help.ref.text.c7')],
                        ['\\slider[min=0, max=15, start=6]{c}', t('help.ref.text.c3')],
                        ['\\shade[numbered]{x + y \\le 4, x + 3y \\le 6, x \\ge 0, y \\ge 0}', t('help.ref.text.c4')],
                        ['\\draw[red, dashed, label={$z = {c}$}]{2x + 3y = c}', t('help.ref.text.c5')],
                        ['\\mark[max, large, coordinates]{2x + 3y}', t('help.ref.text.c6')],
                        '\\end{chart}',
                        '```',
                    ],
                },
                t('help.ref.text.full2'),
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

/** Where the reader was when the editor closed: the Help tab opens there again, at that step (this session only). */
let lastRead: { guide: string; step: number } | null = null;

function chartIs3D(chart: ChartData): boolean {
    return chart.dimension === true;
}

/**
 * A chart as the editor would draw it, with the chart's own slider values.
 * The math context is private: the memoized one may be the editor's own
 * (same structure after "Open in the editor"), and its slider and computed
 * values must stay the editor's.
 */
function chartConfig(chart: ChartData) {
    const settings = SettingsManager.fromJSON(cloneData(chart));
    const math = settings.createMathContext({ memo: false });
    return { math, config: settings.toRendererConfig(math) };
}

/** A chart in the words of the chart language, one line each (the built-in English words). */
function chartLines(chart: ChartData): string[] {
    try {
        return printChartText(cloneData(chart))
            .split('\n')
            .filter((line) => line.trim() !== '');
    } catch {
        return [];
    }
}

/** One line of chart text, coloured: what the line does (its first word), formulas in `$...$`, texts in quotes. */
function paintLine(el: HTMLElement, line: string): void {
    line.split(/(\$[^$]*\$|"[^"]*")/).forEach((part, i) => {
        if (!part) return;
        if (part.startsWith('$')) el.createSpan({ cls: 'etz-help-words-tex', text: part });
        else if (part.startsWith('"')) el.createSpan({ cls: 'etz-help-words-str', text: part });
        else if (i === 0) {
            const m = /^((?:[A-Za-z][A-Za-z0-9_]*:\s*)?)(shade where|use the table above|with a grid|equal scale|[A-Za-z0-9]+)([\s\S]*)$/.exec(part);
            if (!m) {
                el.appendText(part);
                return;
            }
            if (m[1]) el.appendText(m[1]);
            el.createSpan({ cls: 'etz-help-words-verb', text: m[2] });
            if (m[3]) el.appendText(m[3]);
        } else el.appendText(part);
    });
}

/** A chart in words: a line each, the lines in `fresh` (what this step added) lit and tagged. */
function chartWords(parent: HTMLElement, lines: string[], fresh: ReadonlySet<number>): HTMLElement {
    const box = parent.createDiv({ cls: 'etz-help-words' });
    lines.forEach((line, i) => {
        const row = box.createDiv({ cls: 'etz-help-words-line' });
        if (fresh.has(i)) row.addClass('is-new');
        paintLine(row, line);
        if (fresh.has(i)) row.createSpan({ cls: 'etz-help-words-new', text: t('help.step.new') });
    });
    return box;
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
        live?.destroy();
        live = null;
        stepper = null;
        guideEl.empty();
        scroller.scrollTop = homeScroll;
        const target = returnFocus && returnFocus.isConnected ? returnFocus : searchInput;
        returnFocus = null;
        if (root.isShown()) target.focus({ preventScroll: true });
    }

    function showGuide(id: string, step?: number): boolean {
        const guide = localGuideById(id);
        if (!guide) return false;
        show('guide');
        lastRead = { guide: guide.id, step: 0 };
        buildGuide(guide, typeof step === 'number' ? step : 0);
        const target = guideEl.querySelector<HTMLElement>('.etz-help-step-title') || guideEl.querySelector<HTMLElement>('.etz-help-title');
        if (target && root.isShown()) target.focus({ preventScroll: true });
        return true;
    }

    function showReference(section?: string): boolean {
        if (!sectionHeadings) sectionHeadings = buildReference();
        const heading = section ? sectionHeadings.get(section) : undefined;
        if (section && !heading) return false;
        show('reference');
        pageLazy.clear();
        live?.destroy();
        live = null;
        stepper = null;
        guideEl.empty();
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

    /**
     * Draw a chart into `box` (its size set by CSS) once the box scrolls into
     * view; 3D charts zoom onto their drawing. A `$...$` label measured before
     * MathJax styled it draws once more.
     */
    function drawInto(box: HTMLElement, chart: ChartData, lazy: LazyJobs): void {
        let shown: SVGSVGElement | null = null;
        const draw = (redraws: number): void => {
            if (!box.isConnected) return;
            const drawn = renderFigure(chart, box.clientWidth, box.clientHeight);
            if (!drawn) {
                if (!shown) box.addClass('is-fallback');
                return;
            }
            if (shown) shown.replaceWith(drawn.svg);
            else box.appendChild(drawn.svg);
            shown = drawn.svg;
            if (chartIs3D(chart)) fitToContent(drawn.svg, 6);
            if (drawn.settled && redraws < MATH_REDRAW_LIMIT) {
                void drawn.settled.then((redraw) => {
                    if (redraw && shown === drawn.svg) draw(redraws + 1);
                });
            }
        };
        lazy.add(box, () => draw(0));
    }

    /** A guide (in the reader's language) as a tile: its finished chart, title, summary and steps. `hit` names the step a search found. */
    function guideCard(grid: HTMLElement, guide: Guide, lazy: LazyJobs, hit?: number | null): HTMLButtonElement {
        const card = grid.createEl('button', { cls: 'etz-help-tile', attr: { type: 'button' } });
        drawInto(card.createSpan({ cls: 'etz-help-tile-chart', attr: { 'aria-hidden': 'true' } }), guide.chart, lazy);
        const text = card.createSpan({ cls: 'etz-help-tile-text' });
        const title = text.createSpan({ cls: 'etz-help-tile-title', text: guide.title });
        if (chartIs3D(guide.chart)) title.createSpan({ cls: 'etz-help-badge', text: '3D' });
        // A summary may hold `code`: as everywhere in the Help, it shows as code.
        rich(text.createSpan({ cls: 'etz-help-tile-summary' }), guide.summary);
        const found = typeof hit === 'number' && guide.steps[hit] ? hit : null;
        if (found !== null) text.createSpan({ cls: 'etz-help-card-hit', text: t('help.card.step', { n: found + 1, title: guide.steps[found].title }) });
        text.createSpan({ cls: 'etz-help-tile-meta', text: t('help.guide.steps', { count: guide.steps.length }) });
        card.addEventListener('click', () => {
            leaveHome(card);
            showGuide(guide.id, found ?? undefined);
        });
        return card;
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
            const grid = resultsEl.createDiv({ cls: 'etz-help-tiles' });
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

    // Start here: the first guides, side by side.
    const firstGuides = guidesIn('Getting started').map(localGuide);
    if (firstGuides.length) {
        const section = browseEl.createEl('section', { cls: 'etz-help-home-part' });
        const label = section.createEl('h3', { cls: 'etz-help-label', text: t('help.home.start') });
        label.id = uniqueId('help-start');
        section.setAttr('aria-labelledby', label.id);
        const row = section.createDiv({ cls: 'etz-help-starts' });
        for (const guide of firstGuides) {
            const button = row.createEl('button', { cls: 'etz-help-start', attr: { type: 'button' } });
            button.createSpan({ cls: 'etz-help-start-title', text: guide.title });
            rich(button.createSpan({ cls: 'etz-help-start-summary' }), guide.summary);
            button.createSpan({ cls: 'etz-help-tile-meta', text: t('help.guide.steps', { count: guide.steps.length }) });
            button.addEventListener('click', () => {
                leaveHome(button);
                showGuide(guide.id);
            });
        }
    }

    // The chart language: the tour's finished chart in words, beside its picture.
    const tour = localGuideById(TOUR_ID);
    if (tour) {
        const feature = browseEl.createEl('section', { cls: 'etz-help-feature' });
        const side = feature.createDiv({ cls: 'etz-help-feature-side' });
        side.createSpan({ cls: 'etz-help-label', text: t('help.home.language.label') });
        const title = side.createEl('h3', { cls: 'etz-help-feature-title', text: t('help.home.language.title') });
        title.id = uniqueId('help-language');
        feature.setAttr('aria-labelledby', title.id);
        side.createEl('p', { cls: 'etz-help-p', text: t('help.home.language.text') });
        chartWords(side, chartLines(tour.chart), new Set());
        const buttons = side.createDiv({ cls: 'etz-help-row' });
        const take = textButton(buttons, {
            text: t('help.home.language.tour'),
            variant: 'cta',
            onClick: () => {
                leaveHome(take.el);
                showGuide(tour.id);
            },
        });
        const sheet = textButton(buttons, {
            text: t('help.home.cheatSheet'),
            onClick: () => {
                leaveHome(sheet.el);
                showReference('text');
            },
        });
        drawInto(feature.createDiv({ cls: 'etz-help-feature-chart', attr: { 'aria-hidden': 'true' } }), tour.chart, homeLazy);
    }

    // The gallery: every other guide as a tile, the chips show one category.
    const galleryCategories = GUIDE_CATEGORIES.filter((c) => c !== 'Getting started' && c !== 'Reference' && guidesIn(c).some((g) => g.id !== TOUR_ID));
    const gallery = browseEl.createEl('section', { cls: 'etz-help-home-part' });
    const galleryHead = gallery.createDiv({ cls: 'etz-help-gallery-head' });
    const galleryLabel = galleryHead.createEl('h3', { cls: 'etz-help-label', text: t('help.home.gallery') });
    galleryLabel.id = uniqueId('help-gallery');
    gallery.setAttr('aria-labelledby', galleryLabel.id);
    const chips = galleryHead.createDiv({ cls: 'etz-help-chips', attr: { role: 'group', 'aria-label': t('help.home.filter') } });
    const grid = gallery.createDiv({ cls: 'etz-help-tiles' });
    const tiles: Array<{ el: HTMLElement; category: GuideCategory }> = [];
    for (const category of galleryCategories) {
        for (const guide of guidesIn(category).map(localGuide)) {
            if (guide.id === TOUR_ID) continue;
            tiles.push({ el: guideCard(grid, guide, homeLazy), category });
        }
    }
    const chipEls: Array<{ el: HTMLButtonElement; category: GuideCategory | null }> = [];
    const pick = (category: GuideCategory | null): void => {
        for (const chip of chipEls) {
            chip.el.toggleClass('is-on', chip.category === category);
            chip.el.setAttr('aria-pressed', String(chip.category === category));
        }
        for (const tile of tiles) tile.el.toggleClass('tikz-hidden', category !== null && tile.category !== category);
    };
    for (const category of [null, ...galleryCategories]) {
        const el = chips.createEl('button', { cls: 'etz-help-chip', text: category ? guideCategoryLabel(category) : t('help.home.all'), attr: { type: 'button', 'aria-pressed': String(category === null) } });
        if (category === null) el.addClass('is-on');
        el.addEventListener('click', () => pick(category));
        chipEls.push({ el, category });
    }

    // The reference: its guides, and the sections of the cheat sheet.
    const reference = browseEl.createEl('section', { cls: 'etz-help-home-part' });
    const referenceLabel = reference.createEl('h3', { cls: 'etz-help-label', text: guideCategoryLabel('Reference') });
    referenceLabel.id = uniqueId('help-reference');
    reference.setAttr('aria-labelledby', referenceLabel.id);
    const referenceGuides = guidesIn('Reference').map(localGuide);
    if (referenceGuides.length) {
        const row = reference.createDiv({ cls: 'etz-help-tiles' });
        for (const guide of referenceGuides) guideCard(row, guide, homeLazy);
    }
    topicList(reference, referenceSections());

    // ---------------------------------------------------------------- guide

    /** The live chart of the step on screen, and how to move: set while a guide is open. */
    let live: LiveChart | null = null;
    let stepper: { go(i: number): void; step(): number } | null = null;

    /** Build the reader of a guide (in the reader's language), open at step `at`. */
    function buildGuide(guide: Guide, at: number): void {
        pageLazy.clear();
        live?.destroy();
        live = null;
        guideEl.empty();
        pageBar(guideEl, guideCategoryLabel(guide.category));

        const head = guideEl.createEl('header', { cls: 'etz-help-guide-head' });
        head.createEl('h3', { cls: ['etz-help-h', 'etz-help-title'], text: guide.title, attr: { tabindex: '-1' } });
        const count = head.createSpan({ cls: 'etz-help-step-count', attr: { 'aria-live': 'polite' } });
        const progress = guideEl.createDiv({ cls: 'etz-help-progress', attr: { 'aria-hidden': 'true' } });
        const segments = guide.steps.map(() => progress.createSpan());
        const stage = guideEl.createDiv({ cls: 'etz-help-stage' });
        const nav = guideEl.createDiv({ cls: 'etz-help-nav' });
        const back = textButton(nav, { text: t('help.step.back'), icon: 'arrow-left', onClick: () => go(now - 1) });
        nav.createSpan({ cls: 'etz-help-keys', text: t('help.step.keys') });
        const following = (guide.next || []).map((id) => localGuideById(id)).find((g): g is Guide => !!g && g.id !== guide.id) ?? null;
        const next = textButton(nav, {
            text: t('help.step.next'),
            variant: 'cta',
            onClick: () => {
                if (now < guide.steps.length - 1) go(now + 1);
                else if (following) showGuide(following.id);
                else showHome();
            },
        });

        let now = 0;
        const go = (i: number): void => {
            now = Math.max(0, Math.min(guide.steps.length - 1, i));
            if (lastRead && lastRead.guide === guide.id) lastRead.step = now;
            renderStep(guide, now, stage);
            count.setText(t('help.step.count', { n: now + 1, total: guide.steps.length }));
            segments.forEach((segment, k) => segment.toggleClass('is-done', k <= now));
            back.setDisabled(now === 0);
            const last = now === guide.steps.length - 1;
            next.setText(last ? (following ? t('help.step.nextGuide', { title: following.title }) : t('help.step.finish')) : t('help.step.next'));
            scroller.scrollTop = 0;
        };
        stepper = { go, step: () => now };
        go(at);

        const foot = guideEl.createEl('p', { cls: ['etz-help-p', 'etz-help-foot'] });
        const link = foot.createEl('a', { cls: 'external-link', text: t('help.guide.github'), href: guideUrl(guide.id) });
        link.setAttr('target', '_blank');
        link.setAttr('rel', 'noopener');
    }

    /** One step: its live chart beside what to do, and the chart in words with the lines this step added lit. */
    function renderStep(guide: Guide, index: number, stage: HTMLElement): void {
        live?.destroy();
        live = null;
        stage.empty();
        const step = guide.steps[index];
        const chart = stepChart(guide, index);
        const left = stage.createDiv({ cls: 'etz-help-stage-chart' });
        if (chart) {
            try {
                live = new LiveChart(left, chart, {
                    label: t('help.guide.figure', { n: index + 1, title: step.title }),
                    sliders: t('help.step.sliders'),
                    play: (name) => t('panels.whatsNew.play', { name }),
                    pause: (name) => t('panels.whatsNew.pause', { name }),
                    boxCls: 'etz-help-live',
                });
            } catch {
                left.addClass('is-fallback');
            }
        }
        const right = stage.createDiv({ cls: 'etz-help-stage-top' });
        stage.prepend(right);
        const title = right.createEl('h4', { cls: 'etz-help-step-title', attr: { tabindex: '-1' } });
        const [stepLead, stepTrail] = around(t('help.card.step', { n: index + 1 }), 'title');
        if (stepLead) visuallyHidden(title, stepLead);
        title.appendText(step.title);
        if (stepTrail) visuallyHidden(title, stepTrail);
        renderBody(right, step.body);
        if (index === 0 && guide.outcomes && guide.outcomes.length) {
            const outcomes = right.createDiv({ cls: 'etz-help-outcomes' });
            outcomes.createDiv({ cls: 'etz-help-label', text: t('help.guide.outcomes') });
            const ul = outcomes.createEl('ul', { cls: 'etz-help-list' });
            for (const outcome of guide.outcomes) rich(ul.createEl('li'), outcome);
        }
        if (step.type && step.type.length) typeRows(right, step.type);
        if (step.tip) {
            const [tipLead, tipTrail] = around(t('help.guide.tip'), 'tip');
            const tip = right.createDiv({ cls: 'etz-help-tip' });
            setIcon(tip.createSpan({ cls: 'etz-help-tip-icon', attr: { 'aria-hidden': 'true' } }), 'lightbulb');
            const text = tip.createDiv({ cls: 'etz-help-tip-text' });
            if (tipLead) visuallyHidden(text, tipLead);
            rich(text, step.tip);
            if (tipTrail) visuallyHidden(text, tipTrail);
        }
        if (!chart) return;
        const lines = chartLines(chart);
        const before = index > 0 ? stepChart(guide, index - 1) : null;
        const old = new Set(before ? chartLines(before) : []);
        const fresh = new Set<number>(before ? lines.map((line, k) => (old.has(line) ? -1 : k)).filter((k) => k >= 0) : []);
        const words = stage.createDiv({ cls: 'etz-help-stage-words' });
        words.createDiv({ cls: 'etz-help-label', text: t('help.step.words') });
        chartWords(words, lines, fresh);
        const row = words.createDiv({ cls: 'etz-help-row' });
        // The Help hides the preview: the chart opens on the Build tab, where it shows.
        textButton(row, { text: t('help.step.openEditor'), icon: 'pencil', size: 'sm', onClick: () => host.loadChart(live ? live.chart() : cloneData(chart), () => host.showTab('build')) });
        const copy = textButton(row, { text: t('help.step.copyChart'), icon: 'copy', size: 'sm' });
        let timer: number | null = null;
        copy.el.addEventListener('click', () => {
            const block = ['```easy-tikz', ...lines, '```'].join('\n');
            void navigator.clipboard.writeText(block).then(
                () => {
                    copy.setText(t('common.copied'));
                    if (timer !== null) window.clearTimeout(timer);
                    timer = window.setTimeout(() => {
                        timer = null;
                        copy.setText(t('help.step.copyChart'));
                    }, COPIED_MS);
                },
                () => new Notice(t('help.copyFailed'))
            );
        });
    }

    // The arrow keys move between the steps of the open guide (not while a field has the focus).
    guideEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (view !== 'guide' || !stepper || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || target.getAttribute('role') === 'slider')) return;
        if (e.key === 'ArrowRight') stepper.go(stepper.step() + 1);
        else if (e.key === 'ArrowLeft') stepper.go(stepper.step() - 1);
        else return;
        e.preventDefault();
    });

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

    // The next editor (a chart inserted into a note closes this one) opens the guide that was open, at its step.
    const resume = lastRead && localGuideById(lastRead.guide) ? { ...lastRead } : null;
    if (resume) {
        showGuide(resume.guide, resume.step);
        lastRead = { ...resume };
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
            live?.destroy();
            live = null;
            homeLazy.clear();
            pageLazy.clear();
            syncEscape();
        },
    };
}
