/*
 * Chart words: the pieces of the chart language (src/text/parse.ts) as
 * people may rename them. Every piece keeps its built-in words; a person
 * adds their own (several per piece: the first is the one the plugin
 * writes), and words of their own that stand for several options at once
 * (bundles: `objective` = `in red, dashed`).
 *
 * readWords turns their words into the built-in ones before the parser
 * reads a block; writeWords turns printed lines into theirs. Only whole
 * phrases are replaced: outside "quotes" and comment lines, never a name
 * right before "(" (a function such as rot(x)) and never a name the chart
 * defines. Title, label, size, set, raw and variables lines keep the rest of
 * their line as written. Pure, so the parser, the printer, the settings and
 * the tests share it.
 */

export type WordGroup = 'lines' | 'phrases' | 'options' | 'colours';

export interface Piece {
    /** Stable id (stored in the settings). */
    id: string;
    /** The built-in words the parser reads. */
    builtin: string;
    group: WordGroup;
    /** What it is, for the settings. */
    what: string;
    /** This piece only stands before a colour (`in red`); the same built-in word elsewhere is another piece. */
    beforeColour?: boolean;
    /** A word at the start of a line whose rest stays as written (`title Production plan`). */
    keepsRest?: boolean;
}

const piece = (id: string, builtin: string, group: WordGroup, what: string, extra: Partial<Piece> = {}): Piece => ({ id, builtin, group, what, ...extra });

