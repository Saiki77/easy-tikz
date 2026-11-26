/*
 * Python in a chart (6.0 P), the chart side: the python block in words and
 * Full LaTeX (read, printed back exactly, rewritten keeping its lines),
 * script values in chart formulas and the turning circles of the heart,
 * sliders as script variables, matplotlib calls as scene primitives, the
 * view of a chart without a range, frame(t) on the clock, problems with
 * the script's line, the pgfplots export.
 */
import { test, assert, near } from './_lib';
import { parseChartText } from '../src/text/parse';
import { printChartText, printFullText, printWordsText, writeChartText } from '../src/text/print';
import { wordsToFull } from '../src/text/full';
import { SettingsManager } from '../src/settings';
import { SceneCache, computeScene2D, labelMetricsFor, Scene2D } from '../src/scene';
import type { MotionFrame } from '../src/types';
import { needsClock } from '../src/motion6/clock';
import { coefficientOrder } from '../src/iterate/fourier';
import { compileValue, letValue } from '../src/values';

const HEART = `show x from -20 to 20 and y from -15 to 15
equal scale
slider n from 1 to 120, starting at 40, in steps of 1
python:
    import numpy as np
    t = np.linspace(0, 2*np.pi, 256, endpoint=False)
    heart = 16*np.sin(t)**3 + 1j*(13*np.cos(t) - 5*np.cos(2*t) - 2*np.cos(3*t) - np.cos(4*t))
    c = np.fft.fft(heart) / len(heart)
draw the circles of c, using n circles, with its path`;

function settingsOf(text: string): SettingsManager {
    const r = parseChartText(text);
    assert.deepEqual(r.problems, [], text);
    return SettingsManager.fromJSON(r.data);
}

function sceneOf(text: string, motion?: MotionFrame, values?: Record<string, number>, cache?: SceneCache): Scene2D {
    const settings = settingsOf(text);
    const math = settings.createMathContext();
    if (values) math.setParamValues(values);
    const config = settings.toRendererConfig(math);
    return computeScene2D({
        functions: config.functions,
        tools: config.tools,
        math,
        view: { xmin: config.xmin, xmax: config.xmax, ymin: config.ymin, ymax: config.ymax },
        grid: { nx: 100, ny: 100 },
        axisStyle: config.axisStyle,
        polar: false,
        labelMetrics: labelMetricsFor(10, 10),
        cache,
        motion,
    });
}

test('the python block in words: read, printed back exactly', () => {
    const r = parseChartText(HEART);
    assert.deepEqual(r.problems, []);
    const tools = r.data.tools as Array<Record<string, unknown>>;
    assert.equal(tools[0].type, 'python');
    assert.equal(tools[0].name, 'PY1');
    assert.equal(tools[0].code, 'import numpy as np\nt = np.linspace(0, 2*np.pi, 256, endpoint=False)\nheart = 16*np.sin(t)**3 + 1j*(13*np.cos(t) - 5*np.cos(2*t) - 2*np.cos(3*t) - np.cos(4*t))\nc = np.fft.fft(heart) / len(heart)');
    assert.equal(tools[1].type, 'fourierCircles');
    assert.equal(tools[1].sum, 'c');
    assert.equal(tools[1].count, 'n');
    assert.equal(tools[1].path, true);
    assert.equal(printChartText(r.data), HEART);
});

test('any indent, blank lines inside, a block ends at the first line that is not indented', () => {
    const text = 'python:\n  def f(x):\n      return x * 2\n\n  y = f(3)\nmark the point (y, 1)';
    const r = parseChartText(text);
    assert.deepEqual(r.problems, []);
    const tools = r.data.tools as Array<Record<string, unknown>>;
    assert.equal(tools[0].code, 'def f(x):\n    return x * 2\n\ny = f(3)');
    assert.equal(tools[1].type, 'points');
    // The script's comments are the script's (a # line is no chart comment inside the block).
    const c = parseChartText('python:\n    # the value\n    k = 2\n# a chart comment');
    assert.equal((c.data.tools as Array<Record<string, unknown>>)[0].code, '# the value\nk = 2');
    // A python: line with nothing under it.
    const e = parseChartText('python:\nplot sin(x)');
    assert.equal(e.problems.length, 1);
    assert.match(e.problems[0].message, /indented/);
});

