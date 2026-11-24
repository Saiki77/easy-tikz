/*
 * The guide of src/guides/geogebra.ts in Japanese (an overlay: see
 * src/guides/ja.ts). Code spans stay as they are, in the same order.
 */
import type { GuideText } from './ja';

export const GEOGEBRA_JA: Readonly<Record<string, GuideText>> = {
    'geogebra-commands': {
        title: 'GeoGebra のコマンド',
        summary: 'GeoGebra の入力行をそのまま貼り付けます：点、円、多角形、Sequence のリスト、スライダー、軌道、マンデルブロ集合。',
        outcomes: ['GeoGebra の作図をグラフに貼り付ける', 'Sequence と KeepIf でリストを作る', 'IterationList で式を反復する'],
        steps: [
            {
                title: '点を貼り付ける',
                body: '点は GeoGebra と同じく `A = (1, 1)` と書きます。1 行が 1 つの図形で、GeoGebra の見た目で描かれます：自由な点は青で、名前が付きます。',
            },
            {
                title: 'コマンドで図形を描く',
                body: 'コマンドは点から図形を作ります：`Polygon`、3 点を通る `Circle`、`Segment` と `Midpoint`。`A` を変えると、すべてが付いてきます。',
                tip: 'グラフの言葉のオプションはカンマの後に書きます：`c = Circle(A, B, C), red, dashed`。',
            },
            {
                title: 'Sequence でリストを作る',
                body: '`Sequence((k, k^2 / 8), k, 0, 6)` は k = 0 から 6 までの点のリストです。リストは波括弧 `{1, 2, 3}` で書き、1 から数えます：`Element(L, 2)` は 2 番目の点です。',
            },
            {
                title: 'スライダーを追加する',
                body: '`a = Slider(1, 3)` は 1 から 3 までのスライダーです。どの式でも使えます。ここでは t が 0 から 2π までの x(t) と y(t) を描く `Curve` で使います。`a` をドラッグします。',
            },
            {
                title: '式を反復する',
                body: '`IterationList(z^2 + c, z, {0 + 0ί}, 30)` は 0 から始めて z² + c を 30 回当てはめます。0 の軌道が点で描かれます。`ί` と `i` はどちらも虚数単位です。',
            },
            {
                title: '残る点だけを取る',
                body: '`P` は複素数の格子で、使う先だけが見えるように `hidden` にします。`KeepIf` は 20 ステップ目がまだ 0 から 2 以内にある c だけを残します：マンデルブロ集合の点です。',
                tip: '色つきのくっきりした絵には `colour the plane by` を使います（ガイド「フラクタル」）。',
            },
        ],
    },
};
