/*
 * Guard against a crash that only shows up inside real Obsidian.
 *
 * Obsidian's `createSvg`, `addClass`, `removeClass` and `toggleClass` hand
 * each class to `classList.add` / `classList.remove` as ONE token, and a
 * token with whitespace throws InvalidCharacterError. (`createEl` /
 * `createDiv` / `createSpan` are different: they assign `className`, so
 * 'a b' is fine there.) 4.0.0 nearly shipped with
 * `createSvg('g', { cls: 'etz-drag-select is-ring' })`, which stopped the
 * editor from opening. No unit test can run Obsidian's DOM helpers, so this
 * test scans the sources for the pattern instead.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, assert } from './_lib';

const root = process.cwd();

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(p, out);
        else if (entry.name.endsWith('.ts')) out.push(p);
    }
    return out;
}

/** Text of the argument list that opens at `open` (index of the '('), parentheses balanced. */
function callArgs(src: string, open: number): string {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
    }
    return src.slice(open + 1);
}

const STRING = /'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g;

function literals(text: string): string[] {
    return [...text.matchAll(STRING)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

function lineOf(src: string, index: number): number {
    return src.slice(0, index).split('\n').length;
}

test('no whitespace in class tokens given to createSvg / addClass / removeClass / toggleClass / classList', () => {
    const files = [...sourceFiles(path.join(root, 'src')), path.join(root, 'main.ts')];
    const problems: string[] = [];
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        const rel = path.relative(root, file);

        // createSvg(tag, 'cls') and createSvg(tag, { cls: ... })
        for (const m of src.matchAll(/\bcreateSvg\(/g)) {
            const args = callArgs(src, m.index + m[0].length - 1);
            const second = args.replace(/^\s*(['"`])[^'"`]*\1\s*,?/, '');
            const direct = /^\s*(['"`])/.test(second) ? literals(second.split(',')[0]) : [];
            const cls = /\bcls\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|`[^`]*`)/.exec(second);
            for (const token of [...direct, ...(cls ? literals(cls[1]) : [])]) {
                if (/\s/.test(token)) problems.push(`${rel}:${lineOf(src, m.index)} createSvg class "${token}"`);
            }
        }

        // el.addClass('a b'), el.toggleClass('a b', on), el.classList.add('a b'), ...
        for (const m of src.matchAll(/\.(?:addClass|removeClass|toggleClass|addClasses|removeClasses)\(|\bclassList\.(?:add|remove|toggle|replace)\(/g)) {
            const args = callArgs(src, m.index + m[0].length - 1);
            // Only the class arguments: for toggleClass / classList.toggle that is the first one.
            const classPart = /toggle/i.test(m[0]) ? args.split(',')[0] : args;
            for (const token of literals(classPart)) {
                if (/\s/.test(token)) problems.push(`${rel}:${lineOf(src, m.index)} ${m[0]}"${token}")`);
            }
        }
    }
    assert.deepEqual(problems, [], 'class tokens with whitespace crash in Obsidian:\n' + problems.join('\n'));
});

test('the scanner itself catches the pattern', () => {
    const bad = "el.createSvg('g', { cls: 'etz-drag-select is-ring' });";
    const args = callArgs(bad, bad.indexOf('('));
    const second = args.replace(/^\s*(['"`])[^'"`]*\1\s*,?/, '');
    const cls = /\bcls\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|`[^`]*`)/.exec(second);
    assert.ok(cls && literals(cls[1]).some((t) => /\s/.test(t)));
});
