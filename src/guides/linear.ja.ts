/*
 * The guides of src/guides/linear.ts in Japanese (an overlay: see src/guides/ja.ts).
 * Code spans stay as they are, in the same order.
 */
import type { GuideText } from './ja';

export const LINEAR_JA: Readonly<Record<string, GuideText>> = {
    'vectors-arrows': {
        title: 'ベクトルと矢印',
        summary: 'let でベクトルに名前を付けて矢印で描き、つなげて足し、スライダーで伸び縮みさせます。',
        outcomes: ['名前を付けたベクトルを矢印で描く', '2 つのベクトルをつなげて足す', 'ベクトルを伸び縮みさせ、張る空間を描く'],
        steps: [
            {
                title: '2 つのベクトルを矢印で描く',
                body: '`let v = (2, 1)` でベクトルに名前が付きます。`draw v and w as arrows` は両方を原点から描き、`labelled` で先端に名前が付きます。',
            },
            {
                title: 'つなげて足す',
                body: '`draw v + w tip to tail` は、w の矢印を v の先端に破線で置き、原点からその終点まで和の矢印を描きます。',
            },
            {
                title: '先端をドラッグしてベクトルを変える',
                body: 'エディタで v の先端をドラッグします。ドラッグに合わせて `let` の行の数値が変わり、和もついてきます。',
                tip: '普通の数値で書いたベクトルで使えます。Alt を押すと小数が 1 桁増えます。',
            },
            {
                title: 'スライダーでベクトルを伸び縮みさせる',
                body: '`s v` は v をスライダー `s` 倍したものです。`s` をドラッグすると、矢印は伸び縮みし、向きも反転しますが、`draw the span of v` の直線から離れません。',
            },
        ],
    },
    'matrix-plane': {
        title: '行列が平面を動かす',
        summary: '格子と基本ベクトルを描き、再生できるステップで行列に平面全体を動かさせます。',
        outcomes: ['格子、基本ベクトル、単位正方形を描く', 'ステップで平面を行列で動かす', '行列式と固有ベクトルを読む'],
        steps: [
            {
                title: '格子と基本ベクトルを描く',
                body: '`let` で行列に名前を付けます。`draw the grid` は変換で動く線を描き、`draw the basis vectors` は î を緑、ĵ を赤で描きます。',
            },
            {
                title: '単位正方形を塗る',
                body: '`shade the unit square, labelled` は、î と ĵ の間の正方形を塗り、その面積 1 を表示します。',
            },
            {
                title: '次のステップで平面を動かす',
                body: '`then transform the plane by A` は、それより上のすべてをステップ 2 で動かします。「再生」を押すと、î は A の 1 列目に、ĵ は 2 列目に移ります。正方形には新しい面積 det A = 2.5 が表示されます。',
                tip: 'エディタで ĵ の先端をドラッグすると、A の 2 列目が変わります。',
            },
            {
                title: '固有ベクトルを描く',
                body: '`then draw the eigenvectors of A` はステップ 3 を加えます。A が伸ばすだけの直線で、一方は λ₁ = 2.5 倍、もう一方は λ₂ = 1 倍です。',
            },
        ],
    },
    'complex-maps': {
        title: '複素数と写像',
        summary: '複素数を点で示し、z ↦ z² で格子を曲げ、複素関数で平面を色分けします。',
        outcomes: ['複素数のリストを点で示す', 'z の写像で平面を動かす', '色から零点と極を読む'],
        steps: [
            {
                title: '1 の累乗根を示す',
                body: '複素数 a + bi は点 (a, b) です。`mark the points` はリストを受け取ります。ここではスライダー `n` に対する 1 の n 乗根を、線で結んで示します。',
            },
            {
                title: '小さな格子を描く',
                body: '`draw the grid from -1.5 to 1.5 in steps of 0.25` は、写像で動く線を描きます。',
            },
            {
                title: 'すべての点を 2 乗する',
                body: '`then transform the plane by $z \\mapsto z^2$` は、ステップ 2 で格子のすべての点を 2 乗します。「再生」を押すと、まっすぐな線が放物線に曲がります。',
            },
            {
                title: 'f(z) で平面を色分けする',
                body: '`colour the plane by` に z の関数を書くと、各点は f(z) の色になります。色相が偏角、明るさが大きさです。零点 ±1 は暗く、極 ±i は白くなります。',
            },
        ],
    },
};
