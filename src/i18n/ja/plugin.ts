/* 日本語: The plugin itself: commands, settings, notices, charts in notes (their problem line, sliders, width and alignment), the chart under a block being edited, the rewrite after changed chart words. */
import type { Messages } from '../types';
import type { plugin as en } from '../en/plugin';

export const plugin: Messages<typeof en> = {
    'plugin.settings.language.name': '表示言語',
    'plugin.settings.language.desc':
        'メニュー、ボタン、設定、メッセージ、ヘルプタブのガイドの言語です。「Obsidian に合わせる」では Obsidian に設定されている言語を使い、Easy TikZ がまだ対応していない言語は英語で表示します。数式とグラフ記法の言葉は変わりません。コマンド名は Obsidian の再起動後に切り替わります。',
    'plugin.settings.language.auto': 'Obsidian に合わせる（{language}）',

    // コマンド
    'plugin.command.openEditor': 'エディタを開く',
    'plugin.command.whatsNew': 'バージョン 4 の新機能を表示',
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
    'plugin.settings.imageBackground.name': 'コピーした画像',
    'plugin.settings.imageBackground.desc': '「PNG をコピー」と「SVG をコピー」の背景です。白ではライトテーマの色を使うので、ダークテーマからでも紙の上で読めます。',
    'plugin.settings.imageBackground.transparent': '透明（テーマの色）',
    'plugin.settings.imageBackground.white': '白',
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
    'plugin.settings.invertDrag.name': '3D で上下のドラッグを反転',
    'plugin.settings.invertDrag.desc':
        'オフ（デフォルト）：下にドラッグするとシーンが上に傾き（カメラの仰角が上がります）、上にドラッグすると下に傾きます。トラックボールと同じ操作です。オン：下にドラッグするとカメラが下がり、上にドラッグすると上がります。カメラを直接動かす操作です。',
    'plugin.settings.samples3D.name': '3D の軸ごとの最大サンプル数',
    'plugin.settings.samples3D.desc':
        '3D の曲面カードにある「サンプル数」スライダーの上限です（デフォルト 80、最大 120）。出力する pgfplots のコードは、常に軸ごとに 60 サンプル以下です。それを超えると pdflatex のメモリが足りなくなるためです。変更後は Easy TikZ のエディタを開き直してください。',
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
        'デフォルトではオフです。このパソコンの中だけ（127.0.0.1）で動く小さなサーバーを起動します。Claude Code、Codex、Cursor、VS Code などの AI アプリは、このサーバーを通じてグラフのガイドを読み、グラフをチェックして見た目を確かめ、ノートに追加します。すべてのリクエストに下のトークンが必要で、Web ページからは使えません。行うのはノートへの Easy TikZ のグラフの追加と置き換えだけで、AI エージェント向けの指示が書かれたファイルは変更しません。変更のたびに通知が表示され、変更されたノートは「元に戻す」で戻せます。',
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
        '保管庫の最上位にある AGENTS.md と CLAUDE.md に、Easy TikZ の短いセクションを追加します（ファイルがなければ作成します）。Claude Code、Codex、Cursor、Copilot などのエージェントはこれらのファイルを読み、サーバーがあってもなくても、ここでグラフを作る方法がわかるようになります。',
    'plugin.settings.ai.agents.done': 'Easy TikZ：{files} にグラフのセクションを追加しました。',
    'plugin.settings.ai.agents.and': '{list} と {name}',
    'plugin.settings.ai.agents.failed': 'エージェント用のファイルを書き込めませんでした：{error}',
    'plugin.settings.ai.guide.name': 'AI チャット用のガイドをコピー',
    'plugin.settings.ai.guide.desc':
        'ChatGPT、Claude、Gemini など、このパソコンに接続できないチャット向けです。ガイドをチャットに貼り付けて作りたいグラフを説明し、返ってきたブロックをノートに貼り付けます。',

    // AI サーバーと AI チャット用のガイド
    'plugin.ai.noServerHere': 'AI アプリはパソコンの Obsidian に接続します。スマートフォンとタブレットには AI サーバーがありません。',
    'plugin.ai.couldNotStart': 'Easy TikZ は AI サーバーを起動できませんでした：{error}',
    'plugin.ai.guideCopied': 'Easy TikZ：AI 用ガイドをクリップボードにコピーしました。AI チャットに貼り付けてから、作りたいグラフを説明してください。',
    'plugin.ai.guideCopyFailed': 'ガイドをコピーできませんでした：{error}',
    'plugin.copy.failed': 'コピーできませんでした：{error}',

    // 描画できないブロック
    'plugin.block.rawTikz':
        'これは Easy TikZ の JSON ブロックではなく、TikZ / pgfplots のコードのようです。表示するには obsidian-tikzjax などをインストールするか、Easy TikZ のエディタでグラフを作り直してください。',
    'plugin.block.renderError': 'Easy TikZ の描画エラー：{error}',
    'plugin.block.error': 'Easy TikZ：{error}',

    // ノートのグラフ
    'plugin.chart.label': 'Easy TikZ のグラフです。クリックすると編集できます。',
    'plugin.chart.textProblemAt': '{line} 行目、{column} 列目',
    'plugin.chart.previewFailed': 'プレビューに失敗しました：{error}',
    'plugin.chart.problems': '問題 {count} 件：{first}',
    'plugin.chart.sliders': 'グラフのスライダー',
    'plugin.chart.showMore': 'さらに {count} 件を表示',
    'plugin.chart.showLess': '折りたたむ',
    'plugin.chart.resetSliders': 'スライダーを保存された値に戻す',
    'plugin.chart.alignLeft': '左揃え',
    'plugin.chart.alignCenter': '中央揃え',
    'plugin.chart.alignRight': '右揃え',
    'plugin.chart.width': 'グラフの幅',
    'plugin.display.notFound':
        'Easy TikZ はノートの中にこのグラフを見つけられなかったため、幅と配置を保存しませんでした（コールアウトの中にある、~~~ で囲まれている、または編集された可能性があります）。',
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
