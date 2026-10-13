/*
 * TikZ / pgfplots export. The picture is the preview's picture: function
 * curves are translated to pgfmath through the chart's MathContext, and
 * everything else (function fills, tangents, extrema, regions, curves,
 * points, segments, braces, their labels) is drawn from the same scene
 * primitives as the SVG renderer, as plain numeric coordinates.
 *
 * Every rule below was checked with pdflatex (TeX Live 2024, pgfplots
 * 1.18.1); the failing inputs are in the comments where they matter.
 * Draw order follows the scene layers (scene.ts): fills, function curves,
 * strokes, guides, markers, braces, texts, labels.
 */
import type { SettingsManager } from './settings';
import { AnnotationSize, FillPattern, Function3DParameters, MarkerSize, RendererConfig } from './types';
import { THICKNESS_MAP, TIKZ_COLOR_DEFS } from './colors';
import { FunctionInfo, MathContext, fmtNum, texLabel } from './mathcontext';
import { Pt, View, clipPolylineToView, pointInRings, simplifyPolyline } from './geometry';
import {
    ArrowHeads,
    BracePrim,
    Scene3D,
    SceneItem2D,
    StrokePrim,
    TextAnchor,
    TextPrim,
    computeScene2D,
    computeScene3D,
    edgeLabelSide3D,
    labelMetricsFor,
} from './scene';
import { sampleCurve } from './util';

// ------------------------------------------------------------------ tuning

/**
 * Marching-squares grid of the export scene (about the preview's full
 * quality). The preview's grid follows its on-screen size, so what the
 * scene places from the grid (region label spots) must not hinge on its
 * exact resolution: geometry labelPoint settles near-ties on its own.
 */
const EXPORT_GRID = { nx: 200, ny: 200 };
/** pgfplots samples per function plot (split between the pieces of a broken curve). */
const FUNCTION_SAMPLES = 300;
/** Fewest samples for one piece of a curve broken at jumps. */
const MIN_PIECE_SAMPLES = 12;
/** More samples than these exceed TeX's memory quickly (samples=20000 fails; 3D grows quadratically). */
const MAX_SAMPLES_2D = 500;
/** Most samples per axis of an exported surface: plane3d at samples=80 exceeds TeX's main memory. */
export const MAX_SAMPLES_3D = 60;
const DEFAULT_SAMPLES_3D = 30;
/** Fewest samples per axis the surface budget leaves a surface (fewer only when it has fewer itself). */
const MIN_SAMPLES_3D = 8;
/**
 * Sum of samples^2 over the surface plots of one picture (a surface cut
 * at planes counts once per piece): pgfplots keeps every surface point in
 * TeX's main memory (5e6 words) until the axis ends. 3 surfaces at 60 or 6
 * at 40 exceed it; 6000 peaks at about 83 %.
 */
const SURFACE_BUDGET = 6000;
/**
 * Paper the 3D box leaves for tick and axis labels (pgfplots allows 45pt =
 * 1.6 cm in 2D). Measured around boxes at 10 x 8 cm: 0.9 to 2.2 cm
 * across (wide tick labels such as 2,000 need the most), 0.5 to 1.3 cm
 * down (the most at elevation 0 and 90).
 */
const BOX_LABEL_MARGIN_X_CM = 1.6;
const BOX_LABEL_MARGIN_Y_CM = 1.2;
/**
 * 3D unit vectors (cm per data unit) outside this range fall back to
 * pgfplots' own scaling: TeX dimensions end at 575 cm and lose precision
 * far below 0.001 cm.
 */
const MIN_UNIT_CM = 1e-3;
const MAX_UNIT_CM = 500;
/** The preview's sampling of a function; its breaks (poles, steps) split the exported domain. */
const PREVIEW_SAMPLES = 500;
/** A curve broken into more pieces than this is exported as one plot. */
const MAX_PIECES = 24;
/** TeX reads whole lines (bufsize 200000 chars): break coordinate lists regularly. */
const COORDS_PER_LINE = 6;
/** Point budgets: 10 fills of 2000 points take 8 s and a 20000-point path exceeds TeX's main memory. */
const PATH_BUDGET = 3000;
const PICTURE_BUDGET = 15000;
/** Douglas-Peucker tolerance (fraction of the view) to start from; raised until the budgets hold. */
const SIMPLIFY_TOL = 1e-3;
const MAX_SIMPLIFY_TOL = 0.05;
/**
 * `restrict x/y/z to domain` margin in view spans. Coordinates about 100
 * spans outside the axis stop pgfplots with "Dimension too large"; 10 spans
 * compiled at every size up to 20 x 20 cm, 20 did not.
 */
const RESTRICT_MARGIN = 10;
/** Texts may sit this fraction of the view outside it (`clip mode=individual` keeps them visible). */
const TEXT_SLACK = 0.05;
/** Relative tolerance for "on the view border" tests. */
const VIEW_TOL = 1e-9;
/** Centred axes: the title is lifted this far over the y label above the axis tip (the preview's label gap plus one line of the label font). */
const MIDDLE_TITLE_LIFT_PT = 15;
/** Brace label distance from the brace's base line: raise (2pt) + amplitude (5pt) + a gap. */
const BRACE_LABEL_SHIFT = 9;

const MARK_SIZE: Record<MarkerSize, string> = { small: '1.5pt', normal: '2pt', large: '2.8pt' };
const FONT: Record<AnnotationSize, string> = { small: '\\footnotesize', normal: '\\small', large: '\\large' };
/** Legend text size, that of small labels: the default \normalsize legend covers about half as much again of the plot. */
const LEGEND_FONT = '\\footnotesize';
/** Node anchor for a text on the given side of its point (the anchor faces the point). */
const ANCHOR: Record<TextAnchor, string> = {
    center: 'center',
    above: 'south',
    below: 'north',
    left: 'east',
    right: 'west',
    'above right': 'south west',
    'below left': 'north east',
    'above left': 'south east',
    'below right': 'north west',
};
/** Opacity of `dim` markers (optimum of an unbounded problem), as in the preview. */
const DIM_OPACITY = 0.45;
/**
 * Labels on fills get a white backdrop instead of the preview's
 * background-coloured halo; the outer sep keeps it off a 2.8pt marker.
 */
const HALO = 'fill=white, fill opacity=0.7, text opacity=1, inner sep=1pt, rounded corners=1pt, outer sep=2pt';
/** Bold labels (region names) are drawn in a darker shade of their colour. */
const BOLD_INK = '!70!black';

const PATTERNS: Partial<Record<FillPattern, string>> = {
    horizontal: 'horizontal lines',
    vertical: 'vertical lines',
    crosshatch: 'crosshatch',
    dots: 'crosshatch dots',
    'north-east': 'north east lines',
    'north-west': 'north west lines',
};

/** TikZ line widths accepted verbatim; anything else exports as `thin`. */
const LINE_WIDTHS = new Set(['ultra thin', 'very thin', 'thin', 'semithick', 'thick', 'very thick', 'ultra thick']);

/**
 * CSS named colours (CSS Color 4), lower case. Hand-edited blocks may name
 * any of them and the preview paints the CSS value; xcolor's names of the
 * same spelling differ (lime, violet, darkgray, pink, cyan, ...), so the
 * export defines each one with its CSS value.
 */
