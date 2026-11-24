/*
 * The lines of 6.0 D in words, both ways: what parse.ts and print.ts call
 * for them. Pure: no DOM, no Obsidian.
 *
 *   draw the grid                                  lines that transforms move
 *   draw the grid from -2 to 2 in steps of 0.5
 *   draw the basis vectors                         î and ĵ (k̂ in 3D)
 *   transform the plane by A                       (3D: transform space by B)
 *   transform the plane by $z \mapsto z^2$
 *   transform the plane by $(x, y) \mapsto (x + y, y)$
 *   draw the eigenvectors of A, labelled
 *   shade the unit square, labelled "det A = {det(A)}"   (3D: the unit cube)
 *   shade the image of the unit square, labelled
 *   draw the span of v and w
 *
 * Full LaTeX (src/text/full.ts, its 6.0 D block): \draw[grid, from=-2, to=2,
 * step=0.5], \draw[basis vectors], \transform{A}, \draw[eigenvectors]{A},
 * \shade[unit square], \shade[unit square, image], \draw[span]{v, w}.
 */
import type { MessageKey } from '../i18n';
import { looksLikeLatex } from '../latex';
import { splitTop } from '../text/parse';
import { LINEAR_TYPES } from './tools';

type Data = Record<string, unknown>;

export { LINEAR_TYPES };

/** What each kind takes as options, for "unknown option" messages (chart words: they stay English). */
export const LINEAR_OPTION_HELP: Record<string, string> = {
    planeGrid: 'from a to b, in steps of s, in a colour, thin, thick, hidden',
    basisVectors: 'in a colour, thin, thick, hidden',
    transform: 'hidden',
    eigenvectors: 'in a colour, thin, thick, dashed, labelled, hidden',
    unitSquare: 'in a colour, opacity 0.3, labelled, labelled "text", hidden',
    span: 'in a colour, thin, thick, opacity 0.15, labelled, hidden',
};

/** The same in Full LaTeX. */
export const LINEAR_FULL_HELP: Record<string, string> = {
    planeGrid: 'a colour, thin, thick, from=a, to=b, spacing=s, hidden',
    basisVectors: 'a colour, thin, thick, hidden',
    transform: 'hidden',
    eigenvectors: 'a colour, thin, thick, dashed, labelled, hidden',
    unitSquare: 'a colour, opacity=0.3, image, labelled, label={text}, hidden',
    span: 'a colour, thin, thick, opacity=0.15, labelled, hidden',
};

export const LINEAR_KIND_WORDS: Record<string, MessageKey> = {
    planeGrid: 'linear.text.kindGrid',
    basisVectors: 'linear.text.kindBasis',
    transform: 'linear.text.kindTransform',
    eigenvectors: 'linear.text.kindEigenvectors',
    unitSquare: 'linear.text.kindUnitSquare',
    span: 'linear.text.kindSpan',
};

/** What a line of this part makes: its tool's type and fields; or the message when it is one of these lines but not written so. */
export interface LinearRead {
    type: 'planeGrid' | 'basisVectors' | 'transform' | 'eigenvectors' | 'unitSquare' | 'span';
    fields: Data;
    problem?: MessageKey;
}

/** `v and w` (and `u, v and w`) as the formulas. */
function andList(s: string): string[] {
    return splitTop(s, ',')
        .flatMap((p) => splitTop(p.text, ' and '))
        .map((p) => p.text.trim())
        .filter((p) => p);
}