test('rewrite keeps the script lines as written (2-space indent) when another line changes', () => {
    const text = 'slider a from 0 to 2, starting at 1\npython:\n  k = a * 2   # twice\n  m = k + 1\nplot f(x) = k * x';
    const r = parseChartText(text);
    const data = JSON.parse(JSON.stringify(r.data));
    (data.functions as Array<Record<string, unknown>>)[0].color = 'red';
    const out = writeChartText(text, data);
    assert.equal(out, 'slider a from 0 to 2, starting at 1\npython:\n  k = a * 2   # twice\n  m = k + 1\nplot f(x) = k * x in red');
    // A changed script is written with 4 spaces.
    const d2 = JSON.parse(JSON.stringify(r.data));
    (d2.tools as Array<Record<string, unknown>>)[0].code = 'k = a * 3';
    assert.equal(writeChartText(text, d2), 'slider a from 0 to 2, starting at 1\npython:\n    k = a * 3\nplot f(x) = k * x');
});

test('Full LaTeX: \\begin{python} ... \\end{python}, both ways', () => {
    const full = wordsToFull(HEART, { builtin: true });
    assert.match(full, /\\begin\{python\}\nimport numpy as np\nt = np\.linspace/);
    assert.match(full, /c = np\.fft\.fft\(heart\) \/ len\(heart\)\n\\end\{python\}/);
    assert.match(full, /\\circles\[[^\]]*count=n[^\]]*\]\{c\}/);
    assert.match(full, /\\circles\[[^\]]*path[^\]]*\]/);
    const back = parseChartText(full);
    assert.deepEqual(back.problems, []);
    const a = parseChartText(HEART).data;
    assert.equal(JSON.stringify(back.data.tools), JSON.stringify(a.tools));
    assert.equal(printFullText(a), full);
    // Rewriting a Full LaTeX block keeps \end{python} once.
    const data = JSON.parse(JSON.stringify(back.data));
    (data.tools as Array<Record<string, unknown>>)[0].code = 'import numpy as np\nc = np.array([1j, 0.5])';
    const re = writeChartText(full, data);
    assert.equal(re.split('\\end{python}').length, 2, re);
    assert.equal(JSON.stringify(parseChartText(re).data.tools), JSON.stringify(data.tools));
});

test('script values are values of the chart; sliders are script variables', () => {
    const text = 'slider a from 0 to 5, starting at 2\npython:\n    import numpy as np\n    k = a ** 2\n    w = 1 + 2j\n    v = np.array([3.0, 4.0])\n    pts = np.column_stack([np.arange(5), np.arange(5) ** 2])\n    def f(x):\n        return np.sin(x) * k\nplot g(x) = f(x)';
    const settings = settingsOf(text);
    const math = settings.createMathContext();
    assert.equal(letValue(math, 'k'), 4);
    assert.deepEqual(letValue(math, 'w'), { kind: 'complex', re: 1, im: 2 });
    assert.deepEqual(letValue(math, 'v'), { kind: 'vec', v: [3, 4] });
    const pts = letValue(math, 'pts');
    assert.equal(typeof pts !== 'number' && pts.kind === 'list' ? pts.items.length : 0, 5);
    near(math.fn1('g')(1), Math.sin(1) * 4, 1e-12);
    math.setParamValues({ a: 3 });
    assert.equal(letValue(math, 'k'), 9);
    near(math.fn1('g')(1), Math.sin(1) * 9, 1e-12);
    const r = compileValue(math, 'k + 1').run();
    assert.equal(r, 10);
    // t, x and the slider's own name stay the chart's.
    const s2 = settingsOf('slider n from 1 to 3\npython:\n    t = 5\n    n = 7\n    m = n + t');
    const m2 = s2.createMathContext();
    assert.equal(letValue(m2, 'm'), 12);
    assert.ok(Number.isNaN(letValue(m2, 't') as number));
});

