/*
 * 6.2.1 (issue #10): what a paste into the editor opens. Cmd/Ctrl+V, the
 * menu's "Paste a chart" and the command "New chart from the clipboard"
 * read the clipboard with readPasted: lines in words or Full LaTeX, with or
 * without the ```easy-tikz fences, and JSON charts; anything else pastes as
 * before. The AI tab's chartFromText keeps its own rules.
 */
import { test, assert } from './_lib';
import { chartFromText, pasteMessage, readPasted } from '../src/text/paste';
import { SettingsManager } from '../src/settings';

type Data = Record<string, unknown>;

/** The text of issue #10, as its author pasted it. */
const ISSUE = [
    'show x from -5 to 5 and y from -0.05 to 0.45',
    'axes in the middle',
    'with a grid',
    'title Student t PDF (df = {df})',
    'slider df from 1 to 30, starting at 5, in steps of 1',
    'plot f(x) = (gamma((df + 1) / 2) / (sqrt(df * pi) * gamma(df / 2))) * (1 + x^2 / df)^(-(df + 1) / 2) in blue, thick',
].join('\n');

const chartOf = (text: string, asked = false): Data => {
    const p = readPasted(text, asked);
    assert.equal(p.kind, 'chart', JSON.stringify(p));
    return p.kind === 'chart' ? p.data : {};
};

test('paste: the issue\'s lines open as a chart with the slider df, its title and a curve that draws', () => {
    const data = chartOf(ISSUE);
    assert.deepEqual((data.parameters as Data[]).map((p) => [p.name, p.value, p.min, p.max, p.step]), [['df', 5, 1, 30, 1]]);
    assert.equal(data.title, 'Student t PDF (df = {df})');
    const settings = SettingsManager.fromJSON(data);
    const math = settings.createMathContext();
    const f = math.functionInfo('f');
    assert.ok(f && !f.error, f?.error);
    assert.ok(Math.abs((f ? f.fn(0) : 0) - 0.3796066898224944) < 1e-12);
    assert.equal(math.formatTemplate('Student t PDF (df = {df})'), 'Student t PDF (df = 5)');
});

test('paste: with fences, in a chat answer, as Full LaTeX, as JSON, with Windows line ends', () => {
    const fenced = chartOf('Here is your chart:\n\n```easy-tikz\n' + ISSUE + '\n```\n\nEnjoy!');
    assert.equal((fenced.functions as Data[]).length, 1);
    chartOf('~~~easy-tikz\nplot the t distribution with df = 5\n~~~');
    chartOf(ISSUE.replace(/\n/g, '\r\n'));
    const full = chartOf('\\begin{chart}\n\\axis[xmin=-4, xmax=4]\n\\plot{the t distribution with df = 5}\n\\end{chart}');
    assert.equal((full.tools as Data[])[0].kind, 'studentT');
    const json = chartOf('{"v": 4, "functions": [{"name": "f", "expression": "x^2"}]}');
    assert.equal(json.v, 4);
    // A JSON chart without "v", in a fence (as AI chats write it), with a trailing comma.
    const loose = chartOf('```easy-tikz\n{"functions": [{"name": "f", "expression": "x^2"}],}\n```');
    assert.equal(loose.v, 4);
});

test('paste: text that is no chart pastes as before', () => {
    for (const text of ['', '   ', 'Hello, this is a note about statistics.', 'https://github.com/Saiki77/easy-tikz/issues/10', '{"name": "not a chart", "items": [1, 2]}', '{ broken json', 'slider a from 0 to 1']) {
        assert.equal(readPasted(text).kind, 'none', text);
    }
    // Lines with a problem are left alone by Cmd+V; asked for (menu, command), the problem is named.
    const typo = 'show x from -5 to 5\nplot f(x) = x^2\nshdae between f and 0';
    assert.equal(readPasted(typo).kind, 'none');
    const asked = readPasted(typo, true);
    assert.ok(asked.kind === 'problem' && /Line 3/.test(asked.message), JSON.stringify(asked));
});

test('paste: a fenced block that is meant as a chart says what is wrong', () => {
    const bad = readPasted('```easy-tikz\nplot f(x) = x^2\nshdae between f and 0\n```');
    assert.ok(bad.kind === 'problem' && /has a problem\. Line 2/.test(bad.message), JSON.stringify(bad));
    const empty = readPasted('```easy-tikz\nslider a from 0 to 1\n```');
    assert.ok(empty.kind === 'problem' && empty.message === 'The chart on the clipboard is empty.', JSON.stringify(empty));
    const json = readPasted('```easy-tikz\n{"v": 4, "functions": [\n```');
    assert.ok(json.kind === 'problem' && /not valid JSON/.test(json.message), JSON.stringify(json));
    assert.equal(pasteMessage({ kind: 'none' }, ''), 'The clipboard is empty.');
    assert.match(pasteMessage({ kind: 'none' }, 'some words'), /^The clipboard holds no chart\./);
});

test('paste: the AI tab keeps its rules (sliders alone count there, its own message)', () => {
    const sliders = chartFromText('slider a from 0 to 1');
    assert.ok(typeof sliders === 'object');
    assert.match(String(chartFromText('Hello there')), /holds no Easy Graphs Charts and TikZ chart/);
    const issue = chartFromText(ISSUE);
    assert.ok(typeof issue === 'object' && Array.isArray(issue.functions));
});
