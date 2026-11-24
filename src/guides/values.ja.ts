/*
 * The guides of src/guides/values.ts in Japanese (an overlay: see src/guides/ja.ts).
 * Code spans stay as they are, in the same order.
 */
import type { GuideText } from './ja';

export const VALUES_JA: Readonly<Record<string, GuideText>> = {
    'values-let': {
        title: 'ベクトル・行列・複素数',
        summary: 'ベクトル、行列、複素数に let で名前を付け、すべての行とラベルで使います。',
        outcomes: ['let で値に名前を付ける', '行列とベクトルを掛ける', 'ラベルに値を表示する', '値の中でスライダーを使う'],
        steps: [
            {
                title: 'let でベクトルに名前を付ける',
                body: '`let v = (2, 1)` でベクトルに名前が付き、グラフのどの行でも v を使えます。`draw v as an arrow, labelled` は、それを原点から矢印で描きます。',
            },
            {
                title: '行列に名前を付けて掛ける',
                body: '行列は LaTeX の `pmatrix` で書くか、`[[0, -1], [1, 0]]` のように普通に書きます。`A v` は積です。この A は v を 90 度回します。',
            },
            {
                title: 'ラベルに値を表示する',
                body: 'ラベルの波かっこは、どんな値も計算します。`{det(A)}` は行列式の 1、`{norm(v):2}` は v の長さを小数第 2 位まで表示します。',
            },
            {
                title: '値の中でスライダーを使う',
                body: '`let $c = 2e^{ia}$` は、長さが 2 で角度が `a` の複素数です。`a` をドラッグすると、c の矢印が原点のまわりを回ります。',
                tip: '名前には関数も入れられます：`let $f(x, y) = x^2 + 4y^2$`。',
            },
        ],
    },
    'sums-series': {
        title: '和：テイラー級数とフーリエ級数',
        summary: '上限がスライダーの和を書きます。テイラー多項式は正弦に寄り添い、回転する円が矩形波を描きます。',
        outcomes: ['上限がスライダーの和を書く', 'テイラー多項式をもとの関数と比べる', 'フーリエ級数を回転する円で描く'],
        steps: [
            {
                title: '式の中に和を書く',
                body: '`\\sum_{k=0}^{n}` は、k が 0 から n までの各項を足します。上限の n はスライダーです。この和は正弦のテイラー多項式です。',
            },
            {
                title: 'n を大きくする',
                body: '`n` を上にドラッグするか、再生ボタンを押します。項が 1 つ増えるたびに、赤い曲線は少し先まで正弦に沿います。',
            },
            {
                title: 'フーリエ級数を書く',
                body: '重みが小さくなっていく奇数次の正弦を足すと、矩形波になります。5 項では角がまだ波打ちます。`n` を大きくすると、角が鋭くなります。',
            },
            {
                title: '項を円に変える',
                body: '`draw the circles of` は、t の和の各項を、1 つ前の円の先で回る円にします。`with its wave` は先端の高さを描きます。同じ矩形波です。',
                tip: '円はノートとヘルプでは回り、PDF では止まった姿で描かれます。',
            },
        ],
    },
};
