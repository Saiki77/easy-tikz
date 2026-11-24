/*
 * The examples of version 6 (6.0): one chart for each main new line that
 * no Showcase page shows already. The editor offers them after the
 * Showcase charts and the examples of src/migrate.ts (the empty Build tab,
 * the menu), and the AI tools list them (list_examples, get_example).
 *
 * Written in the chart language like the guides, with the title and the
 * line under it in English and Japanese (the reader's language, read when
 * shown; the AI tools read them in English). tests/guides.test.ts checks
 * that every chart loads, draws and exports without an issue. Pure.
 */
import { language } from '../i18n';
import type { ChartExample } from '../migrate';
import { chart } from './chart';
import { PYTHON_EXAMPLES } from './examplesPython'; // 6.0 P

interface ExampleText {
    title: string;
    description: string;
}

interface ExampleSource {
    id: string;
    en: ExampleText;
    ja: ExampleText;
    lines: string[];
}

const SOURCES: ExampleSource[] = [
    {
        id: 'vectors',
        en: { title: 'Vectors and a matrix', description: 'let names v, w and A; the arrows, v + w tip to tail and A v, with det A in a label.' },
        ja: { title: 'ベクトルと行列', description: 'let で v、w、A に名前を付け、矢印、つなげた v + w、A v を描き、ラベルに det A を表示します。' },
        lines: [
            'show x from -3 to 3 and y from -3 to 3',
            'equal scale',
            'let v = (2, 1)',
            'let w = (-1, 1.5)',
            'let A = [[0, -1], [1, 0]]',
            'draw v and w as arrows, labelled',
            'draw v + w tip to tail in red, labelled',
            'draw A v as an arrow in green, labelled',
            'write "det A = {det(A)}" at (1.5, -2)',
        ],
    },
    {
        id: 'taylor',
        en: { title: 'Taylor polynomial as a sum', description: 'A sum with the slider n as its bound: the Taylor polynomial of the sine, term by term.' },
        ja: { title: '和で書くテイラー多項式', description: '上限がスライダー n の和です。正弦のテイラー多項式が 1 項ずつ増えます。' },
        lines: [
            'show x from -7.5 to 7.5 and y from -3 to 3',
            'slider n from 0 to 12, starting at 4, in steps of 1',
            'plot $f(x) = \\sin x$ in gray, thick',
            'plot $T(x) = \\sum_{k=0}^{n} \\frac{(-1)^k x^{2k+1}}{(2k+1)!}$ in red, thick',
        ],
    },
    {
        id: 'roots-of-unity',
        en: { title: 'Roots of unity', description: 'The n-th roots of unity as points of a list of complex numbers, joined, with n on a slider.' },
        ja: { title: '1 の累乗根', description: '1 の n 乗根を複素数のリストの点として結んで描きます。n はスライダーです。' },
        lines: [
            'show x from -1.65 to 1.65 and y from -1.1 to 1.1',
            'equal scale',
            'slider n from 2 to 16, starting at 7, in steps of 1',
            'draw $x^2 + y^2 = 1$ in gray',
            'mark the points $\\{e^{2\\pi i k / n} : k = 0, \\dots, n - 1\\}$, joined, labelled',
        ],
    },
    {
        id: 'convex-set',
        en: { title: 'A set on the x-axis and a chord', description: 'Where g(x) ≤ 0, marked on the x-axis as [-2, 2], and a chord of g with a slider λ (Jensen).' },
        ja: { title: 'x 軸上の集合と弦', description: 'g(x) ≤ 0 となる場所を x 軸上に [-2, 2] と示し、スライダー λ つきの g の弦を引きます（イェンセン）。' },
        lines: [
            'show x from -4 to 4 and y from -5 to 7',
            'slider lambda from 0 to 1, starting at 0.3',
            'plot $g(x) = x^2 - 4$ in blue, thick',
            'mark where $g(x) \\le 0$ on the x-axis, labelled',
            'draw the chord of g from -1.5 to 3 at $\\lambda$, labelled',
        ],
    },
    {
        id: 'limit-cycle',
        en: { title: 'A system with a limit cycle', description: 'The van der Pol system: the solution from P winds out onto a closed loop. Drag P.' },
        ja: { title: 'リミットサイクルのある連立方程式', description: 'ファン・デル・ポール方程式です。P からの解は外へ回り、閉じた輪に乗ります。P をドラッグします。' },
        lines: [
            'show x from -3.5 to 3.5 and y from -3.5 to 3.5',
            'equal scale',
            'draw the vector field $F(x, y) = (y, (1 - x^2)y - x)$ in gray, thin',
            'mark P at (0.5, 0), large',
            'draw the solution of $\\dot{p} = (y, (1 - x^2)y - x)$ through P for t from 0 to 30, thick, coloured by time',
        ],
    },
    {
        id: 'complex-square',
        en: { title: 'z ↦ z² bends a grid', description: 'A small grid squared point by point in step 2: press Play and the lines bend into parabolas.' },
        ja: { title: 'z ↦ z² が格子を曲げる', description: '小さな格子の各点をステップ 2 で 2 乗します。再生すると、線が放物線に曲がります。' },
        lines: ['show x from -3 to 3 and y from -2 to 2', 'equal scale', 'draw the grid from -1.5 to 1.5 in steps of 0.25', 'then transform the plane by $z \\mapsto z^2$'],
    },
    {
        id: 'gradient-descent',
        en: { title: 'Gradient descent', description: 'Steps against the gradient of f from P, over a heat map of f; the slider eta is the step size.' },
        ja: { title: '勾配降下法', description: 'f のヒートマップの上で、P から勾配と逆向きに進みます。スライダー eta がステップ幅です。' },
        lines: [
            'show x from -3 to 3 and y from -2 to 2',
            'equal scale',
            'let $f(x, y) = \\frac{1}{2}x^2 + 4y^2$',
            'colour the plane by $f(x, y)$, in viridis, opacity 0.6',
            'draw the level curves of $f(x, y)$ at 0.25, 0.5, 1, 2, 4 and 8 in gray',
            'slider eta from 0.01 to 0.3, starting at 0.2',
            'mark P at (-2.6, 1.4), large',
            'draw the orbit of $p_{n+1} = p_n - \\eta \\nabla f(p_n)$, $p_0 = P$, 25 steps, labelled',
        ],
    },
    {
        id: 'cobweb',
        en: { title: 'Cobweb of the logistic map', description: 'x ↦ r x (1 - x) step by step from 0.2: it settles, swaps or never settles as r grows.' },
        ja: { title: 'ロジスティック写像のクモの巣図', description: '0.2 から x ↦ r x (1 - x) を 1 ステップずつたどります。r が大きくなると、落ち着く、行き来する、落ち着かない、と変わります。' },
        lines: [
            'show x from 0 to 1 and y from 0 to 1',
            'equal scale',
            'slider r from 2.5 to 4, starting at 3.7',
            'plot $f(x) = r x (1 - x)$ in blue, thick',
            'draw the cobweb of $x_{n+1} = f(x_n)$ from 0.2, 80 steps',
        ],
    },
    {
        id: 'bifurcation',
        en: { title: 'Bifurcation diagram', description: 'Where the logistic map settles for every r from 2.5 to 4: one value, two, four, then chaos.' },
        ja: { title: '分岐図', description: '2.5 から 4 までの各 r について、ロジスティック写像が落ち着く値です。1 つ、2 つ、4 つ、そしてカオスになります。' },
        lines: [
            'show x from 2.5 to 4 and y from 0 to 1',
            'xlabel r',
            'slider r from 2.5 to 4, starting at 3.5',
            'draw the bifurcation diagram of $x_{n+1} = r x_n (1 - x_n)$ for r from 2.5 to 4',
            'draw $x = r$ in red, dashed',
        ],
    },
    {
        id: 'newton',
        en: { title: "Newton's method", description: 'Tangents down to the x-axis from x = 2: five steps to the root of x³ - x - 1.' },
        ja: { title: 'ニュートン法', description: 'x = 2 から接線をたどって x 軸へ下ります。5 ステップで x³ - x - 1 の根に着きます。' },
        lines: ['show x from -1 to 2.5 and y from -2 to 6', 'axes in the middle', 'with a grid', 'plot $g(x) = x^3 - x - 1$ in blue, thick', "draw Newton's method for g from 2, 5 steps, labelled"],
    },
    {
        id: 'julia',
        en: { title: 'Julia set with sliders', description: 'Every point is a start z₀ of z² + c, with c = a + bi on two sliders.' },
        ja: { title: 'スライダーつきのジュリア集合', description: '各点を z² + c の出発点 z₀ とし、c = a + bi を 2 つのスライダーで動かします。' },
        lines: [
            'show x from -1.8 to 1.8 and y from -1.2 to 1.2',
            'equal scale',
            'slider a from -1 to 1, starting at -0.8',
            'slider b from -1 to 1, starting at 0.156',
            'colour the plane by $z_{n+1} = z_n^2 + c$, $z_0 = x + iy$, $c = a + bi$, 200 steps',
        ],
    },
    {
        id: 'newton-basins',
        en: { title: 'Newton basins', description: "Newton's method for z³ - 1 from every point: the colour is the root it reaches." },
        ja: { title: 'ニュートン法の吸引域', description: 'すべての点から z³ - 1 にニュートン法を使います。色は行き着く根を表します。' },
        lines: ['show x from -1.8 to 1.8 and y from -1.2 to 1.2', 'equal scale', 'colour the plane by $z_{n+1} = z_n - \\frac{z_n^3 - 1}{3z_n^2}$, $z_0 = x + iy$, 40 steps'],
    },
    // 6.0 G: GeoGebra commands
    {
        id: 'geogebra-construction',
        en: { title: 'A GeoGebra construction', description: 'GeoGebra input lines as they are: points, a triangle, its circumcircle, a median, a list from Sequence and a slider.' },
        ja: { title: 'GeoGebra の作図', description: 'GeoGebra の入力行をそのまま使います：点、三角形、外接円、中線、Sequence のリスト、スライダー。' },
        lines: [
            'show x from -1 to 7 and y from -2 to 5',
            'equal scale',
            'h = Slider(2, 5)',
            'A = (1, 1)',
            'B = (5, 1)',
            'C = (2.5, h)',
            'p = Polygon(A, B, C)',
            'c = Circle(A, B, C)',
            'M = Midpoint(A, B)',
            's = Segment(C, M), dashed',
            'L = Sequence((k, -1 + k^2 / 25), k, 0, 6)',
        ],
    },
    {
        id: 'geogebra-mandelbrot',
        en: { title: 'Mandelbrot set from GeoGebra', description: 'IterationList and KeepIf as in GeoGebra: the points c of a grid whose orbit stays near 0, and the orbit of one c.' },
        ja: { title: 'GeoGebra で書くマンデルブロ集合', description: 'GeoGebra と同じ IterationList と KeepIf です。格子の点 c のうち、軌道が 0 の近くに残る点と、1 つの c の軌道を描きます。' },
        lines: [
            'show x from -2.2 to 0.8 and y from -1.3 to 1.3',
            'equal scale',
            'P = Flatten(Sequence(Sequence(a + b ί, a, -2.2, 0.8, 0.03), b, -1.3, 1.3, 0.03)), hidden',
            'M = KeepIf(abs(Element(IterationList(z^2 + c, z, {0 + 0ί}, 20), 21)) <= 2, c, P)',
            'c = -0.12 + 0.75ί',
            'IterationList(z^2 + c, z, {0 + 0ί}, 30), in red',
        ],
    },
    // 6.0 P: Python in a chart
    ...PYTHON_EXAMPLES,
];

/** The examples of version 6, their texts in the reader's language. */
export const V6_EXAMPLES: ChartExample[] = SOURCES.map((source) => {
    const data = chart(...source.lines);
    return {
        id: source.id,
        get title() {
            return language() === 'ja' ? source.ja.title : source.en.title;
        },
        get description() {
            return language() === 'ja' ? source.ja.description : source.en.description;
        },
        is3D: data.dimension === true,
        data,
    };
});