const CSS_COLORS: Record<string, string> = {
    aliceblue: 'F0F8FF', antiquewhite: 'FAEBD7', aqua: '00FFFF', aquamarine: '7FFFD4', azure: 'F0FFFF',
    beige: 'F5F5DC', bisque: 'FFE4C4', black: '000000', blanchedalmond: 'FFEBCD', blue: '0000FF',
    blueviolet: '8A2BE2', brown: 'A52A2A', burlywood: 'DEB887', cadetblue: '5F9EA0', chartreuse: '7FFF00',
    chocolate: 'D2691E', coral: 'FF7F50', cornflowerblue: '6495ED', cornsilk: 'FFF8DC', crimson: 'DC143C',
    cyan: '00FFFF', darkblue: '00008B', darkcyan: '008B8B', darkgoldenrod: 'B8860B', darkgray: 'A9A9A9',
    darkgreen: '006400', darkgrey: 'A9A9A9', darkkhaki: 'BDB76B', darkmagenta: '8B008B', darkolivegreen: '556B2F',
    darkorange: 'FF8C00', darkorchid: '9932CC', darkred: '8B0000', darksalmon: 'E9967A', darkseagreen: '8FBC8F',
    darkslateblue: '483D8B', darkslategray: '2F4F4F', darkslategrey: '2F4F4F', darkturquoise: '00CED1', darkviolet: '9400D3',
    deeppink: 'FF1493', deepskyblue: '00BFFF', dimgray: '696969', dimgrey: '696969', dodgerblue: '1E90FF',
    firebrick: 'B22222', floralwhite: 'FFFAF0', forestgreen: '228B22', fuchsia: 'FF00FF', gainsboro: 'DCDCDC',
    ghostwhite: 'F8F8FF', gold: 'FFD700', goldenrod: 'DAA520', gray: '808080', green: '008000',
    greenyellow: 'ADFF2F', grey: '808080', honeydew: 'F0FFF0', hotpink: 'FF69B4', indianred: 'CD5C5C',
    indigo: '4B0082', ivory: 'FFFFF0', khaki: 'F0E68C', lavender: 'E6E6FA', lavenderblush: 'FFF0F5',
    lawngreen: '7CFC00', lemonchiffon: 'FFFACD', lightblue: 'ADD8E6', lightcoral: 'F08080', lightcyan: 'E0FFFF',
    lightgoldenrodyellow: 'FAFAD2', lightgray: 'D3D3D3', lightgreen: '90EE90', lightgrey: 'D3D3D3', lightpink: 'FFB6C1',
    lightsalmon: 'FFA07A', lightseagreen: '20B2AA', lightskyblue: '87CEFA', lightslategray: '778899', lightslategrey: '778899',
    lightsteelblue: 'B0C4DE', lightyellow: 'FFFFE0', lime: '00FF00', limegreen: '32CD32', linen: 'FAF0E6',
    magenta: 'FF00FF', maroon: '800000', mediumaquamarine: '66CDAA', mediumblue: '0000CD', mediumorchid: 'BA55D3',
    mediumpurple: '9370DB', mediumseagreen: '3CB371', mediumslateblue: '7B68EE', mediumspringgreen: '00FA9A', mediumturquoise: '48D1CC',
    mediumvioletred: 'C71585', midnightblue: '191970', mintcream: 'F5FFFA', mistyrose: 'FFE4E1', moccasin: 'FFE4B5',
    navajowhite: 'FFDEAD', navy: '000080', oldlace: 'FDF5E6', olive: '808000', olivedrab: '6B8E23',
    orange: 'FFA500', orangered: 'FF4500', orchid: 'DA70D6', palegoldenrod: 'EEE8AA', palegreen: '98FB98',
    paleturquoise: 'AFEEEE', palevioletred: 'DB7093', papayawhip: 'FFEFD5', peachpuff: 'FFDAB9', peru: 'CD853F',
    pink: 'FFC0CB', plum: 'DDA0DD', powderblue: 'B0E0E6', purple: '800080', rebeccapurple: '663399',
    red: 'FF0000', rosybrown: 'BC8F8F', royalblue: '4169E1', saddlebrown: '8B4513', salmon: 'FA8072',
    sandybrown: 'F4A460', seagreen: '2E8B57', seashell: 'FFF5EE', sienna: 'A0522D', silver: 'C0C0C0',
    skyblue: '87CEEB', slateblue: '6A5ACD', slategray: '708090', slategrey: '708090', snow: 'FFFAFA',
    springgreen: '00FF7F', steelblue: '4682B4', tan: 'D2B48C', teal: '008080', thistle: 'D8BFD8',
    tomato: 'FF6347', turquoise: '40E0D0', violet: 'EE82EE', wheat: 'F5DEB3', white: 'FFFFFF',
    whitesmoke: 'F5F5F5', yellow: 'FFFF00', yellowgreen: '9ACD32',
};

// ------------------------------------------------------------ small helpers

/** Colours used by the picture; emitted as `\definecolor` lines inside the tikzpicture. */
class ColorSet {
    private readonly defs = new Map<string, string>();

    /**
     * TikZ name for a chart colour, the colour the preview paints. Palette
     * keys map to `etRed` etc. (the preview's hex values; xcolor's own red,
     * green, purple look different; case-sensitive like the preview's
     * lookup). CSS hex values (#ff8800) and CSS colour names (any case) get a
     * definition with their CSS value, shared by equal values. Anything else
     * exports as black.
     */
    use(color: string): string {
        const key = String(color ?? '').trim();
        if (Object.prototype.hasOwnProperty.call(TIKZ_COLOR_DEFS, key)) {
            const def = TIKZ_COLOR_DEFS[key];
            if (def.name !== 'black') this.defs.set(def.name, def.hex);
            return def.name;
        }
        const hex = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(key);
        if (hex) {
            let h = hex[1].toUpperCase();
            if (h.length === 3) h = h.replace(/./g, (c) => c + c);
            return this.define(h);
        }
        const named = key.toLowerCase();
        return Object.prototype.hasOwnProperty.call(CSS_COLORS, named) ? this.define(CSS_COLORS[named]) : 'black';
    }

    /** `etHex<RRGGBB>`, defined once; black and white are xcolor's own (the same values). */
    private define(hex: string): string {
        if (hex === '000000') return 'black';
        if (hex === 'FFFFFF') return 'white';
        const name = `etHex${hex}`;
        this.defs.set(name, hex);
        return name;
    }

    lines(): string[] {
        return Array.from(this.defs.entries()).map(([name, hex]) => `\\definecolor{${name}}{HTML}{${hex}}`);
    }
}

function lineWidth(width: string): string {
    const w = String(width ?? '').trim();
    return LINE_WIDTHS.has(w) || Object.prototype.hasOwnProperty.call(THICKNESS_MAP, w) ? w : 'thin';
}

