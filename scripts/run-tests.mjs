// Test runner: bundles every tests/*.test.ts with esbuild and runs it with
// node. Test files use the tiny helpers in tests/_lib.ts. Pure modules only:
// anything that imports 'obsidian' is not loadable outside the app.
//
//   node scripts/run-tests.mjs              run all tests
//   node scripts/run-tests.mjs geometry     run tests whose file name contains "geometry"
import esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, 'tests');
const outDir = path.join(root, '.tmp-tests');
const filter = process.argv[2] || '';

const files = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith('.test.ts') && f.includes(filter))
    .sort();
if (!files.length) {
    console.log('No test files matched.');
    process.exit(0);
}
fs.mkdirSync(outDir, { recursive: true });

let failed = 0;
for (const file of files) {
    const outfile = path.join(outDir, file.replace(/\.ts$/, '.cjs'));
    try {
        await esbuild.build({
            entryPoints: [path.join(testsDir, file)],
            bundle: true,
            platform: 'node',
            format: 'cjs',
            target: 'node18',
            outfile,
            sourcemap: 'inline',
            logLevel: 'silent',
            external: ['obsidian'],
        });
    } catch (e) {
        failed++;
        console.log(`\n✗ ${file}: build failed\n${e.message}`);
        continue;
    }
    const res = spawnSync(process.execPath, ['--enable-source-maps', outfile], { stdio: 'inherit', cwd: root });
    if (res.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) failed.` : `\nAll ${files.length} test file(s) passed.`);
process.exit(failed ? 1 : 0);
