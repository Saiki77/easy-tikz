/* The editor's shell: header and tabs, the chart type and examples menus, the preview and its tools, undo and redo, copy, insert and save, drafts, templates; the drag tips and hover hints. Owner: src/modal.ts, src/ui/kit.ts, src/ui/host.ts, src/ui/dragLayer.ts, src/drag/. */
export const editor = {
    // The editor window and its header (src/modal.ts).
    'editor.shell.title': 'Easy TikZ editor',
    'editor.header.chartType': 'Chart type',
    'editor.header.coordinates': 'Coordinates',
    'editor.header.cartesian': 'Cartesian',
    'editor.header.polar': 'Polar',
    'editor.header.examplesAndTemplates': 'Examples and templates',
    'editor.menu.examples': 'Examples',
    'editor.menu.manageTemplates': 'Manage saved templates...',

    // Tabs.
    'editor.tabs.sections': 'Editor sections',
    'editor.tabs.build': 'Build',
    'editor.tabs.chart': 'Chart',
    'editor.tabs.code': 'Code',
    'editor.tabs.help': 'Help',
    'editor.tabs.ai': 'AI',
    /** Read after the tab's name by screen readers (the code puts a space before it). */
    'editor.tabs.hasProblems': '(has problems)',

    // The preview and its tool buttons.
    'editor.preview.label3d': 'Chart preview. Drag or use the arrow keys to rotate.',
    'editor.preview.label2d': 'Chart preview. Drag or use the arrow keys to pan, scroll to zoom, drag labels to move them.',
    'editor.preview.emptyTitle': 'Your chart appears here',
    'editor.preview.emptyHint3d': 'Drag to rotate',
    'editor.preview.emptyHint2d': 'Drag to pan, scroll to zoom',
    'editor.preview.fit': 'Fit ranges to the chart',
    'editor.preview.resetRanges': 'Reset ranges',
    'editor.preview.majorGrid': 'Major grid',
    'editor.preview.lockPanZoom': 'Lock pan and zoom',
    'editor.preview.unlockPanZoom': 'Unlock pan and zoom',
    /** {action}: the lock button's label above. */
    'editor.preview.bothRangesFixed': '{action} (both ranges use expressions, so they stay fixed)',
    /** {action}: the lock button's label above; {axis}: x or y. */
    'editor.preview.rangeFixed': '{action} (the {axis} range uses an expression, so it stays fixed)',
    'editor.preview.zoomIn': 'Zoom in',
    'editor.preview.zoomOut': 'Zoom out',
    'editor.preview.resetZoom': 'Reset zoom',

    // The status chip in the preview.
    'editor.status.previewFailed': 'Preview failed: {error}',
    /** After the first problem: how many more there are. */
    'editor.status.more': '+{count} more',
    'editor.status.cannotFit': 'Cannot fit: {error}',
    'editor.status.nothingToFit2d': 'Nothing to fit yet: add a function first.',
    'editor.status.nothingToFit3d': 'Nothing to fit yet: add a surface first.',
    /** Auto-fit when everything the chart draws goes on forever (lines, half-planes). */
    'editor.status.nothingBounded': 'Nothing to fit: the lines, curves and regions here go on forever.',
    'editor.status.rangesUseExpressions': 'The ranges use expressions: edit them in Chart > Ranges.',
    'editor.status.tikzFailed': 'Could not generate TikZ: {error}',
    'editor.status.exportFailed': 'Could not export the preview: {error}',

    // The action bar: copy, insert, save.
    'editor.actions.copySvg': 'Copy SVG',
    'editor.actions.copyPng': 'Copy PNG',
    'editor.actions.copyTikz': 'Copy TikZ',
    'editor.actions.insert': 'Insert into note',
    'editor.actions.save': 'Save changes',
    /** aria-label of Insert / Save: {action} is its text, {key} Cmd or Ctrl. */
    'editor.actions.shortcut': '{action} ({key}+Enter)',

    // Notices.
    'editor.notice.dataFile': 'Could not update the plugin data file.',
    'editor.notice.clipboard': 'Could not copy to the clipboard.',
    'editor.notice.notRendered': 'Nothing to copy yet: the chart has not rendered.',
    'editor.notice.svgClipboard': 'Could not copy the SVG to the clipboard.',
    'editor.notice.pngFailed': 'Could not copy the PNG: {error}',
    'editor.notice.saveFailed': 'Could not save the chart to the file: {error}',
    'editor.notice.blockNotFound': 'Could not find the original chart in the note (it may have been edited), so it was inserted at the current position.',
    'editor.notice.noActiveNote': 'No active note to insert into. Open a note and try again.',
    'editor.notice.autosaveFailed': 'Could not autosave the chart draft.',

    // Replacing the chart (examples, drafts).
    'editor.replace.title': 'Replace the current chart?',
    'editor.replace.message': 'The chart in the editor is replaced. Charts already in your notes are not affected.',

    // The draft banner.
    'editor.draft.chart': 'Unsaved chart from {time}',
    'editor.draft.changes': 'Unsaved changes from {time}',
    /** {note}: the note's name. */
    'editor.draft.edit': 'Unsaved edit of a chart in {note} from {time}',
    /** A draft from another day: its date and time. */
    'editor.draft.dateTime': '{date}, {time}',
    'editor.draft.restoreTitle': 'Restore the unsaved chart?',
    'editor.draft.restoreMessage': 'Your changes in this editor are replaced by the restored chart.',

    // Saved templates dialog.
    'editor.templates.title': 'Saved templates',
    'editor.templates.empty': 'No saved templates yet. Save a function as a template from its card menu.',
    'editor.templates.delete': 'Delete {name}',

    // Undo and redo (the bar under the tabs, Mod+Z).
    'editor.undo.nothingToUndo': 'Nothing to undo',
    'editor.undo.nothingToRedo': 'Nothing to redo',
    /** {label}: what was undone, e.g. "Moved R1 (2)". */
    'editor.undo.undone': 'Undone: {label}',
    'editor.undo.redone': 'Redone: {label}',
    /** {names}: the parts edited since, e.g. "R1 (2)" or "R1, R2 and C1". */
    'editor.undo.nothingUndone': '{count, plural, one {Nothing undone: {names} was edited since} other {Nothing undone: {names} were edited since}}',
    'editor.undo.undoneExcept': '{count, plural, one {Undone, except {names}, which was edited since} other {Undone, except {names}, which were edited since}}',
    'editor.undo.nothingRedone': '{count, plural, one {Nothing redone: {names} was edited since} other {Nothing redone: {names} were edited since}}',
    'editor.undo.redoneExcept': '{count, plural, one {Redone, except {names}, which was edited since} other {Redone, except {names}, which were edited since}}',
    /** An undo that restored nothing, for an entry that names no subject; outside English only (English names the label's subject above). */
    'editor.undo.notUndone': 'Could not undo: {label}',
    'editor.undo.notRedone': 'Could not redo: {label}',
    'editor.undo.numberEdited': 'Nothing changed: the number was edited since',
    /** Undo labels of a drag; {subject} is what was dragged ("R1 (2)", "C1 level 2", "C1 and P1's objective"). */
    'editor.undo.moved': 'Moved {subject}',
    'editor.undo.turned': 'Turned {subject}',
    'editor.undo.stretched': 'Stretched {subject}',
    'editor.undo.resized': 'Resized {subject}',
    'editor.undo.changed': 'Changed {subject}',
    /** {twins}: the objectives that changed with the curve ("P1's objective"). */
    'editor.undo.withTwins': '{subject} and {twins}',
    /** Button after a drag that changed one number: the number becomes a slider. */
    'editor.undo.makeSlider': 'Make slider',
    'editor.undo.madeSlider': 'Made slider {name} from {value}',
    /** What "Nothing undone: ... was edited since" names after Make slider. */
    'editor.undo.madeSliderSubject': 'slider {name} from {value}',

    // Names of the parts a drag grabs ({name}: f1, R1, C1, P1, S1).
    'editor.drag.label': 'Label {n}',
    'editor.drag.tangent': '{name} tangent',
    'editor.drag.condition': '{name} condition {n}',
    'editor.drag.level': '{name} level {level}',
    'editor.drag.point': '{name} point {n}',
    'editor.drag.objective': "{name}'s objective",
    /** Chip titles and announcements: the dragged part and its text. */
    'editor.drag.subjectText': '{subject}: {text}',
    'editor.drag.coreRule':
        'Drag a line, curve, point or label: its numbers change so the part you grabbed follows the pointer. Shift-drag turns lines and stretches curves around ⊕.',
    'editor.drag.chartLabel':
        'Chart preview. Drag lines, curves, points and labels to change their numbers; Shift-drag turns or stretches. Drag empty space to pan, scroll to zoom.',
    'editor.drag.toggle': 'Edit shapes by dragging',

    // Why a part cannot be dragged (the lock chip: a title and a detail line).
    'editor.lock.optimumMax': '{point} is computed: the max of {objective} over {region}',
    'editor.lock.optimumMin': '{point} is computed: the min of {objective} over {region}',
    'editor.lock.dragLinesOr': "Drag {region}'s lines or {curve} instead",
    'editor.lock.dragLines': "Drag {region}'s lines instead",
    'editor.lock.intersection': '{point} is computed: where {a} meets {b}',
    'editor.lock.dragEither': 'Drag {a} or {b} instead',
    'editor.lock.corner': '{point} is computed: the corners of {region}',
    'editor.lock.lattice': '{point} is computed: the integer points of {region}',
    'editor.lock.latticeView': '{point} is computed: the integer points of the view',
    'editor.lock.panOrZoom': 'Pan or zoom the view instead',
    'editor.lock.derivedClause': 'This edge of {region} follows {name}',
    'editor.lock.computedBy': '{tool} computes it',
    'editor.lock.derivedLevel': "{curve}'s level is {name}",
    'editor.lock.derivedLevelDetail': '{tool} computes it. Shift-drag reshapes the curve',
    /** {keyword}: max or min (chart words). */
    'editor.lock.keywordTangent': 'The tangent of {fn} sits at its {keyword}',
    /** "Tangent at" is the field of the function card. */
    'editor.lock.keywordTangentDetail': 'Type a number or a slider in Tangent at to drag it',
    'editor.lock.derivedTangent': 'The tangent of {fn} follows {name}',
    'editor.lock.splicedVertex': '{segment} point {index} comes from {from}',
    'editor.lock.dragInSource': 'Drag it in {from} instead',
    'editor.lock.splicedPath': "{segment} follows {from}'s points",
    'editor.lock.dragOwnPoints': 'Drag its own points instead',
    'editor.lock.parametric': '{fn} is parametric',
    'editor.lock.polar': '{fn} is polar',
    'editor.lock.dragWorksFor': 'Dragging works for y = f(x) curves, regions, curves, points, segments and labels',
    'editor.lock.nothing': 'Nothing in {subject} can change by dragging',
    'editor.lock.noNumbers': 'Its text has no numbers or sliders',
    'editor.lock.axisSlider': '{name} also sets the axis range',
    'editor.lock.axisSliderDetail': 'Dragging leaves it alone. Change it in the dock',
    'editor.lock.cannotDragHere': '{subject} cannot be dragged here',
    'editor.lock.grabWhereDrawn': 'Grab it where it is drawn',
    /** {text}: a condition such as x <= 4; {variable}: y or x. */
    'editor.lock.shiftNoTerm': 'Shift-drag cannot turn {text}: it has no {variable} term',
    'editor.lock.shiftCannotTurn': 'Shift-drag cannot turn {subject} with its numbers',
    'editor.lock.shiftCannotStretch': 'Shift-drag cannot stretch {subject} with its numbers',
    'editor.lock.shiftCannotResize': 'Shift-drag cannot resize {subject} with its numbers',
    'editor.lock.dragWithoutShift': 'Drag without Shift to move it',
    /** ⊕ marks the point a Shift-drag turns, stretches or resizes around. */
    'editor.lock.noPivotTurn': 'Shift-drag has no ⊕ to turn {subject} from this point',
    'editor.lock.noPivotStretch': 'Shift-drag has no ⊕ to stretch {subject} from this point',
    'editor.lock.noPivotResize': 'Shift-drag has no ⊕ to resize {subject} from this point',
    'editor.lock.noPivotTurnDetail': 'Grab it elsewhere to turn it, or drag without Shift to move it',
    'editor.lock.noPivotStretchDetail': 'Grab it elsewhere to stretch it, or drag without Shift to move it',
    'editor.lock.noPivotResizeDetail': 'Grab it elsewhere to resize it, or drag without Shift to move it',

    // Hover hints: what a drag does here.
    'editor.hint.level': 'Drag to change this level · Shift-drag to reshape all levels',
    'editor.hint.alongCurve': 'Drag along the curve',
    'editor.hint.move': 'Drag to move',
    'editor.hint.moveVertical': 'Drag to move up and down',
    'editor.hint.moveSideways': 'Drag to move sideways',
    'editor.hint.slide': 'Drag to slide it along its path',
    /** A drag hint and its Shift-drag hint. */
    'editor.hint.join': '{first} · {second}',
    'editor.hint.shiftTurnEnd': 'Shift-drag to turn around the other end',
    'editor.hint.shiftTurn': 'Shift-drag to turn',
    'editor.hint.shiftStretch': 'Shift-drag to stretch',
    'editor.hint.shiftResize': 'Shift-drag to resize',
    'editor.hint.shiftStraight': 'Shift-drag moves straight',
    /** {point}: where ⊕ is, e.g. (3, 1). */
    'editor.hint.turnsAround': 'Shift-drag turns around ⊕ {point}',
    'editor.hint.turns': 'Shift-drag turns',
    'editor.hint.stretchesFrom': 'Shift-drag stretches from ⊕ {point}',
    'editor.hint.stretches': 'Shift-drag stretches',
    'editor.hint.resizesAround': 'Shift-drag resizes around ⊕ {point}',
    'editor.hint.resizes': 'Shift-drag resizes',

    // Hover notes, joined into one line.
    /** {things}: a list of the four words below. */
    'editor.note.adds': 'Adds {things}',
    'editor.note.shift': 'a shift',
    'editor.note.offset': 'an offset',
    'editor.note.factor': 'a factor',
    'editor.note.scale': 'a scale',
    'editor.note.sharedSlider': '{name} is also used by {users}',
    'editor.note.twin': "Also changes {name}'s objective (same text)",
    'editor.note.passed': '{source} is computed: dragging here moves {subject}',
    'editor.note.join': '{first}. {next}',

    // While dragging: the chip's second line.
    'editor.live.onlyVertical': 'only up and down',
    'editor.live.onlyHorizontal': 'only sideways',
    'editor.live.snapped': 'snapped to {name}',
    'editor.live.snappedPoint': 'snapped to the point',
    'editor.live.origin': 'snapped to the origin',
    'editor.live.through': 'through {name}',
    'editor.live.throughPoint': 'through the point',
    'editor.live.grid': 'on the grid',
    /** {value}: the slope a turned line snapped to, e.g. 2 or -2/3. */
    'editor.live.slope': 'slope {value}',
    'editor.live.slopeOnly': 'slope',
    'editor.live.slopeHorizontal': 'horizontal',
    'editor.live.slopeVertical': 'vertical',
    'editor.live.turning': 'turning around ⊕ {point}',
    'editor.live.turningAround': 'turning around ⊕',
    'editor.live.stretching': 'stretching from ⊕ {point}',
    'editor.live.stretchingFrom': 'stretching from ⊕',
    'editor.live.resizing': 'resizing around ⊕ {point}',
    'editor.live.resizingAround': 'resizing around ⊕',
    'editor.live.atMax': '{name} is at its maximum ({value})',
    'editor.live.sliderAtMax': 'The slider is at its maximum ({value})',
    'editor.live.atMin': '{name} is at its minimum ({value})',
    'editor.live.sliderAtMin': 'The slider is at its minimum ({value})',
    'editor.live.stuck': 'cannot follow further',
    'editor.live.flip': '{subject} cannot turn further this way',
    'editor.live.vertical89': 'a function cannot turn vertical: use a curve like x = 2',
    'editor.live.mirrored': 'mirrored',

    // The first-hover tip ({mod}: Cmd or Ctrl).
    'editor.tip.title': 'Tip: drag lines and curves to change their numbers',
    'editor.tip.detail': 'Shift-drag turns or stretches. {mod}+Z undoes.',

    // Screen-reader announcements.
    'editor.announce.select': '{subject} selected: {text}. Arrow keys move it, Enter edits the text, Escape clears the selection.',

    // Lists of names: "R1 and Label 1", "A, B and C", "A, B, C and 2 more".
    'editor.list.pair': '{first} and {last}',
    'editor.list.comma': '{first}, {next}',
    'editor.list.more': '{names} and {count} more',

    // The UI kit (src/ui/kit.ts): defaults and parts every panel uses.
    /** Accessible name of the number field next to a slider; {label}: the slider's name. */
    'editor.kit.sliderValue': '{label} value',
    /** A dropdown value that is no longer in its list (a deleted function). */
    'editor.kit.missing': '{value} (missing)',
    'editor.kit.colour': 'Colour',
    /** Accessible name of a colour button: "Colour: Blue". */
    'editor.kit.colourValue': '{label}: {colour}',
    'editor.kit.lineThickness': 'Line thickness',
    'editor.kit.hasError': 'Has an error',
    'editor.kit.showInChart': 'Show in chart',
    'editor.kit.ok': 'OK',
} as const;
