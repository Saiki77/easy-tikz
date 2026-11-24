/* 日本語: Linear algebra and complex maps (6.0 D): grids, basis vectors, transforms, eigenvectors, the unit square and spans. */
import type { Messages } from '../types';
import type { linear as en } from '../en/linear';

export const linear: Messages<typeof en> = {
    // ---- the kinds of cards
    'linear.kind.planeGrid': '格子',
    'linear.kind.basisVectors': '基本ベクトル',
    'linear.kind.transform': '変換',
    'linear.kind.eigenvectors': '固有ベクトル',
    'linear.kind.unitSquare': '単位正方形',
    'linear.kind.unitCube': '単位立方体',
    'linear.kind.span': '張る空間',

    // ---- kinds in messages of the chart text
    'linear.text.kindGrid': '格子',
    'linear.text.kindBasis': '基本ベクトル',
    'linear.text.kindTransform': '変換',
    'linear.text.kindEigenvectors': '固有ベクトル',
    'linear.text.kindUnitSquare': '単位正方形',
    'linear.text.kindSpan': '張る空間',
    'linear.text.gridTakes': '格子は次のように書きます: draw the grid from -2 to 2 in steps of 0.5 (または draw the grid)。',
    'linear.text.eigenTakes': '次のように書きます: draw the eigenvectors of A (A は行列)。',
    'linear.text.spanTakes': '次のように書きます: draw the span of v and w。',
    'linear.text.transformTakes': '次のように書きます: transform the plane by A (A は行列)、または by $z \\mapsto z^2$。',

    // ---- problems
    'linear.problem.noMap': '行列または写像を書いてください。例: A、z \\mapsto z^2。',
    'linear.problem.mapLeft': '\\mapsto の前には z または点 (x, y) を書きます。{left} はどちらでもありません。',
    'linear.problem.notMatrix': '変換には {n} x {n} の行列、または z \\mapsto z^2 のような写像が必要です。これは {what} です。',
    'linear.problem.notVector': '{text} はこのグラフのベクトルではありません。',
    'linear.problem.gridStep': '格子の間隔は 0 より大きくしてください。',
    'linear.problem.gridLines': '格子の線が {n} 本になります。間隔を広げるか、範囲を狭くしてください。',
    'linear.problem.everyVector': 'すべてのベクトルが固有ベクトルです (λ = {value})。',
    'linear.problem.complexEigen': '実の固有ベクトルはありません: λ = {re} ± {im}i。この行列はすべての直線を回します。',

    // ---- labels in the chart
    'linear.label.everyVector': 'すべてのベクトル:',
    'linear.label.noRealEigen': '実の固有ベクトルなし:',
    'linear.label.area': '面積',
    'linear.label.volume': '体積',

    // ---- + Add menu
    'linear.section': '線形代数',
    'linear.recipe.transform': '行列で平面を変換',
    'linear.recipe.transform3d': '行列で空間を変換',
    'linear.recipeHint.transform': 'î と ĵ と単位正方形のついた格子です。次のステップで A が動かします。',
    'linear.recipe.eigenvectors': '固有ベクトル',
    'linear.recipeHint.eigenvectors': '行列が向きを変えない 0 を通る直線と、その λ です。',
    'linear.recipe.gridBasis': '格子と基本ベクトル',
    'linear.recipeHint.gridBasis': '変換で動く格子の線と î、ĵ です。',
    'linear.recipe.complexMap': '複素写像 z ↦ f(z)',
    'linear.recipeHint.complexMap': '次のステップで z ↦ z² が曲げる小さな格子です。',

    // ---- cards
    'linear.card.from': '始め',
    'linear.card.to': '終わり',
    'linear.card.spacing': '間隔',
    'linear.card.auto': '表示範囲の外まで',
    'linear.card.gridSummary': '{from} から {to} までの格子、間隔 {spacing}',
    'linear.card.gridAuto': '表示範囲の外までの格子、間隔 {spacing}',
    'linear.card.labels': 'ラベル',
    'linear.card.basisSummary': 'î と ĵ',
    'linear.card.basisSummary3d': 'î、ĵ と k̂',
    'linear.card.map': '変換',
    'linear.card.mapPlaceholder': 'A、または z \\mapsto z^2',
    'linear.card.mapSummary': '上のものを {map} で動かします',
    'linear.card.mapEmpty': '行列がまだありません',
    'linear.card.mapHint': '上にあるすべてのもの (軸以外) を動かします。ステップの中では、ステップが始まるときに動きます。',
    'linear.card.matrix': '行列',
    'linear.card.matrixPlaceholder': 'A',
    'linear.card.eigenSummary': '{matrix} の固有ベクトル',
    'linear.card.image': '上の変換による像',
    'linear.card.squareSummary': '単位正方形',
    'linear.card.imageSummary': '単位正方形の像',
    'linear.card.vectors': 'ベクトル',
    'linear.card.vectorsPlaceholder': 'v; w',
    'linear.card.spanSummary': 'span({vectors})',
    'linear.card.empty': 'まだ設定されていません',

    // ---- Ask the curve
    'linear.ask.title.vector': '矢印 {name}',
    'linear.ask.title.transform': '変換 {name}',
    'linear.ask.group': '線形代数',
    'linear.ask.eigenvectors': '固有ベクトル',
    'linear.ask.unitSquare': '単位正方形の像と det',
    'linear.ask.span': '列ベクトルが張る空間',
    'linear.ask.inverse': '逆変換 (次のステップ)',
    'linear.ask.function': 'この変換で動く関数 (y = x²/4)',
    'linear.ask.vectorSpan': '{v} が張る空間',
    'linear.ask.vectorSpanWith': '{v} と {w} が張る空間',
    'linear.ask.vectorImage': '像 {m} {v} を矢印で',
    'linear.ask.vectorSum': '{v} + {w} を順につないで',
    'linear.ask.gridTransform': 'せん断で平面を変換 (次のステップ)',
    'linear.ask.basis': '基本ベクトル î と ĵ',

    // ---- hover cards
    'linear.hover.kind.matrix': '変換としての行列',
    'linear.hover.kind.product': '行列とベクトルの積',
    'linear.hover.kind.det': '行列式',
    'linear.hover.kind.eigen': '固有ベクトル',
    'linear.hover.note.t': 's を 0 から 1 に動かすと、格子が I から {name} へ動きます。',
    'linear.hover.note.example': 'このノートには {name} の定義がないので、例を使っています。',
    'linear.hover.note.fromNote': 'ノートで定義された {name} です。',

    // ---- drag
    'linear.drag.tip': '{name} の先端',
    'linear.drag.column': '{name} の第 {k} 列',
    'linear.drag.notNumbers': '{name} は数字で書かれていないので、ドラッグでは変えられません。',
    'linear.drag.moved': '{name} を {value} に変更しました',

    // ---- 6.0 F1: chart words, what each piece is (Settings, Chart words)
    'linear.words.what.transformThePlaneBy': '行：行列や写像で平面を動かす：transform the plane by A',
    'linear.words.what.transformSpaceBy': '行：行列で空間を動かす（3D）：transform space by B',
    'linear.words.what.theGrid': '変換で動く格子線：draw the grid',
    'linear.words.what.theBasisVectors': '基本ベクトル î と ĵ：draw the basis vectors',
    'linear.words.what.theEigenvectorsOf': '行列の固有ベクトル：draw the eigenvectors of A',
    'linear.words.what.theImageOf': '上にある変換で動かした単位正方形',
    'linear.words.what.theUnitSquare': '単位正方形：shade the unit square',
    'linear.words.what.theUnitCube': '単位立方体（3D）：shade the unit cube',
    'linear.words.what.theSpanOf': 'ベクトルの張る空間：draw the span of v and w',
};