function finitePt(p: Pt | null | undefined): p is Pt {
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Inside the view widened by `slack` (a fraction of the view) plus a hair for rounding. */
function inView(p: Pt, view: View, slack: number): boolean {
    const ex = (view.xmax - view.xmin) * (slack + VIEW_TOL);
    const ey = (view.ymax - view.ymin) * (slack + VIEW_TOL);
    return p.x >= view.xmin - ex && p.x <= view.xmax + ex && p.y >= view.ymin - ey && p.y <= view.ymax + ey;
}

function samePt(a: Pt, b: Pt, view: View): boolean {
    return (
        Math.abs(a.x - b.x) <= (view.xmax - view.xmin) * VIEW_TOL * 10 &&
        Math.abs(a.y - b.y) <= (view.ymax - view.ymin) * VIEW_TOL * 10
    );
}

/**
 * A bound of a curve piece, rounded towards the inside of the piece (up
 * for a lower bound, down for an upper one) to a step of 1e-5 of the view
 * span: a piece that ends just before a jump must not cross it after
 * rounding (floor(x) on [0, 0.99999994] must not end at 1), and bisected
 * ends such as -7.2e-10 read as -1e-05 instead.
 */
function fmtInward(v: number, up: boolean, span: number): string {
    const step = Math.pow(10, Math.floor(Math.log10(span)) - 5);
    const q = (up ? Math.ceil(v / step) : Math.floor(v / step)) * step;
    const s = fmtNum(q);
    const r = Number(s);
    if (up ? r >= v : r <= v) return s;
    // fmtNum keeps 6 significant digits: far from 0 that can round outwards again.
    const digit = Math.pow(10, Math.floor(Math.log10(Math.abs(q) || 1)) - 5);
    return fmtNum(up ? r + digit : r - digit);
}

/**
 * One label line of text for TikZ: whitespace (newlines would end the
 * paragraph) collapsed, then read as a label (texLabel: math and LaTeX
 * commands kept, everything else printed as typed).
 */
function labelText(text: string): string {
    return texLabel(String(text ?? '').replace(/\s+/g, ' ').trim());
}

/** Source name as a TeX comment (names are identifiers; anything else is flattened). */
function comment(source: string): string {
    return `% ${String(source ?? '').replace(/[\r\n]+/g, ' ')}`;
}

/** A coordinate as text; float noise next to 0 (7.6e-20 for cos(pi / 2)) becomes 0. */
function fmtCoord(v: number, span: number): string {
    return Math.abs(v) <= span * VIEW_TOL ? '0' : fmtNum(v);
}

/** `x,y` of a point in the view. */
function xy(p: Pt, view: View): string {
    return `${fmtCoord(p.x, view.xmax - view.xmin)},${fmtCoord(p.y, view.ymax - view.ymin)}`;
}

function axisCs(p: Pt, view: View): string {
    return `(axis cs:${xy(p, view)})`;
}

/** `coordinates {...}` body, COORDS_PER_LINE tuples per line. */
function coordinateList(tuples: string[]): string {
    if (tuples.length <= COORDS_PER_LINE) return `{${tuples.join(' ')}}`;
    const lines: string[] = [];
    for (let i = 0; i < tuples.length; i += COORDS_PER_LINE) lines.push('  ' + tuples.slice(i, i + COORDS_PER_LINE).join(' '));
    return `{\n${lines.join('\n')}\n}`;
}

function num(v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}

// --------------------------------------------------------------- paths

interface Part {
    pts: Pt[];
    closed: boolean;
}

/**
 * One `\fill` / `\draw` with its subpaths. `heads` holds every command that
 * draws these subpaths (a patterned fill is a tint plus a hatch pass), so
 * the budget pass simplifies the geometry once for all of them.
 */
interface PathCmd {
    heads: string[];
    parts: Part[];
    /** Exact geometry (segments, straight lines, polygon outlines) is never simplified. */
    exact: boolean;
    /** Fills decide whether the picture needs `set layers`. */
    fill: boolean;
}

function pathPoints(cmd: PathCmd): number {
    let n = 0;
    for (const p of cmd.parts) n += p.pts.length;
    return n * cmd.heads.length;
}

/**
 * Simplify the non-exact paths so that every command stays within
 * PATH_BUDGET points and the picture within PICTURE_BUDGET, raising the
 * Douglas-Peucker tolerance step by step (always from the original points).
 */
function fitBudget(cmds: PathCmd[], view: View): void {
    const original = cmds.map((c) => c.parts.map((p) => ({ pts: p.pts, closed: p.closed })));
    const tols = cmds.map(() => SIMPLIFY_TOL);
    const apply = (k: number, tol: number) => {
        const cmd = cmds[k];
        cmd.parts = original[k]
            .map((p) => ({ pts: simplifyPolyline(p.pts, view, tol, p.closed), closed: p.closed }))
            .filter((p) => p.pts.length >= (p.closed ? 3 : 2));
    };
    let floor = SIMPLIFY_TOL;
    for (;;) {
        let total = 0;
        cmds.forEach((cmd, k) => {
            if (!cmd.exact) {
                let tol = Math.max(tols[k], floor);
                apply(k, tol);
                while (pathPoints(cmd) > PATH_BUDGET && tol < MAX_SIMPLIFY_TOL) {
                    tol *= 2;
                    apply(k, tol);
                }
                tols[k] = tol;
            }
            total += pathPoints(cmd);
        });
        if (total <= PICTURE_BUDGET || floor >= MAX_SIMPLIFY_TOL) return;
        floor *= 2;
    }
}

/** Subpath text lines: COORDS_PER_LINE coordinates per line, `-- cycle` closing closed parts. */
function pathLines(parts: Part[], view: View): string[] {
    const lines: string[] = [];
    for (const part of parts) {
        const tokens = part.pts.map((p) => axisCs(p, view));
        for (let i = 0; i < tokens.length; i += COORDS_PER_LINE) {
            const chunk = tokens.slice(i, i + COORDS_PER_LINE).join(' -- ');
            const last = i + COORDS_PER_LINE >= tokens.length;
            lines.push(last ? chunk + (part.closed ? ' -- cycle' : '') : chunk + ' --');
        }
    }
    return lines;
}

function renderPath(cmd: PathCmd, view: View): string[] {
    if (!cmd.parts.length) return [];
    const lines = pathLines(cmd.parts, view);
    return cmd.heads.map((head) => (lines.length === 1 ? `${head} ${lines[0]};` : `${head}\n  ${lines.join('\n  ')};`));
}

// ---------------------------------------------------------- the picture

/** Lines of one picture, grouped by layer; items comment their part of each layer. */
class Layers {
    readonly fills: Array<PathCmd | string> = [];
    readonly functions: string[] = [];
    readonly strokes: Array<PathCmd | string> = [];
    readonly guides: Array<PathCmd | string> = [];
    readonly markers: string[] = [];
    readonly braces: string[] = [];
    readonly texts: string[] = [];
    readonly labels: string[] = [];
    /** Lines before `\begin{axis}`: legend entries typeset into save boxes. */
    readonly boxes: string[] = [];

    paths(): PathCmd[] {
        const out: PathCmd[] = [];
        for (const list of [this.fills, this.strokes, this.guides]) for (const e of list) if (typeof e !== 'string') out.push(e);
        return out;
    }

    render(view: View): string[] {
        const out: string[] = [];
        const flat = (list: Array<PathCmd | string>) => {
            // A comment line stays only when its item drew something in this layer.
            const lines: string[] = [];
            let pending: string | null = null;
            for (const e of list) {
                if (typeof e === 'string') {
                    if (e.startsWith('% ')) pending = e;
                    else {
                        if (pending) lines.push(pending);
                        pending = null;
                        lines.push(e);
                    }
                    continue;
                }
                const drawn = renderPath(e, view);
                if (drawn.length && pending) lines.push(pending);
                if (drawn.length) pending = null;
                lines.push(...drawn);
            }
            return lines;
        };
        // Fills go below the axis lines (the preview draws axes over fills
        // and everything else over the axes). `axis on top` would also put
        // the axes over markers on the border, such as an LP corner (0, 0).
        const fills = flat(this.fills);
        if (fills.length) out.push('\\begin{pgfonlayer}{axis background}', ...fills, '\\end{pgfonlayer}');
        for (const list of [this.functions, this.strokes, this.guides, this.markers, this.braces, this.texts, this.labels]) {
            out.push(...flat(list));
        }
        return out;
    }
}

interface Libraries {
    patterns: boolean;
    braces: boolean;
}

/** Document wrapper: standalone document, or the tikzpicture with `% Needs:` lines for the user's preamble. */
function wrap(standalone: boolean, libs: Libraries, picture: string[]): string {
    const lines: string[] = [];
    const libraries: string[] = [];
    if (libs.patterns) libraries.push('patterns');
    if (libs.braces) libraries.push('decorations.pathreplacing');
    if (standalone) {
        lines.push('\\documentclass[border=5pt]{standalone}', '\\usepackage{pgfplots}', '\\pgfplotsset{compat=1.16}');
        for (const lib of libraries) lines.push(`\\usetikzlibrary{${lib}}`);
        lines.push('\\begin{document}');
    } else {
        lines.push('% Needs: \\usepackage{pgfplots}', '% Needs: \\pgfplotsset{compat=1.16}');
        for (const lib of libraries) lines.push(`% Needs: \\usetikzlibrary{${lib}}`);
    }
    lines.push(...picture);
    if (standalone) lines.push('\\end{document}');
    return lines.join('\n');
}

/** Axis options shared by 2D and 3D: title, size (`width=` / `height=` or unit vectors), axis labels. */
function commonOptions(config: RendererConfig, ctx: MathContext, size: string): string[] {
    const opts: string[] = [];
    const title = labelText(ctx.formatTemplate(String(config.title ?? '')));
    if (title) opts.push(`title={${title}}`);
    opts.push(size);
    if (config.showAxisLabels) {
        const labels: string[] = [];
        const x = labelText(String(config.xLabel ?? ''));
        const y = labelText(String(config.yLabel ?? ''));
        if (x) labels.push(`xlabel={${x}}`);
        if (y) labels.push(`ylabel={${y}}`);
        if (config.is3D) {
            const z = labelText(String(config.zLabel ?? ''));
            if (z) labels.push(`zlabel={${z}}`);
        }
        if (labels.length) opts.push(labels.join(', '));
    }
    return opts;
}

/** `width=..cm, height=..cm`: pgfplots fits the axis and its labels into the paper. */
function sizeOption(paper: { w: number; h: number }): string {
    return `width=${fmtNum(paper.w)}cm, height=${fmtNum(paper.h)}cm`;
}

/** Bounds of `restrict <axis> to domain`: the view widened by RESTRICT_MARGIN spans. */
function restrictBounds(lo: number, hi: number): [number, number] {
    const d = hi - lo;
    return [lo - RESTRICT_MARGIN * d, hi + RESTRICT_MARGIN * d];
}

function restrict(axis: 'x' | 'y' | 'z', lo: number, hi: number): string {
    const [a, b] = restrictBounds(lo, hi);
    return `restrict ${axis} to domain=${fmtNum(a)}:${fmtNum(b)}`;
}

function axisBlock(options: string[]): string[] {
    return ['\\begin{axis}[', ...options.map((o) => `  ${o},`), ']'];
}

// ----------------------------------------------------------------- 2D

/**
 * pgfplots code for a 2D chart (standalone document or snippet, see
 * settings.isStandalone). The scene is computed first, with the shared
 * context, so derived names (P1_x, ...) have their values before any
 * expression is translated.
 */
export function generateTikz2D(settings: SettingsManager, ctx: MathContext): string {
    const config = settings.toRendererConfig(ctx);
    const view: View = { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax };
    const polar = config.coordinateSystem === 'polar';
    const paperCm = settings.paperSize();
    const scene = computeScene2D({
        functions: config.functions || [],
        tools: config.tools || [],
        math: ctx,
        view: { ...view },
        grid: EXPORT_GRID,
        axisStyle: config.axisStyle || 'box',
        polar,
        labelMetrics: labelMetricsFor(paperCm.w, paperCm.h),
    });
    const items = scene.items || [];
    const colors = new ColorSet();
    const libs: Libraries = { patterns: false, braces: false };
    const layers = new Layers();

    for (const item of items) addFills(layers, item, colors, libs);
    const legends = addFunctions(layers, config, ctx, view, colors);
    for (const item of items) addStrokes(layers, item, colors, view);
    for (const item of items) addGuides(layers, item, colors, view);
    for (const item of items) addMarkers(layers, item, colors, view);
    const paper = paperScale(settings.paperSize(), view);
    for (const item of items) addBraces(layers, item, colors, view, paper, libs);
    for (const item of items) addTexts(layers, item, colors, view);
    addAnnotations2D(layers, config, ctx, items, colors, view);

    const paths = layers.paths();
    fitBudget(paths, view);
    const anyFill = paths.some((p) => p.fill && p.parts.length > 0);

    const opts = commonOptions(config, ctx, sizeOption(settings.paperSize()));
    opts.push(`xmin=${fmtNum(view.xmin)}, xmax=${fmtNum(view.xmax)}, ymin=${fmtNum(view.ymin)}, ymax=${fmtNum(view.ymax)}`);
    // Middle axes: the labels sit just beyond the arrow tips (x right of its
    // tip, y above its tip), where they cannot collide with the plot, as in
    // the preview. pgfplots' default puts them inside the plot next to the tips.
    if (config.axisStyle === 'middle') {
        opts.push('axis lines=middle, xlabel style={anchor=west}, ylabel style={anchor=south}');
        // The y label now stands above the tip of its axis, which is where pgfplots puts the title: with
        // the y axis in the middle of the plot the two would print on top of each other. The preview
        // draws the title above the label, so lift it by the label's line.
        const titled = !!labelText(ctx.formatTemplate(String(config.title ?? '')));
        if (titled && config.showAxisLabels && labelText(String(config.yLabel ?? ''))) opts.push(`title style={yshift=${MIDDLE_TITLE_LIFT_PT}pt}`);
    } else if (config.axisStyle === 'axes') opts.push('axis lines=left');
    if (config.gridMinor) opts.push(`grid=both, minor tick num=${Math.max(1, Math.round(num(config.minorTickNum, 5)))}`);
    else if (config.gridMajor) opts.push('grid=major');
    // Without rad, pgfplots evaluates sin(x) in degrees.
    opts.push('trig format plots=rad');
    // NaN and out-of-range samples become gaps instead of errors or straight connectors.
    opts.push('unbounded coords=jump');
    opts.push(`${restrict('x', view.xmin, view.xmax)}, ${restrict('y', view.ymin, view.ymax)}`);
    // Plots stay clipped to the axis; \node, \draw and \fill do not (labels at xmin = 0 stay visible).
    opts.push('clip mode=individual');
    // `axis equal` would change the limits; `axis equal image` keeps them and shrinks the box.
    if (config.equalScale || polar) opts.push('axis equal image');
    // Layers put the fills under the grid and axis lines (see Layers.render).
    if (anyFill) opts.push('set layers');
    if (legends) opts.push(`legend pos=north east, legend cell align=left, legend style={font=${LEGEND_FONT}}`);

    const picture = ['\\begin{tikzpicture}', ...colors.lines(), ...layers.boxes, ...axisBlock(opts), ...layers.render(view), '\\end{axis}', '\\end{tikzpicture}'];
    return wrap(settings.isStandalone(), libs, picture);
}

/** Layer 2: fills as even-odd polygons; a pattern is a second, full-opacity hatch pass over the tint. */
function addFills(layers: Layers, item: SceneItem2D, colors: ColorSet, libs: Libraries): void {
    if (!(item.fills || []).length) return;
    layers.fills.push(comment(item.source));
    for (const fill of item.fills) {
        const parts: Part[] = [];
        for (const ring of fill.rings || []) {
            if (ring.length >= 3 && ring.every(finitePt)) parts.push({ pts: ring, closed: true });
        }
        if (!parts.length) continue;
        const c = colors.use(fill.color);
        const opacity = clamp(num(fill.opacity, 0.25), 0, 1);
        const heads = [`\\fill[${c}, fill opacity=${fmtNum(opacity)}, even odd rule]`];
        const pattern = PATTERNS[fill.pattern];
        if (pattern) {
            // fill= and pattern= on one path draw only the pattern, so the tint is its own path.
            heads.push(`\\fill[pattern=${pattern}, pattern color=${c}, even odd rule]`);
            libs.patterns = true;
        }
        layers.fills.push({ heads, parts, exact: false, fill: true });
    }
}

/**
 * Layer 4: one `\addplot` per visible function (cartesian ones split
 * where the preview breaks the curve), with its legend entry right after
 * the first plot. Every plot without a legend entry gets `forget plot`:
 * pgfplots hands legend entries to plots by position. Returns whether any
 * legend entry was written.
 */
function addFunctions(layers: Layers, config: RendererConfig, ctx: MathContext, view: View, colors: ColorSet): boolean {
    const funcs = config.functions || [];
    let legends = false;
    for (const info of ctx.functions()) {
        const f = funcs[info.index];
        if (!f || info.hidden || info.error || info.domainError || !String(f.expression ?? '').trim()) continue;
        if (info.kind === 'parametric' && !String(f.expressionY ?? '').trim()) continue;
        let body: string;
        let pieces: Array<[string, string, number]>;
        try {
            if (info.kind === 'cartesian') {
                const d = info.domain;
                const lo = d ? Math.max(d[0], view.xmin) : view.xmin;
                const hi = d ? Math.min(d[1], view.xmax) : view.xmax;
                if (!(hi > lo)) continue;
                body = `{${ctx.pgf(f.expression, 'fn1', { fnKind: 'cartesian' })}}`;
                pieces = cartesianPieces(info, lo, hi, view);
            } else {
                const [lo, hi] = info.domain || [0, 2 * Math.PI];
                if (info.kind === 'parametric') {
                    const x = ctx.pgf(f.expression, 'fn1', { fnKind: 'parametric' });
                    const y = ctx.pgf(f.expressionY, 'fn1', { fnKind: 'parametric' });
                    body = `({${x}}, {${y}})`;
                } else {
                    const r = ctx.pgf(f.expression, 'fn1', { fnKind: 'polar' });
                    body = `({(${r})*cos(x)}, {(${r})*sin(x)})`;
                }
                pieces = curveDrawable(info, lo, hi, view) ? [[fmtNum(lo), fmtNum(hi), FUNCTION_SAMPLES]] : [];
            }
        } catch {
            // The context reported no error, so this cannot happen; never let one function break the export.
            continue;
        }
        // Nothing drawable: no plot and no legend entry. pgfplots drops a plot
        // whose points are all filtered away but keeps its entry, which then
        // labels the next function's line.
        if (!pieces.length) continue;
        const style = [colors.use(f.color), lineWidth(f.thickness)];
        if (f.dashed) style.push('dashed');
        const legend = f.showLegend ? legendText(info, f.expression, f.expressionY, f.legendLabel, ctx) : '';
        layers.functions.push(comment(info.name));
        pieces.forEach(([lo, hi, samples], i) => {
            const opts = [...style, `domain=${lo}:${hi}`, `samples=${samples}`];
            if (!(legend && i === 0)) opts.push('forget plot');
            layers.functions.push(`\\addplot[${opts.join(', ')}] ${body};`);
            if (legend && i === 0) {
                layers.functions.push(`\\addlegendentry{${legendEntry(legend, layers)}}`);
                legends = true;
            }
        });
    }
    return legends;
}

/**
 * Domains (formatted) and sample counts of a cartesian function's pieces:
 * the stretches the preview draws (sampleCurve breaks at poles, steps and
 * points far outside the view, the same rule as the 10-span restrict
 * margin). Empty when nothing is drawable; a curve broken into too many
 * pieces is one plot over [lo, hi].
 */
function cartesianPieces(info: FunctionInfo, lo: number, hi: number, view: View): Array<[string, string, number]> {
    const fn = info.fn;
    const runs = sampleCurve((x) => ({ x, y: fn(x) }), lo, hi, PREVIEW_SAMPLES, view);
    if (!runs.length) return [];
    if (runs.length > MAX_PIECES) return [[fmtNum(lo), fmtNum(hi), FUNCTION_SAMPLES]];
    const out: Array<[string, string, number]> = [];
    for (const run of runs) {
        const a = run[0].x;
        const b = run[run.length - 1].x;
        if (!(b > a)) continue;
        const samples = clamp(Math.round((FUNCTION_SAMPLES * (b - a)) / (hi - lo)), MIN_PIECE_SAMPLES, MAX_SAMPLES_2D);
        const from = a <= lo ? fmtNum(lo) : fmtInward(a, true, view.xmax - view.xmin);
        const to = b >= hi ? fmtNum(hi) : fmtInward(b, false, view.xmax - view.xmin);
        if (Number(to) > Number(from)) out.push([from, to, samples]);
    }
    return out;
}

/** Whether a parametric or polar curve has anything drawable on [lo, hi] (sampled like the preview). */
function curveDrawable(info: FunctionInfo, lo: number, hi: number, view: View): boolean {
    const fn = info.fn;
    if (info.kind === 'parametric') {
        const fy = info.fnY;
        return !!fy && sampleCurve((t) => ({ x: fn(t), y: fy(t) }), lo, hi, PREVIEW_SAMPLES, view).length > 0;
    }
    const at = (theta: number) => {
        const r = fn(theta);
        return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
    };
    return sampleCurve(at, lo, hi, PREVIEW_SAMPLES, view).length > 0;
}

/**
 * Legend entry text. pgfplots builds the legend as a TikZ matrix, so an
 * alignment (`&`, `\\`, e.g. the cases array of a piecewise function)
 * would split the legend's own cells and shift every later entry. Such
 * text is typeset into a save box before the axis instead (allocated once
 * per document, so a snippet may be pasted twice); the box is raised by its
 * depth because legend nodes have a fixed text depth.
 */
function legendEntry(text: string, layers: Layers): string {
    if (!/(^|[^\\])&|\\\\/.test(text)) return text;
    let n = layers.boxes.length / 2;
    let suffix = '';
    do {
        suffix = String.fromCharCode(65 + (n % 26)) + suffix;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    const box = `\\etzLegend${suffix}`;
    layers.boxes.push(`\\ifdefined${box}\\else\\newsavebox{${box}}\\fi`, `\\sbox{${box}}{${LEGEND_FONT} ${text}}`);
    return `\\raisebox{\\depth}{\\usebox{${box}}}`;
}

/** Legend text: the custom label as text, else the expression typeset like the preview's legend. */
function legendText(info: FunctionInfo, expression: string, expressionY: string, custom: string | undefined, ctx: MathContext): string {
    const own = String(custom ?? '').trim();
    if (own) return labelText(own);
    const tex = (src: string) => ctx.tex(String(src ?? ''));
    if (info.kind === 'parametric') return `\\(\\left(${tex(expression)},\\ ${tex(expressionY)}\\right)\\)`;
    if (info.kind === 'polar') return `\\(r = ${tex(expression)}\\)`;
    return `\\(${tex(expression)}\\)`;
}

/** Arrow tip option for a leg whose start / end survived clipping (a tip on a cut end would point at the border). */
function arrowOption(arrow: ArrowHeads | undefined, start: boolean, end: boolean): string {
    const s = start && (arrow === 'backward' || arrow === 'both');
    const e = end && (arrow === 'forward' || arrow === 'both');
    return s && e ? '<->' : s ? '<-' : e ? '->' : '';
}

/** Visible parts of one stroke line: clipped to the view in JS (TikZ paths are not clipped). */
function visibleParts(line: Pt[], closed: boolean, view: View): Array<{ pts: Pt[]; closed: boolean; start: boolean; end: boolean }> {
    if (!line || line.length < 2) return [];
    if (line.every((p) => finitePt(p) && inView(p, view, 0))) {
        return [{ pts: line, closed: closed && line.length > 2, start: true, end: true }];
    }
    const ring = closed && line.length > 2 ? [...line, line[0]] : line;
    return clipPolylineToView(ring, view)
        .filter((piece) => piece.length >= 2)
        .map((piece) => ({
            pts: piece,
            closed: false,
            start: finitePt(ring[0]) && samePt(piece[0], ring[0], view),
            end: finitePt(ring[ring.length - 1]) && samePt(piece[piece.length - 1], ring[ring.length - 1], view),
        }));
}

function strokeCmds(s: StrokePrim, colors: ColorSet, view: View, guide: boolean): PathCmd[] {
    const base = guide
        ? [colors.use(s.color), 'thin', 'dashed', 'draw opacity=0.6']
        : [colors.use(s.color), lineWidth(s.width), ...(s.dashed ? ['dashed'] : [])];
    const exact = !!s.exact;
    const arrow = guide ? undefined : s.arrow;
    if (!arrow) {
        const parts: Part[] = [];
        for (const line of s.lines || []) for (const p of visibleParts(line, !!s.closed, view)) parts.push({ pts: p.pts, closed: p.closed });
        return parts.length ? [{ heads: [`\\draw[${base.join(', ')}]`], parts, exact, fill: false }] : [];
    }
    // TikZ puts arrow tips only on a path's first and last subpath: one \draw per leg.
    const out: PathCmd[] = [];
    for (const line of s.lines || []) {
        for (const p of visibleParts(line, false, view)) {
            const tip = arrowOption(arrow, p.start, p.end);
            const opts = tip ? [...base, tip] : base;
            out.push({ heads: [`\\draw[${opts.join(', ')}]`], parts: [{ pts: p.pts, closed: false }], exact, fill: false });
        }
    }
    return out;
}

/** Layer 5: curves, segments, outlines, constraint lines, tangents. */
function addStrokes(layers: Layers, item: SceneItem2D, colors: ColorSet, view: View): void {
    if (!(item.strokes || []).length) return;
    layers.strokes.push(comment(item.source));
    for (const s of item.strokes) layers.strokes.push(...strokeCmds(s, colors, view, false));
}

/** Layer 6a: drop lines, dashed and thin like the preview's guides. */
function addGuides(layers: Layers, item: SceneItem2D, colors: ColorSet, view: View): void {
    if (!(item.guides || []).length) return;
    layers.guides.push(comment(item.source));
    for (const s of item.guides) layers.guides.push(...strokeCmds(s, colors, view, true));
}

/** Layer 6b: markers as `only marks` plots, one per colour / size run, all `forget plot`. */
function addMarkers(layers: Layers, item: SceneItem2D, colors: ColorSet, view: View): void {
    const groups: Array<{ key: string; opts: string; pts: string[] }> = [];
    for (const m of item.markers || []) {
        // Markers on the border are drawn whole; ones outside the view are dropped like in the preview.
        if (!finitePt(m) || !inView(m, view, 0)) continue;
        const c = colors.use(m.color);
        const size = MARK_SIZE[m.size] || MARK_SIZE.normal;
        const key = `${c}|${size}|${m.dim ? 1 : 0}`;
        let g = groups.length ? groups[groups.length - 1] : null;
        if (!g || g.key !== key) {
            const opts = ['only marks', 'mark=*', `mark size=${size}`, c, 'mark options={draw=white, line width=0.4pt}'];
            if (m.dim) opts.push(`opacity=${fmtNum(DIM_OPACITY)}`);
            opts.push('forget plot');
            g = { key, opts: opts.join(', '), pts: [] };
            groups.push(g);
        }
        g.pts.push(`(${xy(m, view)})`);
    }
    if (!groups.length) return;
    layers.markers.push(comment(item.source));
    for (const g of groups) layers.markers.push(`\\addplot[${g.opts}] coordinates ${coordinateList(g.pts)};`);
}

/** Paper units per math unit (cm), to place brace labels on the side the tip points to. */
function paperScale(paper: { w: number; h: number }, view: View): { x: number; y: number } {
    return { x: paper.w / (view.xmax - view.xmin), y: paper.h / (view.ymax - view.ymin) };
}

/** Node anchor facing direction (nx, ny): the node sits on that side of its point. */
function anchorToward(nx: number, ny: number): string {
    // sin(22.5 deg): directions within 22.5 degrees of an axis use a side anchor.
    const t = 0.38;
    const v = ny > t ? 'south' : ny < -t ? 'north' : '';
    const h = nx > t ? 'west' : nx < -t ? 'east' : '';
    return v && h ? `${v} ${h}` : v || h || 'center';
}

/**
 * Layer 7: braces. TikZ's brace decoration (no `mirror`) bulges to the
 * left of from -> to, the scene's convention; the label sits beyond the
 * tip, placed with the left normal in paper space.
 */
function addBraces(layers: Layers, item: SceneItem2D, colors: ColorSet, view: View, paper: { x: number; y: number }, libs: Libraries): void {
    const lines: string[] = [];
    for (const b of item.braces || []) {
        const seg = braceSegment(b, view);
        if (!seg) continue;
        const [from, to] = seg;
        const c = colors.use(b.color);
        const dx = (to.x - from.x) * paper.x;
        const dy = (to.y - from.y) * paper.y;
        const len = Math.hypot(dx, dy);
        if (!(len > 0)) continue;
        let cmd = `\\draw[decorate, decoration={brace, amplitude=5pt, raise=2pt}, ${c}, thick] ${axisCs(from, view)} -- ${axisCs(to, view)}`;
        const label = labelText(b.label);
        if (label) {
            const nx = -dy / len;
            const ny = dx / len;
            const node = [
                'midway',
                `anchor=${anchorToward(nx, ny)}`,
                `xshift=${fmtNum(nx * BRACE_LABEL_SHIFT)}pt`,
                `yshift=${fmtNum(ny * BRACE_LABEL_SHIFT)}pt`,
                c,
                `font=${FONT.normal}`,
            ];
            cmd += ` node[${node.join(', ')}] {${label}}`;
        }
        lines.push(cmd + ';');
        libs.braces = true;
    }
    if (!lines.length) return;
    layers.braces.push(comment(item.source), ...lines);
}

/** A brace's ends, clipped to the view widened by TEXT_SLACK (far-off coordinates stop pgfplots). */
function braceSegment(b: BracePrim, view: View): [Pt, Pt] | null {
    if (!finitePt(b.from) || !finitePt(b.to)) return null;
    const sx = (view.xmax - view.xmin) * TEXT_SLACK;
    const sy = (view.ymax - view.ymin) * TEXT_SLACK;
    const wide: View = { xmin: view.xmin - sx, xmax: view.xmax + sx, ymin: view.ymin - sy, ymax: view.ymax + sy };
    const pieces = clipPolylineToView([b.from, b.to], wide);
    return pieces.length ? [pieces[0][0], pieces[0][pieces[0].length - 1]] : null;
}

/**
 * A text node. `offset` (pt, x right, y up) is the label placer's shift for
 * a text with no room right beside its point: it becomes xshift / yshift,
 * so the node keeps its coordinate and the PDF matches the preview.
 */
function nodeCmd(
    color: string,
    anchor: string,
    size: AnnotationSize,
    halo: boolean,
    at: string,
    text: string,
    weight?: TextPrim['weight'],
    offset?: Pt
): string {
    const bold = weight === 'bold';
    const opts = [bold ? color + BOLD_INK : color, `anchor=${anchor}`, `font=${FONT[size] || FONT.normal}${bold ? '\\bfseries' : ''}`];
    if (halo) opts.push(HALO);
    if (offset && finitePt(offset)) {
        const pt = (v: number) => `${fmtNum(Math.round(v * 100) / 100)}pt`;
        if (Math.abs(offset.x) >= 0.005) opts.push(`xshift=${pt(offset.x)}`);
        if (Math.abs(offset.y) >= 0.005) opts.push(`yshift=${pt(offset.y)}`);
    }
    return `\\node[${opts.join(', ')}] at ${at} {${text}};`;
}

/** Layer 8: scene texts (point, region, curve, segment labels; min / max). */
function addTexts(layers: Layers, item: SceneItem2D, colors: ColorSet, view: View): void {
    const lines: string[] = [];
    for (const t of item.texts || []) {
        const text = labelText(t.text);
        if (!text || !finitePt(t) || !inView(t, view, TEXT_SLACK)) continue;
        lines.push(nodeCmd(colors.use(t.color), ANCHOR[t.anchor] || 'center', t.size, !!t.halo, axisCs(t, view), text, t.weight, t.offset));
    }
    if (!lines.length) return;
    layers.texts.push(comment(item.source), ...lines);
}

/** Layer 8, user labels: positions and text through the context like the preview; halo when on a fill. */
function addAnnotations2D(layers: Layers, config: RendererConfig, ctx: MathContext, items: SceneItem2D[], colors: ColorSet, view: View): void {
    const fills: Pt[][][] = [];
    for (const item of items) for (const f of item.fills || []) fills.push(f.rings || []);
    const lines: string[] = [];
    (config.annotations || []).forEach((a) => {
        if (!a || a.hidden) return;
        const text = labelText(ctx.formatTemplate(String(a.text ?? '')));
        if (!text) return;
        const p = { x: ctx.value(a.x), y: ctx.value(a.y) };
        if (!finitePt(p) || !inView(p, view, TEXT_SLACK)) return;
        const halo = fills.some((rings) => pointInRings(p, rings));
        lines.push(nodeCmd(colors.use(a.color), ANCHOR[a.anchor] || 'center', a.size, halo, axisCs(p, view), text));
    });
    if (lines.length) layers.labels.push('% labels', ...lines);
}

// ----------------------------------------------------------------- 3D

type Box = View & { zmin: number; zmax: number };
type Axis3 = 'x' | 'y' | 'z';
type Vec2 = [number, number];
type Vec3 = [number, number, number];

const AXIS_INDEX: Record<Axis3, number> = { x: 0, y: 1, z: 2 };

/**
 * pgfplots code for a 3D chart: surfaces as `\addplot3[surf|mesh]` with
 * the preview's shading (30 % tint at zmin to the full colour at zmax),
 * planes, points and segments from computeScene3D, labels. The axis takes
 * the preview's camera and box shape (previewCamera3D, unitVectors).
 */
export function generateTikz3D(settings: SettingsManager, ctx: MathContext): string {
    const config = settings.toRendererConfig(ctx);
    const box: Box = { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax, zmin: config.zmin, zmax: config.zmax };
    // Tools first: points publish derived names that surfaces and labels may read.
    const scene = computeScene3D({ tools: config.tools || [], math: ctx, view: { ...box } });
    const colors = new ColorSet();
    const camera = previewCamera3D(config);
    const paper = settings.paperSize();

    const surfaces: SurfaceSpec[] = [];
    (config.functions3D || []).forEach((f, i) => {
        const spec = surfaceSpec(f, i, ctx, box, colors);
        if (spec) surfaces.push(spec);
    });
    const planes: PlaneCmd[] = [];
    for (const plane of scene.planes || []) {
        const cmd = planeCmd(plane, box, colors);
        if (cmd) planes.push(cmd);
    }
    const body = surfacesAndPlanes(surfaces, planes, camera, box);
    body.push(...pointCmds(scene, box, colors));
    body.push(...segmentCmds(scene, box, colors));
    body.push(...annotationCmds3D(config, ctx, box, colors, camera));

    const vectors = unitVectors(camera, box, paper);
    const opts = commonOptions(config, ctx, vectors || sizeOption(paper));
    opts.push(`xmin=${fmtNum(box.xmin)}, xmax=${fmtNum(box.xmax)}`);
    opts.push(`ymin=${fmtNum(box.ymin)}, ymax=${fmtNum(box.ymax)}`);
    opts.push(`zmin=${fmtNum(box.zmin)}, zmax=${fmtNum(box.zmax)}`);
    // Without unit vectors pgfplots scales the box to the paper itself; its
    // view={az}{el} turns the other way round than the preview's azimuth.
    const view = `view={${fmtNum(-camera.azimuth)}}{${fmtNum(camera.elevation)}}`;
    if (!vectors) opts.push(view);
    opts.push('trig format plots=rad');
    opts.push('unbounded coords=jump');
    opts.push(restrict('z', box.zmin, box.zmax));
    // Plots stay clipped to the box; \node labels at its corners and edges stay visible (as in 2D and the preview).
    opts.push('clip mode=individual');

    const camNote = `% Camera as in the preview: azimuth ${fmtNum(camera.azimuth)}, elevation ${fmtNum(camera.elevation)} (pgfplots ${view})`;
    const note = vectors
        ? [camNote, `% x, y, z: its unit vectors, the box fitted to ${fmtNum(paper.w)} x ${fmtNum(paper.h)} cm with room for the labels`]
        : [camNote, '% Axis ranges too small or too large for exact unit vectors: pgfplots fits the box to width and height'];
    const picture = ['\\begin{tikzpicture}', ...colors.lines(), ...note, ...axisBlock(opts), ...body, '\\end{axis}', '\\end{tikzpicture}'];
    return wrap(settings.isStandalone(), { patterns: false, braces: false }, picture);
}

/** The 3D preview's camera (renderer3d prepareScene / project), so the PDF shows the box from the same side with the same shape. */
export interface Camera3D {
    /** Degrees, as stored (fallbacks 45 and 30). */
    azimuth: number;
    elevation: number;
    /**
     * Preview units per data unit on each axis: 2 / its range for boxAspect
     * 'equal' (a cube), 2 / the largest range for 'true' (data proportions).
     */
    factors: Vec3;
    /** Screen vectors (right, up) of one data unit along x, y and z, in preview units. */
    ex: Vec2;
    ey: Vec2;
    ez: Vec2;
    /** Unit vector from the box towards the viewer; per axis, its sign says which side of a plane is in front. */
    toViewer: Vec3;
}

/**
 * The preview's camera for a 3D chart. renderer3d projects a normalized
 * point n to right = nx cos(az) - ny sin(az), up = (nx sin(az) + ny cos(az))
 * sin(el) + nz cos(el). pgfplots' view={az}{el} turns the other way round,
 * so this camera is view={-az}{el}.
 */
export function previewCamera3D(config: RendererConfig): Camera3D {
    const range = (lo: number, hi: number) => hi - lo || 1;
    const ranges: Vec3 = [range(config.xmin, config.xmax), range(config.ymin, config.ymax), range(config.zmin, config.zmax)];
    const largest = Math.max(...ranges);
    const [fx, fy, fz] = ranges.map((r) => 2 / (config.boxAspect === 'true' ? largest : r));
    const azimuth = num(config.rotationZ, 45);
    const elevation = num(config.rotationX, 30);
    const a = (azimuth * Math.PI) / 180;
    const e = (elevation * Math.PI) / 180;
    return {
        azimuth,
        elevation,
        factors: [fx, fy, fz],
        ex: [Math.cos(a) * fx, Math.sin(a) * Math.sin(e) * fx],
        ey: [-Math.sin(a) * fy, Math.cos(a) * Math.sin(e) * fy],
        ez: [0, Math.cos(e) * fz],
        toViewer: [-Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e)],
    };
}

/**
 * `x={(..)}, y={(..)}, z={(..)}`: the camera's unit vectors in cm, scaled so
 * the projected box fits the paper less the label margins (pgfplots ignores
 * width and height once unit vectors are given, and `view` then has no
 * effect). Null when a unit would leave MIN_UNIT_CM..MAX_UNIT_CM (ranges
 * far apart, or tiny / huge).
 */
function unitVectors(camera: Camera3D, box: Box, paper: { w: number; h: number }): string | null {
    const spans: Vec3 = [box.xmax - box.xmin, box.ymax - box.ymin, box.zmax - box.zmin];
    const vecs = [camera.ex, camera.ey, camera.ez];
    // Box corners relative to (xmin, ymin, zmin), which projects to (0, 0).
    let left = 0;
    let right = 0;
    let bottom = 0;
    let top = 0;
    for (let corner = 1; corner < 8; corner++) {
        let sx = 0;
        let sy = 0;
        for (let k = 0; k < 3; k++) {
            if (!(corner & (1 << k))) continue;
            sx += vecs[k][0] * spans[k];
            sy += vecs[k][1] * spans[k];
        }
        left = Math.min(left, sx);
        right = Math.max(right, sx);
        bottom = Math.min(bottom, sy);
        top = Math.max(top, sy);
    }
    const fitW = Math.max(paper.w - BOX_LABEL_MARGIN_X_CM, paper.w / 2);
    const fitH = Math.max(paper.h - BOX_LABEL_MARGIN_Y_CM, paper.h / 2);
    const scale = Math.min(fitW / Math.max(right - left, 1e-9), fitH / Math.max(top - bottom, 1e-9));
    if (camera.factors.some((f) => !(f * scale >= MIN_UNIT_CM && f * scale <= MAX_UNIT_CM))) return null;
    const vec = (name: Axis3, v: Vec2) => `${name}={(${cm(v[0] * scale)},${cm(v[1] * scale)})}`;
    return [vec('x', camera.ex), vec('y', camera.ey), vec('z', camera.ez)].join(', ');
}

/** A length in cm, 6 significant digits, never in exponent form (TeX reads `1e-05cm` as 1 plus garbage). */
function cm(v: number): string {
    return Math.abs(v) < 1e-5 ? '0cm' : `${Number(v.toPrecision(6))}cm`;
}

/** A surface ready to emit, except for its domain pieces and samples. */
interface SurfaceSpec {
    name: string;
    /** The expression as pgfmath. */
    body: string;
    /** The preview's function, to find where the surface crosses the planes (null: not compilable). */
    fn: ((x: number, y: number) => number) | null;
    x: Vec2;
    y: Vec2;
    /** Samples per axis before the picture budget. */
    samples: number;
    /** `surf` / `mesh` and their colour options. */
    style: string[];
}

/** One `\addplot3` of a surface: its whole domain, or a piece of it between planes. */
interface SurfacePiece {
    x: Vec2;
    y: Vec2;
    nx: number;
    ny: number;
    /** `restrict z to domain` of a piece between z planes. */
    z: Vec2 | null;
}

interface PlaneCmd {
    axis: Axis3;
    value: number;
    line: string;
}

/** A surface's domain: the field, or the view range when empty or broken (the preview's fallback). */
function surfaceDomain(ctx: MathContext, src: string, fallback: Vec2): Vec2 {
    if (!src || !String(src).trim()) return fallback;
    return ctx.domain(src, fallback);
}

function surfaceSpec(f: Function3DParameters, index: number, ctx: MathContext, box: Box, colors: ColorSet): SurfaceSpec | null {
    if (!f || f.hidden || !String(f.expression ?? '').trim()) return null;
    let body: string;
    try {
        body = ctx.pgf(f.expression, 'fn2');
    } catch {
        // Reported by the preview on the expression field; nothing to draw.
        return null;
    }
    let fn: SurfaceSpec['fn'] = null;
    try {
        fn = ctx.fn2(f.expression);
    } catch {
        fn = null;
    }
    const c = colors.use(f.color);
    const map = `etSurface${index + 1}`;
    const style: string[] = [];
    if (f.wireframe) {
        // One-colour colormap: mesh lines take the surface colour.
        style.push('mesh', `colormap={${map}}{color=(${c}) color=(${c})}`);
    } else {
        const opacity = clamp(num(f.opacity, 0.7), 0, 1);
        style.push(
            'surf',
            `colormap={${map}}{color=(${c}!30!white) color=(${c})}`,
            `point meta min=${fmtNum(box.zmin)}, point meta max=${fmtNum(box.zmax)}`,
            `faceted color=${c}`,
            `opacity=${fmtNum(opacity)}`
        );
    }
    return {
        name: f.name || `Surface ${index + 1}`,
        body,
        fn,
        x: surfaceDomain(ctx, f.xDomain, [box.xmin, box.xmax]),
        y: surfaceDomain(ctx, f.yDomain, [box.ymin, box.ymax]),
        samples: clamp(Math.round(num(f.samples, DEFAULT_SAMPLES_3D)), 4, MAX_SAMPLES_3D),
        style,
    };
}

function surfaceLine(s: SurfaceSpec, p: SurfacePiece): string {
    const opts = [...s.style];
    if (p.z) opts.push(`restrict z to domain=${fmtNum(p.z[0])}:${fmtNum(p.z[1])}`);
    opts.push(`domain=${fmtNum(p.x[0])}:${fmtNum(p.x[1])}`, `y domain=${fmtNum(p.y[0])}:${fmtNum(p.y[1])}`, `samples=${p.nx}`);
    if (p.ny !== p.nx) opts.push(`samples y=${p.ny}`);
    return `\\addplot3[${opts.join(', ')}] {${s.body}};`;
}

/**
 * Surfaces and planes in painter's order, within SURFACE_BUDGET. pgfplots
 * does not depth-sort between plots: a plane drawn after a surface tints
 * all of it, where the preview hides the plane behind the surface's nearer
 * parts. So when every plane lies on one axis the camera does not see
 * edge-on, each surface is cut at the planes and its pieces are drawn far
 * to near with the planes in between. Planes on mixed axes keep the simple
 * order (surfaces, then planes). The budget lowers every surface's samples
 * by one factor until the picture fits.
 */
function surfacesAndPlanes(surfaces: SurfaceSpec[], planes: PlaneCmd[], camera: Camera3D, box: Box): string[] {
    const axis = cutAxis(planes, camera);
    let factor = 1;
    let plan = planSurfaces(surfaces, planes, axis, camera, box, factor);
    while (plan.cost > SURFACE_BUDGET && plan.reducible) {
        factor *= Math.min(0.95, Math.sqrt(SURFACE_BUDGET / plan.cost));
        plan = planSurfaces(surfaces, planes, axis, camera, box, factor);
    }
    return plan.lines;
}

/** The axis all planes share when the camera sees them at an angle; null otherwise (or without planes). */
function cutAxis(planes: PlaneCmd[], camera: Camera3D): Axis3 | null {
    if (!planes.length) return null;
    const axis = planes[0].axis;
    if (planes.some((p) => p.axis !== axis)) return null;
    return Math.abs(camera.toViewer[AXIS_INDEX[axis]]) > 1e-6 ? axis : null;
}

/**
 * The lines for surfaces and planes with every surface's samples scaled by
 * `factor` (never below MIN_SAMPLES_3D, never above its own count), their
 * cost (sum of nx * ny over the plots) and whether a smaller factor would
 * lower it.
 */
function planSurfaces(
    surfaces: SurfaceSpec[],
    planes: PlaneCmd[],
    axis: Axis3 | null,
    camera: Camera3D,
    box: Box,
    factor: number
): { lines: string[]; cost: number; reducible: boolean } {
    const lines: string[] = [];
    let cost = 0;
    let reducible = false;
    const samplesOf = (s: SurfaceSpec): number => {
        const least = Math.min(s.samples, MIN_SAMPLES_3D);
        const n = Math.max(least, Math.min(s.samples, Math.floor(s.samples * factor + 1e-9)));
        if (n > least) reducible = true;
        return n;
    };
    const emit = (s: SurfaceSpec, p: SurfacePiece, note: string) => {
        lines.push(comment(note ? `${s.name}, ${note}` : s.name), surfaceLine(s, p));
        cost += p.nx * p.ny;
    };
    if (!axis) {
        for (const s of surfaces) {
            const n = samplesOf(s);
            emit(s, { x: s.x, y: s.y, nx: n, ny: n, z: null }, '');
        }
        if (planes.length) lines.push('% planes', ...planes.map((p) => p.line));
        return { lines, cost, reducible };
    }
    // +1: larger values on the axis are nearer the viewer. Planes far to near.
    const toward = camera.toViewer[AXIS_INDEX[axis]] > 0 ? 1 : -1;
    const ordered = [...planes].sort((a, b) => (a.value - b.value) * toward);
    const values = ordered.map((p) => p.value);
    // Slot j lies in front of plane j - 1 and behind plane j.
    const slots: Array<Array<{ s: SurfaceSpec; p: SurfacePiece; split: boolean }>> = values.map(() => []);
    slots.push([]);
    for (const s of surfaces) {
        const n = samplesOf(s);
        const pieces = axis === 'z' ? zPieces(s, n, values, toward, box) : domainPieces(s, n, axis, values, toward);
        for (const { slot, piece } of pieces) slots[slot].push({ s, p: piece, split: pieces.length > 1 });
    }
    const where = (j: number): string => {
        const at = (i: number) => `${axis} = ${fmtNum(values[i])}`;
        if (j === 0) return `behind ${at(0)}`;
        if (j === values.length) return `in front of ${at(j - 1)}`;
        return `between ${at(j - 1)} and ${at(j)}`;
    };
    slots.forEach((slot, j) => {
        for (const { s, p, split } of slot) emit(s, p, split ? where(j) : '');
        if (j < ordered.length) lines.push(comment(`plane ${axis} = ${fmtNum(values[j])}`), ordered[j].line);
    });
    return { lines, cost, reducible };
}

/**
 * Pieces of a surface cut at x or y planes (`values` far to near): its
 * domain split at the planes, samples along the cut axis in proportion to
 * the piece (the pieces share their boundary samples, so no gap opens).
 */
function domainPieces(s: SurfaceSpec, n: number, axis: 'x' | 'y', values: number[], toward: number): Array<{ slot: number; piece: SurfacePiece }> {
    const [d0, d1] = axis === 'x' ? s.x : s.y;
    const len = d1 - d0;
    const out: Array<{ slot: number; piece: SurfacePiece }> = [];
    for (let j = 0; j <= values.length; j++) {
        // In front of values[j - 1], behind values[j].
        const from = j > 0 ? values[j - 1] : -toward * Infinity;
        const to = j < values.length ? values[j] : toward * Infinity;
        const lo = Math.max(d0, Math.min(from, to));
        const hi = Math.min(d1, Math.max(from, to));
        if (!(hi - lo > len * 1e-9)) continue;
        const m = Math.max(2, Math.round(((n - 1) * (hi - lo)) / len) + 1);
        out.push({
            slot: j,
            piece: axis === 'x' ? { x: [lo, hi], y: s.y, nx: m, ny: n, z: null } : { x: s.x, y: [lo, hi], nx: n, ny: m, z: null },
        });
    }
    if (out.length === 1) out[0].piece = { x: s.x, y: s.y, nx: n, ny: n, z: null };
    return out;
}

/**
 * Pieces of a surface cut at z planes (`values` far to near), each kept
 * with `restrict z to domain`. pgfplots drops a cell when a corner is
 * restricted away, so a cell that crosses a plane would vanish from both
 * sides: it stays with the farther piece, whose range reaches past the
 * plane by the height of those cells (found on pgfplots' own sample grid).
 * A surface that does not cross any plane is one plot in its slot.
 */
function zPieces(s: SurfaceSpec, n: number, values: number[], toward: number, box: Box): Array<{ slot: number; piece: SurfacePiece }> {
    const whole: SurfacePiece = { x: s.x, y: s.y, nx: n, ny: n, z: null };
    const [rlo, rhi] = restrictBounds(box.zmin, box.zmax);
    const fn = s.fn;
    if (!fn) return [{ slot: 0, piece: whole }];
    // Depth t = z * toward grows towards the viewer; NaN where pgfplots has no point.
    const t = new Float64Array(n * n);
    const dx = (s.x[1] - s.x[0]) / (n - 1);
    const dy = (s.y[1] - s.y[0]) / (n - 1);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const z = fn(s.x[0] + i * dx, s.y[0] + j * dy);
            t[i * n + j] = Number.isFinite(z) && z >= rlo && z <= rhi ? z * toward : NaN;
        }
    }
    const depths = values.map((v) => v * toward);
    // Per slot: whether it has a cell, and how far its cells reach past its front plane.
    const used = new Array<boolean>(values.length + 1).fill(false);
    const reach = new Array<number>(values.length).fill(0);
    for (let i = 0; i + 1 < n; i++) {
        for (let j = 0; j + 1 < n; j++) {
            const c = [t[i * n + j], t[i * n + j + 1], t[(i + 1) * n + j], t[(i + 1) * n + j + 1]];
            if (!c.every(Number.isFinite)) continue;
            const lo = Math.min(...c);
            const hi = Math.max(...c);
            let slot = depths.findIndex((d) => lo < d);
            if (slot < 0) slot = values.length;
            used[slot] = true;
            if (slot < values.length) reach[slot] = Math.max(reach[slot], hi - depths[slot]);
        }
    }
    const slots = used.map((u, j) => (u ? j : -1)).filter((j) => j >= 0);
    if (slots.length <= 1) return [{ slot: slots.length ? slots[0] : 0, piece: whole }];
    // A hair more for pgfmath's own rounding of the corner values.
    const eps = (box.zmax - box.zmin) * 1e-3;
    return slots.map((j) => {
        const back = j > 0 ? depths[j - 1] : -Infinity;
        const front = j < values.length ? depths[j] + reach[j] * 1.01 + eps : Infinity;
        // Back to z: depth bounds swap when the viewer looks from below.
        const [a, b] = toward > 0 ? [back, front] : [-front, -back];
        return { slot: j, piece: { ...whole, z: [Number.isFinite(a) ? a : rlo, Number.isFinite(b) ? b : rhi] } };
    });
}

