/*
 * AI access (src/ai): the checker must report what an assistant gets wrong,
 * the blocks of the AI guide (docs/ai.md) must render without problems,
 * every example it hands out must be the same chart as the built-in one, and
 * the AI server's tools, protocol, gate and connection helpers must work.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, assert } from './_lib';
import { blocksOf, canonical, check, examples, minimize, parseJson } from '../src/ai/charttool';

const root = process.cwd();

function data(text: string): Record<string, unknown> {
    const parsed = parseJson(text);
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.data;
}

test('ai: every block in the AI guide renders without problems', () => {
    const problems: string[] = [];
    const text = fs.readFileSync(path.join(root, 'docs', 'ai.md'), 'utf8');
    const blocks = blocksOf(text);
    assert.ok(blocks.length >= 3, `only ${blocks.length} blocks in docs/ai.md`);
    for (const block of blocks) {
        const r = check(data(block.text));
        for (const e of r.errors) problems.push(`docs/ai.md:${block.line}: ${e}`);
    }
    assert.deepEqual(problems, []);
});

test('ai: every example is clean and minimize keeps the chart', () => {
    const list = examples();
    assert.ok(list.length >= 30, `only ${list.length} examples`);
    const problems: string[] = [];
    for (const ex of list) {
        const small = minimize(JSON.parse(JSON.stringify(ex.data)));
        if (canonical(small) !== canonical(ex.data)) problems.push(`${ex.id}: minimize changed the chart`);
        if (small.v !== 4) problems.push(`${ex.id}: minimized block lacks "v": 4`);
        const r = check(small);
        for (const e of r.errors) problems.push(`${ex.id}: ${e}`);
    }
    assert.deepEqual(problems, []);
});

test('ai: check reports what an assistant gets wrong', () => {
    const r = check({
        xmin: -1,
        xmax: 6,
        axisStyle: 'middle',
        functions: [{ name: 'f1', expression: 'ax^2 + 1', colour: 'navy' }],
        tools: [
            { type: 'region', name: 'R1', conditions: ['y <= f1'], color: 'navy' },
            { type: 'polygon', name: 'Q1' },
            { type: 'points', name: 'P1', source: 'intersections', ref1: 'f1', ref2: 'C9' },
        ],
    });
    const all = r.errors.join('\n');
    for (const want of [/"axisStyle" is not a chart field.*"axis_style"/, /"v": 4 is missing/, /"colour" is not a field.*"color"/, /colour "navy"/, /"type" must be one of/, /C9 does not exist/, /Unknown name 'ax'/]) {
        assert.ok(want.test(all), `missing ${want} in:\n${all}`);
    }
});

test('ai: check describes what the chart computes', () => {
    const r = check({
        v: 4,
        xmin: '0',
        xmax: '5',
        ymin: '0',
        ymax: '4.5',
        tools: [
            { type: 'region', name: 'R1', conditions: ['x + y <= 4', 'x + 3y <= 6', 'x >= 0', 'y >= 0'] },
            { type: 'points', name: 'P1', source: 'region', regionName: 'R1', objective: '2x + 3y', label: 'z* = {val}' },
            { type: 'region', name: 'R2', conditions: ['x >= 10'] },
        ],
    });
    assert.deepEqual(r.errors, []);
    const all = r.lines.join('\n');
    assert.match(all, /R1 region .*shaded where x 0\.\.4, y 0\.\.2/);
    assert.match(all, /P1 points .*\(3, 1\) \| label "z\* = 9"/);
    assert.match(all, /R2 region .*EMPTY/);
    assert.match(all, /P1_val = 9/);
});

test('ai: blocksOf finds fenced blocks, also in callouts', () => {
    const note = ['# Note', '```easy-tikz', '{"v": 4}', '```', 'text', '> [!note]', '> ~~~easy-tikz', '> {"v": 4, "title": "B"}', '> ~~~', '```js', '{}', '```'].join('\n');
    const blocks = blocksOf(note);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].line, 2);
    assert.equal(data(blocks[1].text).title, 'B');
});

// ------------------------------------------------------------ AI server

import { ChartHost, NoteInfo, callTool, handleMcp, insertBlock, toolList } from '../src/ai/mcp';
import { gate } from '../src/ai/server';
import { AI_APPS, agentsSection, maskToken, mergeAgentsSection, newToken, shownSnippet } from '../src/ai/connect';

/** A vault in memory: notes by path, one open note, and a log of notices. */
class FakeHost implements ChartHost {
    version = '9.9.9';
    notes = new Map<string, string>();
    notices: string[] = [];
    open: string | null = null;
    activeNote(): NoteInfo | null {
        return this.open ? { path: this.open, headings: (this.notes.get(this.open) || '').split('\n').filter((l) => l.startsWith('#')) } : null;
    }
    resolveNote(note: string) {
        if (note.includes('..') || note.startsWith('.')) throw new Error('not allowed');
        const path = note.endsWith('.md') ? note : `${note}.md`;
        return { path, exists: this.notes.has(path) };
    }
    async read(path: string) {
        const t = this.notes.get(path);
        if (t === undefined) throw new Error(`There is no note ${path}.`);
        return t;
    }
    async write(path: string, update: (old: string) => string) {
        this.notes.set(path, update(this.notes.get(path) ?? ''));
    }
    notify(message: string, path: string) {
        this.notices.push(`${message} to ${path}`);
    }
}

