/* Minimal test helpers for scripts/run-tests.mjs. No dependencies. */
import * as assert from 'node:assert/strict';

type TestFn = () => void | Promise<void>;
const tests: { name: string; fn: TestFn }[] = [];
let scheduled = false;

export function test(name: string, fn: TestFn): void {
    tests.push({ name, fn });
    if (!scheduled) {
        scheduled = true;
        setTimeout(runAll, 0);
    }
}

/** Assert |a - b| <= tol (absolute) with a readable message. */
export function near(actual: number, expected: number, tol = 1e-9, msg = ''): void {
    if (!(Math.abs(actual - expected) <= tol)) {
        throw new assert.AssertionError({
            message: `${msg ? msg + ': ' : ''}expected ${expected} +/- ${tol}, got ${actual}`,
            actual,
            expected,
        });
    }
}

export { assert };

async function runAll() {
    const file = process.argv[1] ? process.argv[1].split('/').pop() : '';
    let pass = 0;
    let fail = 0;
    for (const t of tests) {
        try {
            await t.fn();
            pass++;
        } catch (e) {
            fail++;
            console.log(`  ✗ ${t.name}\n    ${(e instanceof Error ? e.stack || e.message : String(e)).split('\n').slice(0, 6).join('\n    ')}`);
        }
    }
    console.log(`${fail ? '✗' : '✓'} ${file}: ${pass} passed, ${fail} failed`);
    if (fail) process.exitCode = 1;
}