function in3D(p: [number, number, number], box: Box, slack: number): boolean {
    const t = slack + VIEW_TOL;
    const ok = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo - (hi - lo) * t && v <= hi + (hi - lo) * t;
    return ok(p[0], box.xmin, box.xmax) && ok(p[1], box.ymin, box.ymax) && ok(p[2], box.zmin, box.zmax);
}

function tuple3(p: [number, number, number]): string {
    return `(${fmtNum(p[0])},${fmtNum(p[1])},${fmtNum(p[2])})`;
}

/** A plane spanning the box; planes outside it are not drawn (as in the preview). */
function planeCmd(plane: Scene3D['planes'][number], box: Box, colors: ColorSet): PlaneCmd | null {
    const v = plane.value;
    const [lo, hi] = plane.axis === 'x' ? [box.xmin, box.xmax] : plane.axis === 'y' ? [box.ymin, box.ymax] : [box.zmin, box.zmax];
    if (!Number.isFinite(v) || v < lo - (hi - lo) * VIEW_TOL || v > hi + (hi - lo) * VIEW_TOL) return null;
    const [u0, u1, w0, w1] =
        plane.axis === 'x' ? [box.ymin, box.ymax, box.zmin, box.zmax] :
        plane.axis === 'y' ? [box.xmin, box.xmax, box.zmin, box.zmax] :
        [box.xmin, box.xmax, box.ymin, box.ymax];
    const at = (u: number, w: number): [number, number, number] =>
        plane.axis === 'x' ? [v, u, w] : plane.axis === 'y' ? [u, v, w] : [u, w, v];
    const corners = [at(u0, w0), at(u1, w0), at(u1, w1), at(u0, w1), at(u0, w0)].map(tuple3);
    const c = colors.use(plane.color);
    const opacity = clamp(num(plane.opacity, 0.25), 0, 1);
    const opts = [c, `fill=${c}`, `fill opacity=${fmtNum(opacity)}`, `draw opacity=${fmtNum(Math.min(1, opacity + 0.3))}`, 'forget plot'];
    return { axis: plane.axis, value: v, line: `\\addplot3[${opts.join(', ')}] coordinates {${corners.join(' ')}};` };
}

