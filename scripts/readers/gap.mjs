// The gap harness of the formula hover (6.2.2): how often the recognition
// network chooses a card kind and the reader with the builders then draws
// no card of that kind (a), another card than the gold parse (b), or fails
// on a label-keeping spelling variant (c); and the false cards. See README.md.
//
//   node scripts/readers/gap.mjs [reader] [options]
//
//   reader          a module exporting read(tex, kind, ctx) -> parse | parse[] | null (or `reader`, or a
//                   default export); .mjs and .js are imported as they are, .ts is bundled first.
//                   Without one: reader 0 (src/readers/reader0.ts).
//   --data DIR      the hover-ml folder (default: the experiment's scratchpad folder)
//   --corpus F,F    the labelled files (default: DIR/data/{train_r4,dev_r4,hard_dev_r4,r3_dev_r4,r4_dev}.jsonl)
//   --suite F       the robustness suite (default: DIR/designed3-frozen/suite.jsonl); --no-suite skips it
//   --gold F        the gold parses (default: DIR/reader-data/gold.jsonl)
//   --expected F    the expected parses of the suite (default: DIR/reader-data/suite-expected.jsonl)
//   --kinds k,k     only these kinds
//   --limit N       at most N formulas of each set (a fast subset); --stride N: every N-th formula
//   --examples N    list up to N failures per kind and category
//   --json F        write the counts and every failure as JSON
//   --write-gold D  write reader 0's gold parses to D (gold.jsonl, missing.jsonl, suite-expected.jsonl),
//                   with the hand review in D/review.jsonl merged in
import esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, '.tmp-tests');
const DEFAULT_DATA = '/private/tmp/claude-501/-Users-justus-PycharmProjects-tikz-graph-help/d7060021-8494-476b-bf42-b1974d650603/scratchpad/hover-ml';
const CORPUS = ['train_r4', 'dev_r4', 'hard_dev_r4', 'r3_dev_r4', 'r4_dev'];

function usage(msg) {
    if (msg) console.error(msg);
    console.error('usage: node scripts/readers/gap.mjs [reader.mjs|reader.ts] [--data DIR] [--corpus F,F] [--suite F | --no-suite] [--gold F] [--expected F] [--kinds k,k] [--limit N] [--stride N] [--examples N] [--json F] [--write-gold DIR]');
    process.exit(2);
}

function parseArgs(argv) {
    const o = { reader: null, data: DEFAULT_DATA, corpus: null, suite: undefined, gold: undefined, expected: undefined, json: null, limit: 0, stride: 1, examples: 0, kinds: [], writeGold: null, quiet: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) usage(`${a} needs a value`);
            return argv[++i];
        };
        if (a === '--data') o.data = next();
        else if (a === '--corpus') o.corpus = next().split(',');
        else if (a === '--suite') o.suite = next();
        else if (a === '--no-suite') o.suite = null;
        else if (a === '--gold') o.gold = next();
        else if (a === '--expected') o.expected = next();
        else if (a === '--json') o.json = path.resolve(next());
        else if (a === '--limit') o.limit = Number(next());
        else if (a === '--stride') o.stride = Number(next());
        else if (a === '--examples') o.examples = Number(next());
        else if (a === '--kinds') o.kinds = next().split(',');
        else if (a === '--write-gold') o.writeGold = path.resolve(next());
        else if (a === '--quiet') o.quiet = true;
        else if (a.startsWith('--')) usage(`unknown option ${a}`);
        else if (o.reader) usage('one reader only');
        else o.reader = path.resolve(a);
    }
    o.corpus = (o.corpus ?? CORPUS.map((c) => `${o.data}/data/${c}.jsonl`)).map((f) => path.resolve(f));
    if (o.suite === undefined) o.suite = `${o.data}/designed3-frozen/suite.jsonl`;
    if (o.gold === undefined) o.gold = `${o.data}/reader-data/gold.jsonl`;
    if (o.expected === undefined) o.expected = `${o.data}/reader-data/suite-expected.jsonl`;
    for (const f of o.corpus) if (!fs.existsSync(f)) usage(`no corpus file ${f}`);
    if (o.reader && !fs.existsSync(o.reader)) usage(`no reader ${o.reader}`);
    return o;
}

const o = parseArgs(process.argv.slice(2));
fs.mkdirSync(outDir, { recursive: true });
const bundle = (entry, outfile, format) =>
    esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format, target: 'node18', outfile, logLevel: 'silent', external: ['obsidian'], loader: { '.md': 'text' }, sourcemap: 'inline' });

// The harness with the plugin's pipeline, as one CommonJS file (as scripts/run-tests.mjs bundles the tests).
const harness = path.join(outDir, 'readers-gap.cjs');
await bundle(path.join(root, 'scripts/readers/harness.ts'), harness, 'cjs');
// A reader in TypeScript: bundled to an ES module of its own; .mjs and .js load as they are.
let readerFile = o.reader;
if (readerFile && /\.tsx?$/.test(readerFile)) {
    const out = path.join(outDir, `reader-${path.basename(readerFile).replace(/\.tsx?$/, '')}.mjs`);
    await bundle(readerFile, out, 'esm');
    readerFile = out;
}
const runner = path.join(outDir, 'readers-gap-run.cjs');
fs.writeFileSync(
    runner,
    [
        `const { main } = require(${JSON.stringify(harness)});`,
        `const o = JSON.parse(process.env.GAP_OPTIONS);`,
        `(async () => {`,
        `  const mod = o.readerFile ? await import(o.readerFile) : null;`,
        `  if (mod && typeof mod.setup === 'function') await mod.setup();`,
        `  await main(mod, o);`,
        `})().catch((e) => { console.error(e); process.exit(1); });`,
    ].join('\n')
);
const options = { ...o, readerFile: readerFile ? pathToFileURL(readerFile).href : null, readerName: o.reader ? path.relative(root, o.reader) : 'reader 0 (src/readers/reader0.ts)' };
const r = spawnSync(process.execPath, [runner], { stdio: 'inherit', env: { ...process.env, GAP_OPTIONS: JSON.stringify(options) } });
process.exit(r.status ?? 1);
