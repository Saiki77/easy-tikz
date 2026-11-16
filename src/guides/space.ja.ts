/*
 * The guides of src/guides/space.ts in Japanese (an overlay: see src/guides/ja.ts).
 * Code spans stay as they are, in the same order.
 */
import type { GuideText } from './ja';

export const SPACE_JA: Readonly<Record<string, GuideText>> = {
    'surfaces-3d': {
        title: '3D の曲面、平面、点',
        summary: '高さで色分けした曲面を立方体の中に描き、視点を回し、スライダーで動く平面で切ります。',
        outcomes: ['高さで色分けした曲面を立方体の中に描く', '視点を回し、その角度を残す', '動く平面、印を付けた点、ラベルを加える'],
        steps: [
            {
                title: '立方体の中に曲面を描く',
                body: '`x` と `y` の式は曲面なので、グラフは 3D になります。`cube` は、x、y、z の範囲にかかわらず、ボックスを立方体にします。',
            },
            {
                title: '高さで色分けする',
                body: '`in viridis` は曲面を高さで色分けします。`heat`、`cool`、`diverging`、`rainbow`、`greyscale` も使えます。',
            },
            {
                title: '視点を回す',
                body: 'エディタでグラフをドラッグすると回転します。2 つの角度は行として残ります：`rotationX` は視点を傾け、`rotationZ` は z 軸のまわりに回します。',
                tip: '「グラフ」タブの「3D ビュー」にある「仰角」と「方位角」で、2 つの角度を正確に設定できます。',
            },
            {
                title: 'スライダーで動く平面で切る',
                body: '`draw the plane z = h` は高さ `h` に平らな平面を置きます。`h` を再生すると、平面が鞍形の曲面を通り抜けて上下に動きます。',
            },
            {
                title: '点を打ち、ラベルを付ける',
                body: '3D の点には 3 つの座標があります。ラベルにも高さがあり、`z = {h}` は平面の角に乗って一緒に動きます。',
            },
        ],
    },
};