test('the heart: coefficients in fftfreq order, n circles turning, the path', () => {
    assert.deepEqual(coefficientOrder(5).map((o) => o.freq), [0, 1, -1, 2, -2]);
    assert.deepEqual(coefficientOrder(4).map((o) => o.index), [0, 1, 3, 2]);
    const scene = sceneOf(HEART);
    assert.deepEqual(scene.issues, []);
    const circles = scene.items.find((i) => i.source === 'FC1');
    assert.ok(circles, 'circles item');
    if (!circles) return;
    // 40 terms; the still frame (t = 0) has the arms ending where the heart starts: the sum of the 40 terms at 0.
    const arms = circles.strokes.find((s) => s.exact && s.still);
    assert.ok(arms);
    assert.equal(arms?.lines[0].length, 41);
    const tip = arms?.lines[0][40];
    // heart(0) = 0 + i(13 - 5 - 2 - 1) = 5i; 40 terms come close.
    near(tip?.x ?? NaN, 0, 0.2);
    near(tip?.y ?? NaN, 5, 0.3);
    // with its path: the whole path in the export (still), and on the live canvas the part drawn so far.
    const path = circles.strokes.find((s) => s.still && !s.exact && s.lines[0].length > 300);
    assert.ok(path, 'the path');
    assert.ok(circles.live && circles.live.length === 1);
    const shapes = circles.live?.[0].at?.(2);
    assert.ok(shapes && shapes.lines.length >= 2);
    // More circles: closer to the heart (n = 120).
    const full = sceneOf(HEART, undefined, { n: 120 }).items.find((i) => i.source === 'FC1');
    const tip2 = full?.strokes.find((s) => s.exact && s.still)?.lines[0];
    assert.equal(tip2?.length, 121);
    near(tip2?.[120].y ?? NaN, 5, 0.05);
    assert.equal(needsClock(parseChartText(HEART).data), true);
});

test('matplotlib calls become primitives in the theme colours', () => {
    const text = `show x from -4 to 4 and y from -2 to 2
python:
    import numpy as np
    import matplotlib.pyplot as plt
    x = np.linspace(-3, 3, 50)
    plt.plot(x, np.sin(x), label="sin")
    plt.plot(x, np.cos(x), 'r--', linewidth=1)
    plt.scatter([0, 1], [0, 0.5], s=80, c='C2')
    plt.fill_between(x, 0, np.sin(x), alpha=0.3)
    plt.axhline(0.5, color='k', linestyle=':')
    plt.arrow(0, 0, 1, 1)
    plt.text(1, 1, "top")
    plt.title("Waves")
    plt.legend()`;
    const scene = sceneOf(text);
    assert.deepEqual(scene.issues, []);
    const item = scene.items.find((i) => i.source === 'PY1');
    assert.ok(item);
    if (!item) return;
    const colours = item.strokes.map((s) => s.color);
    assert.ok(colours.includes('blue'));
    assert.ok(colours.includes('red'));
    assert.ok(item.strokes.some((s) => s.color === 'red' && s.dashed && s.width === 'thin'));
    assert.ok(item.strokes.some((s) => s.arrow === 'forward'));
    assert.ok(item.strokes.some((s) => s.color === 'black' && s.dashed && s.lines[0][0].x === -4 && s.lines[0][1].x === 4));
    assert.equal(item.markers.filter((m) => m.color === 'green' && m.size === 'large').length, 2);
    assert.equal(item.fills.filter((f) => f.opacity === 0.3).length, 1);
    const texts = item.texts.map((t) => t.text);
    assert.ok(texts.includes('top'));
    assert.ok(texts.includes('sin'));
    // The chart takes the script's title (it has none of its own).
    const settings = settingsOf(text);
    assert.equal(settings.toRendererConfig(settings.createMathContext()).title, 'Waves');
    assert.ok(!texts.includes('Waves'));
});

test('a chart without a range shows what the script draws (or its xlim and ylim)', () => {
    const s = settingsOf('python:\n    import matplotlib.pyplot as plt\n    plt.plot([0, 10], [0, 20])');
    const v = s.resolveView(s.createMathContext()).view;
    near(v.xmin, -0.5, 1e-9);
    near(v.xmax, 10.5, 1e-9);
    near(v.ymin, -1, 1e-9);
    near(v.ymax, 21, 1e-9);
    const l = settingsOf('python:\n    import matplotlib.pyplot as plt\n    plt.plot([0, 10], [0, 20])\n    plt.xlim(-1, 1)\n    plt.ylim(0, 3)');
    const w = l.resolveView(l.createMathContext()).view;
    assert.deepEqual([w.xmin, w.xmax, w.ymin, w.ymax], [-1, 1, 0, 3]);
    // A chart with its own range keeps it.
    const k = settingsOf('show x from -2 to 2 and y from -1 to 1\npython:\n    import matplotlib.pyplot as plt\n    plt.plot([0, 10], [0, 20])');
    const u = k.resolveView(k.createMathContext()).view;
    assert.deepEqual([u.xmin, u.xmax, u.ymin, u.ymax], [-2, 2, -1, 1]);
});

