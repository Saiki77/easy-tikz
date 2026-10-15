// Test runner: bundles every tests/*.test.ts with esbuild and runs it with
// node. Test files use the tiny helpers in tests/_lib.ts. Pure modules only:
// anything that imports 'obsidian' is not loadable outside the app.
//
// It also runs the tests of the media pipelines (scripts/media/brand/*.test.mjs,
// scripts/media/cinema/*.test.mjs) as they are, with node: they test pure
// functions and need no Obsidian, browser, TeX fonts or ffmpeg.
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
/** Folders of the media pipelines whose *.test.mjs run as plain node scripts. */
const MEDIA_TEST_DIRS = ['scripts/media/brand', 'scripts/media/cinema'];
const filter = process.argv[2] || '';

const files = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith('.test.ts') && f.includes(filter))
    .sort();
const mediaTests = MEDIA_TEST_DIRS.flatMap((dir) =>
    fs
        .readdirSync(path.join(root, dir))
        .filter((f) => f.endsWith('.test.mjs') && f.includes(filter))
        .sort()
        .map((f) => path.join(dir, f))
);
if (!files.length && !mediaTests.length) {
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
            loader: { '.md': 'text' },
        });
    } catch (e) {
        failed++;
        console.log(`\n✗ ${file}: build failed\n${e.message}`);
        continue;
    }
    const res = spawnSync(process.execPath, ['--enable-source-maps', outfile], { stdio: 'inherit', cwd: root });
    if (res.status !== 0) failed++;
}
for (const file of mediaTests) {
    const res = spawnSync(process.execPath, [path.join(root, file)], { stdio: 'inherit', cwd: root });
    if (res.status !== 0) {
        failed++;
        console.log(`\n✗ ${file}`);
    }
}
const total = files.length + mediaTests.length;
console.log(failed ? `\n${failed} test file(s) failed.` : `\nAll ${total} test file(s) passed (${files.length} in tests/, ${mediaTests.length} of the media pipelines).`);
process.exit(failed ? 1 : 0);
