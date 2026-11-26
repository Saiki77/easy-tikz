import { test, assert } from './_lib';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { LABELS, Label, RecognizeContext, recognize } from '../src/notes6/recognize';

interface Case extends RecognizeContext {
    tex: string;
    label: Label;
}

test('recognize: the TypeScript port gives the frozen network\'s label on the committed fixture (about 200 formulas)', () => {
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
const FROZEN = `${SCRATCH}/designed-r1-frozen/pure.mjs`;
const SPLITS = ['train', 'dev'].map((s) => `${SCRATCH}/data/${s}.jsonl`);

test('recognize: the port gives the frozen pure network\'s label on every formula of train and dev (skipped without the corpus)', async () => {
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
    assert.ok(n > 4000, `${n} formulas`);
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
