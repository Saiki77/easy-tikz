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
};
