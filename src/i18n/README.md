# Translations

Every text Easy TikZ shows has a key. `t(key, values)` (`src/i18n/index.ts`) returns it in the reader's
language: Obsidian's (`getLanguage()`, read in `main.ts`) unless the setting **Interface language** fixes
one. English (`src/i18n/en/`) is the source of every text and the fallback; each other language
(`src/i18n/ja/`) has the same keys, one file per part of the plugin. The guides of the Help tab have their
own overlay (`src/guides/ja.ts`). The compiler refuses a missing key, and `tests/i18n.test.ts` checks that
every translation keeps the named places of its English text.

## Moving a text into the catalogs

- **English stays exactly as it was.** `t(key)` in English returns, character for character, what the code
  showed before: the tests and the smoke test read English texts.
- **One key per whole sentence or label.** Never build a sentence from pieces: word order differs. A text
  with a value in it is one template with named places, `'Delete {name}'`, so a translation can put the
  value where its grammar wants it (`'{name} を削除'`).
- **Plurals:** `'{count, plural, one {# chart} other {# charts}}'`, `#` is the number (`=0 {...}` is allowed
  too). A language without plural forms writes one form, `'{count} 件のグラフ'`; it must still name `count`.
- **Values are never translated:** formulas, names (`f1`, `R1`, `c`), numbers, code, file names.
- **Texts made at import time are made in English**, before the language is set: a module-level constant
  such as `const NAMES = { solid: 'Solid' }` keeps keys (or becomes a function), and `t()` is called where
  the text is shown.
- **What stays English:** the chart language (`show`, `plot`, `shade`, `draw`, `mark`, `write`, `slider`, its
  options and colour words), formulas and function names, TikZ, pgfplots and LaTeX code, CSS classes and
  ids, keyboard keys (Shift, Cmd, Ctrl, Alt, Enter), the contents of example and guide charts (their titles,
  labels and legends are chart data), the AI guide (`docs/ai.md`), everything the AI server answers to AI
  apps (wrap it in `inEnglish`), and the pages on GitHub.
- **Everything a person reads is translated:** labels, buttons, menus, placeholders, tooltips, aria-labels,
  notices, dialogs, problem messages, status lines.
- **Keys:** `<part>.<area>.<name>`, the part being the catalog file (`editor`, `build`, `panels`, `plugin`,
  `problems`, `help`, and `common` for shared words such as Cancel, Save, Delete). Names in camelCase.

## Japanese style

- Sentences (descriptions, notices, help, problems) in です・ます. Buttons, labels and menu items as short
  noun phrases or verb stems: 「ノートに挿入」「条件を追加」「削除」, never 「〜してください」 on a button.
- Full-width punctuation in Japanese text: 、。（）「」：？！. Half-width for code, formulas, numbers and
  Latin words. One half-width space between Japanese and Latin words, code or a number (「SVG をコピー」
  「{name} を再生」「x + y <= 4 を満たす範囲」「問題 2 件」), none next to full-width punctuation.
- The colon after Japanese is full-width with no space: 「問題 1 件：C1 の方程式：…」.
- UI names quoted in a sentence take 「」: 「ノートに挿入」を押します. Names in problem messages too:
  「k」という名前はありません. In guide bodies, code stays in backticks.
- A menu item that opens a dialog ends in 「…」 where the English has "...".
- No em dash and no long dash (—, ―): use 、 or （）.

## Glossary

Use these words for these things everywhere, guides included, so a label in a guide matches the label on
screen. Add a term here before using a new one in several places.