/** `draw ...` (after the verb): the grid, the basis vectors, the eigenvectors or a span; null for any other line. */
export function readLinearDraw(rest: string): LinearRead | null {
    const t = rest.trim();
    const grid = /^(?:the\s+|a\s+)?grid(?![A-Za-z0-9_(])\s*([\s\S]*)$/i.exec(t);
    if (grid) {
        const tail = grid[1].trim();
        if (!tail) return { type: 'planeGrid', fields: {} };
        const m = /^(?:from\s+([\s\S]+?)\s+to\s+([\s\S]+?))?\s*(?:in\s+steps\s+of\s+([\s\S]+))?$/i.exec(tail);
        if (!m || (!m[1] && !m[3])) return { type: 'planeGrid', fields: {}, problem: 'linear.text.gridTakes' };
        const fields: Data = {};
        if (m[1]) {
            fields.from = m[1].trim();
            fields.to = m[2].trim();
        }
        if (m[3]) fields.spacing = m[3].trim();
        return { type: 'planeGrid', fields };
    }
    if (/^(?:the\s+)?(?:standard\s+)?basis\s+vectors?$/i.test(t)) return { type: 'basisVectors', fields: {} };
    const eig = /^(?:the\s+)?eigenvectors?(?![A-Za-z0-9_(])\s*([\s\S]*)$/i.exec(t);
    if (eig) {
        const of = /^of\s+([\s\S]+)$/i.exec(eig[1].trim());
        if (!of) return { type: 'eigenvectors', fields: {}, problem: 'linear.text.eigenTakes' };
        return { type: 'eigenvectors', fields: { matrix: of[1].trim() } };
    }
    const span = /^(?:the\s+)?span(?![A-Za-z0-9_(])\s*([\s\S]*)$/i.exec(t);
    if (span) {
        const of = /^of\s+([\s\S]+)$/i.exec(span[1].trim());
        const vectors = of ? andList(of[1]) : [];
        if (!vectors.length) return { type: 'span', fields: {}, problem: 'linear.text.spanTakes' };
        return { type: 'span', fields: { vectors: vectors.join('; ') } };
    }
    return null;
}

/** `shade ...` (after the verb): the unit square (cube), or its image; null for any other line. */
export function readLinearShade(rest: string): LinearRead | null {
    const m = /^(?:the\s+)?(image\s+of\s+the\s+)?unit\s+(?:square|cube)$/i.exec(rest.trim());
    if (!m) return null;
    return { type: 'unitSquare', fields: m[1] ? { image: true } : {} };
}

/** `transform ...` (after the verb): `the plane by X`, `space by X`, `by X`; null when it is no such line (a formula). */
export function readTransform(rest: string): LinearRead | null {
    const t = rest.trim();
    const m = /^(?:(?:the\s+)?plane\s+|(?:the\s+)?space\s+)?by\s+([\s\S]+)$/i.exec(t);
    if (m) return { type: 'transform', fields: { map: m[1].trim() } };
    if (/^(?:the\s+)?(?:plane|space)\b/i.test(t) || !t) return { type: 'transform', fields: {}, problem: 'linear.text.transformTakes' };
    return null;
}

/** Apply an option of this part to `target` of `kind`; true when it was one. */
export function linearOption(kind: string, target: Data, o: string, problem: (key: 'number') => void): boolean {
    const lower = o.trim().toLowerCase();
    const labelled = lower === 'labelled' || lower === 'labeled';
    if (kind === 'eigenvectors') {
        if (lower === 'dashed') return set(target, 'dashed', true);
        if (labelled) return set(target, 'valueLabel', true);
        return false;
    }
    if (kind === 'unitSquare' || kind === 'span') {
        if (labelled) return set(target, 'valueLabel', true);
        const m = /^opacity\s+(.+)$/i.exec(o.trim());
        if (m) {
            const n = Number(m[1]);
            if (!Number.isFinite(n) || n < 0 || n > 1) problem('number');
            else target.fillOpacity = n;
            return true;
        }
        return false;
    }
    if (kind === 'basisVectors') {
        if (labelled) return set(target, 'valueLabel', true);
        return false;
    }
    return false;
}

function set(target: Data, key: string, value: unknown): true {
    target[key] = value;
    return true;
}

// ---------------------------------------------------------------- print

/** What print.ts's Options does for a line: the words for some fields, `key=value` for the rest. */
export interface LineOptions {
    has(key: string): boolean;
    take(key: string, word: (v: unknown) => string | null): void;
    mark(...keys: string[]): void;
    colour(): void;
    /** `labelled "text"` for the label field. */
    label(): void;
    out: string[];
}

const strOf = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

/** Text a line can hold as one piece: no line break, no quote, no top-level comma or `seps`, no bar outside LaTeX. */
function clean(s: string, seps: string[] = []): boolean {
    if (!s.trim() || /[\r\n"]/.test(s)) return false;
    if (!looksLikeLatex(s) && /(^|[^|])\|(?![|-])/.test(s)) return false;
    return [',', ...seps].every((sep) => splitTop(s, sep).length === 1);
}

/** A formula as a line writes it: LaTeX in $...$. */
const formula = (s: string) => (looksLikeLatex(s) && !s.includes('$') ? `$${s}$` : s);

/** The statement of a tool of this part (null: no line form fits; it is written raw). */
export function linearHead(full: Data, o: LineOptions, is3D: boolean): string | null {
    switch (strOf(full.type)) {
        case 'planeGrid': {
            let head = 'draw the grid';
            const from = strOf(full.from).trim();
            const to = strOf(full.to).trim();
            const step = strOf(full.spacing).trim();
            if (from && to && clean(from, [' to ', ' in ']) && clean(to, [' to ', ' in '])) {
                head += ` from ${from} to ${to}`;
                o.mark('from', 'to');
            }
            if (step && clean(step, [' to ', ' in '])) {
                head += ` in steps of ${step}`;
                o.mark('spacing');
            }
            return head;
        }
        case 'basisVectors':
            return 'draw the basis vectors';
        case 'transform': {
            const map = strOf(full.map).trim();
            if (!map || !clean(map)) return null;
            o.mark('map');
            return `transform ${is3D ? 'space' : 'the plane'} by ${formula(map)}`;
        }
        case 'eigenvectors': {
            const matrix = strOf(full.matrix).trim();
            if (!matrix || !clean(matrix, [' and '])) return null;
            o.mark('matrix');
            return `draw the eigenvectors of ${formula(matrix)}`;
        }
        case 'unitSquare': {
            o.mark('image');
            const what = is3D ? 'cube' : 'square';
            return full.image === true ? `shade the image of the unit ${what}` : `shade the unit ${what}`;
        }
        case 'span': {
            const vectors = strOf(full.vectors)
                .split(';')
                .map((v) => v.trim())
                .filter((v) => v);
            if (!vectors.length || !vectors.every((v) => clean(v, [' and ']))) return null;
            o.mark('vectors');
            const list = vectors.map(formula);
            const names = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
            return `draw the span of ${names}`;
        }
        default:
            return null;
    }
}

/** The options of a tool of this part, in words where they have some. */
export function linearOptions(type: string, o: LineOptions): void {
    const thickness = (v: unknown) => (typeof v === 'string' && ['very thin', 'thin', 'thick', 'very thick'].includes(v) ? v : null);
    const opacity = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `opacity ${v}` : null);
    const labelled = (v: unknown) => (v === true ? 'labelled' : null);
    o.colour();
    switch (type) {
        case 'planeGrid':
        case 'basisVectors':
            o.take('thickness', thickness);
            break;
        case 'eigenvectors':
            o.take('thickness', thickness);
            o.take('dashed', (v) => (v === true ? 'dashed' : null));
            o.take('valueLabel', labelled);
            break;
        case 'unitSquare':
            o.take('fillOpacity', opacity);
            o.label();
            o.take('valueLabel', labelled);
            break;
        case 'span':
            o.take('thickness', thickness);
            o.take('fillOpacity', opacity);
            o.take('valueLabel', labelled);
            break;
    }
}
