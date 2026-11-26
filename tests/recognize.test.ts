import { test, assert } from './_lib';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { LABELS, Label, RecognizeContext, recognize } from '../src/notes6/recognize';
import { contextOf, noteId, definingFormulas, formulaContext, noteFacts } from '../src/notes6/recognize/context';
import { groupOf, spellings } from '../src/notes6/recognize/adapt';
import { recognitionSetting, rulesMark, smartChart, smartLinear, smartMark } from '../src/notes6/recognize/decide';

interface Case extends RecognizeContext {
    tex: string;
    label: Label;
}

test('recognize: the TypeScript port gives the frozen round 2 network\'s label on the committed fixture (about 200 formulas)', () => {
    // tests/recognize-fixture.json: formulas of train and dev with what is around them, and the frozen network's label.
    const cases = JSON.parse(fs.readFileSync('tests/recognize-fixture.json', 'utf8')) as Case[];
    assert.ok(cases.length >= 180, `${cases.length} cases`);
    const wrong = cases.filter((c) => recognize(c.tex, { defs: c.defs, context: c.context, note: c.note }) !== c.label);
    assert.deepEqual(
        wrong.map((c) => `${c.tex} (${c.label})`),
        []
    );
    // Every label of the network is in the fixture.
    for (const l of LABELS) assert.ok(cases.some((c) => c.label === l), `no case of ${l}`);
});

// The experiment's corpus and the frozen network (hover-ml): only on the machine that has them, so CI without them passes.
const SCRATCH = '/private/tmp/claude-501/-Users-justus-PycharmProjects-tikz-graph-help/d7060021-8494-476b-bf42-b1974d650603/scratchpad/hover-ml';
const FROZEN = `${SCRATCH}/designed2-frozen/best.mjs`;
const SPLITS = ['train', 'dev', 'hard_dev'].map((s) => `${SCRATCH}/data/${s}.jsonl`);

test('recognize: the port gives the frozen round 2 network\'s label (best.mjs) on every formula of train, dev and hard_dev (skipped without the corpus)', async () => {
    if (!fs.existsSync(FROZEN) || !SPLITS.every((f) => fs.existsSync(f))) {
        console.log('    (skipped: the hover-ml corpus is not on this machine)');
        return;
    }
    const url = pathToFileURL(FROZEN).href;
    const frozen = (await import(url)) as { predict: (tex: string, ctx: RecognizeContext) => string };
    let n = 0;
    const wrong: string[] = [];
    for (const file of SPLITS) {
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            const it = JSON.parse(line) as Case & { id: string };
            const ctx = { defs: it.defs ?? [], context: it.context ?? '', note: it.note ?? null };
            n++;
            if (recognize(it.tex, ctx) !== frozen.predict(it.tex, ctx)) wrong.push(it.id);
        }
    }
    console.log(`    ${n} formulas, ${wrong.length} with another label`);
    assert.ok(n > 6000, `${n} formulas`);
    assert.deepEqual(wrong, []);
});

test('recognize: a formula it cannot read, and broken TeX, get no card and never throw', () => {
    for (const tex of ['', '}', '\\frac{', '\\begin{pmatrix} 1 & 2', '$$', '^^^', '\\left(', 'x_{', '{{{{']) assert.equal(recognize(tex), 'none', tex);
});

test('recognize: the examples of the 6.2 notes (statistics, growth, signals, matrices)', () => {
    const stats: RecognizeContext = { note: 'uni/statistik-zusammenfassung', context: 'Die Stichprobenvarianz teilt durch [F] statt durch $1/m$.' };
    assert.equal(recognize('\\frac{1}{m-1}', stats), 'none');
    assert.equal(recognize('x(t) = x_0 e^{at}', { note: 'uni/wachstum', context: 'Exponentielles Wachstum: [F] mit Startwert $x_0$.' }), 'function');
    assert.equal(recognize('y = +1', { context: 'Die Klasse ist [F] oder $y = -1$.' }), 'none');
    assert.equal(recognize('\\lVert w\\rVert', { context: 'Der Abstand ist [F] im Nenner.' }), 'none');
    assert.equal(recognize('\\Sigma = \\begin{pmatrix} 3 & 1 \\\\ 1 & 3 \\end{pmatrix}', { context: 'Die Kovarianzmatrix [F] ist symmetrisch.' }), 'matrix');
    assert.equal(recognize('f(x) = x^2 - 4'), 'function');
});