const SINE = { v: 4, xmin: '-1', xmax: '7', ymin: '-1.5', ymax: '1.5', functions: [{ name: 'f1', expression: 'sin(x)', color: 'blue' }] };
const textOf = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text || '').join('\n');

test('ai server: initialize names the server, gives instructions and a version the client asked for', async () => {
    const host = new FakeHost();
    const r = (await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, host)) as {
        result: { protocolVersion: string; serverInfo: { name: string; version: string }; instructions: string; capabilities: Record<string, unknown> };
    };
    assert.equal(r.result.protocolVersion, '2025-03-26');
    assert.equal(r.result.serverInfo.name, 'easy-tikz');
    assert.equal(r.result.serverInfo.version, '9.9.9');
    assert.match(r.result.instructions, /get_guide/);
    assert.ok(r.result.capabilities.tools);
    const newer = (await handleMcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } }, host)) as { result: { protocolVersion: string } };
    assert.equal(newer.result.protocolVersion, '2025-06-18');
    assert.equal(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, host), null);
    const unknown = (await handleMcp({ jsonrpc: '2.0', id: 3, method: 'nope/nope' }, host)) as { error: { code: number } };
    assert.equal(unknown.error.code, -32601);
});

test('ai server: tools/list and every tool schema is an object schema', async () => {
    const names = toolList().map((t) => t.name);
    for (const want of ['get_guide', 'list_examples', 'get_example', 'check_chart', 'render_chart', 'add_chart', 'list_charts', 'update_chart', 'export_latex', 'active_note']) {
        assert.ok(names.includes(want), `missing tool ${want}`);
    }
    for (const t of toolList()) assert.equal((t.inputSchema as { type: string }).type, 'object', t.name);
    const r = (await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, new FakeHost())) as { result: { tools: unknown[] } };
    assert.equal(r.result.tools.length, names.length);
});

