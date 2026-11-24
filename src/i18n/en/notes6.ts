/* Notes and interaction (6.0 B): sets on an axis, chords, Ask the curve, the new hover cards and charts from formulas. Owner: src/notes6/. */
export const notes6 = {
    // ---- the kinds of cards
    'notes6.kind.axisSet': 'Set on an axis',
    'notes6.kind.chord': 'Chord',

    // ---- + Add menu
    'notes6.recipe.axisSet': 'Set on the x-axis',
    'notes6.recipeHint.axisSet': 'Where a function is at most 0, as a bar on the x-axis with its ends and its label in set notation.',
    'notes6.recipe.chord': 'Chord (Jensen)',
    'notes6.recipeHint.chord': 'The chord of a function between two points, and the points at λ on the chord and on the graph, λ on a slider.',

    // ---- set on an axis card
    'notes6.axisSet.condition': 'Condition',
    'notes6.axisSet.conditionPlaceholder': 'g(x) <= 0',
    'notes6.axisSet.axis': 'Axis',
    'notes6.axisSet.xAxis': 'x-axis',
    'notes6.axisSet.yAxis': 'y-axis',
    'notes6.axisSet.valueLabel': 'Set notation',
    'notes6.axisSet.labelPlaceholder': 'own label, e.g. g ≤ 0',
    'notes6.axisSet.summary': 'Where {condition}, on the {axis}',
    'notes6.axisSet.empty': 'Type a condition in x',

    // ---- chord card
    'notes6.chord.function': 'Function',
    'notes6.chord.from': 'From',
    'notes6.chord.to': 'To',
    'notes6.chord.at': 'At λ',
    'notes6.chord.atPlaceholder': 'empty: the chord alone',
    'notes6.chord.valueLabel': 'Values',
    'notes6.chord.labelPlaceholder': 'own label, e.g. gap {gap:2}',
    'notes6.chord.noFunction': 'Needs a function y = f(x).',
    'notes6.chord.chooseFunction': 'Choose the function',
    'notes6.chord.summary': 'Chord of {function} from {from} to {to}',
    'notes6.chord.summaryAt': 'Chord of {function} from {from} to {to} at {at}',

    // ---- problems
    'notes6.problem.notInX': 'The condition has no value on the x-axis: write it in x',
    'notes6.problem.notInY': 'The condition has no value on the y-axis: write it in y',
    'notes6.problem.noValueAt': '{name} has no value at x = {x}',

    // ---- chart language
    'notes6.text.kindAxisSet': 'set on an axis',
    'notes6.text.kindChord': 'chord',
    'notes6.text.axisSetTakes': 'Write: mark where $g(x) \\le 0$ on the x-axis (or on the y-axis, with a condition in y)',
    'notes6.text.chordTakes': 'Write: draw the chord of g from -1 to 3 (or: ... at $\\lambda$)',
};
