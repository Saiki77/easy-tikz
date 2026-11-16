/*
 * The guides of src/guides/data.ts in Japanese (an overlay: see src/guides/ja.ts).
 * Code spans stay as they are, in the same order.
 */
import type { GuideText } from './ja';

export const DATA_JA: Readonly<Record<string, GuideText>> = {
    'data-regression': {
        title: 'データと回帰直線',
        summary: 'データの点を描き、回帰直線を引いて、その式と R² を横に表示します。',
        outcomes: ['グラフにデータの点を書く', '回帰直線を引いてラベルを付ける', 'ノートの表からデータを読む'],
        steps: [
            {
                title: 'データの点を書く',
                body: '`data` に点を並べます：勉強時間とテストの点数です。`mark the data` でそれらを描きます。',
            },
            {
                title: '回帰直線を引く',
                body: '`its regression line` は、最小二乗法でデータにいちばんよく合う直線です。',
            },
            {
                title: '式と R² を表示する',
                body: '`labelled` で直線の式と R² を加えます。R² が 1 に近いほど、点は直線の近くにあります。',
            },
            {
                title: 'ノートの表を読む',
                body: 'ノートでは `use the table above` を `data` の行の代わりに書くと、グラフはその上にある Markdown の表を読みます。表に行を加えると、直線もついてきます。',
                tip: '`use the table above, columns hours and score` で、列の多い表から 2 つの列を選べます。',
            },
        ],
    },
    'probability': {
        title: '正規分布と二項分布の確率',
        summary: 'スライダーで正規分布の曲線の下に確率を塗り、二項分布の棒と正規分布の曲線を比べます。',
        outcomes: ['正規分布と二項分布を描く', 'スライダーで確率を塗る', '確率をラベルに表示する'],
        steps: [
            {
                title: '正規分布を描く',
                body: '平均と標準偏差は `with` のあとに書きます。この釣鐘型の曲線は、X の標準正規分布です。',
            },
            {
                title: '確率を塗る',
                body: '`shade` に `P(...)` で事象を書くとその面積が塗られ、`labelled` で確率が表示されます。`a` を 1、2、3 と動かすと、0.683、0.954、0.997 になります。',
            },
            {
                title: '二項分布に切り替える',
                body: '`n = 10` と `p = 0.5` では、各棒は 10 回の試行で k 回成功する確率です。事象は `5 - a` から `5 + a` までになります。',
            },
            {
                title: '棒に正規分布の曲線を重ねる',
                body: '平均と散らばりが同じ（5 と 1.58）正規分布の曲線は、棒の上端のほぼ上を通ります。',
                tip: '分布が 2 つあるときは、`shade` は自分の行より上にあるいちばん近い分布を使います。',
            },
        ],
    },
};