| English | 日本語 |
| --- | --- |
| Easy TikZ, Obsidian, TikZ, pgfplots, LaTeX, SVG, PNG, JSON, MCP | (as they are) |
| note | ノート |
| vault | 保管庫 |
| Live Preview / Reading view / Source mode | ライブプレビュー / 閲覧ビュー / ソースモード |
| code block | コードブロック |
| callout | コールアウト |
| command palette | コマンドパレット |
| Settings / Community plugins | 設定 / コミュニティプラグイン |
| notice | 通知 |
| clipboard | クリップボード |
| editor | エディタ |
| chart | グラフ |
| preview | プレビュー |
| Build / Chart / Code / Help / AI (editor tabs) | 作成 / グラフ / コード / ヘルプ / AI |
| + Add (the button and its menu) | 追加 |
| Shapes and marks | 図形とマーク |
| Functions (section) | 関数 |
| Sliders (the dock) | スライダー |
| Add slider | スライダーを追加 |
| Insert into note | ノートに挿入 |
| Save changes | 変更を保存 |
| Copy SVG / Copy PNG / Copy TikZ | SVG をコピー / PNG をコピー / TikZ をコピー |
| Examples and templates | サンプルとテンプレート |
| example / template | サンプル / テンプレート |
| Start a chart | グラフを作成 |
| Open in editor | エディタで開く |
| Undo / Redo | 元に戻す / やり直す |
| drag / Shift-drag | ドラッグ / Shift+ドラッグ |
| hover tip | ヒント |
| pan / zoom | 移動 / ズーム |
| range (of an axis) | 範囲 |
| function | 関数 |
| formula, expression | 式 |
| equation | 方程式 |
| inequality | 不等式 |
| surface / plane | 曲面 / 平面 |
| curve | 曲線 |
| line (a geometric line) | 直線 |
| line (the stroke, its style) | 線 |
| line thickness | 線の太さ |
| segment / arrow / brace | 線分 / 矢印 / 波括弧 |
| polyline / polygon | 折れ線 / 多角形 |
| point | 点 |
| label / text label | ラベル / テキストラベル |
| region | 領域 |
| feasible region | 実行可能領域 |
| condition | 条件 |
| constraint / constraint line | 制約 / 制約線 |
| objective | 目的関数 |
| optimum / Find optimum | 最適解 / 最適解を求める |
| maximum / minimum | 最大値 / 最小値 |
| Max / Min (buttons) | 最大 / 最小 |
| corner (of a region) / Mark corners | 頂点 / 頂点を表示 |
| intersection | 交点 |
| integer points | 整数点 |
| tangent / tangent point | 接線 / 接点 |
| extrema | 極値 |
| domain | 定義域 |
| parametric curve | 媒介変数曲線 |
| Cartesian / Polar | 直交座標 / 極座標 |
| axis, axes | 軸 |
| axis label / axis variables | 軸ラベル / 軸の変数 |
| grid / major grid / minor grid | グリッド / 主グリッド / 補助グリッド |
| legend | 凡例 |
| title | タイトル |
| slider / step (of a slider) | スライダー / 刻み |
| play / pause | 再生 / 一時停止 |
| level curves / levels | 等高線 / 等高線の値 |
| fill / fill pattern / shading | 塗りつぶし / 塗りのパターン / 塗り方 |
| opacity | 不透明度 |
| outline | 輪郭 |
| solid (line) / dashed | 実線 / 破線 |
| solid (fill) | 単色 |
| colour | 色 |
| samples | サンプル数 |
| wireframe | ワイヤーフレーム |
| elevation / azimuth (3D view) | 仰角 / 方位角 |
| export / LaTeX export | 出力 / LaTeX 出力 |
| standalone document | 単体の文書 |
| problem (an error in a chart) | 問題 |
| name / reserved name | 名前 / 予約された名前 |
| value | 値 |
| chart language | グラフ記法 |
| chart words / your words / built-in words | グラフの言葉 / あなたの言葉 / 組み込みの言葉 |
| a word of your own for several options (bundle) | まとめ言葉 |
| AI access / AI apps | AI 連携 / AI アプリ |
| token / server | トークン / サーバー |
| guide / step (of a guide) | ガイド / ステップ |
| What's new | 新機能 |
| Getting started / Functions and sliders / Regions and optimisation | はじめに / 関数とスライダー / 領域と最適化 |
| Points, lines and labels / Notes and export / Reference | 点・線・ラベル / ノートと出力 / リファレンス |
| Start here / Core / Advanced (guide levels) | ここから / 基本 / 応用 |
| Colours by height (a surface's colour map) | 高さで色分け |
| Your colour (a surface's own colour, light to dark) | 指定した色 |
| Viridis / Heat / Cool / Diverging / Rainbow / Greyscale | Viridis / 暖色 / 寒色 / 発散型 / 虹色 / グレースケール |
| cube / proportional (the 3D box) | 立方体 / 比例 |
