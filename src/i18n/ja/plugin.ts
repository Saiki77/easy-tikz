/* 日本語: The plugin itself: commands, settings, notices, charts in notes (their problem line, sliders, width and alignment), the chart under a block being edited, the rewrite after changed chart words. */
import type { Messages } from '../types';
import type { plugin as en } from '../en/plugin';

export const plugin: Messages<typeof en> = {
    'plugin.settings.language.name': '表示言語',
    'plugin.settings.language.desc':
        'メニュー、ボタン、設定、メッセージ、ヘルプタブのガイドの言語です。「Obsidian に合わせる」では Obsidian に設定されている言語を使い、Easy Graphs Charts and TikZ がまだ対応していない言語は英語で表示します。数式とグラフ記法の言葉は変わりません。コマンド名は Obsidian の再起動後に切り替わります。',
    'plugin.settings.language.auto': 'Obsidian に合わせる（{language}）',

    // コマンド
    'plugin.command.openEditor': 'エディタを開く',
    'plugin.command.plotFormula': 'カーソル位置の数式をグラフにする',
    'plugin.command.saveSvgFiles': 'このノートのグラフを SVG ファイルとして保存',
    'plugin.notice.svgFilesSaved': '添付ファイルのフォルダに SVG ファイルを {count} 個保存しました。',
    'plugin.notice.svgFilesSame': 'このノートの SVG ファイルは最新です。',
    'plugin.notice.svgFilesFailed': 'SVG ファイルを保存できませんでした：{error}',
    'plugin.menu.plotFormula': 'この数式をグラフにする',
    'plugin.notice.noFormula': '$ で囲まれた数式の中にカーソルを置いてください。',
    'plugin.notice.formulaUnreadable': 'この数式はグラフにできません：{formula}',
    'plugin.formula.insert': 'グラフを挿入',
    'plugin.formula.open': 'エディタで開く',
    'plugin.formula.cannotDraw': 'このグラフは描けません。',
    'plugin.formula.dialogKind': '数式のグラフ（{kind}）',
    'plugin.formula.kind.function': '関数',
    'plugin.formula.kind.surface': '曲面',
    'plugin.formula.kind.polar': '極座標の曲線',
    'plugin.formula.kind.equation': '曲線',
    'plugin.formula.kind.region': '領域',
    'plugin.formula.saveDefault': '既定として保存',
    'plugin.formula.defaultSaved': '保存しました。数式のグラフはこの見た目になります。',
    'plugin.formula.saveDefault3D': '3D の既定として保存',
    'plugin.formula.defaultSaved3D': '保存しました。数式の 3D グラフはこの見た目になります。',
    'plugin.settings.formulaMarks.name': 'ノートの数式をハイライト',
    'plugin.settings.formulaMarks.desc': 'グラフにできる数式の下に点線を引き、ポインタを置くと色を付けます。オフにすると数式はいつもどおりの見た目で、グラフはそのまま開きます。',
    'plugin.settings.formulaRecognition.name': '数式の認識',
    'plugin.settings.formulaRecognition.desc':
        'どの数式でグラフを開き、どの種類にするかを決めます。スマート（デフォルト）：小さなネットワークが、数式とその前後の言葉、ノートの名前、ノートのほかの数式を読みます。統計のノートの 1/(m - 1) のような記号はグラフにせず、x(t) = x_0 e^{at} は曲線にします。ルール：バージョン 6.1 の判定で、描ける数式はすべてグラフにします。',
    'plugin.settings.formulaRecognition.smart': 'スマート',
    'plugin.settings.formulaRecognition.rules': 'ルール',
    'plugin.settings.formulaSliders.name': '数式のグラフのスライダー',
    'plugin.settings.formulaSliders.desc': '数式の横に開くグラフに、数式の文字（a、b、k）ごとのスライダーを付けます。',
    'plugin.settings.formulaDefault.name': '数式のグラフの既定',
    'plugin.settings.formulaDefault.descBuiltIn': '数式の 2D グラフの見た目です。軸、グリッド、数値、サイズ、線。「編集」でエディタを使って設定します。今は組み込みの見た目です。',
    'plugin.settings.formulaDefault.descOwn': '数式の 2D グラフの見た目です。軸、グリッド、数値、サイズ、線。今はあなたの見た目です。「リセット」で組み込みの見た目に戻ります。',
    'plugin.settings.formulaDefault3D.name': '数式の 3D グラフの既定',
    'plugin.settings.formulaDefault3D.descBuiltIn':
        '数式の 3D グラフ（z = x^2 + y^2 のような曲面）の見た目です。ボックス、高さによる色分け、メッシュ線、視点、軸、グリッド。「編集」で曲面を使ってエディタで設定します。それまでは上の既定と組み込みの 3D の見た目を使います。',
    'plugin.settings.formulaDefault3D.descOwn':
        '数式の 3D グラフ（z = x^2 + y^2 のような曲面）の見た目です。ボックス、高さによる色分け、メッシュ線、視点、軸、グリッド。今はあなたの見た目です。「リセット」で上の既定と組み込みの 3D の見た目に戻ります。',
    'plugin.settings.formulaDefault.edit': '編集',
    'plugin.settings.formulaDefault.reset': 'リセット',
    'plugin.settings.chartLanguage.name': 'グラフの記法',
    'plugin.settings.chartLanguage.desc':
        '新しいグラフの書き方です。言葉 + LaTeX 数式：1 行に 1 つのオブジェクトを言葉で書き、数式は $...$ に入れます（例：plot $f(x) = x^2$ in blue）。Full LaTeX：\\begin{chart} で始め、1 行に 1 つの LaTeX コマンドを書き（例：\\plot[blue]{f(x) = x^2}）、\\end{chart} で終えます。どちらの形もいつでも読み込め、編集したグラフは元の形のままです。',
    'plugin.settings.chartLanguage.words': '言葉 + LaTeX 数式',
    'plugin.settings.chartLanguage.full': 'Full LaTeX',
    'plugin.settings.formulaHover.name': '数式のグラフ',
    'plugin.settings.formulaHover.desc': 'ノートの $...$ の数式にポインターを置くと（スマートフォンではタップ）、そのグラフを表示します。文字ごとのスライダーと「グラフを挿入」「エディタで開く」が付きます。',
    'plugin.command.whatsNew': 'Easy Graphs Charts and TikZ 6 の新機能を表示',
    'plugin.command.copyAiGuide': 'AI チャット用のガイドをコピー（ChatGPT、Claude、Gemini）',

    // 設定
    'plugin.settings.format.name': '新しいグラフの形式',
    'plugin.settings.format.desc':
        'テキスト（デフォルト）：オブジェクトごとに 1 行、言葉で書きます（例：plot f(x) = x^2 in blue）。JSON：すべての設定を 1 つのオブジェクトにまとめます。編集するグラフは、そのブロックの形式のまま保存されます。',
    'plugin.settings.format.text': 'テキスト',
    'plugin.settings.colours.name': 'グラフの色',
    'plugin.settings.colours.desc':
        'テーマに合わせる（デフォルト）：Obsidian のテーマの色を使い、ライトモードとダークモードに合わせて変わります。LaTeX 出力と同じ：出力する図の固定の色を使うため、ノートと PDF の見た目がそろいます。',
    'plugin.settings.colours.theme': 'テーマに合わせる',
    'plugin.settings.colours.export': 'LaTeX 出力と同じ',
    'plugin.settings.look.name': 'グラフの見た目',
    'plugin.settings.look.desc':
        'すっきり（デフォルト）：矢印のない軸が原点を通り、薄いグリッド、小さな灰色の目盛りの数値で描きます。軸に名前を付けたグラフ以外は軸の文字 x と y を表示せず、曲線は少し太く、値はやわらかいラベルに表示します。ノートでも LaTeX 出力でも同じです。クラシック：バージョン 6.0 の見た目です。見た目を自分で指定したグラフはそのまま描きます（axes in a box、with a grid、no grid、grid opacity、軸の名前、線の太さ）。下の 4 つの設定で、どちらの見た目でも軸を 1 つずつ変えられます。1 つのグラフだけの指定は、エディタの「グラフ」タブでできます。',
    'plugin.settings.look.clean': 'すっきり',
    'plugin.settings.look.classic': 'クラシック',
    // 6.2.1：軸を 1 つずつ（見出し「グラフの見た目」の下のグループ）
    'plugin.settings.look.row': '見た目',
    'plugin.settings.axes.asTheLook': '見た目に合わせる',
    'plugin.settings.axisLines.name': '軸の線',
    'plugin.settings.axisLines.desc': '細い：すっきりと同じ薄い灰色の線です。太い：クラシックと同じ、濃く太い線です。見た目に合わせる（デフォルト）：選んだ見た目の線を使います。3D では箱の辺の線です。',
    'plugin.settings.axisLines.thin': '細い',
    'plugin.settings.axisLines.thick': '太い',
    'plugin.settings.axisArrows.name': '軸の矢印',
    'plugin.settings.axisArrows.desc': '原点を通る軸と端の軸の先に矢印を付けます（枠の軸には付けません）。見た目に合わせる（デフォルト）：すっきりでは矢印なし、クラシックでは矢印ありです。',
    'plugin.settings.axisArrows.on': '矢印あり',
    'plugin.settings.axisArrows.off': '矢印なし',
    'plugin.settings.axisNames.name': '軸の名前',
    'plugin.settings.axisNames.desc': '常に表示：グラフが軸に別の名前を付けていなければ、x と y（3D では z も）を表示します。グラフで名前を付けたときだけ：x と y は表示しません。見た目に合わせる（デフォルト）：すっきりではグラフが付けた名前だけ、クラシックでは常に表示します。',
    'plugin.settings.axisNames.always': '常に表示',
    'plugin.settings.axisNames.named': 'グラフで名前を付けたときだけ',
    'plugin.settings.axisNumbers.name': '軸の数値',
    'plugin.settings.axisNumbers.desc': '軸の目盛りの数値の大きさです。ノートでも LaTeX 出力でも同じです。見た目に合わせる（デフォルト）：すっきりでは小さく、クラシックでは大きく表示します。',
    'plugin.settings.axisNumbers.small': '小さい',
    'plugin.settings.axisNumbers.large': '大きい',
    'plugin.settings.imageBackground.name': 'コピーした画像',
    'plugin.settings.imageBackground.desc': '「PNG をコピー」と「SVG をコピー」の背景です。白ではライトテーマの色を使うので、ダークテーマからでも紙の上で読めます。',
    'plugin.settings.imageBackground.transparent': '透明（テーマの色）',
    'plugin.settings.imageBackground.white': '白',
    'plugin.settings.svgFiles.name': 'グラフを SVG ファイルにする',
    'plugin.settings.svgFiles.desc': 'すべてのグラフを添付ファイルのフォルダにも SVG ファイルとして保存します（Week 3 · chart 1.svg）。背景は白で、ノートが変わると更新されます。Obsidian Publish、GitHub などプラグインが動かない場所でも表示できます：![[Week 3 · chart 1.svg]] で埋め込みます。',
    'plugin.settings.liveChart.name': '編集中はブロックの下にグラフを表示',
    'plugin.settings.liveChart.desc':
        'デフォルトではオンです。ライブプレビューで編集中のブロックのすぐ下にグラフを表示し、入力に合わせてグラフが変わります。オフにすると、カーソルがブロックから離れたときにグラフを表示します。',
    'plugin.settings.words.heading': 'グラフの言葉',
    'plugin.settings.words.name': 'あなたの言葉',
    'plugin.settings.words.descEmpty':
        'グラフ記法の要素に、あなたの言葉を付けられます。使い慣れた言語の単語でも独自の用語でもかまいません（plot を graph や zeichne にするなど）。複数のオプションを 1 つのまとめ言葉にまとめることもできます。組み込みの言葉も引き続き使えます。',
    'plugin.settings.words.descPieces': 'グラフ記法の {pieces} 個の要素に、あなたの言葉を付けています。組み込みの言葉も引き続き使えます。',
    'plugin.settings.words.descPiecesBundles':
        '{pieces, plural, =0 {まとめ言葉を {bundles} 個作っています。} other {グラフ記法の # 個の要素にあなたの言葉を付け、まとめ言葉を {bundles} 個作っています。}}組み込みの言葉も引き続き使えます。',
    'plugin.settings.words.edit': '言葉を編集',
    'plugin.settings.wordsWrite.name': 'グラフを書くときの言葉',
    'plugin.settings.wordsWrite.desc':
        'あなたの言葉（デフォルト）：エディタと AI ツールは、あなたの言葉でグラフを書きます。組み込みの言葉：組み込みの言葉で書き、あなたの言葉は読み取りにだけ使います。',
    'plugin.settings.wordsWrite.yours': 'あなたの言葉',
    'plugin.settings.wordsWrite.builtin': '組み込みの言葉',
    'plugin.settings.animate.name': 'グラフの変化をアニメーション表示',
    'plugin.settings.animate.desc':
        'デフォルトではオンです。ノートのブロックが変わると、数値は新しい値へなめらかに移り、新しいオブジェクトはアニメーションで現れます。システムで動きを減らす設定にしているときは、グラフは動きません。',
    'plugin.settings.entrances.name': 'ステップの登場アニメーション',
    'plugin.settings.entrances.desc':
        'デフォルトではオンです。グラフのステップが進むと（「次のステップ」「ステップを再生」）、新しいオブジェクトはそれぞれの形で現れます。曲線は自分で描かれ、面積は左から広がり、点は弾むように現れ、矢印と接線は伸び、曲面は床から立ち上がります。オフにすると、ステップのオブジェクトはすぐに現れます。1 つのグラフだけ止めるには set entrances = off の行を書きます。システムで動きを減らす設定にしているときは、グラフは動きません。',
    'plugin.settings.invertDrag.name': '3D で上下のドラッグを反転',
    'plugin.settings.invertDrag.desc':
        'オフ（デフォルト）：下にドラッグするとシーンが上に傾き（カメラの仰角が上がります）、上にドラッグすると下に傾きます。トラックボールと同じ操作です。オン：下にドラッグするとカメラが下がり、上にドラッグすると上がります。カメラを直接動かす操作です。',
    'plugin.settings.samples3D.name': '3D の軸ごとの最大サンプル数',
    'plugin.settings.samples3D.desc':
        '3D の曲面カードにある「サンプル数」スライダーの上限です（デフォルト 80、最大 120）。出力する pgfplots のコードは、常に軸ごとに 60 サンプル以下です。それを超えると pdflatex のメモリが足りなくなるためです。変更後は Easy Graphs Charts and TikZ のエディタを開き直してください。',
    'plugin.settings.pan.name': '2D の移動の感度',
    'plugin.settings.pan.desc':
        'デフォルトは 1.0（直接操作）：マウスを N ピクセル動かすと、グラフもちょうど N ピクセル移動します。小さい値ではドラッグが抑えられ、込み入ったグラフを細かく操作できます（例：0.5 で半分ずつ移動）。大きい値では動きすぎます。移動の速さは現在の軸の範囲にも比例するため、ズームしてもこの倍率の効き方は変わりません。',
    'plugin.settings.tikzBlocks.name': '`tikz` ブロックも描画',
    'plugin.settings.tikzBlocks.desc':
        'デフォルトではオフです。オンにすると、```tikz のブロックも ```easy-tikz のブロックと同じように描画します。1 つのタグですべてを書きたいときに便利ですが、`obsidian-tikzjax` など ```tikz を使う他のプラグインと競合します。変更を反映するには Obsidian を再読み込みしてください。',
    'plugin.settings.whatsNew.name': 'アップデート後に新機能を表示',
    'plugin.settings.whatsNew.desc':
        'デフォルトではオンです。新しい機能が加わったアップデートの後に、変更点を短いポップアップで一度だけ表示します。コマンド「{command}」やエディタの「ヘルプ」タブから、いつでも開けます。',

    // 設定：AI 連携
    'plugin.settings.ai.heading': 'AI 連携',
    'plugin.settings.ai.server.name': 'AI アプリによるグラフ作成を許可',
    'plugin.settings.ai.server.desc':
        'デフォルトではオフです。このパソコンの中だけ（127.0.0.1）で動く小さなサーバーを起動します。Claude Code、Codex、Cursor、VS Code などの AI アプリは、このサーバーを通じてグラフのガイドを読み、グラフをチェックして見た目を確かめ、ノートに追加します。すべてのリクエストに下のトークンが必要で、Web ページからは使えません。行うのはノートへの Easy Graphs Charts and TikZ のグラフの追加と置き換えだけで、AI エージェント向けの指示が書かれたファイルは変更しません。変更のたびに通知が表示され、変更されたノートは「元に戻す」で戻せます。',
    'plugin.settings.ai.status.name': '状態',
    'plugin.settings.ai.status.running': '{mcp}（MCP）と {guide} で実行中です。',
    'plugin.settings.ai.status.notRunning': '実行されていません：{reason}',
    'plugin.settings.ai.status.starting': '実行されていません：起動中…',
    'plugin.settings.ai.restart': '再起動',
    'plugin.settings.ai.port.name': 'ポート',
    'plugin.settings.ai.port.desc': 'デフォルトは 27150 です。変更したら、AI アプリに設定したアドレスも更新してください。',
    'plugin.settings.ai.port.invalid': '1024 から 65535 までの整数を入力してください。',
    'plugin.settings.ai.token.name': 'トークン',
    'plugin.settings.ai.token.desc': '{token}：すべてのリクエストにこのトークンが必要です。外部に漏れたときは再発行して、AI アプリの設定を更新してください。',
    'plugin.settings.ai.token.descNone': 'トークンはサーバーの起動時に作られます。すべてのリクエストにこのトークンが必要です。外部に漏れたときは再発行して、AI アプリの設定を更新してください。',
    'plugin.settings.ai.token.copied': 'トークンをコピーしました。',
    'plugin.settings.ai.token.new': 'トークンを再発行',
    'plugin.settings.ai.connect.name': 'AI アプリを接続',
    'plugin.settings.ai.connect.desc': 'アプリを選び、必要な設定を一度だけコピーします。あとはアプリが自分でガイドを読み、グラフをチェックしてノートに追加します。',
    'plugin.settings.ai.connect.copied': '{app} 用にコピーしました。',
    'plugin.settings.ai.agents.name': 'この保管庫の AI エージェントに知らせる',
    'plugin.settings.ai.agents.desc':
        '保管庫の最上位にある AGENTS.md と CLAUDE.md に、Easy Graphs Charts and TikZ の短いセクションを追加します（ファイルがなければ作成します）。Claude Code、Codex、Cursor、Copilot などのエージェントはこれらのファイルを読み、サーバーがあってもなくても、ここでグラフを作る方法がわかるようになります。',
    'plugin.settings.ai.agents.done': 'Easy Graphs Charts and TikZ：{files} にグラフのセクションを追加しました。',
    'plugin.settings.ai.agents.and': '{list} と {name}',
    'plugin.settings.ai.agents.failed': 'エージェント用のファイルを書き込めませんでした：{error}',
    'plugin.settings.ai.guide.name': 'AI チャット用のガイドをコピー',
    'plugin.settings.ai.guide.desc':
        'ChatGPT、Claude、Gemini など、このパソコンに接続できないチャット向けです。ガイドをチャットに貼り付けて作りたいグラフを説明し、返ってきたブロックをノートに貼り付けます。',

    // AI サーバーと AI チャット用のガイド
    'plugin.ai.noServerHere': 'AI アプリはパソコンの Obsidian に接続します。スマートフォンとタブレットには AI サーバーがありません。',
    'plugin.ai.couldNotStart': 'Easy Graphs Charts and TikZ は AI サーバーを起動できませんでした：{error}',
    'plugin.ai.guideCopied': 'Easy Graphs Charts and TikZ：AI 用ガイドをクリップボードにコピーしました。AI チャットに貼り付けてから、作りたいグラフを説明してください。',
    'plugin.ai.guideCopyFailed': 'ガイドをコピーできませんでした：{error}',
    'plugin.copy.failed': 'コピーできませんでした：{error}',

    // 描画できないブロック
    'plugin.block.rawTikz':
        'これは Easy Graphs Charts and TikZ の JSON ブロックではなく、TikZ / pgfplots のコードのようです。表示するには obsidian-tikzjax などをインストールするか、Easy Graphs Charts and TikZ のエディタでグラフを作り直してください。',
    'plugin.block.renderError': 'Easy Graphs Charts and TikZ の描画エラー：{error}',
    'plugin.block.error': 'Easy Graphs Charts and TikZ：{error}',

    // ノートのグラフ
    'plugin.chart.label': 'Easy Graphs Charts and TikZ のグラフです。クリックすると編集できます。',
    'plugin.chart.textProblemAt': '{line} 行目、{column} 列目',
    'plugin.chart.previewFailed': 'プレビューに失敗しました：{error}',
    'plugin.chart.problems': '問題 {count} 件：{first}',
    'plugin.chart.sliders': 'グラフのスライダー',
    'plugin.chart.showMore': 'さらに {count} 件を表示',
    'plugin.chart.showLess': '折りたたむ',
    'plugin.chart.connect': '{name} を、ノートのほかのグラフにある同じ名前のスライダーと連動させる',
    'plugin.chart.resetSliders': 'スライダーを保存された値に戻す',
    'plugin.chart.alignLeft': '左揃え',
    'plugin.chart.alignCenter': '中央揃え',
    'plugin.chart.alignRight': '右揃え',
    'plugin.chart.width': 'グラフの幅',
    'plugin.display.notFound':
        'Easy Graphs Charts and TikZ はノートの中にこのグラフを見つけられなかったため、幅と配置を保存しませんでした（コールアウトの中にある、~~~ で囲まれている、または編集された可能性があります）。',
    'plugin.display.saveFailed': 'グラフの幅や配置を保存できませんでした：{error}',

    // 既定の値に戻った軸の範囲
    'plugin.range.notFinite': '有限の数ではありません',
    'plugin.range.notAboveMin': '{min} より大きくする必要があります',

    // グラフの言葉を変えた後の書き換え
    'plugin.reword.title': '新しい言葉でグラフを書き換えますか？',
    'plugin.reword.message':
        '{notes} 件のノートにある {charts} 件のグラフが、変更した言葉を使っているため、以前と同じようには読み取れなくなっています。新しい言葉で書き換えますか？各行の位置とコメントはそのまま残ります。グラフを書き換えるのは、書き換えた後もまったく同じグラフになる場合だけです。',
    'plugin.reword.confirm': 'グラフ {count} 件を書き換え',
    'plugin.reword.done': '新しい言葉でグラフ {count} 件を書き換えました。',
};