function pointCmds(scene: Scene3D, box: Box, colors: ColorSet): string[] {
    const out: string[] = [];
    for (const p of scene.points || []) {
        const at: [number, number, number] = [p.x, p.y, p.z];
        if (!in3D(at, box, 0)) continue;
        const c = colors.use(p.color);
        const size = MARK_SIZE[p.size] || MARK_SIZE.normal;
        out.push(`\\addplot3[only marks, mark=*, mark size=${size}, ${c}, forget plot] coordinates {${tuple3(at)}};`);
        const label = labelText(p.label || '');
        if (label) out.push(`\\node[${c}, anchor=south west, font=${FONT.small}] at (axis cs:${tuple3(at).slice(1)} {${label}};`);
    }
    return out.length ? ['% points', ...out] : [];
}

/** Liang-Barsky clip of a 3D segment to the box: parameters [t0, t1] of the visible part, or null. */
function clipSegment3D(a: [number, number, number], b: [number, number, number], box: Box): [number, number] | null {
    let t0 = 0;
    let t1 = 1;
    const lo = [box.xmin, box.ymin, box.zmin];
    const hi = [box.xmax, box.ymax, box.zmax];
    for (let k = 0; k < 3; k++) {
        const d = b[k] - a[k];
        for (const [p, q] of [[-d, a[k] - lo[k]], [d, hi[k] - a[k]]]) {
            if (p === 0) {
                if (q < 0) return null;
                continue;
            }
            const r = q / p;
            if (p < 0) t0 = Math.max(t0, r);
            else t1 = Math.min(t1, r);
            if (t0 > t1) return null;
        }
    }
    return [t0, t1];
}

