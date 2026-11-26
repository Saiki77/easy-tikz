// 6.2.4: real spellings. Made-up formulas of the forms found in real study
// notes, read as the hover reads a note (its spans, the words around each
// formula, the note's definitions): which formulas get the dotted mark under
// Smart and which card opens. None of the text is from a real note.
import { test, assert } from './_lib';
import { mathSpans } from '../src/mathspans';
import { recognizeCached } from '../src/notes6/recognize';
import { formulaContext, noteFacts, noteVectors } from '../src/notes6/recognize/context';
import { definedFunctions, groupOf, noteDomains } from '../src/notes6/recognize/adapt';
import { smartChart, smartIterate, smartLinear, smartMark, smartNotes6, smartVector } from '../src/notes6/recognize/decide';
import { noteDefinitions } from '../src/notes6/hover';
import { noteValues } from '../src/linear/hover';
import { formulasIn } from '../src/formula';
import { parseChartText } from '../src/text/parse';

const NOTE = [
    '# Folgen und Reihen',
    '',
    'Wir betrachten die Funktion $f(x)=e^{(x+1)}$ auf ganz $\\mathbb{R}$.',
    '',
    'Die Summe der ersten Zahlen ist $\\displaystyle \\sum^m_{j=1} j = \\frac{m(m+1)}{2}$ und die geometrische Summe ist $\\displaystyle \\sum^m_{j=0}r^j = \\frac{1-r^{m+1}}{1-r}$ für $r \\ne 1$.',
    '',
    'Im Induktionsschritt setzen wir $m+1$ ein und erhalten die Aussage für den Nachfolger.',
    '',
    '**Achtung:** Bei $\\max 2x_1 - x_2$ geht es nach rechts unten (Richtung $d = (2, -1)$). Immer zwei Höhenlinien vergleichen.',
    '',
    '| LP  | Zielfunktion und Menge | Ergebnis |',
    '| --- | --- | --- |',
    '| 3   | $\\max x_1 + 2x_2$ (parallel zu $x_1 + 2x_2 \\le 6$) | Kante von $(2,0)$ bis $(0,3)$, $v = 6$ |',
    '',
    '| Auto | $y^1$ | $y^2$ | $y^3$ | $y^4$ | $y^5$ | $y^6$ |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| Preis | 20 | 25 | 30 | 28 | 35 | 40 |',
    '',
].join('\n');

interface Read {
    tex: string;
    label: string;
    mark: boolean;
    kind: string | null;
    lines: string[];
}

/** Every math span of the note as Smart reads it: its label, its dotted mark, and the card that opens (no fall back to Rules). */
function readNote(note: string): Read[] {
    const facts = noteFacts('Mathe/Folgen.md', note);
    const vectors = noteVectors(note);
    const all = formulasIn(note).map((f) => f.tex);
    return mathSpans(note).map((s) => {
        const ctx = formulaContext(facts, note, s.start, s.end, s.tex);
        const tex = s.tex;
        const label = recognizeCached(tex, ctx, ctx.key);
        const fns = definedFunctions(ctx.defs);
        const others = all.filter((f) => f !== tex);
        let card: { kind: string; lines: string[] } | null = null;
        switch (groupOf(label)) {
            case 'chart':
                card = smartChart(tex, undefined, tex, label, fns);
                break;
            case 'iterate':
                card = smartIterate(tex, label);
                break;
            case 'notes6':
                card = smartNotes6(tex, label, noteDefinitions(others), noteDomains(others));
                break;
            case 'linear':
                card = smartLinear(tex, label, noteValues(others));
                break;
            case 'vector':
                card = smartVector(tex, vectors);
                break;
            default:
                card = null;
        }
        return { tex, label, mark: smartMark(tex, undefined, tex, label, fns, () => vectors), kind: card ? (card.kind === 'equation' ? 'implicit' : card.kind) : null, lines: card ? card.lines : [] };
    });
}

const READ = readNote(NOTE);
const at = (tex: string) => {
    const r = READ.find((x) => x.tex === tex);
    assert.ok(r, `no span ${tex}`);
    return r as Read;
};
const draws = (r: Read) => assert.deepEqual(parseChartText(r.lines.join('\n')).problems, [], r.tex);

test('real spellings: e to a power in brackets, f(x)=e^{(x+1)}, is a function with its mark and its card', () => {
    const r = at('f(x)=e^{(x+1)}');
    assert.equal(r.label, 'function');
    assert.ok(r.mark);
    assert.equal(r.kind, 'function');
    assert.ok(r.lines.some((l) => /^plot \$f\(x\) = e\^\{\(x ?\+ ?1\)\}\$/.test(l)), r.lines.join(' / '));
    draws(r);
});

test('real spellings: sums written \\displaystyle \\sum^m_{j=1} draw their partial sums, with their value as a dashed curve', () => {
    for (const tex of ['\\displaystyle \\sum^m_{j=1} j = \\frac{m(m+1)}{2}', '\\displaystyle \\sum^m_{j=0}r^j = \\frac{1-r^{m+1}}{1-r}']) {
        const r = at(tex);
        assert.equal(r.kind, 'sum', tex);
        assert.ok(r.mark, tex);
        assert.ok(r.lines.some((l) => /^mark the points/.test(l)), r.lines.join(' / '));
        assert.ok(r.lines.some((l) => /in red, dashed$/.test(l)), r.lines.join(' / '));
        draws(r);
    }
});

test('real spellings: m+1 in a sentence is a function (rule C1), d = (2, -1) after "Richtung" a vector', () => {
    const n = at('m+1');
    assert.equal(n.kind, 'function');
    assert.ok(n.mark);
    draws(n);
    const d = at('d = (2, -1)');
    assert.equal(d.kind, 'vector');
    assert.ok(d.mark);
    draws(d);
});

test('real spellings: names with an upper index in a table row (y^1 to y^6) get no mark and no card', () => {
    for (let k = 1; k <= 6; k++) {
        const r = at(`y^${k}`);
        assert.equal(r.label, 'none', r.tex);
        assert.ok(!r.mark, r.tex);
    }
    // the point after "Kante von ... bis" without a program nearby: no card either
    assert.equal(at('(0,3)').label, 'none');
});

test('real spellings, open: the first corner after "Kante von" next to a program in x_1 and x_2 still opens a vector card (round 4 reads it as a vector)', () => {
    // Known gap of the network of round 4 (no role word such as Ecke or Punkt before it). When a later round
    // gives it no card, change this test to expect none.
    const r = at('(2,0)');
    assert.equal(r.label, 'vector');
    assert.equal(r.kind, 'vector');
});
