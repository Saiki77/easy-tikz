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

test('recognize: the TypeScript port gives the frozen round 4 network\'s label on the committed fixture (about 270 formulas)', () => {
    // tests/recognize-fixture.json: formulas of train and dev (and, round 4, of r4_dev) with what is around them, and the frozen network's label.
    const cases = JSON.parse(fs.readFileSync('tests/recognize-fixture.json', 'utf8')) as Case[];
    assert.ok(cases.length >= 270, `${cases.length} cases`);
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
const FROZEN = `${SCRATCH}/designed4-frozen/best.mjs`;
const SUITE = `${SCRATCH}/designed4-frozen/suite.jsonl`;
const DATA = `${SCRATCH}/data`;

type Frozen = { predict: (tex: string, ctx: RecognizeContext) => string };
const readLines = (file: string) =>
    fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Case & { id: string });
const ctxOf = (it: RecognizeContext): RecognizeContext => ({ defs: it.defs ?? [], context: it.context ?? '', note: it.note ?? null });

test('recognize: the port gives the frozen round 4 network\'s label (best.mjs) on every formula of every data file (skipped without the corpus)', async () => {
    if (!fs.existsSync(FROZEN) || !fs.existsSync(DATA)) {
        console.log('    (skipped: the hover-ml corpus is not on this machine)');
        return;
    }
    const frozen = (await import(pathToFileURL(FROZEN).href)) as Frozen;
    const files = fs.readdirSync(DATA).filter((f) => f.endsWith('.jsonl'));
    let n = 0;
    const wrong: string[] = [];
    for (const file of files) {
        for (const it of readLines(`${DATA}/${file}`)) {
            const ctx = ctxOf(it);
            n++;
            if (recognize(it.tex, ctx) !== frozen.predict(it.tex, ctx)) wrong.push(`${file} ${it.id}`);
        }
    }
    console.log(`    ${n} formulas of ${files.length} files, ${wrong.length} with another label`);
    assert.ok(n > 27000, `${n} formulas`);
    assert.deepEqual(wrong, []);
});

test('recognize: the port gives the frozen network\'s label on a fuzz set: the robustness suite of round 4 and cut, unbalanced spellings (skipped without the corpus)', async () => {
    if (!fs.existsSync(FROZEN) || !fs.existsSync(SUITE) || !fs.existsSync(DATA)) {
        console.log('    (skipped: the hover-ml corpus is not on this machine)');
        return;
    }
    const frozen = (await import(pathToFileURL(FROZEN).href)) as Frozen;
    let n = 0;
    const wrong: string[] = [];
    const same = (tex: string, ctx: RecognizeContext) => {
        n++;
        let a: string;
        try {
            a = frozen.predict(tex, ctx);
        } catch {
            a = 'throws';
        }
        if (recognize(tex, ctx) !== a && wrong.length < 20) wrong.push(JSON.stringify(tex));
    };
    // 79 366 variants of the suite, each with its context.
    for (const it of readLines(SUITE)) same(it.tex, ctxOf(it));
    // Every formula of the round 4 files cut in four places: the head, the tail, a brace or a backslash too many.
    for (const split of ['train_r4', 'dev_r4', 'hard_dev_r4', 'r3_dev_r4', 'r4_dev']) {
        for (const it of readLines(`${DATA}/${split}.jsonl`)) {
            const t = it.tex;
            const ctx = ctxOf(it);
            for (let k = 1; k < t.length; k += Math.max(1, Math.floor(t.length / 4))) {
                for (const s of [t.slice(0, k), t.slice(k), `${t.slice(0, k)}{${t.slice(k)}`, `${t.slice(0, k)}}${t.slice(k)}`, `${t.slice(0, k)}\\${t.slice(k)}`]) same(s, k % 2 ? ctx : {});
            }
        }
    }
    console.log(`    ${n} variants, ${wrong.length} with another label`);
    assert.ok(n > 300000, `${n} variants`);
    assert.deepEqual(wrong, []);
});

test('recognize: well under 1 ms per formula', () => {
    const cases = JSON.parse(fs.readFileSync('tests/recognize-fixture.json', 'utf8')) as Case[];
    const t0 = performance.now();
    for (let r = 0; r < 20; r++) for (const c of cases) recognize(c.tex, { defs: c.defs, context: c.context, note: c.note });
    const ms = (performance.now() - t0) / (20 * cases.length);
    console.log(`    ${ms.toFixed(3)} ms per formula`);
    assert.ok(ms < 0.5, `${ms} ms per formula`);
});

test('recognize: a formula it cannot read, and broken TeX, get no card and never throw', () => {
    for (const tex of ['', '}', '\\frac{', '\\begin{pmatrix} 1 & 2', '$$', '^^^', '\\left(', 'x_{', '{{{{']) assert.equal(recognize(tex), 'none', tex);
});

test('recognize: the examples of the 6.2 notes (statistics, growth, signals, matrices)', () => {
    const stats: RecognizeContext = { note: 'uni/statistik-zusammenfassung', context: 'Die Stichprobenvarianz teilt durch [F] statt durch $1/m$.' };
    // Round 4, rubric_r4 C1: a bare expression in one small letter with an operation is a function (round 3: none).
    assert.equal(recognize('\\frac{1}{m-1}', stats), 'function');
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
