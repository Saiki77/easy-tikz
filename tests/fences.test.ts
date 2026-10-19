/*
 * The chart blocks of a note (src/text/fences.ts), as the chart under a
 * block being edited finds them: fences of any length and kind, other
 * languages skipped, callouts, and blocks nobody closed yet.
 */
import { test, assert } from './_lib';
import { chartFences } from '../src/text/fences';

const TAGS = new Set(['easy-tikz']);
const find = (text: string) => {
    const lines = text.split('\n');
    return chartFences(lines.length, (n) => lines[n - 1], TAGS);
};

test('fences: blocks, their lines and bodies; other languages are skipped whole', () => {
    const f = find(['Intro', '```easy-tikz', 'plot f(x) = x^2', '```', '```python', '```easy-tikz', '```', '~~~~ easy-tikz', 'show x from 0 to 1', '```', '~~~~', 'End'].join('\n'));
    assert.deepEqual(
        f.map((b) => [b.first, b.last, b.closed, b.body]),
        [
            [2, 4, true, 'plot f(x) = x^2'],
            [8, 11, true, 'show x from 0 to 1\n```'],
        ]
    );
});

test('fences: a block in a callout loses its markers, blank callout lines included', () => {
    const f = find(['> [!note] A chart', '> ```easy-tikz', '> plot f(x) = x', '>', '>   show x from 0 to 2', '> ```', 'after'].join('\n'));
    assert.equal(f.length, 1);
    assert.deepEqual([f[0].first, f[0].last, f[0].closed], [2, 6, true]);
    assert.equal(f[0].body, 'plot f(x) = x\n\n  show x from 0 to 2');
});

test('fences: a block nobody closed runs to the end of its callout, or of the note', () => {
    const open = find(['```easy-tikz', 'plot f(x) = x', 'more'].join('\n'));
    assert.deepEqual([open[0].first, open[0].last, open[0].closed, open[0].body], [1, 3, false, 'plot f(x) = x\nmore']);
    const quoted = find(['> ```easy-tikz', '> plot f(x) = x', 'outside', '```easy-tikz', 'plot g(x) = 1', '```'].join('\n'));
    assert.deepEqual(
        quoted.map((b) => [b.first, b.last, b.closed]),
        [
            [1, 2, false],
            [4, 6, true],
        ]
    );
});

test('fences: inline code is not a fence, and a closing fence must be as long as the opening one', () => {
    assert.deepEqual(find('``` `x` ```\n```easy-tikz\nplot f(x) = x\n```').map((b) => b.first), [2]);
    const long = find('````easy-tikz\nplot f(x) = x\n```\n````');
    assert.deepEqual([long[0].last, long[0].body], [4, 'plot f(x) = x\n```']);
});