function segmentCmds(scene: Scene3D, box: Box, colors: ColorSet): string[] {
    const out: string[] = [];
    for (const s of scene.segments || []) {
        if (![...s.a, ...s.b].every(Number.isFinite)) continue;
        const span = clipSegment3D(s.a, s.b, box);
        if (!span) continue;
        const [t0, t1] = span;
        const at = (t: number): [number, number, number] => [0, 1, 2].map((k) => s.a[k] + (s.b[k] - s.a[k]) * t) as [number, number, number];
        const opts = [colors.use(s.color), lineWidth(s.width)];
        if (s.dashed) opts.push('dashed');
        const tip = arrowOption(s.arrow, t0 <= 0, t1 >= 1);
        if (tip) opts.push(tip);
        opts.push('forget plot');
        out.push(`\\addplot3[${opts.join(', ')}] coordinates {${tuple3(at(t0))} ${tuple3(at(t1))}};`);
    }
    return out.length ? ['% segments', ...out] : [];
}

function annotationCmds3D(config: RendererConfig, ctx: MathContext, box: Box, colors: ColorSet, camera: Camera3D): string[] {
    const out: string[] = [];
    (config.annotations || []).forEach((a) => {
        if (!a || a.hidden) return;
        const text = labelText(ctx.formatTemplate(String(a.text ?? '')));
        if (!text) return;
        // Labels migrated from a 2D chart have no z: they sit on z = 0.
        const z = a.z === undefined || a.z === null || !String(a.z).trim() ? 0 : ctx.value(a.z);
        const p: [number, number, number] = [ctx.value(a.x), ctx.value(a.y), z];
        if (!in3D(p, box, TEXT_SLACK)) return;
        // A centred label on an edge of the box steps aside, to the side the preview picks.
        const side = !a.anchor || a.anchor === 'center' ? edgeLabelSide3D(p, box, camera.ex, camera.ey, camera.ez) : null;
        out.push(nodeCmd(colors.use(a.color), ANCHOR[side || a.anchor] || 'center', a.size, false, `(axis cs:${tuple3(p).slice(1)}`, text));
    });
    return out.length ? ['% labels', ...out] : [];
}
