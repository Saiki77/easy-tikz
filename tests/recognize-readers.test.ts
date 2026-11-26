// 6.2.1: the card readers round 3 of formula recognition needs
// (src/notes6/recognize/adapt.ts and src/notes6/hover.ts, DESIGN3.md
// section 3): sets with ;, \middle|, :, \colon and words, a value or a name
// around the set, a set by its condition only; maps with \colon and a domain
// that is an interval, a ray or a set D of the note, a built-in as the name;
// a set of pairs with one equation as that equation's curve (S3); an
// interval after an image or the interval a set defines. Each card is drawn
// as the hover card draws it: its lines parse, and its scene has no problem.
import { test, assert } from './_lib';
import { parseChartText } from '../src/text/parse';
import { SettingsManager } from '../src/settings';
import { computeScene2D, labelMetricsFor, Scene2D } from '../src/scene';
import { hoverCard, noteDefinitions } from '../src/notes6/hover';
import { noteDomains, spellings } from '../src/notes6/recognize/adapt';
import { smartChart, smartNotes6 } from '../src/notes6/recognize/decide';

/** The scene of a card's lines (2D). */
function sceneOf(lines: string[]): Scene2D {
    const parsed = parseChartText(lines.join('\n'));
    assert.deepEqual(parsed.problems, [], lines.join(' / '));
    const settings = SettingsManager.fromJSON(parsed.data);
    const math = settings.createMathContext({ memo: false });
    const config = settings.toRendererConfig(math);
    return computeScene2D({
        functions: config.functions,
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: { nx: 60, ny: 60 },
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(8, 5.5),
    });
}

/** The set card of a formula under Smart (its spellings), with the note's functions. */
const setCard = (tex: string, label: 'set' | 'map' | 'interval' = 'set', notes: string[] = ['g(x) = x^2 - 4']) => smartNotes6(tex, label, noteDefinitions(notes), noteDomains(notes));

test('set reader: ; : \\colon \\middle| and words as the separator, as \\mid', () => {
    for (const tex of [
        '\\{ x \\in \\mathbb{R}^n ;\\, g(x) \\le 0 \\}',
        '\\{x \\in \\mathbb{R}^n : g(x) \\le 0\\}',
        '\\{x \\in \\mathbb{R}^n \\colon g(x) \\le 0\\}',
        '\\left\\{ x \\in \\mathbb{R}^n \\;\\middle|\\; g(x) \\le 0 \\right\\}',
        '\\{x \\in \\mathbb{R}^n \\text{ mit } g(x) \\le 0\\}',
        '\\{x \\in ℝ^n \\vert g(x) \\le 0\\}',
    ]) {
        const c = setCard(tex);
        assert.ok(c && c.kind === 'set', `${tex}: ${c ? c.lines.join(' / ') : 'no card'}`);
        assert.ok(c.lines.includes('mark where $g(x) \\le 0$ on the x-axis, labelled'), `${tex}: ${c.lines.join(' / ')}`);
        assert.ok(c.lines2, `${tex}: no n = 2 chart`);
    }
});

test('set reader: a value or a name around the set, a membership in the condition, a set by its condition only, coordinates x_1 and x_2', () => {
    const cases: Array<[string, string]> = [
        ['\\{ x \\in \\mathbb{R} \\mid x^2 < 4 \\} = (-2, 2)', 'mark where $x^2 < 4$ on the x-axis, labelled'],
        ['\\{ x \\mid x \\in \\mathbb{R}^n,\\ g(x) \\le 0 \\}', 'mark where $g(x) \\le 0$ on the x-axis, labelled'],
        ['C_4 = \\{ x_1^2 + x_2^2 \\le 4 \\}', 'shade where $x^2 + y^2 \\le 4$, outlined'],
        ['\\{ x_1 + x_2 \\le 4,\\ x_1 \\ge 0,\\ x_2 \\ge 0 \\}', 'shade where $x + y \\le 4, x \\ge 0, y \\ge 0$, outlined'],
        ['\\mathcal{F} = \\{ x \\in \\mathbb{R}^2 \\mid x_1 + x_2 \\le 4,\\ x_1 \\le 3,\\ x \\ge 0 \\}', 'shade where $x + y \\le 4, x \\le 3, x \\ge 0, y \\ge 0$, outlined'],
        ['\\{(x_1, x_2) \\in \\mathbb{R}^2 \\mid x_1^2 + x_2^2 < 1\\}', 'shade where $x^2 + y^2 < 1$, outlined'],
        ['F^{-1}([0, 1]) = \\{ (x, y) \\mid x^2 + y^2 \\le 1 \\}', 'shade where $x^2 + y^2 \\le 1$, outlined'],
    ];
    for (const [tex, line] of cases) {
        const c = setCard(tex);
        assert.ok(c && c.kind === 'set', `${tex}: no set card`);
        assert.ok(c.lines.includes(line), `${tex}: ${c.lines.join(' / ')}`);
        assert.deepEqual(sceneOf(c.lines).issues, [], tex);
    }
});

