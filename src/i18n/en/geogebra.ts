/* GeoGebra commands (6.0 G): GeoGebra's commands in every formula and its input lines as chart lines (A = (1, 2), c = Circle(A, 3), IterationList(...)): their problems, card and recipes. Owner: src/geogebra/. */
export const geogebra = {
    // ---- the kind of card
    'geogebra.kind.geogebra': 'GeoGebra line',

    // ---- + Add menu
    'geogebra.section': 'GeoGebra',
    'geogebra.recipe.point': 'Point (GeoGebra)',
    'geogebra.recipeHint.point': 'A point as GeoGebra writes it, A = (1, 2), usable by name in every formula.',
    'geogebra.recipe.triangle': 'Triangle and its circumcircle (GeoGebra)',
    'geogebra.recipeHint.triangle': 'Three points, Polygon(A, B, C) and Circle(A, B, C): a construction in GeoGebra commands.',

    // ---- card
    'geogebra.card.command': 'Command',
    'geogebra.card.commandPlaceholder': 'Circle(A, 3)',
    'geogebra.card.value': 'Value',
    'geogebra.card.listValue': 'a list of {count}',
    'geogebra.card.nameLabel': 'Name',
    'geogebra.card.empty': 'No command yet',

    // ---- problems of the commands
    'geogebra.problem.takes': '{name} is written {usage}',
    'geogebra.problem.variable': 'The variable of {name} is a name: {usage}',
    'geogebra.problem.notList': '{name} takes a list here, not {what}',
    'geogebra.problem.notPoint': '{name} takes points here, not {what}',
    'geogebra.problem.condition': 'The condition of {name} is a comparison, such as abs(z) <= 2',
    'geogebra.problem.function': '{name} takes a function: the name of one (f), or a formula in x',
    'geogebra.problem.object': '{name} draws an object: write it on a line of its own ({usage})',
    'geogebra.problem.needsPoint': '{name} takes a point here, not {text}',
    'geogebra.problem.needsNumber': '{text} is no number here',
    'geogebra.problem.empty': 'This line draws nothing: write a command or a value after =',
    'geogebra.problem.onALine': 'The three points lie on a line: no circle goes through them',
    'geogebra.problem.only2D': '{name} draws in 2D charts only',

    // ---- the lines
    'geogebra.text.kind': 'a GeoGebra line',
    'geogebra.text.sliderTakes': 'Slider takes numbers, the smaller first: a = Slider(0, 5) or a = Slider(0, 5, 0.1)',
};
