/*
 * What formula recognition reads around a formula, built from the note's
 * text in exactly the form the network was designed on (the extraction of
 * the hover-ml corpus):
 *
 *   note      the note's path without .md, each folder and the name as a slug:
 *             "Uni/Signale und Systeme.md" is uni/signale-und-systeme
 *   context   the rest of the formula's line on each side (the line before or
 *             after when that side is empty), squashed, 10 words on each side,
 *             "[F]" in the formula's place: "Modell [F] mit Bias $\theta_0$."
 *   defs      the note's formulas that define a function or a matrix (those
 *             noteDefinitions or noteValues take), in order, without the
 *             formula's own block; formulas in code blocks and the front
 *             matter do not count
 *
 * Pure: no DOM, no Obsidian.
 */
import { formulasIn } from '../../formula';
import { noteDefinitions } from '../hover';
import { noteValues } from '../../linear/hover';
import type { RecognizeContext } from './features';

/** A name as the corpus wrote it: lower case, accents off, ß as ss, anything else a dash. */
export function slug(s: string): string {
    return s
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

/** The note's id: its path without .md, each part a slug. */
export function noteId(path: string): string {
    return path
        .replace(/\.md$/i, '')
        .split('/')
        .map(slug)
        .filter((p) => p)
        .join('/');
}

/** Fenced code blocks and the front matter as spaces (Obsidian draws no math there), lengths kept. */
export function blankCode(text: string): string {
    let out = text.replace(/^---\n[\s\S]*?\n---\n/, (m) => m.replace(/[^\n]/g, ' '));
    out = out.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, ' '));
    return out;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A few words before and after a formula (text[start, end) with its dollars): the rest of its line, or the lines around a display block. */
export function contextOf(text: string, start: number, end: number): string {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = text.length;
    let before = text.slice(lineStart, start);
    let after = text.slice(end, lineEnd);
    if (!squash(before)) {
        const lines = text
            .slice(0, lineStart)
            .split('\n')
            .filter((l) => l.trim());
        before = lines.length ? lines[lines.length - 1] : '';
    }
    if (!squash(after)) {
        const lines = text
            .slice(lineEnd)
            .split('\n')
            .filter((l) => l.trim());
        after = lines.length ? lines[0] : '';
    }
    const b = squash(before).split(' ').slice(-10).join(' ');
    const a = squash(after).split(' ').slice(0, 10).join(' ');
    return `${b} [F] ${a}`.trim();
}

/** The formulas of a note that define something (g(x) = ..., A = \begin{pmatrix} ... \end{pmatrix}, v = (1, 2)), in order. */
export function definingFormulas(text: string): string[] {
    const isDef = (f: string) => noteDefinitions([f]).size > 0 || noteValues([f]).size > 0;
    return formulasIn(blankCode(text))
        .map((f) => f.tex)
        .filter(isDef);
}

/** A note's text, read once per version: its id and its defining formulas. */
export interface NoteFacts {
    note: string;
    defs: string[];
}

const facts = new Map<string, { text: string; facts: NoteFacts }>();

/** The facts of a note (its path and text), remembered per note for its last version read. */
export function noteFacts(path: string, text: string): NoteFacts {
    const hit = facts.get(path);
    if (hit && hit.text === text) return hit.facts;
    const made = { note: noteId(path), defs: definingFormulas(text) };
    if (facts.size > 32) facts.clear();
    facts.set(path, { text, facts: made });
    return made;
}

/** What the network reads around the formula at text[start, end) (dollars included), whose block's TeX is blockTex. */
export function formulaContext(facts: NoteFacts, text: string, start: number, end: number, blockTex: string): RecognizeContext {
    return { defs: facts.defs.filter((d) => d !== blockTex), context: contextOf(text, start, end), note: facts.note };
}
