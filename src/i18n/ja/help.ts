/* 日本語: The Help tab around the guides: search, categories, levels, buttons, and the reference. The guides themselves are in src/guides/ja.ts. */
import type { Messages } from '../types';
import type { help as en } from '../en/help';

export const help: Messages<typeof en> = {
    // ------------------------------------------------------------ home
    'help.search.label': 'ガイドとリファレンスを検索',
    'help.search.clear': '検索をクリア',
    'help.search.nothing': '「{query}」に一致するものはありません。「領域」「スライダー」「接線」のように、1 つの言葉で探してみてください。',
    'help.search.guides': 'ガイド {count} 件',
    'help.search.sections': 'リファレンスの項目 {count} 件',
    'help.search.both': 'ガイド {guides} 件、リファレンスの項目 {sections} 件',
    'help.whatsNew': 'Easy Graphs Charts and TikZ 6 の新機能',
    'help.categories': 'カテゴリ',
    'help.referenceSections': 'リファレンスの項目',
    'help.category.gettingStarted': 'はじめに',
    'help.category.functionsSliders': '関数とスライダー',
    'help.category.regionsOptimisation': '領域と最適化',
    'help.category.pointsLinesLabels': '点・線・ラベル',
    'help.category.threeD': '3D',
    'help.category.notesExport': 'ノートと出力',
    'help.category.reference': 'リファレンス',
    'help.category.chartLanguage': 'グラフの言語',
    'help.category.showcase': 'ショーケース',
    'help.category.calculus': '微分積分',
    'help.category.dataProbability': 'データと確率',
    'help.level.start': 'ここから',
    'help.level.core': '基本',
    'help.level.advanced': '応用',
    'help.card.minutes': '{minutes} 分',
    'help.card.step': 'ステップ {n}：{title}',

    // ------------------------------------------------- ホーム（5.1）：はじめに、言語、ギャラリー
    'help.home.start': 'はじめに',
    'help.home.gallery': 'ギャラリー',
    'help.home.all': 'すべて',
    'help.home.filter': 'カテゴリーでガイドを絞り込む',
    'help.home.language.label': 'グラフの言語',
    'help.home.language.title': 'グラフを言葉で書く',
    'help.home.language.text': 'グラフは数行の英語で書きます。数式はノートと同じく LaTeX で書きます。',
    'help.home.language.tour': 'ツアーを始める',
    'help.home.cheatSheet': '早見表',

    // --------------------------------------------- ガイドを 1 ステップずつ（5.1）
    'help.step.count': 'ステップ {n}/{total}',
    'help.step.back': '戻る',
    'help.step.next': '次へ',
    'help.step.nextGuide': '次：{title}',
    'help.step.finish': 'ガイド一覧に戻る',
    'help.step.words': 'グラフのテキスト',
    'help.step.new': '追加',
    'help.step.copyChart': 'グラフをコピー',
    'help.step.openEditor': 'エディタで開く',
    'help.step.keys': '矢印キーでステップを移動できます。',
    'help.step.sliders': 'このステップのスライダー',

    // ----------------------------------------------------------- a guide
    'help.bar.allGuides': 'すべてのガイド',
    'help.guide.steps': '{count} ステップ',
    'help.guide.readFirst': '先に読むガイド：{guides}',
    'help.guide.listJoin': '{before}、{after}',
    'help.guide.outcomes': 'このガイドでできるようになること',
    'help.guide.openFinished': '完成したグラフを開く',
    'help.guide.tip': 'ヒント：{tip}',
    'help.guide.figure': 'ステップ {n}（{title}）のあとのグラフ',
    'help.guide.openStep': 'このステップをエディタで開く',
    'help.guide.next': '次に読むガイド',
    'help.guide.github': 'スクリーンショット付きのこのガイド（GitHub、英語）',
    'help.copyFailed': 'クリップボードにコピーできませんでした。',

    // ------------------------------------------------------- the reference
    'help.reference.title': 'Easy Graphs Charts and TikZ リファレンス',
    'help.reference.intro': '式の書き方、領域・点・スライダーの作り方、LaTeX 出力の中身をまとめています。',
    'help.reference.contents': '目次',
    'help.example.open': 'サンプルを開く',

    // Quick start
    'help.ref.start.title': 'クイックスタート',
    'help.ref.start.about': '最初の式、「追加」、「ノートに挿入」。',
    'help.ref.start.p1':
        '「作成」タブに `2 + sin(x)` のような式を入力し、Enter キーを押します。それ以降は、入力するそばからプレビューが描き直されます。ほかのものはすべて「**追加**」から作ります：関数をさらに追加したり、塗りつぶした領域、直線と曲線、点、矢印、テキストラベル、スライダーを加えたりできます。',
    'help.ref.start.l1': 'グラフがまだ知らない名前（`k x^2` の `k`）には、欄の下に「**スライダー k を追加**」ボタンが表示されます。プレビューの下のスライダーをドラッグすると、図がそれに合わせて変わります。',
    'help.ref.start.l2': '「グラフ」には範囲、軸、グリッド、出力サイズがあり、「コード」には LaTeX が表示され、「ヘルプ」にはステップごとのガイドとこのリファレンスがあります。',
    'help.ref.start.l3': '「**ノートに挿入**」（{mod}+Enter）で、グラフが `easy-tikz` ブロックとして保存されます。ノートのグラフをクリックすると、もう一度編集できます。',
    'help.ref.start.l4': '「**TikZ をコピー**」は LaTeX のコードをクリップボードにコピーします（「LaTeX への出力」を参照）。',
    'help.ref.start.p2': 'ツールで何ができるかを知るいちばんの近道は、サンプルを開いて変えてみることです。この下のレシピにも例があります。',

    // Charts as text
    'help.ref.text.title': 'テキストで書くグラフ',
    'help.ref.text.about': 'ノートにグラフを書きます。1 行に 1 つのオブジェクトです。',
    'help.ref.text.p1':
        'グラフは、JSON オブジェクトの代わりに数行のテキストとしてノートに置けます。1 行に 1 つのオブジェクトを、普通の言葉で書きます。エディタが挿入するグラフはこの形で書かれ（設定「**新しいグラフの形式**」で JSON に切り替えられます）、編集したグラフはそのブロックの形式のままです。ライブプレビューでブロックを編集している間は、そのすぐ下にグラフが表示され、入力に合わせて変わります。値はなめらかに動き、新しいオブジェクトはすっと現れます。',
    'help.ref.text.c1': '表示する範囲',
    'help.ref.text.c2': 'ほかに in the middle、in a box、no axes',
    'help.ref.text.c3': 'スライダー',
    'help.ref.text.c4': '領域',
    'help.ref.text.c5': '直線',
    'help.ref.text.c6': '最適解',
    'help.ref.text.p2':
        'オプションは文のあとにカンマで区切って続けます：`in red`、`thin` または `thick`、`dashed`、`hidden`、`labelled "..."`、そしてオブジェクトに固有の言葉（`with its tangent at a and its extrema` など）です。行の先頭には名前とコロンを書けます（`R1:`）。書かなければ図形には順に R1、C1、P1、S1 と名前が付き、`the region` はグラフにただ 1 つある領域を指します。`#` または `%` で始まる行はコメントで、保存しても残ります。4.4 の短い書き方（`view x 0..5, y 0..4.5`、`f(x) = x^2 | blue`）も引き続き使えます。',
    'help.ref.text.sub1': '行の種類',
    'help.ref.text.t1': '関数です。名前は自由です：plot demand(x) = 20 - x。plot c(t) = (cos(t), sin(t)) は媒介変数曲線、plot r(theta) = ... は極座標の曲線、plot z = ... は曲面になります。',
    'help.ref.text.t2': '領域です。すべての条件を満たす部分を塗ります。shade between f and g from x = 0 to 2 や shade under f from x = 0 to b とも書けます。',
    'help.ref.text.t3': '方程式で表す曲線です。draw the level curves of x^2 + y^2 at 1 and 4 で等高線を描きます。',
    'help.ref.text.t4': '点です。mark where f and g cross、mark the corners of R1、mark the maximum of 2x + 3y in R1、mark the integer points in R1 とも書けます。',
    'help.ref.text.t5': 'draw a line from A to B、draw a polygon through A, B and C、draw a brace from A to B とも書けます。',
    'help.ref.text.t6': 'テキストラベルです。オプションで above、below、left、right を指定できます。',
    'help.ref.text.t7': 'グラフそのものです。ほかの項目は set field = value で設定します。',
    'help.ref.text.t8': 'LaTeX の数式。ノートと同じくドル記号で囲みます。ドル記号の中では並んだ文字は掛け算です：`$ax^2$` は a と x の 2 乗の積です。ドル記号なしの数式も使えます。その場合 `ax` は 1 つの名前です。',
    'help.ref.text.t9': 'ノートのほかのグラフにある同じ名前のスライダーと一緒に動くスライダー。',
    'help.ref.text.t10': 'グラフの上の Markdown の表の点。続けて：mark the data、draw its regression line, labelled。または：data (1, 2), (2, 3)。',
    'help.ref.text.t11': '分布（二項分布も：the binomial distribution with n = 10 and p = 0.4）。shade P(-1 <= X <= 1), labelled で確率に色を付けます。',
    'help.ref.text.t12': 'f の下の長方形とその和：左、右、中点、または台形公式。分割の数はスライダーにできます。',
    'help.ref.text.t13': '微分方程式の方向場。draw the solution through P で点を通る解を描きます。',
    'help.ref.text.note': '書き間違いは、ノートのグラフの下に行と列の位置とともに表示されます（例：「4 行目、9 列目：不明なオプション」）。AI 用ガイド（「AI」タブ）には、すべての行とオプションが載っています。',
    'help.ref.text.p3':
        'あなたの言葉：設定の「**グラフの言葉**」では、グラフ記法のどの部分にも、自分の言語や自分の用語で言葉を付けられます（plot を graph や zeichne にするなど）。複数のオプションを 1 語にまとめたまとめ言葉も作れます。組み込みの言葉も、あなたの言葉と並んでそのまま使えます。',
    'help.ref.text.sub2': 'Full LaTeX',
    'help.ref.text.full':
        '同じグラフを LaTeX でも書けます。`\\begin{chart}` で始め、1 行に 1 つのコマンドを書き（pgfplots と同じく、オプションは `[ ]` に、引数は `{ }` に入れます）、`\\end{chart}` で終えます。数式は `$` を付けない LaTeX 数式です。設定「**グラフの記法**」を Full LaTeX にすると、新しいグラフはこの形で書かれます。どちらの形もいつでも読み込め、編集したグラフは元の形のままです。',
    'help.ref.text.c7': '範囲、軸、グリッド、タイトル、サイズ',
    'help.ref.text.full2':
        'グラフの設定は `\\axis[...]` に pgfplots の名前（xmin、axis lines、grid、xtick、title、xlabel、width）で書きます。`\\slider`、`\\plot`、`\\shade`、`\\draw`、`\\mark`、`\\node` がオブジェクトを作り、オプションは言葉の記法と同じです（`red`、`dashed`、`label={...}`、`domain=0:4`、`tangent=a`）。AI 用ガイドにすべて載っています。',

    // Drag to edit
    'help.ref.drag.title': 'ドラッグで編集',
    'help.ref.drag.about': 'プレビューで図形を移動、回転、伸縮します。',
    'help.ref.drag.p1': 'プレビューで直線、曲線、点、ラベルをドラッグします。Easy Graphs Charts and TikZ がその式の数値を（スライダーを優先して）書き換え、つかんだ部分がポインタについてきます。',
    'help.ref.drag.l1': 'Shift+ドラッグでは、⊕ 印を中心に直線が回転し、曲線が伸縮します。点はまっすぐ（水平、垂直、斜め）に動きます。',
    'help.ref.drag.l2': 'まずポインタを重ねてみます。隅のヒントに、どの数値が変わるかと、ずらし・定数・係数を新たに加える必要があるかどうかが表示されます。',
    'help.ref.drag.l3': '計算された点（最適解、頂点、交点）はドラッグできません。それらを決めている直線をドラッグします。',
    'help.ref.drag.l4': 'Alt キー（macOS では Option キー）を押したままにすると、吸着せずに細かく動かせます。Esc キーでドラッグを取り消し、Cmd+Z（Ctrl+Z）で元に戻せます。スライダーを削除したり動かしたりしたあとも同じです。',
    'help.ref.drag.l5':
        'オブジェクトをクリックするとそのカードが見つかり、矢印キーで動かせます。オブジェクトの上で表示を移動するには、Space キーを押したままにするか、マウスの中ボタンを使います。ドラッグでの編集は、プレビューのツールバーにあるポインタのボタンでオフにできます。',

    // Writing expressions
    'help.ref.expressions.title': '式の書き方',
    'help.ref.expressions.about': '演算子、掛け算記号の省略、関数と定数。',
    'help.ref.expressions.p1': '式の入力欄、範囲、条件、点のリスト、ラベルのプレースホルダーは、すべて同じ書き方を使います。',
    'help.ref.expressions.sub1': '演算子',
    'help.ref.expressions.t1': '四則演算。',
    'help.ref.expressions.t2': 'べき乗（`**` も使えます）。右から結合します：`2^3^2` は `2^9` です。`-x^2` は `-(x^2)` で、`2^-x` も書けます。',
    'help.ref.expressions.t3': '余り（JavaScript と同じ）：`-1 % 3` は `-1` です。',
    'help.ref.expressions.t4': '比較。真なら 1、偽なら 0 です。`≤ ≥ ≠` も使えます。`0 <= x <= 4` のような連続した比較は、両方の比較が成り立つことを表します。',
    'help.ref.expressions.t5': '論理演算（`&&` と `||` も使えます）。',
    'help.ref.expressions.t6': 'c が成り立てば a、そうでなければ b。',
    'help.ref.expressions.sub2': '掛け算記号の省略',
    'help.ref.expressions.p2': '数、名前、括弧と、そのあとに続くものの間の `*` は省略できます：',
    'help.ref.expressions.p3': '落とし穴が 3 つあります：',
    'help.ref.expressions.l1': '`ax` は 1 つの名前で、`a*x` ではありません。`a x` または `a*x` と書きます。欄の下のエラーから「**a*x を使う**」で直せます。',
    'help.ref.expressions.l2': '`1/2x` は `(1/2)*x` で、`1/(2x)` ではありません。x を分母に入れたいときは括弧を書きます。',
    'help.ref.expressions.l3':
        '関数には括弧が必要です：`sin(x)` と書き、`sin x` とは書きません。`a(x + 1)` は、`a` がスライダーなら積です。`f1(x + 1)` は、`f1` が関数なら呼び出しです。べき乗は括弧にだけかかります：`a(x - h)^2` は `a*(x - h)^2` で、`2(x - h)^2` の場合と同じです。',
    'help.ref.expressions.sub3': '関数と定数',
    'help.ref.expressions.f1': '三角関数（ラジアン）。度で使うには `sin(x * pi / 180)`。',
    'help.ref.expressions.f2': '三角関数の逆数。',
    'help.ref.expressions.f3': '逆三角関数。',
    'help.ref.expressions.f4': '双曲線関数。',
    'help.ref.expressions.f5': '`ln` と `log` はどちらも自然対数です。',
    'help.ref.expressions.f6': '累乗根、絶対値、符号。',
    'help.ref.expressions.f7': '丸め。',
    'help.ref.expressions.f8': '`min` と `max` はいくつでも値を取れます。',
    'help.ref.expressions.f9': '定数（`PI` と `E` も引き続き使えます）。',
    'help.ref.expressions.sub4': '変数',
    'help.ref.expressions.p4':
        '関数は x を、曲面・条件・曲線の方程式は x と y を使います。媒介変数曲線は t を、極座標の曲線 r(θ) は `theta`（または `θ`）を使います。ほかの文字でモデルを書くには、「グラフ」>「軸」の「**軸の変数**」を `x1, x2` や `q, p` にします。x と y もそのまま使えます。',
    'help.ref.expressions.sub5': 'エラー',
    'help.ref.expressions.p5':
        '問題は少し間をおいてその欄の下に表示され、直せる場合は修正ボタンも付きます：「**スライダー k を追加**」「**a*x を使う**」「**sin を使う**」。プレビューのステータス表示にはすべての問題が並び、クリックするとその欄へ移動します。エラーのあるグラフでも、それ以外の部分は描かれます。',

    // Sliders
    'help.ref.sliders.title': 'スライダー',
    'help.ref.sliders.about': 'どの欄でも使える名前付きの数：作成、再生、名前の変更。',
    'help.ref.sliders.p1': 'スライダーは、どこでも使える名前付きの数です。式、定義域、条件、点のリスト、ラベル、軸の範囲で使えます。動かすとすぐに図が描き直されます。',
    'help.ref.sliders.l1': 'プレビューの下の「スライダー」欄にある「**スライダーを追加**」、「追加」>「スライダー」、または不明な名前に表示される修正ボタン「**スライダーを追加**」で作ります。',
    'help.ref.sliders.l2':
        '各行には名前、値、スライダーが並びます。値は自由に入力でき、範囲外の値を入力すると範囲が広がります。スライダーの両端の小さな数をクリックすると最小値と最大値を変えられます。「…」ボタンには刻みと削除もあります。',
    'help.ref.sliders.l3': '再生すると、値が最小値と最大値の間を行き来します（片道およそ 4 秒）。再生中にスライダーをドラッグすると手で操作でき、手を離した位置から再生が続きます。',
    'help.ref.sliders.l4': 'スライダーの名前は名前の欄で変えられます。それを使っているすべての式とラベルが更新されます。',
    'help.ref.sliders.l5': 'スライダーが 5 つ以上あると、欄には `a = 1.5` のような小さなボタンが並びます。クリックするとそのスライダーを編集できます。',
    'help.ref.sliders.p2':
        'ノートでは、グラフの下にスライダーが表示されます（「グラフ」>「ノートでの表示」>「ノートにスライダーを表示」）。そこで動かしても、図が変わるのはそのセッションの間だけで、ノートが書き換わることはありません。',

    // Functions
    'help.ref.functions.title': '関数',
    'help.ref.functions.about': '名前、定義域、媒介変数曲線と極座標の曲線、接線。',
    'help.ref.functions.p1': 'それぞれの関数のカードには名前（`f1`、`f2`、...）があります。名前をクリックすると変更でき、参照している箇所も更新されます。',
    'help.ref.functions.t1': 'ほかのどの式でも、名前で関数を呼び出せます。',
    'help.ref.functions.t2': '括弧のない名前は `f1(x)` を表します。',
    'help.ref.functions.t3': '領域の条件で関数を使います（「領域」を参照）。',
    'help.ref.functions.l1':
        '定義域：`min:max` の形で、たとえば `0:2pi` や `-a:a` と書きます。空欄は表示されている x の範囲（媒介変数曲線と極座標の曲線では `0:2*pi`）を表します。定義域の外では関数は値を持たないので、そこでその関数を使う式は何も描きません。',
    'help.ref.functions.l2': '種類：y = f(x)、または媒介変数曲線の x(t), y(t)（「オプション」の種類）。極座標のグラフ（ヘッダーのスイッチ）では、式は r(θ) です。',
    'help.ref.functions.l3': '非表示にした関数（目のボタン）は描かれませんが、名前で使うことはできます。媒介変数の関数は呼び出せません。',
    'help.ref.functions.l4': 'オプション：線の太さ、「破線」、「凡例」（自分のテキスト、または組版した式）、パターンと不透明度を選べる「x 軸まで塗りつぶし」、「極値」（極小と極大に印を付けます）。',
    'help.ref.functions.l5':
        '接線の位置：数、式、スライダー、または最初の極小・極大を表す `min` / `max`（2 つ目以降は `min2`、`max3`、...）。関数が変わると接線も追従します。',

    // Regions
    'help.ref.regions.title': '領域',
    'help.ref.regions.about': '条件、制約線、頂点、最適解。',
    'help.ref.regions.p1': '領域は、すべての条件を満たす点を塗りつぶします。1 行に 1 つの条件を書きます。すべての行が同時に成り立つ必要があります。',
    'help.ref.regions.c1': '半平面',
    'help.ref.regions.c2': '帯（連続した不等式）',
    'help.ref.regions.c3': '2 つの関数の間',
    'help.ref.regions.c4': 'f1 と x 軸の間',
    'help.ref.regions.c5': '円板',
    'help.ref.regions.c6': '2 つの部分',
    'help.ref.regions.l1': '1 つの行の中では、`,` `;` `and` `&&` も「かつ」を表します。`or`（または `||`）は「または」で選択肢を区切り、「かつ」は「または」より強く結び付きます。',
    'help.ref.regions.l2': '`<=` と `>=` を使います。等号のない `<` と `>` でも塗りつぶしは同じです。`=` 1 つだけはエラーになります。直線は曲線のカードで描きます。',
    'help.ref.regions.l3': '塗りつぶし：色、パターン、不透明度。輪郭：なし、実線、破線。',
    'help.ref.regions.l4':
        '「**制約線**」は、教科書の線形計画問題の図のように、各条件の境界線を表示範囲全体に引きます。行に `(1)` や `labour` のようなラベルを付けるとその線上に表示されます。「**番号を付ける**」で番号を付けることもできます。',
    'help.ref.regions.l5': '領域のラベル（テンプレート。「ラベルとテンプレート」を参照）は、領域の中央に置かれます。',
    'help.ref.regions.l6': '「**頂点を表示**」は領域の頂点に点を追加し、「**最適解を求める**」は領域上で目的関数を最大にする点を追加します。',
    'help.ref.regions.p2':
        '曲線の間に塗りつぶす部分が複数あるとき：部分ごとに 1 つの領域を、それぞれ別の色で追加します。たとえば `f2 <= y <= f1` と `f1 <= y <= f2` で、どちらにも `0 <= x <= 2pi` を付けます。',

    // Curves and lines
    'help.ref.curves.title': '曲線と直線',
    'help.ref.curves.about': 'x と y の方程式と等高線。',
    'help.ref.curves.p1': '曲線は x と y の方程式を描きます。等号のない式 F は F = 0 を表します。',
    'help.ref.curves.c1': '直線',
    'help.ref.curves.c2': '垂直な直線',
    'help.ref.curves.c3': '円',
    'help.ref.curves.c4': '双曲線',
    'help.ref.curves.c5': 'スライダー c で動く直線',
    'help.ref.curves.p2':
        '等高線の値：`2, 4, 8` のようなリストを書くと、値ごとに曲線 F = 値 が描かれます（等高線、無差別曲線、等利潤線）。値にはスライダーや `P1_val` のような計算された値も使えます。ラベルに `{level}` を入れると、各曲線にその値が表示されます。',

    // Points
    'help.ref.points.title': '点',
    'help.ref.points.about': 'リスト、交点、頂点、最適解、計算された値。',
    'help.ref.points.list': 'リスト',
    'help.ref.points.listText': '入力した点：`(1, 2); (3, a)`。',
    'help.ref.points.intersections': '交点',
    'help.ref.points.intersectionsText': '2 つの関数や曲線が交わる点。',
    'help.ref.points.region': '領域',
    'help.ref.points.regionText': '目的関数がなければ領域の頂点。あれば、領域内のどこかにある最良の点。',
    'help.ref.points.integers': '整数点',
    'help.ref.points.integersText': '領域の内部（領域を選ばなければ表示範囲全体）にある、座標が整数のすべての点（最大 2000 個）。',
    'help.ref.points.p1':
        '目的関数（省略可）：`2x + 3y` と「最大」または「最小」を指定すると、最良の点だけが残ります（同点ならすべて）。「領域」では頂点だけでなく領域全体を探すので、非線形の目的関数も使えます。目的関数が表示範囲内で非有界になるときや領域が空のときは、ステータス表示がそのことを知らせます。',
    'help.ref.points.p2':
        'ラベル：「なし」「座標」、またはプレースホルダー `{x}`、`{y}`、`{val}`（目的関数の値）、`{i}`（点の番号）を使える「カスタム」。点ごとのラベルは `;` で区切ります（`A; B; C` のように）。「垂線」は軸まで破線の補助線を引きます。',
    'help.ref.points.sub1': '計算された値',
    'help.ref.points.p3': '点のツールはすべて、結果を自分の名前で公開し、どの欄でもそれを使えます。スライダーを動かすと値もその場で更新されます。',
    'help.ref.points.t1': '最初の点の座標（3D では `P1_z` も）。',
    'help.ref.points.t2': '2 つ目の点。以下同様です。',
    'help.ref.points.t3': '最初の点での目的関数の値。',
    'help.ref.points.t4': '点の個数。',
    'help.ref.points.p4': 'たとえば、ラベル `z* = {P1_val}`、最適解を通る直線 `2x + 3y = P1_val`、`P1_y <= y` で区切った領域などです。',

    // Segments, arrows and braces
    'help.ref.segments.title': '線分、矢印、波括弧',
    'help.ref.segments.about': '線、矢印、閉じた多角形、波括弧。',
    'help.ref.segments.p1':
        '線分は、`;` で区切った点を結びます。たとえば `(0, 0); (3, 2)` です。座標には式も使え、点のツールの名前を書くとその点が入ります：`(0, 0); P1`。',
    'help.ref.segments.l1': 'スタイル：線、矢印（終点・始点・両端）、波括弧。',
    'help.ref.segments.l2': '「**閉じた形**」は最後の点を最初の点につなぎます（多角形の輪郭）。',
    'help.ref.segments.l3': '波括弧は最初の 2 点を使い、1 点目から 2 点目へ向かう向きの左側にふくらみます。2 点を入れ替えると反転します。',
    'help.ref.segments.l4': 'ラベル（テンプレート）は、パスの中ほどの脇に置かれます。',

    // Labels and templates
    'help.ref.labels.title': 'ラベルとテンプレート',
    'help.ref.labels.about': 'テキストラベルと、{a} のように値がその場で変わるテンプレート。',
    'help.ref.labels.p1':
        'テキストラベルは位置 `(x, y)` に置かれ、位置には式、スライダー、計算された値を使えます：`(P1_x, P1_y + 0.3)`。プレビューでラベルをドラッグすると移動できます。ただの数値は書き換わり、式で書いた位置にはずらす値が加わります（`P1_x + 0.4`）。',
    'help.ref.labels.p2': 'テキストを入れる欄はすべてテンプレートです：テキストラベル、領域・条件・曲線・点・線分のラベル、グラフのタイトル。',
    'help.ref.labels.t1': '式の値（小数点以下 3 桁まで）。',
    'help.ref.labels.t2': '小数点以下 1 桁まで（コロンのあとに任意の数）。',
    'help.ref.labels.t3': 'プレースホルダーではない波括弧（LaTeX のグループ）。',
    'help.ref.labels.t4': 'LaTeX の数式：プレビューで組版され、書いたとおりに LaTeX に渡されます。',
    'help.ref.labels.p3': '計算できないプレースホルダーは `?` と表示されます。',
    'help.ref.labels.l1': '数式の外では、`% & # _ ^ ~ < > | "` は入力したとおりに表示されます（`50% cut`、`x_1`、`x + y <= 4`）。',
    'help.ref.labels.l2':
        'バックスラッシュから LaTeX が始まります（`\\textbf{A}`、`\\%`、`\\$`、`\\alpha`）。コマンドの直後の波括弧はその引数で、それ以外の波括弧はプレースホルダーです。波括弧そのものを表示するには `\\{ \\}` と書きます。',
    'help.ref.labels.l3': '数式は `$...$` と書き、Obsidian と同じく、開きの `$` の直後と閉じる側の直前にはスペースを入れません。`$5 and $10` はテキストのままです。',
    'help.ref.labels.l4': '数式の中では、`^`、`_`、引数を取るコマンド（`\\frac`、`\\mathbf`）のあとの波括弧は LaTeX なので、`x^{...}` の中には値を入れられません。',

    // Optimisation recipes
    'help.ref.recipes.title': '最適化のレシピ',
    'help.ref.recipes.about': '線形計画問題、非線形の目的関数、余剰。',
    'help.ref.recipes.sub1': '線形計画問題',
    'help.ref.recipes.l1': '1 行に 1 つの制約を書いた領域 R1：`x + y <= 4`、`x + 3y <= 6`、`x >= 0`、`y >= 0`。「制約線」をオンにし、行に `(1)`、`(2)` とラベルを付けます。',
    'help.ref.recipes.l2': 'スライダー c と曲線 `2x + 3y = c`：目的関数の直線です。c を再生すると、直線が領域を横切って動きます。',
    'help.ref.recipes.l3': 'ソースを「領域」にして R1 を対象にし、目的関数を `2x + 3y`、「最大」とした点 P1：最適解です。目的関数なしで R1 を対象にした 2 つ目の点のツールは、すべての頂点に印を付けます。',
    'help.ref.recipes.l4': '`2x + 3y = P1_val` で直線を最適解に固定し、ラベル `z* = {P1_val}` で値を表示します。',
    'help.ref.recipes.l5': '感度分析：右辺をスライダーに置き換えて（`x + y <= b`）b を再生します。領域、頂点、最適解が追従します。',
    'help.ref.recipes.l6': '整数計画問題：ソースを「整数点」にして R1 を対象にし、同じ目的関数を指定すると、最良の整数点が求まります。',
    'help.ref.recipes.sub2': '非線形の目的関数',
    'help.ref.recipes.p1':
        '目的関数を等高線で描き（`x^2 + y^2`、等高線の値 `1, 3.2, 6`）、制約 `x + 2y >= 4` を塗りつぶし、その領域を対象にした点のツールで最小値を求めます。等高線の値を `P1_val` にした曲線が、最適解で制約に接する等高線です。',
    'help.ref.recipes.sub3': '余剰と均衡',
    'help.ref.recipes.p2':
        '需要と供給の交点が均衡点 P1 になります。`P1_y` と `0 <= x <= P1_x` で区切った領域が消費者余剰と生産者余剰を塗りつぶし、需要のスライダーを動かすと追従します。',

    // 3D
    'help.ref.threed.title': '3D',
    'help.ref.threed.about': '曲面、平面、点、ラベル、3D ビュー。',
    'help.ref.threed.p1': 'エディタのヘッダーで 3D に切り替えます。曲面は x と y の式で、それぞれに x と y の定義域、不透明度、サンプル数、ワイヤーフレームのオプションがあります。',
    'help.ref.threed.l1': '平面：x、y、z のいずれかが一定の値（スライダーも使えます）。',
    'help.ref.threed.l2': '点：`(x, y, z)` の組のリスト。線分と矢印も `(x, y, z)` の点を使います。',
    'help.ref.threed.l3': 'ラベルには z の位置もあります。',
    'help.ref.threed.l4': 'プレビューをドラッグすると回転します。「グラフ」>「3D ビュー」で仰角、方位角、ボックスの縦横比を設定します。',

    // Export to LaTeX
    'help.ref.export.title': 'LaTeX への出力',
    'help.ref.export.about': '「TikZ をコピー」と「コード」タブが出力するもの。',
    'help.ref.export.p1': '「TikZ をコピー」と「コード」タブは、pdflatex でコンパイルできる pgfplots のコードを出力します。',
    'help.ref.export.l1': '単体の文書（デフォルト）：`\\documentclass[border=5pt]{standalone}` と必要なパッケージをすべて含む完全なファイル。',
    'help.ref.export.l2':
        'スニペット：「コード」タブで「単体の文書」をオフにすると、tikzpicture だけになります。最初の行（`% Needs: ...`）に、プリアンブルで読み込むもの（`\\usepackage{pgfplots}` など）が書かれています。',
    'help.ref.export.l3': '関数は式として出力されます（`\\addplot`）。スライダーは現在の値に置き換えられ、名前で使った関数は展開され、三角関数はラジアンのままです。',
    'help.ref.export.l4': '領域、曲線、点、線分、波括弧はプラグインが計算し、座標として出力されます。プレビューと完全に一致しますが、LaTeX を編集しても計算し直されません。',
    'help.ref.export.l5': '色は `\\definecolor` で定義されるので、PDF の色はプレビューと一致します。「自動」（文字色）は黒で出力されます。',
    'help.ref.export.l6': '出力は、現在のスライダーの値でのスナップショットです。',
    'help.ref.export.note': '「コード」タブで手で加えた編集は、「再生成」を押すまでしか残りません。「ノートに挿入」が保存するのはグラフの設定で、そのテキストではありません。',

    // Keyboard shortcuts
    'help.ref.keys.title': 'キーボードショートカット',
    'help.ref.keys.about': 'すべてのキーボードショートカットと、プレビューでのマウス操作。',
    'help.ref.keys.insert': 'ノートに挿入（または変更を保存）',
    'help.ref.keys.escape':
        'プレビューでのドラッグを取り消す、または選択したオブジェクトの選択を解除する。開いているメニューやポップオーバーを閉じる。それ以外のときはエディタを閉じる。挿入せずに閉じたグラフは下書きとして残り、次回エディタが復元を提案します。',
    'help.ref.keys.undo': '直前のドラッグ、削除、スライダーの変更を元に戻す、またはやり直す（テキスト欄の外で。テキスト欄の中では入力を元に戻す）',
    'help.ref.keys.tabs': 'タブを切り替える（タブバーにフォーカスがあるとき）。Home と End で最初と最後のタブへ移動',
    'help.ref.keys.cards': 'フォーカスのあるカードを上下に移動',
    'help.ref.keys.number': '数値の欄：1 刻み（Shift：10 刻み、Alt：10 分の 1）',
    'help.ref.keys.arrowKeys': '矢印キー',
    'help.ref.keys.arrows':
        'フォーカスのあるスライダー：1 刻み。Home と End で両端へ移動。プレビューで選択したオブジェクト：グリッドの 1 目盛りの 10 分の 1 だけ移動（Shift：10 倍、Alt：10 分の 1）。Enter でその欄を開く',
    'help.ref.keys.enter': '入力した名前や数値を確定',
    'help.ref.keys.space': 'プレビューの上で押したままドラッグすると、直線や点の上でも表示を移動',
    'help.ref.keys.p1':
        '2D のプレビューでは、何もないところをドラッグすると移動、スクロールするとズームします。ロックのボタンでどちらもオフにできます。直線、曲線、点、ラベルをドラッグすると、その数値が変わります（「ドラッグで編集」を参照）。式で書いた範囲（`2a` など）は、移動しても変わりません。3D ではドラッグで回転します。',
};