test('recognize: the context is built as the corpus built it (note id, ten words around [F], the defining formulas)', () => {
    assert.equal(noteId('Uni/Signale und Systeme.md'), 'uni/signale-und-systeme');
    assert.equal(noteId('Math/Analysis I Zusammenfassung.md'), 'math/analysis-i-zusammenfassung');
    assert.equal(noteId('Ökonomie/Mikro VL Mitschrieb.md'), 'okonomie/mikro-vl-mitschrieb');
    const text = '> **Stoff:** Supervised Learning, Trainingsmenge $\\{x_i\\}$, Modell $h_\\theta$.\n';
    const at = text.indexOf('$h_');
    assert.equal(contextOf(text, at, at + '$h_\\theta$'.length), '> **Stoff:** Supervised Learning, Trainingsmenge $\\{x_i\\}$, Modell [F] .');
    // A display block: the lines around it.
    const block = 'Die Matrix ist\n\n$$\nA = 1\n$$\n\nsymmetrisch und positiv.';
    const s = block.indexOf('$$');
    const e = block.lastIndexOf('$$') + 2;
    assert.equal(contextOf(block, s, e), 'Die Matrix ist [F] symmetrisch und positiv.');
    const note = 'Sei $g(x) = x^2 - 4$ und $A = \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}$ sowie $x > 0$.\n\n```easy-tikz\nplot $h(x) = x$\n```\n';
    assert.deepEqual(definingFormulas(note), ['g(x) = x^2 - 4', 'A = \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}']);
    const facts = noteFacts('Uni/Note.md', note);
    const ctx = formulaContext(facts, note, note.indexOf('$x > 0$'), note.indexOf('$x > 0$') + 7, 'x > 0');
    assert.equal(ctx.note, 'uni/note');
    assert.equal(ctx.defs?.length, 2);
    assert.match(ctx.context ?? '', /sowie \[F\] \.$/);
});

test('recognize: the builders read the spellings the network knows (Smart only)', () => {
    // The rules miss x(t) = ...: its head names the function x. Smart charts it in t.
    assert.equal(rulesMark('x(t) = x_0 e^{at}', undefined, 'x(t) = x_0 e^{at}'), false);
    const card = smartChart('x(t) = x_0 e^{at}', undefined, 'x(t) = x_0 e^{at}', 'function');
    assert.ok(card, 'no chart for x(t) = x_0 e^{at}');
    assert.equal(card?.kind, 'function');
    assert.ok(card?.lines.includes('xlabel t'), card?.lines.join(' / '));
    assert.ok(card?.lines.some((l) => /^plot \$f\(x\) = x_0 e\^\{a x\}\$/.test(l)), card?.lines.join(' / '));
    assert.equal(smartMark('x(t) = x_0 e^{at}', undefined, 'x(t) = x_0 e^{at}', 'function'), true);
    // A matrix named with a Greek letter: the written matrix.
    const sigma = '\\Sigma = \\begin{pmatrix} 3 & 1 \\\\ 1 & 3 \\end{pmatrix}';
    assert.equal(smartLinear(sigma, 'matrix', new Map())?.kind, 'matrix');
    // Decimal commas and thin spaces, a part after \qquad, a chain of =.
    assert.ok(spellings('K_n = K_0\\,(1 + p)^n', 'function').some((s) => s.tex === 'K_n = K_0 (1 + p)^n'));
    assert.ok(spellings('v = 0{,}5\\,t, \\qquad s = 3', 'function').some((s) => s.tex === 'v = 0.5 t'));
    assert.ok(spellings('L_0(x) = a = b', 'function').some((s) => s.tex === 'L_0(x) = a'));
    // None: no card and no mark, whatever the rules say.
    assert.equal(rulesMark('\\frac{1}{m-1}', undefined, '\\frac{1}{m-1}'), true);
    assert.equal(smartMark('\\frac{1}{m-1}', undefined, '\\frac{1}{m-1}', 'none'), false);
});

test('recognize: the setting, and the builder of each label', () => {
    assert.equal(recognitionSetting(undefined), 'smart');
    assert.equal(recognitionSetting('rules'), 'rules');
    assert.equal(recognitionSetting('anything'), 'smart');
    assert.equal(groupOf('none'), null);
    assert.equal(groupOf('implicit'), 'chart');
    assert.equal(groupOf('epigraph'), 'notes6');
    assert.equal(groupOf('det'), 'linear');
    assert.equal(groupOf('domain'), 'iterate');
});