/** The pieces, by group, in the order the settings show them. */
export const PIECES: readonly Piece[] = [
    piece('show', 'show', 'lines', 'Which part of the plane shows: show x from 0 to 5 and y from 0 to 4'),
    piece('size', 'size', 'lines', 'Size of the figure in cm: size 12 x 6', { keepsRest: true }),
    piece('axes', 'axes', 'lines', 'The axes: axes on the edges'),
    piece('on-the-edges', 'on the edges', 'lines', 'Axes along the edges'),
    piece('in-the-middle', 'in the middle', 'lines', 'Axes through the origin'),
    piece('in-a-box', 'in a box', 'lines', 'A frame with ticks'),
    piece('no-axes', 'no axes', 'lines', 'No axes'),
    piece('with-a-grid', 'with a grid', 'lines', 'A grid'),
    piece('with-a-fine-grid', 'with a fine grid', 'lines', 'A grid with minor lines too'),
    piece('equal-scale', 'equal scale', 'lines', 'The same unit on both axes'),
    piece('title', 'title', 'lines', 'A title over the chart', { keepsRest: true }),
    piece('xlabel', 'xlabel', 'lines', 'The name of the x-axis', { keepsRest: true }),
    piece('ylabel', 'ylabel', 'lines', 'The name of the y-axis', { keepsRest: true }),
    piece('slider', 'slider', 'lines', 'A slider: slider c from 0 to 15, starting at 6'),
    piece('plot', 'plot', 'lines', 'A function: plot f(x) = x^2'),
    piece('shade', 'shade', 'lines', 'A shaded region: shade where x + y <= 4'),
    piece('draw', 'draw', 'lines', 'A curve or a shape: draw 2x + 3y = 12'),
    piece('mark', 'mark', 'lines', 'Points: mark (1, 2) and (3, 4)'),
    piece('write', 'write', 'lines', 'A text label: write "optimum" at (3, 1)'),

    piece('from', 'from', 'phrases', 'Start of a range or a path'),
    piece('to', 'to', 'phrases', 'End of a range or a path'),
    piece('and', 'and', 'phrases', 'Joins ranges, conditions, points and options'),
    piece('where', 'where', 'phrases', 'The conditions of a region: shade where ...'),
    piece('between', 'between', 'phrases', 'A region between two functions'),
    piece('under', 'under', 'phrases', 'A region under a function'),
    piece('starting-at', 'starting at', 'phrases', 'Where a slider starts'),
    piece('in-steps-of', 'in steps of', 'phrases', 'The step of a slider'),
    piece('the-maximum-of', 'the maximum of', 'phrases', 'The highest point of a region: mark the maximum of 2x + 3y in R1'),
    piece('the-minimum-of', 'the minimum of', 'phrases', 'The lowest point of a region'),
    piece('the-corners-of', 'the corners of', 'phrases', 'The corners of a region'),
    piece('cross', 'cross', 'phrases', 'Where two curves cross: mark where f and g cross'),
    piece('the-integer-points-in', 'the integer points in', 'phrases', 'The whole-number points of a region'),
    piece('the-integer-maximum-of', 'the integer maximum of', 'phrases', 'The best whole-number point of a region'),
    piece('in-the-region', 'in the region', 'phrases', 'In the chart’s only region'),
    piece('the-region', 'the region', 'phrases', 'The chart’s only region'),
    piece('in-region', 'in', 'phrases', 'In a region: mark the corners of R1, the maximum of ... in R1'),
    piece('an-arrow', 'an arrow', 'phrases', 'An arrow: draw an arrow from (0, 0) to (3, 2)'),
    piece('a-double-arrow', 'a double arrow', 'phrases', 'An arrow with two heads'),
    piece('a-line', 'a line', 'phrases', 'A path through points: draw a line from A to B'),
    piece('a-polygon-through', 'a polygon through', 'phrases', 'A closed path'),
    piece('a-brace', 'a brace', 'phrases', 'A curly brace: draw a brace from A to B'),
    piece('the-plane', 'the plane', 'phrases', 'A plane in 3D: draw the plane z = 2'),
    piece('the-level-curves-of', 'the level curves of', 'phrases', 'Level curves: draw the level curves of x^2 + y^2 at 1 and 4'),
    piece('at', 'at', 'phrases', 'Where a text label goes, or the values of level curves'),

    piece('in-colour', 'in', 'options', 'Before a colour: in red', { beforeColour: true }),
    piece('dashed', 'dashed', 'options', 'Dashed'),
    piece('thick', 'thick', 'options', 'Thick'),
    piece('thin', 'thin', 'options', 'Thin'),
    piece('very-thick', 'very thick', 'options', 'Very thick'),
    piece('very-thin', 'very thin', 'options', 'Very thin'),
    piece('hidden', 'hidden', 'options', 'Not drawn, still usable by name'),
    piece('numbered', 'numbered', 'options', 'Constraint lines numbered (1), (2), ...'),
    piece('with-constraint-lines', 'with constraint lines', 'options', 'Each condition’s boundary across the view'),
    piece('outlined', 'outlined', 'options', 'A region’s border'),
    piece('with-a-dashed-outline', 'with a dashed outline', 'options', 'A dashed border'),
    piece('not-filled', 'not filled', 'options', 'A region without fill'),
    piece('filled', 'filled', 'options', 'A function filled to the x-axis'),
    piece('with-its-tangent-at', 'with its tangent at', 'options', 'A tangent: with its tangent at a'),
    piece('with-its-extrema', 'with its extrema', 'options', 'Highs and lows marked'),
    piece('with-a-legend', 'with a legend', 'options', 'A legend entry'),
    piece('with-the-legend', 'with the legend', 'options', 'A legend entry with its text: with the legend "Demand"'),
    piece('labelled', 'labelled', 'options', 'A label in quotes: labelled "z = {c}"'),
    piece('large', 'large', 'options', 'Large points or text'),
    piece('small', 'small', 'options', 'Small points or text'),
    piece('with-coordinates', 'with coordinates', 'options', 'Each point’s coordinates'),
    piece('with-lines-to-the-axes', 'with lines to the axes', 'options', 'Dashed guides from points to the axes'),
    piece('backwards', 'backwards', 'options', 'An arrow head at the start'),
    piece('above', 'above', 'options', 'A text label above its point'),
    piece('below', 'below', 'options', 'A text label below its point'),

    piece('red', 'red', 'colours', 'Red'),
    piece('blue', 'blue', 'colours', 'Blue'),
    piece('green', 'green', 'colours', 'Green'),
    piece('orange', 'orange', 'colours', 'Orange'),
    piece('purple', 'purple', 'colours', 'Purple'),
    piece('black', 'black', 'colours', 'Black'),
    piece('gray', 'gray', 'colours', 'Gray'),
    piece('brown', 'brown', 'colours', 'Brown'),
    piece('teal', 'teal', 'colours', 'Teal'),
    piece('magenta', 'magenta', 'colours', 'Magenta'),
];

export const GROUP_TITLES: Record<WordGroup, string> = { lines: 'Lines', phrases: 'Phrases', options: 'Options', colours: 'Colours' };

/** A word of a person's own for several options at once. */
export interface Bundle {
    word: string;
    /** What it stands for, written as options: `in red, dashed`. */
    means: string;
}