test('ai server: guide, sections, examples', async () => {
    const host = new FakeHost();
    assert.match(textOf(await callTool('get_guide', {}, host)), /## Rules that prevent most mistakes/);
    const rules = textOf(await callTool('get_guide', { section: 'rules' }, host));
    assert.match(rules, /"v": 4/);
    assert.ok(!/## Chart fields/.test(rules), 'a section only');
    const bad = await callTool('get_guide', { section: 'zzz' }, host);
    assert.ok(bad.isError);
    assert.match(textOf(await callTool('list_examples', {}, host)), /^lp: Linear program/m);
    assert.match(textOf(await callTool('get_example', { id: 'tangent' }, host)), /```easy-tikz\n\{\n {2}"v": 4/);
    assert.ok((await callTool('get_example', { id: 'nope' }, host)).isError);
});

test('ai server: check_chart takes objects, JSON strings, fenced blocks and slider values', async () => {
    const host = new FakeHost();
    assert.match(textOf(await callTool('check_chart', { chart: SINE }, host)), /^OK/);
    assert.match(textOf(await callTool('check_chart', { chart: JSON.stringify(SINE) }, host)), /^OK/);
    assert.match(textOf(await callTool('check_chart', { chart: '```easy-tikz\n' + JSON.stringify(SINE) + '\n```' }, host)), /^OK/);
    const lp = { v: 4, xmin: 0, xmax: 5, ymin: 0, ymax: 5, parameters: [{ name: 'b', value: 4, min: 1, max: 6, step: 1 }], tools: [{ type: 'region', name: 'R1', conditions: ['x + y <= b', 'x >= 0', 'y >= 0'] }, { type: 'points', name: 'P1', source: 'region', regionName: 'R1', objective: 'x + 2y' }] };
    assert.match(textOf(await callTool('check_chart', { chart: lp, sliders: { b: 2 } }, host)), /\(0, 2\)/);
    assert.match(textOf(await callTool('check_chart', { chart: lp, sliders: { nope: 2 } }, host)), /"nope" is not a slider/);
    assert.ok((await callTool('check_chart', {}, host)).isError);
    assert.ok((await callTool('check_chart', { chart: '{oops' }, host)).isError);
});

test('ai server: add_chart writes into the open note, below a heading, in place of a placeholder, or a new note', async () => {
    const host = new FakeHost();
    host.notes.set('LP.md', '# LP\n\n## Graphical solution\n\n(chart goes here)\n\n## Next');
    host.open = 'LP.md';
    const r1 = await callTool('add_chart', { chart: SINE, replace: '(chart goes here)' }, host);
    assert.ok(!r1.isError, textOf(r1));
    const lp = host.notes.get('LP.md') || '';
    assert.ok(!lp.includes('(chart goes here)'));
    assert.match(lp, /## Graphical solution\n\n```easy-tikz\n\{\n {2}"v": 4/);
    assert.match(lp, /```\n\n## Next$/);
    assert.equal(host.notices.length, 1);

    const r2 = await callTool('add_chart', { chart: SINE, note: 'Waves', after: '# Waves' }, host);
    assert.ok(r2.isError, 'a new note has no heading to go after');
    const missing = await callTool('add_chart', { chart: SINE, note: 'Waves' }, host);
    assert.ok(missing.isError, 'a missing note is not made without create');
    assert.match(textOf(missing), /There is no note Waves\.md[\s\S]*"create": true/);
    const r3 = await callTool('add_chart', { chart: SINE, note: 'Waves', create: true }, host);
    assert.ok(!r3.isError, textOf(r3));
    assert.match(textOf(r3), /^Made the note Waves\.md/);
    assert.match(host.notes.get('Waves.md') || '', /^```easy-tikz\n/);

    const bad = await callTool('add_chart', { chart: { ...SINE, axisStyle: 'middle' } }, host);
    assert.ok(bad.isError);
    assert.match(textOf(bad), /Not written: the chart has problems[\s\S]*axisStyle/);
    assert.ok((await callTool('add_chart', { chart: SINE, note: '../outside' }, host)).isError);
    host.open = null;
    assert.match(textOf(await callTool('add_chart', { chart: SINE }, host)), /No note is open/);
});

test('ai server: list_charts and update_chart replace the right block, also in a callout', async () => {
    const host = new FakeHost();
    const block = (title: string) => '```easy-tikz\n' + JSON.stringify({ ...SINE, title }) + '\n```';
    host.notes.set('Two.md', `Intro\n\n${block('A')}\n\ntext\n\n> [!note]\n> ${block('B').split('\n').join('\n> ')}\n\nend`);
    const list = textOf(await callTool('list_charts', { note: 'Two' }, host));
    assert.match(list, /2 charts/);
    assert.match(list, /Chart 2 \(line \d+, ok\)/);
    const r = await callTool('update_chart', { note: 'Two', index: 2, chart: { ...SINE, title: 'C' } }, host);
    assert.ok(!r.isError, textOf(r));
    const after = host.notes.get('Two.md') || '';
    assert.match(after, /"title":"A"/, 'chart 1 untouched');
    assert.match(after, /> \s*"title": "C"/);
    assert.ok(!after.includes('"title":"B"'));
    assert.match(after, /> ```\n\nend$/);
    assert.ok((await callTool('update_chart', { note: 'Two', index: 3, chart: SINE }, host)).isError);
});

test('ai server: insertBlock puts a block below a heading or whole line, in place of a placeholder line, or at the end', () => {
    assert.deepEqual(insertBlock('# A\ntext', 'B', { after: '# A' }), { text: '# A\n\nB\n\ntext', line: 3, below: 1 });
    assert.equal(insertBlock('x\n## Next week\n', 'B', { after: 'Next week' }).below, 2, 'a heading by its text');
    assert.equal(insertBlock('x\n## Next week\n', 'B', { after: 'next WEEK' }).below, 2, 'headings match whatever the case');
    assert.deepEqual(insertBlock('# A\n\n', 'B', {}), { text: '# A\n\nB\n', line: 3 });
    assert.deepEqual(insertBlock('', 'B', {}), { text: 'B\n', line: 1 });
    assert.deepEqual(insertBlock('a\n  (here)\nb', 'B', { replace: '(here)' }), { text: 'a\n  B\nb', line: 2 });
});

test('ai server: after and replace only match whole lines outside code and frontmatter, and never quote the note', () => {
    const note = ['---', 'tags: x', '---', '# Bank', 'Online banking PIN: 4711', '```', '## Fake', '(here)', '```', 'Keep this rule. (here) too', ''].join('\n');
    const refused = (opts: { after?: string; replace?: string }) => {
        try {
            insertBlock(note, 'B', opts);
        } catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
        return null;
    };
    for (const opts of [{ after: 'PIN' }, { after: 'tags' }, { after: 'Fake' }, { replace: '(here)' }, { replace: 'Keep this rule.' }, { replace: note }, { replace: 'a\nb' }]) {
        const why = refused(opts);
        assert.ok(why, `not refused: ${JSON.stringify(opts)}`);
        assert.ok(!why.includes('4711') && !why.includes('tags: x'), `the answer quotes the note: ${why}`);
    }
    assert.equal(refused({ after: 'Online banking PIN: 4711' }), null, 'a whole line still works');
});

test('ai server: notes with instructions for AI agents are never written', async () => {
    const host = new FakeHost();
    for (const note of ['AGENTS', 'CLAUDE.md', 'notes/claude.md', 'GEMINI', 'docs/copilot-instructions.md']) {
        const r = await callTool('add_chart', { chart: SINE, note, create: true }, host);
        assert.ok(r.isError && /instructions for AI agents/.test(textOf(r)), `${note}: ${textOf(r)}`);
    }
    host.notes.set('CLAUDE.md', '```easy-tikz\n' + JSON.stringify(SINE) + '\n```');
    assert.ok((await callTool('update_chart', { note: 'CLAUDE.md', index: 1, chart: SINE }, host)).isError);
    assert.equal(host.notes.size, 1, 'nothing was written');
});

test('ai server: charts over the limits are refused before anything is computed', async () => {
    const host = new FakeHost();
    const many = { v: 4, functions: Array.from({ length: 60 }, (_, i) => ({ name: `f${i + 1}`, expression: 'x' })) };
    const r = await callTool('check_chart', { chart: many }, host);
    assert.match(textOf(r), /too large to check: too many functions: 60/);
    // f_k = f_(k-1)(x) + f_(k-1)(x + 1): the cost doubles with every function; 12 of them stay fast here.
    const chain = { v: 4, functions: [{ name: 'f1', expression: 'sin(x)' }, ...Array.from({ length: 11 }, (_, i) => ({ name: `f${i + 2}`, expression: `f${i + 1}(x) + f${i + 1}(x + 1)` }))] };
    const t0 = Date.now();
    const c = await callTool('check_chart', { chart: chain }, host);
    assert.match(textOf(c), /f1[12] calls other functions so often/);
    assert.ok(Date.now() - t0 < 1000, 'refused without computing');
    assert.ok((await callTool('add_chart', { chart: chain, note: 'X', create: true }, host)).isError);
    assert.ok((await callTool('render_chart', { chart: many }, host)).isError);
    const levels = { v: 4, tools: [{ type: 'curve', name: 'C1', equation: 'x^2 + y^2', levels: Array.from({ length: 300 }, (_, i) => String(i)).join(', ') }] };
    assert.match(textOf(await callTool('check_chart', { chart: levels }, host)), /too many levels: 300/);
});

test('ai server: TeX that pdflatex would run is refused in text fields', async () => {
    const host = new FakeHost();
    for (const chart of [
        { ...SINE, title: '$\\input{/etc/passwd}$' },
        { ...SINE, functions: [{ name: 'f1', expression: 'x', legendLabel: '\\input{/etc/hosts}' }] },
        { ...SINE, annotations: [{ x: '1', y: '1', text: '$x}\\end{axis}\\end{tikzpicture}$' }] },
        { ...SINE, tools: [{ type: 'region', name: 'R1', conditions: ['y <= 1'], label: '\\immediate\\write18{ls}' }] },
    ]) {
        const r = await callTool('check_chart', { chart }, host);
        assert.match(textOf(r), /which pdflatex would run/, JSON.stringify(chart).slice(0, 80));
    }
    assert.match(textOf(await callTool('check_chart', { chart: { ...SINE, title: '$\\frac{1}{2}\\alpha$, \\textbf{bold}' } }, host)), /^OK/);
});

test('ai server: "hidden": false is no problem, and strings are written exactly', async () => {
    const host = new FakeHost();
    const chart = { ...SINE, title: 'He said "x": 5, a,-1 and 1,000', functions: [{ name: 'f1', expression: 'sin(x)', hidden: false }] };
    assert.match(textOf(await callTool('check_chart', { chart }, host)), /^OK/);
    host.notes.set('N.md', '');
    host.open = 'N.md';
    assert.ok(!(await callTool('add_chart', { chart }, host)).isError);
    const written = blocksOf(host.notes.get('N.md') || '')[0];
    assert.equal((data(written.text) as { title: string }).title, chart.title);
});

test('ai server: batches, messages without a method and odd parameters get JSON-RPC errors, never exceptions', async () => {
    const host = new FakeHost();
    const batch = (await handleMcp([{ jsonrpc: '2.0', id: 1, method: 'ping' }], host)) as { error: { code: number } };
    assert.equal(batch.error.code, -32600);
    const empty = (await handleMcp([], host)) as { error: { code: number } };
    assert.equal(empty.error.code, -32600);
    const noMethod = (await handleMcp({ jsonrpc: '2.0', id: 7 }, host)) as { error: { code: number } };
    assert.equal(noMethod.error.code, -32600);
    assert.equal(await handleMcp({ jsonrpc: '2.0', id: 8, result: {} }, host), null, 'a response from the client');
    const odd = (await handleMcp({ jsonrpc: '2.0', id: 9, method: 'prompts/get', params: { name: 'make_chart', arguments: { description: { toString: 1 } } } }, host)) as { result: unknown };
    assert.ok(odd.result, 'an object as description is ignored, not thrown');
    const uri = (await handleMcp({ jsonrpc: '2.0', id: 10, method: 'resources/read', params: { uri: { a: 1 } } }, host)) as { error: { code: number } };
    assert.equal(uri.error.code, -32002);
});

test('ai server: export_latex and active_note', async () => {
    const host = new FakeHost();
    assert.match(textOf(await callTool('export_latex', { chart: SINE }, host)), /\\documentclass/);
    assert.ok(!/\\documentclass/.test(textOf(await callTool('export_latex', { chart: SINE, standalone: false }, host))));
    host.notes.set('N.md', '# Title\n## Part');
    host.open = 'N.md';
    assert.match(textOf(await callTool('active_note', {}, host)), /N\.md \(0 charts\)[\s\S]*## Part/);
    assert.ok((await callTool('render_chart', { chart: SINE }, host)).isError, 'no pictures without a renderer');
});

test('ai server: the gate admits only local, non-browser requests with the token', () => {
    const ok = (headers: Record<string, string>, url = '/tools', method = 'GET') => gate({ method, url, headers }, 'secret', 27150);
    assert.equal(ok({ host: '127.0.0.1:27150', authorization: 'Bearer secret' }).ok, true);
    assert.equal(ok({ host: 'localhost:27150' }, '/guide?token=secret').ok, true);
    const root = ok({ host: '127.0.0.1:27150' }, '/', 'GET');
    assert.ok(!root.ok && root.status === 401, 'GET / needs the token too');
    const noToken = ok({ host: '127.0.0.1:27150' });
    assert.ok(!noToken.ok && noToken.status === 401);
    const wrong = ok({ host: '127.0.0.1:27150', authorization: 'Bearer nope' });
    assert.ok(!wrong.ok && wrong.status === 401);
    const page = ok({ host: '127.0.0.1:27150', authorization: 'Bearer secret', origin: 'https://evil.example' });
    assert.ok(!page.ok && page.status === 403);
    const rebinding = ok({ host: 'evil.example:27150', authorization: 'Bearer secret' });
    assert.ok(!rebinding.ok && rebinding.status === 421);
});

test('ai server: connection snippets and the AGENTS.md section', () => {
    const token = newToken();
    assert.match(token, /^[0-9a-f]{32}$/);
    assert.notEqual(newToken(), token);
    for (const app of AI_APPS) {
        const s = app.snippet('http://127.0.0.1:27150/mcp', token);
        assert.ok(s.includes(token), `${app.name} carries the token`);
        assert.ok(s.includes('127.0.0.1:27150'), `${app.name} carries the address`);
        if (s.trim().startsWith('{')) JSON.parse(s);
    }
    for (const app of AI_APPS) {
        const shown = shownSnippet(app, 'http://127.0.0.1:27150/mcp', token);
        assert.ok(!shown.includes(token), `${app.name} shows the token on screen`);
        assert.ok(shown.includes(maskToken(token)), `${app.name} shows the masked token`);
    }
    assert.ok(AI_APPS.find((a) => a.id === 'claude-desktop')?.snippet('u', token).includes('mcp-remote@^0.1.16'), 'mcp-remote is pinned to fixed versions');
    const section = agentsSection('.obsidian', 27150, '4.3.0');
    assert.ok(!section.includes(token));
    assert.match(section, /blob\/4\.3\.0\/docs\/ai\.md/, 'the guide of the installed version');
    assert.match(section, /\.obsidian\/plugins\/easy-tikz\/data\.json/);
    const once = mergeAgentsSection('# My agents\n\nBe nice.\n', section);
    assert.match(once, /^# My agents\n\nBe nice\.\n\n<!-- easy-tikz:start -->/);
    const twice = mergeAgentsSection(once, agentsSection('.obsidian', 28000));
    assert.equal(twice.split('easy-tikz:start').length, 2, 'replaced, not added again');
    assert.match(twice, /28000/);
    assert.ok(!twice.includes('27150'));
});

// ------------------------------------------------------- forgiving blocks

import { impliedV4, parseLenientJson, stripJsonNoise } from '../src/blockjson';

test('blocks: comments and trailing commas are read, strings are left alone', () => {
    const text = `{
  // a chart an AI wrote
  "v": 4, /* the version */
  "title": "see https://example.com // not a comment, nor /* this */",
  "functions": [{ "name": "f1", "expression": "x^2", }, ],
}`;
    const data = parseLenientJson(text) as { title: string; functions: unknown[] };
    assert.equal(data.title, 'see https://example.com // not a comment, nor /* this */');
    assert.equal(data.functions.length, 1);
    assert.equal(stripJsonNoise('{"a": "x\\" // y"}'), '{"a": "x\\" // y"}');
    assert.throws(() => parseLenientJson('{"a": }'), /JSON|Unexpected/);
});

test('blocks: a block without "v" is version 4 unless it carries what 3.x saved', () => {
    assert.equal(impliedV4({ functions: [{ expression: 'x^2' }] }), true);
    assert.equal(impliedV4({ tools: [{ type: 'region', conditions: ['x >= 0'] }] }), true);
    assert.equal(impliedV4({ v: 4 }), false, 'already has v');
    assert.equal(impliedV4({ documentClose: true, functions: [] }), false, 'saved by 3.x');
    assert.equal(impliedV4({ tools: [{ type: 'areaBetween' }] }), false, '3.x tool type');
    // The checker reads it as the note does: the function is drawn (not hidden as in a 3.x block) and "v" is still asked for.
    const r = check({ xmin: 0, xmax: 2, ymin: 0, ymax: 4, functions: [{ name: 'f1', expression: 'x^2' }] });
    assert.match(r.errors.join('\n'), /"v": 4 is missing\. Add it/);
    assert.match(r.lines.join('\n'), /f1: y = x\^2 \| y 0\.\.4/);
});