test('frame(t) moves on the clock; the still frame is frame(0)', () => {
    const text = `show x from 0 to 7 and y from -1.5 to 1.5
python:
    import numpy as np
    import matplotlib.pyplot as plt
    x = np.linspace(0, 2 * np.pi, 100)
    plt.plot(x, 0 * x, color="gray")
    def frame(t):
        plt.plot(x, np.sin(x - t))
        plt.scatter([t % 6], [0.5])`;
    assert.equal(needsClock(parseChartText(text).data), true);
    const still = sceneOf(text);
    assert.deepEqual(still.issues, []);
    const item = still.items[0];
    const moving = item.strokes.filter((s) => s.still);
    assert.equal(moving.length, 1);
    near(moving[0].lines[0][0].y, Math.sin(0), 1e-12);
    near(moving[0].lines[0][10].y, Math.sin(x10()), 1e-12);
    assert.ok(item.strokes.some((s) => !s.still && s.color === 'gray'));
    const live = item.live?.[0].at?.(1);
    assert.ok(live);
    near(live?.lines[0].pts[10].y ?? NaN, Math.sin(x10() - 1), 1e-12);
    assert.equal(live?.dots.length, 1);
    // The still time of the chart.
    const later = sceneOf(text, { time: 1, step: Infinity, progress: 1 });
    near(later.items[0].strokes.filter((s) => s.still)[0].lines[0][10].y, Math.sin(x10() - 1), 1e-12);
    function x10() {
        return (2 * Math.PI * 10) / 99;
    }
});

test('problems name the line of the script', () => {
    const scene = sceneOf('show x from -1 to 1 and y from -1 to 1\npython:\n    x = 1\n    y = np.sin(x)');
    assert.equal(scene.issues.length, 1);
    assert.equal(scene.issues[0].message, "Line 2 of the script: name 'np' is not defined");
    assert.equal(scene.issues[0].severity, 'error');
    const two = sceneOf('show x from -1 to 1 and y from -1 to 1\npython:\n    a = 1\nplot sin(x)\npython:\n    b = c + 1');
    assert.ok(two.issues.some((i) => i.message === "Line 1 of script 2: name 'c' is not defined"), JSON.stringify(two.issues));
    const printed = sceneOf('show x from -1 to 1 and y from -1 to 1\npython:\n    print("hello", 2)');
    assert.equal(printed.issues[0].severity, 'info');
    assert.equal(printed.issues[0].message, 'The script printed: hello 2');
});

test('the export draws what the preview draws (coordinates)', () => {
    const text = `show x from -4 to 4 and y from -2 to 2
python:
    import numpy as np
    import matplotlib.pyplot as plt
    x = np.linspace(-3, 3, 7)
    plt.plot(x, x / 3, color="C3")
    plt.scatter([1], [1])`;
    const tikz = settingsOf(text).generateTikzCode();
    assert.match(tikz, /-3,\s?-1\)/);
    assert.match(tikz, /3,\s?1\)/);
    assert.match(tikz, /etRed/);
    assert.match(tikz, /only marks/);
    const heart = settingsOf(HEART).generateTikzCode();
    assert.match(heart, /\\begin\{axis\}/);
    assert.doesNotMatch(heart, /nan/i);
});

test('charts without a python block print as before', () => {
    for (const text of ['plot f(x) = sin(x)', 'show x from -3 to 3 and y from -4 to 4\nslider a from -1 to 1, starting at 0.5\nplot f(x) = x^3 - 3x in blue, thick', 'draw the circles of $\\sum_{k=1}^{n} \\frac{4}{\\pi (2k - 1)} e^{i(2k - 1)t}$, with its wave']) {
        const r = parseChartText(text);
        assert.equal(printWordsText(r.data), text);
    }
});