/** A person's chart words. */
export interface ChartWords {
    /** Piece id -> their words (the first is the one the plugin writes). */
    words: Record<string, string[]>;
    bundles: Bundle[];
    /** What the editor and the AI tools write: their words or the built-in ones. */
    write: 'yours' | 'builtin';
}

export const NO_WORDS: ChartWords = { words: {}, bundles: [], write: 'yours' };

const PIECE_BY_ID = new Map(PIECES.map((p) => [p.id, p]));
const COLOUR_WORDS = new Set(PIECES.filter((p) => p.group === 'colours').map((p) => p.builtin));
/** Every word a chart uses in its own way: none of them can be a chart word. */
const BUILTIN_WORDS = new Set(PIECES.map((p) => p.builtin.toLowerCase()));
/** Names formulas use, and words of the syntax that are no piece. */
const RESERVED = new Set([
    'x', 'y', 'z', 't', 'e', 'pi', 'theta', 'sin', 'cos', 'tan', 'exp', 'ln', 'log', 'sqrt', 'abs', 'min', 'max', 'or', 'not',
    'set', 'raw', 'variables', 'view', 'grid', 'polar', '3d', 'snippet', 'line', 'curve', 'levels', 'point', 'points', 'text', 'plane',
    'arrow', 'segment', 'polygon', 'brace', 'integer', 'crossings', 'corners', 'zlabel', 'with', 'no', 'double', 'the', 'a', 'an', 'its',
]);

/** Does this person have any words of their own? */
export function hasWords(w: ChartWords | null | undefined): w is ChartWords {
    return !!w && (Object.values(w.words).some((list) => list.length > 0) || w.bundles.some((b) => b.word && b.means));
}

/** The chart words now (the plugin sets them from its settings; tests pass their own). */
let current: ChartWords = NO_WORDS;

export function setChartWords(w: ChartWords | null | undefined) {
    current = w ? clean(w) : NO_WORDS;
}

export function chartWords(): ChartWords {
    return current;
}

/** Words as stored, made safe: known pieces only, trimmed, no empty words, no word twice. */
export function clean(w: Partial<ChartWords>): ChartWords {
    const words: Record<string, string[]> = {};
    const raw = w.words && typeof w.words === 'object' ? w.words : {};
    for (const [id, list] of Object.entries(raw)) {
        if (!PIECE_BY_ID.has(id) || !Array.isArray(list)) continue;
        const seen = new Set<string>();
        const kept = list
            .map((s) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : ''))
            .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()) && s.toLowerCase() !== PIECE_BY_ID.get(id)?.builtin);
        if (kept.length) words[id] = kept;
    }
    const bundles = (Array.isArray(w.bundles) ? w.bundles : [])
        .map((b) => ({ word: typeof b?.word === 'string' ? b.word.trim().replace(/\s+/g, ' ') : '', means: typeof b?.means === 'string' ? b.means.trim() : '' }))
        .filter((b) => b.word && b.means);
    return { words, bundles, write: w.write === 'builtin' ? 'builtin' : 'yours' };
}