test('S3: a set of pairs with one equation opens the card of that equation, its coordinates as x and y', () => {
    const cases: Array<[string, 'implicit' | 'function', string]> = [
        ['\\{ (x, y) \\mid x^2 + y^2 = 1 \\}', 'implicit', 'x^2 + y^2 = 1'],
        ['M_2 = \\{ (x, y) \\in \\mathbb{R}^2 \\mid x^2 + y^2 = 1 \\}', 'implicit', 'x^2 + y^2 = 1'],
        ['\\{(u, v) \\mid u = 1\\}', 'implicit', 'x = 1'],
        ['\\{(x_1, x_2) \\in \\mathbb{R}^2 \\mid 2x_1 - x_2 = 1\\}', 'implicit', '2x - y = 1'],
        ['\\ker A = \\{ (x, y) \\in \\mathbb{R}^2 \\mid x + 2y = 0 \\} = \\operatorname{span}\\bigl((-2, 1)\\bigr)', 'implicit', 'x + 2y = 0'],
        ['\\{ (x, y) \\in \\mathbb{R}^2 \\mid y = 2x + 1 \\}', 'function', 'y = 2x + 1'],
    ];
    for (const [tex, label, eq] of cases) {
        assert.ok(
            spellings(tex, label).some((s) => s.tex === eq),
            `${tex}: ${spellings(tex, label)
                .map((s) => s.tex)
                .join(' | ')}`
        );
        const c = smartChart(tex, undefined, tex, label);
        assert.ok(c, `${tex}: no chart`);
        assert.equal(c.kind, label === 'implicit' ? 'equation' : 'function', tex);
    }
    // With an inequality it stays a set, and two equations are no curve.
    assert.ok(!spellings('\\{(x, y) \\mid x^2 + y^2 \\le 1\\}', 'implicit').some((s) => s.tex === 'x^2 + y^2 \\le 1'));
    assert.ok(!spellings('\\{(x, y) \\mid x = 1, y = 2\\}', 'implicit').some((s) => s.tex === 'x = 1, y = 2'));
});

test('map reader: \\colon, an interval or a ray as the domain, a set D of the note, a built-in as the name', () => {
    for (const tex of ['f \\colon (0, \\infty) \\to \\mathbb{R}', 'h \\colon [0, \\infty) \\to [0, \\infty)', 'r \\colon \\mathbb{R} \\setminus \\{0\\} \\to \\mathbb{R}', 'f\\colon \\mathbb{R}_{>0} \\longrightarrow \\mathbb{R}']) {
        const c = setCard(tex, 'map', ['f(x) = \\ln x', 'h(x) = \\sqrt{x}', 'r(x) = 1/x']);
        assert.ok(c && c.kind === 'map', `${tex}: no map card`);
        assert.ok(!c.lines2, `${tex}: a domain on a line has no n = 2 chart`);
    }
    // D from the note: an interval is a line, a set in the plane gives the n = 2 chart (its level curves).
    assert.deepEqual([...noteDomains(['D = [0, 1]', 'E \\subseteq \\mathbb{R}^2', 'Q = [0, 1] \\times [0, 2]', 'S = \\{(x, y) \\mid x^2 + y^2 \\le 1\\}', 'B = \\mathbb{R}^3'])], [
        ['D', '\\mathbb{R}'],
        ['E', '\\mathbb{R}^2'],
        ['Q', '\\mathbb{R}^2'],
        ['S', '\\mathbb{R}^2'],
    ]);
    const line = setCard('f: D \\to \\mathbb{R}', 'map', ['D = [0, 1]', 'f(x) = x^2']);
    assert.ok(line && line.kind === 'map' && !line.lines2, line?.lines.join(' / '));
    const plane = setCard('f: D \\to \\mathbb{R}', 'map', ['D \\subseteq \\mathbb{R}^2', 'f(x) = x^2']);
    assert.ok(plane && plane.kind === 'map' && plane.lines2, plane?.lines.join(' / '));
    // \ln and \sin as the name: the card draws them, and says nothing of an example.
    const ln = setCard('\\ln \\colon (0,\\infty) \\to \\mathbb{R}', 'map', []);
    assert.ok(ln && ln.lines.includes('plot $y = \\ln(x)$ in blue, thick') && ln.fn?.from === 'builtin', ln?.lines.join(' / '));
    assert.deepEqual(sceneOf(ln.lines).issues, []);
    const sin = hoverCard('sin: \\mathbb{R} \\to \\mathbb{R}', new Map());
    assert.ok(sin && sin.lines.includes('plot $y = \\sin(x)$ in blue, thick'), sin?.lines.join(' / '));
});

test('interval reader: an interval after an image or a set operation, and the interval a set defines', () => {
    for (const [tex, want] of [
        ['g(\\mathbb{R}) = [0, \\infty)', 'x \\in [0, \\infty)'],
        ['A \\cup B = [-2, 4]', 'x \\in [-2, 4]'],
        ['q([0, 1]) = [-1, 2]', 'x \\in [-1, 2]'],
        ['[a, b] = \\{ x \\in \\mathbb{R} \\mid a \\le x \\le b \\}', 'x \\in [a, b]'],
    ]) {
        const c = setCard(tex, 'interval');
        assert.ok(c && c.kind === 'interval', `${tex}: ${c ? c.kind : 'no card'}`);
        assert.ok(c.lines.some((l) => l.includes(want)), `${tex}: ${c.lines.join(' / ')}`);
    }
});
