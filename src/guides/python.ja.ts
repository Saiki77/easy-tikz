/*
 * The guides of src/guides/python.ts in Japanese (an overlay: see src/guides/ja.ts).
 * Code spans stay as they are, in the same order.
 */
import type { GuideText } from './ja';

export const PYTHON_JA: Readonly<Record<string, GuideText>> = {
    'python-chart': {
        title: 'グラフの中の Python',
        summary: 'python ブロックに NumPy と matplotlib を書きます。決めた名前はグラフの値になり、スライダーはその変数になり、frame(t) は動きます。',
        outcomes: ['スクリプトで決めた名前を使う', 'スクリプトでスライダーを読む', 'matplotlib の呼び出しで描く', 'frame(t) でスクリプトを動かす'],
        steps: [
            {
                title: 'python ブロックを書く',
                body: '`python:` でスクリプトが始まり、その行は下に字下げして書きます。スクリプトで決めた名前はグラフの値になります。`plot f(x) = k * sin(x)` はスクリプトの `k` を使います。',
            },
            {
                title: 'スクリプトでスライダーを読む',
                body: 'グラフのスライダーはスクリプトの変数です。`a` をドラッグすると、新しい `a` でスクリプトがもう一度実行され、曲線がついてきます。',
            },
            {
                title: 'matplotlib で描く',
                body: '`plt.plot`、`plt.scatter`、`plt.fill_between`、`plt.legend` はグラフの中に、テーマの色で描きます。`C0` から `C9` や `red` などの名前は、プラグインの色になります。',
            },
            {
                title: 'グラフに関数を渡す',
                body: 'スクリプトで定義した数の関数は、グラフの関数になります。`plot h(x) = g(x)` はスクリプトの `g` を描きます。',
            },
            {
                title: 'frame(t) で動かす',
                body: '`def frame(t):` のあるスクリプトは動きます。グラフはその時計で、`t` を秒として呼び出します。印刷とエクスポートは `frame(0)` を描きます。',
                tip: 'スクリプトはプラグインの中で実行されるので、スマートフォンでも動きます。使えるのは numpy、math、cmath、random、matplotlib.pyplot です。ファイルは読まず、ネットワークにもつながりません。',
            },
        ],
    },
    'python-heart': {
        title: '回る円で描くハート',
        summary: 'Python のスクリプトでハートの FFT を取ります。係数の 1 つ 1 つが前の円の上で回る円になり、その先端がハートを描きます。',
        outcomes: ['Python で曲線から点を取る', '係数のリストの円を描く', 'スライダーで円を増やす'],
        steps: [
            {
                title: 'Python でハートから点を取る',
                body: 'スクリプトはハートの上の 256 点を複素数 x + iy で取ります。`mark the points of heart` でそれを描きます。スクリプトで決めた名前はグラフの値です。',
            },
            {
                title: 'フーリエ変換を取る',
                body: '`np.fft.fft(heart) / len(heart)` で 256 個の係数が得られます。`draw the circles of c` は、周波数 0、1、-1、2、-2 の順に、それぞれを回る円にします。',
            },
            {
                title: '先端の軌跡を描く',
                body: '`with its path` で先端の通る道を描きます。円が 12 個でも、もう丸いハートになります。',
            },
            {
                title: '120 個の円を使う',
                body: '`n` を大きくすると、円が 1 つ増えるごとに細かい回転が加わり、ハートの下のとがった先までたどれるようになります。',
                tip: '閉じた絵ならどれでも同じように描けます。その点を複素数として `heart` に入れてください。',
            },
        ],
    },
    'python-plot': {
        title: 'スライダー付きの matplotlib のプロット',
        summary: '線、凡例、塗りを matplotlib のとおりに書いてグラフに描きます。位相 a はスクリプトが読むスライダーです。',
        outcomes: ['NumPy 配列をプロットする', 'ループで曲線を描いて凡例を付ける', '条件が成り立つところを塗る'],
        steps: [
            {
                title: '1 本の曲線を描く',
                body: '`plt.plot(x, np.sin(x + a))` は配列を、色の順番の最初の色 `C0` の線で描きます。`a` をドラッグすると動きます。',
            },
            {
                title: 'ループで描く',
                body: '`plt.plot` のたびに次の色になります。ラベルは `$...$` の中の LaTeX で、`plt.legend()` がそれを並べます。',
            },
            {
                title: '和と塗りを加える',
                body: 'スクリプトは曲線を足し合わせます。`fill_between` に `where=total > 0` を付けると、和が 0 より上のところだけを塗ります。`plt.title` でタイトルを書きます。',
            },
        ],
    },
    'python-wave': {
        title: 'Python で動く 2 つの波',
        summary: 'frame(t) のあるスクリプトは、グラフの時計に合わせて描きます。2 つの波が逆向きに進み、その和がうなりになります。',
        outcomes: ['plt.plot で止まった絵を描く', 'frame(t) で動かす', '波を足してうなりにする'],
        steps: [
            {
                title: '止まった波を描く',
                body: 'スクリプトの一番上の `plt.plot` は 1 回だけ描きます。止まった正弦波です。',
            },
            {
                title: '動かす',
                body: '`def frame(t):` の中の呼び出しは時計に合わせて実行され、`t` は秒です。`np.sin(x - 2 * t)` は右へ進みます。帯の一時停止ボタンで止まります。',
            },
            {
                title: '2 つ目の波を加える',
                body: '少し短い波が逆向きに進み、その和を紫で描きます。山と山が重なるところでは和が 2 倍の高さになり、山と谷が重なるところでは平らになります。',
            },
        ],
    },
};