test('the colour of a block is the first colour of its cycle; comments between its lines stay', () => {
    const text = 'show x from 0 to 3 and y from 0 to 3\npython in red:\n    import matplotlib.pyplot as plt\n% a chart comment\n    plt.plot([0, 1], [0, 1])\n    plt.plot([0, 1], [1, 2])';
    const r = parseChartText(text);
    assert.deepEqual(r.problems, []);
    const tool = (r.data.tools as Array<Record<string, unknown>>)[0];
    assert.equal(tool.color, 'red');
    assert.equal(tool.code, 'import matplotlib.pyplot as plt\nplt.plot([0, 1], [0, 1])\nplt.plot([0, 1], [1, 2])');
    const scene = sceneOf(text);
    assert.deepEqual(scene.items[0].strokes.map((s) => s.color), ['red', 'orange']);
    assert.equal(printChartText(r.data), 'show x from 0 to 3 and y from 0 to 3\npython in red:\n    import matplotlib.pyplot as plt\n    plt.plot([0, 1], [0, 1])\n    plt.plot([0, 1], [1, 2])');
    // Recolouring writes the head line only; the comment stays.
    const data = JSON.parse(JSON.stringify(r.data));
    (data.tools as Array<Record<string, unknown>>)[0].color = 'green';
    assert.equal(writeChartText(text, data), text.replace('python in red:', 'python in green:'));
    const full = wordsToFull(text, { builtin: true });
    assert.match(full, /\\begin\{python\}\[red\]/);
    assert.equal(JSON.stringify(parseChartText(full).data.tools), JSON.stringify(r.data.tools));
});

test('renaming a slider renames it in the script', async () => {
    const { renameInCode } = await import('../src/python/tools');
    assert.equal(renameInCode('k = a * 2  # a\nb = "a"\nc = f(a=a) + x.a', 'a', 'amp'), 'k = amp * 2  # a\nb = "a"\nc = f(a=amp) + x.a');
});

test('a frame(t) that fails names its line', () => {
    const scene = sceneOf('show x from 0 to 1 and y from 0 to 1\npython:\n    def frame(t):\n        return 1 / 0');
    assert.ok(scene.issues.some((i) => i.message === 'Line 2 of the script, in frame(t): division by zero'), JSON.stringify(scene.issues));
});

test('draw order as matplotlib: lines and arrows over the scatter dots go over the markers; scatter alpha is kept (6.2.1)', () => {
    const s = sceneOf(`show x from -1 to 5 and y from -1 to 3
python:
    import matplotlib.pyplot as plt
    plt.arrow(0, 0, 1, 1, color='C3')
    plt.scatter([0, 2, 4], [1, 1, 1], s=900, alpha=0.4)
    plt.arrow(0, 2, 1, 0, color='C1')
    plt.plot([0, 4], [0.5, 0.5])
    plt.plot([0, 4], [2.5, 2.5], zorder=0)
    plt.annotate('', xy=(2, 1), xytext=(0, 1), arrowprops=dict(arrowstyle='->'))`);
    const item = s.items.find((i) => i.source === 'PY1');
    assert.ok(item);
    const arrows = item.strokes.filter((p) => p.arrow);
    const lines = item.strokes.filter((p) => !p.arrow);
    // plt.arrow is zorder 1 like scatter: under the dots before it, over them after it; annotate is 3.
    assert.deepEqual(arrows.map((a) => !!a.front), [false, true, true]);
    // plot is zorder 2: over the dots; zorder=0 puts it under them.
    assert.deepEqual(lines.map((l) => !!l.front), [true, false]);
    assert.ok(item.markers.length === 3 && item.markers.every((m) => m.opacity === 0.4), JSON.stringify(item.markers));
});

test('a script without scatter dots keeps every line in the stroke layer (6.2.1)', () => {
    const s = sceneOf(`show x from -1 to 5 and y from -1 to 3
python:
    import matplotlib.pyplot as plt
    plt.plot([0, 4], [0.5, 0.5], 'o-')
    plt.arrow(0, 2, 1, 0)`);
    const item = s.items.find((i) => i.source === 'PY1');
    assert.ok(item && item.strokes.length === 2 && item.strokes.every((p) => !p.front));
});

test('the export draws an arrow over the scatter dots after them, and the dots see-through (6.2.1)', () => {
    const tikz = settingsOf(`show x from -1 to 5 and y from -1 to 3
python:
    import matplotlib.pyplot as plt
    plt.scatter([0, 2], [1, 1], s=900, alpha=0.4)
    plt.annotate('', xy=(2, 1), xytext=(0, 1), arrowprops=dict(arrowstyle='->'))`).generateTikzCode();
    const dots = tikz.indexOf('only marks');
    const arrow = tikz.indexOf('->', dots);
    assert.ok(dots > 0 && arrow > dots, tikz);
    assert.ok(/only marks[^\n]*opacity=0\.4/.test(tikz), tikz);
});
