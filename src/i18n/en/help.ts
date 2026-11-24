/* The Help tab around the guides: search, categories, levels, buttons, and the reference. The guides themselves are in src/guides/ja.ts. Owner: src/ui/helpPanel.ts, src/guides/index.ts. */
export const help = {
    // ------------------------------------------------------------ home
    'help.search.label': 'Search guides and reference',
    'help.search.clear': 'Clear search',
    'help.search.nothing': 'Nothing found for "{query}". Try a single word, such as region, slider or tangent.',
    'help.search.guides': '{count, plural, one {# guide} other {# guides}}',
    'help.search.sections': '{count, plural, one {# reference section} other {# reference sections}}',
    'help.search.both': '{guides, plural, one {# guide} other {# guides}}, {sections, plural, one {# reference section} other {# reference sections}}',
    'help.whatsNew': "What's new in Easy Graphs Charts and TikZ 5",
    'help.categories': 'Categories',
    'help.referenceSections': 'Reference sections',
    // Guide categories and levels (the data keeps the English names as identifiers: src/guides/index.ts).
    'help.category.gettingStarted': 'Getting started',
    'help.category.functionsSliders': 'Functions and sliders',
    'help.category.regionsOptimisation': 'Regions and optimisation',
    'help.category.pointsLinesLabels': 'Points, lines and labels',
    'help.category.threeD': '3D',
    'help.category.notesExport': 'Notes and export',
    'help.category.reference': 'Reference',
    'help.category.chartLanguage': 'Chart language',
    'help.category.showcase': 'Showcase',
    'help.category.calculus': 'Calculus',
    'help.category.dataProbability': 'Data and probability',
    // 6.0 F2
    'help.category.linearComplex': 'Linear algebra and complex numbers',
    'help.category.dynamicsFractals': 'Dynamics and fractals',
    'help.level.start': 'Start here',
    'help.level.core': 'Core',
    'help.level.advanced': 'Advanced',
    'help.card.minutes': '{minutes} min',
    /** A step of a guide: the line on a search result card, and the heading of the step (the part before {title} is read only by screen readers). */
    'help.card.step': 'Step {n}: {title}',

    // ------------------------------------------------- home (5.1): start, language, gallery
    'help.home.start': 'Start here',
    'help.home.gallery': 'Gallery',
    'help.home.all': 'All',
    'help.home.filter': 'Show the guides of a category',
    'help.home.language.label': 'The chart language',
    'help.home.language.title': 'Write a chart in words',
    'help.home.language.text': 'A chart is a few lines of English with your formulas in LaTeX, as in your notes.',
    'help.home.language.tour': 'Take the tour',
    'help.home.cheatSheet': 'Cheat sheet',

    // --------------------------------------------- a guide, one step at a time (5.1)
    'help.step.count': 'Step {n} of {total}',
    'help.step.back': 'Back',
    'help.step.next': 'Next',
    /** The last step's button when another guide follows ({title}: that guide). */
    'help.step.nextGuide': 'Next: {title}',
    'help.step.finish': 'Back to the guides',
    'help.step.words': 'The chart in words',
    /** The tag of a line this step added to the chart. */
    'help.step.new': 'new',
    'help.step.copyChart': 'Copy the chart',
    'help.step.openEditor': 'Open in the editor',
    'help.step.keys': 'The arrow keys move between steps.',
    'help.step.sliders': 'Sliders of this step',

    // ----------------------------------------------------------- a guide
    'help.bar.allGuides': 'All guides',
    'help.guide.steps': '{count} steps',
    /** {guides}: the links to the guides to read first. */
    'help.guide.readFirst': 'Read first: {guides}',
    /** What goes between two links of a list ({before} and {after} are the links). */
    'help.guide.listJoin': '{before}, {after}',
    'help.guide.outcomes': 'After this guide you can',
    'help.guide.openFinished': 'Open the finished chart',
    /** Before the text of a tip ({tip}), read only by screen readers. */
    'help.guide.tip': 'Tip: {tip}',
    'help.guide.figure': 'The chart after step {n}: {title}',
    'help.guide.openStep': 'Open this step in the editor',
    'help.guide.next': 'Next guides',
    'help.guide.github': 'This guide with screenshots on GitHub',
    'help.copyFailed': 'Could not copy to the clipboard.',

    // ------------------------------------------------------- the reference
    'help.reference.title': 'Easy Graphs Charts and TikZ reference',
    'help.reference.intro': 'How to write formulas, build regions, points and sliders, and what the LaTeX export contains.',
    'help.reference.contents': 'Contents',
    'help.example.open': 'Open example',
    // The examples the reference shows (src/migrate.ts EXAMPLES, by id).

    // Quick start
    'help.ref.start.title': 'Quick start',
    'help.ref.start.about': 'The first formula, + Add, and Insert into note.',
    'help.ref.start.p1':
        'Type a formula such as `2 + sin(x)` in the Build tab and press Enter. From then on the preview redraws as you type. Use **+ Add** for everything else: more functions, shaded regions, lines and curves, points, arrows, text labels and sliders.',
    'help.ref.start.l1': 'A name the chart does not know yet (`k` in `k x^2`) gets an **Add slider k** button under the field. Drag the slider under the preview and the picture follows.',
    'help.ref.start.l2': 'Chart holds ranges, axes, grid and export size; Code shows the LaTeX; Help has step-by-step guides and this reference.',
    /** {mod}: Cmd or Ctrl. */
    'help.ref.start.l3': '**Insert into note** ({mod}+Enter) saves the chart as an `easy-tikz` block. Click the chart in the note to edit it again.',
    'help.ref.start.l4': '**Copy TikZ** puts the LaTeX code on the clipboard (see Export to LaTeX).',
    'help.ref.start.p2': 'The quickest way to see what the tools can do is to open an example and change it. The recipes further down have more.',

    // Charts as text (the code lines are chart language and stay as they are; the comments beside them are translated)
    'help.ref.text.title': 'Charts as text',
    'help.ref.text.about': 'Write a chart in the note, one line per object.',
    'help.ref.text.p1':
        'A chart can live in the note as a few lines of text instead of a JSON object: one line per object, in plain words. Charts the editor inserts are written this way (the setting **Write new charts as** can switch to JSON), and a chart you edit keeps the form its block has. While you edit a block in Live Preview, its chart sits right under it and changes as you type: values glide, new objects pop in.',
    'help.ref.text.c1': 'the visible range',
    'help.ref.text.c2': 'or in the middle, in a box, no axes',
    'help.ref.text.c3': 'a slider',
    'help.ref.text.c4': 'a region',
    'help.ref.text.c5': 'a line',
    'help.ref.text.c6': 'the optimum',
    'help.ref.text.p2':
        'Options follow the statement after commas: `in red`, `thin` or `thick`, `dashed`, `hidden`, `labelled "..."`, and words that belong to the object, such as `with its tangent at a and its extrema`. A line can start with a name and a colon (`R1:`); otherwise shapes are named R1, C1, P1, S1 in order, and `the region` is the chart\'s only region. Lines starting with `#` or `%` are comments, and Save keeps them. The short forms of 4.4 (`view x 0..5, y 0..4.5`, `f(x) = x^2 | blue`) still work.',
    'help.ref.text.sub1': 'Lines',
    'help.ref.text.t1': 'A function. Any name: plot demand(x) = 20 - x. plot c(t) = (cos(t), sin(t)) is parametric, plot r(theta) = ... polar, plot z = ... a surface.',
    'help.ref.text.t2': 'A region: all conditions hold. Also shade between f and g from x = 0 to 2, and shade under f from x = 0 to b.',
    'help.ref.text.t3': 'A curve from an equation. draw the level curves of x^2 + y^2 at 1 and 4 draws level curves.',
    'help.ref.text.t4': 'Points. Also mark where f and g cross, mark the corners of R1, mark the maximum of 2x + 3y in R1, mark the integer points in R1.',
    'help.ref.text.t5': 'Also draw a line from A to B, draw a polygon through A, B and C, and draw a brace from A to B.',
    'help.ref.text.t6': 'A text label; above, below, left or right as an option.',
    'help.ref.text.t7': 'The chart itself. set field = value sets any other field.',
    'help.ref.text.t8': 'A formula in LaTeX, in dollars as in a note. Inside dollars letters side by side multiply: `$ax^2$` is a times x squared. Formulas without dollars work too; there `ax` is one name.',
    'help.ref.text.t9': 'A slider that moves with the sliders of the same name in the other charts of the note.',
    'help.ref.text.t10': 'The points of the Markdown table above the chart. Then: mark the data, draw its regression line, labelled. Or: data (1, 2), (2, 3).',
    'help.ref.text.t11': 'A distribution (also: the binomial distribution with n = 10 and p = 0.4). shade P(-1 <= X <= 1), labelled shades a probability.',
    'help.ref.text.t12': 'Rectangles under f with their sum: left, right or middle, or the trapezoid rule. The parts can be a slider.',
    'help.ref.text.t13': 'The slope field of a differential equation. draw the solution through P draws the solution through a point.',
    'help.ref.text.note': 'A typo shows under the chart in the note with its line and column, such as "Line 4, column 9: unknown option". The AI guide (AI tab) lists every line and option.',
    'help.ref.text.p3':
        'Your own words: in the settings, **Chart words** gives any piece of the language your own words, in your language or your own terms (plot can be graph, or zeichne), and one word of your own for several options. The built-in words keep working beside yours.',
    'help.ref.text.sub2': 'Full LaTeX',
    'help.ref.text.full':
        'The same chart can be written as LaTeX: `\\begin{chart}`, one command per line with its options in `[ ]` before its argument in `{ }` (as in pgfplots), and `\\end{chart}`. Formulas are LaTeX math without `$`. With the setting **Chart language** on Full LaTeX, new charts are written this way; both forms are always read, and a chart you edit keeps its form.',
    'help.ref.text.c7': 'ranges, axes, grid, title, size',
    'help.ref.text.full2':
        'Chart settings go in `\\axis[...]` with the names pgfplots gives them (xmin, axis lines, grid, xtick, title, xlabel, width). `\\slider`, `\\plot`, `\\shade`, `\\draw`, `\\mark` and `\\node` make the objects, with the options of the words (`red`, `dashed`, `label={...}`, `domain=0:4`, `tangent=a`). The AI guide lists them all.',

    // Drag to edit
    'help.ref.drag.title': 'Drag to edit',
    'help.ref.drag.about': 'Move, turn and stretch shapes in the preview.',
    'help.ref.drag.p1': 'Drag a line, curve, point or label in the preview. Easy Graphs Charts and TikZ changes the numbers in its formula (sliders first) so the part you grabbed follows the pointer.',
    'help.ref.drag.l1': 'Shift-drag turns straight lines and stretches curves around the ⊕ mark. Points move straight: horizontal, vertical or diagonal.',
    'help.ref.drag.l2': 'Hover first: the tip in the corner shows which numbers will change, and when a shift, an offset or a factor has to be added.',
    'help.ref.drag.l3': 'Computed points (optimum, corners, intersections) cannot be dragged. Drag the lines that define them.',
    'help.ref.drag.l4': 'Hold Alt (Option on macOS) for fine control without snapping. Esc cancels a drag; Cmd+Z (Ctrl+Z) undoes it, also after deleting or moving a slider.',
    'help.ref.drag.l5':
        'Click an object to find its card; arrow keys then move it. Hold Space or use the middle mouse button to pan over objects. Turn dragging off with the pointer button in the preview toolbar.',

    // Writing expressions
    'help.ref.expressions.title': 'Writing expressions',
    'help.ref.expressions.about': 'Operators, implicit multiplication, functions and constants.',
    'help.ref.expressions.p1': 'Every formula field, range, condition, point list and label placeholder uses the same language.',
    'help.ref.expressions.sub1': 'Operators',
    'help.ref.expressions.t1': 'Arithmetic.',
    'help.ref.expressions.t2': 'Power (`**` also works). It groups to the right: `2^3^2` is `2^9`. `-x^2` is `-(x^2)`, and `2^-x` is fine.',
    'help.ref.expressions.t3': 'Remainder, as in JavaScript: `-1 % 3` is `-1`.',
    'help.ref.expressions.t4': 'Comparisons, 1 when true and 0 when false. `≤ ≥ ≠` work too. A chain such as `0 <= x <= 4` means both comparisons hold.',
    'help.ref.expressions.t5': 'Logic (`&&` and `||` also work).',
    'help.ref.expressions.t6': 'a when c holds, otherwise b.',
    'help.ref.expressions.sub2': 'Implicit multiplication',
    'help.ref.expressions.p2': 'You can leave out `*` between a number, a name or a bracket and what follows:',
    'help.ref.expressions.p3': 'Three traps:',
    'help.ref.expressions.l1': '`ax` is one name, not `a*x`. Write `a x` or `a*x`. The error under the field offers **Use a*x**.',
    'help.ref.expressions.l2': '`1/2x` is `(1/2)*x`, not `1/(2x)`. Write the brackets when you mean a fraction with x below.',
    'help.ref.expressions.l3':
        'Functions need brackets: `sin(x)`, not `sin x`. `a(x + 1)` with a slider `a` is a product, `f1(x + 1)` with a function `f1` is a call. A power applies to the bracket only: `a(x - h)^2` is `a*(x - h)^2`, as `2(x - h)^2` is.',
    'help.ref.expressions.sub3': 'Functions and constants',
    'help.ref.expressions.f1': 'Trigonometry in radians. Degrees: `sin(x * pi / 180)`.',
    'help.ref.expressions.f2': 'Reciprocal trigonometry.',
    'help.ref.expressions.f3': 'Inverse trigonometry.',
    'help.ref.expressions.f4': 'Hyperbolic functions.',
    'help.ref.expressions.f5': '`ln` and `log` are both the natural logarithm.',
    'help.ref.expressions.f6': 'Roots, absolute value and sign.',
    'help.ref.expressions.f7': 'Rounding.',
    'help.ref.expressions.f8': '`min` and `max` take any number of values.',
    'help.ref.expressions.f9': 'Constants (`PI` and `E` still work).',
    'help.ref.expressions.sub4': 'Variables',
    'help.ref.expressions.p4':
        'Functions use x; surfaces, conditions and curve equations use x and y. Parametric curves use t; polar curves r(θ) use `theta` (or `θ`). To write models in other letters, set **Axis variables** in Chart > Axes to `x1, x2` or `q, p`; x and y keep working as well.',
    'help.ref.expressions.sub5': 'Errors',
    'help.ref.expressions.p5':
        'A problem appears under its field after a short pause, with a fix button when there is one: **Add slider k**, **Use a*x**, **Use sin**. The status chip on the preview lists every problem; click it to jump to the field. A chart with an error still draws everything else.',

    // Sliders
    'help.ref.sliders.title': 'Sliders',
    'help.ref.sliders.about': 'Named numbers for every field: create, play, rename.',
    'help.ref.sliders.p1': 'A slider is a named number you can use anywhere: in formulas, domains, conditions, point lists, labels and axis ranges. Moving it redraws the picture immediately.',
    'help.ref.sliders.l1': 'Create one with **Add slider** in the Sliders dock under the preview, with + Add > Slider, or with the **Add slider** fix on an unknown name.',
    'help.ref.sliders.l2':
        'Each row shows the name, the value and the slider. Type any value: a value outside the range widens the range. Click the small numbers at the slider ends to change the minimum and maximum; the more button also holds the step and Delete.',
    'help.ref.sliders.l3': 'Play sweeps the value back and forth between minimum and maximum (about 4 seconds each way). Drag the slider while it plays to take over; it continues from where you let go.',
    'help.ref.sliders.l4': 'Rename a slider in its name field: every formula and label that uses it is updated.',
    'help.ref.sliders.l5': 'With five or more sliders the dock shows compact pills such as `a = 1.5`; click a pill to edit that slider.',
    'help.ref.sliders.p2':
        'In your note, the chart shows its sliders underneath (Chart > In your note > Show sliders in note). Moving them there changes the picture for the current session only and never edits the note.',

    // Functions
    'help.ref.functions.title': 'Functions',
    'help.ref.functions.about': 'Names, domains, parametric and polar curves, tangents.',
    'help.ref.functions.p1': 'Each function has a name (`f1`, `f2`, ...) on its card. Click the name to rename it; references are updated.',
    'help.ref.functions.t1': 'Call a function by name in any other formula.',
    'help.ref.functions.t2': 'A bare name means `f1(x)`.',
    'help.ref.functions.t3': 'Use functions in region conditions (see Regions).',
    'help.ref.functions.l1':
        'Domain: `min:max`, for example `0:2pi` or `-a:a`. Empty means the visible x range (and `0:2*pi` for parametric and polar curves). Outside its domain a function has no value, so formulas that use it there draw nothing.',
    'help.ref.functions.l2': 'Types: y = f(x), or x(t), y(t) for a parametric curve (Options > type). In a polar chart (header switch) the formula is r(θ).',
    'help.ref.functions.l3': 'Hidden functions (eye button) are not drawn but can still be used by name. Parametric functions cannot be called.',
    'help.ref.functions.l4': 'Options: line thickness, Dashed, Legend (your own text, or the formula typeset), Fill to x-axis with pattern and opacity, Extrema (marks local minima and maxima).',
    'help.ref.functions.l5':
        'Tangent at: a number, a formula or a slider, or `min` / `max` for the first local minimum or maximum (`min2`, `max3`, ... for later ones). The tangent follows when the function changes.',

    // Regions
    'help.ref.regions.title': 'Regions',
    'help.ref.regions.about': 'Conditions, constraint lines, corners and the optimum.',
    'help.ref.regions.p1': 'A region shades the points where every condition holds. Write one condition per row; all rows must hold at once.',
    'help.ref.regions.c1': 'half-plane',
    'help.ref.regions.c2': 'a strip (a chain)',
    'help.ref.regions.c3': 'between two functions',
    'help.ref.regions.c4': 'between f1 and the x-axis',
    'help.ref.regions.c5': 'a disk',
    'help.ref.regions.c6': 'two pieces',
    'help.ref.regions.l1': 'Inside one row, `,` `;` `and` and `&&` also mean "and"; `or` (or `||`) separates alternatives, and "and" binds tighter than "or".',
    'help.ref.regions.l2': 'Use `<=` and `>=`; strict `<` and `>` shade the same. A single `=` is an error: draw lines with a Curve.',
    'help.ref.regions.l3': 'Fill: colour, pattern and opacity. Outline: none, solid or dashed.',
    'help.ref.regions.l4':
        '**Constraint lines** draws the boundary line of every condition across the whole view, as textbooks do for linear programs. Give a row a label such as `(1)` or `labour` to print it on its line, or use **Number them**.',
    'help.ref.regions.l5': 'The region label (a template, see Labels) sits at the centre of the region.',
    'help.ref.regions.l6': '**Mark corners** adds points at the corners of the region; **Find optimum** adds a point that maximises an objective over it.',
    'help.ref.regions.p2':
        'Several areas between curves: add one region per area, each with its own colour, for example `f2 <= y <= f1` and `f1 <= y <= f2`, both with `0 <= x <= 2pi`.',

    // Curves and lines
    'help.ref.curves.title': 'Curves and lines',
    'help.ref.curves.about': 'Equations in x and y, and level curves.',
    'help.ref.curves.p1': 'A curve draws an equation in x and y. A bare formula F means F = 0.',
    'help.ref.curves.c1': 'a straight line',
    'help.ref.curves.c2': 'a vertical line',
    'help.ref.curves.c3': 'a circle',
    'help.ref.curves.c4': 'a hyperbola',
    'help.ref.curves.c5': 'a line that moves with slider c',
    'help.ref.curves.p2':
        'Levels: write a list such as `2, 4, 8` and the curve F = value is drawn for each value (level curves, indifference curves, iso-profit lines). Levels may use sliders and computed values such as `P1_val`. Put `{level}` in the label to print each value at its curve.',

    // Points
    'help.ref.points.title': 'Points',
    'help.ref.points.about': 'Lists, intersections, corners, optimum, computed values.',
    // The sources of a points card: names on the card, shown as terms.
    'help.ref.points.list': 'List',
    'help.ref.points.listText': 'The points you type: `(1, 2); (3, a)`.',
    'help.ref.points.intersections': 'Intersections',
    'help.ref.points.intersectionsText': 'Where two functions or curves cross.',
    'help.ref.points.region': 'Region',
    'help.ref.points.regionText': 'Without an objective: the corner points of a region. With one: the best point anywhere in it.',
    'help.ref.points.integers': 'Integers',
    'help.ref.points.integersText': 'Every point with whole-number coordinates inside a region, or in the whole view when no region is chosen (at most 2000).',
    'help.ref.points.p1':
        'Objective (optional): with `2x + 3y` and Max or Min only the best point is kept (several if they tie). With Region the search covers the whole region, not just its corners, so nonlinear objectives work too. The status chip says when the objective is unbounded within the view or the region is empty.',
    'help.ref.points.p2':
        'Labels: None, Coordinates, or Custom with placeholders `{x}`, `{y}`, `{val}` (objective value) and `{i}` (point number). Separate per-point labels with `;`, as in `A; B; C`. Drop lines draws dashed guides to the axes.',
    'help.ref.points.sub1': 'Computed values',
    'help.ref.points.p3': 'Every points tool publishes its results under its name, and any field can use them. They update live when sliders move.',
    'help.ref.points.t1': 'Coordinates of the first point (`P1_z` in 3D).',
    'help.ref.points.t2': 'The second point, and so on.',
    'help.ref.points.t3': 'Objective value at the first point.',
    'help.ref.points.t4': 'Number of points.',
    'help.ref.points.p4': 'For example: a label `z* = {P1_val}`, a line `2x + 3y = P1_val` through the optimum, or a region bounded by `P1_y <= y`.',

    // Segments, arrows and braces
    'help.ref.segments.title': 'Segments, arrows and braces',
    'help.ref.segments.about': 'Lines, arrows, closed polygons and braces.',
    'help.ref.segments.p1':
        'A segment joins points separated by `;`, for example `(0, 0); (3, 2)`. Coordinates may be formulas, and the name of a points tool inserts its points: `(0, 0); P1`.',
    'help.ref.segments.l1': 'Style: line, arrow forward, backward or both, or brace.',
    'help.ref.segments.l2': '**Closed** joins the last point back to the first (a polygon outline).',
    'help.ref.segments.l3': 'A brace uses the first two points and bulges to the left of the direction from the first point to the second. Swap the points to flip it.',
    'help.ref.segments.l4': 'The label (a template) sits beside the middle of the path.',

    // Labels and templates
    'help.ref.labels.title': 'Labels and templates',
    'help.ref.labels.about': 'Text labels and templates such as {a} with live values.',
    'help.ref.labels.p1':
        'Text labels sit at a position `(x, y)` that may use formulas, sliders and computed values: `(P1_x, P1_y + 0.3)`. Drag a label in the preview to move it: plain numbers change, and a position written as a formula gets an offset (`P1_x + 0.4`).',
    'help.ref.labels.p2': 'Every text field is a template: text labels, region, condition, curve, point and segment labels, and the chart title.',
    'help.ref.labels.t1': 'The value of a formula, with up to 3 decimals.',
    'help.ref.labels.t2': 'With up to 1 decimal (any number after the colon).',
    'help.ref.labels.t3': 'A brace that is not a placeholder (a LaTeX group).',
    'help.ref.labels.t4': 'LaTeX math: typeset in the preview and passed to LaTeX as written.',
    'help.ref.labels.p3': 'A placeholder that cannot be computed shows `?`.',
    'help.ref.labels.l1': 'Outside math, `% & # _ ^ ~ < > | "` print as typed (`50% cut`, `x_1`, `x + y <= 4`).',
    'help.ref.labels.l2':
        'A backslash starts LaTeX (`\\textbf{A}`, `\\%`, `\\$`, `\\alpha`); a brace right after a command is its argument, other braces are placeholders. Write `\\{ \\}` for literal braces.',
    'help.ref.labels.l3': "Math is `$...$` with no space after the opening `$` or before the closing one, as in Obsidian; `$5 and $10` stays text.",
    'help.ref.labels.l4': 'Inside math a brace after `^`, `_` or an argument command (`\\frac`, `\\mathbf`) is LaTeX, so a value cannot go inside `x^{...}`.',

    // Optimisation recipes
    'help.ref.recipes.title': 'Optimisation recipes',
    'help.ref.recipes.about': 'Linear program, nonlinear objective, surplus.',
    'help.ref.recipes.sub1': 'Linear program',
    'help.ref.recipes.l1': 'Region R1 with one constraint per row: `x + y <= 4`, `x + 3y <= 6`, `x >= 0`, `y >= 0`. Turn on Constraint lines and label the rows `(1)`, `(2)`.',
    'help.ref.recipes.l2': 'Slider c and curve `2x + 3y = c`: the objective line. Press play on c to sweep it across the region.',
    'help.ref.recipes.l3': 'Points P1 with source Region over R1, objective `2x + 3y`, Max: the optimum. A second points tool over R1 without an objective marks every corner.',
    'help.ref.recipes.l4': 'Pin the line to the optimum with `2x + 3y = P1_val`, and print the value with a label `z* = {P1_val}`.',
    'help.ref.recipes.l5': 'Sensitivity: replace a right-hand side with a slider (`x + y <= b`) and play b. The region, the corners and the optimum follow.',
    'help.ref.recipes.l6': 'Integer program: source Integers over R1 with the same objective gives the best integer point.',
    'help.ref.recipes.sub2': 'Nonlinear objective',
    'help.ref.recipes.p1':
        'Draw the objective as level curves (`x^2 + y^2` with levels `1, 3.2, 6`), shade the constraint `x + 2y >= 4`, and find the minimum with a points tool over the region. A curve with levels `P1_val` is the level curve that touches the constraint at the optimum.',
    'help.ref.recipes.sub3': 'Surplus and equilibrium',
    'help.ref.recipes.p2':
        'Intersections of demand and supply give the equilibrium P1. Regions bounded by `P1_y` and `0 <= x <= P1_x` shade consumer and producer surplus, and they follow when a demand slider moves.',

    // 3D
    'help.ref.threed.title': '3D',
    'help.ref.threed.about': 'Surfaces, planes, points, labels and the 3D view.',
    'help.ref.threed.p1':
        'Switch to 3D in the editor header. Surfaces are formulas in x and y with their own x and y domains, opacity, sample count and a wireframe option.',
    'help.ref.threed.l1': 'Planes: x, y or z equal to a value (sliders allowed).',
    'help.ref.threed.l2': 'Points: a list of `(x, y, z)` tuples. Segments and arrows take `(x, y, z)` points too.',
    'help.ref.threed.l3': 'Labels take a z position.',
    'help.ref.threed.l4': 'Drag the preview to rotate. Chart > 3D view sets elevation, azimuth and the box aspect.',

    // Export to LaTeX
    'help.ref.export.title': 'Export to LaTeX',
    'help.ref.export.about': 'What Copy TikZ and the Code tab produce.',
    'help.ref.export.p1': 'Copy TikZ and the Code tab produce pgfplots code that compiles with pdflatex.',
    'help.ref.export.l1': 'Standalone document (default): a complete file with `\\documentclass[border=5pt]{standalone}` and every package it needs.',
    'help.ref.export.l2':
        'Snippet: turn off Standalone document in the Code tab to get only the tikzpicture. The first lines (`% Needs: ...`) list what your preamble must load, such as `\\usepackage{pgfplots}`.',
    'help.ref.export.l3':
        'Functions are exported as formulas (`\\addplot`), with sliders replaced by their current values, functions used by name written out, and trigonometry kept in radians.',
    'help.ref.export.l4':
        'Regions, curves, points, segments and braces are computed by the plugin and exported as coordinates. They match the preview exactly but do not recompute if you edit the LaTeX.',
    'help.ref.export.l5': 'Colours are defined with `\\definecolor` so the PDF matches the preview. "Auto" (the text colour) exports as black.',
    'help.ref.export.l6': 'The export is a snapshot at the current slider values.',
    'help.ref.export.note': 'Edits made by hand in the Code tab are kept only until you press Regenerate. Insert into note saves the chart settings, not that text.',

    // Keyboard shortcuts (the keys themselves stay as they are, apart from "Arrow keys")
    'help.ref.keys.title': 'Keyboard shortcuts',
    'help.ref.keys.about': 'Every keyboard shortcut, and the mouse in the preview.',
    'help.ref.keys.insert': 'Insert into note (or Save changes)',
    'help.ref.keys.escape':
        'Cancel a drag in the preview, or clear the selected object; close the open menu or popover; otherwise close the editor. A chart closed without inserting is kept as a draft, and the editor offers to restore it next time.',
    'help.ref.keys.undo': 'Undo or redo the last drag, delete or slider change (outside text fields, where they undo typing)',
    'help.ref.keys.tabs': 'Switch tabs (tab bar focused); Home and End jump to the first and last tab',
    'help.ref.keys.cards': 'Move the focused card up or down',
    'help.ref.keys.number': 'Number field: one step (Shift: ten steps, Alt: a tenth)',
    'help.ref.keys.arrowKeys': 'Arrow keys',
    'help.ref.keys.arrows':
        'Focused slider: one step; Home and End jump to its ends. Selected object in the preview: move it by a tenth of a grid step (Shift: ten times, Alt: a tenth); Enter opens its field',
    'help.ref.keys.enter': 'Apply a name or a number you typed',
    'help.ref.keys.space': 'Hold over the preview and drag to pan, even over lines and points',
    'help.ref.keys.p1':
        'In the 2D preview, drag empty space to pan and scroll to zoom; the lock button switches both off. Dragging lines, curves, points and labels changes their numbers (see Drag to edit). Ranges written as formulas (such as `2a`) are not changed by panning. In 3D, drag to rotate.',
} as const;