/** Why `word` cannot be one of the words of piece `id` (or a bundle, with `id` null); '' when it can. */
export function wordProblem(word: string, id: string | null, w: ChartWords): string {
    const lower = word.toLowerCase();
    if (!/^[\p{L}][\p{L}\p{N}' -]*$/u.test(word)) return `"${word}": use letters, spaces, hyphens and apostrophes, and start with a letter.`;
    if (RESERVED.has(lower)) return `"${word}" is a word of the chart language or a name formulas use.`;
    const own = id ? PIECE_BY_ID.get(id) : undefined;
    if (BUILTIN_WORDS.has(lower) && (!own || own.builtin !== lower)) {
        const other = PIECES.find((p) => p.builtin === lower);
        return `"${word}" is already the built-in word for "${other ? other.builtin : lower}".`;
    }
    for (const [other, list] of Object.entries(w.words)) {
        if (other === id) continue;
        if (list.some((x) => x.toLowerCase() === lower)) return `"${word}" is already your word for "${PIECE_BY_ID.get(other)?.builtin ?? other}".`;
    }
    if (w.bundles.some((b) => b.word.toLowerCase() === lower)) return `"${word}" is already one of your bundle words.`;
    return '';
}

// ------------------------------------------------------------- matching

interface Entry {
    /** The words to find (a phrase may span several words). */
    find: string;
    re: RegExp;
    /** What they become. */
    to: string;
    beforeColour?: boolean;
    /** Single words: a name the chart defines is left alone. */
    single: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function entry(find: string, to: string, beforeColour?: boolean): Entry {
    return {
        find,
        // Sticky and case-blind; the spaces of a phrase match any run of spaces.
        re: new RegExp(escape(find).replace(/ +/g, '\\s+'), 'iuy'),
        to,
        beforeColour,
        single: !/\s/.test(find),
    };
}

const byLength = (a: Entry, b: Entry) => b.find.length - a.find.length;

interface Tables {
    read: Entry[];
    write: Entry[];
    bundles: Entry[];
    /** Their colour words and the built-in ones, lowercase: what may follow an `in` before a colour. */
    colours: Set<string>;
    /** Line starts whose rest stays as written (built-in and their words), lowercase. */
    keepsRest: string[];
    /** Line starts followed by a name (slider and their words for it), lowercase: the name stays as written. */
    named: string[];
}

const tables = new WeakMap<ChartWords, Tables>();

function tablesOf(w: ChartWords): Tables {
    let t = tables.get(w);
    if (t) return t;
    const read: Entry[] = [];
    const write: Entry[] = [];
    const colours = new Set(COLOUR_WORDS);
    const keepsRest = PIECES.filter((p) => p.keepsRest).map((p) => p.builtin);
    const named = ['slider', ...(w.words.slider ?? []).map((x) => x.toLowerCase())];
    for (const p of PIECES) {
        const list = w.words[p.id] ?? [];
        for (const word of list) {
            read.push(entry(word, p.builtin, p.beforeColour));
            if (p.group === 'colours') colours.add(word.toLowerCase());
            if (p.keepsRest) keepsRest.push(word.toLowerCase());
        }
        // Two pieces are the built-in `in`: before a colour, and before a region. Written, the colour decides which.
        if (list.length) write.push(entry(p.builtin, list[0], p.beforeColour ?? (p.builtin === 'in' ? false : undefined)));
    }
    const bundles = w.bundles.filter((b) => b.word && b.means).map((b) => entry(b.word, b.means));
    t = { read: read.sort(byLength), write: write.sort(byLength), bundles: bundles.sort(byLength), colours, keepsRest, named };
    tables.set(w, t);
    return t;
}

const WORD = /[\p{L}\p{N}_]/u;
const wordAt = (s: string, i: number) => i >= 0 && i < s.length && WORD.test(s[i]);

/** The words that follow position `i`: the next word, lowercase (for "before a colour"). */
function nextWord(s: string, i: number): string {
    const m = /^\s*([\p{L}\p{N}_]+)/u.exec(s.slice(i));
    return m ? m[1].toLowerCase() : '';
}

/** Lines that stay as they are: comments, and set, raw and variables lines. */
const VERBATIM = /^\s*(?:%|\/\/|#|(?:set|raw|variables)\b)/i;

/**
 * Replace the entries of `table` in one line, longest first, where they
 * stand as whole words outside quotes. `map[k]` is the column of the
 * original line that the k-th character of the result comes from.
 */
function replaceLine(
    line: string,
    table: Entry[],
    names: ReadonlySet<string>,
    colours: ReadonlySet<string>,
    keepsRest: readonly string[],
    named: readonly string[] = []
): { text: string; map: number[] } {
    const map: number[] = [];
    let out = '';
    const keep = (from: number, to: number) => {
        out += line.slice(from, to);
        for (let k = from; k < to; k++) map.push(k);
    };
    if (!table.length || VERBATIM.test(line)) {
        keep(0, line.length);
        return { text: out, map };
    }
    // A name at the start (`R1: ...`) is never a word of the language; `title: ...` is a title.
    const prefix = /^\s*([\p{L}][\p{L}\p{N}_]*)\s*:(?!=)\s*/u.exec(line);
    const titled = prefix && keepsRest.includes(prefix[1].toLowerCase());
    let i = prefix && !titled ? prefix[0].length : /^\s*/.exec(line)?.[0].length ?? 0;
    keep(0, i);
    let quote = false;
    let first = true;
    /** After a slider word: the slider's name, kept as written. */
    const keepName = () => {
        const m = /^\s*[\p{L}][\p{L}\p{N}_]*/u.exec(line.slice(i));
        if (m) {
            keep(i, i + m[0].length);
            i += m[0].length;
        }
    };
    while (i < line.length) {
        const c = line[i];
        if (quote) {
            if (c === '\\' && i + 1 < line.length) {
                keep(i, i + 2);
                i += 2;
                continue;
            }
            if (c === '"') quote = false;
            keep(i, i + 1);
            i++;
            continue;
        }
        if (c === '"') {
            quote = true;
            keep(i, i + 1);
            i++;
            continue;
        }
        if (!wordAt(line, i - 1) && WORD.test(c)) {
            let hit: Entry | null = null;
            let length = 0;
            for (const e of table) {
                e.re.lastIndex = i;
                const m = e.re.exec(line);
                if (!m) continue;
                const end = i + m[0].length;
                if (wordAt(line, end) || line[end] === '(') continue;
                if (e.single && names.has(m[0].toLowerCase())) continue;
                if (e.beforeColour !== undefined && e.beforeColour !== colours.has(nextWord(line, end))) continue;
                hit = e;
                length = m[0].length;
                break;
            }
            if (hit) {
                out += hit.to;
                for (let k = 0; k < hit.to.length; k++) map.push(i);
                const startsLine = first;
                i += length;
                // A title or a size: the rest of the line is the title, the size.
                if (startsLine && (keepsRest.includes(hit.to.toLowerCase()) || keepsRest.includes(hit.find.toLowerCase()))) {
                    keep(i, line.length);
                    return { text: out, map };
                }
                if (startsLine && (named.includes(hit.to.toLowerCase()) || named.includes(hit.find.toLowerCase()))) keepName();
                first = false;
                continue;
            }
            // A line that starts with a word of its own (a title in the built-in word): its rest stays too.
            const word = /^[\p{L}\p{N}_]+/u.exec(line.slice(i))?.[0] ?? '';
            if (first && keepsRest.includes(word.toLowerCase())) {
                keep(i, line.length);
                return { text: out, map };
            }
            const startsLine = first;
            first = false;
            keep(i, i + word.length);
            i += word.length;
            if (startsLine && named.includes(word.toLowerCase())) keepName();
            continue;
        }
        if (!/\s/.test(c)) first = false;
        keep(i, i + 1);
        i++;
    }
    return { text: out, map };
}

export interface ReadText {
    /** The text in built-in words. */
    text: string;
    /** Per line, the column of the typed line each character comes from. */
    maps: number[][];
}

/**
 * A block in someone's words as the parser reads it: bundles opened up,
 * then their words made the built-in ones. `names`: names the chart defines
 * (lowercase), which stay names.
 */
export function readWords(text: string, w: ChartWords, names: ReadonlySet<string> = new Set()): ReadText {
    const t = tablesOf(w);
    const lines = text.split(/\r\n?|\n/);
    const texts: string[] = [];
    const maps: number[][] = [];
    for (const line of lines) {
        const opened = replaceLine(line, t.bundles, names, t.colours, t.keepsRest, t.named);
        const read = replaceLine(opened.text, t.read, names, t.colours, t.keepsRest, t.named);
        texts.push(read.text);
        maps.push(read.map.map((k) => (k < opened.map.length ? opened.map[k] : line.length)));
    }
    return { text: texts.join('\n'), maps };
}

/** A line in built-in words in someone's words: what the plugin writes for them. */
export function writeWords(line: string, w: ChartWords, names: ReadonlySet<string> = new Set()): string {
    const t = tablesOf(w);
    return replaceLine(line, t.write, names, COLOUR_WORDS, t.keepsRest, t.named).text;
}

/**
 * A block written with the words `from` in the words `to`, changing only
 * what changed: a word that is gone becomes the piece's new word (or its
 * built-in word), a bundle word that is gone becomes what it stood for.
 * Every other word, comment and space stays as typed.
 */
export function renameWords(text: string, from: ChartWords, to: ChartWords, names: ReadonlySet<string> = new Set()): string {
    const inTo = new Set<string>();
    for (const list of Object.values(to.words)) for (const x of list) inTo.add(x.toLowerCase());
    for (const b of to.bundles) inTo.add(b.word.toLowerCase());
    const renames: Entry[] = [];
    for (const p of PIECES) {
        const next = (to.words[p.id] ?? [])[0] ?? p.builtin;
        for (const old of from.words[p.id] ?? []) if (!inTo.has(old.toLowerCase())) renames.push(entry(old, next, p.beforeColour));
    }
    for (const b of from.bundles) {
        if (inTo.has(b.word.toLowerCase())) continue;
        const same = to.bundles.find((x) => x.means === b.means);
        renames.push(entry(b.word, same ? same.word : b.means));
    }
    if (!renames.length) return text;
    const t = tablesOf(from);
    const keepsRest = [...t.keepsRest, ...tablesOf(to).keepsRest];
    const named = [...t.named, ...tablesOf(to).named];
    return text
        .split(/\r\n?|\n/)
        .map((line) => replaceLine(line, renames.sort(byLength), names, t.colours, keepsRest, named).text)
        .join('\n');
}

/** The column of the typed line a problem at `column` (1-based) of the read line points at. */
export function typedColumn(maps: number[][], line: number, column: number): number {
    const map = maps[line - 1];
    if (!map || !map.length) return column;
    if (column - 1 < map.length) return map[column - 1] + 1;
    return map[map.length - 1] + 2;
}

/** Their words that a chart's own names shadow (a slider called like one of their words). */
export function shadowed(w: ChartWords, names: ReadonlySet<string>): boolean {
    if (!names.size) return false;
    for (const list of Object.values(w.words)) if (list.some((x) => names.has(x.toLowerCase()))) return true;
    return w.bundles.some((b) => names.has(b.word.toLowerCase()));
}

// --------------------------------------------------------------- sharing

/**
 * The AI guide (docs/ai.md) with a section on this person's words when they
 * set some, so an AI app can read their blocks: the built-in words stay
 * valid, so the AI may write either.
 */
export function guideWithWords(guide: string, w: ChartWords = current): string {
    if (!hasWords(w)) return guide;
    const code = (s: string) => '`' + s.replace(/`/g, '') + '`';
    const rows = PIECES.filter((p) => (w.words[p.id] ?? []).length).map((p) => `| ${code(p.builtin)}${p.beforeColour ? ' (before a colour)' : p.id === 'in-region' ? ' (before a region)' : ''} | ${(w.words[p.id] ?? []).map(code).join(', ')} |`);
    const out = [
        guide.trimEnd(),
        '',
        '## This person\'s chart words',
        '',
        'They gave pieces of the chart language their own words (Settings, Chart words). Blocks in their notes may use them. The built-in words of this guide always work too, so write the built-in words or theirs; the plugin reads both, and writes theirs when it rewrites a line.',
    ];
    if (rows.length) out.push('', '| Built-in | Their words |', '| --- | --- |', ...rows);
    if (w.bundles.length) out.push('', 'Their own words for several options, written like any option:', '', '| Word | Stands for |', '| --- | --- |', ...w.bundles.map((b) => `| ${code(b.word)} | ${code(b.means)} |`));
    return out.join('\n') + '\n';
}

/**
 * Chart words as text to share, one piece per line (`plot = graph, curve
 * of`), bundles with `:=` (`objective := in red, dashed`).
 */
export function wordsToText(w: ChartWords): string {
    const lines = ['# Easy TikZ chart words: built-in = your words (the first is the one written); bundles: word := options'];
    for (const p of PIECES) {
        const list = w.words[p.id];
        if (list && list.length) lines.push(`${p.builtin} = ${list.join(', ')}`);
    }
    for (const b of w.bundles) lines.push(`${b.word} := ${b.means}`);
    return lines.join('\n');
}

/** Chart words from shared text; lines it cannot read are named. */
export function wordsFromText(text: string, write: ChartWords['write'] = 'yours'): { words: ChartWords; problems: string[] } {
    const words: Record<string, string[]> = {};
    const bundles: Bundle[] = [];
    const problems: string[] = [];
    text.split(/\r\n?|\n/).forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith('#')) return;
        const bundle = /^(.+?)\s*:=\s*(.+)$/.exec(line);
        if (bundle) {
            bundles.push({ word: bundle[1].trim(), means: bundle[2].trim() });
            return;
        }
        const m = /^(.+?)\s*=\s*(.+)$/.exec(line);
        const p = m ? PIECES.find((x) => x.builtin === m[1].trim().toLowerCase() && !x.beforeColour) ?? PIECES.find((x) => x.id === m[1].trim().toLowerCase()) : undefined;
        if (!m || !p) {
            problems.push(`line ${i + 1}: "${line}" is not "built-in = your words"`);
            return;
        }
        words[p.id] = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    });
    return { words: clean({ words, bundles, write }), problems };
}
