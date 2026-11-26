/* 日本語: Notes and interaction (6.0 B): sets on an axis, chords, Ask the curve, the new hover cards and charts from formulas. */
import type { Messages } from '../types';
import type { notes6 as en } from '../en/notes6';

export const notes6: Messages<typeof en> = {
    // ---- the kinds of cards
    'notes6.kind.axisSet': '軸上の集合',
    'notes6.kind.chord': '弦',

    // ---- + Add menu
    'notes6.recipe.axisSet': 'x 軸上の集合',
    'notes6.recipeHint.axisSet': '関数が 0 以下になる所を x 軸上の帯で示します。端の点と集合の記法のラベル付きです。',
    'notes6.recipe.chord': '弦（イェンセン）',
    'notes6.recipeHint.chord': '2 点の間の関数の弦と、λ での弦上とグラフ上の点を描きます。λ はスライダーです。',

    // ---- set on an axis card
    'notes6.axisSet.condition': '条件',
    'notes6.axisSet.conditionPlaceholder': 'g(x) <= 0',
    'notes6.axisSet.axis': '軸',
    'notes6.axisSet.xAxis': 'x 軸',
    'notes6.axisSet.yAxis': 'y 軸',
    'notes6.axisSet.valueLabel': '集合の記法',
    'notes6.axisSet.labelPlaceholder': '自分のラベル（例：g ≤ 0）',
    'notes6.axisSet.summary': '{condition} となる所（{axis}）',
    'notes6.axisSet.empty': 'x の条件を入力します',

    // ---- chord card
    'notes6.chord.function': '関数',
    'notes6.chord.from': '始点',
    'notes6.chord.to': '終点',
    'notes6.chord.at': 'λ の位置',
    'notes6.chord.atPlaceholder': '空欄：弦だけ',
    'notes6.chord.valueLabel': '値',
    'notes6.chord.labelPlaceholder': '自分のラベル（例：差 {gap:2}）',
    'notes6.chord.noFunction': '関数 y = f(x) が必要です。',
    'notes6.chord.chooseFunction': '関数を選びます',
    'notes6.chord.summary': '{function} の弦（{from} から {to}）',
    'notes6.chord.summaryAt': '{function} の弦（{from} から {to}、{at} の位置）',

    // ---- problems
    'notes6.problem.notInX': 'この条件は x 軸上で値を持ちません。x で書きます',
    'notes6.problem.notInY': 'この条件は y 軸上で値を持ちません。y で書きます',
    'notes6.problem.noValueAt': '{name} は x = {x} で値を持ちません',

    // ---- chart language
    'notes6.text.kindAxisSet': '軸上の集合',
    'notes6.text.kindChord': '弦',
    'notes6.text.axisSetTakes': '次のように書きます：mark where $g(x) \\le 0$ on the x-axis（または on the y-axis と y の条件）',
    'notes6.text.chordTakes': '次のように書きます：draw the chord of g from -1 to 3（または：... at $\\lambda$）',

    // ---- Ask the curve
    'notes6.ask.menu': '{name} への質問',
    'notes6.ask.hint': '質問を指すと答えが表示されます。選ぶとグラフに加わります。',
    'notes6.ask.none': 'これへの質問はまだありません',
    'notes6.ask.added': '追加：{question}',
    'notes6.ask.removed': '削除：{question}',
    'notes6.ask.group.axis': 'x 軸上',
    'notes6.ask.le': '{f} ≤ 0 となるのはどこ？',
    'notes6.ask.ge': '{f} ≥ 0 となるのはどこ？',
    'notes6.ask.lt': '{f} < 0 となるのはどこ？',
    'notes6.ask.gt': '{f} > 0 となるのはどこ？',
    'notes6.ask.zeros': '{f} が x 軸と交わるのはどこ？',
    'notes6.ask.group.shape': '形',
    'notes6.ask.extrema': '極大と極小',
    'notes6.ask.inflection': '{count, plural, other {変曲点}}',
    'notes6.ask.group.here': 'ここ（x = {x}）',
    'notes6.ask.tangent': 'ここでの接線',
    'notes6.ask.value': 'ここでの値（座標付き）',
    'notes6.ask.chord': 'ここからの弦（スライダー λ 付き）',
    'notes6.ask.group.area': '面積',
    'notes6.ask.area': 'x 軸との間の面積（{a} から {b}）',
    'notes6.ask.riemann': 'リーマン和（{a} から {b}）',
    'notes6.ask.group.with': '{g} と',
    'notes6.ask.cross': '{f} と {g} が交わるのはどこ？',
    'notes6.ask.below': '{f} ≤ {g} となるのはどこ？x 軸上に示します',
    'notes6.ask.between': '{f} と {g} の間の面積',
    'notes6.ask.group.region': '領域 {name}',
    'notes6.ask.corners': '頂点（座標付き）',
    'notes6.ask.outline': '境界を線で囲む',
    'notes6.ask.conditionLines': '条件の直線',
    'notes6.ask.highest': 'いちばん高い点',
    'notes6.ask.lowest': 'いちばん低い点',
    'notes6.ask.rightmost': 'いちばん右の点',
    'notes6.ask.leftmost': 'いちばん左の点',
    'notes6.ask.group.curve': '曲線 {name}',
    'notes6.ask.curveX': 'x 軸と交わるのはどこ？',
    'notes6.ask.curveY': 'y 軸と交わるのはどこ？',
    'notes6.ask.group.point': '点 {name}',
    'notes6.ask.dropLines': '軸への線',
    'notes6.ask.coordinates': '座標',
    'notes6.ask.liveLabel': 'このブロックのグラフです。曲線、領域、点をクリックすると質問が出ます。Enter キーでも開きます。',

    // ---- hover cards
    'notes6.hover.kind.set': '集合',
    'notes6.hover.kind.map': '写像',
    'notes6.hover.kind.condition': '条件',
    'notes6.hover.kind.interval': '区間',
    'notes6.hover.kind.jensen': '不等式（イェンセン）',
    'notes6.hover.kind.epigraph': 'エピグラフ',
    'notes6.hover.fromLine': '{formula}（このノートの定義）',
    'notes6.hover.exampleLine': '例 {formula}（このノートには {name} の定義がありません）',
    'notes6.hover.plane': 'n = 2 では {name}(x) を {name}(|x|) と読みます。x² は x₁² + x₂² です。',
    'notes6.hover.dimension': '次元 n',
    'notes6.hover.n1': 'n = 1',
    'notes6.hover.n2': 'n = 2',

    // ---- Chart tab
    'notes6.chart.fitY': 'このグラフのテキストには y の範囲がありません。y は描くものに合わせて決まります。y の範囲を入力するか、移動や拡大をすると固定されます。',

    // ---- 6.0 F1: chart words, what each piece is (Settings, Chart words)
    'notes6.words.what.onTheXAxis': 'x 軸上の集合：mark where g(x) <= 0 on the x-axis',
    'notes6.words.what.onTheYAxis': 'y 軸上の集合：mark where y > 1 on the y-axis',
    'notes6.words.what.theChordOf': '関数の弦：draw the chord of g from -1 to 3',
};
