/* 日本語: GeoGebra commands (6.0 G): GeoGebra のコマンドと入力行。 */
import type { Messages } from '../types';
import type { geogebra as en } from '../en/geogebra';

export const geogebra: Messages<typeof en> = {
    // ---- the kind of card
    'geogebra.kind.geogebra': 'GeoGebra の行',

    // ---- + Add menu
    'geogebra.section': 'GeoGebra',
    'geogebra.recipe.point': '点 (GeoGebra)',
    'geogebra.recipeHint.point': 'GeoGebra の書き方の点 A = (1, 2) です。どの式でも名前で使えます。',
    'geogebra.recipe.triangle': '三角形と外接円 (GeoGebra)',
    'geogebra.recipeHint.triangle': '3 つの点、Polygon(A, B, C) と Circle(A, B, C) です。GeoGebra のコマンドによる作図です。',

    // ---- card
    'geogebra.card.command': 'コマンド',
    'geogebra.card.commandPlaceholder': 'Circle(A, 3)',
    'geogebra.card.value': '値',
    'geogebra.card.listValue': '{count} 個のリスト',
    'geogebra.card.nameLabel': '名前',
    'geogebra.card.empty': 'コマンドがまだありません',

    // ---- problems of the commands
    'geogebra.problem.takes': '{name} の書き方: {usage}',
    'geogebra.problem.variable': '{name} の変数は名前で書きます: {usage}',
    'geogebra.problem.notList': '{name} はここでリストを取ります。{what} ではありません',
    'geogebra.problem.notPoint': '{name} はここで点を取ります。{what} ではありません',
    'geogebra.problem.condition': '{name} の条件は abs(z) <= 2 のような比較です',
    'geogebra.problem.function': '{name} は関数を取ります。関数の名前 (f) か、x の式です',
    'geogebra.problem.object': '{name} は図形を描きます。1 行に 1 つ書いてください ({usage})',
    'geogebra.problem.needsPoint': '{name} はここで点を取ります。{text} ではありません',
    'geogebra.problem.needsNumber': '{text} はここで数ではありません',
    'geogebra.problem.empty': 'この行は何も描きません。= の後にコマンドか値を書いてください',
    'geogebra.problem.onALine': '3 点が一直線上にあるので、通る円がありません',
    'geogebra.problem.only2D': '{name} は 2D のグラフでだけ描かれます',

    // ---- the lines
    'geogebra.text.kind': 'GeoGebra の行',
    'geogebra.text.sliderTakes': 'Slider は小さい方から数を取ります: a = Slider(0, 5) または a = Slider(0, 5, 0.1)',
};
